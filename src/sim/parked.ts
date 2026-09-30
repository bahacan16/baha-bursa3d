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
