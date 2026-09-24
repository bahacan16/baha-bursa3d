import type { Building } from './parse';

/**
 * Hava fotoğrafı (scripts/fetch-aerial.mjs): yerel ENU ızgarasına oturtulmuş kare görüntü, ±1300 m.
 * Satır 0 = kuzey (z = −half), sütun 0 = batı (x = −half).
 */
export const AERIAL_HALF = 1300;

export async function loadAerial(base: string, size: 2048 | 4096): Promise<HTMLImageElement | null> {
  const url = `${base}data/aerial-${size}.jpg`;
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Rgb (doğrusal) — Worker'a yapılandırılmış klon ile gider. */
/** [r, g, b, eğikÇatı(0/1)] — doğrusal renk + fotoğrafta kiremit rengi görüldüyse 1 */
export type RoofColorMap = Record<string, [number, number, number, number]>;

/**
 * Her binanın çatı rengini fotoğraftan örnekler (ağırlık merkezi + köşelere doğru yarım yol noktaları).
 * KARAR: Fotoğraf çatıya doğrudan yapıştırılmaz — yüksek binalarda eğiklik (relief displacement) birkaç metre;
 * yalnızca renk alınır, çatı dokusu gerçek beton/kiremit dokusundan gelir.
 */
export function sampleRoofColors(
  img: HTMLImageElement,
  buildings: Building[],
  half = AERIAL_HALF,
): RoofColorMap {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const k = S / (half * 2);
  const at = (x: number, z: number): [number, number, number] | null => {
    const i = Math.floor((x + half) * k);
    const j = Math.floor((z + half) * k);
    if (i < 0 || j < 0 || i >= S || j >= S) return null;
    const o = (j * S + i) * 4;
    return [px[o], px[o + 1], px[o + 2]];
  };
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  const out: RoofColorMap = {};
  for (const b of buildings) {
    let cx = 0;
    let cz = 0;
    for (const p of b.outer) {
      cx += p[0];
      cz += p[1];
    }
    cx /= b.outer.length;
    cz /= b.outer.length;
    const pts: [number, number][] = [
      [cx, cz],
      ...b.outer.map((p) => [(p[0] + cx) / 2, (p[1] + cz) / 2] as [number, number]),
    ];
    let r = 0;
    let g = 0;
    let bl = 0;
    let n = 0;
    for (const [x, z] of pts) {
      const s = at(x, z);
      if (!s) continue;
      r += s[0];
      g += s[1];
      bl += s[2];
      n++;
    }
    if (!n) continue;
    // Fotoğraflar gölgeli/koyu: hafif aydınlat, aşırı doymuşluğu azalt
    // Kiremit tespiti (sRGB ortalaması): turuncu-kırmızı ton → kırma çatı
    // KARAR: OSM'de çatı şekli yok; bölgedeki sitelerin çoğu kırmızı kiremitli kırma çatılı.
    const sr = r / n;
    const sg = g / n;
    const sb = bl / n;
    const pitched =
      sr > 60 && sr > sg * 1.1 && sr > sb * 1.25 && Math.abs(signedAreaApprox(b.outer)) < 3000 ? 1 : 0;
    const R = lin(r / n);
    const G = lin(g / n);
    const B = lin(bl / n);
    const L = (R + G + B) / 3;
    const sat = 0.8;
    const lift = 1.35;
    let c: [number, number, number] = [
      Math.min(1, (L + (R - L) * sat) * lift),
      Math.min(1, (L + (G - L) * sat) * lift),
      Math.min(1, (L + (B - L) * sat) * lift),
    ];
    // Kiremit: örnek duvar/gölgeyle karışır → gerçek kiremit tonuna doğru çek
    if (pitched) c = [c[0] * 0.45 + 0.5 * 0.55, c[1] * 0.45 + 0.2 * 0.55, c[2] * 0.45 + 0.13 * 0.55];
    out[b.id] = [c[0], c[1], c[2], pitched];
  }
  return out;
}

function signedAreaApprox(r: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
