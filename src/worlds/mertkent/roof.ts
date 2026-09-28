import * as THREE from 'three';
import type { Builder, V2 } from './builder';

/**
 * Basamaklı taban izine oturan kırma çatı (Mertkent blokları, hava fotoğrafında: her çıkıntının kendi kırması,
 * iç köşelerde dere, ortada düz gri teras/ışıklık, bazı uçlarda alınlık).
 *
 * Yöntem: taban izi baskın eksene göre dik açılı hücrelere bölünür, hücreleri kaplayan en büyük dikdörtgenler
 * bulunur; her dikdörtgene (kesik) kırma çatı konur. Kırma çatıların yükseklik alanlarının birleşimi (en büyüğü)
 * dik açılı çokgenlerde düz iskelet (straight skeleton) çatısına eşittir — üst üste binen yüzler aynı düzlemde ve
 * aynı dünya UV'sinde olduğundan görünür dikiş yok. Yüzler dışbükey yarı düzlem kırpmasıyla tam üretilir.
 */
export interface RoofKeys {
  roof: string;
  soffit: string;
  fascia: string;
  gable: string;
  terrace: string;
}

export interface UnionRoofOptions {
  eave: number;
  pitchDeg: number;
  /** Alınlık (düşey üçgen duvar) olan taban izi kenarları */
  gableEdges?: number[];
  /** Düz teras: saçaktan içeri bu yatay mesafeden sonra düz (m); yoksa sivri */
  terraceInset?: number;
  keys: RoofKeys;
}

type P2 = [number, number];

/** Dışbükey çokgeni n·p ≤ c yarı düzlemine kırp (Sutherland–Hodgman) */
function clip(poly: P2[], n: P2, c: number): P2[] {
  const out: P2[] = [];
  const f = (p: P2) => n[0] * p[0] + n[1] * p[1] - c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const e = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fe = f(e);
    if (fa <= 1e-9) out.push(a);
    if ((fa < -1e-9 && fe > 1e-9) || (fa > 1e-9 && fe < -1e-9)) {
      const t = fa / (fa - fe);
      out.push([a[0] + (e[0] - a[0]) * t, a[1] + (e[1] - a[1]) * t]);
    }
  }
  return out;
}

function area(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const e = poly[(i + 1) % poly.length];
    s += a[0] * e[1] - e[0] * a[1];
  }
  return s / 2;
}

function insideRing(r: P2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Yakın değerleri kümele (tolerans içinde ortalama) */
function cluster(vals: number[], tol: number): number[] {
  const s = [...vals].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1] < tol) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Çatı; tepe kotunu döndürür */
export function unionRoof(b: Builder, ring: V2[], y: number, o: UnionRoofOptions): number {
  const tanP = Math.tan((o.pitchDeg * Math.PI) / 180);
  // Baskın eksen: en küçük alanlı yönlü sınır kutusu
  let best: { area: number; t: P2 } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const e = ring[(i + 1) % ring.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 1) continue;
    const t: P2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of ring) {
      const u = p[0] * t[0] + p[1] * t[1];
      const v = -p[0] * t[1] + p[1] * t[0];
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.area - 1e-6) best = { area: A, t };
  }
  if (!best) return y;
  const t = best.t;
  const toUV = (p: V2): P2 => [p[0] * t[0] + p[1] * t[1], -p[0] * t[1] + p[1] * t[0]];
  const toXZ = (q: P2): P2 => [q[0] * t[0] - q[1] * t[1], q[0] * t[1] + q[1] * t[0]];
  const R = ring.map(toUV);
  // Dik açılı ızgara
  const U = cluster(
    R.map((p) => p[0]),
    0.4,
  );
  const V = cluster(
    R.map((p) => p[1]),
    0.4,
  );
  const nu = U.length - 1;
  const nv = V.length - 1;
  if (nu < 1 || nv < 1) return y;
  const cell: boolean[][] = [];
  for (let i = 0; i < nu; i++) {
    cell.push([]);
    for (let j = 0; j < nv; j++) cell[i].push(insideRing(R, (U[i] + U[i + 1]) / 2, (V[j] + V[j + 1]) / 2));
  }
  const full = (i0: number, i1: number, j0: number, j1: number) => {
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!cell[i]?.[j]) return false;
    return true;
  };
  // En büyük dikdörtgenler: satır koşularını dikey, sütun koşularını yatay büyüt
  const rects: [number, number, number, number][] = [];
  const addR = (r: [number, number, number, number]) => {
    if (!rects.some((q) => q[0] === r[0] && q[1] === r[1] && q[2] === r[2] && q[3] === r[3])) rects.push(r);
  };
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      if (!cell[i][j] || (i > 0 && cell[i - 1][j])) continue;
      let i1 = i;
      while (i1 + 1 < nu && cell[i1 + 1][j]) i1++;
      let j0 = j;
      let j1 = j;
      while (j0 > 0 && full(i, i1, j0 - 1, j0 - 1)) j0--;
      while (j1 + 1 < nv && full(i, i1, j1 + 1, j1 + 1)) j1++;
      addR([i, i1, j0, j1]);
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      if (!cell[i][j] || (j > 0 && cell[i][j - 1])) continue;
      let j1 = j;
      while (j1 + 1 < nv && cell[i][j1 + 1]) j1++;
      let i0 = i;
      let i1 = i;
      while (i0 > 0 && full(i0 - 1, i0 - 1, j, j1)) i0--;
      while (i1 + 1 < nu && full(i1 + 1, i1 + 1, j, j1)) i1++;
      addR([i0, i1, j, j1]);
    }
  // Başkasının içinde kalanları at
  const keep = rects.filter(
    (r) => !rects.some((q) => q !== r && q[0] <= r[0] && q[1] >= r[1] && q[2] <= r[2] && q[3] >= r[3]),
  );
  // Alınlık kenarları (u/v çizgileri)
  const gableLines: { axis: 0 | 1; at: number; lo: number; hi: number }[] = [];
  for (const gi of o.gableEdges ?? []) {
    const a = R[gi % R.length];
    const e = R[(gi + 1) % R.length];
    if (!a || !e) continue;
    if (Math.abs(a[0] - e[0]) < Math.abs(a[1] - e[1]))
      gableLines.push({
        axis: 0,
        at: (a[0] + e[0]) / 2,
        lo: Math.min(a[1], e[1]),
        hi: Math.max(a[1], e[1]),
      });
    else
      gableLines.push({
        axis: 1,
        at: (a[1] + e[1]) / 2,
        lo: Math.min(a[0], e[0]),
        hi: Math.max(a[0], e[0]),
      });
  }
  const eave = o.eave;
  const GE = 0.15; // alınlık taşması
  const T = o.terraceInset;
  let top = y;
  const V3 = (q: P2, h: number): [number, number, number] => {
    const p = toXZ(q);
    return [p[0], h, p[1]];
  };
  // Dünya UV'si (aynı düzlemdeki üst üste yüzler aynı dokuyu görsün): eğim yönünde gerçek uzunluk
  const tri = (key: string, pts: P2[], hs: number[], uvs: P2[]) => {
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    const uv: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      pos.push(...V3(pts[k], hs[k]));
      uv.push(uvs[k][0], uvs[k][1]);
    }
    const idx: number[] = [];
    for (let k = 1; k + 1 < pts.length; k++) idx.push(0, k, k + 1);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    b.geometry(key, g);
  };
  const boxes: Rect[] = [];
  for (const [i0, i1, j0, j1] of keep) {
    const r: Rect = { u0: U[i0], u1: U[i1 + 1], v0: V[j0], v1: V[j1 + 1] };
    // Kenar türü: dış sınırda saçak taşması, alınlık çizgisindeyse alınlık
    const isGable = (axis: 0 | 1, at: number, lo: number, hi: number) =>
      gableLines.some(
        (g) =>
          g.axis === axis &&
          Math.abs(g.at - at) < 0.4 &&
          Math.min(g.hi, hi) - Math.max(g.lo, lo) > 0.5 * (hi - lo),
      );
    const outer = (side: 0 | 1 | 2 | 3) => {
      if (side === 0) return i0 === 0 || !full(i0 - 1, i0 - 1, j0, j1);
      if (side === 1) return i1 === nu - 1 || !full(i1 + 1, i1 + 1, j0, j1);
      if (side === 2) return j0 === 0 || !full(i0, i1, j0 - 1, j0 - 1);
      return j1 === nv - 1 || !full(i0, i1, j1 + 1, j1 + 1);
    };
    const gab = [
      isGable(0, r.u0, r.v0, r.v1),
      isGable(0, r.u1, r.v0, r.v1),
      isGable(1, r.v0, r.u0, r.u1),
      isGable(1, r.v1, r.u0, r.u1),
    ];
    const ex = [0, 1, 2, 3].map((s) => (gab[s] ? GE : outer(s as 0 | 1 | 2 | 3) ? eave : 0));
    const e: Rect = { u0: r.u0 - ex[0], u1: r.u1 + ex[1], v0: r.v0 - ex[2], v1: r.v1 + ex[3] };
    boxes.push(e);
    // Kenar düzlemleri: n·p − c = saçaktan içeri yatay mesafe
    const sides: { n: P2; c: number; gable: boolean }[] = [
      { n: [1, 0], c: e.u0, gable: gab[0] },
      { n: [-1, 0], c: -e.u1, gable: gab[1] },
      { n: [0, 1], c: e.v0, gable: gab[2] },
      { n: [0, -1], c: -e.v1, gable: gab[3] },
    ];
    const act = sides.filter((s) => !s.gable);
    const base: P2[] = [
      [e.u0, e.v0],
      [e.u1, e.v0],
      [e.u1, e.v1],
      [e.u0, e.v1],
    ];
    const d = (s: { n: P2; c: number }, p: P2) => s.n[0] * p[0] + s.n[1] * p[1] - s.c;
    const yE = y;
    const hOf = (p: P2) => {
      let m = Infinity;
      for (const s of act) m = Math.min(m, d(s, p));
      if (T != null) m = Math.min(m, T);
      return yE + (Number.isFinite(m) ? m : 0) * tanP;
    };
    for (const s of act) {
      let poly = base;
      for (const q of act) {
        if (q === s) continue;
        poly = clip(poly, [s.n[0] - q.n[0], s.n[1] - q.n[1]], s.c - q.c);
        if (poly.length < 3) break;
      }
      if (T != null && poly.length >= 3) poly = clip(poly, s.n, s.c + T);
      if (poly.length < 3 || Math.abs(area(poly)) < 1e-4) continue;
      if (area(poly) < 0) poly.reverse();
      // Yukarı bakan yüz: (u,v) → (x,z) dönüşümü yönü korur; y yukarı için saat yönü tersine xz'de ters sıra
      const hs = poly.map((p) => yE + d(s, p) * tanP);
      // UV: kenar boyunca (s dik yönü) ve eğim boyunca gerçek uzunluk / 1.5 m doku
      const tu: P2 = [-s.n[1], s.n[0]];
      const uvs = poly.map(
        (p) => [(tu[0] * p[0] + tu[1] * p[1]) / 2, d(s, p) / Math.cos(Math.atan(tanP)) / 1.5] as P2,
      );
      tri(o.keys.roof, [...poly].reverse(), [...hs].reverse(), [...uvs].reverse());
      for (const h of hs) top = Math.max(top, h);
    }
    // Düz teras
    if (T != null) {
      let poly = base;
      for (const s of act) {
        poly = clip(poly, [-s.n[0], -s.n[1]], -(s.c + T));
        if (poly.length < 3) break;
      }
      if (poly.length >= 3 && Math.abs(area(poly)) > 1e-4) {
        if (area(poly) < 0) poly.reverse();
        const h = yE + T * tanP;
        tri(
          o.keys.terrace,
          [...poly].reverse(),
          poly.map(() => h),
          [...poly].reverse().map((p) => [p[0] / 2, p[1] / 2] as P2),
        );
        top = Math.max(top, h);
      }
    }
    // Alınlık duvarları: kenar boyunca çatı profili (yüz köşelerinden)
    sides.forEach((s, k) => {
      if (!s.gable) return;
      const a0 = k < 2 ? e.v0 : e.u0;
      const a1 = k < 2 ? e.v1 : e.u1;
      const N = 48;
      const prof: P2[] = [];
      for (let q = 0; q <= N; q++) {
        const a = a0 + ((a1 - a0) * q) / N;
        const p: P2 = k < 2 ? [k === 0 ? e.u0 : e.u1, a] : [a, k === 2 ? e.v0 : e.v1];
        prof.push([a, hOf(p)]);
      }
      // Profili sadeleştir (doğrusal parçalar)
      const simp: P2[] = [prof[0]];
      for (let q = 1; q + 1 < prof.length; q++) {
        const p0 = simp[simp.length - 1];
        const p2 = prof[q + 1];
        const p1 = prof[q];
        const lin = p0[1] + ((p2[1] - p0[1]) * (p1[0] - p0[0])) / (p2[0] - p0[0] || 1);
        if (Math.abs(lin - p1[1]) > 0.01) simp.push(p1);
      }
      simp.push(prof[prof.length - 1]);
      const shape = [[a0, y - 0.05] as P2, ...simp.map((p) => [p[0], p[1]] as P2), [a1, y - 0.05] as P2];
      const tris = THREE.ShapeUtils.triangulateShape(
        shape.map((p) => new THREE.Vector2(p[0], p[1])),
        [],
      );
      const at = k === 0 ? e.u0 : k === 1 ? e.u1 : k === 2 ? e.v0 : e.v1;
      const g = new THREE.BufferGeometry();
      const pos: number[] = [];
      const uv: number[] = [];
      for (const p of shape) {
        const q: P2 = k < 2 ? [at, p[0]] : [p[0], at];
        pos.push(...V3(q, p[1]));
        uv.push(p[0], p[1]);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      // Dışa bakan yüz: −n yönü; üçgen sırası normal kontrolüyle
      const idx: number[] = [];
      for (const tr of tris) idx.push(tr[0], tr[1], tr[2]);
      g.setIndex(idx);
      g.computeVertexNormals();
      const nrm = g.attributes.normal;
      const out = toXZ([-s.n[0], -s.n[1]]);
      const dot = nrm.getX(0) * out[0] + nrm.getZ(0) * out[1];
      if (dot < 0) {
        for (let q = 0; q < idx.length; q += 3) [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
        g.setIndex(idx);
        g.computeVertexNormals();
      }
      b.geometry(o.keys.gable, g);
    });
  }
  // Saçak altı ve saçak alnı: yalnızca birleşimin dış sınırında (iç kenarlar başka çatının altında kalır)
  const inOther = (self: Rect, p: P2) =>
    boxes.some(
      (q) =>
        q !== self && p[0] > q.u0 + 1e-3 && p[0] < q.u1 - 1e-3 && p[1] > q.v0 + 1e-3 && p[1] < q.v1 - 1e-3,
    );
  for (const e of boxes) {
    tri(
      o.keys.soffit,
      [
        [e.u0, e.v0],
        [e.u1, e.v0],
        [e.u1, e.v1],
        [e.u0, e.v1],
      ],
      [y - 0.02, y - 0.02, y - 0.02, y - 0.02],
      [
        [e.u0, e.v0],
        [e.u1, e.v0],
        [e.u1, e.v1],
        [e.u0, e.v1],
      ],
    );
    // Builder.wall ön yüzü (a→e) için (−dz, dx) yönünde: dışa baksın diye kenarlar bu sırada
    const edges: [P2, P2][] = [
      [
        [e.u0, e.v0],
        [e.u0, e.v1],
      ],
      [
        [e.u1, e.v1],
        [e.u1, e.v0],
      ],
      [
        [e.u1, e.v0],
        [e.u0, e.v0],
      ],
      [
        [e.u0, e.v1],
        [e.u1, e.v1],
      ],
    ];
    for (const [p, q] of edges) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.ceil(L / 0.25));
      let s0: number | null = null;
      const emit = (s1: number) => {
        if (s0 == null || s1 - s0 < 0.02) return;
        const A: P2 = [p[0] + ((q[0] - p[0]) * s0) / L, p[1] + ((q[1] - p[1]) * s0) / L];
        const E: P2 = [p[0] + ((q[0] - p[0]) * s1) / L, p[1] + ((q[1] - p[1]) * s1) / L];
        const a = toXZ(A);
        const f = toXZ(E);
        b.wall(o.keys.fascia, a, f, y - 0.3, y + 0.03, [s0, 0, s1, 0.33]);
      };
      for (let k = 0; k < n; k++) {
        const m = (L * (k + 0.5)) / n;
        const P: P2 = [p[0] + ((q[0] - p[0]) * m) / L, p[1] + ((q[1] - p[1]) * m) / L];
        const inside = inOther(e, P);
        if (!inside && s0 == null) s0 = (L * k) / n;
        if (inside && s0 != null) {
          emit((L * k) / n);
          s0 = null;
        }
      }
      emit(L);
    }
  }
  return top;
}
