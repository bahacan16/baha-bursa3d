import * as pcNs from 'polygon-clipping';
import type { CItem, CompiledBlock } from './facade';

type Pc = typeof pcNs;
const pc: Pc = (pcNs as unknown as { default?: Pc }).default ?? pcNs;

type V2 = [number, number];

/** Halkayı x ∈ [x0, x1] şeridine kırp (Sutherland–Hodgman, iki düşey yarı düzlem) */
function clipX(ring: V2[], x0: number, x1: number): V2[] {
  const half = (pts: V2[], keep: (p: V2) => boolean, xc: number): V2[] => {
    const out: V2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ka = keep(a);
      const kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) {
        const t = (xc - a[0]) / (b[0] - a[0]);
        out.push([xc, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  };
  const r = half(ring, (p) => p[0] >= x0, x0);
  const out = half(r, (p) => p[0] <= x1, x1);
  return dedupe(out);
}

/** Halkayı z ∈ [z0, z1] şeridine kırp */
function clipZ(ring: V2[], z0: number, z1: number): V2[] {
  const sw = (pts: V2[]) => pts.map((p) => [p[1], p[0]] as V2);
  return sw(clipX(sw(ring), z0, z1));
}

function dedupe(out: V2[]): V2[] {
  // Çakışık ardışık noktaları at
  return out.filter((p, i) => {
    const q = out[(i + out.length - 1) % out.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3;
  });
}

/** Öğeyi [s, s+L] aralığına taşı (u → u − s); dışarıda kalırsa null */
function shiftItem(it: CItem, s: number, L: number): CItem | null {
  if ('u0' in it && it.u0 != null && it.u1 != null) {
    const u0 = it.u0 - s;
    const u1 = it.u1 - s;
    if (u1 <= 0.05 || u0 >= L - 0.05) return null;
    const o = { ...it, u0: Math.max(0, u0), u1: Math.min(L, u1) } as CItem;
    // Alınlık tepesi ve balkon saksıları da aynı kaydırmayla
    if (o.t === 'pediment' && it.t === 'pediment') o.apex = it.apex - s;
    if (o.t === 'bal' && o.pots)
      o.pots = Object.fromEntries(Object.entries(o.pots).map(([k, us]) => [k, us.map((u) => u - s)]));
    return o;
  }
  if (!('u' in it) || it.u == null) return it;
  const u = it.u - s;
  if (u < 0 || u > L) return null;
  return { ...it, u } as CItem;
}

/**
 * KARAR: zemin katı ortak, üstü ayrık kuleli bloklar (ör. Doğan Avcıoğlu kuzey bloğu) ölçüm dosyasında tek taban
 * izi + `massing` x aralıklarıyla verilir; çalışma anında kulelere (tam kat) ve ara podyuma (yalnız zemin kat)
 * bölünür. Kesim kenarları (kuleler arası yan duvarlar) öğesiz, düz sıva.
 */
type Tower = NonNullable<CompiledBlock['massing']>['towers'][number];

/** Çokgen işareti (ayak bağı alanı): taban izleri negatif alanlı saklanır */
const area2 = (r: V2[]) =>
  r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0);

/** Parça kapsamı dünya çokgeni olarak (x/z aralığı → dikdörtgen) */
function towerPoly(tw: Tower): V2[] {
  if (tw.poly?.length) return tw.poly as V2[];
  const [x0, x1] = tw.x ?? [-1e4, 1e4];
  const [z0, z1] = tw.z ?? [-1e4, 1e4];
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

/** polygon-clipping çıktısı → negatif alanlı, kapanış tekrarı atılmış halkalar (delikler yok sayılır) */
function outerRings(mp: pcNs.MultiPolygon): V2[][] {
  const out: V2[][] = [];
  for (const poly of mp) {
    let r = poly[0].map((p) => [p[0], p[1]] as V2);
    const f = r[0];
    const l = r[r.length - 1];
    if (r.length > 1 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-9) r = r.slice(0, -1);
    r = dedupe(r);
    if (r.length < 3 || Math.abs(area2(r)) < 0.02) continue;
    if (area2(r) > 0) r.reverse();
    out.push(r);
  }
  return out;
}

/**
 * KARAR: zemin katı ortak, üstü ayrık kuleli bloklar (ör. Doğan Avcıoğlu kuzey bloğu) ölçüm dosyasında tek taban
 * izi + `massing` parçalarıyla verilir; çalışma anında parçalara bölünür. Parça: x (ve z) aralığı, dünya çokgeni
 * (`poly`, döndürülmüş şeritler — ör. yalnız güney şeritte K8) ya da `rest` (taban izinin diğer parçalar dışında
 * kalanı). Her parça kendi kat sayısı / çatısıyla. Kesim kenarları (parçalar arası yan duvarlar) öğesiz, düz sıva.
 */
export function splitMassing(blk: CompiledBlock): CompiledBlock[] {
  const m = blk.massing;
  if (!m?.towers?.length) return [blk];
  const ring = blk.ring as V2[];
  const N = ring.length;
  const byEdge = new Map(blk.edges.map((e) => [e.edge, e]));
  const part = (r: V2[], storeys: number, tag: number): CompiledBlock | null => {
    if (r.length < 3) return null;
    const edges: CompiledBlock['edges'] = [];
    for (let j = 0; j < r.length; j++) {
      const p = r[j];
      const q = r[(j + 1) % r.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      // Asıl kenarı bul (iki uç da üzerinde)
      for (let i = 0; i < N; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % N];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const t: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const off = (v: V2) => Math.abs((v[0] - a[0]) * t[1] - (v[1] - a[1]) * t[0]);
        const along = (v: V2) => (v[0] - a[0]) * t[0] + (v[1] - a[1]) * t[1];
        if (off(p) > 0.01 || off(q) > 0.01) continue;
        const sp = along(p);
        const sq = along(q);
        if (sp < -0.01 || sq > len + 0.01 || sq < sp) continue;
        const src = byEdge.get(i);
        if (src) {
          const items = src.items.map((it) => shiftItem(it, sp, L)).filter((x): x is CItem => !!x);
          edges.push({ edge: j, len: L, seen: src.seen, items });
        }
        break;
      }
    }
    return { ...blk, id: blk.id * 100 + tag, ring: r, storeys, edges, massing: undefined };
  };
  const out: CompiledBlock[] = [];
  const pieces = (tw: Tower): V2[][] => {
    if (tw.rest) {
      // Taban izinin diğer (rest olmayan) parçalar dışında kalan kısmı
      const others = m.towers.filter((o) => o !== tw && !o.rest).map((o) => [towerPoly(o)] as pcNs.Polygon);
      if (!others.length) return [ring];
      return outerRings(pc.difference([ring] as pcNs.Polygon, ...others));
    }
    if (tw.poly?.length) return outerRings(pc.intersection([ring] as pcNs.Polygon, [tw.poly as V2[]]));
    let r = clipX(ring, tw.x![0], tw.x![1]);
    if (tw.z && r.length >= 3) r = clipZ(r, tw.z[0], tw.z[1]);
    return r.length >= 3 ? [r] : [];
  };
  m.towers.forEach((tw, k) => {
    // Parça kendi kat sayısını / çatısını taşıyabilir (ör. 7 katlı blok + 4 katlı kanat + 1 katlı podyum)
    pieces(tw).forEach((r, j) => {
      const p = part(r, tw.storeys ?? blk.storeys, (k + 1) * 10 + j);
      if (p) out.push(tw.roof ? { ...p, roof: { ...p.roof, ...tw.roof } } : p);
    });
  });
  if (m.gap) {
    const r = clipX(ring, m.gap.x[0], m.gap.x[1]);
    const p = part(r, 1, 9);
    // Podyum üstü sokaktan görünmez; kenarı zemin kat bandıyla biter (açık gri saçak alnı yok — Street View)
    if (p) out.push({ ...p, roof: { ...p.roof, kind: 'flat', eave: 0.02, fasciaH: 0.02 } });
  }
  return out;
}
