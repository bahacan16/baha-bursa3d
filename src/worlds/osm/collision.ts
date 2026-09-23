import type * as THREE from 'three';
import type { ICollisionWorld } from '../../player/colliders';

/** x/z düzleminde dikey duvar parçası. */
export interface WallSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Duvarın üst kotu (kamera raycast'i için). */
  top: number;
  /** Duvarın alt kotu. */
  bottom: number;
}

/** Zemin yüksekliği sağlayıcı (Faz 2: kaldırım, Faz 5: arazi). */
export type GroundFn = (x: number, z: number, feetY: number) => number | null;

const CELL = 10;
const MAX_ITER = 3;

/**
 * 2D poligon kenarlarına dayalı çarpışma dünyası (Mod B ve test kutuları).
 * Uniform grid (10 m hücre) ile kenar araması; çember–doğru parçası itme, kaymalı hareket.
 */
export class PolygonCollisionWorld implements ICollisionWorld {
  private readonly segs: WallSegment[] = [];
  private readonly grid = new Map<number, number[]>();
  private stamp: Uint32Array = new Uint32Array(0);
  private stampId = 0;
  ground: GroundFn = () => 0;
  /** Hareketli engeller (yayalar, araçlar): her karede güncellenen daireler [x, z, r]. */
  dynamic: number[] = [];

  get segmentCount(): number {
    return this.segs.length;
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  addSegment(s: WallSegment): void {
    const idx = this.segs.length;
    this.segs.push(s);
    const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL);
    const x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
    const z0 = Math.floor(Math.min(s.az, s.bz) / CELL);
    const z1 = Math.floor(Math.max(s.az, s.bz) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(idx);
      }
    }
  }

  /** Kapalı halka (son nokta ilkini tekrar etmek zorunda değil). */
  addRing(ring: ArrayLike<number>[] | [number, number][], bottom = 0, top = 1000): void {
    const n = ring.length;
    if (n < 2) return;
    const closed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
    const m = closed ? n - 1 : n;
    for (let i = 0; i < m; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      this.addSegment({ ax: a[0], az: a[1], bx: b[0], bz: b[1], bottom, top });
    }
  }

  /** Açık çizgi (duvar/çit). */
  addPolyline(line: ArrayLike<number>[], bottom = 0, top = 1000): void {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      this.addSegment({ ax: a[0], az: a[1], bx: b[0], bz: b[1], bottom, top });
    }
  }

  addBox(cx: number, cz: number, w: number, d: number, h = 1000, base = 0): void {
    const hw = w / 2;
    const hd = d / 2;
    this.addRing(
      [
        [cx - hw, cz - hd],
        [cx + hw, cz - hd],
        [cx + hw, cz + hd],
        [cx - hw, cz + hd],
      ],
      base,
      base + h,
    );
  }

  /** Bir AABB ile kesişen hücrelerdeki (tekrarsız) segment indeksleri. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[] {
    out.length = 0;
    if (this.stamp.length < this.segs.length) this.stamp = new Uint32Array(this.segs.length * 2);
    this.stampId = (this.stampId + 1) >>> 0;
    if (this.stampId === 0) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.grid.get(this.key(cx, cz));
        if (!arr) continue;
        for (const i of arr) {
          if (this.stamp[i] === this.stampId) continue;
          this.stamp[i] = this.stampId;
          out.push(i);
        }
      }
    }
    return out;
  }

  private tmp: number[] = [];

  moveHorizontal(pos: THREE.Vector3, dx: number, dz: number, radius: number): void {
    const len = Math.hypot(dx, dz);
    // Tünellemeyi önlemek için büyük adımları böl.
    const steps = Math.max(1, Math.ceil(len / (radius * 0.5)));
    for (let s = 0; s < steps; s++) {
      pos.x += dx / steps;
      pos.z += dz / steps;
      this.resolve(pos, radius);
    }
  }

  /** Çember içindeki segmentlerden dışarı it; en yakın önce, en fazla 3 iterasyon. */
  resolve(pos: { x: number; z: number; y?: number }, radius: number): void {
    const feet = pos.y ?? 0;
    for (let it = 0; it < MAX_ITER; it++) {
      const cand = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, this.tmp);
      let best = -1;
      let bestD = radius;
      let bnx = 0;
      let bnz = 0;
      for (const i of cand) {
        const s = this.segs[i];
        if (feet >= s.top - 0.05 || feet + 1.7 < s.bottom) continue;
        const ex = s.bx - s.ax;
        const ez = s.bz - s.az;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((pos.x - s.ax) * ex + (pos.z - s.az) * ez) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = s.ax + ex * t;
        const qz = s.az + ez * t;
        let nx = pos.x - qx;
        let nz = pos.z - qz;
        const d = Math.hypot(nx, nz);
        if (d < bestD) {
          if (d > 1e-6) {
            nx /= d;
            nz /= d;
          } else {
            // Tam çizgi üzerinde: segment normalini kullan.
            const el = Math.sqrt(l2) || 1;
            nx = -ez / el;
            nz = ex / el;
          }
          bestD = d;
          best = i;
          bnx = nx;
          bnz = nz;
        }
      }
      // Hareketli engeller
      const D = this.dynamic;
      for (let k = 0; k < D.length; k += 3) {
        const dx = pos.x - D[k];
        const dz = pos.z - D[k + 1];
        const rr = radius + D[k + 2];
        const d = Math.hypot(dx, dz);
        if (d < rr && rr - d > radius - bestD) {
          best = -2;
          bestD = radius - (rr - d);
          bnx = d > 1e-6 ? dx / d : 1;
          bnz = d > 1e-6 ? dz / d : 0;
        }
      }
      if (best === -1) return;
      const push = radius - bestD + 1e-4;
      pos.x += bnx * push;
      pos.z += bnz * push;
    }
  }

  groundHeight(x: number, z: number, feetY: number): number | null {
    return this.ground(x, z, feetY);
  }

  raycast(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    const ex = from.x + dir.x * maxDist;
    const ez = from.z + dir.z * maxDist;
    const cand = this.query(
      Math.min(from.x, ex),
      Math.min(from.z, ez),
      Math.max(from.x, ex),
      Math.max(from.z, ez),
      this.tmp,
    );
    let best: number | null = null;
    const rx = dir.x * maxDist;
    const rz = dir.z * maxDist;
    for (const i of cand) {
      const s = this.segs[i];
      const sx = s.bx - s.ax;
      const sz = s.bz - s.az;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const qx = s.ax - from.x;
      const qz = s.az - from.z;
      const t = (qx * sz - qz * sx) / den;
      const u = (qx * rz - qz * rx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const y = from.y + dir.y * maxDist * t;
      if (y > s.top || y < s.bottom) continue;
      const d = t * maxDist;
      if (best === null || d < best) best = d;
    }
    // Zemin düzlemi
    if (dir.y < -1e-6) {
      const g = this.ground(from.x, from.z, from.y) ?? 0;
      const t = (g + 0.05 - from.y) / dir.y;
      if (t >= 0 && t <= maxDist && (best === null || t < best)) best = t;
    }
    return best;
  }
}
