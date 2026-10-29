import test from 'node:test';
import assert from 'node:assert/strict';
import { Sfx } from '../src/audio/sfx.ts';

// A scheduling/ownership double, deliberately retaining every created node so
// leaked connections, pending sources and automation can be asserted externally.
class Param {
  value = 1;
  events = [];
  setValueAtTime(value, time) { this.events.push(['set', value, time]); }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(Number.isFinite(value) && value > 0);
    assert.ok(Number.isFinite(time));
    this.events.push(['exp', value, time]);
  }
  linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  setTargetAtTime(value, time, constant) { this.events.push(['target', value, time, constant]); }
}
class Node {
  connections = [];
  gain = new Param(); frequency = new Param(); Q = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param();
  attack = new Param(); release = new Param();
  onended = null;
  started = null;
  stopped = null;
  constructor(kind) { this.kind = kind; }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; }
  start(...args) { this.started = args; }
  stop(time = 0) { this.stopped = time; }
  end() { this.onended?.(); }
}
class Context {
  static instances = [];
  state = 'running'; currentTime = 0; sampleRate = 8000;
  destination = new Node('destination'); nodes = [];
  resumeCalls = 0; closeCalls = 0; rejectResume = false;
  constructor() { Context.instances.push(this); }
  node(kind) { const n = new Node(kind); this.nodes.push(n); return n; }
  createGain() { return this.node('gain'); }
  createBiquadFilter() { return this.node('filter'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createWaveShaper() { return this.node('shaper'); }
  createBufferSource() { const n = this.node('noise'); n.buffer = null; return n; }
  createOscillator() { return this.node('tone'); }
  createBuffer(channels, len, rate) {
    const buffers = Array.from({ length: channels }, () => new Float32Array(len));
    return { duration: len / rate, numberOfChannels: channels, getChannelData: channel => buffers[channel] };
  }
  decodeAudioData() { return Promise.resolve(this.createBuffer(1, this.sampleRate * 2.575, this.sampleRate)); }
  resume() {
    this.resumeCalls++;
    if (this.rejectResume) return Promise.reject(new Error('gesture required'));
    this.state = 'running'; return Promise.resolve();
  }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
}

function fixture(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    value: async () => { throw new Error('Intentional unavailable asset in fallback unit fixture'); } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: Context } });
  const sfx = new Sfx(); sfx.init();
  const ctx = Context.instances.at(-1);
  const sea = ctx.nodes.find(n => n.kind === 'noise');
  const sources = () => ctx.nodes.filter(n => n !== sea && n.started !== null);
  t.after(() => {
    sfx.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
    Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
  });
  return { sfx, ctx, sea, sources };
}

test('same-frame turrets are independent, with bounded overload energy folding', t => {
  const { sfx, ctx, sources } = fixture(t);
  for (let i = 0; i < 4; i++) sfx.gun(406, 60, true, { barrels: 3 });
  assert.equal(sources().length, 4);
  assert.ok(new Set(sources().map(s => s.started[0])).size > 1);
  for (let i = 0; i < 100; i++) sfx.gun(406, 60, true);
  assert.equal(sources().length, 24);
  assert.ok(ctx.nodes.some(n => n.gain.events.some(e => e[0] === 'target')));
  for (let i = 0; i < 100; i++) sfx.gun(127, 60, true, { secondary: true });
  assert.equal(sources().length, 36);
});

test('heavy reports are stochastic buffers with longer tails than destroyer guns', t => {
  const { sfx, sources } = fixture(t);
  sfx.gun(127, 0, true);
  const light = sources().slice();
  sfx.gun(406, 0, true);
  const heavy = sources().slice(1);
  assert.ok(heavy[0].buffer.duration > light[0].buffer.duration * 2);
  assert.ok(light.every(n => n.started[0] >= 0));
  assert.ok(heavy.every(n => n.kind === 'noise' && !n.loop));
});

test('sustained secondary/impact spam cannot allocate unbounded voices; heavy guns retain room', t => {
  const { sfx, ctx, sources } = fixture(t);
  for (let i = 0; i < 1000; i++) {
    ctx.currentTime += 0.1;
    sfx.gun(127, 0, i % 2 === 0);
    sfx.splash(127, 0); sfx.hit(203, 0); sfx.explode(true, 0);
    sfx.incoming(406, 2); sfx.alarm(); sfx.torpedo();
  }
  const count = sources().length;
  assert.ok(count <= 12 + 6 * 3 + 2 + 2 * 2);
  sfx.gun(406, 0, true);
  assert.equal(sources().length, count + 1);
  for (const source of sources()) source.end();
  assert.ok(ctx.nodes.filter(n => n !== ctx.nodes[0] && n.started !== null && n !== ctx.nodes.find(x => x.kind === 'noise'))
    .every(n => n.connections.length === 0));
  ctx.currentTime += 1;
  sfx.gun(127, 0, true);
  assert.equal(sources().length, count + 2);
});

test('each layer disconnects at end and the event bus releases after the final layer', t => {
  const { sfx, ctx, sources } = fixture(t);
  const initial = ctx.nodes.length;
  sfx.gun(406, 0, true);
  const nodes = ctx.nodes.slice(initial);
  const shots = sources();
  shots[0].end();
  assert.equal(shots[0].connections.length, 0);
  assert.equal(nodes[0].connections.length, 0);
  for (const source of shots.slice(1)) source.end();
  assert.ok(nodes.every(n => n.connections.length === 0));
});

test('mute fades output and cancels delayed shots; mute-before-init is respected', t => {
  const { sfx, ctx, sources } = fixture(t);
  sfx.gun(406, 5000, true);
  sfx.setMuted(true);
  assert.ok(sources().every(n => n.stopped === 0.03));
  const count = ctx.nodes.length;
  sfx.gun(406, 0, false); sfx.explode(true, 0); sfx.alarm();
  assert.equal(ctx.nodes.length, count);
  const master = ctx.nodes.find(n => n.connections.includes(ctx.destination));
  assert.deepEqual(master.gain.events.at(-1), ['linear', 0, 0.025]);
  sfx.dispose();
  sfx.init();
  const fresh = Context.instances.at(-1);
  assert.equal(fresh.nodes.find(n => n.connections.includes(fresh.destination)).gain.value, 0);
});

test('locked context drops events, init retries rejected resume without rebuilding graph', async t => {
  const { sfx, ctx, sources } = fixture(t);
  ctx.state = 'suspended'; ctx.rejectResume = true;
  sfx.gun(406, 0, true);
  assert.equal(sources().length, 0);
  const count = ctx.nodes.length;
  sfx.init(); sfx.init();
  assert.equal(ctx.resumeCalls, 1);
  await new Promise(resolve => setImmediate(resolve));
  ctx.rejectResume = false;
  sfx.init();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.resumeCalls, 2);
  assert.equal(ctx.nodes.length, count);
  sfx.gun(406, 0, true);
  assert.equal(sources().length, 1);
});

test('distance attenuation and propagation, invalid inputs, short incoming flight', t => {
  const { sfx, ctx, sources } = fixture(t);
  sfx.gun(NaN, Infinity, true);
  sfx.gun(100000, -50, true);
  assert.ok(sources().every(n => Number.isFinite(n.stopped)));
  assert.ok(sources()[0].started[0] <= 0.571); // propagation plus natural turret jitter
  sfx.incoming(406, NaN); sfx.incoming(406, -1);
  assert.equal(sources().length, 2);
  ctx.currentTime = 2;
  sfx.incoming(406, 0.02);
  assert.ok(sources().at(-1).stopped <= 2.04);
  const layerGains = ctx.nodes.filter(n => n.kind === 'gain' && n.gain.events.some(e => e[0] === 'exp'));
  assert.ok(layerGains.every(n => n.gain.events.filter(e => e[0] === 'exp').every(e => e[1] <= 1)));
});

test('all transient and ambience resources are cleaned, disposal is idempotent and reinit works', t => {
  const { sfx, ctx, sea, sources } = fixture(t);
  sfx.gun(406, 0, true); sfx.alarm(); sfx.incoming(127, 2);
  const shots = sources();
  sfx.dispose(); sfx.dispose();
  assert.equal(ctx.closeCalls, 1);
  assert.equal(sfx.ctx, null);
  assert.notEqual(sea.stopped, null);
  assert.ok(shots.every(n => n.stopped !== null && n.onended === null));
  assert.ok(ctx.nodes.every(n => n.connections.length === 0));
  sfx.init();
  assert.notEqual(sfx.ctx, ctx);
  assert.equal(sfx.ctx.state, 'running');
});

test('final peak curve is finite, monotonic, symmetric and bounded with unity output headroom', t => {
  const { ctx } = fixture(t);
  const curve = ctx.nodes.find(n => n.kind === 'shaper').curve;
  assert.equal(curve[2048], 0);
  assert.ok(curve.every((v, i) => Number.isFinite(v) && Math.abs(v) < 0.9 && (i === 0 || v >= curve[i - 1])));
  assert.ok(Math.abs(curve[0] + curve.at(-1)) < 1e-7);
  const master = ctx.nodes.find(n => n.connections.includes(ctx.destination));
  assert.ok(Math.max(...curve) * master.gain.value < 0.6);
});

test('preload deduplicates, gun never fetches, loaded path replaces fallback cache', async t => {
  const { sfx, sources } = fixture(t);
  await sfx.prepare(); // settle intentional initial failure
  let requests = 0;
  globalThis.fetch = async () => { requests++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(44) }; };
  sfx.gun(406, 60, true);
  assert.equal(sfx.stats().fallback, 1);
  sfx.retryAfter = 0;
  const pending = sfx.prepare();
  const same = sfx.prepare();
  assert.equal(pending, same);
  assert.equal(await pending, true);
  for (let i = 0; i < 4; i++) sfx.gun(406, 60, true, { barrels: 3 });
  assert.equal(requests, 1);
  assert.equal(sfx.stats().recorded, 4);
  assert.equal(sfx.stats().fallback, 1);
  assert.equal(sources().length, 5);
  assert.ok([...sfx.reports.keys()].every(k => k.startsWith('recorded:')));
});

test('preparation failure has cooldown and bounded retries, disposal ignores stale decode', async t => {
  const { sfx, ctx } = fixture(t);
  await sfx.prepare();
  assert.equal(sfx.stats().attempts, 1);
  await sfx.prepare();
  assert.equal(sfx.stats().attempts, 1, 'cooldown prevents immediate retry');
  for (let i = 0; i < 5; i++) { sfx.retryAfter = 0; await sfx.prepare(); }
  assert.equal(sfx.stats().attempts, 3);
  sfx.dispose();
  let finish;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(44) });
  Context.prototype.decodeAudioData = function () { return new Promise(resolve => { finish = () => resolve(ctx.createBuffer(1, 20600, 8000)); }); };
  t.after(() => { Context.prototype.decodeAudioData = function () { return Promise.resolve(this.createBuffer(1, this.sampleRate * 2.575, this.sampleRate)); }; });
  const pending = sfx.prepare();
  await new Promise(resolve => setImmediate(resolve));
  sfx.dispose();
  finish();
  assert.equal(await pending, false);
  assert.equal(sfx.stats().loaded, false);
});
