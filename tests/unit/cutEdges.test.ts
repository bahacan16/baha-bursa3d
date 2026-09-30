import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Builder } from '../../src/worlds/mertkent/builder';
import {
  buildFacadeBlock,
  clipItemsAbove,
  type CItem,
  type CompiledBlock,
  type CWin,
} from '../../src/worlds/mertkent/facade';
import { splitMassing } from '../../src/worlds/mertkent/massing';

type Bucket = { pos: number[] };
const buckets = (b: Builder) => (b as unknown as { buckets: Map<string, Bucket> }).buckets;
const verts = (bk: Bucket | undefined) => {
  const out: [number, number, number][] = [];
  if (bk) for (let i = 0; i < bk.pos.length; i += 3) out.push([bk.pos[i], bk.pos[i + 1], bk.pos[i + 2]]);
  return out;
};

const win = (u0: number, u1: number, storeys: number[], o: Partial<CWin> = {}): CWin => ({
  t: 'win',
  u0,
  u1,
  sill: 0.9,
  head: 2.2,
  storeys,
  kind: 'std',
  rail: false,
  split: 2,
  box: false,
  ...o,
});
const sign = (u0: number, u1: number): CItem =>
  ({
    t: 'sign',
    u0,
    u1,
    y0: 7,
    y1: 8,
    d: 0.1,
    text: 'X',
    lines: null,
    bg: null,
    fg: '#ffffff',
    border: null,
    style: 'box',
    font: 'sans',
    bold: true,
    lit: false,
  }) as CItem;

// Taban izi x ∈ [0, 20], z ∈ [0, 8]; kule x ≤ 6 (4 kat), kalan 1 katlı podyum. Kulenin doğu kesim yüzü x = 6,
// halka yönünde kuzeye (−z): a = (6, 8) → e = (6, 0), dış normal +x.
const block = (extra: Partial<CompiledBlock> = {}, towerPoly?: [number, number][]): CompiledBlock => ({
  id: 7,
  name: null,
  ring: [
    [0, 0],
    [0, 8],
    [20, 8],
    [20, 0],
  ],
  storeys: 4,
  floorH: 3,
  groundRaise: 0.5,
  roof: { kind: 'flat', eave: 0.3, fasciaH: 0.3 },
  colors: {},
  edges: [
    { edge: 0, len: 8, seen: 'photo', items: [win(2, 3, [0, 1, 2, 3])] },
    { edge: 1, len: 20, seen: 'photo', items: [] },
    { edge: 2, len: 8, seen: 'photo', items: [] },
    { edge: 3, len: 20, seen: 'photo', items: [] },
  ],
  massing: {
    towers: [
      towerPoly ? { poly: towerPoly, storeys: 4 } : { x: [0, 6], storeys: 4 },
      { rest: true, storeys: 1 },
    ],
  },
  ...extra,
});
const cut = (o: Partial<NonNullable<CompiledBlock['cutEdges']>[number]>) => ({
  part: 0 as number | 'gap',
  a: [6, 8] as [number, number],
  e: [6, 0] as [number, number],
  len: 8,
  seen: 'photo',
  items: [] as CItem[],
  ...o,
});
/** Parça halkasında x = X doğrusundaki kenar(lar)ın öğeleri */
const cutEdgesOf = (p: CompiledBlock, X: number) =>
  p.edges.filter((e) => {
    const a = p.ring[e.edge];
    const b = p.ring[(e.edge + 1) % p.ring.length];
    return Math.abs(a[0] - X) < 0.01 && Math.abs(b[0] - X) < 0.01;
  });

describe('v8 kesim yüzü kenarları (cutEdges)', () => {
  it('yokken bölünme aynı; varken yalnız kesim kenarı eklenir', () => {
    const plain = splitMassing(block());
    const withCut = splitMassing(block({ cutEdges: [cut({ items: [win(2, 3, [2, 3])] })] }));
    expect(plain.length).toBe(withCut.length);
    // Kule: taban izi kenarları aynı, x = 6 kesim kenarı öğeli
    const cutE = cutEdgesOf(withCut[0], 6);
    expect(cutEdgesOf(plain[0], 6)).toHaveLength(0);
    expect(cutE).toHaveLength(1);
    expect(cutE[0].items[0]).toMatchObject({ t: 'win', u0: 2, u1: 3, storeys: [2, 3] });
    expect(withCut[0].edges.filter((e) => !cutE.includes(e))).toEqual(plain[0].edges);
    // Podyum etkilenmez (başka parça; ters yönlü kenar)
    expect(withCut[1].edges).toEqual(plain[1].edges);
    expect(withCut[0].cutEdges).toBeUndefined();
  });

  it('ters yazılmış doğru ve başka parça eşleşmez; podyum parçası kendi yönünde alır', () => {
    const rev = splitMassing(block({ cutEdges: [cut({ a: [6, 0], e: [6, 8], items: [win(2, 3, [2])] })] }));
    expect(cutEdgesOf(rev[0], 6)).toHaveLength(0);
    const pod = splitMassing(
      block({ cutEdges: [cut({ part: 1, a: [6, 0], e: [6, 8], items: [win(1, 2, [0])] })] }),
    );
    expect(cutEdgesOf(pod[0], 6)).toHaveLength(0);
    expect(cutEdgesOf(pod[1], 6)[0].items[0]).toMatchObject({ u0: 1, u1: 2 });
  });

  it('kırıklı yüz: öğeler u’suna göre kenarlara dağılır, kırıkta kırpılır; tabela orta noktasının kenarında', () => {
    // Kule doğu yüzü kırıklı: z 0–4 x = 6, z 4–8 x = 6.8 (tol 1 içinde)
    const poly: [number, number][] = [
      [0, 0],
      [6, 0],
      [6, 4],
      [6.8, 4],
      [6.8, 8],
      [0, 8],
    ];
    const parts = splitMassing(
      block(
        {
          cutEdges: [
            cut({
              a: [6.4, 8],
              e: [6.4, 0],
              tol: 1,
              items: [win(1, 3, [2]), win(3.5, 4.5, [2]), sign(3.6, 4.6)],
            }),
          ],
        },
        poly,
      ),
    );
    const n = cutEdgesOf(parts[0], 6.8)[0]; // u 0–4 (a’dan)
    const s = cutEdgesOf(parts[0], 6)[0]; // u 4–8 → yerel u − 4
    const r2 = (v: number) => Math.round(v * 100) / 100;
    expect(n.items.map((i) => [i.t, r2((i as CWin).u0), r2((i as CWin).u1)])).toEqual([
      ['win', 1, 3],
      ['win', 3.5, 4],
    ]);
    expect(s.items.map((i) => [i.t, r2((i as CWin).u0), r2((i as CWin).u1)])).toEqual([
      ['win', 0, 0.5],
      ['sign', -0.4, 0.6],
    ]);
  });

  it('kesim kenarındaki pencere duvarı keser (cam kule yüzünde, K2 kotunda)', () => {
    const glassOn = (blk: CompiledBlock) => {
      const b = new Builder();
      for (const p of splitMassing(blk)) buildFacadeBlock(b, p, 0, { seed: 1 });
      return verts(buckets(b).get('mkGlass')).filter(
        ([x, y, z]) => x > 5.6 && x < 6.05 && z > 5.9 && z < 7.1 && y > 6.5 + 0.8 && y < 6.5 + 2.3,
      ).length;
    };
    expect(glassOn(block())).toBe(0);
    // u 1–2 → z 7–6 (a = (6, 8)’den kuzeye)
    expect(glassOn(block({ cutEdges: [cut({ items: [win(1, 2, [2])] })] }))).toBeGreaterThan(0);
  });
});

describe('v8 baseH (podyum üstündeki kule)', () => {
  const floorRel = (k: number) => 0.5 + 3 * k;
  it('clipItemsAbove: gizli katlar ve tamamen altta kalan öğeler atılır, bantlar kırpılır', () => {
    const its: CItem[] = [
      win(1, 2, [0, 1, 2, 3]),
      win(3, 4, [0]),
      { t: 'band', u0: 0, u1: 8, y0: 2, y1: 4, color: 'strip', proud: 0 } as CItem,
      { t: 'panel', u0: 0, u1: 8, y0: 0, y1: 3, color: 'strip', proud: 0 } as CItem,
      { t: 'ac', u: 2, s: 0, y: 1, onBal: false } as CItem,
      { t: 'ac', u: 2, s: 1, y: 1, onBal: false } as CItem,
      { t: 'entrance', u0: 1, u1: 2, kind: 'door', canopy: false, sign: null, steps: null } as CItem,
    ];
    const out = clipItemsAbove(its, 3.5, floorRel);
    expect(out.map((i) => i.t)).toEqual(['win', 'band', 'ac']);
    expect((out[0] as CWin).storeys).toEqual([1, 2, 3]);
    expect(out[1]).toMatchObject({ y0: 3.5, y1: 4 });
    expect(out[2]).toMatchObject({ s: 1 });
  });

  it('duvar ve subasman baseH’nin altında çizilmez; yokken zeminden', () => {
    const one = (extra: Partial<CompiledBlock>) => {
      const b = new Builder();
      const blk = block(extra);
      buildFacadeBlock(b, { ...blk, massing: undefined }, 0, { seed: 1 });
      const bk = buckets(b);
      const ys = [...bk.entries()]
        .filter(([k]) => k.startsWith('mkPlaster') || k === 'mkPlinth')
        .flatMap(([, v]) => verts(v).map((p) => p[1]));
      return { minY: Math.min(...ys), plinth: verts(bk.get('mkPlinth')).length };
    };
    const plain = one({});
    expect(plain.minY).toBeLessThan(0);
    expect(plain.plinth).toBeGreaterThan(0);
    const tower = one({ baseH: 3.5 });
    expect(tower.minY).toBeGreaterThan(3.49);
    expect(tower.plinth).toBe(0);
  });
});

describe('v8 derleyici (survey-compile.mjs)', () => {
  it('gerçek m / cal kesim kenarları, copyOf ayna, startK → baseH; cutEdges yokken çıktı alanı yok', () => {
    const root = join(__dirname, '..', '..');
    const id = 1551828351;
    const sv = JSON.parse(readFileSync(join(root, 'src/worlds/mertkent/survey', `${id}.json`), 'utf8'));
    const dir = mkdtempSync(join(tmpdir(), 'cut-'));
    const outP = join(dir, 'out.json');
    const compile = (s: unknown) => {
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(s));
      writeFileSync(outP, '{}');
      execFileSync(
        process.execPath,
        ['--experimental-strip-types', 'scripts/survey-compile.mjs', String(id)],
        {
          cwd: root,
          env: { ...process.env, SURVEY_DIR: dir, SURVEY_OUT: outP },
          stdio: 'pipe',
        },
      );
      return JSON.parse(readFileSync(outP, 'utf8'))[id];
    };
    const bare = { ...sv };
    delete bare.cutEdges;
    const b0 = compile(bare);
    expect(b0.cutEdges).toBeUndefined();
    expect(b0.baseH).toBeUndefined();
    const L = Math.hypot(0, 23);
    const w = { t: 'win', u0: 6, u1: 8, y0: 4, y1: 5, k: 2, s: [2, 3], split: 3 };
    const b1 = compile({
      ...bare,
      startK: 2,
      cutEdges: [
        // Gerçek m: kule (floorHs 5, 5.05, 3.05 …) K2 döşemesi 0.3 + 10.05 = 10.35
        {
          part: 2,
          a: [592.6, -577.5],
          e: [592.6, -600.5],
          seen: 'photo',
          items: [{ ...w, y0: 10.35, y1: 12.2 }],
        },
        // cal: görünen u 1 → a, 11 → e (×2.3); lento görünen K2 5, K3 6 → düşey ölçek 3.05 m / birim
        {
          part: 2,
          a: [592.6, -577.5],
          e: [592.6, -600.5],
          seen: 'photo',
          cal: {
            u: [1, 11],
            head: [
              [2, 5],
              [3, 6],
            ],
          },
          items: [w, { t: 'ac', u: 3, s: 3, y: 5.5 }],
        },
        { part: 2, a: [592.6, -577.5], e: [592.6, -600.5], seen: 'none', copyOf: 1, mirror: true, items: [] },
      ],
    });
    const [c0, c1, c2] = b1.cutEdges;
    expect(c0).toMatchObject({ part: 2, len: L, seen: 'photo' });
    expect(c0.items[0]).toMatchObject({
      t: 'win',
      u0: 6,
      u1: 8,
      sill: 0,
      head: 1.85,
      storeys: [2, 3],
      split: 3,
    });
    expect(c1.items[0]).toMatchObject({ u0: 11.5, u1: 16.1, sill: -0.8, head: 2.25 });
    // Klima: görünen y 5.5 → K2 lento 10.35 + 2.25 + 0.5 × 3.05; K3 döşemesine göre (13.4)
    expect(c1.items[1].y).toBeCloseTo(10.35 + 2.25 + 1.525 - 13.4, 2);
    // Kopya: yalnız geometri (klima yok), ayna
    expect(c2.items.map((i: { t: string }) => i.t)).toEqual(['win']);
    expect(c2.items[0]).toMatchObject({ u0: 6.9, u1: 11.5 });
    // startK 2: blok floorHs [5], floorH 3.05 → 0.3 + 5 + 3.05
    expect(b1.baseH).toBeCloseTo(8.35, 2);
    // Diğer alanlar cutEdges'ten bağımsız
    expect({ ...b1, cutEdges: undefined, baseH: undefined }).toEqual({ ...b0, cutEdges: undefined });
  }, 30000);
});
