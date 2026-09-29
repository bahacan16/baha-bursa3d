import { db, type SoundCore, type Voice } from './core';
import { hash01 } from './geometry';
import { EZAN_TIMES, prayerTimes, type PrayerName, type PrayerTimes } from './prayer';
import { splGain } from './traffic';
import type { SoundPoint, SoundScene } from './types';

interface Caller {
  mosque: SoundPoint;
  voice: Voice;
  el: HTMLAudioElement | null;
  node: MediaElementAudioSourceNode | null;
  gain: GainNode;
  delay: number;
  started: boolean;
}

/**
 * Ezan: gerçek cami konumlarından (OSM), Bursa için Diyanet yöntemiyle hesaplanan vakitlerde (prayer.ts), oyun
 * saati eşleşince. Oyuncu ezanın ortasında gelirse kayıt o andan çalar (gerçekte olduğu gibi). En yakın 3 cami:
 * her biri birkaç saniye kaymayla (camiler arası doğal yankı), minare hoparlörü ~22 m yükseklikte.
 * Yalnız lisanslı kayıtla (CC0/CC-BY, public/sounds/ATTRIBUTION.md); kayıt yoksa sessiz — asla sentezlenmez.
 */
export class Ezan {
  private callers: Caller[] = [];
  private active: { name: PrayerName; start: number } | null = null;
  private cache = { key: '', times: null as PrayerTimes | null };
  private forced: number | null = null;
  enabled = true;
  /** Hata ayıklama: sonraki vakit, dakika (HUD/hata ayıklama) */
  next: { name: PrayerName; at: number } | null = null;
  /** Hata ayıklama: durum */
  status = 'başlatılıyor';

  constructor(private readonly core: SoundCore) {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('ezan') : null;
    // ?ezan=now → hemen bir ezan (deneme)
    if (q === 'now') this.forced = Date.now();
  }

  times(): PrayerTimes {
    const c = this.core.clock;
    const key = `${c.year}-${c.month}-${c.day}`;
    if (this.cache.key !== key || !this.cache.times) {
      const g = this.core.geoCenter;
      this.cache = { key, times: prayerTimes(c.year, c.month, c.day, g.lat, g.lon, 3, true) };
    }
    return this.cache.times!;
  }

  /** Aktif ezanın başlangıcından geçen saniye; yoksa null. */
  private current(dur: number): { name: PrayerName; elapsed: number } | null {
    const c = this.core.clock;
    if (this.forced !== null) {
      const e = (Date.now() - this.forced) / 1000;
      if (e < dur) return { name: 'ogle', elapsed: e };
      this.forced = null;
    }
    const t = this.times();
    let next: { name: PrayerName; at: number } | null = null;
    for (const n of EZAN_TIMES) {
      const e = (c.minutes - t[n]) * 60;
      if (e >= 0 && e < dur) return { name: n, elapsed: e };
      if (t[n] > c.minutes && (!next || t[n] < next.at)) next = { name: n, at: t[n] };
    }
    this.next = next;
    return null;
  }

  update(scene: SoundScene | null): void {
    const core = this.core;
    const slot = core.bank.has('ezan_near') ? 'ezan_near' : core.bank.has('ezan_far') ? 'ezan_far' : null;
    const info = slot ? core.bank.fileInfo(slot) : null;
    const mosques = scene?.mosques ?? [];
    this.status = !this.enabled
      ? 'kapalı'
      : !slot || !info
        ? 'kayıt yok'
        : !mosques.length
          ? 'cami yok'
          : 'bekliyor';
    if (this.status !== 'bekliyor') {
      this.stop();
      return;
    }
    // Uzak camiler birkaç saniye geç başlar: pencere kaydın süresi + en çok 10 s
    const cur = this.current(info!.dur + 10);
    if (!cur) {
      this.stop();
      return;
    }
    this.status = 'çalıyor';
    if (!this.active || this.active.name !== cur.name) {
      this.stop();
      this.active = { name: cur.name, start: core.clock.ms - cur.elapsed * 1000 };
      this.startCallers(mosques, cur.elapsed);
    }
    // Konum/örtme (camiler sabit; dinleyici hareket eder)
    for (const c of this.callers) {
      c.voice.shade(core.occlusion(c.mosque.x, 22, c.mosque.z), 0.25);
      const d = c.voice.distance;
      // KARAR: minare hoparlörü ≈ 64 dB @ 250 m (kayıt 30 m referansında ≈ 82 dB); yakın camide sınırlayıcı
      const g = splGain(82) * c.voice.occGain * (c.delay > 0 ? db(-2) : 1) * Math.min(1, 0.6 + d / 400);
      c.gain.gain.setTargetAtTime(g, core.ctx.currentTime, 0.5);
    }
  }

  private startCallers(mosques: readonly SoundPoint[], elapsed: number): void {
    const core = this.core;
    const l = core.listener;
    const near = [...mosques]
      .map((m) => ({ m, d: Math.hypot(m.x - l.x, m.z - l.z) }))
      .filter((x) => x.d < 2500)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    near.forEach(({ m }, i) => {
      // En yakın cami "yakın" kaydı, diğerleri (varsa) ikinci kayıt; camiye özgü sabit gecikme 0–9 s
      const slot =
        i === 0 || !core.bank.has('ezan_far')
          ? core.bank.has('ezan_near')
            ? 'ezan_near'
            : 'ezan_far'
          : 'ezan_far';
      const delay = i === 0 ? 0 : 2 + hash01(m.id) * 7;
      const voice = core.voice('ezan', { hrtf: false, ref: 30, rolloff: 1, wet: 0.7 });
      voice.place(m.x, 22, m.z);
      const gain = core.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(voice.input);
      const el = core.bank.media(slot, 0);
      let node: MediaElementAudioSourceNode | null = null;
      if (el) {
        try {
          node = core.ctx.createMediaElementSource(el);
          node.connect(gain);
          const t0 = Math.max(0, elapsed - delay);
          const begin = () => {
            try {
              el.currentTime = t0;
            } catch {
              /* meta veri gelmeden */
            }
            void el.play().catch((e) => console.warn('Ezan çalınamadı', e));
          };
          if (elapsed < delay) setTimeout(begin, (delay - elapsed) * 1000);
          else if (el.readyState >= 1) begin();
          else el.addEventListener('loadedmetadata', begin, { once: true });
        } catch (e) {
          console.warn('Ezan kaynağı kurulamadı', e);
        }
      }
      this.callers.push({ mosque: m, voice, el, node, gain, delay, started: true });
    });
  }

  stop(): void {
    if (!this.callers.length) {
      this.active = null;
      return;
    }
    const t = this.core.ctx.currentTime;
    for (const c of this.callers) {
      c.gain.gain.setTargetAtTime(0, t, 0.6);
      const cc = c;
      setTimeout(() => {
        cc.el?.pause();
        if (cc.el) cc.el.src = '';
        cc.node?.disconnect();
        cc.voice.dispose();
      }, 3000);
    }
    this.callers = [];
    this.active = null;
  }

  /** Ezan sürüyor mu (ör. HUD). */
  get playing(): boolean {
    return this.callers.length > 0;
  }
}
