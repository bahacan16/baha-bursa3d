import * as THREE from 'three';
import type { IWorld } from '../world';
import type { Quality } from '../../core/settings';
import { PolygonCollisionWorld } from './collision';
import { CHUNK_SIZE, MAT_KEYS, type MatKey } from './chunks';
import { buildWorld, type BuildResult } from './build';
import { createOsmMaterials, createTreeGeometries, type OsmMaterials } from './materials';
import { orient } from './buildings';
import { barrierThickness } from './landuse';
import { parseOsm, pointInPolygon, type OsmWorldData } from './parse';
import type { SimpleOsm } from './simplify';
import type { Carriageway, RaisedStrip } from './roads';
import type { GridData, TerrainData } from '../../env/terrain';
import { H, ringBase, setTerrain } from './height';
import { drawGroundTexture } from './groundtex';
import { loadAerial, sampleRoofColors, type RoofColorMap } from './aerial';
import { StreetProps } from './streetprops';
import { createDetailedTrees } from './treemesh';
import { Pedestrians } from '../../sim/pedestrians';
import { Traffic } from '../../sim/traffic';
import { ParkedCars } from '../../sim/parked';
import { nightUniform } from '../../env/night';

const SHADOW_CASTERS: MatKey[] = ['wall', 'roof', 'roofTile', 'detail', 'barrier', 'rail'];
const SHADOW_RECEIVERS: MatKey[] = [
  'landLow',
  'landHigh',
  'pitch',
  'roadMinor',
  'roadMajor',
  'footway',
  'roofTile',
  'sidewalk',
  'wall',
  'roof',
  'marking',
  'rail',
  'barrier',
  'water',
];

export type BuildProgress = (fraction: number, label: string) => void;

/** Worker'da üret; Worker kullanılamazsa ana iş parçacığında. */
async function buildInWorker(
  data: SimpleOsm,
  quality: Quality,
  terrain: GridData | null,
  roofColors: RoofColorMap | undefined,
  aerialTrees: number[] | undefined,
  progress: BuildProgress,
): Promise<BuildResult> {
  try {
    const worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' });
    return await new Promise<BuildResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; p?: number; label?: string; res?: BuildResult; message?: string };
        if (m.type === 'progress') progress(m.p ?? 0, m.label ?? '');
        else if (m.type === 'done') {
          worker.terminate();
          resolve(m.res!);
        } else if (m.type === 'error') {
          worker.terminate();
          reject(new Error(m.message));
        }
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message || 'worker hatası'));
      };
      worker.postMessage({ data, opts: { quality, terrain, roofColors, aerialTrees } });
    });
  } catch (err) {
    console.warn('Worker kullanılamadı, ana iş parçacığında üretiliyor:', err);
    await new Promise((r) => setTimeout(r, 0));
    return buildWorld(data, { quality, terrain, roofColors, aerialTrees }, progress);
  }
}

/** Zemin yüksekliği: kaldırım (+0.15), hemzemin ray balastı; araç yolu şeridinde 0. */
export class GroundIndex {
  private strips = new Map<number, RaisedStrip[]>();
  private roads = new Map<number, Carriageway[]>();
  private static CELL = 10;
  private k(x: number, z: number) {
    return (Math.floor(x / GroundIndex.CELL) + 32768) * 65536 + (Math.floor(z / GroundIndex.CELL) + 32768);
  }
  private insert<T extends { ax: number; az: number; bx: number; bz: number }>(
    m: Map<number, T[]>,
    s: T,
    pad: number,
  ) {
    const c = GroundIndex.CELL;
    for (
      let x = Math.floor((Math.min(s.ax, s.bx) - pad) / c);
      x <= Math.floor((Math.max(s.ax, s.bx) + pad) / c);
      x++
    )
      for (
        let z = Math.floor((Math.min(s.az, s.bz) - pad) / c);
        z <= Math.floor((Math.max(s.az, s.bz) + pad) / c);
        z++
      ) {
        const k = (x + 32768) * 65536 + (z + 32768);
        let a = m.get(k);
        if (!a) m.set(k, (a = []));
        a.push(s);
      }
  }
  constructor(strips: RaisedStrip[], roads: Carriageway[]) {
    for (const s of strips) this.insert(this.strips, s, s.outer);
    for (const r of roads) this.insert(this.roads, r, r.half);
  }
  private static proj(x: number, z: number, s: { ax: number; az: number; bx: number; bz: number }) {
    const ex = s.bx - s.ax;
    const ez = s.bz - s.az;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? ((x - s.ax) * ex + (z - s.az) * ez) / l2 : 0;
    const tc = Math.max(0, Math.min(1, t));
    return { t, d: Math.hypot(x - (s.ax + ex * tc), z - (s.az + ez * tc)) };
  }
  /** Araç yolu veya kaldırım üzerinde mi? */
  onPaved(x: number, z: number): boolean {
    const k = this.k(x, z);
    for (const r of this.roads.get(k) ?? []) if (GroundIndex.proj(x, z, r).d < r.half) return true;
    for (const s of this.strips.get(k) ?? []) {
      const p = GroundIndex.proj(x, z, s);
      if (p.t >= 0 && p.t <= 1 && p.d >= s.inner && p.d <= s.outer) return true;
    }
    return false;
  }

  height(x: number, z: number): number {
    const k = this.k(x, z);
    for (const r of this.roads.get(k) ?? []) if (GroundIndex.proj(x, z, r).d < r.half) return 0;
    let h = 0;
    for (const s of this.strips.get(k) ?? []) {
      const p = GroundIndex.proj(x, z, s);
      if (p.t < -0.001 || p.t > 1.001) continue;
      if (p.d >= s.inner && p.d <= s.outer) h = Math.max(h, s.height);
    }
    return h;
  }
}

const TREE_NEAR_R = 110;
const TREE_NEAR_MAX = 1500;

export class OsmWorld implements IWorld {
  readonly kind = 'osm' as const;
  readonly object = new THREE.Group();
  readonly collision = new PolygonCollisionWorld();
  readonly spawn = new THREE.Vector3();
  private chunkGroups = new Map<string, THREE.Group>();
  private materials: OsmMaterials;
  private treeGeos: THREE.BufferGeometry[] = [];
  private treeGeosHi: THREE.BufferGeometry[] = [];
  private treeMatHi = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  private treeMeshes: {
    im: THREE.InstancedMesh;
    type: number;
    c: THREE.Vector2;
    mats: Float32Array;
    hi: Uint8Array;
  }[] = [];
  private treeNear: THREE.InstancedMesh[] = [];
  private treeLodAt = new THREE.Vector2(1e9, 1e9);
  private stat: Record<string, number> = {};
  private viewDist: number;
  private props!: StreetProps;
  private groundIdx!: GroundIndex;
  private peds!: Pedestrians;
  private traffic!: Traffic;
  private parked!: ParkedCars;

  private constructor(
    readonly data: OsmWorldData,
    res: BuildResult,
    quality: Quality,
    viewDist: number,
    readonly terrain: TerrainData | null,
    aerial: HTMLImageElement | null = null,
  ) {
    this.viewDist = viewDist;
    this.object.name = 'osm-world';
    this.materials = createOsmMaterials(quality);
    this.stat = res.stats;

    setTerrain(terrain?.near ?? null);
    const ground = createTerrainMesh(terrain?.near ?? null, data, this.materials.ground, quality, aerial);
    ground.receiveShadow = quality !== 'low';
    this.object.add(ground);

    const shadows = quality !== 'low';
    for (const c of res.chunks) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(c.normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(c.uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(c.color, 3));
      if (c.facade) g.setAttribute('facade', new THREE.BufferAttribute(c.facade, 4));
      g.setIndex(new THREE.BufferAttribute(c.index, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.materials.byKey[c.mat]);
      m.name = `${c.mat}@${c.cx},${c.cz}`;
      m.castShadow = shadows && SHADOW_CASTERS.includes(c.mat);
      m.receiveShadow = shadows && SHADOW_RECEIVERS.includes(c.mat);
      m.renderOrder = MAT_KEYS.indexOf(c.mat);
      this.chunkGroup(c.cx, c.cz).add(m);
    }

    // Ağaçlar: chunk × tür başına InstancedMesh
    this.treeGeos = createTreeGeometries();
    this.treeGeosHi = quality === 'low' ? [] : createDetailedTrees();
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const t of res.trees.chunks) {
      const n = t.data.length / 5;
      const im = new THREE.InstancedMesh(this.treeGeos[t.type], this.materials.trees, n);
      for (let i = 0; i < n; i++) {
        const x = t.data[i * 5];
        const z = t.data[i * 5 + 1];
        const s = t.data[i * 5 + 2];
        q.setFromAxisAngle(up, t.data[i * 5 + 3]);
        mtx.compose(
          new THREE.Vector3(x, H(x, z) - 0.1, z),
          q,
          new THREE.Vector3(s, s * (0.9 + (i % 5) * 0.05), s),
        );
        im.setMatrixAt(i, mtx);
        const sh = t.data[i * 5 + 4];
        col.setRGB(sh, sh * (0.95 + (i % 3) * 0.04), sh * 0.9);
        im.setColorAt(i, col);
        // Gövde çarpışması
        this.collision.addBox(x, z, 0.4 * s, 0.4 * s, 3, H(x, z) - 0.5);
      }
      im.computeBoundingSphere();
      im.castShadow = shadows;
      im.receiveShadow = false;
      im.name = `trees${t.type}@${t.cx},${t.cz}`;
      this.treeMeshes.push({
        im,
        type: t.type,
        c: new THREE.Vector2((t.cx + 0.5) * CHUNK_SIZE, (t.cz + 0.5) * CHUNK_SIZE),
        mats: (im.instanceMatrix.array as Float32Array).slice(),
        hi: new Uint8Array(n),
      });
      this.chunkGroup(t.cx, t.cz).add(im);
    }

    // Yakın ağaçlar: tür başına tek ayrıntılı InstancedMesh (her karede değil, oyuncu hareket ettikçe doldurulur)
    for (let k = 0; k < this.treeGeosHi.length; k++) {
      const im = new THREE.InstancedMesh(this.treeGeosHi[k], this.treeMatHi, TREE_NEAR_MAX);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = shadows;
      im.name = `treesNear${k}`;
      this.treeNear.push(im);
      this.object.add(im);
    }

    // Çarpışma: binalar, duvarlar, köprü ayakları
    for (const b of data.buildings) {
      const base = ringBase(b.outer);
      const bottom = b.minHeight > 0.5 ? b.minHeight + base : base - 1;
      this.collision.addRing(orient(b.outer, true), bottom, b.height + base);
      for (const h of b.holes) this.collision.addRing(h, bottom, b.height + base);
    }
    for (const br of data.barriers) {
      const t = barrierThickness(br.kind) / 2;
      const pts = br.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const h0 = H(p0[0], p0[1]);
        const h1 = H(p1[0], p1[1]);
        const bottom = Math.min(h0, h1) - 1;
        const top = Math.max(h0, h1) + br.height;
        if (t > 0.1) {
          // Kalın duvarlar için iki kenar
          const dx = p1[0] - p0[0];
          const dz = p1[1] - p0[1];
          const l = Math.hypot(dx, dz) || 1;
          const nx = (-dz / l) * t;
          const nz = (dx / l) * t;
          this.collision.addRing(
            [
              [p0[0] + nx, p0[1] + nz],
              [p1[0] + nx, p1[1] + nz],
              [p1[0] - nx, p1[1] - nz],
              [p0[0] - nx, p0[1] - nz],
            ],
            bottom,
            top,
          );
        } else this.collision.addPolyline([p0, p1], bottom, top);
      }
    }
    for (const p of res.piers) this.collision.addBox(p.x, p.z, p.size, p.size, 40, H(p.x, p.z) - 1);

    this.props = new StreetProps(res.props, quality);
    this.object.add(this.props.group);
    this.props.forEach((x, y, z) => this.collision.addBox(x, z, 0.25, 0.25, 7, y - 0.5));
    for (let i = 0; i < res.props.benches.length; i += 4) {
      const b = res.props.benches;
      // Bank: üzerinden zıplanabilir alçak engel
      this.collision.addBox(b[i], b[i + 2], 1.2, 1.2, 0.5, b[i + 1] - 0.3);
    }

    this.parked = new ParkedCars(res.props.parked, quality);
    this.object.add(this.parked.group);
    this.parked.forEachBox((c, y) => this.collision.addRing(c, y - 0.5, y + 1.5));

    const ground2 = (this.groundIdx = new GroundIndex(res.strips, res.carriageways));
    this.collision.ground = (x, z) => H(x, z) + ground2.height(x, z);

    this.findSpawn();
    this.peds = new Pedestrians(data.roads, quality);
    this.traffic = new Traffic(data.roads, quality);
    this.object.add(this.peds.group, this.traffic.group);
  }

  static async create(
    simple: SimpleOsm,
    quality: Quality,
    viewDist: number,
    progress: BuildProgress,
    terrain: TerrainData | null = null,
  ): Promise<OsmWorld> {
    const parsed = parseOsm(simple);
    progress(0.02, 'Hava fotoğrafı yükleniyor');
    const aerial = await loadAerial(import.meta.env.BASE_URL, quality === 'low' ? 2048 : 4096);
    const roofColors = aerial ? sampleRoofColors(aerial, parsed.buildings) : undefined;
    let aerialTrees: number[] | undefined;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/trees-aerial.json`);
      if (r.ok) aerialTrees = ((await r.json()) as { trees: number[] }).trees;
    } catch {
      /* yoksa rastgele dağıtım */
    }
    const res = await buildInWorker(
      simple,
      quality,
      terrain?.near ?? null,
      roofColors,
      aerialTrees,
      progress,
    );
    progress(0.95, 'Sahne kuruluyor');
    return new OsmWorld(parsed, res, quality, viewDist, terrain, aerial);
  }

  private chunkGroup(cx: number, cz: number): THREE.Group {
    const k = `${cx},${cz}`;
    let g = this.chunkGroups.get(k);
    if (!g) {
      g = new THREE.Group();
      g.name = `chunk ${k}`;
      g.userData.center = new THREE.Vector2((cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE);
      this.chunkGroups.set(k, g);
      this.object.add(g);
    }
    return g;
  }

  /** Merkezde (502. Sokak orta noktası) doğ; bina içindeyse spiral arama ile boş yer bul. */
  private findSpawn(): void {
    const p = this.findFreeSpot(0, 0);
    this.spawn.set(p.x, this.collision.ground(p.x, p.z, 0) ?? 0, p.z);
  }

  findFreeSpot(x0: number, z0: number): { x: number; z: number } {
    const inside = (x: number, z: number) =>
      this.data.buildings.some((b) => b.minHeight < 2 && pointInPolygon(x, z, b.outer, b.holes));
    const p = new THREE.Vector3();
    for (let r = 0; r < 200; r += 2) {
      const steps = Math.max(1, Math.floor((r * Math.PI * 2) / 2));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r;
        const z = z0 + Math.sin(a) * r;
        if (Math.hypot(x, z) > 995 || inside(x, z)) continue;
        p.set(x, H(x, z), z);
        this.collision.resolve(p, 0.5);
        if (Math.hypot(p.x - x, p.z - z) > 0.01) continue;
        return { x, z };
      }
    }
    return { x: x0, z: z0 };
  }

  update(camera: THREE.PerspectiveCamera, player: THREE.Vector3, dt: number): void {
    this.props.update(player, nightUniform.value, dt);
    this.peds.update(dt, player);
    this.parked.update(player, dt);
    this.traffic.update(dt, player, nightUniform.value);
    const dyn = this.collision.dynamic;
    dyn.length = 0;
    this.peds.obstacles(dyn, player.x, player.z);
    this.traffic.obstacles(dyn, player.x, player.z);
    const cx = camera.position.x;
    const cz = camera.position.z;
    if (this.treeNear.length && this.treeLodAt.distanceTo(new THREE.Vector2(cx, cz)) > 8)
      this.updateTreeLod(cx, cz);
    const lim = this.viewDist + CHUNK_SIZE * 0.75;
    for (const g of this.chunkGroups.values()) {
      const c = g.userData.center as THREE.Vector2;
      g.visible = Math.hypot(c.x - cx, c.y - cz) < lim;
    }
  }

  /**
   * Ağaç LOD'u ağaç başına: TREE_NEAR_R içindekiler ayrıntılı modelle çizilir, uzak kopyası sıfır ölçekle gizlenir.
   * KARAR: chunk başına LOD 400 m chunk'larda ~1.8M üçgen ediyordu; ağaç başına ~150k.
   */
  private updateTreeLod(cx: number, cz: number): void {
    this.treeLodAt.set(cx, cz);
    const counts = this.treeNear.map(() => 0);
    const r2 = TREE_NEAR_R * TREE_NEAR_R;
    const zero = new Float32Array(16);
    const col = new THREE.Color();
    for (const t of this.treeMeshes) {
      const far = Math.max(Math.abs(t.c.x - cx), Math.abs(t.c.y - cz)) > CHUNK_SIZE / 2 + TREE_NEAR_R;
      const arr = t.im.instanceMatrix.array as Float32Array;
      const near = this.treeNear[t.type];
      let changed = false;
      for (let i = 0; i < t.hi.length; i++) {
        const o = i * 16;
        const dx = t.mats[o + 12] - cx;
        const dz = t.mats[o + 14] - cz;
        const hi = !far && dx * dx + dz * dz < r2 && counts[t.type] < TREE_NEAR_MAX ? 1 : 0;
        if (hi) {
          near.instanceMatrix.array.set(t.mats.subarray(o, o + 16), counts[t.type] * 16);
          t.im.getColorAt(i, col);
          near.setColorAt(counts[t.type]++, col);
        }
        if (hi !== t.hi[i]) {
          t.hi[i] = hi;
          arr.set(hi ? zero : t.mats.subarray(o, o + 16), o);
          changed = true;
        }
      }
      if (changed) t.im.instanceMatrix.needsUpdate = true;
    }
    this.treeNear.forEach((im, k) => {
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  private soft = new Set(['park', 'grass', 'wood', 'scrub', 'pitch', 'cemetery', 'farmland']);

  audioInfo(x: number, z: number): { surface: 'hard' | 'soft' | 'gravel'; nearestCar: number } {
    let surface: 'hard' | 'soft' | 'gravel' = 'soft';
    if (this.groundIdx.onPaved(x, z)) surface = 'hard';
    else {
      const a = this.areaAt(x, z);
      if (a === 'playground' || a === 'construction') surface = 'gravel';
      else if (a && !this.soft.has(a)) surface = 'hard';
    }
    return { surface, nearestCar: this.traffic.nearest(x, z) };
  }

  private areaGrid: Map<string, number[]> | null = null;
  private areaAt(x: number, z: number): string | null {
    const C = 50;
    if (!this.areaGrid) {
      this.areaGrid = new Map();
      this.data.areas.forEach((a, i) => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const p of a.outer) {
          minX = Math.min(minX, p[0]);
          maxX = Math.max(maxX, p[0]);
          minZ = Math.min(minZ, p[1]);
          maxZ = Math.max(maxZ, p[1]);
        }
        for (let gx = Math.floor(minX / C); gx <= Math.floor(maxX / C); gx++)
          for (let gz = Math.floor(minZ / C); gz <= Math.floor(maxZ / C); gz++) {
            const k = `${gx},${gz}`;
            let arr = this.areaGrid!.get(k);
            if (!arr) this.areaGrid!.set(k, (arr = []));
            arr.push(i);
          }
      });
    }
    let best: string | null = null;
    let bestSize = Infinity;
    for (const i of this.areaGrid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []) {
      const a = this.data.areas[i];
      if (!pointInPolygon(x, z, a.outer, a.holes)) continue;
      const size = Math.abs(
        a.outer.reduce(
          (s, p, k) =>
            s + p[0] * a.outer[(k + 1) % a.outer.length][1] - a.outer[(k + 1) % a.outer.length][0] * p[1],
          0,
        ),
      );
      if (size < bestSize) {
        bestSize = size;
        best = a.kind;
      }
    }
    return best;
  }

  attributionHtml(): string {
    return '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıcıları';
  }

  stats(): Record<string, number | string> {
    return {
      ...this.stat,
      collisionSegs: this.collision.segmentCount,
      lamps: this.props.lampCount,
      pedestrians: this.peds.count,
      cars: this.traffic.count,
    };
  }

  dispose(): void {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !this.treeGeos.includes(m.geometry) && !this.treeGeosHi.includes(m.geometry))
        m.geometry.dispose();
    });
    for (const g of [...this.treeGeos, ...this.treeGeosHi]) g.dispose();
    this.treeMatHi.dispose();
    this.props.dispose();
    this.peds.dispose();
    this.traffic.dispose();
    this.parked.dispose();
    this.materials.dispose();
  }
}

/** Arazi mesh'i (yakın ızgara) + alan kullanımı dokusu. Arazi yoksa düz 2.6 km kare. */
function createTerrainMesh(
  g: GridData | null,
  data: OsmWorldData,
  mat: THREE.MeshStandardMaterial,
  quality: Quality,
  aerial: HTMLImageElement | null = null,
): THREE.Mesh {
  const half = g ? g.half : 1300;
  const n = g ? g.n : 2;
  const cell = g ? g.cell : half * 2;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -half + i * cell;
      const z = -half + j * cell;
      pos.set([x, g ? g.h[k] : 0, z], k * 3);
      uv.set([i / (n - 1), 1 - j / (n - 1)], k * 2);
    }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], o);
      o += 6;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // Gerçek hava fotoğrafı varsa onu, yoksa OSM alan kullanımından boyanmış dokuyu kullan
  const tex = aerial
    ? new THREE.Texture(aerial)
    : new THREE.CanvasTexture(drawGroundTexture(data, quality === 'low' ? 2048 : 4096, half));
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  mat.map = tex;
  mat.needsUpdate = true;
  const m = new THREE.Mesh(geo, mat);
  m.name = 'ground';
  return m;
}
