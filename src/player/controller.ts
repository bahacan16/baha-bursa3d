import * as THREE from 'three';
import type { ICollisionWorld } from './colliders';

export interface ControllerInput {
  /** Kamera yönüne göre: x sağ, y ileri. */
  moveX: number;
  moveY: number;
  run: boolean;
  jump: boolean;
  /** Kamera yaw'ı (radyan). 0 = kuzeye (−Z) bakış. */
  cameraYaw: number;
}

export interface ControllerConfig {
  radius: number;
  walkSpeed: number;
  runSpeed: number;
  gravity: number;
  jumpHeight: number;
  stepHeight: number;
  /** Oynanabilir alan yarıçapı (merkezden), yumuşak duvar. */
  boundaryRadius: number;
}

export const DEFAULT_CONTROLLER: ControllerConfig = {
  radius: 0.35,
  walkSpeed: 1.6,
  runSpeed: 5.5,
  gravity: 9.81,
  jumpHeight: 1,
  stepHeight: 0.35,
  boundaryRadius: 1000,
};

/** Kinematik karakter kontrolcüsü — moddan bağımsız, yalnızca ICollisionWorld kullanır. */
export class CharacterController {
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Karakterin baktığı yön (yaw, radyan). 0 = −Z. */
  heading = 0;
  onGround = false;
  /** Zemin verisi yoksa true — hareket ve yerçekimi durur. */
  frozen = false;
  /** Harici dondurma (spawn/yükleme). */
  hold = false;
  jumpedThisStep = false;
  cfg: ControllerConfig;

  constructor(
    public world: ICollisionWorld,
    cfg: Partial<ControllerConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_CONTROLLER, ...cfg };
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
  }

  /** "Hayalet adım": çarpışmasız, bakış yönünde 1 m ileri. */
  ghostStep(): void {
    this.position.x += -Math.sin(this.heading);
    this.position.z += -Math.cos(this.heading);
    this.clampBoundary();
    const g = this.world.groundHeight(this.position.x, this.position.z, this.position.y + 2);
    if (g !== null) this.position.y = g;
  }

  update(dt: number, inp: ControllerInput): void {
    this.prevPosition.copy(this.position);
    this.jumpedThisStep = false;
    const c = this.cfg;
    const p = this.position;

    if (this.hold) {
      this.velocity.set(0, 0, 0);
      return;
    }
    const g0 = this.world.groundHeight(p.x, p.z, p.y);
    if (g0 === null) {
      // Altında zemin verisi yok → düşürme, dondur.
      this.frozen = true;
      this.velocity.set(0, 0, 0);
      return;
    }
    this.frozen = false;

    // Kamera göreli hedef hız
    const sin = Math.sin(inp.cameraYaw);
    const cos = Math.cos(inp.cameraYaw);
    // ileri = (−sin, −cos), sağ = (cos, −sin)
    const wx = -sin * inp.moveY + cos * inp.moveX;
    const wz = -cos * inp.moveY - sin * inp.moveX;
    const mag = Math.min(1, Math.hypot(inp.moveX, inp.moveY));
    let tx = 0;
    let tz = 0;
    if (mag > 0.05) {
      // Joystick'te yürüme hızı itme miktarıyla ölçeklenir.
      const speed = inp.run ? c.runSpeed : c.walkSpeed * Math.min(1, mag * 1.25);
      const l = Math.hypot(wx, wz);
      tx = (wx / l) * speed;
      tz = (wz / l) * speed;
    }
    const k = this.onGround ? 10 : 2.5;
    const a = 1 - Math.exp(-k * dt);
    this.velocity.x += (tx - this.velocity.x) * a;
    this.velocity.z += (tz - this.velocity.z) * a;

    // Yön: hareket yönüne yumuşak dönüş
    const hs = this.horizontalSpeed;
    if (hs > 0.2 && mag > 0.05) {
      const target = Math.atan2(-this.velocity.x, -this.velocity.z);
      let d = target - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * (1 - Math.exp(-12 * dt));
    }

    // Zıplama + yerçekimi
    if (inp.jump && this.onGround) {
      this.velocity.y = Math.sqrt(2 * c.gravity * c.jumpHeight);
      this.onGround = false;
      this.jumpedThisStep = true;
    }
    this.velocity.y -= c.gravity * dt;

    // Yatay hareket (kaymalı)
    const oldX = p.x;
    const oldZ = p.z;
    this.world.moveHorizontal(p, this.velocity.x * dt, this.velocity.z * dt, c.radius);
    // Basamak kontrolü: yeni noktada zemin çok yüksekse geri al
    const gNew = this.world.groundHeight(p.x, p.z, p.y);
    if (gNew === null) {
      p.x = oldX;
      p.z = oldZ;
    } else if (gNew - p.y > c.stepHeight) {
      p.x = oldX;
      p.z = oldZ;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    this.clampBoundary();

    // Dikey
    p.y += this.velocity.y * dt;
    const g = this.world.groundHeight(p.x, p.z, p.y + c.stepHeight) ?? g0;
    const snap = this.onGround && this.velocity.y <= 0 ? c.stepHeight : 0;
    if (p.y <= g + snap && this.velocity.y <= 0) {
      p.y = g;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
  }

  private clampBoundary(): void {
    const p = this.position;
    const r = Math.hypot(p.x, p.z);
    const R = this.cfg.boundaryRadius;
    if (r > R) {
      p.x *= R / r;
      p.z *= R / r;
      // Dışa doğru hız bileşenini sıfırla
      const nx = p.x / R;
      const nz = p.z / R;
      const vn = this.velocity.x * nx + this.velocity.z * nz;
      if (vn > 0) {
        this.velocity.x -= vn * nx;
        this.velocity.z -= vn * nz;
      }
    }
  }
}
