import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Deterministik gürültü (konuma bağlı) */
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function colorize(
  g: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number) => THREE.Color,
): THREE.BufferGeometry {
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i));
    arr.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Pürüzlü yaprak kümesi: yumuşak normalli, içe doğru koyulaşan renk. */
function blob(
  r: number,
  cx: number,
  cy: number,
  cz: number,
  sy: number,
  leaf: THREE.Color,
  seed: number,
): THREE.BufferGeometry {
  // KARAR: detay 0 (20 yüz) + yumuşak normal + pürüz; yakın mesafe binlerce ağaç için hafif
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 0);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.82 + 0.3 * hash3(x + seed, y, z);
    p.setXYZ(i, x * k + cx, y * k * sy + cy, z * k + cz);
  }
  g.computeVertexNormals();
  const top = cy + r * sy;
  const bottom = cy - r * sy;
  const c = new THREE.Color();
  return colorize(g, (x, y, z) => {
    const h = (y - bottom) / (top - bottom); // 0 alt … 1 üst
    const n = hash3(x * 3.1, y * 2.7, z * 1.9);
    // Alt ve iç kısımlar gölgede (sahte ortam gölgelemesi), üst güneşli
    return c.copy(leaf).multiplyScalar((0.55 + 0.5 * h) * (0.85 + 0.3 * n));
  });
}

function trunk(h: number, r0: number, r1: number, col: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, 5, 1, true).translate(0, h / 2, 0);
  g.deleteAttribute('uv');
  return colorize(g, (_x, y) => col.clone().multiplyScalar(0.7 + 0.3 * (y / h)));
}

/** Yakın mesafe için ayrıntılı ağaçlar: [yapraklı (çınar/ıhlamur), selvi, kavak/fıstık çamı]. */
export function createDetailedTrees(): THREE.BufferGeometry[] {
  const bark = new THREE.Color(0x5d4634);
  const leafA = new THREE.Color(0x4d7a33);
  const leafB = new THREE.Color(0x2c5530);
  const leafC = new THREE.Color(0x5f8a3a);
  const round = mergeGeometries([
    trunk(3.2, 0.24, 0.15, bark),
    blob(1.9, 0, 4.6, 0, 0.85, leafA, 1),
    blob(1.5, 1.3, 4.1, 0.4, 0.8, leafA, 2),
    blob(1.5, -1.1, 4.3, -0.6, 0.8, leafA, 3),
    blob(1.3, 0.2, 5.6, -0.3, 0.8, leafA, 4),
    blob(1.3, 0.4, 4.2, -1.3, 0.8, leafA, 10),
    blob(1.2, -0.5, 4.0, 1.2, 0.8, leafA, 11),
  ]);
  const cypress = mergeGeometries([
    trunk(1.2, 0.16, 0.1, bark),
    blob(1.0, 0, 3.0, 0, 2.1, leafB, 5),
    blob(0.75, 0, 5.8, 0, 2.0, leafB, 6),
  ]);
  const tall = mergeGeometries([
    trunk(2.6, 0.2, 0.12, bark),
    blob(1.5, 0, 4.6, 0, 1.5, leafC, 7),
    blob(1.2, 0.5, 6.4, 0.2, 1.3, leafC, 8),
    blob(1.1, -0.4, 3.6, 0.3, 1.2, leafC, 9),
  ]);
  for (const g of [round, cypress, tall]) g.computeBoundingSphere();
  return [round, cypress, tall];
}
