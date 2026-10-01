import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Builder } from '../../src/worlds/measured/builder';
import { AT_GRADE_TOP, bandDrapeY, buildStreetPlan } from '../../src/worlds/measured/street';
import { areaAtGrade, GRASS_TEX_AVG, lawnTint, surveyVegetation } from '../../src/worlds/measured/siteplan';
import { projWinKind } from '../../src/worlds/measured/facade';
import { shopEnvUniform, shopRoomUniform, windowGlassMaterial } from '../../src/worlds/measured/facadeMats';
import { fasciaPartSpans } from '../../src/worlds/measured/streetFurniture';
import { ChunkedGeometry } from '../../src/worlds/osm/chunks';
import { buildRoads } from '../../src/worlds/osm/roads';
import type { Road } from '../../src/worlds/osm/parse';
import { remapCrownBase } from '../../src/worlds/osm/treelib';

type Bucket = { pos: number[]; idx: number[] };
const buckets = (b: Builder) => (b as unknown as { buckets: Map<string, Bucket> }).buckets;
const ys = (bk: Bucket | undefined) => {
  const out: number[] = [];
  if (bk) for (let i = 1; i < bk.pos.length; i += 3) out.push(bk.pos[i]);
  return out;
};

function inFlat(p: number[], x: number, z: number): boolean {
  let c = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi, xj, zj] = [p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1]];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

describe('D4 r2: yol kotundaki park şeridi asfalt dolgusunun üstünde (d4b #9)', () => {
  it('bandDrapeY: yol kotu bantları OSM asfaltı / dolgu üstüne, bordürlüler aynen', () => {
    expect(bandDrapeY(0.02)).toBe(AT_GRADE_TOP);
    expect(AT_GRADE_TOP).toBeGreaterThan(0.043);
    expect(bandDrapeY(0.15)).toBe(0.15);
  });
  it('bordürlü kaldırımın yol dolgusu park şeridini örtmez', () => {
    const b = new Builder();
    buildStreetPlan(
      b,
      {
        sidewalks: [
          // Bordürlü kaldırım (x = 3 bordür, doğuya), yol dolgusu batıya 3–10 m
          {
            id: 'k',
            pts: [
              [3, 0],
              [3, -30],
            ],
            w: 4,
            side: 'right',
            kerbH: 0.15,
            layers: [{ w: 3.85, material: 'gri beton kilit taşı', h: 0.15 }],
          },
          // Yol kotunda park şeridi (x 0.5 → 3), dolgunun altında kalıyordu
          {
            id: 'p',
            pts: [
              [0.5, 0],
              [0.5, -30],
            ],
            w: 2.5,
            side: 'right',
            kerbH: 0.02,
            layers: [{ w: 2.4, material: 'kiremit-kırmızı beton kilit taşı park şeridi', h: 0.02 }],
          },
        ],
      } as never,
      () => 0,
      () => 5,
    );
    const bk = buckets(b);
    const lane = ys(bk.get('spPaverRed'));
    const fill = ys(bk.get('roadFill'));
    expect(lane.length).toBeGreaterThan(0);
    expect(Math.min(...lane)).toBeGreaterThan(Math.max(...fill));
  });
});

describe('D4 r2: ölçülen çim tonu (d4b #26)', () => {
  it('lawnTint: gerçek doku ortalaması × çarpan = ölçülen ton (doğrusal)', () => {
    const avg = new THREE.Color(GRASS_TEX_AVG);
    for (const hex of ['#5b792e', '#6e8637']) {
      const t = lawnTint(hex);
      const want = new THREE.Color(hex);
      expect(avg.r * t.r).toBeCloseTo(want.r, 4);
      expect(avg.g * t.g).toBeCloseTo(want.g, 4);
      expect(avg.b * t.b).toBeCloseTo(want.b, 4);
      // yeşil kanal baskın (eski çarpan ≈ gri 0.55–0.6 → doku kahvesi kalıyordu)
      expect(t.g).toBeGreaterThan(t.r * 2);
    }
  });
});

describe('D4 r2: vitrin camı (d4b #2, d4a #8, d4c #7)', () => {
  it('çıkma (proj) zemin kat dükkân camı vitrin, üst kat perdesiz tül, ölçülen perde kazanır', () => {
    expect(projWinKind({ kind: 'std', curt: null, y0: 0.21, y1: 4.62 })).toBe(7);
    expect(projWinKind({ kind: 'door', y0: 0.05, y1: 2.2 })).toBe(7);
    expect(projWinKind({ kind: 'shop', y0: 4, y1: 6 })).toBe(7);
    expect(projWinKind({ kind: 'std', curt: null, y0: 5.93, y1: 6.33 })).toBe(0);
    expect(projWinKind({ kind: 'std', y0: 0.3, y1: 1.6 })).toBe(0);
    expect(projWinKind({ kind: 'small', y0: 0.3, y1: 0.9 })).toBe(4);
    expect(projWinKind({ kind: 'std', curt: 'karanlik', y0: 0.2, y1: 4 })).toBe(4);
  });
  it('vitrin gök yansıması düşük, vitrin içi çarpanı gölgelendiricide', () => {
    expect(shopEnvUniform.value).toBeLessThan(1);
    expect(shopRoomUniform.value).toBeLessThan(1);
    const m = windowGlassMaterial();
    const sh = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <uv_vertex>',
      fragmentShader:
        'void main() {\n#include <common>\n#include <color_fragment>\n#include <aomap_fragment>\n#include <emissivemap_fragment>',
    };
    m.onBeforeCompile(sh as never, {} as never);
    expect(sh.fragmentShader).toContain('rc *= uShopRoom');
    expect(sh.uniforms.uShopRoom).toBe(shopRoomUniform);
  });
});

describe('D4 r2: OSM kaldırımı / şerit çizgisi bastırma (d4c #4, d4a #1)', () => {
  const v = surveyVegetation();
  it('Muammer Aksoy park cebinin yol tarafındaki OSM kaldırımı bastırılır', () => {
    expect(v.noSidewalkZones.some((r) => inFlat(r, 703, -802.5))).toBe(true);
  });
  it('yükseltilmiş ön alan tampon almaz, yol kotundakiler alır', () => {
    expect(areaAtGrade({ kind: 'paving', level: 0.15 })).toBe(false);
    expect(areaAtGrade({ kind: 'paving' })).toBe(true);
    expect(areaAtGrade({ kind: 'asphalt', level: 0.15 })).toBe(true);
  });
  it('Biaport otoparkı çizgi yasağında, şerit dolgusu asfaltı değil', () => {
    expect(v.noMarkZones.some((r) => inFlat(r, 666.5, -282))).toBe(true);
    // d4-um-n-carriageway (689..700, −299.6) şerit dolgusu: çizgi kalır
    expect(v.noMarkZones.some((r) => inFlat(r, 694.5, -298))).toBe(false);
  });
  it('buildRoads: çizgi yasağı içinde şerit çizgisi yok', () => {
    const road: Road = {
      id: 'w1',
      kind: 'secondary',
      pts: [
        [0, 0],
        [0, -100],
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
    const g0 = new ChunkedGeometry();
    buildRoads(g0, [road], [], [], { w1: { edges: 'none' } });
    expect(zs(g0).some((z) => z < -40 && z > -60)).toBe(true);
    const g1 = new ChunkedGeometry();
    buildRoads(g1, [road], [], [], { w1: { edges: 'none' } }, [], [[-10, -60, 10, -60, 10, -40, -10, -40]]);
    expect(zs(g1).some((z) => z < -41 && z > -59)).toBe(false);
    expect(zs(g1).some((z) => z < -70)).toBe(true);
  });
});

describe('D4 r2: alın yazısı parçaları (d4c #1)', () => {
  it('ölçülen u0/u1 taşıyan parça orada, kalanı oranlı', () => {
    const sp = fasciaPartSpans(
      [
        { text: 'Tarz-ı', u0: 21, u1: 23.5 },
        { text: 'Pide', u0: 23.6, u1: 25.4 },
      ],
      0.1,
      25.9,
      true,
      26,
    );
    expect(sp.map(([, a, b]) => [a, b])).toEqual([
      [21, 23.5],
      [23.6, 25.4],
    ]);
    const old = fasciaPartSpans([{ text: 'ab' }, { text: 'cd' }], 0, 6, true, 6);
    expect(old.map(([, a, b]) => [a, b])).toEqual([
      [0, 3],
      [3, 6],
    ]);
  });
  it('kış bahçesi camı tek katman: kenar başına bir dışa bakan quad', () => {
    const b = new Builder();
    buildStreetPlan(
      b,
      {
        street: [
          {
            kind: 'enclosure',
            x: -1.5,
            z: 2.5,
            poly: [
              [0, 0],
              [0, 5],
              [-3, 5],
              [-3, 0],
            ],
            h: 3,
            glass: '#5f6a6c',
          },
        ],
      } as never,
      () => 0,
      () => 5,
      { colorKey: ((k: string, h: string) => `cc_${k}_${h}`) as never },
    );
    const g = buckets(b).get('cc_encglass_#5f6a6c')!;
    expect(g.idx.length / 3).toBe(4 * 2);
    // her cam quad'ı dışa bakar: yüz normali merkezden uzağa
    for (let t = 0; t < g.idx.length; t += 3) {
      const P = [0, 1, 2].map((k) => new THREE.Vector3().fromArray(g.pos, g.idx[t + k] * 3));
      const n = new THREE.Vector3().subVectors(P[1], P[0]).cross(new THREE.Vector3().subVectors(P[2], P[0]));
      const c = P[0].clone().add(P[1]).add(P[2]).divideScalar(3);
      expect(n.x * (c.x + 1.5) + n.z * (c.z - 2.5)).toBeGreaterThan(0);
    }
  });
});

describe('D4 r2: taç tabanı çeşidinde yaprak kartları uzamaz (d4a #17, d4c #15)', () => {
  it('rigidCards: kart boyu korunur, merkez eşlenir', () => {
    const pos: number[] = [];
    for (const y0 of [0.4, 2, 5]) pos.push(0, y0, 0, 0.5, y0, 0, 0.5, y0 + 0.5, 0, 0, y0 + 0.5, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const r = remapCrownBase(g, 1, 2.5, 8, true).attributes.position;
    for (let i = 0; i < r.count; i += 4) expect(r.getY(i + 2) - r.getY(i)).toBeCloseTo(0.5, 5);
    // köşe köşe eşlemede alttaki kart 2.5 kat uzuyordu
    const v = remapCrownBase(g, 1, 2.5, 8).attributes.position;
    expect(v.getY(2) - v.getY(0)).toBeGreaterThan(1.2);
  });
});
