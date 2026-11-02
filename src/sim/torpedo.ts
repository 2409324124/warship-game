// Torpedoes: the reason a battleship does not want three destroyers inside five thousand metres.

import { angDiff, clamp, DEG, rand } from './constants.ts';
import type { TorpSpec } from './guns.ts';
import type { Ship } from './ship.ts';
import { terrainH } from './terrain.ts';
import type { World } from './world.ts';

export interface Torpedo {
  id: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  trav: number;
  range: number;
  spec: TorpSpec;
  /** Null for aircraft-dropped torpedoes. */
  owner: Ship | null;
  team: string;
  /** Per-team countdown of "we have seen her wake". */
  seen: Record<string, number>;
  alive: boolean;
}

export function launchFan(w: World, ship: Ship, heading: number): Torpedo[] {
  const tp = ship.torp;
  if (!tp) return [];
  const n = Math.min(ship.torpSalvo, ship.torpBudget);
  if (n <= 0) return [];
  ship.torpBudget -= n;
  const side = angDiff(ship.heading, heading) > 0 ? 1 : -1;
  const [ox, oz] = ship.toWorld(side * ship.spec.B * 0.45, 0);
  const out: Torpedo[] = [];
  for (let k = 0; k < n; k++) {
    const h = heading + (k - (n - 1) / 2) * tp.spread * DEG;
    const t: Torpedo = {
      id: ++w.tseq,
      x: ox,
      z: oz,
      dx: Math.sin(h),
      dz: Math.cos(h),
      speed: tp.speed * rand(0.98, 1.02),
      trav: 0,
      range: tp.range,
      spec: tp,
      owner: ship,
      team: ship.team,
      seen: {},
      alive: true,
    };
    w.torps.push(t);
    out.push(t);
  }
  ship.stats.torps += n;
  w.emit('torpLaunch', { id: ship.id, n, x: ox, z: oz, h: heading, spread: tp.spread });
  return out;
}

export function torpVisible(t: Torpedo, team: string | null): boolean {
  if (!team) return true;
  if (t.team === team) return true;
  return t.seen[team] > 0;
}

export function updateTorps(w: World, dt: number): void {
  for (const t of w.torps) {
    if (!t.alive) continue;
    const step = t.speed * dt;
    const nx = t.x + t.dx * step;
    const nz = t.z + t.dz * step;

    for (const sh of w.ships) {
      if (!sh.alive || sh.team === t.team) continue;
      // closest approach of this step to the target's centreline
      const dx = nx - sh.x,
        dz = nz - sh.z;
      const c = Math.cos(sh.heading),
        s = Math.sin(sh.heading);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const half = sh.spec.L * 0.5;
      if (Math.abs(lz) < half && Math.abs(lx) < sh.spec.B * 0.5 + 2.5) {
        t.alive = false;
        // a battleship's torpedo bulkheads earn their keep
        const dmg = t.spec.dmg * rand(0.9, 1.1) * (sh.spec.cls === 'BB' ? 0.55 : 1);
        const dealt = sh.damage(dmg, t.owner, 'torp');
        if (t.owner) t.owner.stats.torpHits++;
        if (Math.random() < 0.35) sh.startFire(clamp(lz, -half, half), t.owner);
        w.emit('torpHit', { id: sh.id, by: t.owner?.id ?? 0, dmg: dealt, x: nx, z: nz });
        break;
      }
      // spotted: her wake gives her away to anyone close enough
      const d = Math.hypot(dx, dz);
      if (d < t.spec.visR && sh.team !== t.team) t.seen[sh.team] = Math.max(t.seen[sh.team] || 0, 6);
    }
    if (!t.alive) continue;

    t.x = nx;
    t.z = nz;
    t.trav += step;
    for (const k in t.seen) t.seen[k] = Math.max(0, t.seen[k] - dt);
    if (t.trav > t.range) {
      t.alive = false;
      w.emit('torpEnd', { id: t.id });
    }
  }
  if (w.torps.length > 200) w.torps = w.torps.filter((t) => t.alive);
}

/** Bearing to steer to hit a target running at (tvx, tvz) with a weapon of speed v. Null if unreachable. */
export function intercept(
  sx: number,
  sz: number,
  tx: number,
  tz: number,
  tvx: number,
  tvz: number,
  v: number,
): { h: number; t: number } | null {
  const dx = tx - sx,
    dz = tz - sz;
  const a = tvx * tvx + tvz * tvz - v * v;
  const b = 2 * (dx * tvx + dz * tvz);
  const c = dx * dx + dz * dz;
  let t = -1;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return null;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    const opts = [t1, t2].filter((x) => x > 0);
    if (!opts.length) return null;
    t = Math.min(...opts);
  }
  if (!(t > 0) || !isFinite(t)) return null;
  const px = tx + tvx * t,
    pz = tz + tvz * t;
  return { h: Math.atan2(px - sx, pz - sz), t };
}

/** Would a fish run aground before reaching `dist`? */
export function torpClear(x: number, z: number, h: number, dist: number): boolean {
  const sx = Math.sin(h),
    sz = Math.cos(h);
  for (let d = 60; d < dist; d += 120) {
    if (terrainH(x + sx * d, z + sz * d) > 0) return false;
  }
  return true;
}
