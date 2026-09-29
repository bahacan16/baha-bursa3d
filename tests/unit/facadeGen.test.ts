import { describe, expect, it } from 'vitest';
import { Builder } from '../../src/worlds/mertkent/builder';
import {
  balFront,
  buildFacadeBlock,
  frontOff,
  type CBal,
  type CItem,
  type CompiledBlock,
} from '../../src/worlds/mertkent/facade';
import { buildGenericFence, buildWroughtGate } from '../../src/worlds/mertkent/fenceGeneric';

type Bucket = { pos: number[]; idx: number[] };
const buckets = (b: Builder) => (b as unknown as { buckets: Map<string, Bucket> }).buckets;
/** Kovadaki köşelerin sınır kutusu */
function bbox(bk: Bucket | undefined) {
  const r = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  if (!bk) return r;
  for (let i = 0; i < bk.pos.length; i += 3) {
    r.x0 = Math.min(r.x0, bk.pos[i]);
    r.x1 = Math.max(r.x1, bk.pos[i]);
    r.y0 = Math.min(r.y0, bk.pos[i + 1]);
    r.y1 = Math.max(r.y1, bk.pos[i + 1]);
    r.z0 = Math.min(r.z0, bk.pos[i + 2]);
    r.z1 = Math.max(r.z1, bk.pos[i + 2]);
  }
  return r;
}

// Kenar 0: (0,0)→(0,8), dış normal −x; bina x ∈ [0,10]
const block = (items0: CItem[], roof: Partial<CompiledBlock['roof']> = {}): CompiledBlock => ({
  id: 1,
  name: null,
  ring: [
    [0, 0],
    [0, 8],
    [10, 8],
    [10, 0],
  ],
  storeys: 4,
  floorH: 3,
  groundRaise: 0.5,
  roof: { kind: 'flat', eave: 0.3, fasciaH: 0.3, ...roof },
  colors: {},
  edges: [
    { edge: 0, len: 8, seen: 'photo', items: items0 },
    { edge: 1, len: 10, seen: 'photo', items: [] },
    { edge: 2, len: 8, seen: 'photo', items: [] },
    { edge: 3, len: 10, seen: 'photo', items: [] },
  ],
});
const run = (blk: CompiledBlock) => {
  const b = new Builder();
  buildFacadeBlock(b, blk, 0, { seed: 1, colorKey: (k, h) => `cc_${k}_${h}` });
  return buckets(b);
};

describe('cephe üreticisi — yeni öğeler', () => {
  it('pilastır duvardan d kadar çıkar, kat aralığını kaplar', () => {
    const bk = run(
      block([
        {
          t: 'pilaster',
          u0: 2,
          u1: 2.4,
          y0: null,
          y1: null,
          storeys: [1, 2],
          d: 0.08,
          color: '#aabbcc',
        },
      ]),
    );
    const r = bbox(bk.get('cc_plaster_#aabbcc'));
    expect(r.x0).toBeCloseTo(-0.085, 2);
    expect(r.y0).toBeCloseTo(3.5, 5); // floorY(1) = 0.5 + 3
    expect(r.y1).toBeCloseTo(9.5, 5); // floorY(3)
    expect(r.z0).toBeCloseTo(2, 5);
  });

  it('alınlık: asimetrik tepe, verilen yükseklik', () => {
    const bk = run(
      block([
        {
          t: 'pediment',
          u0: 1,
          u1: 7,
          apex: 5,
          y: 12.62,
          top: null,
          h: 1.5,
          d: 0,
          depth: 0.5,
          color: '#c0c4c6',
        },
      ]),
    );
    const g = bk.get('cc_plaster_#c0c4c6')!;
    const r = bbox(g);
    expect(r.y1).toBeCloseTo(12.62 + 1.5 + 0.01, 2);
    // Tepe noktası z = 5'te
    let zTop = 0;
    for (let i = 0; i < g.pos.length; i += 3) if (g.pos[i + 1] > 14.1) zTop = g.pos[i + 2];
    expect(zTop).toBeCloseTo(5, 3);
  });

  it('girinti: içindeki pencere arka duvara taşınır, ağız duvarda boş', () => {
    const win: CItem = {
      t: 'win',
      u0: 3,
      u1: 4,
      sill: 0.9,
      head: 2.2,
      storeys: [1],
      kind: 'std',
      rail: false,
      split: 2,
      box: false,
      curt: { '1': 'tul' },
    };
    const rec: CItem = {
      t: 'recess',
      u0: 2.5,
      u1: 5,
      y0: null,
      y1: null,
      storeys: [1, 2],
      depth: 1.5,
      back: '#445566',
      side: null,
      ceil: null,
      floor: null,
    };
    const bk = run(block([win, rec]));
    const glass = bbox(bk.get('mkGlass'));
    // Arka duvar x = +1.5 (içeri); cam arka duvarın söve derinliğinde
    expect(glass.x0).toBeGreaterThan(1.3);
    const back = bbox(bk.get('cc_plaster_#445566'));
    expect(back.x1).toBeCloseTo(1.5, 5);
    // Ön duvarda ağız: mkPlaster (x = 0) yüzlerinin hiçbiri ağzın ortasını örtmez
    const pl = bk.get('mkPlaster')!;
    for (let i = 0; i < pl.idx.length; i += 3) {
      const v = [0, 1, 2].map((k) => pl.idx[i + k] * 3);
      if (!v.every((o) => Math.abs(pl.pos[o]) < 1e-6)) continue;
      const zs = v.map((o) => pl.pos[o + 2]);
      const ys = v.map((o) => pl.pos[o + 1]);
      const zc = (Math.min(...zs) + Math.max(...zs)) / 2;
      const yc = (Math.min(...ys) + Math.max(...ys)) / 2;
      const inMouth = zc > 2.6 && zc < 4.9 && yc > 3.6 && yc < 9.3;
      expect(inMouth).toBe(false);
    }
  });

  it('bodrum penceresi (K−1) zemin kat döşemesinin altında, subasman kesilir', () => {
    const bk = run(
      block([
        {
          t: 'win',
          u0: 1,
          u1: 2,
          sill: 2.7,
          head: 3.2,
          storeys: [-1],
          kind: 'small',
          rail: false,
          split: 1,
          box: false,
        },
      ]),
    );
    const glass = bbox(bk.get('mkGlass'));
    expect(glass.y0).toBeCloseTo(0.5 - 3 + 2.7, 5);
    expect(glass.y1).toBeCloseTo(0.5 - 3 + 3.2, 5);
    // Subasman (mkPlinth) pencere önünde kesik: hiçbir üçgen pencere ortasını (z 1.5, y 0.45) örtmez
    const pl = bk.get('mkPlinth')!;
    for (let t = 0; t < pl.idx.length; t += 3) {
      const v = [0, 1, 2].map((k) => pl.idx[t + k] * 3);
      if (!v.every((o) => pl.pos[o] < 0)) continue;
      const zc = v.reduce((a, o) => a + pl.pos[o + 2], 0) / 3;
      const yc = v.reduce((a, o) => a + pl.pos[o + 1], 0) / 3;
      expect(zc > 1.1 && zc < 1.9 && yc > 0.25 && yc < 0.65).toBe(false);
    }
  });

  it('boru rengi / kalınlığı / kot aralığı', () => {
    const bk = run(block([{ t: 'pipe', u: 4, off: 0.05, color: '#d9d9d6', r: 0.03, y0: 0, y1: 4 }]));
    const r = bbox(bk.get('cc_frame_#d9d9d6'));
    expect(r.y0).toBeCloseTo(0, 5);
    expect(r.y1).toBeCloseTo(4, 5);
    expect(r.x1 - r.x0).toBeLessThan(0.1);
    expect(bk.has('mkPipe')).toBe(false);
  });

  it('lamelli alın: lamel sayısı kadar kutu', () => {
    const bk = run(
      block([
        {
          t: 'band',
          u0: 0,
          u1: 8,
          y0: 3.1,
          y1: 3.9,
          color: '#3b4e51',
          proud: 0.1,
          style: 'louvre',
          slats: 5,
          shade: '#293c43',
        },
      ]),
    );
    // 5 lamel × 24 köşe + 2 yan + 1 üst kapak
    expect(bk.get('cc_plaster_#3b4e51')!.pos.length / 3).toBe(5 * 24 + 3 * 24);
    expect(bk.has('cc_plaster_#293c43')).toBe(true);
  });

  it('kepenk: lamelli ölçülü renk, beyaz kutu çizilmez', () => {
    const bk = run(
      block([
        {
          t: 'win',
          u0: 1,
          u1: 3,
          sill: 0.05,
          head: 2.4,
          storeys: [0],
          kind: 'door',
          rail: false,
          split: 1,
          box: true,
          shut: { '0': 1 },
          shutC: '#5a5e62',
        },
      ]),
    );
    expect(bk.has('cc_shutter_#5a5e62')).toBe(true);
    const fr = bbox(bk.get('mkFrame'));
    // Kasa çubukları var, ama açıklığın üstünde (y1 + 0.1) kutu yok
    expect(fr.y1).toBeLessThanOrEqual(0.5 + 2.4 + 1e-6);
  });

  it('çatı parapeti kenar bazında + korkuluk yüksekliği', () => {
    const bk = run(
      block([], {
        parapet: { h: 0.6, color: '#777777', rail: 'tube', railH: 0.6, edges: [0, 1], railEdges: [0] },
      }),
    );
    const par = bbox(bk.get('cc_plaster_#777777'));
    // Parapet yalnız kenar 0 (x=0) ve 1 (z=8) üzerinde: x ∈ [−0.02, 10], z yalnız ~8 civarı ya da x ≈ 0
    const g = bk.get('cc_plaster_#777777')!;
    for (let i = 0; i < g.pos.length; i += 3) {
      const x = g.pos[i];
      const z = g.pos[i + 2];
      expect(x < 0.3 || z > 7.7).toBe(true);
    }
    expect(par.y1).toBeCloseTo(12.62 + 0.6 + 0.04, 2);
    // Korkuluk (mkRail) yalnız kenar 0, üst küpeşte ≈ 0.6 m
    const rail = bbox(bk.get('mkRail'));
    expect(rail.x1).toBeLessThan(0.2);
    expect(rail.y1).toBeLessThan(12.62 + 0.6 + 0.66);
  });

  it('kavisli balkon ön yüzü: ortada d + bulge, uçlar yuvarlak', () => {
    const it0: CBal = {
      t: 'bal',
      u0: 1,
      u1: 7,
      d: 1.2,
      storeys: [1, 2],
      glazed: [],
      tint: {},
      cap: false,
      sides: 'open',
      bulge: 0.4,
      round: 0.3,
    };
    expect(frontOff(it0, 4)).toBeCloseTo(1.6, 5);
    expect(frontOff(it0, 1)).toBeCloseTo(0.9, 5);
    const pts = balFront(it0);
    expect(pts[0][0]).toBeCloseTo(7, 5);
    expect(pts[pts.length - 1][0]).toBeCloseTo(1, 5);
    const bk = run(block([it0]));
    const slabTop = bbox(bk.get('mkSlabTop'));
    expect(slabTop.x0).toBeCloseTo(-1.6, 2);
    // d = 0 + bulge: duvardan duvara yay, loca sayılmaz (döşeme taşar)
    const bk2 = run(block([{ ...it0, d: 0, bulge: 0.9, round: 0 }]));
    expect(bbox(bk2.get('mkSlabTop')).x0).toBeCloseTo(-0.9, 2);
  });
});

describe('çit üreticisi — yeni öğeler', () => {
  const mat = (k: string, c: string) => `gf_${k}_${c}`;
  it('kabartmalı panel + süslü kolon + 2D tel panel dikmeleri', () => {
    const b = new Builder();
    buildGenericFence(
      b,
      {
        kind: 'other',
        pts: [
          [0, 0],
          [8, 0],
        ],
        wall: { h: 1.0, color: '#8f96a0', relief: { panel: 2, motif: 'rhombus', color: '#a0a7b0' } },
        pillars: { every: 4, w: 0.4, h: 1.8, style: 'ornate', finial: 'ball', color: '#8f96a0' },
        infill: 'panel',
        infillSpec: { h: 1.0, color: '#2f4a36', type: '2D tel panel' },
        hedge: { h: 1.2, style: 'scattered', gap: 1.5 },
      },
      () => 0,
      mat,
      [],
    );
    const bk = buckets(b);
    expect(bk.has('gf_render_#a0a7b0')).toBe(true);
    expect(bk.has('gf_welded_#2f4a36')).toBe(true);
    expect(bk.has('boxwood')).toBe(true);
    expect(bk.has('mkHedge')).toBe(false);
    // 4 panel × (4 çerçeve + 4 baklava) kutu
    expect(bk.get('gf_render_#a0a7b0')!.pos.length / 3).toBe(4 * 8 * 24);
  });

  it('ferforje yaya kapısı: mızrak uçlu çubuklar', () => {
    const b = new Builder();
    buildWroughtGate(b, [0, 0], [0, 1], 0, 1.4, 1.8, mat, {});
    const bk = buckets(b);
    expect(bk.has('gf_metal_#1c1d1f')).toBe(true);
    expect(bk.has('ironScroll')).toBe(true);
    expect(bbox(bk.get('gf_metal_#1c1d1f')).y1).toBeGreaterThan(1.85);
  });
});
