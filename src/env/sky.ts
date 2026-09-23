import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { TimeOfDay } from '../core/settings';

export interface SkyRig {
  sky: Sky;
  sunDir: THREE.Vector3;
  setTime(t: TimeOfDay): void;
}

/** Güneş yükseklik/azimut (derece) — basit ön ayarlar. */
const PRESETS: Record<
  TimeOfDay,
  { elevation: number; azimuth: number; turbidity: number; rayleigh: number }
> = {
  day: { elevation: 48, azimuth: 200, turbidity: 3, rayleigh: 1.2 },
  sunset: { elevation: 3, azimuth: 250, turbidity: 8, rayleigh: 2.5 },
  night: { elevation: -8, azimuth: 250, turbidity: 1, rayleigh: 0.2 },
};

export function createSky(scene: THREE.Scene): SkyRig {
  const sky = new Sky();
  sky.scale.setScalar(20000);
  sky.name = 'sky';
  scene.add(sky);
  const sunDir = new THREE.Vector3();
  const u = sky.material.uniforms;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  if (u.cloudCoverage) u.cloudCoverage.value = 0.3;

  const setTime = (t: TimeOfDay) => {
    const p = PRESETS[t];
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    // azimut: 0 = kuzey (−Z), 90 = doğu (+X)
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    sunDir.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta));
    u.sunPosition.value.copy(sunDir);
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
  };
  setTime('day');
  return { sky, sunDir, setTime };
}
