// Balance report: run the duel and the three-act operation head-lessly and print what happened.
// Run with: node tools/balance.ts

import { World, playerFire, cmdDC, type Difficulty } from '../src/sim/world.ts';
import { Campaign, DUEL, OPERATION, type CampaignLevel } from '../src/sim/campaign.ts';
import { AI } from '../src/sim/ai.ts';
import { leadPoint } from '../src/sim/ship.ts';

interface Run {
  result: string;
  time: number;
  act: number;
  kills: number;
  mainShots: number;
  mainHits: number;
  accPct: number;
  planesDown: number;
  hpPct: number;
  stars: number;
  acts: string;
}

function run(level: CampaignLevel, diff: Difficulty, useDC: boolean, seconds = 900): Run {
  const world = new World({ diff, foe: 'JP' });
  const camp = new Campaign(world, level, 'us_bb', '华盛顿', 'BB-56');
  camp.begin();
  for (const s of world.ships) if (!s.isPlayer && !s.ai) s.ai = new AI(world, s);
  const P = camp.player;
  const log: string[] = [];
  world.onEvent = (e) => {
    if (e.k === 'actStart') log.push(`act${(e.index as number) + 1}@${Math.round(world.time)}s`);
    if (e.k === 'actClear') log.push(`clear${(e.index as number) + 1}@${Math.round(world.time)}s`);
    if (e.k === 'airRaid') log.push(`raid@${Math.round(world.time)}s`);
    if (e.k === 'repair') log.push(`repair+${Math.round(((e.hp as number) / P.maxHp) * 100)}%@${Math.round(world.time)}s`);
  };

  const dt = 1 / 30;
  for (let i = 0; i < seconds / dt && !camp.finished; i++) {
    let best: (typeof world.ships)[number] | null = null,
      bd = Infinity;
    for (const s of world.ships) {
      if (!s.alive || s.team === P.team) continue;
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) {
      const [ax, az] = leadPoint(P.x, P.z, best, P.gun);
      P.aimX = ax;
      P.aimZ = az;
      if (P.mainTurrets.some((t) => t.reload <= 0 && t.onTarget)) playerFire(world, P, ax, az);
    }
    if (useDC && P.dc.charges > 0 && P.dc.cd <= 0 && (P.fires.length > 0 || P.hp / P.maxHp < 0.55)) {
      cmdDC(world, P);
    }
    world.step(dt, true);
    camp.update(dt);
  }

  const acc = P.stats.shots ? P.stats.hits / P.stats.shots : 0;
  return {
    result: camp.finished ? (camp.win ? '胜' : '败') : '未结束',
    time: Math.round(world.time),
    act: camp.act + 1,
    kills: camp.kills.length,
    mainShots: P.stats.shots,
    mainHits: P.stats.hits,
    accPct: +(acc * 100).toFixed(1),
    planesDown: world.planesDown,
    hpPct: Math.round((P.hp / P.maxHp) * 100),
    stars: camp.stars,
    acts: log.join(' '),
  };
}

console.log('夜战前哨 · DUEL（旧的三驱逐舰基线，模拟 7 分钟）\n');
for (const d of ['cadet', 'captain', 'admiral'] as Difficulty[]) {
  console.log(`--- ${d} · 不用损管 ---`);
  console.table([run(DUEL, d, false, 420), run(DUEL, d, false, 420)]);
}

console.log('\n钢铁航线 1942 · OPERATION（三幕，模拟 15 分钟）\n');
for (const d of ['cadet', 'captain', 'admiral'] as Difficulty[]) {
  console.log(`--- ${d} · 不用损管 ---`);
  console.table([run(OPERATION, d, false), run(OPERATION, d, false)]);
  console.log(`--- ${d} · 会自动用损管 ---`);
  console.table([run(OPERATION, d, true), run(OPERATION, d, true)]);
}
