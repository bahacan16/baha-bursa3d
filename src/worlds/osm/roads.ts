import { ChunkedGeometry, type Bucket, type MatKey, type Rgb } from './chunks';
import type { Pt, Road } from './parse';
import { H, densify } from './height';

export const SIDEWALK_W = 2;
export const CURB_H = 0.15;

/** Sınıfa göre milimetrik y ofseti (z-fighting'e karşı; malzemelerde polygonOffset de var). */
const Y_MINOR = 0.03;
const Y_MAJOR = 0.04;
const Y_MARK = 0.05;
/** Araç yolu şeridi / kaldırım sıklaştırma adımı (m) */
export const ROAD_STEP = 4;

// Renkler Mertkent çevresi Street View karelerinden ölçüldü (asfalt sRGB≈145,146,143; parke≈211,193,167)
// Street View ölçümü (DA 97/128, güneşli): asfalt sıcak gri ≈ #95908a → mavimsi olmasın diye hafif sıcak
const ASPHALT: Rgb = [0.27, 0.26, 0.245];
const ASPHALT_SERVICE: Rgb = [0.3, 0.29, 0.275];
const PAVER: Rgb = [0.6, 0.5, 0.38];
const PATH: Rgb = [0.6, 0.53, 0.42];
// Nilüfer bisiklet yolları mavi boyalı (kullanıcı fotoğrafı, 502. Sk.)
const CYCLE: Rgb = [0.16, 0.26, 0.38];
// Kaldırım rengi dokudan (Nilüfer tipi: gri tuğla + sarı kılavuz, materials.ts) → köşe rengi beyaz
const SIDEWALK: Rgb = [1, 1, 1];
const CURB: Rgb = [0.62, 0.61, 0.59];
const WHITE: Rgb = [0.92, 0.92, 0.9];

/** Kaldırım / yükseltilmiş şerit — zemin yüksekliği sorgusu için. */
export interface RaisedStrip {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  inner: number;
  outer: number;
  height: number;
}

/** Araç yolu şeridi — kaldırım üstünde değil kontrolü için. */
export interface Carriageway {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

export interface RoadBuildResult {
  strips: RaisedStrip[];
  carriageways: Carriageway[];
}

function keyOf(p: Pt): string {
  return `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
}

function roadStyle(r: Road): { mat: MatKey; color: Rgb; y: number } {
  if (r.vehicular) return { mat: 'roadMajor', color: ASPHALT, y: Y_MAJOR };
  switch (r.kind) {
    case 'service':
    case 'living_street':
    case 'track':
      return { mat: 'roadMinor', color: r.kind === 'track' ? PATH : ASPHALT_SERVICE, y: Y_MINOR };
    case 'cycleway':
      return { mat: 'roadMinor', color: CYCLE, y: Y_MINOR };
    case 'path':
    case 'bridleway':
      return { mat: 'roadMinor', color: PATH, y: Y_MINOR };
    default:
      // Yaya yolları: kilitli parke taşı dokusu
      return { mat: 'footway', color: PAVER, y: Y_MINOR };
  }
}

/**
 * Ofsetli polyline şeridi. Birleşimlerde gönye (miter) sınırlı.
 * Dönüş: her nokta için sol/sağ ofset noktaları.
 */
export function offsetPolyline(pts: Pt[], off: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let nx: number;
    let nz: number;
    if (i === 0 || i === n - 1) {
      const a = i === 0 ? pts[0] : prev;
      const b = i === 0 ? next : pts[n - 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      nx = -dz / l;
      nz = dx / l;
    } else {
      const d1x = pts[i][0] - prev[0];
      const d1z = pts[i][1] - prev[1];
      const d2x = next[0] - pts[i][0];
      const d2z = next[1] - pts[i][1];
      const l1 = Math.hypot(d1x, d1z) || 1;
      const l2 = Math.hypot(d2x, d2z) || 1;
      const n1x = -d1z / l1;
      const n1z = d1x / l1;
      const n2x = -d2z / l2;
      const n2z = d2x / l2;
      let mx = n1x + n2x;
      let mz = n1z + n2z;
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) {
        mx = n1x;
        mz = n1z;
      } else {
        mx /= ml;
        mz /= ml;
      }
      const cos = mx * n1x + mz * n1z;
      const scale = 1 / Math.max(cos, 0.5); // gönye sınırı 2×
      nx = mx * scale;
      nz = mz * scale;
    }
    out.push([pts[i][0] + nx * off, pts[i][1] + nz * off]);
  }
  return out;
}

function polyLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Polyline'ı baştan `a`, sondan `b` metre kırpar. */
export function trimPolyline(pts: Pt[], a: number, b: number): Pt[] | null {
  const L = polyLength(pts);
  if (L - a - b < 0.5) return null;
  const out: Pt[] = [];
  let acc = 0;
  const s0 = a;
  const s1 = L - b;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const lerp = (s: number): Pt => {
      const t = d > 0 ? (s - acc) / d : 0;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    if (acc + d >= s0 && acc <= s1) {
      if (!out.length) out.push(lerp(Math.max(s0, acc)));
      if (acc + d <= s1) out.push(q);
      else {
        out.push(lerp(s1));
        break;
      }
    }
    acc += d;
  }
  return out.length >= 2 ? out : null;
}

/** Şerit mesh'i: pts boyunca `half` yarı genişlikte, y kotunda. Her segment kendi chunk'ına. */
function ribbon(geo: ChunkedGeometry, mat: MatKey, pts: Pt[], half: number, y: number, c: Rgb): void {
  if (pts.length < 2) return;
  const L = offsetPolyline(pts, half);
  const R = offsetPolyline(pts, -half);
  let v = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const mz = (pts[i][1] + pts[i + 1][1]) / 2;
    const b = geo.get(mx, mz, mat);
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const a0 = b.v(L[i][0], y + H(L[i][0], L[i][1]), L[i][1], 0, 1, 0, 0, v, c);
    const b0 = b.v(R[i][0], y + H(R[i][0], R[i][1]), R[i][1], 0, 1, 0, half * 2, v, c);
    const a1 = b.v(L[i + 1][0], y + H(L[i + 1][0], L[i + 1][1]), L[i + 1][1], 0, 1, 0, 0, v + d, c);
    const b1 = b.v(R[i + 1][0], y + H(R[i + 1][0], R[i + 1][1]), R[i + 1][1], 0, 1, 0, half * 2, v + d, c);
    v += d;
    // Sol = +normal (−dz, dx). Yukarıdan saat yönü tersi için sırayı çapraz çarpımla belirle.
    upQuad(b, a0, b0, b1, a1);
  }
}

/** Dört yatay köşeyi yukarı bakan iki üçgen olarak ekler. */
function upQuad(b: Bucket, i0: number, i1: number, i2: number, i3: number): void {
  const P = b.pos;
  const cross =
    (P[i1 * 3] - P[i0 * 3]) * (P[i2 * 3 + 2] - P[i0 * 3 + 2]) -
    (P[i1 * 3 + 2] - P[i0 * 3 + 2]) * (P[i2 * 3] - P[i0 * 3]);
  if (cross < 0) b.quad(i0, i1, i2, i3);
  else b.quad(i0, i3, i2, i1);
}

/** Yatay disk (kavşak dolgusu / yol ucu kapakları). */
function disc(b: Bucket, x: number, z: number, r: number, y: number, c: Rgb, seg = 8): void {
  const center = b.v(x, y + H(x, z), z, 0, 1, 0, x, z, c);
  const ring: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    ring.push(b.v(px, y + H(px, pz), pz, 0, 1, 0, px, pz, c));
  }
  for (let i = 0; i < seg; i++) {
    // a artarken (cos, sin) x-z düzleminde yukarıdan bakınca saat yönünde → ters sırala
    b.tri(center, ring[(i + 1) % seg], ring[i]);
  }
}

/** Dikey şerit (bordür yüzü): p→q boyunca, y0..y1, normal (nx,nz) yönünde. */
function vstrip(b: Bucket, p: Pt, q: Pt, y0: number, y1: number, c: Rgb, towards: Pt): void {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const l = Math.hypot(dx, dz) || 1;
  let nx = dz / l;
  let nz = -dx / l;
  const mx = (p[0] + q[0]) / 2;
  const mz = (p[1] + q[1]) / 2;
  const flip = (towards[0] - mx) * nx + (towards[1] - mz) * nz < 0;
  if (flip) {
    nx = -nx;
    nz = -nz;
  }
  const hp = H(p[0], p[1]);
  const hq = H(q[0], q[1]);
  const a = b.v(p[0], y0 + hp, p[1], nx, 0, nz, 0, 0, c);
  const bb = b.v(q[0], y0 + hq, q[1], nx, 0, nz, l, 0, c);
  const cc = b.v(q[0], y1 + hq, q[1], nx, 0, nz, l, y1 - y0, c);
  const d = b.v(p[0], y1 + hp, p[1], nx, 0, nz, 0, y1 - y0, c);
  // normal = (dz, −dx) iken ön yüz sırası (a, d, cc, bb) — duvarlarla aynı kural
  if (flip) b.quad(a, bb, cc, d);
  else b.quad(a, d, cc, bb);
}

/** Düz [x,z,...] halka içinde mi */
function inFlatRing(r: number[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i];
    const zi = r[i + 1];
    const xj = r[j];
    const zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Kaldırım: yolun bir yanında, iç kenar `half`, dış kenar `half + SIDEWALK_W`. */
function sidewalk(
  geo: ChunkedGeometry,
  pts: Pt[],
  half: number,
  side: 1 | -1,
  strips: RaisedStrip[],
  skip?: (x: number, z: number) => boolean,
): void {
  const inner = offsetPolyline(pts, side * half);
  const outer = offsetPolyline(pts, side * (half + SIDEWALK_W));
  const skipped = (i: number) =>
    !!skip?.(
      (inner[i][0] + outer[i][0] + inner[i + 1][0] + outer[i + 1][0]) / 4,
      (inner[i][1] + outer[i][1] + inner[i + 1][1] + outer[i + 1][1]) / 4,
    );
  for (let i = 0; i + 1 < pts.length; i++) {
    if (skipped(i)) continue;
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const mz = (pts[i][1] + pts[i + 1][1]) / 2;
    const b = geo.get(mx, mz, 'sidewalk');
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const Y = (p: Pt) => CURB_H + H(p[0], p[1]);
    const i0 = b.v(inner[i][0], Y(inner[i]), inner[i][1], 0, 1, 0, 0, 0, SIDEWALK);
    const i1 = b.v(outer[i][0], Y(outer[i]), outer[i][1], 0, 1, 0, SIDEWALK_W, 0, SIDEWALK);
    const i2 = b.v(outer[i + 1][0], Y(outer[i + 1]), outer[i + 1][1], 0, 1, 0, SIDEWALK_W, d, SIDEWALK);
    const i3 = b.v(inner[i + 1][0], Y(inner[i + 1]), inner[i + 1][1], 0, 1, 0, 0, d, SIDEWALK);
    upQuad(b, i0, i1, i2, i3);
    // Bordür (yola bakan) ve dış kenar yüzleri
    const road: Pt = [pts[i][0], pts[i][1]];
    vstrip(b, inner[i], inner[i + 1], 0, CURB_H, CURB, road);
    const away: Pt = [outer[i][0] * 2 - road[0], outer[i][1] * 2 - road[1]];
    vstrip(b, outer[i], outer[i + 1], 0, CURB_H, SIDEWALK, away);
    strips.push({
      ax: pts[i][0],
      az: pts[i][1],
      bx: pts[i + 1][0],
      bz: pts[i + 1][1],
      inner: half,
      outer: half + SIDEWALK_W,
      height: CURB_H,
    });
  }
  // Uç yüzleri
  for (const k of [0, pts.length - 1]) {
    if (skipped(k === 0 ? 0 : pts.length - 2)) continue;
    const b = geo.get(pts[k][0], pts[k][1], 'sidewalk');
    const j = k === 0 ? 1 : pts.length - 2;
    vstrip(b, inner[k], outer[k], 0, CURB_H, CURB, [2 * pts[k][0] - pts[j][0], 2 * pts[k][1] - pts[j][1]]);
  }
}

/** Çoklu çizgiyi sabit mesafe yana kaydır (köşelerde açıortay) */
function offsetPts(pts: Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / l) * d, p[1] + (dx / l) * d] as Pt;
  });
}

/** Çizgi parçası bastırma sorgusu: (x, z, yön) → true ise o noktada çizgi çizilmez */
export type MarkSkip = (x: number, z: number, ux: number, uz: number) => boolean;
/** Bastırma sorgusunun çözünürlüğü (m): düz çizgiler bu boyda parçalara bölünür */
const SKIP_STEP = 1;

function dashes(
  geo: ChunkedGeometry,
  pts: Pt[],
  on: number,
  off: number,
  w: number,
  y: number,
  skip?: MarkSkip,
): void {
  let phase = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) continue;
    const ux = dx / d;
    const uz = dz / d;
    let s = -phase;
    while (s < d) {
      const d0 = Math.max(0, s);
      const d1 = Math.min(d, s + on);
      // Bastırma varsa parça SKIP_STEP boyunda alt parçalara bölünür (düz kenar çizgisi kavşakta kesilir)
      const nSub = skip ? Math.max(1, Math.ceil((d1 - d0) / SKIP_STEP)) : 1;
      for (let k = 0; k < nSub; k++) {
        const s0 = d0 + ((d1 - d0) * k) / nSub;
        const s1 = d0 + ((d1 - d0) * (k + 1)) / nSub;
        if (!(s1 > s0 + (nSub > 1 ? 0.01 : 0.2))) continue;
        if (skip) {
          const sm = (s0 + s1) / 2;
          if (skip(p[0] + ux * sm, p[1] + uz * sm, ux, uz)) continue;
        }
        const ax = p[0] + ux * s0;
        const az = p[1] + uz * s0;
        const bx = p[0] + ux * s1;
        const bz = p[1] + uz * s1;
        const b = geo.get(ax, az, 'marking');
        const nx = -uz * (w / 2);
        const nz = ux * (w / 2);
        const ya = y + H(ax, az);
        const yb = y + H(bx, bz);
        const i0 = b.v(ax + nx, ya, az + nz, 0, 1, 0, 0, 0, WHITE);
        const i1 = b.v(ax - nx, ya, az - nz, 0, 1, 0, 1, 0, WHITE);
        const i2 = b.v(bx - nx, yb, bz - nz, 0, 1, 0, 1, 1, WHITE);
        const i3 = b.v(bx + nx, yb, bz + nz, 0, 1, 0, 0, 1, WHITE);
        upQuad(b, i0, i1, i2, i3);
      }
      s += on + off;
    }
    phase = (phase + d) % (on + off);
  }
}

function zebra(geo: ChunkedGeometry, at: Pt, dir: Pt, width: number): void {
  const b = geo.get(at[0], at[1], 'marking');
  const ux = dir[0];
  const uz = dir[1];
  const nx = -uz;
  const nz = ux;
  const len = 3; // yol boyunca
  const stripe = 0.5;
  const n = Math.max(2, Math.floor((width - 0.6) / (stripe * 2)));
  const start = -((n - 1) * stripe * 2) / 2;
  for (let k = 0; k < n; k++) {
    const o = start + k * stripe * 2;
    const cx = at[0] + nx * o;
    const cz = at[1] + nz * o;
    const hx = nx * (stripe / 2);
    const hz = nz * (stripe / 2);
    const lx = ux * (len / 2);
    const lz = uz * (len / 2);
    const Y = (x: number, z: number) => Y_MARK + H(x, z);
    const i0 = b.v(cx - hx - lx, Y(cx - hx - lx, cz - hz - lz), cz - hz - lz, 0, 1, 0, 0, 0, WHITE);
    const i1 = b.v(cx + hx - lx, Y(cx + hx - lx, cz + hz - lz), cz + hz - lz, 0, 1, 0, 1, 0, WHITE);
    const i2 = b.v(cx + hx + lx, Y(cx + hx + lx, cz + hz + lz), cz + hz + lz, 0, 1, 0, 1, 1, WHITE);
    const i3 = b.v(cx - hx + lx, Y(cx - hx + lx, cz - hz + lz), cz - hz + lz, 0, 1, 0, 0, 1, WHITE);
    upQuad(b, i0, i1, i2, i3);
  }
}

/**
 * Kavşak çizgi bastırması: r'nin çizgi noktası BAŞKA bir araç yolunun şeridinin içindeyse (kavşak ağzı, üst üste
 * binen tek yönlü kollar, göbek) çizgi çizilmez. Aynı caddenin devam eden parçası (uç noktası ortak, uçtaki yönü
 * ≤ 15° farklı) sayılmaz. Paralel (≤ 8°) şeritler de sayılmaz: çift yönlü caddenin bitişik şeritleri çizgisini korur.
 * KARAR: kavşak alanında kenar/orta çizgi yok (Street View: Özlüce kavşağında yalnız aşınmış kılavuz çizgi).
 */
export function junctionMarkSkip(roads: Road[]): (r: Road) => MarkSkip {
  const veh = roads.filter((r) => r.vehicular && r.pts.length >= 2);
  const CELL = 25;
  const grid = new Map<string, { r: Road; a: Pt; b: Pt }[]>();
  for (const r of veh)
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      const pad = r.width / 2;
      for (
        let gx = Math.floor((Math.min(a[0], b[0]) - pad) / CELL);
        gx <= Math.floor((Math.max(a[0], b[0]) + pad) / CELL);
        gx++
      )
        for (
          let gz = Math.floor((Math.min(a[1], b[1]) - pad) / CELL);
          gz <= Math.floor((Math.max(a[1], b[1]) + pad) / CELL);
          gz++
        ) {
          const k = `${gx},${gz}`;
          let v = grid.get(k);
          if (!v) grid.set(k, (v = []));
          v.push({ r, a, b });
        }
    }
  const tangent = (r: Road, end: 0 | 1): Pt => {
    const n = r.pts.length;
    const [p, q] = end === 0 ? [r.pts[0], r.pts[1]] : [r.pts[n - 1], r.pts[n - 2]];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
  };
  const same = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < 0.05 && Math.abs(p[1] - q[1]) < 0.05;
  /** o, r'nin devamı mı: ortak uçta (içe bakan teğetler zıt yönde, ≤ 15°) */
  const continues = (r: Road, o: Road): boolean => {
    for (const er of [0, 1] as const)
      for (const eo of [0, 1] as const) {
        const pr = er === 0 ? r.pts[0] : r.pts[r.pts.length - 1];
        const po = eo === 0 ? o.pts[0] : o.pts[o.pts.length - 1];
        if (!same(pr, po)) continue;
        const tr = tangent(r, er);
        const to = tangent(o, eo);
        if (tr[0] * to[0] + tr[1] * to[1] < -Math.cos((15 * Math.PI) / 180)) return true;
      }
    return false;
  };
  const COS_PAR = Math.cos((8 * Math.PI) / 180);
  return (r: Road) => {
    const cont = new Map<Road, boolean>();
    return (x, z, ux, uz) => {
      for (const s of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
        if (s.r === r) continue;
        if (distToSeg(x, z, s.a, s.b) >= s.r.width / 2 - 0.05) continue;
        const ex = s.b[0] - s.a[0];
        const ez = s.b[1] - s.a[1];
        const el = Math.hypot(ex, ez) || 1;
        if (Math.abs((ex * ux + ez * uz) / el) > COS_PAR) continue;
        let c = cont.get(s.r);
        if (c === undefined) cont.set(s.r, (c = continues(r, s.r)));
        if (c) continue;
        return true;
      }
      return false;
    };
  };
}

function distToSeg(px: number, pz: number, a: Pt, b: Pt): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * ex + (pz - a[1]) * ez) / l2)) : 0;
  return Math.hypot(px - a[0] - ex * t, pz - a[1] - ez * t);
}

/** Tüm yolları, kaldırımları, çizgileri ve yaya geçitlerini üretir. */
export function buildRoads(
  geo: ChunkedGeometry,
  roads: Road[],
  crossings: Pt[],
  noSidewalk: number[][] = [],
  /** v7: ölçülmüş çizgi düzeltmeleri (Street View): yol kimliği → centre none | dashed | solid, edges none | solid */
  marks: Record<string, { centre?: string; edges?: string }> = {},
): RoadBuildResult {
  const skipWalk = (x: number, z: number) => noSidewalk.some((r) => inFlatRing(r, x, z));
  const strips: RaisedStrip[] = [];
  const carriageways: Carriageway[] = [];
  const visible = roads.filter((r) => !r.tunnel);

  // Kavşak düğümleri: araç yollarının paylaştığı noktalar → kaldırım kırpma mesafesi
  const nodeRoads = new Map<string, Road[]>();
  for (const r of visible) {
    for (const p of r.pts) {
      const k = keyOf(p);
      let a = nodeRoads.get(k);
      if (!a) nodeRoads.set(k, (a = []));
      if (!a.includes(r)) a.push(r);
    }
  }
  const markSkipFor = junctionMarkSkip(visible);
  // Önce geniş yollar: aynı y'de üst üste binmeler aynı renkte olduğundan görünmez.
  const sorted = visible.slice().sort((a, b) => a.width - b.width);
  for (const r of sorted) {
    // Ölçülmüş sokak bantlarında (street-plan) OSM yaya/bisiklet çizgisi çizilmez: gerçek düzen oradan gelir
    if (!r.vehicular && r.pts.length >= 2) {
      const m = r.pts[Math.floor(r.pts.length / 2)];
      const a = r.pts[0];
      if (skipWalk(m[0], m[1]) && skipWalk(a[0], a[1])) continue;
    }
    const st = roadStyle(r);
    const half = r.width / 2;
    // Araç yolları 4 m'de bir sıklaştırılır: 12 m'de şeridin kirişi arazinin (10 m ızgara) 2.8 cm'ye kadar üstünde
    // kalıyor, üstüne +0.004–0.02 ile serilen ölçülmüş yama / çatlak / rögar görünmüyordu (critic A9). 4 m'de ≤ 3 mm.
    const dense = densify(r.pts, r.vehicular ? ROAD_STEP : 12);
    ribbon(geo, st.mat, dense, half, st.y, st.color);
    // Uç kapakları (kavşak dolgusu)
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]])
      disc(geo.get(p[0], p[1], st.mat), p[0], p[1], half, st.y, st.color);
    // Yol ortasındaki kavşaklar (bir başka yolun ucu bu yolun iç noktasına bağlanıyorsa)
    for (let i = 1; i + 1 < r.pts.length; i++) {
      const k = keyOf(r.pts[i]);
      const others = nodeRoads.get(k);
      if (others && others.length > 1)
        disc(geo.get(r.pts[i][0], r.pts[i][1], st.mat), r.pts[i][0], r.pts[i][1], half, st.y, st.color);
    }
    if (r.vehicular) {
      for (let i = 0; i + 1 < r.pts.length; i++)
        carriageways.push({
          ax: r.pts[i][0],
          az: r.pts[i][1],
          bx: r.pts[i + 1][0],
          bz: r.pts[i + 1][1],
          half,
        });
    }
    // Orta çizgi: primary ve üstü kesikli beyaz; iki yönlü cadde/sokaklarda da kesikli (Street View: Cavit Orhan
    // Tütengil, Doğan Avcıoğlu, 502. Sokak), caddelerde kenar çizgisi düz beyaz
    const mk = marks[r.id];
    // Kavşak / üst üste binen şeritlerde (tek yönlü kollar + göbek) çizgi yok: Street View'da orada yalnız aşınmış
    // kılavuz çizgi, dur çizgisi ve yaya geçidi var (Özlüce kavşağı da3-01/05)
    const skip = r.vehicular ? markSkipFor(r) : undefined;
    if (mk?.centre === 'dashed') dashes(geo, dense, 3, 5, 0.12, Y_MARK, skip);
    else if (mk?.centre === 'solid') dashes(geo, dense, 1e6, 0, 0.12, Y_MARK, skip);
    else if (mk?.centre === 'none') {
      /* ölçüm: orta çizgi yok */
    } else if (/^(motorway|trunk|primary)$/.test(r.kind)) dashes(geo, dense, 3, 6, 0.15, Y_MARK, skip);
    else if (/^(secondary|tertiary|residential|unclassified)$/.test(r.kind) && !r.oneway && r.width >= 6)
      dashes(geo, dense, 3, 5, 0.12, Y_MARK, skip);
    if (mk?.edges === 'solid' || (mk?.edges !== 'none' && /^(secondary|tertiary)$/.test(r.kind)))
      for (const sd of [-1, 1]) dashes(geo, offsetPts(dense, sd * (half - 0.35)), 1e6, 0, 0.12, Y_MARK, skip);
  }

  // Kaldırımlar: kavşak düğümlerinde parçalara böl ve kırp
  for (const r of visible) {
    if (!r.vehicular || (!r.sidewalkLeft && !r.sidewalkRight)) continue;
    const half = r.width / 2;
    let piece: Pt[] = [r.pts[0]];
    const flush = (endIdx: number) => {
      const startKey = keyOf(piece[0]);
      const endKey = keyOf(r.pts[endIdx]);
      const trimFor = (k: string) => {
        const others = (nodeRoads.get(k) ?? []).filter((o) => o !== r && o.vehicular);
        if (!others.length) return 0;
        return Math.max(...others.map((o) => o.width / 2)) + SIDEWALK_W + 0.5;
      };
      const trimmed = trimPolyline(piece, trimFor(startKey), trimFor(endKey));
      if (trimmed) {
        const dense = densify(trimmed, ROAD_STEP);
        if (r.sidewalkLeft) sidewalk(geo, dense, half, 1, strips, skipWalk);
        if (r.sidewalkRight) sidewalk(geo, dense, half, -1, strips, skipWalk);
      }
    };
    for (let i = 1; i < r.pts.length; i++) {
      piece.push(r.pts[i]);
      const others = (nodeRoads.get(keyOf(r.pts[i])) ?? []).filter((o) => o !== r && o.vehicular);
      if (i === r.pts.length - 1 || others.length) {
        flush(i);
        piece = [r.pts[i]];
      }
    }
  }

  // Yaya geçitleri
  for (const c of crossings) {
    const k = keyOf(c);
    const on = (nodeRoads.get(k) ?? []).find((r) => r.vehicular);
    if (!on) continue;
    const i = on.pts.findIndex((p) => keyOf(p) === k);
    const a = on.pts[Math.max(0, i - 1)];
    const b = on.pts[Math.min(on.pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    zebra(geo, c, [dx / l, dz / l], on.width);
  }
  return { strips, carriageways };
}
