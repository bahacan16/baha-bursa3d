import { describe, expect, it } from 'vitest';
import { ChunkedGeometry } from '../../src/worlds/osm/chunks';
import { buildRoads, laneDividerOffsets, sidewalkSides } from '../../src/worlds/osm/roads';
import type { Road } from '../../src/worlds/osm/parse';
import { placeTrees } from '../../src/worlds/osm/vegetation';
import { surveyMaskRect } from '../../src/worlds/osm/groundtex';
import { parseSpecies } from '../../src/worlds/osm/species';
import {
  bufferedRings,
  handFootprints,
  roadMarksOf,
  STREET_PLAN,
  surveyGroundPolys,
  surveyVegetation,
} from '../../src/worlds/measured/siteplan';
import { fasciaSigns } from '../../src/worlds/measured/streetFurniture';

type V2 = [number, number];

function inFlat(p: number[], x: number, z: number): boolean {
  let c = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i];
    const zi = p[2 * i + 1];
    const xj = p[2 * j];
    const zj = p[2 * j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const inAny = (zones: number[][], x: number, z: number) => zones.some((r) => inFlat(r, x, z));

/** Kuzey–güney doğrultulu tek yönlü test yolu (x = 0, z 0 → −100) */
function road(over: Partial<Road> = {}): Road {
  return {
    id: 'w1',
    kind: 'secondary',
    pts: [
      [0, 0],
      [0, -100],
    ],
    width: 9.6,
    sidewalkLeft: true,
    sidewalkRight: true,
    layer: 0,
    bridge: false,
    tunnel: false,
    area: false,
    vehicular: true,
    oneway: 1,
    lanes: 3,
    ...over,
  };
}

/** Çizgi (marking) köşelerinin x değerleri (yuvarlanmış, benzersiz) */
function markingXs(geo: ChunkedGeometry): number[] {
  const xs = new Set<number>();
  for (const c of geo.toPayload())
    if (c.mat === 'marking')
      for (let i = 0; i < c.position.length; i += 3) xs.add(Math.round(c.position[i] * 100) / 100);
  return [...xs].sort((a, b) => a - b);
}

describe('D4 düzeltmeleri: şerit çizgileri (4)', () => {
  it('şerit ayırıcı ofsetleri eşit şerit genişliğinde', () => {
    expect(laneDividerOffsets(9.6, 3).map((v) => +v.toFixed(3))).toEqual([-1.6, 1.6]);
    expect(laneDividerOffsets(6.4, 2)).toEqual([0]);
    expect(laneDividerOffsets(9.6, 1)).toEqual([]);
    expect(laneDividerOffsets(9.6, undefined)).toEqual([]);
  });

  it('tek yönlü 3 şeritli yolda iki kesikli ayırıcı çizilir, orta çizgi yok', () => {
    const geo = new ChunkedGeometry();
    buildRoads(geo, [road()], [], [], { w1: { edges: 'none' } });
    const xs = markingXs(geo);
    // 12 cm genişlikli çizgiler x = ±1.6 çevresinde
    expect(xs.some((x) => Math.abs(x - 1.6) < 0.07)).toBe(true);
    expect(xs.some((x) => Math.abs(x + 1.6) < 0.07)).toBe(true);
    expect(xs.some((x) => Math.abs(x) < 0.07)).toBe(false);
  });

  it('ölçülmüş lanes üstünlüğü: lanes 1 → şerit çizgisi yok; OSM lanes yoksa eski davranış', () => {
    const g1 = new ChunkedGeometry();
    buildRoads(g1, [road()], [], [], { w1: { edges: 'none', lanes: 1 } });
    expect(markingXs(g1)).toEqual([]);
    const g2 = new ChunkedGeometry();
    buildRoads(g2, [road({ lanes: undefined })], [], [], { w1: { edges: 'none' } });
    expect(markingXs(g2)).toEqual([]);
    const g3 = new ChunkedGeometry();
    buildRoads(g3, [road({ lanes: undefined })], [], [], { w1: { edges: 'none', lanes: 2 } });
    expect(markingXs(g3).some((x) => Math.abs(x) < 0.07)).toBe(true);
  });

  it('çift yönlü yolda şerit ayırıcı eklenmez (orta çizgi kuralı aynı)', () => {
    const g = new ChunkedGeometry();
    buildRoads(g, [road({ oneway: 0, lanes: 4, width: 12.8 })], [], [], { w1: { edges: 'none' } });
    const xs = markingXs(g);
    expect(xs.some((x) => Math.abs(Math.abs(x) - 3.2) < 0.07)).toBe(false);
    expect(xs.some((x) => Math.abs(x) < 0.07)).toBe(true);
  });
});

describe('D4 düzeltmeleri: OSM kaldırımı (1)', () => {
  it('roads[] sidewalk none → yolun OSM kaldırımı yok', () => {
    expect(sidewalkSides(road(), { sidewalk: 'none' })).toEqual({ left: false, right: false });
    expect(sidewalkSides(road({ sidewalkLeft: false }), {})).toEqual({ left: false, right: true });
    const g = new ChunkedGeometry();
    buildRoads(g, [road()], [], [], { w1: { sidewalk: 'none' } });
    expect(g.toPayload().some((c) => c.mat === 'sidewalk')).toBe(false);
    const g2 = new ChunkedGeometry();
    buildRoads(g2, [road()], [], [], {});
    expect(g2.toPayload().some((c) => c.mat === 'sidewalk')).toBe(true);
  });

  it('street-plan roads[] bayrakları roadMarks’a geçer (sayı / "w…" kimliği)', () => {
    const m = roadMarksOf({
      roads: [
        { id: 303430966, sidewalk: 'none', edges: 'none', lanes: 3 },
        { id: 'w306909263', sidewalk: 'bogus' as 'none' },
      ],
    });
    expect(m.w303430966).toEqual({ sidewalk: 'none', edges: 'none', lanes: 3 });
    expect(m.w306909263).toEqual({});
  });

  it('ölçülmüş refüjler (1.5 m tampon) OSM kaldırım bölgesinde', () => {
    const v = surveyVegetation();
    const isl = (STREET_PLAN.street ?? []).find((s) => (s as { id?: string }).id === 'd4-median-m4') as
      { poly: V2[] } | undefined;
    expect(isl).toBeTruthy();
    const xs = isl!.poly.map((p) => p[0]);
    const zs = isl!.poly.map((p) => p[1]);
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    // Refüjün ortası ve doğu kenarının 1.2 m dışı (d4b #1: OSM kaldırım bandı ortası kenarın dışına düşüyordu)
    const row = isl!.poly.filter((p) => Math.abs(p[1] - cz) < 8);
    const east = Math.max(...row.map((p) => p[0]));
    expect(inAny(v.noSidewalkZones, (Math.min(...xs) + Math.max(...xs)) / 2, cz)).toBe(true);
    expect(inAny(v.noSidewalkZones, east + 1.2, cz)).toBe(true);
  });

  it('tampon halkası: kenar bantları çokgenin dışına d kadar taşar', () => {
    const sq: V2[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ];
    const r = bufferedRings(sq, 1.5);
    expect(inAny(r, 5, 2)).toBe(true);
    expect(inAny(r, 5, -1.4)).toBe(true);
    expect(inAny(r, 11.4, 2)).toBe(true);
    expect(inAny(r, 5, -1.7)).toBe(false);
  });
});

describe('D4 düzeltmeleri: ölçülmüş zemin maskesi (2)', () => {
  it('kaldırım bantları, adalar ve sokak alanları maskede', () => {
    const polys = surveyGroundPolys(
      {
        sidewalks: [
          {
            pts: [
              [0, 0],
              [0, -20],
            ],
            w: 3,
            side: 'right',
          },
        ],
        street: [
          {
            kind: 'island',
            x: 20,
            z: -10,
            poly: [
              [18, -12],
              [22, -12],
              [22, -8],
              [18, -8],
            ],
          } as never,
        ],
        areas: [
          {
            kind: 'paving',
            poly: [
              [40, 0],
              [50, 0],
              [50, -10],
            ],
          },
        ],
      },
      [],
    );
    const flat = polys.map((r) => r.flat());
    expect(inAny(flat, 20, -10)).toBe(true);
    expect(inAny(flat, 48, -3)).toBe(true);
    // Sağ yan (+x doğu → güneye giderken sağ = batı): bant x −3..0, yol tarafına 1.5 m dolgu
    const side = [-1.5, 1.4].some((x) => inAny(flat, x, -10)) && [-2.5].some((x) => inAny(flat, x, -10));
    expect(side || [1.5, 2.5].every((x) => inAny(flat, x, -10))).toBe(true);
    expect(inAny(flat, 30, -30)).toBe(false);
    expect(surveyMaskRect(polys)).toBeTruthy();
    expect(surveyMaskRect([])).toBeNull();
  });

  it('gerçek veride maske çokgenleri sonlu ve D4 refüjünü kapsar', () => {
    const polys = surveyGroundPolys();
    expect(polys.length).toBeGreaterThan(50);
    for (const r of polys)
      for (const p of r) expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true);
    expect(
      inAny(
        polys.map((r) => r.flat()),
        630.7,
        -536,
      ),
    ).toBe(true);
  });
});

describe('D4 düzeltmeleri: hava fotoğrafı ağaçları (3)', () => {
  it('el modeli taban izleri otomatik ağaç bölgesinde (Biaport podyumu 1546358573)', () => {
    const rings = handFootprints();
    expect(rings.length).toBeGreaterThan(50);
    const v = surveyVegetation();
    expect(rings.some((r) => inFlat(r.flat(), 756.3, -255.5))).toBe(true);
    // Kritik: (756.3, −255.5) podyumun içinden çıkan hava fotoğrafı tacı
    expect(inAny(v.excludeZones, 756.3, -255.5)).toBe(true);
  });

  it('placeTrees: bölge içindeki hava fotoğrafı tacı elenir, ölçülmüş ağaç kalır', () => {
    const zone = [0, 0, 20, 0, 20, 20, 0, 20];
    const trees = placeTrees([], [], [], [], [], {
      maxTrees: 100,
      density: 1,
      aerialTrees: [10, 10, 3, 40, 40, 3],
      fixedTrees: [5, 5, 0, 6, 2, 0],
      excludeZones: [zone],
    });
    const at = (x: number, z: number) =>
      trees.some((t) => Math.abs(t.x - x) < 0.01 && Math.abs(t.z - z) < 0.01);
    expect(at(10, 10)).toBe(false);
    expect(at(40, 40)).toBe(true);
    expect(at(5, 5)).toBe(true);
  });

  it('treeExclude çokgenleri hava fotoğrafı ağaçlarına uygulanır', () => {
    const v = surveyVegetation();
    for (const q of (STREET_PLAN as { treeExclude?: { poly?: V2[] }[] }).treeExclude ?? []) {
      if (!q.poly || q.poly.length < 3) continue;
      const cx = q.poly.reduce((s, p) => s + p[0], 0) / q.poly.length;
      const cz = q.poly.reduce((s, p) => s + p[1], 0) / q.poly.length;
      if (!inFlat(q.poly.flat(), cx, cz)) continue;
      const trees = placeTrees([], [], [], [], [], {
        maxTrees: 10,
        density: 1,
        aerialTrees: [cx, cz, 3],
        excludeZones: v.excludeZones,
      });
      expect(trees.length).toBe(0);
    }
  });
});

describe('D4 düzeltmeleri: kış bahçesi yazısı ve mor fidan', () => {
  const poly: V2[] = [
    [0, 0],
    [8, 0],
    [8, 3],
    [0, 3],
  ];
  it('fasciaText en uzun dolu olmayan kenara, fasciaSigns kenar/u ile', () => {
    expect(fasciaSigns({ kind: 'enclosure', x: 0, z: 0, fasciaText: 'GÖK’AY' }, poly, new Set([0]))).toEqual([
      { edge: 2, text: 'GÖK’AY' },
    ]);
    const s = fasciaSigns(
      {
        kind: 'enclosure',
        x: 0,
        z: 0,
        fasciaSigns: [
          { edge: 1, u0: 0.2, u1: 2.8, text: 'Mandıra', fg: '#f0d040' },
          { edge: 9, text: 'x' },
          { edge: 0, text: '' },
        ],
      },
      poly,
      new Set(),
    );
    expect(s).toEqual([{ edge: 1, u0: 0.2, u1: 2.8, text: 'Mandıra', fg: '#f0d040' }]);
  });

  it('mor yapraklı fidan türü', () => {
    expect(parseSpecies('sapling-purple')).toBe('sapling-purple');
    expect(parseSpecies(undefined, 'Mor yapraklı fidan, çift kazıklı')).toBe('sapling-purple');
    expect(parseSpecies('prunus-purple', 'Orta refüjde çift ahşap kazıklı genç ağaç (kazık)')).toBe(
      'prunus-purple',
    );
    expect(parseSpecies(undefined, 'kan erik')).toBe('prunus-purple');
  });
});
