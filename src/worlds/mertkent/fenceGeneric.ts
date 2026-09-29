import * as THREE from 'three';
import { Builder, type V2 } from './builder';

/**
 * Komşu sitelerin çitleri (street-plan.json fence kind "other"): alçak duvar (sıva / taş / tuğla / nervürlü
 * prekast) + harpuşta, kolonlar (başlık, isteğe bağlı küre/fener lamba), üstte parmaklık / tel / panel ve arkada
 * çit bitkisi, jiletli tel. Renkler ölçümden; malzemeler anahtar+renk başına bir kez üretilir.
 */
export interface GenericFence {
  kind: string;
  id?: string;
  pts: V2[];
  n?: V2;
  wall?: { h?: number; t?: number; color?: string; finish?: string };
  coping?: { h?: number; color?: string } | string;
  pillars?: {
    every?: number;
    list?: (number | [number, number])[];
    w?: number;
    h?: number;
    color?: string;
    cap?: string | boolean;
    lamp?: string | boolean;
  };
  infill?: string | { type?: string; h?: number; color?: string };
  hedge?: { h?: number; depth?: number; species?: string; color?: string } | null;
  razor?: boolean;
  screen?: [number, number, string][];
  /** Ölçülmüş kolon konumları polyline boyunca (m) */
  pillarsU?: number[];
  /** Dolgu ayrıntısı (ölçüm): yükseklik, renk */
  infillSpec?: { h?: number; color?: string; type?: string };
}

const hex = (c: unknown, d: string) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d);

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

export function buildGenericFence(
  b: Builder,
  f: GenericFence,
  H: (x: number, z: number) => number,
  mat: (kind: string, color: string) => string,
  gaps: { c: V2; w: number }[],
  collide?: Collide,
): void {
  const wallH = f.wall?.h ?? 0.6;
  const wallT = f.wall?.t ?? 0.22;
  const finish = (f.wall?.finish ?? 'render').toLowerCase();
  const wallKey = mat(
    /brick|tuğla/.test(finish)
      ? 'brick'
      : /stone|taş/.test(finish)
        ? 'stone'
        : /rib|nervür|precast/.test(finish)
          ? 'ribbed'
          : 'render',
    f.wall?.color ?? '#e6e3dc',
  );
  const cop = typeof f.coping === 'string' ? { color: f.coping } : (f.coping ?? {});
  const copKey = mat('render', cop.color ?? '#cfc8bb');
  const copH = cop.h ?? 0.06;
  const pil = f.pillars ?? {};
  const pW = pil.w ?? 0.4;
  const pH = pil.h ?? Math.max(wallH + 0.9, 1.5);
  const pKey = mat('render', hex(pil.color, hex(f.wall?.color, '#e6e3dc')));
  const inf0 = typeof f.infill === 'string' ? { type: f.infill } : (f.infill ?? {});
  const inf = { ...inf0, ...(f.infillSpec ?? {}), type: inf0.type ?? f.infillSpec?.type };
  const infType = (inf.type ?? 'railing').toLowerCase();
  const infH = inf.h ?? 1.0;
  const infKey = /mesh|tel|panel/.test(infType)
    ? mat('mesh', hex(inf.color, '#2f4a36'))
    : mat('bars', hex(inf.color, '#202224'));
  const hedgeH = f.hedge?.h ?? 0;
  const hedgeD = f.hedge?.depth ?? 0.8;
  const pts = f.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  // Sokak yönü: verilmişse n, yoksa polyline'ın sağı
  const at = (U: number) => {
    let i = 0;
    while (i + 2 < pts.length && cum[i + 1] < U) i++;
    const a = pts[i];
    const e = pts[i + 1];
    const L = cum[i + 1] - cum[i] || 1;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const u = U - cum[i];
    return { p: [a[0] + t[0] * u, a[1] + t[1] * u] as V2, t };
  };
  const gapsU: [number, number][] = [];
  for (const g of gaps) {
    let best = { d: Infinity, U: 0 };
    for (let U = 0; U <= total; U += 0.25) {
      const { p } = at(U);
      const d = Math.hypot(p[0] - g.c[0], p[1] - g.c[1]);
      if (d < best.d) best = { d, U };
    }
    if (best.d < 2.5) gapsU.push([best.U - g.w / 2, best.U + g.w / 2]);
  }
  const inGap = (U: number) => gapsU.some(([a, e]) => U > a && U < e);
  const screenAt = (U: number) => {
    for (const [a, e, s] of f.screen ?? []) if (U >= a && U <= e) return s;
    return hedgeH > 0 ? 'real' : 'none';
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const e = pts[i + 1];
    const L = cum[i + 1] - cum[i];
    if (L < 0.05) continue;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    let n: V2 = f.n ?? [-t[1], t[0]];
    if (f.n && n[0] * -t[1] + n[1] * t[0] < 0) n = [...f.n] as V2;
    const yaw = Math.atan2(-t[1], t[0]);
    // Sokak yüzü off=0, içeri −n
    const P = (u: number, off: number): V2 => [a[0] + t[0] * u - n[0] * off, a[1] + t[1] * u - n[1] * off];
    const nS = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k < nS; k++) {
      const u0 = (L * k) / nS;
      const u1 = (L * (k + 1)) / nS;
      const mid = cum[i] + (u0 + u1) / 2;
      if (inGap(mid)) continue;
      const c = P((u0 + u1) / 2, wallT / 2);
      const y0 = H(c[0], c[1]) + 0.15;
      if (wallH > 0.05) {
        b.box(wallKey, [c[0], y0 + (wallH - 0.2) / 2, c[1]], [u1 - u0 + 0.004, wallH + 0.2, wallT], yaw, 1);
        b.box(copKey, [c[0], y0 + wallH + copH / 2, c[1]], [u1 - u0 + 0.004, copH, wallT + 0.06], yaw);
      }
      if (!/none|yok/.test(infType)) {
        const pa = P(u0, wallT / 2);
        const pe = P(u1, wallT / 2);
        const yb = y0 + wallH + copH;
        b.wall(infKey, pa, pe, yb, yb + infH, [
          0,
          0,
          (u1 - u0) / (/mesh|tel|panel/.test(infType) ? 0.2 : 0.12),
          /mesh|tel|panel/.test(infType) ? infH / 0.2 : 1,
        ]);
        b.wall(infKey, pe, pa, yb, yb + infH, [
          0,
          0,
          (u1 - u0) / (/mesh|tel|panel/.test(infType) ? 0.2 : 0.12),
          /mesh|tel|panel/.test(infType) ? infH / 0.2 : 1,
        ]);
        const m = P((u0 + u1) / 2, wallT / 2);
        b.box(
          infKey === mat('bars', inf.color ?? '#202224')
            ? mat('metal', inf.color ?? '#202224')
            : mat('metal', '#2f4a36'),
          [m[0], yb + infH, m[1]],
          [u1 - u0, 0.04, 0.04],
          yaw,
        );
      }
      const scr = screenAt(mid);
      if (/shrub|çalı|partial|kesintili/.test(scr) && hedgeH > 0) {
        // Kesintili çalı öbekleri (sürekli çit değil)
        for (let uu = u0 + 0.5; uu < u1; uu += 1.1) {
          const hs = Math.sin((cum[i] + uu) * 7.31 + 1.7) * 43758.5453;
          const rr = hs - Math.floor(hs);
          if (rr < 0.35) continue;
          const bp = P(uu, wallT + 0.5 + rr * 0.6);
          const g = new THREE.SphereGeometry(0.55 + rr * 0.35, 9, 7);
          g.scale(1, (hedgeH * (0.6 + 0.5 * rr)) / (1.1 + rr * 0.7), 1);
          g.translate(bp[0], y0 + hedgeH * 0.45, bp[1]);
          b.geometry('boxwood', g);
        }
      }
      if (scr === 'real' && hedgeH > 0) {
        const hc = P((u0 + u1) / 2, wallT + hedgeD / 2 + 0.05);
        b.box(
          'mkHedge',
          [hc[0], y0 + hedgeH / 2 - 0.1, hc[1]],
          [u1 - u0 + 0.02, hedgeH + 0.2, hedgeD],
          yaw,
          0.5,
          0b111111 & ~0b100000,
        );
        for (let uu = u0 + 0.4; uu < u1; uu += 0.8) {
          const hs = Math.sin((cum[i] + uu) * 12.9898 + 3.1) * 43758.5453;
          const rr = hs - Math.floor(hs);
          const bp = P(uu, wallT + hedgeD * (0.35 + 0.3 * rr));
          const g = new THREE.SphereGeometry(0.45, 8, 6);
          g.scale(1.1, 0.35 + 0.3 * rr, 0.8);
          g.rotateY(yaw);
          g.translate(bp[0], y0 + hedgeH - 0.08, bp[1]);
          b.geometry('mkHedge', g);
        }
      }
      if (f.razor) {
        const rc = P((u0 + u1) / 2, wallT / 2);
        const top = y0 + wallH + copH + infH + 0.25;
        for (let uu = u0 + 0.1; uu < u1; uu += 0.2) {
          const p = P(uu, wallT / 2);
          const ring = new THREE.TorusGeometry(0.26, 0.005, 3, 14);
          ring.rotateY(yaw + Math.PI / 2 + 0.4);
          ring.translate(p[0], top, p[1]);
          b.geometry('wire', ring);
        }
        void rc;
      }
      collide?.(
        [
          P(u0, -0.02),
          P(u1, -0.02),
          P(u1, wallT + (hedgeH > 0 ? hedgeD : 0.05)),
          P(u0, wallT + (hedgeH > 0 ? hedgeD : 0.05)),
        ],
        y0 - 1,
        y0 + Math.max(wallH + infH, hedgeH),
      );
    }
  }
  // Kolonlar
  const Us: number[] = [];
  if (f.pillarsU?.length) Us.push(...f.pillarsU);
  else if (pil.list?.length)
    for (const q of pil.list)
      if (typeof q === 'number') Us.push(q);
      else if (pil.every) for (let U = 0; U <= total + 1e-6; U += pil.every) Us.push(U);
  for (const g of gapsU) Us.push(...g);
  for (const U of Us) {
    if (U < -0.01 || U > total + 0.01) continue;
    if (inGap(U + 0.02) && inGap(U - 0.02)) continue;
    const { p, t } = at(Math.max(0, Math.min(total, U)));
    const yaw = Math.atan2(-t[1], t[0]);
    const y0 = H(p[0], p[1]) + 0.15;
    b.box(pKey, [p[0], y0 + pH / 2 - 0.1, p[1]], [pW, pH + 0.2, pW], yaw, 1);
    if (pil.cap !== false)
      b.box(
        mat('render', hex(pil.cap, hex(pil.color, '#e8e4da'))),
        [p[0], y0 + pH + 0.04, p[1]],
        [pW + 0.08, 0.08, pW + 0.08],
        yaw,
      );
    const lamp = typeof pil.lamp === 'string' ? pil.lamp.toLowerCase() : pil.lamp ? 'globe' : '';
    if (/globe|küre/.test(lamp)) {
      b.cylinder('capDark', [p[0], y0 + pH + 0.08, p[1]], 0.05, 0.1, 8);
      b.sphere('globe', [p[0], y0 + pH + 0.3, p[1]], 0.14, 12);
    } else if (/lantern|fener/.test(lamp)) {
      b.box('capDark', [p[0], y0 + pH + 0.25, p[1]], [0.2, 0.34, 0.2], yaw);
    }
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
