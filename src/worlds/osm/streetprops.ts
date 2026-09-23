import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropsPayload } from './props';
import type { Quality } from '../../core/settings';

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  data: Float32Array,
  cast: boolean,
): THREE.InstancedMesh | null {
  const n = data.length / 4;
  if (!n) return null;
  const im = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    q.setFromAxisAngle(up, data[i * 4 + 3]);
    m.compose(new THREE.Vector3(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]), q, one);
    im.setMatrixAt(i, m);
  }
  im.computeBoundingSphere();
  im.castShadow = cast;
  return im;
}

/** Sokak lambaları, banklar, duraklar + gece için oyuncu çevresinde birkaç gerçek ışık. */
export class StreetProps {
  readonly group = new THREE.Group();
  private headMat: THREE.MeshStandardMaterial;
  private lights: THREE.PointLight[] = [];
  private lampPos: Float32Array;
  private timer = 0;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(p: PropsPayload, quality: Quality) {
    this.group.name = 'street-props';
    this.lampPos = p.lamps;
    const shadows = quality !== 'low';
    // Lamba: direk + kol (+Z yola doğru) + başlık
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.11, 7, 6).translate(0, 3.5, 0),
      box(0.08, 0.08, 1.6, 0, 6.9, 0.75),
    ]);
    const head = box(0.35, 0.14, 0.6, 0, 6.82, 1.5);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5f6468, roughness: 0.6, metalness: 0.4 });
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0xdedbd0,
      emissive: 0xffc27a,
      emissiveIntensity: 0,
      roughness: 0.4,
    });
    // Bank (+Z yola dönük oturma)
    const bench = mergeGeometries([
      box(1.8, 0.06, 0.45, 0, 0.45, 0),
      box(1.8, 0.4, 0.05, 0, 0.72, -0.22),
      box(0.06, 0.45, 0.4, -0.8, 0.22, 0),
      box(0.06, 0.45, 0.4, 0.8, 0.22, 0),
    ]);
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.8 });
    // Durak: çatı + arka cam + direkler
    const shelterFrame = mergeGeometries([
      box(3.6, 0.12, 1.6, 0, 2.5, 0),
      box(0.08, 2.5, 0.08, -1.75, 1.25, -0.7),
      box(0.08, 2.5, 0.08, 1.75, 1.25, -0.7),
      box(3.2, 0.06, 0.4, 0, 0.45, -0.5),
    ]);
    const shelterGlass = box(3.5, 2.0, 0.03, 0, 1.4, -0.75);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3c4a55, roughness: 0.5, metalness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fb7c4,
      roughness: 0.1,
      transparent: true,
      opacity: 0.35,
    });
    this.geos.push(pole, head, bench, shelterFrame, shelterGlass);
    this.mats.push(poleMat, this.headMat, benchMat, frameMat, glassMat);
    for (const im of [
      instanced(pole, poleMat, p.lamps, shadows),
      instanced(head, this.headMat, p.lamps, false),
      instanced(bench, benchMat, p.benches, shadows),
      instanced(shelterFrame, frameMat, p.shelters, shadows),
      instanced(shelterGlass, glassMat, p.shelters, false),
    ])
      if (im) this.group.add(im);

    const count = quality === 'high' ? 8 : quality === 'medium' ? 4 : 0;
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffb866, 0, 32, 1.4);
      this.lights.push(l);
      this.group.add(l);
    }
  }

  get lampCount(): number {
    return this.lampPos.length / 4;
  }

  /** Lamba konumları (çarpışma için). */
  forEach(cb: (x: number, y: number, z: number) => void): void {
    for (let i = 0; i < this.lampPos.length; i += 4)
      cb(this.lampPos[i], this.lampPos[i + 1], this.lampPos[i + 2]);
  }

  update(player: THREE.Vector3, night: number, dt: number): void {
    this.headMat.emissiveIntensity = night * 4;
    if (!this.lights.length) return;
    this.timer -= dt;
    if (this.timer > 0 && night > 0) {
      for (const l of this.lights) l.intensity = night * 120;
      return;
    }
    this.timer = 0.5;
    if (night <= 0.01) {
      for (const l of this.lights) l.intensity = 0;
      return;
    }
    // En yakın K lamba
    const P = this.lampPos;
    const best: { d: number; i: number }[] = [];
    for (let i = 0; i < P.length; i += 4) {
      const d = (P[i] - player.x) ** 2 + (P[i + 2] - player.z) ** 2;
      if (best.length < this.lights.length) best.push({ d, i });
      else {
        let w = 0;
        for (let k = 1; k < best.length; k++) if (best[k].d > best[w].d) w = k;
        if (d < best[w].d) best[w] = { d, i };
      }
    }
    this.lights.forEach((l, k) => {
      const b = best[k];
      if (!b) {
        l.intensity = 0;
        return;
      }
      const yaw = P[b.i + 3];
      l.position.set(P[b.i] + Math.sin(yaw) * 1.5, P[b.i + 1] + 6.6, P[b.i + 2] + Math.cos(yaw) * 1.5);
      l.intensity = night * 120;
    });
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
