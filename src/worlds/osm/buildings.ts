import earcut from 'earcut';
import { ChunkedGeometry, hashString, parseColour, rng, type Bucket, type Rgb, type V3 } from './chunks';
import { pointInPolygon, distToRing, ringCentroid, signedArea, type Building, type Ring } from './parse';
import { FACADE_VARIANTS, SHOP_VARIANTS, SHOP_BASE } from './chunks';
import { ringBase, terrainIsFlat } from './height';

const PARAPET = 0.8;

const FLAT_ROOF_COLORS: Rgb[] = [
  [0.62, 0.6, 0.57],
  [0.55, 0.54, 0.52],
  [0.68, 0.64, 0.58],
  [0.5, 0.49, 0.5],
];
const TILE_ROOF_COLORS: Rgb[] = [
  [0.62, 0.3, 0.22],
  [0.55, 0.27, 0.2],
  [0.66, 0.36, 0.26],
  [0.45, 0.3, 0.27],
];

export interface BuildingOptions {
  roofDetails: boolean;
  /** Hava fotoğrafından örneklenmiş çatı renkleri (bina id → doğrusal RGB) */
  roofColors?: Record<string, readonly number[]>;
}

/** Halkayı istenen yöne çevirir: dış halka pozitif alan, delik negatif alan. */
export function orient(r: Ring, positive: boolean): Ring {
  const a = signedArea(r);
  return a > 0 === positive ? r : r.slice().reverse();
}

/** Pencere ızgarası gerçek ölçekte: ~2.5 m aralık, pencereler kenarda kesilmesin diye tam sayıya yuvarlanır. */
export function wallU(len: number): number {
  if (len < 1.6) return 0;
  const bays = Math.max(1, Math.round(len / 2.5));
  return bays * 2.5;
}

/** Dikey duvar şeridi (bir halkanın tüm kenarları). Normal = (dz, −dx) (dış halka + alan > 0 için dışa). */
export function addWalls(
  b: Bucket,
  ring: Ring,
  y0: number,
  y1: number,
  color: Rgb,
  fac: readonly number[],
  inward = false,
  vOff = 0,
): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    let nx = dz / len;
    let nz = -dx / len;
    if (inward) {
      nx = -nx;
      nz = -nz;
    }
    const uLen = wallU(len);
    const u0 = uLen === 0 ? 0.1 : 0;
    const u1 = uLen === 0 ? 0.1 : uLen;
    const a = b.v(p[0], y0, p[1], nx, 0, nz, u0, y0 - vOff, color, fac);
    const c = b.v(q[0], y0, q[1], nx, 0, nz, u1, y0 - vOff, color, fac);
    const d = b.v(q[0], y1, q[1], nx, 0, nz, u1, y1 - vOff, color, fac);
    const e = b.v(p[0], y1, p[1], nx, 0, nz, u0, y1 - vOff, color, fac);
    if (inward) b.quad(a, c, d, e);
    else b.quad(a, e, d, c);
  }
}

/** Poligonu (delikli) yatay düzlemde üçgenler; normal yukarı. */
export function addFlatPolygon(
  b: Bucket,
  outer: Ring,
  holes: Ring[],
  y: number,
  color: Rgb,
  uvScale = 1,
): void {
  const data: number[] = [];
  const holeIdx: number[] = [];
  for (const p of outer) data.push(p[0], p[1]);
  for (const h of holes) {
    holeIdx.push(data.length / 2);
    for (const p of h) data.push(p[0], p[1]);
  }
  const tris = earcut(data, holeIdx.length ? holeIdx : undefined, 2);
  const base = b.vertexCount;
  for (let i = 0; i < data.length; i += 2) {
    b.v(data[i], y, data[i + 1], 0, 1, 0, data[i] * uvScale, data[i + 1] * uvScale, color);
  }
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i];
    const c = tris[i + 1];
    const d = tris[i + 2];
    // Yukarıdan bakınca saat yönünün tersi (three.js ön yüz) olacak şekilde sırala.
    const ax = data[a * 2];
    const az = data[a * 2 + 1];
    const cross = (data[c * 2] - ax) * (data[d * 2 + 1] - az) - (data[c * 2 + 1] - az) * (data[d * 2] - ax);
    if (cross < 0) b.tri(base + a, base + c, base + d);
    else b.tri(base + a, base + d, base + c);
  }
}

function roofColor(bd: Building, r: () => number, sampled?: Rgb): Rgb {
  const tagged = parseColour(bd.roofColour);
  if (tagged) return tagged;
  if (sampled) {
    r();
    return sampled;
  }
  const pal = bd.roofShape === 'flat' ? FLAT_ROOF_COLORS : TILE_ROOF_COLORS;
  return pal[Math.floor(r() * pal.length)];
}

function wallTint(bd: Building, r: () => number): Rgb {
  const tagged = parseColour(bd.colour);
  if (tagged) return [0.5 + tagged[0] * 0.5, 0.5 + tagged[1] * 0.5, 0.5 + tagged[2] * 0.5];
  const k = 0.92 + r() * 0.1;
  return [k, k, k * (0.98 + r() * 0.03)];
}

function isRectLike(r: Ring): boolean {
  if (r.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = r[i];
    const b = r[(i + 1) % 4];
    const c = r[(i + 2) % 4];
    const ux = b[0] - a[0];
    const uz = b[1] - a[1];
    const vx = c[0] - b[0];
    const vz = c[1] - b[1];
    const cos = (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1);
    if (Math.abs(cos) > 0.26) return false;
  }
  return true;
}

function addPitchedRoof(
  roof: Bucket,
  walls: Bucket,
  outer: Ring,
  bd: Building,
  rc: Rgb,
  tint: Rgb,
  fac: readonly number[],
  vOff = 0,
): void {
  const y0 = bd.wallTop;
  const y1 = bd.height;
  const V = (p: readonly number[], y: number): V3 => [p[0], y, p[1]];
  if ((bd.roofShape === 'gabled' || bd.roofShape === 'hipped') && isRectLike(outer)) {
    // Uzun kenar A-B olacak şekilde döndür
    let r = outer;
    const e0 = Math.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]);
    const e1 = Math.hypot(r[2][0] - r[1][0], r[2][1] - r[1][1]);
    if (e1 > e0) r = [r[1], r[2], r[3], r[0]];
    const [A, B, C, D] = r;
    const m1 = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2];
    const m2 = [(D[0] + A[0]) / 2, (D[1] + A[1]) / 2];
    if (bd.roofShape === 'gabled') {
      roof.flatTri(V(A, y0), V(B, y0), V(m1, y1), rc, true);
      roof.flatTri(V(A, y0), V(m1, y1), V(m2, y1), rc, true);
      roof.flatTri(V(C, y0), V(D, y0), V(m2, y1), rc, true);
      roof.flatTri(V(C, y0), V(m2, y1), V(m1, y1), rc, true);
      // Alınlık üçgenleri (duvar malzemesi, düz bant)
      for (const [p, q, m] of [
        [B, C, m1],
        [D, A, m2],
      ] as const) {
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = dz / l;
        const nz = -dx / l;
        const u = wallU(l);
        const i0 = walls.v(p[0], y0, p[1], nx, 0, nz, 0, y0 - vOff, tint, fac);
        const i1 = walls.v(q[0], y0, q[1], nx, 0, nz, u, y0 - vOff, tint, fac);
        const i2 = walls.v(m[0], y1, m[1], nx, 0, nz, u / 2, y1 - vOff, tint, fac);
        walls.tri(i0, i2, i1);
      }
      return;
    }
    const short = Math.hypot(C[0] - B[0], C[1] - B[1]);
    const long = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (long - short > 0.5) {
      const ax = (m2[0] - m1[0]) / (long || 1);
      const az = (m2[1] - m1[1]) / (long || 1);
      const R1 = [m1[0] + ax * (short / 2), m1[1] + az * (short / 2)];
      const R2 = [m2[0] - ax * (short / 2), m2[1] - az * (short / 2)];
      roof.flatTri(V(A, y0), V(B, y0), V(R1, y1), rc, true);
      roof.flatTri(V(A, y0), V(R1, y1), V(R2, y1), rc, true);
      roof.flatTri(V(C, y0), V(D, y0), V(R2, y1), rc, true);
      roof.flatTri(V(C, y0), V(R2, y1), V(R1, y1), rc, true);
      roof.flatTri(V(B, y0), V(C, y0), V(R1, y1), rc, true);
      roof.flatTri(V(D, y0), V(A, y0), V(R2, y1), rc, true);
      return;
    }
  }
  // Genel kırma çatı: tabanı içe daralt + yükselt (her şekilde çalışır); olmazsa piramit
  if (bd.roofShape === 'hipped') {
    const slope = (y1 - y0) / 4.5; // ~32° eğim
    let d = Math.min(4.5, (y1 - y0) / slope);
    for (let t = 0; t < 4; t++, d *= 0.55) {
      const inner = insetRing(outer, d);
      if (!inner) continue;
      const top = y0 + d * slope;
      for (let i = 0; i < outer.length; i++) {
        const j = (i + 1) % outer.length;
        roof.flatTri(V(outer[i], y0), V(outer[j], y0), V(inner[j], top), rc, true);
        roof.flatTri(V(outer[i], y0), V(inner[j], top), V(inner[i], top), rc, true);
      }
      addFlatPolygon(roof, inner, [], top, rc);
      return;
    }
  }
  // Piramit (ve dikdörtgen olmayan şekillerde yedek)
  const c = ringCentroid(outer);
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    const q = outer[(i + 1) % outer.length];
    roof.flatTri(V(p, y0), V(q, y0), V(c, y1), rc, true);
  }
}

/**
 * Halkayı (pozitif alanlı) `d` metre içe daraltır (gönye). Geçersizse (kendini keser, dışarı taşar) null.
 */
export function insetRing(r: Ring, d: number): Ring | null {
  const n = r.length;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const p = r[(i - 1 + n) % n];
    const c = r[i];
    const q = r[(i + 1) % n];
    const e1x = c[0] - p[0];
    const e1z = c[1] - p[1];
    const e2x = q[0] - c[0];
    const e2z = q[1] - c[1];
    const l1 = Math.hypot(e1x, e1z) || 1;
    const l2 = Math.hypot(e2x, e2z) || 1;
    // İç normal (pozitif alan): (−dz, dx)
    const n1x = -e1z / l1;
    const n1z = e1x / l1;
    const n2x = -e2z / l2;
    const n2z = e2x / l2;
    let mx = n1x + n2x;
    let mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) return null;
    mx /= ml;
    mz /= ml;
    const cos = mx * n1x + mz * n1z;
    if (cos < 0.35) return null; // çok sivri iç açı
    out.push([c[0] + (mx * d) / cos, c[1] + (mz * d) / cos]);
  }
  // Doğrulama: yön korunmalı, her kenar kısalmalı ya da eşit kalmalı, noktalar içeride olmalı
  if (signedArea(out) <= 0 || signedArea(out) > signedArea(r)) return null;
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    const ia = out[i];
    const ib = out[(i + 1) % n];
    const dot = (b[0] - a[0]) * (ib[0] - ia[0]) + (b[1] - a[1]) * (ib[1] - ia[1]);
    if (dot <= 0) return null; // kenar ters döndü → kendini kesiyor
    if (!pointInPolygon(ia[0], ia[1], r, [])) return null;
  }
  return out;
}

/** Box (eksen hizalı değil, yaw açılı) ekler. */
export function addBox(
  b: Bucket,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  c: Rgb,
  pitch = 0,
): void {
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const tf = (x: number, y: number, z: number): V3 => {
    // pitch: x ekseni etrafında
    const y2 = y * cp - z * sp;
    const z2 = y * sp + z * cp;
    return [cx + x * cs + z2 * sn, cy + y2, cz - x * sn + z2 * cs];
  };
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const P = [
    tf(-hx, -hy, -hz),
    tf(hx, -hy, -hz),
    tf(hx, hy, -hz),
    tf(-hx, hy, -hz),
    tf(-hx, -hy, hz),
    tf(hx, -hy, hz),
    tf(hx, hy, hz),
    tf(-hx, hy, hz),
  ];
  const faces = [
    [3, 2, 6, 7], // üst
    [4, 5, 6, 7], // +z
    [1, 0, 3, 2], // −z
    [5, 1, 2, 6], // +x
    [0, 4, 7, 3], // −x
  ];
  for (const f of faces) {
    const [a, bb, cc, d] = f.map((i) => P[i]);
    quadFlat(b, a, bb, cc, d, c, [cx, cy, cz]);
  }
}

/**
 * Dört köşeli düz yüz. `from` verilirse normal o noktadan uzağa bakacak şekilde yüz çevrilir
 * (kutu/silindir merkezleri için).
 */
export function quadFlat(b: Bucket, a: V3, bb: V3, cc: V3, d: V3, c: Rgb, from?: V3): void {
  const ux = bb[0] - a[0];
  const uy = bb[1] - a[1];
  const uz = bb[2] - a[2];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const vz = d[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  let flip = false;
  if (from) {
    const mx = (a[0] + cc[0]) / 2 - from[0];
    const my = (a[1] + cc[1]) / 2 - from[1];
    const mz = (a[2] + cc[2]) / 2 - from[2];
    flip = nx * mx + ny * my + nz * mz < 0;
  }
  if (flip) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const i0 = b.v(a[0], a[1], a[2], nx, ny, nz, 0, 0, c);
  const i1 = b.v(bb[0], bb[1], bb[2], nx, ny, nz, 1, 0, c);
  const i2 = b.v(cc[0], cc[1], cc[2], nx, ny, nz, 1, 1, c);
  const i3 = b.v(d[0], d[1], d[2], nx, ny, nz, 0, 1, c);
  if (flip) b.quad(i0, i3, i2, i1);
  else b.quad(i0, i1, i2, i3);
}

/** Yatay çokgen prizma (su deposu vb.). */
export function addCylinder(
  b: Bucket,
  cx: number,
  y0: number,
  cz: number,
  r: number,
  h: number,
  c: Rgb,
  seg = 8,
) {
  const top: V3[] = [];
  const bot: V3[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    top.push([cx + Math.cos(a) * r, y0 + h, cz - Math.sin(a) * r]);
    bot.push([cx + Math.cos(a) * r, y0, cz - Math.sin(a) * r]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    quadFlat(b, bot[i], bot[j], top[j], top[i], c, [cx, y0 + h / 2, cz]);
  }
  for (let i = 1; i + 1 < seg; i++) b.flatTri(top[0], top[i], top[i + 1], c, true);
}

function addRoofDetails(b: Bucket, bd: Building, outer: Ring, y: number, r: () => number): void {
  const area = Math.abs(signedArea(outer));
  if (area < 60) return;
  const count = Math.min(5, Math.floor(area / 140) + (r() < 0.6 ? 1 : 0));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of outer) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]);
    maxZ = Math.max(maxZ, p[1]);
  }
  // Binanın ana eksen açısı (en uzun kenar)
  let yaw = 0;
  let best = 0;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    const q = outer[(i + 1) % outer.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l > best) {
      best = l;
      yaw = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
    }
  }
  // Güneye bakan paneller için: panel eğimi güneye (+z)
  for (let k = 0; k < count; k++) {
    let x = 0;
    let z = 0;
    let ok = false;
    for (let t = 0; t < 12 && !ok; t++) {
      x = minX + r() * (maxX - minX);
      z = minZ + r() * (maxZ - minZ);
      ok = pointInPolygon(x, z, outer, bd.holes) && distToRing(x, z, outer) > 1.8;
    }
    if (!ok) continue;
    const kind = r();
    if (kind < 0.5) {
      // Güneş enerjili su ısıtıcı: eğik panel + yatay tank (Bursa çatılarının klasiği)
      addBox(b, x, y + 0.55, z, 1.1, 0.06, 1.9, 0, [0.16, 0.22, 0.34], -0.6);
      addBox(b, x, y + 1.15, z - 0.75, 1.3, 0.5, 0.5, 0, [0.85, 0.85, 0.83]);
      addBox(b, x, y + 0.45, z - 0.75, 0.08, 0.9, 0.08, 0, [0.5, 0.5, 0.5]);
    } else if (kind < 0.8) {
      addCylinder(b, x, y, z, 0.55, 1.2, [0.82, 0.82, 0.8]);
    } else if (kind < 0.92) {
      addBox(b, x, y + 1.4, z, 0.06, 2.8, 0.06, yaw, [0.35, 0.35, 0.36]);
      addBox(b, x, y + 2.4, z, 1.2, 0.04, 0.04, yaw, [0.35, 0.35, 0.36]);
    } else {
      // Asansör/merdiven kulübesi
      addBox(b, x, y + 1.2, z, 2.6, 2.4, 2.6, yaw, [0.8, 0.77, 0.72]);
    }
  }
}

/** Bir binayı chunk kovalarına yazar. Arazi varsa en düşük köşenin kotundan başlar. */
export function buildBuilding(geo: ChunkedGeometry, bd0: Building, opts: BuildingOptions): void {
  const outer = orient(bd0.outer, true);
  if (outer.length < 3) return;
  const base = ringBase(outer);
  const bd: Building = {
    ...bd0,
    minHeight: bd0.minHeight + base,
    height: bd0.height + base,
    wallTop: bd0.wallTop + base,
  };
  const holes = bd.holes.map((h) => orient(h, false)).filter((h) => h.length >= 3);
  const c = ringCentroid(outer);
  const seed = hashString(bd.id);
  const r = rng(seed);
  const walls = geo.get(c[0], c[1], 'wall');
  const flat = bd.roofShape === 'flat';
  // Eğik çatılar kiremit dokusu, düz çatılar beton
  const roof = geo.get(c[0], c[1], flat ? 'roof' : 'roofTile');
  const small = Math.abs(signedArea(outer)) < 25 || bd.levels <= 1;
  const variant = small ? FACADE_VARIANTS - 1 : seed % (FACADE_VARIANTS - 1);
  const hasShop = bd0.height - bd0.levels * 3.1 > 1.5 || bd.kind === 'retail' || bd.kind === 'commercial';
  const shop = hasShop && bd0.minHeight < 0.5 ? SHOP_BASE + ((seed >>> 8) % SHOP_VARIANTS) : -1;
  const parapet = flat && !small ? PARAPET : 0;
  const top = flat ? bd.height : bd.wallTop;
  // Cephe shader'ı göreli kotla (taban = 0) çalışır.
  const fac = [variant, shop, top - base, parapet];
  const tint = wallTint(bd, r);
  const hint = opts.roofColors?.[bd0.id];
  const rc = roofColor(bd, r, hint ? [hint[0], hint[1], hint[2]] : undefined);
  // Eğimli arazide temel boşluk kalmasın diye duvarı biraz gömeriz.
  const bottom = bd0.minHeight < 0.5 ? bd.minHeight - (terrainIsFlat() ? 0 : 0.6) : bd.minHeight;

  addWalls(walls, outer, bottom, top, tint, fac, false, base);
  for (const h of holes) addWalls(walls, h, bottom, top, tint, fac, false, base);
  // Havada duran parçaların alt yüzü
  if (bd0.minHeight > 0.5) {
    const under = geo.get(c[0], c[1], 'roof');
    const tmp = under.vertexCount;
    addFlatPolygon(under, outer, holes, bd.minHeight, [0.5, 0.5, 0.5]);
    for (let i = tmp; i < under.vertexCount; i++) under.nor[i * 3 + 1] = -1;
    for (let i = under.idx.length - 1; i >= 0 && under.idx[i] >= tmp; i -= 3) {
      const t = under.idx[i];
      under.idx[i] = under.idx[i - 1];
      under.idx[i - 1] = t;
    }
  }

  if (flat) {
    const roofY = top - parapet;
    addFlatPolygon(roof, outer, holes, roofY, rc);
    if (parapet > 0) {
      addWalls(walls, outer, roofY, top, tint, fac, true, base);
      for (const h of holes) addWalls(walls, h, roofY, top, tint, fac, true, base);
    }
    if (opts.roofDetails && bd.levels >= 2)
      addRoofDetails(geo.get(c[0], c[1], 'detail'), bd, outer, roofY, r);
  } else {
    addFlatPolygon(roof, outer, holes, top, rc);
    addPitchedRoof(roof, walls, outer, bd, rc, tint, fac, base);
  }
}
