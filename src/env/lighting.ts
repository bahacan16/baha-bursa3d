import * as THREE from 'three';
import type { Quality, TimeOfDay } from '../core/settings';

export interface LightRig {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Gölge kamerasını oyuncuya göre konumlar (±60 m). */
  follow(target: THREE.Vector3, sunDir: THREE.Vector3): void;
  setTime(t: TimeOfDay): void;
}

const SHADOW_EXTENT = 60;

export function createLighting(scene: THREE.Scene, quality: Quality): LightRig {
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6250, 1.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  // KARAR: Düşük kalitede gölge kapalı (mobil performans).
  sun.castShadow = quality !== 'low';
  const size = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(size, size);
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_EXTENT;
  cam.right = SHADOW_EXTENT;
  cam.top = SHADOW_EXTENT;
  cam.bottom = -SHADOW_EXTENT;
  cam.near = 1;
  cam.far = 400;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  const texel = (SHADOW_EXTENT * 2) / size;
  const follow = (target: THREE.Vector3, sunDir: THREE.Vector3) => {
    // Titremeyi önlemek için gölge merkezini texel ızgarasına oturt.
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    sun.target.position.set(tx, target.y, tz);
    const d = sunDir.y > 0.05 ? sunDir : new THREE.Vector3(0.3, 0.6, 0.3).normalize();
    sun.position.set(tx + d.x * 200, target.y + d.y * 200, tz + d.z * 200);
  };

  const setTime = (t: TimeOfDay) => {
    if (t === 'day') {
      sun.intensity = 2.6;
      sun.color.set(0xfff2dd);
      hemi.intensity = 1.2;
      hemi.color.set(0xcfe3ff);
    } else if (t === 'sunset') {
      sun.intensity = 1.6;
      sun.color.set(0xffb070);
      hemi.intensity = 0.7;
      hemi.color.set(0xffd0b0);
    } else {
      sun.intensity = 0.25;
      sun.color.set(0x8aa0ff);
      hemi.intensity = 0.25;
      hemi.color.set(0x445577);
    }
  };
  return { sun, hemi, follow, setTime };
}
