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

export type FacadeItem = Win | Strip | Bal | Pipe | Unit | Band | Panel | Entrance;

/** Pencere / kapı sütunu (her katta aynı yerde tekrar eden açıklık) */
export interface Win {
  t: 'win';
  u0: number;
  u1: number;
  /** Referans katta alt (denizlik) ve üst (lento) görünen yükseklik */
  y0: number;
  y1: number;
  /** Referans kat */
  k: number;
  /** Tekrar aralığı */
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
  /** Cam balkon görünümü (kat → tür): clear, green (yeşil yansıma), dark, blinds (zebra/stor perde) */
  tint?: Record<string, 'clear' | 'green' | 'dark' | 'blinds'>;
  /** En üst katın üstünde büyük düz saçak plağı (koyu gri alınlı "şapka") */
  cap?: boolean;
  /** Yan kapanış: open (iki yan açık), wall (iki yanda duvar/girinti), start-wall / end-wall (tek yan) */
  sides?: 'open' | 'wall' | 'start-wall' | 'end-wall';
}

/** Yağmur borusu (tam boy, koyu gri) */
export interface Pipe {
  t: 'pipe';
  u: number;
  /** Duvardan uzaklık (m) — balkon önünden geçenler için ~1.4 */
  off?: number;
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
