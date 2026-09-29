import { db, loopSource, playSlice, type SoundCore, type Voice } from './core';
import { noiseLoop, synthCrickets } from './procedural';
import { splGain } from './traffic';
import { prayerTimes } from './prayer';
import type { SoundPlace, SoundScene } from './types';
import { windTime } from '../../worlds/osm/eztree';

/** Kuş etkinliği (0..1): şafak korosu, öğlen düşük, akşamüstü ikinci tepe, gece 0. */
export function birdActivity(min: number, sunrise: number, sunset: number): number {
  if (min < sunrise - 50 || min > sunset + 25) return 0;
  const dawn = Math.exp(-Math.pow((min - (sunrise + 45)) / 70, 2));
  const dusk = Math.exp(-Math.pow((min - (sunset - 60)) / 80, 2));
  const day = min > sunrise && min < sunset ? 0.4 : 0.1;
  return Math.min(1, Math.max(day, dawn, dusk * 0.8));
}

/** Okul çıkışı / hafta sonu / yaz tatili: site avlusunda çocuk sesi olasılığı (0..1). */
export function childrenActivity(min: number, weekday: number, month: number, day: number): number {
  const summer = (month === 6 && day >= 20) || month === 7 || month === 8 || (month === 9 && day < 8);
  const weekend = weekday === 0 || weekday === 6;
  const w = (a: number, b: number) => (min >= a && min <= b ? 1 : 0);
  // KARAR: hafta içi 15:30–19:30 (okul çıkışı) + öğle arası az; hafta sonu ve yaz tatili 10:00–20:30
  if (weekend || summer) return w(600, 1230) * (min > 960 && min < 1170 ? 1 : 0.6);
  return Math.max(w(930, 1170), w(720, 780) * 0.25);
}

type Build = (dest: AudioNode) => AudioBufferSourceNode;

interface Loop {
  voice: Voice | null;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  stop?: () => void;
  /** Kayıt yokken prosedürel (kayıt gelince yenilenir) */
  proc: boolean;
  x: number;
  z: number;
  level: number;
  burst: number;
  burstT: number;
  /** Örtme (0..2), 0.3 s'de bir yenilenir */
  occ: number;
}

/**
 * Doğa ve mahalle ambiyansı: şehir zemini (gündüz/gece), kuşlar (serçe cıvıltısı çalılarda, kumru çatı ve
 * antenlerde, karga/saksağan, arada martı), ağaçlarda rüzgâr hışırtısı (oyunun rüzgâr zamanıyla), gece cırcır
 * böceği, uzak köpek havlaması, site avlularında çocuk sesleri, hafta içi uzak inşaat, akşam hafif ev sesleri.
 * Kuşlar, köpek, çocuk, ev sesleri yalnız kayıtla çalar (sentez yok).
 */
export class Nature {
  private bedDay: Loop | null = null;
  private bedNight: Loop | null = null;
  private windBed: Loop | null = null;
  private wind: Loop[] = [];
  private sparrows: Loop[] = [];
  private crickets: Loop[] = [];
  private cricketSynth: Loop | null = null;
  private children: Loop[] = [];
  private construction: Loop | null = null;
  private timers: Record<string, number> = {
    dove: 8,
    crow: 40,
    magpie: 70,
    gull: 120,
    pigeon: 30,
    dog: 50,
    house: 60,
  };
  private placeTimer = 0;
  private occTimer = 0;
  private scene: SoundScene | null = null;
  private sunCache = { key: '', rise: 400, set: 1140 };
  private treeNear: number[] = [];
  /** Cırcır mevsimi ve saati (yerleştirme için) */
  private crickOn = false;

  constructor(private readonly core: SoundCore) {}

  /** Konumlu döngü; kayıt hazır değilse ve yedek yoksa null. */
  private loop(slot: string, ref: number, hrtf: boolean, wet: number, fallback?: Build): Loop | null {
    const core = this.core;
    const n = core.bank.fileCount(slot);
    const buf = n ? core.bank.buffer(slot, Math.floor(core.rnd() * n)) : null;
    if (!buf && !fallback) return null;
    const voice = core.voice('ambience', { hrtf, ref, rolloff: 1, wet });
    const gain = core.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(voice.input);
    const src = buf ? loopSource(core, buf, gain, 0.97 + core.rnd() * 0.06) : fallback!(gain);
    return { voice, gain, src, proc: !buf, x: NaN, z: NaN, level: 1, burst: 1, burstT: 0, occ: 0 };
  }

  /** Konumsuz stereo zemin (doğrudan ambiyans veriyoluna). */
  private bed(slot: string, fallback: Build | null): Loop | null {
    const core = this.core;
    const buf = core.bank.buffer(slot);
    if (!buf && !fallback) return null;
    const gain = core.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(core.bus.ambience);
    const src = buf ? loopSource(core, buf, gain) : fallback!(gain);
    return { voice: null, gain, src, proc: !buf, x: 0, z: 0, level: 1, burst: 1, burstT: 0, occ: 0 };
  }

  private dropLoop(l: Loop | null): void {
    if (!l) return;
    l.gain.gain.setTargetAtTime(0, this.core.ctx.currentTime, 0.4);
    setTimeout(() => {
      try {
        l.src?.stop();
      } catch {
        /* zaten durdu */
      }
      l.stop?.();
      l.gain.disconnect();
      l.voice?.dispose();
    }, 2500);
  }

  private sun(): { rise: number; set: number } {
    const c = this.core.clock;
    const key = `${c.year}-${c.month}-${c.day}`;
    if (this.sunCache.key !== key) {
      const g = this.core.geoCenter;
      const p = prayerTimes(c.year, c.month, c.day, g.lat, g.lon, 3, false);
      this.sunCache = { key, rise: p.gunes, set: p.aksam };
    }
    return this.sunCache;
  }

  /** Prosedürel zemin kayıt gelince kayda dönsün. */
  private refreshBed(l: Loop | null, slot: string, make: () => Loop | null): Loop | null {
    if (l && l.proc && this.core.bank.buffer(slot)) {
      this.dropLoop(l);
      return make();
    }
    return l ?? make();
  }

  update(dt: number, scene: SoundScene | null, density: number): void {
    const core = this.core;
    const t = core.ctx.currentTime;
    const c = core.clock;
    const min = c.minutes;
    const { rise, set } = this.sun();
    const night = core.night;
    if (scene !== this.scene) {
      this.scene = scene;
      for (const l of [...this.sparrows, ...this.crickets, ...this.children, ...this.wind]) this.dropLoop(l);
      this.sparrows = [];
      this.crickets = [];
      this.children = [];
      this.wind = [];
      this.dropLoop(this.construction);
      this.construction = null;
      this.placeTimer = 0;
    }
    // Şehir zemini: gündüz / gece; kayıt yoksa eski kahverengi gürültü uğultusu
    this.bedDay = this.refreshBed(this.bedDay, 'amb_day', () =>
      this.bed('amb_day', (d) => noiseLoop(core.ctx, core.noise.brown, d, 'lowpass', 350).src),
    );
    // Gece zemini yalnız akşam/gece çözülür (bellek)
    if (!this.bedNight && night > 0.15) this.bedNight = this.bed('amb_night', null);
    const shelter = core.acoustics.kind === 'courtyard' ? db(-3) : 1;
    const busy = 0.55 + 0.45 * density;
    if (this.bedDay) {
      // KARAR: gündüz konut bölgesi zemini ≈ 47 dB, gece ≈ 41 dB (kayıt varsa ayrı gece zemini)
      const lvl = this.bedDay.proc ? 0.1 : splGain(47);
      const k = this.bedNight ? 1 - night : 1 - night * 0.6;
      this.bedDay.gain.gain.setTargetAtTime(lvl * k * shelter * busy, t, 0.8);
    }
    if (this.bedNight) this.bedNight.gain.gain.setTargetAtTime(splGain(41) * night * shelter, t, 0.8);

    this.placeTimer -= dt;
    if (this.placeTimer <= 0) {
      this.placeTimer = 1.5;
      this.placeSources(scene, min, rise, set, c.weekday, c.month, c.day);
    }
    this.occTimer -= dt;
    const doOcc = this.occTimer <= 0;
    if (doOcc) this.occTimer = 0.3;
    this.updateWind(dt, t, doOcc);
    // Serçe kolonileri: patlamalı cıvıltı
    const act = birdActivity(min, rise, set) * (1 - night);
    for (const s of this.sparrows) {
      s.burstT -= dt;
      if (s.burstT <= 0) {
        s.burstT = 2 + core.rnd() * 7;
        s.burst = core.rnd() < 0.35 ? 0.15 : 0.5 + core.rnd() * 0.5;
      }
      if (doOcc) s.occ = core.occlusion(s.x, 3, s.z);
      s.voice!.shade(s.occ, dt);
      s.gain.gain.setTargetAtTime(splGain(60) * act * s.burst * s.voice!.occGain, t, 0.6);
    }
    // Cırcır: yaz–sonbahar geceleri
    const season = c.month >= 5 && c.month <= 10 ? 1 : c.month === 4 || c.month === 11 ? 0.3 : 0;
    const eve = min > set + 20 || min < rise - 30 ? 1 : 0;
    const crick = Math.max(night > 0.55 ? 1 : 0, eve) * season;
    this.crickOn = crick > 0;
    for (const cr of this.crickets) {
      if (doOcc) cr.occ = core.occlusion(cr.x, 0.5, cr.z);
      cr.voice!.shade(cr.occ, dt);
      cr.gain.gain.setTargetAtTime(splGain(52) * crick * cr.voice!.occGain, t, 1.5);
    }
    if (!core.bank.has('crickets')) {
      if (!this.cricketSynth && crick > 0) {
        const g = core.ctx.createGain();
        g.gain.value = 0;
        g.connect(core.bus.ambience);
        const stop = synthCrickets(core.ctx, g);
        this.cricketSynth = {
          voice: null,
          gain: g,
          src: null,
          stop,
          proc: true,
          x: 0,
          z: 0,
          level: 1,
          burst: 1,
          burstT: 0,
          occ: 0,
        };
      }
      this.cricketSynth?.gain.gain.setTargetAtTime(crick ? 0.012 : 0, t, 1.0);
    } else if (this.cricketSynth) {
      this.dropLoop(this.cricketSynth);
      this.cricketSynth = null;
    }
    // Çocuklar
    const kids = childrenActivity(min, c.weekday, c.month, c.day) * (1 - night);
    for (const k of this.children) {
      if (doOcc) k.occ = core.occlusion(k.x, 1.2, k.z);
      k.voice!.shade(k.occ, dt);
      const d = Math.hypot(k.x - core.listener.x, k.z - core.listener.z);
      // KARAR: sahnede çocuk figürü yok → oyun alanına 25 m'den yakında kısılır (görsel boşlukla çelişmesin)
      const near = Math.min(1, Math.max(0.15, (d - 12) / 18));
      k.gain.gain.setTargetAtTime(splGain(64) * kids * near * k.level * k.voice!.occGain, t, 1.2);
    }
    if (this.construction) {
      const weekday = c.weekday >= 1 && c.weekday <= 5;
      const sat = c.weekday === 6 && min < 13 * 60;
      // KARAR: şantiye saatleri hafta içi 08–18, cumartesi 08–13 (Türkiye'de yaygın belediye kuralı)
      const on = (weekday || sat) && min > 8 * 60 && min < 18 * 60 ? 1 : 0;
      const v = this.construction.voice!;
      if (doOcc) this.construction.occ = core.occlusion(this.construction.x, 4, this.construction.z);
      v.shade(this.construction.occ, dt);
      this.construction.gain.gain.setTargetAtTime(splGain(64) * on * v.occGain, t, 2);
    }
    this.events(dt, scene, min, act, night);
  }

  /** Rüzgâr: oyundaki yaprak salınımıyla aynı zaman tabanı (windTime) üzerinden yavaş esintiler. */
  private gust(phase: number): number {
    const w = windTime.value;
    return 0.55 + 0.25 * Math.sin(w * 0.21 + phase) + 0.2 * Math.sin(w * 0.083 + phase * 1.7 + 1.3);
  }

  private updateWind(dt: number, t: number, doOcc: boolean): void {
    const core = this.core;
    const nTrees = this.treeNear.length / 2;
    const density = Math.min(1, nTrees / 25);
    const rustle: Build = (d) => noiseLoop(core.ctx, core.noise.pink, d, 'bandpass', 2600, 0.6).src;
    this.windBed = this.refreshBed(this.windBed, 'wind_trees', () => this.bed('wind_trees', rustle));
    if (this.windBed) {
      const lvl = this.windBed.proc ? 0.018 : splGain(46);
      this.windBed.gain.gain.setTargetAtTime(lvl * (0.25 + density) * this.gust(0), t, 0.5);
    }
    for (let i = 0; i < this.wind.length; i++) {
      const w = this.wind[i];
      if (doOcc) w.occ = core.occlusion(w.x, 5, w.z);
      w.voice!.shade(w.occ, dt);
      const lvl = w.proc ? 0.01 : splGain(54);
      w.gain.gain.setTargetAtTime(lvl * this.gust(i * 2.1 + 0.7) * w.voice!.occGain, t, 0.4);
    }
  }

  /** Konumlu kaynakları (serçe, rüzgâr, cırcır, çocuk, inşaat) dinleyici çevresine yerleştir. */
  private placeSources(
    scene: SoundScene | null,
    min: number,
    rise: number,
    set: number,
    weekday: number,
    month: number,
    day: number,
  ): void {
    const core = this.core;
    const l = core.listener;
    // Yakın ağaçlar (70 m)
    const near: number[] = [];
    if (scene) {
      const tr = scene.trees;
      for (let i = 0; i < tr.length; i += 2) {
        const dx = tr[i] - l.x;
        const dz = tr[i + 1] - l.z;
        if (dx * dx + dz * dz < 70 * 70) near.push(tr[i], tr[i + 1]);
      }
    }
    this.treeNear = near;
    const dist = (p: [number, number]) => Math.hypot(p[0] - l.x, p[1] - l.z);
    const pts: [number, number][] = [];
    for (let i = 0; i < near.length; i += 2) pts.push([near[i], near[i + 1]]);
    pts.sort((a, b) => dist(a) - dist(b));
    // Rüzgâr: en yakın 3 ağaç (30 m)
    const rustle: Build = (d) => noiseLoop(core.ctx, core.noise.pink, d, 'bandpass', 3000, 0.7).src;
    this.retarget(this.wind, pts.filter((p) => dist(p) < 30).slice(0, 3), 'wind_trees', 4, 0.2, 6, rustle);
    // Serçe: ağaç kümeleri (8 m içinde ≥3 ağaç), 6–40 m
    const clusters = pts
      .filter((p) => {
        const d = dist(p);
        if (d < 6 || d > 40) return false;
        let n = 0;
        for (const q of pts) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 8) n++;
        return n >= 3;
      })
      .slice(0, 2);
    this.retarget(
      this.sparrows,
      birdActivity(min, rise, set) > 0.02 ? clusters : [],
      'bird_sparrows',
      5,
      0.25,
      2.5,
    );
    // Cırcır: yeşil yerler (ağaç / park) 8–45 m
    if (core.bank.has('crickets') && (this.crickOn || this.crickets.length)) {
      const green: [number, number][] = pts.filter((p) => dist(p) > 8 && dist(p) < 45);
      for (const pl of scene?.places ?? [])
        if ((pl.kind === 'park' || pl.kind === 'green') && dist([pl.x, pl.z]) < 60) green.push([pl.x, pl.z]);
      const pick =
        green.length > 3 ? [green[0], green[Math.floor(green.length / 2)], green[green.length - 1]] : green;
      this.retarget(this.crickets, this.crickOn ? pick.slice(0, 3) : [], 'crickets', 3, 0.15, 0.3);
    }
    // Çocuklar: oyun alanları / avlular 200 m
    if (core.bank.has('children')) {
      const places = (scene?.places ?? [])
        .filter((p) => p.kind === 'playground' || p.kind === 'courtyard' || p.kind === 'pitch')
        .map((p) => ({ p, d: dist([p.x, p.z]) }))
        .filter((x) => x.d < 200)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      const act = childrenActivity(min, weekday, month, day);
      this.retarget(
        this.children,
        act > 0 ? places.map((x) => [x.p.x, x.p.z] as [number, number]) : [],
        'children',
        15,
        0.4,
        1.2,
      );
      this.children.forEach((k, i) => (k.level = places[i]?.p.kind === 'pitch' ? 0.8 : 1));
    }
    // İnşaat: en yakın OSM inşaat alanı (600 m)
    if (core.bank.has('construction') && scene) {
      let best: SoundPlace | null = null;
      let bd = 600;
      for (const p of scene.places)
        if (p.kind === 'construction') {
          const d = dist([p.x, p.z]);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
      if (best && !this.construction) this.construction = this.loop('construction', 20, false, 0.5);
      if (!best && this.construction) {
        this.dropLoop(this.construction);
        this.construction = null;
      }
      if (best && this.construction) {
        this.construction.x = best.x;
        this.construction.z = best.z;
        this.construction.voice!.place(best.x, 4, best.z);
      }
    }
  }

  /** Döngü listesini hedef noktalara eşle (fazlaları sustur, eksikleri aç; kayıt hazır değilse sonra). */
  private retarget(
    list: Loop[],
    targets: [number, number][],
    slot: string,
    ref: number,
    wet: number,
    y: number,
    fallback?: Build,
  ): void {
    // Kayıt geldiyse prosedürel olanları yenile
    for (let i = list.length - 1; i >= 0; i--)
      if (list[i].proc && this.core.bank.buffer(slot)) this.dropLoop(list.splice(i, 1)[0]);
    while (list.length > targets.length) this.dropLoop(list.pop()!);
    while (list.length < targets.length) {
      const lp = this.loop(slot, ref, list.length === 0, wet, fallback);
      if (!lp) break;
      list.push(lp);
    }
    list.forEach((lp, i) => {
      const [x, z] = targets[i];
      if (!(Math.hypot(lp.x - x, lp.z - z) < 0.5)) {
        lp.x = x;
        lp.z = z;
        lp.voice!.place(x, y, z);
      }
    });
  }

  /** Tek seferlik olaylar: kumru, karga, saksağan, martı, güvercin, köpek, ev sesleri. */
  private events(dt: number, scene: SoundScene | null, min: number, act: number, night: number): void {
    const core = this.core;
    const T = this.timers;
    for (const k of Object.keys(T)) T[k] -= dt;
    const l = core.listener;
    if (T.dove <= 0) {
      T.dove = 25 + core.rnd() * 60;
      // Kumru: 3–7 kez "ku-kuuu-ku", ~1.5 s arayla; çatı/anten ya da ağaç
      if (act > 0.05 && core.bank.has('bird_dove')) {
        const p = core.rnd() < 0.6 ? this.roofPoint(scene, 15, 90) : this.treePoint(10, 60, 7);
        if (p) this.series('bird_dove', p, 3 + Math.floor(core.rnd() * 5), 1.4, 0.3, 66, 5, true);
      }
    }
    if (T.crow <= 0) {
      T.crow = 50 + core.rnd() * 150;
      if (act > 0.05 && core.bank.has('bird_crow')) {
        const p = core.rnd() < 0.5 ? this.roofPoint(scene, 30, 150) : this.treePoint(25, 70, 9);
        if (p) this.series('bird_crow', p, 1 + Math.floor(core.rnd() * 4), 0.7, 0.4, 78, 5, false);
      }
    }
    if (T.magpie <= 0) {
      T.magpie = 80 + core.rnd() * 200;
      if (act > 0.05 && core.bank.has('bird_magpie')) {
        const p = this.treePoint(12, 60, 6);
        if (p) this.series('bird_magpie', p, 1 + Math.floor(core.rnd() * 2), 0.9, 0.4, 74, 5, true);
      }
    }
    if (T.gull <= 0) {
      T.gull = 150 + core.rnd() * 350;
      // Martı: Marmara'dan şehre gelen martılar; tepeden geçiş
      if (act > 0.05 && core.bank.has('bird_gull')) {
        const a = core.rnd() * Math.PI * 2;
        const d = 30 + core.rnd() * 60;
        const p: [number, number, number] = [
          l.x + Math.cos(a) * d,
          35 + core.rnd() * 25,
          l.z + Math.sin(a) * d,
        ];
        this.series('bird_gull', p, 2 + Math.floor(core.rnd() * 3), 1.1, 0.5, 80, 8, false);
      }
    }
    if (T.pigeon <= 0) {
      T.pigeon = 40 + core.rnd() * 120;
      if (act > 0.05 && core.bank.has('bird_pigeon')) {
        const p = this.roofPoint(scene, 8, 35);
        if (p) this.series('bird_pigeon', p, 1 + Math.floor(core.rnd() * 3), 1.2, 0.3, 58, 3, true);
      }
    }
    if (T.dog <= 0) {
      // KARAR: gece daha sık (sokak/site köpekleri); 80–350 m, mümkünse bina arkasında
      T.dog = night > 0.5 ? 45 + core.rnd() * 110 : 90 + core.rnd() * 220;
      if (core.bank.has('dog_bark')) {
        const p = this.farPoint(80, 350);
        if (p) {
          this.series('dog_bark', p, 1 + Math.floor(core.rnd() * 6), 0.55, 0.35, 88, 5, false);
          // Bazen başka yönden bir köpek cevap verir
          if (core.rnd() < 0.35) {
            const q = this.farPoint(120, 400);
            const n = 2 + Math.floor(core.rnd() * 4);
            if (q)
              setTimeout(
                () => this.series('dog_bark', q, n, 0.6, 0.35, 86, 5, false),
                2000 + core.rnd() * 4000,
              );
          }
        }
      }
    }
    if (T.house <= 0) {
      T.house = 60 + core.rnd() * 120;
      // Akşam ev sesleri (TV, bulaşık, balkon sohbeti): yalnız 18:30–23:00, çok hafif, pencere arkası
      if (min > 1110 && min < 1380 && core.bank.has('household')) {
        const p = this.roofPoint(scene, 8, 25, 0.35);
        if (p) this.series('household', p, 1, 1, 0, 50, 2, false, 2200);
      }
    }
  }

  /** Aynı noktadan ardışık çağrılar (ör. kumru serisi). */
  private series(
    slot: string,
    p: [number, number, number],
    n: number,
    gap: number,
    jitter: number,
    spl: number,
    ref: number,
    hrtf: boolean,
    lowpass = 0,
  ): void {
    const core = this.core;
    const v = core.voice('ambience', { hrtf: hrtf && core.hrtf, ref, rolloff: 1, wet: 0.45 });
    v.place(p[0], p[1], p[2]);
    v.shade(core.occlusion(p[0], p[1], p[2]), 1, lowpass || 20000);
    let t = core.ctx.currentTime + 0.05;
    const rate = 0.97 + core.rnd() * 0.06;
    let total = 0;
    for (let k = 0; k < n; k++) {
      const s = core.bank.pickSlice(slot, undefined, () => core.rnd());
      if (!s) break;
      playSlice(core, s, v.input, t, rate, splGain(spl) * v.occGain * db(core.rnd() * 3 - 1.5));
      const step = s.dur / rate + gap * (1 - jitter + core.rnd() * jitter * 2);
      t += step;
      total += step;
    }
    setTimeout(() => v.dispose(), (total + 3) * 1000);
  }

  /** Bina çatı kenarından nokta (kumru/karga antenlerde, çatı saçaklarında). */
  private roofPoint(
    scene: SoundScene | null,
    minD: number,
    maxD: number,
    hFrac = 1,
  ): [number, number, number] | null {
    const core = this.core;
    const l = core.listener;
    const bs = scene?.buildings;
    if (!bs || !bs.length) return null;
    for (let tries = 0; tries < 40; tries++) {
      const b = bs[Math.floor(core.rnd() * bs.length)];
      const p = b.ring[Math.floor(core.rnd() * b.ring.length)];
      const d = Math.hypot(p[0] - l.x, p[1] - l.z);
      if (d < minD || d > maxD) continue;
      const y = b.base + (b.top - b.base) * (hFrac < 1 ? hFrac + core.rnd() * 0.4 : 1) + 0.5;
      return [p[0], y, p[1]];
    }
    return null;
  }

  private treePoint(minD: number, maxD: number, h: number): [number, number, number] | null {
    const core = this.core;
    const l = core.listener;
    const t = this.treeNear;
    const n = t.length / 2;
    for (let tries = 0; tries < 20 && n > 0; tries++) {
      const i = Math.floor(core.rnd() * n) * 2;
      const d = Math.hypot(t[i] - l.x, t[i + 1] - l.z);
      if (d >= minD && d <= maxD) return [t[i], h * (0.7 + core.rnd() * 0.6), t[i + 1]];
    }
    return null;
  }

  /** Uzak nokta (tercihen bina arkası). */
  private farPoint(minD: number, maxD: number): [number, number, number] | null {
    const core = this.core;
    const l = core.listener;
    let best: [number, number, number] | null = null;
    for (let tries = 0; tries < 8; tries++) {
      const a = core.rnd() * Math.PI * 2;
      const d = minD + core.rnd() * (maxD - minD);
      const p: [number, number, number] = [l.x + Math.cos(a) * d, 1, l.z + Math.sin(a) * d];
      best = p;
      if (core.occlusion(p[0], p[1], p[2]) > 0) return p;
    }
    return best;
  }

  dispose(): void {
    for (const l of [...this.sparrows, ...this.crickets, ...this.children, ...this.wind]) this.dropLoop(l);
    for (const l of [this.bedDay, this.bedNight, this.windBed, this.cricketSynth, this.construction])
      this.dropLoop(l);
  }
}
