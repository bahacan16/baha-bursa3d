import { describe, expect, it } from 'vitest';
import { DEFAULT_CENTER, haversine, toLatLon, toLocal, vincenty } from '../../src/core/geo';

describe('geo', () => {
  const c = DEFAULT_CENTER;

  it('merkez orijine düşer', () => {
    const p = toLocal(c, c);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
  });

  it('kuzey −Z, doğu +X', () => {
    expect(toLocal({ lat: c.lat + 0.001, lon: c.lon }, c).z).toBeLessThan(0);
    expect(toLocal({ lat: c.lat, lon: c.lon + 0.001 }, c).x).toBeGreaterThan(0);
  });

  // Bilinen iki nokta: merkezden ~1 km uzaklıkta dört yön + çapraz çiftler
  const pairs: [{ lat: number; lon: number }, { lat: number; lon: number }][] = [
    [c, { lat: c.lat + 0.009, lon: c.lon }],
    [c, { lat: c.lat, lon: c.lon + 0.0118 }],
    [
      { lat: c.lat + 0.0061, lon: c.lon - 0.0072 },
      { lat: c.lat - 0.0049, lon: c.lon + 0.0081 },
    ],
  ];

  // KARAR: Küresel haversine elipsoidde yöne göre ~%0.15 sapar; hassas referans Vincenty (aşağıda).
  it('yerel mesafe haversine ile kabaca uyumlu (±%0.2)', () => {
    for (const [a, b] of pairs) {
      const pa = toLocal(a, c);
      const pb = toLocal(b, c);
      const d = haversine(a, b);
      expect(Math.abs(Math.hypot(pa.x - pb.x, pa.z - pb.z) - d) / d).toBeLessThan(0.002);
    }
  });

  it('yerel mesafe WGS84 (Vincenty) ile ±0.5 m', () => {
    for (const [a, b] of pairs) {
      const pa = toLocal(a, c);
      const pb = toLocal(b, c);
      expect(Math.abs(Math.hypot(pa.x - pb.x, pa.z - pb.z) - vincenty(a, b))).toBeLessThan(0.5);
    }
  });

  it('toLatLon, toLocal tersidir', () => {
    const p = { lat: 40.2211, lon: 28.9051 };
    const back = toLatLon(toLocal(p, c), c);
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lon).toBeCloseTo(p.lon, 9);
  });
});
