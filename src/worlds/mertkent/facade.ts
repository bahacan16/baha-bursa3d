import * as THREE from 'three';
import * as pcNs from 'polygon-clipping';
import { Builder, type V2, type V3, type V4 } from './builder';

/**
 * Ölçülmüş cephe üreticisi (Street View ortofotolarından `survey/<id>.json` → `scripts/survey-compile.mjs` →
 * `data/facades.json`, gerçek metre). Her kenar için pencere sütunları, turuncu yuvarlak şeritler, balkon
 * yığınları (kat başına plan birleşimi: döşeme + gri parapet + buzlu cam + küpeşte; cam balkon; tepe şapkası),
 * yağmur boruları, klima/çanak/kamera/bayrak, giriş.
 */

type Pc = typeof pcNs;
const pc: Pc = (pcNs as unknown as { default?: Pc }).default ?? pcNs;

export interface CWin {
  t: 'win';
  u0: number;
  u1: number;
  sill: number;
  head: number;
  storeys: number[];
  kind: 'std' | 'french' | 'small' | 'door' | 'shop';
  rail: boolean;
  split: number;
  box: boolean;
}
export interface CStrip {
  t: 'strip';
  u: number;
  w: number;
  y0: number;
  y1: number;
}
export interface CBal {
  t: 'bal';
  u0: number;
  u1: number;
  d: number;
  storeys: number[];
  glazed: number[];
  tint: Record<string, string>;
  cap: boolean;
  sides: string;
}
export interface CPipe {
  t: 'pipe';
  u: number;
  off: number;
}
export interface CUnit {
  t: 'ac' | 'dish' | 'camera' | 'flag';
  u: number;
  s: number;
  y: number | null;
  onBal: boolean;
}
export interface CPanel {
  t: 'band' | 'panel';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  color: string;
  proud: number;
}
export interface CEntrance {
  t: 'entrance';
  u0: number;
  u1: number;
  kind: string;
  canopy: boolean;
  sign: string | null;
  steps: number | null;
}
export type CItem = CWin | CStrip | CBal | CPipe | CUnit | CPanel | CEntrance;

export interface CompiledBlock {
  id: number;
  name: string | null;
  ring: V2[];
  storeys: number;
  floorH: number;
  groundRaise: number;
  roof: { kind: string; eave: number; fasciaH: number; pitch?: number };
  colors: Record<string, string>;
  edges: { edge: number; len: number; seen: string; items: CItem[] }[];
}

const REVEAL = 0.12;
const FRAME = 0.06;
const SLAB = 0.16;
const PARAPET = 0.38; // gri dolu parapet üstü (döşemeden)
const RAIL = 0.92; // küpeşte
const MIN_OPEN = 0.25;

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export interface FacadeOptions {
  seed: number;
  /** Zemin kattaki balkonlar için çarpışma (plan çokgeni, alt/üst kot) */
  collide?: (ring: [number, number][], bottom: number, top: number) => void;
  /** Blok adı levhası malzeme anahtarı */
  signKey?: string;
}

interface Edge {
  a: V2;
  e: V2;
  len: number;
  t: V2;
  n: V2;
  yaw: number;
  /** Çevre boyunca başlangıç (sürekli doku için) */
  s0: number;
}

interface Opening {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  win: CWin;
  k: number;
}

/** Plan çokgeni yardımcıları */
function area2(r: V2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

function distToRing(r: V2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const e = r[(i + 1) % r.length];
    const dx = e[0] - a[0];
    const dz = e[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return d;
}

function inside(r: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function openRing(r: [number, number][]): V2[] {
  const o = r.map((p) => [p[0], p[1]] as V2);
  if (o.length > 1) {
    const f = o[0];
    const l = o[o.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) o.pop();
  }
  return o;
}

export function buildFacadeBlock(
  b: Builder,
  blk: CompiledBlock,
  base: number,
  o: FacadeOptions,
): { top: number } {
  const ring = blk.ring.map((p) => [p[0], p[1]] as V2);
  const N = ring.length;
  const FH = blk.floorH;
  const S = blk.storeys;
  const floorY = (k: number) => base + blk.groundRaise + k * FH;
  const wallTop = floorY(S) + 0.12;
  const E: Edge[] = [];
  let per = 0;
  for (let i = 0; i < N; i++) {
    const a = ring[i];
    const e = ring[(i + 1) % N];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
    const t: V2 = len > 0 ? [(e[0] - a[0]) / len, (e[1] - a[1]) / len] : [1, 0];
    E.push({ a, e, len, t, n: [-t[1], t[0]], yaw: Math.atan2(-t[1], t[0]), s0: per });
    per += len;
  }
  const P = (i: number, u: number, off = 0): V2 => {
    const { a, t, n } = E[i];
    return [a[0] + t[0] * u + n[0] * off, a[1] + t[1] * u + n[1] * off];
  };
  const byEdge = new Map(blk.edges.map((e) => [e.edge, e.items]));
  const items = (i: number) => byEdge.get(i) ?? [];

  // ── Açıklıklar (pencere/kapı), balkon arkası varsayılan kapılar ──
  const openings: Opening[][] = E.map(() => []);
  for (let i = 0; i < N; i++) {
    const its = items(i);
    for (const it of its) {
      if (it.t !== 'win') continue;
      const u0 = Math.max(0.05, it.u0);
      const u1 = Math.min(E[i].len - 0.05, it.u1);
      if (u1 - u0 < MIN_OPEN) continue;
      for (const k of it.storeys) {
        if (k < 0 || k >= S) continue;
        const y0 = floorY(k) + Math.max(0.02, it.sill);
        const y1 = floorY(k) + Math.min(FH - 0.25, it.head);
        if (y1 - y0 < 0.3) continue;
        openings[i].push({ u0, u1, y0, y1, win: it, k });
      }
    }
    // Balkon arkası: o katta açıklık yoksa kapı (+ yer varsa pencere)
    for (const it of its) {
      if (it.t !== 'bal') continue;
      const u0 = Math.max(0.1, it.u0);
      const u1 = Math.min(E[i].len - 0.1, it.u1);
      const W = u1 - u0;
      if (W < 1.1) continue;
      for (const k of it.storeys) {
        if (k < 0 || k >= S) continue;
        const busy = openings[i].some((op) => op.k === k && op.u1 > u0 && op.u0 < u1);
        if (busy) continue;
        const h = hash(o.seed + i * 31 + k * 7 + u0);
        const dc = W >= 2.6 ? u0 + W * (h < 0.5 ? 0.28 : 0.72) : (u0 + u1) / 2;
        const door: CWin = {
          t: 'win',
          u0: dc - 0.45,
          u1: dc + 0.45,
          sill: 0.02,
          head: 2.2,
          storeys: [k],
          kind: 'door',
          rail: false,
          split: 1,
          box: false,
        };
        openings[i].push({
          u0: door.u0,
          u1: door.u1,
          y0: floorY(k) + 0.02,
          y1: floorY(k) + 2.2,
          win: door,
          k,
        });
        if (W >= 2.6) {
          const wc = h < 0.5 ? u0 + W * 0.72 : u0 + W * 0.28;
          const win: CWin = {
            ...door,
            u0: wc - 0.65,
            u1: wc + 0.65,
            sill: 0.9,
            head: 2.2,
            kind: 'std',
            split: 2,
          };
          openings[i].push({ u0: win.u0, u1: win.u1, y0: floorY(k) + 0.9, y1: floorY(k) + 2.2, win, k });
        }
      }
    }
    // Çakışan açıklıkları ayıkla (ölçüm hatası)
    openings[i].sort((p, q) => p.y0 - q.y0 || p.u0 - q.u0);
    const keep: Opening[] = [];
    for (const op of openings[i])
      if (
        !keep.some(
          (q) => q.u1 > op.u0 + 0.02 && q.u0 < op.u1 - 0.02 && q.y1 > op.y0 + 0.02 && q.y0 < op.y1 - 0.02,
        )
      )
        keep.push(op);
    openings[i] = keep;
  }

  // ── Duvarlar ──
  const y0w = base - 0.5;
  for (let i = 0; i < N; i++) {
    const { len, s0 } = E[i];
    if (len < 0.02) continue;
    wallWithOpenings(b, P, i, len, s0, y0w, wallTop, openings[i]);
    // Subasman bandı (koyu gri, zemin kat döşemesine kadar ya da en az 0.4 m)
    const yp = Math.max(base + 0.4, Math.min(floorY(0), base + 1.2));
    b.wall('mkPlinth', P(i, 0, 0.012), P(i, len, 0.012), y0w, yp, [s0, 0, s0 + len, yp - y0w]);
    for (const op of openings[i]) addWindow(b, P, E[i], i, op, o.seed);
  }

  // ── Renkli panolar / bantlar ──
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t !== 'band' && it.t !== 'panel') continue;
      const key = it.color === 'strip' ? 'mkStrip' : it.color === 'fascia' ? 'mkFascia' : 'mkPlaster2';
      const off = Math.max(0.006, it.proud);
      const u0 = Math.max(0, it.u0);
      const u1 = Math.min(E[i].len, it.u1);
      b.wall(key, P(i, u0, off), P(i, u1, off), base + it.y0, base + it.y1, [
        E[i].s0 + u0,
        it.y0,
        E[i].s0 + u1,
        it.y1,
      ]);
      if (it.proud > 0.02) {
        b.quad(
          key,
          [...xz(P(i, u0, 0), base + it.y1)],
          [...xz(P(i, u1, 0), base + it.y1)],
          [...xz(P(i, u1, off), base + it.y1)],
          [...xz(P(i, u0, off), base + it.y1)],
        );
      }
    }

  // ── Turuncu yuvarlak şeritler ──
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t !== 'strip') continue;
      const w = Math.max(0.2, Math.min(0.4, it.w * 1.15));
      const r = w / 2;
      const Lc = Math.max(0.01, it.y1 - it.y0 - w);
      const g = new THREE.CapsuleGeometry(r, Lc, 3, 10);
      g.scale(1, 1, 0.4);
      g.rotateY(E[i].yaw);
      const p = P(i, it.u, 0);
      g.translate(p[0], base + (it.y0 + it.y1) / 2, p[1]);
      b.geometry('mkStrip', g);
    }

  // ── Balkonlar: kat başına plan birleşimi ──
  const balByStorey = new Map<number, { poly: V2[]; glazed: boolean; tint: number; edge: number }[]>();
  const caps = new Map<number, V2[][]>();
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t !== 'bal') continue;
      const rect = (grow: number): V2[] => [
        P(i, it.u0 - grow, 0),
        P(i, it.u1 + grow, 0),
        P(i, it.u1 + grow, it.d + grow),
        P(i, it.u0 - grow, it.d + grow),
      ];
      for (const k of it.storeys) {
        if (k < 0 || k >= S) continue;
        if (!balByStorey.has(k)) balByStorey.set(k, []);
        const tint = it.tint[String(k)];
        balByStorey.get(k)!.push({
          poly: rect(0),
          glazed: it.glazed.includes(k),
          tint: tint === 'green' ? 1 : tint === 'dark' ? 2 : tint === 'blinds' ? 3 : 0,
          edge: i,
        });
      }
      if (it.cap && it.storeys.length) {
        const top = Math.max(...it.storeys) + 1;
        if (!caps.has(top)) caps.set(top, []);
        caps.get(top)!.push(rect(0.2));
      }
    }
  const foot: [number, number][][] = [ring.map((p) => [p[0], p[1]] as [number, number])];
  for (const [k, list] of balByStorey) {
    const y = floorY(k);
    const polys = list.map((l) => [l.poly.map((p) => [p[0], p[1]] as [number, number])]);
    let mp: pcNs.MultiPolygon;
    try {
      mp = pc.difference(pc.union(polys[0], ...polys.slice(1)), foot);
    } catch {
      continue;
    }
    for (const poly of mp) {
      const outer = openRing(poly[0]);
      if (outer.length < 3 || Math.abs(area2(outer)) < 0.2) continue;
      const holes = poly.slice(1).map(openRing);
      slab(b, outer, holes, y, 'mkSlabTop', 'mkSoffit');
      // Parapet kenarları: bina duvarına değmeyen kenarlar
      const segs = boundarySegs(outer, ring);
      // Bu çokgene düşen balkonların cam/renk bilgisi (orta noktası içeride olan ilk kayıt)
      const info = list.find((l) => {
        const c = l.poly.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
        return inside(outer, c[0], c[1]);
      });
      let run = 0;
      for (const [p, q] of segs) {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        parapet(b, p, q, y, run);
        if (info?.glazed && k + 1 <= S) {
          const yTop = floorY(k + 1) - SLAB - 0.01;
          const aux: V4 = [hash(o.seed + k * 13 + run) * 100, info.tint, 0, 0];
          b.quad(
            'mkCamGlass',
            [p[0], y + RAIL + 0.03, p[1]],
            [q[0], y + RAIL + 0.03, q[1]],
            [q[0], yTop, q[1]],
            [p[0], yTop, p[1]],
            [run, 0, run + L, 1],
            aux,
          );
          // Alt/üst alüminyum profil
          b.wall('mkRail', p, q, yTop - 0.04, yTop);
        }
        run += L;
      }
      // Tavan spotu
      if (k > 0) {
        const c = centroid(outer);
        const g = new THREE.CircleGeometry(0.08, 12)
          .rotateX(Math.PI / 2)
          .translate(c[0], y - SLAB - 0.006, c[1]);
        b.geometry('mkDownlight', g);
      }
      if (k === 0 && y - base < 2.5)
        o.collide?.(
          outer.map((p) => [p[0], p[1]]),
          y - SLAB,
          y + RAIL,
        );
    }
  }
  // Tepe şapkaları (en üst balkon üstü düz saçak plağı, kalın koyu gri alın)
  for (const [k, list] of caps) {
    const y = floorY(k);
    const polys = list.map((r) => [r.map((p) => [p[0], p[1]] as [number, number])]);
    let mp: pcNs.MultiPolygon;
    try {
      mp = pc.difference(pc.union(polys[0], ...polys.slice(1)), foot);
    } catch {
      continue;
    }
    for (const poly of mp) {
      const outer = openRing(poly[0]);
      if (outer.length < 3 || Math.abs(area2(outer)) < 0.2) continue;
      const holes = poly.slice(1).map(openRing);
      const H = Math.max(0.35, blk.roof.fasciaH ?? 0.45);
      b.polygon('mkCapTop', outer, y + H - 0.12, true, 0.5);
      b.polygon('mkSoffit', outer, y - 0.12, false, 0.5);
      void holes;
      for (const [p, q] of boundarySegs(outer, ring)) {
        const [pp, qq] = outwardOrder(outer, p, q);
        b.wall('mkFascia', pp, qq, y - 0.12, y + H - 0.12, [
          0,
          y - 0.12,
          Math.hypot(q[0] - p[0], q[1] - p[1]),
          y + H,
        ]);
      }
    }
  }

  // ── Borular, ekipman ──
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t === 'pipe') {
        const p = P(i, it.u, Math.max(0.07, it.off));
        b.cylinder('mkPipe', [p[0], base - 0.1, p[1]], 0.05, wallTop + 0.35 - base, 8);
        for (let k = 0; k <= S; k++)
          b.box('mkPipe', [p[0], floorY(k) + 1.4, p[1]], [0.14, 0.05, 0.14], E[i].yaw);
      } else if (it.t === 'ac' || it.t === 'dish' || it.t === 'camera' || it.t === 'flag') {
        unit(b, E[i], P, i, it, floorY(it.s), o.seed);
      } else if (it.t === 'entrance') {
        entrance(b, P, E[i], i, it, base, floorY(0), o.signKey);
      }
    }

  // ── Çatı: saçak alnı + kırma kiremit ──
  const eave = blk.roof.eave ?? 0.6;
  const fH = blk.roof.fasciaH ?? 0.45;
  for (let i = 0; i < N; i++) {
    const { len } = E[i];
    if (len < 0.05) continue;
    b.wall('mkFascia', P(i, 0, 0.02), P(i, len, 0.02), wallTop - 0.05, wallTop + fH, [
      E[i].s0,
      wallTop - 0.05,
      E[i].s0 + len,
      wallTop + fH,
    ]);
  }
  const top = hippedRoof(b, ring, wallTop + fH - 0.02, eave, blk.roof.pitch ?? 28);
  return { top };
}

function xz(p: V2, y: number): V3 {
  return [p[0], y, p[1]];
}

function centroid(r: V2[]): V2 {
  let x = 0;
  let z = 0;
  for (const p of r) {
    x += p[0];
    z += p[1];
  }
  return [x / r.length, z / r.length];
}

/** Çokgen sınır kenarlarından bina duvarına oturmayanlar */
function boundarySegs(outer: V2[], building: V2[]): [V2, V2][] {
  const out: [V2, V2][] = [];
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    const q = outer[(i + 1) % outer.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 0.02) continue;
    const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (distToRing(building, m[0], m[1]) < 0.03) continue;
    out.push([p, q]);
  }
  return out;
}

/** Kenarı, Builder.wall ön yüzü çokgenin dışına bakacak şekilde sırala */
function outwardOrder(poly: V2[], p: V2, q: V2): [V2, V2] {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const nx = -(q[1] - p[1]) / L;
  const nz = (q[0] - p[0]) / L;
  const m: V2 = [(p[0] + q[0]) / 2 + nx * 0.01, (p[1] + q[1]) / 2 + nz * 0.01];
  return inside(poly, m[0], m[1]) ? [q, p] : [p, q];
}

let curPoly: V2[] = [];

function slab(b: Builder, outer: V2[], holes: V2[][], y: number, top: string, bottom: string): void {
  curPoly = outer;
  if (holes.length) {
    // Delikli: THREE.Shape ile üçgenle
    const sh = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    for (const h of holes) sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
    for (const [key, yy, up] of [
      [top, y + 0.01, true],
      [bottom, y - SLAB, false],
    ] as [string, number, boolean][]) {
      const g = new THREE.ShapeGeometry(sh);
      g.rotateX(Math.PI / 2);
      if (up) {
        g.scale(1, -1, 1);
      }
      g.translate(0, yy, 0);
      b.geometry(key, g);
    }
    return;
  }
  b.polygon(top, outer, y + 0.01, true, 0.5);
  b.polygon(bottom, outer, y - SLAB, false, 0.5);
}

/** Gri dolu parapet (iki yüz + üst), buzlu cam, paslanmaz küpeşte */
function parapet(b: Builder, p0: V2, q0: V2, y: number, run: number): void {
  const [p, q] = outwardOrder(curPoly, p0, q0);
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const nx = -(q[1] - p[1]) / L;
  const nz = (q[0] - p[0]) / L;
  const T = 0.1; // parapet kalınlığı (içe)
  const pi: V2 = [p[0] - nx * T, p[1] - nz * T];
  const qi: V2 = [q[0] - nx * T, q[1] - nz * T];
  b.wall('mkFascia', p, q, y - SLAB, y + PARAPET, [run, y - SLAB, run + L, y + PARAPET]);
  b.wall('mkFascia', qi, pi, y, y + PARAPET, [run, y, run + L, y + PARAPET]);
  b.quad(
    'mkFascia',
    [pi[0], y + PARAPET, pi[1]],
    [qi[0], y + PARAPET, qi[1]],
    [q[0], y + PARAPET, q[1]],
    [p[0], y + PARAPET, p[1]],
  );
  // Buzlu cam (parapetin iç kenarına yakın), küpeşte
  const g0: V2 = [p[0] - nx * 0.05, p[1] - nz * 0.05];
  const g1: V2 = [q[0] - nx * 0.05, q[1] - nz * 0.05];
  b.wall('mkRailGlass', g0, g1, y + PARAPET, y + RAIL, [0, 0, L, 1]);
  const m: V2 = [(g0[0] + g1[0]) / 2, (g0[1] + g1[1]) / 2];
  const yaw = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
  b.box('mkRail', [m[0], y + RAIL + 0.02, m[1]], [L + 0.02, 0.04, 0.05], yaw);
  // Cam tutucu dikmeler (~1.2 m)
  const n = Math.max(1, Math.round(L / 1.2));
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    b.box(
      'mkRail',
      [g0[0] + (g1[0] - g0[0]) * f, y + (PARAPET + RAIL) / 2, g0[1] + (g1[1] - g0[1]) * f],
      [0.03, RAIL - PARAPET, 0.03],
      yaw,
    );
  }
}

type PFn = (i: number, u: number, off?: number) => V2;

/** Duvarı açıklıkların etrafında yatay bantlara bölerek örer; UV metre (çevre boyunca sürekli) */
function wallWithOpenings(
  b: Builder,
  P: PFn,
  i: number,
  len: number,
  s0: number,
  Y0: number,
  Y1: number,
  ops: Opening[],
): void {
  const ys = new Set<number>([Y0, Y1]);
  for (const o of ops) {
    ys.add(Math.max(Y0, Math.min(Y1, o.y0)));
    ys.add(Math.max(Y0, Math.min(Y1, o.y1)));
  }
  const yl = [...ys].sort((p, q) => p - q);
  for (let k = 0; k + 1 < yl.length; k++) {
    const ya = yl[k];
    const yb = yl[k + 1];
    if (yb - ya < 1e-4) continue;
    const cover = ops
      .filter((o) => o.y0 <= ya + 1e-4 && o.y1 >= yb - 1e-4)
      .map((o) => [Math.max(0, o.u0), Math.min(len, o.u1)] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    let cur = 0;
    const gaps: [number, number][] = [];
    for (const [a, e] of cover) {
      if (a > cur) gaps.push([cur, a]);
      cur = Math.max(cur, e);
    }
    if (cur < len) gaps.push([cur, len]);
    for (const [g0, g1] of gaps) {
      if (g1 - g0 < 1e-4) continue;
      b.wall('mkPlaster', P(i, g0), P(i, g1), ya, yb, [s0 + g0, ya, s0 + g1, yb]);
    }
  }
}

const KINDS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 3, 5, 5, 4];

/** Pencere/kapı: söve (içe 12 cm), mermer denizlik, beyaz PVC kasa + kayıtlar, oda gölgelendiricili cam */
function addWindow(b: Builder, P: PFn, E: Edge, i: number, op: Opening, seed: number): void {
  const { u0, u1, y0, y1, win } = op;
  const W = u1 - u0;
  const Hh = y1 - y0;
  const V = (p: V2, y: number): V3 => [p[0], y, p[1]];
  const a0 = P(i, u0);
  const a1 = P(i, u1);
  const b0 = P(i, u0, -REVEAL);
  const b1 = P(i, u1, -REVEAL);
  // Söveler + lento + iç denizlik
  b.wall('mkReveal', a0, b0, y0, y1, [0, y0, REVEAL, y1]);
  b.wall('mkReveal', b1, a1, y0, y1, [0, y0, REVEAL, y1]);
  b.quad('mkReveal', V(b0, y1), V(b1, y1), V(a1, y1), V(a0, y1), [0, 0, W, REVEAL]);
  b.quad('mkSill', V(a0, y0), V(a1, y0), V(b1, y0), V(b0, y0), [0, 0, W, REVEAL]);
  // Dış denizlik (kapı değilse)
  if (win.kind !== 'door') {
    const ps = P(i, (u0 + u1) / 2, 0.035);
    b.box('mkSill', [ps[0], y0 - 0.015, ps[1]], [W + 0.08, 0.03, 0.07], E.yaw);
  }
  // Kasa: dış çerçeve (4 kenar) + dikey kayıtlar + kapıda yatay orta kayıt
  const d = -REVEAL + 0.02;
  const bar = (uA: number, uB: number, yA: number, yB: number) => {
    const c = P(i, (uA + uB) / 2, d + 0.03);
    b.box('mkFrame', [c[0], (yA + yB) / 2, c[1]], [uB - uA, yB - yA, 0.06], E.yaw);
  };
  const F = W < 0.8 ? 0.05 : FRAME;
  bar(u0, u1, y1 - F, y1);
  bar(u0, u1, y0, y0 + F);
  bar(u0, u0 + F, y0 + F, y1 - F);
  bar(u1 - F, u1, y0 + F, y1 - F);
  const split = Math.max(1, Math.min(4, win.split || 2));
  for (let s = 1; s < split; s++) {
    const u = u0 + (W * s) / split;
    bar(u - 0.035, u + 0.035, y0 + F, y1 - F);
  }
  // Kanat kasaları (her bölmede iç çerçeve, PVC profil ~5 cm) — pencereyi "beyaz çerçeveli" gösterir
  if (W > 0.5) {
    const sw = 0.045;
    for (let s = 0; s < split; s++) {
      const a = u0 + F + ((W - 2 * F) * s) / split + (s > 0 ? 0.035 : 0);
      const e = u0 + F + ((W - 2 * F) * (s + 1)) / split - (s < split - 1 ? 0.035 : 0);
      const c = (yA: number, yB: number, uA: number, uB: number) => {
        const q = P(i, (uA + uB) / 2, d + 0.045);
        b.box('mkFrame', [q[0], (yA + yB) / 2, q[1]], [uB - uA, yB - yA, 0.03], E.yaw);
      };
      c(y1 - F - sw, y1 - F, a, e);
      c(y0 + F, y0 + F + sw, a, e);
      c(y0 + F + sw, y1 - F - sw, a, a + sw);
      c(y0 + F + sw, y1 - F - sw, e - sw, e);
    }
  }
  if (win.kind === 'door' || win.kind === 'french') {
    // Kapı/fransız pencere: ~0.9 m'de yatay kayıt (alt dolu/camlı bölme)
    const yt = y0 + Math.min(0.95, Hh * 0.42);
    if (win.kind === 'door') bar(u0 + F, u1 - F, yt - 0.03, yt + 0.03);
  } else if (Hh > 1.3 && W > 0.9) {
    // Vasistas: üstte ~0.4 m yatay kayıt (bazılarında)
    if (hash(seed + i * 3.7 + u0 * 1.3) < 0.35) bar(u0 + F, u1 - F, y1 - 0.45, y1 - 0.4);
  }
  // Cam (oda gölgelendiricisi): tek parça, kasanın arkasında
  const h = hash(seed * 1.7 + i * 17.3 + u0 * 5.1 + op.k * 11.9);
  const kind = win.kind === 'small' ? 4 : KINDS[Math.floor(h * KINDS.length)];
  const g0 = P(i, u0, d);
  const g1 = P(i, u1, d);
  b.quad('mkGlass', V(g0, y0), V(g1, y0), V(g1, y1), V(g0, y1), [0, 0, 1, 1], [h * 100, kind, W, Hh]);
  // Fransız balkon korkuluğu: yatay paslanmaz borular (dış yüzde)
  if (win.rail) {
    const yaw = E.yaw;
    const c = P(i, (u0 + u1) / 2, 0.04);
    for (const hh of [0.3, 0.55, 0.8, 0.95])
      b.box('mkRail', [c[0], y0 + hh, c[1]], [W + 0.04, 0.025, 0.025], yaw);
    for (const uu of [u0 + 0.03, u1 - 0.03]) {
      const pp = P(i, uu, 0.04);
      b.box('mkRail', [pp[0], y0 + 0.5, pp[1]], [0.03, 1.0, 0.03], yaw);
    }
  }
  if (win.box) {
    const c = P(i, (u0 + u1) / 2, 0.04);
    b.box('mkFrame', [c[0], y1 + 0.1, c[1]], [W + 0.06, 0.2, 0.1], E.yaw);
  }
}

/** Klima, çanak anten, kamera, bayrak */
function unit(b: Builder, E: Edge, P: PFn, i: number, it: CUnit, yFloor: number, seed: number): void {
  const yaw = E.yaw;
  const n = E.n;
  if (it.t === 'ac') {
    const off = it.onBal ? 1.0 : 0.16;
    const c = P(i, it.u, off);
    const y = yFloor + (it.y ?? (it.onBal ? 0.3 : 1.6));
    b.box('mkAc', [c[0], y, c[1]], [0.8, 0.55, 0.28], yaw, 1, 0b111110);
    const f = P(i, it.u, off + 0.141);
    b.box('mkAcFront', [f[0], y, f[1]], [0.8, 0.55, 0.002], yaw, 1, 0b000001);
    if (!it.onBal) {
      // Duvar konsolu
      for (const s of [-0.3, 0.3]) {
        const q = P(i, it.u + s, 0.12);
        b.box('mkRail', [q[0], y - 0.3, q[1]], [0.03, 0.03, 0.26], yaw);
      }
    }
  } else if (it.t === 'dish') {
    const off = it.onBal ? 1.35 : 0.35;
    const c = P(i, it.u, off);
    const y = yFloor + (it.y ?? (it.onBal ? 1.25 : 1.8));
    const dish = new THREE.SphereGeometry(0.36, 14, 4, 0, Math.PI * 2, 0, 0.55);
    dish.scale(1, 0.42, 1);
    // Türksat 42°D → güney-güneydoğu, ~40° yukarı (bombe ekseni tersine)
    dish.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-0.293, -0.643, -0.708).normalize(),
      ),
    );
    dish.translate(c[0], y, c[1]);
    b.geometry('mkDish', dish);
    b.box('mkRail', [c[0] - n[0] * 0.15, y - 0.25, c[1] - n[1] * 0.15], [0.04, 0.5, 0.04], yaw);
    // LNB kolu
    b.box('mkPipe', [c[0] + 0.12, y + 0.12, c[1] + 0.3], [0.03, 0.03, 0.4], 0.4);
  } else if (it.t === 'camera') {
    const c = P(i, it.u, 0.18);
    const y = yFloor + (it.y ?? 2.4);
    b.box('mkAc', [c[0], y, c[1]], [0.1, 0.1, 0.22], yaw);
  } else if (it.t === 'flag') {
    const off = it.onBal ? 1.45 : 0.1;
    const c0 = P(i, it.u - 0.55, off);
    const c1 = P(i, it.u + 0.55, off);
    const y = yFloor + (it.y ?? 1.0);
    b.wall('mkFlag', c0, c1, y - 1.3, y, [0, 0, 1, 1]);
    b.wall('mkFlag', c1, c0, y - 1.3, y, [1, 0, 0, 1]);
    void seed;
  }
}

/** Blok girişi: çift kanat alüminyum kapı (açıklık zaten pencere değilse), basamak, cam saçak, levha */
function entrance(
  b: Builder,
  P: PFn,
  E: Edge,
  i: number,
  it: CEntrance,
  base: number,
  y0: number,
  signKey?: string,
): void {
  const s = (it.u0 + it.u1) / 2;
  const W = Math.max(1.4, it.u1 - it.u0);
  const rise = Math.max(0, y0 - base);
  const steps = it.steps ?? Math.max(0, Math.round(rise / 0.16));
  for (let k = 0; k < steps; k++) {
    const d = 1.2 + (steps - k) * 0.3;
    const c = P(i, s, d / 2);
    const h = (rise / Math.max(1, steps)) * (k + 1);
    b.box('mkStep', [c[0], base + h / 2 - 0.02, c[1]], [W + 1.0, h + 0.04, d], E.yaw);
  }
  b.wall('mkEntryDoor', P(i, s - W / 2, 0.02), P(i, s + W / 2, 0.02), y0, y0 + 2.4, [0, 0, 1, 1]);
  if (it.canopy) {
    const c = P(i, s, 0.7);
    b.box('mkRail', [c[0], y0 + 2.75, c[1]], [W + 0.6, 0.08, 1.4], E.yaw);
    b.box('mkCanopyGlass', [c[0], y0 + 2.8, c[1]], [W + 0.5, 0.02, 1.3], E.yaw);
  }
  if (signKey) b.wall(signKey, P(i, s - 0.45, 0.04), P(i, s + 0.45, 0.04), y0 + 2.95, y0 + 3.3);
}

/** Yönlü sınır kutusu üzerine kırma çatı (saçak taşmalı); tepe kotunu döndürür */
function hippedRoof(b: Builder, r: V2[], y: number, eave: number, pitchDeg: number): number {
  // En küçük alanlı yönlü dikdörtgen
  let best: { area: number; c: V2; ax: V2; w: number; d: number } | null = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const e = r[(i + 1) % r.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 1) continue;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
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
    if (!best || area < best.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      best = { area, c: [t[0] * uc + n[0] * vc, t[1] * uc + n[1] * vc], ax: t, w: u1 - u0, d: v1 - v0 };
    }
  }
  if (!best) return y;
  const ax = best.ax;
  const nx: V2 = [-ax[1], ax[0]];
  const W = best.w / 2 + eave;
  const D = best.d / 2 + eave;
  const C = (u: number, v: number): V2 => [
    best!.c[0] + ax[0] * u + nx[0] * v,
    best!.c[1] + ax[1] * u + nx[1] * v,
  ];
  const rise = Math.min(W, D) * Math.tan((pitchDeg * Math.PI) / 180);
  const p00 = C(-W, -D);
  const p10 = C(W, -D);
  const p11 = C(W, D);
  const p01 = C(-W, D);
  b.polygon('mkSoffit', [p00, p10, p11, p01], y - 0.02, false, 0.5);
  // Saçak alnı (çatı kenarı boyunca, koyu gri)
  for (const [q0, q1] of [
    [p00, p10],
    [p10, p11],
    [p11, p01],
    [p01, p00],
  ] as [V2, V2][])
    b.wall('mkFascia', q1, q0, y - 0.3, y + 0.03, [0, y - 0.3, Math.hypot(q1[0] - q0[0], q1[1] - q0[1]), y]);
  const long = W >= D;
  const hr = long ? W - D : D - W;
  const r0 = long ? C(-hr, 0) : C(0, -hr);
  const r1 = long ? C(hr, 0) : C(0, hr);
  const ry = y + rise;
  const V = (p: V2, h: number): V3 => [p[0], h, p[1]];
  const faces: [V2, V2, V2, V2][] = long
    ? [
        [p00, p10, r1, r0],
        [p11, p01, r0, r1],
      ]
    : [
        [p10, p11, r1, r0],
        [p01, p00, r0, r1],
      ];
  for (const [q0, q1, q2, q3] of faces)
    b.quad('roof', V(q0, y), V(q1, y), V(q2, ry), V(q3, ry), [
      0,
      0,
      Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / 2,
      rise / 1.5,
    ]);
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
    b.quad('roof', V(q0, y), V(q1, y), V(q2, ry), V(q2, ry), [0, 0, 2, rise / 1.5]);
  const rl = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
  if (rl > 0.1)
    b.box(
      'ridge',
      [(r0[0] + r1[0]) / 2, ry + 0.04, (r0[1] + r1[1]) / 2],
      [rl + 0.2, 0.1, 0.22],
      Math.atan2(-(r1[1] - r0[1]), r1[0] - r0[0]),
    );
  return ry;
}
