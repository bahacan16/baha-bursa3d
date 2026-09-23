import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildGraph, pointOn, type Graph } from './graph';
import type { Road } from '../worlds/osm/parse';
import type { Quality } from '../core/settings';
import { H } from '../worlds/osm/height';

interface Car {
  edge: number;
  s: number;
  fwd: boolean;
  speed: number;
  maxSpeed: number;
  wait: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Sonraki kenar (kavşakta önceden seçilir) */
  lane: number;
}

const CAR_COLORS = [
  0xf2f2f0, 0xd9d9d6, 0x1c1c1e, 0x8f969c, 0x5d6066, 0x9b1d20, 0x1f3f75, 0xc9b27c, 0x2d4a36, 0xe8e8e8,
  0x3a3a3c,
];

/**
 * Hareketli araçlar: araç yolu grafiği, sağ şerit takibi, tek yön kuralı,
 * kavşakta kısa bekleme, öndeki araca ve oyuncuya çarpmadan durma.
 */
export class Traffic {
  readonly group = new THREE.Group();
  private graph: Graph;
  private cars: Car[] = [];
  private body: THREE.InstancedMesh;
  private glass: THREE.InstancedMesh;
  private wheels: THREE.InstancedMesh;
  private lightsMesh: THREE.InstancedMesh;
  private rnd: () => number;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  lightsMat: THREE.MeshStandardMaterial;

  constructor(roads: Road[], quality: Quality) {
    this.group.name = 'traffic';
    this.graph = buildGraph(roads, (r) => r.vehicular || r.kind === 'living_street');
    let seed = 99;
    this.rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = this.graph.edges.length ? (quality === 'high' ? 40 : quality === 'medium' ? 24 : 10) : 0;
    // Sedan: gövde + kabin (+Z = ön)
    const body = mergeGeometries([
      new THREE.BoxGeometry(1.78, 0.62, 4.4).translate(0, 0.58, 0),
      new THREE.BoxGeometry(1.6, 0.18, 4.1).translate(0, 0.98, -0.05),
    ]);
    const glass = new THREE.BoxGeometry(1.52, 0.5, 2.1).translate(0, 1.3, -0.25);
    const wheel = mergeGeometries(
      [
        [-0.82, 1.38],
        [0.82, 1.38],
        [-0.82, -1.38],
        [0.82, -1.38],
      ].map(([x, z]) =>
        new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateZ(Math.PI / 2).translate(x, 0.33, z),
      ),
    );
    const lights = mergeGeometries([
      new THREE.BoxGeometry(0.35, 0.12, 0.05).translate(-0.6, 0.7, 2.21),
      new THREE.BoxGeometry(0.35, 0.12, 0.05).translate(0.6, 0.7, 2.21),
    ]);
    this.geos.push(body, glass, wheel, lights);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2229, roughness: 0.1, metalness: 0.6 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    this.lightsMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      emissive: 0xfff1cc,
      emissiveIntensity: 0,
    });
    this.mats.push(bodyMat, glassMat, wheelMat, this.lightsMat);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, shadow: boolean) => {
      const im = new THREE.InstancedMesh(g, m, Math.max(1, n));
      im.count = n;
      im.frustumCulled = false;
      im.castShadow = shadow && quality !== 'low';
      this.group.add(im);
      return im;
    };
    this.body = mk(body, bodyMat, true);
    this.glass = mk(glass, glassMat, false);
    this.wheels = mk(wheel, wheelMat, false);
    this.lightsMesh = mk(lights, this.lightsMat, false);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.body.setColorAt(i, col.set(CAR_COLORS[Math.floor(this.rnd() * CAR_COLORS.length)]));
      this.cars.push(this.spawn(0, 0, 400, true));
    }
  }

  get count(): number {
    return this.cars.length;
  }

  private allowed(edgeId: number, fromNode: number): boolean {
    const e = this.graph.edges[edgeId];
    const fwd = e.a === fromNode;
    return e.road.oneway === 0 || (e.road.oneway === 1 ? fwd : !fwd);
  }

  private spawn(px: number, pz: number, radius: number, anywhere: boolean): Car {
    const E = this.graph.edges;
    let edge = 0;
    let s0 = 0;
    let bestD = Infinity;
    for (let t = 0; t < 80; t++) {
      const k = Math.floor(this.rnd() * E.length);
      const ss = this.rnd() * E[k].len;
      const p = pointOn(E[k], ss);
      const d = Math.hypot(p.x - px, p.z - pz);
      const ok = d < radius && (anywhere || d > radius * 0.55);
      if (ok || d < bestD) {
        edge = k;
        s0 = ss;
        bestD = d;
      }
      if (ok) break;
    }
    const e = E[edge];
    const at = pointOn(e, s0);
    const fwd = e.road.oneway === 1 ? true : e.road.oneway === -1 ? false : this.rnd() < 0.5;
    const maxSpeed =
      e.road.kind === 'primary' || e.road.kind === 'secondary' || e.road.kind === 'trunk'
        ? 13
        : e.road.kind === 'living_street'
          ? 4
          : 8.5;
    return {
      edge,
      s: s0,
      fwd,
      speed: maxSpeed * 0.8,
      maxSpeed: maxSpeed * (0.85 + this.rnd() * 0.25),
      wait: 0,
      x: at.x,
      y: 0,
      z: at.z,
      yaw: 0,
      lane: 0,
    };
  }

  nearest(x: number, z: number): number {
    let d = Infinity;
    for (const c of this.cars) d = Math.min(d, Math.hypot(c.x - x, c.z - z));
    return d;
  }

  obstacles(out: number[], px: number, pz: number): void {
    for (const c of this.cars) {
      if (Math.abs(c.x - px) > 25 || Math.abs(c.z - pz) > 25) continue;
      // İki daire: ön ve arka yarı
      const fx = Math.sin(c.yaw) * 1.1;
      const fz = Math.cos(c.yaw) * 1.1;
      out.push(c.x + fx, c.z + fz, 1.0, c.x - fx, c.z - fz, 1.0);
    }
  }

  update(dt: number, player: THREE.Vector3, night: number): void {
    const E = this.graph.edges;
    const N = this.graph.nodes;
    this.lightsMat.emissiveIntensity = night * 3;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      let e = E[c.edge];
      // Önündeki engel: oyuncu veya başka araç (yön vektörüne göre 3–12 m)
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      let block = Infinity;
      const check = (x: number, z: number, lateral: number) => {
        const dx = x - c.x;
        const dz = z - c.z;
        const along = dx * fx + dz * fz;
        const side = Math.abs(-dx * fz + dz * fx);
        if (along > 0 && along < 14 && side < lateral) block = Math.min(block, along);
      };
      check(player.x, player.z, 2.0);
      for (let k = 0; k < this.cars.length; k++) if (k !== i) check(this.cars[k].x, this.cars[k].z, 1.6);
      let target = c.maxSpeed;
      if (block < 14) target = Math.min(target, Math.max(0, (block - 5.5) * 1.5));
      const toEnd = c.fwd ? e.len - c.s : c.s;
      if (toEnd < 12) target = Math.min(target, 5); // kavşağa yaklaşırken yavaşla
      if (c.wait > 0) {
        c.wait -= dt;
        target = 0;
      }
      const acc = target > c.speed ? 2.5 : 6;
      c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), acc * dt);
      c.s += (c.fwd ? 1 : -1) * c.speed * dt;
      if (c.s < 0 || c.s > e.len) {
        const node = c.s < 0 ? e.a : e.b;
        let opts = N[node].edges.filter((id) => id !== e.id && this.allowed(id, node));
        if (!opts.length) opts = N[node].edges.filter((id) => this.allowed(id, node));
        const next = opts.length ? opts[Math.floor(this.rnd() * opts.length)] : e.id;
        const ne = E[next];
        c.edge = next;
        c.fwd = ne.a === node;
        if (next === e.id) c.fwd = !c.fwd; // çıkmaz: geri dön
        c.s = c.fwd ? 0 : ne.len;
        // Kavşakta kısa duraksama
        if (N[node].edges.length > 2 && this.rnd() < 0.35) c.wait = 0.6 + this.rnd() * 1.6;
        const mk = ne.road.kind;
        c.maxSpeed =
          (mk === 'primary' || mk === 'secondary' || mk === 'trunk' ? 13 : mk === 'living_street' ? 4 : 8.5) *
          (0.85 + this.rnd() * 0.25);
        e = ne;
      }
      const p = pointOn(e, c.s);
      const dir = c.fwd ? 1 : -1;
      // Sağ şerit (Türkiye: sağdan akış). Tek yönde yol ortası.
      const lane = e.road.oneway ? 0 : Math.min(e.road.width / 4, 2.2);
      // İleri f = (dx, dz)·dir; sağ = (−fz, fx)  (kuzey → doğu)
      const rx = -p.dz * dir;
      const rz = p.dx * dir;
      c.x = p.x + rx * lane;
      c.z = p.z + rz * lane;
      c.y = H(c.x, c.z) + 0.04;
      const ty = Math.atan2(p.dx * dir, p.dz * dir);
      let dy = ty - c.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      c.yaw += dy * Math.min(1, dt * 8);
      if (Math.hypot(c.x - player.x, c.z - player.z) > 450) {
        Object.assign(this.cars[i], this.spawn(player.x, player.z, 380, false));
        continue;
      }
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), c.yaw);
      this.m.compose(this.v.set(c.x, c.y, c.z), this.q, this.one);
      this.body.setMatrixAt(i, this.m);
      this.glass.setMatrixAt(i, this.m);
      this.wheels.setMatrixAt(i, this.m);
      this.lightsMesh.setMatrixAt(i, this.m);
    }
    for (const im of [this.body, this.glass, this.wheels, this.lightsMesh])
      im.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
