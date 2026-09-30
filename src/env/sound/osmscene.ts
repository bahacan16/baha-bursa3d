import type { OsmWorldData, Ring } from '../../worlds/osm/parse';
import { pointInPolygon, pointInRing, ringCentroid, signedArea } from '../../worlds/osm/parse';
import { PARK_PLAN, SITE_PLAN, STREET_PLAN } from '../../worlds/measured/siteplan';
import { aerialSurface, osmAreaSurface, planSurface, type FootSurface } from './surfaces';
import type {
  SoundBuilding,
  SoundCar,
  SoundPlace,
  SoundPoint,
  SoundRail,
  SoundRoad,
  SoundScene,
  XZ,
} from './types';

export type PavedKind = 'road' | 'sidewalk' | 'area' | null;

export interface OsmSceneOptions {
  /** Gerçek veri mi (fixture değil) — ölçülmüş site/sokak planları yalnız gerçek koordinatlarda geçerli */
  real: boolean;
  /** GroundIndex: araç yolu / kaldırım / ölçülmüş yükseltilmiş alan */
  paved?: (x: number, z: number) => PavedKind;
  groundY?: (x: number, z: number) => number;
  /** Ağaçlar x,z (verilmezse OSM ağaçları) */
  trees?: Float32Array;
  cars?: () => readonly SoundCar[];
  /** Hava fotoğrafı (arazi dokusu) — yalnız başka zemin verisi yokken */
  aerial?: HTMLImageElement | null;
  /** Hava fotoğrafı yarı genişliği (m) */
  aerialHalf?: number;
  /** Hemzemin ray balastı üzerinde mi (→ çakıl) */
  ballast?: (x: number, z: number) => boolean;
}

interface PolyEntry {
  ring: Ring;
  holes: Ring[];
  surface: FootSurface | 'hard';
  area: number;
}

const CELL = 25;

/**
 * OSM (+ ölçülmüş el modeli planları) → SoundScene. Mod B'de OsmWorld, Mod A'da HUD için ayrıştırılan OSM verisi
 * ile kurulur (Mod A'da zemin/ağaç/araç bilgisi daha kaba).
 */
export class OsmSoundScene implements SoundScene {
  readonly buildings: SoundBuilding[] = [];
  readonly roads: SoundRoad[] = [];
  readonly rails: SoundRail[] = [];
  readonly stations: SoundPoint[] = [];
  readonly mosques: SoundPoint[] = [];
  readonly places: SoundPlace[] = [];
  readonly trees: Float32Array;
  private polys = new Map<number, PolyEntry[]>();
  private metal: { x: number; z: number; r: number }[] = [];
  private aerialPx: Uint8ClampedArray | null = null;
  private aerialSize = 0;
  private aerialHalf: number;
  private readonly noCars: SoundCar[] = [];

  constructor(
    data: OsmWorldData,
    private o: OsmSceneOptions,
  ) {
    this.aerialHalf = o.aerialHalf ?? 1300;
    const H = o.groundY ?? (() => 0);
    for (const b of data.buildings) {
      const c = ringCentroid(b.outer);
      const base = H(c[0], c[1]) + b.minHeight;
      this.buildings.push({ ring: b.outer, base, top: H(c[0], c[1]) + b.height });
      if (!data.mosques && b.kind === 'mosque' && !b.isPart)
        this.mosques.push({ id: b.id, x: c[0], z: c[1], name: b.name });
    }
    // Camiler parse.ts'den (building:part'lı camilerin ana hattı bina listesinde yok; ör. Hacı Makbule Yeter Cami)
    for (const m of data.mosques ?? [])
      this.mosques.push({ id: m.id, x: m.x, z: m.z, name: m.name || undefined });
    for (const r of data.roads)
      this.roads.push({ kind: r.kind, name: r.name, pts: r.pts, width: r.width, vehicular: r.vehicular });
    for (const r of data.rails)
      this.rails.push({ kind: r.kind, name: r.name, pts: r.pts, tunnel: r.tunnel, bridge: r.bridge });
    const seen = new Set<string>();
    for (const p of data.pois) {
      if (p.kind === 'station' && !seen.has(p.name)) {
        seen.add(p.name);
        this.stations.push({ id: p.id, x: p.x, z: p.z, name: p.name });
      }
    }
    // Yer türleri (çocuk, cırcır, inşaat)
    for (const a of data.areas) {
      const c = ringCentroid(a.outer);
      const r = Math.sqrt(Math.abs(signedArea(a.outer)) / Math.PI);
      if (a.kind === 'playground')
        this.places.push({ kind: 'playground', x: c[0], z: c[1], r, name: a.name });
      else if (a.kind === 'pitch') this.places.push({ kind: 'pitch', x: c[0], z: c[1], r, name: a.name });
      else if (a.kind === 'construction') this.places.push({ kind: 'construction', x: c[0], z: c[1], r });
      else if (a.kind === 'park' || a.kind === 'grass' || a.kind === 'wood')
        this.places.push({ kind: a.kind === 'park' ? 'park' : 'green', x: c[0], z: c[1], r, name: a.name });
      const s = osmAreaSurface(a.kind);
      if (s) this.addPoly(a.outer, a.holes, s, 1e6); // OSM alanları ölçülmüş planlardan sonra gelir
    }
    const planTrees = o.real ? this.addPlans() : [];
    if (!o.paved) this.o = { ...o, paved: roadPavedIndex(this.roads) };
    const base = o.trees ?? new Float32Array(data.trees.flatMap((p) => [p[0], p[1]]));
    this.trees = new Float32Array(base.length + planTrees.length);
    this.trees.set(base);
    this.trees.set(planTrees, base.length);
    if (o.aerial) this.prepareAerial(o.aerial);
  }

  /**
   * Ölçülmüş site ve park planları (site-plan.json, park-plan.json) + sokak planı rögar/ızgaraları.
   * @returns plan ağaçları ve çalıları (x,z) — el modelinde çizilen, OSM ağaç listesinde olmayanlar
   */
  private addPlans(): number[] {
    const trees: number[] = [];
    for (const plan of [SITE_PLAN, PARK_PLAN])
      for (const p of plan.points ?? []) if (p.kind === 'tree' || p.kind === 'shrub') trees.push(p.x, p.z);
    for (const s of STREET_PLAN.street ?? []) if (s.kind === 'tree') trees.push(s.x, s.z);
    for (const plan of [SITE_PLAN, PARK_PLAN]) {
      for (const a of plan.areas ?? []) {
        const s = planSurface(a.kind, a.material ?? '');
        if (!s || a.poly.length < 3) continue;
        this.addPoly(a.poly as Ring, [], s, 0);
        if (a.kind === 'playground') {
          const c = ringCentroid(a.poly as Ring);
          this.places.push({ kind: 'playground', x: c[0], z: c[1], r: 8 });
        }
        if (a.kind === 'court') {
          const c = ringCentroid(a.poly as Ring);
          this.places.push({ kind: 'pitch', x: c[0], z: c[1], r: 12 });
        }
      }
    }
    // Site avlusu (çocuk sesi): site planının taban çimi ağırlık merkezi
    const base = (SITE_PLAN.areas ?? []).find((a) => a.kind === 'lawn');
    if (base) {
      const c = ringCentroid(base.poly as Ring);
      this.places.push({ kind: 'courtyard', x: c[0], z: c[1], r: 30, name: 'site' });
    }
    for (const s of STREET_PLAN.street ?? []) {
      // Dökme demir rögar kapağı Ø≈0.7, yağmur suyu ızgarası ~0.8×0.4
      if (s.kind === 'manhole') this.metal.push({ x: s.x, z: s.z, r: 0.4 });
      else if (s.kind === 'drain') this.metal.push({ x: s.x, z: s.z, r: 0.35 });
    }
    return trees;
  }

  /** @param bias alan önceliği: küçük alan kazanır; OSM alanlarına büyük sabit eklenir (planlar önce) */
  private addPoly(ring: Ring, holes: Ring[], surface: FootSurface | 'hard', bias: number): void {
    const area = Math.abs(signedArea(ring)) + bias;
    const e: PolyEntry = { ring, holes, surface, area };
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const p of ring) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[1]);
      z1 = Math.max(z1, p[1]);
    }
    for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++)
      for (let z = Math.floor(z0 / CELL); z <= Math.floor(z1 / CELL); z++) {
        const k = (x + 32768) * 65536 + (z + 32768);
        let a = this.polys.get(k);
        if (!a) this.polys.set(k, (a = []));
        a.push(e);
      }
  }

  private prepareAerial(img: HTMLImageElement): void {
    try {
      const S = 1024;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, S, S);
      this.aerialPx = ctx.getImageData(0, 0, S, S).data;
      this.aerialSize = S;
    } catch {
      this.aerialPx = null;
    }
  }

  private aerialAt(x: number, z: number, hard: boolean): FootSurface | null {
    const px = this.aerialPx;
    if (!px) return null;
    const S = this.aerialSize;
    const k = S / (this.aerialHalf * 2);
    const i = Math.floor((x + this.aerialHalf) * k);
    const j = Math.floor((z + this.aerialHalf) * k);
    if (i < 1 || j < 1 || i >= S - 1 || j >= S - 1) return null;
    // 3×3 ortalama (~7.5 m) — tek piksel gürültüsü olmasın
    let r = 0,
      g = 0,
      b = 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const o = ((j + dj) * S + (i + di)) * 4;
        r += px[o];
        g += px[o + 1];
        b += px[o + 2];
      }
    return aerialSurface(r / 9, g / 9, b / 9, hard);
  }

  surfaceAt(x: number, z: number): FootSurface {
    for (const m of this.metal) if (Math.abs(m.x - x) < m.r && Math.abs(m.z - z) < m.r) return 'metal';
    const k = (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768);
    let best: PolyEntry | null = null;
    for (const e of this.polys.get(k) ?? []) {
      if (best && e.area >= best.area) continue;
      if (e.holes.length ? pointInPolygon(x, z, e.ring, e.holes) : pointInRing(x, z, e.ring)) best = e;
    }
    // Ölçülmüş plan alanı (bias 0) her şeyden önce
    if (best && best.area < 1e6 && best.surface !== 'hard') return best.surface;
    if (this.o.ballast?.(x, z)) return 'gravel';
    const paved = this.o.paved?.(x, z) ?? null;
    if (paved === 'road') return 'asphalt';
    if (paved === 'sidewalk' || paved === 'area') return 'pavers';
    if (best) {
      if (best.surface !== 'hard') return best.surface;
      return this.aerialAt(x, z, true) ?? 'pavers';
    }
    return this.aerialAt(x, z, false) ?? 'grass';
  }

  groundY(x: number, z: number): number {
    return this.o.groundY?.(x, z) ?? 0;
  }

  cars(): readonly SoundCar[] {
    return this.o.cars?.() ?? this.noCars;
  }
}

/**
 * GroundIndex olmayan dünyalar (Mod A) için kaba yol/kaldırım ayrımı: araç yolu ekseninden yarım genişlik içi
 * asfalt, +2.5 m kaldırım (KARAR: etiketsiz araç yollarına iki yanlı kaldırım, parse.ts ile aynı varsayım).
 */
export function roadPavedIndex(roads: readonly SoundRoad[]): (x: number, z: number) => PavedKind {
  const C = 20;
  const cells = new Map<
    number,
    { ax: number; az: number; bx: number; bz: number; half: number; veh: boolean }[]
  >();
  for (const r of roads) {
    const half = r.width / 2;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a: XZ = r.pts[i];
      const b: XZ = r.pts[i + 1];
      const s = { ax: a[0], az: a[1], bx: b[0], bz: b[1], half, veh: r.vehicular };
      const pad = half + 3;
      for (
        let x = Math.floor((Math.min(a[0], b[0]) - pad) / C);
        x <= Math.floor((Math.max(a[0], b[0]) + pad) / C);
        x++
      )
        for (
          let z = Math.floor((Math.min(a[1], b[1]) - pad) / C);
          z <= Math.floor((Math.max(a[1], b[1]) + pad) / C);
          z++
        ) {
          const k = (x + 32768) * 65536 + (z + 32768);
          let arr = cells.get(k);
          if (!arr) cells.set(k, (arr = []));
          arr.push(s);
        }
    }
  }
  return (x, z) => {
    let out: PavedKind = null;
    for (const s of cells.get((Math.floor(x / C) + 32768) * 65536 + (Math.floor(z / C) + 32768)) ?? []) {
      const ex = s.bx - s.ax;
      const ez = s.bz - s.az;
      const l2 = ex * ex + ez * ez;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2)) : 0;
      const d = Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t));
      if (d < s.half) return s.veh ? 'road' : 'sidewalk';
      if (s.veh && d < s.half + 2.5) out = 'sidewalk';
    }
    return out;
  };
}
