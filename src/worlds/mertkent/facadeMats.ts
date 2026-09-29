import * as THREE from 'three';
import { nightUniform } from '../../env/night';

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
  const mA = opts.mottle ?? 0.05;
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
  return new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.95,
    ...p,
  });
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
        '#include <common>\nattribute vec4 aux;\nvarying vec4 vAux;\nvarying vec2 vWUv;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aux;\nvWUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
varying vec4 vAux;
varying vec2 vWUv;
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 roomColor(float seed, float kind, vec2 uv, float W, float Hh) {
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
    col = mix(room, tul, 0.8);
    if (kind > 0.5) {
      // Yan perdeler (renkli fon perde, iki yanda ~%22)
      float side = step(uv.x, 0.2 + 0.05 * h1(seed)) + step(0.8 - 0.05 * h1(seed + 1.0), uv.x);
      vec3 drape = mix(vec3(0.42, 0.3, 0.22), vec3(0.62, 0.52, 0.4), h1(seed * 5.3));
      drape = mix(drape, vec3(0.5, 0.18, 0.16), step(0.8, h1(seed * 9.1)));
      float df = 0.75 + 0.25 * sin(x * 22.0);
      col = mix(col, drape * df, min(side, 1.0));
    }
  } else if (kind < 2.5) {
    // Stor: bej/beyaz, yukarıdan belli bir yüksekliğe inik
    float drop = 0.35 + 0.6 * h1(seed * 2.7);
    vec3 st = mix(vec3(0.72, 0.68, 0.6), vec3(0.85, 0.84, 0.8), h1(seed * 4.4));
    col = uv.y > 1.0 - drop ? st * (0.92 + 0.08 * step(0.5, fract(y * 12.0))) : mix(room, vec3(0.7, 0.69, 0.66), 0.55);
  } else if (kind < 3.5) {
    // Dikey jaluzi (beyaz lameller)
    float sl = 0.55 + 0.45 * smoothstep(0.0, 0.5, abs(fract(x * 11.0) - 0.5));
    col = vec3(0.78, 0.78, 0.76) * sl;
  } else if (kind < 4.5) {
    col = room * 0.8;
  } else if (kind < 5.5) {
    // Zebra perde: yatay bantlar (yarı saydam / opak)
    float band = step(0.5, fract(y * 5.5 + h1(seed) ));
    col = mix(mix(room, vec3(0.8, 0.78, 0.74), 0.55), vec3(0.83, 0.82, 0.78), band);
  } else {
    col = room * 0.6;
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
vec3 rc = roomColor(seed, kind, vWUv, max(vAux.z, 0.3), max(vAux.w, 0.3));
diffuseColor.rgb = rc * 0.65;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// Gece: odaların bir kısmı sıcak ışıkla yanar; gündüz odadan gelen loş ışık (güneşten bağımsız)
float lit = step(0.45, h1(seed * 17.3));
totalEmissiveRadiance += rc * (0.12 + uNight * lit * vec3(2.6, 2.1, 1.5));`,
      );
  };
  m.customProgramCacheKey = () => 'mk-winglass-v1';
  m.userData.noReceive = true;
  m.userData.noCast = true;
  return m;
}

/** Cam balkon: çerçevesiz katlanır cam; uv.x metre (derzler ~0.7 m), arkada balkon içi/perde */
export function camGlassMaterial(): THREE.MeshStandardMaterial {
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
        '#include <common>\nattribute vec4 aux;\nvarying vec4 vAux;\nvarying vec2 vWUv;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aux;\nvWUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
varying vec4 vAux;
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
float panel = floor(x / 0.72);
// Derzler (çerçevesiz panel kenarları ~0.72 m) + alt/üst alüminyum profil
float joint = smoothstep(0.02, 0.0, abs(fract(x / 0.72) - 0.5) - 0.475);
float prof = step(y, 0.035) + step(0.965, y);
// Balkon içi: tavan açık, zemin koyu; paneller arası hafif ton farkı (katlanır camların açısı)
vec3 inside = mix(vec3(0.16, 0.165, 0.16), vec3(0.34, 0.34, 0.33), smoothstep(0.0, 1.0, y));
inside *= 0.9 + 0.2 * h1(panel + seed);
if (tint > 2.5) {
  // Zebra / stor perde (açık yeşil-beyaz bantlar)
  float band = step(0.5, fract(y * 7.0 + h1(seed)));
  inside = mix(vec3(0.5, 0.58, 0.52), vec3(0.72, 0.76, 0.7), band);
} else if (tint > 0.5 && tint < 1.5) {
  // Yeşil camlı: yansıyan ağaçlar + cam kenar tonu
  inside = inside * vec3(0.72, 1.05, 0.9) + vec3(0.02, 0.09, 0.06);
} else if (tint > 1.5) {
  inside *= 0.55;
} else {
  // Açık: tül / eşya lekeleri
  float cur = step(0.55, h1(panel + seed * 3.0));
  inside = mix(inside, vec3(0.62, 0.62, 0.6), cur * 0.55);
}
// Sahte gökyüzü yansıması (yukarı bakan camlarda güçlü)
inside += vec3(0.07, 0.085, 0.1) * (0.6 + 0.4 * y);
vec3 frameCol = vec3(0.62, 0.64, 0.66);
diffuseColor.rgb = mix(mix(inside, frameCol, joint), frameCol, prof);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * (0.12 + uNight * step(0.5, h1(seed * 13.7)) * 1.6);`,
      );
  };
  m.customProgramCacheKey = () => 'mk-camglass-v2';
  m.userData.noReceive = true;
  m.userData.noCast = true;
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
