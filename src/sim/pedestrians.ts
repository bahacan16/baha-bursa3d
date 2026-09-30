import * as THREE from 'three';
import { HumanPool } from './humans';
import { buildGraph, pointOn, type Graph } from './graph';
import type { Road } from '../worlds/osm/parse';
import type { Quality } from '../core/settings';
import { H } from '../worlds/osm/height';
import { SIDEWALK_W, CURB_H, sidewalkSides, type RoadMarkSpec } from '../worlds/osm/roads';

const WALKABLE = new Set([
  'footway',
  'path',
  'pedestrian',
  'living_street',
  'steps',
  'residential',
  'unclassified',
  'service',
  'tertiary',
  'secondary',
  'primary',
]);

/** Ölçülmüş kaldırım yürüme hattı (siteplan.measuredWalkLines): polyline + yürüme yüzeyi kotu (arazinin üstünde m) */
export interface WalkLine {
  pts: [number, number][];
  h: number;
}

/** Yaya yerleşimi için ölçülmüş sokak bilgisi (world.ts → surveyVegetation + street-plan kaldırımları) */
export interface PedestrianSurvey {
  /** OSM yol kimliği → düzeltme (sidewalk none | left | right | both) */
  marks?: Record<string, RoadMarkSpec>;
  /** OSM kaldırımı olmayan bölgeler (düz [x, z, …] halkalar; refüj, ada, ölçülmüş kaldırım bandı) */
  noSidewalk?: number[][];
  /** Ölçülmüş kaldırımların yürüme hatları */
  walkLines?: WalkLine[];
}

function inFlatRing(r: number[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i];
    const zi = r[i + 1];
    const xj = r[j];
    const zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/**
 * v8 (D4): araç yolundaki yayanın konumu. Önce ölçülmüş kaldırım hattı (yolun o yanında, eksenden en çok yarı genişlik
 * + 16 m, en yakın nokta), yoksa OSM kaldırımı (yalnız kaldırımı olan yanda ve OSM kaldırım bölgesi dışında). Hiçbiri
 * yoksa null → yaya orada yürümez (refüj / park şeridi / kaldırımı kapatılmış bulvar).
 */
export class SidewalkResolver {
  private static CELL = 20;
  private grid = new Map<string, { a: [number, number]; b: [number, number]; h: number }[]>();
  constructor(private readonly survey: PedestrianSurvey = {}) {
    const C = SidewalkResolver.CELL;
    for (const l of survey.walkLines ?? [])
      for (let i = 0; i + 1 < l.pts.length; i++) {
        const a = l.pts[i];
        const b = l.pts[i + 1];
        for (let gx = Math.floor(Math.min(a[0], b[0]) / C); gx <= Math.floor(Math.max(a[0], b[0]) / C); gx++)
          for (
            let gz = Math.floor(Math.min(a[1], b[1]) / C);
            gz <= Math.floor(Math.max(a[1], b[1]) / C);
            gz++
          ) {
            const k = `${gx},${gz}`;
            let v = this.grid.get(k);
            if (!v) this.grid.set(k, (v = []));
            v.push({ a, b, h: l.h });
          }
      }
  }

  /** Yolda yayaya izin var mı (graf filtresi): OSM/ölçülmüş kaldırımı olan yan ya da ölçülmüş yürüme hattı */
  walkable(r: Road): boolean {
    const sw = sidewalkSides(r, this.survey.marks?.[r.id]);
    return sw.left || sw.right || (this.survey.walkLines?.length ?? 0) > 0;
  }

  /**
   * Eksen noktası (px, pz), birim yön (dx, dz), yan (±1; offset normali (−dz, dx) · side, roads.ts ile aynı).
   * Döner: dünya x, z ve arazinin üstündeki yürüme kotu.
   */
  resolve(
    r: Road,
    px: number,
    pz: number,
    dx: number,
    dz: number,
    side: number,
  ): { x: number; z: number; h: number } | null {
    const nx = -dz * side;
    const nz = dx * side;
    const half = r.width / 2;
    // 1) Ölçülmüş kaldırım hattı: bu yanda (normal yönünde ≥ half − 1), eksene dik uzaklığı ≤ half + 16
    const C = SidewalkResolver.CELL;
    let best: { x: number; z: number; h: number } | null = null;
    let bestD = Infinity;
    const reach = half + 16;
    const seen = new Set<unknown>();
    for (let gx = Math.floor((px - reach) / C); gx <= Math.floor((px + reach) / C); gx++)
      for (let gz = Math.floor((pz - reach) / C); gz <= Math.floor((pz + reach) / C); gz++)
        for (const s of this.grid.get(`${gx},${gz}`) ?? []) {
          if (seen.has(s)) continue;
          seen.add(s);
          const ex = s.b[0] - s.a[0];
          const ez = s.b[1] - s.a[1];
          const L2 = ex * ex + ez * ez || 1;
          const t = Math.max(0, Math.min(1, ((px - s.a[0]) * ex + (pz - s.a[1]) * ez) / L2));
          const qx = s.a[0] + ex * t;
          const qz = s.a[1] + ez * t;
          const lat = (qx - px) * nx + (qz - pz) * nz;
          const along = Math.abs((qx - px) * dx + (qz - pz) * dz);
          if (lat < half - 1 || lat > reach || along > 3) continue;
          const d = Math.hypot(qx - px, qz - pz);
          if (d < bestD) {
            bestD = d;
            best = { x: qx, z: qz, h: s.h };
          }
        }
    if (best) return best;
    // 2) OSM kaldırımı
    const sw = sidewalkSides(r, this.survey.marks?.[r.id]);
    // parse/roads: side +1 = sidewalkLeft (offsetPolyline +half)
    if (!(side > 0 ? sw.left : sw.right)) return null;
    const off = half + SIDEWALK_W / 2;
    const x = px + nx * off;
    const z = pz + nz * off;
    if ((this.survey.noSidewalk ?? []).some((q) => inFlatRing(q, x, z))) return null;
    return { x, z, h: CURB_H };
  }
}

interface Walker {
  edge: number;
  s: number;
  fwd: boolean;
  speed: number;
  /** Kaldırım tarafı (araç yolunda) */
  side: number;
  phase: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  wait: number;
}

/**
 * Yaya NPC'ler: yaya/yol grafiğinde rastgele rota, araç yollarında kaldırım üzerinde.
 * KARAR: en yakın K yaya iskeletli insan modeliyle (HumanPool), uzaktakiler kutu parçalı basit figürle (InstancedMesh, 6 draw call).
 */
export class Pedestrians {
  private humans: HumanPool;
  private movingFlags: boolean[] = [];
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  readonly group = new THREE.Group();
  private graph: Graph;
  private walkers: Walker[] = [];
  private parts: THREE.InstancedMesh[] = [];
  private rnd: () => number;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3(1, 1, 1);
  private tmp = new THREE.Matrix4();
  private geos: THREE.BufferGeometry[] = [];
  private mat: THREE.MeshStandardMaterial;

  private walk: SidewalkResolver;

  constructor(roads: Road[], quality: Quality, survey: PedestrianSurvey = {}) {
    this.group.name = 'pedestrians';
    this.walk = new SidewalkResolver(survey);
    this.graph = buildGraph(
      roads,
      (r) => WALKABLE.has(r.kind) && (r.vehicular ? this.walk.walkable(r) : true),
    );
    let seed = 1234;
    this.rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = this.graph.edges.length ? (quality === 'high' ? 60 : quality === 'medium' ? 36 : 16) : 0;
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.humans = new HumanPool(n ? (quality === 'high' ? 14 : quality === 'medium' ? 8 : 4) : 0);
    this.group.add(this.humans.group);
    void this.humans
      .init(import.meta.env.BASE_URL, quality !== 'low')
      .catch((e) => console.warn('Yaya modelleri yüklenemedi', e));
    // Parçalar: gövde, baş, sol/sağ bacak, sol/sağ kol (pivot üstte)
    const torso = new THREE.BoxGeometry(0.42, 0.62, 0.24).translate(0, 1.2, 0);
    const head = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.65, 0);
    const leg = new THREE.BoxGeometry(0.16, 0.86, 0.18).translate(0, -0.43, 0);
    const arm = new THREE.BoxGeometry(0.11, 0.6, 0.12).translate(0, -0.3, 0);
    this.geos.push(torso, head, leg, arm);
    const specs: [THREE.BufferGeometry, number][] = [
      [torso, 0],
      [head, 1],
      [leg, 2],
      [leg, 2],
      [arm, 3],
      [arm, 3],
    ];
    const shirts = [
      0x2f4d7a, 0x8a2e2e, 0xd8d2c4, 0x3b6b45, 0x222222, 0xc28a3a, 0x6a4c8a, 0x9aa3ad, 0x4f5f6f, 0xb85b7a,
    ];
    const pants = [0x1f2a3a, 0x2b2b2b, 0x4a3f33, 0x5a6470, 0x223355, 0x6b5a45];
    const skins = [0xf1c8a8, 0xe0b08c, 0xc98f6a, 0xa8714f, 0xf5d6bd];
    const col = new THREE.Color();
    for (const [g, kind] of specs) {
      const im = new THREE.InstancedMesh(g, this.mat, Math.max(1, n));
      im.frustumCulled = false;
      im.castShadow = quality !== 'low';
      im.count = n;
      this.parts.push(im);
      this.group.add(im);
      void kind;
    }
    for (let i = 0; i < n; i++) {
      const shirt = shirts[Math.floor(this.rnd() * shirts.length)];
      const pant = pants[Math.floor(this.rnd() * pants.length)];
      const skin = skins[Math.floor(this.rnd() * skins.length)];
      this.parts[0].setColorAt(i, col.set(shirt));
      this.parts[1].setColorAt(i, col.set(skin));
      this.parts[2].setColorAt(i, col.set(pant));
      this.parts[3].setColorAt(i, col.set(pant));
      this.parts[4].setColorAt(i, col.set(shirt));
      this.parts[5].setColorAt(i, col.set(shirt));
      this.walkers.push(this.spawn(0, 0, 120, true));
    }
  }

  get count(): number {
    return this.walkers.length;
  }

  private spawn(px: number, pz: number, radius: number, anywhere: boolean): Walker {
    const E = this.graph.edges;
    let edge = 0;
    let s = 0;
    let bestD = Infinity;
    for (let t = 0; t < 80; t++) {
      const e = Math.floor(this.rnd() * E.length);
      const ss = this.rnd() * E[e].len;
      const p = pointOn(E[e], ss);
      const d = Math.hypot(p.x - px, p.z - pz);
      const ok = d < radius && (anywhere || d > radius * 0.6) && this.placeable(E[e].road, p);
      if (ok || d < bestD) {
        edge = e;
        s = ss;
        bestD = d;
      }
      if (ok) break;
    }
    const first = pointOn(E[edge], s);
    return {
      edge,
      s,
      fwd: this.rnd() < 0.5,
      speed: 1.1 + this.rnd() * 0.5,
      side: this.rnd() < 0.5 ? 1 : -1,
      phase: this.rnd() * 10,
      x: first.x,
      y: 0,
      z: first.z,
      yaw: 0,
      wait: 0,
    };
  }

  /** Bu eksen noktasında yayanın durabileceği bir yan var mı */
  private placeable(r: Road, p: { x: number; z: number; dx: number; dz: number }): boolean {
    if (!r.vehicular) return true;
    return !!(
      this.walk.resolve(r, p.x, p.z, p.dx, p.dz, 1) || this.walk.resolve(r, p.x, p.z, p.dx, p.dz, -1)
    );
  }

  /** Hareketli engel daireleri [x, z, r] (oyuncu çarpışması). */
  obstacles(out: number[], px: number, pz: number): void {
    for (const w of this.walkers)
      if (Math.abs(w.x - px) < 20 && Math.abs(w.z - pz) < 20) out.push(w.x, w.z, 0.3);
  }

  update(dt: number, player: THREE.Vector3): void {
    const E = this.graph.edges;
    const N = this.graph.nodes;
    this.walkers.forEach((w, i) => {
      let e = E[w.edge];
      // Oyuncunun önündeyse dur (çarpmasın)
      const ahead = Math.hypot(player.x - w.x, player.z - w.z) < 1.1;
      const moving = !ahead && w.wait <= 0;
      if (w.wait > 0) w.wait -= dt;
      if (moving) {
        w.s += (w.fwd ? 1 : -1) * w.speed * dt;
        w.phase += dt * w.speed * 3.2;
      }
      if (w.s < 0 || w.s > e.len) {
        const node = w.s < 0 ? e.a : e.b;
        const opts = N[node].edges.filter((id) => id !== e.id);
        const next = opts.length ? opts[Math.floor(this.rnd() * opts.length)] : e.id;
        const ne = E[next];
        w.edge = next;
        w.fwd = ne.a === node;
        w.s = w.fwd ? 0 : ne.len;
        if (this.rnd() < 0.15) w.wait = 1 + this.rnd() * 3;
        e = ne;
      }
      const p = pointOn(e, w.s);
      const r = e.road;
      if (r.vehicular) {
        // Ölçülmüş kaldırım / izinli OSM kaldırımı; bu yanda yoksa karşı yan, o da yoksa yeniden doğ
        let q = this.walk.resolve(r, p.x, p.z, p.dx, p.dz, w.side);
        if (!q) {
          q = this.walk.resolve(r, p.x, p.z, p.dx, p.dz, -w.side);
          if (q) w.side = -w.side;
        }
        if (!q) {
          Object.assign(w, this.spawn(player.x, player.z, 130, false));
          for (const part of this.parts) part.setMatrixAt(i, this.hidden);
          this.movingFlags[i] = false;
          return;
        }
        w.x = q.x;
        w.z = q.z;
        w.y = H(w.x, w.z) + q.h;
      } else {
        w.x = p.x;
        w.z = p.z;
        w.y = H(w.x, w.z) + 0.03;
      }
      const dir = w.fwd ? 1 : -1;
      w.yaw = Math.atan2(p.dx * dir, p.dz * dir);
      // Uzaklaştıysa oyuncunun yakınında yeniden doğ
      if (Math.hypot(w.x - player.x, w.z - player.z) > 170) {
        Object.assign(w, this.spawn(player.x, player.z, 130, false));
        return;
      }
      this.movingFlags[i] = moving;
      this.pose(i, w, moving);
    });
    const used = this.humans.assign(this.walkers, this.movingFlags, player, dt);
    for (const i of used) for (const p of this.parts) p.setMatrixAt(i, this.hidden);
    for (const p of this.parts) {
      p.instanceMatrix.needsUpdate = true;
      if (p.instanceColor) p.instanceColor.needsUpdate = true;
    }
  }

  private pose(i: number, w: Walker, moving: boolean): void {
    const swing = moving ? Math.sin(w.phase) * 0.55 : 0;
    this.q.setFromEuler(this.e.set(0, w.yaw, 0));
    const base = this.m.compose(
      this.v.set(w.x, w.y + (moving ? Math.abs(Math.cos(w.phase)) * 0.03 : 0), w.z),
      this.q,
      this.sc,
    );
    this.parts[0].setMatrixAt(i, base);
    this.parts[1].setMatrixAt(i, base);
    const limb = (part: number, x: number, y: number, rot: number) => {
      this.tmp.makeRotationX(rot).setPosition(x, y, 0);
      this.parts[part].setMatrixAt(i, this.tmp.premultiply(base));
    };
    limb(2, -0.1, 0.9, swing);
    limb(3, 0.1, 0.9, -swing);
    limb(4, -0.27, 1.48, -swing * 0.8);
    limb(5, 0.27, 1.48, swing * 0.8);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
  }
}
