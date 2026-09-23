import * as THREE from 'three';
import type { TimeOfDay } from '../core/settings';

const DEG = Math.PI / 180;

/** Güneş konumu (yaklaşık, NOAA sadeleştirmesi, ±0.5°). Azimut kuzeyden saat yönünde. */
export function sunPosition(
  date: Date,
  latDeg: number,
  lonDeg: number,
): { elevation: number; azimuth: number } {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const lst = (gmst * 15 + lonDeg) * DEG;
  const H = lst - ra;
  const lat = latDeg * DEG;
  const elev = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  let az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  if (az < 0) az += Math.PI * 2;
  return { elevation: elev / DEG, azimuth: az / DEG };
}

export interface Daylight {
  elevation: number;
  azimuth: number;
  sunDir: THREE.Vector3;
  /** Işık yönü (gece: ay). */
  lightDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fogColor: THREE.Color;
  exposure: number;
  /** 0 = gündüz, 1 = tam gece (pencere ışıkları, lambalar). */
  night: number;
  turbidity: number;
  rayleigh: number;
}

const PRESET: Record<Exclude<TimeOfDay, 'real'>, { elevation: number; azimuth: number }> = {
  day: { elevation: 48, azimuth: 200 },
  sunset: { elevation: 2, azimuth: 262 },
  night: { elevation: -18, azimuth: 300 },
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function dirFrom(elevation: number, azimuth: number, out: THREE.Vector3): THREE.Vector3 {
  const phi = (90 - elevation) * DEG;
  const th = azimuth * DEG;
  // azimut: 0 = kuzey (−Z), 90 = doğu (+X)
  return out.set(Math.sin(phi) * Math.sin(th), Math.cos(phi), -Math.sin(phi) * Math.cos(th));
}

/** Güneş yüksekliğine göre sürekli aydınlatma durumu. */
export function daylight(t: TimeOfDay, center: { lat: number; lon: number }, now = new Date()): Daylight {
  const p = t === 'real' ? sunPosition(now, center.lat, center.lon) : PRESET[t];
  const e = p.elevation;
  const day = smooth(-4, 12, e);
  const golden = smooth(-4, 3, e) * (1 - smooth(6, 22, e));
  const night = 1 - smooth(-9, 1, e);
  const sunDir = dirFrom(e, p.azimuth, new THREE.Vector3());
  // Gece: ay ışığı (güneşin karşısında, yüksekte)
  const lightDir = e > -2 ? sunDir.clone() : dirFrom(35, (p.azimuth + 180) % 360, new THREE.Vector3());
  const white = new THREE.Color(0xfff4e2);
  const orange = new THREE.Color(0xff9a55);
  const moon = new THREE.Color(0x8ea6ff);
  const sunColor = e > -2 ? white.clone().lerp(orange, golden) : moon;
  const sunIntensity = e > -2 ? 0.2 + 2.5 * smooth(-2, 18, e) : 0.6 * night;
  const hemiSky = new THREE.Color(0x4a5a80)
    .lerp(new THREE.Color(0xcfe3ff), day)
    .lerp(new THREE.Color(0xffc9a8), golden * 0.6);
  const hemiGround = new THREE.Color(0x2a2c30).lerp(new THREE.Color(0x6b6250), day);
  const fogColor = new THREE.Color(0x141b28)
    .lerp(new THREE.Color(0xc4d3de), day)
    .lerp(new THREE.Color(0xe0a882), golden * 0.7);
  return {
    elevation: e,
    azimuth: p.azimuth,
    sunDir,
    lightDir,
    sunColor,
    sunIntensity,
    hemiSky,
    hemiGround,
    hemiIntensity: 0.7 + 0.5 * day,
    fogColor,
    exposure: 0.95 - 0.05 * day,
    night,
    turbidity: 2.5 + golden * 6,
    rayleigh: 0.3 + day * 0.9 + golden * 1.5,
  };
}
