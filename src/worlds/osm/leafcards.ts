import * as THREE from 'three';

/**
 * Tür başına yaprak kartı dokuları (canvas, çalışma anında çizilir) — 4×4 atlas, karo başına 512 px.
 * Kart tabanı karonun altı (dal ucu), tepe karonun üstüdür. Renkler Street View 2025-09 karelerinden ve
 * yer fotoğraflarından örneklenen yaprak tonlarıdır (docs/TREES.md "Renkler"); güneşli yamanın
 * ~%85'i albedo kabul edildi (ışık Street View'a kalibre).
 */

export const ATLAS_TILES = 4;

/** Atlas karoları (sıra = karo no, satır satır) */
export const TILE = {
  broad: 0,
  tilia: 1,
  ulmus: 2,
  robinia: 3,
  koelreuteria: 4,
  prunusPurple: 5,
  eriobotrya: 6,
  fruit: 7,
  glossy: 8,
  sapling: 9,
  pine: 10,
  cedar: 11,
  spruce: 12,
  goldcrest: 13,
  thuja: 14,
  palm: 15,
} as const;

type Ctx = CanvasRenderingContext2D;
type Rnd = () => number;

function mkRng(seed: number): Rnd {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const hex = (c: string) => new THREE.Color(c);

/** Rengi rastgele ton/parlaklık sapmasıyla CSS'e çevir */
function vary(base: string, r: Rnd, dl = 0.12, dh = 0.02, ds = 0.06): string {
  const c = hex(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + (r() - 0.5) * 2 * dh + 1) % 1,
    THREE.MathUtils.clamp(hsl.s + (r() - 0.5) * 2 * ds, 0, 1),
    THREE.MathUtils.clamp(hsl.l * (1 + (r() - 0.5) * 2 * dl), 0, 1),
  );
  return `#${c.getHexString()}`;
}

function shade(base: string, k: number): string {
  const c = hex(base).multiplyScalar(k);
  c.r = Math.min(1, c.r);
  c.g = Math.min(1, c.g);
  c.b = Math.min(1, c.b);
  return `#${c.getHexString()}`;
}

type LeafKind = 'ovate' | 'heart' | 'elliptic' | 'lanceolate' | 'round' | 'oblong';

/** Yaprak ayası yolu: taban (0,0), uç (0,-L), genişlik W (yerel koordinat, canvas y aşağı) */
function leafPath(ctx: Ctx, kind: LeafKind, L: number, W: number, serrate: number, r: Rnd): void {
  const w = W / 2;
  // Profil: t (0 taban … 1 uç) → yarı genişlik
  const prof = (t: number): number => {
    switch (kind) {
      case 'heart':
        return (
          w * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.8) * (1 - 0.35 * t) +
          (t < 0.12 ? w * 0.25 : 0)
        );
      case 'ovate':
        return w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9);
      case 'round':
        return w * Math.pow(Math.sin(Math.PI * t), 0.6);
      case 'elliptic':
        return w * Math.sin(Math.PI * t);
      case 'oblong':
        return w * Math.pow(Math.sin(Math.PI * t), 0.45);
      case 'lanceolate':
        return w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 1.2);
    }
  };
  const N = 22;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let x = prof(t);
    if (serrate > 0 && i > 1 && i < N - 1)
      x *= 1 + (i % 2 === 0 ? serrate : -serrate * 0.4) * (0.6 + r() * 0.8);
    pts.push([x, -t * L]);
  }
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(-pts[i][0] * (0.94 + r() * 0.06), pts[i][1]);
  ctx.closePath();
}

interface LeafStyle {
  kind: LeafKind;
  colors: string[];
  /** Alt yüzü görünen yapraklar (açık, gümüşi) ve olasılık */
  under?: string;
  underP?: number;
  serrate?: number;
  /** Parlaklık (parlak yapraklı türlerde beyazımsı yansıma lekesi) */
  gloss?: number;
  /** Damar belirginliği */
  rib?: number;
  /** Solgun/kahverengileşmiş yaprak rengi ve olasılığı (Eylül) */
  sere?: string;
  sereP?: number;
}

/** Tek yaprak: sapı (petiole) + aya; ağızdan uca doğru hafif ışık geçişi, orta damar */
function drawLeaf(
  ctx: Ctx,
  x: number,
  y: number,
  ang: number,
  L: number,
  W: number,
  st: LeafStyle,
  r: Rnd,
  petiole = 0.18,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const pl = L * petiole;
  if (pl > 1) {
    ctx.strokeStyle = shade(st.colors[0], 0.8);
    ctx.lineWidth = Math.max(1, W * 0.06);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -pl);
    ctx.stroke();
  }
  ctx.translate(0, -pl);
  // Hafif kıvrım: yaprak ekseni etrafında rastgele yatık görünüm için genişlik ölçeği
  const tilt = 0.55 + r() * 0.45;
  ctx.scale(tilt, 1);
  let base = st.colors[Math.floor(r() * st.colors.length)];
  if (st.under && r() < (st.underP ?? 0)) base = st.under;
  else if (st.sere && r() < (st.sereP ?? 0)) base = st.sere;
  const col = vary(base, r);
  leafPath(ctx, st.kind, L, W, st.serrate ?? 0, r);
  const g = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
  const side = r() < 0.5;
  g.addColorStop(0, shade(col, side ? 0.78 : 1.08));
  g.addColorStop(0.5, col);
  g.addColorStop(1, shade(col, side ? 1.08 : 0.78));
  ctx.fillStyle = g;
  ctx.fill();
  // Uca doğru hafif koyulaşma (kalın aya kenarı)
  const g2 = ctx.createLinearGradient(0, 0, 0, -L);
  g2.addColorStop(0, 'rgba(0,0,0,0)');
  g2.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g2;
  ctx.fill();
  if (st.gloss) {
    ctx.save();
    ctx.clip();
    const gg = ctx.createRadialGradient(W * 0.12, -L * 0.45, 0, W * 0.12, -L * 0.45, L * 0.35);
    gg.addColorStop(0, `rgba(235,245,225,${st.gloss})`);
    gg.addColorStop(1, 'rgba(235,245,225,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(-W, -L, W * 2, L);
    ctx.restore();
  }
  if ((st.rib ?? 0.5) > 0) {
    ctx.strokeStyle = shade(col, 1.25);
    ctx.globalAlpha = st.rib ?? 0.5;
    ctx.lineWidth = Math.max(0.8, W * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -L * 0.92);
    ctx.stroke();
    // Yan damarlar
    ctx.lineWidth = Math.max(0.5, W * 0.018);
    ctx.globalAlpha = (st.rib ?? 0.5) * 0.55;
    for (let k = 1; k < 6; k++) {
      const t = k / 6.5;
      const yy = -t * L;
      const xx = W * 0.35 * Math.sin(Math.PI * t);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(xx, yy - L * 0.08);
      ctx.moveTo(0, yy);
      ctx.lineTo(-xx, yy - L * 0.08);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function stroke(ctx: Ctx, pts: [number, number][], w0: number, w1: number, color: string): void {
  // Uca doğru incelen dal çizgisi
  for (let i = 0; i + 1 < pts.length; i++) {
    const t = i / Math.max(1, pts.length - 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = w0 + (w1 - w0) * t;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
}

/** Kavisli dal (taban → uç) noktaları */
function curve(x0: number, y0: number, x1: number, y1: number, bend: number, n = 10): [number, number][] {
  const out: [number, number][] = [];
  const mx = (x0 + x1) / 2 - (y1 - y0) * bend;
  const my = (y0 + y1) / 2 + (x1 - x0) * bend;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([a * x0 + b * mx + c * x1, a * y0 + b * my + c * y1]);
  }
  return out;
}

/**
 * Basit yapraklı sürgün: taban ortadan yukarı ana sürgün + yan sürgünler, yapraklar almaşık.
 * S = karo boyu; yaprak boyu L (px).
 */
function broadTwig(
  ctx: Ctx,
  S: number,
  st: LeafStyle,
  seed: number,
  o: {
    L: number;
    W: number;
    per: number;
    side: number;
    twig: string;
    spread?: number;
    petiole?: number;
    /** Yan sürgün başına kısa alt sürgün sayısı (sık taçlı türler) */
    sub?: number;
  },
): void {
  const r = mkRng(seed);
  const main = curve(S * 0.5, S * 0.99, S * (0.45 + r() * 0.1), S * 0.06, (r() - 0.5) * 0.25);
  stroke(ctx, main, S * 0.018, S * 0.006, o.twig);
  const shoots: [number, number][][] = [main];
  for (let k = 0; k < o.side; k++) {
    const t = 0.2 + (0.65 * (k + r() * 0.5)) / o.side;
    const p = main[Math.floor(t * (main.length - 1))];
    const dir = k % 2 === 0 ? 1 : -1;
    const len = S * (0.26 + r() * 0.16) * (o.spread ?? 1);
    const e: [number, number] = [p[0] + dir * len * (0.75 + r() * 0.2), p[1] - len * (0.55 + r() * 0.35)];
    const sh = curve(p[0], p[1], e[0], e[1], dir * (0.1 + r() * 0.12), 6);
    stroke(ctx, sh, S * 0.01, S * 0.004, o.twig);
    shoots.push(sh);
    for (let m = 0; m < (o.sub ?? 0); m++) {
      const tt = 0.3 + (0.55 * (m + r() * 0.5)) / (o.sub ?? 1);
      const q = sh[Math.floor(tt * (sh.length - 1))];
      const d2 = (m % 2 === 0 ? -1 : 1) * dir;
      const l2 = len * (0.32 + r() * 0.16);
      const e2: [number, number] = [q[0] + d2 * l2 * (0.45 + r() * 0.3), q[1] - l2 * (0.75 + r() * 0.2)];
      const s2 = curve(q[0], q[1], e2[0], e2[1], d2 * 0.08, 4);
      stroke(ctx, s2, S * 0.006, S * 0.003, o.twig);
      shoots.push(s2);
    }
  }
  // Yapraklar: her sürgün boyunca almaşık, uca doğru küçülen
  for (const sh of shoots) {
    const n = Math.max(3, Math.round(o.per * (sh.length / 10)));
    for (let i = 0; i < n; i++) {
      const t = 0.18 + (0.82 * i) / Math.max(1, n - 1);
      const idx = Math.min(sh.length - 2, Math.floor(t * (sh.length - 1)));
      const a = sh[idx];
      const b = sh[idx + 1];
      const along = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
      const side = i % 2 === 0 ? 1 : -1;
      const ang = along + side * (0.55 + r() * 0.45);
      const sc = 1 - 0.35 * t + (r() - 0.5) * 0.25;
      drawLeaf(ctx, a[0], a[1], ang, o.L * sc, o.W * sc, st, r, o.petiole ?? 0.18);
    }
    // Uç yaprağı
    const e = sh[sh.length - 1];
    const f = sh[sh.length - 2];
    drawLeaf(
      ctx,
      e[0],
      e[1],
      Math.atan2(e[0] - f[0], -(e[1] - f[1])),
      o.L * 0.7,
      o.W * 0.7,
      st,
      r,
      o.petiole ?? 0.18,
    );
  }
}

/** Bileşik (tüysü) yaprak: ara eksen + karşılıklı yaprakçıklar + uç yaprakçığı */
function pinnate(
  ctx: Ctx,
  x: number,
  y: number,
  ang: number,
  len: number,
  pairs: number,
  leaflet: [number, number],
  st: LeafStyle,
  r: Rnd,
  rachis: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const bend = (r() - 0.5) * 0.3;
  const pts = curve(0, 0, len * bend, -len, bend * 0.4, 8);
  stroke(ctx, pts, 2.2, 1, rachis);
  for (let k = 0; k < pairs; k++) {
    const t = 0.18 + (0.78 * k) / Math.max(1, pairs - 1);
    const p = pts[Math.min(pts.length - 1, Math.round(t * (pts.length - 1)))];
    for (const s of [-1, 1]) {
      const a = s * (1.1 + (r() - 0.5) * 0.35);
      const sc = 0.85 + r() * 0.3;
      drawLeaf(ctx, p[0], p[1], a, leaflet[0] * sc, leaflet[1] * sc, st, r, 0.06);
    }
  }
  const e = pts[pts.length - 1];
  drawLeaf(ctx, e[0], e[1], bend, leaflet[0], leaflet[1], st, r, 0.06);
  ctx.restore();
}

/** İğne demeti / tutam: merkezden ışınsal kısa çizgiler */
function needleTuft(
  ctx: Ctx,
  x: number,
  y: number,
  n: number,
  len: number,
  colors: string[],
  r: Rnd,
  spreadDir = -Math.PI / 2,
  spread = Math.PI * 2,
  width = 1.3,
): void {
  for (let i = 0; i < n; i++) {
    const a = spreadDir + (r() - 0.5) * spread;
    const l = len * (0.6 + r() * 0.5);
    ctx.strokeStyle = vary(colors[Math.floor(r() * colors.length)], r, 0.18);
    ctx.lineWidth = width * (0.7 + r() * 0.6);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

/**
 * Pullu yapraklı yassı sürgün (servi/mazı/limoni): kavisli eksen + almaşık yan dalcıklar (tüysü yelpaze),
 * her parça koyu kenar + açık orta şeritle (pul dokusu); uç dalcıklar açık renk.
 */
function scaleSpray(
  ctx: Ctx,
  x: number,
  y: number,
  ang: number,
  len: number,
  depth: number,
  col: { base: string; tip: string; dark: string },
  r: Rnd,
  w: number,
): void {
  const bend = (r() - 0.5) * 0.5;
  const N = 5;
  const pts: [number, number][] = [[x, y]];
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const a = ang + bend * t;
    const p = pts[i - 1];
    pts.push([p[0] + (Math.sin(a) * len) / N, p[1] - (Math.cos(a) * len) / N]);
  }
  const c = vary(depth <= 0 ? col.tip : depth === 1 ? col.base : col.dark, r, 0.1);
  for (let i = 0; i < N; i++) {
    const ww = w * (1 - (0.45 * i) / N);
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade(c, 0.82);
    ctx.lineWidth = ww;
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
    ctx.strokeStyle = shade(c, 1.12);
    ctx.lineWidth = ww * 0.45;
    ctx.stroke();
  }
  if (depth <= 0) return;
  const n = depth >= 2 ? 6 + Math.floor(r() * 3) : 4 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const f = 0.12 + (0.8 * (k + r() * 0.4)) / n;
    const i = Math.min(N - 1, Math.floor(f * N));
    const p = pts[i];
    const s = k % 2 === 0 ? 1 : -1;
    scaleSpray(
      ctx,
      p[0],
      p[1],
      ang + bend * f + s * (0.55 + r() * 0.3),
      len * (0.36 + r() * 0.16) * (1 - f * 0.45),
      depth - 1,
      col,
      r,
      w * 0.8,
    );
  }
}

function tileBroad(
  ctx: Ctx,
  S: number,
  st: LeafStyle,
  seed: number,
  o: Parameters<typeof broadTwig>[4],
): void {
  broadTwig(ctx, S, st, seed, o);
}

/** Yelpaze palmiye yaprağı: alt %32 sap, üstte hastuladan ışınsal ~40 dilim (2/3'e kadar yarık) */
function tilePalm(ctx: Ctx, S: number, seed: number): void {
  const r = mkRng(seed);
  const cx = S * 0.5;
  const hy = S * 0.62; // hastula (v = 0.38)
  // Sap: dikenli kenarlı ince, koyu yeşil-kahve
  stroke(
    ctx,
    [
      [cx, S],
      [cx, hy],
    ],
    S * 0.03,
    S * 0.024,
    '#4c5a33',
  );
  const segs = 40;
  // Yuvarlak yelpaze: yan dilimler karo kenarını aşmasın
  const R = S * 0.47;
  for (let k = 0; k < segs; k++) {
    const t = k / (segs - 1);
    const a = -Math.PI / 2 + (t - 0.5) * Math.PI * 1.45;
    const l = R * (0.85 + 0.15 * Math.sin(Math.PI * t)) * (0.9 + r() * 0.12);
    ctx.save();
    ctx.translate(cx, hy);
    ctx.rotate(a + Math.PI / 2);
    // Dilim: tabanda birleşik (geniş), uca doğru incelen şerit; dıştaki üçte bir serbest (yarık)
    const w0 = ((Math.PI * 1.45 * R * 0.3) / segs) * 1.05;
    const col = vary('#627a53', r, 0.12);
    const g = ctx.createLinearGradient(-w0 / 2, 0, w0 / 2, 0);
    g.addColorStop(0, shade(col, 0.72));
    g.addColorStop(0.5, shade(col, 1.18));
    g.addColorStop(1, shade(col, 0.8));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w0 * 0.2, 0);
    ctx.lineTo(-w0 * 0.55, -l * 0.3);
    ctx.lineTo(-w0 * 0.42, -l * 0.66);
    ctx.lineTo(-w0 * 0.12, -l * 0.97);
    ctx.lineTo(0, -l * 0.9);
    ctx.lineTo(w0 * 0.12, -l);
    ctx.lineTo(w0 * 0.42, -l * 0.66);
    ctx.lineTo(w0 * 0.55, -l * 0.3);
    ctx.lineTo(w0 * 0.2, 0);
    ctx.closePath();
    ctx.fill();
    // Katlanma çizgisi (açık)
    ctx.strokeStyle = shade(col, 1.35);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -l * 0.05);
    ctx.lineTo(0, -l * 0.88);
    ctx.stroke();
    ctx.restore();
  }
  // Hastula (yaprak ayası–sap birleşimi)
  ctx.fillStyle = '#5a6a3e';
  ctx.beginPath();
  ctx.ellipse(cx, hy, S * 0.035, S * 0.02, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Meyve kapsülü salkımı (Koelreuteria): turuncu-kahve fener kapsüller */
function capsules(ctx: Ctx, x: number, y: number, n: number, r: Rnd): void {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * 26;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d * 0.8;
    ctx.fillStyle = vary(['#b97c4c', '#c58f5c', '#9e6440', '#a8804f'][Math.floor(r() * 4)], r, 0.15);
    ctx.beginPath();
    ctx.ellipse(px, py, 5 + r() * 3, 7 + r() * 4, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

let atlasCache: THREE.CanvasTexture | null = null;

/** 4×4 yaprak atlası (2048² ya da 1024²) */
export function leafAtlas(size = 2048): THREE.CanvasTexture {
  if (atlasCache) return atlasCache;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const S = size / ATLAS_TILES;
  const tile = (i: number, draw: (c: Ctx) => void) => {
    ctx.save();
    ctx.translate((i % ATLAS_TILES) * S, Math.floor(i / ATLAS_TILES) * S);
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    draw(ctx);
    ctx.restore();
  };
  const k = S / 512;
  const twigBrown = '#5a4a38';
  // 0 genel yaprak döken: yumurta biçimli, orta yeşil
  tile(TILE.broad, (c) =>
    tileBroad(
      c,
      S,
      { kind: 'ovate', colors: ['#7a8c48', '#6c7f3e', '#8a9a54'], serrate: 0.05, rib: 0.35 },
      11,
      {
        L: 62 * k,
        W: 40 * k,
        per: 7,
        side: 6,
        sub: 2,
        twig: twigBrown,
      },
    ),
  );
  // 1 ıhlamur: kalp biçimli, dişli; az sayıda yaprak gümüşi alt yüzünü gösterir (kgyF 240, kamelya fotoğrafı)
  tile(TILE.tilia, (c) =>
    tileBroad(
      c,
      S,
      {
        kind: 'heart',
        colors: ['#76844a', '#687a40', '#828f52'],
        under: '#a2ad84',
        underP: 0.08,
        serrate: 0.07,
        rib: 0.4,
        sere: '#b3a24e',
        sereP: 0.04,
      },
      23,
      { L: 74 * k, W: 68 * k, per: 5, side: 6, sub: 1, twig: '#4f4232', petiole: 0.25 },
    ),
  );
  // 2 karaağaç tipi: küçük, asimetrik, dişli, koyu; sık
  tile(TILE.ulmus, (c) =>
    tileBroad(
      c,
      S,
      { kind: 'ovate', colors: ['#879560', '#7a8854', '#939f69'], serrate: 0.1, rib: 0.4 },
      37,
      {
        L: 42 * k,
        W: 27 * k,
        per: 9,
        side: 8,
        sub: 2,
        twig: '#4a3d30',
        petiole: 0.1,
      },
    ),
  );
  // 3 akasya: tüysü bileşik yaprak, oval yaprakçıklar, açık sarımsı yeşil
  tile(TILE.robinia, (c) => {
    const r = mkRng(41);
    const st: LeafStyle = {
      kind: 'elliptic',
      colors: ['#8aa648', '#98b454', '#7e9a42'],
      rib: 0.25,
      sere: '#b8b25a',
      sereP: 0.05,
    };
    const main = curve(S * 0.5, S, S * 0.48, S * 0.1, 0.06);
    stroke(c, main, 5 * k, 2 * k, '#5b4b39');
    for (let i = 0; i < 9; i++) {
      const t = 0.12 + i * 0.095;
      const p = main[Math.floor(t * (main.length - 1))];
      const s = i % 2 === 0 ? 1 : -1;
      pinnate(
        c,
        p[0],
        p[1],
        s * (0.55 + r() * 0.4),
        S * (0.4 - t * 0.14),
        6,
        [30 * k, 17 * k],
        st,
        r,
        '#6b7a3c',
      );
    }
    pinnate(
      c,
      main[main.length - 1][0],
      main[main.length - 1][1],
      0,
      S * 0.25,
      4,
      [28 * k, 16 * k],
      st,
      r,
      '#6b7a3c',
    );
  });
  // 4 Koelreuteria: dişli yaprakçıklı bileşik yaprak + turuncu-kahve kapsül salkımları (Eylül; 7xGS 0, 2ydcI 300)
  tile(TILE.koelreuteria, (c) => {
    const r = mkRng(53);
    const st: LeafStyle = {
      kind: 'ovate',
      colors: ['#8a9f58', '#7d9350', '#95a862'],
      serrate: 0.18,
      rib: 0.3,
    };
    const main = curve(S * 0.5, S, S * 0.52, S * 0.14, -0.05);
    stroke(c, main, 5 * k, 2 * k, '#5b4b39');
    for (let i = 0; i < 8; i++) {
      const t = 0.1 + i * 0.1;
      const p = main[Math.floor(t * (main.length - 1))];
      const s = i % 2 === 0 ? 1 : -1;
      pinnate(
        c,
        p[0],
        p[1],
        s * (0.6 + r() * 0.35),
        S * (0.38 - t * 0.12),
        5,
        [34 * k, 18 * k],
        st,
        r,
        '#6f7c40',
      );
    }
    // Kapsüller yalnız sürgün ucunda, seyrek (karelerde taç üstünde kahve-turuncu lekeler)
    capsules(c, S * 0.5, S * 0.12, 11, r);
  });
  // 5 kan erik: küçük eliptik, koyu şarap moru, arada bronz-yeşil
  tile(TILE.prunusPurple, (c) =>
    tileBroad(
      c,
      S,
      {
        kind: 'elliptic',
        colors: ['#5e2c32', '#6b3338', '#522a2e', '#5a3a30'],
        serrate: 0.05,
        rib: 0.3,
        gloss: 0.12,
      },
      67,
      { L: 46 * k, W: 28 * k, per: 9, side: 7, sub: 2, twig: '#3d2a24', petiole: 0.12 },
    ),
  );
  // 6 yenidünya: iri mızraksı, derimsi, koyu yeşil, dal uçlarında rozet (BfxM 354); alt yüz nadiren görünür
  tile(TILE.eriobotrya, (c) => {
    const r = mkRng(71);
    const st: LeafStyle = {
      kind: 'lanceolate',
      colors: ['#566b36', '#617540', '#4d6131'],
      under: '#8a8f6a',
      underP: 0.06,
      serrate: 0.06,
      rib: 0.55,
      gloss: 0.2,
    };
    stroke(c, curve(S * 0.5, S, S * 0.5, S * 0.5, 0.02), 8 * k, 5 * k, '#6a5a45');
    for (const [x, y, n, sc] of [
      [0.5, 0.5, 10, 1],
      [0.22, 0.74, 7, 0.8],
      [0.78, 0.76, 7, 0.8],
      [0.36, 0.34, 6, 0.7],
      [0.66, 0.3, 6, 0.7],
    ] as const) {
      if (x !== 0.5)
        stroke(
          c,
          [
            [S * 0.5, S * 0.9],
            [S * x, S * y],
          ],
          5 * k,
          3 * k,
          '#6a5a45',
        );
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 * 0.62 - Math.PI * 0.62 + (r() - 0.5) * 0.25;
        drawLeaf(c, S * x, S * y, a, S * (0.26 + r() * 0.06) * sc, S * 0.075 * sc, st, r, 0.05);
      }
    }
  });
  // 7 meyve ağacı (tür belirsiz): yumurta biçimli, açık sarımsı yeşil, seyrek
  tile(TILE.fruit, (c) =>
    tileBroad(
      c,
      S,
      {
        kind: 'ovate',
        colors: ['#8c9f55', '#96a85f', '#80944c'],
        serrate: 0.08,
        rib: 0.4,
        sere: '#b3a14c',
        sereP: 0.05,
      },
      83,
      { L: 60 * k, W: 37 * k, per: 6, side: 6, sub: 1, twig: '#5a4838', petiole: 0.2 },
    ),
  );
  // 8 parlak yapraklı her dem yeşil: eliptik, koyu, parlak (yer fotoğrafları: havuz ve iç yol)
  tile(TILE.glossy, (c) =>
    tileBroad(
      c,
      S,
      { kind: 'elliptic', colors: ['#3f5a2e', '#4a6636', '#365029'], serrate: 0.03, rib: 0.35, gloss: 0.28 },
      97,
      { L: 64 * k, W: 30 * k, per: 7, side: 6, sub: 2, twig: '#4a3a2c', petiole: 0.1 },
    ),
  );
  // 9 fidan: seyrek küçük yapraklar, bir kısmı sararmış/kahve (Eylül; DIKa karesi)
  tile(TILE.sapling, (c) =>
    tileBroad(
      c,
      S,
      {
        kind: 'ovate',
        colors: ['#6f7a3f', '#7b8646', '#65703a'],
        serrate: 0.06,
        rib: 0.35,
        sere: '#8f7442',
        sereP: 0.2,
      },
      109,
      { L: 54 * k, W: 32 * k, per: 5, side: 5, sub: 1, twig: '#5d5040', petiole: 0.2, spread: 0.8 },
    ),
  );
  // 10 çam: uzun iğne demetleri
  tile(TILE.pine, (c) => {
    const r = mkRng(113);
    const main = curve(S * 0.5, S, S * 0.5, S * 0.12, 0.04);
    stroke(c, main, 7 * k, 3 * k, '#5a4332');
    for (let i = 3; i < main.length; i++)
      needleTuft(
        c,
        main[i][0],
        main[i][1],
        26,
        120 * k * (1 - i / 22),
        ['#4a6331', '#557038', '#3f5629'],
        r,
        -Math.PI / 2,
        Math.PI * 1.3,
        1.8 * k,
      );
  });
  // 11 sedir: hafif kemerli dal, sık yan sürgünlerde iğne rozetleri (kısa sürgün), gri-mavi yeşil (Y11WZ, h329R2)
  tile(TILE.cedar, (c) => {
    const r = mkRng(127);
    const cols = ['#8a9c72', '#7e9068', '#97a97d', '#74865f'];
    const main = curve(S * 0.5, S, S * 0.47, S * 0.04, 0.06, 16);
    stroke(c, main, 5 * k, 2 * k, '#4d4034');
    for (let i = 1; i < main.length; i++) {
      const p = main[i];
      const reach = 1 - (i / main.length) * 0.5;
      for (const s of [-1, 1]) {
        // yan sürgün: 2–3 rozet
        const len = (60 + r() * 60) * k * reach;
        const a = s * (0.9 + r() * 0.5);
        const e: [number, number] = [p[0] + Math.sin(a) * len, p[1] - Math.cos(a) * len * 0.6];
        stroke(c, [p, e], 2 * k, 1 * k, '#5b4c3c');
        for (let q = 1; q <= 3; q++) {
          const f = q / 3;
          const x = p[0] + (e[0] - p[0]) * f;
          const y = p[1] + (e[1] - p[1]) * f;
          needleTuft(c, x, y, 22, 17 * k, cols, r, -Math.PI / 2, Math.PI * 2, 1.4 * k);
        }
      }
      needleTuft(c, p[0], p[1], 16, 16 * k, cols, r, -Math.PI / 2, Math.PI * 2, 1.3 * k);
    }
  });
  // 12 mavi ladin: sert, sık fırça sürgünler, gümüşi mavi (d_xiN 0, TRTBV 300)
  tile(TILE.spruce, (c) => {
    const r = mkRng(131);
    const cols = ['#7e958f', '#8fa49e', '#6f8680', '#9bb0a9'];
    for (const [x1, y1, b] of [
      [0.5, 0.05, 0.02],
      [0.16, 0.3, 0.1],
      [0.84, 0.3, -0.1],
      [0.3, 0.12, 0.05],
      [0.7, 0.12, -0.05],
    ] as const) {
      const main = curve(S * 0.5, S, S * x1, S * y1, b, 16);
      stroke(c, main, 4 * k, 2 * k, '#6a5a48');
      for (let i = 1; i < main.length; i++)
        needleTuft(c, main[i][0], main[i][1], 22, 30 * k, cols, r, -Math.PI / 2, Math.PI * 1.8, 2.2 * k);
    }
  });
  // 13 limoni servi (Goldcrest): yumuşak, yukarı kalkık pullu sürgünler, limon yeşili uçlar (yer fotoğrafları)
  tile(TILE.goldcrest, (c) => {
    const r = mkRng(137);
    const col = { base: '#86a042', tip: '#a3ba4f', dark: '#67813a' };
    for (let i = 0; i < 7; i++)
      scaleSpray(
        c,
        S * (0.28 + r() * 0.44),
        S * (0.99 - r() * 0.12),
        (r() - 0.5) * 0.9,
        S * (0.48 + r() * 0.24),
        3,
        col,
        r,
        6 * k,
      );
  });
  // 14 mazı/servi: yassı dikey sürgün yelpazeleri, orta yeşil (servi/şimşir için köşe rengiyle koyulaştırılır)
  tile(TILE.thuja, (c) => {
    const r = mkRng(149);
    const col = { base: '#557a33', tip: '#7a9a42', dark: '#3e5a26' };
    for (let i = 0; i < 8; i++)
      scaleSpray(
        c,
        S * (0.2 + r() * 0.6),
        S * (0.99 - r() * 0.1),
        (r() - 0.5) * 0.7,
        S * (0.44 + r() * 0.26),
        3,
        col,
        r,
        6.5 * k,
      );
  });
  // 15 palmiye yelpazesi (Trachycarpus)
  tile(TILE.palm, (c) => tilePalm(c, S, 151));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasCache = tex;
  return tex;
}

export function disposeLeafAtlas(): void {
  atlasCache?.dispose();
  atlasCache = null;
}

/** Karo UV dönüşümü: (u, v) ∈ [0,1]² → atlas (flipY: canvas üstü = v 1) */
export function tileUV(tile: number, u: number, v: number): [number, number] {
  const tx = tile % ATLAS_TILES;
  const ty = Math.floor(tile / ATLAS_TILES);
  const pad = 0.004;
  const uu = pad + u * (1 - 2 * pad);
  const vv = pad + v * (1 - 2 * pad);
  return [(tx + uu) / ATLAS_TILES, 1 - (ty + 1 - vv) / ATLAS_TILES];
}

/**
 * Kabuk dokuları (tekrarlı): düzgün genç kabuk (fidan, erik, yenidünya) ve lifli palmiye gövdesi.
 * Koyu/açık tonlar köşe rengiyle türe göre renklenir → doku gri tonlu, ortalama ~0.6.
 */
export function barkTexture(kind: 'smooth' | 'palm'): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  const r = mkRng(kind === 'palm' ? 7 : 3);
  if (kind === 'smooth') {
    c.fillStyle = '#9a9a9a';
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      const g = 120 + Math.floor(r() * 60);
      c.fillStyle = `rgba(${g},${g},${g},0.25)`;
      c.fillRect(r() * W, r() * H, 2 + r() * 14, 1 + r() * 3);
    }
    // Kovucuklar (lentisel): yatay kısa açık çizgiler
    for (let i = 0; i < 160; i++) {
      c.fillStyle = 'rgba(200,200,200,0.5)';
      c.fillRect(r() * W, r() * H, 3 + r() * 6, 1.2);
    }
    // Dikey ince çatlaklar
    for (let i = 0; i < 40; i++) {
      c.strokeStyle = 'rgba(60,60,60,0.25)';
      c.lineWidth = 1;
      c.beginPath();
      const x = r() * W;
      c.moveTo(x, r() * H);
      c.lineTo(x + (r() - 0.5) * 6, r() * H);
      c.stroke();
    }
  } else {
    // Trachycarpus: gövdeyi saran koyu kahve lif örtüsü + eski yaprak sapı dipleri (yatay halkalar)
    c.fillStyle = '#5a5a5a';
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600; i++) {
      const g = 50 + Math.floor(r() * 90);
      c.strokeStyle = `rgba(${g},${g},${g},0.55)`;
      c.lineWidth = 0.8 + r() * 1.4;
      const x = r() * W;
      const y = r() * H;
      const a = (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6);
      const l = 10 + r() * 30;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
    for (let y = 0; y < H; y += 32) {
      for (let x = 0; x < W; x += 36) {
        const ox = x + (Math.floor(y / 32) % 2) * 18 + (r() - 0.5) * 6;
        c.fillStyle = 'rgba(130,130,130,0.7)';
        c.beginPath();
        c.ellipse(ox, y + 10, 14, 6, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(30,30,30,0.6)';
        c.fillRect(ox - 13, y + 15, 26, 3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
