import type { BuildingIndex } from './geometry';

/**
 * Kentsel akustik: dinleyici çevresindeki binalardan açıklık tahmini ve prosedürel darbe tepkisi (IR).
 * - canyon: 6–7 katlı bloklar arasında sokak (karşılıklı paralel cepheler → çırpıntı yankısı, ~1–1.6 s kuyruk)
 * - courtyard: site avlusu (çoğu yönde bina, yoğun erken yansımalar, ~1 s)
 * - open: park / açık alan (yalnız zemin yansıması, kısa kuyruk)
 */
export type AcousticKind = 'open' | 'canyon' | 'courtyard';

export interface Acoustics {
  kind: AcousticKind;
  /** 0 = tamamen açık, 1 = her yön yakın ve yüksek binalarla kapalı */
  enclosure: number;
  /** Karşılıklı cepheler arası mesafe (m) — sokak genişliği */
  width: number;
  /** Ortalama cephe mesafesi (m) */
  meanDist: number;
  /** Ortalama bina yüksekliği (m, isabet eden ışınlar) */
  height: number;
  /** Yankı süresi (s) */
  rt60: number;
}

const RAYS = 24;
const RANGE = 70;

/** Işınlarla çevre sınıflaması (x, z: dinleyici; y: kulak kotu). */
export function analyzeAcoustics(idx: BuildingIndex | null, x: number, y: number, z: number): Acoustics {
  const open: Acoustics = { kind: 'open', enclosure: 0, width: 60, meanDist: 60, height: 0, rt60: 0.35 };
  if (!idx || idx.count === 0) return open;
  const d = new Float32Array(RAYS).fill(Infinity);
  const h = new Float32Array(RAYS);
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2;
    const hit = idx.firstHit(x, z, Math.cos(a), Math.sin(a), RANGE);
    if (hit) {
      d[i] = Math.max(1, hit.d);
      h[i] = Math.max(0, hit.top - y);
    }
  }
  // Kapalılık: her ışında binanın dikey açısı (yükseklik / mesafe) — gökyüzü görüş payının tersi
  let enc = 0;
  let nHit = 0;
  let sumD = 0;
  let sumH = 0;
  for (let i = 0; i < RAYS; i++) {
    if (!Number.isFinite(d[i])) continue;
    const elev = Math.atan2(h[i], d[i]) / (Math.PI / 2);
    enc += Math.min(1, elev * 1.8);
    nHit++;
    sumD += d[i];
    sumH += h[i];
  }
  enc /= RAYS;
  if (nHit === 0) return open;
  // Sokak genişliği: karşılıklı iki ışının en kısa toplamı; doğrultusu boyunca açık mı?
  let bestW = Infinity;
  let bestI = 0;
  const half = RAYS / 2;
  for (let i = 0; i < half; i++) {
    const w = d[i] + d[i + half];
    if (w < bestW) {
      bestW = w;
      bestI = i;
    }
  }
  const perp = (bestI + RAYS / 4) % RAYS;
  const along = Math.min(d[perp], d[(perp + half) % RAYS]);
  const hitFrac = nHit / RAYS;
  let kind: AcousticKind = 'open';
  if (Number.isFinite(bestW) && bestW < 45 && enc > 0.12) kind = along > bestW * 1.3 ? 'canyon' : 'courtyard';
  else if (hitFrac > 0.7 && enc > 0.15) kind = 'courtyard';
  const meanDist = sumD / nHit;
  const height = sumH / nHit;
  // KARAR: dış mekânda yankı süreleri kısa; kanyonda ~0.8–1.7 s, avluda ~0.7–1.3 s (literatürdeki sokak kanyonu
  // ölçümleri: yüksek cepheli dar sokaklarda RT ≈ 1–2 s, açık alanda < 0.5 s).
  const rt60 =
    kind === 'canyon'
      ? 0.8 + 0.9 * Math.min(1, enc * 1.6)
      : kind === 'courtyard'
        ? 0.7 + 0.6 * Math.min(1, enc * 1.6)
        : 0.3 + 0.4 * enc;
  return {
    kind,
    enclosure: Math.min(1, enc * 1.4),
    width: Number.isFinite(bestW) ? bestW : 60,
    meanDist,
    height,
    rt60,
  };
}

export interface IrParams {
  kind: AcousticKind;
  width: number;
  meanDist: number;
  height: number;
  rt60: number;
}

/**
 * Prosedürel stereo IR: erken yansımalar (cephe mesafelerinden) + çırpıntı dizisi (kanyonda karşılıklı cepheler)
 * + zamanla kararan (tizleri söndürülen) gürültü kuyruğu. Tohumlu; aynı parametreler aynı IR'ı verir.
 */
export function makeImpulse(sampleRate: number, p: IrParams, seed = 1): [Float32Array, Float32Array] {
  const len = Math.max(0.4, Math.min(2.6, p.rt60 * 1.35));
  const n = Math.floor(len * sampleRate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
  const c = 343;
  const put = (buf: Float32Array, t: number, a: number) => {
    const i = Math.floor(t * sampleRate);
    if (i >= 0 && i < n - 1) {
      buf[i] += a;
      buf[i + 1] += a * 0.35; // hafif yayılma
    }
  };
  // Zemin yansıması (kulak 1.7 m): ~3 ms
  put(L, 0.0035, 0.35);
  put(R, 0.0037, 0.35);
  if (p.kind !== 'open') {
    const w = Math.max(6, p.width);
    const dL = w * 0.45;
    const dR = w * 0.55;
    const refl = p.kind === 'canyon' ? 0.72 : 0.6;
    // Çırpıntı: sol ve sağ cepheler arasında gidip gelen yansıma dizisi
    let aL = 0.55;
    let aR = 0.5;
    for (let k = 0; k < 14; k++) {
      const tL = (2 * dL + k * 2 * w) / c;
      const tR = (2 * dR + k * 2 * w) / c;
      if (tL > len) break;
      put(L, tL, aL * (rnd() * 0.15 + 0.85));
      put(R, tR, aR * (rnd() * 0.15 + 0.85));
      put(R, tL + 0.0012, aL * 0.35);
      put(L, tR + 0.0012, aR * 0.35);
      aL *= refl;
      aR *= refl;
    }
    if (p.kind === 'courtyard') {
      // Diğer yönlerden (ön/arka cepheler) dağınık erken yansımalar
      for (let k = 0; k < 18; k++) {
        const t = (2 * (p.meanDist * (0.6 + 0.8 * Math.abs(rnd())))) / c;
        put(k % 2 ? L : R, t, 0.25 * (0.6 + 0.4 * Math.abs(rnd())));
      }
    }
  }
  // Dağınık kuyruk: üstel sönüm, zamanla alçalan kesim frekansı (hava + saçılma)
  const pre = p.kind === 'open' ? 0.008 : Math.max(0.01, (2 * Math.max(4, p.meanDist)) / c);
  const decay = 6.91 / Math.max(0.2, p.rt60); // −60 dB / rt60
  const tailGain = p.kind === 'open' ? 0.12 : p.kind === 'canyon' ? 0.3 : 0.34;
  let lpL = 0;
  let lpR = 0;
  const i0 = Math.floor(pre * sampleRate);
  for (let i = i0; i < n; i++) {
    const t = i / sampleRate - pre;
    const env = Math.exp(-decay * t) * Math.min(1, t / 0.02);
    // 1 kutuplu alçak geçiren: başta ~9 kHz, sonra ~1.8 kHz
    const fc = 1800 + 7200 * Math.exp(-t * 3);
    const k = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
    lpL += k * (rnd() - lpL);
    lpR += k * (rnd() - lpR);
    L[i] += lpL * env * tailGain;
    R[i] += lpR * env * tailGain;
  }
  // Uç tıkırtısı olmasın
  const fade = Math.min(n, Math.floor(0.05 * sampleRate));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    L[n - 1 - i] *= g;
    R[n - 1 - i] *= g;
  }
  return [L, R];
}

/** İki akustik durum yeterince farklı mı (IR yeniden üretilsin mi)? */
export function acousticsChanged(a: IrParams, b: IrParams): boolean {
  if (a.kind !== b.kind) return true;
  if (Math.abs(a.rt60 - b.rt60) > 0.18) return true;
  if (Math.abs(a.width - b.width) / Math.max(8, a.width) > 0.3) return true;
  return false;
}
