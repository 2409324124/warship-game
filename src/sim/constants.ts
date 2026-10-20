// Shared maths and tuning constants for the simulation layer.
// This file must stay free of three.js and DOM so the battle can also run head-less (tests, a server, a replay tool).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// One game second stands for this many real seconds of ship motion. Without it a 30-knot destroyer
// crosses only 190 m during an 11 s shell flight and the game stops being about leading the target.
// Ships, torpedoes and reloads live in game time; the shell flight times you tune are game seconds too.
export const TIME_COMPRESS = 2.5;
export const KN = 0.5144 * TIME_COMPRESS; // knots -> game m/s

export const MAP_R = 10000; // the ship is pushed back inside this radius

export const THROTTLE = [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const wrapA = (a: number) => {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
};
export const angDiff = (a: number, b: number) => wrapA(b - a);

let spare: number | null = null;
/** Standard normal, Box-Muller with the second value cached. */
export function randn(): number {
  if (spare !== null) {
    const v = spare;
    spare = null;
    return v;
  }
  let u = 0,
    v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u));
  spare = r * Math.sin(TAU * v);
  return r * Math.cos(TAU * v);
}

// ------------------------------------------------------------------ value noise (islands & sea clutter)

function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy),
    b = hash2(ix + 1, iy),
    c = hash2(ix, iy + 1),
    d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

export function fbm(x: number, y: number): number {
  let s = 0,
    a = 0.5,
    f = 1;
  for (let i = 0; i < 5; i++) {
    s += a * vnoise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s / 0.97;
}
