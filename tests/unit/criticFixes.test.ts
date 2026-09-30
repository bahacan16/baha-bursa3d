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
