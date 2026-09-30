import * as THREE from 'three';
import {
  buildCar,
  CAR_COLORS,
  CAR_KINDS,
  CarMaterials,
  carKindOf,
  PLATE_COUNT,
  type CarModel,
} from './carmodel';
import type { Quality } from '../core/settings';

interface Tier {
  body: THREE.InstancedMesh;
  trim: THREE.InstancedMesh;
  plate: THREE.InstancedBufferAttribute;
  n: number;
}

/**
 * Park etmiş araçlar (statik, instanced). Veri: [x, y, z, yaw, tohum]*.
 * Tür (sedan/hatchback/SUV/hafif ticari), renk ve plaka tohumdan. Yakındakiler ayrıntılı, uzaktakiler kaba modelle.
 */
export class ParkedCars {
  readonly group = new THREE.Group();
  count: number;
  private mats = new CarMaterials();
  private models: CarModel[] = [];
  private near: Tier[] = [];
  private far: Tier[] = [];
  private timer = 0;
  private nearR: number;
  private farMax: number;
  private nearMax: number;
  private farR: number;

  constructor(
    public data: Float32Array,
    quality: Quality,
  ) {
    this.group.name = 'parked-cars';
    const n = (this.count = data.length / 5);
    // KARAR: binlerce park eden araç var; yalnızca oyuncuya yakın olanlar çizilir (çarpışma hepsinde)
    this.farMax = quality === 'high' ? 200 : quality === 'medium' ? 130 : 60;
    // KARAR: ayrıntılı araç ~5k üçgen; yakın halka 50/35/20 m (uzakta kaba model farkı görünmüyor)
    this.nearMax = quality === 'high' ? 40 : quality === 'medium' ? 24 : 10;
    this.nearR = quality === 'high' ? 50 : quality === 'medium' ? 35 : 20;
    this.farR = quality === 'high' ? 240 : quality === 'medium' ? 180 : 110;
    const shadows = quality !== 'low';
    const mk = (m: CarModel, cap: number, detail: boolean): Tier => {
      const trimGeo = m.trim.clone();
      const plate = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      trimGeo.setAttribute('plateId', plate);
      const body = new THREE.InstancedMesh(m.body, this.mats.list(m.bodyMats), cap);
      const trim = new THREE.InstancedMesh(trimGeo, this.mats.list(m.trimMats), cap);
      body.name = `parkedBody${detail ? 'Hi' : 'Lo'}`;
      trim.name = `parkedTrim${detail ? 'Hi' : 'Lo'}`;
      for (const im of [body, trim]) {
        im.count = 0;
        im.visible = false;
        im.frustumCulled = false;
        this.group.add(im);
      }
      body.castShadow = shadows && detail;
      body.receiveShadow = shadows;
      body.setColorAt(0, new THREE.Color(1, 1, 1));
      return { body, trim, plate, n: 0 };
    };
    for (const kind of CAR_KINDS) {
      const hi = buildCar(kind, 0, true);
      const lo = buildCar(kind, 1, true);
      this.models.push(hi, lo);
      this.near.push(mk(hi, Math.max(1, Math.min(n, this.nearMax)), true));
      this.far.push(mk(lo, Math.max(1, Math.min(n, this.farMax)), false));
    }
  }

  private mm = new THREE.Matrix4();
  private qq = new THREE.Quaternion();
  private vv = new THREE.Vector3();
  private cc = new THREE.Color();
  private ones = new THREE.Vector3(1, 1, 1);
  private upv = new THREE.Vector3(0, 1, 0);

  /** Oyuncu çevresindeki araçları seç (0.4 sn'de bir). */
  update(player: THREE.Vector3, dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    const d = this.data;
    const R2 = this.farR * this.farR;
    const N2 = this.nearR * this.nearR;
    for (const t of [...this.near, ...this.far]) t.n = 0;
    // Yarıçap içindekileri uzaklığa göre sırala: en yakınlar ayrıntılı modeli alır
    const cand: [number, number][] = [];
    for (let i = 0; i < this.count; i++) {
      const dx = d[i * 5] - player.x;
      const dz = d[i * 5 + 2] - player.z;
      const r2 = dx * dx + dz * dz;
      if (r2 <= R2) cand.push([r2, i]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    for (const [r2, i] of cand) {
      const seed = d[i * 5 + 4];
      const kind = carKindOf(seed);
      let t = r2 < N2 ? this.near[kind] : this.far[kind];
      if (t.n >= t.body.instanceMatrix.count) t = this.far[kind];
      if (t.n >= t.body.instanceMatrix.count) continue;
      this.qq.setFromAxisAngle(this.upv, d[i * 5 + 3]);
      this.mm.compose(this.vv.set(d[i * 5], d[i * 5 + 1], d[i * 5 + 2]), this.qq, this.ones);
      t.body.setMatrixAt(t.n, this.mm);
      t.trim.setMatrixAt(t.n, this.mm);
      t.body.setColorAt(t.n, this.cc.set(CAR_COLORS[(seed * 31) % CAR_COLORS.length]));
      t.plate.setX(t.n, (seed * 17) % PLATE_COUNT);
      t.n++;
    }
    for (const t of [...this.near, ...this.far]) {
      t.body.count = t.trim.count = t.n;
      // Boş örnek listesi de çizim çağrısı sayılır (malzeme grubu başına) → gizle
      t.body.visible = t.trim.visible = t.n > 0;
      t.body.instanceMatrix.needsUpdate = true;
      t.trim.instanceMatrix.needsUpdate = true;
      if (t.body.instanceColor) t.body.instanceColor.needsUpdate = true;
      t.plate.needsUpdate = true;
    }
  }

  /** Sonradan araç ekle (el modeli otoparkları); yeni araçların indeks aralığını döndürür */
  addCars(extra: number[]): [number, number] {
    const start = this.count;
    const d = new Float32Array(this.data.length + extra.length);
    d.set(this.data);
    d.set(extra, this.data.length);
    this.data = d;
    this.count = d.length / 5;
    this.timer = 0;
    return [start, this.count];
  }

  /** Çarpışma kutuları için: her araç yönlendirilmiş kutu köşeleri. */
  forEachBox(cb: (corners: [number, number][], y: number) => void, from = 0, to = this.count): void {
    const d = this.data;
    for (let i = from; i < to; i++) {
      const x = d[i * 5];
      const z = d[i * 5 + 2];
      const yaw = d[i * 5 + 3];
      const m = this.models[carKindOf(d[i * 5 + 4]) * 2];
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = fz;
      const rz = -fx;
      const L = m.halfL;
      const W = m.halfW;
      cb(
        [
          [x + fx * L + rx * W, z + fz * L + rz * W],
          [x + fx * L - rx * W, z + fz * L - rz * W],
          [x - fx * L - rx * W, z - fz * L - rz * W],
          [x - fx * L + rx * W, z - fz * L + rz * W],
        ],
        d[i * 5 + 1],
      );
    }
  }

  dispose(): void {
    for (const m of this.models) for (const g of [m.body, m.trim, m.wheel]) g.dispose();
    for (const t of [...this.near, ...this.far]) t.trim.geometry.dispose();
    this.mats.dispose();
  }
}

// ───────────────────────── Ölçülmüş park şeritleri (street-plan.json `parking`) ─────────────────────────

type P2 = [number, number];

/**
 * Ölçülmüş park şeridi / otopark sırası (street-plan.json `parking[]`, D4'ten itibaren).
 * `line` araç MERKEZLERİNİN hattıdır (bordürden içeri değil: ölçümde bordür + ofset olarak hesaplanır).
 * - mode: parallel (araç ekseni hat boyunca), perpendicular (hatta dik), angled (`angle` derece, hatla açı).
 * - nose: parallel'de fwd (hat yönünde) | back; perpendicular / angled'da right | left (hat yönüne bakınca burnun
 *   gittiği yan; angled'da burun ayrıca hat yönüne yatar — ters eğim için hat ters çizilir).
 * - pitch: yuva aralığı (m, hat boyunca). Yuvalar hattın ortasına hizalanır.
 * - at: karelerde görülen araç merkezleri (yaklaşık [x, z]); en yakın boş yuvaya oturur. Verilirse doluluk
 *   yalnızca bundan gelir. Yoksa `occupancy` (0..1) ile yuva başına deterministik (id + yuva no) seçim.
 */
export interface ParkingStrip {
  id: string;
  line: P2[];
  mode: 'parallel' | 'perpendicular' | 'angled';
  angle?: number;
  nose?: 'fwd' | 'back' | 'left' | 'right';
  pitch?: number;
  occupancy?: number;
  at?: P2[];
  note?: string;
}

/** Park edilemeyen alan (yaya geçidi, durak önü, ada, araç girişi): kapalı çokgen */
export type ParkingBlocker = P2[];

/** Planlamada araç kutusu (en büyük model ≈4.53 × 1.8 m; biraz pay) */
const PARK_HALF_L = 2.3;
const PARK_HALF_W = 0.95;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function inRing(r: readonly P2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function segHit(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** İki kapalı çokgen kesişiyor mu (biri diğerinin içinde dahil) */
export function ringsOverlap(a: readonly P2[], b: readonly P2[]): boolean {
  for (const p of a) if (inRing(b, p[0], p[1])) return true;
  for (const p of b) if (inRing(a, p[0], p[1])) return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (segHit(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}

function rect(cx: number, cz: number, u: P2, hu: number, hv: number): P2[] {
  const v: P2 = [-u[1], u[0]];
  return [
    [cx + u[0] * hu + v[0] * hv, cz + u[1] * hu + v[1] * hv],
    [cx - u[0] * hu + v[0] * hv, cz - u[1] * hu + v[1] * hv],
    [cx - u[0] * hu - v[0] * hv, cz - u[1] * hu - v[1] * hv],
    [cx + u[0] * hu - v[0] * hv, cz + u[1] * hu - v[1] * hv],
  ];
}

/**
 * Sokak planı öğelerinden park yasağı alanları. KARAR (kural: geçit, durak, ada, araç girişi kapatılmaz):
 * - crossing: yürüme doğrultusunda len/2 + 3 m (geçit ağzının iki yanındaki park şeridine taşar), yol boyunca w/2 + 1 m;
 * - bus-shelter: uzun ekseni boyunca w/2 + 1 m, dikinde ±7 m (durak önündeki şerit);
 * - island (poly): çokgenin kendisi (kaldırım çıkıntısı, refüj);
 * - araç kapısı (gates kind vehicle): açıklık w/2 + 0.5 m, sokak yönünde 8 m.
 */
export function parkingBlockers(
  items: readonly {
    kind?: string;
    x?: number;
    z?: number;
    rot?: number;
    len?: number;
    w?: number;
    poly?: P2[];
  }[],
  gates: readonly { kind: string; c: P2; n: P2; w: number }[] = [],
): ParkingBlocker[] {
  const out: ParkingBlocker[] = [];
  for (const s of items) {
    const r = ((s.rot ?? 0) * Math.PI) / 180;
    if (s.kind === 'crossing' && s.x != null && s.z != null) {
      // rot = yayaların yürüdüğü pusula yönü (0 = kuzey = −z)
      out.push(rect(s.x, s.z, [Math.sin(r), -Math.cos(r)], (s.len ?? 8) / 2 + 3, (s.w ?? 3) / 2 + 1));
    } else if (s.kind === 'bus-shelter' && s.x != null && s.z != null) {
      out.push(rect(s.x, s.z, [Math.cos(r), Math.sin(r)], (s.w ?? 4) / 2 + 1, 7));
    } else if (s.kind === 'island' && s.poly && s.poly.length >= 3) {
      out.push(s.poly);
    }
  }
  for (const g of gates) {
    if (g.kind !== 'vehicle') continue;
    const L = Math.hypot(g.n[0], g.n[1]) || 1;
    const n: P2 = [g.n[0] / L, g.n[1] / L];
    out.push(rect(g.c[0], g.c[1], [-n[1], n[0]], g.w / 2 + 0.5, 8));
  }
  return out;
}

/**
 * Ölçülmüş park şeritlerini araç listesine çevir: [x, y, z, yaw, tohum]* (ParkedCars verisi). Deterministik.
 * Yasak alana (blockers) değen yuva boş kalır.
 */
export function parkingCars(
  strips: readonly ParkingStrip[],
  H: (x: number, z: number) => number,
  blockers: readonly ParkingBlocker[] = [],
): number[] {
  const out: number[] = [];
  for (const st of strips) {
    const line = st.line;
    if (!line || line.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < line.length; i++)
      cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const len = cum[cum.length - 1];
    const parallel = st.mode === 'parallel';
    const pitch = Math.max(st.pitch ?? (parallel ? 5.4 : 2.6), 0.5);
    const n = Math.floor(len / pitch + 1e-6);
    if (n < 1) continue;
    const off = (len - n * pitch) / 2 + pitch / 2;
    const pointAt = (s: number): { p: P2; t: P2 } => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const a = line[i - 1];
      const b = line[i];
      const L = cum[i] - cum[i - 1] || 1;
      const f = (s - cum[i - 1]) / L;
      return {
        p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
        t: [(b[0] - a[0]) / L, (b[1] - a[1]) / L],
      };
    };
    const project = (q: P2): number => {
      let best = Infinity;
      let bs = 0;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const L2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2));
        const d = Math.hypot(a[0] + dx * u - q[0], a[1] + dz * u - q[1]);
        if (d < best) {
          best = d;
          bs = cum[i - 1] + Math.sqrt(L2) * u;
        }
      }
      return bs;
    };
    const occupied = new Array<boolean>(n).fill(false);
    if (st.at?.length) {
      for (const q of st.at) {
        const k0 = Math.max(0, Math.min(n - 1, Math.round((project(q) - off) / pitch)));
        for (const k of [k0, k0 + 1, k0 - 1]) {
          if (k >= 0 && k < n && !occupied[k]) {
            occupied[k] = true;
            break;
          }
        }
      }
    } else {
      const occ = st.occupancy ?? 0;
      const h0 = hashStr(st.id);
      for (let k = 0; k < n; k++) {
        const h = Math.imul(h0 ^ (k * 2654435761), 2246822519) >>> 0;
        occupied[k] = (h % 1000) / 1000 < occ;
      }
    }
    const ang = ((st.angle ?? 60) * Math.PI) / 180;
    const sgn = st.nose === 'left' ? -1 : 1;
    for (let k = 0; k < n; k++) {
      if (!occupied[k]) continue;
      const { p, t } = pointAt(off + k * pitch);
      // sağ normal (hat yönüne bakınca sağ): (−t.z, t.x)
      const side: P2 = [-t[1] * sgn, t[0] * sgn];
      let f: P2;
      if (parallel) f = st.nose === 'back' ? [-t[0], -t[1]] : t;
      else if (st.mode === 'perpendicular') f = side;
      else
        f = [t[0] * Math.cos(ang) + side[0] * Math.sin(ang), t[1] * Math.cos(ang) + side[1] * Math.sin(ang)];
      const box = rect(p[0], p[1], f, PARK_HALF_L, PARK_HALF_W);
      if (blockers.some((b) => ringsOverlap(box, b))) continue;
      const seed = (hashStr(`${st.id}#${k}`) % 997) + 1;
      // Hafif (±1°) deterministik yamukluk — elle park edilmiş görünüm
      const yaw = Math.atan2(f[0], f[1]) + (((seed % 7) - 3) * Math.PI) / 540;
      out.push(p[0], H(p[0], p[1]) + 0.06, p[1], yaw, seed);
    }
  }
  return out;
}
