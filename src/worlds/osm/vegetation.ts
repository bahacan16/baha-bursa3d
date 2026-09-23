import { rng, hashString, CHUNK_SIZE } from './chunks';
import { pointInPolygon, distToSegment, type Area, type Building, type Pt, type Road } from './parse';

export const TREE_TYPES = 3; // 0 = yuvarlak (çınar/ıhlamur), 1 = konik (selvi/çam), 2 = oval (kavak)

export interface TreeInstance {
  x: number;
  z: number;
  type: number;
  scale: number;
  rot: number;
  /** renk çarpanı */
  shade: number;
}

export interface TreePayload {
  /** chunk anahtarı → tip → [x, z, ölçek, dönüş, gölge]* */
  chunks: { cx: number; cz: number; type: number; data: Float32Array }[];
  count: number;
}

class SpatialHash<T> {
  private map = new Map<number, T[]>();
  constructor(private readonly cell: number) {}
  private k(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
  insertBox(minX: number, minZ: number, maxX: number, maxZ: number, v: T) {
    for (let x = Math.floor(minX / this.cell); x <= Math.floor(maxX / this.cell); x++)
      for (let z = Math.floor(minZ / this.cell); z <= Math.floor(maxZ / this.cell); z++) {
        const k = this.k(x, z);
        let a = this.map.get(k);
        if (!a) this.map.set(k, (a = []));
        a.push(v);
      }
  }
  at(x: number, z: number): T[] {
    return this.map.get(this.k(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? [];
  }
}

export interface VegetationOptions {
  maxTrees: number;
  density: number;
}

/**
 * Ağaç dağıtımı: natural=tree node'ları + ağaç sıraları + park/koru poligonlarına Poisson disk.
 * Yollar ve binalar üzerine ağaç konmaz.
 */
export function placeTrees(
  trees: Pt[],
  rows: Pt[][],
  areas: Area[],
  roads: Road[],
  buildings: Building[],
  opts: VegetationOptions,
): TreeInstance[] {
  const out: TreeInstance[] = [];
  const roadHash = new SpatialHash<{ a: Pt; b: Pt; half: number }>(20);
  for (const r of roads) {
    if (r.tunnel) continue;
    const half = r.width / 2 + (r.vehicular ? 2.4 : 0.8);
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      roadHash.insertBox(
        Math.min(a[0], b[0]) - half,
        Math.min(a[1], b[1]) - half,
        Math.max(a[0], b[0]) + half,
        Math.max(a[1], b[1]) + half,
        { a, b, half },
      );
    }
  }
  const bHash = new SpatialHash<Building>(25);
  for (const b of buildings) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const p of b.outer) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    bHash.insertBox(minX - 2, minZ - 2, maxX + 2, maxZ + 2, b);
  }
  const blocked = (x: number, z: number, clearRoad = true): boolean => {
    if (clearRoad) for (const s of roadHash.at(x, z)) if (distToSegment(x, z, s.a, s.b) < s.half) return true;
    for (const b of bHash.at(x, z)) if (pointInPolygon(x, z, b.outer, b.holes)) return true;
    return false;
  };
  const placed = new SpatialHash<Pt>(8);
  const tooClose = (x: number, z: number, r: number) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const p of placed.at(x + dx * 8, z + dz * 8))
          if (Math.hypot(p[0] - x, p[1] - z) < r) return true;
    return false;
  };
  const add = (x: number, z: number, seed: number, typeBias: number) => {
    const r = rng(seed);
    const t = r();
    const type = t < typeBias ? 1 : t < 0.8 ? 0 : 2;
    out.push({ x, z, type, scale: 0.75 + r() * 0.6, rot: r() * Math.PI * 2, shade: 0.8 + r() * 0.35 });
    placed.insertBox(x, z, x, z, [x, z]);
  };

  // 1) Haritalanmış ağaçlar (engellemeden bağımsız, yalnızca bina içi elenir)
  for (const [x, z] of trees) {
    if (blocked(x, z, false)) continue;
    add(x, z, hashString(`${x},${z}`), 0.15);
  }
  // 2) Ağaç sıraları: 7 m arayla
  for (const row of rows) {
    let carry = 0;
    for (let i = 0; i + 1 < row.length; i++) {
      const a = row[i];
      const b = row[i + 1];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = carry; s < d; s += 7) {
        const x = a[0] + ((b[0] - a[0]) * s) / d;
        const z = a[1] + ((b[1] - a[1]) * s) / d;
        if (!blocked(x, z, false)) add(x, z, hashString(`${x},${z}`), 0.1);
      }
      carry = (carry - d) % 7;
      if (carry < 0) carry += 7;
    }
  }
  // 3) Poligon içi Poisson disk (dart throwing)
  const spec: Partial<Record<Area['kind'], { minD: number; cover: number; cypress: number }>> = {
    park: { minD: 7, cover: 0.55, cypress: 0.2 },
    wood: { minD: 4.5, cover: 0.9, cypress: 0.45 },
    scrub: { minD: 9, cover: 0.35, cypress: 0.3 },
    grass: { minD: 12, cover: 0.2, cypress: 0.2 },
    cemetery: { minD: 6, cover: 0.6, cypress: 0.8 },
    residential: { minD: 14, cover: 0.12, cypress: 0.3 },
    school: { minD: 12, cover: 0.15, cypress: 0.2 },
  };
  for (const a of areas) {
    const s = spec[a.kind];
    if (!s) continue;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const p of a.outer) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    const area = (maxX - minX) * (maxZ - minZ);
    const target = Math.floor(((area / (s.minD * s.minD)) * s.cover * opts.density) / 1);
    const r = rng(hashString(a.id));
    let placedHere = 0;
    for (let t = 0; t < target * 4 && placedHere < target; t++) {
      const x = minX + r() * (maxX - minX);
      const z = minZ + r() * (maxZ - minZ);
      if (!pointInPolygon(x, z, a.outer, a.holes)) continue;
      if (tooClose(x, z, s.minD)) continue;
      if (blocked(x, z)) continue;
      add(x, z, hashString(`${a.id}:${t}`), s.cypress);
      placedHere++;
    }
  }
  if (out.length > opts.maxTrees) {
    // Deterministik seyreltme (haritalanmış ağaçlar önde olduğu için korunur)
    return out.slice(0, opts.maxTrees);
  }
  return out;
}

export function treesToPayload(trees: TreeInstance[]): TreePayload {
  const groups = new Map<string, { cx: number; cz: number; type: number; data: number[] }>();
  for (const t of trees) {
    const cx = Math.floor(t.x / CHUNK_SIZE);
    const cz = Math.floor(t.z / CHUNK_SIZE);
    const k = `${cx},${cz},${t.type}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { cx, cz, type: t.type, data: [] }));
    g.data.push(t.x, t.z, t.scale, t.rot, t.shade);
  }
  return {
    chunks: [...groups.values()].map((g) => ({
      cx: g.cx,
      cz: g.cz,
      type: g.type,
      data: new Float32Array(g.data),
    })),
    count: trees.length,
  };
}
