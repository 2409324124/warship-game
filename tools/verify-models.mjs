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
const EXPECTED = [...SHIPS.map((key) => `ships/${key}_super`), ...GUNS.map((key) => `guns/${key}`)];
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
    const [{ World }, { Ship }, { ShipView }, THREE, assets, models] = await Promise.all([
      import('/src/sim/world.ts'),
      import('/src/sim/ship.ts'),
      import('/src/render/shipView.ts'),
      import('/node_modules/three/build/three.module.js'),
      import('/src/render/assets.ts'),
      import('/src/render/models.ts'),
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
      `ships/${key}_super`, ...ship.spec.tur.map((t) => `guns/${t.kind}`),
    ]))];
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      const loaded = window.__debug().models.loaded;
      ready = used.every((name) => loaded.includes(name)) && entries.every(({ view }) =>
        !view.group.getObjectByName(`struct:${view.ship.key}`)?.visible &&
        view.turrets.every((t) => t.base.parent !== t.pivot && t.barrel.name === 'barrel'));
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
    }
    const ships = entries.map(({ key, ship, view, originalChildren, originalBarrels }) => {
      check(view.group.parent === scene, `${key}: ShipView missing from independent scene`);
      for (const part of ['struct', 'dark']) {
        check(view.group.getObjectByName(`${part}:${key}`)?.visible === false, `${key}: procedural ${part} not hidden`);
      }
      const source = sources.get(`ships/${key}_super`);
      const mounted = view.group.children.filter((child) => !originalChildren.includes(child));
      check(mounted.length === 1 && mounted[0].name === source?.name && meshCount(mounted[0]) === meshCount(source) && meshCount(source) > 0,
        `${key}: super GLB not mounted directly on ship group`);
      view.turrets.forEach((t, i) => {
        const label = `${key} turret ${i} (${ship.spec.tur[i].kind})`;
        check(t.base.parent === null && !t.pivot.children.includes(t.base), `${label}: procedural base still attached`);
        const base = t.pivot.children.find((child) => child.name === 'base');
        check(!!base && base.parent === t.pivot, `${label}: GLB base parent incorrect`);
        check(t.barrel.name === 'barrel' && t.barrel.parent === t.pivot, `${label}: GLB barrel name/parent incorrect`);
        check(originalBarrels[i].parent === null && t.barrel !== originalBarrels[i], `${label}: procedural barrel not replaced`);
      });
      return { key, turrets: view.turrets.length, superNodes: mounted.map((child) => child.name) };
    });
    const loaded = window.__debug().models.loaded;
    for (const name of expected) check(loaded.includes(name), `Debug loaded missing ${name}`);
    // Detach the isolated fixtures; never add them to the actual game renderer/world.
    entries.forEach(({ view }) => view.dispose(scene));
    return { expected: expected.length, available, used, unused, loaded, ships, failures };
  }, { shipKeys: SHIPS, expected: EXPECTED });

  // Real game screenshots, independent of the non-rendered acceptance fixtures above.
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__debug?.().player && window.__debug().mode === 'play');
  await page.evaluate(() => window.__cmd.inspect(2));
  await wait(1800);
  const screenshots = [resolve(OUT, 'verify-models-broadside.png'), resolve(OUT, 'verify-models-orbit.png')];
  await page.screenshot({ path: screenshots[0] });
  await page.evaluate(() => window.__cmd.inspect(1));
  await wait(2500);
  await page.screenshot({ path: screenshots[1] });
  console.log(JSON.stringify({ ...report, errors, screenshots }, null, 2));
  assert.deepEqual(report.failures, [], 'Model acceptance failed (see report above)');
  assert.deepEqual(errors, [], 'Browser errors (see report above)');
  console.log(`PASS: six ShipViews, all ${EXPECTED.length} models, turret hierarchy, and two actual game screenshots.`);
} finally {
  await browser.close();
}
