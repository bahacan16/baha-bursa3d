import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Daylight } from './daylight';

export interface SkyRig {
  sky: Sky;
  sunDir: THREE.Vector3;
  apply(d: Daylight): void;
  stars: THREE.Points;
}

export function createSky(scene: THREE.Scene): SkyRig {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  sky.name = 'sky';
  scene.add(sky);
  const sunDir = new THREE.Vector3(0.3, 0.7, 0.3).normalize();
  const u = sky.material.uniforms;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  if (u.cloudCoverage) u.cloudCoverage.value = 0.3;
  // Gece: yıldızlar (sabit tohumlu), ufka doğru sönük
  const starGeo = new THREE.BufferGeometry();
  const sp: number[] = [];
  let seed = 7;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 1800; i++) {
    const u = r() * 2 - 1;
    const th = r() * Math.PI * 2;
    const y = Math.abs(u) * 0.95 + 0.05;
    const rr = Math.sqrt(1 - y * y);
    sp.push(Math.cos(th) * rr * 15000, y * 15000, Math.sin(th) * rr * 15000);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.6,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = 'stars';
  stars.renderOrder = 1;
  scene.add(stars);

  const apply = (d: Daylight) => {
    starMat.opacity = Math.max(0, d.night - 0.3) * 1.2;
    stars.visible = d.night > 0.3;
    // Güneş ufkun çok altındayken Sky shader'ı siyahlaşır: koyu lacivert arka plan kullan
    sky.visible = d.night < 0.97;
    sunDir.copy(d.sunDir);
    u.sunPosition.value.copy(d.sunDir);
    u.turbidity.value = d.turbidity;
    u.rayleigh.value = d.rayleigh;
  };
  return { sky, sunDir, apply, stars };
}
