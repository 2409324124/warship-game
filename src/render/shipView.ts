// One ship's presence in the scene: geometry, turrets that follow their guns, and the motion of the
// hull in the swell. Sinking is handled here too - she lists, settles and goes under.

import * as THREE from 'three';
import { clamp, sstep } from '../sim/constants';
import type { Ship } from '../sim/ship';
import { shipGeometry, shipMaterials, buildRails, type TurretGeo } from './shipModel';
// Loaded on demand: until a .glb exists there is nothing to fetch, and GLTFLoader is a big module
// that has no business sitting in the base bundle.
import { hasModel } from './models';

type Assets = typeof import('./assets');
let assetsPromise: Promise<Assets> | null = null;
function assets(): Promise<Assets> {
  if (!assetsPromise) assetsPromise = import('./assets');
  return assetsPromise;
}
import type { Water } from './water';

export class ShipView {
  readonly ship: Ship;
  readonly group = new THREE.Group();
  readonly turrets: { pivot: THREE.Group; base: THREE.Object3D; barrel: THREE.Object3D; geo: TurretGeo }[] = [];
  private foam: THREE.Mesh;
  private hull: THREE.Mesh;
  private struct: THREE.Mesh;
  private dark: THREE.Mesh;
  private deck: THREE.Mesh;

  constructor(scene: THREE.Scene, ship: Ship) {
    this.ship = ship;
    const spec = ship.spec;
    const g = shipGeometry(spec);
    const m = shipMaterials(spec);
    this.group.rotation.order = 'YXZ';

    this.hull = new THREE.Mesh(g.hull, m.hull);
    this.deck = new THREE.Mesh(g.deck, m.deck);
    this.struct = new THREE.Mesh(g.struct, m.struct);
    this.dark = new THREE.Mesh(g.dark, m.dark);
    this.hull.name = `hull:${spec.key}`;
    this.deck.name = `deck:${spec.key}`;
    this.struct.name = `struct:${spec.key}`;
    this.dark.name = `dark:${spec.key}`;
    for (const mesh of [this.hull, this.deck, this.struct, this.dark]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    const rails = new THREE.Mesh(
      buildRails(spec),
      new THREE.MeshBasicMaterial({ color: 0x1a1e22, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    rails.name = `rails:${spec.key}`;
    this.group.add(rails);

    for (const t of g.turrets) {
      const mount = spec.tur[t.mount];
      const pivot = new THREE.Group();
      pivot.position.set(mount.x, ship.turrets[t.mount].y, mount.z);
      const base = new THREE.Mesh(t.geo.base, m.struct);
      base.castShadow = true;
      pivot.add(base);
      const bp = new THREE.Group();
      bp.position.set(0, t.geo.ts.h * 0.5, t.geo.ts.len * 0.18);
      const barrel = new THREE.Mesh(t.geo.barrel, m.dark);
      barrel.castShadow = true;
      bp.add(barrel);
      pivot.add(bp);
      this.group.add(pivot);
      this.turrets.push({ pivot, base, barrel: bp, geo: t.geo });
    }

    this.foam = new THREE.Mesh(
      g.foam,
      new THREE.MeshBasicMaterial({
        color: 0xdfe9ef,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.foam.name = `foam:${spec.key}`;
    this.group.add(this.foam);

    scene.add(this.group);

    // Blender overrides. Both are no-ops until the .glb exists, so the procedural ship stays
    // playable for as long as the modelling work is still in progress.
    // Nothing to override? Then never even pull the loader in.
    const wanted = [`ships/${spec.key}_super`, ...spec.tur.map((t) => `guns/${t.kind}`)];
    if (!wanted.some(hasModel)) return;

    const group = this.group;
    const hide = [this.struct, this.dark];
    const turrets = this.turrets;
    void assets().then((a) => {
      void a.overrideSuperstructure(spec.key, group, hide);
      for (let i = 0; i < turrets.length; i++) {
        const entry = turrets[i];
        void a.overrideTurret(spec.tur[i].kind, entry.pivot, entry.base, entry.barrel).then((barrel) => {
          if (barrel) entry.barrel = barrel;
        });
      }
    });
  }

  update(_dt: number, t: number, water: Water): void {
    const s = this.ship;
    if (s.removed) {
      this.group.visible = false;
      return;
    }
    const spec = s.spec;
    const sn = Math.sin(s.heading),
      cs = Math.cos(s.heading);
    const L = spec.L,
      B = spec.B;

    // sample the swell at bow, stern and both beams: that is roll, pitch and heave
    const hb = water.height(s.x + sn * L * 0.38, s.z + cs * L * 0.38, t);
    const hs = water.height(s.x - sn * L * 0.38, s.z - cs * L * 0.38, t);
    const hp = water.height(s.x + cs * B * 0.5, s.z - sn * B * 0.5, t);
    const hsb = water.height(s.x - cs * B * 0.5, s.z + sn * B * 0.5, t);
    const heave = (hb + hs + hp + hsb) / 4;
    let pitch = Math.atan2(hs - hb, L * 0.76);
    let roll = Math.atan2(hp - hsb, B) * 0.9;
    s.bob = heave;

    // turning heel
    roll += -s.rudder * clamp(Math.abs(s.speed) / s.maxV, 0, 1) * (spec.cls === 'DD' ? 0.14 : 0.07);

    if (!s.alive) {
      const k = clamp(s.sinkT / 11, 0, 1);
      const e = sstep(k);
      roll += s.sinkRoll * e * 1.5;
      pitch += s.sinkPitch * e;
      this.group.position.set(s.x, heave - e * (spec.D + spec.F + 6), s.z);
      this.foam.visible = s.sinkT < 6;
      (this.foam.material as THREE.MeshBasicMaterial).opacity = 0.12 * (1 - e);
    } else {
      this.group.position.set(s.x, heave, s.z);
      this.foam.visible = true;
      const spd = clamp(Math.abs(s.speed) / s.maxV, 0, 1);
      (this.foam.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.16 * spd;
    }

    this.group.rotation.set(pitch, s.heading, roll);

    for (let i = 0; i < this.turrets.length; i++) {
      const tt = this.turrets[i];
      const data = s.turrets[i];
      if (!data) continue;
      tt.pivot.rotation.y = data.rel;
      tt.barrel.rotation.x = -data.elev;
    }

  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}
