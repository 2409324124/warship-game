// Aircraft rendering: four InstancedMeshes, one per model kind, so a whole air battle
// costs at most four draw calls. No shadows: planes are sky objects and a shadow pass
// for them would double the frame cost for nothing.

import * as THREE from 'three';
import { buildPlaneGeometry, type PlaneModelKind } from './aircraftModel';
import type { Plane } from '../sim/aircraft';

const KINDS: PlaneModelKind[] = ['us_torp', 'us_dive', 'jp_torp', 'jp_dive'];
const MAX_PER_KIND = 12;

export interface AircraftView {
  sync(planes: readonly Plane[]): void;
}

export function createAircraftView(scene: THREE.Scene): AircraftView {
  const meshes = new Map<PlaneModelKind, THREE.InstancedMesh>();
  for (const k of KINDS) {
    const m = buildPlaneGeometry(k);
    const mesh = new THREE.InstancedMesh(m.geometry, m.material, MAX_PER_KIND);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `planes:${k}`;
    scene.add(mesh);
    meshes.set(k, mesh);
  }
  const dummy = new THREE.Object3D();
  const counts = new Map<PlaneModelKind, number>();
  return {
    sync(planes) {
      for (const k of KINDS) counts.set(k, 0);
      for (const p of planes) {
        if (!p.alive && p.state !== 'falling') continue;
        const kind = ((p.team === "US" ? "us_" : "jp_") + (p.kind === "torp" ? "torp" : "dive")) as PlaneModelKind;
        const mesh = meshes.get(kind);
        if (!mesh) continue;
        const i = counts.get(kind)!;
        if (i >= MAX_PER_KIND) continue;
        counts.set(kind, i + 1);
        const hspeed = Math.hypot(p.vx, p.vz);
        const pitch = Math.atan2(p.vy, Math.max(1, hspeed));
        const roll = p.state === 'falling' ? Math.min(6, p.st * 2.5) : 0;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(1.15);
        dummy.rotation.set(0, 0, 0);
        dummy.rotation.order = 'YXZ';
        dummy.rotation.y = p.heading;
        dummy.rotation.x = -pitch;
        dummy.rotation.z = roll;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      for (const k of KINDS) {
        const mesh = meshes.get(k)!;
        const n = counts.get(k)!;
        if (mesh.count !== n) {
          mesh.count = n;
          mesh.visible = n > 0;
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
