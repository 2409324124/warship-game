// World-space height field: no horizontal Gerstner offset/inverse lookup mismatch.
// All displacement constants and GLSL wave terms are generated from this CPU spectrum.
const TAU = Math.PI * 2;
export const OCEAN_LIMIT = 1e7;
export const BLAST_CAPACITY = 24;
export const BLAST_LIFE = 3.6;
export const BLAST_HEIGHT_CAP = 0.48;
const SPEED = 23, WIDTH = 6, FOAM_LIFE = 1.05;
const FOAM_GAIN = 0.825, FOAM_WIDTH = 16, FOAM_CAP = 0.38;
const smoothstep = (a: number, b: number, v: number) => {
  const s = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return s * s * (3 - 2 * s);
};
// Coarse angular gaps, not merely pores in an otherwise complete white ring.
function pressureArc(x: number, z: number): number {
  const angle = Math.atan2(z, x);
  return smoothstep(-0.1, 0.35, Math.sin(angle * 3 + 1.7) + 0.45 * Math.sin(angle * 5 - 0.8));
}

/** One spectral component: a single-valued sine train with a second-harmonic crest pinch.
 * `displace` waves move vertices, boats and gameplay height queries; the three shortest
 * (`!displace`) waves are fragment-normal detail only — a 5 m mesh cannot resolve < 26 m. */
export interface OceanWave {
  readonly dx: number; readonly dz: number; readonly k: number; readonly omega: number;
  readonly amplitude: number; readonly phase: number;
  /** Second-harmonic coefficient: long swells stay round, steep wind waves pinch. */
  readonly harmonic: number;
  readonly foamWeight: number;
  readonly displace: boolean;
}

// Generated spectrum, not a hand-tuned table: geometric wavelengths around the 220 m
// Pierson-Moskowitz peak, log-normal energy envelope (tight on the swell side, broad on the
// wind-wave side), directions spread around the wind plus two off-wind swell trains.
// Total energy ΣA² = 2.2 reproduces the previous sea's height/slope/hull-motion invariants.
const SPECTRUM_ENERGY = 2.2;
const SPECTRUM = (() => {
  const PEAK = 220, RATIO = 0.7, WIND = 0.35;
  const OFFSETS = [-1.0, 0.8, 0.08, -0.08, 0.2, -0.2, 0.36, -0.36, 0.55, -0.55, 0.2, -0.36];
  const raw = OFFSETS.map((off, i) => {
    const length = PEAK * RATIO ** (i - 2);
    const s = Math.log(length / PEAK);
    const envelope = (length / PEAK) ** 0.9 * Math.exp(-0.5 * (s / (s >= 0 ? 0.4 : 1.6)) ** 2);
    return { i, length, envelope, angle: WIND + off };
  });
  const disp = raw.filter(w => w.i <= 8);
  const scale = Math.sqrt(SPECTRUM_ENERGY / disp.reduce((s, w) => s + w.envelope ** 2, 0));
  // Detail waves are sized for slope (A·k ≈ 0.02–0.03 each), not for height energy.
  return raw.map(w => ({ ...w, amplitude: w.i <= 8 ? w.envelope * scale : [0.06, 0.05, 0.04][w.i - 9] }));
})();

export const OCEAN_WAVES: readonly OceanWave[] = SPECTRUM.map(w => Object.freeze({
  dx: Math.cos(w.angle), dz: Math.sin(w.angle), k: TAU / w.length,
  omega: Math.sqrt(9.81 * TAU / w.length), amplitude: w.amplitude,
  // Deterministic phases: reproducible seas without a seeded RNG dependency.
  phase: ((Math.sin(w.i * 12.9898) * 43758.5453) % 1 + 1) % 1 * TAU,
  harmonic: 0.22 * Math.min(60 / w.length, 1),
  // Only wind waves break; broad swells never become whitecaps.
  foamWeight: w.i <= 8 && w.length < 90 ? Math.min(0.55, 18 / w.length) : 0,
  displace: w.i <= 8,
}));

export interface OceanSample { height: number; dx: number; dz: number; foam: number }
const empty = (): OceanSample => ({ height: 0, dx: 0, dz: 0, foam: 0 });
const bounded = (v: number) => Number.isFinite(v) ? Math.max(-OCEAN_LIMIT, Math.min(OCEAN_LIMIT, v)) : 0;
const wavePhase = (w: typeof OCEAN_WAVES[number], t: number) => Math.fround((-w.omega * bounded(t) + w.phase) % TAU);

/** Reduced temporal phases avoid float32 precision loss during long-running matches. */
export function oceanPhases(t: number, target: Float32Array = new Float32Array(OCEAN_WAVES.length)): Float32Array {
  OCEAN_WAVES.forEach((w, i) => { target[i] = wavePhase(w, t); });
  return target;
}

/** Fine capillary detail is shading-only; the `displace` gravity waves move vertices and ships. */
export function sampleOcean(x: number, z: number, t: number): OceanSample {
  x = bounded(x); z = bounded(z); t = bounded(t);
  const out = empty();
  for (const w of OCEAN_WAVES) {
    if (!w.displace) continue;
    const f = w.k * (w.dx * x + w.dz * z) + wavePhase(w, t);
    // Second harmonic sharpens crests without increasing boat motion or adding horizontal drift.
    out.height += w.amplitude * (Math.sin(f) - w.harmonic * Math.cos(2 * f));
    const slope = w.amplitude * w.k * (Math.cos(f) + 2 * w.harmonic * Math.sin(2 * f));
    out.dx += w.dx * slope; out.dz += w.dz * slope;
    // Only the narrow crest of each wind wave can break; broad swell faces never become decals.
    out.foam += w.foamWeight * Math.max(0, Math.sin(f) - 0.985);
  }
  return out;
}

/** cal is bore diameter in mm, height is vertical muzzle clearance in metres. */
export function blastStrength(cal: number, height: number): number {
  if (!Number.isFinite(cal) || !Number.isFinite(height) || cal <= 0) return 0;
  return Math.min(1.35, (Math.min(cal, 600) / 406) ** 2) / (1 + (Math.max(0, height) / 18) ** 2);
}

/** Dense fixed pool of [world x, world z, age, strength]. No per-shot allocations.
 * Upload ages, not absolute float32 timestamps: late-game impulses retain subsecond precision. */
export class OceanBlasts {
  readonly data = new Float32Array(BLAST_CAPACITY * 4);
  private readonly births = new Float64Array(BLAST_CAPACITY);
  private cursor = 0;
  count = 0;
  time = 0;

  update(t: number): void {
    if (!Number.isFinite(t)) return;
    t = bounded(t);
    if (t < this.time) this.reset(); // new match / simulation clock rewind
    this.time = t;
    for (let i = this.count - 1; i >= 0; i--) {
      if (t - this.births[i] >= BLAST_LIFE) {
        this.count--;
        this.data.copyWithin(i * 4, this.count * 4, this.count * 4 + 4);
        this.births[i] = this.births[this.count];
        this.data.fill(0, this.count * 4, this.count * 4 + 4);
        this.births[this.count] = 0;
      }
    }
    for (let i = 0; i < this.count; i++) this.data[i * 4 + 2] = t - this.births[i];
  }

  blast(x: number, z: number, cal: number, heightAboveWater = 10): void {
    const strength = blastStrength(cal, heightAboveWater);
    if (!strength || !Number.isFinite(x) || !Number.isFinite(z)
      || Math.abs(x) > OCEAN_LIMIT || Math.abs(z) > OCEAN_LIMIT) return;
    let slot = this.count;
    if (slot === BLAST_CAPACITY) {
      slot = this.cursor;
      for (let i = 0; i < this.count; i++) {
        if (this.births[i] < this.births[slot]) slot = i;
      }
      // Equal-time salvo: retire the weakest, so light AA cannot evict all heavy impulses.
      for (let i = 0; i < this.count; i++) {
        if (this.births[i] === this.births[slot]
          && this.data[i * 4 + 3] < this.data[slot * 4 + 3]) slot = i;
      }
      if (this.births[slot] === this.time && strength < this.data[slot * 4 + 3]) return;
    } else this.count++;
    const j = slot * 4;
    this.data[j] = x; this.data[j + 1] = z;
    this.births[slot] = this.time;
    this.data[j + 2] = 0; this.data[j + 3] = strength;
    this.cursor = (slot + 1) % BLAST_CAPACITY;
  }

  reset(): void { this.count = 0; this.cursor = 0; this.data.fill(0); this.births.fill(0); }

  sample(x: number, z: number, t: number): OceanSample {
    const out = empty();
    if (![x, z, t].every(Number.isFinite)) return out;
    for (let i = 0; i < this.count; i++) {
      const j = i * 4, age = t - this.births[i];
      if (age <= 0 || age >= BLAST_LIFE) continue;
      const px = x - this.data[j], pz = z - this.data[j + 1];
      const r = Math.sqrt(px * px + pz * pz + 0.01);
      if (r > SPEED * age + WIDTH * 4) continue;
      const q = (r - SPEED * age) / WIDTH;
      const packet = Math.exp(-q * q);
      const env = this.data[j + 3] * (1 - Math.exp(-age * 22)) * (1 - age / BLAST_LIFE) ** 2;
      const ring = packet * Math.sin(q * 2.4);
      const dr = packet * (2.4 * Math.cos(q * 2.4) - 2 * q * Math.sin(q * 2.4)) / WIDTH;
      const dent = Math.exp(-r * r / 144 - age * 4);
      const phase = px * 0.7 + pz * 0.53 - age * 11;
      const churn = 0.12 * packet * Math.sin(phase);
      const radial = dr + 0.7 * r / 144 * dent - 2 * q / WIDTH * churn;
      out.height += env * (ring - 0.35 * dent + churn);
      out.dx += env * (radial * px / r + 0.084 * packet * Math.cos(phase));
      out.dz += env * (radial * pz / r + 0.0636 * packet * Math.cos(phase));
      // A narrow moving front, not a filled circular pressure stain or central white dent.
      out.foam += env * Math.min(1, this.data[j + 3] * 1.5)
        * Math.max(0, 1 - age / FOAM_LIFE) * Math.exp(-q * q * FOAM_WIDTH) * FOAM_GAIN * pressureArc(px, pz);
    }
    // Soft saturation: stacked barrels remain visible, but cannot throw the hull into the air.
    const denom = 1 + Math.abs(out.height);
    out.height = BLAST_HEIGHT_CAP * out.height / denom;
    out.dx *= BLAST_HEIGHT_CAP / (denom * denom);
    out.dz *= BLAST_HEIGHT_CAP / (denom * denom);
    out.foam = Math.min(FOAM_CAP, out.foam);
    return out;
  }
}

const f = (v: number) => Number.isInteger(v) ? `${v}.0` : `${v}`;
export const OCEAN_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWavePhase[${OCEAN_WAVES.length}];
uniform int uBlastCount;
uniform vec4 uBlasts[${BLAST_CAPACITY}];
// result = height, dH/dx, dH/dz, crest/foam measure — displacement waves only, mirrors sampleOcean
vec4 oceanSurface(vec2 p) {
  p = clamp(p, vec2(-${f(OCEAN_LIMIT)}), vec2(${f(OCEAN_LIMIT)}));
  vec4 s = vec4(0.0);
  float phase, slope;
  ${OCEAN_WAVES.map((w, i) => !w.displace ? '' : `
  phase = ${f(w.k)} * dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) + uWavePhase[${i}];
  s.x += ${f(w.amplitude)} * (sin(phase) - ${f(w.harmonic)} * cos(2.0 * phase));
  slope = ${f(w.amplitude * w.k)} * (cos(phase) + ${f(2 * w.harmonic)} * sin(2.0 * phase));
  s.yz += vec2(${f(w.dx)}, ${f(w.dz)}) * slope;${w.foamWeight > 0 ? `
  s.w += ${f(w.foamWeight)} * max(0.0, sin(phase) - 0.985);` : ''}`).join('\n')}
  return s;
}
// Shading-only short waves: normal detail below mesh resolution; they never move vertices or ships.
vec2 detailSlope(vec2 p) {
  vec2 s = vec2(0.0);
  float phase;
  ${OCEAN_WAVES.map((w, i) => w.displace ? '' : `
  phase = ${f(w.k)} * dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) + uWavePhase[${i}];
  s += vec2(${f(w.dx)}, ${f(w.dz)}) * (${f(w.amplitude * w.k)} * (cos(phase) + ${f(2 * w.harmonic)} * sin(2.0 * phase)));`).join('\n')}
  return s;
}
vec4 blastSurface(vec2 p) {
  vec4 s = vec4(0.0);
  for (int i = 0; i < ${BLAST_CAPACITY}; i++) {
    if (i >= uBlastCount) break;
    vec4 b = uBlasts[i];
    float age = b.z;
    if (age <= 0.0 || age >= ${f(BLAST_LIFE)}) continue;
    vec2 d = p - b.xy;
    float radius = ${f(SPEED)} * age + ${f(WIDTH * 4)};
    if (dot(d, d) > radius * radius) continue;
    float r = sqrt(dot(d, d) + 0.01);
    float q = (r - ${f(SPEED)} * age) / ${f(WIDTH)};
    float packet = exp(-q * q);
    float env = b.w * (1.0 - exp(-age * 22.0)) * pow(1.0 - age / ${f(BLAST_LIFE)}, 2.0);
    float ring = packet * sin(q * 2.4);
    float dr = packet * (2.4 * cos(q * 2.4) - 2.0 * q * sin(q * 2.4)) / ${f(WIDTH)};
    float dent = exp(-r * r / 144.0 - age * 4.0);
    float phase = d.x * 0.7 + d.y * 0.53 - age * 11.0;
    float churn = 0.12 * packet * sin(phase);
    float radial = dr + 0.7 * r / 144.0 * dent - 2.0 * q / ${f(WIDTH)} * churn;
    s.x += env * (ring - 0.35 * dent + churn);
    s.yz += env * (radial * d / r + vec2(0.084, 0.0636) * packet * cos(phase));
    float angle = atan(d.y, d.x + 1e-10);
    float arc = smoothstep(-0.1, 0.35, sin(angle * 3.0 + 1.7) + 0.45 * sin(angle * 5.0 - 0.8));
    s.w += env * min(1.0, b.w * 1.5) * max(0.0, 1.0 - age / ${f(FOAM_LIFE)})
      * exp(-q * q * ${f(FOAM_WIDTH)}) * ${f(FOAM_GAIN)} * arc;
  }
  float denom = 1.0 + abs(s.x);
  s.xyz *= vec3(${f(BLAST_HEIGHT_CAP)} / denom, vec2(${f(BLAST_HEIGHT_CAP)} / (denom * denom)));
  s.w = min(${f(FOAM_CAP)}, s.w);
  return s;
}
`;
