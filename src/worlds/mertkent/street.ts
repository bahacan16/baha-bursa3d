import * as THREE from 'three';
import { Builder, type V2, type V3 } from './builder';
import { sideNormal, type StreetPlan } from './siteplan';

/**
 * Ölçülmüş sokak planı (data/street-plan.json): kaldırımlar (bordür hattından içeri w genişlik, kilit taşı
 * türü/bantları), bordür taşları, sokak eşyası (lamba direği, levha, direk, çöp kutusu, babalar, ayna, rögar,
 * sokak ağaçlarının çukuru), kavşak adası, ayrım adaları, yaya geçitleri, trafik ışıkları, reklam panosu sıraları.
 */

const KERB_W = 0.15;
/**
 * Bordür birim boyu (m): kullanıcı fotoğrafı 502sk-bati-bisiklet.jpg metrik düzeltmede enine derzler ≈0.70–0.73 m
 * (aynı görüntüde taş modülü 0.200 m), Street View JDIg_180_-50 (DA-2, 2019) ve zoTd7_256_-15_40 (DA-1, 2025)
 * ≈0.71–0.74 m (`scripts/real-textures.mjs measure`). Önceden 1 m idi.
 */
const KERB_UNIT = 0.72;
/** Bordür boyası: yol yüzü + üstün dış yarısı (düzeltilmiş fotoğrafta üstün iç ~7 cm'i gri beton, dışı beyaz) */
const PAINT_TOP = 0.08;
const SHOW_BIKE = !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('nobike'));

export interface StreetResult {
  /** Yürüme yüksekliği için yükseltilmiş alanlar (arazinin üstünde h metre) */
  raised: { poly: [number, number][]; h: number }[];
  /** Kaldırım şeritlerinin kapsadığı alan (OSM kaldırımını/el kaldırımını çizmemek için) */
  covers: (x: number, z: number) => boolean;
}

function inside(r: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Bordür hattına göre kaldırım bandı: v0..v1 (m, bordürden kaldırım tarafına), h: bordür üstü kotu */
interface Band {
  v0: number;
  v1: number;
  key: string;
  h: number;
}
interface Layout {
  bands: Band[];
  /** Hissedilebilir kılavuz şerit (orta v, genişlik) */
  tactile?: [number, number];
  /** Ek bordürler (v, yükseklik) — ör. park cebi ile yaya kaldırımı arası */
  kerbs?: [number, number][];
  /** Yol tarafında bordüre bitişik bisiklet şeridi genişliği */
  bike?: number;
}

/**
 * Ölçüm notlarındaki kaldırım düzeni (street-plan.json malzeme metinlerinden, bordürden içeri metre).
 * KARAR: serbest metni ayrıştırmak yerine hat kimliğine göre tablo; bilinmeyen hatlar metinden tahmin edilir.
 */
/** Katman malzeme metninden anahtar */
export function layerKey(m: string): string {
  const t = m.toLowerCase();
  // Baş ifade (ilk ayraca kadar) katmanın kendi malzemesi; devamında komşu bantlar da anılıyor. Ör. 502. Sk. batı:
  // "gri beton kilit taşı 10×20, boyuna …: bordürden 0.40 gri + 0.32 sarı kılavuz …" tüm bandı kılavuz yapıyordu;
  // "krem/bej beton kenar taşı (çime karşı)" çim çiziliyordu.
  const head = t.split(/[:;,(]/)[0];
  if (/tactile|kılavuz|hissedilebilir/.test(head)) return 'tactile';
  if (/grass|çim|lawn|verge/.test(head)) return 'lawn';
  // Beton kenar taşı sırası: krem/bej → krem kenar taşı, diğerleri gri bordür betonu (gerçek bordür dokusu)
  if (/kenar taşı|edging/.test(head) && !/kilit|paver/.test(head))
    return /krem|bej|cream/.test(head) ? 'edging' : 'curb';
  if (/asphalt|asfalt/.test(t)) return 'roadFill';
  if (/concrete|beton/.test(t) && !/interlock|kilit|paver/.test(t)) return 'spConcrete';
  if (/gravel|çakıl|toprak|dirt|soil/.test(t)) return 'spGravel';
  // KARAR: kırmızı bant yalnız ölçümde açıkça yazıyorsa (Doğan Avcıoğlu: Street View zemin karelerinde bordür
  // boyunca kiremit-kahve bant net görünüyor); aksi hâlde Nilüfer tipi gri + sarı [+ mavi]
  if (/kırmızı|kiremit|red|terracotta/.test(t) && !/gri|grey/.test(t.split(/[;,(]/)[0])) return 'spPaverRed';
  return 'spPaverGrey';
}

function layoutOf(sw: {
  id?: string;
  w: number;
  kerbH?: number;
  material?: string;
  layers?: { w?: number; material?: string; h?: number; at?: number }[];
  /** Yol tarafında, bordüre bitişik mavi bisiklet şeridi genişliği (m) */
  bike?: number;
}): Layout {
  const W = sw.w;
  const h = sw.kerbH ?? 0.15;
  if (sw.layers?.length) {
    // Ölçülmüş katmanlar (bordürden içeri); "at" verilenler kılavuz şerit gibi üstte ince bantlar
    const bands: Band[] = [];
    let v = KERB_W;
    let tactile: [number, number] | undefined;
    const kerbs: [number, number][] = [];
    for (const L of sw.layers) {
      const key = layerKey(L.material ?? '');
      if (L.at != null) {
        tactile = [L.at, 0.4];
        continue;
      }
      const w = L.w ?? 0;
      if (w <= 0) continue;
      const lh = L.h ?? h;
      if (bands.length && Math.abs(bands[bands.length - 1].h - lh) > 0.05 && lh > 0.06) kerbs.push([v, lh]);
      bands.push({ v0: v, v1: Math.min(W, v + w), key, h: lh });
      v += w;
    }
    return { bands, tactile, kerbs, bike: sw.bike };
  }
  switch (sw.id) {
    case 'east-west-side':
      // 502. Sk. batı: gri kilit taşı, ortada sarı kılavuz, yol tarafında mavi bisiklet şeridi (kullanıcı fotoğrafı)
      return {
        bands: [{ v0: KERB_W, v1: W, key: 'spPaverGrey', h }],
        tactile: [(KERB_W + W) / 2, 0.4],
        bike: 1.15,
      };
    case 'north-south-side':
      // Doğan Avcıoğlu güney (Mertkent kuzeyi): bordür boyunca kiremit-kahve bant ~1.3 m (Street View zemin
      // kareleri), sonra duvara kadar gri + sarı kılavuz
      return {
        bands: [
          { v0: KERB_W, v1: 1.45, key: 'spPaverRed', h },
          { v0: 1.45, v1: W, key: 'spPaverGrey', h },
        ],
        tactile: [Math.max(1.85, (1.45 + W) / 2), 0.4],
      };
    case 'ne-island':
      return { bands: [{ v0: KERB_W, v1: W, key: 'spPaverGrey', h }], tactile: [(KERB_W + W) / 2, 0.4] };
    case 'west-east-side':
      // Cavit Orhan doğu: yol kotunda kiremit park cebi 1.5 m, iç bordür (0.12), gri 2.7 m, kılavuz duvardan ~1.95 m
      return {
        bands: [
          { v0: 0, v1: 1.5, key: 'spPaverRed', h: 0.03 },
          { v0: 1.62, v1: W, key: 'spPaverGrey', h: 0.12 },
        ],
        kerbs: [[1.5, 0.12]],
        tactile: [1.62 + (W - 1.62) / 2, 0.4],
      };
    case 'east-east-side':
      return {
        bands: [{ v0: KERB_W, v1: W, key: 'spPaverGrey', h }],
        tactile: W > 1.4 ? [(KERB_W + W) / 2, 0.4] : undefined,
      };
    case 'south-north-side':
      return { bands: [{ v0: 0, v1: W, key: 'spConcrete', h: Math.max(0.04, h) }] };
  }
  const t = (sw.material ?? '').toLowerCase();
  const key = 'spPaverGrey';
  return {
    bands: [{ v0: KERB_W, v1: W, key, h }],
    tactile: W > 1.4 ? [(KERB_W + W) / 2, 0.4] : undefined,
    bike: /bisiklet|bike/.test(t) ? 1.2 : undefined,
  };
}

type Collide = (ring: [number, number][], bottom: number, top: number) => void;
type Raised = { poly: [number, number][]; h: number };

/** Ölçüm serbest metnindeki "≈a–b" (ya da tek "≈a") değerinin ortası */
function rangeMid(t: string | undefined, re: RegExp): number | null {
  const m = re.exec(t ?? '');
  if (!m) return null;
  const a = Number(m[1].replace(',', '.'));
  const e = m[2] != null ? Number(m[2].replace(',', '.')) : a;
  return Number.isFinite(a) && Number.isFinite(e) ? (a + e) / 2 : null;
}

/** En yakın yol eksenine doğru birim yön (16 yön taraması); yol yoksa null */
function towardRoad(roadCentre: (x: number, z: number) => number, x: number, z: number): V2 | null {
  const d0 = roadCentre(x, z);
  let best = { d: d0, x: 0, z: 0 };
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const d = roadCentre(x + Math.cos(a) * 1.5, z + Math.sin(a) * 1.5);
    if (d < best.d) best = { d, x: Math.cos(a), z: Math.sin(a) };
  }
  return best.d < d0 ? [best.x, best.z] : null;
}

/** Bir çizgi boyunca ~1 m bordür taşları: a→e hattı, n: taşların hattan içeri kaydığı yön, üst kotu zeminden kh */
function kerbStones(b: Builder, a: V2, e: V2, n: V2, kh: number, H: (x: number, z: number) => number) {
  const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
  if (L < 0.05 || kh < 0.03) return;
  const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
  const nS = Math.max(1, Math.round(L));
  for (let k = 0; k < nS; k++) {
    const u = (L * (k + 0.5)) / nS;
    const c: V2 = [a[0] + t[0] * u + (n[0] * KERB_W) / 2, a[1] + t[1] * u + (n[1] * KERB_W) / 2];
    const y = H(c[0], c[1]);
    b.box(
      'curb',
      [c[0], y + kh / 2 - 0.05, c[1]],
      [L / nS - 0.006, kh + 0.1, KERB_W],
      Math.atan2(-t[1], t[0]),
    );
  }
}

interface RoundaboutSpec {
  x: number;
  z: number;
  /** Bordür dışı yarı eksenler (D-B, K-G) */
  rx?: number;
  rz?: number;
  h?: number;
  /** Serbest metin: "dış bordür (≈0.15) + ≈0.5–0.6 m kırmızı bant + iç alçak bordür (≈0.12) + çim; … kenar çizgisi" */
  kerb?: string;
  grass?: { rx?: number; rz?: number; material?: string };
  planting?: string;
}

/** Kavşak adasının çizim ölçüleri (üstündeki öğelerin kenara çekilmesi için saklanır) */
interface RoundaboutGeo {
  c: V2;
  RX: number;
  RZ: number;
  /** Dış bordür hattından içeri d metre, θ açısında nokta */
  outerAt: (d: number, th: number) => V2;
}

/**
 * Kavşak adası (ölçüm: da3-rb-island): dış gri bordür, kiremit bant, iç alçak bordür, çim, halka çiçeklik,
 * yol tarafında beyaz kenar çizgisi. Döner: yürüme kotları + geometri.
 */
function roundaboutIsland(
  b: Builder,
  s: RoundaboutSpec,
  H: (x: number, z: number) => number,
): { raised: Raised[]; geo: RoundaboutGeo } {
  const c: V2 = [s.x, s.z];
  const RX = s.rx ?? 10;
  const RZ = s.rz ?? RX;
  const GX = s.grass?.rx ?? RX - 1;
  const GZ = s.grass?.rz ?? RZ - 1;
  const h = s.h ?? 0.15;
  const parts = (s.kerb ?? '')
    .toLowerCase()
    .split('+')
    .map((p) => p.trim());
  // KARAR: "iç alçak gri bordür (≈0.12)" bant üstünden görünen yükseklik olarak okunur (dış bordür 0.15 yola göre;
  // iç bordür yola göre 0.12 olsa bandın altında kalırdı). Çim iç bordür üstüyle aynı kotta (ölçümde çim kotu yok).
  const innerPart = parts.find((p) => /(^|\s)iç\s.*bordür/.test(p));
  const innerH = innerPart ? (rangeMid(innerPart, /≈\s*([0-9.,]+)/) ?? 0) : 0;
  const bandPart = parts.find((p) => /bant|band/.test(p));
  const bandKey = bandPart ? layerKey(bandPart) : null;
  const linePart = parts.find((p) => /kenar çizgisi|edge line/.test(p));
  const lineGap = linePart
    ? rangeMid(linePart, /≈?\s*([0-9.,]+)\s*(?:[–-]\s*([0-9.,]+))?\s*m\s*mesafe/)
    : null;
  const N = 72;
  const outerAt = (d: number, th: number): V2 => [
    c[0] + Math.cos(th) * (RX - d),
    c[1] + Math.sin(th) * (RZ - d),
  ];
  const grassAt = (d: number, th: number): V2 => [
    c[0] + Math.cos(th) * (GX + d),
    c[1] + Math.sin(th) * (GZ + d),
  ];
  const th = (k: number) => (k / N) * Math.PI * 2;
  const ring = (f: (k: number) => V2): V2[] => Array.from({ length: N }, (_, k) => f(k));
  const inward = (p: V2, t: V2): V2 => {
    const n: V2 = [-t[1], t[0]];
    return (c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] >= 0 ? n : [-n[0], -n[1]];
  };
  // Bordür/bant/çizgi halkaları: 72 parça (≈1 m), her parça yerel çerçeveyle (kilit taşı halka boyunca döşenir)
  let sArc = 0;
  let sLine = 0;
  for (let k = 0; k < N; k++) {
    const a0 = th(k);
    const a1 = th(k + 1);
    // Dış bordür (yola bakan yüz dahil), üst kotu h
    const o0 = outerAt(0, a0);
    const o1 = outerAt(0, a1);
    const tO: V2 = [o1[0] - o0[0], o1[1] - o0[1]];
    const lO = Math.hypot(tO[0], tO[1]);
    kerbStones(b, o0, o1, inward(o0, [tO[0] / lO, tO[1] / lO]), h, H);
    // Kırmızı bant: dış bordürün içinden iç bordüre kadar
    const b0 = outerAt(KERB_W, a0);
    const b1 = outerAt(KERB_W, a1);
    const lB = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
    const tB: V2 = [(b1[0] - b0[0]) / lB, (b1[1] - b0[1]) / lB];
    if (bandKey)
      b.drape(bandKey, [b0, b1, grassAt(KERB_W, a1), grassAt(KERB_W, a0)], [], H, h, 1, 2, {
        o: [b0[0] - tB[0] * sArc, b0[1] - tB[1] * sArc],
        t: tB,
        n: inward(b0, tB),
      });
    sArc += lB;
    // İç alçak bordür (çim kenarı), üst kotu h + innerH
    const g0 = grassAt(KERB_W, a0);
    const g1 = grassAt(KERB_W, a1);
    const lG = Math.hypot(g1[0] - g0[0], g1[1] - g0[1]);
    if (innerPart)
      kerbStones(b, g0, g1, inward(g0, [(g1[0] - g0[0]) / lG, (g1[1] - g0[1]) / lG]), h + innerH, H);
    // Yol tarafında beyaz sürekli kenar çizgisi (bordürden lineGap, 12 cm — roads.ts kenar çizgisi genişliği)
    if (lineGap != null) {
      const l0 = outerAt(-lineGap, a0);
      const l1 = outerAt(-lineGap, a1);
      const lL = Math.hypot(l1[0] - l0[0], l1[1] - l0[1]);
      const tL: V2 = [(l1[0] - l0[0]) / lL, (l1[1] - l0[1]) / lL];
      b.drape(
        'spPaint',
        [l0, l1, outerAt(-lineGap - 0.12, a1), outerAt(-lineGap - 0.12, a0)],
        [],
        H,
        0.052,
        1,
        2,
        {
          o: [l0[0] - tL[0] * sLine, l0[1] - tL[1] * sLine],
          t: tL,
          n: inward(l0, tL),
        },
      );
      sLine += lL;
    }
  }
  // Çim
  const top = h + innerH;
  const gt = `${s.grass?.material ?? ''}`.toLowerCase();
  const grassKey = !gt || /çim|grass|lawn/.test(gt) ? 'lawn' : layerKey(gt);
  b.drape(
    grassKey,
    ring((k) => grassAt(0, th(k))),
    [],
    H,
    top,
    0.5,
    2.5,
  );
  // Halka çiçeklik: "kenardan ≈3–5 m içeride" (ada kenarından), çiçekli + yeşil alçak çalılar
  const pl = (s.planting ?? '').toLowerCase();
  const bed = /kenardan\s*≈?\s*([0-9.,]+)\s*[–-]\s*([0-9.,]+)\s*m/.exec(pl);
  if (/çiçeklik|flower/.test(pl) && bed) {
    // KARAR: ölçülen 3–5 m aralığı çiçekliğin kendisi (2 m bant) sayılır; toprak rengi site çiçeklikleriyle aynı
    const d0 = Number(bed[1].replace(',', '.'));
    const d1 = Number(bed[2].replace(',', '.'));
    b.drape(
      'spMulch',
      ring((k) => outerAt(d0, th(k))),
      [ring((k) => outerAt(d1, th(k))).reverse()],
      H,
      top + 0.012,
      1,
      2,
    );
    // KARAR: çalı boyu ölçülmedi ("alçak") → 0.5 m; iki şaşırtmalı sıra, 0.8 m ara; çiçekli/yeşil karışımı ve
    // çiçek renkleri (kırmızı / pembe: site güllerinin örneklenmiş tonları) tohumlu rastgele — dizilim görülmedi.
    const flowerKeys = [
      ...(/kırmızı|red/.test(pl) ? ['roseRed'] : []),
      ...(/pembe|pink/.test(pl) ? ['rosePink'] : []),
    ];
    const green = /yeşil/.test(pl);
    let seed = 90173;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const rows = [d0 + (d1 - d0) * 0.25, d0 + (d1 - d0) * 0.75];
    rows.forEach((d, ri) => {
      const per = ring((k) => outerAt(d, th(k))).reduce(
        (acc, p, i, r) => acc + Math.hypot(r[(i + 1) % N][0] - p[0], r[(i + 1) % N][1] - p[1]),
        0,
      );
      const n = Math.max(6, Math.round(per / 0.8));
      for (let i = 0; i < n; i++) {
        const p = outerAt(d, ((i + ri * 0.5) / n) * Math.PI * 2);
        const y = H(p[0], p[1]) + top;
        const bloom = flowerKeys.length > 0 && (!green || rnd() < 0.5);
        const g = new THREE.SphereGeometry(0.33, 10, 7);
        g.scale(1, 0.5 / 0.66, 1);
        g.translate(p[0], y + 0.22, p[1]);
        b.geometry('boxwood', g);
        if (!bloom) continue;
        const fk = flowerKeys[Math.floor(rnd() * flowerKeys.length) % flowerKeys.length];
        for (let f = 0; f < 6; f++) {
          const a = rnd() * Math.PI * 2;
          const fg = new THREE.SphereGeometry(0.05, 6, 4);
          fg.translate(p[0] + Math.cos(a) * 0.26, y + 0.28 + rnd() * 0.18, p[1] + Math.sin(a) * 0.26);
          b.geometry(fk, fg);
        }
      }
    });
  }
  return {
    raised: [
      // En üst kot önce (üstündeki öğeler en yüksek alanı bulsun)
      { poly: ring((k) => grassAt(KERB_W, th(k))), h: top },
      { poly: ring((k) => outerAt(0, th(k))), h },
    ],
    geo: { c, RX, RZ, outerAt },
  };
}

/** Ayrım adası (ölçüm: da3-island-*): çokgen, bordürlü, yüzey nottan (çim / beton) */
function splitterIsland(
  b: Builder,
  s: { poly?: V2[]; h?: number; material?: string; note?: string },
  H: (x: number, z: number) => number,
): Raised[] {
  const r = (s.poly ?? []).map((p) => [p[0], p[1]] as V2);
  if (r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  if (r.length < 3) return [];
  const h = s.h ?? 0.15;
  const n = r.length;
  // Kenar başına içe bakan normal
  const nor: V2[] = r.map((a, i) => {
    const e = r[(i + 1) % n];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    const m: V2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    const q: V2 = [-(e[1] - a[1]) / L, (e[0] - a[0]) / L];
    return inside(r, m[0] + q[0] * 0.05, m[1] + q[1] * 0.05) ? q : [-q[0], -q[1]];
  });
  for (let i = 0; i < n; i++) kerbStones(b, r[i], r[(i + 1) % n], nor[i], h, H);
  // Yüzey: bordür içinden (köşe kesişimli içe kaydırma)
  const inset: V2[] = r.map((p, i) => {
    const n1 = nor[(i + n - 1) % n];
    const n2 = nor[i];
    const k = KERB_W / Math.max(0.3, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
  const t = `${s.material ?? ''} ${s.note ?? ''}`.toLowerCase();
  // KARAR: yüzey belirtilmemişse beton (ada üstü sert zemin); ölçülenlerin hepsi "bordürlü çim"
  const key = /çim|grass/.test(t) ? 'lawn' : /beton|concrete/.test(t) ? 'spConcrete' : layerKey(t);
  b.drape(key, inset, [], H, h, key === 'lawn' ? 0.5 : 1, 2);
  return [{ poly: r, h }];
}

/** Trafik ışığı: boyalı direk + siyah 3'lü sinyal başı (kırmızı-sarı-yeşil, siperlikli); fn: baktığı yön */
function trafficSignal(
  b: Builder,
  x: number,
  y: number,
  z: number,
  h: number,
  fn: V2,
  poleK: string,
  pedSign: boolean,
): void {
  const yaw = Math.atan2(fn[0], fn[1]); // yerel +z → fn
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const L = (u: number, v: number, w: number): V3 => [x + u * co + w * si, y + v, z - u * si + w * co];
  // KARAR: sinyal başı ölçüsü görülmedi → yaygın 3 × Ø200 mm başlık (0.32 × 0.95 × 0.24); tepe = ölçülen h
  const HW = 0.32;
  const HH = 0.95;
  const HD = 0.24;
  const R = 0.06;
  const off = R + HD / 2;
  b.cylinder(poleK, [x, y - 0.1, z], R, (pedSign ? h + 0.68 : h - 0.05) + 0.1, 10);
  b.box('black', L(0, h - HH / 2, off), [HW, HH, HD], yaw);
  const lens = ['sigRed', 'sigAmber', 'sigGreen'];
  for (let k = 0; k < 3; k++) {
    const v = h - 0.17 - k * 0.3;
    const g = new THREE.CircleGeometry(0.1, 18);
    g.translate(0, v, off + HD / 2 + 0.004);
    g.rotateY(yaw);
    g.translate(x, y, z);
    b.geometry(lens[k], g);
    b.box('black', L(0, v + 0.115, off + HD / 2 + 0.08), [0.24, 0.015, 0.16], yaw);
  }
  // Üstte mavi yaya geçidi levhası (ölçüm notunda yazıyorsa)
  if (pedSign) {
    const a = L(-0.3, 0, R + 0.012);
    const e = L(0.3, 0, R + 0.012);
    const A: V2 = [a[0], a[2]];
    const E: V2 = [e[0], e[2]];
    b.wall('signPedestrian', A, E, y + h + 0.1, y + h + 0.7);
    const ab = L(-0.3, 0, R + 0.004);
    const eb = L(0.3, 0, R + 0.004);
    b.wall('signPedestrianBack', [eb[0], eb[2]], [ab[0], ab[2]], y + h + 0.1, y + h + 0.7);
  }
}

/** Reklam panosu sırası (ölçüm: da3-bb-*): pts hattı boyunca n pano, çerçeve + ayaklar, yüz yola dönük */
function billboardRow(
  b: Builder,
  s: {
    pts?: V2[];
    n?: number;
    w?: number;
    h?: number;
    y0?: number;
    frame?: string;
    legs?: number;
  },
  H: (x: number, z: number) => number,
  roadCentre: (x: number, z: number) => number,
  colorKey: ((kind: 'frame', hex: string) => string) | undefined,
  collide: Collide | undefined,
): void {
  const pts = s.pts ?? [];
  if (pts.length < 2) return;
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const Ltot = cum[cum.length - 1];
  const n = Math.max(1, Math.round(s.n ?? 1));
  const pitch = Ltot / n;
  // KARAR: n × w hat boyunu aşarsa (da3-bb-sw: 8 × 3.2 m > 18.9 m) genişlik sığacak kadar daraltılır — sayı ve hat
  // hava fotoğrafından, genişlik yalnız oransal tahmin
  const W = Math.min(s.w ?? 3.2, pitch - 0.2);
  const Hh = s.h ?? 2.2;
  const y0 = s.y0 ?? 1;
  const D = 0.12; // KARAR: çerçeve derinliği görülmedi
  const frameK = s.frame && colorKey ? colorKey('frame', s.frame) : 'pole';
  const nLegs = Math.max(1, Math.round(s.legs ?? 2));
  for (let k = 0; k < n; k++) {
    const u = pitch * (k + 0.5);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < u) i++;
    const a = pts[i - 1];
    const e = pts[i];
    const sl = cum[i] - cum[i - 1] || 1;
    const t: V2 = [(e[0] - a[0]) / sl, (e[1] - a[1]) / sl];
    const f = (u - cum[i - 1]) / sl;
    const c: V2 = [a[0] + (e[0] - a[0]) * f, a[1] + (e[1] - a[1]) * f];
    // Yüz: yola (en yakın yol eksenine) bakan yan
    let fn: V2 = [-t[1], t[0]];
    if (roadCentre(c[0] + fn[0] * 2, c[1] + fn[1] * 2) > roadCentre(c[0] - fn[0] * 2, c[1] - fn[1] * 2))
      fn = [-fn[0], -fn[1]];
    const tt: V2 = [fn[1], -fn[0]]; // wall(a→e) ön yüzü fn'e baksın
    const yaw = Math.atan2(fn[0], fn[1]);
    const gy = H(c[0], c[1]);
    b.box(frameK, [c[0], gy + y0 + Hh / 2, c[1]], [W, Hh, D], yaw);
    // Yüz: içerik değişken/ölçülmedi → nötr düz yüz (reklam içeriği uydurulmaz); çerçeve payı 6 cm
    const fw = W / 2 - 0.06;
    const fc: V2 = [c[0] + fn[0] * (D / 2 + 0.004), c[1] + fn[1] * (D / 2 + 0.004)];
    b.wall(
      'billboardFace',
      [fc[0] - tt[0] * fw, fc[1] - tt[1] * fw],
      [fc[0] + tt[0] * fw, fc[1] + tt[1] * fw],
      gy + y0 + 0.06,
      gy + y0 + Hh - 0.06,
    );
    // Ayaklar: panonun altında, çerçeve düzleminde; KARAR: ayak aralığı görülmedi → uçlardan W/5 içeride
    for (let j = 0; j < nLegs; j++) {
      const uu = nLegs === 1 ? 0 : -W * 0.3 + (W * 0.6 * j) / (nLegs - 1);
      const p: V2 = [c[0] + tt[0] * uu, c[1] + tt[1] * uu];
      const py = H(p[0], p[1]);
      const top = gy + y0 + 0.1;
      b.box(frameK, [p[0], (py - 0.1 + top) / 2, p[1]], [0.1, top - py + 0.1, 0.1], yaw);
    }
    const hw = W / 2;
    collide?.(
      [
        [c[0] - tt[0] * hw - fn[0] * 0.1, c[1] - tt[1] * hw - fn[1] * 0.1],
        [c[0] + tt[0] * hw - fn[0] * 0.1, c[1] + tt[1] * hw - fn[1] * 0.1],
        [c[0] + tt[0] * hw + fn[0] * 0.1, c[1] + tt[1] * hw + fn[1] * 0.1],
        [c[0] - tt[0] * hw + fn[0] * 0.1, c[1] - tt[1] * hw + fn[1] * 0.1],
      ],
      gy - 0.2,
      gy + y0 + Hh,
    );
  }
}

/**
 * Yeni trafik levhası dokuları (ölçüm notlarındaki tarifle): mecburi sağdan gidiniz (mavi daire, beyaz çapraz ok),
 * sarı-siyah ok (chevron), yaya geçidi (mavi kare, beyaz üçgen, siyah yaya). Renkler roadSignTexture paletinden.
 */
export function streetSignTexture(kind: 'keepRight' | 'chevron' | 'pedestrian'): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const Wc = kind === 'chevron' ? 384 : S;
  const cv = document.createElement('canvas');
  cv.width = Wc;
  cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, Wc, S);
  if (kind === 'keepRight') {
    g.fillStyle = '#f7f7f5';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1f5fc0';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2);
    g.fill();
    // Sol üstten sağ alta çapraz ok
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#f7f7f5';
    g.fillRect(-78, -15, 92, 30);
    g.beginPath();
    g.moveTo(8, -46);
    g.lineTo(76, 0);
    g.lineTo(8, 46);
    g.closePath();
    g.fill();
    g.restore();
  } else if (kind === 'chevron') {
    // KARAR: ok yönü ölçülmedi → "sağdan gidiniz" ile aynı taraf (sağa); tek ok ("ok", tekil)
    g.fillStyle = '#f2c200';
    g.fillRect(0, 0, Wc, S);
    g.fillStyle = '#111111';
    g.beginPath();
    g.moveTo(Wc * 0.36, S * 0.1);
    g.lineTo(Wc * 0.78, S * 0.5);
    g.lineTo(Wc * 0.36, S * 0.9);
    g.lineTo(Wc * 0.22, S * 0.9);
    g.lineTo(Wc * 0.64, S * 0.5);
    g.lineTo(Wc * 0.22, S * 0.1);
    g.closePath();
    g.fill();
  } else {
    g.fillStyle = '#1f4ea8';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#f7f7f5';
    g.lineWidth = 8;
    g.strokeRect(14, 14, S - 28, S - 28);
    g.fillStyle = '#f7f7f5';
    g.beginPath();
    g.moveTo(S / 2, 34);
    g.lineTo(S - 30, S - 36);
    g.lineTo(30, S - 36);
    g.closePath();
    g.fill();
    // Zebra + yürüyen yaya
    g.fillStyle = '#111111';
    for (let k = 0; k < 5; k++) g.fillRect(62 + k * 28, S - 62, 16, 14);
    g.beginPath();
    g.arc(S / 2 + 4, 92, 12, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#111111';
    g.lineWidth = 11;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(S / 2 + 2, 110);
    g.lineTo(S / 2 - 4, 150);
    g.lineTo(S / 2 - 22, 182);
    g.moveTo(S / 2 - 4, 150);
    g.lineTo(S / 2 + 16, 184);
    g.moveTo(S / 2 + 2, 118);
    g.lineTo(S / 2 - 20, 140);
    g.moveTo(S / 2 + 2, 118);
    g.lineTo(S / 2 + 24, 136);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildStreetPlan(
  b: Builder,
  plan: StreetPlan,
  H: (x: number, z: number) => number,
  roadCentre: (x: number, z: number) => number,
  ext: {
    signFace?: (sg: {
      text: string;
      lines?: { text: string; fg?: string; size?: number; bold?: boolean }[] | null;
      bg: string | null;
      fg: string;
      border: string | null;
      font: string;
      bold: boolean;
      lit: boolean;
      style: string;
      w: number;
      h: number;
    }) => string;
    colorKey?: (
      kind: 'plaster' | 'fascia' | 'metal' | 'awning' | 'glass' | 'frame' | 'tint',
      hex: string,
    ) => string;
    /** Çarpışma halkası (x/z çokgen, alt–üst kot) */
    collide?: Collide;
  } = {},
): StreetResult {
  const raised: StreetResult['raised'] = [];
  const polys: V2[][] = [];
  for (const sw of plan.sidewalks ?? []) {
    const pts = sw.pts;
    if (!pts || pts.length < 2) continue;
    const kerbH = sw.kerbH ?? 0.15;
    const lay = layoutOf(sw);
    // Köşe noktalarında asfalt dolgu diski (parçaların dış köşede bıraktığı kama boşlukları; kaldırım üstte kalır)
    for (let i = 1; i + 1 < pts.length; i++) {
      const c = pts[i];
      const ring: V2[] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        ring.push([c[0] + Math.cos(a) * 3, c[1] + Math.sin(a) * 3]);
      }
      b.drape('roadFill', ring, [], H, 0.027, 1, 2);
    }
    let s0 = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const e = pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.05) continue;
      const sPrev = s0;
      s0 += L;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      // Kaldırım tarafı: ölçümdeki 'left'/'right'; yoksa yol ekseninden uzak olan yan
      let n: V2 = sideNormal(t, sw.side);
      if (sw.side !== 'left' && sw.side !== 'right') {
        const mx = (a[0] + e[0]) / 2;
        const mz = (a[1] + e[1]) / 2;
        if (roadCentre(mx + n[0] * 1.5, mz + n[1] * 1.5) < roadCentre(mx - n[0] * 1.5, mz - n[1] * 1.5))
          n = [-n[0], -n[1]];
      }
      const q = (u: number, v: number): V2 => [a[0] + t[0] * u + n[0] * v, a[1] + t[1] * u + n[1] * v];
      // Köşelerde komşu parçalarla birleşsin diye hafif uzat (iç tarafta daha çok: dış köşe açıklığı kapansın)
      const ext = 0.08;
      // Şerit yerel UV'si: u yol boyunca (parçalar arası sürekli: s0), v bandın iç kenarından
      const strip = (v0: number, v1: number, key: string, off: number) => {
        const ring: V2[] = [q(-ext, v0), q(L + ext, v0), q(L + ext, v1), q(-ext, v1)];
        const o0 = q(-sPrev, v0);
        b.drape(key, ring, [], H, off, 1, 2, { o: o0, t, n });
        return ring;
      };
      for (const bd of lay.bands) {
        strip(bd.v0, bd.v1, bd.key, bd.h);
        if (bd.h > 0.06) raised.push({ poly: [q(0, bd.v0), q(L, bd.v0), q(L, bd.v1), q(0, bd.v1)], h: bd.h });
      }
      const top = lay.bands.length ? lay.bands[lay.bands.length - 1].h : kerbH;
      if (lay.tactile && lay.tactile[0] > 0.3)
        strip(
          lay.tactile[0] - lay.tactile[1] / 2,
          lay.tactile[0] + lay.tactile[1] / 2,
          'tactile',
          top + 0.006,
        );
      // Bordür taşları (≈0.72 m birim, yola bakan yüz dahil): yol kenarında + ara bordürler
      const kerbLine = (v: number, kh: number) => {
        if (kh < 0.05) return;
        const nS = Math.max(1, Math.round(L / KERB_UNIT));
        for (let k = 0; k < nS; k++) {
          const u0 = (L * k) / nS;
          const u1 = (L * (k + 1)) / nS;
          const c = q((u0 + u1) / 2, v + KERB_W / 2);
          const y = H(c[0], c[1]);
          b.box(
            'curb',
            [c[0], y + kh / 2 - 0.05, c[1]],
            [u1 - u0 - 0.006, kh + 0.1, KERB_W],
            Math.atan2(-t[1], t[0]),
          );
        }
      };
      if (lay.bands[0]?.v0 >= KERB_W - 1e-6) kerbLine(0, kerbH);
      for (const [v, kh] of lay.kerbs ?? []) kerbLine(v, kh);
      // Beyaz boyalı bordür (ölçüm: kerbPaint "white" — 502. Sk. batı, bisiklet şeridi kenarı; kullanıcı fotoğrafı
      // 502sk-bati-bisiklet.jpg düzeltilmiş üst görünüşte üstün iç ~7 cm'i gri, dışı + yuvarlak kenar + yol yüzü beyaz;
      // Street View U-Oz8…_273_-5_40 yol yüzünü beyaz gösteriyor). Yol kotunda ayrı beyaz çizgi yok.
      const paintKerb = sw.kerbPaint === 'white' && kerbH >= 0.05 && lay.bands[0]?.v0 >= KERB_W - 1e-6;
      if (paintKerb) {
        const nS = Math.max(1, Math.round(L / KERB_UNIT));
        const outward = -t[1] * -n[0] + t[0] * -n[1] > 0;
        for (let k = 0; k < nS; k++) {
          const u0 = (L * k) / nS;
          const u1 = (L * (k + 1)) / nS;
          const c = q((u0 + u1) / 2, KERB_W / 2);
          const y = H(c[0], c[1]);
          const A = q(u0, -0.002);
          const E = q(u1, -0.002);
          b.wall('kerbPaint', outward ? A : E, outward ? E : A, y + 0.02, y + kerbH);
        }
        strip(0, PAINT_TOP, 'kerbPaint', kerbH + 0.003);
      }
      // Bisiklet şeridi (yol kotunda mavi boya) + dış kenarda beyaz kesikli çizgi
      // KARAR: bisiklet şeridi boyası çizilmez — iki eleştirmen turunda da gerçek karelerde mavi boya seçilemedi
      // KARAR: kullanıcı fotoğrafı (502. Sk.) mavi şeridi açıkça gösteriyor → varsayılan açık (?nobike kapatır).
      // Bordür dibinde ince beyaz çizgi + dış kenarda sürekli beyaz çizgi (12 cm).
      if (lay.bike && SHOW_BIKE) {
        strip(-lay.bike, 0, 'spBike', 0.075);
        strip(-lay.bike, -lay.bike + 0.12, 'spPaint', 0.08);
        if (!paintKerb) strip(-0.1, 0, 'spPaint', 0.08);
      }
      // Bordürle OSM asfaltı arası boşluk kalmasın: yol tarafına asfalt dolgu (OSM yolunun altında kalır)
      strip(-3, 0.02, 'roadFill', 0.028);
      const full: V2[] = [q(0, 0), q(L, 0), q(L, sw.w), q(0, sw.w)];
      polys.push(full);
    }
  }
  // Kavşak adası + ayrım adaları önce: üstlerindeki lamba/ışık/levhalar ada kotunda dursun
  const isl: Raised[] = [];
  const rbs: RoundaboutGeo[] = [];
  for (const s of plan.street ?? []) {
    if (s.kind === 'roundabout-island') {
      const r = roundaboutIsland(b, s as unknown as RoundaboutSpec, H);
      isl.push(...r.raised);
      rbs.push(r.geo);
    } else if (s.kind === 'island') isl.push(...splitterIsland(b, s as unknown as { poly?: V2[] }, H));
  }
  /** Noktadaki ada kotu (en yüksek), yoksa kaldırım kotu */
  const walkAt = (x: number, z: number) => {
    let best: Raised | undefined;
    for (const r of isl) if (inside(r.poly, x, z) && (!best || r.h > best.h)) best = r;
    return best ?? raised.find((r) => inside(r.poly, x, z));
  };
  // Sokak eşyası
  for (const s of plan.street ?? []) {
    const g0 = H(s.x, s.z);
    const onWalk = walkAt(s.x, s.z);
    const y = g0 + (onWalk?.h ?? 0.15);
    const note = `${s.text ?? ''} ${s.note ?? ''}`.toLowerCase();
    const yaw = ((s.rot ?? 0) * Math.PI) / 180;
    switch (s.kind) {
      case 'lamp-post': {
        const h = s.h ?? 8;
        // Galvaniz konik direk + tek kol; kol yola (en yakın yol eksenine) doğru
        b.cylinder('pole', [s.x, y - 0.1, s.z], 0.085, h, 10);
        b.cylinder('pole', [s.x, y - 0.1, s.z], 0.13, 0.5, 10);
        let dx = Math.sin(yaw);
        let dz = -Math.cos(yaw);
        if (s.rot == null) {
          const r = towardRoad(roadCentre, s.x, s.z);
          if (r) [dx, dz] = r;
        }
        const ay = Math.atan2(dx, dz);
        b.box('pole', [s.x + dx * 0.8, y + h - 0.2, s.z + dz * 0.8], [0.06, 0.06, 1.6], ay);
        b.box('lampHead', [s.x + dx * 1.6, y + h - 0.3, s.z + dz * 1.6], [0.3, 0.12, 0.65], ay);
        break;
      }
      case 'pole':
        b.cylinder(
          /beton|concrete/.test(note) ? 'concretePole' : 'pole',
          [s.x, y - 0.1, s.z],
          0.11,
          s.h ?? 7,
          10,
        );
        break;
      case 'sign': {
        const h = s.h ?? 2.6;
        // Levha türleri (yukarıdan aşağı); duvar/kapı levhaları (h < 1.5) direksiz
        const keys: string[] = [];
        if (/viraj|curve|tehlike/.test(note)) keys.push('signCurve');
        if (/\b30\b/.test(note)) keys.push('sign30');
        if (/bisiklet|bike|cycle/.test(note)) keys.push('signBike');
        if (/park/.test(note)) keys.push('signP');
        if (/girilmez|no entry/.test(note)) keys.push('signNoEntry');
        if (/sola dönülmez|no left/.test(note)) keys.push('signNoLeft');
        if (/\bdur\b|\bstop\b/.test(note)) keys.push('signStop');
        // Ayrım adası ucu: mavi yuvarlak "mecburi sağdan gidiniz" (üstte) + sarı-siyah ok (chevron) levhası
        // KARAR: üst/alt sırası ölçülmedi → Türkiye'de ada başında yaygın dizilim (mavi daire üstte)
        if (/sağdan gidiniz|keep right/.test(note)) keys.push('signKeepRight');
        if (/chevron|sarı-siyah ok/.test(note)) keys.push('signChevron');
        if (!keys.length) break; // yazılı tabelalar (site adı vb.) ayrıca
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const small = h < 1.5;
        const hw = small ? 0.16 : 0.33;
        if (!small) b.cylinder('pole', [s.x, y - 0.05, s.z], 0.035, h, 8);
        let top = small ? y + h + 0.2 : y + h - 0.04;
        for (const key of keys) {
          const A: V2 = [s.x - co * hw, s.z + si * hw];
          const E: V2 = [s.x + co * hw, s.z - si * hw];
          // KARAR: chevron levhası ölçülmedi → 3:2 dikdörtgen (0.66 × 0.44)
          const ph = small ? 0.42 : key === 'signChevron' ? 0.44 : 0.66;
          b.wall(key, A, E, top - ph, top);
          b.wall(`${key}Back`, E, A, top - ph, top);
          top -= ph + 0.04;
        }
        break;
      }
      case 'board': {
        // Tabela panosu: tek/çift direkli pano veya kapı kirişi üstü yazı (ölçüm: metin, renk, boyut, alt kot)
        const bo = s as unknown as {
          w?: number;
          h?: number;
          y0?: number;
          d?: number;
          text?: string;
          lines?: { text: string; fg?: string; size?: number; bold?: boolean }[];
          bg?: string;
          fg?: string;
          border?: string;
          font?: string;
          bold?: boolean;
          lit?: boolean;
          style?: string;
          poles?: number;
          poleC?: string;
        };
        const W = bo.w ?? 1;
        const Hh = bo.h ?? 0.6;
        const yb = g0 + (bo.y0 ?? 2);
        const d = bo.d ?? 0.08;
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        // rot: tabelanın baktığı pusula yönü; yüz normali (sin, −cos)
        const fn: V2 = [Math.sin(yaw), -Math.cos(yaw)];
        // wall(a→e) normali (−tz, tx): yüzün fn'e bakması için t = (fn.z, −fn.x) (önceden ters, yazı arkada kalıyordu)
        const ft: V2 = [fn[1], -fn[0]];
        const at = (u: number, off: number): V2 => [
          s.x + ft[0] * u + fn[0] * off,
          s.z + ft[1] * u + fn[1] * off,
        ];
        void co;
        void si;
        const poleK = bo.poleC && ext.colorKey ? ext.colorKey('metal', bo.poleC) : 'pole';
        const np = bo.poles ?? 1;
        const pu = np === 1 ? [0] : [-W / 2 + 0.08, W / 2 - 0.08];
        for (const u of pu) {
          const p = at(u, -d / 2 - 0.05);
          b.cylinder(poleK, [p[0], g0 - 0.05, p[1]], 0.05, yb - g0 + Hh + 0.05, 8);
        }
        const c = at(0, 0);
        const yawB = Math.atan2(-ft[1], ft[0]);
        const sideK = bo.bg && ext.colorKey ? ext.colorKey('fascia', bo.border ?? bo.bg) : 'pole';
        // Tek tek harf/rakam (ör. kolon üstündeki kapı numarası): kutu yok, yalnız yüz
        if (bo.style !== 'letters') b.box(sideK, [c[0], yb + Hh / 2, c[1]], [W, Hh, d], yawB);
        if (ext.signFace) {
          const key = ext.signFace({
            text: bo.text ?? '',
            lines: bo.lines ?? null,
            bg: bo.bg ?? null,
            fg: bo.fg ?? '#ffffff',
            border: bo.border ?? null,
            font: bo.font ?? 'sans',
            bold: bo.bold !== false,
            lit: !!bo.lit,
            style: bo.style ?? 'box',
            w: W,
            h: Hh,
          });
          b.wall(key, at(-W / 2, d / 2 + 0.006), at(W / 2, d / 2 + 0.006), yb, yb + Hh, [0, 0, 1, 1]);
        }
        break;
      }
      case 'barrier': {
        // Otopark bariyeri: turuncu mekanizma kutusu + kırmızı-beyaz kol (rot yönünde, ölçümde uzunluk notta)
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        b.box('barrierOrange', [s.x, y + 0.5, s.z], [0.32, 1.0, 0.32], -yaw);
        const L = Number(/(\d+(?:[.,]\d+)?)\s*m/.exec(note)?.[1]?.replace(',', '.') ?? 4) || 4;
        const nSeg = Math.max(2, Math.round(L / 0.5));
        for (let k = 0; k < nSeg; k++) {
          const u = 0.2 + (L * (k + 0.5)) / nSeg;
          b.box(
            k % 2 ? 'barrierWhite' : 'barrierRed',
            [s.x + si * u, y + 0.9, s.z - co * u],
            [0.06, 0.08, L / nSeg],
            -yaw,
          );
        }
        break;
      }
      case 'gatehouse': {
        // Güvenlik kulübesi (kahverengi çerçeve, pencere bandı) + üstte kanopi (w × d)
        const W = s.w ?? 6;
        const D = s.d ?? 1.2;
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const at = (u: number, v: number): V3 => [s.x + co * u + si * v, y, s.z - si * u + co * v];
        const bc = at(-W / 2 + 1.1, 0);
        b.box('boothFrame', [bc[0], y + 0.45, bc[2]], [2.0, 0.9, 1.8], yaw);
        b.box('mkCanopyGlass', [bc[0], y + 1.55, bc[2]], [1.96, 1.3, 1.76], yaw);
        b.box('boothFrame', [bc[0], y + 2.3, bc[2]], [2.1, 0.2, 1.9], yaw);
        const hh = s.h ?? 3.4;
        const cc = at(0, 0);
        b.box('boothFrame', [cc[0], y + hh, cc[2]], [W, 0.18, Math.max(D, 1.2)], yaw);
        for (const u of [-W / 2 + 0.2, W / 2 - 0.2]) {
          const p = at(u, 0);
          b.box('boothFrame', [p[0], y + hh / 2, p[2]], [0.12, hh, 0.12], yaw);
        }
        break;
      }
      case 'marking': {
        // Kaldırım bisiklet piktogramı (mavi zemin, beyaz bisiklet) — yere yatık
        const r = 0.55;
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const q = (u: number, v: number): V2 => [s.x + co * u + si * v, s.z - si * u + co * v];
        b.drape(
          'signBikeFlat',
          [q(-r, -r), q(r, -r), q(r, r), q(-r, r)],
          [],
          H,
          (onWalk?.h ?? 0.15) + 0.012,
          1,
          2,
          {
            o: q(-r, -r),
            t: [co / (2 * r), -si / (2 * r)],
            n: [si / (2 * r), co / (2 * r)],
          },
        );
        break;
      }
      case 'bin':
        // Belediye çöp kutusu: direk üstünde koyu yeşil kova
        b.cylinder('pole', [s.x, y - 0.05, s.z], 0.03, 1.0, 6);
        b.cylinder('binGreen', [s.x + 0.2, y + 0.45, s.z], 0.2, 0.55, 12);
        break;
      case 'bollard':
        // Turuncu esnek dikme (delinatör), beyaz yansıtıcı bantlı
        b.cylinder('bollardOrange', [s.x, g0, s.z], 0.04, s.h ?? 0.75, 8);
        b.cylinder('spPaint', [s.x, g0 + (s.h ?? 0.75) - 0.2, s.z], 0.042, 0.06, 8);
        break;
      case 'mirror': {
        // Trafik aynası: turuncu çerçeveli dışbükey daire
        const h = s.h ?? 2.8;
        b.cylinder('pole', [s.x, y - 0.05, s.z], 0.04, h, 8);
        const g = new THREE.SphereGeometry(0.4, 16, 8, 0, Math.PI * 2, 0, 0.5).rotateX(Math.PI / 2);
        g.rotateY(yaw);
        g.translate(s.x, y + h + 0.1, s.z);
        b.geometry('steel', g);
        const r = new THREE.TorusGeometry(0.2, 0.035, 6, 20).rotateY(yaw);
        r.translate(s.x, y + h + 0.1, s.z);
        b.geometry('bollardOrange', r);
        break;
      }
      case 'tree': {
        // Budanmış yuvarlak çalı (Street View: ~1.2 m şimşir topları); büyük ağaçlar (h ≥ 2) gerçek 3D ağaç olarak
        // vegetation'da (siteplan.surveyVegetation → fixedTrees, verilen konum/boy)
        if ((s.h ?? 5) >= 2) {
          // Genç fidanların iki ahşap kazığı (ölçüm notu "kazık"); KARAR: kazık boyu/aralığı ölçülmedi → 1.6 m, 0.6 m
          if (/kazı[kğ]/.test(note))
            for (const u of [-0.3, 0.3]) b.cylinder('wood', [s.x + u, g0 - 0.1, s.z], 0.03, 1.7, 6);
          break;
        }
        const h = s.h ?? 1.3;
        const g = new THREE.SphereGeometry(0.62, 14, 10);
        g.scale(1, (h * 0.9) / 1.24, 1);
        g.translate(s.x, g0 + 0.05 + h * 0.45, s.z);
        b.geometry('boxwood', g);
        break;
      }
      case 'drain': {
        // Yağmur ızgarası (bordür dibinde)
        const g = new THREE.PlaneGeometry(0.8, 0.4).rotateX(-Math.PI / 2).rotateY(yaw);
        g.translate(s.x, g0 + 0.035, s.z);
        b.geometry('darkMetal', g);
        break;
      }
      case 'bike-rack': {
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        for (let k = -2; k <= 2; k++) {
          const g = new THREE.TorusGeometry(0.38, 0.025, 6, 16, Math.PI).rotateY(yaw + Math.PI / 2);
          g.translate(s.x + co * k * 0.7, y, s.z - si * k * 0.7);
          b.geometry('steel', g);
        }
        break;
      }
      case 'hydrant':
        b.cylinder('hydrant', [s.x, y - 0.05, s.z], 0.1, 0.75, 10);
        break;
      case 'cabinet': {
        // Elektrik dağıtım panosu (not metnindeki ölçü: G×D×Y)
        const m = note.match(/([0-9.]+)\s*[×x]\s*([0-9.]+)\s*[×x]\s*([0-9.]+)/);
        const w = m ? Number(m[1]) : 0.9;
        const d = m ? Number(m[2]) : 0.4;
        const hh = m ? Number(m[3]) : (s.h ?? 1.3);
        b.box('cabinet', [s.x, y + hh / 2, s.z], [w, hh, d], yaw);
        b.box('cabinet', [s.x, y + hh + 0.02, s.z], [w + 0.06, 0.04, d + 0.06], yaw);
        break;
      }
      case 'scooter': {
        // Paylaşımlı e-scooter (turkuaz gövde)
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        b.box('scooter', [s.x, y + 0.1, s.z], [1.05, 0.06, 0.16], yaw);
        b.box('scooter', [s.x + co * 0.48, y + 0.6, s.z - si * 0.48], [0.05, 1.0, 0.05], yaw);
        b.box('darkMetal', [s.x + co * 0.48, y + 1.1, s.z - si * 0.48], [0.05, 0.04, 0.5], yaw);
        for (const u of [-0.45, 0.45])
          b.cylinder('darkMetal', [s.x + co * u, y + 0.1, s.z - si * u], 0.1, 0.05, 10);
        break;
      }
      case 'manhole': {
        const g = new THREE.CircleGeometry(0.33, 16).rotateX(-Math.PI / 2);
        g.translate(s.x, g0 + 0.045, s.z);
        b.geometry('darkMetal', g);
        break;
      }
      case 'tree-pit': {
        const r: V2[] = [
          [s.x - 0.6, s.z - 0.6],
          [s.x + 0.6, s.z - 0.6],
          [s.x + 0.6, s.z + 0.6],
          [s.x - 0.6, s.z + 0.6],
        ];
        b.drape('spMulch', r, [], H, (onWalk?.h ?? 0.15) + 0.008, 1, 2);
        break;
      }
      case 'bench': {
        // Ahşap çıtalı bank, siyah çelik ayak; rot: bakış yönü
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        for (let k = 0; k < 3; k++) {
          const o = -0.12 + k * 0.12;
          b.box('wood', [s.x + si * o, y + 0.44, s.z + co * o], [1.7, 0.035, 0.09], yaw);
        }
        for (let k = 0; k < 2; k++) {
          const o = 0.22;
          b.box('wood', [s.x + si * o, y + 0.62 + k * 0.14, s.z + co * o], [1.7, 0.09, 0.03], yaw);
        }
        for (const u of [-0.7, 0.7])
          b.box('darkMetal', [s.x + co * u, y + 0.3, s.z - si * u], [0.05, 0.6, 0.5], yaw);
        break;
      }
      case 'crossing': {
        // Yaya geçidi (zebra): rot = yayaların yürüdüğü pusula yönü, len = yürüme doğrultusunda boy (yoldan yola),
        // w = yol boyunca genişlik (şerit boyu). Beyaz şeritler yol boyunca uzanır, yürüme yönünde tekrarlanır.
        const cr = s as unknown as { len?: number; w?: number; stripes?: string };
        const len = cr.len ?? 4;
        const w = cr.w ?? 3;
        // Şerit/boşluk ölçümden ("≈0.5/0.5 m"); yoksa Türkiye standardı 0.5/0.5
        const m = /([0-9.,]+)\s*\/\s*([0-9.,]+)\s*m/.exec(cr.stripes ?? '');
        const sw = Number(m?.[1]?.replace(',', '.')) || 0.5;
        const gap = Number(m?.[2]?.replace(',', '.')) || 0.5;
        const d: V2 = [Math.sin(yaw), -Math.cos(yaw)];
        const t: V2 = [-d[1], d[0]];
        const n = Math.max(1, Math.floor((len + gap) / (sw + gap)));
        const span = n * sw + (n - 1) * gap;
        for (let k = 0; k < n; k++) {
          const o = -span / 2 + sw / 2 + k * (sw + gap);
          const c: V2 = [s.x + d[0] * o, s.z + d[1] * o];
          const P = (a: number, e: number): V2 => [c[0] + d[0] * a + t[0] * e, c[1] + d[1] * a + t[1] * e];
          // Yol boyasının üstünde (roads.ts çizgileri +0.05; spPaint polygonOffset −8)
          b.drape(
            'spPaint',
            [P(-sw / 2, -w / 2), P(sw / 2, -w / 2), P(sw / 2, w / 2), P(-sw / 2, w / 2)],
            [],
            H,
            0.052,
            1,
            2,
          );
        }
        break;
      }
      case 'traffic-signal': {
        // Trafik ışığı: boyalı çelik direk (ölçülen renk) + siyah 3'lü sinyal başı; tepe kotu h
        const ts = s as unknown as { pole?: string };
        const h = s.h ?? 4;
        let px = s.x;
        let pz = s.z;
        // Not "bordürün hemen içinde / ada kenarında" diyorsa ve konum (±1 m) bordürün üstüne/dışına düşüyorsa,
        // kavşak adasının kırmızı bandına çekilir (da3-rb-signal-SW: SV konumu adanın dışına düşüyor)
        if (/bordürün hemen içinde|ada kenarında/.test(note))
          for (const rb of rbs) {
            const ex = (px - rb.c[0]) / rb.RX;
            const ez = (pz - rb.c[1]) / rb.RZ;
            const rho = Math.hypot(ex, ez);
            if (rho > 1 - KERB_W / Math.min(rb.RX, rb.RZ) && rho < 1 + 2 / Math.min(rb.RX, rb.RZ)) {
              [px, pz] = rb.outerAt(KERB_W + 0.25, Math.atan2(ez, ex));
            }
          }
        const py = H(px, pz) + (walkAt(px, pz)?.h ?? 0.15);
        // Baktığı yön: rot (pusula); ölçümde "baktığı yön ölçülmedi" ise en yakın yol eksenine doğru
        // KARAR: yönü ölçülmemiş sinyal başları taşıt yoluna (en yakın yol eksenine) bakar — lamba kolu kuralıyla aynı
        let fn: V2 = [Math.sin(yaw), -Math.cos(yaw)];
        if (s.rot == null || /yön(ü)? ölçülmedi/.test(note)) {
          const r = towardRoad(roadCentre, px, pz);
          if (r) fn = r;
        }
        const poleK = ts.pole && ext.colorKey ? ext.colorKey('frame', ts.pole) : 'pole';
        trafficSignal(b, px, py, pz, h, fn, poleK, /yaya geçidi levha/.test(note));
        ext.collide?.(
          [
            [px - 0.1, pz - 0.1],
            [px + 0.1, pz - 0.1],
            [px + 0.1, pz + 0.1],
            [px - 0.1, pz + 0.1],
          ],
          py - 0.2,
          py + h,
        );
        break;
      }
      case 'billboard-row':
        billboardRow(
          b,
          s as unknown as Parameters<typeof billboardRow>[1],
          H,
          roadCentre,
          ext.colorKey,
          ext.collide,
        );
        break;
    }
  }
  raised.push(...isl);
  return { raised, covers: (x, z) => polys.some((p) => inside(p, x, z)) };
}
