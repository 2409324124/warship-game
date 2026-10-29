import test from 'node:test';
import assert from 'node:assert/strict';
import { reloadModel } from '../src/ui/reloadModel.ts';
import type { ReloadSource } from '../src/ui/reloadModel.ts';

const turret = (overrides: Partial<ReloadSource> = {}): ReloadSource => ({
  reload: 0,
  reloadTotal: 30,
  gun: { reload: 30 },
  inArc: true,
  onTarget: true,
  ...overrides,
});

test('a fired turret starts empty, fills continuously, and becomes ready at zero', () => {
  const start = reloadModel(turret({ reload: 30 }));
  assert.equal(start.progress, 0);
  assert.equal(start.reloadText, '30.0s');
  assert.equal(start.loaded, false);
  const middle = reloadModel(turret({ reload: 12.4 }));
  assert.ok(Math.abs(middle.progress - (1 - 12.4 / 30)) < 1e-12);
  assert.equal(middle.reloadText, '12.4s');
  const end = reloadModel(turret());
  assert.equal(end.progress, 1);
  assert.equal(end.remaining, 0);
  assert.equal(end.reloadText, '就绪');
  assert.equal(end.loaded, true);
  assert.equal(end.canFire, true);
});

test('the actual randomized firing duration is the denominator, not nominal gun reload', () => {
  // Deterministic samples span durations above and below the nominal gun value.
  let seed = 1942;
  for (let i = 0; i < 100; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const total = 24 + (seed / 2 ** 32) * 12;
    assert.equal(reloadModel(turret({ reload: total, reloadTotal: total })).progress, 0);
    for (const fraction of [0.001, 0.25, 0.5, 0.9]) {
      const model = reloadModel(turret({ reload: total * fraction, reloadTotal: total }));
      assert.ok(Math.abs(model.progress - (1 - fraction)) < 1e-12);
    }
  }
});

test('legacy turrets fall back to nominal reload when reloadTotal is absent', () => {
  const source = turret({ reload: 15 });
  delete source.reloadTotal;
  assert.equal(reloadModel(source).progress, 0.5);
});

test('negative timers are complete and overlong timers cannot underflow the bar', () => {
  const negative = reloadModel(turret({ reload: -5 }));
  assert.equal(negative.remaining, 0);
  assert.equal(negative.progress, 1);
  assert.equal(negative.reloadText, '就绪');
  assert.equal(negative.loaded, true);
  assert.equal(reloadModel(turret({ reload: 100 })).progress, 0);
  assert.equal(reloadModel(turret({ reload: 0.001 })).reloadText, '0.1s');
});

test('illegal timers never produce NaN transforms or false readiness', () => {
  for (const reload of [NaN, Infinity, -Infinity]) {
    const model = reloadModel(turret({ reload }));
    assert.equal(model.progress, 0);
    assert.equal(model.loaded, false);
    assert.equal(model.canFire, false);
    assert.equal(model.reloadText, '装填未知');
    assert.ok(Number.isFinite(model.remaining));
  }
  for (const reloadTotal of [NaN, Infinity, -Infinity, 0, -10]) {
    assert.equal(reloadModel(turret({ reload: 15, reloadTotal })).progress, 0.5);
    const unknown = reloadModel(turret({ reload: 15, reloadTotal, gun: { reload: NaN } }));
    assert.equal(unknown.progress, 0);
    assert.equal(unknown.loaded, false);
  }
});

test('loading, traverse, and firing arc remain independent states', () => {
  for (const reload of [0, 12.4]) {
    for (const inArc of [false, true]) {
      for (const onTarget of [false, true]) {
        const model = reloadModel(turret({ reload, inArc, onTarget }));
        assert.equal(model.loaded, reload === 0);
        assert.equal(model.reloadText, reload === 0 ? '就绪' : '12.4s');
        assert.equal(model.aimText, !inArc ? '不在射界' : !onTarget ? '转向中' : '已对准');
        assert.equal(model.canFire, reload === 0 && inArc && onTarget);
      }
    }
  }
});

test('2, 3, and 5 main turrets keep independent progress and countdowns', () => {
  for (const count of [2, 3, 5]) {
    const sources = Array.from({ length: count }, (_, i) => turret({
      reloadTotal: 20 + i * 3,
      reload: i === 0 ? 0 : (20 + i * 3) * i / count,
    }));
    const before = sources.map(reloadModel);
    sources[count - 1].reload = sources[count - 1].reloadTotal!;
    const after = sources.map(reloadModel);
    assert.deepEqual(after.slice(0, -1), before.slice(0, -1));
    assert.equal(after[count - 1].progress, 0);
    assert.equal(after[0].reloadText, '就绪');
    assert.equal(new Set(before.map((m) => m.progress)).size, count);
  }
});
