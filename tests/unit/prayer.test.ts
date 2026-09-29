import { describe, expect, it } from 'vitest';
import { formatMinutes, prayerTimes, type PrayerName } from '../../src/env/sound/prayer';
import { GameClock, localTime, localToMs } from '../../src/env/sound/clock';

/**
 * Referans vakitler (Diyanet İşleri Başkanlığı, "Bursa" il merkezi):
 * - 15 Temmuz 2026: namazvakitleri.diyanet.gov.tr/en-US/9335/bursa-prayer-times ("Today's prayer times for Bursa -
 *   15 July 2026"): İmsak 03:49, Güneş 05:40, Öğle 13:15, İkindi 17:11, Akşam 20:40, Yatsı 22:22.
 * - 19 Şubat 2026 (Ramazan 1. gün, Diyanet imsakiyesi — NTV / CNN Türk / Yeni Şafak): İmsak 06:21, Akşam 18:50.
 * - 1 Mart 2026 iftar 19:02 (Bursa Hakimiyet), 19 Mart 2026 iftar 19:21 (Diyanet imsakiyesi, son gün).
 * Diyanet saatleri dakikaya yuvarlar (bazen yukarı): tolerans ±1 dk.
 */
const BURSA = { lat: 40.1826, lon: 29.0665 };
const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

describe('namaz vakitleri (Diyanet yöntemi, Bursa)', () => {
  it('15 Temmuz 2026 — altı vakit', () => {
    const t = prayerTimes(2026, 7, 15, BURSA.lat, BURSA.lon);
    const ref: Record<PrayerName, string> = {
      imsak: '03:49',
      gunes: '05:40',
      ogle: '13:15',
      ikindi: '17:11',
      aksam: '20:40',
      yatsi: '22:22',
    };
    for (const k of Object.keys(ref) as PrayerName[])
      expect(Math.abs(t[k] - hm(ref[k])), k).toBeLessThanOrEqual(1);
  });

  it('Ramazan 2026 imsak ve iftar', () => {
    const a = prayerTimes(2026, 2, 19, BURSA.lat, BURSA.lon);
    expect(Math.abs(a.imsak - hm('06:21'))).toBeLessThanOrEqual(1);
    expect(Math.abs(a.aksam - hm('18:50'))).toBeLessThanOrEqual(1);
    expect(Math.abs(prayerTimes(2026, 3, 1, BURSA.lat, BURSA.lon).aksam - hm('19:02'))).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(prayerTimes(2026, 3, 19, BURSA.lat, BURSA.lon).aksam - hm('19:21'))).toBeLessThanOrEqual(
      1,
    );
  });

  it('vakitler sıralı ve temkinler uygulanıyor', () => {
    for (const [m, d] of [
      [1, 10],
      [4, 1],
      [6, 21],
      [9, 29],
      [12, 21],
    ]) {
      const t = prayerTimes(2026, m, d, 40.218, 28.907);
      expect(t.imsak).toBeLessThan(t.gunes);
      expect(t.gunes).toBeLessThan(t.ogle);
      expect(t.ogle).toBeLessThan(t.ikindi);
      expect(t.ikindi).toBeLessThan(t.aksam);
      expect(t.aksam).toBeLessThan(t.yatsi);
      const raw = prayerTimes(2026, m, d, 40.218, 28.907, 3, false);
      expect(t.ogle - raw.ogle).toBeCloseTo(5, 5);
      expect(t.aksam - raw.aksam).toBeCloseTo(7, 5);
      expect(t.gunes - raw.gunes).toBeCloseTo(-7, 5);
    }
  });

  it('Nilüfer (oyun merkezi) Bursa merkezinden ~0.6 dk sonra', () => {
    const b = prayerTimes(2026, 9, 29, BURSA.lat, BURSA.lon);
    const n = prayerTimes(2026, 9, 29, 40.2180548, 28.9073262);
    expect(n.ogle - b.ogle).toBeGreaterThan(0.4);
    expect(n.ogle - b.ogle).toBeLessThan(0.9);
    expect(formatMinutes(783.6)).toBe('13:04');
  });
});

describe('oyun saati', () => {
  it('Türkiye UTC+3', () => {
    const ms = Date.UTC(2026, 8, 29, 9, 30);
    const t = localTime(ms);
    expect(t.minutes).toBeCloseTo(12 * 60 + 30, 5);
    expect([t.year, t.month, t.day]).toEqual([2026, 9, 29]);
    expect(localToMs(2026, 9, 29, 12 * 60 + 30)).toBe(ms);
  });

  it('hazır ayarlar temsilî saatten gerçek zamanla ilerler', () => {
    const c = new GameClock({ lat: 40.218, lon: 28.907 });
    const t0 = Date.UTC(2026, 8, 29, 6, 0);
    expect(c.now('day', t0).minutes).toBeCloseTo(630, 5);
    expect(c.now('day', t0 + 60_000).minutes).toBeCloseTo(631, 5);
    // Gün batımı: astronomik batıştan 12 dk önce
    const raw = prayerTimes(2026, 9, 29, 40.218, 28.907, 3, false);
    expect(c.now('sunset', t0 + 120_000).minutes).toBeCloseTo(raw.aksam - 12, 3);
    expect(c.now('night', t0).minutes).toBeCloseTo(22 * 60 + 30, 5);
    expect(c.now('real', t0).minutes).toBeCloseTo(9 * 60, 5);
  });
});
