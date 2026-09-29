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

/**
 * Bütün olarak bir parçaya giden öğeler (kesimde ikiye bölünüp iki kez çizilmesin): tabela, tente, pankart, bez,
 * alınlık, kemerli parapet, dormer — orta noktasının düştüğü parçaya, kırpılmadan.
 */
const WHOLE = new Set(['sign', 'awning', 'banner', 'cloth', 'pediment', 'arch', 'dormer']);

/**
 * Öğeyi [s, s+L] aralığına taşı (u → u − s); dışarıda kalırsa null. realA / realE: parça kenarının başı / sonu
 * binanın gerçek köşesi (kesim değil) — orada kırpılmaz (köşeyi saran balkon / taşma korunur).
 */
function shiftItem(it: CItem, s: number, L: number, realA = false, realE = false): CItem | null {
  if ('u0' in it && it.u0 != null && it.u1 != null) {
    const u0 = it.u0 - s;
    const u1 = it.u1 - s;
    if (WHOLE.has(it.t)) {
      // Orta nokta bu parçada mı (gerçek köşelerde uç dahil)
      const um = (u0 + u1) / 2;
      if (um < (realA ? -1e9 : 0) || um >= (realE ? 1e9 : L)) return null;
      const o = { ...it, u0, u1 } as CItem;
      if (o.t === 'pediment' && it.t === 'pediment') o.apex = it.apex - s;
      return o;
    }
    if (u1 <= 0.05 || u0 >= L - 0.05) return null;
    const o = { ...it, u0: realA ? u0 : Math.max(0, u0), u1: realE ? u1 : Math.min(L, u1) } as CItem;
    // Alınlık tepesi ve balkon saksıları da aynı kaydırmayla
    if (o.t === 'pediment' && it.t === 'pediment') o.apex = it.apex - s;
    if (o.t === 'bal' && o.pots)
      o.pots = Object.fromEntries(Object.entries(o.pots).map(([k, us]) => [k, us.map((u) => u - s)]));
    return o;
  }
  if (it.t === 'ribbon') {
    // Şerit: orta noktası bu parçadaysa bütün olarak
    const pts = it.pts.map(([u, y]) => [u - s, y] as [number, number]);
    const um = pts.reduce((a, p) => a + p[0], 0) / Math.max(1, pts.length);
    return um >= (realA ? -1e9 : 0) && um < (realE ? 1e9 : L) ? { ...it, pts } : null;
  }
  if (it.t === 'lamp') {
    // Aplik dizisi: parçaya düşen konumlar
    const us = it.us.map((u) => u - s).filter((u) => u >= (realA ? -0.5 : 0) && u <= (realE ? L + 0.5 : L));
    return us.length ? { ...it, us } : null;
  }
  if (!('u' in it) || it.u == null) return it;
  const u = it.u - s;
  if (u < (realA ? -0.5 : 0) || u > (realE ? L + 0.5 : L)) return null;
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
          const realA = sp < 0.01;
          const realE = sq > len - 0.01;
          const items = src.items
            .map((it) => shiftItem(it, sp, L, realA, realE))
            .filter((x): x is CItem => !!x);
          edges.push({ edge: j, len: L, seen: src.seen, items });
        }
        break;
      }
    }
    // Ek hacimler / pergolalar parçalara ayrıca dağıtılır (her parçaya kopyalanınca 3 kez çiziliyordu)
    return {
      ...blk,
      id: blk.id * 100 + tag,
      ring: r,
      storeys,
      edges,
      massing: undefined,
      volumes: null,
      pergolas: null,
      // Blok düzeyindeki duvar üstü kotu yalnız aynı kat sayılı parçalara geçer
      wallTop: storeys === blk.storeys ? (blk.wallTop ?? null) : null,
    };
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
    // x ya da z aralığı tek başına da olabilir (şema ikisini de isteğe bağlı tutar)
    let r = tw.x ? clipX(ring, tw.x[0], tw.x[1]) : ring;
    if (tw.z && r.length >= 3) r = clipZ(r, tw.z[0], tw.z[1]);
    return r.length >= 3 ? [r] : [];
  };
  m.towers.forEach((tw, k) => {
    // Parça kendi kat sayısını / çatısını taşıyabilir (ör. 7 katlı blok + 4 katlı kanat + 1 katlı podyum)
    pieces(tw).forEach((r, j) => {
      const p = part(r, tw.storeys ?? blk.storeys, (k + 1) * 10 + j);
      if (!p) return;
      // Parçanın kendi saçak kotu / kat yükseklikleri (ör. 1550614218 kanadı: saçak alnı 18.85–19.35)
      const q: CompiledBlock = {
        ...p,
        ...(tw.wallTop != null ? { wallTop: tw.wallTop } : {}),
        ...(tw.floorH != null ? { floorH: tw.floorH } : {}),
        ...(tw.floorHs?.length ? { floorHs: tw.floorHs } : {}),
      };
      out.push(tw.roof ? { ...q, roof: { ...q.roof, ...tw.roof } } : q);
    });
  });
  if (m.gap) {
    const r = clipX(ring, m.gap.x[0], m.gap.x[1]);
    const p = part(r, 1, 9);
    // Podyum üstü sokaktan görünmez; kenarı zemin kat bandıyla biter (açık gri saçak alnı yok — Street View)
    if (p) out.push({ ...p, roof: { ...p.roof, kind: 'flat', eave: 0.02, fasciaH: 0.02 } });
  }
  // Ek hacim / pergola: ağırlık merkezinin düştüğü parçaya (yoksa ilk parçaya) — bir kez
  const inPoly = (r: V2[], x: number, z: number) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, zi] = r[i];
      const [xj, zj] = r[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const home = (poly: [number, number][]) => {
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    return out.find((p) => inPoly(p.ring as V2[], cx, cz)) ?? out[0];
  };
  for (const v of blk.volumes ?? []) {
    const h = home(v.poly);
    if (h) h.volumes = [...(h.volumes ?? []), v];
  }
  for (const pg of blk.pergolas ?? []) {
    const h = home(pg.poly);
    if (h) h.pergolas = [...(h.pergolas ?? []), pg];
  }
  // v7: blok düzeyindeki kanat çatıları (roof.wings) yalnız kanadın düştüğü parçada (çokgen ağırlık merkezi, yoksa
  // mahya ortası) — her parçaya kopyalanınca kanat parça sayısı kadar çiziliyordu. Parçanın kendi roof.wings'i korunur.
  const bw = blk.roof.wings;
  if (bw?.length) {
    const own = out.filter((p) => p.roof.wings === bw);
    for (const p of own) p.roof = { ...p.roof, wings: null };
    for (const w of bw) {
      const pl: [number, number][] = w.poly?.length
        ? w.poly
        : [[(w.ridge[0][0] + w.ridge[1][0]) / 2, (w.ridge[0][1] + w.ridge[1][1]) / 2]];
      const cx = pl.reduce((a, q) => a + q[0], 0) / pl.length;
      const cz = pl.reduce((a, q) => a + q[1], 0) / pl.length;
      const h = own.find((p) => inPoly(p.ring as V2[], cx, cz)) ?? own[0];
      if (h) h.roof = { ...h.roof, wings: [...(h.roof.wings ?? []), w] };
    }
  }
  return out;
}
