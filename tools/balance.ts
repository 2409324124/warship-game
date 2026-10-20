// Balance report: run the first level head-lessly a few times per difficulty and print what
// happened. Run with: node tools/balance.ts

import { World, playerFire, type Difficulty } from '../src/sim/world.ts';
import { Campaign, LEVEL1 } from '../src/sim/campaign.ts';
import { AI } from '../src/sim/ai.ts';
import { leadPoint } from '../src/sim/ship.ts';

function run(diff: Difficulty, seconds = 420, skill = 1): Record<string, number | string> {
  const world = new World({ diff, foe: 'JP' });
  const camp = new Campaign(world, LEVEL1, 'us_bb', '华盛顿', 'BB-56');
  camp.begin();
  for (const s of world.ships) if (!s.isPlayer && !s.ai) s.ai = new AI(world, s);
  const P = camp.player;
  let minRange = Infinity,
    torps = 0,
    torpHits = 0,
    secShots = 0;
  world.onEvent = (e) => {
    if (e.k === 'torpLaunch') torps++;
    if (e.k === 'torpHit') torpHits++;
    if (e.k === 'gun' && e.sec) secShots += e.n as number;
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
      minRange = Math.min(minRange, bd);
      // `skill` is how well she is aimed: 1 lays the guns on the lead point, lower values add error
      const [lx, lz] = leadPoint(P.x, P.z, best, P.gun);
      const jitter = (1 - skill) * 400;
      P.aimX = lx + (Math.random() - 0.5) * jitter;
      P.aimZ = lz + (Math.random() - 0.5) * jitter;
      if (P.mainTurrets.some((t) => t.reload <= 0 && t.onTarget)) playerFire(world, P, P.aimX, P.aimZ);
    }
    world.step(dt, true);
    camp.update(dt);
  }
  const acc = P.stats.shots ? P.stats.hits / P.stats.shots : 0;
  return {
    difficulty: diff,
    result: camp.finished ? (camp.win ? '胜' : '败') : '未结束',
    time: Math.round(world.time),
    kills: camp.kills.length,
    mainShots: P.stats.shots,
    mainHits: P.stats.hits,
    accPct: +(acc * 100).toFixed(1),
    secShots,
    torpsLaunched: torps,
    torpHitsOnPlayer: torpHits,
    playerHpPct: Math.round((P.hp / P.maxHp) * 100),
    closest: Math.round(minRange),
  };
}

console.log('第一关 · 一艘美军战列舰 vs 三艘日本驱逐舰（模拟 7 分钟）\n');
for (const d of ['cadet', 'captain', 'admiral'] as Difficulty[]) {
  console.log(`--- ${d} · 良好操炮 ---`);
  console.table([run(d), run(d)]);
}
console.log('--- captain · 瞄准较差（skill 0.85）---');
console.table([run('captain', 420, 0.85)]);
