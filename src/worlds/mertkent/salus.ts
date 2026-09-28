import * as THREE from 'three';
import { Builder, leafFringe, type V2 } from './builder';

/**
 * Salusvizyon sitesi (Street View: Cavit Orhan Tütengil Cd. batı yakası, Özhan'ın kuzeyi):
 * alçak kiremit kırmızısı klinker tuğla duvar + açık renk harpuşta, ~3 m arayla tuğla kolon (başlıklı, bazılarında
 * küre lamba), kolonlar arası siyah dikey demir parmaklık, arkada kırmızı yapraklı alev ağacı (photinia) çitleri.
 * Giriş: 5 m sürgülü araç kapısı + yaya kapısı, tuğla kaplı güvenlik kulübesi, üstte koyu gri kanopi ve üzerinde
 * gümüş "SALUSVİZYON" harfleri.
 */
export interface BrickSeg {
  a: V2;
  e: V2;
  y0: number;
  /** sokağa bakan birim normal */
  n: V2;
}

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

const WALL_H = 0.62;
const WALL_T = 0.32;
const PIL = 0.46;
const PIL_H = 1.95;
const BAR_TOP = 1.78;
const STEP = 3.0;

export function buildBrickFence(
  b: Builder,
  segs: BrickSeg[],
  gaps: { c: V2; half: number }[],
  collide?: Collide,
): void {
  let k = 0;
  for (const s of segs) {
    const len = Math.hypot(s.e[0] - s.a[0], s.e[1] - s.a[1]);
    if (len < 0.3) continue;
    const t: V2 = [(s.e[0] - s.a[0]) / len, (s.e[1] - s.a[1]) / len];
    const yaw = Math.atan2(-t[1], t[0]);
    // Boşluklar (kapı)
    const cuts: [number, number][] = [];
    for (const g of gaps) {
      const u = (g.c[0] - s.a[0]) * t[0] + (g.c[1] - s.a[1]) * t[1];
      const v = Math.abs((g.c[0] - s.a[0]) * s.n[0] + (g.c[1] - s.a[1]) * s.n[1]);
      if (v < 3 && u > -g.half && u < len + g.half) cuts.push([u - g.half, u + g.half]);
    }
    const pieces: [number, number][] = [];
    let cur = 0;
    for (const [c0, c1] of cuts.sort((p, q) => p[0] - q[0])) {
      if (c0 > cur) pieces.push([cur, Math.min(c0, len)]);
      cur = Math.max(cur, c1);
    }
    if (cur < len) pieces.push([cur, len]);
    for (const [u0, u1] of pieces) {
      const L = u1 - u0;
      if (L < 0.4) continue;
      // Sokak tarafı dış yüz: P(u, 0); içeri: −n yönü
      const P = (u: number, off: number): V2 => [
        s.a[0] + t[0] * u - s.n[0] * off,
        s.a[1] + t[1] * u - s.n[1] * off,
      ];
      const y0 = s.y0;
      const mc = P((u0 + u1) / 2, WALL_T / 2);
      b.box('brick', [mc[0], y0 + (WALL_H - 0.3) / 2, mc[1]], [L, WALL_H + 0.3, WALL_T], yaw, 1);
      b.box('brickCap', [mc[0], y0 + WALL_H + 0.03, mc[1]], [L, 0.06, WALL_T + 0.08], yaw);
      // Kolonlar
      const nP = Math.max(1, Math.round(L / STEP));
      const step = L / nP;
      for (let i = 0; i <= nP; i++) {
        const p = P(u0 + i * step, WALL_T / 2);
        b.box('brick', [p[0], y0 + PIL_H / 2 - 0.15, p[1]], [PIL, PIL_H + 0.3, PIL], yaw, 1);
        b.box('brickCap', [p[0], y0 + PIL_H + 0.04, p[1]], [PIL + 0.1, 0.08, PIL + 0.1], yaw);
        if ((k + i) % 2 === 0) {
          const g = new THREE.SphereGeometry(0.14, 12, 8);
          g.translate(p[0], y0 + PIL_H + 0.24, p[1]);
          b.geometry('gardenGlobe', g);
          b.cylinder('darkMetal', [p[0], y0 + PIL_H + 0.08, p[1]], 0.05, 0.06, 8);
        }
      }
      k += nP;
      // Parmaklık: kolon araları
      for (let i = 0; i < nP; i++) {
        const ua = u0 + i * step + PIL / 2;
        const ub = u0 + (i + 1) * step - PIL / 2;
        if (ub - ua < 0.2) continue;
        const pa = P(ua, WALL_T / 2);
        const pe = P(ub, WALL_T / 2);
        b.wall('ironBars', pa, pe, y0 + WALL_H + 0.06, y0 + BAR_TOP, [0, 0, (ub - ua) / 0.12, 1]);
        const m = P((ua + ub) / 2, WALL_T / 2);
        for (const y of [WALL_H + 0.12, BAR_TOP - 0.05])
          b.box('iron', [m[0], y0 + y, m[1]], [ub - ua, 0.04, 0.04], yaw);
      }
      // Alev ağacı çiti (içeride), kırmızı/yeşil yaprak kartları
      const ha = P(u0 + 0.2, WALL_T + 0.35);
      const he = P(u1 - 0.2, WALL_T + 0.35);
      const hc = P((u0 + u1) / 2, WALL_T + 0.7);
      b.box('boxwood', [hc[0], y0 + 0.9, hc[1]], [L - 0.4, 1.6, 0.7], yaw, 0.8, 0b111111 & ~0b100000);
      leafFringe(b, 'photGreen', ha, he, y0 + 0.5, y0 + 1.7, 0.7, s.n, 10, Math.floor(u0 * 17) + 5, 0.4);
      leafFringe(b, 'photRed', ha, he, y0 + 1.1, y0 + 1.85, 0.7, s.n, 7, Math.floor(u0 * 23) + 9, 0.35);
      const r0 = P(u0, -0.02);
      const r1 = P(u1, -0.02);
      const r2 = P(u1, WALL_T + 1.1);
      const r3 = P(u0, WALL_T + 1.1);
      collide?.([r0, r1, r2, r3], y0 - 1, y0 + 2);
    }
  }
}

/**
 * Salusvizyon girişi. c: kapı merkezi (çit hattında), n: sokak yönü. Kuzeyde yaya kapısı, güneyde kulübe.
 */
export function buildSalusGate(b: Builder, c: V2, n: V2, y0: number, collide?: Collide): void {
  const t: V2 = [n[1], -n[0]]; // sokaktan bakınca sağ
  const yaw = Math.atan2(-t[1], t[0]);
  const P = (u: number, off: number): V2 => [c[0] + t[0] * u + n[0] * off, c[1] + t[1] * u + n[1] * off];
  // Kapı kolonları
  for (const u of [-2.75, 2.75, 4.25]) {
    const p = P(u, -0.16);
    b.box('brick', [p[0], y0 + 1.05, p[1]], [0.5, 2.1, 0.5], yaw, 1);
    b.box('brickCap', [p[0], y0 + 2.14, p[1]], [0.6, 0.08, 0.6], yaw);
  }
  // Sürgülü araç kapısı (siyah dikey parmaklık) ve yaya kapısı
  const g0 = P(-2.5, -0.16);
  const g1 = P(2.5, -0.16);
  b.wall('ironBars', g0, g1, y0 + 0.08, y0 + 1.95, [0, 0, 5 / 0.12, 1]);
  b.wall('ironBars', g1, g0, y0 + 0.08, y0 + 1.95, [0, 0, 5 / 0.12, 1]);
  for (const y of [0.1, 0.95, 1.92]) {
    const m = P(0, -0.16);
    b.box('iron', [m[0], y0 + y, m[1]], [5.0, 0.06, 0.05], yaw);
  }
  const p0 = P(3.0, -0.16);
  const p1 = P(4.0, -0.16);
  b.wall('ironBars', p0, p1, y0 + 0.05, y0 + 1.95, [0, 0, 1 / 0.12, 1]);
  b.wall('ironBars', p1, p0, y0 + 0.05, y0 + 1.95, [0, 0, 1 / 0.12, 1]);
  // Ray
  const rm = P(-2.5, -0.1);
  b.box('iron', [rm[0], y0 + 0.02, rm[1]], [10, 0.03, 0.08], yaw);
  // Güvenlik kulübesi (kapının güneyinde, içeride)
  const kc = P(-4.6, -1.5);
  b.box('slBooth', [kc[0], y0 + 1.4, kc[1]], [2.6, 2.8, 2.6], yaw);
  const kw0 = P(-5.8, -0.19);
  const kw1 = P(-3.4, -0.19);
  b.wall('slBoothGlass', kw0, kw1, y0 + 1.0, y0 + 2.2);
  const ks0 = P(-3.29, -0.3);
  const ks1 = P(-3.29, -2.7);
  b.wall('slBoothGlass', ks0, ks1, y0 + 1.0, y0 + 2.2);
  collide?.(
    [P(-5.9, -0.2), P(-3.3, -0.2), P(-3.3, -2.8), P(-5.9, -2.8)].map((p) => [p[0], p[1]]),
    y0 - 1,
    y0 + 3,
  );
  // Kanopi: kapı + kulübe üstünde, sokağa 1.2 m taşar
  const cc = P(-1.2, -0.6);
  b.box('canopy', [cc[0], y0 + 3.2, cc[1]], [11.4, 0.2, 3.6], yaw);
  const f0 = P(-6.9, 1.2);
  const f1 = P(4.5, 1.2);
  b.wall('canopy', f0, f1, y0 + 2.9, y0 + 3.45);
  for (const u of [-6.6, 4.2]) {
    const p = P(u, 0.9);
    b.cylinder('canopy', [p[0], y0, p[1]], 0.1, 3.0, 10);
  }
  // Harfler: kanopinin üstünde, sokağa dönük
  const s0 = P(-4.4, 1.0);
  const s1 = P(2.2, 1.0);
  b.wall('slSign', s0, s1, y0 + 3.3, y0 + 4.05);
  // Kanopi altı spotlar
  for (let u = -6; u <= 4; u += 2.5) {
    const p = P(u, 0.4);
    const g = new THREE.CircleGeometry(0.08, 10).rotateX(Math.PI / 2).translate(p[0], y0 + 3.09, p[1]);
    b.geometry('downlight', g);
  }
}
