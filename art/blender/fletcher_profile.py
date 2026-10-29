"""Dependency-free Fletcher hull loft. Reuses only generic curve maths."""
import json
import math
import importlib.util
from pathlib import Path

_path = Path(__file__).with_name('washington_bow_profile.py')
_module = importlib.util.module_from_spec(importlib.util.spec_from_file_location('bow_math', _path))
exec(compile(_path.read_text(encoding='utf-8'), str(_path), 'exec'), _module.__dict__)
curve, smooth, clamp = _module.curve, _module.smooth, _module.clamp


class FletcherProfile:
    def __init__(self):
        self.data = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
        self.levels = [('lower', a) for a in self.data['lowerLevels']]
        self.levels += [('upper', a) for a in self.data['upperLevels']]

    def deck(self, s):
        points = self.data['deck']
        for a, b in zip(points, points[1:]):
            if s <= b[0]:
                t = clamp((s - a[0]) / (b[0] - a[0]))
                return a[1] + (b[1] - a[1]) * t
        return points[-1][1]

    def depth(self, s):
        d = self.data
        if s > d['forefootStart']:
            t = clamp((s - d['forefootStart']) / (1 - d['forefootStart']))
            return d['draft'] * math.sqrt(max(0.0, 1 - t * t))
        return d['draft'] * curve(d['sternDepth'], s) if s < 0.24 else d['draft']

    def sample(self, s, region, level):
        d = self.data
        top, depth = self.deck(s), self.depth(s)
        half = d['beam'] / 2 * curve(d['halfBreadth'], s)
        ratio = curve(d['waterlineRatio'], s)
        if region == 'lower':
            y = -depth * (1 - level)
            rounded = math.sin(level * math.pi / 2) ** curve(d['sectionPower'], s)
            entry = smooth((s - 0.65) / 0.30)
            x = half * ratio * ((1 - entry) * rounded + entry * level ** 1.35)
            setback = d['waterlineSetback'] * (1 + (1 - d['stemCurvature']) * depth / top * (1 - level))
        else:
            y = top * level
            x = half * (ratio + (1 - ratio) * level ** 1.5)
            # Near-vertical at waterline, increasingly raked towards the deck:
            # avoids the old hard elbow where straight stem met forefoot.
            setback = d['waterlineSetback'] * (1 - level ** 1.25)
        z = (s - 0.5) * d['length'] - smooth((s - d['rakeStart']) / (1 - d['rakeStart'])) * setback
        # Cruiser stern overhang: do not collapse the underwater last station
        # straight below the aft deck tip (the previous vertical needle).
        if s < 0.13:
            stern_run = (2.2 + 4.0 * (1 - level)) if region == 'lower' else 2.2 * (1 - level) ** 1.3
            z += (1 - smooth(s / 0.13)) * stern_run
        return x, y, z

    def stations(self):
        stations = {i / 72 for i in range(73) if i / 72 < 0.94}
        stations.update(0.94 + 0.06 * (1 - (1 - i / 12) ** 2) for i in range(13))
        stations.update(s for s, _ in self.data['deck'])
        stations.update(s for s, _ in self.data['halfBreadth'])
        stations.update(0.03 * (i / 16) ** 2 for i in range(17))
        stations.update((self.data['forefootStart'], self.data['rakeStart']))
        return sorted(stations)
