import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sampleOcean, OCEAN_WAVES, OCEAN_GLSL, OceanBlasts, blastStrength,
  BLAST_CAPACITY, BLAST_HEIGHT_CAP, BLAST_LIFE,
} from '../src/render/oceanModel.ts';

test('shared spectrum has directional swell/wind bands and modest height, slope and boat acceleration', () => {
  assert.ok(OCEAN_WAVES.length >= 10 && OCEAN_WAVES.length <= 14, `components ${OCEAN_WAVES.length}`);
  const displace = OCEAN_WAVES.filter(w => w.displace), detail = OCEAN_WAVES.filter(w => !w.displace);
  assert.equal(detail.length, 3, 'three shading-only short waves below mesh resolution');
  assert.ok(displace.length >= 8, 'displacement spectrum carries the energy');
  // Detail waves never move vertices or ships; the mesh cannot resolve them anyway.
  assert.ok(detail.every(w => w.k > Math.max(...displace.map(w => w.k))), 'detail waves are strictly the shortest');
  assert.ok(detail.every(w => w.foamWeight === 0 && w.amplitude <= 0.06));
  assert.ok(OCEAN_GLSL.includes(String(OCEAN_WAVES[0].k)));
  assert.ok(OCEAN_GLSL.includes('detailSlope'), 'fragment-only detail normal field');
  let peakSlope = 0, peakAccel = 0, motion = 0;
  for (let i = 0; i < 300; i++) {
    const x = i * 13.17, z = i * -9.3, t = i * 0.13;
    const s = sampleOcean(x, z, t), next = sampleOcean(x, z, t + 0.02);
    peakSlope = Math.max(peakSlope, Math.hypot(s.dx, s.dz));
    peakAccel = Math.max(peakAccel, Math.abs((next.height - 2 * s.height + sampleOcean(x, z, t - 0.02).height) / 0.02 ** 2));
    motion += Math.abs(next.height - s.height);
    assert.ok(Math.abs(s.height) < 5.5);
  }
  assert.ok(peakSlope > 0.07 && peakSlope < 0.20, `slope ${peakSlope}`);
  assert.ok(peakAccel < 2.6, `point acceleration ${peakAccel} m/s²`);
  assert.ok(motion > 0.5, 'visibly moving sea');
});

test('stronger physical wind waves retain stable DD/BB four-point hull motion', () => {
  // Same spatial hull averaging as ShipView, tested independently of visual normals.
  // Point acceleration may rise with wind-wave amplitude; hull heave/angles must remain gentle.
  for (const [L, B] of [[110, 12], [222, 33]]) {
    let maxAccel = 0, maxPitch = 0, maxRoll = 0;
    for (let i = 0; i < 600; i++) {
      const heading = i * 0.073, x = i * 4.17, z = -i * 1.93, t = i * 0.17;
      const sn = Math.sin(heading), cs = Math.cos(heading);
      const sampleHull = (time: number) => {
        const bow = sampleOcean(x + sn * L * 0.38, z + cs * L * 0.38, time).height;
        const stern = sampleOcean(x - sn * L * 0.38, z - cs * L * 0.38, time).height;
        const port = sampleOcean(x + cs * B * 0.5, z - sn * B * 0.5, time).height;
        const starboard = sampleOcean(x - cs * B * 0.5, z + sn * B * 0.5, time).height;
        return { heave: (bow + stern + port + starboard) / 4,
          pitch: Math.atan2(stern - bow, L * 0.76), roll: Math.atan2(port - starboard, B) * 0.9 };
      };
      const s = sampleHull(t);
      maxAccel = Math.max(maxAccel, Math.abs((sampleHull(t + 0.05).heave - 2 * s.heave + sampleHull(t - 0.05).heave) / 0.05 ** 2));
      maxPitch = Math.max(maxPitch, Math.abs(s.pitch));
      maxRoll = Math.max(maxRoll, Math.abs(s.roll));
    }
    assert.ok(maxAccel < 1.5, `${L}m hull heave acceleration ${maxAccel}`);
    assert.ok(maxPitch < 0.08, `${L}m pitch ${maxPitch}`);
    assert.ok(maxRoll < 0.16, `${L}m roll ${maxRoll}`);
  }
});

test('ambient whitecaps stay sparse and pressure foam follows a narrow moving front', () => {
  let breaking = 0;
  for (let i = 0; i < 1000; i++) {
    const s = sampleOcean(i * 2.31, -i * 1.29, i * 0.09);
    if (s.foam > 0.001) breaking++;
  }
  assert.ok(breaking > 20 && breaking < 500, `${breaking}/1000 crest samples before shader perforation`);
  const pool = new OceanBlasts(); pool.blast(0, 0, 406);
  const t = 0.5, radius = 23 * t;
  assert.ok(pool.sample(radius, 0, t).foam > 0.03);
  assert.ok(pool.sample(0, 0, t).foam < 1e-6, 'central depression is not filled with pale foam');
  assert.ok(pool.sample(radius + 7, 0, t).foam < pool.sample(radius, 0, t).foam * 0.001);
});

test('wave and blast analytic slopes agree with finite differences', () => {
  const pool = new OceanBlasts();
  pool.blast(0, 0, 406); pool.blast(4, -3, 356, 7);
  const eps = 0.0001;
  for (const sample of [sampleOcean, (x: number, z: number, t: number) => pool.sample(x, z, t)]) {
    for (let i = 0; i < 100; i++) {
      const x = i * 0.37 - 12, z = i * 0.23 - 8, t = 0.3 + i * 0.013;
      const s = sample(x, z, t);
      const dx = (sample(x + eps, z, t).height - sample(x - eps, z, t).height) / (2 * eps);
      const dz = (sample(x, z + eps, t).height - sample(x, z - eps, t).height) / (2 * eps);
      assert.ok(Math.abs(s.dx - dx) < 1e-7, `${s.dx} != ${dx}`);
      assert.ok(Math.abs(s.dz - dz) < 1e-7);
    }
  }
});

test('calibre and muzzle clearance attenuate pressure; ring travels and short foam expires', () => {
  assert.ok(blastStrength(127, 10) < blastStrength(203, 10));
  assert.ok(blastStrength(203, 10) < blastStrength(406, 10));
  assert.ok(blastStrength(406, 60) < blastStrength(406, 10) * 0.15);
  const pool = new OceanBlasts(); pool.blast(0, 0, 406);
  const peakRadius = (t: number) => {
    let best = 0, peak = 0;
    for (let r = 0; r < 100; r += 0.5) {
      const h = Math.abs(pool.sample(r, 0, t).height);
      if (h > peak) { best = r; peak = h; }
    }
    return best;
  };
  assert.ok(peakRadius(1) > peakRadius(0.3) + 10, 'localized outward propagation');
  assert.ok(pool.sample(12, 0, 0.4).foam > 0);
  assert.equal(pool.sample(25, 0, 1.1).foam, 0);
  assert.deepEqual(pool.sample(500, 500, 0.5), { height: 0, dx: 0, dz: 0, foam: 0 });
  assert.equal(pool.sample(0, 0, 0).height, 0, 'no frame-zero discontinuity');
  assert.deepEqual(pool.sample(70, 0, BLAST_LIFE), { height: 0, dx: 0, dz: 0, foam: 0 });
});

test('heavy muzzle front stays readable for 0.1–0.8s, fades near 1s, and DD remains weak', () => {
  const bb = new OceanBlasts(), dd = new OceanBlasts();
  for (let i = 0; i < 3; i++) { bb.blast(i * 2, 0, 406); dd.blast(i * 2, 0, 127); }
  for (const t of [0.1, 0.3, 0.5, 0.8]) {
    const heavy = bb.sample(23 * t + 2, 0, t);
    const light = dd.sample(23 * t + 2, 0, t);
    assert.ok(heavy.foam > 0.075, `${t}s heavy front too weak: ${heavy.foam}`);
    assert.ok(light.foam < heavy.foam * 0.25, `${t}s DD must stay distinctly weaker`);
    assert.ok(Math.abs(heavy.height) <= 0.48);
  }
  assert.ok(bb.sample(25, 0, 1).foam < bb.sample(13.5, 0, 0.5).foam * 0.13);
  assert.equal(bb.sample(27, 0, 1.05).foam, 0);
  bb.update(4); dd.update(4);
  assert.equal(bb.count, 0); assert.equal(dd.count, 0);
  assert.ok(bb.data.every(v => v === 0));
});

test('pressure foam has broad angular gaps and a narrow non-filled front', () => {
  const pool = new OceanBlasts(); pool.blast(0, 0, 406);
  const radius = 23 * 0.5;
  let gaps = 0, visible = 0;
  for (let i = 0; i < 120; i++) {
    const a = i * Math.PI / 60;
    const foam = pool.sample(Math.cos(a) * radius, Math.sin(a) * radius, 0.5).foam;
    if (foam < 1e-5) gaps++;
    if (foam > 0.08) visible++;
  }
  assert.ok(gaps > 25 && visible > 25, `gaps=${gaps}, visible arcs=${visible}`);
  assert.ok(pool.sample(radius + 3, 0, 0.5).foam < pool.sample(radius, 0, 0.5).foam * 0.03);
  assert.ok(pool.sample(radius, 0, 1.05).foam === 0);
});

test('overlapping barrels add response with a global displacement/foam cap', () => {
  const one = new OceanBlasts(), many = new OceanBlasts();
  one.blast(0, 0, 406, 0);
  for (let i = 0; i < BLAST_CAPACITY; i++) many.blast(0, 0, 406, 0);
  assert.ok(Math.abs(many.sample(10, 0, 0.3).height) > Math.abs(one.sample(10, 0, 0.3).height));
  for (let t = 0.01; t < BLAST_LIFE; t += 0.07) {
    for (let x = 0; x < 100; x += 1.7) {
      const s = many.sample(x, x * 0.13, t);
      assert.ok(Math.abs(s.height) <= BLAST_HEIGHT_CAP);
      assert.ok(s.foam >= 0 && s.foam <= 0.38);
      assert.ok(Object.values(s).every(Number.isFinite));
    }
  }
});

test('fixed pool survives saturation, retires oldest, compacts and resets on clock rewind', () => {
  const pool = new OceanBlasts(), data = pool.data;
  for (let i = 0; i < 500; i++) {
    pool.update(i * 0.001); pool.blast(i, -i, 406);
    assert.ok(pool.count <= BLAST_CAPACITY);
  }
  assert.equal(pool.data, data);
  assert.equal(pool.count, BLAST_CAPACITY);
  assert.ok(pool.data[0] > 400, 'old impulses recycled');
  pool.update(4.085);
  assert.ok(pool.count > 0 && pool.count < BLAST_CAPACITY, 'mixed expiries compacted');
  assert.ok([...pool.data.slice(0, pool.count * 4)].every(Number.isFinite));
  pool.update(5); assert.equal(pool.count, 0);
  assert.ok(pool.data.every(v => v === 0));
  pool.blast(1, 2, 406); pool.update(0); assert.equal(pool.count, 0);
  pool.blast(1, 2, 406); pool.reset(); assert.equal(pool.count, 0);
  assert.ok(pool.data.every(v => v === 0));
});

test('invalid/extreme inputs remain finite and large-clock blast ages keep precision', () => {
  const pool = new OceanBlasts();
  for (const v of [NaN, Infinity, -Infinity, 1e308, -1e308, 0]) {
    assert.ok(Object.values(sampleOcean(v, v, v)).every(Number.isFinite));
    assert.ok(Object.values(pool.sample(v, v, v)).every(Number.isFinite));
    pool.blast(v, v, NaN, Infinity); pool.update(v);
  }
  assert.equal(pool.count, 0);
  pool.update(1e6); pool.blast(0, 0, 406); pool.update(1e6 + 0.017);
  assert.ok(Math.abs(pool.data[2] - 0.017) < 1e-8);
  assert.ok(pool.sample(0, 0, 1e6 + 0.017).height < 0);
  pool.update(1e6 + 4); assert.equal(pool.count, 0);
});
