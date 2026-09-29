/**
 * Namaz vakitleri — Diyanet İşleri Başkanlığı yöntemi (Türkiye).
 *
 * KARAR (yöntem, vakithesaplama.diyanet.gov.tr "Temkin" sayfası ve Diyanet takvimiyle karşılaştırma):
 * - İmsak (sabah ezanı): güneş ufkun 18° altında, temkin yok.
 * - Güneş: görünür doğuş (−0.833°: kırılma + yarıçap) − 7 dk temkin.
 * - Öğle: güneşin meridyenden geçişi + 5 dk.
 * - İkindi: asr-ı evvel (gölge = cisim boyu + öğle gölgesi, Şafii/standart) + 4 dk.
 * - Akşam: görünür batış + 7 dk.
 * - Yatsı: güneş ufkun 17° altında, temkin yok.
 * Bursa için Diyanet'in yayımladığı vakitlerle ±1 dk içinde (tests/unit/prayer.test.ts).
 *
 * Güneş konumu: PrayTimes.org / USNO düşük doğruluklu formülleri (1800–2200 arası ~1 dk).
 */

export type PrayerName = 'imsak' | 'gunes' | 'ogle' | 'ikindi' | 'aksam' | 'yatsi';

/** Yerel saat, gece yarısından itibaren dakika (kesirli). */
export type PrayerTimes = Record<PrayerName, number>;

/** Ezan okunan vakitler (güneş doğuşu ezan değildir). */
export const EZAN_TIMES: readonly PrayerName[] = ['imsak', 'ogle', 'ikindi', 'aksam', 'yatsi'];

/** Türkçe adlar (arayüz/hata ayıklama). */
export const PRAYER_LABEL: Record<PrayerName, string> = {
  imsak: 'Sabah',
  gunes: 'Güneş',
  ogle: 'Öğle',
  ikindi: 'İkindi',
  aksam: 'Akşam',
  yatsi: 'Yatsı',
};

/** Diyanet temkinleri (dakika). */
export const DIYANET_TEMKIN: Record<PrayerName, number> = {
  imsak: 0,
  gunes: -7,
  ogle: 5,
  ikindi: 4,
  aksam: 7,
  yatsi: 0,
};

const DEG = Math.PI / 180;
const sin = (d: number) => Math.sin(d * DEG);
const cos = (d: number) => Math.cos(d * DEG);
const tan = (d: number) => Math.tan(d * DEG);
const asin = (x: number) => Math.asin(x) / DEG;
const acos = (x: number) => Math.acos(Math.max(-1, Math.min(1, x))) / DEG;
const atan2 = (y: number, x: number) => Math.atan2(y, x) / DEG;
const acot = (x: number) => Math.atan(1 / x) / DEG;
const fix = (a: number, b: number) => {
  const r = a - b * Math.floor(a / b);
  return r < 0 ? r + b : r;
};

/** Gregoryen tarih → Jülyen günü (öğlen değil, gün başı 0h UT). */
export function julianDay(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
}

/** Güneş sapması (derece) ve zaman denklemi (saat). */
export function sunPosition(jd: number): { decl: number; eqt: number } {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360);
  const q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * sin(g) + 0.02 * sin(2 * g), 360);
  const e = 23.439 - 0.00000036 * D;
  const RA = atan2(cos(e) * sin(L), cos(L)) / 15;
  const eqt = q / 15 - fix(RA, 24);
  const decl = asin(sin(e) * sin(L));
  return { decl, eqt: fix(eqt + 12, 24) - 12 };
}

/**
 * Bir günün namaz vakitleri (yerel saat, dakika). `tz` saat dilimi (Türkiye 2016'dan beri sürekli UTC+3).
 * @param temkin false → ham astronomik vakitler (test/karşılaştırma)
 */
export function prayerTimes(
  year: number,
  month: number,
  day: number,
  lat: number,
  lon: number,
  tz = 3,
  temkin = true,
): PrayerTimes {
  const jDate = julianDay(year, month, day) - lon / (15 * 24);
  const midDay = (t: number) => fix(12 - sunPosition(jDate + t / 24).eqt, 24);
  /** Güneşin ufkun `angle` derece altında olduğu an (ccw: öğleden önce). */
  const sunAngleTime = (angle: number, t: number, ccw: boolean) => {
    const decl = sunPosition(jDate + t / 24).decl;
    const noon = midDay(t);
    const h = acos((-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat))) / 15;
    return noon + (ccw ? -h : h);
  };
  const asrTime = (factor: number, t: number) => {
    const decl = sunPosition(jDate + t / 24).decl;
    const angle = -acot(factor + tan(Math.abs(lat - decl)));
    return sunAngleTime(angle, t, false);
  };
  // İlk tahminler (saat), iki yineleme yeterli (vakit başına < 1 sn değişim)
  let t = { imsak: 5, gunes: 6, ogle: 12, ikindi: 13, aksam: 18, yatsi: 18 };
  for (let it = 0; it < 2; it++) {
    t = {
      imsak: sunAngleTime(18, t.imsak, true),
      gunes: sunAngleTime(0.833, t.gunes, true),
      ogle: midDay(t.ogle),
      ikindi: asrTime(1, t.ikindi),
      aksam: sunAngleTime(0.833, t.aksam, false),
      yatsi: sunAngleTime(17, t.yatsi, false),
    };
  }
  const adj = tz - lon / 15;
  const out = {} as PrayerTimes;
  for (const k of Object.keys(t) as PrayerName[]) {
    out[k] = (t[k] + adj) * 60 + (temkin ? DIYANET_TEMKIN[k] : 0);
  }
  return out;
}

/** Dakika → "SS:DD" (en yakın dakikaya). */
export function formatMinutes(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
