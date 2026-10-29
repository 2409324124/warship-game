"""Data checks for the Kirishima 1942 layout. No Blender needed.

Run: python -B -m unittest discover -s art/blender -p test_kirishima_layout.py
"""
import json
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
LAYOUT = json.loads((ROOT / 'kirishima_1942_layout.json').read_text(encoding='utf-8'))
INPUT = json.loads((ROOT / 'ship_input.json').read_text(encoding='utf-8'))
SPEC = INPUT['ships']['jp_bb']
TURRET = INPUT['turrets']['jp14d']


def deck(z):
    s = min(1.0, max(0.0, z / SPEC['L'] + 0.5))
    sh = SPEC['sheer']
    for a, b in zip(sh, sh[1:]):
        if s <= b[0]:
            t = (s - a[0]) / (b[0] - a[0])
            return SPEC['F'] * (a[1] + (b[1] - a[1]) * t)
    return SPEC['F'] * sh[-1][1]


def half_w(s):
    if s >= 0.58:
        return max(0.018, math.cos(min(1.0, (s - 0.58) / 0.42) * math.pi / 2) ** 0.8)
    if s < 0.16:
        return max(0.42, math.cos(min(1.0, (0.16 - s) / 0.16) * math.pi / 2) ** 0.55)
    return 1.0


def half_width(z):
    return SPEC['B'] / 2 * half_w(z / SPEC['L'] + 0.5)


def anchor(ident):
    return next(a for a in LAYOUT['anchors'] if a['id'] == ident)


class KirishimaLayoutTests(unittest.TestCase):
    def test_dimensions_match_spec(self):
        self.assertEqual(LAYOUT['frame']['length'], SPEC['L'])
        self.assertEqual(LAYOUT['frame']['beam'], SPEC['B'])

    def test_zones_cover_the_ship_without_gaps(self):
        zones = sorted(LAYOUT['zones'], key=lambda z: z['z'][0])
        self.assertEqual(zones[0]['z'][0], -SPEC['L'] / 2)
        self.assertEqual(zones[-1]['z'][1], SPEC['L'] / 2)
        for a, b in zip(zones, zones[1:]):
            self.assertEqual(a['z'][1], b['z'][0])

    def test_unique_ids(self):
        ids = [a['id'] for a in LAYOUT['anchors']] + [c['id'] for c in LAYOUT['candidates']]
        self.assertEqual(len(ids), len(set(ids)))

    def test_anchors_in_declared_zone_and_inside_hull(self):
        for a in LAYOUT['anchors']:
            zone = next(z for z in LAYOUT['zones'] if z['id'] == a['zone'])
            self.assertTrue(zone['z'][0] <= a['z'] <= zone['z'][1], a['id'])
            reach = (TURRET['w'] / 2 if a['kind'] == 'main'
                     else a['footprint'].get('r', a['footprint'].get('w', 0) / 2))
            self.assertLessEqual(abs(a['x']) + reach, half_width(a['z']) + 1e-9, a['id'])

    def test_main_turrets_keep_the_simulation_mounts(self):
        expected = {(74, 0.0), (60, 3.6), (-42, 3.6), (-58, 0.0)}
        got = {(a['z'], a['deckOffset']) for a in LAYOUT['anchors'] if a['kind'] == 'main'}
        self.assertEqual(got, expected)
        self.assertTrue(all(a['status'] == 'locked_sim' for a in LAYOUT['anchors'] if a['kind'] == 'main'))

    def test_superfiring_clearance(self):
        for raised, below in (('MAIN_02', 'MAIN_01'), ('MAIN_03', 'MAIN_04')):
            a, b = anchor(raised), anchor(below)
            pivot = deck(a['z']) + a['deckOffset'] + TURRET['h'] * 0.5
            roof = deck(b['z']) + b['deckOffset'] + TURRET['h']
            self.assertGreater(pivot - roof, 0.3, raised)

    def test_casemates_inside_hull(self):
        for mount in LAYOUT['secondary']:
            self.assertLess(mount['x'], half_width(mount['z']), mount['id'])
        self.assertTrue(LAYOUT['secondaryMirror']['mirrorX'])
        self.assertEqual(len(LAYOUT['secondaryMirror']['starboardIds']), len(LAYOUT['secondary']))

    def test_aviation_position_stays_unresolved(self):
        self.assertTrue(all(c['status'] == 'unresolved' for c in LAYOUT['candidates']))
        ids = {c['id'] for c in LAYOUT['candidates']}
        self.assertTrue({'AVIATION_A', 'AVIATION_B'} <= ids)

    def test_astern_sweep_of_no2_reaches_the_bridge(self):
        a = anchor('MAIN_02')
        bridge = anchor('BRIDGE_TOWER')
        muzzle_z = a['z'] - TURRET['len'] * 0.18 - TURRET['bl']
        half_len = bridge['footprint']['len'] / 2
        self.assertTrue(bridge['z'] - half_len <= muzzle_z <= bridge['z'] + half_len)


if __name__ == '__main__':
    unittest.main()
