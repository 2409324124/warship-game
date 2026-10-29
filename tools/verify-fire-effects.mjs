// Controlled acceptance of the real game components: node tools/verify-fire-effects.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ORIGIN = 'http://127.0.0.1:5173/';
const OUT = resolve(ROOT, 'art/blender/qa');
const EDGE = process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CASES = [
  { key: 'us_bb', cal: 406, tubes: 3 }, { key: 'jp_bb', cal: 356, tubes: 2 },
  { key: 'us_dd', cal: 127, tubes: 1 }, { key: 'jp_dd', cal: 127, tubes: 2 },
];
const report = { url: ORIGIN, timestep: 0.005, seaTime: 0, seed: 0x51f1a7,
  console: [], pageErrors: [], shaderErrors: [], networkErrors: [], failures: [], ships: [], screenshots: [] };
assert.ok((await fetch(ORIGIN, { signal: AbortSignal.timeout(5000) })).ok, 'Existing Vite server must be running');
assert.ok(existsSync(resolve(ROOT, 'art/blender')), 'Missing output parent art/blender');
mkdirSync(OUT, { recursive: true });
let browser;
try {
  browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: [
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio',
    '--window-size=1440,900',
  ] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.setDefaultTimeout(90000);
  page.on('console', (m) => report.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => report.pageErrors.push(e.message));
  page.on('requestfailed', (r) => report.networkErrors.push(`${r.url()}: ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) report.networkErrors.push(`${r.status()} ${r.url()}`); });
  // Keep the Vite origin/module resolution, but do not start a second running game loop.
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) {
      void r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0;overflow:hidden"></body></html>' });
    } else void r.continue();
  });
  await page.goto(ORIGIN, { waitUntil: 'networkidle0' });
  await page.evaluate(async ({ seed, dt }) => {
    // Use exactly Vite's optimized Three URL (including its version query), so fixtures
    // and game modules share one Three instance instead of importing the raw build twice.
    const engineSource = await (await fetch('/src/render/engine.ts')).text();
    const threeURL = engineSource.match(/from\s*["']([^"']*\/three[^"']*)["']/)?.[1];
    if (!threeURL) throw new Error('Cannot resolve the game engine Three module URL');
    const [{ World }, { Ship }, { ShipView }, { FX }, THREE, models, assets, { createWater }, engine] = await Promise.all([
      import('/src/sim/world.ts'), import('/src/sim/ship.ts'), import('/src/render/shipView.ts'),
      import('/src/render/fx.ts'), import(threeURL),
      import('/src/render/models.ts'), import('/src/render/assets.ts'), import('/src/render/water.ts'),
      import('/src/render/engine.ts'),
    ]);
    await models.loadModelManifest();
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 900);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const shaderErrors = [];
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, program, vs, fs) => shaderErrors.push({
      program: gl.getProgramInfoLog(program), vertex: gl.getShaderInfoLog(vs), fragment: gl.getShaderInfoLog(fs),
    });
    const scene = new THREE.Scene();
    scene.background = engine.FOG_COLOR.clone();
    scene.fog = new THREE.FogExp2(engine.FOG_COLOR, engine.FOG_DENSITY);
    scene.add(new THREE.HemisphereLight(0xbcd2e8, 0x2b3a44, 0.75));
    const sun = new THREE.DirectionalLight(0xffc9a0, 2.4);
    sun.position.copy(engine.SUN_DIR).multiplyScalar(4000);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb0d0, 0.35);
    fill.position.set(600, 500, -700); scene.add(fill);
    const water = createWater(scene, engine.FOG_DENSITY);
    const camera = new THREE.PerspectiveCamera(40, 1440 / 900, 0.5, 90000);
    const fx = new FX(scene);
    const world = new World();
    const failures = [];
    const check = (ok, message) => { if (!ok) failures.push(message); };
    // Only synchronous fixture construction/emission uses this RNG. Always restore before yielding.
    const seeded = (fn) => {
      const original = Math.random;
      let state = seed >>> 0;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      try { return fn(); } finally { Math.random = original; }
    };
    const render = () => { water.update(0, camera.position); renderer.render(scene, camera); return renderer.info.render.calls; };
    window.__fireQA = { THREE, models, assets, world, scene, camera, renderer, water, fx, Ship, ShipView,
      seeded, render, check, failures, shaderErrors, dt, time: 0, current: null };
  }, { seed: report.seed, dt: report.timestep });

  for (const test of CASES) {
    const entry = await page.evaluate(async (test) => {
      const q = window.__fireQA;
      const { scene, world, Ship, ShipView, models, assets, fx, camera, THREE, check } = q;
      if (q.current) q.current.view.dispose(scene);
      fx.reset();
      const ship = q.seeded(() => world.add(new Ship(world, test.key, test.key.startsWith('us') ? 'US' : 'JP', `Fire QA ${test.key}`, { x: 0, z: 0, heading: 0, speedFrac: 0 })));
      const view = new ShipView(scene, ship);
      const children = [...view.group.children];
      const barrels = view.turrets.map((t) => t.barrel);
      const used = [...new Set([`ships/${test.key}_hull`, `ships/${test.key}_super`, ...ship.spec.tur.map((t) => `guns/${t.kind}`)])];
      const sources = await Promise.all(used.map(async (name) => ({ name, available: models.hasModel(name), source: await assets.loadModel(name) })));
      const ready = () => ['hull', 'struct', 'dark', 'deck', 'rails'].every((p) => view.group.getObjectByName(`${p}:${test.key}`)?.visible === false)
        && view.turrets.every((t, i) => t.barrel !== barrels[i] && t.barrel.name === 'barrel' && t.base.parent === null);
      const deadline = Date.now() + 60000;
      while (!ready() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      check(ready(), `${test.key}: timed out waiting for actual GLB overrides`);
      const meshes = (o) => { let n = 0; o?.traverse((c) => { if (c.isMesh) n++; }); return n; };
      const mounted = view.group.children.filter((o) => !children.includes(o));
      const coverage = sources.map(({ name, available, source }) => {
        const attached = name.startsWith('ships/')
          ? mounted.some((o) => o.name === source?.name && meshes(o) === meshes(source))
          : view.turrets.filter((_, i) => `guns/${ship.spec.tur[i].kind}` === name).every((t) => t.barrel.name === 'barrel' && t.pivot.children.some((o) => o.name === 'base'));
        check(available && meshes(source) > 0 && attached, `${test.key}: GLB not really mounted: ${name}`);
        return { name, available, meshCount: meshes(source), attached };
      });
      const turretIndex = ship.turrets.map((t, i) => ({ t, i })).filter(({ t }) => !t.sec).sort((a, b) => b.t.z - a.t.z)[0].i;
      const turret = ship.turrets[turretIndex];
      turret.rel = Math.PI / 2; turret.elev = 5 * Math.PI / 180;
      check(turret.ts.n === test.tubes && turret.gun.cal === test.cal, `${test.key}: unexpected caliber/tube count`);
      view.update(0, 0, q.water);
      const poses = Array.from({ length: turret.ts.n }, (_, i) => view.muzzlePose(turretIndex, i));
      check(poses.every((p) => p && Object.values(p).every(Number.isFinite)), `${test.key}: invalid muzzle pose`);
      check(new Set(poses.map((p) => JSON.stringify(p))).size === test.tubes, `${test.key}: coincident tube poses`);
      const centre = new THREE.Vector3(poses[0].x + (test.cal > 200 ? 12 : 5), poses[0].y + (test.cal > 200 ? 10 : 4), poses[0].z - 4);
      // Same camera for every time sample of this ship; close enough to resolve smoke texture.
      camera.position.copy(centre).add(new THREE.Vector3(test.cal > 200 ? 110 : 64, test.cal > 200 ? 48 : 28, test.cal > 200 ? 130 : 76));
      camera.lookAt(centre); camera.updateMatrixWorld(true);
      const baselineCalls = q.render();
      const randomBefore = Math.random;
      q.seeded(() => poses.forEach((p) => fx.muzzle(p.x, p.y, p.z, p.bearing, test.cal, p.elevation)));
      check(Math.random === randomBefore, `${test.key}: RNG not restored`);
      q.current = { ship, view, poses, baselineCalls }; q.time = 0;
      return { ...test, turretIndex, coverage, poses, baselineCalls, samples: [] };
    }, test);
    const stages = [{ time: 0.035, stage: 'flash' }, { time: 0.6, stage: 'smoke' },
      { time: 2, stage: 'light-gray' }, ...(test.cal === 127 ? [{ time: 3.2, stage: 'clear-dd' }] : []),
      { time: 6, stage: 'residual' }, { time: 13, stage: 'clear' }];
    for (const stage of stages) {
      const sample = await page.evaluate(({ time, stage }) => {
        const q = window.__fireQA;
        // Fixed 5 ms increments hit all requested sample times exactly (integer step counts).
        const steps = Math.round((time - q.time) / q.dt);
        for (let i = 0; i < steps; i++) q.fx.update(q.dt, q.time + (i + 1) * q.dt, [], []);
        q.time = time;
        const calls = q.render(), stats = q.fx.stats();
        q.check(stats.muzzle.drawCalls <= 2, `${q.current.ship.key}/${stage}: muzzle exceeds two draw calls`);
        q.check(calls <= q.current.baselineCalls + 2, `${q.current.ship.key}/${stage}: renderer draw-call growth exceeds two`);
        if (time === 0.035) q.check(stats.muzzle.flash > 0 && stats.muzzle.smoke > 0, `${q.current.ship.key}: missing flash/smoke`);
        if (time === 6 && q.current.ship.gun.cal > 200) q.check(stats.muzzle.smoke > 0, `${q.current.ship.key}: no BB residual at 6s`);
        if (time === 13 || (time === 3.2 && q.current.ship.gun.cal === 127)) q.check(stats.muzzle.smoke === 0 && stats.muzzle.flash === 0, `${q.current.ship.key}: not clear at ${time}s`);
        return { time, stage, stats, rendererCalls: calls, rendererCallDelta: calls - q.current.baselineCalls };
      }, stage);
      const path = resolve(OUT, `fire-${test.key}-${stage.stage}.png`);
      await page.screenshot({ path });
      entry.samples.push({ ...sample, screenshot: path }); report.screenshots.push(path);
    }
    entry.reset = await page.evaluate(() => {
      const q = window.__fireQA;
      // Reset a live effect, rather than only testing already-expired smoke.
      q.seeded(() => q.current.poses.forEach((p) => q.fx.muzzle(p.x, p.y, p.z, p.bearing, q.current.ship.gun.cal, p.elevation)));
      q.fx.update(q.dt, 0, [], []);
      const before = q.fx.stats();
      q.fx.reset(); const after = q.fx.stats(); q.render();
      q.check(before.muzzle.smoke > 0 && after.particles === 0 && after.columns === 0 && after.shells === 0
        && after.torpedoWakePoints === 0 && ['smoke', 'flash', 'drawCalls', 'smokeSpawned', 'flashSpawned', 'smokeRecycled', 'flashRecycled'].every((k) => after.muzzle[k] === 0), `${q.current.ship.key}: reset not zero`);
      return { before, after };
    });
    if (test.cal === 127) {
      await page.evaluate(() => {
        const q = window.__fireQA, L = q.current.ship.spec.L;
        q.camera.position.set(L * 0.85, L * 0.43, L * 0.7);
        q.camera.lookAt(0, 7, 0); q.render();
      });
      const path = resolve(OUT, `fire-${test.key}-whole.png`);
      await page.screenshot({ path }); report.screenshots.push(path); entry.wholeShipScreenshot = path;
    }
    report.ships.push(entry);
  }
  Object.assign(report, await page.evaluate(() => ({ failures: window.__fireQA.failures, shaderErrors: window.__fireQA.shaderErrors })));
  report.failures.push(...report.pageErrors.map((s) => `pageerror: ${s}`),
    ...report.console.filter((m) => m.type === 'error').map((m) => `console: ${m.text}`),
    ...report.networkErrors.map((s) => `network: ${s}`), ...report.shaderErrors.map((s) => `shader: ${JSON.stringify(s)}`));
} catch (error) {
  report.failures.push(error.stack || String(error));
} finally {
  if (browser) await browser.close();
  report.passed = report.failures.length === 0 && report.ships.length === CASES.length;
  const path = resolve(OUT, 'verify-fire-effects-report.json');
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, report: path, screenshots: report.screenshots, failures: report.failures }, null, 2));
}
assert.ok(report.passed, 'Fire effects acceptance failed; see art/blender/qa/verify-fire-effects-report.json');
