// The ship data is the game's source of truth for what you see and what you can hit, so it is
// checked here rather than in a screenshot: three triple 16" turrets forward-and-aft, ten twin 5"
// secondaries down both sides, nothing hanging off the ends of the hull.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SPECS } from '../src/sim/ships.ts';
import { GUNS, TORPS, TS } from '../src/sim/guns.ts';
import { deckY } from '../src/sim/hull.ts';

const KEYS = Object.keys(SPECS);

test('every ship refers to guns, turrets and torpedoes that exist', () => {
  for (const k of KEYS) {
    const s = SPECS[k];
    assert.ok(GUNS[s.gun], `${k} has no gun ${s.gun}`);
    if (s.sec) assert.ok(GUNS[s.sec], `${k} has no secondary ${s.sec}`);
    if (s.torp) assert.ok(TORPS[s.torp], `${k} has no torpedo ${s.torp}`);
    for (const t of s.tur) assert.ok(TS[t.kind], `${k} has no turret house ${t.kind}`);
  }
});

test('the model list covers a US and a JP battleship and cruiser, plus destroyers', () => {
  const has = (cls: string, nation: string) => KEYS.filter((k) => SPECS[k].cls === cls && SPECS[k].nation === nation);
  assert.ok(has('BB', 'US').length >= 1, 'no US battleship');
  assert.ok(has('BB', 'JP').length >= 1, 'no Japanese battleship');
  assert.ok(has('CA', 'US').length >= 1, 'no US cruiser');
  assert.ok(has('CA', 'JP').length >= 1, 'no Japanese cruiser');
  assert.ok(has('DD', 'JP').length >= 1, 'no Japanese destroyer for level 1');
  assert.ok(has('DD', 'US').length >= 1, 'no US destroyer');
});

test('the US battleship carries nine 16-inch guns in three triple turrets', () => {
  const s = SPECS.us_bb;
  const main = s.tur.filter((t) => !t.sec);
  assert.equal(main.length, 3, 'three main turrets');
  assert.equal(main.filter((t) => t.z > 0).length, 2, 'two forward');
  assert.equal(main.filter((t) => t.z < 0).length, 1, 'one aft');
  for (const t of main) assert.equal(TS[t.kind].n, 3, 'each main turret is a triple');
  assert.equal(s.gun, 'us406');
  assert.equal(GUNS.us406.cal, 406);
});

test('the US battleship carries twenty 5-inch guns in ten twin mounts, five a side', () => {
  const s = SPECS.us_bb;
  const sec = s.tur.filter((t) => t.sec);
  assert.equal(sec.length, 10, 'ten secondary mounts');
  assert.equal(sec.filter((t) => t.x > 0).length, 5, 'five to starboard');
  assert.equal(sec.filter((t) => t.x < 0).length, 5, 'five to port');
  for (const t of sec) assert.equal(TS[t.kind].n, 2, 'each secondary mount is a twin');
  assert.equal(s.sec, 'sec127');
  // broadside mounts: they must face their own side, not fore and aft
  for (const t of sec) assert.ok(Math.abs(Math.abs(t.face) - Math.PI / 2) < 0.01, 'secondaries must bear on the beam');
});

test('the Japanese battleship is built along the same lines', () => {
  const s = SPECS.jp_bb;
  const main = s.tur.filter((t) => !t.sec);
  assert.equal(main.length, 4, 'Kongo carries eight guns in four twins');
  for (const t of main) assert.equal(TS[t.kind].n, 2);
  assert.ok(s.tur.filter((t) => t.sec).length >= 6, 'she has a secondary battery too');
});

test('nothing is bolted off the ends of the hull', () => {
  for (const k of KEYS) {
    const s = SPECS[k];
    const half = s.L / 2;
    for (const p of s.parts) {
      const front = p.z + (p.len ?? 0) / 2;
      const back = p.z - (p.len ?? 0) / 2;
      assert.ok(front < half + 1, `${k}: part at z=${p.z} runs past the bow`);
      assert.ok(back > -half - 1, `${k}: part at z=${p.z} runs past the stern`);
    }
    for (const t of s.tur) {
      assert.ok(Math.abs(t.z) < half, `${k}: turret at z=${t.z} is off the hull`);
      assert.ok(Math.abs(t.x) < s.B / 2 + 0.1, `${k}: turret at x=${t.x} is outside the beam`);
    }
  }
});

test('the bridge eye point sits above the deck and inside the ship', () => {
  for (const k of KEYS) {
    const s = SPECS[k];
    assert.ok(s.bridge, `${k} has no bridge eye point`);
    const [z, y] = s.bridge!;
    assert.ok(Math.abs(z) < s.L / 2, `${k}: bridge z ${z} is off the hull`);
    assert.ok(y > deckY(s, z) + 2, `${k}: bridge eye ${y} is not clear of the deck`);
    assert.ok(y < s.F + s.top * 0.95, `${k}: bridge eye ${y} is implausibly high`);
  }
});

test('the 16-inch is the gun the game is tuned around: 10 km in 11 seconds', () => {
  const g = GUNS.us406;
  assert.equal(g.v0, 909);
  assert.equal(g.range, 22000);
  assert.ok(Math.abs(10000 / g.v0 - 11) < 0.01);
  // and the secondary reaches a fifth as far
  assert.ok(GUNS.sec127.range < g.range * 0.3);
});
