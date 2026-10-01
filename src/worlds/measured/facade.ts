import * as THREE from 'three';
import { roofGables, roofHeightAt, unionRoof } from './roof';
import { footEdgeOf, wingGables, wingHeightAt, wingRoofs, type RoofWing } from './roofWing';
import * as pcNs from 'polygon-clipping';
import { Builder, type V2, type V3, type V4 } from './builder';
import { drawSignItem, type SignCtx } from './signs';

/**
 * Ölçülmüş cephe üreticisi (Street View ortofotolarından `survey/<id>.json` → `scripts/survey-compile.mjs` →
 * `data/facades.json`, gerçek metre). Her kenar için pencere sütunları, turuncu yuvarlak şeritler, balkon
 * yığınları (kat başına plan birleşimi: döşeme + gri parapet + buzlu cam + küpeşte; cam balkon; tepe şapkası),
 * yağmur boruları, klima/çanak/kamera/bayrak, giriş; kabartma pilastır, üçgen alınlık (asimetrik olabilir), duvar
 * girintisi (içindeki açıklıklar arka duvarda), bayrak direği, bodrum pencereleri (K−1), kavisli balkon önleri,
 * kenar bazında çatı parapeti / korkuluğu, lamelli alın, pergola.
 */

type Pc = typeof pcNs;
const pc: Pc = (pcNs as unknown as { default?: Pc }).default ?? pcNs;

/** ?oldroof=1 → eski sınır kutusu çatısı (karşılaştırma) */
const OLD_ROOF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('oldroof');

export interface CWin {
  t: 'win';
  u0: number;
  u1: number;
  sill: number;
  head: number;
  storeys: number[];
  kind: 'std' | 'french' | 'small' | 'door' | 'shop';
  rail: boolean;
  split: number;
  box: boolean;
  /** Ölçülmüş perde türü (kat → tür adı) */
  curt?: Record<string, string>;
  /** Ölçülmüş panjur kapanma oranı (kat → 0..1) */
  shut?: Record<string, number>;
  /** Kat → pencere önü parmaklık tipi */
  grille?: Record<string, string>;
  grilleC?: string;
  lower?: string;
  lowerC?: string | null;
  /** Doğrama rengi (ölçülmüş; yoksa blok paleti) */
  frameC?: string | null;
  /** Renkli / yansıtıcı cam (giydirme cephe paneli): oda gölgelendiricisi yerine düz renkli cam */
  tint?: string | null;
  /** Söve: açıklığın çevresinde çıkıntılı çerçeve (genişlik, çıkıntı, renk) */
  surround?: { w: number; d: number; color?: string | null } | null;
  /** Kepenk / dış panjur rengi (ölçülmüş; yoksa açık gri alüminyum) */
  shutC?: string | null;
  /** Yatay kayıtlar (giydirme cephe traversleri): kat döşemesinden gerçek yükseklikler */
  hbars?: number[] | null;
  /** Merdiven kovası penceresi: kat çizgisine kırpılmaz (yarım kat kaymalı dizi) */
  stair?: boolean;
  /** Kat → perde (fon perde / tül / stor) rengi "#rrggbb" (camın arkasından görünen) */
  curtC?: Record<string, string> | null;
  /** Kat → fon perde kapanma oranı 0..1 (pencere genişliğinin perdeyle örtülen kısmı; 1 = tamamen kapalı) */
  curtF?: Record<string, number> | null;
  /** v7: yuvarlak / oval pencere (u0..u1 × sill..head kutusunun içine çizilen elips; oculus) */
  shape?: 'round' | 'rounded' | 'arch' | null;
  /** v9 (rounded): köşe yarıçapı (m) ve yuvarlanan köşeler (tl, tr, bl, br; verilmezse dördü) */
  radius?: number | null;
  corners?: string[] | null;
  /**
   * v9 (arch): kemerli açıklık — üzengi (kemerin başladığı kot, kat döşemesinden m; head = kemer tepesi). Verilmezse
   * yarım daire (üzengi = tepe − yarım genişlik). `apex` (gerçek u) tepe noktası ortada değilse (asimetrik kemer).
   */
  spring?: number | null;
  apex?: number | null;
  /** v7: cam folyo (desenli dekor folyo, yaklaşık): renk + desen (damask | dots | frost) */
  film?: { color: string; pattern?: string | null } | null;
}
/** Kabartma pilastır (düşey çıkıntılı bant): u0..u1, y0..y1 (tabandan) ya da kat aralığı, çıkıntı d */
export interface CPilaster {
  t: 'pilaster';
  u0: number;
  u1: number;
  y0: number | null;
  y1: number | null;
  storeys: [number, number] | null;
  d: number;
  color: string;
  cap?: { h: number; d?: number; color?: string | null } | null;
  base?: { h: number; d?: number; color?: string | null } | null;
  /** Köşeyi saran bant (quoin): kenar başı / sonu köşesinde d kadar uzar (komşu kenardaki bantla birleşir) */
  corner?: 'start' | 'end' | 'both' | null;
  /** Yatay derzler (köşe taşı görünümü): aralık, derz genişliği, renk */
  joints?: { every: number; w?: number; color?: string | null } | null;
}
/** Balkon içi güneşlik bezi / branda (ön düzlemde üstten asılı, alt kenar duvara doğru `back` kadar eğik) */
export interface CCloth {
  t: 'cloth';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  d: number;
  color: string;
  back: number;
}
/** Korkuluğa asılı bayrak / portreli pankart (dikey) */
export interface CBanner {
  t: 'banner';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  d: number;
  /** portrait: kırmızı zemin + üstte ay-yıldız + ortada portre madalyonu + altta yazı bandı; tr-v: dikey Türk
   * bayrağı; tr: yatay Türk bayrağı; plain: düz renk (+ yazı) */
  style: string;
  bg: string | null;
  fg: string | null;
  text: string | null;
  /**
   * v7 (style print — çok katlı asılı pankart / file pankart): satır satır yazı (y: pankart yüksekliğinde 0..1
   * satır merkezi), renk blokları (x0..x1 × y0..y1 pankart oranında, alt sol 0,0), file (mesh: delikli file baskı)
   */
  lines?: { text: string; fg?: string; size?: number; bold?: boolean; y?: number }[] | null;
  blocks?: { x0: number; x1: number; y0: number; y1: number; color: string }[] | null;
  mesh?: boolean | null;
}
/** Duvar apliki / lamba (silindir, fener, spot, küre, kutu), kat aralığında tekrarlanabilir */
export interface CLamp {
  t: 'lamp';
  us: number[];
  /** Mutlak kot (tabandan); storeys verilirse null */
  y: number | null;
  /** Kat döşemesinden yükseklik (storeys ile) */
  yRel: number | null;
  storeys: number[] | null;
  style: string;
  d: number;
  h: number;
  proud: number;
  color: string | null;
  tip: string | null;
  dir: string;
  /** v7: kol boyu (m, duvardan başa; > proud ise baş kolun ucunda) ve baş eğimi (derece, düşeyden; spot yukarı / aşağı) */
  arm?: number | null;
  tilt?: number | null;
  /**
   * v7: payenin YAN yüzünde (cepheye dik yüz): 'start' → yüz −t yönüne bakar (u'nun başlangıç tarafı), 'end' → +t.
   * u = yan yüzün görünen konumu, off = lambanın cephe düzleminden dışarı uzaklığı (m).
   */
  side?: 'start' | 'end' | null;
  off?: number | null;
}
/** Çatı penceresi (alınlıklı dormer / gablet): kenarın çatı yüzünde, duvardan setback geride */
export interface CDormer {
  t: 'dormer';
  u0: number;
  u1: number;
  setback: number;
  /** Tepe kotu duvar üstünden (m) */
  ridge: number | null;
  /** Tepe yüksekliği ön yüzün çatıya oturduğu çizgiden (m); ridge yoksa */
  h: number | null;
  /** Yan (yanak) duvarların düşey boyu; null → eğimden */
  wallH: number | null;
  pitch: number;
  color: string | null;
  roofC: string | null;
  /** Rüzgârlık tahtası: w bant genişliği (m, varsayılan 0.12 — v7'de ölçülen değer kullanılır), renk */
  trim: { w?: number; color?: string | null } | null;
  win: {
    w?: number;
    h?: number;
    sill?: number;
    split?: number;
    curt?: string | null;
    frameC?: string | null;
    /** v7: 'gable' → beşgen pencere (düşey yanlar + üstü dormer eğimine paralel; alınlığın çoğunu kaplar) */
    shape?: string | null;
  } | null;
}
/** Çatı üstü öğe (baca, TV anteni, çanak, havalandırma): kenarın çatı yüzünde, duvardan setback geride */
export interface CRoofObj {
  t: 'roofobj';
  kind: string;
  u: number;
  setback: number;
  /** Çatı yüzeyinden yükseklik (m) */
  h: number;
  w: number;
  d: number;
  color: string | null;
  /** Başlık: hip | pyramid | flat | none; v7: disc (baca şapkası koyu disk, çap d), trim (alt kenar ikinci renk) */
  cap: {
    kind: string;
    h?: number;
    color?: string | null;
    d?: number;
    trim?: { h: number; color?: string | null } | null;
  } | null;
  /** v7 (kind post): direk tepesi — ball (küre lamba, lit → gece yanar), plate (kare levha), none */
  top?: { kind: string; d?: number; color?: string | null; lit?: boolean } | null;
}
/** Cephe üstünde yol boyunca şerit (boya / kabartma, kavisli olabilir): (u, y) noktaları (tabandan), genişlik */
export interface CRibbon {
  t: 'ribbon';
  pts: [number, number][];
  w: number;
  d: number;
  color: string;
}
/** Kemerli (segmental / yarım daire) parapet ya da tonoz ön yüzü; içindeki çatı arası pencereleri arka yüzde açılır */
export interface CArch {
  t: 'arch';
  u0: number;
  u1: number;
  /** Taban kotu (tabandan); null → duvar üstü */
  y: number | null;
  /** Kemer tepe yüksekliği (tabandan yukarı, m) ya da tepe kotu */
  rise: number | null;
  top: number | null;
  /** Uçlarda düşey kısım (m) */
  spring: number;
  d: number;
  shape: string;
  /** Kalınlık (m) */
  thick: number;
  color: string;
  coping: { h: number; over?: number; color?: string | null } | null;
  /** Tonoz: ön yüzden geriye uzanan eğri çatı (m) */
  vault: number;
  roofC: string | null;
  /**
   * v7: yalnız bu u aralığı çizilir (kısmi kemer — ör. kanat yüzünde tonoz ucunun yükselen yarısı); kemer biçimi
   * u0..u1 (kenarı aşabilir) üzerinden hesaplanır.
   */
  clip?: [number, number] | null;
  /** v7: false → tonozun arka alın yüzü çizilmez (arka uçta kendi `arch` öğesi olan tonozlar) */
  backFace?: boolean | null;
}
/** Üçgen alınlık (balkon yığını üstü / cephe alınlığı; tepe noktası kaydırılabilir → asimetrik) */
export interface CPediment {
  t: 'pediment';
  u0: number;
  u1: number;
  apex: number;
  /** Taban kotu (tabandan); null → duvar üstü (saçak hizası) */
  y: number | null;
  /** Tepe kotu (tabandan); h yoksa kullanılır */
  top: number | null;
  h: number | null;
  d: number;
  depth: number | null;
  color: string;
  /** Çevre silmesi; base: false → yalnız iki eğik kenar (tabanda çizgi yok) */
  trim?: { w?: number; d?: number; color?: string | null; base?: boolean } | null;
  roofC?: string | null;
}
/** Duvar girintisi: u0..u1 × y0..y1 (ya da kat aralığı) boyunca depth kadar içeri; içindeki öğeler arka duvarda */
export interface CRecess {
  t: 'recess';
  u0: number;
  u1: number;
  y0: number | null;
  y1: number | null;
  storeys: [number, number] | null;
  depth: number;
  back: string | null;
  side: string | null;
  ceil: string | null;
  floor: string | null;
  /** Kat → arka / yan duvar rengi (kat döşemelerinde değişen renk bölgeleri) */
  backS?: Record<string, string> | null;
  sideS?: Record<string, string> | null;
  /** v7: arka / yan duvarlarda derzli kaplama (Proj.clad ile aynı) */
  clad?: { dir?: string; every: number; w?: number; color?: string | null } | null;
}
/** Bayrak direği (duvar önünde) */
export interface CMast {
  t: 'mast';
  u: number;
  off: number;
  y0: number | null;
  h: number;
  color: string;
  flag: string | null;
  /** Direk tepesinde eleman: disc (duvara bakan yuvarlak levha, yatay kollu), ball, dish */
  top?: { kind: string; d?: number; color?: string | null; arm?: number } | null;
}
export interface CGroove {
  t: 'groove';
  dir: 'h' | 'v';
  u0?: number;
  u1?: number;
  u?: number;
  y?: number;
  y0?: number;
  y1?: number;
  w: number;
  color: string | null;
}
export interface CVent {
  t: 'vent';
  u: number;
  y: number;
  s: number;
  shape: string;
  count: number;
  spacing: number;
  color: string | null;
}
export interface CStrip {
  t: 'strip';
  u: number;
  w: number;
  y0: number;
  y1: number;
  /** Uç biçimi: round (yarım yuvarlak, varsayılan), point (sivri), flat (düz) */
  top?: string | null;
  bottom?: string | null;
}
export interface CBal {
  t: 'bal';
  u0: number;
  u1: number;
  d: number;
  storeys: number[];
  glazed: number[];
  tint: Record<string, string>;
  cap: boolean;
  sides: string;
  /** İçe gömük (loca) balkon: arka duvarın taban izinden içeri çekilme derinliği */
  inset?: number | null;
  /** Kat → korkuluk tipi ("*" varsayılan): glass, glassFull, tube, bars, solid, solidTube, none */
  rail?: Record<string, string>;
  /** Kat → alın/parapet rengi */
  fasciaC?: Record<string, string>;
  /** Korkuluk metal rengi */
  railC?: string;
  /** Kat → dolu parapet yüksekliği */
  parapetH?: Record<string, number>;
  net?: number[];
  /** Kat → korkuluk camı rengi (füme / buzlu / şeffaf; fotoğraftan örneklenen görünen renk) */
  glassC?: Record<string, string>;
  /**
   * Kavisli ön yüz: ön kenarın ortada dışarı taşması (m, sehim); d = 0 ile duvardan duvara yay. inset > 0 olan
   * gömük locada (d < 0.35): loca derinliği korunur, döşeme / korkuluk / cam taban izi hattından yay boyunca taşar.
   */
  bulge?: number;
  /**
   * Ortak yay açıklığı [u0, u1] (gerçek u): bulge parabolü öğenin kendi aralığı yerine bu aralıkta — kat kat ya da
   * bölmelere ayrılmış öğeler tek sürekli yay oluşturur (uçlarda sehim 0, ortada bulge)
   */
  arc?: [number, number] | null;
  /** Serbest ön köşelerin yuvarlatma yarıçapı (m) — tek sayı ya da [başlangıç, bitiş] */
  round?: number | [number, number];
  /** Kat → cam balkon profil rengi */
  frameC?: Record<string, string>;
  /** v7: cam balkon dikme / derz aralığı (m; varsayılan 0.72) — dikmeler frameC renginde */
  glazeEvery?: number;
  /** Buzlu (frosted) cam balkon rengi */
  frostC?: string;
  /** Kat → sarkan kiriş: alın bandı döşemenin bu kadar altından başlar (m) */
  beam?: Record<string, number>;
  /** Kat → küpeşte yüksekliği (m, varsayılan 0.92) */
  railH?: Record<string, number>;
  /** Kat → saksı konumları (gerçek u) */
  pots?: Record<string, number[]>;
  potsOn?: string;
  potC?: string | null;
  plantC?: string | null;
  /** Kat → cam balkon içi fon perde rengi, kapanma oranı */
  curtC?: Record<string, string> | null;
  curtF?: Record<string, number> | null;
  /** Kat → camın önünde demir parmaklık: arched (bölme başına yarım daire kemerli), bars (düz çubuk) */
  grille?: Record<string, string> | null;
  grilleC?: string | null;
  /** Kemerli parmaklık bölme genişliği (m, varsayılan 0.9) */
  grilleW?: number | null;
  /**
   * Tavan gömme spotları: adet ya da aralık, ön kenardan içeri, çap; cap: şapka altında da. v7: us (gerçek u
   * listesi: ölçülen konumlar, eşit aralık yerine), shape rect + l × w (dikdörtgen armatür)
   */
  spots?: {
    n?: number;
    every?: number;
    inset?: number;
    d?: number;
    cap?: boolean;
    us?: number[] | null;
    shape?: string | null;
    l?: number;
    w?: number;
  } | null;
  /** Cam korkuluk dikme aralığı / kesiti (m; varsayılan 1.2 / 0.03) */
  postEvery?: number | null;
  postW?: number | null;
  /** Kat → dolu parapet üstünde ince çelik küpeşte: parapet üstünden yükseklik (m; 0 = üstüne oturur) */
  hand?: Record<string, number> | null;
  /** Tepe şapkası rengi, kalınlığı, eğimi (çatı eğimini izleyen eğik şapka), üstünde teras korkuluğu */
  capC?: string | null;
  capH?: number | null;
  capSlope?: { pitch?: number | null; dir: string } | null;
  capRail?: string | null;
  capRailC?: string | null;
  capRailH?: number | null;
  /** Kat → açık balkonda bambu / hasır stor rengi (tavandan korkuluk üstüne iner), alt kenar kotu */
  blinds?: Record<string, string> | null;
  blindTo?: Record<string, number> | null;
  /** Kat → dolu parapet üstünde harpuşta / başlık (yükseklik, renk, iki yana taşma) */
  coping?: Record<string, { h: number; color?: string | null; over?: number }> | null;
  /** Şapka alın üst kenarında ince damlalık (metal) */
  capTrim?: { h: number; color?: string | null } | null;
  /** Balkon arkasında ölçülmüş pencere olsa da varsayılan balkon kapısı korunur (boş aralığa) */
  keepDoor?: boolean;
  /** Saksı çiçek renkleri (sırayla) */
  flowerC?: string[] | null;
  /** v7: saksı başına ayrıntı (pots listesindeki konumla eşleşir): korkuluk / döşeme, bitkili mi, renkler */
  potSpec?: Record<
    string,
    { u: number; on?: string | null; plant?: boolean; potC?: string | null; plantC?: string | null }[]
  > | null;
  /** v7: serbest ön köşelerde 45° pah (m): tek sayı ya da [u0 ucu, u1 ucu] */
  chamfer?: number | [number, number] | null;
  /**
   * v7: köşeyi saran balkon: öğenin binanın gerçek köşesindeki ucunda (u1 ≥ kenar boyu ya da u0 ≤ 0) ön kenar
   * komşu kenarın balkonuyla r yarıçaplı yay (kind round) ya da r pahla (kind chamfer) birleşir.
   */
  wrap?: { r: number; kind?: string | null } | null;
  /** v7: false → köşe locası komşu kenardaki locayla tek dikdörtgende birleştirilmez (ayrı hacimler) */
  merge?: boolean | null;
  /**
   * v7: gömük locanın ön kenarı uçlarda taban izi İÇİNE döner: yarıçap / pah (m) [u0 ucu, u1 ucu]; döşeme,
   * tavan ve korkuluk bu dönüşü izler (endShape round | chamfer).
   */
  endIn?: number | [number, number] | null;
  endShape?: string | null;
  /** v7: şapka altında kare ızgara tavan (pergola ızgarası): göz aralığı, çubuk genişliği, derinlik, renk */
  capGrid?: { every: number; w?: number; depth?: number; color?: string | null } | null;
  /** v7: kat → parmaklık yüksekliği (m, cam alt kotundan; kısmi boy) ve camın ARKASINDA (grilleIn) */
  grilleH?: Record<string, number> | null;
  grilleIn?: boolean | null;
  /** v7: kat → açık balkonda korkuluk üstünden tavana beyaz kare güvenlik kafesi rengi, göz aralığı (m) */
  cage?: Record<string, string> | null;
  cageEvery?: number | null;
  /**
   * v7: gömük locada tepe şapkası (cap: true): şapka alnının taban izi hattından dışarı taşması (m; köşe kütlesi
   * şapkaları — 1480041342/43). Verilmezse gömük locada şapka çizilmez (eski davranış).
   */
  capOver?: number | null;
}
export interface CProj {
  t: 'proj';
  u0: number;
  u1: number;
  d: number;
  y0: number;
  y1: number;
  color: string;
  wins: {
    u0: number;
    u1: number;
    y0: number;
    y1: number;
    kind: string;
    curt: string | null;
    /** Fransız korkuluk (yatay borular), dikey bölme sayısı, doğrama rengi */
    rail?: boolean;
    split?: number | null;
    frameC?: string | null;
  }[];
  /** Üstü teras: dış üç kenarda korkuluk (bal.rail tipleri), metal rengi, dolu parapet yüksekliği */
  topRail?: string | null;
  topRailC?: string | null;
  topParH?: number | null;
  /** Teras korkuluğu yüksekliği (m) */
  topRailH?: number | null;
  /** Duvar hattının gerisine uzanım (m): çatıdan yükselen merdiven kulesi başlığı gibi */
  back?: number | null;
  /** Üst yüz rengi (ör. paslı saç kapak) ve üst şapka */
  topC?: string | null;
  cap?: { h: number; over?: number; color?: string | null } | null;
  /** Derzli kaplama dokusu (ör. kahverengi kompozit / ahşap görünümlü panel): yön, aralık, derz genişliği, rengi */
  clad?: Clad | null;
  /** v7: terasın cam korkuluk rengi (verilmezse blok railGlass) */
  topGlassC?: string | null;
  /** v7: u1 ucundaki derinlik (m): d → d1 doğrusal değişen (eğik) çıkma / saçak kutusu */
  d1?: number | null;
  /** v7: yüzey bitişi: acp (parlak kompozit panel), matte (mat); verilmezse sıva */
  finish?: string | null;
  /**
   * v9: ön yüzde kemerli açıklık (gerçek u / tabandan kot): u0..u1, taban y0 (verilmezse çıkma tabanı), tepe `top`,
   * üzengi `spring` (verilmezse yarım daire), tepe noktası `apex` (u; asimetrik), kemer içi rengi `revealC`
   */
  arch?: {
    u0: number;
    u1: number;
    y0?: number | null;
    top: number;
    spring?: number | null;
    apex?: number | null;
    revealC?: string | null;
  } | null;
}
/**
 * Derzli kaplama: dir v (düşey derz) | h (yatay) | grid (ikisi birden: every yatay aralık, every2 düşey aralık) |
 * v7 dots (delikli panel: every nokta aralığı, w delik çapı), w derz genişliği, color derz / delik rengi; us:
 * düzensiz düşey derzlerin gerçek u listesi (every yerine / ek olarak).
 */
export interface Clad {
  dir?: string;
  every: number;
  every2?: number | null;
  w?: number;
  color?: string | null;
  us?: number[] | null;
}
export interface CSign {
  t: 'sign';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  d: number;
  text: string;
  lines?: { text: string; fg?: string; size?: number; bold?: boolean }[] | null;
  bg: string | null;
  fg: string;
  border: string | null;
  style: string;
  font: string;
  bold: boolean;
  lit: boolean;
  outline?: string | null;
  /** v11: ölçülen harf konturu kalınlığı (m, görünen dış kenar; verilmezse harf boyunun %6'sı) */
  outlineW?: number | null;
  /** v11: yazı ölçülen genişliği doldurur (capH ile birlikte; yatay genişletme ≤ 1.6, sıkıştırma ≥ 0.5) */
  stretch?: boolean | null;
  /** v11: eğik (italik) yazı */
  italic?: boolean | null;
  shape?: string | null;
  icon?: string | null;
  iconC?: string | null;
  /** Monogram / glif: yan yana harfler (ayna simetrik olabilir), bindirme oranı */
  glyphs?: { ch: string; mirror?: boolean }[] | null;
  join?: number | null;
  /** v7: duvardan uzaklık (m): balkon önüne / başka bir yüzeye monte (verilmezse bant/pano/çıkma önü ya da duvar) */
  off?: number | null;
  /** v7: arkadan aydınlatmalı harflerin duvardaki ışık halesi rengi (gece parlar) */
  halo?: string | null;
  /** v7: harflerin arkasında taşıyıcı pano (kanal harf + pano): renk, kalınlık, harflerden taşma (m) */
  back?: { color: string; d?: number; pad?: number } | null;
  /** v7: ölçülen büyük harf yüksekliği (m): yazı bu boyda çizilir (sığmazsa küçülür) */
  capH?: number | null;
  /** v7: yazı hizası left | center | right */
  align?: string | null;
}
export interface CAwning {
  t: 'awning';
  u0: number;
  u1: number;
  y: number;
  d: number;
  drop: number;
  color: string;
  stripe: string | null;
  text: string | null;
  textColor: string;
  /**
   * 'dutch': çeyrek yuvarlak kabuk + yelpaze uç kapakları (Hollanda tipi); 'retract': katlanır kollu düz tente (ön
   * profil + kollar); yoksa düz eğik tente
   */
  style?: string | null;
  /** v7: valans üstünde birden çok yazı / monogram: gerçek u aralığı, metin ya da glif, renk, yazı tipi */
  texts?:
    | {
        u0: number;
        u1: number;
        text?: string | null;
        glyphs?: { ch: string; mirror?: boolean }[] | null;
        join?: number | null;
        fg?: string | null;
        font?: string | null;
        bold?: boolean | null;
      }[]
    | null;
  /** v7: katlanır kollar: adet ya da gerçek u listesi, renk */
  arms?: { n?: number; us?: number[] | null; color?: string | null } | null;
  /** v7: Hollanda tentesinde köşeyi saran çeyrek kubbe uç (start | end | both) */
  dome?: string | null;
  /**
   * v9: düz / katlanır tentede çizgi genişliği (m): `stripe` rengiyle duvara DİK (eğim boyunca) dönüşümlü bantlar,
   * u0'dan ana renkle başlar; valans da çizgili. Verilmezse tek renk (eski).
   */
  stripeW?: number | null;
}
export interface CPipe {
  t: 'pipe';
  u: number;
  off: number;
  /** Renk (ölçülmüş; yoksa koyu gri) */
  color?: string | null;
  /** Yarıçap (m, varsayılan 0.05) */
  r?: number | null;
  /** Yalnız bu kot aralığında (tabandan, m) */
  y0?: number | null;
  y1?: number | null;
  brackets?: boolean;
  /**
   * v7: balkon gider boruları: her katta (s aralığı) döşemenin altından düşey boruya yatay parça + dirsek; len
   * boy (m), side −1 (u0 yönüne) / 1 (u1 yönüne), y döşeme üstünden kot (m, −0.3 = döşeme altı)
   */
  stubs?: { s: [number, number]; len: number; side?: number; y?: number } | null;
}
export interface CUnit {
  t: 'ac' | 'dish' | 'camera' | 'flag';
  u: number;
  s: number;
  y: number | null;
  onBal: boolean;
  /** Kamera: dome (beyaz kubbe) / bullet (kollu silindir) / box (varsayılan) */
  style?: string | null;
  color?: string | null;
  /** Duvardan uzaklık (m): önündeki dikme / ayak üzerinde (ör. balkon önü direk d≈1.0) */
  off?: number | null;
  /** Çift kamera (iki yana, cephe boyunca bakan) */
  pair?: boolean;
  /**
   * v7: loca / girinti YAN duvarına monte (en yakın yan duvar; ön yüzü cephe boyunca açıklığa bakar); off = birimin
   * cephe düzleminden içeri uzaklığı (m)
   */
  side?: boolean;
  /** v7: kamera bakış yönü (derece): 0 = duvardan dışarı, +90 = cephe boyunca u1 yönüne, −90 = u0 yönüne */
  yaw?: number | null;
  /** v11 (flag): ölçülen en / boy (m; verilmezse 1.1 × 1.3) ve cephe düzlemindeki eğim (derece, + → u1 ucu aşağı) */
  w?: number | null;
  h?: number | null;
  tilt?: number | null;
}
export interface CPanel {
  t: 'band' | 'panel';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  color: string;
  proud: number;
  /**
   * 'louvre': yatay lamelli alüminyum alın (dükkân saçağı); v7 'tiles': çok renkli karo bandı (tile karo boyu,
   * colors palet, seq renk sırası — indeks listesi; verilmezse paletten tohumlu sıra)
   */
  style?: string | null;
  slats?: number | null;
  shade?: string | null;
  /** Derzli kaplama dokusu (dikey / yatay ince derzler / grid): yön, aralık, derz genişliği, rengi */
  clad?: Clad | null;
  tile?: number | null;
  colors?: string[] | null;
  seq?: number[] | null;
  /** v11: tuğla örgüsü (running: yarım kaydırmalı sıralar; tile en × tileH boy) */
  bond?: string | null;
  tileH?: number | null;
  /** v7: yüzey bitişi: acp (parlak kompozit panel), matte */
  finish?: string | null;
  /**
   * v9: çokgen pano (gerçek u, tabandan y; saat yönü tersine): köşegen bölünmüş kaplama (üçgen / yamuk) — u0..y1
   * sınır kutusu. Düz yüz, açıklıklar delik (çıkıntı yan yüzleri çizilmez).
   */
  poly?: [number, number][] | null;
}
export interface CEntrance {
  t: 'entrance';
  u0: number;
  u1: number;
  kind: string;
  canopy: boolean;
  sign: string | null;
  steps: number | null;
  /** v7: kapı eşiği kotu (tabandan gerçek m); verilmezse zemin kat döşemesi (subasmansız blokta zemin) */
  y?: number | null;
}
/** v7: çapraz tabela çubuğu / gergi / konsol: iki uç [u, y (tabandan), duvardan uzaklık], yarıçap, renk */
export interface CRod {
  t: 'rod';
  a: [number, number, number];
  e: [number, number, number];
  r: number;
  color: string | null;
}
/** v7: giriş basamak bloğu: u aralığı, üst basamak kotu (tabandan), basamak sayısı, basamak derinliği, duvardan uzaklık */
export interface CSteps {
  t: 'steps';
  u0: number;
  u1: number;
  top: number;
  n: number;
  tread: number;
  off: number;
  color: string | null;
}
/**
 * v7: balkon / loca eşyası: kind box (dolap, beyaz kutu) | swing (örtülü bahçe salıncağı). u aralığı, y0..y1 (tabandan),
 * kat s (loca araması), derinlik d, montaj wall (duvara / loca arka duvarına dayalı) | side (loca yan duvarı) |
 * front (balkon ön kenarının arkası), off (duvardan uzaklık), renkler.
 */
export interface CBox {
  t: 'box';
  kind: string;
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  s: number;
  d: number;
  off: number;
  mount: string;
  color: string | null;
  color2: string | null;
}
/** v7 (signs.ts): tabela yazısı / renk alanları (sign ile ortak) */
export interface SignText {
  text: string;
  lines?: { text: string; fg?: string; size?: number; bold?: boolean }[] | null;
  bg: string | null;
  fg: string;
  border: string | null;
  font: string;
  bold: boolean;
  lit: boolean;
  shape?: string | null;
  glyphs?: { ch: string; mirror?: boolean }[] | null;
  join?: number | null;
  capH?: number | null;
  align?: string | null;
  /** v11: eğik yazı */
  italic?: boolean | null;
}
/**
 * v7: bayrak (cepheye dik, çift yüzlü) tabela: duvardaki u, y0..y1, pano duvardan gap'ten gap + w'ye, kalınlık d;
 * B yüzünde farklı yazı (textB / linesB); taşıyıcı (arm | plate | none) + renk.
 */
export interface CBlade extends SignText {
  t: 'blade';
  u: number;
  y0: number;
  y1: number;
  w: number;
  gap: number;
  d: number;
  textB?: string | null;
  linesB?: { text: string; fg?: string; size?: number; bold?: boolean }[] | null;
  bracket?: { kind?: string; color?: string | null } | null;
}
/**
 * v7: cam üstü folyo yazı (pencere camı düzleminde, kutu değil): u0..u1 × y0..y1 (tabandan); off = duvar düzleminden
 * uzaklık (verilmezse pencere camı düzlemi, −0.096; çıkma camında çıkma d + 0.016)
 */
export interface CVinyl extends SignText {
  t: 'vinyl';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  off?: number | null;
}
/**
 * v7: çatı harf tabelası: çatı kenarının gerisinde (setback) çelik iskelet üstünde tek tek (3B) harfler; y0..y1
 * harf alt / üst kotu (tabandan), d harf derinliği, frame {color, h (iskelet yüksekliği harf altında), posts}
 */
export interface CRoofSign extends SignText {
  t: 'roofsign';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  setback: number;
  d: number;
  /**
   * v11: `under: true` — iskelet yalnız harflerin ALTINDA (dikmeler harf alt kotunda biter, harf arkası kuşak yok);
   * fotoğrafta dikmeler harflerin arasından görünmüyorsa (900000203 TAŞYAKAN, sswNcGS2_0_0). Verilmezse eski iskelet
   * (dikmeler harf üstüne kadar, harf arkasında kuşaklar).
   */
  frame?: { color?: string | null; h?: number; posts?: number; under?: boolean } | null;
}
/** v7: LED ekran (gece parlak): u0..u1 × y0..y1, kutu derinliği d, çerçeve rengi, görülen içerik rengi / yazısı */
export interface CScreen extends SignText {
  t: 'screen';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  d: number;
  off: number;
  frame: string | null;
  /** Görüntü alanı çevresindeki çerçeve payı (m, varsayılan 0.05) */
  bezel?: number | null;
  blocks?: { x0: number; x1: number; y0: number; y1: number; color: string }[] | null;
}
/** v7: neon / LED şerit: cephe düzleminde (u, y) çoklu çizgi (tabandan), kapalı mı, tüp çapı, duvardan uzaklık, renk */
export interface CNeon {
  t: 'neon';
  pts: [number, number][];
  closed: boolean;
  d: number;
  off: number;
  color: string | null;
}
export type CItem =
  | CWin
  | CStrip
  | CBal
  | CPipe
  | CUnit
  | CPanel
  | CEntrance
  | CProj
  | CSign
  | CAwning
  | CGroove
  | CVent
  | CPilaster
  | CPediment
  | CRecess
  | CMast
  | CCloth
  | CBanner
  | CLamp
  | CDormer
  | CArch
  | CRoofObj
  | CRibbon
  | CRod
  | CSteps
  | CBox
  | CBlade
  | CVinyl
  | CRoofSign
  | CScreen
  | CNeon;

/** Çatı / teras pergolası (dünya çokgeni, blok tabanına göre y0..y1) */
export interface CPergola {
  poly: [number, number][];
  y0: number;
  y1: number;
  color?: string | null;
  post?: number;
  every?: number;
  beam?: number;
  slat?: number;
  cover?: string | null;
  /**
   * v7 eğim: üst kot `slopeEdge` kenarında (poly kenar indeksi, varsayılan 0) y1, karşı uçta (kenardan en uzak nokta)
   * y1s — tek yöne eğik örtü
   */
  y1s?: number | null;
  slopeEdge?: number | null;
  /** v7: lameller bu poly kenarına PARALEL (verilmezse en uzun kenara dik — eski) */
  slatEdge?: number | null;
  /** v7: dikmeler yalnız bu kenarlarda (verilmezse tüm kenarlar) ya da açık dünya konumları */
  postEdges?: number[] | null;
  posts?: [number, number][] | null;
  /**
   * v7: kirişler `edge` kenarına DİK, o kenardaki her dikmeden çokgenin karşı kenarına uzanır; kenardan dışarı
   * `over` m taşar, taşan ucunda `capC` renkli kapak
   */
  beams?: { edge: number; over?: number | null; capC?: string | null } | null;
}

/**
 * Ek hacim: dünya koordinatında çokgen taban, blok tabanına göre y0..y1. Duvar rengi, üst bant, düz çatı (+ parapet /
 * korkuluk), seçili kenarlarda giydirme cam (dikme aralığı, cam ve doğrama rengi). Ölçüm dosyasından aynen gelir.
 */
export interface CVolume {
  poly: [number, number][];
  y0: number;
  y1: number;
  color: string;
  band?: { h: number; color: string } | null;
  roofC?: string | null;
  parapet?: CParapet | null;
  glazing?: {
    edges: number[] | 'all';
    from: number;
    to: number;
    mullion: number;
    glass: string;
    frame: string;
    /** Yatay kayıt (travers) aralığı (m); verilmezse yalnız alt/üst kayıt */
    transom?: number | null;
  } | null;
  collide?: boolean;
  /**
   * Eğik çatı (düz çatı yerine): gable (alınlıklı beşik; `gables` alınlık kenarları, poly kenar indeksi), hipped
   * (kırma), vault (tonoz: `axis` kenarına paralel, `rise` yükseklik). Renk "tile" = blok kiremidi ya da "#rrggbb".
   */
  roof?: {
    kind: string;
    pitch?: number | null;
    rise?: number | null;
    eave?: number | null;
    gables?: number[] | null;
    axis?: number | null;
    color?: string | null;
    gableC?: string | null;
    /** v7 (tonoz): tonoz boyunca `every` m arayla yayı izleyen kaburgalar (genişlik w, yüzeyden yükseklik h, renk) */
    ribs?: { every: number; w?: number | null; h?: number | null; color?: string | null } | null;
    /**
     * v7 (tonoz): camlı alın yüzleri: ends both | start (eksen kenarının başı, u0) | end; cam rengi, dikme rengi, dikme
     * aralığı; band = yayın altında dolu kavisli bant kalınlığı (m, gableC renginde)
     */
    endGlass?: {
      ends?: string | null;
      glass: string;
      frame?: string | null;
      mullion?: number | null;
      band?: number | null;
    } | null;
  } | null;
  /**
   * v7: hacim çatısı üstü öğeler (baca, havalandırma, çanak, direk): dünya konumu [x, z], çatı yüzeyinden yükseklik h,
   * en w, derinlik d, renk, başlık (CRoofObj ile aynı alanlar; u / setback yerine konum)
   */
  objs?: (Omit<CRoofObj, 't' | 'u' | 'setback'> & { at: [number, number] })[] | null;
  /** Hacim yüzlerindeki pencere/kapılar: poly kenarı, kenar boyunca u (m), blok tabanından y (m) */
  wins?:
    | {
        edge: number;
        u0: number;
        u1: number;
        y0: number;
        y1: number;
        kind?: string | null;
        split?: number | null;
        curt?: string | null;
        frameC?: string | null;
        shut?: number | null;
        shutC?: string | null;
      }[]
    | null;
}

/** Çatı / hacim parapeti (ölçüm dosyasından aynen) */
export interface CParapet {
  h: number;
  color?: string | null;
  rail?: string | null;
  railC?: string | null;
  glassC?: string | null;
  /** Küpeşte yüksekliği parapet üstünden (m, varsayılan 0.92) */
  railH?: number | null;
  /** Yalnız bu kenarlarda parapet (diğerlerinde saçak alnı); verilmezse tüm kenarlar */
  edges?: number[] | null;
  /** Korkuluk yalnız bu kenarlarda; verilmezse parapetli tüm kenarlar */
  railEdges?: number[] | null;
  /** Harpuşta (parapet üstü şapka): yükseklik, iki yana taşma, renk */
  coping?: { h: number; over?: number; color?: string | null } | null;
  /** Parapet dış yüzünün alt bandı (ör. 0.5 m beyaz döşeme alnı) */
  band?: { h: number; color: string } | null;
  /** v9: duvar üstünü aşan açıklıklar (giydirme cam) parapetin dış yüzünü keser */
  glassUp?: boolean | null;
  /** v9 (tube): küpeşte rengi, ara çubuk sayısı / aralığı, dikme aralığı */
  railTopC?: string | null;
  rows?: number | null;
  rowGap?: number | null;
  postEvery?: number | null;
  /** v9: kenar bazında korkuluk (dünya noktasına en yakın kenar) */
  edgeRails?:
    | {
        at: [number, number];
        rail?: string | null;
        railC?: string | null;
        railTopC?: string | null;
        rows?: number | null;
        rowGap?: number | null;
        postEvery?: number | null;
        railH?: number | null;
      }[]
    | null;
}
export interface CompiledBlock {
  id: number;
  name: string | null;
  ring: V2[];
  storeys: number;
  floorH: number;
  groundRaise: number;
  roof: {
    kind: string;
    eave: number;
    fasciaH: number;
    pitch?: number;
    /** Çatı kenarında dolu parapet (+ üstünde korkuluk); varsa saçak alnı yerine çizilir */
    parapet?: CParapet | null;
    /** Alınlık üçgenlerinin rengi (palet adı / "#rrggbb"), tek değer ya da kenar → renk */
    gableC?: string | Record<string, string> | null;
    /** Saçak alın bandı rengi (verilmezse plaster2) */
    fasciaC?: string | null;
    /**
     * v9: saçak alnının yeri — "tip" saçak ucunda (+ alt yüz, uç dönüşleri), "wall" duvar hizasında (eski). Verilmezse
     * düz çatıda "tip", eğik çatıda "wall".
     */
    fasciaAt?: 'tip' | 'wall' | null;
    /** Saçak altı gömme spotları */
    spots?: { every?: number; inset?: number; d?: number; edges?: number[] } | null;
    /** v7: açık mahyalı kanat çatıları (roofWing.ts) — birleşik kırma çatının otomatik mahyası yerine */
    wings?: RoofWing[] | null;
    /** v7: kenar bazında saçak taşması: dünya noktasına (≤ 1.5 m) en yakın taban izi kenarı → eave (m) */
    eaves?: { at: [number, number]; eave: number }[] | null;
    /** v7: düz çatı / teras yüzeyi rengi */
    flatC?: string | null;
    /** Rüzgârlık tahtası (alınlık eğik kenar bandı) boyu (m); verilmezse 0.22 — ince alüminyum kenar ≈0.03–0.05 */
    barge?: number | null;
  };
  /** Subasman bandı yüksekliği tabandan (m); 0 = subasman yok. Verilmezse zemin kat döşemesine (≤ 1.2 m) */
  plinthH?: number | null;
  /**
   * Duvar üstü (saçak alnı / parapet başlangıcı) kotu tabandan gerçek m — verilmezse son kat döşemesi + 0.12.
   * Kütle parçasında (massing.towers[].wallTop) parçanın kendi saçak kotu.
   */
  wallTop?: number | null;
  /** Kat başına kat yüksekliği (K0'dan; eksik katlar floorH) */
  floorHs?: number[] | null;
  /** Ek hacimler (dünya çokgeni): tek katlı ek, kış bahçesi, çatı odası… */
  volumes?: CVolume[] | null;
  /** Çatı / teras pergolaları (dünya çokgeni) */
  pergolas?: CPergola[] | null;
  /** v9: taban izi kenarlarından bağımsız sürekli konsol balkon döşemeleri (dünya ön hattı, kat aralığı) */
  slabFronts?: CSlabFront[] | null;
  colors: Record<string, string>;
  edges: { edge: number; len: number; seen: string; items: CItem[] }[];
  /** Zemin kat podyumu üstünde ayrık kuleler (x aralıkları) */
  massing?: {
    towers: {
      x?: [number, number];
      z?: [number, number];
      /** Dünya çokgeni (döndürülmüş şerit vb.) */
      poly?: [number, number][];
      /** Taban izinin diğer parçalar dışında kalanı */
      rest?: boolean;
      storeys?: number;
      roof?: Partial<CompiledBlock['roof']>;
      /** Parçanın duvar üstü kotu (tabandan m), kat yüksekliği / kat başına yükseklikleri */
      wallTop?: number;
      floorH?: number;
      floorHs?: number[];
    }[];
    gap?: { x: [number, number] };
  };
  /**
   * v8: kütle kesim yüzü kenarları (survey `cutEdges`, gerçek m): massing.ts splitMassing bunları parçanın doğruya
   * uyan kesim kenarlarına dağıtır; bölünmüş parçada normal `edges` kaydı olarak çizilir.
   */
  cutEdges?: CCutEdge[] | null;
  /**
   * v8: duvarların / öğelerin başladığı kot (tabandan gerçek m) — podyumun üstünde ayrı ölçülmüş kule: alt kısım
   * (podyumun içinde kalan K0–K1) çizilmez, kat ızgarası zeminden sayılmaya devam eder. Survey `baseH` / `startK`.
   */
  baseH?: number | null;
}

/**
 * v9: sürekli konsol balkon döşemesi + korkuluk (survey `slabFronts`, gerçek m, DÜNYA): `pts` döşemenin ÖN hattı
 * (açık çoklu çizgi), `s` kat aralığı [k0, k1]; `alt` tek katlarda farklı ön hat; `offK` kat → ön hattın dışa (+) /
 * içe (−) kayması (m). Döşeme ön hattan `depth` (m, 2.0) içeri uzanan şerittir: taban izinin dolu (duvar) kısmına
 * düşen parça çizilmez, aynı kattaki loca döşemesi / tavanı / korkuluğu şerit ve önündeki bölgede kesilir (ön hat
 * taban izinin içinde kalan yerde loca ağzı açık hava olur). `d` döşeme alnı kalınlığı (0.35).
 */
export interface CSlabFront {
  pts: V2[];
  s: [number, number];
  alt?: V2[] | null;
  offK?: Record<string, number> | null;
  d?: number | null;
  depth?: number | null;
  rail?: string | null;
  railH?: number | null;
  glassC?: string | null;
  railC?: string | null;
  postEvery?: number | null;
  fasciaC?: string | null;
}

/** v8: derlenmiş kesim yüzü kenarı — u = `a`'dan doğru boyunca (m) */
export interface CCutEdge {
  part: number | 'gap';
  a: V2;
  e: V2;
  len: number;
  seen: string;
  tol?: number;
  items: CItem[];
}

/** Ölçülen renk türü → dinamik malzeme (index.ts colorKey) */
export type CK =
  | 'plaster'
  | 'fascia'
  | 'metal'
  | 'awning'
  | 'glass'
  | 'frame'
  | 'tint'
  | 'shutter'
  | 'blind'
  /**
   * Derzli kaplama: `clad:<v|h|g|n>:<aralık m>:<derz genişliği m>:<derz #rrggbb>[:<ikinci aralık>][:<acp|matte>]`
   * (renk = kaplama rengi; g = iki yönde derz, n = derzsiz yalnız bitiş)
   */
  | `clad:${string}`
  /** v7: uzakta sönümlenen sıva derzi (yakında koyu şerit, ~30 m ötede görünmez: uzak mesafede kesikli çizgi olmasın) */
  | 'groove'
  /** v7: neon / LED şerit (gece parlayan ışıklı tüp) */
  | 'neon'
  /** v7: çok renkli karo bandı `tiles:<karo m>:<#renk,…>:<sıra>` (renk alanı = derz rengi) */
  | `tiles:${string}`
  /** v7: kare güvenlik kafesi `cage:<göz m>` (renk = tel rengi) */
  | `cage:${string}`
  /** v7: cam folyo `film:<desen>` (renk = folyo rengi, yarı saydam desen) */
  | `film:${string}`
  /** v7: cam balkon `camglass:<dikme aralığı m>` (renk = dikme / profil rengi) */
  | `camglass:${string}`;

/** Blok paleti: malzeme anahtarı eşlemesi (ör. mkPlaster → mkPlaster_1480041342) */
let KM: Record<string, string> = {};
/** Ölçülen özel renk → malzeme anahtarı (buildFacadeBlock süresince) */
let CKF: ((kind: CK, hex: string) => string) | null = null;
/** Pah boyu (buildFacadeBlock süresince; 0 = pahsız) */
let BEV = 0;
const ckm = (kind: CK, hex: string | null | undefined, dflt: string) =>
  hex && /^#[0-9a-f]{6}$/i.test(hex) && CKF ? CKF(kind, hex) : dflt;
const K = (k: string) => KM[k] ?? k;

const REVEAL = 0.12;
const FRAME = 0.06;
const SLAB = 0.16;
const PARAPET = 0.38; // gri dolu parapet üstü (döşemeden)
const RAIL0 = 0.92; // küpeşte (varsayılan)
const RAIL = RAIL0;
const MIN_OPEN = 0.25;

/** Ölçüm perde adları → cam gölgelendiricisi türü (facadeMats.windowGlassMaterial) */
const CURT: Record<string, number> = {
  tul: 0,
  'tul-yan': 1,
  stor: 2,
  jaluzi: 3,
  karanlik: 4,
  zebra: 5,
  acik: 6,
  vitrin: 7,
  /** Kalın fon perde (renk curtC, kapanma curtF; varsayılan tamamen kapalı) */
  fon: 8,
  /** v10: perdesiz ofis camı (iç karanlık, yansıma ofis çarpanında — facadeMats officeEnvUniform) */
  ofis: 9,
};

/**
 * Çıkma (`proj`) yüzündeki pencerenin oda gölgelendirici türü. Ölçülen perde > küçük pencere (karanlık) > vitrin.
 * Önceden perdesiz her çıkma penceresi tül (0) alıyordu → zemin kattaki dükkân camları (1477364957 Juan Valdez /
 * ROSSMANN / BIGCHEFS, y 0.21–4.62) bembeyaz tül göründü (oyun #c2c3c5, fotoğraf #363727; critic d4c #7).
 * KARAR: addWindow kuralıyla aynı — `shop` her yerde, zemin kotundan başlayan (y0 < 1 m) kapı ya da ≥ 2.2 m boyunda
 * cam (vitrin / giriş) koyu vitrin (7); üst kat perdesiz camlar eskisi gibi tül.
 */
export function projWinKind(wn: {
  kind?: string | null;
  curt?: string | null;
  y0: number;
  y1: number;
  u0?: number;
  u1?: number;
}): number {
  if (wn.curt != null) return CURT[wn.curt] ?? 0;
  if (wn.kind === 'small') return 4;
  if (wn.kind === 'shop') return 7;
  if (wn.y0 < 1 && (wn.kind === 'door' || wn.y1 - wn.y0 >= 2.2)) return 7;
  if (wn.u0 != null && wn.u1 != null && wn.u1 - wn.u0 >= PROJ_BAND_W && wn.kind !== 'glassband')
    return PROJ_BAND_KIND;
  return 0;
}

/**
 * v10: üst kat perdesiz çıkma penceresi şerit cam (podyum asma katı ofis bandı) eşiği. KARAR: ölçülmüş tüm çıkma
 * pencerelerinde konut / dükkân camı ≤ 3.4 m (900000101), ≥ 6 m tek parça şerit yalnız podyum K1 bantlarında
 * (1477364957 31.8 m, 900000261 36.7 m; qo16 180 / sd8u 180: koyu yansıtıcı ofis camı #6b7163–#75796c, tül yok) →
 * tül yerine ofis camı (tür 9 `ofis`: iç karanlık, gök yansıması ofis çarpanında — pencere çarpanı ×14 ile #aaabae
 * kalıyordu). Perde ölçülmüşse ölçüm kazanır.
 */
export const PROJ_BAND_W = 6;
export const PROJ_BAND_KIND = 9;

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Tabela / pankart yüzü tarifi (signFace → malzeme / atlas anahtarı) */
export interface SignSpec {
  text: string;
  bg: string | null;
  fg: string;
  font: string;
  bold: boolean;
  lit: boolean;
  style: string;
  border: string | null;
  w: number;
  h: number;
  lines?: { text: string; fg?: string; size?: number; bold?: boolean; y?: number }[] | null;
  outline?: string | null;
  /** v11: harf konturu kalınlığı (m) */
  outlineW?: number | null;
  /** v11: yazı ölçülen genişliği doldurur (capH ile birlikte; yatay genişletme ≤ 1.6, sıkıştırma ≥ 0.5) */
  stretch?: boolean | null;
  /** v11: eğik (italik) yazı */
  italic?: boolean | null;
  shape?: string | null;
  icon?: string | null;
  iconC?: string | null;
  /** Pankart / bayrak dokusu türü (portrait, tr-v, tr, plain; v7 print) — verilirse tabela yerine pankart dokusu */
  banner?: string | null;
  /** Monogram / glif harfleri (ayna simetrik olabilir) ve bindirme oranı */
  glyphs?: { ch: string; mirror?: boolean }[] | null;
  join?: number | null;
  /** Kalın (katmanlı) harflerin yan katmanı: koyulaştırılmış, ışıksız */
  side?: boolean;
  /** v7: ölçülen büyük harf yüksekliği (m) ve hiza */
  capH?: number | null;
  align?: string | null;
  /** v7: ışık halesi (arkadan aydınlatmalı harf): hale rengi, harf kutusunun çevresindeki pay (m) */
  halo?: string | null;
  haloPad?: number;
  /** v7: renk blokları (pankart / ekran içeriği; 0..1 oranları) ve file pankart */
  blocks?: { x0: number; x1: number; y0: number; y1: number; color: string }[] | null;
  mesh?: boolean | null;
}

export interface FacadeOptions {
  seed: number;
  /** Zemin kattaki balkonlar için çarpışma (plan çokgeni, alt/üst kot) */
  collide?: (ring: [number, number][], bottom: number, top: number) => void;
  /** Blok adı levhası malzeme anahtarı */
  signKey?: string;
  /** Blok paleti malzeme anahtarı eşlemesi */
  keys?: Record<string, string>;
  /** Ölçülen özel renk için malzeme anahtarı (tür: plaster/fascia/metal/awning) */
  colorKey?: (kind: CK, hex: string) => string;
  /** Tabela yüzü malzemesi (yazı dokusu); v7: index.ts tabela atlasına kaydeder (tabela başına doku yok) */
  signFace?: (s: SignSpec) => string;
  /**
   * Pah (m, 0 = yok): Yüksek/Ultra kalitede döşeme alnı, parapet üstü, denizlik, harpuşta kenarları 1–3 cm pahlı
   * (beton kenarları ışığı yakalasın). Düşük/Orta kalitede 0 — geometri değişmez.
   */
  bevel?: number;
}

/** buildFacadeBlock sonucu: çatı tepe kotu + zemine inen girinti ağızları (çarpışma halkasından çıkarılır) */
export interface FacadeResult {
  top: number;
  /** Zemin kotundaki girinti ağızları (dünya çokgeni): yürünebilir, çarpışma halkasından çıkarılmalı */
  holes: [number, number][][];
}

interface Edge {
  a: V2;
  e: V2;
  len: number;
  t: V2;
  n: V2;
  yaw: number;
  /** Çevre boyunca başlangıç (sürekli doku için) */
  s0: number;
}

interface Opening {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  win: CWin;
  k: number;
  /** Kat döşemesi kotu (yatay kayıtlar için) */
  fy?: number;
  /** v7: açıklığın ölçüldüğü taban izi kenarı (loca arka duvarına taşınanlar; köşe locasında komşu kenar) */
  edge?: number;
}

/** Plan çokgeni yardımcıları */
function area2(r: V2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
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

function inside(r: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function openRing(r: [number, number][]): V2[] {
  const o = r.map((p) => [p[0], p[1]] as V2);
  if (o.length > 1) {
    const f = o[0];
    const l = o[o.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) o.pop();
  }
  return o;
}

export function buildFacadeBlock(
  b: Builder,
  blk: CompiledBlock,
  base: number,
  o: FacadeOptions,
): FacadeResult {
  KM = o.keys ?? {};
  CKF = o.colorKey ?? null;
  BEV = Math.max(0, Math.min(0.03, o.bevel ?? 0));
  try {
    return buildBlock(b, blk, base, o);
  } finally {
    KM = {};
    CKF = null;
    BEV = 0;
  }
}

/**
 * Bina çarpışma halkası: taban izi − zemine inen girinti ağızları (girintili dükkân hattı, kapı yuvası yürünebilir).
 * Girinti yoksa taban izinin kendisi.
 */
export function footCollision(ring: [number, number][], holes: [number, number][][]): [number, number][][] {
  if (!holes.length) return [ring];
  try {
    const mp = pc.difference([ring], ...holes.map((h) => [h] as pcNs.Polygon));
    const out: [number, number][][] = [];
    for (const poly of mp) {
      const r = openRing(poly[0] as [number, number][]);
      if (r.length >= 3 && Math.abs(area2(r)) > 0.05) out.push(r.map((p) => [p[0], p[1]]));
    }
    return out.length ? out : [ring];
  } catch {
    return [ring];
  }
}

/**
 * v8 `baseH`: podyumun üstünde ayrı ölçülmüş kulenin gizli alt kısmı (tabandan baseH m'ye kadar) çizilmez. Öğeler:
 * tamamen altta kalanlar atılır; kat listeli öğelerden (win / bal / lamp) altta kalan katlar, kat aralıklı
 * (pilaster / recess) öğelerin alt katları, bant / pano / şerit / boru / çıkma alt kenarları baseH'ye kırpılır.
 * floorRel(k) = kat k döşemesinin tabandan yüksekliği. Kat ızgarası değişmez (katlar zeminden sayılır).
 */
export function clipItemsAbove(its: CItem[], baseH: number, floorRel: (k: number) => number): CItem[] {
  const EPS = 0.05;
  // Görünen kat: üst döşemesi baseH'nin üstünde
  const vis = (k: number) => floorRel(k + 1) > baseH + EPS;
  let K0 = -1;
  while (K0 < 200 && !vis(K0)) K0++;
  const out: CItem[] = [];
  for (const it of its) {
    const o = { ...it } as CItem & Record<string, unknown>;
    if (o.t === 'win' || o.t === 'bal') {
      o.storeys = o.storeys.filter(vis);
      if (!o.storeys.length) continue;
    } else if (o.t === 'lamp') {
      if (o.storeys) {
        o.storeys = o.storeys.filter(vis);
        if (!o.storeys.length) continue;
      } else if (o.y != null && o.y <= baseH) continue;
    } else if (o.t === 'pilaster' || o.t === 'recess') {
      if (o.storeys) {
        if (o.storeys[1] < K0) continue;
        o.storeys = [Math.max(o.storeys[0], K0), o.storeys[1]];
      } else if (o.y0 != null && o.y1 != null) {
        if (o.y1 <= baseH + 1e-3) continue;
        o.y0 = Math.max(o.y0, baseH);
      }
    } else if (o.t === 'ac' || o.t === 'dish' || o.t === 'camera' || o.t === 'flag' || o.t === 'box') {
      if (!vis(o.s)) continue;
    } else if (o.t === 'entrance' || o.t === 'steps') {
      continue;
    } else if (o.t === 'pipe') {
      if (o.y1 != null && o.y1 <= baseH + 1e-3) continue;
      o.y0 = Math.max(o.y0 ?? -1, baseH);
    } else if (o.t === 'ribbon') {
      if (!o.pts.some((p) => p[1] > baseH)) continue;
    } else if (o.t === 'neon') {
      if (!o.pts.some((p) => p[1] > baseH)) continue;
    } else if (o.t === 'rod') {
      if (o.a[1] <= baseH && o.e[1] <= baseH) continue;
    } else if (o.t === 'awning' || o.t === 'vent') {
      if (o.y <= baseH) continue;
    } else if (o.t === 'groove') {
      if (o.dir === 'v' ? (o.y1 ?? 0) <= baseH : (o.y ?? 0) <= baseH) continue;
      if (o.dir === 'v' && o.y0 != null) o.y0 = Math.max(o.y0, baseH);
    } else if (o.t === 'mast') {
      if (o.y0 != null && o.y0 + o.h <= baseH) continue;
    } else if ('y0' in o && 'y1' in o && typeof o.y1 === 'number') {
      // bant / pano / şerit / çıkma / tabela / pankart / bez …: tamamen altta → yok; kırpılabilenler baseH'den
      if (o.y1 <= baseH + 1e-3) continue;
      if (
        (o.t === 'band' || o.t === 'panel' || o.t === 'strip' || o.t === 'proj') &&
        typeof o.y0 === 'number'
      )
        o.y0 = Math.max(o.y0, baseH);
    }
    out.push(o as CItem);
  }
  return out;
}

function buildBlock(b: Builder, blk: CompiledBlock, base: number, o: FacadeOptions): FacadeResult {
  const ring = blk.ring.map((p) => [p[0], p[1]] as V2);
  const N = ring.length;
  const FH = blk.floorH;
  const S = blk.storeys;
  // Kat yükseklikleri eşit değilse (ör. 4.0 m dükkân katı + 2.7 m üst kat) birikimli toplam
  const FHS = blk.floorHs?.length ? blk.floorHs : null;
  const cum: number[] = [0];
  for (let k = 0; k < S + 1; k++) cum.push(cum[k] + (FHS?.[k] ?? FH));
  const floorY = (k: number) =>
    base + blk.groundRaise + (FHS ? cum[Math.max(0, Math.min(k, S + 1))] : k * FH);
  const storeyH = (k: number) => FHS?.[k] ?? FH;
  // Ölçülmüş duvar üstü (saçak alt kotu) verilmişse o; yoksa son kat döşemesi + 0.12
  const wallTop = blk.wallTop != null && blk.wallTop > 0.5 ? base + blk.wallTop : floorY(S) + 0.12;
  const E: Edge[] = [];
  let per = 0;
  for (let i = 0; i < N; i++) {
    const a = ring[i];
    const e = ring[(i + 1) % N];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
    const t: V2 = len > 0 ? [(e[0] - a[0]) / len, (e[1] - a[1]) / len] : [1, 0];
    E.push({ a, e, len, t, n: [-t[1], t[0]], yaw: Math.atan2(-t[1], t[0]), s0: per });
    per += len;
  }
  const P = (i: number, u: number, off = 0): V2 => {
    const { a, t, n } = E[i];
    return [a[0] + t[0] * u + n[0] * off, a[1] + t[1] * u + n[1] * off];
  };
  // v8: podyum üstündeki kulenin gizli alt kısmı (baseH, tabandan m) — duvar, subasman ve öğeler baseH'den başlar
  const hideH = blk.baseH != null && blk.baseH > 0.01 ? blk.baseH : null;
  const byEdge = new Map(
    blk.edges.map((e) => [
      e.edge,
      hideH != null ? clipItemsAbove(e.items, hideH, (k) => floorY(k) - base) : e.items,
    ]),
  );
  const items = (i: number) => byEdge.get(i) ?? [];
  // Ölçülen özel renkler → malzeme anahtarı (yoksa blok paleti)
  const ck = (kind: CK, hex: string | null | undefined, dflt: string) =>
    hex && /^#[0-9a-f]{6}$/i.test(hex) && o.colorKey ? o.colorKey(kind, hex) : dflt;
  /**
   * v7: cam balkon malzemesi — ölçülen dikme aralığı (glazeEvery) ya da profil rengi (frameC) verilmişse dikmeler o
   * aralıkta / renkte (önceden sabit 0.72 m açık gri: koyu camda dağınık beyaz çizgiler gibi görünüyordu)
   */
  const camGlassKey = (it: CBal, k: number): string => {
    const fc = it.frameC?.[String(k)] ?? it.frameC?.['*'];
    const ev = it.glazeEvery != null && it.glazeEvery > 0.2 ? it.glazeEvery : null;
    if (!ev && !fc) return 'mkCamGlass';
    return ck(`camglass:${Math.round((ev ?? 0.72) * 1000) / 1000}`, fc ?? '#d8dadb', 'mkCamGlass');
  };
  /** Balkon kat korkuluğu (ölçüm: kat kat tip/renk) */
  const railSpecOf = (it: CBal, k: number): RailSpec => {
    const kk = String(k);
    return {
      type: it.rail?.[kk] ?? it.rail?.['*'] ?? 'glass',
      fKey: ck('fascia', it.fasciaC?.[kk] ?? it.fasciaC?.['*'], K('mkFascia')),
      mKey: ck('metal', it.railC, 'mkRail'),
      parH: it.parapetH?.[kk] ?? it.parapetH?.['*'] ?? PARAPET,
      net: it.net?.includes(k) ?? false,
      gKey: ck('glass', it.glassC?.[kk] ?? it.glassC?.['*'], K('mkRailGlass')),
      railH: it.railH?.[kk] ?? it.railH?.['*'],
      drop: it.beam?.[kk] ?? it.beam?.['*'],
      curved: !!(it.bulge || it.round),
      hand: it.hand?.[kk] ?? it.hand?.['*'],
      postEvery: it.postEvery ?? undefined,
      postW: it.postW ?? undefined,
      ...((): Partial<RailSpec> => {
        const cp = it.coping?.[kk] ?? it.coping?.['*'];
        return cp && cp.h > 0.01
          ? { copH: cp.h, copOver: cp.over ?? 0.02, copK: ck('frame', cp.color ?? null, K('mkFascia')) }
          : {};
      })(),
    };
  };
  // İçe gömük balkonlar (d ≈ 0): taban izi içinde boşluk (void) dikdörtgenleri, kat başına
  // Kavisli (bulge) balkon d = 0 olsa da taşan balkondur (duvardan duvara yay) — inset verilmişse gömük loca kalır:
  // loca derinliği korunur, kavisli ön kısım (taban izi hattından yaya kadar) ayrıca taşan balkon olarak çizilir
  const curvedLoggia = (it: CBal) => it.d < 0.35 && (it.inset ?? 0) > 0 && (it.bulge ?? 0) > 0.05;
  // v7 (hata düzeltmesi): d ≥ 0.35 + inset → taşan + gömük balkon: loca derinliği inset (taban izi içinde) + döşeme
  // d kadar dışarı taşar (1546358557 d 0.55 + inset 0.95 = 1.5 m; önceden inset yok sayılıyordu)
  const deepLoggia = (it: CBal) => it.d >= 0.35 && (it.inset ?? 0) > 0.05;
  const isRecessed = (it: CBal) =>
    (it.d < 0.35 && (!(it.bulge && it.bulge > 0.05) || curvedLoggia(it))) || deepLoggia(it);
  interface Void {
    id: number;
    edge: number;
    u0: number;
    u1: number;
    inset: number;
    it: CBal;
    /** Köşe locası: birleştirilen komşu kenar (o kenarın ölçülmüş açıklıkları da bu locaya aittir) */
    absorbed?: number;
    /**
     * v7 (hata düzeltmesi): dikdörtgenin arka kenarı bu taban izi kenarının hattına düşüyor ve o kenar da açık loca
     * (üç yanı açık yığın / zincir) → arka kenar o hattın 2 cm dışına itilir (önceden hat üstünde kalıp rastgele ince
     * şerit + tam boy duvar üretiyordu)
     */
    backOut?: number;
  }
  const voids: Void[] = [];
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t !== 'bal' || !isRecessed(it)) continue;
      const u0 = Math.max(0, it.u0);
      const u1 = Math.min(E[i].len, it.u1);
      if (u1 - u0 < 0.5) continue;
      voids.push({ id: voids.length, edge: i, u0, u1, inset: it.inset ?? 0, it });
    }
  // Köşe locaları: kenar sonundaki gömük balkon + sonraki kenarın başındaki gömük balkon = tek dikdörtgen
  // (derinlikler birbirinin genişliğinden). Açıkça verilmemiş derinlikler: tek başına 1.5 m (d>0 ise 1.1 m).
  const TOL = 1.2;
  const drop = new Set<number>();
  for (const A of voids) {
    if (A.u1 < E[A.edge].len - TOL) continue;
    const nx = (A.edge + 1) % N;
    const Bv = voids.find((v) => v.edge === nx && v.u0 < TOL && !drop.has(v.id));
    if (!Bv) continue;
    // v7: merge: false → ayrı hacimler (ör. 1480163634 e5 dar locası e4 cam yığını boşluğuyla birleşip 7 m derin
    // arka duvar oluyordu)
    if (A.it.merge === false || Bv.it.merge === false) continue;
    // Köşe dışbükey mi? (sonraki kenar −n yönünde)
    const ea = E[A.edge];
    const eb = E[nx];
    if (eb.t[0] * -ea.n[0] + eb.t[1] * -ea.n[1] < 0.9) continue;
    // v7 (hata düzeltmesi): A zaten önceki kenarın locasına (W) katılmışsa (üç yanı açık yığın: X sonu + Y + Z başı)
    // A'nın dikdörtgeni yok — önceden Z'nin locası da atılıp kayboluyordu. Z köşeden başlıyor ve W'nin genişliğini
    // aşmıyorsa W'ye katılır (arka kenarı Z hattının dışına itilir, aşağıda); yoksa Z kendi locası olarak kalır.
    if (drop.has(A.id)) {
      const W = voids.find((w) => w.absorbed === A.edge && !drop.has(w.id));
      if (W && Bv.u0 < 0.3 && Bv.u1 <= E[W.edge].len - W.u0 + 0.3) drop.add(Bv.id);
      continue;
    }
    A.u1 = ea.len;
    // v7 (hata düzeltmesi): köşe locasının B boyunca derinliği B'nin ölçülen açıklığı (en çok B boyu); önceden 3.2 m'de
    // kırpılıyordu (1480041344 e5: 4.83 m cam yığınının 1.63 m'si düz duvar)
    if (!A.it.inset) A.inset = Math.min(eb.len, Bv.u1);
    Bv.u0 = 0;
    if (!Bv.it.inset) Bv.inset = Math.min(3.2, ea.len - A.u0);
    // Aynı dikdörtgen: B'yi yalnızca cam/renk bilgisi için tut, boşluk üretmesin
    drop.add(Bv.id);
    A.absorbed = nx;
  }
  for (const v of voids) if (!v.inset) v.inset = v.it.d > 0.05 ? 1.1 : 1.5;
  for (const v of voids)
    v.inset = Math.max(0.6, Math.min(v.absorbed != null ? Math.max(3.2, E[v.absorbed].len) : 3.2, v.inset));
  // v7: köşe locasının arka kenarı B'den sonraki kenar (C) hattına düşüyorsa ve C'de köşeden başlayan gömük balkon
  // varsa (0.5 m'den kısa olanlar dahil — 1480041344 e6) arka kenar C hattının dışına itilir (C yüzü açık)
  for (const v of voids) {
    if (v.absorbed == null) continue;
    const c = (v.absorbed + 1) % N;
    const ec = E[c];
    const ea = E[v.edge];
    if (c === v.edge || ec.len < 0.05 || Math.abs(ec.t[0] * ea.t[0] + ec.t[1] * ea.t[1]) < 0.9) continue;
    const dep = -((ec.a[0] - ea.a[0]) * ea.n[0] + (ec.a[1] - ea.a[1]) * ea.n[1]);
    if (Math.abs(dep - v.inset) > 0.05) continue;
    const open = items(c).some(
      (it) =>
        it.t === 'bal' && isRecessed(it) && it.u0 < 0.3 && it.storeys.some((k) => v.it.storeys.includes(k)),
    );
    if (open) v.backOut = c;
  }
  const voidsAll = voids.slice();
  voids.splice(0, voids.length, ...voidsAll.filter((v) => !drop.has(v.id)));
  voids.forEach((v, k) => (v.id = k));
  /**
   * Loca dikdörtgeni (ön kenar taban izi hattının 2 cm dışında). v7 (hata düzeltmesi): köşe locasında birleştirilen
   * kenar (absorbed) yanı ve açık C yüzüne düşen arka kenar (backOut) o kenarların hattının 2 cm DIŞINA itilir —
   * köşe tam dik değilse dikdörtgen kenarı taban izi içinde mm'lik bir kama bırakıyor, kama kenarı o yüzün TAM BOY
   * duvarını loca ağzının üstüne çizdiriyordu (1480041344 e5, 1480041343 e15 ve ~20 köşe locası)
   */
  const voidRect = (v: Void): [number, number][] => {
    const r = [
      P(v.edge, v.u0, 0.02),
      P(v.edge, v.u1, 0.02),
      P(v.edge, v.u1, -v.inset),
      P(v.edge, v.u0, -v.inset),
    ];
    if (v.absorbed != null || v.backOut != null) {
      const ea = E[v.edge];
      // Doğru: nokta + yön; kesişim
      type Ln = [V2, V2];
      const X = (l1: Ln, l2: Ln): V2 => {
        const [p, d] = l1;
        const [q, e] = l2;
        const den = d[0] * e[1] - d[1] * e[0];
        if (Math.abs(den) < 1e-9) return p;
        const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
        return [p[0] + d[0] * t, p[1] + d[1] * t];
      };
      const out = (j: number): Ln => [P(j, 0, 0.02), E[j].t];
      const front: Ln = [P(v.edge, 0, 0.02), ea.t];
      const side1: Ln = v.absorbed != null ? out(v.absorbed) : [P(v.edge, v.u1, 0), ea.n];
      const back: Ln = v.backOut != null ? out(v.backOut) : [P(v.edge, 0, -v.inset), ea.t];
      const side0: Ln = [P(v.edge, v.u0, 0), ea.n];
      if (v.absorbed != null) r[1] = X(front, side1);
      r[2] = X(back, side1);
      if (v.backOut != null) r[3] = X(back, side0);
    }
    return r.map((p) => [p[0], p[1]] as [number, number]);
  };
  const voidsAt = (k: number) => voids.filter((v) => v.it.storeys.includes(k));
  /**
   * Kenar i üzerinde, k katında u noktasının düştüğü loca. v7: köşe locasında birleştirilen komşu kenarın noktaları
   * dünya konumuyla (önceden o kenarın ölçülmüş pencereleri taban izi hattında locanın camıyla çakışıyordu —
   * 1480041300 / 01 köşe locaları z-fighting)
   */
  const voidAt = (i: number, u: number, k: number): Void | undefined => {
    const vs = voidsAt(k);
    const same = vs.find((v) => v.edge === i && u > v.u0 + 0.05 && u < v.u1 - 0.05);
    if (same) return same;
    const q = P(i, u, -0.05);
    return vs.find((v) => {
      if (v.absorbed !== i && v.backOut !== i) return false;
      const r = voidRect(v) as V2[];
      return inside(r, q[0], q[1]) && distToRing(r, q[0], q[1]) > 0.04;
    });
  };
  /** Kenar i üzerinde, k katında u noktası bir boşluğa düşüyor mu */
  const inVoid = (i: number, u: number, k: number) => !!voidAt(i, u, k);
  /** v7: loca derinliği (kenar i'ye göre: köşe locasında dikdörtgenin o kenara paralel arka yüzü) */
  const voidDepth = (v: Void, i: number): number => {
    if (v.edge === i) return v.inset;
    const e = E[i];
    let m = 0;
    for (const c of voidRect(v)) m = Math.min(m, (c[0] - e.a[0]) * e.n[0] + (c[1] - e.a[1]) * e.n[1]);
    return -m;
  };
  /** v7: locanın kenar i boyunca kapsadığı u aralığı (köşe locasında dikdörtgenin o kenara izdüşümü) */
  const voidSpan = (v: Void, i: number): [number, number] => {
    if (v.edge === i) return [v.u0, v.u1];
    const e = E[i];
    const us = voidRect(v).map((c) => (c[0] - e.a[0]) * e.t[0] + (c[1] - e.a[1]) * e.t[1]);
    return [Math.max(0, Math.min(...us)), Math.min(e.len, Math.max(...us))];
  };
  /** v7: kenar i'de (u, mutlak kot y) noktasının düştüğü loca (kat y'den bulunur) + o kenara göre derinliği */
  const voidAtY = (i: number, u: number, y: number): { v: Void; depth: number } | null => {
    let k = -1;
    for (let q = 0; q < S; q++) if (y >= floorY(q) - 1e-6 && y < floorY(q + 1) - 1e-6) k = q;
    if (k < 0) return null;
    const v = voidAt(i, u, k);
    return v ? { v, depth: voidDepth(v, i) } : null;
  };
  /**
   * v7: loca döşemesi / tavanı çokgeninde ön kenar uçlarının taban izi İÇİNE dönüşü (endIn): uç noktasındaki (taban
   * izi hattı ile yan duvarın / köşe locasında iki kenarın birleştiği) dışbükey köşe r yarıçaplı yayla (round) ya da
   * pahla (chamfer) kesilir. Döner: yeni çokgen + dönüş parçalarının (korkuluk çizilecek) loca eşlemesi.
   */
  const filletLoggia = (poly: V2[], vs: Void[]): { poly: V2[]; seg: Map<number, Void> } => {
    const cuts: { at: V2; r: number; kind: string; v: Void }[] = [];
    for (const v of vs) {
      const e = v.it.endIn;
      if (e == null) continue;
      const [e0, e1] = Array.isArray(e) ? e : [e, e];
      const kind = v.it.endShape === 'chamfer' ? 'chamfer' : 'round';
      if (e0 > 0.02) cuts.push({ at: P(v.edge, v.u0, 0), r: e0, kind, v });
      if (e1 > 0.02) cuts.push({ at: P(v.edge, v.u1, 0), r: e1, kind, v });
    }
    if (!cuts.length) return { poly, seg: new Map() };
    const out: V2[] = [];
    const marks: (Void | null)[] = [];
    const n = poly.length;
    const ccw = area2(poly) > 0;
    for (let j = 0; j < n; j++) {
      const cur = poly[j];
      const cut = cuts.find((c) => Math.hypot(c.at[0] - cur[0], c.at[1] - cur[1]) < 0.12);
      const pv = poly[(j + n - 1) % n];
      const nx = poly[(j + 1) % n];
      const la = Math.hypot(pv[0] - cur[0], pv[1] - cur[1]);
      const lc = Math.hypot(nx[0] - cur[0], nx[1] - cur[1]);
      // Dışbükey köşe mi (çokgen yönüne göre)
      const cross = (cur[0] - pv[0]) * (nx[1] - cur[1]) - (cur[1] - pv[1]) * (nx[0] - cur[0]);
      if (!cut || la < 0.05 || lc < 0.05 || (ccw ? cross <= 0 : cross >= 0)) {
        out.push(cur);
        marks.push(null);
        continue;
      }
      const a: V2 = [(pv[0] - cur[0]) / la, (pv[1] - cur[1]) / la];
      const c: V2 = [(nx[0] - cur[0]) / lc, (nx[1] - cur[1]) / lc];
      const th = Math.acos(Math.max(-1, Math.min(1, a[0] * c[0] + a[1] * c[1])));
      const tMax = 0.45 * Math.min(la, lc);
      if (cut.kind === 'chamfer') {
        const t = Math.min(cut.r, tMax);
        out.push([cur[0] + a[0] * t, cur[1] + a[1] * t]);
        marks.push(cut.v);
        out.push([cur[0] + c[0] * t, cur[1] + c[1] * t]);
        marks.push(null);
        continue;
      }
      const t = Math.min(cut.r / Math.tan(th / 2), tMax);
      const r = t * Math.tan(th / 2);
      const T1: V2 = [cur[0] + a[0] * t, cur[1] + a[1] * t];
      const T2: V2 = [cur[0] + c[0] * t, cur[1] + c[1] * t];
      const bis: V2 = [a[0] + c[0], a[1] + c[1]];
      const bl = Math.hypot(bis[0], bis[1]) || 1;
      const C: V2 = [
        cur[0] + (bis[0] / bl) * (r / Math.sin(th / 2)),
        cur[1] + (bis[1] / bl) * (r / Math.sin(th / 2)),
      ];
      const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
      let a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
      while (a2 - a1 > Math.PI) a2 -= 2 * Math.PI;
      while (a2 - a1 < -Math.PI) a2 += 2 * Math.PI;
      const NS = 8;
      for (let s = 0; s <= NS; s++) {
        const ang = a1 + ((a2 - a1) * s) / NS;
        out.push([C[0] + Math.cos(ang) * r, C[1] + Math.sin(ang) * r]);
        marks.push(s < NS ? cut.v : null);
      }
    }
    const seg = new Map<number, Void>();
    marks.forEach((m, k) => {
      if (m) seg.set(k, m);
    });
    return { poly: out, seg };
  };

  // ── Açıklıklar (pencere/kapı), balkon arkası varsayılan kapılar ──
  const openings: Opening[][] = E.map(() => []);
  /** Loca (void id) → arka duvara taşınacak ölçülmüş açıklıklar (kenar u'sunda) */
  const voidOps = new Map<number, Opening[]>();
  /** Çatı arası pencereleri (k = S): alınlıkta, üçgen alınlıkta (pediment) ya da kemerli parapette açılır */
  const attic: Opening[][] = E.map(() => []);
  for (let i = 0; i < N; i++) {
    const its = items(i);
    for (const it of its) {
      if (it.t !== 'win') continue;
      const u0 = Math.max(0.05, it.u0);
      const u1 = Math.min(E[i].len - 0.05, it.u1);
      if (u1 - u0 < MIN_OPEN) continue;
      for (const k of it.storeys) {
        if (k === S && !it.stair) {
          // Çatı arası kat penceresi: duvar üstünde (K{S} döşemesi = son kat tavanı), kat çizgisine kırpılmaz
          const fy = floorY(S);
          const y0 = fy + it.sill;
          const y1 = fy + it.head;
          if (y1 - y0 >= 0.25 && y0 > wallTop - 0.3) attic[i].push({ u0, u1, y0, y1, win: it, k, fy });
          continue;
        }
        // K−1: bodrum pencereleri (zemin kat döşemesinin bir kat altı; zeminin üstünde kalan kısım)
        if (k < -1 || k >= S) continue;
        const fy = k < 0 ? floorY(0) - FH : floorY(k);
        // Dükkân camı zemin kat döşemesinin altına inebilir (yüksek zemin kat, groundRaise sanal). v7 (hata düzeltmesi):
        // zemin kat KAPISI da ölçülen eşiğine (döşeme çizgisinin altında olabilir) iner, en çok zemine — önceden
        // döşeme çizgisine kırpılıyor, sanal groundRaise'li bloklarda (MOSSA 1.0) kapılar havada kalıyordu
        let y0 =
          fy +
          (it.kind === 'shop'
            ? Math.max(0.1 - blk.groundRaise, it.sill)
            : it.stair
              ? it.sill
              : it.kind === 'door' && k === 0 && it.sill < 0
                ? Math.max(base + 0.02 - fy, it.sill)
                : Math.max(0.02, it.sill));
        // Merdiven kovası penceresi kat çizgisine kırpılmaz (yarım kat kaymalı dizi)
        // Bodrum penceresi zemin kat döşemesini en çok 0.3 m aşabilir
        const y1 = fy + (it.stair ? it.head : Math.min(k < 0 ? FH + 0.3 : storeyH(k) - 0.25, it.head));
        if (k < 0) y0 = Math.max(y0, base + 0.05);
        if (y1 - y0 < (k < 0 ? 0.15 : 0.3)) continue;
        openings[i].push({ u0, u1, y0, y1, win: it, k, fy });
      }
    }
    // Balkon arkası: o katta açıklık yoksa kapı (+ yer varsa pencere)
    for (const it of its) {
      if (it.t !== 'bal' || isRecessed(it)) continue;
      const u0 = Math.max(0.1, it.u0);
      const u1 = Math.min(E[i].len - 0.1, it.u1);
      const W = u1 - u0;
      if (W < 1.1) continue;
      for (const k of it.storeys) {
        if (k < 0 || k >= S) continue;
        const occ = openings[i].filter((op) => op.k === k && op.u1 > u0 && op.u0 < u1);
        const h = hash(o.seed + i * 31 + k * 7 + u0);
        if (occ.length) {
          // Ölçülmüş pencere varken varsayılan kapı yalnız keepDoor ile, en geniş boş aralığın ortasına
          if (!it.keepDoor) continue;
          const cuts = occ.map((op) => [op.u0, op.u1] as [number, number]).sort((a, e) => a[0] - e[0]);
          let cur = u0;
          let bestG: [number, number] | null = null;
          for (const [a, e] of [...cuts, [u1, u1] as [number, number]]) {
            if (a - cur > (bestG ? bestG[1] - bestG[0] : 0)) bestG = [cur, a];
            cur = Math.max(cur, e);
          }
          if (!bestG || bestG[1] - bestG[0] < 1.05) continue;
          const dcK = (bestG[0] + bestG[1]) / 2;
          const doorK: CWin = {
            t: 'win',
            u0: dcK - 0.45,
            u1: dcK + 0.45,
            sill: 0.02,
            head: 2.2,
            storeys: [k],
            kind: 'door',
            rail: false,
            split: 1,
            box: false,
          };
          openings[i].push({
            u0: doorK.u0,
            u1: doorK.u1,
            y0: floorY(k) + 0.02,
            y1: floorY(k) + 2.2,
            win: doorK,
            k,
          });
          continue;
        }
        const dc = W >= 2.6 ? u0 + W * (h < 0.5 ? 0.28 : 0.72) : (u0 + u1) / 2;
        const door: CWin = {
          t: 'win',
          u0: dc - 0.45,
          u1: dc + 0.45,
          sill: 0.02,
          head: 2.2,
          storeys: [k],
          kind: 'door',
          rail: false,
          split: 1,
          box: false,
        };
        openings[i].push({
          u0: door.u0,
          u1: door.u1,
          y0: floorY(k) + 0.02,
          y1: floorY(k) + 2.2,
          win: door,
          k,
        });
        if (W >= 2.6) {
          const wc = h < 0.5 ? u0 + W * 0.72 : u0 + W * 0.28;
          const win: CWin = {
            ...door,
            u0: wc - 0.65,
            u1: wc + 0.65,
            sill: 0.9,
            head: 2.2,
            kind: 'std',
            split: 2,
          };
          openings[i].push({ u0: win.u0, u1: win.u1, y0: floorY(k) + 0.9, y1: floorY(k) + 2.2, win, k });
        }
      }
    }
    // Loca boşluğuna düşen açıklıklar taban izi hattında çizilmez: ÖLÇÜLMÜŞ olanlar (öğe listesindeki `win`) loca
    // arka duvarına taşınır (o katta otomatik kapı + pencere yerine); üreticinin varsayılan kapıları atılır
    for (const op of openings[i]) {
      const um = (op.u0 + op.u1) / 2;
      const v = voidAt(i, um, op.k);
      if (!v || !its.includes(op.win)) continue;
      if (!voidOps.has(v.id)) voidOps.set(v.id, []);
      voidOps.get(v.id)!.push({ ...op, edge: i });
    }
    openings[i] = openings[i].filter((op) => !inVoid(i, (op.u0 + op.u1) / 2, op.k));
    // Çakışan açıklıkları ayıkla (ölçüm hatası). v11: dükkân camının İÇİNDEKİ açıklık (vitrin içi kapı) atılmaz —
    // cam kapının çevresinde parçalanır (splitAround); kısmi çakışma eskisi gibi atılır (survey-compile uyarır)
    openings[i] = resolveOpenings(openings[i]);
  }

  // ── Duvar girintileri (çok katlı loca, girintili dükkân hattı, merdiven kovası, kapı yuvası) ──
  // Ağız duvarda boşluk olarak kesilir; içindeki açıklıklar arka duvara (depth kadar içeri) taşınır.
  interface Rec {
    i: number;
    u0: number;
    u1: number;
    Y0: number;
    Y1: number;
    depth: number;
    it: CRecess;
    ops: Opening[];
  }
  const recs: Rec[] = [];
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t !== 'recess') continue;
      const u0 = Math.max(0, it.u0);
      const u1 = Math.min(E[i].len, it.u1);
      // v7: çatı arası katı girintisi (s: [storeys, storeys]) — kemerli parapet / alınlık / çatı alınlığı ön yüzünü
      // keser (Salus K8 teras locaları)
      const atticRec = !!it.storeys && it.storeys[0] >= S;
      const Y0 = it.storeys ? floorY(Math.max(0, Math.min(S, it.storeys[0]))) : base + (it.y0 ?? 0);
      // Son kata kadar süren girinti, ölçülmüş duvar üstü (wallTop) verilmişse saçak altına kadar
      const Y1 = atticRec
        ? floorY(S) + storeyH(S) - SLAB
        : it.storeys
          ? it.storeys[1] + 1 >= S && blk.wallTop != null && blk.wallTop > 0.5
            ? wallTop
            : floorY(Math.min(S, it.storeys[1] + 1)) - SLAB
          : base + (it.y1 ?? floorY(S) - base);
      if (u1 - u0 < 0.1 || Y1 - Y0 < 0.1 || it.depth < 0.02) continue;
      const r: Rec = { i, u0, u1, Y0, Y1, depth: it.depth, it, ops: [] };
      const inR = (op: Opening) => {
        const um = (op.u0 + op.u1) / 2;
        const ym = (op.y0 + op.y1) / 2;
        return um > u0 && um < u1 && ym > Y0 && ym < Y1;
      };
      r.ops = openings[i].filter(inR);
      openings[i] = openings[i].filter((op) => !inR(op));
      // Duvar üstünü aşan girintide çatı arası pencereleri de arka duvarda
      if (Y1 > wallTop + 0.05) {
        r.ops.push(...attic[i].filter(inR));
        attic[i] = attic[i].filter((op) => !inR(op));
      }
      recs.push(r);
    }
  const recDummy: CWin = {
    t: 'win',
    u0: 0,
    u1: 0,
    sill: 0,
    head: 0,
    storeys: [],
    kind: 'door',
    rail: false,
    split: 1,
    box: false,
  };
  const recHoles = (i: number): Opening[] =>
    recs
      .filter((r) => r.i === i)
      .map((r) => ({ u0: r.u0, u1: r.u1, y0: r.Y0, y1: r.Y1, win: recDummy, k: -9 }));
  /** Kenar i'de (u, y) noktasını içeren girinti */
  const recAt = (i: number, u: number, y: number) =>
    recs.find((r) => r.i === i && u > r.u0 && u < r.u1 && y > r.Y0 && y < r.Y1);
  /** Kenar i'de (u, y) bir girintinin içinde mi → derinliği */
  const recDepthAt = (i: number, u: number, y: number) => recAt(i, u, y)?.depth ?? 0;
  /** v7: u0..u1 × y0..y1 (mutlak kot) kutusu bir girinti ağzının içinde mi (0.15 m pay) → girinti */
  const recInside = (i: number, u0: number, u1: number, y0: number, y1: number) =>
    recs.find(
      (r) =>
        r.i === i &&
        u0 > r.u0 - 0.15 &&
        u1 < r.u1 + 0.15 &&
        y0 > r.Y0 - 0.15 &&
        y1 < r.Y1 + 0.15 &&
        (u0 + u1) / 2 > r.u0 &&
        (u0 + u1) / 2 < r.u1,
    );
  /** v7: duvar üstünü aşan girinti ağızları (kemerli parapet / alınlık / saçak alnı yüzlerinde delik): u0, y0, u1, y1 */
  const recAbove = (i: number, yFrom: number): [number, number, number, number][] =>
    recs
      .filter((r) => r.i === i && r.Y1 > yFrom + 0.02)
      .map((r) => [r.u0, Math.max(r.Y0, yFrom), r.u1, r.Y1]);
  // Zemine inen girinti ağızları (≥ 0.3 m derin, ≥ 0.6 m geniş, üstü ≥ 1.9 m): yürünebilir → çarpışma halkasından
  // çıkarılacak dünya dikdörtgenleri (arka duvar ve yan duvarlar çarpışmada kalır)
  const recessHoles: [number, number][][] = recs
    .filter((r) => r.Y0 < base + 0.35 && r.depth >= 0.3 && r.u1 - r.u0 >= 0.6 && r.Y1 - base >= 1.9)
    .map((r) =>
      [P(r.i, r.u0, 0.05), P(r.i, r.u1, 0.05), P(r.i, r.u1, -r.depth), P(r.i, r.u0, -r.depth)].map(
        (p) => [p[0], p[1]] as [number, number],
      ),
    );
  const named: Record<string, string> = {
    plaster: K('mkPlaster'),
    plaster2: K('mkPlaster2'),
    strip: K('mkStrip'),
    fascia: K('mkFascia'),
    plinth: K('mkPlinth'),
  };
  /** Palet adı ya da "#rrggbb" → malzeme anahtarı */
  const colorOf = (c: string | null | undefined, dflt: string, kind: CK = 'plaster') =>
    (c ? named[c] : undefined) ?? ck(kind, c, dflt);
  /** Palet adı / "#rrggbb" → renk (derzli kaplama malzemesi için; palet yoksa index.ts varsayılanları) */
  const PAL_DEF: Record<string, string> = {
    plaster: '#d3d1cc',
    plaster2: '#9d9c99',
    strip: '#d98a38',
    fascia: '#6d6f72',
    plinth: '#7f8184',
  };
  const hexOf = (c: string | null | undefined) =>
    c && /^#[0-9a-f]{6}$/i.test(c)
      ? c
      : ((blk.colors as Record<string, string | undefined>)[c ?? 'plaster'] ??
        PAL_DEF[c ?? 'plaster'] ??
        '#d3d1cc');
  /** Derzli kaplama (ince dikey / yatay derz dokusu, aralık `every`): verilirse düz renk yerine */
  const cladKey = (
    cl: Clad | null | undefined,
    color: string | null | undefined,
    dflt: string,
    finish?: string | null,
  ) => {
    // v7: grid (iki yönde derz: ACP kompozit panel; every yatay aralık, every2 düşey aralık) ve parlak bitiş (acp)
    const fin = finish === 'acp' || finish === 'matte' ? finish : null;
    if (!(cl && cl.every > 0.02)) return fin ? ck(`clad:n:1:0:#000000::${fin}`, hexOf(color), dflt) : dflt;
    // v7: dots = delikli (perfore) panel: every nokta aralığı, w delik çapı, color delik rengi (yaklaşık düzenli desen)
    // v9: star = 8 kollu yıldız ağı / geçme deseni (yaklaşık), hpair = çift yatay derz (every2 çift içi mesafe)
    const dir =
      cl.dir === 'h'
        ? 'h'
        : cl.dir === 'grid'
          ? 'g'
          : cl.dir === 'dots'
            ? 'd'
            : cl.dir === 'star'
              ? 's'
              : cl.dir === 'hpair'
                ? 'p'
                : 'v';
    const e2 =
      dir === 'g' || dir === 'p'
        ? `:${Math.round((cl.every2 ?? (dir === 'p' ? cl.every / 4 : cl.every)) * 1000) / 1000}`
        : fin
          ? ':'
          : '';
    return ck(
      `clad:${dir}:${Math.round(cl.every * 1000) / 1000}:${Math.round((cl.w ?? 0.02) * 1000) / 1000}:${
        cl.color && /^#[0-9a-f]{6}$/i.test(cl.color) ? cl.color.toLowerCase() : '#000000'
      }${e2}${fin ? `:${fin}` : ''}`,
      hexOf(color),
      dflt,
    );
  };
  /** v7: düzensiz düşey kaplama derzleri (clad.us, gerçek u): y0..y1 boyunca ince koyu şeritler */
  const cladJoints = (
    cl: Clad | null | undefined,
    Pq: PFn,
    i: number,
    off: number,
    ua: number,
    ub: number,
    y0: number,
    y1: number,
  ) => {
    if (!cl?.us?.length) return;
    const jk = ckm('groove', cl.color ?? null, 'mkGroove');
    const w = Math.max(0.008, cl.w ?? 0.02);
    for (const u of cl.us) {
      if (u < ua - 1e-3 || u > ub + 1e-3) continue;
      b.wall(jk, Pq(i, u - w / 2, off + 0.003), Pq(i, u + w / 2, off + 0.003), y0, y1);
    }
  };

  // ── Çatı parametreleri (çizim en sonda): parapet, kenar bazında saçak, alınlık profilleri ──
  const par = blk.roof.parapet && blk.roof.parapet.h > 0.05 ? blk.roof.parapet : null;
  /** Kenar parapetli mi (parapet `edges` verilmişse yalnız o kenarlar) */
  const onPar = (i: number) => !!par && (!par.edges || par.edges.includes(i));
  // Parapet yalnız bazı kenarlarda: diğer kenarlarda gerçek saçak taşması (kenar bazında), çatı saçak alnı
  // üstünden başlar. Tüm kenarlar parapetli: çatı parapetin arkasından, saçaksız (ör. 1541439435).
  const mixedPar = !!par?.edges;
  const eave = par && !mixedPar ? 0.02 : (blk.roof.eave ?? 0.6);
  const fH =
    par && !mixedPar
      ? 0.05
      : mixedPar
        ? Math.max(0.05, blk.roof.fasciaH ?? 0.45)
        : (blk.roof.fasciaH ?? 0.45);
  const fasciaK = colorOf(blk.roof.fasciaC, K('mkPlaster2'));
  const gables = (blk.roof as { gables?: number[] }).gables ?? [];
  const roofY = wallTop + fH - 0.02;
  // v7: kenar bazında saçak (roof.eaves: dünya noktasına en yakın taban izi kenarı — kütle kesim kenarları dahil)
  const eaveOver = new Map<number, number>();
  for (const ev of blk.roof.eaves ?? []) {
    if (!ev?.at || !(ev.eave >= 0)) continue;
    let bi = -1;
    let bd = 1.5;
    for (let i = 0; i < N; i++) {
      const e = E[i];
      if (e.len < 0.05) continue;
      const u = Math.max(0, Math.min(e.len, (ev.at[0] - e.a[0]) * e.t[0] + (ev.at[1] - e.a[1]) * e.t[1]));
      const d = Math.hypot(ev.at[0] - (e.a[0] + e.t[0] * u), ev.at[1] - (e.a[1] + e.t[1] * u));
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) eaveOver.set(bi, ev.eave);
  }
  const eave0 = (i: number) => (mixedPar ? (onPar(i) ? 0.02 : (blk.roof.eave ?? 0.6)) : eave);
  // v7: açık mahyalı kanat çatıları (roof.wings): alınlıkları kanat uç kenarlarında
  const wings = !OLD_ROOF && blk.roof.wings?.length ? blk.roof.wings : null;
  const wingOpts0 = {
    eave,
    pitchDeg: blk.roof.pitch ?? 26,
    gableBase: wallTop - 0.05,
    eaveOf: mixedPar || eaveOver.size ? (i: number) => eaveOver.get(i) ?? eave0(i) : undefined,
    bargeH: blk.roof.barge ?? undefined,
    keys: { roof: '', soffit: '', fascia: '', gable: '', terrace: '' },
  };
  const wingGab = wings ? wingGables(ring, wings, roofY, base, wingOpts0) : [];
  const gableEdges = [
    ...(blk.roof.kind === 'gable' ? gables : []),
    ...wingGab
      .map((g) => g.edge)
      .filter((g, k, a) => a.indexOf(g) === k && !(blk.roof.kind === 'gable' && gables.includes(g))),
  ];
  const isGableEdge = (i: number) => !OLD_ROOF && gableEdges.includes(i);
  const gC = blk.roof.gableC;
  const gableKeys: Record<number, string> = {};
  for (const g of gableEdges) {
    const c = typeof gC === 'string' ? gC : (gC?.[String(g)] ?? null);
    if (c) gableKeys[g] = colorOf(c, K('mkPlaster'));
  }
  const roofRf = blk.roof as { terrace?: boolean; terraceInset?: number };
  const roofOpts = {
    eave,
    pitchDeg: blk.roof.pitch ?? 26,
    gableEdges: blk.roof.kind === 'gable' ? gables : [],
    terraceInset: blk.roof.kind === 'flat' ? 0.001 : roofRf.terrace ? (roofRf.terraceInset ?? 7) : undefined,
    eaveOf: mixedPar || eaveOver.size ? (i: number) => eaveOver.get(i) ?? eave0(i) : undefined,
    gableKeys,
    gableBase: wallTop - 0.05,
    bargeH: blk.roof.barge ?? undefined,
    keys: {
      roof: K('mkTile'),
      soffit: K('mkSoffit'),
      fascia: fasciaK,
      gable: K('mkPlaster'),
      // v7: düz çatı / teras yüzeyi rengi (hava fotoğrafından; verilmezse sabit gri)
      terrace: blk.roof.flatC ? ck('plaster', blk.roof.flatC, 'roofFlat') : 'roofFlat',
    },
  };
  /** Alınlık üst profili: kenar i üzerinde u noktasında alınlık çizgisinin kotu (alınlık kenarı değilse null) */
  const gableProf = new Map<number, [number, number][]>();
  if (gableEdges.length && !OLD_ROOF)
    for (const g of [...(roofOpts.gableEdges.length ? roofGables(ring, roofY, roofOpts) : []), ...wingGab]) {
      const e = E[g.edge];
      if (!e) continue;
      const pts = g.prof
        .map(([x, z, h]) => [(x - e.a[0]) * e.t[0] + (z - e.a[1]) * e.t[1], h] as [number, number])
        .sort((p, q) => p[0] - q[0]);
      gableProf.set(
        g.edge,
        [...(gableProf.get(g.edge) ?? []), ...pts].sort((p, q) => p[0] - q[0]),
      );
    }
  const gableAt = (i: number, u: number): number | null => {
    const pr = gableProf.get(i);
    if (!pr || pr.length < 2 || u < pr[0][0] - 0.02 || u > pr[pr.length - 1][0] + 0.02) return null;
    let best: number | null = null;
    for (let k = 0; k + 1 < pr.length; k++) {
      const [ua, ha] = pr[k];
      const [ub, hb] = pr[k + 1];
      if (u < ua - 1e-6 || u > ub + 1e-6 || ub - ua < 1e-6) continue;
      const h = ha + ((hb - ha) * (u - ua)) / (ub - ua);
      if (best == null || h > best) best = h;
    }
    return best;
  };
  /** Alınlık boşlukları (çatı arası pencereleri), unionRoof'a */
  const gableHoles: { edge: number; a: V2; e: V2; y0: number; y1: number; round?: boolean }[] = [];
  /** Çatı yüzeyi yüksekliği (dormer oturtmak için), gerektiğinde bir kez hesaplanır */
  let roofHc: ((p: V2) => number | null) | null = null;
  // v7: kanat çatısı varsa önce kanat yüzeyi, yoksa (kalan kısım) birleşik çatı
  const roofH = () =>
    (roofHc ??= OLD_ROOF
      ? () => null
      : wings
        ? (() => {
            const wh = wingHeightAt(ring, wings, roofY, base, wingOpts0);
            const rest = restRings().map((r) =>
              roofHeightAt(r.ring, roofY, { ...roofOpts, gableEdges: [], eaveOf: r.eaveOf }),
            );
            return (p: V2) => wh(p) ?? rest.reduce<number | null>((m, f) => m ?? f(p), null);
          })()
        : roofHeightAt(ring, roofY, roofOpts));
  /** v7: taban izinin kanat çokgenleri dışında kalan kısımları (birleşik çatı) + kenar saçak eşlemesi */
  let restC: { ring: V2[]; eaveOf: (k: number) => number }[] | null = null;
  const restRings = () => {
    if (restC) return restC;
    restC = [];
    if (!wings) return restC;
    try {
      const wp = wings.map(
        (w) =>
          [(w.poly?.length ? w.poly : ring).map((p) => [p[0], p[1]] as [number, number])] as pcNs.Polygon,
      );
      const rest = pc.difference([ring.map((p) => [p[0], p[1]] as [number, number])], ...wp);
      for (const poly of rest) {
        const r = openRing(poly[0] as V2[]);
        if (r.length < 3 || Math.abs(area2(r)) < 2) continue;
        // Taban izine göre yön (negatif alanlı): kanatla ortak kenarlarda saçak yok
        const rr = area2(r) > 0 === area2(ring) > 0 ? r : r.slice().reverse();
        restC.push({
          ring: rr,
          eaveOf: (k: number) => {
            const a = rr[k];
            const e = rr[(k + 1) % rr.length];
            const fe = footEdgeOf(ring, a, e);
            return fe >= 0 ? (eaveOver.get(fe) ?? eave0(fe)) : 0.02;
          },
        });
      }
    } catch {
      /* fark başarısız: yalnız kanatlar */
    }
    return restC;
  };

  // ── Duvarlar: kat bantları; loca boşluğu olan bantlarda plan = taban izi − boşluklar ──
  const y0w = base - 0.5;
  const foot: [number, number][][] = [ring.map((p) => [p[0], p[1]] as [number, number])];
  const sig = (k: number) =>
    voidsAt(k)
      .map((v) => v.id)
      .join(',');
  const bands: { y0: number; y1: number; sig: string; k0: number; k1: number }[] = [];
  const pushBand = (y0: number, y1: number, sg: string, k: number) => {
    if (hideH != null) {
      // v8 baseH: gizli alt kısım çizilmez
      if (y1 <= base + hideH + 1e-6) return;
      y0 = Math.max(y0, base + hideH);
    }
    const last = bands[bands.length - 1];
    if (last && last.sig === sg && Math.abs(last.y1 - y0) < 1e-6) {
      last.y1 = y1;
      last.k1 = k;
    } else bands.push({ y0, y1, sig: sg, k0: k, k1: k });
  };
  // Duvar üstü son kat döşemesinin altındaysa (ölçülmüş wallTop) kat bantları orada kesilir
  pushBand(y0w, Math.min(floorY(0), wallTop), '', -1);
  for (let k = 0; k < S; k++) {
    const ya = floorY(k);
    const yb = Math.min(floorY(k + 1), wallTop);
    if (yb - ya > 1e-3) pushBand(ya, yb, sig(k), k);
  }
  if (wallTop - floorY(S) > 1e-3) pushBand(floorY(S), wallTop, '', S);
  for (const bd of bands) {
    if (!bd.sig) {
      for (let i = 0; i < N; i++) {
        const { len, s0 } = E[i];
        if (len < 0.02) continue;
        wallWithOpenings(b, P, i, 0, len, s0, bd.y0, bd.y1, [...openings[i], ...recHoles(i)]);
      }
      continue;
    }
    const vs = voids.filter((v) => bd.sig.split(',').includes(String(v.id)));
    let plate: pcNs.MultiPolygon;
    try {
      const vr = vs.map((v) => [voidRect(v)]);
      plate = pc.difference(foot, pc.union(vr[0], ...vr.slice(1)));
    } catch {
      plate = [foot];
    }
    // v7: önce tüm parçalar (taban izi kenarı / loca iç duvarı) toplanır, ölçülmüş loca açıklıkları parçalara
    // atanır, sonra aynı sırayla çizilir. Birleşik (union) loca hacimlerinde arka duvar kırıklı olabilir: ölçülen
    // derinlikte tam eşleşen parça yoksa en çok örtüşen yakın (≤ 0.9 m) paralel parçaya taşınır (önceden atılıyordu —
    // 1480041342 e7 köşe locası kapısı)
    interface Piece {
      hit: number;
      ua: number;
      ub: number;
      p: V2;
      pp: V2;
      Lr: number;
      tr: V2;
      Er: Edge;
      Pr: PFn;
      parallel: boolean;
      parallelTo: (e: Edge) => boolean;
      back: boolean;
      ops: Opening[];
      measuredK: Set<number>;
    }
    const pieces: Piece[] = [];
    for (const poly of plate)
      for (const rr of poly) {
        const r = openRing(rr as V2[]);
        for (let j = 0; j < r.length; j++) {
          const p = r[j];
          const q = r[(j + 1) % r.length];
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L < 0.02) continue;
          // Taban izi kenarı üzerinde mi?
          let hit = -1;
          let ua = 0;
          let ub = 0;
          for (let i = 0; i < N; i++) {
            const e = E[i];
            if (e.len < 0.02) continue;
            const d = (x: V2) => (x[0] - e.a[0]) * e.n[0] + (x[1] - e.a[1]) * e.n[1];
            if (Math.abs(d(p)) > 0.03 || Math.abs(d(q)) > 0.03) continue;
            const up = (p[0] - e.a[0]) * e.t[0] + (p[1] - e.a[1]) * e.t[1];
            const uq = (q[0] - e.a[0]) * e.t[0] + (q[1] - e.a[1]) * e.t[1];
            if (Math.min(up, uq) < -0.03 || Math.max(up, uq) > e.len + 0.03) continue;
            hit = i;
            ua = Math.max(0, Math.min(up, uq));
            ub = Math.min(e.len, Math.max(up, uq));
            break;
          }
          // Loca iç duvarı (arka / yan): düz sıva; arka duvarlara (taban izine paralel) kat başına kapı + pencere
          const [pp, qq] = outwardOrder(r, p, q);
          const Lr = L;
          const tr: V2 = [(qq[0] - pp[0]) / Lr, (qq[1] - pp[1]) / Lr];
          const Er: Edge = {
            a: pp,
            e: qq,
            len: Lr,
            t: tr,
            n: [-tr[1], tr[0]],
            yaw: Math.atan2(-tr[1], tr[0]),
            s0: 0,
          };
          const Pr: PFn = (_i, u, off = 0) => [
            pp[0] + tr[0] * u + Er.n[0] * off,
            pp[1] + tr[1] * u + Er.n[1] * off,
          ];
          const parallel = E.some(
            (e) => e.len > 1 && Math.abs(e.t[0] * tr[0] + e.t[1] * tr[1]) > 0.98 && Lr > 1.2,
          );
          const parallelTo = (e: Edge) => Math.abs(Math.abs(e.t[0] * tr[0] + e.t[1] * tr[1]) - 1) < 0.02;
          const back = parallel && vs.some((v) => parallelTo(E[v.edge]));
          pieces.push({
            hit,
            ua,
            ub,
            p,
            pp,
            Lr,
            tr,
            Er,
            Pr,
            parallel,
            parallelTo,
            back,
            ops: [],
            measuredK: new Set(),
          });
        }
      }
    // Ölçülmüş loca arka duvarı açıklıkları (sürme kapılar, pencereler): kenar u'su → duvar parçasının u'su.
    // v7: açıklığın ölçüldüğü kenar (köşe locasında komşu kenar) ve o kenara göre loca derinliği
    for (const v of vs)
      for (const op of voidOps.get(v.id) ?? []) {
        const j = op.edge ?? v.edge;
        if (op.k < bd.k0 || op.k > bd.k1) continue;
        const dep = voidDepth(v, j);
        const A = P(j, op.u0, -dep);
        const B = P(j, op.u1, -dep);
        let placed = false;
        let best: { pc: Piece; u0: number; u1: number; ov: number; dd: number } | null = null;
        for (const pc0 of pieces) {
          if (pc0.hit >= 0 || !pc0.parallel || !pc0.parallelTo(E[j])) continue;
          const { pp, Er, tr, Lr } = pc0;
          const dn = (x: V2) => Math.abs((x[0] - pp[0]) * Er.n[0] + (x[1] - pp[1]) * Er.n[1]);
          const ua = (A[0] - pp[0]) * tr[0] + (A[1] - pp[1]) * tr[1];
          const ub = (B[0] - pp[0]) * tr[0] + (B[1] - pp[1]) * tr[1];
          const u0 = Math.max(0.05, Math.min(ua, ub));
          const u1 = Math.min(Lr - 0.05, Math.max(ua, ub));
          if (dn(A) > 0.06 || dn(B) > 0.06) {
            // Yaklaşık aday (kırıklı arka duvar)
            const dd = Math.max(dn(A), dn(B));
            if (
              dd < 0.9 &&
              u1 - u0 >= MIN_OPEN &&
              (!best || u1 - u0 > best.ov + 1e-3 || (Math.abs(u1 - u0 - best.ov) <= 1e-3 && dd < best.dd))
            )
              best = { pc: pc0, u0, u1, ov: u1 - u0, dd };
            continue;
          }
          if (u1 - u0 < MIN_OPEN) continue;
          pc0.ops.push({ ...op, u0, u1 });
          if (pc0.parallelTo(E[v.edge])) pc0.measuredK.add(op.k);
          placed = true;
        }
        if (!placed && best) {
          best.pc.ops.push({ ...op, u0: best.u0, u1: best.u1 });
          if (best.pc.parallelTo(E[v.edge])) best.pc.measuredK.add(op.k);
        }
      }
    for (const pc0 of pieces) {
      if (pc0.hit >= 0) {
        const hit = pc0.hit;
        wallWithOpenings(b, P, hit, pc0.ua, pc0.ub, E[hit].s0, bd.y0, bd.y1, [
          ...openings[hit],
          ...recHoles(hit),
        ]);
        continue;
      }
      const { p, Lr, Er, Pr, back, ops, measuredK } = pc0;
      if (back)
        for (let k = Math.max(0, bd.k0); k <= Math.min(S - 1, bd.k1); k++) {
          if (measuredK.has(k)) continue;
          const h = hash(o.seed + p[0] * 3.1 + p[1] * 1.7 + k);
          const dc = Lr >= 2.4 ? Lr * (h < 0.5 ? 0.3 : 0.7) : Lr / 2;
          const door: CWin = {
            t: 'win',
            u0: dc - 0.45,
            u1: dc + 0.45,
            sill: 0.02,
            head: 2.2,
            storeys: [k],
            kind: 'door',
            rail: false,
            split: 1,
            box: false,
          };
          ops.push({ u0: door.u0, u1: door.u1, y0: floorY(k) + 0.02, y1: floorY(k) + 2.2, win: door, k });
          if (Lr >= 2.6) {
            const wc = h < 0.5 ? Lr * 0.74 : Lr * 0.26;
            const win: CWin = { ...door, u0: wc - 0.6, u1: wc + 0.6, sill: 0.9, kind: 'std', split: 2 };
            ops.push({ u0: win.u0, u1: win.u1, y0: floorY(k) + 0.9, y1: floorY(k) + 2.2, win, k });
          }
        }
      wallWithOpenings(b, Pr, 0, 0, Lr, 0, bd.y0, bd.y1, ops);
      for (const op of ops) addWindow(b, Pr, Er, 0, op, o.seed);
    }
  }
  for (let i = 0; i < N; i++) {
    const { len, s0 } = E[i];
    if (len < 0.02) continue;
    // Subasman bandı (koyu gri, zemin kat döşemesine kadar ya da en az 0.4 m); ölçülmüşse plinthH (0 = yok)
    const yp =
      blk.plinthH != null
        ? base + Math.max(0, blk.plinthH)
        : Math.max(base + 0.4, Math.min(floorY(0), base + 1.2));
    // Bodrum pencereleri ve zemine inen girintiler subasmanı keser
    const pCut = [
      ...openings[i].filter((op) => op.k < 0 && op.y0 < yp),
      ...recHoles(i).filter((op) => op.y0 < yp - 0.01),
      // Ölçülmüş yüksek subasmanda zemin kat açıklıkları (kapı, dükkân camı) da keser. v7: ölçülmemiş subasmanda da
      // ölçülen eşiği döşeme çizgisinin altına inen zemin kat kapısı / dükkân camı keser (önceden arkasında kalıyordu)
      ...(blk.plinthH != null
        ? openings[i].filter((op) => op.k >= 0 && op.y0 < yp)
        : openings[i].filter(
            (op) =>
              op.k === 0 &&
              (op.win.kind === 'door' || op.win.kind === 'shop') &&
              op.y0 < Math.min(yp, floorY(0)) - 0.01,
          )),
    ];
    if (yp - base < 0.02 || hideH != null) {
      // Subasman yok (camlar / payeler zemine iner); v8 baseH: kule alt kısmı podyumun içinde
    } else if (!pCut.length)
      b.wall(K('mkPlinth'), P(i, 0, 0.012), P(i, len, 0.012), y0w, yp, [s0, 0, s0 + len, yp - y0w]);
    else {
      const P2: PFn = (ii, u, off = 0) => P(ii, u, off + 0.012);
      wallWithOpenings(b, P2, i, 0, len, s0, y0w, yp, pCut, K('mkPlinth'));
    }
    for (const op of openings[i]) addWindow(b, P, E[i], i, op, o.seed);
  }
  // Girinti iç yüzleri: arka duvar (açıklıklarıyla), iki yan, tavan, taban
  for (const r of recs) {
    const { i, u0, u1, Y0, Y1, depth } = r;
    const Pr: PFn = (_i, u, off = 0) => P(i, u, off - depth);
    // v7: arka / yan duvarlarda derzli kaplama (ör. 1480163637 pembe kaplama 0.55 m yatay derz)
    const rcl = r.it.clad && r.it.clad.every > 0.02 ? r.it.clad : null;
    const withClad = (c: string | null | undefined, k: string) => (rcl ? cladKey(rcl, c ?? 'plaster', k) : k);
    const backK = withClad(r.it.back, colorOf(r.it.back, K('mkPlaster')));
    const sideK = withClad(
      r.it.side ?? r.it.back,
      colorOf(r.it.side ?? r.it.back, colorOf(r.it.back, K('mkPlaster'))),
    );
    if (r.it.backS || r.it.sideS) {
      // Kat kat renk bölgeleri (sınırlar kat döşemelerinde): girinti yüksekliği kat bantlarına bölünür
      const cuts = [Y0, Y1];
      for (let k = 0; k <= S; k++) {
        const fy = floorY(k);
        if (fy > Y0 + 0.01 && fy < Y1 - 0.01) cuts.push(fy);
      }
      cuts.sort((a, e) => a - e);
      for (let c = 0; c + 1 < cuts.length; c++) {
        const ya = cuts[c];
        const yb = cuts[c + 1];
        let k = 0;
        while (k < S && floorY(k + 1) <= ya + 0.01) k++;
        const bK = r.it.backS?.[String(k)]
          ? withClad(r.it.backS[String(k)], colorOf(r.it.backS[String(k)], backK))
          : backK;
        const sK = r.it.sideS?.[String(k)]
          ? withClad(r.it.sideS[String(k)], colorOf(r.it.sideS[String(k)], sideK))
          : sideK;
        wallWithOpenings(b, Pr, i, u0, u1, E[i].s0, ya, yb, r.ops, bK);
        b.wall(sK, P(i, u0, 0), P(i, u0, -depth), ya, yb, [0, ya, depth, yb]);
        b.wall(sK, P(i, u1, -depth), P(i, u1, 0), ya, yb, [0, ya, depth, yb]);
      }
      for (const op of r.ops) addWindow(b, Pr, E[i], i, op, o.seed);
    } else {
      wallWithOpenings(b, Pr, i, u0, u1, E[i].s0, Y0, Y1, r.ops, backK);
      for (const op of r.ops) addWindow(b, Pr, E[i], i, op, o.seed);
      b.wall(sideK, P(i, u0, 0), P(i, u0, -depth), Y0, Y1, [0, Y0, depth, Y1]);
      b.wall(sideK, P(i, u1, -depth), P(i, u1, 0), Y0, Y1, [0, Y0, depth, Y1]);
    }
    const V = (p: V2, y: number): V3 => [p[0], y, p[1]];
    b.quad(
      colorOf(r.it.ceil, K('mkSoffit')),
      V(P(i, u0, -depth), Y1),
      V(P(i, u1, -depth), Y1),
      V(P(i, u1, 0), Y1),
      V(P(i, u0, 0), Y1),
      [0, 0, u1 - u0, depth],
    );
    if (Y0 > base + 0.02)
      b.quad(
        colorOf(r.it.floor, 'mkSlabTop'),
        V(P(i, u0, 0), Y0),
        V(P(i, u1, 0), Y0),
        V(P(i, u1, -depth), Y0),
        V(P(i, u0, -depth), Y0),
        [0, 0, u1 - u0, depth],
      );
  }

  // ── v9: sürekli konsol döşeme ön hatları (slabFronts): kat başına ön hat + şerit (içe depth) + ön bölge ──
  const sfOf = (k: number) =>
    (blk.slabFronts ?? [])
      .filter((sf) => sf.pts?.length >= 2 && k >= sf.s[0] && k <= sf.s[1])
      .map((sf) => {
        const base0 = (k - sf.s[0]) % 2 === 1 && sf.alt && sf.alt.length >= 2 ? sf.alt : sf.pts;
        // Dış yön: çizginin taban izi merkezinden uzak yanı
        const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
        const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        const m0 = base0[0];
        const m1 = base0[1];
        const lx = m1[0] - m0[0];
        const lz = m1[1] - m0[1];
        const nl = Math.hypot(lx, lz) || 1;
        let side = 1;
        if ((-lz / nl) * ((m0[0] + m1[0]) / 2 - cx) + (lx / nl) * ((m0[1] + m1[1]) / 2 - cz) < 0) side = -1;
        const off = sf.offK?.[String(k)] ?? sf.offK?.['*'] ?? 0;
        const F = off ? offsetLine(base0, off * side) : base0.map((p) => [p[0], p[1]] as V2);
        const depth = Math.max(0.3, sf.depth ?? 2.0);
        const inner = offsetLine(F, -depth * side);
        const outer = offsetLine(F, 6 * side);
        return {
          sf,
          F,
          band: [...F, ...inner.slice().reverse()] as V2[],
          strip: [...outer, ...inner.slice().reverse()] as V2[],
        };
      });
  const onLine = (F: V2[], m: V2, tol: number) => {
    for (let j = 0; j + 1 < F.length; j++) {
      const [a, e] = [F[j], F[j + 1]];
      const dx = e[0] - a[0];
      const dz = e[1] - a[1];
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((m[0] - a[0]) * dx + (m[1] - a[1]) * dz) / L2));
      if (Math.hypot(a[0] + dx * t - m[0], a[1] + dz * t - m[1]) < tol) return true;
    }
    return false;
  };
  if (blk.slabFronts?.length)
    for (let k = 0; k < S; k++) {
      const sfs = sfOf(k);
      if (!sfs.length) continue;
      const y = floorY(k);
      if (hideH != null && y < base + hideH - 0.01) continue;
      const vs = voidsAt(k);
      // Kattaki dolu kısım (taban izi − localar): şeridin buraya düşen kısmı duvarın içinde kalır
      let plate: pcNs.MultiPolygon;
      try {
        plate = vs.length ? pc.difference(foot, ...vs.map((v) => [voidRect(v)] as pcNs.Polygon)) : [foot];
      } catch {
        plate = [foot];
      }
      for (const { sf, F, band } of sfs) {
        let mp: pcNs.MultiPolygon;
        try {
          mp = pc.difference([band.map((p) => [p[0], p[1]] as [number, number])], plate);
        } catch {
          continue;
        }
        const d = Math.max(SLAB, sf.d ?? 0.35);
        const fKey = ck('fascia', sf.fasciaC ?? null, K('mkFascia'));
        const rs: RailSpec = {
          type: sf.rail ?? 'glassFull',
          fKey,
          mKey: ck('metal', sf.railC ?? null, 'mkRail'),
          parH: 0.04,
          gKey: ck('glass', sf.glassC ?? null, K('mkRailGlass')),
          railH: sf.railH ?? undefined,
          drop: d - SLAB,
          postEvery: sf.postEvery ?? undefined,
        };
        for (const poly of mp) {
          const outerR = openRing(poly[0] as V2[]);
          if (outerR.length < 3 || Math.abs(area2(outerR)) < 0.05) continue;
          const holes = poly.slice(1).map((h) => openRing(h as V2[]));
          // Üst yüz (loca döşemesiyle aynı kot) ve alt yüz (döşeme alnı alt kenarı)
          if (holes.length) {
            slab(b, outerR, holes, y, 'mkSlabTop', K('mkSoffit'));
          } else {
            b.polygon('mkSlabTop', outerR, y + 0.01, true, 0.5);
            b.polygon(K('mkSoffit'), outerR, y - d, false, 0.5);
          }
          curPoly = outerR;
          let run = 0;
          for (const r of [outerR, ...holes])
            for (let j = 0; j < r.length; j++) {
              const p = r[j];
              const q = r[(j + 1) % r.length];
              const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
              if (L < 0.02) continue;
              const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
              if (onLine(F, m, 0.03)) {
                parapet(b, p, q, y, run, rs);
                run += L;
                continue;
              }
              // Ön hat dışındaki kenar: dışı dolu duvarsa gizli, değilse döşeme yan yüzü
              const [po, qo] = outwardOrder(outerR, p, q);
              const nx = -(qo[1] - po[1]) / L;
              const nz = (qo[0] - po[0]) / L;
              const t: V2 = [m[0] + nx * 0.05, m[1] + nz * 0.05];
              if (plate.some((pl) => inside(openRing(pl[0] as V2[]), t[0], t[1]))) continue;
              b.wall(fKey, po, qo, y - d, y + 0.01, [0, y - d, L, y + 0.01]);
            }
        }
      }
    }

  // ── Loca balkonları: döşeme, tavan, taban izi hattında parapet (+ cam balkon) ──
  for (let k = 0; k < S; k++) {
    const vs = voidsAt(k);
    if (!vs.length) continue;
    const y = floorY(k);
    const yCeil = floorY(k + 1) - SLAB - 0.01;
    let mp: pcNs.MultiPolygon;
    /** v9: slabFronts varsa tavan ayrı çokgenle (üst katın şeridi çıkarılmış); yoksa döşemeyle aynı */
    let mpCeil: pcNs.MultiPolygon | null = null;
    try {
      const vr = vs.map((v) => [voidRect(v)]);
      mp = pc.intersection(pc.union(vr[0], ...vr.slice(1)), foot);
      // v9: sürekli ön hat (slabFronts) bu katta: şerit + önündeki bölge loca döşemesinden çıkarılır; tavandan üst
      // katın şeridi çıkarılır (en üst katta tavan tam kalır)
      const strips = (kk: number) =>
        sfOf(kk).map((x) => [x.strip.map((p) => [p[0], p[1]] as [number, number])] as pcNs.Polygon);
      const cF = strips(k);
      const cC = strips(k + 1);
      if (cF.length || cC.length) {
        mpCeil = cC.length ? pc.difference(mp, ...cC) : mp;
        if (cF.length) mp = pc.difference(mp, ...cF);
        for (const poly of mpCeil) {
          const oc = openRing(poly[0] as V2[]);
          if (oc.length >= 3 && Math.abs(area2(oc)) >= 0.05) b.polygon(K('mkSoffit'), oc, yCeil, false, 0.5);
        }
      }
    } catch {
      continue;
    }
    for (const poly of mp) {
      const outer0 = openRing(poly[0] as V2[]);
      if (outer0.length < 3 || Math.abs(area2(outer0)) < 0.2) continue;
      // v7: loca ön kenarının uçları taban izi İÇİNE döner (endIn: yarıçap / pah) — döşeme, tavan, korkuluk bu
      // dönüşü izler; köşe locasında köşe noktası yuvarlanır (1541439435 / 1540901770 / 1541439437)
      const fil = filletLoggia(outer0, vs);
      const outer = fil.poly;
      b.polygon('mkSlabTop', outer, y + 0.01, true, 0.5);
      if (!mpCeil) b.polygon(K('mkSoffit'), outer, yCeil, false, 0.5);
      curPoly = outer;
      let run = 0;
      for (let j = 0; j < outer.length; j++) {
        const p = outer[j];
        const q = outer[(j + 1) % outer.length];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 0.05) continue;
        const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const filV = fil.seg.get(j);
        // Yalnızca taban izi sınırındaki kenarlar (dışa açık) ve uç dönüşleri
        if (!filV && distToRing(ring, m[0], m[1]) > 0.06) continue;
        const vFound =
          filV ??
          vs.find((vv) => {
            const e = E[vv.edge];
            const u = (m[0] - e.a[0]) * e.t[0] + (m[1] - e.a[1]) * e.t[1];
            const dn = (m[0] - e.a[0]) * e.n[0] + (m[1] - e.a[1]) * e.n[1];
            return Math.abs(dn) < 0.1 && u > vv.u0 - 0.1 && u < vv.u1 + 0.1;
          });
        // v7: taban izi hattındaki parçanın locası bulunamazsa (birleştirilen / itilen yüz) orta noktayı içeren loca
        // (önceden katın ilk locası — binanın başka yüzündeki loca ayarlarıyla çizilebiliyordu)
        const onOwn = (vv: Void) => {
          const e = E[vv.edge];
          const u = (m[0] - e.a[0]) * e.t[0] + (m[1] - e.a[1]) * e.t[1];
          const dn = (m[0] - e.a[0]) * e.n[0] + (m[1] - e.a[1]) * e.n[1];
          return Math.abs(dn) < 0.1 && u > vv.u0 - 0.1 && u < vv.u1 + 0.1;
        };
        const v =
          vFound ??
          // birleştirilen (atılan) B locası: kendi yüzünde kendi cam / renk ayarları
          voidsAll.find((vv) => !voids.includes(vv) && vv.it.storeys.includes(k) && onOwn(vv)) ??
          vs.find((vv) => {
            const r = voidRect(vv) as V2[];
            return inside(r, m[0], m[1]) || distToRing(r, m[0], m[1]) < 0.03;
          }) ??
          vs[0];
        // Kavisli gömük loca: ön kenar (parapet, cam, stor) taban izi hattında değil, yay üzerinde (taşan balkon
        // döngüsü çizer); burada taban izi hattı iç kenar olarak açık kalır
        if (curvedLoggia(v.it) && !filV) {
          run += L;
          continue;
        }
        // v7: taşan + gömük balkonun taban izi hattı açık (ön kenar taşan döşemenin ucunda); köşedeki yan açıklık kalır
        if (vFound && !filV && deepLoggia(vFound.it)) {
          run += L;
          continue;
        }
        const rs = railSpecOf(v.it, k);
        parapet(b, p, q, y, run, rs);
        const kk = String(k);
        const [po0, qo0] = outwardOrder(outer, p, q);
        // v7: açık locada korkuluk üstünden tavana kare güvenlik kafesi (ölçülen renk, göz aralığı)
        const cg = v.it.cage?.[kk] ?? v.it.cage?.['*'];
        if (cg && !v.it.glazed.includes(k)) {
          const ev = Math.max(0.05, v.it.cageEvery ?? 0.15);
          const [cp, cq] = insetSeg(po0, qo0, 0.07);
          const ck0 = ck(`cage:${Math.round(ev * 1000) / 1000}`, cg, 'mkMesh');
          const yb = y + (rs.railH && rs.railH > 0.1 ? rs.railH : RAIL) + 0.03;
          b.wall(ck0, cp, cq, yb, yCeil - 0.01, [run, yb, run + L, yCeil]);
          b.wall(ck0, cq, cp, yb, yCeil - 0.01, [run + L, yb, run, yCeil]);
        }
        if (v.it.glazed.includes(k)) {
          const tint = v.it.tint[kk];
          const tn = tintCode(tint);
          const [pp0, qq0] = [po0, qo0];
          const { y0: gy0, inset } = camGlassSpan(rs, y);
          const [pp, qq] = insetSeg(pp0, qq0, inset);
          const [cz, cw] = curtAux(v.it, kk);
          const aux: V4 = [hash(o.seed + k * 13 + run + v.id) * 100, tn, cz, cw];
          // Camın önünde demir parmaklık (kemerli / düz); v7: kısmi boy (grilleH) ve camın ARKASINDA (grilleIn)
          const gr = v.it.grille?.[kk] ?? v.it.grille?.['*'];
          if (gr) {
            const gh = v.it.grilleH?.[kk] ?? v.it.grilleH?.['*'];
            balGrille(
              b,
              pp,
              qq,
              gy0,
              gh != null && gh > 0.2 ? Math.min(yCeil, gy0 + gh) : yCeil,
              gr,
              ck('metal', v.it.grilleC ?? '#2f3438', 'darkMetal'),
              v.it.grilleW ?? 0.9,
              v.it.grilleIn ? -0.07 : 0.05,
            );
          }
          if (tint === 'frosted')
            b.wall(ck('glass', v.it.frostC ?? '#d9dfdd', K('mkRailGlass')), pp, qq, gy0, yCeil, [
              run,
              0,
              run + L,
              1,
            ]);
          else
            b.quad(
              camGlassKey(v.it, k),
              [pp[0], gy0, pp[1]],
              [qq[0], gy0, qq[1]],
              [qq[0], yCeil, qq[1]],
              [pp[0], yCeil, pp[1]],
              [run, 0, run + L, 1],
              aux,
            );
          const fk = ck('frame', v.it.frameC?.[String(k)] ?? v.it.frameC?.['*'], K('mkRail'));
          b.wall(fk, pp, qq, yCeil - 0.04, yCeil);
          b.wall(fk, pp, qq, gy0 - 0.02, gy0 + 0.02);
        } else if (v.it.blinds?.[kk]) {
          // Açık locada bambu / hasır stor: tavandan korkuluk üstüne, korkuluğun arkasında
          const bt = y + (v.it.blindTo?.[kk] ?? (rs.railH && rs.railH > 0.1 ? rs.railH : RAIL));
          const [bp, bq] = insetSeg(po0, qo0, 0.14);
          balBlind(b, bp, bq, bt, yCeil - 0.02, ck('blind', v.it.blinds[kk], 'mkShutter'), run);
        }
        run += L;
      }
      const sp = vs.some((vv) => {
        if (!vv.it.spots) return false;
        const c = centroid(voidRect(vv));
        return inside(outer, c[0], c[1]);
      });
      if (sp && (k > 0 || yCeil - base > 3)) {
        // Ölçülmüş tavan spotları: ön kenardan `inset` içeride, eşit aralıklı (v7: ölçülen u listesi, dikdörtgen)
        for (const vv of vs) {
          const spv = vv.it.spots;
          if (!spv) continue;
          const W = vv.u1 - vv.u0;
          const n = Math.max(1, spv.n ?? Math.round(W / Math.max(0.8, spv.every ?? 2.7)));
          const ins = Math.min(vv.inset - 0.2, Math.max(0.15, spv.inset ?? 0.5));
          const us = spv.us?.length
            ? spv.us
            : Array.from({ length: n }, (_, j) => vv.u0 + (W * (j + 0.5)) / n);
          for (const u of us) {
            const c = P(vv.edge, u, -ins);
            if (!inside(outer, c[0], c[1])) continue;
            downlight(b, c, yCeil - 0.006, spv, E[vv.edge].yaw);
          }
        }
      } else if (k > 0 || yCeil - base > 3) {
        const c = centroid(outer);
        const g = new THREE.CircleGeometry(0.08, 12)
          .rotateX(Math.PI / 2)
          .translate(c[0], yCeil - 0.006, c[1]);
        b.geometry('mkDownlight', g);
      }
    }
  }

  // ── Renkli panolar / bantlar ──
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t !== 'band' && it.t !== 'panel') continue;
      // v7: girintinin İÇİNDE kalan bant / pano girintinin ARKA duvarında (döşeme alınları, arka duvar panoları —
      // 1540901774 / 1540901776 çerçeve yuvaları); açıklıkları girintinin arka duvar açıklıkları. Girinti ağzını aşan
      // (kenar boyu kat silmesi gibi) öğeler cephede kalır, ağızda kesilir.
      const rIn = recInside(i, it.u0, it.u1, base + it.y0, base + it.y1);
      const Pb: PFn = rIn ? (ii, u, off = 0) => P(ii, u, off - rIn.depth) : P;
      const dflt0 =
        it.color === 'strip'
          ? K('mkStrip')
          : it.color === 'fascia'
            ? K('mkFascia')
            : it.color === 'plinth'
              ? K('mkPlinth')
              : it.color === 'plaster'
                ? K('mkPlaster')
                : ck('plaster', it.color, K('mkPlaster2'));
      // v7: çok renkli karo bandı (gökkuşağı seramik süpürgelik): karo boyu, palet, sıra (verilmezse tohumlu)
      const tileKey =
        it.style === 'tiles' && it.colors?.length
          ? ck(
              `tiles:${Math.round(Math.max(0.03, it.tile ?? 0.2) * 1000) / 1000}:${it.colors
                .filter((c) => /^#[0-9a-f]{6}$/i.test(c))
                .map((c) => c.toLowerCase())
                .join(',')}:${(it.seq ?? []).join('.')}${
                it.bond === 'running'
                  ? `:running:${Math.round(Math.max(0.02, it.tileH ?? 0.1) * 1000) / 1000}`
                  : ''
              }`,
              /^#[0-9a-f]{6}$/i.test(it.color) ? it.color : '#e8e6e0',
              dflt0,
            )
          : null;
      const key = tileKey ?? cladKey(it.clad, it.color, dflt0, it.finish);
      if (it.t === 'band' && it.style === 'louvre') {
        // Lamelli alüminyum alın (dükkân saçağı / güneşlik): koyu gölge zemini + eğik yatay lameller + yan kapaklar
        const u0 = Math.max(rIn ? rIn.u0 : 0, it.u0);
        const u1 = Math.min(rIn ? rIn.u1 : E[i].len, it.u1);
        const Y0 = base + it.y0;
        const Y1 = base + it.y1;
        const W = u1 - u0;
        if (W < 0.05 || Y1 - Y0 < 0.05) continue;
        const dep = Math.max(0.06, it.proud);
        const n = Math.max(2, Math.round(it.slats ?? (Y1 - Y0) / 0.15));
        const pitch = (Y1 - Y0) / n;
        // Lameller pencere / kapı / girinti açıklıklarını kesmez: açıklığın u aralığında lamel parçalara bölünür
        const lops = (rIn ? rIn.ops : [...openings[i], ...recHoles(i)]).filter(
          (op) => op.u1 > u0 && op.u0 < u1 && op.y1 > Y0 && op.y0 < Y1,
        );
        const freeU = (ya: number, yb: number): [number, number][] => {
          const cov = lops
            .filter((op) => op.y0 < yb - 1e-4 && op.y1 > ya + 1e-4)
            .map((op) => [Math.max(u0, op.u0), Math.min(u1, op.u1)] as [number, number])
            .sort((p, q) => p[0] - q[0]);
          const out: [number, number][] = [];
          let cur = u0;
          for (const [a, e] of cov) {
            if (a > cur) out.push([cur, a]);
            cur = Math.max(cur, e);
          }
          if (cur < u1) out.push([cur, u1]);
          return out.filter(([a, e]) => e - a > 0.02);
        };
        const uc = (u0 + u1) / 2;
        const shadeK = ck('plaster', it.shade ?? null, 'darkMetal');
        if (!lops.length) b.wall(shadeK, Pb(i, u0, 0.008), Pb(i, u1, 0.008), Y0, Y1);
        else
          wallWithOpenings(b, (ii, u, off = 0) => Pb(ii, u, off + 0.008), i, u0, u1, 0, Y0, Y1, lops, shadeK);
        for (let j = 0; j < n; j++) {
          const ys = Y0 + pitch * (j + 0.5);
          for (const [sa, se] of lops.length
            ? freeU(ys - pitch / 2, ys + pitch / 2)
            : [[u0, u1] as [number, number]]) {
            const g = new THREE.BoxGeometry(se - sa, pitch * 0.8, 0.035);
            g.rotateX(-0.35); // üst kenar duvara doğru, alt kenar dışarı (panjur eğimi)
            g.rotateY(E[i].yaw);
            const c = Pb(i, (sa + se) / 2, dep - 0.03);
            g.translate(c[0], ys, c[1]);
            b.geometry(key, g);
          }
        }
        for (const uu of [u0 + 0.02, u1 - 0.02]) {
          const c = Pb(i, uu, dep / 2);
          b.box(key, [c[0], (Y0 + Y1) / 2, c[1]], [0.04, Y1 - Y0, dep], E[i].yaw);
        }
        const tc = Pb(i, uc, dep / 2);
        b.box(key, [tc[0], Y1 - 0.015, tc[1]], [W, 0.03, dep], E[i].yaw);
        continue;
      }
      // v9: çokgen pano (poly: gerçek u, tabandan y): köşegen bölünmüş kaplama vb. — açıklıklar delik, düz yüz
      if (it.poly && it.poly.length >= 3 && !rIn) {
        const offP = Math.max(0.006, it.proud);
        const pr = it.poly.map(([u, y]) => [u, base + y] as [number, number]);
        const us = pr.map((q) => q[0]);
        const ysP = pr.map((q) => q[1]);
        const [pu0, pu1, py0, py1] = [Math.min(...us), Math.max(...us), Math.min(...ysP), Math.max(...ysP)];
        const holes = [...openings[i], ...recHoles(i)]
          .filter((op) => op.u1 > pu0 && op.u0 < pu1 && op.y1 > py0 && op.y0 < py1)
          .map((op) => opRing(op));
        // Kenar boyuna kırpılır (kütle parçasında pano komşu parçaya taşabilir)
        let parts: [number, number][][] = [pr];
        if (pu0 < -0.01 || pu1 > E[i].len + 0.01)
          try {
            parts = pc
              .intersection([pr], [rectRing([0, py0 - 1, E[i].len, py1 + 1])])
              .map((q) => openRing(q[0] as V2[]) as [number, number][]);
          } catch {
            parts = [];
          }
        for (const q of parts)
          if (q.length >= 3) cutFace(b, key, P, i, offP, q, holes, E[i].n, false, E[i].s0);
        continue;
      }
      const off = Math.max(0.006, it.proud);
      const u0 = Math.max(rIn ? rIn.u0 : 0, it.u0);
      const u1 = Math.min(rIn ? rIn.u1 : E[i].len, it.u1);
      // Pano pencere/kapı açıklıklarını örtmez: açıklıkların u/y kenarlarından ızgaraya bölünüp boş hücreler çizilir
      const Y0 = rIn ? Math.max(rIn.Y0, base + it.y0) : base + it.y0;
      // Alınlık kenarında pano saçak kotunu aşıyorsa üst kısmı alınlık eğimine kırpılır (aşağıda ayrı çizilir)
      const gableUp = !rIn && isGableEdge(i) && base + it.y1 > wallTop + 0.01 && it.proud <= 0.02;
      const Y1 = gableUp ? Math.max(Y0, wallTop) : rIn ? Math.min(rIn.Y1, base + it.y1) : base + it.y1;
      if (u1 - u0 < 0.01 || Y1 - Y0 < 0.005) continue;
      if (gableUp) {
        const pr = gableProf.get(i);
        if (pr && pr.length >= 2) {
          const yTop = base + it.y1;
          const region: [number, number][] = [
            [pr[0][0], wallTop - 1],
            ...pr.map((q) => [q[0], q[1]] as [number, number]),
            [pr[pr.length - 1][0], wallTop - 1],
          ];
          const rect: [number, number][] = [
            [u0, Math.max(Y0, wallTop)],
            [u1, Math.max(Y0, wallTop)],
            [u1, yTop],
            [u0, yTop],
          ];
          try {
            let mp = pc.intersection([rect], [region]);
            const holes = attic[i]
              .filter((op) => op.u1 > u0 && op.u0 < u1 && op.y1 > wallTop)
              .map(
                (op) =>
                  [
                    [op.u0, op.y0],
                    [op.u1, op.y0],
                    [op.u1, op.y1],
                    [op.u0, op.y1],
                  ] as [number, number][],
              );
            if (holes.length && mp.length) mp = pc.difference(mp, ...holes.map((h) => [h] as pcNs.Polygon));
            for (const poly of mp)
              planarFace(b, key, P, i, off, poly as [number, number][][], E[i].n, E[i].s0, base);
          } catch {
            /* kırpma başarısız: üst kısım çizilmez */
          }
        }
      }
      // Açıklıklar + gömük loca ağızları (kat döşemesinden bir üst döşemeye)
      const locas = rIn
        ? []
        : voidsAll
            .filter((v) => v.edge === i)
            .flatMap((v) =>
              v.it.storeys
                .filter((k) => k >= 0 && k < S)
                .map((k) => ({ u0: v.u0, u1: v.u1, y0: floorY(k), y1: floorY(k + 1) - SLAB })),
            );
      const ops = (rIn ? [...rIn.ops] : [...openings[i], ...locas, ...recHoles(i)]).filter(
        (op) => op.u1 > u0 && op.u0 < u1 && op.y1 > Y0 && op.y0 < Y1,
      );
      const us = [u0, u1, ...ops.flatMap((op) => [op.u0, op.u1])]
        .filter((u) => u >= u0 && u <= u1)
        .sort((p, q) => p - q);
      const ys = [Y0, Y1, ...ops.flatMap((op) => [op.y0, op.y1])]
        .filter((y) => y >= Y0 && y <= Y1)
        .sort((p, q) => p - q);
      for (let a = 0; a + 1 < us.length; a++) {
        const ua = us[a];
        const ub = us[a + 1];
        if (ub - ua < 1e-3) continue;
        // Dikey hücreleri birleştir (açıklıksız ardışık hücreler tek dörtgen)
        let yStart: number | null = null;
        const flush = (yEnd: number) => {
          if (yStart == null || yEnd - yStart < 1e-3) return;
          b.wall(key, Pb(i, ua, off), Pb(i, ub, off), yStart, yEnd, [
            E[i].s0 + ua,
            yStart - base,
            E[i].s0 + ub,
            yEnd - base,
          ]);
          // v7: düzensiz düşey kaplama derzleri (ölçülen u'lar)
          cladJoints(it.clad, Pb, i, off, ua, ub, yStart, yEnd);
        };
        for (let c = 0; c + 1 < ys.length; c++) {
          const ya = ys[c];
          const yb = ys[c + 1];
          if (yb - ya < 1e-3) continue;
          const um = (ua + ub) / 2;
          const ym = (ya + yb) / 2;
          const hole = ops.some((op) => um > op.u0 && um < op.u1 && ym > op.y0 && ym < op.y1);
          if (hole) {
            flush(ya);
            yStart = null;
          } else if (yStart == null) yStart = ya;
        }
        flush(ys[ys.length - 1]);
      }
      // v9: yuvarlatılmış / kemerli açıklığın dikdörtgen hücre dışında kalan köşeleri pano renginde
      for (const op of ops) {
        const w = (op as { win?: CWin }).win;
        if (!w || !shapedWin(w)) continue;
        const ra = Math.max(u0, op.u0);
        const rb = Math.min(u1, op.u1);
        const yA = Math.max(Y0, op.y0);
        const yB = Math.min(Y1, op.y1);
        if (rb - ra < 0.02 || yB - yA < 0.02) continue;
        cutFace(
          b,
          key,
          Pb,
          i,
          off,
          rectRing([ra, yA, rb, yB]),
          [opRing(op as Opening)],
          E[i].n,
          false,
          E[i].s0,
        );
      }
      if (it.proud > 0.02) {
        b.quad(
          key,
          [...xz(Pb(i, u0, 0), Y1)],
          [...xz(Pb(i, u1, 0), Y1)],
          [...xz(Pb(i, u1, off), Y1)],
          [...xz(Pb(i, u0, off), Y1)],
        );
      }
    }

  // ── Turuncu yuvarlak şeritler (Mertkent); turuncu olmayan renkte düz pilastır (komşu bloklar) ──
  const stripHex = (blk.colors as Record<string, string | undefined>).strip ?? '#d98a45';
  const sc = new THREE.Color(stripHex);
  const hsl = { h: 0, s: 0, l: 0 };
  sc.getHSL(hsl, THREE.SRGBColorSpace);
  const roundStrip = hsl.s > 0.3 && hsl.h > 0.03 && hsl.h < 0.14;
  for (let i = 0; i < N; i++)
    for (const it0 of items(i)) {
      if (it0.t !== 'strip') continue;
      if (voids.some((v) => v.edge === i && it0.u > v.u0 + 0.1 && it0.u < v.u1 - 0.1)) continue;
      if (
        recs.some(
          (r) =>
            r.i === i &&
            it0.u > r.u0 + 0.05 &&
            it0.u < r.u1 - 0.05 &&
            base + it0.y0 < r.Y1 &&
            base + it0.y1 > r.Y0,
        )
      )
        continue;
      // Şerit saçak altında biter (ölçümde çatı hizasını aşan uçlar çatıdan taşıyordu); alınlık kenarında alınlık
      // eğimine kadar çıkar (şeritler alınlık çizgisinin ~0.1 m altında biter)
      const gTop = isGableEdge(i) ? gableAt(i, it0.u) : null;
      const lim = gTop != null ? Math.max(wallTop, gTop - 0.1) : wallTop - 0.05;
      const it = { ...it0, y1: Math.min(it0.y1, lim - base) };
      if (it.y1 - it.y0 < 0.3) continue;
      const topS = it0.top ?? 'round';
      const botS = it0.bottom ?? 'round';
      if (!roundStrip) {
        const w = Math.max(0.18, Math.min(0.5, it.w));
        const p = P(i, it.u, 0.03);
        const tipH = topS === 'point' ? Math.min(w * 0.8, (it.y1 - it.y0) * 0.3) : 0;
        b.box(
          K('mkStrip'),
          [p[0], base + (it.y0 + it.y1 - tipH) / 2, p[1]],
          [w, it.y1 - it.y0 - tipH, 0.06],
          E[i].yaw,
        );
        if (tipH > 0) {
          // Sivri tepe: üçgen prizma (ön yüz + iki eğik üst yüz)
          const y1 = base + it.y1 - tipH;
          const L = P(i, it.u - w / 2, 0.06);
          const R = P(i, it.u + w / 2, 0.06);
          const C = P(i, it.u, 0.06);
          const Lb = P(i, it.u - w / 2, 0);
          const Rb = P(i, it.u + w / 2, 0);
          const Cb = P(i, it.u, 0);
          b.quad(K('mkStrip'), xz(L, y1), xz(R, y1), xz(C, y1 + tipH), xz(C, y1 + tipH));
          b.quad(K('mkStrip'), xz(Lb, y1), xz(L, y1), xz(C, y1 + tipH), xz(Cb, y1 + tipH));
          b.quad(K('mkStrip'), xz(R, y1), xz(Rb, y1), xz(Cb, y1 + tipH), xz(C, y1 + tipH));
        }
        continue;
      }
      const w = Math.max(0.2, Math.min(0.4, it.w * 1.15));
      const r = w / 2;
      if (topS === 'round' && botS === 'round') {
        const Lc = Math.max(0.01, it.y1 - it.y0 - w);
        const g = new THREE.CapsuleGeometry(r, Lc, 3, 10);
        g.scale(1, 1, 0.4);
        g.rotateY(E[i].yaw);
        const p = P(i, it.u, 0);
        g.translate(p[0], base + (it.y0 + it.y1) / 2, p[1]);
        b.geometry(K('mkStrip'), g);
      } else {
        // Uç biçimleri ayrı: yarım yuvarlak / sivri (koni) / düz uçlu yarım yuvarlak kesitli şerit
        const endH = (s: string) =>
          s === 'round' ? r : s === 'point' ? Math.min(w * 1.2, (it.y1 - it.y0) * 0.3) : 0;
        const hT = endH(topS);
        const hB = endH(botS);
        const Lc = Math.max(0.01, it.y1 - it.y0 - hT - hB);
        const p = P(i, it.u, 0);
        const yb = base + it.y0 + hB;
        const add = (g: THREE.BufferGeometry, y: number) => {
          g.scale(1, 1, 0.4);
          g.rotateY(E[i].yaw);
          g.translate(p[0], y, p[1]);
          b.geometry(K('mkStrip'), g);
        };
        add(new THREE.CylinderGeometry(r, r, Lc, 10, 1, hT > 0 && hB > 0), yb + Lc / 2);
        const cap = (s: string, up: boolean) => {
          const y = up ? yb + Lc : yb;
          if (s === 'round')
            add(new THREE.SphereGeometry(r, 10, 4, 0, Math.PI * 2, up ? 0 : Math.PI / 2, Math.PI / 2), y);
          else if (s === 'point') {
            const h = endH(s);
            const g = new THREE.ConeGeometry(r, h, 10, 1, true);
            if (!up) g.rotateX(Math.PI);
            add(g, up ? y + h / 2 : y - h / 2);
          }
        };
        cap(topS, true);
        cap(botS, false);
      }
    }

  // ── Balkonlar: kat başına plan birleşimi ──
  const balByStorey = new Map<
    number,
    {
      poly: V2[];
      glazed: boolean;
      tint: number;
      edge: number;
      rail: RailSpec;
      /** Cam balkon profil malzemesi */
      fk: string;
      /** Buzlu cam balkon malzemesi (verilirse mkCamGlass yerine) */
      frost: string | null;
      /** Kaynak balkon öğesi (perde / parmaklık / stor / spot) */
      it: CBal;
    }[]
  >();
  const caps = new Map<number, { poly: V2[]; it: CBal; i: number }[]>();
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t !== 'bal') continue;
      // Taşan balkon; kavisli gömük locanın taban izi dışındaki yay kısmı da (döşeme, korkuluk, cam yay boyunca).
      // Düz gömük locada yalnız saksılar (korkuluk taban izi hattında). v7: taşan + gömük balkonun taşan kısmı da
      const proj = !isRecessed(it) || curvedLoggia(it) || deepLoggia(it);
      const rect = (grow: number): V2[] =>
        it.bulge || it.round || it.chamfer
          ? [P(i, it.u0 - grow, 0), P(i, it.u1 + grow, 0), ...balFront(it, grow).map(([u, f]) => P(i, u, f))]
          : [
              P(i, it.u0 - grow, 0),
              P(i, it.u1 + grow, 0),
              P(i, it.u1 + grow, it.d + grow),
              P(i, it.u0 - grow, it.d + grow),
            ];
      for (const k of proj ? it.storeys : []) {
        if (k < 0 || k >= S) continue;
        if (!balByStorey.has(k)) balByStorey.set(k, []);
        const tint = it.tint[String(k)];
        balByStorey.get(k)!.push({
          poly: rect(0),
          glazed: it.glazed.includes(k),
          tint: tintCode(tint),
          edge: i,
          rail: railSpecOf(it, k),
          fk: ck('frame', it.frameC?.[String(k)] ?? it.frameC?.['*'], 'mkRail'),
          frost: tint === 'frosted' ? ck('glass', it.frostC ?? '#d9dfdd', K('mkRailGlass')) : null,
          it,
        });
      }
      // Saksılar (kat → u listesi): korkuluk üstünde asılı dikdörtgen saksı ya da döşemede yuvarlak saksı + bitki.
      // v7: saksı başına ayrıntı (potSpec: korkuluk / döşeme, bitkisiz saksı, renk) — aynı balkonda karışık saksılar
      for (const [kk, us] of Object.entries(it.pots ?? {})) {
        const k = Number(kk);
        if (!(k >= 0 && k < S)) continue;
        const y = floorY(k);
        const rs = railSpecOf(it, k);
        const RH = rs.railH && rs.railH > 0.1 ? rs.railH : RAIL;
        for (const u of us) {
          const spec = it.potSpec?.[kk]?.find((q) => Math.abs(q.u - u) < 0.011);
          const potK = ck('plaster', spec?.potC ?? it.potC ?? '#a0583a', 'mkPot');
          const pc0 = spec?.plantC ?? it.plantC;
          const plK = pc0 ? ck('fascia', pc0, 'boxwood') : 'boxwood';
          const plant = spec?.plant !== false;
          const on = spec?.on ?? it.potsOn;
          const f = frontOff(it, u);
          const fl = plant ? (it.flowerC ?? []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)) : [];
          if (on === 'floor') {
            const c = P(i, u, f - 0.35);
            b.cylinder(potK, [c[0], y, c[1]], 0.2, 0.4, 10);
            if (plant) b.sphere(plK, [c[0], y + 0.75, c[1]], 0.38, 9);
            // Ölçülmüş çiçek renkleri: bitki tepesinde sırayla küçük çiçek öbekleri
            fl.forEach((fc, j) => {
              const a = (j / fl.length) * Math.PI * 2 + u;
              b.sphere(
                ck('awning', fc, plK),
                [c[0] + Math.cos(a) * 0.24, y + 0.95, c[1] + Math.sin(a) * 0.24],
                0.07,
                6,
              );
            });
          } else {
            const c = P(i, u, f + 0.09);
            b.box(potK, [c[0], y + RH - 0.07, c[1]], [0.6, 0.18, 0.18], E[i].yaw);
            if (plant) {
              const g = new THREE.SphereGeometry(0.3, 9, 6);
              g.scale(1.25, 0.6, 0.55);
              g.rotateY(E[i].yaw);
              g.translate(c[0], y + RH + 0.1, c[1]);
              b.geometry(plK, g);
            }
            fl.forEach((fc, j) => {
              const du = -0.28 + (0.56 * (j + 0.5)) / fl.length;
              const q = P(i, u + du, f + 0.14);
              b.sphere(ck('awning', fc, plK), [q[0], y + RH + 0.24, q[1]], 0.07, 6);
            });
          }
        }
      }
      if (proj && it.cap && it.storeys.length) {
        const top = Math.max(...it.storeys) + 1;
        if (!caps.has(top)) caps.set(top, []);
        caps.get(top)!.push({ poly: rect(0.2), it, i });
      } else if (!proj && it.cap && it.storeys.length && (it.capOver ?? 0) > 0.05) {
        // v7: gömük loca köşe kütlesinin tepe şapkası: alın taban izi hattından capOver kadar dışarı taşar; binanın
        // gerçek köşesindeki uç köşeyi aşar (komşu kenarın şapkasıyla birleşir)
        const top = Math.max(...it.storeys) + 1;
        const co = it.capOver!;
        const ua = it.u0 <= 0.05 ? it.u0 - co : it.u0;
        const ue = it.u1 >= E[i].len - 0.05 ? it.u1 + co : it.u1;
        if (!caps.has(top)) caps.set(top, []);
        caps.get(top)!.push({ poly: [P(i, ua, -0.02), P(i, ue, -0.02), P(i, ue, co), P(i, ua, co)], it, i });
      }
    }
  /** Ölçülmüş tavan spotları: balkon ön kenarından `inset` içeride, eşit aralıklı (yc: tavan kotu); v7 ölçülen u'lar */
  const balSpots = (it: CBal, i: number, yc: number, grow = 0) => {
    const sp = it.spots;
    if (!sp) return;
    const W = it.u1 - it.u0 + 2 * grow;
    const n = Math.max(1, sp.n ?? Math.round(W / Math.max(0.8, sp.every ?? 2.7)));
    const us = sp.us?.length
      ? sp.us
      : Array.from({ length: n }, (_, j) => it.u0 - grow + (W * (j + 0.5)) / n);
    for (const u of us) {
      const f = frontOff(it, u, grow);
      const c = P(i, u, Math.max(0.15, f - Math.max(0.1, sp.inset ?? 0.5)));
      downlight(b, c, yc, sp, E[i].yaw);
    }
  };
  /**
   * v7: köşeyi saran balkonların köşe parçası (wrap): köşedeki iki balkonun (ya da tek balkonun) arasındaki köşe
   * karesi eklenir, dış köşe r yarıçaplı yay / pahla kesilir. list: aynı kattaki (ya da şapka) balkon çokgenleri.
   */
  const wrapCorner = (
    list: { poly: V2[]; edge: number; it: CBal }[],
    grow: number,
  ): { add: [number, number][][]; cut: [number, number][][] } => {
    const add: [number, number][][] = [];
    const cut: [number, number][][] = [];
    for (const l of list) {
      const w = l.it.wrap;
      if (!w || !(w.r > 0.01) || (isRecessed(l.it) && !deepLoggia(l.it))) continue;
      const i = l.edge;
      for (const end of [1, 0]) {
        // Uç binanın gerçek köşesinde mi (kenar sonu / başı) ve köşe dışbükey mi
        if (end === 1 && l.it.u1 < E[i].len - 0.05) continue;
        if (end === 0 && l.it.u0 > 0.05) continue;
        const j = end === 1 ? (i + 1) % N : (i + N - 1) % N;
        const ea = E[i];
        const eb = E[j];
        const conv =
          end === 1 ? eb.t[0] * -ea.n[0] + eb.t[1] * -ea.n[1] : ea.t[0] * -eb.n[0] + ea.t[1] * -eb.n[1];
        if (conv < 0.9) continue;
        // Komşu kenarın köşedeki balkonu (derinliği); yoksa bu balkonun derinliği
        const nb = list.find(
          (q) => q !== l && q.edge === j && (end === 1 ? q.it.u0 <= 0.05 : q.it.u1 >= E[j].len - 0.05),
        );
        // Ölçülen ağır tarafın derinliği: bu kenarın ön kenarı (n_i yönünde) ve komşununki (t_i yönünde)
        const di = frontOff(l.it, end === 1 ? l.it.u1 : l.it.u0, grow);
        const dj = nb ? frontOff(nb.it, end === 1 ? nb.it.u0 : nb.it.u1, grow) : di;
        const C = end === 1 ? ea.e : ea.a;
        // Yerel çerçeve: X köşeden dışa (kenar i boyunca köşeden öteye), Y = n_i
        const X: V2 = end === 1 ? ea.t : [-ea.t[0], -ea.t[1]];
        const Y: V2 = ea.n;
        const W2 = (x: number, y: number): [number, number] => [
          C[0] + X[0] * x + Y[0] * y,
          C[1] + X[1] * x + Y[1] * y,
        ];
        add.push([W2(-0.01, -0.01), W2(dj, -0.01), W2(dj, di), W2(-0.01, di)]);
        const r = Math.max(0.02, w.r + grow);
        if (w.kind === 'chamfer')
          cut.push([
            W2(dj + 0.01, di + 0.01),
            W2(dj - r, di + 0.01),
            W2(dj - r, di),
            W2(dj, di - r),
            W2(dj + 0.01, di - r),
          ]);
        else {
          const pts: [number, number][] = [W2(dj + 0.01, di + 0.01), W2(dj - r, di + 0.01)];
          for (let s = 0; s <= 10; s++) {
            const th = Math.PI / 2 - (s / 10) * (Math.PI / 2);
            pts.push(W2(dj - r + Math.cos(th) * r, di - r + Math.sin(th) * r));
          }
          pts.push(W2(dj + 0.01, di - r));
          cut.push(pts);
        }
      }
    }
    return { add, cut };
  };
  for (const [k, list] of balByStorey) {
    const y = floorY(k);
    const polys = list.map((l) => [l.poly.map((p) => [p[0], p[1]] as [number, number])]);
    let mp: pcNs.MultiPolygon;
    try {
      const wc = wrapCorner(list, 0);
      const u = pc.union(polys[0], ...polys.slice(1), ...wc.add.map((r) => [r] as pcNs.Polygon));
      mp = pc.difference(u, foot, ...wc.cut.map((r) => [r] as pcNs.Polygon));
    } catch {
      continue;
    }
    const kk = String(k);
    for (const poly of mp) {
      const outer = openRing(poly[0]);
      if (outer.length < 3 || Math.abs(area2(outer)) < 0.2) continue;
      const holes = poly.slice(1).map(openRing);
      slab(b, outer, holes, y, 'mkSlabTop', K('mkSoffit'));
      // Parapet kenarları: bina duvarına değmeyen kenarlar
      const segs = boundarySegs(outer, ring);
      // Bu çokgene düşen balkonların cam/renk bilgisi (orta noktası içeride olan ilk kayıt)
      const info = list.find((l) => {
        const c = l.poly.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
        return inside(outer, c[0], c[1]);
      });
      // Bitişik balkonlar tek plakada birleşir; korkuluk tipi / camlılık / cam tonu her parçada KENDİ balkonundan
      // (önceden çokgenin ilk balkonundan alınıyordu: yan yana camlı-açık balkonlar aynı çıkıyordu)
      const ownerAt = (m: V2) => {
        let best = info;
        let bd = Infinity;
        for (const l of list) {
          const d = inside(l.poly, m[0], m[1]) ? 0 : distToRing(l.poly, m[0], m[1]);
          if (d < bd) {
            bd = d;
            best = l;
          }
        }
        return best;
      };
      const pieces: [V2, V2][] = [];
      for (const [p, q] of segs) {
        const Ls = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (Ls < 1e-3) continue;
        const tx = (q[0] - p[0]) / Ls;
        const tz = (q[1] - p[1]) / Ls;
        const cuts = [0, Ls];
        for (const l of list)
          for (const c of l.poly) {
            const sAl = (c[0] - p[0]) * tx + (c[1] - p[1]) * tz;
            const off = Math.abs((c[0] - p[0]) * tz - (c[1] - p[1]) * tx);
            if (off < 0.05 && sAl > 0.05 && sAl < Ls - 0.05) cuts.push(sAl);
          }
        cuts.sort((a, e) => a - e);
        for (let j = 0; j + 1 < cuts.length; j++)
          if (cuts[j + 1] - cuts[j] > 0.02)
            pieces.push([
              [p[0] + tx * cuts[j], p[1] + tz * cuts[j]],
              [p[0] + tx * cuts[j + 1], p[1] + tz * cuts[j + 1]],
            ]);
      }
      let run = 0;
      for (const [p, q] of pieces) {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const own = ownerAt([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
        parapet(b, p, q, y, run, own?.rail);
        const yTop = floorY(k + 1) - SLAB - 0.01;
        if (own?.glazed && k + 1 <= S) {
          const [cz, cw] = curtAux(own.it, kk);
          const aux: V4 = [hash(o.seed + k * 13 + run) * 100, own.tint, cz, cw];
          const { y0: gy0, inset } = camGlassSpan(own.rail, y);
          const [p0, q0] = outwardOrder(outer, p, q);
          const [gp, gq] = insetSeg(p0, q0, inset);
          if (own.frost)
            // Buzlu cam balkon: düz renkli yarı saydam cam (oda gölgelendiricisi yok)
            b.wall(own.frost, gp, gq, gy0, yTop, [run, 0, run + L, 1]);
          else
            b.quad(
              camGlassKey(own.it, k),
              [gp[0], gy0, gp[1]],
              [gq[0], gy0, gq[1]],
              [gq[0], yTop, gq[1]],
              [gp[0], yTop, gp[1]],
              [run, 0, run + L, 1],
              aux,
            );
          // Alt/üst alüminyum profil (ölçülmüş renk kat kat)
          b.wall(own.fk, gp, gq, yTop - 0.04, yTop);
          b.wall(own.fk, gp, gq, gy0 - 0.02, gy0 + 0.02);
          // Camın önünde demir parmaklık (kemerli / düz); v7: kısmi boy ve camın arkasında
          const gr = own.it.grille?.[kk] ?? own.it.grille?.['*'];
          if (gr) {
            const gh = own.it.grilleH?.[kk] ?? own.it.grilleH?.['*'];
            balGrille(
              b,
              gp,
              gq,
              gy0,
              gh != null && gh > 0.2 ? Math.min(yTop, gy0 + gh) : yTop,
              gr,
              ck('metal', own.it.grilleC ?? '#2f3438', 'darkMetal'),
              own.it.grilleW ?? 0.9,
              own.it.grilleIn ? -0.07 : 0.05,
            );
          }
        } else if (own && (own.it.cage?.[kk] ?? own.it.cage?.['*']) && k + 1 <= S) {
          // v7: açık balkonda korkuluk üstünden tavana kare güvenlik kafesi
          const cg = (own.it.cage?.[kk] ?? own.it.cage?.['*'])!;
          const ev = Math.max(0.05, own.it.cageEvery ?? 0.15);
          const [p0, q0] = outwardOrder(outer, p, q);
          const [cp, cq] = insetSeg(p0, q0, 0.07);
          const ck0 = ck(`cage:${Math.round(ev * 1000) / 1000}`, cg, 'mkMesh');
          const yb = y + (own.rail.railH && own.rail.railH > 0.1 ? own.rail.railH : RAIL) + 0.03;
          b.wall(ck0, cp, cq, yb, yTop - 0.01, [run, yb, run + L, yTop]);
          b.wall(ck0, cq, cp, yb, yTop - 0.01, [run + L, yb, run, yTop]);
        } else if (own?.it.blinds?.[kk] && k + 1 <= S) {
          // Açık balkonda bambu / hasır stor: yalnız ön (duvara paralel) kenarlarda, korkuluğun arkasında
          const et = E[own.edge].t;
          if (Math.abs(((q[0] - p[0]) * et[0] + (q[1] - p[1]) * et[1]) / Math.max(1e-6, L)) > 0.9) {
            const bt =
              y + (own.it.blindTo?.[kk] ?? (own.rail.railH && own.rail.railH > 0.1 ? own.rail.railH : RAIL));
            const [p0, q0] = outwardOrder(outer, p, q);
            const [bp, bq] = insetSeg(p0, q0, 0.14);
            balBlind(b, bp, bq, bt, yTop - 0.02, ck('blind', own.it.blinds[kk], 'mkShutter'), run);
          }
        }
        run += L;
      }
      // Tavan spotu (ölçülmüşse balkon başına dizi, yoksa çokgen ortasında bir tane)
      if (k > 0) {
        const mine = list.filter((l) => {
          const c = l.poly.reduce(
            (a, p) => [a[0] + p[0] / l.poly.length, a[1] + p[1] / l.poly.length],
            [0, 0],
          );
          return inside(outer, c[0], c[1]);
        });
        // Kavisli locanın yay şeridi: tavan spotu loca döngüsünde (loca tavanında)
        if (mine.length && mine.every((l) => curvedLoggia(l.it) || deepLoggia(l.it))) {
          /* spot yok */
        } else if (mine.some((l) => l.it.spots))
          for (const l of mine) balSpots(l.it, l.edge, y - SLAB - 0.006);
        else {
          const c = centroid(outer);
          const g = new THREE.CircleGeometry(0.08, 12)
            .rotateX(Math.PI / 2)
            .translate(c[0], y - SLAB - 0.006, c[1]);
          b.geometry('mkDownlight', g);
        }
      }
      if (k === 0 && y - base < 2.5)
        o.collide?.(
          outer.map((p) => [p[0], p[1]]),
          y - SLAB,
          y + RAIL,
        );
    }
  }
  // Tepe şapkaları (en üst balkon üstü düz saçak plağı, kalın koyu gri alın); ölçülmüşse renk, kalınlık, çatı
  // eğimini izleyen eğik üst yüz, üstünde teras korkuluğu, altında spotlar
  for (const [k, list] of caps) {
    const y = floorY(k);
    const polys = list.map((r) => [r.poly.map((p) => [p[0], p[1]] as [number, number])]);
    let mp: pcNs.MultiPolygon;
    try {
      // v7: köşeyi saran şapka (wrap) balkon yayını 0.2 m taşmayla izler
      const wc = wrapCorner(
        list.map((l) => ({ poly: l.poly, edge: l.i, it: l.it })),
        0.2,
      );
      const u = pc.union(polys[0], ...polys.slice(1), ...wc.add.map((r) => [r] as pcNs.Polygon));
      mp = pc.difference(u, foot, ...wc.cut.map((r) => [r] as pcNs.Polygon));
    } catch {
      continue;
    }
    for (const poly of mp) {
      const outer = openRing(poly[0]);
      if (outer.length < 3 || Math.abs(area2(outer)) < 0.2) continue;
      const holes = poly.slice(1).map(openRing);
      const own =
        list.find((l) => {
          const c = centroid(l.poly);
          return inside(outer, c[0], c[1]);
        }) ?? list[0];
      const it = own.it;
      const H = it.capH != null && it.capH > 0.05 ? it.capH : Math.max(0.35, blk.roof.fasciaH ?? 0.45);
      const topK = it.capC ? colorOf(it.capC, K('mkCapTop')) : K('mkCapTop');
      const sideK = it.capC ? colorOf(it.capC, K('mkFascia')) : K('mkFascia');
      void holes;
      if (it.capSlope) {
        // Eğik şapka: alt yüz düz, üst yüz çatı eğimini izler (dir yönünde alçalır)
        const e = E[own.i];
        const tanS = Math.tan(((it.capSlope.pitch ?? blk.roof.pitch ?? 26) * Math.PI) / 180);
        const fOf = (p: V2) => {
          const u = (p[0] - e.a[0]) * e.t[0] + (p[1] - e.a[1]) * e.t[1];
          const dn = (p[0] - e.a[0]) * e.n[0] + (p[1] - e.a[1]) * e.n[1];
          return it.capSlope!.dir === 'u0' ? u : it.capSlope!.dir === 'u1' ? -u : -dn;
        };
        const fmin = Math.min(...outer.map(fOf));
        const topY = (p: V2) => y + H - 0.12 + (fOf(p) - fmin) * tanS;
        const tris = THREE.ShapeUtils.triangulateShape(
          outer.map((p) => new THREE.Vector2(p[0], p[1])),
          [],
        );
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(
            outer.flatMap((p) => [p[0], topY(p), p[1]]),
            3,
          ),
        );
        g.setAttribute(
          'uv',
          new THREE.Float32BufferAttribute(
            outer.flatMap((p) => [p[0] * 0.5, -p[1] * 0.5]),
            2,
          ),
        );
        g.setIndex(tris.flatMap((t) => [t[0], t[2], t[1]]));
        g.computeVertexNormals();
        if (g.attributes.normal.getY(0) < 0) {
          const ix = tris.flatMap((t) => [t[0], t[1], t[2]]);
          g.setIndex(ix);
          g.computeVertexNormals();
        }
        b.geometry(topK, g);
        b.polygon(K('mkSoffit'), outer, y - 0.12, false, 0.5);
        // Tüm kenarlarda alın (duvar tarafı da: eğik şapka duvar üstüne yükselebilir)
        for (let j = 0; j < outer.length; j++) {
          const [pp, qq] = outwardOrder(outer, outer[j], outer[(j + 1) % outer.length]);
          const L = Math.hypot(qq[0] - pp[0], qq[1] - pp[1]);
          if (L < 0.02) continue;
          b.quad(sideK, xz(pp, y - 0.12), xz(qq, y - 0.12), xz(qq, topY(qq)), xz(pp, topY(pp)), [0, 0, L, H]);
          if (it.capTrim && it.capTrim.h > 0.005) {
            // Üst kenarda ince koyu metal damlalık (eğimi izler)
            const tk = ck('frame', it.capTrim.color ?? '#3a3d40', 'darkMetal');
            const [tp, tq] = insetSeg(pp, qq, -0.012);
            const th = it.capTrim.h;
            b.quad(
              tk,
              xz(tp, topY(pp) - th),
              xz(tq, topY(qq) - th),
              xz(tq, topY(qq) + 0.005),
              xz(tp, topY(pp) + 0.005),
            );
          }
        }
      } else {
        b.polygon(topK, outer, y + H - 0.12, true, 0.5);
        b.polygon(K('mkSoffit'), outer, y - 0.12, false, 0.5);
        let run = 0;
        for (const [p, q] of boundarySegs(outer, ring)) {
          const [pp, qq] = outwardOrder(outer, p, q);
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          b.wall(sideK, pp, qq, y - 0.12, y + H - 0.12, [0, y - 0.12, L, y + H]);
          if (it.capTrim && it.capTrim.h > 0.005) {
            const tk = ck('frame', it.capTrim.color ?? '#3a3d40', 'darkMetal');
            const [tp, tq] = insetSeg(pp, qq, -0.012);
            b.wall(tk, tp, tq, y + H - 0.12 - it.capTrim.h, y + H - 0.115);
          }
          // Şapka üstü teras korkuluğu (ölçülmüşse): dış kenarlarda
          if (it.capRail && it.capRail !== 'none') {
            curPoly = outer;
            parapet(b, p, q, y + H - 0.12, run, {
              type: it.capRail,
              fKey: sideK,
              mKey: ck('metal', it.capRailC ?? null, 'mkRail'),
              parH: 0.04,
              net: false,
              railH: it.capRailH ?? undefined,
              flush: true,
            });
          }
          run += L;
        }
      }
      if (it.spots?.cap) for (const l of list) if (l.it.spots) balSpots(l.it, l.i, y - 0.126, 0.2);
      // v7: şapka altında kare ızgara tavan (pergola ızgarası): iki yönde çubuklar, şapka çokgenine kırpılmış
      const cgd = it.capGrid;
      if (cgd && cgd.every > 0.1) {
        const gk = ck('metal', cgd.color ?? null, sideK);
        const gw = Math.max(0.01, cgd.w ?? 0.04);
        const gd = Math.max(0.01, cgd.depth ?? 0.06);
        const e = E[own.i];
        for (const dir of [e.t, e.n] as V2[]) {
          const nrm: V2 = [-dir[1], dir[0]];
          let lo = Infinity;
          let hi = -Infinity;
          for (const p of outer) {
            const s = p[0] * nrm[0] + p[1] * nrm[1];
            lo = Math.min(lo, s);
            hi = Math.max(hi, s);
          }
          for (let s = Math.ceil(lo / cgd.every) * cgd.every; s <= hi; s += cgd.every) {
            const o0: V2 = [nrm[0] * s, nrm[1] * s];
            for (const [ta, tb] of clipLine(o0, dir, outer)) {
              if (tb - ta < 0.05) continue;
              const m: V2 = [o0[0] + (dir[0] * (ta + tb)) / 2, o0[1] + (dir[1] * (ta + tb)) / 2];
              b.box(gk, [m[0], y - 0.12 - gd / 2, m[1]], [tb - ta, gd, gw], Math.atan2(-dir[1], dir[0]));
            }
          }
        }
      }
    }
  }

  // ── Çatı arası pencereleri (k = S): üçgen alınlık / kemerli parapet ön yüzünde ya da çatı alınlığında ──
  const frontOps = new Map<CItem, Opening[]>();
  for (let i = 0; i < N; i++)
    for (const op of attic[i]) {
      const fr = items(i).find(
        (q) =>
          (q.t === 'pediment' && inPediment(q, base, wallTop, op)) ||
          (q.t === 'arch' && inArch(q, base, wallTop, op)),
      );
      if (fr) {
        frontOps.set(fr, [...(frontOps.get(fr) ?? []), op]);
        continue;
      }
      if (!isGableEdge(i)) continue;
      const g0 = gableAt(i, op.u0);
      const g1 = gableAt(i, op.u1);
      if (g0 == null || g1 == null || op.y1 > Math.min(g0, g1) - 0.05) continue;
      // Alınlık duvarında boşluk + pencere (alınlık cephe düzleminde, taşmasız); v7: yuvarlak pencere yuvarlak delik
      gableHoles.push({
        edge: i,
        a: P(i, op.u0),
        e: P(i, op.u1),
        y0: op.y0,
        y1: op.y1,
        ...(op.win.shape === 'round' ? { round: true } : {}),
      });
      addWindow(b, P, E[i], i, op, o.seed);
    }
  // v7: duvar üstünü aşan girinti ağızları çatı alınlığında delik (çatı arası teras locası)
  for (let i = 0; i < N; i++)
    if (isGableEdge(i))
      for (const [u0, y0, u1, y1] of recAbove(i, wallTop))
        gableHoles.push({ edge: i, a: P(i, u0), e: P(i, u1), y0, y1 });

  // ── Borular, ekipman ──
  for (let i = 0; i < N; i++)
    for (const it of items(i)) {
      if (it.t === 'pipe') {
        // Ölçülmüş renk / kalınlık / kot aralığı (ör. ince açık gri PVC boru, yalnız K0 boyunca)
        const r = Math.max(0.015, Math.min(0.12, it.r ?? 0.05));
        const pk = ck('frame', it.color, 'mkPipe');
        const off0 = Math.max(r + 0.02, it.off);
        const ya = it.y0 != null ? base + it.y0 : base - 0.1;
        const yb = it.y1 != null ? base + it.y1 : wallTop + 0.35;
        // Girintiden geçen boru: girinti kotlarında arka duvara çekilir (dirsekli)
        const rc = recs.find(
          (q) => q.i === i && it.u > q.u0 + r && it.u < q.u1 - r && q.Y1 > ya && q.Y0 < yb,
        );
        const segs: [number, number, number][] = rc
          ? [
              [ya, Math.max(ya, rc.Y0), 0],
              [Math.max(ya, rc.Y0), Math.min(yb, rc.Y1), rc.depth],
              [Math.min(yb, rc.Y1), yb, 0],
            ]
          : [[ya, yb, 0]];
        for (const [sa, sb, dep] of segs) {
          if (sb - sa < 0.01) continue;
          const p = P(i, it.u, off0 - dep);
          b.cylinder(pk, [p[0], sa, p[1]], r, sb - sa, r < 0.035 ? 6 : 8);
          if (it.brackets !== false)
            for (let k = 0; k <= S; k++) {
              const yk = floorY(k) + 1.4;
              if (yk > sa && yk < sb) b.box(pk, [p[0], yk, p[1]], [r * 2.8, 0.05, r * 2.8], E[i].yaw);
            }
        }
        if (rc)
          for (const yy of [rc.Y0, rc.Y1]) {
            if (yy <= ya || yy >= yb) continue;
            // Dirsek: duvar hattından arka duvara yatay parça
            const pm = P(i, it.u, off0 - rc.depth / 2);
            b.box(pk, [pm[0], yy, pm[1]], [r * 2, r * 2, rc.depth], E[i].yaw);
          }
        // v7: balkon gider boruları — her katta döşemenin altından düşey boruya yatay parça + dirsek küresi
        const st = it.stubs;
        if (st && st.len > 0.05)
          for (let k = Math.max(0, st.s[0]); k <= Math.min(S, st.s[1]); k++) {
            const yk = floorY(k) + (st.y ?? -0.3);
            if (yk < ya || yk > yb) continue;
            const sd = (st.side ?? -1) < 0 ? -1 : 1;
            const rs = Math.max(0.015, r * 0.8);
            const pm = P(i, it.u + (sd * st.len) / 2, off0);
            const g = new THREE.CylinderGeometry(rs, rs, st.len, 8);
            g.rotateZ(Math.PI / 2);
            g.rotateY(E[i].yaw);
            g.translate(pm[0], yk, pm[1]);
            b.geometry(pk, g);
            const pe = P(i, it.u, off0);
            b.sphere(pk, [pe[0], yk, pe[1]], rs * 1.25, 8);
          }
      } else if (it.t === 'pilaster') {
        // Kabartma pilastır: pencere sütunları yanında düşey çıkıntılı bant (+ başlık / kaide)
        const Y0 = it.storeys ? floorY(Math.max(0, it.storeys[0])) : base + (it.y0 ?? 0);
        const Y1 = it.storeys
          ? it.storeys[1] + 1 >= S
            ? wallTop
            : floorY(it.storeys[1] + 1)
          : base + (it.y1 ?? wallTop - base);
        const d = Math.max(0.01, it.d);
        // Köşeyi saran bant (quoin): kenar ucunda d kadar uzar, komşu kenardaki bantla köşede birleşir
        const ua = it.corner === 'start' || it.corner === 'both' ? it.u0 - d - 0.005 : it.u0;
        const ub = it.corner === 'end' || it.corner === 'both' ? it.u1 + d + 0.005 : it.u1;
        const w = Math.max(0.03, ub - ua);
        const uc = (ua + ub) / 2;
        if (Y1 - Y0 > 0.05) {
          const key = colorOf(it.color, K('mkPlaster2'));
          const c = P(i, uc, d / 2);
          b.box(key, [c[0], (Y0 + Y1) / 2, c[1]], [w, Y1 - Y0, d + 0.01], E[i].yaw, 1);
          // Yatay derzler (köşe taşı): ön yüzde ince koyu şeritler
          const jt = it.joints;
          if (jt && jt.every > 0.08) {
            const jk = ckm('groove', jt.color ?? null, 'mkGroove');
            const jw = Math.max(0.008, jt.w ?? 0.02);
            const fa = P(i, ua, d + 0.011);
            const fe = P(i, ub, d + 0.011);
            for (let yy = Y0 + jt.every; yy < Y1 - jw; yy += jt.every)
              b.wall(jk, fa, fe, yy - jw / 2, yy + jw / 2);
          }
          for (const [sp, top] of [
            [it.cap, true],
            [it.base, false],
          ] as const) {
            if (!sp || !(sp.h > 0.01)) continue;
            const cd = sp.d ?? 0.03;
            const q = P(i, uc, (d + cd) / 2);
            b.box(
              colorOf(sp.color, key),
              [q[0], top ? Y1 - sp.h / 2 : Y0 + sp.h / 2, q[1]],
              [w + 2 * cd, sp.h, d + cd + 0.01],
              E[i].yaw,
            );
          }
        }
      } else if (it.t === 'pediment') {
        const ops = frontOps.get(it) ?? [];
        const off = pediment(
          b,
          P,
          E[i],
          i,
          it,
          base,
          wallTop,
          colorOf(it.color, K('mkPlaster2')),
          (c) => (c === 'tile' ? K('mkTile') : colorOf(c, colorOf(it.color, K('mkPlaster2')))),
          ops,
          recAbove(i, wallTop),
        );
        // Çatı arası pencereleri alınlık ön yüzünde (söve derinliği alınlığın içine)
        const Pp: PFn = (ii, u, oo = 0) => P(ii, u, oo + off);
        for (const op of ops) addWindow(b, Pp, E[i], i, op, o.seed);
      } else if (it.t === 'arch') {
        const ops = frontOps.get(it) ?? [];
        const key = colorOf(it.color, K('mkPlaster2'));
        const off = archFront(
          b,
          P,
          E[i],
          i,
          it,
          base,
          wallTop,
          key,
          it.roofC === 'tile' ? K('mkTile') : colorOf(it.roofC, key),
          it.coping ? colorOf(it.coping.color, key, 'frame') : key,
          ops,
          // v7: tonoza kadar açık girinti (ağzı kemer ön yüzünü keser) ve kemer yüzüne oyulmuş teras locaları
          recAbove(i, wallTop),
        );
        const Pa: PFn = (ii, u, oo = 0) => P(ii, u, oo + off);
        for (const op of ops) addWindow(b, Pa, E[i], i, op, o.seed);
      } else if (it.t === 'dormer') {
        dormer(b, P, E[i], i, it, {
          roofH: roofH(),
          wallTop,
          eave: roofOpts.eaveOf ? roofOpts.eaveOf(i) : eave,
          wallK: colorOf(it.color, K('mkPlaster')),
          roofK: !it.roofC || it.roofC === 'tile' ? K('mkTile') : colorOf(it.roofC, K('mkTile')),
          trimK: it.trim ? colorOf(it.trim.color ?? null, fasciaK) : fasciaK,
          seed: o.seed,
        });
      } else if (it.t === 'cloth') {
        // Güneşlik bezi: ön düzlemde üst kenar, alt kenar duvara doğru `back` kadar eğik (iki yüz)
        const key = ck('awning', it.color, K('mkFascia'));
        const u0 = Math.max(0, it.u0);
        const u1 = Math.min(E[i].len, it.u1);
        if (u1 - u0 > 0.05 && it.y1 - it.y0 > 0.05) {
          const top0 = P(i, u0, it.d);
          const top1 = P(i, u1, it.d);
          const bo = Math.max(0.02, it.d - Math.max(0, it.back));
          const bot0 = P(i, u0, bo);
          const bot1 = P(i, u1, bo);
          const Yt = base + it.y1;
          const Yb = base + it.y0;
          b.quad(key, xz(bot0, Yb), xz(bot1, Yb), xz(top1, Yt), xz(top0, Yt), [0, 0, u1 - u0, it.y1 - it.y0]);
          b.quad(key, xz(bot1, Yb), xz(bot0, Yb), xz(top0, Yt), xz(top1, Yt), [0, 0, u1 - u0, it.y1 - it.y0]);
        }
      } else if (it.t === 'banner') {
        // Korkuluğa asılı bayrak / portreli pankart (dikey), korkuluğun hemen önünde
        const u0 = it.u0;
        const u1 = it.u1;
        if (u1 - u0 > 0.05 && it.y1 - it.y0 > 0.05) {
          const fk = o.signFace
            ? o.signFace({
                text: it.text ?? '',
                bg: it.bg ?? '#d21f26',
                fg: it.fg ?? '#d21f26',
                border: null,
                font: 'sans',
                bold: true,
                lit: false,
                style: 'panel',
                w: u1 - u0,
                h: it.y1 - it.y0,
                banner: it.style,
                ...(it.lines?.length ? { lines: it.lines } : {}),
                ...(it.blocks?.length ? { blocks: it.blocks } : {}),
                ...(it.mesh ? { mesh: true } : {}),
              })
            : 'mkFlag';
          const off = Math.max(0.02, it.d + 0.03);
          const a0 = P(i, u0, off);
          const a1 = P(i, u1, off);
          b.wall(fk, a0, a1, base + it.y0, base + it.y1, [0, 0, 1, 1]);
          b.wall(fk, a1, a0, base + it.y0, base + it.y1, [1, 0, 0, 1]);
        }
      } else if (it.t === 'lamp') {
        wallLamp(b, P, E[i], i, it, base, floorY, recDepthAt);
      } else if (it.t === 'roofobj') {
        roofObject(b, P, E[i], i, it, roofH(), {
          wallK: colorOf(it.color, K('mkPlaster')),
          tileK: K('mkTile'),
          capK: (c) => (!c || c === 'tile' ? K('mkTile') : colorOf(c, K('mkTile'))),
          metalK: ck('metal', it.color ?? null, 'mkRail'),
          lampK: (c) => ck('neon', c, 'wallLamp'),
        });
      } else if (it.t === 'ribbon') {
        // Cephe üstünde yol boyunca şerit (boya / hafif kabartma; kavisli düşey şerit gibi)
        const key = colorOf(it.color, K('mkPlaster'));
        const off = Math.max(0.004, it.d) + 0.004;
        for (let k = 0; k + 1 < it.pts.length; k++) {
          const [ua, ya] = it.pts[k];
          const [ue, ye] = it.pts[k + 1];
          const Ls = Math.hypot(ue - ua, ye - ya);
          if (Ls < 1e-3) continue;
          // (u, y) düzleminde parçaya dik yarım genişlik; uçlarda w/2 uzatma (birleşimlerde boşluk kalmasın)
          const nu = (-(ye - ya) / Ls) * (it.w / 2);
          const ny = ((ue - ua) / Ls) * (it.w / 2);
          const eu = ((ue - ua) / Ls) * (it.w / 2);
          const ey = ((ye - ya) / Ls) * (it.w / 2);
          const Q = (u: number, yy: number): V3 => xz(P(i, u, off), base + yy);
          b.quad(
            key,
            Q(ua - eu - nu, ya - ey - ny),
            Q(ue + eu - nu, ye + ey - ny),
            Q(ue + eu + nu, ye + ey + ny),
            Q(ua - eu + nu, ya - ey + ny),
          );
        }
      } else if (it.t === 'mast') {
        // Bayrak direği: ince boru + tepe topu (+ bayrak)
        const p = P(i, it.u, Math.max(0.1, it.off));
        const ya = it.y0 != null ? base + it.y0 : base - 0.1;
        const mk = ck('metal', it.color, 'mkRail');
        b.cylinder(mk, [p[0], ya, p[1]], 0.04, it.h, 8);
        const tp = it.top;
        if (tp && tp.kind === 'disc') {
          // Direk tepesinde duvara bakan yuvarlak levha (çanak / oculus benzeri, koyu) + yatay kol
          const dd = Math.max(0.1, tp.d ?? 1.0);
          const tk = ck('metal', tp.color ?? '#2c2e30', 'darkMetal');
          const yc = ya + it.h;
          const g = new THREE.CylinderGeometry(dd / 2, dd / 2, 0.06, 28);
          g.rotateX(Math.PI / 2);
          g.rotateY(E[i].yaw);
          g.translate(p[0], yc, p[1]);
          b.geometry(tk, g);
          const arm = Math.max(0, tp.arm ?? dd * 1.3);
          if (arm > 0.05) b.box(tk, [p[0], yc, p[1]], [arm, 0.05, 0.05], E[i].yaw);
        } else if (tp && tp.kind === 'dish') {
          const dd = Math.max(0.2, tp.d ?? 0.8);
          const dish = new THREE.SphereGeometry(dd / 2, 14, 4, 0, Math.PI * 2, 0, 0.55);
          dish.scale(1, 0.42, 1);
          dish.rotateX(Math.PI / 2);
          dish.rotateY(E[i].yaw + Math.PI);
          dish.translate(p[0], ya + it.h, p[1]);
          b.geometry(tp.color ? ck('metal', tp.color, 'mkDish') : 'mkDish', dish);
        } else if (tp && tp.kind === 'ball') {
          b.sphere(
            ck('metal', tp.color ?? null, mk),
            [p[0], ya + it.h + (tp.d ?? 0.14) / 2, p[1]],
            (tp.d ?? 0.14) / 2,
            10,
          );
        } else b.sphere(mk, [p[0], ya + it.h + 0.05, p[1]], 0.07, 8);
        if (it.flag) {
          const fk = /^#[0-9a-f]{6}$/i.test(it.flag) ? ck('awning', it.flag, 'mkFlag') : 'mkFlag';
          const f0 = P(i, it.u + 0.05, Math.max(0.1, it.off));
          const f1 = P(i, it.u + 1.55, Math.max(0.1, it.off));
          const yt = ya + it.h - 0.1;
          b.wall(fk, f0, f1, yt - 1.0, yt, [0, 0, 1, 1]);
          b.wall(fk, f1, f0, yt - 1.0, yt, [1, 0, 0, 1]);
        }
      } else if (it.t === 'ac' || it.t === 'dish' || it.t === 'camera' || it.t === 'flag') {
        // Girintinin içine düşen klima / çanak / kamera / bayrak girintinin arka duvarında. v7: gömük locaya
        // (bal inset) düşenler de loca arka duvarında (önceden loca ağzında havada — 1550614218 L2 K4 klima);
        // side: true → girinti / loca YAN duvarına monte (en yakın yan duvar, ön yüzü açıklığa bakar)
        const yU = floorY(it.s) + (it.y ?? 1.6);
        const rec = recAt(i, it.u, yU);
        // Köşe locasında birleştirilen komşu kenardan ölçülen birim yerinde kalır (o kenara göre loca derinliği diğer
        // kenarın boyu olabilir — birim yanlış duvara taşınmasın); yan duvar montajı (side) her iki durumda
        const vd0 = !rec && !it.onBal ? voidAt(i, it.u, it.s) : undefined;
        const vd = vd0 && (vd0.edge === i || it.side) ? vd0 : undefined;
        const span: [number, number, number] | null = rec
          ? [rec.u0, rec.u1, rec.depth]
          : vd
            ? [...voidSpan(vd, i), voidDepth(vd, i)]
            : null;
        if (it.side && span) {
          const [su0, su1, dep] = span;
          const atStart = it.u - su0 <= su1 - it.u;
          const a = P(i, atStart ? su0 : su1, 0);
          const nS: V2 = atStart ? [E[i].t[0], E[i].t[1]] : [-E[i].t[0], -E[i].t[1]];
          let tS: V2 = [E[i].n[0], E[i].n[1]];
          if (-tS[1] * nS[0] + tS[0] * nS[1] < 0) tS = [-tS[0], -tS[1]];
          const Es: Edge = { a, e: a, len: dep, t: tS, n: nS, yaw: Math.atan2(-tS[1], tS[0]), s0: 0 };
          const Ps: PFn = (_ii, uu, off = 0) => [
            a[0] + tS[0] * uu + nS[0] * off,
            a[1] + tS[1] * uu + nS[1] * off,
          ];
          const depth = Math.max(0.2, Math.min(dep - 0.2, it.off ?? 0.45));
          const uu = depth * (tS[0] * -E[i].n[0] + tS[1] * -E[i].n[1] > 0 ? 1 : -1);
          unit(b, Es, Ps, i, { ...it, u: uu, onBal: false, off: null }, floorY(it.s), o.seed);
        } else if (it.onBal && it.t === 'dish' && (rec || voidAt(i, it.u, it.s))) {
          // Gömük (d:0) locanın korkuluğunda asılı çanak: korkuluk loca ağzında, cephe düzleminde → çanak düzlemin
          // hemen önünde (off, varsayılan 0.3 m). Önceden ya çıkma balkon varsayımıyla 1.35 m önde havada ya da (onBal
          // işaretsiz) loca arka duvarına taşınıyordu (Mertkent-2 anket ajanı, 2026-09-30)
          unit(b, E[i], P, i, { ...it, off: it.off ?? 0.3 }, floorY(it.s), o.seed);
        } else {
          const rdU = rec ? rec.depth : vd ? voidDepth(vd, i) : 0;
          const Pu: PFn = rdU > 0 ? (ii, u, off = 0) => P(ii, u, off - rdU) : P;
          unit(b, E[i], Pu, i, it, floorY(it.s), o.seed);
        }
      } else if (it.t === 'entrance') {
        // Girintinin içindeki giriş kapısı (kapı dokusu, basamaklar, saçak) girinti arka duvarında
        const rdE = recDepthAt(i, (it.u0 + it.u1) / 2, floorY(0) + 1.2);
        const Pe: PFn = rdE > 0 ? (ii, u, off = 0) => P(ii, u, off - rdE) : P;
        // v7: ölçülen eşik kotu (y) ya da subasmansız blokta (plinthH 0) zemin kotu — sanal groundRaise'de kapı havada
        // kalmasın (MOSSA)
        const yE =
          it.y != null
            ? base + it.y
            : blk.plinthH != null && blk.plinthH <= 0.02 && it.steps == null
              ? base + 0.02
              : floorY(0);
        entrance(b, Pe, E[i], i, it, base, yE, o.signKey);
      } else if (it.t === 'proj') {
        // Dışarı taşan kütle (merdiven kulesi, çıkma, kolon). v7: girintinin içindeki (ör. yuva arka duvarındaki
        // beyaz dikme) girinti arka duvarından çıkar; d1 → u1 ucunda farklı derinlik (eğik saçak kutusu)
        const named: Record<string, string> = {
          plaster: K('mkPlaster'),
          plaster2: K('mkPlaster2'),
          strip: K('mkStrip'),
          fascia: K('mkFascia'),
          plinth: K('mkPlinth'),
        };
        const rIn = recInside(i, it.u0, it.u1, base + it.y0, base + it.y1);
        const Pj: PFn = rIn ? (ii, u, off = 0) => P(ii, u, off - rIn.depth) : P;
        const key = cladKey(
          it.clad,
          it.color,
          named[it.color] ?? ck('plaster', it.color, K('mkPlaster')),
          it.finish,
        );
        const w = Math.max(0.05, it.u1 - it.u0);
        const bk = Math.max(0, it.back ?? 0);
        const c = Pj(i, (it.u0 + it.u1) / 2, (it.d - bk) / 2);
        const topK = it.topC ? colorOf(it.topC, key) : null;
        const d1 = it.d1 != null && Math.abs(it.d1 - it.d) > 0.01 ? Math.max(0, it.d1) : null;
        const pa = it.arch && d1 == null ? it.arch : null;
        if (pa) {
          // v9: kemer açıklıklı çıkma (ör. 1546358573 ARMILLA önündeki kavisli duvar): ön yüz kemer delikli, kemer
          // içi (intrados) ölçülen renkte, yan / üst / alt yüzler; arkası duvar
          const Y0 = base + it.y0;
          const Y1 = base + it.y1;
          const ring0 = archRing(
            Math.max(it.u0 + 0.02, pa.u0),
            Math.min(it.u1 - 0.02, pa.u1),
            Math.max(Y0, base + (pa.y0 ?? it.y0)),
            Math.min(Y1 - 0.03, base + pa.top),
            pa.spring != null ? base + pa.spring : null,
            pa.apex ?? null,
          );
          const dF = it.d + 0.01;
          cutFace(b, key, Pj, i, dF, rectRing([it.u0, Y0, it.u1, Y1]), [ring0], E[i].n, false, E[i].s0);
          const V = (u: number, y: number, off: number): V3 => xz(Pj(i, u, off), y);
          b.wall(key, Pj(i, it.u0, -bk), Pj(i, it.u0, dF), Y0, Y1, [0, Y0, dF + bk, Y1]);
          b.wall(key, Pj(i, it.u1, dF), Pj(i, it.u1, -bk), Y0, Y1, [0, Y0, dF + bk, Y1]);
          b.quad(topK ?? key, V(it.u0, Y1, -bk), V(it.u1, Y1, -bk), V(it.u1, Y1, dF), V(it.u0, Y1, dF));
          b.quad(key, V(it.u0, Y0, dF), V(it.u1, Y0, dF), V(it.u1, Y0, -bk), V(it.u0, Y0, -bk));
          // Kemer içi: halkanın taban kenarı hariç her parça önden duvara
          const rK = colorOf(pa.revealC ?? null, key);
          for (let q = 1; q < ring0.length; q++) {
            const [ua, ya] = ring0[q];
            const [ub, yb] = ring0[(q + 1) % ring0.length];
            b.quad(rK, V(ub, yb, dF), V(ua, ya, dF), V(ua, ya, 0.01), V(ub, yb, 0.01));
            b.quad(rK, V(ua, ya, dF), V(ub, yb, dF), V(ub, yb, 0.01), V(ua, ya, 0.01));
          }
        } else if (d1 != null) {
          // Eğik (trapez planlı) çıkma: d (u0 ucu) → d1 (u1 ucu)
          const pl: V2[] = [
            Pj(i, it.u0, -bk - 0.01),
            Pj(i, it.u1, -bk - 0.01),
            Pj(i, it.u1, d1 + 0.01),
            Pj(i, it.u0, it.d + 0.01),
          ];
          prism(b, key, topK ?? key, pl, base + it.y0, base + it.y1);
        } else {
          // Üst yüz ayrı renkteyse (ör. paslı saç kapak) kutunun üstü o renkte
          b.box(
            key,
            [c[0], base + (it.y0 + it.y1) / 2, c[1]],
            [w, it.y1 - it.y0, it.d + bk + 0.02],
            E[i].yaw,
            1,
            topK ? 0b101111 : 0b111111,
          );
          if (topK)
            b.box(
              topK,
              [c[0], base + it.y1 - 0.005, c[1]],
              [w, 0.01, it.d + bk + 0.02],
              E[i].yaw,
              1,
              0b010000,
            );
        }
        // v7: düzensiz düşey kaplama derzleri (ön yüzde)
        cladJoints(it.clad, Pj, i, it.d + 0.01, it.u0, it.u1, base + it.y0, base + it.y1);
        if (it.cap && it.cap.h > 0.01) {
          const ov = it.cap.over ?? 0.04;
          b.box(
            colorOf(it.cap.color ?? null, topK ?? key),
            [c[0], base + it.y1 + it.cap.h / 2, c[1]],
            [w + 2 * ov, it.cap.h, it.d + bk + 0.02 + 2 * ov],
            E[i].yaw,
          );
        }
        if (it.y0 < 2.5)
          o.collide?.(
            [Pj(i, it.u0, 0), Pj(i, it.u1, 0), Pj(i, it.u1, d1 ?? it.d), Pj(i, it.u0, it.d)].map((q) => [
              q[0],
              q[1],
            ]),
            base + it.y0 - 0.5,
            base + it.y1,
          );
        if (it.topRail && it.topRail !== 'none') {
          // Teras korkuluğu: çıkmanın dış üç kenarı (duvara dayalı kenar hariç)
          const c0 = Pj(i, it.u0, 0);
          const c1 = Pj(i, it.u0, it.d);
          const c2 = Pj(i, it.u1, d1 ?? it.d);
          const c3 = Pj(i, it.u1, 0);
          curPoly = [c0, c1, c2, c3];
          const spec: RailSpec = {
            type: it.topRail,
            fKey: key,
            mKey: ck('metal', it.topRailC ?? null, 'mkRail'),
            parH: it.topParH ?? PARAPET,
            net: false,
            railH: it.topRailH ?? undefined,
            // v7: terasın cam korkuluk rengi (ör. Salus Juliet camları #72818b)
            ...(it.topGlassC ? { gKey: ck('glass', it.topGlassC, K('mkRailGlass')) } : {}),
          };
          let run = 0;
          for (const [pa, pb] of [
            [c0, c1],
            [c1, c2],
            [c2, c3],
          ] as [V2, V2][]) {
            parapet(b, pa, pb, base + it.y1, run, spec);
            run += Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
          }
        }
        for (const wn of it.wins) {
          const W = wn.u1 - wn.u0;
          const Hh = wn.y1 - wn.y0;
          if (W < 0.1 || Hh < 0.1) continue;
          const y0 = base + wn.y0;
          const y1 = base + wn.y1;
          const off = it.d + 0.012;
          const kind = projWinKind(wn);
          const a0 = Pj(i, wn.u0, off);
          const a1 = Pj(i, wn.u1, off);
          b.quad(
            'mkGlass',
            [a0[0], y0, a0[1]],
            [a1[0], y0, a1[1]],
            [a1[0], y1, a1[1]],
            [a0[0], y1, a0[1]],
            [0, 0, 1, 1],
            [hash(o.seed + wn.u0 * 7 + wn.y0) * 100, kind, W, Hh],
          );
          const F = 0.06;
          const FKp = wn.frameC ? ckm('frame', wn.frameC, K('mkFrame')) : K('mkFrame');
          const fr = (u: number, yy: number, sw: number, sh: number) => {
            const q = Pj(i, u, off + 0.015);
            b.box(FKp, [q[0], yy, q[1]], [sw, sh, 0.03], E[i].yaw);
          };
          fr((wn.u0 + wn.u1) / 2, y1 - F / 2, W, F);
          fr((wn.u0 + wn.u1) / 2, y0 + F / 2, W, F);
          fr(wn.u0 + F / 2, (y0 + y1) / 2, F, Hh);
          fr(wn.u1 - F / 2, (y0 + y1) / 2, F, Hh);
          if (wn.split != null && wn.split > 1)
            for (let sI = 1; sI < Math.min(12, wn.split); sI++)
              fr(wn.u0 + (W * sI) / wn.split, (y0 + y1) / 2, 0.05, Hh);
          else if (wn.kind !== 'glassband' && W > 0.9) fr((wn.u0 + wn.u1) / 2, (y0 + y1) / 2, 0.05, Hh);
          if (wn.rail) {
            // Fransız korkuluk: yatay paslanmaz borular + uç dikmeler, pencere önünde
            const c = Pj(i, (wn.u0 + wn.u1) / 2, off + 0.05);
            for (const hh of [0.3, 0.55, 0.8, 0.95])
              if (y0 + hh < y1) b.box('mkRail', [c[0], y0 + hh, c[1]], [W + 0.04, 0.025, 0.025], E[i].yaw);
            for (const uu of [wn.u0 + 0.03, wn.u1 - 0.03]) {
              const pp = Pj(i, uu, off + 0.05);
              b.box('mkRail', [pp[0], y0 + 0.5, pp[1]], [0.03, 1.0, 0.03], E[i].yaw);
            }
          }
        }
      } else if (it.t === 'sign') {
        // Dükkân / apartman tabelası (kutu veya tek harf), yüz dokusu ölçülen yazı/renklerden
        const w = Math.max(0.05, it.u1 - it.u0);
        const h = Math.max(0.05, it.y1 - it.y0);
        const letters = it.style === 'letters';
        const d = Math.max(0.01, it.d);
        // Tabela altındaki bant/panel/çıkıntıya asılı: onların ön yüzünden başlar (yoksa arkada kalıyordu)
        let mount = 0;
        for (const q of items(i)) {
          if (q === it || (q.t !== 'band' && q.t !== 'panel' && q.t !== 'proj')) continue;
          const qd = q.t === 'proj' ? q.d : q.proud;
          if (qd <= mount) continue;
          const ov = Math.min(it.u1, q.u1) - Math.max(it.u0, q.u0);
          const oy = Math.min(it.y1, q.y1) - Math.max(it.y0, q.y0);
          if (ov > 0.05 && oy > 0.3 * h) mount = qd;
        }
        // Girinti içindeki tabela arka duvarda
        const rd = recDepthAt(i, (it.u0 + it.u1) / 2, base + (it.y0 + it.y1) / 2);
        if (rd > 0) mount -= rd;
        // v7: ölçülen montaj uzaklığı (ör. balkon alnına monte harf: off = balkon d)
        if (it.off != null) mount = it.off;
        // v7: kanal harflerin arkasında taşıyıcı pano (renk, kalınlık, harflerden taşma)
        const bp = it.back;
        if (bp && bp.color) {
          const pd = Math.max(0.01, bp.d ?? 0.04);
          const pad = Math.max(0, bp.pad ?? 0.05);
          const c = P(i, (it.u0 + it.u1) / 2, mount + pd / 2 + 0.005);
          b.box(
            ck('fascia', bp.color, 'mkRail'),
            [c[0], base + (it.y0 + it.y1) / 2, c[1]],
            [w + 2 * pad, h + 2 * pad, pd],
            E[i].yaw,
          );
          mount += pd + 0.005;
        }
        // v7: arkadan aydınlatmalı harflerin duvardaki ışık halesi (gece parlar): harflerin arkasında, taşmalı
        if (it.halo && o.signFace && /^#[0-9a-f]{6}$/i.test(it.halo)) {
          const hp = Math.min(0.4, 0.18 * h);
          const hk = o.signFace({ ...it, w: w + 2 * hp, h: h + 2 * hp, haloPad: hp, halo: it.halo });
          b.wall(
            hk,
            P(i, it.u0 - hp, mount + 0.004),
            P(i, it.u1 + hp, mount + 0.004),
            base + it.y0 - hp,
            base + it.y1 + hp,
            [0, 0, 1, 1],
          );
        }
        if (it.shape === 'round' || it.shape === 'oval') {
          // Yuvarlak rozet / oval (elips) tabela: duvara dik disk (kenar rengi), yüz dokusu köşeleri saydam
          const c = P(i, (it.u0 + it.u1) / 2, mount + d / 2 + 0.01);
          const r = Math.min(w, h) / 2;
          const g = new THREE.CylinderGeometry(r, r, d, it.shape === 'oval' ? 40 : 32);
          if (it.shape === 'oval') g.scale(w / (2 * r), 1, h / (2 * r));
          g.rotateX(Math.PI / 2);
          g.rotateY(E[i].yaw);
          g.translate(c[0], base + (it.y0 + it.y1) / 2, c[1]);
          b.geometry(ck('fascia', it.border ?? it.bg, 'mkRail'), g);
        } else if (it.shape === 'pill' && !letters) {
          // v11: hap (stadyum) kutu: uç yarıçapı yükseklik / 2, kalınlık d (yan yüz kenar / zemin rengi)
          const c = P(i, (it.u0 + it.u1) / 2, mount + d / 2 + 0.01);
          b.geometry(
            ck('fascia', it.border ?? it.bg, 'mkRail'),
            pillGeometry(w, h, d, E[i].yaw, c, base + (it.y0 + it.y1) / 2),
          );
        } else if (!letters) {
          const c = P(i, (it.u0 + it.u1) / 2, mount + d / 2 + 0.01);
          const side = ck('fascia', it.border ?? it.bg, 'mkRail');
          b.box(side, [c[0], base + (it.y0 + it.y1) / 2, c[1]], [w, h, d], E[i].yaw);
        }
        if (o.signFace) {
          const key = o.signFace({ ...it, w, h });
          b.wall(
            key,
            P(i, it.u0, mount + d + 0.012),
            P(i, it.u1, mount + d + 0.012),
            base + it.y0,
            base + it.y1,
            [0, 0, 1, 1],
          );
          // Kalın (3B) harfler: harf dokusu kalınlık boyunca katmanlanır, arka katmanlar koyu (yan yüz görünümü);
          // alfa testli olduğundan harf dışı saydam — eğik bakışta harflerin kalınlığı görünür
          if (letters && d >= 0.015) {
            const sk = o.signFace({ ...it, w, h, side: true });
            const nl = Math.max(2, Math.min(10, Math.round(d / 0.006)));
            for (let l = 0; l < nl; l++) {
              const off = mount + 0.012 + (d * l) / nl;
              b.wall(sk, P(i, it.u0, off), P(i, it.u1, off), base + it.y0, base + it.y1, [0, 0, 1, 1]);
            }
          }
        }
      } else if (it.t === 'groove') {
        // Sıva derzi / kanal: koyu ince şerit (gölge hissi). v7: uzakta sönümlenen malzeme (kesikli çizgi olmasın);
        // girinti içindeki derz arka duvarda
        const gk = ckm('groove', it.color ?? null, 'mkGroove');
        const gIn =
          it.dir === 'v' && it.u != null && it.y0 != null && it.y1 != null
            ? recInside(i, it.u - 0.01, it.u + 0.01, base + it.y0, base + it.y1)
            : it.u0 != null && it.u1 != null && it.y != null
              ? recInside(i, it.u0, it.u1, base + it.y - 0.01, base + it.y + 0.01)
              : undefined;
        if (gIn) {
          // Girinti arka duvarında (ağız dışına taşmaz)
          const Pg: PFn = (ii, u, off = 0) => P(ii, u, off - gIn.depth);
          if (it.dir === 'v' && it.u != null && it.y0 != null && it.y1 != null) {
            const ya = Math.max(gIn.Y0, base + it.y0);
            const yb = Math.min(gIn.Y1, base + it.y1);
            if (yb - ya > 1e-3)
              b.wall(gk, Pg(i, it.u - it.w / 2, 0.004), Pg(i, it.u + it.w / 2, 0.004), ya, yb);
          } else if (it.u0 != null && it.u1 != null && it.y != null) {
            const yy = base + it.y;
            b.wall(
              gk,
              Pg(i, Math.max(gIn.u0, it.u0), 0.004),
              Pg(i, Math.min(gIn.u1, it.u1), 0.004),
              yy - it.w / 2,
              yy + it.w / 2,
            );
          }
          continue;
        }
        // Saçak alnı / parapet bölgesindeki derzler (duvar üstünün üstü) o yüzeyin önünde çizilir (önceden alın
        // bandının arkasında kalıp görünmüyordu); alınlık kenarında alınlık çizgisine kadar
        const zone = wallTop - 0.05;
        const gab = isGableEdge(i);
        const topLim = (u: number) =>
          gab ? (gableAt(i, u) ?? wallTop) - 0.02 : onPar(i) ? wallTop + (par?.h ?? 0) : wallTop + fH;
        const offAt = (y: number) => (!gab && y > zone + 1e-3 ? 0.03 : 0.004);
        if (it.dir === 'v' && it.u != null && it.y0 != null && it.y1 != null) {
          const ya = base + it.y0;
          const yb = Math.min(base + it.y1, topLim(it.u));
          const parts: [number, number][] =
            !gab && ya < zone && yb > zone
              ? [
                  [ya, zone],
                  [zone, yb],
                ]
              : [[ya, yb]];
          for (const [p0, p1] of parts) {
            if (p1 - p0 < 1e-3) continue;
            const off = offAt((p0 + p1) / 2);
            b.wall(gk, P(i, it.u - it.w / 2, off), P(i, it.u + it.w / 2, off), p0, p1);
          }
        } else if (it.u0 != null && it.u1 != null && it.y != null) {
          const yy = base + it.y;
          if (yy - it.w / 2 < Math.max(topLim(it.u0), topLim(it.u1))) {
            const off = offAt(yy);
            b.wall(gk, P(i, it.u0, off), P(i, it.u1, off), yy - it.w / 2, yy + it.w / 2);
          }
        }
      } else if (it.t === 'vent') {
        // Havalandırma deliği / menfez
        const vk = ckm('plaster', it.color ?? null, 'darkMetal');
        for (let k = 0; k < Math.max(1, it.count); k++) {
          const u = it.u + k * it.spacing;
          const c = P(i, u, 0.006 - recDepthAt(i, u, base + it.y));
          if (it.shape === 'rect') {
            b.box(vk, [c[0], base + it.y, c[1]], [it.s, it.s * 0.6, 0.012], E[i].yaw);
          } else {
            const g = new THREE.CircleGeometry(it.s / 2, 14);
            g.rotateY(E[i].yaw);
            g.translate(c[0], base + it.y, c[1]);
            b.geometry(vk, g);
          }
        }
      } else if (it.t === 'awning') {
        // Tente: duvardan eğik, önde sarkan valans. Girintinin içine düşen tente girinti arka duvarına asılı
        const key = ck('awning', it.color, K('mkFascia'));
        const yT = base + it.y;
        const rdA = recDepthAt(i, (it.u0 + it.u1) / 2, yT - 0.05);
        const Pa: PFn = rdA > 0 ? (ii, u, off = 0) => P(ii, u, off - rdA) : P;
        const yB = yT - Math.max(0.1, it.drop);
        const a0 = Pa(i, it.u0, 0.02);
        const a1 = Pa(i, it.u1, 0.02);
        const f0 = Pa(i, it.u0, it.d);
        const f1 = Pa(i, it.u1, it.d);
        const dutch = it.style === 'dutch';
        // v9: düz / katlanır tentede çizgi bantları (stripeW verilmişse): [u0, u1, malzeme]
        const stripes: [number, number, string][] | null =
          !dutch && it.stripe && (it.stripeW ?? 0) > 0.02
            ? (() => {
                const sk = ck('awning', it.stripe, key);
                const out: [number, number, string][] = [];
                const w = it.stripeW!;
                for (let u = it.u0, k = 0; u < it.u1 - 1e-4; u += w, k++)
                  out.push([u, Math.min(it.u1, u + w), k % 2 ? sk : key]);
                return out;
              })()
            : null;
        // v7: köşeyi saran çeyrek kubbe uç (Hollanda tentesi): o uçta yelpaze kapak yerine profil 90° döndürülür
        const domeAt = (uu: number) =>
          dutch &&
          (it.dome === 'both' ||
            (it.dome === 'start' && uu === it.u0) ||
            (it.dome === 'end' && uu === it.u1));
        if (dutch) {
          // Hollanda tipi: kesit çeyrek elips (duvarda yatay başlar, önde dikey biter); uçlarda yelpaze kapak.
          // Şerit rengi (stripe) varsa kabuk dilimleri iki renk sırayla (fotoğraftaki açık/koyu turkuaz bantlar)
          const NS = 10;
          const prof = (k: number) => {
            const th = (k / NS) * (Math.PI / 2);
            return { off: 0.02 + (it.d - 0.02) * Math.sin(th), y: yB + (yT - yB) * Math.cos(th) };
          };
          const sk = it.stripe ? ck('awning', it.stripe, key) : key;
          for (let k = 0; k < NS; k++) {
            const A = prof(k);
            const B = prof(k + 1);
            const kk = k % 2 && it.stripe ? sk : key;
            const p0 = Pa(i, it.u0, A.off);
            const p1 = Pa(i, it.u1, A.off);
            const q0 = Pa(i, it.u0, B.off);
            const q1 = Pa(i, it.u1, B.off);
            b.quad(kk, [p0[0], A.y, p0[1]], [p1[0], A.y, p1[1]], [q1[0], B.y, q1[1]], [q0[0], B.y, q0[1]]);
            b.quad(kk, [q0[0], B.y, q0[1]], [q1[0], B.y, q1[1]], [p1[0], A.y, p1[1]], [p0[0], A.y, p0[1]]);
            // Yelpaze uç kapakları (merkez: duvar dibi, yB)
            for (const uu of [it.u0, it.u1]) {
              if (domeAt(uu)) {
                // Çeyrek kubbe: profil noktaları uç noktası (duvarda) etrafında n → ±t yönüne döner
                const sg = uu === it.u1 ? 1 : -1;
                const C = Pa(i, uu, 0);
                const NP = 8;
                for (let m = 0; m < NP; m++) {
                  const f0 = (m / NP) * (Math.PI / 2);
                  const f1 = ((m + 1) / NP) * (Math.PI / 2);
                  const dir = (f: number): V2 => [
                    E[i].n[0] * Math.cos(f) + E[i].t[0] * Math.sin(f) * sg,
                    E[i].n[1] * Math.cos(f) + E[i].t[1] * Math.sin(f) * sg,
                  ];
                  const d0 = dir(f0);
                  const d1 = dir(f1);
                  const W3 = (dd: V2, r: number, y: number): V3 => [C[0] + dd[0] * r, y, C[1] + dd[1] * r];
                  const qa = W3(d0, A.off, A.y);
                  const qb = W3(d1, A.off, A.y);
                  const qc = W3(d1, B.off, B.y);
                  const qd = W3(d0, B.off, B.y);
                  b.quad(kk, qa, qb, qc, qd);
                  b.quad(kk, qd, qc, qb, qa);
                }
                continue;
              }
              const c = Pa(i, uu, 0.02);
              const pa = Pa(i, uu, A.off);
              const pb = Pa(i, uu, B.off);
              b.quad(kk, [c[0], yB, c[1]], [pa[0], A.y, pa[1]], [pb[0], B.y, pb[1]], [pb[0], B.y, pb[1]]);
              b.quad(kk, [c[0], yB, c[1]], [pb[0], B.y, pb[1]], [pa[0], A.y, pa[1]], [pa[0], A.y, pa[1]]);
            }
          }
        } else if (!stripes) {
          b.quad(key, [a0[0], yT, a0[1]], [a1[0], yT, a1[1]], [f1[0], yB, f1[1]], [f0[0], yB, f0[1]]);
          b.quad(key, [f0[0], yB, f0[1]], [f1[0], yB, f1[1]], [a1[0], yT, a1[1]], [a0[0], yT, a0[1]]);
        } else
          // v9: düz / katlanır tentede duvara DİK çizgiler (eğim boyunca), u0'dan ana renkle başlayarak sırayla
          for (const [ua, ub, kk] of stripes) {
            const s0 = Pa(i, ua, 0.02);
            const s1 = Pa(i, ub, 0.02);
            const t0 = Pa(i, ua, it.d);
            const t1 = Pa(i, ub, it.d);
            b.quad(kk, [s0[0], yT, s0[1]], [s1[0], yT, s1[1]], [t1[0], yB, t1[1]], [t0[0], yB, t0[1]]);
            b.quad(kk, [t0[0], yB, t0[1]], [t1[0], yB, t1[1]], [s1[0], yT, s1[1]], [s0[0], yT, s0[1]]);
          }
        const vh = dutch ? 0 : 0.22;
        if (vh > 0 && stripes)
          // Valans da aynı çizgili
          for (const [ua, ub, kk] of stripes) {
            const t0 = Pa(i, ua, it.d);
            const t1 = Pa(i, ub, it.d);
            b.wall(kk, t0, t1, yB - vh, yB);
            b.wall(kk, t1, t0, yB - vh, yB);
          }
        else if (vh > 0) {
          b.wall(key, f0, f1, yB - vh, yB);
          b.wall(key, f1, f0, yB - vh, yB);
        }
        // v7: katlanır kollar (retract: varsayılan her ~2.5 m) + ön profil
        const retract = it.style === 'retract';
        if ((retract || it.arms) && !dutch) {
          const armK = ck('metal', it.arms?.color ?? '#e6e7e5', 'mkRail');
          const W = it.u1 - it.u0;
          const nA = Math.max(2, it.arms?.n ?? Math.round(W / 2.5) + 1);
          const us = it.arms?.us?.length
            ? it.arms.us
            : Array.from({ length: nA }, (_, k) => it.u0 + 0.15 + ((W - 0.3) * k) / (nA - 1));
          for (const uu of us) {
            // Kol: duvar konsolundan (tente üst kenarının 0.3 m altı) ön profile, dirsekli (iki parça)
            const w0 = Pa(i, uu, 0.05);
            const fw = Pa(i, uu, it.d - 0.03);
            const km = Pa(i, uu, it.d * 0.55);
            const yw = yT - 0.3;
            const yk = yB + (yT - yB) * 0.25 - 0.12;
            for (const [pa, ya, pb, yb] of [
              [w0, yw, km, yk],
              [km, yk, fw, yB - 0.02],
            ] as [V2, number, V2, number][]) {
              const L = Math.hypot(pb[0] - pa[0], yb - ya, pb[1] - pa[1]);
              const g = new THREE.BoxGeometry(0.035, 0.035, L);
              const dir = new THREE.Vector3(pb[0] - pa[0], yb - ya, pb[1] - pa[1]).normalize();
              g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
              g.translate((pa[0] + pb[0]) / 2, (ya + yb) / 2, (pa[1] + pb[1]) / 2);
              b.geometry(armK, g);
            }
            b.box(armK, [w0[0], yw, w0[1]], [0.08, 0.12, 0.06], E[i].yaw);
          }
          // Ön profil (kolların taşıdığı alüminyum çubuk)
          const fc = Pa(i, (it.u0 + it.u1) / 2, it.d - 0.02);
          b.box(armK, [fc[0], yB - 0.03, fc[1]], [W, 0.06, 0.06], E[i].yaw);
        }
        const textH = dutch ? Math.min(0.32, 0.45 * (yT - yB)) : vh;
        if (it.text && o.signFace) {
          const fk = o.signFace({
            text: it.text,
            bg: it.color,
            fg: it.textColor,
            font: 'sans',
            bold: true,
            lit: false,
            style: 'panel',
            border: null,
            w: it.u1 - it.u0,
            h: textH,
          });
          const g0 = Pa(i, it.u0, it.d + 0.006);
          const g1 = Pa(i, it.u1, it.d + 0.006);
          // Hollanda tentesinde yazı kabuğun dikey ön alt kısmında
          if (dutch) b.wall(fk, g0, g1, yB, yB + textH, [0, 0, 1, 1]);
          else b.wall(fk, g0, g1, yB - vh, yB, [0, 0, 1, 1]);
        }
        // v7: valans üstünde birden çok yazı / monogram (kendi u aralıklarında; saydam zeminli harfler)
        if (o.signFace && textH > 0.05)
          for (const tx of it.texts ?? []) {
            const tu0 = Math.max(it.u0, Math.min(tx.u0, tx.u1));
            const tu1 = Math.min(it.u1, Math.max(tx.u0, tx.u1));
            if (tu1 - tu0 < 0.05) continue;
            const fk = o.signFace({
              text: tx.text ?? '',
              bg: null,
              fg: tx.fg ?? it.textColor,
              font: tx.font ?? 'sans',
              bold: tx.bold !== false,
              lit: false,
              style: 'letters',
              border: null,
              w: tu1 - tu0,
              h: textH,
              ...(tx.glyphs?.length ? { glyphs: tx.glyphs, join: tx.join ?? null } : {}),
            });
            const g0 = Pa(i, tu0, it.d + 0.009);
            const g1 = Pa(i, tu1, it.d + 0.009);
            if (dutch) b.wall(fk, g0, g1, yB, yB + textH, [0, 0, 1, 1]);
            else b.wall(fk, g0, g1, yB - vh, yB, [0, 0, 1, 1]);
          }
      } else if (it.t === 'rod') {
        // v7: çapraz tabela çubuğu / gergi / konsol: iki uç (u, y, duvardan uzaklık) arasında ince çubuk
        facadeRod(b, P, i, it, base, ck('metal', it.color ?? '#1c1d1e', 'darkMetal'), E[i].yaw);
      } else if (it.t === 'steps') {
        // v7: giriş basamakları (duvar önünde, kademeli blok)
        stepsBlock(b, P, E[i], i, it, base, colorOf(it.color ?? null, 'mkStep'));
      } else if (it.t === 'box') {
        // v7: balkon / loca eşyası (dolap, beyaz kutu, bahçe salıncağı): ölçülen boy ve renk, duvara / loca arka ya
        // da yan duvarına dayalı
        furnItem(b, P, E[i], i, it, base, {
          loggia: (u: number, k: number) => {
            const rec = recAt(i, u, floorY(k) + 1.2);
            if (rec) return { span: [rec.u0, rec.u1] as [number, number], depth: rec.depth };
            const v = voidAt(i, u, k);
            return v ? { span: voidSpan(v, i), depth: voidDepth(v, i) } : null;
          },
          front: (u: number, k: number) => {
            const bl = items(i).find(
              (q): q is CBal =>
                q.t === 'bal' && q.storeys.includes(k) && u >= q.u0 - 0.05 && u <= q.u1 + 0.05,
            );
            return bl ? frontOff(bl, Math.max(bl.u0, Math.min(bl.u1, u))) : null;
          },
          ck,
        });
      } else if (
        it.t === 'blade' ||
        it.t === 'vinyl' ||
        it.t === 'roofsign' ||
        it.t === 'screen' ||
        it.t === 'neon'
      ) {
        // v7: D4 tabela türleri (signs.ts): bayrak tabela, cam folyo yazı, çatı harfleri, LED ekran, neon şerit
        const ctx: SignCtx = {
          b,
          P,
          E: E[i],
          i,
          base,
          wallTop,
          roofH: roofH(),
          ck,
          signFace: o.signFace,
          recDepthAt: (u, y) => {
            const vv = voidAtY(i, u, y);
            return recDepthAt(i, u, y) || (vv && vv.v.edge === i ? vv.depth : 0);
          },
          collide: o.collide,
          floorY,
        };
        drawSignItem(ctx, it);
      }
    }

  // ── Ek hacimler (dünya çokgeni): tek katlı ek, kış bahçesi, çatı odası ──
  for (const v of blk.volumes ?? []) {
    let pl = v.poly.map((p) => [p[0], p[1]] as V2);
    if (pl.length < 3) continue;
    const plOrig = pl;
    // Taban izleri gibi negatif alanlı: (−dz, dx) dış normal, wall(a→e) dışa bakar
    const ar = pl.reduce(
      (a, p, j) => a + p[0] * pl[(j + 1) % pl.length][1] - pl[(j + 1) % pl.length][0] * p[1],
      0,
    );
    const rev = ar > 0;
    if (rev) pl = pl.slice().reverse();
    const vy0 = base + v.y0;
    const vy1 = base + v.y1;
    const wk = ck('plaster', v.color, K('mkPlaster'));
    const L = pl.length;
    // Ters çevrilmiş çokgende çizim kenarı j = ölçüm kenarı (L − 2 − j) (şema: kenar j = poly[j] → poly[j+1]);
    // önceden cam/korkuluk kenar listeleri çizim sırasına uygulanıyordu → ters çokgenlerde yanlış yüz camlıydı
    const orig = (j: number) => (rev ? (((L - 2 - j) % L) + L) % L : j);
    const gl = v.glazing;
    const glazed = (j: number) => !!gl && (gl.edges === 'all' || gl.edges.includes(orig(j)));
    for (let j = 0; j < L; j++) {
      const a = pl[j];
      const e = pl[(j + 1) % L];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (len < 0.02) continue;
      const tx = (e[0] - a[0]) / len;
      const tz = (e[1] - a[1]) / len;
      const at = (u: number, off: number): V2 => [a[0] + tx * u - tz * off, a[1] + tz * u + tx * off];
      const yaw = Math.atan2(-tz, tx);
      if (glazed(j) && gl) {
        // Giydirme cam: gl.from..gl.to arası renkli cam + dikmeler + alt/üst kayıt; kalanı duvar
        const g0 = base + gl.from;
        const g1 = base + gl.to;
        if (g0 > vy0 + 0.01) b.wall(wk, a, e, vy0 - 0.2, g0, [0, vy0 - 0.2, len, g0]);
        if (g1 < vy1 - 0.01) b.wall(wk, a, e, g1, vy1, [0, g1, len, vy1]);
        b.wall(ck('tint', gl.glass, 'mkGlass'), at(0, 0.01), at(len, 0.01), g0, g1);
        const fk = ck('frame', gl.frame, K('mkFrame'));
        const n = Math.max(1, Math.round(len / Math.max(0.3, gl.mullion)));
        for (let k = 0; k <= n; k++) {
          const c = at((len * k) / n, 0.04);
          b.box(fk, [c[0], (g0 + g1) / 2, c[1]], [0.06, g1 - g0, 0.06], yaw);
        }
        const tys = [g0 + 0.03, g1 - 0.03];
        // Ölçülmüş yatay kayıt aralığı (giydirme cephe traversleri)
        if (gl.transom && gl.transom > 0.3)
          for (let yy = g0 + gl.transom; yy < g1 - 0.15; yy += gl.transom) tys.push(yy);
        for (const yy of tys) {
          const c = at(len / 2, 0.04);
          b.box(fk, [c[0], yy, c[1]], [len, 0.06, 0.06], yaw);
        }
      } else {
        // Hacim yüzündeki pencere / kapılar (ölçüm: kenar boyunca u, blok tabanından y)
        const ops: Opening[] = [];
        for (const w of v.wins ?? []) {
          if (w.edge !== orig(j)) continue;
          const ua = rev ? len - w.u1 : w.u0;
          const ub = rev ? len - w.u0 : w.u1;
          const u0 = Math.max(0.05, Math.min(ua, ub));
          const u1 = Math.min(len - 0.05, Math.max(ua, ub));
          const y0 = Math.max(vy0 + 0.02, base + Math.min(w.y0, w.y1));
          const y1 = Math.min(vy1 - 0.05, base + Math.max(w.y0, w.y1));
          if (u1 - u0 < MIN_OPEN || y1 - y0 < 0.25) continue;
          const win: CWin = {
            t: 'win',
            u0,
            u1,
            sill: 0,
            head: 0,
            storeys: [0],
            kind: (w.kind as CWin['kind']) ?? 'std',
            rail: false,
            split: Math.max(1, Math.min(12, w.split ?? 2)),
            box: false,
            ...(w.curt ? { curt: { '0': w.curt } } : {}),
            ...(w.frameC ? { frameC: w.frameC } : {}),
            ...(w.shut ? { shut: { '0': w.shut } } : {}),
            ...(w.shutC ? { shutC: w.shutC } : {}),
          };
          ops.push({ u0, u1, y0, y1, win, k: 0 });
        }
        if (!ops.length) b.wall(wk, a, e, vy0 - 0.2, vy1, [0, vy0 - 0.2, len, vy1]);
        else {
          const Pv: PFn = (_i, u, off = 0) => at(u, off);
          const Ev: Edge = { a, e, len, t: [tx, tz], n: [-tz, tx], yaw, s0: 0 };
          wallWithOpenings(b, Pv, 0, 0, len, 0, vy0 - 0.2, vy1, ops, wk);
          for (const op of ops) addWindow(b, Pv, Ev, 0, op, o.seed);
        }
      }
      if (v.band && v.band.h > 0.01)
        b.wall(
          ck('plaster', v.band.color, K('mkPlaster2')),
          at(0, 0.012),
          at(len, 0.012),
          vy1 - v.band.h,
          vy1,
        );
    }
    const vr = v.roof;
    let vRoofH: ((p: V2) => number | null) | null = null;
    if (vr && (vr.kind === 'gable' || vr.kind === 'hipped')) {
      // Eğik çatılı hacim (ör. şapka üstü teras kulübesi): kırma / alınlıklı beşik
      const tk = !vr.color || vr.color === 'tile' ? K('mkTile') : ck('plaster', vr.color, K('mkTile'));
      unionRoof(b, plOrig, vy1, {
        eave: Math.max(0.02, vr.eave ?? 0.2),
        pitchDeg: vr.pitch ?? 25,
        gableEdges: vr.kind === 'gable' ? (vr.gables ?? []) : [],
        gableBase: vy1 - 0.05,
        keys: {
          roof: tk,
          soffit: K('mkSoffit'),
          fascia: wk,
          gable: vr.gableC ? ck('plaster', vr.gableC, wk) : wk,
          terrace: 'roofFlat',
        },
      });
    } else if (vr && vr.kind === 'vault') {
      // Tonoz çatı: eksen kenarına paralel, dar yönde dairesel kesit (rise), iki alın duvarı; v7 kaburgalar, camlı alın
      const tk = !vr.color || vr.color === 'tile' ? K('mkTile') : ck('plaster', vr.color, K('mkTile'));
      const eg = vr.endGlass && /^#[0-9a-f]{6}$/i.test(vr.endGlass.glass) ? vr.endGlass : null;
      vRoofH = vaultRoof(
        b,
        plOrig,
        vy1,
        vr.rise ?? 1.2,
        vr.axis ?? null,
        tk,
        vr.gableC ? ck('plaster', vr.gableC, wk) : wk,
        {
          ribs:
            vr.ribs && vr.ribs.every > 0.2
              ? { ...vr.ribs, key: ck('metal', vr.ribs.color ?? null, ck('frame', '#f2f2f0', K('mkFrame'))) }
              : null,
          endGlass: eg
            ? {
                ends: eg.ends ?? 'both',
                glassK: ck('tint', eg.glass, 'mkGlass'),
                frameK: ck('frame', eg.frame ?? null, K('mkFrame')),
                mullion: Math.max(0.2, eg.mullion ?? 0.8),
                band: Math.max(0, eg.band ?? 0),
              }
            : null,
        },
      );
    } else slab(b, pl, [], vy1, v.roofC ? ck('plaster', v.roofC, 'roofFlat') : 'roofFlat', wk);
    // v7: hacim çatısı üstü öğeler (dünya konumu): düz çatıda üst kot, eğik çatıda / tonozda yüzey kotu
    if (v.objs?.length) {
      const hAt: (p: V2) => number | null =
        vRoofH ??
        (vr && (vr.kind === 'gable' || vr.kind === 'hipped')
          ? roofHeightAt(plOrig, vy1, {
              eave: Math.max(0.02, vr.eave ?? 0.2),
              pitchDeg: vr.pitch ?? 25,
              gableEdges: vr.kind === 'gable' ? (vr.gables ?? []) : [],
              keys: { roof: '', soffit: '', fascia: '', gable: '', terrace: '' },
            })
          : (p: V2) => (inside(pl, p[0], p[1]) ? vy1 : null));
      for (const ob of v.objs) {
        if (!ob.at) continue;
        const Eo: Edge = {
          a: [ob.at[0], ob.at[1]],
          e: [ob.at[0] + 1, ob.at[1]],
          len: 1,
          t: [1, 0],
          n: [0, 1],
          yaw: 0,
          s0: 0,
        };
        const Po: PFn = (_i, u, off = 0) => [ob.at[0] + u, ob.at[1] + off];
        const it: CRoofObj = { ...ob, t: 'roofobj', u: 0, setback: 0 };
        roofObject(b, Po, Eo, 0, it, hAt, {
          wallK: colorOf(it.color, K('mkPlaster')),
          tileK: K('mkTile'),
          capK: (c) => (!c || c === 'tile' ? K('mkTile') : colorOf(c, K('mkTile'))),
          metalK: ck('metal', it.color ?? null, 'mkRail'),
          lampK: (c) => ck('neon', c, 'wallLamp'),
        });
      }
    }
    const vp = v.parapet && v.parapet.h > 0.02 ? v.parapet : null;
    if (vp) {
      const pk = ck('plaster', vp.color ?? v.color, wk);
      curPoly = pl;
      let run = 0;
      // v7 (hata düzeltmesi): parapet yalnız `edges` kenarlarında (ölçüm kenar indeksi; önceden tüm kenarlarda —
      // 1540901777 volumes[2]); parapetsiz komşuya bakan uçlarda kapak yüzü
      const onVp = (j: number) => !vp.edges || vp.edges.includes(orig(((j % L) + L) % L));
      for (let j = 0; j < L; j++) {
        const a = pl[j];
        const e = pl[(j + 1) % L];
        const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
        if (len < 0.02) continue;
        if (!onVp(j)) {
          run += len;
          continue;
        }
        const tx = (e[0] - a[0]) / len;
        const tz = (e[1] - a[1]) / len;
        const ai: V2 = [a[0] + tz * 0.15, a[1] - tx * 0.15];
        const ei: V2 = [e[0] + tz * 0.15, e[1] - tx * 0.15];
        if (vp.edges) {
          if (!onVp(j - 1)) b.wall(pk, ai, a, vy1, vy1 + vp.h, [0, 0, 0.15, vp.h]);
          if (!onVp(j + 1)) b.wall(pk, e, ei, vy1, vy1 + vp.h, [0, 0, 0.15, vp.h]);
        }
        b.wall(pk, a, e, vy1, vy1 + vp.h, [0, 0, len, vp.h]);
        b.wall(pk, ei, ai, vy1, vy1 + vp.h, [0, 0, len, vp.h]);
        b.quad(
          pk,
          [ai[0], vy1 + vp.h, ai[1]],
          [ei[0], vy1 + vp.h, ei[1]],
          [e[0], vy1 + vp.h, e[1]],
          [a[0], vy1 + vp.h, a[1]],
        );
        if (vp.rail && vp.rail !== 'none' && (!vp.railEdges || vp.railEdges.includes(orig(j))))
          parapet(b, a, e, vy1 + vp.h, run, {
            type: vp.rail,
            fKey: pk,
            mKey: ck('metal', vp.railC ?? null, 'mkRail'),
            parH: 0.04,
            net: false,
            gKey: ck('glass', vp.glassC ?? null, K('mkRailGlass')),
            railH: vp.railH ?? undefined,
          });
        run += len;
      }
    }
    if (v.collide !== false && v.y0 < 2.5) o.collide?.(pl, vy0 - 0.5, vy1);
  }

  // ── Pergolalar (çatı terası / teras): dikmeler, çevre kirişleri, kısa yönde lameller, isteğe bağlı örtü ──
  for (const pg of blk.pergolas ?? [])
    pergola(b, pg, base, ck('metal', pg.color ?? '#3b3f42', 'darkMetal'), ck);

  // ── Çatı: saçak alnı + kırma kiremit ──
  // v7: saçak alnını kesen girinti ağızları (duvar üstünü aşan girinti — ör. 1550614218 podyum kanopisi önü 0.75 m
  // geride): alın bandı girinti boyunca kesilir (girintinin arka / yan / tavan yüzleri girinti döngüsünde)
  // v9: saçak taşması olan kenarda alın bandı saçak UCUNDA (düz çatı varsayılanı; roof.fasciaAt "tip" / "wall"):
  // duvar hizasında çizilen bant derin saçak kutusunun altında kalıcı gölgede kalıyordu (1546358573 kuzey #3c454e →
  // #0b1b2c). Uçta: bant (unionRoof'un kendi 0.33 m uç alnının ALTINA kadar — çift yüz yok) + alt yüz (saçak kutusu
  // tabanı) + saçaksız komşuya bakan uçta dönüş yüzü.
  const tipMode = (blk.roof.fasciaAt ?? (blk.roof.kind === 'flat' ? 'tip' : 'wall')) === 'tip' && !OLD_ROOF;
  const evAt = (j: number) => (roofOpts.eaveOf ? roofOpts.eaveOf(j) : eave);
  /** Komşu kenarın saçak ucu (parapet / alınlık / çok kısa kenar: 0 = duvar hizası) */
  const evNb = (j: number) => (E[j].len < 0.05 || onPar(j) || isGableEdge(j) ? 0 : evAt(j));
  const fasciaTip = (i: number, y0: number, y1: number): boolean => {
    const ev = evAt(i);
    if (!tipMode || !(ev >= 0.1)) return false;
    const { len, s0, t, n } = E[i];
    // Uç çizgisinin komşu uç çizgisiyle kesişimi (dik köşede dışbükeyde −ev komşu, içbükeyde +ev komşu)
    const tipU = (j: number, atEnd: boolean): number => {
      const ej = E[j];
      const evj = evNb(j);
      // köşe c: c + n·ev + t·u = c + nj·evj + tj·w → u = cross(nj·evj − n·ev, tj) / cross(t, tj)
      const dx = ej.n[0] * evj - n[0] * ev;
      const dz = ej.n[1] * evj - n[1] * ev;
      const den = t[0] * ej.t[1] - t[1] * ej.t[0];
      if (Math.abs(den) < 0.05) return atEnd ? len : 0;
      const u = (dx * ej.t[1] - dz * ej.t[0]) / den;
      const lim = 3 * ev + 1;
      return atEnd ? len + Math.max(-len / 2, Math.min(lim, u)) : Math.max(-lim, Math.min(len / 2, u));
    };
    const pj = (i + N - 1) % N;
    const nj = (i + 1) % N;
    let uA = tipU(pj, false);
    let uB = tipU(nj, true);
    if (uB - uA < 0.05) {
      uA = 0;
      uB = len;
    }
    const top = Math.min(y1, roofY - 0.3);
    const yS = Math.min(y0, roofY - 0.3);
    if (top - yS > 0.005)
      b.wall(fasciaK, P(i, uA, ev + 0.002), P(i, uB, ev + 0.002), yS, top, [s0 + uA, yS, s0 + uB, top]);
    // Saçak kutusu alt yüzü (aşağı bakar): duvar hizası [0, len] → uç [uA, uB]
    b.quad(
      K('mkSoffit'),
      xz(P(i, 0, 0), yS),
      xz(P(i, len, 0), yS),
      xz(P(i, uB, ev), yS),
      xz(P(i, uA, ev), yS),
      [0, 0, len, ev],
    );
    // Saçaksız komşuya bakan uçlarda dönüş yüzü (duvar → uç)
    const retTop = roofY + 0.03;
    if (evNb(pj) < 0.1) b.wall(fasciaK, P(i, 0, 0), P(i, uA, ev), yS, retTop, [0, yS, ev, retTop]);
    if (evNb(nj) < 0.1) b.wall(fasciaK, P(i, uB, ev), P(i, len, 0), yS, retTop, [0, yS, ev, retTop]);
    return true;
  };
  const fasciaWall = (i: number, y0: number, y1: number) => {
    const { len, s0 } = E[i];
    // Yalnız saçak alnının içine uzanan girintiler (duvar üstünde biten girinti alnı kesmez — eski geometri)
    const cut = recs.filter((r) => r.i === i && r.Y1 > y0 + 0.1 && r.Y0 < y1 - 0.02);
    if (!cut.length && fasciaTip(i, y0, y1)) return;
    if (!cut.length) {
      b.wall(fasciaK, P(i, 0, 0.02), P(i, len, 0.02), y0, y1, [s0, y0, s0 + len, y1]);
      return;
    }
    const Pf: PFn = (ii, u, off = 0) => P(ii, u, off + 0.02);
    wallWithOpenings(
      b,
      Pf,
      i,
      0,
      len,
      s0,
      y0,
      y1,
      cut.map((r) => ({ u0: r.u0, u1: r.u1, y0: r.Y0, y1: r.Y1, win: recDummy, k: -9 })),
      fasciaK,
    );
  };
  // v9: parapet korkuluğunun kenar bazında ayarı (dünya noktasına ≤ 1.5 m en yakın kenar) + küpeşte / ara çubuklar
  const parEdgeRail = new Map<number, NonNullable<CParapet['edgeRails']>[number]>();
  for (const er of par?.edgeRails ?? []) {
    if (!er?.at) continue;
    let bi = -1;
    let bd = 1.5;
    for (let i = 0; i < N; i++) {
      const e = E[i];
      if (e.len < 0.05) continue;
      const u = Math.max(0, Math.min(e.len, (er.at[0] - e.a[0]) * e.t[0] + (er.at[1] - e.a[1]) * e.t[1]));
      const d = Math.hypot(er.at[0] - (e.a[0] + e.t[0] * u), er.at[1] - (e.a[1] + e.t[1] * u));
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) parEdgeRail.set(bi, er);
  }
  const railExtra = (
    er: NonNullable<CParapet['edgeRails']>[number] | undefined,
    pp: CParapet,
  ): Partial<RailSpec> => {
    const top = er?.railTopC ?? pp.railTopC;
    const rows = er?.rows ?? pp.rows;
    const pe = er?.postEvery ?? pp.postEvery;
    return {
      ...(top ? { topKey: ck('metal', top, 'mkRail') } : {}),
      ...(rows != null ? { rows, rowGap: er?.rowGap ?? pp.rowGap ?? 0.15 } : {}),
      ...(pe ? { postEvery: pe } : {}),
    };
  };
  if (par) {
    const pk = ck('plaster', par.color, K('mkPlaster2'));
    curPoly = ring;
    let run = 0;
    // Kenar bazında: parapet yalnız `edges` kenarlarında (diğerlerinde saçak alnı), korkuluk yalnız `railEdges`
    const copH = par.coping && par.coping.h > 0.005 ? par.coping.h : 0;
    for (let i = 0; i < N; i++) {
      const { len } = E[i];
      if (len < 0.05) continue;
      if (!onPar(i)) {
        const fh = Math.max(0.05, blk.roof.fasciaH ?? 0.45);
        if (!isGableEdge(i)) fasciaWall(i, wallTop - 0.05, wallTop + fh);
        run += len;
        continue;
      }
      const a = P(i, 0, 0.02);
      const e = P(i, len, 0.02);
      const ai = P(i, 0, -0.2);
      const ei = P(i, len, -0.2);
      // Parapetsiz komşu kenara bakan uçlar: kapak yüzü
      if (par.edges) {
        if (!onPar((i + N - 1) % N)) b.wall(pk, ai, a, wallTop, wallTop + par.h, [0, 0, 0.22, par.h]);
        if (!onPar((i + 1) % N)) b.wall(pk, e, ei, wallTop, wallTop + par.h, [0, 0, 0.22, par.h]);
      }
      if (par.band && par.band.h > 0.01)
        b.wall(
          ck('plaster', par.band.color, pk),
          P(i, 0, 0.026),
          P(i, len, 0.026),
          wallTop - 0.05,
          wallTop - 0.05 + par.band.h,
          [E[i].s0, 0, E[i].s0 + len, par.band.h],
        );
      if (copH) {
        // Harpuşta: parapet üstünde iki yana taşan şapka (metal / beton)
        const ov = par.coping!.over ?? 0.03;
        const c = P(i, len / 2, (0.02 - 0.2) / 2);
        const cK = ck('frame', par.coping!.color ?? null, pk);
        if (BEV > 0)
          b.bevelBox(
            cK,
            [c[0], wallTop + par.h + copH / 2, c[1]],
            [len + 2 * ov, copH, 0.22 + 2 * ov],
            E[i].yaw,
            BEV,
          );
        else
          b.box(cK, [c[0], wallTop + par.h + copH / 2, c[1]], [len + 2 * ov, copH, 0.22 + 2 * ov], E[i].yaw);
      }
      // Yüksek/Ultra, harpuştasız parapet: dış üst kenar pahlı
      const pb = BEV > 0 && !copH ? Math.min(BEV, par.h * 0.3) : 0;
      // v9 (glassUp): duvar üstünü aşan açıklıklar (giydirme cam) parapetin dış yüzünü de keser — cam parapet
      // yüzünde görünür (1550614219 KuveytTürk: cam 11.5'e, duvar üstü 10.37)
      const upOps = par.glassUp
        ? openings[i].filter((op) => op.y1 > wallTop + 0.02 && op.u1 > 0 && op.u0 < len)
        : [];
      if (upOps.length)
        wallWithOpenings(
          b,
          (ii, u, off = 0) => P(ii, u, off + 0.02),
          i,
          0,
          len,
          E[i].s0,
          wallTop - 0.05,
          wallTop + par.h - pb,
          upOps,
          pk,
        );
      else
        b.wall(pk, a, e, wallTop - 0.05, wallTop + par.h - pb, [
          E[i].s0,
          wallTop - 0.05,
          E[i].s0 + len,
          wallTop + par.h - pb,
        ]);
      b.wall(pk, ei, ai, wallTop, wallTop + par.h, [0, 0, len, par.h]);
      const aT = pb > 0 ? P(i, 0, 0.02 - pb) : a;
      const eT = pb > 0 ? P(i, len, 0.02 - pb) : e;
      if (pb > 0)
        b.quad(
          pk,
          xz(a, wallTop + par.h - pb),
          xz(e, wallTop + par.h - pb),
          xz(eT, wallTop + par.h),
          xz(aT, wallTop + par.h),
        );
      b.quad(
        pk,
        [ai[0], wallTop + par.h, ai[1]],
        [ei[0], wallTop + par.h, ei[1]],
        [eT[0], wallTop + par.h, eT[1]],
        [aT[0], wallTop + par.h, aT[1]],
      );
      // v9: kenar bazında korkuluk (edgeRails: dünya noktasına en yakın kenar)
      const er = parEdgeRail.get(i);
      const rType = er?.rail ?? par.rail;
      if (rType && rType !== 'none' && (!par.railEdges || par.railEdges.includes(i)))
        parapet(b, P(i, 0, 0), P(i, len, 0), wallTop + par.h + copH, run, {
          type: rType,
          fKey: pk,
          mKey: ck('metal', er?.railC ?? par.railC ?? null, 'mkRail'),
          parH: 0.04,
          net: false,
          gKey: ck('glass', par.glassC ?? null, K('mkRailGlass')),
          railH: er?.railH ?? par.railH ?? undefined,
          ...railExtra(er, par),
        });
      run += len;
    }
  } else
    for (let i = 0; i < N; i++) {
      const { len } = E[i];
      if (len < 0.05) continue;
      // Alınlık kenarında saçak alnı yok: duvar alınlığa kesintisiz yükselir
      if (isGableEdge(i)) continue;
      // Saçak alnı: Street View'da açık gri (koyu balkon alnı renginde değil); ölçülmüşse roof.fasciaC
      fasciaWall(i, wallTop - 0.05, wallTop + fH);
    }
  // Saçak altı gömme spotları (roof.spots): parapetsiz, alınlık olmayan kenarlarda, saçak taşmasının altında
  const rs = blk.roof.spots;
  if (rs && !OLD_ROOF)
    for (let i = 0; i < N; i++) {
      const { len } = E[i];
      const ev = roofOpts.eaveOf ? roofOpts.eaveOf(i) : eave;
      if (len < 0.8 || ev < 0.1 || onPar(i) || isGableEdge(i)) continue;
      if (rs.edges && !rs.edges.includes(i)) continue;
      const every = Math.max(0.5, rs.every ?? 2.7);
      const off = Math.max(0.05, Math.min(ev - 0.05, ev - (rs.inset ?? ev / 2)));
      const n = Math.max(1, Math.round((len - 0.6) / every));
      for (let k = 0; k < n; k++) {
        const u = 0.3 + ((len - 0.6) * (k + 0.5)) / n;
        const c = P(i, u, off);
        const g = new THREE.CircleGeometry(Math.max(0.03, (rs.d ?? 0.1) / 2), 12)
          .rotateX(Math.PI / 2)
          .translate(c[0], roofY - 0.026, c[1]);
        b.geometry('mkDownlight', g);
      }
    }
  let top: number;
  if (!OLD_ROOF && wings) {
    // v7: açık mahyalı kanat çatıları + kalan kısımlarda birleşik kırma çatı
    top = wingRoofs(b, ring, wings, roofY, base, {
      ...wingOpts0,
      keys: roofOpts.keys,
      gableKeys,
      holes: gableHoles,
    });
    for (const r of restRings())
      top = Math.max(top, unionRoof(b, r.ring, roofY, { ...roofOpts, gableEdges: [], eaveOf: r.eaveOf }));
  } else if (!OLD_ROOF) {
    // Taban izine oturan birleşik kırma çatı (+ alınlıklar, düz teras) — hava fotoğrafındaki çatı biçimi
    top = unionRoof(b, ring, roofY, { ...roofOpts, holes: gableHoles });
  } else if (blk.roof.kind === 'gable' && gables.length) {
    // Mahya, alınlık duvarlarına dik: alınlık kenarlarının ortalama doğrultusu
    let gx = 0;
    let gz = 0;
    for (const g of gables) {
      const e = E[g % N];
      if (!e) continue;
      // İşaretten bağımsız ortalama (çift açı)
      const a2 = Math.atan2(e.t[1], e.t[0]) * 2;
      gx += Math.cos(a2) * e.len;
      gz += Math.sin(a2) * e.len;
    }
    const ang = Math.atan2(gz, gx) / 2;
    top = gableRoof(b, ring, wallTop + fH - 0.02, eave, blk.roof.pitch ?? 24, [Math.cos(ang), Math.sin(ang)]);
  } else top = hippedRoof(b, ring, wallTop + fH - 0.02, eave, blk.roof.pitch ?? 28);
  return { top, holes: recessHoles };
}

/** Beşik çatı: alınlık doğrultusu `gdir` (alınlık duvarı boyunca); mahya buna dik. Alınlık üçgenleri sıva. */
function gableRoof(b: Builder, r: V2[], y: number, eave: number, pitchDeg: number, gdir: V2): number {
  // Alınlık yönü ekseninde sınır kutusu
  const ax = gdir;
  const nx: V2 = [-ax[1], ax[0]];
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of r) {
    const u = p[0] * ax[0] + p[1] * ax[1];
    const v = p[0] * nx[0] + p[1] * nx[1];
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const C = (u: number, v: number): V2 => [ax[0] * u + nx[0] * v, ax[1] * u + nx[1] * v];
  const uc = (u0 + u1) / 2;
  const W = (u1 - u0) / 2 + eave; // alınlık boyunca yarı genişlik (eğimli yüzler bu yönde iner)
  const va = v0 - 0.25;
  const ve = v1 + 0.25;
  const rise = ((u1 - u0) / 2) * Math.tan((pitchDeg * Math.PI) / 180);
  const ry = y + rise;
  const V = (p: V2, h: number): V3 => [p[0], h, p[1]];
  const A0 = C(uc - W, va);
  const A1 = C(uc - W, ve);
  const B0 = C(uc + W, va);
  const B1 = C(uc + W, ve);
  const R0 = C(uc, va);
  const R1 = C(uc, ve);
  const yE = y - eave * Math.tan((pitchDeg * Math.PI) / 180);
  for (const [p0, p1] of [
    [A0, A1],
    [B1, B0],
  ] as [V2, V2][]) {
    const r0 = p0 === A0 ? R0 : R1;
    const r1 = p0 === A0 ? R1 : R0;
    b.quad('roof', V(p0, yE), V(p1, yE), V(r1, ry), V(r0, ry), [
      0,
      0,
      (ve - va) / 2,
      W / Math.cos((pitchDeg * Math.PI) / 180) / 1.5,
    ]);
    b.quad(K('mkSoffit'), V(p1, yE - 0.02), V(p0, yE - 0.02), V(r0, ry - 0.02), V(r1, ry - 0.02));
    // Saçak alnı
    b.wall(K('mkFascia'), p1, p0, yE - 0.28, yE + 0.02, [0, 0, ve - va, 0.3]);
  }
  // Alınlık üçgenleri (duvar düzleminde, uçlarda)
  const G0a = C(u0, v0);
  const G0b = C(u1, v0);
  const G1a = C(u0, v1);
  const G1b = C(u1, v1);
  const Rg0 = C(uc, v0);
  const Rg1 = C(uc, v1);
  for (const [pa, pb, rg] of [
    [G0b, G0a, Rg0],
    [G0a, G0b, Rg0],
    [G1a, G1b, Rg1],
    [G1b, G1a, Rg1],
  ] as [V2, V2, V2][])
    b.quad(K('mkPlaster2'), V(pa, y), V(pb, y), V(rg, ry - 0.05), V(rg, ry - 0.05), [0, 0, u1 - u0, rise]);
  // Kenar (rüzgârlık) bantları
  for (const [p, q] of [
    [A0, R0],
    [R0, B0],
    [A1, R1],
    [R1, B1],
  ] as [V2, V2][]) {
    const yp = p === R0 || p === R1 ? ry : yE;
    const yq = q === R0 || q === R1 ? ry : yE;
    b.quad(K('mkFascia'), V(p, yp - 0.28), V(q, yq - 0.28), V(q, yq + 0.04), V(p, yp + 0.04));
  }
  const rl = ve - va;
  const m: V2 = [(R0[0] + R1[0]) / 2, (R0[1] + R1[1]) / 2];
  b.box('ridge', [m[0], ry + 0.04, m[1]], [rl + 0.1, 0.1, 0.22], Math.atan2(-nx[1], nx[0]));
  return ry;
}

function xz(p: V2, y: number): V3 {
  return [p[0], y, p[1]];
}

/** Doğru (o + t·dir) ile çokgenin kesişim aralıkları [t0, t1] (içeride kalan parçalar) */
export function clipLine(o: V2, dir: V2, poly: V2[]): [number, number][] {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const e = poly[(i + 1) % poly.length];
    const ex = e[0] - a[0];
    const ez = e[1] - a[1];
    const den = dir[0] * ez - dir[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - o[0]) * ez - (a[1] - o[1]) * ex) / den;
    const s = ((a[0] - o[0]) * dir[1] - (a[1] - o[1]) * dir[0]) / den;
    if (s >= 0 && s < 1) ts.push(t);
  }
  ts.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < ts.length; k += 2) out.push([ts[k], ts[k + 1]]);
  return out;
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

/** Çokgen sınır kenarlarından bina duvarına oturmayanlar */
function boundarySegs(outer: V2[], building: V2[]): [V2, V2][] {
  const out: [V2, V2][] = [];
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    const q = outer[(i + 1) % outer.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 0.02) continue;
    const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (distToRing(building, m[0], m[1]) < 0.03) continue;
    out.push([p, q]);
  }
  return out;
}

/** Kenarı, Builder.wall ön yüzü çokgenin dışına bakacak şekilde sırala */
/** Dış sıralı (outwardOrder) kenarı içe doğru `d` kadar kaydır */
/** v9: açık çoklu çizginin d kadar ötelenmişi (sol normal (−dz, dx) yönünde +; köşelerde gönye, sınırlı) */
export function offsetLine(pts: V2[], d: number): V2[] {
  const n = pts.length;
  const nrm = (a: V2, e: V2): V2 => {
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    return [-(e[1] - a[1]) / L, (e[0] - a[0]) / L];
  };
  return pts.map((p, j) => {
    const n0 = j > 0 ? nrm(pts[j - 1], p) : null;
    const n1 = j + 1 < n ? nrm(p, pts[j + 1]) : null;
    if (!n0 || !n1) {
      const q = (n0 ?? n1)!;
      return [p[0] + q[0] * d, p[1] + q[1] * d] as V2;
    }
    const mx = n0[0] + n1[0];
    const mz = n0[1] + n1[1];
    const ml = Math.hypot(mx, mz) || 1;
    const c = Math.max(0.35, (mx / ml) * n1[0] + (mz / ml) * n1[1]);
    return [p[0] + ((mx / ml) * d) / c, p[1] + ((mz / ml) * d) / c] as V2;
  });
}
function insetSeg(p: V2, q: V2, d: number): [V2, V2] {
  if (d <= 0) return [p, q];
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const nx = -(q[1] - p[1]) / L;
  const nz = (q[0] - p[0]) / L;
  return [
    [p[0] - nx * d, p[1] - nz * d],
    [q[0] - nx * d, q[1] - nz * d],
  ];
}

function outwardOrder(poly: V2[], p: V2, q: V2): [V2, V2] {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const nx = -(q[1] - p[1]) / L;
  const nz = (q[0] - p[0]) / L;
  const m: V2 = [(p[0] + q[0]) / 2 + nx * 0.01, (p[1] + q[1]) / 2 + nz * 0.01];
  return inside(poly, m[0], m[1]) ? [q, p] : [p, q];
}

let curPoly: V2[] = [];

/** v7: düşey prizma (çokgen taban, y0..y1): yan yüzler dışa, üst yüz topKey, alt yüz */
function prism(b: Builder, key: string, topKey: string, pl: V2[], y0: number, y1: number): void {
  const ccw = area2(pl) > 0;
  const r = ccw ? pl.slice().reverse() : pl;
  // Taban izleri gibi negatif alanlı sıra: wall(a→e) dışa bakar
  for (let j = 0; j < r.length; j++) {
    const a = r[j];
    const e = r[(j + 1) % r.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 1e-3) continue;
    b.wall(key, a, e, y0, y1, [0, y0, L, y1]);
  }
  b.polygon(topKey, r, y1, true, 1);
  b.polygon(key, r, y0, false, 1);
}

function slab(b: Builder, outer: V2[], holes: V2[][], y: number, top: string, bottom: string): void {
  curPoly = outer;
  if (holes.length) {
    // Delikli: THREE.Shape ile üçgenle
    const sh = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    for (const h of holes) sh.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
    for (const [key, yy, up] of [
      [top, y + 0.01, true],
      [bottom, y - SLAB, false],
    ] as [string, number, boolean][]) {
      const g = new THREE.ShapeGeometry(sh);
      g.rotateX(Math.PI / 2);
      if (up) {
        g.scale(1, -1, 1);
      }
      g.translate(0, yy, 0);
      b.geometry(key, g);
    }
    return;
  }
  b.polygon(top, outer, y + 0.01, true, 0.5);
  b.polygon(bottom, outer, y - SLAB, false, 0.5);
}

/** Gri dolu parapet (iki yüz + üst), buzlu cam, paslanmaz küpeşte */
function parapet(b: Builder, p0: V2, q0: V2, y: number, run: number, spec?: RailSpec): void {
  const [p, q] = outwardOrder(curPoly, p0, q0);
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const nx = -(q[1] - p[1]) / L;
  const nz = (q[0] - p[0]) / L;
  const T = 0.1; // parapet kalınlığı (içe)
  const type = spec?.type ?? 'glass';
  const fKey = spec?.fKey ?? K('mkFascia');
  const mKey = spec?.mKey ?? 'mkRail';
  const yaw0 = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
  // Küpeşte yüksekliği (ölçülmüş; ör. çatı korkuluğu ≈0.6 m)
  const RAIL = spec?.railH && spec.railH > 0.1 ? spec.railH : RAIL0;
  const drop = Math.max(0, spec?.drop ?? 0);
  // Dolu kısım yüksekliği: glass → parapetH (≈0.38), solid → küpeşte boyu, tube/bars/glassFull/none → yalnız döşeme alnı
  const PH =
    type === 'solid'
      ? Math.max(spec?.parH ?? RAIL, 0.85)
      : type === 'glass' || type === 'solidTube'
        ? (spec?.parH ?? PARAPET)
        : 0.04;
  const pi: V2 = [p[0] - nx * T, p[1] - nz * T];
  const qi: V2 = [q[0] - nx * T, q[1] - nz * T];
  // Pah (Yüksek/Ultra): döşeme alnı üst ve alt dış kenarları 45° pahlı (beton kenar ışığı yakalar)
  const bv = BEV > 0 && !spec?.flush ? Math.min(BEV, 0.3 * (PH + SLAB + drop)) : 0;
  if (spec?.flush) {
    // Yalnız korkuluk (şapka üstü teras): dolu kısım varsa yalnız parapetin kendisi
    if (PH > 0.06) b.wall(fKey, p, q, y, y + PH, [run, y, run + L, y + PH]);
  } else if (bv > 0) {
    const yb = y - SLAB - drop;
    const yt = y + PH;
    const pI: V2 = [p[0] - nx * bv, p[1] - nz * bv];
    const qI: V2 = [q[0] - nx * bv, q[1] - nz * bv];
    b.wall(fKey, p, q, yb + bv, yt - bv, [run, yb + bv, run + L, yt - bv]);
    // Üst pah (dışa-yukarı) ve alt pah (dışa-aşağı)
    b.quad(fKey, xz(p, yt - bv), xz(q, yt - bv), xz(qI, yt), xz(pI, yt), [run, 0, run + L, bv * 1.41]);
    b.quad(fKey, xz(pI, yb), xz(qI, yb), xz(q, yb + bv), xz(p, yb + bv), [run, 0, run + L, bv * 1.41]);
  } else b.wall(fKey, p, q, y - SLAB - drop, y + PH, [run, y - SLAB - drop, run + L, y + PH]);
  if (drop > 0.01 && !spec?.flush) {
    // Sarkan kiriş: iç yüz + alt yüz
    b.wall(fKey, qi, pi, y - SLAB - drop, y - SLAB, [run, 0, run + L, drop]);
    b.quad(
      fKey,
      [p[0], y - SLAB - drop, p[1]],
      [pi[0], y - SLAB - drop, pi[1]],
      [qi[0], y - SLAB - drop, qi[1]],
      [q[0], y - SLAB - drop, q[1]],
    );
  }
  if (PH > 0.06) {
    b.wall(fKey, qi, pi, y, y + PH, [run, y, run + L, y + PH]);
    // Pahlıysa üst yüz pahın iç kenarından başlar
    const po: V2 = bv > 0 ? [p[0] - nx * bv, p[1] - nz * bv] : p;
    const qo: V2 = bv > 0 ? [q[0] - nx * bv, q[1] - nz * bv] : q;
    b.quad(
      fKey,
      [pi[0], y + PH, pi[1]],
      [qi[0], y + PH, qi[1]],
      [qo[0], y + PH, qo[1]],
      [po[0], y + PH, po[1]],
    );
  }
  // Dolu parapet üstü harpuşta / başlık (ölçüm: kat kat `coping`)
  const copH = PH > 0.3 && spec?.copH && spec.copK ? spec.copH : 0;
  if (copH > 0) {
    const ov = spec!.copOver ?? 0.02;
    const cm: V2 = [(p[0] + q[0]) / 2 - (nx * T) / 2, (p[1] + q[1]) / 2 - (nz * T) / 2];
    if (BEV > 0)
      b.bevelBox(
        spec!.copK!,
        [cm[0], y + PH + copH / 2, cm[1]],
        [L + 2 * ov, copH, T + 2 * ov],
        yaw0,
        Math.min(BEV, copH * 0.4),
      );
    else b.box(spec!.copK!, [cm[0], y + PH + copH / 2, cm[1]], [L + 2 * ov, copH, T + 2 * ov], yaw0);
  }
  // Dolu parapet üstünde ince çelik küpeşte (ölçüm: kat kat `hand`, parapet üstünden yükseklik)
  if (spec?.hand != null && PH > 0.3) {
    const hh = Math.max(0, spec.hand) + copH;
    const hm: V2 = [(p[0] + q[0]) / 2 - (nx * T) / 2, (p[1] + q[1]) / 2 - (nz * T) / 2];
    b.box(mKey, [hm[0], y + PH + hh + 0.02, hm[1]], [L + 0.02, 0.04, 0.04], yaw0);
    if (hh > 0.05) {
      const n = Math.max(1, Math.round(L / Math.max(0.5, spec.postEvery ?? 1.2)));
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        b.box(
          mKey,
          [p[0] + (q[0] - p[0]) * f - (nx * T) / 2, y + PH + hh / 2, p[1] + (q[1] - p[1]) * f - (nz * T) / 2],
          [0.03, hh, 0.03],
          yaw0,
        );
      }
    }
  }
  if (spec?.net) {
    // Kuş filesi / gölgelik: korkuluğun iç tarafında koyu file
    const n0: V2 = [p[0] - nx * 0.09, p[1] - nz * 0.09];
    const n1: V2 = [q[0] - nx * 0.09, q[1] - nz * 0.09];
    b.wall('mkNet', n0, n1, y + 0.02, y + RAIL, [0, 0, L / 0.2, RAIL / 0.2]);
    b.wall('mkNet', n1, n0, y + 0.02, y + RAIL, [0, 0, L / 0.2, RAIL / 0.2]);
  }
  if (type === 'solid' || type === 'none') return;
  const g0: V2 = [p[0] - nx * 0.05, p[1] - nz * 0.05];
  const g1: V2 = [q[0] - nx * 0.05, q[1] - nz * 0.05];
  // Dikme konumları (parça boyunca 0..1): düz kenarda uçlar + ~1.2 m; kavisli ön yüzün kısa parçalarında
  // çevre boyunca (run) 1.2 m'nin katlarında — her kısa parçaya iki dikme konunca çubuklu korkuluk gibi görünüyordu
  // Ölçülmüş dikme aralığı (ör. cam paneller ≈1.0 m arayla paslanmaz dikmeli), yoksa ~1.2 m
  const PE = Math.max(0.4, spec?.postEvery ?? 1.2);
  const postFs = (): number[] => {
    if (!spec?.curved) {
      const n = Math.max(1, Math.round(L / PE));
      return Array.from({ length: n + 1 }, (_, k) => k / n);
    }
    const out: number[] = [];
    for (let sp = Math.ceil(run / PE - 1e-6) * PE; sp <= run + L + 1e-6; sp += PE) out.push((sp - run) / L);
    return out;
  };
  const mm: V2 = [(g0[0] + g1[0]) / 2, (g0[1] + g1[1]) / 2];
  if (type === 'tube' || type === 'solidTube' || type === 'bars') {
    // Dikmeler (~1.2 m) + üst küpeşte
    for (const f of postFs()) {
      b.box(
        mKey,
        [g0[0] + (g1[0] - g0[0]) * f, y + (PH + RAIL) / 2, g0[1] + (g1[1] - g0[1]) * f],
        [0.035, RAIL - PH, 0.035],
        yaw0,
      );
    }
    b.box(spec?.topKey ?? mKey, [mm[0], y + RAIL + 0.02, mm[1]], [L + 0.02, 0.045, 0.05], yaw0);
    if (type === 'tube' && spec?.rows != null) {
      // v9: ölçülen ara çubuklar: küpeştenin altından rowGap arayla
      const gap = Math.max(0.05, spec.rowGap ?? 0.15);
      for (let k = 1; k <= spec.rows; k++) {
        const r = RAIL - gap * k;
        if (r <= PH + 0.05) break;
        b.box(mKey, [mm[0], y + r, mm[1]], [L, 0.02, 0.02], yaw0);
      }
    } else if (type === 'bars') {
      const nb = Math.max(2, Math.round(L / 0.12));
      for (let k = 1; k < nb; k++) {
        const f = k / nb;
        b.box(
          mKey,
          [g0[0] + (g1[0] - g0[0]) * f, y + (PH + RAIL) / 2, g0[1] + (g1[1] - g0[1]) * f],
          [0.016, RAIL - PH - 0.02, 0.016],
          yaw0,
        );
      }
      b.box(mKey, [mm[0], y + PH + 0.1, mm[1]], [L, 0.03, 0.03], yaw0);
    } else {
      const rows = (type === 'solidTube' ? [0.65] : [0.3, 0.55, 0.78]).map((r) => (r * RAIL) / RAIL0);
      for (const r of rows) {
        if (r <= PH + 0.05) continue;
        b.box(mKey, [mm[0], y + r, mm[1]], [L, 0.03, 0.03], yaw0);
      }
    }
    return;
  }
  // Buzlu cam (glass: parapet üstünde; glassFull: döşemeden) + küpeşte
  const gy0 = type === 'glassFull' ? y + 0.03 : y + PH;
  b.wall(spec?.gKey ?? K('mkRailGlass'), g0, g1, gy0, y + RAIL, [0, 0, L, 1]);
  const m: V2 = mm;
  const yaw = yaw0;
  b.box(mKey, [m[0], y + RAIL + 0.02, m[1]], [L + 0.02, 0.04, 0.05], yaw);
  // Cam tutucu dikmeler (~1.2 m; ölçülmüşse postEvery) — korkuluk metal renginde (önceden hep mkRail'di: ölçülen
  // railC dikmelere uygulanmıyordu)
  const PW = Math.max(0.015, Math.min(0.08, spec?.postW ?? 0.03));
  for (const f of postFs()) {
    b.box(
      mKey,
      [g0[0] + (g1[0] - g0[0]) * f, y + (gy0 - y + RAIL) / 2, g0[1] + (g1[1] - g0[1]) * f],
      [PW, RAIL - (gy0 - y), PW],
      yaw,
    );
  }
}

type PFn = (i: number, u: number, off?: number) => V2;

/** Balkon ön kenarı yuvarlatma yarıçapları [başlangıç u0, bitiş u1] */
function roundOf(it: CBal): [number, number] {
  const r = it.round;
  if (Array.isArray(r)) return [Math.max(0, r[0] ?? 0), Math.max(0, r[1] ?? 0)];
  return [Math.max(0, r ?? 0), Math.max(0, r ?? 0)];
}

/** Kavisli / köşesi yuvarlatılmış balkon ön kenarında u noktasının duvardan uzaklığı (grow: dışa büyütme) */
export function frontOff(it: CBal, u: number, grow = 0): number {
  const uA = it.u0 - grow;
  const uB = it.u1 + grow;
  const W = Math.max(1e-3, uB - uA);
  // Ortak yay (arc): parabol ölçülen açıklıkta; yoksa öğenin kendi aralığında
  const cA = it.arc ? Math.min(it.arc[0], it.arc[1]) - grow : uA;
  const cB = it.arc ? Math.max(it.arc[0], it.arc[1]) + grow : uB;
  const s = (2 * (u - cA)) / Math.max(1e-3, cB - cA) - 1;
  let f = it.d + grow + (it.bulge ?? 0) * Math.max(0, 1 - s * s);
  const [r0, r1] = roundOf(it);
  const fil = (du: number, r: number) => (du < r ? r - Math.sqrt(Math.max(0, r * r - (r - du) ** 2)) : 0);
  if (r0 > 0) f -= fil(Math.max(0, u - uA), Math.min(r0, W / 2));
  if (r1 > 0) f -= fil(Math.max(0, uB - u), Math.min(r1, W / 2));
  // v7: 45° pah (chamfer): uçta c kadar kısalır, c boyunca doğrusal
  const [c0, c1] = chamOf(it);
  if (c0 > 0) f -= Math.max(0, Math.min(c0, W / 2) - Math.max(0, u - uA));
  if (c1 > 0) f -= Math.max(0, Math.min(c1, W / 2) - Math.max(0, uB - u));
  return Math.max(0, f);
}

/** Balkon serbest ön köşelerinde 45° pah boyları [u0 ucu, u1 ucu] */
function chamOf(it: CBal): [number, number] {
  const c = it.chamfer;
  if (Array.isArray(c)) return [Math.max(0, c[0] ?? 0), Math.max(0, c[1] ?? 0)];
  return [Math.max(0, c ?? 0), Math.max(0, c ?? 0)];
}

/** Kavisli balkon ön kenarı: u1 → u0 yönünde [u, uzaklık] noktaları (plan çokgeni için) */
export function balFront(it: CBal, grow = 0): [number, number][] {
  const uA = it.u0 - grow;
  const uB = it.u1 + grow;
  const W = uB - uA;
  const [r0, r1] = roundOf(it);
  const us = new Set<number>();
  const n = it.bulge ? Math.max(8, Math.min(32, Math.round(W / 0.25))) : 1;
  for (let k = 0; k <= n; k++) us.add(uA + (W * k) / n);
  // Yuvarlatılmış köşelerde sık örnekleme (çeyrek daire)
  for (const [r, from, dir] of [
    [Math.min(r0, W / 2), uA, 1],
    [Math.min(r1, W / 2), uB, -1],
  ] as [number, number, number][])
    if (r > 0.01)
      for (let k = 0; k <= 6; k++) us.add(from + dir * r * (1 - Math.cos((k / 6) * (Math.PI / 2))));
  // v7: pah köşe noktaları
  const [c0, c1] = chamOf(it);
  if (c0 > 0.01) us.add(uA + Math.min(c0, W / 2));
  if (c1 > 0.01) us.add(uB - Math.min(c1, W / 2));
  const pts = [...us].sort((a, b) => b - a).map((u) => [u, frontOff(it, u, grow)] as [number, number]);
  // Art arda çakışanları at
  return pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) > 1e-3);
}

interface RailSpec {
  type: string;
  fKey: string;
  mKey: string;
  parH: number;
  /** Korkuluk arkasında koyu file */
  net?: boolean;
  /** Korkuluk camı malzemesi */
  gKey?: string;
  /** Küpeşte yüksekliği (m, varsayılan RAIL = 0.92) */
  railH?: number;
  /** Sarkan kiriş: alın bandı döşemenin SLAB + drop altından başlar */
  drop?: number;
  /** Kavisli ön yüz (çok kısa parçalar): dikmeler çevre boyunca eşit aralıklı */
  curved?: boolean;
  /** Dolu parapet üstünde ince çelik küpeşte: parapet üstünden yükseklik (m) */
  hand?: number;
  /** Dikme aralığı / kesiti (m) */
  postEvery?: number;
  postW?: number;
  /** Döşeme alnı çizilmez (şapka üstü teras korkuluğu: yalnız korkuluk öğeleri) */
  flush?: boolean;
  /** Dolu parapet üstü harpuşta (yükseklik, iki yana taşma, malzeme) */
  copH?: number;
  copOver?: number;
  copK?: string;
  /** v9 (tube): küpeşte malzemesi (dikme / ara çubuklar mKey), ara çubuk sayısı ve aralığı (küpeşteden aşağı) */
  topKey?: string;
  rows?: number;
  rowGap?: number;
}

/**
 * Cam balkonun korkuluğa göre başladığı yükseklik ve içe çekilme: dolu parapetli (solidTube/solid) balkonlarda
 * cam parapet üstünden, küpeştenin ARKASINDAN başlar; boru/çubuk/tam cam korkulukta döşemeden; buzlu cam (glass)
 * korkulukta küpeşte üstünden (562/556/555 ve D1 yakın planları).
 */
function camGlassSpan(spec: RailSpec | undefined, y: number): { y0: number; inset: number } {
  const t = spec?.type ?? 'glass';
  if (t === 'solidTube') return { y0: y + (spec?.parH ?? PARAPET) + 0.02, inset: 0.13 };
  if (t === 'solid') return { y0: y + Math.max(spec?.parH ?? RAIL, 0.85) + 0.02, inset: 0.02 };
  if (t === 'tube' || t === 'bars' || t === 'glassFull') return { y0: y + 0.06, inset: 0.13 };
  if (t === 'none') return { y0: y + 0.06, inset: 0.02 };
  return { y0: y + RAIL + 0.03, inset: 0 };
}

/** "#rrggbb" → 6-6-6 bit renk kodu (gölgelendiricide aux ile çözülür) */
function code666(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const q = (x: number) => Math.round((x / 255) * 63);
  return (q((v >> 16) & 255) << 12) | (q((v >> 8) & 255) << 6) | q(v & 255);
}

/**
 * Cam balkon içi fon perde: aux.z = 1 + 6-6-6 bit renk kodu, aux.w = kapanma oranı (0..1).
 * Perde ölçülmemişse [0, 0] (gölgelendirici eski tül/boş görünüm).
 */
function curtAux(it: CBal, kk: string): [number, number] {
  const c = it.curtC?.[kk] ?? it.curtC?.['*'];
  if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return [0, 0];
  const f = it.curtF?.[kk] ?? it.curtF?.['*'] ?? 0.3;
  return [1 + code666(c), Math.max(0.02, Math.min(1, f))];
}

/** Pencere perdesi rengi / kapanma oranı → cam gölgelendiricisi aux kodlaması (seed, tür) */
function winCurtAux(win: CWin, k: number, seed: number, kind: number): [number, number] {
  const kk = String(k);
  const c = win.curtC?.[kk] ?? win.curtC?.['*'];
  const f = win.curtF?.[kk] ?? win.curtF?.['*'];
  let s = seed;
  let kd = kind;
  if (c && /^#[0-9a-f]{6}$/i.test(c)) {
    // Renk 6-6-6 bit: tür + 10·(kod + 1) — float32'de kesin (en çok ~2.6 M), düz (flat) aktarılır
    kd = kind + 10 * (code666(c) + 1);
  }
  if (f != null && Number.isFinite(f)) {
    // Kapanma oranı %5 adımlı, tohumla birlikte negatif kodlanır: −(1 + ⌊tohum⌋ + 100·oran·20)
    s = -(1 + Math.floor(seed) + 100 * Math.round(Math.max(0, Math.min(1, f)) * 20));
  }
  return [s, kd];
}

/**
 * Cam balkon / loca camının önünde demir parmaklık: kemerli (bölme başına yarım daire kemer + dikey çubuklar, ≈12 cm)
 * ya da düz çubuklu. p→q dış sıralı cam hattı; parmaklık 5 cm dışarıda, y0..y1 cam yüksekliği boyunca.
 */
function balGrille(
  b: Builder,
  p0: V2,
  q0: V2,
  y0: number,
  y1: number,
  kind: string,
  key: string,
  pw0: number,
  /** Cam hattından dışarı uzaklık (m; v7: negatif → camın arkasında) */
  out = 0.05,
): void {
  const L = Math.hypot(q0[0] - p0[0], q0[1] - p0[1]);
  if (L < 0.2 || y1 - y0 < 0.2) return;
  const nx = -(q0[1] - p0[1]) / L;
  const nz = (q0[0] - p0[0]) / L;
  const p: V2 = [p0[0] + nx * out, p0[1] + nz * out];
  const tx = (q0[0] - p0[0]) / L;
  const tz = (q0[1] - p0[1]) / L;
  const yaw = Math.atan2(-tz, tx);
  const at = (s: number): V2 => [p[0] + tx * s, p[1] + tz * s];
  const bar = (s: number, ya: number, yb: number, w = 0.018) => {
    if (yb - ya < 0.01) return;
    const c = at(s);
    b.box(key, [c[0], (ya + yb) / 2, c[1]], [w, yb - ya, w], yaw);
  };
  const rail = (s0: number, s1: number, yy: number, h = 0.03) => {
    const c = at((s0 + s1) / 2);
    b.box(key, [c[0], yy, c[1]], [s1 - s0, h, 0.03], yaw);
  };
  const np = Math.max(1, Math.round(L / Math.max(0.4, pw0)));
  const pw = L / np;
  rail(0, L, y0 + 0.03, 0.04);
  rail(0, L, y1 - 0.02, 0.04);
  for (let j = 0; j <= np; j++) bar(j * pw, y0, y1, 0.035);
  for (let j = 0; j < np; j++) {
    const s0 = j * pw;
    const r = Math.min(pw / 2, (y1 - y0) * 0.35);
    const ys = y1 - 0.04 - r; // kemer üzengi çizgisi
    const nb = Math.max(2, Math.round(pw / 0.12));
    for (let m = 1; m < nb; m++) {
      const s = s0 + (pw * m) / nb;
      const dx = s - (s0 + pw / 2);
      const top = kind === 'arched' ? ys + Math.sqrt(Math.max(0, r * r - dx * dx)) : y1 - 0.04;
      bar(s, y0 + 0.05, top);
    }
    if (kind === 'arched') {
      // Kemer: yarım daire çubuk + üzengi kuşağı
      const g = new THREE.TorusGeometry(r, 0.012, 4, 14, Math.PI);
      g.rotateY(yaw);
      const c = at(s0 + pw / 2);
      g.translate(c[0], ys, c[1]);
      b.geometry(key, g);
      rail(s0, s0 + pw, ys, 0.022);
    }
  }
  if (kind === 'ornamental') {
    // v7: süslü eski demir korkuluk: çubuklar + ortada kıvrımlı süs bandı (iki yüz)
    const e = at(L);
    const H = y1 - y0;
    b.wall('ironScroll', p, e, y0 + H * 0.3, y0 + H * 0.7, [0, 0, Math.max(1, Math.round(L / 0.9)), 1]);
    b.wall('ironScroll', e, p, y0 + H * 0.3, y0 + H * 0.7, [0, 0, Math.max(1, Math.round(L / 0.9)), 1]);
  }
}

/**
 * Tavan gömme armatürü: yuvarlak (çap d; önceki geometri aynen) ya da v7 dikdörtgen (shape rect, l × w, uzun kenar
 * cephe boyunca `yaw`) — tavan kotu y, aşağı bakar
 */
function downlight(
  b: Builder,
  c: V2,
  y: number,
  sp: { d?: number; shape?: string | null; l?: number; w?: number } | null | undefined,
  yaw: number,
): void {
  if (sp?.shape === 'rect') {
    const g = new THREE.PlaneGeometry(Math.max(0.05, sp.l ?? 0.25), Math.max(0.03, sp.w ?? 0.12))
      .rotateX(Math.PI / 2)
      .rotateY(yaw)
      .translate(c[0], y, c[1]);
    b.geometry('mkDownlight', g);
    return;
  }
  const g = new THREE.CircleGeometry(Math.max(0.03, (sp?.d ?? 0.1) / 2), 12)
    .rotateX(Math.PI / 2)
    .translate(c[0], y, c[1]);
  b.geometry('mkDownlight', g);
}

/** Bambu / hasır stor: p→q (dış sıralı) hattında, yb..yt arası ince çıtalı perde (iki yüz, doku 1 m) */
function balBlind(b: Builder, p: V2, q: V2, yb: number, yt: number, key: string, run: number): void {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (L < 0.1 || yt - yb < 0.1) return;
  b.wall(key, p, q, yb, yt, [run, yb, run + L, yt]);
  b.wall(key, q, p, yb, yt, [run + L, yb, run, yt]);
  // Üstte sarma borusu / kutu
  const m: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  b.box(key, [m[0], yt - 0.03, m[1]], [L, 0.06, 0.06], Math.atan2(-(q[1] - p[1]), q[0] - p[0]));
}

/** Duvarı açıklıkların etrafında yatay bantlara bölerek örer; UV metre (çevre boyunca sürekli) */
function wallWithOpenings(
  b: Builder,
  P: PFn,
  i: number,
  ua: number,
  ub: number,
  s0: number,
  Y0: number,
  Y1: number,
  ops0: Opening[],
  key = K('mkPlaster'),
): void {
  const ops = ops0.filter((o) => o.y1 > Y0 + 1e-4 && o.y0 < Y1 - 1e-4 && o.u1 > ua && o.u0 < ub);
  const ys = new Set<number>([Y0, Y1]);
  for (const o of ops) {
    ys.add(Math.max(Y0, Math.min(Y1, o.y0)));
    ys.add(Math.max(Y0, Math.min(Y1, o.y1)));
  }
  const yl = [...ys].sort((p, q) => p - q);
  for (let k = 0; k + 1 < yl.length; k++) {
    const ya = yl[k];
    const yb = yl[k + 1];
    if (yb - ya < 1e-4) continue;
    const cover = ops
      .filter((o) => o.y0 <= ya + 1e-4 && o.y1 >= yb - 1e-4)
      .map((o) => [Math.max(ua, o.u0), Math.min(ub, o.u1)] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    let cur = ua;
    const gaps: [number, number][] = [];
    for (const [a, e] of cover) {
      if (a > cur) gaps.push([cur, a]);
      cur = Math.max(cur, e);
    }
    if (cur < ub) gaps.push([cur, ub]);
    for (const [g0, g1] of gaps) {
      if (g1 - g0 < 1e-4) continue;
      b.wall(key, P(i, g0), P(i, g1), ya, yb, [s0 + g0, ya, s0 + g1, yb]);
    }
  }
  // v7: yuvarlak pencere deliği: dikdörtgen boşluğun köşeleri (dikdörtgen − elips) duvarla doldurulur
  for (const o of ops) {
    if (!shapedWin(o.win)) continue;
    const ra = Math.max(ua, o.u0);
    const rb = Math.min(ub, o.u1);
    const yA = Math.max(Y0, o.y0);
    const yB = Math.min(Y1, o.y1);
    if (rb - ra < 0.02 || yB - yA < 0.02) continue;
    const p0 = P(i, 0, 0);
    const p1 = P(i, 0, 1);
    cutFace(
      b,
      key,
      P,
      i,
      0,
      rectRing([ra, yA, rb, yB]),
      [opRing(o)],
      [p1[0] - p0[0], p1[1] - p0[1]],
      false,
      s0,
    );
  }
}

const KINDS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 3, 5, 5, 4];

/** Pencere/kapı: söve (içe 12 cm), mermer denizlik, beyaz PVC kasa + kayıtlar, oda gölgelendiricili cam */
function addWindow(b: Builder, P: PFn, E: Edge, i: number, op: Opening, seed: number): void {
  const { u0, u1, y0, y1, win } = op;
  if (shapedWin(win)) {
    // v7: yuvarlak pencere (oculus): elips söve, kasa, oda gölgelendiricili cam; split → düşey kayıtlar
    // v9: köşeleri yuvarlatılmış / kemerli açıklık aynı yoldan (dükkân / kapı perdesiz: vitrin camı); yatay kayıtlar
    const shopLike = win.kind === 'shop' || win.kind === 'door';
    polyWindow(b, P, E, i, opRing(op), seed + op.k * 7, {
      split: Math.max(1, Math.min(win.shape === 'round' ? 6 : 12, win.split || 1)),
      frameK: win.frameC ? ckm('frame', win.frameC, K('mkFrame')) : K('mkFrame'),
      curt: win.curt?.[String(op.k)] ?? (win.shape !== 'round' && shopLike ? 'vitrin' : null),
      hbars:
        win.shape !== 'round'
          ? (win.hbars ?? []).map((h) => (op.fy ?? op.y0 - Math.max(0.02, win.sill)) + h)
          : [],
    });
    return;
  }
  const W = u1 - u0;
  const Hh = y1 - y0;
  const V = (p: V2, y: number): V3 => [p[0], y, p[1]];
  const a0 = P(i, u0);
  const a1 = P(i, u1);
  const b0 = P(i, u0, -REVEAL);
  const b1 = P(i, u1, -REVEAL);
  // Ölçülmüş doğrama rengi (ör. bronz, antrasit, mavi) — yoksa blok paleti
  const FK = win.frameC ? ckm('frame', win.frameC, K('mkFrame')) : K('mkFrame');
  if (win.surround && win.surround.w > 0.01) {
    // Söve: açıklığın çevresinde duvardan taşan çerçeve (üst, iki yan; kapı değilse alt denizlik ayrıca)
    const sw = win.surround.w;
    const sd = Math.max(0.01, win.surround.d);
    const sk = ckm('plaster', win.surround.color ?? null, K('mkPlaster2'));
    const m0 = P(i, (u0 + u1) / 2, sd / 2);
    b.box(sk, [m0[0], y1 + sw / 2, m0[1]], [W + 2 * sw, sw, sd], E.yaw);
    for (const uu of [u0 - sw / 2, u1 + sw / 2]) {
      const q = P(i, uu, sd / 2);
      b.box(sk, [q[0], (y0 + y1) / 2, q[1]], [sw, Hh, sd], E.yaw);
    }
    if (win.kind !== 'door' && win.kind !== 'shop')
      b.box(sk, [m0[0], y0 - sw / 2, m0[1]], [W + 2 * sw, sw, sd], E.yaw);
  }
  // Söveler + lento + iç denizlik
  b.wall(K('mkReveal'), a0, b0, y0, y1, [0, y0, REVEAL, y1]);
  b.wall(K('mkReveal'), b1, a1, y0, y1, [0, y0, REVEAL, y1]);
  b.quad(K('mkReveal'), V(b0, y1), V(b1, y1), V(a1, y1), V(a0, y1), [0, 0, W, REVEAL]);
  b.quad('mkSill', V(a0, y0), V(a1, y0), V(b1, y0), V(b0, y0), [0, 0, W, REVEAL]);
  // Dış denizlik (kapı değilse)
  if (win.kind !== 'door') {
    const ps = P(i, (u0 + u1) / 2, 0.035);
    // Yüksek/Ultra: mermer denizliğin üst kenarları pahlı
    if (BEV > 0)
      b.bevelBox('mkSill', [ps[0], y0 - 0.015, ps[1]], [W + 0.08, 0.03, 0.07], E.yaw, Math.min(BEV, 0.01));
    else b.box('mkSill', [ps[0], y0 - 0.015, ps[1]], [W + 0.08, 0.03, 0.07], E.yaw);
  }
  // Kasa: dış çerçeve (4 kenar) + dikey kayıtlar + kapıda yatay orta kayıt
  const d = -REVEAL + 0.02;
  const bar = (uA: number, uB: number, yA: number, yB: number) => {
    const c = P(i, (uA + uB) / 2, d + 0.03);
    b.box(FK, [c[0], (yA + yB) / 2, c[1]], [uB - uA, yB - yA, 0.06], E.yaw);
  };
  const F = W < 0.8 ? 0.05 : FRAME;
  bar(u0, u1, y1 - F, y1);
  bar(u0, u1, y0, y0 + F);
  bar(u0, u0 + F, y0 + F, y1 - F);
  bar(u1 - F, u1, y0 + F, y1 - F);
  // Giydirme cephede ölçülen bölme sayısı (≤ 12) — önceden 4'e kırpılıyordu
  const split = Math.max(1, Math.min(12, win.split || 2));
  for (let s = 1; s < split; s++) {
    const u = u0 + (W * s) / split;
    bar(u - 0.035, u + 0.035, y0 + F, y1 - F);
  }
  // Kanat kasaları (her bölmede iç çerçeve, PVC profil ~5 cm) — pencereyi "beyaz çerçeveli" gösterir
  if (W > 0.5) {
    const sw = 0.045;
    for (let s = 0; s < split; s++) {
      const a = u0 + F + ((W - 2 * F) * s) / split + (s > 0 ? 0.035 : 0);
      const e = u0 + F + ((W - 2 * F) * (s + 1)) / split - (s < split - 1 ? 0.035 : 0);
      const c = (yA: number, yB: number, uA: number, uB: number) => {
        const q = P(i, (uA + uB) / 2, d + 0.045);
        b.box(FK, [q[0], (yA + yB) / 2, q[1]], [uB - uA, yB - yA, 0.03], E.yaw);
      };
      c(y1 - F - sw, y1 - F, a, e);
      c(y0 + F, y0 + F + sw, a, e);
      c(y0 + F + sw, y1 - F - sw, a, a + sw);
      c(y0 + F + sw, y1 - F - sw, e - sw, e);
    }
  }
  // Ölçülmüş yatay kayıtlar (giydirme cephe traversleri): kat döşemesinden yükseklik
  if (win.hbars?.length) {
    const fy = op.fy ?? y0 - Math.max(0.02, win.sill);
    for (const hb of win.hbars) {
      const yy = fy + hb;
      if (yy > y0 + F + 0.03 && yy < y1 - F - 0.03) bar(u0 + F, u1 - F, yy - 0.025, yy + 0.025);
    }
  }
  if (win.kind === 'door' || win.kind === 'french') {
    // Kapı/fransız pencere: ~0.9 m'de yatay kayıt (alt dolu/camlı bölme)
    const yt = y0 + Math.min(0.95, Hh * 0.42);
    if (win.kind === 'door') bar(u0 + F, u1 - F, yt - 0.03, yt + 0.03);
  } else if (Hh > 1.3 && W > 0.9) {
    // Vasistas: üstte ~0.4 m yatay kayıt (bazılarında)
    if (hash(seed + i * 3.7 + u0 * 1.3) < 0.35) bar(u0 + F, u1 - F, y1 - 0.45, y1 - 0.4);
  }
  // Cam (oda gölgelendiricisi): tek parça, kasanın arkasında
  const h = hash(seed * 1.7 + i * 17.3 + u0 * 5.1 + op.k * 11.9);
  const measured = win.curt?.[String(op.k)];
  const kind =
    measured != null
      ? (CURT[measured] ?? KINDS[Math.floor(h * KINDS.length)])
      : win.kind === 'small'
        ? 4
        : win.kind === 'shop' || (win.kind === 'door' && op.k === 0)
          ? // KARAR: zemin kat kapısı (dükkân / giriş) perdesiz koyu iç (vitrin); rastgele tül beyaz görünüyordu
            // (addax, Biaport kapıları — critic d4b / kod ajanı karşılaştırması). Üst kat balkon kapıları eskisi gibi.
            7
          : KINDS[Math.floor(h * KINDS.length)];
  const g0 = P(i, u0, d);
  const g1 = P(i, u1, d);
  if (win.tint)
    // Giydirme cephe / renkli cam: düz renkli yansıtıcı cam (oda gölgelendiricisi değil)
    b.quad(ckm('tint', win.tint, 'mkGlass'), V(g0, y0), V(g1, y0), V(g1, y1), V(g0, y1), [0, 0, 1, 1]);
  else {
    // Ölçülmüş perde rengi / kapanma oranı (curtC / curtF) aux'a kodlanır; yoksa eski değerler
    const [sd, kd] = winCurtAux(win, op.k, h * 100, kind);
    b.quad('mkGlass', V(g0, y0), V(g1, y0), V(g1, y1), V(g0, y1), [0, 0, 1, 1], [sd, kd, W, Hh]);
  }
  // v7: desenli dekor cam folyo (yaklaşık desen; UV metre → desen gerçek ölçekte tekrarlar)
  if (win.film?.color && /^#[0-9a-f]{6}$/i.test(win.film.color)) {
    const pat = win.film.pattern === 'damask' || win.film.pattern === 'dots' ? win.film.pattern : 'frost';
    const fk = ckm(`film:${pat}`, win.film.color, K('mkRailGlass'));
    b.wall(fk, P(i, u0, d + 0.004), P(i, u1, d + 0.004), y0, y1, [0, 0, W, Hh]);
  }
  // Dış panjur / dükkân kepengi (ölçüm: kat → kapanma oranı)
  const shut = win.shut?.[String(op.k)];
  if (shut && shut > 0.02) {
    // Kepenk perdesi: 5 cm lamel (v = y / 0.4), ölçülen renk; kutusu aynı malzemeden (ayrıca beyaz `box` çizilmez)
    const sk = ckm('shutter', win.shutC ?? null, 'mkShutter');
    const ys = y1 - Math.min(1, shut) * Hh;
    const s0 = P(i, u0, -0.01);
    const s1 = P(i, u1, -0.01);
    b.wall(sk, s0, s1, ys, y1, [0, ys / 0.4, W / 0.4, y1 / 0.4]);
    // Alt kenar profili (koyu)
    const mb = P(i, (u0 + u1) / 2, 0.005);
    b.box('darkMetal', [mb[0], ys + 0.02, mb[1]], [W, 0.04, 0.03], E.yaw);
    const m = P(i, (u0 + u1) / 2, 0.06);
    b.box(sk, [m[0], y1 + 0.1, m[1]], [W + 0.04, 0.2, 0.14], E.yaw, 0.1);
  }
  // Fransız pencere / kapı alt bölmesi (buzlu cam, lamel, dolu panel)
  if (win.lower && (win.kind === 'french' || win.kind === 'door')) {
    const yt = y0 + Math.min(0.95, Hh * 0.42);
    const lk =
      win.lower === 'frosted'
        ? ckm('fascia', win.lowerC ?? '#dfe5e3', K('mkRailGlass'))
        : ckm('fascia', win.lowerC ?? '#e8e8e4', K('mkFrame'));
    const l0 = P(i, u0 + 0.05, d + 0.01);
    const l1 = P(i, u1 - 0.05, d + 0.01);
    b.wall(lk, l0, l1, y0 + 0.05, yt, [0, 0, W, 1]);
    if (win.lower === 'louvre')
      for (let yy = y0 + 0.12; yy < yt - 0.03; yy += 0.09) {
        const m = P(i, (u0 + u1) / 2, d + 0.02);
        b.box(K('mkFrame'), [m[0], yy, m[1]], [W - 0.12, 0.02, 0.03], E.yaw);
      }
  }
  // Pencere önü demir parmaklık (ölçüm: kat → tip)
  const gr = win.grille?.[String(op.k)];
  if (gr) {
    const gk = ckm('metal', win.grilleC ?? '#1e1f21', 'darkMetal');
    const off = 0.05;
    const nb = Math.max(2, Math.round(W / 0.12));
    for (let k = 1; k < nb; k++) {
      const m = P(i, u0 + (W * k) / nb, off);
      b.box(gk, [m[0], (y0 + y1) / 2, m[1]], [0.016, Hh, 0.016], E.yaw);
    }
    const hs = gr === 'lattice' ? Math.max(2, Math.round(Hh / 0.15)) : 3;
    for (let k = 0; k <= hs; k++) {
      const m = P(i, (u0 + u1) / 2, off);
      b.box(gk, [m[0], y0 + (Hh * k) / hs, m[1]], [W, 0.022, 0.022], E.yaw);
    }
    if (gr === 'ornamental') {
      const a = P(i, u0, off + 0.005);
      const e = P(i, u1, off + 0.005);
      b.wall('ironScroll', a, e, y0 + Hh * 0.35, y0 + Hh * 0.62, [0, 0, Math.max(1, Math.round(W / 0.9)), 1]);
      b.wall('ironScroll', e, a, y0 + Hh * 0.35, y0 + Hh * 0.62, [0, 0, Math.max(1, Math.round(W / 0.9)), 1]);
    }
  }
  // Fransız balkon korkuluğu: yatay paslanmaz borular (dış yüzde)
  if (win.rail) {
    const yaw = E.yaw;
    const c = P(i, (u0 + u1) / 2, 0.04);
    for (const hh of [0.3, 0.55, 0.8, 0.95])
      b.box('mkRail', [c[0], y0 + hh, c[1]], [W + 0.04, 0.025, 0.025], yaw);
    for (const uu of [u0 + 0.03, u1 - 0.03]) {
      const pp = P(i, uu, 0.04);
      b.box('mkRail', [pp[0], y0 + 0.5, pp[1]], [0.03, 1.0, 0.03], yaw);
    }
  }
  if (win.box && !(shut && shut > 0.02)) {
    const c = P(i, (u0 + u1) / 2, 0.04);
    b.box(K('mkFrame'), [c[0], y1 + 0.1, c[1]], [W + 0.06, 0.2, 0.1], E.yaw);
  }
}

/**
 * Üçgen alınlık: ön yüz (iki taraflı), iki eğik üst yüz (d önünden depth kadar geriye; balkon yığını üstünde
 * kendi küçük çatısı), isteğe bağlı çevre silmesi (trim). Tepe `apex` kaydırılabilir (asimetrik alınlık).
 */
/** Alınlık geometrisi: taban kotu, yükseklik, tepe u'su */
function pedGeom(it: CPediment, base: number, wallTop: number): { yB: number; h: number; ax: number } {
  const yB = it.y != null ? base + it.y : wallTop;
  const h = it.h ?? (it.top != null ? base + it.top - yB : 1.2);
  return { yB, h, ax: Math.max(it.u0, Math.min(it.u1, it.apex)) };
}

/** Çatı arası penceresi üçgen alınlığın içinde mi (dört köşe üçgende, 3 cm pay) */
function inPediment(it: CPediment, base: number, wallTop: number, op: Opening): boolean {
  const { yB, h, ax } = pedGeom(it, base, wallTop);
  if (h < 0.05 || op.y0 < yB + 0.03) return false;
  const topAt = (u: number) =>
    u <= ax
      ? yB + (h * (u - it.u0)) / Math.max(1e-3, ax - it.u0)
      : yB + (h * (it.u1 - u)) / Math.max(1e-3, it.u1 - ax);
  return (
    op.u0 > it.u0 + 0.03 && op.u1 < it.u1 - 0.03 && op.y1 < topAt(op.u0) - 0.03 && op.y1 < topAt(op.u1) - 0.03
  );
}

/** Kemerli parapet / tonoz ön yüzü: taban, uçlarda düşey kısım, yay (u → üst kot) */
function archGeom(
  it: CArch,
  base: number,
  wallTop: number,
): {
  yB: number;
  ys: number;
  topAt: (u: number) => number;
  outline: [number, number][];
  ua: number;
  ub: number;
} | null {
  const c = it.u1 - it.u0;
  if (c < 0.3) return null;
  const yB = it.y != null ? base + it.y : wallTop;
  const ys = yB + Math.max(0, it.spring);
  const pointed = it.shape === 'pointed';
  const crown =
    it.rise != null
      ? yB + it.rise
      : it.top != null
        ? base + it.top
        : pointed
          ? ys + (c * Math.sqrt(3)) / 2
          : ys + c / 4;
  const um = (it.u0 + it.u1) / 2;
  // Yarım daire: yükseklik yarı açıklık; segmental: verilen tepe; v7 sivri (ogival / lancet): iki yay tepede birleşir
  const h = it.shape === 'semi' ? c / 2 : Math.max(0.05, crown - ys);
  let topAt: (u: number) => number;
  if (pointed) {
    // Her yay kendi başlangıç ucunun R ötesinde merkezli (üzengi çizgisinde): R = (c²/4 + h²) / c
    const R = (c * c) / 4 / c + (h * h) / c;
    topAt = (u: number) => {
      const cx = u <= um ? it.u0 + R : it.u1 - R;
      return ys + Math.sqrt(Math.max(0, R * R - (u - cx) * (u - cx)));
    };
  } else {
    const R = (c * c) / 4 / (2 * h) + h / 2;
    const yc = ys + h - R;
    topAt = (u: number) => yc + Math.sqrt(Math.max(0, R * R - (u - um) * (u - um)));
  }
  // v7: kısmi kemer (clip): yalnız bu u aralığı (kemer biçimi tüm açıklık üzerinden)
  const ua = it.clip ? Math.max(it.u0, Math.min(it.clip[0], it.clip[1])) : it.u0;
  const ub = it.clip ? Math.min(it.u1, Math.max(it.clip[0], it.clip[1])) : it.u1;
  if (ub - ua < 0.1) return null;
  const n0 = Math.max(8, Math.min(40, Math.round(c / 0.3)));
  // Sivri kemerde tepe noktası örneklensin (çift parça sayısı)
  const n = pointed && n0 % 2 ? n0 + 1 : n0;
  const outline: [number, number][] = [
    [ua, yB],
    [ub, yB],
  ];
  if (!it.clip) {
    if (ys > yB + 1e-3) outline.push([it.u1, ys]);
    for (let k = 1; k < n; k++) {
      const u = it.u1 - (c * k) / n;
      outline.push([u, topAt(u)]);
    }
    if (ys > yB + 1e-3) outline.push([it.u0, ys]);
  } else {
    // Kırpılmış: uçlarda düşey kenar, arada yay örnekleri (tepe noktası dahil)
    const us = new Set<number>([ub, ua]);
    for (let k = 1; k < n; k++) {
      const u = it.u1 - (c * k) / n;
      if (u > ua + 1e-3 && u < ub - 1e-3) us.add(u);
    }
    if (pointed && um > ua && um < ub) us.add(um);
    for (const u of [...us].sort((p, q) => q - p)) {
      const y = u <= it.u0 + 1e-6 || u >= it.u1 - 1e-6 ? ys : topAt(u);
      outline.push([u, y]);
    }
  }
  return { yB, ys, topAt, outline, ua, ub };
}

function inArch(it: CArch, base: number, wallTop: number, op: Opening): boolean {
  const g = archGeom(it, base, wallTop);
  if (!g || op.y0 < g.yB + 0.03) return false;
  return (
    op.u0 > g.ua + 0.03 &&
    op.u1 < g.ub - 0.03 &&
    op.y1 < g.topAt(op.u0) - 0.03 &&
    op.y1 < g.topAt(op.u1) - 0.03
  );
}

/** v9: dikdörtgen olmayan açıklık (yuvarlak / köşeleri yuvarlatılmış / kemerli): çokgen delik + köşe dolgusu */
function shapedWin(w: CWin): boolean {
  return w.shape === 'round' || (w.shape === 'rounded' && (w.radius ?? 0) > 0.01) || w.shape === 'arch';
}

/** Açıklık deliği (u, y) halkası: dikdörtgen ya da v7 yuvarlak pencere elipsi, v9 yuvarlatılmış köşe / kemer */
function opRing(op: Opening): [number, number][] {
  if (op.win.shape === 'rounded' && (op.win.radius ?? 0) > 0.01) {
    const W = op.u1 - op.u0;
    const H = op.y1 - op.y0;
    const cs = op.win.corners?.length ? op.win.corners : ['tl', 'tr', 'bl', 'br'];
    // Aynı kenarda iki köşe yuvarlanıyorsa yarıçap yarım boyla, tek köşede tam boyla sınırlı
    const both = (a: string, e: string) => cs.includes(a) && cs.includes(e);
    const r = Math.min(
      op.win.radius!,
      both('tl', 'tr') || both('bl', 'br') ? W / 2 : W,
      both('tl', 'bl') || both('tr', 'br') ? H / 2 : H,
    );
    const out: [number, number][] = [];
    // Saat yönü tersine: sol alt → sağ alt → sağ üst → sol üst; köşe başına 8 parça yay
    const corner = (c: string, cu: number, cy: number, a0: number) => {
      if (!cs.includes(c)) {
        out.push([
          cu + Math.cos(a0 + Math.PI / 4) * Math.SQRT2 * r,
          cy + Math.sin(a0 + Math.PI / 4) * Math.SQRT2 * r,
        ]);
        return;
      }
      for (let q = 0; q <= 8; q++) {
        const t = a0 + (q / 8) * (Math.PI / 2);
        out.push([cu + Math.cos(t) * r, cy + Math.sin(t) * r]);
      }
    };
    corner('bl', op.u0 + r, op.y0 + r, Math.PI);
    corner('br', op.u1 - r, op.y0 + r, -Math.PI / 2);
    corner('tr', op.u1 - r, op.y1 - r, 0);
    corner('tl', op.u0 + r, op.y1 - r, Math.PI / 2);
    return out;
  }
  if (op.win.shape === 'arch') {
    const fy = op.fy ?? op.y0 - Math.max(0.02, op.win.sill);
    return archRing(
      op.u0,
      op.u1,
      op.y0,
      op.y1,
      op.win.spring != null ? fy + op.win.spring : null,
      op.win.apex ?? null,
    );
  }
  if (op.win.shape === 'round') {
    const cu = (op.u0 + op.u1) / 2;
    const cy = (op.y0 + op.y1) / 2;
    const ru = (op.u1 - op.u0) / 2;
    const ry = (op.y1 - op.y0) / 2;
    return Array.from({ length: 24 }, (_, q) => {
      const t = (q / 24) * Math.PI * 2;
      return [cu + Math.cos(t) * ru, cy + Math.sin(t) * ry] as [number, number];
    });
  }
  return [
    [op.u0, op.y0],
    [op.u1, op.y0],
    [op.u1, op.y1],
    [op.u0, op.y1],
  ];
}

/**
 * v9: kemerli açıklık halkası (u, y): taban y0, tepe y1 (apex u'sunda; verilmezse ortada), üzengi `spring` (mutlak
 * kot; verilmezse yarım daire: tepe − yarım genişlik). İki yarı ayrı çeyrek elips (asimetrik kemer).
 */
export function archRing(
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  spring: number | null,
  apex: number | null,
): [number, number][] {
  const W = u1 - u0;
  const ax = Math.max(u0 + 0.05, Math.min(u1 - 0.05, apex ?? (u0 + u1) / 2));
  const sp = Math.max(y0 + 0.05, Math.min(y1 - 0.02, spring ?? y1 - W / 2));
  const out: [number, number][] = [
    [u0, y0],
    [u1, y0],
  ];
  const rise = y1 - sp;
  const NQ = 12;
  for (let q = 0; q <= NQ; q++) {
    const t = (q / NQ) * (Math.PI / 2);
    out.push([ax + (u1 - ax) * Math.cos(t), sp + rise * Math.sin(t)]);
  }
  for (let q = 1; q <= NQ; q++) {
    const t = Math.PI / 2 + (q / NQ) * (Math.PI / 2);
    out.push([ax + (ax - u0) * Math.cos(t), sp + rise * Math.sin(t)]);
  }
  return out;
}

/** [u0, y0, u1, y1] → (u, y) dikdörtgen halkası */
function rectRing([u0, y0, u1, y1]: [number, number, number, number]): [number, number][] {
  return [
    [u0, y0],
    [u1, y0],
    [u1, y1],
    [u0, y1],
  ];
}

/**
 * v7: düzlemsel yüzden delikleri çokgen farkıyla çıkar (delik dış halkayı aşabilir: girinti ağzı kemer / alınlık
 * yüzünü tabandan keser); kalan parçalar planarFace ile.
 */
function cutFace(
  b: Builder,
  key: string,
  P: PFn,
  i: number,
  off: number,
  outline: [number, number][],
  holes: [number, number][][],
  n: V2,
  twoSided: boolean,
  s0 = 0,
): void {
  try {
    const mp = pc.difference([outline] as pcNs.Polygon, ...holes.map((h) => [h] as pcNs.Polygon));
    for (const poly of mp) planarFace(b, key, P, i, off, poly as [number, number][][], n, s0, 0, twoSided);
  } catch {
    planarFace(b, key, P, i, off, [outline], n, s0, 0, twoSided);
  }
}

/**
 * Düzlemsel yüz (cephe düzleminde, off kadar önde): (u, y) halkaları (ilki dış, diğerleri delik) üçgenlenir,
 * ön yüz dış normale (n) bakar. twoSided: arka yüz de. UV: çevre boyunca sürekli metre (s0 + u, y − base).
 */
function planarFace(
  b: Builder,
  key: string,
  P: PFn,
  i: number,
  off: number,
  rings: [number, number][][],
  n: V2,
  s0: number,
  base: number,
  twoSided = false,
): void {
  const rs = rings.map((r) => openRing(r)).filter((r) => r.length >= 3);
  if (!rs.length || Math.abs(area2(rs[0])) < 1e-4) return;
  const tris = THREE.ShapeUtils.triangulateShape(
    rs[0].map((p) => new THREE.Vector2(p[0], p[1])),
    rs.slice(1).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))),
  );
  if (!tris.length) return;
  const all = rs.flat();
  const pos: number[] = [];
  const uv: number[] = [];
  for (const [u, y] of all) {
    const p = P(i, u, off);
    pos.push(p[0], y, p[1]);
    uv.push(s0 + u, y - base);
  }
  const idx: number[] = [];
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  // Yön: ilk üçgenin normali dış normale bakmıyorsa çevir
  const v = (k: number) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  const [a, e, c] = [v(idx[0]), v(idx[1]), v(idx[2])];
  const ux = e[0] - a[0];
  const uy = e[1] - a[1];
  const uz = e[2] - a[2];
  const wx = c[0] - a[0];
  const wy = c[1] - a[1];
  const wz = c[2] - a[2];
  const nx = uy * wz - uz * wy;
  const nz = ux * wy - uy * wx;
  if (nx * n[0] + nz * n[1] < 0)
    for (let q = 0; q < idx.length; q += 3) [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
  const emit = (ix: number[], sign: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const nrm: number[] = [];
    for (let k = 0; k < all.length; k++) nrm.push(n[0] * sign, 0, n[1] * sign);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setIndex(ix);
    b.geometry(key, g);
  };
  emit(idx, 1);
  if (twoSided) {
    const back: number[] = [];
    for (let q = 0; q < idx.length; q += 3) back.push(idx[q], idx[q + 2], idx[q + 1]);
    emit(back, -1);
  }
}

function pediment(
  b: Builder,
  P: PFn,
  E: Edge,
  i: number,
  it: CPediment,
  base: number,
  wallTop: number,
  key: string,
  roofKey: (c: string | null | undefined) => string,
  ops: Opening[] = [],
  /** v7: ön yüzü kesen girinti ağızları [u0, y0, u1, y1] (çatı arası teras locası) */
  extra: [number, number, number, number][] = [],
): number {
  const { yB, h, ax } = pedGeom(it, base, wallTop);
  const off = Math.max(0, it.d) + 0.01;
  if (h < 0.05 || it.u1 - it.u0 < 0.2) return off;
  const depth = it.depth ?? Math.max(0.6, it.d + 0.4);
  const V = (u: number, y: number, o: number): V3 => {
    const p = P(i, u, o);
    return [p[0], y, p[1]];
  };
  const A = V(it.u0, yB, off);
  const B = V(it.u1, yB, off);
  const C = V(ax, yB + h, off);
  const tri: [number, number][] = [
    [it.u0, yB],
    [it.u1, yB],
    [ax, yB + h],
  ];
  const ex = extra.filter(([u0, y0, u1, y1]) => u1 > it.u0 && u0 < it.u1 && y1 > yB && y0 < yB + h);
  if (ex.length) {
    // Girinti ağzı (ve pencereler) ön yüzden çıkarılır; kalan parçalar iki yüzlü
    cutFace(b, key, P, i, off, tri, [...ops.map(opRing), ...ex.map(rectRing)], E.n, true);
  } else if (!ops.length) {
    b.quad(key, A, B, C, C, [it.u0, yB, it.u1, yB + h]);
    b.quad(key, B, A, C, C, [it.u0, yB, it.u1, yB + h]);
  } else {
    // Çatı arası pencereli alınlık: ön yüz delikli üçgen (iki yüz)
    const holes = ops.map(opRing);
    planarFace(b, key, P, i, off, [tri, ...holes], E.n, 0, 0, true);
  }
  // Eğik üst yüzler (iki taraflı): ön kenardan geriye
  const rk = roofKey(it.roofC);
  const back = off - depth;
  for (const [u0, y0, u1, y1] of [
    [it.u0, yB, ax, yB + h],
    [ax, yB + h, it.u1, yB],
  ]) {
    const p0 = V(u0, y0 + 0.01, off);
    const p1 = V(u1, y1 + 0.01, off);
    const q0 = V(u0, y0 + 0.01, back);
    const q1 = V(u1, y1 + 0.01, back);
    const L = Math.hypot(u1 - u0, y1 - y0);
    b.quad(rk, q0, q1, p1, p0, [0, 0, L, depth]);
    b.quad(rk, p0, p1, q1, q0, [0, 0, L, depth]);
  }
  // Çevre silmesi: eğik kenarlar + taban (koyu damlalık / açık gri çerçeve)
  if (it.trim) {
    const tw = it.trim.w ?? 0.1;
    const td = it.trim.d ?? 0.05;
    const tk = ckm('plaster', it.trim.color ?? null, key);
    const seg = (u0: number, y0: number, u1: number, y1: number, up: number, side = 0) => {
      const L = Math.hypot(u1 - u0, y1 - y0);
      const g = new THREE.BoxGeometry(L + tw, tw, td + 0.02);
      g.rotateZ(Math.atan2(y1 - y0, u1 - u0));
      const um = (u0 + u1) / 2 + side;
      const ym = (y0 + y1) / 2 + up;
      g.rotateY(E.yaw);
      const c = P(i, um, off + td / 2);
      g.translate(c[0], ym, c[1]);
      b.geometry(tk, g);
    };
    const nL = Math.hypot(ax - it.u0, h) || 1;
    const nR = Math.hypot(it.u1 - ax, h) || 1;
    // Silme kenarın üstünde (dış normal yönünde yarım genişlik kaydırılır)
    seg(it.u0, yB, ax, yB + h, ((ax - it.u0) / nL) * (tw / 2), -(h / nL) * (tw / 2));
    seg(ax, yB + h, it.u1, yB, ((it.u1 - ax) / nR) * (tw / 2), (h / nR) * (tw / 2));
    // Taban silmesi (base: false → yalnız eğik kenarlar; ör. alınlık tabanında çizgi yok)
    if (it.trim.base !== false) seg(it.u0, yB + tw / 2, it.u1, yB + tw / 2, 0);
  }
  return off;
}

/**
 * Kemerli parapet / tonoz ön yüzü (`arch`): delikli ön yüz (çatı arası pencereleri), arka yüz, yay boyunca üst yüz
 * (tonozda `vault` m geriye uzanan eğri çatı + arka alın), uç yüzler, harpuşta bandı. Ön yüz ofsetini döndürür.
 */
function archFront(
  b: Builder,
  P: PFn,
  E: Edge,
  i: number,
  it: CArch,
  base: number,
  wallTop: number,
  key: string,
  roofK: string,
  copK: string,
  ops: Opening[],
  /** v7: ön yüzü kesen girinti ağızları [u0, y0, u1, y1] (tonoza kadar açık girinti, kemer yüzüne oyulmuş loca) */
  extra: [number, number, number, number][] = [],
): number {
  const off = Math.max(0, it.d) + 0.01;
  const g = archGeom(it, base, wallTop);
  if (!g) return off;
  const holes = ops.map(opRing);
  const ex = extra.filter(([u0, , u1, y1]) => u1 > g.ua && u0 < g.ub && y1 > g.yB + 0.02);
  // Ön yüz (dışa), arka yüz (içe)
  if (ex.length) cutFace(b, key, P, i, off, g.outline, [...holes, ...ex.map(rectRing)], E.n, false);
  else planarFace(b, key, P, i, off, [g.outline, ...holes], E.n, 0, 0);
  const vault = Math.max(0, it.vault);
  const back = vault > 0.05 ? vault : Math.max(0.05, it.thick);
  const nb: V2 = [-E.n[0], -E.n[1]];
  // v7: backFace false → arka uçta kendi kemer öğesi var (tonozun kuzey alnı), arka yüz çizilmez
  if (it.backFace !== false) planarFace(b, key, P, i, off - back, [g.outline], nb, 0, 0);
  // Üst yüz: yay boyunca (u1 → u0) ön → arka şeritler (tonozda çatı malzemesi)
  const sp = g.ys > g.yB + 1e-3;
  const clipped = !!it.clip;
  const pts: [number, number][] = clipped
    ? g.outline.slice(2)
    : [[it.u1, g.ys], ...g.outline.slice(sp ? 3 : 2, sp ? -1 : undefined), [it.u0, g.ys]];
  const topK = vault > 0.05 ? roofK : key;
  let s = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ua, ya] = pts[k];
    const [ue, ye] = pts[k + 1];
    const L = Math.hypot(ue - ua, ye - ya);
    const fa = P(i, ua, off);
    const fe = P(i, ue, off);
    const ba = P(i, ua, off - back);
    const be = P(i, ue, off - back);
    // Yukarı / dışa bakan yüz (pts u1 → u0 sırası)
    b.quad(topK, xz(fa, ya), xz(ba, ya), xz(be, ye), xz(fe, ye), [s, 0, s + L, back]);
    // v7: tonoz alt yüzü (girinti ağzından görünür): aynı şerit ters yönde, biraz aşağıda
    if (ex.length && vault > 0.05)
      b.quad(roofK, xz(fe, ye - 0.02), xz(be, ye - 0.02), xz(ba, ya - 0.02), xz(fa, ya - 0.02), [
        s + L,
        0,
        s,
        back,
      ]);
    s += L;
  }
  // Uç yüzler (düşey kısım); kırpılmış kemerde kırpma uçlarında kemer yüksekliğine kadar
  const ends: [number, number, number][] = clipped
    ? [
        [g.ua, -1, g.outline[g.outline.length - 1][1]],
        [g.ub, 1, g.outline[2][1]],
      ]
    : sp
      ? [
          [it.u0, -1, g.ys],
          [it.u1, 1, g.ys],
        ]
      : [];
  for (const [u, sg, yt] of ends) {
    if (yt < g.yB + 1e-3) continue;
    const a = P(i, u, off);
    const e = P(i, u, off - back);
    if (sg > 0) b.wall(key, a, e, g.yB, yt);
    else b.wall(key, e, a, g.yB, yt);
  }
  // Harpuşta: ön kenarda yayı izleyen bant (kalınlık + iki yana taşma)
  const cp = it.coping;
  if (cp && cp.h > 0.01) {
    const ov = cp.over ?? 0.03;
    const dep = vault > 0.05 ? 0.12 + ov : back + 2 * ov;
    const cOff = vault > 0.05 ? off - 0.06 : off - back / 2;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ua, ya] = pts[k];
      const [ue, ye] = pts[k + 1];
      const L = Math.hypot(ue - ua, ye - ya);
      const gg = new THREE.BoxGeometry(L + 0.01, cp.h, dep);
      gg.rotateZ(Math.atan2(ye - ya, ue - ua));
      gg.rotateY(E.yaw);
      const c = P(i, (ua + ue) / 2, cOff);
      gg.translate(c[0], (ya + ye) / 2 + cp.h / 2, c[1]);
      b.geometry(copK, gg);
    }
  }
  return off;
}

/**
 * v7: çokgen pencere (beşgen dormer penceresi): söve derinliğinde oda gölgelendiricili cam (sınır kutusu UV'si),
 * kenarlar boyunca kasa, `split` düşey kayıt (çokgene kırpılmış). ring: (u, y) cephe düzleminde.
 */
function polyWindow(
  b: Builder,
  P: PFn,
  E: Edge,
  i: number,
  ring: [number, number][],
  seed: number,
  o: { split: number; frameK: string; curt: string | null; hbars?: number[] },
): void {
  const u0 = Math.min(...ring.map((p) => p[0]));
  const u1 = Math.max(...ring.map((p) => p[0]));
  const y0 = Math.min(...ring.map((p) => p[1]));
  const y1 = Math.max(...ring.map((p) => p[1]));
  const W = u1 - u0;
  const Hh = y1 - y0;
  if (W < 0.1 || Hh < 0.1) return;
  const d = -REVEAL + 0.02;
  // Söve (dış halka → içe REVEAL)
  for (let k = 0; k < ring.length; k++) {
    const [ua, ya] = ring[k];
    const [ub, yb] = ring[(k + 1) % ring.length];
    const a0 = P(i, ua, 0);
    const a1 = P(i, ub, 0);
    const b0 = P(i, ua, -REVEAL);
    const b1 = P(i, ub, -REVEAL);
    b.quad(K('mkReveal'), xz(a1, yb), xz(a0, ya), xz(b0, ya), xz(b1, yb));
  }
  // Cam: üçgenlenmiş çokgen, uv = sınır kutusunda 0..1, aux [tohum, tür, en, boy]
  const tris = THREE.ShapeUtils.triangulateShape(
    ring.map((p) => new THREE.Vector2(p[0], p[1])),
    [],
  );
  const pos: number[] = [];
  const uv: number[] = [];
  for (const [u, y] of ring) {
    const p = P(i, u, d);
    pos.push(p[0], y, p[1]);
    uv.push((u - u0) / W, (y - y0) / Hh);
  }
  const idx: number[] = [];
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.attributes.normal.getX(0) * E.n[0] + g.attributes.normal.getZ(0) * E.n[1] < 0) {
    for (let q = 0; q < idx.length; q += 3) [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  const h = hash(seed * 1.7 + i * 17.3 + u0 * 5.1);
  const kind = o.curt != null ? (CURT[o.curt] ?? 0) : KINDS[Math.floor(h * KINDS.length)];
  // Builder.geometry aux taşımaz: cam dörtgen yerine üçgen üçgen quad (dejenere dördüncü köşe) ile aux'lu
  for (let q = 0; q < idx.length; q += 3) {
    const v = [idx[q], idx[q + 1], idx[q + 2]];
    const V = (n: number): V3 => [pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]];
    b.quadUV(
      'mkGlass',
      [V(v[0]), V(v[1]), V(v[2]), V(v[2])],
      [
        [uv[v[0] * 2], uv[v[0] * 2 + 1]],
        [uv[v[1] * 2], uv[v[1] * 2 + 1]],
        [uv[v[2] * 2], uv[v[2] * 2 + 1]],
        [uv[v[2] * 2], uv[v[2] * 2 + 1]],
      ],
      [h * 100, kind, W, Hh],
    );
  }
  g.dispose();
  // Kasa: kenarlar boyunca çubuk
  const F = 0.06;
  for (let k = 0; k < ring.length; k++) {
    const [ua, ya] = ring[k];
    const [ub, yb] = ring[(k + 1) % ring.length];
    const L = Math.hypot(ub - ua, yb - ya);
    const bg = new THREE.BoxGeometry(L + F, F, 0.06);
    bg.rotateZ(Math.atan2(yb - ya, ub - ua));
    bg.rotateY(E.yaw);
    const c = P(i, (ua + ub) / 2, d + 0.03);
    bg.translate(c[0], (ya + yb) / 2, c[1]);
    b.geometry(o.frameK, bg);
  }
  // Düşey kayıtlar: alttan çokgen üst kenarına
  for (let sI = 1; sI < o.split; sI++) {
    const u = u0 + (W * sI) / o.split;
    let top = -Infinity;
    let bot = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const [ua, ya] = ring[k];
      const [ub, yb] = ring[(k + 1) % ring.length];
      if ((u - ua) * (u - ub) > 0 || Math.abs(ub - ua) < 1e-6) continue;
      const yy = ya + ((yb - ya) * (u - ua)) / (ub - ua);
      top = Math.max(top, yy);
      bot = Math.min(bot, yy);
    }
    // Dışbükey halkada kiriş: alt uç (düz tabanlı beşgende y0) ile üst uç arası
    if (!Number.isFinite(top) || !Number.isFinite(bot)) continue;
    bot = Math.max(bot, y0);
    if (top - bot < 0.1) continue;
    const c = P(i, u, d + 0.03);
    b.box(o.frameK, [c[0], (bot + top) / 2, c[1]], [0.05, top - bot, 0.06], E.yaw);
  }
  // v9: yatay kayıtlar (mutlak kot): çokgenin o kottaki kirişi boyunca
  for (const hy of o.hbars ?? []) {
    if (hy <= y0 + 0.05 || hy >= y1 - 0.05) continue;
    let ul = Infinity;
    let ur = -Infinity;
    for (let k = 0; k < ring.length; k++) {
      const [ua, ya] = ring[k];
      const [ub, yb] = ring[(k + 1) % ring.length];
      if ((hy - ya) * (hy - yb) > 0 || Math.abs(yb - ya) < 1e-6) continue;
      const uu = ua + ((ub - ua) * (hy - ya)) / (yb - ya);
      ul = Math.min(ul, uu);
      ur = Math.max(ur, uu);
    }
    if (!(ur - ul > 0.1)) continue;
    const c = P(i, (ul + ur) / 2, d + 0.03);
    b.box(o.frameK, [c[0], hy, c[1]], [ur - ul, 0.05, 0.06], E.yaw);
  }
}

/**
 * Çatı penceresi (dormer / gablet): kenarın çatı yüzünde, duvardan `setback` geride. Ön yüz (beşgen ya da üçgen,
 * pencere boşluklu), iki yanak, küçük beşik çatı (mahya ana çatıya dik, ana çatı yüzüne kadar uzanır), rüzgârlık
 * tahtaları, pencere (söve + kasa + cam). Ana çatı yüzü `roofH` ile örneklenir (kırma / teras çatıda da oturur).
 */
function dormer(
  b: Builder,
  P: PFn,
  E: Edge,
  i: number,
  it: CDormer,
  c: {
    roofH: (p: V2) => number | null;
    wallTop: number;
    eave: number;
    wallK: string;
    roofK: string;
    trimK: string;
    seed: number;
  },
): void {
  const w = it.u1 - it.u0;
  if (w < 0.4) return;
  const um = (it.u0 + it.u1) / 2;
  const s = Math.max(0, it.setback);
  const yF = c.roofH(P(i, um, -s));
  const y2 = c.roofH(P(i, um, -s - 0.5));
  if (yF == null || y2 == null) return;
  const tanM = (y2 - yF) / 0.5;
  // Düz çatıda (eğimsiz) dormer yok
  if (!(tanM > 0.08)) return;
  const apex = it.ridge != null ? c.wallTop + it.ridge : yF + (it.h ?? 1.2);
  if (apex < yF + 0.3) return;
  const half = w / 2;
  const dp = Math.tan((Math.max(15, Math.min(70, it.pitch)) * Math.PI) / 180);
  let ye = it.wallH != null ? yF + Math.max(0, it.wallH) : apex - half * dp;
  if (ye < yF + 0.02) ye = yF;
  ye = Math.min(ye, apex - 0.1);
  const k = (apex - ye) / half;
  const Le = (ye - yF) / tanM;
  const Lr = (apex - yF) / tanM;
  // Mahya ana çatı yüzüne ulaşmalı (ana mahyanın üstüne taşan dormer çizilmez)
  const yBack = c.roofH(P(i, um, -s - Lr));
  if (yBack == null || yBack < apex - 0.3) return;
  const ov = 0.1;
  const ovF = 0.12;
  const W = (du: number, db: number, y: number): V3 => {
    const p = P(i, um + du, -s - db);
    return [p[0], y, p[1]];
  };
  const Pd: PFn = (ii, u, off = 0) => P(ii, u, off - s);
  // Pencere (ön yüzde ortalı): ölçülmüş en/boy/denizlik, eğime sığacak kadar
  const wn = it.win;
  const ww = Math.min(w - 0.3, wn?.w ?? Math.min(1.0, w * 0.5));
  const topAt = (du: number) => ye + (apex - ye) * Math.max(0, 1 - Math.abs(du) / half);
  const wy0 = yF + Math.max(0.1, wn?.sill ?? 0.25);
  const wy1 = Math.min(wy0 + (wn?.h ?? 1.0), topAt(ww / 2) - 0.08);
  // v7: alınlık biçimli (beşgen) pencere: düşey yanlar + üstü dormer eğimine paralel (alınlığın çoğunu kaplar)
  const gableWin = wn?.shape === 'gable';
  const kS = (apex - ye) / half;
  const mG = 0.1;
  const ySide = apex - mG - kS * (ww / 2);
  const hasWin = gableWin ? ww > 0.25 && ySide - wy0 > 0.1 : ww > 0.25 && wy1 - wy0 > 0.3;
  const outline: [number, number][] =
    ye > yF + 1e-3
      ? [
          [um - half, yF],
          [um + half, yF],
          [um + half, ye],
          [um, apex],
          [um - half, ye],
        ]
      : [
          [um - half, yF],
          [um + half, yF],
          [um, apex],
        ];
  const pent: [number, number][] = [
    [um - ww / 2, wy0],
    [um + ww / 2, wy0],
    [um + ww / 2, ySide],
    [um, apex - mG],
    [um - ww / 2, ySide],
  ];
  const holes: [number, number][][] = hasWin
    ? [
        gableWin
          ? pent
          : [
              [um - ww / 2, wy0],
              [um + ww / 2, wy0],
              [um + ww / 2, wy1],
              [um - ww / 2, wy1],
            ],
      ]
    : [];
  planarFace(b, c.wallK, Pd, i, 0, [outline, ...holes], E.n, 0, 0);
  if (hasWin && gableWin)
    polyWindow(b, Pd, E, i, pent, c.seed, {
      split: Math.max(1, Math.min(6, wn?.split ?? 3)),
      frameK: wn?.frameC ? ckm('frame', wn.frameC, K('mkFrame')) : K('mkFrame'),
      curt: wn?.curt ?? null,
    });
  else if (hasWin) {
    const win: CWin = {
      t: 'win',
      u0: um - ww / 2,
      u1: um + ww / 2,
      sill: 0,
      head: 0,
      storeys: [99],
      kind: 'std',
      rail: false,
      split: Math.max(1, Math.min(4, wn?.split ?? 2)),
      box: false,
      ...(wn?.curt ? { curt: { '99': wn.curt } } : {}),
      ...(wn?.frameC ? { frameC: wn.frameC } : {}),
    };
    addWindow(b, Pd, E, i, { u0: win.u0, u1: win.u1, y0: wy0, y1: wy1, win, k: 99 }, c.seed);
  }
  // Yanaklar (düşey üçgen): ön alt köşe, ön saçak köşesi, ana çatıya değdiği arka saçak noktası
  if (ye > yF + 0.02) {
    b.quad(c.wallK, W(half, 0, yF), W(half, Le, ye), W(half, 0, ye), W(half, 0, ye));
    b.quad(c.wallK, W(-half, 0, yF), W(-half, 0, ye), W(-half, Le, ye), W(-half, Le, ye));
  }
  // Beşik çatı (iki yüz; ön ve yanlarda taşmalı)
  const yeO = ye - ov * k;
  const LeO = Math.max(0, (yeO - yF) / tanM);
  const FA = W(0, -ovF, apex + 0.02);
  const BA = W(0, Lr, apex + 0.02);
  const FE = W(half + ov, -ovF, yeO + 0.02);
  const BE = W(half + ov, LeO, yeO + 0.02);
  const FEL = W(-half - ov, -ovF, yeO + 0.02);
  const BEL = W(-half - ov, LeO, yeO + 0.02);
  const rl = Math.hypot(half + ov, apex - yeO);
  b.quad(c.roofK, FE, BE, BA, FA, [0, 0, Lr / 1.5, rl / 1.5]);
  b.quad(c.roofK, FEL, FA, BA, BEL, [0, 0, rl / 1.5, Lr / 1.5]);
  // Rüzgârlık tahtaları (ön eğik kenarlar)
  for (const sg of [1, -1]) {
    const du0 = sg * (half + ov);
    const len = Math.hypot(half + ov, apex - yeO);
    // v7: rüzgârlık bant genişliği ölçülen trim.w (önceden sabit 0.12)
    const g = new THREE.BoxGeometry(len + 0.04, Math.max(0.04, it.trim?.w ?? 0.12), 0.04);
    g.rotateZ(Math.atan2(apex - yeO, -du0));
    g.rotateY(E.yaw);
    const cc = P(i, um + du0 / 2, -s + ovF + 0.02);
    g.translate(cc[0], (apex + yeO) / 2 - 0.02, cc[1]);
    b.geometry(c.trimK, g);
  }
}

/**
 * Çatı üstü öğe (baca, TV anteni, çanak, havalandırma borusu): kenarın çatı yüzünde, duvardan `setback` geride;
 * taban çatı yüzeyinden (roofH), gövde çatıya 0.4 m gömülü. Baca başlığı: hip / pyramid (kiremit), flat, none.
 */
function roofObject(
  b: Builder,
  P: PFn,
  E: Edge,
  i: number,
  it: CRoofObj,
  roofH: (p: V2) => number | null,
  k: {
    wallK: string;
    tileK: string;
    capK: (c: string | null | undefined) => string;
    metalK: string;
    /** Gece yanan lamba malzemesi (ölçülen renk) */
    lampK: (c: string) => string;
  },
): void {
  const p = P(i, it.u, -Math.max(0, it.setback));
  const yR = roofH(p);
  if (yR == null) return;
  const yaw = E.yaw;
  if (it.kind === 'antenna') {
    // TV anteni: direk + üstte yatay kol ve kısa elemanlar
    b.cylinder(k.metalK, [p[0], yR - 0.2, p[1]], 0.025, it.h + 0.2, 6);
    const yt = yR + it.h - 0.1;
    b.box(k.metalK, [p[0], yt, p[1]], [0.04, 0.03, 1.0], yaw);
    for (let j = 0; j < 5; j++) {
      const c = P(i, it.u, -it.setback - 0.4 + j * 0.2);
      b.box(k.metalK, [c[0], yt, c[1]], [0.5 - j * 0.05, 0.015, 0.015], yaw);
    }
    return;
  }
  if (it.kind === 'dish') {
    b.cylinder(k.metalK, [p[0], yR - 0.2, p[1]], 0.03, it.h + 0.2, 6);
    const r = Math.max(0.2, it.w / 2);
    const dish = new THREE.SphereGeometry(r, 14, 4, 0, Math.PI * 2, 0, 0.55);
    dish.scale(1, 0.42, 1);
    // Türksat 42°D → güney-güneydoğu, ~40° yukarı (cephe çanaklarıyla aynı)
    dish.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-0.293, -0.643, -0.708).normalize(),
      ),
    );
    dish.translate(p[0], yR + it.h, p[1]);
    b.geometry(it.color ? k.metalK : 'mkDish', dish);
    return;
  }
  if (it.kind === 'vent') {
    b.cylinder(k.metalK, [p[0], yR - 0.3, p[1]], Math.max(0.03, it.w / 2), it.h + 0.3, 10);
    // v7: baca şapkası koyu disk (cap.kind disc, çap d, kalınlık h, renk) — yoksa ince metal halka
    if (it.cap?.kind === 'disc') {
      const dd = Math.max(0.1, it.cap.d ?? it.w * 2);
      const hh = Math.max(0.02, it.cap.h ?? 0.06);
      b.cylinder(k.capK(it.cap.color ?? '#242c34'), [p[0], yR + it.h, p[1]], dd / 2, hh, 16);
      b.polygon(
        k.capK(it.cap.color ?? '#242c34'),
        Array.from({ length: 16 }, (_, q) => {
          const t = (-q / 16) * Math.PI * 2;
          return [p[0] + (Math.cos(t) * dd) / 2, p[1] + (Math.sin(t) * dd) / 2] as V2;
        }),
        yR + it.h + hh,
        true,
      );
    } else b.cylinder(k.metalK, [p[0], yR + it.h, p[1]], Math.max(0.05, it.w / 2 + 0.05), 0.04, 10);
    return;
  }
  if (it.kind === 'post') {
    // v7: çatı terası direği (ince boru) + tepede küre lamba (lit → gece yanar) ya da kare levha
    const pr = Math.max(0.015, (it.w || 0.05) / 2);
    b.cylinder(k.metalK, [p[0], yR - 0.1, p[1]], pr, it.h + 0.1, 8);
    const tp = it.top;
    if (tp?.kind === 'ball') {
      const d = Math.max(0.05, tp.d ?? 0.3);
      b.sphere(
        tp.lit ? k.lampK(tp.color ?? '#d8321f') : k.capK(tp.color ?? '#d8321f'),
        [p[0], yR + it.h + d / 2, p[1]],
        d / 2,
        12,
      );
    } else if (tp?.kind === 'plate') {
      const d = Math.max(0.05, tp.d ?? 0.2);
      b.box(k.capK(tp.color ?? '#2a2c2e'), [p[0], yR + it.h + d / 2, p[1]], [d, d, 0.02], yaw);
    }
    return;
  }
  // Baca: sıvalı gövde + başlık
  b.box(k.wallK, [p[0], yR + (it.h - 0.4) / 2, p[1]], [it.w, it.h + 0.4, it.d], yaw);
  const cp = it.cap;
  const ch = Math.max(0.05, cp?.h ?? 0.3);
  if (!cp || cp.kind === 'none') return;
  const ck2 = k.capK(cp.color ?? 'tile');
  // v7: başlığın alt (saçak) kenarında ikinci renk bant (ör. kiremit başlığın beyaz alt kenarı)
  const tr = cp.trim;
  if (tr && tr.h > 0.005)
    b.box(
      k.capK(tr.color ?? '#f2f2f0'),
      [p[0], yR + it.h + tr.h / 2, p[1]],
      [it.w + 0.12, tr.h, it.d + 0.12],
      yaw,
    );
  if (cp.kind === 'flat') {
    b.box(ck2, [p[0], yR + it.h + 0.04, p[1]], [it.w + 0.1, 0.08, it.d + 0.1], yaw);
    return;
  }
  // Kırma / piramit kiremit başlık (dört yüz), gövdeden 5 cm taşar
  // Yarı kenarı 0.5 olan kare piramit, gövde ölçüsüne (+5 cm taşma) ölçeklenir
  const g = new THREE.ConeGeometry(Math.SQRT1_2, ch, 4);
  g.rotateY(Math.PI / 4);
  g.scale(it.w + 0.1, 1, it.d + 0.1);
  g.rotateY(yaw);
  g.translate(p[0], yR + it.h + ch / 2, p[1]);
  b.geometry(ck2, g);
}

/** Duvar apliki / lamba: silindir, fener, spot, küre, kutu (+ gece yanan cam/uç), kat aralığında tekrarlanabilir */
function wallLamp(
  b: Builder,
  P0: PFn,
  E0: Edge,
  i: number,
  it: CLamp,
  base: number,
  floorY: (k: number) => number,
  recDepthAt: (i: number, u: number, y: number) => number,
): void {
  const ys = it.storeys?.length
    ? it.storeys.map((k) => floorY(k) + (it.yRel ?? 2.3))
    : [base + (it.y ?? 2.3)];
  const dark = it.style === 'lantern' || it.style === 'spot';
  const bodyK = ckm('frame', it.color ?? (dark ? '#1c1d1e' : '#f2f2f0'), dark ? 'darkMetal' : 'mkAc');
  const glowK =
    it.tip && /^#[0-9a-f]{6}$/i.test(it.tip) && it.tip.toLowerCase() !== '#ffffff'
      ? ckm('frame', it.tip, 'wallLamp')
      : 'wallLamp';
  const r = Math.max(0.02, it.d / 2);
  const h = Math.max(0.05, it.h);
  for (const u0 of it.us) {
    // v7: payenin yan yüzünde: yüz cepheye dik (start → −t, end → +t yönüne bakar), lamba cepheden off kadar önde
    let P = P0;
    let E = E0;
    let u = u0;
    if (it.side === 'start' || it.side === 'end') {
      const sg = it.side === 'end' ? 1 : -1;
      const a = P0(i, u0, 0);
      const n: V2 = [E0.t[0] * sg, E0.t[1] * sg];
      // Yan yüz boyunca "u": cephe normali yönünde (dışarı)
      const t: V2 = [E0.n[0], E0.n[1]];
      E = { a, e: a, len: 1, t, n: [n[0], n[1]], yaw: Math.atan2(-t[1], t[0]), s0: 0 };
      // wall(a→e) dış normali (−t_z, t_x) = n olmalı: t yönünü buna göre çevir
      if (-t[1] * n[0] + t[0] * n[1] < 0) E = { ...E, t: [-t[0], -t[1]], yaw: Math.atan2(t[1], -t[0]) };
      const Ee = E;
      P = (_ii, uu, off = 0) => [a[0] + Ee.t[0] * uu + Ee.n[0] * off, a[1] + Ee.t[1] * uu + Ee.n[1] * off];
      u = Math.max(0.05, it.off ?? 0.3) * (Ee.t[0] * E0.n[0] + Ee.t[1] * E0.n[1] > 0 ? 1 : -1);
    }
    const yaw = E.yaw;
    for (const y of ys) {
      const w0 = it.side ? 0 : -recDepthAt(i, u0, y);
      // v7: kol boyu (arm) verilirse baş kolun ucunda; kol duvardan başa uzanır
      const pr = Math.max(r + 0.01, it.proud, it.arm ?? 0);
      const c = P(i, u, w0 + pr);
      // Duvar konsolu
      const bc = P(i, u, w0 + pr / 2);
      if (it.style === 'lantern') {
        // Klasik fener: kol, koyu çerçeveli camlı gövde, piramit başlık
        b.box(bodyK, [bc[0], y + h / 2 + 0.06, bc[1]], [0.035, 0.035, pr], yaw);
        b.box(glowK, [c[0], y, c[1]], [r * 1.7, h * 0.8, r * 1.7], yaw);
        for (const yy of [y - h * 0.42, y + h * 0.42])
          b.box(bodyK, [c[0], yy, c[1]], [r * 2, h * 0.08, r * 2], yaw);
        const cone = new THREE.ConeGeometry(r * 1.45, h * 0.3, 4);
        cone.rotateY(Math.PI / 4 + yaw);
        cone.translate(c[0], y + h * 0.46 + h * 0.15, c[1]);
        b.geometry(bodyK, cone);
      } else if (it.style === 'globe') {
        b.box(bodyK, [bc[0], y - r, bc[1]], [0.03, 0.03, pr], yaw);
        b.sphere(glowK, [c[0], y, c[1]], r, 10);
      } else if (it.style === 'box') {
        const cb = P(i, u, w0 + 0.03);
        b.box(bodyK, [cb[0], y, cb[1]], [it.d, h, 0.06], yaw);
        const fa = P(i, u - it.d / 2 + 0.02, w0 + 0.062);
        const fe = P(i, u + it.d / 2 - 0.02, w0 + 0.062);
        b.wall(glowK, fa, fe, y - h / 2 + 0.02, y + h / 2 - 0.02);
      } else if (it.style === 'spot') {
        // Kollu spot: duvardan çıkan kol + eğik silindir başlık; v7: dir up → yukarı-dışa (tabelaya bakan), tilt açısı
        b.box(bodyK, [bc[0], y, bc[1]], [0.03, 0.03, pr], yaw);
        const up = it.dir === 'up';
        const tl = ((it.tilt ?? 45) * Math.PI) / 180;
        const g = new THREE.CylinderGeometry(r, r * 0.8, h, 10);
        // Silindir ekseni +y; aşağı-dışa: X etrafında −tilt (üst uç duvara); yukarı-dışa: π − tilt
        g.rotateX(up ? Math.PI - tl : -tl);
        g.rotateY(yaw);
        g.translate(c[0], y + (up ? h * 0.25 : -h * 0.25), c[1]);
        b.geometry(bodyK, g);
        // Işık ucu (gece yanar)
        const d = new THREE.CircleGeometry(r * 0.75, 10);
        d.rotateX(up ? -Math.PI / 2 + (Math.PI / 2 - tl) : Math.PI / 2 - (Math.PI / 2 - tl));
        d.rotateY(yaw);
        const tip = P(i, u, w0 + pr + Math.sin(tl) * h * 0.5);
        d.translate(tip[0], y + (up ? 1 : -1) * (h * 0.25 + Math.cos(tl) * h * 0.5), tip[1]);
        if (it.tilt != null || up) b.geometry(glowK, d);
        else d.dispose();
      } else {
        // Silindir aplik (varsayılan): düşey gövde, uçlarda ışık (aşağı / yukarı / iki yön); v7 tilt: gövde eğik
        b.box(bodyK, [bc[0], y, bc[1]], [Math.min(0.06, r), Math.min(0.06, h * 0.5), pr], yaw);
        const tl = it.tilt ? (it.tilt * Math.PI) / 180 : 0;
        const g = new THREE.CylinderGeometry(r, r, h, 12);
        if (tl) g.rotateX(-tl);
        if (tl) g.rotateY(yaw);
        g.translate(c[0], y, c[1]);
        b.geometry(bodyK, g);
        const ends = it.dir === 'up' ? [1] : it.dir === 'both' ? [1, -1] : [-1];
        for (const sg of ends) {
          const d = new THREE.CircleGeometry(r * 0.8, 12).rotateX(sg > 0 ? -Math.PI / 2 : Math.PI / 2);
          if (tl) {
            d.translate(0, (sg * h) / 2 + sg * 0.002, 0);
            d.rotateX(-tl);
            d.rotateY(yaw);
            d.translate(c[0], y, c[1]);
          } else d.translate(c[0], y + (sg * h) / 2 + sg * 0.002, c[1]);
          b.geometry(glowK, d);
        }
      }
    }
  }
}

/**
 * Tonoz çatı (hacim üstü): eksen kenarı doğrultusunda (verilmezse en uzun kenar) yönlü sınır kutusu, dar yönde
 * dairesel kesit (yükseklik rise ≤ yarı açıklık); eğri yüzey + iki uçta kemer biçimli alın duvarı.
 */
function vaultRoof(
  b: Builder,
  poly: V2[],
  y: number,
  rise: number,
  axis: number | null,
  roofK: string,
  endK: string,
  x: {
    ribs?: { every: number; w?: number | null; h?: number | null; key: string } | null;
    endGlass?: { ends: string; glassK: string; frameK: string; mullion: number; band: number } | null;
  } = {},
): (p: V2) => number | null {
  const L = poly.length;
  let ax = axis != null && axis >= 0 && axis < L ? axis : 0;
  if (axis == null) {
    let best = -1;
    for (let j = 0; j < L; j++) {
      const a = poly[j];
      const e = poly[(j + 1) % L];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (len > best) {
        best = len;
        ax = j;
      }
    }
  }
  const a = poly[ax];
  const e = poly[(ax + 1) % L];
  const la = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
  const t: V2 = [(e[0] - a[0]) / la, (e[1] - a[1]) / la];
  const n: V2 = [-t[1], t[0]];
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of poly) {
    const u = p[0] * t[0] + p[1] * t[1];
    const v = p[0] * n[0] + p[1] * n[1];
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const c = v1 - v0;
  if (c < 0.3 || u1 - u0 < 0.3) return () => null;
  const h = Math.max(0.05, Math.min(rise, c / 2));
  const R = (c * c) / 4 / (2 * h) + h / 2;
  const vc = (v0 + v1) / 2;
  const yc = y + h - R;
  const M = 16;
  const arcY = (v: number) => yc + Math.sqrt(Math.max(0, R * R - (v - vc) * (v - vc)));
  const prof: [number, number][] = [];
  for (let k = 0; k <= M; k++) {
    const v = v0 + (c * k) / M;
    prof.push([v, arcY(v)]);
  }
  const W = (u: number, v: number, yy: number): V3 => [t[0] * u + n[0] * v, yy, t[1] * u + n[1] * v];
  let s = 0;
  for (let k = 0; k < M; k++) {
    const [va, ya] = prof[k];
    const [vb, yb] = prof[k + 1];
    const Ls = Math.hypot(vb - va, yb - ya);
    b.quad(roofK, W(u1, va, ya), W(u0, va, ya), W(u0, vb, yb), W(u1, vb, yb), [
      0,
      s,
      (u1 - u0) / 1.5,
      s + Ls / 1.5,
    ]);
    s += Ls / 1.5;
  }
  // Alın duvarları (kemer biçimli): u0 ucunda −t, u1 ucunda +t yönüne bakar; v7 camlı alın: cam + düşey dikmeler +
  // yay altında dolu bant
  const eg = x.endGlass;
  for (const [ue, sg] of [
    [u0, -1],
    [u1, 1],
  ] as const) {
    const glazed =
      !!eg && (eg.ends === 'both' || (eg.ends === 'start' && sg < 0) || (eg.ends === 'end' && sg > 0));
    const face = (pts: [number, number][], key: string, off: number) => {
      const tris = THREE.ShapeUtils.triangulateShape(
        pts.map((p) => new THREE.Vector2(p[0], p[1])),
        [],
      );
      const pos: number[] = [];
      for (const [v, yy] of pts) pos.push(...W(ue + off * sg, v, yy));
      const idx: number[] = [];
      for (const tr of tris) idx.push(tr[0], tr[1], tr[2]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          pts.flatMap(([v, yy]) => [v, yy]),
          2,
        ),
      );
      g.setIndex(idx);
      g.computeVertexNormals();
      const nr = g.attributes.normal;
      if ((nr.getX(0) * t[0] + nr.getZ(0) * t[1]) * sg < 0) {
        for (let q = 0; q < idx.length; q += 3) [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]];
        g.setIndex(idx);
        g.computeVertexNormals();
      }
      b.geometry(key, g);
    };
    if (!glazed || !eg) {
      face([...prof], endK, 0);
      continue;
    }
    // Cam alın (yay altı bant hariç) + bant (dolu, gableC) + dikmeler
    const bd = Math.min(h * 0.6, eg.band);
    const inner: [number, number][] = prof.map(([v, yy]) => [v, Math.max(y, yy - bd)]);
    face(inner, eg.glassK, 0);
    if (bd > 0.01) {
      const ring: [number, number][] = [...prof, ...[...inner].reverse().slice(1, -1)];
      face(ring, endK, 0);
    }
    const nm = Math.max(1, Math.round(c / eg.mullion));
    for (let k = 1; k < nm; k++) {
      const v = v0 + (c * k) / nm;
      const top = Math.max(y, arcY(v) - bd);
      if (top - y < 0.05) continue;
      const p = W(ue + 0.03 * sg, v, 0);
      b.box(eg.frameK, [p[0], (y + top) / 2, p[2]], [0.05, top - y, 0.05], Math.atan2(-t[1], t[0]));
    }
  }
  // v7: kaburgalar: yayı izleyen ince şeritler (`every` m arayla, uçlardan yarım aralık içeride)
  const rb = x.ribs;
  if (rb && rb.every > 0.2) {
    const rw = Math.max(0.02, rb.w ?? 0.06);
    const rh = Math.max(0.01, rb.h ?? 0.04);
    const nr = Math.max(1, Math.round((u1 - u0) / rb.every));
    for (let q = 0; q < nr; q++) {
      const u = u0 + ((u1 - u0) * (q + 0.5)) / nr;
      for (let k = 0; k < M; k++) {
        const [va, ya] = prof[k];
        const [vb, yb] = prof[k + 1];
        // Yüzey normali (yay merkezinden dışa) yönünde rh kadar kalkık şerit (üst + iki yan)
        const na = [(va - vc) / R, (ya - yc) / R];
        const nb = [(vb - vc) / R, (yb - yc) / R];
        const A0 = W(u - rw / 2, va + na[0] * rh, ya + na[1] * rh);
        const A1 = W(u + rw / 2, va + na[0] * rh, ya + na[1] * rh);
        const B0 = W(u - rw / 2, vb + nb[0] * rh, yb + nb[1] * rh);
        const B1 = W(u + rw / 2, vb + nb[0] * rh, yb + nb[1] * rh);
        b.quad(rb.key, A1, A0, B0, B1);
        b.quad(rb.key, W(u - rw / 2, va, ya), W(u - rw / 2, vb, yb), B0, A0);
        b.quad(rb.key, W(u + rw / 2, vb, yb), W(u + rw / 2, va, ya), A1, B1);
      }
    }
  }
  // Tonoz yüzeyi yüksekliği (hacim çatısı öğeleri için)
  return (p: V2) => {
    const u = p[0] * t[0] + p[1] * t[1];
    const v = p[0] * n[0] + p[1] * n[1];
    if (u < u0 - 1e-3 || u > u1 + 1e-3 || v < v0 - 1e-3 || v > v1 + 1e-3) return null;
    return arcY(v);
  };
}

/** İki dünya noktası arasında dikdörtgen kesitli kiriş (w genişlik, h yükseklik; üst yüz yukarı) */
function beam3(b: Builder, key: string, A: V3, B: V3, w: number, h: number): void {
  const d = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  const L = d.length();
  if (L < 0.01) return;
  const xA = d.clone().normalize();
  // Sağ el tabanı: z = Y × x (yatay), y = z × x (kesit düşeyi; simetrik kutu → işaret önemsiz, yansıma yok)
  const zA = new THREE.Vector3(0, 1, 0).cross(xA);
  if (zA.lengthSq() < 1e-6) zA.set(0, 0, 1);
  zA.normalize();
  const yA = new THREE.Vector3().crossVectors(zA, xA).normalize();
  const g = new THREE.BoxGeometry(L, h, w);
  const m = new THREE.Matrix4().makeBasis(xA, yA, zA);
  m.setPosition((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
  g.applyMatrix4(m);
  b.geometry(key, g);
}

/** Pergola: dikdörtgen (ya da çokgen) taban; köşelerde ve uzun kenarlarda `every` arayla dikme, üstte çevre kirişi,
 * en uzun kenara dik lameller (`slat` aralık), `cover` renkliyse üstte örtü (bez / polikarbon). v7: eğim (y1s),
 * lamel yönü (slatEdge), kenar başına dikmeler (postEdges / posts), dikmelerden uzanan taşmalı kirişler (beams) */
function pergola(
  b: Builder,
  pg: CPergola,
  base: number,
  key: string,
  ck: (kind: CK, hex: string | null | undefined, dflt: string) => string,
): void {
  const pl = pg.poly.map((p) => [p[0], p[1]] as V2);
  if (pl.length < 3) return;
  const v7 = pg.y1s != null || pg.slatEdge != null || !!pg.postEdges || !!pg.posts?.length || !!pg.beams;
  if (v7) {
    pergolaV7(b, pg, pl, base, key, ck);
    return;
  }
  const y0 = base + pg.y0;
  const y1 = base + pg.y1;
  const pw = pg.post ?? 0.1;
  const bh = pg.beam ?? 0.14;
  const every = Math.max(0.8, pg.every ?? 2.7);
  // Dikmeler + çevre kirişleri
  let longest = 0;
  let ax: V2 = [1, 0];
  for (let j = 0; j < pl.length; j++) {
    const a = pl[j];
    const e = pl[(j + 1) % pl.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 0.05) continue;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const yaw = Math.atan2(-t[1], t[0]);
    if (L > longest) {
      longest = L;
      ax = t;
    }
    const n = Math.max(1, Math.round(L / every));
    for (let k = 0; k < n; k++) {
      const p: V2 = [a[0] + (t[0] * L * k) / n, a[1] + (t[1] * L * k) / n];
      b.box(key, [p[0], (y0 + y1 - bh) / 2, p[1]], [pw, y1 - bh - y0, pw], yaw);
    }
    b.box(key, [(a[0] + e[0]) / 2, y1 - bh / 2, (a[1] + e[1]) / 2], [L + pw, bh, pw], yaw);
  }
  // Lameller: en uzun kenar boyunca `slat` arayla, ona dik (çokgen sınır kutusunda, kenar içinde kırpılmadan)
  const nx: V2 = [-ax[1], ax[0]];
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of pl) {
    const u = p[0] * ax[0] + p[1] * ax[1];
    const v = p[0] * nx[0] + p[1] * nx[1];
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const W = (u: number, v: number): V2 => [ax[0] * u + nx[0] * v, ax[1] * u + nx[1] * v];
  const yawS = Math.atan2(-nx[1], nx[0]);
  const sp = Math.max(0.15, pg.slat ?? 0.5);
  for (let u = u0 + sp / 2; u < u1; u += sp) {
    const c = W(u, (v0 + v1) / 2);
    b.box(key, [c[0], y1 + 0.03, c[1]], [v1 - v0 + 0.3, 0.06, 0.05], yawS);
  }
  if (pg.cover) {
    const ck2 = ck('awning', pg.cover, key);
    b.polygon(ck2, pl, y1 + 0.07, true, 0.5);
    b.polygon(ck2, pl, y1 + 0.065, false, 0.5);
  }
}

/** v7: sokak planı pergolası (streetFurniture.ts) için dışa açık pergola çizimi (y0/y1 `base`e göre) */
export function buildPergola(
  b: Builder,
  pg: CPergola,
  base: number,
  key: string,
  ck: (kind: CK, hex: string | null | undefined, dflt: string) => string,
): void {
  pergola(b, pg, base, key, ck);
}

/** v7 pergola: eğimli üst düzlem, kırpılmış lameller, seçili kenarlarda dikmeler, taşmalı kirişler */
function pergolaV7(
  b: Builder,
  pg: CPergola,
  pl: V2[],
  base: number,
  key: string,
  ck: (kind: CK, hex: string | null | undefined, dflt: string) => string,
): void {
  const L = pl.length;
  const y0 = base + pg.y0;
  const pw = pg.post ?? 0.1;
  const bh = pg.beam ?? 0.14;
  const every = Math.max(0.8, pg.every ?? 2.7);
  const edge = (j: number) => {
    const a = pl[((j % L) + L) % L];
    const e = pl[(((j + 1) % L) + L) % L];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
    return { a, e, len, t: [(e[0] - a[0]) / len, (e[1] - a[1]) / len] as V2 };
  };
  // Üst kot: slopeEdge kenar doğrusunda y1, en uzak noktada y1s (doğrusal)
  const se = edge(pg.slopeEdge ?? 0);
  const sn: V2 = [-se.t[1], se.t[0]];
  const dOf = (p: V2) => Math.abs((p[0] - se.a[0]) * sn[0] + (p[1] - se.a[1]) * sn[1]);
  const dMax = Math.max(1e-3, ...pl.map(dOf));
  const y1 = base + pg.y1;
  const y1s = pg.y1s != null ? base + pg.y1s : y1;
  const top = (p: V2) => y1 + ((y1s - y1) * dOf(p)) / dMax;
  const V = (p: V2, dy = 0): V3 => [p[0], top(p) + dy, p[1]];
  // Dikmeler
  const posts: V2[] = [];
  if (pg.posts?.length) posts.push(...pg.posts.map((p) => [p[0], p[1]] as V2));
  else
    for (let j = 0; j < L; j++) {
      if (pg.postEdges && !pg.postEdges.includes(j)) continue;
      const { a, len, t } = edge(j);
      const n = Math.max(1, Math.round(len / every));
      // Kenar başı + ara dikmeler; kenar sonu (sonraki kenar seçili değilse) ayrıca
      for (let k = 0; k < n; k++) posts.push([a[0] + (t[0] * len * k) / n, a[1] + (t[1] * len * k) / n]);
      if (pg.postEdges && !pg.postEdges.includes((j + 1) % L)) posts.push(edge(j).e);
    }
  for (const p of posts) {
    const yt = top(p) - bh;
    if (yt - y0 < 0.1) continue;
    b.box(key, [p[0], (y0 + yt) / 2, p[1]], [pw, yt - y0, pw], 0);
  }
  // Çevre kirişleri (eğimi izler)
  for (let j = 0; j < L; j++) {
    const { a, e } = edge(j);
    beam3(b, key, V(a, -bh / 2), V(e, -bh / 2), pw, bh);
  }
  // Taşmalı kirişler: seçili kenara dik, o kenardaki her dikmeden çokgenin karşı kenarına + dışa `over`
  const bm = pg.beams;
  if (bm) {
    const be = edge(bm.edge);
    const bn: V2 = [-be.t[1], be.t[0]];
    // İç yön: çokgen merkezine doğru
    const cx = pl.reduce((s, p) => s + p[0], 0) / L;
    const cz = pl.reduce((s, p) => s + p[1], 0) / L;
    const inw = (cx - be.a[0]) * bn[0] + (cz - be.a[1]) * bn[1] > 0 ? 1 : -1;
    const dir: V2 = [bn[0] * inw, bn[1] * inw];
    const over = Math.max(0, bm.over ?? 0.3);
    const capK = bm.capC ? ck('plaster', bm.capC, key) : key;
    const onEdge = posts.filter((p) => Math.abs((p[0] - be.a[0]) * bn[0] + (p[1] - be.a[1]) * bn[1]) < 0.15);
    for (const p of onEdge) {
      const segs = clipLine(p, dir, pl);
      const far = segs.length ? Math.max(...segs.map((s) => s[1])) : 0;
      if (far < 0.2) continue;
      const A: V2 = [p[0] - dir[0] * over, p[1] - dir[1] * over];
      const B: V2 = [p[0] + dir[0] * far, p[1] + dir[1] * far];
      const yA = top(p) + ((top(p) - top(B)) * over) / Math.max(0.01, far);
      beam3(b, key, [A[0], yA + bh / 2 - 0.02, A[1]], V(B, bh / 2 - 0.02), pw * 0.9, bh);
      if (over > 0.05) {
        const q: V2 = [A[0] - dir[0] * 0.01, A[1] - dir[1] * 0.01];
        b.box(
          capK,
          [q[0], yA + bh / 2 - 0.02, q[1]],
          [pw * 1.05, bh * 1.05, 0.03],
          Math.atan2(-dir[1], dir[0]) + Math.PI / 2,
        );
      }
    }
  }
  // Lameller: slatEdge kenarına paralel (verilmezse en uzun kenara dik), çokgene kırpılmış, eğimi izler
  let sd: V2;
  if (pg.slatEdge != null) sd = edge(pg.slatEdge).t;
  else {
    let longest = 0;
    let ax: V2 = [1, 0];
    for (let j = 0; j < L; j++) {
      const { len, t } = edge(j);
      if (len > longest) {
        longest = len;
        ax = t;
      }
    }
    sd = [-ax[1], ax[0]];
  }
  const sp = Math.max(0.15, pg.slat ?? 0.5);
  const nrm: V2 = [-sd[1], sd[0]];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pl) {
    const v = p[0] * nrm[0] + p[1] * nrm[1];
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let v = lo + sp / 2; v < hi; v += sp) {
    const o0: V2 = [nrm[0] * v, nrm[1] * v];
    for (const [ta, tb] of clipLine(o0, sd, pl)) {
      if (tb - ta < 0.1) continue;
      const A: V2 = [o0[0] + sd[0] * ta, o0[1] + sd[1] * ta];
      const B: V2 = [o0[0] + sd[0] * tb, o0[1] + sd[1] * tb];
      beam3(b, key, V(A, 0.03), V(B, 0.03), 0.05, 0.06);
    }
  }
  if (pg.cover) {
    // Örtü: üst düzlem (eğimli) — iki yüz
    const ck2 = ck('awning', pg.cover, key);
    const tris = THREE.ShapeUtils.triangulateShape(
      pl.map((p) => new THREE.Vector2(p[0], p[1])),
      [],
    );
    for (const sg of [1, -1]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          pl.flatMap((p) => [p[0], top(p) + (sg > 0 ? 0.07 : 0.065), p[1]]),
          3,
        ),
      );
      g.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          pl.flatMap((p) => [p[0] * 0.5, p[1] * 0.5]),
          2,
        ),
      );
      const idx = tris.flatMap((t) => [t[0], t[1], t[2]]);
      g.setIndex(idx);
      g.computeVertexNormals();
      if (Math.sign(g.attributes.normal.getY(0)) !== sg) {
        g.setIndex(tris.flatMap((t) => [t[0], t[2], t[1]]));
        g.computeVertexNormals();
      }
      b.geometry(ck2, g);
    }
  }
}

/** Klima, çanak anten, kamera, bayrak */
function unit(b: Builder, E: Edge, P: PFn, i: number, it: CUnit, yFloor: number, seed: number): void {
  const yaw = E.yaw;
  const n = E.n;
  if (it.t === 'ac') {
    const off = it.onBal ? 1.0 : 0.16;
    const c = P(i, it.u, off);
    const y = yFloor + (it.y ?? (it.onBal ? 0.3 : 1.6));
    b.box('mkAc', [c[0], y, c[1]], [0.8, 0.55, 0.28], yaw, 1, 0b111110);
    const f = P(i, it.u, off + 0.141);
    b.box('mkAcFront', [f[0], y, f[1]], [0.8, 0.55, 0.002], yaw, 1, 0b000001);
    if (!it.onBal) {
      // Duvar konsolu
      for (const s of [-0.3, 0.3]) {
        const q = P(i, it.u + s, 0.12);
        b.box('mkRail', [q[0], y - 0.3, q[1]], [0.03, 0.03, 0.26], yaw);
      }
    }
  } else if (it.t === 'dish') {
    // Duvardan uzaklık: ölçülen `off` (ör. gömük loca korkuluğu 0.3), yoksa çıkma balkon korkuluğu 1.35 / duvar 0.35
    const off = it.off ?? (it.onBal ? 1.35 : 0.35);
    const c = P(i, it.u, off);
    const y = yFloor + (it.y ?? (it.onBal ? 1.25 : 1.8));
    const dish = new THREE.SphereGeometry(0.36, 14, 4, 0, Math.PI * 2, 0, 0.55);
    dish.scale(1, 0.42, 1);
    // Türksat 42°D → güney-güneydoğu, ~40° yukarı (bombe ekseni tersine)
    dish.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-0.293, -0.643, -0.708).normalize(),
      ),
    );
    dish.translate(c[0], y, c[1]);
    b.geometry('mkDish', dish);
    b.box('mkRail', [c[0] - n[0] * 0.15, y - 0.25, c[1] - n[1] * 0.15], [0.04, 0.5, 0.04], yaw);
    // LNB kolu
    b.box('mkPipe', [c[0] + 0.12, y + 0.12, c[1] + 0.3], [0.03, 0.03, 0.4], 0.4);
  } else if (it.t === 'camera') {
    const y = yFloor + (it.y ?? 2.4);
    if (it.style === 'dome') {
      // Kubbe kamera: duvar konsolu + altında yarım küre (beyaz)
      const kk = ckm('frame', it.color ?? '#f1f1ee', 'mkAc');
      // Önündeki dikme / ayak üzerindeyse (off) oradan
      const mo = Math.max(0, it.off ?? 0);
      const c = P(i, it.u, mo + 0.13);
      const w = P(i, it.u, mo + 0.02);
      // Duvar plakası + yatay kol + beyaz gövde halkası; altında füme kubbe
      b.box(kk, [w[0], y + 0.05, w[1]], [0.14, 0.14, 0.04], yaw);
      b.box(kk, [c[0], y + 0.07, c[1]], [0.06, 0.03, 0.2], yaw);
      const hg = new THREE.CylinderGeometry(0.085, 0.085, 0.045, 14);
      hg.translate(c[0], y + 0.0425, c[1]);
      b.geometry(kk, hg);
      const g = new THREE.SphereGeometry(0.062, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      g.translate(c[0], y + 0.02, c[1]);
      b.geometry('darkMetal', g);
    } else if (it.style === 'bullet' && it.yaw != null && !it.pair) {
      // v7: ölçülen bakış yönlü bullet CCTV (yaw: duvardan dışarı 0°, cephe boyunca ±90°), hafif aşağı eğik
      const kk = ckm('frame', it.color ?? '#e6e7e5', 'mkAc');
      const m0 = Math.max(0.05, it.off ?? 0.05);
      const a = (it.yaw * Math.PI) / 180;
      const dt = Math.sin(a);
      const dn = Math.cos(a);
      const arm = P(i, it.u + dt * 0.07, m0 + dn * 0.07);
      b.box(kk, [arm[0], y + 0.06, arm[1]], [0.03, 0.03, 0.14], yaw + a);
      const g = new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10);
      g.rotateX(Math.PI / 2 + 0.25);
      g.rotateY(yaw + a);
      const c = P(i, it.u + dt * 0.2, m0 + dn * 0.2);
      g.translate(c[0], y + 0.02, c[1]);
      b.geometry(kk, g);
    } else if (it.style === 'bullet') {
      // Kollu "bullet" CCTV: dikme / duvar üstünde (off), tek ya da çift (cephe boyunca iki yana bakan)
      const kk = ckm('frame', it.color ?? '#e6e7e5', 'mkAc');
      const m0 = Math.max(0.05, it.off ?? 0.05);
      const dirs: [number, number][] = it.pair
        ? [
            [1, 0],
            [-1, 0],
          ]
        : [[0, 1]];
      for (const [dt, dn] of dirs) {
        // Kol: montaj noktasından bakış yönüne 0.14 m
        const a = P(i, it.u + dt * 0.07, m0 + dn * 0.07);
        b.box(kk, [a[0], y + 0.06, a[1]], [dt ? 0.14 : 0.03, 0.03, dn ? 0.14 : 0.03], yaw);
        const g = new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10);
        // Silindir ekseni bakış yönünde (hafif aşağı eğik)
        g.rotateZ(Math.PI / 2);
        g.rotateZ(dt ? -dt * 0.25 : 0);
        if (dn) {
          g.rotateY(Math.PI / 2);
          g.rotateX(0.25);
        }
        g.rotateY(yaw);
        const c = P(i, it.u + dt * 0.2, m0 + dn * 0.2);
        g.translate(c[0], y + 0.02, c[1]);
        b.geometry(kk, g);
      }
    } else {
      const c = P(i, it.u, it.off != null ? it.off + 0.1 : 0.18);
      b.box(
        it.color ? ckm('frame', it.color, 'mkAc') : 'mkAc',
        [c[0], y, c[1]],
        [0.1, 0.1, 0.22],
        yaw + ((it.yaw ?? 0) * Math.PI) / 180,
      );
    }
  } else if (it.t === 'flag') {
    const off = it.off != null ? it.off : it.onBal ? 1.45 : 0.1;
    const y = yFloor + (it.y ?? 1.0);
    if (it.w == null && it.h == null && !it.tilt) {
      const c0 = P(i, it.u - 0.55, off);
      const c1 = P(i, it.u + 0.55, off);
      b.wall('mkFlag', c0, c1, y - 1.3, y, [0, 0, 1, 1]);
      b.wall('mkFlag', c1, c0, y - 1.3, y, [1, 0, 0, 1]);
    } else {
      // v11: ölçülen boy (w × h, m) ve eğim (tilt°, + → u1 ucu aşağı; sol üst köşe etrafında, cephe düzleminde):
      // pencere içi küçük bayrak / eğik flama (survey-c 1552992538). Verilmeyen boy eski 1.1 × 1.3.
      const W = Math.max(0.1, it.w ?? 1.1);
      const Hh = Math.max(0.1, it.h ?? 1.3);
      const t = ((it.tilt ?? 0) * Math.PI) / 180;
      const uL = it.u - W / 2;
      const pt = (du: number, dv: number): V3 => {
        const ru = du * Math.cos(t) + dv * Math.sin(t);
        const rv = -du * Math.sin(t) + dv * Math.cos(t);
        const q = P(i, uL + ru, off);
        return [q[0], y + rv, q[1]];
      };
      const [p0, p1, p2, p3] = [pt(0, -Hh), pt(W, -Hh), pt(W, 0), pt(0, 0)];
      b.quad('mkFlag', p0, p1, p2, p3, [0, 0, 1, 1]);
      b.quad('mkFlag', p1, p0, p3, p2, [1, 0, 0, 1]);
    }
    void seed;
  }
}

/** İki dünya noktası arasında silindir çubuk (yarıçap r, kesit seg) */
function rod3(b: Builder, key: string, A: V3, B: V3, r: number, seg = 8): void {
  const v = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  const L = v.length();
  if (L < 0.005) return;
  const g = new THREE.CylinderGeometry(r, r, L, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
  g.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
  b.geometry(key, g);
}

/**
 * v7: çapraz tabela çubuğu / gergi / konsol (`rod`): iki uç [u, y (tabandan), duvardan uzaklık] arasında silindir;
 * duvara değen uçta (uzaklık < 6 cm) küçük bağlantı plakası.
 */
function facadeRod(b: Builder, P: PFn, i: number, it: CRod, base: number, key: string, yaw = 0): void {
  const r = Math.max(0.005, Math.min(0.1, it.r || 0.015));
  const pa = P(i, it.a[0], it.a[2]);
  const pe = P(i, it.e[0], it.e[2]);
  const A: V3 = [pa[0], base + it.a[1], pa[1]];
  const B: V3 = [pe[0], base + it.e[1], pe[1]];
  rod3(b, key, A, B, r, 8);
  for (const q of [it.a, it.e])
    if (q[2] < 0.06) {
      const c = P(i, q[0], 0.01);
      b.box(key, [c[0], base + q[1], c[1]], [r * 5, r * 5, 0.02], yaw);
    }
}

/**
 * v7: giriş basamak bloğu (`steps`): u0..u1 boyunca, duvardan `off` uzakta başlayan n basamak; en üst basamak `top`
 * kotunda (tabandan), her basamak `tread` derin — en üstteki duvara en yakın (entrance() ile aynı yığma).
 */
function stepsBlock(b: Builder, P: PFn, E: Edge, i: number, it: CSteps, base: number, key: string): void {
  const W = it.u1 - it.u0;
  const n = Math.max(1, Math.min(20, Math.round(it.n || 1)));
  const tr = Math.max(0.15, it.tread || 0.3);
  if (W < 0.2 || !(it.top > 0.02)) return;
  const off = Math.max(0, it.off ?? 0);
  for (let j = 1; j <= n; j++) {
    const h = (it.top * j) / n;
    const d = (n - j + 1) * tr;
    const c = P(i, (it.u0 + it.u1) / 2, off + d / 2);
    b.box(key, [c[0], base + h / 2 - 0.02, c[1]], [W, h + 0.04, d], E.yaw);
  }
}

/** furnItem için loca / balkon ön kenarı sorguları (kenar i'nin u'su, kat k) */
interface FurnCtx {
  loggia: (u: number, k: number) => { span: [number, number]; depth: number } | null;
  front: (u: number, k: number) => number | null;
  ck: (kind: CK, hex: string | null | undefined, dflt: string) => string;
}

/**
 * v7: balkon / loca eşyası (`box`): kind box (dolap, beyaz kutu: düz kutu, `color2` ön yüz rengi) | swing (örtülü
 * bahçe salıncağı: metal A çerçeve `color2`, tente + minder `color`). Montaj: wall (duvara ya da loca arka duvarına
 * dayalı, arkası `off` kadar açık), side (loca yan duvarına dayalı: u0..u1 yan duvardan çıkıntısı, d yan duvar
 * boyunca boyu, off cephe hattından içeri uzaklığı), front (balkon ön kenarının `off` gerisinde).
 */
function furnItem(b: Builder, P: PFn, E: Edge, i: number, it: CBox, base: number, c: FurnCtx): void {
  let u0 = Math.min(it.u0, it.u1);
  let u1 = Math.max(it.u0, it.u1);
  const y0 = base + Math.min(it.y0, it.y1);
  const y1 = base + Math.max(it.y0, it.y1);
  const D = Math.max(0.05, it.d || 0.4);
  if (u1 - u0 < 0.05 || y1 - y0 < 0.05) return;
  const um = (u0 + u1) / 2;
  const lg = c.loggia(um, it.s);
  const off = Math.max(0, it.off ?? 0.02);
  // Kutunun cephe normali boyunca arka (n0) ve ön (n1) yüzleri (cephe düzlemine göre)
  let n0: number;
  let n1: number;
  let faceT = 0;
  if (it.mount === 'side' && lg) {
    // Yan duvara dayalı: yakın uç yan duvara oturur; ön yüzü loca ortasına (±t) bakar
    const atStart = um - lg.span[0] <= lg.span[1] - um;
    const w = u1 - u0;
    if (atStart) {
      u0 = lg.span[0];
      u1 = lg.span[0] + w;
      faceT = 1;
    } else {
      u1 = lg.span[1];
      u0 = lg.span[1] - w;
      faceT = -1;
    }
    n1 = -off;
    n0 = n1 - D;
  } else if (it.mount === 'front') {
    const f = c.front(um, it.s) ?? D + off;
    n1 = f - off;
    n0 = n1 - D;
  } else {
    n0 = (lg ? -lg.depth : 0) + off;
    n1 = n0 + D;
  }
  const W = u1 - u0;
  const cc = P(i, (u0 + u1) / 2, (n0 + n1) / 2);
  const mainK = c.ck('plaster', it.color, 'mkAc');
  if (it.kind === 'swing') {
    // Bahçe salıncağı: iki uçta A çerçeve (bacaklar döşemede ±D/2, tepede birleşik), üst kiriş, eğik tente, oturak
    const fk = c.ck('metal', it.color2 ?? '#3a3d40', 'darkMetal');
    const ak = c.ck('awning', it.color, 'mkAc');
    const nm = (n0 + n1) / 2;
    const yTop = y1 - 0.28;
    const V = (u: number, n: number, y: number): V3 => {
      const p = P(i, u, n);
      return [p[0], y, p[1]];
    };
    for (const u of [u0 + 0.05, u1 - 0.05]) {
      rod3(b, fk, V(u, n0 + 0.05, y0), V(u, nm, yTop), 0.022, 6);
      rod3(b, fk, V(u, n1 - 0.05, y0), V(u, nm, yTop), 0.022, 6);
    }
    rod3(b, fk, V(u0 + 0.05, nm, yTop), V(u1 - 0.05, nm, yTop), 0.025, 6);
    // Tente: tepede mahya, iki yana 0.3 m iner (iki yüzlü kumaş)
    const ov = 0.08;
    for (const [na, nb] of [
      [nm, n0 - ov],
      [nm, n1 + ov],
    ] as [number, number][]) {
      const A0 = V(u0 - ov, na, y1);
      const A1 = V(u1 + ov, na, y1);
      const B1 = V(u1 + ov, nb, y1 - 0.3);
      const B0 = V(u0 - ov, nb, y1 - 0.3);
      b.quad(ak, A0, A1, B1, B0);
      b.quad(ak, B0, B1, A1, A0);
    }
    // Oturak + sırtlık (minder rengi = tente), askı çubukları
    const ys = y0 + 0.45;
    const sw = Math.max(0.3, W - 0.4);
    const sc = P(i, (u0 + u1) / 2, nm);
    b.box(ak, [sc[0], ys, sc[1]], [sw, 0.1, Math.min(0.6, D * 0.6)], E.yaw);
    const bk = P(i, (u0 + u1) / 2, nm - Math.min(0.28, D * 0.28));
    b.box(ak, [bk[0], ys + 0.3, bk[1]], [sw, 0.5, 0.08], E.yaw);
    for (const u of [(u0 + u1) / 2 - sw / 2 + 0.05, (u0 + u1) / 2 + sw / 2 - 0.05])
      rod3(b, fk, V(u, nm, yTop), V(u, nm, ys + 0.05), 0.008, 5);
    return;
  }
  // Düz kutu (dolap): gövde + ölçülen ön yüz rengi
  b.box(mainK, [cc[0], (y0 + y1) / 2, cc[1]], [W, y1 - y0, n1 - n0], E.yaw);
  if (it.color2 && /^#[0-9a-f]{6}$/i.test(it.color2)) {
    const fk = c.ck('plaster', it.color2, mainK);
    if (faceT === 0) b.wall(fk, P(i, u0, n1 + 0.003), P(i, u1, n1 + 0.003), y0 + 0.01, y1 - 0.01);
    else {
      const ue = faceT > 0 ? u1 + 0.003 : u0 - 0.003;
      // +t'ye bakan yüz: a→e −n yönünde; −t'ye bakan: +n yönünde
      if (faceT > 0) b.wall(fk, P(i, ue, n1), P(i, ue, n0), y0 + 0.01, y1 - 0.01);
      else b.wall(fk, P(i, ue, n0), P(i, ue, n1), y0 + 0.01, y1 - 0.01);
    }
  }
}

/** Blok girişi: çift kanat alüminyum kapı (açıklık zaten pencere değilse), basamak, cam saçak, levha */
function entrance(
  b: Builder,
  P: PFn,
  E: Edge,
  i: number,
  it: CEntrance,
  base: number,
  y0: number,
  signKey?: string,
): void {
  const s = (it.u0 + it.u1) / 2;
  const W = Math.max(1.4, it.u1 - it.u0);
  // KARAR: zemin kat yüksekse (yarı bodrum) giriş kapısı zemin kotunda, merdiven içeride (ölçümde görüldü)
  if (y0 - base > 1.2 && it.steps == null) y0 = base + 0.15;
  const rise = Math.max(0, y0 - base);
  const steps = it.steps ?? Math.max(0, Math.round(rise / 0.16));
  for (let k = 0; k < steps; k++) {
    const d = 1.2 + (steps - k) * 0.3;
    const c = P(i, s, d / 2);
    const h = (rise / Math.max(1, steps)) * (k + 1);
    b.box('mkStep', [c[0], base + h / 2 - 0.02, c[1]], [W + 1.0, h + 0.04, d], E.yaw);
  }
  b.wall('mkEntryDoor', P(i, s - W / 2, 0.02), P(i, s + W / 2, 0.02), y0, y0 + 2.4, [0, 0, 1, 1]);
  if (it.canopy) {
    const c = P(i, s, 0.7);
    b.box('mkRail', [c[0], y0 + 2.75, c[1]], [W + 0.6, 0.08, 1.4], E.yaw);
    b.box('mkCanopyGlass', [c[0], y0 + 2.8, c[1]], [W + 0.5, 0.02, 1.3], E.yaw);
  }
  if (signKey) b.wall(signKey, P(i, s - 0.45, 0.04), P(i, s + 0.45, 0.04), y0 + 2.95, y0 + 3.3);
}

/** Yönlü sınır kutusu üzerine kırma çatı (saçak taşmalı); tepe kotunu döndürür */
function hippedRoof(b: Builder, r: V2[], y: number, eave: number, pitchDeg: number): number {
  // En küçük alanlı yönlü dikdörtgen
  let best: { area: number; c: V2; ax: V2; w: number; d: number } | null = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const e = r[(i + 1) % r.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 1) continue;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const n: V2 = [-t[1], t[0]];
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of r) {
      const u = p[0] * t[0] + p[1] * t[1];
      const v = p[0] * n[0] + p[1] * n[1];
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      best = { area, c: [t[0] * uc + n[0] * vc, t[1] * uc + n[1] * vc], ax: t, w: u1 - u0, d: v1 - v0 };
    }
  }
  if (!best) return y;
  const ax = best.ax;
  const nx: V2 = [-ax[1], ax[0]];
  const W = best.w / 2 + eave;
  const D = best.d / 2 + eave;
  const C = (u: number, v: number): V2 => [
    best!.c[0] + ax[0] * u + nx[0] * v,
    best!.c[1] + ax[1] * u + nx[1] * v,
  ];
  const rise = Math.min(W, D) * Math.tan((pitchDeg * Math.PI) / 180);
  const p00 = C(-W, -D);
  const p10 = C(W, -D);
  const p11 = C(W, D);
  const p01 = C(-W, D);
  b.polygon(K('mkSoffit'), [p00, p10, p11, p01], y - 0.02, false, 0.5);
  // Saçak alnı (çatı kenarı boyunca, koyu gri)
  for (const [q0, q1] of [
    [p00, p10],
    [p10, p11],
    [p11, p01],
    [p01, p00],
  ] as [V2, V2][])
    b.wall(K('mkFascia'), q1, q0, y - 0.3, y + 0.03, [
      0,
      y - 0.3,
      Math.hypot(q1[0] - q0[0], q1[1] - q0[1]),
      y,
    ]);
  const long = W >= D;
  const hr = long ? W - D : D - W;
  const r0 = long ? C(-hr, 0) : C(0, -hr);
  const r1 = long ? C(hr, 0) : C(0, hr);
  const ry = y + rise;
  const V = (p: V2, h: number): V3 => [p[0], h, p[1]];
  const faces: [V2, V2, V2, V2][] = long
    ? [
        [p00, p10, r1, r0],
        [p11, p01, r0, r1],
      ]
    : [
        [p10, p11, r1, r0],
        [p01, p00, r0, r1],
      ];
  for (const [q0, q1, q2, q3] of faces)
    b.quad('roof', V(q0, y), V(q1, y), V(q2, ry), V(q3, ry), [
      0,
      0,
      Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / 2,
      rise / 1.5,
    ]);
  const tri: [V2, V2, V2][] = long
    ? [
        [p10, p11, r1],
        [p01, p00, r0],
      ]
    : [
        [p11, p01, r1],
        [p00, p10, r0],
      ];
  for (const [q0, q1, q2] of tri)
    b.quad('roof', V(q0, y), V(q1, y), V(q2, ry), V(q2, ry), [0, 0, 2, rise / 1.5]);
  const rl = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
  if (rl > 0.1)
    b.box(
      'ridge',
      [(r0[0] + r1[0]) / 2, ry + 0.04, (r0[1] + r1[1]) / 2],
      [rl + 0.2, 0.1, 0.22],
      Math.atan2(-(r1[1] - r0[1]), r1[0] - r0[0]),
    );
  return ry;
}

/**
 * v11: hap (stadyum) biçimli tabela kutusu: w × h, uç yarıçapı min(w, h) / 2, kalınlık d; yerel x kenar boyunca, z
 * duvar normali (b.box ile aynı çerçeve), merkez c (dünya x / z) ve yc kotunda.
 */
export function pillGeometry(
  w: number,
  h: number,
  d: number,
  yaw: number,
  c: V2,
  yc: number,
): THREE.BufferGeometry {
  const r = Math.min(w, h) / 2;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const sh = new THREE.Shape();
  sh.moveTo(-hx, -h / 2);
  sh.lineTo(hx, -h / 2);
  sh.absarc(hx, hy > 0 ? -hy : 0, r, -Math.PI / 2, 0, false);
  if (hy > 0) sh.lineTo(w / 2, hy);
  sh.absarc(hx, hy > 0 ? hy : 0, r, 0, Math.PI / 2, false);
  sh.lineTo(-hx, h / 2);
  sh.absarc(-hx, hy > 0 ? hy : 0, r, Math.PI / 2, Math.PI, false);
  if (hy > 0) sh.lineTo(-w / 2, -hy);
  sh.absarc(-hx, hy > 0 ? -hy : 0, r, Math.PI, (3 * Math.PI) / 2, false);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -d / 2);
  g.rotateY(yaw);
  g.translate(c[0], yc, c[1]);
  return g;
}

/** Açıklık b, a'nın içinde mi (2 cm pay) */
function openingInside(b: Opening, a: Opening): boolean {
  return b.u0 >= a.u0 - 0.02 && b.u1 <= a.u1 + 0.02 && b.y0 >= a.y0 - 0.02 && b.y1 <= a.y1 + 0.02;
}

/**
 * v11 (survey-b): çakışan açıklıkları çöz. Önceden (y0, u0) sırasıyla ilk gelen kalıyor, çakışan sonraki sessizce
 * atılıyordu: aynı denizlikli vitrinin içindeki kapı kayboluyordu (1550614219 e6 / e9, 1551814316 e4 / e8,
 * 1551828351 e18). Şimdi: dükkân camı (kind shop) içindeki açıklık korunur, cam onun çevresinde parçalara bölünür
 * (sol / sağ tam boy, üstte / altta kapı genişliğinde cam — 10 cm'den dar parça çizilmez); kalan (kısmi) çakışmalar
 * eskisi gibi atılır (ölçüm hatası; survey-compile uyarı verir). Çakışmayan açıklıklar aynen kalır.
 */
export function resolveOpenings(list: Opening[]): Opening[] {
  const ops = list.slice().sort((p, q) => p.y0 - q.y0 || p.u0 - q.u0);
  const over = (q: Opening, op: Opening) =>
    q.u1 > op.u0 + 0.02 && q.u0 < op.u1 - 0.02 && q.y1 > op.y0 + 0.02 && q.y0 < op.y1 - 0.02;
  let keep: Opening[] = [];
  for (const op of ops) {
    const hits = keep.filter((q) => over(q, op));
    if (!hits.length) {
      keep.push(op);
      continue;
    }
    // Tek dükkân camının içinde (ya da op dükkân camı ve çakışanların hepsi onun içinde): böl
    if (
      hits.length === 1 &&
      hits[0].win.kind === 'shop' &&
      op.win.kind !== 'shop' &&
      openingInside(op, hits[0])
    ) {
      keep = keep.filter((q) => q !== hits[0]).concat(splitAround(hits[0], [op]), [op]);
      continue;
    }
    if (op.win.kind === 'shop' && hits.every((q) => q.win.kind !== 'shop' && openingInside(q, op))) {
      keep.push(...splitAround(op, hits));
      continue;
    }
  }
  return keep;
}

/** Dükkân camını (a) içindeki açıklıkların (holes, a'nın içinde) çevresinde dikdörtgen parçalara böl */
function splitAround(a: Opening, holes: Opening[]): Opening[] {
  const MIN = 0.1;
  const hs = holes.slice().sort((p, q) => p.u0 - q.u0);
  const out: Opening[] = [];
  // Kat döşemesi kotu parçalarda korunur (yatay kayıtlar / kemer üzengisi açıklığın alt kenarından türetiliyor)
  const fy = a.fy ?? a.y0 - Math.max(0.02, a.win.sill);
  const piece = (u0: number, u1: number, y0: number, y1: number) => {
    if (u1 - u0 >= MIN && y1 - y0 >= MIN) out.push({ ...a, u0, u1, y0, y1, fy });
  };
  let u = a.u0;
  for (const h of hs) {
    piece(u, Math.max(u, h.u0), a.y0, a.y1);
    const hu0 = Math.max(a.u0, h.u0);
    const hu1 = Math.min(a.u1, h.u1);
    piece(hu0, hu1, Math.min(a.y1, h.y1), a.y1);
    piece(hu0, hu1, a.y0, Math.max(a.y0, h.y0));
    u = Math.max(u, hu1);
  }
  piece(u, a.u1, a.y0, a.y1);
  return out;
}

/**
 * Cam balkon görünüm kodu (camGlass gölgelendiricisi aux.y): 0 clear (koyu iç + mavi gök), 1 green, 2 dark, 3 blinds,
 * v11 4 light — açık renk iç / nötr gri yansıma (fotoğrafta camın ardı açık gri görünen kapalı balkon; GY1l
 * 1544934694 K3 #a4aaa8, varsayılan clear oyunda #8693a8 mavi).
 */
export function tintCode(t: string | undefined): number {
  return t === 'green' ? 1 : t === 'dark' ? 2 : t === 'blinds' ? 3 : t === 'light' ? 4 : 0;
}
