/**
 * Pişirilmiş dolaylı ışık (docs/BAKE.md) için ortak geometri işlemleri: 100 m parçalara (chunk) bölme,
 * parça imzası ve **deterministik ışık haritası UV'si (uv1)**.
 *
 * KARAR (BAKE.md'den sapma, gerekçesi orada): uv1 Blender'da Lightmap Pack ile değil burada üretilir. Aynı kod hem
 * dışa aktarmada (`?bakeexport=1`) hem oyunda çalışır; oyun geometrisi kendisi üretildiği için yayında yalnızca AO
 * dokuları taşınır (1.9 M üçgenlik geometri GLB'si ~100 MB olurdu), `aux` gibi özel öznitelikler ve malzeme
 * gölgelendiricileri aynen korunur. Tüm kararlar mm'ye yuvarlanmış tamsayı konumlardan ve yalnızca IEEE-kesin
 * işlemlerle (+ − × ÷ √) verilir → tarayıcılar arasında aynı sonuç; konum 1 mm bile değişirse parça imzası tutmaz ve
 * o parça pişirmesiz (canlı) çizilir.
 */
import type * as THREE from 'three';

/** Parça kenarı (m) */
export const BAKE_CHUNK = 100;
/** Hat sürümü: uv1 algoritması değişirse artır (manifest ile eşleşmeli) */
export const BAKE_UV_VERSION = 1;

export interface BakeSource {
  key: string;
  geometry: THREE.BufferGeometry;
}

export interface ChunkPart {
  /** `sources` dizisindeki sıra */
  src: number;
  /** Kaynak geometrideki üçgen sıraları */
  tris: Uint32Array;
}

export interface BakeChunk {
  id: string;
  cx: number;
  cz: number;
  parts: ChunkPart[];
}

export interface UnwrapOptions {
  /** Hedef doku yoğunluğu (m/px) */
  texel: number;
  /** Ada payı (px) */
  pad: number;
  /** Parça atlasının en büyük kenarı (px, 2'nin kuvveti) */
  maxAtlas: number;
}

export const DEFAULT_UNWRAP: UnwrapOptions = { texel: 0.08, pad: 1, maxAtlas: 4096 };

export interface UnwrappedPart {
  /** Yeni köşe → kaynak köşe sırası (öznitelikler buradan kopyalanır) */
  vmap: Uint32Array;
  /** Atlas uv'si 0..1 (glTF kuralı: v=0 görüntünün üstü) */
  uv1: Float32Array;
  /** Yeni köşelere göre üçgen dizini */
  index: Uint32Array;
}

export interface UnwrapResult {
  /** Atlas kenarı (px) */
  size: number;
  /** Kullanılan gerçek yoğunluk (m/px; atlas sığmazsa büyür) */
  texel: number;
  parts: UnwrappedPart[];
  charts: number;
  /**
   * Ada dikdörtgenleri (atlas px, üstten): ada başına [x, y, w, h, n_yukarı]. Pişirmede açık alan değeri E0(n) için
   * normal pişirmesi yerine kullanılır (ada düzlemseldir, normal farkı < ~10°).
   */
  rects: Float32Array;
  /** Adaların kapladığı piksel oranı (pay ve boşluk hariç) */
  fill: number;
}

const Q = 1000; // mm

function qv(
  a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  i: number,
  out: Int32Array,
  o: number,
) {
  out[o] = Math.round(a.getX(i) * Q);
  out[o + 1] = Math.round(a.getY(i) * Q);
  out[o + 2] = Math.round(a.getZ(i) * Q);
}

function triCount(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}

function vid(g: THREE.BufferGeometry, t: number, k: number): number {
  return g.index ? g.index.getX(t * 3 + k) : t * 3 + k;
}

/** Kaynakları anahtar adına göre sırala (dışa aktarma ve oyun aynı sırayı kullanır) */
export function sortSources(s: BakeSource[]): BakeSource[] {
  return [...s].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Üçgenleri ağırlık merkezinin düştüğü 100 m parçaya ata. Sonuç id sırasına göre. */
export function splitChunks(sources: BakeSource[]): BakeChunk[] {
  const map = new Map<string, { cx: number; cz: number; lists: Map<number, number[]> }>();
  const qp = new Int32Array(9);
  const C = BAKE_CHUNK * Q * 3;
  sources.forEach((s, si) => {
    const g = s.geometry;
    const p = g.attributes.position;
    const n = triCount(g);
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) qv(p, vid(g, t, k), qp, k * 3);
      const cx = Math.floor((qp[0] + qp[3] + qp[6]) / C);
      const cz = Math.floor((qp[2] + qp[5] + qp[8]) / C);
      const id = `${cx}_${cz}`;
      let c = map.get(id);
      if (!c) map.set(id, (c = { cx, cz, lists: new Map() }));
      let l = c.lists.get(si);
      if (!l) c.lists.set(si, (l = []));
      l.push(t);
    }
  });
  return [...map.entries()]
    .sort((a, b) => a[1].cz - b[1].cz || a[1].cx - b[1].cx)
    .map(([id, c]) => ({
      id,
      cx: c.cx,
      cz: c.cz,
      parts: [...c.lists.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([src, l]) => ({ src, tris: Uint32Array.from(l) })),
    }));
}

/** Parça imzası: anahtar adları + mm'ye yuvarlanmış üçgen köşeleri (sıraya duyarlı, 2×32 bit FNV-1a) */
export function chunkSignature(chunk: BakeChunk, sources: BakeSource[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  const mix = (v: number) => {
    h1 = Math.imul(h1 ^ (v & 0xffff), 0x01000193);
    h1 = Math.imul(h1 ^ (v >>> 16), 0x01000193);
    h2 = Math.imul(h2 ^ v, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  };
  const qp = new Int32Array(3);
  for (const part of chunk.parts) {
    const s = sources[part.src];
    for (let i = 0; i < s.key.length; i++) mix(s.key.charCodeAt(i));
    mix(part.tris.length);
    const g = s.geometry;
    const p = g.attributes.position;
    for (const t of part.tris)
      for (let k = 0; k < 3; k++) {
        qv(p, vid(g, t, k), qp, 0);
        mix(qp[0]);
        mix(qp[1]);
        mix(qp[2]);
      }
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

interface Chart {
  part: number;
  /** yeni köşe sıraları (parça içi) */
  verts: number[];
  /** yerel koordinatlar (m), köşe başına 2 */
  st: number[];
  w: number;
  h: number;
  /** ada normalinin yukarı bileşeni */
  up: number;
}

/**
 * Bir parçadaki tüm meshler için ortak atlas: aynı düzlemdeki bitişik üçgenler (konuma göre kaynaklanmış kenarlar,
 * normal farkı < ~10°) tek ada olur, adalar düzlemlerine izdüşürülür, raf (shelf) paketlemesiyle yerleştirilir.
 * Çok küçük adalar 4×4 px hücreye esnetilir (en az bir piksel merkezi örtülsün diye).
 */
export function unwrapChunk(
  chunk: BakeChunk,
  sources: BakeSource[],
  opts: UnwrapOptions = DEFAULT_UNWRAP,
): UnwrapResult {
  const charts: Chart[] = [];
  const partVerts: { vmap: number[]; index: number[] }[] = [];
  chunk.parts.forEach((part, pi) => {
    const g = sources[part.src].geometry;
    const p = g.attributes.position;
    const nT = part.tris.length;
    // Köşeler (mm) ve konum kaynaklama
    const corner = new Int32Array(nT * 9);
    const canon = new Int32Array(nT * 3);
    const weld = new Map<string, number>();
    for (let i = 0; i < nT; i++)
      for (let k = 0; k < 3; k++) {
        qv(p, vid(g, part.tris[i], k), corner, i * 9 + k * 3);
        const o = i * 9 + k * 3;
        const key = `${corner[o]},${corner[o + 1]},${corner[o + 2]}`;
        let c = weld.get(key);
        if (c === undefined) weld.set(key, (c = weld.size));
        canon[i * 3 + k] = c;
      }
    // Yüz normalleri
    const nrm = new Float64Array(nT * 3);
    const ok = new Uint8Array(nT);
    for (let i = 0; i < nT; i++) {
      const o = i * 9;
      const ax = corner[o + 3] - corner[o];
      const ay = corner[o + 4] - corner[o + 1];
      const az = corner[o + 5] - corner[o + 2];
      const bx = corner[o + 6] - corner[o];
      const by = corner[o + 7] - corner[o + 1];
      const bz = corner[o + 8] - corner[o + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l > 0) {
        nrm[i * 3] = nx / l;
        nrm[i * 3 + 1] = ny / l;
        nrm[i * 3 + 2] = nz / l;
        ok[i] = 1;
      }
    }
    // Kenar → üçgen bağlantısı
    const edgeHead = new Map<number, number>();
    const edgeNext = new Int32Array(nT * 3).fill(-1);
    const M = weld.size + 1;
    const ekey = (a: number, b: number) => (a < b ? a * M + b : b * M + a);
    for (let s = 0; s < nT * 3; s++) {
      const i = (s / 3) | 0;
      const k = s % 3;
      const e = ekey(canon[i * 3 + k], canon[i * 3 + ((k + 1) % 3)]);
      const h = edgeHead.get(e);
      if (h !== undefined) edgeNext[s] = h;
      edgeHead.set(e, s);
    }
    const seen = new Uint8Array(nT);
    const lastChart = new Int32Array(g.attributes.position.count).fill(-1);
    const newIdx = new Int32Array(g.attributes.position.count);
    const pv = { vmap: [] as number[], index: [] as number[] };
    partVerts.push(pv);
    const queue: number[] = [];
    for (let seed = 0; seed < nT; seed++) {
      if (seen[seed]) continue;
      seen[seed] = 1;
      const members = [seed];
      if (ok[seed]) {
        const sx = nrm[seed * 3];
        const sy = nrm[seed * 3 + 1];
        const sz = nrm[seed * 3 + 2];
        queue.length = 0;
        queue.push(seed);
        while (queue.length) {
          const i = queue.pop() as number;
          for (let k = 0; k < 3; k++) {
            const e = ekey(canon[i * 3 + k], canon[i * 3 + ((k + 1) % 3)]);
            for (let s = edgeHead.get(e) as number; s >= 0; s = edgeNext[s]) {
              const j = (s / 3) | 0;
              if (seen[j] || !ok[j]) continue;
              if (nrm[j * 3] * sx + nrm[j * 3 + 1] * sy + nrm[j * 3 + 2] * sz < 0.985) continue;
              seen[j] = 1;
              members.push(j);
              queue.push(j);
            }
          }
        }
      }
      members.sort((a, b) => a - b);
      // İzdüşüm tabanı
      let nx = 0;
      let ny = 1;
      let nz = 0;
      if (ok[seed]) {
        nx = nrm[seed * 3];
        ny = nrm[seed * 3 + 1];
        nz = nrm[seed * 3 + 2];
      }
      let ux: number;
      let uy: number;
      let uz: number;
      if (ny > 0.7 || ny < -0.7) {
        // Yataya yakın: u = adanın en uzun kenarı (düzleme izdüşmüş) → döndürülmüş alanlarda boşluk az
        let best = -1;
        ux = 1;
        uy = 0;
        uz = 0;
        for (const i of members)
          for (let k = 0; k < 3; k++) {
            const o = i * 9 + k * 3;
            const o2 = i * 9 + ((k + 1) % 3) * 3;
            const dx = corner[o2] - corner[o];
            const dy = corner[o2 + 1] - corner[o + 1];
            const dz = corner[o2 + 2] - corner[o + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > best) {
              best = d2;
              ux = dx;
              uy = dy;
              uz = dz;
            }
          }
        const dn = ux * nx + uy * ny + uz * nz;
        ux -= dn * nx;
        uy -= dn * ny;
        uz -= dn * nz;
      } else {
        // Dikeye yakın: u yatay (duvar boyunca) = yukarı × n
        ux = nz;
        uy = 0;
        uz = -nx;
      }
      let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (!(ul > 1e-9)) {
        ux = 1;
        uy = 0;
        uz = 0;
        ul = 1;
      }
      ux /= ul;
      uy /= ul;
      uz /= ul;
      // v = n × u
      const vx = ny * uz - nz * uy;
      const vy = nz * ux - nx * uz;
      const vz = nx * uy - ny * ux;
      const ci = charts.length;
      const ch: Chart = { part: pi, verts: [], st: [], w: 0, h: 0, up: ny };
      let u0 = Infinity;
      let v0 = Infinity;
      let u1 = -Infinity;
      let v1 = -Infinity;
      for (const i of members) {
        const t = part.tris[i];
        for (let k = 0; k < 3; k++) {
          const ov = vid(g, t, k);
          if (lastChart[ov] !== ci) {
            lastChart[ov] = ci;
            newIdx[ov] = pv.vmap.length;
            pv.vmap.push(ov);
            const o = i * 9 + k * 3;
            const X = corner[o] / Q;
            const Y = corner[o + 1] / Q;
            const Z = corner[o + 2] / Q;
            const su = X * ux + Y * uy + Z * uz;
            const sv = X * vx + Y * vy + Z * vz;
            ch.verts.push(newIdx[ov]);
            ch.st.push(su, sv);
            if (su < u0) u0 = su;
            if (su > u1) u1 = su;
            if (sv < v0) v0 = sv;
            if (sv > v1) v1 = sv;
          }
          pv.index.push(newIdx[ov]);
        }
      }
      for (let k = 0; k < ch.st.length; k += 2) {
        ch.st[k] -= u0;
        ch.st[k + 1] -= v0;
      }
      ch.w = u1 - u0;
      ch.h = v1 - v0;
      charts.push(ch);
    }
  });

  // Paketleme. KARAR: atlas kenarı iki katına çıkmadan önce yoğunluk hedefin 1.25 katına kadar gevşetilir
  // (4096²'ye %20 dolulukla sıçramak yerine 2048²'de 9–10 cm/px); en büyük atlasta sığana kadar büyür.
  const layout = (tx: number) => {
    const d = new Int32Array(charts.length * 2);
    const tf = new Uint8Array(charts.length);
    let area = 0;
    charts.forEach((c, i) => {
      const w = Math.ceil(c.w / tx);
      const h = Math.ceil(c.h / tx);
      const tiny = w <= 2 && h <= 2;
      tf[i] = tiny ? 1 : 0;
      // 4 px ızgarasına hizalı dikdörtgenler: mip 0–2 seviyelerinde adalar birbirine karışmaz (gizli yüzlerin siyahı
      // uzakta görünen yüzlere sızmaz)
      d[i * 2] = tiny ? 4 : (Math.max(1, w) + 2 * opts.pad + 3) & ~3;
      d[i * 2 + 1] = tiny ? 4 : (Math.max(1, h) + 2 * opts.pad + 3) & ~3;
      area += d[i * 2] * d[i * 2 + 1];
    });
    return { d, tf, area };
  };
  let texel = opts.texel;
  let size = 0;
  let place: Int32Array = new Int32Array(0);
  let dimsF: Int32Array = new Int32Array(0);
  let tinyF = new Uint8Array(0);
  const tryFit = (S: number, tx: number): boolean => {
    const l = layout(tx);
    if (l.area > S * S) return false;
    const r = shelfPack(l.d, S);
    if (!r) return false;
    place = r;
    dimsF = l.d;
    tinyF = l.tf;
    size = S;
    texel = tx;
    return true;
  };
  let S = 64;
  const a0 = layout(opts.texel).area;
  while (S * S < a0 && S < opts.maxAtlas) S *= 2;
  search: for (; S <= opts.maxAtlas; S *= 2)
    for (const f of [1, 1.12, 1.25]) if (tryFit(S, opts.texel * f)) break search;
  for (let k = 0, tx = opts.texel * 1.25; !size && k < 40; k++) {
    tx *= 1.12;
    tryFit(opts.maxAtlas, tx);
  }
  if (!size) throw new Error(`bake: parça ${chunk.id} atlasa sığmadı`);

  // uv1
  const parts: UnwrappedPart[] = partVerts.map((pv) => ({
    vmap: Uint32Array.from(pv.vmap),
    uv1: new Float32Array(pv.vmap.length * 2),
    index: Uint32Array.from(pv.index),
  }));
  charts.forEach((c, i) => {
    const uv = parts[c.part].uv1;
    const px = place[i * 2];
    const py = place[i * 2 + 1];
    const tiny = tinyF[i] === 1;
    // Piksel uzayı ölçeği: küçük adalar 3 px'e esnetilir; ince kenarlar en az 1 px
    const sx = tiny ? 3 / Math.max(c.w, 1e-6) : c.w / texel < 1 ? 1 / Math.max(c.w, 1e-6) : 1 / texel;
    const sy = tiny ? 3 / Math.max(c.h, 1e-6) : c.h / texel < 1 ? 1 / Math.max(c.h, 1e-6) : 1 / texel;
    const ox = px + (tiny ? 0.5 : opts.pad);
    const oy = py + (tiny ? 0.5 : opts.pad);
    for (let k = 0; k < c.verts.length; k++) {
      const v = c.verts[k];
      uv[v * 2] = (ox + c.st[k * 2] * sx) / size;
      uv[v * 2 + 1] = (oy + c.st[k * 2 + 1] * sy) / size;
    }
  });
  const rects = new Float32Array(charts.length * 5);
  let used = 0;
  charts.forEach((c, i) => {
    rects.set([place[i * 2], place[i * 2 + 1], dimsF[i * 2], dimsF[i * 2 + 1], c.up], i * 5);
    used += tinyF[i] ? 9 : Math.max(1, Math.ceil(c.w / texel)) * Math.max(1, Math.ceil(c.h / texel));
  });
  return { size, texel, parts, charts: charts.length, rects, fill: used / (size * size) };
}

/** Raf paketleme (yüksekliğe göre azalan, kararlı). Sığmazsa null. */
function shelfPack(dims: Int32Array, S: number): Int32Array | null {
  const n = dims.length / 2;
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => dims[b * 2 + 1] - dims[a * 2 + 1] || dims[b * 2] - dims[a * 2] || a - b);
  const out = new Int32Array(n * 2);
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const i of order) {
    const w = dims[i * 2];
    const h = dims[i * 2 + 1];
    if (w > S) return null;
    if (x + w > S) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    if (y + h > S) return null;
    out[i * 2] = x;
    out[i * 2 + 1] = y;
    x += w;
    if (h > rowH) rowH = h;
  }
  return out;
}
