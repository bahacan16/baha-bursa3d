#!/usr/bin/env node
/**
 * GERÇEK ZEMİN MALZEMELERİ (R4) — bu sokağın fotoğraflarından ölçülmüş dokular.
 *
 * Çıktı: public/textures/real/<ad>/{albedo,normal,rh}.jpg (+ -1k.jpg) ve public/textures/real/manifest.json
 *   albedo : sRGB, yalnız yüzey rengi (gölge / AO yok)
 *   normal : teğet uzayı (OpenGL, +Y = +v), yükseklik haritasından
 *   rh     : R = yükseklik (0..1 → heightRangeMM), G = pürüzlülük, B = mikro örtünme (yalnız dolaylı ışığa)
 * Tüketen: src/worlds/mertkent/realtex.ts (UV metre, repeat = 1 / size).
 *
 * Yöntem (CLAUDE.md §0: yalnız görülen; renkler fotoğraftan; hasar uydurulmaz):
 *  1. ÖLÇÜ — yer fotoğrafı 502sk-bati-bisiklet.jpg (ıslak, bulutlu, ~1 mm/px yakın alan) perspektiften metrik
 *     üst görünüşe düzeltilir: sarı kılavuz şeridin iki kenarı (sarı piksel bölütleme, dayanıklı doğru uydurma) →
 *     yürüme yönü kaçış noktası V; bir doğru boyunca yer mesafesi s için 1/(y − Vy) = u0 + k·s (iğne deliği kamera,
 *     yuvarlanma ≈ 0). Karo derzleri ve taş kısa derzleri bu doğrusal ilişkiye oturur; şerit genişliği / taş dizisi
 *     genişliği ile karo boyu / taş boyu oranları kare karo varsayımıyla taş en-boy oranını verir.
 *     Kılavuz çubukları: 502sk-dogu-kaldirim.jpg alt karo satır profili. Bordür birim boyu: düzeltilmiş görüntüde
 *     bordür üstü enine derzleri / aynı görüntüdeki taş kısa derzleri. Ayrıntı: `node scripts/real-textures.mjs measure`.
 *  2. RENK — Street View kareleri (güneşli 2025 + bulutlu 2019), güneşli/gölge yamalar ayrı; ortalamalar doğrusal
 *     ışıkta. Kareler arası pozlama farkı büyük olduğundan malzemeler arası ORANLAR aynı karede alınır; mutlak düzey
 *     proje kalibrasyonuna (asfalt #95908a, eski kilit taşı paleti) bağlanır. Tablo: `measure` çıktısı.
 *  3. TANE — ıslak fotoğraftaki taş içleri (pah dışı) tek tek kesilir, düşük frekans (ışık/ıslaklık lekesi) bölünür
 *     → göreli tane örnekleri (gerçek agrega benekleri). Kuru yüzeyde kontrast ıslağa göre düşük → ALPHA_DRY.
 *  4. SENTEZ — ölçülen geometri (modül, bağ, derz, pah, çubuk profili) yükseklik alanı olarak çizilir; her taşa
 *     havuzdan rastgele bir tane örneği + ölçülen taşlar arası ton dağılımı; normal/pürüzlülük/örtünme yükseklikten.
 *     Dokular her iki yönde döşenebilir (modülün tam katı).
 *
 * ASFALT (KARAR): ölçüldü ama doku değiştirilmedi. Street View güneşli DA karesinde asfalt / gri taş = 0.74 → mevcut
 * köşe rengi (roads.ts [0.27, 0.26, 0.245]) ile tutarlı. Yakın alan tanesi yalnız 502sk-dogu-kaldirim.jpg yol
 * kenarında (ıslak, ≈0.3 m²): dört yamadan dikişsiz 3 m doku düz gürültüye dönüştü, CC0 asphalt-clean'den iyi değil;
 * tane boyu (öz ilinti yarı genişliği gerçek ≈3 mm, CC0 ≈1.5–2.9 mm) bu çözünürlükte ayırt edilemedi. Tekerlek izi
 * parlaması Street View karelerinde seçilmedi.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SV = join(root, 'streetview-src');
const OUT = join(root, 'public', 'textures', 'real');
const PHOTO1 = join(SV, 'user', '502sk-bati-bisiklet.jpg');
const PHOTO2 = join(SV, 'user', '502sk-dogu-kaldirim.jpg');
const MODE = process.argv[2] ?? 'all';
/** Hızlı deneme: yalnız 1k çıktılar */
const FAST = process.argv.includes('--fast');

// ───────────────────────── ölçülen geometri (measure() bunları yeniden hesaplayıp karşılaştırır) ─────────────────
/** Gri / kırmızı dikdörtgen kilit taşı: modül (taş + derz) mm, uzun kenar yol boyunca, yarım şaşırtmalı */
const PAVER = { L: 200, W: 100, gap: 3, chamfer: 5, sand: 6 };
/** Sarı kılavuz karo: modül 400 × 400 mm, 6 boyuna çubuk */
const TACT = { S: 400, gap: 3, chamfer: 2, bars: 6, pitch: 64, top: 25, base: 32, h: 5, endMargin: 22 };
/** Bordür: birim boyu (m) — geometride kullanılır (street.ts), dokuda yok */
const KERB_UNIT = 0.72;
/** Site içi "kemik" (I) kilit taşı: boy 200, sıra adımı 139 (36 taş/m²), uç genişliği 165 → uç çıkıntısı a = 13 */
const BONE = { L: 200, P: 139, a: 13, end: 37, flank: 26, gap: 3, chamfer: 5, sand: 6 };
/** Islak → kuru tane kontrastı (KARAR: ıslak yüzeyde matris koyulaşır, açık agrega daha az → benek kontrastı
 * artar; kuru Street View karelerinde benekler seçilmiyor. Yarıya yakın alındı.) */
const ALPHA_DRY = 0.45;
/**
 * Taşlar arası ton dağılımı (doğrusal parlaklık CV, kuru): kuru Street View karelerinde taş boyu blok ortalamaları
 * CV 0.077–0.101 (zoTd7 kırmızı, 2ydcI gri, JDIg 2019 gri/kırmızı; derz payı dahil → üst sınır). Islak fotoğraf
 * (×ALPHA_DRY) daha yüksek veriyor (kısmen kurumuş taşlar) → KARAR: 0.07.
 */
const STONE_CV_DRY = 0.07;

// ───────────────────────── renk kanıtları (Street View kareleri; x0,y0,x1,y1 veya çokgen) ─────────────────────────
/** Işık: sun = güneşli, shade = gölge, overcast = bulutlu gün (yayınık). Kullanım: aynı kare içinde oranlar. */
const EVIDENCE = [
  // 2025-09, güneşli — Doğan Avcıoğlu kuzey kaldırımı (park önü, 502. Sk. köşesine yakın), bordür birimleri seçiliyor
  {
    f: 'extra/zoTd7-zO0NiokiEGjXvu4w_256_-15_40.jpg',
    m: 'red',
    l: 'sun',
    p: [
      [390, 313],
      [490, 313],
      [525, 360],
      [410, 360],
    ],
  },
  {
    f: 'extra/zoTd7-zO0NiokiEGjXvu4w_256_-15_40.jpg',
    m: 'red',
    l: 'shade',
    p: [
      [540, 497],
      [625, 497],
      [625, 530],
      [550, 530],
    ],
  },
  {
    f: 'extra/zoTd7-zO0NiokiEGjXvu4w_256_-15_40.jpg',
    m: 'grey',
    l: 'sun',
    p: [
      [507, 267],
      [573, 307],
      [573, 363],
      [507, 317],
    ],
  },
  { f: 'extra/zoTd7-zO0NiokiEGjXvu4w_256_-15_40.jpg', m: 'asphalt', l: 'sun', r: [90, 200, 210, 340] },
  // 2025-09, güneşli — Mertkent KD köşe adası (DA / 502. Sk.)
  { f: 'extra/2ydcI-zCkRh08bRAgD6bUA_155_-5_40.jpg', m: 'tactile', l: 'sun', r: [300, 537, 600, 549] },
  { f: 'extra/2ydcI-zCkRh08bRAgD6bUA_155_-5_40.jpg', m: 'grey', l: 'sun', r: [300, 566, 620, 600] },
  // 2025-09, güneşli (aşırı pozlanmış; oranlarda kırpılma → yalnız kayıt) — 502. Sk. batı kaldırımı, Mertkent
  {
    f: 'extra/U-Oz8apjeKqFGeyERByHqQ_273_-5_40.jpg',
    m: 'grey',
    l: 'sun',
    r: [160, 523, 360, 547],
    clipped: true,
  },
  {
    f: 'extra/U-Oz8apjeKqFGeyERByHqQ_273_-5_40.jpg',
    m: 'tactile',
    l: 'sun',
    r: [170, 554, 350, 566],
    clipped: true,
  },
  {
    f: 'extra/U-Oz8apjeKqFGeyERByHqQ_273_-5_40.jpg',
    m: 'kerb',
    l: 'sun',
    r: [175, 590, 350, 598],
    clipped: true,
  },
  {
    f: 'extra/U-Oz8apjeKqFGeyERByHqQ_273_-5_40.jpg',
    m: 'kerbPaint',
    l: 'sun',
    r: [175, 602, 350, 610],
    clipped: true,
  },
  // 2019-05, bulutlu (yayınık ışık, kırpılma yok) — Doğan Avcıoğlu 2. bölüm
  { f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_0_-50.jpg', m: 'grey', l: 'overcast', r: [40, 88, 600, 108] },
  {
    f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_0_-50.jpg',
    m: 'tactile',
    l: 'overcast',
    r: [40, 113, 600, 120],
  },
  { f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_0_-50.jpg', m: 'grey', l: 'overcast', r: [40, 125, 600, 139] },
  { f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_0_-50.jpg', m: 'red', l: 'overcast', r: [40, 148, 600, 172] },
  { f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_0_-50.jpg', m: 'kerb', l: 'overcast', r: [40, 177, 600, 183] },
  {
    f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_0_-50.jpg',
    m: 'asphalt',
    l: 'overcast',
    r: [40, 240, 600, 330],
  },
  {
    f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_180_-50.jpg',
    m: 'grey',
    l: 'overcast',
    r: [40, 185, 600, 215],
  },
  {
    f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_180_-50.jpg',
    m: 'red',
    l: 'overcast',
    r: [40, 235, 600, 280],
  },
  {
    f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_180_-50.jpg',
    m: 'kerb',
    l: 'overcast',
    r: [40, 287, 600, 297],
  },
  {
    f: 'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_180_-50.jpg',
    m: 'asphalt',
    l: 'overcast',
    r: [40, 380, 600, 460],
  },
];

/**
 * Albedo (doğrusal, taş üstü + derz dahil doku ortalaması) — KARAR: mutlak düzey gri kilit taşı için proje
 * kalibrasyonuna bağlı (eski palet ortalaması #9a9792 ile DA asfaltına oranla bulunan #a3a097 arası, oyun içi
 * Street View karşılaştırmasıyla ayarlandı); diğerleri gri taşa ORAN olarak aynı karelerden:
 *   kırmızı / gri  : zoTd7 güneşli 2025 (0.92, 0.82, 0.79) — Mertkent çevresinin güncel hâli (2019 DA-2: ≈1.0–1.2)
 *   kılavuz / gri  : 2ydcI güneşli 2025 (1.22, 1.20, 1.15) ile JDIg bulutlu 2019 (1.39, 1.31, 1.27) ortalaması
 *   bordür / gri   : JDIg bulutlu 2019 kuzey + güney ortalaması (derzsiz üst yüz tonu)
 */
const MEAN_ALBEDO = (() => {
  const grey = [0.345, 0.335, 0.298];
  const mul = (a, r) => a.map((v, i) => v * r[i]);
  return {
    grey,
    red: mul(grey, [0.922, 0.82, 0.794]),
    tactile: mul(grey, [1.3, 1.256, 1.206]),
    kerb: mul(grey, [1.04, 1.02, 1.02]),
  };
})();

// ───────────────────────── yardımcılar ─────────────────────────
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
const s2l = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
const hex = (c) =>
  '#' +
  c
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, l2s(v))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

async function loadRgb(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}

/** Çift doğrusal örnekleme (0..255) */
function bilin(img, x, y, c) {
  const { data, W, H } = img;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi + 1 >= W || yi + 1 >= H) return NaN;
  const fx = x - xi;
  const fy = y - yi;
  const g = (i, j) => data[(j * W + i) * 3 + c];
  return (
    g(xi, yi) * (1 - fx) * (1 - fy) +
    g(xi + 1, yi) * fx * (1 - fy) +
    g(xi, yi + 1) * (1 - fx) * fy +
    g(xi + 1, yi + 1) * fx * fy
  );
}

/** Ayrılabilir Gauss bulanıklığı (Float32, tek kanal); wrap = döşenebilir kenar */
function blur(a, W, H, sigma, wrap = true) {
  if (sigma <= 0) return Float32Array.from(a);
  const r = Math.ceil(sigma * 3);
  const k = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp((-i * i) / (2 * sigma * sigma));
    k.push(v);
    ks += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const idx = (i, n) => (wrap ? ((i % n) + n) % n : clamp(i, 0, n - 1));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += a[y * W + idx(x + j, W)] * k[j + r];
      tmp[y * W + x] = s;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += tmp[idx(y + j, H) * W + x] * k[j + r];
      out[y * W + x] = s;
    }
  return out;
}

/** Dayanıklı doğru uydurma x = a + b·y (yinelemeli %70 artık eşiği) */
function robustFit(pts) {
  let use = pts.slice();
  let a = 0;
  let b = 0;
  for (let it = 0; it < 6; it++) {
    const n = use.length;
    const my = use.reduce((s, p) => s + p[1], 0) / n;
    const mx = use.reduce((s, p) => s + p[0], 0) / n;
    let sxy = 0;
    let syy = 0;
    for (const p of use) {
      sxy += (p[1] - my) * (p[0] - mx);
      syy += (p[1] - my) ** 2;
    }
    b = sxy / syy;
    a = mx - b * my;
    const res = pts.map((p) => Math.abs(p[0] - (a + b * p[1])));
    const srt = res.slice().sort((p, q) => p - q);
    const thr = Math.max(2, srt[Math.floor(srt.length * 0.7)] * 1.5);
    use = pts.filter((_, i) => res[i] < thr);
  }
  return { a, b };
}

/**
 * Noktalar kümesinin dönemi: q ∈ [qmin, qmax] içinde |Σ exp(2πi·x/q)| en büyük (eksik ya da fazla nokta dayanıklı;
 * aralık alt/üst harmonikleri dışarıda bırakacak kadar dar seçilir). Döner: { q, score (0..1), phase }
 */
function periodOf(xs, qmin, qmax, steps = 4000) {
  let best = { q: NaN, score: -1, phase: 0 };
  for (let k = 0; k <= steps; k++) {
    const q = qmin + ((qmax - qmin) * k) / steps;
    let c = 0;
    let s = 0;
    for (const x of xs) {
      c += Math.cos((2 * Math.PI * x) / q);
      s += Math.sin((2 * Math.PI * x) / q);
    }
    const score = Math.hypot(c, s) / xs.length;
    if (score > best.score) best = { q, score, phase: (Math.atan2(s, c) / (2 * Math.PI)) * q };
  }
  return best;
}

/** Profilde koyu yerel minimumlar: ±R içinde en küçük ve yerel medyandan D kadar koyu */
function darkMinima(prof, R, D) {
  const out = [];
  for (let i = R; i < prof.length - R; i++) {
    let ok = true;
    for (let k = -R; k <= R && ok; k++) if (prof[i + k] < prof[i]) ok = false;
    if (!ok) continue;
    const win = [];
    for (let k = -25; k <= 25; k++) if (prof[i + k] !== undefined) win.push(prof[i + k]);
    win.sort((p, q) => p - q);
    if (win[Math.floor(win.length / 2)] - prof[i] > D) out.push(i);
  }
  return out;
}

// ───────────────────────── 1. ÖLÇÜ: fotoğraf 1 perspektif modeli ─────────────────────────
/** Sarı kılavuz şeridin satır başına sol/sağ kenarı (en uzun sarı koşu; çubuk olukları 14 px'e kadar köprülenir) */
function stripRows(img, x0, x1, y0, y1) {
  const { data, W } = img;
  const yellow = (x, y) => {
    const i = (y * W + x) * 3;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx < 90 || (mx - mn) / mx < 0.33) return false;
    let h;
    if (mx === r) h = ((g - b) / (mx - mn + 1e-6)) * 60;
    else if (mx === g) h = (2 + (b - r) / (mx - mn + 1e-6)) * 60;
    else h = (4 + (r - g) / (mx - mn + 1e-6)) * 60;
    if (h < 0) h += 360;
    return h > 25 && h < 55;
  };
  const rows = [];
  for (let y = y0; y <= y1; y += 2) {
    let best = null;
    let start = -1;
    let last = -1;
    for (let x = x0; x < x1; x++) {
      if (!yellow(x, y)) continue;
      if (start < 0 || x - last > 14) {
        if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
        start = x;
      }
      last = x;
    }
    if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
    if (best && best[1] - best[0] > 60) rows.push({ y, l: best[0], r: best[1] });
  }
  return rows;
}

async function photo1Model() {
  const img = await loadRgb(PHOTO1);
  const { data } = img;
  const rows = stripRows(img, 560, 1150, 1150, 2570);
  // Yakın alan (y ≥ 1500): uzakta şerit birkaç piksele iner, kenar koşuları gürültülü
  const near = rows.filter((r) => r.y >= 1500);
  const Lf = robustFit(near.map((r) => [r.l, r.y]));
  const Rf = robustFit(near.map((r) => [r.r, r.y]));
  const vy = (Rf.a - Lf.a) / (Lf.b - Rf.b);
  const vx = Lf.a + Lf.b * vy;
  const xl = (y) => Lf.a + Lf.b * y;
  const xr = (y) => Rf.a + Rf.b * y;
  const grey = new Float32Array(img.W * img.H);
  for (let i = 0; i < grey.length; i++)
    grey[i] = data[i * 3] * 0.3 + data[i * 3 + 1] * 0.59 + data[i * 3 + 2] * 0.11;
  const gblur = blur(grey, img.W, img.H, 1, false);
  const L = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const g = (i, j) => gblur[j * img.W + i];
    return (
      g(xi, yi) * (1 - fx) * (1 - fy) +
      g(xi + 1, yi) * fx * (1 - fy) +
      g(xi, yi + 1) * (1 - fx) * fy +
      g(xi + 1, yi + 1) * fx * fy
    );
  };
  /** Şerit göreli enine konum t (m; 0 = şeridin sol kenarı, 0.4 = sağ kenarı) → aynı satırda x */
  const xAt = (t, y) => xl(y) + (t / 0.4) * (xr(y) - xl(y));
  /** Bir t doğrusu boyunca (V'ye yakınsayan) koyu derz satırları; bant ±tBand metre (satır ölçeğiyle daralır) */
  const joints = (t, tBand, R, D, y0 = 1350, y1 = 2570) => {
    const prof = [];
    for (let y = y0; y <= y1; y++) {
      let s = 0;
      let n = 0;
      for (let k = -8; k <= 8; k++) {
        s += L(xAt(t + (tBand * k) / 8, y), y);
        n++;
      }
      prof.push(s / n);
    }
    return darkMinima(prof, R, D).map((i) => i + y0);
  };
  /** u = 1/(y − vy) dizisinin dönemi (derzler yer mesafesinde eşit aralıklı → u'da da eşit aralıklı) */
  const stepOf = (ys, qmin, qmax) => {
    const p = periodOf(
      ys.map((y) => 1 / (y - vy)),
      qmin,
      qmax,
    );
    return { step: p.q, score: p.score, n: ys.length };
  };
  const tileJ = joints(0.2, 0.12, 15, 25);
  const tile = stepOf(tileJ, 1.5e-4, 3.5e-4);
  const stoneA = stepOf(joints(0.46, 0.02, 10, 15), 0.8e-4, 1.6e-4);
  const stoneB = stepOf(joints(0.66, 0.02, 10, 15), 0.8e-4, 1.6e-4);
  // Dizi genişlikleri: y = 2250 satırında uzun derzler (şerit dışı, sol + sağ)
  const yRow = 2250;
  const rowProf = [];
  for (let x = 300; x <= 1300; x++) {
    let s = 0;
    for (let k = -3; k <= 3; k++) s += L(x, yRow + k);
    rowProf.push(s / 7);
  }
  const longJ = darkMinima(rowProf, 14, 18)
    .map((i) => i + 300)
    .map((x) => (0.4 * (x - xl(yRow))) / (xr(yRow) - xl(yRow)));
  const left = longJ.filter((t) => t < -0.02).sort((p, q) => p - q);
  const right = longJ.filter((t) => t > 0.42 && t < 0.85).sort((p, q) => p - q);
  // Şerit kenarları (t = 0, 0.4) da dizi sınırı: şerit 4 dizinin yerini alıyor
  const courseP = periodOf([...left, 0, 0.4, ...right], 0.07, 0.14);
  const courseW = courseP.q;
  const stoneStep = (stoneA.step + stoneB.step) / 2;
  const model = {
    img,
    vx,
    vy,
    Lf,
    Rf,
    xl,
    xr,
    xAt,
    // s (m) ölçeği: kare karo (0.40 m) varsayımından
    k: tile.step / 0.4,
    u0: 1 / (2570 - vy),
    report: {
      debug: {
        Lf,
        Rf,
        tile,
        stoneA,
        stoneB,
        left,
        right,
        jA: joints(0.46, 0.02, 10, 15),
        jB: joints(0.66, 0.02, 10, 15),
      },
      vanishing: [vx, vy],
      tileJoints: tileJ,
      tileStepU: tile.step,
      stoneStepU: stoneStep,
      tilePerStone: tile.step / stoneStep,
      courseWidthT: courseW,
      stripPerCourse: 0.4 / courseW,
      paverAspect: 0.4 / courseW / (tile.step / stoneStep),
      paverModuleMM: [(400 * stoneStep) / tile.step, courseW * 1000],
    },
  };
  return model;
}

/** Fotoğraf 1 → metrik üst görünüş (s: yürüme yönü, t: enine; mm/px) — satır 0 = uzak uç */
function rectify(model, s0, s1, t0, t1, mm) {
  const OW = Math.round(((t1 - t0) * 1000) / mm);
  const OH = Math.round(((s1 - s0) * 1000) / mm);
  const out = new Float32Array(OW * OH * 3);
  for (let r = 0; r < OH; r++) {
    const s = s1 - ((r + 0.5) * mm) / 1000;
    const y = model.vy + 1 / (model.u0 + model.k * s);
    for (let c = 0; c < OW; c++) {
      const t = t0 + ((c + 0.5) * mm) / 1000;
      const x = model.xAt(t, y);
      for (let ch = 0; ch < 3; ch++) out[(r * OW + c) * 3 + ch] = bilin(model.img, x, y, ch);
    }
  }
  return { data: out, W: OW, H: OH, mm };
}

async function measure(model) {
  const R = model.report;
  const lines = [];
  const log = (s) => {
    lines.push(s);
    console.log(s);
  };
  log('── Kilit taşı / kılavuz geometrisi (502sk-bati-bisiklet.jpg) ──');
  log(`  kaçış noktası V = (${R.vanishing[0].toFixed(1)}, ${R.vanishing[1].toFixed(1)}) px`);
  if (process.env.DEBUG) console.log(JSON.stringify(R.debug));
  log(`  karo derzleri (satır): ${R.tileJoints.join(', ')}`);
  log(`  karo boyu / taş boyu = ${R.tilePerStone.toFixed(3)} (2.000 beklenir)`);
  log(`  şerit genişliği / taş dizisi = ${R.stripPerCourse.toFixed(3)} (4.000 beklenir)`);
  log(
    `  → taş en-boy oranı (kare karo) = ${R.paverAspect.toFixed(3)}; modül ≈ ${R.paverModuleMM.map((v) => v.toFixed(0)).join(' × ')} mm`,
  );
  // Bordür birimi: düzeltilmiş görüntüde t ≈ 0.84 (bordür üstü) enine derzleri ve son taş dizisinin kısa derzleri
  const rk = rectify(model, 0, 2.2, 0.7, 0.9, 1);
  const colProf = (t0, t1) => {
    const c0 = Math.round((t0 - 0.7) * 1000);
    const c1 = Math.round((t1 - 0.7) * 1000);
    const p = [];
    for (let r = 0; r < rk.H; r++) {
      let s = 0;
      for (let c = c0; c < c1; c++) s += rk.data[(r * rk.W + c) * 3 + 1];
      p.push(s / (c1 - c0));
    }
    return p;
  };
  const kerbJ = darkMinima(colProf(0.83, 0.87), 40, 14);
  const stoneJ = darkMinima(colProf(0.74, 0.78), 40, 14);
  const kerbP = periodOf(kerbJ, 450, 1000);
  const stoneP = periodOf(stoneJ, 150, 260);
  log(
    `  bordür üstü enine derzleri (mm, s ekseni): ${kerbJ.join(', ')} → dönem ${kerbP.q.toFixed(0)} (skor ${kerbP.score.toFixed(2)})`,
  );
  log(
    `  aynı görüntüde taş kısa derzleri: ${stoneJ.join(', ')} → dönem ${stoneP.q.toFixed(0)} (skor ${stoneP.score.toFixed(2)})`,
  );
  log(`  → bordür birimi ≈ ${((kerbP.q / stoneP.q) * 0.2).toFixed(3)} m (taş modülü 0.200 m)`);
  if (process.env.DEBUG) {
    const b = Buffer.alloc(rk.W * rk.H * 3);
    for (let i = 0; i < b.length; i++) b[i] = clamp(rk.data[i] || 0, 0, 255);
    await sharp(b, { raw: { width: rk.W, height: rk.H, channels: 3 } })
      .jpeg()
      .toFile('/tmp/claude-0/rt-kerb-rect.jpg');
  }
  log(
    `  (kullanılan KERB_UNIT = ${KERB_UNIT} m; ayrıca DA 2019 JDIg_180_-50 ve zoTd7_256_-15_40 karelerinde ≈0.71–0.74 m)`,
  );
  // Kılavuz çubukları: fotoğraf 2, y = 2440 satırı (karo ≈ 1 mm/px)
  const p2 = await loadRgb(PHOTO2);
  const prof = [];
  for (let x = 830; x <= 1250; x++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) {
      const i = ((2440 + k) * p2.W + x) * 3;
      s += p2.data[i] * 0.2126 + p2.data[i + 1] * 0.7152 + p2.data[i + 2] * 0.0722;
    }
    prof.push(s / 5);
  }
  const dips = darkMinima(prof, 5, 30).map((i) => i + 830);
  log(`  kılavuz karo satır profili koyu çizgileri (px): ${dips.join(', ')}`);
  log(
    `  (çubuk kenar gölgeleri çiftler hâlinde; 6 çubuk, adım ≈ 62 px ≈ 64 mm, üst ≈ 25 mm, taban ≈ 32 mm, yan pay ≈ 24 mm)`,
  );
  log('── Renk kanıtları (doğrusal ortalama → sRGB) ──');
  const byFile = new Map();
  for (const e of EVIDENCE) {
    const img = byFile.get(e.f) ?? (await loadRgb(join(SV, e.f)));
    byFile.set(e.f, img);
    const poly = e.p ?? [
      [e.r[0], e.r[1]],
      [e.r[2], e.r[1]],
      [e.r[2], e.r[3]],
      [e.r[0], e.r[3]],
    ];
    const inPoly = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const acc = [0, 0, 0];
    let n = 0;
    const xs = poly.map((q) => q[0]);
    const ys = poly.map((q) => q[1]);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++)
      for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        if (!inPoly(x + 0.5, y + 0.5)) continue;
        const i = (y * img.W + x) * 3;
        for (let c = 0; c < 3; c++) acc[c] += s2l(img.data[i + c] / 255);
        n++;
      }
    e.lin = acc.map((v) => v / n);
    log(
      `  ${e.f.padEnd(52)} ${e.m.padEnd(9)} ${e.l.padEnd(8)} ${hex(e.lin)}${e.clipped ? '  (kırpık)' : ''}`,
    );
  }
  log('── Aynı karede gri kilit taşına oranlar (R, G, B) ──');
  const frames = [...new Set(EVIDENCE.map((e) => e.f))];
  for (const f of frames) {
    const es = EVIDENCE.filter((e) => e.f === f);
    const greys = es.filter((e) => e.m === 'grey' && e.l !== 'shade');
    if (!greys.length) continue;
    const g = [0, 1, 2].map((c) => greys.reduce((s, e) => s + e.lin[c], 0) / greys.length);
    for (const e of es)
      if (e.m !== 'grey')
        log(
          `  ${f.split('/')[1].slice(0, 22).padEnd(22)} ${e.m.padEnd(9)} ${e.l.padEnd(8)} ${e.lin.map((v, c) => (v / g[c]).toFixed(3)).join(', ')}`,
        );
  }
  log(
    '── Taşlar arası ton: taş boyu blok ortalamalarının CV (kuru Street View; derz payı dahil → üst sınır) ──',
  );
  for (const [f, poly, bw, bh] of [
    [
      'extra/zoTd7-zO0NiokiEGjXvu4w_256_-15_40.jpg',
      [
        [390, 313],
        [490, 313],
        [525, 360],
        [410, 360],
      ],
      8,
      5,
    ],
    [
      'extra/2ydcI-zCkRh08bRAgD6bUA_155_-5_40.jpg',
      [
        [300, 566],
        [620, 566],
        [620, 600],
        [300, 600],
      ],
      12,
      4,
    ],
    [
      'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_180_-50.jpg',
      [
        [40, 235],
        [600, 235],
        [600, 280],
        [40, 280],
      ],
      14,
      7,
    ],
    [
      'mertkent-2-etap/JDIgP_YqV92AywXf0SHNFw_180_-50.jpg',
      [
        [40, 185],
        [600, 185],
        [600, 215],
        [40, 215],
      ],
      12,
      5,
    ],
  ]) {
    const img = byFile.get(f) ?? (await loadRgb(join(SV, f)));
    const xs = poly.map((q) => q[0]);
    const ys = poly.map((q) => q[1]);
    const inP = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const vals = [];
    for (let y = Math.min(...ys); y + bh <= Math.max(...ys); y += bh)
      for (let x = Math.min(...xs); x + bw <= Math.max(...xs); x += bw) {
        let ok = true;
        let s = 0;
        for (let j = 0; j < bh && ok; j++)
          for (let i = 0; i < bw; i++) {
            if (!inP(x + i + 0.5, y + j + 0.5)) {
              ok = false;
              break;
            }
            const k = ((y + j) * img.W + x + i) * 3;
            s +=
              0.2126 * s2l(img.data[k] / 255) +
              0.7152 * s2l(img.data[k + 1] / 255) +
              0.0722 * s2l(img.data[k + 2] / 255);
          }
        if (ok) vals.push(s / (bw * bh));
      }
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
    log(
      `  ${f.split('/')[1].slice(0, 30).padEnd(30)} blok ${bw}×${bh}: CV ${(sd / m).toFixed(3)} (${vals.length} blok)`,
    );
  }
  log(`  kullanılan STONE_CV_DRY = ${STONE_CV_DRY}`);
  log('── Seçilen doku ortalama albedoları (doğrusal → sRGB) ──');
  for (const [k, v] of Object.entries(MEAN_ALBEDO))
    log(`  ${k.padEnd(8)} ${hex(v)}  (${v.map((x) => x.toFixed(3)).join(', ')})`);
  return lines;
}

// ───────────────────────── 3. TANE HAVUZU ─────────────────────────
/**
 * Düzeltilmiş fotoğraftaki taş içleri: şerit solu/sağı diziler (t), kısa derzler dizi profilinden. Her örnek:
 * doğrusal RGB / (σ 12 mm bulanık) → göreli ayrıntı (≈1 ± tane). Islaklık lekeleri ve ışık eğimi böylece atılır.
 */
function grainPool(model) {
  const MM = 1;
  const S0 = 0.02;
  const S1 = 0.8;
  const T0 = -0.62;
  const T1 = 0.84;
  const R = rectify(model, S0, S1, T0, T1, MM);
  const W = R.W;
  const H = R.H;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++)
    lum[i] = R.data[i * 3] * 0.3 + R.data[i * 3 + 1] * 0.59 + R.data[i * 3 + 2] * 0.11;
  // Uzun derzler: sütun profili minimumları
  const colMean = new Float32Array(W);
  for (let c = 0; c < W; c++) {
    let s = 0;
    for (let r = 0; r < H; r++) s += lum[r * W + c];
    colMean[c] = s / H;
  }
  const longJ = darkMinima(Array.from(colMean), 30, 4);
  const courses = [];
  // Kılavuz şerit (t 0 … 0.4) dışındaki diziler
  const cStrip0 = Math.round((0 - T0) * 1000) + 5;
  const cStrip1 = Math.round((0.4 - T0) * 1000) - 5;
  for (let i = 1; i < longJ.length; i++) {
    const w = longJ[i] - longJ[i - 1];
    const outside = longJ[i] <= cStrip0 || longJ[i - 1] >= cStrip1;
    if (w > 80 && w < 120 && outside) courses.push([longJ[i - 1], longJ[i]]);
  }
  const swatches = [];
  const means = [];
  for (const [c0, c1] of courses) {
    // Bu dizinin kısa derzleri
    const prof = [];
    for (let r = 0; r < H; r++) {
      let s = 0;
      for (let c = c0 + 12; c < c1 - 12; c++) s += lum[r * W + c];
      prof.push(s / (c1 - c0 - 24));
    }
    const sj = darkMinima(prof, 40, 6);
    for (let i = 1; i < sj.length; i++) {
      const len = sj[i] - sj[i - 1];
      if (len < 170 || len > 230) continue;
      const x0 = c0 + 12;
      const x1 = c1 - 12;
      const y0 = sj[i - 1] + 12;
      const y1 = sj[i] - 12;
      const sw = x1 - x0;
      const sh = y1 - y0;
      if (sw < 50 || sh < 120) continue;
      const lin = [0, 1, 2].map(() => new Float32Array(sw * sh));
      let bad = 0;
      for (let y = 0; y < sh; y++)
        for (let x = 0; x < sw; x++)
          for (let ch = 0; ch < 3; ch++) {
            const v = R.data[((y0 + y) * W + x0 + x) * 3 + ch];
            if (!Number.isFinite(v)) bad++;
            lin[ch][y * sw + x] = s2l((Number.isFinite(v) ? v : 128) / 255);
          }
      if (bad) continue;
      const rel = lin.map((a) => {
        const lo = blur(a, sw, sh, 12, false);
        return a.map((v, i) => v / Math.max(1e-4, lo[i]));
      });
      const m = lin.map((a) => a.reduce((s, v) => s + v, 0) / a.length);
      means.push(m);
      // Uzun kenar yol boyunca: örnek (sw × sh) = (enine × boyuna) → dokuda u = boyuna, v = enine (döndür)
      const sPos = S1 - ((y0 + sh / 2) * MM) / 1000;
      swatches.push({ w: sh, h: sw, s: sPos, rel: rel.map((a) => transpose(a, sw, sh)) });
    }
  }
  // Taşlar arası ton dağılımı (ıslak) — doğrusal parlaklık CV
  const lums = means.map((m) => 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]);
  const lm = lums.reduce((s, v) => s + v, 0) / lums.length;
  const cvWet = Math.sqrt(lums.reduce((s, v) => s + (v - lm) ** 2, 0) / lums.length) / lm;
  // Tane kontrastı (ıslak, doğrusal): göreli ayrıntının std'si
  let s2 = 0;
  let n2 = 0;
  for (const sw of swatches)
    for (const v of sw.rel[1]) {
      s2 += (v - 1) ** 2;
      n2++;
    }
  return { swatches, cvWet, grainSdWet: Math.sqrt(s2 / n2), courses: courses.length };
}

/**
 * Göreli ayrıntıyı (≈1 ± tane) kenarları sarmalanır yap: yarım kaydırılmış kopyayla sin² ağırlıklı karışım, iki
 * bağımsız kopyanın karışımında düşen varyans geri ölçeklenir (tane kontrastı korunur).
 */
function seamless(a, w, h) {
  const mix1 = (src, horiz) => {
    const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = horiz ? x / w : y / h;
        const k = Math.sin(Math.PI * t) ** 2;
        const xs = horiz ? (x + (w >> 1)) % w : x;
        const ys = horiz ? y : (y + (h >> 1)) % h;
        const A = src[y * w + x] - 1;
        const B = src[ys * w + xs] - 1;
        o[y * w + x] = 1 + (A * k + B * (1 - k)) / Math.sqrt(k * k + (1 - k) * (1 - k));
      }
    return o;
  };
  return mix1(mix1(a, true), false);
}

function transpose(a, w, h) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x * h + y] = a[y * w + x];
  return o;
}

// ───────────────────────── 4. SENTEZ ─────────────────────────
/**
 * Genel döşeme sentezi: her piksel (u, v mm) için desen fonksiyonu {id, d (taş kenarına işaretli mesafe, mm),
 * lu, lv (taş içi mm), kind} döndürür; yükseklik/albedo/pürüzlülük buradan.
 */
function synth(o) {
  const { Wpx, Hpx, Umm, Vmm, pattern, pool, seed, stoneColor, jointColor, heightOf, rough } = o;
  const r = rng(seed);
  const pxU = Umm / Wpx;
  const pxV = Vmm / Hpx;
  const alb = new Float32Array(Wpx * Hpx * 3);
  const hgt = new Float32Array(Wpx * Hpx);
  const rgh = new Float32Array(Wpx * Hpx);
  const stones = new Map();
  const stoneOf = (id) => {
    let s = stones.get(id);
    if (!s) {
      const sw = pool[Math.floor(r() * pool.length)];
      s = {
        col: stoneColor(r),
        sw,
        // Büyük tane alanında (field) rastgele pencere; taş örneğinde (swatch) ortalanmış + rastgele ayna
        ox: r() * 4000,
        oy: r() * 4000,
        fu: r() < 0.5,
        fv: r() < 0.5,
        dz: gauss(r) * 0.35,
        tu: gauss(r) * 0.004,
        tv: gauss(r) * 0.004,
      };
      stones.set(id, s);
    }
    return s;
  };
  /** Taş yerel mm → tane: büyük alan (field) varsa rastgele pencere, yoksa taşın kendi örneği */
  const grainAt = (s, P) => {
    if (o.field) {
      const f = o.field;
      const gx = (((((P.lu + s.ox) / f.px) | 0) % f.N) + f.N) % f.N;
      const gy = (((((P.lv + s.oy) / f.px) | 0) % f.N) + f.N) % f.N;
      const k = gy * f.N + gx;
      return [f.rel[0][k], f.rel[1][k], f.rel[2][k]];
    }
    const sw = s.sw;
    // Örnek taşın düz üst yüzüne (modül − derz − 2 pah) hafifçe gerilir (%6–12); pah bandı örnek kenarından
    const e = o.edge ?? 0;
    let gx = clamp(((P.lu - e) / (o.moduleU - 2 * e)) * sw.w, 0, sw.w - 1);
    let gy = clamp(((P.lv - e) / (o.moduleV - 2 * e)) * sw.h, 0, sw.h - 1);
    if (s.fu) gx = sw.w - 1 - gx;
    if (s.fv) gy = sw.h - 1 - gy;
    const k = (Math.floor(gy) * sw.w + Math.floor(gx)) | 0;
    return [sw.rel[0][k], sw.rel[1][k], sw.rel[2][k]];
  };
  for (let py = 0; py < Hpx; py++) {
    // Görüntü satırı 0 = v üst (doku v = Vmm) — flipY ile uyumlu
    const v = (Hpx - py - 0.5) * pxV;
    for (let px = 0; px < Wpx; px++) {
      const u = (px + 0.5) * pxU;
      const P = pattern(u, v);
      const i = py * Wpx + px;
      const s = P.id != null ? stoneOf(P.id) : null;
      // Tane: taşın örneği içinde (taş yerel mm; örnek sarmalanır)
      const g = s ? grainAt(s, P) : [1, 1, 1];
      const h = heightOf(P, s);
      hgt[i] = h;
      let c;
      if (P.d < 0 || !s) c = jointColor(r, P);
      else {
        c = s.col.map((v0, ch) => v0 * (1 + ALPHA_DRY * (g[ch] - 1)));
        // Pah: taş malzemesi, hafif kir (fotoğraflarda pah çizgisi koyu; derz dolgusu gibi kir tutar)
        if (P.d < o.chamfer) c = c.map((v0) => v0 * (0.86 + 0.14 * smooth(0, o.chamfer, P.d)));
        if (o.tint) c = o.tint(c, P, s);
      }
      for (let ch = 0; ch < 3; ch++) alb[i * 3 + ch] = c[ch];
      rgh[i] = rough(P, g[1]);
    }
  }
  return { alb, hgt, rgh, pxU, pxV };
}

/** Yükseklikten normal (teğet uzayı, OpenGL: +Y = +v = görüntüde yukarı), sarmalanan kenar */
function normalsOf(hgt, W, H, pxU, pxV, strength = 1) {
  const n = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const hL = hgt[y * W + ((x - 1 + W) % W)];
      const hR = hgt[y * W + ((x + 1) % W)];
      const hU = hgt[((y - 1 + H) % H) * W + x];
      const hD = hgt[((y + 1) % H) * W + x];
      const dhdu = ((hR - hL) / (2 * pxU)) * strength;
      // +v = görüntüde yukarı (y azalır)
      const dhdv = ((hU - hD) / (2 * pxV)) * strength;
      let nx = -dhdu;
      let ny = -dhdv;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * W + x) * 3;
      n[i] = Math.round((nx * 0.5 + 0.5) * 255);
      n[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      n[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  return n;
}

/**
 * Mikro örtünme (yalnız dolaylı ışık): her pikselin çevresindeki (σ ölçekli) ortalama yüksekliğe göre ne kadar
 * aşağıda kaldığı — dar derz / oluk dibi gökyüzünü az görür. Albedoya işlenmez.
 */
function occlusion(hgt, W, H, pxU, depthMM) {
  const sig = Math.max(1, 6 / pxU);
  const avg = blur(hgt, W, H, sig, true);
  const ao = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) ao[i] = clamp(1 - Math.max(0, avg[i] - hgt[i]) / (depthMM * 1.6), 0.45, 1);
  return ao;
}

/**
 * Doku seti yaz. range: yükseklik aralığı [alt, üst] mm — rh.R = (h − alt) / (üst − alt); sabit aralık (veriye
 * göre değil) → realtex.ts paralaks derinliği = üst − alt.
 */
async function writeSet(name, W, H, set, range, meta) {
  const dir = join(OUT, name);
  await mkdir(dir, { recursive: true });
  const albB = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) albB[i] = Math.round(clamp(l2s(set.alb[i]), 0, 1) * 255);
  const nrm = normalsOf(set.hgt, W, H, set.pxU, set.pxV);
  const [lo, hi] = range;
  const ao = occlusion(set.hgt, W, H, set.pxU, hi - lo);
  let hmin = Infinity;
  let hmax = -Infinity;
  for (const v of set.hgt) {
    hmin = Math.min(hmin, v);
    hmax = Math.max(hmax, v);
  }
  const rhB = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rhB[i * 3] = Math.round(clamp((set.hgt[i] - lo) / (hi - lo), 0, 1) * 255);
    rhB[i * 3 + 1] = Math.round(clamp(set.rgh[i], 0, 1) * 255);
    rhB[i * 3 + 2] = Math.round(clamp(ao[i], 0, 1) * 255);
  }
  const put = async (buf, file, q, w, h) => {
    let p = sharp(buf, { raw: { width: W, height: H, channels: 3 } });
    if (w !== W || h !== H) p = p.resize(w, h, { kernel: 'lanczos3' });
    await p
      .jpeg({ quality: q, chromaSubsampling: file.startsWith('albedo') ? '4:2:0' : '4:4:4' })
      .toFile(join(dir, file));
  };
  const half = [Math.round(W / 2), Math.round(H / 2)];
  const full = [W, H];
  if (!FAST) {
    await put(albB, 'albedo.jpg', 90, ...full);
    await put(Buffer.from(nrm), 'normal.jpg', 92, ...full);
    await put(rhB, 'rh.jpg', 92, ...full);
  }
  await put(albB, 'albedo-1k.jpg', 90, ...half);
  await put(Buffer.from(nrm), 'normal-1k.jpg', 92, ...half);
  await put(rhB, 'rh-1k.jpg', 92, ...half);
  // Doku ortalaması (kalibrasyon kontrolü)
  const m = [0, 0, 0];
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) m[c] += set.alb[i * 3 + c] / (W * H);
  console.log(
    `  ✓ ${name}: ${W}×${H}, ortalama albedo ${hex(m)}, yükseklik ${hmin.toFixed(1)}…${hmax.toFixed(1)} mm`,
  );
  return { ...meta, heightRangeMM: range, meanAlbedo: hex(m), px: [W, H] };
}

/** Palet: doku ortalaması hedef albedoya eşit olsun diye taş rengi ölçeği (derz/pah payı) sonradan düzeltilir */
function stoneColorFn(mean, cvDry, hueJit = 0.012) {
  return (r) => {
    const f = Math.exp(gauss(r) * cvDry);
    const hr = 1 + gauss(r) * hueJit;
    const hb = 1 + gauss(r) * hueJit;
    return [mean[0] * f * hr, mean[1] * f, mean[2] * f * hb];
  };
}

/** Dikdörtgen kilit taşı deseni (yarım şaşırtmalı, uzun kenar u) */
function paverPattern(Umm) {
  const { L, W, gap } = PAVER;
  const perRow = Math.round(Umm / L);
  return (u, v) => {
    const c = Math.floor(v / W);
    const lv0 = v - c * W;
    const shift = c % 2 ? L / 2 : 0;
    const uu = u + shift;
    const col = Math.floor(uu / L);
    const lu0 = uu - col * L;
    const d = Math.min(lu0, L - lu0, lv0, W - lv0) - gap / 2;
    return { id: `${c}:${((col % perRow) + perRow) % perRow}`, d, lu: lu0, lv: lv0 };
  };
}

async function buildPaver(name, pool, mean, cvDry, seed) {
  const { chamfer, sand } = PAVER;
  const Umm = 2000;
  const Vmm = 2000;
  const N = 2048;
  const pattern = paverPattern(Umm);
  const make = (m) =>
    synth({
      Wpx: N,
      Hpx: N,
      Umm,
      Vmm,
      pattern,
      pool,
      seed,
      chamfer,
      moduleU: PAVER.L,
      moduleV: PAVER.W,
      edge: PAVER.gap / 2 + chamfer,
      stoneColor: stoneColorFn(m, cvDry),
      // Derz dolgusu: kum + kir (KARAR: taş ortalamasının 0.62'si — ıslak fotoğrafta derz ortası taşa yakın, pah
      // çizgileri koyu; kuru Street View'da derz ağı koyu çizgi olarak görünüyor)
      jointColor: (r) => m.map((v) => v * 0.62 * (1 + (r() - 0.5) * 0.1)),
      heightOf: (P, s) => {
        if (P.d < 0) return -sand + Math.sin(P.lu * 0.7) * 0.2;
        const top = s ? s.dz + s.tu * (P.lu - 100) + s.tv * (P.lv - 50) : 0;
        if (P.d < chamfer) return top - (chamfer - P.d);
        return top;
      },
      rough: (P, g) => (P.d < 0 ? 0.97 : clamp(0.9 - (g - 1) * 0.25, 0.78, 0.96)),
    });
  // İki geçiş: önce ortalamayı ölç, sonra taş rengini hedef ortalamaya ölçekle (derz/pah payı)
  let set = make(mean);
  const m0 = [0, 1, 2].map((c) => set.alb.reduce((s, v, i) => (i % 3 === c ? s + v : s), 0) / (N * N));
  const corr = mean.map((v, c) => v / m0[c]);
  set = make(mean.map((v, c) => v * corr[c]));
  return writeSet(name, N, N, set, [-7, 2], {
    size: [Umm / 1000, Vmm / 1000],
    module: [PAVER.L, PAVER.W],
    bond: 'running',
    joint: PAVER.gap,
    chamfer,
    normalScale: 1,
    roughness: [0.78, 0.97],
  });
}

async function buildTactile(pool, mean) {
  const { S, gap, chamfer, bars, pitch, top, base, h, endMargin } = TACT;
  const Umm = 1600;
  const Vmm = 400;
  const Wpx = 2048;
  const Hpx = 512;
  const margin = (S - (bars - 1) * pitch - base) / 2; // ≈ 24 mm
  // Karo 400 mm > taş örneği → örneklerden dikişsiz tane alanı (0.5 m), her karo rastgele pencere
  const field = blendField(pool, 512, 500, 405);
  const pattern = (u, v) => {
    const col = Math.floor(u / S);
    const lu = u - col * S;
    const lv = v;
    const d = Math.min(lu, S - lu, lv, S - lv) - gap / 2;
    // En yakın çubuk: kapsül (uçları yuvarlak) ekseni
    const k = clamp(Math.round((lv - margin - base / 2) / pitch), 0, bars - 1);
    const vc = margin + base / 2 + k * pitch;
    const ua = endMargin + base / 2;
    const ub = S - endMargin - base / 2;
    const cu = clamp(lu, ua, ub);
    const dBar = Math.hypot(lu - cu, lv - vc);
    return { id: `t${col % 4}`, d, lu, lv, dBar, kind: 'tile' };
  };
  const barH = (dBar) => {
    const rt = top / 2;
    const rb = base / 2;
    if (dBar <= rt) return h;
    if (dBar >= rb) return 0;
    return h * (1 - smooth(rt, rb, dBar));
  };
  const make = (m) =>
    synth({
      Wpx,
      Hpx,
      Umm,
      Vmm,
      pattern,
      pool,
      seed: 404,
      chamfer,
      field,
      stoneColor: stoneColorFn(m, 0.03, 0.008),
      jointColor: (r) => MEAN_ALBEDO.grey.map((v) => v * 0.62 * (1 + (r() - 0.5) * 0.1)),
      heightOf: (P) => {
        if (P.d < 0) return -4;
        let z = barH(P.dBar);
        if (P.d < chamfer) z -= chamfer - P.d;
        return z;
      },
      // KARAR (yer fotoğrafları): çubuk üstleri daha temiz/açık, aralardaki düz taban kir tutuyor
      tint: (c, P) => {
        const onBar = P.dBar < TACT.top / 2;
        const f = onBar ? 1.03 : P.dBar < TACT.base / 2 ? 1.0 : 0.95;
        return c.map((v) => v * f);
      },
      rough: (P, g) => (P.d < 0 ? 0.97 : P.dBar < top / 2 ? clamp(0.8 - (g - 1) * 0.2, 0.7, 0.9) : 0.9),
    });
  let set = make(mean);
  const m0 = [0, 1, 2].map((c) => set.alb.reduce((s, v, i) => (i % 3 === c ? s + v : s), 0) / (Wpx * Hpx));
  set = make(mean.map((v, c) => (v * mean[c]) / m0[c]));
  return writeSet('tactile', Wpx, Hpx, set, [-4, 5], {
    size: [Umm / 1000, Vmm / 1000],
    module: [S, S],
    bond: 'stack',
    bars,
    pitch,
    barTop: top,
    barBase: base,
    barHeight: h,
    normalScale: 1,
    roughness: [0.7, 0.97],
  });
}

/**
 * Fotoğraf 1'de ince bir şerit (t0..t1, s0..s1) → göreli ayrıntı yamaları (her biri len mm boyunca, dikişsiz).
 * Bordür boyası gibi taş olmayan yüzeyler için.
 */
function stripPool(model, t0, t1, s0, s1, len) {
  const R = rectify(model, s0, s1, t0, t1, 1);
  const out = [];
  for (let y0 = 0; y0 + len <= R.H; y0 += len) {
    const w = R.W;
    const h = len;
    const lin = [0, 1, 2].map(() => new Float32Array(w * h));
    let bad = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 3; c++) {
          const v = R.data[((y0 + y) * w + x) * 3 + c];
          if (!Number.isFinite(v)) bad = true;
          lin[c][y * w + x] = s2l((Number.isFinite(v) ? v : 128) / 255);
        }
    if (bad) continue;
    const rel = lin.map((a) => {
      const lo = blur(a, w, h, 12, false);
      return a.map((v, i) => v / Math.max(1e-4, lo[i]));
    });
    // u = boyuna (s), v = enine (t)
    out.push({ w: h, h: w, rel: rel.map((a) => seamless(transpose(a, w, h), h, w)) });
  }
  return out;
}

/** Bordür boyası (502. Sk. batı, bisiklet şeridi yanı): fotoğraftaki beyaz boya şeridinin benek deseni */
async function buildKerbPaint(model) {
  // Bordür üstünün boyalı dış yarısı: t ≈ 0.89–0.95 (düzeltilmiş görüntü; iç yarı gri beton, dış kenar yuvarlak)
  // Yalnız yakın alan (s < 0.45 m): uzakta s yönünde çözünürlük düşüyor → benekler boyuna uzuyor
  const pool = stripPool(model, 0.895, 0.945, 0.03, 0.45, 100);
  console.log(`  bordür boyası: ${pool.length} yama`);
  // KARAR: boya albedosu mevcut yol boyası (#eeeeea) × 0.9 (yıpranmış); benekler (boya tutmayan gözenek/kir)
  // kuruyken de koyu (boya gözeneksiz, ıslaklıkla az değişir) ama gözenek içi ıslakken daha koyu → kontrast 0.6
  const white = [0.855, 0.855, 0.82].map((v) => v * 0.9);
  return blendTexture('kerb-paint', pool, white, 0.6, 91, {
    note: '502sk-bati-bisiklet.jpg bordür üstü dış yarısı (t 0.895–0.945)',
  });
}

/** Bordür betonu: dünya uzayı üç düzlemli (realtex.ts) — derzsiz, yalnız tane + hafif leke (0.5 m × 0.5 m) */
async function buildKerb(pool, mean) {
  return blendTexture('kerb', pool, mean, ALPHA_DRY * 0.8, 77, { unit: KERB_UNIT });
}

/** Rastgele yama karışımı → dikişsiz N×N doku (0.5 m); ayrıntı kontrastı alpha */
async function blendTexture(name, pool, mean, alpha, seed, meta) {
  const N = 1024;
  const Umm = 500;
  const f = blendField(pool, N, Umm, seed);
  const px = f.px;
  const alb = new Float32Array(N * N * 3);
  const hgt = new Float32Array(N * N);
  const rgh = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const g = [f.rel[0][i], f.rel[1][i], f.rel[2][i]];
    for (let c = 0; c < 3; c++) alb[i * 3 + c] = mean[c] * (1 + alpha * (g[c] - 1));
    hgt[i] = (g[1] - 1) * 0.6;
    rgh[i] = clamp(0.86 - (g[1] - 1) * 0.2, 0.75, 0.95);
  }
  return writeSet(name, N, N, { alb, hgt, rgh, pxU: px, pxV: px }, [-1, 1], {
    size: [Umm / 1000, Umm / 1000],
    triplanar: true,
    roughness: [0.75, 0.95],
    ...meta,
  });
}

/**
 * Tane örneklerinin rastgele konumlu, yumuşak ağırlıklı karışımı → dikişsiz göreli ayrıntı alanı (N×N, Umm).
 * Bağımsız yamaların ağırlıklı toplamının varyansı Σw² ile ölçeklenir → geri normalize edilir (kontrast korunur).
 */
function blendField(pool, N, Umm, seed) {
  const r = rng(seed);
  const acc = [0, 1, 2].map(() => new Float32Array(N * N));
  const w2sum = new Float32Array(N * N);
  const px = Umm / N;
  // Her pikseli ortalama ~6 yama örtsün
  const pa = pool.reduce((s, p) => s + p.w * p.h, 0) / pool.length / (px * px);
  const count = Math.ceil((6 * N * N) / pa);
  for (let k = 0; k < count; k++) {
    const sw = pool[Math.floor(r() * pool.length)];
    const cx = r() * N;
    const cy = r() * N;
    const rw = sw.w / px / 2;
    const rh = sw.h / px / 2;
    for (let y = -rh; y < rh; y++)
      for (let x = -rw; x < rw; x++) {
        const X = ((Math.round(cx + x) % N) + N) % N;
        const Y = ((Math.round(cy + y) % N) + N) % N;
        const wx = 1 - Math.abs(x / rw);
        const wy = 1 - Math.abs(y / rh);
        const w = wx * wy;
        const gx = clamp(Math.floor((x + rw) * px), 0, sw.w - 1);
        const gy = clamp(Math.floor((y + rh) * px), 0, sw.h - 1);
        const gi = gy * sw.w + gx;
        const i = Y * N + X;
        for (let c = 0; c < 3; c++) acc[c][i] += w * (sw.rel[c][gi] - 1);
        w2sum[i] += w * w;
      }
  }
  for (let i = 0; i < N * N; i++) {
    const nrm = w2sum[i] > 0 ? Math.sqrt(w2sum[i]) : 1;
    for (let c = 0; c < 3; c++) acc[c][i] = 1 + acc[c][i] / nrm;
  }
  return { rel: acc, N, px };
}

/** Site içi I (kemik) kilit taşı */
function bonePattern(Umm) {
  const { L, P, a, end, flank, gap } = BONE;
  const perRow = Math.round(Umm / L);
  // Yarı genişlik profili (uzun kenar boyunca)
  const hw = (lu) => {
    const x = Math.min(lu, L - lu);
    if (x <= end) return P / 2 + a;
    if (x >= end + flank) return P / 2 - a;
    return P / 2 + a - ((x - end) / flank) * 2 * a;
  };
  // İşaretli mesafe (yaklaşık): profil eğrisine dik mesafe (eğim 45° → /√2 düzeltmesi)
  const dProfile = (lu, dv) => {
    const x = Math.min(lu, L - lu);
    const base = hw(lu) - Math.abs(dv);
    const onFlank = x > end && x < end + flank;
    return onFlank ? base / Math.SQRT2 : base;
  };
  return (u, v) => {
    const c0 = Math.round(v / P);
    let best = null;
    for (const c of [c0 - 1, c0, c0 + 1]) {
      const shift = ((c % 2) + 2) % 2 ? L / 2 : 0;
      const uu = u + shift;
      const col = Math.floor(uu / L);
      const lu = uu - col * L;
      const dv = v - c * P;
      const dSide = Math.min(lu, L - lu);
      const d = Math.min(dProfile(lu, dv), dSide) - gap / 2;
      // Sıra kimliği doku yüksekliğindeki sıra sayısıyla (14) sarılır: üst/alt kenardaki yarım taşlar aynı taş
      const cw = ((c % 14) + 14) % 14;
      if (!best || d > best.d)
        best = { id: `${cw}:${((col % perRow) + perRow) % perRow}`, d, lu, lv: dv + P / 2 + a };
    }
    return best;
  };
}

async function buildBone(name, pool, mean, cvDry, seed) {
  const { chamfer, sand, P } = BONE;
  const Umm = 2000;
  const Vmm = P * 14; // 1946 mm
  const N = 2048;
  const pattern = bonePattern(Umm);
  const make = (m) =>
    synth({
      Wpx: N,
      Hpx: N,
      Umm,
      Vmm,
      pattern,
      pool,
      seed,
      chamfer,
      // I taşı dikdörtgen değil → örnekten dikişsiz tane alanı, her taş rastgele pencere
      field: blendField(pool, 512, 500, seed + 7),
      stoneColor: stoneColorFn(m, cvDry),
      jointColor: (r) => m.map((v) => v * 0.6 * (1 + (r() - 0.5) * 0.1)),
      heightOf: (Q, s) => {
        if (Q.d < 0) return -sand;
        const top = s ? s.dz : 0;
        return Q.d < chamfer ? top - (chamfer - Q.d) : top;
      },
      rough: (Q, g) => (Q.d < 0 ? 0.97 : clamp(0.9 - (g - 1) * 0.25, 0.78, 0.96)),
    });
  let set = make(mean);
  const m0 = [0, 1, 2].map((c) => set.alb.reduce((s, v, i) => (i % 3 === c ? s + v : s), 0) / (N * N));
  set = make(mean.map((v, c) => (v * mean[c]) / m0[c]));
  return writeSet(name, N, N, set, [-7, 2], {
    size: [Umm / 1000, Vmm / 1000],
    module: [BONE.L, BONE.P],
    bond: 'running',
    endWidth: BONE.P + 2 * BONE.a,
    normalScale: 1,
    roughness: [0.78, 0.97],
  });
}

// ───────────────────────── ana akış ─────────────────────────
async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('• fotoğraf 1 perspektif modeli…');
  const model = await photo1Model();
  const report = await measure(model);
  if (MODE === 'measure') return;
  console.log('• tane havuzu (ıslak fotoğraf, taş içleri)…');
  const pool = grainPool(model);
  const cvDry = STONE_CV_DRY;
  console.log(
    `  ${pool.swatches.length} taş örneği / ${pool.courses} dizi; taşlar arası ton CV ıslak ${pool.cvWet.toFixed(3)} (×α = ${(pool.cvWet * ALPHA_DRY).toFixed(3)}), kullanılan kuru ${cvDry}; tane sd ıslak ${pool.grainSdWet.toFixed(3)}`,
  );
  if (pool.swatches.length < 8) throw new Error('tane havuzu çok küçük');
  const sw = pool.swatches;
  if (MODE === 'pool') {
    // Tane örnekleri mozaiği (denetim): her örnek göreli ayrıntı × 128
    const cols = 5;
    const cw = 240;
    const ch = 100;
    const rows = Math.ceil(sw.length / cols);
    const buf = Buffer.alloc(cols * cw * rows * ch * 3, 30);
    sw.forEach((s, k) => {
      const ox = (k % cols) * cw;
      const oy = Math.floor(k / cols) * ch;
      for (let y = 0; y < Math.min(ch - 4, s.h); y++)
        for (let x = 0; x < Math.min(cw - 4, s.w); x++)
          for (let c = 0; c < 3; c++)
            buf[((oy + y) * cols * cw + ox + x) * 3 + c] = clamp(
              Math.round(s.rel[c][y * s.w + x] * 128),
              0,
              255,
            );
    });
    await sharp(buf, { raw: { width: cols * cw, height: rows * ch, channels: 3 } })
      .jpeg()
      .toFile('/tmp/claude-0/rt-pool.jpg');
    console.log(
      'havuz → /tmp/claude-0/rt-pool.jpg',
      sw.map((s) => `${s.w}×${s.h}@${s.s.toFixed(2)}`).join(' '),
    );
    return;
  }
  // Site içi kemik taşı: renkler mevcut kalibrasyondan (c9bb320, yer fotoğrafları; site içi Street View yok)
  const siteGrey = ['#9d968e', '#a69f96', '#928b83', '#aca49b', '#978f86'];
  const siteRed = ['#a06d5f', '#aa7767', '#955f53', '#a87263'];
  const meanHex = (arr) => {
    const m = [0, 0, 0];
    for (const h of arr)
      for (let c = 0; c < 3; c++) m[c] += s2l(parseInt(h.slice(1 + 2 * c, 3 + 2 * c), 16) / 255) / arr.length;
    return m;
  };
  const manifest = {
    note: 'scripts/real-textures.mjs ile üretildi — ölçüler ve kanıtlar için betiğin başına ve measure çıktısına bakın',
    generatedAt: new Date().toISOString(),
    alphaDry: ALPHA_DRY,
    stoneToneCvDry: +cvDry.toFixed(4),
    measure: report,
    sets: {},
  };
  console.log('• dokular…');
  manifest.sets['paver-grey'] = await buildPaver('paver-grey', sw, MEAN_ALBEDO.grey, cvDry, 11);
  manifest.sets['paver-red'] = await buildPaver('paver-red', sw, MEAN_ALBEDO.red, cvDry, 12);
  manifest.sets.tactile = await buildTactile(sw, MEAN_ALBEDO.tactile);
  manifest.sets.kerb = await buildKerb(sw, MEAN_ALBEDO.kerb);
  manifest.sets['kerb-paint'] = await buildKerbPaint(model);
  manifest.sets['bone-grey'] = await buildBone('bone-grey', sw, meanHex(siteGrey), cvDry, 41);
  manifest.sets['bone-red'] = await buildBone('bone-red', sw, meanHex(siteRed), cvDry, 42);
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`✓ ${OUT}`);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
