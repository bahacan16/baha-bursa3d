import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Builder } from '../../src/worlds/measured/builder';
import { buildStreetPlan } from '../../src/worlds/measured/street';
import { buildSitePlan, hedgeTint, roadMarksOf, HEDGE_TEX_AVG } from '../../src/worlds/measured/siteplan';
import { enclosureClosedSpans, fasciaBold, fasciaSigns } from '../../src/worlds/measured/streetFurniture';
import { projWinKind, PROJ_BAND_KIND } from '../../src/worlds/measured/facade';
import { famOf, SCRIPT_FONT } from '../../src/worlds/measured/textures';
import { buildRoads, inNoDash } from '../../src/worlds/osm/roads';
import type { Road } from '../../src/worlds/osm/parse';
import { ChunkedGeometry } from '../../src/worlds/osm/chunks';
import { SPECIES_DEFS, thinCards } from '../../src/worlds/osm/treelib';
import {
  glassEnvUniform,
  OFFICE_ENV,
  officeEnvUniform,
  tintEnvUniform,
  windowGlassMaterial,
  withGlassEnv,
} from '../../src/worlds/measured/facadeMats';

type Bucket = { pos: number[]; idx: number[] };
const buckets = (b: Builder) => (b as unknown as { buckets: Map<string, Bucket> }).buckets;

describe('D4 kod r2 #1: ölçülen çit tonu', () => {
  const line = (color?: string) => ({
    lines: [
      {
        kind: 'hedge',
        pts: [
          [0, 0],
          [0, -10],
        ],
        h: 1.1,
        w: 0.9,
        ...(color ? { color } : {}),
      },
    ],
  });
  it('color verilen çit hedge@ / hedgeLeaf@ çeşidine, verilmeyen sabit malzemeye gider', () => {
    const b0 = new Builder();
    buildSitePlan(b0, line() as never, () => 0);
    expect(buckets(b0).has('hedge')).toBe(true);
    expect([...buckets(b0).keys()].some((k) => k.includes('@'))).toBe(false);
    const b1 = new Builder();
    buildSitePlan(b1, line('#2F5529') as never, () => 0);
    expect(buckets(b1).has('hedge')).toBe(false);
    expect(buckets(b1).has('hedge@#2f5529')).toBe(true);
    expect(buckets(b1).has('hedgeLeaf@#2f5529')).toBe(true);
  });
  it('hedgeTint: doku ortalaması × çarpan = ölçülen ton', () => {
    const c = hedgeTint('#2f5529');
    const avg = new THREE.Color(HEDGE_TEX_AVG);
    const tgt = new THREE.Color('#2f5529');
    expect(avg.r * c.r).toBeCloseTo(tgt.r, 5);
    expect(avg.g * c.g).toBeCloseTo(tgt.g, 5);
    expect(avg.b * c.b).toBeCloseTo(tgt.b, 5);
    expect(hedgeTint('#2f5529', true).equals(c)).toBe(false);
  });
});

describe('D4 kod r2 #2: açık cepheli kapatma', () => {
  it('enclosureClosedSpans: open yoksa tüm kenar, kenar indeksi → kapalı yok, aralık → iki parça', () => {
    expect(enclosureClosedSpans(undefined, 1, 29)).toEqual([[0, 29]]);
    expect(enclosureClosedSpans([1], 1, 29)).toEqual([]);
    expect(enclosureClosedSpans([1], 0, 9.2)).toEqual([[0, 9.2]]);
    expect(enclosureClosedSpans([{ edge: 1, u0: 8.4, u1: 27.5 }], 1, 29)).toEqual([
      [0, 8.4],
      [27.5, 29],
    ]);
  });
  const enc = (open?: unknown) => {
    const b = new Builder();
    buildStreetPlan(
      b,
      {
        street: [
          {
            kind: 'enclosure',
            x: 2,
            z: -5,
            poly: [
              [0, 0],
              [4, 0],
              [4, -10],
              [0, -10],
            ],
            h: 3,
            glass: '#1b1b15',
            frame: '#2a2c2e',
            ...(open ? { open } : {}),
          },
        ],
      } as never,
      () => 0,
      () => 5,
      { colorKey: ((k: string, h: string) => `cc_${k}_${h}`) as never },
    );
    return buckets(b);
  };
  const xsOf = (bk: Bucket | undefined) => {
    const out: number[] = [];
    if (bk) for (let i = 0; i < bk.pos.length; i += 3) out.push(bk.pos[i]);
    return out;
  };
  it('açık kenarda cam ve ara dikme yok, diğer kenarlar aynı', () => {
    const a = enc();
    const o = enc([1]);
    const gA = a.get('cc_encglass_#1b1b15')!;
    const gO = o.get('cc_encglass_#1b1b15')!;
    expect(gA.idx.length / 3).toBe(8);
    expect(gO.idx.length / 3).toBe(6);
    // kenar 1 = x 4 düzlemi: camda x = 4 köşesi yalnız komşu kenarların uçlarında (tam kenar quad'ı yok)
    const onEdge = xsOf(gO).filter((x) => Math.abs(x - 4) < 1e-6).length;
    expect(onEdge).toBe(4);
    // dikme sayısı (çerçeve kutuları): açık kenarın ara dikmeleri eksik
    const fA = a.get('cc_frame_#2a2c2e')!.idx.length;
    const fO = o.get('cc_frame_#2a2c2e')!.idx.length;
    expect(fO).toBeLessThan(fA);
  });
  it('kısmi açık aralık: cam iki parçaya bölünür, uçlarda dikme', () => {
    const o = enc([{ edge: 1, u0: 3, u1: 8 }]);
    const g = o.get('cc_encglass_#1b1b15')!;
    expect(g.idx.length / 3).toBe(10);
  });
});

describe('D4 kod r2 #3: kesimde kesikli çizgi yok', () => {
  const road = {
    id: 'w1',
    kind: 'secondary',
    pts: [
      [0, -300],
      [0, -600],
    ],
    width: 9.6,
    sidewalkLeft: false,
    sidewalkRight: false,
    layer: 0,
    bridge: false,
    tunnel: false,
    area: false,
    vehicular: true,
    oneway: 1,
    lanes: 3,
  } as Road;
  const zs = (g: ChunkedGeometry) => {
    const out: number[] = [];
    for (const c of g.toPayload())
      if (c.mat === 'marking') for (let i = 2; i < c.position.length; i += 3) out.push(c.position[i]);
    return out;
  };
  it('inNoDash: z aralığı, x+z dikdörtgeni, çokgen', () => {
    expect(inNoDash([{ z: [-445, -392] }], 0, -400)).toBe(true);
    expect(inNoDash([{ z: [-445, -392] }], 0, -510)).toBe(false);
    expect(inNoDash([{ x: [0, 5], z: [-10, 0] }], 6, -5)).toBe(false);
    expect(
      inNoDash(
        [
          {
            poly: [
              [0, 0],
              [10, 0],
              [10, -10],
              [0, -10],
            ],
          },
        ],
        5,
        -5,
      ),
    ).toBe(true);
    expect(inNoDash(undefined, 0, 0)).toBe(false);
  });
  it('buildRoads: noDash kesiminde şerit ayırıcı yok, dışında var', () => {
    const g0 = new ChunkedGeometry();
    buildRoads(g0, [road], [], [], { w1: { edges: 'none' } });
    expect(zs(g0).some((z) => z < -395 && z > -440)).toBe(true);
    const g1 = new ChunkedGeometry();
    buildRoads(g1, [road], [], [], { w1: { edges: 'none', noDash: [{ z: [-445, -392] }] } });
    expect(zs(g1).some((z) => z < -392.5 && z > -444.5)).toBe(false);
    expect(zs(g1).some((z) => z < -500 && z > -520)).toBe(true);
    // düz kenar çizgisi bastırılmaz
    const g2 = new ChunkedGeometry();
    buildRoads(g2, [road], [], [], { w1: { edges: 'solid', noDash: [{ z: [-445, -392] }] } });
    expect(zs(g2).some((z) => z < -395 && z > -440)).toBe(true);
  });
  it('roadMarksOf: noDash doğrulanır, geçersiz bölge atılır', () => {
    const m = roadMarksOf({
      roads: [{ id: 306909263, noDash: [{ z: [-445, -392] }, { z: ['a', 1] }, {}] }],
    } as never);
    expect(m.w306909263.noDash).toEqual([{ z: [-445, -392] }]);
    expect(roadMarksOf({ roads: [{ id: 1 }] } as never).w1.noDash).toBeUndefined();
  });
});

describe('D4 kod r2 #4: el yazısı alın yazısı', () => {
  it('script ailesi paketlenmiş yazı tipiyle başlar; diğer aileler değişmez', () => {
    expect(famOf('script').startsWith(`"${SCRIPT_FONT}"`)).toBe(true);
    expect(famOf('sans')).toBe('Arial, Helvetica, sans-serif');
    expect(fasciaBold('script')).toBe(false);
    expect(fasciaBold(undefined)).toBe(true);
    expect(fasciaBold('sans')).toBe(true);
  });
  it('fasciaParts parça yazı tipini taşır', () => {
    const poly: [number, number][] = [
      [0, 0],
      [5, 0],
      [5, -26],
      [0, -26],
    ];
    const f = fasciaSigns(
      {
        kind: 'enclosure',
        x: 2.5,
        z: -13,
        fasciaText: 'Tarz-ı Pide Mandıra',
        fasciaEdge: 1,
        fasciaParts: [
          { text: 'Pide', fg: '#9c9fa7' },
          { text: 'Mandıra', fg: '#a8acae', u0: 5.2, u1: 8, font: 'script' },
        ],
      },
      poly,
      new Set(),
    );
    expect(f[0].parts?.[0].font).toBeUndefined();
    expect(f[0].parts?.[1].font).toBe('script');
  });
});

describe('D4 kod r2 #5: tür başına taç sıklığı', () => {
  it('thinCards oranı tutar, kart boyu değişmez', () => {
    const pos: number[] = [];
    for (let k = 0; k < 400; k++) pos.push(0, k, 0, 0.5, k, 0, 0.5, k + 0.5, 0, 0, k + 0.5, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const t = thinCards(g, 1, 0.5, 11).attributes.position;
    const n = t.count / 4;
    expect(n).toBeGreaterThan(160);
    expect(n).toBeLessThan(240);
    for (let i = 0; i < t.count; i += 4) expect(t.getY(i + 2) - t.getY(i)).toBeCloseTo(0.5, 5);
  });
  it('yalnız mor fidan seyreltilir', () => {
    const lk = (k: string) =>
      (SPECIES_DEFS as Record<string, { gen: { leafKeep?: number } }>)[k].gen.leafKeep;
    expect(lk('sapling-purple')).toBeLessThan(1);
    const others = Object.keys(SPECIES_DEFS).filter((k) => k !== 'sapling-purple');
    expect(others.every((k) => lk(k) === undefined)).toBe(true);
  });
});

describe('D4 kod r2 #6: üst kat perdesiz çıkma şerit camı', () => {
  it('≥ 6 m tek parça perdesiz şerit → karanlık; konut camı ve ölçülmüş perde değişmez', () => {
    expect(projWinKind({ kind: 'std', curt: null, y0: 6.87, y1: 8.58, u0: 6.26, u1: 38.08 })).toBe(
      PROJ_BAND_KIND,
    );
    expect(projWinKind({ kind: 'std', curt: null, y0: 14.35, y1: 15.85, u0: 0, u1: 3.4 })).toBe(0);
    expect(projWinKind({ kind: 'std', curt: 'tul', y0: 6.87, y1: 8.58, u0: 6.26, u1: 38.08 })).toBe(0);
    expect(projWinKind({ kind: 'glassband', curt: null, y0: 5.9, y1: 20.35, u0: 0, u1: 12 })).toBe(0);
    // zemin vitrini kuralı önce
    expect(projWinKind({ kind: 'std', curt: null, y0: 0.21, y1: 4.62, u0: 0.18, u1: 8.92 })).toBe(7);
    expect(PROJ_BAND_KIND).toBe(9);
    // açık perde adı (survey düzeyi seçenek) aynı türü verir
    expect(projWinKind({ kind: 'std', curt: 'ofis', y0: 6, y1: 8, u0: 0, u1: 2 })).toBe(9);
    // u verilmeyen eski çağrı
    expect(projWinKind({ kind: 'std', curt: null, y0: 6, y1: 8 })).toBe(0);
  });
});

describe('D4 kod r2 #6/#7: ofis şerit camı ve renkli cam yansıma çarpanları', () => {
  const fake = () => ({
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <common>\n#include <uv_vertex>',
    fragmentShader:
      'void main() {\n#include <common>\n#include <color_fragment>\n#include <aomap_fragment>\n#include <emissivemap_fragment>',
  });
  it('pencere camı: tür 9 kendi çarpanıyla (ofis), diğer türler değişmez', () => {
    expect(officeEnvUniform.value).toBe(OFFICE_ENV);
    const sh = fake();
    windowGlassMaterial().onBeforeCompile(sh as never, {} as never);
    expect(sh.uniforms.uOfficeEnv).toBe(officeEnvUniform);
    expect(sh.fragmentShader).toContain('kind > 8.5 && kind < 9.5) ? uOfficeEnv');
  });
  it('tint camı tintEnvUniform alır (×9 değil), varsayılan etiket eski çarpanda', () => {
    expect(tintEnvUniform.value).toBeLessThan(glassEnvUniform.value);
    const sh = fake();
    withGlassEnv(new THREE.MeshStandardMaterial(), 'tint').onBeforeCompile(sh as never, {} as never);
    expect(sh.uniforms.uGlassEnv).toBe(tintEnvUniform);
    const sh2 = fake();
    withGlassEnv(new THREE.MeshStandardMaterial()).onBeforeCompile(sh2 as never, {} as never);
    expect(sh2.uniforms.uGlassEnv).toBe(glassEnvUniform);
  });
});
