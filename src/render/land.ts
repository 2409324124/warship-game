// The islands. One displaced grid with vertex colours: wet sand, jungle, rock, and a little haze.

import * as THREE from 'three';
import { clamp, sstep, vnoise } from '../sim/constants';
import { terrainH } from '../sim/terrain';

export function createLand(scene: THREE.Scene): THREE.Mesh {
  const N = 240,
    R = 14000;
  const g = new THREE.PlaneGeometry(2 * R, 2 * R, N, N);
  g.rotateX(-Math.PI / 2);
  const a = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(a.count * 3);

  const sand = new THREE.Color(0x9d8a67);
  const jungle = new THREE.Color(0x243a20);
  const jungle2 = new THREE.Color(0x33502b);
  const rock = new THREE.Color(0x5c5750);
  const peak = new THREE.Color(0x6d6a63);
  const tmp = new THREE.Color();

  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i),
      z = a.getZ(i);
    const h = terrainH(x, z);
    a.setY(i, Math.max(h, -30));

    const n = vnoise(x * 0.01, z * 0.01);
    const m = vnoise(x * 0.0035 + 13.7, z * 0.0035 - 4.1);
    if (h < 1) tmp.copy(sand);
    else if (h < 90) tmp.copy(sand).lerp(jungle2, sstep((h - 1) / 45));
    else tmp.copy(jungle).lerp(jungle2, clamp(n * 1.4, 0, 1));
    if (h > 320) tmp.lerp(rock, sstep((h - 320) / 260));
    if (h > 620) tmp.lerp(peak, sstep((h - 620) / 200) * (0.5 + 0.5 * m));
    const shade = 0.86 + 0.28 * m;
    col[i * 3] = tmp.r * shade;
    col[i * 3 + 1] = tmp.g * shade;
    col[i * 3 + 2] = tmp.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  // 115k triangles of terrain self-shadowing is not worth a second pass on iGPUs.
  mesh.castShadow = false;
  scene.add(mesh);
  return mesh;
}
