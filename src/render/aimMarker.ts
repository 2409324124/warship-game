// A single physical, one-sigma outline on the sea; the overlay owns only the sight.
import * as THREE from 'three';
import { sigmaAt, type GunSpec } from '../sim/ballistics';
import { terrainH } from '../sim/terrain';
import type { Water } from './water';
import { projectAimRing, projectAimRibbon, AIM_PROJECTION_MAX_SEGMENTS, AIM_PROJECTION_RIBBON_WIDTH } from './aimProjection';

export class AimMarker {
  readonly group = new THREE.Group();
  /** Physical centreline and one-pixel world-space edge; never a screen ellipse. */
  readonly positions = new Float32Array(AIM_PROJECTION_MAX_SEGMENTS * 6);
  readonly geometry = new THREE.BufferGeometry();
  /** Surface-width part of the same outline: six vertices per surviving segment. */
  readonly ribbonGeometry = new THREE.BufferGeometry();
  private readonly ribbonPositions = new Float32Array(AIM_PROJECTION_MAX_SEGMENTS * 18);
  private readonly material = new THREE.MeshBasicMaterial({
    color: 0xffc247, transparent: true, opacity: 0.86, fog: false,
    depthTest: true, depthWrite: false, side: THREE.DoubleSide,
  });
  private requestedVisible = true;
  private valid = false;
  private segments = 0;
  private ribbonSegments = 0;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(this.ribbonPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.ribbonGeometry.setDrawRange(0, 0);
    // Use a small, metric eye-space bias,
    // rather than an NDC offset that would pull distant lines through ships/islands.
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\nmvPosition.z += 0.25;\ngl_Position = projectionMatrix * mvPosition;');
    };
    const ring = new THREE.Mesh(this.ribbonGeometry, this.material);
    ring.name = 'aim-sea-ribbon';
    ring.frustumCulled = false;
    // A one-pixel centre stroke keeps the SAME physical outline legible at
    // grazing angles, where a metre-wide sea ribbon can cover <0.1 pixel.
    // Its radius is still world-space sigma, and ships still depth-occlude it.
    const strokeMaterial=new THREE.LineBasicMaterial({color:0xffc247,opacity:.94,
      transparent:true,fog:false,depthTest:true,depthWrite:false});
    strokeMaterial.onBeforeCompile=this.material.onBeforeCompile;
    const stroke=new THREE.LineSegments(this.geometry,strokeMaterial);
    stroke.name='aim-sea-outline';
    stroke.frustumCulled=false;
    stroke.renderOrder=1;
    this.group.add(ring,stroke);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** First five arguments remain compatible; sigma is in world metres (one sigma). */
  update(
    aimX: number, aimZ: number, fromX: number, fromZ: number,
    sigma: { along: number; cross: number },
    water?: Pick<Water, 'height' | 'renderHeight'>, time = 0, reachable = true,
  ): void {
    const surface=water?.renderHeight ? {height:(x:number,z:number,t:number)=>water.renderHeight!(x,z,t)} : water;
    const result = projectAimRing(this.positions, aimX, aimZ, fromX, fromZ, sigma,
      surface, time, reachable, terrainH);
    const ribbon = projectAimRibbon(this.ribbonPositions, this.positions, result.segments, surface, time, terrainH);
    this.valid = result.valid && ribbon.valid;
    this.segments = result.segments;
    this.ribbonSegments = ribbon.segments;
    this.geometry.setDrawRange(0, this.segments * 2);
    this.ribbonGeometry.setDrawRange(0, this.ribbonSegments * 6);
    if (this.segments) this.geometry.attributes.position.needsUpdate = true;
    if (this.ribbonSegments) this.ribbonGeometry.attributes.position.needsUpdate = true;
    this.group.visible = this.requestedVisible && this.valid;
  }

  setVisible(v: boolean): void {
    this.requestedVisible = v;
    this.group.visible = v && this.valid;
  }

  get stats(): Readonly<{
    valid: boolean; segments: number; ribbonSegments: number; ribbonWidth: number;
    visible: boolean; depthTest: boolean; depthWrite: boolean; fog: boolean;
  }> {
    return { valid: this.valid, segments: this.segments, visible: this.group.visible,
      ribbonSegments: this.ribbonSegments, ribbonWidth: AIM_PROJECTION_RIBBON_WIDTH,
      depthTest: this.material.depthTest, depthWrite: this.material.depthWrite, fog: this.material.fog };
  }

  static sigmaFor(gun: GunSpec, d: number): { along: number; cross: number } {
    return sigmaAt(gun, d);
  }
}
