// Pure geometry: compact surviving independent edges, never join across a rejected shore edge.
export const AIM_PROJECTION_MAX_SEGMENTS = 1024;
export const AIM_PROJECTION_HEIGHT_OFFSET = 0.4;
export const AIM_PROJECTION_RIBBON_WIDTH = 1;

interface HeightField { height(x: number, z: number, time: number): number }
const flatSea: HeightField = { height: () => 0 };

export function projectAimRing(
  positions: Float32Array,
  aimX: number, aimZ: number, fromX: number, fromZ: number,
  sigma: { along: number; cross: number },
  water: HeightField = flatSea, time = 0, reachable = true,
  terrainHeight: (x: number, z: number) => number = () => -Number.MAX_VALUE,
): { valid: boolean; segments: number } {
  const hidden = { valid: false, segments: 0 };
  if (!reachable || ![aimX, aimZ, fromX, fromZ, sigma.along, sigma.cross, time].every(Number.isFinite)
    || sigma.along <= 0 || sigma.cross <= 0) return hidden;
  const centerSea = water.height(aimX, aimZ, time);
  const centerLand = terrainHeight(aimX, aimZ);
  if (!Number.isFinite(centerSea) || !Number.isFinite(centerLand) || centerLand > centerSea) return hidden;
  const dx = aimX - fromX, dz = aimZ - fromZ;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance)) return hidden;
  const ux = distance ? dx / distance : 1, uz = distance ? dz / distance : 0;
  // Resolve waves and shores at metre scale, with bounded per-frame work. This only
  // changes tessellation, never the physical radii or their apparent screen size.
  const count = Math.min(AIM_PROJECTION_MAX_SEGMENTS, Math.floor(positions.length / 6),
    Math.max(96, Math.ceil(2 * Math.PI * Math.max(sigma.along, sigma.cross) / 4)));
  if (count < 3) return hidden;
  let segments = 0;
  const point = (angle: number) => {
    const along = Math.cos(angle) * sigma.along, cross = Math.sin(angle) * sigma.cross;
    const x = aimX + ux * along - uz * cross, z = aimZ + uz * along + ux * cross;
    const sea = water.height(x, z, time), land = terrainHeight(x, z);
    return { x, y: sea + AIM_PROJECTION_HEIGHT_OFFSET, z, sea, land };
  };
  for (let i = 0; i < count; i++) {
    const a = point(i / count * Math.PI * 2), b = point((i + 1) / count * Math.PI * 2);
    // Check the straight edge interior too: two wet endpoints can straddle a spit.
    let wet = true;
    for (let j = 0; j <= 4; j++) {
      const f = j / 4, x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
      const sea = j === 0 ? a.sea : j === 4 ? b.sea : water.height(x, z, time);
      const land = j === 0 ? a.land : j === 4 ? b.land : terrainHeight(x, z);
      if (![x, z, sea, sea + AIM_PROJECTION_HEIGHT_OFFSET].every(Number.isFinite)
        || !Number.isFinite(land)) return hidden;
      if (land > sea) wet = false;
    }
    if (!wet) continue;
    const offset = segments * 6;
    positions.set([a.x, a.y, a.z, b.x, b.y, b.z], offset);
    // Float32 overflow must not enter the GPU buffer, even for finite JS numbers.
    for (let k = offset; k < offset + 6; k++) if (!Number.isFinite(positions[k])) return hidden;
    segments++;
  }
  return { valid: segments > 0, segments };
}

/** Expand compact centerline edges into independent 4-corner / 2-triangle sea strips.
 * Width is horizontal world metres, symmetric about the unchanged physical centerline.
 * Output is non-indexed: A-left, A-right, B-left, B-left, A-right, B-right.
 */
export function projectAimRibbon(
  positions: Float32Array, centerline: Float32Array, segments: number,
  water: HeightField = flatSea, time = 0,
  terrainHeight: (x: number, z: number) => number = () => -Number.MAX_VALUE,
): { valid: boolean; segments: number } {
  const hidden = { valid: false, segments: 0 };
  if (!Number.isFinite(time) || !Number.isInteger(segments) || segments < 0
    || segments * 6 > centerline.length || segments * 18 > positions.length) return hidden;
  let written = 0;
  const halfWidth = AIM_PROJECTION_RIBBON_WIDTH / 2;
  for (let i = 0; i < segments; i++) {
    const p = i * 6;
    for (let j = 0; j < 6; j++) if (!Number.isFinite(centerline[p + j])) return hidden;
    const ax = centerline[p], az = centerline[p + 2], bx = centerline[p + 3], bz = centerline[p + 5];
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    if (!Number.isFinite(length)) return hidden;
    if (length === 0) continue;
    const nx = -dz / length * halfWidth, nz = dx / length * halfWidth;
    const corners = [ax + nx, az + nz, ax - nx, az - nz, bx + nx, bz + nz, bx - nx, bz - nz];
    const heights: number[] = [];
    let wet = true;
    // Check both edges and center across the whole strip: widening must not put a
    // wet centerline onto dry land. Rejected strips are never joined to neighbours.
    for (let k = 0; k <= 4; k++) {
      const f = k / 4;
      for (const side of [-1, 0, 1]) {
        const x = ax + dx * f + nx * side, z = az + dz * f + nz * side;
        const sea = water.height(x, z, time), land = terrainHeight(x, z);
        if (![x, z, sea, land].every(Number.isFinite)) return hidden;
        if (land > sea) wet = false;
      }
    }
    if (!wet) continue;
    for (let k = 0; k < 4; k++) {
      const sea = water.height(corners[k * 2], corners[k * 2 + 1], time);
      const y = sea + AIM_PROJECTION_HEIGHT_OFFSET;
      if (!Number.isFinite(y)) return hidden;
      heights.push(y);
    }
    let offset = written * 18;
    for (const corner of [0, 1, 2, 2, 1, 3]) {
      positions[offset++] = corners[corner * 2];
      positions[offset++] = heights[corner];
      positions[offset++] = corners[corner * 2 + 1];
    }
    for (let j = written * 18; j < offset; j++) if (!Number.isFinite(positions[j])) return hidden;
    written++;
  }
  return { valid: written > 0, segments: written };
}
