// Ship specifications.
//
// A ship is a hull (length, beam, freeboard, sheer) plus a declarative list of parts in hull-local
// metres: z toward the bow, y above the deck at that station, x to starboard. The renderer walks the
// same list to build the model, so the silhouette and the hit box can never drift apart.

import { DEG } from './constants.ts';

export type PartKind = 'b' | 'c' | 'm' | 'pl' | 'tt' | 'aa' | 'sl' | 'rf' | 'dr' | 'bt' | 'cp' | 'cr' | 'gm' | 'dc';

export interface Part {
  k: PartKind;
  z: number;
  y: number;
  x: number;
  len?: number;
  h?: number;
  w?: number;
  /** Material tag: 's' steel, 'd' deck plate. */
  m?: string;
  r?: number;
  rake?: number;
  n?: number;
  sh?: number;
  kind?: string;
  face?: number;
  cap?: string;
  pipe?: number;
  ov?: number;
  tri?: number;
  yards?: number[][];
  top?: number[];
  radar?: string;
  boom?: number;
  plane?: number;
  // block shaping
  rf?: number;
  rr?: number;
  fs?: number;
  ss?: number;
  ta?: number;
  win?: number;
}

export interface TurretMount {
  z: number;
  y: number;
  /** Rest angle in radians: 0 forward, PI aft, +/-PI/2 broadside. */
  face: number;
  kind: string;
  x: number;
  sec: boolean;
}

export type Class = 'BB' | 'CA' | 'CL' | 'DD';

export interface ShipSpec {
  key: string;
  cls: Class;
  nation: 'US' | 'JP';
  /** Class name, Chinese. */
  name: string;
  /** Type line, Chinese. */
  type: string;
  L: number;
  B: number;
  F: number;
  D: number;
  sheer: number[][];
  /** Height of the masthead above the deck, for markers and the sinking check. */
  top: number;
  stem?: string;
  deck?: string;
  kn: number;
  /** Turn rate at full rudder, degrees per second. */
  turn: number;
  rudderT: number;
  accelT: number;
  hp: number;
  tons: number;
  gun: string;
  sec?: string;
  torp?: string | null;
  torpMounts?: number;
  torpSalvo?: number;
  /** Total fish carried: tubes plus reloads. Defaults to two full salvos per mount. */
  torpBudget?: number;
  /** Range the AI likes to fight at. */
  prefRange: number;
  /** Base aiming error in metres, before range and evasion factors. */
  aiErr: number;
  dc?: number;
  /** Chase-camera [distance, height]. */
  cam: [number, number];
  /** Eye point for the bridge view: hull-local [z, height above the waterline]. */
  bridge?: [number, number];
  parts: Part[];
  tur: TurretMount[];
}

// ------------------------------------------------------------------ part helpers

export const Bx = (z: number, y: number, len: number, h: number, w: number, x = 0, m = 's', o: Partial<Part> = {}): Part =>
  Object.assign({ k: 'b' as const, z, y, len, h, w, x, m }, o);
export const Cy = (z: number, y: number, r: number, h: number, rake = 0, x = 0, o: Partial<Part> = {}): Part =>
  Object.assign({ k: 'c' as const, z, y, r, h, rake: rake * DEG, x }, o);
export const Ms = (z: number, y: number, h: number, r: number, o: Partial<Part> = {}): Part =>
  Object.assign({ k: 'm' as const, z, y, h, r, x: 0 }, o, { rake: (o.rake || 0) * DEG });
export const Pl = (z: number, y: number, len: number, w: number, x = 0): Part => ({ k: 'pl', z, y, len, w, x });
export const Tt = (z: number, y: number, n: number, x = 0, len = 7.5, sh = 0): Part => ({ k: 'tt', z, y, n, x, len, sh });
export const Aa = (z: number, y: number, x: number, kind: string): Part => ({ k: 'aa', z, y, x, kind });
export const Sl = (z: number, y: number, x: number): Part => ({ k: 'sl', z, y, x });
export const Rf = (z: number, y: number, len: number, x = 0): Part => ({ k: 'rf', z, y, len, x });
export const Dr = (z: number, y: number, kind: string): Part => ({ k: 'dr', z, y, kind, x: 0 });
export const Bt = (z: number, y: number, x: number, len: number): Part => ({ k: 'bt', z, y, x, len });
export const Cp = (z: number, y: number, x: number, len: number, face: number, plane: number): Part => ({
  k: 'cp',
  z,
  y,
  x,
  len,
  face: face * DEG,
  plane,
});
export const Cr = (z: number, y: number, x: number, h: number, boom: number): Part => ({ k: 'cr', z, y, x, h, boom });
export const Gm = (z: number, y: number, x: number, face: number, kind: string): Part => ({
  k: 'gm',
  z,
  y,
  x,
  face: face * DEG,
  kind,
});
export const Dc = (z: number, x: number): Part => ({ k: 'dc', z, y: 0, x });
export const Tu = (z: number, y: number, face: number, kind: string, x = 0, sec = false): TurretMount => ({
  z,
  y,
  face: face * DEG,
  kind,
  x,
  sec,
});

// ------------------------------------------------------------------ ships

export const SPECS: Record<string, ShipSpec> = {
  // ---------------------------------------------------------------- US battleship: North Carolina class
  us_bb: {
    key: 'us_bb',
    cls: 'BB',
    nation: 'US',
    name: '北卡罗来纳级',
    type: '战列舰',
    L: 222,
    B: 33,
    F: 8.5,
    D: 10,
    sheer: [
      [0, 0.9],
      [0.5, 0.95],
      [1, 1.3],
    ],
    top: 30,
    kn: 28,
    turn: 2.6,
    rudderT: 4,
    accelT: 22,
    hp: 72000,
    tons: 36600,
    gun: 'us406',
    sec: 'sec127',
    torp: null,
    prefRange: 9000,
    aiErr: 100,
    dc: 3,
    cam: [480, 140],
    bridge: [44, 30],
    parts: [
      Bx(3, 0, 64, 6, 25, 0, 's', { rf: 0.3, rr: 0.3 }),
      Bx(38.5, 0, 6.5, 10, 6.5, 0, 's', { rf: 1, rr: 1 }),
      Bx(31, 6, 11, 4, 13, 0, 's', { rf: 0.6, win: 0.6 }),
      Bx(31.5, 10, 9, 4.5, 10.5, 0, 's', { rf: 0.7, win: 0.7 }),
      Bx(32, 14.5, 7, 4, 8.5, 0, 's', { rf: 0.75, win: 0.7 }),
      Bx(32, 18.5, 5.5, 3.5, 6.5, 0, 's', { rf: 0.8, win: 0.6 }),
      Pl(32, 22, 7.5, 9),
      Dr(32.5, 22, 'us38'),
      Ms(29.5, 22, 13, 0.45, { yards: [[0.55, 9]], radar: 'sc' }),
      Dr(25.5, 6, 'us37'),
      Cy(12, 6, 4.2, 14, 4, 0, { cap: 'us' }),
      Cy(-5, 6, 4.2, 13, 4, 0, { cap: 'us' }),
      Pl(3.5, 12.5, 5, 11),
      Sl(3.5, 12.5, 3.8),
      Sl(3.5, 12.5, -3.8),
      Bt(3.5, 6.3, 6.8, 10),
      Bt(3.5, 6.3, -6.8, 10),
      Ms(-15, 6, 22, 0.55, { yards: [[0.75, 10]], tri: 3, top: [0.55, 2.4] }),
      Bx(-22, 6, 10, 3, 12, 0, 's', { rr: 0.5, win: 0.5 }),
      Dr(-22.5, 9, 'us37'),
      Dr(-26.5, 6, 'us38'),
      Aa(33, 6, 9.5, 'b4'),
      Aa(33, 6, -9.5, 'b4'),
      Aa(-26, 6, 9.5, 'b4'),
      Aa(-26, 6, -9.5, 'b4'),
      Aa(45, 0, 12, 'o'),
      Aa(45, 0, -12, 'o'),
      Aa(-40, 0, 12, 'o'),
      Aa(-40, 0, -12, 'o'),
      Cp(-96, 0.6, 7, 16, 25, 1),
      Cp(-96, 0.6, -7, 16, -25, 1),
      Cr(-106, 0, 0, 8, 14),
    ],
    tur: [
      Tu(72, 0, 0, 'us16t'),
      Tu(57, 4, 0, 'us16t'),
      Tu(-52, 3, 180, 'us16t'),
      Tu(20, 6, 90, 'us5d', 10.5, true),
      Tu(10, 6, 90, 'us5d', 10.5, true),
      Tu(0, 6, 90, 'us5d', 10.5, true),
      Tu(-10, 6, 90, 'us5d', 10.5, true),
      Tu(-20, 6, 90, 'us5d', 10.5, true),
      Tu(20, 6, -90, 'us5d', -10.5, true),
      Tu(10, 6, -90, 'us5d', -10.5, true),
      Tu(0, 6, -90, 'us5d', -10.5, true),
      Tu(-10, 6, -90, 'us5d', -10.5, true),
      Tu(-20, 6, -90, 'us5d', -10.5, true),
    ],
  },

  // ---------------------------------------------------------------- JP battleship: Kongo class
  jp_bb: {
    key: 'jp_bb',
    cls: 'BB',
    nation: 'JP',
    name: '金刚级',
    type: '战列舰',
    L: 222,
    B: 31,
    F: 8,
    D: 9.7,
    sheer: [
      [0, 0.85],
      [0.5, 0.9],
      [1, 1.35],
    ],
    top: 40,
    kn: 30,
    turn: 2.9,
    rudderT: 3.6,
    accelT: 20,
    hp: 48000,
    tons: 32156,
    gun: 'jp356',
    sec: 'sec152',
    torp: null,
    prefRange: 8000,
    aiErr: 95,
    dc: 3,
    cam: [470, 135],
    bridge: [52, 32],
    parts: [
      Bx(40, 0, 16, 8, 14.5, 0, 's', { rf: 0.5 }),
      Bx(40, 8, 12, 5, 11, 0, 's', { rf: 0.5, win: 0.6 }),
      Pl(40, 13, 14, 15),
      Bx(40.5, 13, 9.5, 5, 9, 0, 's', { rf: 0.6, win: 0.6 }),
      Pl(40.5, 18, 12, 13),
      Bx(41, 18, 7.5, 5, 7.5, 0, 's', { rf: 0.6, win: 0.7 }),
      Pl(41, 23, 10, 11),
      Bx(41, 23, 6, 4.5, 6.5, 0, 's', { rf: 0.7, win: 0.8 }),
      Pl(41, 27.5, 8, 9),
      Bx(41, 27.5, 5, 4, 5.5, 0, 's', { rf: 0.8, win: 0.7 }),
      Bx(41, 31.5, 3.5, 2.5, 4.5, 0, 's', { rf: 0.5 }),
      Rf(41, 34, 9),
      Ms(38.5, 34, 10, 0.45, { yards: [[0.5, 7]] }),
      Ms(37, 8, 26, 0.7, { tri: 4.5 }),
      Bx(8, 0, 36, 3.6, 16, 0, 's', { rf: 0.3, rr: 0.3 }),
      Cy(16, 0, 3.9, 14, 6, 0, { cap: 'jp', ov: 0.78, pipe: 2 }),
      Cy(0, 0, 3.7, 13, 6, 0, { cap: 'jp', ov: 0.78, pipe: 1 }),
      Pl(8, 11, 5, 13),
      Sl(8, 11, 4.5),
      Sl(8, 11, -4.5),
      Aa(24, 3.6, 6.4, 'ha2'),
      Aa(24, 3.6, -6.4, 'ha2'),
      Aa(-7, 3.6, 6.4, 'ha2'),
      Aa(-7, 3.6, -6.4, 'ha2'),
      Aa(8, 3.6, 6.2, 'j3'),
      Aa(8, 3.6, -6.2, 'j3'),
      Bx(-19, 0, 16, 6, 14, 0, 's', { rr: 0.4 }),
      Rf(-19, 6, 6),
      Ms(-25, 6, 22, 0.55, { tri: 4, yards: [[0.7, 10]], top: [0.5, 3] }),
      Cr(-24.5, 6, 0, 8, 15),
      Aa(-14, 6, 5, 'j3'),
      Aa(-14, 6, -5, 'j3'),
    ],
    tur: [
      Tu(74, 0, 0, 'jp14d'),
      Tu(60, 3.6, 0, 'jp14d'),
      Tu(-42, 3.6, 180, 'jp14d'),
      Tu(-58, 0, 180, 'jp14d'),
      Tu(30, -3.5, 90, 'jp6c', 15.2, true),
      Tu(20, -3.5, 90, 'jp6c', 15.3, true),
      Tu(10, -3.5, 90, 'jp6c', 15.4, true),
      Tu(-10, -3.5, 90, 'jp6c', 15.3, true),
      Tu(30, -3.5, -90, 'jp6c', -15.2, true),
      Tu(20, -3.5, -90, 'jp6c', -15.3, true),
      Tu(10, -3.5, -90, 'jp6c', -15.4, true),
      Tu(-10, -3.5, -90, 'jp6c', -15.3, true),
    ],
  },

  // ---------------------------------------------------------------- US heavy cruiser: New Orleans class
  us_ca: {
    key: 'us_ca',
    cls: 'CA',
    nation: 'US',
    name: '新奥尔良级',
    type: '重巡洋舰',
    L: 179,
    B: 18.8,
    F: 6.2,
    D: 6.9,
    sheer: [
      [0, 0.8],
      [0.32, 0.8],
      [0.325, 1.2],
      [1, 1.42],
    ],
    top: 24,
    kn: 32.7,
    turn: 4.3,
    rudderT: 2.4,
    accelT: 13,
    hp: 42000,
    tons: 9950,
    gun: 'us203',
    // eight 5-inch dual-purpose guns in four twin mounts on the beam. The spec marks them as
    // secondaries, so she needs a secondary gun defined or the ship cannot be built at all.
    sec: 'sec127',
    torp: null,
    prefRange: 7000,
    aiErr: 85,
    dc: 3,
    cam: [400, 115],
    bridge: [36, 18],
    parts: [
      Bx(26, 0, 17, 5.4, 13, 0, 's', { rf: 0.3 }),
      Bx(27, 5.4, 11, 3.2, 10.5, 0, 's', { rf: 0.55, win: 0.8 }),
      Bx(28, 8.6, 7, 2.6, 8, 0, 's', { rf: 0.7, win: 0.7 }),
      Pl(28, 11.2, 8, 10),
      Dr(27.5, 11.2, 'us37'),
      Ms(21.5, 5.4, 24, 0.5, { tri: 3, yards: [[0.62, 10], [0.78, 6]], top: [0.45, 2.6], radar: 'sc' }),
      Aa(34, 0, 6.2, 'o'),
      Aa(34, 0, -6.2, 'o'),
      Bx(1, 0, 30, 3, 12, 0, 's', { rf: 0.2, rr: 0.2 }),
      Cy(10, 3, 2.7, 11.5, 0, 0, { cap: 'us' }),
      Cy(-1, 3, 2.5, 10.5, 0, 0, { cap: 'us' }),
      Aa(15, 3, 5.4, 'ha'),
      Aa(15, 3, -5.4, 'ha'),
      Aa(4.5, 3, 6, 'ha'),
      Aa(4.5, 3, -6, 'ha'),
      Aa(-6, 3, 6, 'ha'),
      Aa(-6, 3, -6, 'ha'),
      Pl(4.5, 9.5, 4.5, 9),
      Sl(4.5, 9.5, 3),
      Sl(4.5, 9.5, -3),
      Bt(-1, 3.2, 4.4, 8),
      Bt(-1, 3.2, -4.4, 8),
      Bx(-19, 0, 13, 4.4, 11.5, 0, 's', { rr: 0.2, rf: 0.2 }),
      Cp(-18, 4.4, 4.3, 14, 22, 1),
      Cp(-18, 4.4, -4.3, 14, -22, 1),
      Ms(-25.5, 0, 19, 0.4, { yards: [[0.72, 8]] }),
      Cr(-25, 0, 0, 7, 12),
      Bx(-31, 0, 8, 2.8, 9, 0, 's', { rr: 0.4, win: 0.5 }),
      Dr(-31.5, 2.8, 'us37'),
      Aa(-38, 0, 5.4, 'b4'),
      Aa(-38, 0, -5.4, 'b4'),
    ],
    tur: [
      Tu(55, 0, 0, 'us8t'),
      Tu(43.5, 3, 0, 'us8t'),
      Tu(-48, 0, 180, 'us8t'),
      Tu(12, 3, 90, 'us5d', 5.4, true),
      Tu(12, 3, -90, 'us5d', -5.4, true),
      Tu(-13, 3, 90, 'us5d', 5.4, true),
      Tu(-13, 3, -90, 'us5d', -5.4, true),
    ],
  },

  // ---------------------------------------------------------------- JP heavy cruiser: Takao class
  jp_ca: {
    key: 'jp_ca',
    cls: 'CA',
    nation: 'JP',
    name: '高雄级',
    type: '重巡洋舰',
    L: 193,
    B: 19,
    F: 5.8,
    D: 6.1,
    sheer: [
      [0, 0.8],
      [0.438, 0.8],
      [0.442, 1.25],
      [1, 1.45],
    ],
    top: 28,
    kn: 35,
    turn: 4.2,
    rudderT: 2.4,
    accelT: 13,
    hp: 24000,
    tons: 9850,
    gun: 'jp203',
    torp: 't93',
    torpMounts: 2,
    prefRange: 7000,
    aiErr: 90,
    dc: 2,
    cam: [400, 115],
    bridge: [46, 20],
    parts: [
      Bx(30, 0, 22, 8, 13.5, 0, 's', { rf: 0.3 }),
      Bx(30.5, 8, 17, 6, 12, 0, 's', { rf: 0.45, win: 0.9 }),
      Pl(31, 14, 14, 16),
      Bx(31, 14, 12, 5, 9.5, 0, 's', { rf: 0.6, win: 0.9 }),
      Bx(31.5, 19, 7, 4, 7, 0, 's', { rf: 0.75, win: 0.8 }),
      Pl(31.5, 23, 8.5, 10),
      Dr(32, 23, 'jp'),
      Rf(29, 23, 6),
      Ms(21, 8, 25, 0.5, { tri: 3.5, yards: [[0.66, 10]], top: [0.52, 2.4] }),
      Bx(2, 0, 18, 2.8, 8.4, 0, 's', { rf: 0.3, rr: 0.3 }),
      Cy(8, 0, 3.8, 12.5, 14, 0, { cap: 'jp', ov: 0.6, pipe: 2 }),
      Cy(-5, 0, 2.5, 11.5, 14, 0, { cap: 'jp', pipe: 1 }),
      Aa(1, 2.8, 3, 'ha'),
      Aa(1, 2.8, -3, 'ha'),
      Bt(14, 1.4, 6.3, 9),
      Bt(14, 1.4, -6.3, 9),
      Tt(-8, 0, 4, 6.8, 8),
      Tt(-8, 0, 4, -6.8, 8),
      Bx(-18, 0, 13, 3.4, 12, 0, 's', { rr: 0.2 }),
      Cp(-16, 3.4, 4.2, 17, 12, 1),
      Cp(-16, 3.4, -4.2, 17, -12, 1),
      Bx(-29, 0, 8, 3, 8.4, 0, 's', { rr: 0.3 }),
      Rf(-26.5, 3, 4),
      Ms(-30, 3, 19, 0.45, { tri: 3, yards: [[0.72, 7]] }),
      Cr(-29.5, 3, 0, 7, 14),
    ],
    tur: [
      Tu(72, 0, 0, 'jp8d'),
      Tu(61, 2.8, 0, 'jp8d'),
      Tu(50, 4.8, 0, 'jp8d'),
      Tu(-46, 2.8, 180, 'jp8d'),
      Tu(-57, 0, 180, 'jp8d'),
    ],
  },

  // ---------------------------------------------------------------- JP destroyer: Fubuki class
  jp_dd: {
    key: 'jp_dd',
    cls: 'DD',
    nation: 'JP',
    name: '吹雪级',
    type: '驱逐舰',
    L: 118,
    B: 10.4,
    F: 4.6,
    D: 3.2,
    sheer: [
      [0, 0.85],
      [0.618, 0.85],
      [0.622, 1.45],
      [1, 1.65],
    ],
    top: 12,
    stem: 'clipper',
    kn: 38,
    turn: 6.3,
    rudderT: 1.6,
    accelT: 9,
    hp: 10500,
    tons: 1750,
    gun: 'jp127',
    torp: 't93',
    torpMounts: 3,
    torpSalvo: 3,
    prefRange: 4200,
    aiErr: 80,
    dc: 1,
    cam: [300, 88],
    bridge: [32, 12],
    parts: [
      Bx(26.5, 0, 9.5, 2.8, 7.4, 0, 's', { rf: 0.5 }),
      Bx(27, 2.8, 7, 2.0, 6.4, 0, 's', { rf: 0.75, win: 0.6 }),
      Bx(27.3, 4.8, 4.6, 1.7, 5.2, 0, 's', { rf: 0.85, win: 0.8 }),
      Rf(27.3, 6.5, 3),
      Ms(22, 2.8, 13.5, 0.3, { tri: 2.2, yards: [[0.7, 5]], top: [0.52, 1.4] }),
      Cy(9, 0, 1.95, 7.8, 10, 0, { cap: 'jp', ov: 0.62, pipe: 1 }),
      Cy(-3, 0, 1.55, 6.8, 10, 0, { cap: 'jp', pipe: 1 }),
      Tt(3.5, 0.6, 3, 0, 8, 1),
      Tt(-10, 0.6, 3, 0, 8, 1),
      Tt(-18.5, 0.6, 3, 0, 8, 1),
      Bt(8, 1.4, 3.8, 6),
      Bt(8, 1.4, -3.8, 6),
      Bx(-27, 0, 7.5, 2.2, 5, 0, 's', { rr: 0.3 }),
      Ms(-24, 2.2, 9, 0.25, { yards: [[0.8, 3]] }),
      Aa(-7.8, 1.2, 0, 'j2'),
      Dc(-56, 1.6),
      Dc(-56, -1.6),
    ],
    tur: [
      Tu(39, 0, 0, 'jp5d'),
      Tu(-33, 2.2, 180, 'jp5d'),
      Tu(-44, 0, 180, 'jp5d'),
    ],
  },

  // ---------------------------------------------------------------- US destroyer: Fletcher class
  us_dd: {
    key: 'us_dd',
    cls: 'DD',
    nation: 'US',
    name: '弗莱彻级',
    type: '驱逐舰',
    L: 114,
    B: 12,
    F: 5.2,
    D: 4,
    sheer: [
      [0, 0.9],
      [0.5, 0.95],
      [1, 1.4],
    ],
    top: 12,
    kn: 36.5,
    turn: 6.2,
    rudderT: 1.5,
    accelT: 9,
    hp: 16000,
    tons: 2050,
    gun: 'us127',
    torp: 'mk15',
    torpMounts: 2,
    prefRange: 4200,
    aiErr: 70,
    dc: 2,
    cam: [300, 88],
    bridge: [33, 13],
    parts: [
      Bx(22, 0, 14, 2.6, 8.6, 0, 's', { rf: 0.35 }),
      Bx(22.5, 2.6, 8.5, 2.4, 7.6, 0, 's', { rf: 0.7, win: 0.7, fs: 0.4 }),
      Bx(23, 5.0, 5.6, 1.9, 6.4, 0, 's', { rf: 0.8, win: 0.8 }),
      Pl(22.5, 6.9, 7.6, 8.4),
      Dr(20.6, 6.9, 'us37'),
      Aa(20.5, 5, 3.5, 'o'),
      Aa(20.5, 5, -3.5, 'o'),
      Ms(17, 2.6, 19, 0.35, { yards: [[0.64, 7.5], [0.8, 4]], radar: 'sc', rake: 4 }),
      Bx(1, 0, 27, 2.4, 6.4, 0, 's', { rf: 0.25, rr: 0.25 }),
      Cy(8, 2.4, 1.75, 8.2, 5, 0, { cap: 'us' }),
      Cy(-6, 2.4, 1.75, 7.6, 5, 0, { cap: 'us' }),
      Tt(1, 2.4, 5),
      Bx(-17.5, 0, 6, 0.9, 4.6),
      Tt(-17.5, 0.9, 5),
      Pl(-9.8, 6.6, 2.6, 3.4),
      Sl(-9.8, 6.6, 0),
      Bt(-3, 1.4, -4.6, 7.5),
      Aa(-11, 0, 4.1, 'o'),
      Aa(-11, 0, -4.1, 'o'),
      Bx(-27, 0, 11, 2.8, 7, 0, 's', { rr: 0.2 }),
      Aa(-23, 2.8, 0, 'b2'),
      Dc(-54.5, 2.2),
      Dc(-54.5, -2.2),
    ],
    tur: [
      Tu(40, 0, 0, 'us5s'),
      Tu(31, 2.6, 0, 'us5s'),
      Tu(-28, 2.8, 180, 'us5s'),
      Tu(-38, 1.2, 180, 'us5s'),
      Tu(-47, 0, 180, 'us5s'),
    ],
  },
};

for (const k in SPECS) SPECS[k].key = k;

export const CLASS_CN: Record<Class, string> = { BB: '战列舰', CA: '重巡洋舰', CL: '轻巡洋舰', DD: '驱逐舰' };

/** Small hulls are harder to range: scale the AI's error by class. */
export const SIZE_ERR: Record<Class, number> = { DD: 1.35, CL: 1.1, CA: 1, BB: 0.9 };
