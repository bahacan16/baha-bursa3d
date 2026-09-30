import { describe, expect, it } from 'vitest';
import { dropHandmadeWays } from '../../src/worlds/osm/parse';

const sq = (x0: number, z0: number, x1: number, z1: number) => [x0, z0, x1, z0, x1, z1, x0, z1, x0, z0];

describe('dropHandmadeWays', () => {
  const ways: { i: number; p: number[]; t: Record<string, string> }[] = [
    { i: 1, p: sq(0, 0, 20, 10), t: { building: 'apartments' } },
    { i: 2, p: sq(0, 0, 10, 10), t: { 'building:part': 'yes' } }, // kenarı paylaşan iç parça
    { i: 3, p: sq(12, 2, 18, 8), t: { 'building:part': 'yes' } }, // tamamen içeride
    { i: 4, p: sq(30, 0, 40, 10), t: { 'building:part': 'yes' } }, // komşu (dışarıda)
    { i: 5, p: sq(15, 0, 25, 10), t: { 'building:part': 'yes' } }, // yarısı dışarıda
    { i: 6, p: sq(2, 2, 4, 4), t: { highway: 'service' } }, // bina parçası değil
  ];
  it('drops the handmade outline and the parts inside it only', () => {
    const kept = dropHandmadeWays(ways, new Set([1])).map((w) => w.i);
    expect(kept).toEqual([4, 5, 6]);
  });
  it('keeps everything when no id matches', () => {
    expect(dropHandmadeWays(ways, new Set([99])).length).toBe(ways.length);
  });
});

import type { Road } from '../../src/worlds/osm/parse';
import { junctionMarkSkip } from '../../src/worlds/osm/roads';
import { inPropZone } from '../../src/worlds/osm/props';
import { hedgeSpan } from '../../src/worlds/mertkent/fenceGeneric';
import { tactileKey } from '../../src/worlds/mertkent/street';
import { bargeDrop } from '../../src/worlds/mertkent/roof';
import { nearPlanLine, planLines } from '../../src/worlds/mertkent/siteplan';
import type { V2 } from '../../src/worlds/mertkent/builder';

const road = (id: string, pts: [number, number][], width = 8, kind = 'tertiary'): Road => ({
  id,
  kind,
  pts,
  width,
  sidewalkLeft: false,
  sidewalkRight: false,
  layer: 0,
  bridge: false,
  tunnel: false,
  area: false,
  vehicular: true,
  oneway: 0,
});

describe('junctionMarkSkip', () => {
  const main = road('a', [
    [-50, 0],
    [0, 0],
  ]);
  const cont = road('b', [
    [0, 0],
    [50, 1],
  ]);
  const side = road('c', [
    [20, 0],
    [20, 40],
  ]);
  const skipFor = junctionMarkSkip([main, cont, side]);
  it('keeps lines along a straight continuation of the same street', () => {
    // a'nın kenar çizgisi b'nin şeridinin içinde (ortak uçta, aynı doğrultu) → çizilir
    expect(skipFor(main)(-0.5, 3.6, 1, 0)).toBe(false);
  });
  it('drops lines where a crossing carriageway covers them (junction mouth)', () => {
    // b'nin kenar çizgisi c'nin (dik) şeridinin içinde
    expect(skipFor(cont)(20, 3.6, 1, 0)).toBe(true);
    // c'nin çizgisi b'nin şeridinin içinde
    expect(skipFor(side)(23.6, 1, 0, 1)).toBe(true);
  });
  it('keeps lines away from other carriageways', () => {
    expect(skipFor(side)(23.6, 20, 0, 1)).toBe(false);
    expect(skipFor(main)(-30, 3.6, 1, 0)).toBe(false);
  });
  it('drops lines inside overlapping one-way arms that meet at a shallow angle', () => {
    const armA = road('d', [
      [0, 0],
      [-30, -9],
    ]);
    const armB = road('e', [
      [-30, 1],
      [0, 0],
    ]);
    const f = junctionMarkSkip([armA, armB]);
    // A'nın çizgisi, 21° açıyla birleşen B'nin şeridinin içinde (uca yakın) → çizilmez
    expect(f(armA)(-4, 0.2, -0.958, -0.287)).toBe(true);
  });
});

describe('inPropZone', () => {
  const zones = [
    { p: [0, 0, 10, 0, 10, 10, 0, 10], r: 0, closed: true },
    { p: [100, 0, 200, 0], r: 5 },
  ];
  it('tests inside closed rings and buffered polylines', () => {
    expect(inPropZone(zones, 5, 5)).toBe(true);
    expect(inPropZone(zones, 150, 4)).toBe(true);
    expect(inPropZone(zones, 150, 6)).toBe(false);
    expect(inPropZone(zones, 50, 5)).toBe(false);
  });
});

describe('hedgeSpan', () => {
  // DA kolu batıya, köşede güneye (503. Sk. kolu) dönen çit: sokak kuzeyde / batıda, çit bitkisi iç tarafta
  const pts: V2[] = [
    [210, -151],
    [202, -151.4],
    [202, -140],
  ];
  it('trims the hedge where the next leg turns into the hedge side', () => {
    const t: V2 = [-1, -0.05];
    const n: V2 = [-t[1], t[0]];
    const [u0, u1] = hedgeSpan(pts, 0, n, 0.3);
    const L = Math.hypot(8, 0.4);
    expect(u0).toBe(0);
    expect(L - u1).toBeGreaterThan(0.3);
    expect(L - u1).toBeLessThan(0.4);
  });
  it('does not trim on a straight run or an outward turn', () => {
    const straight: V2[] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ];
    expect(hedgeSpan(straight, 0, [0, 1], 0.3)).toEqual([0, 10]);
    const outward: V2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    // Çit bitkisi −n = (0,−1) tarafında; kol +z'ye (bitkinin tersine) dönüyor
    expect(hedgeSpan(outward, 0, [0, 1], 0.3)).toEqual([0, 10]);
  });
});

describe('small street helpers', () => {
  it('tactileKey', () => {
    expect(tactileKey()).toBe('tactile');
    expect(tactileKey([1, 1, 1])).toBe('tactile');
    expect(tactileKey([1.18, 1.08, 1.03])).toBe('tactile@1.180,1.080,1.030');
    expect(tactileKey([1, Number.NaN, 1])).toBe('tactile');
  });
  it('bargeDrop keeps the old 0.22 m default', () => {
    expect(bargeDrop()).toBeCloseTo(0.2);
    expect(bargeDrop(0.04)).toBeCloseTo(0.02);
  });
  it('nearPlanLine: fence buffer 2.5 m, sidewalk w + 2', () => {
    const lines = planLines({
      fence: [
        {
          pts: [
            [0, 0],
            [10, 0],
          ],
        },
      ],
      sidewalks: [
        {
          pts: [
            [0, 20],
            [10, 20],
          ],
          w: 3,
          side: 'left',
        },
      ],
    });
    expect(nearPlanLine(lines, 5, 1.3)).toBe(true);
    expect(nearPlanLine(lines, 5, 2.6)).toBe(false);
    expect(nearPlanLine(lines, 5, 24.9)).toBe(true);
    expect(nearPlanLine(lines, 5, 25.2)).toBe(false);
  });
});

import { Builder } from '../../src/worlds/mertkent/builder';
import { buildStreetPlan, ROAD_FLUSH } from '../../src/worlds/mertkent/street';

type Bk = { pos: number[] };
const bks = (b: Builder) => (b as unknown as { buckets: Map<string, Bk> }).buckets;
const yRange = (bk?: Bk) => {
  let y0 = Infinity;
  let y1 = -Infinity;
  if (bk)
    for (let i = 1; i < bk.pos.length; i += 3) {
      y0 = Math.min(y0, bk.pos[i]);
      y1 = Math.max(y1, bk.pos[i]);
    }
  return [y0, y1];
};

describe('street plan renderer (critic fixes)', () => {
  const ck = (k: string, h: string) => `cc_${k}_${h}`;
  const build = (street: unknown[], sidewalks: unknown[] = []) => {
    const b = new Builder();
    buildStreetPlan(
      b,
      { street, sidewalks } as never,
      () => 0,
      () => 5,
      { colorKey: ck as never },
    );
    return bks(b);
  };
  it('manhole / drain sit on the road above the OSM asphalt and lines, with measured size + colour', () => {
    const bk = build([
      { kind: 'manhole', x: 0, z: 0, r: 0.3, color: '#797d7e' },
      { kind: 'drain', x: 3, z: 0, w: 0.9, d: 0.5 },
      { kind: 'manhole', x: 6, z: 0, shape: 'square', w: 0.6 },
    ]);
    const [y0] = yRange(bk.get('cc_frame_#797d7e'));
    expect(y0).toBeCloseTo(ROAD_FLUSH, 5);
    expect(y0).toBeGreaterThan(0.05);
    expect(bk.get('darkMetal')!.pos.length / 3).toBe(4); // ızgara (renk yok → koyu metal)
    expect(bk.has('cc_frame_#797d7e')).toBe(true); // kare kapak: varsayılan dökme demir tonu
  });
  it('manhole on a measured sidewalk band sits on the band', () => {
    const bk = build(
      [{ kind: 'manhole', x: 5, z: 1, r: 0.3 }],
      [
        {
          id: 't',
          pts: [
            [0, 0],
            [10, 0],
          ],
          w: 2,
          side: 'right',
          layers: [{ w: 1.85, material: 'gri beton kilit taşı', h: 0.15 }],
        },
      ],
    );
    const [y0] = yRange(bk.get('cc_frame_#797d7e'));
    expect(y0).toBeCloseTo(0.162, 3);
  });
  it('crossing: alternating colours, base paint, worn colour', () => {
    const bk = build([
      {
        kind: 'crossing',
        x: 0,
        z: 0,
        rot: 0,
        len: 4,
        w: 3,
        color: ['#d9b53a', '#e8e8e4'],
        baseColor: '#9b3b30',
      },
      { kind: 'crossing', x: 20, z: 0, rot: 0, len: 4, w: 3, color: '#d9b53a', wear: 0.25 },
    ]);
    expect(bk.has('cc_asphalt_#d9b53a')).toBe(true);
    expect(bk.has('cc_asphalt_#e8e8e4')).toBe(true);
    expect(yRange(bk.get('cc_asphalt_#9b3b30'))[0]).toBeLessThan(yRange(bk.get('cc_asphalt_#d9b53a'))[0]);
    // %25 aşınma → boyanın ~%75'i kalır (wear3 örtü eşiği)
    expect(bk.has('cc_wear3_#d9b53a')).toBe(true);
  });
  it('road-line give-way: dashed thick paint', () => {
    const bk = build([
      {
        kind: 'road-line',
        x: 0,
        z: 0,
        style: 'giveway',
        pts: [
          [0, 0],
          [5, 0],
        ],
      },
    ]);
    // 5 m / (0.5 + 0.5) → 5 parça
    expect(bk.get('spPaint')!.pos.length).toBeGreaterThan(0);
  });
  it('bin honours colour / note', () => {
    const bk = build([
      { kind: 'bin', x: 0, z: 0, note: 'turuncu plastik kova' },
      { kind: 'bin', x: 3, z: 0, color: '#3366aa' },
    ]);
    expect(bk.has('bollardOrange')).toBe(true);
    expect(bk.has('cc_metal_#3366aa')).toBe(true);
    expect(bk.has('binGreen')).toBe(false);
  });
  it('roundabout: asphalt annulus from the island kerb to the ring outer edge', () => {
    const bk = build([{ kind: 'roundabout-island', x: 0, z: 0, rx: 12, rz: 12, ringOuter: 27.5 }]);
    const rf = bk.get('roadFill')!;
    let rmax = 0;
    let rmin = Infinity;
    for (let i = 0; i < rf.pos.length; i += 3) {
      const r = Math.hypot(rf.pos[i], rf.pos[i + 2]);
      rmax = Math.max(rmax, r);
      rmin = Math.min(rmin, r);
    }
    expect(rmax).toBeGreaterThan(27);
    expect(rmin).toBeGreaterThan(11.5);
  });
  it('swan-neck lamp: curved arm tube', () => {
    const bk = build([{ kind: 'lamp-post', x: 0, z: 0, h: 10, rot: 90, arm: 2, note: 'tek kuğu boynu kol' }]);
    const [, y1] = yRange(bk.get('pole'));
    expect(y1).toBeGreaterThan(10.1);
  });
});

import { signKeysOf } from '../../src/worlds/mertkent/street';
import { buildPlanGate, buildParkKoza } from '../../src/worlds/mertkent/site';

describe('follow-up renderer fields', () => {
  const ck = (k: string, h: string) => `cc_${k}_${h}`;
  const build = (street: unknown[]) => {
    const b = new Builder();
    buildStreetPlan(
      b,
      { street } as never,
      () => 0,
      () => 5,
      { colorKey: ck as never, signFace: () => 'face' },
    );
    return bks(b);
  };
  it('sign keys: sonu, kamyon giremez, ek levha ok', () => {
    expect(signKeysOf('mecburi bisiklet yolu sonu (kırmızı çapraz bant)')).toEqual(['signBikeEnd']);
    expect(signKeysOf('kamyon giremez + altında sarı-siyah ok (chevron) levhası')).toEqual([
      'signNoTruck',
      'signChevron',
    ]);
    expect(signKeysOf('mecburi bisiklet yolu sonu + altında mavi dikdörtgen ek levha, beyaz ok')).toEqual([
      'signBikeEnd',
      'signArrowPlate',
    ]);
  });
  it('sign with textB draws its own back plate', () => {
    const bk = build([
      {
        kind: 'sign',
        x: 0,
        z: 0,
        h: 2.8,
        rot: 195,
        text: 'Mecburi bisiklet yolu sonu',
        textB: 'Mecburi bisiklet yolu',
      },
    ]);
    expect(bk.has('signBikeEnd')).toBe(true);
    expect(bk.has('signBike')).toBe(true);
    expect(bk.has('signBikeEndBack')).toBe(false);
  });
  it('board: base, arrow, cctv; billboard faces', () => {
    const bk = build([
      {
        kind: 'board',
        x: 0,
        z: 0,
        w: 1,
        h: 0.5,
        y0: 2,
        bg: '#ffffff',
        base: { h: 0.6, color: '#515041' },
        arrow: { side: 'left', color: '#2d5bb0' },
        cctv: { n: 2, h: 3.8, color: 'white' },
      },
      {
        kind: 'billboard-row',
        x: 0,
        z: 10,
        pts: [
          [0, 10],
          [10, 10],
        ],
        n: 2,
        faces: [{ bg: '#232323', lines: [{ text: 'Anne' }] }],
      },
    ]);
    expect(bk.has('cc_plaster_#515041')).toBe(true);
    expect(bk.has('cc_fascia_#2d5bb0')).toBe(true);
    expect(bk.has('mkAc')).toBe(true);
    expect(bk.has('billboardFace')).toBe(true); // ikinci pano ölçülmedi → nötr
  });
  it('pylon and canopy kinds', () => {
    const bk = build([
      { kind: 'pylon', x: 0, z: 0, h: 20, arms: [{ y: 16, w: 8 }], wires: [[40, 0, 15]] },
      {
        kind: 'canopy',
        x: 0,
        z: 0,
        a: [0, 0],
        e: [10, 0],
        d: 2.4,
        h: 3.2,
        fasciaC: '#d4782c',
        pillars: [{ u: 1, w: 0.5, color: '#2a2a2a', text: 'ONAL51 / özlüce' }],
      },
    ]);
    expect(bk.get('pole')!.pos.length).toBeGreaterThan(100);
    expect(bk.has('cc_fascia_#d4782c')).toBe(true);
    expect(bk.has('face')).toBe(true);
  });
  it('gate leafSpec laser-screen / mesh-slide, Park Koza', () => {
    const b = new Builder();
    const ctx = {
      mat: (k: string, c: string) => `gf_${k}_${c}`,
      colorKey: (k: string, h: string) => `cc_${k}_${h}`,
      wrought: () => {},
    } as never;
    buildPlanGate(
      b,
      {
        kind: 'pedestrian',
        id: 'north-gate',
        c: [0, 0],
        n: [0, -1],
        w: 2.4,
        leafSpec: { style: 'laser-screen', leaves: 2, rosette: {}, pillarLozenges: { n: 2 } },
      },
      0,
      ctx,
    );
    buildPlanGate(
      b,
      {
        kind: 'vehicle',
        id: 'south-gate',
        c: [10, 0],
        n: [0, 1],
        w: 5,
        h: 1.75,
        leafSpec: {
          style: 'mesh-slide',
          frame: '#a0a195',
          finials: { kind: 'spear', color: '#ac977e' },
          scrollBand: { h: 0.35 },
        },
        pillarSpec: { cap: { color: '#adaaa8' }, footBox: { color: '#ecd8ab' } },
      },
      0,
      ctx,
    );
    buildParkKoza(b, [30, 0], [0, 1], 0);
    const bk = bks(b);
    expect(bk.has('ironScroll')).toBe(true);
    expect(bk.has('gold')).toBe(true);
    expect(bk.has('gf_welded_#a0a195')).toBe(true);
    expect(bk.has('cc_metal_#ac977e')).toBe(true);
    expect(bk.has('cc_fascia_#ecd8ab')).toBe(true);
    expect(bk.has('meshGrey')).toBe(true);
  });
});
