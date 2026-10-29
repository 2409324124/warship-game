"""Independent destroyer loft; no Blender or simulation imports."""
import json
import math
import importlib.util
from pathlib import Path

# Reuse only generic math, not the Washington ship's proportions or control data.
_path = Path(__file__).with_name('washington_bow_profile.py')
_module = importlib.util.module_from_spec(importlib.util.spec_from_file_location('bow_math', _path))
exec(compile(_path.read_text(encoding='utf-8'),str(_path),'exec'),_module.__dict__)
curve, smooth, clamp = _module.curve, _module.smooth, _module.clamp


class FubukiProfile:
    def __init__(self):
        self.data = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
        self.levels = [('lower',a) for a in self.data['lowerLevels']]+[('upper',a) for a in self.data['upperLevels']]

    def deck(self,s):
        # The forecastle break is intentional, not a spline overshoot.
        points = self.data['deck']
        for a,b in zip(points,points[1:]):
            if s<=b[0]:
                t=clamp((s-a[0])/(b[0]-a[0]))
                return a[1]+(b[1]-a[1])*t
        return points[-1][1]

    def depth(self,s):
        d = self.data
        if s>d['forefootStart']:
            t=clamp((s-d['forefootStart'])/(1-d['forefootStart']))
            return d['draft']*math.sqrt(max(0,1-t*t))
        return d['draft']*(.4+.6*smooth(s/.1)) if s<.1 else d['draft']

    def sample(self,s,region,level):
        d=self.data;top=self.deck(s);depth=self.depth(s)
        half=d['beam']/2*curve(d['halfBreadth'],s)
        ratio=curve(d['waterlineRatio'],s)
        if region=='lower':
            y=-depth*(1-level)
            x=half*ratio*math.sin(level*math.pi/2)**curve(d['sectionPower'],s)
            setback=d['waterlineSetback']*(1+(1-d['stemCurvature'])*depth/top*(1-level))
        else:
            y=top*level
            x=half*(ratio+(1-ratio)*level**1.5)
            setback=d['waterlineSetback']*((1-level)+d['stemCurvature']*level*(1-level))
        z=(s-.5)*d['length']-smooth((s-d['rakeStart'])/(1-d['rakeStart']))*setback
        return x,y,z

    def stations(self):
        stations={i/64 for i in range(65) if i/64<.94}
        stations.update(.94+.06*(1-(1-i/12)**2) for i in range(13))
        stations.update(s for s,_ in self.data['deck'])
        stations.update(s for s,_ in self.data['halfBreadth'])
        stations.update((self.data['forefootStart'],self.data['rakeStart']))
        return sorted(stations)
