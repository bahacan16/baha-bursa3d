import * as THREE from 'three';
import type { SimpleOsm } from '../osm/simplify';
import { Builder, type V2 } from './builder';
import { buildApartment } from './apartment';
import { buildFence, buildGate, type FenceSeg } from './site';
import { buildOzhan } from './ozhan';
import * as T from './textures';

/**
 * Mertkent 2. Etap ve çevresi — Street View karelerine bakılarak elle (kodla) modellenmiş bölüm.
 * OSM'den otomatik üretilen karşılıkları bu binalar için çizilmez.
 */
export const MERTKENT_BUILDINGS = [1480041342, 1480041343, 1480041344, 1480041345, 1540901795, 1540901796];
export const OZHAN_BUILDING = 1546816259;
export const HANDMADE_IDS = new Set([...MERTKENT_BUILDINGS, OZHAN_BUILDING]);

/** Site kapıları (Street View: kuzey kapı 29. panorama önü, batı kapı 9–19. panoramalar arası) */
const GATES: { c: V2; n: V2 }[] = [
  { c: [-30.9, -144.9], n: [0, -1] },
  { c: [-76.2, -69.2], n: [-1, 0] },
];

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

function ringOf(simple: SimpleOsm, id: number): V2[] | null {
  const w = simple.ways.find((x) => x.i === id);
  if (!w) return null;
  const r: V2[] = [];
  for (let i = 0; i < w.p.length; i += 2) r.push([w.p[i], w.p[i + 1]]);
  const f = r[0];
  const l = r[r.length - 1];
  if (r.length > 3 && f[0] === l[0] && f[1] === l[1]) r.pop();
  return r;
}

function distToRing(r: V2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const e = r[(i + 1) % r.length];
    const dx = e[0] - a[0];
    const dz = e[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return d;
}

function materials(): Record<string, THREE.Material> {
  const std = (p: THREE.MeshStandardMaterialParameters) =>
    new THREE.MeshStandardMaterial({ roughness: 0.85, ...p });
  const DS = THREE.DoubleSide;
  const m: Record<string, THREE.Material> = {
    plaster: std({ map: T.plasterTexture('#f1f0eb', 3), roughness: 0.92 }),
    plinth: std({ color: 0x8c8e8d }),
    sill: std({ color: 0xbdb9b0, roughness: 0.5 }),
    ochre: std({ color: 0xd49a4c, roughness: 0.8 }),
    eave: std({ color: 0x575b60, side: DS }),
    eaveBottom: std({ color: 0x6b6f73, side: DS }),
    slabTop: std({ color: 0xcfcfcb, side: DS }),
    slabBottom: std({ color: 0xf0efeb, side: DS }),
    fascia: std({ color: 0x4b4f54, side: DS }),
    glass: std({
      color: 0xc4dad6,
      transparent: true,
      opacity: 0.28,
      roughness: 0.05,
      metalness: 0.2,
      side: DS,
      depthWrite: false,
    }),
    rail: std({ color: 0xa7acb0, metalness: 0.6, roughness: 0.35 }),
    glazing: std({
      map: T.glazingTexture(),
      transparent: true,
      opacity: 0.82,
      roughness: 0.1,
      metalness: 0.3,
      side: DS,
    }),
    dish: std({ color: 0xe8e8e6, side: DS }),
    roof: std({ map: T.roofTileTexture(), side: DS, roughness: 0.75 }),
    stone: std({ map: T.groovedStoneTexture(), roughness: 0.9 }),
    cap: std({ color: 0xe0d2b6 }),
    panel: std({
      map: T.panelFenceTexture(),
      transparent: false,
      alphaTest: 0.4,
      side: DS,
      metalness: 0.3,
      roughness: 0.5,
    }),
    hedge: std({ map: T.hedgeTexture(), roughness: 0.95 }),
    wire: std({ color: 0xa3a7ab, metalness: 0.8, roughness: 0.3 }),
    capDark: std({ color: 0x2b2b2b }),
    globe: std({ color: 0xf6f4ee, emissive: 0x3a3a34, roughness: 0.3 }),
    black: std({ color: 0x1c1e1d, roughness: 0.6 }),
    gateOrn: std({ map: T.gateTexture(), roughness: 0.5, metalness: 0.4 }),
    gate: std({ map: T.gateTexture(), roughness: 0.5, metalness: 0.4, side: DS }),
    gateSign: std({
      map: T.signTexture(
        [
          {
            text: 'MERTKENT',
            size: 70,
            color: '#f4f4f4',
            weight: '800',
            font: 'Montserrat,Arial,sans-serif',
          },
          {
            text: 'Sitesi 2.Etap',
            size: 44,
            color: '#f4f4f4',
            weight: '600',
            font: 'Montserrat,Arial,sans-serif',
          },
        ],
        512,
        160,
        '#1c1e1d',
      ),
    }),
    ozFascia: std({ color: 0x8a3b27, side: DS, roughness: 0.6 }),
    ozSiding: std({ map: T.sidingTexture(), roughness: 0.7 }),
    ozDark: std({ color: 0x3a3330 }),
    ozDoor: std({ color: 0x2c3a40, roughness: 0.1, metalness: 0.6 }),
    ozGlass: std({ color: 0x3a4a52, roughness: 0.08, metalness: 0.7 }),
    ozPosterOzel: std({ map: T.ozhanPosterTexture('ozel') }),
    ozPosterSahane: std({ map: T.ozhanPosterTexture('sahane') }),
    ozPosterPlain: std({ map: T.ozhanPosterTexture('plain') }),
    ozPosterFood: std({ map: T.ozhanPosterTexture('food') }),
    ozLogo: std({ map: T.ozhanLogoTexture(), transparent: true, alphaTest: 0.3, side: DS, roughness: 0.4 }),
    ozPennant: std({ map: T.pennantTexture(), transparent: true, alphaTest: 0.4, side: DS }),
    ozBanner: std({ map: T.ozhanBannerTexture() }),
    ozSlat: std({ map: T.slatTexture(), metalness: 0.3, roughness: 0.5 }),
    ozRoof: std({ color: 0x7e8081 }),
  };
  for (let v = 0; v < 4; v++)
    m[`win${v}`] = std({ map: T.windowTexture(v + 1), roughness: 0.25, metalness: 0.1 });
  return m;
}

export interface MertkentOptions {
  simple: SimpleOsm;
  base: string;
  H: (x: number, z: number) => number;
  shadows: boolean;
  collide?: Collide;
}

/** Elle modellenmiş bölgeyi kurar. fenceSkip: StreetView çit kabuğunun bu bölgede çizilmemesi için. */
export async function buildMertkent(o: MertkentOptions): Promise<{
  group: THREE.Group;
  fenceSkip: (x: number, z: number) => boolean;
}> {
  const group = new THREE.Group();
  group.name = 'mertkent (el modeli)';
  const b = new Builder();
  const ringBase = (r: V2[]) => Math.min(...r.map((p) => o.H(p[0], p[1])));
  // Bloklar
  for (const id of MERTKENT_BUILDINGS) {
    const r = ringOf(o.simple, id);
    if (!r) continue;
    const base = ringBase(r);
    buildApartment(b, { ring: r, base, seed: id % 100000 });
    o.collide?.(
      r.map((p) => [p[0], p[1]]),
      base - 1,
      base + 25,
    );
  }
  // Özhan
  const oz = ringOf(o.simple, OZHAN_BUILDING);
  if (oz) buildOzhan(b, oz, ringBase(oz), o.collide);
  // Site sınırı: bake edilen çit hatlarından Mertkent 2 çevresindekiler
  const site = o.simple.ways.find((w) => w.t?.name === 'Mertkent 2. Etap');
  const siteRing: V2[] = [];
  if (site) for (let i = 0; i < site.p.length; i += 2) siteRing.push([site.p[i], site.p[i + 1]]);
  const nearSite = (x: number, z: number) => siteRing.length > 2 && distToRing(siteRing, x, z) < 13;
  try {
    const r = await fetch(`${o.base}streetview/mertkent-2-etap/fences.json`);
    if (r.ok) {
      const fj = (await r.json()) as { segs: { a: V2; e: V2; y0: number; n: V2 }[] };
      const segs: FenceSeg[] = fj.segs
        .filter((s) => nearSite((s.a[0] + s.e[0]) / 2, (s.a[1] + s.e[1]) / 2))
        .map((s) => ({ a: s.a, e: s.e, y0: Math.min(o.H(s.a[0], s.a[1]), o.H(s.e[0], s.e[1])), n: s.n }));
      buildFence(
        b,
        segs,
        GATES.map((g) => g.c),
        o.collide,
      );
    }
  } catch {
    /* çit verisi yoksa atla */
  }
  for (const g of GATES) buildGate(b, g.c, g.n, o.H(g.c[0], g.c[1]));
  b.build(materials(), group, o.shadows);
  return { group, fenceSkip: nearSite };
}
