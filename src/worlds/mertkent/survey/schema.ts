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
      /**
       * Parçanın duvar üstü (saçak alnı alt kenarı / parapet başlangıcı) kotu, blok tabanından GERÇEK m — ör.
       * 1550614218 kanadı saçak alnı 18.85–19.35 → wallTop 18.85 + roof.fasciaH 0.5. Son kata kadar süren `recess`
       * (s ile) bu kota kadar çıkar. floorH / floorHs: parçanın kendi kat yükseklikleri (verilmezse bloğunki).
       */
      wallTop?: number;
      floorH?: number;
      floorHs?: number[];
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
   * Subasman bandı yüksekliği bina tabanından (gerçek m). 0 = subasman YOK (camlar / payeler zemine iner, ör.
   * 1546816193). Verilmezse zemin kat döşemesine kadar (en çok 1.2 m). Yüksek subasmanda (yarı bodrum, ör. 1480041300
   * "y 0–2.9 görünen") gerçek yüksekliği yaz; zemin kat açıklıkları ve bodrum pencereleri subasmanı keser.
   */
  plinthH?: number;
  /**
   * Duvar üstü kotu (saçak alnı alt kenarı / parapet başlangıcı), blok tabanından GERÇEK m. Verilmezse son kat
   * döşemesi + 0.12 (kat sayısı × kat yüksekliğinden). Ölçülen saçak kotu bundan farklıysa yaz.
   */
  wallTop?: number;
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
    /**
     * Düz çatı yerine eğik çatı: kind "gable" (beşik; `gables` alınlık kenarları = poly kenar indeksleri, ör. alın
     * üçgeni güneye bakan kulübe), "hipped" (kırma), "vault" (tonoz: `axis` kenarına paralel, dar yönde dairesel
     * kesit, `rise` m). pitch (derece, 25), eave (m, 0.2), color ("tile" = blok kiremidi, varsayılan; ya da
     * "#rrggbb"), gableC (alınlık / tonoz alın duvarı rengi; yoksa hacim rengi).
     */
    roof?: {
      kind: 'gable' | 'hipped' | 'vault';
      pitch?: number;
      rise?: number;
      eave?: number;
      gables?: number[];
      axis?: number;
      color?: string;
      gableC?: string;
    };
    /**
     * Hacim yüzündeki pencere / kapılar (çatıdan yükselen merdiven kulesi başlığının penceresi gibi): edge = poly
     * kenar indeksi (poly[edge] → poly[edge+1]), u0..u1 bu kenar boyunca gerçek m (poly[edge]'den), y0..y1 blok
     * tabanından gerçek m; kind (std/small/door), split, curt (perde türü), frameC, shut (0..1), shutC.
     */
    wins?: {
      edge: number;
      u0: number;
      u1: number;
      y0: number;
      y1: number;
      kind?: string;
      split?: number;
      curt?: string;
      frameC?: string;
      shut?: number;
      shutC?: string;
    }[];
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
  /**
   * hipped: kırma (DİKKAT: `gables` bu türde YOK SAYILIR); gable: `gables` kenarlarında alınlık, diğer kenarlarda
   * kırma (kırma çatı + bazı uçlarda alınlık = "gable" yaz); flat: düz.
   */
  kind: 'hipped' | 'flat' | 'gable';
  /** Saçak taşması (m) */
  eave: number;
  /** Saçak alın bandı yüksekliği (m) */
  fasciaH: number;
  /** Kırma çatı eğimi (derece) */
  pitch?: number;
  /** Çatı ortasında düz teras / merdiven kulesi */
  terrace?: boolean;
  /**
   * Üçgen alınlık (duvarın çatıya kadar yükseldiği) görülen kenarlar (yalnız kind "gable"). v6: alınlık duvarı cephe
   * düzleminde (taşmasız), çatı 0.15 m rüzgârlıkla taşar (eğik rüzgârlık tahtası); alınlık kenarında saçak alnı
   * bandı çizilmez. Bu kenarlarda saçak kotunu aşan `panel` alınlık eğimine kırpılarak alınlığa devam eder,
   * `strip` alınlık çizgisinin ~0.1 m altına kadar çıkar, çatı arası pencereleri (win k = storeys) alınlıkta açılır.
   */
  gables?: number[];
  /**
   * Alınlık üçgenlerinin rengi: palet adı / "#rrggbb" — tek değer (tüm alınlıklar) ya da kenar → renk
   * ({"5": "#cbccc6", "11": "plaster2"}). Verilmezse plaster. (1480041342/43 üst gri sıva alınlığa devam eder.)
   */
  gableC?: string | Record<string, string>;
  /** Saçak alın bandı rengi (palet adı / "#rrggbb"; verilmezse plaster2) — ör. 1480041344 koyu gri #8f979e */
  fasciaC?: string;
  /**
   * Saçak altı gömme spotları (saçak taşmasının altında, parapetsiz / alınlıksız kenarlarda): aralık every (m, 2.7),
   * saçak dış kenarından içeri inset (m, yarı taşma), çap d (m, 0.1), yalnız bu kenarlar edges.
   */
  spots?: { every?: number; inset?: number; d?: number; edges?: number[] };
  /** Saçak alt çizgisinin görünen yüksekliği (referans kenarın ortofotosunda) ve o kenar */
  eaveY?: { edge: number; y: number };
  /**
   * Çatı kenarında dolu parapet (gerçek m): yükseklik, renk, üstünde korkuluk (Bal.rail tipleri), metal ve cam rengi.
   * Verilirse saçak alnı yerine çizilir; çatı (kırma veya düz) parapetin arkasından saçaksız başlar. v6: parapet
   * `edges` ile yalnız bazı kenarlardaysa diğer kenarlarda gerçek saçak taşması (roof.eave) ve saçak alnı (fasciaH)
   * çizilir (kenar bazında saçak).
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
  | Mast
  | Cloth
  | Banner
  | Lamp
  | Dormer
  | Arch
  | RoofObj
  | Ribbon;

/** Pencere / kapı sütunu (her katta aynı yerde tekrar eden açıklık) */
export interface Win {
  t: 'win';
  u0: number;
  u1: number;
  /** Referans katta alt (denizlik) ve üst (lento) görünen yükseklik */
  y0: number;
  y1: number;
  /**
   * Referans kat (−1 = bodrum: zemin kat döşemesinin bir kat altı; K0 penceresi gibi ölçülür). k = storeys (ve
   * s: [storeys, storeys]) → ÇATI ARASI penceresi: duvar üstünün üstünde, çatı alınlığında (roof.gables), üçgen
   * alınlıkta (`pediment`) ya da kemerli parapette (`arch`) açılır (hangisinin içine düşerse; hiçbiri yoksa
   * çizilmez). Ölçü diğer katlar gibi (lento/denizlik, kat çizgisine göre).
   */
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
  curt?: Record<string, 'tul' | 'tul-yan' | 'stor' | 'jaluzi' | 'zebra' | 'karanlik' | 'acik' | 'vitrin' | 'fon'>;
  /**
   * Kat → perde RENGİ "#rrggbb" (camın arkasından görünen; güneşli / gölgeli olduğunu notta yaz): tul-yan'da yan (fon)
   * perdelerin, fon'da kalın perdenin, tul'da tülün, stor'da storun, jaluzi / zebra'da lamellerin rengi.
   * Ör. 1480041342 e8 K1–K2 "#627699" mavi-lila fon perde.
   */
  curtC?: Record<string, string>;
  /**
   * Kat → perde kapanma oranı 0..1 (pencere genişliğinin perdeyle örtülen kısmı, iki yana eşit; 1 = tamamen kapalı).
   * tul-yan / fon: yan perde genişliği; stor: inik kısmın oranı. Ör. "neredeyse tamamen kapalı" → 0.9.
   */
  curtF?: Record<string, number>;
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
  /**
   * v6: pencere cephe düzleminin bu kadar GERİSİNDE (gerçek m) — gömük loca arka duvarı (bal inset). Derleyici
   * ortofotonun ön düzleme göre ölçeğini arka düzleme çevirir (üst katlarda 0.3–0.7 m fark eder). Pencerenin ortası
   * locaya düşüyorsa üretici onu zaten arka duvarda çizer; `behind` yalnız ölçü düzeltmesidir. Loca yalnız bazı
   * katlardaysa arka duvar pencerelerini ayrı `win` öğesi (kendi s aralığı) olarak yaz.
   */
  behind?: number;
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
  /**
   * Köşe bandı (quoin, ör. 1480163637 kule köşelerindeki krem bantlar): "end" → kenar sonundaki köşede, "start" →
   * kenar başında, "both" → iki uçta bant d kadar uzar ve komşu kenardaki bantla köşede birleşir (her iki kenara
   * ayrı pilaster yaz, köşeye bitişik).
   */
  corner?: 'start' | 'end' | 'both';
  /** Yatay derzler (köşe taşı görünümü): aralık every (m), derz genişliği w (m, 0.02), renk */
  joints?: { every: number; w?: number; color?: string };
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
  /** Çevre silmesi / damlalık; base: false → yalnız iki eğik kenar (tabanda çizgi yok; 900000101 / 104) */
  trim?: { w?: number; d?: number; color?: string; base?: boolean };
  roofC?: string;
}

/**
 * Duvar girintisi: görünen u0..u1 × y0..y1 (ya da `s: [k0, k1]`: K k0 döşemesinden k1+1 döşemesinin altına) boyunca
 * duvar `depth` (gerçek m) içeri çekilir — çok katlı yüksek loca, girintili dükkân hattı, merdiven kovası
 * girintisi, kapı yuvası. Ağız duvarda boş kalır; ORTASI girintiye düşen pencere/kapı (`win`), tabela ve menfezler
 * arka duvarda çizilir (aynı u/y ile yazılır). v6: klima / çanak / kamera / bayrak (ac…), aplik (`lamp`), boru
 * parçaları, tente (`awning`, arka duvara asılı; d arka duvardan) ve giriş (`entrance`) de arka duvara taşınır.
 * Son kata kadar süren girinti (s) ölçülmüş `wallTop` varsa saçak altına kadar çıkar. Renkler: back (arka duvar), side (yan duvarlar; yoksa back), ceil
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
  /**
   * Kat → arka / yan duvar rengi (renk bölgeleri kat döşemelerinde değişiyorsa; ör. 1480163637 arka duvar K0 pembe,
   * K1–K4 krem, K5–K6 pembe). Verilmeyen katlar back / side.
   */
  backS?: Record<string, string>;
  sideS?: Record<string, string>;
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
  /**
   * Direk tepesinde eleman: disc (duvara bakan yuvarlak levha + yatay kol; ör. 1480163634 alınlık tepesindeki ≈1.4 m
   * koyu yuvarlak eleman — çanak mı oculus mu belirsizse disc), dish (çanak anten), ball (top); d çap (m), color,
   * arm (yatay kol boyu m).
   */
  top?: { kind: 'disc' | 'dish' | 'ball'; d?: number; color?: string; arm?: number };
}

/**
 * Balkon içi güneşlik bezi / branda (ör. 1480041342 e8 K5): ön düzlemde (d, duvardan m) görünen u0..u1 × y0..y1;
 * üst kenar tavanda, alt kenar duvara doğru `back` (m) kadar eğik asılı. Renk "#rrggbb". u/y bu düzlemde görünen
 * (balkon gibi düzeltilir).
 */
export interface Cloth {
  t: 'cloth';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  d?: number;
  color: string;
  back?: number;
}

/**
 * Korkuluğa asılı bayrak / pankart (dikey): görünen u0..u1 × y0..y1, korkuluk önünde (d, varsayılan 1.4).
 * style: portrait (kırmızı zemin, üstte ay-yıldız, ortada gri tonlu portre madalyonu, altta beyaz bantta `text` —
 * yalnız OKUNAN harfler yazılır), tr-v (dikey Türk bayrağı), tr (yatay), plain (düz renk bg + text). bg / fg renk.
 */
export interface Banner {
  t: 'banner';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  d?: number;
  style?: 'portrait' | 'tr-v' | 'tr' | 'plain';
  bg?: string;
  fg?: string;
  text?: string;
}

/**
 * Duvar apliki / lamba: görünen u (ya da us: [u, …]); tekrar eden katlarda s: [k0, k1] + referans kat k ile görünen
 * y (kat çizgisine göre) ya da yRel (döşemeden gerçek m); tek lamba için yalnız görünen y. style: cylinder (beyaz /
 * koyu silindir, dir: down | up | both ışık ucu), spot (kollu, aşağı eğik), lantern (klasik camlı fener), globe
 * (küre), box (düz kutu aplik). d çap/en (m, 0.1), h boy (m, 0.22), proud duvardan eksen uzaklığı (m, 0.12),
 * color gövde, tip ışık ucu rengi. Girintinin içine düşen lamba girinti arka duvarında.
 */
export interface Lamp {
  t: 'lamp';
  u?: number;
  us?: number[];
  y?: number;
  k?: number;
  s?: Storeys;
  yRel?: number;
  style?: 'cylinder' | 'spot' | 'lantern' | 'globe' | 'box';
  d?: number;
  h?: number;
  proud?: number;
  color?: string;
  tip?: string;
  dir?: 'down' | 'up' | 'both';
}

/**
 * Çatı penceresi (alınlıklı dormer / gablet) — bu kenarın çatı yüzünde. Konum: görünen u0..u1 (dormer ön yüzü,
 * setback derinliğine göre düzeltilir) YA DA merkez u + genişlik w (m) YA DA dünya x, z + w (hava fotoğrafı).
 * setback: ön yüzün duvar yüzünden geride yatay uzaklığı (m, 2.0). Yükseklik: ridge (tepe kotu duvar üstünden m;
 * ör. 1480041345 "ridgeAboveEave 1.2") ya da h (tepe, ön yüzün çatıya oturduğu çizgiden m). wallH: yanak (düşey
 * yan) boyu (0 → üçgen gablet), pitch dormer çatı eğimi (derece, 45). color ön yüz / yanak, roofC ("tile"), trim
 * rüzgârlık tahtası {w, color}, win {w, h, sill, split, curt, frameC} ortalı pencere (m).
 */
export interface Dormer {
  t: 'dormer';
  u0?: number;
  u1?: number;
  u?: number;
  w?: number;
  x?: number;
  z?: number;
  setback?: number;
  ridge?: number;
  h?: number;
  wallH?: number;
  pitch?: number;
  color?: string;
  roofC?: string;
  trim?: { w?: number; color?: string };
  win?: { w?: number; h?: number; sill?: number; split?: number; curt?: string; frameC?: string };
}

/**
 * Kemerli parapet / tonoz ön yüzü (ör. 1480163638 segmental kemerli parapet, 1480163637 kavisli tonoz parapet):
 * görünen u0..u1 (d > 0 ise ön yüz düzleminde), y taban (verilmezse duvar üstü), kemer tepesi yTop (görünen) ya da
 * rise (tabandan m), spring uçlardaki düşey kısım (m), shape segment | semi. thick kalınlık (m, 0.25), color,
 * coping {h, over, color} kemer boyunca harpuşta, vault > 0 → ön yüzden geriye uzanan tonoz çatı (m), roofC tonoz
 * kaplama rengi ("tile" / "#rrggbb"). İçine düşen çatı arası pencereleri (win k = storeys) ön yüzde açılır.
 */
export interface Arch {
  t: 'arch';
  u0: number;
  u1: number;
  y?: number;
  yTop?: number;
  rise?: number;
  spring?: number;
  d?: number;
  shape?: 'segment' | 'semi';
  thick?: number;
  color?: string;
  coping?: { h: number; over?: number; color?: string };
  vault?: number;
  roofC?: string;
}

/**
 * Çatı üstü öğe (bu kenarın çatısında): kind chimney (baca: w × depth gövde, cap {kind: hip | pyramid | flat |
 * none, h, color}, varsayılan kiremit kırma başlık), antenna (TV anteni direği), dish (çatı çanağı, w çap), vent
 * (havalandırma borusu). Konum görünen u (setback derinliğine göre düzeltilir) ya da dünya x, z; setback duvar
 * yüzünden geride (m, 1.0); h çatı yüzeyinden yükseklik (m). color gövde.
 */
export interface RoofObj {
  t: 'roofobj';
  kind: 'chimney' | 'antenna' | 'dish' | 'vent';
  u?: number;
  x?: number;
  z?: number;
  setback?: number;
  h?: number;
  w?: number;
  depth?: number;
  color?: string;
  cap?: { kind: 'hip' | 'pyramid' | 'flat' | 'none'; h?: number; color?: string };
}

/**
 * Cephede yol boyunca şerit (boya ya da hafif kabartma, kavisli olabilir; ör. 1540901798 beyaz kavisli düşey şerit):
 * pts görünen [u, y] noktaları, w genişlik (m, 0.1), d çıkıntı (m, 0.01), color.
 */
export interface Ribbon {
  t: 'ribbon';
  pts: [number, number][];
  w?: number;
  d?: number;
  color?: string;
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
  /** Uç biçimi: round (yarım yuvarlak, varsayılan), point (sivri, ör. 1480041345 e7), flat (düz) */
  top?: 'round' | 'point' | 'flat';
  bottom?: 'round' | 'point' | 'flat';
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
   * kenarda yazılırsa derinlikler birbirinin genişliğinden otomatik çıkarılır. v6: ORTASI locaya düşen ölçülmüş
   * `win` öğeleri (aynı kenarın u/y'siyle yazılır) loca ARKA duvarında çizilir — o katta üreticinin otomatik kapı +
   * penceresi yerine (sürme kapılar, kat kat perdeler; 1550614218 batı locaları). Saksılar (pots) locada da çizilir.
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
   * v6: d < 0.35 + `inset` + bulge → KAVİSLİ GÖMÜK LOCA: loca derinliği (inset) korunur, döşeme alnı / korkuluk /
   * cam taban izi hattından yay boyunca dışarı taşar (1540901770/71 güney cumba locaları).
   */
  bulge?: number;
  /**
   * v6: ortak yay açıklığı [u0, u1] (görünen, balkon ön yüzünde): bulge parabolü öğenin kendi u0..u1'i yerine bu
   * aralıkta hesaplanır → füme uç bölmeleri / kat grupları yüzünden ayrı `bal` öğelerine bölünmüş bir yığın TEK
   * sürekli yay olur (yayın uçlarında sehim 0, ortasında bulge). Aynı yaya ait her öğeye aynı arc + bulge yaz
   * (1541439435 kenar 1, 1541439437 batı yığınları).
   */
  arc?: [number, number];
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
  /** Saksı çiçek renkleri (sırayla, "#rrggbb" listesi) */
  flowerC?: string[];
  /**
   * Kat → CAM BALKON içi fon perde rengi "#rrggbb" (ör. 1480041300 kuzey yığın K1–K3 kiremit-kahve) ve kapanma oranı
   * curtF (0..1, ~2.9 m'lik bölmelerde iki yana toplanmış; varsayılan 0.3). Yalnız glazed katlarda.
   */
  curtC?: Record<string, string>;
  curtF?: Record<string, number>;
  /**
   * Kat → camın DIŞINDA demir parmaklık: arched (bölme başına yarım daire kemer + ≈12 cm dikey çubuk; 1540901795 /
   * 96 K0), bars (düz çubuk). grilleC renk (#2f3438), grilleW kemer bölmesi (m, 0.9). Yalnız glazed katlarda.
   */
  grille?: Record<string, 'arched' | 'bars'>;
  grilleC?: string;
  grilleW?: number;
  /**
   * Tavan gömme spotları (verilmezse tavan ortasında 1 adet): n adet ya da every (m, 2.7) aralık, ön kenardan
   * inset (m, 0.5), çap d (m, 0.1); cap: true → tepe şapkasının altında da.
   */
  spots?: { n?: number; every?: number; inset?: number; d?: number; cap?: boolean };
  /** Cam korkuluk dikme aralığı (m, varsayılan 1.2; ör. 1540901795 ≈1.0) ve kesiti (m, 0.03); dikmeler railC renginde */
  postEvery?: number;
  postW?: number;
  /**
   * Kat → DOLU parapet (solid / glass / solidTube) üstünde ince (Ø4 cm) çelik küpeşte: parapet üstünden yükseklik
   * (m; 0 = üstüne oturur, > 0.05 → kısa dikmeli; 1540901798 ≈0.04, 900000104 ≈0.15). Renk railC.
   */
  hand?: Record<string, number>;
  /** Kat → dolu parapet üstü harpuşta / başlık {h, color, over} (ör. 900000104 K2–K5 koyu lacivert 0.09 m) */
  coping?: Record<string, { h: number; color?: string; over?: number }>;
  /** Tepe şapkası (`cap`) rengi (palet adı / "#rrggbb"; ör. 1480041344 #cbccc6) ve kalınlığı (m; 42/43 ≈1.0) */
  capC?: string;
  capH?: number;
  /**
   * Eğik şapka: üst yüz çatı eğimini izler, alt yüz düz. dir: şapkanın ALÇALDIĞI yön — u0 / u1 (kenar boyunca, ör.
   * alınlık eğiminin devamı), out (duvardan dışa doğru). pitch (derece; verilmezse roof.pitch).
   */
  capSlope?: { pitch?: number; dir: 'u0' | 'u1' | 'out' };
  /** Şapka alın üst kenarında ince metal damlalık {h, color} */
  capTrim?: { h: number; color?: string };
  /** Şapka üstü teras korkuluğu (Bal.rail tipleri), metal rengi, küpeşte yüksekliği (düz şapkada, dış kenarlarda) */
  capRail?: 'glass' | 'glassFull' | 'tube' | 'bars' | 'solid' | 'solidTube';
  capRailC?: string;
  capRailH?: number;
  /**
   * Kat → AÇIK balkonda bambu / hasır stor rengi "#rrggbb" (tavandan korkuluk üstüne iner, korkuluğun arkasında; ön
   * kenarlarda). blindTo: alt kenarın döşemeden yüksekliği (m; varsayılan küpeşte). Ör. 1480041301 e8 K2 #b08a5f.
   */
  blinds?: Record<string, string>;
  blindTo?: Record<string, number>;
  /**
   * true: balkon arkasına ölçülmüş pencere yazılsa da varsayılan balkon kapısı korunur (en geniş boş aralığa; ör.
   * 1480041300 K1 orta yığın beyaz parmaklıklı pencere + kapı).
   */
  keepDoor?: boolean;
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
    /** Fransız korkuluk (yatay paslanmaz borular), dikey bölme sayısı, doğrama rengi */
    rail?: boolean;
    split?: number;
    frameC?: string;
  }[];
  /** Üstü teras olan çıkma / tek katlı ek: dış üç kenarda korkuluk (Bal.rail tipleri), metal rengi, parapet boyu */
  topRail?: 'glass' | 'glassFull' | 'tube' | 'bars' | 'solid' | 'solidTube' | 'none';
  topRailC?: string;
  topParH?: number;
  /** Teras korkuluğu küpeşte yüksekliği (m, varsayılan 0.92) */
  topRailH?: number;
  /**
   * Duvar hattının GERİSİNE uzanım (m): çatıdan yükselen merdiven kulesi başlığı gibi kütleler (y0 = duvar üstü,
   * y1 = başlık üstü; derinlik görülmediyse notta yaz). Ön yüz pencereleri `wins`.
   */
  back?: number;
  /** Üst yüz rengi (ör. paslı kahve saç kapak) ve üstte taşan şapka {h, over, color} */
  topC?: string;
  cap?: { h: number; over?: number; color?: string };
  /**
   * Derzli kaplama dokusu (ön ve yan yüzler): dir v (dikey derz, varsayılan) / h, every aralık (m), w derz genişliği
   * (m, 0.02), color derz rengi. Tek tek groove yerine (0.14 m aralıkta yüzlerce şerit titreşir; 900000105 / 106).
   */
  clad?: { dir?: 'v' | 'h'; every: number; w?: number; color?: string };
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
  /** round: yuvarlak rozet, oval: elips tabela (ör. 900000106 3.0 × 1.3 m "LINENS") */
  shape?: 'round' | 'oval';
  /**
   * Monogram / glif (text yerine): yan yana harfler, mirror: true → ayna simetrik (ör. KUDRET ayna K + R),
   * join bindirme oranı (0..0.8, 0.25). Yazı tipi font (serif …), renk fg.
   */
  glyphs?: { ch: string; mirror?: boolean }[];
  join?: number;
  /** Harfler 3B (katmanlı) çizilir: style "letters" ve d ≥ 0.015 (derinlik); varsayılan d 0.04 */
}

/**
 * Sıva derzi / kanal (görünen): h = yatay (u0..u1, y; u verilmezse tüm kenar), v = dikey (u, y0..y1). Genişlik w
 * (gerçek m, varsayılan 0.03), renk color ("#rrggbb", verilmezse koyu gri). Çift derzleri iki öğe olarak yaz. v6:
 * saçak alnı / parapet bölgesindeki derzler (duvar üstünün üstünde) o yüzeyin önünde çizilir; alınlık kenarında
 * alınlık çizgisine kadar. Çok sık (≤ 0.2 m) düzenli derzler için panel / proj `clad` kullan.
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
  /**
   * Balkon korkuluğunda / önünde (u balkon ön yüzünde görünen, d = 1.4 ile düzeltilir): klima 1.0 m, çanak 1.35 m,
   * bayrak 1.45 m önde çizilir (duvara monte değil).
   */
  onBal?: boolean;
  /** Kamera: dome (beyaz kubbe kamera), bullet (kollu silindir CCTV), box (varsayılan kutu); renk */
  style?: 'dome' | 'bullet' | 'box';
  color?: string;
  /** Kamera: duvardan uzaklık (m) — önündeki dikme / ayak üzerindeyse (ör. 1480041342 orta direk d≈1.0) */
  off?: number;
  /** Kamera: çift (cephe boyunca iki yana bakan iki bullet kamera) */
  pair?: boolean;
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
  /** Derzli kaplama dokusu (Proj.clad ile aynı) */
  clad?: { dir?: 'v' | 'h'; every: number; w?: number; color?: string };
}

/** Farklı renkli sıva alanı (görünen) */
export interface Panel {
  t: 'panel';
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  color: 'plaster2' | 'strip' | 'fascia' | string;
  /** Derzli kaplama dokusu (Proj.clad ile aynı; ör. 900000106 kahverengi kaplama 0.14 m dikey derz) */
  clad?: { dir?: 'v' | 'h'; every: number; w?: number; color?: string };
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
