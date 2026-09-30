import * as THREE from 'three';
import { Builder, leafFringe, type V2, type V3 } from './builder';
import { parseSpecies, speciesIndex } from '../osm/species';
import facadesRings from './data/facades.json';
import { binStand, goal, kamelya, lamp2, panelFence, pitchFence, playSet, roseBush } from './sitekit';

/**
 * Ölçülmüş site planı (data/site-plan.json: Google z21 hava fotoğrafından; data/street-plan.json: sokaklar):
 * zemin alanları (çim, kilit taşı, traverten güverte, havuz, kauçuk oyun alanı, saha, çiçeklik), çizgiler (çit,
 * alçak duvar, bordür, park çizgileri, tel çit), yapılar (pergola, çöp kulübesi, kulübe), noktalar (ağaç, çalı,
 * lamba, bank, şemsiye, kaydırak, fıskiye, araç).
 */
export interface SiteArea {
  kind: string;
  poly: V2[];
  material?: string;
  level?: number;
  note?: string;
  /** Yükseltilmiş alan kenarında korkuluk: 'glass' = buzlu cam panel + paslanmaz küpeşte (havuz platformu) */
  rail?: string;
  /** Korkuluk/çit açıklıkları (merkez, genişlik) — kapı */
  gates?: { c: V2; w: number }[];
  /** Saha çiti (halı saha): true → 4 m tel çit + kaleler */
  fence?: boolean;
  /** Kenar bordürü çizilmesin */
  noKerb?: boolean;
}
export interface SiteLine {
  kind: string;
  pts: V2[];
  h?: number;
  w?: number;
  note?: string;
}
export interface SiteStructure {
  kind: string;
  poly: V2[];
  h?: number;
  note?: string;
  /** kamelya: ön yüz yönü (derece, 0 = +x uzun kenar) */
  rot?: number;
}
export interface SitePoint {
  kind: string;
  x: number;
  z: number;
  r?: number;
  h?: number;
  rot?: number;
  species?: string;
  note?: string;
}
export interface SitePlan {
  areas?: SiteArea[];
  lines?: SiteLine[];
  structures?: SiteStructure[];
  points?: SitePoint[];
}
export interface StreetPlan {
  /**
   * Çitler: kind "mertkent" (Mertkent 2 çiti, fence2.ts), "other" (komşu site çiti, fenceGeneric.ts), "wall"
   * (serbest duvar — bir site çitine bağlı değil, ör. 504. Sk. kuzey duvarı; aynı alanlar, dolgu verilmezse yok).
   */
  fence?: unknown[];
  /**
   * Kapılar (site.ts PlanGate): kind pedestrian | vehicle, c merkez, n sokak yönü, w net açıklık, h kanat boyu.
   * `style` HER kapıda uygulanır: mertkent | drive | grey | wrought | bars | slats | leaf | panel (2D tel panel kanat)
   * | portal (iki kolon + üst kiriş + kiriş yüzünde harfler: `pillars` {w, d, color}, `beam` {top, h, d, color},
   * `text` {text, fg, font, size, d}, `leaf` wrought | drive | grey | none + `leafH`, `mirror` {side left|right
   * (sokaktan bakınca), h, r, rim}). color kanat rengi, leaves 1|2, pillars {w, h, color, lamp}. Verilmezse v5
   * kuralları (da*: notta ferforje → wrought, gri lamel → grey, yoksa drive; diğerleri ≥ 2 m yaya → mertkent).
   */
  gates?: { kind: string; c: V2; n: V2; w: number; note?: string }[];
  sidewalks?: {
    id?: string;
    pts: V2[];
    w: number;
    side: string;
    kerbH?: number;
    material?: string;
    note?: string;
    /** Bordürden içeri katmanlar: w genişlik, h yükseklik (yoksa kerbH), at: kılavuz şerit merkezi */
    layers?: { w?: number; material?: string; h?: number; at?: number }[];
    /** Bordüre bitişik mavi bisiklet şeridi genişliği (yol kotunda) */
    bike?: number;
    /** Bordür boyası (ör. "white": yol yüzü + üstün dış yarısı beyaz boyalı — bisiklet şeridi kenarı) */
    kerbPaint?: string;
    /** Kılavuz karo tonu: sRGB oran çarpanı [r, g, b] (street.ts tactileKey) */
    tactileTint?: number[];
  }[];
  /**
   * Sokak eşyası ve yol yüzeyi ayrıntısı (street.ts). v6 yol yüzeyi (YALNIZ Street View'da görülen yerlerde):
   * patch (asfalt yaması: poly + ton color; over: true → yol çizgilerinin üstünde), crack (çatlak / dolgu: pts +
   * genişlik w m; sealed: true → parlak zift), pothole (çukur: r m ya da poly; color iç, rim kenar tonu), wear
   * (çizgi aşınması: poly ya da pts + w; amount 0..1 — çizginin o kadarı eksik), delineator (esnek dikme: tek
   * x/z ya da pts + every dizisi, h, color, bands); crossing.wear (yaya geçidi boyası aşınması 0..1). x, z her
   * kayıtta zorunlu (çok noktalı kayıtlarda ilk nokta / merkez).
   */
  street?: {
    kind: string;
    x: number;
    z: number;
    h?: number;
    w?: number;
    d?: number;
    text?: string;
    rot?: number;
    note?: string;
  }[];
  /**
   * v7: OSM yol çizgisi düzeltmeleri (yalnız Street View'da görülen): id OSM yol kimliği ("w303589053" ya da sayı),
   * centre none | dashed | solid (orta çizgi), edges none | solid (kenar çizgileri). Ör. z≈−53 yan sokakta
   * (303589053) OSM üreticisi kesikli orta çizgi çiziyordu — SV'de 2014/2019/2025 orta çizgi YOK → centre "none".
   */
  roads?: {
    id: string | number;
    centre?: 'none' | 'dashed' | 'solid';
    edges?: 'none' | 'solid';
    /**
     * Orta çizginin OSM eksenine göre dünya kayması [dx, dz] (m): ölçülen gerçek çizgi OSM ekseninden farklıysa
     * (ör. 502. Sk. z −100'de OSM x≈6.4, gerçek x≈5.2–5.8 → [-0.9, 0]). Kenar çizgileri etkilenmez.
     */
    centreShift?: [number, number];
    note?: string;
  }[];
}
/*
 * v7 sokak öğesi türleri (street[], streetFurniture.ts) — ortak alanlar kind, id, x, z, rot (pusula derecesi: bakış
 * yönü), h, w, d, color, note; `base` (arazinin üstünde m) verilirse ölçülmüş kaldırım bandı kotu yerine taban o
 * kotta (bordürsüz sokak / yükseltilmiş teras). Renk verilmezse nötr gri — görülen renk yazılmalı:
 * - table: shape round | square, w çap/kenar (0.7), h (0.75), color tabla, chairs sandalye sayısı (masa çevresinde,
 *   ilki rot yönünde), chairC, chairR (merkezden uzaklık)
 * - chair: color, rot (oturanın baktığı yön)
 * - parasol: w (kare kenar / çap, 2.5), h (tepe, 2.4), shape square | round, open (false → kapalı), color kumaş,
 *   valance {text, fg, bg, sides [0..3]} (kare şemsiye valans yazısı, markayı OKUNDUĞU gibi)
 * - heater: h (2.2), color (mantar ısıtıcı)
 * - planter: shape box | round, w, d, h, color, plant {h, color, shape shrub | cone | hedge}
 * - aframe: w (0.6), h (1.0), color çerçeve, text / lines / bg / fg (iki yüz)
 * - totem: w, h, d, color gövde, text / lines / bg / fg (tek pano, y0..y1) ya da panels [{y0, y1, text, bg, fg}]
 *   kiracı levhaları, faces 1 | 2, lit
 * - menu-stand: h (1.25), w (tablet eni 0.4), color
 * - windscreen: pts (dünya hattı), h (1.5), glass, frame, every (dikme aralığı 1.2), base {h, color} dolu alt bant
 * - enclosure (kış bahçesi kapatması): poly (dünya), h (poly kenar 0 tarafı), h2 (karşı taraf; eğik çatı), glass,
 *   frame, mullion (1.0), doors [{edge, u0, u1}], solid [kenar] (dolu kenarlar, wallC), plinth {h, color}, roofC
 * - pergola: poly, h (üst), h2 (eğim: slopeEdge karşısı), color, cover, slat, slatEdge, postEdges / posts, beams
 *   {edge, over, capC}, every, post, beam (facade pergola ile aynı)
 * - speed-bump: pts (yolu enine), w (yol boyunca derinlik 0.5), h (0.05), color, module (modül boyu → 1 cm derz),
 *   ends {color, len (0.4), at start | end | both}
 * - bike-rack: n (5), every (0.7), color (ters U demirler)
 */

const PLANS = import.meta.glob('./data/{site,street,park}-plan.json', {
  eager: true,
  import: 'default',
}) as Record<string, SitePlan & StreetPlan>;
export const SITE_PLAN: SitePlan = PLANS['./data/site-plan.json'] ?? {};
export const STREET_PLAN: StreetPlan = PLANS['./data/street-plan.json'] ?? {};
/** Komşu parklar (kuzey park, Nato Parkı): site planıyla aynı şema */
export const PARK_PLAN: SitePlan = PLANS['./data/park-plan.json'] ?? {};
/** Ölçülmüş binaların taban izleri (yalnız ring alanı kullanılır) */
const FACADES_RINGS = facadesRings as unknown as Record<string, { ring: V2[] }>;

/**
 * Ölçüm noktasının türü → ağaç kütüphanesi tür indeksi (src/worlds/osm/species.ts). `species` alanı ve not
 * metni Türkçe / İngilizce / Latince ad ya da doğrudan tür anahtarı olabilir; daha belirli olan kazanır.
 * Anket ajanları için sözlük (anahtar — tanınan adlar; ayrıntı, tanıma ipuçları ve kanıt kareleri docs/TREES.md):
 *   cedrus (sedir, Himalaya sediri, Cedrus deodara) · picea-pungens (mavi ladin) · goldcrest (limoni servi,
 *   Cupressus macrocarpa, tek leylandi) · cupressus (servi/selvi, Akdeniz servisi, sütun) · thuja (mazı, tuja,
 *   Platycladus, küçük konik ardıç) · trachycarpus (palmiye, yelpaze palmiyesi) · tilia (ıhlamur) · ulmus
 *   (karaağaç, çitlembik, geniş kubbe) · robinia (akasya, yalancı akasya) · robinia-globe (top akasya) ·
 *   koelreuteria (sabun ağacı) · prunus-purple (kan erik, mor yapraklı) · eriobotrya (yenidünya) · fruit (meyve
 *   ağacı, tür belirsiz) · glossy (alev ağacı/Photinia, kurtbağrı/Ligustrum, taflan) · sapling (fidan, kazıklı
 *   genç ağaç) · boxwood (şimşir topu) · conifer (çam / iğne yapraklı, tür belirsiz) · deciduous-oval (kavak,
 *   huş) · deciduous (yaprak döken, tür belirsiz). Görülmeyen tür yazılmaz → genel anahtar.
 */
export function speciesType(s?: string, note?: string): number {
  return speciesIndex(parseSpecies(s, note));
}

/**
 * Ağaç kütüphanesinin çizdiği site noktaları: ağaçlar, konik servi sıraları ('cone' = limoni servi, kullanıcı
 * fotoğrafları), iğne yapraklı çalılar (mazı sırası) ve çalı diye ölçülmüş genç ağaçlar ("ince gövdeli genç
 * ağaç"). Diğer çalılar ve güller site planında kalır.
 */
function treeLibPoint(p: SitePoint): boolean {
  if (p.kind === 'tree' || p.kind === 'cone') return true;
  if (p.kind !== 'shrub') return false;
  const k = parseSpecies(p.species, p.note);
  return k === 'thuja' || k === 'goldcrest' || k === 'cupressus' || k === 'boxwood' || k === 'sapling';
}

function flat(r: V2[]): number[] {
  const o: number[] = [];
  for (const p of r) o.push(p[0], p[1]);
  return o;
}

/**
 * Ağaç sistemi için: ölçülmüş ağaçlar [x, z, tür, boy m, taç yarıçapı m]* (0 = ölçülmedi; vegetation.ts
 * FIXED_STRIDE) + otomatik ağaç konmayacak bölgeler.
 */
export function surveyVegetation(): {
  fixedTrees: number[];
  excludeZones: number[][];
  noSidewalkZones: number[][];
  /** v7: OSM yol çizgisi düzeltmeleri (id → orta / kenar çizgisi) */
  roadMarks: Record<string, RoadMark>;
  noPropZones: { p: number[]; r: number; closed?: boolean }[];
  /** Yalnız araç yolu kenarındaki genel OSM kaldırımının çizilmeyeceği alanlar (park döşemesi) */
  noCurbZones: number[][];
} {
  const fixedTrees: number[] = [];
  const add = (x: number, z: number, r: number | undefined, h: number | undefined, type: number) =>
    fixedTrees.push(x, z, type, h ?? 0, r ?? 0);
  for (const p of [...(SITE_PLAN.points ?? []), ...(PARK_PLAN.points ?? [])]) {
    if (!treeLibPoint(p)) continue;
    // Konik servi noktaları (tür alanı yok): kullanıcı fotoğraflarındaki limoni servi sıraları
    const sp = p.kind === 'cone' ? (p.species ?? 'goldcrest') : p.species;
    add(p.x, p.z, p.r, p.h ?? (p.kind === 'cone' ? 2.4 : undefined), speciesType(sp, p.note));
  }
  // Sokak ağaçları (2 m altındakiler dahil: köşe adasının mazı konileri de ağaç kütüphanesinde)
  for (const p of STREET_PLAN.street ?? [])
    if (p.kind === 'tree') {
      const q = p as { species?: string; r?: number };
      add(p.x, p.z, q.r, p.h, speciesType(q.species, `${p.text ?? ''} ${p.note ?? ''}`));
    }
  const excludeZones: number[][] = [];
  for (const a of [...(SITE_PLAN.areas ?? []), ...(PARK_PLAN.areas ?? [])])
    if (a.poly?.length >= 3) excludeZones.push(flat(a.poly));
  // Ölçülmüş kavşak adası / ayrım adaları: yalnız ölçülen ağaç (hava fotoğrafı tespiti çiçeklik ve lamba
  // gölgelerinden kavşak adasına 6 sahte taç koyuyordu; ölçümde adada tek ağaç var)
  for (const p of STREET_PLAN.street ?? []) {
    const q = p as unknown as { rx?: number; rz?: number; poly?: V2[] };
    if (p.kind === 'roundabout-island' && q.rx) {
      const ring: V2[] = [];
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        ring.push([p.x + Math.cos(a) * (q.rx + 0.5), p.z + Math.sin(a) * ((q.rz ?? q.rx) + 0.5)]);
      }
      excludeZones.push(flat(ring));
    } else if (p.kind === 'island' && q.poly && q.poly.length >= 3) excludeZones.push(flat(q.poly));
  }
  // KD köşe adası (budanmış şimşir topları; Street View'da ağaç yok)
  excludeZones.push(
    flat([
      [-16, -150],
      [6, -150],
      [6, -128],
      [-16, -128],
    ]),
  );
  // Sokak kaldırımları: yol tarafında w + 1.5 m, kaldırım (duvar) tarafında yalnız w + 0.3 m.
  // KARAR (critic A6): önceden iki yana da w + 1.5 idi → duvarın ~1.5 m arkasındaki gerçek ağaçlar (DA güneyi
  // şemsiye çamları, süs erikleri; ör. (159.6,−153.9)) siliniyordu. Duvar arkası site bahçesi, ağaç oradan gelir.
  for (const s of STREET_PLAN.sidewalks ?? []) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const a = s.pts[i];
      const e = s.pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.1) continue;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      const n = sideNormal(t, s.side);
      const Wroad = s.w + 1.5;
      const Wback = s.w + 0.3;
      const A: V2 = [a[0] - t[0] * 1.5, a[1] - t[1] * 1.5];
      const E: V2 = [e[0] + t[0] * 1.5, e[1] + t[1] * 1.5];
      excludeZones.push(
        flat([
          [A[0] - n[0] * Wroad, A[1] - n[1] * Wroad],
          [E[0] - n[0] * Wroad, E[1] - n[1] * Wroad],
          [E[0] + n[0] * Wback, E[1] + n[1] * Wback],
          [A[0] + n[0] * Wback, A[1] + n[1] * Wback],
        ]),
      );
    }
  }
  // Hava fotoğrafı taç tespitinin yanlış pozitifleri (critic A5): plan dosyalarındaki `treeExclude` —
  // { poly: [[x,z],…] } çokgen ya da { x, z, r } daire. Ölçülmüş (fixedTrees) ağaçlar bundan etkilenmez.
  for (const plan of [SITE_PLAN, STREET_PLAN, PARK_PLAN] as { treeExclude?: TreeExclude[] }[])
    for (const q of plan.treeExclude ?? []) {
      if (q.poly && q.poly.length >= 3) excludeZones.push(flat(q.poly));
      else if (typeof q.x === 'number' && typeof q.z === 'number') {
        const r = q.r ?? 2;
        const ring: V2[] = [];
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          ring.push([q.x + Math.cos(a) * r, q.z + Math.sin(a) * r]);
        }
        excludeZones.push(flat(ring));
      }
    }
  // OSM kaldırım üretiminin kapatılacağı bantlar: ölçülmüş bordürün yol tarafına ROAD_SIDE, kaldırım tarafına w + 4 m.
  // KARAR: yol tarafı 1.5 → 4.5 m — OSM ekseni gerçek yoldan kaymışsa OSM'nin kendi kaldırımı asfaltın ortasına
  // düşüyordu (502/Doğan Avcıoğlu kavşağı). 4.5 m < en dar araç yolu (6.5 m) → karşı kaldırıma taşmaz.
  const ROAD_SIDE = 4.5;
  const noSidewalkZones: number[][] = [];
  // Doğan Avcıoğlu – 502. Sokak kavşak ortası (iki yanı ölçülü; burada OSM kaldırımı olamaz)
  noSidewalkZones.push(
    flat([
      [1, -158],
      [10, -158],
      [10, -143],
      [1, -143],
    ]),
  );
  // Ölçülmüş park döşemesi (park-plan paving): OSM genel kaldırımı üstüne çizilmez (critic M2 #10: Cavit Orhan
  // boyunca kuzey park batı kenarı — gerçek düzen bordür → kırmızı → gri; üstüne gri + sarı kılavuzlu OSM kaldırımı
  // biniyordu)
  const noCurbZones: number[][] = [];
  for (const a of PARK_PLAN.areas ?? [])
    if (a.kind === 'paving' && a.poly?.length >= 3) noCurbZones.push(flat(a.poly));
  for (const s of STREET_PLAN.sidewalks ?? []) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const a = s.pts[i];
      const e = s.pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.1) continue;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      const n = sideNormal(t, s.side);
      const A: V2 = [a[0] - t[0] * 2, a[1] - t[1] * 2];
      const E: V2 = [e[0] + t[0] * 2, e[1] + t[1] * 2];
      const W = s.w + 4;
      noSidewalkZones.push(
        flat([
          [A[0] - n[0] * ROAD_SIDE, A[1] - n[1] * ROAD_SIDE],
          [E[0] - n[0] * ROAD_SIDE, E[1] - n[1] * ROAD_SIDE],
          [E[0] + n[0] * W, E[1] + n[1] * W],
          [A[0] + n[0] * W, A[1] + n[1] * W],
        ]),
      );
    }
  }
  const roadMarks: Record<string, RoadMark> = {};
  for (const r of STREET_PLAN.roads ?? []) {
    const id = typeof r.id === 'number' ? `w${r.id}` : /^\d+$/.test(r.id) ? `w${r.id}` : r.id;
    roadMarks[id] = {
      ...(r.centre ? { centre: r.centre } : {}),
      ...(r.edges ? { edges: r.edges } : {}),
      ...(r.centreShift && r.centreShift.length === 2 && r.centreShift.every(Number.isFinite)
        ? { shift: [r.centreShift[0], r.centreShift[1]] as [number, number] }
        : {}),
    };
  }
  return {
    fixedTrees,
    excludeZones,
    noSidewalkZones,
    noCurbZones,
    roadMarks,
    noPropZones: surveyedPropZones(),
  };
}

/** OSM yol çizgisi düzeltmesi (roads.ts): orta / kenar çizgisi türü, orta çizgi dünya kayması */
export interface RoadMark {
  centre?: string;
  edges?: string;
  shift?: [number, number];
}

/** Ölçülmüş çit hatları (tampon 2.5 m) ve kaldırım bordür hatları (tampon w + 2 m) — eski çit kabuğu atlama testi */
export function planLines(plan: StreetPlan): { pts: V2[]; r: number }[] {
  const out: { pts: V2[]; r: number }[] = [];
  for (const f of (plan.fence ?? []) as { pts?: V2[] }[])
    if (f.pts && f.pts.length >= 2) out.push({ pts: f.pts, r: 2.5 });
  for (const sw of plan.sidewalks ?? []) if (sw.pts.length >= 2) out.push({ pts: sw.pts, r: sw.w + 2 });
  return out;
}

export function nearPlanLine(lines: { pts: V2[]; r: number }[], x: number, z: number): boolean {
  for (const l of lines)
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const a = l.pts[i];
      const e = l.pts[i + 1];
      if (
        Math.abs(x - a[0]) > l.r + Math.abs(e[0] - a[0]) ||
        Math.abs(z - a[1]) > l.r + Math.abs(e[1] - a[1])
      )
        continue;
      const dx = e[0] - a[0];
      const dz = e[1] - a[1];
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) <= l.r) return true;
    }
  return false;
}

/** `treeExclude` öğesi (site/street/park-plan.json): çokgen ya da daire */
export interface TreeExclude {
  poly?: V2[];
  x?: number;
  z?: number;
  r?: number;
  note?: string;
}

/**
 * Yordamsal lamba / park etmiş araç üretilmeyecek ölçülmüş bölge (props.ts PropZone): street-plan kaldırımlarının
 * bordür hattı (yol tarafı dahil w + 7 m), çitleri (6 m), ölçülmüş binalar (taban izi + 14 m: arka sokaklar, ör.
 * 794'ün kuzey sokağı) ve Mertkent el modeli kutusu. KARAR: ölçülmüş bölgede sokak eşyası ve araçlar yalnız ölçümden.
 */
export function surveyedPropZones(): { p: number[]; r: number; closed?: boolean }[] {
  const z: { p: number[]; r: number; closed?: boolean }[] = [];
  // El modeli bölgesi (Mertkent 2 + Özhan + Salus + Cavit Orhan; eski sabit kutu)
  z.push({
    p: flat([
      [-142, -222],
      [28, -222],
      [28, 4],
      [-142, 4],
    ]),
    r: 0,
    closed: true,
  });
  for (const s of STREET_PLAN.sidewalks ?? []) if (s.pts.length >= 2) z.push({ p: flat(s.pts), r: s.w + 7 });
  for (const f of (STREET_PLAN.fence ?? []) as { pts?: V2[] }[])
    if (f.pts && f.pts.length >= 2) z.push({ p: flat(f.pts), r: 6 });
  for (const v of Object.values(FACADES_RINGS))
    if (v.ring?.length >= 3) z.push({ p: flat(v.ring), r: 14, closed: true });
  return z;
}

/**
 * Kaldırımın bordür hattına göre yönü: polyline yönünde 'left' / 'right' (+x doğu, +z güney: doğuya giderken sol =
 * kuzey). Bilinmiyorsa null.
 */
export function sideNormal(t: V2, side?: string): V2 {
  if (side === 'left') return [t[1], -t[0]];
  return [-t[1], t[0]];
}

function insidePoly(r: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function centroid(r: V2[]): V2 {
  let x = 0;
  let z = 0;
  for (const p of r) {
    x += p[0];
    z += p[1];
  }
  return [x / r.length, z / r.length];
}

function openRing(r: V2[]): V2[] {
  const o = r.map((p) => [p[0], p[1]] as V2);
  if (o.length > 3) {
    const f = o[0];
    const l = o[o.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) o.pop();
  }
  return o;
}

function areaKey(a: SiteArea): string {
  const m = `${a.material ?? ''} ${a.note ?? ''}`.toLowerCase();
  switch (a.kind) {
    case 'lawn':
      return 'lawn';
    case 'deck':
      return /mermer|marble|kenar taşı|coping/.test(m) ? 'coping' : 'deck';
    case 'playground':
      // Kullanıcı fotoğrafı: koyu mor-kahve 50 cm kauçuk karo
      if (/karo|tile/.test(m)) return 'rubberTile';
      if (/mor|purple/.test(m)) return 'spRubberPurple';
      if (/gri|grey|gray/.test(m)) return 'spRubberGrey';
      return 'spRubberRed';
    case 'court':
      // Yalnızca zemin malzemesi metni (notlarda çevre çitinin rengi geçebiliyor)
      return /yeşil|green/.test((a.material ?? '').toLowerCase()) ? 'spCourtGreen' : 'spCourtBeige';
    case 'bed':
      return 'spMulch';
    case 'gravel':
      return 'spGravel';
    case 'asphalt':
      return 'drive';
    default:
      if (/asfalt|asphalt/.test(m)) return 'drive';
      if (/metal|ızgara|kapak|grate/.test(m)) return 'darkMetal';
      if (/traverten|travertine|mermer/.test(m)) return 'deck';
      if (/kırmızı|red|kahve/.test(m) && !/gri/.test(m.split('(')[0])) return 'spSiteRed';
      return 'spSiteGrey';
  }
}

export interface SitePlanResult {
  /** Arazi gölgelendiricisi delikleri (havuzlar) [x0, z0, x1, z1] */
  holes: [number, number, number, number][];
  /** Park etmiş araçlar [x, y, z, yaw, tohum]* */
  cars: number[];
}

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

/** Site planını çiz. `skip(x,z)`: bu noktadaki öğeleri atla (ör. başka modülün çizdiği yapılar) */
export function buildSitePlan(
  b: Builder,
  plan: SitePlan,
  H: (x: number, z: number) => number,
  collide?: Collide,
): SitePlanResult {
  const holes: [number, number, number, number][] = [];
  const cars: number[] = [];
  const areas = (plan.areas ?? [])
    .map((a) => ({ ...a, poly: openRing(a.poly) }))
    .filter((a) => a.poly.length >= 3);
  const pools = areas.filter((a) => a.kind === 'pool');
  // ── Zemin alanları (sırayla, üst üste: küçük y artışı + malzeme polygonOffset) ──
  areas.forEach((a, idx) => {
    if (a.kind === 'pool') return;
    const key = areaKey(a);
    const inner = pools.filter((p) => insidePoly(a.poly, ...centroid(p.poly))).map((p) => p.poly);
    const off = 0.03 + Math.min(0.06, idx * 0.0015) + (a.level ?? 0) + (a.kind === 'lawn' ? 0 : 0.03);
    try {
      b.drape(
        key,
        a.poly,
        inner,
        H,
        off,
        key.startsWith('spPaver') || key.startsWith('spSite') || key === 'deck' ? 1 : 0.5,
        2.5,
      );
    } catch {
      /* hatalı çokgen */
    }
    // Yükseltilmiş alanlar (güverte vb.): kenar yüzü (+ traverten denizlik), cam korkuluk
    if ((a.level ?? 0) > 0.05)
      for (let i = 0; i < a.poly.length; i++) {
        const p = a.poly[i];
        const q = a.poly[(i + 1) % a.poly.length];
        const y0 = Math.min(H(p[0], p[1]), H(q[0], q[1]));
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        b.wall('deckSide', q, p, y0 - 0.1, y0 + off, [0, 0, L / 0.6, (off + 0.1) / 0.3]);
        if (a.rail === 'glass') glassRail(b, p, q, y0 + off, a.gates ?? [], collide);
        else if ((a.level ?? 0) > 0.3) collide?.(edgeRing(p, q, 0.1), y0 - 0.5, y0 + off);
      }
    // Site içi yollar: gri beton bordür (çimle sınırda); fotoğraflarda her yol kenarında
    if (key.startsWith('spSite') && !a.noKerb) siteKerbs(b, a.poly, areas, H, off);
    // Halı saha çiti + kaleler
    if (a.kind === 'court' && a.fence) {
      pitchFence(b, a.poly, H, a.gates?.[0], collide);
      const xs = a.poly.map((p) => p[0]);
      const zs = a.poly.map((p) => p[1]);
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const x0 = Math.min(...xs) + 0.6;
      const x1 = Math.max(...xs) - 0.6;
      goal(b, [x0, H(x0, cz) + 0.03, cz], Math.PI / 2);
      goal(b, [x1, H(x1, cz) + 0.03, cz], -Math.PI / 2);
    }
    if (a.kind === 'playground' && a.fence) panelFence(b, [...a.poly, a.poly[0]], H, 1.0, collide);
  });
  // ── Havuzlar ──
  for (const pool of pools) {
    const r = pool.poly;
    const m = `${pool.material ?? ''} ${pool.note ?? ''}`.toLowerCase();
    const shallow = /çocuk|child|sığ|shallow|basamak|raf/.test(m);
    const depth = shallow ? 0.55 : 1.45;
    const cP = centroid(r);
    const deckAround = areas.find(
      (a) => a.kind !== 'pool' && (a.level ?? 0) > 0.2 && insidePoly(a.poly, cP[0], cP[1]),
    );
    const rim =
      Math.max(...r.map((p) => H(p[0], p[1]))) + (deckAround ? (deckAround.level ?? 0) + 0.06 : 0.1);
    const xs = r.map((p) => p[0]);
    const zs = r.map((p) => p[1]);
    holes.push([
      Math.min(...xs) + 0.02,
      Math.min(...zs) + 0.02,
      Math.max(...xs) - 0.02,
      Math.max(...zs) - 0.02,
    ]);
    const ccw = ((): V2[] => {
      let a2 = 0;
      for (let i = 0; i < r.length; i++) {
        const p = r[i];
        const q = r[(i + 1) % r.length];
        a2 += p[0] * q[1] - q[0] * p[1];
      }
      return a2 > 0 ? r : [...r].reverse();
    })();
    const tile = shallow ? 'poolTileLight' : 'poolTile';
    for (let i = 0; i < ccw.length; i++) {
      const p = ccw[i];
      const q = ccw[(i + 1) % ccw.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      // İç duvar (havuza bakan): a→e sırası ters
      b.wall(tile, p, q, rim - depth, rim - 0.04, [0, 0, L, depth]);
      b.wall('poolBand', p, q, rim - 0.25, rim - 0.04, [0, 0, L / 0.25, 1]);
    }
    b.polygon(tile, ccw, rim - depth, true, 1);
    b.polygon('water', ccw, rim - 0.16, true, 0.25);
    // Kenar taşı (0.35 m, beyaz)
    const c = centroid(ccw);
    for (let i = 0; i < ccw.length; i++) {
      const p = ccw[i];
      const q = ccw[(i + 1) % ccw.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const t: V2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
      let n: V2 = [-t[1], t[0]];
      const mid: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (n[0] * (mid[0] - c[0]) + n[1] * (mid[1] - c[1]) < 0) n = [-n[0], -n[1]];
      const cc: V2 = [mid[0] + n[0] * 0.17, mid[1] + n[1] * 0.17];
      b.box('coping', [cc[0], rim + 0.015, cc[1]], [L + 0.34, 0.05, 0.34], Math.atan2(-t[1], t[0]));
    }
  }
  // ── Çizgiler ──
  for (const l of plan.lines ?? []) {
    const pts = l.pts;
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 0.02) continue;
      const t: V2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
      const yaw = Math.atan2(-t[1], t[0]);
      const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const y = H(m[0], m[1]);
      switch (l.kind) {
        case 'hedge': {
          const h = l.h ?? 1.2;
          const w = l.w ?? 0.8;
          b.box('hedge', [m[0], y + h / 2, m[1]], [L + w * 0.3, h, w], yaw, 0.7, 0b111111 & ~0b100000);
          const n: V2 = [-t[1], t[0]];
          for (const s of [1, -1] as const)
            leafFringe(
              b,
              'hedgeLeaf',
              [p[0] + n[0] * (w / 2) * s, p[1] + n[1] * (w / 2) * s],
              [q[0] + n[0] * (w / 2) * s, q[1] + n[1] * (w / 2) * s],
              y + 0.15,
              y + h,
              w,
              [n[0] * s, n[1] * s],
              3,
              Math.floor(m[0] * 13 + m[1] * 7 + s * 101),
              0.35,
            );
          collide?.(rect(m, t, L, w), y - 0.5, y + h);
          break;
        }
        case 'low-wall': {
          const h = l.h ?? 0.5;
          const w = l.w ?? 0.2;
          b.box('mkWallBack', [m[0], y + h / 2 - 0.05, m[1]], [L + w, h + 0.1, w], yaw);
          b.box('coping', [m[0], y + h + 0.02, m[1]], [L + w + 0.04, 0.04, w + 0.06], yaw);
          if (h > 0.35) collide?.(rect(m, t, L, w), y - 0.5, y + h);
          break;
        }
        case 'railing': {
          const h = l.h ?? 1.2;
          b.wall('mkMesh', p, q, y, y + h, [0, 0, L / 0.2, h / 0.2]);
          const nP = Math.max(1, Math.round(L / 2.5));
          for (let k = 0; k <= nP; k++) {
            const f = k / nP;
            b.box(
              'mkMeshPost',
              [p[0] + (q[0] - p[0]) * f, y + h / 2, p[1] + (q[1] - p[1]) * f],
              [0.06, h, 0.04],
              yaw,
            );
          }
          collide?.(rect(m, t, L, 0.1), y - 0.5, y + h);
          break;
        }
        case 'parking-bay':
          // Site içi park çizgileri sarı (kullanıcı fotoğrafı)
          b.box(
            /beyaz|white/.test(l.note ?? '') ? 'spPaint' : 'spPaintYellow',
            [m[0], y + 0.075, m[1]],
            [L, 0.01, l.w ?? 0.1],
            yaw,
          );
          break;
        case 'panel-fence':
          if (i === 0) panelFence(b, pts, H, l.h ?? 1.0, collide);
          break;
        case 'kerb':
        case 'path-edge':
        case 'step': {
          const h = l.h ?? 0.12;
          const w = l.w ?? 0.12;
          b.box('edging', [m[0], y + h / 2, m[1]], [L + 0.02, h + 0.05, w], yaw);
          break;
        }
        case 'pool-lane': {
          const dk = areas.find(
            (a) => a.kind !== 'pool' && (a.level ?? 0) > 0.2 && insidePoly(a.poly, m[0], m[1]),
          );
          b.box(
            'poolBand',
            [m[0], dk ? y + (dk.level ?? 0) + 0.06 - 1.44 : y - 1.3, m[1]],
            [L, 0.01, l.w ?? 0.25],
            yaw,
          );
          break;
        }
      }
    }
  }
  // ── Yapılar ──
  for (const s of plan.structures ?? []) {
    const r = openRing(s.poly ?? []);
    if (r.length < 3) continue;
    const note = (s.note ?? '').toLowerCase();
    if (/salus\.ts|zaten modelle/.test(note)) continue;
    const y = Math.min(...r.map((p) => H(p[0], p[1])));
    const h = s.h ?? 2.5;
    switch (s.kind) {
      case 'kamelya': {
        const cc = centroid(r);
        const e0: V2 = [r[1][0] - r[0][0], r[1][1] - r[0][1]];
        const e1: V2 = [r[2][0] - r[1][0], r[2][1] - r[1][1]];
        const L0 = Math.hypot(...e0);
        const L1 = Math.hypot(...e1);
        const long = L0 >= L1 ? e0 : e1;
        const yawK = Math.atan2(-long[1], long[0]) + ((s.rot ?? 0) * Math.PI) / 180;
        kamelya(
          b,
          [cc[0], H(cc[0], cc[1]), cc[1]],
          Math.max(L0, L1) - 0.3,
          Math.min(L0, L1) - 0.3,
          yawK,
          collide,
        );
        break;
      }
      case 'pergola': {
        for (const p of r) b.box('darkMetal', [p[0], y + h / 2, p[1]], [0.12, h, 0.12]);
        b.polygon('canopy', r, y + h, true, 0.5);
        b.polygon('canopy', r, y + h - 0.02, false, 0.5);
        break;
      }
      case 'stair':
        break;
      default: {
        // Kutu + eğimli / beşik çatı
        const wallKey = /tuğla|brick/.test(note) ? 'brick' : /ahşap|wood/.test(note) ? 'wood' : 'mkWallBack';
        for (let i = 0; i < r.length; i++) {
          const p = r[i];
          const q = r[(i + 1) % r.length];
          b.wall(wallKey, p, q, y, y + h * 0.82, [0, 0, Math.hypot(q[0] - p[0], q[1] - p[1]), h]);
          b.wall(wallKey, q, p, y, y + h * 0.82, [0, 0, Math.hypot(q[0] - p[0], q[1] - p[1]), h]);
        }
        const roofKey = /kırmızı|red|kiremit/.test(note) ? 'roof' : 'ozRoof';
        b.polygon(roofKey, r, y + h * 0.82, true, 0.5);
        b.polygon(roofKey, r, y + h * 0.82 - 0.01, false, 0.5);
        collide?.(
          r.map((p) => [p[0], p[1]]),
          y - 0.5,
          y + h,
        );
      }
    }
  }
  // ── Noktalar ──
  let seed = 91;
  for (const p of plan.points ?? []) {
    const y = H(p.x, p.z);
    const c: V3 = [p.x, y + 0.06, p.z];
    const yaw = ((p.rot ?? 0) * Math.PI) / 180;
    switch (p.kind) {
      case 'shrub':
        // İğne yapraklı çalılar (mazı sırası) ağaç kütüphanesinde (surveyVegetation)
        if (!treeLibPoint(p)) bush(b, c, p.r ?? 0.7, p.h ?? (p.r ?? 0.7) * 1.2, (seed += 7));
        break;
      case 'lamp':
        gardenLamp(b, c, p.h ?? 3.2);
        break;
      case 'bench':
        bench(b, c, yaw);
        break;
      case 'umbrella':
        umbrella(b, c);
        break;
      case 'lounger':
        lounger(b, c, yaw);
        break;
      case 'car':
        seed = (seed * 16807) % 2147483647;
        cars.push(p.x, y + 0.1, p.z, yaw, seed % 1000);
        break;
      case 'fountain': {
        b.cylinder('coping', [p.x, y, p.z], 0.12, (p.h ?? 1.6) - 0.1, 10);
        const g = new THREE.SphereGeometry(p.r ?? 0.8, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        g.scale(1, 0.35, 1);
        g.translate(p.x, y + (p.h ?? 1.6) - 0.1, p.z);
        b.geometry('coping', g);
        break;
      }
      case 'ladder':
        for (const s of [-0.25, 0.25]) {
          const co = Math.cos(yaw);
          const si = Math.sin(yaw);
          b.box('steel', [p.x + co * s, y + 0.45, p.z - si * s], [0.04, 0.9, 0.04], yaw);
        }
        break;
      case 'slide': {
        b.box('darkMetal', [p.x, y + 0.75, p.z], [0.9, 0.06, 0.9], yaw);
        for (const [dx, dz] of [
          [-0.4, -0.4],
          [0.4, -0.4],
          [-0.4, 0.4],
          [0.4, 0.4],
        ])
          b.box('darkMetal', [p.x + dx, y + 0.75, p.z + dz], [0.06, 1.5, 0.06], yaw);
        const g = new THREE.BoxGeometry(0.55, 0.05, 2.4);
        g.rotateX(0.55);
        g.rotateY(yaw);
        g.translate(p.x + Math.sin(yaw) * 1.4, y + 0.75, p.z + Math.cos(yaw) * 1.4);
        b.geometry('spPlayBlue', g);
        break;
      }
      case 'swing': {
        for (const s of [-1.2, 1.2]) b.box('darkMetal', [p.x + s, y + 1.1, p.z], [0.08, 2.2, 0.08], yaw);
        b.box('darkMetal', [p.x, y + 2.2, p.z], [2.5, 0.08, 0.08], yaw);
        for (const s of [-0.5, 0.5]) b.box('spPlayYellow', [p.x + s, y + 0.45, p.z], [0.45, 0.04, 0.2], yaw);
        break;
      }
      case 'bin':
        b.cylinder('darkMetal', [p.x, y, p.z], 0.22, 0.85, 10);
        break;
      case 'playset':
        playSet(b, [p.x, y + 0.04, p.z], yaw, collide);
        break;
      case 'lamp2':
        lamp2(b, [p.x, y, p.z], yaw);
        break;
      case 'bin-stand':
        binStand(b, [p.x, y, p.z], yaw);
        break;
      case 'rose':
        roseBush(b, [p.x, y, p.z], (seed += 13));
        break;
      case 'cone':
        // Limoni servi konileri ağaç kütüphanesinde (surveyVegetation → vegetation, tür 'goldcrest')
        break;
      case 'bollard':
        b.cylinder('darkMetal', [p.x, y, p.z], 0.07, 0.8, 8);
        break;
    }
  }
  return { holes, cars };
}

function edgeRing(p: V2, q: V2, w: number): [number, number][] {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const n: V2 = [(-(q[1] - p[1]) / L) * w * 0.5, ((q[0] - p[0]) / L) * w * 0.5];
  return [
    [p[0] + n[0], p[1] + n[1]],
    [q[0] + n[0], q[1] + n[1]],
    [q[0] - n[0], q[1] - n[1]],
    [p[0] - n[0], p[1] - n[1]],
  ];
}

/**
 * Havuz platformu korkuluğu (fotoğraf): 1.35 m arayla paslanmaz dikme, 0.85 m buzlu cam panel, üstte Ø5 cm
 * paslanmaz küpeşte (1.0 m). Kapı açıklıklarında kesilir; kapıda platforma çıkan traverten basamak.
 */
function glassRail(
  b: Builder,
  p: V2,
  q: V2,
  y: number,
  gates: { c: V2; w: number }[],
  collide?: Collide,
): void {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (L < 0.2) return;
  const t: V2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
  const yaw = Math.atan2(-t[1], t[0]);
  let parts: [number, number][] = [[0, L]];
  for (const g of gates) {
    const gu = (g.c[0] - p[0]) * t[0] + (g.c[1] - p[1]) * t[1];
    const off = Math.abs((g.c[0] - p[0]) * t[1] - (g.c[1] - p[1]) * t[0]);
    if (off > 0.6 || gu < -0.5 || gu > L + 0.5) continue;
    parts = parts.flatMap(
      ([u0, u1]) =>
        [
          [u0, Math.min(u1, gu - g.w / 2)],
          [Math.max(u0, gu + g.w / 2), u1],
        ].filter(([a, e]) => e - a > 0.05) as [number, number][],
    );
    // Basamak (dışarı): iki kademe
    const n: V2 = [-t[1], t[0]];
    const mid: V2 = [p[0] + t[0] * gu, p[1] + t[1] * gu];
    for (const s of [1, -1]) {
      const c1: V2 = [mid[0] + n[0] * 0.28 * s, mid[1] + n[1] * 0.28 * s];
      const c2: V2 = [mid[0] + n[0] * 0.58 * s, mid[1] + n[1] * 0.58 * s];
      b.box('deck', [c1[0], y - 0.45 + 0.3 / 2, c1[1]], [g.w + 0.2, 0.3, 0.3], yaw);
      b.box('deck', [c2[0], y - 0.45 + 0.15 / 2, c2[1]], [g.w + 0.2, 0.15, 0.3], yaw);
    }
  }
  const at = (u: number): V2 => [p[0] + t[0] * u, p[1] + t[1] * u];
  for (const [u0, u1] of parts) {
    const A = at(u0);
    const E = at(u1);
    const len = u1 - u0;
    // Cam (iki yüz), 5 cm içeride
    b.wall('glassFrost', A, E, y + 0.06, y + 0.78, [0, 0, 1, 1]);
    b.wall('glassFrost', E, A, y + 0.06, y + 0.78, [0, 0, 1, 1]);
    const m = at((u0 + u1) / 2);
    b.box('steel', [m[0], y + 0.86, m[1]], [len + 0.04, 0.05, 0.05], yaw);
    const n = Math.max(1, Math.round(len / 1.35));
    for (let k = 0; k <= n; k++) {
      const c = at(u0 + (len * k) / n);
      b.cylinder('steel', [c[0], y, c[1]], 0.022, 0.86, 8);
    }
    collide?.(edgeRing(A, E, 0.12), y - 1.2, y + 1.0);
  }
}

/** Kilit taşı alan kenarında beton bordür (dışarıda başka döşeme/alan yoksa) */
function siteKerbs(
  b: Builder,
  poly: V2[],
  areas: SiteArea[],
  H: (x: number, z: number) => number,
  off: number,
): void {
  const c = centroid(poly);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 0.4) continue;
    const t: V2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    let n: V2 = [-t[1], t[0]];
    const mid: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (n[0] * (mid[0] - c[0]) + n[1] * (mid[1] - c[1]) < 0) n = [-n[0], -n[1]];
    // Parça parça (1 m): dış noktada başka (çim dışı) alan varsa bordür yok
    const nS = Math.max(1, Math.round(L));
    for (let k = 0; k < nS; k++) {
      const u = (L * (k + 0.5)) / nS;
      const m: V2 = [p[0] + t[0] * u, p[1] + t[1] * u];
      const o: V2 = [m[0] + n[0] * 0.35, m[1] + n[1] * 0.35];
      if (areas.some((a) => a.kind !== 'lawn' && insidePoly(a.poly, o[0], o[1]))) continue;
      const kc: V2 = [m[0] + n[0] * 0.05, m[1] + n[1] * 0.05];
      b.box(
        'siteKerb',
        [kc[0], H(kc[0], kc[1]) + off - 0.06, kc[1]],
        [L / nS + 0.01, 0.2, 0.1],
        Math.atan2(-t[1], t[0]),
      );
    }
  }
}

function rect(m: V2, t: V2, L: number, w: number): [number, number][] {
  const n: V2 = [-t[1], t[0]];
  const hl = L / 2;
  const hw = w / 2;
  return [
    [m[0] - t[0] * hl - n[0] * hw, m[1] - t[1] * hl - n[1] * hw],
    [m[0] + t[0] * hl - n[0] * hw, m[1] + t[1] * hl - n[1] * hw],
    [m[0] + t[0] * hl + n[0] * hw, m[1] + t[1] * hl + n[1] * hw],
    [m[0] - t[0] * hl + n[0] * hw, m[1] - t[1] * hl + n[1] * hw],
  ];
}

/** Çalı: basık küre gövde + yaprak kartları */
function bush(b: Builder, c: V3, r: number, h: number, seed: number): void {
  const g = new THREE.SphereGeometry(1, 10, 6);
  g.scale(r, h / 2, r);
  g.translate(c[0], c[1] + h / 2 - 0.05, c[2]);
  b.geometry('boxwood', g);
  for (let k = 0; k < 4; k++) {
    const a = ((k + (seed % 7) / 7) / 4) * Math.PI * 2;
    const n: V2 = [Math.cos(a), Math.sin(a)];
    const t: V2 = [-n[1], n[0]];
    const p: V2 = [c[0] + n[0] * r * 0.85, c[2] + n[1] * r * 0.85];
    leafFringe(
      b,
      'boxLeaf',
      [p[0] - t[0] * r * 0.6, p[1] - t[1] * r * 0.6],
      [p[0] + t[0] * r * 0.6, p[1] + t[1] * r * 0.6],
      c[1] + 0.1,
      c[1] + h * 0.95,
      r,
      n,
      4,
      seed + k * 31,
      Math.max(0.25, r * 0.45),
    );
  }
}

function gardenLamp(b: Builder, p: V3, h: number): void {
  b.cylinder('darkMetal', [p[0], p[1], p[2]], 0.1, 0.35, 8);
  b.cylinder('darkMetal', [p[0], p[1] + 0.35, p[2]], 0.045, h - 0.6, 8);
  b.cylinder('darkMetal', [p[0], p[1] + h - 0.25, p[2]], 0.09, 0.08, 8);
  const g = new THREE.SphereGeometry(0.2, 12, 8);
  g.translate(p[0], p[1] + h, p[2]);
  b.geometry('gardenGlobe', g);
}

function bench(b: Builder, c: V3, yaw: number): void {
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const P = (x: number, y: number, z: number): V3 => [
    c[0] + x * co + z * si,
    c[1] + y,
    c[2] - x * si + z * co,
  ];
  for (let k = 0; k < 3; k++) b.box('wood', P(0, 0.44, -0.1 + k * 0.13), [1.6, 0.04, 0.1], yaw);
  for (let k = 0; k < 3; k++) b.box('wood', P(0, 0.62 + k * 0.12, 0.2), [1.6, 0.09, 0.03], yaw);
  for (const x of [-0.65, 0.65]) {
    b.box('darkMetal', P(x, 0.22, 0.05), [0.06, 0.44, 0.45], yaw);
    b.box('darkMetal', P(x, 0.6, 0.22), [0.06, 0.4, 0.05], yaw);
  }
}

function umbrella(b: Builder, c: V3): void {
  b.cylinder('steel', c, 0.025, 2.3, 6);
  const g = new THREE.ConeGeometry(1.25, 0.45, 8, 1, true);
  g.translate(c[0], c[1] + 2.35, c[2]);
  b.geometry('umbrella', g);
}

function lounger(b: Builder, c: V3, yaw: number): void {
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const P = (x: number, y: number, z: number): V3 => [
    c[0] + x * co + z * si,
    c[1] + y,
    c[2] - x * si + z * co,
  ];
  b.box('lounger', P(-0.25, 0.32, 0), [1.25, 0.04, 0.66], yaw);
  b.box('lounger', P(0.7, 0.5, 0), [0.6, 0.04, 0.66], yaw);
  for (const [x, z] of [
    [-0.85, -0.28],
    [-0.85, 0.28],
    [0.45, -0.28],
    [0.45, 0.28],
  ])
    b.box('lounger', P(x, 0.15, z), [0.05, 0.3, 0.05], yaw);
}
