// Shared hull shape. Both the simulation (hit boxes, where a turret sits) and the model builder
// (the geometry you actually see) read these, so a ship's numbers mean the same thing everywhere.
//
// Station `s` runs 0 at the stern to 1 at the bow.

import { clamp, lerp, sstep } from './constants.ts';

export interface SheerPoint {
  0: number;
  1: number;
}

/** Freeboard multiplier along the hull, from a small table of [station, factor] pairs. */
export function interpSheer(pts: readonly number[][], s: number): number {
  for (let i = 1; i < pts.length; i++) {
    if (s <= pts[i][0]) {
      const a = pts[i - 1],
        b = pts[i];
      const t = (s - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return lerp(a[1], b[1], clamp(t, 0, 1));
    }
  }
  return pts[pts.length - 1][1];
}

/** Deck height above the waterline at hull-local z (metres, +z toward the bow). */
export function deckY(spec: { F: number; sheer: readonly number[][]; L: number }, z: number): number {
  return spec.F * interpSheer(spec.sheer, clamp(z / spec.L + 0.5, 0, 1));
}

/** Half-breadth at station s as a fraction of half the beam. Full amidships, fine at both ends. */
export function halfW(s: number): number {
  if (s >= 0.58) {
    const u = clamp((s - 0.58) / 0.42, 0, 1);
    return Math.max(0.018, Math.pow(Math.cos((u * Math.PI) / 2), 0.8));
  }
  if (s < 0.16) {
    const u = clamp((0.16 - s) / 0.16, 0, 1);
    return Math.max(0.42, Math.pow(Math.cos((u * Math.PI) / 2), 0.55));
  }
  return 1;
}

/** Half-breadth at the waterline: a destroyer's stern sits wider in the water than her deck. */
export function halfWL(s: number): number {
  return s < 0.14 ? 0.42 + 0.58 * Math.sin(((s / 0.14) * Math.PI) / 2) : halfW(s);
}

/** Hull depth below the waterline at station s - she rises toward the bow and the stern. */
export function keelD(spec: { D: number }, s: number): number {
  return spec.D * (s > 0.86 ? lerp(1, 0.15, sstep((s - 0.86) / 0.14)) : s < 0.1 ? lerp(0.3, 1, sstep(s / 0.1)) : 1);
}

export function hullTopY(spec: { F: number; sheer: readonly number[][] }): number {
  return spec.F * Math.max(...spec.sheer.map((p) => p[1])) + 0.6;
}

/** Number of vertical rings in a lofted hull. */
export const RING = 12;

/**
 * One half-section (keel to deck edge) at station s, as [halfWidth, y] pairs.
 * `p` is the fullness exponent: 3.4 amidships is a wall-sided U, 1.15 at the bow is a fine V.
 */
export function hullSection(spec: { B: number; D: number }, s: number, top: number): [number, number][] {
  const p = lerp(lerp(3.4, 1.15, sstep((s - 0.7) / 0.27)), 2.2, sstep((0.14 - s) / 0.14));
  const bottom = -keelD(spec, s);
  const hw = (spec.B / 2) * halfW(s);
  const pts: [number, number][] = [];
  for (let i = 0; i < RING; i++) {
    const a = i / (RING - 1);
    const y = lerp(bottom, top, a);
    let w = hw * Math.pow(a, 1 / p);
    w *= 1 - 0.05 * sstep((a - 0.88) / 0.12); // a touch of tumblehome under the deck edge
    if (i === 0) w *= 0.35; // round the garboard rather than ending on a knife edge
    pts.push([Math.max(0.05, w), y]);
  }
  return pts;
}
