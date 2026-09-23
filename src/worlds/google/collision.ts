import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { ICollisionWorld } from '../../player/colliders';

// three-mesh-bvh: hızlandırılmış raycast
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const ACTIVE_RADIUS = 150;
const KNEE = 0.5;
const CHEST = 1.3;
const LOOKAHEAD = 0.5;
const MAX_WALKABLE_COS = Math.cos(THREE.MathUtils.degToRad(45));

interface Entry {
  mesh: THREE.Mesh;
  visible: boolean;
  bvh: boolean;
  sphere: THREE.Sphere;
}

/**
 * Google fotogrametri mesh'ine BVH raycast çarpışması.
 * Yalnızca oyuncuya 150 m içindeki görünür tile mesh'leri aktif listede tutulur; BVH tembel üretilir.
 */
export class TilesCollisionWorld implements ICollisionWorld {
  private entries = new Map<THREE.Object3D, Entry[]>();
  private active: THREE.Mesh[] = [];
  private ray = new THREE.Raycaster();
  private tmpV = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private center = new THREE.Vector3();
  /** Kalibrasyon ofseti yok; mesh zaten dünya koordinatında. */
  bvhBudgetPerUpdate = 2;
  ghost = false;

  constructor() {
    this.ray.firstHitOnly = true;
  }

  /** 'load-model' olayı */
  addModel(scene: THREE.Object3D): void {
    const list: Entry[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry)
        list.push({ mesh: m, visible: false, bvh: false, sphere: new THREE.Sphere() });
    });
    this.entries.set(scene, list);
  }

  /** 'dispose-model' olayı */
  removeModel(scene: THREE.Object3D): void {
    const list = this.entries.get(scene);
    if (!list) return;
    for (const e of list) if (e.bvh) e.mesh.geometry.disposeBoundsTree?.();
    this.entries.delete(scene);
    this.active = this.active.filter((m) => !list.some((e) => e.mesh === m));
  }

  /** 'tile-visibility-change' olayı */
  setVisible(scene: THREE.Object3D, visible: boolean): void {
    for (const e of this.entries.get(scene) ?? []) e.visible = visible;
  }

  get meshCount(): number {
    return this.active.length;
  }

  /** Aktif listeyi oyuncu çevresine göre yeniler (ör. 4 Hz). */
  refresh(player: THREE.Vector3, ignoreHeight = false): void {
    this.center.copy(player);
    const act: THREE.Mesh[] = [];
    let budget = this.bvhBudgetPerUpdate;
    for (const list of this.entries.values()) {
      for (const e of list) {
        if (!e.visible) continue;
        const g = e.mesh.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        e.mesh.updateWorldMatrix(true, false);
        e.sphere.copy(g.boundingSphere!).applyMatrix4(e.mesh.matrixWorld);
        const d = ignoreHeight
          ? Math.hypot(e.sphere.center.x - player.x, e.sphere.center.z - player.z) - e.sphere.radius
          : e.sphere.distanceToPoint(player);
        if (d > ACTIVE_RADIUS) continue;
        if (!e.bvh) {
          if (budget <= 0) continue;
          g.computeBoundsTree();
          e.bvh = true;
          budget--;
        }
        act.push(e.mesh);
      }
    }
    this.active = act;
  }

  private cast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Intersection | null {
    if (!this.active.length) return null;
    this.ray.set(origin, dir);
    this.ray.near = 0;
    this.ray.far = far;
    const hits = this.ray.intersectObjects(this.active, false);
    return hits.length ? hits[0] : null;
  }

  private worldNormal(hit: THREE.Intersection, out: THREE.Vector3): THREE.Vector3 {
    if (!hit.face) return out.set(0, 1, 0);
    return out.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  }

  moveHorizontal(pos: THREE.Vector3, dx: number, dz: number, radius: number): void {
    let mx = dx;
    let mz = dz;
    for (let iter = 0; iter < 2; iter++) {
      const len = Math.hypot(mx, mz);
      if (len < 1e-6) return;
      const dir = this.tmpD.set(mx / len, 0, mz / len);
      let block: THREE.Intersection | null = null;
      for (const h of [KNEE, CHEST]) {
        const o = this.tmpV.set(pos.x, pos.y + h, pos.z);
        const hit = this.cast(o, dir, len + radius + LOOKAHEAD * 0.5);
        if (hit && (!block || hit.distance < block.distance)) block = hit;
      }
      if (!block || block.distance > len + radius) {
        pos.x += mx;
        pos.z += mz;
        return;
      }
      const n = this.worldNormal(block, new THREE.Vector3());
      n.y = 0;
      if (n.lengthSq() < 1e-6) n.set(-dir.x, 0, -dir.z);
      n.normalize();
      // Duvara kadar ilerle, kalan hareketi yüzey boyunca kaydır
      const allowed = Math.max(0, block.distance - radius);
      pos.x += dir.x * allowed;
      pos.z += dir.z * allowed;
      const rem = len - allowed;
      const rx = dir.x * rem;
      const rz = dir.z * rem;
      const dot = rx * n.x + rz * n.z;
      mx = rx - dot * n.x;
      mz = rz - dot * n.z;
      // İçeri girmişse biraz geri it
      if (block.distance < radius) {
        pos.x += n.x * (radius - block.distance);
        pos.z += n.z * (radius - block.distance);
      }
    }
  }

  groundHeight(x: number, z: number, feetY: number): number | null {
    // Oyuncunun 2 m üstünden aşağı raycast → en yakın isabet = zemin.
    const hit = this.cast(this.tmpV.set(x, feetY + 2, z), this.tmpD.set(0, -1, 0), 60);
    if (!hit) return null;
    const n = this.worldNormal(hit, new THREE.Vector3());
    // Eğim > 45° ise duvar: basamak olarak kabul edilmesin (kontrolcü yükseklik farkıyla engeller)
    if (n.y < MAX_WALKABLE_COS && hit.point.y > feetY + 0.35) return hit.point.y + 10;
    return hit.point.y;
  }

  /** Spawn için: çok yüksekten aşağı tarama (tüm görünür mesh'ler, BVH olmadan da çalışır). */
  probe(x: number, z: number, fromY = 3000): number | null {
    const hit = this.cast(this.tmpV.set(x, fromY, z), this.tmpD.set(0, -1, 0), fromY + 2000);
    return hit ? hit.point.y : null;
  }

  raycast(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    const hit = this.cast(from, dir, maxDist);
    return hit ? hit.distance : null;
  }
}
