// Procedural ship models.
//
// The hull is lofted from stations: at each one the shared hull-shape code gives a half-section, and
// consecutive stations are stitched into a skin. Everything above the deck comes from the same part
// list the simulation uses, so what you see is what you can hit.

import * as THREE from 'three';
import { clamp, lerp, TAU } from '../sim/constants';
import { deckY, hullSection, RING } from '../sim/hull';
import type { ShipSpec } from '../sim/ships';
import { TS, type TurretShape } from '../sim/guns';
import { bowRake, proceduralRailPlan } from './deckOutline';
import { buildTubeRailings } from './railings';

// ------------------------------------------------------------------ small geometry helpers

const boxG = (w: number, h: number, len: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, h / 2, 0);
  return g;
};

const cylG = (rt: number, rb: number, h: number, seg = 10, open = false): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);

function rodG(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry => {
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};

/** A rounded rectangle in the XZ plane, [x, z] pairs, counter-clockwise. */
function planPoly(len: number, w: number, rf = 0, rr = 0, seg = 4): [number, number][] {
  const hw = w / 2,
    hl = len / 2;
  const f = Math.min(hl, Math.abs(rf) * hw);
  const r = Math.min(hl, Math.abs(rr) * hw);
  const pts: [number, number][] = [];
  const arc = (cx: number, cz: number, rad: number, a0: number, a1: number) => {
    if (rad < 0.02) return;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      pts.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]);
    }
  };
  pts.push([-(hw - f), hl]);
  pts.push([hw - f, hl]);
  arc(hw - f, hl - f, f, Math.PI / 2, 0);
  pts.push([hw, hl - f]);
  pts.push([hw, -(hl - r)]);
  arc(hw - r, -(hl - r), r, 0, -Math.PI / 2);
  pts.push([hw - r, -hl]);
  pts.push([-(hw - r), -hl]);
  arc(-(hw - r), -(hl - r), r, -Math.PI / 2, -Math.PI);
  pts.push([-hw, -(hl - r)]);
  pts.push([-hw, hl - f]);
  arc(-(hw - f), hl - f, f, Math.PI, Math.PI / 2);
  return pts;
}

/** Prism from a bottom polygon to a top polygon (both [x, z] pairs), with optional caps. */
function loftGeo(
  bot: [number, number][],
  top: [number, number][],
  y0: number,
  y1: number,
  capTop = true,
  capBot = false,
  sides = true,
): THREE.BufferGeometry {
  const P: number[] = [];
  const n = Math.min(bot.length, top.length);
  const V = (q: [number, number], y: number) => [q[0], y, q[1]];
  const tri = (a: number[], b: number[], c: number[]) => P.push(...a, ...b, ...c);
  if (sides) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const A = V(bot[i], y0),
        B = V(bot[j], y0),
        C = V(top[j], y1),
        D = V(top[i], y1);
      tri(A, B, C);
      tri(A, C, D);
    }
  }
  const centroid = (p: [number, number][]) => {
    let x = 0,
      z = 0;
    for (const q of p) {
      x += q[0];
      z += q[1];
    }
    return [x / p.length, z / p.length] as [number, number];
  };
  if (capTop) {
    const c: [number, number] = centroid(top);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(V(top[i], y1), V(top[j], y1), V(c, y1));
    }
  }
  if (capBot) {
    const c: [number, number] = centroid(bot);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(V(bot[j], y0), V(bot[i], y0), V(c, y0));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  return g;
}

// ------------------------------------------------------------------ accumulation with a fake AO tint

class Builder {
  pos: number[] = [];
  col: number[] = [];

  add(g: THREE.BufferGeometry, y0: number, span = 3.2, lo = 0.62, tint: [number, number, number] = [1, 1, 1]): void {
    const gg = g.index ? g.toNonIndexed() : g;
    const a = gg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i),
        y = a.getY(i),
        z = a.getZ(i);
      this.pos.push(x, y, z);
      const k = lo + (1 - lo) * clamp((y - y0) / span, 0, 1);
      this.col.push(k * tint[0], k * tint[1], k * tint[2]);
    }
    gg.dispose();
  }

  /** No tinting, flat colour multiplier. */
  flat(g: THREE.BufferGeometry, tint: [number, number, number] = [1, 1, 1]): void {
    this.add(g, -1e6, 1e9, 1, tint);
  }

  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

// ------------------------------------------------------------------ hull

interface Station {
  s: number;
  z: number;
  top: number;
  pts: [number, number][];
}

function hullStations(spec: ShipSpec): Station[] {
  const N = Math.round(clamp(spec.L / 2.0, 48, 96));
  const list: number[] = [];
  for (let i = 0; i <= N; i++) list.push(i / N);
  // a sheer break needs two stations almost on top of each other or the deck kinks
  for (const p of spec.sheer) if (p[0] > 0.01 && p[0] < 0.99) list.push(p[0] - 0.0012, p[0] + 0.0012);
  list.sort((a, b) => a - b);
  return list.map((s) => {
    const z = (s - 0.5) * spec.L;
    const top = deckY(spec, z);
    return { s, z, top, pts: hullSection(spec, s, top) };
  });
}


export function buildHull(spec: ShipSpec): { hull: THREE.BufferGeometry; deck: THREE.BufferGeometry } {
  const rings = hullStations(spec);
  const yMin = -spec.D,
    yMax = spec.F * Math.max(...spec.sheer.map((p) => p[1])) + 0.6;
  const P: number[] = [];
  const UV: number[] = [];

  const loop = (st: Station): [number, number, number][] => {
    const out: [number, number, number][] = [];
    const z = st.z + bowRake(spec, st.s);
    for (let i = 0; i < RING; i++) out.push([st.pts[i][0], st.pts[i][1], z]);
    for (let i = RING - 1; i >= 0; i--) out.push([-st.pts[i][0], st.pts[i][1], z]);
    return out;
  };

  const M = RING * 2;
  for (let r = 0; r < rings.length - 1; r++) {
    const A = loop(rings[r]);
    const B = loop(rings[r + 1]);
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M;
      const a = A[i],
        b = A[j],
        c = B[j],
        d = B[i];
      P.push(...a, ...b, ...c, ...a, ...c, ...d);
      const u0 = rings[r].s,
        u1 = rings[r + 1].s;
      const v = (y: number) => clamp((y - yMin) / (yMax - yMin), 0, 1);
      UV.push(u0, v(a[1]), u0, v(b[1]), u1, v(c[1]), u0, v(a[1]), u1, v(c[1]), u1, v(d[1]));
    }
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  hull.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  hull.computeVertexNormals();

  // deck: a strip across the top of each station
  const dp: number[] = [];
  const duv: number[] = [];
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r],
      b = rings[r + 1];
    const x0 = a.pts[RING - 1][0],
      x1 = b.pts[RING - 1][0];
    const z0 = a.z + bowRake(spec, a.s),
      z1 = b.z + bowRake(spec, b.s);
    const A: [number, number, number] = [-x0, a.top, z0];
    const Bq: [number, number, number] = [x0, a.top, z0];
    const C: [number, number, number] = [x1, b.top, z1];
    const D: [number, number, number] = [-x1, b.top, z1];
    dp.push(...A, ...C, ...Bq, ...A, ...D, ...C);
    const s0 = a.s * 6,
      s1 = b.s * 6;
    duv.push(0, s0, 1, s1, 1, s0, 0, s0, 0, s1, 1, s1);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  deck.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  deck.computeVertexNormals();
  return { hull, deck };
}

// ------------------------------------------------------------------ superstructure and fittings

const AA_BARRELS: Record<string, { n: number; r: number; len: number; R: number }> = {
  o: { n: 1, r: 0.16, len: 2.2, R: 0.7 },
  b2: { n: 2, r: 0.18, len: 2.6, R: 1.0 },
  b4: { n: 4, r: 0.18, len: 2.6, R: 1.3 },
  j2: { n: 2, r: 0.16, len: 2.4, R: 0.9 },
  j3: { n: 3, r: 0.16, len: 2.4, R: 1.1 },
  ha: { n: 1, r: 0.22, len: 3.2, R: 1.1 },
  ha2: { n: 2, r: 0.22, len: 3.2, R: 1.4 },
};

function buildParts(spec: ShipSpec): { struct: THREE.BufferGeometry; dark: THREE.BufferGeometry } {
  const S = new Builder();
  const D = new Builder();
  const deckAt = (z: number) => deckY(spec, z);

  for (const p of spec.parts) {
    const y0 = deckAt(p.z) + p.y;
    switch (p.k) {
      case 'b': {
        const plan = planPoly(p.len ?? 8, p.w ?? 6, p.rf ?? 0, p.rr ?? 0);
        const ta = p.ta ?? 0.25;
        const fs = p.fs ?? 0;
        const top = plan.map(([x, z]) => [
          x * (1 - (2 * ta) / (p.w ?? 6)),
          z * (1 - (2 * ta) / (p.len ?? 8)) - (z > 0 ? (fs * z) / ((p.len ?? 8) / 2) * (p.h ?? 3) * 0.25 : 0),
        ]) as [number, number][];
        const g = loftGeo(plan, top, 0, p.h ?? 3);
        g.translate(p.x, y0, p.z);
        S.add(g, y0, Math.max(2, (p.h ?? 3) + 1), 0.66);
        if (p.win) {
          // a dark band of scuttles and bridge windows part way up
          const f0 = 0.5,
            f1 = 0.86;
          const ring = (f: number) =>
            plan.map((q, i) => [lerp(q[0], top[i][0], f), lerp(q[1], top[i][1], f)]) as [number, number][];
          const band = loftGeo(ring(f0), ring(f1), (p.h ?? 3) * f0, (p.h ?? 3) * f1, false, false);
          band.translate(p.x, y0, p.z);
          D.flat(band, [0.35, 0.38, 0.42]);
        }
        break;
      }
      case 'c': {
        const r = p.r ?? 2,
          h = p.h ?? 8;
        let g = cylG(r * 0.9, r, h, 14, true);
        if (p.ov) {
          // oval funnel: squash across the beam
          const a = g.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < a.count; i++) a.setX(i, a.getX(i) * (p.ov as number));
        }
        if (p.rake) g.rotateX(-(p.rake as number));
        g.translate(p.x, y0, p.z);
        S.add(g, y0, h + 2, 0.72);
        const cap = cylG(r * 0.94, r * 0.9, 0.5, 14);
        cap.translate(0, h - 0.4, 0);
        if (p.rake) cap.rotateX(-(p.rake as number));
        cap.translate(p.x, y0, p.z);
        D.flat(cap, [0.22, 0.24, 0.27]);
        if (p.pipe) {
          for (let i = 0; i < (p.pipe as number); i++) {
            const q = cylG(0.28, 0.28, 1.6, 8);
            q.translate(p.x + (i - ((p.pipe as number) - 1) / 2) * r * 0.8, y0 + h, p.z);
            D.flat(q, [0.2, 0.21, 0.24]);
          }
        }
        break;
      }
      case 'm': {
        const h = p.h ?? 14,
          r = p.r ?? 0.4;
        const base = new THREE.Vector3(p.x, y0, p.z);
        const tip = new THREE.Vector3(p.x, y0 + h, p.z);
        S.flat(at(cylG(r * 0.7, r, h, 8, true), p.x, y0, p.z), [0.9, 0.92, 0.95]);
        if (p.tri) {
          const legs = p.tri as number;
          for (let i = 0; i < legs; i++) {
            const a = (i / legs) * TAU + 0.3;
            const foot = new THREE.Vector3(p.x + Math.cos(a) * r * 2.6, y0, p.z + Math.sin(a) * r * 2.6);
            const head = new THREE.Vector3(p.x + Math.cos(a) * r * 0.6, y0 + h * 0.42, p.z + Math.sin(a) * r * 0.6);
            S.flat(rodG(foot, head, r * 0.34, 5), [0.85, 0.87, 0.9]);
          }
        }
        for (const [f, w] of p.yards || []) {
          const y = y0 + h * f;
          const yard = cylG(0.16, 0.16, w, 6);
          yard.rotateZ(Math.PI / 2);
          yard.translate(p.x, y, p.z);
          S.flat(yard, [0.8, 0.82, 0.85]);
        }
        if (p.top) {
          const [f, w] = p.top as number[];
          const g = boxG(w, 0.5, w * 0.8);
          g.translate(p.x - 0, y0 + h * f, p.z);
          S.add(g, y0 + h * f, 2, 0.7);
        }
        if (p.radar) {
          const g = boxG(2.6, 0.16, 1.2);
          g.translate(p.x, y0 + h * 0.82, p.z + 0.6);
          S.flat(g, [0.7, 0.72, 0.76]);
        }
        void base;
        void tip;
        break;
      }
      case 'pl': {
        const g = boxG(p.w ?? 6, 0.35, p.len ?? 4);
        g.translate(p.x, y0, p.z);
        S.add(g, y0, 2.4, 0.7);
        break;
      }
      case 'tt': {
        const n = p.n ?? 3,
          len = p.len ?? 7.5;
        const body = boxG(1.6, 1.5, len * 0.55);
        body.translate(p.x, y0 + 1.5, p.z);
        S.add(body, y0, 3, 0.72);
        const shield = boxG(1.9, 1.2, len * 0.3);
        shield.translate(p.x, y0 + 1.5, p.z + (p.sh ? -len * 0.2 : len * 0.2));
        S.add(shield, y0, 3, 0.7);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.62;
          const tube = cylG(0.3, 0.3, len * 0.8, 8);
          tube.rotateX(Math.PI / 2);
          tube.translate(p.x + off, y0 + 1.9, p.z);
          D.flat(tube, [0.55, 0.58, 0.62]);
        }
        break;
      }
      case 'aa': {
        const k = AA_BARRELS[p.kind ?? 'o'] || AA_BARRELS.o;
        const g = cylG(k.R * 0.5, k.R * 0.6, 0.8, 10);
        g.translate(p.x, y0, p.z);
        S.add(g, y0, 1.6, 0.78);
        for (let i = 0; i < k.n; i++) {
          const ox = (i % 2 ? 1 : -1) * k.R * 0.35;
          const oz = i < 2 ? 0.1 : -0.5;
          const b = cylG(k.r * 0.8, k.r, k.len, 6);
          b.rotateX(Math.PI / 2 - 0.18);
          b.translate(p.x + ox, y0 + 1.0 + (i < 2 ? 0 : 0.2), p.z + oz);
          D.flat(b, [0.4, 0.43, 0.48]);
        }
        break;
      }
      case 'sl': {
        const g = cylG(0.62, 0.62, 0.7, 12);
        g.rotateX(Math.PI / 2.2);
        g.translate(p.x, y0 + 0.6, p.z);
        D.flat(g, [0.75, 0.74, 0.6]);
        break;
      }
      case 'rf': {
        const g = cylG(0.42, 0.42, p.len ?? 4, 10);
        g.rotateZ(Math.PI / 2);
        g.translate(p.x, y0 + 0.5, p.z);
        S.flat(g, [0.62, 0.64, 0.68]);
        break;
      }
      case 'dr': {
        const g = boxG(2.0, 1.5, 2.4);
        g.translate(p.x, y0, p.z);
        S.add(g, y0, 2.4, 0.72);
        const t = cylG(0.9, 1.0, 0.5, 12);
        t.translate(p.x, y0 + 1.5, p.z);
        S.flat(t, [0.7, 0.72, 0.76]);
        break;
      }
      case 'bt': {
        const g = boxG(2.0, 1.4, p.len ?? 7);
        g.translate(p.x, y0 + 0.2, p.z);
        S.add(g, y0, 2, 0.7, [0.72, 0.68, 0.6]);
        break;
      }
      case 'cp': {
        const len = p.len ?? 14;
        const g = boxG(1.5, 0.7, len);
        g.rotateZ(-0.12);
        g.rotateY(p.face ?? 0);
        g.translate(p.x, y0 + 2.2, p.z);
        S.add(g, y0, 3, 0.72);
        break;
      }
      case 'cr': {
        const h = p.h ?? 7;
        S.flat(at(cylG(0.5, 0.6, h, 8), p.x, y0, p.z), [0.8, 0.82, 0.85]);
        const boom = rodG(
          new THREE.Vector3(p.x, y0 + h * 0.9, p.z),
          new THREE.Vector3(p.x + Math.sin(p.face ?? 0) * (p.boom ?? 10), y0 + h, p.z + Math.cos(p.face ?? 0) * (p.boom ?? 10)),
          0.28,
          5,
        );
        S.flat(boom, [0.78, 0.8, 0.84]);
        break;
      }
      case 'gm': {
        const t = TS[p.kind ?? 'us5d'];
        const g = boxG(t.w * 0.9, t.h * 0.9, t.len);
        g.rotateY(p.face ?? 0);
        g.translate(p.x, y0, p.z);
        S.add(g, y0, 2.6, 0.7);
        const b = cylG(t.br * 0.8, t.br, t.bl, 6);
        b.rotateX(Math.PI / 2 - 0.1);
        b.rotateY(p.face ?? 0);
        b.translate(p.x, y0 + t.h * 0.5, p.z);
        D.flat(b, [0.45, 0.48, 0.52]);
        break;
      }
      case 'dc': {
        const g = boxG(1.4, 0.7, 3.0);
        g.translate(p.x, deckAt(p.z) + 0.2, p.z);
        S.add(g, deckAt(p.z), 2, 0.7);
        break;
      }
    }
  }
  return { struct: S.geo(), dark: D.geo() };
}

// ------------------------------------------------------------------ turrets

export interface TurretGeo {
  base: THREE.BufferGeometry;
  barrel: THREE.BufferGeometry;
  ts: TurretShape;
}

export function turretGeo(kind: string): TurretGeo {
  const t = TS[kind];
  const hw = t.w / 2,
    hl = t.len / 2;
  const c = (t.cf || 0) * hw;
  const ss = t.ss || 0.1;
  const fs = t.fs != null ? t.fs : 0.24;
  const rs = t.rs || 0.04;
  const rr = t.rr || 0;
  const rc = rr * hw;

  const plan: [number, number][] = [
    [-(hw - c), hl],
    [hw - c, hl],
  ];
  const arc = (cx: number, cz: number, rad: number, a0: number, a1: number) => {
    if (rad < 0.02) return;
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (a1 - a0) * (i / 4);
      plan.push([cx + Math.cos(a) * rad, cz + Math.sin(a) * rad]);
    }
  };
  arc(hw - c, hl - c, c, Math.PI / 2, 0);
  plan.push([hw, hl - c], [hw, -(hl - rc)]);
  arc(hw - rc, -(hl - rc), rc, 0, -Math.PI / 2);
  plan.push([hw - rc, -hl], [-(hw - rc), -hl]);
  arc(-(hw - rc), -(hl - rc), rc, -Math.PI / 2, -Math.PI);
  plan.push([-hw, -(hl - rc)], [-hw, hl - c]);
  arc(-(hw - c), hl - c, c, Math.PI, Math.PI / 2);

  const top = plan.map(([x, z]) => [
    x * (1 - ss),
    z > 0 ? z - (fs * z) / hl : z + rs * (-z) / hl,
  ]) as [number, number][];

  const parts: THREE.BufferGeometry[] = [loftGeo(plan, top, 0, t.h, true, true)];

  // barbette and roof details
  const barb = cylG(t.w * 0.42, t.w * 0.44, 1.2, 18, true);
  barb.translate(0, -1.2, 0);
  parts.push(barb);

  if (t.ears) {
    const re = t.h * 0.085;
    const g = cylG(re, re, t.w * 1.25, 8);
    g.rotateZ(Math.PI / 2);
    g.translate(0, t.h * 0.78, hl * 0.35);
    parts.push(g);
  }
  if (t.hood) {
    const g = boxG(t.w * 0.3, t.h * 0.3, 1.2);
    g.translate(t.w * 0.3, t.h * 0.62, hl * 0.6);
    parts.push(g);
    const g2 = boxG(t.w * 0.3, t.h * 0.3, 1.2);
    g2.translate(-t.w * 0.3, t.h * 0.62, hl * 0.6);
    parts.push(g2);
  }

  const B = new Builder();
  for (const g of parts) B.add(g, 0, t.h + 1, 0.66);
  const base = B.geo();

  // barrels: n of them, laid along +z, pivoting at the trunnion
  const BB = new Builder();
  const mw = t.n > 1 ? t.w * 0.28 * (t.n - 1) + t.br * 5 : t.br * 5;
  void mw;
  for (let i = 0; i < t.n; i++) {
    const ox = (i - (t.n - 1) / 2) * t.w * 0.28;
    const exitZ = hl * 0.6;
    const prof: [number, number][] = [
      [0.001, 0],
      [t.br * 1.7, 0],
      [t.br * 1.7, exitZ + t.br * 2.5],
      [t.br * 1.12, exitZ + t.br * 3.4],
      [t.br, exitZ + t.br * 5],
      [t.br * 0.92, t.bl],
      [0.001, t.bl],
    ];
    // a lathe of the barrel profile
    const seg = 8;
    const pts: THREE.Vector2[] = prof.map(([r, z]) => new THREE.Vector2(Math.max(0.02, r), z));
    const g = new THREE.LatheGeometry(pts, seg);
    g.translate(ox, 0, 0);
    BB.flat(g, [0.42, 0.45, 0.5]);
    // breech block
    const bc = boxG(t.br * 3, t.br * 2.6, t.br * 3.4);
    bc.translate(ox, 0, -t.br * 1.2);
    BB.flat(bc, [0.38, 0.4, 0.45]);
  }
  const barrel = BB.geo();
  return { base, barrel, ts: t };
}

// ------------------------------------------------------------------ textures

function hullTexture(spec: ShipSpec): THREE.CanvasTexture {
  const W = 1024,
    H = 128;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const yMax = spec.F * Math.max(...spec.sheer.map((p) => p[1])) + 0.6;
  const yMin = -spec.D;
  const Y = (y: number) => ((yMax - y) / (yMax - yMin)) * H;
  const X = (s: number) => s * W;
  const paint = spec.nation === 'US' ? '#414b58' : '#5d6265';
  const boot = spec.F * 0.16;

  c.fillStyle = paint;
  c.fillRect(0, 0, W, H);
  // weathered vertical streaks
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W;
    const w = 0.5 + Math.random() * 2.5;
    c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + Math.random() * 0.05})`;
    c.fillRect(x, 0, w, H);
  }
  // boot topping and a black waterline stripe
  c.fillStyle = '#20262b';
  c.fillRect(0, Y(boot), W, H - Y(boot));
  const g = c.createLinearGradient(0, Y(boot + spec.F * 0.5), 0, Y(boot));
  g.addColorStop(0, 'rgba(30,34,38,0)');
  g.addColorStop(1, 'rgba(16,18,20,0.95)');
  c.fillStyle = g;
  c.fillRect(0, Y(boot + spec.F * 0.5), W, Y(boot) - Y(boot + spec.F * 0.5));
  // anti-fouling red below
  c.fillStyle = '#5a2a25';
  c.fillRect(0, Y(-spec.D * 0.45), W, H - Y(-spec.D * 0.45));
  // hull number
  if (spec.cls === 'DD' && spec.key) {
    c.fillStyle = '#d8dde2';
    c.font = `600 ${Math.round(H * 0.3)}px monospace`;
    c.textAlign = 'center';
    c.fillText(spec.key === 'jp_dd' ? '35' : '445', X(0.28), Y(boot + spec.F * 0.55));
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const DECK_PAINT: Record<string, [string, number]> = {
  steel: ['#39414a', 0],
  plank: ['#6b5539', 1],
  lino: ['#7a5c3e', 2],
  wood: ['#8f7752', 1],
};

function deckTexture(style: string): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const [base, kind] = DECK_PAINT[style] || DECK_PAINT.steel;
  c.fillStyle = base;
  c.fillRect(0, 0, S, S);
  const m = S / 8;
  if (kind === 1) {
    // planks running fore and aft
    const pw = 0.28 * m;
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.moveTo(i * m + (Math.random() - 0.5) * 2, 0);
      c.lineTo(i * m + (Math.random() - 0.5) * 2, S);
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.moveTo(i * m + pw, 0);
      c.lineTo(i * m + pw, S);
      c.stroke();
    }
  } else if (kind === 2) {
    // linoleum tiles
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    for (let i = 0; i <= 8; i++) {
      c.beginPath();
      c.moveTo(i * m, 0);
      c.lineTo(i * m, S);
      c.moveTo(0, i * m);
      c.lineTo(S, i * m);
      c.stroke();
    }
  }
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.04)`;
    c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ the whole ship

export interface ShipGeometry {
  hull: THREE.BufferGeometry;
  deck: THREE.BufferGeometry;
  struct: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  turrets: { mount: number; geo: TurretGeo }[];
}

const geoCache = new Map<string, ShipGeometry>();

export function shipGeometry(spec: ShipSpec): ShipGeometry {
  const hit = geoCache.get(spec.key);
  if (hit) return hit;
  const { hull, deck } = buildHull(spec);
  const { struct, dark } = buildParts(spec);
  const g: ShipGeometry = {
    hull,
    deck,
    struct,
    dark,
    turrets: spec.tur.map((t, i) => ({ mount: i, geo: turretGeo(t.kind) })),
  };
  geoCache.set(spec.key, g);
  return g;
}

export interface ShipMaterials {
  hull: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  struct: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
}

const matCache = new Map<string, ShipMaterials>();

export function shipMaterials(spec: ShipSpec): ShipMaterials {
  const hit = matCache.get(spec.key);
  if (hit) return hit;
  const style = spec.deck || (spec.nation === 'US' ? (spec.cls === 'DD' ? 'steel' : 'plank') : 'lino');
  const m: ShipMaterials = {
    hull: new THREE.MeshStandardMaterial({
      map: hullTexture(spec),
      side: THREE.DoubleSide,
      roughness: 0.72,
      metalness: 0.06,
    }),
    deck: new THREE.MeshStandardMaterial({ map: deckTexture(style), roughness: 0.88, metalness: 0.02 }),
    struct: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xd2d8de, roughness: 0.68, metalness: 0.12 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x9aa1a9, roughness: 0.55, metalness: 0.35 }),
  };
  matCache.set(spec.key, m);
  return m;
}

const railCache = new Map<string, THREE.BufferGeometry>();

/** Real posts and two horizontal tubes, following the same deck edge as the hull. */
export function buildRails(spec: ShipSpec): THREE.BufferGeometry {
  const cached = railCache.get(spec.key);
  if (cached) return cached;
  const geometry = buildTubeRailings(proceduralRailPlan(spec));
  railCache.set(spec.key, geometry);
  return geometry;
}
