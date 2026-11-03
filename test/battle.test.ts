// End-to-end check that a battle actually happens: the destroyers close, the guns fire, shells
// land, torpedoes swim, and a battleship that aims properly can win. Runs the simulation layer
// alone - no DOM, no three.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../src/sim/world.ts';
import { Campaign, DUEL } from '../src/sim/campaign.ts';
import { AI } from '../src/sim/ai.ts';
import { playerFire } from '../src/sim/world.ts';
import { leadPoint, Ship } from '../src/sim/ship.ts';
import { flightTime } from '../src/sim/ballistics.ts';

interface Run {
  kills: number;
  minRange: number;
  playerShots: number;
  playerHits: number;
  torpsLaunched: number;
  torpHits: number;
  playerHpFrac: number;
  t: number;
  won: boolean | null;
}

/** Play one battle head-lessly: the player lays her guns on the nearest enemy and fires when loaded. */
function runBattle(seconds: number, diff: 'cadet' | 'captain' | 'admiral' = 'captain'): Run {
  const world = new World({ diff, foe: 'JP' });
  const camp = new Campaign(world, DUEL, 'us_bb', '华盛顿', 'BB-56');
  camp.begin();
  for (const s of world.ships) if (!s.isPlayer && !s.ai) s.ai = new AI(world, s);
  const P = camp.player;

  let minRange = Infinity;
  let torpsLaunched = 0;
  world.onEvent = (e) => {
    if (e.k === 'torpLaunch') torpsLaunched++;
  };

  const dt = 1 / 30;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps && !camp.finished; i++) {
    // a competent gunnery officer: lead the nearest target, fire the moment the guns bear
    let best = null as null | (typeof world.ships)[number],
      bd = Infinity;
    for (const s of world.ships) {
      if (!s.alive || s.team === P.team) continue;
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) {
      minRange = Math.min(minRange, bd);
      const [ax, az] = leadPoint(P.x, P.z, best, P.gun);
      P.aimX = ax;
      P.aimZ = az;
      if (P.mainTurrets.some((t) => t.reload <= 0 && t.onTarget)) playerFire(world, P, ax, az);
    }
    world.step(dt, true);
    camp.update(dt);
  }

  return {
    kills: camp.kills.length,
    minRange,
    playerShots: P.stats.shots,
    playerHits: P.stats.hits,
    torpsLaunched,
    torpHits: P.stats.taken > 0 ? -1 : 0,
    playerHpFrac: P.hp / P.maxHp,
    t: world.time,
    won: camp.finished ? camp.win : null,
  };
}

test('the destroyers close to gun range instead of loitering', () => {
  const r = runBattle(150);
  assert.ok(isFinite(r.minRange), 'they never got into range at all');
  assert.ok(r.minRange < 6500, `closest approach was ${Math.round(r.minRange)} m, expected under 6500`);
});

test('the player battleship can shoot, and shells connect', () => {
  const r = runBattle(180);
  assert.ok(r.playerShots > 20, `only ${r.playerShots} shells fired`);
  assert.ok(r.playerHits > 0, 'nothing hit in three minutes of shooting');
  const acc = r.playerHits / r.playerShots;
  assert.ok(acc > 0.02, `hit rate ${(acc * 100).toFixed(1)}% is too low for a well-led battleship`);
});

test('a destroyer inside torpedo range fires them', () => {
  // Reloads are long (150 s) and she has to close to about 5 km first, so waiting for it to happen
  // inside a full battle is flaky. Put her where the doctrine already applies and check the decision.
  // Open water: the origin is clear of every island, and so is a point 2.8 km due west of it.
  // (Put her near Savo and torpClear() rightly refuses to fire into the hillside.)
  const w = new World({ diff: 'captain', foe: 'JP' });
  const me = w.add(new Ship(w, 'us_bb', 'US', 'me', { x: 0, z: 0, heading: 0, speedFrac: 0.4 }));
  w.add(new Ship(w, 'jp_dd', 'JP', 'dd', { x: -2800, z: 0, heading: 0, speedFrac: 0.9 }));
  for (const s of w.ships) if (!s.isPlayer) s.ai = new AI(w, s);
  let launched = 0;
  w.onEvent = (e) => {
    if (e.k === 'torpLaunch') launched++;
  };
  for (let i = 0; i < 30 * 25; i++) w.step(1 / 30, true);
  assert.ok(launched > 0, 'she had a target abeam at 3.8 km and should have fired');
  assert.ok(me.alive, 'the battleship should survive one salvo');
});

test('a well-handled battleship sinks at least one destroyer', () => {
  const r = runBattle(300);
  assert.ok(r.kills >= 1, `no kills in five minutes: ${JSON.stringify(r)}`);
});

test('flight time is the promise: 10 km in 11 s', () => {
  const w = new World({});
  const camp = new Campaign(w, DUEL, 'us_bb', 'X', 'BB-56');
  const T = flightTime(camp.player.gun, 10000);
  assert.ok(Math.abs(T - 11) < 0.05, `${T}`);
});

test('harder difficulties make the enemy shoot straighter', () => {
  // A single unseeded battle is too noisy to compare: average three runs per difficulty.
  const avg = (d: 'cadet' | 'admiral') => {
    let sum = 0;
    for (let i = 0; i < 3; i++) sum += runBattle(150, d).playerHpFrac;
    return sum / 3;
  };
  const easy = avg('cadet');
  const hard = avg('admiral');
  assert.ok(hard <= easy + 0.02, `admiral ${hard.toFixed(3)} should hurt at least as much as cadet ${easy.toFixed(3)}`);
});
