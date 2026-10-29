// Head-less checks on the gunnery maths. Run with: npm test
// These numbers are the promises the game makes: 10 km in 11 s, and a pattern you can read.

import test from 'node:test';
import assert from 'node:assert/strict';

import { GUNS } from '../src/sim/guns.ts';
import { flightTime, sigmaAt, hitChance, solveShot, makeGun } from '../src/sim/ballistics.ts';

test('16"/45 puts a shell over 10 km in 11.0 s', () => {
  const g = GUNS.us406;
  const T = flightTime(g, 10000);
  assert.ok(Math.abs(T - 11.0) < 0.05, `expected ~11.0 s, got ${T.toFixed(3)}`);
});

test('flight time is distance over muzzle velocity, clamped at the reach', () => {
  const g = GUNS.us406;
  assert.ok(Math.abs(flightTime(g, 5000) - 5.5) < 0.01);
  assert.ok(Math.abs(flightTime(g, 999999) - 22000 / 909) < 0.01);
});

test('virtual gravity follows from the arc, the reach and the muzzle velocity', () => {
  const g = makeGun({ id: 'x', cal: 100, label: 'x', dmg: 1, reload: 1, range: 8000, v0: 800, arc: 0.1, fire: 0, trav: 10, disp: { along: 10, cross: 5, at: 8000 } });
  assert.ok(Math.abs(g.g - (8 * 0.1 * 800 * 800) / 8000) < 1e-9);
});

test('the solved shell lands where it was aimed, at the right time', () => {
  const g = GUNS.us406;
  const shot = solveShot(g, 0, 12, 0, 7000, 9000);
  const d = Math.hypot(7000, 9000);
  const T = flightTime(g, d);
  const x = shot.vx * shot.T;
  const z = shot.vz * shot.T;
  assert.ok(Math.hypot(x - 7000, z - 9000) < 1, 'shell must arrive at the aim point');
  const y = 12 + shot.vy * shot.T - 0.5 * g.g * shot.T * shot.T;
  assert.ok(Math.abs(y) < 1, `shell must arrive at sea level, got ${y.toFixed(2)} m`);
  assert.ok(Math.abs(shot.T - T) < 1e-6);
});

test('dispersion tightens as the range closes, and the 10 km pattern is the one we promised', () => {
  const g = GUNS.us406;
  const s10 = sigmaAt(g, 10000);
  assert.ok(Math.abs(s10.along - 56) < 0.5, `along sigma at 10 km: ${s10.along.toFixed(1)}`);
  assert.ok(Math.abs(s10.cross - 22) < 0.5, `cross sigma at 10 km: ${s10.cross.toFixed(1)}`);
  assert.ok(sigmaAt(g, 4000).along < s10.along, 'closer range must be tighter');
  assert.ok(sigmaAt(g, 2000).along > sigmaAt(g, 2000).cross, 'the pattern is longer than it is wide');
});

test('a full nine-gun broadside is a real threat at 8 km and a lottery at 20 km', () => {
  const g = GUNS.us406;
  const near = hitChance(g, 8000, 118, 10.4, 9);
  const far = hitChance(g, 20000, 118, 10.4, 9);
  assert.ok(near > 0.25, `8 km: ${near.toFixed(3)}`);
  assert.ok(far < near * 0.5, `20 km should be much worse: ${far.toFixed(3)}`);
});

test('the secondary battery is short ranged and fast', () => {
  const s = GUNS.sec127;
  assert.equal(s.range, 5000);
  assert.ok(Math.abs(flightTime(s, 5000) - 5000 / 830) < 0.01);
  assert.ok(sigmaAt(s, 5000).along <= 56);
});
