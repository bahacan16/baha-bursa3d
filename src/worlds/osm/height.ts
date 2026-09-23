import { FLAT, sampleGrid, type GridData, type HeightFn } from '../../env/terrain';

/** Geometri üretimi sırasında kullanılan arazi yüksekliği (Worker'da her üretimde ayarlanır). */
let current: HeightFn = FLAT;
let flat = true;

export function setTerrain(g: GridData | null | undefined): void {
  if (!g) {
    current = FLAT;
    flat = true;
    return;
  }
  current = (x, z) => sampleGrid(g, x, z);
  flat = false;
}

export function H(x: number, z: number): number {
  return current(x, z);
}

export function terrainIsFlat(): boolean {
  return flat;
}

/** Arazide takip için polyline'ı `step` metrede bir sıklaştırır (düz arazide aynen döner). */
export function densify<T extends readonly [number, number]>(pts: T[], step = 12): [number, number][] {
  if (flat || pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  const out: [number, number][] = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Bir halkanın en düşük köşesindeki arazi kotu (bina tabanı). */
export function ringBase(r: readonly (readonly [number, number])[]): number {
  if (flat) return 0;
  let m = Infinity;
  for (const p of r) m = Math.min(m, current(p[0], p[1]));
  return m;
}
