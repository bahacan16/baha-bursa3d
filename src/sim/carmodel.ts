import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Sedan yan silüeti (z: boy, y: yükseklik), +Z = ön. */
const PROFILE: [number, number][] = [
  [-2.22, 0.32],
  [-2.25, 0.72],
  [-2.15, 0.9],
  [-1.85, 0.96],
  [-1.3, 1.0],
  [-0.85, 1.4],
  [0.45, 1.43],
  [1.15, 1.0],
  [1.95, 0.88],
  [2.22, 0.74],
  [2.25, 0.4],
  [2.15, 0.3],
];
/** Cam kabin silüeti (tavanın biraz altında, bel çizgisinin üstünde) */
const CABIN: [number, number][] = [
  [-1.3, 1.02],
  [-0.86, 1.36],
  [0.44, 1.39],
  [1.12, 1.02],
];

function extrude(pts: [number, number][], width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  // Şekil XY düzleminde (x = boy); boyu Z'ye, genişliği X'e çevir
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

export interface CarGeometries {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  wheels: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
}

export function createCarGeometries(): CarGeometries {
  const body = extrude(PROFILE, 1.78, 0.06);
  // Cam: kabinden biraz geniş (yanlarda görünsün) ve biraz dışa taşan
  const glass = extrude(
    CABIN.map(([z, y]) => [z * 1.012, 1.02 + (y - 1.02) * 1.015] as [number, number]),
    1.8,
    0.02,
  );
  const wheelParts: THREE.BufferGeometry[] = [];
  for (const [x, z] of [
    [-0.8, 1.35],
    [0.8, 1.35],
    [-0.8, -1.38],
    [0.8, -1.38],
  ]) {
    wheelParts.push(
      new THREE.CylinderGeometry(0.32, 0.32, 0.22, 8).rotateZ(Math.PI / 2).translate(x, 0.32, z),
    );
  }
  const wheels = mergeGeometries(wheelParts);
  const lights = mergeGeometries([
    new THREE.BoxGeometry(0.38, 0.1, 0.04).translate(-0.58, 0.76, 2.23),
    new THREE.BoxGeometry(0.38, 0.1, 0.04).translate(0.58, 0.76, 2.23),
  ]);
  for (const g of [body, glass, wheels, lights]) g.computeVertexNormals();
  return { body, glass, wheels, lights };
}

export const CAR_COLORS = [
  0xf2f2f0, 0xe6e6e3, 0xd9d9d6, 0x1c1c1e, 0x2a2a2d, 0x8f969c, 0x6d7278, 0x5d6066, 0x9b1d20, 0x1f3f75,
  0x2b4f8a, 0xc9b27c, 0x2d4a36, 0x3a3a3c,
];
