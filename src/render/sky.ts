// Sky dome: a gradient with a sun disc and a haze band at the horizon.

import * as THREE from 'three';
import { FOG_COLOR, SUN_DIR } from './engine';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;   // always on the far plane
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSun;
uniform vec3 uFog;
uniform vec3 uZenith;

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);

  // vertical gradient: warm haze at the horizon, cool blue overhead, grey below it
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uFog, uZenith, t);
  col = mix(col, uFog * 0.72, clamp(-h * 3.0, 0.0, 1.0));

  // the sun and the glow around it
  float sd = max(dot(d, normalize(uSun)), 0.0);
  col += vec3(1.0, 0.82, 0.6) * pow(sd, 900.0) * 8.0;          // disc
  col += vec3(1.0, 0.74, 0.5) * pow(sd, 22.0) * 0.45;           // tight glow
  col += vec3(1.0, 0.72, 0.52) * pow(sd, 4.0) * 0.14;           // wide bloom

  // a soft band of cloud near the horizon
  float band = exp(-pow((h - 0.055) * 11.0, 2.0));
  col = mix(col, col * 1.06 + vec3(0.03, 0.028, 0.03), band * 0.55);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky(scene: THREE.Scene): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uFog: { value: FOG_COLOR.clone() },
      uZenith: { value: new THREE.Color(0x4d78a8) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    // Drawn last among opaques at the far plane: fragments behind terrain/water/ships
    // fail the depth test and cost nothing, instead of filling the whole screen first.
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(50000, 40, 20), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 500;
  scene.add(mesh);
  return mesh;
}
