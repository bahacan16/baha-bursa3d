import * as THREE from 'three';

/**
 * Prosedürel araç modelleri: gövde, boyuna istasyonlarda tanımlı kesitlerin (ring) birleştirilmesiyle (loft) üretilir —
 * çamurluk kavisleri, tavan eğimi (tumblehome), ön/arka cam, kapı derz çizgileri, far/stop, ızgara, ayna, kapı kolu,
 * jantlı lastikler ve "16 …" Bursa plakaları. Model yönü: +Z ön, +X sağ, Y yukarı, taban y=0.
 * KARAR: glTF araç modeli indirilemiyor/lisans belirsiz → tamamen kodla; tipler Türkiye'de yaygın gövdelerden
 * (Egea/Corolla sedan, Clio hatchback, Duster SUV, Doblo hafif ticari) ölçü alınarak.
 */
export type CarKind = 'sedan' | 'hatch' | 'suv' | 'van';
export const CAR_KINDS: CarKind[] = ['sedan', 'hatch', 'suv', 'van'];
/** Türkiye trafiğindeki kabaca dağılım */
export function carKindOf(k: number): number {
  const r = (k * 7919) % 100;
  return r < 44 ? 0 : r < 74 ? 1 : r < 90 ? 2 : 3;
}

export type CarMat = 'paint' | 'dark' | 'glass' | 'chrome' | 'rubber' | 'lights' | 'plate' | 'shadow';

type KF = [number, number][];

/** Monoton kübik Hermite ara değer (aşma yapmaz). */
class Curve {
  private m: number[];
  constructor(private k: KF) {
    const n = k.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((k[i + 1][1] - k[i][1]) / (k[i + 1][0] - k[i][0]));
    this.m = k.map((_, i) => {
      if (i === 0) return d[0] ?? 0;
      if (i === n - 1) return d[n - 2] ?? 0;
      return d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    });
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        this.m[i] = this.m[i + 1] = 0;
        continue;
      }
      const a = this.m[i] / d[i];
      const b = this.m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        this.m[i] = t * a * d[i];
        this.m[i + 1] = t * b * d[i];
      }
    }
  }
  at(z: number): number {
    const k = this.k;
    if (z <= k[0][0]) return k[0][1];
    const n = k.length;
    if (z >= k[n - 1][0]) return k[n - 1][1];
    let i = 0;
    while (k[i + 1][0] < z) i++;
    const h = k[i + 1][0] - k[i][0];
    const t = (z - k[i][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * k[i][1] +
      (t3 - 2 * t2 + t) * h * this.m[i] +
      (-2 * t3 + 3 * t2) * k[i + 1][1] +
      (t3 - t2) * h * this.m[i + 1]
    );
  }
}

interface Spec {
  zMin: number;
  zMax: number;
  axles: [number, number];
  tireR: number;
  tireW: number;
  top: KF;
  bottom: KF;
  plan: KF;
  crown: KF;
  gh: {
    zA: number;
    zF: number;
    zB: number;
    zC: number;
    roofY: number;
    roofK: number;
    side: [number, number][];
    pillars: number[];
  };
  seams: number[];
  handles: number[];
  clad?: boolean;
  rails?: boolean;
}

const SPECS: Record<CarKind, Spec> = {
  sedan: {
    zMin: -2.27,
    zMax: 2.26,
    axles: [1.42, -1.22],
    tireR: 0.31,
    tireW: 0.2,
    top: [
      [-2.27, 0.74],
      [-2.22, 0.9],
      [-2.1, 0.97],
      [-1.6, 0.995],
      [-1.0, 0.995],
      [0.0, 0.99],
      [0.95, 0.96],
      [1.35, 0.93],
      [1.8, 0.87],
      [2.08, 0.8],
      [2.2, 0.73],
      [2.26, 0.6],
    ],
    bottom: [
      [-2.27, 0.4],
      [-2.12, 0.28],
      [-1.8, 0.19],
      [1.9, 0.19],
      [2.12, 0.25],
      [2.26, 0.3],
    ],
    plan: [
      [-2.27, 0.7],
      [-2.2, 0.82],
      [-2.02, 0.875],
      [-1.6, 0.893],
      [1.6, 0.893],
      [1.95, 0.868],
      [2.15, 0.81],
      [2.26, 0.66],
    ],
    crown: [
      [-2.27, 0],
      [-2.0, 0.03],
      [2.0, 0.045],
      [2.26, 0],
    ],
    gh: {
      zA: 0.98,
      zF: 0.2,
      zB: -0.78,
      zC: -1.42,
      roofY: 1.47,
      roofK: 0.77,
      side: [[-1.2, 0.95]],
      pillars: [-0.1],
    },
    seams: [0.97, -0.1, -1.14],
    handles: [0.14, -0.9],
  },
  hatch: {
    zMin: -2.03,
    zMax: 2.02,
    axles: [1.3, -1.28],
    tireR: 0.3,
    tireW: 0.195,
    top: [
      [-2.03, 0.8],
      [-1.98, 0.97],
      [-1.9, 1.02],
      [-1.5, 1.03],
      [0.0, 0.98],
      [0.9, 0.94],
      [1.3, 0.9],
      [1.7, 0.84],
      [1.92, 0.76],
      [2.02, 0.62],
    ],
    bottom: [
      [-2.03, 0.36],
      [-1.86, 0.25],
      [-1.62, 0.18],
      [1.7, 0.18],
      [1.9, 0.25],
      [2.02, 0.3],
    ],
    plan: [
      [-2.03, 0.72],
      [-1.95, 0.83],
      [-1.72, 0.862],
      [1.5, 0.872],
      [1.8, 0.85],
      [1.95, 0.79],
      [2.02, 0.66],
    ],
    crown: [
      [-2.03, 0],
      [-1.8, 0.025],
      [1.8, 0.04],
      [2.02, 0],
    ],
    gh: {
      zA: 0.92,
      zF: 0.12,
      zB: -1.55,
      zC: -1.93,
      roofY: 1.44,
      roofK: 0.78,
      side: [[-1.2, 0.88]],
      pillars: [-0.24],
    },
    seams: [0.9, -0.24, -1.2],
    handles: [0.0, -1.02],
  },
  suv: {
    zMin: -2.17,
    zMax: 2.17,
    axles: [1.34, -1.33],
    tireR: 0.35,
    tireW: 0.215,
    top: [
      [-2.17, 0.86],
      [-2.12, 1.05],
      [-2.0, 1.1],
      [-1.2, 1.12],
      [0.9, 1.08],
      [1.3, 1.04],
      [1.8, 0.99],
      [2.05, 0.93],
      [2.17, 0.78],
    ],
    bottom: [
      [-2.17, 0.48],
      [-1.96, 0.33],
      [-1.72, 0.25],
      [1.72, 0.25],
      [2.0, 0.34],
      [2.17, 0.42],
    ],
    plan: [
      [-2.17, 0.76],
      [-2.1, 0.86],
      [-1.9, 0.9],
      [1.8, 0.91],
      [2.05, 0.86],
      [2.17, 0.74],
    ],
    crown: [
      [-2.17, 0],
      [-1.9, 0.02],
      [1.9, 0.04],
      [2.17, 0],
    ],
    gh: {
      zA: 1.05,
      zF: 0.3,
      zB: -1.8,
      zC: -2.06,
      roofY: 1.66,
      roofK: 0.82,
      side: [[-1.74, 1.0]],
      pillars: [-0.12, -1.22],
    },
    seams: [1.03, -0.12, -1.2],
    handles: [0.12, -0.96],
    clad: true,
    rails: true,
  },
  van: {
    zMin: -2.21,
    zMax: 2.2,
    axles: [1.38, -1.37],
    tireR: 0.32,
    tireW: 0.205,
    top: [
      [-2.21, 0.85],
      [-2.18, 1.08],
      [-2.1, 1.12],
      [0.9, 1.1],
      [1.3, 1.06],
      [1.8, 0.98],
      [2.08, 0.9],
      [2.2, 0.76],
    ],
    bottom: [
      [-2.21, 0.4],
      [-2.05, 0.27],
      [-1.8, 0.21],
      [1.8, 0.21],
      [2.05, 0.28],
      [2.2, 0.34],
    ],
    plan: [
      [-2.21, 0.84],
      [-2.15, 0.88],
      [-2.0, 0.895],
      [1.7, 0.895],
      [2.0, 0.86],
      [2.2, 0.74],
    ],
    crown: [
      [-2.21, 0],
      [-2.0, 0.02],
      [1.9, 0.035],
      [2.2, 0],
    ],
    gh: {
      zA: 1.25,
      zF: 0.45,
      zB: -2.13,
      zC: -2.19,
      roofY: 1.84,
      roofK: 0.93,
      side: [[-0.98, 1.2]],
      pillars: [0.08],
    },
    seams: [1.22, 0.08, -1.02, -2.19],
    handles: [0.3, -0.85],
  },
};

type V3 = [number, number, number];

/** Malzeme kovaları; aynı kova + yumuşatma grubunda aynı konumdaki köşeler paylaşılır (pürüzsüz normal). */
class Acc {
  private b = new Map<
    CarMat,
    { pos: number[]; nrm: number[]; uv: number[]; col: number[]; idx: number[]; keys: Map<string, number> }
  >();
  private bucket(m: CarMat) {
    let x = this.b.get(m);
    if (!x) this.b.set(m, (x = { pos: [], nrm: [], uv: [], col: [], idx: [], keys: new Map() }));
    return x;
  }
  vert(
    m: CarMat,
    sg: number,
    p: V3,
    uv: [number, number] = [0, 0],
    col: V3 = [1, 1, 1],
    shared = true,
  ): number {
    const b = this.bucket(m);
    const key = shared ? `${sg}|${p[0].toFixed(4)}|${p[1].toFixed(4)}|${p[2].toFixed(4)}` : '';
    if (shared) {
      const k = b.keys.get(key);
      if (k !== undefined) return k;
    }
    const i = b.pos.length / 3;
    b.pos.push(p[0], p[1], p[2]);
    b.nrm.push(0, 0, 0);
    b.uv.push(uv[0], uv[1]);
    b.col.push(col[0], col[1], col[2]);
    if (shared) b.keys.set(key, i);
    return i;
  }
  tri(m: CarMat, a: number, c: number, d: number): void {
    const b = this.bucket(m);
    b.idx.push(a, c, d);
    const P = b.pos;
    const ax = P[a * 3];
    const ay = P[a * 3 + 1];
    const az = P[a * 3 + 2];
    const ux = P[c * 3] - ax;
    const uy = P[c * 3 + 1] - ay;
    const uz = P[c * 3 + 2] - az;
    const vx = P[d * 3] - ax;
    const vy = P[d * 3 + 1] - ay;
    const vz = P[d * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, c, d]) {
      b.nrm[v * 3] += nx;
      b.nrm[v * 3 + 1] += ny;
      b.nrm[v * 3 + 2] += nz;
    }
  }
  /** a,b,c,d saat yönünün tersine (dışarıdan bakınca) */
  quad(m: CarMat, sg: number, p: V3[], uv?: [number, number][], col?: V3, shared = true): void {
    const i = p.map((q, k) => this.vert(m, sg, q, uv?.[k], col, shared));
    if (new Set(i).size < 3) return;
    this.tri(m, i[0], i[1], i[2]);
    this.tri(m, i[0], i[2], i[3]);
  }
  /** Hazır geometriyi (index'li ya da değil) kovaya ekle, matris ile */
  add(m: CarMat, g: THREE.BufferGeometry, mtx: THREE.Matrix4, col: V3 = [1, 1, 1]): void {
    const b = this.bucket(m);
    const src = g.index ? g.toNonIndexed() : g;
    if (!src.attributes.normal) src.computeVertexNormals();
    const p = src.attributes.position;
    const n = src.attributes.normal;
    const uv = src.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(mtx);
    const v = new THREE.Vector3();
    const base = b.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mtx);
      b.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      b.nrm.push(v.x, v.y, v.z);
      b.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      b.col.push(col[0], col[1], col[2]);
      b.idx.push(base + i);
    }
    if (src !== g) src.dispose();
  }
  build(order: CarMat[]): { geo: THREE.BufferGeometry; mats: CarMat[] } {
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const geo = new THREE.BufferGeometry();
    const mats: CarMat[] = [];
    for (const m of order) {
      const b = this.b.get(m);
      if (!b || !b.idx.length) continue;
      const base = pos.length / 3;
      const start = idx.length;
      for (let i = 0; i < b.nrm.length; i += 3) {
        const l = Math.hypot(b.nrm[i], b.nrm[i + 1], b.nrm[i + 2]) || 1;
        nrm.push(b.nrm[i] / l, b.nrm[i + 1] / l, b.nrm[i + 2] / l);
      }
      pos.push(...b.pos);
      uv.push(...b.uv);
      col.push(...b.col);
      for (const i of b.idx) idx.push(i + base);
      geo.addGroup(start, b.idx.length, mats.length);
      mats.push(m);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return { geo, mats };
  }
}

/** Gövde yüzeyi: z ve kesit parametresi u (0 alt orta … 8 üst orta, sağ yarı) ile örneklenir. */
class Body {
  top: Curve;
  bottom: Curve;
  plan: Curve;
  crown: Curve;
  ra: number;
  constructor(readonly s: Spec) {
    this.top = new Curve(s.top);
    this.bottom = new Curve(s.bottom);
    this.plan = new Curve(s.plan);
    this.crown = new Curve(s.crown);
    this.ra = s.tireR + 0.075;
  }
  ring(z: number): [number, number][] {
    const yb = this.bottom.at(z);
    const yt = this.top.at(z);
    const hw = this.plan.at(z);
    let yA = yb;
    for (const zc of this.s.axles) {
      const d = z - zc;
      if (Math.abs(d) < this.ra) yA = Math.max(yA, this.s.tireR + Math.sqrt(this.ra * this.ra - d * d));
    }
    yA = Math.min(yA, yt - 0.14);
    const xi = hw - 0.3;
    const p4 = yA + 0.035;
    const p5 = Math.max(yb + 0.55 * (yt - yb), p4 + 0.02);
    const p6 = Math.max(yt - 0.075, p5 + 0.02);
    return [
      [0, yb],
      [xi, yb],
      [xi, yA],
      [hw - 0.014, yA],
      [hw, p4],
      [hw + 0.006, p5],
      [hw - 0.012, p6],
      [hw - 0.07, yt],
      [0, yt + this.crown.at(z)],
    ];
  }
  point(z: number, u: number): V3 {
    const r = this.ring(z);
    const i = Math.min(7, Math.max(0, Math.floor(u)));
    const f = u - i;
    return [r[i][0] + (r[i + 1][0] - r[i][0]) * f, r[i][1] + (r[i + 1][1] - r[i][1]) * f, z];
  }
  normal(z: number, u: number): V3 {
    const e = 0.004;
    const a = this.point(z, u - e);
    const b = this.point(z, u + e);
    const c = this.point(z - e, u);
    const d = this.point(z + e, u);
    const du = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const dz = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
    const n: V3 = [
      du[1] * dz[2] - du[2] * dz[1],
      du[2] * dz[0] - du[0] * dz[2],
      du[0] * dz[1] - du[1] * dz[0],
    ];
    const l = Math.hypot(...n) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  }
  /** Cam kabin (greenhouse) kesiti: [kemer, kemer çıtası, cam üstü, tavan kenarı, tavan ortası] ve t (0 kemer … 1 tavan) */
  cabin(z: number): { r: [number, number][]; t: number; zone: 'front' | 'roof' | 'rear' } {
    const g = this.s.gh;
    const yt = this.top.at(z);
    const hw = this.plan.at(z);
    let t: number;
    let zone: 'front' | 'roof' | 'rear';
    if (z > g.zF) {
      t = (g.zA - z) / (g.zA - g.zF);
      zone = 'front';
    } else if (z < g.zB) {
      t = (z - g.zC) / (g.zB - g.zC);
      zone = 'rear';
    } else {
      t = 1;
      zone = 'roof';
    }
    t = Math.min(1, Math.max(0, t));
    // Cam hafif dışbükey: tavana doğru yatıklaşıp tavana yumuşak bağlanır
    const e = zone === 'roof' ? 1 : 1 - (1 - t) ** 1.35;
    const mid = (g.zF + g.zB) / 2;
    const half = (g.zF - g.zB) / 2;
    const bow = zone === 'roof' ? 0.025 * (1 - ((z - mid) / half) ** 2) : 0;
    const h = yt + (g.roofY - yt) * Math.max(0, Math.min(1, e)) + bow;
    const xb = hw - 0.07;
    const xr = g.roofK * hw;
    const x3 = xb + (xr - xb) * t;
    const y1 = yt + 0.022 * Math.min(1, t * 5);
    const x2 = xb - 0.006 + (x3 + 0.04 - (xb - 0.006)) * t;
    const y2 = Math.max(h - 0.06 * t, y1);
    return {
      r: [
        [xb, yt],
        [xb - 0.006, y1],
        [x2, y2],
        [x3, Math.max(h, y2)],
        [0, Math.max(h, y2) + 0.035 * t],
      ],
      t,
      zone,
    };
  }
}

function stations(s: Spec, step: number, extra: number[], lod: 0 | 1 = 0): number[] {
  const zs = new Set<number>();
  for (let z = s.zMin; z < s.zMax; z += step) zs.add(+z.toFixed(4));
  zs.add(s.zMax);
  // Uçlarda yuvarlatma için sık istasyon
  for (const f of lod ? [0.04, 0.13] : [0.015, 0.04, 0.08, 0.13]) {
    zs.add(+(s.zMin + f).toFixed(4));
    zs.add(+(s.zMax - f).toFixed(4));
  }
  const ra = s.tireR + 0.075;
  for (const zc of s.axles) {
    zs.add(+(zc - ra).toFixed(4));
    zs.add(+(zc + ra).toFixed(4));
    zs.add(+(zc - ra + 0.003).toFixed(4));
    zs.add(+(zc + ra - 0.003).toFixed(4));
    const ka = lod ? 2 : 5;
    for (let k = -ka; k <= ka; k++) zs.add(+(zc + (k / (ka + 1)) * ra).toFixed(4));
  }
  for (const z of extra) zs.add(+z.toFixed(4));
  return [...zs].filter((z) => z >= s.zMin && z <= s.zMax).sort((a, b) => a - b);
}

/** Sağ taraf dörtgeni + aynası (x → −x, sarım ters). */
function mirrorQuad(acc: Acc, m: CarMat, sg: number, q: V3[], uv?: [number, number][], col?: V3): void {
  acc.quad(m, sg, q, uv, col);
  const r = q.map((p) => [-p[0], p[1], p[2]] as V3);
  acc.quad(m, sg, [r[0], r[3], r[2], r[1]], uv ? [uv[0], uv[3], uv[2], uv[1]] : undefined, col);
}

let sgCounter = 10;

/** Gövde yüzeyine oturan yama (far, stop, ızgara, derz çizgisi) */
function patch(
  acc: Acc,
  body: Body,
  m: CarMat,
  z0: number,
  z1: number,
  u0: number,
  u1: number,
  nz: number,
  nu: number,
  off: number,
  col?: V3,
): void {
  const sg = sgCounter++;
  const P = (z: number, u: number): V3 => {
    const p = body.point(z, u);
    const n = body.normal(z, u);
    return [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off];
  };
  for (let i = 0; i < nz; i++)
    for (let j = 0; j < nu; j++) {
      const za = z0 + ((z1 - z0) * i) / nz;
      const zb = z0 + ((z1 - z0) * (i + 1)) / nz;
      const ua = u0 + ((u1 - u0) * j) / nu;
      const ub = u0 + ((u1 - u0) * (j + 1)) / nu;
      mirrorQuad(acc, m, sg, [P(za, ua), P(za, ub), P(zb, ub), P(zb, ua)], undefined, col);
    }
}

/** Uç kapağı düzleminde dikdörtgen (ön: +Z'ye, arka: −Z'ye bakar). x0<x1, y0<y1 */
function capRect(
  acc: Acc,
  m: CarMat,
  z: number,
  front: boolean,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  uv?: boolean,
  col?: V3,
): void {
  const sg = sgCounter++;
  const q: V3[] = front
    ? [
        [x0, y0, z],
        [x1, y0, z],
        [x1, y1, z],
        [x0, y1, z],
      ]
    : [
        [x1, y0, z],
        [x0, y0, z],
        [x0, y1, z],
        [x1, y1, z],
      ];
  acc.quad(
    m,
    sg,
    q,
    uv
      ? [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ]
      : undefined,
    col,
  );
}

function boxAt(acc: Acc, m: CarMat, c: V3, s: V3, rotY = 0, rotX = 0, col?: V3): void {
  const g = new THREE.BoxGeometry(s[0], s[1], s[2]);
  const mtx = new THREE.Matrix4().compose(
    new THREE.Vector3(...c),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
  acc.add(m, g, mtx, col);
  g.dispose();
}

/** Tek teker (merkez orijinde, dış yüz +X): lastik + jant. lod 1 = basit. */
function wheelParts(acc: Acc, R: number, W: number, mtx: THREE.Matrix4, lod: 0 | 1): void {
  const Rr = R * 0.64;
  const seg = lod ? 8 : 12;
  const h = W / 2;
  const prof = lod
    ? [
        [Rr, -h],
        [R, -h + 0.02],
        [R, h - 0.02],
        [Rr, h],
      ]
    : [
        [Rr, -h + 0.012],
        [Rr + 0.02, -h],
        [R - 0.035, -h - 0.004],
        [R - 0.01, -h + 0.02],
        [R, -h + 0.05],
        [R, h - 0.05],
        [R - 0.01, h - 0.02],
        [R - 0.035, h + 0.004],
        [Rr + 0.02, h],
        [Rr, h - 0.012],
      ];
  // Lathe Y ekseni etrafında döndürür → Y'yi X'e çevir (dış yüz +X)
  const toX = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
  const tire = new THREE.LatheGeometry(
    prof.map(([r, a]) => new THREE.Vector2(r, a)),
    seg,
  );
  acc.add('rubber', tire, mtx.clone().multiply(toX));
  tire.dispose();
  // Jant iç karanlığı (disk + fren diski)
  const dark = new THREE.CircleGeometry(Rr, seg).rotateY(Math.PI / 2).translate(h - 0.05, 0, 0);
  acc.add('rubber', dark, mtx);
  dark.dispose();
  if (lod) {
    const face = new THREE.CircleGeometry(Rr * 0.95, seg).rotateY(Math.PI / 2).translate(h - 0.02, 0, 0);
    acc.add('chrome', face, mtx);
    face.dispose();
    return;
  }
  const disc = new THREE.CylinderGeometry(Rr * 0.72, Rr * 0.72, 0.015, 18)
    .rotateZ(Math.PI / 2)
    .translate(h - 0.07, 0, 0);
  acc.add('dark', disc, mtx);
  disc.dispose();
  // Jant dudağı
  const lip = new THREE.TorusGeometry(Rr - 0.01, 0.012, 4, 20)
    .rotateY(Math.PI / 2)
    .translate(h - 0.025, 0, 0);
  acc.add('chrome', lip, mtx);
  lip.dispose();
  // 5 kol (hafif içe çanaklı)
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const len = Rr - 0.055;
    const sp = new THREE.BoxGeometry(0.022, len, 0.05);
    const m = new THREE.Matrix4()
      .makeTranslation(h - 0.032, 0, 0)
      .multiply(new THREE.Matrix4().makeRotationX(a))
      .multiply(new THREE.Matrix4().makeTranslation(0, 0.045 + len / 2, 0))
      .multiply(new THREE.Matrix4().makeRotationZ(0.12));
    acc.add('chrome', sp, mtx.clone().multiply(m));
    sp.dispose();
  }
  const hub = new THREE.CylinderGeometry(0.055, 0.06, 0.03, 12)
    .rotateZ(Math.PI / 2)
    .translate(h - 0.03, 0, 0);
  acc.add('chrome', hub, mtx);
  hub.dispose();
}

export interface CarModel {
  body: THREE.BufferGeometry;
  bodyMats: CarMat[];
  trim: THREE.BufferGeometry;
  trimMats: CarMat[];
  /** Tek teker geometrisi (trafikte dönen tekerler için; dış yüz +X) */
  wheel: THREE.BufferGeometry;
  wheelMats: CarMat[];
  /** Teker merkezleri (sağ ön, sol ön, sağ arka, sol arka) */
  wheelPos: V3[];
  halfW: number;
  halfL: number;
}

const WHITE_LENS: V3 = [0.92, 0.94, 1.0];
const RED_LENS: V3 = [0.78, 0.04, 0.03];
const AMBER: V3 = [1.0, 0.45, 0.05];

export function buildCar(kind: CarKind, lod: 0 | 1, wheelsInTrim: boolean): CarModel {
  const s = SPECS[kind];
  const body = new Body(s);
  const acc = new Acc();
  const trim = new Acc();
  const g = s.gh;
  const extra = [g.zA, g.zF, g.zB, g.zC, ...g.pillars.flatMap((p) => [p - 0.05, p + 0.05]), ...g.side.flat()];
  const zs = stations(s, lod ? 0.45 : 0.1, lod ? [g.zA, g.zF, g.zB, g.zC] : extra, lod);
  // --- Alt gövde ---
  const segMat = (k: number): CarMat => (k < 4 ? 'dark' : k === 4 && s.clad ? 'dark' : 'paint');
  for (let i = 0; i + 1 < zs.length; i++) {
    const za = zs[i];
    const zb = zs[i + 1];
    const ra = body.ring(za);
    const rb = body.ring(zb);
    for (let k = 0; k < 8; k++) {
      const m = segMat(k);
      // Omuz çizgisi (P6) keskin kalsın: yan ve üst ayrı yumuşatma grubunda
      mirrorQuad(acc, m, k >= 6 ? 5 : 0, [
        [ra[k][0], ra[k][1], za],
        [ra[k + 1][0], ra[k + 1][1], za],
        [rb[k + 1][0], rb[k + 1][1], zb],
        [rb[k][0], rb[k][1], zb],
      ]);
    }
  }
  // Uç kapakları (tampon yüzleri)
  for (const front of [true, false]) {
    const z = front ? s.zMax : s.zMin;
    const r = body.ring(z);
    const sg = front ? 1 : 2;
    const cy = (r[0][1] + r[8][1]) / 2;
    const c: V3 = [0, cy, z];
    for (let k = 0; k < 8; k++) {
      const a: V3 = [r[k][0], r[k][1], z];
      const b: V3 = [r[k + 1][0], r[k + 1][1], z];
      const m: CarMat = 'paint';
      const ai = acc.vert(m, sg, c);
      const bi = acc.vert(m, sg, a);
      const ci = acc.vert(m, sg, b);
      const al = acc.vert(m, sg, [-a[0], a[1], z]);
      const bl = acc.vert(m, sg, [-b[0], b[1], z]);
      if (front) {
        acc.tri(m, ai, bi, ci);
        acc.tri(m, ai, bl, al);
      } else {
        acc.tri(m, ai, ci, bi);
        acc.tri(m, ai, al, bl);
      }
    }
  }
  // --- Cam kabin ---
  const gz = zs.filter((z) => z >= g.zC && z <= g.zA);
  const inSide = (z: number) => g.side.some(([a, b]) => z >= a && z <= b);
  const nearPillar = (z: number) => g.pillars.some((p) => Math.abs(z - p) < 0.05);
  for (let i = 0; i + 1 < gz.length; i++) {
    const za = gz[i];
    const zb = gz[i + 1];
    const zm = (za + zb) / 2;
    const A = body.cabin(za);
    const B = body.cabin(zb);
    const zone = body.cabin(zm).zone;
    for (let k = 0; k < 4; k++) {
      let m: CarMat;
      if (k === 0) m = 'dark';
      else if (k === 1) m = inSide(zm) && !nearPillar(zm) ? 'glass' : nearPillar(zm) ? 'dark' : 'paint';
      else if (k === 2) m = 'paint';
      else m = zone === 'roof' ? 'paint' : 'glass';
      mirrorQuad(acc, m, 3 + (m === 'glass' ? 1 : 0), [
        [A.r[k][0], A.r[k][1], za],
        [A.r[k + 1][0], A.r[k + 1][1], za],
        [B.r[k + 1][0], B.r[k + 1][1], zb],
        [B.r[k][0], B.r[k][1], zb],
      ]);
    }
  }
  const L = s.zMax - s.zMin;
  // --- Ayrıntılar ---
  const botF = body.bottom.at(s.zMax);
  const hwF = body.plan.at(s.zMax);
  const topR = body.top.at(s.zMin);
  const botR = body.bottom.at(s.zMin);
  const hwR = body.plan.at(s.zMin);
  // Farlar (köşeyi saran mercek + koyu çerçeve)
  patch(
    trim,
    body,
    'lights',
    s.zMax - 0.4,
    s.zMax - 0.04,
    6.05,
    7.5,
    lod ? 1 : 4,
    lod ? 1 : 4,
    0.005,
    WHITE_LENS,
  );
  // Stoplar
  patch(
    trim,
    body,
    'lights',
    s.zMin + 0.01,
    s.zMin + 0.34,
    5.55,
    7.35,
    lod ? 1 : 3,
    lod ? 1 : 3,
    0.005,
    RED_LENS,
  );
  if (!lod) {
    patch(acc, body, 'dark', s.zMax - 0.42, s.zMax - 0.02, 5.95, 7.58, 3, 3, 0.0025);
    patch(acc, body, 'dark', s.zMin + 0.004, s.zMin + 0.36, 5.45, 7.45, 3, 3, 0.0025);
    // Sinyal (far içi turuncu şerit)
    patch(trim, body, 'lights', s.zMax - 0.4, s.zMax - 0.33, 6.1, 7.4, 1, 2, 0.006, AMBER);
    // Far içi krom yansıtıcılar (iki mercek)
    patch(trim, body, 'chrome', s.zMax - 0.3, s.zMax - 0.2, 6.9, 7.12, 1, 1, 0.0058);
    patch(trim, body, 'chrome', s.zMax - 0.22, s.zMax - 0.1, 7.2, 7.4, 1, 1, 0.0058);
    // Üst ızgara
    patch(acc, body, 'dark', s.zMax - 0.18, s.zMax - 0.005, 7.52, 8.0, 2, 2, 0.003);
    patch(trim, body, 'chrome', s.zMax - 0.19, s.zMax - 0.17, 7.5, 8.0, 1, 2, 0.0035);
    patch(trim, body, 'chrome', s.zMax - 0.1, s.zMax - 0.085, 7.55, 8.0, 1, 2, 0.0035);
    // Kapı derzleri
    for (const z of s.seams) patch(acc, body, 'dark', z - 0.004, z + 0.004, 4.15, 6.95, 1, 6, 0.0015);
    // Kaput ve bagaj derzleri (boyuna)
    patch(acc, body, 'dark', g.zA + 0.04, s.zMax - 0.16, 7.28, 7.3, 6, 1, 0.0015);
    if (kind === 'sedan') patch(acc, body, 'dark', s.zMin + 0.14, g.zC - 0.04, 7.26, 7.28, 4, 1, 0.0015);
    // Kapı kolları
    for (const z of s.handles) {
      const y = body.top.at(z) - 0.1;
      const x = body.plan.at(z) + 0.012;
      boxAt(trim, 'chrome', [x, y, z], [0.02, 0.026, 0.15]);
      boxAt(trim, 'chrome', [-x, y, z], [0.02, 0.026, 0.15]);
    }
    // Yan aynalar (gövde renginde kapak + koyu taban + ayna camı)
    const zm = g.zA - 0.14;
    const ym = body.top.at(zm) + 0.1;
    const xm = body.plan.at(zm) + 0.04;
    for (const sx of [1, -1]) {
      boxAt(acc, 'paint', [sx * (xm + 0.04), ym, zm], [0.1, 0.1, 0.17], sx * 0.12);
      boxAt(acc, 'dark', [sx * (xm - 0.02), ym - 0.03, zm + 0.02], [0.08, 0.04, 0.1]);
      boxAt(trim, 'glass', [sx * (xm + 0.04), ym, zm - 0.088], [0.085, 0.08, 0.004], sx * 0.12);
    }
    // Silecekler
    const yw = body.top.at(g.zA) + 0.03;
    boxAt(trim, 'rubber', [0.28, yw, g.zA - 0.06], [0.58, 0.014, 0.025], 0.18);
    boxAt(trim, 'rubber', [-0.3, yw, g.zA - 0.06], [0.58, 0.014, 0.025], 0.18);
    // Anten (köpekbalığı yüzgeci)
    if (kind !== 'van') boxAt(trim, 'rubber', [0, g.roofY + 0.055, g.zB + 0.1], [0.07, 0.06, 0.16], 0, 0.25);
  }
  // Tavan rayları (SUV)
  if (s.rails) {
    const x = g.roofK * body.plan.at(0) - 0.07;
    const len = g.zF - g.zB + 0.1;
    for (const sx of [1, -1]) {
      boxAt(trim, 'chrome', [sx * x, g.roofY + 0.075, (g.zF + g.zB) / 2], [0.035, 0.03, len]);
      for (const zz of [g.zF - 0.02, g.zB + 0.05, (g.zF + g.zB) / 2])
        boxAt(trim, 'rubber', [sx * x, g.roofY + 0.04, zz], [0.04, 0.06, 0.08]);
    }
  }
  // Ön tampon: alt hava girişi + plaka; arka: plaka + reflektör
  const zf = s.zMax + 0.003;
  const zr = s.zMin - 0.003;
  capRect(
    acc,
    'dark',
    zf,
    true,
    -Math.min(0.46, hwF - 0.12),
    Math.min(0.46, hwF - 0.12),
    botF + 0.015,
    botF + 0.09,
  );
  capRect(trim, 'plate', zf + 0.004, true, -0.26, 0.26, botF + 0.105, botF + 0.215, true);
  capRect(trim, 'plate', zr - 0.004, false, -0.26, 0.26, topR - 0.33, topR - 0.22, true);
  if (!lod) {
    capRect(acc, 'dark', zf + 0.001, true, -0.28, 0.28, botF + 0.095, botF + 0.225);
    capRect(acc, 'dark', zr - 0.001, false, -0.28, 0.28, topR - 0.34, topR - 0.21);
    for (const sx of [1, -1]) {
      // Arka kapak köşesindeki stop parçası ve alt reflektör
      const x0 = hwR - 0.36;
      const x1 = hwR - 0.02;
      capRect(
        trim,
        'lights',
        zr - 0.002,
        false,
        sx > 0 ? x0 : -x1,
        sx > 0 ? x1 : -x0,
        topR - 0.17,
        topR - 0.015,
        false,
        RED_LENS,
      );
      capRect(
        trim,
        'lights',
        zr - 0.002,
        false,
        sx > 0 ? hwR - 0.22 : -(hwR - 0.08),
        sx > 0 ? hwR - 0.08 : -(hwR - 0.22),
        botR + 0.03,
        botR + 0.06,
        false,
        RED_LENS,
      );
      // Sis farı
      capRect(
        trim,
        'lights',
        zf + 0.002,
        true,
        sx > 0 ? hwF - 0.2 : -(hwF - 0.08),
        sx > 0 ? hwF - 0.08 : -(hwF - 0.2),
        botF + 0.03,
        botF + 0.08,
        false,
        WHITE_LENS,
      );
    }
  }
  // Gölge lekesi
  {
    const w = body.plan.at(0) + 0.22;
    const hl = L / 2 + 0.2;
    const zc = (s.zMax + s.zMin) / 2;
    trim.quad(
      'shadow',
      sgCounter++,
      [
        [-w, 0.02, zc + hl],
        [w, 0.02, zc + hl],
        [w, 0.02, zc - hl],
        [-w, 0.02, zc - hl],
      ],
      [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
    );
  }
  // Tekerler
  const wheelPos: V3[] = [];
  for (const zc of s.axles) {
    const x = body.plan.at(zc) - 0.022 - s.tireW / 2;
    wheelPos.push([x, s.tireR, zc], [-x, s.tireR, zc]);
  }
  if (wheelsInTrim)
    for (const [x, y, z] of wheelPos) {
      const m = new THREE.Matrix4().makeTranslation(x, y, z);
      if (x < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      wheelParts(trim, s.tireR, s.tireW, m, lod);
    }
  const wacc = new Acc();
  wheelParts(wacc, s.tireR, s.tireW, new THREE.Matrix4(), lod);
  const b = acc.build(['paint', 'dark', 'glass']);
  const t = trim.build(['glass', 'chrome', 'rubber', 'dark', 'lights', 'plate', 'shadow']);
  const w = wacc.build(['rubber', 'dark', 'chrome']);
  return {
    body: b.geo,
    bodyMats: b.mats,
    trim: t.geo,
    trimMats: t.mats,
    wheel: w.geo,
    wheelMats: w.mats,
    wheelPos,
    halfW: body.plan.at(0),
    halfL: L / 2,
  };
}

/** Bursa plakaları (16 …) doku atlası: 4 sütun × 8 satır. */
const PLATE_COLS = 4;
const PLATE_ROWS = 8;
export const PLATE_COUNT = PLATE_COLS * PLATE_ROWS;

/** Birim testleri (node) tuvalsiz çalışır → boş doku */
const hasDom = typeof document !== 'undefined';

function plateTexture(): THREE.Texture {
  if (!hasDom) return new THREE.Texture();
  const cw = 256;
  const ch = 56;
  const c = document.createElement('canvas');
  c.width = cw * PLATE_COLS;
  c.height = ch * PLATE_ROWS;
  const g = c.getContext('2d')!;
  let seed = 16;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const L = 'ABCDEFGHJKLMNPRSTUVYZ';
  for (let r = 0; r < PLATE_ROWS; r++)
    for (let k = 0; k < PLATE_COLS; k++) {
      const x = k * cw;
      const y = r * ch;
      g.fillStyle = '#f4f4f0';
      g.fillRect(x, y, cw, ch);
      g.strokeStyle = '#111';
      g.lineWidth = 3;
      g.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
      g.fillStyle = '#1f47a6';
      g.fillRect(x + 3, y + 3, 26, ch - 6);
      g.fillStyle = '#fff';
      g.font = 'bold 15px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText('TR', x + 16, y + ch - 10);
      const nl = 1 + Math.floor(rnd() * 3);
      let letters = '';
      for (let i = 0; i < nl; i++) letters += L[Math.floor(rnd() * L.length)];
      const nd = nl === 1 ? 4 : nl === 2 ? 3 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
      let digits = '';
      for (let i = 0; i < nd; i++) digits += Math.floor(rnd() * 10);
      g.fillStyle = '#111';
      g.font = 'bold 40px "Arial Narrow", Arial, sans-serif';
      g.save();
      g.translate(x + 30 + (cw - 30) / 2, y + ch / 2 + 14);
      g.scale(0.82, 1);
      g.fillText(`16 ${letters} ${digits}`, 0, 0);
      g.restore();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function blobTexture(): THREE.Texture {
  if (!hasDom) return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const u = Math.abs(x / 31.5 - 1);
      const v = Math.abs(y / 31.5 - 1);
      // Yuvarlatılmış dikdörtgen yumuşak gölge
      const d = Math.max(0, Math.hypot(Math.max(0, u - 0.55), Math.max(0, v - 0.7)) / 0.45);
      const a = Math.max(0, 1 - d) ** 1.6;
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255);
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

export const CAR_COLORS = [
  0xf4f4f2, 0xefefec, 0xe8e8e4, 0xf2f2ef, 0xdcdcd8, 0x1a1b1d, 0x26272a, 0x8e959b, 0xa7adb2, 0x6b7076,
  0x4d5157, 0x9d1b1f, 0x1d3b70, 0x2c5190, 0x7a6a55, 0xc9b98f, 0x344a3a, 0x5a1f24,
];

/** Paylaşılan araç malzemeleri (farların gece parlaklığı `lights.emissiveIntensity` ile). */
export class CarMaterials {
  readonly map: Record<CarMat, THREE.Material>;
  readonly lights: THREE.MeshStandardMaterial;
  private tex: THREE.Texture[];
  constructor() {
    const plateTex = plateTexture();
    const blob = blobTexture();
    this.tex = [plateTex, blob];
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.34,
      metalness: 0.4,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      // Ortam haritası sahnede 0.06 ölçekli (HDR gökyüzü) → boya/cam yansıması için yükselt
      envMapIntensity: 6,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.7, metalness: 0.1 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x0a0e12,
      roughness: 0.03,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 14,
    });
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xc9ccd1,
      roughness: 0.2,
      metalness: 1,
      envMapIntensity: 10,
    });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x19191a, roughness: 0.9 });
    const lights = (this.lights = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.08,
      metalness: 0.3,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    }));
    lights.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif',
      );
    };
    lights.customProgramCacheKey = () => 'car-lights-v1';
    const plate = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.45, metalness: 0.1 });
    plate.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float plateId;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
#ifdef USE_MAP
{
  float pc = mod(plateId, ${PLATE_COLS}.0);
  float pr = floor(plateId / ${PLATE_COLS}.0);
  vMapUv = vec2((pc + uv.x) / ${PLATE_COLS}.0, 1.0 - (pr + 1.0 - uv.y) / ${PLATE_ROWS}.0);
}
#endif`,
        );
    };
    plate.customProgramCacheKey = () => 'car-plate-v1';
    const shadow = new THREE.MeshBasicMaterial({
      color: 0x000000,
      alphaMap: blob,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.map = { paint, dark, glass, chrome, rubber, lights, plate, shadow };
  }
  list(keys: CarMat[]): THREE.Material[] {
    return keys.map((k) => this.map[k]);
  }
  dispose(): void {
    for (const m of Object.values(this.map)) m.dispose();
    for (const t of this.tex) t.dispose();
  }
}
