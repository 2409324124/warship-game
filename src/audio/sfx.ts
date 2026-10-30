// Procedural audio: no samples, everything is synthesised. The battery report is an
// offline-rendered composite (crack + blast + sub-bass pressure column + damped modes +
// rolling thunder), cached per calibre class, barrel count and variant.
// All times (including rate limits) use the audio clock, so pausing a tab cannot
// accumulate a wall-clock backlog of scheduled salvos.
type VoiceKind = 'heavy' | 'light' | 'impact' | 'incoming' | 'utility';
type Source = AudioBufferSourceNode | OscillatorNode;
interface Voice {
  kind: VoiceKind;
  bus: GainNode;
  nodes: AudioNode[];
  sources: Set<Source>;
  charge?: number;
}

export interface GunOptions { barrels?: number; secondary?: boolean }

const LIMITS: Record<VoiceKind, number> = { heavy: 24, light: 12, impact: 6, incoming: 2, utility: 2 };
const FLOOR = 0.0001;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const caliber = (cal: number) => Math.max(0, Math.min(1, ((Number.isFinite(cal) ? cal : 127) - 76) / 384));

export class Sfx {
  ctx: AudioContext | null = null;
  muted = false;
  private master: GainNode | null = null;
  private mix: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private graph: AudioNode[] = [];
  private ambience: AudioBufferSourceNode | null = null;
  private voices = new Set<Voice>();
  private last = new Map<string, number>();
  private resuming = false;
  private reports = new Map<string, AudioBuffer>();
  private gunSequence = 0;
  private proceduralShots = 0;
  private foldedShots = 0;

  /** Nonblocking init; callers may await this for audio-only QA. Never called by gun(). */
  prepare(): Promise<boolean> {
    this.init();
    return Promise.resolve(!!this.ctx);
  }

  stats() {
    return { procedural: this.proceduralShots, folded: this.foldedShots,
      active: this.voices.size, cachedReports: this.reports.size };
  }

  /** Call from a user gesture; subsequent calls also retry autoplay unlocking. */
  init(): void {
    if (this.ctx?.state === 'closed') this.dispose();
    if (!this.ctx) {
      if (typeof window === 'undefined') return;
      const host = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = host.AudioContext || host.webkitAudioContext;
      if (!AC) return;
      try {
        const ctx = new AC();
        this.ctx = ctx;
        const mix = ctx.createGain();
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 24; // remove DC / inaudible rumble before compression
        hp.Q.value = 0.707;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -6;
        comp.knee.value = 6;
        comp.ratio.value = 2;
        comp.attack.value = 0.008;
        comp.release.value = 0.3;
        // Compressor attack alone cannot contain coincident muzzle transients.
        // Scale the WaveShaper input domain to +/-4: WebAudio clamps inputs
        // outside +/-1, otherwise a normal salvo would hit a hard flat endpoint
        // despite the ostensibly soft tanh curve. Low-level gain remains unity.
        const ceilingInput = ctx.createGain();
        ceilingInput.gain.value = 0.25;
        const ceiling = ctx.createWaveShaper();
        const curve = new Float32Array(4097);
        for (let i = 0; i < curve.length; i++) {
          const x = i / (curve.length - 1) * 2 - 1;
          // Nearly linear below the safety knee; do not flatten every report.
          curve[i] = 0.8 * Math.tanh(x * 4 / 0.8);
        }
        ceiling.curve = curve;
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.72;
        this.graph = [mix, hp, comp, ceilingInput, ceiling, master];
        mix.connect(hp); hp.connect(comp); comp.connect(ceilingInput); ceilingInput.connect(ceiling);
        ceiling.connect(master); master.connect(ctx.destination);
        this.mix = mix;
        this.master = master;

        const len = Math.ceil(ctx.sampleRate * 4);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buf;
        const sea = ctx.createBufferSource();
        const lp = ctx.createBiquadFilter();
        const bed = ctx.createGain();
        sea.buffer = buf; sea.loop = true;
        lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.5;
        bed.gain.value = 0.008;
        this.ambience = sea;
        this.graph.push(sea, lp, bed);
        sea.connect(lp); lp.connect(bed); bed.connect(mix);
        sea.start();
      } catch {
        // Unsupported / unavailable audio must not prevent starting the game.
        this.dispose();
        return;
      }
    }
    this.unlock();
    this.prewarm();
  }

  private unlock(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || this.resuming) return;
    this.resuming = true;
    try {
      void ctx.resume().catch(() => {}).finally(() => {
        if (this.ctx === ctx) this.resuming = false;
      });
    } catch { this.resuming = false; }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!m) this.unlock();
    if (this.master && this.ctx) {
      const p = this.master.gain;
      const now = this.ctx.currentTime;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(m ? 0 : 0.72, now + 0.025);
    }
    if (m) {
      // Do not resurrect delayed shots when sound is re-enabled.
      for (const voice of this.voices) {
        const now = this.ctx!.currentTime;
        voice.bus.gain.cancelScheduledValues(now);
        voice.bus.gain.setValueAtTime(voice.bus.gain.value, now);
        voice.bus.gain.linearRampToValueAtTime(0, now + 0.025);
        for (const source of voice.sources) source.stop(now + 0.03);
      }
      this.last.clear();
    }
  }

  /** Optional lifecycle hook; safe to call repeatedly, and init() can start anew. */
  dispose(): void {
    this.proceduralShots = this.foldedShots = 0;
    for (const voice of [...this.voices]) this.release(voice, true);
    if (this.ambience) { try { this.ambience.stop(); } catch { /* already stopped */ } }
    for (const node of this.graph) node.disconnect();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = this.mix = this.noise = this.ambience = null;
    this.graph = [];
    this.last.clear();
    this.reports.clear();
    this.gunSequence = 0;
    this.resuming = false;
    if (ctx && ctx.state !== 'closed') {
      try { void ctx.close().catch(() => {}); } catch { /* context unavailable */ }
    }
  }

  private env(dist: number): { gain: number; delay: number; far: number } {
    const d = Number.isFinite(dist) ? Math.max(0, dist) : 30000;
    return {
      gain: (1 + Math.max(0, d - 100) / 850) ** -1.15,
      // Deliberately game-compressed propagation; retain existing responsive timing.
      delay: Math.min(0.55, d / 340 * 0.35),
      far: Math.min(1, d / 6500),
    };
  }

  private begin(kind: VoiceKind, key: string, interval: number): Voice | null {
    const ctx = this.ctx;
    // Drop events while locked/suspended instead of replaying a backlog on resume.
    if (!ctx || ctx.state !== 'running' || this.muted || !this.mix) return null;
    const now = ctx.currentTime;
    const previous = this.last.get(key);
    if (interval > 0 && previous !== undefined && now - previous < interval) return null;
    if (this.voices.size >= 46 || [...this.voices].filter(v => v.kind === kind).length >= LIMITS[kind]) return null;
    this.last.set(key, now);
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.mix);
    const voice: Voice = { kind, bus, nodes: [bus], sources: new Set() };
    this.voices.add(voice);
    return voice;
  }

  private release(voice: Voice, stop = false): void {
    if (!this.voices.delete(voice)) return;
    for (const source of voice.sources) {
      source.onended = null;
      if (stop) { try { source.stop(); } catch { /* already ended */ } }
    }
    voice.sources.clear();
    for (const node of voice.nodes) node.disconnect();
  }

  private schedule(voice: Voice, source: Source, nodes: AudioNode[], t0: number, dur: number): void {
    voice.nodes.push(source, ...nodes);
    voice.sources.add(source);
    source.onended = () => {
      source.onended = null;
      source.disconnect();
      for (const node of nodes) node.disconnect();
      voice.sources.delete(source);
      if (!voice.sources.size) this.release(voice);
    };
    if ('buffer' in source) source.start(t0, source.loop ? Math.random() * 3 : 0);
    else source.start(t0);
    source.stop(t0 + dur + 0.015);
  }

  private envelope(g: GainNode, t0: number, dur: number, vol: number, attack: number, tail = false): void {
    g.gain.setValueAtTime(FLOOR, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(FLOOR, vol), t0 + attack);
    // A single ramp to near-zero made a nominal two-second tail effectively
    // vanish in its first half. Keep the diffuse report audible before release.
    if (tail) g.gain.exponentialRampToValueAtTime(Math.max(FLOOR, vol * 0.22), t0 + dur * 0.65);
    g.gain.exponentialRampToValueAtTime(FLOOR, t0 + dur);
  }

  private burst(v: Voice, t0: number, dur: number, f0: number, f1: number, vol: number,
    type: BiquadFilterType = 'lowpass', q = 0.7, attack = 0.004, tail = false): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true; // random offsets must not truncate the long heavy-gun tail
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    this.envelope(g, t0, dur, vol, attack, tail);
    s.connect(f); f.connect(g); g.connect(v.bus);
    this.schedule(v, s, [f, g], t0, dur);
  }

  private tone(v: Voice, t0: number, dur: number, f0: number, f1: number, vol: number,
    type: OscillatorType = 'sine', attack = 0.006): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    this.envelope(g, t0, dur, vol, attack);
    o.connect(g); g.connect(v.bus);
    this.schedule(v, o, [g], t0, dur);
  }

  /** Common battery reports rendered ahead of time, staggered so the first salvo never
   * hitches on synthesis. Variants cycle mod 4, so four renders per combo cover them all. */
  private prewarm(): void {
    const combos: [number, number, boolean][] = [[406, 3, false], [356, 3, false], [127, 1, true]];
    let i = 0;
    const step = () => {
      if (i >= combos.length || !this.ctx) return;
      const [cal, barrels, secondary] = combos[i++];
      for (let v = 0; v < 4; v++) this.report(caliber(cal), barrels, secondary);
      setTimeout(step, 40);
    };
    setTimeout(step, 0);
  }

  private report(k: number, barrels: number, secondary: boolean): AudioBuffer {
    return this.synthesizeReport(k, barrels, secondary);
  }

  /** Fully procedural battery report: a sharp crack, the main blast, a falling sub-bass
   * pressure column, damped hull resonances, and a long rolling-thunder tail — rendered
   * once into a stereo buffer and cached per size/barrels/variant. */
  private synthesizeReport(k: number, barrels: number, secondary: boolean): AudioBuffer {
    const variant = this.gunSequence++ % 4;
    const size = Math.round(k * 8);
    const key = `${size}:${barrels}:${secondary}:${variant}`;
    const cached = this.reports.get(key);
    if (cached) return cached;
    const ctx = this.ctx!;
    const weight = size / 8;
    const heavy = weight >= 0.48 && !secondary;
    const duration = heavy ? lerp(2.6, 3.4, weight) : lerp(0.32, 0.85, weight);
    const length = Math.ceil(duration * ctx.sampleRate);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const dry = new Float32Array(length);
    let seed = (173 + size * 7919 + variant * 104729 + barrels * 31) >>> 0;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    const a = [65, 180, 480, 1800].map(f => 1 - Math.exp(-2 * Math.PI * f / ctx.sampleRate));
    // Damped hull resonances carry the roar of a heavy broadside; per-variant ±6%
    // frequency jitter is what makes the four cached variants distinguishable.
    const modes: [number, number, number][] = heavy
      ? [[38, 0.75, 0.30], [57, 0.55, 0.22], [83, 0.38, 0.15]]
      : [[38, 0.30, 0.15], [57, 0.22, 0.11], [83, 0.15, 0.075]];
    const modeJit = modes.map(() => 1 + random() * 0.06);
    const subAmp = (heavy ? 0.55 : 0.15) * k;
    // Each barrel has its own turbulent pressure history and 4–14ms separation.
    for (let barrel = 0; barrel < barrels; barrel++) {
      const offset = Math.floor((barrel * 0.009 + (random() + 1) * 0.002) * ctx.sampleRate);
      const state = [0, 0, 0, 0];
      let roll = 0;
      let subPhase = random() * 0.63; // ±10% of a cycle between barrels
      const modePhase = modes.map(() => random() * Math.PI);
      for (let i = offset; i < length; i++) {
        const t = (i - offset) / ctx.sampleRate;
        const n = random();
        for (let j = 0; j < 4; j++) state[j] += a[j] * (n - state[j]);
        roll += 0.0018 * (random() - roll);
        const attack = 1 - Math.exp(-t / 0.002);
        const body = (state[1] - state[0]) * 4.8 + (state[2] - state[1]) * 2.5;
        const crack = (n - state[3]) * Math.exp(-t / (heavy ? 0.02 : 0.012));
        const blast = body * Math.exp(-t / (heavy ? 0.38 : 0.065));
        // Mid-pressure bridge: the roar must not sag between the onset and the thunder.
        const mid = heavy ? body * 0.35 * (1 - Math.exp(-t / 0.03)) * Math.exp(-t / 0.6) : 0;
        const rolling = ((state[1] - state[0]) * 5 + (state[2] - state[1]) * 1.8)
          * (0.7 + Math.min(0.6, Math.abs(roll) * 14))
          * (1 - Math.exp(-t / 0.055)) * Math.exp(-t / (heavy ? 1.05 : 0.12));
        // Sub-bass pressure column: a falling 58→26 Hz sweep, felt as much as heard.
        const fSub = 26 + 32 * Math.exp(-t / 0.55);
        subPhase += 2 * Math.PI * fSub / ctx.sampleRate;
        const sub = subAmp * (1 - Math.exp(-t / 0.008)) * Math.exp(-t / 0.45)
          * (Math.sin(subPhase) + 0.2 * Math.sin(2 * subPhase));
        let modeSum = 0;
        for (let m = 0; m < modes.length; m++) {
          const [f, tau, amp] = modes[m];
          modeSum += amp * Math.sin(2 * Math.PI * f * modeJit[m] * t + modePhase[m])
            * (1 - Math.exp(-t / 0.008)) * Math.exp(-t / tau);
        }
        const fade = Math.min(1, (length - i) / (ctx.sampleRate * 0.12));
        dry[i] += attack * fade * (0.44 * crack + blast + mid + (heavy ? 0.9 : 0.28) * rolling + sub + modeSum)
          / Math.sqrt(barrels);
      }
    }
    for (let channel = 0; channel < 2; channel++) {
      const out = buffer.getChannelData(channel);
      const taps = (heavy ? [0.093, 0.191, 0.347, 0.61, 0.92] : [0.054, 0.113])
        .map(t => Math.floor((t + channel * 0.013) * ctx.sampleRate));
      for (let i = 0; i < length; i++) {
        let value = dry[i];
        for (let j = 0; j < taps.length; j++) if (i >= taps[j]) value += dry[i - taps[j]] * 0.22 / (1 + j * 0.45);
        // Fixed gain preserves powder/voice energy instead of peak-normalizing it away.
        out[i] = value * 0.48 * Math.min(1, (length - 1 - i) / (ctx.sampleRate * 0.1));
      }
    }
    // Soft cap only: the heavy/light energy difference is a feature, but no buffer may clip.
    let peak = 0;
    for (let c = 0; c < 2; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    if (peak > 0.9) {
      const s = 0.9 / peak;
      for (let c = 0; c < 2; c++) {
        const d = buffer.getChannelData(c);
        for (let i = 0; i < length; i++) d[i] *= s;
      }
    }
    // Bounded LRU-ish cache (~32 stereo reports maximum); live sources own buffers.
    if (this.reports.size >= 32) this.reports.delete(this.reports.keys().next().value!);
    this.reports.set(key, buffer);
    return buffer;
  }

  gun(cal: number, dist: number, own: boolean, options: GunOptions = {}): void {
    const k = caliber(cal);
    const secondary = options.secondary === true;
    const barrels = Number.isFinite(options.barrels) ? Math.max(1, Math.min(4, Math.round(options.barrels!))) : 1;
    const heavy = k >= 0.48 && !secondary;
    const kind = heavy ? 'heavy' : 'light';
    const v = this.begin(kind, `${kind}:${own}`, 0);
    const { gain, delay, far } = this.env(dist);
    const level = gain * (own ? 0.58 : 0.4) * (secondary ? 0.32 : lerp(0.48, 1, k)) * Math.sqrt(barrels);
    if (!v) {
      // Overload folds powder energy into the nearest active battery rather than
      // allocating indefinitely. Normal salvos retain all 24 independent turrets.
      if (!this.ctx || this.ctx.state !== 'running' || this.muted) return;
      const target = [...this.voices].filter(v => v.kind === kind).at(-1);
      if (target) {
        this.foldedShots++;
        target.charge = Math.min(4, (target.charge ?? 1) + level * level);
        target.bus.gain.setTargetAtTime(Math.sqrt(target.charge), this.ctx.currentTime, 0.008);
      }
      return;
    }
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay + 0.003 + Math.random() * 0.018;
    const source = ctx.createBufferSource();
    source.buffer = this.report(k, barrels, secondary);
    this.proceduralShots++;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = lerp(12500, 1600, far); filter.Q.value = 0.5;
    const volume = ctx.createGain(); volume.gain.value = level;
    source.connect(filter); filter.connect(volume); volume.connect(v.bus);
    this.schedule(v, source, [filter, volume], t, source.buffer.duration);
  }

  splash(cal: number, dist: number): void {
    const v = this.begin('impact', 'splash', 0.065);
    if (!v) return;
    const { gain, delay } = this.env(dist);
    this.burst(v, this.ctx!.currentTime + delay, lerp(0.4, 0.85, caliber(cal)),
      1400, 180, 0.27 * gain, 'bandpass', 0.55, 0.012);
  }

  hit(cal: number, dist: number): void {
    const v = this.begin('impact', 'hit', 0.065);
    if (!v) return;
    const { gain, delay } = this.env(dist);
    const t = this.ctx!.currentTime + delay;
    const level = gain * lerp(0.25, 0.48, caliber(cal));
    this.burst(v, t, 0.09, 2800, 650, level, 'bandpass');
    this.burst(v, t, 0.45, 680, 85, level);
    this.tone(v, t + 0.006, 0.24, 190, 58, level * 0.45, 'triangle');
  }

  explode(big: boolean, dist: number): void {
    const v = this.begin('impact', 'explode', big ? 0.18 : 0.1);
    if (!v) return;
    const { gain, delay } = this.env(dist);
    const t = this.ctx!.currentTime + delay;
    const k = big ? 1 : 0.65;
    this.burst(v, t, 0.16, 1700, 350, 0.32 * gain);
    this.burst(v, t + 0.01, 2.1 * k, 440, 45, 0.65 * gain * k, 'lowpass', 0.6, 0.012);
    this.tone(v, t, 0.85 * k, 83, 27, 0.5 * gain * k);
  }

  incoming(cal: number, flightLeft: number): void {
    if (!Number.isFinite(flightLeft) || flightLeft <= 0) return;
    const v = this.begin('incoming', 'incoming', 0.22);
    if (!v) return;
    const dur = Math.min(2.6, flightLeft);
    const k = caliber(cal);
    // No artificial minimum 0.4s: a late warning must not continue past impact.
    this.burst(v, this.ctx!.currentTime, dur, lerp(1900, 1150, k),
      lerp(650, 360, k), 0.065, 'bandpass', 3, dur * 0.65);
  }

  torpedo(): void {
    const v = this.begin('utility', 'torpedo', 0.15);
    if (v) this.burst(v, this.ctx!.currentTime, 0.55, 700, 120, 0.2, 'bandpass', 0.8, 0.012);
  }

  alarm(): void {
    const v = this.begin('utility', 'alarm', 0.8);
    if (!v) return;
    const t = this.ctx!.currentTime;
    this.tone(v, t, 0.18, 880, 660, 0.1, 'triangle');
    this.tone(v, t + 0.24, 0.18, 880, 660, 0.1, 'triangle');
  }
}
