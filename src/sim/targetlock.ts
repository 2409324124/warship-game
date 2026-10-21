// Target lock, in the World of Warships / War Thunder sense.
//
// Locking does not aim for you. It makes the guns *follow* the target's lead point as she manoeuvres,
// and leaves the fine trim - the part that decides whether the salvo lands short, long or on top of
// her - in the captain's hands. Push the trim too far and the lock breaks, which is what stops it
// turning into an aimbot.
//
// The second half is the rangefinder: a freshly locked target is only roughly ranged, and the
// solution tightens the longer you hold her. Lose her and you start again from scratch.

import { clamp, wrapA } from './constants.ts';
import { leadPoint, type Ship } from './ship.ts';

export interface LockOptions {
  /** Extra 1-sigma range error the moment you lock, as a fraction of the range. */
  err0?: number;
  /** Where the rangefinder settles, as a fraction of the range. */
  errMin?: number;
  /** Convergence time constant, seconds. */
  tau?: number;
  /** Trim in bearing that breaks the lock, radians. */
  breakYaw?: number;
  /** Trim in range that breaks the lock, as a fraction of the range. */
  breakRange?: number;
  /** How far off the crosshair a ship can be and still be lockable, radians. */
  cone?: number;
}

export interface LockSolution {
  /** Guns laid here: the lead point of the locked target, plus the captain's trim. */
  yaw: number;
  range: number;
  /** Bearing to the lead point itself, before trim. */
  baseYaw: number;
  /** Distance to the lead point, before trim. */
  baseRange: number;
  /** The lead point, in world metres. */
  leadX: number;
  leadZ: number;
  /** Extra 1-sigma spread in metres from the rangefinder still settling. */
  err: number;
  /** 0..1, how far the rangefinder has converged. */
  converged: number;
  /** True on the frame the lock gave out. */
  broke: boolean;
}

export class TargetLock {
  target: Ship | null = null;
  /** Seconds the current lock has been held. */
  held = 0;
  /** The captain's trim on top of the automatic solution. */
  offYaw = 0;
  offRange = 0;

  err0: number;
  errMin: number;
  tau: number;
  breakYaw: number;
  breakRange: number;
  cone: number;

  // last solution, for the HUD
  baseYaw = 0;
  baseRange = 0;
  leadX = 0;
  leadZ = 0;

  constructor(o: LockOptions = {}) {
    this.err0 = o.err0 ?? 0.08;
    this.errMin = o.errMin ?? 0.006;
    this.tau = o.tau ?? 2.2;
    this.breakYaw = o.breakYaw ?? (6 * Math.PI) / 180;
    this.breakRange = o.breakRange ?? 0.12;
    this.cone = o.cone ?? 0.7;
  }

  get locked(): boolean {
    return !!this.target && this.target.alive && !this.target.removed;
  }

  /**
   * Which enemy the crosshair is on. World of Warships picks the ship closest to the centre of the
   * screen, which is to say the one whose bearing is closest to where the guns are pointing.
   */
  pick(from: Ship, bearing: number, ships: Ship[]): Ship | null {
    const maxD = from.gun.range * 1.08;
    let best: Ship | null = null;
    let bs = Infinity;
    for (const s of ships) {
      if (!s.alive || s.removed || s.team === from.team) continue;
      const dx = s.x - from.x,
        dz = s.z - from.z;
      const d = Math.hypot(dx, dz);
      if (d > maxD || d < 60) continue;
      const diff = Math.abs(wrapA(Math.atan2(dx, dz) - bearing));
      if (diff > this.cone) continue;
      // mostly angular, with a slight nudge toward the nearer ship
      const score = diff + (d / maxD) * 0.15;
      if (score < bs) {
        bs = score;
        best = s;
      }
    }
    return best;
  }

  /** Enemies worth locking, nearest in bearing to the crosshair first. */
  candidates(from: Ship, bearing: number, ships: Ship[]): Ship[] {
    const maxD = from.gun.range * 1.08;
    return ships
      .filter((s) => {
        if (!s.alive || s.removed || s.team === from.team) return false;
        const d = Math.hypot(s.x - from.x, s.z - from.z);
        if (d > maxD || d < 60) return false;
        return Math.abs(wrapA(Math.atan2(s.x - from.x, s.z - from.z) - bearing)) <= this.cone;
      })
      .sort(
        (a, b) =>
          Math.abs(wrapA(Math.atan2(a.x - from.x, a.z - from.z) - bearing)) -
          Math.abs(wrapA(Math.atan2(b.x - from.x, b.z - from.z) - bearing)),
      );
  }

  lock(s: Ship | null): void {
    this.target = s;
    this.held = 0;
    this.offYaw = 0;
    this.offRange = 0;
  }

  unlock(): void {
    this.target = null;
    this.held = 0;
    this.offYaw = 0;
    this.offRange = 0;
  }

  /** Move to the next lockable enemy. */
  cycle(from: Ship, bearing: number, ships: Ship[]): Ship | null {
    const list = this.candidates(from, bearing, ships);
    if (!list.length) {
      this.unlock();
      return null;
    }
    const i = this.target ? list.indexOf(this.target) : -1;
    const next = list[(i + 1) % list.length];
    this.lock(next);
    return next;
  }

  /** The captain's mouse: while locked it trims the automatic solution instead of driving it. */
  addTrim(dYaw: number, dRange: number): void {
    this.offYaw += dYaw;
    this.offRange += dRange;
  }

  /** Extra 1-sigma spread in metres while the rangefinder is still settling. */
  rangeError(range: number): number {
    const lo = this.errMin * range;
    return lo + (this.err0 * range - lo) * Math.exp(-this.held / this.tau);
  }

  /** 0 when just locked, 1 when the rangefinder has settled. */
  convergence(): number {
    const k = Math.exp(-this.held / this.tau);
    return clamp(1 - k, 0, 1);
  }

  /**
   * Work out where the guns should point this frame. `maxRange` clamps the result.
   * Returns null when nothing is locked, in which case the caller aims by hand.
   */
  update(dt: number, from: Ship, maxRange: number): LockSolution | null {
    const t = this.target;
    if (!t || !t.alive || t.removed) {
      if (this.target) this.unlock();
      return null;
    }
    this.held += dt;

    const [lx, lz] = leadPoint(from.x, from.z, t, from.gun);
    const baseYaw = Math.atan2(lx - from.x, lz - from.z);
    const baseRange = Math.hypot(lx - from.x, lz - from.z);
    this.baseYaw = baseYaw;
    this.baseRange = baseRange;
    this.leadX = lx;
    this.leadZ = lz;

    const yaw = baseYaw + this.offYaw;
    const range = clamp(baseRange + this.offRange, 250, maxRange);
    const err = this.rangeError(range);

    // push the trim too far and you are aiming by hand again
    let broke = false;
    if (Math.abs(this.offYaw) > this.breakYaw || Math.abs(this.offRange) > this.breakRange * baseRange) {
      this.unlock();
      broke = true;
    }
    return { yaw, range, baseYaw, baseRange, leadX: lx, leadZ: lz, err, converged: this.convergence(), broke };
  }
}
