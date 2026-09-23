import type { SimpleOsm, Tags } from './simplify';

export type Pt = [number, number];
export type Ring = Pt[];

export interface Building {
  id: string;
  outer: Ring;
  holes: Ring[];
  /** Taban kotu (min_height). */
  minHeight: number;
  /** Toplam yükseklik (çatı dahil). */
  height: number;
  /** Duvar üst kotu (düz olmayan çatılarda height − roofHeight). */
  wallTop: number;
  roofShape: 'flat' | 'gabled' | 'hipped' | 'pyramidal';
  roofHeight: number;
  kind: string;
  isPart: boolean;
  levels: number;
  colour?: string;
  roofColour?: string;
  name?: string;
}

export interface Road {
  id: string;
  kind: string;
  name?: string;
  pts: Pt[];
  width: number;
  sidewalkLeft: boolean;
  sidewalkRight: boolean;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  area: boolean;
  vehicular: boolean;
}

export interface Rail {
  id: string;
  kind: string;
  name?: string;
  pts: Pt[];
  bridge: boolean;
  tunnel: boolean;
  layer: number;
}

export type AreaKind =
  | 'grass'
  | 'park'
  | 'pitch'
  | 'playground'
  | 'parking'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'school'
  | 'water'
  | 'wood'
  | 'scrub'
  | 'construction'
  | 'pedestrian'
  | 'farmland'
  | 'cemetery';

export interface Area {
  id: string;
  kind: AreaKind;
  outer: Ring;
  holes: Ring[];
  name?: string;
}

export interface Barrier {
  id: string;
  kind: 'wall' | 'fence' | 'hedge' | 'retaining_wall';
  pts: Pt[];
  height: number;
}

export interface Poi {
  id: string;
  name: string;
  x: number;
  z: number;
  kind: string;
}

export interface OsmWorldData {
  center: { lat: number; lon: number };
  centerSource: string;
  half: number;
  buildings: Building[];
  roads: Road[];
  rails: Rail[];
  areas: Area[];
  barriers: Barrier[];
  trees: Pt[];
  treeRows: Pt[][];
  pois: Poi[];
  crossings: Pt[];
  lamps: Pt[];
  shops: Pt[];
  /** amenity=bench (gerçek konumlar) */
  benches: Pt[];
  /** amenity=shelter / otobüs durağı */
  shelters: Pt[];
}

export const LEVEL_HEIGHT = 3.1;

/** "12", "12 m", "12.5m", "40'" → metre. */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(m|ft|')?\s*$/i.exec(v);
  if (!m) return null;
  let n = parseFloat(m[1].replace(',', '.'));
  if (m[2] && m[2] !== 'm' && m[2] !== 'M') n *= 0.3048;
  return Number.isFinite(n) ? n : null;
}

function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Türe göre varsayılan kat sayısı (bölgede site tipi apartmanlar yaygın). */
export function defaultLevels(kind: string): number {
  switch (kind) {
    case 'apartments':
    case 'residential':
    case 'yes':
      return 5;
    case 'house':
    case 'detached':
    case 'semidetached_house':
    case 'terrace':
      return 2;
    case 'commercial':
    case 'retail':
    case 'supermarket':
      return 2;
    case 'school':
    case 'university':
    case 'hospital':
    case 'office':
      return 3;
    case 'garage':
    case 'garages':
    case 'shed':
    case 'roof':
    case 'kiosk':
    case 'hut':
    case 'carport':
    case 'service':
    case 'transformer_tower':
      return 1;
    case 'mosque':
    case 'church':
      return 2;
    case 'industrial':
    case 'warehouse':
      return 2;
    default:
      return 3;
  }
}

/**
 * Bina yükseklik kuralları:
 * `height` → `building:levels × 3.1 + 1.0` (+0.9 zemin katta dükkan varsa) → türe göre varsayılan.
 */
export function buildingHeights(
  t: Tags,
  hasShopGround = false,
): Pick<Building, 'minHeight' | 'height' | 'wallTop' | 'roofShape' | 'roofHeight' | 'levels'> {
  const kind = t.building ?? t['building:part'] ?? 'yes';
  const shapeTag = t['roof:shape'];
  const roofShape: Building['roofShape'] =
    shapeTag === 'gabled' || shapeTag === 'hipped' || shapeTag === 'pyramidal' ? shapeTag : 'flat';
  const levelsTag = parseNum(t['building:levels']);
  const roofLevels = parseNum(t['roof:levels']) ?? 0;
  let roofHeight = 0;
  if (roofShape !== 'flat') {
    roofHeight = parseLength(t['roof:height']) ?? (roofLevels > 0 ? roofLevels * LEVEL_HEIGHT : 2.5);
  }
  let minHeight = parseLength(t.min_height) ?? 0;
  const minLevel = parseNum(t['building:min_level']);
  if (!parseLength(t.min_height) && minLevel !== null) minHeight = minLevel * LEVEL_HEIGHT;

  const h = parseLength(t.height);
  let height: number;
  let levels: number;
  if (h !== null && h > 0) {
    height = h;
    levels = Math.max(1, Math.round((h - minHeight - roofHeight) / LEVEL_HEIGHT));
  } else {
    levels = levelsTag !== null && levelsTag > 0 ? levelsTag : defaultLevels(kind);
    // KARAR: Zemin katta dükkan varsa zemin kat 4 m kabul edilir (+0.9 m).
    // building:levels zeminden itibaren sayılır (min_level altındakiler dahil).
    height = levels * LEVEL_HEIGHT + 1.0 + (hasShopGround ? 0.9 : 0);
    height += roofHeight;
  }
  if (height <= minHeight) height = minHeight + LEVEL_HEIGHT;
  const wallTop = Math.max(minHeight + 0.5, height - roofHeight);
  return { minHeight, height, wallTop, roofShape, roofHeight, levels };
}

const ROAD_WIDTH: Record<string, number> = {
  motorway: 14,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  motorway_link: 7,
  trunk_link: 7,
  primary_link: 7,
  secondary_link: 6.5,
  tertiary_link: 6.5,
  residential: 6.5,
  unclassified: 6.5,
  road: 6.5,
  service: 4,
  living_street: 5,
  pedestrian: 5,
  track: 3,
  footway: 2.5,
  path: 2.5,
  steps: 2.5,
  bridleway: 2.5,
  cycleway: 2,
  corridor: 2,
};

const VEHICULAR = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
  'residential',
  'unclassified',
  'road',
]);

/** Kaldırım üretilen araç yolları. */
export function isVehicular(kind: string): boolean {
  return VEHICULAR.has(kind);
}

export function roadWidth(t: Tags): number {
  const w = parseLength(t.width);
  if (w !== null && w > 0.5 && w < 60) return w;
  const lanes = parseNum(t.lanes);
  if (lanes !== null && lanes > 0 && lanes < 12) return lanes * 3.2;
  return ROAD_WIDTH[t.highway] ?? 5;
}

function sidewalks(t: Tags, vehicular: boolean): { left: boolean; right: boolean } {
  if (!vehicular) return { left: false, right: false };
  const sw = t.sidewalk ?? t['sidewalk:both'];
  const no = (v: string | undefined) => v === 'no' || v === 'none' || v === 'separate';
  if (sw === 'no' || sw === 'none' || sw === 'separate') return { left: false, right: false };
  if (sw === 'left') return { left: true, right: false };
  if (sw === 'right') return { left: false, right: true };
  // KARAR: Etiket yoksa araç yollarının iki yanına da kaldırım çizilir.
  return { left: !no(t['sidewalk:left']), right: !no(t['sidewalk:right']) };
}

function toPts(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const p: Pt = [flat[i], flat[i + 1]];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

function isClosed(p: Pt[]): boolean {
  return p.length >= 4 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];
}

/** Kapanış noktası olmadan halka. */
export function openRing(r: Pt[]): Ring {
  return isClosed(r) ? r.slice(0, -1) : r.slice();
}

export function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i];
    const q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInRing(x: number, z: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1] || 1e-12) + a[0])
      inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, z: number, outer: Ring, holes: Ring[]): boolean {
  if (!pointInRing(x, z, outer)) return false;
  for (const h of holes) if (pointInRing(x, z, h)) return false;
  return true;
}

export function ringCentroid(r: Ring): Pt {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i];
    const q = r[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cz += (p[1] + q[1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const sx = r.reduce((s, p) => s + p[0], 0) / r.length;
    const sz = r.reduce((s, p) => s + p[1], 0) / r.length;
    return [sx, sz];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

function areaKind(t: Tags): AreaKind | null {
  const lu = t.landuse;
  const le = t.leisure;
  const na = t.natural;
  const am = t.amenity;
  if (na === 'water' || lu === 'reservoir' || lu === 'basin' || le === 'swimming_pool') return 'water';
  if (le === 'pitch' || le === 'track') return 'pitch';
  if (le === 'playground') return 'playground';
  if (am === 'parking') return 'parking';
  if (le === 'park' || le === 'garden' || le === 'dog_park') return 'park';
  if (na === 'wood' || lu === 'forest') return 'wood';
  if (na === 'scrub' || na === 'grassland' || lu === 'meadow') return 'scrub';
  if (
    lu === 'grass' ||
    lu === 'village_green' ||
    lu === 'recreation_ground' ||
    le === 'recreation_ground' ||
    le === 'common'
  )
    return 'grass';
  if (lu === 'cemetery' || am === 'grave_yard') return 'cemetery';
  if (lu === 'farmland' || lu === 'orchard' || lu === 'allotments' || lu === 'vineyard') return 'farmland';
  if (lu === 'residential') return 'residential';
  if (lu === 'commercial' || lu === 'retail') return 'commercial';
  if (lu === 'industrial' || lu === 'railway') return 'industrial';
  if (lu === 'construction' || lu === 'brownfield') return 'construction';
  if (
    am === 'school' ||
    am === 'university' ||
    am === 'college' ||
    am === 'kindergarten' ||
    am === 'hospital'
  )
    return 'school';
  if (le === 'sports_centre' || le === 'stadium') return 'pitch';
  return null;
}

function layerOf(t: Tags): number {
  return parseNum(t.layer) ?? 0;
}

/** SimpleOsm → tipli özellikler. */
export function parseOsm(d: SimpleOsm): OsmWorldData {
  const out: OsmWorldData = {
    center: d.center,
    centerSource: d.centerSource,
    half: d.half,
    buildings: [],
    roads: [],
    rails: [],
    areas: [],
    barriers: [],
    trees: [],
    treeRows: [],
    pois: [],
    crossings: [],
    lamps: [],
    shops: [],
    benches: [],
    shelters: [],
  };

  for (const n of d.nodes) {
    const t = n.t;
    if (t.natural === 'tree') out.trees.push([n.x, n.z]);
    if (t.highway === 'crossing') out.crossings.push([n.x, n.z]);
    if (t.highway === 'street_lamp') out.lamps.push([n.x, n.z]);
    if (t.amenity === 'bench') out.benches.push([n.x, n.z]);
    if (t.amenity === 'shelter' || t.highway === 'bus_stop') out.shelters.push([n.x, n.z]);
    if (t.shop || (t.amenity && /^(cafe|restaurant|fast_food|bank|pharmacy|bakery|pub|bar)$/.test(t.amenity)))
      out.shops.push([n.x, n.z]);
    if (t.name) {
      const kind = t.railway ?? t.public_transport ?? t.amenity ?? t.shop ?? t.leisure ?? t.place ?? 'place';
      out.pois.push({ id: `n${n.i}`, name: t.name, x: n.x, z: n.z, kind });
    }
  }

  // Poligonlar: way + relation
  interface Poly {
    id: string;
    outer: Ring;
    holes: Ring[];
    t: Tags;
  }
  const polys: Poly[] = [];
  for (const w of d.ways) {
    const pts = toPts(w.p);
    const t = w.t;
    const closed = isClosed(pts);
    if (t.highway) {
      if (t.area === 'yes' && closed) {
        if (t.highway === 'pedestrian' || t.highway === 'footway')
          out.areas.push({
            id: `w${w.i}`,
            kind: 'pedestrian',
            outer: openRing(pts),
            holes: [],
            name: t.name,
          });
        continue;
      }
      if (pts.length < 2) continue;
      const kind = t.highway;
      if (kind === 'proposed' || kind === 'construction' || kind === 'platform' || kind === 'elevator')
        continue;
      const vehicular = isVehicular(kind);
      const sw = sidewalks(t, vehicular);
      out.roads.push({
        id: `w${w.i}`,
        kind,
        name: t.name,
        pts,
        width: roadWidth(t),
        sidewalkLeft: sw.left,
        sidewalkRight: sw.right,
        layer: layerOf(t),
        bridge: !!t.bridge && t.bridge !== 'no',
        tunnel: (!!t.tunnel && t.tunnel !== 'no') || t.location === 'underground',
        area: false,
        vehicular,
      });
      continue;
    }
    if (t.railway && !t.building) {
      if (/^(light_rail|subway|rail|tram|narrow_gauge|monorail)$/.test(t.railway) && pts.length >= 2) {
        out.rails.push({
          id: `w${w.i}`,
          kind: t.railway,
          name: t.name,
          pts,
          bridge: !!t.bridge && t.bridge !== 'no',
          tunnel: (!!t.tunnel && t.tunnel !== 'no') || t.location === 'underground',
          layer: layerOf(t),
        });
      }
      if (t.railway === 'station' && t.name && closed) {
        const c = ringCentroid(openRing(pts));
        out.pois.push({ id: `w${w.i}`, name: t.name, x: c[0], z: c[1], kind: 'station' });
      }
      continue;
    }
    if (t.barrier && !t.building) {
      const kind = (t.barrier === 'city_wall' ? 'wall' : t.barrier) as Barrier['kind'];
      if (!['wall', 'fence', 'hedge', 'retaining_wall'].includes(kind)) continue;
      const h =
        parseLength(t.height) ??
        (kind === 'wall' ? 1.8 : kind === 'fence' ? 1.5 : kind === 'hedge' ? 1.2 : 1.0);
      out.barriers.push({ id: `w${w.i}`, kind, pts, height: h });
      continue;
    }
    if (t.natural === 'tree_row') {
      out.treeRows.push(pts);
      continue;
    }
    if (closed) polys.push({ id: `w${w.i}`, outer: openRing(pts), holes: [], t });
  }
  for (const r of d.rels) {
    const holes = r.n.map((f) => openRing(toPts(f)));
    for (let k = 0; k < r.o.length; k++) {
      const outer = openRing(toPts(r.o[k]));
      // Delikleri ait oldukları dış halkaya ata
      const own = holes.filter((h) => h.length && pointInRing(h[0][0], h[0][1], outer));
      polys.push({ id: `r${r.i}${r.o.length > 1 ? '_' + k : ''}`, outer, holes: own, t: r.t });
    }
  }

  // Bina: dükkan node'u içindeyse zemin kat dükkan
  const shopGrid = new Map<string, Pt[]>();
  for (const s of out.shops) {
    const k = `${Math.floor(s[0] / 50)},${Math.floor(s[1] / 50)}`;
    let a = shopGrid.get(k);
    if (!a) shopGrid.set(k, (a = []));
    a.push(s);
  }
  const hasShopIn = (ring: Ring): boolean => {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const p of ring) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    for (let gx = Math.floor((minX - 3) / 50); gx <= Math.floor((maxX + 3) / 50); gx++)
      for (let gz = Math.floor((minZ - 3) / 50); gz <= Math.floor((maxZ + 3) / 50); gz++)
        for (const s of shopGrid.get(`${gx},${gz}`) ?? []) {
          if (s[0] < minX - 3 || s[0] > maxX + 3 || s[1] < minZ - 3 || s[1] > maxZ + 3) continue;
          if (pointInRing(s[0], s[1], ring) || distToRing(s[0], s[1], ring) < 3) return true;
        }
    return false;
  };

  const parts: Poly[] = [];
  const mains: Poly[] = [];
  for (const p of polys) {
    const t = p.t;
    if (p.outer.length < 3) continue;
    if (t['building:part'] && t['building:part'] !== 'no') parts.push(p);
    else if (t.building && t.building !== 'no') mains.push(p);
    else {
      const kind = areaKind(t);
      if (kind) out.areas.push({ id: p.id, kind, outer: p.outer, holes: p.holes, name: t.name });
      if (t.name && (t.leisure || t.landuse || t.amenity || t.place || t.shop)) {
        const c = ringCentroid(p.outer);
        out.pois.push({
          id: p.id,
          name: t.name,
          x: c[0],
          z: c[1],
          kind: t.leisure ?? t.amenity ?? t.landuse ?? t.place ?? t.shop ?? 'area',
        });
      }
    }
  }
  const pushBuilding = (p: Poly, isPart: boolean) => {
    const t = p.t;
    const h = buildingHeights(t, hasShopIn(p.outer));
    out.buildings.push({
      id: p.id,
      outer: p.outer,
      holes: p.holes,
      ...h,
      kind: t.building ?? t['building:part'] ?? 'yes',
      isPart,
      colour: t['building:colour'],
      roofColour: t['roof:colour'],
      name: t.name,
    });
    if (t.name && !isPart) {
      const c = ringCentroid(p.outer);
      out.pois.push({
        id: p.id,
        name: t.name,
        x: c[0],
        z: c[1],
        kind: t.amenity ?? t.building ?? 'building',
      });
    }
  };
  // Outline kuralı: building:part içeren ana bina çizilmez.
  for (const m of mains) {
    const hasPart = parts.some((pt) => {
      const c = ringCentroid(pt.outer);
      return pointInRing(c[0], c[1], m.outer);
    });
    if (hasPart) {
      if (m.t.name) {
        const c = ringCentroid(m.outer);
        out.pois.push({ id: m.id, name: m.t.name, x: c[0], z: c[1], kind: 'building' });
      }
      continue;
    }
    pushBuilding(m, false);
  }
  for (const p of parts) pushBuilding(p, true);
  return out;
}

export function distToSegment(px: number, pz: number, a: Pt, b: Pt): number {
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const l2 = ex * ex + ez * ez;
  let t = l2 > 0 ? ((px - a[0]) * ex + (pz - a[1]) * ez) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + ex * t), pz - (a[1] + ez * t));
}

export function distToRing(px: number, pz: number, r: Ring): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) d = Math.min(d, distToSegment(px, pz, r[i], r[(i + 1) % r.length]));
  return d;
}
