// Existing Vite server required. Run: node tools/verify-ocean-camera.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(ROOT, 'art/blender/qa');
const ORIGIN = 'http://127.0.0.1:5173/';
const EDGE = process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const report = { screenshots: [], failures: [], observations: [], console: [], pageErrors: [], networkErrors: [],
  shaderErrors: [], renderer: 'Edge / ANGLE SwiftShader; no hardware FPS claim', timestep: 0.005 };
const check = (ok, message) => { if (!ok) report.failures.push(message); };
const serverReady = async () => {
  try { return (await fetch(ORIGIN, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};
let browser;
try {
  const typecheck = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit'],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  report.typecheck = { status: typecheck.status, stdout: typecheck.stdout, stderr: typecheck.stderr };
  check(typecheck.status === 0, 'Current game typecheck failed');
  if (!await serverReady()) {
    assert.ok(existsSync(ROOT), 'Missing Vite working directory');
    const server = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      { cwd: ROOT, detached: true, stdio: 'ignore' });
    server.unref();
    report.startedVite = true;
    for (let i = 0; i < 60 && !await serverReady(); i++) await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(await serverReady(), 'Vite server unavailable');
  assert.ok(existsSync(resolve(ROOT, 'art/blender')), 'Missing screenshot parent');
  mkdirSync(OUT, { recursive: true });
  browser = await puppeteer.launch({ executablePath: EDGE, headless: true, protocolTimeout: 300000,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio', '--window-size=1440,900'] });
  const newPage = async (label) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('console', (m) => report.console.push({ page: label, type: m.type(), text: m.text() }));
    page.on('pageerror', (e) => report.pageErrors.push({ page: label, text: e.message }));
    page.on('requestfailed', (r) => report.networkErrors.push({ page: label, url: r.url(), error: r.failure()?.errorText }));
    page.on('response', (r) => { if (r.status() >= 400) report.networkErrors.push({ page: label, url: r.url(), status: r.status() }); });
    return page;
  };
  const screenshot = async (page, name, details = {}) => {
    const path = resolve(OUT, name);
    await page.screenshot({ path, timeout: 180000 });
    report.screenshots.push({ path, ...details });
  };

  // Real main.ts, real HUD and camera. Gate only browser frame delivery, never simulation constants.
  // This prevents software rendering / screenshot latency from missing a short-lived blast.
  const game = await newPage('game');
  await game.evaluateOnNewDocument(() => {
    const callbacks = new Map(); let id = 0, clock = performance.now();
    window.requestAnimationFrame = (fn) => { callbacks.set(++id, fn); return id; };
    window.cancelAnimationFrame = (key) => callbacks.delete(key);
    const probe = { frames: 0, shaderErrors: [], blastUploads: [], maxBlastCount: 0 };
    window.__oceanGameQA = { probe, step(n, delta = 50) {
      for (let i = 0; i < n; i++) {
        clock += delta;
        const pending = [...callbacks.values()]; callbacks.clear();
        for (const fn of pending) fn(clock);
        probe.frames++;
      }
    } };
    // Observe actual GPU uploads without exposing or replacing the game's scene/Water.
    for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!C) continue;
      const proto = C.prototype, locations = new WeakMap();
      const getLocation = proto.getUniformLocation, uniform = proto.uniform1i;
      proto.getUniformLocation = function (program, name) {
        const location = getLocation.call(this, program, name);
        if (location && name === 'uBlastCount') locations.set(location, name);
        return location;
      };
      proto.uniform1i = function (location, value) {
        if (location && locations.has(location)) {
          probe.maxBlastCount = Math.max(probe.maxBlastCount, value);
          probe.blastUploads.push({ frame: probe.frames, value });
        }
        return uniform.call(this, location, value);
      };
      const compile = proto.compileShader, link = proto.linkProgram;
      proto.compileShader = function (shader) {
        compile.call(this, shader);
        if (!this.getShaderParameter(shader, this.COMPILE_STATUS)) probe.shaderErrors.push(this.getShaderInfoLog(shader));
      };
      proto.linkProgram = function (program) {
        link.call(this, program);
        if (!this.getProgramParameter(program, this.LINK_STATUS)) probe.shaderErrors.push(this.getProgramInfoLog(program));
      };
    }
  });
  await game.goto(ORIGIN, { waitUntil: 'networkidle2', timeout: 180000 });
  await game.waitForFunction(() => !!window.__debug && !!window.__cmd, { polling: 200 });
  await game.click('#startBtn');
  // main creates ShipViews on the first battle frame, which starts the GLB requests.
  await game.evaluate(() => window.__oceanGameQA.step(1));
  await game.waitForFunction(() => window.__debug().mode === 'play' && window.__debug().models.loaded.includes('ships/us_bb_hull')
    && window.__debug().models.loaded.includes('guns/us16t'), { polling: 200 });
  const stepGame = async (n) => {
    for (let i = 0; i < n; i += 5) await game.evaluate((count) => window.__oceanGameQA.step(count), Math.min(5, n - i));
  };
  await stepGame(30);
  report.game = { wide: await game.evaluate(() => window.__debug()) };
  const wide = report.game.wide;
  report.game.framing = await game.evaluate(async () => {
    const [{ chaseFraming }, { SPECS }] = await Promise.all([
      import('/src/render/chaseCamera.ts'), import('/src/sim/ships.ts'),
    ]);
    const spec = SPECS[window.__debug().ship];
    return { ...chaseFraming(spec, innerWidth / innerHeight, 0), length: spec.L };
  });
  const framing = report.game.framing;
  check(Math.abs(wide.camera.fov - 54) < 0.15 && Math.abs(wide.camera.fov - framing.fov) < 0.15,
    `Real default centered chase FOV unexpected: ${wide.camera.fov}`);
  check(['x', 'y', 'z', 'fov'].every((k) => Number.isFinite(wide.camera[k])), 'Game camera is not finite');
  // Exterior framing follows authoritative aim yaw, including after a mouse turn.
  // Debug player coordinates are rounded; allow camera easing and metre rounding.
  const cameraOffset = (snapshot) => {
    const heading = snapshot.cameraControl.aimYaw;
    const x = snapshot.camera.x - snapshot.player.x, z = snapshot.camera.z - snapshot.player.z;
    return { lateral: x * Math.cos(heading) - z * Math.sin(heading),
      aft: -x * Math.sin(heading) - z * Math.cos(heading), fov: snapshot.camera.fov };
  };
  const checkExterior = (snapshot, label) => {
    const control = snapshot.cameraControl, offset = cameraOffset(snapshot);
    check(control.mode === 'ship' && control.level === 0 && control.freeLook === false && control.follow === null,
      `${label}: expected level 0 ship camera without free look/follow`);
    check(Number.isFinite(control.aimYaw) && Number.isFinite(control.aimRange), `${label}: invalid camera aim state`);
    check(Math.abs(offset.lateral - framing.shoulder) < 2, `${label}: chase is not centered: ${offset.lateral}m`);
    check(Math.abs(offset.aft - framing.back) < 5, `${label}: aft distance differs from chaseFraming: ${offset.aft}m`);
    check(Math.abs(snapshot.camera.y - framing.height) < 5, `${label}: height differs from chaseFraming: ${snapshot.camera.y}m`);
    check(Math.abs(snapshot.camera.fov - framing.fov) < 0.15, `${label}: exterior FOV not restored`);
    return offset;
  };
  const wideOffset = cameraOffset(wide);
  report.game.centeredChase = { wide: wideOffset, lateralToleranceMetres: 2, distanceToleranceMetres: 5, scopeFovTolerance: 0.15 };
  check(framing.shoulder === 0, 'Default chaseFraming must be centered');
  checkExterior(wide, 'Default');
  await screenshot(game, 'ocean-game-wide.png', { scene: 'real game, default centered exterior chase, HUD', camera: wide.camera });
  await game.keyboard.press('Shift');
  await stepGame(35); // 1.75 simulated seconds: zoom and camera easing converge without changing game constants.
  report.game.scope = await game.evaluate(() => window.__debug());
  const scopeControl = report.game.scope.cameraControl;
  check(scopeControl.mode === 'binocular' && scopeControl.level === 4 && scopeControl.freeLook === false && scopeControl.follow === null,
    'Shift did not enter standard level 4 binocular mode without free look/follow');
  check(scopeControl.group === wide.cameraControl.group, 'Shift changed the selected weapon group');
  check(['x', 'y', 'z', 'fov'].every((k) => Number.isFinite(report.game.scope.camera[k])), 'Scope camera is not finite');
  // Scope uses the selected weapon-group anchor with geometry clearance, not spec.cam world coordinates.
  check(Math.abs(report.game.scope.camera.fov - 11) < 0.15, `Scope FOV did not converge to 11: ${report.game.scope.camera.fov}`);
  await game.keyboard.press('Shift');
  await stepGame(35);
  const restored = await game.evaluate(() => window.__debug());
  report.game.restored = restored;
  report.game.centeredChase.restored = checkExterior(restored, 'After scope');
  await game.evaluate(() => window.__cmd.turn(650, 0));
  await stepGame(35);
  report.game.side = await game.evaluate(() => window.__debug());
  check(Math.hypot(report.game.side.camera.x - wide.camera.x, report.game.side.camera.z - wide.camera.z) > 100,
    'Mouse turn did not move the real chase camera');
  report.game.centeredChase.side = checkExterior(report.game.side, 'Side view');
  check(Math.abs(report.game.side.cameraControl.aimYaw - restored.cameraControl.aimYaw) > 0.1,
    'Mouse turn did not update authoritative camera aim yaw');
  await screenshot(game, 'ocean-game-side.png', { scene: 'real game, __cmd.turn(650,0), centered exterior chase (not inspect)', camera: report.game.side.camera });
  report.game.firedImmediate = await game.evaluate(() => {
    const before = window.__debug().effects;
    window.__cmd.muzzle(406);
    return { before, after: window.__debug().effects };
  });
  await stepGame(4); // 0.2 simulated seconds, irrespective of SwiftShader wall-clock duration.
  report.game.fired = await game.evaluate(() => ({ debug: window.__debug(), gpu: window.__oceanGameQA.probe }));
  check(report.game.firedImmediate.after.muzzle.smoke > report.game.firedImmediate.before.muzzle.smoke, '__cmd.muzzle did not emit smoke');
  check(report.game.fired.gpu.maxBlastCount > 0, '__cmd.muzzle did not upload uBlastCount > 0 to actual game water');
  report.shaderErrors.push(...report.game.fired.gpu.shaderErrors);
  await screenshot(game, 'ocean-game-fired.png', { scene: 'real game / HUD, 0.2s after __cmd.muzzle(406)', camera: report.game.fired.debug.camera });
  await game.close();

  const page = await newPage('controlled');
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) void r.respond({ status: 200, contentType: 'text/html',
      body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0;overflow:hidden"><div id="label" style="position:fixed;bottom:18px;left:20px;z-index:2;color:#e2e9ef;background:#101a24c9;padding:8px 12px;font:15px monospace"></div></body></html>' });
    else void r.continue();
  });
  await page.goto(ORIGIN, { waitUntil: 'networkidle0', timeout: 180000 });
  report.controlled = await page.evaluate(async () => {
    const engineSource = await (await fetch('/src/render/engine.ts')).text();
    const threeURL = engineSource.match(/from\s*["']([^"']*\/three[^"']*)["']/)?.[1];
    if (!threeURL) throw new Error('Vite Three URL not found');
    const [THREE, { World }, { Ship }, { ShipView }, { FX }, { createWater }, ocean, { chaseFraming }, engine, models, assets] = await Promise.all([
      import(threeURL), import('/src/sim/world.ts'), import('/src/sim/ship.ts'), import('/src/render/shipView.ts'),
      import('/src/render/fx.ts'), import('/src/render/water.ts'), import('/src/render/oceanModel.ts'),
      import('/src/render/chaseCamera.ts'), import('/src/render/engine.ts'), import('/src/render/models.ts'), import('/src/render/assets.ts'),
    ]);
    const failures = [], check = (ok, text) => { if (!ok) failures.push(text); };
    const seeded = (fn) => {
      const original = Math.random; let state = 0x51f1a7;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      try { return fn(); } finally { Math.random = original; }
    };
    const canvas = document.createElement('canvas'); document.body.prepend(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(1440, 900);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const shaderErrors = [];
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, program, vs, fs) => shaderErrors.push({ program: gl.getProgramInfoLog(program),
      vertex: gl.getShaderInfoLog(vs), fragment: gl.getShaderInfoLog(fs) });
    const scene = new THREE.Scene(); scene.background = engine.FOG_COLOR.clone();
    scene.fog = new THREE.FogExp2(engine.FOG_COLOR, engine.FOG_DENSITY);
    scene.add(new THREE.HemisphereLight(0xbcd2e8, 0x2b3a44, 0.75));
    const sun = new THREE.DirectionalLight(0xffc9a0, 2.4);
    sun.position.copy(engine.SUN_DIR).multiplyScalar(4000); scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb0d0, 0.35); fill.position.set(600, 500, -700); scene.add(fill);
    const camera = new THREE.PerspectiveCamera(54, 1440 / 900, 0.5, 90000);
    const water = createWater(scene, engine.FOG_DENSITY);
    const existing = new Set(scene.children), fx = new FX(scene);
    const effectRoots = scene.children.filter((o) => !existing.has(o));
    await models.loadModelManifest();
    const world = new World(), ship = seeded(() => world.add(new Ship(world, 'us_bb', 'US', 'Ocean QA', { x: 0, z: 0, heading: 0, speedFrac: 0 })));
    const view = new ShipView(scene, ship);
    const used = [...new Set(['ships/us_bb_hull', 'ships/us_bb_super', ...ship.spec.tur.map((t) => `guns/${t.kind}`)])];
    await Promise.all(used.map((name) => assets.loadModel(name)));
    const ready = () => ['hull', 'deck', 'struct', 'dark', 'rails'].every((p) => view.group.getObjectByName(`${p}:us_bb`)?.visible === false)
      && view.turrets.every((t) => t.base.parent === null && t.barrel.name === 'barrel');
    const deadline = Date.now() + 60000;
    while (!ready() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    check(ready(), 'BB GLB overrides not mounted');
    const turret = ship.mainTurrets[0], turretIndex = ship.turrets.indexOf(turret);
    turret.rel = Math.PI / 2; turret.elev = 5 * Math.PI / 180;
    const uniforms = water.mesh.material.uniforms;
    const render = (time, label) => {
      water.update(time, camera.position); view.update(0, time, water);
      renderer.render(scene, camera); document.getElementById('label').textContent = label;
      check(Math.abs(uniforms.uTime.value - time) < 1e-8, 'Water CPU / shader time mismatch');
      return { time, shaderTime: uniforms.uTime.value, blastCount: uniforms.uBlastCount.value,
        drawCalls: renderer.info.render.calls, camera: { fov: camera.fov, x: camera.position.x, y: camera.position.y, z: camera.position.z } };
    };
    const framing = chaseFraming(ship.spec, camera.aspect, 0);
    const dx = Math.sin(ship.heading), dz = Math.cos(ship.heading);
    camera.fov = framing.fov;
    camera.position.set(ship.x - dx * framing.back + dz * framing.shoulder,
      framing.height, ship.z - dz * framing.back - dx * framing.shoulder);
    camera.lookAt(0, 26, 9000); camera.updateProjectionMatrix();
    const wide = render(0, `BB / centered chaseFraming / ${framing.fov}-degree elevated exterior / t=0`);
    // Projection of hull bounding box is diagnostic: a wide chase intentionally favours ocean scale.
    const bounds = new THREE.Box3().setFromObject(view.group);
    const projected = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z])
      projected.push(new THREE.Vector3(x, y, z).project(camera).toArray());
    const framingCases = [0.5, 1, 16 / 9, 2.4].flatMap((aspect) => [0, 1].map((zoom) => ({ aspect, zoom, ...chaseFraming(ship.spec, aspect, zoom) })));
    check(framingCases.every((v) => [v.fov, v.back, v.height, v.shoulder].every(Number.isFinite) && v.back > 0 && v.height > 0
      && v.shoulder === 0 && (v.zoom !== 1 || v.fov === 11)), 'Invalid centered chase/scope framing');
    window.__oceanQA = { THREE, ocean, scene, camera, renderer, water, uniforms, ship, view, fx, effectRoots,
      turret, turretIndex, seeded, check, failures, shaderErrors, render };
    return { models: used, glbMounted: ready(), framing, framingCases, wide, projectedHullBounds: projected,
      waterAPI: { sample: typeof water.sample, height: typeof water.height, blast: typeof water.blast, resetBlasts: typeof water.resetBlasts },
      waterVertices: water.mesh.geometry.attributes.position.count };
  });
  await screenshot(page, 'ocean-wide-chase.png', { scene: 'controlled actual BB / chaseFraming / far forward lookAt' });
  report.controlled.broadside = await page.evaluate(() => {
    const q = window.__oceanQA;
    q.camera.fov = 56; q.camera.position.set(215, 34, 155); q.camera.lookAt(0, 8, 10); q.camera.updateProjectionMatrix();
    return q.render(0, 'BB / low forward-quarter broadside / ambient gravity waves / t=0');
  });
  await screenshot(page, 'ocean-broadside-waves.png', { scene: 'controlled BB / forward-quarter / visible sea faces' });

  report.api = await page.evaluate(() => {
    const q = window.__oceanQA, o = q.ocean, checks = [];
    const test = (ok, name) => { checks.push({ name, passed: !!ok }); q.check(ok, name); };
    const pool = new o.OceanBlasts();
    test(o.BLAST_CAPACITY === 24 && pool.data.length === 96, 'Fixed 24-slot / 96-float pool');
    for (let i = 0; i < 40; i++) pool.blast(i, 0, 406, 10);
    test(pool.count === 24, 'Pool bounded after 40 simultaneous BB impulses');
    const previous = Array.from(pool.data);
    pool.blast(NaN, 0, 406); pool.blast(0, Infinity, 406); pool.blast(0, 0, -1); pool.blast(0, 0, NaN);
    test(JSON.stringify(previous) === JSON.stringify(Array.from(pool.data)), 'Invalid inputs do not corrupt pool');
    pool.blast(0, 0, 20, 100);
    test(JSON.stringify(previous) === JSON.stringify(Array.from(pool.data)), 'Weak equal-time shot cannot evict BB pressure');
    pool.update(0.5);
    test(pool.data[2] === 0.5, 'Pool stores age relative to birth');
    let maxHeight = 0, maxGradientError = 0;
    const eps = 0.001;
    for (let x = -30; x <= 60; x += 3) {
      const s = pool.sample(x, 4, 0.5); maxHeight = Math.max(maxHeight, Math.abs(s.height));
      const gradient = (pool.sample(x + eps, 4, 0.5).height - pool.sample(x - eps, 4, 0.5).height) / (2 * eps);
      maxGradientError = Math.max(maxGradientError, Math.abs(gradient - s.dx));
    }
    test(maxHeight <= o.BLAST_HEIGHT_CAP && maxGradientError < 0.0001, 'Saturated height cap and CPU analytic gradient');
    pool.update(4); test(pool.count === 0 && pool.data.every((v) => v === 0), 'Pressure expires and compacts at 4s');
    pool.blast(0, 0, 406); pool.update(3); test(pool.count === 0, 'Clock rewind clears pressure');
    pool.blast(0, 0, 406); pool.reset(); test(pool.count === 0 && pool.data.every((v) => v === 0), 'Pool reset clears all data');
    const ambient = [];
    for (const t of [0, 1, 1e6, 1e7]) {
      const s = o.sampleOcean(21, 73, t), a = o.sampleOcean(21 + eps, 73, t), b = o.sampleOcean(21 - eps, 73, t);
      const error = Math.abs((a.height - b.height) / (2 * eps) - s.dx); ambient.push({ t, sample: s, gradientError: error });
      test(Object.values(s).every(Number.isFinite) && error < 0.0001, `Ambient CPU finite/gradient at t=${t}`);
    }
    return { checks, maxHeight, maxGradientError, ambient };
  });

  // Independent float-target shader probe: compare actual OCEAN_GLSL outputs against CPU APIs.
  report.gpuCPU = await page.evaluate(() => {
    const q = window.__oceanQA, { THREE, ocean: o, renderer } = q;
    const floatSupported = renderer.extensions.has('EXT_color_buffer_float');
    q.check(floatSupported, 'Float framebuffer unavailable for GPU/CPU ocean comparison');
    if (!floatSupported) return { supported: false };
    const points = Array.from({ length: 32 }, (_, i) => new THREE.Vector2((i % 8) * 7 - 10, Math.floor(i / 8) * 11 + 55));
    const material = new THREE.ShaderMaterial({ uniforms: { ...q.uniforms, uProbe: { value: points } },
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: `precision highp float; ${o.OCEAN_GLSL}\nuniform vec2 uProbe[32]; void main(){vec2 p=uProbe[int(gl_FragCoord.x)]; gl_FragColor=oceanSurface(p)+blastSurface(p);}`,
      depthTest: false, depthWrite: false });
    const probeScene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    probeScene.add(mesh);
    const target = new THREE.WebGLRenderTarget(32, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const values = new Float32Array(32 * 4), rows = [];
    const mirror = new o.OceanBlasts();
    q.water.resetBlasts(); q.water.update(0, q.camera.position); q.view.update(0, 0, q.water);
    const poses = Array.from({ length: q.turret.ts.n }, (_, tube) => q.view.muzzlePose(q.turretIndex, tube));
    for (const p of poses) {
      const height = Math.max(0, p.y - q.water.height(p.x, p.z, 0));
      q.water.blast(p.x, p.z, 406, height); mirror.blast(p.x, p.z, 406, height);
    }
    for (const time of [0.2, 0.5, 1, 4, 1e6]) {
      q.water.update(time, q.camera.position); mirror.update(time);
      renderer.setRenderTarget(target); renderer.render(probeScene, q.camera);
      renderer.readRenderTargetPixels(target, 0, 0, 32, 1, values); renderer.setRenderTarget(null);
      let maxError = 0, maxWaterHeightError = 0;
      const fieldErrors = { height: 0, dx: 0, dz: 0, foam: 0 };
      points.forEach((p, i) => {
        const sea = o.sampleOcean(p.x, p.y, time), blast = mirror.sample(p.x, p.y, time);
        ['height', 'dx', 'dz', 'foam'].forEach((key, j) => {
          const error = Math.abs(values[i * 4 + j] - sea[key] - blast[key]);
          if (!Number.isFinite(error)) maxError = Infinity; else maxError = Math.max(maxError, error);
          fieldErrors[key] = Math.max(fieldErrors[key], error);
        });
        maxWaterHeightError = Math.max(maxWaterHeightError, Math.abs(q.water.height(p.x, p.y, time) - sea.height - blast.height));
      });
      rows.push({ time, shaderTime: q.uniforms.uTime.value, blastCount: q.uniforms.uBlastCount.value, maxError, fieldErrors, maxWaterHeightError });
      // GPU transcendental functions need not be JS-double exact. Require height within 1 mm,
      // dimensionless slopes/foam within 5e-4; retain measured errors, not only a pass flag.
      q.check(Number.isFinite(maxError) && fieldErrors.height < 0.001 && fieldErrors.dx < 0.0005
        && fieldErrors.dz < 0.0005 && fieldErrors.foam < 0.0005 && maxWaterHeightError < 1e-9,
      `GPU/CPU height/slope/foam mismatch at ${time}s: ${JSON.stringify(fieldErrors)}`);
    }
    target.dispose(); mesh.geometry.dispose(); material.dispose();
    q.water.resetBlasts(); q.check(q.uniforms.uBlastCount.value === 0 && q.uniforms.uBlasts.value.every((v) => v === 0), 'Water.resetBlasts not zero');
    return { supported: true, points: points.length, tolerance: { heightMetres: 0.001, slope: 0.0005, foam: 0.0005, waterCPUHeight: 1e-9 }, rows };
  });

  report.pressure = [];
  for (const time of [0.2, 0.5, 1, 4]) {
    for (const variant of ['clear', 'pressure-only', 'fired']) {
      const sample = await page.evaluate(({ time, variant }) => {
        const q = window.__oceanQA;
        q.water.resetBlasts(); q.fx.reset();
        q.water.update(0, q.camera.position); q.view.update(0, 0, q.water);
        const poses = Array.from({ length: q.turret.ts.n }, (_, tube) => q.view.muzzlePose(q.turretIndex, tube));
        const x = poses.reduce((n, p) => n + p.x, 0) / poses.length;
        const z = poses.reduce((n, p) => n + p.z, 0) / poses.length;
        q.camera.fov = 48; q.camera.position.set(x + 61, 74, z + 57);
        q.camera.lookAt(x + 11, 0, z); q.camera.updateProjectionMatrix();
        q.water.update(0, q.camera.position);
        const heights = poses.map((p) => Math.max(0, p.y - q.water.height(p.x, p.z, 0)));
        if (variant !== 'clear') q.seeded(() => poses.forEach((p, i) => {
          q.water.blast(p.x, p.z, 406, heights[i]);
          if (variant === 'fired') q.fx.muzzle(p.x, p.y, p.z, p.bearing, 406, p.elevation);
        }));
        for (let i = 0; i < Math.round(time / 0.005); i++) q.fx.update(0.005, (i + 1) * 0.005, [], []);
        const frame = q.render(time, `BB 406mm x3 / ${variant.toUpperCase()} / t=${time.toFixed(1)}s`);
        const gl = q.renderer.getContext(), pixels = new Uint8Array(1440 * 900 * 4);
        gl.readPixels(0, 0, 1440, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let pixelComparison = null;
        if (variant === 'clear') q.clearPixels = pixels;
        else {
          let changedPixels = 0, maxChannelDelta = 0, sumDelta = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            let delta = 0;
            for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(pixels[i + c] - q.clearPixels[i + c]));
            if (delta > 2) changedPixels++;
            sumDelta += delta; maxChannelDelta = Math.max(maxChannelDelta, delta);
          }
          pixelComparison = { changedPixelsAbove2: changedPixels, maxChannelDelta, meanMaxChannelDelta: sumDelta / (1440 * 900) };
          if (variant === 'pressure-only') q.check(time === 4 ? maxChannelDelta === 0 : changedPixels > 100,
            `Pressure/clear pixel comparison failed at ${time}s: ${JSON.stringify(pixelComparison)}`);
        }
        const diffs = [];
        for (let d = -8; d <= 8; d += 2) {
          const sx = x + 23 * time + d, sz = z + 3;
          diffs.push(q.water.height(sx, sz, time) - q.ocean.sampleOcean(sx, sz, time).height);
        }
        q.check(frame.blastCount === (variant === 'clear' || time >= 3.6 ? 0 : 3), `Unexpected triple-muzzle pressure count: ${time}/${variant}`);
        return { ...frame, variant, poses, muzzleClearances: heights, pixelComparison, maxHeightDelta: Math.max(...diffs.map(Math.abs)), effects: q.fx.stats() };
      }, { time, variant });
      const name = `ocean-pressure-${time.toFixed(1).replace('.', 'p')}s-${variant}.png`;
      await screenshot(page, name, { scene: variant === 'pressure-only' ? 'diagnostic: actual Water pressure, FX smoke omitted' : `controlled ${variant}`, time });
      report.pressure.push(sample);
    }
  }
  const end = await page.evaluate(() => {
    const q = window.__oceanQA;
    q.water.resetBlasts(); q.fx.reset();
    return { failures: q.failures, shaderErrors: q.shaderErrors, resetBlastCount: q.uniforms.uBlastCount.value, resetFX: q.fx.stats() };
  });
  report.failures.push(...end.failures); report.shaderErrors.push(...end.shaderErrors);
  report.reset = { blastCount: end.resetBlastCount, fx: end.resetFX };
  report.observations.push('Water currently exposes height(), not sample(); CPU comparison uses sampleOcean + OceanBlasts.sample and validates Water.height against the same time and GPU uniforms.',
    'Pressure-only diagnostics intentionally omit FX smoke; fired images include both real FX and Water pressure.',
    'Real-game frames use main.ts with HUD and chase camera; browser rAF delivery is gated in the tool to sample short effects without changing simulation parameters.',
    'Default and side exterior views use centered chaseFraming and level 0 ship state; Shift enters level 4 binocular mode at 11 degrees without free look/follow, preserves the weapon group, then restores level 0. Scope world coordinates follow the weapon-group anchor and geometry clearance, not the legacy spec.cam endpoint. Pressure close-ups intentionally crop the aft ship/masts to favour the water.',
    'Float GPU readback can emit SwiftShader ReadPixels GPU-stall warnings; these are captured separately from shader failures and do not constitute an FPS measurement.');
} catch (error) {
  report.failures.push(error.stack || String(error));
} finally {
  if (browser) await browser.close();
  report.failures.push(...report.pageErrors.map((e) => `pageerror: ${e.text}`),
    ...report.console.filter((m) => m.type === 'error').map((m) => `console: ${m.text}`),
    ...report.networkErrors.map((e) => `network: ${JSON.stringify(e)}`),
    ...report.shaderErrors.map((e) => `shader: ${JSON.stringify(e)}`));
  report.passed = report.failures.length === 0 && report.screenshots.length === 17;
  if (existsSync(OUT)) writeFileSync(resolve(OUT, 'verify-ocean-camera-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, report: resolve(OUT, 'verify-ocean-camera-report.json'),
    screenshots: report.screenshots.map((s) => s.path), failures: report.failures, observations: report.observations }, null, 2));
}
assert.ok(report.passed, 'Ocean/camera acceptance failed; see art/blender/qa/verify-ocean-camera-report.json');
