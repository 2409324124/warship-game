// The chart: islands, ships, torpedoes and the fall of shot, drawn as a radar plot.

import { TAU } from '../sim/constants';
import { ISL, terrainH } from '../sim/terrain';
import type { Ship } from '../sim/ship';
import type { World } from '../sim/world';
import type { Torpedo } from '../sim/torpedo';

const MM = 16000;

export class Minimap {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private land: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.bakeLand();
  }

  private bakeLand(): void {
    const N = 160;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(N, N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = MM - ((i / N) * 2 - 1) * MM;
        const z = MM - ((j / N) * 2 - 1) * MM;
        const h = terrainH(x, z);
        const o = (j * N + i) * 4;
        const above = h > 0;
        const shade = above ? Math.min(1, h / 700) : 0;
        img.data[o] = above ? 60 + shade * 70 : 14;
        img.data[o + 1] = above ? 72 + shade * 40 : 26;
        img.data[o + 2] = above ? 48 + shade * 30 : 38;
        img.data[o + 3] = above ? 255 : 190;
      }
    }
    c.putImageData(img, 0, 0);
    this.land = cv;
  }

  draw(
    world: World,
    P: Ship | null,
    torps: Torpedo[],
    aim: { x: number; z: number } | null,
    locked: Ship | null = null,
  ): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = this.cv.clientWidth || 176;
    if (this.cv.width !== Math.floor(size * dpr)) {
      this.cv.width = this.cv.height = Math.floor(size * dpr);
      this.cv.style.height = `${size}px`;
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    const k = size / (2 * MM);
    // Chart orientation. World +z is north and world +x is WEST (a right-handed world with +y up:
    // (+x) x (+z) = -y, so +x cannot be east). For a north-up chart that is consistent with what
    // the captain sees - facing north, her starboard (-x, east) is on the right of the screen -
    // both axes have to be negated. Negating only one would mirror the chart and hand her a
    // left-handed world.
    const X = (x: number) => (MM - x) * k;
    const Y = (z: number) => (MM - z) * k;

    if (this.land) c.drawImage(this.land, 0, 0, size, size);

    // range rings every 5 km around the player
    if (P) {
      c.strokeStyle = 'rgba(200,215,230,0.14)';
      c.lineWidth = 1;
      for (let r = 2500; r <= 10000; r += 2500) {
        c.beginPath();
        c.arc(X(P.x), Y(P.z), r * k, 0, TAU);
        c.stroke();
      }
    }

    // island names
    c.fillStyle = 'rgba(200,215,230,0.4)';
    c.font = '9px system-ui';
    c.textAlign = 'center';
    for (const I of ISL) c.fillText('■', X(I.x), Y(I.z) + 3);

    // torpedoes
    for (const t of torps) {
      if (!t.alive) continue;
      c.strokeStyle = t.team === P?.team ? 'rgba(150,220,255,0.6)' : 'rgba(255,90,60,0.85)';
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(X(t.x), Y(t.z));
      c.lineTo(X(t.x + t.dx * 400), Y(t.z + t.dz * 400));
      c.stroke();
    }

    // ships
    for (const s of world.ships) {
      if (!s.alive || s.removed) continue;
      const foe = P ? s.team !== P.team : false;
      const isMe = s === P;
      const x = X(s.x),
        y = Y(s.z);
      const fx = Math.sin(s.heading),
        fz = Math.cos(s.heading);
      const len = s.spec.cls === 'BB' ? 7 : s.spec.cls === 'CA' ? 5.5 : 4.5;
      c.strokeStyle = isMe ? '#ffffff' : foe ? '#ef5a40' : '#8fd3e6';
      c.fillStyle = c.strokeStyle;
      c.lineWidth = isMe ? 2 : 1.4;
      c.beginPath();
      c.moveTo(x - fx * len, y - fz * len);
      c.lineTo(x + fx * len, y + fz * len);
      c.stroke();
      if (isMe) {
        c.beginPath();
        c.arc(x, y, 3.2, 0, TAU);
        c.fill();
      }
      if (locked === s) {
        c.strokeStyle = '#9affbe';
        c.lineWidth = 1.6;
        c.beginPath();
        c.arc(x, y, 9, 0, TAU);
        c.stroke();
        c.beginPath();
        c.arc(x, y, 13, 0, TAU);
        c.globalAlpha = 0.4;
        c.stroke();
        c.globalAlpha = 1;
      }
    }

    // where the guns are pointing
    if (P && aim) {
      c.strokeStyle = 'rgba(240,181,74,0.75)';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(X(P.x), Y(P.z));
      c.lineTo(X(aim.x), Y(aim.z));
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.arc(X(aim.x), Y(aim.z), 3, 0, TAU);
      c.stroke();
    }

    // compass
    c.fillStyle = 'rgba(200,215,230,0.5)';
    c.font = '9px system-ui';
    c.fillText('N', size / 2, 10);
  }
}
