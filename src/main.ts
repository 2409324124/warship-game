// Boot, input, camera and the main loop. This is the only file that knows about both the
// simulation and the page.

import * as THREE from 'three';
import { clamp, lerp } from './sim/constants';
import { flightTime, hitChance, dispersionAt, solveShot } from './sim/ballistics';
import { muzzleWorld } from './sim/gunnery';
import { Campaign, OPERATION, DUEL, DUEL_JP, type CampaignLevel } from './sim/campaign';
import { TargetLock, type LockSolution } from './sim/targetlock';
import { playerFire, playerTorpedo, cmdDC, World, DIFF, type Difficulty, type SimEvent } from './sim/world';
import { AI } from './sim/ai';
import { SPECS } from './sim/ships';
import { torpVisible, type Torpedo } from './sim/torpedo';
import type { Ship } from './sim/ship';
import { createEngine } from './render/engine';
import { createSky } from './render/sky';
import { createWater } from './render/water';
import { createAircraftView } from './render/aircraftView';
import { spawnAirRaid } from './sim/aircraft';
import { createLand } from './render/land';
import { FX } from './render/fx';
import { AimMarker } from './render/aimMarker';
import { ShipView } from './render/shipView';
import { chaseFraming } from './render/chaseCamera';
import { CameraControls, type ProjectileRef } from './render/battleCamera';
import { aimViewDirection, aimPitchToPoint, clampAimPitch, traceAimSurface } from './render/aimView';
import { terrainH } from './sim/terrain';
import { anyModel, loadModelManifest, modelList } from './render/models';
// Read the model index first: with no Blender exports there is nothing to fetch and the glTF
// loader is never imported at all.
let loadedModelsFn: () => string[] = () => [];
void loadModelManifest().then(() => {
  if (!anyModel()) return;
  void import('./render/assets').then((m) => {
    loadedModelsFn = m.loadedModels;
  });
});
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
const aircraftView = createAircraftView(scene);
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
  level: OPERATION as CampaignLevel,
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
const aim = { yaw: 0, pitch: -.008, range: 9000, sens: 1,
  targetY: 0, hasSurface: true, onSea: true, syncTime: 0 };
const keys: Record<string, boolean> = {};
const cameraControls = new CameraControls();
let cPressedAt: number | null = null;
let cameraReturn = 0;
const cameraLook = new THREE.Vector3(0, 0, 1);
let cameraLookReady = false;
let lastCameraMode = 'ship';
let weaponClearance = { key: '', height: 0 };
/** The target lock: guns follow her, the captain trims the solution, the rangefinder converges. */
const lock = new TargetLock();
let lockSol: LockSolution | null = null;
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
      water.update(G.time, camera.position);
      // One blast per actual tube, not a single fireball between a triple mount.
      for (let i = 0; i < sh.length; i++) {
        const pose = views.get(id)?.muzzlePose(e.turret as number, i);
        const shell = sh[i];
        const mx = pose?.x ?? shell[1], my = pose?.y ?? shell[2], mz = pose?.z ?? shell[3];
        fx.muzzle(mx, my, mz,
          pose?.bearing ?? (e.b as number), cal, pose?.elevation ?? (e.elevation as number) ?? 0);
        // AA fire happens overhead; it must not punch a water blast ring under the muzzle.
        if (!e.aa) water.blast(mx, mz, cal, Math.max(0, my - water.height(mx, mz, G.time)));
      }
      sfx.gun(cal, dist(e.x as number, e.z as number) + 60, own,
        { barrels: e.n as number, secondary: !!e.sec });
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
      const victim = world.byId(e.id as number);
      fx.hit(e.x as number, e.y as number, e.z as number, cal, victim,
        e.lx as number | undefined, e.ly as number | undefined, e.lz as number | undefined);
      sfx.hit(cal, dist(e.x as number, e.z as number) + 40);
      const rec = salvos.find((r) => r.salvo === e.salvo);
      if (rec) rec.hits++;
      if (victim && victim.isPlayer) shakeBy(clamp((e.dmg as number) / 2600, 0.1, 1), false);
      break;
    }
    case 'flak': {
      const cal = e.cal as number;
      fx.flak(e.x as number, e.y as number, e.z as number, cal >= 100);
      break;
    }
    case 'planeDown': {
      fx.explosion(e.x as number, e.y as number, e.z as number, false);
      hud.feed('击落敌机', 'good');
      break;
    }
    case 'planeSplash': {
      const x = e.x as number, z = e.z as number;
      fx.splash(x, z, 250, true);
      sfx.splash(250, dist(x, z) + 40);
      break;
    }
    case 'airRaidWarn': {
      hud.banner('雷达接触', e.msg as string);
      sfx.alarm();
      break;
    }
    case 'airRaid': {
      hud.hint('敌机来袭');
      break;
    }
    case 'actStart': {
      if (e.boss) {
        hud.banner('金刚', '战列舰 · 金刚级');
        sfx.alarm();
      } else {
        hud.banner(e.title as string, e.objective as string);
      }
      if (e.callout) hud.feed(e.callout as string, 'radio');
      break;
    }
    case 'actClear': {
      const left = e.left as number;
      hud.feed(`<b>${e.title}</b> 完成 · ${left > 0 ? `${left} 艘残余敌舰脱离` : '海域已清空'}`, 'good');
      break;
    }
    case 'repair': {
      const hp = Math.round(e.hp as number);
      const gain = e.dc as number;
      const parts = [hp > 0 ? `耐久 +${hp}` : '舰体完好'];
      parts.push(gain > 0 ? `损管 +${gain}` : `损管 ${e.dcLeft as number}/${G.P?.spec.dc ?? 2}`);
      hud.feed(`损管抢修：${parts.join(' · ')}`, 'good');
      hud.hint(`下一幕 ${Math.ceil(e.nextIn as number)} 秒后开始`);
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
  cameraControls.reset();
  cPressedAt = null;
  cameraLookReady = false;
  cameraReturn = 0;
  weaponClearance.key = '';
  lastCameraMode = 'ship';
  G.zoom = G.zoomWant = 0;
  G.camMode = 'chase';
  G.inspect = 0;
  fx.reset();
  hud.reset();
  water.resetBlasts();
  for (const v of views.values()) v.dispose(scene);
  views.clear();
  spots = [];
  salvos = [];
  lock.unlock();
  lockSol = null;
  const spec = SPECS[G.key];
  const team = spec?.nation ?? 'US';
  const foe = team === 'US' ? 'JP' : 'US';
  G.level = G.key === 'us_bb' ? OPERATION : team === 'US' ? DUEL : DUEL_JP;
  G.world = new World({ diff: G.diff, onEvent, foe });
  const camp = new Campaign(
    G.world,
    G.level,
    G.key,
    team === 'US' ? '华盛顿' : '雾岛',
    team === 'US' ? 'BB-56' : 'BB-31',
  );
  G.camp = camp;
  G.P = camp.player;
  camp.begin();
  // the other side gets a captain too
  for (const s of G.world.ships) if (!s.isPlayer && !s.ai) s.ai = new AI(G.world, s);

  hud.hint('第一幕开始 · X 锁定 · R 损管 · 向北推进');
  aim.yaw = G.P.heading;
  aim.range = clamp(9000, 800, spec ? G.P.gun.range : 22000);
  G.P.aimX=G.P.x+Math.sin(aim.yaw)*aim.range;
  G.P.aimZ=G.P.z+Math.cos(aim.yaw)*aim.range;
  aim.targetY=0; aim.hasSurface=true; aim.onSea=true; aim.syncTime=.45;
  const initial=chaseFraming(G.P.spec,camera.aspect,0);
  camera.position.set(G.P.x-Math.sin(aim.yaw)*initial.back,initial.height,
    G.P.z-Math.cos(aim.yaw)*initial.back);
  aim.pitch=aimPitchToPoint(camera.position,{x:G.P.aimX,y:0,z:G.P.aimZ});
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
  cameraControls.exitFollow();
  cameraControls.endFreeLook();
  cPressedAt = null;
  G.mode = 'end';
  G.endT = win ? 3.2 : 4.5;
  const op = G.camp?.level.id === 'steel-lane';
  hud.banner(
    win ? (op ? '金刚沉没' : '海峡守住了') : '作战失败',
    win ? (op ? '作战成功' : '全部敌舰已击沉') : '华盛顿号沉没',
  );
}

function showEnd(): void {
  const camp = G.camp;
  const P = G.P;
  if (!camp || !P) return;
  hud.show(false);
  exitLock();
  const win = camp.win;
  const op = camp.level.id === 'steel-lane';
  const act = camp.act + 1;
  $('endEyebrow').textContent = win ? (op ? 'OPERATION COMPLETE' : 'ACTION REPORT') : 'MISSION FAILED';
  $('endTitle').textContent = win ? (op ? '金刚沉没' : '海峡守住了') : '战舰沉没';
  $('endLine').textContent = win
    ? op
      ? '金刚的舰桥沉进海峡北口。天亮前继续向北——但今晚这条航线，已经打开了。'
      : '全部敌舰已沉入海峡。天亮前把炮弹补满——日军下一波不会等太久。'
    : op
      ? `华盛顿号在第 ${act} 幕沉没。海峡仍在日军手里。`
      : '你的战列舰翻沉在铁底湾。这片海峡底下已经躺了太多船，再多一艘也不算稀奇。';
  const acc = P.stats.shots ? (P.stats.hits / P.stats.shots) * 100 : 0;
  const t = Math.floor(G.world?.time || 0);
  const stars = camp.stars;
  $('endStars').innerHTML =
    '★'.repeat(stars) + `<span class="off">${'☆'.repeat(Math.max(0, 3 - stars))}</span>`;
  const rows: [string, string][] = [
    ['击沉', `${camp.kills.length} 艘`],
    ['击沉吨位', `${camp.tons.toLocaleString('zh-CN')} 吨`],
    ['击落敌机', `${G.world?.planesDown ?? 0} 架`],
    ['抵达', op ? `第 ${act} 幕 / 共 ${camp.actCount} 幕` : `第 ${act} 幕`],
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
  cameraControls.reset();
  G.key = 'us_bb';
  G.level = OPERATION;
  G.mode = 'menu';
  exitLock();
  hud.show(false);
  showScreen('home');
}

function pause(on: boolean): void {
  if (on && G.mode === 'play') {
    cameraControls.endFreeLook();
    cPressedAt = null;
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
    if (G.mode === 'play' && cameraControls.follow) {
      cameraControls.exitFollow();
      cameraReturn = .8;
      requestAimSync();
      e.preventDefault();
      return;
    }
    if (G.mode === 'play') pause(true);
    else if (G.mode === 'paused') pause(false);
  }
  if (G.mode !== 'play') return;
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) {
    cameraControls.toggleBinocular();
    requestAimSync();
    G.inspect = 0;
    e.preventDefault();
  }
  if (e.code === 'KeyW' || e.code === 'ArrowUp') throttleStep(1);
  if (e.code === 'KeyS' || e.code === 'ArrowDown') throttleStep(-1);
  if (e.code === 'Digit1') G.weapon = 'guns';
  if (e.code === 'Digit2') G.weapon = 'torps';
  if (e.code === 'KeyR') G.P && cmdDC(G.world!, G.P);
  if (e.code === 'KeyC' && !e.repeat) cPressedAt = performance.now();
  if (e.code === 'KeyV' && !e.repeat) {
    cameraControls.toggleBridge();
    requestAimSync();
    G.inspect = 0;
  }
  if (e.code === 'KeyZ' && !e.repeat) toggleProjectileCamera();
  if (e.code === 'KeyL') G.showLead = !G.showLead;
  if (e.code === 'KeyX' && !e.repeat) toggleLock();
  if (e.code === 'Tab' && !e.repeat) {
    e.preventDefault();
    cycleLock();
  }
  if (e.code === 'F3') {
    G.debug = !G.debug;
    e.preventDefault();
  }
});

/** X: lock the enemy nearest the crosshair, or let her go if one is already locked. */
function toggleLock(): void {
  const P = G.P;
  if (!P || !P.alive) return;
  if (lock.locked) {
    hud.hint('解除锁定');
    lock.unlock();
    lockSol = null;
    return;
  }
  const t = lock.pick(P, aim.yaw, G.world?.ships ?? []);
  if (!t) {
    hud.hint('准星附近没有可锁定的敌舰');
    return;
  }
  lock.lock(t);
  hud.hint(`锁定 ${t.name} · 测距中`);
}

/** Tab: work through the enemies the crosshair can see. */
function cycleLock(): void {
  const P = G.P;
  if (!P || !P.alive) return;
  const t = lock.cycle(P, aim.yaw, G.world?.ships ?? []);
  if (t) hud.hint(`切换目标：${t.name}`);
  else hud.hint('没有可锁定的敌舰');
}
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyC' && cPressedAt !== null) {
    if (G.mode === 'play') {
      G.inspect = 0;
      if (cameraControls.follow) cycleProjectileCamera();
      else if (performance.now() - cPressedAt >= 800) cameraControls.toggleWeapon();
      else cameraControls.cycleGroup(G.P?.mainTurrets.length ?? 0);
      requestAimSync();
    }
    cPressedAt = null;
  }
});
addEventListener('blur', () => {
  cameraControls.endFreeLook();
  requestAimSync();
  cPressedAt = null;
  for (const k in keys) keys[k] = false;
});
addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== $('gl')) {cameraControls.endFreeLook();requestAimSync();}
});

function throttleStep(d: number): void {
  const P = G.P;
  if (!P || !P.alive) return;
  P.throttle = clamp(P.throttle + d, 0, 6);
}

// FPS-style: the mouse turns the guns and the view together, one to one, with no inertia. The
// crosshair sits at the centre of the screen and the world swings past it, which is how aiming
// feels in World of Warships.
//
// The sign matters and is easy to get backwards. Our bearing is a compass bearing: yaw grows from
// north (+z) toward east (+x). The camera's screen-right vector in world space is (-cos yaw, sin
// yaw), while d(aim point)/d(yaw) is (cos yaw, -sin yaw) - exactly the negative of screen-right.
// So turning the view right means *decreasing* the bearing, hence the minus below.
const YAW_PER_PX = 0.0022;

function requestAimSync():void { if(aim.hasSurface) aim.syncTime=1.2; }

function aimSurfaceHit(P:Ship) {
  return traceAimSurface(camera.position,aimViewDirection(aim.yaw,aim.pitch),
    P.gun.range*1.08+P.spec.L*2+300,
    (x,z)=>Math.max(water.renderHeight?.(x,z,G.time)??water.height(x,z,G.time),terrainH(x,z)));
}

/** Crosshair ray -> visible sea/terrain -> world aim point -> simulated gun solution.
 * Never feed a range label back into camera pitch: that was the broken vertical loop. */
function resolveAimFromView(P:Ship):void {
  if(lock.locked||cameraControls.freeLook||cameraControls.follow||G.inspect>0||aim.syncTime>0)return;
  const hit=aimSurfaceHit(P);
  if(hit){
    P.aimX=hit.x;P.aimZ=hit.z;aim.targetY=hit.y;
    aim.range=Math.hypot(hit.x-P.x,hit.z-P.z);
    aim.hasSurface=aim.range>=150&&aim.range<=P.gun.range;
    aim.onSea=terrainH(hit.x,hit.z)<=(water.renderHeight?.(hit.x,hit.z,G.time)??water.height(hit.x,hit.z,G.time))+.05;
  }else{
    aim.hasSurface=false;aim.onSea=false;aim.range=P.gun.range*1.08;
    P.aimX=P.x+Math.sin(aim.yaw)*aim.range;
    P.aimZ=P.z+Math.cos(aim.yaw)*aim.range;
    aim.targetY=0;
  }
}

function firePlayerGuns():void {
  const P=G.P,world=G.world;
  if(!P||!world||G.mode!=='play')return;
  resolveAimFromView(P);
  if(!aim.hasSurface){hud.hint('请将准星压向射程内的海面或目标');return;}
  playerFire(world,P,P.aimX,P.aimZ,lock.locked?lock.rangeError(aim.range):0);
}

/**
 * Mouse movement. Free: it drives the guns directly. Locked: it becomes *trim* on top of the
 * automatic solution, so the guns follow the target's manoeuvres while the captain still decides
 * whether she is short, long or right.
 */
function aimDelta(dx: number, dy: number): void {
  if (G.mode !== 'play') return;
  if (cameraControls.follow) return;
  if (cameraControls.freeLook) {
    cameraControls.moveLook(-dx * YAW_PER_PX, dy * YAW_PER_PX);
    return;
  }
  const f = (camera.fov / 55) * aim.sens;
  const dYaw = -dx * YAW_PER_PX * f;
  const dPitch = -dy * YAW_PER_PX * f;
  aim.yaw += dYaw;
  aim.pitch = clampAimPitch(aim.pitch+dPitch);
  aim.syncTime=0; cameraReturn=0;
  if (lock.locked) {
    let dRange=0;
    if(dy){
      // A foreground island must not steal a locked ship's range when the
      // captain nudges vertically. Trim on the target's water-height plane;
      // terrain still blocks the actual shell in simulation.
      const dir=aimViewDirection(aim.yaw,aim.pitch);
      const distance=(aim.targetY-camera.position.y)/dir.y;
      if(!G.P||dir.y>=-1e-6||!Number.isFinite(distance)||distance<=0){
        lock.unlock();lockSol=null;clampAim();return;
      }
      const x=camera.position.x+dir.x*distance,z=camera.position.z+dir.z*distance;
      dRange=Math.hypot(x-G.P.x,z-G.P.z)-(lock.baseRange+lock.offRange);
    }
    lock.addTrim(dYaw,dRange);
    clampAim();
    return;
  }
  clampAim();
}

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== $<HTMLCanvasElement>('gl')) return;
  aimDelta(e.movementX, e.movementY);
});

function clampAim(): void {
  const P = G.P;
  const maxR = (P?.gun.range || 22000) * 1.08;
  if(!Number.isFinite(aim.range))aim.range=maxR;
  aim.pitch=clampAimPitch(aim.pitch);
  if (aim.yaw > Math.PI) aim.yaw -= Math.PI * 2;
  if (aim.yaw < -Math.PI) aim.yaw += Math.PI * 2;
}

$<HTMLCanvasElement>('gl').addEventListener('mousedown', (e) => {
  if (G.mode !== 'play') return;
  if (e.button === 1 || e.button === 2) e.preventDefault();
  if (document.pointerLockElement !== $<HTMLCanvasElement>('gl')) {
    requestLock();
    return;
  }
  const P = G.P;
  if (!P) return;
  if (e.button === 2) {
    cameraControls.beginFreeLook(aim.yaw, Math.atan2(camera.position.y-P.bob, chaseFraming(P.spec,camera.aspect,0).back));
    return;
  }
  if (e.button === 0 || e.button === 1) {
    if (cameraControls.follow) { cameraControls.exitFollow(); cameraReturn = .8; requestAimSync(); return; }
    if (G.weapon === 'guns') firePlayerGuns();
    else playerTorpedo(G.world!, P, P.aimX, P.aimZ);
    if (e.button === 1) toggleProjectileCamera();
  }
});
addEventListener('mouseup', (e) => { if (e.button === 2) {cameraControls.endFreeLook();requestAimSync();} });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  if (G.mode !== 'play') return;
  e.preventDefault();
  if (e.deltaY) cameraControls.wheel(-Math.sign(e.deltaY));
  requestAimSync();
  G.inspect = 0;
}, { passive: false });

function projectileCandidates(kind?: 'shell' | 'torpedo'): ProjectileRef[] {
  const P = G.P, world = G.world;
  if (!P || !world) return [];
  const shells: ProjectileRef[] = world.shells.filter((p) => p.alive && p.owner === P && !p.sec)
    .map((p) => ({ kind: 'shell', id: p.id }));
  const torps: ProjectileRef[] = world.torps.filter((p) => p.alive && p.owner === P)
    .map((p) => ({ kind: 'torpedo', id: p.id }));
  const selected = kind ? (kind === 'shell' ? shells : torps)
    : G.weapon === 'torps' ? (torps.length ? torps : shells) : (shells.length ? shells : torps);
  return selected.sort((a,b) => b.id-a.id);
}

function toggleProjectileCamera(): void {
  G.inspect = 0;
  if (cameraControls.follow) { cameraControls.exitFollow(); cameraReturn = .8; requestAimSync(); return; }
  const next = projectileCandidates()[0];
  if (next) cameraControls.followProjectile(next);
  else hud.hint('没有仍在飞行的己方主炮弹或鱼雷');
}

function cycleProjectileCamera(): void {
  const follow = cameraControls.follow;
  if (!follow) return;
  const list = projectileCandidates(follow.kind);
  if (!list.length) { cameraControls.exitFollow(); cameraReturn = .8; requestAimSync(); return; }
  const at = list.findIndex((p) => p.id === follow.id);
  cameraControls.followProjectile(list[(at+1)%list.length]);
}

// ------------------------------------------------------------------ menu wiring

for (const b of document.querySelectorAll<HTMLButtonElement>('#diffSeg button')) {
  b.addEventListener('click', () => {
    G.diff = (b.dataset.d as Difficulty) || 'captain';
    for (const o of document.querySelectorAll('#diffSeg button')) o.classList.toggle('on', o === b);
    $('homeBest').textContent = `难度：${DIFF[G.diff].name} · 敌舰命中误差 ×${DIFF[G.diff].aiErr} · 我舰受伤 ×${DIFF[G.diff].dmgTaken}`;
  });
}
$('startBtn').addEventListener('click', () => void loadModelManifest().then(startBattle));
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
$('againBtn').addEventListener('click', () => void loadModelManifest().then(startBattle));
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
  G.zoomWant = cameraControls.freeLook || cameraControls.follow ? 0 : cameraControls.zoomTarget;
  G.camMode = cameraControls.bridge ? 'bridge' : 'chase';
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
      // Guns: locked, they follow the target's lead point and the mouse only trims them.
      // Free, the mouse drives them straight - no easing, no lag.
      if (P) {
        if (lock.locked) {
          lockSol = lock.update(dt, P, P.gun.range * 1.08);
          if (lockSol && !lockSol.broke) {
            aim.yaw = lockSol.yaw;
            aim.range = lockSol.range;
            P.aimX=P.x+Math.sin(lockSol.yaw)*lockSol.range;
            P.aimZ=P.z+Math.cos(lockSol.yaw)*lockSol.range;
            aim.targetY=water.renderHeight?.(P.aimX,P.aimZ,G.time)??water.height(P.aimX,P.aimZ,G.time);
            aim.hasSurface=lockSol.range<=P.gun.range;aim.onSea=terrainH(P.aimX,P.aimZ)<=aim.targetY;
          } else if(lockSol?.broke) {
            hud.hint('锁定解除：修正量过大');
            lockSol=null;
          }
        } else {
          lockSol = null;
        }
        // Aim is resolved once per frame after the camera update (below); doing it here
        // too would double the ray-march cost for a result that is discarded.
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

    // Own hull: close the camera in and she turns into a ghost instead of filling the lower
    // half of the screen. The near end of the hull is what matters, not her centre.
    if (P && P.alive) {
      const pv = views.get(P.id);
      if (pv) {
        const near = camera.position.distanceTo(pv.group.position) - P.spec.L * 0.45;
        const want = clamp((near - 140) / 160, 0.22, 1);
        pv.setOpacity(pv.opacity + (want - pv.opacity) * Math.min(1, dt * 6));
      }
    }

    fx.ships(dt, G.time, world.ships, water, camera.position);
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
  aircraftView.sync(world ? world.planes : []);
  if(P&&G.mode==='play')resolveAimFromView(P);

  if (P && G.mode === 'play') {
    const d = Math.hypot(P.aimX - P.x, P.aimZ - P.z);
    const sig = dispersionAt(P.gun,d,lock.locked ? lock.rangeError(d) : 0);
    const reachable = aim.hasSurface && d <= P.gun.range && P.mainTurrets.some((t) => {
      const [x,y,z] = muzzleWorld(P,t,0);
      return solveShot(P.gun,x,y,z,P.aimX,P.aimZ).reachable;
    });
    // The ring is a slow-moving visual aid: 30 Hz updates are invisible at battle pace,
    // while the projection costs thousands of wave-height samples per call.
    if ((engine.frame & 1) === 0 || Math.hypot(P.aimX - aimMarkX, P.aimZ - aimMarkZ) > 3) {
      aimMarkX = P.aimX; aimMarkZ = P.aimZ;
      aimMarker.update(P.aimX, P.aimZ, P.x, P.z, sig,water,G.time,reachable);
    }
    aimMarker.setVisible(G.weapon === 'guns' && P.alive && !cameraControls.freeLook && !cameraControls.follow);
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

  engine.render();
}

function updateCamera(dt: number): void {
  const P = G.P;
  if (P && G.inspect > 0) {
    cameraLookReady = false;
    if (G.inspect === 2) {
      // fixed broadside: the whole profile in one frame, for checking the turret layout
      const a = P.heading + Math.PI / 2;
      const r = P.spec.L * 1.7;
      camera.position.set(P.x + Math.sin(a) * r, P.spec.F * 3.4, P.z + Math.cos(a) * r);
      camera.lookAt(P.x, P.spec.F * 0.5, P.z);
      camera.fov = 32;
    } else if (G.inspect === 3) {
      // Bow/guard close-up for inspecting the loaded production ship in the sea.
      const [x,z] = P.toWorld(0,P.spec.L*.33);
      const a = P.heading+.62;
      const r = P.spec.L*.42;
      camera.position.set(x+Math.sin(a)*r,P.bob+P.spec.F+15,z+Math.cos(a)*r);
      camera.lookAt(x,P.bob+P.spec.F*1.15,z);
      camera.fov = 44;
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
  const framing = P ? chaseFraming(P.spec, camera.aspect, G.zoom) : null;
  const outerFov = cameraControls.bridge ? 60 : chaseFraming(P?.spec ?? SPECS.us_bb,camera.aspect,0).fov;
  const fovTarget = cameraControls.follow ? 50 : lerp(outerFov,cameraControls.binocularFov,G.zoom);
  camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();
  G.zoom += (G.zoomWant - G.zoom) * Math.min(1, dt * 9);
  if (!P) return;

  const viewYaw = cameraControls.freeLook ? cameraControls.lookYaw : aim.yaw;
  const dx = Math.sin(viewYaw), dz = Math.cos(viewYaw);
  let px: number, py: number, pz: number, tx: number, ty: number, tz: number;
  const follow = cameraControls.follow;
  const projectile = follow ? (follow.kind === 'shell'
    ? G.world?.shells.find((p) => p.id === follow.id && p.alive && p.owner === P)
    : G.world?.torps.find((p) => p.id === follow.id && p.alive && p.owner === P)) : null;
  if (follow && !projectile) {
    cameraControls.validateFollow(false);
    cameraReturn = .8;
    requestAimSync();
  }
  // Actual aim point stays authoritative; observation changes never rewrite it.
  tx = P.aimX; ty = aim.targetY; tz = P.aimZ;
  if (projectile && follow) {
    const shell = 'vy' in projectile ? projectile : null;
    const torp = 'dx' in projectile ? projectile : null;
    const vx = shell?.vx ?? torp!.dx * torp!.speed;
    const vy = shell?.vy ?? 0;
    const vz = shell?.vz ?? torp!.dz * torp!.speed;
    const v = Math.hypot(vx,vy,vz) || 1;
    const y = shell?.y ?? water.height(projectile.x,projectile.z,G.time)+.5;
    const back = follow.kind === 'shell' ? 42 : 28;
    px = projectile.x - vx/v*back;
    py = y - vy/v*back + (shell ? 9 : 12);
    pz = projectile.z - vz/v*back;
    tx = projectile.x + vx/v*24; ty = y + vy/v*24; tz = projectile.z + vz/v*24;
  } else if (cameraControls.freeLook) {
    const outer = chaseFraming(P.spec,camera.aspect,0);
    const back = outer.back * (cameraControls.level === 1 ? .80 : 1);
    const pitch = cameraControls.lookPitch;
    px = P.x - dx*back*Math.cos(pitch);
    pz = P.z - dz*back*Math.cos(pitch);
    py = P.bob + 12 + back*Math.sin(pitch);
    tx = P.x; ty = P.bob + P.spec.F + P.spec.top*.28; tz = P.z;
  } else if (G.camMode === 'bridge') {
    // the conning position: above and behind the bridgework, clear of the forward turrets
    const bz = P.spec.bridge ? P.spec.bridge[0] : P.spec.L * 0.3;
    const by = P.spec.bridge ? P.spec.bridge[1] : P.spec.F + P.spec.top * 0.55;
    const [bx, bz2] = P.toWorld(0, bz);
    px = bx;
    py = by + P.bob;
    pz = bz2;
  } else {
    const near = cameraControls.level === 1 ? .8 : 1;
    px = P.x - dx * framing!.back * near;
    py = framing!.height * (near === 1 ? 1 : .86) + P.bob;
    pz = P.z - dz * framing!.back * near;
    // Weapon views follow a selected articulated main mount, not a fixed conning point.
    if (cameraControls.level >= 2) {
      const main = P.mainTurrets[cameraControls.group % P.mainTurrets.length];
      const index = P.turrets.indexOf(main);
      const entry = views.get(P.id)?.turrets[index];
      if (entry) {
        entry.pivot.updateWorldMatrix(true,false);
        const anchor = entry.pivot.getWorldPosition(new THREE.Vector3());
        const back = G.zoom > .5 ? 8 : 14;
        px = anchor.x - dx*back;
        pz = anchor.z - dz*back;
        py = Math.max(anchor.y+main.ts.h+12, P.bob+P.spec.F+P.spec.top*.62+3);
        // Binoculars must clear the whole island, not just the central ray: a
        // narrow centre-only check can leave our mast filling the scope edge.
        if (G.zoom > .35) py = Math.max(py,P.bob+P.spec.F+P.spec.top+14);
        // Clear actual visible ship geometry, including an aft mount sightline past the bridge.
        const group = views.get(P.id)!.group;
        const key = `${P.key}:${P.id}:${cameraControls.group}:${cameraControls.level}:${Math.round((viewYaw-P.heading)/.12)}:${loadedModelsFn().length}`;
        if (weaponClearance.key === key) py = Math.max(py,weaponClearance.height+P.bob);
        else {
        const direction = new THREE.Vector3(tx-px,ty-py,tz-pz).normalize();
        const ray = new THREE.Raycaster(new THREE.Vector3(px,py,pz),direction,.5,P.spec.L*1.5);
        const visible = (obj: THREE.Object3D): boolean => {
          for (let o: THREE.Object3D|null = obj; o; o=o.parent) if (!o.visible) return false;
          return true;
        };
        for (let tries=0; tries<6; tries++) {
          ray.set(new THREE.Vector3(px,py,pz),new THREE.Vector3(tx-px,ty-py,tz-pz).normalize());
          if (!ray.intersectObject(group,true).some((h)=>visible(h.object))) break;
          py += 7;
        }
        weaponClearance = { key, height: py-P.bob+1.5 };
        py += 1.5;
        }
      }
    }
  }
  py = Math.max(py,water.height(px,pz,G.time)+5);
  const mode = `${cameraControls.mode}:${cameraControls.freeLook}:${cameraControls.group}`;
  if (mode !== lastCameraMode) { cameraReturn = Math.max(cameraReturn,.55); lastCameraMode = mode; }
  cameraReturn = Math.max(0,cameraReturn-dt);
  const sh = G.shake * 0.5;
  const k = 1 - Math.exp(-dt / (projectile ? .09 : cameraReturn > 0 ? .22 : .09));
  camera.position.x += (px - camera.position.x) * k;
  camera.position.y += (py - camera.position.y) * k;
  camera.position.z += (pz - camera.position.z) * k;
  if (sh > 0.001) {
    camera.position.x += (Math.random() - 0.5) * sh * 6;
    camera.position.y += (Math.random() - 0.5) * sh * 6;
  }
  if(!projectile&&!cameraControls.freeLook){
    if(aim.hasSurface&&(aim.syncTime>0||lock.locked)){
      // Rebase to the surface the CURRENT water mesh will display, not a
      // stale wave height from the previous weapon-camera position.
      ty=water.renderHeight?.(tx,tz,G.time)??water.height(tx,tz,G.time);
      if(!lock.locked)ty=Math.max(ty,terrainH(tx,tz));
      aim.targetY=ty;
      aim.yaw=Math.atan2(tx-camera.position.x,tz-camera.position.z);
      aim.pitch=clampAimPitch(aimPitchToPoint(camera.position,{x:tx,y:ty,z:tz}));
    }
    const direction=aimViewDirection(aim.yaw,aim.pitch);
    tmpV.set(direction.x,direction.y,direction.z);
    aim.syncTime=Math.max(0,aim.syncTime-dt);
  }else tmpV.set(tx,ty,tz).sub(camera.position).normalize();
  if (!cameraLookReady) { cameraLook.copy(tmpV); cameraLookReady = true; }
  else if(projectile||cameraControls.freeLook||(cameraReturn>0&&aim.syncTime>0)) {
    cameraLook.lerp(tmpV,1-Math.exp(-dt/(cameraReturn>0 ? .15 : .045)));
    if (cameraLook.lengthSq()<1e-8) cameraLook.copy(tmpV);
    cameraLook.normalize();
  } else cameraLook.copy(tmpV);
  camera.lookAt(tmpV.copy(camera.position).addScaledVector(cameraLook,100));

  // keep the sun's shadow box around the player
  engine.sun.position.set(P.x - 900, 620, P.z + 520);
  engine.sun.target.position.set(P.x, 0, P.z);
  engine.sun.target.updateMatrixWorld();
}

function updateUI(dt: number, world: World, P: Ship): void {
  const d = Math.hypot(P.aimX - P.x, P.aimZ - P.z);
  const flight = flightTime(P.gun, d);
  const sig = dispersionAt(P.gun,d,lock.locked ? lock.rangeError(d) : 0);

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
    zoom: cameraControls.freeLook || cameraControls.follow ? 0 : G.zoom,
    observing: cameraControls.freeLook || !!cameraControls.follow,
    showLead: G.showLead,
    target: nearestFoeTo(P.aimX, P.aimZ),
    torpedoes: tpList,
    spots,
    time: G.time,
    lock: lock.locked ? lock.target : null,
    lead: lockSol ? { x: lockSol.leadX, z: lockSol.leadZ } : null,
    converged: lock.locked ? lock.convergence() : 1,
  });

  hud.update(dt, P, world, G.camp, G.weapon, warn);
  const modeText = cameraControls.freeLook ? '自由观察 · 松开右键返回 · 武器瞄准保持'
    : cameraControls.follow ? `${cameraControls.follow.kind==='shell'?'炮弹':'鱼雷'}跟随 · C换弹 / Z返回`
    : cameraControls.bridge ? '舰桥视角 · V返回'
    : cameraControls.level >= 3 ? `望远瞄准 · ${cameraControls.binocularFov}° · 炮组 ${cameraControls.group+1}`
    : cameraControls.level === 2 ? `武器组 ${cameraControls.group+1} · C切换 / 长按C返回`
    : `第三人称 · ${cameraControls.level===0?'远景':'近景'} · 滚轮缩放 / 按住右键观察`;
  $('cameraMode').textContent = modeText;
  hud.updateTarget(lock.locked ? lock.target : null, lock.locked ? lock.convergence() : 1, flight);
  hud.setLockHint(G.mode === 'play' && document.pointerLockElement === null);
  minimap.draw(world, P, world.torps, { x: P.aimX, z: P.aimZ }, lock.locked ? lock.target : null);

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
  side: G.P?.team ?? 'US',
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
  planes: G.world?.planes.length ?? 0,
  torps: G.world?.torps.filter((t) => t.alive).length ?? 0,
  overlay: overlay.dbg,
  lock: lock.locked
    ? {
        name: lock.target!.name,
        held: +lock.held.toFixed(1),
        converged: +lock.convergence().toFixed(2),
        err: Math.round(lock.rangeError(aim.range)),
        trim: +((lock.offYaw * 180) / Math.PI).toFixed(2),
      }
    : null,
  models: { available: modelList(), loaded: loadedModelsFn() },
  // Scene-graph weight per ship: GLB-covered ships should show zero leftover procedural meshes.
  shipNodes: [...views.values()].map((v) => {
    let nodes = 0;
    const procedural: string[] = [];
    v.group.traverse((o) => { nodes++; if (/^(hull|deck|struct|dark|rails):/.test(o.name)) procedural.push(o.name); });
    return { nodes, procedural };
  }),
  kills: G.camp?.kills.length ?? 0,
  tons: G.camp?.tons ?? 0,
  act: G.camp
    ? {
        index: G.camp.act,
        phase: G.camp.phase,
        title: G.camp.actDef?.title ?? '',
        objective: G.camp.actDef?.objective ?? '',
        killed: G.camp.actKilled,
        total: G.camp.actTotal,
        planesDown: G.world?.planesDown ?? 0,
        stars: G.camp.stars,
      }
    : null,
  fps: Math.round(1 / Math.max(0.0001, lastDt)),
  render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
  effects: fx.stats(),
  audio: sfx.stats(),
  seaProjection: aimMarker.stats,
  selfOpacity: G.P ? (views.get(G.P.id)?.opacity ?? 1) : 1,
  camera: { fov: +camera.fov.toFixed(2), x: camera.position.x, y: camera.position.y, z: camera.position.z,
    pitch:Math.asin(new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).y) },
  cameraControl: { mode: cameraControls.mode, level: cameraControls.level, group: cameraControls.group,
    freeLook: cameraControls.freeLook, lookYaw: cameraControls.lookYaw, lookPitch: cameraControls.lookPitch,
    follow: cameraControls.follow, aimYaw: aim.yaw, aimRange: aim.range,
    aimPitch:aim.pitch,hasSurface:aim.hasSurface,onSea:aim.onSea,
    aimPoint:G.P?{x:G.P.aimX,y:aim.targetY,z:G.P.aimZ}:null,
    projectiles: projectileCandidates() },
});

let lastDt = 0.016;
let aimMarkX = 0, aimMarkZ = 0;

// a small console remote, handy for the smoke test and for tuning
(window as unknown as { __cmd: Record<string, (...a: any[]) => void> }).__cmd = {
  fire: () => {
    firePlayerGuns();
  },
  /** Dev: jump to act 0/1/2 and inspect the models without playing the whole operation. */
  jumpAct: (i: number) => {
    G.camp?.jumpTo(i);
    requestAimSync();
  },
  /** Dev: wipe the current act so the clear/repair/gap UI can be checked. */
  clearAct: () => {
    for (const x of G.camp?.actShips ?? []) {
      if (!x.s.alive) continue;
      x.s.alive = false;
      x.s.remove();
    }
  },
  /** Dev: start a single-ship duel for model screenshots (jp_bb, us_ca, ...). */
  solo: (key: string) => {
    G.key = key;
    void loadModelManifest().then(startBattle);
  },
  win: () => G.camp?.finish(true),
  lose: () => G.camp?.finish(false),
  /** Dev: park a burning, shell-scarred enemy 1.2 km ahead for damage-fx screenshots. */
  burn: (dist = 1200) => {
    const P = G.P, w = G.world;
    if (!w || !P || !P.alive) return;
    let best: (typeof w.ships)[number] | null = null;
    let bd = Infinity;
    for (const s of w.ships) {
      if (!s.alive || s.team === P.team) continue;
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return;
    const a = P.heading;
    best.x = P.x + Math.sin(a) * dist + Math.cos(a) * dist * 0.22;
    best.z = P.z + Math.cos(a) * dist - Math.sin(a) * dist * 0.22;
    best.hp = best.maxHp * 0.4;
    best.startFire(best.spec.L * 0.12, P);
    best.startFire(-best.spec.L * 0.22, P);
    for (let i = 0; i < 9; i++) {
      const lz = (Math.random() - 0.5) * best.spec.L * 0.7;
      const lx = (Math.random() - 0.5) * best.spec.B;
      const ly = Math.random() < 0.45 ? best.spec.F * 0.92 : Math.random() * best.spec.F * 0.8;
      const [wx, wz] = best.toWorld(lx, lz);
      fx.hit(wx, best.bob + ly, wz, 356, best, lx, ly, lz);
    }
    aim.yaw = Math.atan2(best.x - P.x, best.z - P.z);
    aim.range = Math.hypot(best.x - P.x, best.z - P.z);
    P.aimX = best.x;
    P.aimZ = best.z;
    requestAimSync();
  },
  /** Demo trigger for an air raid (QA only). */
  airRaid: () => {
    if (!G.world || !G.P || !G.P.alive) return;
    const foe = G.P.team === 'US' ? 'JP' : 'US';
    spawnAirRaid(G.world, foe, G.P, 8, 0);
  },
  aimAt: (x: number, z: number) => {
    if (!G.P) return;
    aim.yaw = Math.atan2(x - G.P.x, z - G.P.z);
    aim.range = Math.hypot(x - G.P.x, z - G.P.z);
    G.P.aimX = x;
    G.P.aimZ = z;
    aim.targetY=Math.max(water.renderHeight?.(x,z,G.time)??water.height(x,z,G.time),terrainH(x,z));
    aim.hasSurface=aim.range<=G.P.gun.range;aim.onSea=terrainH(x,z)<=aim.targetY;
    requestAimSync();
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
      aim.targetY=water.renderHeight?.(t.x,t.z,G.time)??water.height(t.x,t.z,G.time);
      aim.hasSurface=aim.range<=P.gun.range;aim.onSea=true;requestAimSync();
    }
  },
  zoom: (v: number) => {
    cameraControls.exitFollow();
    cameraControls.bridge = false;
    cameraControls.level = v > 0 ? 4 : 0;
    requestAimSync();
  },
  zoomLevel: (v: number) => { cameraControls.exitFollow(); cameraControls.bridge=false; cameraControls.level=v;requestAimSync(); },
  freeLook: (v: number) => {
    if (v) cameraControls.beginFreeLook(aim.yaw,.22);
    else {cameraControls.endFreeLook();requestAimSync();}
  },
  group: (v: number) => { cameraControls.group=v; cameraControls.level=2; G.inspect=0;requestAimSync(); },
  follow: () => toggleProjectileCamera(),
  /** Same code path as the mouse: dx > 0 must swing the view to the right. */
  turn: (dx: number, dy: number) => {
    aimDelta(dx, dy);
  },
  /** Where a world point lands on screen, for checking the aim feels the right way round. */
  screenOf: (x: number, y: number, z: number) => {
    tmpV.set(x, y, z).project(camera);
    return [((tmpV.x + 1) / 2) * window.innerWidth, ((1 - tmpV.y) / 2) * window.innerHeight, tmpV.z];
  },
  cam: (v: number) => {
    cameraControls.exitFollow();
    cameraControls.bridge = !!v;
    G.camMode = v ? 'bridge' : 'chase';
    requestAimSync();
  },
  throttle: (v: number) => {
    if (G.P) G.P.throttle = clamp(v, 0, 6);
  },
  inspect: (v: number) => {
    G.inspect = v;
    if(!v)requestAimSync();
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
  /** Cosmetic test at the loaded gun's actual muzzle; no ammo, reload or damage changes. */
  muzzle: (cal: number) => {
    const P = G.P;
    if (!P) return;
    const gun = P.mainTurrets[0];
    const index = P.turrets.indexOf(gun);
    if (!gun) return;
    water.update(G.time, camera.position);
    for (let tube = 0; tube < gun.ts.n; tube++) {
      const p = views.get(P.id)?.muzzlePose(index, tube);
      if (p) {
        fx.muzzle(p.x, p.y, p.z, p.bearing, cal || gun.gun.cal, p.elevation);
        water.blast(p.x, p.z, cal || gun.gun.cal, Math.max(0,p.y-water.height(p.x,p.z,G.time)));
      }
    }
    sfx.gun(cal || gun.gun.cal, 60, true,{barrels:gun.ts.n,secondary:false});
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
