/**
 * Overpass JSON → sade, yerel metre koordinatlı OSM verisi.
 * Hem Node scripti (scripts/fetch-osm.mjs, tip ayıklama ile) hem tarayıcı tarafından kullanılır;
 * bu yüzden bu dosya import içermez ve yalnızca silinebilir TS sözdizimi kullanır.
 */

export interface LatLonLite {
  lat: number;
  lon: number;
}

export type Tags = Record<string, string>;

export interface SNode {
  i: number;
  x: number;
  z: number;
  t: Tags;
}

export interface SWay {
  i: number;
  /** Düz x,z dizisi (metre, 2 ondalık). */
  p: number[];
  t: Tags;
}

export interface SRel {
  i: number;
  /** Dış halkalar (düz x,z). */
  o: number[][];
  /** İç halkalar (delikler). */
  n: number[][];
  t: Tags;
}

export interface SimpleOsm {
  version: 1;
  center: LatLonLite;
  centerSource: string;
  /** Veri indirme alanı yarı-kenarı (m). */
  half: number;
  nodes: SNode[];
  ways: SWay[];
  rels: SRel[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: { type: string; ref: number; role: string }[];
  tags?: Tags;
}

export interface OverpassJson {
  elements: OverpassElement[];
}

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const DEFAULT_CENTER_LITE: LatLonLite = { lat: 40.218262, lon: 28.909611 };
export const CENTER_STREET = '502. Sokak';
export const DATA_HALF = 1200;
export const SEARCH_HALF = 1500;

const R = 6378137;
const DEG = Math.PI / 180;

export function project(lat: number, lon: number, c: LatLonLite): [number, number] {
  return [(lon - c.lon) * Math.cos(c.lat * DEG) * R * DEG, -(lat - c.lat) * R * DEG];
}

export function unproject(x: number, z: number, c: LatLonLite): LatLonLite {
  return { lat: c.lat - z / (R * DEG), lon: c.lon + x / (Math.cos(c.lat * DEG) * R * DEG) };
}

/** Overpass bbox dizgesi (güney,batı,kuzey,doğu). */
export function bboxString(c: LatLonLite, half: number): string {
  const sw = unproject(-half, half, c);
  const ne = unproject(half, -half, c);
  return `${sw.lat.toFixed(6)},${sw.lon.toFixed(6)},${ne.lat.toFixed(6)},${ne.lon.toFixed(6)}`;
}

export function centerQuery(c: LatLonLite, name = CENTER_STREET): string {
  const bb = bboxString(c, SEARCH_HALF);
  return `[out:json][timeout:60];way["highway"]["name"="${name}"](${bb});out body;>;out skel qt;`;
}

export function dataQuery(c: LatLonLite, half = DATA_HALF): string {
  const bb = bboxString(c, half);
  const parts = [
    'way["building"]',
    'way["building:part"]',
    'relation["building"]',
    'way["highway"]',
    'way["railway"]',
    'way["landuse"]',
    'relation["landuse"]',
    'way["leisure"]',
    'relation["leisure"]',
    'way["natural"~"^(water|wood|scrub|tree_row|grassland)$"]',
    'relation["natural"~"^(water|wood|scrub)$"]',
    'node["natural"="tree"]',
    'way["amenity"]',
    'node["amenity"]',
    'node["shop"]',
    'way["shop"]',
    'way["barrier"~"^(wall|fence|retaining_wall|hedge|city_wall)$"]',
    'node["highway"~"^(crossing|street_lamp)$"]',
    'node["railway"~"^(station|stop|halt|tram_stop)$"]',
    'node["public_transport"="station"]',
    'node["name"]',
    'way["place"]',
  ];
  return `[out:json][timeout:120];(${parts.map((p) => `${p}(${bb});`).join('')});out body;>;out skel qt;`;
}

const KEEP_KEYS = new Set([
  'building',
  'building:part',
  'building:levels',
  'building:min_level',
  'building:colour',
  'height',
  'min_height',
  'roof:shape',
  'roof:height',
  'roof:levels',
  'roof:colour',
  'highway',
  'name',
  'width',
  'lanes',
  'sidewalk',
  'sidewalk:both',
  'sidewalk:left',
  'sidewalk:right',
  'footway',
  'oneway',
  'area',
  'railway',
  'bridge',
  'tunnel',
  'layer',
  'location',
  'landuse',
  'leisure',
  'natural',
  'amenity',
  'shop',
  'barrier',
  'sport',
  'surface',
  'service',
  'public_transport',
  'station',
  'crossing',
  'place',
  'type',
  'water',
]);

function cleanTags(t: Tags | undefined): Tags {
  const out: Tags = {};
  if (!t) return out;
  for (const k of Object.keys(t)) if (KEEP_KEYS.has(k)) out[k] = t[k];
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Way parçalarından kapalı halkalar oluşturur (multipolygon üyeleri). */
export function stitchRings(segments: number[][][]): number[][][] {
  const rings: number[][][] = [];
  const pool = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  while (pool.length) {
    let ring = pool.shift()!;
    let guard = 0;
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 10000) {
      const end = ring[ring.length - 1];
      let found = -1;
      let reverse = false;
      for (let i = 0; i < pool.length; i++) {
        if (same(pool[i][0], end)) {
          found = i;
          break;
        }
        if (same(pool[i][pool[i].length - 1], end)) {
          found = i;
          reverse = true;
          break;
        }
      }
      if (found < 0) break;
      const seg = pool.splice(found, 1)[0];
      if (reverse) seg.reverse();
      ring = ring.concat(seg.slice(1));
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Overpass sonucu → SimpleOsm. Koordinatlar merkeze göre yerel metre, 2 ondalık. */
export function simplifyOverpass(
  json: OverpassJson,
  center: LatLonLite,
  centerSource: string,
  half = DATA_HALF,
): SimpleOsm {
  const coords = new Map<number, [number, number]>();
  const wayNodes = new Map<number, number[]>();
  const wayTags = new Map<number, Tags | undefined>();
  const out: SimpleOsm = { version: 1, center, centerSource, half, nodes: [], ways: [], rels: [] };
  const limit = half * 1.25;

  for (const e of json.elements) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) {
      const [x, z] = project(e.lat, e.lon, center);
      coords.set(e.id, [r2(x), r2(z)]);
    }
  }
  for (const e of json.elements) {
    if (e.type === 'node' && e.tags && Object.keys(e.tags).length) {
      const c = coords.get(e.id);
      if (!c || Math.abs(c[0]) > limit || Math.abs(c[1]) > limit) continue;
      const t = cleanTags(e.tags);
      if (!Object.keys(t).length) continue;
      out.nodes.push({ i: e.id, x: c[0], z: c[1], t });
    } else if (e.type === 'way' && e.nodes) {
      wayNodes.set(e.id, e.nodes);
      wayTags.set(e.id, e.tags);
    }
  }
  const memberWays = new Set<number>();
  for (const e of json.elements) {
    if (e.type !== 'relation' || !e.members) continue;
    const t = cleanTags(e.tags);
    const isMp = e.tags?.type === 'multipolygon' || e.tags?.type === 'building';
    if (!isMp) continue;
    const outer: number[][][] = [];
    const inner: number[][][] = [];
    for (const m of e.members) {
      if (m.type !== 'way') continue;
      const nodes = wayNodes.get(m.ref);
      if (!nodes) continue;
      const pts = nodes.map((id) => coords.get(id)).filter((p): p is [number, number] => !!p);
      if (pts.length < 2) continue;
      (m.role === 'inner' ? inner : outer).push(pts);
      // Etiketsiz üye way'ler ayrıca çizilmesin
      const wt = wayTags.get(m.ref);
      if (!wt || !Object.keys(cleanTags(wt)).filter((k) => k !== 'type').length) memberWays.add(m.ref);
    }
    const o = stitchRings(outer);
    if (!o.length) continue;
    out.rels.push({ i: e.id, o: o.map((r) => r.flat()), n: stitchRings(inner).map((r) => r.flat()), t });
  }
  for (const [id, nodes] of wayNodes) {
    if (memberWays.has(id)) continue;
    const t = cleanTags(wayTags.get(id));
    if (!Object.keys(t).length) continue;
    const p: number[] = [];
    let inside = false;
    for (const nid of nodes) {
      const c = coords.get(nid);
      if (!c) continue;
      p.push(c[0], c[1]);
      if (Math.abs(c[0]) < limit && Math.abs(c[1]) < limit) inside = true;
    }
    if (p.length < 4 || !inside) continue;
    out.ways.push({ i: id, p, t });
  }
  return out;
}

/**
 * Adı verilen sokağın uzunluk-orta noktası. Bulunamazsa null.
 * Tüm parçaların toplam uzunluğunun yarısındaki nokta alınır.
 */
export function streetMidpoint(
  json: OverpassJson,
  near: LatLonLite,
  name = CENTER_STREET,
): LatLonLite | null {
  const coords = new Map<number, [number, number]>();
  for (const e of json.elements) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) {
      coords.set(e.id, project(e.lat, e.lon, near));
    }
  }
  const lines: [number, number][][] = [];
  for (const e of json.elements) {
    if (e.type !== 'way' || !e.nodes || e.tags?.name !== name || !e.tags?.highway) continue;
    const pts = e.nodes.map((id) => coords.get(id)).filter((p): p is [number, number] => !!p);
    if (pts.length >= 2) lines.push(pts);
  }
  if (!lines.length) return null;
  // Merkeze en yakın parçadan başlayarak bitişik zinciri kur (başka mahallelerdeki aynı adlı sokakları ele).
  const len = (l: [number, number][]) => {
    let s = 0;
    for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    return s;
  };
  const dist0 = (l: [number, number][]) => Math.min(...l.map((p) => Math.hypot(p[0], p[1])));
  lines.sort((a, b) => dist0(a) - dist0(b));
  const chain: [number, number][][] = [lines.shift()!];
  const touches = (a: [number, number][], b: [number, number][]) =>
    a.some((p) => b.some((q) => Math.abs(p[0] - q[0]) < 0.5 && Math.abs(p[1] - q[1]) < 0.5));
  let grown = true;
  while (grown) {
    grown = false;
    for (let i = 0; i < lines.length; i++) {
      if (chain.some((c) => touches(c, lines[i]))) {
        chain.push(lines.splice(i, 1)[0]);
        grown = true;
        break;
      }
    }
  }
  const total = chain.reduce((s, l) => s + len(l), 0);
  let acc = 0;
  for (const l of chain) {
    for (let i = 1; i < l.length; i++) {
      const d = Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
      if (acc + d >= total / 2) {
        const t = d > 0 ? (total / 2 - acc) / d : 0;
        const x = l[i - 1][0] + (l[i][0] - l[i - 1][0]) * t;
        const z = l[i - 1][1] + (l[i][1] - l[i - 1][1]) * t;
        return unproject(x, z, near);
      }
      acc += d;
    }
  }
  return null;
}

export function countFeatures(d: SimpleOsm): Record<string, number> {
  const c: Record<string, number> = { nodes: d.nodes.length, ways: d.ways.length, relations: d.rels.length };
  let buildings = 0;
  let roads = 0;
  let trees = 0;
  for (const w of d.ways) {
    if (w.t.building || w.t['building:part']) buildings++;
    if (w.t.highway) roads++;
  }
  for (const r of d.rels) if (r.t.building) buildings++;
  for (const n of d.nodes) if (n.t.natural === 'tree') trees++;
  return { ...c, buildings, roads, trees };
}
