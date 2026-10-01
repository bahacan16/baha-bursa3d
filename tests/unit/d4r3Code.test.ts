import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Builder } from '../../src/worlds/measured/builder';
import { buildStreetPlan, fadePaint, signKeysOf } from '../../src/worlds/measured/street';
import { pillGeometry, resolveOpenings, tintCode } from '../../src/worlds/measured/facade';
import { drawSignItem, type SignCtx } from '../../src/worlds/measured/signs';
import {
  drawShopSign,
  famOf,
  SIGN_SQUEEZE_MIN,
  SIGN_STRETCH_MAX,
  type SignDraw,
} from '../../src/worlds/measured/textures';
import { ChunkedGeometry } from '../../src/worlds/osm/chunks';
import { buildRoads, fadedMark } from '../../src/worlds/osm/roads';
import type { Road } from '../../src/worlds/osm/parse';
import { leafBaseY, speciesModel, speciesModelCb } from '../../src/worlds/osm/treelib';
import { SPECIES_SIZE } from '../../src/worlds/osm/species';

type Bucket = { pos: number[]; idx: number[] };
const buckets = (b: Builder) => (b as unknown as { buckets: Map<string, Bucket> }).buckets;
const ck = ((k: string, h: string) => `cc_${k}_${h}`) as never;

/** Kart başına en alt köşe kotları */
function cardBottoms(g: THREE.BufferGeometry): number[] {
  const p = g.attributes.position;
  const out: number[] = [];
  for (let i = 0; i + 3 < p.count; i += 4)
    out.push(Math.min(p.getY(i), p.getY(i + 1), p.getY(i + 2), p.getY(i + 3)));
  return out;
}

describe('D4 r3: ölçülen taç tabanının altına yaprak inmez (d4a r3 #10, d4b r3 N14)', () => {
  it('yaprak döken: tüm kartların alt kenarı taç tabanında ya da üstünde, tepe yerinde', () => {
    const H = SPECIES_SIZE.deciduous.h;
    for (const cb of [0.3, 0.35, 0.45]) {
      const v = speciesModelCb('deciduous', cb);
      for (const leaves of [v.near.leaves, v.mid.leaves]) {
        const lo = Math.min(...cardBottoms(leaves));
        expect(lo).toBeGreaterThanOrEqual(cb * H - 1e-4);
      }
      // %3'lük alt kenar tam tabana yakın (taç tabanın çok üstüne kalkmaz)
      expect(leafBaseY(v.near.leaves, true)).toBeLessThan(cb * H + 0.15 * H);
    }
    // ölçülmemiş ağaç (cb 0) değişmez
    expect(speciesModelCb('deciduous', 0)).toBe(speciesModel('deciduous'));
  });
  it('kart biçimi korunur (yalnız taşınır)', () => {
    const base = speciesModel('tilia').near.leaves.attributes.position;
    const v = speciesModelCb('tilia', 0.45).near.leaves.attributes.position;
    for (let i = 0; i < Math.min(base.count, 400); i += 4)
      expect(v.getY(i + 2) - v.getY(i)).toBeCloseTo(base.getY(i + 2) - base.getY(i), 5);
  });
});

describe('D4 r3: solmuş yol boyası (d4c r3 #13, d4a r3 #18)', () => {
  it('fadePaint: yol tonuna sRGB karışım; 0 → aynı renk', () => {
    expect(fadePaint('#eeeeea', 0)).toBe('#eeeeea');
    expect(fadePaint('#eeeeea', 1)).toBe('#8a8b88');
    expect(fadePaint('#eeeeea', 0.6)).toBe('#b2b3af');
  });
  it('geçit: fade verilince solmuş renk anahtarı, verilmezse eski spPaint', () => {
    const run = (fade?: number) => {
      const b = new Builder();
      buildStreetPlan(
        b,
        {
          street: [{ kind: 'crossing', x: 0, z: 0, rot: 0, len: 4, w: 3, ...(fade ? { fade } : {}) }],
        } as never,
        () => 0,
        () => 5,
        { colorKey: ck },
      );
      return b.keys();
    };
    expect(run()).toContain('spPaint');
    expect(run(0.6)).toContain('cc_asphalt_#b2b3af');
    expect(run(0.6)).not.toContain('spPaint');
  });
  it('OSM çizgileri: fade köşe rengini asfalta karıştırır, fade yoksa beyaz', () => {
    expect(fadedMark(undefined)).toEqual([0.92, 0.92, 0.9]);
    const road = {
      id: 'w1',
      kind: 'primary',
      name: '',
      pts: [
        [0, 0],
        [0, -100],
      ],
      width: 12,
      layer: 0,
      bridge: false,
      tunnel: false,
      area: false,
      vehicular: true,
      oneway: 0,
    } as unknown as Road;
    const cols = (fade?: number) => {
      const g = new ChunkedGeometry();
      buildRoads(g, [road], [], [], { w1: { edges: 'none', ...(fade ? { fade } : {}) } });
      const out = new Set<string>();
      for (const c of g.toPayload())
        if (c.mat === 'marking') for (let i = 0; i < c.color.length; i += 3) out.add(c.color[i].toFixed(3));
      return [...out];
    };
    expect(cols()).toEqual(['0.920']);
    const f = cols(0.5);
    expect(f).toHaveLength(1);
    expect(Number(f[0])).toBeCloseTo(0.92 * 0.5 + 0.27 * 0.5, 3);
  });
});

describe('D4 r3: park etmek yasaktır levhası + direk çapı (d4b r3 N8)', () => {
  it('levha türü: yasak diski, P levhası değil; duraklama yasağı çift çapraz', () => {
    expect(signKeysOf('park etmek yasaktır (mavi zemin kırmızı çerçeve çapraz çizgili disk)')).toEqual([
      'signNoParking',
    ]);
    expect(signKeysOf('duraklamak ve park etmek yasaktır')).toEqual(['signNoStopping']);
    expect(signKeysOf('p – yabancı araç park edemez')).toEqual(['signP']);
    expect(signKeysOf('oto park ücretsiz (p)')).toEqual(['signP']);
  });
  it('poleD direği kalınlaştırır, levha direğin önünde', () => {
    const run = (poleD?: number) => {
      const b = new Builder();
      buildStreetPlan(
        b,
        {
          street: [
            {
              kind: 'sign',
              x: 0,
              z: 0,
              h: 2.6,
              rot: 0,
              text: 'park etmek yasaktır',
              ...(poleD ? { poleD } : {}),
            },
          ],
        } as never,
        () => 0,
        () => 5,
        { colorKey: ck },
      );
      const pole = buckets(b).get('pole')!;
      let mx = 0;
      for (let i = 0; i < pole.pos.length; i += 3) mx = Math.max(mx, Math.abs(pole.pos[i]));
      const plate = buckets(b).get('signNoParking')!;
      let pz = 0;
      for (let i = 2; i < plate.pos.length; i += 3) pz = Math.max(pz, Math.abs(plate.pos[i]));
      return { r: mx, pz };
    };
    expect(run().r).toBeCloseTo(0.035, 2);
    const t = run(0.2);
    expect(t.r).toBeCloseTo(0.1, 2);
    expect(t.pz).toBeGreaterThan(0.1);
  });
});

describe('D4 r3: otobüs durağı camı berrak (d4a r3 #17, d4b r3 #20)', () => {
  it('ölçülmemiş cam → mkShelterGlass; ölçülen cam rengi kazanır', () => {
    const run = (glass?: string) => {
      const b = new Builder();
      buildStreetPlan(
        b,
        {
          street: [
            { kind: 'bus-shelter', x: 0, z: 0, w: 4, d: 1.5, h: 2.5, rot: 0, ...(glass ? { glass } : {}) },
          ],
        } as never,
        () => 0,
        () => 5,
        { colorKey: ck },
      );
      return b.keys();
    };
    expect(run()).toContain('mkShelterGlass');
    expect(run()).not.toContain('mkRailGlass');
    expect(run('#445566')).toContain('cc_glass_#445566');
  });
});

/** Kayıt tutan sahte 2B bağlam: measureText = harf sayısı × yazı boyu × 0.6 */
function fakeCtx() {
  const calls: { op: string; args: unknown[]; font: string; lw: number }[] = [];
  let font = '10px Arial';
  let lw = 1;
  const g = new Proxy(
    {},
    {
      get(_t, k: string) {
        if (k === 'font') return font;
        if (k === 'lineWidth') return lw;
        if (k === 'measureText')
          return (s: string) => ({ width: s.length * Number(/([0-9.]+)px/.exec(font)![1]) * 0.6 });
        return (...args: unknown[]) => calls.push({ op: k, args, font, lw });
      },
      set(_t, k: string, v) {
        if (k === 'font') font = v;
        if (k === 'lineWidth') lw = v;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { g, calls };
}

const sign = (o: Partial<SignDraw>): SignDraw =>
  ({
    text: 'BURGER',
    bg: null,
    fg: '#ffffff',
    border: null,
    font: 'sans',
    bold: true,
    lit: false,
    style: 'letters',
    w: 1.1,
    h: 0.32,
    ...o,
  }) as SignDraw;

describe('D4 r3: ölçülen harf boyu korunur — önce yatay sıkıştırma (Ohannes BURGER, HASKÖYÜM, IDAS)', () => {
  it('capH sığmıyorsa scale(sx) ile sıkıştırılır, yazı boyu capH', () => {
    const { g, calls } = fakeCtx();
    drawShopSign(g, 176, 51, sign({ capH: 0.28 }));
    const sc = calls.find((c) => c.op === 'scale');
    expect(sc).toBeTruthy();
    const sx = sc!.args[0] as number;
    expect(sx).toBeLessThan(1);
    expect(sx).toBeGreaterThanOrEqual(SIGN_SQUEEZE_MIN);
    const fill = calls.find((c) => c.op === 'fillText')!;
    const px = Number(/([0-9.]+)px/.exec(fill.font)![1]);
    // capH 0.28 / 0.72 em (51 px = 0.32 m): tek satırda ölçülen harf boyu (≤ H / 0.74)
    expect(px).toBeCloseTo(((0.28 / 0.72) * 51) / 0.32, 1);
    expect(fill.font.startsWith('bold ')).toBe(true);
  });
  it('capH yoksa eskisi gibi küçülür (sıkıştırma yok)', () => {
    const { g, calls } = fakeCtx();
    drawShopSign(g, 176, 51, sign({}));
    expect(calls.some((c) => c.op === 'scale')).toBe(false);
  });
  it('stretch: kısa yazı genişliği doldurur (≤ SIGN_STRETCH_MAX)', () => {
    const { g, calls } = fakeCtx();
    drawShopSign(g, 864, 100, sign({ text: 'BURGER', w: 5.4, h: 0.625, capH: 0.62, stretch: true }));
    const sx = calls.find((c) => c.op === 'scale')!.args[0] as number;
    expect(sx).toBeGreaterThan(1);
    expect(sx).toBeLessThanOrEqual(SIGN_STRETCH_MAX);
  });
  it('outlineW: kontur kalınlığı ölçüden (2 × görünen, px)', () => {
    const { g, calls } = fakeCtx();
    drawShopSign(g, 400, 100, sign({ text: 'Cadı', w: 2, h: 0.5, outline: '#33282a', outlineW: 0.04 }));
    const st = calls.find((c) => c.op === 'strokeText')!;
    expect(st.lw).toBeCloseTo(((2 * 0.04) / 0.5) * 100, 3);
  });
  it('pill: zemin yuvarlatılmış dikdörtgen (uç yarıçapı h / 2)', () => {
    const { g, calls } = fakeCtx();
    drawShopSign(
      g,
      600,
      160,
      sign({ text: 'KUVEYTTÜRK', bg: '#f2f3f1', style: 'box', shape: 'pill', w: 4.2, h: 1.1 }),
    );
    const rr = calls.find((c) => c.op === 'roundRect')!;
    expect(rr.args[4] as number).toBeCloseTo(160 / 2 - 2, 0);
    expect(calls.some((c) => c.op === 'fillRect')).toBe(false);
  });
  it('dar yazı tipi paketlenmiş Roboto Condensed', () => {
    expect(famOf('condensed').startsWith('"Roboto Condensed"')).toBe(true);
  });
});

describe('D4 r3: hap biçimli tabela kutusu', () => {
  it('pillGeometry: w × h × d sınır kutusu, yaw ile döner', () => {
    const g = pillGeometry(4, 1, 0.2, 0, [10, 5], 3);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(4, 3);
    expect(bb.max.y - bb.min.y).toBeCloseTo(1, 3);
    expect(bb.max.z - bb.min.z).toBeCloseTo(0.2, 3);
    expect((bb.max.x + bb.min.x) / 2).toBeCloseTo(10, 3);
    expect((bb.max.y + bb.min.y) / 2).toBeCloseTo(3, 3);
    const r = pillGeometry(4, 1, 0.2, Math.PI / 2, [0, 0], 0);
    r.computeBoundingBox();
    expect(r.boundingBox!.max.z - r.boundingBox!.min.z).toBeCloseTo(4, 3);
  });
});

describe('D4 r3: vitrin içindeki kapı atılmaz (survey-b)', () => {
  const op = (u0: number, u1: number, y0: number, y1: number, kind: string) =>
    ({ u0, u1, y0, y1, k: 0, win: { kind, sill: y0 } }) as never;
  type O = { u0: number; u1: number; y0: number; y1: number; win: { kind: string } };
  it('dükkân camı kapının çevresinde bölünür, kapı kalır', () => {
    const r = resolveOpenings([op(0, 10, 0.9, 3.4, 'shop'), op(4, 6, 0.9, 3.2, 'door')]) as O[];
    const door = r.filter((o) => o.win.kind === 'door');
    expect(door).toHaveLength(1);
    const shop = r.filter((o) => o.win.kind === 'shop').map((o) => [o.u0, o.u1, o.y0, o.y1]);
    expect(shop).toContainEqual([0, 4, 0.9, 3.4]);
    expect(shop).toContainEqual([6, 10, 0.9, 3.4]);
    expect(shop).toContainEqual([4, 6, 3.2, 3.4]);
    // çakışma kalmadı
    for (const a of r)
      for (const b of r)
        if (a !== b)
          expect(a.u1 > b.u0 + 0.02 && a.u0 < b.u1 - 0.02 && a.y1 > b.y0 + 0.02 && a.y0 < b.y1 - 0.02).toBe(
            false,
          );
  });
  it('kısmi çakışma eskisi gibi (sonraki atılır), çakışmayanlar aynen', () => {
    const a = op(0, 5, 0.9, 3, 'shop');
    const b = op(4, 8, 0.9, 3, 'shop');
    const c = op(9, 10, 0.9, 2.2, 'door');
    const r = resolveOpenings([a, b, c]);
    expect(r).toEqual([a, c]);
  });
});

describe('D4 r3: çatı harf tabelası iskeleti yalnız harf altında (900000203 TAŞYAKAN)', () => {
  const run = (under?: boolean) => {
    const b = new Builder();
    const c: SignCtx = {
      b,
      P: (_i, u, off = 0) => [u, off],
      E: { yaw: 0 } as never,
      i: 0,
      base: 0,
      wallTop: 7.8,
      roofH: () => 7.8,
      ck: (k) => `ck_${k}`,
      recDepthAt: () => 0,
      floorY: (k) => k * 3.9,
    };
    drawSignItem(c, {
      t: 'roofsign',
      text: 'TAŞYAKAN',
      fg: '#e8b8a6',
      u0: 0,
      u1: 2.5,
      y0: 8.3,
      y1: 10.3,
      setback: 1,
      d: 0.12,
      frame: { color: '#6b6b6b', h: 0.5, posts: 2, ...(under ? { under } : {}) },
    } as never);
    const m = buckets(b).get('ck_metal')!;
    let top = -Infinity;
    for (let i = 1; i < m.pos.length; i += 3) top = Math.max(top, m.pos[i]);
    return top;
  };
  it('under: iskelet harf alt kotunda biter; verilmezse eski (harf üstüne kadar)', () => {
    expect(run(true)).toBeLessThanOrEqual(8.3 + 1e-6);
    expect(run()).toBeGreaterThan(10);
  });
});

describe('D4 r3: survey-c üretici seçenekleri', () => {
  it('capH = kutu boyu: tek satırda ölçülen harf boyu kazanır (≤ 0.97 H), çok satırda eski sınır', () => {
    const { g, calls } = fakeCtx();
    drawShopSign(g, 800, 100, sign({ text: 'MONS', w: 8, h: 1.0, capH: 1.0 }));
    const px = Number(/([0-9.]+)px/.exec(calls.find((c) => c.op === 'fillText')!.font)![1]);
    expect(px * 0.72).toBeGreaterThan(95);
    expect(px).toBeLessThanOrEqual(100 / 0.74 + 1e-6);
    const m = fakeCtx();
    drawShopSign(m.g, 800, 100, sign({ text: 'A\nB', w: 8, h: 1.0, capH: 1.0 }));
    const px2 = Number(/([0-9.]+)px/.exec(m.calls.find((c) => c.op === 'fillText')!.font)![1]);
    expect(px2).toBeLessThanOrEqual(100 / 2 / 1.02 + 1e-6);
  });
  it('italic yazı tipi dizgesinde', () => {
    const { g, calls } = fakeCtx();
    drawShopSign(g, 400, 100, sign({ text: 'Mariza', w: 2, h: 0.5, italic: true }));
    expect(calls.find((c) => c.op === 'fillText')!.font.startsWith('italic bold ')).toBe(true);
  });
  it('başak simgesi çizilir (sap + taneler)', () => {
    const { g, calls } = fakeCtx();
    drawShopSign(
      g,
      100,
      100,
      sign({ text: '', shape: 'round', bg: '#ffffff', icon: 'wheat', iconC: '#c8252a', w: 1, h: 1 }),
    );
    expect(calls.filter((c) => c.op === 'ellipse').length).toBe(11);
  });
  it('cam balkon light kodu 4; diğerleri aynı', () => {
    expect([undefined, 'clear', 'green', 'dark', 'blinds', 'light'].map(tintCode)).toEqual([
      0, 0, 1, 2, 3, 4,
    ]);
  });
  it('sokak eşyası elev: verilen kotta (yürüme kotu yerine)', () => {
    const run = (elev?: number) => {
      const b = new Builder();
      buildStreetPlan(
        b,
        {
          street: [
            {
              kind: 'planter',
              x: 0,
              z: 0,
              w: 1,
              d: 1,
              h: 0.5,
              color: '#7a5a3a',
              ...(elev != null ? { elev } : {}),
            },
          ],
        } as never,
        () => 0,
        () => 5,
        { colorKey: ck },
      );
      const bk = buckets(b).get('cc_plaster_#7a5a3a')!;
      let lo = Infinity;
      for (let i = 1; i < bk.pos.length; i += 3) lo = Math.min(lo, bk.pos[i]);
      return lo;
    };
    expect(run()).toBeLessThan(0.5);
    expect(run(10.3)).toBeCloseTo(10.3, 3);
  });
});

describe('D4 r3: uzun saksıda çalı sırası (d4b r3 #4)', () => {
  it('kutu boyunca ayrı çalılar; kısa saksıda tek çalı (eski)', () => {
    const run = (w: number) => {
      const b = new Builder();
      buildStreetPlan(
        b,
        {
          street: [
            {
              kind: 'planter',
              x: 0,
              z: 0,
              w,
              d: 0.6,
              h: 0.6,
              color: '#7a5a3a',
              plant: { h: 0.6, color: '#3f5a2e', shape: 'shrub' },
            },
          ],
        } as never,
        () => 0,
        () => 5,
        { colorKey: ck },
      );
      return buckets(b).get('cc_fascia_#3f5a2e')!.pos.length / 3;
    };
    // 6 m / max(0.5, 0.6 × 1.2) → 8 çalı × (10 × 7 köşe); 1 m kutu eski tek elipsoit (11 × 8)
    expect(run(6)).toBe(8 * 10 * 7);
    expect(run(1)).toBe(11 * 8);
  });
});
