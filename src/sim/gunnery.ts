// Gunnery: laying the turrets, firing them, and flying the shells.

import { clamp, lerp, rand } from './constants.ts';
import { clampElevation, flightTime, scatterPoint, solveShot } from './ballistics.ts';
import { halfW } from './hull.ts';
import { leadPoint, type Ship, type Turret } from './ship.ts';
import { shellClear, terrainH } from './terrain.ts';
import type { World } from './world.ts';

export interface Shell {
  id: number;
  x0: number;
  y0: number;
  z0: number;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  t: number;
  T: number;
  owner: Ship;
  team: string;
  gun: import('./ballistics').GunSpec;
  sec: boolean;
  /** Which salvo it belongs to, so the spotter can score the fall of shot. */
  salvo: number;
  alive: boolean;
}

export function turretWorld(s: Ship, t: Turret): [number, number] {
  return s.toWorld(t.x, t.z);
}

/** Muzzle position of barrel `k` of a turret, in world metres. */
export function muzzleWorld(s: Ship, t: Turret, k: number): [number, number, number] {
  const ts = t.ts;
  const elevation = clampElevation(t.gun, t.elev);
  const ox = (k - (ts.n - 1) / 2) * ts.w * 0.28;
  const ly = ts.h * 0.5 + ts.bl * Math.sin(elevation);
  const lz = ts.len * 0.18 + ts.bl * Math.cos(elevation);
  const cr = Math.cos(t.rel),
    sr = Math.sin(t.rel);
  const [wx, wz] = s.toWorld(t.x + ox * cr + lz * sr, t.z - ox * sr + lz * cr);
  return [wx, s.bob + t.y + ly, wz];
}

export function updateTurrets(s: Ship, dt: number): void {
  for (const t of s.turrets) {
    t.reload -= dt;
    let ax: number | null = null,
      az = 0;
    if (t.sec) {
      if (s.secT) {
        ax = s.secAimX;
        az = s.secAimZ;
      }
    } else {
      ax = s.aimX;
      az = s.aimZ;
    }
    let want = 0;
    const [wx, wz] = turretWorld(s, t);
    if (ax !== null) {
      const b = Math.atan2(ax - wx, az - wz);
      const off0 = wrap(wrap(b - s.heading) - t.home);
      t.inArc = Math.abs(off0) <= t.arc;
      want = clamp(off0, -t.arc, t.arc);
    } else {
      t.inArc = false;
    }
    const off = wrap(t.rel - t.home);
    const step = t.trav * dt;
    const noff = off + clamp(want - off, -step, step);
    t.rel = t.home + noff;
    t.onTarget = t.inArc && Math.abs(want - noff) < 0.035;
    const solution = ax === null ? null : solveShot(t.gun, wx, s.bob + t.y + t.ts.h * 0.5, wz, ax, az);
    const el = solution?.elev ?? clampElevation(t.gun, 0.02);
    t.elev = clampElevation(t.gun, clampElevation(t.gun, t.elev) +
      (el - clampElevation(t.gun, t.elev)) * Math.min(1, dt * 3));
    t.onTarget = t.onTarget && (solution?.reachable ?? false);
  }
}

const wrap = (a: number) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function fireShell(
  w: World,
  owner: Ship,
  gun: import('./ballistics').GunSpec,
  mx: number,
  my: number,
  mz: number,
  tx: number,
  tz: number,
  err: number,
  sec: boolean,
  salvo: number,
): Shell {
  const [sx, sz] = scatterPoint(gun, mx, mz, tx, tz, err);
  const shot = solveShot(gun, mx, my, mz, sx, sz);
  const sh: Shell = {
    id: ++w.sseq,
    x0: mx,
    y0: my,
    z0: mz,
    x: mx,
    y: my,
    z: mz,
    px: mx,
    py: my,
    pz: mz,
    vx: shot.vx,
    vy: shot.vy,
    vz: shot.vz,
    g: gun.g,
    t: 0,
    T: shot.T,
    owner,
    team: owner.team,
    gun,
    sec,
    salvo,
    alive: true,
  };
  w.shells.push(sh);
  return sh;
}

export function fireTurret(w: World, s: Ship, t: Turret, tx: number, tz: number, err: number): void {
  const gun = t.gun;
  // Never consume a reload for a trajectory that the mechanical elevation
  // cannot produce. Dispersion is still applied independently to each shell.
  for (let k = 0; k < t.ts.n; k++) {
    const [x, y, z] = muzzleWorld(s, t, k);
    if (!solveShot(gun, x, y, z, tx, tz).reachable) return;
  }
  t.reload = gun.reload * rand(0.97, 1.05);
  t.reloadTotal = t.reload;
  let mx = 0,
    my = 0,
    mz = 0;
  const salvo = ++w.salvoSeq;
  const shells: Shell[] = [];
  for (let k = 0; k < t.ts.n; k++) {
    const [bx, by, bz] = muzzleWorld(s, t, k);
    mx += bx;
    my += by;
    mz += bz;
    shells.push(fireShell(w, s, gun, bx, by, bz, tx, tz, err, t.sec, salvo));
  }
  mx /= t.ts.n;
  my /= t.ts.n;
  mz /= t.ts.n;
  s.stats.shots += t.ts.n;
  w.emit('gun', {
    id: s.id,
    sec: t.sec ? 1 : 0,
    cal: gun.cal,
    n: t.ts.n,
    turret: s.turrets.indexOf(t),
    elevation: clampElevation(gun, t.elev),
    x: mx,
    y: my,
    z: mz,
    b: s.heading + t.rel,
    tx,
    tz,
    salvo,
    sh: shells.map((b) => [b.id, b.x0, b.y0, b.z0, b.vx, b.vy, b.vz, b.g, b.T]),
  });
}

// ------------------------------------------------------------------ shell flight

/** Slab test in the target's hull frame; returns the parameter along the segment or -1. */
export function segHitShip(sh: Ship, a: number[], b: number[]): number {
  const spec = sh.spec;
  const c = Math.cos(sh.heading),
    s = Math.sin(sh.heading);
  const ax = a[0] - sh.x,
    az = a[2] - sh.z;
  const bx = b[0] - sh.x,
    bz = b[2] - sh.z;
  const lax = ax * c - az * s,
    laz = ax * s + az * c;
  const lbx = bx * c - bz * s,
    lbz = bx * s + bz * c;
  const lay = a[1] - sh.bob,
    lby = b[1] - sh.bob;
  const mn = [-spec.B / 2, -1.5, -spec.L / 2];
  const mx = [spec.B / 2, spec.F + spec.top * 0.55, spec.L / 2];
  const o = [lax, lay, laz],
    d = [lbx - lax, lby - lay, lbz - laz];
  let t0 = 0,
    t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
      continue;
    }
    let ta = (mn[i] - o[i]) / d[i],
      tb = (mx[i] - o[i]) / d[i];
    if (ta > tb) {
      const q = ta;
      ta = tb;
      tb = q;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  const hz = laz + d[2] * t0;
  const hx = lax + d[0] * t0;
  const sN = hz / spec.L + 0.5;
  if (Math.abs(hx) > (spec.B / 2) * halfW(clamp(sN, 0, 1)) + 1.5) return -1;
  return t0;
}

export function updateShells(w: World, dt: number): void {
  for (const s of w.shells) {
    if (!s.alive) continue;
    s.px = s.x;
    s.py = s.y;
    s.pz = s.z;
    s.t += dt;
    s.x = s.x0 + s.vx * s.t;
    s.z = s.z0 + s.vz * s.t;
    s.y = s.y0 + s.vy * s.t - 0.5 * s.g * s.t * s.t;
    const A = [s.px, s.py, s.pz],
      B = [s.x, s.y, s.z];
    let hit: Ship | null = null,
      ht = 2;
    if (s.y < 70) {
      for (const sh of w.ships) {
        if (!sh.alive || sh.team === s.team) continue;
        const qx = sh.x - s.x,
          qz = sh.z - s.z;
        const r = sh.spec.L * 0.55 + 60;
        if (qx * qx + qz * qz > r * r) continue;
        const t = segHitShip(sh, A, B);
        if (t >= 0 && t < ht) {
          ht = t;
          hit = sh;
        }
      }
    }
    if (hit) {
      const hx = lerp(s.px, s.x, ht),
        hy = lerp(s.py, s.y, ht),
        hz = lerp(s.pz, s.z, ht);
      s.alive = false;
      shellHit(w, hit, s, hx, hy, hz);
      continue;
    }
    if (s.y < 1400) {
      const th = terrainH(s.x, s.z);
      if (s.y < th && th > 0) {
        s.alive = false;
        w.emit('land', { id: s.id, x: s.x, y: s.y, z: s.z, cal: s.gun.cal, team: s.team });
        continue;
      }
    }
    if (s.y <= 0 && s.t > 0.05) {
      s.alive = false;
      w.emit('splash', {
        id: s.id,
        x: s.x,
        z: s.z,
        y: 0,
        cal: s.gun.cal,
        team: s.team,
        owner: s.owner.id,
        salvo: s.salvo,
        sec: s.sec ? 1 : 0,
        over: s.t >= s.T ? 1 : 0,
      });
      continue;
    }
    if (s.t > 60) s.alive = false;
  }
  if (w.shells.length > 400) w.shells = w.shells.filter((s) => s.alive);
}

export function shellHit(w: World, ship: Ship, s: Shell, x: number, y: number, z: number): void {
  const gun = s.gun;
  const [, lz] = ship.toLocal(x, z);
  let dmg = gun.dmg * rand(0.85, 1.15);
  if (ship.spec.cls === 'BB') dmg *= 0.9;
  const dealt = ship.damage(dmg, s.owner, 'shell');
  s.owner.stats.hits++;
  if (Math.random() < gun.fire) ship.startFire(lz, s.owner);
  w.emit('hit', {
    id: ship.id,
    by: s.owner.id,
    dmg: dealt,
    x,
    y,
    z,
    cal: gun.cal,
    sec: s.sec ? 1 : 0,
    salvo: s.salvo,
  });
}

// ------------------------------------------------------------------ secondary battery

/**
 * The secondary battery picks its own target: the nearest enemy inside its reach, led for the
 * flight time, and fired at the moment each mount is loaded and on. The captain never touches it.
 */
export function secondaryLogic(w: World, s: Ship): void {
  const gun = s.secGun;
  if (!gun) return;
  let best: Ship | null = null,
    bd = gun.range;
  for (const o of w.ships) {
    if (!o.alive || o.team === s.team) continue;
    const d = Math.hypot(o.x - s.x, o.z - s.z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  s.secT = best;
  if (!best) return;
  const [lx, lz] = leadPoint(s.x, s.z, best, gun);
  s.secAimX = lx;
  s.secAimZ = lz;
  const err = s.aiErr * 1.1 * w.aiErr(s.team) * (0.3 + bd / gun.range);
  const ready = s.turrets.filter((t) => t.sec && t.reload <= 0 && t.onTarget);
  if (!ready.length) return;
  // masked by an island: hold fire and look again in a moment
  if (!shellClear(gun.g, s.x, s.spec.F + 4, s.z, lx, lz, gun.v0, gun.range)) {
    for (const t of ready) t.reload = 0.5;
    return;
  }
  for (const t of ready) fireTurret(w, s, t, lx, lz, err);
}

/** Time of flight the sight should display for the current aim. */
export function aimFlightTime(s: Ship): number {
  return flightTime(s.gun, Math.hypot(s.aimX - s.x, s.aimZ - s.z));
}
