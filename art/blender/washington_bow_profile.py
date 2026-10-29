"""Dependency-free visual hull sampler. Does not import or change simulation data.

The JSON is the single control-point source for this Blender blockout. A future
render-side integration must port this sampler, not silently replace sim/hull.ts.
"""
import json
import math
from pathlib import Path


def clamp(x, a=0.0, b=1.0):
    return min(b, max(a, x))


def smooth(x):
    t = clamp(x)
    return t * t * (3 - 2 * t)


def curve(points, x):
    """Monotone cubic Hermite interpolation; no breadth overshoot at the tip."""
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    h = [b[0] - a[0] for a, b in zip(points, points[1:])]
    d = [(b[1] - a[1]) / span for a, b, span in zip(points, points[1:], h)]
    slopes = [d[0]]
    for i in range(1, len(points) - 1):
        a, b = d[i - 1], d[i]
        w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
        slopes.append(0 if a * b <= 0 else (w1 + w2) / (w1 / a + w2 / b))
    slopes.append(d[-1])
    for i in range(len(points) - 1):
        if x <= points[i + 1][0]:
            t = (x - points[i][0]) / h[i]
            return ((2*t**3-3*t**2+1)*points[i][1]
                    +(t**3-2*t**2+t)*h[i]*slopes[i]
                    +(-2*t**3+3*t**2)*points[i+1][1]
                    +(t**3-t**2)*h[i]*slopes[i+1])


class BowProfile:
    def __init__(self, spec, controls=None):
        self.spec = spec
        self.data = controls or json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
        assert spec['L'] == self.data['length'] and spec['B'] == self.data['beamLimit']
        self.levels = [('lower', a) for a in self.data['lowerLevels']]
        self.levels += [('upper', a) for a in self.data['upperLevels']]
        # The old section's 5% tumblehome made its *actual* maximum beam ~31.9m
        # despite a B=33 input. Retain its section shape, but normalize its beam
        # instead of claiming that an unchanged spec proves correct dimensions.
        raw_max = 0
        for s in self.stations():
            if s <= self.data['blendStart']:
                for region, level in self.levels:
                    y = -self.depth(s)*(1-level) if region == 'lower' else self.deck(s)*level
                    raw_max = max(raw_max,self.original_width(s,y))
        self.beam_correction = self.spec['B']/2/raw_max

    def blend(self, s):
        return smooth((s-self.data['blendStart'])/(self.data['blendEnd']-self.data['blendStart']))

    def original_deck(self, s):
        for a, b in zip(self.spec['sheer'], self.spec['sheer'][1:]):
            if s <= b[0]:
                t = clamp((s-a[0])/(b[0]-a[0]))
                return self.spec['F']*(a[1]+(b[1]-a[1])*t)
        return self.spec['F']*self.spec['sheer'][-1][1]

    def deck(self, s):
        d = self.data
        return self.original_deck(s)+d['extraSheerMetres']*smooth((s-d['extraSheerStart'])/(1-d['extraSheerStart']))

    def depth(self, s):
        if s > self.data['forefootStart']:
            # Quarter-ellipse, not smoothstep: the keel rises progressively to
            # the waterline stem instead of flattening into a hanging "shoe".
            t = clamp((s-self.data['forefootStart'])/(1-self.data['forefootStart']))
            return self.spec['D']*math.sqrt(max(0,1-t*t))
        if s < .1:
            return self.spec['D']*(.3+.7*smooth(s/.1))
        return self.spec['D']

    def original_width(self, s, y):
        if s >= .58:
            hw = max(.018, math.cos(clamp((s-.58)/.42)*math.pi/2)**.8)
        elif s < .16:
            hw = max(.42, math.cos(clamp((.16-s)/.16)*math.pi/2)**.55)
        else:
            hw = 1
        p = 3.4+(1.15-3.4)*smooth((s-.7)/.27)
        p += (2.2-p)*smooth((.14-s)/.14)
        a = clamp((y+self.depth(s))/(self.original_deck(s)+self.depth(s)))
        return self.spec['B']/2*hw*a**(1/p)*(1-.05*smooth((a-.88)/.12))

    def sample(self, s, region, level):
        """Starboard half-section as (x, y, z); the other side is its mirror."""
        d = self.data
        top, depth = self.deck(s), self.depth(s)
        y = -depth*(1-level) if region == 'lower' else top*level
        weight = self.blend(s)
        deck_width = self.spec['B']/2*curve(d['deckHalfBreadthFraction'], s)
        wl = curve(d['waterlineToDeckBreadth'], s)
        if region == 'lower':
            wl_width = self.original_width(s,0)*self.beam_correction*(1-weight)+deck_width*wl*weight
            # One underwater family from stern to bow. Previously the original
            # power section was blended into a much narrower sin**.62 section
            # over 22m, creating a visible waist near the keel.
            power = curve(d['lowerSectionPower'],s)
            eps = 1e-4
            upper_slope = ((self.original_width(s,eps)-self.original_width(s,0))/eps
                           *self.beam_correction*(1-weight))
            # The fitted upper flare has zero first derivative at the waterline.
            linear = clamp(upper_slope*depth/wl_width,0,.85) if wl_width>1e-9 else 0
            shape = (1-linear)*math.sin(level*math.pi/2)**power+linear*level
            width = wl_width*shape
        else:
            fitted = deck_width*(wl+(1-wl)*level**1.5)
            width = self.original_width(s, y)*self.beam_correction*(1-weight)+fitted*weight
        rake_weight = smooth((s-d['stemRakeStart'])/(1-d['stemRakeStart']))
        if region == 'lower':
            # The ellipse supplies the forefoot curvature. Extend the upper
            # stem's waterline tangent below zero; don't append a separate toe.
            setback = d['stemWaterlineSetback']*(1+(1-d['stemUpperCurvature'])*depth/top*(1-level))
        else:
            setback = d['stemWaterlineSetback']*((1-level)+d['stemUpperCurvature']*level*(1-level))
        z = (s-.5)*self.spec['L']-rake_weight*setback
        return width, y, z

    def stations(self):
        stations = set()
        for a, b, count in self.data['stationZones']:
            # Concentrate the same number of stations around the curved forefoot
            # rather than adding a subdivision modifier to the whole ship.
            for i in range(count+1):
                t = i/count
                if b == 1:
                    t = 1-(1-t)**2
                stations.add(a+(b-a)*t)
        # Sample actual sheer/control changes rather than straddling them with thin triangles.
        stations.update(s for s, _ in self.spec['sheer'])
        stations.update(s for s, _ in self.data['deckHalfBreadthFraction'])
        stations.update((self.data['blendStart'], self.data['blendEnd'], self.data['extraSheerStart']))
        stations.add(self.data['forefootStart'])
        return sorted(stations)
