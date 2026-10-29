import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AIM_MIN_PITCH, AIM_MAX_PITCH, clampAimPitch, aimViewDirection, aimPitchToPoint, traceAimSurface,
} from '../src/render/aimView.ts';

const sea = () => 0;
const origin = { x: 0, y: 100, z: 0 };
const near = (actual: number, expected: number, epsilon = 0.04) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('pitch limits, radians, unit direction and yaw convention', () => {
  assert.equal(AIM_MIN_PITCH, -80 * Math.PI / 180);
  assert.equal(AIM_MAX_PITCH, 65 * Math.PI / 180);
  assert.equal(clampAimPitch(-100), AIM_MIN_PITCH);
  assert.equal(clampAimPitch(100), AIM_MAX_PITCH);
  assert.deepEqual(aimViewDirection(0, 0), { x: 0, y: 0, z: 1 });
  for (const yaw of [0, Math.PI / 2, -Math.PI, 1e308]) {
    for (const pitch of [-100, -0.3, 0, 0.3, 100]) {
      const d = aimViewDirection(yaw, pitch);
      near(Math.hypot(d.x, d.y, d.z), 1, 1e-14);
      assert.equal(Math.sign(d.y), Math.sign(pitch));
    }
  }
  near(aimViewDirection(Math.PI / 2, 0).x, 1, 1e-14);
});

test('sight pitch is geometric, translation invariant and independent of camera height', () => {
  near(aimPitchToPoint(origin, { x: 0, y: 0, z: 100 }), -Math.PI / 4, 1e-14);
  near(aimPitchToPoint(origin, { x: 0, y: 200, z: 0 }), Math.PI / 2, 1e-14);
  assert.equal(aimPitchToPoint(origin, origin), 0);
  for (const camera of [origin, { x: 1500, y: 20, z: -3000 }, { x: -400, y: 700, z: 800 }]) {
    const target = { x: camera.x + 350, y: 0, z: camera.z + 800 };
    const pitch = aimPitchToPoint(camera, target);
    const hit = traceAimSurface(camera, aimViewDirection(Math.atan2(350, 800), pitch), 5000, sea);
    assert.ok(hit);
    near(hit.x, target.x); near(hit.y, 0); near(hit.z, target.z);
    near(hit.distance, Math.hypot(350, camera.y, 800));
    near(aimPitchToPoint(camera, target), aimPitchToPoint(
      { x: camera.x + 20, y: camera.y + 30, z: camera.z - 40 },
      { x: target.x + 20, y: target.y + 30, z: target.z - 40 }), 1e-14);
  }
});

test('flat sea: upward/horizon miss, downward near and far hits, exact max-distance endpoint', () => {
  for (const pitch of [0, 0.01, 0.8]) {
    assert.equal(traceAimSurface(origin, aimViewDirection(0, pitch), 26000, sea), null);
  }
  for (const range of [0, 0.1, 20, 500, 24000, 25500]) {
    const direction = { x: 0, y: -100, z: range };
    const distance = Math.hypot(100, range);
    const hit = traceAimSurface(origin, direction, distance + 1, sea);
    assert.ok(hit);
    near(hit.z, range); near(hit.y, 0); near(hit.distance, distance);
    assert.equal(traceAimSurface(origin, direction, distance - 0.1, sea), null);
  }
  const hit = traceAimSurface(origin, { x: 0, y: -1, z: 0 }, 100, sea);
  assert.ok(hit); near(hit.distance, 100);
  const local = traceAimSurface({ x: 50, y: 0.2, z: 80 }, aimViewDirection(0, AIM_MIN_PITCH), 100, sea);
  assert.ok(local); near(local.distance, 0.2 / -Math.sin(AIM_MIN_PITCH), 0.006);
  const onSea = { x: 0, y: 0, z: 0 };
  assert.equal(traceAimSurface(onSea, { x: 0, y: 0, z: 1 }, 25000, sea), null);
  assert.equal(traceAimSurface(onSea, { x: 0, y: 1, z: 1 }, 25000, sea), null);
  const departingDown = traceAimSurface(onSea, { x: 0, y: -1, z: 0 }, 100, sea);
  assert.ok(departingDown); near(departingDown.distance, 0, 0.006);
});

test('first island crossing wins, including upward rays and very high cameras', () => {
  const mountain = (_x: number, z: number) => Math.max(0, 400 - Math.abs(z - 600));
  const upward = traceAimSurface(origin, { x: 0, y: 0.1, z: 1 }, 25000, mountain);
  assert.ok(upward); near(upward.z, 300 / 0.9);
  near(upward.y, mountain(upward.x, upward.z));
  const downward = traceAimSurface(origin, { x: 0, y: -0.01, z: 1 }, 25000, mountain);
  assert.ok(downward); assert.ok(downward.z < upward.z);
  const high = traceAimSurface({ x: 0, y: 100000, z: 0 }, { x: 0, y: 0, z: 1 },
    25000, (_x, z) => Math.max(0, 101000 - Math.abs(z - 3000)));
  assert.ok(high); near(high.z, 2000);
});

test('finite budget for long horizon, far hits, mountains and extreme finite distances', () => {
  for (const maxDistance of [25000, 28000, 100000, Number.MAX_VALUE]) {
    for (const direction of [{ x: 0, y: 0, z: 1 }, { x: 0, y: -0.004, z: 1 }]) {
      let calls = 0;
      const hit = traceAimSurface(origin, direction, maxDistance, () => { calls++; return 0; });
      assert.ok(calls <= 420, `${calls} height calls`);
      if (hit) assert.ok(Object.values(hit).every(Number.isFinite));
    }
  }
});

test('direction normalization handles huge and subnormal vectors without changing ray distance', () => {
  for (const magnitude of [Number.MIN_VALUE, 1, 1e308]) {
    const hit = traceAimSurface(origin, { x: 0, y: -magnitude, z: magnitude }, 1000, sea);
    assert.ok(hit); near(hit.distance, Math.SQRT2 * 100); near(hit.z, 100);
  }
  near(aimPitchToPoint({ x: -1e308, y: -1e308, z: 0 }, { x: 1e308, y: 1e308, z: 0 }),
    Math.PI / 4, 1e-14);
  assert.equal(aimPitchToPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: Number.MIN_VALUE, z: 0 }), Math.PI / 2);
});

test('invalid inputs, below-surface origins and unknown heights never invent a sea hit', () => {
  const down = { x: 0, y: -1, z: 1 };
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(clampAimPitch(bad), 0);
    assert.deepEqual(aimViewDirection(bad, bad), { x: 0, y: 0, z: 1 });
    for (const axis of ['x', 'y', 'z']) {
      assert.equal(aimPitchToPoint({ ...origin, [axis]: bad }, origin), 0);
      assert.equal(aimPitchToPoint(origin, { ...origin, [axis]: bad }), 0);
      assert.equal(traceAimSurface({ ...origin, [axis]: bad }, down, 25000, sea), null);
      assert.equal(traceAimSurface(origin, { ...down, [axis]: bad }, 25000, sea), null);
    }
    assert.equal(traceAimSurface(origin, down, bad, sea), null);
    assert.equal(traceAimSurface(origin, down, 25000, () => bad), null);
    assert.equal(traceAimSurface(origin, down, 25000, (_x, z) => z > 30 ? bad : 0), null);
  }
  for (const distance of [0, -1]) assert.equal(traceAimSurface(origin, down, distance, sea), null);
  assert.equal(traceAimSurface(origin, { x: 0, y: 0, z: 0 }, 25000, sea), null);
  assert.equal(traceAimSurface({ ...origin, y: -1 }, down, 25000, sea), null);
  // The crossing endpoints are known but refinement runs into missing surface data.
  assert.equal(traceAimSurface(origin, { x: 0, y: -1, z: 0 }, 1000,
    () => NaN), null);
  let calls = 0;
  assert.equal(traceAimSurface(origin, down, 1000, () => ++calls > 7 ? NaN : 0), null);
});
