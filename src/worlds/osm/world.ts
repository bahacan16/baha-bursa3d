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

const SHADOW_CASTERS: MatKey[] = ['wall', 'roof', 'detail', 'barrier', 'rail'];
const SHADOW_RECEIVERS: MatKey[] = [
  'landLow',
  'landHigh',
  'pitch',
  'roadMinor',
  'roadMajor',
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
      worker.postMessage({ data, opts: { quality } });
    });
  } catch (err) {
    console.warn('Worker kullanılamadı, ana iş parçacığında üretiliyor:', err);
    await new Promise((r) => setTimeout(r, 0));
    return buildWorld(data, { quality }, progress);
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

export class OsmWorld implements IWorld {
  readonly kind = 'osm' as const;
  readonly object = new THREE.Group();
  readonly collision = new PolygonCollisionWorld();
  readonly spawn = new THREE.Vector3();
  private chunkGroups = new Map<string, THREE.Group>();
  private materials: OsmMaterials;
  private treeGeos: THREE.BufferGeometry[] = [];
  private stat: Record<string, number> = {};
  private viewDist: number;

  private constructor(
    readonly data: OsmWorldData,
    res: BuildResult,
    quality: Quality,
    viewDist: number,
  ) {
    this.viewDist = viewDist;
    this.object.name = 'osm-world';
    this.materials = createOsmMaterials(quality);
    this.stat = res.stats;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600).rotateX(-Math.PI / 2),
      this.materials.ground,
    );
    const uv = ground.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2600, uv.getY(i) * 2600);
    ground.receiveShadow = quality !== 'low';
    ground.name = 'ground';
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
        mtx.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.9 + (i % 5) * 0.05), s));
        im.setMatrixAt(i, mtx);
        const sh = t.data[i * 5 + 4];
        col.setRGB(sh, sh * (0.95 + (i % 3) * 0.04), sh * 0.9);
        im.setColorAt(i, col);
        // Gövde çarpışması
        this.collision.addBox(x, z, 0.4 * s, 0.4 * s, 3);
      }
      im.computeBoundingSphere();
      im.castShadow = shadows;
      im.receiveShadow = false;
      im.name = `trees${t.type}@${t.cx},${t.cz}`;
      this.chunkGroup(t.cx, t.cz).add(im);
    }

    // Çarpışma: binalar, duvarlar, köprü ayakları
    for (const b of data.buildings) {
      this.collision.addRing(orient(b.outer, true), b.minHeight, b.height);
      for (const h of b.holes) this.collision.addRing(h, b.minHeight, b.height);
    }
    for (const br of data.barriers) {
      const t = barrierThickness(br.kind) / 2;
      // Kalın duvarlar için iki kenar
      if (t > 0.1) {
        const pts = br.pts;
        for (let i = 0; i + 1 < pts.length; i++) {
          const dx = pts[i + 1][0] - pts[i][0];
          const dz = pts[i + 1][1] - pts[i][1];
          const l = Math.hypot(dx, dz) || 1;
          const nx = (-dz / l) * t;
          const nz = (dx / l) * t;
          this.collision.addRing(
            [
              [pts[i][0] + nx, pts[i][1] + nz],
              [pts[i + 1][0] + nx, pts[i + 1][1] + nz],
              [pts[i + 1][0] - nx, pts[i + 1][1] - nz],
              [pts[i][0] - nx, pts[i][1] - nz],
            ],
            0,
            br.height,
          );
        }
      } else this.collision.addPolyline(br.pts, 0, br.height);
    }
    for (const p of res.piers) this.collision.addBox(p.x, p.z, p.size, p.size, 6);

    const ground2 = new GroundIndex(res.strips, res.carriageways);
    this.collision.ground = (x, z) => ground2.height(x, z);

    this.findSpawn();
  }

  static async create(
    simple: SimpleOsm,
    quality: Quality,
    viewDist: number,
    progress: BuildProgress,
  ): Promise<OsmWorld> {
    const parsed = parseOsm(simple);
    const res = await buildInWorker(simple, quality, progress);
    progress(0.95, 'Sahne kuruluyor');
    return new OsmWorld(parsed, res, quality, viewDist);
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
        p.set(x, 0, z);
        this.collision.resolve(p, 0.5);
        if (Math.hypot(p.x - x, p.z - z) > 0.01) continue;
        return { x, z };
      }
    }
    return { x: x0, z: z0 };
  }

  update(camera: THREE.PerspectiveCamera): void {
    const cx = camera.position.x;
    const cz = camera.position.z;
    const lim = this.viewDist + CHUNK_SIZE * 0.75;
    for (const g of this.chunkGroups.values()) {
      const c = g.userData.center as THREE.Vector2;
      g.visible = Math.hypot(c.x - cx, c.y - cz) < lim;
    }
  }

  attributionHtml(): string {
    return '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> katkıcıları';
  }

  stats(): Record<string, number | string> {
    return { ...this.stat, collisionSegs: this.collision.segmentCount };
  }

  dispose(): void {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !this.treeGeos.includes(m.geometry)) m.geometry.dispose();
    });
    for (const g of this.treeGeos) g.dispose();
    this.materials.dispose();
  }
}
