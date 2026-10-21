// Target lock: what gets locked, how the guns follow her, when the lock gives out, and how the
// rangefinder converges.

import test from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../src/sim/world.ts';
import { Ship } from '../src/sim/ship.ts';
import { TargetLock } from '../src/sim/targetlock.ts';
import { leadPoint } from '../src/sim/ship.ts';
import { DEG } from '../src/sim/constants.ts';

function scene(): { w: World; me: Ship; a: Ship; b: Ship } {
  const w = new World({});
  const me = w.add(new Ship(w, 'us_bb', 'US', 'me', { heading: 0, speedFrac: 0.5 }));
  // two enemies: one dead ahead (north), one far off to the beam
  const a = w.add(new Ship(w, 'jp_dd', 'JP', 'ahead', { x: 0, z: 8000, heading: 0, speedFrac: 0 }));
  const b = w.add(new Ship(w, 'jp_dd', 'JP', 'abeam', { x: -8000, z: 0, heading: 0, speedFrac: 0 }));
  return { w, me, a, b };
}

test('locking picks the ship the crosshair is on', () => {
  const { me, a, b } = scene();
  const lock = new TargetLock();
  me.aimX = me.x;
  me.aimZ = me.z + 8000; // pointing due north
  assert.equal(lock.pick(me, 0, [me, a, b]), a, 'the one dead ahead wins');
  assert.equal(lock.pick(me, -Math.PI / 2, [me, a, b]), b, 'the one to starboard wins when you look there');
});

test('nothing outside the crosshair cone or beyond the guns is lockable', () => {
  const w = new World({});
  const me = w.add(new Ship(w, 'us_bb', 'US', 'me', { heading: 0 }));
  const far = w.add(new Ship(w, 'jp_dd', 'JP', 'far', { x: 0, z: 60000, heading: 0 }));
  const astern = w.add(new Ship(w, 'jp_dd', 'JP', 'astern', { x: 0, z: -5000, heading: 0 }));
  const lock = new TargetLock();
  assert.equal(lock.pick(me, 0, [me, far]), null, 'out of gun range');
  assert.equal(lock.pick(me, 0, [me, astern]), null, 'behind the crosshair cone');
});

test('the lock follows a moving target, and the trim rides on top', () => {
  const { w, me, a } = scene();
  const lock = new TargetLock();
  lock.lock(a);
  a.speed = 20;
  a.vx = 20; // sliding east (-x is starboard, but any motion will do)
  const s0 = lock.update(1 / 30, me, me.gun.range * 1.08)!;
  assert.ok(s0, 'a locked target must produce a solution');
  // the automatic part should be pointing at her lead point, not at where she is
  const [lx, lz] = leadPoint(me.x, me.z, a, me.gun);
  const leadBearing = Math.atan2(lx - me.x, lz - me.z);
  assert.ok(Math.abs(s0.baseYaw - leadBearing) < 1e-6, 'base bearing is the lead point');
  assert.ok(Math.abs(s0.leadX - lx) < 1e-6 && Math.abs(s0.leadZ - lz) < 1e-6);
  // trim shifts the solution without disturbing the automatic part
  lock.addTrim(0.02, 150);
  const s1 = lock.update(1 / 30, me, me.gun.range * 1.08)!;
  assert.ok(Math.abs(s1.yaw - (s1.baseYaw + 0.02)) < 1e-9, 'trim adds to the automatic bearing');
  assert.ok(Math.abs(s1.range - (s1.baseRange + 150)) < 1e-9, 'trim adds to the automatic range');
  void w;
});

test('the guns swing round as the target crosses', () => {
  const { me, a } = scene();
  const lock = new TargetLock();
  lock.lock(a);
  const first = lock.update(1 / 30, me, me.gun.range * 1.08)!.baseYaw;
  a.x = -6000; // she has run off to starboard
  a.z = 3000;
  const later = lock.update(1 / 30, me, me.gun.range * 1.08)!.baseYaw;
  assert.ok(Math.abs(later - first) > 0.2, 'the automatic solution must track her');
  const want = Math.atan2(a.x - me.x, a.z - me.z);
  assert.ok(Math.abs(later - want) < 0.5, 'and stay roughly on her bearing');
});

test('push the trim too far and the lock gives out', () => {
  const { me, a } = scene();
  const lock = new TargetLock();
  lock.lock(a);
  lock.update(1 / 30, me, me.gun.range * 1.08);
  lock.addTrim(3 * DEG, 0); // small nudge: still locked
  assert.ok(!lock.update(1 / 30, me, me.gun.range * 1.08)!.broke);
  assert.ok(lock.locked, 'a small trim keeps the lock');
  lock.addTrim(10 * DEG, 0); // now well past the 6 degree limit
  const s = lock.update(1 / 30, me, me.gun.range * 1.08);
  assert.ok(!s || s.broke, 'and a big one breaks it');
  assert.ok(!lock.locked);
});

test('a range trim past 12% of the range also breaks it', () => {
  const { me, a } = scene();
  const lock = new TargetLock();
  lock.lock(a);
  lock.update(1 / 30, me, me.gun.range * 1.08);
  lock.addTrim(0, 500);
  assert.ok(lock.locked, '500 m on an 8 km shot is fine');
  lock.addTrim(0, 4000);
  const s = lock.update(1 / 30, me, me.gun.range * 1.08);
  assert.ok(!s || s.broke);
});

test('the rangefinder tightens the longer you hold her', () => {
  const { me, a } = scene();
  const lock = new TargetLock();
  lock.lock(a);
  const errStart = lock.rangeError(10000);
  assert.ok(Math.abs(errStart - 800) < 1, `WT-strength start is 8% of range, got ${errStart}`);
  for (let i = 0; i < 60; i++) lock.update(1 / 30, me, me.gun.range * 1.08); // 2 s
  const err2 = lock.rangeError(10000);
  for (let i = 0; i < 240; i++) lock.update(1 / 30, me, me.gun.range * 1.08); // 10 s total
  const err10 = lock.rangeError(10000);
  assert.ok(err2 < errStart * 0.6, 'two seconds should already help');
  assert.ok(err10 < 100, `ten seconds should be under 100 m, got ${err10.toFixed(0)}`);
  assert.ok(err10 >= 60, 'but never perfectly: the rangefinder settles around 0.6%');
  assert.ok(lock.convergence() > 0.95, 'and reports converged');
});

test('losing her or switching targets resets the rangefinder', () => {
  const { me, a, b } = scene();
  const lock = new TargetLock();
  lock.lock(a);
  for (let i = 0; i < 300; i++) lock.update(1 / 30, me, me.gun.range * 1.08);
  assert.ok(lock.convergence() > 0.9);
  lock.lock(b); // change target
  assert.equal(lock.held, 0);
  assert.ok(lock.convergence() < 0.05, 'a new target means a new solution');
  assert.ok(Math.abs(lock.rangeError(10000) - 800) < 1);
  lock.unlock();
  assert.equal(lock.target, null);
  assert.equal(lock.update(1 / 30, me, 22000), null, 'no lock, no automatic solution');
});

test('cycle moves to the next lockable enemy', () => {
  const w = new World({});
  const me = w.add(new Ship(w, 'us_bb', 'US', 'me', { heading: 0 }));
  const a = w.add(new Ship(w, 'jp_dd', 'JP', 'a', { x: 0, z: 8000, heading: 0 }));
  const b = w.add(new Ship(w, 'jp_dd', 'JP', 'b', { x: -2000, z: 7000, heading: 0 }));
  const lock = new TargetLock();
  const list = [me, a, b];
  const first = lock.cycle(me, 0, list);
  assert.ok(first === a || first === b);
  const second = lock.cycle(me, 0, list);
  assert.notEqual(second, first, 'cycling must move');
});
