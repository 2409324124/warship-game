// Boot, input, camera and the main loop. This is the only file that knows about both the
// simulation and the page.

import * as THREE from 'three';
import { clamp, lerp } from './sim/constants';
import { flightTime, hitChance, sigmaAt } from './sim/ballistics';
import { Campaign, LEVEL1, LEVEL1_JP, type CampaignLevel } from './sim/campaign';
import { playerFire, playerTorpedo, cmdDC, World, DIFF, type Difficulty, type SimEvent } from './sim/world';
import { AI } from './sim/ai';
import { SPECS } from './sim/ships';
import { torpVisible, type Torpedo } from './sim/torpedo';
import type { Ship } from './sim/ship';
import { createEngine } from './render/engine';
import { createSky } from './render/sky';
import { createWater } from './render/water';
import { createLand } from './render/land';
import { FX } from './render/fx';
import { AimMarker } from './render/aimMarker';
import { ShipView } from './render/shipView';
import { Hud } from './ui/hud';
import { Overlay } from './ui/overlay';
import { Minimap } from './ui/minimap';
import { Sfx } from './audio/sfx';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// ------------------------------------------------------------------ setup

const engine = createEngine($<HTMLCanvasElement>('gl'));
const { scene, camera, renderer } = engine;
createSky(scene);
const water = createWater(scene, engine.fogDensity);
createLand(scene);
const fx = new FX(scene);
const aimMarker = new AimMarker(scene);

const overlay = new Overlay($<HTMLCanvasElement>('overlay'));
const minimap = new Minimap($<HTMLCanvasElement>('mini'));
const hud = new Hud();
const sfx = new Sfx();

// ------------------------------------------------------------------ game state

type Mode = 'menu' | 'play' | 'paused' | 'end';

const G = {
  mode: 'menu' as Mode,
  world: null as World | null,
  camp: null as Campaign | null,
  P: null as Ship | null,
  level: LEVEL1 as CampaignLevel,
  side: 'US' as 'US' | 'JP',
  key: 'us_bb' as string,
  diff: 'captain' as Difficulty,
  weapon: 'guns' as 'guns' | 'torps',
  time: 0,
  zoom: 0,
  zoomWant: 0,
  camMode: 'chase' as 'chase' | 'bridge',
  /** Debug: orbit the player's own ship so the model can be inspected. */
  inspect: 0,
  showLead: true,
  debug: false,
  shake: 0,
  endT: 0,
};

const views = new Map<number, ShipView>();
const aim = { yaw: 0, range: 9000, pYaw: 0, pRange: 0, sens: 1 };
const keys: Record<string, boolean> = {};
let spots: { text: string; x: number; z: number; t: number }[] = [];
let salvos: SalvoRec[] = [];

interface SalvoRec {
  salvo: number;
  ids: Set<number>;
  target: Ship | null;
  n: number;
  along: number;
  cross: number;
  got: number;
  hits: number;
  age: number;
  done: boolean;
}

// ------------------------------------------------------------------ world lifecycle

function onEvent(e: SimEvent): void {
  const world = G.world;
  if (!world) return;
  const P = G.P;
  const dist = (x: number, z: number) => (P ? Math.hypot(x - P.x, z - P.z) : 0);

  switch (e.k) {
    case 'gun': {
      const id = e.id as number;
      const cal = e.cal as number;
      const sh = e.sh as number[][];
      const owner = world.byId(id);
      const own = !!owner && owner.isPlayer;
      fx.muzzle(e.x as number, e.y as number, e.z as number, e.b as number, cal);
      sfx.gun(cal, dist(e.x as number, e.z as number) + 60, own);
      if (own && !e.sec) {
        salvos.push({
          salvo: e.salvo as number,
          ids: new Set(sh.map((s) => s[0])),
          target: nearestFoeTo(e.tx as number, e.tz as number),
          n: e.n as number,
          along: 0,
          cross: 0,
          got: 0,
          hits: 0,
          age: 0,
          done: false,
        });
      }
      // an enemy salvo heading our way: let her whistle
      if (!own && P && P.alive) {
        const T = sh.length ? sh[0][8] : 0;
        const miss = Math.hypot((e.tx as number) - P.x, (e.tz as number) - P.z);
        if (miss < 500 && T > 2) sfx.incoming(cal, Math.min(T, 3));
      }
      if (own) shakeBy(cal / 406, own);
      break;
    }
    case 'splash': {
      const cal = e.cal as number;
      fx.splash(e.x as number, e.z as number, cal, !!e.over);
      sfx.splash(cal, dist(e.x as number, e.z as number) + 40);
      const rec = salvos.find((r) => r.ids.has(e.id as number));
      if (rec && !rec.done) {
        rec.got++;
        const t = rec.target;
        if (t && t.alive) {
          const [lx, lz] = t.toLocal(e.x as number, e.z as number);
          rec.along += lz;
          rec.cross += lx;
        }
      }
      break;
    }
    case 'hit': {
      const cal = e.cal as number;
      fx.hit(e.x as number, e.y as number, e.z as number, cal);
      sfx.hit(cal, dist(e.x as number, e.z as number) + 40);
      const rec = salvos.find((r) => r.salvo === e.salvo);
      if (rec) rec.hits++;
      const victim = world.byId(e.id as number);
      if (victim && victim.isPlayer) shakeBy(clamp((e.dmg as number) / 2600, 0.1, 1), false);
      break;
    }
    case 'torpLaunch':
      sfx.torpedo();
      break;
    case 'torpHit':
      fx.explosion(e.x as number, 3, e.z as number, false);
      sfx.explode(false, dist(e.x as number, e.z as number) + 40);
      break;
    case 'sunk': {
      const s = world.byId(e.id as number);
      if (s) fx.explosion(s.x, s.spec.F + 6, s.z, !!e.big);
      sfx.explode(!!e.big, s ? dist(s.x, s.z) + 40 : 600);
      if (s) {
        const mine = s.isPlayer;
        hud.feed(
          mine ? `<b>${s.name}</b> 沉没` : `<b>${s.name}</b> 被击沉`,
          mine ? 'bad' : 'good',
        );
        if (!mine) hud.banner('敌舰沉没', `${s.name} · ${s.spec.name}`);
      }
      break;
    }
    case 'kill':
      hud.feed(`击沉 <b>${e.name}</b> · ${Math.round(e.tons as number).toLocaleString('zh-CN')} 吨`, 'good');
      break;
    case 'wave':
      hud.banner(`第 ${(e.index as number) + 1} 波`, `${e.count} 艘敌舰进入海峡`);
      break;
    case 'hint':
      hud.hint(e.msg as string);
      break;
    case 'dc':
      if (e.id === P?.id) hud.hint(e.ok ? '损管队出动：灭火并抢修' : e.none ? '损管已用尽' : '损管仍在冷却');
      break;
    case 'ground':
      if (e.id === P?.id) {
        hud.hint('触底！立即减速');
        shakeBy(0.5, false);
      }
      break;
    case 'edge':
      hud.hint('已到战场边缘');
      break;
    case 'finish':
      finishBattle(!!e.win);
      break;
  }
}

function nearestFoeTo(x: number, z: number): Ship | null {
  const world = G.world;
  const P = G.P;
  if (!world || !P) return null;
  let best: Ship | null = null,
    bd = 1e18;
  for (const s of world.ships) {
    if (!s.alive || s.team === P.team) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function shakeBy(k: number, own: boolean): void {
  if (!own) {
    G.shake = Math.min(1.4, G.shake + k * 0.5);
    return;
  }
  G.shake = Math.min(1.4, G.shake + k * 0.9);
}

function startBattle(): void {
  for (const v of views.values()) v.dispose(scene);
  views.clear();
  spots = [];
  salvos = [];
  G.level = G.side === 'US' ? LEVEL1 : LEVEL1_JP;
  G.world = new World({ diff: G.diff, onEvent, foe: G.side === 'US' ? 'JP' : 'US' });
  const spec = SPECS[G.key];
  const camp = new Campaign(
    G.world,
    G.level,
    G.key,
    G.side === 'US' ? '华盛顿' : '雾岛',
    G.side === 'US' ? 'BB-56' : '—',
  );
  G.camp = camp;
  G.P = camp.player;
  camp.begin();
  // the other side gets a captain too
  for (const s of G.world.ships) if (!s.isPlayer && !s.ai) s.ai = new AI(G.world, s);

  aim.yaw = G.P.heading;
  aim.range = clamp(9000, 800, spec ? G.P.gun.range : 22000);
  G.time = 0;
  G.mode = 'play';
  G.endT = 0;
  hud.show(true);
  showScreen(null);
  sfx.init();
  requestLock();
}

function finishBattle(win: boolean): void {
  if (G.mode === 'end') return;
  G.mode = 'end';
  G.endT = win ? 3.2 : 4.5;
  hud.banner(win ? '海峡守住了' : '我方沉没', win ? '全部敌舰已击沉' : '战斗结束');
}

function showEnd(): void {
  const camp = G.camp;
  const P = G.P;
  if (!camp || !P) return;
  hud.show(false);
  exitLock();
  const win = camp.win;
  $('endEyebrow').textContent = win ? 'ACTION REPORT' : 'SUNK';
  $('endTitle').textContent = win ? '铁底湾守住了' : '战舰沉没';
  $('endLine').textContent = win
    ? '三艘驱逐舰全部沉入海峡。天亮前把炮弹补满——日军下一波不会等太久。'
    : '你的战列舰翻沉在铁底湾。这片海峡底下已经躺了太多船，再多一艘也不算稀奇。';
  const acc = P.stats.shots ? (P.stats.hits / P.stats.shots) * 100 : 0;
  const t = Math.floor(G.world?.time || 0);
  const rows: [string, string][] = [
    ['击沉', `${camp.kills.length} 艘`],
    ['击沉吨位', `${camp.tons.toLocaleString('zh-CN')} 吨`],
    ['主炮发射', `${P.stats.shots} 发`],
    ['主炮命中', `${P.stats.hits} 发 (${acc.toFixed(1)}%)`],
    ['承受伤害', `${Math.round(P.stats.taken).toLocaleString('zh-CN')}`],
    ['战斗时间', `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`],
  ];
  $('endStats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  showScreen('end');
}

// ------------------------------------------------------------------ screens

function showScreen(id: string | null): void {
  for (const el of document.querySelectorAll('.screen')) (el as HTMLElement).hidden = true;
  if (id) $(id).hidden = false;
}

function toMenu(): void {
  G.mode = 'menu';
  exitLock();
  hud.show(false);
  showScreen('home');
}

function pause(on: boolean): void {
  if (on && G.mode === 'play') {
    G.mode = 'paused';
    exitLock();
    showScreen('pause');
  } else if (!on && G.mode === 'paused') {
    G.mode = 'play';
    showScreen(null);
    requestLock();
  }
}

// ------------------------------------------------------------------ input

function requestLock(): void {
  const cv = $<HTMLCanvasElement>('gl');
  if (document.pointerLockElement !== cv) cv.requestPointerLock?.();
}

function exitLock(): void {
  if (document.pointerLockElement) document.exitPointerLock();
}

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape') {
    if (G.mode === 'play') pause(true);
    else if (G.mode === 'paused') pause(false);
  }
  if (G.mode !== 'play') return;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') throttleStep(1);
  if (e.code === 'KeyS' || e.code === 'ArrowDown') throttleStep(-1);
  if (e.code === 'Digit1') G.weapon = 'guns';
  if (e.code === 'Digit2') G.weapon = 'torps';
  if (e.code === 'KeyR') G.P && cmdDC(G.world!, G.P);
  if (e.code === 'KeyC') G.camMode = G.camMode === 'chase' ? 'bridge' : 'chase';
  if (e.code === 'KeyL') G.showLead = !G.showLead;
  if (e.code === 'F3') {
    G.debug = !G.debug;
    e.preventDefault();
  }
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

function throttleStep(d: number): void {
  const P = G.P;
  if (!P || !P.alive) return;
  P.throttle = clamp(P.throttle + d, 0, 6);
}

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== $<HTMLCanvasElement>('gl')) return;
  if (G.mode !== 'play') return;
  const f = (camera.fov / 55) * aim.sens;
  aim.pYaw += e.movementX * 0.0022 * f;
  aim.pRange -= e.movementY * clamp(aim.range * 0.004, 14, 90) * f;
});

$<HTMLCanvasElement>('gl').addEventListener('mousedown', (e) => {
  if (G.mode !== 'play') return;
  if (document.pointerLockElement !== $<HTMLCanvasElement>('gl')) {
    requestLock();
    return;
  }
  const P = G.P;
  if (!P) return;
  if (e.button === 0) {
    if (G.weapon === 'guns') playerFire(G.world!, P, P.aimX, P.aimZ);
    else playerTorpedo(G.world!, P, P.aimX, P.aimZ);
  }
  if (e.button === 2) G.zoomWant = 1;
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) G.zoomWant = 0;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (G.mode !== 'play') return;
  aim.pRange -= e.deltaY * clamp(aim.range * 0.004, 14, 90);
});

// ------------------------------------------------------------------ menu wiring

for (const b of document.querySelectorAll<HTMLButtonElement>('#sideSeg button')) {
  b.addEventListener('click', () => {
    G.side = (b.dataset.s as 'US' | 'JP') || 'US';
    G.key = G.side === 'US' ? 'us_bb' : 'jp_bb';
    for (const o of document.querySelectorAll('#sideSeg button')) o.classList.toggle('on', o === b);
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#diffSeg button')) {
  b.addEventListener('click', () => {
    G.diff = (b.dataset.d as Difficulty) || 'captain';
    for (const o of document.querySelectorAll('#diffSeg button')) o.classList.toggle('on', o === b);
    $('homeBest').textContent = `难度：${DIFF[G.diff].name} · 敌舰命中误差 ×${DIFF[G.diff].aiErr} · 我舰受伤 ×${DIFF[G.diff].dmgTaken}`;
  });
}
$('startBtn').addEventListener('click', () => startBattle());
$('guideBtn').addEventListener('click', () => ($('guide').hidden = false));
$('guideClose').addEventListener('click', () => ($('guide').hidden = true));
$('soundBtn').addEventListener('click', () => {
  sfx.init();
  sfx.setMuted(!sfx.muted);
  $('soundBtn').textContent = `声音：${sfx.muted ? '关' : '开'}`;
});
$('debugBtn').addEventListener('click', () => {
  G.debug = !G.debug;
});
$('resumeBtn').addEventListener('click', () => pause(false));
$('quitBtn').addEventListener('click', () => toMenu());
$('againBtn').addEventListener('click', () => startBattle());
$('portBtn').addEventListener('click', () => toMenu());

addEventListener('resize', () => {
  engine.resize();
  overlay.resize();
});
overlay.resize();

// ------------------------------------------------------------------ loop

let last = performance.now();
const tmpV = new THREE.Vector3();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, Math.max(0.0005, raw));
  lastDt = raw;
  G.time += dt;
  G.shake = Math.max(0, G.shake - dt * 2.2);

  const world = G.world;
  const P = G.P;

  if (world && (G.mode === 'play' || G.mode === 'end')) {
    if (G.mode === 'play') {
      // helm and throttle
      if (P && P.alive) {
        const left = keys.KeyA || keys.ArrowLeft;
        const right = keys.KeyD || keys.ArrowRight;
        P.rudderCmd = (right ? 1 : 0) - (left ? 1 : 0);
      }
      // aim easing
      const k = 1 - Math.exp(-dt / 0.05);
      aim.yaw += (aim.pYaw || 0) * k;
      aim.range = clamp(aim.range + (aim.pRange || 0) * k, 250, (P?.gun.range || 22000) * 1.08);
      aim.pYaw *= 1 - k;
      aim.pRange *= 1 - k;
      if (P) {
        P.aimX = P.x + Math.sin(aim.yaw) * aim.range;
        P.aimZ = P.z + Math.cos(aim.yaw) * aim.range;
      }
      world.step(dt, true);
      G.camp?.update(dt);
    } else {
      world.step(dt, false);
    }

    // views
    for (const s of world.ships) {
      let v = views.get(s.id);
      if (!v) {
        v = new ShipView(scene, s);
        views.set(s.id, v);
      }
    }
    for (const [id, v] of views) {
      if (!world.ships.includes(v.ship)) {
        v.dispose(scene);
        views.delete(id);
      } else v.update(dt, G.time, water);
    }

    fx.ships(dt, world.ships, water);
    fx.update(dt, G.time, world.shells, world.torps);
  }

  // salvo spotting
  if (P) {
    for (const r of salvos) {
      r.age += dt;
      if (!r.done && (r.got >= r.n || r.age > 26)) {
        r.done = true;
        if (r.target && r.target.alive && r.got) {
          const a = r.along / r.got;
          const cr = r.cross / r.got;
          const sp = r.target.spec;
          const over = a > 0;
          const m = (v: number) => `${Math.round(Math.abs(v) / 10) * 10}m`;
          let text = '';
          if (r.hits) text = `命中 ${r.hits} 发`;
          const alongOk = Math.abs(a) < sp.L * 0.6;
          const crossOk = Math.abs(cr) < sp.B * 1.2;
          if (alongOk && crossOk) text = text || '跨射！命中';
          else {
            const alongTxt = alongOk ? '' : `${over ? '远' : '近'} ${m(a)}`;
            const crossTxt = crossOk ? '' : `${cr > 0 ? '偏右' : '偏左'} ${m(cr)}`;
            text = (text ? text + ' · ' : '') + [alongTxt, crossTxt].filter(Boolean).join(' · ');
          }
          if (text) spots.push({ text, x: r.target.x, z: r.target.z, t: 3.6 });
        }
      }
    }
    salvos = salvos.filter((r) => !r.done || r.age < 30);
    for (const s of spots) s.t -= dt * 0.28;
    spots = spots.filter((s) => s.t > 0);
  }

  if (G.mode === 'menu') {
    const a = G.time * 0.06;
    camera.position.set(Math.sin(a) * 900, 340, Math.cos(a) * 900);
    camera.lookAt(0, 40, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
  } else {
    updateCamera(dt);
  }
  water.update(G.time, camera.position);

  if (P && G.mode === 'play') {
    const d = Math.hypot(P.aimX - P.x, P.aimZ - P.z);
    const sig = sigmaAt(P.gun, d);
    aimMarker.update(P.aimX, P.aimZ, P.x, P.z, sig);
    aimMarker.setVisible(G.weapon === 'guns' && P.alive);
  } else {
    aimMarker.setVisible(false);
  }

  if (world && P && (G.mode === 'play' || G.mode === 'end')) {
    updateUI(dt, world, P);
  }

  if (G.mode === 'end') {
    G.endT -= dt;
    if (G.endT <= 0 && $('end').hidden) showEnd();
  }

  renderer.render(scene, camera);
}

function updateCamera(dt: number): void {
  const P = G.P;
  if (P && G.inspect > 0) {
    if (G.inspect === 2) {
      // fixed broadside: the whole profile in one frame, for checking the turret layout
      const a = P.heading + Math.PI / 2;
      const r = P.spec.L * 1.7;
      camera.position.set(P.x + Math.sin(a) * r, P.spec.F * 3.4, P.z + Math.cos(a) * r);
      camera.lookAt(P.x, P.spec.F * 0.5, P.z);
      camera.fov = 32;
    } else {
      const a = G.time * 0.25;
      const r = 260 + 120 * G.inspect;
      camera.position.set(P.x + Math.sin(a) * r, 40 + 90 * G.inspect, P.z + Math.cos(a) * r);
      camera.lookAt(P.x, P.spec.F * 0.6, P.z);
      camera.fov = 40;
    }
    camera.updateProjectionMatrix();
    return;
  }
  const fovTarget = lerp(55, 11, G.zoom);
  camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();
  G.zoom += (G.zoomWant - G.zoom) * Math.min(1, dt * 9);
  if (!P) return;

  const dx = Math.sin(aim.yaw),
    dz = Math.cos(aim.yaw);
  let px: number, py: number, pz: number, tx: number, ty: number, tz: number;
  if (G.camMode === 'bridge') {
    // the conning position: above and behind the bridgework, clear of the forward turrets
    const bz = P.spec.bridge ? P.spec.bridge[0] : P.spec.L * 0.3;
    const by = P.spec.bridge ? P.spec.bridge[1] : P.spec.F + P.spec.top * 0.55;
    const [bx, bz2] = P.toWorld(0, bz);
    px = bx;
    py = by + P.bob;
    pz = bz2;
  } else {
    const [cd, ch] = P.spec.cam;
    const back = cd * lerp(1, 0.55, G.zoom);
    px = P.x - dx * back;
    py = ch * lerp(1, 0.7, G.zoom) + P.bob;
    pz = P.z - dz * back;
  }
  // Look at what the guns are laid on, not at a point a few hundred metres ahead: aiming 7 km away
  // while the camera stares 320 m ahead puts the fall of shot off the top of the screen.
  tx = P.aimX;
  ty = 26 + P.bob;
  tz = P.aimZ;
  const sh = G.shake * 0.5;
  const k = 1 - Math.exp(-dt / 0.09);
  camera.position.x += (px - camera.position.x) * k;
  camera.position.y += (py - camera.position.y) * k;
  camera.position.z += (pz - camera.position.z) * k;
  if (sh > 0.001) {
    camera.position.x += (Math.random() - 0.5) * sh * 6;
    camera.position.y += (Math.random() - 0.5) * sh * 6;
  }
  tmpV.set(tx, ty, tz);
  camera.lookAt(tmpV);

  // keep the sun's shadow box around the player
  engine.sun.position.set(P.x - 900, 620, P.z + 520);
  engine.sun.target.position.set(P.x, 0, P.z);
  engine.sun.target.updateMatrixWorld();
}

function updateUI(dt: number, world: World, P: Ship): void {
  const d = Math.hypot(P.aimX - P.x, P.aimZ - P.z);
  const flight = flightTime(P.gun, d);
  const sig = sigmaAt(P.gun, d);

  // torpedo danger
  let warn = false;
  const tpList: { x: number; z: number; danger: boolean }[] = [];
  for (const t of world.torps as Torpedo[]) {
    if (!t.alive) continue;
    if (!torpVisible(t, P.team)) continue;
    const qx = P.x - t.x,
      qz = P.z - t.z;
    const dvx = P.vx - t.dx * t.speed,
      dvz = P.vz - t.dz * t.speed;
    const dv2 = dvx * dvx + dvz * dvz || 1;
    const tc = clamp(-(-qx * dvx + -qz * dvz) / dv2, 0, 30);
    const cx = -qx + dvx * tc,
      cz = -qz + dvz * tc;
    const miss = Math.hypot(cx, cz);
    const danger = miss < 320 && tc < 30;
    if (danger) warn = true;
    tpList.push({ x: t.x, z: t.z, danger });
  }
  if (warn && Math.random() < dt * 2) sfx.alarm();

  const project = (x: number, y: number, z: number): [number, number] | null => {
    tmpV.set(x, y, z).project(camera);
    if (tmpV.z > 1) return null;
    return [((tmpV.x + 1) / 2) * window.innerWidth, ((1 - tmpV.y) / 2) * window.innerHeight];
  };

  overlay.draw({
    P,
    world,
    project,
    aimX: P.aimX,
    aimZ: P.aimZ,
    sigma: sig,
    flight,
    weapon: G.weapon,
    zoom: G.zoom,
    showLead: G.showLead,
    target: nearestFoeTo(P.aimX, P.aimZ),
    torpedoes: tpList,
    spots,
    time: G.time,
  });

  hud.update(dt, P, world, G.camp, G.weapon, warn);
  hud.setLockHint(G.mode === 'play' && document.pointerLockElement === null);
  minimap.draw(world, P, world.torps, { x: P.aimX, z: P.aimZ });

  if (G.debug) {
    const t = nearestFoeTo(P.aimX, P.aimZ);
    const chance = t ? hitChance(P.gun, Math.hypot(t.x - P.x, t.z - P.z), t.spec.L, t.spec.B, P.mainTurrets.length * 3) : 0;
    const T = flightTime(P.gun, d);
    const apex = 0.5 * P.gun.g * (T / 2) * (T / 2) * 0.25;
    hud.setDebug(
      [
        `距离      ${Math.round(d)} m`,
        `飞行时间  ${T.toFixed(2)} s   (10km = ${flightTime(P.gun, 10000).toFixed(2)} s)`,
        `散布 1σ   纵 ${sig.along.toFixed(0)} m  横 ${sig.cross.toFixed(0)} m`,
        `初速/重力  ${P.gun.v0} m/s   ${P.gun.g.toFixed(1)} m/s²`,
        `弹道顶点  ~${Math.round(apex)} m`,
        t ? `目标 ${t.name}  理论命中 ${(chance * 100).toFixed(1)}%` : '无目标',
        `副炮      ${P.secTurrets.length} 座 · ${P.secGun ? P.secGun.range : 0} m 自动开火`,
        `时间压缩  ×2.5   视角 ${G.camMode}`,
      ].join('\n'),
    );
  } else hud.setDebug(null);
}

// ------------------------------------------------------------------ go

// a hook for the smoke test and for poking at a live battle from the console
(window as unknown as { __debug: () => unknown }).__debug = () => ({
  mode: G.mode,
  time: +G.time.toFixed(1),
  side: G.side,
  ship: G.key,
  player: G.P
    ? { name: G.P.name, hp: Math.round(G.P.hp), max: Math.round(G.P.maxHp), x: Math.round(G.P.x), z: Math.round(G.P.z) }
    : null,
  ships:
    G.world?.ships.map((s) => ({
      name: s.name,
      team: s.team,
      hp: Math.round(s.hp),
      alive: s.alive,
      d: G.P ? Math.round(Math.hypot(s.x - G.P.x, s.z - G.P.z)) : 0,
      fires: s.fires.length,
    })) ?? [],
  shells: G.world?.shells.filter((s) => s.alive).length ?? 0,
  torps: G.world?.torps.filter((t) => t.alive).length ?? 0,
  overlay: overlay.dbg,
  kills: G.camp?.kills.length ?? 0,
  tons: G.camp?.tons ?? 0,
  fps: Math.round(1 / Math.max(0.0001, lastDt)),
});

let lastDt = 0.016;

// a small console remote, handy for the smoke test and for tuning
(window as unknown as { __cmd: Record<string, (...a: number[]) => void> }).__cmd = {
  fire: () => {
    if (G.P && G.world && G.mode === 'play') playerFire(G.world, G.P, G.P.aimX, G.P.aimZ);
  },
  aimAt: (x: number, z: number) => {
    if (!G.P) return;
    aim.yaw = Math.atan2(x - G.P.x, z - G.P.z);
    aim.range = Math.hypot(x - G.P.x, z - G.P.z);
    G.P.aimX = x;
    G.P.aimZ = z;
  },
  aimAtNearest: () => {
    const P = G.P;
    if (!P) return;
    const t = nearestFoeTo(P.x, P.z);
    if (t) {
      aim.yaw = Math.atan2(t.x - P.x, t.z - P.z);
      aim.range = Math.hypot(t.x - P.x, t.z - P.z);
      P.aimX = t.x;
      P.aimZ = t.z;
    }
  },
  zoom: (v: number) => {
    G.zoomWant = v;
  },
  cam: (v: number) => {
    G.camMode = v ? 'bridge' : 'chase';
  },
  throttle: (v: number) => {
    if (G.P) G.P.throttle = clamp(v, 0, 6);
  },
  inspect: (v: number) => {
    G.inspect = v;
  },
  /** Throw a shell into the sea near the ship, for looking at the fall of shot. */
  splash: (cal: number) => {
    const P = G.P;
    if (!P) return;
    // put it where the guns are pointing, so it is actually in shot
    const dx = P.aimX - P.x,
      dz = P.aimZ - P.z;
    const d = Math.hypot(dx, dz) || 1;
    const r = Math.min(520, d * 0.35);
    const x = P.x + (dx / d) * r;
    const z = P.z + (dz / d) * r;
    fx.splash(x, z, cal || 406, Math.random() < 0.5);
    sfx.splash(cal || 406, r);
  },
  /** Raycast a grid over the screen: which named object is in front of the camera, and how close. */
  probeView: () => {
    const rc = new THREE.Raycaster();
    const out: { x: number; y: number; hit: string | null; d: number }[] = [];
    const N = 9;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const nx = ((i + 0.5) / N) * 2 - 1;
        const ny = ((j + 0.5) / N) * 2 - 1;
        rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
        const hits = rc.intersectObjects(scene.children, true);
        const h = hits.find((q) => q.object.name);
        out.push({ x: +nx.toFixed(2), y: +ny.toFixed(2), hit: h ? h.object.name : null, d: h ? Math.round(h.distance) : 0 });
      }
    }
    (window as unknown as { __probe: unknown }).__probe = out;
  },
};

toMenu();
requestAnimationFrame(frame);
