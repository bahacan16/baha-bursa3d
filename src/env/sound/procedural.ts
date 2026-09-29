/**
 * Prosedürel yedek sesler (kayıt dosyası yokken): gürültü tamponları, adım sentezi, motor/lastik, cırcır böceği,
 * ray uğultusu. Eski `audio.ts` sentezinin genişletilmiş hâli. Ezan ve kuşlar asla sentezlenmez.
 */
import type { StepSynth } from './surfaces';

export interface NoiseSet {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

export function makeNoise(ctx: BaseAudioContext, seconds = 4): NoiseSet {
  const n = Math.floor(ctx.sampleRate * seconds);
  const white = ctx.createBuffer(1, n, ctx.sampleRate);
  const pink = ctx.createBuffer(1, n, ctx.sampleRate);
  const brown = ctx.createBuffer(1, n, ctx.sampleRate);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const b = brown.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0,
    last = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    // Paul Kellet pembe gürültü
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  // Döngü dikişi: uçları kısa çapraz geçiş
  for (const d of [w, p, b]) {
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) {
      const g = i / f;
      d[i] = d[i] * g + d[n - f + i] * (1 - g);
    }
  }
  return { white, pink, brown };
}

/** Adım sentezi: gürültü darbesi + zemine göre süzgeç/zarf. `dest`e bağlanır. */
export function synthStep(
  ctx: BaseAudioContext,
  noise: NoiseSet,
  dest: AudioNode,
  when: number,
  kind: StepSynth,
  loud: number,
  left: boolean,
): void {
  const src = ctx.createBufferSource();
  src.buffer = kind === 'soft' ? noise.pink : noise.white;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  const t = when;
  let dur: number;
  if (kind === 'hard' || kind === 'metal' || kind === 'wood') {
    f.type = 'bandpass';
    f.frequency.value =
      (kind === 'wood' ? 700 : kind === 'metal' ? 2400 : left ? 1500 : 1750) + Math.random() * 300;
    f.Q.value = kind === 'metal' ? 6 : 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * loud, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'metal' ? 0.25 : 0.09));
    dur = kind === 'metal' ? 0.3 : 0.12;
    // Topuk + taban: ikinci küçük vuruş
    const s2 = ctx.createBufferSource();
    s2.buffer = noise.white;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = f.frequency.value * 0.8;
    f2.Q.value = 1.2;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t + 0.045);
    g2.gain.exponentialRampToValueAtTime(0.18 * loud, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    s2.connect(f2).connect(g2).connect(dest);
    s2.start(t + 0.04, Math.random() * 2, 0.1);
  } else if (kind === 'gravel') {
    f.type = 'highpass';
    f.frequency.value = 2500;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * loud, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    dur = 0.2;
  } else {
    f.type = 'lowpass';
    f.frequency.value = 600;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45 * loud, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    dur = 0.2;
  }
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 3, dur);
}

/**
 * Motor sentezi (yedek): testere dişi ateşleme tonu + alt harmonik + gürültü, alçak geçiren. `setRpm` ile sürülür.
 */
export class SynthEngine {
  readonly out: GainNode;
  private osc: OscillatorNode;
  private sub: OscillatorNode;
  private lp: BiquadFilterNode;
  private noise: AudioBufferSourceNode;
  private noiseGain: GainNode;

  constructor(ctx: BaseAudioContext, noise: NoiseSet, diesel: boolean) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 400;
    this.lp.Q.value = 0.7;
    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.sub = ctx.createOscillator();
    this.sub.type = 'triangle';
    const oscG = ctx.createGain();
    oscG.gain.value = diesel ? 0.35 : 0.25;
    const subG = ctx.createGain();
    subG.gain.value = 0.3;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noise.brown;
    this.noise.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = diesel ? 0.5 : 0.3;
    this.osc.connect(oscG).connect(this.lp);
    this.sub.connect(subG).connect(this.lp);
    this.noise.connect(this.noiseGain).connect(this.lp);
    this.lp.connect(this.out);
    this.osc.start();
    this.sub.start();
    this.noise.start(0, Math.random() * 3);
  }

  /** rpm, yük 0..1, doppler çarpanı */
  set(rpm: number, load: number, doppler: number, t: number): void {
    const f = ((rpm / 60) * 2 * doppler) / 1; // 4 silindir 4 zamanlı: ateşleme = rpm/60 × 2
    this.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.sub.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.lp.frequency.setTargetAtTime(250 + load * 900 + rpm * 0.08, t, 0.08);
  }

  stop(): void {
    try {
      this.osc.stop();
      this.sub.stop();
      this.noise.stop();
    } catch {
      /* zaten durdu */
    }
  }
}

/** Cırcır böceği (yedek): yüksek frekans tonu, hızlı genlik modülasyonu. */
export function synthCrickets(ctx: BaseAudioContext, dest: AudioNode): () => void {
  const osc = ctx.createOscillator();
  osc.frequency.value = 4300;
  const am = ctx.createGain();
  am.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 18;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.5;
  lfo.connect(lfoGain).connect(am.gain);
  osc.connect(am).connect(dest);
  osc.start();
  lfo.start();
  return () => {
    osc.stop();
    lfo.stop();
  };
}

/** Sürekli gürültü döngüsü (şehir uğultusu, yol uğultusu, lastik) → süzgeç → `dest`. */
export function noiseLoop(
  ctx: BaseAudioContext,
  buf: AudioBuffer,
  dest: AudioNode,
  type: BiquadFilterType,
  freq: number,
  q = 0.7,
): { src: AudioBufferSourceNode; filter: BiquadFilterNode } {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  src.connect(filter).connect(dest);
  src.start(0, Math.random() * buf.duration);
  return { src, filter };
}
