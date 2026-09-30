import * as THREE from 'three';
import { reflectiveMaterials, shadowOnlyRoots } from '../../env/ultra';

/**
 * Ultra: el modeli çizim çağrısı birleştirme (görünüm aynı, yalnız çizim düzeni değişir).
 *
 * Builder her malzeme anahtarı için bölgenin tamamını kapsayan tek mesh üretir; ölçülen renkler (kat kat balkon alını,
 * sıva, doğrama, metal…) ~2600 ayrı malzeme demek. Gerçek veride başlangıç noktasında el modeli ana geçişte ~1.6k,
 * iki gölge kademesinde ~2.7k çizim çağrısıydı (toplam ~5.2k → RTX 4090'da ~5 FPS, GPU boşta: sürücüye gönderim sınırı).
 *
 * 1. Gölge vekilleri: gölge derinlik geçişinde tüm opak dökümler aynı MeshDepthMaterial ile çizilir (malzeme rengi /
 *    dokusu kullanılmaz). Bu yüzden dökümler yalnız konum geometrisi olarak ızgara hücresi × gölge yüzü başına
 *    birleştirilir; vekiller yalnız gölge haritası çizilirken görünür (`shadowOnlyRoots`, game.ts). Derinlik aynı.
 * 2. Renk birleştirme: yalnız `color`'ı farklı, dokusuz/aynı dokulu, özel gölgelendiricisiz opak malzemeler tek
 *    malzeme + köşe rengi (renk × köşe rengi = aynı çarpım) — hücre başına bir mesh.
 * 3. Grenli sıva (granularMaterial): renk başına 512² doku (renk dokuya işlenmiş), aynı tohumda normal haritası aynı.
 *    Renk dokuları 2B doku dizisine (katman = eski doku, aynı süzgeç/mipmap) taşınır; köşe başına katman indeksi.
 *    Örneklenen texel aynı olduğu için görünüm aynı.
 *
 * Birleştirilen meshler ızgara hücrelerine bölünür (kesik kesik ekran/kademe ayıklaması çalışsın): önceden her anahtar
 * bölge boyu (~1 km) sınır küresiyle hiç ayıklanmıyordu.
 * KARAR: yalnız Ultra (Düşük/Orta/Yüksek çıktısı değişmez); `?nobatch` kapatır. Pişirme dışa aktarımı / pişirilmiş
 * parçalar (userData.baked) dokunulmaz.
 */

const MAIN_CELL = 512;
const SHADOW_CELL = 256;
/** WebGL2 garantili en az dizi katmanı */
const MAX_LAYERS = 256;

export interface BatchStats {
  meshesBefore: number;
  meshesAfter: number;
  shadowCastersBefore: number;
  shadowProxies: number;
  colorMerged: number;
  colorMeshes: number;
  granMerged: number;
  granMeshes: number;
  /** gölge vekili / renk / doku dizisi süreleri */
  phaseMs: number[];
  ms: number;
}

type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

const protoOBC = THREE.Material.prototype.onBeforeCompile;
const SKIP_PROPS = new Set([
  'uuid',
  'name',
  'id',
  'version',
  'userData',
  '_listeners',
  'color',
  'onBeforeCompile',
  'customProgramCacheKey',
]);

/** Malzeme kimliği (oluşturma sırası; tiplerde yok) */
const mid = (m: THREE.Material): number => (m as unknown as { id: number }).id;

const fnIds = new WeakMap<object, number>();
let fnSeq = 0;
function objId(o: object): number {
  let v = fnIds.get(o);
  if (v === undefined) fnIds.set(o, (v = ++fnSeq));
  return v;
}

function valSig(v: unknown, skipTex: boolean): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'function') return `fn${objId(v)}`;
  if (v instanceof THREE.Color) return `c${v.r},${v.g},${v.b}`;
  if (v instanceof THREE.Texture) return skipTex ? 'tex' : `t${v.uuid}`;
  if (v instanceof THREE.Vector2 || v instanceof THREE.Vector3 || v instanceof THREE.Vector4)
    return `v${v.toArray().join(',')}`;
  if (v instanceof THREE.Euler) return `e${v.x},${v.y},${v.z},${v.order}`;
  if (v instanceof THREE.Matrix3 || v instanceof THREE.Matrix4) return `m${v.elements.join(',')}`;
  if (Array.isArray(v)) return `[${v.map((x) => valSig(x, skipTex)).join(',')}]`;
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return `o${objId(v)}`;
    }
  }
  return String(v);
}

/** Malzemenin renk (ve istenirse map/normalMap) dışındaki tüm durumu. */
function matSig(m: THREE.Material, skip: Set<string> = SKIP_PROPS): string {
  const parts = [m.type];
  for (const k of Object.keys(m).sort()) {
    if (skip.has(k)) continue;
    parts.push(`${k}=${valSig((m as unknown as Record<string, unknown>)[k], false)}`);
  }
  return parts.join('|');
}

const LIB: Record<string, string> = {
  MeshStandardMaterial: 'physical',
  MeshPhysicalMaterial: 'physical',
  MeshBasicMaterial: 'basic',
  MeshLambertMaterial: 'lambert',
  MeshPhongMaterial: 'phong',
};

interface Patched {
  sig: string;
  /** köşe rengi (vColor) gölgelendiricide hâlâ uygulanıyor ve `diffuse` başka yerde kullanılmıyor */
  vcSafe: boolean;
  /** `map` yalnız map_fragment'ta örnekleniyor (doku dizisine taşınabilir) */
  mapSafe: boolean;
  /** `emissiveMap` yalnız emissivemap_fragment'ta örnekleniyor */
  emissiveSafe: boolean;
  /** pürüzlülük / metallik yalnız roughness/metalnessmap parçalarında okunuyor (köşe özniteliğine taşınabilir) */
  rmSafe: boolean;
}
const patchCache = new WeakMap<THREE.Material, Patched | null>();

/**
 * Özel gölgelendirici eklentisinin (onBeforeCompile) imzası: eklenti gerçek kütüphane gölgelendiricisine iki kez
 * uygulanır; çıkan kod + eklenen uniform'lar (paylaşılan nesne → kimlik, malzemeye özel → değer) + program anahtarı.
 * Aynı imzalı malzemelerin programı ve uniform'ları aynıdır (kapanıştaki değerler çıktıya yansır).
 */
function patchSig(m: THREE.Material): Patched | null {
  if (patchCache.has(m)) return patchCache.get(m) as Patched | null;
  let res: Patched | null = null;
  const lib = (
    THREE.ShaderLib as unknown as Record<string, { vertexShader: string; fragmentShader: string } | undefined>
  )[LIB[m.type] ?? ''];
  if (m.onBeforeCompile === protoOBC)
    res = {
      sig: `proto|${m.customProgramCacheKey()}`,
      vcSafe: true,
      mapSafe: true,
      emissiveSafe: true,
      rmSafe: true,
    };
  else if (lib) {
    try {
      const run = () => {
        const sh = {
          vertexShader: lib.vertexShader,
          fragmentShader: lib.fragmentShader,
          uniforms: {} as Record<string, THREE.IUniform>,
          defines: {} as Record<string, unknown>,
        };
        m.onBeforeCompile.call(m, sh as unknown as THREE.WebGLProgramParametersWithUniforms, null as never);
        return sh;
      };
      const a = run();
      const b = run();
      const u = Object.keys(a.uniforms)
        .sort()
        .map((k) => {
          const ua = a.uniforms[k];
          const shared = ua === b.uniforms[k];
          return `${k}:${shared ? `s${objId(ua)}` : valSig(ua?.value, false)}`;
        });
      const cnt = (t: string, re = /\bdiffuse\b/g) => (t.match(re) ?? []).length;
      const vcSafe =
        a.fragmentShader.includes('#include <color_fragment>') &&
        a.vertexShader.includes('#include <color_vertex>') &&
        cnt(a.fragmentShader) === cnt(lib.fragmentShader);
      res = {
        sig: hashStr(
          [
            a.vertexShader,
            a.fragmentShader,
            u.join(','),
            JSON.stringify(a.defines),
            m.customProgramCacheKey(),
          ].join('\u0001'),
        ),
        vcSafe,
        mapSafe:
          a.fragmentShader.includes('#include <map_fragment>') &&
          cnt(a.fragmentShader, /\bmap\b/g) === cnt(lib.fragmentShader, /\bmap\b/g),
        rmSafe:
          a.fragmentShader.includes('#include <roughnessmap_fragment>') &&
          a.fragmentShader.includes('#include <metalnessmap_fragment>') &&
          cnt(a.fragmentShader, /\broughness\b/g) === cnt(lib.fragmentShader, /\broughness\b/g) &&
          cnt(a.fragmentShader, /\bmetalness\b/g) === cnt(lib.fragmentShader, /\bmetalness\b/g),
        emissiveSafe:
          a.fragmentShader.includes('#include <emissivemap_fragment>') &&
          cnt(a.fragmentShader, /\bemissiveMap\b/g) === cnt(lib.fragmentShader, /\bemissiveMap\b/g),
      };
    } catch {
      res = null;
    }
  }
  patchCache.set(m, res);
  return res;
}

/** Birleştirilmiş malzeme: ilk malzemenin klonu + aynı gölgelendirici eklentisi */
function cloneWithPatch<M extends THREE.Material>(src: M): M {
  const c = src.clone() as M;
  c.onBeforeCompile = src.onBeforeCompile;
  c.customProgramCacheKey = src.customProgramCacheKey;
  c.userData = src.userData;
  if (reflectiveMaterials.has(src)) reflectiveMaterials.add(c);
  return c;
}

function texParams(t: THREE.Texture): string {
  return [
    t.wrapS,
    t.wrapT,
    t.magFilter,
    t.minFilter,
    t.anisotropy,
    t.colorSpace,
    t.generateMipmaps,
    t.offset.toArray(),
    t.repeat.toArray(),
    t.center.toArray(),
    t.rotation,
    t.matrixAutoUpdate,
    t.channel,
    t.flipY,
    t.premultiplyAlpha,
    t.format,
    t.type,
  ].join(',');
}

function geoSig(g: THREE.BufferGeometry): string {
  const a = Object.keys(g.attributes)
    .sort()
    .map((k) => {
      const at = g.attributes[k] as THREE.BufferAttribute;
      return `${k}:${at.itemSize}:${at.normalized ? 1 : 0}:${(at as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? 'i' : ''}`;
    });
  return a.join(',');
}

function meshSig(m: Mesh): string {
  return `${m.renderOrder}|${m.castShadow}|${m.receiveShadow}|${m.frustumCulled}|${m.layers.mask}|${geoSig(m.geometry)}`;
}

/** Birleştirmeye uygun düz mesh (tek malzeme, dizinli, grup / morf / dönüşüm yok). */
export function plain(o: THREE.Object3D): o is Mesh {
  const m = o as Mesh;
  if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return false;
  if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(m.material)) return false;
  if (m.userData.baked || !m.visible) return false;
  const g = m.geometry;
  if (!g.index || g.groups.length > 1 || Object.keys(g.morphAttributes).length) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count < g.index.count) return false;
  if (!m.matrix.equals(IDENTITY)) return false;
  return !m.onBeforeRender || m.onBeforeRender === THREE.Object3D.prototype.onBeforeRender;
}
const IDENTITY = new THREE.Matrix4();

interface Piece {
  mesh: Mesh;
  /** kaynak üçgen indeksleri; null = tümü */
  tris: Uint32Array | null;
  /** köşe başına ek sabit öznitelikler (renk, katman) */
  extra?: Record<string, number[]>;
}

type AnyArray = Float32Array | Uint32Array | Uint16Array | Int32Array | Uint8Array | Int8Array | Int16Array;

/** Parçaları tek geometriye topla (yalnız kullanılan köşeler kopyalanır; tür dizileriyle, iki geçiş). */
function mergePieces(
  pieces: Piece[],
  attrs: string[],
  extraSizes: Record<string, number>,
): THREE.BufferGeometry {
  // 1. geçiş: parça başına köşe yeniden eşlemesi ve boyutlar
  const maps: Int32Array[] = [];
  const counts: number[] = [];
  let nv = 0;
  let ni = 0;
  for (const p of pieces) {
    const g = p.mesh.geometry;
    const idx = (g.index as THREE.BufferAttribute).array;
    const map = new Int32Array(g.attributes.position.count).fill(-1);
    let k = 0;
    const nt = p.tris ? p.tris.length : idx.length / 3;
    for (let q = 0; q < nt; q++) {
      const t = p.tris ? p.tris[q] : q;
      for (let j = 0; j < 3; j++) {
        const v = idx[t * 3 + j];
        if (map[v] < 0) map[v] = k++;
      }
    }
    maps.push(map);
    counts.push(k);
    nv += k;
    ni += nt * 3;
  }
  const out: Record<string, AnyArray> = {};
  for (const a of attrs) {
    const src = pieces[0].mesh.geometry.attributes[a] as THREE.BufferAttribute;
    const Ctor = (src.array as AnyArray).constructor as new (n: number) => AnyArray;
    out[a] = new Ctor(nv * src.itemSize);
  }
  for (const [e, sz] of Object.entries(extraSizes)) out[e] = new Float32Array(nv * sz);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  // 2. geçiş: kopya
  let base = 0;
  let io = 0;
  pieces.forEach((p, pi) => {
    const g = p.mesh.geometry;
    const idx = (g.index as THREE.BufferAttribute).array;
    const map = maps[pi];
    for (const a of attrs) {
      const at = g.attributes[a] as THREE.BufferAttribute;
      const sz = at.itemSize;
      const src = at.array as AnyArray;
      const dst = out[a];
      for (let v = 0; v < map.length; v++) {
        const n = map[v];
        if (n < 0) continue;
        const o = (base + n) * sz;
        for (let q = 0; q < sz; q++) dst[o + q] = src[v * sz + q];
      }
    }
    for (const [e, sz] of Object.entries(extraSizes)) {
      const src = (p.extra as Record<string, number[]>)[e];
      const dst = out[e];
      for (let n = 0; n < counts[pi]; n++) for (let q = 0; q < sz; q++) dst[(base + n) * sz + q] = src[q];
    }
    const nt = p.tris ? p.tris.length : idx.length / 3;
    for (let q = 0; q < nt; q++) {
      const t = p.tris ? p.tris[q] : q;
      for (let j = 0; j < 3; j++) index[io++] = base + map[idx[t * 3 + j]];
    }
    base += counts[pi];
  });
  const geo = new THREE.BufferGeometry();
  for (const a of attrs) {
    const src = pieces[0].mesh.geometry.attributes[a] as THREE.BufferAttribute;
    geo.setAttribute(a, new THREE.BufferAttribute(out[a], src.itemSize, src.normalized));
  }
  for (const [e, sz] of Object.entries(extraSizes))
    geo.setAttribute(e, new THREE.BufferAttribute(out[e], sz));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** Üçgenleri ağırlık merkezinin ızgara hücresine dağıt: "cx,cz" → üçgen listesi */
function trisByCell(g: THREE.BufferGeometry, cell: number): Map<string, Uint32Array> {
  const pos = g.attributes.position.array;
  const idx = (g.index as THREE.BufferAttribute).array;
  const n = idx.length / 3;
  const key = new Int32Array(n);
  const cnt = new Map<number, number>();
  for (let t = 0; t < n; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const cx = Math.floor((pos[a] + pos[b] + pos[c]) / 3 / cell);
    const cz = Math.floor((pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3 / cell);
    // ±32k hücre yeter (en küçük hücre 128 m)
    const k = ((cx + 32768) << 16) | (cz + 32768);
    key[t] = k;
    cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }
  const lists = new Map<number, { a: Uint32Array; n: number }>();
  for (const [k, c] of cnt) lists.set(k, { a: new Uint32Array(c), n: 0 });
  for (let t = 0; t < n; t++) {
    const l = lists.get(key[t]) as { a: Uint32Array; n: number };
    l.a[l.n++] = t;
  }
  const out = new Map<string, Uint32Array>();
  for (const [k, l] of lists) out.set(`${(k >>> 16) - 32768},${(k & 0xffff) - 32768}`, l.a);
  return out;
}

/**
 * 1. Gölge vekilleri: `meshes`'in gölge döken üçgenleri hücre × gölge yüzü başına konum geometrisine toplanır,
 * özgünler gölge dökmez. Vekil kökü `parent`'a eklenir (ebeveynin görünürlüğünü izler).
 */
export function buildShadowProxies(
  parent: THREE.Object3D,
  meshes: Mesh[],
  cell = SHADOW_CELL,
  name = 'mertkent-shadow',
): { casters: number; proxies: number } {
  const buckets = new Map<
    string,
    { side: THREE.Side; shadowSide: THREE.Side | null; pieces: Map<string, Piece[]> }
  >();
  let casters = 0;
  for (const m of meshes) {
    if (!m.castShadow) continue;
    const mat = m.material as THREE.MeshStandardMaterial;
    // derinlik malzemesini değiştiren durumlar (alfa testi, yer değiştirme, kırpma, özel derinlik) → olduğu gibi kalır
    if (!mat.visible || mat.wireframe || mat.alphaToCoverage) continue;
    if (mat.alphaTest > 0 && (mat.map || mat.alphaMap)) continue;
    if (mat.displacementMap && mat.displacementScale !== 0) continue;
    if (mat.clippingPlanes?.length) continue;
    if (m.customDepthMaterial || m.customDistanceMaterial) continue;
    const key = `${mat.side}|${mat.shadowSide}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { side: mat.side, shadowSide: mat.shadowSide, pieces: new Map() }));
    for (const [c, tris] of trisByCell(m.geometry, cell)) {
      let l = b.pieces.get(c);
      if (!l) b.pieces.set(c, (l = []));
      l.push({ mesh: m, tris });
    }
    m.castShadow = false;
    casters++;
  }
  const root = new THREE.Group();
  root.name = `${name}-proxies`;
  root.visible = false;
  let proxies = 0;
  for (const b of buckets.values()) {
    // Ana geçişte hiç çizilmez (kök görünmez); yalnız gölge derinliği → renk yazılmaz
    const mat = new THREE.MeshBasicMaterial({ side: b.side, colorWrite: false, depthWrite: false });
    mat.shadowSide = b.shadowSide;
    for (const [c, pieces] of b.pieces) {
      const g = mergePieces(pieces, ['position'], {});
      const pm = new THREE.Mesh(g, mat);
      pm.name = `${name} ${c}`;
      pm.castShadow = true;
      pm.receiveShadow = false;
      pm.matrixAutoUpdate = false;
      root.add(pm);
      proxies++;
    }
  }
  if (proxies) {
    parent.add(root);
    root.updateMatrixWorld(true);
    shadowOnlyRoots.add(root);
  }
  return { casters, proxies };
}

const RM_SKIP = new Set([...SKIP_PROPS, 'roughness', 'metalness']);
const RM_OK =
  (THREE.ShaderChunk as unknown as Record<string, string>).roughnessmap_fragment.includes(
    'float roughnessFactor = roughness;',
  ) &&
  (THREE.ShaderChunk as unknown as Record<string, string>).metalnessmap_fragment.includes(
    'float metalnessFactor = metalness;',
  ) &&
  (typeof location === 'undefined' || !new URLSearchParams(location.search).has('norm'));

/** Pürüzlülük / metallik çarpanı uniform yerine düz (flat) köşe özniteliğinden (aynı float32 değer) */
function patchRM(mat: THREE.MeshStandardMaterial): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) {
    prev.call(this, sh, r);
    const C = THREE.ShaderChunk as unknown as Record<string, string>;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 batchRM;\nflat varying vec2 vBatchRM;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvBatchRM = batchRM;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nflat varying vec2 vBatchRM;')
      .replace(
        '#include <roughnessmap_fragment>',
        C.roughnessmap_fragment.replace(
          'float roughnessFactor = roughness;',
          'float roughnessFactor = vBatchRM.x;',
        ),
      )
      .replace(
        '#include <metalnessmap_fragment>',
        C.metalnessmap_fragment.replace(
          'float metalnessFactor = metalness;',
          'float metalnessFactor = vBatchRM.y;',
        ),
      );
  };
  mat.customProgramCacheKey = function () {
    return `${prevKey.call(this)}|batchRM`;
  };
}

/** 2. Yalnız rengi (ve pürüzlülük / metalliği) farklı opak malzemeler → köşe öznitelikleri */
function mergeByColor(group: THREE.Group, meshes: Mesh[]): { merged: number; out: number; left: Mesh[] } {
  const groups = new Map<string, Mesh[]>();
  const left: Mesh[] = [];
  for (const m of meshes) {
    const mat = m.material as THREE.MeshStandardMaterial;
    const ps = patchSig(mat);
    const ok =
      !mat.transparent &&
      !mat.vertexColors &&
      mat.color instanceof THREE.Color &&
      !!ps?.vcSafe &&
      !m.geometry.attributes.color;
    if (!ok || !ps) {
      left.push(m);
      continue;
    }
    // MeshStandardMaterial: pürüzlülük / metallik de köşe başına (düz varyant, aynı float) → daha az grup
    const rm = !!(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial && ps.rmSafe && RM_OK;
    const k = `${matSig(mat, rm ? RM_SKIP : SKIP_PROPS)}#${ps.sig}#${meshSig(m)}#${rm ? 'rm' : ''}`;
    let l = groups.get(k);
    if (!l) groups.set(k, (l = []));
    l.push(m);
  }
  let merged = 0;
  let out = 0;
  for (const list of groups.values()) {
    if (list.length < 2) {
      left.push(...list);
      continue;
    }
    // eşit derinlikte (eş düzlemli) çakışmada özgün çizim sırası: malzeme kimliği sırası (three opak sıralaması)
    list.sort((a, b) => mid(a.material) - mid(b.material));
    const first = list[0];
    const mat = cloneWithPatch(first.material as THREE.MeshStandardMaterial);
    mat.color.setRGB(1, 1, 1);
    mat.vertexColors = true;
    mat.name = `${first.material.name || 'batch'}+vc`;
    const fm = first.material as THREE.MeshStandardMaterial;
    const rm =
      !!fm.isMeshStandardMaterial &&
      !!patchSig(fm)?.rmSafe &&
      RM_OK &&
      list.some((m) => {
        const q = m.material as THREE.MeshStandardMaterial;
        return q.roughness !== fm.roughness || q.metalness !== fm.metalness;
      });
    if (rm) patchRM(mat);
    const attrs = Object.keys(first.geometry.attributes);
    const cells = new Map<string, Piece[]>();
    for (const m of list) {
      const q = m.material as THREE.MeshStandardMaterial;
      const c = q.color;
      const extra: Record<string, number[]> = { color: [c.r, c.g, c.b] };
      if (rm) extra.batchRM = [q.roughness, q.metalness];
      for (const [cell, tris] of trisByCell(m.geometry, MAIN_CELL)) {
        let l = cells.get(cell);
        if (!l) cells.set(cell, (l = []));
        l.push({ mesh: m, tris, extra });
      }
    }
    for (const [cell, pieces] of cells) {
      const g = mergePieces(pieces, attrs, rm ? { color: 3, batchRM: 2 } : { color: 3 });
      const bm = new THREE.Mesh(g, mat);
      bm.name = `mertkent-batch vc ${cell}`;
      bm.userData.batchRank = mid(first.material);
      copyMeshState(first, bm);
      group.add(bm);
      out++;
    }
    for (const m of list) retire(group, m);
    merged += list.length;
  }
  return { merged, out, left };
}

function copyMeshState(src: Mesh, dst: THREE.Mesh): void {
  dst.castShadow = src.castShadow;
  dst.receiveShadow = src.receiveShadow;
  dst.renderOrder = src.renderOrder;
  dst.frustumCulled = src.frustumCulled;
  dst.layers.mask = src.layers.mask;
  dst.matrixAutoUpdate = false;
  dst.updateMatrix();
}

function retire(group: THREE.Group, m: Mesh): void {
  group.remove(m);
  m.geometry.dispose();
}

/** Tuval dokusu → RGBA baytları (dizi katmanı için; flipY yüklemesini taklit ederek satırlar ters) */
function canvasBytes(t: THREE.Texture, out: Uint8Array, offset: number): boolean {
  const img = t.image as HTMLCanvasElement | undefined;
  if (!img || typeof img.getContext !== 'function') return false;
  const ctx = img.getContext('2d');
  if (!ctx) return false;
  const w = img.width;
  const h = img.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    const sy = t.flipY ? h - 1 - y : y;
    out.set(d.subarray(sy * row, sy * row + row), offset + y * row);
  }
  return true;
}

/**
 * Doku içerik özeti (normal haritası eşitliği için): üç 64² bölgenin baytları. Aynı tohumlu grenli sıva normal
 * haritaları bayt bayt aynı; farklı tohumlar her yerde farklı (rastgele tane alanı) → örnek bölgeler yeterli.
 */
function contentHash(t: THREE.Texture): string | null {
  const img = t.image as HTMLCanvasElement | undefined;
  if (!img || typeof img.getContext !== 'function') return null;
  const ctx = img.getContext('2d');
  if (!ctx) return null;
  const w = img.width;
  const h = img.height;
  const S = Math.min(64, w, h);
  let hs = `${w}x${h}`;
  for (const [x, y] of [
    [0, 0],
    [(w - S) >> 1, (h - S) >> 1],
    [w - S, h - S],
  ]) {
    const d = new Uint32Array(ctx.getImageData(x, y, S, S).data.buffer);
    hs += `:${hashWords(d)}`;
  }
  return hs;
}

function hashWords(d: ArrayLike<number>): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1234567;
  for (let i = 0; i < d.length; i++) {
    h1 = Math.imul(h1 ^ d[i], 16777619);
    h2 = Math.imul(h2 + d[i], 2246822519) ^ (h2 >>> 13);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

/** Uzun imza metnini kısa anahtara indir (Map anahtarı; 64 bit + uzunluk) */
function hashStr(t: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1234567;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13);
  }
  return `${t.length}:${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

// renk bu birleştirmede imzada kalır (dizi yalnız map'i değiştirir)
const GRAN_SKIP = new Set([...SKIP_PROPS, 'map', 'normalMap', 'emissiveMap']);
GRAN_SKIP.delete('color');

/**
 * 3. Doku dizisi: yalnız `map`'i (renk işlenmiş tuval dokusu: grenli sıva, kiremit, tabela atlası sayfası) farklı
 * malzemeler. normalMap içerikçe aynı olmalı; emissiveMap yoksa ya da map'in kendisiyse (tabela) diziden örneklenir.
 */
function mergeGranular(group: THREE.Group, meshes: Mesh[]): { merged: number; out: number } {
  const groups = new Map<string, Mesh[]>();
  const nHash = new Map<THREE.Texture, string | null>();
  for (const m of meshes) {
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat.isMeshStandardMaterial || mat.transparent || mat.vertexColors) continue;
    const map = mat.map;
    const nm = mat.normalMap;
    if (!map || !(map as THREE.CanvasTexture).isCanvasTexture) continue;
    if (mat.emissiveMap && mat.emissiveMap !== map) continue;
    // alfa testli döküm: gölge derinlik malzemesi map'i kendisi örnekler (katman bilmez) → birleştirilmez
    if (mat.alphaTest > 0 && m.castShadow) continue;
    if (m.geometry.attributes.granLayer) continue;
    const img = map.image as HTMLCanvasElement;
    if (!img?.width || typeof img.getContext !== 'function') continue;
    let nh = 'none';
    if (nm) {
      if (!nHash.has(nm)) nHash.set(nm, contentHash(nm));
      const h = nHash.get(nm);
      if (!h) continue;
      nh = `${texParams(nm)}:${h}`;
    }
    // Özel gölgelendirici (ör. ultraWeather) aynı çıktıyı vermeli ve map'i yalnız map/emissive parçasında örneklemeli
    const ps = patchSig(mat);
    if (!ps?.mapSafe || (mat.emissiveMap && !ps.emissiveSafe)) continue;
    const k = [
      matSig(mat, GRAN_SKIP),
      ps.sig,
      `map:${texParams(map)}:${img.width}x${img.height}`,
      `em:${mat.emissiveMap ? 'map' : 'none'}`,
      `nm:${nh}`,
      meshSig(m),
    ].join('#');
    let l = groups.get(k);
    if (!l) groups.set(k, (l = []));
    l.push(m);
  }
  let merged = 0;
  let out = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // katman = farklı renk dokusu (aynı dokuyu kullanan malzemeler aynı katman)
    const layersAll: THREE.Texture[] = [];
    const layerOf = new Map<THREE.Texture, number>();
    for (const m of list) {
      const t = (m.material as THREE.MeshStandardMaterial).map as THREE.Texture;
      if (!layerOf.has(t)) {
        layerOf.set(t, layersAll.length);
        layersAll.push(t);
      }
    }
    for (let s = 0; s < layersAll.length; s += MAX_LAYERS) {
      const slice = layersAll.slice(s, s + MAX_LAYERS);
      const sub = list.filter((m) => {
        const L = layerOf.get((m.material as THREE.MeshStandardMaterial).map as THREE.Texture) as number;
        return L >= s && L < s + MAX_LAYERS;
      });
      if (sub.length < 2) continue;
      sub.sort((a, b) => mid(a.material) - mid(b.material));
      const first = sub[0];
      const fm = first.material as THREE.MeshStandardMaterial;
      const w = (slice[0].image as HTMLCanvasElement).width;
      const h = (slice[0].image as HTMLCanvasElement).height;
      const data = new Uint8Array(w * h * 4 * slice.length);
      let okAll = true;
      slice.forEach((t, i) => {
        if (!canvasBytes(t, data, i * w * h * 4)) okAll = false;
      });
      if (!okAll) continue;
      const arr = new THREE.DataArrayTexture(data, w, h, slice.length);
      const t0 = slice[0];
      arr.format = THREE.RGBAFormat;
      arr.type = THREE.UnsignedByteType;
      arr.colorSpace = t0.colorSpace;
      arr.wrapS = t0.wrapS;
      arr.wrapT = t0.wrapT;
      arr.magFilter = t0.magFilter;
      arr.minFilter = t0.minFilter;
      arr.anisotropy = t0.anisotropy;
      arr.generateMipmaps = t0.generateMipmaps;
      arr.flipY = false;
      arr.unpackAlignment = 4;
      arr.needsUpdate = true;
      // Yüklendikten sonra CPU kopyası bırakılır (~1 MB / katman)
      arr.onUpdate = () => {
        (arr.image as { data: Uint8Array | null }).data = null;
      };
      const mat = cloneWithPatch(fm);
      const emissive = !!fm.emissiveMap;
      const prevOBC = fm.onBeforeCompile;
      const prevKey = fm.customProgramCacheKey.bind(fm);
      // maxAnisotropy (game.ts) malzeme özelliklerindeki dokuları gezer → dizi de en yüksek süzgeci alır
      (mat as unknown as { granArray: THREE.Texture }).granArray = arr;
      const uArr = { value: arr };
      mat.onBeforeCompile = function (sh, r) {
        prevOBC.call(this, sh, r);
        sh.uniforms.uGranArr = uArr;
        sh.vertexShader = sh.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nattribute float granLayer;\nflat varying float vGranLayer;',
          )
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGranLayer = granLayer;');
        sh.fragmentShader = sh.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform highp sampler2DArray uGranArr;\nflat varying float vGranLayer;',
          )
          .replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture( uGranArr, vec3( vMapUv, vGranLayer ) );
  diffuseColor *= sampledDiffuseColor;
#endif`,
          );
        if (emissive)
          sh.fragmentShader = sh.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture( uGranArr, vec3( vEmissiveMapUv, vGranLayer ) );
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,
          );
      };
      mat.customProgramCacheKey = () => `${prevKey()}|granArr${emissive ? 'E' : ''}`;
      mat.name = `${fm.name || 'granular'}+arr`;
      const attrs = Object.keys(first.geometry.attributes);
      const cells = new Map<string, Piece[]>();
      for (const m of sub) {
        const L =
          (layerOf.get((m.material as THREE.MeshStandardMaterial).map as THREE.Texture) as number) - s;
        const extra = { granLayer: [L] };
        for (const [cell, tris] of trisByCell(m.geometry, MAIN_CELL)) {
          let l = cells.get(cell);
          if (!l) cells.set(cell, (l = []));
          l.push({ mesh: m, tris, extra });
        }
      }
      for (const [cell, pieces] of cells) {
        const g = mergePieces(pieces, attrs, { granLayer: 1 });
        const bm = new THREE.Mesh(g, mat);
        bm.name = `mertkent-batch gran ${cell}`;
        bm.userData.batchRank = mid(first.material);
        copyMeshState(first, bm);
        group.add(bm);
        out++;
      }
      for (const m of sub) retire(group, m);
      merged += sub.length;
    }
  }
  return { merged, out };
}

/**
 * Aynı malzeme nesnesini paylaşan düz meshleri (ör. OSM parçaları) tek meshe topla: malzeme, öznitelikler ve üçgenler
 * aynı; yalnız çizim çağrısı sayısı düşer. Sonuç `parent`'a eklenir, kaynaklar ebeveynlerinden çıkarılır.
 */
export function mergeSameMaterial(meshes: Mesh[], parent: THREE.Object3D, name: string): number {
  const groups = new Map<string, Mesh[]>();
  for (const m of meshes) {
    const k = `${m.material.uuid}#${meshSig(m)}`;
    let l = groups.get(k);
    if (!l) groups.set(k, (l = []));
    l.push(m);
  }
  let out = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const pieces = list.map((m) => ({
      mesh: m,
      tris: null,
    }));
    const g = mergePieces(pieces, Object.keys(first.geometry.attributes), {});
    const bm = new THREE.Mesh(g, first.material);
    bm.name = `${name} ${first.name}`;
    copyMeshState(first, bm);
    parent.add(bm);
    for (const m of list) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    out++;
  }
  return out;
}

/**
 * three opak nesneleri önce malzeme kimliğine (oluşturma sırası) göre çizer; eş düzlemli yüzlerde eşit derinlikte sonra
 * çizilen kazanır. Birleşik malzemeler yeni (büyük kimlikli) olduğu için bu sırayı bozardı (ör. panel önündeki sıva
 * beneklenir). Grup içindeki tüm ana geçiş malzemeleri özgün sıraya göre (birleşik: en küçük kaynak kimliği) yeniden
 * klonlanır → kimlik sırası özgün sırayı izler. Grup dışında da kullanılan malzemeler (ör. OSM yol dolgusu) olduğu gibi.
 */
function restoreDrawOrder(group: THREE.Group): number {
  const inside = new Set<THREE.Object3D>();
  group.traverse((o) => inside.add(o));
  const external = new Set<THREE.Material>();
  let root: THREE.Object3D = group;
  while (root.parent) root = root.parent;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || inside.has(o)) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) external.add(x);
  });
  const items: { mesh: THREE.Mesh; rank: number }[] = [];
  for (const o of group.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) continue;
    const mat = m.material as THREE.Material;
    items.push({ mesh: m, rank: (m.userData.batchRank as number | undefined) ?? mid(mat) });
  }
  items.sort((a, b) => a.rank - b.rank);
  const re = new Map<THREE.Material, THREE.Material>();
  for (const { mesh } of items) {
    const mat = mesh.material as THREE.Material;
    if (external.has(mat)) continue;
    let c = re.get(mat);
    if (!c) {
      c = cloneWithPatch(mat);
      const arr = (mat as unknown as { granArray?: THREE.Texture }).granArray;
      if (arr) (c as unknown as { granArray: THREE.Texture }).granArray = arr;
      re.set(mat, c);
    }
    mesh.material = c;
  }
  return re.size;
}

export function batchHandModel(group: THREE.Group): BatchStats {
  const t0 = performance.now();
  group.updateMatrixWorld(true);
  const all = group.children.filter(plain);
  const before = group.children.length;
  const sh = buildShadowProxies(group, all);
  const t1 = performance.now();
  const col = mergeByColor(group, all);
  const t2 = performance.now();
  const gran = mergeGranular(group, col.left);
  restoreDrawOrder(group);
  const t3 = performance.now();
  return {
    phaseMs: [t1 - t0, t2 - t1, t3 - t2],
    meshesBefore: before,
    meshesAfter: group.children.length,
    shadowCastersBefore: sh.casters,
    shadowProxies: sh.proxies,
    colorMerged: col.merged,
    colorMeshes: col.out,
    granMerged: gran.merged,
    granMeshes: gran.out,
    ms: performance.now() - t0,
  };
}
