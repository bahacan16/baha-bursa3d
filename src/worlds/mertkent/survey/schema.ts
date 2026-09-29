/**
 * Cephe ölçüm şeması (Street View ortofotolarından elle okunur): `survey/<osmId>.json`.
 *
 * Ölçüm "görünen" (ortofoto) koordinatlarında yazılır; gerçek ölçüye dönüşüm kodda yapılır:
 * - Her kenar için bir referans ortofoto seçilir (`ref`, docs/survey/c/ altındaki dosya adı, _grid'siz).
 * - `u`: ortofotodaki yatay metre (ızgara etiketi; 0 = sarı kesikli sol çizgi). `y`: ızgaradaki yükseklik
 *   (0 = kırmızı taban çizgisi).
 * - `cal.u = [uA, uE]`: cephenin başlangıç ve bitiş köşelerinin (duvar köşesi; balkon/saçak değil) görünen u'su.
 *   Kodda u_gerçek = (u − uA) / (uE − uA) · len.
 * - `cal.head = [[k1, y1], [k2, y2]]`: iki farklı katta (k: 0 = zemin kat) normal pencerelerin üst kenarının
 *   (lento altı) görünen yüksekliği. Kat aralığı ve düşey ölçek buradan çıkar; mümkünse birbirinden uzak iki kat.
 * - Tekrarlayan öğeler (pencere, balkon) bir referans katta (`k`) ölçülür, `s` kat aralığına kopyalanır.
 *
 * Kenar indeksi: `data/footprints.json` halkasında kenar i = ring[i] → ring[i+1]; ortofoto adındaki indeks.
 */

/** Kapsayıcı kat aralığı [ilk, son] */
export type Storeys = [number, number];

export interface BlockSurvey {
  id: number;
  /** Blok adı (girişteki levhada okunuyorsa) */
  name?: string;
  /** Zemin dahil normal kat sayısı (çatı arası hariç) */
  storeys: number;
  /** Zemin kat döşemesinin bina dibindeki zeminden yüksekliği (m) — tahmini, kodda düzeltilebilir */
  groundRaise?: number;
  /** Kattan kata yükseklik (m), varsayılan 2.95 */
  floorH?: number;
  roof: RoofSpec;
  /** Fotoğraftan örneklenen renkler (sRGB "#rrggbb", güneşli yüzeyden) */
  colors?: Partial<Palette>;
  edges: EdgeSpec[];
  notes?: string[];
  /**
   * Kütle bölünmesi (DÜNYA koordinatı, metre): taban izi x (ve isteğe bağlı z) aralıklarıyla parçalara kırpılır;
   * her parça kendi kat sayısı / çatısıyla çizilir. `gap` verilirse o x aralığı 1 katlı düz çatılı podyum olur;
   * verilmezse kuleler arası boş kalır (ör. iki blok arası açık geçit). Parçalar ÇAKIŞMAMALI. Kesim çizgisindeki
   * yeni yan duvarlar öğesiz düz sıvadır (bunları notes'ta anlat).
   */
  massing?: {
    towers: {
      x?: [number, number];
      z?: [number, number];
      /** Dünya çokgeni (döndürülmüş şerit: ör. yalnız güney şeritte K8) */
      poly?: [number, number][];
      /** Taban izinin diğer parçalar dışında kalanı (ör. 8 katlı gövde, şerit 9 katlı) */
      rest?: boolean;
      storeys?: number;
      roof?: Partial<RoofSpec>;
    }[];
    gap?: { x: [number, number] };
  };
  /**
   * Üreticinin henüz çizemediği ama fotoğrafta görülen detaylar — ölçüleriyle (kenar, u/y aralığı, derinlik, renk,
   * malzeme, açıklama). Ana oturum bunları üreticiye ekleyip bağlar.
   */
  pending?: Record<string, unknown>[];
  /** Kat başına kat yüksekliği (gerçek m, K0'dan) — katlar eşit değilse (ör. [4.0, 2.7]); eksikler floorH */
  floorHs?: number[];
  /**
   * Ek hacimler, DÜNYA koordinatında (hava fotoğrafı + Street View): tek katlı ek, kış bahçesi, çatı odası, merdiven
   * kulesi başlığı… y0/y1 blok tabanına göre gerçek m (çatı odası için y0 = çatı üst kotu). Duvar rengi, üst bant,
   * düz çatı rengi, parapet (+ korkuluk), seçili çokgen kenarlarında giydirme cam (from..to yükseklik, dikme aralığı,
   * cam ve doğrama rengi). Kenar j = poly[j] → poly[j+1].
   */
  volumes?: {
    poly: [number, number][];
    y0: number;
    y1: number;
    color: string;
    band?: { h: number; color: string };
    roofC?: string;
    /** Parapet: RoofSpec.parapet ile aynı alanlar (railH, railEdges; burada kenar j = poly[j] → poly[j+1]) */
    parapet?: ParapetSpec;
    glazing?: {
      edges: number[] | 'all';
      from: number;
      to: number;
      mullion: number;
      glass: string;
      frame: string;
      /** Yatay kayıt (travers) aralığı (m) — giydirme cephede her kat / yarım kat yatay profil */
      transom?: number;
    };
    collide?: boolean;
    note?: string;
  }[];
  /**
   * Çatı / teras pergolaları (DÜNYA koordinatı, hava fotoğrafı + Street View): taban çokgeni (genelde 4 köşe),
   * y0 = dikme tabanı, y1 = üst kiriş üstü (blok tabanına göre gerçek m; çatı terasında y0 = teras döşemesi).
   * Dikmeler köşelerde ve kenarlar boyunca `every` (m, varsayılan 2.7) arayla, kesit `post` (m, 0.1); çevre kirişi
   * yüksekliği `beam` (0.14); en uzun kenara dik lameller `slat` (m, 0.5) arayla; `cover` renkliyse üstte örtü
   * (bez / polikarbon, görünen renk). Renk `color` (antrasit alüminyum #3b3f42 varsayılan).
   */
  pergolas?: {
    poly: [number, number][];
    y0: number;
    y1: number;
    color?: string;
    post?: number;
    every?: number;
    beam?: number;
    slat?: number;
    cover?: string;
  }[];
}

/**
 * Parapet (çatı kenarı / ek hacim): yükseklik h (gerçek m), renk, üstünde korkuluk (Bal.rail tipleri) + metal ve
 * cam rengi. Kenar bazında: `edges` verilirse parapet YALNIZ bu kenarlarda (diğer kenarlarda roof.fasciaH
 * boyunda saçak alnı); `railEdges` verilirse korkuluk yalnız bu kenarlarda (görülmeyen kenara korkuluk koyma!).
 * `railH`: küpeşte yüksekliği parapet üstünden (gerçek m; varsayılan 0.92 — çatı korkulukları çoğu zaman ≈0.6).
 * `coping`: parapet üstü harpuşta (metal / beton şapka): h, iki yana taşma `over` (m, 0.03), renk.
 * `band`: parapet dış yüzünün alt kısmında farklı renk bant (ör. 0.5 m beyaz döşeme alnı): h, renk.
 */
export interface ParapetSpec {
  h: number;
  color?: string;
  rail?: string;
  railC?: string;
  glassC?: string;
  railH?: number;
  edges?: number[];
  railEdges?: number[];
  coping?: { h: number; over?: number; color?: string };
  band?: { h: number; color: string };
}

export interface Palette {
  /** Ana cephe sıvası (grenli) */
  plaster: string;
  /** İkinci sıva rengi (bazı cephelerde farklı renk panolar) */
  plaster2: string;
  /** Turuncu şeritler */
  strip: string;
  /** Balkon alnı / parapet bandı ve saçak alnı */
  fascia: string;
  /** Balkon ve saçak altı (tavan) */
  soffit: string;
  /** Balkon korkuluk camı (buzlu, yeşilimsi) */
  railGlass: string;
  /** Pencere doğraması */
  frame: string;
  /** Kiremit */
  tile: string;
  /** Subasman (zemin kat altı) */
  plinth: string;
}

export interface RoofSpec {
  kind: 'hipped' | 'flat' | 'gable';
  /** Saçak taşması (m) */
  eave: number;
  /** Saçak alın bandı yüksekliği (m) */
  fasciaH: number;
  /** Kırma çatı eğimi (derece) */
  pitch?: number;
  /** Çatı ortasında düz teras / merdiven kulesi */
  terrace?: boolean;
  /** Üçgen alınlık (duvarın çatıya kadar yükseldiği) görülen kenarlar */
  gables?: number[];
  /** Saçak alt çizgisinin görünen yüksekliği (referans kenarın ortofotosunda) ve o kenar */
  eaveY?: { edge: number; y: number };
  /**
   * Çatı kenarında dolu parapet (gerçek m): yükseklik, renk, üstünde korkuluk (Bal.rail tipleri), metal ve cam rengi.
   * Verilirse saçak alnı yerine çizilir; çatı (kırma veya düz) parapetin arkasından saçaksız başlar.
   */
  parapet?: ParapetSpec;
}

export interface EdgeSpec {
  edge: number;
  /** Kontrol: düzeltilmiş kenar uzunluğu (m) */
  len: number;
  /** photo: fotoğrafla okundu; partial: kısmen (ağaç/açı); none: görülmedi */
  seen: 'photo' | 'partial' | 'none';
  /** Referans ortofoto (docs/survey/c/…jpg) — tüm görünen koordinatlar buna göre */
  ref?: string;
  cal?: { u: [number, number]; head: [[number, number], [number, number]] };
  /** 'none' kenarlar: öğeleri bu kenardan kopyala (benzer kenar); `mirror`: u'yu ters çevir */
  copyOf?: number;
  mirror?: boolean;
  items: FacadeItem[];
  note?: string;
}

export type FacadeItem =
  | Win
  | Strip
  | Bal
  | Pipe
  | Unit
  | Band
  | Panel
  | Entrance
  | Proj
  | Sign
  | Awning
  | Groove
  | Vent
  | Pilaster
  | Pediment
  | Recess
  | Mast;

/** Pencere / kapı sütunu (her katta aynı yerde tekrar eden açıklık) */
export interface Win {
  t: 'win';
  u0: number;
  u1: number;
  /** Referans katta alt (denizlik) ve üst (lento) görünen yükseklik */
  y0: number;
  y1: number;
  /** Referans kat (−1 = bodrum: zemin kat döşemesinin bir kat altı; K0 penceresi gibi ölçülür) */
  k: number;
  /**
   * Tekrar aralığı. s: [−1, −1] → bodrum pencereleri (zeminin üstünde kalan kısım çizilir, subasman kesilir; üst
   * kenar K0 döşemesini en çok 0.3 m aşabilir). Bodrum kat anahtarı perde/parmaklıkta "K-1".
   */
  s: Storeys;
  /** std: normal pencere, french: boydan (alt kısmı korkuluklu), small: banyo/merdiven, door: balkon kapısı */
  kind?: 'std' | 'french' | 'small' | 'door' | 'shop';
  /** Fransız balkon: paslanmaz yatay borulu korkuluk */
  rail?: boolean;
  /** Dikey kanat sayısı (varsayılan 2) */
  split?: number;
  /** Üstte panjur/stor kutusu */
  box?: boolean;
  /** Bu katlarda yok */
  except?: number[];
  /**
   * Perde / cam arkası görünümü, kat → tür (fotoğrafta görüldüğü gibi; görülmeyen katlar yazılmaz):
   * tul (beyaz tül), tul-yan (tül + iki yanda renkli fon perde), stor (stor perde, yarı inik), jaluzi (dikey
   * beyaz lameller), zebra (yatay bantlı), karanlik (perdesiz, karanlık oda), acik (kanat açık).
   * Pencere sütununda soldan sağa birden çok pencere varsa "K3": "tul" hepsi için geçerlidir; ayrı ayrı gerekiyorsa
   * sütunu ayrı `win` öğelerine böl.
   */
  curt?: Record<string, 'tul' | 'tul-yan' | 'stor' | 'jaluzi' | 'zebra' | 'karanlik' | 'acik' | 'vitrin'>;
  /** Fransız pencere / kapı alt bölmesi: frosted (buzlu cam), louvre (panjur lamelli), solid (dolu panel) + renk */
  lower?: 'frosted' | 'louvre' | 'solid';
  lowerC?: string;
  /** Doğrama rengi "#rrggbb" (bronz, antrasit, mavi… — bloğun `frame` renginden farklıysa) */
  frameC?: string;
  /** Renkli / yansıtıcı cam (giydirme cephe paneli): perde/oda yerine düz renkli cam, görünen renk "#rrggbb" */
  tint?: string;
  /** Söve: açıklığın çevresinde çıkıntılı çerçeve — genişlik w, çıkıntı d (gerçek m), renk */
  surround?: { w: number; d: number; color?: string };
  /** Kat → pencere önü demir parmaklık: bars (dikey çubuk), ornamental (çubuk + kıvrımlı orta bant), lattice (kafes) */
  grille?: Record<string, 'bars' | 'ornamental' | 'lattice'>;
  /** Parmaklık rengi "#rrggbb" */
  grilleC?: string;
  /** Kat → dış panjur / dükkân kepengi kapanma oranı 0..1 (1 = tamamen inik), fotoğraftaki gibi */
  shut?: Record<string, number>;
  /**
   * Kepenk / dış stor rengi "#rrggbb" (fotoğraftan; yoksa açık gri alüminyum). Kepenk 5 cm lamelli çizilir,
   * kutusu da bu renkte (kepenkli açıklıkta `box` beyaz kutusu çizilmez).
   */
  shutC?: string;
  /**
   * Yatay kayıtlar (giydirme cephe traversleri, vasistas kaydı): referans kat `k`'de GÖRÜNEN y listesi; her katta
   * aynı yükseklikte tekrarlanır. Düşey bölme sayısı `split` (≤ 12).
   */
  hbars?: number[];
  /**
   * Merdiven kovası penceresi: kat çizgisine kırpılmaz (lento kat yüksekliğini aşabilir, denizlik döşemenin altına
   * inebilir) → yarım kat kaymalı dizi `k` + `s` ile yazılır.
   */
  stair?: boolean;
}

/**
 * Kabartma pilastır: pencere sütunlarının yanında duvardan d kadar çıkan düşey bant (sıva / taş). Görünen u0..u1
 * (ya da merkez u + genişlik w) ve görünen y0..y1 — YA DA `s: [k0, k1]` (K k0 döşemesinden k1+1 döşemesine; en üst
 * katta duvar üstüne kadar). d gerçek m (varsayılan 0.06). Renk palet adı (plaster2 varsayılan) veya "#rrggbb".
 * `cap` / `base`: üstte başlık / altta kaide (h yükseklik, d ek çıkıntı m, renk).
 */
export interface Pilaster {
  t: 'pilaster';
  u0?: number;
  u1?: number;
  u?: number;
  w?: number;
  y0?: number;
  y1?: number;
  s?: Storeys;
  d?: number;
  color?: string;
  cap?: { h: number; d?: number; color?: string };
  base?: { h: number; d?: number; color?: string };
}

/**
 * Üçgen alınlık (balkon yığını üstü açık gri alınlık, cephe / çatı katı alınlığı, asimetrik alınlık):
 * görünen u0..u1 taban genişliği (d > 0 ise ön yüz düzleminde okunur, balkon gibi düzeltilir), `apex` tepe noktasının
 * görünen u'su (verilmezse orta → simetrik; kaydırılırsa asimetrik), `y` tabanın görünen yüksekliği (verilmezse duvar
 * üstü / saçak hizası), yükseklik `h` gerçek m YA DA `yTop` tepe noktasının görünen y'si. d: ön yüzün duvardan
 * taşması (m, balkon yığını üstünde balkonun d'si), depth: eğik üst yüzlerin geriye uzanımı (m). `trim`: çevre
 * silmesi / damlalık (w genişlik, d çıkıntı, renk). `roofC`: eğik yüzlerin rengi ("tile" = blok kiremidi; yoksa
 * alınlık rengi).
 */
export interface Pediment {
  t: 'pediment';
  u0: number;
  u1: number;
  apex?: number;
  y?: number;
  yTop?: number;
  h?: number;
  d?: number;
  depth?: number;
  color?: string;
  trim?: { w?: number; d?: number; color?: string };
  roofC?: string;
}

/**
 * Duvar girintisi: görünen u0..u1 × y0..y1 (ya da `s: [k0, k1]`: K k0 döşemesinden k1+1 döşemesinin altına) boyunca
 * duvar `depth` (gerçek m) içeri çekilir — çok katlı yüksek loca, girintili dükkân hattı, merdiven kovası
 * girintisi, kapı yuvası. Ağız duvarda boş kalır; ORTASI girintiye düşen pencere/kapı (`win`), tabela ve menfezler
 * arka duvarda çizilir (aynı u/y ile yazılır). Renkler: back (arka duvar), side (yan duvarlar; yoksa back), ceil
 * (tavan; yoksa soffit), floor (taban; yoksa döşeme) — palet adı veya "#rrggbb". Ara kat döşemeleri gerekiyorsa
 * her kat için ayrı `bal` (d, inset) kullan; girinti ara döşemesizdir.
 */
export interface Recess {
  t: 'recess';
  u0: number;
  u1: number;
  y0?: number;
  y1?: number;
  s?: Storeys;
  depth: number;
  back?: string;
  side?: string;
  ceil?: string;
  floor?: string;
}

/** Bayrak direği: görünen u, duvardan uzaklık off (m), taban görünen y0 (verilmezse zemin), boy h (m), renk, bayrak */
export interface Mast {
  t: 'mast';
  u: number;
  off?: number;
  y0?: number;
  h: number;
  color?: string;
  /** "tr" (Türk bayrağı) veya "#rrggbb" düz renkli bayrak; yoksa bayraksız */
  flag?: string;
}

/** Turuncu yuvarlak şerit (yarım yuvarlak kesitli pilastr, uçları yuvarlak) */
export interface Strip {
  t: 'strip';
  /** Merkez (görünen) */
  u: number;
  /** Genişlik (görünen, varsayılan 0.24) */
  w?: number;
  /** Alt ve üst uç (görünen) */
  y0: number;
  y1: number;
}

/**
 * Balkon yığını: dikdörtgen döşeme (duvardan d kadar dışarı), gri parapet + buzlu cam korkuluk.
 * Köşeyi saran balkonlar iki kenarda ayrı ayrı yazılır (her biri köşeye kadar / köşeyi aşarak).
 */
export interface Bal {
  t: 'bal';
  /** Görünen yatay kapsama (balkon ön yüzü) */
  u0: number;
  u1: number;
  /** Duvardan taşma (m, gerçek; yan cepheden okunur, bilinmiyorsa 1.4) */
  d: number;
  s: Storeys;
  /** Cam balkon (katlanır cam) olan katlar */
  glazed?: number[];
  /** Cam balkon görünümü (kat → tür): clear, green (yeşil yansıma), dark, blinds (zebra/stor perde), frosted (buzlu) */
  tint?: Record<string, 'clear' | 'green' | 'dark' | 'blinds' | 'frosted'>;
  /** En üst katın üstünde büyük düz saçak plağı (koyu gri alınlı "şapka") */
  cap?: boolean;
  /** Yan kapanış: open (iki yan açık), wall (iki yanda duvar/girinti), start-wall / end-wall (tek yan) */
  sides?: 'open' | 'wall' | 'start-wall' | 'end-wall';
  /**
   * İçe gömük (loca) balkon: d = 0 ve arka duvarın taban izinden içeri çekilme derinliği (m). Köşe locası iki
   * kenarda yazılırsa derinlikler birbirinin genişliğinden otomatik çıkarılır.
   */
  inset?: number;
  /**
   * Korkuluk tipi, kat → tür ("*" = tüm katlar varsayılanı). KAT KAT AYRI İNCELE (Türkiye'de her kat farklı olabilir):
   * glass = dolu alçak parapet (~0.4 m) + üstünde buzlu cam; glassFull = döşemeden itibaren çerçevesiz cam;
   * tube = yatay paslanmaz/çelik borular (dikmeli); bars = dikey çubuklu demir korkuluk; solid = tam boy (≈1 m) dolu
   * parapet; solidTube = alçak dolu parapet + üstünde borular; none = korkuluksuz (yalnız döşeme alnı).
   */
  rail?: Record<string, 'glass' | 'glassFull' | 'tube' | 'bars' | 'solid' | 'solidTube' | 'none'>;
  /** Kat → döşeme alnı / parapet rengi "#rrggbb" (bloğun fascia renginden farklıysa) */
  fasciaC?: Record<string, string>;
  /** Korkuluk metal rengi (boru/çubuk/dikme) "#rrggbb" */
  railC?: string;
  /** Kat → dolu parapet yüksekliği (m, gerçek; solid/solidTube/glass için) */
  parapetH?: Record<string, number>;
  /** Korkuluğun arkasında koyu file/örtü olan katlar (kuş filesi, gölgelik) */
  net?: number[];
  /** Kat → korkuluk camının GÖRÜNEN rengi (füme #66747e, buzlu yeşilimsi #d6ebe3…; "*" varsayılan) */
  glassC?: Record<string, string>;
  /**
   * Kavisli ön yüz: ön kenarın ORTADA dışarı taşması (gerçek m, sehim; uçlarda 0). d = 0 + bulge → iki köşe
   * arasında duvardan duvara yay (kavisli loca/balkon önü). Döşeme, parapet, cam balkon yay boyunca çizilir.
   */
  bulge?: number;
  /** Serbest ön köşelerin yuvarlatma yarıçapı (m): tek sayı ya da [u0 ucu, u1 ucu] */
  round?: number | [number, number];
  /** Kat → cam balkon alt/üst profil rengi "#rrggbb" ("*" varsayılan; bronz, antrasit, beyaz…) */
  frameC?: Record<string, string>;
  /** Buzlu cam balkon rengi (tint "frosted" katlarında; varsayılan #d9dfdd) */
  frostC?: string;
  /** Kat → sarkan kiriş: alın bandı döşemenin bu kadar ALTINDAN başlar (m; toplam alın = kiriş + döşeme + parapet) */
  beam?: Record<string, number>;
  /** Kat → küpeşte yüksekliği (gerçek m, varsayılan 0.92) */
  railH?: Record<string, number>;
  /**
   * Kat → saksı konumları (görünen u listesi, balkon ön yüzünde). potsOn: "rail" (korkuluk üstüne asılı dikdörtgen
   * saksı, varsayılan) / "floor" (döşemede yuvarlak saksı, bitki korkuluktan taşar). potC saksı, plantC bitki rengi.
   */
  pots?: Record<string, number[]>;
  potsOn?: 'rail' | 'floor';
  potC?: string;
  plantC?: string;
}

/**
 * Dışarı taşan kütle (merdiven kulesi, çıkma, cumba, asansör kulesi, kolon): duvardan d kadar dışarı, görünen y0..y1
 * (ortofotodaki gibi; diğer öğelerle aynı koordinat). Üstü düz. Ön yüzündeki pencereler `wins` (görünen u/y).
 */
export interface Proj {
  t: 'proj';
  u0: number;
  u1: number;
  d: number;
  y0: number;
  y1: number;
  /** Renk: blok palet adı (plaster, plaster2, strip, fascia, plinth) veya "#rrggbb" */
  color?: string;
  wins?: {
    u0: number;
    u1: number;
    y0: number;
    y1: number;
    kind?: 'std' | 'small' | 'glassband';
    curt?: string;
  }[];
  /** Üstü teras olan çıkma / tek katlı ek: dış üç kenarda korkuluk (Bal.rail tipleri), metal rengi, parapet boyu */
  topRail?: 'glass' | 'glassFull' | 'tube' | 'bars' | 'solid' | 'solidTube' | 'none';
  topRailC?: string;
  topParH?: number;
  /** Teras korkuluğu küpeşte yüksekliği (m, varsayılan 0.92) */
  topRailH?: number;
}

/**
 * Dükkân / apartman tabelası: duvara ya da saçak altına monte kutu (d derinlik) veya tek tek harf (letters).
 * Yazı fotoğraftaki gibi (büyük/küçük harf, satırlar "\n"), renkler örneklenmiş.
 */
export interface Sign {
  t: 'sign';
  u0: number;
  u1: number;
  /** Görünen alt/üst (ortofoto y) */
  y0: number;
  y1: number;
  /** Kutu derinliği (m, varsayılan 0.12); letters için 0.04 */
  d?: number;
  text: string;
  /** Satır satır farklı renk/boyut gerekiyorsa (text yerine): boyut satır yüksekliği oranı (varsayılan 1) */
  lines?: { text: string; fg?: string; size?: number; bold?: boolean }[];
  /** Zemin rengi (letters için yok) */
  bg?: string;
  /** Yazı rengi */
  fg: string;
  /** Kenar/çerçeve rengi */
  border?: string;
  style?: 'box' | 'letters' | 'panel' | 'lightbox';
  font?: 'sans' | 'serif' | 'script' | 'condensed';
  bold?: boolean;
  /** Işıklı (gece parlar) */
  lit?: boolean;
  /** Yazı dışında görülen logo/şekil tarifi (çizilemiyorsa not) */
  logo?: string;
}

/**
 * Sıva derzi / kanal (görünen): h = yatay (u0..u1, y), v = dikey (u, y0..y1). Çift derzleri iki öğe olarak yaz.
 */
export interface Groove {
  t: 'groove';
  dir: 'h' | 'v';
  u0?: number;
  u1?: number;
  u?: number;
  y?: number;
  y0?: number;
  y1?: number;
  /** Genişlik (m, varsayılan 0.03) */
  w?: number;
  color?: string;
}

/** Havalandırma deliği / menfez (görünen merkez u,y; boyut s m; adet ve yatay aralık) */
export interface Vent {
  t: 'vent';
  u: number;
  y: number;
  s?: number;
  shape?: 'round' | 'rect';
  count?: number;
  spacing?: number;
  color?: string;
}

/** Tente (dükkân önü): duvarda görünen y yüksekliğinden d kadar dışarı, drop kadar aşağı eğik */
export interface Awning {
  t: 'awning';
  u0: number;
  u1: number;
  y: number;
  d: number;
  drop?: number;
  color: string;
  /** Çizgili ise ikinci renk */
  stripe?: string;
  /** Sarkan saçak (valans) üstündeki yazı */
  text?: string;
  textColor?: string;
}

/** Yağmur borusu (varsayılan tam boy, koyu gri, Ø10 cm) */
export interface Pipe {
  t: 'pipe';
  u: number;
  /** Duvardan uzaklık (m) — balkon önünden geçenler için ~1.4 */
  off?: number;
  /** Renk "#rrggbb" (ince açık gri PVC #d9d9d6, beyaz #f2f2f0, krem…) */
  color?: string;
  /** Yarıçap (gerçek m, varsayılan 0.05; ince PVC ≈0.03–0.04) */
  r?: number;
  /** Yalnız bu görünen yükseklik aralığında (ör. yalnız K0 boyunca görünen boru) */
  y0?: number;
  y1?: number;
  /** false → kat kelepçeleri çizilmez */
  brackets?: boolean;
}

/** Tekil ekipman: klima dış ünitesi, çanak anten, kamera, bayrak */
export interface Unit {
  t: 'ac' | 'dish' | 'camera' | 'flag';
  u: number;
  /** Kat */
  s: number;
  /** Görünen yükseklik (merkez) */
  y?: number;
  /** Balkon korkuluğunda (balkon önünde) */
  onBal?: boolean;
}

/** Yatay bant (görünen): subasman, kat silmesi vb. */
export interface Band {
  t: 'band';
  y0: number;
  y1: number;
  u0?: number;
  u1?: number;
  color: 'plinth' | 'fascia' | 'strip' | 'plaster2' | string;
  /** Duvardan çıkıntı (m) */
  proud?: number;
  /**
   * 'louvre': yatay lamelli alüminyum alın / güneşlik (dükkân saçağı): `color` lamel rengi, `shade` lamel arası
   * gölge rengi, `slats` lamel sayısı (verilmezse ≈0.15 m aralık), `proud` derinlik (≥ 0.06).
   */
  style?: 'louvre';
  slats?: number;
  shade?: string;
}

/** Farklı renkli sıva alanı (görünen) */
export interface Panel {
  t: 'panel';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  color: 'plaster2' | 'strip' | 'fascia' | string;
}

/** Bina girişi (görünen u; yükseklik zemin kattan) */
export interface Entrance {
  t: 'entrance';
  u0: number;
  u1: number;
  kind: 'lobby' | 'shop';
  canopy?: boolean;
  sign?: string;
  steps?: number;
}
