import * as THREE from 'three';
import { Builder, type V2 } from './builder';

/**
 * Mertkent 2 site çiti (Street View yakın planlarından, street-plan.json ölçüleriyle):
 * - Beyaz dalga desenli prekast duvar paneli (fotoğraf dokusu, ~1.73 m modül, derz dikmeli), turuncu harpuşta.
 * - Turuncu grenli sıvalı kare kolonlar, başlık, siyah kısa ayak üstünde beyaz küre lamba.
 * - Duvar üstünde koyu yeşil 3D panel tel çit (dikme ~2.5 m), üstte jiletli tel.
 * - Arkada: yapay yaprak paneli (düz, koyu yeşil) ya da gerçek leylandi (açık sarı-yeşil, kalın gövde).
 */
export interface FenceSpec {
  kind: string;
  pts: V2[];
  wallH?: number;
  pillarEvery?: number;
  pillarW?: number;
  pillarH?: number;
  lamp?: string | boolean;
  mesh?: number;
  razor?: boolean;
  hedge?: { h?: number; depth?: number };
  /** Polyline boyunca [u0, u1, tür] (metre): artificial | real | none */
  screen?: [number, number, string][];
  /** Varsayılan perde türü */
  screenDefault?: string;
  /** Ölçülmüş kolon konumları (polyline boyunca U, metre); yoksa pillarEvery aralıkla */
  pillarsU?: number[];
  /** false: son noktadaki kolonu çizme (bir sonraki çit hattının ilk kolonu) */
  endPillar?: boolean;
}

export interface GateGap {
  c: V2;
  w: number;
}

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

/** Prekast panel genişliği (kolon aralığında 3 panel, derz dikmeleriyle) */
const PANEL = 2.13;
const WALL_T = 0.2;
const POST_EVERY = 2.5;

export function buildMertkentFence(
  b: Builder,
  f: FenceSpec,
  inside: V2,
  H: (x: number, z: number) => number,
  gates: GateGap[],
  collide?: Collide,
): void {
  const wallH = f.wallH ?? 0.8;
  const pEvery = f.pillarEvery ?? 6.5;
  const pW = f.pillarW ?? 0.38;
  const pH = f.pillarH ?? 1.3;
  const meshH = f.mesh ?? 1.3;
  const hedgeH = f.hedge?.h ?? 2.3;
  const hedgeD = f.hedge?.depth ?? 0.9;
  const lamp = f.lamp !== false && f.lamp !== 'none';
  // Polyline, kümülatif uzunluk
  const pts = f.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const screenAt = (U: number): string => {
    for (const [a, e, t] of f.screen ?? []) if (U >= a && U <= e) return t;
    return f.screenDefault ?? 'real';
  };
  // Kapı boşlukları (polyline üzerinde U aralıkları)
  const gapsU: [number, number][] = [];
  for (const g of gates) {
    let best = { d: Infinity, U: 0 };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const e = pts[i + 1];
      const L = cum[i + 1] - cum[i];
      if (L < 1e-6) continue;
      const t = Math.max(
        0,
        Math.min(L, ((g.c[0] - a[0]) * (e[0] - a[0]) + (g.c[1] - a[1]) * (e[1] - a[1])) / L),
      );
      const q: V2 = [a[0] + ((e[0] - a[0]) * t) / L, a[1] + ((e[1] - a[1]) * t) / L];
      const d = Math.hypot(q[0] - g.c[0], q[1] - g.c[1]);
      if (d < best.d) best = { d, U: cum[i] + t };
    }
    if (best.d < 2.5) gapsU.push([best.U - g.w / 2, best.U + g.w / 2]);
  }
  const inGap = (U: number) => gapsU.some(([a, e]) => U > a && U < e);
  // Kolonlar (global U): ölçülmüş ya da düzenli; kapı kenarlarına kolon (yakındaki ölçülmüş kolonun yerine)
  const pil: number[] = [];
  if (f.pillarsU?.length) pil.push(...f.pillarsU);
  else for (let U = 0; U <= total + 1e-6; U += pEvery) pil.push(U);
  for (const g of gapsU)
    for (const U of g) {
      if (U < -0.01 || U > total + 0.01) continue;
      const k = pil.findIndex((q) => Math.abs(q - U) < 0.6);
      if (k >= 0) pil.splice(k, 1);
      pil.push(U);
    }
  pil.sort((p, q) => p - q);
  /** Duvar paneli dokusu u: kolon aralığı tam sayıda panele bölünür (derzler kolonlarla hizalı) */
  const bayOf = (U: number) => {
    let k = 0;
    while (k + 2 < pil.length && pil[k + 1] <= U) k++;
    const a = pil[k] ?? 0;
    const e = pil[k + 1] ?? total;
    const n = Math.max(1, Math.round((e - a) / PANEL));
    return { a, e, n };
  };
  const waveU = (U: number, ref: number) => {
    const { a, e, n } = bayOf(ref);
    return ((U - a) / Math.max(0.01, e - a)) * n;
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const e = pts[i + 1];
    const L = cum[i + 1] - cum[i];
    if (L < 0.05) continue;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    let n: V2 = [-t[1], t[0]];
    const m: V2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    // n sokak tarafına (site içinden uzağa) baksın
    if (n[0] * (inside[0] - m[0]) + n[1] * (inside[1] - m[1]) > 0) n = [-n[0], -n[1]];
    const yaw = Math.atan2(-t[1], t[0]);
    const P = (u: number, off: number): V2 => [a[0] + t[0] * u - n[0] * off, a[1] + t[1] * u - n[1] * off];
    // Builder.wall(p→q) ön yüzü (−dz, dx) = sol normal; sokağa bakması için sıra seçilir (UV terslenir)
    const leftIsStreet = -t[1] * n[0] + t[0] * n[1] > 0;
    /** dir +1: sokağa bakan yüz, −1: site içine bakan yüz. uvA/uvE: kenar başı/sonu u değerleri */
    const face = (
      key: string,
      u0: number,
      u1: number,
      off: number,
      ya: number,
      yb: number,
      uvA: number,
      uvE: number,
      v0: number,
      v1: number,
      dir: 1 | -1,
    ) => {
      const p = P(u0, off);
      const q = P(u1, off);
      const pq = leftIsStreet === (dir === 1);
      if (pq) b.wall(key, p, q, ya, yb, [uvA, v0, uvE, v1]);
      else b.wall(key, q, p, ya, yb, [uvE, v0, uvA, v1]);
    };
    // Parçalar: kolon/kapı kenarlarında kesilir, aralar ~2 m'lik dilimler (zemin kotu izlenir)
    const cuts = [0, L];
    for (const U of pil) if (U > cum[i] + 0.01 && U < cum[i + 1] - 0.01) cuts.push(U - cum[i]);
    for (const g of gapsU)
      for (const U of g) if (U > cum[i] + 0.01 && U < cum[i + 1] - 0.01) cuts.push(U - cum[i]);
    cuts.sort((p, q) => p - q);
    const pieces: [number, number][] = [];
    for (let c = 0; c + 1 < cuts.length; c++) {
      const len = cuts[c + 1] - cuts[c];
      if (len < 0.01) continue;
      const nS = Math.max(1, Math.ceil(len / 2));
      for (let k = 0; k < nS; k++) pieces.push([cuts[c] + (len * k) / nS, cuts[c] + (len * (k + 1)) / nS]);
    }
    for (const [u0, u1] of pieces) {
      const U0 = cum[i] + u0;
      const U1 = cum[i] + u1;
      const mid = (U0 + U1) / 2;
      if (inGap(mid)) continue;
      const pm = P((u0 + u1) / 2, 0);
      const y0 = H(pm[0], pm[1]) + 0.15; // kaldırım kotu
      // Duvar ön yüzü (dalga paneli dokusu), arka yüz düz beyaz
      face('mkWave', u0, u1, 0, y0 - 0.15, y0 + wallH, waveU(U0, mid), waveU(U1, mid), -0.15 / wallH, 1, 1);
      face('mkWallBack', u0, u1, WALL_T, y0 - 0.1, y0 + wallH, U0, U1, 0, wallH, -1);
      // Harpuşta (turuncu)
      const cc = P((u0 + u1) / 2, WALL_T / 2 - 0.01);
      b.box('mkCoping', [cc[0], y0 + wallH + 0.03, cc[1]], [u1 - u0 + 0.002, 0.06, WALL_T + 0.05], yaw);
      // Panel tel çit (duvar ortasında)
      const yM0 = y0 + wallH + 0.06;
      face('mkMesh', u0, u1, WALL_T / 2, yM0, yM0 + meshH, U0 / 0.2, U1 / 0.2, 0, meshH / 0.2, 1);
      // Perde
      const sc = screenAt(mid);
      if (sc === 'artificial') {
        face(
          'mkFoliage',
          u0,
          u1,
          WALL_T / 2 + 0.03,
          yM0 + 0.02,
          yM0 + meshH - 0.04,
          U0,
          U1,
          0,
          meshH - 0.06,
          1,
        );
        face(
          'mkFoliage',
          u0,
          u1,
          WALL_T / 2 + 0.05,
          yM0 + 0.02,
          yM0 + meshH - 0.04,
          U0,
          U1,
          0,
          meshH - 0.06,
          -1,
        );
      }
      if (sc === 'real' || sc === 'artificial') {
        // Arkadaki leylandi gövdesi (yapay panelin arkasında da çoğu yerde var; daha alçak/koyu görünür)
        const hh = sc === 'real' ? hedgeH : Math.min(hedgeH, wallH + meshH + 0.35);
        const off0 = WALL_T + 0.05;
        const hy0 = y0 + wallH * 0.5;
        face('mkHedge', u0, u1, off0, hy0, y0 + hh, U0 / 2, U1 / 2, hy0 - y0, hh, 1);
        // Üst yüz
        const t0 = P(u0, off0);
        const t1 = P(u1, off0);
        const t2 = P(u1, off0 + hedgeD);
        const t3 = P(u0, off0 + hedgeD);
        b.quad(
          'mkHedge',
          [t0[0], y0 + hh, t0[1]],
          [t1[0], y0 + hh, t1[1]],
          [t2[0], y0 + hh, t2[1]],
          [t3[0], y0 + hh, t3[1]],
          [U0 / 2, 0, U1 / 2, hedgeD / 2],
        );
        // KARAR: yaprak kartı saçağı kaldırıldı (eleştirmen: gerçek budanmış leylandide pençe gibi koyu filizler yok)
      }
      collide?.(
        [P(u0, -0.02), P(u1, -0.02), P(u1, WALL_T + hedgeD * 0.6), P(u0, WALL_T + hedgeD * 0.6)],
        y0 - 1,
        y0 + 2.2,
      );
    }
    // Tel dikmeleri (koyu yeşil)
    for (let U = Math.ceil(cum[i] / POST_EVERY) * POST_EVERY; U < cum[i + 1]; U += POST_EVERY) {
      if (inGap(U)) continue;
      const p = P(U - cum[i], WALL_T / 2 - 0.03);
      const y0 = H(p[0], p[1]) + 0.15;
      b.box('mkMeshPost', [p[0], y0 + wallH + meshH / 2 + 0.05, p[1]], [0.06, meshH + 0.1, 0.04], yaw);
    }
    // Jiletli tel (halkalar)
    if (f.razor !== false)
      // Street View: sık, iç içe geçmiş parlak gümüş halkalar (~0.3 m çap)
      for (let U = cum[i] + 0.1; U < cum[i + 1]; U += 0.2) {
        if (inGap(U)) continue;
        const p = P(U - cum[i], WALL_T / 2);
        const y0 = H(p[0], p[1]) + 0.15;
        const ring = new THREE.TorusGeometry(0.28, 0.005, 3, 14);
        ring.rotateY(yaw + Math.PI / 2 + 0.4);
        ring.translate(p[0], y0 + wallH + meshH + 0.28, p[1]);
        b.geometry('wire', ring);
      }
    // Panel derz dikmeleri (beyaz, sokak yüzünden 2 cm taşkın)
    for (let k = 0; k + 1 < pil.length; k++) {
      const a0 = pil[k];
      const e0 = pil[k + 1];
      const n0 = Math.max(1, Math.round((e0 - a0) / PANEL));
      for (let j = 1; j < n0; j++) {
        const U = a0 + ((e0 - a0) * j) / n0;
        if (U < cum[i] || U >= cum[i + 1] || inGap(U)) continue;
        const p = P(U - cum[i], WALL_T / 2 - 0.02);
        const y0 = H(p[0], p[1]) + 0.15;
        b.box('mkWallBack', [p[0], y0 + wallH / 2 - 0.05, p[1]], [0.11, wallH + 0.1, WALL_T + 0.04], yaw);
      }
    }
    // Kolonlar: ölçülmüş/düzenli + kapı kenarları (köşe kolonu iki kenarda bir kez)
    const pillarsHere: number[] = [];
    for (const U of pil)
      if (U >= cum[i] - 1e-6 && (U < cum[i + 1] - 1e-6 || i + 2 === pts.length))
        if (f.endPillar !== false || U < total - 0.05) pillarsHere.push(U - cum[i]);
    for (const u of pillarsHere) {
      const U = cum[i] + u;
      if (inGap(U + 0.01) && inGap(U - 0.01)) continue;
      const p = P(u, WALL_T / 2);
      const y0 = H(p[0], p[1]) + 0.15;
      pillar(b, p, y0, pW, pH, yaw, lamp);
      collide?.(
        [
          [p[0] - pW / 2, p[1] - pW / 2],
          [p[0] + pW / 2, p[1] - pW / 2],
          [p[0] + pW / 2, p[1] + pW / 2],
          [p[0] - pW / 2, p[1] + pW / 2],
        ],
        y0 - 1,
        y0 + pH,
      );
    }
  }
}

function pillar(b: Builder, p: V2, y0: number, w: number, h: number, yaw: number, lamp: boolean): void {
  b.box('mkPillar', [p[0], y0 + h / 2 - 0.1, p[1]], [w, h + 0.2, w], yaw);
  b.box('mkPillar', [p[0], y0 + h + 0.035, p[1]], [w + 0.09, 0.07, w + 0.09], yaw);
  if (!lamp) return;
  b.cylinder('capDark', [p[0], y0 + h + 0.07, p[1]], 0.05, 0.12, 8);
  b.cylinder('capDark', [p[0], y0 + h + 0.19, p[1]], 0.08, 0.03, 8);
  b.sphere('globe', [p[0], y0 + h + 0.36, p[1]], 0.16, 12);
}
