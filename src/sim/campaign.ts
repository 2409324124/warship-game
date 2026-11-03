// The campaign: a staged operation. Each act spawns a squadron, states its objective and
// may call in an airstrike. Clearing an act repairs the player and opens the next one.

import { clamp, MAP_R } from './constants.ts';
import { AI } from './ai.ts';
import { Ship } from './ship.ts';
import { SPECS } from './ships.ts';
import { waterSpot } from './terrain.ts';
import { spawnAirRaid } from './aircraft.ts';
import type { World } from './world.ts';

export interface ActShip {
  key: string;
  name: string;
  no: string;
  /** Counts toward the act objective. Defaults to true; escorts set false. */
  primary?: boolean;
  /** Scenario-only durability multiplier, used to give the boss a longer fight. */
  hpMul?: number;
}

export interface AirRaidDef {
  /** Seconds after the act spawns before the planes appear. */
  after: number;
  /** Seconds before `after` to radio the warning. Defaults to 10. */
  warnLead?: number;
  torp: number;
  dive: number;
  callout?: string;
}

export interface ActDef {
  id: string;
  title: string;
  /** One line shown in the HUD tracker. */
  objective: string;
  /** Radio traffic read out when the act begins. */
  callout: string;
  /** Lull between the previous act's clear and this act's spawn. */
  delay: number;
  /** Absolute world position, or an offset from the player when `relative`. */
  from: [number, number];
  /** Absolute destination, or an offset from the player when `relative`. */
  to: [number, number];
  relative?: boolean;
  ships: ActShip[];
  /** 'clear' = every ship; 'primary' = only the ships not marked as escorts. */
  winOn?: 'clear' | 'primary';
  boss?: boolean;
  airRaid?: AirRaidDef;
}

export interface CampaignLevel {
  id: string;
  title: string;
  subtitle: string;
  brief: string;
  start: [number, number, number];
  acts: ActDef[];
  /** Applied after every non-final act clears. */
  repair?: { hpPct: number; dc: number; minFrac?: number };
}

// ------------------------------------------------------------------ the operation

export const OPERATION: CampaignLevel = {
  id: 'steel-lane',
  title: '钢铁航线 1942',
  subtitle: '铁底湾 · 1942 年 11 月',
  brief:
    '你指挥美军战列舰“华盛顿”号，沿铁底湾向北突入。三幕作战：先撕开驱逐舰前哨，再打掉拦路的高雄级重巡，最后在海峡北口迎战金刚。两波敌机会在你最忙的时候扑上来。',
  start: [0, -2500, 0],
  repair: { hpPct: 0.25, dc: 1, minFrac: 0.7 },
  acts: [
    {
      id: 'outpost',
      title: '第一幕 · 夜战前哨',
      objective: '肃清前哨驱逐舰',
      callout: '三艘吹雪级驱逐舰从西北方压过来。别让她们进到鱼雷射程。',
      delay: 0,
      from: [-3400, 5200],
      to: [600, -1800],
      ships: [
        { key: 'jp_dd', name: '吹雪', no: 'DD-35' },
        { key: 'jp_dd', name: '白雪', no: 'DD-36' },
        { key: 'jp_dd', name: '初雪', no: 'DD-37' },
      ],
    },
    {
      id: 'cruiser',
      title: '第二幕 · 重巡拦路',
      objective: '击沉高雄级重巡',
      callout: '雷达接触：一艘高雄级重巡正在北上。二十门 8 英寸炮，还有九三式鱼雷——别把舷侧暴露给她。',
      delay: 22,
      from: [300, 11000],
      to: [0, 0],
      relative: true,
      winOn: 'primary',
      ships: [
        { key: 'jp_ca', name: '高雄', no: 'CA-14', primary: true },
      ],
      airRaid: {
        after: 20,
        warnLead: 10,
        torp: 4,
        dive: 0,
        callout: '低空目标：四架鱼雷机正沿浪尖接近。',
      },
    },
    {
      id: 'kongo',
      title: '第三幕 · 海峡北口',
      objective: '击沉金刚',
      callout: '最大回波——金刚级战列舰进入海峡。十四英寸炮，三十节航速。今晚这条航线，由她守着。',
      delay: 24,
      from: [0, 15000],
      to: [0, 0],
      relative: true,
      winOn: 'primary',
      boss: true,
      ships: [
        { key: 'jp_bb', name: '金刚', no: 'BB-31', primary: true, hpMul: 1.4 },
      ],
      airRaid: {
        after: 25,
        warnLead: 10,
        torp: 3,
        dive: 3,
        callout: '六架敌机：鱼雷机与俯冲轰炸机混合编队。',
      },
    },
  ],
};

/** The old three-destroyer duel, kept for deterministic tests and the balance tool. */
export const DUEL: CampaignLevel = {
  id: 'duel',
  title: '夜战前哨',
  subtitle: '铁底湾 · 1942 年 11 月',
  brief: '三艘日本驱逐舰借着夜色从萨沃岛西侧南下。别让她们进到鱼雷射程。',
  start: [0, -2500, 0],
  acts: [
    {
      id: 'duel',
      title: '第一幕 · 夜战前哨',
      objective: '击沉全部驱逐舰',
      callout: '三艘吹雪级驱逐舰从西北方压过来。',
      delay: 0,
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

/** QA-only mirror: a Japanese battleship against American destroyers. */
export const DUEL_JP: CampaignLevel = {
  id: 'duel-jp',
  title: '突入海峡',
  subtitle: '铁底湾 · 1942 年 11 月 · 日军舰体验证',
  brief: '美军驱逐舰守在海峡里。',
  start: [0, 2500, Math.PI],
  acts: [
    {
      id: 'duel-jp',
      title: '第一幕 · 突入海峡',
      objective: '击沉全部驱逐舰',
      callout: '美军驱逐舰守在海峡里。',
      delay: 0,
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

// ------------------------------------------------------------------ stars

export const STAR_PLANES = 8;
export const STAR_HP = 0.5;

/** One star for the win, one for the air battle, one for bringing the ship home. */
export function starsFor(win: boolean, planesDown: number, hpFrac: number): number {
  if (!win) return 0;
  return 1 + (planesDown >= STAR_PLANES ? 1 : 0) + (hpFrac >= STAR_HP ? 1 : 0);
}

// ------------------------------------------------------------------ records

export interface KillRecord {
  key: string;
  name: string;
  no: string;
  tons: number;
  time: number;
  byPlayer: boolean;
}

export interface ActShipRef {
  s: Ship;
  primary: boolean;
}

export class Campaign {
  readonly w: World;
  readonly level: CampaignLevel;
  readonly side: 'US' | 'JP';
  readonly foe: string;
  player: Ship;
  kills: KillRecord[] = [];
  started = false;
  finished = false;
  win = false;
  phase: 'idle' | 'fight' | 'gap' | 'done' = 'idle';
  act = 0;
  /** Seconds spent in the current act. */
  actT = 0;
  /** Remaining seconds of the inter-act lull. */
  gap = 0;
  actShips: ActShipRef[] = [];
  raidWarned = false;
  raidFired = false;
  endHpFrac = 1;

  constructor(w: World, level: CampaignLevel, shipKey: string, name: string, no: string) {
    this.w = w;
    this.level = level;
    this.side = SPECS[shipKey]?.nation ?? 'US';
    this.foe = this.side === 'US' ? 'JP' : 'US';
    w.campaign = this;
    w.foe = this.foe;

    const [x0, z0, hd] = level.start;
    const [px, pz] = waterSpot(x0, z0);
    this.player = w.add(
      new Ship(w, shipKey, this.side, name, { player: true, no, x: px, z: pz, heading: hd, speedFrac: 0.55 }),
    );
  }

  begin(): void {
    if (this.started) return;
    this.started = true;
    this.enterAct(0);
  }

  /** Dev hook: withdraw the current act and jump straight to act `i` (for screenshots). */
  jumpTo(i: number): void {
    if (!this.level.acts[i]) return;
    for (const x of this.actShips) {
      if (!x.s.alive) continue;
      x.s.alive = false;
      x.s.remove();
    }
    this.actShips = [];
    this.finished = false;
    this.win = false;
    if (i > 0) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.25);
      this.player.fires.length = 0;
      this.player.dc.cd = 0;
      this.player.dc.charges = Math.min(this.player.spec.dc ?? 2, this.player.dc.charges + 1);
    }
    this.endHpFrac = this.player.maxHp > 0 ? this.player.hp / this.player.maxHp : 0;
    this.enterAct(i);
  }

  update(dt: number): void {
    if (!this.started || this.finished) return;
    if (!this.player.alive) {
      this.finish(false);
      return;
    }
    if (this.phase === 'gap') {
      this.gap -= dt;
      if (this.gap <= 0) this.enterAct(this.act + 1);
      return;
    }
    if (this.phase !== 'fight') return;

    this.actT += dt;
    const A = this.actDef;
    if (!A) return;

    // Clear check before the raid clock: an act that just ended must not call in aircraft.
    if (this.cleared(A)) {
      const left = this.actShips.filter((x) => x.s.alive).length;
      for (const x of this.actShips) {
        if (!x.s.alive) continue;
        // The escort withdraws; she is not sunk, so she gets no kill record.
        x.s.alive = false;
        x.s.remove();
      }
      this.w.emit('actClear', { index: this.act, title: A.title, left });
      if (this.act >= this.level.acts.length - 1) {
        this.finish(true);
        return;
      }
      this.repairPlayer();
      this.phase = 'gap';
      this.gap = this.level.acts[this.act + 1].delay;
      return;
    }

    this.updateRaid(A);
  }

  private enterAct(i: number): void {
    const A = this.level.acts[i];
    if (!A) return;
    this.act = i;
    this.phase = 'fight';
    this.actT = 0;
    this.gap = 0;
    this.raidWarned = false;
    this.raidFired = false;
    this.actShips = this.spawnAct(A);
    this.w.emit('actStart', {
      index: i,
      count: this.actShips.length,
      title: A.title,
      objective: A.objective,
      callout: A.callout,
      boss: A.boss ? 1 : 0,
    });
  }

  private spawnAct(A: ActDef): ActShipRef[] {
    const P = this.player;
    let sx: number, sz: number, hd: number;

    if (A.relative) {
      const base = Math.atan2(A.from[0], A.from[1]);
      const dist = Math.hypot(A.from[0], A.from[1]) || 9000;
      let picked: [number, number] | null = null;
      for (const off of [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.85, -0.85]) {
        const h = base + off;
        const x = P.x + Math.sin(h) * dist;
        const z = P.z + Math.cos(h) * dist;
        if (Math.hypot(x, z) > MAP_R - 800) continue;
        const [wx, wz] = waterSpot(x, z, 200);
        if (Math.abs(wx - x) > 1 || Math.abs(wz - z) > 1) continue;
        picked = [x, z];
        break;
      }
      if (!picked) {
        const h = base;
        picked = waterSpot(
          clamp(P.x + Math.sin(h) * dist, -MAP_R + 800, MAP_R - 800),
          clamp(P.z + Math.cos(h) * dist, -MAP_R + 800, MAP_R - 800),
          200,
        );
      }
      [sx, sz] = picked;
      hd = Math.atan2(P.x - sx, P.z - sz);
    } else {
      [sx, sz] = A.from;
      hd = Math.atan2(A.to[0] - sx, A.to[1] - sz);
    }

    const sn = Math.sin(hd);
    const cn = Math.cos(hd);
    return A.ships.map((entry, k) => {
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
          hpMul: entry.hpMul,
        }),
      );
      s.ai = new AI(this.w, s);
      return { s, primary: entry.primary !== false };
    });
  }

  private cleared(A: ActDef): boolean {
    const list = A.winOn === 'primary' ? this.actShips.filter((x) => x.primary) : this.actShips;
    return list.length > 0 && list.every((x) => !x.s.alive);
  }

  private repairPlayer(): void {
    const r = this.level.repair ?? { hpPct: 0.25, dc: 1 };
    const P = this.player;
    const before = P.hp;
    const beforeDc = P.dc.charges;
    const healed = P.hp + P.maxHp * r.hpPct;
    P.hp = Math.min(P.maxHp, Math.max(healed, P.maxHp * (r.minFrac ?? 0)));
    P.fires.length = 0;
    P.dc.cd = 0;
    P.dc.charges = Math.min(P.spec.dc ?? 2, P.dc.charges + r.dc);
    this.w.emit('repair', {
      hp: Math.round(P.hp - before),
      dc: P.dc.charges - beforeDc,
      dcLeft: P.dc.charges,
      nextIn: this.level.acts[this.act + 1]?.delay ?? 0,
    });
  }

  private updateRaid(A: ActDef): void {
    const R = A.airRaid;
    if (!R) return;
    const warnAt = Math.max(0, R.after - (R.warnLead ?? 10));
    if (!this.raidWarned && this.actT >= warnAt) {
      this.raidWarned = true;
      this.w.emit('airRaidWarn', {
        torp: R.torp,
        dive: R.dive,
        msg: R.callout ?? '雷达发现敌机编队',
      });
    }
    if (!this.raidFired && this.actT >= R.after) {
      this.raidFired = true;
      spawnAirRaid(this.w, this.foe, this.player, R.torp, R.dive);
    }
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
    this.phase = 'done';
    this.endHpFrac = this.player.maxHp > 0 ? this.player.hp / this.player.maxHp : 0;
    this.w.emit('finish', {
      win: win ? 1 : 0,
      time: this.w.time,
      kills: this.kills.length,
      stars: this.stars,
      planesDown: this.w.planesDown,
      hpFrac: this.endHpFrac,
      act: this.act,
    });
  }

  get tons(): number {
    return this.kills.reduce((a, k) => a + k.tons, 0);
  }

  get actDef(): ActDef | null {
    return this.level.acts[this.act] ?? null;
  }

  get actCount(): number {
    return this.level.acts.length;
  }

  get actTotal(): number {
    return this.actShips.filter((x) => x.primary).length;
  }

  get actKilled(): number {
    return this.actShips.filter((x) => x.primary && !x.s.alive).length;
  }

  get stars(): number {
    return starsFor(this.win, this.w.planesDown, this.endHpFrac);
  }

  /** 0..1 progress of the operation, counting primary ships only. */
  get progress(): number {
    let done = 0;
    let total = 0;
    for (let i = 0; i < this.level.acts.length; i++) {
      const A = this.level.acts[i];
      const prim = A.ships.filter((s) => s.primary !== false).length;
      total += prim;
      if (i < this.act) done += prim;
      else if (i === this.act) done += this.actKilled;
    }
    return clamp(done / Math.max(1, total), 0, 1);
  }
}

export const shipLabel = (key: string): string => {
  const s = SPECS[key];
  return s ? `${s.name} · ${s.type}` : key;
};
