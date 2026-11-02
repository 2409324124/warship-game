// Gun, torpedo and turret-house tables.
//
// Muzzle velocities are chosen from the flight time we want, not from a ballistics table: T = d / v0.
// The 16"/45 sits at 909 m/s because 10000 / 909 = 11.0 s, the number this game is built around.

import { makeGun, MAIN_GUN_MAX_ELEVATION_DEG, type GunSpec } from './ballistics.ts';

export const GUNS: Record<string, GunSpec> = {
  // ---- United States -----------------------------------------------------
  us406: makeGun({
    id: 'us406',
    cal: 406,
    label: '16"/45',
    dmg: 4400,
    reload: 30,
    range: 22000,
    v0: 909, // 10 km in 11.0 s
    arc: 0.1,
    fire: 0.2,
    trav: 5,
    disp: { along: 56, cross: 22, at: 10000 },
  }),
  us203: makeGun({
    id: 'us203',
    cal: 203,
    label: '8"/55',
    dmg: 1350,
    reload: 8,
    range: 12000,
    v0: 880,
    arc: 0.1,
    fire: 0.1,
    trav: 9,
    disp: { along: 46, cross: 18, at: 10000 },
  }),
  us127: makeGun({
    id: 'us127',
    cal: 127,
    label: '5"/38',
    dmg: 430,
    reload: 3.2,
    range: 6000,
    v0: 850,
    arc: 0.075,
    fire: 0.05,
    trav: 28,
    disp: { along: 30, cross: 12, at: 6000 },
  }),
  sec127: makeGun({
    id: 'sec127',
    cal: 127,
    label: '5"/38 DP',
    dmg: 260,
    reload: 4.5,
    range: 5000,
    v0: 830,
    arc: 60 * 5000 / (8 * 830 * 830),
    fire: 0.03,
    trav: 20,
    elevMax: 80,
    aa: true,
    fuze: 'airburst',
    aaDmg: 45,
    disp: { along: 55, cross: 24, at: 5000 },
  }),

  // ---- Japan -------------------------------------------------------------
  jp356: makeGun({
    id: 'jp356',
    cal: 356,
    label: '35.6cm',
    dmg: 3600,
    reload: 26,
    range: 20000,
    v0: 890, // 10 km in 11.2 s
    arc: 0.11,
    fire: 0.18,
    trav: 5,
    elevMax: MAIN_GUN_MAX_ELEVATION_DEG,
    disp: { along: 60, cross: 24, at: 10000 },
  }),
  jp203: makeGun({
    id: 'jp203',
    cal: 203,
    label: '20.3cm',
    dmg: 1350,
    reload: 12,
    range: 12500,
    v0: 870,
    arc: 0.1,
    fire: 0.1,
    trav: 8,
    disp: { along: 49, cross: 20, at: 10000 },
  }),
  jp127: makeGun({
    id: 'jp127',
    cal: 127,
    label: '12.7cm',
    dmg: 400,
    reload: 5,
    range: 6200,
    v0: 840,
    arc: 0.075,
    fire: 0.05,
    trav: 14,
    disp: { along: 32, cross: 13, at: 6000 },
  }),
  sec152: makeGun({
    id: 'sec152',
    cal: 152,
    label: '15.2cm',
    dmg: 330,
    reload: 6,
    range: 5200,
    v0: 840,
    arc: 0.08,
    fire: 0.04,
    trav: 15,
    elevMax: 20,
    disp: { along: 58, cross: 25, at: 5000 },
  }),

  // ---- Anti-air ----------------------------------------------------------
  // dmg is per-aircraft damage. airburst fuzes throw a flak cloud at the intercept
  // point; impact fuzes only count direct hits. Dispersion is the main balance knob.
  // AA arcs are tuned so the derived virtual gravity is ~60 m/s^2: with the game's 2.5x
  // time compression that is realistic gravity, and tracers fly like flak, not mortars.
  aa40: makeGun({
    id: 'aa40', cal: 40, label: '40mm Bofors', dmg: 38, reload: 1.2,
    range: 2800, v0: 880, arc: 60 * 2800 / (8 * 880 * 880), fire: 0, trav: 45, elevMax: 85,
    aa: true, fuze: 'airburst',
    disp: { along: 24, cross: 24, at: 2000 },
  }),
  aa20: makeGun({
    id: 'aa20', cal: 20, label: '20mm Oerlikon', dmg: 10, reload: 0.4,
    range: 1800, v0: 830, arc: 60 * 1800 / (8 * 830 * 830), fire: 0, trav: 60, elevMax: 85,
    aa: true, fuze: 'impact',
    disp: { along: 38, cross: 38, at: 1200 },
  }),
  aa25: makeGun({
    id: 'aa25', cal: 25, label: '25mm 96式', dmg: 15, reload: 0.55,
    range: 1800, v0: 800, arc: 60 * 1800 / (8 * 800 * 800), fire: 0, trav: 40, elevMax: 80,
    aa: true, fuze: 'impact',
    disp: { along: 34, cross: 34, at: 1500 },
  }),
  aah127: makeGun({
    id: 'aah127', cal: 127, label: '12.7cm 89式', dmg: 90, reload: 4.0,
    range: 5200, v0: 830, arc: 60 * 5200 / (8 * 830 * 830), fire: 0, trav: 18, elevMax: 85,
    aa: true, fuze: 'airburst',
    disp: { along: 40, cross: 40, at: 4000 },
  }),
};

/** Dropped bomb: no gun, just a ballistic body with a heavy punch. Owner is the aircraft. */
export const BOMB: GunSpec = {
  id: 'bomb250', cal: 250, label: '250kg bomb', dmg: 1800,
  reload: 0, range: 4000, v0: 300, arc: 0.2, fire: 0.35, trav: 0,
  disp: { along: 40, cross: 40, at: 2000 },
  g: 22, elevMin: -90, elevMax: 90,
};

// --------------------------------------------------------------------------- torpedoes

export interface TorpSpec {
  id: string;
  label: string;
  speed: number; // m/s in game time
  range: number; // metres of run
  dmg: number;
  reload: number; // per mount
  salvo: number; // tubes per mount
  spread: number; // degrees between tubes
  /** How far away the wake can be spotted. */
  visR: number;
}

export const TORPS: Record<string, TorpSpec> = {
  // Reloads are long on purpose. A destroyer carries her tubes plus about one set of spare fish,
  // and once they are gone she is just a gunboat - so the reload is measured in minutes, and the
  // Ship keeps a budget of how many are left in the racks.
  mk15: {
    id: 'mk15',
    label: 'Mk15',
    speed: 62,
    range: 5000,
    dmg: 6500,
    reload: 110,
    salvo: 5,
    spread: 3.0,
    visR: 1e9,
  },
  airTorp: {
    id: 'airTorp',
    label: '航空魚雷',
    speed: 45,
    range: 1800,
    dmg: 5200,
    reload: 0,
    salvo: 1,
    spread: 0,
    visR: 2200,
  },
  t93: {
    id: 't93',
    label: '93式 酸素魚雷',
    speed: 68,
    range: 7000,
    dmg: 8200,
    reload: 150,
    salvo: 3,
    spread: 3.5,
    visR: 2600,
  },
};

// --------------------------------------------------------------------------- turret houses
// cf front-corner chamfer, fs/rs front/rear slope, ss side slope, rr rounded rear, hood sight hoods,
// ears rangefinder ears. len/h/w are the house, bl/br the barrel length and radius, n guns per house.
export interface TurretShape {
  len: number;
  h: number;
  w: number;
  bl: number;
  br: number;
  n: number;
  cf: number;
  fs: number;
  ss: number;
  rs: number;
  hood?: number;
  ears?: number;
  rr?: number;
  /** Traverse either side of the home bearing, degrees; overrides the class default. */
  traverseArc?: number;
}

export const TS: Record<string, TurretShape> = {
  us5s: { len: 5.4, h: 2.8, w: 4.0, bl: 6.2, br: 0.17, n: 1, cf: 0.12, fs: 0.3, ss: 0.1, rs: 0.04, hood: 1 },
  us5d: { len: 4.6, h: 2.3, w: 3.8, bl: 5.6, br: 0.15, n: 2, cf: 0.12, fs: 0.28, ss: 0.1, rs: 0.04, hood: 1 },
  us6t: { len: 9.5, h: 3.2, w: 7.4, bl: 9.5, br: 0.34, n: 3, cf: 0.16, fs: 0.2, ss: 0.08, rs: 0.02, ears: 1 },
  us8t: { len: 11, h: 3.4, w: 8.8, bl: 11.5, br: 0.4, n: 3, cf: 0.18, fs: 0.24, ss: 0.09, rs: 0.02, ears: 1 },
  us16t: { len: 16, h: 5.2, w: 13, bl: 18, br: 0.8, n: 3, cf: 0.2, fs: 0.24, ss: 0.12, rs: 0.02, ears: 1 },
  jp5d: { len: 5.6, h: 2.7, w: 4.4, bl: 6.0, br: 0.16, n: 2, cf: 0.35, fs: 0.24, ss: 0.12, rs: 0.1 },
  jp5s: { len: 4.4, h: 2.5, w: 3.2, bl: 6.0, br: 0.16, n: 1, cf: 0.35, fs: 0.24, ss: 0.12, rs: 0.1 },
  jp55: { len: 4.6, h: 2.4, w: 3.2, bl: 7.0, br: 0.18, n: 1, cf: 0.45, fs: 0.22, ss: 0.16, rs: 0.05 },
  jp8d: { len: 8.2, h: 3.3, w: 7.0, bl: 10, br: 0.38, n: 2, cf: 0.45, fs: 0.22, ss: 0.16, rs: 0.06 },
  jp14d: { len: 13, h: 4.4, w: 10.5, bl: 15, br: 0.62, n: 2, cf: 0.3, fs: 0.2, ss: 0.1, rs: 0.06, rr: 0.35, ears: 1 },
  jp6c: { len: 2.6, h: 1.6, w: 2.2, bl: 5, br: 0.16, n: 1, cf: 0.3, fs: 0.2, ss: 0.1, rs: 0.08, traverseArc: 35 },
  // AA mount shapes: only used to place muzzles, the visible mounts stay in the merged hull mesh.
  aa40: { len: 1.6, h: 1.3, w: 2.2, bl: 2.2, br: 0.05, n: 4, cf: 0.1, fs: 0.1, ss: 0.1, rs: 0.1 },
  aa20: { len: 1.1, h: 1.0, w: 1.1, bl: 1.8, br: 0.028, n: 1, cf: 0.1, fs: 0.1, ss: 0.1, rs: 0.1 },
  aa25: { len: 1.4, h: 1.1, w: 1.8, bl: 2.0, br: 0.032, n: 3, cf: 0.1, fs: 0.1, ss: 0.1, rs: 0.1 },
  aah127: { len: 3.6, h: 2.2, w: 3.2, bl: 5.0, br: 0.13, n: 2, cf: 0.2, fs: 0.15, ss: 0.1, rs: 0.1 },
};
