import { ChunkedGeometry, type ChunkPayload } from './chunks';
import { buildBuilding } from './buildings';
import { buildRoads, type Carriageway, type RaisedStrip } from './roads';
import { buildAreas, buildBarriers } from './landuse';
import { buildRails, type Pier } from './rail';
import { placeTrees, treesToPayload, type TreePayload } from './vegetation';
import { parseOsm, type OsmWorldData } from './parse';
import type { SimpleOsm } from './simplify';
import type { Quality } from '../../core/settings';
import type { GridData } from '../../env/terrain';
import { setTerrain } from './height';
import { buildProps, type PropsPayload } from './props';

export interface BuildOptions {
  quality: Quality;
  /** Yakın arazi ızgarası (yoksa düz). */
  terrain?: GridData | null;
  /** Alan kullanımını ayrı mesh olarak üret (varsayılan: hayır — arazi dokusuna boyanır). */
  landuseMeshes?: boolean;
  roofColors?: Record<string, readonly number[]>;
  aerialTrees?: Float32Array | number[];
}

export interface BuildResult {
  chunks: ChunkPayload[];
  trees: TreePayload;
  props: PropsPayload;
  strips: RaisedStrip[];
  carriageways: Carriageway[];
  piers: Pier[];
  stats: Record<string, number>;
}

export type ProgressFn = (fraction: number, label: string) => void;

/** Tüm Mod B geometrisini üretir (Worker içinde ya da ana iş parçacığında). */
export function buildWorld(
  simple: SimpleOsm,
  opts: BuildOptions,
  progress: ProgressFn = () => {},
  parsed?: OsmWorldData,
): BuildResult {
  const t0 = Date.now();
  setTerrain(opts.terrain);
  const d = parsed ?? parseOsm(simple);
  progress(0.05, 'Veri ayrıştırıldı');
  const geo = new ChunkedGeometry();
  const roofDetails = opts.quality !== 'low';

  const n = d.buildings.length;
  for (let i = 0; i < n; i++) {
    let b = d.buildings[i];
    // Fotoğrafta kiremit görülen düz çatılı bina → kırma çatı (duvar üstü aynı kalır, çatı eklenir)
    if (opts.roofColors?.[b.id]?.[3] && b.roofShape === 'flat' && !b.isPart && b.levels <= 12) {
      const rh = 2.8;
      b = { ...b, roofShape: 'hipped', roofHeight: rh, wallTop: b.height, height: b.height + rh };
    }
    buildBuilding(geo, b, { roofDetails, roofColors: opts.roofColors });
    if (i % 250 === 0) progress(0.05 + 0.45 * (i / Math.max(1, n)), `Binalar (${i}/${n})`);
  }
  progress(0.5, 'Yollar');
  const roads = buildRoads(geo, d.roads, d.crossings);
  progress(0.65, 'Alanlar');
  if (opts.landuseMeshes) buildAreas(geo, d.areas);
  buildBarriers(geo, d.barriers);
  progress(0.72, 'Raylar');
  // KARAR: Travers geometrisi gerçek veride ~180k üçgen tutuyordu; kapalı.
  const rails = buildRails(geo, d.rails, { sleepers: false });
  progress(0.8, 'Ağaçlar');
  const maxTrees = opts.quality === 'low' ? 4000 : opts.quality === 'medium' ? 10000 : 16000;
  const density = opts.quality === 'low' ? 0.5 : opts.quality === 'medium' ? 0.8 : 1;
  const trees = placeTrees(d.trees, d.treeRows, d.areas, d.roads, d.buildings, {
    maxTrees,
    density,
    aerialTrees: opts.aerialTrees,
  });
  const props = buildProps(d);
  progress(0.9, 'Geometri birleştiriliyor');
  const chunks = geo.toPayload();
  const tris = chunks.reduce((s, c) => s + c.index.length / 3, 0);
  return {
    chunks,
    trees: treesToPayload(trees),
    props,
    strips: [...roads.strips, ...rails.gradeStrips.map((g) => ({ ...g, inner: 0, outer: g.half }))],
    carriageways: roads.carriageways,
    piers: rails.piers,
    stats: {
      buildings: n,
      roads: d.roads.length,
      trees: trees.length,
      chunks: new Set(chunks.map((c) => `${c.cx},${c.cz}`)).size,
      meshes: chunks.length,
      triangles: tris,
      ms: Date.now() - t0,
    },
  };
}

export function transferables(r: BuildResult): Transferable[] {
  const t: Transferable[] = [];
  for (const c of r.chunks) {
    t.push(c.position.buffer, c.normal.buffer, c.uv.buffer, c.color.buffer, c.index.buffer);
    if (c.facade) t.push(c.facade.buffer);
  }
  for (const c of r.trees.chunks) t.push(c.data.buffer);
  t.push(r.props.lamps.buffer, r.props.benches.buffer, r.props.shelters.buffer, r.props.parked.buffer);
  return t;
}
