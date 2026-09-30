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
