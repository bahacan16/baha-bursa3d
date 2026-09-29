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
  /** 3. şahıs dikey görüş açısı (spec); 1. şahısta insan gözüne/telefon kamerasına yakın daha dar açı. */
  fovThird = 62;
  // KARAR: 1. şahıs 55° dikey (16:9'da ≈ 85° yatay). 62° sokakları olduğundan geniş/derin gösteriyordu (geniş açı
  // bozulması); telefonun ana kamerası ≈ 50° dikey, Street View karesi 90°. Geçiş 0.35 s yumuşak.
  fovFirst = 55;
  /** Yürürken baş salınımı (yalnız 1. şahıs). 0 = kapalı. */
  bob = 1;
  private readonly lastFeet = new THREE.Vector3(NaN, 0, 0);
  private stepPhase = 0;
  private bobAmp = 0;

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

    // Görüş açısı: moda göre yumuşak geçiş
    const wantFov = this.firstPerson ? this.fovFirst : this.fovThird;
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov += (wantFov - cam.fov) * (1 - Math.exp(-dt / 0.12));
      if (Math.abs(cam.fov - wantFov) < 0.02) cam.fov = wantFov;
      cam.updateProjectionMatrix();
    }
    // Adım evresi: yatay yol / adım boyu. Yürüyüş ≈ 0.72 m, koşu ≈ 1.25 m adım (insan yürüyüş ölçümleri).
    let speed = 0;
    if (Number.isFinite(this.lastFeet.x) && dt > 0) {
      const d = Math.hypot(feet.x - this.lastFeet.x, feet.z - this.lastFeet.z);
      if (d < 3) {
        speed = d / dt;
        const stride = THREE.MathUtils.lerp(0.72, 1.25, THREE.MathUtils.clamp((speed - 1.6) / 3.9, 0, 1));
        this.stepPhase += d / stride;
      }
    }
    this.lastFeet.copy(feet);

    if (this.firstPerson) {
      // Baş salınımı: adım başına bir dikey çukur (topuk vuruşu), iki adımda bir yanal salınım. Gerçekte ~4–5 cm
      // tepe-tepe; ekranda mide bulandırmasın diye yürüyüşte ~1.6 cm, koşuda ~3.2 cm (KARAR).
      const target = speed < 0.2 ? 0 : THREE.MathUtils.clamp(speed / 5.5, 0.35, 1);
      this.bobAmp += (target - this.bobAmp) * (1 - Math.exp(-6 * dt));
      const a = this.bobAmp * this.bob;
      const ph = this.stepPhase * Math.PI;
      // Topuk vuruşunda (evre tam sayı) en alçak, tek ayak basışının ortasında en yüksek
      const up = 0.032 * a * Math.abs(Math.sin(ph)) - 0.016 * a;
      const side = 0.012 * a * Math.sin(ph);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      cam.position.set(feet.x + rx * side, feet.y + this.eyeHeight + up, feet.z + rz * side);
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
