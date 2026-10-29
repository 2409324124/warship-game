/** Centered, elevated exterior framing inspired by WoWS desktop camera mechanics,
 * not original game camera coordinates. Binocular endpoints preserve aiming compatibility. */
export function chaseFraming(
  spec: { L: number; cls: string; cam: readonly [number, number] },
  aspect: number,
  zoom: number,
): { fov: number; back: number; height: number; shoulder: number } {
  const q = Math.max(0, Math.min(1, Number.isFinite(zoom) ? zoom : 0));
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const wide = spec.cls === 'BB' ? 54 : 56;
  const halfHorizontal = Math.atan(Math.tan(wide * Math.PI / 360) * ratio);
  const fit = spec.L * .58 / Math.tan(halfHorizontal);
  const back = Math.max(spec.L * (spec.cls === 'BB' ? 1.55 : 1.8), fit);
  const height = Math.max(spec.cls === 'DD' ? 28 : 0, spec.L * .34);
  return { fov: wide + (11 - wide) * q,
    back: back + (spec.cam[0] * .55 - back) * q,
    height: height + (spec.cam[1] * .78 - height) * q,
    shoulder: 0 };
}
