// The canvas overlay: the sight (dispersion belongs to the world-space sea projection),
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
  /** Free observation / projectile camera: markers remain, but no false central gun sight. */
  observing?: boolean;
  showLead: boolean;
  target: Ship | null;
  torpedoes: { x: number; z: number; danger: boolean }[];
  /** Spotter text and where to put it. */
  spots: { text: string; x: number; z: number; t: number }[];
  time: number;
  /** The locked target, if any. */
  lock: Ship | null;
  /** Where the lock's lead point is, and how well the rangefinder has settled. */
  lead: { x: number; z: number } | null;
  converged: number;
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
    if (s.zoom > 0.35 && !s.observing) {
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

    // ---- projected sea point is diagnostic only; the sight stays on the camera axis
    const ap = s.project(s.aimX, 2, s.aimZ);
    this.dbg = {
      ap,
      reticle: [cx, cy],
      observing: !!s.observing,
      zoom: +s.zoom.toFixed(2),
      weapon: s.weapon,
      sigma: { along: Math.round(s.sigma.along), cross: Math.round(s.sigma.cross) },
      aim: [Math.round(s.aimX), Math.round(s.aimZ)],
      ship: [Math.round(P.x), Math.round(P.z)],
    };
    // ---- range drum down the right-hand side
    if (!s.observing) this.drawRangeScale(c, W, H, s);

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
      const isLock = sh === s.lock;
      this.drawShipMarker(c, sp[0], sp[1], sh, foe, d, s.time, taken, labelled, isLock);
      // Lead marker. Locked: a solid diamond you can lay the crosshair on. Otherwise a hollow one
      // for the nearest enemy, if the captain wants the help.
      if (!s.observing && foe && s.weapon === 'guns' && (isLock || (s.showLead && taken.length === 1))) {
        const [lx, lz] = isLock && s.lead ? [s.lead.x, s.lead.z] : leadPoint(P.x, P.z, sh, P.gun);
        this.drawLeadMarker(c, s, sh, lx, lz, isLock, s.converged);
      }
    }

    // ---- aircraft. A 10 m plane at 4 km is a few pixels, so the sky needs markers or the
    // player cannot tell an attack from an empty sky.
    const planes = s.world.planes
      .filter((p) => p.alive && p.team !== P.team)
      .map((p) => ({ p, d: Math.hypot(p.x - P.x, p.z - P.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 12); // one marker per plane: a raided crew must see every attacker
    for (const { p, d } of planes) {
      const pp = s.project(p.x, p.y, p.z);
      if (!pp) continue;
      const ahead = s.project(p.x + Math.sin(p.heading) * 60, p.y, p.z + Math.cos(p.heading) * 60);
      const ang = ahead ? Math.atan2(ahead[1] - pp[1], ahead[0] - pp[0]) : -Math.PI / 2;
      const hot = p.state === 'attack' || p.state === 'runIn';
      const col = hot ? FOE : p.state === 'egress' ? 'rgba(215,222,228,0.5)' : AMBER;
      c.save();
      c.translate(pp[0], pp[1]);
      c.rotate(ang);
      c.strokeStyle = col;
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(10, 0);
      c.lineTo(-6, 6);
      c.lineTo(-2, 0);
      c.lineTo(-6, -6);
      c.closePath();
      c.stroke();
      c.restore();
      c.fillStyle = col;
      c.font = '600 10px monospace';
      c.textAlign = 'center';
      c.fillText(`${(d / 1000).toFixed(1)}km`, pp[0], pp[1] + 20);
      if (hot) {
        c.strokeStyle = col;
        c.globalAlpha = 0.5 + 0.5 * Math.sin(s.time * 6);
        c.beginPath();
        c.arc(pp[0], pp[1], 14, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
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
    if (s.weapon === 'guns' && !s.observing) {
      this.drawCrosshair(c, cx, cy);
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

  private drawCrosshair(c: CanvasRenderingContext2D, x: number, y: number): void {
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

  /**
   * The War Thunder style lead marker: the point the guns must be laid on for the shell to arrive
   * where the target will be. Solid when locked, hollow otherwise; it fades in as the rangefinder
   * converges, because until then it is only a guess.
   */
  private drawLeadMarker(
    c: CanvasRenderingContext2D,
    s: OverlayState,
    sh: Ship,
    lx: number,
    lz: number,
    locked: boolean,
    converged: number,
  ): void {
    const lp = s.project(lx, 4, lz);
    if (!lp) return;
    const r = locked ? 9 : 7;
    c.save();

    // A target coming straight at you leads along the line of fire, not across it, so the offset
    // can be only a few pixels even when it is 300 m. Draw the tie line and quote the number.
    const sp = s.project(sh.x, 4, sh.z);
    const lead = Math.hypot(lx - sh.x, lz - sh.z);
    if (sp && lead > 8) {
      c.strokeStyle = locked ? 'rgba(154,255,190,0.8)' : 'rgba(150,255,190,0.5)';
      c.lineWidth = locked ? 1.6 : 1;
      c.setLineDash([4, 3]);
      c.beginPath();
      c.moveTo(sp[0], sp[1]);
      c.lineTo(lp[0], lp[1]);
      c.stroke();
      c.setLineDash([]);
    }
    c.globalAlpha = locked ? 0.55 + 0.45 * converged : 0.5;
    c.beginPath();
    c.moveTo(lp[0], lp[1] - r);
    c.lineTo(lp[0] + r * 0.72, lp[1]);
    c.lineTo(lp[0], lp[1] + r);
    c.lineTo(lp[0] - r * 0.72, lp[1]);
    c.closePath();
    if (locked) {
      c.fillStyle = 'rgba(150,255,190,0.35)';
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = '#9affbe';
      c.stroke();
      // cross hairs through it, so you can see exactly where the centre is
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(lp[0] - r - 5, lp[1]);
      c.lineTo(lp[0] + r + 5, lp[1]);
      c.moveTo(lp[0], lp[1] - r - 5);
      c.lineTo(lp[0], lp[1] + r + 5);
      c.stroke();
    } else {
      c.lineWidth = 1.4;
      c.strokeStyle = 'rgba(150,255,190,0.8)';
      c.stroke();
    }
    c.globalAlpha = 1;
    if (locked) {
      const label =
        converged > 0.98 ? `提前点 ${Math.round(lead)}m` : `提前点 ${Math.round(lead)}m · 测距 ${Math.round(converged * 100)}%`;
      c.font = '600 11px monospace';
      c.textAlign = 'center';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(8,10,12,0.8)';
      c.strokeText(label, lp[0], lp[1] - r - 9);
      c.fillStyle = '#9affbe';
      c.fillText(label, lp[0], lp[1] - r - 9);
    }
    c.restore();
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
    locked = false,
  ): void {
    const col = locked ? '#9affbe' : foe ? FOE : FRIEND;
    const w = clamp(1600 / Math.max(240, d), 14, 46) * (locked ? 1.25 : 1);
    const h = w * 0.62;
    c.strokeStyle = col;
    c.lineWidth = locked ? 2.2 : 1.4;
    c.globalAlpha = locked ? 1 : 0.85;
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
