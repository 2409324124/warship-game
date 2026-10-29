// Run: node tools/verify-camera-controls.mjs (uses/reuses Vite on localhost:5173).
// After inspecting PNGs: node tools/verify-camera-controls.mjs --review '<JSON array>'
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(ROOT, 'art/blender/qa');
const RESULT = resolve(OUT, 'verify-camera-controls-report.json');
const ORIGIN = 'http://localhost:5173/';
const EDGE = process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (process.argv[2] === '--review') {
  const report = JSON.parse(readFileSync(RESULT, 'utf8'));
  const review = JSON.parse(process.argv[3]);
  assert.ok(Array.isArray(review) && review.length === report.screenshots.length);
  for (const item of review) {
    assert.ok(report.screenshots.some((s) => s.name === item.name) && typeof item.finding === 'string');
    assert.ok(existsSync(resolve(OUT, item.name)));
  }
  assert.equal(new Set(review.map((r) => r.name)).size, review.length);
  report.visualReview = { status: 'images inspected', reviewedAt: new Date().toISOString(), images: review };
  writeFileSync(RESULT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: RESULT, passed: report.passed, visualReview: report.visualReview }, null, 2));
  process.exit(0);
}

const report = { startedAt: new Date().toISOString(), origin: ORIGIN, checks: [], failures: [], screenshots: [],
  snapshots: {}, console: [], pageErrors: [], networkErrors: [], limitations: [
    'Edge headless / ANGLE SwiftShader; no real-GPU FPS claim.',
    'Tool gates browser requestAnimationFrame at 50ms to sample short-lived projectiles. Game dt, simulation, camera and render code are unchanged.',
    'Debug API is used for read-only state assertions and aimAtNearest fixture setup; camera transitions and firing use browser keyboard/mouse input.',
  ], visualReview: { status: 'pending image inspection' } };
const check = (ok, name, evidence = null) => {
  report.checks.push({ name, passed: !!ok, evidence });
  if (!ok) report.failures.push(name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async () => { try { return (await fetch(ORIGIN, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
let browser, page;
try {
  assert.ok(existsSync(resolve(ROOT, 'art/blender')), 'Missing screenshot parent');
  mkdirSync(OUT, { recursive: true });
  if (!await ready()) {
    assert.ok(existsSync(resolve(ROOT, 'node_modules/vite/bin/vite.js')));
    const server = spawn(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', 'localhost', '--port', '5173', '--strictPort'],
      { cwd: ROOT, detached: true, stdio: 'ignore' });
    server.unref(); report.startedVite = true;
    for (let i = 0; i < 60 && !await ready(); i++) await wait(1000);
  }
  assert.ok(await ready(), 'Vite localhost:5173 unavailable');
  browser = await puppeteer.launch({ executablePath: EDGE, headless: true, protocolTimeout: 300000,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--mute-audio', '--window-size=1440,900'] });
  page = await browser.newPage();
  page.setDefaultTimeout(180000);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('console', (m) => report.console.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => report.pageErrors.push(e.message));
  page.on('requestfailed', (r) => report.networkErrors.push({ url: r.url(), error: r.failure()?.errorText }));
  page.on('response', (r) => { if (r.status() >= 400) report.networkErrors.push({ url: r.url(), status: r.status() }); });
  await page.evaluateOnNewDocument(() => {
    const callbacks = new Map(); let id = 0, clock = performance.now();
    window.requestAnimationFrame = (fn) => { callbacks.set(++id, fn); return id; };
    window.cancelAnimationFrame = (key) => callbacks.delete(key);
    window.__cameraQA = { frames: 0, input: {}, step(n) {
      for (let i = 0; i < n; i++) {
        clock += 50;
        const pending = [...callbacks.values()]; callbacks.clear();
        for (const fn of pending) fn(clock);
        this.frames++;
      }
    } };
    for (const type of ['keydown', 'keyup', 'wheel', 'mousedown', 'mouseup', 'mousemove']) {
      addEventListener(type, (e) => {
        const key = `${type}:${e.isTrusted ? 'trusted' : 'synthetic'}`;
        window.__cameraQA.input[key] = (window.__cameraQA.input[key] || 0) + 1;
      }, true);
    }
  });
  await page.goto(ORIGIN, { waitUntil: 'networkidle2', timeout: 180000 });
  await page.waitForFunction(() => !!window.__debug && !!window.__cmd);
  await page.click('#startBtn');
  const step = async (n = 24) => {
    for (let i = 0; i < n; i += 4) await page.evaluate((count) => window.__cameraQA.step(count), Math.min(4, n - i));
  };
  await step(1);
  const spawnPlayer = await page.evaluate(() => window.__debug().player);
  await page.waitForFunction(() => window.__debug().models.loaded.includes('ships/us_bb_hull')
    && window.__debug().models.loaded.includes('ships/us_bb_super') && window.__debug().models.loaded.includes('guns/us16t'), { polling: 200 });
  await step(30);
  const snap = async (name) => {
    const s = await page.evaluate(() => ({ ...window.__debug(), hud: document.getElementById('cameraMode')?.textContent,
      hudVisible: !!document.getElementById('cameraMode')?.getClientRects().length,
      pauseVisible: !document.getElementById('pause').hidden }));
    if (name) report.snapshots[name] = s;
    return s;
  };
  const shot = async (name) => {
    const state = await snap(name);
    await page.screenshot({ path: resolve(OUT, name), timeout: 180000 });
    report.screenshots.push({ name, path: resolve(OUT, name), camera: state.camera, control: state.cameraControl, hud: state.hud });
    console.log(`Captured ${name}`);
  };
  const key = async (code, frames = 0) => { await page.keyboard.press(code); if (frames) await step(frames); };
  const wheel = async (deltaY, frames = 0) => { await page.mouse.wheel({ deltaY }); await wait(40); if (frames) await step(frames); };
  const sameAim = (a, b, label) => check(Math.abs(a.cameraControl.aimYaw - b.cameraControl.aimYaw) < 1e-10
    && Math.abs(a.cameraControl.aimRange - b.cameraControl.aimRange) < 1e-7, label,
  { before: [a.cameraControl.aimYaw, a.cameraControl.aimRange], after: [b.cameraControl.aimYaw, b.cameraControl.aimRange] });
  const baseline = await snap('initial');
  check(baseline.mode === 'play' && baseline.cameraControl.level === 0 && baseline.cameraControl.mode === 'ship', 'Default level 0 exterior');
  check(Math.abs(baseline.camera.fov - 54) < .15, 'Default vertical FOV 54deg', baseline.camera);
  const travel = { x: baseline.player.x - spawnPlayer.x, z: baseline.player.z - spawnPlayer.z };
  const heading = Math.atan2(travel.x, travel.z);
  const offset = { x: baseline.camera.x - baseline.player.x, z: baseline.camera.z - baseline.player.z };
  const lateral = offset.x * Math.cos(heading) - offset.z * Math.sin(heading);
  const aft = -offset.x * Math.sin(heading) - offset.z * Math.cos(heading);
  check(Math.hypot(travel.x, travel.z) > 5 && Math.abs(lateral) < 2 && aft > 0 && baseline.camera.y > 20,
    'Default camera is centered above and behind hull (heading inferred from actual travel)', { travel, lateral, aft, y: baseline.camera.y });
  check(baseline.hudVisible && !!baseline.hud, 'cameraMode HUD is visible', baseline.hud);
  await shot('camera-default.png');

  // First try genuine lock. Only the read-only getter is shimmed if headless denies it.
  await page.mouse.move(720, 450);
  await page.mouse.click(720, 450);
  await wait(250);
  report.pointerLock = { native: await page.evaluate(() => document.pointerLockElement === document.getElementById('gl')) };
  if (!report.pointerLock.native) {
    await page.evaluate(() => Object.defineProperty(document, 'pointerLockElement', {
      configurable: true, get: () => document.getElementById('gl'),
    }));
    report.pointerLock.readOnlyGetterInjected = true;
    report.limitations.push('Native headless pointer lock failed: injected read-only document.pointerLockElement getter returning #gl. Browser-trusted mouse/keyboard events still traverse the actual DOM handlers; OS capture/release is not verified.');
  }
  // First click may have fired if native lock was already acquired at start. No frame has elapsed.
  for (let level = 1; level <= 5; level++) {
    const before = await snap(); await wheel(-120, 28); const after = await snap(`wheel-level-${level}`);
    check(after.cameraControl.level === level, `Negative wheel zooms to level ${level}`);
    sameAim(before, after, `Wheel level ${level} preserves unlocked aim`);
    if (level >= 3) check(Math.abs(after.camera.fov - ({ 3: 18, 4: 11, 5: 7.5 }[level])) < .2, `Level ${level} scope FOV`, after.camera.fov);
    if (level === 1) await shot('camera-near.png');
    if (level === 2) await shot('camera-weapon-front.png');
    if (level === 4) await shot('camera-binocular.png');
  }
  await wheel(-120); check((await snap()).cameraControl.level === 5, 'Wheel clamps at level 5');
  for (let level = 4; level >= 0; level--) {
    const before = await snap(); await wheel(120); const after = await snap();
    check(after.cameraControl.level === level, `Positive wheel pulls back to level ${level}`);
    sameAim(before, after, `Positive wheel level ${level} preserves aim`);
  }
  await wheel(120); check((await snap()).cameraControl.level === 0, 'Wheel clamps at level 0');
  for (const level of [1, 2]) {
    await wheel(-120);
    await key('ShiftLeft', 28);
    check((await snap()).cameraControl.level === 4, `Shift from ${level} enters standard binocular level 4`);
    await key('ShiftLeft', 28);
    check((await snap(`shift-return-${level}`)).cameraControl.level === level, `Shift restores non-binocular level ${level}`);
  }
  const g0 = (await snap()).cameraControl.group;
  await key('KeyC', 24);
  check((await snap()).cameraControl.group === g0 + 1, 'Short C selects next main turret');
  await key('KeyC', 24);
  check((await snap()).cameraControl.group === g0 + 2, 'Second short C selects aft turret');
  await shot('camera-weapon-aft.png');
  await key('KeyC', 2);
  check((await snap()).cameraControl.group === g0, 'Short C wraps turret group');
  const longC = async () => { await page.keyboard.down('KeyC'); await wait(850); await page.keyboard.up('KeyC'); await step(24); };
  await longC(); check((await snap()).cameraControl.level === 1, 'Long C exits weapon to previous exterior level');
  await longC(); check((await snap()).cameraControl.level === 2, 'Long C enters weapon view');
  await wheel(120); await wheel(120, 24);

  const freeBefore = await snap('free-before');
  await page.mouse.down({ button: 'right' });
  const freeStart = await snap();
  await page.mouse.move(1100, 390, { steps: 5 }); await step(24);
  const freeMoved = await snap('free-moved');
  check(freeMoved.cameraControl.freeLook && Math.abs(freeMoved.cameraControl.lookYaw - freeStart.cameraControl.lookYaw) > .1, 'RMB + real mousemove changes independent look yaw');
  sameAim(freeBefore, freeMoved, 'RMB movement preserves unlocked aim yaw/range');
  await shot('camera-free-look.png');
  await page.mouse.up({ button: 'right' });
  const released = await snap(); await step(1); const returnFirst = await snap(); await step(28); const returned = await snap('free-returned');
  check(!returned.cameraControl.freeLook, 'RMB release clears freeLook');
  const distance = (a, b) => Math.hypot(a.camera.x - b.camera.x, a.camera.y - b.camera.y, a.camera.z - b.camera.z);
  check(distance(released, returnFirst) > 0 && distance(returnFirst, returned) > distance(released, returnFirst), 'RMB release has multi-frame smooth camera return',
    { firstStepMetres: distance(released, returnFirst), remainingMetres: distance(returnFirst, returned) });
  sameAim(freeBefore, returned, 'RMB return preserves aim');
  // Broadside is an actual aiming turn, rather than an inspection-camera shortcut.
  await page.mouse.move(450, 390, { steps: 6 }); await step(28);
  const side = await snap('broadside');
  check(Math.abs(side.cameraControl.aimYaw - freeBefore.cameraControl.aimYaw) > .5, 'Unlocked real mousemove turns aim');
  await shot('camera-broadside.png');

  await key('KeyV', 28); check((await snap()).cameraControl.mode === 'bridge', 'V enters bridge');
  await shot('camera-bridge.png');
  await key('KeyV', 28); check((await snap()).cameraControl.mode === 'ship', 'V returns exterior');

  await page.evaluate(() => window.__cmd.aimAtNearest());
  await key('KeyX', 4);
  const locked = await snap('locked');
  check(!!locked.lock, 'X acquires nearest target after aim fixture');
  // No simulation frames here: automatic target tracking would legitimately change aim.
  await wheel(-120); const lockedWheel = await snap();
  sameAim(locked, lockedWheel, 'Wheel preserves locked aim (same simulation instant)');
  await page.mouse.down({ button: 'right' });
  const lockedStart = await snap();
  await page.mouse.move(700, 470, { steps: 4 }); const lockedMoved = await snap('locked-free-moved');
  sameAim(lockedStart, lockedMoved, 'RMB mousemove preserves locked aim (same simulation instant)');
  check(!!lockedMoved.lock && lockedMoved.cameraControl.freeLook
    && Math.abs(lockedMoved.cameraControl.lookYaw - lockedStart.cameraControl.lookYaw) > .1, 'Locked RMB look moves without breaking lock');
  await page.mouse.up({ button: 'right' }); await key('KeyX'); await wheel(120, 28);

  // Actual left click fires physical shells. Wait for reload/rotation using normal frames if needed.
  let fired;
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
    fired = await snap(`fire-${attempt}`);
    if (fired.cameraControl.projectiles.length >= 2) break;
    await step(30);
  }
  check(fired.cameraControl.projectiles.length >= 2, 'Real left click creates multiple live own main shells', fired.cameraControl.projectiles);
  assert.ok(fired.cameraControl.projectiles.length, 'No actual shells: cannot verify follow');
  const beforeFollow = fired.cameraControl;
  await key('KeyZ');
  const followed = await snap('follow-enter');
  check(followed.cameraControl.follow?.id === fired.cameraControl.projectiles[0].id, 'Z follows newest live own main projectile');
  await step(8); await shot('camera-shell-follow.png');
  const beforeCycle = await snap(); await key('KeyC'); const cycled = await snap('follow-cycle');
  const candidates = beforeCycle.cameraControl.projectiles.filter((p) => p.kind === beforeCycle.cameraControl.follow?.kind);
  const at = candidates.findIndex((p) => p.id === beforeCycle.cameraControl.follow?.id);
  check(cycled.cameraControl.follow?.id === candidates[(at + 1) % candidates.length]?.id
    && cycled.cameraControl.group === beforeCycle.cameraControl.group, 'C during follow selects next shell without changing turret');
  for (const code of ['Escape', 'ShiftLeft', 'KeyZ']) {
    if (!(await snap()).cameraControl.follow) await key('KeyZ');
    const before = await snap(); await key(code); const after = await snap(`follow-exit-${code}`);
    check(!!before.cameraControl.follow && !after.cameraControl.follow && after.mode === 'play' && !after.pauseVisible,
      `${code} exits follow without pausing`);
    check(after.cameraControl.level === beforeFollow.level && after.cameraControl.mode === beforeFollow.mode,
      `${code} only restores pre-follow view (no double toggle)`);
  }
  await key('KeyZ');
  const expiring = await snap(); let expiryFrames = 0;
  while ((await snap()).cameraControl.follow && expiryFrames < 900) { await step(10); expiryFrames += 10; }
  const expired = await snap('follow-expired');
  check(!!expiring.cameraControl.follow && !expired.cameraControl.follow && expired.mode === 'play', 'Projectile disappearance automatically returns camera', { expiryFrames });
  check(!expired.cameraControl.projectiles.some((p) => p.id === expiring.cameraControl.follow?.id && p.kind === expiring.cameraControl.follow?.kind), 'Followed projectile really expired (not force-deleted)');
  await step(28); await shot('camera-return.png');

  // Middle click must both fire and follow a NEW projectile, not just an old shell.
  report.middleAttempts = [];
  // Reload is ~30 simulation seconds (not compressed); allow 45s plus flight time.
  for (let attempt = 0; attempt < 30; attempt++) {
    const before = await snap();
    await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
    const after = await snap();
    report.middleAttempts.push({ attempt, time: after.time, mode: after.mode, follow: after.cameraControl.follow,
      beforeProjectiles: before.cameraControl.projectiles, afterProjectiles: after.cameraControl.projectiles });
    if (after.cameraControl.follow && !before.cameraControl.projectiles.some((p) => p.id === after.cameraControl.follow.id)) {
      report.snapshots['middle-fire-follow'] = after; break;
    }
    if (after.cameraControl.follow) await key('KeyZ');
    await step(30);
  }
  check(!!report.snapshots['middle-fire-follow'], 'Middle mouse fires a new main shell and follows it');

  // End-screen restart is normally hidden while playing. Invoke that existing button's
  // click handler as a fixture so startBattle receives a genuinely active follow/freeLook.
  // No camera state is written or mocked by the tool.
  report.limitations.push('Dirty-state restart uses DOM #againBtn.click() while its end screen is hidden, to exercise the existing startBattle handler with active follow/freeLook. Separate pause/menu/start coverage uses trusted real UI clicks.');
  const dirtyRestart = async (label) => {
    await snap(`dirty-restart-before-${label}`);
    await page.evaluate(() => document.getElementById('againBtn').click());
    const clean = await snap(`dirty-restart-after-${label}`);
    check(clean.mode === 'play' && clean.cameraControl.level === 0 && clean.cameraControl.group === 0
      && !clean.cameraControl.freeLook && !clean.cameraControl.follow && clean.cameraControl.projectiles.length === 0,
    `Restart handler directly clears active ${label} and old projectiles`);
    await step(28);
  };
  check(!!(await snap()).cameraControl.follow, 'Follow dirty state present immediately before restart handler');
  await dirtyRestart('follow');
  await page.mouse.down({ button: 'right' });
  check((await snap()).cameraControl.freeLook, 'Free-look dirty state present immediately before restart handler');
  await dirtyRestart('free-look');
  await page.mouse.up({ button: 'right' });

  // Use the real pause/menu/start UI to test a fresh battle with dirty transient state.
  // Follow is retained by pause, whereas RMB is cleared on pause; test each entry separately.
  const restart = async (label) => {
    // Escape from follow intentionally returns rather than pauses; pause via next Escape.
    if ((await snap()).cameraControl.follow) {
      await key('Escape'); check(!(await snap()).cameraControl.follow, `${label}: follow cleared on first Escape`);
    }
    await key('Escape'); check((await snap()).mode === 'paused', `${label}: normal Escape pauses`);
    await page.click('#quitBtn'); check((await snap()).mode === 'menu', `${label}: quit returns menu`);
    await page.click('#startBtn'); await step(28);
    const s = await snap(`restart-${label}`);
    check(s.mode === 'play' && s.cameraControl.level === 0 && s.cameraControl.group === 0
      && !s.cameraControl.freeLook && !s.cameraControl.follow, `${label}: restart resets free/follow/level/group`);
  };
  await restart('menu-start');
  await page.mouse.down({ button: 'right' });
  check((await snap()).cameraControl.freeLook, 'RMB dirty state present before restart');
  await restart('during-free-look');
  await page.mouse.up({ button: 'right' });

  // Explicit compatibility smoke, kept separate from the real-input acceptance above.
  await page.evaluate(() => window.__cmd.zoom(1));
  check((await snap()).cameraControl.level === 4, 'Debug API compatibility: zoom(1) selects standard binocular');
  await page.evaluate(() => window.__cmd.zoom(0));
  check((await snap()).cameraControl.level === 0, 'Debug API compatibility: zoom(0) selects exterior');

  // HUD is a required independent observable, not a proxy for debug state.
  const hudCases = ['camera-default.png', 'camera-near.png', 'camera-weapon-front.png', 'camera-binocular.png',
    'camera-free-look.png', 'camera-shell-follow.png', 'camera-bridge.png'];
  const hudTexts = hudCases.map((name) => ({ name, text: report.snapshots[name].hud }));
  report.hudChecks = report.screenshots.map(({ name }) => {
    const s = report.snapshots[name], c = s.cameraControl, text = s.hud || '';
    let expected, passed;
    if (c.freeLook) {
      expected = '自由观察 + 右键返回 + 保持瞄准';
      passed = /自由观察/.test(text) && /右键.*返回/.test(text) && /瞄准.*保持|保持.*瞄准/.test(text);
    } else if (c.follow) {
      expected = `${c.follow.kind === 'shell' ? '炮弹' : '鱼雷'}跟随 + C换弹 + Z返回`;
      passed = text.includes(c.follow.kind === 'shell' ? '炮弹' : '鱼雷') && /跟随/.test(text)
        && /C换弹/.test(text) && /Z返回/.test(text);
    } else if (c.mode === 'bridge') {
      expected = '舰桥 + V返回'; passed = /舰桥/.test(text) && /V返回/.test(text);
    } else if (c.level >= 3) {
      const fov = { 3: 18, 4: 11, 5: 7.5 }[c.level];
      expected = `望远 + ${fov}° + 炮组 ${c.group + 1}`;
      passed = /望远/.test(text) && text.includes(`${fov}°`) && text.includes(`炮组 ${c.group + 1}`);
    } else if (c.level === 2) {
      expected = `武器组 ${c.group + 1} + C切换`;
      passed = text.includes(`武器组 ${c.group + 1}`) && /C切换/.test(text);
    } else {
      expected = `第三人称 + ${c.level === 0 ? '远景' : '近景'}`;
      passed = /第三人称/.test(text) && text.includes(c.level === 0 ? '远景' : '近景');
    }
    return { name, text, expected, passed: !!passed && s.hudVisible };
  });
  check(new Set(hudTexts.map((s) => s.text)).size === hudTexts.length && report.hudChecks.every((c) => c.passed),
    'cameraMode HUD distinguishes exterior/near/weapon/binocular/free/follow/bridge', report.hudChecks);
  report.input = await page.evaluate(() => ({ frames: window.__cameraQA.frames, counts: window.__cameraQA.input }));
  check(['keydown:trusted', 'keyup:trusted', 'wheel:trusted', 'mousedown:trusted', 'mouseup:trusted', 'mousemove:trusted']
    .every((key) => report.input.counts[key] > 0), 'All input types exercised with browser-trusted DOM events', report.input);
} catch (error) {
  report.failures.push(error.stack || String(error));
} finally {
  if (browser) await browser.close();
  check(report.pageErrors.length === 0, 'No page errors', report.pageErrors);
  check(!report.console.some((m) => m.type === 'error'), 'No console errors', report.console.filter((m) => m.type === 'error'));
  check(report.networkErrors.length === 0, 'No failed network requests', report.networkErrors);
  check(report.screenshots.length === 10, 'All ten requested screenshots saved', report.screenshots.map((s) => s.name));
  report.finishedAt = new Date().toISOString();
  report.passed = report.failures.length === 0;
  if (existsSync(OUT)) writeFileSync(RESULT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, report: RESULT, checks: report.checks.length, failures: report.failures, limitations: report.limitations }, null, 2));
}
assert.ok(report.passed, 'Camera-controls acceptance failed; see art/blender/qa/verify-camera-controls-report.json');
