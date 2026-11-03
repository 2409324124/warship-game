// Impact feedback depends on two things the simulation owes the renderer: where a shell struck the
// hull in hull-local coordinates, and where that puts the crater on the hull surface.

import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.ts';
import { Ship } from '../src/sim/ship.ts';
import { shellHit } from '../src/sim/gunnery.ts';
import type { Shell } from '../src/sim/gunnery.ts';
import { SPECS } from '../src/sim/ships.ts';
import { craterPlacement } from '../src/render/decals.ts';
import { deckY, halfW } from '../src/sim/hull.ts';

function strikeAt(x: number, y: number, z: number) {
  const w = new World({ diff: 'captain' });
  const target = w.add(new Ship(w, 'jp_bb', 'JP', 'target', { x: 0, z: 0, heading: 0, speedFrac: 0 }));
  let hit: Record<string, unknown> | null = null;
  w.onEvent = (e) => {
    if (e.k === 'hit') hit = e as unknown as Record<string, unknown>;
  };
  const shell = { gun: target.gun, owner: null, sec: false, salvo: 1 } as unknown as Shell;
  shellHit(w, target, shell, x, y, z);
  assert.ok(hit, 'the shell was reported as a miss');
  return { hit: hit!, target };
}

test('a hit reports the strike point in hull-local coordinates', () => {
  const { hit } = strikeAt(3, 8, 10);
  assert.equal(hit.lx, 3);
  assert.equal(hit.lz, 10);
  assert.equal(hit.ly, 8);
});

test('the local strike point stays inside the hull envelope however she is lying', () => {
  const w = new World({ diff: 'captain' });
  const target = w.add(new Ship(w, 'jp_bb', 'JP', 'target', { x: 420, z: -260, heading: 1.1, speedFrac: 0 }));
  const [wx, wz] = target.toWorld(6, -30);
  let hit: Record<string, unknown> | null = null;
  w.onEvent = (e) => {
    if (e.k === 'hit') hit = e as unknown as Record<string, unknown>;
  };
  const shell = { gun: target.gun, owner: null, sec: false, salvo: 1 } as unknown as Shell;
  shellHit(w, target, shell, wx, 4, wz);
  const h = hit! as { lx: number; ly: number; lz: number };
  assert.ok(Math.abs(h.lx - 6) < 1e-6, `lx was ${h.lx}`);
  assert.ok(Math.abs(h.lz + 30) < 1e-6, `lz was ${h.lz}`);
  assert.ok(h.ly > -2 && h.ly < target.spec.F + target.spec.top, `ly was ${h.ly}`);
});

test('a shell landing on the deck puts a flat crater on the planking', () => {
  const spec = SPECS.jp_bb;
  const c = craterPlacement(spec, 2, spec.F * 0.95, 0, 406);
  assert.equal(c.ny, 1);
  assert.equal(c.nx, 0);
  assert.ok(Math.abs(c.y - (deckY(spec, 0) + 0.25)) < 1e-6);
});

test('a shell into the side sits just outside the plating, facing outboard', () => {
  const spec = SPECS.jp_bb;
  const right = craterPlacement(spec, 9, 2, 0, 406);
  assert.equal(right.nx, 1);
  assert.ok(Math.abs(right.x - ((spec.B / 2) * halfW(0.5) + 0.15)) < 1e-6);
  const left = craterPlacement(spec, -9, 2, 0, 406);
  assert.equal(left.nx, -1);
  assert.ok(left.x < 0);
});

test('a deck crater is kept aboard instead of hanging over the side', () => {
  const spec = SPECS.jp_bb;
  const c = craterPlacement(spec, 500, spec.F * 0.95, 0, 200);
  assert.ok(Math.abs(c.x) <= spec.B * 0.4 + 1e-6);
});

test('bigger shells leave bigger holes', () => {
  const spec = SPECS.us_bb;
  const small = craterPlacement(spec, 0, 3, 0, 127);
  const big = craterPlacement(spec, 0, 3, 0, 406);
  assert.ok(big.size > small.size, `${big.size} should exceed ${small.size}`);
});
