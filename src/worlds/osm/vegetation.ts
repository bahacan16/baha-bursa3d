import { rng, hashString, CHUNK_SIZE } from './chunks';
import { pointInPolygon, distToSegment, type Area, type Building, type Pt, type Road } from './parse';
import { SPECIES_COUNT, SPECIES_SIZE, speciesIndex, speciesKey } from './species';

/**
 * Tür sayısı. Tür indeksleri `species.ts` SPECIES listesindedir; 0–2 eski üç genel türle aynı
 * (0 yuvarlak yaprak döken, 1 iğne yapraklı, 2 oval) → eski sayısal türler geriye uyumlu.
 */
export const TREE_TYPES = SPECIES_COUNT;
const T_ROUND = speciesIndex('deciduous');
const T_CONIFER = speciesIndex('conifer');
const T_OVAL = speciesIndex('deciduous-oval');

export interface TreeInstance {
  x: number;
  z: number;
  /** Tür indeksi (species.ts) */
  type: number;
  /** Taç genişliği ve boy ölçeği (türün başvuru boyuna göre) */
  sxz: number;
  sy: number;
  rot: number;
  /** renk çarpanı */
  shade: number;
  /**
   * Ölçülen taç tabanı (ilk dalların kotu): modelin başvuru boyuna oranı (model birimi / türün h), 0 = türün kendi
   * taç tabanı. Ağaç alanı bu örnekleri gövdesi uzatılmış / kısaltılmış model çeşidiyle çizer (treelib).
   */
  cb?: number;
}

/** Payload'da ağaç başına kayan sayı: [x, z, sxz, sy, dönüş, gölge] (taç tabanı çeşidi chunk'ta: `cb`) */
export const TREE_STRIDE = 6;

export interface TreePayload {
  /**
   * chunk anahtarı → tip (+ taç tabanı çeşidi `cb`, 0 = türün modeli; 0.05 adımlı) → [x, z, sxz, sy, dönüş, gölge]*
   */
  chunks: { cx: number; cz: number; type: number; cb: number; data: Float32Array }[];
  count: number;
}

/**
 * fixedTrees akışı: ağaç başına [x, z, tür, boy m (0 = bilinmiyor), taç yarıçapı m (0 = bilinmiyor), taç tabanı m
 * (ilk dallar; 0 = bilinmiyor → türün modeli)]
 */
export const FIXED_STRIDE = 6;

/** Taç tabanı çeşidi adımı (model boyuna oran) — aynı adımdaki ağaçlar tek model çeşidini paylaşır */
export const CB_STEP = 0.05;

/**
 * Ölçülen taç tabanı (m) → model çeşidi oranı: model biriminde taban (cb / sy) / türün başvuru boyu, 0.05 adımına
 * yuvarlanır, 0.02–0.85 aralığında. 0 / bilinmiyor → 0 (türün kendi modeli).
 */
export function crownBaseRatio(cbM: number, sy: number, refH: number): number {
  if (!(cbM > 0) || !(sy > 0) || !(refH > 0)) return 0;
  const r = Math.max(0.02, Math.min(0.85, cbM / sy / refH));
  return Math.max(CB_STEP, Math.round(r / CB_STEP) * CB_STEP);
}

/**
 * Ölçülmüş boy/taç yarıçapından türün başvuru boyuna göre ölçek. Yalnız biri biliniyorsa oran korunur;
 * oran uç değerlere kırpılır (aşırı basık/sivri model olmasın).
 */
export function fixedScale(type: number, h: number, r: number): { sxz: number; sy: number } {
  const size = SPECIES_SIZE[speciesKey(type)];
  const byH = h > 0 ? h / size.h : 0;
  const byR = r > 0 ? (2 * r) / size.w : 0;
  let sy = byH || byR || 1;
  let sxz = byR || byH || 1;
  sy = Math.max(0.12, Math.min(2.2, sy));
  // İkisi de ölçülmüşse ölçülen dar taç korunur (ör. genç sedir, dar palmiye); yalnız biri biliniyorsa eski oran
  sxz = Math.max(sy * (byH && byR ? 0.35 : 0.6), Math.min(sy * 1.7, sxz));
  return { sxz, sy };
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
  /** Hava fotoğrafından tespit edilmiş ağaçlar [x, z, taçYarıçapı]* — varsa rastgele dağıtımın yerine geçer */
  aerialTrees?: Float32Array | number[];
  /** Elle ölçülmüş ağaçlar [x, z, tür, boy, taç yarıçapı]* (FIXED_STRIDE; engelleme kontrolü yok, önce yerleşir) */
  fixedTrees?: number[];
  /** Otomatik ağaç konmayacak bölgeler (düz [x,z,...] çokgenler) — ölçülmüş alanlar */
  excludeZones?: number[][];
}

function inFlat(p: number[], x: number, z: number): boolean {
  let c = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i];
    const zi = p[2 * i + 1];
    const xj = p[2 * j];
    const zj = p[2 * j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
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
    // Tür görülmedi → genel yaprak döken / iğne yapraklı ayrımı (eski dağılım)
    const type = t < typeBias ? T_CONIFER : t < 0.8 ? T_ROUND : T_OVAL;
    const s = 0.75 + r() * 0.6;
    out.push({
      x,
      z,
      type,
      sxz: s,
      sy: s * (0.9 + r() * 0.2),
      rot: r() * Math.PI * 2,
      shade: 0.8 + r() * 0.35,
    });
    placed.insertBox(x, z, x, z, [x, z]);
  };

  const zones = opts.excludeZones ?? [];
  const excluded = (x: number, z: number) => zones.some((p) => inFlat(p, x, z));
  // 0) Elle ölçülmüş ağaçlar (Street View + hava fotoğrafı): aynen
  const F = opts.fixedTrees ?? [];
  for (let i = 0; i + FIXED_STRIDE - 1 < F.length; i += FIXED_STRIDE) {
    const x = F[i];
    const z = F[i + 1];
    const type = Math.max(0, Math.min(SPECIES_COUNT - 1, Math.round(F[i + 2])));
    const r = rng(hashString(`f${x},${z}`));
    const { sxz, sy } = fixedScale(type, F[i + 3], F[i + 4]);
    const cb = crownBaseRatio(F[i + 5], sy, SPECIES_SIZE[speciesKey(type)].h);
    out.push({ x, z, type, sxz, sy, rot: r() * Math.PI * 2, shade: 0.88 + r() * 0.2, ...(cb ? { cb } : {}) });
    placed.insertBox(x, z, x, z, [x, z]);
  }
  // 1) Haritalanmış ağaçlar (engellemeden bağımsız, yalnızca bina içi elenir)
  for (const [x, z] of trees) {
    if (blocked(x, z, false) || excluded(x, z)) continue;
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
  // 3a) Hava fotoğrafı ağaçları (gerçek konumlar)
  const A = opts.aerialTrees;
  if (A && A.length) {
    for (let i = 0; i < A.length; i += 3) {
      const x = A[i];
      const z = A[i + 1];
      if (Math.hypot(x, z) > 1180) continue;
      if (tooClose(x, z, 3.5) || blocked(x, z) || excluded(x, z)) continue;
      const seed = hashString(`a${x},${z}`);
      const r = rng(seed);
      const t = r();
      // KARAR: hava fotoğrafı tespitinde tür ayrımı güvenilir değil → genel yaprak döken/iğne yapraklı (eski oran)
      const type = t < 0.14 ? T_CONIFER : t < 0.86 ? T_ROUND : T_OVAL;
      const half = SPECIES_SIZE[speciesKey(type)].w / 2;
      const sxz = Math.max(0.45, Math.min(1.8, A[i + 2] / half));
      out.push({
        x,
        z,
        type,
        sxz,
        sy: sxz * (0.9 + r() * 0.2),
        rot: r() * Math.PI * 2,
        shade: 0.8 + r() * 0.35,
      });
      placed.insertBox(x, z, x, z, [x, z]);
      if (out.length >= opts.maxTrees) break;
    }
    return out.slice(0, opts.maxTrees);
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
  const groups = new Map<string, { cx: number; cz: number; type: number; cb: number; data: number[] }>();
  for (const t of trees) {
    const cx = Math.floor(t.x / CHUNK_SIZE);
    const cz = Math.floor(t.z / CHUNK_SIZE);
    const cb = t.cb ?? 0;
    const k = `${cx},${cz},${t.type},${cb}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { cx, cz, type: t.type, cb, data: [] }));
    g.data.push(t.x, t.z, t.sxz, t.sy, t.rot, t.shade);
  }
  return {
    chunks: [...groups.values()].map((g) => ({
      cx: g.cx,
      cz: g.cz,
      type: g.type,
      cb: g.cb,
      data: new Float32Array(g.data),
    })),
    count: trees.length,
  };
}
