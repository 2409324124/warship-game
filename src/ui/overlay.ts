// The canvas overlay: the sight, the dispersion ellipse hanging in the air where the guns point,
// target markers with their lead, torpedo warnings, and the spotter's fall-of-shot report.

import { clamp } from '../sim/constants';
import { leadPoint, type Ship } from '../sim/ship';
import type { World } from '../sim/world';

export type Project = (x: number, y: number, z: number) => [number, number] | null;

export interface OverlayState {
  P: Ship;
  world: World;
  project: Project;
  aimX: number;
  aimZ: number;
  sigma: { along: number; cross: number };
  flight: number;
  weapon: string;
  zoom: number;
  showLead: boolean;
  target: Ship | null;
  torpedoes: { x: number; z: number; danger: boolean }[];
  /** Spotter text and where to put it. */
  spots: { text: string; x: number; z: number; t: number }[];
  time: number;
}

const FOE = '#ef5a40';
const FRIEND = '#8fd3e6';
const AMBER = '#f0b54a';

export class Overlay {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  dpr = 1;
  /** What the sight thought it drew last frame - read by the smoke test. */
  dbg: Record<string, unknown> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth,
      h = window.innerHeight;
    this.dpr = dpr;
    this.cv.width = Math.floor(w * dpr);
    this.cv.height = Math.floor(h * dpr);
    this.cv.style.width = `${w}px`;
    this.cv.style.height = `${h}px`;
  }

  draw(s: OverlayState): void {
    const c = this.ctx;
    const W = this.cv.width / this.dpr,
      H = this.cv.height / this.dpr;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const cx = W / 2,
      cy = H / 2;

    const P = s.P;
    if (!P || !P.alive) return;

    // ---- binocular field stop, drawn first so nothing it masks can end up on top of it
    if (s.zoom > 0.35) {
      const r = Math.min(W, H) * 0.34;
      c.fillStyle = 'rgba(2,3,5,0.94)';
      c.beginPath();
      c.rect(0, 0, W, H);
      c.arc(cx, cy, r, 0, Math.PI * 2, true);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.95)';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = 'rgba(150,165,180,0.45)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(cx, cy, r - 3, 0, Math.PI * 2);
      c.stroke();
      this.drawReticleScale(c, s, cx, cy, r);
    }

    // ---- the aim point and its dispersion ellipse. Drawn last so target markers cannot bury it.
    const ap = s.project(s.aimX, 2, s.aimZ);
    this.dbg = {
      ap,
      zoom: +s.zoom.toFixed(2),
      weapon: s.weapon,
      sigma: { along: Math.round(s.sigma.along), cross: Math.round(s.sigma.cross) },
      aim: [Math.round(s.aimX), Math.round(s.aimZ)],
      ship: [Math.round(P.x), Math.round(P.z)],
    };
    // ---- range drum down the right-hand side
    this.drawRangeScale(c, W, H, s);

    // ---- ships. Closest first: if two labels would collide the farther one loses its text.
    const list = s.world.ships
      .filter((sh) => sh.alive && !sh.removed && !(sh.team === P.team && sh === P))
      .map((sh) => ({ sh, d: Math.hypot(sh.x - P.x, sh.z - P.z) }))
      .sort((a, b) => a.d - b.d);
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const { sh, d } of list) {
      const foe = sh.team !== P.team;
      const sp = s.project(sh.x, sh.spec.F + sh.spec.top * 0.55, sh.z);
      if (!sp) continue;
      // through the binoculars only the nearest target keeps its label: the rest is clutter on
      // top of the fall-of-shot ellipse
      const labelled = s.zoom < 0.35 || taken.length < 1;
      this.drawShipMarker(c, sp[0], sp[1], sh, foe, d, s.time, taken, labelled);
      if (foe && s.showLead && s.weapon === 'guns') {
        const [lx, lz] = leadPoint(P.x, P.z, sh, P.gun);
        const lp = s.project(lx, 4, lz);
        if (lp) {
          c.strokeStyle = 'rgba(150,255,190,0.75)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(lp[0] - 6, lp[1]);
          c.lineTo(lp[0], lp[1] - 6);
          c.lineTo(lp[0] + 6, lp[1]);
          c.lineTo(lp[0], lp[1] + 6);
          c.closePath();
          c.stroke();
          c.fillStyle = 'rgba(150,255,190,0.55)';
          c.font = '10px monospace';
          c.textAlign = 'left';
          c.fillText(`提前 ${Math.round(Math.hypot(lx - sh.x, lz - sh.z))}m`, lp[0] + 9, lp[1] + 3);
        }
      }
    }

    // ---- torpedoes
    for (const t of s.torpedoes) {
      const sp = s.project(t.x, 2, t.z);
      if (!sp) continue;
      c.fillStyle = t.danger ? '#ff5a3c' : 'rgba(255,150,120,0.55)';
      c.beginPath();
      c.arc(sp[0], sp[1], t.danger ? 5 : 3, 0, Math.PI * 2);
      c.fill();
      if (t.danger) {
        c.strokeStyle = 'rgba(255,90,60,0.8)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(sp[0], sp[1], 11, 0, Math.PI * 2);
        c.stroke();
      }
    }

    // ---- the sight itself, over the top of everything else in the scene
    if (ap && s.weapon === 'guns') {
      this.drawEllipse(c, s, ap);
      this.drawCrosshair(c, ap[0], ap[1], s.sigma);
    }

    // ---- spotter's report on the last salvo
    for (const sp of s.spots) {
      const p = s.project(sp.x, 30, sp.z);
      if (!p) continue;
      const a = clamp(sp.t, 0, 1);
      c.globalAlpha = a;
      c.fillStyle = AMBER;
      c.font = '600 13px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(sp.text, p[0], p[1]);
      c.globalAlpha = 1;
    }

    // (the field stop is drawn at the top of this function, before everything else)
  }

  private drawEllipse(c: CanvasRenderingContext2D, s: OverlayState, ap: [number, number]): void {
    const P = s.P;
    const dx = s.aimX - P.x,
      dz = s.aimZ - P.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d,
      uz = dz / d;
    const pa = s.project(s.aimX + ux * s.sigma.along, 2, s.aimZ + uz * s.sigma.along);
    const pb = s.project(s.aimX - uz * s.sigma.cross, 2, s.aimZ + ux * s.sigma.cross);
    if (!pa || !pb) return;
    const ax = pa[0] - ap[0],
      ay = pa[1] - ap[1];
    const bx = pb[0] - ap[0],
      by = pb[1] - ap[1];
    const la = Math.hypot(ax, ay),
      lb = Math.hypot(bx, by);
    if (la < 1 && lb < 1) return;
    const rot = Math.atan2(ay, ax);
    c.save();
    c.translate(ap[0], ap[1]);
    c.rotate(rot);
    // 2 sigma: where almost every shell of the salvo lands
    c.strokeStyle = 'rgba(240,181,74,0.28)';
    c.lineWidth = 1.2;
    c.setLineDash([5, 5]);
    c.beginPath();
    c.ellipse(0, 0, Math.max(3, la * 2), Math.max(3, lb * 2), 0, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    // a wash of colour inside 1 sigma, so the "圈" reads as an area and not just a hairline
    c.fillStyle = 'rgba(240,181,74,0.2)';
    c.beginPath();
    c.ellipse(0, 0, Math.max(2, la), Math.max(2, lb), 0, 0, Math.PI * 2);
    c.fill();
    // the two axes, so the ellipse reads as long-and-narrow rather than as a blob
    c.strokeStyle = 'rgba(255,196,84,0.5)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-Math.max(2, la), 0);
    c.lineTo(Math.max(2, la), 0);
    c.moveTo(0, -Math.max(2, lb));
    c.lineTo(0, Math.max(2, lb));
    c.stroke();
    // 1 sigma: dark backing then the amber line, so it survives bright water behind it
    c.strokeStyle = 'rgba(12,9,3,0.7)';
    c.lineWidth = 6;
    c.beginPath();
    c.ellipse(0, 0, Math.max(2, la), Math.max(2, lb), 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = 'rgba(255,204,96,1)';
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(0, 0, Math.max(2, la), Math.max(2, lb), 0, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  /**
   * The horizontal wire of the reticle, ruled in 50 m steps across the line of fire. Once you know
   * how big the step is you can read a target's length, and a destroyer is 118 m long.
   */
  private drawReticleScale(c: CanvasRenderingContext2D, s: OverlayState, cx: number, cy: number, r: number): void {
    const P = s.P;
    const dx = s.aimX - P.x,
      dz = s.aimZ - P.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d,
      uz = dz / d;
    const step = d > 12000 ? 200 : d > 5000 ? 100 : 50;
    c.strokeStyle = 'rgba(200,215,230,0.55)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cx - r * 0.8, cy);
    c.lineTo(cx + r * 0.8, cy);
    c.stroke();
    c.font = '10px monospace';
    c.textAlign = 'center';
    for (let k = -8; k <= 8; k++) {
      if (!k) continue;
      const off = k * step;
      const p = s.project(s.aimX - uz * off, 2, s.aimZ + ux * off);
      if (!p) continue;
      if (Math.abs(p[0] - cx) > r * 0.8) continue;
      const big = k % 2 === 0;
      c.beginPath();
      c.moveTo(p[0], cy - (big ? 7 : 4));
      c.lineTo(p[0], cy + (big ? 7 : 4));
      c.stroke();
      if (big) {
        c.fillStyle = 'rgba(200,215,230,0.6)';
        c.fillText(`${Math.abs(off)}`, p[0], cy - 10);
      }
    }
  }

  private drawCrosshair(c: CanvasRenderingContext2D, x: number, y: number, sigma: { along: number; cross: number }): void {
    const arm = 30,
      gap = 7;
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(15,10,3,0.55)';
    this.crossPath(c, x, y, arm, gap);
    c.lineWidth = 1.8;
    c.strokeStyle = AMBER;
    this.crossPath(c, x, y, arm, gap);
    c.beginPath();
    c.arc(x, y, 2.4, 0, Math.PI * 2);
    c.fillStyle = AMBER;
    c.fill();
    const label = `σ ${Math.round(sigma.along)} × ${Math.round(sigma.cross)} m`;
    c.font = '600 12px monospace';
    c.textAlign = 'left';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(10,8,4,0.65)';
    c.strokeText(label, x + arm + 7, y - 6);
    c.fillStyle = AMBER;
    c.fillText(label, x + arm + 7, y - 6);
  }

  private crossPath(c: CanvasRenderingContext2D, x: number, y: number, arm: number, gap: number): void {
    c.beginPath();
    c.moveTo(x - arm, y);
    c.lineTo(x - gap, y);
    c.moveTo(x + gap, y);
    c.lineTo(x + arm, y);
    c.moveTo(x, y - arm);
    c.lineTo(x, y - gap);
    c.moveTo(x, y + gap);
    c.lineTo(x, y + arm);
    c.stroke();
  }

  private drawRangeScale(c: CanvasRenderingContext2D, W: number, H: number, s: OverlayState): void {
    const P = s.P;
    const d = Math.hypot(s.aimX - P.x, s.aimZ - P.z);
    const maxR = P.gun.range * 1.08;
    const x = W - 34;
    const top = H * 0.22,
      bot = H * 0.78;
    c.strokeStyle = 'rgba(200,215,230,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, top);
    c.lineTo(x, bot);
    c.stroke();
    c.font = '600 11px monospace';
    c.textAlign = 'right';
    const stepKm = maxR > 15000 ? 5 : 2;
    for (let km = 0; km <= maxR / 1000; km += stepKm) {
      const y = bot - ((km * 1000) / maxR) * (bot - top);
      const big = km % 10 === 0;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (big ? 10 : 6), y);
      c.strokeStyle = 'rgba(215,228,240,0.75)';
      c.lineWidth = 1.2;
      c.stroke();
      if (big) {
        c.lineWidth = 3;
        c.strokeStyle = 'rgba(8,10,12,0.8)';
        c.strokeText(String(km), x - 4, y + 4);
        c.fillStyle = 'rgba(232,237,242,0.95)';
        c.fillText(String(km), x - 4, y + 4);
      }
    }
    const y = bot - clamp(d / maxR, 0, 1) * (bot - top);
    c.fillStyle = AMBER;
    c.beginPath();
    c.moveTo(x + 2, y);
    c.lineTo(x + 12, y - 5);
    c.lineTo(x + 12, y + 5);
    c.closePath();
    c.fill();
    c.textAlign = 'right';
    c.font = '600 12px monospace';
    c.fillText(`${(d / 1000).toFixed(2)}km`, x - 4, y + 4);
    // flight time and gun state, bottom centre
    c.textAlign = 'center';
    c.font = '600 15px monospace';
    const loaded = P.mainTurrets.filter((t) => t.reload <= 0).length;
    const label = s.weapon === 'guns' ? `飞行 ${s.flight.toFixed(1)}s · 装填 ${loaded}/${P.mainTurrets.length}` : '鱼雷模式';
    // inside the field of view, clear of the weapon bar at the bottom of the screen
    const fy = s.zoom > 0.35 ? H / 2 + Math.min(W, H) * 0.34 * 0.78 : H - 152;
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(8,10,12,0.75)';
    c.strokeText(label, W / 2, fy);
    c.fillStyle = 'rgba(255,196,84,0.98)';
    c.fillText(label, W / 2, fy);
  }

  private drawShipMarker(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    sh: Ship,
    foe: boolean,
    d: number,
    time: number,
    taken: { x0: number; y0: number; x1: number; y1: number }[],
    labelled = true,
  ): void {
    const col = foe ? FOE : FRIEND;
    const w = clamp(1600 / Math.max(240, d), 14, 46);
    const h = w * 0.62;
    c.strokeStyle = col;
    c.lineWidth = 1.4;
    c.globalAlpha = 0.85;
    // corner brackets
    const bx = x - w / 2,
      by = y - h / 2;
    const c1 = 5;
    c.beginPath();
    c.moveTo(bx, by + c1);
    c.lineTo(bx, by);
    c.lineTo(bx + c1, by);
    c.moveTo(bx + w - c1, by);
    c.lineTo(bx + w, by);
    c.lineTo(bx + w, by + c1);
    c.moveTo(bx, by + h - c1);
    c.lineTo(bx, by + h);
    c.lineTo(bx + c1, by + h);
    c.moveTo(bx + w - c1, by + h);
    c.lineTo(bx + w, by + h);
    c.lineTo(bx + w, by + h - c1);
    c.stroke();
    if (!labelled) {
      c.globalAlpha = 1;
      return;
    }
    // labels get a dark outline, and each one claims a box so they stop piling up
    const label = `${sh.name} ${(d / 1000).toFixed(2)}km`;
    c.font = '600 12px system-ui, sans-serif';
    c.textAlign = 'left';
    let ly = by - 4;
    const lw = c.measureText(label).width;
    for (let guard = 0; guard < 6; guard++) {
      const box = { x0: bx - 2, y0: ly - 12, x1: bx + lw + 2, y1: ly + 3 };
      if (!taken.some((t) => t.x0 < box.x1 && t.x1 > box.x0 && t.y0 < box.y1 && t.y1 > box.y0)) {
        taken.push(box);
        break;
      }
      ly -= 15;
    }
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(8,10,12,0.8)';
    c.strokeText(label, bx, ly);
    c.fillStyle = col;
    c.fillText(label, bx, ly);
    // hp bar
    const frac = clamp(sh.hp / sh.maxHp, 0, 1);
    const bw = Math.max(w, c.measureText(label).width);
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(bx, by + h + 3, bw, 3);
    c.fillStyle = foe ? (frac > 0.4 ? '#f0b54a' : '#ef5a40') : '#7ec99a';
    c.fillRect(bx, by + h + 3, bw * frac, 3);
    // fires
    if (sh.fires.length) {
      const fire = '起火';
      c.font = '600 11px system-ui';
      c.strokeText(fire, bx + bw + 5, by + 9);
      c.fillStyle = Math.sin(time * 8) > 0 ? '#ff8a3c' : '#ffd070';
      c.fillText(fire, bx + bw + 5, by + 9);
    }
    c.globalAlpha = 1;
  }
}
