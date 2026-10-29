"""Run: python -B -m unittest discover -s art/blender -p test_washington_bow.py"""
import json
import math
from pathlib import Path
import unittest

from washington_bow_profile import BowProfile, curve


class BowProfileTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).parent
        self.spec = json.loads((root/'ship_input.json').read_text(encoding='utf-8'))['ships']['us_bb']
        self.p = BowProfile(self.spec)

    def test_dimensions_and_finite_samples(self):
        for s in self.p.stations():
            for layer in self.p.levels:
                x,y,z = self.p.sample(s,*layer)
                self.assertTrue(all(math.isfinite(v) for v in (x,y,z)))
                self.assertTrue(0<=x<=16.5+1e-9)
                self.assertTrue(-111-1e-9<=z<=111+1e-9)

    def test_sharp_stem_and_rake(self):
        for layer in self.p.levels:
            self.assertAlmostEqual(self.p.sample(1,*layer)[0],0)
        self.assertAlmostEqual(self.p.sample(1,'upper',1)[2],111)
        self.assertAlmostEqual(self.p.sample(1,'lower',1)[2],107.8)
        for level in self.p.data['lowerLevels']:
            self.assertEqual(self.p.sample(1,'lower',level),(0,0,107.8))

    def test_actual_beam_not_just_spec(self):
        half = max(self.p.sample(s,*layer)[0] for s in self.p.stations() for layer in self.p.levels)
        self.assertAlmostEqual(2*half,33,places=7)

    def test_flare_and_monotone_sections(self):
        for s in (.7,.8,.9,.95,.99):
            upper = [self.p.sample(s,'upper',a)[0] for a in (0,.2,.4,.6,.8,1)]
            self.assertEqual(upper,sorted(upper))
            self.assertLess(upper[0],upper[-1])

    def test_rounded_forefoot(self):
        # The keel turns upward progressively; no second flattening at the bow.
        points = [self.p.sample(.76+i*.239/200,'lower',0) for i in range(201)]
        slopes = [(b[1]-a[1])/(b[2]-a[2]) for a,b in zip(points,points[1:])]
        self.assertTrue(all(b>=a-1e-7 for a,b in zip(slopes,slopes[1:])))
        self.assertAlmostEqual(self.p.depth(1),0)

    def test_no_lower_section_waist(self):
        ratios = [self.p.sample(s/1000,'lower',.1)[0]/self.p.sample(s/1000,'lower',1)[0]
                  for s in range(580,751)]
        # Gradual family change, not the previous 51% -> 32% sudden squeeze.
        self.assertLess(max(abs(b-a) for a,b in zip(ratios,ratios[1:])),.003)

    def test_waterline_join(self):
        for s in (.2,.5,.65,.8,.9,.99):
            lower = self.p.sample(s,'lower',1)
            upper = self.p.sample(s,'upper',0)
            for a,b in zip(lower,upper):
                self.assertAlmostEqual(a,b,places=7)

    def test_underbody_convex_sections(self):
        for s in (0,.2,.5,.65,.8,.9,.98,.999):
            points = [self.p.sample(s,'lower',i/100) for i in range(101)]
            slopes = [(b[0]-a[0])/(b[1]-a[1]) for a,b in zip(points,points[1:])]
            self.assertTrue(all(b<=a+1e-7 for a,b in zip(slopes,slopes[1:])))

    def test_longitudinal_loft_does_not_fold_back(self):
        for layer in self.p.levels:
            z = [self.p.sample(s,*layer)[2] for s in self.p.stations()]
            self.assertTrue(all(b>a for a,b in zip(z,z[1:])))

    def test_breadth_monotone_toward_bow(self):
        widths = [curve(self.p.data['deckHalfBreadthFraction'],i/1000) for i in range(620,1001)]
        self.assertTrue(all(a>=b>=0 for a,b in zip(widths,widths[1:])))

    def test_mount_interfaces_and_input_untouched(self):
        before = json.dumps(self.spec,sort_keys=True)
        for mount in self.spec['tur']:
            s = mount['z']/self.spec['L']+.5
            self.assertAlmostEqual(self.p.deck(s),self.p.original_deck(s))
        self.p.stations()
        self.assertEqual(before,json.dumps(self.spec,sort_keys=True))

    def test_closed_keel_and_station_order(self):
        for s in self.p.stations():
            self.assertAlmostEqual(self.p.sample(s,'lower',0)[0],0)
        stations = self.p.stations()
        self.assertEqual(stations,sorted(set(stations)))
        self.assertEqual((stations[0],stations[-1]),(0,1))


if __name__ == '__main__':
    unittest.main()
