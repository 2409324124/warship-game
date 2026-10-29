export type ProjectileRef = { kind: 'shell' | 'torpedo'; id: number };
export type CameraMode = 'ship' | 'weapon' | 'binocular' | 'bridge' | 'projectile';

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const wrapYaw = (n: number) => {
  const turn = Math.PI * 2;
  return ((n + Math.PI) % turn + turn) % turn - Math.PI;
};

/** Pure controls inspired by WoWS desktop camera mechanics, not original camera coordinates.
 * Angles are independent of weapon aim; FOV values are vertical degrees.
 * The caller handles C press duration and chooses the projectile for Z. */
export class CameraControls {
  private currentLevel = 0;
  private currentGroup = 0;
  private yaw = 0;
  private pitch = 0;
  private nonBinocularLevel = 0;
  private exteriorLevel = 0;
  private beforeFollow: { level: number; bridge: boolean } | null = null;

  bridge = false;
  freeLook = false;
  follow: ProjectileRef | null = null;

  get level(): number { return this.currentLevel; }
  set level(value: number) {
    if (!Number.isFinite(value)) return;
    this.currentLevel = clamp(Math.trunc(value), 0, 5);
    if (this.currentLevel < 3) this.nonBinocularLevel = this.currentLevel;
    if (this.currentLevel < 2) this.exteriorLevel = this.currentLevel;
  }

  get group(): number { return this.currentGroup; }
  set group(value: number) {
    if (Number.isFinite(value)) this.currentGroup = Math.max(0, Math.trunc(value));
  }

  get lookYaw(): number { return this.yaw; }
  set lookYaw(value: number) {
    if (Number.isFinite(value)) this.yaw = wrapYaw(value);
  }

  get lookPitch(): number { return this.pitch; }
  set lookPitch(value: number) {
    if (Number.isFinite(value)) this.pitch = clamp(value, -.25, 1.15);
  }

  get mode(): CameraMode {
    if (this.follow) return 'projectile';
    if (this.bridge) return 'bridge';
    if (this.level >= 3) return 'binocular';
    return this.level === 2 ? 'weapon' : 'ship';
  }

  get zoomTarget(): number { return this.level >= 3 ? 1 : 0; }
  /** Outside binocular mode the compatible aiming FOV remains 11 degrees. */
  get binocularFov(): number { return this.level === 3 ? 18 : this.level === 5 ? 7.5 : 11; }

  reset(): void {
    this.level = 0;
    this.group = 0;
    this.bridge = false;
    this.freeLook = false;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.follow = null;
    this.beforeFollow = null;
  }

  wheel(direction: number): void {
    if (!Number.isFinite(direction) || direction === 0) return;
    if (this.follow) { this.exitFollow(); return; }
    this.bridge = false;
    this.level += Math.sign(direction);
  }

  toggleBinocular(): void {
    if (this.follow) { this.exitFollow(); return; }
    this.bridge = false;
    this.level = this.level >= 3 ? this.nonBinocularLevel : 4;
  }

  cycleGroup(count: number): void {
    if (!Number.isFinite(count) || count < 1) return;
    this.group = (this.group + 1) % Math.trunc(count);
    // Following a projectile is owned by the caller, including group-key handling.
    if (this.mode === 'ship') this.level = 2;
  }

  toggleWeapon(): void {
    if (this.follow) { this.exitFollow(); return; }
    this.bridge = false;
    this.level = this.level === 2 ? this.exteriorLevel : 2;
  }

  toggleBridge(): void {
    if (this.follow) this.exitFollow();
    this.bridge = !this.bridge;
  }

  beginFreeLook(yaw: number, pitch = 0): void {
    if (this.follow) return;
    this.lookYaw = yaw;
    this.lookPitch = pitch;
    this.freeLook = true;
  }

  moveLook(dx: number, dy: number): void {
    if (!this.freeLook || this.follow) return;
    if (Number.isFinite(dx)) this.lookYaw += dx;
    if (Number.isFinite(dy)) this.lookPitch += dy;
  }

  endFreeLook(): void { this.freeLook = false; }

  followProjectile(ref: ProjectileRef): void {
    if (!ref || (ref.kind !== 'shell' && ref.kind !== 'torpedo') ||
        !Number.isSafeInteger(ref.id) || ref.id < 0) return;
    // Switching projectile must not replace the original return state.
    if (!this.follow) this.beforeFollow = { level: this.level, bridge: this.bridge };
    this.follow = { kind: ref.kind, id: ref.id };
    this.endFreeLook();
  }

  exitFollow(): void {
    if (!this.follow) return;
    this.follow = null;
    if (this.beforeFollow) {
      this.level = this.beforeFollow.level;
      this.bridge = this.beforeFollow.bridge;
    }
    this.beforeFollow = null;
  }

  validateFollow(alive: boolean): void {
    if (!alive) this.exitFollow();
  }
}
