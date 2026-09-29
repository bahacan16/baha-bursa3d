import { db, loopSource, playSlice, type SoundCore, type Voice } from './core';
import { SynthEngine, noiseLoop } from './procedural';
import { hash01, nearestOnPolyline, pointAt, polylineCum } from './geometry';
import type { SoundCar, SoundRoad, SoundScene, XZ } from './types';

/**
 * Düzey kalibrasyonu (tüm ses modülleri): 0 dBFS ≈ 85 dB SPL. Kayıtlar fetch-sounds.mjs'de RMS −20 dBFS'e
 * normalleştirilir; kazanç = (hedef SPL − 85) − (−20).
 */
export const splGain = (spl: number): number => db(spl - 85 + 20);

/** Saatlik trafik yoğunluğu (0..1), Türkiye kent içi tipik eğri: sabah 8, akşam 18 zirvesi, gece 02–05 dip. */
export function trafficDensity(min: number, weekday: number): number {
  const h = min / 60;
  const curve = [
    0.18, 0.12, 0.08, 0.06, 0.06, 0.1, 0.28, 0.62, 0.95, 0.8, 0.66, 0.66, 0.72, 0.7, 0.68, 0.72, 0.82, 0.95,
    1, 0.9, 0.72, 0.55, 0.4, 0.27,
  ];
  const i = Math.floor(h) % 24;
  const f = h - Math.floor(h);
  const v = curve[i] * (1 - f) + curve[(i + 1) % 24] * f;
  // Hafta sonu sabah zirvesi yok, öğleden sonra yüksek
  return weekday === 0 || weekday === 6 ? Math.min(1, v * (h < 11 ? 0.6 : 0.9)) : v;
}

/** Yol sınıfı → uzak uğultu düzeyi (dB SPL, 30 m, gündüz). null = uğultu kaynağı yok. */
export function roadBedSpl(kind: string): number | null {
  switch (kind) {
    case 'motorway':
    case 'trunk':
      return 72;
    case 'primary':
      return 68;
    case 'secondary':
      return 66;
    case 'tertiary':
      return 62;
    default:
      return null;
  }
}

interface CarVoice {
  id: number;
  voice: Voice;
  engine: AudioBufferSourceNode | null;
  synth: SynthEngine | null;
  tyre: AudioBufferSourceNode;
  tyreFilter: BiquadFilterNode;
  engGain: GainNode;
  tyreGain: GainNode;
  lastSpeed: number;
  stopped: number;
  honkCd: number;
  passCd: number;
  diesel: boolean;
  rpmSeed: number;
}

interface RoadGroup {
  name: string;
  kind: string;
  parts: XZ[][];
}

interface BedVoice {
  voice: Voice;
  gain: GainNode;
  src: AudioBufferSourceNode;
}

interface Mover {
  voice: Voice;
  pts: XZ[];
  cum: number[];
  s: number;
  dir: number;
  speed: number;
  end: number;
}

interface PassVoice {
  voice: Voice;
  carId: number;
  end: number;
}

/**
 * Trafik sesi: en yakın araçlara motor + lastik sesi (hıza bağlı devir/perde, Doppler), hızla yaklaşan araçta gerçek
 * geçiş kaydı (en yakın an hizalanır), oyuncu önünü kesince korna; uzak ana yolların uğultusu (sınıf, mesafe,
 * binaların arkasında alçak geçiren); arada bir moto kurye ve uzak korna (görüş dışındaki yollarda).
 */
export class TrafficSound {
  private voices = new Map<number, CarVoice>();
  private groups: RoadGroup[] = [];
  private beds = new Map<string, BedVoice>();
  private bedTimer = 0;
  private bedScene: SoundScene | null = null;
  private movers: Mover[] = [];
  private passes: PassVoice[] = [];
  private mopedTimer = 40;
  private hornTimer = 25;
  private occTimer = 0;
  private roadsVeh: { road: SoundRoad; cum: number[] }[] = [];
  static MAX_VOICES = 8;
  static MAX_BEDS = 6;

  constructor(private readonly core: SoundCore) {}

  update(dt: number, scene: SoundScene | null, player: { x: number; z: number }, density: number): void {
    const core = this.core;
    if (scene !== this.bedScene) this.rebuild(scene);
    const cars = scene?.cars() ?? [];
    const l = core.listener;
    // Araç sesi atama: en yakın N araç (90 m içinde); histerezis: mevcut sesler 110 m'ye kadar kalır
    const cand: { c: SoundCar; d: number }[] = [];
    for (const c of cars) {
      const d = Math.hypot(c.x - l.x, c.z - l.z);
      if (d < (this.voices.has(c.id) ? 110 : 90)) cand.push({ c, d });
    }
    cand.sort((a, b) => a.d - b.d);
    const keep = new Map<number, SoundCar>();
    for (let i = 0; i < Math.min(TrafficSound.MAX_VOICES, cand.length); i++)
      keep.set(cand[i].c.id, cand[i].c);
    for (const [id, v] of this.voices)
      if (!keep.has(id)) {
        this.release(v);
        this.voices.delete(id);
      }
    this.occTimer -= dt;
    const doOcc = this.occTimer <= 0;
    if (doOcc) this.occTimer = 0.2;
    for (const c of keep.values()) {
      let v = this.voices.get(c.id);
      if (!v) this.voices.set(c.id, (v = this.acquire(c)));
      this.drive(v, c, dt, doOcc, player);
    }
    // Geçiş kayıtları araçla birlikte hareket eder
    const now = core.ctx.currentTime;
    for (let i = this.passes.length - 1; i >= 0; i--) {
      const p = this.passes[i];
      const c = keep.get(p.carId) ?? cars.find((k) => k.id === p.carId);
      if (c) p.voice.place(c.x, c.y + 0.5, c.z);
      if (now > p.end) {
        p.voice.dispose();
        this.passes.splice(i, 1);
      }
    }
    this.updateBeds(dt, density);
    this.updateEvents(dt, scene, density);
  }

  private acquire(c: SoundCar): CarVoice {
    const core = this.core;
    const voice = core.voice('traffic', { hrtf: true, ref: 4, rolloff: 1, wet: 0.35 });
    const engGain = core.ctx.createGain();
    engGain.gain.value = 0;
    const tyreGain = core.ctx.createGain();
    tyreGain.gain.value = 0;
    engGain.connect(voice.input);
    tyreGain.connect(voice.input);
    // KARAR: Türkiye binek filosunda dizel payı yüksek (~%40); hafif ticari hep dizel
    const diesel = c.kind === 3 || hash01(c.id * 7 + 1) < 0.4;
    let engine: AudioBufferSourceNode | null = null;
    let synth: SynthEngine | null = null;
    const eb = core.bank.buffer(
      diesel && core.bank.has('car_engine_diesel') ? 'car_engine_diesel' : 'car_engine',
    );
    if (eb) engine = loopSource(core, eb, engGain);
    else {
      synth = new SynthEngine(core.ctx, core.noise, diesel);
      synth.out.connect(engGain);
      synth.out.gain.value = 1;
    }
    const tb = core.bank.buffer('car_tyres');
    let tyre: AudioBufferSourceNode;
    let tyreFilter: BiquadFilterNode;
    if (tb) {
      tyreFilter = core.ctx.createBiquadFilter();
      tyreFilter.type = 'lowpass';
      tyreFilter.frequency.value = 3000;
      tyreFilter.connect(tyreGain);
      tyre = loopSource(core, tb, tyreFilter);
    } else {
      const n = noiseLoop(core.ctx, core.noise.pink, tyreGain, 'bandpass', 700, 0.5);
      tyre = n.src;
      tyreFilter = n.filter;
    }
    voice.place(c.x, c.y + 0.5, c.z);
    return {
      id: c.id,
      voice,
      engine,
      synth,
      tyre,
      tyreFilter,
      engGain,
      tyreGain,
      lastSpeed: c.speed,
      stopped: 0,
      honkCd: 3 + core.rnd() * 5,
      passCd: 0,
      diesel,
      rpmSeed: hash01(c.id),
    };
  }

  private release(v: CarVoice): void {
    const t = this.core.ctx.currentTime;
    v.engGain.gain.setTargetAtTime(0, t, 0.15);
    v.tyreGain.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => {
      try {
        v.engine?.stop();
        v.tyre.stop();
      } catch {
        /* zaten durdu */
      }
      v.synth?.stop();
      v.voice.dispose();
    }, 800);
  }

  /** Vites kutulu devir modeli: hız (m/s) → devir (rpm). */
  static rpm(speed: number, seed: number): number {
    const idle = 780 + seed * 120;
    if (speed < 0.5) return idle;
    const gears = [0, 4.5, 9, 13.5, 18, 30];
    let g = 0;
    while (g < gears.length - 2 && speed > gears[g + 1]) g++;
    const f = (speed - gears[g]) / (gears[g + 1] - gears[g]);
    return 1300 + f * 1500 + (g === 0 ? 0 : 200);
  }

  private drive(
    v: CarVoice,
    c: SoundCar,
    dt: number,
    doOcc: boolean,
    player: { x: number; z: number },
  ): void {
    const core = this.core;
    const t = core.ctx.currentTime;
    const vx = Math.sin(c.yaw) * c.speed;
    const vz = Math.cos(c.yaw) * c.speed;
    v.voice.place(c.x, c.y + 0.5, c.z);
    const dop = core.doppler(c.x, c.z, vx, vz);
    const acc = (c.speed - v.lastSpeed) / Math.max(1e-3, dt);
    v.lastSpeed = c.speed;
    const load = Math.max(0, Math.min(1, 0.3 + acc * 0.35));
    const rpm = TrafficSound.rpm(c.speed, v.rpmSeed);
    // Motor kaydı rölanti ≈ 850 rpm kabul edilir; perde devirle
    const rate = (rpm / 850) * dop * (v.diesel ? 0.92 : 1);
    // KARAR: tek rölanti kaydı ×2.2'den fazla tizleşince yapay duyulur; üstünde lastik sesi baskın zaten
    if (v.engine) v.engine.playbackRate.setTargetAtTime(Math.min(2.2, rate), t, 0.06);
    v.synth?.set(rpm, load, dop, t);
    const occG = v.voice.occGain;
    const duck = v.passCd > 0 ? 0.3 : 1;
    // KARAR: düzeyler (4 m) — rölanti ≈ 57 dB, hızlanma +5 dB; 50 km/s'te lastik ≈ 70 dB baskın
    const eng = splGain(57 + load * 5 + Math.min(1, c.speed / 12) * 4) * (v.diesel ? 1.15 : 1);
    v.engGain.gain.setTargetAtTime(eng * occG * duck * (v.synth ? 0.5 : 1), t, 0.08);
    const tyre = Math.pow(Math.min(1.4, c.speed / 13.9), 1.8);
    v.tyreGain.gain.setTargetAtTime(splGain(69) * tyre * occG * duck * (v.engine ? 1 : 0.5), t, 0.08);
    v.tyre.playbackRate.setTargetAtTime(Math.max(0.6, Math.min(1.5, (0.75 + c.speed / 30) * dop)), t, 0.1);
    v.tyreFilter.frequency.setTargetAtTime(500 + c.speed * 180, t, 0.1);
    if (doOcc) v.voice.shade(core.occlusion(c.x, c.y + 0.8, c.z), 0.2);
    // Gerçek geçiş kaydı: en yakın an 0.6–1.6 s sonra ve < 9 m ise
    v.passCd = Math.max(0, v.passCd - dt);
    if (v.passCd <= 0 && c.speed > 7 && core.bank.has('car_passby')) {
      const l = core.listener;
      const rx = c.x - l.x;
      const rz = c.z - l.z;
      const rvx = vx - l.vx;
      const rvz = vz - l.vz;
      const vv = rvx * rvx + rvz * rvz;
      const tc = vv > 1 ? -(rx * rvx + rz * rvz) / vv : -1;
      if (tc > 0.6 && tc < 1.6) {
        const dmin = Math.hypot(rx + rvx * tc, rz + rvz * tc);
        if (dmin < 9) this.passBy(v, c, tc, dmin);
      }
    }
    // Korna: oyuncu önünü kesiyor, araç duruyor
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    const dx = player.x - c.x;
    const dz = player.z - c.z;
    const along = dx * fx + dz * fz;
    const side = Math.abs(-dx * fz + dz * fx);
    if (c.speed < 0.5 && along > 0 && along < 10 && side < 2.3) v.stopped += dt;
    else v.stopped = Math.max(0, v.stopped - dt * 2);
    v.honkCd -= dt;
    if (v.stopped > 1.4 && v.honkCd <= 0) {
      v.honkCd = 5 + core.rnd() * 8;
      if (core.rnd() < 0.75) this.honk(v.voice, core.rnd() < 0.45 ? 2 : 1, 0);
    }
  }

  /**
   * Kayıtlı geçiş: kaydın zarfı yaklaşma/uzaklaşmayı zaten içerir → ayrı ses, 25 m'ye kadar mesafe zayıflaması
   * yok (çift zayıflama olmasın), yön araçla birlikte döner.
   */
  private passBy(v: CarVoice, c: SoundCar, tc: number, dmin: number): void {
    const core = this.core;
    const n = core.bank.fileCount('car_passby');
    const i = Math.floor(core.rnd() * n);
    const buf = core.bank.buffer('car_passby', i);
    const info = core.bank.fileInfo('car_passby', i);
    if (!buf || !info) return;
    const peak = info.peak ?? buf.duration / 2;
    // Kayıt ~50 km/s; hız farkına göre hafif perde
    const rate = Math.max(0.85, Math.min(1.15, 0.9 + c.speed / 90));
    const lead = peak / rate;
    const when = core.ctx.currentTime + Math.max(0, tc - lead);
    const offset = Math.max(0, lead - tc) * rate;
    const dur = (buf.duration - offset) / rate;
    const pv = core.voice('traffic', { hrtf: true, ref: 25, rolloff: 1, wet: 0.35 });
    pv.place(c.x, c.y + 0.5, c.z);
    // Kayıt ~3–5 m'den; en yakın geçiş uzaksa biraz kıs
    const g = splGain(72 - 20 * Math.log10(Math.max(1, dmin / 4)));
    playSlice(core, { buf, start: offset, dur: buf.duration - offset }, pv.input, when, rate, g);
    this.passes.push({ voice: pv, carId: c.id, end: when + dur + 0.2 });
    v.passCd = Math.max(2.5, dur * 0.8);
  }

  private honk(voice: Voice, times: number, farDb: number): void {
    const core = this.core;
    const t = core.ctx.currentTime + 0.05;
    for (let k = 0; k < times; k++) {
      const s = core.bank.pickSlice('car_horn', undefined, () => core.rnd());
      const when = t + k * (0.28 + core.rnd() * 0.1);
      // KARAR: korna 4 m'de ≈ 88 dB (gerçekte daha yüksek; sınırlayıcıyı zorlamasın)
      if (s) {
        const short = { ...s, dur: Math.min(s.dur, k === times - 1 ? 0.7 : 0.22) };
        playSlice(core, short, voice.input, when, 1, splGain(84 + farDb));
      } else {
        // Yedek: iki tonlu korna (≈ 410 + 515 Hz kare dalga)
        const g = core.ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(0.1 * db(farDb), when + 0.01);
        g.gain.setValueAtTime(0.1 * db(farDb), when + 0.2);
        g.gain.linearRampToValueAtTime(0, when + 0.24);
        const lp = core.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2500;
        lp.connect(g).connect(voice.input);
        for (const f of [410, 515]) {
          const o = core.ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = f;
          o.connect(lp);
          o.start(when);
          o.stop(when + 0.26);
        }
      }
    }
  }

  /** Ana yollar: ad (yoksa sınıf) başına parçalar; her grup için tek uğultu kaynağı en yakın noktada. */
  private rebuild(scene: SoundScene | null): void {
    for (const b of this.beds.values()) this.dropBed(b);
    this.beds.clear();
    this.groups = [];
    this.roadsVeh = [];
    this.bedScene = scene;
    if (!scene) return;
    const groups = new Map<string, RoadGroup>();
    for (const r of scene.roads) {
      if (!r.vehicular) continue;
      this.roadsVeh.push({ road: r, cum: polylineCum(r.pts) });
      if (roadBedSpl(r.kind) === null) continue;
      const key = r.name ?? `(${r.kind})`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { name: key, kind: r.kind, parts: [] }));
      g.parts.push(r.pts as XZ[]);
      // Adlı yolun sınıfı: en yüksek sınıf
      if ((roadBedSpl(r.kind) ?? 0) > (roadBedSpl(g.kind) ?? 0)) g.kind = r.kind;
    }
    this.groups = [...groups.values()];
  }

  private dropBed(b: BedVoice): void {
    b.gain.gain.setTargetAtTime(0, this.core.ctx.currentTime, 0.3);
    setTimeout(() => {
      try {
        b.src.stop();
      } catch {
        /* */
      }
      b.voice.dispose();
    }, 1500);
  }

  private updateBeds(dt: number, density: number): void {
    this.bedTimer -= dt;
    if (this.bedTimer > 0) return;
    this.bedTimer = 0.25;
    const core = this.core;
    const l = core.listener;
    const t = core.ctx.currentTime;
    const near: { g: RoadGroup; d: number; x: number; z: number }[] = [];
    for (const g of this.groups) {
      let best = { d: Infinity, x: 0, z: 0 };
      for (const pts of g.parts) {
        const p = nearestOnPolyline(pts, l.x, l.z);
        if (p.d < best.d) best = p;
      }
      if (best.d < 700) near.push({ g, ...best });
    }
    near.sort((a, b) => a.d - b.d);
    const active = new Set(near.slice(0, TrafficSound.MAX_BEDS).map((n) => n.g.name));
    for (const [name, b] of this.beds)
      if (!active.has(name)) {
        this.dropBed(b);
        this.beds.delete(name);
      }
    const buf = core.bank.buffer('traffic_bed');
    for (const n of near.slice(0, TrafficSound.MAX_BEDS)) {
      let b = this.beds.get(n.g.name);
      if (!b) {
        // Çizgi kaynak: mesafe katında ~3–4 dB (rolloff 0.55, ref 30 m)
        const voice = core.voice('traffic', { hrtf: false, ref: 30, rolloff: 0.55, wet: 0.25 });
        const gain = core.ctx.createGain();
        gain.gain.value = 0;
        gain.connect(voice.input);
        const src = buf
          ? loopSource(core, buf, gain)
          : noiseLoop(core.ctx, core.noise.brown, gain, 'lowpass', 500).src;
        this.beds.set(n.g.name, (b = { voice, gain, src }));
      }
      b.voice.place(n.x, 1.2, n.z);
      b.voice.shade(core.occlusion(n.x, 1.5, n.z), 0.25);
      const spl = (roadBedSpl(n.g.kind) ?? 60) + 10 * Math.log10(0.1 + density);
      b.gain.gain.setTargetAtTime(splGain(spl) * b.voice.occGain * (buf ? 1 : 0.5), t, 0.4);
    }
  }

  /** Uzak korna ve moto kurye geçişleri (görüş dışı yollarda). */
  private updateEvents(dt: number, scene: SoundScene | null, density: number): void {
    const core = this.core;
    for (let i = this.movers.length - 1; i >= 0; i--) {
      const m = this.movers[i];
      m.s += m.dir * m.speed * dt;
      const p = pointAt(m.pts, m.cum, m.s);
      m.voice.place(p.x, 1, p.z);
      m.voice.shade(core.occlusion(p.x, 1.2, p.z), dt);
      if (core.ctx.currentTime > m.end) {
        m.voice.dispose();
        this.movers.splice(i, 1);
      }
    }
    if (!scene || !this.roadsVeh.length) return;
    const clockMin = core.clock.minutes;
    this.mopedTimer -= dt;
    if (this.mopedTimer <= 0) {
      // KARAR: moto kurye yemek saatlerinde sık (12–14, 18–21), gece seyrek
      const meal = (clockMin > 720 && clockMin < 840) || (clockMin > 1080 && clockMin < 1260) ? 2 : 1;
      this.mopedTimer = (60 + core.rnd() * 150) / (meal * Math.max(0.15, density));
      if (core.bank.has('moped_passby')) this.moped();
    }
    this.hornTimer -= dt;
    if (this.hornTimer <= 0) {
      this.hornTimer = (20 + core.rnd() * 70) / Math.max(0.1, density);
      if (density > 0.15) this.distantHorn();
    }
  }

  /** Görüş dışında (en az bir bina arkasında) minD–maxD uzakta bir yol noktası. */
  private hiddenRoadPoint(
    minD: number,
    maxD: number,
  ): { r: { road: SoundRoad; cum: number[] }; s: number } | null {
    const core = this.core;
    const l = core.listener;
    for (let tries = 0; tries < 30; tries++) {
      const r = this.roadsVeh[Math.floor(core.rnd() * this.roadsVeh.length)];
      const L = r.cum[r.cum.length - 1];
      if (L < 40) continue;
      const s = core.rnd() * L;
      const p = pointAt(r.road.pts, r.cum, s);
      const d = Math.hypot(p.x - l.x, p.z - l.z);
      if (d < minD || d > maxD) continue;
      if (core.occlusion(p.x, 1.2, p.z) < 1 && tries < 24) continue;
      return { r, s };
    }
    return null;
  }

  private moped(): void {
    const core = this.core;
    const at = this.hiddenRoadPoint(50, 220);
    if (!at) return;
    const i = Math.floor(core.rnd() * core.bank.fileCount('moped_passby'));
    const buf = core.bank.buffer('moped_passby', i);
    const info = core.bank.fileInfo('moped_passby', i);
    if (!buf || !info) return;
    const voice = core.voice('traffic', { hrtf: false, ref: 20, rolloff: 1, wet: 0.35 });
    const dir = core.rnd() < 0.5 ? 1 : -1;
    const peak = info.peak ?? buf.duration / 2;
    const m: Mover = {
      voice,
      pts: at.r.road.pts as XZ[],
      cum: at.r.cum,
      s: at.s - dir * 12 * peak,
      dir,
      speed: 12,
      end: core.ctx.currentTime + buf.duration + 0.5,
    };
    const p = pointAt(m.pts, m.cum, m.s);
    voice.place(p.x, 1, p.z);
    playSlice(
      core,
      { buf, start: 0, dur: buf.duration },
      voice.input,
      core.ctx.currentTime + 0.05,
      1,
      splGain(74),
    );
    this.movers.push(m);
  }

  private distantHorn(): void {
    const core = this.core;
    const at = this.hiddenRoadPoint(60, 300);
    if (!at) return;
    const p = pointAt(at.r.road.pts, at.r.cum, at.s);
    const voice = core.voice('traffic', { hrtf: false, ref: 8, rolloff: 1, wet: 0.5 });
    voice.place(p.x, 1.2, p.z);
    voice.shade(core.occlusion(p.x, 1.2, p.z), 1);
    this.honk(voice, core.rnd() < 0.3 ? 2 : 1, -2);
    setTimeout(() => voice.dispose(), 3000);
  }

  dispose(): void {
    for (const v of this.voices.values()) this.release(v);
    this.voices.clear();
    for (const b of this.beds.values()) this.dropBed(b);
    this.beds.clear();
    for (const m of this.movers) m.voice.dispose();
    for (const p of this.passes) p.voice.dispose();
  }
}
