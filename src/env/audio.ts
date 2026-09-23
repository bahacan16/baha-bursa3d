/**
 * Prosedürel ses (Web Audio, dosya yok): zemine göre ayak sesi, şehir uğultusu, yakın trafik, gece cırcır böceği.
 * Tarayıcı kuralı gereği ilk kullanıcı etkileşiminde başlar.
 */
export type Surface = 'hard' | 'soft' | 'gravel';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private humGain: GainNode | null = null;
  private trafficGain: GainNode | null = null;
  private trafficFilter: BiquadFilterNode | null = null;
  private cricketGain: GainNode | null = null;
  private stepTimer = 0;
  private leftFoot = false;
  enabled = true;

  constructor() {
    const start = () => {
      this.init();
      removeEventListener('pointerdown', start);
      removeEventListener('keydown', start);
    };
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
  }

  private init(): void {
    if (this.ctx) return;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);
    // Beyaz gürültü tamponu (2 sn)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // Kahverengi gürültü → şehir uğultusu
    const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    const loop = (buffer: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.start();
      return s;
    };
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.12;
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass';
    humF.frequency.value = 350;
    loop(brown).connect(humF).connect(this.humGain).connect(this.master);
    // Yakın trafik: bant geçiren gürültü, araç yakınlığıyla açılır
    this.trafficGain = ctx.createGain();
    this.trafficGain.gain.value = 0;
    this.trafficFilter = ctx.createBiquadFilter();
    this.trafficFilter.type = 'bandpass';
    this.trafficFilter.frequency.value = 180;
    this.trafficFilter.Q.value = 0.7;
    loop(brown).connect(this.trafficFilter).connect(this.trafficGain).connect(this.master);
    // Cırcır böceği: yüksek frekans titreşimli ton (gece)
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
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
    osc.connect(am).connect(this.cricketGain).connect(this.master);
    osc.start();
    lfo.start();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  private step(surface: Surface, loud: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    this.leftFoot = !this.leftFoot;
    if (surface === 'hard') {
      f.type = 'bandpass';
      f.frequency.value = (this.leftFoot ? 1500 : 1750) + Math.random() * 300;
      f.Q.value = 1.2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * loud, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    } else if (surface === 'gravel') {
      f.type = 'highpass';
      f.frequency.value = 2500;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35 * loud, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    } else {
      f.type = 'lowpass';
      f.frequency.value = 600;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.45 * loud, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    }
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.2);
  }

  /**
   * @param speed yatay hız (m/s), @param onGround yerde mi, @param nearestCar en yakın araç (m), @param night 0..1
   */
  update(
    dt: number,
    speed: number,
    onGround: boolean,
    surface: Surface,
    nearestCar: number,
    night: number,
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (onGround && speed > 0.4) {
      const rate = speed < 3 ? 1.1 + speed * 0.45 : 2.6 + (speed - 3) * 0.12; // adım/sn
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = 1 / rate;
        this.step(surface, speed > 3 ? 1 : 0.7);
      }
    } else this.stepTimer = 0.05;
    const tr = Math.max(0, Math.min(1, 1 - nearestCar / 40));
    this.trafficGain?.gain.setTargetAtTime(tr * tr * 0.5, t, 0.2);
    this.trafficFilter?.frequency.setTargetAtTime(150 + tr * 250, t, 0.2);
    this.humGain?.gain.setTargetAtTime(0.1 * (1 - night * 0.6), t, 0.5);
    this.cricketGain?.gain.setTargetAtTime(night > 0.6 ? 0.012 : 0, t, 1.0);
  }
}
