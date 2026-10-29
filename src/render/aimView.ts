export const AIM_MIN_PITCH = -80 * Math.PI / 180;
export const AIM_MAX_PITCH = 65 * Math.PI / 180;

interface Point { x: number; y: number; z: number }
const finitePoint = (p: Point): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

export function clampAimPitch(pitch: number): number {
  return Number.isFinite(pitch) ? Math.max(AIM_MIN_PITCH, Math.min(AIM_MAX_PITCH, pitch)) : 0;
}

/** Camera direction: radians, positive pitch up, yaw from +z towards +x. */
export function aimViewDirection(yaw: number, pitch: number): Point {
  const heading = Number.isFinite(yaw) ? yaw : 0;
  const tilt = clampAimPitch(pitch), horizontal = Math.cos(tilt);
  return { x: Math.sin(heading) * horizontal, y: Math.sin(tilt), z: Math.cos(heading) * horizontal };
}

/** Geometric sight angle, NOT gun elevation. Unclamped; coincident/invalid points give zero. */
export function aimPitchToPoint(origin: Point, target: Point): number {
  if (!finitePoint(origin) || !finitePoint(target)) return 0;
  let x = target.x - origin.x, y = target.y - origin.y, z = target.z - origin.z;
  if (![x, y, z].every(Number.isFinite)) {
    // Subtract after scaling when finite coordinates have an overflowing difference.
    const scale = Math.max(Math.abs(origin.x), Math.abs(origin.y), Math.abs(origin.z),
      Math.abs(target.x), Math.abs(target.y), Math.abs(target.z));
    x = target.x / scale - origin.x / scale;
    y = target.y / scale - origin.y / scale;
    z = target.z / scale - origin.z / scale;
  }
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  return scale === 0 ? 0 : Math.atan2(y / scale, Math.hypot(x / scale, z / scale));
}

/**
 * First sampled above-to-below crossing of the supplied combined sea/terrain height.
 * At most 400 march steps + 1 origin sample + 12 refinement samples (413 calls).
 * Typical ~25 km rays use 24/40/80/144 metre steps. Exceptionally long rays
 * coarsen to fit the budget. Features narrower than a step can be missed; the
 * callback must describe a continuous heightfield for bisection to locate a surface.
 * Unknown/nonfinite heights abort, never substitute an assumed sea plane.
 */
export function traceAimSurface(
  origin: Point, direction: Point, maxDistance: number,
  height: (x: number, z: number) => number,
): (Point & { distance: number }) | null {
  if (!finitePoint(origin) || !finitePoint(direction)
    || !Number.isFinite(maxDistance) || maxDistance <= 0) return null;
  const scale = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
  if (scale === 0) return null;
  const sx = direction.x / scale, sy = direction.y / scale, sz = direction.z / scale;
  const length = Math.hypot(sx, sy, sz);
  const dx = sx / length, dy = sy / length, dz = sz / length;
  const point = (distance: number) => ({
    x: origin.x + dx * distance, y: origin.y + dy * distance, z: origin.z + dz * distance,
    distance,
  });
  const clearance = (distance: number): number => {
    const p = point(distance);
    if (!finitePoint(p)) return NaN;
    return p.y - height(p.x, p.z);
  };
  const start = clearance(0);
  if (!Number.isFinite(start) || start < 0) return null;
  let previous = 0, previousGap = start;
  for (let step = 0; step < 400 && previous < maxDistance; step++) {
    const stride = previous < 1000 ? 24 : previous < 3000 ? 40 : previous < 6000 ? 80 : 144;
    const distance = Math.min(maxDistance,
      previous + stride * Math.max(1, maxDistance / 40000));
    if (!Number.isFinite(distance) || distance <= previous) return null;
    const gap = clearance(distance);
    if (!Number.isFinite(gap)) return null;
    if (gap <= 0 && (previousGap > 0 || gap < 0)) {
      let low = previous, high = distance;
      for (let i = 0; i < 12; i++) {
        const middle = low + (high - low) / 2;
        const middleGap = clearance(middle);
        if (!Number.isFinite(middleGap)) return null;
        if (middleGap > 0) low = middle;
        else high = middle;
      }
      return point(high);
    }
    previous = distance;
    previousGap = gap;
  }
  return null;
}
