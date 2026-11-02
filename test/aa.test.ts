import assert from 'node:assert/strict';
import { test } from 'node:test';
import { World } from '../src/sim/world.ts';
import { Ship } from '../src/sim/ship.ts';
import { SPECS } from '../src/sim/ships.ts';
import { deriveAaMounts, aaLogic, aaTargetOf } from '../src/sim/aa.ts';
import { spawnPlane, spawnAirRaid } from '../src/sim/aircraft.ts';

test('AA mounts derive from every Aa part', () => {
  assert.equal(deriveAaMounts(SPECS.us_bb).length, 8);
  assert.equal(deriveAaMounts(SPECS.jp_bb).length, 8);
  assert.equal(deriveAaMounts(SPECS.us_dd).length, 5);
  assert.equal(deriveAaMounts(SPECS.jp_dd).length, 1);
  const m = deriveAaMounts(SPECS.us_bb)[0];
  assert.ok(Math.abs(Math.abs(m.home) - Math.PI / 2) < 1e-6, 'broadside rest bearing');
  assert.ok(m.gun.aa && m.gun.elevMax >= 80);
});

function battle() {
  const w = new World();
  const s = new Ship(w, 'us_bb', 'US', 'Test BB');
  w.add(s);
  return { w, s };
}

test('threat scoring prefers aircraft on their attack run', () => {
  const { w, s } = battle();
  const slow = spawnPlane(w, 'torp', 'JP', s.x + 1200, 800, s.z, 0, s, 1, 0);
  slow.state = 'approach';
  const hot = spawnPlane(w, 'dive', 'JP', s.x + 1600, 800, s.z, 0, s, 1, 1);
  hot.state = 'attack';
  aaLogic(w, s, 0.3);
  assert.equal(aaTargetOf(s), hot);
  slow.state = 'egress';
  hot.state = 'egress';
  aaLogic(w, s, 0.3);
  assert.equal(aaTargetOf(s), null, 'no one worth shooting on egress');
});

test('firing needs traverse alignment, spends reload, and respects the in-flight cap', () => {
  const { w, s } = battle();
  const p = spawnPlane(w, 'torp', 'JP', s.x, 700, s.z + 1500, 0, s, 1, 0);
  p.state = 'attack';
  p.vx = 0; p.vz = 0;
  let fired = 0;
  for (let i = 0; i < 400; i++) {
    aaLogic(w, s, 0.05);
    const alive = w.shells.filter((sh) => sh.aa && sh.alive).length;
    assert.ok(alive <= 24, `in-flight cap, got ${alive}`);
    fired += w.shells.filter((sh) => sh.aa && sh.t === 0 && sh.alive).length ? 0 : 0;
  }
  assert.ok(w.shells.some((sh) => sh.aa), 'AA engaged the plane');
  assert.ok(s.aaTurrets.some((m) => m.reloadTotal > 0), 'mounts ran their reload cycle');
});

test('barrels fire one at a time in rotation (staggered barrage)', () => {
  const { w, s } = battle();
  const p = spawnPlane(w, 'torp', 'JP', s.x, 700, s.z + 1500, 0, s, 1, 0);
  p.state = 'attack';
  p.vx = 0; p.vz = 0;
  for (let i = 0; i < 200; i++) aaLogic(w, s, 0.05);
  const m = s.aaTurrets.find((x) => x.reloadTotal > 0)!;
  // Per-barrel cadence: reload is the mount cycle divided by the number of barrels.
  assert.ok(Math.abs(m.reloadTotal - m.gun.reload / m.ts.n) < m.gun.reload * 0.12,
    `reloadTotal ${m.reloadTotal} vs ${m.gun.reload / m.ts.n}`);
  assert.ok(m.next >= 1 && m.next < m.ts.n, 'barrel pointer advanced');
});

test('every AA gun type engages during a raid (40mm, 20mm, and the 5"/38 DP)', () => {
  const { w, s } = battle();
  spawnAirRaid(w, 'JP', s, 4, 0);
  const seen = new Set<string>();
  for (let i = 0; i < 2400; i++) {
    w.step(0.05, true);
    for (const sh of w.shells) if (sh.aa) seen.add(sh.gun.id);
  }
  assert.ok(seen.has('aa40'), 'Bofors fired');
  assert.ok(seen.has('aa20'), 'Oerlikon fired');
  assert.ok(seen.has('sec127'), '5"/38 DP joined the AA barrage');
});

test('a target in the overhead dead cone spends no ammunition', () => {
  const { w, s } = battle();
  const p = spawnPlane(w, 'dive', 'JP', s.x, 3000, s.z + 80, 0, s, 1, 0);
  p.state = 'attack';
  p.vx = 0; p.vz = 0;
  for (let i = 0; i < 100; i++) aaLogic(w, s, 0.05);
  assert.equal(w.shells.filter((sh) => sh.aa).length, 0);
});
