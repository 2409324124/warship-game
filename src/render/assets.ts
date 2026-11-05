// The only interface between Blender and the game.
//
// Loaded on demand by ShipView. Geometry and layout come from Blender; the
// optional visual hull carries its own waterline for matching foam. Missing
// assets leave the procedural fallback visible.

import * as THREE from 'three';
import { hasModel } from './models';
import { waterlineFromModel, type WaterlineStation } from './visualHull';

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

/** `name` is a path under ./models without the .glb, e.g. "props/us_bb_floatplane". */
export async function loadModel(name: string): Promise<THREE.Object3D | null> {
  if (failed.has(name)) return null;
  if (!hasModel(name)) return null;
  const hit = cache.get(name);
  if (hit) return hit.clone(true);
  const loader = await getLoader();
  return new Promise((resolve) => {
    loader.load(
      `./models/${name}.glb`,
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

/** Which models have actually been loaded - handy for checking an override took effect. */
export function loadedModels(): string[] {
  return [...cache.keys()];
}

/**
 * Blender's superstructure replaces the procedural one.
 *
 * This is an *override*, not a replacement: if `ships/<key>_super.glb` is not there, nothing is
 * hidden and the procedural geometry carries on. `hide` is the list of procedural meshes to turn
 * off once a real model arrives (the superstructure meshes; hull, deck and foam stay).
 */
export async function overrideSuperstructure(
  key: string,
  group: THREE.Object3D,
  hide: THREE.Object3D[],
): Promise<boolean> {
  const obj = await loadModel(`ships/${key}_super`);
  if (!obj) return false;
  obj.userData.overrideRole = 'superstructure';
  // Detach rather than hide: a hidden mesh still costs matrix updates, GPU memory and
  // camera raycasts. Geometry stays in the shared shipModel caches, so nothing is disposed.
  for (const m of hide) m.removeFromParent();
  group.add(obj);
  return true;
}

/** Optional full visual hull; collision and weapon mounts stay in simulation coordinates. */
export async function overrideHull(
  key: string,
  group: THREE.Object3D,
  hide: THREE.Object3D[],
): Promise<WaterlineStation[] | null> {
  const obj = await loadModel(`ships/${key}_hull`);
  if (!obj) return null;
  const waterline = waterlineFromModel(obj);
  // A partial/malformed asset must not hide the usable procedural fallback.
  if (!waterline) return null;
  obj.userData.overrideRole = 'hull';
  for (const mesh of hide) mesh.removeFromParent();
  group.add(obj);
  return waterline;
}

/**
 * Blender's turret replaces the procedural one on the same pivot, so `updateTurrets()` keeps
 * driving bearing and elevation exactly as before.
 *
 * The model is expected to hold two sibling nodes: `base` (rotates in bearing) and `barrel`
 * (pitches, with its own origin at the trunnion). Either one may be absent, in which case the
 * procedural part it would have replaced stays put.
 *
 * @returns the object that should be pitched, or null if the procedural turret stays.
 */
export async function overrideTurret(
  kind: string,
  pivot: THREE.Object3D,
  procBase: THREE.Object3D,
  procBarrel: THREE.Object3D,
): Promise<THREE.Object3D | null> {
  const src = await loadModel(`guns/${kind}`);
  if (!src) return null;
  const baseSrc = src.getObjectByName('base');
  const barrelSrc = src.getObjectByName('barrel');
  if (!baseSrc && !barrelSrc) return null;

  if (baseSrc) {
    pivot.remove(procBase);
    pivot.add(baseSrc.clone(true));
  }
  if (barrelSrc) {
    pivot.remove(procBarrel);
    const b = barrelSrc.clone(true);
    pivot.add(b);
    return b;
  }
  return null;
}

export interface PropPlacement {
  /** Path under ./models, without the .glb. */
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
