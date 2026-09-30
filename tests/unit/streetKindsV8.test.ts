import { describe, expect, it } from 'vitest';
import { Builder } from '../../src/worlds/measured/builder';
import { buildStreetPlan, kerbPaintOf, signTextKeys } from '../../src/worlds/measured/street';
import { wordTone } from '../../src/worlds/measured/streetKinds';
import STREET_PLAN from '../../src/worlds/measured/data/street-plan.json';

type Bk = { pos: number[]; idx: number[]; uv: number[] };
const bks = (b: Builder) => (b as unknown as { buckets: Map<string, Bk> }).buckets;
const ck = (k: string, h: string) => `cc_${k}_${h}`;
const build = (street: unknown[], sidewalks: unknown[] = []) => {
  const b = new Builder();
  const res = buildStreetPlan(
    b,
    { street, sidewalks } as never,
    () => 0,
    () => 5,
    {
      colorKey: ck as never,
      signFace: (sg) => `face:${sg.text}:${sg.banner ?? ''}`,
    },
  );
  return { bk: bks(b), res, b };
};
const total = (r: { bk: Map<string, Bk>; b: Builder }) =>
  [...r.bk.values()].reduce((a, v) => a + v.idx.length, 0) +
  Object.values(r.b.instanceCounts()).reduce((a, v) => a + v, 0);
const tris = (bk: Map<string, Bk>, re: RegExp) =>
  [...bk.entries()].filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v.idx.length / 3, 0);

describe('v8 bordür boyası (yeşil / beyaz gruplar)', () => {
  it('malzeme metninden renk, grup, yalnız yüz; "boya yok" → boyasız', () => {
    const p = kerbPaintOf(
      'bordür taşları gruplar hâlinde dönüşümlü yeşil (#8e948e / gölgede #5e7872) ve beyaz (#a6a49f) boyalı (≈3 taş yeşil + 3 taş beyaz)',
    );
    expect(p).toEqual({ colors: ['#8e948e', '#a6a49f'], group: 3, face: false });
    expect(kerbPaintOf('gri beton bordür, yola bakan yüzü yeşil/beyaz dönüşümlü boyalı')?.face).toBe(true);
    expect(kerbPaintOf('gri beton bordür (yeşil/beyaz boya yok), çim')).toBeNull();
    expect(kerbPaintOf('gri beton bordür')).toBeNull();
    expect(kerbPaintOf('', 'white')).toBeNull();
    expect(kerbPaintOf('', { colors: ['#112233'], group: 2 })).toEqual({
      colors: ['#112233'],
      group: 2,
      face: false,
    });
  });
  it('kaldırım bordürü taş taş iki renkte boyanır (grup 3)', () => {
    const { bk } = build(
      [],
      [
        {
          id: 't',
          pts: [
            [0, 0],
            [0, -14.4],
          ],
          w: 2,
          side: 'left',
          kerbH: 0.15,
          layers: [{ w: 1.8, material: 'gri kilit taşı', h: 0.15 }],
          material: 'bordür yeşil (#5e7872) / beyaz (#979896) boyalı',
        },
      ],
    );
    // 14.4 / 0.72 = 20 taş: yüz (2 üçgen) + üst örtü (drape) — iki renk kovası
    expect(tris(bk, /cc_paint_#5e7872/)).toBeGreaterThan(20);
    expect(tris(bk, /cc_paint_#979896/)).toBeGreaterThan(20);
  });
  it('ayrım adası ve kavşak adası bordürleri de boyanır', () => {
    const { bk } = build([
      {
        kind: 'island',
        x: 0,
        z: -10,
        h: 0.15,
        poly: [
          [-0.45, 0],
          [0.45, 0],
          [0.45, -20],
          [-0.45, -20],
        ],
        material: 'kiremit-kırmızı beton kilit taşı dar orta ayırıcı',
        note: 'yeşil/beyaz boyalı bordürler + arada kiremit-kırmızı kilit taşı',
      },
    ]);
    expect(tris(bk, /cc_paint_/)).toBeGreaterThan(40);
    // Dar ayırıcının yüzeyi çizilir (içe kaydırma kendini kesmez / ters dönmez)
    expect(tris(bk, /spPaverRed/)).toBeGreaterThan(0);
  });
});

describe('v8 levha / pano / bayrak / geçit / sinyal', () => {
  it('yaya geçidi ve otobüs durağı levhaları yalnız metinden', () => {
    expect(signTextKeys('yaya geçidi (mavi kare, beyaz üçgende yaya)')).toEqual(['signPedestrian']);
    expect(signTextKeys('otobüs durağı levhası')).toEqual(['signBusStop']);
    const { bk } = build([
      { kind: 'sign', x: 0, z: 0, h: 2.6, text: 'otobüs durağı levhası' },
      { kind: 'sign', x: 3, z: 0, h: 2.6, text: 'yaya geçidi', note: '' },
    ]);
    expect(bk.get('signBusStop')?.idx.length).toBeGreaterThan(0);
    expect(bk.get('signPedestrian')?.idx.length).toBeGreaterThan(0);
  });
  it('çift yüzlü raket pano iki yüz, diş biçimli pano silüet', () => {
    const one = build([{ kind: 'board', x: 0, z: 0, w: 1.25, h: 1.8, y0: 0.45, d: 0.12, bg: '#f2f2ee' }]);
    const two = build([
      {
        kind: 'board',
        x: 0,
        z: 0,
        w: 1.25,
        h: 1.8,
        y0: 0.45,
        d: 0.12,
        bg: '#f2f2ee',
        note: 'çift yüzlü "raket"',
      },
    ]);
    expect(tris(two.bk, /^face:/)).toBe(2 * tris(one.bk, /^face:/));
    const tooth = build([
      {
        kind: 'board',
        x: 0,
        z: 0,
        w: 0.6,
        h: 1.1,
        y0: 0.1,
        d: 0.05,
        bg: '#ffffff',
        text: 'ULU',
        note: 'diş biçimli ayaklı pano',
      },
    ]);
    // Silüet: 20 köşeli çokgen ekstrüzyonu (dikdörtgen kutu 12 üçgen)
    expect(tris(tooth.bk, /cc_fascia_#ffffff/)).toBeGreaterThan(40);
  });
  it('Türk bayraklı direk kumaş çizer; deseni seçilemeyen bayrak çizilmez', () => {
    const a = build([{ kind: 'pole', x: 0, z: 0, h: 8, note: 'bayrak direği (Türk bayrağı; SV …)' }]);
    expect(tris(a.bk, /^face::tr$/)).toBeGreaterThan(0);
    const b = build([
      {
        kind: 'pole',
        x: 0,
        z: 0,
        h: 8,
        note: 'İkinci bayrak direği (mavi-beyaz kurumsal bayrak — deseni seçilemedi)',
      },
    ]);
    expect(tris(b.bk, /^face:/)).toBe(0);
    expect(tris(b.bk, /steel/)).toBeGreaterThan(0);
  });
  it('şeritsiz kırmızı bant geçidi tek dikdörtgen', () => {
    const { bk } = build([
      {
        kind: 'crossing',
        x: 0,
        z: 0,
        rot: 90,
        len: 12,
        w: 1.7,
        stripes: 'kırmızı bant (şerit yok)',
        color: '#9a4a45',
      },
    ]);
    expect(tris(bk, /cc_asphalt_#9a4a45/)).toBeGreaterThan(0);
  });
  it('konsol direkli sinyal: kol + asılı baş', () => {
    const plain = build([{ kind: 'traffic-signal', x: 0, z: 0, h: 5.5, rot: 0 }]);
    const arm = build([{ kind: 'traffic-signal', x: 0, z: 0, h: 5.5, rot: 0, arm: 4 }]);
    expect(tris(arm.bk, /pole/)).toBeGreaterThan(tris(plain.bk, /pole/));
  });
  it('yol piktogramı ve basamak dizisi (yürüme kotu)', () => {
    const { bk, res } = build([
      { kind: 'road-symbol', x: 0, z: 0, w: 2.4, d: 1, rot: 180 },
      {
        kind: 'steps-line',
        x: 0,
        z: 10,
        pts: [
          [-5, 10],
          [5, 10],
        ],
        n: 3,
        rise: 0.9,
        color: '#b8b3a8',
      },
    ]);
    expect(bk.get('roadSignalPicto')?.idx.length).toBeGreaterThan(0);
    expect(tris(bk, /cc_plaster_#b8b3a8/)).toBeGreaterThan(0);
    expect(
      res.raised.filter((r) => Math.abs(r.h - 0.9 - 0.15) < 0.01 || Math.abs(r.h - 0.9) < 0.01).length,
    ).toBe(1);
  });
});

describe('v8 D4 sokak eşyası türleri', () => {
  it('her yeni tür geometri üretir', () => {
    const items: [string, Record<string, unknown>][] = [
      ['gabion', { w: 3.5, d: 1.2, h: 0.8, color: '#6c6758', note: 'yol boyunca' }],
      [
        'bus-shelter',
        {
          w: 4.2,
          d: 1.5,
          h: 2.5,
          rot: 270,
          color: '#9aa0a3',
          note: 'güney ucunda turuncu ışıklı reklam panosu',
        },
      ],
      [
        'waste-container',
        { w: 1.37, d: 1.07, h: 1.3, color: '#6b705f', text: 'NİLÜFER BELEDİYESİ', rot: 270 },
      ],
      ['bollard-light', { h: 0.7, color: '#f2f2ee' }],
      [
        'low-fence',
        {
          pts: [
            [0, 0],
            [0, -8],
          ],
          h: 1,
          color: '#1e1f20',
        },
      ],
      ['feather-flag', { h: 3, color: '#e60000', text: 'vodafone' }],
      ['flower-arch', { w: 5, h: 3.2, color: '#c8202c' }],
      ['cart', { w: 2.6, d: 0.6, h: 1, n: 3, color: '#c3262b', text: 'W YILDIZLI ÜRÜNLER' }],
      ['mat', { w: 1.5, d: 0.9, color: '#b3262a' }],
      ['pouf', { w: 2.2, d: 0.5, h: 0.4, n: 5, color: '#9a5a2e' }],
      ['ac-unit', { w: 0.8, d: 0.3, h: 0.6, color: '#e8e8e4', rot: 180 }],
      ['stone-bollard', { h: 0.5, color: '#b8b3a8' }],
      ['kiosk', { w: 1, d: 1, h: 2.4, color: '#d52b1e', text: 'AKBANK' }],
      [
        'ac-cage',
        {
          poly: [
            [0, 0],
            [2.4, -0.6],
            [2.7, 0.7],
            [0.3, 1.3],
          ],
          h: 1.8,
          color: '#9a9c9a',
        },
      ],
      ['statue', { h: 2, color: '#f0f0ec', note: 'Bowling lobutu figürü' }],
    ];
    for (const [kind, f] of items) {
      expect(total(build([{ kind, x: 0, z: 0, ...f }])), kind).toBeGreaterThan(0);
    }
  });
  it('durak reklam panosu nottan: güney ucu, turuncu, ışıklı', () => {
    const { bk } = build([
      {
        kind: 'bus-shelter',
        x: 0,
        z: 0,
        w: 4.2,
        d: 1.5,
        h: 2.5,
        rot: 270,
        note: 'güney ucunda turuncu ışıklı reklam panosu',
      },
    ]);
    expect([...bk.keys()].some((k) => k.startsWith('face::'))).toBe(true);
    expect(wordTone('turuncu ışıklı')).toBe('#d9742e');
  });
  it("street-plan.json'daki tüm d4 türleri işlenir (sessizce atlanan tür yok)", () => {
    const plan = STREET_PLAN as { street: { id?: string; kind: string }[] };
    const kinds = [
      ...new Set(plan.street.filter((s) => String(s.id ?? '').startsWith('d4')).map((s) => s.kind)),
    ];
    // Çizim yapmayan bilinçli tür: steps-note (cephe öğesi kaydı); tree (ağaç kütüphanesinde)
    // wear + crossing: yalnız bağlı geçidin şeritlerini aşındırır (ayrı testte)
    const silent = new Set(['steps-note', 'tree', 'wear']);
    for (const kind of kinds) {
      if (silent.has(kind)) continue;
      const s = plan.street.find((q) => q.kind === kind && String(q.id ?? '').startsWith('d4'))!;
      expect(total(build([s])), `${kind} (${s.id})`).toBeGreaterThan(0);
    }
  });
});

describe('v8 köşe meydanı kaldırımla örtüşmez (critic c-02)', () => {
  it('site sert zemini kaldırım çokgenlerinden kırpılır', async () => {
    const { cutAreaBy } = await import('../../src/worlds/measured/siteplan');
    const area: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const walk: [number, number][] = [
      [-1, -1],
      [11, -1],
      [11, 3],
      [-1, 3],
    ];
    const parts = cutAreaBy(area, [walk]);
    expect(parts.length).toBe(1);
    const zs = parts[0][0].map((p) => p[1]);
    expect(Math.min(...zs)).toBeCloseTo(3);
    expect(
      cutAreaBy(area, [
        [
          [50, 50],
          [51, 50],
          [51, 51],
        ],
      ])[0][0],
    ).toBe(area);
  });
});

describe('v8 D4 yol yüzeyi (d4r-*)', () => {
  it('yol işaretleri: ok, sinyal üçgeni, yol ver, yazı, okunamayan yazı', () => {
    const one = (f: Record<string, unknown>) =>
      build([{ kind: 'road-symbol', x: 0, z: 0, rot: 180, color: '#e8e8e4', ...f }]).bk;
    expect(
      tris(one({ symbol: 'arrow-straight', w: 0.6, d: 5, wear: 0.3 }), /cc_wear|cc_asphalt/),
    ).toBeGreaterThan(0);
    const st = one({
      symbol: 'signal-triangle',
      w: 2,
      d: 3.4,
      border: '#b0473f',
      note: 'Kırmızı kenarlı beyaz üçgen içinde kırmızı-sarı-yeşil üç disk',
    });
    expect(tris(st, /#b0473f/)).toBeGreaterThan(1);
    expect(tris(st, /#2e6f3c/)).toBeGreaterThan(0);
    expect(
      tris(one({ symbol: 'giveway-triangle', w: 1.8, d: 3.2, border: '#b0473f' }), /#b0473f/),
    ).toBeGreaterThan(0);
    expect(tris(one({ symbol: 'text', text: '30', w: 1.2, d: 4.5 }), /^face:30/)).toBeGreaterThan(0);
    const worn = one({ symbol: 'text', text: null, w: 2.5, d: 1.5, wear: 0.6, note: 'iki satırlık yazı' });
    expect([...worn.keys()].some((k) => k.startsWith('face:'))).toBe(false);
    expect(tris(worn, /cc_wear/)).toBeGreaterThan(4);
  });
  it('geçide bağlı aşınma şeritlere işlenir, ayrı örtü çizilmez', () => {
    const cr = {
      kind: 'crossing',
      id: 'z1',
      x: 0,
      z: 0,
      rot: 90,
      len: 10,
      w: 3.5,
      stripes: 'beyaz zebra 0.5/0.5 m',
    };
    const plain = build([cr]).bk;
    const worn = build([
      cr,
      {
        kind: 'wear',
        x: 0,
        z: 0,
        crossing: 'z1',
        amount: 0.4,
        poly: [
          [-5, -2],
          [5, -2],
          [5, 2],
          [-5, 2],
        ],
      },
    ]).bk;
    expect(plain.get('spPaint')?.idx.length).toBeGreaterThan(0);
    // İzdeki şeritler aşınma kademeli boya, diğerleri hafif aşınmış; yol tonlu örtü yok
    expect([...worn.keys()].filter((k) => k.startsWith('spPaintWear')).length).toBeGreaterThan(1);
    expect([...worn.keys()].some((k) => k.startsWith('cc_wear'))).toBe(false);
  });
  it('rögar halkası ve refüj kapağı', () => {
    const ring = build([
      { kind: 'manhole', x: 0, z: 0, r: 0.35, color: '#6a6c67', ring: { r: 0.45, color: '#5a6269' } },
    ]).bk;
    expect(tris(ring, /#5a6269/)).toBeGreaterThan(0);
    const med = build([
      {
        kind: 'island',
        x: 0,
        z: 0,
        h: 0.15,
        poly: [
          [-2, -10],
          [2, -10],
          [2, 10],
          [-2, 10],
        ],
        material: 'bordürlü çim',
      },
      { kind: 'manhole', x: 2.3, z: 0, r: 0.33, surface: 'median', color: '#797d7e' },
    ]).bk;
    const bk = med.get('cc_tar_#797d7e');
    const ys = bk!.pos.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(0.15);
  });
});
