import { db, loopSource, playSlice, type SoundCore, type Voice } from './core';
import { noiseLoop } from './procedural';
import { nearestOnPolyline, pointAt, polylineCum } from './geometry';
import { splGain } from './traffic';
import type { SoundRail, SoundScene, XZ } from './types';

/**
 * BursaRay sefer aralığı (dakika) — saat dilimine göre.
 * KARAR: Burulaş'ın yayımlanmış tarifesine erişilemedi; gündüz ~5–8 dk (brif), zirvede 5, akşam 10, 23'ten sonra
 * 15; 00:30–06:00 sefer yok. Her iki yön ayrı, faz kaydırmalı.
 */
export function railHeadway(min: number): number | null {
  const h = (((min / 60) % 24) + 24) % 24;
  if (h < 0.5) return 15;
  if (h < 6) return null;
  if (h < 7) return 10;
  if (h < 9.5) return 5;
  if (h < 16.5) return 7;
  if (h < 20) return 5;
  if (h < 22) return 8;
  return 15;
}

interface Track {
  pts: XZ[];
  cum: number[];
  len: number;
  /** +1 = çizim yönünde, −1 = ters */
  dir: number;
  /** İstasyon konumları (s, m) */
  stops: number[];
  bridge: [number, number][];
  next: number;
  phase: number;
}

interface Train {
  track: Track;
  s: number;
  v: number;
  state: 'run' | 'brake' | 'dwell' | 'accel';
  dwell: number;
  stopAt: number | null;
  voices: Voice[];
  gains: GainNode[];
  srcs: AudioBufferSourceNode[];
  motor: OscillatorNode | null;
  motorGain: GainNode | null;
  squealed: boolean;
}

const LENGTH = 62; // m — BursaRay 2 dizisi (≈2 araç)
const CRUISE = 16; // m/s ≈ 58 km/s
const ACC = 1.0;
const DEC = 1.1;
const DWELL = 25;

/**
 * Bursaray geçişleri: OSM ray geometrisi (tünel dışı), iki yön, istasyonda yavaşlama + fren gıcırtısı + bekleme +
 * kalkış (çekiş motoru vınlaması). Ses kaynakları dizinin önü, ortası ve arkasında (hareketli çizgi kaynak).
 * KARAR: tren modeli sahnede yok — yalnız ses (brif); yakın mesafede görsel eşleşme yok.
 */
export class RailSound {
  private tracks: Track[] = [];
  private trains: Train[] = [];
  private scene: SoundScene | null = null;
  private occTimer = 0;

  constructor(private readonly core: SoundCore) {}

  private rebuild(scene: SoundScene | null): void {
    for (const t of this.trains) this.drop(t);
    this.trains = [];
    this.tracks = [];
    this.scene = scene;
    if (!scene) return;
    // Adlı ana hat (BursaRay 2); adsız makas/bağlantı yolları (service=crossover) iki hattı birleştirmesin
    const segs = scene.rails.filter(
      (r) => !r.tunnel && !!r.name && /subway|light_rail|tram|rail/.test(r.kind),
    );
    const paths = chainRails(segs);
    for (const p of paths) {
      const cum = polylineCum(p.pts);
      const len = cum[cum.length - 1];
      if (len < 150) continue;
      const stops: number[] = [];
      for (const st of scene.stations) {
        const n = nearestOnPolyline(p.pts, st.x, st.z);
        if (n.d < 25) stops.push(n.s);
      }
      this.tracks.push({ pts: p.pts, cum, len, dir: 1, stops, bridge: p.bridge, next: 0, phase: 0 });
    }
    // Karşılıklı iki hat: sağdan akış (Türkiye) — hattın solundaki komşu hatta göre yön seç
    for (const t of this.tracks) {
      const mid = pointAt(t.pts, t.cum, t.len / 2);
      let other: Track | null = null;
      let bd = Infinity;
      for (const o of this.tracks) {
        if (o === t) continue;
        const n = nearestOnPolyline(o.pts, mid.x, mid.z);
        if (n.d < bd) {
          bd = n.d;
          other = o;
        }
      }
      if (other && bd < 15) {
        const n = nearestOnPolyline(other.pts, mid.x, mid.z);
        // Sağ vektör (ileri = d): (−dz, dx)… x doğu, z güney: ileri (dx,dz) için sağ = (−dz, dx)
        const rx = -mid.dz;
        const rz = mid.dx;
        const side = (n.x - mid.x) * rx + (n.z - mid.z) * rz;
        // Diğer hat sağda ise bu hat solda → ters yönde gidilir
        t.dir = side > 0 ? -1 : 1;
      }
      t.phase = this.core.rnd();
    }
  }

  update(dt: number, scene: SoundScene | null): void {
    if (scene !== this.scene) this.rebuild(scene);
    if (!this.tracks.length) return;
    const core = this.core;
    const now = core.clock.ms / 1000;
    const hw = railHeadway(core.clock.minutes);
    for (const tr of this.tracks) {
      if (!tr.next) tr.next = now + (hw ?? 10) * 60 * tr.phase;
      if (hw !== null && now >= tr.next && this.trains.filter((x) => x.track === tr).length < 2) {
        tr.next = now + hw * 60 * (0.85 + core.rnd() * 0.3);
        // Duyulmayacak kadar uzak hatlarda (> 900 m) ses düğümü kurma; sefer yine sayılır
        const l = core.listener;
        if (nearestOnPolyline(tr.pts, l.x, l.z).d < 900) this.spawn(tr);
      } else if (hw === null) tr.next = now + 600;
    }
    this.occTimer -= dt;
    const doOcc = this.occTimer <= 0;
    if (doOcc) this.occTimer = 0.2;
    for (let i = this.trains.length - 1; i >= 0; i--) {
      const t = this.trains[i];
      if (!this.step(t, dt, doOcc)) {
        this.drop(t);
        this.trains.splice(i, 1);
      }
    }
  }

  private spawn(track: Track): void {
    const core = this.core;
    const voices: Voice[] = [];
    const gains: GainNode[] = [];
    const srcs: AudioBufferSourceNode[] = [];
    const buf = core.bank.buffer('rail_roll');
    for (let k = 0; k < 3; k++) {
      const v = core.voice('traffic', { hrtf: k === 1, ref: 15, rolloff: 1, wet: 0.45 });
      const g = core.ctx.createGain();
      g.gain.value = 0;
      g.connect(v.input);
      const src = buf
        ? loopSource(core, buf, g, 0.9 + k * 0.05)
        : noiseLoop(core.ctx, core.noise.brown, g, 'lowpass', 380 + k * 60, 0.9).src;
      voices.push(v);
      gains.push(g);
      srcs.push(src);
    }
    // Çekiş motoru (DC kıyıcı / VVVF) vınlaması: saf tonlar — gerçekte de elektronik ton (sentez uygundur)
    const motor = core.ctx.createOscillator();
    motor.type = 'triangle';
    const motorGain = core.ctx.createGain();
    motorGain.gain.value = 0;
    motor.connect(motorGain).connect(voices[1].input);
    motor.start();
    this.trains.push({
      track,
      s: track.dir > 0 ? -LENGTH : track.len + LENGTH,
      v: CRUISE,
      state: 'run',
      dwell: 0,
      stopAt: null,
      voices,
      gains,
      srcs,
      motor,
      motorGain,
      squealed: false,
    });
  }

  private step(t: Train, dt: number, doOcc: boolean): boolean {
    const core = this.core;
    const tr = t.track;
    const dir = tr.dir;
    // Sıradaki istasyon
    if (t.stopAt === null && t.state === 'run') {
      for (const s of tr.stops) {
        const ahead = (s - t.s) * dir;
        const need = (t.v * t.v) / (2 * DEC) + 5;
        if (ahead > 0 && ahead < need) {
          t.stopAt = s;
          t.state = 'brake';
          t.squealed = false;
        }
      }
    }
    if (t.state === 'brake' && t.stopAt !== null) {
      const ahead = (t.stopAt - t.s) * dir;
      const vTarget = Math.sqrt(Math.max(0, 2 * DEC * Math.max(0, ahead)));
      t.v = Math.max(0, Math.min(t.v, vTarget));
      if (!t.squealed && t.v < 5 && t.v > 0.5) {
        t.squealed = true;
        this.squeal(t);
      }
      if (ahead <= 0.5 || t.v < 0.05) {
        t.v = 0;
        t.state = 'dwell';
        t.dwell = DWELL * (0.8 + core.rnd() * 0.4);
      }
    } else if (t.state === 'dwell') {
      t.dwell -= dt;
      if (t.dwell <= 0) t.state = 'accel';
    } else if (t.state === 'accel') {
      t.v = Math.min(CRUISE, t.v + ACC * dt);
      if (t.v >= CRUISE) {
        t.state = 'run';
        t.stopAt = null;
      }
    }
    t.s += dir * t.v * dt;
    if ((dir > 0 && t.s > tr.len + LENGTH * 2) || (dir < 0 && t.s < -LENGTH * 2)) return false;
    const time = core.ctx.currentTime;
    const onBridge = tr.bridge.some(([a, b]) => t.s >= a && t.s <= b);
    // Yuvarlanma sesi hızla (≈ v^1.5), köprüde tok yankılı (+3 dB)
    const roll = Math.pow(t.v / CRUISE, 1.5);
    for (let k = 0; k < 3; k++) {
      const off = -dir * (LENGTH * (k / 2));
      const s = t.s + off;
      const p = pointAt(tr.pts, tr.cum, Math.max(0, Math.min(tr.len, s)));
      const inside = s >= 0 && s <= tr.len;
      const y = (onBridge ? 7 : 0) + 1.2;
      t.voices[k].place(p.x, y, p.z);
      if (doOcc) t.voices[k].shade(core.occlusion(p.x, y + 1.5, p.z), 0.2);
      // KARAR: 15 m'de ≈ 78 dB (58 km/s geçiş), duruşta yalnız klima/kompresör uğultusu ≈ 58 dB
      const spl = inside ? 78 + (onBridge ? 3 : 0) : 60;
      const g = splGain(spl) * roll * t.voices[k].occGain;
      const idle = t.state === 'dwell' && inside ? splGain(56) * 0.5 * t.voices[k].occGain : 0;
      t.gains[k].gain.setTargetAtTime(Math.max(g, idle), time, 0.15);
      const rate = 0.8 + 0.25 * (t.v / CRUISE);
      t.srcs[k].playbackRate.setTargetAtTime(rate, time, 0.2);
    }
    if (t.motor && t.motorGain) {
      // Kalkışta yükselen, frenlemede alçalan vınlama (≈ 180 → 1400 Hz)
      const accel = t.state === 'accel' || (t.state === 'run' && t.v < CRUISE);
      const brake = t.state === 'brake';
      const f = 180 + 1200 * (t.v / CRUISE);
      t.motor.frequency.setTargetAtTime(f, time, 0.1);
      const mg = accel ? db(-24) : brake ? db(-30) : db(-40);
      t.motorGain.gain.setTargetAtTime(t.v > 0.3 ? mg * t.voices[1].occGain : 0, time, 0.2);
    }
    return true;
  }

  private squeal(t: Train): void {
    const core = this.core;
    const s = core.bank.pickSlice('rail_brake', undefined, () => core.rnd());
    const v = t.voices[0];
    const when = core.ctx.currentTime + 0.05;
    if (s) playSlice(core, s, v.input, when, 1, splGain(76));
    else {
      // Yedek: yüksek frekanslı gıcırtı (tekerlek–ray sürtünmesi ~3–5 kHz)
      const o = core.ctx.createOscillator();
      o.frequency.setValueAtTime(3900, when);
      o.frequency.linearRampToValueAtTime(3600, when + 2.5);
      const g = core.ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.012, when + 0.4);
      g.gain.linearRampToValueAtTime(0, when + 2.6);
      o.connect(g).connect(v.input);
      o.start(when);
      o.stop(when + 2.7);
    }
  }

  private drop(t: Train): void {
    const time = this.core.ctx.currentTime;
    for (const g of t.gains) g.gain.setTargetAtTime(0, time, 0.2);
    t.motorGain?.gain.setTargetAtTime(0, time, 0.2);
    setTimeout(() => {
      for (const s of t.srcs)
        try {
          s.stop();
        } catch {
          /* */
        }
      try {
        t.motor?.stop();
      } catch {
        /* */
      }
      for (const v of t.voices) v.dispose();
    }, 1200);
  }

  /** Hata ayıklama: hemen bir tren başlat. */
  spawnNow(): void {
    const l = this.core.listener;
    let best: Track | null = null;
    let bd = Infinity;
    for (const t of this.tracks) {
      const d = nearestOnPolyline(t.pts, l.x, l.z).d;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best) this.spawn(best);
  }

  get count(): number {
    return this.trains.length;
  }
}

/** Uç uca eklenen ray parçalarından sürekli hatlar (köprü aralıkları s cinsinden). */
export function chainRails(segs: readonly SoundRail[]): { pts: XZ[]; bridge: [number, number][] }[] {
  const left = segs.map((r) => ({ pts: [...r.pts] as XZ[], bridge: r.bridge }));
  const out: { pts: XZ[]; bridge: [number, number][] }[] = [];
  const near = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5;
  while (left.length) {
    const first = left.shift()!;
    const parts: { pts: XZ[]; bridge: boolean }[] = [first];
    let pts = [...first.pts];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const s = left[i];
        const a = s.pts[0];
        const b = s.pts[s.pts.length - 1];
        const head = pts[0];
        const tail = pts[pts.length - 1];
        let add: XZ[] | null = null;
        let atHead = false;
        if (near(tail, a)) add = s.pts;
        else if (near(tail, b)) add = [...s.pts].reverse();
        else if (near(head, b)) {
          add = s.pts;
          atHead = true;
        } else if (near(head, a)) {
          add = [...s.pts].reverse();
          atHead = true;
        }
        if (!add) continue;
        if (atHead) {
          pts = [...add.slice(0, -1), ...pts];
          parts.unshift({ pts: add, bridge: s.bridge });
        } else {
          pts = [...pts, ...add.slice(1)];
          parts.push({ pts: add, bridge: s.bridge });
        }
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    // Köprü aralıkları
    const bridge: [number, number][] = [];
    let acc = 0;
    for (const p of parts) {
      const c = polylineCum(p.pts);
      const L = c[c.length - 1];
      if (p.bridge) bridge.push([acc, acc + L]);
      acc += L;
    }
    out.push({ pts, bridge });
  }
  return out;
}
