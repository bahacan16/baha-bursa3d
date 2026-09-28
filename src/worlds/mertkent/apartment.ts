import { Builder, type V2 } from './builder';

/**
 * Mertkent 2 apartman bloğu (Street View karelerinden):
 * 7 kat, beyaz ince sıva; pencere sütunlarını çevreleyen bej-turuncu dikey şeritler; beyaz PVC pencere + gri jaluzi;
 * köşelerde katlar boyunca çıkma balkon (pahlı köşe, koyu gri alın bandı, cam korkuluk ya da cam balkon);
 * koyu gri saçak + kırma kiremit çatı; gri su basman.
 */
export interface ApartmentOptions {
  ring: V2[];
  base: number;
  floors?: number;
  floorH?: number;
  seed: number;
}

export const FLOOR_H = 2.95;
const PLINTH = 0.45;
const WIN_W = 1.2;
const WIN_H = 1.45;
const SILL = 0.9;
const COL_PITCH = 2.7;
const BAL_D = 1.35;
const SLAB_T = 0.16;
const FASCIA_H = 0.44;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function insidePoly(r: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Halka yönünü, (−dz, dx) dış normal olacak şekilde ayarla (Builder.wall ön yüzüyle uyumlu). */
export function orientOutward(r: V2[]): V2[] {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, z0] = r[i];
    const [x1, z1] = r[(i + 1) % r.length];
    a += x0 * z1 - x1 * z0;
  }
  // a>0: x→z yönünde CCW (z aşağı ekranda) → (−dz,dx) içe bakar; ters çevir
  return a > 0 ? [...r].reverse() : r;
}

function edgeInfo(r: V2[], i: number) {
  const a = r[i];
  const e = r[(i + 1) % r.length];
  const dx = e[0] - a[0];
  const dz = e[1] - a[1];
  const len = Math.hypot(dx, dz);
  const t: V2 = [dx / len, dz / len];
  const n: V2 = [-t[1], t[0]];
  return { a, e, len, t, n };
}

/** En küçük alanlı yönlü dikdörtgen (kenar yönleri üzerinden). */
function obb(r: V2[]) {
  let best = { area: Infinity, c: [0, 0] as V2, ax: [1, 0] as V2, w: 0, d: 0 };
  for (let i = 0; i < r.length; i++) {
    const { t, len } = edgeInfo(r, i);
    if (len < 1) continue;
    const n: V2 = [-t[1], t[0]];
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of r) {
      const u = p[0] * t[0] + p[1] * t[1];
      const v = p[0] * n[0] + p[1] * n[1];
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      best = { area, c: [t[0] * uc + n[0] * vc, t[1] * uc + n[1] * vc], ax: t, w: u1 - u0, d: v1 - v0 };
    }
  }
  return best;
}

export function buildApartment(b: Builder, o: ApartmentOptions): { top: number } {
  const floors = o.floors ?? 7;
  const FH = o.floorH ?? FLOOR_H;
  const r = orientOutward(o.ring);
  const rnd = rng(o.seed);
  const y0 = o.base - 0.6;
  const yF = (k: number) => o.base + PLINTH + k * FH; // k. kat döşemesi
  const top = yF(floors) + 0.2;

  // ── Köşe balkonları: dışbükey köşe, iki kenar da yeterince uzun ──
  interface Bal {
    corner: number;
    la: number;
    lb: number;
    enclosed: boolean[];
  }
  const bals: Bal[] = [];
  for (let i = 0; i < r.length; i++) {
    const A = edgeInfo(r, (i - 1 + r.length) % r.length); // köşeye gelen kenar
    const B = edgeInfo(r, i); // köşeden çıkan kenar
    const cross = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    const convex = cross < -0.5; // dış normal (−dz,dx) düzeninde dışbükey köşe işareti
    if (!convex || A.len < 2.4 || B.len < 2.4) continue;
    const enclosed: boolean[] = [];
    for (let k = 0; k < floors; k++) enclosed.push(rnd() < 0.2);
    bals.push({ corner: i, la: Math.min(3.3, A.len * 0.62), lb: Math.min(3.3, B.len * 0.62), enclosed });
  }
  // Kenar başına balkonla kaplı aralıklar (kapı-pencere için)
  const balSpan = new Map<number, [number, number][]>();
  const addSpan = (edge: number, s0: number, s1: number) => {
    if (!balSpan.has(edge)) balSpan.set(edge, []);
    balSpan.get(edge)!.push([s0, s1]);
  };
  for (const bl of bals) {
    const ea = (bl.corner - 1 + r.length) % r.length;
    const lenA = edgeInfo(r, ea).len;
    addSpan(ea, lenA - bl.la, lenA);
    addSpan(bl.corner, 0, bl.lb);
  }

  // ── Duvarlar, pencereler, şeritler ──
  for (let i = 0; i < r.length; i++) {
    const { a, e, len, t, n } = edgeInfo(r, i);
    if (len < 0.05) continue;
    // Su basmanı (gri) ve sıva
    b.wall('plinth', a, e, y0, o.base + PLINTH, [0, 0, len, PLINTH + 0.6]);
    b.wall('plaster', a, e, o.base + PLINTH, top, [0, 0, len / 2, (top - o.base - PLINTH) / 2]);
    if (len < 1.5) continue;
    let nCols = Math.max(1, Math.floor((len - 0.5) / COL_PITCH));
    const ww = Math.min(WIN_W, len - 0.6);
    if (ww < 0.5) nCols = 0;
    const spans = balSpan.get(i) ?? [];
    const P = (s: number, off = 0): V2 => [a[0] + t[0] * s + n[0] * off, a[1] + t[1] * s + n[1] * off];
    for (let c = 0; c < nCols; c++) {
      const s = ((c + 0.5) / nCols) * len;
      const onBal = spans.some(([s0, s1]) => s > s0 - 0.2 && s < s1 + 0.2);
      // Şerit: dar duvarlarda her sütun, geniş duvarlarda dönüşümlü
      if (nCols <= 2 || c % 2 === 0) {
        for (const side of [-1, 1]) {
          const sx = s + side * (ww / 2 + 0.28);
          if (sx < 0.15 || sx > len - 0.15) continue;
          const p = P(sx, 0.04);
          b.box(
            'ochre',
            [p[0], (o.base + PLINTH + top) / 2, p[1]],
            [0.2, top - o.base - PLINTH, 0.08],
            Math.atan2(-t[1], t[0]),
          );
        }
      }
      for (let k = 0; k < floors; k++) {
        const door = onBal && k > 0;
        const wy0 = door ? yF(k) + 0.05 : yF(k) + SILL;
        const wy1 = door ? yF(k) + 2.25 : yF(k) + SILL + WIN_H;
        const p0 = P(s - ww / 2, 0.025);
        const p1 = P(s + ww / 2, 0.025);
        const v = Math.floor(rnd() * 4);
        b.wall(`win${v}`, p0, p1, wy0, wy1);
        if (!door) {
          // Denizlik (gri mermer)
          const ps = P(s, 0.07);
          b.box('sill', [ps[0], wy0 - 0.04, ps[1]], [ww + 0.12, 0.05, 0.14], Math.atan2(-t[1], t[0]));
        }
      }
    }
    // Çatı saçağı alın bandı (koyu gri), duvardan 0.35 m dışarıda
    const ea = P(-0.35, 0.35);
    const ee = P(len + 0.35, 0.35);
    b.wall('eave', ea, ee, top - 0.05, top + 0.4);
  }

  // ── Balkonlar ──
  for (const bl of bals) {
    const A = edgeInfo(r, (bl.corner - 1 + r.length) % r.length);
    const B = edgeInfo(r, bl.corner);
    const c = r[bl.corner];
    const pA: V2 = [c[0] - A.t[0] * bl.la, c[1] - A.t[1] * bl.la];
    const pB: V2 = [c[0] + B.t[0] * bl.lb, c[1] + B.t[1] * bl.lb];
    const oA: V2 = [pA[0] + A.n[0] * BAL_D, pA[1] + A.n[1] * BAL_D];
    const oB: V2 = [pB[0] + B.n[0] * BAL_D, pB[1] + B.n[1] * BAL_D];
    const oc: V2 = [c[0] + (A.n[0] + B.n[0]) * BAL_D, c[1] + (A.n[1] + B.n[1]) * BAL_D];
    // Pahlı köşe
    const ch = 0.55;
    const oc1: V2 = [oc[0] - A.t[0] * ch, oc[1] - A.t[1] * ch];
    const oc2: V2 = [oc[0] + B.t[0] * ch, oc[1] + B.t[1] * ch];
    const outer: V2[] = [oA, oc1, oc2, oB];
    const slab: V2[] = [pA, c, pB, oB, oc2, oc1, oA];
    for (let k = 1; k <= floors; k++) {
      const ys = yF(k); // döşeme üstü (k = floors → çatı altı saçak)
      b.polygon('slabTop', slab, ys, true, 0.5);
      b.polygon('slabBottom', slab, ys - SLAB_T, false, 0.5);
      // Alın bandı (dış kenarlar + yanlar)
      const edges: [V2, V2][] = [
        [pA, oA],
        [oA, oc1],
        [oc1, oc2],
        [oc2, oB],
        [oB, pB],
      ];
      for (const [p, q] of edges) b.wall('fascia', p, q, ys - FASCIA_H, ys + 0.04);
      if (k === floors) continue; // en üst: çatı altı
      if (bl.enclosed[k]) {
        for (let j = 0; j + 1 < outer.length; j++)
          b.wall('glazing', outer[j], outer[j + 1], ys + 0.04, ys + FH - SLAB_T - 0.02, [
            0,
            0,
            Math.hypot(outer[j + 1][0] - outer[j][0], outer[j + 1][1] - outer[j][1]) / 0.8,
            1,
          ]);
        b.wall('glazing', pA, oA, ys + 0.04, ys + FH - SLAB_T - 0.02, [0, 0, BAL_D / 0.8, 1]);
        b.wall('glazing', oB, pB, ys + 0.04, ys + FH - SLAB_T - 0.02, [0, 0, BAL_D / 0.8, 1]);
      } else {
        const rail = [pA, ...outer, pB];
        for (let j = 0; j + 1 < rail.length; j++) {
          b.wall('glass', rail[j], rail[j + 1], ys + 0.04, ys + 1.0);
          const m: V2 = [(rail[j][0] + rail[j + 1][0]) / 2, (rail[j][1] + rail[j + 1][1]) / 2];
          const L = Math.hypot(rail[j + 1][0] - rail[j][0], rail[j + 1][1] - rail[j][1]);
          const yaw = Math.atan2(-(rail[j + 1][1] - rail[j][1]), rail[j + 1][0] - rail[j][0]);
          b.box('rail', [m[0], ys + 1.02, m[1]], [L, 0.05, 0.06], yaw);
        }
        // Çanak anten (bazı balkonlarda)
        if (rnd() < 0.25) {
          const d = oc1;
          b.cylinder('dish', [d[0] - A.n[0] * 0.3, ys + 1.0, d[1] - A.n[1] * 0.3], 0.3, 0.06, 10);
        }
      }
    }
  }

  // ── Çatı: saçak tabanı + kırma kiremit (yönlü dikdörtgen üzerinde) ──
  const bx = obb(r);
  const ax = bx.ax;
  const nx: V2 = [-ax[1], ax[0]];
  const W = bx.w / 2 + 0.45;
  const D = bx.d / 2 + 0.45;
  const C = (u: number, v: number): V2 => [bx.c[0] + ax[0] * u + nx[0] * v, bx.c[1] + ax[1] * u + nx[1] * v];
  const yr = top + 0.4;
  const rise = Math.min(W, D) * 0.55;
  const p00 = C(-W, -D);
  const p10 = C(W, -D);
  const p11 = C(W, D);
  const p01 = C(-W, D);
  b.polygon('eaveBottom', [p00, p10, p11, p01], yr - 0.02, false, 0.5);
  const long = W >= D;
  const hr = long ? W - D : D - W; // sırt yarı uzunluğu
  const r0 = long ? C(-hr, 0) : C(0, -hr);
  const r1 = long ? C(hr, 0) : C(0, hr);
  const ry = yr + rise;
  const V = (p: V2, y: number): [number, number, number] => [p[0], y, p[1]];
  // Yamuk ve üçgen yüzler (dışa bakan sıra)
  const faces: [V2, V2, V2, V2][] = long
    ? [
        [p00, p10, r1, r0],
        [p11, p01, r0, r1],
      ]
    : [
        [p10, p11, r1, r0],
        [p01, p00, r0, r1],
      ];
  for (const [q0, q1, q2, q3] of faces) {
    b.quad('roof', V(q0, yr), V(q1, yr), V(q2, ry), V(q3, ry), [
      0,
      0,
      Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / 2,
      rise / 1.5,
    ]);
  }
  const tri: [V2, V2, V2][] = long
    ? [
        [p10, p11, r1],
        [p01, p00, r0],
      ]
    : [
        [p11, p01, r1],
        [p00, p10, r0],
      ];
  for (const [q0, q1, q2] of tri)
    b.quad('roof', V(q0, yr), V(q1, yr), V(q2, ry), V(q2, ry), [0, 0, 2, rise / 1.5]);
  // Saçak kenarı (dikdörtgen çevresi)
  for (const [q0, q1] of [
    [p00, p10],
    [p10, p11],
    [p11, p01],
    [p01, p00],
  ] as [V2, V2][])
    b.wall('eave', q1, q0, yr - 0.22, yr + 0.02);
  return { top: ry };
}
