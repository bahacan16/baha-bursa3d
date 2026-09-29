import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Builder } from '../../src/worlds/mertkent/builder';
import {
  buildFacadeBlock,
  type CBal,
  type CItem,
  type CompiledBlock,
  type SignSpec,
} from '../../src/worlds/mertkent/facade';
import { SignAtlas } from '../../src/worlds/mertkent/signatlas';
import { wingGables, wingHeightAt } from '../../src/worlds/mertkent/roofWing';
import { buildStreetFurniture } from '../../src/worlds/mertkent/streetFurniture';
import { buildGenericFence } from '../../src/worlds/mertkent/fenceGeneric';

type Bucket = { pos: number[]; idx: number[]; uv: number[]; aux: number[] | null };
const buckets = (b: Builder) => (b as unknown as { buckets: Map<string, Bucket> }).buckets;
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

// Kenar 0: (0,0)→(0,8), dış normal −x (P(0, u, off) = (−off, u)); bina x ∈ [0,10]
const block = (
  items0: CItem[],
  roof: Partial<CompiledBlock['roof']> = {},
  extra: Partial<CompiledBlock> = {},
): CompiledBlock => ({
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
  ...extra,
});
const signs: SignSpec[] = [];
const run = (blk: CompiledBlock) => {
  const b = new Builder();
  signs.length = 0;
  buildFacadeBlock(b, blk, 0, {
    seed: 1,
    colorKey: (k, h) => `cc_${k}_${h}`,
    signFace: (s) => {
      signs.push(s);
      return `sign_${signs.length - 1}${s.side ? '_side' : ''}`;
    },
  });
  return buckets(b);
};
const bal = (o: Partial<CBal>): CBal => ({
  t: 'bal',
  u0: 2,
  u1: 6,
  d: 1.2,
  storeys: [1],
  glazed: [],
  tint: {},
  cap: false,
  sides: 'open',
  ...o,
});

describe('üretici v7 — hata düzeltmeleri', () => {
  it('#13 d ≥ 0.35 + inset: döşeme taban izinin inset içine ve d dışına uzanır', () => {
    const bk = run(block([bal({ d: 0.55, inset: 0.95 })]));
    const r = bbox(bk.get('mkSlabTop'));
    // Taşan kısım x = −0.55'e, loca x = +0.95'e (bina içi) kadar
    expect(r.x0).toBeCloseTo(-0.55, 2);
    expect(r.x1).toBeGreaterThan(0.9);
  });

  it('#7 sanal groundRaise: eşiği döşemenin altına inen K0 kapısı zemine iner', () => {
    const blk = block([
      {
        t: 'win',
        u0: 3,
        u1: 4.2,
        sill: -0.95,
        head: 2.2,
        storeys: [0],
        kind: 'door',
        rail: false,
        split: 1,
        box: false,
      },
    ]);
    blk.groundRaise = 1.0;
    const bk = run(blk);
    const r = bbox(bk.get('mkGlass'));
    expect(r.y0).toBeLessThan(0.1);
    expect(r.y0).toBeGreaterThan(0);
  });

  it('#1 hacim parapeti yalnız edges kenarlarında', () => {
    const vol = {
      poly: [
        [-4, 1],
        [-1, 1],
        [-1, 5],
        [-4, 5],
      ] as [number, number][],
      y0: 0,
      y1: 3,
      color: '#aa5533',
      parapet: { h: 0.5, color: '#112233', edges: [0] },
    };
    const all = run(block([], {}, { volumes: [{ ...vol, parapet: { h: 0.5, color: '#112233' } }] }));
    const one = run(block([], {}, { volumes: [vol] }));
    const nAll = all.get('cc_plaster_#112233')!.pos.length;
    const nOne = one.get('cc_plaster_#112233')!.pos.length;
    // 4 kenar × 3 yüz → 1 kenar × 3 yüz + 2 uç kapağı
    expect(nOne).toBeLessThan(nAll / 2);
    expect(nOne).toBeGreaterThan(0);
  });

  it('#2 girintinin içindeki bant arka duvarda', () => {
    const bk = run(
      block([
        {
          t: 'recess',
          u0: 2,
          u1: 6,
          y0: 3.5,
          y1: 9.5,
          storeys: null,
          depth: 1.1,
          back: null,
          side: null,
          ceil: null,
          floor: null,
        },
        { t: 'band', u0: 2.5, u1: 5.5, y0: 6.3, y1: 6.6, color: '#445566', proud: 0 },
      ]),
    );
    const r = bbox(bk.get('cc_plaster_#445566'));
    expect(r.x0).toBeGreaterThan(1.0); // arka duvar x ≈ 1.1 (−0.006 pay)
  });

  it('#8 gömük locadaki klima loca arka duvarında', () => {
    const bk = run(
      block([bal({ d: 0, inset: 1.4, storeys: [2] }), { t: 'ac', u: 3, s: 2, y: null, onBal: false }]),
    );
    const r = bbox(bk.get('mkAc'));
    expect(r.x0).toBeGreaterThan(1.0);
  });
});

describe('üretici v7 — yeni öğeler', () => {
  it('sivri kemer: tepe açıklığın √3/2 katı (rise verilmezse)', () => {
    const bk = run(
      block([
        {
          t: 'arch',
          u0: 2,
          u1: 6,
          y: 12.5,
          rise: null,
          top: null,
          spring: 0,
          d: 0,
          shape: 'pointed',
          thick: 0.2,
          color: '#fafafa',
          coping: null,
          vault: 0,
          roofC: null,
        },
      ]),
    );
    const r = bbox(bk.get('cc_plaster_#fafafa'));
    expect(r.y1).toBeCloseTo(12.5 + (4 * Math.sqrt(3)) / 2, 1);
  });

  it('yuvarlak pencere: cam elips üçgenleri, köşe dolguları duvarda', () => {
    const win: CItem = {
      t: 'win',
      u0: 3,
      u1: 4.8,
      sill: 0.5,
      head: 2.3,
      storeys: [2],
      kind: 'std',
      rail: false,
      split: 1,
      box: false,
      shape: 'round',
    };
    const bk = run(block([win]));
    const g = bk.get('mkGlass')!;
    // Elips: en çok 24 köşeli halka, üçgen dörtgenleri (dejenere) — kutu camı (4 köşe) değil
    expect(g.pos.length / 3).toBeGreaterThan(40);
    const r = bbox(g);
    expect(r.z0).toBeCloseTo(3, 1);
    expect(r.z1).toBeCloseTo(4.8, 1);
  });

  it('bayrak tabela: cepheye dik pano, iki yüz (A / B yazısı)', () => {
    const bk = run(
      block([
        {
          t: 'blade',
          u: 4,
          y0: 5,
          y1: 6,
          w: 0.8,
          gap: 0.2,
          d: 0.1,
          text: 'ECZANE',
          textB: 'NÖBETÇİ',
          bg: '#1b8a3a',
          fg: '#ffffff',
          border: null,
          font: 'sans',
          bold: true,
          lit: true,
        },
      ]),
    );
    expect(signs.map((s) => s.text)).toEqual(['ECZANE', 'NÖBETÇİ']);
    const box = bbox(bk.get('cc_fascia_#1b8a3a'));
    // Pano duvardan 0.2 m'den 1.0 m'ye (−x), cephe boyunca 0.1 m kalın
    expect(box.x0).toBeCloseTo(-1.0, 2);
    expect(box.x1).toBeCloseTo(-0.2, 2);
    expect(box.z1 - box.z0).toBeCloseTo(0.1, 2);
  });

  it('cam folyo: pencere camı düzleminde (−0.096)', () => {
    const bk = run(
      block([
        {
          t: 'vinyl',
          u0: 3,
          u1: 5,
          y0: 7,
          y1: 7.4,
          text: 'KİRALIK',
          bg: null,
          fg: '#d8231f',
          border: null,
          font: 'sans',
          bold: true,
          lit: false,
        },
      ]),
    );
    const r = bbox(bk.get('sign_0'));
    expect(r.x0).toBeCloseTo(0.096, 3);
    expect(signs[0].style).toBe('letters');
  });

  it('neon tüp: ışıklı renk malzemesi, çizgi boyunca', () => {
    const bk = run(
      block([
        {
          t: 'neon',
          pts: [
            [2, 4],
            [6, 4],
          ],
          closed: false,
          d: 0.03,
          off: 0.05,
          color: '#ff2a8a',
        },
      ]),
    );
    const r = bbox(bk.get('cc_neon_#ff2a8a'));
    expect(r.z0).toBeLessThan(2);
    expect(r.z1).toBeGreaterThan(6);
  });

  it('LED ekran: kasa + ışıklı (screen) yüz', () => {
    run(
      block([
        {
          t: 'screen',
          u0: 2,
          u1: 5,
          y0: 6,
          y1: 8,
          d: 0.15,
          off: 0,
          frame: '#111213',
          text: '',
          bg: null,
          fg: '#ffffff',
          border: null,
          font: 'sans',
          bold: true,
          lit: false,
          blocks: [{ x0: 0, x1: 0.5, y0: 0, y1: 1, color: '#e03020' }],
        },
      ]),
    );
    expect(signs[0].style).toBe('screen');
    expect(signs[0].lit).toBe(true);
    expect(signs[0].blocks?.length).toBe(1);
  });

  it('çatı harfleri: dikmeler çatıdan harf üstüne, harfler setback gerisinde katmanlı', () => {
    const bk = run(
      block([
        {
          t: 'roofsign',
          u0: 2,
          u1: 6,
          y0: 13.5,
          y1: 14.5,
          setback: 1,
          d: 0.1,
          text: 'OTEL',
          bg: null,
          fg: '#f0f0f0',
          border: null,
          font: 'sans',
          bold: true,
          lit: true,
          frame: { color: '#303132', posts: 3 },
        },
      ]),
    );
    const posts = bbox(bk.get('cc_metal_#303132'));
    expect(posts.y1).toBeGreaterThan(14);
    expect(posts.x0).toBeGreaterThan(1);
    expect(signs.some((s) => s.side)).toBe(true);
  });

  it('eşya: loca arka duvarına dayalı dolap, loca yan duvarına salıncak', () => {
    const bk = run(
      block([
        bal({ d: 0, inset: 1.5, storeys: [1] }),
        {
          t: 'box',
          kind: 'box',
          u0: 3,
          u1: 3.4,
          y0: 3.6,
          y1: 5.6,
          s: 1,
          d: 0.5,
          off: 0.02,
          mount: 'wall',
          color: '#f4f4f2',
          color2: null,
        },
      ]),
    );
    const r = bbox(bk.get('cc_plaster_#f4f4f2'));
    // Arka duvar x = 1.5; dolap 1.48 .. 0.98
    expect(r.x1).toBeCloseTo(1.48, 2);
    expect(r.x0).toBeCloseTo(0.98, 2);
  });

  it('kanat çatısı: kaçık mahya, alınlık ucunda profil (mahya kotu apex)', () => {
    const ring: [number, number][] = [
      [0, 0],
      [0, 8],
      [10, 8],
      [10, 0],
    ];
    const opts = {
      eave: 0.3,
      pitchDeg: 30,
      gableBase: 12,
      keys: { roof: 'r', soffit: 's', fascia: 'f', gable: 'g', terrace: 't' },
    };
    // Mahya x = 3 boyunca (kuzey–güney), tepe 16 m, iki uç alınlık (kenar 1 ve kenar 3 üzerinde)
    const wings = [
      {
        ridge: [
          [3, 0],
          [3, 8],
        ] as [[number, number], [number, number]],
        apex: 16,
        ends: ['gable', 'gable'] as [string, string],
      },
    ];
    const h = wingHeightAt(ring, wings, 12.3, 0, opts);
    expect(h([3, 4])).toBeCloseTo(16, 3);
    // Saçak kotunda (x = −0.3 ve x = 10.3) 12.3
    expect(h([-0.29, 4])!).toBeCloseTo(12.3, 1);
    expect(h([10.29, 4])!).toBeCloseTo(12.3, 1);
    const gab = wingGables(ring, wings, 12.3, 0, opts);
    expect(gab.length).toBe(2);
    const top = Math.max(...gab[0].prof.map((p) => p[2]));
    expect(top).toBeCloseTo(16, 3);
    // Tepe noktası mahya x'inde
    const apexPt = gab[0].prof.find((p) => Math.abs(p[2] - 16) < 1e-3)!;
    expect(apexPt[0]).toBeCloseTo(3, 3);
  });

  it('blok roof.wings: alınlık kenarında saçak alnı yok, çatı tepesi apex', () => {
    const b = new Builder();
    const res = buildFacadeBlock(
      b,
      block([], {
        kind: 'hipped',
        wings: [
          {
            ridge: [
              [2, 0],
              [2, 8],
            ],
            apex: 17,
            ends: ['gable', 'hip'],
          },
        ],
      }),
      0,
      { seed: 1 },
    );
    expect(res.top).toBeCloseTo(17, 3);
  });

  it('pergola v7: yalnız seçili kenarda dikme, taşmalı kirişler + kapak', () => {
    const bk = run(
      block(
        [],
        {},
        {
          pergolas: [
            {
              poly: [
                [2, 2],
                [2, 6],
                [6, 6],
                [6, 2],
              ],
              y0: 12,
              y1: 14.5,
              y1s: 14,
              color: '#333333',
              postEdges: [0],
              every: 2,
              beams: { edge: 0, over: 0.5, capC: '#ffffff' },
              slatEdge: 0,
            },
          ],
        },
      ),
    );
    const cap = bbox(bk.get('cc_plaster_#ffffff'));
    // Kenar 0 x = 2 hattı; kirişler 0.5 m dışarı (x ≈ 1.5) taşar
    expect(cap.x0).toBeLessThan(1.6);
    const fr = bbox(bk.get('cc_metal_#333333'));
    expect(fr.y1).toBeLessThan(14.7);
  });

  it('kalkık gömük loca şapkası (capOver) cephe hattından taşar', () => {
    const bk = run(
      block([bal({ d: 0, inset: 1.5, storeys: [2, 3], cap: true, capOver: 0.4, capC: '#777777' })]),
    );
    const r = bbox(bk.get('cc_plaster_#777777'));
    expect(r.x0).toBeCloseTo(-0.4, 2);
  });
});

describe('tabela atlası', () => {
  it('iki yüz tek sayfada; UV sayfa bölgesinde, ışık düzeyi aux.x', () => {
    const b = new Builder();
    const at = new SignAtlas(160, 1024);
    const spec = (text: string, lit: boolean): SignSpec => ({
      text,
      bg: '#203040',
      fg: '#ffffff',
      font: 'sans',
      bold: true,
      lit,
      style: 'box',
      border: null,
      w: 3,
      h: 0.6,
    });
    const k1 = at.face(spec('A', false));
    const k2 = at.face(spec('B', true));
    b.wall(k1, [0, 0], [3, 0], 0, 0.6, [0, 0, 1, 1]);
    b.wall(k2, [0, 1], [3, 1], 0, 0.6, [0, 0, 1, 1]);
    const mats: Record<string, THREE.Material> = {};
    const r = at.finalize(b, mats);
    expect(r.pages).toBe(1);
    expect(r.regions).toBe(2);
    const bk = buckets(b);
    expect(bk.has(k1)).toBe(false);
    const page = [...bk.entries()].find(([k]) => k.startsWith('sgnAtlas0_'))!;
    for (const u of page[1].uv) expect(u).toBeGreaterThanOrEqual(0);
    for (const u of page[1].uv) expect(u).toBeLessThanOrEqual(1);
    // İkinci tabela (ışıklı) köşelerinde aux.x = 1
    expect(page[1].aux!.slice(16).filter((_, i) => i % 4 === 0)).toEqual([1, 1, 1, 1]);
    expect(Object.keys(mats).length).toBe(1);
  });
});

describe('sokak eşyası (örneklenen)', () => {
  it('masa + 4 sandalye tek prototip çifti; şemsiye ve saksı', () => {
    const b = new Builder();
    const ctx = { b, H: () => 0, walk: () => 0.15 };
    buildStreetFurniture(ctx, { kind: 'table', x: 1, z: 2, chairs: 4, color: '#dddddd' });
    buildStreetFurniture(ctx, { kind: 'table', x: 3, z: 2, chairs: 2, color: '#dddddd' });
    buildStreetFurniture(ctx, { kind: 'parasol', x: 1, z: 2, w: 2.5, h: 2.4, color: '#b01020' });
    const n = b.instanceCounts();
    expect(n.tableRound).toBe(2);
    expect(n.chair).toBe(6);
    expect(n.parasolSquare).toBe(1);
    expect(buildStreetFurniture(ctx, { kind: 'lamp-post', x: 0, z: 0 })).toBe(false);
  });

  it('hız kesici: yol kotunda, verilen yükseklikte', () => {
    const b = new Builder();
    buildStreetFurniture(
      { b, H: () => 0, walk: () => 0.15, colorKey: (k, h) => `cc_${k}_${h}` },
      {
        kind: 'speed-bump',
        x: 0,
        z: 0,
        pts: [
          [0, -2],
          [0, 2],
        ],
        w: 0.5,
        h: 0.05,
        color: '#707784',
      },
    );
    const r = bbox(buckets(b).get('cc_awning_#707784'));
    expect(r.y1).toBeCloseTo(0.055, 3);
    expect(r.x1 - r.x0).toBeCloseTo(0.5, 2);
  });
});

describe('çit tabanı', () => {
  it('bordürsüz sokakta ölçülmüş yüzey kotu (+0.15 değil)', () => {
    const mk = (surf?: (x: number, z: number) => number | null) => {
      const b = new Builder();
      buildGenericFence(
        b,
        {
          kind: 'wall',
          pts: [
            [0, 0],
            [6, 0],
          ],
          wall: { h: 1, color: '#aaaaaa' },
        },
        () => 0,
        (k, c) => `gf_${k}_${c}`,
        [],
        undefined,
        0,
        surf,
      );
      return bbox(buckets(b).get('gf_render_#aaaaaa'));
    };
    expect(mk().y0).toBeCloseTo(0.15 - 0.2, 3);
    expect(mk(() => 0.02).y0).toBeCloseTo(0.02 - 0.2, 3);
  });
});
