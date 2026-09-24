import * as THREE from 'three';
import { CAR_COLORS, createCarGeometries } from './carmodel';
import type { Quality } from '../core/settings';

/** Park etmiş araçlar (statik, instanced). Veri: [x, y, z, yaw, renk]* */
export class ParkedCars {
  readonly group = new THREE.Group();
  private geos: THREE.BufferGeometry[];
  private mats: THREE.Material[];
  readonly count: number;
  private meshes: THREE.InstancedMesh[] = [];
  private timer = 0;
  private visibleMax: number;

  constructor(
    readonly data: Float32Array,
    quality: Quality,
  ) {
    this.group.name = 'parked-cars';
    const g = createCarGeometries();
    this.geos = [g.body, g.glass, g.wheels];
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.08, metalness: 0.7 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
    this.mats = [bodyMat, glassMat, wheelMat];
    const n = (this.count = data.length / 5);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    // KARAR: Binlerce park eden araç var; yalnızca oyuncuya yakın olanlar çizilir (çarpışma hepsinde).
    this.visibleMax = quality === 'high' ? 700 : quality === 'medium' ? 400 : 150;
    const cap = Math.max(1, Math.min(n, this.visibleMax));
    const meshes = (this.meshes = [
      new THREE.InstancedMesh(g.body, bodyMat, cap),
      new THREE.InstancedMesh(g.glass, glassMat, cap),
      new THREE.InstancedMesh(g.wheels, wheelMat, cap),
    ]);
    void m;
    void q;
    void up;
    void one;
    void col;
    for (const im of meshes) {
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = quality !== 'low' && im === meshes[0];
      this.group.add(im);
    }
  }

  private mm = new THREE.Matrix4();
  private qq = new THREE.Quaternion();
  private vv = new THREE.Vector3();
  private cc = new THREE.Color();
  private ones = new THREE.Vector3(1, 1, 1);
  private upv = new THREE.Vector3(0, 1, 0);

  /** Oyuncu çevresindeki en yakın araçları seç (0.5 sn'de bir). */
  update(player: THREE.Vector3, dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const d = this.data;
    const R2 = 240 * 240;
    let k = 0;
    for (let i = 0; i < this.count && k < this.visibleMax; i++) {
      const dx = d[i * 5] - player.x;
      const dz = d[i * 5 + 2] - player.z;
      if (dx * dx + dz * dz > R2) continue;
      this.qq.setFromAxisAngle(this.upv, d[i * 5 + 3]);
      this.mm.compose(this.vv.set(d[i * 5], d[i * 5 + 1], d[i * 5 + 2]), this.qq, this.ones);
      for (const im of this.meshes) im.setMatrixAt(k, this.mm);
      this.meshes[0].setColorAt(k, this.cc.set(CAR_COLORS[d[i * 5 + 4] % CAR_COLORS.length]));
      k++;
    }
    for (const im of this.meshes) {
      im.count = k;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** Çarpışma kutuları için: her araç iki daire yerine yönlendirilmiş kutu köşeleri. */
  forEachBox(cb: (corners: [number, number][], y: number) => void): void {
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      const x = d[i * 5];
      const z = d[i * 5 + 2];
      const yaw = d[i * 5 + 3];
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = fz;
      const rz = -fx;
      const L = 2.2;
      const W = 0.9;
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
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
