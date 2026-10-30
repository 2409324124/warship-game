import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  projectAimRing, projectAimRibbon, AIM_PROJECTION_MAX_SEGMENTS, AIM_PROJECTION_HEIGHT_OFFSET,
  AIM_PROJECTION_RIBBON_WIDTH,
} from '../src/render/aimProjection.ts';

const buffer = () => new Float32Array(AIM_PROJECTION_MAX_SEGMENTS * 6);
const flat = { height: () => 0 };
const seaFloor = () => -100;
const sigma = { along: 80, cross: 20 };

test('each vertex follows the supplied live water height and simulation time', () => {
  const water = { height: (x: number, z: number, t: number) => Math.sin(x / 35 + t) + Math.cos(z / 27 - t) };
  const a = buffer(), b = buffer();
  const first = projectAimRing(a, 200, 300, -10, 30, sigma, water, 2, true, seaFloor);
  const second = projectAimRing(b, 200, 300, -10, 30, sigma, water, 3, true, seaFloor);
  assert.ok(first.valid && second.valid);
  let motion = 0;
  for (let i = 0; i < first.segments * 6; i += 3) {
    assert.ok(Math.abs(a[i + 1] - water.height(a[i], a[i + 2], 2) - AIM_PROJECTION_HEIGHT_OFFSET) < 2e-6);
    motion += Math.abs(a[i + 1] - b[i + 1]);
  }
  assert.ok(motion > 10);
});

test('land at the center, unreachable points, and malformed numbers hide the entire ring', () => {
  const a = buffer();
  const hidden = { valid: false, segments: 0 };
  assert.deepEqual(projectAimRing(a, 0, 0, -100, 0, sigma, flat, 0, true, () => 1), hidden);
  assert.deepEqual(projectAimRing(a, 0, 0, -100, 0, sigma, flat, 0, false, seaFloor), hidden);
  for (const bad of [NaN, Infinity, -Infinity]) {
    for (let index = 0; index < 7; index++) {
      const values = [0, 0, -100, 0, 80, 20, 0];
      values[index] = bad;
      assert.deepEqual(projectAimRing(a, values[0], values[1], values[2], values[3],
        { along: values[4], cross: values[5] }, flat, values[6], true, seaFloor), hidden);
    }
    assert.deepEqual(projectAimRing(a, 0, 0, -100, 0, sigma, { height: () => bad }, 0, true, seaFloor), hidden);
    assert.deepEqual(projectAimRing(a, 0, 0, -100, 0, sigma, flat, 0, true, () => bad), hidden);
  }
  for (const along of [0, -1]) {
    assert.deepEqual(projectAimRing(a, 0, 0, -100, 0, { along, cross: 20 }, flat), hidden);
  }
});

test('shore edges are omitted and compacted without reconnecting across dry arcs', () => {
  const positions = buffer();
  const shore = (x: number) => x > 25 ? 5 : -100;
  const whole = projectAimRing(buffer(), 0, 0, -100, 0, sigma, flat, 0, true, seaFloor);
  const clipped = projectAimRing(positions, 0, 0, -100, 0, sigma, flat, 0, true, shore);
  assert.ok(clipped.valid && clipped.segments > 0 && clipped.segments < whole.segments);
  for (let i = 0; i < clipped.segments * 6; i += 6) {
    for (let k = 0; k <= 20; k++) {
      const f = k / 20, x = positions[i] + (positions[i + 3] - positions[i]) * f;
      assert.ok(shore(x) <= 0);
    }
    assert.ok(Math.hypot(positions[i + 3] - positions[i], positions[i + 5] - positions[i + 2]) < 8.1);
  }
});

test('an interior dry spit rejects an edge even when both endpoints are wet', () => {
  const positions = buffer();
  const all = projectAimRing(positions, 0, 0, -100, 0, sigma, flat, 0, true, seaFloor);
  const x = (positions[0] + positions[3]) / 2, z = (positions[2] + positions[5]) / 2;
  const spit = (px: number, pz: number) => Math.hypot(px - x, pz - z) < 0.05 ? 5 : -100;
  assert.ok(spit(positions[0], positions[2]) < 0 && spit(positions[3], positions[5]) < 0);
  const clipped = projectAimRing(positions, 0, 0, -100, 0, sigma, flat, 0, true, spit);
  assert.equal(clipped.segments, all.segments - 1);
});

test('world radii equal supplied sigma at every range, including coincident aim/origin', () => {
  for (const range of [0, 100, 20000]) {
    for (const scale of [0.01, 1, 10]) {
      const positions = buffer();
      const along = sigma.along * scale, cross = sigma.cross * scale;
      const result = projectAimRing(positions, range, 0, 0, 0, { along, cross }, flat, 0, true, seaFloor);
      assert.ok(result.valid);
      for (let i = 0; i < result.segments * 6; i += 3) {
        const equation = ((positions[i] - range) / along) ** 2 + (positions[i + 2] / cross) ** 2;
        assert.ok(Math.abs(equation - 1) < 0.003, `${range}, ${scale}: ${equation}`);
      }
    }
  }
});

test('nonfinite perimeter samples and Float32 overflow also clear the draw count', () => {
  const hidden = { valid: false, segments: 0 };
  assert.deepEqual(projectAimRing(buffer(), 0, 0, -100, 0, sigma,
    { height: (x) => x > 30 ? NaN : 0 }, 0, true, seaFloor), hidden);
  assert.deepEqual(projectAimRing(buffer(), 1e40, 0, 0, 0, sigma, flat, 0, true, seaFloor), hidden);
});

const ribbonBuffer = () => new Float32Array(AIM_PROJECTION_MAX_SEGMENTS * 18);

test('ribbon is one metre wide, centered on unchanged sigma edges, with two triangles per segment', () => {
  const centerline = buffer(), ribbon = ribbonBuffer();
  const center = projectAimRing(centerline, 200, 300, -10, 30, sigma, flat);
  const original = centerline.slice();
  const result = projectAimRibbon(ribbon, centerline, center.segments, flat);
  assert.ok(result.valid);
  assert.equal(result.segments, center.segments);
  assert.deepEqual(centerline, original, 'widening never changes the physical centerline');
  for (let i = 0; i < result.segments; i++) {
    const p = i * 18, c = i * 6;
    // Output corner order: A+, A-, B+, B+, A-, B-.
    for (const [left, right, endpoint] of [[p, p + 3, c], [p + 6, p + 15, c + 3]]) {
      assert.ok(Math.abs(Math.hypot(ribbon[left] - ribbon[right], ribbon[left + 2] - ribbon[right + 2])
        - AIM_PROJECTION_RIBBON_WIDTH) < 5e-5);
      assert.ok(Math.abs((ribbon[left] + ribbon[right]) / 2 - centerline[endpoint]) < 3e-5);
      assert.ok(Math.abs((ribbon[left + 2] + ribbon[right + 2]) / 2 - centerline[endpoint + 2]) < 3e-5);
    }
    assert.deepEqual(ribbon.slice(p + 6, p + 9), ribbon.slice(p + 9, p + 12));
    assert.deepEqual(ribbon.slice(p + 3, p + 6), ribbon.slice(p + 12, p + 15));
  }
});

test('all four ribbon corners independently follow the water, not interpolated center heights', () => {
  const water = { height: (x: number, z: number, t: number) => Math.sin(x / 20 + t) + Math.cos(z / 30 - t) };
  const centerline = buffer(), ribbon = ribbonBuffer();
  const center = projectAimRing(centerline, 0, 0, -100, 0, sigma, water, 4, true, seaFloor);
  const result = projectAimRibbon(ribbon, centerline, center.segments, water, 4, seaFloor);
  assert.ok(result.valid);
  for (let i = 0; i < result.segments * 18; i += 3) {
    assert.ok(Math.abs(ribbon[i + 1] - water.height(ribbon[i], ribbon[i + 2], 4)
      - AIM_PROJECTION_HEIGHT_OFFSET) < 2e-6);
  }
});

test('ribbon rejects land under its width and compacts strips without bridging gaps', () => {
  // All centerlines are wet; only the first strip's right side overlaps land.
  const centerline = new Float32Array([0, 0, 0, 4, 0, 0, 10, 0, 0, 14, 0, 0]);
  const ribbon = ribbonBuffer();
  const shore = (x: number, z: number) => x < 5 && z < -0.2 ? 2 : -100;
  const result = projectAimRibbon(ribbon, centerline, 2, flat, 0, shore);
  assert.deepEqual(result, { valid: true, segments: 1 });
  for (let i = 0; i < 18; i += 3) {
    assert.ok(ribbon[i] >= 10 && ribbon[i] <= 14);
    assert.ok(shore(ribbon[i], ribbon[i + 2]) <= 0);
  }
});

test('ribbon guards nonfinite corners, buffers, time and degenerate edges', () => {
  const centerline = new Float32Array([0, 0, 0, 4, 0, 0]);
  const hidden = { valid: false, segments: 0 };
  const ribbon = ribbonBuffer();
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(projectAimRibbon(ribbon, centerline, 1, flat, bad), hidden);
    assert.deepEqual(projectAimRibbon(ribbon, centerline, 1,
      { height: (_x, z) => z === 0 ? 0 : bad }), hidden);
    assert.deepEqual(projectAimRibbon(ribbon, centerline, 1, flat, 0, () => bad), hidden);
  }
  assert.deepEqual(projectAimRibbon(ribbon, new Float32Array(6), 1), hidden);
  assert.deepEqual(projectAimRibbon(new Float32Array(17), centerline, 1), hidden);
  assert.deepEqual(projectAimRibbon(ribbon, centerline, 2), hidden);
  centerline[0] = NaN;
  assert.deepEqual(projectAimRibbon(ribbon, centerline, 1), hidden);
});
