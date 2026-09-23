import * as THREE from 'three';
import type { GridData } from './terrain';

/**
 * Uzak arazi (Bursa ovası + Uludağ silüeti) — gerçek yükseklik verisinden kaba mesh.
 * Ayrı bir "arka plan" sahnesinde uzun menzilli kamerayla çizilir; ana sahne üstüne derinlik temizlenerek çizilir.
 */
export function createFarTerrain(g: GridData, innerRadius: number): THREE.Mesh {
  const n = g.n;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -g.half + i * g.cell;
      const z = -g.half + j * g.cell;
      let h = g.h[k];
      // Yakın alan ana sahnede ayrıntılı çiziliyor: burada aşağı indir (görünmesin)
      const r = Math.hypot(x, z);
      if (r < innerRadius) h -= 60 * (1 - r / innerRadius) + 20;
      pos.set([x, h, z], k * 3);
      const abs = g.h[k];
      if (abs > 1900) c.setRGB(0.92, 0.93, 0.95);
      else if (abs > 1300) c.setRGB(0.52, 0.5, 0.46);
      else if (abs > 500) c.setRGB(0.3, 0.38, 0.24);
      else c.setRGB(0.46, 0.5, 0.36);
      col.set([c.r, c.g, c.b], k * 3);
    }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i;
      idx.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], o);
      o += 6;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.name = 'far-terrain';
  return m;
}
