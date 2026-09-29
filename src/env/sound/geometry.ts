import type { SoundBuilding, XZ } from './types';

/**
 * Ses için bina geometrisi: taban izi kenarları 10 m ızgarada. Yatay ışın atma (açıklık/yankı sınıflaması) ve
 * dinleyici–kaynak doğrusunun binalarca kesilmesi (örtme → alçak geçiren süzgeç).
 */
export class BuildingIndex {
  static readonly CELL = 10;
  /** Kenar dizisi: ax, az, bx, bz, top (m, dünya), bina no */
  private seg: Float32Array;
  private cells = new Map<number, number[]>();
  readonly count: number;
  private stamp: Uint32Array;
  private stampId = 1;

  constructor(buildings: readonly SoundBuilding[]) {
    let n = 0;
    for (const b of buildings) n += b.ring.length;
    this.seg = new Float32Array(n * 6);
    let k = 0;
    buildings.forEach((b, bi) => {
      const r = b.ring;
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        if (p[0] === q[0] && p[1] === q[1]) continue;
        this.seg.set([p[0], p[1], q[0], q[1], b.top, bi], k * 6);
        this.insert(k, p, q);
        k++;
      }
    });
    this.count = k;
    this.stamp = new Uint32Array(k);
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  private insert(k: number, p: XZ, q: XZ): void {
    const C = BuildingIndex.CELL;
    const x0 = Math.floor(Math.min(p[0], q[0]) / C);
    const x1 = Math.floor(Math.max(p[0], q[0]) / C);
    const z0 = Math.floor(Math.min(p[1], q[1]) / C);
    const z1 = Math.floor(Math.max(p[1], q[1]) / C);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const key = this.key(x, z);
        let a = this.cells.get(key);
        if (!a) this.cells.set(key, (a = []));
        a.push(k);
      }
  }

  /**
   * Doğru parçası (ax,az)→(bx,bz) ile kesişen kenarlar; her kesişim için geri çağırma (t: 0..1 parça üzerinde,
   * top: bina üst kotu, b: bina no). Hücreler DDA ile gezilir. Geri çağırma true dönerse durur.
   */
  cast(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cb: (t: number, top: number, b: number, sx: number, sz: number) => boolean | void,
  ): void {
    const C = BuildingIndex.CELL;
    const dx = bx - ax;
    const dz = bz - az;
    let cx = Math.floor(ax / C);
    let cz = Math.floor(az / C);
    const ex = Math.floor(bx / C);
    const ez = Math.floor(bz / C);
    const sx = dx > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(C / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(C / dz) : Infinity;
    let tmx = dx !== 0 ? ((dx > 0 ? (cx + 1) * C : cx * C) - ax) / dx : Infinity;
    let tmz = dz !== 0 ? ((dz > 0 ? (cz + 1) * C : cz * C) - az) / dz : Infinity;
    const id = ++this.stampId;
    if (id === 0xffffffff) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    const hits: [number, number, number, number, number][] = [];
    for (let guard = 0; guard < 4096; guard++) {
      const list = this.cells.get(this.key(cx, cz));
      if (list) {
        for (const k of list) {
          if (this.stamp[k] === id) continue;
          this.stamp[k] = id;
          const o = k * 6;
          const t = segT(ax, az, dx, dz, this.seg[o], this.seg[o + 1], this.seg[o + 2], this.seg[o + 3]);
          if (t !== null) hits.push([t, this.seg[o + 4], this.seg[o + 5], ax + dx * t, az + dz * t]);
        }
      }
      // Bu hücrenin çıkış t'sine kadar olan kesişimleri sırayla bildir
      const tExit = Math.min(tmx, tmz, 1);
      if (hits.length) {
        hits.sort((a, b) => a[0] - b[0]);
        while (hits.length && hits[0][0] <= tExit) {
          const h = hits.shift()!;
          if (cb(h[0], h[1], h[2], h[3], h[4])) return;
        }
      }
      if (cx === ex && cz === ez) break;
      if (tmx < tmz) {
        if (tmx > 1) break;
        cx += sx;
        tmx += tdx;
      } else {
        if (tmz > 1) break;
        cz += sz;
        tmz += tdz;
      }
    }
    hits.sort((a, b) => a[0] - b[0]);
    for (const h of hits) if (cb(h[0], h[1], h[2], h[3], h[4])) return;
  }

  /** İlk kesişim mesafesi (m) ve bina yüksekliği; yoksa null. */
  firstHit(
    ax: number,
    az: number,
    dirX: number,
    dirZ: number,
    len: number,
  ): { d: number; top: number } | null {
    let out: { d: number; top: number } | null = null;
    this.cast(ax, az, ax + dirX * len, az + dirZ * len, (t, top) => {
      out = { d: t * len, top };
      return true;
    });
    return out;
  }

  /**
   * Dinleyici (l) ile kaynak (s) arasında görüşü kesen bina sayısı (0..2). Doğrunun o noktadaki yüksekliği bina
   * üstünden yüksekse (ör. minare hoparlörü) kesmez. Aynı binanın iki duvarı tek sayılır.
   */
  occlusion(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, max = 2): number {
    let n = 0;
    let lastB = -1;
    let entered = false;
    this.cast(lx, lz, sx, sz, (t, top, b) => {
      const y = ly + (sy - ly) * t;
      if (top <= y) return false;
      // Aynı binaya giriş/çıkış duvarları: bir kez say
      if (b === lastB && entered) {
        entered = false;
        return false;
      }
      lastB = b;
      entered = true;
      n++;
      return n >= max;
    });
    return n;
  }
}

/** Işın (a + t·d, t∈[0,1]) ile p–q parçasının kesişimi t; yoksa null. */
function segT(
  ax: number,
  az: number,
  dx: number,
  dz: number,
  px: number,
  pz: number,
  qx: number,
  qz: number,
): number | null {
  const ex = qx - px;
  const ez = qz - pz;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return null;
  const wx = px - ax;
  const wz = pz - az;
  const t = (wx * ez - wz * ex) / den;
  const u = (wx * dz - wz * dx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** Çoklu çizgi üzerindeki en yakın nokta. */
export function nearestOnPolyline(
  pts: readonly XZ[],
  x: number,
  z: number,
): { x: number; z: number; d: number; s: number; dirX: number; dirZ: number } {
  let best = { x: pts[0][0], z: pts[0][1], d: Infinity, s: 0, dirX: 1, dirZ: 0 };
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const l2 = ex * ex + ez * ez;
    const len = Math.sqrt(l2);
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
    const px = ax + ex * t;
    const pz = az + ez * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d)
      best = { x: px, z: pz, d, s: acc + len * t, dirX: len ? ex / len : 1, dirZ: len ? ez / len : 0 };
    acc += len;
  }
  return best;
}

/** Çoklu çizgi uzunluğu ve kümülatif mesafeler. */
export function polylineCum(pts: readonly XZ[]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++)
    c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}

/** s mesafesindeki nokta ve birim yön. */
export function pointAt(
  pts: readonly XZ[],
  cum: readonly number[],
  s: number,
): { x: number; z: number; dx: number; dz: number } {
  const L = cum[cum.length - 1];
  s = Math.max(0, Math.min(L, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  const dx = (b[0] - a[0]) / seg;
  const dz = (b[1] - a[1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz };
}

/** Deterministik küçük karma (0..1). */
export function hash01(s: string | number): number {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}
