// The fall-of-shot ellipse drawn on the water where the captain is pointing, so the "散布圈" is
// something you can see before you fire, not just a number in a table.

import * as THREE from 'three';
import { sigmaAt, type GunSpec } from '../sim/ballistics';

const SEG = 72;

export class AimMarker {
  readonly group = new THREE.Group();
  private ring: THREE.LineLoop;
  private inner: THREE.LineLoop;
  private cross: THREE.LineSegments;
  private pos: Float32Array;
  private posIn: Float32Array;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array((SEG + 1) * 3);
    this.posIn = new Float32Array((SEG + 1) * 3);
    const mk = (arr: Float32Array, color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3).setUsage(THREE.DynamicDrawUsage));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
      const l = new THREE.LineLoop(g, m);
      l.frustumCulled = false;
      l.renderOrder = 20;
      return l;
    };
    this.ring = mk(this.pos, 0xffc247, 0.85);
    this.inner = mk(this.posIn, 0xffc247, 0.35);

    const cg = new THREE.BufferGeometry();
    cg.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 1]), 3),
    );
    cg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.cross = new THREE.LineSegments(
      cg,
      new THREE.LineBasicMaterial({ color: 0xffc247, transparent: true, opacity: 0.7, depthTest: false }),
    );
    this.cross.frustumCulled = false;
    this.cross.renderOrder = 20;

    this.group.add(this.ring, this.inner, this.cross);
    this.group.renderOrder = 20;
    scene.add(this.group);
  }

  /**
   * @param aimX,aimZ where the guns are laid
   * @param fromX,fromZ the ship
   * @param sigma 1-sigma along/cross in metres
   */
  update(aimX: number, aimZ: number, fromX: number, fromZ: number, sigma: { along: number; cross: number }): void {
    const dx = aimX - fromX,
      dz = aimZ - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d,
      uz = dz / d;
    const write = (arr: Float32Array, k: number) => {
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        const al = Math.cos(a) * sigma.along * k;
        const cr = Math.sin(a) * sigma.cross * k;
        const o = i * 3;
        arr[o] = aimX + ux * al - uz * cr;
        arr[o + 1] = 2.5;
        arr[o + 2] = aimZ + uz * al + ux * cr;
      }
    };
    // the drawn ring is one sigma; the faint inner ring is where half the shells land
    write(this.pos, 1);
    write(this.posIn, 0.5);
    for (const attr of [
      (this.ring.geometry as THREE.BufferGeometry).attributes.position,
      (this.inner.geometry as THREE.BufferGeometry).attributes.position,
    ] as THREE.BufferAttribute[]) {
      attr.needsUpdate = true;
    }
    const c = this.cross.geometry.attributes.position as THREE.BufferAttribute;
    const arm = Math.max(45, sigma.cross * 1.4);
    c.setXYZ(0, aimX - ux * arm, 2.5, aimZ - uz * arm);
    c.setXYZ(1, aimX + ux * arm, 2.5, aimZ + uz * arm);
    c.setXYZ(2, aimX - uz * arm, 2.5, aimZ + ux * arm);
    c.setXYZ(3, aimX + uz * arm, 2.5, aimZ - ux * arm);
    c.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  static sigmaFor(gun: GunSpec, d: number): { along: number; cross: number } {
    return sigmaAt(gun, d);
  }
}
