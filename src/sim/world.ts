// The world: one battle. Owns every ship, shell and torpedo, steps them, and describes whatever
// happened as an event so the page can play it. No three.js, no DOM - this file can run anywhere.

import { angDiff, clamp, DEG, rand } from './constants.ts';
import { fireTurret, updateShells, updateTurrets, secondaryLogic } from './gunnery.ts';
import { launchFan, updateTorps } from './torpedo.ts';
import { Ship } from './ship.ts';
import { updatePlanes } from './aircraft.ts';
import { aaLogic } from './aa.ts';
import type { Shell } from './gunnery.ts';
import type { Torpedo } from './torpedo.ts';
import type { Campaign } from './campaign.ts';

export type Difficulty = 'cadet' | 'captain' | 'admiral';

export const DIFF: Record<Difficulty, { aiErr: number; dmgTaken: number; name: string }> = {
  cadet: { aiErr: 1.45, dmgTaken: 0.65, name: '见习' },
  captain: { aiErr: 1.0, dmgTaken: 1.0, name: '舰长' },
  admiral: { aiErr: 0.68, dmgTaken: 1.15, name: '提督' },
};

export interface SimEvent {
  k: string;
  t: number;
  [key: string]: unknown;
}

export interface WorldOpts {
  diff?: Difficulty;
  onEvent?: (e: SimEvent) => void;
  foe?: string;
}

export class World {
  diff: Difficulty;
  onEvent: ((e: SimEvent) => void) | null;
  foe: string;
  campaign: Campaign | null = null;

  ships: Ship[] = [];
  shells: Shell[] = [];
  torps: Torpedo[] = [];
  planes: import('./aircraft.ts').Plane[] = [];

  time = 0;
  /** Enemy aircraft shot down in this battle. */
  planesDown = 0;
  seq = 0;
  sseq = 0;
  tseq = 0;
  pseq = 0;
  salvoSeq = 0;

  constructor(o: WorldOpts = {}) {
    this.diff = o.diff || 'captain';
    this.onEvent = o.onEvent || null;
    this.foe = o.foe || 'JP';
  }

  emit(k: string, d: Record<string, unknown> = {}): void {
    if (this.onEvent) {
      (d as SimEvent).k = k;
      (d as SimEvent).t = this.time;
      this.onEvent(d as SimEvent);
    }
  }

  add(s: Ship): Ship {
    this.ships.push(s);
    return s;
  }

  byId(id: number): Ship | null {
    for (const s of this.ships) if (s.id === id) return s;
    return null;
  }

  /** Difficulty leans on whichever navy the computer plays. */
  aiErr(team: string): number {
    return team === this.foe ? DIFF[this.diff].aiErr : 1;
  }

  dmgMul(target: Ship, srcTeam: string): number {
    return target.team !== this.foe && srcTeam === this.foe ? DIFF[this.diff].dmgTaken : 1;
  }

  step(dt: number, play: boolean): void {
    this.time += dt;
    if (play) {
      for (const s of this.ships) {
        if (!s.alive) continue;
        if (s.ai) s.ai.update(dt);
        else if (s.isPlayer) {
          if (s.secGun) secondaryLogic(this, s);
          for (let i = 0; i < s.torpReady.length; i++) s.torpReady[i] -= dt;
        }
      }
    }
    for (const s of this.ships) s.physics(dt);
    shipCollisions(this);
    for (const s of this.ships) {
      if (!s.removed) updateTurrets(s, dt);
      if (!s.alive && !s.removed) {
        s.sinkT += dt;
        if (s.sinkT > 16) s.remove();
      }
    }
    updateShells(this, dt);
    updateTorps(this, dt);
    updatePlanes(this, dt);
    if (play) for (const s of this.ships) if (s.alive) aaLogic(this, s, dt);
    if (this.ships.some((s) => s.removed)) this.ships = this.ships.filter((s) => !s.removed || s.isPlayer);
  }
}

// ------------------------------------------------------------------ the captain's orders

/**
 * Fire the main battery. `err` is the extra 1-sigma spread in metres from an unsettled rangefinder;
 * a well-converged solution passes 0.
 */
export function playerFire(w: World, P: Ship, ax: number, az: number, err = 0): void {
  if (!P.alive) return;
  const say = (msg: string) => w.emit('hint', { id: P.id, msg });
  const ready = P.mainTurrets.filter((t) => t.reload <= 0);
  const aimed = ready.filter((t) => t.onTarget);
  if (!aimed.length) {
    say(!ready.length ? '主炮装填中' : P.mainTurrets.some((t) => t.inArc) ? '炮塔转向中' : '目标不在射界内');
    return;
  }
  for (const t of aimed) fireTurret(w, P, t, ax, az, err);
  if (Math.hypot(ax - P.x, az - P.z) > P.gun.range) say('超出射程，已按最大射程发射');
}

export function playerTorpedo(w: World, P: Ship, ax: number, az: number): void {
  if (!P.alive || !P.torp) return;
  const say = (msg: string) => w.emit('hint', { id: P.id, msg });
  const yaw = Math.atan2(ax - P.x, az - P.z);
  const rel = Math.abs(angDiff(P.heading, yaw));
  if (rel < 25 * DEG || rel > 155 * DEG) {
    say('鱼雷需侧向发射，转向舷侧');
    return;
  }
  const m = P.torpReady.findIndex((v) => v <= 0);
  if (m < 0) {
    say('鱼雷装填中');
    return;
  }
  launchFan(w, P, yaw);
  P.torpReady[m] = P.torp.reload;
}

export function cmdDC(w: World, P: Ship): void {
  const ok = P.useDC();
  w.emit('dc', { id: P.id, ok: ok ? 1 : 0, none: P.dc.charges <= 0 ? 1 : 0 });
}

// ------------------------------------------------------------------ hull-to-hull

function segClosest(
  p1x: number,
  p1z: number,
  q1x: number,
  q1z: number,
  p2x: number,
  p2z: number,
  q2x: number,
  q2z: number,
): { s: number; t: number; d: number } {
  const d1x = q1x - p1x,
    d1z = q1z - p1z;
  const d2x = q2x - p2x,
    d2z = q2z - p2z;
  const rx = p1x - p2x,
    rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  const c = d1x * rx + d1z * rz;
  const b = d1x * d2x + d1z * d2z;
  const den = a * e - b * b;
  let s = den !== 0 ? clamp((b * f - c * e) / den, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a, 0, 1);
  }
  const x1 = p1x + d1x * s,
    z1 = p1z + d1z * s;
  const x2 = p2x + d2x * t,
    z2 = p2z + d2z * t;
  return { s, t, d: Math.hypot(x2 - x1, z2 - z1) };
}

function shipCollisions(w: World): void {
  const ships = w.ships;
  for (let i = 0; i < ships.length; i++) {
    const A = ships[i];
    if (!A.alive) continue;
    for (let j = i + 1; j < ships.length; j++) {
      const B = ships[j];
      if (!B.alive) continue;
      const dx = B.x - A.x,
        dz = B.z - A.z;
      const rr = (A.spec.L + B.spec.L) / 2;
      if (dx * dx + dz * dz > rr * rr) continue;
      const ha = A.spec.L / 2 - A.spec.B / 2,
        hb = B.spec.L / 2 - B.spec.B / 2;
      const sa = Math.sin(A.heading),
        ca = Math.cos(A.heading);
      const sb = Math.sin(B.heading),
        cb = Math.cos(B.heading);
      const p1 = segClosest(
        A.x - sa * ha,
        A.z - ca * ha,
        A.x + sa * ha,
        A.z + ca * ha,
        B.x - sb * hb,
        B.z - cb * hb,
        B.x + sb * hb,
        B.z + cb * hb,
      );
      const x1 = A.x - sa * ha + (A.x + sa * ha - (A.x - sa * ha)) * p1.s;
      const z1 = A.z - ca * ha + (A.z + ca * ha - (A.z - ca * ha)) * p1.s;
      const x2 = B.x - sb * hb + (B.x + sb * hb - (B.x - sb * hb)) * p1.t;
      const z2 = B.z - cb * hb + (B.z + cb * hb - (B.z - cb * hb)) * p1.t;
      const nx = x2 - x1,
        nz = z2 - z1;
      const d = Math.hypot(nx, nz) || 0.01;
      const min = (A.spec.B + B.spec.B) / 2;
      if (d < min) {
        const push = (min - d) / 2,
          ux = nx / d,
          uz = nz / d;
        A.x -= ux * push;
        A.z -= uz * push;
        B.x += ux * push;
        B.z += uz * push;
        const rel = Math.hypot(A.vx - B.vx, A.vz - B.vz);
        if (rel > 6 && A.team !== B.team) {
          const dmg = rel * 6;
          A.damage(dmg * Math.sqrt(B.spec.tons / A.spec.tons) * 0.5, B, 'ram');
          B.damage(dmg * Math.sqrt(A.spec.tons / B.spec.tons) * 0.5, A, 'ram');
          w.emit('ram', { a: A.id, b: B.id, dmg });
        }
        const vn = (A.vx - B.vx) * ux + (A.vz - B.vz) * uz;
        if (vn > 0) {
          const J = (1.15 * vn) / (1 / A.spec.tons + 1 / B.spec.tons);
          const ka = J / A.spec.tons,
            kb = J / B.spec.tons;
          const pa = sa * ux + ca * uz,
            pb = sb * ux + cb * uz;
          A.shx -= ka * pa * sa;
          A.shz -= ka * pa * ca;
          B.shx += kb * pb * sb;
          B.shz += kb * pb * cb;
        }
      }
    }
  }
}

/** Used by the menu preview: a lone ship steaming in circles. */
export function makeDrone(w: World, key: string, team: string, name: string): Ship {
  const s = w.add(new Ship(w, key, team, name, { x: 0, z: 0, heading: 0.9, speedFrac: 0.5 }));
  s.rudderCmd = 0.25 * rand(-1, 1);
  return s;
}
