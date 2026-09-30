/**
 * Ağaç türü kütüphanesi: tür anahtarları, model başvuru boyları ve serbest metinden tür ayrıştırma.
 * Worker'da da çalışır (THREE yok). Tür kanıtları, tanıma ipuçları ve örneklenen renkler: docs/TREES.md.
 *
 * İndeksler kalıcıdır (fixedTrees / payload sayısal tür taşır): 0–2 eski üç genel türle aynı anlamdadır
 * (0 yuvarlak yaprak döken, 1 iğne yapraklı, 2 oval/dik yaprak döken) → eski veriler geriye uyumlu.
 * Yeni tür eklerken listenin SONUNA ekleyin.
 */
export const SPECIES = [
  'deciduous', // 0 genel yuvarlak taçlı yaprak döken (tür görülmedi / hava fotoğrafı)
  'conifer', // 1 genel iğne yapraklı (çam tipi)
  'deciduous-oval', // 2 genel dik/oval taçlı yaprak döken (kavak, huş tipi)
  'cedrus', // 3 Himalaya sediri (Cedrus deodara)
  'picea-pungens', // 4 mavi ladin (Picea pungens 'Glauca')
  'goldcrest', // 5 limoni servi (Cupressus macrocarpa 'Goldcrest') / budanmamış leylandi konisi
  'cupressus', // 6 Akdeniz servisi, sütun (Cupressus sempervirens)
  'thuja', // 7 mazı / doğu mazısı küçük yumurta-koni (Thuja, Platycladus)
  'trachycarpus', // 8 Çin yelpaze palmiyesi (Trachycarpus fortunei)
  'tilia', // 9 ıhlamur (Tilia)
  'ulmus', // 10 karaağaç tipi geniş kubbe (Ulmus / Celtis)
  'robinia', // 11 yalancı akasya (Robinia pseudoacacia)
  'robinia-globe', // 12 top akasya (Robinia pseudoacacia 'Umbraculifera')
  'koelreuteria', // 13 sabun ağacı (Koelreuteria paniculata)
  'prunus-purple', // 14 kan erik (Prunus cerasifera 'Pissardii')
  'eriobotrya', // 15 yenidünya (Eriobotrya japonica)
  'fruit', // 16 küçük meyve ağacı (tür görülmedi)
  'glossy', // 17 parlak yapraklı her dem yeşil küçük ağaç (Photinia / Ligustrum tipi)
  'sapling', // 18 genç, kazıklı fidan
  'boxwood', // 19 budanmış şimşir topu (Buxus)
  'pinea', // 20 fıstık çamı (Pinus pinea): şemsiye taç, çıplak gövde
] as const;

export type SpeciesKey = (typeof SPECIES)[number];
export const SPECIES_COUNT = SPECIES.length;

export function speciesIndex(key: SpeciesKey): number {
  return SPECIES.indexOf(key);
}

export function speciesKey(i: number): SpeciesKey {
  return SPECIES[i] ?? 'deciduous';
}

export interface SpeciesSize {
  /** Modelin başvuru boyu ve taç genişliği (m) — ölçek bunlara göre hesaplanır */
  h: number;
  w: number;
  /** Çarpışma: gövde yarıçapı (m, başvuru boyunda) */
  trunk: number;
  /** Yaprak yere kadar (servi, mazı, şimşir): çarpışma taç tabanından */
  solid?: boolean;
  /** İğne yapraklı mı (hava fotoğrafı sınıflaması, istatistik) */
  conifer?: boolean;
}

/** Başvuru boyları: bölgedeki tipik örneklerden (docs/TREES.md) */
export const SPECIES_SIZE: Record<SpeciesKey, SpeciesSize> = {
  deciduous: { h: 7.5, w: 6, trunk: 0.18 },
  conifer: { h: 9, w: 5, trunk: 0.2, conifer: true },
  'deciduous-oval': { h: 9, w: 4.4, trunk: 0.16 },
  cedrus: { h: 10, w: 7.6, trunk: 0.24, conifer: true },
  'picea-pungens': { h: 4, w: 2.4, trunk: 0.08, conifer: true, solid: true },
  goldcrest: { h: 3, w: 1.3, trunk: 0.06, conifer: true, solid: true },
  cupressus: { h: 8, w: 1.4, trunk: 0.12, conifer: true, solid: true },
  thuja: { h: 1.6, w: 1.1, trunk: 0.05, conifer: true, solid: true },
  trachycarpus: { h: 3.6, w: 2.8, trunk: 0.11 },
  tilia: { h: 8, w: 5.6, trunk: 0.17 },
  ulmus: { h: 13, w: 13, trunk: 0.3 },
  robinia: { h: 9, w: 6.5, trunk: 0.18 },
  'robinia-globe': { h: 4.6, w: 3.4, trunk: 0.1 },
  koelreuteria: { h: 7, w: 5, trunk: 0.13 },
  'prunus-purple': { h: 6, w: 5, trunk: 0.13 },
  eriobotrya: { h: 4.5, w: 4.4, trunk: 0.12 },
  fruit: { h: 4.5, w: 3.8, trunk: 0.1 },
  glossy: { h: 4.5, w: 3.6, trunk: 0.08 },
  sapling: { h: 3.2, w: 1.6, trunk: 0.04 },
  boxwood: { h: 1, w: 1, trunk: 0.05, solid: true },
  pinea: { h: 8, w: 7, trunk: 0.2, conifer: true },
};

/**
 * Serbest metin (Türkçe / İngilizce / Latince tür adı, anahtar ya da ölçüm notu) → tür anahtarı.
 * İlk eşleşen kural kazanır; sıra önemlidir (özel adlar genelden önce). Bilinmeyen metin → en yakın genel tür.
 *
 * Anket (survey) ajanları için sözlük — `species` alanına aşağıdakilerden biri yazılabilir (anahtar ya da ad):
 * - cedrus ........... sedir, Himalaya sediri, Cedrus deodara, cedar
 * - picea-pungens .... mavi ladin, Picea pungens, blue spruce
 * - goldcrest ........ limoni servi, limon servisi, Cupressus macrocarpa, Goldcrest, leylandi (tek ağaç)
 * - cupressus ........ servi, selvi, Akdeniz/İtalyan servisi, Cupressus sempervirens, columnar cypress
 * - thuja ............ mazı, tuja, Thuja, Platycladus, ardıç (küçük koni)
 * - trachycarpus ..... palmiye, yelpaze palmiyesi, Trachycarpus, palm
 * - tilia ............ ıhlamur, Tilia, linden
 * - ulmus ............ karaağaç, çitlembik, dişbudak (geniş kubbe), Ulmus, Celtis, elm
 * - robinia .......... akasya, yalancı akasya, Robinia, black locust, sophora
 * - robinia-globe .... top akasya, Umbraculifera, globe
 * - koelreuteria ..... sabun ağacı, Koelreuteria
 * - prunus-purple .... kan erik, mor yapraklı erik, Prunus cerasifera Pissardii, purple-leaf
 * - eriobotrya ....... yenidünya, Eriobotrya, loquat
 * - fruit ............ meyve ağacı (kiraz, erik, elma, dut, ayva… tür belirsizse)
 * - glossy ........... alev ağacı (Photinia), kurtbağrı (Ligustrum), taflan, parlak yapraklı
 * - sapling .......... fidan, genç ağaç, kazıklı
 * - boxwood .......... şimşir, Buxus, top çalı
 * - pinea ............ fıstık çamı, Pinus pinea, umbrella / stone pine (şemsiye taç)
 * - conifer .......... çam, pine, iğne yapraklı (tür belirsiz)
 * - deciduous-oval ... kavak, huş, söğüt, oval taç
 * - deciduous ........ yaprak döken, yapraklı (tür belirsiz)
 */
const RULES: [RegExp, SpeciesKey][] = [
  [/palm|palmiye|trachy|yelpaze|chamaerops|washingtonia|hurma/, 'trachycarpus'],
  [/goldcrest|limoni|limon serv|macrocarpa|leyland|cupressocyparis/, 'goldcrest'],
  [/sempervirens|italyan serv|akdeniz serv|sütun serv|columnar|ince serv/, 'cupressus'],
  [/thuja|tuja|mazı|platycladus|ardıç|juniper/, 'thuja'],
  [/pungens|mavi ladin|blue spruce|glauca/, 'picea-pungens'],
  [/fıstık çam|pinus pinea|\bpinea\b|umbrella pine|stone pine|şemsiye çam/, 'pinea'],
  [/cedrus|sedir|cedar|deodar/, 'cedrus'],
  [/servi|selvi|cypress|cupressus/, 'cupressus'],
  [/şimşir|buxus|boxwood|top çalı|budanmış top/, 'boxwood'],
  [/umbraculifera|top akasya|globe|küre taç|top taç/, 'robinia-globe'],
  [/koelreuteria|sabun ağac|golden ?rain/, 'koelreuteria'],
  [/pissardii|cerasifera|kan erik|mor yaprak|kızıl yaprak|purple/, 'prunus-purple'],
  [/yenidünya|eriobotrya|loquat|malta eri/, 'eriobotrya'],
  [/photinia|alev ağac|ligustrum|kurtbağrı|taflan|laurocerasus|defne|laurus|parlak yaprak|glossy/, 'glossy'],
  [/ıhlamur|ihlamur|tilia|linden/, 'tilia'],
  [/robinia|akasya|acacia|locust|sophora|styphnolobium/, 'robinia'],
  [/karaağaç|ulmus|\belm\b|çitlembik|celtis|dişbudak|fraxinus/, 'ulmus'],
  [/fidan|sapling|kazık|genç ağaç/, 'sapling'],
  [
    /meyve|fruit|kiraz|cherry|\berik\b|plum|elma|apple|armut|pear|ayva|quince|\bdut\b|mulberry|kayısı|şeftali|incir|\bnar\b/,
    'fruit',
  ],
  [/ladin|spruce|köknar|abies|\bfir\b|picea|çam|pine|pinus|conifer|iğne yaprak|ibreli/, 'conifer'],
  [/kavak|poplar|populus|söğüt|willow|huş|birch|aspen|oval/, 'deciduous-oval'],
];

/** Genel (tür belirsiz) anahtarlar 0, yarı genel (fidan, meyve) 1, belirli türler 2 */
function rank(k: SpeciesKey): number {
  if (k === 'deciduous' || k === 'conifer' || k === 'deciduous-oval') return 0;
  if (k === 'fruit' || k === 'sapling') return 1;
  return 2;
}

function match(raw: string): SpeciesKey | null {
  if (!raw) return null;
  // Türkçe büyük harfler (İ, I) iki biçimde küçültülür: "IHLAMUR" → ıhlamur, "Italian" → italian
  const variants = [raw.toLocaleLowerCase('tr'), raw.toLowerCase()];
  for (const t of variants) if ((SPECIES as readonly string[]).includes(t)) return t as SpeciesKey;
  for (const [re, k] of RULES) if (variants.some((t) => re.test(t))) return k;
  return null;
}

/**
 * Tür alanı + not: ikisinden daha belirli olanı kazanır (eşitlikte tür alanı). Örn. species "fruit" + not
 * "Yenidünya (Eriobotrya…)" → eriobotrya; species "deciduous" + not "fidan" → sapling.
 */
export function parseSpecies(s?: string, note?: string): SpeciesKey {
  const a = match((s ?? '').trim());
  const b = match(note ?? '');
  if (a && b) return rank(b) > rank(a) ? b : a;
  return a ?? b ?? 'deciduous';
}
