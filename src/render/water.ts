// One camera-centred, graded mesh / one draw call. World-anchored waves never swim with the camera.
import * as THREE from 'three';
import { terrainH } from '../sim/terrain';
import { FOG_COLOR, SUN_DIR } from './engine';
import { OceanBlasts, OCEAN_GLSL, sampleOcean, oceanPhases, BLAST_CAPACITY } from './oceanModel';
import { waterTriangleHeight } from './oceanSurfaceGeometry';

const VERT = /* glsl */ `
${OCEAN_GLSL}
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.y = oceanSurface(world.xz).x + blastSurface(world.xz).x;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
${OCEAN_GLSL}
uniform vec3 uEye, uSun, uFog, uZenith;
uniform float uFogDensity, uLandScale;
uniform sampler2D uLand;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Simplex gradient noise with analytic derivatives: no persistent sinusoidal carrier or
// rectangular interpolation lattice in the normal. Each octave has its own heading and phase.
vec3 noiseCorner(vec2 cell, vec2 p) {
  float angle = hash(cell) * 6.28318530718;
  vec2 g = vec2(cos(angle), sin(angle));
  float m = max(0.5 - dot(p, p), 0.0);
  float m2 = m * m, m3 = m2 * m, m4 = m2 * m2;
  float v = dot(g, p);
  return vec3(m4 * v, m4 * g - 8.0 * m3 * v * p);
}
vec3 noiseD(vec2 p) {
  const float F = 0.366025403784, G = 0.211324865405;
  vec2 cell = floor(p + (p.x + p.y) * F);
  vec2 a = p - cell + (cell.x + cell.y) * G;
  vec2 stepCell = a.x > a.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  return 70.0 * (noiseCorner(cell, a)
    + noiseCorner(cell + stepCell, a - stepCell + G)
    + noiseCorner(cell + 1.0, a - 1.0 + 2.0 * G));
}
void wavelet(inout vec2 slope, vec2 p, vec2 dir, float k, float amp, float speed, vec2 phase) {
  vec2 side = vec2(-dir.y, dir.x);
  vec2 q = vec2(dot(p, dir), dot(p, side) * 0.72) * k + phase;
  q.x -= uTime * speed;
  vec3 n = noiseD(q);
  float footprint = max(length(dFdx(q)), length(dFdy(q)));
  float aa = 1.0 - smoothstep(0.22, 0.85, footprint);
  slope += (dir * n.y + side * n.z * 0.72) * (amp * k * aa);
}
// Short optical roughness/pressure depression only: like fine wavelets this does not move
// vertices or ships. Independent of foam perforation, so a heavy salvo reads on dark water.
float pressureActivity(vec2 p, float dist) {
  // Blast rings are at most ~100 m across; past a few km they are subpixel anyway.
  if (uBlastCount == 0 || dist > 3500.0) return 0.0;
  float energy = 0.0;
  for (int i = 0; i < ${BLAST_CAPACITY}; i++) {
    if (i >= uBlastCount) break;
    vec4 b = uBlasts[i];
    float age = b.z;
    if (age <= 0.0 || age >= 1.05) continue;
    vec2 d = p - b.xy;
    float radius = 23.0 * age;
    if (dot(d, d) > (radius + 16.0) * (radius + 16.0)) continue;
    float r = length(d);
    float front = (r - radius) / 6.0;
    float footprint = max(exp(-front * front), exp(-dot(d, d) / 120.0 - age * 2.0));
    float life = (1.0 - exp(-age * 28.0)) * (1.0 - smoothstep(0.65, 1.05, age));
    float torn = 0.48 + 0.52 * smoothstep(-0.25, 0.4, noiseD(p * 0.19 + age * 0.6).x);
    energy += b.w * footprint * life * torn;
  }
  return energy / (1.0 + energy);
}
vec3 skyCol(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  float sd = max(dot(d, normalize(uSun)), 0.0);
  // Saturated golden-hour sky: deep slate blue away from the sun, warm gold toward it.
  // The grey uFog haze is only applied as distance fog later, never as a reflection color.
  vec3 horizon = mix(vec3(0.30, 0.42, 0.55), vec3(0.72, 0.48, 0.32), pow(sd, 3.5));
  vec3 c = mix(horizon, uZenith * 0.85, pow(h, 0.5));
  return c + vec3(1.0, 0.78, 0.55) * (pow(sd, 24.0) * 0.7 + pow(sd, 9.0) * 0.16);
}
float landH(vec2 p) {
  vec2 uv = p / (2.0 * uLandScale) + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return -200.0;
  return texture2D(uLand, uv).r * 1000.0 - 100.0;
}
void main() {
  vec2 p = vWorld.xz;
  float dist = length(uEye - vWorld);
  vec4 sea = oceanSurface(p);
  vec4 blast = dist < 3500.0 ? blastSurface(p) : vec4(0.0);
  vec2 grad = sea.yz + blast.yz;
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  float distFade = exp(-dist * 0.0016);
  // Analytic short-wave detail below mesh resolution, faded before it can alias;
  // beyond ~1.4 km the footprint term has already nulled it, so do not evaluate it at all.
  if (distFade > 0.10)
    grad += detailSlope(p) * (1.0 - smoothstep(2.0, 5.0, footprint));
  // Wind frame: every fine band and streak aligns to this heading, never against it.
  vec2 windDir = vec2(0.93937, 0.34290);
  vec2 windSide = vec2(-windDir.y, windDir.x);
  vec2 wind = vec2(uTime * 0.11, uTime * 0.065);
  // Spindrift: strongly anisotropic streaks advected along the wind, modulating both the
  // fine normal field and the base brightness so distant water reads as wind-blown bands.
  float streak = noiseD(vec2(dot(p, windDir) * 0.05, dot(p, windSide) * 1.4) - vec2(uTime * 0.4, 0.0)).x;
  vec2 q = p + 2.3 * vec2(noiseD(p * 0.065 - wind).x, noiseD(p * 0.073 - wind.yx + 27.0).x);
  // Fine ripples ride the swell: stretched and livelier on crests, compressed in troughs.
  float kMod = 1.0 - 0.25 * clamp(sea.x / 1.2, -1.0, 1.0);
  float aMod = (0.7 + 0.6 * smoothstep(-0.3, 1.2, sea.x)) * (1.0 + streak * 0.15);
  vec2 fine = vec2(0.0);
  wavelet(fine, q, windDir, 0.22 * kMod, 0.15 * aMod, 0.37, vec2(3.7, 17.1));
  wavelet(fine, q, vec2(0.76484, 0.64422), 0.47 * kMod, 0.068 * aMod, 0.59, vec2(31.8, -9.2));
  wavelet(fine, q, vec2(1.0, 0.0), 1.03 * kMod, 0.028 * aMod, 0.86, vec2(-18.3, 5.4));
  if (distFade > 0.02) {
    wavelet(fine, q, vec2(0.40849, 0.91276), 2.17 * kMod, 0.0065 * aMod, 1.12, vec2(7.9, 43.2));
    wavelet(fine, q, vec2(0.90045, -0.43497), 4.31 * kMod, 0.0025 * aMod, 1.55, vec2(55.1, 2.8));
  }
  fine *= mix(0.18, 1.0, distFade);
  float pressure = pressureActivity(p, dist);
  vec3 churn = pressure > 0.001 ? noiseD(p * 0.46 + vec2(-uTime * 2.6, uTime * 1.9)) : vec3(0.0);
  grad += fine * (1.0 - pressure * 0.6) + churn.yz * (0.12 * pressure);
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
  // Wave-scale normal (swell + blast only): fine ripples must not wash out the swell's form lighting.
  vec2 gradBig = sea.yz + blast.yz;
  vec3 nBig = normalize(vec3(-gradBig.x, 1.0, -gradBig.y));
  vec3 v = normalize(uEye - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  float h = landH(p);
  float shallow = smoothstep(-70.0, 8.0, h);
  float shore = smoothstep(-34.0, 2.0, h) * (1.0 - smoothstep(2.0, 46.0, h));
  vec3 base = mix(vec3(0.008, 0.034, 0.048), vec3(0.045, 0.15, 0.15), shallow);
  base *= 1.0 + streak * 0.015;
  // Swell form shading on the wave-scale normal: faces leaning toward the low sun catch
  // scattered light, faces leaning away fall off hard — this is what makes swell read as 3D.
  float sunFace = max(dot(nBig, normalize(uSun)), 0.0);
  base *= 0.45 + 1.35 * sunFace;
  // Forward-scattered emerald only where a crest is both tall and steep, against the sun.
  base += vec3(0.015, 0.065, 0.055) * smoothstep(0.8, 2.3, sea.x)
    * smoothstep(0.06, 0.14, length(sea.yz)) * max(0.0, dot(v, -uSun));
  float fresnel = 0.03 + 0.78 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 refl = reflect(-v, n); refl.y = abs(refl.y);
  // Wave form must survive into the reflected sky too, or distant swell washes out to flat haze.
  // Stronger ribs on the sun side so the glitter path keeps dark wave faces running through it.
  float glareSide = smoothstep(0.2, 0.7, dot(refl, normalize(uSun)));
  float skyForm = mix(0.78 + 0.38 * sunFace, 0.58 + 0.72 * sunFace, glareSide);
  vec3 col = mix(base, skyCol(refl) * skyForm, fresnel);
  // Troughs absorb: less sky is seen and the path through water is longer.
  col *= 1.0 - 0.34 * (1.0 - smoothstep(-2.2, 0.2, sea.x)) * (1.0 - fresnel);
  // A dark compressed face beside brighter torn foam makes the transient region legible,
  // without adding emitted light or changing the displacement/boat height cap.
  col *= 1.0 - pressure * 0.48;
  // Sun glitter: a sparse high-frequency sparkle field breaks the specular path into
  // individual flashes; three lobes merge it into a broad sheen with viewing distance.
  float sparkle = 0.0;
  if (dist < 900.0) {
    float sparkAA = 1.0 - smoothstep(0.06, 0.30, footprint);
    sparkle = smoothstep(0.55, 0.95, noiseD(p * 8.5 + wind * 3.1).x) * sparkAA * exp(-dist * 0.004);
  }
  vec3 hv = normalize(normalize(uSun) + v);
  float nh = max(dot(n, hv), 0.0);
  col += vec3(1.0, 0.86, 0.66) * (pow(nh, 700.0) * (1.2 * sparkle + 0.22)
    + pow(nh, 48.0) * 0.05 + pow(nh, 10.0) * 0.02);
  // Thin crest ribbons with perforated edges and individual grains, rather than filled blobs.
  float foamAA = 1.0 - smoothstep(0.8, 3.0, footprint);
  float foam = 0.0, pressureFoam = 0.0;
  // Foam perforation costs four noiseD calls; past ~1.6 km haze hides it entirely.
  if (foamAA > 0.001 && dist < 1600.0) {
    vec2 fq = vec2(dot(p, vec2(0.94, 0.342)), dot(p, vec2(-0.342, 0.94)));
    float lace = noiseD(fq * vec2(1.0, 0.30) - wind).x;
    float grains = noiseD(p * 1.7 - wind + 73.2).x;
    float grainAA = 1.0 - smoothstep(0.15, 0.65, footprint);
    float pores = mix(0.31, smoothstep(0.0, 0.5, grains), grainAA);
    float broken = smoothstep(-0.12, 0.42, lace) * pores;
    float patches = smoothstep(-0.05, 0.30, noiseD(p * 0.07 - wind * 0.5 + 19.4).x);
    float crest = smoothstep(0.001, 0.006, sea.w) * broken * patches * foamAA;
    // Lee-slope residue: a just-broken crest leaves a fading tail downwind of the crest line.
    float trail = smoothstep(0.0, 0.05, -dot(sea.yz, windDir))
      * smoothstep(0.001, 0.004, sea.w) * broken * patches * foamAA;
    float shoreFoam = shore * broken * 0.35 * foamAA;
    float pressureBreakup = smoothstep(-0.4, 0.45, noiseD(p * 0.64 - wind * 2.0 + 11.6).x);
    pressureFoam = blast.w * (0.24 + 0.76 * pressureBreakup) * (0.6 + 0.4 * pores) * foamAA;
    foam = clamp((crest + trail * 0.55) * 0.38 + shoreFoam, 0.0, 0.46);
    // Muzzle pressure shreds whitecaps; the torn turbidity is rendered by pressureFoam instead.
    foam *= 1.0 - pressure * 0.5;
  }
  // Diffuse foam, never emissive: blast rings disappear into the water in about a second.
  col = mix(col, vec3(0.30, 0.39, 0.41), foam);
  col = mix(col, vec3(0.22, 0.31, 0.33), min(0.20, pressureFoam));
  float fog = 1.0 - exp(-uFogDensity * dist * 0.85);
  // Water fades toward a blue sea haze, never the grey sky fog.
  vec3 seaFog = mix(uFog, vec3(0.14, 0.26, 0.35), 0.55);
  gl_FragColor = vec4(mix(col, seaFog, clamp(fog, 0.0, 1.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function landTexture(scale: number): THREE.DataTexture {
  const N = 256, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1) * 2 * scale - scale, z = j / (N - 1) * 2 * scale - scale;
      const b = Math.round(Math.max(0, Math.min(1, (terrainH(x, z) + 100) / 1000)) * 255);
      const o = (j * N + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = b; data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export interface Water {
  mesh: THREE.Mesh;
  update(t: number, eye: THREE.Vector3): void;
  /** Exact world-space vertex height field; fine shading-only ripples do not bob ships. */
  height(x: number, z: number, t: number): number;
  /** Height of the rendered triangles, including distant mesh interpolation. */
  renderHeight?(x:number,z:number,t:number):number;
  /** One call per muzzle: world x/z in metres, bore cal in mm, clearance in metres (default 10).
   * Uses the most recent update time. Call update with the current simulation time before emission. */
  blast(x: number, z: number, cal: number, heightAboveWater?: number): void;
  /** Clear pressure waves/foam on restart; does not reset the ambient sea clock. */
  resetBlasts(): void;
}

export function createWater(scene: THREE.Scene, fogDensity: number): Water {
  const N = 300; // 90,601 vertices, one indexed mesh; central 1.2 km sampled every 5 m.
  const g = new THREE.PlaneGeometry(2, 2, N, N);
  g.rotateX(-Math.PI / 2);
  const a = g.attributes.position as THREE.BufferAttribute;
  const grade = (v: number) => {
    const q = Math.abs(v);
    const r = q <= 0.8 ? q * 750 : 600 + 750 * (q - 0.8) + 25250 * ((q - 0.8) / 0.2) ** 2.6;
    return Math.sign(v) * r;
  };
  for (let i = 0; i < a.count; i++) {
    a.setX(i, grade(a.getX(i))); a.setZ(i, grade(a.getZ(i)));
  }
  g.computeBoundingSphere();
  const axisX=Float32Array.from({length:N+1},(_,i)=>a.getX(i));
  const axisZ=Float32Array.from({length:N+1},(_,i)=>a.getZ(i*(N+1)));
  const blasts = new OceanBlasts();
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 }, uWavePhase: { value: oceanPhases(0) },
      uBlastCount: { value: 0 }, uBlasts: { value: blasts.data },
      uEye: { value: new THREE.Vector3() }, uSun: { value: SUN_DIR.clone() },
      uFog: { value: FOG_COLOR.clone() }, uZenith: { value: new THREE.Color(0x4d78a8) },
      uFogDensity: { value: fogDensity }, uLand: { value: landTexture(14000) },
      uLandScale: { value: 14000 },
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
      blasts.update(t);
      mat.uniforms.uTime.value = blasts.time;
      oceanPhases(blasts.time, mat.uniforms.uWavePhase.value as Float32Array);
      mat.uniforms.uBlastCount.value = blasts.count;
      if ([eye.x, eye.y, eye.z].every(Number.isFinite)) {
        (mat.uniforms.uEye.value as THREE.Vector3).copy(eye);
        mesh.position.set(eye.x, 0, eye.z);
      }
    },
    height(x, z, t) { return sampleOcean(x, z, t).height + blasts.sample(x, z, t).height; },
    renderHeight(x,z,t) {
      return waterTriangleHeight(x,z,t,axisX,axisZ,mesh.position.x,mesh.position.z,
        (px,pz,pt)=>sampleOcean(px,pz,pt).height+blasts.sample(px,pz,pt).height);
    },
    blast(x, z, cal, heightAboveWater = 10) {
      blasts.blast(x, z, cal, heightAboveWater);
      mat.uniforms.uBlastCount.value = blasts.count;
    },
    resetBlasts() { blasts.reset(); mat.uniforms.uBlastCount.value = 0; },
  };
}
