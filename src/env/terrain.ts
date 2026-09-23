/**
 * Gerçek arazi yüksekliği (AWS Terrain Tiles / Terrarium). Oyunda y = 0 merkezin arazi kotudur.
 * terrain.bin biçimi scripts/fetch-terrain.mjs'te.
 */
export interface GridData {
  n: number;
  half: number;
  cell: number;
  /** Merkez kotuna göre göreli yükseklikler (m), satır = z, sütun = x. */
  h: Float32Array;
}

export interface TerrainData {
  near: GridData;
  far: GridData | null;
  /** Merkezin mutlak kotu (m). */
  base: number;
}

export function parseTerrain(buf: ArrayBuffer): TerrainData {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'TRN1') throw new Error('terrain.bin biçimi geçersiz');
  const f = (i: number) => dv.getFloat32(4 + i * 4, true);
  const nn = f(0);
  const fn = f(3);
  let off = 4 + 24;
  const nearH = new Float32Array(buf.slice(off, off + nn * nn * 4));
  off += nn * nn * 4;
  const farH = new Float32Array(buf.slice(off, off + fn * fn * 4));
  const mid = ((nn - 1) / 2) * nn + (nn - 1) / 2;
  const base = nearH[Math.round(mid)];
  for (let i = 0; i < nearH.length; i++) nearH[i] -= base;
  for (let i = 0; i < farH.length; i++) farH[i] -= base;
  return {
    near: { n: nn, half: f(1), cell: f(2), h: nearH },
    far: fn > 1 ? { n: fn, half: f(4), cell: f(5), h: farH } : null,
    base,
  };
}

/** Çift doğrusal örnekleme; ızgara dışında kenar değeri. */
export function sampleGrid(g: GridData, x: number, z: number): number {
  const fx = Math.min(g.n - 1.0001, Math.max(0, (x + g.half) / g.cell));
  const fz = Math.min(g.n - 1.0001, Math.max(0, (z + g.half) / g.cell));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const dx = fx - i;
  const dz = fz - j;
  const n = g.n;
  const a = g.h[j * n + i];
  const b = g.h[j * n + i + 1];
  const c = g.h[(j + 1) * n + i];
  const d = g.h[(j + 1) * n + i + 1];
  return a * (1 - dx) * (1 - dz) + b * dx * (1 - dz) + c * (1 - dx) * dz + d * dx * dz;
}

export type HeightFn = (x: number, z: number) => number;

export const FLAT: HeightFn = () => 0;

export function heightFn(t: TerrainData | null): HeightFn {
  if (!t) return FLAT;
  const g = t.near;
  return (x, z) => sampleGrid(g, x, z);
}

export async function loadTerrain(base: string): Promise<TerrainData | null> {
  try {
    const res = await fetch(`${base}data/terrain.bin`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return parseTerrain(await res.arrayBuffer());
  } catch (e) {
    console.warn('Arazi verisi yüklenemedi, düz zemin kullanılıyor:', e);
    return null;
  }
}
