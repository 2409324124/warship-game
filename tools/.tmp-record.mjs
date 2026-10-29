// Temporary: record a short water demo video via CDP screencast (webm).
import puppeteer from 'puppeteer-core';
const EDGE = process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.URL || 'http://127.0.0.1:5173/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--no-sandbox', '--mute-audio', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await wait(1800);
await page.click('#startBtn');
await wait(2500);

const rec = await page.screencast({ path: 'shots/water-demo.webm', fps: 24 });
// 第三人称跟拍：舰艇随浪摇摆 + 海面波纹
await wait(5000);
// 齐射：炮口冲击环 + 远处落弹水柱
await page.evaluate(() => window.__cmd?.aimAtNearest());
await wait(400);
await page.evaluate(() => window.__cmd?.fire());
await wait(9000);
// 舰桥视角看开阔海面
await page.evaluate(() => window.__cmd?.cam(1));
await wait(5000);
await rec.stop();
await browser.close();
console.log('saved shots/water-demo.webm');
