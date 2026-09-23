import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildingHeights,
  parseLength,
  parseOsm,
  pointInPolygon,
  roadWidth,
} from '../../src/worlds/osm/parse';
import {
  DEFAULT_CENTER_LITE,
  simplifyOverpass,
  stitchRings,
  streetMidpoint,
  type OverpassJson,
} from '../../src/worlds/osm/simplify';

const raw = JSON.parse(readFileSync('tests/fixtures/osm-small.json', 'utf8')) as OverpassJson;
const simple = simplifyOverpass(raw, DEFAULT_CENTER_LITE, 'fixture');
const data = parseOsm(simple);

describe('bina yükseklik kuralları', () => {
  it('height etiketi önceliklidir', () => {
    expect(buildingHeights({ building: 'yes', height: '12 m', 'building:levels': '9' }).height).toBe(12);
  });
  it('kat × 3.1 + 1.0', () => {
    expect(buildingHeights({ building: 'apartments', 'building:levels': '6' }).height).toBeCloseTo(19.6);
  });
  it('zemin katta dükkan varsa +0.9', () => {
    expect(buildingHeights({ building: 'apartments', 'building:levels': '6' }, true).height).toBeCloseTo(
      20.5,
    );
  });
  it('türe göre varsayılan', () => {
    expect(buildingHeights({ building: 'yes' }).levels).toBe(5);
    expect(buildingHeights({ building: 'apartments' }).levels).toBe(5);
    expect(buildingHeights({ building: 'house' }).levels).toBe(2);
    expect(buildingHeights({ building: 'retail' }).levels).toBe(2);
    expect(buildingHeights({ building: 'school' }).levels).toBe(3);
    expect(buildingHeights({ building: 'garage' }).levels).toBe(1);
  });
  it('min_height ve building:min_level', () => {
    expect(buildingHeights({ building: 'yes', min_height: '5', height: '15' }).minHeight).toBe(5);
    const p = buildingHeights({ 'building:part': 'yes', 'building:levels': '10', 'building:min_level': '3' });
    expect(p.minHeight).toBeCloseTo(9.3);
    expect(p.height).toBeCloseTo(32);
  });
  it('eğik çatı yüksekliği duvar üstünün üzerine eklenir', () => {
    const h = buildingHeights({ building: 'house', 'roof:shape': 'gabled' });
    expect(h.roofShape).toBe('gabled');
    expect(h.height - h.wallTop).toBeCloseTo(2.5);
  });
  it('uzunluk ayrıştırma', () => {
    expect(parseLength('7,5')).toBe(7.5);
    expect(parseLength('10 ft')).toBeCloseTo(3.048);
    expect(parseLength('abc')).toBeNull();
  });
});

describe('OSM ayrıştırma', () => {
  it('multipolygon halkaları birleştirilir ve delik korunur', () => {
    const b = data.buildings.find((x) => x.id === 'r5001')!;
    expect(b).toBeTruthy();
    expect(b.holes.length).toBe(1);
    // avlu içi binanın parçası değil
    const hx = (b.holes[0][0][0] + b.holes[0][2][0]) / 2;
    const hz = (b.holes[0][0][1] + b.holes[0][2][1]) / 2;
    expect(pointInPolygon(hx, hz, b.outer, b.holes)).toBe(false);
  });

  it('parçalı way dizileri halkaya dikilir', () => {
    const rings = stitchRings([
      [
        [0, 0],
        [10, 0],
      ],
      [
        [10, 10],
        [10, 0],
      ],
      [
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ]);
    expect(rings.length).toBe(1);
    expect(rings[0].length).toBe(5);
  });

  it('building:part varsa ana bina çizilmez', () => {
    const main = data.buildings.find((b) => b.name === 'Parçalı Bina');
    expect(main).toBeUndefined();
    expect(data.buildings.filter((b) => b.isPart).length).toBe(2);
    expect(data.pois.some((p) => p.name === 'Parçalı Bina')).toBe(true);
  });

  it('dükkanlı binaların zemin katı yükseltilir', () => {
    const b = data.buildings.find((x) => x.name === 'Test Çarşısı')!;
    expect(b.height).toBeCloseTo(2 * 3.1 + 1 + 0.9);
  });

  it('yollar, isimler, kaldırımlar', () => {
    const s = data.roads.find((r) => r.name === '502. Sokak')!;
    expect(s.width).toBe(6.5);
    expect(s.sidewalkLeft && s.sidewalkRight).toBe(true);
    const b = data.roads.find((r) => r.name === 'Uğur Mumcu Bulvarı')!;
    expect(b.width).toBeCloseTo(12.8);
    const fw = data.roads.find((r) => r.kind === 'footway')!;
    expect(fw.sidewalkLeft).toBe(false);
    expect(roadWidth({ highway: 'service', width: '3' })).toBe(3);
  });

  it('raylar, köprü, istasyon, ağaçlar, alanlar', () => {
    expect(data.rails.length).toBe(3);
    expect(data.rails.some((r) => r.bridge)).toBe(true);
    expect(data.pois.some((p) => p.name === 'Özlüce')).toBe(true);
    expect(data.trees.length).toBeGreaterThan(10);
    expect(data.treeRows.length).toBe(1);
    expect(data.areas.map((a) => a.kind)).toEqual(
      expect.arrayContaining(['park', 'pitch', 'playground', 'parking', 'wood', 'water', 'residential']),
    );
    expect(data.barriers.length).toBe(2);
    expect(data.crossings.length).toBe(1);
  });

  it('sokak orta noktası (uzunluk-orta)', () => {
    const mid = streetMidpoint(raw, DEFAULT_CENTER_LITE, '502. Sokak')!;
    expect(mid).toBeTruthy();
    // 502. Sokak x ∈ [−150, 160] → orta nokta x ≈ 5
    const dLon =
      (mid.lon - DEFAULT_CENTER_LITE.lon) * Math.cos((DEFAULT_CENTER_LITE.lat * Math.PI) / 180) * 111319.49;
    expect(dLon).toBeCloseTo(5, 0);
  });
});
