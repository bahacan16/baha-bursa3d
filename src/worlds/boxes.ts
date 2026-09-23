import * as THREE from 'three';
import { PolygonCollisionWorld } from './osm/collision';
import type { IWorld } from './world';

/** Faz 1 test dünyası: düz zemin + birkaç kutu/duvar. */
export class BoxesWorld implements IWorld {
  readonly kind = 'boxes' as const;
  readonly object = new THREE.Group();
  readonly collision = new PolygonCollisionWorld();
  readonly spawn = new THREE.Vector3(0, 0, 0);

  constructor() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 }),
    );
    ground.receiveShadow = true;
    this.object.add(ground);
    const grid = new THREE.GridHelper(200, 40, 0x666055, 0x777266);
    grid.position.y = 0.01;
    this.object.add(grid);

    const mat = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.85 });
    const boxes: [number, number, number, number, number][] = [
      [0, -12, 8, 4, 3],
      [-10, -6, 3, 3, 6],
      [10, -20, 6, 12, 15],
      [-14, -24, 10, 3, 1.2],
      [4, 8, 1.5, 1.5, 0.8],
    ];
    for (const [x, z, w, d, h] of boxes) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      m.castShadow = m.receiveShadow = true;
      this.object.add(m);
      this.collision.addBox(x, z, w, d, h);
    }
    // İç köşe testi için L duvar
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb35d3c, roughness: 0.9 });
    const wall = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), wallMat);
      m.position.set(x, 1.1, z);
      m.castShadow = m.receiveShadow = true;
      this.object.add(m);
      this.collision.addBox(x, z, w, d, 2.2);
    };
    wall(18, 0, 0.3, 14);
    wall(12.15, 7, 12, 0.3);
  }

  update(): void {}

  attributionHtml(): string {
    return 'Test sahnesi';
  }

  dispose(): void {
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
