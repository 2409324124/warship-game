import test from 'node:test';
import assert from 'node:assert/strict';
import { chaseFraming } from '../src/render/chaseCamera.ts';
import { SPECS } from '../src/sim/ships.ts';

test('exterior framing is centered and elevated, with compatible binocular endpoints', () => {
  for (const spec of Object.values(SPECS)) {
    const wide = chaseFraming(spec, 16/9, 0), scope = chaseFraming(spec,16/9,1);
    assert.equal(wide.fov, spec.cls === 'BB' ? 54 : 56);
    assert.equal(wide.back, spec.L * (spec.cls === 'BB' ? 1.55 : 1.8));
    assert.equal(wide.height, Math.max(spec.cls === 'DD' ? 28 : 0, spec.L * .34));
    assert.equal(wide.shoulder, 0);
    assert.equal(scope.fov, 11);
    assert.equal(scope.shoulder, 0);
    assert.equal(scope.back, spec.cam[0] * .55);
    assert.equal(scope.height, spec.cam[1] * .78);
  }
});

test('portrait framing retreats to retain the ship broadside; transition stays finite', () => {
  const spec = SPECS.us_bb;
  assert.ok(chaseFraming(spec,.6,0).back > chaseFraming(spec,16/9,0).back);
  for (const ship of Object.values(SPECS)) {
    for (const aspect of [.35, .6, 1, 16/9]) {
      const frame = chaseFraming(ship, aspect, 0);
      const horizontalTangent = Math.tan(frame.fov * Math.PI / 360) * aspect;
      assert.ok(frame.back * horizontalTangent >= ship.L * .58 - 1e-9);
    }
  }
  for (const aspect of [.6, 1, 16/9, 32/9, NaN, -1, 0, Infinity]) {
    for (const zoom of [-1,0,.25,.5,1,2,NaN,Infinity]) {
      assert.ok(Object.values(chaseFraming(spec,aspect,zoom)).every(Number.isFinite));
    }
  }
});

test('framing clamps zoom and interpolates all continuous endpoints', () => {
  const spec = SPECS.us_bb;
  const far = chaseFraming(spec, 16/9, 0), near = chaseFraming(spec, 16/9, 1);
  assert.deepEqual(chaseFraming(spec, 16/9, -5), far);
  assert.deepEqual(chaseFraming(spec, 16/9, 5), near);
  const middle = chaseFraming(spec, 16/9, .5);
  for (const key of ['fov', 'back', 'height', 'shoulder'] as const) {
    assert.equal(middle[key], (far[key] + near[key]) / 2);
  }
});
