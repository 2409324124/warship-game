// The operation's structure and its inter-act state machine.

import test from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../src/sim/world.ts';
import {
  Campaign,
  OPERATION,
  DUEL,
  STAR_HP,
  STAR_PLANES,
  starsFor,
  type CampaignLevel,
} from '../src/sim/campaign.ts';
import { spawnPlane, killPlane } from '../src/sim/aircraft.ts';

const tiny = (acts: CampaignLevel['acts'], repair?: CampaignLevel['repair']): CampaignLevel => ({
  id: 'test',
  title: 'test',
  subtitle: 'test',
  brief: 'test',
  start: [0, 0, 0],
  acts,
  repair,
});

const dd = (name: string, primary = true): CampaignLevel['acts'][number]['ships'][number] => ({
  key: 'jp_dd',
  name,
  no: name,
  primary,
});

test('the operation has three acts with destroyers, a cruiser and Kongo', () => {
  assert.equal(OPERATION.acts.length, 3);
  assert.equal(OPERATION.acts[0].ships.filter((s) => s.key === 'jp_dd').length, 3);
  assert.ok(OPERATION.acts[1].ships.some((s) => s.key === 'jp_ca'));
  assert.ok(OPERATION.acts[2].ships.some((s) => s.key === 'jp_bb' && s.hpMul && s.hpMul > 1));
  assert.equal(OPERATION.acts[1].airRaid?.torp, 4);
  assert.equal(OPERATION.acts[2].airRaid?.dive, 3);
  assert.deepEqual(OPERATION.repair, { hpPct: 0.25, dc: 1, minFrac: 0.7 });
  assert.equal(DUEL.acts.length, 1);
});

test('clearing an act repairs the player and opens the next from a gap', () => {
  const level = tiny(
    [
      {
        id: 'a',
        title: 'a',
        objective: 'a',
        callout: 'a',
        delay: 0,
        from: [-2000, 0],
        to: [0, 0],
        ships: [dd('A')],
      },
      {
        id: 'b',
        title: 'b',
        objective: 'b',
        callout: 'b',
        delay: 0.4,
        from: [2000, 0],
        to: [0, 0],
        ships: [dd('B')],
      },
    ],
    { hpPct: 0.2, dc: 1 },
  );
  const w = new World({ foe: 'JP' });
  const c = new Campaign(w, level, 'us_bb', 'P', '1');
  const events: string[] = [];
  w.onEvent = (e) => events.push(e.k);
  c.begin();

  const P = c.player;
  P.hp = P.maxHp * 0.5;
  P.dc.charges = 1;
  P.dc.cd = 10;
  const first = c.actShips[0].s;
  first.alive = false;
  first.hp = 0;

  c.update(0.01);
  assert.equal(c.phase, 'gap');
  assert.ok(P.hp > P.maxHp * 0.5, 'the damage-control party should restore some health');
  assert.equal(P.dc.charges, 2);
  assert.ok(events.includes('actClear'));
  assert.ok(events.includes('repair'));

  c.update(0.5);
  assert.equal(c.act, 1);
  assert.equal(c.phase, 'fight');
  assert.equal(c.actShips[0].s.name, 'B');
});

test('a primary objective wins even when an escort is still afloat', () => {
  const level = tiny([
    {
      id: 'boss',
      title: 'boss',
      objective: 'kill the primary',
      callout: '',
      delay: 0,
      from: [-2000, 0],
      to: [0, 0],
      winOn: 'primary',
      ships: [dd('主目标', true), dd('护航', false)],
    },
  ]);
  const w = new World({ foe: 'JP' });
  const c = new Campaign(w, level, 'us_bb', 'P', '1');
  c.begin();

  const primary = c.actShips.find((x) => x.primary)!.s;
  const escort = c.actShips.find((x) => !x.primary)!.s;
  primary.alive = false;
  primary.hp = 0;
  c.update(0.01);

  assert.equal(c.finished, true);
  assert.equal(c.win, true);
  assert.equal(escort.alive, false, 'the escort should withdraw rather than stall the act');
});

test('stars reward the win, the air battle and bringing the ship home', () => {
  assert.equal(starsFor(false, 10, 1), 0);
  assert.equal(starsFor(true, 0, 0.1), 1);
  assert.equal(starsFor(true, STAR_PLANES, STAR_HP), 3);
  assert.equal(starsFor(true, STAR_PLANES, STAR_HP - 0.01), 2);
  assert.equal(starsFor(true, STAR_PLANES - 1, STAR_HP), 2);
});

test('only enemy aircraft count toward planesDown', () => {
  const w = new World({ foe: 'JP' });
  const jp = spawnPlane(w, 'torp', 'JP', 0, 100, 0, 0, null, 1, 0);
  const us = spawnPlane(w, 'torp', 'US', 0, 100, 0, 0, null, 1, 0);
  killPlane(w, jp);
  killPlane(w, us);
  assert.equal(w.planesDown, 1);
});
