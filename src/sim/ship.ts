// One ship: her movement, her guns, her damage state.

import { angDiff, clamp, KN, MAP_R, rand, THROTTLE, wrapA, DEG } from './constants.ts';
import { deckY } from './hull.ts';
import type { GunSpec } from './ballistics.ts';
import { GUNS, TORPS, TS, type TorpSpec, type TurretShape } from './guns.ts';
import { SPECS, type ShipSpec } from './ships.ts';
import { terrainH } from './terrain.ts';
import type { World } from './world.ts';

export interface Turret {
  x: number;
  y: number;
  z: number;
  /** Rest bearing relative to the hull, radians. */
  home: number;
  /** Current bearing relative to the hull, radians. */
  rel: number;
  /** Firing arc either side of `home`, radians. */
  arc: number;
  sec: boolean;
  ts: TurretShape;
  gun: GunSpec;
  /** Traverse rate, radians per second. */
  trav: number;
  reload: number;
  /** Actual duration assigned to the current reload, for per-mount HUD progress. */
  reloadTotal: number;
  onTarget: boolean;
  inArc: boolean;
  elev: number;
}

export interface Fire {
  lx: number;
  lz: number;
  t: number;
  src: Ship | null;
}

export interface ShipOpts {
  id?: number;
  player?: boolean;
  no?: string;
  x?: number;
  z?: number;
  heading?: number;
  speedFrac?: number;
  hpMul?: number;
  throttle?: number;
}

export class Ship {
  readonly spec: ShipSpec;
  readonly w: World;
  readonly id: number;
  readonly key: string;
  readonly team: string;
  readonly name: string;
  readonly isPlayer: boolean;
  hullNo: string;

  x: number;
  z: number;
  heading: number;
  maxV: number;
  speed: number;
  vx = 0;
  vz = 0;
  shx = 0;
  shz = 0;

  throttle: number;
  rudder = 0;
  rudderCmd = 0;

  maxHp: number;
  hp: number;
  alive = true;
  sinkT = -1;
  removed = false;

  fires: Fire[] = [];
  dc: { charges: number; cd: number; active: number };

  aiErr: number;
  gun: GunSpec;
  secGun: GunSpec | null;
  torp: TorpSpec | null;
  torpSalvo: number;
  /** Fish still in the racks and in the reloads. */
  torpBudget: number;
  torpReady: number[];

  /** Where the captain is pointing the main battery, in world metres. */
  aimX: number;
  aimZ: number;
  /** Where the secondary battery has decided to shoot. */
  secT: Ship | null = null;
  secAimX = 0;
  secAimZ = 0;

  dmgBy = new Map<Ship, number>();
  lastHitBy: Ship | null = null;
  lastRam = -9;
  groundT = -9;
  edgeT = -9;
  sinkRoll: number;
  sinkPitch: number;
  bob = 0;

  stats = { shots: 0, hits: 0, torps: 0, torpHits: 0, dealt: 0, taken: 0 };

  turrets: Turret[];
  mainTurrets: Turret[];
  secTurrets: Turret[];

  ai: { update(dt: number): void } | null = null;

  constructor(w: World, key: string, team: string, name: string, o: ShipOpts = {}) {
    const spec = (this.spec = SPECS[key]);
    this.w = w;
    this.id = o.id || ++w.seq;
    if (this.id > w.seq) w.seq = this.id;
    this.key = key;
    this.team = team;
    this.name = name;
    this.isPlayer = !!o.player;
    this.hullNo = o.no || '';
    this.x = o.x || 0;
    this.z = o.z || 0;
    this.heading = o.heading || 0;
    this.maxV = spec.kn * KN;
    this.speed = this.maxV * (o.speedFrac != null ? o.speedFrac : 0.8);
    this.throttle = o.throttle != null ? o.throttle : 6;
    this.maxHp = spec.hp * (o.hpMul || 1);
    this.hp = this.maxHp;
    this.dc = { charges: spec.dc || 2, cd: 0, active: 0 };
    this.aiErr = spec.aiErr;
    this.gun = GUNS[spec.gun];
    this.secGun = spec.sec ? GUNS[spec.sec] : null;
    this.torp = spec.torp ? TORPS[spec.torp] : null;
    this.torpSalvo = spec.torpSalvo || (this.torp ? this.torp.salvo : 0);
    // tubes in the mounts plus roughly one set of reloads
    this.torpBudget = spec.torpBudget ?? (spec.torpMounts || 0) * this.torpSalvo * 2;
    this.torpReady = Array.from({ length: spec.torpMounts || 0 }, () => rand(0, 3));
    this.aimX = this.x;
    this.aimZ = this.z;
    this.sinkRoll = rand(0.6, 1.1) * (Math.random() < 0.5 ? -1 : 1);
    this.sinkPitch = rand(-0.25, 0.25);

    this.turrets = spec.tur.map((t) => {
      const side = Math.abs(Math.abs(t.face) - Math.PI / 2) < 0.3;
      const gun = t.sec ? this.secGun! : this.gun;
      return {
        x: t.x,
        y: deckY(spec, t.z) + t.y,
        z: t.z,
        home: t.face,
        rel: t.face,
        arc: (TS[t.kind].traverseArc ?? (t.sec ? 80 : side ? 100 : 148)) * DEG,
        sec: t.sec,
        ts: TS[t.kind],
        gun,
        trav: gun.trav * DEG * (t.sec ? 1.5 : 1),
        reload: rand(0.2, 1.5),
        reloadTotal: gun.reload,
        onTarget: false,
        inArc: false,
        elev: 0,
      };
    });
    this.mainTurrets = this.turrets.filter((t) => !t.sec);
    this.secTurrets = this.turrets.filter((t) => t.sec);
  }

  toWorld(lx: number, lz: number): [number, number] {
    const c = Math.cos(this.heading),
      s = Math.sin(this.heading);
    return [this.x + lx * c + lz * s, this.z - lx * s + lz * c];
  }

  toLocal(wx: number, wz: number): [number, number] {
    const c = Math.cos(this.heading),
      s = Math.sin(this.heading);
    const dx = wx - this.x,
      dz = wz - this.z;
    return [dx * c - dz * s, dx * s + dz * c];
  }

  get knots(): number {
    return this.speed / KN;
  }

  // ---------------------------------------------------------------- movement

  physics(dt: number): void {
    const spec = this.spec,
      w = this.w;
    if (this.alive) {
      const target = THROTTLE[this.throttle] * this.maxV;
      const acc = this.maxV / spec.accelT;
      this.speed += clamp(target - this.speed, -acc * dt * 1.4, acc * dt);
      this.rudder += clamp(this.rudderCmd - this.rudder, -dt / spec.rudderT, dt / spec.rudderT);
    } else {
      this.speed *= 1 - 0.35 * dt;
      this.rudder *= 1 - dt;
    }
    const eff = clamp((Math.abs(this.speed) / this.maxV) * 1.1 + 0.12, 0, 1) * Math.sign(this.speed || 1);
    // RUDDER SIGN. `heading` is a mathematical bearing, atan2(x, z): it grows from +z (north)
    // toward +x. In a right-handed world with +y up, (+x) x (+z) = -y, so +x is WEST - the bearing
    // grows anticlockwise on a north-up chart, which means *increasing* it swings the bow to PORT.
    // We want rudder > 0 to mean starboard (right rudder, turns right), so it subtracts.
    this.heading = wrapA(this.heading - spec.turn * DEG * this.rudder * eff * dt);
    this.speed *= 1 - Math.abs(this.rudder) * 0.07 * dt;

    const s = Math.sin(this.heading),
      c = Math.cos(this.heading);
    const sk = Math.exp(-dt * 1.5);
    this.shx *= sk;
    this.shz *= sk;
    this.vx = s * this.speed + this.shx;
    this.vz = c * this.speed + this.shz;

    const nx = this.x + this.vx * dt,
      nz = this.z + this.vz * dt;
    const probe = Math.sign(this.speed || 1) * spec.L * 0.46;
    const gh = terrainH(nx + s * probe, nz + c * probe);
    if (gh > -5 && this.alive) {
      this.groundT = w.time;
      if (Math.abs(this.speed) > this.maxV * 0.25 && w.time - this.lastRam > 2) {
        this.lastRam = w.time;
        const dmg = this.damage((this.maxHp * 0.02 * Math.abs(this.speed)) / this.maxV, null, 'ground');
        w.emit('ground', { id: this.id, dmg });
      }
      this.speed = -this.speed * 0.15;
      this.shx = this.shz = 0;
    } else {
      this.x = nx;
      this.z = nz;
    }

    const r = Math.hypot(this.x, this.z);
    if (r > MAP_R && this.alive) {
      const k = MAP_R / r;
      this.x *= k;
      this.z *= k;
      if (this.isPlayer && w.time - this.edgeT > 1.6) {
        this.edgeT = w.time;
        w.emit('edge', { id: this.id });
      }
    }

    if (this.alive) {
      if (this.dc.cd > 0) this.dc.cd -= dt;
      if (this.dc.active > 0) {
        this.dc.active -= dt;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.012 * dt);
      }
      for (let i = this.fires.length - 1; i >= 0; i--) {
        const f = this.fires[i];
        f.t -= dt;
        if (f.t <= 0) this.fires.splice(i, 1);
        this.damage((this.maxHp * 0.0016) / 60, f.src, 'fire');
        if (!this.alive) break;
      }
    }
  }

  // ---------------------------------------------------------------- damage

  startFire(lz: number, src: Ship | null): boolean {
    if (this.dc.active > 0 || this.fires.length >= 3 || !this.alive) return false;
    this.fires.push({
      lx: rand(-0.3, 0.3) * this.spec.B,
      lz: clamp(lz, -this.spec.L * 0.4, this.spec.L * 0.4),
      t: rand(14, 20),
      src,
    });
    return true;
  }

  useDC(): boolean {
    if (!this.alive || this.dc.cd > 0 || this.dc.charges <= 0) return false;
    this.dc.charges--;
    this.dc.cd = 50;
    this.dc.active = 10;
    this.fires.length = 0;
    return true;
  }

  damage(amount: number, src: Ship | null, _kind: string): number {
    if (!this.alive || amount <= 0) return 0;
    const mul = src ? this.w.dmgMul(this, src.team) : 1;
    amount = Math.min(amount * mul, this.hp);
    this.hp -= amount;
    if (src) {
      this.dmgBy.set(src, (this.dmgBy.get(src) || 0) + amount);
      this.lastHitBy = src;
      src.stats.dealt += amount;
    }
    this.stats.taken += amount;
    if (this.hp <= 0.5) this.die(src || this.lastHitBy);
    return amount;
  }

  die(killer: Ship | null): void {
    this.alive = false;
    this.hp = 0;
    this.sinkT = 0;
    this.fires.length = 0;
    this.throttle = 2;
    if (this.w.campaign) this.w.campaign.sunk(this, killer);
    const big = Math.random() < (this.spec.cls === 'DD' ? 0.45 : 0.3);
    this.w.emit('sunk', { id: this.id, killer: killer ? killer.id : 0, big: big ? 1 : 0 });
  }

  remove(): void {
    this.removed = true;
  }

  /** Relative bearing of a world point from the ship's head, wrapped. */
  bearingTo(wx: number, wz: number): number {
    return wrapA(Math.atan2(wx - this.x, wz - this.z) - this.heading);
  }
}

/** Where to aim to hit a moving target: three passes is plenty. */
export function leadPoint(fromX: number, fromZ: number, tgt: Ship, gun: GunSpec): [number, number] {
  let px = tgt.x,
    pz = tgt.z;
  for (let i = 0; i < 3; i++) {
    const T = Math.hypot(px - fromX, pz - fromZ) / gun.v0;
    px = tgt.x + tgt.vx * T;
    pz = tgt.z + tgt.vz * T;
  }
  return [px, pz];
}

export { angDiff };
