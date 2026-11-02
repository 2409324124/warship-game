import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildPlaneGeometry, type PlaneModelKind } from '../src/render/aircraftModel.ts';

const KINDS: PlaneModelKind[] = ['us_torp', 'us_dive', 'jp_torp', 'jp_dive'];

for (const kind of KINDS) {
  test(`${kind}: merged model has position/normal/color and stays under the triangle budget`, () => {
    const model = buildPlaneGeometry(kind);
    assert.ok(model.tris > 50 && model.tris < 300, `${kind} tris=${model.tris}`);

    const pos = model.geometry.getAttribute('position');
    const nor = model.geometry.getAttribute('normal');
    const col = model.geometry.getAttribute('color');
    assert.ok(pos, 'position attribute');
    assert.ok(nor, 'normal attribute');
    assert.ok(col, 'color attribute');
    for (const a of [pos, nor, col]) assert.equal(a.itemSize, 3);
    assert.equal(pos.count, model.tris * 3);
    assert.equal(pos.count % 3, 0);

    for (const a of [pos, nor, col]) {
      const values = a.array as ArrayLike<number>;
      for (let i = 0; i < values.length; i++) {
        assert.ok(Number.isFinite(values[i]), `${kind} attribute ${a.name} has a non-finite value at ${i}`);
      }
    }

    assert.ok(model.material instanceof THREE.MeshLambertMaterial);
    assert.equal(model.material.vertexColors, true);
  });
}

test('all four kinds share a ~15 m span and a 10-11 m length', () => {
  for (const kind of KINDS) {
    const { geometry } = buildPlaneGeometry(kind);
    const box = geometry.boundingBox;
    assert.ok(box, `${kind} bounding box`);
    const span = box.max.x - box.min.x;
    const length = box.max.z - box.min.z;
    assert.ok(span > 14 && span < 16, `${kind} span=${span}`);
    assert.ok(length > 10 && length < 11, `${kind} length=${length}`);
  }
});

test('same kind returns the cached geometry and material', () => {
  for (const kind of KINDS) {
    const a = buildPlaneGeometry(kind);
    const b = buildPlaneGeometry(kind);
    assert.equal(a.geometry, b.geometry, `${kind} geometry is cached`);
    assert.equal(a.material, b.material, `${kind} material is cached`);
  }
  const unique = new Set(KINDS.map((k) => buildPlaneGeometry(k).geometry));
  assert.equal(unique.size, KINDS.length);
});
