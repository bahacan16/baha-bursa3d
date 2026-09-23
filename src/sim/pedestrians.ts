import * as THREE from 'three';
import { buildGraph, pointOn, type Graph } from './graph';
import type { Road } from '../worlds/osm/parse';
import type { Quality } from '../core/settings';
import { H } from '../worlds/osm/height';
import { SIDEWALK_W, CURB_H } from '../worlds/osm/roads';

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
 * KARAR: İskeletli karakter kopyaları çok draw call ettiğinden kutu parçalı basit insan figürleri (InstancedMesh, 6 draw call).
 */
export class Pedestrians {
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

  constructor(roads: Road[], quality: Quality) {
    this.group.name = 'pedestrians';
    this.graph = buildGraph(
      roads,
      (r) => WALKABLE.has(r.kind) && (r.vehicular ? r.sidewalkLeft || r.sidewalkRight : true),
    );
    let seed = 1234;
    this.rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = this.graph.edges.length ? (quality === 'high' ? 60 : quality === 'medium' ? 36 : 16) : 0;
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
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
      const ok = d < radius && (anywhere || d > radius * 0.6);
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
      const off = r.vehicular ? (r.width / 2 + SIDEWALK_W / 2) * w.side : 0;
      w.x = p.x - p.dz * off;
      w.z = p.z + p.dx * off;
      w.y = H(w.x, w.z) + (r.vehicular ? CURB_H : 0.03);
      const dir = w.fwd ? 1 : -1;
      w.yaw = Math.atan2(p.dx * dir, p.dz * dir);
      // Uzaklaştıysa oyuncunun yakınında yeniden doğ
      if (Math.hypot(w.x - player.x, w.z - player.z) > 170) {
        Object.assign(w, this.spawn(player.x, player.z, 130, false));
        return;
      }
      this.pose(i, w, moving);
    });
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
