import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildVisualFoam, waterlineFromModel } from '../src/render/visualHull.ts';

test('exported waterline is validated before replacing the procedural hull', () => {
  const model=new THREE.Group();const node=new THREE.Object3D();model.add(node);
  assert.equal(waterlineFromModel(model),null);
  node.userData.waterlineStations='[[0.55,15,10],[1,0,108]]';
  assert.deepEqual(waterlineFromModel(model),[[.55,15,10],[1,0,108]]);
  for (const invalid of ['bad JSON','[[0.7,-3,20],[1,0,108]]','[[0.8,4,30],[0.6,5,20]]','[[1,0,108]]']) {
    node.userData.waterlineStations=invalid;assert.equal(waterlineFromModel(model),null);
  }
});

test('foam stays on each side of the custom hull instead of bridging across the deck', () => {
  const geometry=buildVisualFoam([[.55,15,10],[.8,8,65],[1,0,108]]);
  const positions=geometry.getAttribute('position');const index=geometry.getIndex()!;
  assert.equal(index.count/3,8);
  for (let i=0;i<index.count;i+=3) {
    const x=[0,1,2].map((j)=>positions.getX(index.getX(i+j)));
    assert.ok(x.every((n)=>n<0)||x.every((n)=>n>0));
  }
  assert.equal(positions.getZ(0),10);assert.equal(positions.getZ(8),108);
});
