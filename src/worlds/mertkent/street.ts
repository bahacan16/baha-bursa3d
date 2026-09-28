import * as THREE from 'three';
import { Builder, type V2 } from './builder';
import type { StreetPlan } from './siteplan';

/**
 * Ölçülmüş sokak planı (data/street-plan.json): kaldırımlar (bordür hattından içeri w genişlik, kilit taşı
 * türü/bantları), bordür taşları, sokak eşyası (lamba direği, levha, direk, çöp kutusu, babalar, ayna, rögar,
 * sokak ağaçlarının çukuru).
 */

const KERB_W = 0.15;

export interface StreetResult {
  /** Yürüme yüksekliği için yükseltilmiş alanlar (arazinin üstünde h metre) */
  raised: { poly: [number, number][]; h: number }[];
  /** Kaldırım şeritlerinin kapsadığı alan (OSM kaldırımını/el kaldırımını çizmemek için) */
  covers: (x: number, z: number) => boolean;
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

/** Kaldırım malzemesi metninden taş anahtarı ve bordür yanı bant (renk, genişlik) */
function parseMaterial(m: string): { key: string; band?: { key: string; w: number }; tactile?: number } {
  const t = m.toLowerCase();
  const red = /kırmızı|red|terracotta|kiremit/;
  const out: { key: string; band?: { key: string; w: number }; tactile?: number } = {
    key: red.test(t) && !/grey|gri/.test(t.split(/band|şerit|bant/)[0]) ? 'spPaverRed' : 'spPaverGrey',
  };
  const bm = t.match(/(red|kırmızı|grey|gri)[^.,;]*?(band|bant|şerit)[^0-9]*([0-9.]+)\s*m/);
  if (bm) out.band = { key: red.test(bm[1]) ? 'spPaverRed' : 'spPaverGrey', w: Number(bm[3]) };
  const tm = t.match(/(tactile|kılavuz|hissedilebilir)/);
  if (tm) out.tactile = 0.3;
  return out;
}

export function buildStreetPlan(
  b: Builder,
  plan: StreetPlan,
  H: (x: number, z: number) => number,
  roadCentre: (x: number, z: number) => number,
): StreetResult {
  const raised: StreetResult['raised'] = [];
  const polys: V2[][] = [];
  for (const sw of plan.sidewalks ?? []) {
    const pts = sw.pts;
    if (!pts || pts.length < 2) continue;
    const kerbH = sw.kerbH ?? 0.15;
    const mat = parseMaterial(`${sw.material ?? ''}`);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const e = pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.05) continue;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      // Kaldırım tarafı: ofset noktası yol ekseninden daha uzak olan yan
      let n: V2 = [t[1], -t[0]];
      const mx = (a[0] + e[0]) / 2;
      const mz = (a[1] + e[1]) / 2;
      if (roadCentre(mx + n[0] * 1.5, mz + n[1] * 1.5) < roadCentre(mx - n[0] * 1.5, mz - n[1] * 1.5))
        n = [-n[0], -n[1]];
      const W = sw.w;
      const q = (u: number, v: number): V2 => [a[0] + t[0] * u + n[0] * v, a[1] + t[1] * u + n[1] * v];
      // Uçlarda komşu parçalarla birleşsin diye hafif uzat
      const ext = 0.05;
      const strip = (v0: number, v1: number, key: string, off: number) => {
        const ring: V2[] = [q(-ext, v0), q(L + ext, v0), q(L + ext, v1), q(-ext, v1)];
        b.drape(key, ring, [], H, off, 1, 2);
        return ring;
      };
      let v = KERB_W;
      if (mat.band) {
        strip(v, v + mat.band.w, mat.band.key, kerbH + 0.005);
        v += mat.band.w;
      }
      const ring = strip(v, W, mat.key, kerbH);
      if (mat.tactile && W - v > 1) strip(v + 0.6, v + 0.6 + mat.tactile, 'tactile', kerbH + 0.008);
      // Bordür: üst yüz + yola bakan yüz (arazi ile birlikte iner)
      const nS = Math.max(1, Math.round(L / 1));
      for (let k = 0; k < nS; k++) {
        const u0 = (L * k) / nS;
        const u1 = (L * (k + 1)) / nS;
        const c = q((u0 + u1) / 2, KERB_W / 2);
        const y = H(c[0], c[1]);
        b.box(
          'curb',
          [c[0], y + kerbH / 2 - 0.05, c[1]],
          [u1 - u0 + 0.004, kerbH + 0.1, KERB_W],
          Math.atan2(-t[1], t[0]),
        );
      }
      const full: V2[] = [q(0, 0), q(L, 0), q(L, W), q(0, W)];
      polys.push(full);
      raised.push({ poly: full.map((p) => [p[0], p[1]]), h: kerbH });
      void ring;
    }
  }
  // Sokak eşyası
  for (const s of plan.street ?? []) {
    const y = H(s.x, s.z) + 0.15;
    const note = `${s.text ?? ''} ${s.note ?? ''}`.toLowerCase();
    const yaw = ((s.rot ?? 0) * Math.PI) / 180;
    switch (s.kind) {
      case 'lamp-post': {
        const h = s.h ?? 8;
        b.cylinder('pole', [s.x, y - 0.1, s.z], 0.09, h, 10);
        // Kol + armatür (yol tarafına)
        const dx = Math.sin(yaw);
        const dz = -Math.cos(yaw);
        b.box('pole', [s.x + dx * 0.7, y + h - 0.15, s.z + dz * 0.7], [0.06, 0.06, 1.4], Math.atan2(dx, dz));
        b.box(
          'lampHead',
          [s.x + dx * 1.4, y + h - 0.25, s.z + dz * 1.4],
          [0.28, 0.12, 0.6],
          Math.atan2(dx, dz),
        );
        break;
      }
      case 'pole':
        b.cylinder(
          /beton|concrete/.test(note) ? 'concretePole' : 'pole',
          [s.x, y - 0.1, s.z],
          0.11,
          s.h ?? 7,
          10,
        );
        break;
      case 'sign': {
        const h = s.h ?? 2.6;
        b.cylinder('pole', [s.x, y - 0.05, s.z], 0.035, h, 8);
        const key = /30/.test(note)
          ? 'sign30'
          : /viraj|curve|tehlike/.test(note)
            ? 'signCurve'
            : /park|p\b/.test(note)
              ? 'signP'
              : /bisiklet|bike|cycle/.test(note)
                ? 'signBike'
                : /giril|no entry|dur|stop/.test(note)
                  ? 'signNoEntry'
                  : 'sign30';
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const hw = 0.33;
        const A: V2 = [s.x - co * hw, s.z + si * hw];
        const E: V2 = [s.x + co * hw, s.z - si * hw];
        b.wall(key, A, E, y + h - 0.7, y + h - 0.04);
        b.wall(`${key}Back`, E, A, y + h - 0.7, y + h - 0.04);
        break;
      }
      case 'bin':
        b.cylinder('darkMetal', [s.x, y - 0.05, s.z], 0.25, 0.9, 12);
        break;
      case 'bollard':
        b.cylinder('darkMetal', [s.x, y - 0.05, s.z], 0.06, 0.8, 8);
        break;
      case 'mirror': {
        b.cylinder('pole', [s.x, y - 0.05, s.z], 0.04, 2.6, 8);
        const g = new THREE.CircleGeometry(0.35, 16);
        g.rotateY(yaw);
        g.translate(s.x, y + 2.7, s.z);
        b.geometry('steel', g);
        break;
      }
      case 'hydrant':
        b.cylinder('hydrant', [s.x, y - 0.05, s.z], 0.1, 0.75, 10);
        break;
      case 'manhole': {
        const g = new THREE.CircleGeometry(0.33, 16).rotateX(-Math.PI / 2);
        g.translate(s.x, H(s.x, s.z) + 0.02, s.z);
        b.geometry('darkMetal', g);
        break;
      }
      case 'tree-pit': {
        const r: V2[] = [
          [s.x - 0.6, s.z - 0.6],
          [s.x + 0.6, s.z - 0.6],
          [s.x + 0.6, s.z + 0.6],
          [s.x - 0.6, s.z + 0.6],
        ];
        b.drape('spMulch', r, [], H, 0.158, 1, 2);
        break;
      }
      case 'bench': {
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        for (let k = 0; k < 3; k++)
          b.box(
            'wood',
            [s.x + si * (-0.1 + k * 0.13), y + 0.44, s.z + co * (-0.1 + k * 0.13)],
            [1.6, 0.04, 0.1],
            yaw,
          );
        break;
      }
    }
  }
  return { raised, covers: (x, z) => polys.some((p) => inside(p, x, z)) };
}
