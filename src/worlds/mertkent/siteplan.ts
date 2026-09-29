import * as THREE from 'three';
import { Builder, leafFringe, type V2, type V3 } from './builder';

/**
 * Ölçülmüş site planı (data/site-plan.json: Google z21 hava fotoğrafından; data/street-plan.json: sokaklar):
 * zemin alanları (çim, kilit taşı, traverten güverte, havuz, kauçuk oyun alanı, saha, çiçeklik), çizgiler (çit,
 * alçak duvar, bordür, park çizgileri, tel çit), yapılar (pergola, çöp kulübesi, kulübe), noktalar (ağaç, çalı,
 * lamba, bank, şemsiye, kaydırak, fıskiye, araç).
 */
export interface SiteArea {
  kind: string;
  poly: V2[];
  material?: string;
  level?: number;
  note?: string;
}
export interface SiteLine {
  kind: string;
  pts: V2[];
  h?: number;
  w?: number;
  note?: string;
}
export interface SiteStructure {
  kind: string;
  poly: V2[];
  h?: number;
  note?: string;
}
export interface SitePoint {
  kind: string;
  x: number;
  z: number;
  r?: number;
  h?: number;
  rot?: number;
  species?: string;
  note?: string;
}
export interface SitePlan {
  areas?: SiteArea[];
  lines?: SiteLine[];
  structures?: SiteStructure[];
  points?: SitePoint[];
}
export interface StreetPlan {
  fence?: unknown[];
  gates?: { kind: string; c: V2; n: V2; w: number; note?: string }[];
  sidewalks?: { pts: V2[]; w: number; side: string; kerbH?: number; material?: string; note?: string }[];
  street?: { kind: string; x: number; z: number; h?: number; text?: string; rot?: number; note?: string }[];
}

const PLANS = import.meta.glob('./data/{site,street,park}-plan.json', {
  eager: true,
  import: 'default',
}) as Record<string, SitePlan & StreetPlan>;
export const SITE_PLAN: SitePlan = PLANS['./data/site-plan.json'] ?? {};
export const STREET_PLAN: StreetPlan = PLANS['./data/street-plan.json'] ?? {};
/** Komşu parklar (kuzey park, Nato Parkı): site planıyla aynı şema */
export const PARK_PLAN: SitePlan = PLANS['./data/park-plan.json'] ?? {};

function speciesType(s?: string, note?: string): number {
  const t = `${s ?? ''} ${note ?? ''}`.toLowerCase();
  if (/pine|çam|cedar|sedir|cypress|servi|thuja|leyland|fir|köknar|conifer|ibreli/.test(t)) return 1;
  if (/birch|huş|aspen|kavak|poplar|söğüt|willow/.test(t)) return 2;
  return 0;
}

function flat(r: V2[]): number[] {
  const o: number[] = [];
  for (const p of r) o.push(p[0], p[1]);
  return o;
}

/** Ağaç sistemi için: ölçülmüş ağaçlar [x, z, tür, ölçek]* + otomatik ağaç konmayacak bölgeler */
export function surveyVegetation(): {
  fixedTrees: number[];
  excludeZones: number[][];
  noSidewalkZones: number[][];
} {
  const fixedTrees: number[] = [];
  const add = (x: number, z: number, r: number | undefined, h: number | undefined, type: number) => {
    const byR = (r ?? 2.3) / 2.3;
    const byH = h ? h / 8 : byR;
    // Yalnızca boy verilmişse (sokak fidanları, ardıçlar) boya göre; küçük bitkiler de küçük kalsın
    const s =
      r == null && h ? Math.max(0.18, Math.min(1.9, byH)) : Math.max(0.35, Math.min(1.9, (byR + byH) / 2));
    fixedTrees.push(x, z, type, s);
  };
  for (const p of [...(SITE_PLAN.points ?? []), ...(PARK_PLAN.points ?? [])])
    if (p.kind === 'tree') add(p.x, p.z, p.r, p.h, speciesType(p.species, p.note));
  for (const p of STREET_PLAN.street ?? [])
    // 2 m altı "ağaçlar" (köşe adasındaki budanmış şimşir/ardıçlar) street.ts'de çalı olarak kurulur
    if (p.kind === 'tree' && (p.h ?? 5) >= 2)
      add(p.x, p.z, undefined, p.h, speciesType(undefined, `${p.text ?? ''} ${p.note ?? ''}`));
  const excludeZones: number[][] = [];
  for (const a of [...(SITE_PLAN.areas ?? []), ...(PARK_PLAN.areas ?? [])])
    if (a.poly?.length >= 3) excludeZones.push(flat(a.poly));
  // Sokak kaldırımları (bordürden içeri w) + 1.5 m pay
  for (const s of STREET_PLAN.sidewalks ?? []) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const a = s.pts[i];
      const e = s.pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.1) continue;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      const n: V2 = [-t[1], t[0]];
      const W = s.w + 1.5;
      const A: V2 = [a[0] - t[0] * 1.5, a[1] - t[1] * 1.5];
      const E: V2 = [e[0] + t[0] * 1.5, e[1] + t[1] * 1.5];
      excludeZones.push(
        flat([
          [A[0] - n[0] * W, A[1] - n[1] * W],
          [E[0] - n[0] * W, E[1] - n[1] * W],
          [E[0] + n[0] * W, E[1] + n[1] * W],
          [A[0] + n[0] * W, A[1] + n[1] * W],
        ]),
      );
    }
  }
  // OSM kaldırım üretiminin kapatılacağı bantlar: ölçülmüş bordürün yol tarafına 1.5 m, kaldırım tarafına w + 4 m
  const noSidewalkZones: number[][] = [];
  for (const s of STREET_PLAN.sidewalks ?? []) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const a = s.pts[i];
      const e = s.pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.1) continue;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      const n = sideNormal(t, s.side);
      const A: V2 = [a[0] - t[0] * 2, a[1] - t[1] * 2];
      const E: V2 = [e[0] + t[0] * 2, e[1] + t[1] * 2];
      const W = s.w + 4;
      noSidewalkZones.push(
        flat([
          [A[0] - n[0] * 1.5, A[1] - n[1] * 1.5],
          [E[0] - n[0] * 1.5, E[1] - n[1] * 1.5],
          [E[0] + n[0] * W, E[1] + n[1] * W],
          [A[0] + n[0] * W, A[1] + n[1] * W],
        ]),
      );
    }
  }
  return { fixedTrees, excludeZones, noSidewalkZones };
}

/**
 * Kaldırımın bordür hattına göre yönü: polyline yönünde 'left' / 'right' (+x doğu, +z güney: doğuya giderken sol =
 * kuzey). Bilinmiyorsa null.
 */
export function sideNormal(t: V2, side?: string): V2 {
  if (side === 'left') return [t[1], -t[0]];
  return [-t[1], t[0]];
}

function insidePoly(r: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
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

function openRing(r: V2[]): V2[] {
  const o = r.map((p) => [p[0], p[1]] as V2);
  if (o.length > 3) {
    const f = o[0];
    const l = o[o.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) o.pop();
  }
  return o;
}

function areaKey(a: SiteArea): string {
  const m = `${a.material ?? ''} ${a.note ?? ''}`.toLowerCase();
  switch (a.kind) {
    case 'lawn':
      return 'lawn';
    case 'deck':
      return /mermer|marble|kenar taşı|coping/.test(m) ? 'coping' : 'deck';
    case 'playground':
      if (/mor|purple/.test(m)) return 'spRubberPurple';
      if (/gri|grey|gray/.test(m)) return 'spRubberGrey';
      return 'spRubberRed';
    case 'court':
      // Yalnızca zemin malzemesi metni (notlarda çevre çitinin rengi geçebiliyor)
      return /yeşil|green/.test((a.material ?? '').toLowerCase()) ? 'spCourtGreen' : 'spCourtBeige';
    case 'bed':
      return 'spMulch';
    case 'gravel':
      return 'spGravel';
    case 'asphalt':
      return 'drive';
    default:
      if (/asfalt|asphalt/.test(m)) return 'drive';
      if (/metal|ızgara|kapak|grate/.test(m)) return 'darkMetal';
      if (/traverten|travertine|mermer/.test(m)) return 'deck';
      if (/kırmızı|red|kahve/.test(m) && !/gri/.test(m.split('(')[0])) return 'spPaverRed';
      return 'spPaverGrey';
  }
}

export interface SitePlanResult {
  /** Arazi gölgelendiricisi delikleri (havuzlar) [x0, z0, x1, z1] */
  holes: [number, number, number, number][];
  /** Park etmiş araçlar [x, y, z, yaw, tohum]* */
  cars: number[];
}

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

/** Site planını çiz. `skip(x,z)`: bu noktadaki öğeleri atla (ör. başka modülün çizdiği yapılar) */
export function buildSitePlan(
  b: Builder,
  plan: SitePlan,
  H: (x: number, z: number) => number,
  collide?: Collide,
): SitePlanResult {
  const holes: [number, number, number, number][] = [];
  const cars: number[] = [];
  const areas = (plan.areas ?? [])
    .map((a) => ({ ...a, poly: openRing(a.poly) }))
    .filter((a) => a.poly.length >= 3);
  const pools = areas.filter((a) => a.kind === 'pool');
  // ── Zemin alanları (sırayla, üst üste: küçük y artışı + malzeme polygonOffset) ──
  areas.forEach((a, idx) => {
    if (a.kind === 'pool') return;
    const key = areaKey(a);
    const inner = pools.filter((p) => insidePoly(a.poly, ...centroid(p.poly))).map((p) => p.poly);
    const off = 0.03 + Math.min(0.06, idx * 0.0015) + (a.level ?? 0) + (a.kind === 'lawn' ? 0 : 0.03);
    try {
      b.drape(key, a.poly, inner, H, off, key.startsWith('spPaver') || key === 'deck' ? 1 : 0.5, 2.5);
    } catch {
      /* hatalı çokgen */
    }
    // Yükseltilmiş alanlar (güverte vb.): kenar yüzü
    if ((a.level ?? 0) > 0.05)
      for (let i = 0; i < a.poly.length; i++) {
        const p = a.poly[i];
        const q = a.poly[(i + 1) % a.poly.length];
        const y0 = Math.min(H(p[0], p[1]), H(q[0], q[1]));
        b.wall('deckSide', q, p, y0, y0 + off, [0, 0, Math.hypot(q[0] - p[0], q[1] - p[1]), off]);
      }
  });
  // ── Havuzlar ──
  for (const pool of pools) {
    const r = pool.poly;
    const m = `${pool.material ?? ''} ${pool.note ?? ''}`.toLowerCase();
    const shallow = /çocuk|child|sığ|shallow|basamak|raf/.test(m);
    const depth = shallow ? 0.55 : 1.45;
    const rim = Math.max(...r.map((p) => H(p[0], p[1]))) + 0.1;
    const xs = r.map((p) => p[0]);
    const zs = r.map((p) => p[1]);
    holes.push([
      Math.min(...xs) + 0.02,
      Math.min(...zs) + 0.02,
      Math.max(...xs) - 0.02,
      Math.max(...zs) - 0.02,
    ]);
    const ccw = ((): V2[] => {
      let a2 = 0;
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        a2 += p[0] * q[1] - q[0] * p[1];
      }
      return a2 > 0 ? r : [...r].reverse();
    })();
    const tile = shallow ? 'poolTileLight' : 'poolTile';
    for (let i = 0; i < ccw.length; i++) {
      const p = ccw[i];
      const q = ccw[(i + 1) % ccw.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      // İç duvar (havuza bakan): a→e sırası ters
      b.wall(tile, p, q, rim - depth, rim - 0.04, [0, 0, L, depth]);
      b.wall('poolBand', p, q, rim - 0.25, rim - 0.04, [0, 0, L / 0.25, 1]);
    }
    b.polygon(tile, ccw, rim - depth, true, 1);
    b.polygon('water', ccw, rim - 0.16, true, 0.25);
    // Kenar taşı (0.35 m, beyaz)
    const c = centroid(ccw);
    for (let i = 0; i < ccw.length; i++) {
      const p = ccw[i];
      const q = ccw[(i + 1) % ccw.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const t: V2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
      let n: V2 = [-t[1], t[0]];
      const mid: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (n[0] * (mid[0] - c[0]) + n[1] * (mid[1] - c[1]) < 0) n = [-n[0], -n[1]];
      const cc: V2 = [mid[0] + n[0] * 0.17, mid[1] + n[1] * 0.17];
      b.box('coping', [cc[0], rim + 0.015, cc[1]], [L + 0.34, 0.05, 0.34], Math.atan2(-t[1], t[0]));
    }
  }
  // ── Çizgiler ──
  for (const l of plan.lines ?? []) {
    const pts = l.pts;
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 0.02) continue;
      const t: V2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
      const yaw = Math.atan2(-t[1], t[0]);
      const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const y = H(m[0], m[1]);
      switch (l.kind) {
        case 'hedge': {
          const h = l.h ?? 1.2;
          const w = l.w ?? 0.8;
          b.box('hedge', [m[0], y + h / 2, m[1]], [L + w * 0.3, h, w], yaw, 0.7, 0b111111 & ~0b100000);
          const n: V2 = [-t[1], t[0]];
          for (const s of [1, -1] as const)
            leafFringe(
              b,
              'hedgeLeaf',
              [p[0] + n[0] * (w / 2) * s, p[1] + n[1] * (w / 2) * s],
              [q[0] + n[0] * (w / 2) * s, q[1] + n[1] * (w / 2) * s],
              y + 0.15,
              y + h,
              w,
              [n[0] * s, n[1] * s],
              3,
              Math.floor(m[0] * 13 + m[1] * 7 + s * 101),
              0.35,
            );
          collide?.(rect(m, t, L, w), y - 0.5, y + h);
          break;
        }
        case 'low-wall': {
          const h = l.h ?? 0.5;
          const w = l.w ?? 0.2;
          b.box('mkWallBack', [m[0], y + h / 2 - 0.05, m[1]], [L + w, h + 0.1, w], yaw);
          b.box('coping', [m[0], y + h + 0.02, m[1]], [L + w + 0.04, 0.04, w + 0.06], yaw);
          if (h > 0.35) collide?.(rect(m, t, L, w), y - 0.5, y + h);
          break;
        }
        case 'railing': {
          const h = l.h ?? 1.2;
          b.wall('mkMesh', p, q, y, y + h, [0, 0, L / 0.2, h / 0.2]);
          const nP = Math.max(1, Math.round(L / 2.5));
          for (let k = 0; k <= nP; k++) {
            const f = k / nP;
            b.box(
              'mkMeshPost',
              [p[0] + (q[0] - p[0]) * f, y + h / 2, p[1] + (q[1] - p[1]) * f],
              [0.06, h, 0.04],
              yaw,
            );
          }
          collide?.(rect(m, t, L, 0.1), y - 0.5, y + h);
          break;
        }
        case 'parking-bay':
          b.box('spPaint', [m[0], y + 0.075, m[1]], [L, 0.01, l.w ?? 0.1], yaw);
          break;
        case 'kerb':
        case 'path-edge':
        case 'step': {
          const h = l.h ?? 0.12;
          const w = l.w ?? 0.12;
          b.box('edging', [m[0], y + h / 2, m[1]], [L + 0.02, h + 0.05, w], yaw);
          break;
        }
        case 'pool-lane':
          b.box('poolBand', [m[0], y - 1.3, m[1]], [L, 0.01, l.w ?? 0.25], yaw);
          break;
      }
    }
  }
  // ── Yapılar ──
  for (const s of plan.structures ?? []) {
    const r = openRing(s.poly ?? []);
    if (r.length < 3) continue;
    const note = (s.note ?? '').toLowerCase();
    if (/salus\.ts|zaten modelle/.test(note)) continue;
    const y = Math.min(...r.map((p) => H(p[0], p[1])));
    const h = s.h ?? 2.5;
    switch (s.kind) {
      case 'pergola': {
        for (const p of r) b.box('darkMetal', [p[0], y + h / 2, p[1]], [0.12, h, 0.12]);
        b.polygon('canopy', r, y + h, true, 0.5);
        b.polygon('canopy', r, y + h - 0.02, false, 0.5);
        break;
      }
      case 'stair':
        break;
      default: {
        // Kutu + eğimli / beşik çatı
        const wallKey = /tuğla|brick/.test(note) ? 'brick' : /ahşap|wood/.test(note) ? 'wood' : 'mkWallBack';
        for (let i = 0; i < r.length; i++) {
          const p = r[i];
          const q = r[(i + 1) % r.length];
          b.wall(wallKey, p, q, y, y + h * 0.82, [0, 0, Math.hypot(q[0] - p[0], q[1] - p[1]), h]);
          b.wall(wallKey, q, p, y, y + h * 0.82, [0, 0, Math.hypot(q[0] - p[0], q[1] - p[1]), h]);
        }
        const roofKey = /kırmızı|red|kiremit/.test(note) ? 'roof' : 'ozRoof';
        b.polygon(roofKey, r, y + h * 0.82, true, 0.5);
        b.polygon(roofKey, r, y + h * 0.82 - 0.01, false, 0.5);
        collide?.(
          r.map((p) => [p[0], p[1]]),
          y - 0.5,
          y + h,
        );
      }
    }
  }
  // ── Noktalar ──
  let seed = 91;
  for (const p of plan.points ?? []) {
    const y = H(p.x, p.z);
    const c: V3 = [p.x, y + 0.06, p.z];
    const yaw = ((p.rot ?? 0) * Math.PI) / 180;
    switch (p.kind) {
      case 'shrub':
        bush(b, c, p.r ?? 0.7, p.h ?? (p.r ?? 0.7) * 1.2, (seed += 7));
        break;
      case 'lamp':
        gardenLamp(b, c, p.h ?? 3.2);
        break;
      case 'bench':
        bench(b, c, yaw);
        break;
      case 'umbrella':
        umbrella(b, c);
        break;
      case 'lounger':
        lounger(b, c, yaw);
        break;
      case 'car':
        seed = (seed * 16807) % 2147483647;
        cars.push(p.x, y + 0.1, p.z, yaw, seed % 1000);
        break;
      case 'fountain': {
        b.cylinder('coping', [p.x, y, p.z], 0.12, (p.h ?? 1.6) - 0.1, 10);
        const g = new THREE.SphereGeometry(p.r ?? 0.8, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        g.scale(1, 0.35, 1);
        g.translate(p.x, y + (p.h ?? 1.6) - 0.1, p.z);
        b.geometry('coping', g);
        break;
      }
      case 'ladder':
        for (const s of [-0.25, 0.25]) {
          const co = Math.cos(yaw);
          const si = Math.sin(yaw);
          b.box('steel', [p.x + co * s, y + 0.45, p.z - si * s], [0.04, 0.9, 0.04], yaw);
        }
        break;
      case 'slide': {
        b.box('darkMetal', [p.x, y + 0.75, p.z], [0.9, 0.06, 0.9], yaw);
        for (const [dx, dz] of [
          [-0.4, -0.4],
          [0.4, -0.4],
          [-0.4, 0.4],
          [0.4, 0.4],
        ])
          b.box('darkMetal', [p.x + dx, y + 0.75, p.z + dz], [0.06, 1.5, 0.06], yaw);
        const g = new THREE.BoxGeometry(0.55, 0.05, 2.4);
        g.rotateX(0.55);
        g.rotateY(yaw);
        g.translate(p.x + Math.sin(yaw) * 1.4, y + 0.75, p.z + Math.cos(yaw) * 1.4);
        b.geometry('spPlayBlue', g);
        break;
      }
      case 'swing': {
        for (const s of [-1.2, 1.2]) b.box('darkMetal', [p.x + s, y + 1.1, p.z], [0.08, 2.2, 0.08], yaw);
        b.box('darkMetal', [p.x, y + 2.2, p.z], [2.5, 0.08, 0.08], yaw);
        for (const s of [-0.5, 0.5]) b.box('spPlayYellow', [p.x + s, y + 0.45, p.z], [0.45, 0.04, 0.2], yaw);
        break;
      }
      case 'bin':
        b.cylinder('darkMetal', [p.x, y, p.z], 0.22, 0.85, 10);
        break;
      case 'bollard':
        b.cylinder('darkMetal', [p.x, y, p.z], 0.07, 0.8, 8);
        break;
    }
  }
  return { holes, cars };
}

function rect(m: V2, t: V2, L: number, w: number): [number, number][] {
  const n: V2 = [-t[1], t[0]];
  const hl = L / 2;
  const hw = w / 2;
  return [
    [m[0] - t[0] * hl - n[0] * hw, m[1] - t[1] * hl - n[1] * hw],
    [m[0] + t[0] * hl - n[0] * hw, m[1] + t[1] * hl - n[1] * hw],
    [m[0] + t[0] * hl + n[0] * hw, m[1] + t[1] * hl + n[1] * hw],
    [m[0] - t[0] * hl + n[0] * hw, m[1] - t[1] * hl + n[1] * hw],
  ];
}

/** Çalı: basık küre gövde + yaprak kartları */
function bush(b: Builder, c: V3, r: number, h: number, seed: number): void {
  const g = new THREE.SphereGeometry(1, 10, 6);
  g.scale(r, h / 2, r);
  g.translate(c[0], c[1] + h / 2 - 0.05, c[2]);
  b.geometry('boxwood', g);
  for (let k = 0; k < 4; k++) {
    const a = ((k + (seed % 7) / 7) / 4) * Math.PI * 2;
    const n: V2 = [Math.cos(a), Math.sin(a)];
    const t: V2 = [-n[1], n[0]];
    const p: V2 = [c[0] + n[0] * r * 0.85, c[2] + n[1] * r * 0.85];
    leafFringe(
      b,
      'boxLeaf',
      [p[0] - t[0] * r * 0.6, p[1] - t[1] * r * 0.6],
      [p[0] + t[0] * r * 0.6, p[1] + t[1] * r * 0.6],
      c[1] + 0.1,
      c[1] + h * 0.95,
      r,
      n,
      4,
      seed + k * 31,
      Math.max(0.25, r * 0.45),
    );
  }
}

function gardenLamp(b: Builder, p: V3, h: number): void {
  b.cylinder('darkMetal', [p[0], p[1], p[2]], 0.1, 0.35, 8);
  b.cylinder('darkMetal', [p[0], p[1] + 0.35, p[2]], 0.045, h - 0.6, 8);
  b.cylinder('darkMetal', [p[0], p[1] + h - 0.25, p[2]], 0.09, 0.08, 8);
  const g = new THREE.SphereGeometry(0.2, 12, 8);
  g.translate(p[0], p[1] + h, p[2]);
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
  for (let k = 0; k < 3; k++) b.box('wood', P(0, 0.44, -0.1 + k * 0.13), [1.6, 0.04, 0.1], yaw);
  for (let k = 0; k < 3; k++) b.box('wood', P(0, 0.62 + k * 0.12, 0.2), [1.6, 0.09, 0.03], yaw);
  for (const x of [-0.65, 0.65]) {
    b.box('darkMetal', P(x, 0.22, 0.05), [0.06, 0.44, 0.45], yaw);
    b.box('darkMetal', P(x, 0.6, 0.22), [0.06, 0.4, 0.05], yaw);
  }
}

function umbrella(b: Builder, c: V3): void {
  b.cylinder('steel', c, 0.025, 2.3, 6);
  const g = new THREE.ConeGeometry(1.25, 0.45, 8, 1, true);
  g.translate(c[0], c[1] + 2.35, c[2]);
  b.geometry('umbrella', g);
}

function lounger(b: Builder, c: V3, yaw: number): void {
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const P = (x: number, y: number, z: number): V3 => [
    c[0] + x * co + z * si,
    c[1] + y,
    c[2] - x * si + z * co,
  ];
  b.box('lounger', P(-0.25, 0.32, 0), [1.25, 0.04, 0.66], yaw);
  b.box('lounger', P(0.7, 0.5, 0), [0.6, 0.04, 0.66], yaw);
  for (const [x, z] of [
    [-0.85, -0.28],
    [-0.85, 0.28],
    [0.45, -0.28],
    [0.45, 0.28],
  ])
    b.box('lounger', P(x, 0.15, z), [0.05, 0.3, 0.05], yaw);
}
