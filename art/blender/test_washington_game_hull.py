import json
import unittest
from pathlib import Path
from washington_bow_profile import BowProfile


class WashingtonGameBow(unittest.TestCase):
    def test_visible_sheer_does_not_move_live_weapon_stations(self):
        root=Path(__file__).parent
        spec=json.loads((root/'ship_input.json').read_text(encoding='utf-8'))['ships']['us_bb']
        controls=json.loads((root/'washington_bow_profile.json').read_text(encoding='utf-8'))
        baseline=BowProfile(spec,controls)
        strengthened=BowProfile(spec,dict(controls,extraSheerMetres=1.0))
        self.assertAlmostEqual(strengthened.deck(1)-baseline.deck(1),.65)
        for mount in spec['tur']:
            s=mount['z']/spec['L']+.5
            self.assertAlmostEqual(strengthened.deck(s),baseline.original_deck(s))
        for s in strengthened.stations():
            self.assertEqual(strengthened.sample(s,'lower',1),baseline.sample(s,'lower',1))


if __name__=='__main__':unittest.main()
