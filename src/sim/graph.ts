import type { Pt, Road } from '../worlds/osm/parse';

/** Yol ağı: kesişim/uç düğümleri arasındaki kenarlar (polyline). */
export interface Edge {
  id: number;
  a: number;
  b: number;
  pts: Pt[];
  len: number;
  road: Road;
  /** Kümülatif uzunluklar */
  cum: number[];
}

export interface Graph {
  nodes: { x: number; z: number; edges: number[] }[];
  edges: Edge[];
}

const key = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

/** `filter`'dan geçen yollardan graf kurar; paylaşılan noktalar düğüm olur. */
export function buildGraph(roads: Road[], filter: (r: Road) => boolean, maxR = 1150): Graph {
  const use = new Map<string, number>();
  const sel = roads.filter((r) => filter(r) && !r.tunnel);
  for (const r of sel)
    r.pts.forEach((p, i) => {
      const k = key(p);
      use.set(k, (use.get(k) ?? 0) + (i === 0 || i === r.pts.length - 1 ? 2 : 1));
    });
  const nodes: Graph['nodes'] = [];
  const nodeIdx = new Map<string, number>();
  const nodeOf = (p: Pt) => {
    const k = key(p);
    let i = nodeIdx.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ x: p[0], z: p[1], edges: [] });
      nodeIdx.set(k, i);
    }
    return i;
  };
  const edges: Edge[] = [];
  for (const r of sel) {
    let start = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const isNode = i === r.pts.length - 1 || (use.get(key(r.pts[i])) ?? 0) > 1;
      if (!isNode) continue;
      const pts = r.pts.slice(start, i + 1);
      start = i;
      if (pts.every((p) => Math.hypot(p[0], p[1]) > maxR)) continue;
      const cum = [0];
      for (let k = 1; k < pts.length; k++)
        cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const len = cum[cum.length - 1];
      if (len < 0.5) continue;
      const e: Edge = {
        id: edges.length,
        a: nodeOf(pts[0]),
        b: nodeOf(pts[pts.length - 1]),
        pts,
        len,
        road: r,
        cum,
      };
      edges.push(e);
      nodes[e.a].edges.push(e.id);
      nodes[e.b].edges.push(e.id);
    }
  }
  return { nodes, edges };
}

/** Kenar üzerinde s mesafesindeki nokta ve yön (a→b). */
export function pointOn(e: Edge, s: number): { x: number; z: number; dx: number; dz: number } {
  const c = e.cum;
  s = Math.max(0, Math.min(e.len, s));
  let i = 1;
  while (i < c.length - 1 && c[i] < s) i++;
  const p = e.pts[i - 1];
  const q = e.pts[i];
  const seg = c[i] - c[i - 1] || 1;
  const t = (s - c[i - 1]) / seg;
  const dx = (q[0] - p[0]) / seg;
  const dz = (q[1] - p[1]) / seg;
  return { x: p[0] + (q[0] - p[0]) * t, z: p[1] + (q[1] - p[1]) * t, dx, dz };
}

/** Kenarın düğüm tarafından yönü: `fromNode`dan çıkınca ileri mi (a→b)? */
export function forwardFrom(e: Edge, fromNode: number): boolean {
  return e.a === fromNode;
}
