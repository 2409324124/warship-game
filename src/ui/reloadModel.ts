/** HUD-only projection: loading and aiming are deliberately independent. */
export interface ReloadSource {
  reload: number;
  reloadTotal?: number;
  gun: { reload: number };
  inArc: boolean;
  onTarget: boolean;
}

export interface ReloadModel {
  remaining: number;
  progress: number;
  loaded: boolean;
  reloadText: string;
  aimText: string;
  canFire: boolean;
}

export function reloadModel(t: ReloadSource): ReloadModel {
  const valid = Number.isFinite(t.reload);
  const remaining = valid ? Math.max(0, t.reload) : 0;
  const loaded = valid && remaining === 0;
  const candidate = t.reloadTotal ?? t.gun.reload;
  const total = Number.isFinite(candidate) && candidate > 0
    ? candidate
    : Number.isFinite(t.gun.reload) && t.gun.reload > 0 ? t.gun.reload : 0;
  const progress = loaded ? 1 : valid && total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;
  return {
    remaining,
    progress,
    loaded,
    // Keep a positive countdown visible until the simulation actually reaches zero.
    reloadText: !valid ? '装填未知' : loaded ? '就绪' : `${Math.max(0.1, remaining).toFixed(1)}s`,
    aimText: !t.inArc ? '不在射界' : !t.onTarget ? '转向中' : '已对准',
    canFire: loaded && t.inArc && t.onTarget,
  };
}
