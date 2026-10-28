/**
 * Procedural ambient audio built with the Web Audio API (no sample files).
 * Created on the first user gesture, as browsers require.
 *  - Engine: detuned sawtooth whose pitch follows speed and throttle.
 *  - Wind: band-passed noise that rises with speed.
 *  - Rain: high-passed noise scaled by the weather.
 *  - Tyres: noise that swells while the car slides.
 *  - City ambience: low-passed noise in dense areas.
 *  - Birds: short chirps in daylight rural areas.
 *  - Water: surf-like noise near the coast.
 */

export interface AudioFrame {
  speedMs: number;
  throttle: number;
  slip: number; // lateral speed magnitude, m/s
  rain: number; // 0..1
  urban: number; // 0..1
  rural: number; // 0..1 (forest/countryside)
  coast: number; // 0..1
  daylight: number; // 0..1
  volume: number; // 0..1 master
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rain!: GainNode;
  private tyres!: GainNode;
  private city!: GainNode;
  private surf!: GainNode;
  private noise!: AudioBuffer;
  private nextBird = 0;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture (e.g. the Play button). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // White noise buffer shared by all noise layers.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Engine
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();

    this.wind = this.loop(ctx, 'bandpass', 900, 0.8);
    this.wind.gain.connect(this.master);
    this.rain = this.loopTo(ctx, 'highpass', 3500, 0.7);
    this.tyres = this.loopTo(ctx, 'bandpass', 2400, 1.5);
    this.city = this.loopTo(ctx, 'lowpass', 700, 0.7);
    this.surf = this.loopTo(ctx, 'lowpass', 380, 0.7);
  }

  private loop(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain);
    src.start();
    return { gain, filter };
  }

  private loopTo(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number): GainNode {
    const l = this.loop(ctx, type, freq, q);
    l.gain.connect(this.master);
    return l.gain;
  }

  update(f: AudioFrame, now: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.15);
    set(this.master.gain, f.volume * 0.9);

    const speedFrac = Math.min(1, f.speedMs / 42);
    set(this.engineOsc.frequency, 38 + 110 * speedFrac + 14 * f.throttle);
    set(this.engineFilter.frequency, 350 + 700 * f.throttle + 300 * speedFrac);
    set(this.engineGain.gain, 0.035 + 0.05 * f.throttle + 0.02 * speedFrac);

    set(this.wind.gain.gain, 0.02 + 0.22 * speedFrac * speedFrac);
    set(this.wind.filter.frequency, 500 + 1200 * speedFrac);
    set(this.rain.gain, 0.18 * f.rain);
    set(this.tyres.gain, Math.min(0.2, Math.max(0, (f.slip - 2) / 10)) * 0.8 + (f.rain * 0.02));
    set(this.city.gain, 0.12 * f.urban + 0.02 * f.urban * speedFrac);
    set(this.surf.gain, 0.12 * f.coast);

    // Birds in daylight rural land.
    const birdsChance = f.rural * f.daylight * (1 - f.urban);
    if (birdsChance > 0.05 && now > this.nextBird) {
      this.chirp(ctx, t);
      this.nextBird = now + 1.2 + Math.random() * (6 - 4 * birdsChance);
    }
  }

  private chirp(ctx: AudioContext, t0: number) {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const start = t0 + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const base = 2200 + Math.random() * 1800;
      osc.frequency.setValueAtTime(base, start);
      osc.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), start + 0.08);
      osc.frequency.exponentialRampToValueAtTime(base * 0.9, start + 0.14);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.05, start + 0.02);
      gain.gain.linearRampToValueAtTime(0, start + 0.16);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.2);
    }
  }
}
