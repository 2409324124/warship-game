import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUNS } from '../src/sim/guns.ts';
import { shellAt, solveAA } from '../src/sim/ballistics.ts';

const gun = GUNS.aa40;
const at = (s: { vx: number; vy: number; vz: number }, T: number, m = [0, 10, 0]) =>
  shellAt({ x0: m[0], y0: m[1], z0: m[2], vx: s.vx, vy: s.vy, vz: s.vz, g: gun.g }, T);

test('static air target is hit dead on', () => {
  const shot = solveAA(gun, 0, 10, 0, 0, 1500, 2000);
  assert.ok(shot.reachable);
  const p = at(shot, shot.T);
  assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y - 1500) < 1 && Math.abs(p.z - 2000) < 1, JSON.stringify(p));
  assert.ok(shot.elev > 0.2 && shot.elev < 1.2, String(shot.elev));
});

test('crossing target is led correctly', () => {
  const v = 100;
  const shot = solveAA(gun, 0, 10, 0, 0, 1200, 1800, -v, 0, 0);
  assert.ok(shot.reachable);
  const p = at(shot, shot.T);
  // The shell meets the plane where the plane will be, not where it is now.
  assert.ok(Math.abs(p.x - -v * shot.T) < 2, `x ${p.x} vs ${-v * shot.T}`);
  assert.ok(Math.abs(p.y - 1200) < 2 && Math.abs(p.z - 1800) < 2);
});

test('near-overhead target breaches the elevation limit and stays unreachable', () => {
  const shot = solveAA(gun, 0, 10, 0, 40, 2000, 0);
  assert.equal(shot.reachable, false);
  assert.ok(shot.elev <= (85 * Math.PI) / 180 + 1e-9);
});

test('beyond range is unreachable', () => {
  const shot = solveAA(gun, 0, 10, 0, 0, 300, 9000);
  assert.equal(shot.reachable, false);
});
