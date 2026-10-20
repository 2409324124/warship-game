// The computer captain: pick a target, hold a useful range, bring the broadside to bear,
// fire when the guns bear, and get out of the way of fish in the water.

import { angDiff, clamp, lerp, rand, randn } from './constants.ts';
import { fireTurret } from './gunnery.ts';
import { SIZE_ERR } from './ships.ts';
import { leadPoint, type Ship } from './ship.ts';
import { intercept, launchFan, torpClear } from './torpedo.ts';
import { terrainH } from './terrain.ts';
import type { World } from './world.ts';

export class AI {
  readonly w: World;
  readonly s: Ship;
  target: Ship | null = null;
  salvos = 0;
  retarget = 0;
  salvoGap = 0;
  side: 1 | -1 = 1;
  evade = 0;

  constructor(w: World, s: Ship) {
    this.w = w;
    this.s = s;
    this.side = Math.random() < 0.5 ? 1 : -1;
  }

  pickTarget(): Ship | null {
    const s = this.s;
    let best: Ship | null = null,
      bs = 1e18;
    for (const o of this.w.ships) {
      if (!o.alive || o.team === s.team) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      const big = s.spec.cls === 'CA' || s.spec.cls === 'BB';
      const sc = d + (o.isPlayer ? -450 : 0) - (o.hp / o.maxHp) * 300 - (big && o.spec.cls === 'BB' ? 400 : 0);
      if (sc < bs) {
        bs = sc;
        best = o;
      }
    }
    return best;
  }

  update(dt: number): void {
    const s = this.s;
    if (!s.alive) return;
    this.retarget -= dt;
    this.salvoGap -= dt;
    if (!this.target || !this.target.alive || this.retarget <= 0) {
      const t = this.pickTarget();
      if (t !== this.target) {
        this.target = t;
        this.salvos = 0;
        this.salvoGap = rand(0.5, 1.5);
      }
      this.retarget = 3;
    }
    const T = this.target;
    if (!T) {
      s.rudderCmd = 0;
      s.throttle = 4;
      return;
    }

    const dx = T.x - s.x,
      dz = T.z - s.z;
    const d = Math.hypot(dx, dz) || 1;
    const bearing = Math.atan2(dx, dz);

    // ---- helm -----------------------------------------------------------
    const pref = s.spec.prefRange;
    const errR = clamp((d - pref) / pref, -1, 1);
    let theta = Math.PI / 2 - errR * 0.6;
    if (this.evade > 0) {
      this.evade -= dt;
      theta = Math.PI / 2 + this.side * 0.5;
    }
    let desired = bearing + this.side * theta;

    // keep out of the shallows
    const L = s.spec.L;
    const blocked = (h: number) => {
      const sx = Math.sin(h),
        sz = Math.cos(h);
      for (const dd of [L * 1.4, L * 2.8, L * 4.4]) if (terrainH(s.x + sx * dd, s.z + sz * dd) > -6) return true;
      return false;
    };
    if (blocked(desired) || blocked(s.heading)) {
      for (const k of [0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
        if (!blocked(s.heading + k)) {
          desired = s.heading + k;
          break;
        }
      }
    }
    // do not ram a friend
    for (const o of this.w.ships) {
      if (o === s || !o.alive) continue;
      const ox = o.x - s.x,
        oz = o.z - s.z;
      const od = Math.hypot(ox, oz);
      if (od > 900) continue;
      const rel = angDiff(s.heading, Math.atan2(ox, oz));
      if (Math.abs(rel) < 0.9) desired = s.heading + (rel > 0 ? -0.8 : 0.8);
    }

    s.rudderCmd = clamp(angDiff(s.heading, desired) * 1.6, -1, 1);
    const wantSpeed = this.evade > 0 ? 6 : errR > 0.05 ? 6 : errR < -0.15 ? 4 : 5;
    s.throttle = clamp(wantSpeed, 2, 6);

    // ---- gunnery --------------------------------------------------------
    const gun = s.gun;
    const [ax, az] = leadPoint(s.x, s.z, T, gun);
    s.aimX = ax;
    s.aimZ = az;

    if (d < gun.range * 0.98 && this.salvoGap <= 0) {
      const ready = s.mainTurrets.filter((t) => t.reload <= 0 && t.onTarget && t.inArc);
      if (ready.length) {
        const evasive =
          (1 + Math.abs(T.rudder) * clamp(Math.abs(T.speed) / T.maxV, 0, 1) * 1.3) * SIZE_ERR[T.spec.cls];
        const rf = Math.max(0.8, 2.0 - 0.15 * this.salvos);
        const err = s.aiErr * this.w.aiErr(s.team) * rf * evasive * (0.25 + d / gun.range);
        for (const t of ready) fireTurret(this.w, s, t, ax, az, err);
        this.salvos++;
        this.salvoGap = rand(0.4, 1.2) + Math.random() * 0.6;
      }
    }

    // ---- torpedoes ------------------------------------------------------
    const tp = s.torp;
    if (tp) {
      const mount = s.torpReady.findIndex((v) => v <= 0);
      if (mount >= 0 && s.torpBudget > 0 && d < tp.range * 0.72 && d > 900) {
        const ic = intercept(s.x, s.z, T.x, T.z, T.vx, T.vz, tp.speed);
        if (ic && ic.t < tp.range / tp.speed) {
          const rel = Math.abs(angDiff(s.heading, ic.h));
          if (rel > 25 * (Math.PI / 180) && rel < 155 * (Math.PI / 180) && torpClear(s.x, s.z, ic.h, d + 400)) {
            launchFan(this.w, s, ic.h);
            s.torpReady[mount] = tp.reload;
          }
        }
      }
      for (let i = 0; i < s.torpReady.length; i++) s.torpReady[i] -= dt;
    }

    // ---- incoming fish --------------------------------------------------
    for (const t of this.w.torps) {
      if (!t.alive || t.team === s.team) continue;
      const qx = s.x - t.x,
        qz = s.z - t.z;
      const dvx = s.vx - t.dx * t.speed,
        dvz = s.vz - t.dz * t.speed;
      const dv2 = dvx * dvx + dvz * dvz || 1;
      const tc = clamp(-(-qx * dvx + -qz * dvz) / dv2, 0, 20);
      const cx = -qx + dvx * tc,
        cz = -qz + dvz * tc;
      const miss = Math.hypot(cx, cz);
      if (miss < 260 && tc < 25) {
        this.evade = 3;
        this.side = angDiff(s.heading, Math.atan2(t.dx, t.dz)) > 0 ? -1 : 1;
        break;
      }
    }

    // a little wander so a formation does not move like one rigid body
    if (Math.random() < dt * 0.05) this.side = Math.random() < 0.5 ? 1 : -1;
    if (Math.random() < dt * 0.02) this.salvos = Math.max(0, this.salvos - 1);
  }
}

/** Aim error a human gunner would carry: kept here so the debug panel can show it. */
export function humanAimError(d: number, range: number): number {
  return lerp(6, 40, clamp(d / range, 0, 1)) * (0.8 + 0.4 * Math.abs(randn()));
}
