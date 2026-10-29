import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraControls } from '../src/render/battleCamera.ts';

test('defaults, mode priority and exact binocular FOVs', () => {
  const c = new CameraControls();
  assert.equal(c.level, 0);
  assert.equal(c.group, 0);
  assert.equal(c.bridge, false);
  assert.equal(c.freeLook, false);
  assert.equal(c.follow, null);
  for (const level of [0, 1, 2, 3, 4, 5]) {
    c.level = level;
    assert.equal(c.mode, level >= 3 ? 'binocular' : level === 2 ? 'weapon' : 'ship');
    assert.equal(c.zoomTarget, level >= 3 ? 1 : 0);
    assert.equal(c.binocularFov, level === 3 ? 18 : level === 5 ? 7.5 : 11);
  }
  c.toggleBridge();
  assert.equal(c.mode, 'bridge');
  assert.equal(c.level, 5);
  c.followProjectile({ kind: 'shell', id: 1 });
  assert.equal(c.mode, 'projectile');
});

test('wheel moves one level with bounds and binocular toggle remembers non-scope level', () => {
  const c = new CameraControls();
  for (let i = 0; i < 8; i++) {
    c.wheel(100);
    assert.equal(c.level, Math.min(i + 1, 5));
  }
  c.toggleBinocular();
  assert.equal(c.level, 2);
  for (const level of [0, 1, 2]) {
    c.level = level;
    c.toggleBinocular();
    assert.equal(c.level, 4);
    c.wheel(1);
    c.toggleBinocular();
    assert.equal(c.level, level);
  }
  c.level = 4;
  c.wheel(-1);
  c.wheel(-1);
  c.toggleBinocular();
  c.toggleBinocular();
  assert.equal(c.level, 2);
  for (let i = 0; i < 8; i++) c.wheel(-100);
  assert.equal(c.level, 0);
  c.toggleBridge();
  c.wheel(1);
  assert.equal(c.bridge, false);
  assert.equal(c.level, 1);
});

test('short C cycles groups; long C toggles weapon and previous 0/1 exterior', () => {
  const c = new CameraControls();
  c.level = 1;
  c.cycleGroup(3);
  assert.equal(c.level, 2);
  assert.equal(c.group, 1);
  c.cycleGroup(3);
  c.cycleGroup(3);
  assert.equal(c.group, 0);
  c.toggleWeapon();
  assert.equal(c.level, 1);
  c.toggleWeapon();
  assert.equal(c.level, 2);
  c.toggleWeapon();
  assert.equal(c.level, 1);
  c.level = 0;
  c.toggleWeapon();
  c.toggleWeapon();
  assert.equal(c.level, 0);
  c.level = 1;
  for (const level of [3, 4, 5]) {
    c.level = level;
    c.cycleGroup(2);
    assert.equal(c.level, level);
  }
  c.toggleWeapon();
  assert.equal(c.level, 2);
  c.toggleWeapon();
  assert.equal(c.level, 1);
  c.toggleBridge();
  c.toggleWeapon();
  assert.equal(c.bridge, false);
  assert.equal(c.level, 2);
});

test('bridge is an overlay without losing level, including scope and group changes', () => {
  const c = new CameraControls();
  c.level = 5;
  c.toggleBridge();
  c.cycleGroup(2);
  assert.equal(c.mode, 'bridge');
  assert.equal(c.level, 5);
  c.toggleBridge();
  assert.equal(c.mode, 'binocular');
  assert.equal(c.level, 5);
});

test('free look uses independent radians, wraps yaw, clamps pitch and preserves zoom', () => {
  const c = new CameraControls();
  c.level = 5;
  c.beginFreeLook(.4, .2);
  c.moveLook(.1, .3);
  assert.ok(Math.abs(c.lookYaw - .5) < 1e-12);
  assert.equal(c.lookPitch, .5);
  c.moveLook(20 * Math.PI, 10);
  assert.ok(Math.abs(c.lookYaw - .5) < 1e-12);
  assert.equal(c.lookPitch, 1.15);
  c.moveLook(-21 * Math.PI, -10);
  assert.ok(c.lookYaw >= -Math.PI && c.lookYaw < Math.PI);
  assert.equal(c.lookPitch, -.25);
  assert.equal(c.level, 5);
  assert.equal(c.binocularFov, 7.5);
  c.endFreeLook();
  const yaw = c.lookYaw;
  c.moveLook(1, 1);
  assert.equal(c.lookYaw, yaw);
  c.beginFreeLook(0);
  assert.equal(c.lookPitch, 0);
});

test('follow restores original level/bridge, rejects free look and survives projectile switches', () => {
  const c = new CameraControls();
  c.level = 1;
  c.toggleBinocular();
  c.toggleBridge();
  c.beginFreeLook(.7, .4);
  const ref = { kind: 'shell' as const, id: 5 };
  c.followProjectile(ref);
  ref.id = 9;
  assert.equal(c.follow?.id, 5);
  assert.equal(c.freeLook, false);
  c.beginFreeLook(1, 1);
  c.moveLook(1, 1);
  assert.equal(c.freeLook, false);
  assert.ok(Math.abs(c.lookYaw - .7) < 1e-12);
  c.cycleGroup(3);
  assert.equal(c.follow?.id, 5);
  c.followProjectile({ kind: 'torpedo', id: 7 });
  c.validateFollow(true);
  assert.equal(c.mode, 'projectile');
  c.validateFollow(false);
  assert.equal(c.follow, null);
  assert.equal(c.level, 4);
  assert.equal(c.bridge, true);
  c.exitFollow();
  c.toggleBridge();
  c.toggleBinocular();
  assert.equal(c.level, 1);
});

test('wheel, binocular and weapon commands only exit follow, without double transitions', () => {
  for (const action of ['wheel', 'toggleBinocular', 'toggleWeapon'] as const) {
    for (const level of [0, 1, 2, 3, 4, 5]) {
      const c = new CameraControls();
      c.level = level;
      c.toggleBridge();
      c.followProjectile({ kind: 'shell', id: 0 });
      if (action === 'wheel') c.wheel(1);
      else c[action]();
      assert.equal(c.follow, null);
      assert.equal(c.level, level);
      assert.equal(c.bridge, true);
    }
  }
});

test('invalid numeric input stays finite; reset clears state and all restoration history', () => {
  const c = new CameraControls();
  for (const value of [NaN, Infinity, -Infinity]) {
    c.level = value;
    c.group = value;
    c.lookYaw = value;
    c.lookPitch = value;
    c.wheel(value);
    c.cycleGroup(value);
    c.beginFreeLook(value, value);
    c.moveLook(value, value);
    c.followProjectile({ kind: 'shell', id: value });
  }
  c.cycleGroup(0);
  c.cycleGroup(-2);
  c.cycleGroup(.5);
  c.wheel(0);
  assert.equal(c.level, 0);
  assert.equal(c.group, 0);
  assert.equal(c.follow, null);
  assert.ok([c.level, c.group, c.lookYaw, c.lookPitch, c.binocularFov].every(Number.isFinite));
  c.level = -10;
  assert.equal(c.level, 0);
  c.level = 99;
  assert.equal(c.level, 5);
  c.level = 1;
  c.toggleBinocular();
  c.toggleBridge();
  c.group = 4;
  c.followProjectile({ kind: 'torpedo', id: 2 });
  c.reset();
  assert.equal(c.mode, 'ship');
  assert.equal(c.level, 0);
  assert.equal(c.group, 0);
  assert.equal(c.zoomTarget, 0);
  assert.equal(c.bridge, false);
  assert.equal(c.freeLook, false);
  assert.equal(c.lookYaw, 0);
  assert.equal(c.lookPitch, 0);
  assert.equal(c.follow, null);
  c.exitFollow();
  c.toggleBinocular();
  c.toggleBinocular();
  assert.equal(c.level, 0);
  c.toggleWeapon();
  c.toggleWeapon();
  assert.equal(c.level, 0);
});
