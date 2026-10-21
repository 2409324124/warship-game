// The only interface between Blender and the game.
//
// Nothing imports this yet: it is inert until a .glb is dropped into public/models/. That is on
// purpose - modelling decisions (what exists, where it sits, how big it is) are made in Blender and
// in the ship data, not here. All this does is fetch, cache and hand back an Object3D, and stay
// quiet when the file is not there.

import * as THREE from 'three';

// GLTFLoader is heavy and most sessions will never need it, so it is pulled in on first use.
let loaderPromise: Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader> | null = null;

function getLoader() {
  if (!loaderPromise) {
    loaderPromise = import('three/examples/jsm/loaders/GLTFLoader.js').then((m) => new m.GLTFLoader());
  }
  return loaderPromise;
}

const cache = new Map<string, THREE.Object3D>();
const failed = new Set<string>();

/** `name` is a path under /models without the .glb, e.g. "props/us_bb_floatplane". */
export async function loadModel(name: string): Promise<THREE.Object3D | null> {
  if (failed.has(name)) return null;
  const hit = cache.get(name);
  if (hit) return hit.clone(true);
  const loader = await getLoader();
  return new Promise((resolve) => {
    loader.load(
      `/models/${name}.glb`,
      (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        cache.set(name, root);
        resolve(root.clone(true));
      },
      undefined,
      () => {
        // not built yet - carry on without it
        failed.add(name);
        resolve(null);
      },
    );
  });
}

export function modelMissing(name: string): boolean {
  return failed.has(name);
}

export interface PropPlacement {
  /** Path under /models, without the .glb. */
  model: string;
  /** Hull-local metres: +Z toward the bow, +X to port (west). */
  z: number;
  /** Height above the waterline in metres. Omit to sit on the deck at that station. */
  y?: number;
  x?: number;
  /** Extra yaw, degrees. */
  ry?: number;
  scale?: number;
}

/** Mount a list of placements onto a parent, positioned in that parent's local frame. */
export async function mountProps(
  parent: THREE.Object3D,
  props: PropPlacement[],
  deckAt: (z: number) => number,
): Promise<void> {
  await Promise.all(
    props.map(async (p) => {
      const obj = await loadModel(p.model);
      if (!obj) return;
      obj.position.set(p.x ?? 0, p.y ?? deckAt(p.z) + 1, p.z);
      if (p.ry) obj.rotation.y = (p.ry * Math.PI) / 180;
      if (p.scale) obj.scale.setScalar(p.scale);
      parent.add(obj);
    }),
  );
}
