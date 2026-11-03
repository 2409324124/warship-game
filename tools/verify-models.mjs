// Repeatable Vite/browser acceptance: node tools/verify-models.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new globalThis.URL('../', import.meta.url));
const URL = 'http://127.0.0.1:5173/';
const EDGE = process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = resolve(ROOT, 'art/blender/qa');
const SHIPS = ['us_bb', 'us_ca', 'us_dd', 'jp_bb', 'jp_ca', 'jp_dd'];
const GUNS = ['us5s', 'us5d', 'us6t', 'us8t', 'us16t', 'jp5d', 'jp5s', 'jp55', 'jp8d', 'jp14d', 'jp6c'];
const EXPECTED = [...SHIPS.map((key) => `ships/${key}_super`), 'ships/jp_bb_hull', 'ships/us_bb_hull',
  'ships/us_dd_hull', 'ships/jp_dd_hull', ...GUNS.map((key) => `guns/${key}`)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverReady() {
  try {
    return (await fetch(URL, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverReady()) return;
  // Start-Process detaches Vite so the same server is available to npm run smoke.
  const parent = ROOT.replaceAll("'", "''");
  const command = `$ErrorActionPreference = 'Stop'; if (!(Test-Path -LiteralPath '${parent}' -PathType Container)) { throw 'Project parent missing' }; Start-Process -FilePath 'cmd.exe' -WorkingDirectory '${parent}' -ArgumentList '/c npm run dev -- --host 127.0.0.1 --port 5173 --strictPort' -WindowStyle Hidden`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  assert.equal(result.status, 0, `Cannot start Vite: ${result.stderr || result.error || ''}`);
  for (let i = 0; i < 60; i++) {
    if (await serverReady()) return;
    await wait(1000);
  }
  throw new Error(`Vite did not become ready at ${URL}`);
}

await ensureServer();
assert.ok(existsSync(resolve(ROOT, 'art/blender')), 'Screenshot parent art/blender must exist');
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--mute-audio',
    '--window-size=1440,900',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`);
  });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__debug?.().models.available.length > 0);

  const report = await page.evaluate(async ({ shipKeys, expected }) => {
    const [{ World }, { Ship }, { ShipView }, THREE, assets, models, { deckY }, { muzzleWorld }] = await Promise.all([
      import('/src/sim/world.ts'),
      import('/src/sim/ship.ts'),
      import('/src/render/shipView.ts'),
      import('/node_modules/three/build/three.module.js'),
      import('/src/render/assets.ts'),
      import('/src/render/models.ts'),
      import('/src/sim/hull.ts'),
      import('/src/sim/gunnery.ts'),
    ]);
    await models.loadModelManifest();
    const failures = [];
    const check = (condition, message) => { if (!condition) failures.push(message); };
    const available = window.__debug().models.available;
    for (const name of expected) check(available.includes(name), `Manifest missing ${name}`);
    const scene = new THREE.Scene();
    const world = new World();
    const entries = shipKeys.map((key) => {
      const ship = world.add(new Ship(world, key, key.startsWith('us') ? 'US' : 'JP', `QA ${key}`));
      const view = new ShipView(scene, ship);
      return { key, ship, view, originalChildren: [...view.group.children], originalBarrels: view.turrets.map((t) => t.barrel) };
    });
    const used = [...new Set(entries.flatMap(({ key, ship }) => [
      `ships/${key}_super`, ...(models.hasModel(`ships/${key}_hull`)?[`ships/${key}_hull`]:[]),
      ...ship.spec.tur.map((t) => `guns/${t.kind}`),
    ]))];
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      const loaded = window.__debug().models.loaded;
      ready = used.every((name) => loaded.includes(name)) && entries.every(({ view }) =>
        !view.group.getObjectByName(`struct:${view.ship.key}`)?.visible &&
        view.turrets.every((t) => t.base.parent !== t.pivot && t.barrel.name === 'barrel') &&
        (!models.hasModel(`ships/${view.ship.key}_hull`) || view.group.getObjectByName(`hull:${view.ship.key}`)?.visible===false));
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    check(ready, `Timed out waiting for used models/overrides; unloaded: ${used.filter((name) => !window.__debug().models.loaded.includes(name)).join(', ')}`);
    const unused = expected.filter((name) => name.startsWith('guns/') && !used.includes(name));
    // Explicitly cover unused guns as well as models mounted by the six ShipViews.
    await Promise.all(unused.map((name) => assets.loadModel(name)));
    const sources = new Map(await Promise.all(expected.map(async (name) => [name, await assets.loadModel(name)])));
    const meshCount = (root) => {
      let count = 0;
      root?.traverse((node) => { if (node.isMesh) count++; });
      return count;
    };
    for (const [name, source] of sources) {
      check(!!source && meshCount(source) > 0, `${name}: GLB missing or empty`);
      if (!name.startsWith('guns/')) continue;
      const base = source?.getObjectByName('base');
      const barrel = source?.getObjectByName('barrel');
      check(!!base && !!barrel, `${name}: GLB must contain exact base/barrel node names`);
      check(!!base?.parent && base.parent === barrel?.parent, `${name}: base/barrel must be siblings`);
      check(meshCount(base) > 0 && meshCount(barrel) > 0, `${name}: base/barrel must contain meshes`);
      if (base && barrel) {
        check(base.position.length() < 0.0001, `${name}: base origin is not ring centre`);
        check(Math.abs(barrel.rotation.x) + Math.abs(barrel.rotation.y) + Math.abs(barrel.rotation.z) < 0.0001,
          `${name}: barrel has an unbaked rest rotation`);
        const origin = barrel.position.clone();
        const probe = barrel.clone(true);
        probe.rotation.x = -Math.PI / 6;
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(probe.quaternion);
        check(forward.y > 0.49 && probe.position.distanceTo(origin) < 0.0001,
          `${name}: positive elevation must raise the bore without moving its trunnion`);
      }
    }
    const ships = entries.map(({ key, ship, view, originalChildren, originalBarrels }) => {
      check(view.group.parent === scene, `${key}: ShipView missing from independent scene`);
      for (const part of ['struct', 'dark']) {
        check(view.group.getObjectByName(`${part}:${key}`)?.visible === false, `${key}: procedural ${part} not hidden`);
      }
      const source = sources.get(`ships/${key}_super`);
      const mounted = view.group.children.filter((child) => !originalChildren.includes(child));
      const mountedSuper=mounted.find((child)=>child.userData.overrideRole!=='hull');
      const hasHull=models.hasModel(`ships/${key}_hull`);
      check(mounted.length === (hasHull?2:1) && mountedSuper?.name === source?.name && meshCount(mountedSuper) === meshCount(source) && meshCount(source) > 0,
        `${key}: super GLB not mounted directly on ship group`);
      for (const part of ['hull','deck','rails']) {
        check(view.group.getObjectByName(`${part}:${key}`)?.visible===!hasHull,`${key}: procedural ${part} visibility incorrect`);
      }
      if (hasHull) {
        const hull=mounted.find((child)=>child.userData.overrideRole==='hull');
        const node=hull?.getObjectByName('visual_hull');
        const caseCount=key==='jp_bb'?8:0;
        check(node?.userData.casemateCount===caseCount,`${key}: incorrect casemate hull metadata`);
        if (key === 'jp_dd') {
          let integrated = false;
          mountedSuper?.traverse((o) => { if (o.isMesh && o.userData.embeddedPerimeterRails && o.userData.railHeight >= .8) integrated = true; });
          check(integrated, `${key}: approved integrated deck rails missing`);
        } else {
          const rails=hull?.getObjectByName('visual_rails');
          check(rails?.userData.physicalRailings===true,`${key}: actual guard rails not exported`);
          const railStats=JSON.parse(rails?.userData.railStats??'{}');
          check(railStats.posts>(key === 'us_dd' ? 80 : 100) && railStats.height>=1,`${key}: incomplete perimeter guards`);
        }
        if (key.endsWith('_dd')) {
          const deck = JSON.parse(node?.userData.deckStations ?? '[]');
          check(deck.length > 3 && deck.every(([s, y]) => Math.abs(deckY(ship.spec, (s-.5)*ship.spec.L)-y)<1e-9),
            `${key}: rendered and simulation deck stations differ`);
          const bounds = new THREE.Box3().setFromObject(node);
          check(Math.abs(bounds.max.x-bounds.min.x-ship.spec.B)<.001 && Math.abs(bounds.max.z-bounds.min.z-ship.spec.L)<.001,
            `${key}: wrong destroyer dimensions`);
          view.update(0,0,{height:()=>0});
          const pose = view.muzzlePose(0, 0);
          check(pose && Number.isFinite(pose.y) && pose.y > 0, `${key}: invalid loaded visual muzzle pose`);
          const expectedMuzzle = muzzleWorld(ship, ship.mainTurrets[0], 0);
          check(pose && new THREE.Vector3(pose.x,pose.y,pose.z).distanceTo(new THREE.Vector3(...expectedMuzzle))<1e-5,
            `${key}: actual GLB muzzle disagrees with the simulation`);
        }
        if(key==='us_bb'){
          const bounds=new THREE.Box3().setFromObject(node);
          check(Math.abs(bounds.max.x-bounds.min.x-33)<.001 && Math.abs(bounds.max.z-bounds.min.z-222)<.001,
            'Washington visual hull dimensions changed');
          check(bounds.max.y>11.9,'Washington raised bow still not in the loaded game hull');
        }
        const ports=JSON.parse(node?.userData.casematePorts??'[]');
        const ray=new THREE.Raycaster();
        hull?.updateMatrixWorld(true);
        for (const p of ports) {
          ray.set(new THREE.Vector3(p.side*21,p.axis_y,p.z),new THREE.Vector3(-p.side,0,0));
          const hit=ray.intersectObject(hull,true)[0];
          check(!!hit && Math.abs(hit.point.x)<p.surface_x-1,`${key}: port ${p.mount} is still covered`);
        }
        const foam=view.group.getObjectByName(`foam:${key}`);
        check(foam.geometry.index.count>0,`${key}: exported waterline foam missing`);
      }
      view.turrets.forEach((t, i) => {
        const label = `${key} turret ${i} (${ship.spec.tur[i].kind})`;
        check(t.base.parent === null && !t.pivot.children.includes(t.base), `${label}: procedural base still attached`);
        const base = t.pivot.children.find((child) => child.name === 'base');
        check(!!base && base.parent === t.pivot, `${label}: GLB base parent incorrect`);
        check(t.barrel.name === 'barrel' && t.barrel.parent === t.pivot, `${label}: GLB barrel name/parent incorrect`);
        check(originalBarrels[i].parent === null && t.barrel !== originalBarrels[i], `${label}: procedural barrel not replaced`);
      });
      if (key==='jp_bb') {
        ship.mainTurrets.forEach((t)=>{t.elev=Math.PI/2;});
        view.update(0,0,{height:()=>0});
        ship.mainTurrets.forEach((_,i)=>check(Math.abs(view.turrets[i].barrel.rotation.x+Math.PI/4)<1e-6,
          `${key}: visual main elevation exceeds 45 degrees`));
      }
      return { key, turrets: view.turrets.length, superNodes: mounted.map((child) => child.name) };
    });
    // A running Vite HMR session can expose two timestamped asset modules:
    // ShipView's live cache and this explicitly imported acceptance cache.
    // Every source above was inspected; count real loads from either cache.
    const loaded = [...new Set([...window.__debug().models.loaded,...assets.loadedModels()])];
    for (const name of expected) check(loaded.includes(name), `Debug loaded missing ${name}`);
    // Detach the isolated fixtures; never add them to the actual game renderer/world.
    entries.forEach(({ view }) => view.dispose(scene));
    return { expected: expected.length, available, used, unused, loaded, ships, failures };
  }, { shipKeys: SHIPS, expected: EXPECTED });

  // Real game screenshots, independent of the non-rendered acceptance fixtures above.
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__debug?.().player && window.__debug().mode === 'play');
  await page.waitForFunction(()=>window.__debug().models.loaded.includes('ships/us_bb_hull'));
  await page.evaluate(() => window.__cmd.inspect(2));
  await wait(1800);
  const screenshots = [resolve(OUT, 'verify-models-broadside.png'), resolve(OUT, 'verify-models-orbit.png')];
  await page.screenshot({ path: screenshots[0] });
  await page.evaluate(() => window.__cmd.inspect(1));
  await wait(2500);
  await page.screenshot({ path: screenshots[1] });
  await page.evaluate(()=>window.__cmd.inspect(3));await wait(1800);
  screenshots.push(resolve(OUT,'verify-washington-bow-rails.png'));
  await page.screenshot({path:screenshots.at(-1)});
  // Exercise the Japanese hull as well, not only the US/player hull. The story is US-only,
  // so this uses the dev solo hook rather than a menu faction switch.
  await page.reload({waitUntil:'networkidle2'});
  await page.evaluate(()=>window.__cmd.solo('jp_bb'));
  await page.waitForFunction(()=>window.__debug?.().mode==='play' &&
    ['ships/jp_bb_hull','ships/jp_bb_super','guns/jp14d','guns/jp6c'].every((name)=>window.__debug().models.loaded.includes(name)));
  await page.evaluate(()=>window.__cmd.inspect(2));await wait(2200);
  screenshots.push(resolve(OUT,'verify-kirishima-broadside.png'));
  await page.screenshot({path:screenshots.at(-1)});
  await page.evaluate(()=>window.__cmd.inspect(1));await wait(2200);
  screenshots.push(resolve(OUT,'verify-kirishima-orbit.png'));
  await page.screenshot({path:screenshots.at(-1)});
  await page.evaluate(()=>{window.__cmd.inspect(0);window.__cmd.cam(1);});await wait(1800);
  screenshots.push(resolve(OUT,'verify-kirishima-bridge.png'));
  await page.screenshot({path:screenshots.at(-1)});
  const bridgeProbe=await page.evaluate(()=>{window.__cmd.probeView();return window.__probe;});
  const centre=bridgeProbe.find((p)=>p.x===0&&p.y===0);
  assert.ok(centre && !centre.hit?.startsWith('game_jp_bb_super'),'New island blocks the bridge-view crosshair');
  await page.evaluate(()=>window.__cmd.inspect(3));await wait(1800);
  screenshots.push(resolve(OUT,'verify-kirishima-bow-rails.png'));
  await page.screenshot({path:screenshots.at(-1)});
  console.log(JSON.stringify({ ...report, errors, screenshots }, null, 2));
  assert.deepEqual(report.failures, [], 'Model acceptance failed (see report above)');
  assert.deepEqual(errors, [], 'Browser errors (see report above)');
  console.log(`PASS: six ShipViews, all ${EXPECTED.length} models, recessed hulls, 45-degree elevation, and ${screenshots.length} actual game screenshots.`);
} finally {
  await browser.close();
}
