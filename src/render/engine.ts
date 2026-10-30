// Renderer, scene, camera, sun. Everything else in render/ hangs off this.

import * as THREE from 'three';

export interface Engine {
  renderer: THREE.WebGLRenderer;
  frame: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  fogColor: THREE.Color;
  fogDensity: number;
  canvas: HTMLCanvasElement;
  resize(): void;
  render(): void;
}

/** Late afternoon over the sound: low warm sun, long shadows, hazy horizon. */
export const SUN_DIR = new THREE.Vector3(-0.86, 0.115, 0.5).normalize();
export const FOG_COLOR = new THREE.Color(0x9aa4ad);
export const FOG_DENSITY = 0.000075;

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // MSAA resolve is costly on iGPUs; at dpr >= 1.25 the aliasing is marginal
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Shadow refresh at half rate: ships move slowly enough that 30 Hz shadows are invisible.
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 3, 90000);

  const sun = new THREE.DirectionalLight(0xffc9a0, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(4000);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.near = 100;
  sc.far = 2600;
  sc.left = -420;
  sc.right = 420;
  sc.top = 420;
  sc.bottom = -420;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 1.2;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbcd2e8, 0x2b3a44, 0.75);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x8fb0d0, 0.35);
  fill.position.set(0.6, 0.5, -0.7).multiplyScalar(1000);
  scene.add(fill);

  const engine: Engine = {
    renderer,
    frame: 0,
    scene,
    camera,
    sun,
    sunDir: SUN_DIR.clone(),
    fogColor: FOG_COLOR.clone(),
    fogDensity: FOG_DENSITY,
    canvas,
    resize() {
      const w = window.innerWidth,
        h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    render() {
      renderer.shadowMap.needsUpdate = (this.frame++ & 1) === 0;
      renderer.render(scene, camera);
    },
  };
  engine.resize();
  return engine;
}
