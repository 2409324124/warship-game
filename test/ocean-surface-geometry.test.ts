import test from 'node:test';
import assert from 'node:assert/strict';
import {waterTriangleHeight} from '../src/render/oceanSurfaceGeometry.ts';
test('sea decals use the same diagonal and barycentric triangles as PlaneGeometry',()=>{
  const axis=[0,10],h=(x:number,z:number)=>x*z;
  assert.equal(waterTriangleHeight(2,3,0,axis,axis,0,0,h),0);
  assert.equal(waterTriangleHeight(8,7,0,axis,axis,0,0,h),50);
  assert.equal(waterTriangleHeight(10,10,0,axis,axis,0,0,h),100);
});
test('graded mesh tracks current camera translation and wave time',()=>{
  const axis=[-100,-5,0,5,100],h=(x:number,z:number,t:number)=>x*.1+z*.3+t;
  for(const [x,z] of [[1008,-260],[1000,-300],[999,-298]]) {
    assert.ok(Math.abs(waterTriangleHeight(x,z,7,axis,axis,1000,-300,h)-h(x,z,7))<1e-10);
  }
});
test('distant decals follow visible triangles instead of the buried continuous trough',()=>{
  const axis=[0,1000],wave=(x:number,z:number)=>-2*Math.sin(x*Math.PI/1000)*Math.sin(z*Math.PI/1000);
  assert.equal(wave(500,500),-2);
  assert.ok(Math.abs(waterTriangleHeight(500,500,0,axis,axis,0,0,wave))<1e-10);
  assert.ok(Number.isNaN(waterTriangleHeight(NaN,0,0,axis,axis,0,0,wave)));
});
