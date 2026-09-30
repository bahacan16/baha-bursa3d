import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Builder } from '../../src/worlds/measured/builder';
import {
  archRing,
  buildFacadeBlock,
  offsetLine,
  type CBal,
  type CItem,
  type CompiledBlock,
  type SignSpec,
} from '../../src/worlds/measured/facade';
import { buildStreetPlan } from '../../src/worlds/measured/street';
import { toneOf } from '../../src/worlds/measured/siteplan';

type Bucket = { pos: number[]; idx: number[]; uv: number[]; nor: number[]; aux: number[] | null };
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
/** Kova içeriğinin özeti (konum / dizin / uv, 1e-4 yuvarlatılmış) — "özelliği kullanmayan blok aynı" testleri */
function digest(b: Builder): string {
  const h = createHash('md5');
  for (const [k, v] of [...buckets(b).entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    h.update(k);
    h.update(new Float32Array(v.pos.map((x) => Math.round(x * 1e4) / 1e4)));
    h.update(new Uint32Array(v.idx));
    h.update(new Float32Array(v.uv.map((x) => Math.round(x * 1e4) / 1e4)));
  }
  return h.digest('hex');
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
const build = (blk: CompiledBlock, bevel = 0) => {
  const b = new Builder();
  signs.length = 0;
  buildFacadeBlock(b, blk, 0, {
    seed: 1,
    bevel,
    colorKey: (k, h) => `cc_${k}_${h}`,
    signFace: (s) => {
      signs.push(s);
      return `sign_${signs.length - 1}${s.side ? '_side' : ''}`;
    },
  });
  return b;
};
const run = (blk: CompiledBlock) => buckets(build(blk));
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
const win = (o: Record<string, unknown>): CItem =>
  ({
    t: 'win',
    u0: 2,
    u1: 4,
    sill: 0.9,
    head: 2.2,
    storeys: [1],
    kind: 'std',
    rail: false,
    split: 2,
    box: false,
    ...o,
  }) as unknown as CItem;
/** Kovadaki köşelerden koşulu sağlayan var mı */
const anyVert = (bk: Bucket | undefined, f: (x: number, y: number, z: number) => boolean) => {
  if (!bk) return false;
  for (let i = 0; i < bk.pos.length; i += 3) if (f(bk.pos[i], bk.pos[i + 1], bk.pos[i + 2])) return true;
  return false;
};

describe('v9 — özelliği kullanmayan bloklar değişmez', () => {
  // Altın özetler v9 öncesi üreticiyle (HEAD 5620028) hesaplandı: kırma çatı + saçak, tüm kenarlarda parapet,
  // loca + pencere + tente + pano; sokak: dolu panel çit, kanopi, dolap, kavşak adası (çayırsız), refüj
  const GOLD = {
    hipped: 'adfb44cafd5cf29bea84d44f7edf4aef|dd6f48cf8f26b957e0abc414bb1b8514',
    parapet: '4eb4238cf7274e6f8106131493a515cb|a750069012e66284c4c87bb4a63bb428',
    street: '1e829afc7fc7ad239b7e0eeafd6fafdb',
  };
  const hipped = () =>
    block(
      [
        bal({ d: 0, inset: 1.2, storeys: [1, 2] }),
        win({ u0: 6.5, u1: 7.5 }),
        {
          t: 'awning',
          u0: 1,
          u1: 3,
          y: 3.4,
          d: 1.2,
          drop: 0.4,
          color: '#aa2222',
          stripe: '#eeeeee',
          text: null,
          textColor: '#ffffff',
          style: 'retract',
        },
        { t: 'panel', u0: 0, u1: 8, y0: 0.5, y1: 3.5, color: '#224466', proud: 0.02 },
      ],
      { kind: 'hipped', eave: 0.6, fasciaH: 0.45, pitch: 28 },
    );
  const parapetBlk = () =>
    block([win({}), bal({ d: 1.1, storeys: [2, 3], rail: { '*': 'tube' } })], {
      kind: 'flat',
      eave: 0.02,
      fasciaH: 0.05,
      parapet: { h: 0.8, color: '#cccccc', rail: 'tube', railC: '#eeeeee' },
    });
  it('kırma çatılı blok (saçak duvarda) — özet aynı', () => {
    expect(digest(build(hipped())) + '|' + digest(build(hipped(), 0.015))).toBe(GOLD.hipped);
  });
  it('parapetli düz çatılı blok — özet aynı', () => {
    expect(digest(build(parapetBlk())) + '|' + digest(build(parapetBlk(), 0.015))).toBe(GOLD.parapet);
  });
  it('sokak öğeleri (çıtasız çit, yazısız kanopi, renksiz dolap, çayırsız ada) — özet aynı', () => {
    const b = new Builder();
    buildStreetPlan(
      b,
      {
        street: [
          {
            kind: 'low-fence',
            x: 0,
            z: 0,
            pts: [
              [0, 0],
              [4, 0],
            ],
            h: 0.9,
            color: '#3b2a1e',
          },
          {
            kind: 'canopy',
            x: 10,
            z: 0,
            a: [10, 0],
            e: [10, 6],
            d: 3,
            h: 3,
            fasciaH: 0.5,
            fasciaC: '#1e1f20',
          },
          { kind: 'cabinet', x: 20, z: 0, h: 1.3 },
          {
            kind: 'roundabout-island',
            x: 40,
            z: 40,
            rx: 10,
            rz: 11,
            h: 0.15,
            kerb: 'dış gri beton bordür (≈0.15) + ≈0.5 m kiremit bant + iç alçak gri bordür (≈0.1) + çim',
            grass: { rx: 9.2, rz: 10.2, material: 'çim' },
          },
          {
            kind: 'island',
            x: 60,
            z: 0,
            h: 0.15,
            poly: [
              [59, 0],
              [61, 0],
              [61, -20],
              [59, -20],
            ],
            material: 'bordürlü çim orta refüj',
          },
        ],
      } as never,
      () => 0,
      () => 5,
      { colorKey: ((k: string, h: string) => `cc_${k}_${h}`) as never, signFace: (s) => `face:${s.text}` },
    );
    expect(digest(b)).toBe(GOLD.street);
  });
});

describe('v9 — saçak alnı saçak ucunda', () => {
  it('düz çatı, derin saçak: alın bandı uçta (x = −eave), duvar hizasında bant yok; alt yüz + uç dönüşü', () => {
    const bk = run(block([], { kind: 'flat', eave: 1.45, fasciaH: 1.45, fasciaC: '#3c454e' }));
    const f = bk.get('cc_plaster_#3c454e');
    const wallTop = 0.5 + 4 * 3 + 0.12;
    // Uçta (x ≈ −1.45) duvar üstünden itibaren bant
    expect(anyVert(f, (x, y) => Math.abs(x + 1.452) < 0.01 && Math.abs(y - (wallTop - 0.05)) < 0.01)).toBe(
      true,
    );
    // Duvar hizasında (x = −0.02) saçak kotunda bant kalmadı
    expect(anyVert(f, (x, y) => Math.abs(x + 0.02) < 0.005 && y > wallTop - 0.1)).toBe(false);
    // Saçak kutusu alt yüzü duvar üstü kotunda, aşağı bakar
    const s = bk.get('mkSoffit')!;
    let down = false;
    for (let i = 0; i < s.pos.length; i += 3)
      if (Math.abs(s.pos[i + 1] - (wallTop - 0.05)) < 0.01 && s.nor[i + 1] < -0.9) down = true;
    expect(down).toBe(true);
  });
  it('fasciaAt "wall" eski yeri korur; saçaksız kenar (parapet) etkilenmez', () => {
    const f = run(
      block([], { kind: 'flat', eave: 1.45, fasciaH: 1.45, fasciaC: '#3c454e', fasciaAt: 'wall' }),
    ).get('cc_plaster_#3c454e');
    expect(anyVert(f, (x, y) => Math.abs(x + 0.02) < 0.005 && y > 12)).toBe(true);
  });
  it('parapetsiz komşuya bakan uçta dönüş yüzü (karma parapet)', () => {
    const bk = run(
      block([], {
        kind: 'flat',
        eave: 1.0,
        fasciaH: 0.8,
        fasciaC: '#445566',
        parapet: { h: 0.6, color: '#cccccc', edges: [1] },
      }),
    );
    const f = bk.get('cc_plaster_#445566');
    // Kenar 0'ın u = 8 ucu (z = 8) kenar 1 (parapetli) hattında: dönüş yüzü z = 8'de x ∈ [−1, 0]
    expect(anyVert(f, (x, _y, z) => Math.abs(z - 8) < 0.01 && Math.abs(x + 1) < 0.01)).toBe(true);
    expect(anyVert(f, (x, _y, z) => Math.abs(z - 8) < 0.01 && Math.abs(x) < 0.01)).toBe(true);
  });
});

describe('v9 — sürekli konsol döşeme ön hattı (slabFronts)', () => {
  const sf = (extra: Partial<NonNullable<CompiledBlock['slabFronts']>[number]> = {}) =>
    block(
      [bal({ d: 0, inset: 1.6, u0: 0, u1: 8, storeys: [1, 2, 3], rail: { '*': 'glassFull' } })],
      {},
      {
        slabFronts: [
          {
            pts: [
              [-0.8, 0],
              [-0.8, 8],
            ],
            s: [1, 3],
            d: 0.35,
            rail: 'glassFull',
            glassC: '#9fb7ae',
            fasciaC: '#c3c7c4',
            ...extra,
          },
        ],
      },
    );
  it('döşeme ön hattı taban izinin 0.8 m dışında, alın kalınlığı d, cam korkuluk ön hatta', () => {
    const bk = run(sf());
    const top = bbox(bk.get('mkSlabTop'));
    expect(top.x0).toBeCloseTo(-0.8, 2);
    const g = bbox(bk.get('cc_glass_#9fb7ae'));
    expect(g.x0).toBeGreaterThan(-0.8);
    expect(g.x0).toBeLessThan(-0.7);
    // Alın: y1 − 0.35 kotuna iner (K1 döşemesi 3.5)
    const fz = bbox(bk.get('cc_fascia_#c3c7c4'));
    expect(fz.y0).toBeCloseTo(3.5 - 0.35, 2);
  });
  it('loca korkuluğu taban izi hattında çizilmez (ön hat onun yerine)', () => {
    const withSF = run(sf());
    const noSF = run({ ...sf(), slabFronts: null });
    // Taban izi hattındaki loca camı (x ≈ −0.05…0) yalnız slabFronts'suz
    const gA = withSF.get('mkRailGlass');
    const gB = noSF.get('mkRailGlass');
    expect(anyVert(gB, (x) => x > -0.2 && x < 0.1)).toBe(true);
    expect(anyVert(gA, (x) => x > -0.2 && x < 0.1)).toBe(false);
  });
  it('offsetLine: kırıklı çizgide gönye ötelemesi', () => {
    const o = offsetLine(
      [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
      1,
    );
    // Sol normal (−dz, dx): ilk parça için (0, 1)
    expect(o[0][0]).toBeCloseTo(0);
    expect(o[0][1]).toBeCloseTo(1);
    expect(o[1][0]).toBeCloseTo(3);
    expect(o[1][1]).toBeCloseTo(1);
  });
});

describe('v9 — tente çizgileri, iki renkli korkuluk, açıklık biçimleri, pano desenleri', () => {
  const awn = (o: Record<string, unknown> = {}) =>
    ({
      t: 'awning',
      u0: 1,
      u1: 4,
      y: 3.4,
      d: 1.3,
      drop: 0.2,
      color: '#c23a3a',
      stripe: '#eeeeee',
      text: null,
      textColor: '#ffffff',
      style: 'retract',
      ...o,
    }) as unknown as CItem;
  it('düz / katlanır tentede stripeW: duvara dik dönüşümlü bantlar (iki renk kovası)', () => {
    const one = run(block([awn()]));
    expect(one.get('cc_awning_#eeeeee')).toBeUndefined();
    const st = run(block([awn({ stripeW: 0.15 })]));
    const w = st.get('cc_awning_#eeeeee')!;
    const r = st.get('cc_awning_#c23a3a')!;
    expect(w.idx.length).toBeGreaterThan(0);
    // 3 m / 0.15 = 20 bant: 10 beyaz × (eğim 2 + valans 2) yüz × 2 üçgen
    expect(w.idx.length / 3).toBe(10 * 4 * 2);
    // Bantlar duvara dik: beyaz bant köşeleri hem duvar (x ≈ −0.02) hem uç (x ≈ −1.3) hattında
    expect(anyVert(w, (x) => Math.abs(x + 0.02) < 0.01)).toBe(true);
    expect(anyVert(w, (x) => Math.abs(x + 1.3) < 0.01)).toBe(true);
    expect(r.idx.length).toBeGreaterThan(0);
  });
  it('iki renkli teras korkuluğu: kenar bazında küpeşte rengi + N koyu çubuk', () => {
    const blk = block([], {
      kind: 'flat',
      eave: 0.02,
      fasciaH: 0.05,
      parapet: {
        h: 0.06,
        rail: 'tube',
        railC: '#e6e7e4',
        railH: 0.95,
        edgeRails: [
          { at: [0, 4], railC: '#1f282b', railTopC: '#c1c8c9', rows: 5, rowGap: 0.15, postEvery: 1.5 },
        ],
      },
    });
    const bk = run(blk);
    const top = bbox(bk.get('cc_metal_#c1c8c9'));
    // Küpeşte yalnız kenar 0 (x ≈ −0.05)
    expect(top.x1).toBeLessThan(0.1);
    expect(top.y0).toBeGreaterThan(12.62 + 0.9);
    const dark = bk.get('cc_metal_#1f282b')!;
    // 5 çubuk + dikmeler kenar 0'da; diğer kenarlar beyaz boru
    const yBars = new Set<number>();
    for (let i = 0; i < dark.pos.length; i += 3) yBars.add(Math.round(dark.pos[i + 1] * 100));
    expect(bk.get('cc_metal_#e6e7e4')).toBeDefined();
    expect(bbox(dark).x1).toBeLessThan(0.1);
    expect(yBars.size).toBeGreaterThan(5);
  });
  it('köşeleri yuvarlatılmış açıklık: yay köşeleri cam kovasında, köşe dolgusu duvar / pano renginde', () => {
    const bk = run(
      block([
        { t: 'panel', u0: 1, u1: 7, y0: 3.6, y1: 6.2, color: '#5e95b0', proud: 0.01 },
        win({ u0: 2, u1: 5, sill: 0.3, head: 2.4, storeys: [1], shape: 'rounded', radius: 0.45 }),
      ]),
    );
    const gl = bk.get('mkGlass')!;
    // Sol üst köşe noktası (u 2, y 3.5+2.4) camda yok (yuvarlandı), yay orta noktası var
    const top = 3.5 + 2.4;
    expect(anyVert(gl, (_x, y, z) => Math.abs(z - 2) < 0.01 && Math.abs(y - top) < 0.01)).toBe(false);
    const c = 0.45 * (1 - Math.SQRT1_2);
    expect(anyVert(gl, (_x, y, z) => Math.abs(z - (2 + c)) < 0.02 && Math.abs(y - (top - c)) < 0.02)).toBe(
      true,
    );
    expect(bk.get('cc_plaster_#5e95b0')!.idx.length).toBeGreaterThan(0);
  });
  it('kemerli açıklık: üzengi ve tepe; asimetrik (apex u0)', () => {
    const r = archRing(0, 4, 0, 3, 2, null);
    expect(Math.max(...r.map((p) => p[1]))).toBeCloseTo(3);
    const at = (u: number) => r.filter((p) => Math.abs(p[0] - u) < 1e-6).map((p) => p[1]);
    expect(at(4)).toContain(2);
    const a = archRing(0, 4, 0, 3, 1, 0);
    // Tepe sol uçta (apex u0 + 0.05 sınırı), sağa inen çeyrek elips
    const pk = a.reduce((m, p) => (p[1] > m[1] ? p : m));
    expect(pk[0]).toBeLessThan(0.1);
    const bk = run(
      block([win({ u0: 2, u1: 5, sill: 0.3, head: 2.6, shape: 'arch', spring: 2.0, split: 3 })]),
    );
    const g = bbox(bk.get('mkGlass'));
    expect(g.y1).toBeGreaterThan(3.5 + 2.55);
  });
  it('çokgen pano (köşegen bölünme) ve yıldız / çift derz kaplama anahtarları', () => {
    const bk = run(
      block([
        {
          t: 'panel',
          u0: 0,
          u1: 8,
          y0: 2,
          y1: 10,
          color: '#a0907c',
          proud: 0,
          poly: [
            [0, 2],
            [8, 2],
            [0, 10],
          ],
        },
        {
          t: 'panel',
          u0: 0,
          u1: 4,
          y0: 11,
          y1: 12,
          color: '#242a28',
          proud: 0.08,
          clad: { dir: 'star', every: 0.55, w: 0.02, color: '#373b3c' },
        },
        {
          t: 'panel',
          u0: 4,
          u1: 8,
          y0: 11,
          y1: 12,
          color: '#41464a',
          proud: 0,
          clad: { dir: 'hpair', every: 3.2, every2: 0.8, w: 0.02, color: '#2a2e31' },
        },
      ] as CItem[]),
    );
    const tri = bk.get('cc_plaster_#a0907c')!;
    // Üçgen: yalnız 1 üçgen (3 köşe)
    expect(tri.idx.length).toBe(3);
    expect(bk.get('cc_clad:s:0.55:0.02:#373b3c_#242a28')).toBeDefined();
    expect(bk.get('cc_clad:p:3.2:0.02:#2a2e31:0.8_#41464a')).toBeDefined();
  });
  it('kemer açıklıklı çıkma (proj.arch): ön yüz delikli, kemer içi ölçülen renkte', () => {
    const bk = run(
      block([
        {
          t: 'proj',
          u0: 1,
          u1: 6,
          d: 1.45,
          y0: 1.8,
          y1: 6.5,
          color: '#607391',
          wins: [],
          arch: { u0: 1.05, u1: 5.5, y0: 1.8, top: 5.6, spring: 2.7, apex: 1.05, revealC: '#c8a032' },
        } as unknown as CItem,
      ]),
    );
    const rv = bbox(bk.get('cc_plaster_#c8a032'));
    expect(rv.x0).toBeCloseTo(-1.46, 1);
    expect(rv.y1).toBeCloseTo(5.6, 1);
    // Ön yüzde kemer bölgesinin ortası (u 3, y 3) boş
    const f = bk.get('cc_plaster_#607391')!;
    let hit = false;
    for (let j = 0; j < f.idx.length; j += 3) {
      const P = [0, 1, 2].map((c) => f.idx[j + c] * 3);
      if (P.some((i) => Math.abs(f.pos[i] + 1.46) > 0.01)) continue;
      const zs = P.map((i) => f.pos[i + 2]);
      const ys = P.map((i) => f.pos[i + 1]);
      if (Math.min(...zs) < 3 && Math.max(...zs) > 3 && Math.min(...ys) < 3 && Math.max(...ys) > 3)
        hit = true;
    }
    expect(hit).toBe(false);
  });
  it('glassUp: duvar üstünü aşan cam parapet dış yüzünü keser', () => {
    const mk = (glassUp: boolean) =>
      run(
        block([win({ u0: 1, u1: 7, sill: 0.1, head: 10.2, storeys: [1], stair: true, tint: '#8fa4ad' })], {
          kind: 'flat',
          eave: 0.02,
          fasciaH: 0.05,
          parapet: { h: 1.3, color: '#d9dee1', glassUp },
        }),
      );
    const cut = mk(true).get('cc_plaster_#d9dee1')!;
    const full = mk(false).get('cc_plaster_#d9dee1')!;
    expect(cut.idx.length).toBeGreaterThan(full.idx.length);
  });
});

describe('v9 — sokak türleri', () => {
  const ck = (k: string, h: string) => `cc_${k}_${h}`;
  const street = (items: unknown[], extra: Record<string, unknown> = {}) => {
    const b = new Builder();
    buildStreetPlan(
      b,
      { street: items, ...extra } as never,
      () => 0,
      () => 5,
      {
        colorKey: ck as never,
        signFace: (s) => `face:${s.text}:${(s.lines ?? []).map((l) => l.text).join('/')}:${s.fg}`,
      },
    );
    return b;
  };
  it('toneOf: tek ton ve aralık ortalaması', () => {
    expect(toneOf('#708F40')).toBe('#708f40');
    expect(toneOf(['#708f40', '#809a47'])).toBe('#789544');
    expect(toneOf('yeşil' as never)).toBeNull();
  });
  it('kavşak adası çayırı: biçilmiş kenar + kuru çayır tonu + öbekler', () => {
    const b = street([
      {
        kind: 'roundabout-island',
        x: 0,
        z: 0,
        rx: 20,
        rz: 22,
        h: 0.15,
        kerb: 'dış gri beton bordür (≈0.15) + iç alçak gri bordür (≈0.1) + çim',
        grass: { rx: 19.2, rz: 21.2, material: 'çim' },
        meadow: { rim: [3, 4], rimC: ['#708f40', '#809a47'], c: '#b09a65', h: [0.4, 0.6] },
      },
    ]);
    const bk = buckets(b);
    expect(bk.get('lawn@#789544')).toBeDefined();
    expect(bk.get('lawn@#b09a65')).toBeDefined();
    expect(bk.get('lawn')).toBeUndefined();
    expect(b.instanceCounts()['meadow_#b09a65']).toBeGreaterThan(300);
  });
  it('refüj çim tonu (grassC)', () => {
    const bk = buckets(
      street([
        {
          kind: 'island',
          x: 0,
          z: 0,
          h: 0.15,
          poly: [
            [0, 0],
            [2, 0],
            [2, -10],
            [0, -10],
          ],
          material: 'bordürlü çim orta refüj',
          grassC: '#5b792e',
        },
      ]),
    );
    expect(bk.get('lawn@#5b792e')).toBeDefined();
  });
  it('çıtalı çit (picket, sivri uç): çıta başına kutu + uç üçgenleri', () => {
    const plain = buckets(
      street([
        {
          kind: 'low-fence',
          x: 0,
          z: 0,
          pts: [
            [0, 0],
            [2.8, 0],
          ],
          h: 0.8,
          color: '#3b2a1e',
        },
      ]),
    );
    const pk = buckets(
      street([
        {
          kind: 'low-fence',
          x: 0,
          z: 0,
          pts: [
            [0, 0],
            [2.8, 0],
          ],
          h: 0.8,
          color: '#3b2a1e',
          style: 'picket',
          tip: 'point',
        },
      ]),
    );
    const n0 = plain.get('cc_plaster_#3b2a1e')!.idx.length / 3;
    const n1 = pk.get('cc_plaster_#3b2a1e')!.idx.length / 3;
    // ⌊(2.8 − 0.02) / 0.14⌋ = 19 çıta × (12 kutu + 4 uç) + 2 kuşak × 12
    expect(n1).toBe(19 * 16 + 24);
    expect(n0).toBe(12);
  });
  it('kanopi valans yazısı, dolap rengi, bayrak logosu', () => {
    const bk = buckets(
      street([
        {
          kind: 'canopy',
          x: 0,
          z: 0,
          a: [0, 0],
          e: [0, 8],
          d: 3,
          h: 3.2,
          fasciaH: 0.45,
          fasciaC: '#1e1f20',
          valance: { text: 'özhamur', fg: '#716f68' },
        },
        { kind: 'cabinet', x: 5, z: 5, h: 1.6, color: '#7b817d' },
        {
          kind: 'pole',
          x: 9,
          z: 9,
          h: 6.8,
          flag: { type: 'plain', color: '#caa33c', w: 1.2, h: 0.8, text: 'Ptt', fg: '#1e2a78' },
        },
      ]),
    );
    expect(bk.get('face:özhamur::#716f68')).toBeDefined();
    expect(bk.get('cc_plaster_#7b817d')).toBeDefined();
    expect(bk.get('cabinet')).toBeUndefined();
    expect(bk.get('face:Ptt::#1e2a78')).toBeDefined();
  });
  it('kış bahçesi: iki renkli alın yazısı ve çatı üstü harfler', () => {
    const poly = [
      [0, 0],
      [0, 5],
      [-3, 5],
      [-3, 0],
    ];
    const bk = buckets(
      street([
        {
          kind: 'enclosure',
          x: -1.5,
          z: 2.5,
          poly,
          h: 3,
          frame: '#1f2022',
          fasciaC: '#1c1f26',
          fasciaH: 0.45,
          fasciaText: 'Tarz-ı Pide',
          fasciaEdge: 0,
          fasciaParts: [
            { text: 'Tarz-ı', fg: '#9b4f59' },
            { text: 'Pide', fg: '#9c9fa7' },
          ],
        },
        {
          kind: 'enclosure',
          x: 10,
          z: 2.5,
          poly: poly.map(([x, z]) => [x + 12, z]),
          h: 3,
          frame: '#2f6b3a',
          fasciaC: '#12302c',
          fasciaH: 0.5,
          roofSign: {
            lines: [
              { text: 'GAZİANTEP', size: 0.35 },
              { text: 'ZEUGMA KÜNEFE', size: 1 },
            ],
            fg: '#ae9f7d',
            h: 1,
            frameC: '#1f2124',
            edge: 0,
          },
        },
      ]),
    );
    expect(bk.get('face:Tarz-ı::#9b4f59')).toBeDefined();
    expect(bk.get('face:Pide::#9c9fa7')).toBeDefined();
    const rs = bbox(bk.get('face::GAZİANTEP/ZEUGMA KÜNEFE:#ae9f7d'));
    expect(rs.y0).toBeGreaterThan(3);
    expect(bk.get('cc_frame_#1f2124')).toBeDefined();
  });
  it('totem kapsül başı: ince gövde + uçları yuvarlak pano', () => {
    const bk = buckets(
      street([
        {
          kind: 'totem',
          x: 0,
          z: 0,
          w: 0.9,
          d: 0.5,
          h: 15,
          color: '#e8ebe6',
          bg: '#d6e7c5',
          bodyW: 0.45,
          head: { shape: 'capsule', y0: 8.8, y1: 15, w: 1.5, d: 0.5, color: '#d6e7c5' },
        },
      ]),
    );
    const hd = bbox(bk.get('cc_fascia_#d6e7c5'));
    expect(hd.y0).toBeCloseTo(8.8 + 0.15, 1);
    expect(hd.y1).toBeCloseTo(15 + 0.15, 1);
    expect(hd.x1 - hd.x0).toBeCloseTo(1.5, 1);
    const body = bbox(bk.get('cc_fascia_#e8ebe6'));
    expect(body.x1 - body.x0).toBeLessThan(0.5);
  });
});
