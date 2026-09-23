/**
 * Yerel teğet düzlem (ENU) dönüşümleri.
 * three.js: Y yukarı, +X doğu, −Z kuzey. Birimler metre.
 */
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
  return {
    x: (p.lon - c.lon) * Math.cos(c.lat * DEG) * EARTH_RADIUS * DEG,
    z: -(p.lat - c.lat) * EARTH_RADIUS * DEG,
  };
}

export function toLatLon(p: LocalXZ, c: LatLon): LatLon {
  return {
    lat: c.lat - p.z / (EARTH_RADIUS * DEG),
    lon: c.lon + p.x / (Math.cos(c.lat * DEG) * EARTH_RADIUS * DEG),
  };
}

/** Büyük daire mesafesi (metre). */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}
