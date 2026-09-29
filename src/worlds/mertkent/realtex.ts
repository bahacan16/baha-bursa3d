import * as THREE from 'three';
import { loadSettings } from '../../core/settings';

/**
 * GERÇEK ZEMİN MALZEMELERİ — bu sokaktan ölçülmüş dokular (`scripts/real-textures.mjs` → `public/textures/real/`).
 *
 * Ölçüler (kullanıcı fotoğrafı 502sk-bati-bisiklet.jpg metrik üst görünüşe düzeltilerek; Street View 2019/2025):
 *  - Gri / kırmızı kilit taşı: modül 200 × 100 mm (ölçülen en-boy 1.97), uzun kenar yol boyunca, yarım şaşırtmalı;
 *    derz ≈3 mm kum, taş kenarında ≈5 mm 45° pah (koyu bant ≈13 mm). Taşlar arası ton CV 0.07 (kuru Street View
 *    blok ölçümü 0.077–0.101, derz payı dahil üst sınır).
 *  - Sarı kılavuz karo: 400 × 400 mm, 6 boyuna çubuk (adım 64, üst 25, taban 32, yükseklik ≈5 mm, yuvarlak uçlu).
 *  - Bordür: beton, birim ≈0.72 m (geometri street.ts'de), üç düzlemli dünya dokusu (kutu UV'si her birimde sıfırdan
 *    başladığından her birim aynı görünürdü).
 *  - Site içi I (kemik) taşı: 200 × 139 mm adım, uçlar 165 mm (uzun kenarlarda bel), sıralar yarım kaydırmalı.
 * Renk: aynı Street View karesinde gri taşa oranlar (betik `measure` çıktısı); albedo dokuda → malzeme rengi beyaz.
 *
 * rh dokusu: R = yükseklik, G = pürüzlülük (three roughnessMap G okur), B = mikro örtünme (yalnız dolaylı ışık).
 * Yüksek kalitede 2k, diğerlerinde 1k dokular. Ultra: paralaks örtünme (derzler sığ açıda gerçek derinlikte).
 * `?norealtex` kapatır (karşılaştırma).
 */

export interface RealSpec {
  /** public/textures/real/<dir>/ */
  dir: string;
  /** Bir dokunun kapladığı alan (m): u, v */
  size: [number, number];
  /** Kutu kenar taşları: dünya uzayı üç düzlemli örnekleme (UV kullanılmaz) */
  triplanar?: boolean;
  normalScale?: number;
  /** Ultra paralaks derinliği (m) — manifest heightRangeMM aralığı (rh.R 0..1 bu derinliğe karşılık gelir) */
  pom?: number;
  /** Albedo çarpanı (doğrusal) — aynı dokuyu başka renkte ölçülmüş taşa uyarlamak için */
  tint?: [number, number, number];
}

/** Doku ortalaması (doğrusal) — tint hesapları için (betik çıktısındaki meanAlbedo ile aynı) */
const KERB_MEAN: [number, number, number] = [0.359, 0.342, 0.304];
const lin = (hex: number): [number, number, number] => {
  const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
};
const ratio = (hex: number): [number, number, number] => {
  const c = lin(hex);
  return [c[0] / KERB_MEAN[0], c[1] / KERB_MEAN[1], c[2] / KERB_MEAN[2]];
};

/** Malzeme anahtarı → gerçek doku (boyutlar betikteki modüllerin tam katı; manifest.json ile birim testte eşleşir) */
export const REAL_SPECS: Record<string, RealSpec> = {
  spPaverGrey: { dir: 'paver-grey', size: [2, 2], pom: 0.009 },
  spPaverRed: { dir: 'paver-red', size: [2, 2], pom: 0.009 },
  tactile: { dir: 'tactile', size: [1.6, 0.4], pom: 0.009 },
  spSiteGrey: { dir: 'bone-grey', size: [2, 1.946], pom: 0.009 },
  spSiteRed: { dir: 'bone-red', size: [2, 1.946], pom: 0.009 },
  curb: { dir: 'kerb', size: [0.5, 0.5], triplanar: true },
  // Site içi bordür (kullanıcı fotoğrafları, #8c8984) ve krem kenar taşı (ölçüm notu, #cfcbc2): aynı beton tanesi
  siteKerb: { dir: 'kerb', size: [0.5, 0.5], triplanar: true, tint: ratio(0x8c8984) },
  edging: { dir: 'kerb', size: [0.5, 0.5], triplanar: true, tint: ratio(0xcfcbc2) },
  // 502. Sk. batı: bisiklet şeridi bordürünün yol yüzü + üstünün dış yarısı beyaz boyalı (kullanıcı fotoğrafı, SV)
  kerbPaint: { dir: 'kerb-paint', size: [0.5, 0.5], triplanar: true },
};

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

function tex(url: string, srgb: boolean, rep: [number, number]): THREE.Texture {
  const key = `${url}|${rep.join(',')}`;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(url, undefined, undefined, () => console.warn(`gerçek doku yüklenemedi: ${url}`));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    // three en yüksek desteklenen değere kırpar (renderer.capabilities.getMaxAnisotropy)
    t.anisotropy = 16;
    t.repeat.set(rep[0], rep[1]);
    cache.set(key, t);
  }
  return t;
}

/** Paralaks örtünme (Ultra): yükseklik rh.R, görüş ışını teğet uzayında ekran türevlerinden */
const POM_PARS = /* glsl */ `
uniform float rtPomDepth;
vec2 rtPomUv( vec2 uv ) {
  vec3 p = - vViewPosition;
  vec3 dpx = dFdx( p );
  vec3 dpy = dFdy( p );
  vec2 dux = dFdx( uv );
  vec2 duy = dFdy( uv );
  float det = dux.x * duy.y - duy.x * dux.y;
  if ( abs( det ) < 1e-12 ) return uv;
  vec3 T = ( dpx * duy.y - dpy * dux.y ) / det;
  vec3 B = ( dpy * dux.x - dpx * duy.x ) / det;
  vec3 N = normalize( vNormal );
  vec3 V = normalize( vViewPosition );
  float vn = max( dot( V, N ), 0.18 );
  // Derinlik (m) başına doku kayması: ışın yüzeyin altına δ inince yatay yer değiştirme
  vec3 dp = ( - V + vn * N ) / vn;
  vec2 perDepth = vec2( dot( dp, T ) / dot( T, T ), dot( dp, B ) / dot( B, B ) );
  float n = floor( mix( 28.0, 8.0, vn ) );
  float dh = 1.0 / n;
  vec2 dUv = perDepth * rtPomDepth * dh;
  vec2 cur = uv;
  float layer = 1.0;
  float h = textureGrad( roughnessMap, cur, dux, duy ).r;
  for ( int i = 0; i < 32; i ++ ) {
    if ( float( i ) >= n || layer <= h ) break;
    cur += dUv;
    layer -= dh;
    h = textureGrad( roughnessMap, cur, dux, duy ).r;
  }
  vec2 prev = cur - dUv;
  float hp = textureGrad( roughnessMap, prev, dux, duy ).r;
  float a = h - layer;
  float b = hp - ( layer + dh );
  float w = ( a - b ) != 0.0 ? a / ( a - b ) : 0.0;
  return mix( cur, prev, clamp( w, 0.0, 1.0 ) );
}
`;

/** Üç düzlemli örnekleme (dünya metre → doku), ağırlık |n|^4 */
const TRI_PARS = /* glsl */ `
varying vec3 vRtWPos;
varying vec3 vRtWNrm;
uniform vec2 rtTriRep;
uniform vec3 rtTint;
vec4 rtTri( sampler2D s, vec3 w, vec3 p ) {
  return texture2D( s, p.zy * rtTriRep ) * w.x + texture2D( s, p.xz * rtTriRep ) * w.y + texture2D( s, p.xy * rtTriRep ) * w.z;
}
`;

function chainCompile(
  m: THREE.MeshStandardMaterial,
  key: string,
  fn: (sh: THREE.WebGLProgramParametersWithUniforms) => void,
): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    fn(sh);
  };
  m.customProgramCacheKey = () => `${prevKey()}|${key}`;
}

function upgradeUv(
  m: THREE.MeshStandardMaterial,
  spec: RealSpec,
  base: string,
  res: string,
  ultra: boolean,
): void {
  const rep: [number, number] = [1 / spec.size[0], 1 / spec.size[1]];
  const url = (n: string) => `${base}textures/real/${spec.dir}/${n}${res}.jpg`;
  m.map = tex(url('albedo'), true, rep);
  m.normalMap = tex(url('normal'), false, rep);
  m.roughnessMap = tex(url('rh'), false, rep);
  m.normalScale.setScalar(spec.normalScale ?? 1);
  m.color.setRGB(spec.tint?.[0] ?? 1, spec.tint?.[1] ?? 1, spec.tint?.[2] ?? 1);
  m.roughness = 1;
  m.metalness = 0;
  const pom = ultra && spec.pom ? spec.pom : 0;
  chainCompile(m, `rt-uv-${pom ? 'pom' : 'flat'}`, (sh) => {
    let pre = '';
    let head = '';
    if (pom) {
      sh.uniforms.rtPomDepth = { value: pom };
      pre = POM_PARS;
      // Tüm haritalar aynı dönüşümü paylaşır (aynı repeat) → tek paralakslı UV
      head = `
  vec2 rtUv = rtPomUv( vMapUv );
  #define vMapUv rtUv
  #define vNormalMapUv rtUv
  #define vRoughnessMapUv rtUv
`;
    }
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `${pre}\nvoid main() {${head}`).replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
  {
    // Mikro örtünme (rh.B): dar derz / oluk dibi gökyüzünü az görür — yalnız dolaylı ışık
    float rtAo = texture2D( roughnessMap, vRoughnessMapUv ).b;
    reflectedLight.indirectDiffuse *= rtAo;
    reflectedLight.indirectSpecular *= rtAo;
  }`,
    );
  });
  m.needsUpdate = true;
}

function upgradeTri(m: THREE.MeshStandardMaterial, spec: RealSpec, base: string, res: string): void {
  const url = (n: string) => `${base}textures/real/${spec.dir}/${n}${res}.jpg`;
  // Dünya uzayında örneklenir: doku tekrar dönüşümü kullanılmaz (repeat 1), ölçek rtTriRep ile
  m.map = tex(url('albedo'), true, [1, 1]);
  m.roughnessMap = tex(url('rh'), false, [1, 1]);
  m.normalMap = null;
  m.color.set(0xffffff);
  m.roughness = 1;
  m.metalness = 0;
  const tint = spec.tint ?? [1, 1, 1];
  chainCompile(m, 'rt-tri', (sh) => {
    sh.uniforms.rtTriRep = { value: new THREE.Vector2(1 / spec.size[0], 1 / spec.size[1]) };
    sh.uniforms.rtTint = { value: new THREE.Vector3(...tint) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRtWPos;\nvarying vec3 vRtWNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vRtWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vRtWNrm = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${TRI_PARS}\nvoid main() {`)
      .replace(
        '#include <map_fragment>',
        `vec3 rtW = pow( abs( normalize( vRtWNrm ) ), vec3( 4.0 ) );
  rtW /= ( rtW.x + rtW.y + rtW.z );
  diffuseColor.rgb *= rtTri( map, rtW, vRtWPos ).rgb * rtTint;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = roughness * rtTri( roughnessMap, rtW, vRtWPos ).g;',
      );
  });
  m.needsUpdate = true;
}

/**
 * Mevcut malzemeleri anahtar adıyla gerçek dokulara yükselt (yerinde). Eksik `kerbPaint` eklenir.
 * Worker/test ortamında (DOM yok) dokunulmaz.
 */
export function upgradeRealMaterials(mats: Record<string, THREE.Material>, base: string): void {
  // Boyalı bordür (street.ts kerbPaint) her durumda gerekir — doku yoksa düz yol boyası rengi
  if (!mats.kerbPaint)
    mats.kerbPaint = new THREE.MeshStandardMaterial({
      color: 0xeeeeea,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  if (typeof document === 'undefined') return;
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('norealtex')) return;
  const s = loadSettings();
  // KARAR: Düşük kalitede (mobil) eski yordamsal dokular kalır — ~18 ek doku mobil GPU belleği için ağır
  if (s.quality === 'low') return;
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const res = s.quality === 'high' ? '' : '-1k';
  // Paralaks yalnız Ultra'da; `?pom=1` karşılaştırma için Yüksek kalitede de açar
  const ultra = !!s.ultra || q.get('pom') === '1';
  for (const [key, spec] of Object.entries(REAL_SPECS)) {
    const m = mats[key] as THREE.MeshStandardMaterial | undefined;
    if (!m?.isMeshStandardMaterial) continue;
    if (spec.triplanar) upgradeTri(m, spec, base, res);
    else upgradeUv(m, spec, base, res, ultra);
    m.userData.realTex = spec.dir;
  }
}
