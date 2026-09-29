import * as THREE from 'three';
import type { Quality } from '../../core/settings';
import { ultraState } from '../../env/ultra';
import { CHUNK_SIZE } from './chunks';
import { SPECIES_SIZE, speciesKey, type SpeciesKey } from './species';
import { TREE_STRIDE, type TreePayload } from './vegetation';
import {
  clearSpeciesModels,
  createTreeMaterials,
  farModel,
  speciesModel,
  type SpeciesModel,
  type TreeMaterials,
} from './treelib';

/**
 * Ağaç alanı: tür başına örneklenmiş (InstancedMesh) üç LOD.
 * - uzak: chunk × tür başına düşük poligonlu silüet (chunk görünürlüğüyle kesilir)
 * - orta: tür başına tek mesh, seyreltilmiş yaprak kartları + ana dallar (NEAR..MID yarıçapı)
 * - yakın: tür başına tek mesh, tam dal + yaprak kartı modeli (NEAR yarıçapı içi)
 * LOD ağaç başına, kamera 4 m yer değiştirince yeniden seçilir; en yakın ağaçlar önce (tür başına üst sınır).
 * KARAR: yakın/orta sınırlar eski ez/küre LOD mesafelerini korur (Orta 65/130 m, Yüksek 100/180 m); Ultra'da
 * 160/260 m ve tür başına 1400 yakın ağaç (güçlü masaüstü GPU, kullanıcı kabul etti). Düşük kalitede yalnız uzak
 * silüet.
 */
const RADII: Record<Quality | 'ultra', { near: number; mid: number }> = {
  low: { near: 0, mid: 0 },
  medium: { near: 65, mid: 130 },
  high: { near: 100, mid: 180 },
  ultra: { near: 160, mid: 260 },
};
const NEAR_CAP = 700;
const NEAR_CAP_ULTRA = 1400;
const MID_CAP = 1600;

interface FarMesh {
  im: THREE.InstancedMesh;
  sp: number;
  c: THREE.Vector2;
  mats: Float32Array;
  shade: Float32Array;
  lod: Uint8Array;
  removed: Uint8Array;
  seg: Uint32Array;
}

interface SpeciesMeshes {
  model: SpeciesModel;
  near: { b: THREE.InstancedMesh; l: THREE.InstancedMesh } | null;
  mid: { b: THREE.InstancedMesh; l: THREE.InstancedMesh } | null;
}

export interface TreeCollision {
  addBox(x: number, z: number, w: number, d: number, h: number, y0: number): void;
  readonly segmentCount: number;
  disableSegments(start: number, n: number): void;
}

export interface TreeFieldOptions {
  quality: Quality;
  ultra?: boolean;
  shadows: boolean;
  base: string;
  groundY: (x: number, z: number) => number;
  chunkGroup: (cx: number, cz: number) => THREE.Group;
  root: THREE.Object3D;
  collision?: TreeCollision;
}

/** Hata ayıklama: ?treelod=near|mid|far tüm ağaçları tek LOD'da gösterir */
const FORCE_LOD =
  typeof location !== 'undefined' ? new URLSearchParams(location.search).get('treelod') : null;

export class TreeField {
  readonly materials: TreeMaterials | null;
  private far: FarMesh[] = [];
  private species = new Map<number, SpeciesMeshes>();
  private farMat: THREE.MeshStandardMaterial;
  private radii: { near: number; mid: number };
  private ultra = false;
  private at = new THREE.Vector2(1e9, 1e9);
  private counts = { near: 0, mid: 0, far: 0 };

  constructor(
    payload: TreePayload,
    private readonly o: TreeFieldOptions,
  ) {
    const ultra = o.ultra ?? ultraState.on;
    this.ultra = ultra && o.quality === 'high';
    this.radii = RADII[this.ultra ? 'ultra' : o.quality];
    if (FORCE_LOD === 'far') this.radii = { near: 0, mid: 0 };
    else if (FORCE_LOD === 'mid') this.radii = { near: 0, mid: 1e5 };
    else if (FORCE_LOD === 'near') this.radii = { near: 1e5, mid: 1e5 };
    const detailed = this.radii.mid > 0;
    this.materials = detailed ? createTreeMaterials(o.base, o.quality === 'medium' ? 1024 : 2048) : null;
    this.farMat =
      this.materials?.far ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    // Türe göre örnek sayısı (yakın/orta mesh boyutları için)
    const perSpecies = new Map<number, number>();
    for (const t of payload.chunks)
      perSpecies.set(t.type, (perSpecies.get(t.type) ?? 0) + t.data.length / TREE_STRIDE);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const t of payload.chunks) {
      const key = speciesKey(t.type);
      const size = SPECIES_SIZE[key];
      const geo = detailed
        ? this.speciesMeshes(t.type, perSpecies.get(t.type) ?? 0).model.far
        : farModel(key);
      const n = t.data.length / TREE_STRIDE;
      const im = new THREE.InstancedMesh(geo, this.farMat, n);
      im.userData.treeShared = true;
      const seg = new Uint32Array(n);
      const shade = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const o6 = i * TREE_STRIDE;
        const x = t.data[o6];
        const z = t.data[o6 + 1];
        const sxz = t.data[o6 + 2];
        const sy = t.data[o6 + 3];
        q.setFromAxisAngle(up, t.data[o6 + 4]);
        const gy = o.groundY(x, z);
        mtx.compose(pos.set(x, gy - 0.1, z), q, scl.set(sxz, sy, sxz));
        im.setMatrixAt(i, mtx);
        const sh = t.data[o6 + 5];
        shade[i] = sh;
        col.setRGB(sh, sh * (0.95 + (i % 3) * 0.04), sh * 0.9);
        im.setColorAt(i, col);
        if (o.collision) {
          seg[i] = o.collision.segmentCount;
          // Yaprağı yere kadar olanlar (servi, mazı, ladin) tacın dibinden, diğerleri gövdeden çarpar
          const half = size.solid ? size.w * 0.32 * sxz : Math.max(0.12, size.trunk * 1.6 * sxz);
          o.collision.addBox(x, z, half * 2, half * 2, Math.min(3, size.h * sy), gy - 0.5);
        }
      }
      im.computeBoundingSphere();
      im.castShadow = o.shadows;
      im.receiveShadow = false;
      im.name = `trees:${key}@${t.cx},${t.cz}`;
      this.far.push({
        im,
        sp: t.type,
        c: new THREE.Vector2((t.cx + 0.5) * CHUNK_SIZE, (t.cz + 0.5) * CHUNK_SIZE),
        mats: (im.instanceMatrix.array as Float32Array).slice(),
        shade,
        lod: new Uint8Array(n),
        removed: new Uint8Array(n),
        seg,
      });
      o.chunkGroup(t.cx, t.cz).add(im);
    }
  }

  /** Türün yakın/orta örnek meshleri (ilk kullanımda) */
  private speciesMeshes(sp: number, count: number): SpeciesMeshes {
    let s = this.species.get(sp);
    if (s) return s;
    const key: SpeciesKey = speciesKey(sp);
    const model = speciesModel(key);
    const m = this.materials!;
    const mk = (g: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string) => {
      const im = new THREE.InstancedMesh(g, mat, Math.max(1, cap));
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = this.o.shadows;
      im.receiveShadow = this.o.shadows;
      im.name = name;
      im.userData.treeShared = true;
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      this.o.root.add(im);
      return im;
    };
    const bark = m.bark[model.def.bark];
    const nearCap = this.radii.near > 0 ? Math.min(count, this.ultra ? NEAR_CAP_ULTRA : NEAR_CAP) : 0;
    const midCap = Math.min(count, MID_CAP);
    s = {
      model,
      near: nearCap
        ? {
            b: mk(model.near.branches, bark, nearCap, `treesNearBark:${key}`),
            l: mk(model.near.leaves, m.leaf, nearCap, `treesNearLeaf:${key}`),
          }
        : null,
      mid: midCap
        ? {
            b: mk(model.mid.branches, bark, midCap, `treesMidBark:${key}`),
            l: mk(model.mid.leaves, m.leaf, midCap, `treesMidLeaf:${key}`),
          }
        : null,
    };
    this.species.set(sp, s);
    return s;
  }

  /** Kamera konumuna göre LOD (4 m hareket eşiği) */
  update(cx: number, cz: number): void {
    if (this.radii.mid <= 0) return;
    if (this.at.distanceTo(new THREE.Vector2(cx, cz)) < 4) return;
    this.at.set(cx, cz);
    const { near, mid } = this.radii;
    const m2 = mid * mid;
    const n2 = near * near;
    // Adaylar: orta yarıçap içindeki ağaçlar (uzaklığa göre sıralı)
    const cand: { f: number; i: number; d2: number }[] = [];
    this.far.forEach((f, fi) => {
      const reach = CHUNK_SIZE / 2 + mid;
      if (Math.abs(f.c.x - cx) > reach || Math.abs(f.c.y - cz) > reach) return;
      for (let i = 0; i < f.lod.length; i++) {
        if (f.removed[i]) continue;
        const dx = f.mats[i * 16 + 12] - cx;
        const dz = f.mats[i * 16 + 14] - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < m2) cand.push({ f: fi, i, d2 });
      }
    });
    cand.sort((a, b) => a.d2 - b.d2);
    const want = new Map<FarMesh, Uint8Array>();
    for (const f of this.far) want.set(f, new Uint8Array(f.lod.length));
    const nc = new Map<number, number>();
    const mc = new Map<number, number>();
    const col = new THREE.Color();
    for (const c of cand) {
      const f = this.far[c.f];
      const s = this.species.get(f.sp);
      if (!s) continue;
      const o = c.i * 16;
      const src = f.mats.subarray(o, o + 16);
      const h = ((c.i * 2654435761) >>> 0) / 4294967296;
      if (s.near && c.d2 < n2 && (nc.get(f.sp) ?? 0) < s.near.l.instanceMatrix.count) {
        const k = nc.get(f.sp) ?? 0;
        nc.set(f.sp, k + 1);
        s.near.b.instanceMatrix.array.set(src, k * 16);
        s.near.l.instanceMatrix.array.set(src, k * 16);
        s.near.l.setColorAt(k, col.setScalar(0.9 + 0.2 * h));
        s.near.b.setColorAt(k, col.setScalar(0.88 + 0.24 * ((h * 7) % 1)));
        want.get(f)![c.i] = 2;
      } else if (s.mid && (mc.get(f.sp) ?? 0) < s.mid.l.instanceMatrix.count) {
        const k = mc.get(f.sp) ?? 0;
        mc.set(f.sp, k + 1);
        s.mid.b.instanceMatrix.array.set(src, k * 16);
        s.mid.l.instanceMatrix.array.set(src, k * 16);
        s.mid.l.setColorAt(k, col.setScalar(0.9 + 0.2 * h));
        s.mid.b.setColorAt(k, col.setScalar(0.88 + 0.24 * ((h * 7) % 1)));
        want.get(f)![c.i] = 1;
      }
    }
    const zero = new Float32Array(16);
    let nf = 0;
    for (const f of this.far) {
      const w = want.get(f)!;
      const arr = f.im.instanceMatrix.array as Float32Array;
      let changed = false;
      for (let i = 0; i < w.length; i++) {
        if (f.removed[i]) continue;
        if (!w[i]) nf++;
        if (w[i] === f.lod[i]) continue;
        const was = f.lod[i] !== 0;
        f.lod[i] = w[i];
        if ((w[i] !== 0) !== was) {
          arr.set(w[i] ? zero : f.mats.subarray(i * 16, i * 16 + 16), i * 16);
          changed = true;
        }
      }
      if (changed) f.im.instanceMatrix.needsUpdate = true;
    }
    this.counts = { near: 0, mid: 0, far: nf };
    for (const [sp, s] of this.species) {
      const a = nc.get(sp) ?? 0;
      const b = mc.get(sp) ?? 0;
      this.counts.near += a;
      this.counts.mid += b;
      for (const [im, n] of [
        [s.near?.b, a],
        [s.near?.l, a],
        [s.mid?.b, b],
        [s.mid?.l, b],
      ] as [THREE.InstancedMesh | undefined, number][]) {
        if (!im) continue;
        im.count = n;
        // Boş örnek listesi de çizim çağrısı sayılır → gizle
        im.visible = n > 0;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Bölgede kalan ağaçları kaldır (çizim + gövde çarpışması) */
  remove(pred: (x: number, z: number) => boolean): number {
    let n = 0;
    for (const f of this.far) {
      const arr = f.im.instanceMatrix.array as Float32Array;
      let changed = false;
      for (let i = 0; i < f.lod.length; i++) {
        const o = i * 16;
        if (f.removed[i] || !pred(f.mats[o + 12], f.mats[o + 14])) continue;
        f.removed[i] = 1;
        arr.fill(0, o, o + 16);
        this.o.collision?.disableSegments(f.seg[i], 4);
        changed = true;
        n++;
      }
      if (changed) f.im.instanceMatrix.needsUpdate = true;
    }
    this.at.set(1e9, 1e9);
    return n;
  }

  stats(): Record<string, number> {
    return { treesNear: this.counts.near, treesMid: this.counts.mid, treesFar: this.counts.far };
  }

  /** Kalan (kaldırılmamış) ağaçların konumları [x, z, …] — ses manzarası (kuş sesleri ağaç kümelerinde) için */
  positions(): Float32Array {
    const out: number[] = [];
    for (const f of this.far)
      for (let i = 0; i < f.lod.length; i++) {
        if (f.removed[i]) continue;
        const o = i * 16;
        out.push(f.mats[o + 12], f.mats[o + 14]);
      }
    return new Float32Array(out);
  }

  dispose(): void {
    for (const f of this.far) f.im.dispose();
    for (const s of this.species.values())
      for (const im of [s.near?.b, s.near?.l, s.mid?.b, s.mid?.l]) im?.dispose();
    this.materials?.dispose();
    if (!this.materials) this.farMat.dispose();
    clearSpeciesModels();
  }
}
