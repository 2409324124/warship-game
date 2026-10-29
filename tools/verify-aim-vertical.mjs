// REPRO: node tools/verify-aim-vertical.mjs
// After fixing the game: node tools/verify-aim-vertical.mjs --expect-fixed
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(ROOT, 'art/blender/qa');
const ORIGIN = 'http://localhost:5173';
const fixed = process.argv.includes('--expect-fixed');
const report = { phase: fixed ? 'EXPECT_FIXED' : 'REPRO', startedAt: new Date().toISOString(),
  origin: ORIGIN, checks: [], cases: {}, screenshots: [], pageErrors: [],
  audio: { asset: '/audio/navy-mk45-report.wav', expectedBytes: 247244, responses: [], salvos: {},
    scope: 'Actual live game Sfx.stats via __debug().audio and real own-main gun events from trusted left clicks. Edge --mute-audio may silence hardware output; no subjective listening claim, no offline Sfx instance.' },
  historicalRepro: { provenance: 'Preserved from prior conversation/tool stdout; OLD GAME DATA, not re-run against current game',
    bugReproduced: true, default: { upPitchDegrees: .09059904292844535, downPitchDegrees: -.2719911241043286,
      upRangeMetres: 10298.096074466448, downRangeMetres: -16564.453853729738 },
    binocularLevel4: { upPitchDegrees: .026505478942479982, downPitchDegrees: -.05737801334401657,
      upRangeMetres: 876.5925548532259, downRangeMetres: -1672.1155514352222 } },
  method: { input: 'Puppeteer Edge mouse.move, native pointer lock; no pointerLockElement shim or __cmd.turn',
    fixture: 'In-memory independent HTML route imports original main.ts; World.step captures World/Ship and only updates real turrets, freezing ship physics and AI. Original frame/input/render/viewport retained.',
    horizon: 'Actual camera geometric sea horizon at screen centre X, projected at infinity (not a HUD line or pixel-segmented haze boundary).',
    seaPoint: 'A fixed world-space mean-sea-level point, selected once per view at baseline; never follows aim.',
    frames: 'Controlled RAF, 50 ms steps; all original frame/input/camera updates retained, renderer instance skips intermediate draws and renders the final state once per batch. SwiftShader, no performance benchmark.',
    mousePackets: 'Each displacement uses 15 genuine mouse.move steps. A single 300px packet can clamp range to 250m and produce incidental large pitch; do not confuse that edge case with working pitch control.',
    thresholds: { meaningfulPitchDegrees: 1, visibleScreenChangePixels: 4 } },
  recommendedFix: [
    'src/main.ts aimDelta: vertical movement currently changes range, with no independent normal-aim pitch. Introduce bounded view/aim pitch with FOV-scaled input and correct up/down signs.',
    'src/main.ts updateCamera: tx=P.aimX; ty=26+P.bob; tz=P.aimZ constrains the view to a nearly horizontal distant target. Derive camera look direction from actual aiming yaw/pitch in default and binocular views.',
    'Keep ballistic turret elevation distinct from view pitch; derive sea aim/range consistently, including horizon and range-limit behavior. Re-run --expect-fixed against real input and projected world changes.'
  ] };
if(fixed)report.recommendedFix=[
  'Investigate real Shift/C sea-point drift: requestAimSync uses a fixed .65s window while camera position/anchor and visible wave height continue to change; preserve the world aim point until the camera transition actually settles.',
  'Investigate locked 1px vertical input: aimSurfaceHit can intersect foreground island terrain far short of the locked target and create excessive offRange, immediately breaking lock. Keep small vertical trim effective without losing target lock; retain intentional large-input release.',
  'Do not reintroduce range-only vertical acceptance: require actual camera direction, projected world/horizon movement, real sea projection and physical shell impacts.'
];
if (fixed && existsSync(resolve(OUT,'verify-aim-vertical-report.json'))) {
  const old=JSON.parse(readFileSync(resolve(OUT,'verify-aim-vertical-report.json'),'utf8'));
  if(old.cases?.['view-2']?.fine)report.priorExpandedRun={provenance:'Previous expanded run, not current re-run',startedAt:old.startedAt,
    failedChecks:old.checks.filter(c=>!c.passed),level2Fine:old.cases['view-2'].fine};
}
const check = (name, passed, evidence) => { report.checks.push({ name, passed: !!passed, evidence }); console.log(`${passed?'PASS':'FAIL'} ${name}`); if(!passed)writeFileSync(resolve(OUT,'verify-aim-vertical-report.json'),JSON.stringify(report,null,2)+'\n'); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ready = async () => { try { return (await fetch(ORIGIN, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };
let browser;
try {
  assert.ok(existsSync(resolve(ROOT, 'art/blender')));
  mkdirSync(OUT, { recursive: true });
  if (!await ready()) {
    const server = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', 'localhost', '--port', '5173', '--strictPort'],
      { cwd: ROOT, detached: true, stdio: 'ignore' });
    server.unref(); report.startedVite = true;
    for (let i = 0; i < 40 && !await ready(); i++) await wait(500);
  }
  assert.ok(await ready(), 'Vite localhost:5173 unavailable');
  console.log('Launching isolated Edge');
  browser = await puppeteer.launch({ executablePath: process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true, protocolTimeout: 180000, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio'] });
  report.browser = await browser.version();
  const page = await browser.newPage();
  const audioResponses = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname !== report.audio.asset) return;
    audioResponses.push((async () => {
      const evidence = { url: response.url(), status: response.status(), fromCache: response.fromCache(),
        contentType: response.headers()['content-type'] };
      try {
        const bytes = await response.buffer();
        evidence.bytes = bytes.length;
        evidence.riff = bytes.subarray(0, 4).toString('ascii');
        evidence.wave = bytes.subarray(8, 12).toString('ascii');
      } catch (e) { evidence.error = String(e); }
      report.audio.responses.push(evidence);
    })());
  });
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', e => {report.pageErrors.push(e.message);console.log('PAGE ERROR',e.message);});
  await page.evaluateOnNewDocument(() => {
    const callbacks = new Map(); let id = 0, clock = performance.now();
    window.requestAnimationFrame = fn => { callbacks.set(++id, fn); return id; };
    window.cancelAnimationFrame = id => callbacks.delete(id);
    window.__aimQA = { events: [], frames: 0, step(n) {
      for (let i = 0; i < n; i++) {
        clock += 50; const pending = [...callbacks.values()]; callbacks.clear();
        for (const fn of pending) fn(clock);
        this.frames++;
      }
    } };
    addEventListener('mousemove', e => window.__aimQA.events.push({ trusted: e.isTrusted,
      dx: e.movementX, dy: e.movementY, locked: document.pointerLockElement?.id ?? null }), true);
    window.__aimQA.buttons=[];
    for(const type of ['mousedown','mouseup'])addEventListener(type,e=>window.__aimQA.buttons.push({type,button:e.button,trusted:e.isTrusted,locked:document.pointerLockElement?.id??null}),true);
  });
  // Serve a test-only document; all application modules are fetched unchanged from Vite.
  const html = await (await fetch(ORIGIN)).text();
  const bootstrap = `<script type="module">
    import { updateTurrets } from '/src/sim/gunnery.ts';
    const mainText = await (await fetch('__MAIN_ENTRY__')).text();
    const worldURL = mainText.match(/from\\s*["']([^"']*sim\\/world\\.ts[^"']*)["']/)[1];
    const { World } = await import(worldURL);
    window.__aimQA.originalWorldStep = World.prototype.step;
    const ballisticsURL = (await (await fetch(worldURL)).text()).match(/from\\s*["']([^"']*gunnery\\.ts[^"']*)["']/)[1];
    const gunText = await (await fetch(ballisticsURL)).text();
    window.__aimQA.ballistics = await import(gunText.match(/from\\s*["']([^"']*ballistics\\.ts[^"']*)["']/)[1]);
    const terrainURL = mainText.match(/from\\s*["']([^"']*sim\\/terrain\\.ts[^"']*)["']/)[1];
    window.__aimQA.terrain = await import(terrainURL);
    window.__aimQA.simEvents = [];
    const emit = World.prototype.emit;
    World.prototype.emit = function(k,d) {
      window.__aimQA.simEvents.push({k,...d}); return emit.call(this,k,d);
    };
    const engineText = await (await fetch('/src/render/engine.ts')).text();
    const threeURL = engineText.match(/from\\s*["']([^"']*three[^"']*)["']/)[1];
    const THREE = await import(threeURL);
    window.__aimQA.THREE = THREE;
    window.__aimQA.renderEnabled = true;
    THREE.Scene.prototype.onBeforeRender = function(renderer) {
      const q=window.__aimQA;
      if(q.renderHooked)return;
      q.renderHooked=true;
      const render=renderer.render;
      renderer.render=function(...args){ if(q.renderEnabled)return render.apply(this,args); };
    };
    const originalLookAt = THREE.PerspectiveCamera.prototype.lookAt;
    THREE.PerspectiveCamera.prototype.lookAt = function(...args) {
      window.__aimQA.camera = this;
      return originalLookAt.apply(this, args);
    };
    World.prototype.step = function(dt) {
      window.__aimQA.world = this;
      window.__aimQA.player = this.ships.find(s => s.isPlayer);
      for (const s of this.ships) if (!s.removed) updateTurrets(s, dt);
    };
    await import('/src/main.ts');
  </script>`;
  const mainEntry = /<script type="module" src="(\/src\/main\.ts[^"]*)"><\/script>/;
  const entry = html.match(mainEntry);
  assert.ok(entry, 'Main entry changed; inspect fixture');
  const fixture = bootstrap.replace('__MAIN_ENTRY__', entry[1]).replace("await import('/src/main.ts')", `await import(${JSON.stringify(entry[1])})`);
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.isNavigationRequest() && r.url() === `${ORIGIN}/__qa_aim_vertical`) {
      void r.respond({ status: 200, contentType: 'text/html', body: html.replace(mainEntry, fixture) });
    } else void r.continue();
  });
  await page.goto(`${ORIGIN}/__qa_aim_vertical`, { waitUntil: 'networkidle2' });
  console.log('Fixture loaded');
  await page.waitForFunction(() => !!window.__debug && !!window.__cmd);
  await page.click('#startBtn');
  if (fixed) report.audio.afterRealStartClick = await page.evaluate(() => window.__debug().audio);
  const step = async (n = 20) => {
    await page.evaluate(count=>{const q=window.__aimQA;try{q.renderEnabled=false;q.step(Math.max(0,count-1));q.renderEnabled=true;q.step(1);}finally{q.renderEnabled=true;}},n);
  };
  await step(1);
  await page.waitForFunction(() => window.__debug().models.loaded.includes('ships/us_bb_hull')
    && window.__debug().models.loaded.includes('ships/us_bb_super') && window.__debug().models.loaded.includes('guns/us16t'), { polling: 200 });
  await step(24);
  // Start-button click normally locks natively. A real canvas click retries if required.
  if (!await page.evaluate(() => document.pointerLockElement?.id === 'gl')) {
    await page.mouse.click(720, 450); await wait(200);
  }
  report.pointerLock = await page.evaluate(() => ({ native: document.pointerLockElement === document.getElementById('gl'),
    ownGetterInjected: Object.hasOwn(document, 'pointerLockElement') }));
  assert.ok(report.pointerLock.native && !report.pointerLock.ownGetterInjected, 'Native pointer lock required; no fallback permitted');
  // Discard the initial lock warp before the baseline.
  let mouse = { x: 720, y: 450 };
  await page.mouse.move(mouse.x, mouse.y); await step();
  if (fixed) {
    report.method.setup = 'ONLY scene initialization after native lock warp: __cmd.aimAt(player.x, player.z+9000), then settle 24 real frames. All aiming thereafter uses trusted native mouse; no aimAt/turn/zoom/fire debug shortcuts.';
    report.method.readiness = 'Runtime readiness fixture sets forward turret reload=0 and disables aft reload; no 30s wait, no mocked fire. Native original World.step(dt,false) advances actual shells without rendering; ship physics temporarily frozen during flight.';
    await page.evaluate(() => { const p=window.__aimQA.player; window.__cmd.aimAt(p.x,p.z+9000); });
    await step(24);
  }
  const snap = async (resetPoint = false) => page.evaluate(reset => {
    const q = window.__aimQA, c = q.camera, p = q.player, T = q.THREE, d = c.getWorldDirection(new T.Vector3());
    c.updateMatrixWorld(true);
    const yaw = Math.atan2(d.x, d.z), pitch = Math.asin(d.y) * 180 / Math.PI;
    if (reset) q.seaPoint = [p.x + Math.sin(yaw) * 10000, 0, p.z + Math.cos(yaw) * 10000];
    const project = xyz => window.__cmd.screenOf(...xyz);
    const horizon = project([c.position.x + Math.sin(yaw) * 1e9, 0, c.position.z + Math.cos(yaw) * 1e9]);
    const dbg = window.__debug();
    return { frames: q.frames, mode: dbg.mode, level: dbg.cameraControl.level,
      nativePointerLock: document.pointerLockElement?.id === 'gl',
      camera: { position: c.position.toArray(), worldDirection: d.toArray(), pitchDegrees: pitch, yawRadians: yaw, fov: c.fov },
      horizon: { screenX: horizon[0], screenY: horizon[1] },
      seaPoint: { world: q.seaPoint, screen: project(q.seaPoint), screenY: project(q.seaPoint)[1] },
      aimRange: dbg.cameraControl.aimRange, aimYaw: dbg.cameraControl.aimYaw,
      player: { x: p.x, z: p.z, bob: p.bob, aimX: p.aimX, aimZ: p.aimZ, shots:p.stats.shots },
      control: dbg.cameraControl, seaProjection:dbg.seaProjection, lock:dbg.lock,
      aimPointScreen: dbg.cameraControl.aimPoint ? project(Object.values(dbg.cameraControl.aimPoint)) : null,
      terrainAtAim:q.terrain.terrainH(p.aimX,p.aimZ),
      mainTurret: p.mainTurrets.map(t => ({ elev: t.elev, rel: t.rel, inArc: t.inArc, onTarget:t.onTarget,reload:t.reload })),
      events: q.events.splice(0) };
  }, resetPoint);
  const shot = async name => { await page.screenshot({ path: resolve(OUT, name), timeout: 120000 }); report.screenshots.push(name); };
  const move = async (dx, dy) => {
    mouse.x += dx; mouse.y += dy;
    // Real incremental events avoid a single 300px packet clamping range to 250m,
    // which would confound ordinary aiming with a near-range camera singularity.
    await page.mouse.move(mouse.x, mouse.y, { steps: Math.min(15,Math.max(1,Math.abs(dx),Math.abs(dy))) }); await wait(30); await step();
    const s = await snap();
    const events = s.events.filter(e => e.locked === 'gl');
    s.requestedMovement = { dx, dy };
    s.observedMovement = { dx: events.reduce((n, e) => n + e.dx, 0), dy: events.reduce((n, e) => n + e.dy, 0) };
    check(`level ${s.level}: native trusted move ${dx},${dy}`, s.nativePointerLock && events.length > 0 && events.every(e => e.trusted)
      && s.observedMovement.dx === dx && s.observedMovement.dy === dy, s.observedMovement);
    return s;
  };
  const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  if (fixed) {
    const finite = s => [s.camera.pitchDegrees,s.aimRange,s.aimYaw,...s.camera.worldDirection,s.player.aimX,s.player.aimZ,...s.mainTurret.map(t=>t.elev)].every(Number.isFinite);
    const distance = (a,b) => Math.hypot(a.player.aimX-b.player.aimX,a.player.aimZ-b.player.aimZ);
    const baseline = await snap(true);
    report.cases.initialized = baseline;
    check('Initialized default looks at valid 9km sea, not sky', baseline.camera.pitchDegrees<0 && baseline.control.hasSurface && baseline.control.onSea && Math.abs(baseline.aimRange-9000)<600,baseline);
    const wheel = async dy => { await page.mouse.wheel({deltaY:dy}); await wait(40); await step(24); };
    const level = async wanted => {
      if ((await snap()).control.mode==='bridge') {await page.keyboard.press('KeyV');await step(24);}
      for(let i=0;i<6 && (await snap()).level!==wanted;i++) await wheel((await snap()).level<wanted?-120:120);
    };
    const sea = async (range=9000) => {
      // Compute desired sea angle, then physically move mouse to it. This is NOT an aim command.
      for(let i=0;i<3;i++) {
        const s=await snap(), h=s.camera.position[1], back=Math.hypot(s.camera.position[0]-s.player.x,s.camera.position[2]-s.player.z);
        const desired=-Math.atan2(h,range+back)*180/Math.PI;
        const dy=Math.round((s.camera.pitchDegrees-desired)/(0.0022*(s.camera.fov/55)*180/Math.PI));
        if(dy) await move(0,dy); else break;
      }
      return snap(true);
    };
    for(const wanted of [0,1,2,3,4,5,'bridge']) {
      if(wanted==='bridge'){await level(0);await page.keyboard.press('KeyV');await step(24);}else await level(wanted);
      const b=await sea(), big=wanted===0||wanted===4, amount=big?150:60;
      const c=report.cases[`view-${wanted}`]={baseline:b};
      if(wanted===0)await shot('p0-aim-before.png');
      c.up=await move(0,-amount);
      if(wanted===0)await shot('p0-aim-up.png');
      c.down=await move(0,amount*2);
      if(wanted===0)await shot('p0-aim-down.png');
      c.left=await move(-150,0);c.right=await move(150,0);
      c.deltas={upPitch:c.up.camera.pitchDegrees-b.camera.pitchDegrees,downPitch:c.down.camera.pitchDegrees-c.up.camera.pitchDegrees,
        upHorizon:c.up.horizon.screenY-b.horizon.screenY,downHorizon:c.down.horizon.screenY-c.up.horizon.screenY};
      check(`view ${wanted}: actual camera up/down and horizon move`, c.deltas.upPitch>1 && c.deltas.downPitch< -1 && c.deltas.upHorizon>4 && c.deltas.downHorizon< -4,c.deltas);
      check(`view ${wanted}: horizontal direction`,angleDelta(c.left.camera.yawRadians,c.down.camera.yawRadians)>.01 && angleDelta(c.right.camera.yawRadians,c.left.camera.yawRadians)<-.01);
      check(`view ${wanted}: finite and bounded pitch`,[b,c.up,c.down,c.left,c.right].every(s=>finite(s)&&s.camera.pitchDegrees>=-80.001&&s.camera.pitchDegrees<=65.001));
      await sea(5000);
      const f0=await snap(true), pixels=wanted>=3&&wanted<=5?4:1;
      const fu=await move(0,-pixels), fd=await move(0,pixels*2);
      c.fine={before:f0,up:fu,down:fd};
      check(`view ${wanted}: fine sea input changes actual ray/range/point in correct direction`,
        fu.camera.pitchDegrees>f0.camera.pitchDegrees && fd.camera.pitchDegrees<fu.camera.pitchDegrees && fu.aimRange>f0.aimRange && fd.aimRange<fu.aimRange
        && [f0,fu,fd].every(s=>s.control.hasSurface&&s.control.onSea&&s.seaProjection.visible&&s.seaProjection.valid),
        {ranges:[f0.aimRange,fu.aimRange,fd.aimRange],pitches:[f0.camera.pitchDegrees,fu.camera.pitchDegrees,fd.camera.pitchDegrees],projection:[f0.seaProjection,fu.seaProjection,fd.seaProjection]});
      check(`view ${wanted}: fine aim point lies on actual camera centre ray`,[f0,fu,fd].every(s=>s.aimPointScreen&&Math.hypot(s.aimPointScreen[0]-720,s.aimPointScreen[1]-450)<4),[f0.aimPointScreen,fu.aimPointScreen,fd.aimPointScreen]);
      check(`view ${wanted}: actual turret elevation responds to fine sea aim`,fu.mainTurret[0].elev>f0.mainTurret[0].elev && fd.mainTurret[0].elev<fu.mainTurret[0].elev,[f0,fu,fd].map(s=>s.mainTurret[0].elev));
      if(wanted===4)await shot('p0-aim-scope-sea.png');
    }
    await level(0);await sea();
    const sb=await snap();const sky=await move(0,-150);
    await page.evaluate(()=>window.__aimQA.player.mainTurrets.forEach(t=>t.reload=0));
    const skyReady=await snap();
    await page.mouse.click(mouse.x,mouse.y);const skyFired=await snap();
    report.cases.sky={before:sb,sky,ready:skyReady,afterClick:skyFired};
    check('Sky: real upward input hides sea projection',sky.camera.pitchDegrees>0&&!sky.control.hasSurface&&!sky.seaProjection.visible,sky.control);
    check('Sky: trusted left click consumes no reload or shots',skyFired.player.shots===skyReady.player.shots&&skyFired.mainTurret.every((t,i)=>t.reload===skyReady.mainTurret[i].reload));
    await sea();
    // Wait for REAL turret traverse using native updateTurrets, without rendering hundreds of frames.
    const readyGuns=async()=>page.evaluate(()=>{
      const q=window.__aimQA,p=q.player;
      for(let i=0;i<2000&&!p.mainTurrets.slice(0,2).some(t=>t.onTarget);i++)q.world.step(.05,true);
      p.mainTurrets.forEach((t,i)=>t.reload=i<2?0:9999);
      return p.mainTurrets.map(t=>({onTarget:t.onTarget,inArc:t.inArc,elev:t.elev,reload:t.reload}));
    });
    const fire=async(name)=>{
      const readiness=await readyGuns();check(`${name}: actual forward turret onTarget`,readiness.slice(0,2).some(t=>t.onTarget),readiness);
      const audioWaitStarted = Date.now();
      let loaded = true;
      try { await page.waitForFunction(() => window.__debug().audio?.loaded === true, { timeout: 5000, polling: 50 }); }
      catch { loaded = false; }
      const audioState = () => page.evaluate(() => ({ stats: window.__debug().audio,
        ownMainGunEvents: window.__aimQA.simEvents.filter(e => e.k === 'gun' && e.id === window.__aimQA.player.id && !e.sec).length }));
      const audioBefore = await audioState();
      check(`${name}: actual game recording decoded before real left click`, loaded && audioBefore.stats?.loaded === true,
        { waitedMilliseconds: Date.now() - audioWaitStarted, ...audioBefore });
      const aim=await snap();const before=await page.evaluate(()=>window.__aimQA.world.sseq);
      await page.mouse.click(mouse.x,mouse.y);
      const audioAfter = await audioState();
      const audio = { before: audioBefore.stats, after: audioAfter.stats,
        mainGunEvents: audioAfter.ownMainGunEvents - audioBefore.ownMainGunEvents,
        recordedDelta: audioAfter.stats?.recorded - audioBefore.stats?.recorded,
        fallbackDelta: audioAfter.stats?.fallback - audioBefore.stats?.fallback };
      report.audio.salvos[name] = audio;
      check(`${name}: real main gun events use recorded source without fallback`, audio.mainGunEvents > 0 && audio.recordedDelta > 0 && audio.fallbackDelta === 0, audio);
      const result=await page.evaluate(id=>{
        const q=window.__aimQA,p=q.player,w=q.world;
        const shots=w.shells.filter(s=>s.id>id&&s.owner===p&&!s.sec);
        const initial=shots.map(s=>({id:s.id,x0:s.x0,y0:s.y0,z0:s.z0,vx:s.vx,vy:s.vy,vz:s.vz,g:s.g,T:s.T,t:s.t,
          predicted:{x:s.x0+s.vx*s.T,z:s.z0+s.vz*s.T,y:s.y0+s.vy*s.T-.5*s.g*s.T*s.T},
          sigma:q.ballistics.dispersionAt(s.gun,Math.hypot(p.aimX-s.x0,p.aimZ-s.z0)),aim:{x:p.aimX,z:p.aimZ}}));
        const evStart=q.simEvents.length;
        const saved=w.ships.map(s=>[s,s.physics]);
        try{
          for(const [s]of saved)s.physics=()=>{};
          for(let i=0;i<20000&&shots.some(s=>s.alive);i++)q.originalWorldStep.call(w,.01,false);
        }finally{for(const[s,fn]of saved)s.physics=fn;}
        return {initial,final:shots.map(s=>({id:s.id,x:s.x,y:s.y,z:s.z,t:s.t,alive:s.alive})),events:q.simEvents.slice(evStart).filter(e=>['splash','hit','land'].includes(e.k)),
          ship:{x:p.x,z:p.z},shots:p.stats.shots};
      },before);
      result.aimState=aim;report.cases[name]=result;
      check(`${name}: real left click spawns physical shells at t=0`,result.initial.length>0&&result.initial.every(s=>s.t===0&&[s.x0,s.y0,s.z0,s.vx,s.vy,s.vz,s.g,s.T].every(Number.isFinite)),result.initial);
      check(`${name}: original World.step resolves actual splash/hit`,result.final.length>0&&result.final.every(s=>!s.alive)&&result.events.some(e=>e.k==='splash'||e.k==='hit'),result.events);
      const bounds=result.initial.map(s=>{
        const dx=s.aim.x-s.x0,dz=s.aim.z-s.z0,d=Math.hypot(dx,dz),ux=dx/d,uz=dz/d;
        const f=result.final.find(f=>f.id===s.id),ex=f.x-s.aim.x,ez=f.z-s.aim.z;
        const along=ex*ux+ez*uz,cross=-ex*uz+ez*ux;
        const radius=Math.hypot(along/s.sigma.along,cross/s.sigma.cross);
        const overshoot=Math.hypot(s.vx,s.vz)*.01;
        const ellipseWithStep=Math.hypot(along/(2.5*s.sigma.along+overshoot),cross/(2.5*s.sigma.cross+overshoot));
        const waveY=aim.control.aimPoint.y;
        const waveT=(s.vy+Math.sqrt(s.vy*s.vy+2*s.g*(s.y0-waveY)))/s.g;
        return{id:s.id,along,cross,radius,overshootMetres:overshoot,ellipseWithStep,visibleWaterY:waveY,
          waveVsMeanSeaFlightDifferenceSeconds:waveT-s.T,waveVsMeanSeaHorizontalDifferenceMetres:Math.hypot(s.vx,s.vz)*(waveT-s.T),
          aimHeightNote:'Aim traces visible wave height; ballistic solve/splash use mean y=0. Native 0.01s collision quantization included explicitly.'};
      });result.dispersionChecks=bounds;
      check(`${name}: actual impact within real 2.5 sigma tail plus native integration step`,bounds.length>0&&bounds.every(b=>b.ellipseWithStep<=1.001),bounds);
      result.meanImpactRange=result.final.reduce((n,s)=>n+Math.hypot(s.x-result.ship.x,s.z-result.ship.z),0)/result.final.length;
      return result;
    };
    await sea(9000);const first=await fire('salvo-first');await step(2);await shot('p0-aim-sea-first.png');
    await move(0,2);const second=await fire('salvo-down');await step(2);await shot('p0-aim-sea-down.png');
    await Promise.all(audioResponses);
    check('Actual game preload HTTP200 returns expected WAV bytes', report.audio.responses.some(r => r.status === 200
      && r.bytes === report.audio.expectedBytes && r.riff === 'RIFF' && r.wave === 'WAVE'), report.audio.responses);
    check('Second real salvo after pulling down lands closer',second.meanImpactRange<first.meanImpactRange,{first:first.meanImpactRange,second:second.meanImpactRange,aims:[first.aimState.aimRange,second.aimState.aimRange]});
    await sea(9000);
    const switching={before:await snap()};
    await page.keyboard.press('ShiftLeft');await step(24);switching.shift=await snap();
    await page.keyboard.press('KeyC');await step(24);switching.c=await snap();
    check('Shift/C preserve sea aim point without large jump',distance(switching.before,switching.shift)<250&&distance(switching.shift,switching.c)<250,{shift:distance(switching.before,switching.shift),c:distance(switching.shift,switching.c)});
    report.cases.switching=switching;
    const r0=await snap();await page.mouse.down({button:'right'});
    const ru=await move(0,-60),rd=await move(0,120),rl=await move(-60,0),rr=await move(120,0);
    report.cases.freeLook={before:r0,up:ru,down:rd,left:rl,right:rr};
    check('RMB real up/down/left/right leaves original gun aim point unchanged',[ru,rd,rl,rr].every(s=>distance(s,r0)<1e-6&&s.control.freeLook));
    check('RMB actual camera responds in both axes',Math.abs(ru.camera.pitchDegrees-rd.camera.pitchDegrees)>1&&Math.abs(angleDelta(rl.camera.yawRadians,rr.camera.yawRadians))>.01);
    await page.mouse.up({button:'right'});await step(24);check('Real mouseup clears free look',!(await snap()).control.freeLook);
    await page.mouse.down({button:'right'});await page.keyboard.press('Escape');await page.mouse.up({button:'right'});
    const esc=await snap();report.cases.escape=esc;check('Real Escape clears free look and pauses',!esc.control.freeLook&&esc.mode==='paused');
    await page.click('#resumeBtn');await wait(100);await step(24);
    // Real browser focus transition, not dispatchEvent(new Event('blur')).
    await page.evaluate(()=>{window.__aimQA.blurEvents=[];addEventListener('blur',e=>window.__aimQA.blurEvents.push({trusted:e.isTrusted}));});
    await page.mouse.down({button:'right'});
    const blank=await browser.newPage();await blank.bringToFront();await wait(150);
    report.cases.blur=await page.evaluate(()=>({events:window.__aimQA.blurEvents,control:window.__debug().cameraControl}));
    check('Browser blur is trusted and clears free look',report.cases.blur.events.some(e=>e.trusted)&&!report.cases.blur.control.freeLook,report.cases.blur);
    await blank.close();await page.bringToFront();await page.mouse.up({button:'right'});
    if((await snap()).mode==='paused')await page.click('#resumeBtn');
    if(!await page.evaluate(()=>document.pointerLockElement?.id==='gl'))await page.mouse.click(mouse.x,mouse.y);
    await step(24);await level(0);await sea();
    // Target-lock setup via actual mouse yaw/pitch to a real enemy, then actual X.
    const target=await page.evaluate(()=>{const q=window.__aimQA,p=q.player;const t=q.world.ships.filter(s=>s.team!==p.team&&s.alive).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];return t?{x:t.x,z:t.z}:null;});
    if(target){
      const s=await snap();const wanted=Math.atan2(target.x-s.camera.position[0],target.z-s.camera.position[2]);
      await move(Math.round(-angleDelta(wanted,s.camera.yawRadians)/(.0022*s.camera.fov/55)),0);await sea(Math.hypot(target.x-s.player.x,target.z-s.player.z));
      await page.keyboard.press('KeyX');await step(4);const locked=await snap();
      const trim=await move(0,1);await step(8);const held=await snap();
      report.cases.lock={locked,trim,held};
      check('Real X acquires target lock',!!locked.lock,locked.lock);
      check('Locked small vertical trim changes visible pitch and remains applied',!!trim.lock&&!!held.lock&&Math.abs(held.camera.pitchDegrees-locked.camera.pitchDegrees)>.005,{locked:locked.camera.pitchDegrees,trim:trim.camera.pitchDegrees,held:held.camera.pitchDegrees});
      if((await snap()).lock)await page.keyboard.press('KeyX');
      await level(4);await page.keyboard.press('KeyX');await step(8);
      const scopeLocked=await snap(),scopeTrim=await move(0,1);await step(8);const scopeHeld=await snap();
      report.cases.lock.scope={locked:scopeLocked,trim:scopeTrim,held:scopeHeld};
      check('Scope locked 1px trim remains locked and visibly changes actual pitch',!!scopeLocked.lock&&!!scopeTrim.lock&&!!scopeHeld.lock&&Math.abs(scopeHeld.camera.pitchDegrees-scopeLocked.camera.pitchDegrees)>.005,
        {locks:[scopeLocked.lock,scopeTrim.lock,scopeHeld.lock],pitch:[scopeLocked.camera.pitchDegrees,scopeTrim.camera.pitchDegrees,scopeHeld.camera.pitchDegrees]});
      const large=await move(0,-1000);report.cases.lock.large=large;check('Large real vertical input releases lock',!large.lock,large.lock);
    }else check('Real target available for lock',false);
    await level(0);
    const max=await move(0,-2000),min=await move(0,4000);
    report.cases.pitchBounds={max,min};
    check('Pitch extrema and no-hit range stay finite and bounded',finite(max)&&finite(min)&&Math.abs(max.camera.pitchDegrees-65)<.01&&Math.abs(min.camera.pitchDegrees+80)<.01&&!max.control.hasSurface,{maxPitch:max.camera.pitchDegrees,minPitch:min.camera.pitchDegrees,maxRange:max.aimRange,minRange:min.aimRange});
    report.buttonEvents=await page.evaluate(()=>window.__aimQA.buttons);
    report.audio.final = await page.evaluate(() => window.__debug().audio);
    check('All exercised mouse buttons are native trusted events',report.buttonEvents.length>0&&report.buttonEvents.every(e=>e.trusted),report.buttonEvents);
  } else {
  for (const [name, level] of [['default', 0], ['binocularLevel4', 4]]) {
    if (level === 4) { await page.keyboard.press('ShiftLeft'); await step(28); }
    const states = report.cases[name] = {};
    states.baseline = await snap(true);
    check(`${name}: expected view and unlocked target`, states.baseline.level === level && (await page.evaluate(() => window.__debug().lock === null)));
    if (!level) await shot('p0-aim-before.png');
    states.up = await move(0, -150);
    if (!level) await shot('p0-aim-up.png');
    states.down = await move(0, 300);
    if (!level) await shot('p0-aim-down.png');
    states.left = await move(-150, 0);
    states.right = await move(150, 0);
    const { baseline: b, up: u, down: d, left: l, right: r } = states;
    const delta = (a, b) => ({ pitchDegrees: a.camera.pitchDegrees - b.camera.pitchDegrees,
      horizonPixels: a.horizon.screenY - b.horizon.screenY, seaPointPixels: a.seaPoint.screenY - b.seaPoint.screenY,
      range: a.aimRange - b.aimRange, yawRadians: angleDelta(a.camera.yawRadians, b.camera.yawRadians) });
    states.deltas = { up: delta(u, b), down: delta(d, u), left: delta(l, d), right: delta(r, l) };
    const du = states.deltas.up, dd = states.deltas.down;
    states.verdict = { rangeChanged: Math.abs(du.range) > 1 && Math.abs(dd.range) > 1,
      verticalPitchTiny: Math.abs(du.pitchDegrees) < 1 && Math.abs(dd.pitchDegrees) < 1,
      fixedVertical: du.pitchDegrees > 1 && dd.pitchDegrees < -1 && du.horizonPixels > 4 && dd.horizonPixels < -4
        && du.seaPointPixels > 4 && dd.seaPointPixels < -4,
      horizontalCorrect: states.deltas.left.yawRadians > .01 && states.deltas.right.yawRadians < -.01 };
    check(`${name}: left/right direction correct`, states.verdict.horizontalCorrect, states.deltas);
    check(`${name}: ship translation frozen`, Object.values(states).filter(s => s.player).every(s => s.player.x === b.player.x && s.player.z === b.player.z));
    check(`${name}: ${fixed ? 'meaningful real up/down pitch and world projection' : 'BUG REPRODUCED: range changes but pitch remains tiny'}`,
      fixed ? states.verdict.fixedVertical : states.verdict.rangeChanged && states.verdict.verticalPitchTiny, states.verdict);
  }
  }
  check('Requested screenshot budget', report.screenshots.length === (fixed?6:3));
  check('No page errors', report.pageErrors.length === 0, report.pageErrors);
} catch (e) {
  report.error = e.stack || String(e);
} finally {
  if (browser) await Promise.race([browser.close(),wait(10000).then(()=>browser.process()?.kill())]);
  report.finishedAt = new Date().toISOString();
  report.passed = !report.error && report.checks.every(c => c.passed);
  report.bugReproduced = !fixed && report.passed;
  report.summary={checks:report.checks.length,failedChecks:report.checks.filter(c=>!c.passed).map(c=>c.name),
    meanPhysicalImpactRanges:fixed?[report.cases['salvo-first']?.meanImpactRange,report.cases['salvo-down']?.meanImpactRange]:null,
    switchingDrift: report.checks.find(c=>c.name==='Shift/C preserve sea aim point without large jump')?.evidence,
    lock1px: fixed ? { default: { locked: !!report.cases.lock?.locked.lock, after: !!report.cases.lock?.held.lock,
      pitchBefore: report.cases.lock?.locked.camera.pitchDegrees, pitchAfter: report.cases.lock?.held.camera.pitchDegrees },
      scope: { locked: !!report.cases.lock?.scope.locked.lock, after: !!report.cases.lock?.scope.held.lock,
        pitchBefore: report.cases.lock?.scope.locked.camera.pitchDegrees, pitchAfter: report.cases.lock?.scope.held.camera.pitchDegrees } } : null,
    audio: report.audio,
    acceptance:report.passed?'All checks for requested phase passed':'NOT ACCEPTED: retain failing functional checks; no thresholds relaxed'};
  writeFileSync(resolve(OUT, 'verify-aim-vertical-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase: report.phase, passed: report.passed, bugReproduced: report.bugReproduced,
    summary:report.summary,
    cases: Object.fromEntries(Object.entries(report.cases).map(([k, v]) => [k, { deltas: v.deltas, verdict: v.verdict }])),
    failures: report.checks.filter(c => !c.passed), error: report.error,
    report: resolve(OUT, 'verify-aim-vertical-report.json') }, null, 2));
}
if (!report.passed) process.exitCode = 1;
