// Procedural WWII carrier aircraft models.
//
// Every kind is one merged BufferGeometry: fuselage, wings, tail, gear, ordnance, a static
// propeller disc and roundels. Parts carry vertex colours, so a kind is a single material and a
// single InstancedMesh. Origin sits at the fuselage centre with +Z toward the nose and +Y up.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type PlaneModelKind = 'us_torp' | 'us_dive' | 'jp_torp' | 'jp_dive';

export interface PlaneModel {
  /** One merged geometry (all parts incl. static propeller disc and markings), shared per kind. */
  geometry: THREE.BufferGeometry;
  /** Material shared per kind (vertex colours are used, so one material serves all parts). */
  material: THREE.Material;
  /** Triangle count, for the <300 budget test. */
  tris: number;
}

// Palette. Markings are painted as flat discs, so no texture is needed.
const US_HULL = 0x3d4f5f;
const US_WING = 0x4a5d6e;
const JP_HULL = 0x3a4a38;
const JP_WING = 0x46583f;
const PROP = 0x9aa4a8;
const US_MARK = 0xd8dde2;
const JP_MARK = 0x8a2020;
const GEAR = 0x333b41;
const ORDNANCE = 0x464e54;

type P2 = [number, number];

interface Spec {
  hull: number;
  wing: number;
  mark: number;
  fuselageR: number;
  wingY: number;
  dihedral: number;
  /** Half-span wing planform, root at x = 0, nose at +z. */
  planform: P2[];
  /** Centre of the wing roundel, metres outboard. */
  roundelX: number;
  /** Canopy width, height, length. */
  canopy: [number, number, number];
  gear: 'strut' | 'fairing';
  ordnance: 'torp' | 'bomb';
}

const SPECS: Record<PlaneModelKind, Spec> = {
  // TBF/TBD: straight mid wing, broad fuselage, big greenhouse canopy, torpedo.
  us_torp: {
    hull: US_HULL, wing: US_WING, mark: US_MARK,
    fuselageR: 0.84, wingY: -0.05, dihedral: 0.02,
    planform: [[0, 1.35], [6.2, 1.3], [7.5, 1.15], [7.5, -0.95], [6.2, -1.1], [0, -1.15]],
    roundelX: 4.7,
    canopy: [0.98, 0.46, 2.05],
    gear: 'strut',
    ordnance: 'torp',
  },
  // SBD: low wing with dihedral, rounded tips, short fat bomb.
  us_dive: {
    hull: US_HULL, wing: US_WING, mark: US_MARK,
    fuselageR: 0.75, wingY: -0.45, dihedral: 0.1,
    planform: [[0, 1.3], [5.6, 1.2], [6.9, 0.9], [7.5, 0.25], [7.05, -0.5], [5.7, -1.0], [0, -1.1]],
    roundelX: 4.4,
    canopy: [0.86, 0.4, 1.55],
    gear: 'strut',
    ordnance: 'bomb',
  },
  // B5N: long slender fuselage, elliptical tip, fixed gear fairings, torpedo.
  jp_torp: {
    hull: JP_HULL, wing: JP_WING, mark: JP_MARK,
    fuselageR: 0.72, wingY: -0.05, dihedral: 0.04,
    planform: [[0, 1.4], [4.8, 1.25], [6.6, 0.85], [7.5, 0.25], [6.7, -0.55], [4.9, -1.0], [0, -1.1]],
    roundelX: 4.4,
    canopy: [0.82, 0.38, 1.65],
    gear: 'fairing',
    ordnance: 'torp',
  },
  // D3A: elliptical low wing with pronounced dihedral, fixed gear fairings, bomb.
  jp_dive: {
    hull: JP_HULL, wing: JP_WING, mark: JP_MARK,
    fuselageR: 0.68, wingY: -0.45, dihedral: 0.16,
    planform: [[0, 1.2], [4.6, 1.1], [6.5, 0.75], [7.5, 0.2], [6.6, -0.5], [4.7, -0.9], [0, -1.0]],
    roundelX: 4.2,
    canopy: [0.78, 0.36, 1.5],
    gear: 'fairing',
    ordnance: 'bomb',
  },
};

// ------------------------------------------------------------------ small geometry helpers

/** Cylinder with its axis on +Z (length runs from -len/2 to +len/2). */
const cylZ = (radius: number, len: number, seg: number): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(radius, radius, len, seg, 1, false);
  g.rotateX(Math.PI / 2);
  return g;
};

/** Cone with its apex on +/-Z and its base at the opposite end. */
const coneZ = (radius: number, len: number, seg: number, dir: 1 | -1): THREE.BufferGeometry => {
  const g = new THREE.ConeGeometry(radius, len, seg, 1, false);
  g.rotateX((dir * Math.PI) / 2);
  return g;
};

/**
 * Thin prism from a convex planform polygon in XZ, listed clockwise so the top face points +Y.
 * Two caps are fanned from the first point and each edge gets a quad.
 */
function prism(poly: readonly P2[], thick: number): THREE.BufferGeometry {
  const h = thick / 2;
  const pos: number[] = [];
  const tri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ): void => { pos.push(ax, ay, az, bx, by, bz, cx, cy, cz); };

  for (let i = 1; i < poly.length - 1; i++) {
    const a = poly[0], b = poly[i], c = poly[i + 1];
    tri(a[0], h, a[1], b[0], h, b[1], c[0], h, c[1]);
    tri(a[0], -h, a[1], c[0], -h, c[1], b[0], -h, b[1]);
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    tri(a[0], h, a[1], a[0], -h, a[1], b[0], -h, b[1]);
    tri(a[0], h, a[1], b[0], -h, b[1], b[0], h, b[1]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** One wing/tail panel: mirrored planform for the left side, dihedral about Z, then placed. */
function panel(poly: readonly P2[], thick: number, dih: number, side: 1 | -1, y: number, z: number): THREE.BufferGeometry {
  const p: P2[] = side > 0
    ? poly.map(([x, zz]): P2 => [x, zz])
    : poly.map(([x, zz]): P2 => [-x, zz]).reverse();
  const g = prism(p, thick);
  if (dih) g.rotateZ(side * dih);
  return g.translate(0, y, z);
}

/** Bakes a flat colour into a part and normalises it to a mergeable, non-indexed layout. */
function paint(src: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src;
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------------ assembly

function build(kind: PlaneModelKind): PlaneModel {
  const s = SPECS[kind];
  const r = s.fuselageR;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, hex: number): void => { parts.push(paint(g, hex)); };

  // Fuselage: straight mid-body, tapered nose cone and tail cone. Total length 10.4 m.
  add(cylZ(r, 5.2, 6), s.hull);
  add(new THREE.CylinderGeometry(0.26, r, 2.6, 6, 1, false).rotateX(Math.PI / 2).translate(0, 0, 3.9), s.hull);
  add(coneZ(r, 2.6, 6, -1).translate(0, 0, -3.9), s.hull);

  const [cw, ch, cl] = s.canopy;
  add(new THREE.BoxGeometry(cw, ch, cl).translate(0, r * 0.95 + ch * 0.25, 1.35), s.hull);

  // Wings: mid wing for torpedo bombers, low wing with more dihedral for dive bombers.
  add(panel(s.planform, 0.24, s.dihedral, 1, s.wingY, 0.15), s.wing);
  add(panel(s.planform, 0.24, s.dihedral, -1, s.wingY, 0.15), s.wing);

  const stab: P2[] = [[0, 0.62], [2.3, 0.55], [2.3, -0.42], [0, -0.55]];
  add(panel(stab, 0.14, 0.05, 1, 0.1, -4.05), s.wing);
  add(panel(stab, 0.14, 0.05, -1, 0.1, -4.05), s.wing);

  // Fin, built flat and stood up with a quarter turn about Z.
  const fin = prism([[0, 0.62], [0.55, 0.1], [0.55, -0.75], [0, -0.85]], 0.14);
  fin.rotateZ(Math.PI / 2);
  add(fin.translate(0, 0.35, -4.05), s.wing);

  // Static propeller disc: two single-sided circles so it reads from ahead and from astern.
  add(new THREE.CircleGeometry(1.85, 12).translate(0, 0, 5.24), PROP);
  add(new THREE.CircleGeometry(1.85, 12).rotateY(Math.PI).translate(0, 0, 5.22), PROP);

  // Gear.
  for (const side of [1, -1] as const) {
    if (s.gear === 'fairing') {
      const y = s.wingY + 1.45 * Math.sin(s.dihedral) - 0.35;
      add(new THREE.BoxGeometry(0.42, 1.0, 1.5).translate(side * 1.45, y, 1.15), GEAR);
    } else {
      add(new THREE.BoxGeometry(0.14, 0.9, 0.4).translate(side * 1.35, s.wingY - 0.3, 1.35), GEAR);
    }
  }

  // Ordnance on the centreline, tucked against the belly.
  if (s.ordnance === 'torp') {
    const y = -(r + 0.12);
    add(cylZ(0.27, 3.4, 6).translate(0, y, 0.55), ORDNANCE);
    add(coneZ(0.27, 0.85, 6, 1).translate(0, y, 2.675), ORDNANCE);
  } else {
    const y = -(r + 0.14);
    add(cylZ(0.34, 1.2, 6).translate(0, y, 1.0), ORDNANCE);
    add(coneZ(0.34, 0.7, 6, 1).translate(0, y, 1.95), ORDNANCE);
  }

  // Roundels: wing upper surfaces plus both sides of the rear fuselage.
  const wingTopY = (x: number): number =>
    s.wingY + x * Math.sin(s.dihedral) + 0.12 * Math.cos(s.dihedral) + 0.012;
  for (const side of [1, -1] as const) {
    // Tilted with the panel so the whole disc stays above the sloping wing surface.
    add(
      new THREE.CircleGeometry(0.58, 8)
        .rotateX(-Math.PI / 2)
        .rotateZ(side * s.dihedral)
        .translate(side * s.roundelX, wingTopY(s.roundelX), 0.35),
      s.mark,
    );
    add(
      new THREE.CircleGeometry(0.46, 8)
        .rotateY((side * Math.PI) / 2)
        .translate(side * (r + 0.02), 0.08, -2.4),
      s.mark,
    );
  }

  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error(`aircraft geometry merge failed for ${kind}`);
  geometry.computeBoundingBox();
  const tris = geometry.getAttribute('position').count / 3;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  return { geometry, material, tris };
}

const cache = new Map<PlaneModelKind, PlaneModel>();

/** Builds (once) the merged, vertex-coloured model for a plane kind. */
export function buildPlaneGeometry(kind: PlaneModelKind): PlaneModel {
  const hit = cache.get(kind);
  if (hit) return hit;
  const model = build(kind);
  cache.set(kind, model);
  return model;
}
