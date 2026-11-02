// Anti-aircraft mounts derived from the ships' Aa parts.
//
// The visible AA guns stay inside the merged hull geometry (zero extra draw calls); this module
// only gives them a firing origin, a traverse arc and a gun. AA mounts never join s.turrets, so
// the main/secondary battery indexing and its sea-level solver stay untouched.

import { DEG } from './constants.ts';
import { deckY } from './hull.ts';
import { GUNS, TS, type TurretShape } from './guns.ts';
import type { GunSpec } from './ballistics.ts';
import type { ShipSpec } from './ships.ts';

/** AA part kind -> gun id. Unknown kinds are ignored rather than thrown on. */
export const AA_KIND: Record<string, string> = {
  b4: 'aa40', // quad Bofors
  b2: 'aa40', // twin Bofors
  o: 'aa20',  // single Oerlikon
  j3: 'aa25', // triple 25 mm
  j2: 'aa25', // twin 25 mm
  ha2: 'aah127', // twin 12.7 cm high-angle
  ha: 'aah127',  // single 12.7 cm (or 5"/25) high-angle
};

export interface AaMount {
  /** Hull-local metres. */
  x: number;
  y: number;
  z: number;
  /** Rest bearing: +/-PI/2 broadside, 0 bow, PI stern. */
  home: number;
  rel: number;
  /** Traverse either side of home, radians. */
  arc: number;
  elev: number;
  gun: GunSpec;
  ts: TurretShape;
  trav: number; // rad/s
  reload: number;
  reloadTotal: number;
  onTarget: boolean;
  inArc: boolean;
  /** Next barrel to fire: mounts cycle one tube at a time for a staggered tracer stream. */
  next: number;
}

/** Build one mount per Aa part. Positions match the renderer: deck height + part y offset. */
export function deriveAaMounts(spec: ShipSpec): AaMount[] {
  const out: AaMount[] = [];
  for (const p of spec.parts) {
    if (p.k !== "aa" || !p.kind) continue;
    const gunId = AA_KIND[p.kind];
    if (!gunId) continue;
    const gun = GUNS[gunId];
    const ts = TS[gunId];
    if (!gun || !ts) continue;
    const broadside = Math.abs(p.x) > 0.5;
    const home = broadside ? Math.sign(p.x) * Math.PI / 2 : (p.z < 0 ? Math.PI : 0);
    out.push({
      x: p.x,
      y: deckY(spec, p.z) + p.y,
      z: p.z,
      home,
      rel: home,
      arc: (broadside ? 110 : 150) * DEG,
      elev: 0,
      gun,
      ts,
      trav: gun.trav * DEG,
      reload: 0,
      reloadTotal: gun.reload,
      onTarget: false,
      inArc: false,
      next: 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------ automatic AA fire

import { clamp } from './constants.ts';
import { clampElevation, solveAA, scatterAim } from './ballistics.ts';
import type { World } from './world.ts';
import type { Ship, Turret } from './ship.ts';
import type { Plane } from './aircraft.ts';
import type { Shell } from './gunnery.ts';

const AA_TICK = 0.25;          // target selection cadence, seconds
const MAX_AA_IN_FLIGHT = 24;   // light/medium AA mounts per ship
const MAX_DP_IN_FLIGHT = 12;   // separate budget for the dual-purpose battery

interface AaState { tick: number; target: Plane | null }
const states = new WeakMap<Ship, AaState>();

/** Current AA target, for tests and debug readouts. */
export function aaTargetOf(s: Ship): Plane | null {
  return states.get(s)?.target ?? null;
}

const wrap = (a: number): number => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** World position of barrel k of an AA mount. Mirrors muzzleWorld for turrets. */
export function aaMuzzleWorld(s: Ship, m: AaLike, k: number): [number, number, number] {
  const ts = m.ts;
  const elev = clampElevation(m.gun, m.elev);
  const ox = (k - (ts.n - 1) / 2) * ts.w * 0.28;
  const ly = ts.h * 0.5 + ts.bl * Math.sin(elev);
  const lz = ts.len * 0.18 + ts.bl * Math.cos(elev);
  const cr = Math.cos(m.rel), sr = Math.sin(m.rel);
  const [wx, wz] = s.toWorld(m.x + ox * cr + lz * sr, m.z - ox * sr + lz * cr);
  return [wx, s.bob + m.y + ly, wz];
}

/** Fire one burst from a mount at a plane. Returns false (and spends no reload) if unreachable. */
/** AA mounts and DP secondary turrets share this shape; both can fire the AA path. */
export type AaLike = AaMount | Turret;

/** Fire ONE barrel of a mount (cycling), so a quad Bofors makes a staggered tracer stream
 *  rather than four coincident shells. Returns false (no reload spent) if unreachable. */
export function fireAa(w: World, s: Ship, m: AaLike, p: Plane, barrel?: number): boolean {
  const gun = m.gun;
  const n = m.ts.n;
  const k = m instanceof Object && 'next' in m
    ? (barrel ?? (m as AaMount).next)
    : (barrel ?? 0);
  const err = s.isPlayer ? 0 : s.aiErr * 0.5;
  const [mx, my, mz] = aaMuzzleWorld(s, m, k);
  const lead = solveAA(gun, mx, my, mz, p.x, p.y, p.z, p.vx, p.vy, p.vz);
  if (!lead.reachable) return false;
  const ix = p.x + p.vx * lead.T, iy = p.y + p.vy * lead.T, iz = p.z + p.vz * lead.T;
  const [ax, ay, az] = scatterAim(gun, mx, mz, ix, iy, iz, err);
  const shot = solveAA(gun, mx, my, mz, ax, ay, az);
  if (!shot.reachable) return false;
  // Per-barrel cadence: the whole mount still delivers gun.reload rounds per n seconds.
  m.reload = (gun.reload / n) * (0.95 + Math.random() * 0.1);
  m.reloadTotal = m.reload;
  if ('next' in m) (m as AaMount).next = (k + 1) % n;
  const salvo = ++w.salvoSeq;
  const sh: Shell = {
    id: ++w.sseq,
    x0: mx, y0: my, z0: mz,
    x: mx, y: my, z: mz,
    px: mx, py: my, pz: mz,
    vx: shot.vx, vy: shot.vy, vz: shot.vz,
    g: gun.g, t: 0, T: shot.T,
    owner: s, team: s.team, gun, sec: true, salvo, alive: true,
    aa: true,
    fuze: gun.fuze === "airburst" ? shot.T * (0.98 + Math.random() * 0.04) : undefined,
  };
  w.shells.push(sh);
  s.stats.shots += 1;
  w.emit('gun', {
    id: s.id, sec: 1, aa: 1, cal: gun.cal, n: 1, turret: -1,
    elevation: clampElevation(gun, m.elev),
    x: mx, y: my, z: mz,
    b: s.heading + m.rel,
    tx: p.x, tz: p.z, salvo,
    sh: [[sh.id, sh.x0, sh.y0, sh.z0, sh.vx, sh.vy, sh.vz, sh.g, sh.T]],
  });
  return true;
}

/** Per-frame AA update: reload, traverse, elevate, fire. Cheap when no planes exist. */
export function aaLogic(w: World, s: Ship, dt: number): void {
  if (!s.alive || !s.aaTurrets.length) return;
  let st = states.get(s);
  if (!st) { st = { tick: 0, target: null }; states.set(s, st); }
  let reach = 0;
  for (const m of s.aaTurrets) {
    m.reload -= dt;
    if (m.gun.range > reach) reach = m.gun.range;
  }
  if (!w.planes.length) { st.target = null; return; }
  reach *= 1.1;
  st.tick -= dt;
  if (st.tick <= 0) {
    st.tick = AA_TICK;
    let best: Plane | null = null, bestScore = 0;
    for (const p of w.planes) {
      if (!p.alive || p.team === s.team) continue;
      const d = Math.hypot(p.x - s.x, p.y, p.z - s.z);
      if (d > reach) continue;
      const wgt = p.state === "attack" || p.state === "runIn" ? 3
        : p.state === "approach" ? 2 : 0;
      if (wgt <= 0) continue;
      const score = wgt / (1 + d / 1500);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    st.target = best;
  }
  const t = st.target;
  if (!t || !t.alive) { st.target = null; return; }
  const distToPlane = Math.hypot(t.x - s.x, t.y, t.z - s.z);
  let inFlight = 0;
  for (const sh of w.shells) if (sh.alive && sh.aa && sh.owner === s) inFlight++;
  const aimMount = (m: AaLike): boolean => {
    if (m.gun.range < distToPlane) { m.onTarget = false; return false; }
    const [wx, , wz] = aaMuzzleWorld(s, m, 0);
    const b = Math.atan2(t.x - wx, t.z - wz);
    const off = wrap(wrap(b - s.heading) - m.home);
    // AA mounts keep their modeled arc; DP turrets train freely on aerial targets.
    const arc = "next" in m ? m.arc : Math.PI;
    m.inArc = Math.abs(off) <= arc;
    const want = clamp(off, -arc, arc);
    const cur = wrap(m.rel - m.home);
    const step = m.trav * dt;
    const noff = "next" in m ? cur + clamp(want - cur, -step, step) : want;
    m.rel = m.home + noff;
    const shot = solveAA(m.gun, wx, m.y + s.bob, wz, t.x, t.y, t.z, t.vx, t.vy, t.vz);
    const targetElev = shot.elev;
    // Turrets are also driven by updateTurrets, which pulls an idle gun back down; snap
    // them to the AA elevation instead of easing, or the two lerps fight and never converge.
    if ("next" in m) m.elev = clampElevation(m.gun, m.elev + (targetElev - m.elev) * Math.min(1, dt * 3));
    else m.elev = clampElevation(m.gun, targetElev);
    m.onTarget = m.inArc && shot.reachable
      && Math.abs(want - noff) < 0.05
      && Math.abs(targetElev - m.elev) < 0.03;
    return m.onTarget;
  };
  for (const m of s.aaTurrets) {
    if (!aimMount(m)) continue;
    if (m.reload <= 0 && inFlight < MAX_AA_IN_FLIGHT && fireAa(w, s, m, t)) inFlight++;
  }
  // Dual-purpose secondary battery: with no surface target to shoot, the 5"/38s join the
  // AA barrage as long-range airburst guns. aaLogic runs after updateTurrets each frame,
  // so the pose we set here is the one that renders.
  if (!s.secT) {
    let dpInFlight = 0;
    for (const sh of w.shells) if (sh.alive && sh.aa && sh.owner === s && sh.gun.elevMax >= 75) dpInFlight++;
    for (const t2 of s.secTurrets) {
      if (t2.gun.elevMax < 75 || !t2.gun.aa) continue;
      if (!aimMount(t2)) continue;
      if (t2.reload > 0) continue;
      if (dpInFlight >= MAX_DP_IN_FLIGHT) break;
      if (fireAa(w, s, t2, t)) dpInFlight++;
    }
  }
}
