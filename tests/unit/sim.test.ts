import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildGraph, pointOn } from '../../src/sim/graph';
import { Traffic } from '../../src/sim/traffic';
import { Pedestrians } from '../../src/sim/pedestrians';
import type { Road } from '../../src/worlds/osm/parse';

const road = (id: string, pts: [number, number][], extra: Partial<Road> = {}): Road => ({
  id,
  kind: 'residential',
  pts,
  width: 6.5,
  sidewalkLeft: true,
  sidewalkRight: true,
  layer: 0,
  bridge: false,
  tunnel: false,
  area: false,
  vehicular: true,
  oneway: 0,
  ...extra,
});

// + şekilli kavşak
const roads = [
  road('a', [
    [-100, 0],
    [0, 0],
    [100, 0],
  ]),
  road('b', [
    [0, -100],
    [0, 0],
    [0, 100],
  ]),
];

describe('yol grafiği', () => {
  it('kavşakta kenarlar bölünür', () => {
    const g = buildGraph(roads, () => true);
    expect(g.edges.length).toBe(4);
    const center = g.nodes.find((n) => n.x === 0 && n.z === 0)!;
    expect(center.edges.length).toBe(4);
    const p = pointOn(g.edges[0], g.edges[0].len / 2);
    expect(Math.hypot(p.dx, p.dz)).toBeCloseTo(1);
  });
});

describe('trafik', () => {
  it('araçlar sağ şeritte, oyuncu önündeyse durur', () => {
    const t = new Traffic(
      [
        road('c', [
          [-300, 0],
          [300, 0],
        ]),
      ],
      'low',
    );
    const cars = (
      t as unknown as { cars: { x: number; z: number; speed: number; yaw: number; fwd: boolean }[] }
    ).cars;
    const far = new THREE.Vector3(0, 0, 150);
    for (let i = 0; i < 30; i++) t.update(1 / 30, far, 0);
    for (const c of cars) {
      // +X yönünde giden araç sağda (güney, +Z), −X yönünde giden kuzeyde
      const dirX = Math.sin(c.yaw);
      if (Math.abs(dirX) > 0.9) expect(Math.sign(c.z)).toBe(Math.sign(dirX));
    }
    // Oyuncuyu ilk aracın 6 m önüne koy → birkaç saniyede durmalı
    const c = cars[0];
    const ahead = new THREE.Vector3(c.x + Math.sin(c.yaw) * 7, 0, c.z + Math.cos(c.yaw) * 7);
    for (let i = 0; i < 90; i++) t.update(1 / 30, ahead, 0);
    expect(c.speed).toBeLessThan(0.5);
  });

  it('tek yön kuralına uyar', () => {
    const t = new Traffic(
      [
        road(
          'd',
          [
            [-300, 0],
            [300, 0],
          ],
          { oneway: 1 },
        ),
      ],
      'low',
    );
    const cars = (t as unknown as { cars: { yaw: number }[] }).cars;
    for (let i = 0; i < 60; i++) t.update(1 / 30, new THREE.Vector3(0, 0, 150), 0);
    for (const c of cars) expect(Math.sin(c.yaw)).toBeGreaterThan(0.5);
  });
});

describe('yayalar', () => {
  it('kaldırımda yürür (araç yolu şeridinde değil)', () => {
    const p = new Pedestrians(roads, 'low');
    const walkers = (p as unknown as { walkers: { x: number; z: number }[] }).walkers;
    for (let i = 0; i < 60; i++) p.update(1 / 30, new THREE.Vector3(0, 0, 0));
    for (const w of walkers) {
      if (Math.abs(w.x) < 9 && Math.abs(w.z) < 9) continue; // kavşakta karşıya geçiş
      const dRoad = Math.min(Math.abs(w.z), Math.abs(w.x));
      expect(dRoad).toBeGreaterThan(3.2);
    }
  });
});
