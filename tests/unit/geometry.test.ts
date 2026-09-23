import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { offsetPolyline, trimPolyline } from '../../src/worlds/osm/roads';
import { Bucket, ChunkedGeometry } from '../../src/worlds/osm/chunks';
import { addFlatPolygon, addWalls, buildBuilding, wallU } from '../../src/worlds/osm/buildings';
import { buildWorld } from '../../src/worlds/osm/build';
import { DEFAULT_CENTER_LITE, simplifyOverpass, type OverpassJson } from '../../src/worlds/osm/simplify';
import { distToSegment, type Building, type Pt } from '../../src/worlds/osm/parse';

const raw = JSON.parse(readFileSync('tests/fixtures/osm-small.json', 'utf8')) as OverpassJson;
const simple = simplifyOverpass(raw, DEFAULT_CENTER_LITE, 'fixture');

/** Üçgen normali (sağ el kuralı) */
function triNormal(b: Bucket, t: number): [number, number, number] {
  const [i, j, k] = [b.idx[t * 3], b.idx[t * 3 + 1], b.idx[t * 3 + 2]];
  const P = (n: number) => [b.pos[n * 3], b.pos[n * 3 + 1], b.pos[n * 3 + 2]];
  const [a, c, d] = [P(i), P(j), P(k)];
  const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

describe('yol şeridi ofseti', () => {
  it('düz çizgide ofset mesafesi korunur', () => {
    const pts: Pt[] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ];
    const L = offsetPolyline(pts, 3);
    for (const p of L) expect(Math.abs(p[1])).toBeCloseTo(3);
  });

  it('90° dönüşte gönye noktası her iki segmentten de ofset uzaklıkta', () => {
    const pts: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const L = offsetPolyline(pts, 2);
    expect(distToSegment(L[1][0], L[1][1], pts[0], pts[1])).toBeCloseTo(2);
    expect(distToSegment(L[1][0], L[1][1], pts[1], pts[2])).toBeCloseTo(2);
    // sol ve sağ ofsetler birbirini kesmez (basit durum)
    const R = offsetPolyline(pts, -2);
    expect(Math.hypot(L[1][0] - R[1][0], L[1][1] - R[1][1])).toBeCloseTo(4 * Math.SQRT2);
  });

  it('kırpma baştan ve sondan doğru uzunluğu keser', () => {
    const t = trimPolyline(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      3,
      4,
    )!;
    expect(t[0]).toEqual([3, 0]);
    expect(t[t.length - 1][1]).toBeCloseTo(6);
    expect(trimPolyline([[0, 0] as Pt, [2, 0] as Pt], 1, 1)).toBeNull();
  });
});

describe('bina geometrisi', () => {
  it('pencere aralığı ~2.5 m tam sayı bölmeye yuvarlanır', () => {
    expect(wallU(12)).toBe(12.5);
    expect(wallU(1)).toBe(0);
  });

  it('duvar normalleri dışa, üçgen yönü normalle uyumlu', () => {
    const b = new Bucket(true);
    const sq: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    addWalls(b, sq, 0, 3, [1, 1, 1], [0, -1, 3, 0]);
    for (let t = 0; t < b.idx.length / 3; t++) {
      const n = triNormal(b, t);
      const i = b.idx[t * 3];
      const cx = b.pos[i * 3] - 5;
      const cz = b.pos[i * 3 + 2] - 5;
      expect(n[0] * cx + n[2] * cz).toBeGreaterThan(0);
      // vertex normali ile üçgen normali aynı yönde
      expect(n[0] * b.nor[i * 3] + n[2] * b.nor[i * 3 + 2]).toBeGreaterThan(0);
    }
  });

  it('düz çatı üçgenleri yukarı bakar (delikli)', () => {
    const b = new Bucket();
    addFlatPolygon(
      b,
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [
          [3, 3],
          [3, 7],
          [7, 7],
          [7, 3],
        ],
      ],
      5,
      [1, 1, 1],
    );
    expect(b.idx.length / 3).toBe(8);
    for (let t = 0; t < b.idx.length / 3; t++) expect(triNormal(b, t)[1]).toBeGreaterThan(0);
  });

  it('eğik çatılar üretilir', () => {
    const geo = new ChunkedGeometry();
    const base: Omit<Building, 'roofShape'> = {
      id: 'w1',
      outer: [
        [0, 0],
        [12, 0],
        [12, 8],
        [0, 8],
      ],
      holes: [],
      minHeight: 0,
      height: 8.7,
      wallTop: 6.2,
      roofHeight: 2.5,
      kind: 'house',
      isPart: false,
      levels: 2,
    };
    for (const roofShape of ['gabled', 'hipped', 'pyramidal'] as const) {
      buildBuilding(geo, { ...base, id: roofShape, roofShape }, { roofDetails: false });
    }
    const roof = geo.get(1, 1, 'roof');
    const ys = roof.pos.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(8.7);
    for (let t = 0; t < roof.idx.length / 3; t++) expect(triNormal(roof, t)[1]).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('dünya üretimi (fixture)', () => {
  it('chunk geometrileri, ağaçlar ve kaldırımlar üretilir', () => {
    const r = buildWorld(simple, { quality: 'high' });
    expect(r.stats.buildings).toBeGreaterThan(15);
    expect(r.chunks.some((c) => c.mat === 'wall' && c.facade && c.facade.length > 0)).toBe(true);
    expect(r.chunks.some((c) => c.mat === 'sidewalk')).toBe(true);
    expect(r.chunks.some((c) => c.mat === 'marking')).toBe(true);
    expect(r.trees.count).toBeGreaterThan(20);
    expect(r.strips.length).toBeGreaterThan(0);
    expect(r.piers.length).toBeGreaterThan(0);
    for (const c of r.chunks) {
      expect(c.position.length % 3).toBe(0);
      const vc = c.position.length / 3;
      for (const i of c.index) expect(i).toBeLessThan(vc);
      expect(c.position.every(Number.isFinite)).toBe(true);
    }
  });
});
