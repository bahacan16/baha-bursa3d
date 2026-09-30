import * as THREE from 'three';
import { Builder, leafFringe, type V2 } from './builder';

/**
 * Mertkent site sınırı (Street View): yatay oluklu beyaz taş kaplı alçak duvar (0.65 m), ince bej harpuşta,
 * ~3 m arayla turuncu kare kolonlar ve üstünde beyaz küre lamba, duvar üstünde yeşil panel çit,
 * arkasında sık leylandi çitı, üstte jiletli tel.
 */
export interface FenceSeg {
  a: V2;
  e: V2;
  y0: number;
  /** yola bakan birim normal */
  n: V2;
}

const WALL_H = 0.8;
const WALL_T = 0.3;
const PANEL_H = 1.1;
const PILLAR = 0.3;
const PILLAR_H = 1.3;
const HEDGE_D = 0.9;
const HEDGE_H = 2.0;
const PILLAR_STEP = 4.6;

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

/** a→e kenarını, ön yüz normali n olacak şekilde döndür. */
function facing(a: V2, e: V2, n: V2): [V2, V2] {
  const dx = e[0] - a[0];
  const dz = e[1] - a[1];
  return -dz * n[0] + dx * n[1] >= 0 ? [a, e] : [e, a];
}

export function buildFence(
  b: Builder,
  segs: FenceSeg[],
  gates: { c: V2; half: number }[],
  collide?: Collide,
): void {
  let pillarRun = 0;
  for (const s of segs) {
    const [nx, nz] = s.n;
    const len = Math.hypot(s.e[0] - s.a[0], s.e[1] - s.a[1]);
    if (len < 0.2) continue;
    const t: V2 = [(s.e[0] - s.a[0]) / len, (s.e[1] - s.a[1]) / len];
    const yaw = Math.atan2(-t[1], t[0]);
    const y0 = s.y0;
    // Kapı açıklığı: bu parça bir kapı konumunu kesiyorsa o aralığı boş bırak (kapı ayrı çizilir)
    const cuts: [number, number][] = [];
    for (const g of gates) {
      const u = (g.c[0] - s.a[0]) * t[0] + (g.c[1] - s.a[1]) * t[1];
      const v = Math.abs((g.c[0] - s.a[0]) * nx + (g.c[1] - s.a[1]) * nz);
      if (v < 2.5 && u > -g.half && u < len + g.half) cuts.push([u - g.half, u + g.half]);
    }
    const pieces: [number, number][] = [];
    let cur = 0;
    for (const [c0, c1] of cuts.sort((p, q) => p[0] - q[0])) {
      if (c0 > cur) pieces.push([cur, Math.min(c0, len)]);
      cur = Math.max(cur, c1);
    }
    if (cur < len) pieces.push([cur, len]);
    for (const [u0, u1] of pieces) {
      if (u1 - u0 < 0.1) continue;
      const P = (u: number, off: number): V2 => [s.a[0] + t[0] * u - nx * off, s.a[1] + t[1] * u - nz * off];
      const L = u1 - u0;
      // Duvar: ön (yola bakan), arka, üst harpuşta
      const [fa, fe] = facing(P(u0, 0), P(u1, 0), s.n);
      b.wall('stone', fa, fe, y0 - 0.3, y0 + WALL_H, [0, 0, L, (WALL_H + 0.3) / 0.8]);
      const [ba, be] = facing(P(u0, WALL_T), P(u1, WALL_T), [-nx, -nz]);
      b.wall('stone', ba, be, y0 - 0.3, y0 + WALL_H, [0, 0, L, (WALL_H + 0.3) / 0.8]);
      const mc = P((u0 + u1) / 2, WALL_T / 2);
      b.box('cap', [mc[0], y0 + WALL_H + 0.025, mc[1]], [L, 0.05, WALL_T + 0.06], yaw);
      // Panel çit (duvar ekseninde)
      const pa = P(u0, WALL_T / 2);
      const pe = P(u1, WALL_T / 2);
      b.wall('panel', pa, pe, y0 + WALL_H + 0.05, y0 + WALL_H + 0.05 + PANEL_H, [0, 0, L / 2.5, 1]);
      // Çalı kutusu (arkada)
      const hc = P((u0 + u1) / 2, WALL_T + HEDGE_D / 2 + 0.05);
      b.box('hedge', [hc[0], y0 + HEDGE_H / 2, hc[1]], [L, HEDGE_H, HEDGE_D], yaw, 0.7, 0b111111 & ~0b100000);
      // Leylandi dokusu: sokağa bakan yüz + üst, yaprak kartları (düz kutu silüetini kırar)
      {
        const off = WALL_T + 0.05;
        const fa = P(u0, off);
        const fe = P(u1, off);
        leafFringe(
          b,
          'hedgeLeaf',
          fa,
          fe,
          y0 + WALL_H + 0.1,
          y0 + HEDGE_H,
          HEDGE_D,
          [nx, nz],
          9,
          Math.floor(u0 * 31 + s.a[0] * 7) + 3,
          0.55,
        );
      }
      // Jiletli tel (çalının üstünde, halkalar)
      for (let u = u0 + 0.15; u < u1; u += 0.36) {
        const p = P(u, WALL_T + 0.3);
        const ring = new THREE.TorusGeometry(0.26, 0.008, 3, 10);
        ring.rotateY(yaw + Math.PI / 2 + 0.35);
        ring.translate(p[0], y0 + HEDGE_H + 0.22, p[1]);
        b.geometry('wire', ring);
      }
      // Kolonlar + küre lamba
      for (let u = u0; u <= u1 + 1e-6; u += 0.1) {
        pillarRun += 0.1;
        if (pillarRun < PILLAR_STEP && u > u0) continue;
        pillarRun = 0;
        const p = P(Math.min(u, u1), WALL_T / 2);
        b.box('ochre', [p[0], y0 + PILLAR_H / 2 - 0.15, p[1]], [PILLAR, PILLAR_H + 0.3, PILLAR], yaw);
        b.box('capDark', [p[0], y0 + PILLAR_H + 0.03, p[1]], [PILLAR + 0.06, 0.06, PILLAR + 0.06], yaw);
        b.cylinder('capDark', [p[0], y0 + PILLAR_H + 0.06, p[1]], 0.05, 0.08, 6);
        b.sphere('globe', [p[0], y0 + PILLAR_H + 0.24, p[1]], 0.13, 10);
      }
      const r0 = P(u0, -0.02);
      const r1 = P(u1, -0.02);
      const r2 = P(u1, WALL_T + HEDGE_D);
      const r3 = P(u0, WALL_T + HEDGE_D);
      collide?.([r0, r1, r2, r3], y0 - 1, y0 + HEDGE_H);
    }
  }
}

/**
 * Site giriş kapısı: siyah kutu portal, üstünde "MERTKENT / Sitesi 2.Etap" yazılı siyah başlık,
 * altın desenli siyah kapı kanadı, yanlarda altın baklava süslü siyah kolonlar.
 */
export function buildGate(
  b: Builder,
  c: V2,
  n: V2,
  y0: number,
  laser?: { spec: NonNullable<PlanGate['leafSpec']>; ctx: GateCtx },
): void {
  const t: V2 = [n[1], -n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  const P = (u: number, off: number): V2 => [c[0] + t[0] * u + n[0] * off, c[1] + t[1] * u + n[1] * off];
  // Kolonlar (Street View: kapıdan biraz geniş, altın madalyonlu; ölçümde kolon yüzünde üst üste altın baklavalar)
  const PX = 1.0;
  const lz = laser?.spec.pillarLozenges;
  for (const u of [-PX, PX]) {
    const p = P(u, 0);
    b.box('black', [p[0], y0 + 1.25, p[1]], [0.42, 2.5, 0.42], yaw);
    if (lz) {
      const ys = lz.yFrac ?? [0.3, 0.72];
      for (const yf of ys.slice(0, Math.max(1, lz.n ?? ys.length))) {
        const q = P(u, 0.215);
        const dg = new THREE.BoxGeometry(0.14, 0.14, 0.012);
        dg.rotateZ(Math.PI / 4);
        dg.rotateY(yaw);
        dg.translate(q[0], y0 + 2.5 * yf, q[1]);
        b.geometry('gold', dg);
      }
    } else {
      const [fa, fe] = facing(P(u - 0.16, 0.215), P(u + 0.16, 0.215), n);
      b.wall('gateOrn', fa, fe, y0 + 1.15, y0 + 1.55, [0.35, 0.05, 0.65, 0.25]);
    }
  }
  // Başlık kutusu + yazı
  const h = P(0, 0.04);
  b.box('black', [h[0], y0 + 2.78, h[1]], [2.5, 0.62, 0.52], yaw);
  const [sa, se] = facing(P(-1.18, 0.305), P(1.18, 0.305), n);
  b.wall('gateSign', sa, se, y0 + 2.52, y0 + 3.04);
  // Kapı kanadı (hafif içeride), iki yüzlü
  if (laser) {
    // Lazer kesim delikli ekran kanatlar (arkası görünür): ferforje süs dokusu (alfa) + kanat başına altın rozet
    const nl = Math.max(1, Math.min(2, laser.spec.leaves ?? 2));
    const lw = 1.58 / nl;
    const ro = laser.spec.rosette;
    for (let l = 0; l < nl; l++) {
      const ua = -0.79 + l * lw;
      const [ga, ge] = facing(P(ua, -0.05), P(ua + lw, -0.05), n);
      b.wall('ironScroll', ga, ge, y0 + 0.02, y0 + 2.45, [0, 0, Math.max(1, Math.round(lw / 0.5)), 5]);
      const [gb, gc] = facing(P(ua, -0.055), P(ua + lw, -0.055), [-n[0], -n[1]]);
      b.wall('ironScroll', gb, gc, y0 + 0.02, y0 + 2.45, [0, 0, Math.max(1, Math.round(lw / 0.5)), 5]);
      if (l > 0) {
        const m = P(ua, -0.055);
        b.box('black', [m[0], y0 + 1.24, m[1]], [0.04, 2.44, 0.06], yaw);
      }
      if (ro && (ro.perLeaf ?? 1) > 0) {
        const R = (lw * (ro.dFrac ?? 0.45)) / 2;
        const q = P(ua + lw / 2, -0.03);
        const rg = new THREE.RingGeometry(R * 0.35, R, 20, 1);
        rg.rotateY(yaw);
        rg.translate(q[0], y0 + 0.02 + 2.43 * (ro.yFrac ?? 0.5), q[1]);
        b.geometry('gold', rg);
        const rg2 = new THREE.RingGeometry(R * 0.35, R, 20, 1);
        rg2.rotateY(yaw + Math.PI);
        const q2 = P(ua + lw / 2, -0.075);
        rg2.translate(q2[0], y0 + 0.02 + 2.43 * (ro.yFrac ?? 0.5), q2[1]);
        b.geometry('gold', rg2);
      }
    }
  } else {
    const [ga, ge] = facing(P(-0.79, -0.04), P(0.79, -0.04), n);
    b.wall('gate', ga, ge, y0 + 0.02, y0 + 2.45);
    const [gb, gc] = facing(P(-0.79, -0.07), P(0.79, -0.07), [-n[0], -n[1]]);
    b.wall('gate', gb, gc, y0 + 0.02, y0 + 2.45);
  }
  // Kapı kasası
  for (const u of [-0.8, 0.8]) {
    const p = P(u, -0.055);
    b.box('black', [p[0], y0 + 1.24, p[1]], [0.05, 2.46, 0.08], yaw);
  }
  const tp = P(0, -0.055);
  b.box('black', [tp[0], y0 + 2.46, tp[1]], [1.65, 0.05, 0.08], yaw);
  // Kapı kolu + kilit
  const kp = P(0.62, 0.0);
  b.box('gold', [kp[0], y0 + 1.05, kp[1]], [0.14, 0.03, 0.05], yaw);
  // Eşik
  const ep = P(0, 0.1);
  b.box('stone', [ep[0], y0 + 0.03, ep[1]], [1.7, 0.06, 0.5], yaw);
}

/**
 * Araç girişi: iki kolon arasında siyah sürgülü parmaklık kapı (kapalı), üstte sarı-siyah uyarı bandı yok —
 * sade site kapısı. c: açıklık merkezi, n: sokak yönü, w: açıklık genişliği.
 */
export function buildDriveGate(
  b: Builder,
  c: V2,
  n: V2,
  y0: number,
  w: number,
  pillars = true,
  greySlats = false,
): void {
  const t: V2 = [n[1], -n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  const P = (u: number, off: number): V2 => [c[0] + t[0] * u + n[0] * off, c[1] + t[1] * u + n[1] * off];
  if (pillars)
    for (const u of [-w / 2 - 0.2, w / 2 + 0.2]) {
      const p = P(u, -0.15);
      b.box('ochre', [p[0], y0 + 0.85, p[1]], [0.4, 1.7, 0.4], yaw);
      b.box('capDark', [p[0], y0 + 1.73, p[1]], [0.46, 0.06, 0.46], yaw);
      b.sphere('globe', [p[0], y0 + 1.92, p[1]], 0.14, 10);
    }
  if (greySlats) {
    // Gri alüminyum dikey lamelli kapı (ölçüm: UPTOWN yaya kapısı)
    const H1 = 1.9;
    const nS = Math.max(2, Math.round(w / 0.11));
    for (let k = 0; k < nS; k++) {
      const p = P(-w / 2 + (w * (k + 0.5)) / nS, -0.1);
      b.box('gateGrey', [p[0], y0 + 0.05 + H1 / 2, p[1]], [0.07, H1, 0.03], yaw);
    }
    for (const y of [0.12, H1 - 0.05]) {
      const m = P(0, -0.1);
      b.box('gateGrey', [m[0], y0 + y, m[1]], [w - 0.02, 0.06, 0.05], yaw);
    }
    return;
  }
  // Siyah ferforje sürgülü kapı (Street View: dikey çubuklar, altta ~0.5 m kıvrımlı süs bandı, orta kuşak)
  const H0 = 1.75;
  const a = P(-w / 2 + 0.02, -0.1);
  const e = P(w / 2 - 0.02, -0.1);
  b.wall('ironBars', a, e, y0 + 0.62, y0 + H0 - 0.05, [0, 0, w / 0.12, 1]);
  b.wall('ironBars', e, a, y0 + 0.62, y0 + H0 - 0.05, [0, 0, w / 0.12, 1]);
  b.wall('gateOrnBand', a, e, y0 + 0.1, y0 + 0.6, [0, 0, w / 0.5, 1]);
  b.wall('gateOrnBand', e, a, y0 + 0.1, y0 + 0.6, [0, 0, w / 0.5, 1]);
  for (const y of [0.08, 0.61, H0 - 0.04]) {
    const m = P(0, -0.1);
    b.box('iron', [m[0], y0 + y, m[1]], [w - 0.04, 0.05, 0.05], yaw);
  }
  // Kapı kanadı kenar dikmeleri + ray
  for (const u of [-w / 2 + 0.04, 0, w / 2 - 0.04]) {
    const p = P(u, -0.1);
    b.box('iron', [p[0], y0 + H0 / 2, p[1]], [0.06, H0, 0.06], yaw);
  }
  const r = P(0, -0.1);
  b.box('darkMetal', [r[0], y0 + 0.01, r[1]], [w + 0.4, 0.03, 0.08], yaw);
}

/**
 * Çitteki küçük yaya kapısı (güney araç kapısı yanı): siyah çerçeve, yapay yaprak kaplı kanat.
 * c: kapı merkezi (çit hattında), n: sokak yönü, w: kanat genişliği.
 */
/** Yaya kapısı biçimi (ölçüm): lamelli çelik kanat + kalın kolonlar (+ küre lamba); verilmezse Mertkent yaprak kapısı */
export interface SideDoorStyle {
  /** 'slats': yatay lamelli çelik kanat; 'panel': 2D kaynaklı tel panel kanat (çerçeve frameKey) */
  style?: 'leaf' | 'slats' | 'panel';
  /** Kanat malzeme anahtarı */
  leafKey?: string;
  /** Kanat çerçevesi malzemesi (panel) */
  frameKey?: string;
  pillars?: { w: number; h: number; key: string; lamp?: string };
}

export function buildSideDoor(
  b: Builder,
  c: V2,
  n: V2,
  y0: number,
  w: number,
  h: number,
  st: SideDoorStyle = {},
): void {
  const t: V2 = [n[1], -n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  const P = (u: number, off: number): V2 => [c[0] + t[0] * u + n[0] * off, c[1] + t[1] * u + n[1] * off];
  if (st.pillars) {
    // Kalın kare kolonlar kanadın iki yanında (+ başlık, küre lamba)
    const pw = st.pillars.w;
    for (const u of [-w / 2 - pw / 2, w / 2 + pw / 2]) {
      const p = P(u, 0);
      b.box(st.pillars.key, [p[0], y0 + st.pillars.h / 2 - 0.1, p[1]], [pw, st.pillars.h + 0.2, pw], yaw);
      b.box(st.pillars.key, [p[0], y0 + st.pillars.h + 0.03, p[1]], [pw + 0.05, 0.06, pw + 0.05], yaw);
      if (/globe|küre/.test(st.pillars.lamp ?? '')) {
        b.cylinder('capDark', [p[0], y0 + st.pillars.h + 0.06, p[1]], 0.05, 0.08, 8);
        b.sphere('globe', [p[0], y0 + st.pillars.h + 0.26, p[1]], 0.145, 12);
      }
    }
  }
  if (st.style === 'panel') {
    // 2D tel panel kanat: kalın çerçeve + kaynaklı tel (iki yüz), kol
    const fk = st.frameKey ?? 'iron';
    const tp = P(0, 0);
    b.box(fk, [tp[0], y0 + h - 0.03, tp[1]], [w, 0.05, 0.05], yaw);
    b.box(fk, [tp[0], y0 + 0.05, tp[1]], [w, 0.05, 0.05], yaw);
    for (const u of [-w / 2 + 0.03, w / 2 - 0.03]) {
      const p = P(u, 0);
      b.box(fk, [p[0], y0 + h / 2, p[1]], [0.05, h, 0.05], yaw);
    }
    const lk = st.leafKey ?? 'mkMesh';
    const [fa, fe] = facing(P(-w / 2 + 0.05, 0.005), P(w / 2 - 0.05, 0.005), n);
    b.wall(lk, fa, fe, y0 + 0.08, y0 + h - 0.06, [0, 0, (w - 0.1) / 0.2, (h - 0.14) / 0.2]);
    b.wall(lk, fe, fa, y0 + 0.08, y0 + h - 0.06, [0, 0, (w - 0.1) / 0.2, (h - 0.14) / 0.2]);
    const kp = P(w / 2 - 0.14, 0.04);
    b.box('darkMetal', [kp[0], y0 + 1.0, kp[1]], [0.12, 0.03, 0.04], yaw);
    return;
  }
  if (st.style === 'slats') {
    // Yatay lamelli çelik kanat: çerçeve + ~9 cm aralıklı lameller (iki yüz)
    const k = st.leafKey ?? 'gateGrey';
    const tp = P(0, 0);
    b.box(k, [tp[0], y0 + h - 0.03, tp[1]], [w, 0.06, 0.05], yaw);
    b.box(k, [tp[0], y0 + 0.05, tp[1]], [w, 0.06, 0.05], yaw);
    for (const u of [-w / 2 + 0.03, w / 2 - 0.03]) {
      const p = P(u, 0);
      b.box(k, [p[0], y0 + h / 2, p[1]], [0.06, h, 0.05], yaw);
    }
    for (let yy = y0 + 0.14; yy < y0 + h - 0.08; yy += 0.09)
      b.box(k, [tp[0], yy, tp[1]], [w - 0.1, 0.055, 0.02], yaw);
    const kp = P(w / 2 - 0.14, 0.04);
    b.box('darkMetal', [kp[0], y0 + 1.0, kp[1]], [0.12, 0.03, 0.04], yaw);
    return;
  }
  for (const u of [-w / 2, w / 2]) {
    const p = P(u, 0);
    b.box('iron', [p[0], y0 + h / 2, p[1]], [0.06, h, 0.06], yaw);
  }
  const tp = P(0, 0);
  b.box('iron', [tp[0], y0 + h - 0.02, tp[1]], [w, 0.05, 0.05], yaw);
  b.box('iron', [tp[0], y0 + 0.04, tp[1]], [w, 0.05, 0.05], yaw);
  const [fa, fe] = facing(P(-w / 2 + 0.03, 0.02), P(w / 2 - 0.03, 0.02), n);
  b.wall('mkFoliage', fa, fe, y0 + 0.06, y0 + h - 0.04, [0, 0, w, h]);
  const [ga, ge] = facing(P(-w / 2 + 0.03, -0.02), P(w / 2 - 0.03, -0.02), [-n[0], -n[1]]);
  b.wall('mkFoliage', ga, ge, y0 + 0.06, y0 + h - 0.04, [0, 0, w, h]);
  // Küçük kahverengi levha + kol
  const kp = P(w / 2 - 0.12, 0.04);
  b.box('darkMetal', [kp[0], y0 + 1.0, kp[1]], [0.12, 0.03, 0.04], yaw);
}

/**
 * Park Koza Sitesi girişi (502. Sk güney ucu, doğu yaka; Street View l4zd…): taş kaplı iki kolon arasında gri tel
 * sürgülü araç kapısı, kolon üstlerinde siyah fener; batıda sıvalı alçak duvar + "PARK KOZA SİTESİ" harfleri,
 * arkasında çit; kapının yanında trafik aynası, köşede kırmızı-beyaz dikme. c: kapı merkezi, n: sokak yönü.
 * KARAR: konum Street View karesinden (pano GPS ±2 m), boyutlar karelerdeki kolon/kapı oranlarından.
 */
export function buildParkKoza(b: Builder, c: V2, n: V2, y0: number, collide?: Collide): void {
  // Ölçüm (street-plan notu, SV l4zdb_323_-15_40 / l4zdb_300_0): kaba beyaz sıvalı, üstü yuvarlatılmış duvar h≈1.6;
  // üstünde yatay koyu metal parmaklık (≈3 lama), 'PARK KOZA' / 'SİTESİ' krem-altın 3B harfler parmaklıkta (üst ≈2.3,
  // alt satır ≈1.8); kolon kaba beyaz sıva + açık gri taş başlık + küçük siyah fener; gri 2D tel panel döner kanat,
  // koyu gri kutu profil çerçeve; batı kolonu önünde beyaz direkte dışbükey ayna; turuncu-beyaz esnek dikme.
  const t: V2 = [n[1], -n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  const P = (u: number, off: number): V2 => [c[0] + t[0] * u + n[0] * off, c[1] + t[1] * u + n[1] * off];
  const W = 5.2;
  // Kolonlar: kaba beyaz sıva, açık gri taş başlık, küçük siyah fener
  for (const u of [-W / 2 - 0.28, W / 2 + 0.28]) {
    const p = P(u, 0);
    b.box('mkWallBack', [p[0], y0 + 0.9, p[1]], [0.56, 1.8, 0.56], yaw);
    b.box('stone', [p[0], y0 + 1.84, p[1]], [0.66, 0.08, 0.66], yaw);
    b.cylinder('darkMetal', [p[0], y0 + 1.88, p[1]], 0.05, 0.1, 8);
    b.box('darkMetal', [p[0], y0 + 2.08, p[1]], [0.16, 0.24, 0.16], yaw);
    collide?.(
      [
        [p[0] - 0.3, p[1] - 0.3],
        [p[0] + 0.3, p[1] - 0.3],
        [p[0] + 0.3, p[1] + 0.3],
        [p[0] - 0.3, p[1] + 0.3],
      ],
      y0 - 1,
      y0 + 2,
    );
  }
  // Gri 2D tel panel döner kanat (saydam — ince teller alfa testinde uzakta kayboluyordu), koyu gri kutu profil
  const a = P(-W / 2, 0);
  const e = P(W / 2, 0);
  b.wall('meshGrey', a, e, y0 + 0.05, y0 + 1.6, [0, 0, W / 0.2, 1.55 / 0.2]);
  for (const y of [0.05, 1.6]) {
    const m = P(0, 0);
    b.box('frameGrey', [m[0], y0 + y, m[1]], [W, 0.05, 0.05], yaw);
  }
  for (const u of [-W / 2, -W / 6, W / 6, W / 2]) {
    const p = P(u, 0);
    b.box('frameGrey', [p[0], y0 + 0.8, p[1]], [0.05, 1.6, 0.05], yaw);
  }
  collide?.([P(-W / 2, -0.05), P(W / 2, -0.05), P(W / 2, 0.05), P(-W / 2, 0.05)], y0 - 1, y0 + 1.6);
  // Batı: kaba beyaz sıvalı duvar h 1.6, yuvarlatılmış üst; üstünde koyu metal lama parmaklık + 3B harfler
  const L = 4.2;
  const WH = 1.6;
  const w0 = -W / 2 - 0.56;
  const wm = P(w0 - L / 2, 0);
  b.box('mkWallBack', [wm[0], y0 + (WH - 0.15) / 2, wm[1]], [L, WH - 0.15, 0.3], yaw);
  const rg = new THREE.CylinderGeometry(0.15, 0.15, L, 12, 1, false, 0, Math.PI);
  // Eksen x'e (duvar boyu), yarım silindirin kubbesi yukarı
  rg.rotateZ(Math.PI / 2);
  rg.rotateY(yaw);
  rg.translate(wm[0], y0 + WH - 0.15, wm[1]);
  b.geometry('mkWallBack', rg);
  for (const yy of [1.72, 2.0, 2.3]) b.box('darkMetal', [wm[0], y0 + yy, wm[1]], [L - 0.2, 0.05, 0.02], yaw);
  for (const uu of [w0 - L + 0.25, w0 - L / 2, w0 - 0.25]) {
    const q = P(uu, 0);
    b.box('darkMetal', [q[0], y0 + (WH + 2.33) / 2, q[1]], [0.04, 2.33 - WH, 0.04], yaw);
  }
  const [sa, se] = [P(w0 - L + 0.3, 0.03), P(w0 - 0.3, 0.03)];
  // wall(sa→se) ön yüzü n (sokak) yönüne — önceden ters sıra: harfler duvarın içine bakıyor, görünmüyordu (critic V15 #4)
  b.wall('parkKozaSign', sa, se, y0 + 1.72, y0 + 2.36);
  const hm = P(w0 - L / 2, -0.8);
  b.box('mkHedge', [hm[0], y0 + 1.1, hm[1]], [L, 2.2, 1.0], yaw, 0.5);
  collide?.([P(w0 - L, -1.3), P(w0, -1.3), P(w0, 0.15), P(w0 - L, 0.15)], y0 - 1, y0 + 2);
  // Trafik aynası (kapı batı kolonunun önü, beyaz direk, gri arka) + turuncu-beyaz esnek dikme (köşe)
  const mp = P(-W / 2 - 0.9, 0.5);
  b.cylinder('mkAc', [mp[0], y0, mp[1]], 0.04, 2.4, 8);
  const mg = new THREE.SphereGeometry(0.38, 16, 8, 0, Math.PI * 2, 0, 0.5).rotateX(-Math.PI / 2);
  mg.rotateY(Math.atan2(n[0], n[1]));
  mg.translate(mp[0], y0 + 2.6, mp[1]);
  b.geometry('steel', mg);
  const bk = new THREE.CircleGeometry(0.39, 16);
  bk.rotateY(Math.atan2(n[0], n[1]) + Math.PI);
  bk.translate(mp[0] - n[0] * 0.01, y0 + 2.6, mp[1] - n[1] * 0.01);
  b.geometry('frameGrey', bk);
  const bp = P(w0 - L - 0.5, 0.8);
  b.cylinder('bollardOrange', [bp[0], y0, bp[1]], 0.05, 0.8, 8);
  b.cylinder('spPaint', [bp[0], y0 + 0.6, bp[1]], 0.052, 0.06, 8);
}

/** street-plan.json kapı kaydı */
export interface PlanGate {
  kind: string;
  id?: string;
  c: V2;
  n: V2;
  w: number;
  h?: number;
  note?: string;
  /**
   * Biçim (verilirse HER kapıda uygulanır): mertkent (siyah kutu portal + tabela, Mertkent 2 yaya kapısı), drive
   * (siyah sürgülü ferforje araç kapısı), grey (gri lamelli sürgülü), wrought (mızrak uçlu ferforje yaya kapısı),
   * bars (siyah çubuklu), slats (gri yatay lamelli kanat), leaf (yapay yapraklı kanat), panel (2D tel panel kanat),
   * portal (iki kolon + üst kiriş + kiriş yüzünde harfler, altında kanat: Mertkent 3 girişi).
   */
  style?: string;
  color?: string;
  leaves?: number;
  pillars?: { w: number; h?: number; d?: number; color: string; lamp?: string };
  /** Portal: kiriş (alt-üst kot tabandan, derinlik, renk) */
  beam?: { top: number; h: number; d?: number; color?: string };
  /** Portal kiriş yüzündeki yazı (sokak yüzü): metin, renk, yazı tipi, harf yüksekliği (m), 3B harf derinliği */
  text?: { text: string; fg?: string; font?: string; bold?: boolean; size?: number; d?: number };
  /** Portal altındaki kanat: wrought | drive | bars | grey | none; yüksekliği */
  leaf?: string;
  leafH?: number;
  /** Kolona monte trafik aynası: hangi kolon (sokaktan bakınca left/right), kot, yarıçap, çerçeve rengi */
  mirror?: { side: 'left' | 'right'; h?: number; r?: number; rim?: string };
  /**
   * Kanat ayrıntısı (ölçüm): laser-screen (Mertkent yaya kapısı: `leaves` kanat, delikli lazer kesim siyah ekran,
   * kanat başına `rosette` {perLeaf, dFrac çap/kanat eni, yFrac, color}, kolon yüzünde `pillarLozenges` {n, yFrac[],
   * color}); mesh-slide (araç kapısı: `frame` renk, dikdörtgen gözlü tel panel, üst rayda `finials` {kind spear,
   * color}, altta `scrollBand` {h, color})
   */
  leafSpec?: {
    style?: string;
    leaves?: number;
    color?: string;
    rosette?: { perLeaf?: number; dFrac?: number; yFrac?: number; color?: string };
    pillarLozenges?: { n?: number; yFrac?: number[]; color?: string };
    frame?: string;
    mesh?: string;
    finials?: { kind?: string; color?: string };
    scrollBand?: { h?: number; color?: string };
  };
  /** Kapı yanındaki çit kolonu (komşu yaya kapısı tarafı): başlık rengi, dibinde kutu {w, h, color} */
  pillarSpec?: { cap?: { color?: string }; footBox?: { w?: number; h?: number; color?: string } };
}

export interface GateCtx {
  /** En yakın komşu kapının merkezi (pillarSpec kolonunu seçmek için) */
  near?: V2;
  /** Tür + renk → malzeme anahtarı (fenceGeneric mat) */
  mat: (kind: string, color: string) => string;
  colorKey: (kind: 'metal' | 'fascia' | 'frame', hex: string) => string;
  signFace?: (s: {
    text: string;
    bg: string | null;
    fg: string;
    border: string | null;
    font: string;
    bold: boolean;
    lit: boolean;
    style: string;
    w: number;
    h: number;
    side?: boolean;
  }) => string;
  collide?: Collide;
  /** Ferforje kapı çizici (fenceGeneric.buildWroughtGate; döngüsel içe aktarmayı önlemek için verilir) */
  wrought: (
    b: Builder,
    c: V2,
    n: V2,
    y0: number,
    w: number,
    h: number,
    mat: (kind: string, color: string) => string,
    o: { color?: string; leaves?: number; pillars?: { w: number; h: number; color: string } | null },
  ) => void;
}

/** Kapının fence boşluğu genişliği (kolonlar dahil): çit hattında kesilecek aralık */
export function gateGapWidth(g: PlanGate): number {
  return g.style === 'portal' ? g.w + 2 * (g.pillars?.w ?? 0.9) : g.w + 0.3;
}

/**
 * Ölçülmüş kapıyı biçimine göre çizer (ground: kapı merkezindeki arazi kotu). KARAR: `style` verilmemişse v5
 * kuralları (da* komşu site kapıları: notunda ferforje → wrought, gri lamel → grey, yoksa drive; Mertkent: ≥ 2 m yaya
 * → mertkent, araç → drive, dar yaya → yaprak kapı).
 */
export function buildPlanGate(b: Builder, g: PlanGate, ground: number, ctx: GateCtx): void {
  const id = g.id ?? '';
  const da = /^da\d-/.test(id);
  const note = g.note ?? '';
  const style =
    g.style ??
    (da
      ? g.kind === 'pedestrian' && /ferforje|wrought/i.test(note)
        ? 'wrought'
        : /gri\b.*(lamel|çıta|slat)|grey slat/i.test(note)
          ? 'grey'
          : 'drive'
      : g.kind === 'vehicle'
        ? 'drive'
        : g.w >= 2
          ? 'mertkent'
          : 'leaf');
  // Kot: komşu site kapıları ve portal zeminde (+5 cm), Mertkent yaya kapıları kaldırım kotunda (+15 cm), araç +3 cm
  const y = da || style === 'portal' ? ground + 0.05 : g.kind === 'vehicle' ? ground + 0.03 : ground + 0.15;
  const pl = g.pillars;
  switch (style) {
    case 'portal':
      buildPortalGate(b, g, ground + 0.05, ctx);
      return;
    case 'wrought':
      ctx.wrought(b, g.c, g.n, y, g.w, g.h ?? 1.8, ctx.mat, {
        color: g.color,
        leaves: g.leaves,
        pillars: pl ? { w: pl.w, h: pl.h ?? 2, color: pl.color } : null,
      });
      return;
    case 'mertkent':
      buildGate(b, g.c, g.n, y, g.leafSpec?.style === 'laser-screen' ? { spec: g.leafSpec, ctx } : undefined);
      return;
    case 'drive':
    case 'bars':
    case 'grey':
      if (g.leafSpec?.style === 'mesh-slide') meshSlideGate(b, g, y, ctx);
      else buildDriveGate(b, g.c, g.n, y, g.w, false, style === 'grey');
      if (pl && (g.style === style || !da)) gatePillars(b, g, y, ctx);
      if (g.pillarSpec) pillarExtras(b, g, y, ctx);
      return;
    default:
      // Dar yaya kapıları: yaprak / lamel / 2D tel panel kanat (+ ölçülmüş kolonlar)
      buildSideDoor(b, g.c, g.n, y, g.w, g.h ?? 2, {
        style: style === 'slats' ? 'slats' : style === 'panel' ? 'panel' : 'leaf',
        leafKey:
          style === 'panel'
            ? ctx.mat('welded', g.color ?? '#21382b')
            : g.color
              ? ctx.colorKey('metal', g.color)
              : undefined,
        frameKey: style === 'panel' ? ctx.mat('metal', g.color ?? '#21382b') : undefined,
        pillars: pl
          ? { w: pl.w, h: pl.h ?? 2, key: ctx.colorKey('fascia', pl.color), lamp: pl.lamp }
          : undefined,
      });
  }
}

const hexOk = (h: unknown): h is string => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);

/**
 * Gri çelik sürgülü araç kapısı (ölçüm leafSpec mesh-slide): çerçeve, dikdörtgen gözlü kaynaklı tel panel, üst rayda
 * sık mızrak uçları, altta ferforje kıvrım bandı. Güney araç kapısı (critic V12 #23).
 */
function meshSlideGate(b: Builder, g: PlanGate, y0: number, ctx: GateCtx): void {
  const ls = g.leafSpec!;
  const w = g.w;
  const H0 = g.h ?? 1.75;
  const n = g.n;
  const t: V2 = [n[1], -n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  const P = (u: number, off: number): V2 => [g.c[0] + t[0] * u + n[0] * off, g.c[1] + t[1] * u + n[1] * off];
  const fr = hexOk(ls.frame) ? ls.frame : '#a0a195';
  const fk = ctx.colorKey('metal', fr);
  const sb = Math.max(0, ls.scrollBand?.h ?? 0);
  const a = P(-w / 2 + 0.03, -0.1);
  const e = P(w / 2 - 0.03, -0.1);
  // Tel panel (iki yüz) — dikdörtgen göz: kaynaklı panel dokusu
  const mk = ctx.mat('welded', fr);
  b.wall(mk, a, e, y0 + 0.06 + sb, y0 + H0 - 0.05, [0, 0, w / 0.2, (H0 - sb) / 0.2]);
  b.wall(mk, e, a, y0 + 0.06 + sb, y0 + H0 - 0.05, [0, 0, w / 0.2, (H0 - sb) / 0.2]);
  if (sb > 0.05) {
    // Kıvrım bandı: ferforje süs dokusu (KARAR: dokunun kendi koyu tonu; ölçülen #716c6b gölge tonu, yakın)
    b.wall('gateOrnBand', a, e, y0 + 0.06, y0 + 0.06 + sb, [0, 0, w / 0.5, 1]);
    b.wall('gateOrnBand', e, a, y0 + 0.06, y0 + 0.06 + sb, [0, 0, w / 0.5, 1]);
  }
  for (const yy of [0.05, 0.06 + sb, H0 - 0.03]) {
    const m = P(0, -0.1);
    b.box(fk, [m[0], y0 + yy, m[1]], [w - 0.04, 0.05, 0.05], yaw);
  }
  for (const u of [-w / 2 + 0.04, 0, w / 2 - 0.04]) {
    const p = P(u, -0.1);
    b.box(fk, [p[0], y0 + H0 / 2, p[1]], [0.06, H0, 0.06], yaw);
  }
  if (ls.finials?.kind === 'spear') {
    // KARAR: uç aralığı ölçülmedi ("sık") → 0.12 m
    const ck = hexOk(ls.finials.color) ? ctx.colorKey('metal', ls.finials.color) : fk;
    const nF = Math.max(2, Math.round(w / 0.12));
    for (let k = 0; k <= nF; k++) {
      const p = P(-w / 2 + 0.03 + ((w - 0.06) * k) / nF, -0.1);
      const cg = new THREE.ConeGeometry(0.025, 0.1, 4);
      cg.translate(p[0], y0 + H0 + 0.05, p[1]);
      b.geometry(ck, cg);
    }
  }
  const r = P(0, -0.1);
  b.box('darkMetal', [r[0], y0 + 0.01, r[1]], [w + 0.4, 0.03, 0.08], yaw);
}

/** Kapı kenarındaki çit kolonu ekleri (pillarSpec): ölçülen başlık rengi + kolon dibinde küçük kutu */
function pillarExtras(b: Builder, g: PlanGate, y0: number, ctx: GateCtx): void {
  const ps = g.pillarSpec!;
  const t: V2 = [g.n[1], -g.n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  // KARAR: hangi kolon olduğu notta "kapı ile yaya kapısı arası" → ctx.near verilirse ona yakın kenar, yoksa iki kenar
  const edges = [-g.w / 2, g.w / 2].map((u) => [g.c[0] + t[0] * u, g.c[1] + t[1] * u] as V2);
  const pick = ctx.near
    ? [
        edges.reduce((p, q) =>
          Math.hypot(q[0] - ctx.near![0], q[1] - ctx.near![1]) <
          Math.hypot(p[0] - ctx.near![0], p[1] - ctx.near![1])
            ? q
            : p,
        ),
      ]
    : edges;
  for (const p of pick) {
    // KARAR: başlık rengi (cap.color) burada çizilmez — kapı kenarı kolonu çit üreticisinden (fence2) gelir; ayrı
    // başlık kutusu kolonun olmadığı kenarda havada kalıyordu (render kontrolü m2-12). Veri: çit kolonu başlık rengi
    const fb = ps.footBox;
    if (fb) {
      const fw = fb.w ?? 0.35;
      const fh = fb.h ?? 0.25;
      const q: V2 = [p[0] + g.n[0] * (0.19 + 0.06), p[1] + g.n[1] * (0.19 + 0.06)];
      b.box(
        hexOk(fb.color) ? ctx.colorKey('fascia', fb.color) : 'mkAc',
        [q[0], y0 + fh / 2, q[1]],
        [fw, fh, 0.12],
        yaw,
      );
    }
  }
}

/** Araç kapısı yanında ölçülmüş kolonlar (kare, başlıklı, isteğe bağlı küre lamba) */
function gatePillars(b: Builder, g: PlanGate, y0: number, ctx: GateCtx): void {
  const pl = g.pillars!;
  const t: V2 = [g.n[1], -g.n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  const k = ctx.colorKey('fascia', pl.color);
  const h = pl.h ?? 1.8;
  for (const u of [-g.w / 2 - pl.w / 2, g.w / 2 + pl.w / 2]) {
    const p: V2 = [g.c[0] + t[0] * u, g.c[1] + t[1] * u];
    b.box(k, [p[0], y0 + h / 2 - 0.1, p[1]], [pl.w, h + 0.2, pl.d ?? pl.w], yaw);
    b.box(k, [p[0], y0 + h + 0.03, p[1]], [pl.w + 0.05, 0.06, (pl.d ?? pl.w) + 0.05], yaw);
    if (/globe|küre/.test(pl.lamp ?? '')) {
      b.cylinder('capDark', [p[0], y0 + h + 0.06, p[1]], 0.05, 0.08, 8);
      b.sphere('globe', [p[0], y0 + h + 0.26, p[1]], 0.145, 12);
    }
    ctx.collide?.(
      [
        [p[0] - pl.w / 2, p[1] - pl.w / 2],
        [p[0] + pl.w / 2, p[1] - pl.w / 2],
        [p[0] + pl.w / 2, p[1] + pl.w / 2],
        [p[0] - pl.w / 2, p[1] + pl.w / 2],
      ],
      y0 - 1,
      y0 + h,
    );
  }
}

/**
 * Portal kapı (Mertkent 3 Sitesi girişi): iki kare kolon, kolonları birleştiren üst kiriş (üst kotu beam.top), kirişin
 * sokak yüzünde tek tek harfler (3B katmanlı), altında kanat (ferforje / sürgülü), bir kolonda trafik aynası.
 * c: açıklık merkezi (çit hattında), n: sokak yönü, w: kolonlar arası net açıklık.
 */
export function buildPortalGate(b: Builder, g: PlanGate, y0: number, ctx: GateCtx): void {
  const n = g.n;
  const t: V2 = [n[1], -n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  const P = (u: number, off: number): V2 => [g.c[0] + t[0] * u + n[0] * off, g.c[1] + t[1] * u + n[1] * off];
  const pw = g.pillars?.w ?? 0.95;
  const pd = g.pillars?.d ?? pw;
  const colK = ctx.colorKey('fascia', g.pillars?.color ?? '#5b5f5e');
  const bm = g.beam ?? { top: 5.7, h: 1.1 };
  const top = Math.max(2.5, bm.top);
  const bh = Math.max(0.2, Math.min(top - 2.2, bm.h));
  const bd = bm.d ?? pd;
  const beamK = ctx.colorKey('fascia', bm.color ?? g.pillars?.color ?? '#5b5f5e');
  // Kolonlar (tam boy, kirişe kadar)
  for (const u of [-g.w / 2 - pw / 2, g.w / 2 + pw / 2]) {
    const p = P(u, 0);
    b.box(colK, [p[0], y0 + (top - bh) / 2 - 0.1, p[1]], [pw, top - bh + 0.2, pd], yaw);
    ctx.collide?.(
      [P(u - pw / 2, -pd / 2), P(u + pw / 2, -pd / 2), P(u + pw / 2, pd / 2), P(u - pw / 2, pd / 2)],
      y0 - 1,
      y0 + top,
    );
  }
  // Kiriş (kolonların dış kenarından dış kenarına)
  const span = g.w + 2 * pw;
  const bc = P(0, 0);
  b.box(beamK, [bc[0], y0 + top - bh / 2, bc[1]], [span, bh, bd], yaw);
  // Kiriş sokak yüzünde harfler (ölçülen metin; harf yüksekliği size, yoksa kiriş yüksekliğinin %45'i)
  const tx = g.text;
  if (tx?.text && ctx.signFace) {
    const lh = Math.min(bh * 0.9, tx.size ?? bh * 0.45);
    const tw = span - 0.3;
    const sg = {
      text: tx.text,
      bg: null,
      fg: tx.fg ?? '#f4f4f2',
      border: null,
      font: tx.font ?? 'sans',
      bold: tx.bold !== false,
      lit: false,
      style: 'letters',
      w: tw,
      h: lh,
    };
    const key = ctx.signFace(sg);
    const yc = y0 + top - bh / 2;
    const face = bd / 2 + 0.012;
    const dL = Math.max(0, tx.d ?? 0.03);
    const a = P(-tw / 2, face + dL);
    const e = P(tw / 2, face + dL);
    // wall(a→e) ön yüzü sokağa (n) bakmalı: sıra t yönünde → normal = n
    b.wall(key, a, e, yc - lh / 2, yc + lh / 2, [0, 0, 1, 1]);
    if (dL >= 0.015) {
      const sk = ctx.signFace({ ...sg, side: true });
      const nl = Math.max(2, Math.min(8, Math.round(dL / 0.006)));
      for (let l = 0; l < nl; l++) {
        const off = face + (dL * l) / nl;
        b.wall(sk, P(-tw / 2, off), P(tw / 2, off), yc - lh / 2, yc + lh / 2, [0, 0, 1, 1]);
      }
    }
  }
  // Kanat (kiriş altında, kolonlar arasında)
  const leaf = g.leaf ?? 'wrought';
  const lh = Math.min(top - bh - 0.1, g.leafH ?? 1.8);
  if (leaf === 'wrought')
    ctx.wrought(b, g.c, n, y0, g.w, lh, ctx.mat, { color: g.color, leaves: g.leaves ?? 2, pillars: null });
  else if (leaf === 'drive' || leaf === 'bars' || leaf === 'grey')
    buildDriveGate(b, g.c, n, y0, g.w, false, leaf === 'grey');
  // Trafik aynası: kolonun sokak yüzüne konsollu dışbükey ayna (turuncu çerçeve)
  const mr = g.mirror;
  if (mr) {
    // Sokaktan kapıya bakan kişinin solu = −t yönü (t: sokaktan bakınca sağ)
    const su = mr.side === 'left' ? -g.w / 2 - pw / 2 : g.w / 2 + pw / 2;
    const r = Math.max(0.15, mr.r ?? 0.3);
    const yy = y0 + (mr.h ?? 2.6);
    const m = P(su, pd / 2 + 0.25);
    const br = P(su, pd / 2 + 0.12);
    b.box('pole', [br[0], yy, br[1]], [0.05, 0.05, 0.25], yaw);
    const dome = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, 0.5).rotateX(Math.PI / 2);
    dome.rotateY(Math.atan2(n[0], n[1]));
    dome.translate(m[0], yy, m[1]);
    b.geometry('steel', dome);
    const rim = new THREE.TorusGeometry(r * 0.52, 0.035, 6, 20).rotateY(Math.atan2(n[0], n[1]));
    rim.translate(m[0], yy, m[1]);
    b.geometry(mr.rim ? ctx.colorKey('metal', mr.rim) : 'bollardOrange', rim);
  }
}
