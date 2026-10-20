// Head-less smoke test: load the game in Edge, start the first level, aim at the nearest destroyer,
// fire, and report any console error or page exception plus a few screenshots.
// Usage: `npm run dev` in one shell, `npm run smoke` in another.

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.URL || 'http://127.0.0.1:5173/';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`);
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await wait(1800);
await page.screenshot({ path: `${OUT}/01-home.png` });

await page.click('#startBtn');
await wait(2000);
await page.screenshot({ path: `${OUT}/02-chase.png` });

// point the guns at the nearest destroyer and fire a full broadside
await page.evaluate(() => window.__cmd?.aimAtNearest());
await wait(400);
// Shift is a toggle now: one press puts the binoculars up and leaves them up
await page.keyboard.press('Shift');
await wait(900);
await page.screenshot({ path: `${OUT}/03-sight.png` });
await page.evaluate(() => window.__cmd?.fire());
await wait(1200);
await page.screenshot({ path: `${OUT}/04-firing.png` });

// wait out the flight and watch the fall of shot
await wait(9000);
await page.screenshot({ path: `${OUT}/05-splash.png` });
// and a close one, so the water column is unmistakable
await page.evaluate(() => window.__cmd?.splash(406));
await wait(500);
await page.screenshot({ path: `${OUT}/05b-splash-close.png` });
await page.evaluate(() => window.__cmd?.splash(406));
await wait(400);
await page.screenshot({ path: `${OUT}/05c-splash-close.png` });

// Aim direction check: turning right must swing the world to the LEFT on screen (FPS convention).
// A landmark 3 km due north of the ship, sampled before and after a rightward mouse move.
const dirCheck = await page.evaluate(async () => {
  const P = window.__debug().player;
  const before = window.__cmd.screenOf(P.x, 30, P.z + 3000);
  window.__cmd.turn(180, 0); // 180 px of mouse to the right
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = window.__cmd.screenOf(P.x, 30, P.z + 3000);
  window.__cmd.turn(-180, 0); // and back
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { beforeX: Math.round(before[0]), afterX: Math.round(after[0]), moved: Math.round(after[0] - before[0]) };
});
console.log('--- aim direction (mouse right -> world should move LEFT, i.e. moved < 0) ---');
console.log(JSON.stringify(dirCheck));

// the binoculars are still up from the single press above - that is the point of a toggle
await wait(1400);
await page.screenshot({ path: `${OUT}/03b-sight-zoom.png` });
const probeSight = await page.evaluate(() => {
  const cv = document.getElementById('overlay');
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const W = cv.width,
    H = cv.height;
  const cx = W / 2,
    cy = H / 2;
  const R = Math.min(W, H) * 0.34;
  let amberIn = 0,
    darkOut = 0,
    out = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const o = (y * W + x) * 4;
      const r = d[o],
        g = d[o + 1],
        b = d[o + 2],
        a = d[o + 3];
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < R * 0.6 && a > 40 && r > 170 && g > 110 && b < 140) amberIn++;
      if (dist > R * 1.15) {
        out++;
        if (a > 60 && r < 60 && g < 60 && b < 60) darkOut++;
      }
    }
  }
  return { R: Math.round(R), amberNearCentre: amberIn, darkOutsidePct: +((darkOut / Math.max(1, out)) * 100).toFixed(1) };
});
const sightState = await page.evaluate(() => window.__debug?.().overlay);
console.log('--- sight probe ---');
console.log(JSON.stringify(probeSight), JSON.stringify(sightState));
// and a second press must put them away again
await page.keyboard.press('Shift');
await wait(800);
const zoomAfterSecondPress = await page.evaluate(() => window.__debug().overlay.zoom);
console.log('--- zoom after the second Shift press (expect ~0) ---', JSON.stringify(zoomAfterSecondPress));

// bridge view for a while so the AI can close
await page.evaluate(() => window.__cmd?.cam(1));
await wait(2000);
await page.screenshot({ path: `${OUT}/06-bridge.png` });
await page.evaluate(() => window.__cmd?.probeView());
const bridgeProbe = await page.evaluate(() => window.__probe);
console.log('--- bridge view raycast (screen grid, nearest named object) ---');
console.log(JSON.stringify(bridgeProbe));
await page.evaluate(() => window.__cmd?.cam(0));

// orbit the player's own ship so the model itself can be judged
await page.evaluate(() => window.__cmd?.inspect(2));
await wait(1500);
await page.screenshot({ path: `${OUT}/08-model-a.png` }); // broadside: full profile
await page.evaluate(() => window.__cmd?.inspect(1));
await wait(2500);
await page.screenshot({ path: `${OUT}/09-model-b.png` }); // orbiting close-up
await page.evaluate(() => window.__cmd?.inspect(0));
await wait(400);

await wait(20000);
await page.evaluate(() => window.__cmd?.aimAtNearest());
await page.evaluate(() => window.__cmd?.fire());
await wait(6000);
await page.screenshot({ path: `${OUT}/07-close.png` });

// Pixel probe on the 2-D overlay: does the sight actually draw what it claims to?
const probe = await page.evaluate(() => {
  const cv = document.getElementById('overlay');
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const W = cv.width,
    H = cv.height;
  let amber = 0,
    opaque = 0,
    corner = 0,
    centreAmber = 0;
  const cx = W / 2,
    cy = H / 2;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const o = (y * W + x) * 4;
      const r = d[o],
        g = d[o + 1],
        b = d[o + 2],
        a = d[o + 3];
      if (a > 8) opaque++;
      if (a > 40 && r > 170 && g > 110 && b < 140) {
        amber++;
        if (Math.hypot(x - cx, y - cy) < Math.min(W, H) * 0.3) centreAmber++;
      }
      if (x < W * 0.06 && y < H * 0.06 && a > 40) corner++;
    }
  }
  const total = (W / 2) * (H / 2);
  return {
    size: [W, H],
    amberPx: amber,
    centreAmberPx: centreAmber,
    coveragePct: +((opaque / total) * 100).toFixed(1),
    cornerDarkPct: +((corner / (total * 0.0036)) * 100).toFixed(1),
  };
});

const state = await page.evaluate(() => window.__debug?.());
console.log('--- overlay probe (in sight/zoom state if zoom was on) ---');
console.log(JSON.stringify(probe));

console.log('--- console ---');
console.log(logs.slice(0, 40).join('\n') || '(nothing)');
console.log('--- state ---');
console.log(JSON.stringify(state, null, 2));

await browser.close();
