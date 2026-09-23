import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PolygonCollisionWorld } from '../../src/worlds/osm/collision';
import { CharacterController } from '../../src/player/controller';

const R = 0.35;

function walk(world: PolygonCollisionWorld, start: [number, number], dir: [number, number], steps = 300) {
  const p = new THREE.Vector3(start[0], 0, start[1]);
  const l = Math.hypot(dir[0], dir[1]);
  const v = 5.5 / 60;
  for (let i = 0; i < steps; i++) world.moveHorizontal(p, (dir[0] / l) * v, (dir[1] / l) * v, R);
  return p;
}

describe('PolygonCollisionWorld', () => {
  it('duvara doğru yürüyünce içeri girmez', () => {
    const w = new PolygonCollisionWorld();
    w.addBox(0, 0, 10, 10); // x,z ∈ [-5, 5]
    const p = walk(w, [-10, 0], [1, 0]);
    expect(p.x).toBeLessThanOrEqual(-5 - R + 1e-3);
    expect(p.x).toBeGreaterThan(-5 - R - 0.05);
  });

  it('eğik yürüyünce duvar boyunca kayar', () => {
    const w = new PolygonCollisionWorld();
    w.addBox(0, 0, 10, 10);
    const p = walk(w, [-10, -3], [1, 0.3], 100);
    expect(p.x).toBeLessThanOrEqual(-5 - R + 1e-3);
    // z doğrultusunda ilerlemiş olmalı
    expect(p.z).toBeGreaterThan(-3 + 1);
  });

  it('dış köşede takılmaz (etrafından kayarak geçer)', () => {
    const w = new PolygonCollisionWorld();
    w.addBox(0, 0, 10, 10);
    // köşeye (−5, −5) çapraz, köşenin hafif üstünden
    const p = walk(w, [-10, -5.2], [1, 0], 200);
    expect(p.x).toBeGreaterThan(5); // köşeyi dönüp geçti
  });

  it('iç köşede durur ve iki duvarın da dışında kalır', () => {
    const w = new PolygonCollisionWorld();
    // L şeklinde iki duvar: x=0 ve z=0, iç köşe (0,0), oyuncu (−, −) bölgesinde
    w.addPolyline([
      [0, -10],
      [0, 0],
      [-10, 0],
    ]);
    const p = walk(w, [-5, -5], [1, 1], 300);
    expect(p.x).toBeLessThanOrEqual(-R + 1e-3);
    expect(p.z).toBeLessThanOrEqual(-R + 1e-3);
    expect(p.x).toBeGreaterThan(-R - 0.05);
    expect(p.z).toBeGreaterThan(-R - 0.05);
  });

  it('dar koridorda iki duvar arasında sıkışmadan ilerler', () => {
    const w = new PolygonCollisionWorld();
    w.addPolyline([
      [-20, -0.5],
      [20, -0.5],
    ]);
    w.addPolyline([
      [-20, 0.5],
      [20, 0.5],
    ]);
    const p = walk(w, [-15, 0.2], [1, 0.4], 200);
    expect(p.x).toBeGreaterThan(0);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(0.5 - R + 1e-3);
  });

  it('kamera raycast duvarda durur, üstünden geçen ışın isabet etmez', () => {
    const w = new PolygonCollisionWorld();
    w.addBox(0, 0, 2, 2, 3);
    const d = w.raycast(new THREE.Vector3(-5, 1.5, 0), new THREE.Vector3(1, 0, 0), 10);
    expect(d).toBeCloseTo(4);
    const over = w.raycast(new THREE.Vector3(-5, 5, 0), new THREE.Vector3(1, 0, 0), 10);
    expect(over).toBeNull();
  });
});

describe('CharacterController', () => {
  const input = { moveX: 0, moveY: 1, run: false, jump: false, cameraYaw: 0 };

  it('ileri (kuzey, −Z) yürür ve hız yürüme hızına yaklaşır', () => {
    const w = new PolygonCollisionWorld();
    const c = new CharacterController(w);
    for (let i = 0; i < 120; i++) c.update(1 / 60, input);
    expect(c.position.z).toBeLessThan(-2);
    expect(c.horizontalSpeed).toBeCloseTo(1.6, 1);
  });

  it('zıplar ve yere geri iner (~1 m)', () => {
    const w = new PolygonCollisionWorld();
    const c = new CharacterController(w);
    c.update(1 / 60, { ...input, moveY: 0 });
    let maxY = 0;
    c.update(1 / 60, { ...input, moveY: 0, jump: true });
    for (let i = 0; i < 120; i++) {
      c.update(1 / 60, { ...input, moveY: 0 });
      maxY = Math.max(maxY, c.position.y);
    }
    expect(maxY).toBeGreaterThan(0.9);
    expect(maxY).toBeLessThan(1.1);
    expect(c.position.y).toBe(0);
    expect(c.onGround).toBe(true);
  });

  it('zemin verisi yoksa dondurulur, düşmez', () => {
    const w = new PolygonCollisionWorld();
    w.ground = () => null;
    const c = new CharacterController(w);
    c.teleport(0, 10, 0);
    for (let i = 0; i < 60; i++) c.update(1 / 60, input);
    expect(c.frozen).toBe(true);
    expect(c.position.y).toBe(10);
  });

  it('0.35 m basamağı çıkar, daha yükseğini çıkamaz', () => {
    const w = new PolygonCollisionWorld();
    w.ground = (_x, z) => (z < -3 ? 0.15 : 0);
    const c = new CharacterController(w);
    for (let i = 0; i < 240; i++) c.update(1 / 60, input);
    expect(c.position.z).toBeLessThan(-4);
    expect(c.position.y).toBeCloseTo(0.15);

    const w2 = new PolygonCollisionWorld();
    w2.ground = (_x, z) => (z < -3 ? 1 : 0);
    const c2 = new CharacterController(w2);
    for (let i = 0; i < 240; i++) c2.update(1 / 60, input);
    expect(c2.position.z).toBeGreaterThan(-3);
  });

  it('bölge sınırını (1000 m) aşamaz', () => {
    const w = new PolygonCollisionWorld();
    const c = new CharacterController(w);
    c.teleport(0, 0, -995);
    for (let i = 0; i < 300; i++) c.update(1 / 60, { ...input, run: true });
    expect(Math.hypot(c.position.x, c.position.z)).toBeLessThanOrEqual(1000 + 1e-6);
  });
});
