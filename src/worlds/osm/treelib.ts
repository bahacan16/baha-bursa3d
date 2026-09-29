import * as THREE from 'three';
import { generateEzTree, fitTree, crownAttributes, windTime, type EzTreeOptions } from './eztree';
import { leafAtlas, barkTexture, disposeLeafAtlas, tileUV, TILE } from './leafcards';
import { SPECIES_SIZE, type SpeciesKey } from './species';
import { farTreeGeometry, type FarShape } from './treemesh';
import { nightUniform } from '../../env/night';

/**
 * Tür modelleri: her tür için yakın (dal + yaprak kartı), orta (seyreltilmiş kart + ana dallar) ve uzak (düşük
 * poligonlu silüet) geometrileri. Tanıma ipuçları, kanıt kareleri ve renkler: docs/TREES.md.
 *
 * Üreteçler:
 * - ez: dallı ağaç (eztree.ts) + taç zarfı / sarkma / tepe eğilmesi ile tür silüeti
 * - shell: yaprağı yere kadar olan sık iğne yapraklılar (limoni servi, Akdeniz servisi, mazı, şimşir) — zarf
 *   üzerine yukarı kalkık pullu sürgün kartları + koyu iç çekirdek (gerçek bitki içi görünmez ama kenarı yumuşak)
 * - palm: Trachycarpus — lifli gövde, uzun saplı yelpaze yapraklar (kıvrık, uçları sarkık), alt yapraklar sarkık
 */

export type BarkKind = 'oak' | 'pine' | 'smooth' | 'palm';

interface EzGen {
  kind: 'ez';
  opts: EzTreeOptions;
  /** Yaprak kartı boyu (m, başvuru boyunda) */
  cardSize: number;
  normalBias?: number;
  /** Bu boy oranının altındaki yaprak kartları atılır (temiz gövdeli budanmış taç) */
  leafMinY?: number;
}
interface ShellGen {
  kind: 'shell';
  /** Taç profili: boy oranı t (0 dip … 1 tepe) → yarıçap oranı (0…1, en geniş = 1) */
  profile: (t: number) => number;
  /** Kart sayısı (başvuru boyunda) */
  cards: number;
  /** Kart boyu aralığı (m) */
  card: [number, number];
  /** Sürgünlerin yukarı kalkıklığı (0 yatay … 1 dik) */
  tilt: number;
  /** Tacın başladığı boy oranı (altında çıplak gövde) */
  base: number;
  /** İç çekirdeğin rengi (koyu) */
  core: number;
}
interface PalmGen {
  kind: 'palm';
  /** Gövde boyu oranı (başvuru boyuna göre) */
  trunk: number;
  fronds: number;
  /** Yaprak (sap + aya) boyu (m) */
  frond: number;
  /** Sarkık/yarı kurumuş alt yaprak sayısı */
  dead: number;
}

export interface SpeciesDef {
  gen: EzGen | ShellGen | PalmGen;
  tile: number;
  /** Köşe rengi çarpanı (atlas rengini türe göre ayarlar) */
  leafTint: number;
  bark: BarkKind;
  barkTint: number;
  /** Rüzgâr genliği çarpanı */
  wind: number;
  /** Orta LOD'da tutulan kart oranı */
  midKeep: number;
  far: FarShape;
}

// ─── Taç zarfları (gövde boyu birimi) ───
const ellipsoid =
  (cy: number, rx: number, ry: number) =>
  (x: number, y: number, z: number): number =>
    1 - ((x * x + z * z) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry));

/**
 * Tür tanımları. Parametreler ez-tree ön ayarlarından türetildi ve Street View / kullanıcı fotoğraflarıyla
 * karşılaştırılarak ayarlandı (docs/TREES.md). KARAR: her tür için tek model; örnekler döndürme, ölçek ve renk
 * sapmasıyla çeşitlenir.
 */
export const SPECIES_DEFS: Record<SpeciesKey, SpeciesDef> = {
  deciduous: {
    gen: {
      kind: 'ez',
      cardSize: 1.25,
      opts: {
        seed: 36330,
        type: 'deciduous',
        levels: 3,
        angle: [0, 48, 70, 60],
        children: [5, 3, 2],
        force: -0.04,
        gnarliness: [0.03, 0.22, 0.2, 0.09],
        length: [43, 25, 10, 4.6],
        radius: [2, 0.63, 0.76, 0.7],
        sections: [8, 6, 3, 2],
        segments: [8, 5, 3, 3],
        start: [0, 0.3, 0.33, 0],
        taper: [0.7, 0.7, 0.7, 0.7],
        twist: [0.09, -0.07, 0, 0],
        leaves: { angle: 55, count: 7, start: 0, size: 4.2, sizeVariance: 0.4, double: true },
      },
    },
    tile: TILE.broad,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0xd8d0c4,
    wind: 1,
    midKeep: 0.3,
    far: { kind: 'round', leaf: 0x5f7038, bark: 0x5d4d3e, crownBase: 0.35 },
  },
  conifer: {
    gen: {
      kind: 'ez',
      cardSize: 1.0,
      normalBias: 0.25,
      opts: {
        seed: 5521,
        type: 'evergreen',
        levels: 2,
        angle: [0, 68, 40],
        children: [30, 6],
        force: 0.002,
        gnarliness: [0.02, 0.06, 0.04],
        length: [50, 20, 6],
        radius: [1.2, 0.35, 0.5],
        sections: [10, 5, 2],
        segments: [7, 4, 3],
        start: [0, 0.32, 0.2],
        taper: [0.7, 0.7, 0.7],
        twist: [0, 0, 0],
        leaves: { angle: 35, count: 6, start: 0.1, size: 5, sizeVariance: 0.25, double: true },
      },
    },
    tile: TILE.pine,
    leafTint: 0xffffff,
    bark: 'pine',
    barkTint: 0xd0c4b8,
    wind: 0.55,
    midKeep: 0.35,
    far: { kind: 'cone', leaf: 0x3f5a2e, bark: 0x5a4332, crownBase: 0.3 },
  },
  'deciduous-oval': {
    gen: {
      kind: 'ez',
      cardSize: 1.1,
      opts: {
        seed: 18020,
        type: 'deciduous',
        levels: 2,
        angle: [0, 50, 32, 7],
        children: [10, 3, 3],
        force: 0.0148,
        gnarliness: [0.05, 0.12, 0.12, 0.02],
        length: [50, 8, 11, 1],
        radius: [0.72, 0.41, 0.7, 0.7],
        sections: [10, 5, 3, 3],
        segments: [7, 4, 3, 3],
        start: [0, 0.4, 0.35, 0],
        taper: [0.37, 0.13, 0.7, 0.7],
        twist: [0, 0, 0, 0],
        leaves: { angle: 30, count: 9, start: 0.1, size: 3.6, sizeVariance: 0.5, double: true },
      },
    },
    tile: TILE.fruit,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0xcfcac0,
    wind: 1,
    midKeep: 0.3,
    far: { kind: 'oval', leaf: 0x667a3c, bark: 0x5d4d3e, crownBase: 0.25 },
  },
  // Himalaya sediri: geniş piramit, yataya yakın sarkık katlar, eğik tepe sürgünü, gri-mavi yeşil tutamlar
  cedrus: {
    gen: {
      kind: 'ez',
      cardSize: 0.95,
      normalBias: 0.2,
      opts: {
        seed: 7071,
        type: 'evergreen',
        levels: 2,
        angle: [0, 86, 52],
        children: [30, 7],
        force: 0,
        // Gövde dik (tepe sürgünü yalnız leaderDroop ile eğilir), kollar uca doğru sarkar, sürgünler daha çok
        forceLevel: [0, -0.007, -0.014],
        gnarliness: [0.012, 0.05, 0.1],
        length: [52, 34, 10],
        radius: [1.3, 0.3, 0.45],
        sections: [14, 7, 3],
        segments: [8, 4, 3],
        start: [0, 0.06, 0.1],
        taper: [0.7, 0.7, 0.7],
        twist: [0, 0, 0],
        whorl: [0, 3, 0],
        leaderDroop: 0.7,
        leaves: { angle: 58, count: 9, start: 0.05, size: 5.2, sizeVariance: 0.3, double: true },
      },
    },
    tile: TILE.cedar,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0x9d9892,
    wind: 0.55,
    midKeep: 0.32,
    far: { kind: 'tiers', leaf: 0x4b5d3a, bark: 0x4a423c, crownBase: 0.04 },
  },
  // Mavi ladin: simetrik dar koni, sert yatay katlar, gümüşi mavi
  'picea-pungens': {
    gen: {
      kind: 'ez',
      cardSize: 0.55,
      normalBias: 0.2,
      opts: {
        seed: 4401,
        type: 'evergreen',
        levels: 2,
        angle: [0, 74, 50],
        children: [30, 6],
        force: 0,
        forceLevel: [0.0005, 0.0004, 0.001],
        gnarliness: [0.008, 0.02, 0.04],
        length: [50, 24, 7],
        radius: [1.1, 0.3, 0.45],
        sections: [12, 5, 2],
        segments: [7, 4, 3],
        start: [0, 0.02, 0.1],
        taper: [0.7, 0.7, 0.7],
        twist: [0, 0, 0],
        whorl: [0, 5, 0],
        leaves: { angle: 45, count: 7, start: 0.05, size: 3, sizeVariance: 0.2, double: true },
      },
    },
    tile: TILE.spruce,
    leafTint: 0xffffff,
    bark: 'pine',
    barkTint: 0xa8a098,
    wind: 0.35,
    midKeep: 0.4,
    far: { kind: 'cone', leaf: 0x6f8580, bark: 0x5a4a3c, crownBase: 0.03 },
  },
  // Limoni servi: yumuşak alev biçimli koni, limon yeşili tüysü sürgünler
  goldcrest: {
    gen: {
      kind: 'shell',
      profile: (t) => Math.pow(Math.min(1, t / 0.22), 0.6) * Math.pow(Math.max(0, 1 - t), 0.85) * 1.12,
      cards: 720,
      card: [0.22, 0.42],
      tilt: 0.62,
      base: 0.04,
      core: 0x3f5424,
    },
    tile: TILE.goldcrest,
    leafTint: 0xffffff,
    bark: 'smooth',
    barkTint: 0x6b5a48,
    wind: 0.45,
    midKeep: 0.4,
    far: { kind: 'cone', leaf: 0x7f963e, bark: 0x5a4a3c, crownBase: 0.03 },
  },
  // Akdeniz servisi: dar sütun, koyu yeşil, sıkı dikey sürgünler
  cupressus: {
    gen: {
      kind: 'shell',
      profile: (t) => Math.pow(Math.min(1, t / 0.15), 0.5) * Math.pow(Math.max(0, 1 - t), 0.55) * 1.05,
      cards: 900,
      card: [0.35, 0.6],
      tilt: 0.88,
      base: 0.03,
      core: 0x223018,
    },
    tile: TILE.thuja,
    leafTint: 0x9aa08a,
    bark: 'smooth',
    barkTint: 0x5a4a3c,
    wind: 0.3,
    midKeep: 0.4,
    far: { kind: 'column', leaf: 0x34482a, bark: 0x4a3e32, crownBase: 0.03 },
  },
  // Mazı / doğu mazısı: küçük yumurta-koni, parlak yeşil dikey yassı sürgünler
  thuja: {
    gen: {
      kind: 'shell',
      // Sivri yumurta-koni: en geniş yer boyun ~%30'u, tepe sivri (KD köşe adası, 2ydcI 183)
      profile: (t) =>
        t < 0.3 ? Math.sqrt(Math.sin(((t / 0.3) * Math.PI) / 2)) : Math.pow((1 - t) / 0.7, 0.72),
      cards: 440,
      card: [0.24, 0.4],
      tilt: 0.72,
      base: 0.02,
      core: 0x22341a,
    },
    tile: TILE.thuja,
    leafTint: 0xffffff,
    bark: 'smooth',
    barkTint: 0x5a4a3c,
    wind: 0.3,
    midKeep: 0.45,
    far: { kind: 'egg', leaf: 0x5a7a34, bark: 0x4a3e32, crownBase: 0.02 },
  },
  // Çin yelpaze palmiyesi
  trachycarpus: {
    gen: { kind: 'palm', trunk: 0.5, fronds: 30, frond: 1.85, dead: 6 },
    tile: TILE.palm,
    leafTint: 0xffffff,
    bark: 'palm',
    barkTint: 0x6e5a48,
    wind: 1.25,
    midKeep: 1,
    far: { kind: 'palm', leaf: 0x3f5530, bark: 0x4a3c30, crownBase: 0.55 },
  },
  // Ihlamur: yoğun yumurta/oval taç, kalp yapraklar (gümüşi alt yüzler)
  tilia: {
    gen: {
      kind: 'ez',
      cardSize: 1.2,
      opts: {
        seed: 9127,
        type: 'deciduous',
        levels: 3,
        angle: [0, 52, 58, 55],
        children: [7, 4, 3],
        force: 0.01,
        gnarliness: [0.02, 0.15, 0.18, 0.1],
        length: [40, 22, 9, 4],
        radius: [2, 0.55, 0.7, 0.7],
        sections: [8, 6, 3, 2],
        segments: [8, 5, 3, 3],
        start: [0, 0.34, 0.25, 0],
        taper: [0.7, 0.7, 0.7, 0.7],
        twist: [0.05, -0.05, 0, 0],
        envelope: ellipsoid(1.0, 0.62, 0.62),
        envelopeMin: 0.35,
        leaves: { angle: 50, count: 6, start: 0, size: 4, sizeVariance: 0.35, double: true },
      },
    },
    tile: TILE.tilia,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0xb8b4ac,
    wind: 0.95,
    midKeep: 0.3,
    far: { kind: 'oval', leaf: 0x5f6f38, bark: 0x57504a, crownBase: 0.3 },
  },
  // Karaağaç tipi: kısa gövde, erken çatallanan kalın kollar, geniş kubbe, ince sık yapraklar
  ulmus: {
    gen: {
      kind: 'ez',
      cardSize: 1.4,
      opts: {
        seed: 20417,
        type: 'deciduous',
        levels: 3,
        angle: [0, 38, 55, 55],
        children: [5, 5, 3],
        force: 0.004,
        gnarliness: [0.04, 0.2, 0.22, 0.12],
        length: [22, 34, 14, 5],
        radius: [2.2, 0.62, 0.62, 0.7],
        sections: [6, 7, 4, 2],
        segments: [9, 6, 3, 3],
        start: [0, 0.75, 0.3, 0],
        taper: [0.55, 0.7, 0.7, 0.7],
        twist: [0.05, -0.06, 0.02, 0],
        envelope: ellipsoid(1.55, 1.75, 1.2),
        envelopeMin: 0.4,
        leaves: { angle: 55, count: 8, start: 0, size: 5.5, sizeVariance: 0.35, double: true },
      },
    },
    tile: TILE.ulmus,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0xb5ac9e,
    wind: 0.8,
    midKeep: 0.28,
    far: { kind: 'dome', leaf: 0x4f5f30, bark: 0x4a443e, crownBase: 0.28 },
  },
  // Yalancı akasya: düzensiz, seyrek, açık taç; tüysü açık yeşil yapraklar, derin çatlaklı kabuk
  robinia: {
    gen: {
      kind: 'ez',
      cardSize: 1.3,
      opts: {
        seed: 31337,
        type: 'deciduous',
        levels: 3,
        angle: [0, 42, 55, 50],
        children: [5, 4, 2],
        force: 0.006,
        gnarliness: [0.06, 0.28, 0.25, 0.12],
        length: [45, 24, 10, 4],
        radius: [1.6, 0.55, 0.65, 0.7],
        sections: [8, 6, 3, 2],
        segments: [8, 5, 3, 3],
        start: [0, 0.42, 0.3, 0],
        taper: [0.7, 0.7, 0.7, 0.7],
        twist: [0.08, -0.1, 0.05, 0],
        leaves: { angle: 50, count: 6, start: 0.1, size: 4, sizeVariance: 0.35, double: true },
      },
    },
    tile: TILE.robinia,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0xc4b8a8,
    wind: 1.1,
    midKeep: 0.3,
    far: { kind: 'irregular', leaf: 0x6e8440, bark: 0x5d4d3e, crownBase: 0.4 },
  },
  // Top akasya: ~2 m temiz gövde üstünde sık küre taç
  'robinia-globe': {
    gen: {
      kind: 'ez',
      cardSize: 0.9,
      // ~2.1 m temiz gövde (7xGS 0, 4RYu 60): taç altına sarkan kart yok
      leafMinY: 0.44,
      opts: {
        seed: 12001,
        type: 'deciduous',
        levels: 3,
        angle: [0, 55, 45, 40],
        children: [9, 4, 2],
        force: 0.004,
        gnarliness: [0.01, 0.16, 0.2, 0.12],
        length: [30, 13, 6, 2.8],
        radius: [1.6, 0.55, 0.65, 0.7],
        sections: [6, 5, 3, 2],
        segments: [8, 5, 3, 3],
        start: [0, 0.95, 0.2, 0],
        taper: [0.55, 0.7, 0.7, 0.7],
        twist: [0, 0, 0, 0],
        envelope: ellipsoid(1.45, 0.62, 0.5),
        envelopeMin: 0.35,
        leaves: { angle: 50, count: 7, start: 0, size: 3, sizeVariance: 0.3, double: true },
      },
    },
    tile: TILE.robinia,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0xb8ada0,
    wind: 0.8,
    midKeep: 0.3,
    far: { kind: 'globe', leaf: 0x6f8a36, bark: 0x5d4d3e, crownBase: 0.44 },
  },
  // Sabun ağacı: açık, düzensiz kubbe; tepede turuncu-kahve kapsül salkımları (Eylül)
  koelreuteria: {
    gen: {
      kind: 'ez',
      cardSize: 1.25,
      opts: {
        seed: 7703,
        type: 'deciduous',
        levels: 3,
        angle: [0, 54, 55, 50],
        children: [6, 4, 2],
        force: 0.008,
        gnarliness: [0.05, 0.22, 0.2, 0.1],
        length: [38, 23, 9, 4],
        radius: [1.5, 0.55, 0.65, 0.7],
        sections: [8, 6, 3, 2],
        segments: [8, 5, 3, 3],
        start: [0, 0.4, 0.3, 0],
        taper: [0.7, 0.7, 0.7, 0.7],
        twist: [0.05, -0.05, 0, 0],
        leaves: { angle: 50, count: 6, start: 0.1, size: 4, sizeVariance: 0.35, double: true },
      },
    },
    tile: TILE.koelreuteria,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0xa89c90,
    wind: 1,
    midKeep: 0.3,
    far: { kind: 'irregular', leaf: 0x75884a, bark: 0x57493c, crownBase: 0.35 },
  },
  // Kan erik: yuvarlak sık taç, koyu şarap moru küçük yapraklar
  'prunus-purple': {
    gen: {
      kind: 'ez',
      cardSize: 0.95,
      opts: {
        seed: 5003,
        type: 'deciduous',
        levels: 3,
        angle: [0, 48, 55, 50],
        children: [6, 4, 3],
        force: 0.006,
        gnarliness: [0.04, 0.2, 0.2, 0.1],
        length: [30, 20, 8, 3.5],
        radius: [1.6, 0.55, 0.65, 0.7],
        sections: [7, 6, 3, 2],
        segments: [8, 5, 3, 3],
        start: [0, 0.45, 0.25, 0],
        taper: [0.7, 0.7, 0.7, 0.7],
        twist: [0.05, -0.05, 0, 0],
        envelope: ellipsoid(1.25, 0.95, 0.7),
        envelopeMin: 0.35,
        leaves: { angle: 50, count: 7, start: 0, size: 3.2, sizeVariance: 0.3, double: true },
      },
    },
    tile: TILE.prunusPurple,
    leafTint: 0xffffff,
    bark: 'smooth',
    barkTint: 0x5a4640,
    wind: 0.9,
    midKeep: 0.3,
    far: { kind: 'round', leaf: 0x4a2a2c, bark: 0x3d302a, crownBase: 0.35 },
  },
  // Yenidünya: alçak, yuvarlak, sık; iri deri yaprak rozetleri
  eriobotrya: {
    gen: {
      kind: 'ez',
      cardSize: 0.8,
      normalBias: 0.3,
      opts: {
        seed: 6121,
        type: 'deciduous',
        levels: 2,
        angle: [0, 50, 45],
        children: [8, 5],
        force: 0.01,
        gnarliness: [0.04, 0.15, 0.2],
        length: [24, 20, 8],
        radius: [1.8, 0.6, 0.7],
        sections: [6, 5, 3],
        segments: [8, 5, 3],
        start: [0, 0.3, 0.2],
        taper: [0.7, 0.7, 0.7],
        twist: [0, 0, 0],
        envelope: ellipsoid(1.05, 1.05, 0.8),
        envelopeMin: 0.4,
        leaves: { angle: 45, count: 11, start: 0.1, size: 4, sizeVariance: 0.3, double: true },
      },
    },
    tile: TILE.eriobotrya,
    leafTint: 0xffffff,
    bark: 'smooth',
    barkTint: 0x6f665c,
    wind: 0.6,
    midKeep: 0.35,
    far: { kind: 'round', leaf: 0x4f5f33, bark: 0x55493e, crownBase: 0.25 },
  },
  // Meyve ağacı (tür belirsiz): küçük, gevşek yuvarlak taç, açık yeşil
  fruit: {
    gen: {
      kind: 'ez',
      cardSize: 1.0,
      opts: {
        seed: 8811,
        type: 'deciduous',
        levels: 3,
        angle: [0, 50, 55, 50],
        children: [5, 4, 2],
        force: 0.008,
        gnarliness: [0.06, 0.24, 0.24, 0.1],
        length: [26, 19, 8, 3.5],
        radius: [1.5, 0.55, 0.65, 0.7],
        sections: [6, 6, 3, 2],
        segments: [8, 5, 3, 3],
        start: [0, 0.5, 0.25, 0],
        taper: [0.7, 0.7, 0.7, 0.7],
        twist: [0.06, -0.06, 0, 0],
        envelope: ellipsoid(1.3, 1.0, 0.75),
        envelopeMin: 0.35,
        leaves: { angle: 50, count: 7, start: 0.05, size: 3.4, sizeVariance: 0.35, double: true },
      },
    },
    tile: TILE.fruit,
    leafTint: 0xffffff,
    bark: 'oak',
    barkTint: 0xb0a698,
    wind: 1,
    midKeep: 0.3,
    far: { kind: 'round', leaf: 0x6a7e40, bark: 0x5a4a3c, crownBase: 0.35 },
  },
  // Parlak yapraklı her dem yeşil küçük ağaç: çok gövdeli, sık, koyu parlak
  glossy: {
    gen: {
      kind: 'ez',
      cardSize: 0.95,
      normalBias: 0.3,
      opts: {
        seed: 4242,
        type: 'deciduous',
        levels: 3,
        angle: [0, 22, 50, 50],
        children: [4, 5, 3],
        force: 0.012,
        gnarliness: [0.03, 0.12, 0.2, 0.1],
        length: [6, 30, 9, 3.5],
        radius: [1.1, 0.7, 0.6, 0.7],
        sections: [3, 7, 3, 2],
        segments: [6, 5, 3, 3],
        start: [0, 0.6, 0.35, 0],
        taper: [0.3, 0.7, 0.7, 0.7],
        twist: [0, 0, 0, 0],
        envelope: ellipsoid(4.3, 3.2, 3.4),
        envelopeMin: 0.35,
        leaves: { angle: 50, count: 9, start: 0, size: 3.2, sizeVariance: 0.3, double: true },
      },
    },
    tile: TILE.glossy,
    leafTint: 0xffffff,
    bark: 'smooth',
    barkTint: 0x5e4a40,
    wind: 0.7,
    midKeep: 0.3,
    far: { kind: 'oval', leaf: 0x34482a, bark: 0x4a3c34, crownBase: 0.2 },
  },
  // Fidan: ince tek gövde, birkaç kısa dal, seyrek küçük yapraklar
  sapling: {
    gen: {
      kind: 'ez',
      cardSize: 0.7,
      opts: {
        seed: 3003,
        type: 'deciduous',
        levels: 2,
        angle: [0, 42, 45],
        children: [6, 3],
        force: 0.01,
        gnarliness: [0.02, 0.12, 0.15],
        length: [50, 13, 5],
        radius: [0.5, 0.5, 0.6],
        sections: [8, 4, 2],
        segments: [6, 4, 3],
        start: [0, 0.62, 0.2],
        taper: [0.6, 0.7, 0.7],
        twist: [0, 0, 0],
        leaves: { angle: 45, count: 6, start: 0.1, size: 2.5, sizeVariance: 0.3, double: true },
      },
    },
    tile: TILE.sapling,
    leafTint: 0xffffff,
    bark: 'smooth',
    barkTint: 0x7a6a58,
    wind: 1.1,
    midKeep: 0.4,
    far: { kind: 'sapling', leaf: 0x5e6a36, bark: 0x5d5040, crownBase: 0.55 },
  },
  // Budanmış şimşir topu
  boxwood: {
    gen: {
      kind: 'shell',
      profile: (t) => Math.sqrt(Math.max(0, 1 - (2 * t - 1) * (2 * t - 1))),
      cards: 180,
      card: [0.16, 0.26],
      tilt: 0.3,
      base: 0,
      core: 0x243418,
    },
    tile: TILE.thuja,
    leafTint: 0x8c9c7c,
    bark: 'smooth',
    barkTint: 0x4a3e32,
    wind: 0.15,
    midKeep: 0.5,
    far: { kind: 'egg', leaf: 0x3c5228, bark: 0x3c3228, crownBase: 0 },
  },
};

// ─── Geometri yardımcıları ───

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Yaprak dörtgenlerini atlas karosuna eşle + köşe rengi (tür tonu × kart sapması × iç gölge) + rüzgâr */
function finishLeaves(g: THREE.BufferGeometry, def: SpeciesDef, seed: number, innerAO = true): void {
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = tileUV(def.tile, uv.getX(i), uv.getY(i));
    uv.setXY(i, u, v);
  }
  const lb = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  const c = lb.getCenter(new THREE.Vector3());
  const half = lb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const tint = new THREE.Color(def.leafTint);
  const col = new Float32Array(p.count * 3);
  const wind = new Float32Array(p.count).fill(def.wind);
  const r = rng(seed);
  // Dörtgen başına (4 köşe) aynı sapma
  for (let q = 0; q < p.count; q += 4) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 4; k++) {
      cx += p.getX(q + k) / 4;
      cy += p.getY(q + k) / 4;
      cz += p.getZ(q + k) / 4;
    }
    const d = Math.hypot(
      (cx - c.x) / Math.max(half.x, 0.1),
      (cy - c.y) / Math.max(half.y, 0.1),
      (cz - c.z) / Math.max(half.z, 0.1),
    );
    // Tacın içindeki kartlar gölgede (öz gölgeleme): içte ~0.7, kenarda 1 (gölge haritası da taç içini karartır;
    // 0.55 ile sedir/karaağaç Street View güneşli yamasından ~1.7× koyu çıkıyordu)
    const ao = innerAO ? 0.7 + 0.3 * THREE.MathUtils.smoothstep(d, 0.2, 0.95) : 1;
    const jit = 0.86 + r() * 0.26;
    for (let k = 0; k < 4; k++)
      col.set([tint.r * ao * jit, tint.g * ao * jit, tint.b * ao * jit], (q + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.BufferAttribute(wind, 1));
}

function colorAll(g: THREE.BufferGeometry, hex: number, base = 1, top = 1): void {
  const p = g.attributes.position;
  const c = new THREE.Color(hex);
  const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  const h = Math.max(1e-3, box.max.y - box.min.y);
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - box.min.y) / h;
    const k = base + (top - base) * t;
    arr.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/** Kart seyreltme (orta LOD): her kartı hash'e göre tut; tutulanlar merkezleri etrafında büyütülür. */
function decimateLeaves(
  g: THREE.BufferGeometry,
  quadsPerCard: number,
  keep: number,
  seed: number,
): THREE.BufferGeometry {
  if (keep >= 0.999) return g.clone();
  const r = rng(seed);
  return selectCards(g, quadsPerCard, () => r() < keep, Math.min(2.2, 1 / Math.sqrt(keep)));
}

/** Kart seçimi: `keep(kart merkezi y)` doğru olan kartlar kalır, merkezleri etrafında `s` kadar büyütülür */
function selectCards(
  g: THREE.BufferGeometry,
  quadsPerCard: number,
  keep: (cy: number) => boolean,
  s: number,
): THREE.BufferGeometry {
  const p = g.attributes.position;
  const vpc = 4 * quadsPerCard;
  const cards = Math.floor(p.count / vpc);
  const kept: number[] = [];
  for (let k = 0; k < cards; k++) {
    let cy = 0;
    for (let i = 0; i < vpc; i++) cy += p.getY(k * vpc + i) / vpc;
    if (keep(cy)) kept.push(k);
  }
  const out = new THREE.BufferGeometry();
  const names = Object.keys(g.attributes);
  const arrays: Record<string, Float32Array> = {};
  for (const n of names) {
    const a = g.attributes[n];
    arrays[n] = new Float32Array(kept.length * vpc * a.itemSize);
  }
  kept.forEach((k, j) => {
    const v0 = k * vpc;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < vpc; i++) {
      cx += p.getX(v0 + i) / vpc;
      cy += p.getY(v0 + i) / vpc;
      cz += p.getZ(v0 + i) / vpc;
    }
    for (const n of names) {
      const a = g.attributes[n];
      const dst = arrays[n];
      for (let i = 0; i < vpc; i++)
        for (let e = 0; e < a.itemSize; e++) dst[(j * vpc + i) * a.itemSize + e] = a.getComponent(v0 + i, e);
    }
    const P = arrays.position;
    for (let i = 0; i < vpc; i++) {
      const o = (j * vpc + i) * 3;
      P[o] = cx + (P[o] - cx) * s;
      P[o + 1] = cy + (P[o + 1] - cy) * s;
      P[o + 2] = cz + (P[o + 2] - cz) * s;
    }
  });
  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(arrays[n], g.attributes[n].itemSize));
  const idx: number[] = [];
  for (let q = 0; q < kept.length * quadsPerCard; q++) {
    const b = q * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

function subIndex(g: THREE.BufferGeometry, end: number): THREE.BufferGeometry {
  const out = g.clone();
  const idx = g.index!;
  out.setIndex(new THREE.BufferAttribute((idx.array as Uint32Array | Uint16Array).slice(0, end), 1));
  out.computeBoundingSphere();
  return out;
}

export interface ModelParts {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}
export interface SpeciesModel {
  key: SpeciesKey;
  def: SpeciesDef;
  near: ModelParts;
  mid: ModelParts;
  far: THREE.BufferGeometry;
  tris: { near: number; mid: number; far: number };
}

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

function buildEz(key: SpeciesKey, def: SpeciesDef, gen: EzGen): { near: ModelParts; mid: ModelParts } {
  const size = SPECIES_SIZE[key];
  // Önce ölçek bulunur, yaprak kartları gerçek boyda (m) olacak şekilde yeniden üretilir
  const probe = generateEzTree(gen.opts);
  const box = new THREE.Box3().setFromBufferAttribute(
    probe.leaves.attributes.position as THREE.BufferAttribute,
  );
  box.union(
    new THREE.Box3().setFromBufferAttribute(probe.branches.attributes.position as THREE.BufferAttribute),
  );
  const s = size.h / Math.max(1e-3, box.max.y);
  probe.branches.dispose();
  probe.leaves.dispose();
  const t = generateEzTree({ ...gen.opts, leaves: { ...gen.opts.leaves, size: gen.cardSize / s } });
  fitTree(t, size.h, size.w, gen.normalBias ?? 0.35);
  if (gen.leafMinY) {
    // Temiz gövde (top akasya): taç altına sarkan kartları at
    const minY = gen.leafMinY * size.h;
    const old = t.leaves;
    t.leaves = selectCards(old, t.quadsPerLeaf, (cy) => cy >= minY, 1);
    old.dispose();
  }
  finishLeaves(t.leaves, def, gen.opts.seed);
  colorAll(t.branches, def.barkTint, 0.82, 1.05);
  const midB = subIndex(t.branches, t.levelStart[Math.min(2, t.levelStart.length - 1)]);
  const midL = decimateLeaves(t.leaves, t.quadsPerLeaf, def.midKeep, gen.opts.seed + 1);
  return { near: { branches: t.branches, leaves: t.leaves }, mid: { branches: midB, leaves: midL } };
}

/** Kart: taban b, yön d (birim), boy L, genişlik W; iki çapraz dörtgen */
function pushCard(
  pos: number[],
  uv: number[],
  crown: number[],
  b: THREE.Vector3,
  d: THREE.Vector3,
  L: number,
  W: number,
  roll: number,
  cr: number,
): void {
  const side = new THREE.Vector3(0, 1, 0).cross(d);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize().applyAxisAngle(d, roll);
  const side2 = side.clone().applyAxisAngle(d, Math.PI / 2);
  for (const sd of [side, side2]) {
    const hw = W / 2;
    const tip = b.clone().addScaledVector(d, L);
    const v = [
      tip.clone().addScaledVector(sd, -hw),
      b.clone().addScaledVector(sd, -hw),
      b.clone().addScaledVector(sd, hw),
      tip.clone().addScaledVector(sd, hw),
    ];
    for (const q of v) pos.push(q.x, q.y, q.z);
    uv.push(0, 1, 0, 0, 1, 0, 1, 1);
    crown.push(cr, cr, cr, cr);
  }
}

function lathe(
  profile: (t: number) => number,
  h: number,
  rad: number,
  base: number,
  scale: number,
): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = base + ((1 - base) * i) / n;
    pts.push(new THREE.Vector2(Math.max(0.001, profile(t) * rad * scale), t * h));
  }
  const g = new THREE.LatheGeometry(pts, 12);
  return g;
}

function buildShell(key: SpeciesKey, def: SpeciesDef, gen: ShellGen): { near: ModelParts; mid: ModelParts } {
  const size = SPECIES_SIZE[key];
  const H = size.h;
  const R = size.w / 2;
  const r = rng(key.length * 7919 + gen.cards);
  const pos: number[] = [];
  const uv: number[] = [];
  const crown: number[] = [];
  // Yüzey alanına göre dağılım: t'yi profil yarıçapıyla ağırlıklandır
  const samples: number[] = [];
  let acc = 0;
  const N = 64;
  for (let i = 0; i < N; i++) {
    const t = gen.base + ((1 - gen.base) * (i + 0.5)) / N;
    acc += gen.profile(t) + 0.02;
    samples.push(acc);
  }
  const pickT = () => {
    const x = r() * acc;
    let i = 0;
    while (i < N - 1 && samples[i] < x) i++;
    return gen.base + ((1 - gen.base) * (i + r())) / N;
  };
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < gen.cards; k++) {
    const t = Math.min(0.995, pickT());
    const pr = gen.profile(t);
    const a = r() * Math.PI * 2;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    // Kart tabanı zarfın içinde (sürgün gövdeden çıkar), ucu zarfı biraz aşar
    const depth = 0.55 + r() * 0.4;
    const L = gen.card[0] + r() * (gen.card[1] - gen.card[0]);
    const b = new THREE.Vector3(out.x * pr * R * depth, t * H, out.z * pr * R * depth);
    // Profil eğiminden yüzey normali
    const dt = 0.02;
    const slope = ((gen.profile(Math.min(1, t + dt)) - gen.profile(Math.max(0, t - dt))) * R) / (2 * dt * H);
    const n = out.clone().addScaledVector(up, -slope).normalize();
    const d = n
      .clone()
      .multiplyScalar(1 - gen.tilt)
      .addScaledVector(up, gen.tilt);
    d.x += (r() - 0.5) * 0.35;
    d.z += (r() - 0.5) * 0.35;
    d.normalize();
    // Tabanı biraz içe çek → kart ortası zarf üstünde
    b.addScaledVector(d, -L * 0.35);
    pushCard(pos, uv, crown, b, d, L, L * 0.9, r() * Math.PI, t);
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  leaves.setAttribute('crown', new THREE.Float32BufferAttribute(crown, 1));
  const idx: number[] = [];
  for (let q = 0; q < pos.length / 12; q++) {
    const b0 = q * 4;
    idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  }
  leaves.setIndex(idx);
  crownAttributes(leaves, 0.25);
  finishLeaves(leaves, def, gen.cards, false);
  // Çekirdek (koyu iç kütle) + görünen kısa gövde
  const core = lathe(gen.profile, H, R, Math.max(0.01, gen.base), 0.78);
  colorAll(core, gen.core, 0.75, 1.1);
  const trunkH = Math.max(0.15, gen.base * H + 0.25);
  const trunk = new THREE.CylinderGeometry(size.trunk * 0.7, size.trunk, trunkH, 6, 1, true).translate(
    0,
    trunkH / 2,
    0,
  );
  colorAll(trunk, def.barkTint, 0.8, 1);
  const branches = mergeSimple([core, trunk]);
  const midL = decimateLeaves(leaves, 2, def.midKeep, gen.cards + 3);
  return { near: { branches, leaves }, mid: { branches, leaves: midL } };
}

/** Yalnız position/normal/uv/color taşıyan geometrileri birleştir */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const P: number[] = [];
  const Nn: number[] = [];
  const U: number[] = [];
  const C: number[] = [];
  const I: number[] = [];
  for (const g of parts) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const o = P.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    const c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      P.push(p.getX(i), p.getY(i), p.getZ(i));
      Nn.push(n.getX(i), n.getY(i), n.getZ(i));
      U.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      C.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) I.push(g.index.getX(i) + o);
    else for (let i = 0; i < p.count; i++) I.push(i + o);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  out.setIndex(I);
  out.computeBoundingSphere();
  return out;
}

/**
 * Trachycarpus fortunei: hafif eğik, üste doğru kalınlaşan lifli gövde; uzun saplı yelpaze yapraklar sarmal dizili
 * (üsttekiler dik, alttakiler yatık/sarkık); aya boyunca V katlı ve uca doğru sarkık ızgara.
 */
function buildPalm(key: SpeciesKey, def: SpeciesDef, gen: PalmGen): { near: ModelParts; mid: ModelParts } {
  const size = SPECIES_SIZE[key];
  const H = size.h;
  const th = H * gen.trunk;
  const r = rng(8123);
  // Gövde: kavisli, üstte kalın (lif örtüsü)
  const ring = 9;
  const segs = 8;
  const P: number[] = [];
  const U: number[] = [];
  const I: number[] = [];
  const lean = 0.06 * th;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const cx = lean * t * t;
    const rad = size.trunk * (0.85 + 0.35 * t);
    for (let j = 0; j <= ring; j++) {
      const a = (j / ring) * Math.PI * 2;
      P.push(cx + Math.cos(a) * rad, t * th, Math.sin(a) * rad);
      U.push(j / ring, t * th * 1.4);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < ring; j++) {
      const a = i * (ring + 1) + j;
      const b = a + ring + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  trunk.setIndex(I);
  trunk.computeVertexNormals();
  colorAll(trunk, def.barkTint, 0.75, 1);
  // Tepe: yaprak sapı dipleri (koyu lifli topuz)
  const knob = new THREE.SphereGeometry(size.trunk * 1.5, 8, 6).scale(1, 1.3, 1).translate(lean, th, 0);
  colorAll(knob, def.barkTint, 0.7, 0.9);
  const branches = mergeSimple([trunk, knob]);

  // Yapraklar: ızgara (u enine 5, v boyuna 8); v 0–0.38 sap (dokuda ince), 0.38–1 aya
  const pos: number[] = [];
  const uv: number[] = [];
  const crown: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const NU = 5;
  const NV = 8;
  const apex = new THREE.Vector3(lean, th + size.trunk * 0.8, 0);
  const total = gen.fronds + gen.dead;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let f = 0; f < total; f++) {
    const dead = f >= gen.fronds;
    const age = dead ? 1 : f / gen.fronds; // 0 genç (dik) … 1 yaşlı (yatık)
    const az = f * golden + r() * 0.3;
    // Sapın yükselme açısı: gençler ~70° dik, orta yaşlılar 30–45°, en yaşlılar yataya yakın, kurumuşlar gövdeye
    // doğru sarkık (1Jme 46, jeMF 127, yz6q 92: yelpaze "patlaması"; site-a-blok fotoğrafı: alt yapraklar yatık)
    const elev = dead
      ? -1.05 - r() * 0.35
      : THREE.MathUtils.lerp(1.2, -0.12, Math.pow(age, 1.15)) + (r() - 0.5) * 0.2;
    const L = gen.frond * (dead ? 0.85 : 0.8 + r() * 0.3) * (1 - 0.25 * (1 - age));
    const W = L * 0.78;
    const dir = new THREE.Vector3(
      Math.cos(az) * Math.cos(elev),
      Math.sin(elev),
      Math.sin(az) * Math.cos(elev),
    );
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
    // Ayanın yüzü: sap yönüne dik, hafif yukarı bakar
    const nrm = new THREE.Vector3().crossVectors(side, dir).normalize();
    const base = pos.length / 3;
    const droop = dead ? 0.1 : 0.15 + 0.25 * age;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      // Sap düz, aya boyunca aşağı kıvrılır
      const s = v * L;
      const bladeV = Math.max(0, (v - 0.38) / 0.62);
      const p = apex.clone().addScaledVector(dir, s);
      p.y -= droop * L * bladeV * bladeV;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        const x = (u - 0.5) * W;
        // V katı: kenarlar ayanın normaline doğru kalkık
        const fold = Math.abs(u - 0.5) * 2 * W * 0.16 * Math.min(1, bladeV * 3);
        const q = p.clone().addScaledVector(side, x).addScaledVector(nrm, fold);
        // Kenar dilimlerin uçları daha çok sarkar
        q.y -= Math.abs(u - 0.5) * 2 * bladeV * L * 0.12;
        pos.push(q.x, q.y, q.z);
        const [tu, tv] = tileUV(def.tile, u, v);
        uv.push(tu, tv);
        crown.push(v);
        const k = dead ? 0 : 1;
        // Kurumuş yapraklar kahverengi
        const c = dead ? [0.78, 0.62, 0.42] : [1, 1, 1];
        const jit = 0.88 + r() * 0.2;
        col.push(c[0] * jit * (0.8 + 0.2 * k), c[1] * jit, c[2] * jit);
      }
    }
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i;
        const b = a + NU + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  leaves.setAttribute('crown', new THREE.Float32BufferAttribute(crown, 1));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  leaves.setAttribute(
    'wind',
    new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3).fill(def.wind), 1),
  );
  leaves.setIndex(idx);
  // Başvuru boyuna eşit ölçek (sarkık yapraklar tepeyi alçaltır; ölçülen boy = gövde dibi → en yüksek yaprak ucu).
  // KARAR: palmiye orantısı korunur (tekdüze ölçek); taç genişliği ölçüm yarıçapından `fixedScale` ile gelir.
  const bb = new THREE.Box3().setFromBufferAttribute(leaves.attributes.position as THREE.BufferAttribute);
  bb.union(new THREE.Box3().setFromBufferAttribute(branches.attributes.position as THREE.BufferAttribute));
  const k = size.h / Math.max(1e-3, bb.max.y);
  leaves.scale(k, k, k);
  branches.scale(k, k, k);
  branches.computeBoundingSphere();
  leaves.computeVertexNormals();
  // Normalleri yukarı eğ (yelpazeler gökyüzünü görür, iki yüzlü)
  const n = leaves.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(n.getX(i), Math.abs(n.getY(i)) + 0.5, n.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  leaves.computeBoundingSphere();
  return { near: { branches, leaves }, mid: { branches, leaves } };
}

const modelCache = new Map<SpeciesKey, SpeciesModel>();

/** Tür modeli (önbellekli; yalnız sahnede bulunan türler için çağrılır) */
export function speciesModel(key: SpeciesKey): SpeciesModel {
  let m = modelCache.get(key);
  if (m) return m;
  const def = SPECIES_DEFS[key];
  const gen = def.gen;
  const parts =
    gen.kind === 'ez'
      ? buildEz(key, def, gen)
      : gen.kind === 'shell'
        ? buildShell(key, def, gen)
        : buildPalm(key, def, gen);
  const far = farTreeGeometry(def.far, SPECIES_SIZE[key]);
  m = {
    key,
    def,
    near: parts.near,
    mid: parts.mid,
    far,
    tris: {
      near: tris(parts.near.branches) + tris(parts.near.leaves),
      mid: tris(parts.mid.branches) + tris(parts.mid.leaves),
      far: tris(far),
    },
  };
  modelCache.set(key, m);
  return m;
}

const farCache = new Map<SpeciesKey, THREE.BufferGeometry>();

/** Yalnız uzak silüet (düşük kalite: ez/kart üretimi yapılmaz) */
export function farModel(key: SpeciesKey): THREE.BufferGeometry {
  const m = modelCache.get(key)?.far ?? farCache.get(key);
  if (m) return m;
  const g = farTreeGeometry(SPECIES_DEFS[key].far, SPECIES_SIZE[key]);
  farCache.set(key, g);
  return g;
}

/** Önbellekteki tüm tür geometrilerini bırak (dünya kapanınca) */
export function clearSpeciesModels(): void {
  for (const m of modelCache.values()) {
    const gs = new Set([m.near.branches, m.near.leaves, m.mid.branches, m.mid.leaves, m.far]);
    for (const g of gs) g.dispose();
  }
  for (const g of farCache.values()) g.dispose();
  modelCache.clear();
  farCache.clear();
}

// ─── Malzemeler ───

export interface TreeMaterials {
  leaf: THREE.MeshStandardMaterial;
  bark: Record<BarkKind, THREE.MeshStandardMaterial>;
  far: THREE.MeshStandardMaterial;
  dispose(): void;
}

/**
 * Tek yaprak malzemesi (tüm türler atlastan): rüzgâr (köşe `wind` × tepe²), taç tabanı gölgesi, ışık geçirgenliği,
 * uzakta seyrelmeyen alfa (mip düzeyine göre alfa ölçeği + keskinleştirme; Ben Golus yöntemi), ön-çarpılmış alfa.
 */
export function createTreeMaterials(base: string, atlasSize = 2048): TreeMaterials {
  const atlas = leafAtlas(atlasSize);
  atlas.premultiplyAlpha = true;
  const leaf = new THREE.MeshStandardMaterial({
    map: atlas,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.78,
  });
  leaf.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windTime;
    sh.uniforms.uNight = nightUniform;
    sh.uniforms.uAtlas = { value: atlasSize };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float crown;\nattribute float wind;\nuniform float uWind;\nvarying float vCrown;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCrown = crown;
#ifdef USE_INSTANCING
vec2 wph = instanceMatrix[3].xz * 0.21;
#else
vec2 wph = vec2(0.0);
#endif
float ws = crown * crown * wind;
transformed.x += ws * (0.10 * sin(uWind * 1.1 + wph.x) + 0.035 * sin(uWind * 3.7 + position.y * 2.0 + wph.y));
transformed.z += ws * (0.08 * cos(uWind * 0.9 + wph.y) + 0.035 * sin(uWind * 4.3 + position.x * 2.0));`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vCrown;\nuniform float uNight;\nuniform float uAtlas;',
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
vec4 sampledDiffuseColor = texture2D( map, vMapUv );
// Ön-çarpılmış alfa: süzülmüş rengi geri çöz (kenarda siyah saçak olmaz)
sampledDiffuseColor.rgb /= max( sampledDiffuseColor.a, 0.02 );
diffuseColor *= sampledDiffuseColor;
{
  vec2 tuv = vMapUv * uAtlas;
  vec2 ddx = dFdx( tuv );
  vec2 ddy = dFdy( tuv );
  float mip = max( 0.0, 0.5 * log2( max( dot( ddx, ddx ), dot( ddy, ddy ) ) ) );
  diffuseColor.a *= 1.0 + mip * 0.28;
  diffuseColor.a = ( diffuseColor.a - 0.5 ) / max( fwidth( diffuseColor.a ), 0.0001 ) + 0.5;
}
#endif`,
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb *= 0.84 + 0.3 * vCrown;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.07 + 0.12 * vCrown) * (1.0 - uNight);',
      );
  };
  leaf.customProgramCacheKey = () => 'treelib-leaf-v1';

  const loader = new THREE.TextureLoader();
  const load = (name: string, srgb: boolean) => {
    const t = loader.load(`${base}textures/trees/${name}`);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.repeat.set(1, 3);
    return t;
  };
  const mk = (map: THREE.Texture, normal?: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map,
      ...(normal ? { normalMap: normal } : {}),
      roughness: 0.95,
      vertexColors: true,
    });
  const smooth = barkTexture('smooth');
  smooth.repeat.set(1, 2);
  const palm = barkTexture('palm');
  palm.repeat.set(2, 1);
  const bark: Record<BarkKind, THREE.MeshStandardMaterial> = {
    oak: mk(load('oak_color.jpg', true), load('oak_normal.jpg', false)),
    pine: mk(load('pine_color.jpg', true), load('pine_normal.jpg', false)),
    smooth: mk(smooth),
    palm: mk(palm),
  };
  const far = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  return {
    leaf,
    bark,
    far,
    dispose() {
      leaf.dispose();
      disposeLeafAtlas();
      far.dispose();
      for (const m of Object.values(bark)) {
        m.map?.dispose();
        m.normalMap?.dispose();
        m.dispose();
      }
    },
  };
}
