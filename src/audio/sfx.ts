// Procedural audio: no samples, everything is synthesised. A gun is a noise burst through a
// sweeping low-pass; an incoming shell is a descending whistle; the sea is filtered noise.

const CLIP_GAIN: Record<string, number> = {
  gunS: 0.5,
  gunM: 0.62,
  gunL: 0.78,
  gunXL: 1.0,
  splash: 0.55,
  hit: 0.7,
  boom: 0.9,
  whistle: 0.4,
};

export class Sfx {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  private last = new Map<string, number>();

  init(): void {
    if (this.ctx) return;
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 8;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // a low bed of sea noise
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  private env(dist: number): { gain: number; pan: number; delay: number } {
    const d = Math.max(60, dist);
    const gain = Math.min(1, 900 / d) ** 1.25;
    return { gain, pan: 0, delay: Math.min(1.4, d / 340) };
  }

  private burst(
    t0: number,
    dur: number,
    f0: number,
    f1: number,
    vol: number,
    type: BiquadFilterType,
    q = 1,
    rate = 1,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(0.02, dur * 0.1));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t0);
    s.stop(t0 + dur + 0.05);
  }

  private tone(t0: number, dur: number, f0: number, f1: number, vol: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** Rate-limit so a nine-gun salvo does not blow the mix apart. */
  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const prev = this.last.get(key) || 0;
    if (now - prev < ms) return false;
    this.last.set(key, now);
    return true;
  }

  gun(cal: number, dist: number, own: boolean): void {
    if (!this.ctx || this.muted) return;
    if (!this.throttle('gun' + cal + own, 30)) return;
    const { gain, delay } = this.env(dist);
    const k = cal / 406;
    const t0 = this.ctx.currentTime + delay * 0.35;
    const vol = (own ? 0.55 : 0.3) * gain * lerp(0.5, 1, k);
    this.burst(t0, 0.5 + k * 0.9, 260 * lerp(1.6, 0.5, k), 40, vol, 'lowpass', 0.8, 0.9);
    this.burst(t0, 0.12, 1800, 400, vol * 0.7, 'bandpass', 0.7, 1.2);
    this.tone(t0, 0.35 + k * 0.5, 90 * lerp(1.4, 0.6, k), 28, vol * 0.9, 'triangle');
  }

  splash(cal: number, dist: number): void {
    if (!this.ctx || this.muted) return;
    if (!this.throttle('splash', 40)) return;
    const { gain, delay } = this.env(dist);
    const t0 = this.ctx.currentTime + delay * 0.35;
    this.burst(t0, 0.55, 900, 120, 0.35 * gain * CLIP_GAIN.splash * lerp(0.6, 1.2, cal / 406), 'bandpass', 0.6);
  }

  hit(cal: number, dist: number): void {
    if (!this.ctx || this.muted) return;
    if (!this.throttle('hit', 45)) return;
    const { gain, delay } = this.env(dist);
    const t0 = this.ctx.currentTime + delay * 0.35;
    const k = cal / 406;
    this.burst(t0, 0.32, 420, 70, 0.5 * gain * lerp(0.5, 1.2, k), 'lowpass', 0.9);
    this.tone(t0, 0.22, 160, 50, 0.35 * gain * lerp(0.5, 1.2, k), 'square');
  }

  explode(big: boolean, dist: number): void {
    if (!this.ctx || this.muted) return;
    const { gain, delay } = this.env(dist);
    const t0 = this.ctx.currentTime + delay * 0.5;
    const k = big ? 1.5 : 1;
    this.burst(t0, 1.5 * k, 220, 32, 0.9 * gain * k, 'lowpass', 0.7, 0.85);
    this.burst(t0, 0.2, 1400, 300, 0.5 * gain * k, 'bandpass', 0.5);
    this.tone(t0, 1.1 * k, 70, 22, 0.7 * gain * k, 'triangle');
  }

  /** The shell passing overhead, started so the whistle ends when she lands. */
  incoming(cal: number, flightLeft: number): void {
    if (!this.ctx || this.muted) return;
    if (!this.throttle('incoming', 150)) return;
    const dur = Math.max(0.4, Math.min(2.6, flightLeft));
    const t0 = this.ctx.currentTime;
    const k = cal / 406;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(lerp(1500, 700, k), t0);
    o.frequency.exponentialRampToValueAtTime(lerp(500, 240, k), t0 + dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.value = lerp(1100, 620, k);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16 * CLIP_GAIN.whistle, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(bp);
    bp.connect(g);
    g.connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  torpedo(): void {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    this.burst(t0, 0.6, 700, 120, 0.25, 'bandpass', 0.8);
  }

  alarm(): void {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    this.tone(t0, 0.18, 880, 660, 0.18, 'square');
    this.tone(t0 + 0.24, 0.18, 880, 660, 0.18, 'square');
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
