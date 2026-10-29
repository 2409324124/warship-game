import * as THREE from 'three';

/** [normalised longitudinal station, waterline half breadth, bow coordinate], metres. */
export type WaterlineStation = [number, number, number];

export function waterlineFromModel(root: THREE.Object3D): WaterlineStation[] | null {
  let result: WaterlineStation[] | null = null;
  root.traverse((node) => {
    const raw = node.userData.waterlineStations;
    if (raw === undefined || result) return;
    let rows: unknown;
    try { rows = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    if (!Array.isArray(rows) || rows.length < 2 || rows.length > 512) return;
    if (!rows.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) &&
      p[0] >= 0 && p[0] <= 1 && p[1] >= 0)) return;
    const points = rows as WaterlineStation[];
    if (points.some((p, i) => i > 0 && (p[0] <= points[i - 1][0] || p[2] <= points[i - 1][2]))) return;
    result = points;
  });
  return result;
}

/** Two narrow side ribbons following the exported hull, never a sheet across its beam. */
export function buildVisualFoam(rows: readonly WaterlineStation[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const [s, half, z] = rows[i];
    const outer = half + 0.8 + 1.5 * s * s;
    pos.push(-half - 0.1, 0.2, z, -outer, 0.2, z, half + 0.1, 0.2, z, outer, 0.2, z);
    uv.push(0, s, 1, s, 0, s, 1, s);
    if (i + 1 === rows.length) continue;
    const a = i * 4, b = a + 4;
    indices.push(a, b, b + 1, a, b + 1, a + 1, a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  return geo;
}
