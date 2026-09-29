import * as THREE from 'three';
import { SampleBank } from './bank';
import { makeNoise, type NoiseSet } from './procedural';
import { BuildingIndex } from './geometry';
import { acousticsChanged, analyzeAcoustics, makeImpulse, type Acoustics } from './acoustics';
import type { ClockTime } from './clock';
import type { Category, SoundScene } from './types';

/** dB → doğrusal kazanç */
export const db = (d: number): number => Math.pow(10, d / 20);

export interface VoiceOptions {
  /** HRTF (yakın, önemli kaynaklar) ya da eşit güçlü panoramik */
  hrtf?: boolean;
  /** Bu mesafeye kadar zayıflama yok (m) */
  ref?: number;
  rolloff?: number;
  max?: number;
  /** Yankıya gönderme düzeyi (0..1) */
  wet?: number;
  /** Hava soğurması + örtme süzgeci */
  filter?: boolean;
}

/**
 * Konumlu ses: kaynaklar `input`a bağlanır → alçak geçiren (örtme + hava soğurması) → PannerNode → kategori
 * veriyolu; süzgeç çıkışından yankı gönderimi (panner öncesi: uzak kaynakta yankı/doğrudan oranı artar).
 */
export class Voice {
  readonly input: GainNode;
  readonly filter: BiquadFilterNode;
  readonly panner: PannerNode;
  readonly send: GainNode;
  x = 0;
  y = 0;
  z = 0;
  private occ = 0;
  private wet: number;
  private alive = true;

  constructor(
    private readonly core: SoundCore,
    cat: Category,
    o: VoiceOptions = {},
  ) {
    const ctx = core.ctx;
    this.input = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.5;
    this.panner = ctx.createPanner();
    this.panner.panningModel = o.hrtf && core.hrtf ? 'HRTF' : 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = o.ref ?? 2;
    this.panner.rolloffFactor = o.rolloff ?? 1;
    this.panner.maxDistance = o.max ?? 10000;
    this.send = ctx.createGain();
    this.wet = o.wet ?? 0.3;
    this.send.gain.value = this.wet;
    this.input.connect(this.filter).connect(this.panner).connect(core.bus[cat]);
    this.filter.connect(this.send).connect(core.sendBus[cat]);
  }

  place(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    const p = this.panner;
    if (p.positionX) {
      const t = this.core.ctx.currentTime;
      if (!this.placed) {
        // İlk konum anında (orijinden süzülerek gelmesin)
        p.positionX.setValueAtTime(x, t);
        p.positionY.setValueAtTime(y, t);
        p.positionZ.setValueAtTime(z, t);
      } else {
        p.positionX.setTargetAtTime(x, t, 0.02);
        p.positionY.setTargetAtTime(y, t, 0.02);
        p.positionZ.setTargetAtTime(z, t, 0.02);
      }
    } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
    this.placed = true;
  }

  private placed = false;

  /** Dinleyiciye mesafe (m). */
  get distance(): number {
    const l = this.core.listener;
    return Math.hypot(this.x - l.x, this.y - l.y, this.z - l.z);
  }

  /**
   * Örtme (0..2 bina) ve mesafeye göre süzgeç + düzey. `occ` yumuşatılır (köşeyi dönünce birden açılmasın).
   * KARAR: tek bina ≈ −8 dB ve ~900 Hz kesim (kırınım), iki bina ≈ −13 dB ~500 Hz; hava soğurması 20 kHz → ~4 kHz
   * (1 km).
   */
  shade(occ: number, dt = 0.25, extraCut = 20000): void {
    const k = 1 - Math.exp(-dt / 0.35);
    this.occ += (occ - this.occ) * k;
    const d = this.distance;
    const air = 20000 / (1 + d / 160);
    const occCut =
      this.occ < 0.01
        ? 20000
        : 900 * Math.pow(0.55, Math.max(0, this.occ - 1)) + 18000 * (1 - Math.min(1, this.occ));
    const cut = Math.max(250, Math.min(air, occCut, extraCut));
    const t = this.core.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(cut, t, 0.08);
    const g = this.occ < 0.01 ? 1 : db(-8 * Math.min(1, this.occ) - 5 * Math.max(0, this.occ - 1));
    this.send.gain.setTargetAtTime(this.wet * g * this.core.wetScale(d), t, 0.1);
    this.occGain = g;
  }

  /** Örtme düzey çarpanı (kaynak düzeyine uygulanır). */
  occGain = 1;

  setWet(w: number): void {
    this.wet = w;
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    try {
      this.input.disconnect();
      this.filter.disconnect();
      this.panner.disconnect();
      this.send.disconnect();
    } catch {
      /* zaten kopuk */
    }
  }
}

/**
 * Ses çekirdeği: bağlam, kategori veriyolları, yankı (iki evrişimci arasında geçiş), dinleyici, bina dizini.
 */
export class SoundCore {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly bus: Record<Category, GainNode>;
  readonly sendBus: Record<Category, GainNode>;
  readonly noise: NoiseSet;
  readonly bank: SampleBank;
  readonly hrtf: boolean;
  readonly listener = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 0, fz: -1 };
  private reverbIn: GainNode;
  private conv: [ConvolverNode, ConvolverNode];
  private convGain: [GainNode, GainNode];
  private active = 0;
  private irParams: Acoustics | null = null;
  private irTimer = 0;
  private acTimer = 0;
  acoustics: Acoustics = { kind: 'open', enclosure: 0, width: 60, meanDist: 60, height: 0, rt60: 0.35 };
  geo: BuildingIndex | null = null;
  scene: SoundScene | null = null;
  clock!: ClockTime;
  night = 0;
  geoCenter: { readonly lat: number; readonly lon: number } = { lat: 40.2180548, lon: 28.9073262 };
  private seed = 12345;
  private lastPos = new THREE.Vector3(NaN, 0, 0);
  private m = new THREE.Vector3();
  private f = new THREE.Vector3();
  private u = new THREE.Vector3();

  constructor(ctx: AudioContext, base: string, quality: 'low' | 'medium' | 'high') {
    this.ctx = ctx;
    this.hrtf = quality !== 'low';
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    // Ana sınırlayıcı: çok kaynak üst üste binince kırpılmasın
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    const mk = () => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.bus = { ambience: mk(), traffic: mk(), steps: mk(), ezan: mk() };
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const mks = () => {
      const g = ctx.createGain();
      g.connect(this.reverbIn);
      return g;
    };
    this.sendBus = { ambience: mks(), traffic: mks(), steps: mks(), ezan: mks() };
    this.conv = [ctx.createConvolver(), ctx.createConvolver()];
    this.convGain = [ctx.createGain(), ctx.createGain()];
    for (let i = 0; i < 2; i++) {
      this.conv[i].normalize = false;
      this.reverbIn.connect(this.conv[i]).connect(this.convGain[i]).connect(this.master);
      this.convGain[i].gain.value = i === 0 ? 1 : 0;
    }
    this.noise = makeNoise(ctx, 4);
    this.bank = new SampleBank(ctx, base);
    this.setImpulse(this.acoustics, true);
  }

  rnd(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }

  setScene(scene: SoundScene | null): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.geo = scene ? new BuildingIndex(scene.buildings) : null;
    this.acTimer = 0;
  }

  voice(cat: Category, o?: VoiceOptions): Voice {
    return new Voice(this, cat, o);
  }

  /** Uzak kaynaklar yankıyı boğmasın: gönderim mesafeyle yavaş azalır. */
  wetScale(d: number): number {
    return 1 / Math.sqrt(1 + d / 60);
  }

  /** Dinleyici–kaynak örtmesi (0..2). */
  occlusion(x: number, y: number, z: number): number {
    const l = this.listener;
    if (!this.geo) return 0;
    return this.geo.occlusion(l.x, l.y, l.z, x, y, z, 2);
  }

  /** Doppler çarpanı: kaynak hızı (vx, vz) ve konumu → frekans oranı (dinleyici hızı dahil). */
  doppler(x: number, z: number, vx: number, vz: number): number {
    const l = this.listener;
    const dx = l.x - x;
    const dz = l.z - z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    const vs = vx * ux + vz * uz; // kaynak dinleyiciye doğru (+)
    const vl = -(l.vx * ux + l.vz * uz); // dinleyici kaynağa doğru (+)
    const c = 343;
    return Math.max(0.8, Math.min(1.25, (c + vl) / (c - vs)));
  }

  updateListener(camera: THREE.Camera, dt: number): void {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const p = this.m.set(e[12], e[13], e[14]);
    const fwd = this.f.set(-e[8], -e[9], -e[10]).normalize();
    const up = this.u.set(e[4], e[5], e[6]).normalize();
    const l = this.listener;
    // İlk kare ya da ışınlanma: dinleyici anında yerine (süzülerek gelmesin)
    let snap = !Number.isFinite(this.lastPos.x);
    if (!snap && dt > 0) {
      const k = 1 - Math.exp(-dt / 0.15);
      const jump = p.distanceTo(this.lastPos);
      snap = jump >= 20;
      if (jump < 20) {
        l.vx += ((p.x - this.lastPos.x) / dt - l.vx) * k;
        l.vy += ((p.y - this.lastPos.y) / dt - l.vy) * k;
        l.vz += ((p.z - this.lastPos.z) / dt - l.vz) * k;
      } else l.vx = l.vy = l.vz = 0; // ışınlanma
    }
    this.lastPos.copy(p);
    l.x = p.x;
    l.y = p.y;
    l.z = p.z;
    l.fx = fwd.x;
    l.fz = fwd.z;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      const set = (a: AudioParam, v: number) =>
        snap ? a.setValueAtTime(v, t) : a.setTargetAtTime(v, t, 0.015);
      set(L.positionX, p.x);
      set(L.positionY, p.y);
      set(L.positionZ, p.z);
      set(L.forwardX, fwd.x);
      set(L.forwardY, fwd.y);
      set(L.forwardZ, fwd.z);
      set(L.upX, up.x);
      set(L.upY, up.y);
      set(L.upZ, up.z);
    } else {
      const LL = L as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void;
      };
      LL.setPosition(p.x, p.y, p.z);
      LL.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    // Çevre akustiği: 4 Hz; IR en çok 2 sn'de bir yenilenir
    this.acTimer -= dt;
    this.irTimer -= dt;
    if (this.acTimer <= 0) {
      this.acTimer = 0.25;
      const a = analyzeAcoustics(this.geo, p.x, p.y, p.z);
      // Yumuşat: kapalılık ani değişmesin
      a.enclosure = this.acoustics.enclosure + (a.enclosure - this.acoustics.enclosure) * 0.35;
      this.acoustics = a;
      if (this.irTimer <= 0 && (!this.irParams || acousticsChanged(this.irParams, a))) {
        this.irTimer = 2;
        this.setImpulse(a);
      }
    }
  }

  private setImpulse(a: Acoustics, immediate = false): void {
    this.irParams = { ...a };
    const [L, R] = makeImpulse(this.ctx.sampleRate, a, Math.floor(a.width * 7 + a.rt60 * 100));
    // Enerji normalleştirme: türe göre hedef (açık alanda yankı zayıf)
    let e = 0;
    for (let i = 0; i < L.length; i++) e += L[i] * L[i] + R[i] * R[i];
    const target = a.kind === 'open' ? 0.35 : a.kind === 'canyon' ? 0.9 : 0.8;
    const s = target / Math.sqrt(e / 2 || 1);
    const buf = this.ctx.createBuffer(2, L.length, this.ctx.sampleRate);
    const b0 = buf.getChannelData(0);
    const b1 = buf.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      b0[i] = L[i] * s;
      b1[i] = R[i] * s;
    }
    const next = immediate ? this.active : 1 - this.active;
    this.conv[next].buffer = buf;
    if (immediate) return;
    const t = this.ctx.currentTime;
    this.convGain[next].gain.cancelScheduledValues(t);
    this.convGain[this.active].gain.cancelScheduledValues(t);
    this.convGain[next].gain.setTargetAtTime(1, t, 0.3);
    this.convGain[this.active].gain.setTargetAtTime(0, t, 0.3);
    this.active = next;
  }

  /** Kategori düzeyleri ve ana ses (0..1). */
  setLevels(master: number, cat: Record<Category, number>): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.08);
    for (const k of Object.keys(cat) as Category[]) {
      // Algısal: kaydırıcı karesel
      const g = cat[k] * cat[k];
      this.bus[k].gain.setTargetAtTime(g, t, 0.08);
      this.sendBus[k].gain.setTargetAtTime(g, t, 0.08);
    }
  }
}

/**
 * Döngülü tampon kaynağı: kod çözücü sessizliği atlanmış döngü noktaları, rastgele başlangıç.
 */
export function loopSource(
  core: SoundCore,
  buf: AudioBuffer,
  dest: AudioNode,
  rate = 1,
): AudioBufferSourceNode {
  const src = core.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = core.bank.loopPoints(buf);
  src.loopStart = lp.start;
  src.loopEnd = lp.end;
  src.playbackRate.value = rate;
  src.connect(dest);
  src.start(0, lp.start + core.rnd() * (lp.end - lp.start) * 0.95);
  return src;
}

/** Tek seferlik dilim çal (başlangıçta küçük pay: kod çözücü gecikmesi ±25 ms). */
export function playSlice(
  core: SoundCore,
  s: { buf: AudioBuffer; start: number; dur: number },
  dest: AudioNode,
  when: number,
  rate = 1,
  gain = 1,
): AudioBufferSourceNode {
  const ctx = core.ctx;
  const src = ctx.createBufferSource();
  src.buffer = s.buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  const start = Math.max(0, s.start - 0.012);
  const dur = (s.dur + 0.03) / rate;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.004);
  g.gain.setValueAtTime(gain, when + Math.max(0.005, dur - 0.03));
  g.gain.linearRampToValueAtTime(0, when + dur);
  src.connect(g).connect(dest);
  src.start(when, start, s.dur + 0.03);
  src.onended = () => g.disconnect();
  return src;
}
