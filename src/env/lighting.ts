import * as THREE from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import type { Quality } from '../core/settings';
import type { Daylight } from './daylight';

export interface LightRig {
  sun: THREE.Light;
  hemi: THREE.HemisphereLight;
  /** Gölge kamerasını oyuncuya göre konumlar (±60 m). */
  follow(target: THREE.Vector3, sunDir: THREE.Vector3): void;
  apply(d: Daylight): void;
}

const SHADOW_EXTENT = 60;

export function createLighting(scene: THREE.Scene, quality: Quality, ultra = false): LightRig {
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6250, 1.2);
  scene.add(hemi);
  if (ultra) return createUltraSun(scene, hemi);

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
  sun.shadow.normalBias = 0.12;
  scene.add(sun);
  scene.add(sun.target);

  const texel = (SHADOW_EXTENT * 2) / size;
  const follow = (target: THREE.Vector3, sunDir: THREE.Vector3) => {
    // Titremeyi önlemek için gölge merkezini texel ızgarasına oturt.
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    sun.target.position.set(tx, target.y, tz);
    const d = sunDir.y > 0.08 ? sunDir : new THREE.Vector3(sunDir.x, 0.08, sunDir.z).normalize();
    sun.position.set(tx + d.x * 200, target.y + d.y * 200, tz + d.z * 200);
  };

  const apply = (d: Daylight) => {
    sun.intensity = d.sunIntensity;
    sun.color.copy(d.sunColor);
    hemi.intensity = d.hemiIntensity;
    hemi.color.copy(d.hemiSky);
    hemi.groundColor.copy(d.hemiGround);
  };
  return { sun, hemi, follow, apply };
}

/** Ultra gölge menzili (m): 2 kademe (≈0–100 m ve 100–450 m), kademe başına 4096². */
export const ULTRA_SHADOW_FAR = 450;

/**
 * Ultra güneşi: three SunLight (kademeli gölge haritası görüş frustumuna otomatik oturur, texel ızgarasına kilitli).
 * PCSS/bulut gölgesi `ultra.ts` gölgelendirici parçalarında; zaman ve bulut örtüsü kademe verisinin boş `w`
 * bileşeninden taşınır (malzeme başına uniform gerekmez).
 */
function createUltraSun(scene: THREE.Scene, hemi: THREE.HemisphereLight): LightRig {
  const sun = new SunLight(0xfff2dd, 2.6);
  sun.castShadow = true;
  const sh = sun.shadow;
  // ?shadow=2048: yazılım işleyicide karşılaştırma görüntüsü almak için
  const ms = Number(new URLSearchParams(location.search).get('shadow') ?? 4096);
  sh.mapSize.set(ms, ms);
  // radius = en büyük PCSS çekirdeği (texel) → kademe kenar payı (atlas komşusundan okumasın)
  sh.radius = 24;
  sh.bias = 0;
  sh.normalBias = 0; // normal ofseti gölgelendiricide kademe texel boyuna göre
  sh.camera.near = 1;
  sh.camera.far = ULTRA_SHADOW_FAR;
  const cd = (sh as unknown as { _cascadeData: THREE.Vector4[] })._cascadeData;
  const orig = sh.updateMatrices.bind(sh);
  const clock = { t: 0, cover: 0 };
  sh.updateMatrices = (light: THREE.Light, cam?: THREE.Camera) => {
    orig(light, cam);
    cd[0].w = clock.t;
    if (cd[1]) cd[1].w = clock.cover;
  };
  sun.userData.ultraClock = clock;
  scene.add(sun);
  const follow = (_target: THREE.Vector3, sunDir: THREE.Vector3) => {
    const d = sunDir.y > 0.08 ? sunDir : new THREE.Vector3(sunDir.x, 0.08, sunDir.z).normalize();
    sun.position.copy(d);
  };
  const apply = (d: Daylight) => {
    sun.intensity = d.sunIntensity;
    sun.color.copy(d.sunColor);
    hemi.intensity = d.hemiIntensity;
    hemi.color.copy(d.hemiSky);
    hemi.groundColor.copy(d.hemiGround);
  };
  return { sun, hemi, follow, apply };
}
