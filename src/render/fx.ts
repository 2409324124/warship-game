// Effects: shell splashes, shell hits, muzzle blasts, funnel and damage smoke, wakes, and the
// shells themselves in flight. Everything is pooled - no allocation during a battle.

import * as THREE from 'three';
import { clamp, rand, TAU } from '../sim/constants';
import type { Ship } from '../sim/ship';
import type { Shell } from '../sim/gunnery';
import type { Torpedo } from '../sim/torpedo';
import type { Water } from './water';
import { MuzzleEffects } from './muzzle';

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
  // aSize is the sprite's pixel size at 420 m. Clamped, or a puff of funnel smoke ten metres from
  // the camera becomes a screen-filling grey blob.
  gl_PointSize = min(aSize * (420.0 / max(1.0, -mv.z)), 72.0);
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
}

class Pool {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private n = 0;

  constructor(scene: THREE.Scene, max: number, tex: THREE.Texture) {
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
      blending: THREE.NormalBlending,
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
      const a = p.a0 * (1 - t) * (1 - t);
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
      this.size[n] = 2.4 + (s.gun.cal / 406) * 3.4;
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

export class FX {
  private pool: Pool;
  private shells: ShellLayer;
  private torps: TorpLayer;
  private columns: ColumnPool;
  private muzzleEffects: MuzzleEffects;
  private wakeT = 0;
  private smokeEmit = 0;
  private smokeT = new Map<number, number>();

  constructor(scene: THREE.Scene) {
    const tex = dotTexture();
    this.pool = new Pool(scene, 3000, tex);
    this.shells = new ShellLayer(scene, 600, tex);
    this.torps = new TorpLayer(scene, 400, tex);
    this.columns = new ColumnPool(scene);
    this.muzzleEffects = new MuzzleEffects(scene);
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

  /** A hit: orange flash, black smoke, and debris. */
  hit(x: number, y: number, z: number, cal: number): void {
    const k = clamp(cal / 406, 0.3, 1.2);
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
    for (let i = 0; i < 8 + k * 14; i++) {
      this.pool.spawn({
        x: x + rand(-2, 2),
        y: y + rand(-1, 3),
        z: z + rand(-2, 2),
        vx: rand(-4, 4),
        vy: rand(6, 18),
        vz: rand(-4, 4),
        max: rand(1.6, 3.4),
        size: 8 + k * 14,
        grow: 26 + k * 30,
        grav: 1.2,
        drag: 0.8,
        r: 0.18,
        g: 0.18,
        b: 0.19,
        a0: 0.7,
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
      // damage smoke and fire
      const hurt = 1 - s.hp / s.maxHp;
      if (s.alive && hurt > 0.25) {
        this.smokeT.set(s.id, (this.smokeT.get(s.id) || 0) + dt);
        if (this.smokeT.get(s.id)! > 0.12) {
          this.smokeT.set(s.id, 0);
          const [sx, sz] = s.toWorld(rand(-0.3, 0.3) * s.spec.B, rand(-0.3, 0.3) * s.spec.L);
          const burning = s.fires.length > 0;
          this.pool.spawn({
            x: sx,
            y: s.spec.F + 3,
            z: sz,
            vx: rand(-2, 2),
            vy: rand(4, 10),
            vz: rand(-2, 2),
            max: rand(2, 4),
            size: 4,
            grow: 12,
            grav: 1.2,
            drag: 0.8,
            r: burning ? 0.5 : 0.2,
            g: burning ? 0.28 : 0.2,
            b: burning ? 0.2 : 0.21,
            a0: 0.35 + hurt * 0.4,
          });
        }
      }
    }
  }

  update(dt: number, t: number, shells: Shell[], torps: Torpedo[]): void {
    this.pool.update(dt);
    this.muzzleEffects.update(dt);
    this.columns.update(dt);
    this.shells.update(shells);
    this.torps.update(torps, dt, t);
  }

  /** Clear all transient visuals and emit timers when restarting a battle. */
  reset(): void {
    this.pool.reset();
    this.muzzleEffects.reset();
    this.columns.reset();
    this.shells.points.geometry.setDrawRange(0, 0);
    this.torps.points.geometry.setDrawRange(0, 0);
    this.wakeT = this.smokeEmit = 0;
    this.smokeT.clear();
  }

  stats() {
    return {
      particles: this.pool.count,
      columns: this.columns.count,
      shells: this.shells.points.geometry.drawRange.count,
      torpedoWakePoints: this.torps.points.geometry.drawRange.count,
      muzzle: this.muzzleEffects.stats(),
    };
  }
}
