import { ChunkedGeometry, type Rgb } from './chunks';
import { addBox } from './buildings';
import { offsetPolyline } from './roads';
import type { Pt, Rail } from './parse';

const BALLAST: Rgb = [0.45, 0.42, 0.38];
const STEEL: Rgb = [0.55, 0.56, 0.58];
const SLEEPER: Rgb = [0.52, 0.5, 0.47];
const CONCRETE: Rgb = [0.7, 0.69, 0.66];

export const BRIDGE_H = 7;
const RAMP_LEN = 140;
const GAUGE = 1.435;
const BALLAST_W = 3.2;
const BALLAST_H = 0.25;

export interface Pier {
  x: number;
  z: number;
  size: number;
}

export interface RailBuildResult {
  piers: Pier[];
  /** Hemzemin ray şeritleri (zemin yüksekliği için): a, b, yarı genişlik, üst kot. */
  gradeStrips: { ax: number; az: number; bx: number; bz: number; half: number; height: number }[];
}

const key = (p: Pt) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/** Her nokta için yükseklik: köprüde BRIDGE_H, köprüye bağlanan hatlarda rampa. */
export function railHeights(rails: Rail[]): Map<Rail, number[]> {
  const bridgeEnds = new Set<string>();
  for (const r of rails) {
    if (!r.bridge) continue;
    bridgeEnds.add(key(r.pts[0]));
    bridgeEnds.add(key(r.pts[r.pts.length - 1]));
  }
  const out = new Map<Rail, number[]>();
  for (const r of rails) {
    const n = r.pts.length;
    if (r.bridge) {
      out.set(r, new Array(n).fill(BRIDGE_H));
      continue;
    }
    const hs = new Array(n).fill(0);
    const cum = [0];
    for (let i = 1; i < n; i++)
      cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    const L = cum[n - 1];
    // KARAR: Köprüye bağlanan hatlar 140 m rampa (dolgu) ile yükselir.
    if (bridgeEnds.has(key(r.pts[0])))
      for (let i = 0; i < n; i++) hs[i] = Math.max(hs[i], BRIDGE_H * Math.max(0, 1 - cum[i] / RAMP_LEN));
    if (bridgeEnds.has(key(r.pts[n - 1])))
      for (let i = 0; i < n; i++)
        hs[i] = Math.max(hs[i], BRIDGE_H * Math.max(0, 1 - (L - cum[i]) / RAMP_LEN));
    out.set(r, hs);
  }
  return out;
}

/** Rampalı hatlarda noktaları sık örnekle (yükseklik geçişi düzgün olsun). */
function densify(pts: Pt[], hs: number[], step: number): { pts: Pt[]; hs: number[] } {
  const op: Pt[] = [pts[0]];
  const oh: number[] = [hs[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = hs[i] !== hs[i - 1] ? Math.max(1, Math.ceil(d / step)) : 1;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      op.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      oh.push(hs[i - 1] + (hs[i] - hs[i - 1]) * t);
    }
  }
  return { pts: op, hs: oh };
}

export function buildRails(
  geo: ChunkedGeometry,
  rails: Rail[],
  opts: { sleepers: boolean },
): RailBuildResult {
  const piers: Pier[] = [];
  const gradeStrips: RailBuildResult['gradeStrips'] = [];
  const heights = railHeights(rails);
  for (const r of rails) {
    if (r.tunnel || r.layer < 0) continue;
    const d = densify(r.pts, heights.get(r)!, 3);
    const pts = d.pts;
    const hs = d.hs;
    const L = offsetPolyline(pts, BALLAST_W / 2);
    const R = offsetPolyline(pts, -BALLAST_W / 2);
    const rl = offsetPolyline(pts, GAUGE / 2);
    const rr = offsetPolyline(pts, -GAUGE / 2);
    let acc = 0;
    let nextPier = 15;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const mx = (p[0] + q[0]) / 2;
      const mz = (p[1] + q[1]) / 2;
      const b = geo.get(mx, mz, 'rail');
      const y0 = hs[i];
      const y1 = hs[i + 1];
      const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const elevated = y0 > 0.5 || y1 > 0.5;
      // Balast üst yüzü
      const t0 = y0 + BALLAST_H;
      const t1 = y1 + BALLAST_H;
      const a0 = b.v(L[i][0], t0, L[i][1], 0, 1, 0, 0, 0, BALLAST);
      const b0 = b.v(R[i][0], t0, R[i][1], 0, 1, 0, 1, 0, BALLAST);
      const b1 = b.v(R[i + 1][0], t1, R[i + 1][1], 0, 1, 0, 1, 1, BALLAST);
      const a1 = b.v(L[i + 1][0], t1, L[i + 1][1], 0, 1, 0, 0, 1, BALLAST);
      // L = sol (+normal). Yukarı bakan sıra:
      b.quad(a0, a1, b1, b0);
      // Yan yüzler (dolgu / köprü tabliyesi)
      const bottom0 = r.bridge ? y0 - 1.0 : 0;
      const bottom1 = r.bridge ? y1 - 1.0 : 0;
      const sideColor = elevated ? CONCRETE : BALLAST;
      for (const [E, sgn] of [
        [L, 1],
        [R, -1],
      ] as const) {
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const l = seg || 1;
        const nx = (-dz / l) * sgn;
        const nz = (dx / l) * sgn;
        const s0 = b.v(E[i][0], bottom0, E[i][1], nx, 0, nz, 0, 0, sideColor);
        const s1 = b.v(E[i + 1][0], bottom1, E[i + 1][1], nx, 0, nz, 1, 0, sideColor);
        const s2 = b.v(E[i + 1][0], t1, E[i + 1][1], nx, 0, nz, 1, 1, sideColor);
        const s3 = b.v(E[i][0], t0, E[i][1], nx, 0, nz, 0, 1, sideColor);
        if (sgn === 1) b.quad(s0, s1, s2, s3);
        else b.quad(s0, s3, s2, s1);
      }
      if (r.bridge) {
        // Tabliye alt yüzü
        const u0 = b.v(L[i][0], bottom0, L[i][1], 0, -1, 0, 0, 0, CONCRETE);
        const u1 = b.v(R[i][0], bottom0, R[i][1], 0, -1, 0, 1, 0, CONCRETE);
        const u2 = b.v(R[i + 1][0], bottom1, R[i + 1][1], 0, -1, 0, 1, 1, CONCRETE);
        const u3 = b.v(L[i + 1][0], bottom1, L[i + 1][1], 0, -1, 0, 0, 1, CONCRETE);
        b.quad(u0, u1, u2, u3);
        while (nextPier < acc + seg) {
          const t = (nextPier - acc) / seg;
          const px = p[0] + (q[0] - p[0]) * t;
          const pz = p[1] + (q[1] - p[1]) * t;
          const h = y0 + (y1 - y0) * t - 1.0;
          addBox(b, px, h / 2, pz, 1.4, h, 1.4, 0, CONCRETE);
          piers.push({ x: px, z: pz, size: 1.4 });
          nextPier += 30;
        }
      } else if (!elevated) {
        gradeStrips.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], half: BALLAST_W / 2, height: BALLAST_H });
      }
      // Raylar
      const yaw = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
      for (const E of [rl, rr]) {
        const cx = (E[i][0] + E[i + 1][0]) / 2;
        const cz = (E[i][1] + E[i + 1][1]) / 2;
        addBox(b, cx, (t0 + t1) / 2 + 0.08, cz, seg + 0.02, 0.15, 0.08, yaw, STEEL);
      }
      if (opts.sleepers) {
        for (let s = 0.3; s < seg; s += 0.65) {
          const t = s / seg;
          const sx = p[0] + (q[0] - p[0]) * t;
          const sz = p[1] + (q[1] - p[1]) * t;
          const sy = t0 + (t1 - t0) * t + 0.03;
          addBox(b, sx, sy, sz, 0.24, 0.07, 2.4, yaw, SLEEPER);
        }
      }
      acc += seg;
    }
  }
  return { piers, gradeStrips };
}
