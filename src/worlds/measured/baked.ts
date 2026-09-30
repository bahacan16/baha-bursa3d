/**
 * Pişirilmiş dolaylı ışık — oyun tarafı (docs/BAKE.md §Hat 4).
 *
 * Ultra kalitede (veya `?bake=1`) `public/bake/manifest.json` okunur. El modeli meshleri (`mertkent <anahtar>`)
 * yine canlı üretilir; imzası (lightmap.ts `chunkSignature`) manifest'tekiyle tutan her 100 m parçada üçgenler
 * uv1'li yeni geometriye taşınır ve oyunun **kendi malzemesinin klonu** ile (+ `aoMap`, kanal 1) çizilir. AO yalnız
 * dolaylı ışığı (ortam haritası + yarım küre) çarpar; güneş ve gölgesi gerçek zamanlı kalır. Çarpışma dünyası
 * üretimden geldiği için değişmez. İmzası tutmayan parça (kaynak değişmiş, pişirme eskimiş) canlı kalır ve konsola
 * uyarı düşülür. Zemin (arazi) gölgelendiricisine dünya xz ile `ground_ao` örneklemesi eklenir.
 */
import * as THREE from 'three';
import { reflectiveMaterials, ultraState } from '../../env/ultra';
import {
  BAKE_CHUNK,
  BAKE_UV_VERSION,
  chunkSignature,
  splitChunks,
  unwrapChunk,
  type BakeSource,
  type UnwrappedPart,
  type UnwrapOptions,
} from './lightmap';

declare const __BAKE_SRC_HASH__: string;
/** Derleme anında `scripts/bake-hash.mjs` ile hesaplanan kaynak özeti (vite.config.ts `define`) */
export const BAKE_SRC_HASH: string = typeof __BAKE_SRC_HASH__ === 'string' ? __BAKE_SRC_HASH__ : 'dev';

export interface MatInfo {
  color: string;
  transparent: boolean;
  opacity: number;
  alphaTest: number;
  doubleSided: boolean;
  /** Alıcı mı (atlasa girer). Alfa testli yaprak kartları vb. yalnız engelleyici. */
  bake: boolean;
}

export interface BakeManifest {
  version: number;
  uvVersion: number;
  /** Parça kenarı (m) */
  chunkSize?: number;
  srcHash: string;
  createdAt: string;
  blender: string;
  method: 'diffuse-ratio' | 'ao';
  samples: number;
  unwrap: UnwrapOptions;
  pages: { file: string; size: number }[];
  chunks: {
    id: string;
    bbox: [number, number, number, number];
    sig: string;
    size: number;
    texel: number;
    page: number;
    /** Sayfadaki yeri (px): x, y (üstten), kenar */
    rect: [number, number, number];
    meshes: number;
  }[];
  groundAo?: { file: string; rect: [number, number, number, number]; mpp: number };
}

/** Oyunun diğer kısımları (ör. son işlem SSAO şiddeti) için: pişirme etkin mi */
export const bakedLighting = { active: false, chunks: 0 };

const GROUP_NAME = 'mertkent (el modeli)';

/** `?bakeao=0..1`: pişirilmiş AO şiddeti (göz ayarı / karşılaştırma için; varsayılan 1 = fiziksel oran) */
const AO_INTENSITY = (() => {
  if (typeof location === 'undefined') return 1;
  const v = Number(new URLSearchParams(location.search).get('bakeao'));
  return Number.isFinite(v) && v >= 0 && v <= 1 && new URLSearchParams(location.search).has('bakeao') ? v : 1;
})();

export function bakeRequested(): boolean {
  if (typeof location === 'undefined') return false;
  const p = new URLSearchParams(location.search);
  if (p.has('bakeexport') || p.get('bake') === '0') return false;
  // Ultra kararını oyun verir (ayar + GPU denetimi, game.ts → ultraState.on); ?bake=1 her durumda zorlar
  return p.get('bake') === '1' || ultraState.on;
}

/** El modeli meshleri → pişirme kaynakları (anahtar sırasına göre) */
export function collectBakeSources(root: THREE.Object3D): {
  sources: BakeSource[];
  others: BakeSource[];
  meshes: Map<string, THREE.Mesh>;
  info: Map<string, MatInfo>;
} | null {
  const group = root.name === GROUP_NAME ? root : root.getObjectByName(GROUP_NAME);
  if (!group) return null;
  const sources: BakeSource[] = [];
  const others: BakeSource[] = [];
  const meshes = new Map<string, THREE.Mesh>();
  const info = new Map<string, MatInfo>();
  for (const o of group.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.name.startsWith('mertkent ') || Array.isArray(m.material)) continue;
    const key = m.name.slice(9);
    const mat = m.material as THREE.MeshStandardMaterial;
    const bake = !!mat.isMeshStandardMaterial && !(mat.alphaTest > 0) && !!m.geometry.index;
    info.set(key, {
      color: `#${(mat.color ?? new THREE.Color(0xffffff)).getHexString()}`,
      transparent: !!mat.transparent,
      opacity: mat.opacity ?? 1,
      alphaTest: mat.alphaTest ?? 0,
      doubleSided: mat.side === THREE.DoubleSide,
      bake,
    });
    meshes.set(key, m);
    (bake ? sources : others).push({ key, geometry: m.geometry });
  }
  const byKey = (a: BakeSource, b: BakeSource) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return { sources: sources.sort(byKey), others: others.sort(byKey), meshes, info };
}

/** Kaynak geometriden açılmış parça: tüm öznitelikler vmap ile kopyalanır, uv1 eklenir */
export function partGeometry(src: THREE.BufferGeometry, part: UnwrappedPart): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = part.vmap.length;
  for (const [name, a] of Object.entries(src.attributes)) {
    const s = a.itemSize;
    const arr = new Float32Array(n * s);
    const direct = !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !a.normalized;
    const sa = a.array as ArrayLike<number>;
    for (let i = 0; i < n; i++) {
      const v = part.vmap[i];
      if (direct) for (let k = 0; k < s; k++) arr[i * s + k] = sa[v * s + k];
      else for (let k = 0; k < s; k++) arr[i * s + k] = a.getComponent(v, k);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  g.setAttribute('uv1', new THREE.BufferAttribute(part.uv1, 2));
  g.setIndex(new THREE.BufferAttribute(part.index, 1));
  return g;
}

/** Aynı öznitelikli geometrileri birleştir */
function concat(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (gs.length === 1) return gs[0];
  const out = new THREE.BufferGeometry();
  let nv = 0;
  let ni = 0;
  for (const g of gs) {
    nv += g.attributes.position.count;
    ni += (g.index as THREE.BufferAttribute).count;
  }
  for (const [name, a] of Object.entries(gs[0].attributes)) {
    const arr = new Float32Array(nv * a.itemSize);
    let o = 0;
    for (const g of gs) {
      arr.set(g.attributes[name].array as Float32Array, o);
      o += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const idx = new Uint32Array(ni);
  let o = 0;
  let base = 0;
  for (const g of gs) {
    const src = (g.index as THREE.BufferAttribute).array;
    for (let i = 0; i < src.length; i++) idx[o + i] = src[i] + base;
    o += src.length;
    base += g.attributes.position.count;
    g.dispose();
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function aoTexture(data: Uint8Array, w: number, h: number, channel: number): THREE.DataTexture {
  // Satır 0 = görüntünün üstü = uv v=0 (glTF kuralı) → flipY yok
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.channel = channel;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** GPU'nun en büyük doku kenarı (bir kez, geçici WebGL2 bağlamıyla) */
let maxTexCache = 0;
function maxTextureSize(): number {
  if (maxTexCache) return maxTexCache;
  maxTexCache = 4096;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      maxTexCache = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* varsayılan 4096 */
  }
  return maxTexCache;
}

/**
 * Gri AO görüntüsü → tek kanallı (R8), mipmap'li dokular. Görüntü `tile` pikselden büyükse `tile`×`tile`
 * dokulara bölünür (anahtar "tx,ty"): dörtlü ağaç paketlemesinde hiçbir parça dilim sınırını aşmaz.
 * 2048² parçalarla okunur (tek dev tuval hem ~270 MB geçici bellek hem Safari tuval sınırı 16.7 Mpx).
 */
async function loadAoTiles(
  url: string,
  channel: number,
  tile = Infinity,
): Promise<{ w: number; h: number; tile: number; tex: Map<string, THREE.DataTexture> } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const w = bmp.width;
    const h = bmp.height;
    const T = Math.min(tile, Math.max(w, h));
    const R = 2048;
    const cv = document.createElement('canvas');
    cv.width = Math.min(R, w);
    cv.height = Math.min(R, h);
    const ctx = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const tex = new Map<string, THREE.DataTexture>();
    for (let ty = 0; ty * T < h; ty++)
      for (let tx = 0; tx * T < w; tx++) {
        const X0 = tx * T;
        const Y0 = ty * T;
        const tw = Math.min(T, w - X0);
        const th = Math.min(T, h - Y0);
        const data = new Uint8Array(tw * th);
        for (let y0 = 0; y0 < th; y0 += R)
          for (let x0 = 0; x0 < tw; x0 += R) {
            const rw = Math.min(R, tw - x0);
            const rh = Math.min(R, th - y0);
            ctx.clearRect(0, 0, rw, rh);
            ctx.drawImage(bmp, X0 + x0, Y0 + y0, rw, rh, 0, 0, rw, rh);
            const rgba = ctx.getImageData(0, 0, rw, rh).data;
            for (let y = 0; y < rh; y++) {
              const o = (y0 + y) * tw + x0;
              for (let x = 0; x < rw; x++) data[o + x] = rgba[(y * rw + x) * 4];
            }
          }
        tex.set(`${tx},${ty}`, aoTexture(data, tw, th, channel));
      }
    bmp.close();
    cv.width = cv.height = 1;
    return { w, h, tile: T, tex };
  } catch (e) {
    console.warn('bake: doku yüklenemedi', url, e);
    return null;
  }
}

/** Klon: aynı dokular/gölgelendirici eklentisi, + aoMap (kanal 1). Program önbellek anahtarı ayrışır. */
function aoClone(m: THREE.MeshStandardMaterial, tex: THREE.Texture): THREE.MeshStandardMaterial {
  const c = m.clone();
  c.onBeforeCompile = m.onBeforeCompile;
  const key = m.customProgramCacheKey.bind(m);
  c.customProgramCacheKey = () => `${key()}|bakedAO`;
  c.userData = m.userData;
  c.aoMap = tex;
  c.aoMapIntensity = AO_INTENSITY;
  c.name = `${m.name || ''}+ao`;
  // Ultra yerel yansıma yaması onBeforeCompile ile birlikte kopyalandı → ikinci kez yamalanmasın
  if (reflectiveMaterials.has(m)) reflectiveMaterials.add(c);
  return c;
}

/** Arazi malzemesine dünya xz ile zemin AO'su (yalnız dolaylı ışık) */
function patchGround(ground: THREE.MeshStandardMaterial, tex: THREE.Texture, rect: number[]): void {
  const prev = ground.onBeforeCompile.bind(ground);
  const prevKey = ground.customProgramCacheKey.bind(ground);
  const uRect = { value: new THREE.Vector4(rect[0], rect[1], rect[2], rect[3]) };
  ground.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.groundAoMap = { value: tex };
    sh.uniforms.groundAoRect = uRect;
    // Arazi uv'si: 2·half kare, v yukarı (world.ts createTerrainMesh) → dünya xz
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D groundAoMap;\nuniform vec4 groundAoRect;\nuniform float groundHalf;',
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
#ifdef USE_MAP
  {
    vec2 gw = vec2(vMapUv.x, 1.0 - vMapUv.y) * (2.0 * groundHalf) - groundHalf;
    vec2 gq = (gw - groundAoRect.xy) / (groundAoRect.zw - groundAoRect.xy);
    if (gq.x > 0.0 && gq.x < 1.0 && gq.y > 0.0 && gq.y < 1.0) {
      float gao = mix(1.0, texture2D(groundAoMap, gq).r, ${AO_INTENSITY.toFixed(3)});
      reflectedLight.indirectDiffuse *= gao;
      reflectedLight.indirectSpecular *= gao;
    }
  }
#endif`,
      );
    // groundHalf bildirimi zaten varsa ikinciyi sil (materials.ts ekliyor)
    const decl = 'uniform float groundHalf;';
    const first = sh.fragmentShader.indexOf(decl);
    const second = sh.fragmentShader.indexOf(decl, first + 1);
    if (second > 0)
      sh.fragmentShader = sh.fragmentShader.slice(0, second) + sh.fragmentShader.slice(second + decl.length);
  };
  ground.customProgramCacheKey = () => `${prevKey()}|groundAO${AO_INTENSITY}`;
  ground.needsUpdate = true;
}

/**
 * Pişirilmiş parçaları uygula. root: el modeli grubu (veya onu içeren nesne). ground: arazi malzemesi.
 * Dönen değer: uygulanan parça sayısı (0 = canlı).
 */
export async function applyBakedLighting(
  root: THREE.Object3D,
  ground: THREE.MeshStandardMaterial | null,
  base: string,
): Promise<number> {
  let man: BakeManifest;
  try {
    const r = await fetch(`${base}bake/manifest.json`);
    if (!r.ok) {
      console.info('bake: pişirilmiş ışık yok (public/bake/manifest.json) — canlı ışık');
      return 0;
    }
    man = (await r.json()) as BakeManifest;
  } catch {
    console.info('bake: manifest okunamadı — canlı ışık');
    return 0;
  }
  if (man.uvVersion !== BAKE_UV_VERSION) {
    console.warn(
      `bake: uv sürümü farklı (${man.uvVersion} ≠ ${BAKE_UV_VERSION}) — yeniden pişirilmeli; canlı ışık`,
    );
    return 0;
  }
  const col = collectBakeSources(root);
  if (!col) return 0;
  const t0 = performance.now();
  const chunks = splitChunks(col.sources, man.chunkSize ?? BAKE_CHUNK);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const valid: { c: (typeof chunks)[number]; m: BakeManifest['chunks'][number] }[] = [];
  const stale: string[] = [];
  for (const mc of man.chunks) {
    const c = byId.get(mc.id);
    if (c && chunkSignature(c, col.sources) === mc.sig) valid.push({ c, m: mc });
    else stale.push(mc.id);
  }
  const unbaked = chunks.filter((c) => !man.chunks.some((m) => m.id === c.id)).map((c) => c.id);
  if (man.srcHash !== BAKE_SRC_HASH)
    console.warn(
      `bake: kaynak özeti farklı (pişirme ${man.srcHash.slice(0, 10)}, oyun ${BAKE_SRC_HASH.slice(0, 10)}) — ` +
        `imzası tutan ${valid.length}/${man.chunks.length} parça kullanılıyor; komşu değişiklikleri yansımayabilir, ` +
        'yeniden pişirin (bake-lighting iş akışı)',
    );
  if (stale.length)
    console.warn(`bake: eskimiş parçalar canlı çiziliyor: ${stale.join(' ')} — yeniden pişirin`);
  if (unbaked.length) console.info(`bake: pişirilmemiş parçalar: ${unbaked.join(' ')}`);

  // Sayfa dokuları: sırayla (paralel çözme geçici belleği katlar); sayfa GPU sınırından büyükse dilimlere bölünür
  const maxTex = maxTextureSize();
  const pageTiles = new Map<number, NonNullable<Awaited<ReturnType<typeof loadAoTiles>>>>();
  for (const p of [...new Set(valid.map((v) => v.m.page))].sort((a, b) => a - b)) {
    const t = await loadAoTiles(`${base}bake/${man.pages[p].file}`, 1, maxTex);
    if (t) pageTiles.set(p, t);
  }

  // key → sayfa → parçalar; key → pişirilen üçgenler
  const perKey = new Map<string, Map<string, THREE.BufferGeometry[]>>();
  const bakedTris = new Map<string, Set<number>>();
  let applied = 0;
  const texOf = new Map<string, THREE.DataTexture>();
  for (const { c, m } of valid) {
    const pt = pageTiles.get(m.page);
    if (!pt) continue;
    const [px, py, rs] = m.rect;
    const tx = Math.floor(px / pt.tile);
    const ty = Math.floor(py / pt.tile);
    const tkey = `${m.page}:${tx},${ty}`;
    const tex = pt.tex.get(`${tx},${ty}`);
    if (!tex || px + rs > (tx + 1) * pt.tile || py + rs > (ty + 1) * pt.tile) {
      console.warn(`bake: ${c.id} sayfa dilimine sığmıyor — canlı`);
      continue;
    }
    texOf.set(tkey, tex);
    const u = unwrapChunk(c, col.sources, man.unwrap);
    if (u.size !== m.size) {
      console.warn(`bake: ${c.id} atlas boyutu farklı (${u.size} ≠ ${m.size}) — canlı`);
      continue;
    }
    // Dilim içi konum
    const P = pt.tile;
    const rx = px - tx * pt.tile;
    const ry = py - ty * pt.tile;
    c.parts.forEach((part, i) => {
      const key = col.sources[part.src].key;
      const up = u.parts[i];
      const uv = up.uv1;
      for (let k = 0; k < uv.length; k += 2) {
        uv[k] = (rx + uv[k] * rs) / P;
        uv[k + 1] = (ry + uv[k + 1] * rs) / P;
      }
      const g = partGeometry(col.sources[part.src].geometry, up);
      let pk = perKey.get(key);
      if (!pk) perKey.set(key, (pk = new Map()));
      let l = pk.get(tkey);
      if (!l) pk.set(tkey, (l = []));
      l.push(g);
      let bt = bakedTris.get(key);
      if (!bt) bakedTris.set(key, (bt = new Set()));
      for (const t of part.tris) bt.add(t);
    });
    applied++;
  }

  const clones = new Map<string, THREE.MeshStandardMaterial>();
  for (const [key, pages] of perKey) {
    const src = col.meshes.get(key) as THREE.Mesh;
    const parent = src.parent as THREE.Object3D;
    const mat = src.material as THREE.MeshStandardMaterial;
    for (const [p, gs] of pages) {
      const ck = `${mat.uuid}|${p}`;
      let cm = clones.get(ck);
      if (!cm) clones.set(ck, (cm = aoClone(mat, texOf.get(p) as THREE.Texture)));
      const g = concat(gs);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, cm);
      mesh.name = `${src.name} baked${p}`;
      mesh.castShadow = src.castShadow;
      mesh.receiveShadow = src.receiveShadow;
      mesh.renderOrder = src.renderOrder;
      mesh.userData.baked = true;
      parent.add(mesh);
    }
    // Kalan (pişirilmemiş) üçgenler kaynak meshte kalır
    const bt = bakedTris.get(key) as Set<number>;
    const idx = src.geometry.index as THREE.BufferAttribute;
    const nT = idx.count / 3;
    if (bt.size >= nT) {
      parent.remove(src);
      src.geometry.dispose();
    } else {
      const rest: number[] = [];
      for (let t = 0; t < nT; t++)
        if (!bt.has(t)) rest.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2));
      src.geometry.setIndex(rest);
    }
  }

  // Zemin AO
  if (ground && man.groundAo) {
    const gt = await loadAoTiles(`${base}bake/${man.groundAo.file}`, 0);
    const g0 = gt?.tex.get('0,0');
    if (gt && g0 && gt.tex.size === 1) patchGround(ground, g0, man.groundAo.rect);
    else if (gt) console.warn('bake: zemin AO dokusu GPU sınırından büyük — atlandı');
  }
  bakedLighting.active = applied > 0;
  bakedLighting.chunks = applied;
  console.info(
    `bake: ${applied}/${chunks.length} parça pişirilmiş ışıkla (${man.method}, ${man.samples} örnek), ` +
      `${Math.round(performance.now() - t0)} ms`,
  );
  return applied;
}
