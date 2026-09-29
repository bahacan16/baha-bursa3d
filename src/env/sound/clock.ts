import type { TimeOfDay } from '../../core/settings';
import { prayerTimes } from './prayer';

/** Türkiye 2016'dan beri sürekli UTC+3 (yaz saati yok). */
export const TR_UTC_OFFSET_H = 3;

export interface ClockTime {
  /** Yerel gün başından dakika (0..1440). */
  minutes: number;
  year: number;
  month: number;
  day: number;
  /** 0 = Pazar … 6 = Cumartesi */
  weekday: number;
  /** Mutlak zaman (ms, UTC) — olay zamanlaması için tekdüze */
  ms: number;
}

/** Mutlak zaman (ms) → Türkiye yerel saati. */
export function localTime(ms: number): ClockTime {
  const d = new Date(ms + TR_UTC_OFFSET_H * 3600e3);
  return {
    minutes:
      d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    ms,
  };
}

/** Yerel tarih + dakika → mutlak ms. */
export function localToMs(year: number, month: number, day: number, minutes: number): number {
  return Date.UTC(year, month - 1, day) + minutes * 60000 - TR_UTC_OFFSET_H * 3600e3;
}

/**
 * Oyun saati (ses için). 'real' → gerçek saat. Hazır ayarlarda gökyüzü sabit kalır; ses saati seçildiği andaki
 * temsilî saatten gerçek zamanla ilerler (öğle ezanı gibi olaylar zamanı gelince duyulur).
 * KARAR: gündüz = 10:30 (Street View çekim saati, daylight.ts), gün batımı = bugünkü batıştan 12 dk önce
 * (güneş ≈ 2°; akşam ezanı ~19 dk sonra), gece = 22:30.
 */
export class GameClock {
  private mode: TimeOfDay | null = null;
  private anchorReal = 0;
  private anchorGame = 0;
  /** Hata ayıklama: saati ileri/geri kaydır (dk). */
  offsetMin = 0;

  constructor(private readonly geo: { lat: number; lon: number }) {}

  now(mode: TimeOfDay, realMs = Date.now()): ClockTime {
    if (mode === 'real') {
      this.mode = mode;
      return localTime(realMs + this.offsetMin * 60000);
    }
    if (mode !== this.mode) {
      this.mode = mode;
      this.anchorReal = realMs;
      const today = localTime(realMs);
      let min = 630;
      if (mode === 'sunset') {
        const p = prayerTimes(
          today.year,
          today.month,
          today.day,
          this.geo.lat,
          this.geo.lon,
          TR_UTC_OFFSET_H,
          false,
        );
        min = p.aksam - 12;
      } else if (mode === 'night') min = 22 * 60 + 30;
      this.anchorGame = localToMs(today.year, today.month, today.day, min);
    }
    return localTime(this.anchorGame + (realMs - this.anchorReal) + this.offsetMin * 60000);
  }
}

/** Günün saati etkinlik eğrisi yardımcıları (dakika). */
export function smoothWindow(min: number, start: number, end: number, ramp = 30): number {
  const a = Math.min(1, Math.max(0, (min - start + ramp) / ramp));
  const b = Math.min(1, Math.max(0, (end - min + ramp) / ramp));
  return Math.min(a, b);
}
