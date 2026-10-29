"""Visual-profile regressions; not an assertion of measured historical lines."""
import math
import unittest
from fletcher_profile import FletcherProfile


class FletcherHullTests(unittest.TestCase):
    def setUp(self):
        self.p = FletcherProfile()

    def test_fixed_gamescale_dimensions(self):
        points = [self.p.sample(s, *lev) for s in self.p.stations() for lev in self.p.levels]
        self.assertAlmostEqual(2 * max(x for x, y, z in points), 12)
        self.assertAlmostEqual(max(z for x, y, z in points) - min(z for x, y, z in points), 114)

    def test_flush_deck_and_reduced_freeboard(self):
        self.assertLess(self.p.deck(0.5), 3)
        self.assertGreater(self.p.deck(1), self.p.deck(0.5) + 2)
        for i in range(1000):
            self.assertLess(abs(self.p.deck((i + 1) / 1000) - self.p.deck(i / 1000)), .02)

    def test_round_fantail_not_a_second_bow(self):
        stern = self.p.sample(.03, 'upper', 1)[0]
        bow = self.p.sample(.97, 'upper', 1)[0]
        self.assertGreater(stern, bow * 3)
        self.assertGreater(self.p.sample(0, 'lower', 1)[2], -56)
        self.assertGreater(self.p.sample(0, 'lower', 0)[2], -52)

    def test_finite_fair_sections_and_no_station_reversal(self):
        for region, level in self.p.levels:
            last_z = -math.inf
            for i in range(2001):
                x, y, z = self.p.sample(i / 2000, region, level)
                self.assertTrue(all(math.isfinite(v) for v in (x, y, z)))
                self.assertGreaterEqual(x, 0)
                self.assertGreater(z, last_z)
                last_z = z

    def test_rising_stern_bottom(self):
        self.assertGreater(self.p.depth(.2), self.p.depth(.1))
        self.assertGreater(self.p.depth(.1), self.p.depth(.02))


if __name__ == '__main__':
    unittest.main()
