import * as THREE from 'three';
import { nightUniform } from '../../env/night';
import { registerReflective, ultraWeather } from '../../env/ultra';

/**
 * Ölçülmüş Mertkent cepheleri için malzemeler (Street View yakın plan karelerine göre):
 * - Grenli (serpme) sıva: 2–4 mm taneler, hafif lekelenme; açık sıcak gri. Şerit ve balkon alnı da aynı sıva,
 *   farklı renk (turuncu / koyu gri).
 * - Pencere camı: gökyüzü yansıması (Fresnel) + arkada oda: tül, yan perde, stor, dikey jaluzi, zebra perde,
 *   karanlık oda; pencere başına tohumla seçilir (aux özniteliği: [tohum, tür, en, boy]).
 * - Cam balkon: çerçevesiz katlanır cam, ~0.7 m'de ince derz, arkada balkon/perde.
 */

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const hasDom = typeof document !== 'undefined';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Tekrarlı değer gürültüsü (N×N ızgara, bilineer, periyodik) */
function valueNoise(N: number, cells: number, r: () => number): Float32Array {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells;
      const fy = (y / N) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const G = (i: number, j: number) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
      const a = G(x0, y0) * (1 - sx) + G(x0 + 1, y0) * sx;
      const b = G(x0, y0 + 1) * (1 - sx) + G(x0 + 1, y0 + 1) * sx;
      out[y * N + x] = a * (1 - sy) + b * sy;
    }
  return out;
}

const granCache = new Map<string, { map: THREE.Texture; normalMap: THREE.Texture }>();

/**
 * Grenli sıva: renk + normal dokusu. 1 doku = 1 m (512 px → 2 mm/px). Taneler 1–3 px yarıçaplı tümsek,
 * aralarında ince gürültü; renk ±%3 benek + ~25 cm'lik ±%4 lekelenme.
 */
export function granularTextures(
  base: string,
  seed = 1,
  opts: { mottle?: number; speck?: number; bump?: number } = {},
): { map: THREE.Texture; normalMap: THREE.Texture } {
  const key = `${base}|${seed}|${opts.mottle}|${opts.speck}|${opts.bump}`;
  const hit = granCache.get(key);
  if (hit) return hit;
  const N = 512;
  const r = rng(seed * 7919 + 17);
  const hgt = new Float32Array(N * N);
  // Taneler
  const grains = N * N * 0.06;
  for (let k = 0; k < grains; k++) {
    const cx = r() * N;
    const cy = r() * N;
    const rad = 0.8 + r() * r() * 2.4;
    const amp = 0.5 + r() * 0.8;
    const R = Math.ceil(rad);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d2 = (dx * dx + dy * dy) / (rad * rad);
        if (d2 >= 1) continue;
        const x = (Math.floor(cx) + dx + N) % N;
        const y = (Math.floor(cy) + dy + N) % N;
        const v = amp * Math.sqrt(1 - d2);
        if (v > hgt[y * N + x]) hgt[y * N + x] = v;
      }
  }
  for (let i = 0; i < hgt.length; i++) hgt[i] += (r() - 0.5) * 0.25;
  const mottle = valueNoise(N, 4, r);
  const mottle2 = valueNoise(N, 16, r);
  const [c, g] = canvas(N, N);
  const [nc, ng] = canvas(N, N);
  const img = g.createImageData(N, N);
  const nimg = ng.createImageData(N, N);
  const [br, bg, bb] = hexRgb(base);
  // Eleştirmen: gerçek sıva düzgün ince gren; metre ölçekli bulut lekeleri yok (0.05 → 0.018)
  const mA = opts.mottle ?? 0.018;
  const sA = opts.speck ?? 0.05;
  const bump = opts.bump ?? 1.6;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const h = hgt[i];
      const hx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x - 1 + N) % N)];
      const hy = hgt[((y + 1) % N) * N + x] - hgt[((y - 1 + N) % N) * N + x];
      // Tümsek tepeleri biraz açık, dipler koyu (kir birikir) + lekelenme
      const f =
        1 +
        (h - 0.45) * sA * 1.6 +
        (mottle[i] - 0.5) * mA * 1.6 +
        (mottle2[i] - 0.5) * mA * 0.6 +
        (r() - 0.5) * sA * 0.5;
      img.data[i * 4] = Math.max(0, Math.min(255, br * f));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, bg * f));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, bb * f * 0.995));
      img.data[i * 4 + 3] = 255;
      let nx = -hx * bump;
      let ny = hy * bump;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      nimg.data[i * 4] = (nx * 0.5 + 0.5) * 255;
      nimg.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      nimg.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      nimg.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  ng.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 8;
  const out = { map, normalMap };
  granCache.set(key, out);
  return out;
}

/** Grenli sıva malzemesi (dünya UV = metre); DOM yoksa (birim test) düz renk */
export function granularMaterial(
  base: string,
  seed: number,
  p: THREE.MeshStandardMaterialParameters = {},
  opts: { mottle?: number; speck?: number; bump?: number } = {},
): THREE.MeshStandardMaterial {
  if (!hasDom) return new THREE.MeshStandardMaterial({ color: base, roughness: 0.95, ...p });
  const t = granularTextures(base, seed, opts);
  const m = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.95,
    ...p,
  });
  // Ultra: zemine yakın sıçrama kiri + hafif düşey yağmur izi (env/ultra.ts)
  ultraWeather(m);
  return m;
}

/**
 * Pencere camı: uv 0..1 cam bölmesi (u yatay, v yukarı), aux = [tohum, tür, en, boy].
 * tür: 0 tül, 1 tül + yan perde, 2 stor (yarı inik), 3 dikey jaluzi, 4 karanlık oda, 5 zebra perde, 6 açık kanat.
 * Oda rengi gündüz loş, gece sıcak ışık (uNight × pencere başı olasılık).
 */
export function windowGlassMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.04,
    metalness: 0.0,
    envMapIntensity: 2.3,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aux;\nflat varying vec4 vAux;\nvarying vec2 vWUv;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aux;\nvWUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
flat varying vec4 vAux;
varying vec2 vWUv;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// cc: ölçülmüş perde rengi (doğrusal; x < 0 → yok), cf: kapanma oranı (< 0 → varsayılan)
vec3 roomColor(float seed, float kind, vec2 uv, float W, float Hh, vec3 cc, float cf) {
  // Oda derinliği hissi: üstte tavan açık, altta koyu, kenarlarda koyulaşma
  // Street View: cam mavi-gri (gökyüzü/karşı cephe yansıması), iç mekân sıcak kahve değil
  vec3 room = mix(vec3(0.03, 0.034, 0.042), vec3(0.09, 0.1, 0.115), smoothstep(0.1, 0.95, uv.y));
  room *= 0.75 + 0.25 * h1(seed * 3.1);
  float x = uv.x * W;
  float y = uv.y * Hh;
  vec3 col = room;
  if (kind < 0.5 || (kind > 0.5 && kind < 1.5)) {
    // Tül: beyazımsı, dikey kıvrımlar, hafif saydam
    // Tül: yumuşak, düşük kontrastlı kıvrımlar; camın arkasında olduğu için gri-mavimsi ve loş
    float fold = 0.5 + 0.5 * sin(x * 26.0 + sin(x * 4.0 + seed) * 2.0);
    vec3 tul = vec3(0.46, 0.475, 0.49) * (0.94 + 0.06 * fold) * (0.9 + 0.12 * uv.y);
    // Ölçülmüş renkli tül (yalnız tül türünde; tul-yan'da renk yan perdenin)
    if (cc.x >= 0.0 && kind < 0.5) tul = cc * (0.9 + 0.1 * fold);
    col = mix(room, tul, 0.8);
    if (kind > 0.5) {
      // Yan perdeler (fon perde, iki yanda ~%12–16, camın arkasında loş; kırmızı fon seyrek)
      float sw0 = cf >= 0.0 ? cf * 0.5 : 0.12 + 0.04 * h1(seed);
      float sw1 = cf >= 0.0 ? cf * 0.5 : 0.12 + 0.04 * h1(seed + 1.0);
      float side = step(uv.x, sw0) + step(1.0 - sw1, uv.x);
      // Eleştirmen: gerçekte çoğunlukla beyaz tül; yan perde krem-bej, düşük kontrast (kahverengi kareler yok)
      vec3 drape = cc.x >= 0.0 ? cc : mix(vec3(0.44, 0.42, 0.38), vec3(0.54, 0.52, 0.48), h1(seed * 5.3));
      float df = 0.75 + 0.25 * sin(x * 22.0);
      col = mix(col, drape * df, min(side, 1.0));
    }
  } else if (kind < 2.5) {
    // Stor: bej/beyaz, yukarıdan belli bir yüksekliğe inik
    float drop = cf >= 0.0 ? cf : 0.35 + 0.6 * h1(seed * 2.7);
    vec3 st = cc.x >= 0.0 ? cc : mix(vec3(0.72, 0.68, 0.6), vec3(0.85, 0.84, 0.8), h1(seed * 4.4));
    col = uv.y > 1.0 - drop ? st * (0.92 + 0.08 * step(0.5, fract(y * 12.0))) : mix(room, vec3(0.7, 0.69, 0.66), 0.55);
  } else if (kind < 3.5) {
    // Dikey jaluzi (beyaz lameller)
    float sl = 0.55 + 0.45 * smoothstep(0.0, 0.5, abs(fract(x * 11.0) - 0.5));
    col = (cc.x >= 0.0 ? cc : vec3(0.78, 0.78, 0.76)) * sl;
  } else if (kind < 4.5) {
    col = room * 0.8;
  } else if (kind < 5.5) {
    // Zebra perde: yatay bantlar (yarı saydam / opak)
    float band = step(0.5, fract(y * 5.5 + h1(seed) ));
    vec3 zc = cc.x >= 0.0 ? cc : vec3(0.83, 0.82, 0.78);
    col = mix(mix(room, zc * 0.96, 0.55), zc, band);
  } else if (kind < 6.5) {
    col = room * 0.6;
  } else if (kind > 7.5) {
    // Fon perde (kalın): iki yandan kapanır (cf, varsayılan tamamen kapalı), dikey kıvrımlı; arada loş oda + tül
    float f = cf >= 0.0 ? cf : 1.0;
    vec3 dc = cc.x >= 0.0 ? cc : vec3(0.5, 0.47, 0.42);
    float side = step(uv.x, f * 0.5) + step(1.0 - f * 0.5, uv.x);
    float fold = 0.5 + 0.5 * sin(x * 24.0 + sin(x * 3.3 + seed) * 1.6);
    vec3 tul = vec3(0.46, 0.475, 0.49);
    col = mix(mix(room, tul, 0.7), dc * (0.72 + 0.28 * fold), min(side, 1.0));
  } else {
    // Vitrin: derin, loş dükkân içi — tavanda spot sırası, alt yarıda raf/tezgâh siluetleri (gündüz cam koyu görünür)
    vec3 shop = mix(vec3(0.035, 0.037, 0.04), vec3(0.075, 0.075, 0.07), smoothstep(0.0, 1.0, uv.y));
    float spot = step(0.9, uv.y) * step(0.7, fract(x * 0.8 + h1(seed)));
    float shelf = step(uv.y, 0.45) * step(0.35, fract(x * 0.45 + h1(seed * 2.0))) * (0.6 + 0.4 * step(0.5, fract(y * 3.3)));
    // Koyu, şeffaf vitrin: raf siluetleri çok hafif (kahverengi opak panel gibi görünmesin)
    col = shop * 0.8 + vec3(0.5, 0.48, 0.44) * spot * 0.25 + vec3(0.035, 0.035, 0.035) * shelf;
  }
  return col;
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float seed = vAux.x;
float kind = vAux.y;
// Ölçülmüş perde: kapanma oranı tohumla negatif kodlu, renk 6-6-6 bit tür + 10·(kod+1) (facade.ts winCurtAux)
float cf = -1.0;
if (seed < -0.5) { float v = -seed - 1.0; float fq = floor((v + 0.5) / 100.0); seed = v - fq * 100.0; cf = fq / 20.0; }
vec3 cc = vec3(-1.0);
if (kind > 9.5) {
  float code = floor((kind + 0.5) / 10.0) - 1.0;
  kind = kind - (code + 1.0) * 10.0;
  cc = pow(vec3(floor(code / 4096.0), mod(floor(code / 64.0), 64.0), mod(code, 64.0)) / 63.0, vec3(2.2));
}
vec3 rc = roomColor(seed, kind, vWUv, max(vAux.z, 0.3), max(vAux.w, 0.3), cc, cf);
diffuseColor.rgb = rc * 0.65;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// Gece: odaların bir kısmı sıcak ışıkla yanar; gündüz odadan gelen loş ışık (güneşten bağımsız)
float lit = step(0.45, h1(seed * 17.3));
totalEmissiveRadiance += rc * (0.12 + uNight * lit * vec3(1.7, 1.35, 0.95));`,
      );
  };
  m.customProgramCacheKey = () => 'mk-winglass-v5';
  m.userData.noReceive = true;
  m.userData.noCast = true;
  // Ultra: aynasal yansıma yerel küreden (karşı cephe, ağaçlar, gök)
  registerReflective(m);
  return m;
}

/** Cam balkon: çerçevesiz katlanır cam; uv.x metre (derzler ~0.7 m), arkada balkon içi/perde */
export function camGlassMaterial(opt?: { pitch?: number; frame?: string }): THREE.MeshStandardMaterial {
  // v7: ölçülen dikme aralığı / profil rengi (verilmezse eski sabitler, aynı gölgelendirici)
  const pitch = opt?.pitch && opt.pitch > 0.2 ? opt.pitch : 0.72;
  const fc = opt?.frame ? new THREE.Color(opt.frame) : new THREE.Color().setRGB(0.68, 0.7, 0.71);
  const glsl = (x: number) => x.toFixed(4);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.03,
    metalness: 0.0,
    envMapIntensity: 2.4,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aux;\nflat varying vec4 vAux;\nvarying vec2 vWUv;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aux;\nvWUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
flat varying vec4 vAux;
varying vec2 vWUv;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float seed = vAux.x;
float tint = vAux.y; // 0 açık, 1 yeşil, 2 koyu, 3 perdeli
float x = vWUv.x;
float y = vWUv.y;
float panel = floor(x / ${glsl(pitch)});
// Derzler (çerçevesiz panel kenarları ~0.72 m ya da ölçülen aralık, ince profil) + alt/üst alüminyum profil
float joint = smoothstep(0.5 - 0.0274 / ${glsl(pitch)}, 0.5 - 0.0158 / ${glsl(pitch)}, abs(fract(x / ${glsl(pitch)}) - 0.5));
float prof = step(y, 0.035) + step(0.965, y);
// Eleştirmen (yakın plan): cam balkon = şeffaf cam, arkasında ince BEYAZ TÜL, gökyüzü yansıması; panel başına
// rastgele parlaklık mozaik gibi görünüyordu → kaldırıldı. Balkon içi karanlık, tül yumuşak dikey kıvrımlı.
vec3 inside = mix(vec3(0.03, 0.036, 0.045), vec3(0.075, 0.085, 0.1), smoothstep(0.0, 1.0, y));
float fold = 0.5 + 0.5 * sin(x * 21.0 + sin(x * 3.1 + seed) * 1.7);
vec3 tul = vec3(0.5, 0.51, 0.52) * (0.93 + 0.07 * fold);
if (tint > 2.5) {
  // "blinds": tül/stor daha yoğun ve açık (şerit değil)
  inside = mix(inside, tul * 1.08, 0.82);
} else if (tint > 0.5 && tint < 1.5) {
  // Yeşil camlı: yansıyan ağaçlar + cam kenar tonu
  inside = inside * vec3(0.72, 1.05, 0.9) + vec3(0.02, 0.09, 0.06);
} else if (tint > 1.5) {
  // Koyu (füme / içi karanlık): v7 — önceden ×0.55 ile kuzey (gölgeli) cephelerde saf siyah görünüyordu; dumanlı
  // koyu gri + gök yansıması (aşağıda ayrıca yöne bağımsız ışıma)
  inside = vec3(0.055, 0.063, 0.078) * (0.8 + 0.3 * y);
} else {
  // Şeffaf: çoğu dairede ince tül (yükseklik ~%85, alt kenar yumuşak), bazılarında açık
  float has = step(0.25, h1(seed * 3.0 + floor(x / 2.9)));
  inside = mix(inside, tul, 0.62 * has * smoothstep(0.06, 0.16, y));
}
// Ölçülmüş fon perde (aux.z = 1 + 6-6-6 bit renk, aux.w = kapanma oranı): ~2.9 m modülde iki yandan
if (vAux.z > 0.5) {
  float cv = floor(vAux.z - 1.0 + 0.5);
  vec3 dc = pow(vec3(floor(cv / 4096.0), mod(floor(cv / 64.0), 64.0), mod(cv, 64.0)) / 63.0, vec3(2.2));
  float f = clamp(vAux.w, 0.0, 1.0);
  float mx = fract(x / 2.9);
  float side = step(mx, f * 0.5) + step(1.0 - f * 0.5, mx);
  float dfo = 0.72 + 0.28 * (0.5 + 0.5 * sin(x * 24.0 + sin(x * 3.0) * 1.3));
  inside = mix(inside, dc * dfo * 0.85, min(side, 1.0) * smoothstep(0.02, 0.08, y));
}
// Gökyüzü yansıması (yukarı doğru güçlenen, yumuşak)
inside += vec3(0.06, 0.072, 0.088) * (0.55 + 0.45 * y);
vec3 frameCol = vec3(${glsl(fc.r)}, ${glsl(fc.g)}, ${glsl(fc.b)});
diffuseColor.rgb = mix(mix(inside, frameCol, joint), frameCol, prof);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * (0.12 + uNight * step(0.5, h1(seed * 13.7)) * 0.55);
// v7: koyu camda gök yansıması / odadan sızan ışık cephe yönünden bağımsız (gölgeli cephede siyah kalmasın)
if (tint > 1.5 && tint < 2.5) totalEmissiveRadiance += (1.0 - uNight * 0.8) * vec3(0.03, 0.036, 0.046) * (0.6 + 0.4 * y) * (1.0 - max(joint, prof));`,
      );
  };
  m.customProgramCacheKey = () => `mk-camglass-v7-${glsl(pitch)}-${fc.getHexString()}`;
  m.userData.noReceive = true;
  m.userData.noCast = true;
  registerReflective(m);
  return m;
}

/** Türk bayrağı (kırmızı, beyaz ay-yıldız) */
export function flagTexture(): THREE.Texture | null {
  if (!hasDom) return null;
  const [c, g] = canvas(300, 200);
  g.fillStyle = '#d21f26';
  g.fillRect(0, 0, 300, 200);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(100, 100, 50, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d21f26';
  g.beginPath();
  g.arc(112.5, 100, 40, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 10 : 25;
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    const x = 165 + Math.cos(a + Math.PI / 2) * r;
    const y = 100 + Math.sin(a + Math.PI / 2) * r;
    if (k) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const paverCache = new Map<string, { map: THREE.Texture; normalMap: THREE.Texture }>();

/**
 * Kilit parke taşı (dikdörtgen, şaşırtmalı dizi): 1 doku = W × H metre, taş boyu pw × ph (uzun kenar u yönünde).
 * Renkler: taş başına paletten seçim + ±%6 ton, pah (kenarlarda koyulaşma), derz rengi, hafif kir lekeleri.
 */
export function paverTextures(
  palette: string[],
  opts: {
    pw?: number;
    ph?: number;
    W?: number;
    H?: number;
    seed?: number;
    joint?: string;
    wear?: number;
  } = {},
): { map: THREE.Texture; normalMap: THREE.Texture } {
  const key = JSON.stringify([palette, opts]);
  const hit = paverCache.get(key);
  if (hit) return hit;
  const pw = opts.pw ?? 0.2;
  const ph = opts.ph ?? 0.1;
  const Wm = opts.W ?? 2;
  const Hm = opts.H ?? 1;
  const PPM = 256;
  const W = Math.round(Wm * PPM);
  const Hh = Math.round(Hm * PPM);
  const r = rng(opts.seed ?? 5);
  const [c, g] = canvas(W, Hh);
  const [nc, ng] = canvas(W, Hh);
  const img = g.createImageData(W, Hh);
  const nimg = ng.createImageData(W, Hh);
  const cols = palette.map(hexRgb);
  const joint = hexRgb(opts.joint ?? '#6f6a62');
  const rows = Math.round(Hm / ph);
  const perRow = Math.round(Wm / pw);
  // Taş başına renk
  const tone: number[][] = [];
  for (let y = 0; y < rows; y++) {
    tone.push([]);
    for (let x = 0; x < perRow; x++) {
      const base = cols[Math.floor(r() * cols.length)];
      const f = 1 + (r() - 0.5) * 0.12;
      tone[y].push(base[0] * f, base[1] * f, base[2] * f * (1 + (r() - 0.5) * 0.03));
    }
  }
  const mott = valueNoise(Math.max(W, Hh), 6, r);
  const wear = opts.wear ?? 0.06;
  const bev = 0.012 * PPM; // pah genişliği (px)
  for (let py = 0; py < Hh; py++)
    for (let px = 0; px < W; px++) {
      const ym = (py / PPM) % Hm;
      const row = Math.floor(ym / ph) % rows;
      const shift = row % 2 ? pw / 2 : 0;
      const xm = (((px / PPM + shift) % Wm) + Wm) % Wm;
      const colI = Math.floor(xm / pw) % perRow;
      // Taş içi konum (px)
      const lx = (xm - colI * pw) * PPM;
      const ly = (ym - row * ph) * PPM;
      const dEdge = Math.min(lx, pw * PPM - lx, ly, ph * PPM - ly);
      const i = py * W + px;
      const t = tone[row];
      let R = t[colI * 3];
      let G = t[colI * 3 + 1];
      let B = t[colI * 3 + 2];
      const m = 1 + (mott[(py % Hh) * Math.max(W, Hh) + (px % W)] - 0.5) * wear * 2 + (r() - 0.5) * 0.05;
      R *= m;
      G *= m;
      B *= m;
      let nx = 0;
      let ny = 0;
      if (dEdge < 1.2) {
        R = joint[0];
        G = joint[1];
        B = joint[2];
      } else if (dEdge < bev + 1.2) {
        const k = 1 - (dEdge - 1.2) / bev;
        const f = 1 - 0.18 * k;
        R *= f;
        G *= f;
        B *= f;
        // Pah normali: en yakın kenara doğru eğim
        const s = 0.6 * k;
        if (dEdge === lx) nx = -s;
        else if (dEdge === pw * PPM - lx) nx = s;
        else if (dEdge === ly) ny = s;
        else ny = -s;
      }
      img.data[i * 4] = Math.max(0, Math.min(255, R));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, G));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, B));
      img.data[i * 4 + 3] = 255;
      const l = Math.hypot(nx, ny, 1);
      nimg.data[i * 4] = (nx / l / 2 + 0.5) * 255;
      nimg.data[i * 4 + 1] = (ny / l / 2 + 0.5) * 255;
      nimg.data[i * 4 + 2] = (1 / l / 2 + 0.5) * 255;
      nimg.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  ng.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 8;
  const out = { map, normalMap };
  paverCache.set(key, out);
  return out;
}

let tactileCache: { map: THREE.Texture; normalMap: THREE.Texture } | null = null;

/**
 * Hissedilebilir kılavuz karo (Nilüfer kaldırımları, kullanıcı fotoğrafları): 40 × 40 cm sarı-hardal beton karo,
 * yürüme yönünde (u) 6 uzun kabartma çubuk, karo derzleri. 1 doku = 1 karo (UV metre × 2.5).
 */
export function tactileTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  if (tactileCache) return tactileCache;
  const S = 256;
  const r = rng(77);
  const [c, g] = canvas(S, S);
  const [nc, ng] = canvas(S, S);
  const img = g.createImageData(S, S);
  const nimg = ng.createImageData(S, S);
  const mott = valueNoise(S, 5, r);
  const base = hexRgb('#a8894a');
  const RIBS = 6;
  const pitch = (S - 16) / RIBS; // karo kenarında 8 px boşluk
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let f = 1 + (mott[i] - 0.5) * 0.16 + (r() - 0.5) * 0.06;
      const nx = 0;
      let ny = 0;
      const edge = Math.min(x, S - 1 - x, y, S - 1 - y);
      if (edge < 3) f *= 0.5;
      else if (edge < 7) f *= 0.82;
      else {
        // Çubuk: v (y) yönünde kesit, uçları yuvarlak (u başı/sonu 14 px)
        const ly = (y - 8) / pitch;
        const k = Math.floor(ly);
        const fy = ly - k;
        const inX = x > 14 && x < S - 14;
        if (k >= 0 && k < RIBS && inX) {
          const d = Math.abs(fy - 0.5) / 0.28; // çubuk yarı genişliği ≈ %28
          if (d < 1) {
            f *= 1.1 - 0.12 * d;
            ny = d > 0.55 ? (fy < 0.5 ? 0.8 : -0.8) : 0;
          } else f *= 0.8;
        } else f *= 0.95;
      }
      img.data[i * 4] = Math.min(255, base[0] * f);
      img.data[i * 4 + 1] = Math.min(255, base[1] * f);
      img.data[i * 4 + 2] = Math.min(255, base[2] * f);
      img.data[i * 4 + 3] = 255;
      const l = Math.hypot(nx, ny, 1);
      nimg.data[i * 4] = (nx / l / 2 + 0.5) * 255;
      nimg.data[i * 4 + 1] = (ny / l / 2 + 0.5) * 255;
      nimg.data[i * 4 + 2] = (1 / l / 2 + 0.5) * 255;
      nimg.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  ng.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nc);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(2.5, 2.5);
  }
  tactileCache = { map, normalMap };
  return tactileCache;
}

const boneCache = new Map<string, { map: THREE.Texture; normalMap: THREE.Texture }>();

/**
 * Site içi "kemik" kilit taşı (kullanıcı fotoğrafları): 20 × 16.5 cm taşlar, sıra içinde birbirine geçen çıkıntılı
 * yan kenarlar, sıralar yarım taş kaydırılmış → dalgalı derz. 1 doku = 2 m × 0.99 m (10 taş × 6 sıra).
 * palette: taş renkleri; redRows: bu sıra indeksleri (0..5) kırmızı paletle (bant) — boşsa hepsi palette.
 */
export function bonePaverTextures(
  palette: string[],
  seed = 3,
  joint = '#4f4c49',
): { map: THREE.Texture; normalMap: THREE.Texture } {
  const key = JSON.stringify([palette, seed, joint]);
  const hit = boneCache.get(key);
  if (hit) return hit;
  const SW = 52; // taş (px, u)
  const RH = 43; // sıra (px, v)
  const W = SW * 10;
  const H = RH * 6;
  const r = rng(seed);
  const [c, g] = canvas(W, H);
  const [, hg] = canvas(W, H);
  g.fillStyle = joint;
  g.fillRect(0, 0, W, H);
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, W, H);
  const bump = SW * 0.12;
  const outline = (x: number, y: number): [number, number][] => [
    [x, y],
    [x + SW, y],
    [x + SW, y + RH * 0.3],
    [x + SW - bump, y + RH * 0.42],
    [x + SW - bump, y + RH * 0.58],
    [x + SW, y + RH * 0.7],
    [x + SW, y + RH],
    [x, y + RH],
    [x, y + RH * 0.7],
    [x - bump, y + RH * 0.58],
    [x - bump, y + RH * 0.42],
    [x, y + RH * 0.3],
  ];
  const cols = palette.map(hexRgb);
  for (let row = 0; row < 6; row++) {
    const off = row % 2 ? SW / 2 : 0;
    for (let k = -1; k <= 10; k++) {
      const x = k * SW + off;
      const base = cols[Math.floor(r() * cols.length)];
      const f = 1 + (r() - 0.5) * 0.14;
      const col = `rgb(${Math.min(255, base[0] * f) | 0},${Math.min(255, base[1] * f) | 0},${Math.min(255, base[2] * f) | 0})`;
      for (const dx of [0, W, -W]) {
        const pts = outline(x + dx, row * RH);
        for (const [ctx, fill] of [
          [g, col],
          [hg, '#fff'],
        ] as const) {
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.lineWidth = ctx === g ? 2.2 : 5;
          ctx.strokeStyle = ctx === g ? joint : '#000';
          ctx.stroke();
        }
      }
    }
  }
  // Leke/kir
  const img = g.getImageData(0, 0, W, H);
  const mott = valueNoise(Math.max(W, H), 7, r);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const y = (i / W) | 0;
    const m = 1 + (mott[y * Math.max(W, H) + x] - 0.5) * 0.14 + (r() - 0.5) * 0.07;
    for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.min(255, img.data[i * 4 + k] * m);
  }
  g.putImageData(img, 0, 0);
  // Yükseklikten normal (pah)
  const hi = hg.getImageData(0, 0, W, H).data;
  const [nc, ng] = canvas(W, H);
  const nimg = ng.createImageData(W, H);
  const hAt = (x: number, y: number) => hi[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const nx = (hAt(x - 1, y) - hAt(x + 1, y)) * 1.2;
      const ny = (hAt(x, y - 1) - hAt(x, y + 1)) * 1.2;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * W + x) * 4;
      nimg.data[i] = (nx / l / 2 + 0.5) * 255;
      nimg.data[i + 1] = (ny / l / 2 + 0.5) * 255;
      nimg.data[i + 2] = (1 / l / 2 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  ng.putImageData(nimg, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nc);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(1 / 2, 1 / 0.99);
  }
  const out = { map, normalMap };
  boneCache.set(key, out);
  return out;
}

/** Ferforje dolgu (kamelya korkuluğu, fotoğraf): siyah C/S kıvrımları ve çiçek motifi, şeffaf zemin; 1 doku = 1 panel */
export function ironScrollTexture(): THREE.Texture {
  const W = 256;
  const H = 140;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#161616';
  g.lineCap = 'round';
  g.lineWidth = 5;
  const cx = W / 2;
  // Ortadan yükselen yelpaze kıvrımları
  for (let k = -3; k <= 3; k++) {
    const ang = (k / 3) * 1.1;
    g.beginPath();
    g.moveTo(cx, H - 6);
    const ex = cx + Math.sin(ang) * 100;
    const ey = H - 6 - Math.cos(ang) * 110;
    g.quadraticCurveTo(cx + Math.sin(ang) * 30, H - 40, ex, ey);
    g.stroke();
    g.beginPath();
    g.arc(ex + (k < 0 ? 9 : -9), ey + 4, 9, 0, Math.PI * 1.5, k < 0);
    g.stroke();
  }
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(cx + s * 55, H - 30, 22, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, H - 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
