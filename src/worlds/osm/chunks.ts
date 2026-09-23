/**
 * 200 m × 200 m chunk'lar; her chunk'ta malzeme başına tek birleştirilmiş geometri.
 * KARAR: Geometri doğrudan malzeme kovalarında biriktirilir (mergeGeometries'e eşdeğer, daha az bellek kopyası).
 */
// KARAR: Gerçek veride 200 m chunk ~440 draw call veriyordu; 400 m ile hedef < 300.
export const CHUNK_SIZE = 400;

export type MatKey =
  | 'wall'
  | 'roof'
  | 'roofTile'
  | 'detail'
  | 'landLow'
  | 'landHigh'
  | 'pitch'
  | 'water'
  | 'roadMinor'
  | 'roadMajor'
  | 'footway'
  | 'marking'
  | 'sidewalk'
  | 'rail'
  | 'barrier';

export const MAT_KEYS: MatKey[] = [
  'wall',
  'roof',
  'roofTile',
  'detail',
  'landLow',
  'landHigh',
  'pitch',
  'water',
  'roadMinor',
  'roadMajor',
  'footway',
  'marking',
  'sidewalk',
  'rail',
  'barrier',
];

export class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  /** Yalnızca 'wall': (varyant, dükkan varyantı, duvar üstü, parapet). */
  fac: number[] = [];
  idx: number[] = [];

  constructor(readonly facade = false) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  v(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    w: number,
    c: Rgb,
    f?: readonly number[],
  ): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    this.col.push(c[0], c[1], c[2]);
    if (this.facade) {
      if (f) this.fac.push(f[0], f[1], f[2], f[3]);
      else this.fac.push(0, -1, 1000, 0);
    }
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Düz gölgeli üçgen (normal hesaplanır; `up` true ise normal yukarı bakacak şekilde çevrilir). */
  flatTri(p: V3, q: V3, r: V3, c: Rgb, up = false, uvScale = 1): void {
    const ux = q[0] - p[0];
    const uy = q[1] - p[1];
    const uz = q[2] - p[2];
    const vx = r[0] - p[0];
    const vy = r[1] - p[1];
    const vz = r[2] - p[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    let a = p;
    let b = q;
    if (up && ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
      a = q;
      b = p;
    }
    const i0 = this.v(a[0], a[1], a[2], nx, ny, nz, a[0] * uvScale, a[2] * uvScale, c);
    const i1 = this.v(b[0], b[1], b[2], nx, ny, nz, b[0] * uvScale, b[2] * uvScale, c);
    const i2 = this.v(r[0], r[1], r[2], nx, ny, nz, r[0] * uvScale, r[2] * uvScale, c);
    this.tri(i0, i1, i2);
  }
}

export type Rgb = readonly [number, number, number];
export type V3 = readonly [number, number, number];

export interface ChunkPayload {
  cx: number;
  cz: number;
  mat: MatKey;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  facade?: Float32Array;
  index: Uint32Array;
}

export class ChunkedGeometry {
  private readonly map = new Map<string, { cx: number; cz: number; buckets: Map<MatKey, Bucket> }>();

  static chunkOf(x: number, z: number): [number, number] {
    return [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
  }

  get(x: number, z: number, mat0: MatKey): Bucket {
    // Küçük "donatı" malzemeleri (çatı detayı, ray, duvar/çit) tek malzemede birleşir.
    const mat: MatKey = mat0 === 'rail' || mat0 === 'barrier' ? 'detail' : mat0;
    const [cx, cz] = ChunkedGeometry.chunkOf(x, z);
    const key = `${cx},${cz}`;
    let ch = this.map.get(key);
    if (!ch) this.map.set(key, (ch = { cx, cz, buckets: new Map() }));
    let b = ch.buckets.get(mat);
    if (!b) ch.buckets.set(mat, (b = new Bucket(mat === 'wall')));
    return b;
  }

  /** Transfer edilebilir tipli dizilere çevirir. */
  toPayload(): ChunkPayload[] {
    const out: ChunkPayload[] = [];
    for (const ch of this.map.values()) {
      for (const [mat, b] of ch.buckets) {
        if (!b.idx.length) continue;
        out.push({
          cx: ch.cx,
          cz: ch.cz,
          mat,
          position: new Float32Array(b.pos),
          normal: new Float32Array(b.nor),
          uv: new Float32Array(b.uv),
          color: new Float32Array(b.col),
          facade: b.facade ? new Float32Array(b.fac) : undefined,
          index: new Uint32Array(b.idx),
        });
      }
    }
    return out;
  }
}

/** Deterministik 32-bit hash (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Tohumlu rastgele sayı üreteci (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: number): Rgb {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** CSS renk adı / #hex → Rgb (bilinmiyorsa null). */
export function parseColour(v: string | undefined): Rgb | null {
  if (!v) return null;
  const named: Record<string, number> = {
    white: 0xf2f0ea,
    beige: 0xdcc9a3,
    cream: 0xeee2c4,
    yellow: 0xe8d38a,
    orange: 0xd99a5b,
    red: 0xa9473a,
    brown: 0x8a6448,
    grey: 0x9a9a98,
    gray: 0x9a9a98,
    lightgrey: 0xc4c4c0,
    darkgrey: 0x5e5e5c,
    pink: 0xe2b0a4,
    blue: 0x7f9bb8,
    green: 0x8fa77e,
    black: 0x333333,
  };
  const s = v.trim().toLowerCase();
  if (named[s] !== undefined) return hexToRgb(named[s]);
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return hexToRgb(parseInt(h, 16));
}

/** Cephe atlası düzeni: 4×4 karo; 0–11 konut cepheleri (11 = sade/küçük yapı), 12–15 dükkan zemin katları. */
export const ATLAS_GRID = 4;
export const FACADE_VARIANTS = 12;
export const SHOP_BASE = 12;
export const SHOP_VARIANTS = 4;
/** Bir atlas karosunun temsil ettiği duvar ölçüsü (m): 2 pencere aralığı × 1 kat. */
export const TILE_W = 5.0;
export const TILE_H = 3.1;
/** Dükkan zemin katı yüksekliği (m). */
export const SHOP_H = 4.0;
