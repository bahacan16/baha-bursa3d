import { describe, expect, it } from 'vitest';
import { DEFAULT_CENTER, haversine, toLatLon, toLocal } from '../../src/core/geo';

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

  it('yerel mesafe haversine ile ±0.5 m uyumlu (1 km ölçeğinde)', () => {
    const a = { lat: c.lat + 0.0061, lon: c.lon - 0.0072 };
    const b = { lat: c.lat - 0.0049, lon: c.lon + 0.0081 };
    const pa = toLocal(a, c);
    const pb = toLocal(b, c);
    const local = Math.hypot(pa.x - pb.x, pa.z - pb.z);
    expect(Math.abs(local - haversine(a, b))).toBeLessThan(0.5);
  });

  it('toLatLon, toLocal tersidir', () => {
    const p = { lat: 40.2211, lon: 28.9051 };
    const back = toLatLon(toLocal(p, c), c);
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lon).toBeCloseTo(p.lon, 9);
  });
});
