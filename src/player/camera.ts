import * as THREE from 'three';
import type { ICollisionWorld } from './colliders';

const DEG = Math.PI / 180;

/** 3. şahıs omuz üstü takip kamerası + 1. şahıs geçişi. */
export class FollowCamera {
  yaw = 0;
  /** Yukarı bakış açısı (radyan): −60°..+40°. */
  pitch = -12 * DEG;
  distance = 4.5;
  height = 1.8;
  shoulder = 0.45;
  eyeHeight = 1.65;
  firstPerson = false;
  sensitivity = 0.0025;
  private currentDist = 4.5;
  private readonly smoothTarget = new THREE.Vector3();
  private initialized = false;
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpFrom = new THREE.Vector3();

  constructor(public readonly camera: THREE.PerspectiveCamera) {}

  look(dx: number, dy: number, scale = 1): void {
    this.yaw -= dx * this.sensitivity * scale;
    this.pitch -= dy * this.sensitivity * scale;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -60 * DEG, 40 * DEG);
  }

  toggleMode(): void {
    this.firstPerson = !this.firstPerson;
  }

  snap(): void {
    this.initialized = false;
  }

  update(feet: THREE.Vector3, dt: number, world: ICollisionWorld | null): void {
    const cam = this.camera;
    const cp = Math.cos(this.pitch);
    // bakış yönü
    const fx = -Math.sin(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;

    if (this.firstPerson) {
      cam.position.set(feet.x, feet.y + this.eyeHeight, feet.z);
      cam.lookAt(cam.position.x + fx, cam.position.y + fy, cam.position.z + fz);
      this.initialized = false;
      return;
    }

    const target = new THREE.Vector3(feet.x, feet.y + this.height - 0.2, feet.z);
    if (!this.initialized) {
      this.smoothTarget.copy(target);
      this.currentDist = this.distance;
      this.initialized = true;
    } else {
      // Dikeyde yumuşat (basamak/zıplama sarsıntısı), yatayda sıkı takip.
      this.smoothTarget.x = target.x;
      this.smoothTarget.z = target.z;
      this.smoothTarget.y += (target.y - this.smoothTarget.y) * (1 - Math.exp(-10 * dt));
    }
    // sağ vektör
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const pivot = this.tmpFrom.set(
      this.smoothTarget.x + rx * this.shoulder,
      this.smoothTarget.y,
      this.smoothTarget.z + rz * this.shoulder,
    );
    const back = this.tmpDir.set(-fx, -fy, -fz).normalize();

    // Kamera ile karakter arasına raycast → duvar arkasına girmesin.
    let want = this.distance;
    if (world) {
      const hit = world.raycast(pivot, back, this.distance + 0.3);
      if (hit !== null) want = Math.max(0.4, hit - 0.3);
    }
    // Engel varsa hemen içeri, açılınca yavaşça dışarı.
    if (want < this.currentDist) this.currentDist = want;
    else this.currentDist += (want - this.currentDist) * (1 - Math.exp(-4 * dt));
    cam.position.set(
      pivot.x + back.x * this.currentDist,
      pivot.y + back.y * this.currentDist,
      pivot.z + back.z * this.currentDist,
    );
    cam.lookAt(pivot.x + fx, pivot.y + fy, pivot.z + fz);
  }
}
