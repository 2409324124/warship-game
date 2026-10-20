// The sea: a Gerstner swell with foam on the crests and along the shore, a Fresnel sky mirror,
// and a sun glitter. One mesh, one shader, no textures except a small height map of the islands.

import * as THREE from 'three';
import { TAU } from '../sim/constants';
import { terrainH } from '../sim/terrain';
import { FOG_COLOR, SUN_DIR } from './engine';

// [direction rad, wavelength m, amplitude m, phase]
const WAVE_DEF: [number, number, number, number][] = [
  [0.35, 210, 1.05, 0.0],
  [-0.55, 128, 0.6, 1.3],
  [1.15, 74, 0.34, 2.1],
  [2.45, 47, 0.2, 4.2],
];

const WAVES = WAVE_DEF.map(([a, L, A, ph]) => {
  const k = TAU / L;
  return { dx: Math.cos(a), dz: Math.sin(a), k, A, w: Math.sqrt(9.81 * k), ph };
});

const COMMON = /* glsl */ `
  uniform vec4 uW0; uniform vec4 uW1; uniform vec4 uW2; uniform vec4 uW3;
  // xy = direction, z = angular wavenumber, w = omega
  uniform float uTime;

  const float G = 9.81;

  // slope of one short travelling wave, as (dH/dx, dH/dz)
  vec2 rippleGrad(vec2 p, vec2 d, float k, float w, float amp) {
    float f = k * dot(d, p) - w * uTime;
    return -d * (k * amp * cos(f));
  }

  uniform int uVertWaves;   // only these are displaced in the vertex stage (see the note below)

  vec3 gerstner(vec2 p, out vec3 nrm, float fade, int count) {
    vec3 disp = vec3(0.0);
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    vec4 W[4];
    W[0] = uW0; W[1] = uW1; W[2] = uW2; W[3] = uW3;
    float A[4];
    A[0] = ${WAVES[0].A.toFixed(3)}; A[1] = ${WAVES[1].A.toFixed(3)};
    A[2] = ${WAVES[2].A.toFixed(3)}; A[3] = ${WAVES[3].A.toFixed(3)};
    float PH[4];
    PH[0] = ${WAVES[0].ph.toFixed(3)}; PH[1] = ${WAVES[1].ph.toFixed(3)};
    PH[2] = ${WAVES[2].ph.toFixed(3)}; PH[3] = ${WAVES[3].ph.toFixed(3)};
    for (int i = 0; i < 4; i++) {
      if (i >= count) break;
      vec2 d = W[i].xy;
      float k = W[i].z;
      float w = W[i].w;
      float amp = A[i] * fade;
      float f = k * dot(d, p) - w * uTime + PH[i];
      float s = sin(f), c = cos(f);
      disp.y += amp * s;
      disp.x += d.x * amp * c;
      disp.z += d.y * amp * c;
      float wa = k * amp;
      tangent += vec3(-d.x * d.x * wa * s, d.x * wa * c, -d.x * d.y * wa * s);
      binormal += vec3(-d.x * d.y * wa * s, d.y * wa * c, -d.y * d.y * wa * s);
    }
    nrm = normalize(cross(binormal, tangent));
    return disp;
  }
`;

const VERT = /* glsl */ `
${COMMON}
uniform vec3 uEye;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFade;
varying float vDist;

void main() {
  vec3 p = position;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vDist = length(world.xyz - uEye);
  vFade = 1.0 - smoothstep(1200.0, 9000.0, vDist);
  // Only the longest swell moves the vertices. The sea grid is about 40 m across out here, so even\n  // a 128 m wave is barely sampled and the surface turns into moire stripes. Everything shorter is\n  // re-applied per pixel in the fragment stage, where there is no grid to fight.
  vec3 nrm;
  vec3 disp = gerstner(world.xz, nrm, mix(0.6, 1.0, vFade * 0.35 + 0.65), uVertWaves);
  world.xyz += disp;
  vWorld = world.xyz;
  vNormal = nrm;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
${COMMON}
uniform vec3 uEye;
uniform vec3 uSun;
uniform vec3 uFog;
uniform vec3 uZenith;
uniform float uFogDensity;
uniform sampler2D uLand;
uniform float uLandScale;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vFade;
varying float vDist;

vec3 skyCol(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uFog, uZenith, pow(h, 0.55));
  float sd = max(dot(d, normalize(uSun)), 0.0);
  c += vec3(1.0, 0.78, 0.55) * pow(sd, 22.0) * 0.5;
  c += vec3(1.0, 0.72, 0.52) * pow(sd, 4.0) * 0.1;
  return c;
}

float landH(vec2 p) {
  vec2 uv = p / (2.0 * uLandScale) + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return -200.0;
  return texture2D(uLand, uv).r * 1000.0 - 100.0;
}

void main() {
  // all four waves, recomputed per pixel: the short ones that the vertex grid cannot carry
  vec3 nAll;
  gerstner(vWorld.xz, nAll, 1.0, 4);
  vec3 n = normalize(mix(normalize(vNormal), nAll, 0.85));
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) n = -n;

  // Fine ripples on top of the swell, added as the slope of three short directional waves.
  // (Multiplying two sines together here would give a plaid pattern - it has to be a sum.)
  // The shortest one fades out with distance, where its wavelength would alias on screen.
  vec2 q = vWorld.xz;
  vec2 g = vec2(0.0);
  g += rippleGrad(q, vec2(0.90, 0.44), 0.33, 2.2, 0.035) * (1.0 - smoothstep(700.0, 2600.0, vDist));
  g += rippleGrad(q, vec2(-0.42, 0.91), 0.19, 1.5, 0.07) * (1.0 - smoothstep(1800.0, 6000.0, vDist));
  g += rippleGrad(q, vec2(0.30, -0.95), 0.10, 1.1, 0.11);
  g += rippleGrad(q, vec2(0.76, -0.65), 0.055, 0.7, 0.13);
  n = normalize(vec3(n.x - g.x, n.y, n.z - g.y));

  float h = landH(vWorld.xz);
  float shallow = smoothstep(-70.0, 8.0, h);
  float shore = smoothstep(-34.0, 2.0, h) * (1.0 - smoothstep(2.0, 46.0, h));

  vec3 deep = vec3(0.043, 0.086, 0.118);
  vec3 shoal = vec3(0.10, 0.26, 0.27);
  vec3 base = mix(deep, shoal, shallow);

  // fresnel to the sky
  float f = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 refl = reflect(-v, n);
  refl.y = abs(refl.y);
  vec3 col = mix(base, skyCol(refl), 0.04 + 0.94 * f);

  // sun glitter: one tight lobe and one broad one. A single hard exponent reads as stripes.
  vec3 hv = normalize(normalize(uSun) + v);
  float nh = max(dot(n, hv), 0.0);
  col += vec3(1.0, 0.86, 0.66) * pow(nh, 90.0) * 0.3;
  col += vec3(1.0, 0.86, 0.68) * pow(nh, 14.0) * 0.05 * (0.3 + 0.7 * vFade);

  // crest foam: where the wave surface is being pinched
  float crest = smoothstep(0.62, 1.15, 1.0 - n.y) * (0.2 + 0.8 * vFade);
  float shoreFoam = shore * (0.75 + 0.25 * sin(uTime * 2.4 + vWorld.x * 0.06 + vWorld.z * 0.05));
  float foam = clamp(crest * 0.32 + shoreFoam, 0.0, 1.0);
  col = mix(col, vec3(0.86, 0.90, 0.92), foam * 0.8);

  // distance fog
  float fog = 1.0 - exp(-uFogDensity * vDist * 0.85);
  col = mix(col, uFog, clamp(fog, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

function landTexture(scale: number): THREE.DataTexture {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 * scale - scale;
      const z = (j / (N - 1)) * 2 * scale - scale;
      const v = Math.max(0, Math.min(1, (terrainH(x, z) + 100) / 1000));
      const o = (j * N + i) * 4;
      const b = Math.round(v * 255);
      data[o] = b;
      data[o + 1] = b;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export interface Water {
  mesh: THREE.Mesh;
  update(t: number, eye: THREE.Vector3): void;
  /** Height of the swell at a world point, so ships can ride it. */
  height(x: number, z: number, t: number): number;
}

export function createWater(scene: THREE.Scene, fogDensity: number): Water {
  const R = 26000,
    N = 300,
    P = 1.9;
  const g = new THREE.PlaneGeometry(2, 2, N, N);
  g.rotateX(-Math.PI / 2);
  const a = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i),
      z = a.getZ(i);
    a.setX(i, Math.sign(x) * Math.pow(Math.abs(x), P) * R);
    a.setZ(i, Math.sign(z) * Math.pow(Math.abs(z), P) * R);
  }
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius = 1e6;

  const land = landTexture(14000);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uEye: { value: new THREE.Vector3() },
      uSun: { value: SUN_DIR.clone() },
      uFog: { value: FOG_COLOR.clone() },
      uZenith: { value: new THREE.Color(0x4d78a8) },
      uFogDensity: { value: fogDensity },
      uLand: { value: land },
      uLandScale: { value: 14000 },
      uW0: { value: new THREE.Vector4(WAVES[0].dx, WAVES[0].dz, WAVES[0].k, WAVES[0].w) },
      uW1: { value: new THREE.Vector4(WAVES[1].dx, WAVES[1].dz, WAVES[1].k, WAVES[1].w) },
      uW2: { value: new THREE.Vector4(WAVES[2].dx, WAVES[2].dz, WAVES[2].k, WAVES[2].w) },
      uW3: { value: new THREE.Vector4(WAVES[3].dx, WAVES[3].dz, WAVES[3].k, WAVES[3].w) },
      uVertWaves: { value: 1 },
    },
    fog: false,
  });

  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  scene.add(mesh);

  return {
    mesh,
    update(t, eye) {
      mat.uniforms.uTime.value = t;
      (mat.uniforms.uEye.value as THREE.Vector3).copy(eye);
    },
    height(x, z, t) {
      let h = 0;
      for (const w of WAVES) {
        h += w.A * Math.sin(w.k * (w.dx * x + w.dz * z) - w.w * t + w.ph);
      }
      return h;
    },
  };
}
