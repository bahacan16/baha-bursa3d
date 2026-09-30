import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BAKE_CHUNK,
  chunkSignature,
  splitChunks,
  unwrapChunk,
  type BakeSource,
} from '../../src/worlds/measured/lightmap';
import { partGeometry } from '../../src/worlds/measured/baked';

function box(x: number, z: number, s = 2): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(s, s * 1.5, s);
  g.translate(x, s, z);
  return g;
}

function sources(): BakeSource[] {
  const wall = new THREE.PlaneGeometry(12, 6, 3, 2); // aynı düzlemde bitişik üçgenler → tek ada
  wall.translate(40, 3, -20);
  const aux = new Float32Array(wall.attributes.position.count * 4).fill(0.5);
  wall.setAttribute('aux', new THREE.BufferAttribute(aux, 4));
  return [
    { key: 'a', geometry: box(10, -10) },
    { key: 'b', geometry: box(150, -10) },
    { key: 'c', geometry: wall },
  ];
}

describe('pişirilmiş ışık uv1 (lightmap.ts)', () => {
  it('üçgenleri 100 m parçalara ağırlık merkezinden böler', () => {
    const ch = splitChunks(sources());
    expect(ch.map((c) => c.id)).toEqual(['0_-1', '1_-1']);
    const first = ch[0];
    expect(first.parts.map((p) => p.src)).toEqual([0, 2]);
    expect(first.parts[0].tris.length).toBe(12);
    expect(BAKE_CHUNK).toBe(100);
  });

  it('imza kararlı ve 1 mm değişikliği yakalar', () => {
    const s = sources();
    const c = splitChunks(s)[0];
    const a = chunkSignature(c, s);
    expect(chunkSignature(c, s)).toBe(a);
    const s2 = sources();
    const p = s2[0].geometry.attributes.position as THREE.BufferAttribute;
    p.setX(0, p.getX(0) + 0.002);
    expect(chunkSignature(splitChunks(s2)[0], s2)).not.toBe(a);
  });

  it('deterministik, 0..1 aralığında, adalar çakışmıyor', () => {
    const s = sources();
    const c = splitChunks(s)[0];
    const opts = { texel: 0.1, pad: 2, maxAtlas: 1024 };
    const u1 = unwrapChunk(c, s, opts);
    const u2 = unwrapChunk(c, s, opts);
    expect(u1.size).toBe(u2.size);
    for (let i = 0; i < u1.parts.length; i++)
      expect(Array.from(u1.parts[i].uv1)).toEqual(Array.from(u2.parts[i].uv1));
    // Kutu: 6 yüz (ayrı köşeler) = 6 ada; düzlem 3×2 dörtgen = 1 ada
    expect(u1.charts).toBe(7);
    const rects: number[][] = [];
    u1.parts.forEach((p) => {
      for (const v of p.uv1) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
      // üçgen başına uv sınırları → ada sınırları (aynı adadaki üçgenler kesişebilir, farklı adalar kesişmemeli)
      for (let t = 0; t < p.index.length; t += 3) {
        const us = [0, 1, 2].map((k) => p.uv1[p.index[t + k] * 2]);
        const vs = [0, 1, 2].map((k) => p.uv1[p.index[t + k] * 2 + 1]);
        rects.push([Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)]);
      }
    });
    // Kutunun yüzleri: iki üçgen bir ada → 12 üçgenden 6 ada; ada kutuları ayrık olmalı
    const boxRects: number[][] = [];
    for (let f = 0; f < 6; f++) {
      const a = rects[f * 2];
      const b = rects[f * 2 + 1];
      boxRects.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    }
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++) {
        const A = boxRects[i];
        const B = boxRects[j];
        const overlap = A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];
        expect(overlap).toBe(false);
      }
  });

  it('düzlem ada ölçeği kullanılan yoğunluğa uyar (12 m × 6 m)', () => {
    const s = sources();
    const c = splitChunks(s)[0];
    const u = unwrapChunk(c, s, { texel: 0.1, pad: 2, maxAtlas: 1024 });
    const uv = u.parts[1].uv1;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < uv.length; i += 2) {
      mn = Math.min(mn, uv[i]);
      mx = Math.max(mx, uv[i]);
    }
    const px = (mx - mn) * u.size;
    const py = (() => {
      let a = Infinity;
      let b = -Infinity;
      for (let i = 1; i < uv.length; i += 2) {
        a = Math.min(a, uv[i]);
        b = Math.max(b, uv[i]);
      }
      return (b - a) * u.size;
    })();
    // Küçük atlas için yoğunluk en fazla 1.25× gevşer
    expect(u.texel).toBeGreaterThanOrEqual(0.1);
    expect(u.texel).toBeLessThanOrEqual(0.125 + 1e-9);
    expect(Math.max(px, py)).toBeCloseTo(12 / u.texel, 0);
    expect(Math.min(px, py)).toBeCloseTo(6 / u.texel, 0);
  });

  it('partGeometry öznitelikleri (aux dahil) kaynaktan kopyalar', () => {
    const s = sources();
    const c = splitChunks(s)[0];
    const u = unwrapChunk(c, s, { texel: 0.1, pad: 2, maxAtlas: 1024 });
    const g = partGeometry(s[2].geometry, u.parts[1]);
    expect(g.attributes.aux.count).toBe(u.parts[1].vmap.length);
    expect(g.attributes.aux.getX(0)).toBe(0.5);
    expect(g.attributes.uv1.count).toBe(g.attributes.position.count);
    expect((g.index as THREE.BufferAttribute).count).toBe(s[2].geometry.index!.count);
    const src = s[2].geometry.attributes.position;
    const v = u.parts[1].vmap[3];
    expect(g.attributes.position.getX(3)).toBe(src.getX(v));
  });
});
