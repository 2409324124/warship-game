// The DOM half of the HUD: ship state, telegraph, weapon panels, feed and banners.

import { clamp, THROTTLE } from '../sim/constants';
import type { Campaign } from '../sim/campaign';
import type { Ship } from '../sim/ship';
import type { World } from '../sim/world';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private el = {
    root: $('hud'),
    wave: $('hWave'),
    waveName: $('hWaveName'),
    foe: $('hFoe'),
    friend: $('hFriend'),
    tons: $('hTons'),
    clock: $('hClock'),
    feed: $('feed'),
    banner: $('banner'),
    hint: $('hint'),
    name: $('hName'),
    no: $('hNo'),
    type: $('hType'),
    hp: $('hHp'),
    hpBar: $('hHpBar'),
    spd: $('hSpd'),
    crs: $('hCrs'),
    rud: $('hRud'),
    rudFill: $('hRudFill'),
    tele: $<HTMLCanvasElement>('tele'),
    gunName: $('wGunName'),
    gunPips: $('wGunPips'),
    gunSub: $('wGunSub'),
    torpName: $('wTorpName'),
    torpPips: $('wTorpPips'),
    torpSub: $('wTorpSub'),
    dcN: $('wDcN'),
    dcPips: $('wDcPips'),
    dcSub: $('wDcSub'),
    wGun: $('wGun'),
    wTorp: $('wTorp'),
    torpWarn: $('torpWarn'),
    lockHint: $('lockHint'),
    debug: $('debug'),
  };

  private bannerT = 0;
  private hintT = 0;
  private built = 0;

  show(v: boolean): void {
    this.el.root.hidden = !v;
  }

  setLockHint(v: boolean): void {
    this.el.lockHint.hidden = !v;
  }

  banner(a: string, b: string): void {
    const e = this.el.banner;
    e.querySelector('.b1')!.textContent = a;
    e.querySelector('.b2')!.textContent = b;
    e.hidden = false;
    this.bannerT = 3.2;
  }

  hint(msg: string): void {
    this.el.hint.textContent = msg;
    this.el.hint.classList.add('on');
    this.hintT = 1.8;
  }

  feed(html: string, cls = ''): void {
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = html;
    this.el.feed.prepend(li);
    while (this.el.feed.children.length > 6) this.el.feed.lastElementChild!.remove();
  }

  update(dt: number, P: Ship, world: World, camp: Campaign | null, weapon: string, torpWarn: boolean): void {
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.el.banner.hidden = true;
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.el.hint.classList.remove('on');
    }
    this.el.torpWarn.hidden = !torpWarn;
    this.lastP = { x: P.x, z: P.z };

    const foes = world.ships.filter((s) => s.team !== P.team && s.alive).length;
    const friends = world.ships.filter((s) => s.team === P.team && s.alive).length;
    this.el.foe.textContent = String(foes);
    this.el.friend.textContent = String(friends);
    if (camp) {
      this.el.tons.textContent = camp.tons.toLocaleString('zh-CN');
      this.el.wave.textContent = `第 ${Math.min(camp.spawned, camp.level.waves.length)} 波 / 共 ${camp.level.waves.length} 波`;
      this.el.waveName.textContent = camp.level.subtitle;
    }
    const t = Math.floor(world.time);
    this.el.clock.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

    this.el.name.textContent = P.name;
    this.el.no.textContent = P.hullNo;
    this.el.type.textContent = `${P.spec.name} · ${P.spec.type}`;
    const frac = clamp(P.hp / P.maxHp, 0, 1);
    this.el.hp.textContent = `${Math.round(P.hp)} / ${Math.round(P.maxHp)}`;
    this.el.hpBar.style.width = `${frac * 100}%`;
    this.el.hpBar.style.background =
      frac > 0.55 ? 'linear-gradient(90deg,#4f9d6a,#7ec99a)' : frac > 0.25 ? 'linear-gradient(90deg,#c98b32,#f0b54a)' : 'linear-gradient(90deg,#a33a2a,#ef5a40)';

    this.el.spd.innerHTML = `${Math.round(P.knots)}<small>kn</small>`;
    // True compass bearing. `heading` is a mathematical bearing that grows toward +x, and in a
    // right-handed world with +y up, +x is west - so it grows anticlockwise on a north-up chart.
    // Starboard (east) is a *decreasing* heading, hence the negation.
    const crs = ((((-P.heading * 180) / Math.PI) % 360) + 360) % 360;
    this.el.crs.innerHTML = `${String(Math.round(crs)).padStart(3, '0')}<small>°</small>`;
    const r = P.rudder;
    this.el.rud.textContent = Math.abs(r) < 0.05 ? '正舵' : `${r > 0 ? '右' : '左'} ${Math.round(Math.abs(r) * 100)}%`;
    const f = this.el.rudFill;
    if (r >= 0) {
      f.style.left = '50%';
      f.style.width = `${r * 50}%`;
    } else {
      f.style.left = `${50 + r * 50}%`;
      f.style.width = `${-r * 50}%`;
    }
    this.drawTelegraph(P);

    // ---- weapons
    const mains = P.mainTurrets.length;
    if (this.built !== mains) {
      this.el.gunPips.innerHTML = '';
      for (let i = 0; i < mains; i++) this.el.gunPips.appendChild(document.createElement('i'));
      this.built = mains;
    }
    let minReload = Infinity;
    P.mainTurrets.forEach((t, i) => {
      const pip = this.el.gunPips.children[i] as HTMLElement;
      pip.classList.toggle('on', t.reload <= 0);
      minReload = Math.min(minReload, t.reload);
    });
    this.el.gunName.textContent = P.gun.label;
    const aimed = P.mainTurrets.filter((t) => t.onTarget).length;
    this.el.gunSub.textContent =
      minReload > 0 ? `装填 ${minReload.toFixed(1)}s` : aimed ? `${aimed}/${mains} 炮塔指向目标` : '炮塔转向中';

    const hasTorp = !!P.torp;
    this.el.wTorp.classList.toggle('off', !hasTorp);
    if (hasTorp && P.torp) {
      this.el.torpName.textContent = P.torp.label;
      const n = P.torpReady.length;
      if (this.el.torpPips.children.length !== n) {
        this.el.torpPips.innerHTML = '';
        for (let i = 0; i < n; i++) this.el.torpPips.appendChild(document.createElement('i'));
      }
      let mt = Infinity;
      P.torpReady.forEach((v, i) => {
        (this.el.torpPips.children[i] as HTMLElement).classList.toggle('on', v <= 0);
        mt = Math.min(mt, v);
      });
      this.el.torpSub.textContent = mt > 0 ? `装填 ${mt.toFixed(0)}s` : '就绪';
    } else {
      this.el.torpName.textContent = '—';
      this.el.torpSub.textContent = '本舰无鱼雷';
    }

    this.el.dcN.textContent = String(P.dc.charges);
    this.el.dcSub.textContent = P.dc.active > 0 ? `抢修中 ${P.dc.active.toFixed(0)}s` : P.dc.cd > 0 ? `冷却 ${P.dc.cd.toFixed(0)}s` : '就绪';

    this.el.wGun.classList.toggle('sel', weapon === 'guns');
    this.el.wTorp.classList.toggle('sel', weapon === 'torps');
  }

  /** The locked target's card: who she is, what she is doing, and how well we have her ranged. */
  updateTarget(t: Ship | null, converged: number, flight: number): void {
    const el = this.targetEl();
    if (!t || !t.alive) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const d = Math.hypot(t.x - (this.lastP?.x ?? 0), t.z - (this.lastP?.z ?? 0));
    const brg = ((((-t.heading * 180) / Math.PI) % 360) + 360) % 360;
    const spd = Math.abs(t.knots);
    const pct = Math.round(converged * 100);
    el.innerHTML = `
      <div class="tg-head"><b>${t.name}</b><span>${t.spec.name}</span></div>
      <div class="tg-row"><span>距离</span><b>${(d / 1000).toFixed(2)} km</b></div>
      <div class="tg-row"><span>航向 / 航速</span><b>${String(Math.round(brg)).padStart(3, '0')}° · ${spd.toFixed(0)} kn</b></div>
      <div class="tg-row"><span>飞行时间</span><b>${flight.toFixed(1)} s</b></div>
      <div class="tg-row"><span>测距</span><b class="${pct >= 98 ? 'ok' : ''}">${pct}%</b></div>
      <div class="tg-bar"><i style="width:${pct}%"></i></div>
      <div class="tg-tip">${converged < 0.98 ? '测距收敛中 · 散布偏大' : '测距完成 · 可放心齐射'}</div>`;
  }

  private lastP: { x: number; z: number } | null = null;

  private targetEl(): HTMLElement {
    let el = document.getElementById('targetCard');
    if (!el) {
      el = document.createElement('div');
      el.id = 'targetCard';
      el.className = 'target-card panel';
      document.getElementById('hud')!.appendChild(el);
    }
    return el;
  }

  setDebug(text: string | null): void {
    this.el.debug.hidden = !text;
    if (text) this.el.debug.textContent = text;
  }

  private drawTelegraph(P: Ship): void {
    const cv = this.el.tele;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 96,
      H = cv.clientHeight || 54;
    if (cv.width !== W * dpr) {
      cv.width = W * dpr;
      cv.height = H * dpr;
    }
    const c = cv.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const cx = W / 2,
      cy = H - 6,
      R = Math.min(W / 2 - 2, H - 10);
    const labels = ['全', '半', '停', '¼', '½', '¾', '全'];
    for (let i = 0; i < 7; i++) {
      const a0 = Math.PI + (i / 7) * Math.PI;
      const a1 = Math.PI + ((i + 1) / 7) * Math.PI;
      c.beginPath();
      c.arc(cx, cy, R, a0, a1);
      c.strokeStyle = i === P.throttle ? 'rgba(240,181,74,0.95)' : 'rgba(180,190,200,0.25)';
      c.lineWidth = i === P.throttle ? 3 : 2;
      c.stroke();
      const am = (a0 + a1) / 2;
      c.fillStyle = i === P.throttle ? '#f0b54a' : 'rgba(180,190,200,0.45)';
      c.font = '9px monospace';
      c.textAlign = 'center';
      c.fillText(labels[i], cx + Math.cos(am) * (R + 7), cy + Math.sin(am) * (R + 7) + 3);
    }
    const idx = clamp((P.speed / P.maxV + 0.5) / 0.25, 0, 6);
    const a = Math.PI + ((idx + 0.5) / 7) * Math.PI;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(a) * (R - 3), cy + Math.sin(a) * (R - 3));
    c.strokeStyle = '#e8edf2';
    c.lineWidth = 2;
    c.stroke();
    c.beginPath();
    c.arc(cx, cy, 3, 0, Math.PI * 2);
    c.fillStyle = '#e8edf2';
    c.fill();
    c.fillStyle = 'rgba(180,190,200,0.6)';
    c.font = '9px monospace';
    c.textAlign = 'center';
    c.fillText(THROTTLE[P.throttle] < 0 ? '倒车' : THROTTLE[P.throttle] === 0 ? '停车' : '前进', cx, cy + 9);
  }
}
