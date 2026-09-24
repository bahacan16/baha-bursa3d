import { H } from './height';
import { distToSegment, pointInPolygon, type OsmWorldData, type Pt, type Road } from './parse';
import { SIDEWALK_W } from './roads';

/** Sokak donatıları: [x, y, z, yaw]* düz diziler. */
export interface PropsPayload {
  lamps: Float32Array;
  benches: Float32Array;
  shelters: Float32Array;
  /** Park etmiş araçlar [x, y, z, yaw, renkIndeksi]* */
  parked: Float32Array;
}

const LAMP_SPACING = 32;

class SegHash {
  private m = new Map<string, { a: Pt; b: Pt; r: Road }[]>();
  constructor(private cell = 30) {}
  add(a: Pt, b: Pt, r: Road) {
    const c = this.cell;
    for (let x = Math.floor(Math.min(a[0], b[0]) / c) - 1; x <= Math.floor(Math.max(a[0], b[0]) / c) + 1; x++)
      for (
        let z = Math.floor(Math.min(a[1], b[1]) / c) - 1;
        z <= Math.floor(Math.max(a[1], b[1]) / c) + 1;
        z++
      ) {
        const k = `${x},${z}`;
        let v = this.m.get(k);
        if (!v) this.m.set(k, (v = []));
        v.push({ a, b, r });
      }
  }
  near(x: number, z: number) {
    return this.m.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`) ?? [];
  }
}

/** En yakın yola bakan yaw (nesnenin +Z'si yola dönük). */
function facingRoad(x: number, z: number, hash: SegHash): number {
  let best = Infinity;
  let yaw = 0;
  for (const s of hash.near(x, z)) {
    const d = distToSegment(x, z, s.a, s.b);
    if (d < best) {
      best = d;
      const ex = s.b[0] - s.a[0];
      const ez = s.b[1] - s.a[1];
      const l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * ex + (z - s.a[1]) * ez) / l2));
      const qx = s.a[0] + ex * t - x;
      const qz = s.a[1] + ez * t - z;
      yaw = Math.atan2(qx, qz);
    }
  }
  return yaw;
}

/**
 * Lambalar: OSM'deki highway=street_lamp + araç yollarının kaldırım dış kenarında ~32 m arayla.
 * KARAR: OSM'de bölgede yalnızca birkaç lamba işaretli; yol kenarı lambaları konum olarak yaklaşıktır.
 * Banklar ve duraklar yalnızca OSM'deki gerçek konumlardır.
 */
export function buildProps(d: OsmWorldData): PropsPayload {
  const hash = new SegHash();
  for (const r of d.roads) {
    if (r.tunnel) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) hash.add(r.pts[i], r.pts[i + 1], r);
  }
  const inBuilding = (x: number, z: number) =>
    d.buildings.some((b) => {
      const p = b.outer[0];
      return Math.abs(p[0] - x) < 150 && Math.abs(p[1] - z) < 150 && pointInPolygon(x, z, b.outer, b.holes);
    });
  const onCarriage = (x: number, z: number) =>
    hash.near(x, z).some((s) => s.r.vehicular && distToSegment(x, z, s.a, s.b) < s.r.width / 2 + 0.3);

  const lamps: number[] = [];
  for (const [x, z] of d.lamps) lamps.push(x, H(x, z), z, facingRoad(x, z, hash));
  const placed: Pt[] = [];
  const nodeUse = new Map<string, number>();
  for (const r of d.roads)
    for (const p of r.pts) nodeUse.set(`${p[0]},${p[1]}`, (nodeUse.get(`${p[0]},${p[1]}`) ?? 0) + 1);
  for (const r of d.roads) {
    if (!r.vehicular || r.tunnel) continue;
    const off = r.width / 2 + SIDEWALK_W - 0.35;
    let acc = LAMP_SPACING / 2;
    let side = 1;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.1) continue;
      const nx = -dz / len;
      const nz = dx / len;
      for (let s = acc; s < len; s += LAMP_SPACING) {
        const t = s / len;
        const cx = a[0] + dx * t;
        const cz = a[1] + dz * t;
        // Kavşağa çok yakınsa atla
        const nearJunction = [a, b].some(
          (p) => (nodeUse.get(`${p[0]},${p[1]}`) ?? 0) > 1 && Math.hypot(p[0] - cx, p[1] - cz) < 10,
        );
        side = r.width >= 10 ? -side : 1; // geniş yollarda iki yana sırayla
        const x = cx + nx * off * side;
        const z = cz + nz * off * side;
        if (nearJunction || onCarriage(x, z) || inBuilding(x, z)) continue;
        if (placed.some((p) => Math.abs(p[0] - x) < 12 && Math.abs(p[1] - z) < 12)) continue;
        placed.push([x, z]);
        lamps.push(x, H(x, z), z, Math.atan2(-nx * side, -nz * side));
      }
      acc = (acc - len) % LAMP_SPACING;
      if (acc < 0) acc += LAMP_SPACING;
    }
  }
  // Park etmiş araçlar: konut sokaklarında kaldırım kenarı (konumlar yaklaşık, gerçek değil)
  // KARAR: Dar (< 8 m) yollarda tek taraf, araçlar bordüre ~0.35 m taşar (bölgede yaygın).
  const parked: number[] = [];
  const crossings = d.crossings;
  let seed = 4242;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const PARK_KINDS = new Set(['residential', 'unclassified', 'living_street', 'tertiary']);
  for (const r of d.roads) {
    if (!PARK_KINDS.has(r.kind) || r.tunnel || r.bridge) continue;
    const sides = r.width >= 8 ? [1, -1] : [-1];
    for (const side of sides) {
      const off = (r.width / 2 - 0.55) * side;
      let acc = 3;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i];
        const b = r.pts[i + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.1) continue;
        const nx = -dz / len;
        const nz = dx / len;
        for (let s2 = acc; s2 < len - 2.5; s2 += 5.6) {
          if (rnd() > 0.5) continue;
          const cx = a[0] + (dx * s2) / len;
          const cz = a[1] + (dz * s2) / len;
          const x = cx + nx * off;
          const z = cz + nz * off;
          const nearNode = [a, b].some(
            (p) => (nodeUse.get(`${p[0]},${p[1]}`) ?? 0) > 1 && Math.hypot(p[0] - cx, p[1] - cz) < 13,
          );
          if (nearNode || crossings.some((c) => Math.abs(c[0] - cx) < 7 && Math.abs(c[1] - cz) < 7)) continue;
          if (inBuilding(x, z)) continue;
          const yaw = Math.atan2(dx, dz) + (side < 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.06;
          parked.push(x, H(x, z) + 0.04, z, yaw, Math.floor(rnd() * 1000));
        }
        acc = 2.8;
      }
    }
  }

  const benches: number[] = [];
  for (const [x, z] of d.benches) benches.push(x, H(x, z), z, facingRoad(x, z, hash));
  const shelters: number[] = [];
  for (const [x, z] of d.shelters) shelters.push(x, H(x, z), z, facingRoad(x, z, hash));
  return {
    lamps: new Float32Array(lamps),
    benches: new Float32Array(benches),
    shelters: new Float32Array(shelters),
    parked: new Float32Array(parked),
  };
}
