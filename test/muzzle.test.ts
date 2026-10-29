import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { muzzleProfile, MuzzleSimulation, MUZZLE_SMOKE_CAPACITY, MUZZLE_FLASH_CAPACITY } from '../src/render/muzzleModel.ts';
import { MuzzleEffects, muzzleTexture } from '../src/render/muzzle.ts';

const seeded = () => {
  let seed = 1234;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
};
const shot = (cal: number) => {
  const sim = new MuzzleSimulation(seeded());
  sim.emit(10, 20, 30, 0, cal);
  return sim;
};

test('DD / CA / BB have distinct sizes, density and smoke lifetimes', () => {
  const dd = muzzleProfile(127), ca = muzzleProfile(203), bb = muzzleProfile(406);
  for (const key of ['diameter', 'expansion', 'smokeLife', 'smokeCount', 'flashDiameter', 'warmth'] as const) {
    assert.ok(dd[key] < ca[key] && ca[key] < bb[key], key);
  }
  for (const [cal, min, max] of [[127, 1.5, 3], [203, 4, 6], [406, 8, 12]]) {
    const sim = shot(cal);
    for (const p of sim.smoke.particles.slice(0, sim.smoke.count)) {
      assert.ok(p.life >= min && p.life <= max, `${cal}: ${p.life}`);
    }
    sim.update(max + 0.01);
    assert.equal(sim.smoke.count, 0);
  }
});

test('short flash dies before smoke cools, BB smoke becomes light grey and fades to zero', () => {
  const sim = shot(406);
  const p = sim.smoke.particles[0];
  const initialSize = p.size;
  assert.ok(p.r > p.g && p.g > p.b, 'initial dirty warm smoke');
  sim.update(0.16);
  assert.equal(sim.flash.count, 0, 'no lingering fireball');
  assert.ok(sim.smoke.count > 0);
  const peak = p.alpha;
  sim.update(2.34);
  assert.ok(p.r >= 0.33 && p.r < 0.47 && p.g >= p.r && p.b >= p.g, 'readable cooled grey, not near-white emissive smoke');
  assert.ok(p.size > initialSize * 2, 'pressure expansion');
  let alpha = p.alpha;
  assert.ok(alpha <= peak);
  for (let i = 0; i < 6; i++) {
    sim.update(0.8);
    assert.ok(p.alpha <= alpha + 1e-12, 'monotonic fade after initial build');
    alpha = p.alpha;
  }
  assert.ok(alpha < peak * 0.5);
  sim.update(12);
  assert.equal(sim.smoke.count, 0);
  const dd = shot(127).smoke.particles[0];
  assert.ok(dd.r > p.opacity && dd.r - dd.b < 0.03, 'DD starts paler, almost neutral');
});

test('bearing and optional elevation orient the barrel cone at the real tip', () => {
  const horizontal = new MuzzleSimulation(() => 0.5);
  const elevated = new MuzzleSimulation(() => 0.5);
  horizontal.emit(10, 20, 30, Math.PI / 2, 406);
  elevated.emit(10, 20, 30, Math.PI / 2, 406, Math.PI / 6);
  const a = horizontal.flash.particles[0], b = elevated.flash.particles[0];
  assert.ok(a.x > 10 && Math.abs(a.y - 20) < 1e-10);
  assert.ok(b.y > 20 && b.vy > 0);
  assert.ok(Math.abs((b.y - 20) / (b.x - 10) - Math.tan(Math.PI / 6)) < 1e-10);
  assert.ok(Math.abs(a.z - b.z) < 1e-10, 'lateral scatter stays perpendicular to barrel');
});

test('analytic drift and expansion are independent of timestep subdivision', () => {
  const a = shot(406), b = shot(406);
  a.update(3);
  for (let i = 0; i < 180; i++) b.update(1 / 60);
  const pa = a.smoke.particles[0], pb = b.smoke.particles[0];
  for (const key of ['x', 'y', 'z', 'size', 'alpha', 'r', 'g', 'b'] as const) {
    assert.ok(Math.abs(pa[key] - pb[key]) < 1e-10, key);
  }
  assert.ok(pa.x > pa.ox, 'wind drifts across barrel axis');
  const y = pa.y;
  a.update(3);
  assert.ok(pa.y > y, 'buoyancy lifts smoke after initial directional blast settles');
});

test('pool saturation recycles oldest, keeps finite state, and cannot starve flash', () => {
  const sim = shot(406);
  const smokeObjects = new Set(sim.smoke.particles);
  for (let i = 0; i < 120; i++) sim.emit(i, 10, i, i, i % 2 ? 127 : 406, 0.4);
  assert.equal(sim.smoke.count, MUZZLE_SMOKE_CAPACITY);
  assert.equal(sim.flash.count, MUZZLE_FLASH_CAPACITY);
  assert.ok(sim.stats().smokeRecycled > 0);
  assert.ok(sim.stats().flashRecycled > 0);
  assert.equal(new Set(sim.smoke.particles).size, smokeObjects.size);
  assert.ok(sim.smoke.particles.every(p => smokeObjects.has(p)), 'no particle allocation on saturation');
  const serials = sim.smoke.particles.map(p => p.serial);
  assert.ok(Math.min(...serials) > 1, 'even same-frame salvos retire old particles');
  sim.update(0.2);
  assert.equal(sim.flash.count, 0);
  sim.emit(0, 10, 0, 0, 127);
  assert.equal(sim.flash.count, 3, 'smoke budget cannot swallow new flash');
  for (const pool of [sim.smoke, sim.flash]) {
    for (const p of pool.particles.slice(0, pool.count)) {
      for (const value of Object.values(p)) assert.ok(Number.isFinite(value));
      assert.ok(p.alpha >= 0 && p.alpha <= 1);
      assert.ok(p.size > 0);
    }
  }
  sim.update(1000);
  assert.equal(sim.smoke.count + sim.flash.count, 0);
  sim.reset();
  assert.equal(sim.stats().smokeSpawned + sim.stats().flashRecycled, 0);
});

test('invalid inputs cannot poison the pool or prevent later valid shots', () => {
  const sim = new MuzzleSimulation();
  for (const bad of [NaN, Infinity, -Infinity]) {
    sim.emit(bad, 0, 0, 0, 406);
    sim.emit(0, 0, 0, 0, 406, bad);
  }
  assert.equal(sim.smoke.count, 0);
  sim.emit(0, 0, 0, 0, 406);
  sim.update(NaN); sim.update(Infinity); sim.update(-1);
  assert.equal(sim.smoke.particles[0].age, 0);
  sim.update(0.01);
  assert.ok(sim.smoke.particles[0].age > 0);
  for (const cal of [0, 1e9, NaN]) {
    for (const value of Object.values(muzzleProfile(cal))) assert.ok(Number.isFinite(value));
  }
});

test('procedural smoke is deterministic, soft-edged and irregular, unlike a circular dot', () => {
  const a = muzzleTexture(false), b = muzzleTexture(false);
  assert.deepEqual(a.image.data, b.image.data);
  const data = a.image.data;
  const alpha = (x: number, y: number) => data[(y * 128 + x) * 4 + 3];
  for (let i = 0; i < 128; i++) {
    assert.equal(alpha(i, 0) + alpha(i, 127) + alpha(0, i) + alpha(127, i), 0);
  }
  assert.ok(alpha(64, 64) > 0 && alpha(64, 64) < 140, 'no uniform opaque centre');
  assert.notEqual(alpha(42, 64), alpha(64, 42));
  let sum = 0, peak = 0, shadeMin = 255, shadeMax = 0;
  for (let i = 3; i < data.length; i += 4) {
    sum += data[i] / 255;
    peak = Math.max(peak, data[i] / 255);
    if (data[i] > 10) {
      shadeMin = Math.min(shadeMin, data[i - 1]);
      shadeMax = Math.max(shadeMax, data[i - 1]);
    }
  }
  assert.ok(sum / (128 * 128) > 0.1 && sum / (128 * 128) < 0.22, 'readable cloud with large low-density gaps');
  assert.ok(peak < 0.85, 'even densest texture sample stays translucent');
  assert.ok(shadeMax - shadeMin > 45, 'RGB density/shading varies inside the cloud, not alpha alone');
  a.dispose(); b.dispose();
});

test('BB plume separates along the barrel then wind shears it; 6s residue remains optically thin', () => {
  const sim = shot(406);
  const extent = (key: 'x' | 'z') => {
    const values = sim.smoke.particles.slice(0, sim.smoke.count).map(p => p[key]);
    return Math.max(...values) - Math.min(...values);
  };
  const meanAlpha = () => sim.smoke.particles.slice(0, sim.smoke.count).reduce((sum, p) => sum + p.alpha, 0) / sim.smoke.count;
  sim.update(0.6);
  const early = meanAlpha(), crosswind = extent('x');
  assert.ok(extent('z') > 20 && extent('z') > crosswind, 'initial directional plume, not coincident puffs');
  assert.ok(early > 0.18 && early < 0.25, 'substantial early cloud while each fragment remains translucent');
  assert.ok(sim.smoke.particles.slice(0, sim.smoke.count).every(p => p.alpha < 0.26), 'no opaque single-puff core');
  assert.ok(sim.smoke.particles.slice(0, sim.smoke.count).every(p => p.r < 0.33 && p.r > p.b), 'dirty early BB smoke');
  sim.update(1.4);
  assert.ok(meanAlpha() < early * 0.8, 'dilutes before lifetime expiry');
  sim.update(4);
  assert.ok(extent('x') > crosswind * 1.4, 'individual wind drift breaks the intact sphere');
  assert.ok(meanAlpha() > 0.02 && meanAlpha() < early * 0.3, '6s residual is visible but much thinner');
  assert.ok(sim.smoke.particles.slice(0, sim.smoke.count).every(p => p.aspect > 1.8), 'late wisps stretch');
});

test('BB brightness compromise retains DD profile and colour endpoints', () => {
  assert.equal(muzzleProfile(406).opacity, 0.27);
  const ddProfile = muzzleProfile(127);
  assert.deepEqual({ count: ddProfile.smokeCount, opacity: ddProfile.opacity, life: ddProfile.smokeLife,
    diameter: ddProfile.diameter, expansion: ddProfile.expansion },
  { count: 7, opacity: 0.24, life: 2.2, diameter: 2.6, expansion: 8 });
  for (const [cal, start, end] of [
    [406, [0.22, 0.20, 0.17], [0.43, 0.45, 0.47]],
    [127, [0.3895, 0.40275, 0.4075], [0.442, 0.4605, 0.4705]],
  ] as const) {
    const sim = shot(cal), p = sim.smoke.particles[0];
    for (const [i, key] of (['r', 'g', 'b'] as const).entries()) {
      assert.ok(Math.abs(p[key] / p.shade - start[i]) < 1e-10, `${cal}: initial ${key}`);
    }
    // DD's lifetime is shorter; sample cooled DD before it expires.
    sim.update(cal === 127 ? 1.5 : 2.5);
    for (const [i, key] of (['r', 'g', 'b'] as const).entries()) {
      assert.ok(Math.abs(p[key] / p.shade - end[i]) < 1e-10, `${cal}: cooled ${key}`);
    }
  }
});

test('flash texture is a directional torch with warm white core and orange outer envelope', () => {
  const texture = muzzleTexture(true), data = texture.image.data;
  const color = (x: number, y: number, c: number) => data[(y * 128 + x) * 4 + c] / 255;
  assert.ok(color(64, 64, 1) > 0.7 && color(64, 64, 2) > 0.5, 'warm white core');
  assert.ok(color(64, 80, 1) < 0.3 && color(64, 80, 2) < 0.05, 'orange rim');
  assert.ok(color(64, 80, 3) > 0, 'rim is actually rendered');
  let xx = 0, yy = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const alpha = color(x, y, 3);
    xx += (x - 64) ** 2 * alpha;
    yy += (y - 64) ** 2 * alpha;
  }
  assert.ok(xx > yy * 4, 'longitudinal energy, not a circular white ball');
  texture.dispose();
});

test('default random source respects the screenshot fixture seed set at emission time', () => {
  const a = new MuzzleSimulation(), b = new MuzzleSimulation();
  const original = Math.random;
  try {
    Math.random = seeded(); a.emit(0, 0, 0, 0, 406);
    Math.random = seeded(); b.emit(0, 0, 0, 0, 406);
  } finally { Math.random = original; }
  assert.deepEqual(a.smoke.particles, b.smoke.particles);
});

test('renderer uses two instanced batches, independent blend modes and immediate reset', () => {
  const scene = new THREE.Scene();
  const fx = new MuzzleEffects(scene);
  assert.equal(scene.children.length, 2);
  fx.emit(0, 10, 0, 0, 406, 0.2);
  fx.update(0);
  assert.equal(fx.stats().drawCalls, 2);
  const smoke = scene.getObjectByName('muzzle-smoke') as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  const flash = scene.getObjectByName('muzzle-flash') as typeof smoke;
  assert.equal(smoke.geometry.instanceCount, 10);
  assert.equal(flash.geometry.instanceCount, 3);
  assert.ok(Math.abs(flash.geometry.getAttribute('aAxis').getZ(0) - Math.cos(0.2)) < 1e-6);
  assert.ok(flash.geometry.getAttribute('aShape').getW(0) > 2);
  assert.equal(smoke.material.blending, THREE.NormalBlending);
  assert.equal(flash.material.blending, THREE.AdditiveBlending);
  assert.ok(flash.renderOrder > smoke.renderOrder);
  assert.equal(smoke.material.depthWrite, false);
  fx.update(0.2);
  assert.equal(fx.stats().drawCalls, 1);
  fx.reset();
  assert.equal(fx.stats().drawCalls, 0);
  assert.equal(smoke.geometry.instanceCount + flash.geometry.instanceCount, 0);
});
