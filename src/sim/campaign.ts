// The campaign: which ships appear, where, and what winning looks like.
// Level 1 is a single US battleship holding the sound against three Japanese destroyers.

import { clamp } from './constants.ts';
import { AI } from './ai.ts';
import { Ship } from './ship.ts';
import { SPECS } from './ships.ts';
import { waterSpot } from './terrain.ts';
import type { World } from './world.ts';

export interface WaveShip {
  key: string;
  name: string;
  no: string;
}

export interface WaveDef {
  /** Seconds after the previous wave before this one appears. */
  at: number;
  from: [number, number];
  to: [number, number];
  ships: WaveShip[];
}

export interface CampaignLevel {
  id: string;
  title: string;
  subtitle: string;
  brief: string;
  side: 'US' | 'JP';
  start: [number, number, number];
  waves: WaveDef[];
}

export const LEVEL1: CampaignLevel = {
  id: 'l1',
  title: '第一关 · 夜战前哨',
  subtitle: '铁底湾 · 1942 年 11 月',
  brief:
    '三艘日本驱逐舰借着夜色从萨沃岛西侧南下。你的战列舰横在海峡里：主炮十公里外落弹要十一秒，副炮会自己找目标。别让她们进到鱼雷射程。',
  side: 'US',
  start: [0, -2500, 0],
  waves: [
    {
      at: 0,
      from: [-3400, 5200],
      to: [600, -1800],
      ships: [
        { key: 'jp_dd', name: '吹雪', no: 'DD-35' },
        { key: 'jp_dd', name: '白雪', no: 'DD-36' },
        { key: 'jp_dd', name: '初雪', no: 'DD-37' },
      ],
    },
  ],
};

/** The same fight from the other side: a Japanese battleship against three American destroyers. */
export const LEVEL1_JP: CampaignLevel = {
  id: 'l1jp',
  title: '第一关 · 突入海峡',
  subtitle: '铁底湾 · 1942 年 11 月 · 日军视角',
  brief: '美军驱逐舰守在海峡里。用主炮把她们逐出航道，别让鱼雷贴上你的舷侧。',
  side: 'JP',
  start: [0, 2500, Math.PI],
  waves: [
    {
      at: 0,
      from: [3400, -5200],
      to: [-600, 1800],
      ships: [
        { key: 'us_dd', name: '弗莱彻', no: 'DD-445' },
        { key: 'us_dd', name: '奥利克', no: 'DD-446' },
        { key: 'us_dd', name: '拉菲', no: 'DD-459' },
      ],
    },
  ],
};

export const LEVELS: CampaignLevel[] = [LEVEL1, LEVEL1_JP];

export interface KillRecord {
  key: string;
  name: string;
  no: string;
  tons: number;
  time: number;
  byPlayer: boolean;
}

export class Campaign {
  readonly w: World;
  readonly level: CampaignLevel;
  readonly side: 'US' | 'JP';
  readonly foe: string;
  player: Ship;
  kills: KillRecord[] = [];
  spawned = 0;
  started = false;
  finished = false;
  win = false;
  untilNext = 0;
  timer = 0;

  constructor(w: World, level: CampaignLevel, shipKey: string, name: string, no: string) {
    this.w = w;
    this.level = level;
    this.side = level.side;
    this.foe = level.side === 'US' ? 'JP' : 'US';
    w.campaign = this;
    w.foe = this.foe;

    const [x0, z0, hd] = level.start;
    const [px, pz] = waterSpot(x0, z0);
    this.player = w.add(
      new Ship(w, shipKey, this.side, name, { player: true, no, x: px, z: pz, heading: hd, speedFrac: 0.55 }),
    );
    this.untilNext = level.waves[0].at;
  }

  begin(): void {
    this.started = true;
    this.spawn(0);
  }

  update(dt: number): void {
    if (!this.started || this.finished) return;
    this.timer += dt;
    if (this.spawned < this.level.waves.length) {
      this.untilNext -= dt;
      if (this.untilNext <= 0) this.spawn(this.spawned);
    }
    const foesLeft = this.w.ships.filter((s) => s.team === this.foe && s.alive).length;
    if (!this.player.alive) this.finish(false);
    else if (foesLeft === 0 && this.spawned >= this.level.waves.length) this.finish(true);
  }

  spawn(i: number): void {
    const W = this.level.waves[i];
    if (!W) return;
    this.spawned = i + 1;
    const [sx, sz] = W.from;
    const hd = Math.atan2(W.to[0] - sx, W.to[1] - sz);
    const sn = Math.sin(hd),
      cn = Math.cos(hd);
    W.ships.forEach((entry, k) => {
      const back = k * 380;
      const lat = (k % 2 ? 1 : -1) * 150;
      let x = sx - sn * back + cn * lat;
      let z = sz - cn * back - sn * lat;
      [x, z] = waterSpot(x, z, 200);
      const s = this.w.add(
        new Ship(this.w, entry.key, this.foe, entry.name, {
          no: entry.no,
          x,
          z,
          heading: hd,
          speedFrac: 0.9,
        }),
      );
      s.ai = new AI(this.w, s);
    });
    if (i + 1 < this.level.waves.length) this.untilNext = this.level.waves[i + 1].at;
    this.w.emit('wave', { index: i, count: W.ships.length });
  }

  sunk(s: Ship, killer: Ship | null): void {
    if (s.team === this.foe) {
      this.kills.push({
        key: s.key,
        name: s.name,
        no: s.hullNo,
        tons: s.spec.tons,
        time: this.w.time,
        byPlayer: !!killer && killer.isPlayer,
      });
      this.w.emit('kill', { id: s.id, name: s.name, tons: s.spec.tons, by: killer ? killer.id : 0 });
    }
  }

  finish(win: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.win = win;
    this.w.emit('finish', { win: win ? 1 : 0, time: this.w.time, kills: this.kills.length });
  }

  get tons(): number {
    return this.kills.reduce((a, k) => a + k.tons, 0);
  }

  /** 0..1 progress of the battle, for the HUD. */
  get progress(): number {
    const total = this.level.waves.reduce((a, w) => a + w.ships.length, 0);
    return clamp(this.kills.length / Math.max(1, total), 0, 1);
  }
}

export const shipLabel = (key: string): string => {
  const s = SPECS[key];
  return s ? `${s.name} · ${s.type}` : key;
};
