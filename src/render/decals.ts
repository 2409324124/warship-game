// Battle damage that stays put: a pooled ring of crater quads stamped onto the hull where shells
// landed. One InstancedMesh for the whole battle, one texture, no allocation per hit.

import * as THREE from 'three';
import { clamp, rand, TAU } from '../sim/constants.ts';
import { deckY, halfW } from '../sim/hull.ts';
import type { Ship } from '../sim/ship';

export interface Crater {
  /** Hull-local position. */
  x: number;
  y: number;
  z: number;
  /** Outward surface normal in hull-local space. */
  nx: number;
  ny: number;
  nz: number;
  size: number;
}

interface HullLike {
  F: number;
  B: number;
  L: number;
  sheer: readonly number[][];
}

/**
 * Where a shell that struck the hull at local (lx, ly, lz) should leave its mark. Deck hits get a
 * flat crater on the planking; everything else is put on the nearer side, tucked just outside the
 * half-breadth so it never sinks into the plating.
 */
export function craterPlacement(spec: HullLike, lx: number, ly: number, lz: number, cal: number): Crater {
  const deck = deckY(spec, lz);
  const size = 2.6 + 4.5 * clamp(cal / 406, 0.3, 1.2);
  if (ly > deck - 1.4) {
    return {
      x: clamp(lx, -spec.B * 0.4, spec.B * 0.4),
      y: deck + 0.25,
      z: lz,
      nx: 0,
      ny: 1,
      nz: 0,
      size,
    };
  }
  const hb = (spec.B * 0.5) * halfW(clamp(lz / spec.L + 0.5, 0, 1));
  const side = lx >= 0 ? 1 : -1;
  return {
    x: side * (hb + 0.15),
    y: clamp(ly, 0.6, Math.max(0.7, deck - 0.3)),
    z: lz,
    nx: side,
    ny: 0,
    nz: 0,
    size,
  };
}

/** Scorched hole with a torn rim and a little of the soot blown outward. Generated once. */
function craterTexture(): THREE.Texture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const m = S / 2;

  // soot: dense at the middle, spreading past the hole
  const soot = c.createRadialGradient(m, m, 2, m, m, m);
  soot.addColorStop(0, 'rgba(10,9,8,0.96)');
  soot.addColorStop(0.3, 'rgba(22,19,17,0.8)');
  soot.addColorStop(0.62, 'rgba(38,33,29,0.42)');
  soot.addColorStop(1, 'rgba(46,40,35,0)');
  c.fillStyle = soot;
  c.fillRect(0, 0, S, S);

  // the hole itself, an irregular polygon so it never reads as a circle
  c.beginPath();
  const pts = 13;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * TAU;
    const r = m * (0.3 + Math.random() * 0.16);
    const x = m + Math.cos(a) * r;
    const y = m + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
  c.fillStyle = 'rgba(6,6,7,0.98)';
  c.fill();

  // torn, brighter rim - what is left of the plating
  c.strokeStyle = 'rgba(150,148,142,0.3)';
  c.lineWidth = 2.2;
  c.stroke();

  // streaks blown out from the impact
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * TAU;
    const r0 = m * (0.34 + Math.random() * 0.08);
    const r1 = m * (0.55 + Math.random() * 0.4);
    c.strokeStyle = `rgba(14,12,11,${0.12 + Math.random() * 0.22})`;
    c.lineWidth = 1 + Math.random() * 2.4;
    c.beginPath();
    c.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0);
    c.lineTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1);
    c.stroke();
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PER_SHIP = 20;

interface Item {
  ship: Ship | null;
  local: THREE.Matrix4;
  live: boolean;
}

export class DecalPool {
  private mesh: THREE.InstancedMesh;
  private items: Item[] = [];
  private cursor = 0;
  private max: number;
  private n = 0;
  private shipM = new THREE.Matrix4();
  private out = new THREE.Matrix4();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private spin = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene, max = 96) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: craterTexture(),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    for (let i = 0; i < max; i++) this.items.push({ ship: null, local: new THREE.Matrix4(), live: false });
  }

  get count(): number {
    return this.n;
  }

  add(ship: Ship, lx: number, ly: number, lz: number, cal: number): void {
    const c = craterPlacement(ship.spec, lx, ly, lz, cal);
    // per-ship cap: recycle that ship's oldest mark rather than letting one hull fill the pool
    let owned = 0;
    let oldest = -1;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.live || it.ship !== ship) continue;
      owned++;
      if (oldest < 0) oldest = i;
    }
    if (owned >= PER_SHIP && oldest >= 0) this.items[oldest].live = false;

    let slot = -1;
    for (let i = 0; i < this.max; i++) {
      const idx = (this.cursor + i) % this.max;
      if (!this.items[idx].live) {
        slot = idx;
        break;
      }
    }
    if (slot < 0) slot = this.cursor;
    this.cursor = (slot + 1) % this.max;

    const it = this.items[slot];
    it.ship = ship;
    it.live = true;
    this.pos.set(c.x, c.y, c.z);
    this.axis.set(c.nx, c.ny, c.nz);
    this.quat.setFromUnitVectors(this.zAxis, this.axis);
    this.quat.multiply(this.spin.setFromAxisAngle(this.axis, rand(0, TAU)));
    this.scale.set(c.size, c.size * 0.85, 1);
    it.local.compose(this.pos, this.quat, this.scale);
  }

  /** Ships heave, pitch and roll, so every mark has to be re-placed each frame. */
  update(): void {
    let n = 0;
    for (const it of this.items) {
      if (!it.live) continue;
      const s = it.ship;
      if (!s || s.removed) {
        it.live = false;
        it.ship = null;
        continue;
      }
      this.shipM.makeRotationFromEuler(this.euler.set(s.pitch, s.heading, s.roll));
      this.shipM.setPosition(s.x, s.bob, s.z);
      this.out.multiplyMatrices(this.shipM, it.local);
      this.mesh.setMatrixAt(n++, this.out);
    }
    this.n = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    for (const it of this.items) {
      it.live = false;
      it.ship = null;
    }
    this.n = 0;
    this.cursor = 0;
    this.mesh.count = 0;
  }
}
