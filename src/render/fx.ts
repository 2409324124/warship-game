// Effects: shell splashes, shell hits, muzzle blasts, funnel and damage smoke, wakes, and the
// shells themselves in flight. Everything is pooled - no allocation during a battle.

import * as THREE from 'three';
import { clamp, rand, TAU } from '../sim/constants';
import { deckY } from '../sim/hull.ts';
import type { Ship } from '../sim/ship';
import type { Shell } from '../sim/gunnery';
import type { Torpedo } from '../sim/torpedo';
import type { Water } from './water';
import { MuzzleEffects } from './muzzle';
import { DecalPool } from './decals.ts';

function dotTexture(): THREE.Texture {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PART_VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aCol;
varying float vAlpha;
varying vec3 vCol;
void main() {
  vAlpha = aAlpha;
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // aSize is the sprite's pixel size at 420 m with the 55-degree chase lens. The projection term
  // keeps sprites growing with the zoom: without it every puff stays pinned to its wide-angle
  // pixel size while the ship under it swells, and nothing reads through the binoculars.
  // Clamped, or a puff of funnel smoke ten metres from the camera fills the screen.
  float zoom = projectionMatrix[1][1] * 0.5206;
  gl_PointSize = min(aSize * (420.0 / max(1.0, -mv.z)) * zoom, 72.0);
  gl_Position = projectionMatrix * mv;
}
`;

const PART_FS = /* glsl */ `
precision mediump float;
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vCol;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  if (t.a * vAlpha < 0.01) discard;
  gl_FragColor = vec4(vCol, t.a * vAlpha);
}
`;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  drag: number;
  grav: number;
  r: number;
  g: number;
  b: number;
  a0: number;
  /** Alpha falloff exponent: 2 is the old hard fade, 1 holds density (smoke). */
  fade: number;
}

class Pool {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private n = 0;

  constructor(scene: THREE.Scene, max: number, tex: THREE.Texture, additive = false) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.ShaderMaterial({
      vertexShader: PART_VS,
      fragmentShader: PART_FS,
      uniforms: { uMap: { value: tex } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) {
      this.parts.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        max: 1,
        size: 1,
        grow: 0,
        drag: 0.6,
        grav: -9,
        r: 1,
        g: 1,
        b: 1,
        a0: 1,
        fade: 2,
      });
    }
  }

  get count(): number { return this.n; }

  reset(): void {
    this.n = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  spawn(p: Partial<Particle>): void {
    if (this.n >= this.parts.length) return;
    const q = this.parts[this.n++];
    q.x = p.x ?? 0;
    q.y = p.y ?? 0;
    q.z = p.z ?? 0;
    q.vx = p.vx ?? 0;
    q.vy = p.vy ?? 0;
    q.vz = p.vz ?? 0;
    q.life = 0;
    q.max = p.max ?? 1;
    q.size = p.size ?? 4;
    q.grow = p.grow ?? 0;
    q.drag = p.drag ?? 0.6;
    q.grav = p.grav ?? -9;
    q.r = p.r ?? 1;
    q.g = p.g ?? 1;
    q.b = p.b ?? 1;
    q.a0 = p.a0 ?? 1;
    q.fade = p.fade ?? 2;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.max) {
        // swap-remove
        const last = this.parts[this.n - 1];
        this.parts[this.n - 1] = p;
        this.parts[i] = last;
        this.n--;
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.life / p.max;
      const u = 1 - t;
      // exp 2 is the old (1-t)^2 curve; smoke asks for 1 so it stays thick for most of its life
      const a = p.fade === 2 ? p.a0 * u * u : p.a0 * Math.pow(u, p.fade);
      const s = p.size + p.grow * t;
      const o = i * 3;
      this.pos[o] = p.x;
      this.pos[o + 1] = p.y;
      this.pos[o + 2] = p.z;
      this.col[o] = p.r;
      this.col[o + 1] = p.g;
      this.col[o + 2] = p.b;
      this.size[i] = s;
      this.alpha[i] = a;
      i++;
    }
    const g = this.points.geometry as THREE.BufferGeometry;
    g.setDrawRange(0, this.n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aCol as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ shells in flight

const SHELL_VS = /* glsl */ `
attribute float aSize;
attribute vec3 aCol;
varying vec3 vCol;
void main() {
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (620.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const SHELL_FS = /* glsl */ `
precision mediump float;
uniform sampler2D uMap;
varying vec3 vCol;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vCol + vec3(0.6) * pow(a, 3.0), a);
}
`;

class ShellLayer {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;

  constructor(scene: THREE.Scene, max: number, tex: THREE.Texture) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.ShaderMaterial({
      vertexShader: SHELL_VS,
      fragmentShader: SHELL_FS,
      uniforms: { uMap: { value: tex } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(shells: Shell[]): void {
    let n = 0;
    for (const s of shells) {
      if (!s.alive || n >= this.max) continue;
      const o = n * 3;
      this.pos[o] = s.x;
      this.pos[o + 1] = s.y;
      this.pos[o + 2] = s.z;
      // hot and bright high up, dimmer as she comes down
      const k = clamp(s.y / 600, 0, 1);
      this.col[o] = lerp3(0.55, 1.0, k);
      this.col[o + 1] = lerp3(0.5, 0.92, k);
      this.col[o + 2] = lerp3(0.42, 0.72, k);
      // AA streams read as bright tracer lines: slightly larger points than their calibre implies.
      this.size[n] = (2.4 + (s.gun.cal / 406) * 3.4) * (s.aa ? 1.9 : 1);
      n++;
    }
    const g = this.points.geometry as THREE.BufferGeometry;
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aCol as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

const TORP_FS = /* glsl */ `
precision mediump float;
uniform sampler2D uMap;
varying vec3 vCol;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  if (t.a < 0.02) discard;
  gl_FragColor = vec4(vCol, t.a * 0.85);
}
`;

const lerp3 = (a: number, b: number, t: number) => a + (b - a) * t;

// ------------------------------------------------------------------ water columns
// A splash is the one effect that has to read from seven kilometres away, so it is a real object:
// a tapered column that shoots up and slumps back, not just a puff of points.

class ColumnPool {
  private items: { mesh: THREE.Mesh; t: number; max: number; h: number; r: number; active: boolean }[] = [];

  constructor(scene: THREE.Scene, n = 28) {
    const geo = new THREE.CylinderGeometry(0.55, 1, 1, 10, 1, true);
    geo.translate(0, 0.5, 0);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf2f7fa,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, t: 0, max: 1, h: 60, r: 6, active: false });
    }
  }

  get count(): number { return this.items.reduce((n, item) => n + Number(item.active), 0); }

  reset(): void {
    for (const item of this.items) {
      item.active = false;
      item.t = 0;
      item.mesh.visible = false;
    }
  }

  spawn(x: number, z: number, k: number): void {
    const it = this.items.find((i) => !i.active) || this.items[0];
    it.active = true;
    it.t = 0;
    it.max = 1.5 + k * 0.9;
    it.h = 55 + k * 75;
    it.r = 3.5 + k * 7;
    it.mesh.position.set(x, 0, z);
    it.mesh.visible = true;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const u = it.t / it.max;
      if (u >= 1) {
        it.active = false;
        it.mesh.visible = false;
        continue;
      }
      // up fast, then slump: the column is tallest around a third of the way through
      const grow = Math.sin(Math.min(1, u * 2.6) * Math.PI * 0.5);
      const fall = 1 - u * u;
      const h = it.h * grow * (0.35 + 0.65 * fall);
      const r = it.r * (0.5 + 0.9 * u);
      it.mesh.scale.set(r, Math.max(1, h), r);
      const mat = it.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.8 * (1 - u) * (1 - u * 0.4);
    }
  }
}

// ------------------------------------------------------------------ torpedo wakes

class TorpLayer {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;

  constructor(scene: THREE.Scene, max: number, tex: THREE.Texture) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.ShaderMaterial({
      vertexShader: SHELL_VS,
      fragmentShader: TORP_FS,
      uniforms: { uMap: { value: tex } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(torps: Torpedo[], dt: number, t: number): void {
    let n = 0;
    for (const tp of torps) {
      if (!tp.alive || n >= this.max * 0.5) continue;
      // a short trail of bubbles behind the fish
      const trail = 5;
      for (let i = 0; i < trail && n < this.max; i++) {
        const back = i * 26;
        const o = n * 3;
        this.pos[o] = tp.x - tp.dx * back;
        this.pos[o + 1] = 0.6 + Math.sin(t * 3 + i) * 0.2;
        this.pos[o + 2] = tp.z - tp.dz * back;
        this.col[o] = 0.88;
        this.col[o + 1] = 0.94;
        this.col[o + 2] = 0.98;
        this.size[n] = 3.0 - i * 0.35;
        n++;
      }
    }
    void dt;
    const g = this.points.geometry as THREE.BufferGeometry;
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aCol as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the lot

/** Burning hulls are the loudest thing on screen, so they get their own fixed budget. */
const FIRE_SLOTS = 8;
/** Seconds between emissions per fire. 8 fires x 5.2/s x ~8.5 s life = ~350 live puffs. */
const FIRE_TICK = 0.19;
/** A steady wind so every column leans the same way instead of drifting at random. */
const WIND_X = 5.5;
const WIND_Z = -3.0;

export class FX {
  private pool: Pool;
  private shells: ShellLayer;
  private torps: TorpLayer;
  private columns: ColumnPool;
  private muzzleEffects: MuzzleEffects;
  private glow: Pool;
  private decals: DecalPool;
  private wakeT = 0;
  private smokeEmit = 0;
  private smokeT = new Map<number, number>();
  private fireT = new Map<number, number>();
  private fireCount = 0;

  constructor(scene: THREE.Scene) {
    const tex = dotTexture();
    this.pool = new Pool(scene, 3600, tex);
    this.glow = new Pool(scene, 320, tex, true);
    this.shells = new ShellLayer(scene, 600, tex);
    this.torps = new TorpLayer(scene, 400, tex);
    this.columns = new ColumnPool(scene);
    this.muzzleEffects = new MuzzleEffects(scene);
    this.decals = new DecalPool(scene);
  }

  /** White columns of water thrown up by a shell that missed. */
  splash(x: number, z: number, cal: number, over: boolean): void {
    const k = clamp(cal / 406, 0.25, 1.2);
    this.columns.spawn(x, z, k);
    // the column: a handful of heavy particles thrown high, which is what you actually see from
    // the bridge seven kilometres away
    const col = 8 + Math.round(k * 14);
    for (let i = 0; i < col; i++) {
      const a = rand(0, TAU);
      const r = rand(0, 2 + k * 5);
      this.pool.spawn({
        x: x + Math.cos(a) * r,
        y: rand(0, 2),
        z: z + Math.sin(a) * r,
        vx: Math.cos(a) * rand(1, 4),
        vy: rand(38, 68) * (0.7 + k * 0.5),
        vz: Math.sin(a) * rand(1, 4),
        max: rand(1.6, 2.6) * (0.7 + k * 0.5),
        size: 5 + k * 9,
        grow: 10 + k * 18,
        grav: -26,
        drag: 0.35,
        r: 0.95,
        g: 0.97,
        b: 1.0,
        a0: 0.95,
      });
    }
    // the spray thrown out and down around it
    const n = 14 + Math.round(k * 30);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const r = rand(1, 4 + k * 10);
      this.pool.spawn({
        x: x + Math.cos(a) * r,
        y: rand(0, 3),
        z: z + Math.sin(a) * r,
        vx: Math.cos(a) * rand(4, 14) * (0.5 + k),
        vy: rand(6, 22) * (0.6 + k * 0.6),
        vz: Math.sin(a) * rand(4, 14) * (0.5 + k),
        max: rand(1.3, 2.2) * (0.7 + k * 0.6),
        size: 3 + k * 7,
        grow: 8 + k * 14,
        grav: -22,
        drag: 0.9,
        r: 0.92,
        g: 0.96,
        b: 1.0,
        a0: 0.9,
      });
    }
    // a lingering patch of disturbed water
    this.pool.spawn({
      x,
      y: 1.2,
      z,
      vx: 0,
      vy: 0.4,
      vz: 0,
      max: 2.8,
      size: 16 + k * 40,
      grow: 30 + k * 55,
      grav: 0,
      drag: 1.2,
      r: 0.8,
      g: 0.88,
      b: 0.92,
      a0: 0.5,
    });
    if (over) {
      // a shell that went over throws a taller, thinner column still
      for (let i = 0; i < 10; i++)
        this.pool.spawn({
          x: x + rand(-4, 4),
          y: 0,
          z: z + rand(-4, 4),
          vx: rand(-2, 2),
          vy: rand(50, 80),
          vz: rand(-2, 2),
          max: rand(1.6, 2.6),
          size: 3 + k * 5,
          grow: 4,
          grav: -24,
          drag: 0.4,
          r: 0.95,
          g: 0.97,
          b: 1,
          a0: 0.85,
        });
    }
  }

  /** A flak burst: a sooty puff that hangs and disperses, with a one-frame core flash. */
  flak(x: number, y: number, z: number, heavy: boolean): void {
    const n = heavy ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), rr = rand(0, heavy ? 10 : 6);
      this.pool.spawn({
        x: x + Math.cos(a) * rr,
        y: y + rand(-3, 3),
        z: z + Math.sin(a) * rr,
        vx: rand(-2.5, 2.5),
        vy: rand(-1.2, 1.2),
        vz: rand(-2.5, 2.5),
        max: rand(1.2, heavy ? 1.8 : 1.5),
        // Point sizes are "pixels at 420 m": flak must read as a 10-20 m cloud from 3 km.
        size: (heavy ? 92 : 68) + rand(0, 18),
        grow: heavy ? 120 : 88,
        grav: 0.6,
        drag: 1.4,
        r: 0.12,
        g: 0.115,
        b: 0.11,
        a0: 0.85,
      });
    }
    this.pool.spawn({
      x, y, z, max: 0.18, size: heavy ? 70 : 48, grow: 10, grav: 0, drag: 2,
      r: 1, g: 0.86, b: 0.6, a0: 0.9,
    });
  }

  /** A hit: white-hot core, orange flash, sparks, black smoke, and a crater in the hull. */
  hit(
    x: number,
    y: number,
    z: number,
    cal: number,
    victim?: Ship | null,
    lx?: number,
    ly?: number,
    lz?: number,
  ): void {
    const k = clamp(cal / 406, 0.3, 1.2);
    if (victim && lx !== undefined && ly !== undefined && lz !== undefined) {
      this.decals.add(victim, lx, ly, lz, cal);
    }
    // the one-frame core: without it a hit reads as "a puff", not "a detonation"
    this.glow.spawn({
      x, y, z, max: rand(0.07, 0.13), size: 26 + k * 30, grow: 14, grav: 0, drag: 2,
      r: 1, g: 0.94, b: 0.82, a0: 1,
    });
    for (let i = 0; i < 12 + k * 20; i++) {
      const a = rand(0, TAU);
      this.pool.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * rand(6, 26) * (0.5 + k),
        vy: rand(4, 26) * (0.5 + k),
        vz: Math.sin(a) * rand(6, 26) * (0.5 + k),
        max: rand(0.25, 0.6),
        size: 4 + k * 8,
        grow: 10 + k * 16,
        grav: -6,
        drag: 1.6,
        r: 1,
        g: rand(0.6, 0.9),
        b: rand(0.25, 0.5),
        a0: 1,
      });
    }
    // sparks: small, fast, and thrown out along the surface
    for (let i = 0; i < 8 + k * 10; i++) {
      const a = rand(0, TAU);
      this.glow.spawn({
        x, y, z,
        vx: Math.cos(a) * rand(8, 34) * (0.5 + k),
        vy: rand(6, 30) * (0.5 + k),
        vz: Math.sin(a) * rand(8, 34) * (0.5 + k),
        max: rand(0.25, 0.55),
        size: rand(1.4, 3.2) * (0.7 + k * 0.5),
        grow: -1,
        grav: -18,
        drag: 0.7,
        r: 1,
        g: rand(0.5, 0.75),
        b: rand(0.2, 0.35),
        a0: 0.95,
      });
    }
    // the smoke that comes back out of the hole and hangs over the deck
    for (let i = 0; i < 8 + k * 12; i++) {
      this.pool.spawn({
        x: x + rand(-2, 2),
        y: y + rand(-1, 3),
        z: z + rand(-2, 2),
        vx: rand(-4, 4) + WIND_X * 0.35,
        vy: rand(6, 16),
        vz: rand(-4, 4) + WIND_Z * 0.35,
        max: rand(2.4, 4.2),
        size: 8 + k * 12,
        grow: 34 + k * 26,
        grav: 1.6,
        drag: 0.75,
        r: 0.12,
        g: 0.12,
        b: 0.13,
        a0: 0.72,
        fade: 1.2,
      });
    }
  }

  /** One burning point on a hull: a rising core, a fat billow, and a flicker of flame. */
  private emitFire(x: number, y: number, z: number): void {
    this.pool.spawn({
      x, y, z,
      vx: WIND_X * 0.5 + rand(-1, 1),
      vy: rand(14, 20),
      vz: WIND_Z * 0.5 + rand(-1, 1),
      max: rand(2.2, 3.2),
      size: 10,
      grow: 40,
      grav: 3.5,
      drag: 1.3,
      r: 0.07,
      g: 0.07,
      b: 0.08,
      a0: 0.72,
      fade: 0.9,
    });
    this.pool.spawn({
      x: x + rand(-2, 2),
      y: y + rand(-1, 2),
      z: z + rand(-2, 2),
      vx: WIND_X + rand(-1.5, 1.5),
      vy: rand(16, 24),
      vz: WIND_Z + rand(-1.5, 1.5),
      max: rand(7, 11),
      size: 26,
      grow: 110,
      grav: 2.4,
      drag: 0.35,
      r: 0.12,
      g: 0.105,
      b: 0.095,
      a0: 0.74,
      fade: 0.85,
    });
    this.glow.spawn({
      x, y: y + 1, z,
      max: rand(0.5, 0.85), size: rand(24, 40), grow: 8, grav: 5, drag: 2,
      r: 1, g: 0.55, b: 0.18, a0: 0.95,
    });
    this.glow.spawn({
      x, y: y + 1.5, z,
      max: rand(0.25, 0.45), size: rand(36, 58), grow: 14, grav: 5, drag: 3,
      r: 1, g: 0.36, b: 0.09, a0: 0.75,
    });
    if (Math.random() < 0.5) {
      this.glow.spawn({
        x: x + rand(-2, 2), y: y + rand(0, 3), z: z + rand(-2, 2),
        vx: rand(-3, 3), vy: rand(6, 14), vz: rand(-3, 3),
        max: rand(0.6, 1.2), size: rand(1.6, 3.4), grav: -4, drag: 0.5,
        r: 1, g: 0.62, b: 0.24, a0: 0.9,
      });
    }
  }

  /** One real barrel tip, bearing/elevation in radians; elevation defaults to horizontal. */
  muzzle(x: number, y: number, z: number, bearing: number, cal: number, elevation = 0): void {
    this.muzzleEffects.emit(x, y, z, bearing, cal, elevation);
  }

  /** A ship blowing up as she goes down. */
  explosion(x: number, y: number, z: number, big: boolean): void {
    const k = big ? 1.6 : 1;
    for (let i = 0; i < 40 * k; i++) {
      const a = rand(0, TAU);
      this.pool.spawn({
        x,
        y: y + rand(-2, 6),
        z,
        vx: Math.cos(a) * rand(10, 60) * k,
        vy: rand(10, 60) * k,
        vz: Math.sin(a) * rand(10, 60) * k,
        max: rand(0.4, 1.1),
        size: 8 + rand(0, 18) * k,
        grow: 20 * k,
        grav: -8,
        drag: 1.3,
        r: 1,
        g: rand(0.5, 0.85),
        b: rand(0.2, 0.45),
        a0: 1,
      });
    }
    for (let i = 0; i < 30 * k; i++) {
      this.pool.spawn({
        x: x + rand(-8, 8),
        y: y + rand(0, 12),
        z: z + rand(-8, 8),
        vx: rand(-10, 10),
        vy: rand(12, 40),
        vz: rand(-10, 10),
        max: rand(3, 7),
        size: 16 + rand(0, 22),
        grow: 40,
        grav: 1.4,
        drag: 0.7,
        r: 0.14,
        g: 0.14,
        b: 0.15,
        a0: 0.8,
      });
    }
  }

  /** Wake and funnel smoke, emitted a little at a time. */
  ships(dt: number, list: Ship[], water: Water): void {
    this.wakeT += dt;
    const emit = this.wakeT > 0.05;
    if (emit) this.wakeT = 0;
    for (const s of list) {
      if (s.removed) continue;
      const spd = Math.abs(s.speed) / s.maxV;
      if (emit && s.alive && spd > 0.05) {
        // stern wake: jittered in position, size and life so it never reads as a row of dots
        const [wx, wz] = s.toWorld(rand(-1, 1) * s.spec.B * 0.55, -s.spec.L * 0.5 - rand(0, 12));
        this.pool.spawn({
          x: wx,
          y: water.height(wx, wz, 0) + rand(0.2, 1.4),
          z: wz,
          vx: rand(-3, 3) - s.vx * 0.05,
          vy: rand(0.2, 1.2),
          vz: rand(-3, 3) - s.vz * 0.05,
          max: rand(1.4, 3.4) * (0.5 + spd),
          size: rand(2, 5) + spd * 4,
          grow: rand(5, 11) + spd * 6,
          grav: 0.2,
          drag: 1.1,
          r: 0.86,
          g: 0.9,
          b: 0.92,
          a0: 0.3 * clamp(spd, 0, 1),
        });
        // bow spray, thrown up and outboard
        if (spd > 0.35 && Math.random() < 0.55) {
          const side = Math.random() < 0.5 ? 1 : -1;
          const [bx, bz] = s.toWorld(side * s.spec.B * rand(0.25, 0.5), s.spec.L * rand(0.36, 0.5));
          this.pool.spawn({
            x: bx,
            y: water.height(bx, bz, 0) + rand(0.5, 2),
            z: bz,
            vx: side * rand(3, 9) - s.vx * 0.05,
            vy: rand(2, 6),
            vz: rand(-3, 3),
            max: rand(0.7, 1.6),
            size: rand(2, 4) + spd * 3,
            grow: rand(6, 14),
            grav: -14,
            drag: 1.2,
            r: 0.93,
            g: 0.96,
            b: 0.98,
            a0: 0.4 * clamp(spd, 0, 1),
          });
        }
        // funnel smoke, on a slower timer than the wake
        this.smokeEmit += dt;
        if (this.smokeEmit > 0.16) {
          this.smokeEmit = 0;
          const [fx, fz] = s.toWorld(0, 0);
          this.pool.spawn({
            x: fx,
            y: s.spec.F + s.spec.top * 0.45,
            z: fz,
            vx: rand(-1, 1) + s.vx * 0.1,
            vy: rand(2, 5),
            vz: rand(-1, 1) + s.vz * 0.1,
            max: rand(2.5, 5),
            size: 3,
            grow: 9,
            grav: 0.8,
            drag: 0.7,
            r: 0.42,
            g: 0.42,
            b: 0.44,
            a0: 0.13,
          });
        }
      }
      // damage smoke: a ship that is hurt but not yet ablaze still leaves a trail
      const hurt = 1 - s.hp / s.maxHp;
      if (s.alive && hurt > 0.25 && s.fires.length === 0) {
        this.smokeT.set(s.id, (this.smokeT.get(s.id) || 0) + dt);
        if (this.smokeT.get(s.id)! > 0.2) {
          this.smokeT.set(s.id, 0);
          const [sx, sz] = s.toWorld(rand(-0.25, 0.25) * s.spec.B, rand(-0.35, 0.35) * s.spec.L);
          this.pool.spawn({
            x: sx,
            y: s.bob + s.spec.F + 2,
            z: sz,
            vx: WIND_X * 0.6 + rand(-1.5, 1.5),
            vy: rand(5, 9),
            vz: WIND_Z * 0.6 + rand(-1.5, 1.5),
            max: rand(5, 7),
            size: 9,
            grow: 44,
            grav: 2,
            drag: 0.7,
            r: 0.16,
            g: 0.155,
            b: 0.15,
            a0: 0.3,
            fade: 1.1,
          });
        }
      }
    }

    // Fires get a hard global budget: past eight burning points the far ones simply do not
    // emit. Each emitter is staggered by a random phase so they never pulse in unison.
    let slots = 0;
    for (const s of list) {
      if (slots >= FIRE_SLOTS) break;
      if (!s.alive || s.removed) continue;
      for (let i = 0; i < s.fires.length && slots < FIRE_SLOTS; i++) {
        const f = s.fires[i];
        const key = s.id * 4 + i;
        let acc = this.fireT.get(key);
        if (acc === undefined) acc = -rand(0, FIRE_TICK);
        acc += dt;
        if (acc >= FIRE_TICK) {
          acc -= FIRE_TICK;
          const [fx, fz] = s.toWorld(f.lx, f.lz);
          this.emitFire(fx, s.bob + deckY(s.spec, f.lz) + 3, fz);
        }
        this.fireT.set(key, acc);
        slots++;
      }
    }
    this.fireCount = slots;
    this.decals.update();
  }

  update(dt: number, t: number, shells: Shell[], torps: Torpedo[]): void {
    this.pool.update(dt);
    this.glow.update(dt);
    this.muzzleEffects.update(dt);
    this.columns.update(dt);
    this.shells.update(shells);
    this.torps.update(torps, dt, t);
  }

  /** Clear all transient visuals and emit timers when restarting a battle. */
  reset(): void {
    this.pool.reset();
    this.glow.reset();
    this.decals.reset();
    this.muzzleEffects.reset();
    this.columns.reset();
    this.shells.points.geometry.setDrawRange(0, 0);
    this.torps.points.geometry.setDrawRange(0, 0);
    this.wakeT = this.smokeEmit = 0;
    this.smokeT.clear();
    this.fireT.clear();
    this.fireCount = 0;
  }

  stats() {
    return {
      particles: this.pool.count,
      glow: this.glow.count,
      fires: this.fireCount,
      decals: this.decals.count,
      columns: this.columns.count,
      shells: this.shells.points.geometry.drawRange.count,
      torpedoWakePoints: this.torps.points.geometry.drawRange.count,
      muzzle: this.muzzleEffects.stats(),
    };
  }
}
