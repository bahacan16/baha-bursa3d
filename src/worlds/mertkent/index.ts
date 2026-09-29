import * as THREE from 'three';
import type { SimpleOsm } from '../osm/simplify';
import { Builder, type V2 } from './builder';
import { buildApartment, insidePoly, type ApartmentStyle } from './apartment';
import { buildFacadeBlock, type CompiledBlock } from './facade';
import { splitMassing } from './massing';
import { camGlassMaterial, flagTexture, granularMaterial, windowGlassMaterial } from './facadeMats';
import facadesData from './data/facades.json';
import footprintsData from './data/footprints.json';
import { buildStreetPlan } from './street';
import { buildMertkentFence, type FenceSpec } from './fence2';
import { buildGenericFence, type GenericFence } from './fenceGeneric';
import {
  buildSitePlan,
  PARK_PLAN,
  SITE_PLAN,
  STREET_PLAN as STREET_PLAN0,
  type StreetPlan,
} from './siteplan';
import { paverTextures } from './facadeMats';

/** Ölçülmüş site planı varsa eski kural tabanlı zemin yerine o kullanılır (?oldgrounds=1 eskisi) */
const USE_PLAN =
  (SITE_PLAN.areas?.length ?? 0) > 0 &&
  !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('oldgrounds'));

/** Ölçülmüş sokak planı (street-plan.json, ajan ölçümü) — yoksa OSM site sınırından çit */
const STREET_PLAN = STREET_PLAN0 as Omit<StreetPlan, 'fence'> & { fence?: FenceSpec[] };
import { buildBrickFence, buildSalusGate, type BrickSeg } from './salus';
import { buildDriveGate, buildFence, buildGate, buildParkKoza, buildSideDoor, type FenceSeg } from './site';
import { buildOzhan } from './ozhan';
import { buildGrounds } from './grounds';
import { groundHoles } from '../osm/materials';
import { loadPbr, type PbrRole } from '../osm/pbr';
import { roadWidth } from '../osm/parse';
import * as T from './textures';
import { nightUniform } from '../../env/night';
import { windTime } from '../osm/eztree';

const BLOCK_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];
/** ?nosurvey=1 → ölçülmüş cepheler yerine eski kural tabanlı apartman modeli (karşılaştırma için) */
const NO_SURVEY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosurvey');
const OLD_FENCE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('oldfence');
/** Asfalt yarı genişliği (roads.ts sınıf genişlikleriyle uyumlu) */
const ROAD_HALF: Record<string, number> = {
  primary: 6,
  secondary: 5,
  tertiary: 4,
  residential: 3.25,
  unclassified: 3.25,
  living_street: 2.5,
};
/** Site içi (havuz yanı): bloklarin girişleri bu noktaya bakan cephede */
const SITE_INSIDE: V2 = [-38, -92];

/**
 * Mertkent 2. Etap ve çevresi — Street View karelerine bakılarak elle (kodla) modellenmiş bölüm.
 * OSM'den otomatik üretilen karşılıkları bu binalar için çizilmez.
 */
export const MERTKENT_BUILDINGS = [1480041342, 1480041343, 1480041344, 1480041345, 1540901795, 1540901796];
export const OZHAN_BUILDING = 1546816259;
/** Salusvizyon: bina, site alanı, havuz (OSM) */
export const SALUS_BUILDING = 1479658783;
const SALUS_SITE = 1546816188;
const SALUS_POOL = 1479658784;
/** Street View (pano 17): araç kapısı merkezi, sokağa (doğuya) bakar */
const SALUS_GATE: { c: V2; n: V2 } = { c: [-82.3, -165.6], n: [1, 0] };
/** Ölçülmüş cephe verisi olan tüm binalar (Mertkent blokları + Salus + komşular) */
const FACADES_ALL = facadesData as unknown as Record<string, CompiledBlock>;
/** Ölçülmüş komşu binalar (Mertkent blokları ve Salus dışında) — OSM'den otomatik üretilmez */
const SURVEYED_EXTRA = Object.keys(FACADES_ALL)
  .map(Number)
  .filter((id) => !MERTKENT_BUILDINGS.includes(id) && id !== SALUS_BUILDING);
export const HANDMADE_IDS = new Set([
  ...MERTKENT_BUILDINGS,
  OZHAN_BUILDING,
  SALUS_BUILDING,
  ...SURVEYED_EXTRA,
]);

const SALUS_STYLE: ApartmentStyle = {
  keys: {
    plaster: 'slPlaster',
    plasterGrey: 'slAccent',
    fascia: 'slFascia',
    glass: 'slGlass',
    rail: 'slRail',
    win: 'slWin',
    plinth: 'slPlinth',
    glazing: 'slGlazing',
  },
  strips: false,
  accentEvery: 3,
  roof: 'flat',
  solar: false,
};

/**
 * Site kapıları. KARAR: çit hattı ve kapılar OSM site sınırı + yaya yolu düğümlerinden (Street View tahmini çit
 * hattı kuzeyde ~2.4 m sokağa kaymıştı; kuzey kapı karesinde kapı daha uzakta görünüyor).
 */
/** Ölçülmüş kapılar (street-plan.json; Salusvizyon kapıları salus.ts'de) */
const SP_GATES = (STREET_PLAN.gates ?? []).filter((g) => !/^salus/.test((g as { id?: string }).id ?? ''));
const GATES: { c: V2; n: V2 }[] = SP_GATES.length
  ? SP_GATES.filter((g) => g.kind === 'pedestrian' && g.w >= 2).map((g) => ({ c: g.c, n: g.n }))
  : [
      { c: [-30.6, -142.5], n: [0, -1] },
      { c: [-74.1, -65.3], n: [-1, 0] },
    ];
/** Araç girişleri (ölçüm; yoksa OSM otopark yolu uçları) */
const DRIVE_GATES: { c: V2; n: V2; w: number }[] = SP_GATES.length
  ? SP_GATES.filter((g) => g.kind === 'vehicle').map((g) => ({ c: g.c, n: g.n, w: g.w }))
  : [
      { c: [-40.1, -36.8], n: [0, 1], w: 5.2 },
      { c: [-2.2, -103.3], n: [1, 0], w: 5.2 },
    ];
/** Çitteki küçük yaya kapıları (yapay yaprak kaplı panel kapı) */
const DOORS = SP_GATES.filter((g) => g.kind === 'pedestrian' && g.w < 2) as {
  c: V2;
  n: V2;
  w: number;
  h?: number;
}[];

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

function ringOf(simple: SimpleOsm, id: number): V2[] | null {
  const w = simple.ways.find((x) => x.i === id);
  if (!w) return null;
  const r: V2[] = [];
  for (let i = 0; i < w.p.length; i += 2) r.push([w.p[i], w.p[i + 1]]);
  const f = r[0];
  const l = r[r.length - 1];
  if (r.length > 3 && f[0] === l[0] && f[1] === l[1]) r.pop();
  return r;
}

function distToRing(r: V2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const e = r[(i + 1) % r.length];
    const dx = e[0] - a[0];
    const dz = e[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return d;
}

/** Yaprak kartı malzemesi (ez-tree yaprak dokuları, alfa testli, iki yüzlü) */
function leafMat(base: string, file: string, tint: number): THREE.Material {
  const t = new THREE.TextureLoader().load(`${base}textures/trees/${file}`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = true;
  t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: t,
    color: tint,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });
}

/** Havuz suyu: turkuaz, yarı saydam, dalgalı normal (rüzgâr zamanıyla kayar), gökyüzü yansıması */
function waterMaterial(): THREE.Material {
  const m = new THREE.MeshStandardMaterial({
    color: 0x2fb2d3,
    transparent: true,
    opacity: 0.62,
    roughness: 0.04,
    metalness: 0.15,
    envMapIntensity: 9,
    normalMap: T.rippleNormalTexture(),
    normalScale: new THREE.Vector2(0.35, 0.35),
    depthWrite: false,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_NORMALMAP\nvNormalMapUv += vec2(uWind * 0.021, uWind * 0.013);\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'mk-water-v1';
  return m;
}

/** Gece yanan küçük lamba yüzeyi (gündüz sönük beyaz) */
function nightLamp(color: number, strength: number): THREE.Material {
  const m = new THREE.MeshStandardMaterial({
    color: 0xf2f0ea,
    emissive: color,
    emissiveIntensity: 1,
    roughness: 0.4,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight * ${strength.toFixed(2)};`,
      );
  };
  m.customProgramCacheKey = () => `mk-lamp-${strength}`;
  return m;
}

/** Blok paleti: ölçümde örneklenen renklerden bloğa özel malzemeler (güneşli yüzden alındığı için hafif koyu) */
function paletteKeys(
  fac: CompiledBlock,
  id: number,
  extraMats: Record<string, THREE.Material>,
): Record<string, string> {
  const keys: Record<string, string> = {};
  const pal: [string, string, number, (c: string) => THREE.Material][] = [
    ['plaster', 'mkPlaster', 0.97, (c) => granularMaterial(c, 3)],
    ['plaster2', 'mkPlaster2', 0.97, (c) => granularMaterial(c, 4)],
    ['strip', 'mkStrip', 0.95, (c) => granularMaterial(c, 6, { roughness: 0.85 }, { mottle: 0.06 })],
    ['fascia', 'mkFascia', 0.95, (c) => granularMaterial(c, 7, { side: THREE.DoubleSide, roughness: 0.9 })],
    ['frame', 'mkFrame', 1, (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 })],
    ['plinth', 'mkPlinth', 1, (c) => granularMaterial(c, 5, { roughness: 0.9 })],
    [
      'railGlass',
      'mkRailGlass',
      1,
      (c) =>
        new THREE.MeshStandardMaterial({
          color: c,
          transparent: true,
          // Koyu (renkli) cam korkuluk daha az saydam görünür
          opacity:
            new THREE.Color(c).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).l < 0.5 ? 0.85 : 0.72,
          roughness: 0.25,
          metalness: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
    ],
    [
      'tile',
      'mkTile',
      1,
      (c) =>
        new THREE.MeshStandardMaterial({ map: T.roofTileTexture(c), side: THREE.DoubleSide, roughness: 0.8 }),
    ],
    [
      'soffit',
      'mkSoffit',
      1,
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, side: THREE.DoubleSide }),
    ],
  ];
  for (const [ck, mk, f, mat] of pal) {
    const c = fac.colors?.[ck];
    if (!c || !/^#[0-9a-f]{6}$/i.test(c)) continue;
    const col = new THREE.Color(c).multiplyScalar(f);
    const k = `${mk}_${id}`;
    extraMats[k] = mat(`#${col.getHexString()}`);
    keys[mk] = k;
  }
  return keys;
}

/** Kilit parke malzemesi (2 m × 1 m doku; drape UV = dünya metre) */
function paverMat(palette: string[], seed: number, off: number): THREE.Material {
  if (typeof document === 'undefined') return new THREE.MeshStandardMaterial({ color: palette[0] });
  const t = paverTextures(palette, { seed });
  const map = t.map.clone();
  const nm = t.normalMap.clone();
  map.repeat.set(0.5, 1);
  nm.repeat.set(0.5, 1);
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: nm,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: off,
    polygonOffsetUnits: off,
  });
}

function materials(base: string): Record<string, THREE.Material> {
  const std = (p: THREE.MeshStandardMaterialParameters) =>
    new THREE.MeshStandardMaterial({ roughness: 0.85, ...p });
  /** Foto-taramalı PBR doku (dünya UV'si metre), renk çarpanıyla */
  const pbr = (role: PbrRole, color: number, p: THREE.MeshStandardMaterialParameters = {}, polyOff = 0) => {
    const t = loadPbr(base, role, true);
    return std({
      map: t.map,
      normalMap: t.normalMap ?? undefined,
      roughnessMap: t.roughnessMap ?? undefined,
      color,
      polygonOffset: polyOff !== 0,
      polygonOffsetFactor: polyOff,
      polygonOffsetUnits: polyOff,
      ...p,
    });
  };
  const DS = THREE.DoubleSide;
  // Ölçülmüş cepheler (Street View yakın planlarından renkler; grenli sıva)
  const mk: Record<string, THREE.Material> = {
    mkPlaster: granularMaterial('#d3d1cc', 3),
    mkPlaster2: granularMaterial('#9d9c99', 4),
    mkPlinth: granularMaterial('#7f8184', 5, { roughness: 0.9 }),
    mkStrip: granularMaterial('#d98a38', 6, { roughness: 0.85 }, { mottle: 0.06 }),
    mkFascia: granularMaterial('#6d6f72', 7, { side: DS, roughness: 0.9 }),
    mkCapTop: std({ color: 0x77797b, roughness: 0.95, side: DS }),
    mkSoffit: std({ color: 0xe2e1dd, roughness: 0.9, side: DS }),
    mkSlabTop: std({ color: 0xc2bdb3, roughness: 0.8, side: DS }),
    mkReveal: granularMaterial('#cfcdc7', 8),
    mkSill: std({ color: 0xe9e7e2, roughness: 0.35 }),
    mkFrame: std({ color: 0xf3f3f0, roughness: 0.35 }),
    mkGlass: windowGlassMaterial(),
    mkCamGlass: camGlassMaterial(),
    mkRailGlass: std({
      color: 0xd6ebe3,
      transparent: true,
      opacity: 0.72,
      roughness: 0.35,
      metalness: 0,
      side: DS,
      depthWrite: false,
    }),
    mkRail: std({ color: 0xd3d6d8, roughness: 0.25, metalness: 0.9 }),
    mkPipe: std({ color: 0x55585b, roughness: 0.5, metalness: 0.3 }),
    mkAc: std({ color: 0xeceeec, roughness: 0.5 }),
    mkAcFront: std({ map: T.acTexture(), roughness: 0.5 }),
    mkDish: std({ color: 0xeeeeea, roughness: 0.45, side: DS }),
    mkFlag: std({ map: flagTexture(), color: 0xffffff, roughness: 0.8, side: DS }),
    mkDownlight: nightLamp(0xfff2d8, 2.5),
    mkStep: std({ color: 0xc9c3b6, roughness: 0.7 }),
    mkEntryDoor: std({ map: T.entryDoorTexture(), roughness: 0.2, metalness: 0.4 }),
    // Street View'da güneşte ~#c0b19c (sıcak bej-gri), kiremit bant solgun
    spPaverGrey: paverMat(['#c3beb2', '#ccc7bb', '#b8b3a7', '#c7c2b6'], 21, -5),
    spPaverRed: paverMat(['#bfae9f', '#c8b7a8', '#b5a496', '#c4b3a4'], 22, -5),
    spRubberRed: std({
      color: 0x7e4a3f,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
    spRubberPurple: std({
      color: 0x6f5a6c,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
    spRubberGrey: std({
      color: 0x505356,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
    spCourtBeige: std({
      color: 0xc4b294,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
    spCourtGreen: std({
      color: 0x4f7a55,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
    spMulch: std({
      color: 0x5a4838,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
    }),
    spGravel: std({
      color: 0xb9ad98,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
    }),
    spPaint: std({
      color: 0xeeeeea,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    }),
    spPlayBlue: std({ color: 0x2b6cc4, roughness: 0.4 }),
    // Bisiklet şeridi boyası (502. Sk. Street View: soluk mavi, yer yer aşınmış)
    spBike: std({
      color: 0xa7b6c0,
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
    spConcrete: granularMaterial('#b9b5ad', 23, { roughness: 0.9 }),
    binGreen: std({ color: 0x28452e, roughness: 0.5, metalness: 0.2 }),
    bollardOrange: std({ color: 0xe8661e, roughness: 0.5 }),
    cabinet: std({ color: 0xa9aca8, roughness: 0.55, metalness: 0.3 }),
    scooter: std({ color: 0x19b3a6, roughness: 0.45 }),

    spPlayYellow: std({ color: 0xe8b830, roughness: 0.5 }),
    poolTileLight: std({ map: T.mosaicTexture('#9fd8e6', '#8ccbdc'), roughness: 0.3 }),
    mkWave: (() => {
      const map = new THREE.TextureLoader().load(`${base}textures/mk/mk-wave.jpg`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = THREE.RepeatWrapping;
      map.anisotropy = 8;
      const nm = new THREE.TextureLoader().load(`${base}textures/mk/mk-wave-n.png`);
      nm.wrapS = THREE.RepeatWrapping;
      return std({
        map,
        normalMap: nm,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.8,
        color: 0xffffff,
      });
    })(),
    mkWallBack: granularMaterial('#e3e2de', 9),
    mkTile: std({ map: T.roofTileTexture('#a0654f'), side: DS, roughness: 0.8 }),
    mkCoping: granularMaterial('#cf9e62', 10, { roughness: 0.8 }),
    mkPillar: granularMaterial('#d6a466', 11, { roughness: 0.85 }, { mottle: 0.07, bump: 2.2 }),
    mkMesh: std({
      map: T.meshFenceTexture(),
      alphaTest: 0.45,
      side: DS,
      roughness: 0.5,
      metalness: 0.2,
    }),
    mkMeshPost: std({ color: 0x21392b, roughness: 0.5, metalness: 0.3 }),
    mkFoliage: (() => {
      const map = new THREE.TextureLoader().load(`${base}textures/mk/mk-foliage.jpg`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(1 / 2.15, 1 / 1.16);
      map.anisotropy = 8;
      return std({ map, roughness: 0.75, side: DS });
    })(),
    mkHedge: (() => {
      // Leylandi: yordamsal doku (2 m × 1 m); u birimi 2 m, v birimi 1 m (fence2 yüz UV'leri)
      const map = T.leylandiiTexture();
      map.anisotropy = 8;
      return std({ map, roughness: 0.92, side: DS });
    })(),
    mkCanopyGlass: std({
      color: 0x9fb8bc,
      transparent: true,
      opacity: 0.45,
      roughness: 0.05,
      side: DS,
      depthWrite: false,
    }),
  };
  const m: Record<string, THREE.Material> = {
    ...mk,
    plaster: std({ map: T.plasterTexture('#f1f0eb', 3, true), roughness: 0.92 }),
    plasterGrey: std({ map: T.plasterTexture('#d9dad8', 4, true), roughness: 0.92 }),
    reveal: std({ color: 0xe4e3de, roughness: 0.9 }),
    revealSill: std({ color: 0xcfcbc2, roughness: 0.6 }),
    shutterBox: std({ color: 0xdfe0de, roughness: 0.6 }),
    shutter: std({ map: T.shutterTexture(), roughness: 0.6, side: DS }),
    pipe: std({ color: 0xb9bcbd, roughness: 0.5, metalness: 0.2 }),
    ac: std({ color: 0xe9ebe9, roughness: 0.5 }),
    acFront: std({ map: T.acTexture(), roughness: 0.5 }),
    downlight: nightLamp(0xfff2d8, 2.5),
    wallLamp: nightLamp(0xfff0cc, 1.6),
    solar: std({ map: T.solarTexture(), roughness: 0.15, metalness: 0.5 }),
    solarBack: std({ color: 0x9ea3a6, roughness: 0.6, metalness: 0.4 }),
    tank: std({ color: 0xd8dadb, roughness: 0.35, metalness: 0.6 }),
    tankLeg: std({ color: 0x8d9194, roughness: 0.5, metalness: 0.5 }),
    ridge: std({ color: 0x8a3f26, roughness: 0.8 }),
    stepStone: std({ color: 0xc9c3b6, roughness: 0.7 }),
    canopyFrame: std({ color: 0xb4b8bb, roughness: 0.3, metalness: 0.8 }),
    canopyGlass: std({
      color: 0x9fb8bc,
      transparent: true,
      opacity: 0.45,
      roughness: 0.05,
      side: DS,
      depthWrite: false,
    }),
    bellPanel: std({ color: 0x9a9fa3, roughness: 0.3, metalness: 0.7 }),
    entryDoor: std({ map: T.entryDoorTexture(), roughness: 0.2, metalness: 0.4 }),
    // Site içi
    lawn: pbr('grass', 0xe4ffa8, { roughness: 1 }, -2),
    walk: std({
      map: T.cobbleTexture('#a9a8a3', '#98978f', 17),
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
    tactile: std({ map: T.tactileTexture(), roughness: 0.7 }),
    walkRed: std({
      map: T.cobbleTexture('#9a5a4c', '#b27a66', 19),
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    }),
    apron: std({
      map: T.cobbleTexture('#b9b6ae', '#a5a29a', 11),
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
    edging: std({ color: 0xcfcbc2, roughness: 0.8 }),
    paver: std({
      map: T.cobbleTexture('#a8645a', '#8f5249', 12),
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
    curb: std({ color: 0xd4d0c8, roughness: 0.75 }),
    drive: pbr('asphalt', 0xd2d2d2, { roughness: 0.95 }, -4),
    bay: std({
      map: T.cobbleTexture('#9fa0a0', '#8b8c8d', 13),
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
    }),
    line: std({ color: 0xf2f2ee, roughness: 0.6 }),
    deck: std({ map: T.travertineTexture(), roughness: 0.7 }),
    deckSide: std({ map: T.travertineTexture(), roughness: 0.7, color: 0xd9d4ca }),
    coping: std({ color: 0xf1efe9, roughness: 0.5 }),
    poolTile: std({ map: T.mosaicTexture('#6fc3dc', '#5ab2cf'), roughness: 0.3 }),
    poolBand: std({ map: T.mosaicTexture('#1f5f8c', '#184f78'), roughness: 0.3 }),
    water: waterMaterial(),
    steel: std({ color: 0xd6d9dc, roughness: 0.2, metalness: 0.9 }),
    lounger: std({ color: 0xf3f3f0, roughness: 0.45 }),
    umbrella: std({ color: 0xf2eee4, roughness: 0.8, side: DS }),
    darkMetal: std({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.6 }),
    gardenGlobe: nightLamp(0xfff3dc, 3),
    boxwood: std({ map: T.hedgeTexture(9), roughness: 0.95, color: 0x8fa872 }),
    boxLeaf: leafMat(base, 'ash_color.png', 0x9cb878),
    hedgeLeaf: leafMat(base, 'pine_color.png', 0xb4c890),
    wood: std({ color: 0x8a6240, roughness: 0.7 }),
    plinth: std({ color: 0x8c8e8d }),
    sill: std({ color: 0xbdb9b0, roughness: 0.5 }),
    ochre: std({ color: 0xd49a4c, roughness: 0.8 }),
    eave: std({ color: 0x575b60, side: DS }),
    eaveBottom: std({ color: 0x6b6f73, side: DS }),
    slabTop: std({ color: 0xcfcfcb, side: DS }),
    slabBottom: std({ color: 0xf0efeb, side: DS }),
    fascia: std({ color: 0x8e9296, side: DS, roughness: 0.6 }),
    glass: std({
      color: 0xb6d6cc,
      transparent: true,
      opacity: 0.36,
      roughness: 0.05,
      metalness: 0.2,
      side: DS,
      depthWrite: false,
    }),
    rail: std({ color: 0xc3c7ca, metalness: 0.85, roughness: 0.25 }),
    glazing: std({
      map: T.glazingTexture(),
      transparent: true,
      opacity: 0.6,
      roughness: 0.05,
      metalness: 0.35,
      depthWrite: false,
      side: DS,
    }),
    dish: std({ color: 0xe9e9e6, side: DS, roughness: 0.5 }),
    roof: std({ map: T.roofTileTexture(), side: DS, roughness: 0.75 }),
    stone: std({ map: T.groovedStoneTexture(), roughness: 0.9 }),
    cap: std({ color: 0xe0d2b6 }),
    panel: std({
      map: T.panelFenceTexture(),
      transparent: false,
      alphaTest: 0.4,
      side: DS,
      metalness: 0.3,
      roughness: 0.5,
    }),
    hedge: std({ map: T.hedgeTexture(), roughness: 0.95 }),
    wire: std({ color: 0xcdd1d5, metalness: 0.85, roughness: 0.25 }),
    capDark: std({ color: 0x2b2b2b }),
    globe: std({ color: 0xf6f4ee, emissive: 0x3a3a34, roughness: 0.3 }),
    black: std({ color: 0x1c1e1d, roughness: 0.6 }),
    gold: std({ color: 0xc9a44c, roughness: 0.3, metalness: 1 }),
    pole: std({ color: 0xa9aeb2, roughness: 0.4, metalness: 0.7 }),
    signCurve: std({ map: T.roadSignTexture('curve'), alphaTest: 0.5, roughness: 0.4 }),
    sign30: std({ map: T.roadSignTexture('limit30'), alphaTest: 0.5, roughness: 0.4 }),
    signCurveBack: std({
      map: T.roadSignTexture('curve'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    signP: std({ map: T.roadSignTexture('parking'), alphaTest: 0.5, roughness: 0.4 }),
    signPBack: std({ color: 0x7d8286, roughness: 0.5 }),
    signBike: std({ map: T.roadSignTexture('bike'), alphaTest: 0.5, roughness: 0.4 }),
    signBikeBack: std({
      map: T.roadSignTexture('bike'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    signNoEntry: std({ map: T.roadSignTexture('noentry'), alphaTest: 0.5, roughness: 0.4 }),
    signNoEntryBack: std({
      map: T.roadSignTexture('noentry'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    signNoLeft: std({ map: T.roadSignTexture('noleft'), alphaTest: 0.5, roughness: 0.4 }),
    signNoLeftBack: std({
      map: T.roadSignTexture('noleft'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    lampHead: std({ color: 0x9aa0a4, roughness: 0.4, metalness: 0.6, emissive: 0x000000 }),
    concretePole: std({ color: 0xa7a59f, roughness: 0.9 }),
    hydrant: std({ color: 0xc0282a, roughness: 0.5 }),
    sign30Back: std({
      map: T.roadSignTexture('limit30'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    gateOrn: std({ map: T.gateTexture(), roughness: 0.5, metalness: 0.4 }),
    gate: std({ map: T.gateTexture(), roughness: 0.5, metalness: 0.4, side: DS }),
    gateSign: std({
      map: T.signTexture(
        [
          {
            text: 'MERTKENT',
            size: 70,
            color: '#f4f4f4',
            weight: '800',
            font: 'Montserrat,Arial,sans-serif',
          },
          {
            text: 'Sitesi 2.Etap',
            size: 44,
            color: '#f4f4f4',
            weight: '600',
            font: 'Montserrat,Arial,sans-serif',
          },
        ],
        512,
        160,
        '#1c1e1d',
      ),
    }),
    ozFascia: std({ color: 0x8a3b27, side: DS, roughness: 0.6 }),
    ozSiding: std({ map: T.sidingTexture(), roughness: 0.7 }),
    ozDark: std({ color: 0x3a3330 }),
    ozDoor: std({ color: 0x2c3a40, roughness: 0.1, metalness: 0.6 }),
    ozGlass: std({ color: 0x55646c, roughness: 0.04, metalness: 0.9, envMapIntensity: 14 }),
    ozPosterOzel: std({ map: T.ozhanPosterTexture('ozel') }),
    ozPosterSahane: std({ map: T.ozhanPosterTexture('sahane') }),
    ozPosterPlain: std({ map: T.ozhanPosterTexture('plain') }),
    ozPosterFood: std({ map: T.ozhanPosterTexture('food') }),
    ozLogo: std({ map: T.ozhanLogoTexture(), transparent: true, alphaTest: 0.3, side: DS, roughness: 0.4 }),
    ozPennant: std({ map: T.pennantTexture(), transparent: true, alphaTest: 0.4, side: DS }),
    ozBanner: std({ map: T.ozhanBannerTexture() }),
    ozSlat: std({ map: T.slatTexture(), metalness: 0.3, roughness: 0.5 }),
    ozRoof: std({ color: 0x7e8081 }),
    // Salusvizyon
    slPlaster: std({ map: T.plasterTexture('#ebe3d1', 5, true), roughness: 0.9 }),
    slAccent: std({ map: T.plasterTexture('#74665a', 6, true), roughness: 0.9 }),
    slFascia: std({ color: 0xe6dfcf, side: DS, roughness: 0.7 }),
    slGlass: std({
      color: 0x8aa3b0,
      transparent: true,
      opacity: 0.42,
      roughness: 0.05,
      metalness: 0.3,
      side: DS,
      depthWrite: false,
    }),
    slRail: std({ color: 0x3b3e41, roughness: 0.4, metalness: 0.6 }),
    slPlinth: std({ color: 0x8e8175, roughness: 0.8 }),
    slGlazing: std({
      map: T.glazingTexture(),
      transparent: true,
      opacity: 0.6,
      roughness: 0.05,
      metalness: 0.35,
      side: DS,
      depthWrite: false,
    }),
    roofFlat: std({ color: 0x8b8e8f, roughness: 0.95 }),
    brick: std({ map: T.brickTexture(), roughness: 0.85 }),
    brickCap: std({ color: 0xd8d1c4, roughness: 0.7 }),
    ironBars: std({ map: T.ironBarsTexture(), alphaTest: 0.5, side: DS, roughness: 0.4, metalness: 0.6 }),
    parkKozaSign: std({
      map: T.letterSignTexture(['PARK KOZA', 'SİTESİ'], '#c9a54a', 3.6),
      transparent: true,
      alphaTest: 0.3,
      roughness: 0.3,
      metalness: 0.6,
    }),
    gateOrnBand: std({ map: T.ornBandTexture(), alphaTest: 0.5, side: DS, roughness: 0.4, metalness: 0.6 }),
    iron: std({ color: 0x1d1e1f, roughness: 0.4, metalness: 0.6 }),
    photGreen: leafMat(base, 'oak_color.png', 0x88a868),
    photRed: leafMat(base, 'oak_color.png', 0xd0705a),
    slBooth: std({ map: T.panelTexture('#8e4432'), roughness: 0.5, metalness: 0.2 }),
    slBoothGlass: std({ color: 0x2f3a40, roughness: 0.05, metalness: 0.7 }),
    canopy: std({ color: 0x3a3d40, roughness: 0.5, metalness: 0.4, side: DS }),
    slSign: std({
      map: T.signTexture(
        [
          {
            text: '✦SALUSVİZYON',
            size: 104,
            color: '#e9ecee',
            stroke: '#8a9096',
            weight: '700',
            font: 'Arial,sans-serif',
          },
        ],
        1024,
        128,
        null,
      ),
      alphaTest: 0.4,
      side: DS,
      roughness: 0.25,
      metalness: 0.7,
    }),
  };
  for (let v = 0; v < 4; v++)
    m[`slWin${v}`] = std({ map: T.windowTexture(v + 11, '#4a4e52'), roughness: 0.25, metalness: 0.1 });
  for (let v = 0; v < 4; v++)
    m[`win${v}`] = std({ map: T.windowTexture(v + 1), roughness: 0.25, metalness: 0.1 });
  for (const n of BLOCK_NAMES)
    m[`blockSign${n}`] = std({
      map: T.signTexture(
        [{ text: `${n} BLOK`, size: 64, color: '#2b2f33', weight: '800', font: 'Arial,sans-serif' }],
        256,
        96,
        '#e9e7e1',
      ),
      roughness: 0.4,
    });
  return m;
}

/** Asfalt kenarına (yol ekseni − yarı genişlik) uzaklık; yol oluşturucuyla aynı genişlik kuralı */
function roadGapFn(simple: SimpleOsm, centre = false): (x: number, z: number) => number {
  const roads = simple.ways
    .filter((w) => w.t && ROAD_HALF[w.t.highway ?? ''] !== undefined)
    .map((w) => ({ p: w.p, half: centre ? 0 : roadWidth(w.t!) / 2 }));
  return (x, z) => {
    let d = Infinity;
    for (const r of roads)
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const ax = r.p[i];
        const az = r.p[i + 1];
        const dx = r.p[i + 2] - ax;
        const dz = r.p[i + 3] - az;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t) - r.half);
      }
    return d;
  };
}

/** Çit dışı kaldırım (kilit taşı, isteğe bağlı sarı kılavuz şerit), sokak kaldırımıyla birleşir; asfalta taşmaz */
function fenceWalk(
  b: Builder,
  o: { simple: SimpleOsm; H: (x: number, z: number) => number },
  segs: { a: V2; e: V2; n: V2 }[],
  key: string,
  tactile: boolean,
  skip?: (x: number, z: number) => boolean,
): void {
  const roadGap = roadGapFn(o.simple);
  for (const s of segs) {
    const len = Math.hypot(s.e[0] - s.a[0], s.e[1] - s.a[1]);
    const t: V2 = [(s.e[0] - s.a[0]) / len, (s.e[1] - s.a[1]) / len];
    const yaw = Math.atan2(-t[1], t[0]);
    // 3 m'lik parçalar: her parçada asfalta kalan mesafe ayrı (kavşak yakınında daralır)
    const nP = Math.max(1, Math.ceil(len / 3));
    for (let k = 0; k < nP; k++) {
      const u0 = (len * k) / nP;
      const u1 = (len * (k + 1)) / nP;
      const A: V2 = [s.a[0] + t[0] * u0, s.a[1] + t[1] * u0];
      const E: V2 = [s.a[0] + t[0] * u1, s.a[1] + t[1] * u1];
      const gap = Math.min(
        roadGap(A[0], A[1]),
        roadGap(E[0], E[1]),
        roadGap((A[0] + E[0]) / 2, (A[1] + E[1]) / 2),
      );
      // Bordüre kadar (sokak kaldırımını da örter), en çok 6 m
      const W = Math.min(6, gap - 0.03);
      if (W < 0.3) continue;
      if (skip) {
        const m: V2 = [(A[0] + E[0]) / 2 + s.n[0] * W * 0.5, (A[1] + E[1]) / 2 + s.n[1] * W * 0.5];
        if (skip(m[0], m[1])) continue;
      }
      b.drape(
        key,
        [A, E, [E[0] + s.n[0] * W, E[1] + s.n[1] * W], [A[0] + s.n[0] * W, A[1] + s.n[1] * W]],
        [],
        o.H,
        0.17,
        1,
        3,
      );
      if (tactile && W > 1.2) {
        const m: V2 = [(A[0] + E[0]) / 2 + s.n[0] * W * 0.55, (A[1] + E[1]) / 2 + s.n[1] * W * 0.55];
        b.box('tactile', [m[0], o.H(m[0], m[1]) + 0.18, m[1]], [u1 - u0, 0.012, 0.3], yaw);
      }
    }
  }
}

/** Galvaniz direk + üst üste levhalar (yüz: face yönü) */
function signPole(b: Builder, p: V2, face: V2, y0: number, keys: string[]): void {
  b.cylinder('pole', [p[0], y0, p[1]], 0.04, 3.1, 8);
  const t: V2 = [face[1], -face[0]];
  let y = y0 + 3.05;
  for (const k of keys) {
    const s = k === 'signCurve' ? 0.9 : 0.7;
    const c: V2 = [p[0] + face[0] * 0.06, p[1] + face[1] * 0.06];
    const a: V2 = [c[0] - t[0] * (s / 2), c[1] - t[1] * (s / 2)];
    const e: V2 = [c[0] + t[0] * (s / 2), c[1] + t[1] * (s / 2)];
    // Ön yüz face yönüne: wall(a→e) normali (−dz, dx) = face olmalı
    const front = -(e[1] - a[1]) * face[0] + (e[0] - a[0]) * face[1] > 0;
    b.wall(k, front ? a : e, front ? e : a, y - s, y);
    b.wall(`${k}Back`, front ? e : a, front ? a : e, y - s, y);
    y -= s + 0.06;
  }
}

export interface MertkentOptions {
  simple: SimpleOsm;
  base: string;
  H: (x: number, z: number) => number;
  shadows: boolean;
  collide?: Collide;
  /** OSM yol malzemesi (bordür ile OSM asfaltı arasındaki dolgu aynı görünsün) */
  roadMaterial?: THREE.Material;
}

/** Elle modellenmiş bölgeyi kurar. fenceSkip: StreetView çit kabuğunun bu bölgede çizilmemesi için. */
export async function buildMertkent(o: MertkentOptions): Promise<{
  group: THREE.Group;
  fenceSkip: (x: number, z: number) => boolean;
  noTree?: (x: number, z: number) => boolean;
  /** Site otoparklarına park etmiş araçlar [x, y, z, yaw, tohum]* */
  cars: number[];
  /** Yürüme yüksekliği için yükseltilmiş alanlar (ölçülmüş kaldırımlar) */
  raised: { poly: [number, number][]; h: number }[];
}> {
  const group = new THREE.Group();
  group.name = 'mertkent (el modeli)';
  const b = new Builder();
  const extraMats: Record<string, THREE.Material> = {};
  // Ölçülmüş sokak: kaldırım, bordür, sokak eşyası (street-plan.json); varsa eski tahmini kaldırım çizilmez
  const street =
    (STREET_PLAN.sidewalks?.length ?? 0) + (STREET_PLAN.street?.length ?? 0) > 0
      ? buildStreetPlan(b, STREET_PLAN, o.H, roadGapFn(o.simple, true))
      : null;
  const walkSkip = street ? street.covers : undefined;
  const ringBase = (r: V2[]) => Math.min(...r.map((p) => o.H(p[0], p[1])));
  // Bloklar: adlar kuzeybatıdan başlayarak (kuzey→güney, batı→doğu)
  const FACADES = FACADES_ALL;
  const FOOT = footprintsData as unknown as Record<string, { ring: V2[] }>;
  const blocks = MERTKENT_BUILDINGS.map((id) => ({
    id,
    r: (FOOT[id]?.ring.map((p) => [p[0], p[1]] as V2) ?? ringOf(o.simple, id)) as V2[] | null,
  }))
    .filter((x): x is { id: number; r: V2[] } => !!x.r)
    .map((x) => {
      const c = x.r.reduce((a, p) => [a[0] + p[0] / x.r.length, a[1] + p[1] / x.r.length], [0, 0]);
      return { ...x, c };
    })
    .sort((p, q) => (Math.abs(p.c[1] - q.c[1]) > 20 ? p.c[1] - q.c[1] : p.c[0] - q.c[0]));
  blocks.forEach((blk, bi) => {
    const { id, r } = blk;
    const base = ringBase(r);
    const w = o.simple.ways.find((x) => x.i === id);
    const lv = Number(w?.t?.['building:levels']);
    const name = BLOCK_NAMES[bi];
    const fac = FACADES[id];
    if (fac && !NO_SURVEY)
      buildFacadeBlock(b, fac, base, {
        seed: id % 100000,
        collide: o.collide,
        signKey: `blockSign${name}`,
        keys: paletteKeys(fac, id, extraMats),
      });
    else
      buildApartment(b, {
        ring: r,
        base,
        seed: id % 100000,
        floors: Number.isFinite(lv) && lv > 0 ? lv + 1 : 7,
        inside: SITE_INSIDE,
        name,
        signKey: `blockSign${name}`,
      });
    o.collide?.(
      r.map((p) => [p[0], p[1]]),
      base - 1,
      base + 25,
    );
  });
  // Ölçülmüş komşu binalar
  if (!NO_SURVEY)
    for (const id of SURVEYED_EXTRA) {
      const fac = FACADES[id];
      const r = fac.ring.map((p) => [p[0], p[1]] as V2);
      const base = ringBase(r);
      const keys = paletteKeys(fac, id, extraMats);
      for (const part of splitMassing(fac))
        buildFacadeBlock(b, part, base, { seed: part.id % 100000, collide: o.collide, keys });
      o.collide?.(
        r.map((p) => [p[0], p[1]]),
        base - 1,
        base + 40,
      );
    }
  // Özhan
  // Düzeltilmiş taban izi (hava fotoğrafı; OSM ile aynı köşe sırası), yoksa OSM
  const oz = (FOOT[OZHAN_BUILDING]?.ring.map((p) => [p[0], p[1]] as V2) ??
    ringOf(o.simple, OZHAN_BUILDING)) as V2[] | null;
  if (oz) buildOzhan(b, oz, ringBase(oz), o.collide);
  // Site sınırı: bake edilen çit hatlarından Mertkent 2 çevresindekiler
  const site = o.simple.ways.find((w) => w.t?.name === 'Mertkent 2. Etap');
  const siteRing: V2[] = [];
  if (site) for (let i = 0; i < site.p.length; i += 2) siteRing.push([site.p[i], site.p[i + 1]]);
  if (siteRing.length > 3) {
    const f = siteRing[0];
    const l = siteRing[siteRing.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) siteRing.pop();
  }
  const nearSite = (x: number, z: number) => siteRing.length > 2 && distToRing(siteRing, x, z) < 13;
  // Site içi: çim, döşeme, yollar, havuz
  let noTree: ((x: number, z: number) => boolean) | undefined;
  const holes: [number, number, number, number][] = [];
  const cars: number[] = [];
  let carSeed = 7;
  const addBays = (bays: { x: number; z: number; yaw: number }[]) => {
    for (const bay of bays) {
      carSeed = (carSeed * 16807) % 2147483647;
      if (carSeed % 100 > 64) continue;
      cars.push(bay.x, o.H(bay.x, bay.z) + 0.1, bay.z, bay.yaw + ((carSeed % 7) - 3) * 0.01, carSeed % 1000);
    }
  };
  if (siteRing.length > 2) {
    const inSite = (w: { p: number[] }) => {
      for (let i = 0; i < w.p.length; i += 2) if (insidePoly(siteRing, w.p[i], w.p[i + 1])) return true;
      return false;
    };
    const line = (w: { p: number[] }) => {
      const r: V2[] = [];
      for (let i = 0; i < w.p.length; i += 2) r.push([w.p[i], w.p[i + 1]]);
      return r;
    };
    const ways = o.simple.ways.filter((w) => w.t && inSite(w));
    const paths = ways.filter((w) => w.t!.highway === 'footway' && w.t!.footway !== 'sidewalk').map(line);
    const drives = ways.filter((w) => w.t!.highway === 'service').map(line);
    const poolW = ways.find((w) => w.t!.leisure === 'swimming_pool');
    const pool = poolW ? line(poolW) : null;
    if (pool && pool.length > 3) {
      const f = pool[0];
      const l = pool[pool.length - 1];
      if (f[0] === l[0] && f[1] === l[1]) pool.pop();
    }
    if (!USE_PLAN) {
      const g = buildGrounds(b, {
        site: siteRing,
        buildings: blocks.map((x) => x.r),
        pool,
        paths,
        drives,
        H: o.H,
        collide: o.collide,
      });
      holes.push(...g.holes);
      noTree = g.noTree;
      addBays(g.bays);
    }
  }
  if (USE_PLAN) {
    // Ölçülmüş site planı (Mertkent + Salusvizyon iç alanları)
    const sp = buildSitePlan(b, SITE_PLAN, o.H, o.collide);
    holes.push(...sp.holes);
    cars.push(...sp.cars);
  }
  if ((PARK_PLAN.areas?.length ?? 0) + (PARK_PLAN.points?.length ?? 0) > 0) {
    // Ölçülmüş komşu parklar (kuzey park, Nato Parkı)
    const pp = buildSitePlan(b, PARK_PLAN, o.H, o.collide);
    holes.push(...pp.holes);
    cars.push(...pp.cars);
  }
  // ── Salusvizyon ──
  const salusSite = ringOf(o.simple, SALUS_SITE);
  const salusB = ringOf(o.simple, SALUS_BUILDING);
  if (salusSite && salusB) {
    const salusFac = FACADES[SALUS_BUILDING];
    const salusRingC = (salusFac?.ring.map((p) => [p[0], p[1]] as V2) ?? salusB) as V2[];
    const base = ringBase(salusRingC);
    if (salusFac && !NO_SURVEY)
      buildFacadeBlock(b, salusFac, base, {
        seed: 4242,
        collide: o.collide,
        keys: paletteKeys(salusFac, SALUS_BUILDING, extraMats),
      });
    else
      buildApartment(b, {
        ring: salusB,
        base,
        seed: 4242,
        floors: 7,
        inside: [-78, -178],
        style: SALUS_STYLE,
      });
    o.collide?.(
      salusRingC.map((p) => [p[0], p[1]]),
      base - 1,
      base + 25,
    );
    const pool = ringOf(o.simple, SALUS_POOL);
    const g = USE_PLAN
      ? null
      : buildGrounds(b, {
          site: salusSite,
          buildings: [salusB],
          pool,
          paths: [
            [
              [-82.2, -172.1],
              [-84.2, -172.1],
            ],
            [
              [-95.5, -158],
              [-99.6, -155],
            ],
          ],
          drives: [
            [
              [-81.5, -163.4],
              [-95.5, -163.2],
              [-95.8, -136.5],
            ],
          ],
          H: o.H,
          collide: o.collide,
          seed: 5,
        });
    if (g) {
      holes.push(...g.holes);
      addBays(g.bays);
      const nt = noTree;
      noTree = (x, z) => (nt ? nt(x, z) : false) || g.noTree(x, z);
    }
    // Sokak yüzlerinde tuğla çit (kuzey kenarı Özhan otoparkına, güney kenar yeşil alana bakar)
    const c = salusSite.reduce(
      (a, p) => [a[0] + p[0] / salusSite.length, a[1] + p[1] / salusSite.length],
      [0, 0],
    );
    const segs: BrickSeg[] = [];
    for (let i = 0; i < salusSite.length; i++) {
      const a = salusSite[i];
      const e = salusSite[(i + 1) % salusSite.length];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (len < 1) continue;
      let n: V2 = [-(e[1] - a[1]) / len, (e[0] - a[0]) / len];
      const mx = (a[0] + e[0]) / 2;
      const mz = (a[1] + e[1]) / 2;
      if (n[0] * (mx - c[0]) + n[1] * (mz - c[1]) < 0) n = [-n[0], -n[1]];
      segs.push({ a, e, y0: Math.min(o.H(a[0], a[1]), o.H(e[0], e[1])), n });
    }
    const gc = SALUS_GATE;
    const gt: V2 = [gc.n[1], -gc.n[0]];
    buildBrickFence(b, segs, [{ c: [gc.c[0] + gt[0] * -0.9, gc.c[1] + gt[1] * -0.9], half: 5.4 }], o.collide);
    buildSalusGate(b, gc.c, gc.n, o.H(gc.c[0], gc.c[1]), o.collide);
    // Salus önü kaldırım: Street View'da bej-gri kilit taşı (kırmızı değil)
    fenceWalk(b, o, segs, 'spPaverGrey', false, walkSkip);
  }
  holes.slice(0, 4).forEach((h, i) => groundHoles.value[i].set(h[0], h[1], h[2], h[3]));
  // Çit: site sınırı kenarları (sokağa bakan normal = dışa)
  if (siteRing.length > 2) {
    const c = siteRing.reduce(
      (a, p) => [a[0] + p[0] / siteRing.length, a[1] + p[1] / siteRing.length],
      [0, 0],
    );
    const segs: FenceSeg[] = [];
    for (let i = 0; i < siteRing.length; i++) {
      const a = siteRing[i];
      const e = siteRing[(i + 1) % siteRing.length];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (len < 0.5) continue;
      let n: V2 = [-(e[1] - a[1]) / len, (e[0] - a[0]) / len];
      if (n[0] * ((a[0] + e[0]) / 2 - c[0]) + n[1] * ((a[1] + e[1]) / 2 - c[1]) < 0) n = [-n[0], -n[1]];
      segs.push({ a, e, y0: Math.min(o.H(a[0], a[1]), o.H(e[0], e[1])), n });
    }
    const gateGaps = [
      ...GATES.map((g) => ({ c: g.c, w: SP_GATES.length ? 2.45 : 2.5 })),
      // Ölçülmüş araç kapılarında w = kolonlar arası net açıklık; kolon merkezleri açıklık kenarından yarım kolon dışarıda
      ...DRIVE_GATES.map((g) => ({ c: g.c, w: SP_GATES.length ? g.w + 0.37 : g.w + 0.9 })),
      ...DOORS.map((g) => ({ c: g.c, w: g.w + 0.1 })),
    ];
    const plen = (pts: V2[]) =>
      pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    const mkAll = (STREET_PLAN.fence ?? []).filter((f) => f.kind === 'mertkent' && f.pts?.length >= 2);
    // Ölçüm tamamlanmamışsa (çevrenin %70'inden azı) OSM sınırından çit
    const covered =
      mkAll.reduce((a, f) => a + plen(f.pts), 0) / Math.max(1, plen([...siteRing, siteRing[0]]));
    const mkFences = covered > 0.7 ? mkAll : [];
    if (OLD_FENCE)
      buildFence(
        b,
        segs,
        gateGaps.map((g) => ({ c: g.c, half: g.w / 2 })),
        o.collide,
      );
    else if (mkFences.length)
      for (const f of mkFences) {
        // Kapalı döngü: bir hattın son kolonu sonrakinin ilk kolonu
        const last = f.pts[f.pts.length - 1];
        const shared = mkFences.some(
          (g) => g !== f && Math.hypot(g.pts[0][0] - last[0], g.pts[0][1] - last[1]) < 0.3,
        );
        buildMertkentFence(b, { ...f, endPillar: !shared }, SITE_INSIDE, o.H, gateGaps, o.collide);
      }
    else
      buildMertkentFence(
        b,
        { kind: 'mertkent', pts: [...siteRing, siteRing[0]], screenDefault: 'real' },
        SITE_INSIDE,
        o.H,
        gateGaps,
        o.collide,
      );
    for (const g of DRIVE_GATES)
      buildDriveGate(b, g.c, g.n, o.H(g.c[0], g.c[1]) + (SP_GATES.length ? 0.03 : 0), g.w, !SP_GATES.length);
    for (const g of DOORS) buildSideDoor(b, g.c, g.n, o.H(g.c[0], g.c[1]) + 0.15, g.w, g.h ?? 2);
    // Ölçülmüş kaldırımlar site çevresinin tamamını kapsıyor → eski tahmini kaldırım yok
    if (!street) fenceWalk(b, o, segs, 'walk', true);
  }
  // Komşu sitelerin ölçülmüş çitleri (street-plan kind "other") + kapıları
  {
    const cache = new Map<string, string>();
    const mat = (kind: string, color: string) => {
      const k = `gf_${kind}_${color}`;
      if (!cache.has(k)) {
        cache.set(k, k);
        const DSd = THREE.DoubleSide;
        extraMats[k] =
          kind === 'mesh'
            ? new THREE.MeshStandardMaterial({
                map: T.meshFenceTexture(),
                color,
                alphaTest: 0.45,
                side: DSd,
                roughness: 0.5,
                metalness: 0.2,
              })
            : kind === 'bars'
              ? new THREE.MeshStandardMaterial({
                  map: T.ironBarsTexture(),
                  color,
                  alphaTest: 0.5,
                  side: DSd,
                  roughness: 0.4,
                  metalness: 0.6,
                })
              : kind === 'metal'
                ? new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.5 })
                : granularMaterial(
                    color,
                    kind === 'brick' ? 14 : kind === 'stone' ? 15 : 13,
                    { roughness: 0.9 },
                    kind === 'stone' || kind === 'brick' ? { mottle: 0.12, bump: 2.5 } : undefined,
                  );
      }
      return k;
    };
    const others = (STREET_PLAN.fence ?? []).filter(
      (f) => f.kind === 'other' && f.pts?.length >= 2,
    ) as unknown as GenericFence[];
    const og = (STREET_PLAN.gates ?? []).filter((g) => /^da\d-/.test((g as { id?: string }).id ?? ''));
    const gapsO = og.map((g) => ({ c: g.c, w: g.w + 0.3 }));
    for (const f of others) buildGenericFence(b, f, o.H, mat, gapsO, o.collide);
    for (const g of og) {
      const y = o.H(g.c[0], g.c[1]) + 0.05;
      // Komşu sitelerde yaya kapıları da siyah çubuklu (ölçüm notları)
      buildDriveGate(b, g.c, g.n, y, g.w, false);
    }
  }
  // Park Koza Sitesi girişi (502. Sk doğu yakası, güney uç; Street View l4zd… kuzey karesi)
  buildParkKoza(b, [11.2, -37.4], [0, 1], o.H(11.2, -37.4) + 0.05, o.collide);
  for (const g of GATES) buildGate(b, g.c, g.n, o.H(g.c[0], g.c[1]) + (SP_GATES.length ? 0.15 : 0));
  // Kuzey kapı önü: tehlikeli viraj + 30 levhası (Street View kuzey kapı karesi), doğuya giden şeride bakar
  if (!street) signPole(b, [-31.3, -145.8], [-0.95, -0.31], o.H(-31.3, -145.8), ['signCurve', 'sign30']);
  const mats = materials(o.base);
  extraMats.roadFill = o.roadMaterial ?? mats.drive;
  b.build({ ...mats, ...extraMats }, group, o.shadows);
  // Özhan önünde (vitrin, otopark) ağaç yok
  if (oz) {
    const nt = noTree;
    noTree = (x, z) => (nt ? nt(x, z) : false) || insidePoly(oz, x, z) || distToRing(oz, x, z) < 7;
  }
  const salusRing = ringOf(o.simple, SALUS_SITE);
  // KARAR: ölçülmüş bölgede (street-plan) Street View'dan tahmin edilmiş çit kabukları çizilmez
  const fenceSkip = (x: number, z: number) =>
    (x > -142 && x < 28 && z > -222 && z < 4) ||
    nearSite(x, z) ||
    (!!salusRing && (insidePoly(salusRing, x, z) || distToRing(salusRing, x, z) < 8));
  return { group, fenceSkip, noTree, cars, raised: street?.raised ?? [] };
}
