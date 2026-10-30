// Persistent stern-wake ribbons trailing each moving ship: a widening, fading foam strip
// floating on the wave surface. One dynamic mesh per ship; vertex heights are re-floated
// on the waves every other frame for nearby ships and at a low rate for distant ones.

import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY } from './engine';
import type { Water, FoamShip } from './water';

const MAX_POINTS = 200;       // ~24 s of trail per ship
const SAMPLE_DT = 0.12;       // seconds between stern samples
const LIFE = MAX_POINTS * SAMPLE_DT;
const MIN_SPEED = 0.8;        // m/s; slower hulls leave no trail
const W0 = 2.4;               // initial half-width, metres
const GROW = 0.9;             // half-width growth per second of age
const LIFT = 0.14;            // hover above the local wave surface
const NEAR = 3200;            // full-rate re-float distance

const VERT = /* glsl */ `
attribute float aBirth;
attribute float aSide;
uniform float uTime;
varying float vAge;
varying float vSide;
varying vec3 vWorld;
void main() {
  vAge = uTime - aBirth;
  vSide = aSide;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uEye, uFog;
uniform float uFogDensity, uLife;
varying float vAge;
varying float vSide;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
    mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float ageN = clamp(vAge / uLife, 0.0, 1.0);
  float edge = 1.0 - vSide * vSide;
  float alpha = pow(1.0 - ageN, 1.5) * edge * sqrt(edge);
  // Fresh churn right behind the stern is the brightest; older trail settles fainter.
  alpha *= 0.55 + 0.45 * exp(-vAge * 0.5);
  // Streaks churned along the flow, stretched with age like real dispersing foam.
  vec2 q = vec2(vWorld.x * 0.55, vWorld.z * 0.55);
  float streak = vnoise(q + vec2(vAge * 0.35, -vAge * 0.22))
    * vnoise(q * 2.7 + vec2(-vAge * 0.9, vAge * 0.5));
  alpha *= 0.25 + 0.75 * smoothstep(0.08, 0.5, streak);
  alpha *= 0.45;
  if (alpha < 0.004) discard;
  float dist = length(uEye - vWorld);
  vec3 seaFog = mix(uFog, vec3(0.14, 0.26, 0.35), 0.55);
  float fog = 1.0 - exp(-uFogDensity * dist * 0.85);
  vec3 col = mix(vec3(0.60, 0.68, 0.70), seaFog, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha * (1.0 - fog * 0.7));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
interface Trail {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  points: { x: number; z: number; birth: number }[]; // newest first
  lastSample: number;
  lastFloat: number;
}

export interface Wakes {
  update(_dt: number, t: number, ships: readonly FoamShip[], water: Water, eye: THREE.Vector3): void;
  reset(): void;
  dispose(): void;
}

export function createWakes(scene: THREE.Scene): Wakes {
  const trails = new Map<number, Trail>();
  let frame = 0;

  function makeTrail(): Trail {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_POINTS * 2 * 3);
    const birth = new Float32Array(MAX_POINTS * 2);
    const side = new Float32Array(MAX_POINTS * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array((MAX_POINTS - 1) * 6);
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2, o = i * 6;
      idx[o] = a; idx[o + 1] = a + 1; idx[o + 2] = a + 2;
      idx[o + 3] = a + 1; idx[o + 4] = a + 3; idx[o + 5] = a + 2;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 }, uLife: { value: LIFE },
        uEye: { value: new THREE.Vector3() },
        uFog: { value: FOG_COLOR.clone() }, uFogDensity: { value: FOG_DENSITY },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, geo, points: [], lastSample: -1e9, lastFloat: -1e9 };
  }

  function rebuild(tr: Trail, t: number, water: Water) {
    const pts = tr.points;
    const pos = tr.geo.attributes.position as THREE.BufferAttribute;
    const birth = tr.geo.attributes.aBirth as THREE.BufferAttribute;
    const side = tr.geo.attributes.aSide as THREE.BufferAttribute;
    let n = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const age = t - p.birth;
      if (age > LIFE) { pts.length = i; break; }
      const q = pts[Math.min(i + 1, pts.length - 1)];
      let dx = p.x - q.x, dz = p.z - q.z;
      const len0 = Math.hypot(dx, dz);
      if (len0 < 0.01) { dx = 0; dz = 1; } else { dx /= len0; dz /= len0; }
      const px = -dz, pz = dx;
      const w = W0 + age * GROW;
      const h = water.height(p.x, p.z, t) + LIFT;
      pos.setXYZ(n, p.x + px * w, h, p.z + pz * w);
      birth.setX(n, p.birth); side.setX(n, 1); n++;
      pos.setXYZ(n, p.x - px * w, h, p.z - pz * w);
      birth.setX(n, p.birth); side.setX(n, -1); n++;
    }
    pos.needsUpdate = true; birth.needsUpdate = true; side.needsUpdate = true;
    tr.geo.setDrawRange(0, n >= 4 ? ((n >> 1) - 1) * 6 : 0);
  }

  return {
    update(_dt, t, ships, water, eye) {
      frame++;
      const alive = new Set<number>();
      for (const s of ships) {
        if (s.removed) continue;
        alive.add(s.id);
        let tr = trails.get(s.id);
        const moving = s.alive && Math.abs(s.speed) > MIN_SPEED;
        if (moving) {
          if (!tr) { tr = makeTrail(); trails.set(s.id, tr); }
          if (t - tr.lastSample >= SAMPLE_DT) {
            tr.lastSample = t;
            const sn = Math.sin(s.heading), cs = Math.cos(s.heading);
            const sx = s.x - sn * s.spec.L * 0.46, sz = s.z - cs * s.spec.L * 0.46;
            const last = tr.points[0];
            if (!last || Math.hypot(sx - last.x, sz - last.z) > 0.5)
              tr.points.unshift({ x: sx, z: sz, birth: t });
            if (tr.points.length > MAX_POINTS) tr.points.length = MAX_POINTS;
          }
        }
        if (!tr || !tr.points.length) continue;
        const near = Math.hypot(s.x - eye.x, s.z - eye.z) < NEAR;
        const rate = near ? 3 : 10;
        if (frame - tr.lastFloat >= rate) {
          tr.lastFloat = frame;
          rebuild(tr, t, water);
        }
        const mat = tr.mesh.material as THREE.ShaderMaterial;
        mat.uniforms.uTime.value = t;
        (mat.uniforms.uEye.value as THREE.Vector3).copy(eye);
      }
      // Retire trails of removed ships once every point has aged out.
      for (const [id, tr] of trails) {
        if (alive.has(id)) continue;
        if (!tr.points.length || t - tr.points[tr.points.length - 1].birth > LIFE) {
          scene.remove(tr.mesh);
          tr.geo.dispose();
          (tr.mesh.material as THREE.Material).dispose();
          trails.delete(id);
        }
      }
    },
    reset() {
      for (const tr of trails.values()) { tr.points.length = 0; tr.geo.setDrawRange(0, 0); }
    },
    dispose() {
      for (const tr of trails.values()) {
        scene.remove(tr.mesh);
        tr.geo.dispose();
        (tr.mesh.material as THREE.Material).dispose();
      }
      trails.clear();
    },
  };
}
