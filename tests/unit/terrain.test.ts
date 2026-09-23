import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTerrain, sampleGrid } from '../../src/env/terrain';
import { setTerrain, densify, ringBase } from '../../src/worlds/osm/height';
import { ChunkedGeometry } from '../../src/worlds/osm/chunks';
import { buildBuilding } from '../../src/worlds/osm/buildings';

describe('arazi', () => {
  it('terrain.bin ayrıştırılır, merkez 0 m, uzak ızgara Uludağ yüksekliğinde', () => {
    const b = readFileSync('public/data/terrain.bin');
    const t = parseTerrain(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    expect(Math.abs(sampleGrid(t.near, 0, 0))).toBeLessThan(0.5);
    expect(t.base).toBeGreaterThan(20);
    expect(t.far).not.toBeNull();
    expect(Math.max(...t.far!.h) + t.base).toBeGreaterThan(2000);
  });

  it('eğimde bina en düşük köşeden başlar, polyline sıklaşır', () => {
    setTerrain({ n: 3, half: 100, cell: 100, h: new Float32Array([0, 10, 20, 0, 10, 20, 0, 10, 20]) });
    const ring: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ];
    expect(ringBase(ring)).toBeCloseTo(10);
    expect(densify([[0, 0] as [number, number], [60, 0] as [number, number]]).length).toBeGreaterThan(4);
    const geo = new ChunkedGeometry();
    buildBuilding(
      geo,
      {
        id: 'w1',
        outer: ring,
        holes: [],
        minHeight: 0,
        height: 10,
        wallTop: 10,
        roofShape: 'flat',
        roofHeight: 0,
        kind: 'yes',
        isPart: false,
        levels: 3,
      },
      { roofDetails: false },
    );
    const roof = geo.get(5, 5, 'roof');
    const ys = roof.pos.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(10 + 10 - 0.8, 1);
    setTerrain(null);
  });
});

describe('güneş konumu', () => {
  it('Bursa, ekinoks öğleninde ~50° yükseklik, güneyde; gece yarısı ufkun altında', async () => {
    const { sunPosition } = await import('../../src/env/daylight');
    const noon = sunPosition(new Date('2026-03-20T10:10:00Z'), 40.218, 28.907); // yerel ~13:10 (UTC+3)
    expect(noon.elevation).toBeGreaterThan(45);
    expect(noon.elevation).toBeLessThan(54);
    expect(noon.azimuth).toBeGreaterThan(160);
    expect(noon.azimuth).toBeLessThan(200);
    const midnight = sunPosition(new Date('2026-03-20T21:00:00Z'), 40.218, 28.907);
    expect(midnight.elevation).toBeLessThan(-30);
  });
});
