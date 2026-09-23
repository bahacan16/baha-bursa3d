import { ChunkedGeometry, type MatKey, type Rgb } from './chunks';
import { addFlatPolygon, orient, addBox } from './buildings';
import { H } from './height';
import { ringCentroid, signedArea, type Area, type AreaKind, type Barrier, type Pt } from './parse';

const COLORS: Record<AreaKind, Rgb> = {
  grass: [0.42, 0.55, 0.3],
  park: [0.38, 0.53, 0.27],
  pitch: [0.3, 0.52, 0.26],
  playground: [0.72, 0.52, 0.4],
  parking: [0.33, 0.33, 0.34],
  residential: [0.5, 0.54, 0.44],
  commercial: [0.6, 0.59, 0.56],
  industrial: [0.55, 0.53, 0.5],
  school: [0.66, 0.6, 0.5],
  water: [0.25, 0.42, 0.55],
  wood: [0.26, 0.4, 0.2],
  scrub: [0.45, 0.5, 0.3],
  construction: [0.58, 0.48, 0.36],
  pedestrian: [0.63, 0.6, 0.55],
  farmland: [0.55, 0.55, 0.32],
  cemetery: [0.4, 0.5, 0.33],
};

/** Alt katman (geniş alanlar) ve üst katman (park, otopark…) — farklı y + polygonOffset. */
const LOW: AreaKind[] = ['residential', 'commercial', 'industrial', 'school', 'construction', 'farmland'];

export function areaStyle(kind: AreaKind): { mat: MatKey; y: number; color: Rgb } {
  if (kind === 'water') return { mat: 'water', y: 0.022, color: COLORS.water };
  if (kind === 'pitch') return { mat: 'pitch', y: 0.024, color: COLORS.pitch };
  if (LOW.includes(kind)) return { mat: 'landLow', y: 0.01, color: COLORS[kind] };
  return { mat: 'landHigh', y: 0.02, color: COLORS[kind] };
}

export function buildAreas(geo: ChunkedGeometry, areas: Area[]): void {
  // Büyükten küçüğe: iç içe alanlarda küçük olan (oyun alanı, park içi saha) üstte çizilir.
  const sized = areas
    .map((a) => ({ a, size: Math.abs(signedArea(a.outer)) }))
    .sort((p, q) => q.size - p.size);
  for (const { a, size } of sized) {
    const st = { ...areaStyle(a.kind) };
    if (size < 4000) st.y += 0.004;
    const outer = orient(a.outer, true);
    const holes = a.holes.map((h) => orient(h, false));
    const c = ringCentroid(outer);
    const b = geo.get(c[0], c[1], st.mat);
    if (a.kind === 'pitch') {
      // Saha çizgileri için uv: en uzun kenar ekseninde metre
      let best = 0;
      let ux = 1;
      let uz = 0;
      for (let i = 0; i < outer.length; i++) {
        const p = outer[i];
        const q = outer[(i + 1) % outer.length];
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > best) {
          best = l;
          ux = (q[0] - p[0]) / l;
          uz = (q[1] - p[1]) / l;
        }
      }
      const start = b.vertexCount;
      addFlatPolygon(b, outer, holes, st.y, st.color);
      for (let i = start; i < b.vertexCount; i++) {
        const x = b.pos[i * 3] - c[0];
        const z = b.pos[i * 3 + 2] - c[1];
        b.uv[i * 2] = x * ux + z * uz;
        b.uv[i * 2 + 1] = -x * uz + z * ux;
      }
    } else {
      addFlatPolygon(b, outer, holes, st.y, st.color);
    }
  }
}

const BARRIER_COLORS: Record<Barrier['kind'], Rgb> = {
  wall: [0.78, 0.74, 0.66],
  fence: [0.3, 0.34, 0.32],
  hedge: [0.25, 0.4, 0.2],
  retaining_wall: [0.6, 0.58, 0.55],
};
const BARRIER_THICK: Record<Barrier['kind'], number> = {
  wall: 0.25,
  fence: 0.06,
  hedge: 0.8,
  retaining_wall: 0.4,
};

/** Site duvarları, çitler, çitler: ince ekstrüzyon. */
export function buildBarriers(geo: ChunkedGeometry, barriers: Barrier[]): void {
  for (const br of barriers) {
    const c = BARRIER_COLORS[br.kind];
    const t = BARRIER_THICK[br.kind];
    for (let i = 0; i + 1 < br.pts.length; i++) {
      const p = br.pts[i];
      const q = br.pts[i + 1];
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      const mx = (p[0] + q[0]) / 2;
      const mz = (p[1] + q[1]) / 2;
      const yaw = Math.atan2(-dz, dx);
      const b = geo.get(mx, mz, 'barrier');
      // Eğimde: en düşük uçtan başla, en yüksek uca göre yükseklik ekle
      const hp = H(p[0], p[1]);
      const hq = H(q[0], q[1]);
      const g = Math.min(hp, hq) - 0.2;
      const top = Math.max(hp, hq) + br.height;
      // Köşelerde boşluk kalmasın diye kalınlık kadar uzat
      addBox(b, mx, (g + top) / 2, mz, l + t, top - g, t, yaw, c);
      if (br.kind === 'wall')
        addBox(b, mx, top + 0.04, mz, l + t + 0.06, 0.08, t + 0.08, yaw, [0.85, 0.83, 0.78]);
    }
  }
}

export function barrierThickness(kind: Barrier['kind']): number {
  return BARRIER_THICK[kind];
}

export type { Pt };
