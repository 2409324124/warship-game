import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEG } from '../src/sim/constants.ts';
import { GUNS, TS } from '../src/sim/guns.ts';
import { muzzleWorld, turretWorld } from '../src/sim/gunnery.ts';
import { deckY } from '../src/sim/hull.ts';
import { Ship } from '../src/sim/ship.ts';
import { SPECS } from '../src/sim/ships.ts';
import { World } from '../src/sim/world.ts';

interface Profile {
  length: number;
  beam: number;
  draft: number;
  deck: [number, number][];
}

const cases = [
  {
    key: 'us_dd', profile: 'fletcher', freeboard: 2.65, gun: 'us127', kind: 'us5s',
    mounts: [[40, 0, 0], [31, 2.6, 0], [-28, 2.8, 180], [-38, 1.2, 180], [-47, 0, 180]],
    shape: { len: 5.4, h: 2.8, w: 4, bl: 6.2, br: 0.17, n: 1, cf: 0.12, fs: 0.3, ss: 0.1, rs: 0.04, hood: 1 },
    combat: { kn: 36.5, turn: 6.2, rudderT: 1.5, accelT: 9, hp: 16000, tons: 2050,
      torp: 'mk15', torpMounts: 2, prefRange: 4200, aiErr: 70, dc: 2, cam: [300, 88], top: 12 },
    ballistics: { cal: 127, dmg: 430, reload: 3.2, range: 6000, v0: 850, arc: 0.075,
      fire: 0.05, trav: 28, disp: { along: 30, cross: 12, at: 6000 }, elevMin: -5, elevMax: 45 },
    bridgeZ: 22, bridgeFront: 28.5, bridgeTop: 7.23,
  },
  {
    key: 'jp_dd', profile: 'fubuki', freeboard: 2.35, gun: 'jp127', kind: 'jp5d',
    mounts: [[39, 0, 0], [-33, 2.2, 180], [-44, 0, 180]],
    shape: { len: 5.6, h: 2.7, w: 4.4, bl: 6, br: 0.16, n: 2, cf: 0.35, fs: 0.24, ss: 0.12, rs: 0.1 },
    combat: { kn: 38, turn: 6.3, rudderT: 1.6, accelT: 9, hp: 10500, tons: 1750,
      torp: 't93', torpMounts: 3, torpSalvo: 3, prefRange: 4200, aiErr: 80, dc: 1, cam: [300, 88], top: 12 },
    ballistics: { cal: 127, dmg: 400, reload: 5, range: 6200, v0: 840, arc: 0.075,
      fire: 0.05, trav: 14, disp: { along: 32, cross: 13, at: 6000 }, elevMin: -5, elevMax: 45 },
    bridgeZ: 26.5, bridgeFront: 31, bridgeTop: 5.3,
  },
];

function loadProfile(name: string): Profile {
  return JSON.parse(readFileSync(new URL(`../art/blender/${name}_profile.json`, import.meta.url), 'utf8'));
}

// Independent linear interpolation of the art contract, without using interpSheer/deckY.
function profileDeck(profile: Profile, z: number): number {
  const s = Math.max(0, Math.min(1, z / profile.length + 0.5));
  for (let i = 1; i < profile.deck.length; i++) {
    const [a, ya] = profile.deck[i - 1], [b, yb] = profile.deck[i];
    if (s <= b) return ya + (yb - ya) * (s - a) / (b - a);
  }
  return profile.deck.at(-1)![1];
}

function close(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual} != ${expected}`);
}

for (const c of cases) {
  test(`${c.key}: absolute metre deck matches profile knots, gun stations and dense samples`, () => {
    const spec = SPECS[c.key], profile = loadProfile(c.profile);
    assert.deepEqual([spec.L, spec.B, spec.D], [profile.length, profile.beam, profile.draft]);
    // F remains actual amidships freeboard; sheer stores dimensionless deck / F ratios.
    assert.equal(spec.F, c.freeboard);
    close(deckY(spec, 0), spec.F, 'amidships freeboard');
    assert.equal(spec.sheer.length, profile.deck.length);
    profile.deck.forEach(([station, metres], i) => {
      assert.equal(spec.sheer[i][0], station);
      close(spec.sheer[i][1], metres / c.freeboard, `sheer ratio at ${station}`);
      close(spec.F * spec.sheer[i][1], metres, `absolute deck ordinate at ${station}`);
    });
    const stations = [
      -spec.L, spec.L, // endpoint clamping
      ...c.mounts.map(([z]) => z),
      ...spec.parts.map(p => p.z),
      ...profile.deck.flatMap(([s]) => [-1e-6, 0, 1e-6].map(ds => (s + ds - 0.5) * spec.L)),
      ...Array.from({ length: 2001 }, (_, i) => (i / 2000 - 0.5) * spec.L),
    ];
    for (const z of stations) close(deckY(spec, z), profileDeck(profile, z), `deck at z=${z}`);
  });

  test(`${c.key}: deck-relative mounts, turret shape and combat / ballistic tuning stay fixed`, () => {
    const spec = SPECS[c.key];
    assert.deepEqual(spec.tur, c.mounts.map(([z, y, face]) => ({
      z, y, face: face * DEG, kind: c.kind, x: 0, sec: false,
    })));
    assert.deepEqual(TS[c.kind], c.shape);
    for (const [key, expected] of Object.entries(c.combat)) {
      assert.deepEqual(spec[key as keyof typeof spec], expected, key);
    }
    assert.equal(spec.gun, c.gun);
    assert.equal(spec.sec, undefined);
    assert.equal(spec.torpBudget, undefined);
    assert.equal(spec.torpSalvo, c.key === 'jp_dd' ? 3 : undefined);
    const gun = GUNS[c.gun];
    for (const [key, expected] of Object.entries(c.ballistics)) {
      assert.deepEqual(gun[key as keyof typeof gun], expected, key);
    }
    close(gun.g, 8 * c.ballistics.arc * c.ballistics.v0 ** 2 / c.ballistics.range, 'virtual gravity');
  });

  test(`${c.key}: live mount and every muzzle follow profile deck and shared TS trunnion convention`, () => {
    const profile = loadProfile(c.profile);
    const ship = new Ship(new World(), c.key, 'QA', 'Destroyer model QA', { x: 123, z: -456 });
    ship.bob = 0.37;
    for (const heading of [0, 0.73, -2.1]) {
      ship.heading = heading;
      for (const [i, turret] of ship.turrets.entries()) {
        const [z, y, face] = c.mounts[i];
        const baseY = profileDeck(profile, z) + y;
        close(turret.y, baseY, 'deck-relative mount height');
        assert.deepEqual(turretWorld(ship, turret), ship.toWorld(0, z));
        assert.equal(turret.ts, TS[c.kind]);
        assert.equal(turret.gun, GUNS[c.gun]);
        for (const yaw of [face * DEG, face * DEG + 0.6, face * DEG - 0.6]) {
          turret.rel = yaw;
          for (const degrees of [-5, 0, 15, 30, 45]) {
            const elevation = degrees * DEG;
            turret.elev = elevation;
            for (let k = 0; k < c.shape.n; k++) {
              // GLB mount origin -> yaw -> trunnion (0,h/2,len*.18) -> pitched barrel tip.
              const lateral = (k - (c.shape.n - 1) / 2) * c.shape.w * 0.28;
              const forward = c.shape.len * 0.18 + c.shape.bl * Math.cos(elevation);
              const lx = lateral * Math.cos(yaw) + forward * Math.sin(yaw);
              const lz = z - lateral * Math.sin(yaw) + forward * Math.cos(yaw);
              const [wx, wz] = ship.toWorld(lx, lz);
              const expected = [wx, ship.bob + baseY + c.shape.h / 2 + c.shape.bl * Math.sin(elevation), wz];
              const actual = muzzleWorld(ship, turret, k);
              actual.forEach((value, axis) => close(value, expected[axis], `mount ${i}, barrel ${k}, axis ${axis}`));
            }
          }
        }
      }
    }
  });

  test(`${c.key}: bridge eye clears the approved island, forward sightline and bow gun houses`, () => {
    const spec = SPECS[c.key], profile = loadProfile(c.profile);
    const [z, y] = spec.bridge!;
    assert.ok(z > c.bridgeFront && z < c.mounts[0][0], 'forward lookout, behind first gun');
    assert.ok(y > profileDeck(profile, z) + 1.7, 'eye above local deck');
    assert.ok(y > profileDeck(profile, c.bridgeZ) + c.bridgeTop + 0.5, 'clear bridge rails/optics');
    if (c.key === 'us_dd') {
      // The deck+10 Mk37 antenna remains behind the virtual lookout, not in its forward sightline.
      assert.ok(z > 22 - 1.45 + 1.25 + 1, 'forward of the director envelope');
    }
    for (const [gunZ, offset] of c.mounts.filter(([gunZ]) => gunZ > 0)) {
      assert.ok(y > profileDeck(profile, gunZ) + offset + c.shape.h + 0.5, 'clear bow gun house');
    }
  });
}
