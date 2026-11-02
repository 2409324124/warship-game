// Aircraft: torpedo and dive bombers with a small attack state machine.
// Pure simulation, no three.js. Planes carry no engines model beyond constant speeds.

import { clamp } from './constants.ts';
import { BOMB, TORPS } from './guns.ts';
import type { World } from './world.ts';
import type { Ship } from './ship.ts';
import type { Shell } from './gunnery.ts';
import type { Torpedo } from './torpedo.ts';

export type PlaneKind = 'torp' | 'dive';
export type PlaneState = 'approach' | 'runIn' | 'attack' | 'egress' | 'falling';

export interface Plane {
  id: number;
  kind: PlaneKind;
  team: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  heading: number;
  hp: number;
  maxHp: number;
  state: PlaneState;
  target: Ship | null;
  sqn: number;
  slot: number;
  dropped: boolean;
  burn: boolean;
  alive: boolean;
  /** Seconds spent in the current state. */
  st: number;
}

export const PLANE_HP: Record<PlaneKind, number> = { torp: 30, dive: 26 };

const TUNE = {
  torp: { cruise: 85, attackSpeed: 55, cruiseAlt: 130, attackAlt: 25, runDist: 3200, releaseDist: 950 },
  dive: { cruise: 95, attackSpeed: 100, cruiseAlt: 1500, diveAlt: 1200, runDist: 4200, releaseAlt: 450 },
};

const wrap = (a: number): number => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function spawnPlane(
  w: World, kind: PlaneKind, team: string,
  x: number, y: number, z: number, heading: number,
  target: Ship | null, sqn: number, slot: number,
  speed = TUNE[kind].cruise,
): Plane {
  const p: Plane = {
    id: ++w.pseq, kind, team, x, y, z,
    vx: Math.sin(heading) * speed, vy: 0, vz: Math.cos(heading) * speed,
    heading, hp: PLANE_HP[kind], maxHp: PLANE_HP[kind],
    state: 'approach', target, sqn, slot, dropped: false, burn: false, alive: true, st: 0,
  };
  w.planes.push(p);
  return p;
}

/** Shoot a plane down: it burns, falls and splashes. */
export function killPlane(w: World, p: Plane): void {
  if (!p.alive) return;
  p.alive = false;
  p.burn = true;
  p.state = "falling";
  p.st = 0;
  p.vy = Math.min(p.vy, -6);
  w.emit('planeDown', { id: p.id, x: p.x, y: p.y, z: p.z, team: p.team });
}

function steer(p: Plane, tx: number, tz: number, rateDeg: number, dt: number, speed: number): void {
  const want = Math.atan2(tx - p.x, tz - p.z);
  const d = wrap(want - p.heading);
  const step = (rateDeg * Math.PI) / 180 * dt;
  p.heading += clamp(d, -step, step);
  p.vx = Math.sin(p.heading) * speed;
  p.vz = Math.cos(p.heading) * speed;
}

/** One wave: a wedge of torpedo bombers or dive bombers from 9-11 km out. */
export function spawnAirRaid(w: World, team: string, target: Ship, torp = 4, dive = 0): Plane[] {
  const out: Plane[] = [];
  // Attack from ahead of the target's course (heading, not heading+PI): head-on closing is
  // what makes a torpedo hit possible at game speeds, and it is how torpedo bombers ran.
  const base = target.heading + (Math.random() - 0.5) * 1.2;
  const offs = [
    [0, 0], [-60, 0], [60, 0], [-120, 0],
    [-30, -60], [30, -60], [-90, -70], [90, -70],
    [-150, -40], [150, -40], [-180, -90], [180, -90],
  ];
  const mk = (kind: PlaneKind, n: number, sqn: number) => {
    for (let i = 0; i < n; i++) {
      const o = offs[i % offs.length];
      const dist = 5000 + Math.random() * 1200;
      const h = base + (Math.random() - 0.5) * 0.3;
      const alt = TUNE[kind].cruiseAlt;
      const side = (i % 2 ? 1 : -1) * (40 + o[0] * 0.2);
      const back = o[1];
      const px = target.x + Math.sin(h) * dist + Math.cos(h) * side;
      const pz = target.z + Math.cos(h) * dist - Math.sin(h) * side + back;
      const face = Math.atan2(target.x - px, target.z - pz);
      out.push(spawnPlane(w, kind, team, px, alt, pz, face, target, sqn, i));
    }
  };
  mk("torp", torp, 1);
  if (dive > 0) mk("dive", dive, 2);
  w.emit("airRaid", { team, n: out.length, tx: target.x, tz: target.z });
  return out;
}

function dropTorpedo(w: World, p: Plane): void {
  const spec = TORPS.airTorp;
  // Lead the target: torpedo bombers aimed ahead of a moving ship's track.
  let aimX = p.x + Math.sin(p.heading) * 500;
  let aimZ = p.z + Math.cos(p.heading) * 500;
  const tgt = p.target;
  if (tgt && tgt.alive) {
    aimX = tgt.x;
    aimZ = tgt.z;
    for (let i = 0; i < 3; i++) {
      const T = Math.hypot(aimX - p.x, aimZ - p.z) / spec.speed;
      aimX = tgt.x + Math.sin(tgt.heading) * tgt.speed * T;
      aimZ = tgt.z + Math.cos(tgt.heading) * tgt.speed * T;
    }
  }
  const dir = Math.atan2(aimX - p.x, aimZ - p.z);
  const t: Torpedo = {
    id: ++w.tseq,
    x: p.x, z: p.z,
    dx: Math.sin(dir), dz: Math.cos(dir),
    speed: spec.speed, trav: 0, range: spec.range, spec,
    owner: null, team: p.team, seen: {}, alive: true,
  };
  w.torps.push(t);
  p.dropped = true;
  w.emit("airTorp", { pid: p.id, x: p.x, z: p.z, h: p.heading });
}

function dropBomb(w: World, p: Plane): void {
  const sh: Shell = {
    id: ++w.sseq,
    x0: p.x, y0: p.y, z0: p.z,
    x: p.x, y: p.y, z: p.z,
    px: p.x, py: p.y, pz: p.z,
    vx: p.vx, vy: p.vy - 4, vz: p.vz,
    g: BOMB.g, t: 0, T: Math.max(2, Math.sqrt(Math.max(0, 2 * p.y) / BOMB.g)),
    owner: null, team: p.team, gun: BOMB, sec: true, salvo: ++w.salvoSeq, alive: true,
  };
  w.shells.push(sh);
  p.dropped = true;
  w.emit("airBomb", { pid: p.id, x: p.x, y: p.y, z: p.z });
}

export function updatePlanes(w: World, dt: number): void {
  for (const p of w.planes) {
    if (!p.alive && p.state !== "falling") continue;
    p.st += dt;
    if (p.state === "falling") {
      p.vy -= 9.81 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y <= 0) {
        p.y = 0;
        p.alive = false; p.state = "egress"; p.st = 0;
        w.emit("planeSplash", { id: p.id, x: p.x, z: p.z, team: p.team });
      }
      continue;
    }
    const t = p.target;
    const s = TUNE[p.kind];
    const dist = t ? Math.hypot(t.x - p.x, t.z - p.z) : 0;
    if (p.state === "approach") {
      if (t) steer(p, t.x, t.z, 6, dt, s.cruise);
      p.vy = clamp(((p.kind === "torp" ? TUNE.torp.cruiseAlt : TUNE.dive.cruiseAlt) - p.y) * 0.2, -8, 6);
      if (dist < s.runDist) p.state = "runIn";
    } else if (p.state === "runIn") {
      if (t) steer(p, t.x, t.z, 6, dt, s.cruise);
      const want = p.kind === "torp" ? TUNE.torp.attackAlt : TUNE.dive.diveAlt;
      p.vy = clamp((want - p.y) * 0.25, -16, 4);
      if (p.y <= want + 60) p.state = "attack";
    } else if (p.state === "attack") {
      if (!t) { p.state = "egress"; continue; }
      if (p.kind === "torp") {
        steer(p, t.x, t.z, 3, dt, TUNE.torp.attackSpeed);
        p.vy = clamp((TUNE.torp.attackAlt - p.y) * 0.4, -6, 2);
        if (!p.dropped && dist < TUNE.torp.releaseDist) dropTorpedo(w, p);
        if (p.dropped) { p.state = "egress"; p.st = 0; p.vy = 10; }
      } else {
        steer(p, t.x, t.z, 3, dt, TUNE.dive.attackSpeed);
        p.vy = -TUNE.dive.attackSpeed;
        if (!p.dropped && p.y <= TUNE.dive.releaseAlt) dropBomb(w, p);
        if (p.dropped) { p.state = "egress"; p.st = 0; p.vy = 15; }
      }
      if (p.y < 5) { p.state = "egress"; p.st = 0; }
    } else if (p.state === "egress") {
      p.vy = clamp((300 - p.y) * 0.15, -4, 14);
      if (p.st > 25 || (t && dist > 9000)) p.alive = false;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
  }
  if (w.planes.some((p) => !p.alive && p.state !== "falling")) w.planes = w.planes.filter((p) => p.alive || p.state === "falling");
}
