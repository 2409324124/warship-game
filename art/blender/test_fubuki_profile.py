import math
import unittest
from fubuki_profile import FubukiProfile


class FubukiTests(unittest.TestCase):
    def setUp(self):self.p=FubukiProfile()

    def test_actual_dimensions(self):
        points=[self.p.sample(s,*layer) for s in self.p.stations() for layer in self.p.levels]
        self.assertAlmostEqual(max(x for x,y,z in points)*2,10.4)
        self.assertAlmostEqual(max(z for x,y,z in points)-min(z for x,y,z in points),118)
        self.assertTrue(all(math.isfinite(a) for v in points for a in v))

    def test_forecastle(self):
        self.assertAlmostEqual(self.p.deck(.618),2.35)
        self.assertAlmostEqual(self.p.deck(.622),4.05)
        self.assertGreater(self.p.deck(.9),self.p.deck(.7))

    def test_sharp_stem_no_hanging_toe(self):
        for level in self.p.data['lowerLevels']:
            self.assertEqual(self.p.sample(1,'lower',level),(0,0,57.95))
        self.assertAlmostEqual(self.p.sample(1,'upper',1)[2],59)

    def test_waterline_join(self):
        for s in self.p.stations():
            for a,b in zip(self.p.sample(s,'lower',1),self.p.sample(s,'upper',0)):
                self.assertAlmostEqual(a,b)

    def test_symmetric_convex_underbody(self):
        for s in (.1,.5,.7,.9,.99):
            pts=[self.p.sample(s,'lower',i/100) for i in range(101)]
            slopes=[(b[0]-a[0])/(b[1]-a[1]) for a,b in zip(pts,pts[1:])]
            self.assertTrue(all(b<=a+1e-7 for a,b in zip(slopes,slopes[1:])))

    def test_loft_not_folded(self):
        for layer in self.p.levels:
            z=[self.p.sample(s,*layer)[2] for s in self.p.stations()]
            self.assertTrue(all(b>a for a,b in zip(z,z[1:])))

    def test_forecastle_step_is_not_in_underbody(self):
        for level in self.p.data['lowerLevels']:
            a=self.p.sample(.618,'lower',level)
            b=self.p.sample(.622,'lower',level)
            self.assertAlmostEqual(a[1],b[1])
            self.assertLess(abs(a[0]-b[0]),.10)


if __name__=='__main__':unittest.main()
