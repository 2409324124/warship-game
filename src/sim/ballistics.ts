// Ballistics.
//
// A gun is described the way a gunnery officer would describe it: how far it throws, how flat the
// trajectory is, and how tight the pattern. Gravity is then derived so those three agree.
//
//   max range      R = v0^2 sin(2a) / g   (a = elevation)
//   apex height    H = R tan(a) / 4
//   flight time    T = R / v0              (to first order, which is what the sight uses)
//
// Writing `arc` for the apex-to-range ratio (H / R) gives tan(a) = 4*arc, and for the small angles a
// naval gun actually uses, sin(2a) ~ 2a = 8*arc, so
//
//   g = 8 * arc * v0^2 / range        and        T = distance / v0
//
// The second identity is the whole trick behind the tuning: **flight time is distance over muzzle
// velocity**. Ask for 10 km in 11 s and the muzzle velocity is simply 10000 / 11 = 909 m/s.
// The virtual gravity is not 9.81 - it is whatever makes the shell hang in the air long enough to
// watch, and it is per gun, so a 5" secondary can drop like a stone next to a 16" that floats.

import { clamp, DEG, randn } from './constants.ts';

export const MAIN_GUN_MAX_ELEVATION_DEG = 45;
export const DEFAULT_GUN_MIN_ELEVATION_DEG = -5;

export interface Dispersion {
  /** 1-sigma spread along the line of fire, in metres, at `at` metres. */
  along: number;
  /** 1-sigma spread across the line of fire, in metres, at `at` metres. */
  cross: number;
  /** Reference range the sigmas are quoted at. */
  at: number;
}

export interface GunSpec {
  id: string;
  cal: number; // mm
  label: string;
  dmg: number;
  reload: number; // seconds per turret
  range: number; // metres
  v0: number; // muzzle velocity, m/s (== range / flight time at max range)
  arc: number; // apex height / range
  /** Chance a hit starts a fire. */
  fire: number;
  /** Turret traverse, degrees per second. */
  trav: number;
  disp: Dispersion;
  /** Derived: virtual gravity for this gun, m/s^2. */
  g: number;
  /** Mechanical depression/elevation limits, degrees. */
  elevMin: number;
  elevMax: number;
}

export function makeGun(g: Omit<GunSpec, 'g' | 'elevMin' | 'elevMax'> & Partial<Pick<GunSpec, 'elevMin' | 'elevMax'>>): GunSpec {
  const gun = g as GunSpec;
  gun.elevMin ??= DEFAULT_GUN_MIN_ELEVATION_DEG;
  gun.elevMax ??= MAIN_GUN_MAX_ELEVATION_DEG;
  if (!Number.isFinite(gun.elevMin) || !Number.isFinite(gun.elevMax) || gun.elevMin > gun.elevMax) {
    throw new RangeError(`Invalid elevation limits for ${gun.id}`);
  }
  gun.g = (8 * gun.arc * gun.v0 * gun.v0) / gun.range;
  return gun;
}

/** Flight time in seconds for `d` metres. Clamped at the gun's reach. */
export function flightTime(gun: GunSpec, d: number): number {
  return Math.max(0.2, Math.min(d, gun.range) / gun.v0);
}

/**
 * 1-sigma dispersion at `d` metres. The pattern tightens up as you close the range but never
 * disappears. Primary guns have a smaller close-range floor and a steeper long-range penalty.
 * Secondary tuning is deliberately retained.
 */
export function sigmaAt(gun: GunSpec, d: number): { along: number; cross: number } {
  const distance = Number.isNaN(d) ? 0 : clamp(d,0,gun.range);
  if (!gun.id.startsWith('sec')) {
    const k = .12 + .88 * (distance / gun.disp.at) ** 1.25;
    return { along: gun.disp.along*k, cross: gun.disp.cross*k };
  }
  const f = (r: number) => 0.35 + 0.65 * (Math.min(r, gun.range) / gun.range);
  const k = f(distance) / f(gun.disp.at);
  return { along: gun.disp.along * k, cross: gun.disp.cross * k };
}

/** Shared effective pattern used by the shot sampler, sea projection and debug estimate. */
export function dispersionAt(gun: GunSpec, d: number, err = 0): { along: number; cross: number } {
  const s = sigmaAt(gun,d), e = Number.isFinite(err) ? Math.max(0,err) : 0;
  return { along: Math.hypot(s.along,e), cross: Math.hypot(s.cross,e*.5) };
}

/**
 * Scatter one aiming point. `err` is the extra 1-sigma aiming error (metres) from a bad solution,
 * an evading target or a green crew; 0 for the player's carefully laid guns.
 */
export function scatterPoint(
  gun: GunSpec,
  mx: number,
  mz: number,
  tx: number,
  tz: number,
  err = 0,
): [number, number] {
  let dx = tx - mx,
    dz = tz - mz;
  let d = Math.hypot(dx, dz) || 1;
  const ux = dx / d,
    uz = dz / d;
  if (d > gun.range) d = gun.range;
  const s = dispersionAt(gun, d, err);
  let a = randn(), c = randn();
  if (!gun.id.startsWith('sec')) {
    // A centre-biased ellipse with bounded tails, rather than rare screen-wide outliers.
    for (let i=0; i<12 && a*a+c*c>6.25; i++) { a=randn(); c=randn(); }
    const radius = Math.hypot(a,c);
    if (radius>2.5) { a*=2.5/radius; c*=2.5/radius; }
  }
  const along = a*s.along;
  const cross = c*s.cross;
  return [tx + ux * along - uz * cross, tz + uz * along + ux * cross];
}

export interface Shot {
  /** Horizontal travel time to the target point, seconds. */
  T: number;
  /** Muzzle velocity components, m/s. */
  vx: number;
  vy: number;
  vz: number;
  /** Barrel elevation, radians. */
  elev: number;
  /** False when the requested trajectory exceeds the mount's mechanical limits. */
  reachable: boolean;
}

export function clampElevation(gun: GunSpec, radians: number): number {
  return clamp(radians, gun.elevMin * DEG, gun.elevMax * DEG);
}

/**
 * Lay a gun on a sea-level point: pick the elevation that puts the shell exactly there at T = d / v0.
 * `y0` is the muzzle height above the sea.
 */
export function solveShot(gun: GunSpec, mx: number, my: number, mz: number, tx: number, tz: number): Shot {
  let dx = tx - mx,
    dz = tz - mz;
  const d = Math.hypot(dx, dz) || 1;
  const reach = Math.min(d, gun.range);
  const ux = dx / d,
    uz = dz / d;
  const px = mx + ux * reach,
    pz = mz + uz * reach;
  const T = Math.max(0.2, reach / gun.v0);
  const vx = (px - mx) / T,
    vz = (pz - mz) / T;
  const wantedVy = (-my + 0.5 * gun.g * T * T) / T;
  const horizontal = Math.hypot(vx, vz);
  const wanted = Math.atan2(wantedVy, horizontal);
  const elev = clampElevation(gun, wanted);
  const reachable = Math.abs(wanted - elev) < 1e-9;
  const vy = reachable ? wantedVy : horizontal * Math.tan(elev);
  return { T, vx, vy, vz, elev, reachable };
}

/** Where the shell is after `t` seconds. */
export function shellAt(s: { x0: number; y0: number; z0: number; vx: number; vy: number; vz: number; g: number }, t: number) {
  return {
    x: s.x0 + s.vx * t,
    y: s.y0 + s.vy * t - 0.5 * s.g * t * t,
    z: s.z0 + s.vz * t,
  };
}

/** Elevation the sight should show for a range, used to draw the barrel and the range drum. */
export function elevationFor(gun: GunSpec, d: number, y0 = 0): number {
  const T = flightTime(gun, d);
  const vy = (-y0 + 0.5 * gun.g * T * T) / T;
  return clampElevation(gun, Math.atan2(vy, gun.v0));
}

/**
 * Rough chance that a full broadside lands at least one shell on a target of the given length and
 * beam at `d` metres, with `n` shells. Used by the debug panel and the AI's target choice.
 */
export function hitChance(gun: GunSpec, d: number, length: number, beam: number, n: number, err = 0): number {
  const s = dispersionAt(gun, d,err);
  const sa = s.along;
  const sc = s.cross;
  const pa = erfWindow(length / 2, sa);
  const pc = erfWindow(beam / 2, sc);
  return 1 - Math.pow(1 - pa * pc, Math.max(1, n));
}

// P(|X| < h) for X ~ N(0, sigma), via the Abramowitz-Stegun 7.1.26 approximation.
function erfWindow(h: number, sigma: number): number {
  const x = h / (sigma * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return y;
}
