import * as THREE from 'three';
import { Builder, leafFringe, type V2, type V3 } from './builder';
import { insidePoly } from './apartment';

/**
 * Mertkent 2 site içi (hava fotoğrafı + OSM): çim bahçe, blok çevresi kilit taşı döşeme, parke yaya yolları
 * (bordürlü), iki araç girişi ve otopark, havuz (gerçek derinlik, mozaik, travertin güverte, beyaz taş kenar,
 * merdiven, şezlong, şemsiye), bahçe lambaları, banklar, alçak şimşir çitler.
 * KARAR: iç mekân Street View karesi yok; yerleşim OSM yaya yolları/otopark yolları ve havuz poligonundan,
 * döşeme türleri bölgedeki sitelerin tipik malzemesinden.
 */
export interface GroundsInput {
  site: V2[];
  buildings: V2[][];
  pool: V2[] | null;
  paths: V2[][];
  drives: V2[][];
  H: (x: number, z: number) => number;
  collide?: (ring: [number, number][], bottom: number, top: number) => void;
  seed?: number;
}

export interface GroundsResult {
  /** Arazi mesh'inde havuz içinde çizilmeyecek dikdörtgenler [minX, minZ, maxX, maxZ] */
  holes: [number, number, number, number][];
  /** Ağaç konmaması gereken yer (havuz, yol, bina) */
  noTree: (x: number, z: number) => boolean;
}

const PATH_W = 2.2;
const DRIVE_W = 5.5;
const APRON = 1.3;
const DECK = 3.0;
const COPING = 0.4;
const POOL_DEPTH = 1.5;

type Seg = { a: V2; e: V2; len: number; t: V2; n: V2 };
const seg = (a: V2, e: V2): Seg => {
  const dx = e[0] - a[0];
  const dz = e[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const t: V2 = [dx / len, dz / len];
  return { a, e, len, t, n: [-t[1], t[0]] };
};
const yawOf = (t: V2) => Math.atan2(-t[1], t[0]);

function distSeg(x: number, z: number, s: Seg): number {
  const u = Math.max(0, Math.min(s.len, (x - s.a[0]) * s.t[0] + (z - s.a[1]) * s.t[1]));
  return Math.hypot(x - s.a[0] - s.t[0] * u, z - s.a[1] - s.t[1] * u);
}

/** Çoklu çizgiyi genişlikte şeride çevir (köşelerde gönye). */
function stripRing(pts: V2[], w: number): V2[] {
  const h = w / 2;
  const L: V2[] = [];
  const R: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = seg(pts[Math.max(0, i - 1)], pts[Math.min(pts.length - 1, Math.max(1, i))]);
    const b = seg(pts[Math.min(i, pts.length - 2)], pts[Math.min(pts.length - 1, i + 1)]);
    let nx = a.n[0] + b.n[0];
    let nz = a.n[1] + b.n[1];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const cos = Math.max(0.5, nx * b.n[0] + nz * b.n[1]);
    L.push([p[0] + (nx * h) / cos, p[1] + (nz * h) / cos]);
    R.push([p[0] - (nx * h) / cos, p[1] - (nz * h) / cos]);
  }
  return [...L, ...R.reverse()];
}

/** Doğrusal olmayan poligonu yatay dilimlere ayırarak eksen hizalı dikdörtgenlere böl (havuz deliği için). */
function rectsOf(r: V2[], shrink: number): [number, number, number, number][] {
  const zs = [...new Set(r.map((p) => +p[1].toFixed(2)))].sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let k = 0; k + 1 < zs.length; k++) {
    const z0 = zs[k];
    const z1 = zs[k + 1];
    if (z1 - z0 < 0.3) continue;
    const zm = (z0 + z1) / 2;
    const xs: number[] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const e = r[(i + 1) % r.length];
      if (a[1] > zm !== e[1] > zm) xs.push(a[0] + ((zm - a[1]) / (e[1] - a[1])) * (e[0] - a[0]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      out.push([xs[i] + shrink, z0 + shrink, xs[i + 1] - shrink, z1 - shrink]);
  }
  return out.slice(0, 4);
}

function orientCCW(r: V2[]): V2[] {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  // a<0 → (−dz,dx) dış normal (apartment.orientOutward ile aynı kural)
  return a > 0 ? [...r].reverse() : r;
}

export function buildGrounds(b: Builder, o: GroundsInput): GroundsResult {
  const H = o.H;
  let seed = o.seed ?? 77;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pool = o.pool ? orientCCW(o.pool) : null;
  const pathSegs: Seg[] = [];
  const driveSegs: Seg[] = [];

  for (const p of o.paths) for (let i = 0; i + 1 < p.length; i++) pathSegs.push(seg(p[i], p[i + 1]));
  for (const p of o.drives) for (let i = 0; i + 1 < p.length; i++) driveSegs.push(seg(p[i], p[i + 1]));
  const onWay = (x: number, z: number) =>
    pathSegs.some((q) => distSeg(x, z, q) < PATH_W / 2 + 0.15) ||
    driveSegs.some((q) => distSeg(x, z, q) < DRIVE_W / 2 + 0.2);

  // ── Çim (site tamamı, havuz delikli) ──
  b.drape('lawn', o.site, pool ? [pool] : [], H, 0.035, 1, 2.5);

  // ── Blok çevresi kilit taşı döşeme (kenar başına şerit; örtüşmeler aynı dokuyla görünmez) ──
  for (const r0 of o.buildings) {
    const r = orientCCW(r0);
    for (let i = 0; i < r.length; i++) {
      const s = seg(r[i], r[(i + 1) % r.length]);
      if (s.len < 0.05) continue;
      const A: V2 = [s.a[0] - s.t[0] * APRON, s.a[1] - s.t[1] * APRON];
      const E: V2 = [s.e[0] + s.t[0] * APRON, s.e[1] + s.t[1] * APRON];
      const ring: V2[] = [
        A,
        E,
        [E[0] + s.n[0] * APRON, E[1] + s.n[1] * APRON],
        [A[0] + s.n[0] * APRON, A[1] + s.n[1] * APRON],
      ];
      b.drape('apron', ring, [], H, 0.07, 1, 3);
      // Döşeme dış kenarında ince beton bordür
      // Yol üstüne taşan kısımlar hariç, 1 m'lik parçalar halinde
      const LL = s.len + APRON * 2;
      for (let u = 0; u < LL; u += 1) {
        const w = Math.min(1, LL - u);
        const c: V2 = [
          A[0] + s.t[0] * (u + w / 2) + s.n[0] * APRON,
          A[1] + s.t[1] * (u + w / 2) + s.n[1] * APRON,
        ];
        if (onWay(c[0], c[1])) continue;
        b.box('edging', [c[0], H(c[0], c[1]) + 0.07, c[1]], [w, 0.08, 0.1], yawOf(s.t));
      }
    }
  }

  // ── Yaya yolları (kırmızımsı kilit parke, iki yanda bordür) ──
  for (const p of o.paths) {
    if (p.length < 2) continue;
    b.drape('paver', stripRing(p, PATH_W), [], H, 0.09, 1, 2);
    for (let i = 0; i + 1 < p.length; i++) {
      const s = seg(p[i], p[i + 1]);
      for (const side of [-1, 1]) {
        const off = (side * (PATH_W + 0.1)) / 2;
        const m: V2 = [(s.a[0] + s.e[0]) / 2 + s.n[0] * off, (s.a[1] + s.e[1]) / 2 + s.n[1] * off];
        b.box('curb', [m[0], H(m[0], m[1]) + 0.08, m[1]], [s.len, 0.14, 0.1], yawOf(s.t));
      }
    }
  }

  // ── Araç yolları (asfalt, bordürlü) + otopark cepleri ──
  for (const p of o.drives) {
    if (p.length < 2) continue;
    b.drape('drive', stripRing(p, DRIVE_W), [], H, 0.08, 1, 2.5);
    for (let i = 0; i + 1 < p.length; i++) {
      const s = seg(p[i], p[i + 1]);
      for (const side of [-1, 1]) {
        const off = (side * (DRIVE_W + 0.12)) / 2;
        const m: V2 = [(s.a[0] + s.e[0]) / 2 + s.n[0] * off, (s.a[1] + s.e[1]) / 2 + s.n[1] * off];
        b.box('curb', [m[0], H(m[0], m[1]) + 0.1, m[1]], [s.len, 0.18, 0.12], yawOf(s.t));
      }
      // Otopark: uzun segmentlerin bir yanında 2.5 × 5 m dik cepler (bina/havuz çakışmıyorsa)
      if (s.len < 12) continue;
      for (const side of [1, -1]) {
        const nb = Math.floor((s.len - 2) / 2.5);
        let placed = 0;
        for (let k = 0; k < nb; k++) {
          const u = 1 + k * 2.5;
          const c0: V2 = [
            s.a[0] + s.t[0] * (u + 1.25) + s.n[0] * side * (DRIVE_W / 2 + 2.6),
            s.a[1] + s.t[1] * (u + 1.25) + s.n[1] * side * (DRIVE_W / 2 + 2.6),
          ];
          const clear =
            !o.buildings.some((r) => nearRing(r, c0[0], c0[1], 3.2)) &&
            !(pool && nearRing(pool, c0[0], c0[1], DECK + 3)) &&
            insidePoly(o.site, c0[0], c0[1]) &&
            distToRingEdge(o.site, c0[0], c0[1]) > 2.8;
          if (!clear) continue;
          placed++;
          const q = (du: number, dn: number): V2 => [
            c0[0] + s.t[0] * du + s.n[0] * side * dn,
            c0[1] + s.t[1] * du + s.n[1] * side * dn,
          ];
          b.drape(
            'bay',
            [q(-1.25, -2.5), q(1.25, -2.5), q(1.25, 2.5), q(-1.25, 2.5)].map((v) => v),
            [],
            H,
            0.075,
            1,
            2.5,
          );
          // Çizgiler
          for (const du of [-1.25, 1.25]) {
            const lm = q(du, 0);
            b.box('line', [lm[0], H(lm[0], lm[1]) + 0.085, lm[1]], [0.1, 0.01, 5], yawOf(s.t));
          }
          // Tekerlek takozu
          const st = q(0, 2.05);
          b.box('curb', [st[0], H(st[0], st[1]) + 0.12, st[1]], [1.6, 0.1, 0.15], yawOf(s.t));
        }
        if (placed) break; // tek yan yeter
      }
    }
  }

  // ── Havuz ──
  const holes: [number, number, number, number][] = [];
  if (pool) {
    holes.push(...rectsOf(pool, 0.08));
    const yTop = Math.max(...pool.map((p) => H(p[0], p[1]))) + 0.14;
    const yWater = yTop - 0.14;
    const yBot = yTop - POOL_DEPTH;
    for (let i = 0; i < pool.length; i++) {
      const s = seg(pool[i], pool[(i + 1) % pool.length]);
      // Güverte şeridi + köşe
      const A: V2 = [s.a[0] - s.t[0] * DECK, s.a[1] - s.t[1] * DECK];
      const E: V2 = [s.e[0] + s.t[0] * DECK, s.e[1] + s.t[1] * DECK];
      const ring: V2[] = [
        s.a,
        s.e,
        [s.e[0] + s.n[0] * DECK, s.e[1] + s.n[1] * DECK],
        [s.a[0] + s.n[0] * DECK, s.a[1] + s.n[1] * DECK],
      ];
      b.polygon('deck', ring, yTop - 0.02, true, 1);
      b.polygon(
        'deck',
        [
          s.e,
          E,
          [E[0] + s.n[0] * DECK, E[1] + s.n[1] * DECK],
          [s.e[0] + s.n[0] * DECK, s.e[1] + s.n[1] * DECK],
        ],
        yTop - 0.02,
        true,
        1,
      );
      void A;
      // Taş kenar (coping) — hafif yükseltilmiş, yuvarlak burun hissi için iki kademe
      const cr: V2[] = [
        s.a,
        s.e,
        [s.e[0] + s.n[0] * COPING, s.e[1] + s.n[1] * COPING],
        [s.a[0] + s.n[0] * COPING, s.a[1] + s.n[1] * COPING],
      ];
      b.polygon('coping', cr, yTop + 0.02, true, 1);
      b.wall('coping', s.e, s.a, yTop - 0.04, yTop + 0.02);
      // Havuz iç duvarı (içe bakar: a→e yönünün sol normali dışa, bu yüzden e→a)
      b.wall('poolTile', s.e, s.a, yBot, yTop - 0.04, [0, 0, s.len / 1, POOL_DEPTH / 1]);
      // Su hattı bandı (koyu mavi mozaik şerit)
      b.wall(
        'poolBand',
        [s.e[0] - s.n[0] * 0.005, s.e[1] - s.n[1] * 0.005],
        [s.a[0] - s.n[0] * 0.005, s.a[1] - s.n[1] * 0.005],
        yWater - 0.12,
        yWater + 0.06,
        [0, 0, s.len / 0.5, 1],
      );
    }
    // Güverte dış kenarı: yükseltilmiş platformun yan yüzü
    for (let i = 0; i < pool.length; i++) {
      const s = seg(pool[i], pool[(i + 1) % pool.length]);
      const A: V2 = [s.a[0] - s.t[0] * DECK + s.n[0] * DECK, s.a[1] - s.t[1] * DECK + s.n[1] * DECK];
      const E: V2 = [s.e[0] + s.t[0] * DECK + s.n[0] * DECK, s.e[1] + s.t[1] * DECK + s.n[1] * DECK];
      const outside = !pool.some((_, k) => {
        const q = seg(pool[k], pool[(k + 1) % pool.length]);
        const mx = (A[0] + E[0]) / 2;
        const mz = (A[1] + E[1]) / 2;
        return q !== s && distSeg(mx, mz, q) < DECK - 0.2 && k !== i;
      });
      if (outside) b.wall('deckSide', A, E, H(A[0], A[1]) - 0.1, yTop - 0.02, [0, 0, s.len / 1, 0.3]);
    }
    b.polygon('poolTile', pool, yBot, true, 1);
    b.polygon('water', pool, yWater, true, 0.25);
    // Zemindeki kulvar çizgisi (koyu mavi) — en uzun kenara paralel
    let best = seg(pool[0], pool[1]);
    for (let i = 0; i < pool.length; i++) {
      const s = seg(pool[i], pool[(i + 1) % pool.length]);
      if (s.len > best.len) best = s;
    }
    const pc = centroid(pool);
    b.box('poolBand', [pc[0], yBot + 0.01, pc[1]], [best.len * 0.7, 0.01, 0.25], yawOf(best.t));
    // Merdivenler (paslanmaz, iki adet uzun kenarda)
    for (const f of [0.2, 0.8]) {
      const p: V2 = [best.a[0] + best.t[0] * best.len * f, best.a[1] + best.t[1] * best.len * f];
      for (const d of [-0.3, 0.3]) {
        const q: V2 = [p[0] + best.t[0] * d, p[1] + best.t[1] * d];
        const tube = new THREE.TorusGeometry(0.28, 0.022, 6, 12, Math.PI);
        tube.rotateY(yawOf(best.n) + Math.PI / 2);
        tube.translate(q[0] + best.n[0] * 0.05, yTop + 0.02, q[1] + best.n[1] * 0.05);
        b.geometry('steel', tube);
        const leg = new THREE.CylinderGeometry(0.022, 0.022, 1.2, 6);
        leg.translate(q[0] - best.n[0] * 0.23, yTop - 0.55, q[1] - best.n[1] * 0.23);
        b.geometry('steel', leg);
      }
      for (let k = 0; k < 3; k++) {
        const q: V2 = [p[0] - best.n[0] * 0.2, p[1] - best.n[1] * 0.2];
        b.box('steel', [q[0], yTop - 0.3 - k * 0.3, q[1]], [0.6, 0.03, 0.12], yawOf(best.t));
      }
    }
    // Şezlonglar + şemsiyeler (güverte boyunca, güneye bakan yan)
    const sideS = [...Array(pool.length).keys()]
      .map((i) => seg(pool[i], pool[(i + 1) % pool.length]))
      .filter((s) => s.len > 6)
      .sort((p, q) => q.n[1] - p.n[1] + (q.n[0] - p.n[0]) * 0.1);
    for (const s of sideS.slice(0, 2)) {
      const n = Math.floor((s.len - 2) / 1.4);
      for (let k = 0; k < n; k++) {
        const u = 1.5 + k * 1.4;
        const c: V2 = [s.a[0] + s.t[0] * u + s.n[0] * 1.9, s.a[1] + s.t[1] * u + s.n[1] * 1.9];
        lounger(b, [c[0], yTop - 0.02, c[1]], yawOf(s.n) + Math.PI / 2);
        if (k % 3 === 1)
          umbrella(b, [c[0] + s.t[0] * 0.7 + s.n[0] * 0.6, yTop - 0.02, c[1] + s.t[1] * 0.7 + s.n[1] * 0.6]);
      }
    }
    // Duş
    const sh: V2 = [
      best.e[0] + best.n[0] * 2.4 - best.t[0] * 0.6,
      best.e[1] + best.n[1] * 2.4 - best.t[1] * 0.6,
    ];
    b.cylinder('steel', [sh[0], yTop - 0.02, sh[1]], 0.035, 2.3, 8);
    b.box(
      'steel',
      [sh[0] - best.n[0] * 0.15, yTop + 2.25, sh[1] - best.n[1] * 0.15],
      [0.05, 0.05, 0.35],
      yawOf(best.t),
    );
    // Havuza yürünmesin
    o.collide?.(
      pool.map((p) => [p[0], p[1]]),
      yBot,
      yTop + 1.0,
    );
  }

  // ── Bahçe lambaları + banklar + alçak şimşir çitler yol boyunca ──
  let acc = 5;
  for (const s of pathSegs) {
    for (let u = acc; u < s.len; u += 11) {
      const side = Math.floor(u / 11) % 2 ? 1 : -1;
      const off = side * (PATH_W / 2 + 0.45);
      const p: V2 = [s.a[0] + s.t[0] * u + s.n[0] * off, s.a[1] + s.t[1] * u + s.n[1] * off];
      if (o.buildings.some((r) => insidePoly(r, p[0], p[1]))) continue;
      gardenLamp(b, [p[0], H(p[0], p[1]), p[1]]);
    }
    acc = 5;
    // Şimşir: yolun iki yanında, bordürden 0.2 m içeride, bina/havuz/yol kesişimlerinde boşluk
    for (const side of [-1, 1]) {
      const off = side * (PATH_W / 2 + 0.45);
      let run0 = -1;
      const flush = (u0: number, u1: number) => {
        if (u1 - u0 < 1.5) return;
        const m: V2 = [
          s.a[0] + s.t[0] * ((u0 + u1) / 2) + s.n[0] * off,
          s.a[1] + s.t[1] * ((u0 + u1) / 2) + s.n[1] * off,
        ];
        const y = H(m[0], m[1]);
        b.box('boxwood', [m[0], y + 0.24, m[1]], [u1 - u0, 0.45, 0.5], yawOf(s.t), 0.8);
        const pa: V2 = [s.a[0] + s.t[0] * u0 + s.n[0] * off, s.a[1] + s.t[1] * u0 + s.n[1] * off];
        const pe: V2 = [s.a[0] + s.t[0] * u1 + s.n[0] * off, s.a[1] + s.t[1] * u1 + s.n[1] * off];
        const half = 0.25;
        for (const sd of [1, -1]) {
          const nn: V2 = [s.n[0] * sd, s.n[1] * sd];
          const fa: V2 = [pa[0] + nn[0] * half, pa[1] + nn[1] * half];
          const fe: V2 = [pe[0] + nn[0] * half, pe[1] + nn[1] * half];
          leafFringe(
            b,
            'boxLeaf',
            sd > 0 ? fa : fe,
            sd > 0 ? fe : fa,
            y + 0.02,
            y + 0.47,
            0.5,
            nn,
            30,
            Math.floor(u0 * 97 + sd * 13 + 7),
            0.26,
          );
        }
      };
      for (let u = 0; u <= s.len; u += 0.5) {
        const p: V2 = [s.a[0] + s.t[0] * u + s.n[0] * off, s.a[1] + s.t[1] * u + s.n[1] * off];
        const blocked =
          o.buildings.some((r) => nearRing(r, p[0], p[1], APRON + 0.5)) ||
          (pool !== null && nearRing(pool, p[0], p[1], DECK + 0.6)) ||
          driveSegs.some((d) => distSeg(p[0], p[1], d) < DRIVE_W / 2 + 0.6) ||
          pathSegs.some((q) => q !== s && distSeg(p[0], p[1], q) < PATH_W / 2 + 0.6) ||
          !insidePoly(o.site, p[0], p[1]) ||
          distToRingEdge(o.site, p[0], p[1]) < 1.2 ||
          Math.abs(Math.floor(u / 11) * 11 + 5 - u) < 0.8; // lamba yeri
        if (!blocked && run0 < 0) run0 = u;
        if (blocked && run0 >= 0) {
          flush(run0, u - 0.25);
          run0 = -1;
        }
      }
      if (run0 >= 0) flush(run0, s.len);
    }
  }
  // Havuz başında banklar
  if (pool) {
    const pc = centroid(pool);
    for (const [dx, dz, yaw] of [
      [0, -1, 0],
      [0, 1, Math.PI],
    ] as [number, number, number][]) {
      let p: V2 = [pc[0], pc[1]];
      for (let d = 0; d < 40; d += 0.5) {
        p = [pc[0] + dx * d, pc[1] + dz * d];
        if (!insidePoly(pool, p[0], p[1]) && !nearRing(pool, p[0], p[1], DECK + 0.8)) break;
      }
      for (const lat of [-1.8, 1.8]) bench(b, [p[0] + lat, H(p[0] + lat, p[1]) + 0.07, p[1]], yaw);
    }
  }
  void rnd;

  const noTree = (x: number, z: number) =>
    (pool !== null && (insidePoly(pool, x, z) || nearRing(pool, x, z, DECK + 1))) ||
    pathSegs.some((s) => distSeg(x, z, s) < PATH_W / 2 + 0.8) ||
    driveSegs.some((s) => distSeg(x, z, s) < DRIVE_W / 2 + 3) ||
    o.buildings.some((r) => insidePoly(r, x, z) || nearRing(r, x, z, APRON + 0.5));
  return { holes, noTree };
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

function distToRingEdge(r: V2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) d = Math.min(d, distSeg(x, z, seg(r[i], r[(i + 1) % r.length])));
  return d;
}

function nearRing(r: V2[], x: number, z: number, d: number): boolean {
  return insidePoly(r, x, z) || distToRingEdge(r, x, z) < d;
}

/** Plastik şezlong (beyaz), sırt dik, yaw: uzun ekseni */
function lounger(b: Builder, c: V3, yaw: number): void {
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const P = (x: number, y: number, z: number): V3 => [
    c[0] + x * co + z * si,
    c[1] + y,
    c[2] - x * si + z * co,
  ];
  const L = 1.9;
  // Oturak (hafif eğimli)
  const g = new THREE.BoxGeometry(L * 0.65, 0.04, 0.66);
  g.rotateZ(0.04);
  g.rotateY(yaw);
  const s = P(-0.25, 0.32, 0);
  g.translate(s[0], s[1], s[2]);
  b.geometry('lounger', g);
  const back = new THREE.BoxGeometry(0.7, 0.04, 0.66);
  back.rotateZ(-0.75);
  back.rotateY(yaw);
  const bp = P(0.72, 0.52, 0);
  back.translate(bp[0], bp[1], bp[2]);
  b.geometry('lounger', back);
  for (const [x, z] of [
    [-0.85, -0.28],
    [-0.85, 0.28],
    [0.45, -0.28],
    [0.45, 0.28],
  ]) {
    const p = P(x, 0.15, z);
    b.box('lounger', p, [0.05, 0.3, 0.05], yaw);
  }
}

function umbrella(b: Builder, c: V3): void {
  b.cylinder('steel', c, 0.025, 2.3, 6);
  const g = new THREE.ConeGeometry(1.25, 0.45, 8, 1, true);
  g.translate(c[0], c[1] + 2.35, c[2]);
  b.geometry('umbrella', g);
  const base = new THREE.CylinderGeometry(0.22, 0.25, 0.1, 10);
  base.translate(c[0], c[1] + 0.05, c[2]);
  b.geometry('darkMetal', base);
}

function gardenLamp(b: Builder, p: V3): void {
  b.cylinder('darkMetal', [p[0], p[1], p[2]], 0.1, 0.35, 8);
  b.cylinder('darkMetal', [p[0], p[1] + 0.35, p[2]], 0.045, 2.6, 8);
  b.cylinder('darkMetal', [p[0], p[1] + 2.9, p[2]], 0.09, 0.08, 8);
  const g = new THREE.SphereGeometry(0.2, 12, 8);
  g.translate(p[0], p[1] + 3.15, p[2]);
  b.geometry('gardenGlobe', g);
}

function bench(b: Builder, c: V3, yaw: number): void {
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const P = (x: number, y: number, z: number): V3 => [
    c[0] + x * co + z * si,
    c[1] + y,
    c[2] - x * si + z * co,
  ];
  // Oturak ve sırt çıtaları (ahşap), dökme ayaklar
  for (let k = 0; k < 3; k++) b.box('wood', P(0, 0.44, -0.1 + k * 0.13), [1.6, 0.04, 0.1], yaw);
  for (let k = 0; k < 3; k++) b.box('wood', P(0, 0.62 + k * 0.12, 0.2), [1.6, 0.09, 0.03], yaw);
  for (const x of [-0.65, 0.65]) {
    b.box('darkMetal', P(x, 0.22, 0.05), [0.06, 0.44, 0.45], yaw);
    b.box('darkMetal', P(x, 0.6, 0.22), [0.06, 0.4, 0.05], yaw);
  }
}
