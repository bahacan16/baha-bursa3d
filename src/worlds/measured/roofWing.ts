import * as THREE from 'three';
import type { Builder, V2 } from './builder';
import { bargeDrop, GE, type RoofGable, type RoofKeys } from './roof';

/**
 * v7: açık mahyalı kanat çatıları (roof.wings) — birleşik kırma çatının (roof.ts) otomatik mahyası hava
 * fotoğrafındaki mahyayla çakışmadığında (1546358557 batı kanadı 3.3 m kaçık, 1480163634 kütle başına farklı tepe,
 * 1546358561 kulelerde alınlık). Her kanat: dışbükey taban çokgeni (dünya), mahya çizgisi (dünya iki nokta), tepe
 * kotu ya da eğim, iki ucun biçimi (gable | hip | open).
 *
 * Yüzeyler düzlemdir: mahyanın iki yanında birer eğik düzlem (tepe kotu verilirse eğimler iki yandaki saçak
 * uzaklığından türetilir → saçaklar aynı kotta, kaçık mahya asimetrik eğim verir), kırma uçta uç düzlemi. Her düzlemin
 * yüzü = saçak çokgeninin, o düzlemin en alçak olduğu bölgesi (yarı düzlem kırpması, roof.ts ile aynı yöntem).
 * Alınlık ucunda cephe düzleminde profil duvarı (çatı arası pencere boşluklarıyla) + rüzgârlık tahtası.
 */
export interface RoofWing {
  /** Kanat taban çokgeni (dünya, dışbükey); verilmezse tüm taban izi */
  poly?: [number, number][] | null;
  /** Mahya çizgisi: dünya [x, z] iki uç (ridge[0] = başlangıç ucu) */
  ridge: [[number, number], [number, number]];
  /** Mahya kotu (tabandan m); verilmezse ortalama eğimden (pitch ya da blok roof.pitch) */
  apex?: number | null;
  /** Ortalama eğim (derece), apex verilmezse */
  pitch?: number | null;
  /** Uç biçimleri [başlangıç, bitiş]: gable (alınlık duvarı) | hip (kırma) | open (başka çatıya dayanır) */
  ends?: [string, string] | null;
  /** Saçak taşması (m; verilmezse blok saçağı) */
  eave?: number | null;
}

export interface WingOpts {
  eave: number;
  pitchDeg: number;
  keys: RoofKeys;
  /** Alınlık duvarı alt kotu */
  gableBase: number;
  gableKeys?: Record<number, string>;
  /** Alınlık boşlukları (çatı arası pencereleri; unionRoof ile aynı biçim) */
  holes?: { edge: number; a: V2; e: V2; y0: number; y1: number; round?: boolean }[];
  /** Kanat kenarı taban izi kenarı üzerindeyse o kenarın saçağı */
  eaveOf?: (edge: number) => number;
  /** Rüzgârlık tahtası / alın bandı boyu (m; ölçüm roof.barge, verilmezse 0.22) */
  bargeH?: number;
}

type P2 = [number, number];

interface Plane {
  a: number;
  g: P2;
  kind: 'side' | 'hip';
}
interface WingPlan {
  poly: P2[];
  eavePoly: P2[];
  planes: Plane[];
  /** Kanat kenarı → tür (side | gable | hip | open) ve eşleşen taban izi kenarı */
  edges: { a: P2; e: P2; kind: string; fe: number }[];
  apex: number;
  R0: P2;
  R1: P2;
}

function area(p: P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const e = p[(i + 1) % p.length];
    s += a[0] * e[1] - e[0] * a[1];
  }
  return s / 2;
}

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

const hOf = (pl: Plane, p: P2) => pl.a + pl.g[0] * p[0] + pl.g[1] * p[1];

/** Taban izi kenarı eşlemesi: kanat kenarı (a→e) bir taban izi kenarının doğrusu üzerinde ve aralığında mı */
export function footEdgeOf(ring: V2[], a: V2, e: V2): number {
  return footEdge(ring, [a[0], a[1]], [e[0], e[1]]);
}
function footEdge(ring: V2[], a: P2, e: P2): number {
  let best = -1;
  let bo = 0.2;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 0.05) continue;
    const t: P2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    const n: P2 = [-t[1], t[0]];
    const dn = (x: P2) => Math.abs((x[0] - p[0]) * n[0] + (x[1] - p[1]) * n[1]);
    if (dn(a) > 0.1 || dn(e) > 0.1) continue;
    const ua = (a[0] - p[0]) * t[0] + (a[1] - p[1]) * t[1];
    const ue = (e[0] - p[0]) * t[0] + (e[1] - p[1]) * t[1];
    const ov = Math.min(L, Math.max(ua, ue)) - Math.max(0, Math.min(ua, ue));
    if (ov > bo) {
      bo = ov;
      best = i;
    }
  }
  return best;
}

function planWing(ring: V2[], w: RoofWing, y: number, base: number, o: WingOpts): WingPlan | null {
  let poly: P2[] = (w.poly?.length ? w.poly : ring).map((p) => [p[0], p[1]] as P2);
  if (poly.length < 3) return null;
  if (area(poly) < 0) poly = poly.slice().reverse();
  const R0: P2 = [w.ridge[0][0], w.ridge[0][1]];
  const R1: P2 = [w.ridge[1][0], w.ridge[1][1]];
  const rl = Math.hypot(R1[0] - R0[0], R1[1] - R0[1]);
  if (rl < 0.1) return null;
  const r: P2 = [(R1[0] - R0[0]) / rl, (R1[1] - R0[1]) / rl];
  const nL: P2 = [-r[1], r[0]];
  const ends = w.ends ?? ['gable', 'gable'];
  const L = poly.length;
  const rm: P2 = [(R0[0] + R1[0]) / 2, (R0[1] + R1[1]) / 2];
  // Kenar türleri + dışa taşma
  const edges: WingPlan['edges'] = [];
  const offs: number[] = [];
  for (let k = 0; k < L; k++) {
    const a = poly[k];
    const e = poly[(k + 1) % L];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    const t: P2 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len];
    const m: P2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    const fe = footEdge(ring, a, e);
    let kind = 'side';
    if (Math.abs(t[0] * r[0] + t[1] * r[1]) < 0.35) {
      const atStart = (m[0] - rm[0]) * r[0] + (m[1] - rm[1]) * r[1] < 0;
      kind = ends[atStart ? 0 : 1] ?? 'gable';
      if (kind !== 'gable' && kind !== 'hip' && kind !== 'open') kind = 'gable';
    }
    const ev = w.eave ?? (fe >= 0 && o.eaveOf ? o.eaveOf(fe) : o.eave);
    offs.push(kind === 'gable' ? GE : kind === 'open' ? 0 : Math.max(0, ev));
    edges.push({ a, e, kind, fe });
  }
  // Saçak çokgeni: her kenar doğrusu dışa (CCW: (tz, −tx)) kendi taşması kadar ötelenir, komşu doğrular kesişir
  const lines = poly.map((a, k) => {
    const e = poly[(k + 1) % L];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    const t: P2 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len];
    const n: P2 = [t[1], -t[0]];
    return { p: [a[0] + n[0] * offs[k], a[1] + n[1] * offs[k]] as P2, t };
  });
  const eavePoly: P2[] = [];
  for (let k = 0; k < L; k++) {
    const A = lines[(k + L - 1) % L];
    const B = lines[k];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 1e-6) {
      eavePoly.push(B.p);
      continue;
    }
    const s = ((B.p[0] - A.p[0]) * B.t[1] - (B.p[1] - A.p[1]) * B.t[0]) / den;
    eavePoly.push([A.p[0] + A.t[0] * s, A.p[1] + A.t[1] * s]);
  }
  // Mahyadan saçak uzaklıkları (iki yan, iki uç)
  const dn = (p: P2) => (p[0] - R0[0]) * nL[0] + (p[1] - R0[1]) * nL[1];
  const dr = (p: P2) => (p[0] - R0[0]) * r[0] + (p[1] - R0[1]) * r[1];
  const dL = Math.max(0.2, ...eavePoly.map(dn));
  const dR = Math.max(0.2, ...eavePoly.map((p) => -dn(p)));
  const dS = Math.max(0.2, ...eavePoly.map((p) => -dr(p)));
  const dE = Math.max(0.2, ...eavePoly.map((p) => dr(p) - rl));
  const tanM = Math.tan(((w.pitch ?? o.pitchDeg) * Math.PI) / 180);
  const apex = w.apex != null ? base + w.apex : y + tanM * ((dL + dR) / 2);
  const rise = Math.max(0.05, apex - y);
  const tL = rise / dL;
  const tR = rise / dR;
  const c0 = R0[0] * nL[0] + R0[1] * nL[1];
  const planes: Plane[] = [
    { a: apex + tL * c0, g: [-tL * nL[0], -tL * nL[1]], kind: 'side' },
    { a: apex - tR * c0, g: [tR * nL[0], tR * nL[1]], kind: 'side' },
  ];
  const r0 = R0[0] * r[0] + R0[1] * r[1];
  const r1 = R1[0] * r[0] + R1[1] * r[1];
  if (ends[0] === 'hip') {
    const tS = rise / dS;
    planes.push({ a: apex - tS * r0, g: [tS * r[0], tS * r[1]], kind: 'hip' });
  }
  if (ends[1] === 'hip') {
    const tE = rise / dE;
    planes.push({ a: apex + tE * r1, g: [-tE * r[0], -tE * r[1]], kind: 'hip' });
  }
  return { poly, eavePoly, planes, edges, apex, R0, R1 };
}

function inPoly(r: P2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Kanat çatılarının yüzey yüksekliği (dünya noktası; kanat dışında null) */
export function wingHeightAt(
  ring: V2[],
  wings: RoofWing[],
  y: number,
  base: number,
  o: WingOpts,
): (p: V2) => number | null {
  const plans = wings.map((w) => planWing(ring, w, y, base, o)).filter((p): p is WingPlan => !!p);
  return (p: V2) => {
    let best: number | null = null;
    for (const pl of plans) {
      if (!inPoly(pl.eavePoly, p[0], p[1])) continue;
      const h = Math.min(...pl.planes.map((q) => hOf(q, p)));
      if (best == null || h > best) best = h;
    }
    return best;
  };
}

/** Alınlık ucunda profil: kanat kenarı boyunca [s, yükseklik] (a'dan), mahya geçişi dahil */
function gableProf(pl: WingPlan, a: P2, e: P2): P2[] {
  const len = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
  const t: P2 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len];
  const sides = pl.planes.filter((q) => q.kind === 'side');
  const h = (s: number) => {
    const p: P2 = [a[0] + t[0] * s, a[1] + t[1] * s];
    return Math.min(...sides.map((q) => hOf(q, p)));
  };
  const ss = [0, len];
  // Mahya doğrusunun kenarı kestiği nokta
  const r: P2 = [pl.R1[0] - pl.R0[0], pl.R1[1] - pl.R0[1]];
  const den = t[0] * r[1] - t[1] * r[0];
  if (Math.abs(den) > 1e-6) {
    const s = ((pl.R0[0] - a[0]) * r[1] - (pl.R0[1] - a[1]) * r[0]) / den;
    if (s > 0.01 && s < len - 0.01) ss.push(s);
  }
  return ss.sort((p, q) => p - q).map((s) => [s, h(s)] as P2);
}

/** Alınlık profilleri (çizimsiz): facade.ts alınlık kenarı kırpması / çatı arası pencereleri için */
export function wingGables(ring: V2[], wings: RoofWing[], y: number, base: number, o: WingOpts): RoofGable[] {
  const out: RoofGable[] = [];
  for (const w of wings) {
    const pl = planWing(ring, w, y, base, o);
    if (!pl) continue;
    for (const ed of pl.edges) {
      if (ed.kind !== 'gable' || ed.fe < 0) continue;
      const len = Math.hypot(ed.e[0] - ed.a[0], ed.e[1] - ed.a[1]) || 1;
      const t: P2 = [(ed.e[0] - ed.a[0]) / len, (ed.e[1] - ed.a[1]) / len];
      out.push({
        edge: ed.fe,
        prof: gableProf(pl, ed.a, ed.e).map(([s, h]) => [ed.a[0] + t[0] * s, ed.a[1] + t[1] * s, h]),
      });
    }
  }
  return out;
}

/** Kanat çatılarını çizer; tepe kotunu döndürür */
export function wingRoofs(
  b: Builder,
  ring: V2[],
  wings: RoofWing[],
  y: number,
  base: number,
  o: WingOpts,
): number {
  let top = y;
  const tri = (key: string, pts: P2[], hs: number[], uvs: P2[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        pts.flatMap((p, k) => [p[0], hs[k], p[1]]),
        3,
      ),
    );
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
    const idx: number[] = [];
    for (let k = 1; k + 1 < pts.length; k++) idx.push(0, k, k + 1);
    g.setIndex(idx);
    g.computeVertexNormals();
    // Yukarı bakmıyorsa sırayı çevir
    if (g.attributes.normal.getY(0) < 0) {
      const r: number[] = [];
      for (let q = 0; q < idx.length; q += 3) r.push(idx[q], idx[q + 2], idx[q + 1]);
      g.setIndex(r);
      g.computeVertexNormals();
    }
    b.geometry(key, g);
  };
  for (const w of wings) {
    const pl = planWing(ring, w, y, base, o);
    if (!pl) continue;
    top = Math.max(top, pl.apex);
    // Yüzeyler: her düzlem, diğer tüm düzlemlerden alçak olduğu bölgede
    for (const s of pl.planes) {
      let poly = pl.eavePoly;
      for (const q of pl.planes) {
        if (q === s) continue;
        poly = clip(poly, [s.g[0] - q.g[0], s.g[1] - q.g[1]], q.a - s.a);
        if (poly.length < 3) break;
      }
      if (poly.length < 3 || Math.abs(area(poly)) < 1e-4) continue;
      const gl = Math.hypot(s.g[0], s.g[1]) || 1e-6;
      const gd: P2 = [s.g[0] / gl, s.g[1] / gl];
      const tu: P2 = [-gd[1], gd[0]];
      const cosA = Math.cos(Math.atan(gl));
      const uvs = poly.map(
        (p) => [(tu[0] * p[0] + tu[1] * p[1]) / 2, (gd[0] * p[0] + gd[1] * p[1]) / cosA / 1.5] as P2,
      );
      tri(
        o.keys.roof,
        poly,
        poly.map((p) => hOf(s, p)),
        uvs,
      );
    }
    // Saçak altı (düz, saçak kotunda) — açık uçlu kenarlarda taşma yok
    tri(
      o.keys.soffit,
      [...pl.eavePoly].reverse(),
      pl.eavePoly.map(() => y - 0.02),
      [...pl.eavePoly].reverse().map((p) => [p[0], p[1]] as P2),
    );
    const L = pl.poly.length;
    for (let k = 0; k < L; k++) {
      const ed = pl.edges[k];
      const ea = pl.eavePoly[k];
      const ee = pl.eavePoly[(k + 1) % L];
      const hAt = (p: P2) => Math.min(...pl.planes.map((q) => hOf(q, p)));
      if (ed.kind === 'side' || ed.kind === 'hip') {
        // Saçak alnı: saçak kenarında, düzlem kotunu izleyen 0.33 m bant (iki uçta kendi kotu)
        const ha = hAt(ea);
        const he = hAt(ee);
        const len = Math.hypot(ee[0] - ea[0], ee[1] - ea[1]);
        // Dışa bakan yüz (CCW çokgende a→e için sağ taraf dış): p0=a alt, p1=e alt, p3=a üst
        b.quad(
          o.keys.fascia,
          [ea[0], ha - 0.3, ea[1]],
          [ee[0], he - 0.3, ee[1]],
          [ee[0], he + 0.03, ee[1]],
          [ea[0], ha + 0.03, ea[1]],
          [0, 0, len, 0.33],
        );
        b.quad(
          o.keys.fascia,
          [ee[0], he - 0.3, ee[1]],
          [ea[0], ha - 0.3, ea[1]],
          [ea[0], ha + 0.03, ea[1]],
          [ee[0], he + 0.03, ee[1]],
          [0, 0, len, 0.33],
        );
        continue;
      }
      if (ed.kind !== 'gable') continue;
      // Alınlık duvarı: cephe düzleminde (kanat kenarı), taban gableBase, üst profil
      const a = ed.a;
      const e = ed.e;
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
      const t: P2 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len];
      const prof = gableProf(pl, a, e);
      const yb = o.gableBase;
      const shape: P2[] = [[0, yb], [len, yb], ...[...prof].reverse().map((q) => [q[0], q[1]] as P2)];
      const holes: P2[][] = [];
      for (const hh of o.holes ?? []) {
        if (hh.edge !== ed.fe) continue;
        const sa = (hh.a[0] - a[0]) * t[0] + (hh.a[1] - a[1]) * t[1];
        const se = (hh.e[0] - a[0]) * t[0] + (hh.e[1] - a[1]) * t[1];
        const lo = Math.max(0.05, Math.min(sa, se));
        const hi = Math.min(len - 0.05, Math.max(sa, se));
        if (hi - lo < 0.1 || hh.y1 - hh.y0 < 0.1 || hh.y0 < yb + 0.02) continue;
        const pAt = (s: number) => {
          for (let q = 0; q + 1 < prof.length; q++)
            if (s >= prof[q][0] - 1e-6 && s <= prof[q + 1][0] + 1e-6) {
              const f = (s - prof[q][0]) / (prof[q + 1][0] - prof[q][0] || 1);
              return prof[q][1] + (prof[q + 1][1] - prof[q][1]) * f;
            }
          return yb;
        };
        if (hh.y1 > Math.min(pAt(lo), pAt(hi)) - 0.03) continue;
        if (hh.round) {
          const cx = (lo + hi) / 2;
          const cy = (hh.y0 + hh.y1) / 2;
          holes.push(
            Array.from({ length: 24 }, (_, q) => {
              const th = (-q / 24) * Math.PI * 2;
              return [cx + (Math.cos(th) * (hi - lo)) / 2, cy + (Math.sin(th) * (hh.y1 - hh.y0)) / 2] as P2;
            }),
          );
        } else
          holes.push([
            [lo, hh.y0],
            [lo, hh.y1],
            [hi, hh.y1],
            [hi, hh.y0],
          ]);
      }
      const tris = THREE.ShapeUtils.triangulateShape(
        shape.map((p) => new THREE.Vector2(p[0], p[1])),
        holes.map((hh) => hh.map((p) => new THREE.Vector2(p[0], p[1]))),
      );
      const all = [...shape, ...holes.flat()];
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          all.flatMap((p) => [a[0] + t[0] * p[0], p[1], a[1] + t[1] * p[0]]),
          3,
        ),
      );
      g.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          all.flatMap((p) => [p[0], p[1]]),
          2,
        ),
      );
      const idx: number[] = [];
      for (const tr of tris) idx.push(tr[0], tr[1], tr[2]);
      g.setIndex(idx);
      g.computeVertexNormals();
      // Dışa bakan yüz: CCW çokgende (tz, −tx)
      const out: P2 = [t[1], -t[0]];
      const nr = g.attributes.normal;
      if (nr.getX(0) * out[0] + nr.getZ(0) * out[1] < 0) {
        for (let q = 0; q < idx.length; q += 3) [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
        g.setIndex(idx);
        g.computeVertexNormals();
      }
      b.geometry((ed.fe >= 0 ? o.gableKeys?.[ed.fe] : undefined) ?? o.keys.gable, g);
      // Rüzgârlık tahtası: saçak çokgeninin uç kenarında (GE önde), profili izleyen bant (iki yüz)
      const lenE = Math.hypot(ee[0] - ea[0], ee[1] - ea[1]) || 1;
      const tE: P2 = [(ee[0] - ea[0]) / lenE, (ee[1] - ea[1]) / lenE];
      const profE = gableProf(pl, ea, ee);
      for (let q = 0; q + 1 < profE.length; q++) {
        const [sa, ha] = profE[q];
        const [se, he] = profE[q + 1];
        const A: [number, number] = [ea[0] + tE[0] * sa, ea[1] + tE[1] * sa];
        const B: [number, number] = [ea[0] + tE[0] * se, ea[1] + tE[1] * se];
        const bd = bargeDrop(o.bargeH);
        b.quad(
          o.keys.fascia,
          [A[0], ha - bd, A[1]],
          [B[0], he - bd, B[1]],
          [B[0], he + 0.02, B[1]],
          [A[0], ha + 0.02, A[1]],
        );
        b.quad(
          o.keys.fascia,
          [B[0], he - bd, B[1]],
          [A[0], ha - bd, A[1]],
          [A[0], ha + 0.02, A[1]],
          [B[0], he + 0.02, B[1]],
        );
      }
    }
  }
  return top;
}
