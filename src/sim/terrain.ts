// Terrain: a handful of islands, defined by a radius, a height and a noise seed.
// The same function feeds the collision test, the shell's "is my line of fire clear" check,
// the land mesh and the chart, so nothing can disagree about where the shore is.

import { fbm, lerp, sstep } from './constants.ts';

export interface Island {
  x: number;
  z: number;
  r: number;
  h: number;
  seed: number;
  volc?: boolean;
}

/** Ironbottom Sound, roughly: Savo to the west, Guadalcanal across the south, Florida to the north. */
export const ISL: Island[] = [
  { x: -4200, z: 2600, r: 2100, h: 900, seed: 3, volc: true }, // Savo Island
  { x: 3600, z: -5200, r: 3600, h: 780, seed: 11 }, // Guadalcanal (north shore)
  { x: 2600, z: 5600, r: 1900, h: 420, seed: 7 }, // Florida Island
  { x: -5200, z: -4200, r: 1500, h: 320, seed: 19 }, // a reef and a sand spit
];

export function islH(I: Island, x: number, z: number): number {
  const d = Math.hypot(x - I.x, z - I.z) / I.r;
  const n = fbm((x + I.seed * 977) * 0.0011, (z - I.seed * 613) * 0.0011);
  const s = 1 - (d + (n - 0.5) * 0.55);
  if (s <= 0) return -80;
  const prof = I.volc ? Math.pow(s, 1.35) : s * s * (3 - 2 * s);
  const rough = fbm(x * 0.004 + I.seed * 3.1, z * 0.004 - I.seed * 1.7);
  return prof * I.h * (0.85 + 0.3 * rough) - 2;
}

export function terrainH(x: number, z: number): number {
  let h = -80;
  for (const I of ISL) {
    const v = islH(I, x, z);
    if (v > h) h = v;
  }
  return h;
}

export const onLand = (x: number, z: number) => terrainH(x, z) > 0;

/** A point out at sea, at least `clear` metres from any shore - used to place ships and markers. */
export function waterSpot(x: number, z: number, clear = 260): [number, number] {
  for (let k = 0; k < 40; k++) {
    if (terrainH(x, z) < -12) {
      let ok = true;
      for (let a = 0; a < 8; a++) {
        const th = (a / 8) * Math.PI * 2;
        if (terrainH(x + Math.cos(th) * clear, z + Math.sin(th) * clear) > -12) {
          ok = false;
          break;
        }
      }
      if (ok) return [x, z];
    }
    x *= 0.9;
    z *= 0.9;
  }
  return [x, z];
}

/** Does a shell from the muzzle clear the ground on its way to the target? */
export function shellClear(
  g: number,
  mx: number,
  my: number,
  mz: number,
  tx: number,
  tz: number,
  v0: number,
  maxRange: number,
): boolean {
  const dx = tx - mx,
    dz = tz - mz;
  const full = Math.hypot(dx, dz) || 1;
  const D = Math.min(full, maxRange) || 1;
  const ux = dx / full,
    uz = dz / full;
  const T = Math.max(0.2, D / v0);
  const vy = (-my + 0.5 * g * T * T) / T;
  const n = Math.ceil(D / 120);
  for (let i = 1; i <= n; i++) {
    const f = i / n,
      t = f * T;
    const y = my + vy * t - 0.5 * g * t * t;
    const th = terrainH(mx + ux * D * f, mz + uz * D * f);
    if (y < th && th > 0) return false;
  }
  return true;
}

/** Gentle swell height used by the renderer and by the ship's bob. */
export function swellH(): number {
  return 0;
}

export const shoreFade = (h: number) => sstep(lerp(0, 1, h));
