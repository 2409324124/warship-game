// Bow wave and wake, made the way water interaction is usually made: sample the hull at the
// waterline and throw particles from there. Each particle is born on the current wave surface and
// falls back into it, so the foam conforms to the sea without any authored mesh, any ribbon that
// has to be re-floated every frame, or any per-pixel work in the water shader.

import { clamp, rand } from '../sim/constants.ts';
import { halfWL } from '../sim/hull.ts';
import type { Ship } from '../sim/ship';
import type { Water } from './water';

export interface ParticleSink {
  spawn(p: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    max: number;
    size: number;
    grow?: number;
    drag?: number;
    grav?: number;
    r: number;
    g: number;
    b: number;
    a0: number;
    fade?: number;
  }): void;
}

interface HullPlan {
  L: number;
  B: number;
}

/** A point on the hull's waterline, plus the outward normal there, in hull-local space. */
export function waterlinePoint(
  spec: HullPlan,
  s: number,
  side: 1 | -1,
): { lx: number; lz: number; nx: number; nz: number } {
  const st = clamp(s, 0, 1);
  const hw = halfWL(st) * spec.B * 0.5;
  const lz = (st - 0.5) * spec.L;
  // d(half breadth)/d(station), turned into a forward lean: the finer the bow, the more the
  // normal points ahead, which is what gives the spray its V.
  const h = 0.008;
  const d = (halfWL(clamp(st + h, 0, 1)) - halfWL(clamp(st - h, 0, 1))) / (2 * h);
  let nz = (-d * spec.B * 0.5) / spec.L;
  // The stem itself is nearly parallel to +z; bias it so the last station still throws ahead.
  nz += Math.max(0, st - 0.86) * 2.2;
  const len = Math.hypot(1, nz) || 1;
  return { lx: side * hw, lz, nx: side / len, nz: nz / len };
}

/** How hard the hull is working the water, 0 (stopped) to 1 (full speed). */
export function wakeRate(spd: number): number {
  return clamp((spd - 0.03) / 0.67, 0, 1);
}

/** Stations, bow to stern. Fractions of hull length from the stern. */
const BOW = [0.88, 0.97];
const BAND = [0.5, 0.62, 0.72, 0.82, 0.91];
const SIDE = [0.25, 0.45];

/** Emissions per second at full speed, summed over both sides. */
const RATE_BOW = 32;
const RATE_BAND = 30;
const RATE_SIDE = 8;
const RATE_WAKE = 8; // x3 particles per emission

const NEAR = 1800;
const FAR = 3500;

interface Budget {
  bow: number;
  band: number;
  side: number;
  wake: number;
}

/** Ring of expiry times, only so the debug readout can report a true live count. */
const TRACK = 1024;

export class Spray {
  private sink: ParticleSink;
  private budget = new Map<number, Budget>();
  private expiry = new Float32Array(TRACK);
  private head = 0;
  private clock = 0;
  private live = 0;

  constructor(sink: ParticleSink) {
    this.sink = sink;
  }

  get count(): number {
    return this.live;
  }

  reset(): void {
    this.budget.clear();
    this.expiry.fill(0);
    this.head = 0;
    this.clock = 0;
    this.live = 0;
  }

  /** Particles must sit on the surface the player actually sees, not the analytic one. */
  private surface(water: Water, x: number, z: number, t: number): number {
    return water.renderHeight ? water.renderHeight(x, z, t) : water.height(x, z, t);
  }

  private track(max: number): void {
    this.expiry[this.head] = this.clock + max;
    this.head = (this.head + 1) % TRACK;
  }

  update(dt: number, t: number, ships: readonly Ship[], water: Water, eye: { x: number; z: number }): void {
    this.clock += dt;
    for (const s of ships) {
      if (s.removed || !s.alive) continue;
      const spd = Math.abs(s.speed) / s.maxV;
      const k = wakeRate(spd);
      if (k <= 0) continue;

      // Distant hulls are a few pixels wide: thin their spray out instead of paying for it.
      const d2 = (s.x - eye.x) ** 2 + (s.z - eye.z) ** 2;
      const far = s.isPlayer ? 1 : d2 > FAR * FAR ? 0 : d2 > NEAR * NEAR ? 0.4 : 1;
      if (far <= 0) continue;

      let b = this.budget.get(s.id);
      if (!b) {
        b = { bow: 0, band: 0, side: 0, wake: 0 };
        this.budget.set(s.id, b);
      }
      const dtf = dt * far;

      b.bow += RATE_BOW * k * dtf;
      while (b.bow >= 1) {
        b.bow -= 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        this.bow(s, k, water, t, side, BOW[(Math.random() * BOW.length) | 0]);
      }

      b.band += RATE_BAND * k * dtf;
      while (b.band >= 1) {
        b.band -= 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        this.band(s, k, water, t, side, BAND[(Math.random() * BAND.length) | 0]);
      }

      if (k > 0.45) {
        b.side += RATE_SIDE * k * dtf;
        while (b.side >= 1) {
          b.side -= 1;
          const side = Math.random() < 0.5 ? 1 : -1;
          this.side(s, k, water, t, side, SIDE[(Math.random() * SIDE.length) | 0]);
        }
      }

      b.wake += RATE_WAKE * k * dtf;
      while (b.wake >= 1) {
        b.wake -= 1;
        this.wake(s, k, water, t);
      }
    }

    let live = 0;
    for (let i = 0; i < TRACK; i++) if (this.expiry[i] > this.clock) live++;
    this.live = live;
  }

  /** Broken water thrown up and outboard from the stem. */
  private bow(s: Ship, k: number, water: Water, t: number, side: 1 | -1, st: number): void {
    const p = waterlinePoint(s.spec, st, side);
    const [wx, wz] = s.toWorld(p.lx, p.lz);
    const y = this.surface(water, wx, wz, t);
    const c = Math.cos(s.heading), sn = Math.sin(s.heading);
    const nx = p.nx * c + p.nz * sn;
    const nz = -p.nx * sn + p.nz * c;
    const out = rand(1.6, 4.6) * (0.4 + k * 0.8);
    const vy = rand(2.6, 6.4) * (0.45 + k * 0.75);
    // dies exactly as it falls back into the sea, so nothing ever hangs in the air
    const max = (2 * vy) / 14 * rand(0.9, 1.15);
    this.track(max);
    this.sink.spawn({
      x: wx,
      y: y + rand(0.1, 0.8),
      z: wz,
      vx: nx * out + s.vx * 0.45 + rand(-0.9, 0.9),
      vy,
      vz: nz * out + s.vz * 0.45 + rand(-0.9, 0.9),
      max,
      size: 4 + k * 5,
      grow: 12 + k * 16,
      grav: -14,
      drag: 0.5,
      r: 0.93, g: 0.97, b: 0.99,
      a0: 0.95,
      fade: 0.8,
    });
  }

  /** The white wall that spreads outward along the bow and dies down aft. */
  private band(s: Ship, k: number, water: Water, t: number, side: 1 | -1, st: number): void {
    const p = waterlinePoint(s.spec, st, side);
    const [wx, wz] = s.toWorld(p.lx, p.lz);
    const y = this.surface(water, wx, wz, t);
    const c = Math.cos(s.heading), sn = Math.sin(s.heading);
    const nx = p.nx * c + p.nz * sn;
    const nz = -p.nx * sn + p.nz * c;
    const out = rand(0.9, 3.0) * (0.45 + k);
    const max = rand(0.8, 1.4);
    this.track(max);
    this.sink.spawn({
      x: wx + nx * rand(0, 1.2),
      y: y + rand(0.1, 0.7),
      z: wz + nz * rand(0, 1.2),
      vx: nx * out + s.vx * 0.18 + rand(-0.5, 0.5),
      vy: rand(0.1, 0.6),
      vz: nz * out + s.vz * 0.18 + rand(-0.5, 0.5),
      max,
      size: 6 + k * 4,
      grow: 14 + k * 16,
      grav: 0,
      drag: 1.6,
      r: 0.92, g: 0.96, b: 0.99,
      a0: 1,
      fade: 0.75,
    });
  }

  /** Thin churn along the midships waterline. */
  private side(s: Ship, k: number, water: Water, t: number, sideSide: 1 | -1, st: number): void {
    const p = waterlinePoint(s.spec, st, sideSide);
    const [wx, wz] = s.toWorld(p.lx, p.lz);
    const y = this.surface(water, wx, wz, t);
    const c = Math.cos(s.heading), sn = Math.sin(s.heading);
    const nx = p.nx * c + p.nz * sn;
    const nz = -p.nx * sn + p.nz * c;
    const max = rand(0.6, 1.0);
    this.track(max);
    this.sink.spawn({
      x: wx,
      y: y + rand(0.1, 0.5),
      z: wz,
      vx: nx * rand(0.6, 2.4) + s.vx * 0.1,
      vy: rand(0, 0.5),
      vz: nz * rand(0.6, 2.4) + s.vz * 0.1,
      max,
      size: 4 + k * 3,
      grow: 8 + k * 8,
      grav: 0,
      drag: 1.8,
      r: 0.9, g: 0.94, b: 0.97,
      a0: 0.8,
      fade: 0.85,
    });
  }

  /** The trail left behind: born on the surface at the transom and simply abandoned there.
   *  Three abreast so the band is continuous across the beam instead of a string of blobs. */
  private wake(s: Ship, k: number, water: Water, t: number): void {
    for (let i = -1; i <= 1; i++) {
      const lat = (i * 0.33 + rand(-0.07, 0.07)) * s.spec.B;
      const [wx, wz] = s.toWorld(lat, -s.spec.L * 0.48 - rand(0, 3));
      const y = this.surface(water, wx, wz, t);
      const max = rand(3.0, 4.5);
      this.track(max);
      this.sink.spawn({
        x: wx,
        y: y + rand(0.1, 0.7),
        z: wz,
        vx: rand(-0.9, 0.9) + s.vx * 0.05,
        vy: rand(0.05, 0.4),
        vz: rand(-0.9, 0.9) + s.vz * 0.05,
        max,
        size: 6 + k * 4,
        grow: 20 + k * 14,
        grav: 0,
        drag: 0.35,
        r: 0.9,
        g: 0.94,
        b: 0.97,
        a0: 0.72,
        fade: 0.9,
      });
    }
  }
}
