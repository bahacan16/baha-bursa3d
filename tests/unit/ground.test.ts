import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GroundIndex } from '../../src/worlds/osm/world';
import { buildRoads, CURB_H } from '../../src/worlds/osm/roads';
import { ChunkedGeometry } from '../../src/worlds/osm/chunks';
import { parseOsm } from '../../src/worlds/osm/parse';
import { DEFAULT_CENTER_LITE, simplifyOverpass, type OverpassJson } from '../../src/worlds/osm/simplify';

const raw = JSON.parse(readFileSync('tests/fixtures/osm-small.json', 'utf8')) as OverpassJson;
const data = parseOsm(simplifyOverpass(raw, DEFAULT_CENTER_LITE, 'fixture'));
const roads = buildRoads(new ChunkedGeometry(), data.roads, data.crossings);
const g = new GroundIndex(roads.strips, roads.carriageways);

describe('zemin yüksekliği (kaldırım)', () => {
  it('yol üzerinde 0, kaldırımda +0.15, dışında 0', () => {
    expect(g.height(0, 0)).toBe(0); // 502. Sokak ekseni
    expect(g.height(0, -4.25)).toBeCloseTo(CURB_H); // kuzey kaldırımı (3.25..5.25)
    expect(g.height(0, 4.25)).toBeCloseTo(CURB_H); // güney kaldırımı
    expect(g.height(0, -10)).toBe(0);
  });
  it('kavşakta kaldırım kırpılır, araç yolu önceliklidir', () => {
    // Doğan Avcıoğlu Cad. (x=160, genişlik 10) üzerinde, 502. Sokak kaldırımının uzantısı
    expect(g.height(158, -4.25)).toBe(0);
  });
});
