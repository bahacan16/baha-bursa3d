import * as THREE from 'three';
import {
  buildCar,
  CAR_COLORS,
  CAR_KINDS,
  CarMaterials,
  carKindOf,
  PLATE_COUNT,
  type CarModel,
} from './carmodel';
import { buildGraph, pointOn, type Graph } from './graph';
import type { Road } from '../worlds/osm/parse';
import type { Quality } from '../core/settings';
import { H } from '../worlds/osm/height';
import type { SoundCar } from '../env/sound/types';

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
  lane: number;
  /** Tür ve tür içindeki instance sırası */
  kind: number;
  slot: number;
  spin: number;
}

interface KindMesh {
  model: CarModel;
  body: THREE.InstancedMesh;
  trim: THREE.InstancedMesh;
  wheels: THREE.InstancedMesh;
}

/**
 * Hareketli araçlar: araç yolu grafiği, sağ şerit takibi, tek yön kuralı,
 * kavşakta kısa bekleme, öndeki araca ve oyuncuya çarpmadan durma. Tekerler dönerek ilerler.
 */
export class Traffic {
  readonly group = new THREE.Group();
  private graph: Graph;
  private cars: Car[] = [];
  private kinds: KindMesh[] = [];
  private rnd: () => number;
  private mats = new CarMaterials();
  private m = new THREE.Matrix4();
  private w = new THREE.Matrix4();
  private r = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private flip = new THREE.Matrix4().makeRotationY(Math.PI);

  constructor(roads: Road[], quality: Quality) {
    this.group.name = 'traffic';
    this.graph = buildGraph(roads, (r) => r.vehicular || r.kind === 'living_street');
    let seed = 99;
    this.rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = this.graph.edges.length ? (quality === 'high' ? 40 : quality === 'medium' ? 24 : 10) : 0;
    const shadows = quality !== 'low';
    const perKind = [0, 0, 0, 0];
    const kindOf: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = carKindOf(i * 13 + 5);
      kindOf.push(k);
      perKind[k]++;
    }
    CAR_KINDS.forEach((kind, k) => {
      const model = buildCar(kind, 0, false);
      const cap = Math.max(1, perKind[k]);
      const trimGeo = model.trim.clone();
      const plate = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      trimGeo.setAttribute('plateId', plate);
      const body = new THREE.InstancedMesh(model.body, this.mats.list(model.bodyMats), cap);
      const trim = new THREE.InstancedMesh(trimGeo, this.mats.list(model.trimMats), cap);
      const wheels = new THREE.InstancedMesh(model.wheel, this.mats.list(model.wheelMats), cap * 4);
      body.castShadow = shadows;
      body.receiveShadow = shadows;
      body.name = 'trafficBody';
      trim.name = 'trafficTrim';
      wheels.name = 'trafficWheels';
      for (const im of [body, trim, wheels]) {
        im.count = perKind[k] * (im === wheels ? 4 : 1);
        im.frustumCulled = false;
        this.group.add(im);
      }
      for (let i = 0; i < cap; i++) plate.setX(i, Math.floor(this.rnd() * PLATE_COUNT));
      this.kinds.push({ model, body, trim, wheels });
    });
    const used = [0, 0, 0, 0];
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const k = kindOf[i];
      const slot = used[k]++;
      this.kinds[k].body.setColorAt(slot, col.set(CAR_COLORS[Math.floor(this.rnd() * CAR_COLORS.length)]));
      this.cars.push({ ...this.spawn(0, 0, 400, true), kind: k, slot, spin: 0 });
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

  private spawn(
    px: number,
    pz: number,
    radius: number,
    anywhere: boolean,
  ): Omit<Car, 'kind' | 'slot' | 'spin'> {
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

  private soundOut: SoundCar[] = [];

  /** Ses için araçların anlık durumu (nesneler yeniden kullanılır; kimlik = araç sırası). */
  soundCars(): readonly SoundCar[] {
    const out = this.soundOut;
    this.cars.forEach((c, i) => {
      const o = out[i] ?? (out[i] = { id: i, x: 0, y: 0, z: 0, yaw: 0, speed: 0, kind: 0 });
      o.x = c.x;
      o.y = c.y;
      o.z = c.z;
      o.yaw = c.yaw;
      o.speed = c.speed;
      o.kind = c.kind;
    });
    out.length = this.cars.length;
    return out;
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
    this.mats.lights.emissiveIntensity = 0.15 + night * 3;
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
      // Dar yollarda (park eden araçlar var) yol ortasına yakın
      const lane = e.road.oneway ? 0 : e.road.width < 8 ? 0.95 : Math.min(e.road.width / 4, 2.2);
      // İleri f = (dx, dz)·dir; sağ = (−fz, fx)  (kuzey → doğu)
      const rx = -p.dz * dir;
      const rz = p.dx * dir;
      c.x = p.x + rx * lane;
      c.z = p.z + rz * lane;
      c.y = H(c.x, c.z) + 0.02;
      const ty = Math.atan2(p.dx * dir, p.dz * dir);
      let dy = ty - c.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      c.yaw += dy * Math.min(1, dt * 8);
      if (Math.hypot(c.x - player.x, c.z - player.z) > 450) {
        Object.assign(c, this.spawn(player.x, player.z, 380, false));
        continue;
      }
      const km = this.kinds[c.kind];
      c.spin = (c.spin + (c.speed * dt) / km.model.wheelPos[0][1]) % (Math.PI * 2);
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), c.yaw);
      this.m.compose(this.v.set(c.x, c.y, c.z), this.q, this.one);
      km.body.setMatrixAt(c.slot, this.m);
      km.trim.setMatrixAt(c.slot, this.m);
      km.model.wheelPos.forEach((wp, k) => {
        this.w.copy(this.m).multiply(this.r.makeTranslation(wp[0], wp[1], wp[2]));
        if (wp[0] < 0) this.w.multiply(this.flip).multiply(this.r.makeRotationX(-c.spin));
        else this.w.multiply(this.r.makeRotationX(c.spin));
        km.wheels.setMatrixAt(c.slot * 4 + k, this.w);
      });
    }
    for (const k of this.kinds) {
      for (const im of [k.body, k.trim, k.wheels]) im.instanceMatrix.needsUpdate = true;
      if (k.body.instanceColor) k.body.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const k of this.kinds) {
      for (const g of [k.model.body, k.model.trim, k.model.wheel, k.trim.geometry]) g.dispose();
    }
    this.mats.dispose();
  }
}
