import type { OsmWorldData, Ring } from './parse';

/**
 * Alan kullanımını (park, çim, saha, otopark, su, site bahçeleri…) arazi dokusuna boyar.
 * KARAR: Alanlar ayrı düz mesh yerine dokuya çizilir — eğimli arazide boşluk/z-fighting olmaz, draw call azalır.
 */
const FILL: Record<string, string> = {
  residential: '#8d8f79',
  commercial: '#96938a',
  industrial: '#8f8b82',
  school: '#a39a84',
  construction: '#9a8465',
  farmland: '#8f9458',
  grass: '#6f8d4a',
  park: '#658a43',
  pitch: '#4f8d45',
  playground: '#b08e6c',
  parking: '#5d5e60',
  water: '#4d7896',
  wood: '#4a6b35',
  scrub: '#76834c',
  cemetery: '#6a8452',
  pedestrian: '#a8a39a',
};

const ORDER = [
  'residential',
  'commercial',
  'industrial',
  'school',
  'construction',
  'farmland',
  'cemetery',
  'scrub',
  'wood',
  'grass',
  'park',
  'pedestrian',
  'parking',
  'playground',
  'pitch',
  'water',
];

function path(ctx: CanvasRenderingContext2D, r: Ring, X: (x: number) => number, Y: (z: number) => number) {
  ctx.moveTo(X(r[0][0]), Y(r[0][1]));
  for (let i = 1; i < r.length; i++) ctx.lineTo(X(r[i][0]), Y(r[i][1]));
  ctx.closePath();
}

/** `half`: dokunun kapsadığı alanın yarı kenarı (m). Doku uv (0,0) = (−half, +half) köşesi (three PlaneGeometry ile uyumlu). */
export function drawGroundTexture(d: OsmWorldData, size: number, half: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const k = size / (half * 2);
  const X = (x: number) => (x + half) * k;
  const Y = (z: number) => (z + half) * k;
  // Taban: kuru toprak/çim karışımı + gren
  ctx.fillStyle = '#8b8672';
  ctx.fillRect(0, 0, size, size);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rnd() < 0.55 ? 'rgba(100,118,66,0.16)' : 'rgba(126,108,84,0.14)';
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, (4 + rnd() * 30) * k, 0, Math.PI * 2);
    ctx.fill();
  }
  const areas = d.areas.slice().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  for (const a of areas) {
    ctx.fillStyle = FILL[a.kind] ?? '#888';
    ctx.beginPath();
    path(ctx, a.outer, X, Y);
    for (const h of a.holes) path(ctx, h, X, Y);
    ctx.fill('evenodd');
    if (a.kind === 'pitch') {
      // Çizgili çim + beyaz saha çizgisi
      ctx.save();
      ctx.clip('evenodd');
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let x = X(-half); x < size; x += 10 * k) ctx.fillRect(x, 0, 5 * k, size);
      ctx.restore();
      ctx.strokeStyle = 'rgba(240,240,235,0.85)';
      ctx.lineWidth = Math.max(1, 0.15 * k * 2);
      ctx.beginPath();
      path(ctx, a.outer, X, Y);
      ctx.stroke();
    } else if (a.kind === 'parking') {
      ctx.strokeStyle = 'rgba(230,230,225,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      path(ctx, a.outer, X, Y);
      ctx.stroke();
    }
  }
  // Bina oturma izleri (bina dibi temiz beton)
  ctx.fillStyle = 'rgba(120,118,112,0.9)';
  for (const b of d.buildings) {
    ctx.beginPath();
    path(ctx, b.outer, X, Y);
    ctx.fill();
  }
  return c;
}
