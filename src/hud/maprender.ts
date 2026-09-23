import type { OsmWorldData, Ring } from '../worlds/osm/parse';

/** Tüm alanın tek seferlik 2D harita görüntüsü (mini harita + büyük harita ortak). */
export interface MapImage {
  canvas: HTMLCanvasElement;
  /** px / m */
  scale: number;
  /** Dünyadaki sol-üst köşe (x, z). */
  originX: number;
  originZ: number;
}

const AREA_COLORS: Record<string, string> = {
  park: '#5f8f4a',
  grass: '#6c9651',
  wood: '#4a7a3c',
  scrub: '#6f8a4f',
  pitch: '#5aa05a',
  playground: '#b58b6a',
  cemetery: '#5f8a55',
  water: '#4f86b0',
  parking: '#6b6e72',
  residential: '#4f555b',
  commercial: '#595a60',
  industrial: '#57585c',
  school: '#5f5a52',
  construction: '#6b5f4f',
  pedestrian: '#8d8a84',
  farmland: '#6f7a4c',
};

function ringPath(
  ctx: CanvasRenderingContext2D,
  r: Ring,
  toX: (x: number) => number,
  toY: (z: number) => number,
) {
  ctx.moveTo(toX(r[0][0]), toY(r[0][1]));
  for (let i = 1; i < r.length; i++) ctx.lineTo(toX(r[i][0]), toY(r[i][1]));
  ctx.closePath();
}

export function renderMap(d: OsmWorldData, scale = 1): MapImage {
  const half = d.half ?? 1200;
  const size = Math.round(half * 2 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const toX = (x: number) => (x + half) * scale;
  const toY = (z: number) => (z + half) * scale;
  ctx.fillStyle = '#3d4247';
  ctx.fillRect(0, 0, size, size);

  const areas = d.areas
    .slice()
    .sort((a, b) => (a.kind === 'residential' ? -1 : 0) - (b.kind === 'residential' ? -1 : 0));
  for (const a of areas) {
    ctx.fillStyle = AREA_COLORS[a.kind] ?? '#555';
    ctx.beginPath();
    ringPath(ctx, a.outer, toX, toY);
    for (const h of a.holes) ringPath(ctx, h, toX, toY);
    ctx.fill('evenodd');
  }
  // Yollar
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const roads = d.roads.filter((r) => !r.tunnel).sort((a, b) => a.width - b.width);
  for (const pass of [0, 1]) {
    for (const r of roads) {
      const minor = !r.vehicular && r.kind !== 'service' && r.kind !== 'living_street';
      if (pass === 0 && minor) continue;
      ctx.strokeStyle = pass === 0 ? '#23272b' : minor ? 'rgba(230,225,210,0.55)' : '#f1f1ee';
      ctx.lineWidth = Math.max(1, (pass === 0 ? r.width + 2.5 : minor ? 1.6 : r.width) * scale);
      ctx.beginPath();
      ctx.moveTo(toX(r.pts[0][0]), toY(r.pts[0][1]));
      for (let i = 1; i < r.pts.length; i++) ctx.lineTo(toX(r.pts[i][0]), toY(r.pts[i][1]));
      ctx.stroke();
    }
  }
  // Raylar
  for (const r of d.rails) {
    if (r.tunnel) continue;
    ctx.strokeStyle = '#1b1d20';
    ctx.lineWidth = Math.max(2, 3.5 * scale);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(toX(r.pts[0][0]), toY(r.pts[0][1]));
    for (let i = 1; i < r.pts.length; i++) ctx.lineTo(toX(r.pts[i][0]), toY(r.pts[i][1]));
    ctx.stroke();
  }
  // Binalar
  ctx.fillStyle = '#9ea2a6';
  ctx.strokeStyle = '#7d8185';
  ctx.lineWidth = 0.6;
  for (const b of d.buildings) {
    ctx.beginPath();
    ringPath(ctx, b.outer, toX, toY);
    for (const h of b.holes) ringPath(ctx, h, toX, toY);
    ctx.fill('evenodd');
    ctx.stroke();
  }
  return { canvas, scale, originX: -half, originZ: -half };
}
