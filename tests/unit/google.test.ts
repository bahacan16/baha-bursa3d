import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SpawnController, type GroundProbe } from '../../src/worlds/google/spawn';
import { TilesCollisionWorld } from '../../src/worlds/google/collision';
import { CharacterController } from '../../src/player/controller';

class MockProbe implements GroundProbe {
  y: number | null = null;
  probe(): number | null {
    return this.y;
  }
}

const idleCtl = () =>
  new CharacterController({ moveHorizontal: () => {}, groundHeight: () => null, raycast: () => null });

describe('Mod A spawn / dondurma (tiles mock)', () => {
  it('zemin yokken oyuncu donuk kalır, düşmez', () => {
    const probe = new MockProbe();
    const s = new SpawnController(probe);
    const c = idleCtl();
    c.teleport(0, 450, 0);
    s.reset(0, 0);
    for (let i = 0; i < 120; i++) {
      s.update(1 / 60, c, false);
      c.update(1 / 60, { moveX: 0, moveY: 1, run: false, jump: false, cameraYaw: 0 });
    }
    expect(s.state).toBe('waiting');
    expect(c.hold).toBe(true);
    expect(c.position.y).toBe(450);
  });

  it('isabet gelince önce zemine yaklaşır, yerleşince fizik açılır', () => {
    const probe = new MockProbe();
    const s = new SpawnController(probe);
    const c = idleCtl();
    c.teleport(0, 450, 0);
    s.reset(0, 0);
    probe.y = 152.3;
    s.update(1 / 60, c, false);
    expect(s.state).toBe('settling');
    expect(c.position.y).toBeCloseTo(152.8);
    expect(c.hold).toBe(true);
    for (let i = 0; i < 60 * 3; i++) s.update(1 / 60, c, false);
    expect(s.state).toBe('settling'); // indirmeler sürüyor
    s.update(1 / 60, c, true);
    expect(s.state).toBe('ready');
    expect(c.hold).toBe(false);
    expect(c.position.y).toBeCloseTo(152.35);
  });

  it('uzun süre isabet yoksa kapsam yok', () => {
    const s = new SpawnController(new MockProbe());
    const c = idleCtl();
    s.reset(0, 0);
    for (let i = 0; i < 60 * 50; i++) s.update(1 / 60, c, true);
    expect(s.state).toBe('nocoverage');
  });

  it('oyun sırasında altındaki tile boşalırsa kontrolcü donar', () => {
    let ground: number | null = 10;
    const c = new CharacterController({
      moveHorizontal: () => {},
      groundHeight: () => ground,
      raycast: () => null,
    });
    c.teleport(0, 10, 0);
    c.update(1 / 60, { moveX: 0, moveY: 0, run: false, jump: false, cameraYaw: 0 });
    ground = null;
    for (let i = 0; i < 60; i++)
      c.update(1 / 60, { moveX: 0, moveY: 1, run: false, jump: false, cameraYaw: 0 });
    expect(c.frozen).toBe(true);
    expect(c.position.y).toBe(10);
  });
});

describe('BVH mesh çarpışması', () => {
  function world() {
    const w = new TilesCollisionWorld();
    const scene = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial(),
    );
    floor.position.y = 150;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(60, 20, 1), new THREE.MeshBasicMaterial());
    wall.position.set(0, 160, -10); // ön yüz z = −9.5
    scene.add(floor, wall);
    scene.updateMatrixWorld(true);
    w.addModel(scene);
    w.setVisible(scene, true);
    w.bvhBudgetPerUpdate = 10;
    w.refresh(new THREE.Vector3(0, 150, 0));
    return w;
  }

  it('aşağı raycast zemini bulur', () => {
    const w = world();
    expect(w.groundHeight(3, 3, 150)).toBeCloseTo(150);
    expect(w.probe(3, 3)).toBeCloseTo(150);
    expect(w.groundHeight(300, 3, 150)).toBeNull();
  });

  it('duvara doğru yürüyünce durur ve kayar', () => {
    const w = world();
    const p = new THREE.Vector3(0, 150, 0);
    for (let i = 0; i < 300; i++) w.moveHorizontal(p, 0.02, -5.5 / 60, 0.35);
    expect(p.z).toBeGreaterThan(-9.5 - 0.01);
    expect(p.z).toBeLessThan(-8.5);
    expect(p.x).toBeGreaterThan(3); // duvar boyunca kaydı
  });

  it('kamera raycast duvara isabet eder', () => {
    const w = world();
    const d = w.raycast(new THREE.Vector3(0, 151.5, 0), new THREE.Vector3(0, 0, -1), 20);
    expect(d).toBeCloseTo(9.5);
  });
});

describe('ReorientationPlugin hizalaması (ENU)', () => {
  it('Y etrafında 180° çevrilmiş çerçevede kuzey −Z, doğu +X, yukarı +Y', async () => {
    const { TilesRenderer } = await import('3d-tiles-renderer');
    const { ReorientationPlugin } = await import('3d-tiles-renderer/plugins');
    const { toLocal } = await import('../../src/core/geo');
    const DEG = Math.PI / 180;
    const c = { lat: 40.218262, lon: 28.909611 };
    const tiles = new TilesRenderer();
    const plugin = new ReorientationPlugin({ lat: c.lat * DEG, lon: c.lon * DEG });
    tiles.registerPlugin(plugin);
    plugin.transformLatLonHeightToOrigin(c.lat * DEG, c.lon * DEG, 0);
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI;
    holder.add(tiles.group);
    holder.updateMatrixWorld(true);
    const toGame = (lat: number, lon: number, h = 0) => {
      const ecef = new THREE.Vector3();
      tiles.ellipsoid.getCartographicToPosition(lat * DEG, lon * DEG, h, ecef);
      return ecef.applyMatrix4(tiles.group.matrixWorld);
    };
    const o = toGame(c.lat, c.lon);
    expect(o.length()).toBeLessThan(0.01);
    const north = { lat: c.lat + 0.003, lon: c.lon };
    const east = { lat: c.lat, lon: c.lon + 0.003 };
    const n = toGame(north.lat, north.lon);
    const e = toGame(east.lat, east.lon);
    const up = toGame(c.lat, c.lon, 10);
    // OSM yerel dönüşümüyle birkaç cm içinde aynı olmalı
    const nl = toLocal(north, c);
    const el = toLocal(east, c);
    expect(Math.abs(n.x - nl.x)).toBeLessThan(0.5);
    expect(Math.abs(n.z - nl.z)).toBeLessThan(0.5);
    expect(Math.abs(e.x - el.x)).toBeLessThan(0.5);
    expect(Math.abs(e.z - el.z)).toBeLessThan(0.5);
    expect(up.y).toBeCloseTo(10, 2);
  });
});
