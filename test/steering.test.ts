// Steering and heading conventions.
//
// These exist because the sign is genuinely counter-intuitive. `heading` is a mathematical bearing,
// atan2(x, z), and in a right-handed world with +y up the +x axis is WEST - so the bearing grows
// anticlockwise on a north-up chart and *increasing* it swings the bow to port. Everything the
// player touches (A/D, the compass readout, the chart) has to agree that starboard is right.

import test from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../src/sim/world.ts';
import { Ship } from '../src/sim/ship.ts';
import { AI } from '../src/sim/ai.ts';
import { SPECS } from '../src/sim/ships.ts';
import { angDiff, DEG } from '../src/sim/constants.ts';

const forward = (h: number) => [Math.sin(h), Math.cos(h)] as [number, number];
/** The ship's starboard: the camera's screen-right when you stand behind her. cross(up, -forward). */
const starboard = (h: number): [number, number] => [-Math.cos(h), Math.sin(h)];
/** True compass bearing: 0 north, 90 east. East is -x in this world. */
const compass = (h: number) => (((-h * 180) / Math.PI) % 360 + 360) % 360;

function shipAt(h: number): { w: World; s: Ship } {
  const w = new World({});
  const s = w.add(new Ship(w, 'us_bb', 'US', 'test', { heading: h, speedFrac: 0.8 }));
  return { w, s };
}

test('starboard is -x when she points north', () => {
  const [, fz] = forward(0);
  assert.ok(fz > 0.99, 'facing north means forward is +z');
  const [sx] = starboard(0);
  assert.ok(sx < -0.99, 'starboard must be -x');
});

test('right rudder swings the bow to starboard', () => {
  const { w, s } = shipAt(0);
  s.rudderCmd = 1; // starboard
  const before = forward(s.heading);
  for (let i = 0; i < 150; i++) w.step(1 / 30, false);
  const after = forward(s.heading);
  // project the new heading onto the old starboard axis: it must come out positive
  const sb = starboard(0);
  const moved = (after[0] - before[0]) * sb[0] + (after[1] - before[1]) * sb[1];
  assert.ok(moved > 0.05, `bow moved ${moved.toFixed(3)} along starboard, expected > 0`);
  assert.ok(s.heading < 0, 'starboard is a decreasing bearing');
});

test('left rudder swings the bow to port', () => {
  const { w, s } = shipAt(0);
  s.rudderCmd = -1;
  const before = forward(s.heading);
  for (let i = 0; i < 150; i++) w.step(1 / 30, false);
  const after = forward(s.heading);
  const sb = starboard(0);
  const moved = (after[0] - before[0]) * sb[0] + (after[1] - before[1]) * sb[1];
  assert.ok(moved < -0.05, `bow moved ${moved.toFixed(3)} along starboard, expected < 0`);
});

test('the compass readout grows when she turns to starboard', () => {
  assert.equal(Math.round(compass(0)), 0, 'north is 000');
  const { w, s } = shipAt(0);
  s.rudderCmd = 1;
  for (let i = 0; i < 150; i++) w.step(1 / 30, false);
  const c = compass(s.heading);
  assert.ok(c > 5 && c < 175, `after right rudder the compass must read east-ish, got ${c.toFixed(1)}`);
});

test('the AI settles onto a firing course instead of spinning', () => {
  // A destroyer wants her target abeam, not dead ahead, so the thing to check is that her helm
  // converges. With the rudder sign the wrong way round this feedback loop runs away and she
  // never stops turning.
  const w = new World({});
  const s = w.add(new Ship(w, 'us_dd', 'JP', 'ai', { heading: 0, speedFrac: 0.8 }));
  const t = w.add(new Ship(w, 'us_bb', 'US', 'target', { x: -9000, z: 0, heading: 0 }));
  s.ai = new AI(w, s);
  s.ai.wander = false; // deterministic: no random broadside swaps
  s.ai.side = 1; // and pick the engagement side, so she is not mid-way through a 145 degree swing
  for (let i = 0; i < 360; i++) w.step(1 / 30, true); // 12 s to settle
  const h0 = s.heading;
  for (let i = 0; i < 90; i++) w.step(1 / 30, true); // then watch for 3 s
  const drift = Math.abs(angDiff(h0, s.heading));
  assert.ok(drift < 0.3, `helm should hold a course, but she moved ${(drift / DEG).toFixed(0)}deg in 3 s`);
  // and she should have brought her broadside to bear rather than chasing her own stern
  const rel = Math.abs(angDiff(s.heading, Math.atan2(t.x - s.x, t.z - s.z)));
  assert.ok(rel > 0.5 && rel < 2.7, `target should be on the beam, relative bearing ${(rel / DEG).toFixed(0)}deg`);
});

test('toWorld puts +lz ahead of her and the beam where it belongs', () => {
  const { s } = shipAt(0);
  const [ax, az] = s.toWorld(0, 100);
  assert.ok(az > 99 && Math.abs(ax) < 1e-9, 'local +z is forward');
  const [bx] = s.toWorld(10, 0);
  assert.ok(bx > 0, 'local +x is +x in world at heading 0');
  // and +x is port, because starboard is -x
  assert.ok(starboard(0)[0] < 0);
});

test('every ship turns the same way for the same rudder', () => {
  for (const key of Object.keys(SPECS)) {
    const w = new World({});
    const s = w.add(new Ship(w, key, 'US', 't', { heading: 0, speedFrac: 0.8 }));
    s.rudderCmd = 1;
    for (let i = 0; i < 60; i++) w.step(1 / 30, false);
    assert.ok(s.heading < 0, `${key}: right rudder must decrease heading`);
  }
});
