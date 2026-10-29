import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';

const browserPath = process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

test('real WAV decode → recorded gun source → native final mix, salvo and cleanup', {
  skip: !existsSync(browserPath) && 'Set BROWSER to a Chromium executable for real WebAudio verification',
  timeout: 60000,
}, async t => {
  const asset = readFileSync(new URL('../public/audio/navy-mk45-report.wav', import.meta.url));
  let requests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/audio/navy-mk45-report.wav') {
      requests++;
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(asset);
    } else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>Audio-only QA</title>'); }
  });
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => cleanupPromise ??= (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (browser) {
        const ownedBrowser = browser;
        await Promise.race([
          ownedBrowser.close(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              // Only the headless process launched by this test, never user browsers.
              ownedBrowser.process()?.kill();
              reject(new Error('Audio QA browser.close exceeded 5 seconds'));
            }, 5000);
          }),
        ]);
      }
    } finally {
      if (timer) clearTimeout(timer);
      // One ordered cleanup: browser first, then HTTP keepalive/active sockets.
      server.closeIdleConnections();
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    }
  })();
  t.after(cleanup);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let launched = false;
  try {
    browser = await puppeteer.launch({
      executablePath: browserPath, headless: true, args: ['--no-sandbox', '--mute-audio'],
      timeout: 15000,
    });
    launched = true;
  } finally {
    // Also release the listening server if launch throws before browser exists.
    if (!launched) await cleanup();
  }
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const source = transpileModule(readFileSync(new URL('../src/audio/sfx.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText.replace('export class Sfx', 'window.AudioTestSfx = class Sfx');
  await page.addScriptTag({ content: source });
  const result = await page.evaluate(async () => {
    async function render(mode, rate = 48000) {
      const raw = new OfflineAudioContext(2, rate * 5, rate);
      let now = 0;
      const connections = new Map();
      // OfflineAudioContext starts suspended but accepts scheduling. Adapt only
      // lifecycle/clock; every source, filter, compressor and sample is native.
      window.AudioContext = function () {
        return new Proxy(raw, {
          get(target, key) {
            if (key === 'state') return 'running';
            if (key === 'currentTime') return now;
            if (key === 'close') return () => Promise.resolve();
            const value = Reflect.get(target, key, target);
            if (typeof value !== 'function') return value;
            if (!String(key).startsWith('create') || key === 'createBuffer') return value.bind(target);
            return (...args) => {
              const node = value.apply(target, args);
              const connect = node.connect.bind(node), disconnect = node.disconnect.bind(node);
              connections.set(node, new Set());
              node.connect = destination => { connections.get(node).add(destination); return connect(destination); };
              node.disconnect = () => { connections.get(node).clear(); disconnect(); };
              return node;
            };
          },
        });
      };
      let seed = 123456;
      const random = Math.random;
      Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
      const sfx = new window.AudioTestSfx();
      try {
        sfx.init();
        const loaded = await sfx.prepare();
        if (!loaded || !sfx.stats().loaded) throw new Error('Recorded WAV failed to decode; fallback is not acceptance');
        const initialConnections = [...connections.values()].reduce((sum, set) => sum + set.size, 0);
        // Check the composite still derives primarily from the actual decoded WAV.
        const original = sfx.recording.getChannelData(0);
        const composite = sfx.recordedReport((406 - 76) / 384, false).getChannelData(0);
        let referenceEnergy = 0, residualEnergy = 0;
        for (let i = 0; i < Math.min(original.length, rate); i++) {
          referenceEnergy += (original[i] * .94) ** 2;
          residualEnergy += (composite[i] - original[i] * .94) ** 2;
        }
        if (mode === 'muted') {
          sfx.gun(406, 5000, true, { barrels: 3 });
          sfx.setMuted(true);
          sfx.gun(406, 0, true);
          now = 0.1;
          sfx.setMuted(false);
        }
        if (mode === 'heavy' || mode === 'light' || mode === 'secondary')
          sfx.gun(mode === 'light' ? 127 : 406, 160, true, { secondary: mode === 'secondary' });
        if (mode === 'salvo' || mode === 'triple') {
          for (let i = 0; i < (mode === 'salvo' ? 4 : 1); i++) sfx.gun(406, 160, true, { barrels: 3 });
        }
        if (mode === 'stress') {
          for (let i = 0; i < 100; i++) {
            now = (i % 10) * 0.09;
            sfx.gun(406, 0, true); sfx.gun(356, 0, false);
            sfx.gun(127, 0, true); sfx.gun(152, 0, false);
            sfx.explode(true, 0); sfx.hit(406, 0); sfx.splash(406, 0);
            sfx.alarm(); sfx.incoming(406, 1); sfx.torpedo();
          }
        }
        const rendered = await raw.startRendering();
        // onended is delivered by the real audio engine, not manually simulated.
        await new Promise(resolve => setTimeout(resolve, 30));
        const active = sfx.voices.size;
        const transientConnections = [...connections.values()].reduce((sum, set) => sum + set.size, 0) - initialConnections;
        const data = rendered.getChannelData(0);
        const analysis = new OfflineAudioContext(1, data.length, rate);
        // Analyze L, not a stereo→mono downmix that may add correlated channels.
        const left = analysis.createBuffer(1, data.length, rate);
        left.copyToChannel(data, 0);
        const src = analysis.createBufferSource(); src.buffer = left;
        // WebAudio low/high-pass Q is in dB: -3.01dB is Butterworth, not +0.707dB.
        const hp = analysis.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80; hp.Q.value = -3.0103;
        const lp = analysis.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = -3.0103;
        src.connect(hp); hp.connect(lp); lp.connect(analysis.destination); src.start();
        const band = (await analysis.startRendering()).getChannelData(0);
        let peak = 0, energy = 0, lowEnergy = 0, tail = 0, late = 0, nearCeiling = 0;
        for (let i = 0; i < data.length; i++) {
          if (!Number.isFinite(data[i])) throw new Error('Non-finite sample');
          peak = Math.max(peak, Math.abs(data[i]));
          peak = Math.max(peak, Math.abs(rendered.getChannelData(1)[i]));
          if (i < rate * 0.6) { energy += data[i] ** 2; lowEnergy += band[i] ** 2; }
          if (i >= rate && i < rate * 2) tail += band[i] ** 2;
          if (i >= rate * 2 && i < rate * 2.6) late += band[i] ** 2;
          if (Math.abs(data[i]) > .5759) nearCeiling++;
        }
        const preview = mode === 'salvo' || mode === 'heavy'
          ? [Array.from(data), Array.from(rendered.getChannelData(1))] : undefined;
        const stats = sfx.stats();
        sfx.dispose();
        return { peak, rms: Math.sqrt(energy / (rate * .6)), lowRms: Math.sqrt(lowEnergy / (rate * .6)),
          tailRms: Math.sqrt(tail / rate), lateRms: Math.sqrt(late / (rate * .6)), active, preview, transientConnections,
          nearCeilingFraction: nearCeiling / data.length,
          stats, reinforcementRatio: Math.sqrt(residualEnergy / referenceEnergy),
          disposed: sfx.ctx === null && sfx.graph.length === 0 && sfx.reports.size === 0
            && [...connections.values()].every(set => set.size === 0) };
      } finally { Math.random = random; sfx.dispose(); }
    }
    const results = {};
    for (const mode of ['baseline', 'muted', 'light', 'secondary', 'heavy', 'triple', 'salvo', 'stress']) results[mode] = await render(mode);
    results.heavy44100 = await render('heavy', 44100);
    delete results.heavy44100.preview;
    return results;
  });
  for (const mode of ['heavy', 'salvo']) {
    const samples = result[mode].preview;
    delete result[mode].preview;
    const wav = Buffer.alloc(44 + samples[0].length * 4);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples[0].length * 4, 40);
    for (let i = 0; i < samples[0].length; i++) for (let c = 0; c < 2; c++)
      wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[c][i])) * 32767), 44 + i * 4 + c * 2);
    const previewPath = join(tmpdir(), 'opencode', `warship-recorded-${mode}-finalmix.wav`);
    await mkdir(join(tmpdir(), 'opencode'), { recursive: true });
    await writeFile(previewPath, wav);
    t.diagnostic(`Recorded composite ${mode} stereo finalmix preview (not subjective acceptance): ${previewPath}`);
  }
  t.diagnostic(JSON.stringify(result));
  assert.equal(requests, 9, 'one preload per context, no network/decode on fire');
  for (const metrics of Object.values(result)) {
    assert.ok(metrics.peak < 0.65, 'mix retains peak headroom');
    assert.equal(metrics.active, 0, 'native onended releases every transient voice');
    assert.equal(metrics.transientConnections, 0, 'all transient native node connections are released');
    assert.ok(metrics.disposed, 'dispose clears graph and cached reports');
    assert.equal(metrics.stats.loaded, true);
    assert.equal(metrics.stats.fallback, 0, 'every scheduled gun uses recorded asset');
    assert.ok(metrics.reinforcementRatio < 0.25, 'synthetic reinforcement remains subordinate to recorded signal');
  }
  assert.ok(result.heavy.peak > 0.01, 'audible signal was rendered');
  assert.ok(result.muted.rms < result.baseline.rms * 1.05, 'muted delayed shot never resurrects after unmute');
  assert.ok(result.heavy.lowRms > result.light.lowRms * 1.3, 'heavy gun carries more low-frequency energy');
  assert.ok(result.heavy.tailRms > result.light.tailRms * 2, 'BB retains more recorded late tail than DD');
  assert.ok(result.heavy.lowRms > 0.01, '80–500Hz body survives the final chain');
  assert.ok(result.heavy.lowRms / result.heavy.rms > 0.2, 'body is not merely sub-bass or treble');
  assert.ok(result.heavy.tailRms > result.baseline.tailRms * 5
    && result.heavy.lateRms > result.baseline.lateRms * 3, 'rolling sea tail persists above ambience through 1–2.6 seconds');
  assert.ok(result.triple.rms > result.heavy.rms * 1.3, 'additional barrels retain powder energy');
  assert.ok(result.salvo.rms > result.triple.rms * 1.35, 'same-frame turret events are not swallowed');
  assert.ok(result.secondary.rms < result.heavy.rms * 0.5, 'secondary fire stays behind the main battery');
  assert.equal(result.heavy.stats.recorded, 1);
  assert.equal(result.triple.stats.recorded, 1);
  assert.equal(result.salvo.stats.recorded, 4, 'all same-frame turret events retain recorded identity');
  assert.ok(result.salvo.nearCeilingFraction < 0.001, 'ordinary salvo is not flattened against the final ceiling');
});
