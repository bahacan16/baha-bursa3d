/**
 * Ayak altı zemin türleri ve ayak sesi eşlemesi.
 *
 * Zemin öncelik sırası (OsmSoundScene.surfaceAt): rögar/ızgara (sokak planı) → ölçülmüş site/park alanları →
 * araç yolu / kaldırım (GroundIndex) → OSM alan türü → hava fotoğrafı rengi → çim.
 */
export type FootSurface =
  | 'asphalt'
  | 'pavers'
  | 'concrete'
  | 'stone'
  | 'grass'
  | 'soil'
  | 'gravel'
  | 'metal'
  | 'wood'
  | 'rubber'
  | 'water';

export const FOOT_SURFACES: readonly FootSurface[] = [
  'asphalt',
  'pavers',
  'concrete',
  'stone',
  'grass',
  'soil',
  'gravel',
  'metal',
  'wood',
  'rubber',
  'water',
];

/** Kayıt yoksa kullanılacak sentez türü (eski prosedürel ses). */
export type StepSynth = 'hard' | 'soft' | 'gravel' | 'metal' | 'wood';

export interface FootProfile {
  /** Denenecek örnek bankaları (manifest yuvaları), ilk bulunan kullanılır. */
  banks: readonly string[];
  /** Alçak geçiren süzgeç (Hz; 0 = yok) — yumuşak zeminlerde tizleri keser. */
  lowpass: number;
  /** Tiz raf kazancı (dB, 4 kHz üstü): sert/parlak zeminler. */
  bright: number;
  /** Düzey (dB). */
  gain: number;
  /** Çalma hızı çarpanı (perde). */
  rate: number;
  /** Yankı gönderme çarpanı (sert yüzeyler cephelerden daha çok yansır). */
  wet: number;
  synth: StepSynth;
  /** Rögar kapağı gibi metal çınlaması eklenecekse (Hz). */
  ring?: number;
}

const P = (
  banks: string[],
  synth: StepSynth,
  o: Partial<Omit<FootProfile, 'banks' | 'synth'>> = {},
): FootProfile => ({
  banks,
  synth,
  lowpass: o.lowpass ?? 0,
  bright: o.bright ?? 0,
  gain: o.gain ?? 0,
  rate: o.rate ?? 1,
  wet: o.wet ?? 1,
  ring: o.ring,
});

/**
 * KARAR: kayıt bankaları sokak/zemin başına; aynı ayakkabı (spor ayakkabı) tercih edildi. Eksik bankada en yakın
 * akustik komşuya düşülür (ör. kilit taşı → beton → asfalt), hiçbiri yoksa sentez.
 */
const PROFILES: Record<FootSurface, FootProfile> = {
  asphalt: P(['step_asphalt', 'step_concrete', 'step_pavers'], 'hard', { lowpass: 9000, wet: 1 }),
  pavers: P(['step_pavers', 'step_concrete', 'step_asphalt'], 'hard', { bright: 1, wet: 1 }),
  concrete: P(['step_concrete', 'step_pavers', 'step_asphalt'], 'hard', { wet: 1 }),
  // Traverten / mermer plak: daha sert ve parlak
  stone: P(['step_concrete', 'step_pavers', 'step_asphalt'], 'hard', { bright: 3, rate: 1.04, wet: 1.1 }),
  grass: P(['step_grass', 'step_soil'], 'soft', { wet: 0.35 }),
  soil: P(['step_soil', 'step_grass', 'step_gravel'], 'soft', { lowpass: 5000, wet: 0.4 }),
  gravel: P(['step_gravel', 'step_soil'], 'gravel', { wet: 0.6 }),
  // Dökme demir rögar kapağı / ızgara: tabanda beton adımı + kısa metal çınlaması
  metal: P(['step_metal', 'step_concrete', 'step_asphalt'], 'metal', { ring: 820, wet: 1.1 }),
  wood: P(['step_wood', 'step_concrete'], 'wood', { wet: 0.8 }),
  // Kauçuk oyun alanı karosu: boğuk, alçak
  rubber: P(['step_rubber', 'step_concrete', 'step_asphalt'], 'soft', {
    lowpass: 1600,
    gain: -7,
    rate: 0.9,
    wet: 0.3,
  }),
  water: P(['step_water', 'step_concrete'], 'hard', { wet: 1 }),
};

export function footProfile(s: FootSurface): FootProfile {
  return PROFILES[s] ?? PROFILES.pavers;
}

/** Bankalardan ilk bulunan (yoksa null → sentez). */
export function pickBank(s: FootSurface, has: (slot: string) => boolean): string | null {
  for (const b of footProfile(s).banks) if (has(b)) return b;
  return null;
}

/**
 * Ölçülmüş site/park planı alan türü (site-plan.json, park-plan.json `kind`) → zemin.
 * `material` metni (Türkçe not) ek ipucu verir (ör. "ahşap").
 */
export function planSurface(kind: string, material = ''): FootSurface | null {
  const m = material.toLowerCase();
  if (/ahşap|ahsap|deck board|kompozit/.test(m)) return 'wood';
  switch (kind) {
    case 'lawn':
      return 'grass';
    case 'bed':
      return 'soil';
    case 'paving':
      return /beton ped|beton plak|düz beton/.test(m) ? 'concrete' : 'pavers';
    case 'deck':
      return 'stone';
    case 'court':
      return 'concrete';
    case 'playground':
      return /çakıl|kum/.test(m) ? 'gravel' : 'rubber';
    case 'gravel':
      return 'gravel';
    case 'pool':
      return 'water';
    default:
      return null;
  }
}

/**
 * OSM alan türü → zemin. 'hard' = sert ama malzemesi bilinmiyor (hava fotoğrafıyla ayrıştırılır).
 */
export function osmAreaSurface(kind: string): FootSurface | 'hard' | null {
  switch (kind) {
    case 'grass':
    case 'park':
    case 'wood':
    case 'scrub':
    case 'pitch':
    case 'cemetery':
    case 'farmland':
      return 'grass';
    case 'playground':
      return 'rubber';
    case 'construction':
      return 'gravel';
    case 'water':
      return 'water';
    case 'pedestrian':
      return 'pavers';
    case 'parking':
    case 'residential':
    case 'commercial':
    case 'industrial':
    case 'school':
      return 'hard';
    default:
      return null;
  }
}

/**
 * Hava fotoğrafı pikseli (sRGB 0–255) → zemin. Yalnızca başka veri yokken kullanılır; bitki örtüsü yeşil,
 * koyu gri asfalt, açık gri/bej kilit taşı-beton, kahverengi toprak.
 * @param hard alanın sert olduğu biliniyorsa (otopark, site avlusu) yeşil dışı her şey sert sayılır
 */
export function aerialSurface(r: number, g: number, b: number, hard = false): FootSurface {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = max > 0 ? (max - min) / max : 0;
  const green = g > r + 6 && g >= b;
  if (green && sat > 0.12 && luma > 28) return 'grass';
  if (!hard && r > g && g > b && sat > 0.22 && luma > 60 && luma < 170) return 'soil';
  if (luma < 92 && sat < 0.2) return 'asphalt';
  return 'pavers';
}
