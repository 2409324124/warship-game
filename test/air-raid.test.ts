import assert from 'node:assert/strict';
import { test } from 'node:test';
import { World } from '../src/sim/world.ts';
import { Ship } from '../src/sim/ship.ts';
import { spawnAirRaid } from '../src/sim/aircraft.ts';

/** The sim draws from Math.random directly; pin it for the scenarios whose outcome is stochastic. */
function seeded(seed: number, body: () => void): void {
  const real = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  try {
    body();
  } finally {
    Math.random = real;
  }
}

function raid(diff = 'captain') {
  const events: string[] = [];
  const w = new World({ diff, onEvent: (e) => events.push(e.k) });
  const s = new Ship(w, 'us_bb', 'US', 'BB', { player: true });
  w.add(s);
  const planes = spawnAirRaid(w, 'JP', s, 4, 0);
  return { w, s, planes, events };
}

test('torpedo raids attack: drops happen and the ship takes damage', () => seeded(0x5eed, () => {
  const { w, s, events } = raid();
  let dropped = false;
  // Up to three waves: attack geometry is stochastic (AA kills some planes), so one
  // wave is not a reliable sample.
  for (let wave = 0; wave < 3; wave++) {
    spawnAirRaid(w, 'JP', s, 4, 0);
    for (let i = 0; i < 2000; i++) {
      w.step(0.05, true);
      if (w.torps.length > 0) {
        dropped = true;
        for (let j = 0; j < 1200 && s.hp === s.maxHp; j++) w.step(0.05, true);
        if (s.hp < s.maxHp) break;
      }
    }
    if (s.hp < s.maxHp) break;
  }
  assert.ok(dropped, 'a torpedo was dropped');
  assert.ok(events.includes('airRaid'));
  assert.ok(s.hp < s.maxHp, 'air-dropped torpedo damages the ship');
}));

test('AA engages: flak bursts fire and planes take damage', () => {
  const { w, planes, events } = raid();
  for (let i = 0; i < 1600; i++) w.step(0.05, true);
  assert.ok(events.includes('flak'), 'flak bursts were emitted');
  assert.ok(planes.some((p) => p.hp < p.maxHp || !p.alive), 'planes were hit');
});

test('without planes the AA system is silent', () => {
  const events: string[] = [];
  const w = new World({ onEvent: (e) => events.push(e.k) });
  const s = new Ship(w, 'us_bb', 'US', 'BB', { player: true });
  w.add(s);
  for (let i = 0; i < 200; i++) w.step(0.05, true);
  assert.equal(w.shells.length, 0);
  assert.equal(events.filter((k) => k === 'flak').length, 0);
});
