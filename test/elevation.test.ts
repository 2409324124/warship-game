import test from 'node:test';
import assert from 'node:assert/strict';
import { clampElevation, elevationFor, makeGun, solveShot } from '../src/sim/ballistics.ts';
import { GUNS } from '../src/sim/guns.ts';
import { Ship } from '../src/sim/ship.ts';
import { World } from '../src/sim/world.ts';
import { fireTurret, muzzleWorld, updateTurrets } from '../src/sim/gunnery.ts';

test('all main batteries have a 45 degree mechanical elevation limit', () => {
  for (const id of ['us406','us203','us127','jp356','jp203','jp127']) {
    assert.equal(GUNS[id].elevMax,45,id);
    assert.equal(clampElevation(GUNS[id],Math.PI),Math.PI/4,id);
  }
});

test('elevation limits constrain the actual shell velocity as well as the sight', () => {
  const gun=makeGun({...GUNS.jp356,id:'high-arc-test',arc:1});
  const shot=solveShot(gun,0,0,0,0,gun.range);
  assert.equal(shot.reachable,false);
  assert.equal(shot.elev,Math.PI/4);
  assert.ok(Math.abs(Math.atan2(shot.vy,Math.hypot(shot.vx,shot.vz))-Math.PI/4)<1e-12);
  assert.equal(elevationFor(gun,gun.range),Math.PI/4);
});

test('unreachable elevation holds fire without consuming ammunition or reload', () => {
  const world=new World();const ship=new Ship(world,'jp_bb','JP','Elevation QA');
  const turret=ship.mainTurrets[0];
  turret.gun=makeGun({...GUNS.jp356,id:'high-arc-test',arc:1});turret.reload=0;turret.elev=3;
  ship.aimX=0;ship.aimZ=18000;
  updateTurrets(ship,1);
  assert.equal(turret.elev,Math.PI/4);
  assert.equal(turret.onTarget,false);
  fireTurret(world,ship,turret,ship.aimX,ship.aimZ,0);
  assert.equal(world.shells.length,0);assert.ok(turret.reload<=0);assert.equal(ship.stats.shots,0);
});

test('muzzle position uses the same clamped elevation as the renderer', () => {
  const ship=new Ship(new World(),'jp_bb','JP','Muzzle QA');const t=ship.mainTurrets[0];
  t.rel=0;t.elev=Math.PI/2;
  const p=muzzleWorld(ship,t,0);
  assert.ok(Math.abs(p[1]-(t.y+t.ts.h/2+t.ts.bl/Math.sqrt(2)))<1e-9);
  assert.ok(Math.abs(p[2]-(t.z+t.ts.len*.18+t.ts.bl/Math.sqrt(2)))<1e-9);
});

test('casemate guns use restricted traverse and elevation without moving mounts', () => {
  const ship=new Ship(new World(),'jp_bb','JP','Casemate QA');
  assert.equal(ship.secTurrets.length,8);
  for (const t of ship.secTurrets) {
    assert.ok(Math.abs(t.arc-35*Math.PI/180)<1e-12);
    assert.equal(t.gun.elevMax,20);
  }
});
