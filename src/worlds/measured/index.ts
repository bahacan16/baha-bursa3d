import * as THREE from 'three';
import type { SimpleOsm } from '../osm/simplify';
import { Builder, type V2 } from './builder';
import { buildApartment, insidePoly, type ApartmentStyle } from './apartment';
import { buildFacadeBlock, footCollision, type CK, type CompiledBlock, type SignSpec } from './facade';
import { SignAtlas } from './signatlas';
import { splitMassing } from './massing';
import {
  camGlassMaterial,
  flagTexture,
  granularMaterial,
  windowGlassMaterial,
  withGlassEnv,
} from './facadeMats';
import facadesData from './data/facades.json';
import footprintsData from './data/footprints.json';
import { buildStreetPlan, streetSignTexture } from './street';
import { buildMertkentFence, type FenceSpec } from './fence2';
import { buildGenericFence, buildWroughtGate, type GenericFence } from './fenceGeneric';
import {
  buildSitePlan,
  lawnTint,
  hedgeTint,
  nearPlanLine,
  planLines,
  PARK_PLAN,
  SITE_PLAN,
  STREET_PLAN as STREET_PLAN0,
  type StreetPlan,
} from './siteplan';
import { bonePaverTextures, ironScrollTexture, paverTextures, tactileTextures } from './facadeMats';

/** Ölçülmüş site planı varsa eski kural tabanlı zemin yerine o kullanılır (?oldgrounds=1 eskisi) */
const USE_PLAN =
  (SITE_PLAN.areas?.length ?? 0) > 0 &&
  !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('oldgrounds'));

/** Ölçülmüş sokak planı (street-plan.json, ajan ölçümü) — yoksa OSM site sınırından çit */
/** v8: leylandi çit rengi düzeltmesi (doğrusal çarpan; mkHedge / mkHedgeTop) */
const HEDGE_FIX = new THREE.Color().setRGB(0.82, 0.9, 1.8);
const STREET_PLAN = STREET_PLAN0 as Omit<StreetPlan, 'fence'> & { fence?: FenceSpec[] };
import { buildBrickFence, buildSalusGate, type BrickSeg } from './salus';
import {
  buildDriveGate,
  buildFence,
  buildGate,
  buildParkKoza,
  buildPlanGate,
  gateGapWidth,
  type FenceSeg,
  type PlanGate,
} from './site';
import { buildOzhan } from './ozhan';
import { parkingBlockers, parkingCars, type ParkingStrip } from '../../sim/parked';
import { buildGrounds } from './grounds';
import { groundHoles } from '../osm/materials';
import { loadPbr, type PbrRole } from '../osm/pbr';
import { roadWidth } from '../osm/parse';
import * as T from './textures';
import { nightUniform } from '../../env/night';
import { windTime } from '../osm/eztree';
import { addTactileVariant, upgradeRealMaterials } from './realtex';

const BLOCK_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];
/** ?nosurvey=1 → ölçülmüş cepheler yerine eski kural tabanlı apartman modeli (karşılaştırma için) */
const NO_SURVEY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosurvey');
const OLD_FENCE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('oldfence');
/** `?noparking` — ölçülmüş park şeritlerindeki araçları kapatır (önce/sonra karşılaştırması) */
const NO_PARKING = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noparking');
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
 * Ölçülmüş bölge (Mertkent 2. Etap dahil) — Street View karelerine bakılarak elle (kodla) modellenmiş bölüm.
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
/**
 * OSM'de bina diye çizilmiş ama bina olmayan kayıtlar (doğrulandı, çizilmez).
 * 1541439439/40: Özlüce kavşağı batısı boş arsa — hava fotoğrafında gölgesiz, çim bitmiş beton plaklar; Street View
 * 2014 ve 2025'te boş alan + "Bursa Vergi Dairesi Başkanlığı Hizmet Binası Proje Alanıdır" levhası.
 */
const NOT_BUILDINGS = [1541439439, 1541439440];
export const HANDMADE_IDS = new Set([
  ...MERTKENT_BUILDINGS,
  OZHAN_BUILDING,
  SALUS_BUILDING,
  ...SURVEYED_EXTRA,
  ...NOT_BUILDINGS,
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
/**
 * Ölçülmüş kapılar (street-plan.json; Salusvizyon kapıları salus.ts'de). Komşu site kapıları (id "da1-…") komşu
 * çitlerle birlikte ayrıca çizilir — önceden burada da Mertkent yaprak kapısı olarak ikinci kez çiziliyordu
 * (555/556 önündeki siyah yaya kapıları yeşil yaprak kutusu görünüyordu).
 */
const SP_GATES = (STREET_PLAN.gates ?? []).filter(
  (g) => !/^(salus|da\d-)/.test((g as { id?: string }).id ?? ''),
);
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
  style?: 'leaf' | 'slats';
  color?: string;
  pillars?: { w: number; h: number; color: string; lamp?: string };
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

/**
 * Oyma baklava kafes desenli prekast duvar yüzü (503. Sk. batı duvarı, street-plan wall.pattern lattice): hücre
 * `cell` m; oluklar düşük kabartma (normal haritası + hafif koyu derz). UV dünya metresi (box uvScale 1).
 */
function latticeMaterial(color: string, cell: number): THREE.Material {
  if (typeof document === 'undefined') return new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const nv = document.createElement('canvas');
  nv.width = nv.height = N;
  const gn = nv.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N, N);
  gn.fillStyle = 'rgb(128,128,255)';
  gn.fillRect(0, 0, N, N);
  // Baklava: iki çapraz oluk (hücre köşeden köşeye)
  const groove = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    for (const sg of [-1, 1]) {
      gn.strokeStyle = `rgb(${128 + sg * nx * 70},${128 + sg * ny * 70},235)`;
      gn.lineWidth = 3;
      gn.beginPath();
      gn.moveTo(x0 + sg * 2 * nx, y0 + sg * 2 * ny);
      gn.lineTo(x1 + sg * 2 * nx, y1 + sg * 2 * ny);
      gn.stroke();
    }
  };
  for (const o of [-N, 0, N]) {
    groove(o, 0, o + N, N, 0.707, -0.707);
    groove(o + N, 0, o, N, 0.707, 0.707);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const nm = new THREE.CanvasTexture(nv);
  for (const t of [map, nm]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / cell, 1 / cell);
    t.anisotropy = 8;
  }
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: nm,
    normalScale: new THREE.Vector2(0.6, 0.6),
    color,
    roughness: 0.9,
  });
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

/**
 * Derzli kaplama malzemesi (`clad:<v|h|g|n>:<aralık>:<derz genişliği>:<derz rengi>[:<ikinci aralık>][:<acp|matte>]`,
 * taban rengi hex): beyaz tabanlı derz dokusu (derz pikseli = derz rengi / taban rengi) × taban rengi, derz
 * kenarlarında normal; doku tekrarı aralığa göre (dünya UV = metre). v7: g = iki yönde derz (kompozit panel ızgarası:
 * aralık yatay, ikinci aralık düşey), n = derzsiz; bitiş acp (parlak alüminyum kompozit) / matte.
 */
function cladMaterial(kind: string, hex: string): THREE.Material {
  const [, dir, ev, wv, gc, ev2, fin] = kind.split(':');
  const every = Math.max(0.03, Number(ev) || 0.15);
  const every2 = Math.max(0.03, Number(ev2) || every);
  const rough = fin === 'acp' ? 0.32 : fin === 'matte' ? 0.92 : 0.75;
  const metal = fin === 'acp' ? 0.25 : 0;
  const base = new THREE.Color(hex);
  const gcol = new THREE.Color(/^#[0-9a-f]{6}$/i.test(gc ?? '') ? gc : '#000000');
  if (typeof document === 'undefined' || dir === 'n')
    return new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
  if (dir === 'd') {
    // v7 delikli (perfore) panel: tekrar hücresinin ortasında delik (çap = derz genişliği), hücre = aralık
    const N = 32;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d')!;
    const r = (c: number, bc: number) => Math.round(255 * Math.min(1, bc > 0.01 ? c / bc : 1));
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, N, N);
    g.fillStyle = `rgb(${r(gcol.r, base.r)},${r(gcol.g, base.g)},${r(gcol.b, base.b)})`;
    g.beginPath();
    g.arc(N / 2, N / 2, Math.max(1, Math.min(0.45, (Number(wv) || 0.02) / every / 2) * N), 0, Math.PI * 2);
    g.fill();
    const map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    map.repeat.set(1 / every, 1 / every);
    return new THREE.MeshStandardMaterial({ map, color: hex, roughness: rough, metalness: metal });
  }
  if (dir === 's' || dir === 'p') {
    // v9: s = 8 kollu yıldız ağı / geçme deseni (tekrar = aralık, çizgi = derz genişliği; yaklaşık motif),
    // p = çift yatay derz (aralık = çift aralığı, ikinci aralık = çift içi mesafe; derzler v = 0 ve v = ikinci aralık)
    const N = dir === 's' ? 128 : 256;
    const cv = document.createElement('canvas');
    cv.width = dir === 's' ? N : 4;
    cv.height = N;
    const g = cv.getContext('2d')!;
    const r = (c: number, bc: number) => Math.round(255 * Math.min(1, bc > 0.01 ? c / bc : 1));
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cv.width, cv.height);
    const jc = `rgb(${r(gcol.r, base.r)},${r(gcol.g, base.g)},${r(gcol.b, base.b)})`;
    const lw = Math.max(1, ((Number(wv) || 0.02) / every) * N);
    if (dir === 's') {
      g.strokeStyle = jc;
      g.lineWidth = lw;
      const c = N / 2;
      const R = N * 0.34;
      // Hücre ortasında iki kare (45° dönük) = 8 kollu yıldız; köşe yıldızlarına bağlanan geçme çizgileri
      const star = (cx: number, cy: number) => {
        for (const a0 of [0, Math.PI / 4]) {
          g.beginPath();
          for (let k = 0; k < 4; k++) {
            const a = a0 + (k * Math.PI) / 2 + Math.PI / 4;
            const x = cx + Math.cos(a) * R;
            const y = cy + Math.sin(a) * R;
            if (k) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          g.closePath();
          g.stroke();
        }
      };
      for (const [cx, cy] of [
        [c, c],
        [0, 0],
        [N, 0],
        [0, N],
        [N, N],
      ])
        star(cx, cy);
      // Yıldız uçlarından komşu hücreye geçme bağları
      g.beginPath();
      for (const [x0, y0, x1, y1] of [
        [c, c - R, c, 0],
        [c, c + R, c, N],
        [c - R, c, 0, c],
        [c + R, c, N, c],
      ]) {
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
      }
      g.stroke();
    } else {
      const e2 = Math.max(0.02, Math.min(every - 0.02, Number(ev2) || every / 4));
      g.fillStyle = jc;
      g.fillRect(0, 0, 4, lw);
      g.fillRect(0, Math.round((e2 / every) * N), 4, lw);
    }
    const map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    if (dir === 's') map.repeat.set(1 / every, 1 / every);
    else map.repeat.set(1, 1 / every);
    return new THREE.MeshStandardMaterial({ map, color: hex, roughness: rough, metalness: metal });
  }
  const N = 64;
  const cv = document.createElement('canvas');
  const nv = document.createElement('canvas');
  const grid = dir === 'g';
  const vert = dir !== 'h';
  cv.width = nv.width = vert ? N : 4;
  cv.height = nv.height = vert && !grid ? 4 : N;
  const g = cv.getContext('2d')!;
  const ng = nv.getContext('2d')!;
  const r = (c: number, bc: number) => Math.round(255 * Math.min(1, bc > 0.01 ? c / bc : 1));
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, cv.width, cv.height);
  ng.fillStyle = 'rgb(128,128,255)';
  ng.fillRect(0, 0, nv.width, nv.height);
  const frac = Math.max(0.02, Math.min(0.4, (Number(wv) || 0.02) / every));
  const frac2 = Math.max(0.02, Math.min(0.4, (Number(wv) || 0.02) / every2));
  const gw = Math.max(1, Math.round(N * frac));
  const gh = Math.max(1, Math.round(N * frac2));
  g.fillStyle = `rgb(${r(gcol.r, base.r)},${r(gcol.g, base.g)},${r(gcol.b, base.b)})`;
  if (grid) {
    g.fillRect(0, 0, gw, N);
    g.fillRect(0, 0, N, gh);
  } else if (vert) g.fillRect(0, 0, gw, 4);
  else g.fillRect(0, 0, 4, gw);
  // Derz kenarlarında eğim (normal haritası): derzin iki yanı içe bakar
  if (grid || vert) {
    ng.fillStyle = 'rgb(40,128,215)';
    ng.fillRect(gw, 0, 1, nv.height);
    ng.fillStyle = 'rgb(216,128,215)';
    ng.fillRect(N - 1, 0, 1, nv.height);
  }
  if (grid || !vert) {
    ng.fillStyle = 'rgb(128,40,215)';
    ng.fillRect(0, grid ? gh : gw, nv.width, 1);
    ng.fillStyle = 'rgb(128,216,215)';
    ng.fillRect(0, nv.height - 1, nv.width, 1);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const nm = new THREE.CanvasTexture(nv);
  for (const t of [map, nm]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (grid) t.repeat.set(1 / every, 1 / every2);
    else if (vert) t.repeat.set(1 / every, 1);
    else t.repeat.set(1, 1 / every);
  }
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: nm,
    color: hex,
    roughness: rough,
    metalness: metal,
  });
}

/** v7: uzakta sönümlenen ince derz (yakında koyu şerit; ~25–40 m arası saydamlaşır → kesikli çizgi titreşimi yok) */
function grooveMaterial(color: THREE.ColorRepresentation): THREE.Material {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  m.userData.noCast = true;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <alphatest_fragment>',
      '#include <alphatest_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(24.0, 38.0, length(vViewPosition));',
    );
  };
  m.customProgramCacheKey = () => 'mk-groove-fade-v1';
  return m;
}

/** v7: neon / LED şerit tüpü: gündüz renkli cam, gece parlak */
function neonMaterial(hex: string): THREE.Material {
  const c = new THREE.Color(hex);
  const m = new THREE.MeshStandardMaterial({
    color: c.clone().lerp(new THREE.Color(0xffffff), 0.35),
    emissive: c,
    emissiveIntensity: 1,
    roughness: 0.3,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= mix(0.12, 1.8, uNight);',
      );
  };
  m.customProgramCacheKey = () => 'mk-neon-v1';
  return m;
}

/**
 * v7: çok renkli karo bandı (`tiles:<karo m>:<#renk,…>:<sıra>`, hex = derz rengi): karolar kare, sıra verilirse
 * palet indeksleri (u boyunca döngü), yoksa tohumlu; satırlar birer kaydırmalı. UV = metre.
 */
function tilesMaterial(kind: string, hex: string): THREE.Material {
  const [, ts, cs, sq] = kind.split(':');
  const tile = Math.max(0.03, Number(ts) || 0.2);
  const cols = (cs ?? '').split(',').filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (typeof document === 'undefined' || !cols.length)
    return new THREE.MeshStandardMaterial({ color: cols[0] ?? hex, roughness: 0.3 });
  const seq = (sq ?? '')
    .split('.')
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x >= 0 && x < cols.length);
  const NX = seq.length || 12;
  const NY = 4;
  const P = 32;
  const cv = document.createElement('canvas');
  cv.width = NX * P;
  cv.height = NY * P;
  const g = cv.getContext('2d')!;
  g.fillStyle = hex;
  g.fillRect(0, 0, cv.width, cv.height);
  let s0 = 7;
  const rnd = () => {
    s0 = (s0 * 16807) % 2147483647;
    return s0 / 2147483647;
  };
  for (let yy = 0; yy < NY; yy++)
    for (let xx = 0; xx < NX; xx++) {
      const ci = seq.length ? seq[(xx + yy * 3) % seq.length] : Math.floor(rnd() * cols.length);
      g.fillStyle = cols[ci];
      g.fillRect(xx * P + 1, yy * P + 1, P - 2, P - 2);
    }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1 / (NX * tile), 1 / (NY * tile));
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.22, metalness: 0.05 });
}

/** v7: kare güvenlik kafesi (`cage:<göz m>`, hex = tel rengi): alfa testli ızgara, iki yüz; UV = metre */
function cageMaterial(kind: string, hex: string): THREE.Material {
  const ev = Math.max(0.03, Number(kind.split(':')[1]) || 0.15);
  if (typeof document === 'undefined')
    return new THREE.MeshStandardMaterial({ color: hex, side: THREE.DoubleSide });
  const N = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, N, N);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 3, N);
  g.fillRect(0, 0, N, 3);
  const map = new THREE.CanvasTexture(cv);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1 / ev, 1 / ev);
  return new THREE.MeshStandardMaterial({
    map,
    color: hex,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.5,
  });
}

/**
 * v7: desenli cam folyo (`film:<damask|dots|frost>`, hex = folyo rengi): yarı saydam desen (yaklaşık — damask
 * motifi birebir değil), 0.5 m tekrar; UV = metre
 */
function filmMaterial(kind: string, hex: string): THREE.Material {
  const pat = kind.split(':')[1] ?? 'frost';
  if (typeof document === 'undefined')
    return new THREE.MeshStandardMaterial({ color: hex, transparent: true, opacity: 0.6 });
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, N, N);
  if (pat === 'dots') {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let y = 8; y < N; y += 16)
      for (let x = (y / 16) % 2 ? 16 : 8; x < N; x += 16) g.fillRect(x - 3, y - 3, 6, 6);
  } else if (pat === 'damask') {
    // Yaklaşık damask: yarı saydam zemin + simetrik yaprak / kıvrım motifi (her 0.5 m)
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, 0, N, N);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4;
    for (const [cx, cy] of [
      [N / 2, N / 2],
      [0, 0],
      [N, 0],
      [0, N],
      [N, N],
    ]) {
      g.beginPath();
      g.ellipse(cx, cy, N * 0.18, N * 0.3, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(cx - N * 0.18, cy);
      g.quadraticCurveTo(cx, cy - N * 0.12, cx + N * 0.18, cy);
      g.stroke();
    }
  } else {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(0, 0, N, N);
  }
  const map = new THREE.CanvasTexture(cv);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  return new THREE.MeshStandardMaterial({
    map,
    color: hex,
    transparent: true,
    depthWrite: false,
    roughness: 0.4,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
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

/** Site içi kemik kilit taşı (dünya UV'si metre) */
function boneMat(palette: string[], seed: number, off: number): THREE.Material {
  if (typeof document === 'undefined') return new THREE.MeshStandardMaterial({ color: palette[0] });
  const t = bonePaverTextures(palette, seed);
  return new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.9,
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
    // v11: otobüs durağı camı — berrak (arkası görünür), hafif yeşilimsi; korkuluk camı (mkRailGlass, süt beyazı
    // %72 opak) durakta sütlü camgöbeği görünüyordu, fotoğrafta arka plan camın ardından okunuyor (critic d4a r3 #17,
    // d4b r3 #20). KARAR: ton / opaklık ölçülmedi (arka plan geçirgenliği) → yaygın 6 mm temperli cam görünümü
    mkShelterGlass: std({
      color: 0xc4d2cf,
      transparent: true,
      opacity: 0.2,
      roughness: 0.06,
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
    // KARAR: Nilüfer kaldırımı (yer fotoğrafları): gri beton tuğla 20×10, uzun kenar yol boyunca, şaşırtmalı;
    // taşlar arası belirgin ton farkı. Kaldırımlarda kırmızı bant yok (yalnız gri + sarı kılavuz [+ mavi bisiklet]).
    spPaverGrey: paverMat(['#9a9792', '#a19e98', '#938f8a', '#9d9994', '#8b8883', '#a5a19b'], 21, -5),
    // Site içi donatılar (yer fotoğrafları, sitekit.ts)
    kamSlab: granularMaterial('#b3afa8', 44, { roughness: 0.95 }),
    kamPost: std({ color: 0xcf9282, roughness: 0.8 }),
    kamWood: std({ color: 0x7b4f33, roughness: 0.75 }),
    kamRoof: std({ map: T.roofTileTexture('#5a4238'), roughness: 0.9, color: 0x9c8a82 }),
    ironScroll: std({
      map: typeof document === 'undefined' ? null : ironScrollTexture(),
      alphaTest: 0.4,
      side: DS,
      roughness: 0.5,
      metalness: 0.4,
    }),
    playBeige: std({ color: 0xe3d3ae, roughness: 0.55 }),
    playGreen: std({ color: 0x3fa03a, roughness: 0.45 }),
    playRed: std({ color: 0xcc3526, roughness: 0.45 }),
    playPink: std({ color: 0xf0b3c4, roughness: 0.5 }),
    binBlue: std({ color: 0x8fc3c8, roughness: 0.55, metalness: 0.2, side: DS }),
    roseRed: std({ color: 0xc41c2c, roughness: 0.6 }),
    rosePink: std({ color: 0xf08aa6, roughness: 0.6 }),
    cypress: std({ map: T.hedgeTexture(5), color: 0xc4dc84, roughness: 0.95 }),
    spPaintYellow: std({
      color: 0xe0b52a,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    }),
    siteKerb: std({ color: 0x8c8984, roughness: 0.85 }),
    glassFrost: std({
      color: 0xb4d2c8,
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.42,
      side: DS,
      depthWrite: false,
    }),
    rubberTile: (() => {
      if (typeof document === 'undefined') return std({ color: 0x3b3035 });
      const t = paverTextures(['#6a4f4b', '#735651', '#634946', '#6e524d'], {
        pw: 0.5,
        ph: 0.5,
        seed: 45,
        joint: '#2a1e1c',
      });
      const map = t.map.clone();
      const nm = t.normalMap.clone();
      map.repeat.set(0.5, 1);
      nm.repeat.set(0.5, 1);
      return std({
        map,
        normalMap: nm,
        roughness: 0.93,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      });
    })(),
    // Site içi kemik kilit taşı (yer fotoğrafları): gri + kırmızı bant/meydan
    spSiteGrey: boneMat(['#9d968e', '#a69f96', '#928b83', '#aca49b', '#978f86'], 41, -5),
    spSiteRed: boneMat(['#a06d5f', '#aa7767', '#955f53', '#a87263'], 42, -5),
    spPaverRed: paverMat(['#938882', '#9b908a', '#8b807a', '#968b85', '#877c76'], 22, -5),
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
    // Aşınmış yol boyası (yaya geçidi `wear`): gürültü alfa eşiği ≈ %25 / %50 / %75 eksik
    ...Object.fromEntries(
      [1, 2, 3].map((l) => [
        `spPaintWear${l}`,
        std({
          color: 0xeeeeea,
          roughness: 0.6,
          alphaMap: typeof document === 'undefined' ? null : T.paintWearTexture(11),
          alphaTest: [0, 0.38, 0.5, 0.62][l],
          polygonOffset: true,
          polygonOffsetFactor: -8,
          polygonOffsetUnits: -8,
        }),
      ]),
    ),
    spPlayBlue: std({ color: 0x2b6cc4, roughness: 0.4 }),
    // Bisiklet şeridi (yer fotoğrafı, 502. Sk.): mat mavi asfalt boyası
    spBike: std({
      color: 0x56758f,
      roughness: 0.9,
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
      // Doku duvarın dar bir bandı (fence2.ts WAVE_V): düşeyde aynalı tekrar (dikiş görünmesin)
      map.wrapT = THREE.MirroredRepeatWrapping;
      map.anisotropy = 8;
      const nm = new THREE.TextureLoader().load(`${base}textures/mk/mk-wave-n.png`);
      nm.wrapS = THREE.RepeatWrapping;
      nm.wrapT = THREE.MirroredRepeatWrapping;
      // KARAR: normal şiddeti 0.45 → 0.25 (fotoğrafta neredeyse düz, düşük kontrastlı nervür; kapitone görünüyordu)
      // v8 (gün ışığı kalibrasyonu): 0.25 → 0.12 ve dokudaki fotoğraf gölgelemesi yarıya (ölçülen duvar rengine
      // #eceae4 doğru %50 karışım) — AO kesintisinden sonra da güneşli Street View'dan 0.4–0.8 durak koyuydu; fotoğrafta
      // neredeyse düz beyaz
      const mat = std({
        map,
        normalMap: nm,
        normalScale: new THREE.Vector2(0.12, 0.12),
        roughness: 0.8,
        color: 0xffffff,
      });
      const flat = new THREE.Color('#eceae4');
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uWaveFlat = { value: flat };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uWaveFlat;')
          .replace(
            '#include <map_fragment>',
            '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uWaveFlat, 0.5);',
          );
      };
      mat.customProgramCacheKey = () => 'mk-wave-flat-v1';
      return mat;
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
    // Park Koza kapısı: gri 2D tel panel (saydam) + koyu gri kutu profil. KARAR: gri tonlar ölçülmedi (not: "gri",
    // "koyu gri") → nötr orta gri / koyu gri
    meshGrey: std({
      map: T.weldedMeshTexture(),
      color: 0x8a8d90,
      transparent: true,
      depthWrite: false,
      side: DS,
      roughness: 0.5,
      metalness: 0.3,
    }),
    frameGrey: std({ color: 0x55585b, roughness: 0.5, metalness: 0.4 }),
    // Saha çiti (4 m tel): alfa testi yerine saydamlık — ince teller alfa testli dokuda 20 m ötede mip ortalamasıyla
    // eşiğin altına düşüp hiç görünmüyordu (critic V5: "yalnız dikmeler"); uzakta gerçekteki gibi hafif tül
    pitchMesh: std({
      map: T.meshFenceTexture(),
      transparent: true,
      depthWrite: false,
      side: DS,
      roughness: 0.5,
      metalness: 0.2,
    }),
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
      // v8 (gün ışığı kalibrasyonu): fazla doygun / sarı. Ölçüm gölge #1e3121 (oyun #2f4411), güneş #566e3e (oyun
      // #495c1f) → doğrusal oranların geometrik ortası ×(0.8, 0.88, 3.0); mavi ×3 yeni (soğuk) gölge tonuyla camgöbeği
      // çıktı (render w5-cmp3) → mavi ×1.8
      return std({ map, color: HEDGE_FIX, roughness: 0.92, side: DS });
    })(),
    // Leylandi tepesi (düz üst + filiz tutamları): taze sürgünler gövdeden açık sarı-yeşil. Street View güneşli saçak
    // #799640, gövde #435c1d (critic M2 #14); oyunda tepe zaten güneşi dik aldığından çarpan ölçülen oranın altında.
    // KARAR: doğrusal ×(1.55, 1.45, 1.1) — sarıya kayma fotoğraftaki oran yönünde, büyüklüğü ışık farkı yüzünden kısık
    mkHedgeTop: (() => {
      const map = T.leylandiiTexture();
      map.anisotropy = 8;
      return std({
        map,
        color: new THREE.Color().setRGB(1.55 * HEDGE_FIX.r, 1.45 * HEDGE_FIX.g, 1.1 * HEDGE_FIX.b),
        roughness: 0.9,
        side: DS,
      });
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
    // Kılavuz karo 40 cm (yer fotoğrafları): şerit yerel UV'si (metre) ile döşenir
    tactile: (() => {
      if (typeof document === 'undefined') return std({ color: 0xcf9f3c });
      const t = tactileTextures();
      return std({
        map: t.map,
        normalMap: t.normalMap,
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 0.72,
        polygonOffset: true,
        polygonOffsetFactor: -7,
        polygonOffsetUnits: -7,
      });
    })(),
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
    curb: std({ color: 0xaeaca6, roughness: 0.85 }),
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
    deckSide: std({ map: T.travertineTexture(), roughness: 0.7, color: 0xd8c0a0 }),
    coping: std({ color: 0xf1efe9, roughness: 0.5 }),
    poolTile: std({ map: T.mosaicTexture('#6fc3dc', '#5ab2cf'), roughness: 0.3 }),
    poolBand: std({ map: T.mosaicTexture('#1f5f8c', '#184f78'), roughness: 0.3 }),
    water: waterMaterial(),
    steel: std({ color: 0xd6d9dc, roughness: 0.2, metalness: 0.9 }),
    lounger: std({ color: 0xf3f3f0, roughness: 0.45 }),
    umbrella: std({ color: 0xf2eee4, roughness: 0.8, side: DS }),
    darkMetal: std({ color: 0x2a2c2e, roughness: 0.5, metalness: 0.6 }),
    // v7: örneklenen sokak eşyası (streetFurniture.ts): beyaz taban × örnek rengi (InstancedMesh.setColorAt)
    instPaint: std({ color: 0xffffff, roughness: 0.55 }),
    instFabric: std({ color: 0xffffff, roughness: 0.9, side: DS }),
    instMetal: std({ color: 0xffffff, roughness: 0.35, metalness: 0.7, side: DS }),
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
    signBikeEnd: std({ map: T.roadSignTexture('bikeEnd'), alphaTest: 0.5, roughness: 0.4 }),
    signBikeEndBack: std({
      map: T.roadSignTexture('bikeEnd'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    signNoTruck: std({ map: T.roadSignTexture('notruck'), alphaTest: 0.5, roughness: 0.4 }),
    signNoTruckBack: std({
      map: T.roadSignTexture('notruck'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    signArrowPlate: std({ map: T.roadSignTexture('arrowPlate'), alphaTest: 0.5, roughness: 0.4 }),
    signArrowPlateBack: std({
      map: T.roadSignTexture('arrowPlate'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    signNoParking: std({ map: T.roadSignTexture('noparking'), alphaTest: 0.5, roughness: 0.4 }),
    signNoParkingBack: std({
      map: T.roadSignTexture('noparking'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    signNoStopping: std({ map: T.roadSignTexture('nostopping'), alphaTest: 0.5, roughness: 0.4 }),
    signNoStoppingBack: std({
      map: T.roadSignTexture('nostopping'),
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
    signStop: std({ map: T.roadSignTexture('stop'), alphaTest: 0.5, roughness: 0.4 }),
    signStopBack: std({
      map: T.roadSignTexture('stop'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    // Özlüce kavşağı (street-plan da3-*): ada başı levhaları, trafik ışığı mercekleri, reklam panosu yüzü
    signKeepRight: std({ map: streetSignTexture('keepRight'), alphaTest: 0.5, roughness: 0.4 }),
    signKeepRightBack: std({
      map: streetSignTexture('keepRight'),
      color: 0x000000,
      emissive: 0x7d8286,
      alphaTest: 0.5,
    }),
    signChevron: std({ map: streetSignTexture('chevron'), roughness: 0.4 }),
    signChevronBack: std({ color: 0x7d8286, roughness: 0.5 }),
    signPedestrian: std({ map: streetSignTexture('pedestrian'), roughness: 0.4 }),
    signPedestrianBack: std({ color: 0x7d8286, roughness: 0.5 }),
    signBusStop: std({ map: streetSignTexture('busStop'), roughness: 0.4 }),
    signBusStopBack: std({ color: 0x7d8286, roughness: 0.5 }),
    // v8: yola boyalı trafik ışığı piktogramı (road-symbol): yol çizgilerinin üstünde
    roadSignalPicto: std({
      map: streetSignTexture('signalPicto'),
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -9,
      polygonOffsetUnits: -9,
    }),
    // KARAR: sinyal mercekleri sönük renkli cam — hangi ışığın yandığı anlık, hiçbiri yanık çizilmez
    sigRed: std({ color: 0x6e1410, emissive: 0xff2a1a, emissiveIntensity: 0.18, roughness: 0.2 }),
    sigAmber: std({ color: 0x6e4a0c, emissive: 0xffa21a, emissiveIntensity: 0.18, roughness: 0.2 }),
    sigGreen: std({ color: 0x0c5a3c, emissive: 0x1ae08c, emissiveIntensity: 0.18, roughness: 0.2 }),
    // KARAR: pano içeriği değişken / ölçülmedi → nötr kırık beyaz yüz (reklam içeriği uydurulmaz)
    billboardFace: std({ color: 0xdcdad4, roughness: 0.75 }),
    signBikeFlat: std({
      map: T.roadSignTexture('bike'),
      alphaTest: 0.5,
      roughness: 0.8,
      polygonOffset: true,
      polygonOffsetFactor: -9,
      polygonOffsetUnits: -9,
    }),
    gateGrey: std({ color: 0x8e9194, roughness: 0.45, metalness: 0.5 }),
    // v7: uzakta sönümlenen derz (kesikli çizgi titreşimi olmasın)
    mkGroove: grooveMaterial(0x55544f),
    mkNet: std({ map: T.meshFenceTexture(), color: 0x202020, alphaTest: 0.3, side: DS, roughness: 0.9 }),
    // Kepenk: 5 cm lamelli (eski doku metrede bir çizgiyle düz beyaz kutu gibi görünüyordu)
    mkShutter: std({
      map: T.rollerShutterTexture(),
      color: 0xc9cccc,
      roughness: 0.55,
      metalness: 0.3,
      side: DS,
    }),
    barrierOrange: std({ color: 0xe06a1e, roughness: 0.5 }),
    barrierWhite: std({ color: 0xeeeeea, roughness: 0.5 }),
    barrierRed: std({ color: 0xc41c22, roughness: 0.5 }),
    boothFrame: std({ color: 0x4a423c, roughness: 0.6, metalness: 0.3 }),
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
        { o: s.a, t, n: s.n },
      );
      if (tactile && W > 1.2) {
        // 40 cm sarı kılavuz karo, kaldırımın ortasında
        const v0 = W * 0.5 - 0.2;
        const P = (u: number, v: number): V2 => [
          s.a[0] + t[0] * u + s.n[0] * v,
          s.a[1] + t[1] * u + s.n[1] * v,
        ];
        b.drape('tactile', [P(u0, v0), P(u1, v0), P(u1, v0 + 0.4), P(u0, v0 + 0.4)], [], o.H, 0.176, 1, 3, {
          o: P(0, v0),
          t,
          n: s.n,
        });
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
  /** Grafik kalitesi: Yüksek (ve Ultra) kalitede beton kenarları 1.5 cm pahlı (Düşük/Orta: geometri değişmez) */
  quality?: 'low' | 'medium' | 'high';
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
  // v10: paketlenmiş tabela yazı tipleri (el yazısı `font: "script"`) atlas çizilmeden önce
  await T.loadSignFonts(o.base);
  const group = new THREE.Group();
  group.name = 'mertkent (el modeli)';
  const b = new Builder();
  const extraMats: Record<string, THREE.Material> = {};
  // Yüksek/Ultra: döşeme alnı, parapet, denizlik, harpuşta, bordür kenarları pahlı (1.5 cm)
  const bevel = o.quality === 'high' ? 0.015 : 0;
  // Ölçülen özel renkler (kat kat balkon alını, korkuluk metali, çıkma, tente) ve tabela yüzleri → dinamik malzeme
  const colorKey = (
    kind: CK | 'asphalt' | 'tar' | 'wear1' | 'wear2' | 'wear3' | 'paint' | 'encglass' | 'interior',
    hex: string,
  ): string => {
    const wearL = kind.startsWith('wear') ? Number(kind.slice(4)) : 0;
    const k = `cc_${kind}_${hex.toLowerCase()}`;
    if (!extraMats[k] && kind === 'encglass')
      // v8 kış bahçesi camı (critic d4c #5): saydam; ölçülen görünen ton (yansıma + koyu iç) koyu iç yüzlerle birlikte
      // oluşur → ince renk + düşük opaklık, parlak yüzey
      // v9b: yalnız dışa bakan tek cam katmanı (streetFurniture enclosure) → FrontSide; gök yansıması vitrin çarpanıyla
      extraMats[k] = withGlassEnv(
        new THREE.MeshStandardMaterial({
          color: hex,
          roughness: 0.06,
          metalness: 0,
          transparent: true,
          opacity: 0.38,
          side: THREE.FrontSide,
          depthWrite: false,
        }),
        'shop',
      );
    else if (!extraMats[k] && kind === 'interior')
      // Kış bahçesi / pavyon içi: koyu mat, yalnız ön yüz (içe bakan yüzler dışarıdan görünmez)
      extraMats[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95, metalness: 0 });
    if (!extraMats[k])
      extraMats[k] =
        kind === 'paint'
          ? // v8: bordür boyası (yeşil / beyaz gruplar): düz yol boyası, bordür yüzünün önünde (polygonOffset)
            new THREE.MeshStandardMaterial({
              color: hex,
              roughness: 0.72,
              polygonOffset: true,
              polygonOffsetFactor: -4,
              polygonOffsetUnits: -4,
            })
          : kind.startsWith('clad:')
            ? cladMaterial(kind, hex)
            : kind.startsWith('tiles:')
              ? tilesMaterial(kind, hex)
              : kind.startsWith('cage:')
                ? cageMaterial(kind, hex)
                : kind.startsWith('film:')
                  ? filmMaterial(kind, hex)
                  : kind.startsWith('camglass:')
                    ? camGlassMaterial({ pitch: Number(kind.slice(9)), frame: hex })
                    : kind === 'groove'
                      ? grooveMaterial(hex)
                      : kind === 'neon'
                        ? neonMaterial(hex)
                        : kind === 'blind'
                          ? // Bambu / hasır stor: çıtalı doku × ölçülen renk, iki yüz
                            new THREE.MeshStandardMaterial({
                              map: typeof document === 'undefined' ? null : T.bambooBlindTexture(),
                              color: hex,
                              roughness: 0.85,
                              side: THREE.DoubleSide,
                            })
                          : kind === 'asphalt' || kind === 'tar' || wearL > 0
                            ? // Yol yüzeyi ayrıntısı (yama / çatlak dolgusu / çizgi aşınması): ölçülen ton, asfalt normal dokusu;
                              // aşınma: gürültü alfa (alphaTest; kademe 1/2/3 ≈ %25/50/75 örtü) ile boyayı örten yol tonu
                              new THREE.MeshStandardMaterial({
                                color: hex,
                                roughness: kind === 'tar' ? 0.5 : 0.93,
                                normalMap:
                                  (o.roadMaterial as THREE.MeshStandardMaterial | undefined)?.normalMap ??
                                  null,
                                alphaMap:
                                  wearL > 0 && typeof document !== 'undefined' ? T.paintWearTexture(7) : null,
                                alphaTest: wearL > 0 ? [0, 0.62, 0.5, 0.38][wearL] : 0,
                                polygonOffset: true,
                                polygonOffsetFactor: wearL > 0 ? -9 : kind === 'tar' ? -8 : -6,
                                polygonOffsetUnits: wearL > 0 ? -9 : kind === 'tar' ? -8 : -6,
                              })
                            : kind === 'shutter'
                              ? // Kepenk: ölçülen renkte lamelli alüminyum (beyaz tabanlı lamel dokusu × renk)
                                new THREE.MeshStandardMaterial({
                                  map: T.rollerShutterTexture(),
                                  color: hex,
                                  roughness: 0.55,
                                  metalness: 0.3,
                                  side: THREE.DoubleSide,
                                })
                              : kind === 'metal'
                                ? new THREE.MeshStandardMaterial({
                                    color: hex,
                                    roughness: 0.35,
                                    metalness: 0.6,
                                  })
                                : kind === 'awning'
                                  ? new THREE.MeshStandardMaterial({
                                      color: hex,
                                      roughness: 0.85,
                                      side: THREE.DoubleSide,
                                    })
                                  : kind === 'frame'
                                    ? new THREE.MeshStandardMaterial({
                                        color: hex,
                                        roughness: 0.4,
                                        metalness: 0.1,
                                      })
                                    : kind === 'tint'
                                      ? // Renkli / giydirme / vitrin camı: ölçülen görünen ton + gök yansıması (Fresnel, yalnız
                                        // camda güçlendirilir — önceden opak boya gibi görünüyordu, critic A10)
                                        withGlassEnv(
                                          new THREE.MeshStandardMaterial({
                                            color: new THREE.Color(hex).multiplyScalar(0.8),
                                            roughness: 0.05,
                                            metalness: 0,
                                          }),
                                          'tint',
                                        )
                                      : kind === 'glass'
                                        ? new THREE.MeshStandardMaterial({
                                            // Korkuluk camı: örneklenen görünen renk (yansıma dahil) → düşük yansımalı, çoğunlukla opak
                                            color: hex,
                                            roughness: 0.12,
                                            metalness: 0,
                                            transparent: true,
                                            opacity: 0.86,
                                            side: THREE.DoubleSide,
                                            depthWrite: false,
                                          })
                                        : granularMaterial(hex, kind === 'fascia' ? 7 : 3, {
                                            roughness: 0.9,
                                            side: kind === 'fascia' ? THREE.DoubleSide : THREE.FrontSide,
                                          });
    return k;
  };
  // v7: tabela atlası — tabela başına doku / malzeme yerine sayfa başına tek malzeme (gerçek boy, px/m)
  const atlas = new SignAtlas(
    o.quality === 'low' ? 96 : o.quality === 'medium' ? 128 : 160,
    o.quality === 'low' ? 1024 : 2048,
  );
  const signFace = (sg: SignSpec): string => atlas.face(sg);
  // Ölçülmüş sokak: kaldırım, bordür, sokak eşyası (street-plan.json); varsa eski tahmini kaldırım çizilmez
  const street =
    (STREET_PLAN.sidewalks?.length ?? 0) + (STREET_PLAN.street?.length ?? 0) > 0
      ? buildStreetPlan(b, STREET_PLAN, o.H, roadGapFn(o.simple, true), {
          signFace,
          colorKey,
          collide: o.collide,
          roadEdge: roadGapFn(o.simple),
          bevel,
        })
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
    let holes: [number, number][][] = [];
    if (fac && !NO_SURVEY)
      holes = buildFacadeBlock(b, fac, base, {
        seed: id % 100000,
        collide: o.collide,
        signKey: `blockSign${name}`,
        keys: paletteKeys(fac, id, extraMats),
        colorKey,
        signFace,
        bevel,
      }).holes;
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
    // Zemine inen girinti ağızları (girintili dükkân hattı, kapı yuvası) çarpışma halkasından çıkarılır
    for (const rr of footCollision(
      r.map((p) => [p[0], p[1]]),
      holes,
    ))
      o.collide?.(rr, base - 1, base + 25);
  });
  // Ölçülmüş komşu binalar
  if (!NO_SURVEY)
    for (const id of SURVEYED_EXTRA) {
      const fac = FACADES[id];
      const r = fac.ring.map((p) => [p[0], p[1]] as V2);
      const base = ringBase(r);
      const keys = paletteKeys(fac, id, extraMats);
      const holes: [number, number][][] = [];
      for (const part of splitMassing(fac))
        holes.push(
          ...buildFacadeBlock(b, part, base, {
            seed: part.id % 100000,
            collide: o.collide,
            keys,
            colorKey,
            signFace,
            bevel,
          }).holes,
        );
      for (const rr of footCollision(
        r.map((p) => [p[0], p[1]]),
        holes,
      ))
        // v8 baseH: podyum üstündeki kulenin alt kısmı podyumun içinde (çarpışmayı podyum verir)
        o.collide?.(rr, base - 1 + (fac.baseH ?? 0), base + 40);
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
    const sp = buildSitePlan(b, SITE_PLAN, o.H, o.collide, colorKey, street?.coverPolys);
    holes.push(...sp.holes);
    cars.push(...sp.cars);
  }
  if ((PARK_PLAN.areas?.length ?? 0) + (PARK_PLAN.points?.length ?? 0) > 0) {
    // Ölçülmüş komşu parklar (kuzey park, Nato Parkı)
    const pp = buildSitePlan(b, PARK_PLAN, o.H, o.collide, colorKey, street?.coverPolys);
    holes.push(...pp.holes);
    cars.push(...pp.cars);
  }
  if (STREET_PLAN.areas?.length) {
    // v8: sokak planı zemin alanları (döşeme / çakıl / asfalt — site planı alan şeması, kaldırımlardan kırpılır)
    const sa = buildSitePlan(
      b,
      { areas: STREET_PLAN.areas },
      o.H,
      o.collide,
      colorKey,
      street?.coverPolys,
      true,
    );
    holes.push(...sa.holes);
  }
  // Ölçülmüş park şeritleri (street-plan.json `parking`, D4): geçit / durak / ada / araç girişi önü boş kalır
  const parking = (STREET_PLAN as { parking?: ParkingStrip[] }).parking;
  if (parking?.length && !NO_PARKING)
    cars.push(
      ...parkingCars(
        parking,
        o.H,
        parkingBlockers(
          (STREET_PLAN.street ?? []) as Parameters<typeof parkingBlockers>[0],
          STREET_PLAN.gates ?? [],
        ),
      ),
    );
  // ── Salusvizyon ──
  const salusSite = ringOf(o.simple, SALUS_SITE);
  const salusB = ringOf(o.simple, SALUS_BUILDING);
  if (salusSite && salusB) {
    const salusFac = FACADES[SALUS_BUILDING];
    const salusRingC = (salusFac?.ring.map((p) => [p[0], p[1]] as V2) ?? salusB) as V2[];
    const base = ringBase(salusRingC);
    let salusHoles: [number, number][][] = [];
    if (salusFac && !NO_SURVEY)
      salusHoles = buildFacadeBlock(b, salusFac, base, {
        seed: 4242,
        collide: o.collide,
        keys: paletteKeys(salusFac, SALUS_BUILDING, extraMats),
        colorKey,
        signFace,
        bevel,
      }).holes;
    else
      buildApartment(b, {
        ring: salusB,
        base,
        seed: 4242,
        floors: 7,
        inside: [-78, -178],
        style: SALUS_STYLE,
      });
    for (const rr of footCollision(
      salusRingC.map((p) => [p[0], p[1]]),
      salusHoles,
    ))
      o.collide?.(rr, base - 1, base + 25);
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
    // Salus önü kaldırım: Street View'da (CrRB_240_0) bordür dibinde kırmızı-pembe bant + koyu ayırıcı + gri kilit taşı
    // + sarı-krem kılavuz + gri, toplam ≈2.0–2.3 m (street-plan salus-east notu). Bant genişlikleri ölçülmediği için
    // burada düz gri; sokak planına katmanlı `sidewalks` kaydı girilince o çizer (walkSkip bu şeridi atlar).
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
    // Ölçülmüş kapılar (street-plan) aşağıda ortak kapı çizicisiyle; ölçüm yoksa varsayılan araç kapıları
    if (!SP_GATES.length)
      for (const g of DRIVE_GATES) buildDriveGate(b, g.c, g.n, o.H(g.c[0], g.c[1]), g.w, true);
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
          kind === 'welded'
            ? // 2D kaynaklı tel panel: kalın teller (beyaz doku × ölçülen renk), uzaktan da görünür
              new THREE.MeshStandardMaterial({
                map: T.weldedMeshTexture(),
                color,
                alphaTest: 0.4,
                side: DSd,
                roughness: 0.55,
                metalness: 0.25,
              })
            : kind === 'mesh'
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
                  : kind.startsWith('lattice:')
                    ? latticeMaterial(color, Number(kind.slice(8)) || 0.15)
                    : granularMaterial(
                        color,
                        kind === 'brick' ? 14 : kind === 'stone' ? 15 : 13,
                        { roughness: 0.9 },
                        kind === 'stone' || kind === 'brick' ? { mottle: 0.12, bump: 2.5 } : undefined,
                      );
      }
      return k;
    };
    // Komşu çitler + serbest duvarlar (kind "wall": bir site çitine bağlı olmayan duvar, ör. 504. Sk. kuzey duvarı)
    const others = (STREET_PLAN.fence ?? []).filter(
      (f) => (f.kind === 'other' || f.kind === 'wall') && f.pts?.length >= 2,
    ) as unknown as GenericFence[];
    // Tüm ölçülmüş kapılar (Salusvizyon hariç: salus.ts) — biçim (`style`), renk, kolonlar HER kapıda uygulanır
    const planGates = (STREET_PLAN.gates ?? []).filter(
      (g) => !/^salus/.test((g as { id?: string }).id ?? ''),
    ) as unknown as PlanGate[];
    const gapsO = planGates.map((g) => ({ c: g.c, w: gateGapWidth(g) }));
    // v7: çit tabanı ölçülmüş yürüme yüzeyinde (bordürsüz sokakta yol kotu; önceden her yerde +0.15)
    for (const f of others) buildGenericFence(b, f, o.H, mat, gapsO, o.collide, bevel, street?.surfaceAt);
    for (const g of planGates)
      buildPlanGate(b, g, o.H(g.c[0], g.c[1]), {
        near: planGates
          .filter((q) => q !== g && Math.hypot(q.c[0] - g.c[0], q.c[1] - g.c[1]) < 15)
          .sort(
            (p, q) =>
              Math.hypot(p.c[0] - g.c[0], p.c[1] - g.c[1]) - Math.hypot(q.c[0] - g.c[0], q.c[1] - g.c[1]),
          )[0]?.c,
        mat,
        colorKey: (k, h) => colorKey(k, h),
        signFace,
        collide: o.collide,
        wrought: buildWroughtGate,
      });
  }
  // Park Koza Sitesi girişi (502. Sk doğu yakası, güney uç; Street View l4zd… kuzey karesi)
  buildParkKoza(b, [11.2, -37.4], [0, 1], o.H(11.2, -37.4) + 0.05, o.collide);
  if (!SP_GATES.length) for (const g of GATES) buildGate(b, g.c, g.n, o.H(g.c[0], g.c[1]));
  // Kuzey kapı önü: tehlikeli viraj + 30 levhası (Street View kuzey kapı karesi), doğuya giden şeride bakar
  if (!street) signPole(b, [-31.3, -145.8], [-0.95, -0.31], o.H(-31.3, -145.8), ['signCurve', 'sign30']);
  const mats = materials(o.base);
  // Kaldırım başına kılavuz karo tonu (street.ts tactileKey: `tactile@r,g,b`, sRGB oran çarpanı)
  for (const k of b.keys()) if (k.startsWith('tactile@')) addTactileVariant(mats, k);
  // Ölçülen tonlu çim (site/park-plan lawn `color`, ör. kuru çim #baa382): çim dokusu × tona göre çarpan
  for (const k of b.keys())
    if (k.startsWith('lawn@') && !mats[k] && mats.lawn) {
      const m = (mats.lawn as THREE.MeshStandardMaterial).clone();
      // Çarpan = ölçülen ton / gerçek doku ortalaması (doğrusal; siteplan.ts lawnTint)
      m.color.copy(lawnTint(k.slice(5)));
      mats[k] = m;
    }
  // Ölçülen tonlu çit (park/site-plan hedge çizgisi `color`): çit gövdesi + yaprak saçağı × tona göre çarpan
  for (const k of b.keys()) {
    const leaf = k.startsWith('hedgeLeaf@');
    const src = leaf ? mats.hedgeLeaf : k.startsWith('hedge@') ? mats.hedge : null;
    if (!src || mats[k]) continue;
    const m = (src as THREE.MeshStandardMaterial).clone();
    m.color.copy(hedgeTint(k.slice(k.indexOf('@') + 1), leaf));
    mats[k] = m;
  }
  // v9: ölçülen tonlu çakıl (sokak / site alanı `color`): düz çakıl malzemesi o tonda
  for (const k of b.keys())
    if (k.startsWith('spGravel@') && !mats[k] && mats.spGravel) {
      const m = (mats.spGravel as THREE.MeshStandardMaterial).clone();
      m.color.set(k.slice(9));
      mats[k] = m;
    }
  upgradeRealMaterials(mats, o.base);
  extraMats.roadFill = o.roadMaterial ?? mats.drive;
  atlas.finalize(b, extraMats);
  b.build({ ...mats, ...extraMats }, group, o.shadows);
  // Özhan önünde (vitrin, otopark) ağaç yok
  if (oz) {
    const nt = noTree;
    noTree = (x, z) => (nt ? nt(x, z) : false) || insidePoly(oz, x, z) || distToRing(oz, x, z) < 7;
  }
  const salusRing = ringOf(o.simple, SALUS_SITE);
  // KARAR: ölçülmüş bölgede (street-plan) Street View'dan tahmin edilmiş çit kabukları çizilmez. Kutu yalnız Mertkent
  // çevresini kapsıyordu (x < 28); DA boyunca eski çalı kabukları ölçülmüş duvarın ~1.3 m önünde kalıyordu (critic
  // A2) → ölçülmüş çit hattına 2.5 m'den yakın ya da ölçülmüş kaldırım bandının (bordürden w + 2 m) içindeki eski
  // kabuk parçası da atlanır.
  const measuredLines = planLines(STREET_PLAN as StreetPlan);
  const fenceSkip = (x: number, z: number) =>
    (x > -142 && x < 28 && z > -222 && z < 4) ||
    nearSite(x, z) ||
    (!!salusRing && (insidePoly(salusRing, x, z) || distToRing(salusRing, x, z) < 8)) ||
    nearPlanLine(measuredLines, x, z);
  return { group, fenceSkip, noTree, cars, raised: street?.raised ?? [] };
}
