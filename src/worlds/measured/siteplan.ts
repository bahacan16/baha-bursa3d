import * as THREE from 'three';
import * as pcNs from 'polygon-clipping';
import { Builder, leafFringe, type V2, type V3 } from './builder';
import { parseSpecies, speciesIndex } from '../osm/species';
import facadesRings from './data/facades.json';
import footprintsRings from './data/footprints.json';
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
  /** hedge: ölçülen yaprak tonu (#hex, güneşli yüz) → `hedge@` / `hedgeLeaf@` çeşidi; verilmezse sabit çit malzemesi */
  color?: string;
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
    /**
     * Bordür boyası: "white" (yol yüzü + üstün dış yarısı beyaz — bisiklet şeridi kenarı); v8 "green-white" ya da
     * { colors: ["#yeşil", "#beyaz"], group: taş sayısı, face: true → yalnız yola bakan yüz } dönüşümlü gruplar.
     * Verilmezse malzeme metni "yeşil/beyaz dönüşümlü boyalı (≈3 taş …)" okunur (street.ts kerbPaintOf).
     */
    kerbPaint?: string | { colors?: string[]; group?: number; face?: boolean };
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
     * v8: OSM kaldırımı bu yolda: none (ölçülmüş bordür / refüj / park şeridi var — critic d4b #1: bölünmüş bulvarın
     * tek yönlü kollarında OSM iki yana kaldırım çiziyordu, refüj kenarında ve park şeridinde sarı kılavuzlu bant),
     * left | right (OSM çizim yönüne göre, parse.ts ile aynı), both.
     */
    sidewalk?: 'none' | 'left' | 'right' | 'both';
    /** v8: şerit sayısı (OSM `lanes` yerine): tek yönlü yolda şerit ayırıcı kesikli çizgiler; ≤ 1 → çizgi yok */
    lanes?: number;
    /**
     * Orta çizginin OSM eksenine göre dünya kayması [dx, dz] (m): ölçülen gerçek çizgi OSM ekseninden farklıysa
     * (ör. 502. Sk. z −100'de OSM x≈6.4, gerçek x≈5.2–5.8 → [-0.9, 0]). Kenar çizgileri etkilenmez.
     */
    centreShift?: [number, number];
    /**
     * v10: kesikli çizgi (şerit ayırıcı / kesikli orta çizgi) çizilmeyen kesimler: { z: [a, b] } / { x: [a, b] } dünya
     * aralığı (ikisi birlikte = dikdörtgen) ya da { poly: [[x, z], …] } (+ isteğe bağlı x / z). Düz çizgiler kalır.
     */
    noDash?: { x?: [number, number]; z?: [number, number]; poly?: V2[] }[];
    note?: string;
  }[];
  /**
   * v8: sokak zemin alanları (site-plan `areas` ile aynı şema ve türler: paving | gravel | asphalt | lawn | bed …;
   * `material` metni tonu seçer — siteplan.areaKey): ölçülmüş bölgede OSM kaldırımı, hava fotoğrafı ağacı ve arazi
   * çim boyası bastırılır. Ör. Biaport önü kilit taşı / dik park döşemesi, Kent Park güney çakıl otoparkı.
   */
  areas?: SiteArea[];
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
 *   frame, mullion (1.0), doors [{edge, u0, u1}], solid [kenar] (dolu kenarlar, wallC), plinth {h, color}, roofC,
 *   open [kenar | {edge, u0, u1}] (açık cephe: camsız, ara dikmesiz; iç ve çatı kalır)
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
/** El modeli taban izleri (footprints.json; Mertkent blokları dahil) */
const FOOTPRINT_RINGS = footprintsRings as unknown as Record<string, { ring?: V2[] }>;

/** El modeli binalarının taban izleri (facades.json + footprints.json; kimlik başına bir halka, footprints önce) */
export function handFootprints(): V2[][] {
  const out: V2[][] = [];
  const seen = new Set<string>();
  for (const src of [FOOTPRINT_RINGS, FACADES_RINGS] as Record<string, { ring?: V2[] }>[])
    for (const [id, v] of Object.entries(src)) {
      if (seen.has(id) || !v.ring || v.ring.length < 3) continue;
      seen.add(id);
      out.push(v.ring);
    }
  return out;
}

/**
 * Çokgenin kenar bantları (her kenar iki yana d m, uçlarda d uzatılmış dörtgenler) + çokgenin kendisi: düz halkalar.
 * Bölge testi `some(inFlat)` ile birleşim olarak kullanılır (tampon). KARAR: gönye yerine uzatılmış bant — köşede
 * küçük çentik kalır, d ≤ 2 m için önemsiz.
 */
/**
 * Sokak planı alanı yol kotunda mı (park cebi / şerit dolgusu asfaltı, kotsuz ya da ≤ 6 cm döşeme / çakıl): OSM
 * kaldırımı bastırması ROAD_SIDE tamponlu olur. Yükseltilmiş ön alanlar (level 0.15) kendi çokgenleriyle kalır.
 */
export function areaAtGrade(a: { kind?: string; level?: number }): boolean {
  return a.kind === 'asphalt' || !(typeof a.level === 'number' && a.level > 0.06);
}

export function bufferedRings(poly: V2[], d: number): number[][] {
  const out: number[][] = [flat(poly)];
  if (!(d > 0)) return out;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const e = poly[(i + 1) % poly.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 0.05) continue;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const n: V2 = [-t[1], t[0]];
    const A: V2 = [a[0] - t[0] * d, a[1] - t[1] * d];
    const E: V2 = [e[0] + t[0] * d, e[1] + t[1] * d];
    out.push(
      flat([
        [A[0] - n[0] * d, A[1] - n[1] * d],
        [E[0] - n[0] * d, E[1] - n[1] * d],
        [E[0] + n[0] * d, E[1] + n[1] * d],
        [A[0] + n[0] * d, A[1] + n[1] * d],
      ]),
    );
  }
  return out;
}

/** Ölçülmüş ada / refüj çokgenleri (street-plan `island`: poly; `roundabout-island`: elips halka) */
function surveyedIslands(plan: StreetPlan): V2[][] {
  const out: V2[][] = [];
  for (const p of plan.street ?? []) {
    const q = p as unknown as { rx?: number; rz?: number; poly?: V2[] };
    if (p.kind === 'roundabout-island' && q.rx) {
      const ring: V2[] = [];
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        ring.push([p.x + Math.cos(a) * (q.rx + 0.5), p.z + Math.sin(a) * ((q.rz ?? q.rx) + 0.5)]);
      }
      out.push(ring);
    } else if (p.kind === 'island' && q.poly && q.poly.length >= 3) out.push(q.poly);
  }
  return out;
}

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
 * Ağaç sistemi için: ölçülmüş ağaçlar [x, z, tür, boy m, taç yarıçapı m, taç tabanı m]* (0 = ölçülmedi;
 * vegetation.ts FIXED_STRIDE) + otomatik ağaç konmayacak bölgeler.
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
  /** v9: OSM yol çizgilerinin çizilmeyeceği alanlar (döşeme / park / çakıl; şerit dolgusu asfalt hariç) */
  noMarkZones: number[][];
} {
  const fixedTrees: number[] = [];
  // v8: ölçülen taç tabanı `crownBase` (m, ilk dalların kotu) örnek başına (FIXED_STRIDE 6)
  const add = (
    x: number,
    z: number,
    r: number | undefined,
    h: number | undefined,
    type: number,
    cb?: unknown,
  ) => fixedTrees.push(x, z, type, h ?? 0, r ?? 0, typeof cb === 'number' && cb > 0 ? cb : 0);
  for (const p of [...(SITE_PLAN.points ?? []), ...(PARK_PLAN.points ?? [])]) {
    if (!treeLibPoint(p)) continue;
    // Konik servi noktaları (tür alanı yok): yer fotoğraflarındaki limoni servi sıraları
    const sp = p.kind === 'cone' ? (p.species ?? 'goldcrest') : p.species;
    add(
      p.x,
      p.z,
      p.r,
      p.h ?? (p.kind === 'cone' ? 2.4 : undefined),
      speciesType(sp, p.note),
      (p as { crownBase?: unknown }).crownBase,
    );
  }
  // Sokak ağaçları (2 m altındakiler dahil: köşe adasının mazı konileri de ağaç kütüphanesinde)
  for (const p of STREET_PLAN.street ?? [])
    if (p.kind === 'tree') {
      const q = p as { species?: string; r?: number; crownBase?: unknown };
      add(p.x, p.z, q.r, p.h, speciesType(q.species, `${p.text ?? ''} ${p.note ?? ''}`), q.crownBase);
    }
  const excludeZones: number[][] = [];
  for (const a of [...(SITE_PLAN.areas ?? []), ...(PARK_PLAN.areas ?? [])])
    if (a.poly?.length >= 3) excludeZones.push(flat(a.poly));
  // v8: sokak planı zemin alanları (döşeme, çakıl otopark…): hava fotoğrafı ağacı yok
  for (const a of STREET_PLAN.areas ?? []) if (a.poly?.length >= 3) excludeZones.push(flat(a.poly));
  // v8 (critic d4a #11): el modeli binalarının taban izleri — OSM binası çizilmediği için (HANDMADE_IDS) otomatik
  // ağaç engellemesi bunları görmüyordu; Biaport podyumunun içinden 14 hava fotoğrafı tacı çıkıyordu
  for (const r of handFootprints()) excludeZones.push(flat(r));
  // Ölçülmüş kavşak adası / ayrım adaları: yalnız ölçülen ağaç (hava fotoğrafı tespiti çiçeklik ve lamba
  // gölgelerinden kavşak adasına 6 sahte taç koyuyordu; ölçümde adada tek ağaç var)
  const islands = surveyedIslands(STREET_PLAN);
  for (const r of islands) excludeZones.push(flat(r));
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
  // v8 (critic d4b #1, d4c #8): ölçülmüş refüj / ada: OSM kaldırımı çizilmez (tek yönlü kolların refüj kenarındaki
  // kaldırımı sarı kılavuzlu bant olarak refüjün üstünde / yanında kalıyordu). 1.5 m tampon: OSM ekseni kaymışsa
  // bant ortası refüj kenarının dışına düşüyordu; refüjün iki yanı araç yolu olduğundan gerçek kaldırımı silmez.
  for (const r of islands) noSidewalkZones.push(...bufferedRings(r, 1.5));
  // v8: sokak planı zemin alanları: OSM kaldırımı yerine ölçülmüş döşeme. v9 (critic d4c #4): yol kotundaki alanlar
  // (park cebi, şerit dolgusu, kotsuz döşeme) ROAD_SIDE tamponlu — OSM ekseni kaymışsa OSM kaldırımı alanın hemen
  // yol tarafında (Muammer Aksoy d4-ma-se-bay kuzeyi, z −805…−800) asfaltın ortasında kalıyordu
  const noMarkZones: number[][] = [];
  for (const a of STREET_PLAN.areas ?? []) {
    if (!(a.poly?.length >= 3)) continue;
    noSidewalkZones.push(...(areaAtGrade(a) ? bufferedRings(a.poly, ROAD_SIDE) : [flat(a.poly)]));
    if (!/carriageway|şerit dolgusu/i.test(`${(a as { id?: string }).id ?? ''} ${a.material ?? ''}`))
      noMarkZones.push(flat(a.poly));
  }
  const roadMarks = roadMarksOf(STREET_PLAN);
  return {
    fixedTrees,
    excludeZones,
    noSidewalkZones,
    noCurbZones,
    noMarkZones,
    roadMarks,
    noPropZones: surveyedPropZones(),
  };
}

/**
 * v8 (critic d4a #2/#12, d4b #7/#8): ölçülmüş zemin çokgenleri — arazi gölgelendiricisinde hava fotoğrafının çim /
 * toprak boyası bastırılır (osm/world.setSurveyGround). Kaldırım bantları (bordürden w; yol tarafına 1.5 m asfalt
 * dolgusu dahil), adalar (+0.5 m), sokak planı alanları, site / park planı sert zemin alanları (lawn / bed hariç).
 */
export function surveyGroundPolys(
  plan: StreetPlan = STREET_PLAN,
  extra: SitePlan[] = [SITE_PLAN, PARK_PLAN],
): V2[][] {
  const out: V2[][] = [];
  for (const s of plan.sidewalks ?? []) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const a = s.pts[i];
      const e = s.pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.1) continue;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      const n = sideNormal(t, s.side);
      const A: V2 = [a[0] - t[0] * 0.5, a[1] - t[1] * 0.5];
      const E: V2 = [e[0] + t[0] * 0.5, e[1] + t[1] * 0.5];
      out.push([
        [A[0] - n[0] * 1.5, A[1] - n[1] * 1.5],
        [E[0] - n[0] * 1.5, E[1] - n[1] * 1.5],
        [E[0] + n[0] * s.w, E[1] + n[1] * s.w],
        [A[0] + n[0] * s.w, A[1] + n[1] * s.w],
      ]);
    }
  }
  for (const r of surveyedIslands(plan)) out.push(...bufferedRings(r, 0.5).map(unflat));
  for (const a of plan.areas ?? []) if (a.poly?.length >= 3) out.push(a.poly);
  for (const p of extra)
    for (const a of p.areas ?? [])
      if (a.poly?.length >= 3 && a.kind !== 'lawn' && a.kind !== 'bed' && a.kind !== 'pool') out.push(a.poly);
  return out;
}

function unflat(f: number[]): V2[] {
  const o: V2[] = [];
  for (let i = 0; i + 1 < f.length; i += 2) o.push([f[i], f[i + 1]]);
  return o;
}

/**
 * v8: ölçülmüş kaldırımların yaya yürüme hatları (sim/pedestrians SidewalkResolver): bordürden min(w/2, 2) m içeride,
 * kot = kerbH (yoksa 0.15). KARAR: geniş ön bahçeli / teraslı kaldırımda (w 8–20 m) yaya bordüre yakın yürür (masa,
 * saksı, pano bandı cephe tarafında).
 */
export function measuredWalkLines(plan: StreetPlan = STREET_PLAN): { pts: V2[]; h: number }[] {
  const out: { pts: V2[]; h: number }[] = [];
  for (const s of plan.sidewalks ?? []) {
    if (!s.pts || s.pts.length < 2 || !(s.w > 0)) continue;
    const off = Math.min(s.w / 2, 2);
    const pts: V2[] = s.pts.map((p, i) => {
      const a = s.pts[Math.max(0, i - 1)];
      const e = s.pts[Math.min(s.pts.length - 1, i + 1)];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
      const n = sideNormal([(e[0] - a[0]) / L, (e[1] - a[1]) / L], s.side);
      return [p[0] + n[0] * off, p[1] + n[1] * off];
    });
    out.push({ pts, h: typeof s.kerbH === 'number' && Number.isFinite(s.kerbH) ? s.kerbH : 0.15 });
  }
  return out;
}

/** street-plan roads[] → OSM yol kimliği ("w…") → çizgi / kaldırım / şerit düzeltmesi (roads.ts RoadMarkSpec) */
export function roadMarksOf(plan: StreetPlan): Record<string, RoadMark> {
  const roadMarks: Record<string, RoadMark> = {};
  for (const r of plan.roads ?? []) {
    const id = typeof r.id === 'number' ? `w${r.id}` : /^\d+$/.test(r.id) ? `w${r.id}` : r.id;
    roadMarks[id] = {
      ...(r.centre ? { centre: r.centre } : {}),
      ...(r.edges ? { edges: r.edges } : {}),
      ...(r.sidewalk && /^(none|left|right|both)$/.test(r.sidewalk) ? { sidewalk: r.sidewalk } : {}),
      ...(typeof r.lanes === 'number' && Number.isFinite(r.lanes) && r.lanes >= 0
        ? { lanes: Math.round(r.lanes) }
        : {}),
      ...(r.centreShift && r.centreShift.length === 2 && r.centreShift.every(Number.isFinite)
        ? { shift: [r.centreShift[0], r.centreShift[1]] as [number, number] }
        : {}),
      ...(noDashOf(r.noDash) ? { noDash: noDashOf(r.noDash)! } : {}),
    };
  }
  return roadMarks;
}

/** roads[].noDash doğrulama: geçerli aralık / çokgen bölgeleri (yoksa null) */
function noDashOf(v: unknown): { x?: [number, number]; z?: [number, number]; poly?: V2[] }[] | null {
  if (!Array.isArray(v)) return null;
  const rng = (r: unknown): [number, number] | undefined =>
    Array.isArray(r) && r.length === 2 && r.every((q) => typeof q === 'number' && Number.isFinite(q))
      ? [r[0] as number, r[1] as number]
      : undefined;
  const out: { x?: [number, number]; z?: [number, number]; poly?: V2[] }[] = [];
  for (const q of v as { x?: unknown; z?: unknown; poly?: unknown }[]) {
    if (!q || typeof q !== 'object') continue;
    const x = rng(q.x);
    const z = rng(q.z);
    const poly =
      Array.isArray(q.poly) && q.poly.length >= 3 && q.poly.every((p) => rng(p))
        ? (q.poly as V2[]).map((p) => [p[0], p[1]] as V2)
        : undefined;
    if (x || z || poly) out.push({ ...(x ? { x } : {}), ...(z ? { z } : {}), ...(poly ? { poly } : {}) });
  }
  return out.length ? out : null;
}

/** OSM yol çizgisi düzeltmesi (roads.ts): orta / kenar çizgisi türü, orta çizgi dünya kayması */
export interface RoadMark {
  centre?: string;
  edges?: string;
  shift?: [number, number];
  /** v8: OSM kaldırımı none | left | right | both */
  sidewalk?: string;
  /** v8: şerit sayısı (tek yönlü yol şerit çizgileri) */
  lanes?: number;
  /** v10: kesikli çizgisiz bölgeler (roads.ts NoDashZone) */
  noDash?: { x?: [number, number]; z?: [number, number]; poly?: V2[] }[];
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

/**
 * Kaldırım başına kılavuz karo tonu: `tactileTint` [r, g, b] sRGB oran çarpanı (1 = doku). Doku (textures/real/
 * tactile, 502. Sk.'ta ölçüldü) gri taşa oranı ≈1.12; DA fotoğraflarında hardal ≈1.32/1.21/1.15 (critic A7) →
 * ≈[1.18, 1.08, 1.03]. Malzeme anahtarı `tactile@r,g,b` (index.ts tactileVariant üretir).
 */
export function tactileKey(tint?: number[]): string {
  if (!tint || tint.length < 3 || tint.some((v) => !Number.isFinite(v) || v <= 0)) return 'tactile';
  if (tint.every((v) => Math.abs(v - 1) < 1e-3)) return 'tactile';
  return `tactile@${tint
    .slice(0, 3)
    .map((v) => Math.min(3, v).toFixed(3))
    .join(',')}`;
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

/** v9: ölçülen ton ya da [a, b] ton aralığı → ortalama ton (sRGB doğrusal ortalama değil, bileşen ortalaması) */
/**
 * Ölçülen tonlu çim (`lawn@#hex`) için malzeme rengi (doğrusal çarpan): çim dokusu × çarpan ≈ ölçülen ton.
 * `avg` = public/textures/grass/diffuse.jpg'nin doğrusal ortalaması (#73622f — zeytin/kahve; ölçüm 2026-09-30,
 * sharp ile). Önceden varsayılan ortalama #7a9a3c (yeşil) alınıyordu → çarpan ≈ gri 0.55–0.6, çim dokunun kahve
 * tonunda kalıyordu (refüj grassC #5b792e oyunda #5b532d, critic d4b #26). Mavi kanal dokuda çok düşük (≈0.03) →
 * sınır 10 (3 ile kuru çim #baa382 kırmızımsı çıkıyordu).
 */
export const GRASS_TEX_AVG = '#73622f';
export function lawnTint(hex: string, avg = GRASS_TEX_AVG): THREE.Color {
  const tgt = new THREE.Color(hex);
  const a = new THREE.Color(avg);
  return new THREE.Color(
    Math.min(10, tgt.r / Math.max(0.01, a.r)),
    Math.min(10, tgt.g / Math.max(0.01, a.g)),
    Math.min(10, tgt.b / Math.max(0.01, a.b)),
  );
}

/**
 * Ölçülen tonlu çit (`hedge@#hex` / `hedgeLeaf@#hex`) için malzeme rengi: doku × çarpan ≈ ölçülen ton (lawnTint ile
 * aynı yol). Doku ortalamaları (doğrusal → sRGB): textures.ts hedgeTexture() tuvali #88b44a (başsız Chromium'da
 * tuval çizilip ölçüldü, tohum 5 / 9 farkı < %1), public/textures/trees/pine_color.png opak pikselleri #60752f (sharp).
 * KARAR: ölçülen ton Street View'da güneşli yüzden örneklenir (gölgede ton aynı albedo × gölge ışığı; oyun ışığı
 * Street View pozlamasına kalibre olduğundan güneşli piksel ≈ malzeme tonu).
 */
export const HEDGE_TEX_AVG = '#88b44a';
export const HEDGE_LEAF_TEX_AVG = '#60752f';
export function hedgeTint(hex: string, leaf = false): THREE.Color {
  return lawnTint(hex, leaf ? HEDGE_LEAF_TEX_AVG : HEDGE_TEX_AVG);
}

export function toneOf(v: string | [string, string] | undefined | null): string | null {
  const ok = (h: unknown): h is string => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
  if (ok(v)) return v.toLowerCase();
  if (Array.isArray(v) && v.length === 2 && ok(v[0]) && ok(v[1])) {
    const c = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return `#${[0, 1, 2]
      .map((i) =>
        Math.round((c(v[0], i) + c(v[1], i)) / 2)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  }
  return null;
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
      // Yer fotoğrafı: koyu mor-kahve 50 cm kauçuk karo
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

type Pc = typeof pcNs;
const pc: Pc = (pcNs as unknown as { default?: Pc }).default ?? pcNs;

/**
 * v8: sert zemin alanını sokak planı kaldırımlarından çıkar (kaldırım o bölgeyi kendi bantlarıyla çizer). Döner:
 * [dış halka, ...delikler][] (kesişim yoksa özgün halka). Başarısız kırpmada özgün.
 */
export function cutAreaBy(poly: V2[], cuts: V2[][]): V2[][][] {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  // Sınır kutusu örtüşmesi (kaldırım şeridinin köşeleri alanın dışında olabilir)
  const near = cuts.filter((c) => {
    const cx = c.map((p) => p[0]);
    const cz = c.map((p) => p[1]);
    return Math.max(...cx) > x0 && Math.min(...cx) < x1 && Math.max(...cz) > z0 && Math.min(...cz) < z1;
  });
  if (!near.length) return [[poly]];
  try {
    const close = (r: V2[]) => [...r, r[0]] as [number, number][];
    const res = pc.difference([close(poly)], ...near.map((c) => [close(c)] as pcNs.Polygon));
    return res.map((pg) =>
      pg.map((ring) => {
        const r = ring.map((q) => [q[0], q[1]] as V2);
        if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
        return r;
      }),
    );
  } catch {
    return [[poly]];
  }
}

/** Site planını çiz. `skip(x,z)`: bu noktadaki öğeleri atla (ör. başka modülün çizdiği yapılar) */
export function buildSitePlan(
  b: Builder,
  plan: SitePlan,
  H: (x: number, z: number) => number,
  collide?: Collide,
  /** Ölçülen renk → malzeme anahtarı (index.ts colorKey); verilmezse renk alanları yok sayılır */
  colorKey?: (kind: 'plaster' | 'metal' | 'frame', hex: string) => string,
  /**
   * v8: sokak planı kaldırım çokgenleri — sert zemin alanları (lawn / havuz / güverte dışı) bunlardan çıkarılır ve
   * kaldırıma bakan kenarlarında bordür çizilmez. KB köşe meydanı (alan 33) nw-corner kaldırımının üstünü 11 cm
   * yukarıda örtüyordu (kırmızı bant / kılavuz görünmüyor, yola bakan kenarında karanlık bordür + yan yüz; critic c-02).
   */
  streetCuts: V2[][] = [],
  /**
   * v8 sokak planı alanları: asfalt alan (kind asphalt / malzeme asfalt, level 0) OSM yol şeridinin ALTINDA (+0.027;
   * şerit +0.04, çizgiler +0.05) — şeritler arası / kavşak boşluğu dolgusu çizgileri örtmesin
   */
  underRoads = false,
): SitePlanResult {
  const hexOk = (h: unknown): h is string => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
  const holes: [number, number, number, number][] = [];
  const cars: number[] = [];
  const areas = (plan.areas ?? [])
    .map((a) => ({ ...a, poly: openRing(a.poly) }))
    .filter((a) => a.poly.length >= 3);
  const pools = areas.filter((a) => a.kind === 'pool');
  // ── Zemin alanları (sırayla, üst üste: küçük y artışı + malzeme polygonOffset) ──
  areas.forEach((a, idx) => {
    if (a.kind === 'pool') return;
    // Kuru / sararmış çim (ölçüm `dry` + `color`): çim dokusu ölçülen tonla (index.ts lawn@ çeşidi)
    const aa = a as SiteArea & { dry?: boolean; color?: string };
    // v9: ölçülen tonlu çakıl / toprak (gravel `color`) → spGravel@ çeşidi (index.ts)
    const key =
      a.kind === 'lawn' && hexOk(aa.color)
        ? `lawn@${aa.color.toLowerCase()}`
        : a.kind === 'gravel' && toneOf(aa.color as string | [string, string] | undefined)
          ? `spGravel@${toneOf(aa.color as string | [string, string] | undefined)}`
          : areaKey(a);
    const inner = pools.filter((p) => insidePoly(a.poly, ...centroid(p.poly))).map((p) => p.poly);
    // v8: kaldırım kotundaki sert zemin (level ≈ bordür kotu, ör. köşe meydanı) kaldırım bantlarıyla aynı kotta
    // (+4 mm); önceden yığılan ofsetlerle (+0.11) kaldırımın üstünde duruyordu
    const flushPave = a.kind === 'paving' && (a.level ?? 0) > 0.05 && (a.level ?? 0) <= 0.3;
    const off =
      underRoads && key === 'drive' && !((a.level ?? 0) > 0)
        ? 0.027
        : flushPave
          ? (a.level ?? 0) + 0.004 + Math.min(0.004, idx * 0.0001)
          : 0.03 + Math.min(0.06, idx * 0.0015) + (a.level ?? 0) + (a.kind === 'lawn' ? 0 : 0.03);
    const hard = a.kind !== 'lawn' && a.kind !== 'deck';
    const parts = hard && streetCuts.length ? cutAreaBy(a.poly, streetCuts) : [[a.poly, ...inner]];
    for (const [outer, ...hs] of parts)
      try {
        b.drape(
          key,
          outer,
          hs,
          H,
          off,
          key.startsWith('spPaver') || key.startsWith('spSite') || key === 'deck' ? 1 : 0.5,
          2.5,
        );
      } catch {
        /* hatalı çokgen */
      }
    const inCut = (x: number, z: number) => streetCuts.some((c) => insidePoly(c, x, z));
    // Yükseltilmiş alanlar (güverte vb.): kenar yüzü (+ traverten denizlik), cam korkuluk
    if ((a.level ?? 0) > 0.05)
      for (const [outer] of parts)
        for (let i = 0; i < outer.length; i++) {
          const p = outer[i];
          const q = outer[(i + 1) % outer.length];
          const y0 = Math.min(H(p[0], p[1]), H(q[0], q[1]));
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          // v8: kaldırıma bitişik kenarda (kırpma kenarı) yan yüz yok — iki yüzey aynı kotta
          const mx = (p[0] + q[0]) / 2;
          const mz = (p[1] + q[1]) / 2;
          const nx = (-(q[1] - p[1]) / (L || 1)) * 0.2;
          const nz = ((q[0] - p[0]) / (L || 1)) * 0.2;
          if (inCut(mx + nx, mz + nz) || inCut(mx - nx, mz - nz)) continue;
          b.wall('deckSide', q, p, y0 - 0.1, y0 + off, [0, 0, L / 0.6, (off + 0.1) / 0.3]);
          if (a.rail === 'glass') glassRail(b, p, q, y0 + off, a.gates ?? [], collide);
          else if ((a.level ?? 0) > 0.3) collide?.(edgeRing(p, q, 0.1), y0 - 0.5, y0 + off);
        }
    // Site içi yollar: gri beton bordür (çimle sınırda); fotoğraflarda her yol kenarında
    if (key.startsWith('spSite') && !a.noKerb)
      for (const [outer] of parts) siteKerbs(b, outer, areas, H, off, inCut);
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
          const hc = hexOk(l.color) ? l.color.toLowerCase() : null;
          b.box(
            hc ? `hedge@${hc}` : 'hedge',
            [m[0], y + h / 2, m[1]],
            [L + w * 0.3, h, w],
            yaw,
            0.7,
            0b111111 & ~0b100000,
          );
          const n: V2 = [-t[1], t[0]];
          for (const s of [1, -1] as const)
            leafFringe(
              b,
              hc ? `hedgeLeaf@${hc}` : 'hedgeLeaf',
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
        case 'tactile': {
          // Hissedilebilir kılavuz şerit (site / park yolu): w (0.4) genişlikte, `base` kotunda (yoksa +0.15 kaldırım),
          // yol boyunca yerel UV (karo 40 cm); `tactileTint` sRGB oran çarpanı (street.ts tactileKey)
          const lw = l.w ?? 0.4;
          const nn: V2 = [-t[1] * (lw / 2), t[0] * (lw / 2)];
          const lb = (l as { base?: number }).base ?? 0.15;
          const tt = (l as { tactileTint?: number[] }).tactileTint;
          b.drape(
            tactileKey(tt),
            [
              [p[0] + nn[0], p[1] + nn[1]],
              [q[0] + nn[0], q[1] + nn[1]],
              [q[0] - nn[0], q[1] - nn[1]],
              [p[0] - nn[0], p[1] - nn[1]],
            ],
            [],
            H,
            lb + 0.006,
            1,
            2,
            { o: [p[0] - nn[0], p[1] - nn[1]], t, n: [-t[1], t[0]] },
          );
          break;
        }
        case 'parking-bay':
          // Site içi park çizgileri sarı (yer fotoğrafı)
          b.box(
            /beyaz|white/.test(l.note ?? '') ? 'spPaint' : 'spPaintYellow',
            // `base`: çizginin boyandığı yüzeyin kotu (ör. 0.15 m kaldırım kotundaki meydan park yeri); yoksa +0.07
            [m[0], y + ((l as { base?: number }).base ?? 0.07) + 0.008, m[1]],
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
      case 'shrub': {
        // İğne yapraklı çalılar (mazı sırası) ağaç kütüphanesinde (surveyVegetation); ölçülen `color` → gövde tonu
        const sc = (p as { color?: string }).color;
        if (!treeLibPoint(p))
          bush(
            b,
            c,
            p.r ?? 0.7,
            p.h ?? (p.r ?? 0.7) * 1.2,
            (seed += 7),
            hexOk(sc) && colorKey ? colorKey('plaster', sc) : 'boxwood',
          );
        break;
      }
      case 'lamp':
        if ((p as { style?: string }).style === 'street') {
          // Sokak lambası tipi galvaniz konik direk (street-plan lamp-post malzemesi); kol / baş görülmediyse çizilmez
          b.cylinder('pole', [p.x, y - 0.1, p.z], 0.085, p.h ?? 8, 10);
          b.cylinder('pole', [p.x, y - 0.1, p.z], 0.13, 0.5, 10);
        } else gardenLamp(b, c, p.h ?? 3.2);
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
      case 'bin': {
        // style clothes (giysi kumbarası) / glass (cam kumbarası) = kutu w × d × h; color gövde, color2 alt yarı
        // baskısı, base {h, color} kaide; verilmezse eski koyu silindir
        const q = p as {
          style?: string;
          w?: number;
          d?: number;
          color?: string;
          color2?: string;
          base?: { h?: number; color?: string };
        };
        const ck = (h: unknown, d: string) => (hexOk(h) && colorKey ? colorKey('plaster', h) : d);
        let yb = y;
        if (q.base && (q.base.h ?? 0) > 0.01) {
          const bh = q.base.h ?? 0.2;
          b.box(
            ck(q.base.color, 'spConcrete'),
            [p.x, y + bh / 2 - 0.05, p.z],
            [(q.w ?? 1) + 0.1, bh + 0.1, (q.d ?? 1) + 0.1],
            yaw,
          );
          yb = y + bh;
        }
        if (q.style === 'clothes' || q.style === 'glass') {
          const w = q.w ?? 1;
          const d = q.d ?? 1;
          const h = p.h ?? 1.5;
          // KARAR: giysi kumbarası gövdesi notta "beyaz boyalı" (güneşli ton ölçülmedi) → kırık beyaz (mkAc)
          const body = ck(q.color, 'mkAc');
          b.box(body, [p.x, yb + h / 2, p.z], [w, h, d], yaw);
          if (hexOk(q.color2))
            b.box(ck(q.color2, body), [p.x, yb + h * 0.25, p.z], [w + 0.01, h * 0.5, d + 0.01], yaw);
          // Üst kapak (hafif taşan)
          b.box(body, [p.x, yb + h + 0.02, p.z], [w + 0.04, 0.04, d + 0.04], yaw);
        } else b.cylinder(ck(q.color, 'darkMetal'), [p.x, yb, p.z], 0.22, p.h ?? 0.85, 10);
        break;
      }
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
  /** v8: bu noktada sokak kaldırımı var → bordür yok */
  covered?: (x: number, z: number) => boolean,
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
      if (covered?.(o[0], o[1])) continue;
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
function bush(b: Builder, c: V3, r: number, h: number, seed: number, key = 'boxwood'): void {
  const g = new THREE.SphereGeometry(1, 10, 6);
  g.scale(r, h / 2, r);
  g.translate(c[0], c[1] + h / 2 - 0.05, c[2]);
  b.geometry(key, g);
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
