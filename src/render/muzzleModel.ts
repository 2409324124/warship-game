/** Muzzle-only simulation. Units: metres, seconds, radians, linear RGB. No renderer/DOM required. */
export const MUZZLE_SMOKE_CAPACITY = 512;
export const MUZZLE_FLASH_CAPACITY = 128;

const saturate = (x: number) => Math.max(0, Math.min(1, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => { const t = saturate(x); return t * t * (3 - 2 * t); };

export interface MuzzleProfile {
  smokeLife: number;
  smokeCount: number;
  diameter: number;
  expansion: number;
  speed: number;
  opacity: number;
  warmth: number;
  flashLife: number;
  flashDiameter: number;
}

/** Interpolate around actual DD/CA/BB calibres rather than treating all guns as a scaled BB. */
export function muzzleProfile(calibre: number): MuzzleProfile {
  const cal = Number.isFinite(calibre) ? Math.max(76, Math.min(510, calibre)) : 127;
  const heavy = saturate((cal - 203) / 203);
  const light = saturate((cal - 127) / 76);
  return {
    smokeLife: cal <= 203 ? mix(2.2, 5, light) : mix(5, 10, heavy),
    smokeCount: cal <= 203 ? Math.round(mix(7, 8, light)) : Math.round(mix(8, 10, heavy)),
    diameter: cal <= 203 ? mix(2.6, 4.2, light) : mix(4.2, 6.5, heavy),
    expansion: cal <= 203 ? mix(8, 15, light) : mix(15, 25, heavy),
    speed: cal <= 203 ? mix(12, 21, light) : mix(21, 34, heavy),
    opacity: cal <= 203 ? mix(0.24, 0.19, light) : mix(0.19, 0.27, heavy),
    warmth: cal <= 203 ? mix(0.15, 0.55, light) : mix(0.55, 1, heavy),
    flashLife: cal <= 203 ? mix(0.09, 0.105, light) : mix(0.105, 0.145, heavy),
    flashDiameter: cal <= 203 ? mix(3.5, 7, light) : mix(7, 13, heavy),
  };
}

export interface MuzzleParticle {
  serial: number;
  x: number; y: number; z: number;
  ox: number; oy: number; oz: number;
  vx: number; vy: number; vz: number;
  wx: number; wy: number; wz: number;
  ax: number; ay: number; az: number;
  age: number; life: number;
  initialSize: number; expansion: number; size: number;
  opacity: number; warmth: number;
  rotation: number; spin: number;
  aspect: number; shade: number;
  r: number; g: number; b: number; alpha: number;
}

function particle(): MuzzleParticle {
  return { serial: 0, x: 0, y: 0, z: 0, ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0, ax: 0, ay: 0, az: 1,
    age: 0, life: 1, initialSize: 1, expansion: 0, size: 1, opacity: 0, warmth: 0,
    rotation: 0, spin: 0, aspect: 1, shade: 1, r: 0, g: 0, b: 0, alpha: 0 };
}

/** Analytic motion is frame-rate independent, including after a long background-tab frame. */
export function sampleMuzzle(p: MuzzleParticle, flash: boolean): void {
  const t = Math.max(0, p.age);
  const u = saturate(t / p.life);
  const travel = -Math.expm1(-2.3 * t) / 2.3;
  const drift = t - travel;
  p.x = p.ox + p.vx * travel + (flash ? 0 : p.wx * drift);
  p.y = p.oy + p.vy * travel + (flash ? 0 : p.wy * drift);
  p.z = p.oz + p.vz * travel + (flash ? 0 : p.wz * drift);
  if (flash) {
    p.size = p.initialSize * (1 + 0.35 * u);
    p.aspect = 2.3 + 0.7 * u;
    p.r = 2.7; p.g = mix(2.3, 1.4, u); p.b = mix(1.7, 0.6, u);
    p.alpha = p.opacity * (1 - u) ** 2;
  } else {
    // Rapid pressure expansion, then slow turbulent swelling; never a long-lived orange fireball.
    p.size = p.initialSize + p.expansion * (0.65 * (1 - Math.exp(-2.5 * t)) + 0.35 * Math.sqrt(u));
    const cool = smooth(t / mix(1.1, 2.4, p.warmth));
    // Restore heavy-gun body/readability without changing DD/CA colours or filling texture gaps.
    const heavy = smooth((p.warmth - 0.55) / 0.45);
    p.r = (mix(mix(0.43, 0.16, p.warmth), mix(0.46, 0.34, p.warmth), cool)
      + heavy * mix(0.06, 0.09, cool)) * p.shade;
    p.g = (mix(mix(0.45, 0.135, p.warmth), mix(0.48, 0.35, p.warmth), cool)
      + heavy * mix(0.065, 0.10, cool)) * p.shade;
    p.b = (mix(mix(0.46, 0.11, p.warmth), mix(0.49, 0.36, p.warmth), cool)
      + heavy * mix(0.06, 0.11, cool)) * p.shade;
    p.aspect = 1.2 + p.warmth * (0.25 + 0.9 * smooth(t / 6));
    // Dilution tracks pressure expansion, then wind mixing. Keep a thin 6s BB tail,
    // but don't keep an optically solid core until the lifetime ends.
    const dilution = mix(1, 0.34 + 0.66 * Math.exp(-0.48 * t), p.warmth);
    p.alpha = p.opacity * mix(0.55, 1, smooth(t / 0.09)) * dilution
      * (1 - smooth((u - 0.06) / 0.94));
  }
}

/** Dense active range, preallocated particles, swap-removal. Full pools recycle oldest particles. */
export class MuzzlePool {
  readonly particles: MuzzleParticle[];
  count = 0;
  spawned = 0;
  recycled = 0;
  readonly capacity: number;
  readonly flash: boolean;
  constructor(capacity: number, flash: boolean) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid muzzle pool capacity');
    this.capacity = capacity;
    this.flash = flash;
    this.particles = Array.from({ length: capacity }, particle);
  }

  acquire(): MuzzleParticle {
    this.spawned++;
    if (this.count < this.capacity) {
      const p = this.particles[this.count++];
      p.serial = this.spawned;
      return p;
    }
    let oldest = 0;
    for (let i = 1; i < this.count; i++) {
      if (this.particles[i].serial < this.particles[oldest].serial) oldest = i;
    }
    this.recycled++;
    this.particles[oldest].serial = this.spawned;
    return this.particles[oldest];
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    let i = 0;
    while (i < this.count) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.particles[i] = this.particles[--this.count];
        this.particles[this.count] = p;
      } else {
        sampleMuzzle(p, this.flash);
        i++;
      }
    }
  }

  reset(): void { this.count = this.spawned = this.recycled = 0; }
}

export class MuzzleSimulation {
  readonly smoke = new MuzzlePool(MUZZLE_SMOKE_CAPACITY, false);
  readonly flash = new MuzzlePool(MUZZLE_FLASH_CAPACITY, true);
  private readonly random: () => number;
  constructor(random: () => number = () => Math.random()) { this.random = random; }

  emit(x: number, y: number, z: number, bearing: number, cal: number, elevation = 0): void {
    if (![x, y, z, bearing, cal, elevation].every(Number.isFinite)) return;
    const profile = muzzleProfile(cal);
    const ce = Math.cos(elevation), se = Math.sin(elevation);
    const sb = Math.sin(bearing), cb = Math.cos(bearing);
    // Barrel axis + two perpendicular axes, including elevation (bearing 0 is +Z).
    const dx = sb * ce, dy = se, dz = cb * ce;
    for (const pool of [this.smoke, this.flash]) {
      const flash = pool.flash;
      const count = flash ? 3 : profile.smokeCount;
      for (let i = 0; i < count; i++) {
        const p = pool.acquire();
        const a = this.random() * Math.PI * 2;
        const radial = Math.sqrt(this.random());
        // Root, rolling middle, and leading fragments. Not fifteen coincident spheres.
        const tier = (i + this.random() * 0.5) / count;
        const along = flash ? 0.3 + i * 0.75 : 0.15 + tier * mix(1.8, 3.6, profile.warmth);
        const width = profile.diameter * (flash ? 0.04 : 0.2 + tier * 0.9) * radial;
        const side = Math.cos(a), up = Math.sin(a);
        const rx = cb * side - sb * se * up;
        const ry = ce * up;
        const rz = -sb * side - cb * se * up;
        p.ox = x + dx * along * profile.diameter + rx * width;
        p.oy = y + dy * along * profile.diameter + ry * width;
        p.oz = z + dz * along * profile.diameter + rz * width;
        const speed = profile.speed * (flash ? 0.65 + this.random() * 0.4 : 0.3 + tier * 1.4 + this.random() * 0.25);
        const lateral = profile.speed * (flash ? 0.04 : 0.25 + tier * 0.5) * radial;
        p.vx = dx * speed + rx * lateral;
        p.vy = dy * speed + ry * lateral;
        p.vz = dz * speed + rz * lateral;
        p.wx = 1.8 + rx * 1.6 + (this.random() - 0.5) * 0.8;
        p.wy = 0.65 + ry * 0.4;
        p.wz = 0.65 + rz * 1.6;
        p.ax = dx; p.ay = dy; p.az = dz;
        p.age = 0;
        p.life = flash ? profile.flashLife * (0.8 + this.random() * 0.2)
          : profile.smokeLife * (0.8 + this.random() * 0.4);
        p.initialSize = (flash ? profile.flashDiameter * (1 - i * 0.24) : profile.diameter * (0.7 + tier * 0.6))
          * (0.8 + this.random() * 0.4);
        p.expansion = profile.expansion * (0.8 + this.random() * 0.4);
        p.opacity = flash ? 0.9 : profile.opacity * (0.7 + this.random() * 0.4);
        p.warmth = profile.warmth;
        p.rotation = (this.random() - 0.5) * (flash ? 0.16 : 1.2);
        p.spin = (this.random() - 0.5) * 0.1;
        p.shade = 0.78 + this.random() * 0.27;
        sampleMuzzle(p, flash);
      }
    }
  }

  update(dt: number): void { this.smoke.update(dt); this.flash.update(dt); }
  reset(): void { this.smoke.reset(); this.flash.reset(); }
  stats() {
    return {
      smoke: this.smoke.count, flash: this.flash.count,
      smokeCapacity: this.smoke.capacity, flashCapacity: this.flash.capacity,
      smokeSpawned: this.smoke.spawned, flashSpawned: this.flash.spawned,
      smokeRecycled: this.smoke.recycled, flashRecycled: this.flash.recycled,
    };
  }
}
