import { describe, expect, it } from 'vitest';
import { parseSpecies, SPECIES, SPECIES_SIZE, speciesIndex } from '../../src/worlds/osm/species';
import {
  crownBaseRatio,
  fixedScale,
  FIXED_STRIDE,
  placeTrees,
  TREE_STRIDE,
  treesToPayload,
} from '../../src/worlds/osm/vegetation';
import { crownWidth } from '../../src/worlds/osm/eztree';
import { remapCrownBase, speciesModel, speciesModelCb } from '../../src/worlds/osm/treelib';
import * as THREE from 'three';

describe('ağaç türü ayrıştırma', () => {
  it('eski üç genel tür indeksi korunur', () => {
    expect(speciesIndex('deciduous')).toBe(0);
    expect(speciesIndex('conifer')).toBe(1);
    expect(speciesIndex('deciduous-oval')).toBe(2);
  });
  it('anahtar doğrudan kabul edilir', () => {
    for (const k of SPECIES) expect(parseSpecies(k)).toBe(k);
  });
  it('Türkçe / Latince / İngilizce adlar', () => {
    expect(parseSpecies('sedir')).toBe('cedrus');
    expect(parseSpecies('Cedrus deodara')).toBe('cedrus');
    expect(parseSpecies('palmiye')).toBe('trachycarpus');
    expect(parseSpecies('limoni servi')).toBe('goldcrest');
    expect(parseSpecies('Akdeniz servisi')).toBe('cupressus');
    expect(parseSpecies('mazı')).toBe('thuja');
    expect(parseSpecies('ıhlamur')).toBe('tilia');
    expect(parseSpecies('top akasya')).toBe('robinia-globe');
    expect(parseSpecies('akasya')).toBe('robinia');
    expect(parseSpecies('kan erik')).toBe('prunus-purple');
    expect(parseSpecies('şimşir')).toBe('boxwood');
    expect(parseSpecies('blue spruce')).toBe('picea-pungens');
    expect(parseSpecies('kavak')).toBe('deciduous-oval');
    expect(parseSpecies('pine')).toBe('conifer');
  });
  it('tür alanı ile not: daha belirli olan kazanır', () => {
    expect(parseSpecies('fruit', 'Yenidünya (Eriobotrya, iri deri yapraklı)')).toBe('eriobotrya');
    expect(parseSpecies('deciduous', 'fidan')).toBe('sapling');
    // Çekinceli / seçenekli not açık tür alanını ezmez (critic M2 #15)
    expect(parseSpecies('deciduous', 'Yapraklı ağaç (ıhlamur/kavak benzeri)')).toBe('deciduous');
    expect(parseSpecies('deciduous', 'ıhlamur veya kavak')).toBe('deciduous');
    // Notun ilk cümlesi tür ifadesi değilse (komşu ağaçtan söz) tür alanı kalır
    expect(parseSpecies('deciduous', 'Sokak ağacı. Arkasında ıhlamur sırası')).toBe('deciduous');
    // Tür ifadesi olan not inceltmeye devam eder
    expect(parseSpecies('conifer', 'Genç fıstık çamı (Pinus pinea görünüşü: şemsiye/yuvarlak taç)')).toBe('pinea');
    expect(parseSpecies('deciduous', 'Orta refüjde kazıklı genç ağaç (DIKa_0_0; hava)')).toBe('sapling');
    expect(parseSpecies(undefined, 'Yapraklı ağaç (ıhlamur/kavak benzeri)')).toBe('tilia');
    expect(parseSpecies(undefined, 'konik ardıç/servi (h 1.2–1.8)')).toBe('thuja');
    expect(parseSpecies('cedar', 'mavi ladin')).toBe('cedrus');
  });
  it('bilinmeyen metin genel yaprak dökene düşer', () => {
    expect(parseSpecies('', 'Kuzey şeritte koyu taçlı küçük ağaç')).toBe('deciduous');
    expect(parseSpecies(undefined, undefined)).toBe('deciduous');
  });
});

describe('ölçülmüş ağaç ölçeği', () => {
  it('boy ve taç yarıçapı türün başvuru boyuna göre', () => {
    const t = speciesIndex('cedrus');
    const { sxz, sy } = fixedScale(t, 10, 3.8);
    expect(sy).toBeCloseTo(10 / SPECIES_SIZE.cedrus.h);
    expect(sxz).toBeCloseTo(7.6 / SPECIES_SIZE.cedrus.w);
  });
  it('yalnız boy verilirse oran korunur, uç oranlar kırpılır', () => {
    const t = speciesIndex('thuja');
    const a = fixedScale(t, 1.6, 0);
    expect(a.sxz).toBeCloseTo(a.sy);
    const b = fixedScale(speciesIndex('cupressus'), 8, 6);
    expect(b.sxz).toBeLessThanOrEqual(b.sy * 1.7 + 1e-9);
  });
  it("fixedTrees türü ve ölçüsü payload'a geçer", () => {
    const F = [10, 20, speciesIndex('trachycarpus'), 3.6, 1.5, 0];
    expect(F.length).toBe(FIXED_STRIDE);
    const trees = placeTrees([], [], [], [], [], { maxTrees: 10, density: 1, fixedTrees: F });
    expect(trees).toHaveLength(1);
    expect(trees[0].type).toBe(speciesIndex('trachycarpus'));
    const p = treesToPayload(trees);
    expect(p.chunks[0].data.length).toBe(TREE_STRIDE);
    expect(p.chunks[0].data[3]).toBeCloseTo(3.6 / SPECIES_SIZE.trachycarpus.h);
  });
});

describe('taç genişliği ve taç tabanı (critic rb/b-05, v8)', () => {
  it('model görünen taç genişliği türün başvuru genişliğine eşit (sedir, ıhlamur, servi)', () => {
    for (const k of ['cedrus', 'tilia', 'deciduous', 'cupressus', 'thuja'] as const) {
      const w = crownWidth(speciesModel(k).near.leaves);
      expect(w / SPECIES_SIZE[k].w).toBeGreaterThan(0.93);
      expect(w / SPECIES_SIZE[k].w).toBeLessThan(1.07);
    }
  });
  it('ikisi de ölçülmüşse dar taç korunur', () => {
    // Genç sedir: h 8.5, r 2.2 → sxz = 4.4 / 7.6 (eskiden alt sınır 0.6 × sy'ye kırpılabiliyordu)
    const { sxz } = fixedScale(speciesIndex('cedrus'), 8.5, 2.2);
    expect(sxz * SPECIES_SIZE.cedrus.w).toBeCloseTo(4.4, 1);
    const p = fixedScale(speciesIndex('trachycarpus'), 4, 1.2);
    expect(p.sxz * SPECIES_SIZE.trachycarpus.w).toBeCloseTo(2.4, 1);
  });
  it('ölçülen crownBase örnek başına çeşit oranına çevrilir', () => {
    const t = speciesIndex('tilia');
    const F = [0, 0, t, 8, 2.8, 3.9, 5, 5, t, 8, 2.8, 0];
    const trees = placeTrees([], [], [], [], [], { maxTrees: 10, density: 1, fixedTrees: F });
    expect(trees[0].cb).toBeCloseTo(crownBaseRatio(3.9, trees[0].sy, SPECIES_SIZE.tilia.h));
    expect(trees[0].cb).toBeCloseTo(0.5, 5);
    expect(trees[1].cb).toBeUndefined();
    const p = treesToPayload(trees);
    expect(p.chunks.map((c) => c.cb).sort()).toEqual([0, 0.5]);
  });
  it('taç tabanı eşlemesi: gövde dibi ve tepe yerinde, taban hedefe', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 2, 0, 0, 8, 0], 3));
    const r = remapCrownBase(g, 2, 4, 8).attributes.position;
    expect([r.getY(0), r.getY(1), r.getY(2)]).toEqual([0, 4, 8]);
    const base = speciesModel('tilia');
    const v = speciesModelCb('tilia', 0.5);
    let minB = Infinity;
    let minV = Infinity;
    const pb = base.near.leaves.attributes.position;
    const pv = v.near.leaves.attributes.position;
    for (let i = 0; i < pb.count; i++) minB = Math.min(minB, pb.getY(i));
    for (let i = 0; i < pv.count; i++) minV = Math.min(minV, pv.getY(i));
    expect(minV).toBeGreaterThan(minB * 1.5);
    expect(speciesModelCb('tilia', 0)).toBe(base);
  });
});
