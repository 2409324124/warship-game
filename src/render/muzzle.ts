import * as THREE from 'three';
import { MuzzleSimulation } from './muzzleModel.ts';
import type { MuzzlePool } from './muzzleModel.ts';

const VS = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aShape; // world diameter, rotation, alpha, aspect
attribute vec3 aAxis;
attribute vec3 aColor;
varying vec2 vUv;
varying vec4 vColor;
uniform float uScreenCap;
void main() {
  vec4 center = modelViewMatrix * vec4(aCenter, 1.0);
  float depth = max(0.1, -center.z);
  // Smooth cap in viewport-height units: no hardware point-size limit / 72 px beads.
  vec3 viewAxis = (modelViewMatrix * vec4(aAxis, 0.0)).xyz;
  float sideView = length(viewAxis.xy) / max(0.001, length(viewAxis));
  vec2 direction = sideView > 0.01 ? normalize(viewAxis.xy) : vec2(1.0, 0.0);
  float stretch = sqrt(mix(1.0, aShape.w, smoothstep(0.05, 0.8, sideView)));
  float projected = aShape.x * stretch * projectionMatrix[1][1] / (2.0 * depth);
  float diameter = aShape.x / sqrt(1.0 + pow(projected / uScreenCap, 2.0));
  float c = cos(aShape.y), s = sin(aShape.y);
  vec2 corner = position.xy * vec2(stretch, 1.0 / stretch);
  corner = mat2(c, -s, s, c) * corner;
  corner = mat2(direction.x, direction.y, -direction.y, direction.x) * corner;
  center.xy += corner * diameter;
  gl_Position = projectionMatrix * center;
  vUv = uv;
  // Fade camera intersections instead of filling the screen when sailing through a cloud.
  float nearFade = smoothstep(0.0, max(1.0, aShape.x * 0.7), -center.z);
  vColor = vec4(aColor, aShape.z * nearFade);
}
`;
const FS = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 texel = texture2D(uMap, vUv);
  float alpha = texel.a * vColor.a;
  if (alpha < 0.0008) discard;
  gl_FragColor = vec4(vColor.rgb * texel.rgb, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Seeded value noise. Generated once; no external assets or canvas dependency. */
function noise(x: number, y: number): number {
  const hash = (ix: number, iy: number) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u;
  const b = hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u;
  return a * (1 - v) + b * v;
}

export function muzzleTexture(flash: boolean): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
      const n = noise(u * 3.8 + 13, v * 3.8 + 9) * 0.6
        + noise(u * 8.5 + 3, v * 8.5 + 7) * 0.28 + noise(u * 19, v * 19) * 0.12;
      const radius = Math.hypot(u, v);
      const i = (y * size + x) * 4;
      let alpha: number;
      if (flash) {
        // Narrow asymmetric torch, warm white vein and orange ragged envelope, not a white disk.
        const width = (0.24 + 0.30 * (1 - (u + 1) * 0.5)) * (0.65 + n * 0.7);
        const envelope = Math.max(0, 1 - Math.abs(v) / width);
        const ends = Math.max(0, 1 - Math.abs(u)) ** 0.65;
        const core = Math.exp(-v * v / 0.004) * Math.max(0, 1 - Math.abs(u + 0.2));
        alpha = envelope ** 1.3 * ends * (0.6 + n * 0.4);
        data[i] = 255;
        data[i + 1] = Math.round(255 * (0.12 + core * 0.80));
        data[i + 2] = Math.round(255 * (0.008 + core * 0.72));
      } else {
        // Warp the boundary and cut internal low-density channels. No uniform opaque centre.
        const edge = Math.max(0, 1 - radius / (0.67 + n * 0.30));
        const channels = Math.max(0, (n - 0.12) / 0.88);
        alpha = Math.min(1, edge * 3) ** 1.6 * channels ** 1.1 * 1.05;
        const shade = 0.58 + n * 0.37 + v * 0.05;
        data[i] = data[i + 1] = data[i + 2] = Math.round(shade * 255);
      }
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

class MuzzleLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly centers: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly axes: THREE.InstancedBufferAttribute;
  private readonly pool: MuzzlePool;

  constructor(scene: THREE.Scene, pool: MuzzlePool) {
    this.pool = pool;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.attributes.position);
    geometry.setAttribute('uv', quad.attributes.uv);
    this.centers = new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * 3), 3)
      .setUsage(THREE.DynamicDrawUsage);
    this.shapes = new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * 4), 4)
      .setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * 3), 3)
      .setUsage(THREE.DynamicDrawUsage);
    this.axes = new THREE.InstancedBufferAttribute(new Float32Array(pool.capacity * 3), 3)
      .setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aCenter', this.centers);
    geometry.setAttribute('aShape', this.shapes);
    geometry.setAttribute('aColor', this.colors);
    geometry.setAttribute('aAxis', this.axes);
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { uMap: { value: muzzleTexture(pool.flash) }, uScreenCap: { value: pool.flash ? 0.24 : 0.30 } },
      transparent: true, depthWrite: false, depthTest: true,
      blending: pool.flash ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = pool.flash ? 'muzzle-flash' : 'muzzle-smoke';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // Flash is rendered after smoke, so the normal-blended cloud cannot swallow the first frame.
    this.mesh.renderOrder = pool.flash ? 12 : 11;
    scene.add(this.mesh);
  }

  sync(): void {
    const count = this.pool.count;
    this.mesh.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    for (let i = 0; i < count; i++) {
      const p = this.pool.particles[i];
      this.centers.setXYZ(i, p.x, p.y, p.z);
      this.shapes.setXYZW(i, p.size, p.rotation + p.age * p.spin, p.alpha, p.aspect);
      const wind = this.pool.flash ? 0 : Math.min(1, p.age / 5) * p.warmth;
      this.axes.setXYZ(i, p.ax * (1 - wind) + p.wx * wind,
        p.ay * (1 - wind) + p.wy * wind, p.az * (1 - wind) + p.wz * wind);
      this.colors.setXYZ(i, p.r, p.g, p.b);
    }
    if (!count) return;
    for (const attr of [this.centers, this.shapes, this.colors, this.axes]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
}

/** Two independent fixed budgets / at most two draw calls, regardless of barrel count. */
export class MuzzleEffects {
  private readonly simulation = new MuzzleSimulation();
  private readonly smoke: MuzzleLayer;
  private readonly flash: MuzzleLayer;
  constructor(scene: THREE.Scene) {
    this.smoke = new MuzzleLayer(scene, this.simulation.smoke);
    this.flash = new MuzzleLayer(scene, this.simulation.flash);
  }
  emit(x: number, y: number, z: number, bearing: number, cal: number, elevation = 0): void {
    this.simulation.emit(x, y, z, bearing, cal, elevation);
  }
  update(dt: number): void {
    this.simulation.update(dt);
    this.smoke.sync(); this.flash.sync();
  }
  reset(): void { this.simulation.reset(); this.smoke.sync(); this.flash.sync(); }
  stats() {
    return { ...this.simulation.stats(), drawCalls: Number(this.smoke.mesh.visible) + Number(this.flash.mesh.visible) };
  }
}
