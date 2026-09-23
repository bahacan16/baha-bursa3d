/**
 * Yerel teğet düzlem (ENU) dönüşümleri.
 * three.js: Y yukarı, +X doğu, −Z kuzey. Birimler metre.
 * Projeksiyon WGS84 yerel yarıçaplarını kullanır (bkz. simplify.ts `localRadii`).
 */
import { localRadii, project, unproject } from '../worlds/osm/simplify';

export const EARTH_RADIUS = 6378137;
const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface LocalXZ {
  x: number;
  z: number;
}

/** Varsayılan merkez: 502. Sokak, 29 Ekim Mah., Nilüfer (meta.json yoksa). */
export const DEFAULT_CENTER: LatLon = { lat: 40.218262, lon: 28.909611 };

export function toLocal(p: LatLon, c: LatLon): LocalXZ {
  const [x, z] = project(p.lat, p.lon, c);
  return { x, z };
}

export function toLatLon(p: LocalXZ, c: LatLon): LatLon {
  return unproject(p.x, p.z, c);
}

/**
 * Büyük daire mesafesi (metre). Yarıçap olarak orta enlemin Gauss ortalama yarıçapı √(M·N) kullanılır.
 */
export function haversine(a: LatLon, b: LatLon): number {
  const { M, N } = localRadii((a.lat + b.lat) / 2);
  const R = Math.sqrt(M * N);
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Vincenty ters çözüm — WGS84 elipsoidi üzerinde hassas mesafe (test/doğrulama için). */
export function vincenty(p1: LatLon, p2: LatLon): number {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const L = (p2.lon - p1.lon) * DEG;
  const U1 = Math.atan((1 - f) * Math.tan(p1.lat * DEG));
  const U2 = Math.atan((1 - f) * Math.tan(p2.lat * DEG));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cos2Alpha = 0;
  let cos2SigmaM = 0;
  for (let i = 0; i < 200; i++) {
    const sinL = Math.sin(lambda);
    const cosL = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinL, cosU1 * sinU2 - sinU1 * cosU2 * cosL);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - prev) < 1e-12) break;
  }
  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  return b * A * (sigma - dSigma);
}
