// The bow wave is only convincing if the particles leave the hull exactly where the plating meets
// the water, so the waterline sampling is worth pinning down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECS } from '../src/sim/ships.ts';
import { halfWL } from '../src/sim/hull.ts';
import { waterlinePoint, wakeRate } from '../src/render/spray.ts';

const BB = SPECS.us_bb;

test('the waterline point sits on the hull plan, not off it', () => {
  for (const s of [0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
    const p = waterlinePoint(BB, s, 1);
    assert.ok(Math.abs(p.lx - halfWL(s) * BB.B * 0.5) < 1e-9, `station ${s} half breadth`);
    assert.ok(Math.abs(p.lz - (s - 0.5) * BB.L) < 1e-9, `station ${s} longitudinal`);
  }
});

test('the port and starboard points are mirror images', () => {
  const a = waterlinePoint(BB, 0.8, 1);
  const b = waterlinePoint(BB, 0.8, -1);
  assert.ok(Math.abs(a.lx + b.lx) < 1e-9);
  assert.equal(a.lz, b.lz);
});

test('the normal points outboard, and leans forward at the bow', () => {
  for (const side of [1, -1] as const) {
    const mid = waterlinePoint(BB, 0.45, side);
    assert.ok(Math.sign(mid.nx) === side, 'midships normal should face away from the centreline');
    assert.ok(Math.abs(mid.nz) < 0.05, 'midships normal should be almost square to the hull');

    const bow = waterlinePoint(BB, 0.97, side);
    assert.ok(Math.sign(bow.nx) === side);
    assert.ok(bow.nz > 0.15, `bow normal should throw forward, got nz=${bow.nz.toFixed(3)}`);
  }
});

test('the normal is a unit vector', () => {
  for (const s of [0.05, 0.3, 0.6, 0.88, 0.97, 1]) {
    const p = waterlinePoint(BB, s, 1);
    assert.ok(Math.abs(Math.hypot(p.nx, p.nz) - 1) < 1e-9, `station ${s}`);
  }
});

test('a stopped hull makes no spray, and 30% speed already churns', () => {
  assert.equal(wakeRate(0), 0);
  assert.equal(wakeRate(0.02), 0);
  assert.ok(wakeRate(0.3) > 0.35, `30% speed gave ${wakeRate(0.3)}`);
  assert.equal(wakeRate(1), 1);
  assert.equal(wakeRate(2), 1, 'over-speed is clamped');
});

test('spray strength rises monotonically with speed', () => {
  let prev = -1;
  for (let spd = 0; spd <= 1.0001; spd += 0.1) {
    const k = wakeRate(spd);
    assert.ok(k >= prev, `not monotonic at ${spd.toFixed(1)}`);
    prev = k;
  }
});
