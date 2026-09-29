import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SpeciesSize } from './species';

/**
 * Uzak LOD silüetleri: tür başına düşük poligonlu, köşe renkli şekil (ağaç başına ~100–300 üçgen). Tür silüeti
 * korunur (sedirde sarkık katlar, serviye sütun, palmiyede yıldız yaprak, top akasyada gövde üstünde küre).
 * Düşük kalitede tek model budur; orta/yüksekte yalnız orta LOD yarıçapının ötesinde çizilir.
 */
export interface FarShape {
  kind:
    | 'round'
    | 'oval'
    | 'dome'
    | 'globe'
    | 'irregular'
    | 'cone'
    | 'tiers'
    | 'column'
    | 'egg'
    | 'palm'
    | 'sapling';
  /** Taç ortalama rengi (sRGB) ve gövde rengi */
  leaf: number;
  bark: number;
  /** Tacın başladığı boy oranı */
  crownBase: number;
}

/** Deterministik gürültü (konuma bağlı) */
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function paint(
  g: THREE.BufferGeometry,
  col: THREE.Color,
  y0: number,
  y1: number,
  lo = 0.62,
  hi = 1.06,
): THREE.BufferGeometry {
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - y0) / Math.max(1e-3, y1 - y0), 0, 1);
    const n = 0.9 + 0.2 * hash3(p.getX(i) * 3.1, p.getY(i) * 2.7, p.getZ(i) * 1.9);
    const k = (lo + (hi - lo) * t) * n;
    arr.set([col.r * k, col.g * k, col.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Pürüzlü yumuşak küme (elipsoid) */
function blob(
  rx: number,
  ry: number,
  rz: number,
  cx: number,
  cy: number,
  cz: number,
  seed: number,
  detail = 1,
): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.84 + 0.28 * hash3(x + seed, y, z);
    p.setXYZ(i, x * k * rx + cx, y * k * ry + cy, z * k * rz + cz);
  }
  return g;
}

function cone(r: number, h: number, y0: number, seed: number, skirt = 0): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.ConeGeometry(r, h, 10, 3, false);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.88 + 0.22 * hash3(x + seed, y, z);
    // Etek: alt kenar dışa ve aşağı sarkar (sedir katı)
    const bottom = y < -h * 0.45 ? skirt : 0;
    p.setXYZ(i, x * k, y + h / 2 + y0 - bottom, z * k);
  }
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIdx = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let total = 0;
  for (const p of nonIdx) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of nonIdx) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function farTreeGeometry(s: FarShape, size: SpeciesSize): THREE.BufferGeometry {
  const H = size.h;
  const R = size.w / 2;
  const leaf = new THREE.Color(s.leaf);
  const bark = new THREE.Color(s.bark);
  const y0 = s.crownBase * H;
  const ch = H - y0;
  const parts: THREE.BufferGeometry[] = [];
  const trunkTop = Math.max(0.3, y0 + ch * 0.3);
  if (s.kind !== 'egg' && s.kind !== 'column') {
    const t = new THREE.CylinderGeometry(size.trunk * 0.6, size.trunk, trunkTop, 6, 1, true).translate(
      0,
      trunkTop / 2,
      0,
    );
    t.deleteAttribute('uv');
    parts.push(paint(t, bark, 0, trunkTop, 0.7, 1));
  }
  const add = (g: THREE.BufferGeometry) => parts.push(paint(g, leaf, y0, H));
  switch (s.kind) {
    case 'round':
      add(blob(R * 0.72, ch * 0.4, R * 0.72, 0, y0 + ch * 0.52, 0, 1));
      add(blob(R * 0.55, ch * 0.32, R * 0.55, R * 0.4, y0 + ch * 0.42, R * 0.15, 2));
      add(blob(R * 0.55, ch * 0.32, R * 0.55, -R * 0.38, y0 + ch * 0.45, -R * 0.2, 3));
      add(blob(R * 0.5, ch * 0.3, R * 0.5, R * 0.05, y0 + ch * 0.7, -R * 0.1, 4));
      break;
    case 'oval':
      add(blob(R * 0.85, ch * 0.34, R * 0.85, 0, y0 + ch * 0.36, 0, 1));
      add(blob(R * 0.75, ch * 0.3, R * 0.75, R * 0.1, y0 + ch * 0.64, 0.05, 2));
      add(blob(R * 0.5, ch * 0.2, R * 0.5, -R * 0.05, y0 + ch * 0.84, 0, 3));
      break;
    case 'dome':
      add(blob(R * 0.95, ch * 0.42, R * 0.95, 0, y0 + ch * 0.55, 0, 1));
      add(blob(R * 0.55, ch * 0.3, R * 0.55, R * 0.5, y0 + ch * 0.38, R * 0.2, 2));
      add(blob(R * 0.55, ch * 0.3, R * 0.55, -R * 0.45, y0 + ch * 0.4, -R * 0.3, 3));
      add(blob(R * 0.5, ch * 0.28, R * 0.5, R * 0.1, y0 + ch * 0.4, -R * 0.55, 4));
      add(blob(R * 0.5, ch * 0.28, R * 0.5, -R * 0.15, y0 + ch * 0.38, R * 0.55, 5));
      break;
    case 'globe':
      add(blob(R * 0.95, ch * 0.48, R * 0.95, 0, y0 + ch * 0.5, 0, 1, 2));
      break;
    case 'irregular':
      add(blob(R * 0.55, ch * 0.3, R * 0.55, R * 0.25, y0 + ch * 0.62, 0, 1));
      add(blob(R * 0.5, ch * 0.26, R * 0.5, -R * 0.4, y0 + ch * 0.45, R * 0.2, 2));
      add(blob(R * 0.45, ch * 0.24, R * 0.45, R * 0.35, y0 + ch * 0.32, -R * 0.35, 3));
      add(blob(R * 0.4, ch * 0.22, R * 0.4, -R * 0.1, y0 + ch * 0.82, -R * 0.2, 4));
      break;
    case 'cone':
      add(cone(R, ch, y0, 1));
      break;
    case 'tiers': {
      // Sedir: 4 sarkık etekli kat + ince tepe
      const n = 4;
      for (let k = 0; k < n; k++) {
        const f = k / n;
        const r = R * (1 - f * 0.78);
        const h = ch * 0.42;
        add(cone(r, h, y0 + ch * f * 0.78, k + 1, h * 0.12));
      }
      add(cone(R * 0.12, ch * 0.2, y0 + ch * 0.8, 9));
      break;
    }
    case 'column':
      add(blob(R, ch * 0.5, R, 0, y0 + ch * 0.5, 0, 1, 1));
      break;
    case 'egg':
      add(blob(R, ch * 0.5, R, 0, y0 + ch * 0.48, 0, 1, 1));
      break;
    case 'palm': {
      // Gövde yukarıda (crownBase = gövde boyu oranı); tepe: ışınsal yassı yapraklar
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const el = k % 3 === 0 ? 0.9 : k % 3 === 1 ? 0.35 : -0.2;
        const len = R * 0.85;
        const g = blob(len * 0.55, 0.06 * len + 0.05, len * 0.28, 0, 0, 0, k + 1, 0);
        g.rotateZ(el);
        g.translate(len * 0.5 * Math.cos(el), len * 0.5 * Math.sin(el), 0);
        g.rotateY(a);
        g.translate(0, y0 + 0.1, 0);
        add(g);
      }
      break;
    }
    case 'sapling':
      add(blob(R * 0.8, ch * 0.42, R * 0.8, 0, y0 + ch * 0.5, 0, 1, 0));
      break;
  }
  return merge(parts);
}
