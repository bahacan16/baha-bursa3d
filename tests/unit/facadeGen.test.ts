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

// ── Üretici v6 ──
import { footCollision } from '../../src/worlds/mertkent/facade';
import { splitMassing } from '../../src/worlds/mertkent/massing';
import { buildStreetPlan } from '../../src/worlds/mertkent/street';
import { buildPlanGate } from '../../src/worlds/mertkent/site';

type BucketA = Bucket & { aux: number[] | null };
const runB = (blk: CompiledBlock, extra: Partial<Parameters<typeof buildFacadeBlock>[3]> = {}) => {
  const b = new Builder();
  const res = buildFacadeBlock(b, blk, 0, {
    seed: 1,
    colorKey: (k, h) => `cc_${k}_${h}`,
    signFace: (s) => `sign_${s.side ? 'side' : 'face'}_${s.banner ?? ''}`,
    ...extra,
  });
  return { bk: buckets(b) as Map<string, BucketA>, res };
};
/** Kovadaki üçgen merkezleri */
const tris = (bk: Bucket | undefined) => {
  const out: [number, number, number][] = [];
  if (!bk) return out;
  for (let t = 0; t < bk.idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => bk.idx[t + k] * 3);
    out.push([0, 1, 2].map((c) => v.reduce((a, o) => a + bk.pos[o + c], 0) / 3) as [number, number, number]);
  }
  return out;
};
const WALL_TOP = 0.5 + 4 * 3 + 0.12; // 12.62
const win1 = (o: Partial<CWinT> = {}): CItem => ({
  t: 'win',
  u0: 3,
  u1: 4.2,
  sill: 0.9,
  head: 2.2,
  storeys: [1],
  kind: 'std',
  rail: false,
  split: 2,
  box: false,
  ...o,
});
type CWinT = Extract<CItem, { t: 'win' }>;
const bal1 = (o: Partial<CBal> = {}): CBal => ({
  t: 'bal',
  u0: 1,
  u1: 7,
  d: 1.2,
  storeys: [1, 2],
  glazed: [],
  tint: {},
  cap: false,
  sides: 'open',
  ...o,
});

describe('cephe üreticisi v6', () => {
  it('perde rengi / kapanma oranı cam aux verisine kodlanır', () => {
    const { bk } = runB(block([win1({ curt: { '1': 'tul-yan' }, curtC: { '1': '#627699' }, curtF: { '1': 0.9 } })]));
    const g = bk.get('mkGlass')!;
    const aux = g.aux!;
    // İlk cam dörtgeni: [tohum, tür, en, boy]
    const [sd, kd] = [aux[0], aux[1]];
    expect(sd).toBeLessThan(0);
    const v = -sd - 1;
    expect(Math.floor((v + 0.5) / 100) / 20).toBeCloseTo(0.9, 5);
    const code = Math.floor((kd + 0.5) / 10) - 1;
    expect(kd - (code + 1) * 10).toBe(1); // tul-yan
    const q = (x: number) => Math.round((x / 255) * 63);
    expect(code).toBe((q(0x62) << 12) | (q(0x76) << 6) | q(0x99));
    // Ölçülmemiş pencere eski kodlamada (tohum ≥ 0, tür < 10)
    const { bk: bk2 } = runB(block([win1({ curt: { '1': 'tul' } })]));
    expect(bk2.get('mkGlass')!.aux![0]).toBeGreaterThanOrEqual(0);
    expect(bk2.get('mkGlass')!.aux![1]).toBe(0);
  });

  it('alınlık: cephe düzleminde, ölçülen renkte, pano alınlık eğimine kırpılır, çatı arası penceresi açılır', () => {
    const blk = block(
      [
        { t: 'panel', u0: 0, u1: 8, y0: 9.5, y1: 20, color: '#aabbcc', proud: 0 },
        win1({ u0: 3.4, u1: 4.6, sill: 0.4, head: 1.4, storeys: [4] }),
      ],
      { kind: 'gable', pitch: 30, gables: [0, 2], gableC: { '0': '#bcc3c4' } } as never,
    );
    const { bk } = runB(blk);
    const gab = bk.get('cc_plaster_#bcc3c4')!;
    expect(gab).toBeTruthy();
    // Alınlık duvarı x = 0 (cephe düzlemi, taşmasız)
    for (let i = 0; i < gab.pos.length; i += 3) expect(Math.abs(gab.pos[i])).toBeLessThan(1e-6);
    // Pano: saçak üstünde alınlık eğimine kırpılmış (tepe ≈ saçak + 4·tan30 ≈ +2.3, 20'ye çıkmaz)
    const pan = bbox(bk.get('cc_plaster_#aabbcc'));
    expect(pan.y1).toBeGreaterThan(WALL_TOP + 1.5);
    expect(pan.y1).toBeLessThan(WALL_TOP + 3.2);
    // Çatı arası penceresi (k = 4 = storeys) alınlıkta
    const gl = bbox(bk.get('mkGlass'));
    expect(gl.y0).toBeGreaterThan(WALL_TOP);
    // Kenar 0'da saçak alnı bandı yok: mkPlaster2 x ≈ −0.02 düzleminde saçak kotunda yüz yok
    for (const c of tris(bk.get('mkPlaster2'))) expect(Math.abs(c[0] + 0.02) < 1e-3 && c[1] > WALL_TOP - 0.1).toBe(false);
  });

  it('üçgen alınlıkta çatı arası penceresi: delikli ön yüz + pencere', () => {
    const { bk } = runB(
      block([
        { t: 'pediment', u0: 1, u1: 7, apex: 4, y: null, top: null, h: 2.5, d: 0, depth: 0.5, color: '#c0c4c6' },
        win1({ u0: 3.5, u1: 4.5, sill: 0.3, head: 1.3, storeys: [4] }),
      ]),
    );
    const gl = bbox(bk.get('mkGlass'));
    expect(gl.y0).toBeGreaterThan(WALL_TOP + 0.1);
    expect(gl.z0).toBeGreaterThan(3.4);
    // Ön yüz üçgenlenmiş (delikli): 2 × (3 + 4) köşe (iki yüz) + eğik yüzler
    expect(bk.get('cc_plaster_#c0c4c6')!.pos.length / 3).toBeGreaterThan(14);
  });

  it('dormer: çatı yüzüne oturur, tepe ridge kotunda, pencereli', () => {
    const { bk } = runB(
      block(
        [
          {
            t: 'dormer',
            u0: 3,
            u1: 5.3,
            setback: 1.5,
            ridge: 1.2,
            h: null,
            wallH: null,
            pitch: 40,
            color: '#f1f1ee',
            roofC: 'tile',
            trim: null,
            win: { w: 1.0, h: 0.8 },
          },
        ],
        { kind: 'hipped', pitch: 35 },
      ),
    );
    const w = bbox(bk.get('cc_plaster_#f1f1ee'));
    expect(w.y1).toBeCloseTo(WALL_TOP + 1.2, 1);
    // Ön yüz duvardan 1.5 m geride (x = +1.5)
    expect(w.x0).toBeGreaterThan(1.4);
    expect(bk.has('mkGlass')).toBe(true);
    expect(bk.has('mkTile')).toBe(true);
  });

  it('kemerli parapet + tonoz: tepe rise kotunda, içinde çatı arası penceresi', () => {
    const { bk } = runB(
      block([
        {
          t: 'arch',
          u0: 1,
          u1: 7,
          y: null,
          rise: 2,
          top: null,
          spring: 0.5,
          d: 0,
          shape: 'segment',
          thick: 0.25,
          color: '#6b4a3e',
          coping: { h: 0.25, color: '#5a3a2e' },
          vault: 3,
          roofC: '#7a5a4a',
        },
        win1({ u0: 3.4, u1: 4.6, sill: 0.4, head: 1.4, storeys: [4] }),
      ]),
    );
    const a = bbox(bk.get('cc_plaster_#6b4a3e'));
    expect(a.y1).toBeCloseTo(WALL_TOP + 2, 1);
    expect(bk.has('cc_plaster_#7a5a4a')).toBe(true); // tonoz yüzü
    expect(bk.has('cc_frame_#5a3a2e')).toBe(true); // harpuşta
    expect(bbox(bk.get('mkGlass')).y0).toBeGreaterThan(WALL_TOP);
  });

  it('cam balkon: kemerli parmaklık, perde rengi, dikme aralığı / rengi', () => {
    const { bk } = runB(
      block([
        bal1({
          storeys: [1],
          glazed: [1],
          railC: '#c9cdcf',
          rail: { '*': 'glass' },
          grille: { '1': 'arched' },
          grilleC: '#2f3438',
          curtC: { '1': '#8a4a33' },
          curtF: { '1': 0.4 },
          postEvery: 1.0,
        }),
      ]),
    );
    expect(bk.has('cc_metal_#2f3438')).toBe(true);
    const cg = bk.get('mkCamGlass')!;
    expect(cg.aux![2]).toBeGreaterThan(0.5);
    expect(cg.aux![3]).toBeCloseTo(0.4, 5);
    // Cam korkuluk yok (glazed) → açık balkon: dikmeler railC renginde, ~1 m arayla
    const { bk: bk2 } = runB(block([bal1({ storeys: [1], railC: '#c9cdcf', rail: { '*': 'glass' }, postEvery: 1.0 })]));
    const posts = bk2.get('cc_metal_#c9cdcf')!;
    // Ön kenar 6 m → 7 dikme + iki yan 1.2 m → 2 + 2; her kutu 24 köşe, + küpeşteler (3 × 24)
    expect(posts.pos.length / 3).toBe((7 + 2 + 2) * 24 + 3 * 24);
    expect(bk2.has('mkRail')).toBe(false);
  });

  it('spotlar, dolu parapet küpeştesi + harpuşta, bambu stor, saksı çiçekleri', () => {
    const { bk } = runB(
      block([
        bal1({
          storeys: [1, 2],
          spots: { n: 3, d: 0.1 },
          rail: { '*': 'solid' },
          parapetH: { '*': 0.95 },
          hand: { '*': 0.04 },
          coping: { '*': { h: 0.09, color: '#2e3440' } },
          railC: '#8aacc6',
          blinds: { '2': '#b08a5f' },
          pots: { '1': [4] },
          flowerC: ['#d02040', '#f0e030'],
        }),
      ]),
    );
    // Spot: K1 ve K2 döşemelerinin altında 3'er (K1 döşemesi = K0 tavanı → k>0 koşulu: 2 kat)
    expect(bk.get('mkDownlight')!.pos.length / 3).toBe(2 * 3 * 13);
    expect(bk.has('cc_frame_#2e3440')).toBe(true);
    // Küpeşte parapet + harpuşta üstünde
    const hand = bbox(bk.get('cc_metal_#8aacc6'));
    expect(hand.y1).toBeGreaterThan(3.5 + 0.95 + 0.09);
    expect(bk.has('cc_blind_#b08a5f')).toBe(true);
    expect(bk.has('cc_awning_#d02040')).toBe(true);
  });

  it('eğik şapka: üst yüz eğimli, kalınlık ve renk ölçülen', () => {
    const { bk } = runB(
      block([bal1({ storeys: [2, 3], cap: true, capC: '#cbccc6', capH: 1.0, capSlope: { dir: 'u0', pitch: 25 } })]),
    );
    const top = bk.get('cc_plaster_#cbccc6')!;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let i = 1; i < top.pos.length; i += 3) {
      ymin = Math.min(ymin, top.pos[i]);
      ymax = Math.max(ymax, top.pos[i]);
    }
    // Şapka tabanı floorY(4) − 0.12, alçak uç + 1.0, yüksek uç + genişlik·tan25
    expect(ymin).toBeCloseTo(12.5 - 0.12, 2);
    expect(ymax - ymin).toBeGreaterThan(1.0 + 6 * 0.4);
  });

  it('aplik (kat aralığında), kubbe kamera, direk tepesi levha, sivri şerit ucu', () => {
    const { bk } = runB(
      block([
        {
          t: 'lamp',
          us: [2],
          y: null,
          yRel: 2.3,
          storeys: [1, 2, 3],
          style: 'cylinder',
          d: 0.12,
          h: 0.25,
          proud: 0.12,
          color: null,
          tip: null,
          dir: 'down',
        },
        { t: 'camera', u: 5, s: 1, y: null, onBal: false, style: 'dome' },
        {
          t: 'mast',
          u: 6,
          off: 0.3,
          y0: 13,
          h: 1.5,
          color: '#333333',
          flag: null,
          top: { kind: 'disc', d: 1.4, color: '#2c2e30' },
        },
        { t: 'strip', u: 1, w: 0.3, y0: 1, y1: 9, top: 'point' },
      ]),
    );
    // 3 kat × aşağı bakan ışık diski
    expect(bk.get('wallLamp')!.idx.length / 3).toBe(3 * 12);
    expect(bk.has('darkMetal')).toBe(true);
    expect(bbox(bk.get('cc_metal_#2c2e30')).y1).toBeCloseTo(13 + 1.5 + 0.7, 2);
    // Sivri uç: şerit tepesi y1'de tek nokta (koni)
    const st = bk.get('mkStrip')!;
    let top = -Infinity;
    for (let i = 1; i < st.pos.length; i += 3) top = Math.max(top, st.pos[i]);
    expect(top).toBeCloseTo(9, 5);
  });

  it('subasman yok (plinthH 0); lamelli alın pencereyi kesmez', () => {
    const blk = {
      ...block([
        win1({ u0: 3, u1: 5, sill: 0.1, head: 2.2, storeys: [0] }),
        {
          t: 'band',
          u0: 0,
          u1: 8,
          y0: 1.2,
          y1: 2.0,
          color: '#3b4e51',
          proud: 0.1,
          style: 'louvre',
          slats: 4,
          shade: '#293c43',
        } as CItem,
      ]),
      plinthH: 0,
    };
    const { bk } = runB(blk);
    expect(bk.has('mkPlinth')).toBe(false);
    // Lamel üçgenlerinin hiçbiri pencere aralığında (z 3..5) değil
    for (const c of tris(bk.get('cc_plaster_#3b4e51'))) expect(c[2] > 3.05 && c[2] < 4.95 && c[1] < 2.0).toBe(false);
  });

  it('zemine inen girinti ağzı çarpışma halkasından çıkarılır', () => {
    const { res } = runB(
      block([
        {
          t: 'recess',
          u0: 2,
          u1: 5,
          y0: 0,
          y1: 3,
          storeys: null,
          depth: 1.5,
          back: null,
          side: null,
          ceil: null,
          floor: null,
        },
      ]),
    );
    expect(res.holes.length).toBe(1);
    const rings = footCollision(
      [
        [0, 0],
        [0, 8],
        [10, 8],
        [10, 0],
      ],
      res.holes,
    );
    const area = (r: [number, number][]) =>
      Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
    expect(area(rings[0])).toBeCloseTo(80 - 3 * 1.5, 1);
  });

  it('ek hacim: ters çokgende cam doğru kenarda, pencere ve beşik çatı', () => {
    // Saat yönü tersine (pozitif alan) çokgen: kenar 0 = (0,−5)→(4,−5), kuzey (z −5) yüzü
    const blk: CompiledBlock = {
      ...block([]),
      volumes: [
        {
          poly: [
            [0, -5],
            [4, -5],
            [4, -1],
            [0, -1],
          ],
          y0: 0,
          y1: 3,
          color: '#dddddd',
          glazing: { edges: [0], from: 0.5, to: 2.5, mullion: 1, glass: '#223344', frame: '#111111' },
          wins: [{ edge: 2, u0: 1, u1: 2, y0: 1, y1: 2.2 }],
          roof: { kind: 'gable', pitch: 30, gables: [1, 3], color: '#884422' },
        },
      ],
    };
    const { bk } = runB(blk);
    const gl = bbox(bk.get('cc_tint_#223344'));
    expect(gl.z0).toBeCloseTo(-5, 1);
    expect(gl.z1).toBeCloseTo(-5, 1);
    expect(bbox(bk.get('mkGlass')).z0).toBeCloseTo(-1 + 0.1, 1);
    expect(bbox(bk.get('cc_plaster_#884422')).y1).toBeGreaterThan(3 + 2 * 0.5);
  });

  it('parapet yalnız bazı kenarlarda: diğer kenarlarda saçak taşması', () => {
    const { bk } = runB(block([], { parapet: { h: 1.2, color: '#777777', edges: [0] }, eave: 0.8, fasciaH: 0.3 }));
    const so = bbox(bk.get('mkSoffit'));
    // Kenar 0 (x = 0) parapetli: saçak altı orada taşmaz; kenar 2 (x = 10) tarafında 0.8 m taşar
    expect(so.x0).toBeGreaterThan(-0.1);
    expect(so.x1).toBeCloseTo(10.8, 1);
  });

  it('pah (Yüksek kalite): denizlik ve döşeme alnı pahlı, düşük kalitede değişmez', () => {
    const blk = block([win1(), bal1({ storeys: [1] })]);
    const a = runB(blk).bk;
    const c = runB(blk, { bevel: 0.015 }).bk;
    expect(c.get('mkSill')!.pos.length).toBeGreaterThan(a.get('mkSill')!.pos.length);
    expect(runB(blk, { bevel: 0 }).bk.get('mkSill')!.pos).toEqual(a.get('mkSill')!.pos);
    const b = new Builder();
    b.bevelBox('k', [0, 0, 0], [1, 0.2, 0.3], 0, 0.02);
    expect(buckets(b).get('k')!.idx.length / 3).toBe(20);
  });

  it('kütle bölünmesi: kesimi aşan tabela bir kez, ek hacim tek parçada', () => {
    const blk: CompiledBlock = {
      ...block([
        {
          t: 'sign',
          u0: 3,
          u1: 6,
          y0: 3,
          y1: 3.6,
          d: 0.1,
          text: 'X',
          bg: '#ffffff',
          fg: '#000000',
          border: null,
          style: 'box',
          font: 'sans',
          bold: true,
          lit: false,
        },
      ]),
      // Kenar 0 x = 0 boyunca (z 0..8); z = 5'te kesim
      massing: { towers: [{ z: [-1, 5] }, { z: [5, 9] }] },
      volumes: [
        {
          poly: [
            [2, 1],
            [4, 1],
            [4, 3],
            [2, 3],
          ],
          y0: 13,
          y1: 15,
          color: '#aaaaaa',
        },
      ],
    };
    const parts = splitMassing(blk);
    expect(parts.length).toBe(2);
    const signs = parts.flatMap((p) => p.edges.flatMap((e) => e.items.filter((it) => it.t === 'sign')));
    expect(signs.length).toBe(1);
    // Kırpılmamış
    expect((signs[0] as { u1: number }).u1 - (signs[0] as { u0: number }).u0).toBeCloseTo(3, 5);
    expect(parts.filter((p) => p.volumes?.length).length).toBe(1);
  });
});

describe('sokak / kapı üreticisi v6', () => {
  const ck = (k: string, h: string) => `cc_${k}_${h}`;
  it('yol yüzeyi: yama / çatlak / çukur / aşınma / dikme, geçit boyası aşınması', () => {
    const b = new Builder();
    buildStreetPlan(
      b,
      {
        street: [
          {
            kind: 'patch',
            x: 0,
            z: 0,
            poly: [
              [0, 0],
              [2, 0],
              [2, 1],
              [0, 1],
            ],
            color: '#505150',
          },
          {
            kind: 'crack',
            x: 0,
            z: 3,
            pts: [
              [0, 3],
              [3, 3.4],
            ],
            w: 0.03,
            sealed: true,
          },
          { kind: 'pothole', x: 5, z: 5, r: 0.3 },
          {
            kind: 'wear',
            x: 8,
            z: 0,
            poly: [
              [8, 0],
              [9, 0],
              [9, 3],
              [8, 3],
            ],
            amount: 0.5,
          },
          {
            kind: 'delineator',
            x: 0,
            z: 10,
            pts: [
              [0, 10],
              [4, 10],
            ],
            every: 1,
          },
          { kind: 'crossing', x: 20, z: 20, rot: 0, len: 4, w: 3, wear: 0.5 },
        ] as never,
      },
      () => 0,
      () => 5,
      { colorKey: ck as never },
    );
    const bk = buckets(b);
    const patch = bbox(bk.get('cc_asphalt_#505150'));
    expect(patch.y0).toBeCloseTo(0.044, 5);
    expect(bk.has('cc_tar_#2b2b2a')).toBe(true);
    expect(bk.has('cc_wear2_#8a8b88')).toBe(true);
    expect(bbox(bk.get('cc_wear2_#8a8b88')).y0).toBeGreaterThan(0.05);
    // 5 dikme × taban + gövde silindiri
    expect(bk.get('bollardOrange')!.pos.length / 3).toBe(5 * 8 * 4);
    expect(bk.has('spPaintWear2')).toBe(true);
    expect(bk.has('spPaint')).toBe(true); // dikme yansıtıcı bantları
  });

  it('portal kapı: kolonlar, kiriş üst kotu, kiriş yüzünde (3B) harfler, ayna; biçim her kapıda', () => {
    const mat = (k: string, c: string) => `gf_${k}_${c}`;
    const wrought = (b: Builder) => b.box('w_leaf', [0, 1, 0], [1, 1, 1]);
    const b = new Builder();
    buildPlanGate(
      b,
      {
        kind: 'vehicle',
        id: 'mk3-portal',
        c: [0, 0],
        n: [0, -1],
        w: 5.5,
        style: 'portal',
        pillars: { w: 0.95, color: '#4b4e4c' },
        beam: { top: 5.8, h: 1.1, color: '#4b4e4c' },
        text: { text: 'MERTKENT 3 SİTESİ', fg: '#ffffff', d: 0.03 },
        mirror: { side: 'left', h: 2.6 },
      },
      0,
      { mat, colorKey: ck as never, signFace: (s) => `sign_${s.side ? 'side' : 'face'}`, wrought },
    );
    const bk = buckets(b);
    expect(bbox(bk.get('cc_fascia_#4b4e4c')).y1).toBeCloseTo(0.05 + 5.8, 5);
    expect(bk.has('sign_face')).toBe(true);
    expect(bk.get('sign_side')!.pos.length / 4 / 3).toBeGreaterThanOrEqual(2);
    expect(bk.has('w_leaf')).toBe(true);
    expect(bk.has('bollardOrange')).toBe(true);
    // da* dışı yaya kapısı da biçimini alır (2D tel panel kanat)
    const b2 = new Builder();
    buildPlanGate(b2, { kind: 'pedestrian', id: 'sehri-ped', c: [0, 0], n: [1, 0], w: 1.5, style: 'panel', color: '#21382b' }, 0, {
      mat,
      colorKey: ck as never,
      wrought,
    });
    expect(buckets(b2).has('gf_welded_#21382b')).toBe(true);
  });

  it('serbest duvar (kind wall): dolgusuz, harpuştalı', () => {
    const b = new Builder();
    buildGenericFence(
      b,
      {
        kind: 'wall',
        pts: [
          [0, 0],
          [6, 0],
        ],
        wall: { h: 1.0, color: '#8f96a0' },
      },
      () => 0,
      (k, c) => `gf_${k}_${c}`,
      [],
    );
    const bk = buckets(b);
    expect(bk.has('gf_render_#8f96a0')).toBe(true);
    expect([...bk.keys()].some((k) => k.startsWith('gf_bars') || k.startsWith('gf_mesh'))).toBe(false);
  });
});
