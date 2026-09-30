import * as THREE from 'three';
import { Builder, type V2, type V3 } from './builder';
import { sideNormal, tactileKey, toneOf, type StreetPlan } from './siteplan';
import type { CK, SignSpec } from './facade';
import { buildStreetFurniture, type StreetItem } from './streetFurniture';
import { wordTone } from './streetKinds';

/**
 * Ölçülmüş sokak planı (data/street-plan.json): kaldırımlar (bordür hattından içeri w genişlik, kilit taşı
 * türü/bantları), bordür taşları, sokak eşyası (lamba direği, levha, direk, çöp kutusu, babalar, ayna, rögar,
 * sokak ağaçlarının çukuru), kavşak adası, ayrım adaları, yaya geçitleri, trafik ışıkları, reklam panosu sıraları.
 */

const KERB_W = 0.15;
/**
 * Bordür birim boyu (m): yer fotoğrafı ref-01.jpg metrik düzeltmede enine derzler ≈0.70–0.73 m
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
  /** v8: kaldırım şeritlerinin çokgenleri (site / park sert zemin alanları bunlardan kırpılır) */
  coverPolys: V2[][];
  /**
   * v7: noktadaki ölçülmüş yürüme yüzeyi kotu (arazinin üstünde m): kavşak / ayrım adası, kaldırım bandı (alçak —
   * bordürsüz — bantlar dahil); hiçbirinin içinde değilse null. Çit / kolon / lamba tabanları buna oturur.
   */
  surfaceAt: (x: number, z: number) => number | null;
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
      // 502. Sk. batı: gri kilit taşı, ortada sarı kılavuz, yol tarafında mavi bisiklet şeridi (yer fotoğrafı)
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

/** v8: dönüşümlü bordür boyası (D4 bulvarı: yeşil / beyaz taş grupları) */
export interface KerbPaint {
  /** Sırayla boyanan renkler (sRGB hex) */
  colors: string[];
  /** Aynı renkte ardışık taş sayısı */
  group: number;
  /** Yalnız yola bakan yüz (üst boyasız) */
  face: boolean;
}
/**
 * KARAR: renk ölçülmemiş yeşil/beyaz boyalı bordürler bulvar boyunca aynı boya sayılır → d4-sw-w1 ölçümü (güneşli
 * yeşil #8e948e, beyaz #a6a49f); grup ≈3 taş (aynı ölçüm).
 */
const D4_GREEN = '#8e948e';
const D4_WHITE = '#a6a49f';
/**
 * Bordür boyası: açık alan (`kerbPaint` "green-white" / {colors, group, face}) ya da malzeme metni
 * ("… dönüşümlü yeşil (#8e948e …) ve beyaz (#a6a49f) boyalı (≈3 taş yeşil + 3 taş beyaz)"; "yola bakan yüzü …" →
 * yalnız yüz). "yeşil/beyaz boya yok" → boyasız. "white" (502. Sk. bisiklet kenarı) ayrı yordamda (null).
 */
export function kerbPaintOf(text: string | undefined, explicit?: unknown): KerbPaint | null {
  const hexes = (v: unknown) =>
    Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) : [];
  if (explicit && typeof explicit === 'object') {
    const o = explicit as { colors?: unknown; group?: number; face?: boolean };
    const cols = hexes(o.colors);
    return {
      colors: cols.length ? cols : [D4_GREEN, D4_WHITE],
      group: Math.max(1, Math.round(o.group ?? 3)),
      face: !!o.face,
    };
  }
  if (explicit === 'green-white') return { colors: [D4_GREEN, D4_WHITE], group: 3, face: false };
  if (explicit === 'white') return null;
  const t = (text ?? '').toLocaleLowerCase('tr');
  if (
    !/yeşil\s*[/-]\s*beyaz|dönüşümlü\s+yeşil|yeşil[^.;]{0,30}beyaz[^.;]{0,20}boyal|green\s*[/-]\s*white/.test(
      t,
    )
  )
    return null;
  if (/(yeşil\s*[/-]\s*beyaz\s+)?boya\s+yok|boyasız|boyanmamış/.test(t)) return null;
  const after = (w: string) => {
    const m = new RegExp(`${w}[^#.;]{0,12}(#[0-9a-f]{6})`).exec(t);
    return m ? m[1] : null;
  };
  const g = /≈?\s*(\d+)\s*taş/.exec(t);
  return {
    colors: [after('yeşil') ?? D4_GREEN, after('beyaz') ?? D4_WHITE],
    group: g ? Math.max(1, Number(g[1])) : 3,
    face: /yola bakan yüz/.test(t),
  };
}

/** Boya işlemi: tanım + sıradaki taş sayacı (hat boyunca / parçalar arası sürekli) + malzeme anahtarı */
interface PaintRun {
  spec: KerbPaint;
  k: number;
  key: (hex: string) => string;
}

/**
 * Tek taşın boyası: yola bakan yüz (faceA→faceE hattı, taş nIn yönünde içeride) 2 mm önde, üst yüz (face değilse)
 * 3 mm üstte. Önceden yalnız 502. Sk. beyaz boyası vardı.
 */
function paintStone(
  b: Builder,
  run: PaintRun,
  faceA: V2,
  faceE: V2,
  nIn: V2,
  kh: number,
  H: (x: number, z: number) => number,
): void {
  const col = run.spec.colors[Math.floor(run.k / run.spec.group) % run.spec.colors.length];
  run.k++;
  const key = run.key(col);
  const A: V2 = [faceA[0] - nIn[0] * 0.002, faceA[1] - nIn[1] * 0.002];
  const E: V2 = [faceE[0] - nIn[0] * 0.002, faceE[1] - nIn[1] * 0.002];
  // wall(a→e) normali (−(e−a).z, (e−a).x): yola (−nIn) bakan sıra
  const fwd = -(E[1] - A[1]) * -nIn[0] + (E[0] - A[0]) * -nIn[1] > 0;
  const m: V2 = [(A[0] + E[0]) / 2, (A[1] + E[1]) / 2];
  const y = H(m[0] + (nIn[0] * KERB_W) / 2, m[1] + (nIn[1] * KERB_W) / 2);
  b.wall(key, fwd ? A : E, fwd ? E : A, y + 0.02, y + kh - 0.004);
  if (!run.spec.face)
    b.drape(
      key,
      [
        faceA,
        faceE,
        [faceE[0] + nIn[0] * KERB_W, faceE[1] + nIn[1] * KERB_W],
        [faceA[0] + nIn[0] * KERB_W, faceA[1] + nIn[1] * KERB_W],
      ],
      [],
      H,
      kh + 0.003,
      1,
      2,
    );
}

/** Bir çizgi boyunca ~1 m bordür taşları: a→e hattı, n: taşların hattan içeri kaydığı yön, üst kotu zeminden kh */
function kerbStones(
  b: Builder,
  a: V2,
  e: V2,
  n: V2,
  kh: number,
  H: (x: number, z: number) => number,
  paint?: PaintRun | null,
) {
  const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
  if (L < 0.05 || kh < 0.03) return;
  const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
  const nS = Math.max(1, Math.round(L));
  for (let k = 0; k < nS; k++) {
    if (paint)
      paintStone(
        b,
        paint,
        [a[0] + (t[0] * L * k) / nS, a[1] + (t[1] * L * k) / nS],
        [a[0] + (t[0] * L * (k + 1)) / nS - t[0] * 0.006, a[1] + (t[1] * L * (k + 1)) / nS - t[1] * 0.006],
        n,
        kh,
        H,
      );
    const u = (L * (k + 0.5)) / nS;
    const c: V2 = [a[0] + t[0] * u + (n[0] * KERB_W) / 2, a[1] + t[1] * u + (n[1] * KERB_W) / 2];
    const y = H(c[0], c[1]);
    // Yüksek/Ultra: bordür taşının üst kenarları pahlı (KERB_BEV)
    if (KERB_BEV > 0)
      b.bevelBox(
        'curb',
        [c[0], y + kh / 2 - 0.05, c[1]],
        [L / nS - 0.006, kh + 0.1, KERB_W],
        Math.atan2(-t[1], t[0]),
        KERB_BEV,
      );
    else
      b.box(
        'curb',
        [c[0], y + kh / 2 - 0.05, c[1]],
        [L / nS - 0.006, kh + 0.1, KERB_W],
        Math.atan2(-t[1], t[0]),
      );
  }
}

/** Bordür pahı (buildStreetPlan süresince; 0 = pahsız) */
let KERB_BEV = 0;

/**
 * Yol yüzeyi ayrıntısı (street-plan `street[]`, yalnız Street View'da görülen yerlerde — CLAUDE.md §0.5):
 * - patch: asfalt yaması, `poly` + ölçülen ton `color`; `over: true` → yol çizgilerinin üstünde (yeni yama çizgiyi
 *   örter), yoksa çizgilerin altında;
 * - crack: çatlak / çatlak dolgusu, `pts` çoklu çizgi + genişlik `w` (m); `sealed` → parlak zift dolgu;
 * - pothole: çukur, `r` (m) ya da `poly`, koyu iç + açık kenar halkası (ton ölçülmüşse `color` / `rim`);
 * - wear: çizgi aşınması, `poly` (ya da `pts` + `w`) içinde yol çizgilerinin `amount` (0..1) kadarını yol tonuyla
 *   örten gürültülü örtü (ton `color`, yoksa yol ortalaması).
 * Z-fighting yok: OSM asfaltı +0.03/0.04 (araç yolu 4 m'de bir sıklaştırılır → kiriş hatası ≤ 3 mm), çizgiler
 * +0.05 → yama/çatlak/çukur +0.046–0.0485 (çizginin altında), üst yama ve aşınma +0.056–0.058; malzemelerde
 * polygonOffset. Kaldırım bandı içindeki detay (yanlış konum) görünmez — yama / çatlak yalnız asfaltta.
 */
export interface RoadDetail {
  kind: 'patch' | 'crack' | 'pothole' | 'wear';
  x: number;
  z: number;
  poly?: V2[];
  pts?: V2[];
  w?: number;
  r?: number;
  color?: string;
  rim?: string;
  over?: boolean;
  sealed?: boolean;
  amount?: number;
}

export { tactileKey };

/** Reklam panosu yüzü (billboard-row faces[]) — yalnız okunan yazı ve renk blokları (içerik/logo uydurulmaz) */
export interface BoardFace {
  bg?: string;
  border?: string;
  font?: string;
  bold?: boolean;
  lines?: { text: string; fg?: string; size?: number; bold?: boolean; y?: number }[];
  blocks?: { x0: number; x1: number; y0: number; y1: number; color: string }[];
}

/** Levha metni / notu → levha malzeme anahtarları (yukarıdan aşağı) */
export function signKeysOf(t: string): string[] {
  const keys: string[] = [];
  if (!t) return keys;
  if (/viraj|curve|tehlike/.test(t)) keys.push('signCurve');
  if (/\b30\b/.test(t)) keys.push('sign30');
  if (/kamyon giremez|no truck|no lorr/.test(t)) keys.push('signNoTruck');
  // "Mecburi bisiklet yolu sonu": kırmızı çapraz bantlı
  if (/bisiklet|bike|cycle/.test(t)) keys.push(/\bsonu\b|\bend\b/.test(t) ? 'signBikeEnd' : 'signBike');
  if (/park/.test(t)) keys.push('signP');
  if (/girilmez|no entry/.test(t)) keys.push('signNoEntry');
  if (/sola dönülmez|no left/.test(t)) keys.push('signNoLeft');
  if (/\bdur\b|\bstop\b/.test(t)) keys.push('signStop');
  // Ayrım adası ucu: mavi yuvarlak "mecburi sağdan gidiniz" (üstte) + sarı-siyah ok (chevron) levhası
  // KARAR: üst/alt sırası ölçülmedi → Türkiye'de ada başında yaygın dizilim (mavi daire üstte)
  if (/sağdan gidiniz|keep right/.test(t)) keys.push('signKeepRight');
  if (/chevron|sarı-siyah ok/.test(t)) keys.push('signChevron');
  // Altında ek levha (mavi dikdörtgen, beyaz ok)
  if (/ek levha[^.;]*\bok\b|arrow plate/.test(t) && !/ek levha (yok|görülmedi)/.test(t))
    keys.push('signArrowPlate');
  return keys;
}

/**
 * v8: yalnız levha METNİNDEN okunan bilgi levhaları (notta geçen "yaya geçidi" konum anlatımı olabilir): yaya geçidi
 * (mavi kare, beyaz üçgende yaya) ve otobüs durağı (mavi kare, beyaz otobüs).
 */
export function signTextKeys(t: string): string[] {
  const keys: string[] = [];
  if (/yaya geçidi|pedestrian crossing/.test(t)) keys.push('signPedestrian');
  if (/otobüs durağı|otobüs durak|durak levha|bus stop/.test(t)) keys.push('signBusStop');
  return keys;
}

/**
 * Yol kotundaki bantların (park şeridi kilit taşı, kerbH ≈ 0.02) çizim kotu. Önceden bandın kendi kotunda (0.02)
 * çiziliyordu: komşu bordürlü kaldırımın yol tarafı asfalt dolgusu (roadFill 0.028, bordürden 3–10 m) ve OSM asfaltı
 * (0.04) üstünü örtüyor, d4-pk-e4a/b gibi ölçülmüş park şeritleri asfalt görünüyordu (critic d4b #9). Yürüme kotu
 * (lowBands) ölçülen değerde kalır; yalnız görünen yüzey OSM asfaltının (+3 mm kiriş) hemen üstüne alınır.
 */
export const AT_GRADE_TOP = 0.045;
export function bandDrapeY(h: number): number {
  return h < AT_GRADE_TOP ? AT_GRADE_TOP : h;
}

/** Yol üstü gömülü kapak kotu (arazinin üstünde m): OSM asfaltı 0.04 (+3 mm kiriş) ve çizgiler 0.05 üstünde */
export const ROAD_FLUSH = 0.062;
/** Bisiklet şeridi (spBike 0.075, kenar boyası 0.08) üstündeki kapak kotu */
export const ROAD_FLUSH_BIKE = 0.092;

/** Yol tonu varsayılanı (OSM roadFill ortalaması, sRGB) */
const ROAD_TONE = '#8a8b88';

function roadDetail(
  b: Builder,
  s: RoadDetail,
  H: (x: number, z: number) => number,
  colorKey: StreetExt['colorKey'],
): void {
  const ck = (
    kind: 'asphalt' | 'tar' | 'wear1' | 'wear2' | 'wear3',
    hex: string | undefined,
    dflt: string,
  ) => (colorKey ? colorKey(kind, hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : dflt) : 'roadFill');
  const ring = (r: V2[]) => {
    const o = r.map((p) => [p[0], p[1]] as V2);
    if (o.length > 3 && o[0][0] === o[o.length - 1][0] && o[0][1] === o[o.length - 1][1]) o.pop();
    return o;
  };
  /** Çoklu çizgiden şerit çokgenleri (parça başına dörtgen) */
  const ribbon = (pts: V2[], w: number): V2[][] => {
    const out: V2[][] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const e = pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.01) continue;
      const nx = (-(e[1] - a[1]) / L) * (w / 2);
      const nz = ((e[0] - a[0]) / L) * (w / 2);
      // Uçlarda hafif uzatma: kırık çizgi parçaları arasında boşluk kalmasın
      const tx = ((e[0] - a[0]) / L) * (w / 2);
      const tz = ((e[1] - a[1]) / L) * (w / 2);
      out.push([
        [a[0] - tx + nx, a[1] - tz + nz],
        [e[0] + tx + nx, e[1] + tz + nz],
        [e[0] + tx - nx, e[1] + tz - nz],
        [a[0] - tx - nx, a[1] - tz - nz],
      ]);
    }
    return out;
  };
  if (s.kind === 'patch') {
    const r = ring(s.poly ?? []);
    if (r.length < 3) return;
    b.drape(ck('asphalt', s.color, ROAD_TONE), r, [], H, s.over ? 0.056 : 0.046, 1, 2);
  } else if (s.kind === 'crack') {
    const w = Math.max(0.005, Math.min(0.3, s.w ?? 0.03));
    for (const q of ribbon(s.pts ?? [], w))
      b.drape(
        s.sealed ? ck('tar', s.color, '#2b2b2a') : ck('asphalt', s.color, '#3f403e'),
        q,
        [],
        H,
        s.over ? 0.057 : 0.0475,
        1,
        2,
      );
  } else if (s.kind === 'pothole') {
    let r = ring(s.poly ?? []);
    if (r.length < 3) {
      const R = Math.max(0.05, s.r ?? 0.25);
      r = Array.from({ length: 14 }, (_, k) => {
        const a = (k / 14) * Math.PI * 2;
        // Düzensiz kenar (tohum: konum)
        const f = 0.85 + 0.3 * Math.abs(Math.sin(a * 3 + s.x * 7.1 + s.z * 3.3));
        return [s.x + Math.cos(a) * R * f, s.z + Math.sin(a) * R * f] as V2;
      });
    }
    // Açık kenar halkası (kırık asfalt) + koyu iç (çukur dibi)
    const cx = r.reduce((a, p) => a + p[0], 0) / r.length;
    const cz = r.reduce((a, p) => a + p[1], 0) / r.length;
    const grow = r.map((p) => [cx + (p[0] - cx) * 1.18, cz + (p[1] - cz) * 1.18] as V2);
    b.drape(ck('asphalt', s.rim, '#9a9a96'), grow, [], H, 0.0465, 1, 2);
    b.drape(ck('tar', s.color, '#2c2d2c'), r, [], H, 0.0485, 1, 2);
  } else if (s.kind === 'wear') {
    const polys = s.poly?.length ? [ring(s.poly)] : ribbon(s.pts ?? [], Math.max(0.1, s.w ?? 0.3));
    // Aşınma oranı üç kademede (~%25 / %50 / %75 örtü): gürültü alfasının eşiği malzemede
    const amt = Math.max(0, Math.min(1, s.amount ?? 0.5));
    if (amt <= 0.05) return;
    const lvl = Math.min(3, Math.max(1, Math.round(amt * 4))) as 1 | 2 | 3;
    for (const q of polys)
      if (q.length >= 3) b.drape(ck(`wear${lvl}`, s.color, ROAD_TONE), q, [], H, 0.058, 2, 2);
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
  /** Çevre yolunun dış kenarı (m, merkezden); yoksa nottaki "r≈a–b" */
  ringOuter?: number;
  note?: string;
  /**
   * v9: biçilmemiş çayır iç kısım + biçilmiş kenar şeridi: `rim` şerit eni (m; [a, b] aralık → orta), `rimC` şerit
   * tonu, `c` çayır tonu, `h` çayır boyu (m; aralık → orta). Tonlar "#rrggbb" ya da [a, b] (ortalama).
   */
  meadow?: {
    rim?: number | [number, number];
    rimC?: string | [string, string];
    c?: string | [string, string];
    h?: number | [number, number];
  };
}

/** v9: ölçülen değer ya da [a, b] aralığı → orta değer */
function midOf(v: number | [number, number] | undefined, d: number): number {
  if (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(x))) return (v[0] + v[1]) / 2;
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/**
 * Kuğu boynu lamba kolu: direk ekseninden (c, taban kotu c[1]) h − 1.2'den yukarı çıkıp tepeye (h + 0.15) kıvrılan ve
 * `arm` m ötede hafifçe aşağı bakan uçta biten boru (Ø 9 cm), ucunda yassı LED armatür. yaw: kolun yönü (atan2).
 * KARAR: kıvrım yarıçapı ölçülmedi → fotoğraftaki oran (kol boyunun ~yarısı kadar yükselme) Bezier ile.
 */
export function swanArm(b: Builder, c: V3, h: number, arm: number, yaw: number): void {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  const P = (u: number, v: number) => new THREE.Vector3(c[0] + dx * u, c[1] + v, c[2] + dz * u);
  const curve = new THREE.CubicBezierCurve3(
    P(0, h - 1.2),
    P(0, h + 0.1),
    P(arm * 0.35, h + 0.3),
    P(arm, h + 0.05),
  );
  b.geometry('pole', new THREE.TubeGeometry(curve, 16, 0.045, 8, false));
  const g = new THREE.BoxGeometry(0.28, 0.08, 0.62);
  g.rotateX(0.08);
  g.rotateY(yaw);
  const e = P(arm + 0.18, h - 0.02);
  g.translate(e.x, e.y, e.z);
  b.geometry('lampHead', g);
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
  paintKey?: (hex: string) => string,
  /** v9: ölçülen tonlu mat malzeme (çayır öbekleri) */
  matKey?: (hex: string) => string,
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
  // v8: dış bordürün yola bakan yüzü dönüşümlü boyalı (ölçüm kerb metni: "yeşil/beyaz dönüşümlü boyalı")
  const kp = kerbPaintOf(parts[0] ?? '', (s as { kerbPaint?: unknown }).kerbPaint);
  const run: PaintRun | null = kp && paintKey ? { spec: kp, k: 0, key: paintKey } : null;
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
    kerbStones(b, o0, o1, inward(o0, [tO[0] / lO, tO[1] / lO]), h, H, run);
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
  // Çevre yolu asfaltı: ada bordüründen çevre yolunun dış kenarına kadar. OSM göbek halkası (233456725, ~9.6 m)
  // yalnız r≈16.7–26'yı kaplıyor → r≈12–16.7 arasında hava fotoğrafı (bej + araç gölgesi) görünüyordu (critic
  // da3-00/01/02). Dış yarıçap: `ringOuter` (m, merkezden), yoksa ölçüm notundaki "r≈a–b" (küçüğü). OSM asfaltının
  // altında (+0.027, kaldırım dolgusuyla aynı), kaldırımlar üstte kalır.
  const ro =
    s.ringOuter ??
    (() => {
      const m = /r\s*≈\s*([0-9.]+)\s*(?:[–-]\s*([0-9.]+))?/.exec(s.note ?? '');
      return m ? Number(m[1]) : undefined;
    })();
  if (ro && ro > Math.max(RX, RZ) + 1) {
    const d = ro - (RX + RZ) / 2;
    b.drape(
      'roadFill',
      ring((k) => outerAt(-d, th(k))),
      [ring((k) => outerAt(-0.02, th(k))).reverse()],
      H,
      0.027,
      1,
      2,
    );
  }
  // Çim
  const top = h + innerH;
  const gt = `${s.grass?.material ?? ''}`.toLowerCase();
  const grassKey = !gt || /çim|grass|lawn/.test(gt) ? 'lawn' : layerKey(gt);
  const md = s.meadow;
  if (md) {
    // v9: biçilmiş kenar şeridi (rim, ton rimC: çim dokusu ölçülen tonla, index.ts lawn@ çeşidi) + biçilmemiş kuru
    // çayır iç kısım (ton c)
    const rim = Math.max(0.3, midOf(md.rim, 3));
    const rimT = toneOf(md.rimC);
    const inT = toneOf(md.c);
    const inner = (k: number) => {
      const a = th(k);
      return [
        c[0] + Math.cos(a) * Math.max(0.5, GX - rim),
        c[1] + Math.sin(a) * Math.max(0.5, GZ - rim),
      ] as V2;
    };
    b.drape(
      rimT ? `lawn@${rimT}` : grassKey,
      ring((k) => grassAt(0, th(k))),
      [ring(inner).reverse()],
      H,
      top,
      0.5,
      2.5,
    );
    // Kuru çayır: ölçülen tonda mat yüzey (çim dokusunun ton çarpanı yeşil dokuda pembe kayma veriyordu → düz ton).
    // KARAR: çayır boyu (h) çizilmez — öbek biçimi / sıklığı görülmedi; koni öbekler yapay görünüyordu
    const inK = inT && matKey ? matKey(inT) : inT ? `lawn@${inT}` : grassKey;
    b.drape(inK, ring(inner), [], H, top + 0.004, 0.5, 2.5);
  } else
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
  s: {
    id?: string;
    poly?: V2[];
    h?: number;
    material?: string;
    note?: string;
    kerbPaint?: unknown;
    grassC?: string | [string, string];
  },
  H: (x: number, z: number) => number,
  paintKey?: (hex: string) => string,
  /** Noktadan en yakın OSM araç şeridi kenarına uzaklık (m; StreetExt.roadEdge) — refüj çevresi asfalt dolgusu */
  roadEdge?: (x: number, z: number) => number,
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
  // v8: dönüşümlü boyalı bordür (malzeme metni / notu / kerbPaint; d4-median-m6 dar ayırıcı)
  const kp = kerbPaintOf(`${s.material ?? ''}; ${s.note ?? ''}`, s.kerbPaint);
  const run: PaintRun | null = kp && paintKey ? { spec: kp, k: 0, key: paintKey } : null;
  for (let i = 0; i < n; i++) kerbStones(b, r[i], r[(i + 1) % n], nor[i], h, H, run);
  // Yüzey: bordür içinden (köşe kesişimli içe kaydırma)
  let inset: V2[] = r.map((p, i) => {
    const n1 = nor[(i + n - 1) % n];
    const n2 = nor[i];
    const k = KERB_W / Math.max(0.3, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [p[0] + (n1[0] + n2[0]) * k, p[1] + (n1[1] + n2[1]) * k];
  });
  // v8: dar uçlarda (burun, 0.9 m ayırıcı) içe kaydırma kendini kesebilir → kesen/ters dönen halka yerine dış halka
  // (bordür taşları üstte kalır, dolgu taşların altında görünmez)
  if (selfCrosses(inset) || Math.sign(ringArea(inset)) !== Math.sign(ringArea(r))) inset = r;
  // Yüzey malzemesi: ölçülen `material` (yoksa not); kilit taşı önce (v8: "kiremit-kırmızı beton kilit taşı dar
  // orta ayırıcı" beton sayılıyordu, notta geçen "çim refüj biter" çim yapıyordu)
  const t = (s.material || s.note || '').toLowerCase();
  // KARAR: yüzey belirtilmemişse beton (ada üstü sert zemin); ölçülenlerin çoğu "bordürlü çim"
  const key = /kilit|paver|interlock/.test(t)
    ? layerKey(t)
    : /çim|grass/.test(t)
      ? 'lawn'
      : /beton|concrete/.test(t)
        ? 'spConcrete'
        : layerKey(t);
  // v9: ölçülen çim tonu (grassC) → çim dokusu o tonla (lawn@ çeşidi)
  const gT = key === 'lawn' ? toneOf(s.grassC) : null;
  b.drape(gT ? `lawn@${gT}` : key, inset, [], H, h, key === 'lawn' ? 0.5 : 1, 2);
  // v8 (D4 refüjleri): bordürle OSM şeridi arasına asfalt dolgu — OSM kaldırımı refüj kenarında kaldırılınca
  // (roads[] sidewalk none / ada bölgesi) aradaki şeritte hava fotoğrafı (açık gri-bej) görünüyordu. Yalnız refüj /
  // ayrım adası (meydan içi tarhlar değil); dolgu OSM yolunun altında (0.027 < 0.04), en çok 6 m.
  const tag = `${s.id ?? ''} ${s.material ?? ''}`.toLowerCase();
  if (roadEdge && /refüj|ayrım|ayırıcı|median|split/.test(tag))
    for (let i = 0; i < n; i++) {
      const a = r[i];
      const e = r[(i + 1) % n];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.2) continue;
      const out: V2 = [-nor[i][0], -nor[i][1]];
      const m: V2 = [(a[0] + e[0]) / 2 + out[0] * 0.3, (a[1] + e[1]) / 2 + out[1] * 0.3];
      const g = roadEdge(m[0], m[1]);
      if (!(g <= 6)) continue;
      const w = Math.min(6, Math.max(0.3, g + 0.6));
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      const A: V2 = [a[0] - t[0] * 0.3, a[1] - t[1] * 0.3];
      const E: V2 = [e[0] + t[0] * 0.3, e[1] + t[1] * 0.3];
      try {
        b.drape(
          'roadFill',
          [A, E, [E[0] + out[0] * w, E[1] + out[1] * w], [A[0] + out[0] * w, A[1] + out[1] * w]],
          [],
          H,
          0.027,
          1,
          2,
        );
      } catch {
        /* dejenere */
      }
    }
  return [{ poly: r, h }];
}

/** Noktanın halka kenarlarına en kısa uzaklığı */
function distToRing(r: V2[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const e = r[(i + 1) % r.length];
    const dx = e[0] - a[0];
    const dz = e[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return best;
}

function ringArea(r: V2[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
/** Halkanın bitişik olmayan kenarları kesişiyor mu */
function selfCrosses(r: V2[]): boolean {
  const n = r.length;
  const cross = (o: V2, a: V2, b2: V2) => (a[0] - o[0]) * (b2[1] - o[1]) - (a[1] - o[1]) * (b2[0] - o[0]);
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = r[i];
      const b2 = r[(i + 1) % n];
      const c = r[j];
      const d = r[(j + 1) % n];
      if (cross(a, b2, c) * cross(a, b2, d) < 0 && cross(c, d, a) * cross(c, d, b2) < 0) return true;
    }
  return false;
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
  headOnly = false,
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
  if (!headOnly) b.cylinder(poleK, [x, y - 0.1, z], R, (pedSign ? h + 0.68 : h - 0.05) + 0.1, 10);
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

/**
 * v8: diş biçimli pano (d4-ulu-board "diş biçimli ayaklı pano"): taç (iki tümsek, ortada çukur) + iki kök; merkez c,
 * yan yön ft, bakış fn, alt kot yb, en W, boy Hh, kalınlık d. KARAR: silüet oranı ölçülmedi → yaygın diş ikonu.
 */
function toothBoard(
  b: Builder,
  key: string,
  c: V2,
  ft: V2,
  fn: V2,
  yb: number,
  W: number,
  Hh: number,
  d: number,
): void {
  // Birim silüet: x −0.5..0.5 (en), y 0..1 (boy)
  const S: [number, number][] = [
    [-0.3, 0],
    [-0.4, 0.3],
    [-0.47, 0.55],
    [-0.5, 0.75],
    [-0.46, 0.9],
    [-0.34, 0.99],
    [-0.18, 0.97],
    [0, 0.9],
    [0.18, 0.97],
    [0.34, 0.99],
    [0.46, 0.9],
    [0.5, 0.75],
    [0.47, 0.55],
    [0.4, 0.3],
    [0.3, 0],
    [0.2, 0.05],
    [0.1, 0.3],
    [0, 0.36],
    [-0.1, 0.3],
    [-0.2, 0.05],
  ];
  const shape = new THREE.Shape(S.map(([x, y]) => new THREE.Vector2(x * W, y * Hh)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  // Yerel x → ft, y → yukarı, z → fn
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(ft[0], 0, ft[1]),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(fn[0], 0, fn[1]),
  );
  m.setPosition(c[0], yb, c[1]);
  g.applyMatrix4(m);
  b.geometry(key, g.index ? g.toNonIndexed() : g);
}

/**
 * v8: gönderdeki bayrak kumaşı (bayrak direği `flag` / not "Türk bayrağı"): 3:2, hafif dalgalı ızgara, iki yüz;
 * gönder tarafı direkte. KARAR: bayrak ölçüsü ölçülmedi → direk boyunun ~1/5'i en (8 m → 1.5 × 1.0 m); rüzgâr yönü
 * görülmedi → rot verilmişse o yöne, yoksa doğuya dalgalanır.
 */
function poleFlag(
  b: Builder,
  signFace: (sg: SignSpec) => string,
  x: number,
  yTop: number,
  z: number,
  type: string,
  fl: { color?: string; w?: number; h?: number; text?: string; fg?: string; font?: string },
  yaw: number,
  hasRot: boolean,
): void {
  const fw = fl.w ?? 1.5;
  const fh = fl.h ?? fw / 1.5;
  const dir: V2 = hasRot ? [Math.sin(yaw), -Math.cos(yaw)] : [1, 0];
  // v9: düz renk kumaş üstünde logo / yazı (`text`, `fg`): tabela yüzü (kumaş rengi zemin)
  const logo = type === 'plain' && typeof fl.text === 'string' && fl.text.trim() !== '';
  const key = signFace({
    text: logo ? fl.text! : '',
    bg: fl.color && /^#[0-9a-f]{6}$/i.test(fl.color) ? fl.color : '#d21f26',
    fg: logo && fl.fg && /^#[0-9a-f]{6}$/i.test(fl.fg) ? fl.fg : '#ffffff',
    border: null,
    font: logo ? (fl.font ?? 'sans') : 'sans',
    bold: true,
    lit: false,
    style: 'box',
    banner: logo ? null : type === 'tr' ? 'tr' : 'plain',
    w: fw,
    h: fh,
  });
  const NU = 8;
  const NV = 2;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const side: V2 = [-dir[1], dir[0]];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const wave = 0.08 * u * Math.sin(u * Math.PI * 2.2);
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      pos.push(
        x + dir[0] * (0.07 + u * fw) + side[0] * wave,
        yTop - fh + v * fh - u * 0.05,
        z + dir[1] * (0.07 + u * fw) + side[1] * wave,
      );
      uv.push(u, v);
    }
  }
  for (let i = 0; i < NU; i++)
    for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j;
      const c2 = a + NV + 1;
      idx.push(a, c2, c2 + 1, a, c2 + 1, a + 1);
    }
  for (const sgn of [1, -1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(sgn > 0 ? idx : idx.map((_, k) => idx[k - (k % 3) + (2 - (k % 3))]));
    g.computeVertexNormals();
    b.geometry(key, g);
  }
}

/**
 * Yazıyı cols × rows hücreye döker (kalın sans, hücre ızgarasını dolduracak kadar uzatılmış); satır başına dolu hücre
 * koşuları [c0, c1). DOM yoksa null.
 */
export function rasterText(
  text: string,
  cols: number,
  rows: number,
): { cols: number; rows: number; runs: [number, number][][] } | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  const SC = 4;
  cv.width = cols * SC;
  cv.height = rows * SC;
  const g = cv.getContext('2d');
  if (!g) return null;
  const F = 100;
  g.font = `bold ${F}px Arial, sans-serif`;
  const tw = Math.max(1, g.measureText(text).width);
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  g.save();
  g.scale((cv.width * 0.96) / tw, (cv.height * 0.96) / (F * 0.72));
  g.fillText(text, (tw * 0.02) / 0.96, F * 0.72 * 1.0);
  g.restore();
  const img = g.getImageData(0, 0, cv.width, cv.height).data;
  const runs: [number, number][][] = [];
  for (let r = 0; r < rows; r++) {
    const row: [number, number][] = [];
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      let on = false;
      if (c < cols) {
        let a = 0;
        for (let yy = 0; yy < SC; yy++)
          for (let xx = 0; xx < SC; xx++) a += img[((r * SC + yy) * cv.width + c * SC + xx) * 4 + 3];
        on = a / (SC * SC) > 110;
      }
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        row.push([start, c]);
        start = -1;
      }
    }
    runs.push(row);
  }
  return runs.some((r) => r.length) ? { cols, rows, runs } : null;
}

/** v8: yola boyalı işaret (street-plan `road-symbol`) */
interface RoadSymbol {
  x: number;
  z: number;
  /** Sürüş yönü (pusula) */
  rot?: number;
  /** Şerit enine genişlik (m) ve sürüş yönünde boy (m) */
  w?: number;
  d?: number;
  symbol?: string;
  /** Yazı (symbol "text"); null = aşınmış, okunamadı */
  text?: string | null;
  color?: string;
  border?: string;
  wear?: number;
  note?: string;
}

/**
 * Yola boyalı işaretler (d4r-*): `symbol` arrow-straight (düz ok), signal-triangle (kırmızı kenarlı üçgende üç
 * renkli disk, tepe ileride), giveway-triangle (ters "yol ver" üçgeni, sivri ucu gelen trafiğe), text (uzatılmış
 * harfler; `text` null → okunamayan aşınmış yazı: harf yerine düzensiz boya parçaları — harf uydurulmaz); symbol
 * yoksa trafik ışığı piktogramı dokusu (d4-mark-signal-465). `wear` 0..1 boya kaybı (yol boyası aşınma kademeleri).
 * KARAR: ok başı / gövde oranı ölçülmedi → baş eni w, gövde 0.35 w, baş boyu min(0.3 d, 1.6 m); üçgen kenar bandı
 * 0.12 m; disk tonları nottaki renk sözcüklerinden (streetKinds.wordTone).
 */
function roadSymbol(
  b: Builder,
  s: RoadSymbol,
  H: (x: number, z: number) => number,
  paintKeyOf: (hex: string | undefined, wear: number | undefined) => string,
  signFace?: (sg: SignSpec) => string,
): void {
  const yaw = ((s.rot ?? 0) * Math.PI) / 180;
  const fwd: V2 = [Math.sin(yaw), -Math.cos(yaw)];
  const acr: V2 = [-fwd[1], fwd[0]];
  const W = s.w ?? 1;
  const D = s.d ?? 2.4;
  const Q = (a: number, e: number): V2 => [s.x + acr[0] * a + fwd[0] * e, s.z + acr[1] * a + fwd[1] * e];
  const paint = paintKeyOf(s.color, s.wear);
  const poly = (key: string, pts: [number, number][], off: number) =>
    b.drape(
      key,
      pts.map(([a, e]) => Q(a, e)),
      [],
      H,
      off,
      1,
      2,
    );
  const tri = (apexFar: boolean, inset: number): [number, number][] => {
    // Taban eni W, boy D; içe kaydırma: kenarlardan `inset` (yaklaşık, benzer üçgen)
    const k = Math.max(0.1, 1 - (inset * 3) / Math.min(W, D));
    const w2 = (W / 2) * k;
    const d2 = (D / 2) * k;
    return apexFar
      ? [
          [-w2, -d2],
          [w2, -d2],
          [0, d2],
        ]
      : [
          [-w2, d2],
          [0, -d2],
          [w2, d2],
        ];
  };
  const hexOk = (h?: string) => !!h && /^#[0-9a-f]{6}$/i.test(h);
  switch (s.symbol) {
    case 'arrow-straight': {
      const sw = W * 0.35;
      const hl = Math.min(D * 0.3, 1.6);
      poly(
        paint,
        [
          [-sw / 2, -D / 2],
          [sw / 2, -D / 2],
          [sw / 2, D / 2 - hl],
          [W / 2, D / 2 - hl],
          [0, D / 2],
          [-W / 2, D / 2 - hl],
          [-sw / 2, D / 2 - hl],
        ],
        0.053,
      );
      return;
    }
    case 'signal-triangle':
    case 'giveway-triangle': {
      const far = s.symbol === 'signal-triangle';
      if (hexOk(s.border)) poly(paintKeyOf(s.border, s.wear), tri(far, 0), 0.052);
      poly(paint, tri(far, hexOk(s.border) ? 0.12 : 0), 0.054);
      if (far) {
        const note = (s.note ?? '').toLocaleLowerCase('tr');
        const r = Math.min(W * 0.11, D * 0.08);
        // Kırmızı en ileride (üstte), yeşil en yakında
        const cols = [
          ['yeşil', wordTone('yeşil')],
          ['sarı', wordTone('sarı')],
          ['kırmızı', hexOk(s.border) ? s.border! : wordTone('kırmızı')],
        ];
        if (/kırmızı|sarı|yeşil|üç renk/.test(note))
          cols.forEach(([, hex], k) => {
            const e = -D / 2 + D * (0.2 + k * 0.2);
            const ring: [number, number][] = Array.from({ length: 14 }, (_, q) => {
              const a = (q / 14) * Math.PI * 2;
              return [Math.cos(a) * r, e + Math.sin(a) * r];
            });
            poly(paintKeyOf(hex ?? undefined, s.wear), ring, 0.056);
          });
      }
      return;
    }
    case 'text': {
      // Okunan yazı: yol boyasıyla (aşınma kademeli) — harfler tuvalde çizilip hücre ızgarasına dökülür, sürüş
      // yönünde uzatılmış (D boyunca), her satır dolu hücre koşusu bir boya dörtgeni. KARAR: tabela atlası (saydam
      // harf yüzü) yol düzleminde görünmüyordu (render w5-pick3: yüz yerinde, doku boş) → boya geometrisi; DOM yoksa
      // (birim test / worker) atlas yüzü.
      const cells = s.text ? rasterText(s.text, 24, 64) : null;
      if (cells) {
        const cw = W / cells.cols;
        const ch = D / cells.rows;
        for (let r = 0; r < cells.rows; r++)
          for (const [c0, c1] of cells.runs[r]) {
            const e1 = D / 2 - r * ch;
            poly(
              paint,
              [
                [-W / 2 + c0 * cw, e1 - ch],
                [-W / 2 + c1 * cw, e1 - ch],
                [-W / 2 + c1 * cw, e1],
                [-W / 2 + c0 * cw, e1],
              ],
              0.054,
            );
          }
        return;
      }
      if (s.text && signFace) {
        const key = signFace({
          text: s.text,
          bg: null,
          fg: hexOk(s.color) ? s.color! : '#e8e8e4',
          border: null,
          font: 'sans',
          bold: true,
          lit: false,
          style: 'letters',
          w: W,
          h: D,
        });
        const o0 = Q(-W / 2, -D / 2);
        b.drape(
          key,
          [Q(-W / 2, -D / 2), Q(W / 2, -D / 2), Q(W / 2, D / 2), Q(-W / 2, D / 2)],
          [],
          H,
          0.054,
          1,
          2,
          {
            o: o0,
            t: [acr[0] / W, acr[1] / W],
            n: [fwd[0] / D, fwd[1] / D],
          },
        );
        return;
      }
      // Okunamayan aşınmış yazı: satır başına düzensiz kısa boya parçaları (tohum: konum), en az %60 aşınma
      const rows = /iki satır/.test((s.note ?? '').toLocaleLowerCase('tr')) ? 2 : 1;
      const worn = paintKeyOf(s.color, Math.max(0.6, s.wear ?? 0.6));
      let seed = (Math.abs(Math.round(s.x * 131 + s.z * 17)) % 2147483646) + 1;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let r = 0; r < rows; r++) {
        const rh = (D / rows) * 0.72;
        const e0 = D / 2 - (D / rows) * (r + 0.5) - rh / 2;
        const gw = rh * 0.55;
        const n = Math.max(1, Math.floor((W * 0.9) / (gw * 1.25)));
        for (let g = 0; g < n; g++) {
          const a0 = -W * 0.45 + g * gw * 1.25;
          const bars = 2 + Math.floor(rnd() * 2);
          for (let k = 0; k < bars; k++) {
            const vert = rnd() < 0.6;
            const bw = rh * 0.14;
            const u = a0 + rnd() * (gw - bw);
            const v = e0 + rnd() * (rh - bw);
            poly(
              worn,
              vert
                ? [
                    [u, e0],
                    [u + bw, e0],
                    [u + bw, e0 + rh],
                    [u, e0 + rh],
                  ]
                : [
                    [a0, v],
                    [a0 + gw, v],
                    [a0 + gw, v + bw],
                    [a0, v + bw],
                  ],
              0.053,
            );
          }
        }
      }
      return;
    }
  }
  // Varsayılan: trafik ışığı piktogramı dokusu (uzun ekseni uzun kenara)
  const o0 = Q(-W / 2, -D / 2);
  const long = W > D;
  b.drape(
    'roadSignalPicto',
    [Q(-W / 2, -D / 2), Q(W / 2, -D / 2), Q(W / 2, D / 2), Q(-W / 2, D / 2)],
    [],
    H,
    0.053,
    1,
    2,
    {
      o: o0,
      t: long ? [fwd[0] / D, fwd[1] / D] : [acr[0] / W, acr[1] / W],
      n: long ? [acr[0] / W, acr[1] / W] : [fwd[0] / D, fwd[1] / D],
    },
  );
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
    /** Pano başına ölçülen içerik (sıra: hat başından): zemin, çerçeve, okunan yazı satırları, renk blokları */
    faces?: BoardFace[];
  },
  H: (x: number, z: number) => number,
  roadCentre: (x: number, z: number) => number,
  colorKey: ((kind: 'frame', hex: string) => string) | undefined,
  collide: Collide | undefined,
  signFace?: (sg: SignSpec) => string,
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
    const face = s.faces?.[k];
    b.wall(
      face && signFace
        ? signFace({
            text: '',
            lines: (face.lines ?? []).map((l) => ({ ...l, fg: l.fg ?? '#f0f0f0' })),
            bg: face.bg ?? '#dcdad4',
            fg: '#f0f0f0',
            border: face.border ?? null,
            font: face.font ?? 'sans',
            bold: face.bold !== false,
            lit: false,
            style: 'box',
            w: 2 * fw,
            h: Hh - 0.12,
            blocks: face.blocks ?? null,
          })
        : 'billboardFace',
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
export function streetSignTexture(
  kind: 'keepRight' | 'chevron' | 'pedestrian' | 'busStop' | 'signalPicto',
): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const S = 256;
  const Wc = kind === 'chevron' ? 384 : kind === 'signalPicto' ? 108 : S;
  const cv = document.createElement('canvas');
  cv.width = Wc;
  cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, Wc, S);
  if (kind === 'signalPicto') {
    // v8: yola boyalı trafik ışığı piktogramı (d4-mark-signal-465, 1Re88FdQ_240_0): kırmızı çerçeveli beyaz
    // dikdörtgen içinde kırmızı-sarı-yeşil üç daire; doku y ekseni sürüş yönü (üst = ileri: kırmızı en uzakta)
    g.fillStyle = '#c42a24';
    g.fillRect(0, 0, Wc, S);
    g.fillStyle = '#ecebe6';
    g.fillRect(9, 9, Wc - 18, S - 18);
    const cols = ['#c42a24', '#e0b12a', '#2f8a4a'];
    for (let k = 0; k < 3; k++) {
      g.fillStyle = cols[k];
      g.beginPath();
      g.arc(Wc / 2, S * (0.2 + k * 0.3), Wc * 0.3, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'busStop') {
    // v8: otobüs durağı bilgi levhası — KARAR: levha içeriği okunmadı (d4-um-busstop-pole) → Türkiye bilgi levhası
    // düzeni: mavi kare, beyaz çerçeve, beyaz otobüs silueti (hat numarası / yazı çizilmez)
    g.fillStyle = '#1f4ea8';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#f7f7f5';
    g.lineWidth = 8;
    g.strokeRect(14, 14, S - 28, S - 28);
    g.fillStyle = '#f7f7f5';
    g.beginPath();
    g.roundRect(46, 70, 164, 104, 14);
    g.fill();
    g.fillStyle = '#1f4ea8';
    for (let k = 0; k < 3; k++) g.fillRect(60 + k * 48, 84, 38, 36);
    g.fillRect(56, 132, 144, 6);
    g.fillStyle = '#f7f7f5';
    for (const x of [82, 174]) {
      g.beginPath();
      g.arc(x, 182, 16, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#1f4ea8';
    for (const x of [82, 174]) {
      g.beginPath();
      g.arc(x, 182, 7, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'keepRight') {
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

/** buildStreetPlan ek seçenekleri */
export interface StreetExt {
  /** Tabela yüzü (index.ts tabela atlası) */
  signFace?: (sg: SignSpec) => string;
  /** `paint`: v8 bordür boyası (polygonOffset'li düz boya, yüzün 2 mm önünde) */
  colorKey?: (
    kind: CK | 'asphalt' | 'tar' | 'wear1' | 'wear2' | 'wear3' | 'paint' | 'encglass' | 'interior',
    hex: string,
  ) => string;
  /** Yüksek/Ultra kalite: bordür taşı üst kenar pahı (m, 0 = yok) */
  bevel?: number;
  /** Çarpışma halkası (x/z çokgen, alt–üst kot) */
  collide?: Collide;
  /** Noktadan en yakın OSM yol şeridi KENARINA uzaklık (m); asfalt dolgusunun genişliği için */
  roadEdge?: (x: number, z: number) => number;
}

export function buildStreetPlan(
  b: Builder,
  plan: StreetPlan,
  H: (x: number, z: number) => number,
  roadCentre: (x: number, z: number) => number,
  ext: StreetExt = {},
): StreetResult {
  KERB_BEV = Math.max(0, Math.min(0.03, ext.bevel ?? 0));
  try {
    return buildStreet(b, plan, H, roadCentre, ext);
  } finally {
    KERB_BEV = 0;
  }
}

function buildStreet(
  b: Builder,
  plan: StreetPlan,
  H: (x: number, z: number) => number,
  roadCentre: (x: number, z: number) => number,
  ext: StreetExt,
): StreetResult {
  const raised: StreetResult['raised'] = [];
  /** v7: tüm kaldırım bantları (alçak / bordürsüz dahil) — öğe ve çit tabanı kotu için */
  const lowBands: StreetResult['raised'] = [];
  const polys: V2[][] = [];
  const paintKey = ext.colorKey ? (hex: string) => ext.colorKey!('paint', hex) : undefined;
  for (const sw of plan.sidewalks ?? []) {
    const pts = sw.pts;
    if (!pts || pts.length < 2) continue;
    const kerbH = sw.kerbH ?? 0.15;
    const lay = layoutOf(sw);
    // v8: dönüşümlü (yeşil / beyaz) bordür boyası — dış bordür + ara bordürler (yol kotundaki park şeridinin
    // arkasındaki bordür dahil); taş sayacı hat boyunca sürekli
    const kp = kerbPaintOf(sw.material, sw.kerbPaint);
    const runs = new Map<number, PaintRun>();
    const runAt = (v: number): PaintRun | null => {
      if (!kp || !paintKey) return null;
      const k = Math.round(v * 100);
      let r = runs.get(k);
      if (!r) runs.set(k, (r = { spec: kp, k: 0, key: paintKey }));
      return r;
    };
    // Bordürden yola doğru asfalt dolgusu genişliği: OSM şeridi bordürden uzaksa (kavşak köşe kavisleri, OSM ekseni
    // gerçek yoldan kaymış) şeride kadar uzar — yoksa aradaki üçgende hava fotoğrafı (bej) görünüyordu (502/Doğan
    // Avcıoğlu köşesi). KARAR: en az 3 m, en çok 10 m; yakında (10 m) OSM yolu yoksa 3 m (otopark/site yolu).
    const fillW = (x: number, z: number) => {
      const g = ext.roadEdge?.(x, z) ?? 0;
      return g <= 10 ? Math.min(10, Math.max(3, g + 0.6)) : 3;
    };
    // Köşe noktalarında asfalt dolgu diski (parçaların dış köşede bıraktığı kama boşlukları; kaldırım üstte kalır)
    for (let i = 1; i + 1 < pts.length; i++) {
      const c = pts[i];
      const r = fillW(c[0], c[1]);
      const ring: V2[] = [];
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        ring.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
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
      const extU = 0.08;
      // Şerit yerel UV'si: u yol boyunca (parçalar arası sürekli: s0), v bandın iç kenarından
      const strip = (v0: number, v1: number, key: string, off: number) => {
        const ring: V2[] = [q(-extU, v0), q(L + extU, v0), q(L + extU, v1), q(-extU, v1)];
        const o0 = q(-sPrev, v0);
        b.drape(key, ring, [], H, off, 1, 2, { o: o0, t, n });
        return ring;
      };
      for (const bd of lay.bands) {
        strip(bd.v0, bd.v1, bd.key, bandDrapeY(bd.h));
        if (bd.h > 0.06) raised.push({ poly: [q(0, bd.v0), q(L, bd.v0), q(L, bd.v1), q(0, bd.v1)], h: bd.h });
        else lowBands.push({ poly: [q(0, bd.v0), q(L, bd.v0), q(L, bd.v1), q(0, bd.v1)], h: bd.h });
      }
      // Bordür yüzünden `off` m yolda sürekli kenar çizgisi (ölçüm edgeLine; OSM kenar çizgisi kaldırım bandının altında
      // kalıyordu — critic A8)
      const el = (sw as { edgeLine?: { off?: number; w?: number; color?: string } }).edgeLine;
      if (el && (el.off ?? 0) >= 0) {
        const ew = Math.max(0.05, Math.min(0.4, el.w ?? 0.12));
        const eo = el.off ?? 0.4;
        const ek =
          el.color && /^#[0-9a-f]{6}$/i.test(el.color) && ext.colorKey
            ? ext.colorKey('asphalt', el.color)
            : 'spPaint';
        strip(-eo - ew / 2, -eo + ew / 2, ek, 0.052);
      }
      const top = lay.bands.length ? lay.bands[lay.bands.length - 1].h : kerbH;
      if (lay.tactile && lay.tactile[0] > 0.3)
        strip(
          lay.tactile[0] - lay.tactile[1] / 2,
          lay.tactile[0] + lay.tactile[1] / 2,
          tactileKey(sw.tactileTint),
          top + 0.006,
        );
      // Bordür taşları (≈0.72 m birim, yola bakan yüz dahil): yol kenarında + ara bordürler
      const kerbLine = (v: number, kh: number) => {
        if (kh < 0.05) return;
        const nS = Math.max(1, Math.round(L / KERB_UNIT));
        const run = runAt(v);
        for (let k = 0; k < nS; k++) {
          const u0 = (L * k) / nS;
          const u1 = (L * (k + 1)) / nS;
          if (run) paintStone(b, run, q(u0, v), q(u1 - 0.006, v), n, kh, H);
          const c = q((u0 + u1) / 2, v + KERB_W / 2);
          const y = H(c[0], c[1]);
          if (KERB_BEV > 0)
            b.bevelBox(
              'curb',
              [c[0], y + kh / 2 - 0.05, c[1]],
              [u1 - u0 - 0.006, kh + 0.1, KERB_W],
              Math.atan2(-t[1], t[0]),
              KERB_BEV,
            );
          else
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
      // Beyaz boyalı bordür (ölçüm: kerbPaint "white" — 502. Sk. batı, bisiklet şeridi kenarı; yer fotoğrafı
      // ref-01.jpg düzeltilmiş üst görünüşte üstün iç ~7 cm'i gri, dışı + yuvarlak kenar + yol yüzü beyaz;
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
      // KARAR: yer fotoğrafı (502. Sk.) mavi şeridi açıkça gösteriyor → varsayılan açık (?nobike kapatır).
      // Bordür dibinde ince beyaz çizgi + dış kenarda sürekli beyaz çizgi (12 cm).
      if (lay.bike && SHOW_BIKE) {
        strip(-lay.bike, 0, 'spBike', 0.075);
        strip(-lay.bike, -lay.bike + 0.12, 'spPaint', 0.08);
        if (!paintKerb) strip(-0.1, 0, 'spPaint', 0.08);
      }
      // Bordürle OSM asfaltı arası boşluk kalmasın: yol tarafına asfalt dolgu (OSM yolunun altında kalır)
      const fw = Math.max(fillW(a[0], a[1]), fillW(e[0], e[1]), fillW((a[0] + e[0]) / 2, (a[1] + e[1]) / 2));
      strip(-fw, 0.02, 'roadFill', 0.028);
      const full: V2[] = [q(0, 0), q(L, 0), q(L, sw.w), q(0, sw.w)];
      polys.push(full);
    }
  }
  // Kavşak adası + ayrım adaları önce: üstlerindeki lamba/ışık/levhalar ada kotunda dursun
  const isl: Raised[] = [];
  const rbs: RoundaboutGeo[] = [];
  for (const s of plan.street ?? []) {
    if (s.kind === 'roundabout-island') {
      const r = roundaboutIsland(
        b,
        s as unknown as RoundaboutSpec,
        H,
        paintKey,
        ext.colorKey ? (hex) => ext.colorKey!('interior', hex) : undefined,
      );
      isl.push(...r.raised);
      rbs.push(r.geo);
    } else if (s.kind === 'island')
      isl.push(...splitterIsland(b, s as unknown as { poly?: V2[] }, H, paintKey, ext.roadEdge));
  }
  /** Noktadaki ada kotu (en yüksek), yoksa kaldırım kotu */
  const walkAt = (x: number, z: number) => {
    let best: Raised | undefined;
    for (const r of isl) if (inside(r.poly, x, z) && (!best || r.h > best.h)) best = r;
    // v7: alçak (bordürsüz) bantlar da — önceden bu noktalarda +0.15 varsayılıyordu (çit / lamba havada)
    return best ?? raised.find((r) => inside(r.poly, x, z)) ?? lowBands.find((r) => inside(r.poly, x, z));
  };
  /** v7: öğe tabanı kotu (arazinin üstünde): ölçülen `base` > yürüme yüzeyi > +0.15 (eski varsayılan) */
  const walkH = (x: number, z: number, base?: unknown) =>
    typeof base === 'number' && Number.isFinite(base) ? base : (walkAt(x, z)?.h ?? 0.15);
  /**
   * Yüzeye gömülü kapak (rögar, ızgara) kotu: ölçülen `base` > bulunduğu kaldırım / ada bandı + 1.2 cm > yol.
   * Önceden +0.045 / +0.035 sabitti: OSM asfaltı +0.04 (kirişte +0.043'e kadar), kaldırım +0.15 → görünmüyordu
   * (critic A9). Yolda çizgilerin (+0.05) ve bisiklet şeridinin (+0.075/0.08, not "bisiklet") üstünde.
   */
  const flushY = (x: number, z: number, base: unknown, note: string) => {
    if (typeof base === 'number' && Number.isFinite(base)) return base + 0.012;
    const w = walkAt(x, z);
    if (w) return w.h + 0.012;
    return /bisiklet|bike/.test(note) ? ROAD_FLUSH_BIKE : ROAD_FLUSH;
  };
  /** Rögar / ızgara malzemesi: ölçülen renk (dökme demir, yarı mat) ya da koyu metal */
  // KARAR: kapaklar yol ayrıntısı malzemesiyle (colorKey 'tar': polygonOffset −8, yol boyasıyla aynı) — ayrıntı
  // yamaları (−6) ve OSM asfaltı sığ bakışta polygonOffset ile kapağın önüne geçiyordu (render da1-13: kapak yok)
  const coverKey = (hex?: string) =>
    ext.colorKey ? ext.colorKey('tar', hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#3a3a38') : 'darkMetal';
  /**
   * Kapağın çevresindeki açık beton halka / çerçeve (ölçüm notu "beton halka" / "beton çerçeve"): 0.2 m bant.
   * r verilirse yuvarlak halka, yoksa w × d dikdörtgen çerçeve (yaw sokak öğesininki).
   */
  let frameYaw = 0;
  const coverFrame = (x: number, z: number, y: number, r: number | null, w: number, d: number) => {
    const B = 0.2;
    if (r != null) {
      const g = new THREE.RingGeometry(r - 0.01, r + B, 24, 1).rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      b.geometry('spConcrete', g);
      return;
    }
    for (const [cx, cz, ww, dd] of [
      [0, -(d + B) / 2, w + 2 * B, B],
      [0, (d + B) / 2, w + 2 * B, B],
      [-(w + B) / 2, 0, B, d],
      [(w + B) / 2, 0, B, d],
    ]) {
      const g = new THREE.PlaneGeometry(ww, dd)
        .rotateX(-Math.PI / 2)
        .translate(cx, 0, cz)
        .rotateY(frameYaw);
      g.translate(x, y, z);
      b.geometry('spConcrete', g);
    }
  };
  /** Yol boyası: renk (verilmezse beyaz spPaint) + aşınma 0..1 (gürültü alfa, kademe 1–3) */
  const paintKeyOf = (hex: string | undefined, wear: number | undefined) => {
    const wl = Math.min(3, Math.round(Math.max(0, Math.min(1, wear ?? 0)) * 4));
    const col = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : null;
    if (!col || !ext.colorKey) return wl > 0 ? `spPaintWear${wl}` : 'spPaint';
    // colorKey `wear<k>` alfa eşiği [0.62, 0.5, 0.38] (k = örtülen pay); boyanın `wear` kadarı eksik → k = 4 − wl
    return wl > 0 ? ext.colorKey(`wear${4 - wl}` as 'wear1', col) : ext.colorKey('asphalt', col);
  };
  const furn = {
    b,
    H,
    walk: (x: number, z: number) => walkH(x, z),
    colorKey: ext.colorKey as ((kind: CK | 'encglass' | 'interior', hex: string) => string) | undefined,
    signFace: ext.signFace,
    collide: ext.collide,
    toRoad: (x: number, z: number) => towardRoad(roadCentre, x, z),
  };
  // v8: geçide bağlı aşınma kayıtları (kind wear + crossing id)
  const crossingWear = new Map<string, number>();
  for (const s of plan.street ?? []) {
    const q = s as { kind: string; crossing?: string; amount?: number };
    if (q.kind === 'wear' && q.crossing)
      crossingWear.set(q.crossing, Math.max(0, Math.min(1, q.amount ?? 0.5)));
  }
  // Sokak eşyası
  for (const s of plan.street ?? []) {
    const g0 = H(s.x, s.z);
    const sb = (s as { base?: number }).base;
    const wh = walkH(s.x, s.z, sb);
    const y = g0 + wh;
    // v7: restoran önü / sokak eşyası türleri (streetFurniture.ts); base ölçülmüşse onun kotunda
    if (buildStreetFurniture({ ...furn, walk: (x, z) => walkH(x, z, sb) }, s as unknown as StreetItem))
      continue;
    const note = `${s.text ?? ''} ${s.note ?? ''}`.toLowerCase();
    const yaw = ((s.rot ?? 0) * Math.PI) / 180;
    frameYaw = yaw;
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
        const lp = s as { style?: string; arm?: number; arms?: number; color?: string };
        const arm = Math.max(0.4, Math.min(4, lp.arm ?? 1.6));
        // v7: `style` "swan" (kuğu boynu: direk tepesinde yukarı-dışa kıvrılıp yola eğilen kol, LED armatür;
        // Özlüce kavşağı, critic A11) — verilmezse nottaki "kuğu boynu" / "swan"; `arms` 2 → karşılıklı çift kol
        // ("çift kollu"). Düz kol (varsayılan) eskisi gibi.
        const swan = lp.style ? lp.style === 'swan' : /kuğu boynu|swan/.test(note);
        const nArms = lp.arms ?? (/çift kollu|double arm/.test(note) ? 2 : 1);
        if (swan) {
          for (let k = 0; k < Math.max(1, Math.min(2, nArms)); k++)
            swanArm(b, [s.x, y, s.z], h, arm, k ? ay + Math.PI : ay);
        } else {
          b.box('pole', [s.x + dx * (arm / 2), y + h - 0.2, s.z + dz * (arm / 2)], [0.06, 0.06, arm], ay);
          b.box('lampHead', [s.x + dx * arm, y + h - 0.3, s.z + dz * arm], [0.3, 0.12, 0.65], ay);
        }
        break;
      }
      case 'pole': {
        const fl = (
          s as {
            flag?: {
              type?: string;
              color?: string;
              w?: number;
              h?: number;
              rot?: number;
              text?: string;
              fg?: string;
              font?: string;
            };
          }
        ).flag;
        // v8: bayrak direği — `flag` {type: "tr" | color, w, h, rot} ya da notun ilk ifadesinde "Türk bayrağı";
        // deseni seçilemeyen bayrak (ör. "mavi-beyaz kurumsal — deseni seçilemedi") çizilmez
        const head = note.split(/[;:]/)[0];
        const flagType =
          fl?.type ??
          (fl?.color ? 'plain' : /türk bayrağı/.test(head) && !/seçilemedi/.test(head) ? 'tr' : null);
        const isFlagPole = !!flagType || /bayrak direğ/.test(note);
        const ph = s.h ?? 7;
        b.cylinder(
          /beton|concrete/.test(note) ? 'concretePole' : isFlagPole ? 'steel' : 'pole',
          [s.x, y - 0.1, s.z],
          isFlagPole ? 0.06 : 0.11,
          ph,
          10,
        );
        if (isFlagPole) b.sphere('steel', [s.x, y + ph - 0.05, s.z], 0.08, 10);
        if (flagType && ext.signFace)
          poleFlag(
            b,
            ext.signFace,
            s.x,
            y + ph - 0.15,
            s.z,
            flagType,
            fl ?? {},
            yaw,
            s.rot != null || fl?.rot != null,
          );
        break;
      }
      case 'sign': {
        const h = s.h ?? 2.6;
        // Levha türleri (yukarıdan aşağı); duvar/kapı levhaları (h < 1.5) direksiz. Önce levha metninden (text), metin
        // bir tür vermezse metin + nottan (eski kayıtlar); `textB` arka yüzün kendi levhaları (verilmezse gri arka)
        const tx = (s.text ?? '').toLowerCase();
        const keys = [...(signKeysOf(tx).length ? signKeysOf(tx) : signKeysOf(note)), ...signTextKeys(tx)];
        const backKeys = signKeysOf(((s as { textB?: string }).textB ?? '').toLowerCase());
        if (!keys.length) break; // yazılı tabelalar (site adı vb.) ayrıca
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const small = h < 1.5;
        const hw = small ? 0.16 : 0.33;
        if (!small) b.cylinder('pole', [s.x, y - 0.05, s.z], 0.035, h, 8);
        let top = small ? y + h + 0.2 : y + h - 0.04;
        // Levha direğin ÖNÜNDE (yüz normali (sin, cos) yönünde direk yarıçapı + 1.5 cm): önceden levha direk ekseninde
        // çiziliyordu → direk levha yüzünün önünden geçiyordu (critic M2 #5, KD ada bisiklet levhası)
        const fo = small ? 0 : 0.05;
        const fx = si * fo;
        const fz = co * fo;
        const plateH = (key: string) =>
          // KARAR: chevron levhası ölçülmedi → 3:2 dikdörtgen (0.66 × 0.44); ek levha 0.66 × 0.33 (TS 7249 oranı)
          small ? 0.42 : key === 'signChevron' ? 0.44 : key === 'signArrowPlate' ? 0.33 : 0.66;
        const top0 = top;
        for (const key of keys) {
          const A: V2 = [s.x - co * hw + fx, s.z + si * hw + fz];
          const E: V2 = [s.x + co * hw + fx, s.z - si * hw + fz];
          const ph = plateH(key);
          b.wall(key, A, E, top - ph, top);
          if (!backKeys.length) b.wall(`${key}Back`, E, A, top - ph, top);
          top -= ph + 0.04;
        }
        if (backKeys.length) {
          // İki yüzlü levha: arka yüzde kendi levhaları (üstten), ön yüzün arkası; ön yüzden 1 cm geride
          const bx = -si * 0.01;
          const bz = -co * 0.01;
          let tb = top0;
          const nFront = keys.reduce((a, k) => a + plateH(k) + 0.04, 0);
          for (const key of backKeys) {
            const A: V2 = [s.x - co * hw + fx + bx, s.z + si * hw + fz + bz];
            const E: V2 = [s.x + co * hw + fx + bx, s.z - si * hw + fz + bz];
            const ph = plateH(key);
            b.wall(key, E, A, tb - ph, tb);
            tb -= ph + 0.04;
          }
          // Ön yüzde olup arkada karşılığı olmayan kısım gri arka
          if (top0 - tb < nFront - 0.01) {
            const A: V2 = [s.x - co * hw + fx + bx, s.z + si * hw + fz + bz];
            const E: V2 = [s.x + co * hw + fx + bx, s.z - si * hw + fz + bz];
            b.wall('signPBack', E, A, top0 - nFront + 0.04, tb);
          }
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
          /** Renk blokları (fotoğraf/afiş tonları, 0..1 soldan/alttan) — içerik çizilmez */
          blocks?: { x0: number; x1: number; y0: number; y1: number; color: string }[];
          /** Panonun altında dolu kaide (alçak duvar): h (m), renk */
          base?: { h?: number; color?: string };
          /** Yüzün bir ucunda üçgen ok (sokak adı levhası): side left | right (yüze bakınca), renk */
          arrow?: { side?: string; color?: string };
          /** Direk tepesinde yatay kolda güvenlik kameraları: n, kol kotu h (m, zeminden), renk */
          cctv?: { n?: number; h?: number; color?: string };
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
        // `poles: 0`: duvara/alın üstüne oturan pano (direksiz)
        const pu = np === 0 ? [] : np === 1 ? [0] : [-W / 2 + 0.08, W / 2 - 0.08];
        const both = (s as { faces?: number }).faces === 2 || /çift yüzlü|iki yüz(ü|lü)/.test(note);
        const tooth = (s as { outline?: string }).outline === 'tooth' || /diş biçimli/.test(note);
        for (const u of pu) {
          // Çift yüzlüde ayak panonun altında (arka yüzü örtmesin)
          const p = at(u, both ? 0 : -d / 2 - 0.05);
          b.cylinder(poleK, [p[0], g0 - 0.05, p[1]], 0.05, yb - g0 + (both ? 0.1 : Hh + 0.05), 8);
        }
        const c = at(0, 0);
        const yawB = Math.atan2(-ft[1], ft[0]);
        const sideK = bo.bg && ext.colorKey ? ext.colorKey('fascia', bo.border ?? bo.bg) : 'pole';
        // v8: çift yüzlü pano (`faces: 2` ya da not "çift yüzlü"): arka yüz de aynı içerik (orta refüj "raket"
        // panoları); `outline: "tooth"` / not "diş biçimli": diş silueti (dikdörtgen yerine)
        if (tooth) {
          toothBoard(
            b,
            bo.bg && ext.colorKey ? ext.colorKey('fascia', bo.bg) : 'pole',
            c,
            ft,
            fn,
            yb,
            W,
            Hh,
            d,
          );
          if (ext.signFace) {
            // Yazı tacın içinde (üst %60, en %80)
            const key = ext.signFace({
              text: bo.text ?? '',
              lines: bo.lines ?? null,
              bg: bo.bg ?? null,
              fg: bo.fg ?? '#ffffff',
              border: null,
              font: bo.font ?? 'sans',
              bold: bo.bold !== false,
              lit: !!bo.lit,
              style: 'box',
              w: W * 0.72,
              h: Hh * 0.5,
            });
            b.wall(
              key,
              at(-W * 0.36, d / 2 + 0.006),
              at(W * 0.36, d / 2 + 0.006),
              yb + Hh * 0.38,
              yb + Hh * 0.88,
              [0, 0, 1, 1],
            );
            if (both)
              b.wall(
                key,
                at(W * 0.36, -d / 2 - 0.006),
                at(-W * 0.36, -d / 2 - 0.006),
                yb + Hh * 0.38,
                yb + Hh * 0.88,
                [0, 0, 1, 1],
              );
          }
          break;
        }
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
            blocks: bo.blocks ?? null,
          });
          b.wall(key, at(-W / 2, d / 2 + 0.006), at(W / 2, d / 2 + 0.006), yb, yb + Hh, [0, 0, 1, 1]);
          if (both)
            b.wall(key, at(W / 2, -d / 2 - 0.006), at(-W / 2, -d / 2 - 0.006), yb, yb + Hh, [0, 0, 1, 1]);
        }
        const hexOk = (h?: string) => !!h && /^#[0-9a-f]{6}$/i.test(h);
        if (bo.base && (bo.base.h ?? 0) > 0.02) {
          const bh = bo.base.h ?? 0.6;
          const bk =
            hexOk(bo.base.color) && ext.colorKey ? ext.colorKey('plaster', bo.base.color!) : 'spConcrete';
          b.box(
            bk,
            [c[0], g0 + Math.min(bh, yb - g0) / 2 - 0.05, c[1]],
            [W + 0.1, Math.min(bh, yb - g0) + 0.1, d + 0.1],
            yawB,
          );
        }
        if (bo.arrow) {
          // Üçgen ok: yüze bakınca sol / sağ uçta, yükseklik levha boyunca, taban 0.8 × yükseklik
          const sgn = bo.arrow.side === 'right' ? 1 : -1;
          const ak = hexOk(bo.arrow.color) && ext.colorKey ? ext.colorKey('fascia', bo.arrow.color!) : 'pole';
          const uTip = (sgn * W) / 2 + sgn * 0.02;
          const uB = uTip - sgn * Math.min(W * 0.3, Hh * 0.8);
          const o = d / 2 + 0.009;
          const P3 = (u: number, yy: number): V3 => {
            const q = at(u, o);
            return [q[0], yy, q[1]];
          };
          const tri: [V3, V3, V3, V3] =
            sgn < 0
              ? [P3(uB, yb), P3(uB, yb + Hh), P3(uTip, yb + Hh / 2), P3(uTip, yb + Hh / 2)]
              : [P3(uB, yb + Hh), P3(uB, yb), P3(uTip, yb + Hh / 2), P3(uTip, yb + Hh / 2)];
          b.quadUV(ak, tri, [
            [0, 0],
            [0, 1],
            [1, 0.5],
            [1, 0.5],
          ]);
        }
        if (bo.cctv && (bo.cctv.n ?? 0) > 0) {
          // Yatay kol (levha düzleminde) + mermi tipi kameralar, yüz yönüne bakar
          const n = Math.min(4, Math.round(bo.cctv.n ?? 1));
          const hy = g0 + (bo.cctv.h ?? yb - g0 + Hh + 0.4);
          const camK = hexOk(bo.cctv.color) && ext.colorKey ? ext.colorKey('frame', bo.cctv.color!) : 'mkAc';
          const arm = Math.max(0.4, 0.35 * n);
          const pc = at(0, -d / 2 - 0.05);
          b.cylinder(poleK, [pc[0], yb + Hh, pc[1]], 0.035, Math.max(0.05, hy - yb - Hh + 0.05), 8);
          const ac = at(0, -d / 2 - 0.05);
          b.box(poleK, [ac[0], hy, ac[1]], [arm, 0.04, 0.04], yawB);
          for (let k = 0; k < n; k++) {
            const u = n === 1 ? 0 : -arm / 2 + 0.1 + ((arm - 0.2) * k) / (n - 1);
            const q = at(u, -d / 2 - 0.05 + 0.1);
            b.box(camK, [q[0], hy - 0.08, q[1]], [0.09, 0.09, 0.26], yawB);
          }
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
        // Ölçülen renkler: frameC (kulübe + kanopi çerçevesi), columnC (doğu ucundaki kolon), boothPanelC (kulübe alt
        // paneli); verilmezse eski koyu kahve çerçeve
        const gh = s as { frameC?: string; columnC?: string; boothPanelC?: string };
        const ckm = (h: string | undefined, d: string) =>
          h && /^#[0-9a-f]{6}$/i.test(h) && ext.colorKey ? ext.colorKey('fascia', h) : d;
        const frK = ckm(gh.frameC, 'boothFrame');
        const colK = ckm(gh.columnC, frK);
        const bc = at(-W / 2 + 1.1, 0);
        b.box(ckm(gh.boothPanelC, frK), [bc[0], y + 0.45, bc[2]], [2.0, 0.9, 1.8], yaw);
        b.box('mkCanopyGlass', [bc[0], y + 1.55, bc[2]], [1.96, 1.3, 1.76], yaw);
        b.box(frK, [bc[0], y + 2.3, bc[2]], [2.1, 0.2, 1.9], yaw);
        const hh = s.h ?? 3.4;
        const cc = at(0, 0);
        const colored = !!(gh.frameC || gh.columnC);
        // Kanopi: ölçüm varsa kalın alınlı (0.45 m) portal kiriş, yoksa eski ince çerçeve
        b.box(
          frK,
          [cc[0], y + hh - (colored ? 0.2 : 0), cc[2]],
          [W, colored ? 0.45 : 0.18, Math.max(D, 1.2)],
          yaw,
        );
        for (const [u, k] of [
          [-W / 2 + 0.2, frK],
          [W / 2 - 0.2, colK],
        ] as const) {
          const p = at(u, 0);
          const cw = colored ? 0.3 : 0.12;
          b.box(k, [p[0], y + hh / 2, p[2]], [cw, hh, cw], yaw);
        }
        break;
      }
      case 'marking': {
        // Kaldırım bisiklet piktogramı (mavi zemin, beyaz bisiklet) — yere yatık
        const r = 0.55;
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const q = (u: number, v: number): V2 => [s.x + co * u + si * v, s.z - si * u + co * v];
        b.drape('signBikeFlat', [q(-r, -r), q(r, -r), q(r, r), q(-r, r)], [], H, wh + 0.012, 1, 2, {
          o: q(-r, -r),
          t: [co / (2 * r), -si / (2 * r)],
          n: [si / (2 * r), co / (2 * r)],
        });
        break;
      }
      case 'bin': {
        // Belediye çöp kutusu: direk üstünde kova. Renk: ölçülen `color` (hex) > nottaki renk (turuncu / paslanmaz)
        // > koyu yeşil (önceden her kova yeşildi: DA-2 kemerli duvar dibindeki turuncu kova, critic da2-07)
        const bc = (s as { color?: string }).color;
        const binK =
          bc && /^#[0-9a-f]{6}$/i.test(bc) && ext.colorKey
            ? ext.colorKey('metal', bc)
            : /turuncu|orange/.test(note)
              ? 'bollardOrange'
              : /paslanmaz|stainless/.test(note)
                ? 'steel'
                : 'binGreen';
        b.cylinder('pole', [s.x, y - 0.05, s.z], 0.03, 1.0, 6);
        b.cylinder(binK, [s.x + 0.2, y + 0.45, s.z], 0.2, 0.55, 12);
        break;
      }
      case 'bollard':
        // Turuncu esnek dikme (delinatör), beyaz yansıtıcı bantlı
        b.cylinder('bollardOrange', [s.x, g0, s.z], 0.04, s.h ?? 0.75, 8);
        b.cylinder('spPaint', [s.x, g0 + (s.h ?? 0.75) - 0.2, s.z], 0.042, 0.06, 8);
        break;
      case 'delineator': {
        // Bisiklet şeridi / yol kenarı esnek dikmesi (tek tek ya da pts + every dizisi): siyah kauçuk taban,
        // turuncu gövde, iki beyaz yansıtıcı bant. Yol kotunda (kaldırımda değil) — ölçülen konumlarda.
        const de = s as unknown as { pts?: V2[]; every?: number; color?: string; bands?: number };
        const hh = s.h ?? 0.75;
        const bodyK = de.color && ext.colorKey ? ext.colorKey('metal', de.color) : 'bollardOrange';
        const at: V2[] = [];
        if (de.pts && de.pts.length >= 2) {
          const ev = Math.max(0.3, de.every ?? 1.0);
          for (let i = 0; i + 1 < de.pts.length; i++) {
            const a = de.pts[i];
            const e = de.pts[i + 1];
            const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
            const n = Math.max(1, Math.round(L / ev));
            for (let k = i ? 1 : 0; k <= n; k++)
              at.push([a[0] + ((e[0] - a[0]) * k) / n, a[1] + ((e[1] - a[1]) * k) / n]);
          }
        } else at.push([s.x, s.z]);
        for (const [x, z] of at) {
          const gy = H(x, z);
          b.cylinder('darkMetal', [x, gy, z], 0.1, 0.04, 10);
          b.cylinder(bodyK, [x, gy + 0.04, z], 0.04, hh - 0.04, 8);
          const nb = Math.max(1, Math.min(3, de.bands ?? 2));
          for (let k = 0; k < nb; k++)
            b.cylinder('spPaint', [x, gy + hh - 0.09 - k * 0.12, z], 0.042, 0.06, 8);
        }
        break;
      }
      case 'patch':
      case 'pothole':
      case 'crack':
      case 'wear':
        // v8: bir yaya geçidine bağlı aşınma (`crossing` id) o geçidin şeritlerinde tekerlek izi olarak çizilir
        if ((s as { crossing?: string }).crossing) break;
        roadDetail(b, s as unknown as RoadDetail, H, ext.colorKey);
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
        // Tüm sokak ağaçları (2 m altı mazı/şimşir konileri dahil) ağaç kütüphanesinde, türüne göre
        // (siteplan.surveyVegetation → fixedTrees → vegetation/treelib; docs/TREES.md). Burada yalnız kazıklar.
        // Genç fidanların iki ahşap kazığı (ölçüm notu "kazık"); KARAR: kazık boyu/aralığı ölçülmedi → 1.6 m, 0.6 m
        if (/kazı[kğ]/.test(note))
          for (const u of [-0.3, 0.3]) b.cylinder('wood', [s.x + u, g0 - 0.1, s.z], 0.03, 1.7, 6);
        break;
      }
      case 'drain': {
        // Yağmur ızgarası (bordür dibinde): ölçülen w × d (varsayılan 0.8 × 0.4), renk `color`
        const dr = s as { w?: number; d?: number; color?: string };
        const g = new THREE.PlaneGeometry(dr.w ?? 0.8, dr.d ?? 0.4).rotateX(-Math.PI / 2).rotateY(yaw);
        const fy = flushY(s.x, s.z, sb, note);
        g.translate(s.x, g0 + fy, s.z);
        b.geometry(coverKey(dr.color), g);
        if (/beton (halka|çerçeve)|concrete (ring|frame)|beton çerçeve/.test(note))
          coverFrame(s.x, s.z, g0 + fy - 0.003, null, dr.w ?? 0.8, dr.d ?? 0.4);
        break;
      }
      case 'bike-rack': {
        // v7: adet n / aralık every / renk ölçülebilir (varsayılan 5 × 0.7 m — eski çıktı)
        const br = s as unknown as { n?: number; every?: number; color?: string };
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const n = Math.max(1, Math.min(20, Math.round(br.n ?? 5)));
        const ev = br.every ?? 0.7;
        const key = br.color && ext.colorKey ? ext.colorKey('metal', br.color) : 'steel';
        for (let k = 0; k < n; k++) {
          const o = (k - (n - 1) / 2) * ev;
          const g = new THREE.TorusGeometry(0.38, 0.025, 6, 16, Math.PI).rotateY(yaw + Math.PI / 2);
          g.translate(s.x + co * o, y, s.z - si * o);
          b.geometry(key, g);
        }
        break;
      }
      case 'hydrant':
        b.cylinder('hydrant', [s.x, y - 0.05, s.z], 0.1, 0.75, 10);
        break;
      case 'cabinet': {
        // Elektrik dağıtım panosu (not metnindeki ölçü: G×D×Y)
        // v8: yalnız rakamlı ölçü ("." tek başına NaN veriyordu → NaN geometri); ölçülen w / d / h alanları önce
        const m = note.match(/(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+(?:[.,]\d+)?)/);
        const nm = (i: number, d0: number) => {
          const v = m ? Number(m[i].replace(',', '.')) : NaN;
          return Number.isFinite(v) && v > 0 && v < 20 ? v : d0;
        };
        const cb = s as { w?: number; d?: number };
        const w = cb.w ?? nm(1, 0.9);
        const d = cb.d ?? nm(2, 0.4);
        const hh = s.h ?? nm(3, 1.3);
        // v9: ölçülen dolap rengi (`color`), yoksa sabit dolap malzemesi
        const cbC = (s as { color?: string }).color;
        const cbK =
          cbC && /^#[0-9a-f]{6}$/i.test(cbC) && ext.colorKey ? ext.colorKey('plaster', cbC) : 'cabinet';
        b.box(cbK, [s.x, y + hh / 2, s.z], [w, hh, d], yaw);
        b.box(cbK, [s.x, y + hh + 0.02, s.z], [w + 0.06, 0.04, d + 0.06], yaw);
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
        // Rögar kapağı: ölçülen `r` (yuvarlak, varsayılan 0.33) ya da `shape` square + w × d (yoksa 2r), `color`
        const mh = s as {
          r?: number;
          w?: number;
          d?: number;
          shape?: string;
          color?: string;
          ring?: { r?: number; color?: string; note?: string };
          surface?: string;
        };
        const r = Math.max(0.1, Math.min(1, mh.r ?? 0.33));
        const g =
          mh.shape === 'square'
            ? new THREE.PlaneGeometry(mh.w ?? 2 * r, mh.d ?? mh.w ?? 2 * r).rotateX(-Math.PI / 2).rotateY(yaw)
            : new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2);
        // v8: `surface: "median"` — kapak refüj çiminde: refüj üstü kotunda (konum ±0.5 m refüj kenarının dışına
        // düşse bile en yakın adanın kotu), yol asfaltında değil
        let fy = flushY(s.x, s.z, sb, note);
        if (mh.surface === 'median' && !walkAt(s.x, s.z)) {
          let best: Raised | null = null;
          let bd = 2;
          for (const rr of isl) {
            const d = distToRing(rr.poly, s.x, s.z);
            if (d < bd) {
              bd = d;
              best = rr;
            }
          }
          fy = (best?.h ?? 0.15) + 0.012;
        }
        g.translate(s.x, g0 + fy, s.z);
        // v8: kapak çevresindeki halka (`ring` {r, color}): ölçülen ton (ör. oz-n-dark-618 koyu çökmüş halka); ton
        // ölçülmemişse nottaki "açık gri beton" → beton, diğerleri çizilmez (renk uydurulmaz)
        if (mh.ring && (mh.ring.r ?? 0) > r + 0.02 && mh.shape !== 'square') {
          const rc = mh.ring.color && /^#[0-9a-f]{6}$/i.test(mh.ring.color) ? coverKey(mh.ring.color) : null;
          const rk = rc ?? (/açık|beton|concrete/.test(`${mh.ring.note ?? ''}`) ? 'spConcrete' : null);
          if (rk) {
            const rg = new THREE.RingGeometry(r - 0.005, mh.ring.r!, 24, 1).rotateX(-Math.PI / 2);
            rg.translate(s.x, g0 + fy - 0.002, s.z);
            b.geometry(rk, rg);
          }
        }
        // KARAR: renk ölçülmemişse dökme demir kapak tonu 502. Sk. ölçümünden (#797d7e, road-items 502-504-mh-sq);
        // önceden koyu metal (#2a2c2e) gölgeli asfaltta hiç seçilmiyordu (critic da1-13)
        b.geometry(coverKey(mh.color ?? '#797d7e'), g);
        if (/beton (halka|çerçeve)|concrete (ring|frame)|beton kare çerçeve/.test(note))
          coverFrame(
            s.x,
            s.z,
            g0 + fy - 0.003,
            mh.shape === 'square' ? null : r,
            mh.w ?? 2 * r,
            mh.d ?? mh.w ?? 2 * r,
          );
        break;
      }
      case 'pylon': {
        // Kafes enerji direği: 4 ayak (tabanda w, tepede wTop), her `panel` m'de çapraz bağlantı, `arms` kolları
        // {y, w} (kot, toplam kol boyu), tepe h; `wires` kol ucundan dünya noktalarına [x, z, y] sarkık teller.
        // Renk `color` (galvaniz #9aa0a3 varsayılan).
        const py = s as unknown as {
          h?: number;
          w?: number;
          wTop?: number;
          panel?: number;
          color?: string;
          arms?: { y: number; w: number }[];
          wires?: [number, number, number][];
        };
        const Hh = py.h ?? 30;
        const w0 = py.w ?? 6;
        const w1 = py.wTop ?? 1.6;
        const pk =
          py.color && /^#[0-9a-f]{6}$/i.test(py.color) && ext.colorKey
            ? ext.colorKey('metal', py.color)
            : 'pole';
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const W3 = (u: number, v: number, yy: number): V3 => [
          s.x + co * u + si * v,
          g0 + yy,
          s.z - si * u + co * v,
        ];
        const halfAt = (yy: number) => (w0 + (w1 - w0) * (yy / Hh)) / 2;
        const bar = (A: V3, B: V3, r = 0.05) => {
          const d = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
          const L = d.length();
          if (L < 0.01) return;
          const g = new THREE.BoxGeometry(r, L, r);
          g.applyQuaternion(
            new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()),
          );
          g.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
          b.geometry(pk, g);
        };
        const corners = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ];
        const step = Math.max(1.5, py.panel ?? 3);
        for (let yy = 0; yy < Hh - 1e-6; yy += step) {
          const y2 = Math.min(Hh, yy + step);
          const ha = halfAt(yy);
          const hb = halfAt(y2);
          for (let k = 0; k < 4; k++) {
            const [cu, cv] = corners[k];
            const [nu, nv] = corners[(k + 1) % 4];
            bar(W3(cu * ha, cv * ha, yy), W3(cu * hb, cv * hb, y2), 0.12);
            // Yüz başına X bağlantı + yatay
            bar(W3(cu * ha, cv * ha, yy), W3(nu * hb, nv * hb, y2));
            bar(W3(nu * ha, nv * ha, yy), W3(cu * hb, cv * hb, y2));
            bar(W3(cu * hb, cv * hb, y2), W3(nu * hb, nv * hb, y2));
          }
        }
        const tips: V3[] = [];
        for (const arm of py.arms ?? []) {
          const ha = halfAt(arm.y);
          for (const sg of [-1, 1]) {
            const tip = W3((sg * arm.w) / 2, 0, arm.y);
            for (const cv of [-1, 1]) bar(W3(sg * ha, cv * ha, arm.y), tip, 0.08);
            bar(W3(sg * ha, 0, arm.y + 1.2), tip, 0.06);
            tips.push(tip);
          }
        }
        // Teller: en yakın kol ucundan hedefe, orta noktada açıklığın %3'ü kadar sarkma
        for (const wv of py.wires ?? []) {
          const Tg: V3 = [wv[0], H(wv[0], wv[1]) + wv[2], wv[1]];
          const from = tips.reduce(
            (a, q) =>
              Math.hypot(q[0] - Tg[0], q[2] - Tg[2]) < Math.hypot(a[0] - Tg[0], a[2] - Tg[2]) ? q : a,
            tips[0] ?? W3(0, 0, Hh),
          );
          const span = Math.hypot(Tg[0] - from[0], Tg[2] - from[2]);
          const N = 12;
          let prev = from;
          for (let k = 1; k <= N; k++) {
            const f = k / N;
            const cur: V3 = [
              from[0] + (Tg[0] - from[0]) * f,
              from[1] + (Tg[1] - from[1]) * f - 4 * 0.03 * span * f * (1 - f),
              from[2] + (Tg[2] - from[2]) * f,
            ];
            bar(prev, cur, 0.03);
            prev = cur;
          }
        }
        break;
      }
      case 'canopy': {
        // Giriş kanopisi: a → e hattı (sokak yüzü), d derinlik (hattın solundan içeri: `side` right → sağa), üst kot h,
        // alın bandı fasciaH (renk fasciaC), alt yüz renk soffitC, `pillars` [{u (a'dan m), w, color, text, fg}]
        const cn = s as unknown as {
          a?: V2;
          e?: V2;
          d?: number;
          side?: string;
          h?: number;
          fasciaH?: number;
          fasciaC?: string;
          soffitC?: string;
          pillars?: { u: number; w?: number; color?: string; text?: string; fg?: string }[];
          valance?: { text?: string; fg?: string; font?: string; u0?: number; u1?: number };
        };
        if (!cn.a || !cn.e) break;
        const hex = (h: string | undefined, d: string) =>
          h && /^#[0-9a-f]{6}$/i.test(h) && ext.colorKey ? ext.colorKey('fascia', h) : d;
        const A = cn.a;
        const E = cn.e;
        const L = Math.hypot(E[0] - A[0], E[1] - A[1]) || 1;
        const t: V2 = [(E[0] - A[0]) / L, (E[1] - A[1]) / L];
        const nn: V2 = cn.side === 'right' ? [-t[1], t[0]] : [t[1], -t[0]];
        const D = cn.d ?? 2.4;
        const top = g0 + (cn.h ?? 3.2);
        const fh = cn.fasciaH ?? 0.4;
        const cyaw = Math.atan2(-t[1], t[0]);
        const mid: V2 = [(A[0] + E[0]) / 2 + (nn[0] * D) / 2, (A[1] + E[1]) / 2 + (nn[1] * D) / 2];
        b.box(hex(cn.fasciaC, 'boothFrame'), [mid[0], top - fh / 2, mid[1]], [L, fh, D], cyaw);
        b.box(
          hex(cn.soffitC, 'mkSoffit'),
          [mid[0], top - fh - 0.01, mid[1]],
          [L - 0.02, 0.02, D - 0.02],
          cyaw,
        );
        // v9: valans (alın bandı) yazısı — sokak yüzünde (a → e hattı, −nn), saydam zeminli harfler; u0..u1 (a'dan m)
        const vl = cn.valance;
        if (vl?.text && ext.signFace) {
          const vu0 = Math.max(0, vl.u0 ?? 0.05);
          const vu1 = Math.min(L, vl.u1 ?? L - 0.05);
          // KARAR: renk ölçülmemişse beyaz (wordTone "beyaz")
          const vfg = vl.fg && /^#[0-9a-f]{6}$/i.test(vl.fg) ? vl.fg : (wordTone('beyaz') ?? '#ecebe6');
          if (vu1 - vu0 > 0.1) {
            const key = ext.signFace({
              text: vl.text,
              bg: null,
              fg: vfg,
              border: null,
              font: vl.font ?? 'sans',
              bold: true,
              lit: false,
              style: 'letters',
              w: vu1 - vu0,
              h: fh * 0.9,
            });
            const f0: V2 = [A[0] + t[0] * vu0 - nn[0] * 0.006, A[1] + t[1] * vu0 - nn[1] * 0.006];
            const f1: V2 = [A[0] + t[0] * vu1 - nn[0] * 0.006, A[1] + t[1] * vu1 - nn[1] * 0.006];
            const front = -(f1[1] - f0[1]) * -nn[0] + (f1[0] - f0[0]) * -nn[1] > 0;
            b.wall(key, front ? f0 : f1, front ? f1 : f0, top - fh * 0.95, top - fh * 0.05, [0, 0, 1, 1]);
          }
        }
        for (const pl of cn.pillars ?? []) {
          const pw = pl.w ?? 0.4;
          const pc: V2 = [A[0] + t[0] * pl.u + (nn[0] * pw) / 2, A[1] + t[1] * pl.u + (nn[1] * pw) / 2];
          const ph = top - fh - g0;
          b.box(hex(pl.color, 'darkMetal'), [pc[0], g0 + ph / 2, pc[1]], [pw, ph, pw], cyaw);
          if (pl.text && ext.signFace) {
            const key = ext.signFace({
              text: pl.text,
              lines: pl.text.split('/').map((x) => ({ text: x.trim() })),
              bg: null,
              fg: pl.fg ?? '#f2f2f2',
              border: null,
              font: 'sans',
              bold: true,
              lit: false,
              style: 'letters',
              w: pw * 0.9,
              h: Math.min(1.2, ph * 0.4),
            });
            // Sokak yüzü (−nn): harfler kolon yüzünde, orta kotta
            const f0: V2 = [
              pc[0] - nn[0] * (pw / 2 + 0.005) - t[0] * pw * 0.45,
              pc[1] - nn[1] * (pw / 2 + 0.005) - t[1] * pw * 0.45,
            ];
            const f1: V2 = [
              pc[0] - nn[0] * (pw / 2 + 0.005) + t[0] * pw * 0.45,
              pc[1] - nn[1] * (pw / 2 + 0.005) + t[1] * pw * 0.45,
            ];
            const hh = Math.min(1.2, ph * 0.4);
            const yc = g0 + ph * 0.55;
            // wall(a→e) ön yüzü (−tz, tx): sokağa (−nn) bakacak sıra
            const front = -(f1[1] - f0[1]) * -nn[0] + (f1[0] - f0[0]) * -nn[1] > 0;
            b.wall(key, front ? f0 : f1, front ? f1 : f0, yc - hh / 2, yc + hh / 2, [0, 0, 1, 1]);
          }
        }
        break;
      }
      case 'road-line': {
        // Yol boyası çizgisi (dur / yol ver / kılavuz): pts çoklu çizgi, w genişlik (0.3), style solid | dashed |
        // giveway (yol ver: kesikli kalın çizgi 0.5/0.5 ya da `dash` [boya, boşluk]), color (beyaz), wear 0..1
        const rl = s as unknown as {
          pts?: V2[];
          w?: number;
          style?: string;
          dash?: [number, number];
          color?: string;
          wear?: number;
        };
        const pts = rl.pts ?? [];
        if (pts.length < 2) break;
        const w = Math.max(0.05, Math.min(1, rl.w ?? (rl.style === 'giveway' ? 0.4 : 0.3)));
        const [on, off] =
          rl.dash ?? (rl.style === 'giveway' ? [0.5, 0.5] : rl.style === 'dashed' ? [3, 5] : [1e6, 0]);
        const key = paintKeyOf(rl.color, rl.wear);
        let phase = 0;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i];
          const e = pts[i + 1];
          const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
          if (L < 0.01) continue;
          const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
          const nn: V2 = [-t[1] * (w / 2), t[0] * (w / 2)];
          for (let u = -phase; u < L; u += on + off) {
            const u0 = Math.max(0, u);
            const u1 = Math.min(L, u + on);
            if (u1 - u0 < 0.02) continue;
            const A: V2 = [a[0] + t[0] * u0, a[1] + t[1] * u0];
            const E: V2 = [a[0] + t[0] * u1, a[1] + t[1] * u1];
            b.drape(
              key,
              [
                [A[0] + nn[0], A[1] + nn[1]],
                [E[0] + nn[0], E[1] + nn[1]],
                [E[0] - nn[0], E[1] - nn[1]],
                [A[0] - nn[0], A[1] - nn[1]],
              ],
              [],
              H,
              0.052,
              1,
              2,
            );
          }
          phase = (phase + L) % (on + off);
        }
        break;
      }
      case 'tree-pit': {
        const r: V2[] = [
          [s.x - 0.6, s.z - 0.6],
          [s.x + 0.6, s.z - 0.6],
          [s.x + 0.6, s.z + 0.6],
          [s.x - 0.6, s.z + 0.6],
        ];
        b.drape('spMulch', r, [], H, wh + 0.008, 1, 2);
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
        const cr = s as unknown as {
          len?: number;
          w?: number;
          stripes?: string;
          wear?: number;
          /** Şerit rengi (#hex) ya da dönüşümlü renkler (ör. sarı-beyaz: ["#d9b53a", "#e8e8e4"]) */
          color?: string | string[];
          /** Şeritlerin altında boyalı zemin (ör. kırmızı: Özlüce kuzey kolu) */
          baseColor?: string;
        };
        // Aşınmış boya (ölçülmüşse 0..1): gürültü alfa eşiğiyle boyanın o kadarı eksik
        const cols = Array.isArray(cr.color) ? cr.color : cr.color ? [cr.color] : [undefined];
        const paintKs = cols.map((c) => paintKeyOf(c, cr.wear));
        // v8: bağlı aşınma kaydı (d4r-wear-*: `crossing` = bu geçidin id'si, `amount`) → şerit başına tekerlek izi
        // aşınması. KARAR: şerit düzeni ölçülmedi → geçidin başından 3.25 m şeritler, izler şerit ortasının ±0.85 m'si
        // (0.45 m yarı genişlik); izdeki şerit amount × 1.8, izin dışındaki amount × 0.4 (deterministik)
        const cid = (s as { id?: string }).id;
        const wa = cid ? crossingWear.get(cid) : undefined;
        const stripeKey = (k: number, o: number): string => {
          if (wa == null) return paintKs[k % paintKs.length];
          const len0 = cr.len ?? 4;
          const local = (((o + len0 / 2) % 3.25) + 3.25) % 3.25;
          const inTrack = Math.min(Math.abs(local - 0.775), Math.abs(local - 2.475)) < 0.45;
          const wk = Math.max(cr.wear ?? 0, Math.min(1, inTrack ? wa * 1.8 : wa * 0.4));
          return paintKeyOf(cols[k % cols.length], wk);
        };
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
        if (cr.baseColor && /^#[0-9a-f]{6}$/i.test(cr.baseColor) && ext.colorKey) {
          // Boyalı zemin: geçidin tamamı (len × w), şeritlerin altında
          const Q = (a: number, e: number): V2 => [s.x + d[0] * a + t[0] * e, s.z + d[1] * a + t[1] * e];
          b.drape(
            ext.colorKey('asphalt', cr.baseColor),
            [Q(-len / 2, -w / 2), Q(len / 2, -w / 2), Q(len / 2, w / 2), Q(-len / 2, w / 2)],
            [],
            H,
            0.0505,
            1,
            2,
          );
        }
        // v8: şeritsiz boyalı bant (ör. kırmızı bekleme bandı): stripes "yok" / "none" / "düz" / "bant" ve şerit
        // ölçüsü yoksa geçidin tamamı tek renk (color)
        if (!m && /\byok\b|none|\bdüz\b|solid|\bbant\b|band/.test(cr.stripes ?? '')) {
          const Q = (a: number, e: number): V2 => [s.x + d[0] * a + t[0] * e, s.z + d[1] * a + t[1] * e];
          b.drape(
            paintKs[0],
            [Q(-len / 2, -w / 2), Q(len / 2, -w / 2), Q(len / 2, w / 2), Q(-len / 2, w / 2)],
            [],
            H,
            0.052,
            1,
            2,
          );
          break;
        }
        for (let k = 0; k < n; k++) {
          const o = -span / 2 + sw / 2 + k * (sw + gap);
          const paintK = stripeKey(k, o);
          const c: V2 = [s.x + d[0] * o, s.z + d[1] * o];
          const P = (a: number, e: number): V2 => [c[0] + d[0] * a + t[0] * e, c[1] + d[1] * a + t[1] * e];
          // Yol boyasının üstünde (roads.ts çizgileri +0.05; spPaint polygonOffset −8)
          b.drape(
            paintK,
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
        const py = H(px, pz) + walkH(px, pz, sb);
        // Baktığı yön: rot (pusula); ölçümde "baktığı yön ölçülmedi" ise en yakın yol eksenine doğru
        // KARAR: yönü ölçülmemiş sinyal başları taşıt yoluna (en yakın yol eksenine) bakar — lamba kolu kuralıyla aynı
        let fn: V2 = [Math.sin(yaw), -Math.cos(yaw)];
        if (s.rot == null || /yön(ü)? ölçülmedi/.test(note)) {
          const r = towardRoad(roadCentre, px, pz);
          if (r) fn = r;
        }
        const poleK = ts.pole && ext.colorKey ? ext.colorKey('frame', ts.pole) : 'pole';
        // v8: konsol (kollu) direk — `arm` (m, kol boyu), `armRot` (kolun pusula yönü; yoksa yola doğru); ölçülmemişse
        // not "konsol" → KARAR 3.5 m (bulvar sağ şeridinin üstüne uzanan tipik konsol)
        const tsa = s as { arm?: number; armRot?: number };
        const armL = typeof tsa.arm === 'number' ? tsa.arm : /konsol/.test(note) ? 3.5 : 0;
        if (armL > 0.3) {
          let ad: V2 | null =
            typeof tsa.armRot === 'number'
              ? [Math.sin((tsa.armRot * Math.PI) / 180), -Math.cos((tsa.armRot * Math.PI) / 180)]
              : towardRoad(roadCentre, px, pz);
          ad = ad ?? fn;
          const top = py + h + 0.45;
          b.cylinder(poleK, [px, py - 0.1, pz], 0.09, top - py + 0.1, 10);
          const mid: V3 = [px + (ad[0] * armL) / 2, top - 0.08, pz + (ad[1] * armL) / 2];
          b.box(poleK, mid, [armL, 0.1, 0.1], Math.atan2(-ad[1], ad[0]));
          // Kol ucunda asılı baş (tepesi h): yalnız baş + kısa askı
          const hx = px + ad[0] * (armL - 0.2);
          const hz = pz + ad[1] * (armL - 0.2);
          trafficSignal(b, hx, py, hz, h, fn, poleK, false, true);
          b.box(poleK, [hx, py + h + 0.2, hz], [0.05, 0.4, 0.05], 0);
        } else trafficSignal(b, px, py, pz, h, fn, poleK, /yaya geçidi levha/.test(note));
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
      case 'road-symbol':
        roadSymbol(b, s as unknown as RoadSymbol, H, paintKeyOf, ext.signFace);
        break;
      case 'steps-line': {
        // v8: basamak dizisi (AVM podyumu, d4-avm-steps): pts hattı en alt basamağın ön kenarı, n basamak, toplam
        // yükseklik rise; basamaklar yoldan uzağa yükselir. KARAR: basamak derinliği ölçülmedi → 0.35 m
        const sl = s as { pts?: V2[]; n?: number; rise?: number; color?: string; tread?: number };
        const P = sl.pts ?? [];
        const nSt = Math.max(1, Math.round(sl.n ?? 3));
        const rise = sl.rise ?? 0.15 * nSt;
        const tread = sl.tread ?? 0.35;
        const key =
          sl.color && /^#[0-9a-f]{6}$/i.test(sl.color) && ext.colorKey
            ? ext.colorKey('plaster', sl.color)
            : 'spConcrete';
        for (let i = 0; i + 1 < P.length; i++) {
          const a = P[i];
          const e = P[i + 1];
          const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
          if (L < 0.1) continue;
          const tt: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
          let nn: V2 = [-tt[1], tt[0]];
          const mx = (a[0] + e[0]) / 2;
          const mz = (a[1] + e[1]) / 2;
          if (roadCentre(mx + nn[0], mz + nn[1]) < roadCentre(mx - nn[0], mz - nn[1])) nn = [-nn[0], -nn[1]];
          const g0s = Math.min(H(a[0], a[1]), H(e[0], e[1])) + walkH(mx, mz);
          for (let k = 0; k < nSt; k++) {
            const top = ((k + 1) * rise) / nSt;
            const v0 = k * tread;
            const v1 = k === nSt - 1 ? v0 + tread : v0 + tread;
            const c: V2 = [mx + (nn[0] * (v0 + v1)) / 2, mz + (nn[1] * (v0 + v1)) / 2];
            b.box(
              key,
              [c[0], g0s + top / 2 - 0.05, c[1]],
              [L, top + 0.1, v1 - v0],
              Math.atan2(-tt[1], tt[0]),
            );
            const ring: [number, number][] = [
              [a[0] + nn[0] * v0, a[1] + nn[1] * v0],
              [e[0] + nn[0] * v0, e[1] + nn[1] * v0],
              [e[0] + nn[0] * v1, e[1] + nn[1] * v1],
              [a[0] + nn[0] * v1, a[1] + nn[1] * v1],
            ];
            raised.push({ poly: ring, h: g0s - H(mx, mz) + top });
          }
        }
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
          ext.signFace,
        );
        break;
    }
  }
  raised.push(...isl);
  return {
    raised,
    covers: (x, z) => polys.some((p) => inside(p, x, z)),
    coverPolys: polys,
    surfaceAt: (x, z) => walkAt(x, z)?.h ?? null,
  };
}
