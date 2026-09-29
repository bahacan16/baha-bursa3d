import * as THREE from 'three';

/** Deterministik gürültü */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement | OffscreenCanvas, CanvasRenderingContext2D] {
  const c =
    typeof document !== 'undefined'
      ? document.createElement('canvas')
      : (new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement);
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function tex(c: HTMLCanvasElement | OffscreenCanvas, repeat = true, srgb = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c as HTMLCanvasElement);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Hafif lekeli ince sıva (tekrarlı, 2 m) — beyaz cephe */
export function plasterTexture(base: string, seed = 1, groove = false): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  for (let i = 0; i < 6000; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.02 + r() * 0.03})` : `rgba(255,255,255,${0.03 + r() * 0.04})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  // Yağmur izi: çok hafif dikey lekeler
  for (let i = 0; i < 10; i++) {
    const x = r() * 256;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(90,90,90,0.05)');
    grd.addColorStop(1, 'rgba(90,90,90,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, 3 + r() * 6, 256);
  }
  // Kat derzi (doku yüksekliği = 1 kat): alt kenarda ince gölgeli çizgi
  if (groove) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, 252, 256, 2);
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.fillRect(0, 254, 256, 1);
  }
  return tex(c);
}

/** Klima dış ünitesi ön yüzü: beyaz kasa, dairesel fan ızgarası, sağda servis kapağı */
export function acTexture(): THREE.Texture {
  const [c, g] = canvas(128, 96);
  g.fillStyle = '#eceeec';
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = '#2b2e30';
  g.beginPath();
  g.arc(48, 48, 36, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8d9396';
  g.lineWidth = 1.5;
  for (let r = 8; r < 36; r += 6) {
    g.beginPath();
    g.arc(48, 48, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let a = 0; a < 8; a++) {
    g.beginPath();
    g.moveTo(48, 48);
    g.lineTo(48 + Math.cos((a * Math.PI) / 4) * 36, 48 + Math.sin((a * Math.PI) / 4) * 36);
    g.stroke();
  }
  g.fillStyle = '#d6d9d8';
  g.fillRect(96, 10, 24, 76);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 90, 128, 6);
  return tex(c, false);
}

/** Plastik panjur lameli (yatay, açık gri) */
export function shutterTexture(): THREE.Texture {
  const [c, g] = canvas(32, 32);
  g.fillStyle = '#d4d6d5';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 28, 32, 4);
  g.fillStyle = 'rgba(255,255,255,0.3)';
  g.fillRect(0, 2, 32, 3);
  return tex(c);
}

/** Güneş enerjili su ısıtıcısı paneli: koyu mavi cam, alüminyum çerçeve, boru ızgarası */
export function solarTexture(): THREE.Texture {
  const [c, g] = canvas(64, 128);
  const grd = g.createLinearGradient(0, 0, 64, 128);
  grd.addColorStop(0, '#2a3f5c');
  grd.addColorStop(1, '#16202e');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = 'rgba(160,180,200,0.35)';
  g.lineWidth = 1;
  for (let x = 6; x < 64; x += 6) {
    g.beginPath();
    g.moveTo(x, 4);
    g.lineTo(x, 124);
    g.stroke();
  }
  g.strokeStyle = '#b8bec4';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 60, 124);
  return tex(c, false);
}

/** Apartman giriş kapısı: alüminyum çift kanat, buzlu cam, yatay kol */
export function entryDoorTexture(): THREE.Texture {
  const [c, g] = canvas(128, 160);
  g.fillStyle = '#3d4246';
  g.fillRect(0, 0, 128, 160);
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, '#8fa2ac');
  grd.addColorStop(1, '#46535a');
  g.fillStyle = grd;
  g.fillRect(8, 8, 52, 120);
  g.fillRect(68, 8, 52, 120);
  g.fillStyle = 'rgba(230,235,238,0.35)';
  g.fillRect(8, 60, 52, 16);
  g.fillRect(68, 60, 52, 16);
  g.fillStyle = '#c9ccd0';
  g.fillRect(50, 82, 6, 30);
  g.fillRect(72, 82, 6, 30);
  g.fillStyle = '#50565a';
  g.fillRect(8, 134, 112, 20);
  return tex(c, false);
}

export function windowTexture(variant: number, frame = '#f4f4f1'): THREE.Texture {
  const W = 128;
  const H = 160;
  const [c, g] = canvas(W, H);
  const r = rng(variant * 7919 + 3);
  // Cam (gökyüzü yansıması + koyu iç)
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#9fb3c4');
  grd.addColorStop(0.5, '#5d6f7c');
  grd.addColorStop(1, '#3a434a');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // Perde / jaluzi
  const blind = 0.15 + r() * 0.6;
  const tone = ['#e8e4dc', '#d9d4c8', '#bfc2c2', '#f0ede6', '#cfc6b4'][Math.floor(r() * 5)];
  g.fillStyle = tone;
  g.fillRect(8, 8, W - 16, (H - 16) * blind);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let y = 12; y < 8 + (H - 16) * blind; y += 5) {
    g.beginPath();
    g.moveTo(8, y);
    g.lineTo(W - 8, y);
    g.stroke();
  }
  // Tül perde (bazı pencerelerde)
  if (r() < 0.5) {
    g.fillStyle = 'rgba(245,242,235,0.55)';
    g.fillRect(8, 8 + (H - 16) * blind, (W - 16) * (0.3 + r() * 0.4), (H - 16) * (1 - blind));
  }
  // Çerçeve: dış kasa + orta kayıt + kanat
  g.fillStyle = frame;
  g.fillRect(0, 0, W, 8);
  g.fillRect(0, H - 10, W, 10);
  g.fillRect(0, 0, 8, H);
  g.fillRect(W - 8, 0, 8, H);
  g.fillRect(W / 2 - 4, 0, 8, H);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 1;
  g.strokeRect(8.5, 8.5, W / 2 - 12, H - 19);
  g.strokeRect(W / 2 + 4.5, 8.5, W / 2 - 13, H - 19);
  // Yansıma parıltısı
  const sh = g.createLinearGradient(0, 0, W, H);
  sh.addColorStop(0.3, 'rgba(255,255,255,0)');
  sh.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  sh.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(8, 8, W - 16, H - 18);
  return tex(c, false);
}

/** Cam balkon (yeşilimsi cam + alüminyum kayıtlar), yatay tekrar 1 panel = 0.8 m */
export function glazingTexture(): THREE.Texture {
  const [c, g] = canvas(64, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#9fb4b6');
  grd.addColorStop(1, '#5a6b70');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#c9ccce';
  g.fillRect(0, 0, 3, 128);
  g.fillRect(0, 0, 64, 4);
  g.fillRect(0, 124, 64, 4);
  g.fillStyle = 'rgba(255,255,255,0.15)';
  g.fillRect(20, 0, 10, 128);
  return tex(c);
}

/** Yatay oluklu beyaz taş kaplama (site duvarı): 1 m × 0.65 m */
export function groovedStoneTexture(): THREE.Texture {
  const [c, g] = canvas(256, 160);
  g.fillStyle = '#eceae4';
  g.fillRect(0, 0, 256, 160);
  const r = rng(11);
  for (let y = 0; y < 160; y += 16) {
    g.fillStyle = 'rgba(0,0,0,0.13)';
    g.fillRect(0, y + 13, 256, 3);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(0, y + 12, 256, 1);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(120,110,95,${r() * 0.08})`;
      g.fillRect(r() * 256, y + r() * 12, 6 + r() * 20, 1 + r() * 2);
    }
  }
  // Dipte kir
  const grd = g.createLinearGradient(0, 110, 0, 160);
  grd.addColorStop(0, 'rgba(90,80,60,0)');
  grd.addColorStop(1, 'rgba(90,80,60,0.25)');
  g.fillStyle = grd;
  g.fillRect(0, 110, 256, 50);
  return tex(c);
}

/** Yeşil kaynaklı panel çit (alfa): 2.5 m panel × 1.2 m */
export function panelFenceTexture(): THREE.Texture {
  const W = 256;
  const H = 128;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#2f6a47';
  g.lineWidth = 1;
  // Dikey teller (5 cm)
  for (let x = 2; x < W; x += 6.4) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  // Yatay teller (20 cm) + V bükümler (panel çitin karakteristiği)
  for (let y = 4; y < H; y += 21) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.lineWidth = 2;
  for (const y of [H * 0.32, H * 0.72]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  const t = tex(c);
  t.premultiplyAlpha = false;
  return t;
}

/** Leylandi çalısı: sık, parlak yeşil, küçük pullu yaprak dokusu (1.5 m × 1 m) */
export function hedgeTexture(seed = 5): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#4c7a26';
  g.fillRect(0, 0, 256, 256);
  const r = rng(seed);
  for (let i = 0; i < 9000; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const l = 34 + r() * 38;
    const h = 74 + r() * 20;
    g.fillStyle = `hsl(${h},${45 + r() * 25}%,${l}%)`;
    g.beginPath();
    g.ellipse(x, y, 1.5 + r() * 2.5, 1 + r() * 1.5, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // Derin gölgeler
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(20,40,5,${0.12 + r() * 0.22})`;
    g.beginPath();
    g.arc(r() * 256, r() * 256, 2 + r() * 5, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** Kiremit (kırma çatı) — yatay 0.3 m sıra, 2 m tekrar */
/**
 * Kiremit (Marsilya tipi): doku 2 m (u) × 1.5 m (eğim, v) — 10 sütun × 6 sıra (~20 × 25 cm). `base`: ölçülmüş çatı
 * rengi (hava fotoğrafı / Street View); yaşlanma lekeleri ve sıra gölgeleriyle.
 */
export function roofTileTexture(base = '#9c4a2c'): THREE.Texture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(21);
  const bc = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  bc.getHSL(hsl, THREE.SRGBColorSpace);
  const H0 = hsl.h * 360;
  const S0 = hsl.s * 100;
  const L0 = hsl.l * 100;
  g.fillStyle = `hsl(${H0},${S0 * 0.8}%,${L0 * 0.55}%)`;
  g.fillRect(0, 0, S, S);
  const rows = 6;
  const cols = 10;
  const rh = S / rows;
  const cw = S / cols;
  for (let row = 0; row < rows; row++) {
    const y = row * rh;
    for (let col = -1; col <= cols; col++) {
      const x = col * cw + (row % 2) * (cw / 2);
      const l = L0 * (0.86 + r() * 0.26);
      g.fillStyle = `hsl(${H0 - 3 + r() * 6},${S0 * (0.85 + r() * 0.25)}%,${l}%)`;
      // Tek kiremit: üstte yuvarlak omuz, altta dalga
      g.beginPath();
      g.moveTo(x + 2, y + rh);
      g.lineTo(x + 2, y + rh * 0.25);
      g.quadraticCurveTo(x + cw / 2, y - rh * 0.05, x + cw - 2, y + rh * 0.25);
      g.lineTo(x + cw - 2, y + rh);
      g.closePath();
      g.fill();
      // Orta oluk gölgesi + tepe parlaması
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.fillRect(x + cw * 0.42, y + rh * 0.2, cw * 0.16, rh * 0.8);
      g.fillStyle = 'rgba(255,240,220,0.1)';
      g.fillRect(x + cw * 0.18, y + rh * 0.2, cw * 0.14, rh * 0.8);
    }
    // Sıra altı gölge (bindirme)
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, y + rh - 5, S, 5);
  }
  // Yaşlanma: koyu is/yosun ve açık solma lekeleri
  for (let i = 0; i < 90; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 10 + r() * 45;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.6;
    gr.addColorStop(0, dark ? 'rgba(40,35,25,0.18)' : 'rgba(230,215,195,0.12)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return tex(c);
}

/** Kilitli parke (kırmızı-gri, kaldırım): 1 m tekrar, şaşırtmalı tuğla dizisi */
export function paverTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = rng(33);
  g.fillStyle = '#6f6a64';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) {
    const y = row * 16;
    const off = row % 2 ? 16 : 0;
    for (let x = -16; x < 256; x += 32) {
      const red = r() < 0.55;
      const l = 50 + r() * 10;
      g.fillStyle = red ? `hsl(${8 + r() * 8},${24 + r() * 10}%,${l - 8}%)` : `hsl(30,${4 + r() * 5}%,${l}%)`;
      g.fillRect(x + off + 1, y + 1, 30, 14);
    }
  }
  return tex(c);
}

/** Metin tabelası (alfa): satırlar, renk, dış çizgi */
export function signTexture(
  lines: { text: string; size: number; color: string; stroke?: string; weight?: string; font?: string }[],
  w: number,
  h: number,
  bg: string | null,
): THREE.Texture {
  const [c, g] = canvas(w, h);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  } else g.clearRect(0, 0, w, h);
  const total = lines.reduce((a, l) => a + l.size * 1.12, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    y += l.size * 1.12;
    g.font = `${l.weight ?? '800'} ${l.size}px ${l.font ?? '"Arial Rounded MT Bold","Nunito","Arial Black",Arial,sans-serif'}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    if (l.stroke) {
      g.lineWidth = l.size * 0.14;
      g.strokeStyle = l.stroke;
      g.lineJoin = 'round';
      g.strokeText(l.text, w / 2, y - l.size * 0.18);
    }
    g.fillStyle = l.color;
    g.fillText(l.text, w / 2, y - l.size * 0.18);
  }
  return tex(c, false);
}

/** Özhan logosu: "özhan" turuncu-kırmızı, sarı dış çizgi, hafif 3B gölge (alfa) */
export function ozhanLogoTexture(): THREE.Texture {
  const W = 1024;
  const H = 300;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  g.font = '900 230px "Arial Rounded MT Bold","Nunito","Arial Black",Arial,sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  // Gölge (3B kabartma hissi)
  g.fillStyle = 'rgba(80,20,0,0.55)';
  g.fillText('özhan', W / 2 + 8, H / 2 + 10);
  g.lineWidth = 30;
  g.strokeStyle = '#ffd21c';
  g.strokeText('özhan', W / 2, H / 2);
  const grd = g.createLinearGradient(0, 40, 0, H - 40);
  grd.addColorStop(0, '#ff6a1a');
  grd.addColorStop(1, '#e02a12');
  g.fillStyle = grd;
  g.fillText('özhan', W / 2, H / 2);
  return tex(c, false);
}

/** Özhan vitrin afişi: sarı zemin, kırmızı yazı, sepet ikonu */
export function ozhanPosterTexture(kind: 'sahane' | 'ozel' | 'food' | 'plain'): THREE.Texture {
  const W = 256;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#f7c81b';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(0, 0, W, H * 0.4);
  const txt = (t: string, y: number, s: number, col = '#e2261c') => {
    g.font = `900 ${s}px Arial,sans-serif`;
    g.textAlign = 'center';
    g.lineWidth = s * 0.18;
    g.strokeStyle = '#ffffff';
    g.lineJoin = 'round';
    g.strokeText(t, W / 2, y);
    g.fillStyle = col;
    g.fillText(t, W / 2, y);
  };
  if (kind === 'sahane') {
    // sepet ikonu
    g.strokeStyle = '#e2261c';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(70, 110);
    g.lineTo(186, 110);
    g.lineTo(170, 160);
    g.lineTo(86, 160);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(96, 110);
    g.lineTo(120, 70);
    g.moveTo(160, 110);
    g.lineTo(136, 70);
    g.stroke();
    txt('Şahane', 200, 34);
    txt('İndirimler', 236, 30);
  } else if (kind === 'ozel') {
    txt('Özel', 90, 44);
    txt('Fiyatlar', 140, 40);
    txt('Özhan’da', 200, 30, '#a0180f');
  } else if (kind === 'food') {
    const col = ['#b5452a', '#d9a55a', '#f1e3c2', '#7a2c1b'];
    for (let i = 0; i < 6; i++) {
      g.fillStyle = col[i % 4];
      g.beginPath();
      g.arc(60 + (i % 3) * 68, 80 + Math.floor(i / 3) * 70, 30, 0, Math.PI * 2);
      g.fill();
    }
    txt('Birbirinden', 200, 26);
    txt('Lezzetler', 232, 26);
  } else {
    // ürün/fiyat şeritleri
    g.fillStyle = '#e2261c';
    for (let i = 0; i < 4; i++) g.fillRect(24 + i * 56, 60, 36, 10);
    g.fillStyle = '#2a6fd6';
    for (let i = 0; i < 4; i++) g.fillRect(24 + i * 56, 80, 36, 18);
  }
  return tex(c, false);
}

/** Özhan doğu cephesi büyük pankartı (Street View karesindeki metin) */
export function ozhanBannerTexture(): THREE.Texture {
  const W = 512;
  const H = 400;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#f5c21a';
  g.fillRect(0, 0, W, H);
  const txt = (t: string, y: number, s: number) => {
    g.font = `900 ${s}px Arial,sans-serif`;
    g.textAlign = 'left';
    g.lineWidth = s * 0.2;
    g.strokeStyle = '#ffffff';
    g.lineJoin = 'round';
    g.strokeText(t, 30, y);
    g.fillStyle = '#e3201b';
    g.fillText(t, 30, y);
  };
  txt('Birbirinden', 70, 50);
  txt('Avantajlı', 128, 50);
  txt('İndirim ve', 210, 50);
  txt('Kampanyalar', 268, 50);
  txt('ÖZHAN’da', 350, 58);
  // Et/ürün görselleri (sağda iki tabak)
  for (const [x, y] of [
    [420, 150],
    [440, 250],
  ]) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x, y, 58, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#9c3a22';
    g.beginPath();
    g.arc(x, y, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c96a44';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(x - 20 + i * 10, y - 10 + (i % 2) * 18, 14, 8, i, 0, Math.PI * 2);
      g.fill();
    }
  }
  return tex(c, false);
}

/** Mertkent giriş kapısı: siyah zemin üzerine altın süsleme (alfa değil) */
export function gateTexture(): THREE.Texture {
  // Siyah ferforje kapı (Street View kuzey kapı): altın çerçeve, ortada büyük gül madalyonu, dört çeyrekte
  // simetrik kıvrımlı dallar ve yapraklar, üst/alt panelde küçük madalyonlar. Kabartma hissi: koyu gölge + parlak kenar.
  const W = 512;
  const H = 788;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#141615';
  g.fillRect(0, 0, W, H);
  const gold = (lw: number, fn: () => void) => {
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = lw + 2;
    g.translate(1.5, 2);
    fn();
    g.stroke();
    g.restore();
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#e2c173');
    grd.addColorStop(0.5, '#a9843a');
    grd.addColorStop(1, '#d8b465');
    g.strokeStyle = grd;
    g.lineWidth = lw;
    fn();
    g.stroke();
    g.restore();
  };
  // Çerçeveler
  gold(6, () => {
    g.beginPath();
    g.rect(14, 14, W - 28, H - 28);
  });
  gold(3, () => {
    g.beginPath();
    g.rect(34, 34, W - 68, H - 68);
  });
  // Yatay bölmeler (üst ve alt panel)
  gold(3, () => {
    g.beginPath();
    g.moveTo(34, 170);
    g.lineTo(W - 34, 170);
    g.moveTo(34, H - 170);
    g.lineTo(W - 34, H - 170);
  });
  const cx = W / 2;
  const cy = H / 2;
  // Kıvrımlı dallar: bir çeyrek çizilip 4 yöne aynalanır
  const quarter = () => {
    g.beginPath();
    g.moveTo(cx + 70, cy);
    g.bezierCurveTo(cx + 150, cy - 10, cx + 190, cy - 80, cx + 150, cy - 130);
    g.bezierCurveTo(cx + 120, cy - 165, cx + 80, cy - 140, cx + 100, cy - 115);
    g.moveTo(cx, cy - 70);
    g.bezierCurveTo(cx + 10, cy - 130, cx + 70, cy - 170, cx + 130, cy - 185);
    g.bezierCurveTo(cx + 180, cy - 195, cx + 200, cy - 150, cx + 170, cy - 150);
    g.moveTo(cx + 50, cy - 50);
    g.bezierCurveTo(cx + 95, cy - 80, cx + 95, cy - 110, cx + 70, cy - 120);
  };
  const leaves = () => {
    g.beginPath();
    for (const [x, y, a] of [
      [150, -60, 0.6],
      [115, -150, -0.4],
      [60, -150, 0.9],
      [175, -110, 1.2],
      [95, -95, -0.8],
    ]) {
      g.save();
      g.translate(cx + x, cy + y);
      g.rotate(a);
      g.moveTo(0, 0);
      g.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2);
      g.restore();
    }
  };
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    g.save();
    g.translate(cx, cy);
    g.scale(sx, sy);
    g.translate(-cx, -cy);
    gold(4, quarter);
    gold(2.5, leaves);
    g.restore();
  }
  // Orta madalyon: halkalar + 16 yaprak + göbek
  gold(5, () => {
    g.beginPath();
    g.arc(cx, cy, 66, 0, Math.PI * 2);
  });
  gold(2.5, () => {
    g.beginPath();
    g.arc(cx, cy, 54, 0, Math.PI * 2);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      g.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18);
      g.quadraticCurveTo(
        cx + Math.cos(a + 0.25) * 48,
        cy + Math.sin(a + 0.25) * 48,
        cx + Math.cos(a) * 52,
        cy + Math.sin(a) * 52,
      );
      g.quadraticCurveTo(
        cx + Math.cos(a - 0.25) * 48,
        cy + Math.sin(a - 0.25) * 48,
        cx + Math.cos(a) * 18,
        cy + Math.sin(a) * 18,
      );
    }
  });
  gold(4, () => {
    g.beginPath();
    g.arc(cx, cy, 14, 0, Math.PI * 2);
  });
  // Üst/alt panel madalyonları
  for (const y of [100, H - 100]) {
    gold(3, () => {
      g.beginPath();
      g.arc(cx, y, 36, 0, Math.PI * 2);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * 10, y + Math.sin(a) * 10);
        g.lineTo(cx + Math.cos(a) * 30, y + Math.sin(a) * 30);
      }
    });
    gold(2.5, () => {
      g.beginPath();
      g.moveTo(60, y);
      g.bezierCurveTo(120, y - 40, 170, y + 40, cx - 44, y);
      g.moveTo(W - 60, y);
      g.bezierCurveTo(W - 120, y - 40, W - 170, y + 40, cx + 44, y);
    });
  }
  return tex(c, false);
}

/** Özhan panel cephesi: beyaz, yatay koyu derz (0.5 m) — 2 m × 2 m tekrar */
export function sidingTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#eeeeea';
  g.fillRect(0, 0, 256, 256);
  const r = rng(51);
  for (let y = 0; y < 256; y += 64) {
    g.fillStyle = '#3d3f40';
    g.fillRect(0, y + 61, 256, 3);
    const grd = g.createLinearGradient(0, y, 0, y + 61);
    grd.addColorStop(0, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0.05)');
    g.fillStyle = grd;
    g.fillRect(0, y, 256, 61);
  }
  for (let i = 0; i < 800; i++) {
    g.fillStyle = `rgba(80,80,80,${r() * 0.05})`;
    g.fillRect(r() * 256, r() * 256, 2 + r() * 8, 1);
  }
  return tex(c);
}

/** Renkli üçgen flama dizisi (alfa), 2 m tekrar */
export function pennantTexture(): THREE.Texture {
  const [c, g] = canvas(256, 64);
  g.clearRect(0, 0, 256, 64);
  g.strokeStyle = '#333';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 6);
  g.quadraticCurveTo(128, 14, 256, 6);
  g.stroke();
  const cols = ['#e53935', '#fdd835', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa'];
  for (let i = 0; i < 8; i++) {
    const x = i * 32 + 4;
    const y = 6 + Math.sin((i / 8) * Math.PI) * 7;
    g.fillStyle = cols[i % cols.length];
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 24, y);
    g.lineTo(x + 12, y + 44);
    g.closePath();
    g.fill();
  }
  return tex(c);
}

/** Gri yatay ızgara (çöp muhafazası) */
export function slatTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#6e7274';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 10) {
    g.fillStyle = '#d4d7d8';
    g.fillRect(0, y, 128, 7);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(0, y, 128, 1);
  }
  g.fillStyle = '#bfc3c4';
  g.fillRect(0, 0, 4, 128);
  g.fillRect(124, 0, 4, 128);
  return tex(c);
}

/** Kilit taşı / parke (1 m karo): 20×10 cm dikdörtgen taşlar, şaşırtmalı sıra, derz ve ton farkı */
export function cobbleTexture(base: string, alt: string, seed = 11): THREE.Texture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(seed);
  g.fillStyle = '#6d6a64';
  g.fillRect(0, 0, S, S);
  const rows = 10;
  const rh = S / rows;
  const bw = S / 5;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * (bw / 2);
    for (let k = -1; k < 6; k++) {
      const x = k * bw + off;
      g.fillStyle = r() < 0.3 ? alt : base;
      g.fillRect(x + 2, row * rh + 2, bw - 4, rh - 4);
      // Taş yüzü hafif ton oynaması
      g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.06})`;
      g.fillRect(x + 2, row * rh + 2, bw - 4, rh - 4);
      // Kenar pahı
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x + 2, row * rh + rh - 5, bw - 4, 3);
    }
  }
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  return tex(c);
}

/** Travertin güverte taşı (1.2 m'lik karo içinde 60×40 cm plakalar) */
export function travertineTexture(): THREE.Texture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(31);
  g.fillStyle = '#bdb4a3';
  g.fillRect(0, 0, S, S);
  const cols = 2;
  const rows = 3;
  const w = S / cols;
  const h = S / rows;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const l = 82 + r() * 6;
      g.fillStyle = `hsl(${36 + r() * 6},${22 + r() * 8}%,${l}%)`;
      g.fillRect(i * w + 2, j * h + 2, w - 4, h - 4);
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(150,130,100,${0.05 + r() * 0.08})`;
        g.fillRect(i * w + r() * w, j * h + r() * h, 3 + r() * 20, 1 + r() * 2);
      }
    }
  const t = tex(c);
  t.repeat.set(1 / 1.2, 1 / 1.2);
  return t;
}

/** Havuz mozaiği (2.5 cm karolar, 1 m karo) */
export function mosaicTexture(a: string, b: string): THREE.Texture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(a.length * 13 + 7);
  g.fillStyle = '#e8eef0';
  g.fillRect(0, 0, S, S);
  const n = 40;
  const s = S / n;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      g.fillStyle = r() < 0.35 ? b : a;
      g.fillRect(i * s + 1, j * s + 1, s - 2, s - 2);
    }
  return tex(c);
}

/** Su yüzeyi dalga normali (döşenebilir, tam sayılı frekanslı sinüs toplamı) */
export function rippleNormalTexture(): THREE.Texture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const r = rng(99);
  const waves = Array.from({ length: 9 }, () => ({
    kx: Math.round((r() - 0.5) * 14),
    ky: Math.round((r() - 0.5) * 14),
    a: 0.01 + r() * 0.02,
    p: r() * Math.PI * 2,
  })).filter((w) => w.kx || w.ky);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const ph = 2 * Math.PI * ((w.kx * x) / S + (w.ky * y) / S) + w.p;
        const cph = Math.cos(ph) * w.a * 2 * Math.PI;
        dx += cph * w.kx;
        dy += cph * w.ky;
      }
      const l = Math.hypot(dx, dy, 1);
      const o = (y * S + x) * 4;
      img.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return tex(c, true, false);
}

/** Klinker tuğla (kiremit kırmızısı, 25×6.5 cm, açık derz), 1 m karo */
export function brickTexture(): THREE.Texture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(41);
  g.fillStyle = '#cbbfae';
  g.fillRect(0, 0, S, S);
  const rows = 14;
  const rh = S / rows;
  const bw = S / 4;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * (bw / 2);
    for (let k = -1; k < 5; k++) {
      const l = 30 + r() * 10;
      g.fillStyle = `hsl(${8 + r() * 8},${45 + r() * 15}%,${l}%)`;
      g.fillRect(k * bw + off + 2, row * rh + 2, bw - 4, rh - 4);
      g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
      g.fillRect(k * bw + off + 2, row * rh + rh - 6, bw - 4, 4);
    }
  }
  return tex(c);
}

/** Dikey demir parmaklık (alfa): 12 cm'de bir 2 cm çubuk */
export function ironBarsTexture(): THREE.Texture {
  const [c, g] = canvas(32, 8);
  g.clearRect(0, 0, 32, 8);
  g.fillStyle = '#1b1c1d';
  g.fillRect(12, 0, 7, 8);
  const t = tex(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Ferforje süs bandı (alfa): 0.5 m modülde karşılıklı C kıvrımları + dikey çubuk (araç kapısı alt bandı) */
export function ornBandTexture(): THREE.Texture {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = '#1b1c1d';
  g.lineCap = 'round';
  g.lineWidth = 5;
  // Orta dikey çubuk ve kenar çubukları
  for (const x of [2, S / 2, S - 2]) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, S);
    g.stroke();
  }
  // Dört C kıvrımı (merkez çubuğa simetrik)
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      g.beginPath();
      const cx = S / 2 + sx * 30;
      const cy = S / 2 + sy * 26;
      g.arc(cx, cy, 20, 0, Math.PI * 2 * 0.8);
      g.stroke();
      g.beginPath();
      g.arc(cx + sx * 6, cy + sy * 4, 7, 0, Math.PI * 2);
      g.stroke();
    }
  const t = tex(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Budanmış leylandi çit yüzü (2 m × 1 m, tekrarlı): Street View'daki açık sarımsı yeşil, ince pullu dal uçları,
 * koyu boşluklar ve kabarık/çukur bölgeler. Renkler 42 blok güney çit karesinden ölçüldü (aydınlık ~#6c8743).
 */
export function leylandiiTexture(): THREE.Texture {
  const W = 1024;
  const Hh = 512;
  const [c, g] = canvas(W, Hh);
  const r = rng(71);
  g.fillStyle = '#566b40';
  g.fillRect(0, 0, W, Hh);
  const wrap = (x: number, y: number, m: number, fn: (X: number, Y: number) => void) => {
    for (const dx of [-W, 0, W])
      for (const dy of [-Hh, 0, Hh]) {
        const X = x + dx;
        const Y = y + dy;
        if (X > -m && X < W + m && Y > -m && Y < Hh + m) fn(X, Y);
      }
  };
  // Kabarık (açık) ve çukur (koyu) bölgeler
  for (let i = 0; i < 140; i++) {
    const x = r() * W;
    const y = r() * Hh;
    const rad = 25 + r() * 70;
    const dark = r() < 0.45;
    wrap(x, y, rad, (X, Y) => {
      const gr = g.createRadialGradient(X, Y, 0, X, Y, rad);
      gr.addColorStop(0, dark ? 'rgba(28,40,14,0.5)' : 'rgba(150,176,78,0.32)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(X - rad, Y - rad, 2 * rad, 2 * rad);
    });
  }
  // Pullu dal uçları (çoğu yukarı-yana), yan filizlerle
  const pal = ['#84a05a', '#92ac64', '#9fb86e', '#adc379', '#bacd86', '#76914f', '#c4d491', '#8da760'];
  g.lineCap = 'round';
  for (let i = 0; i < 11000; i++) {
    const x = r() * W;
    const y = r() * Hh;
    const ang = -Math.PI / 2 + (r() - 0.5) * 2.4;
    const len = 7 + r() * 16;
    const col = pal[Math.floor(r() * pal.length)];
    const lw = 2 + r() * 2.2;
    const sides = [0, 1, 2].map(() => [0.7 + r() * 0.5, 0.7 + r() * 0.5]);
    wrap(x, y, 30, (X, Y) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      const ex = X + Math.cos(ang) * len;
      const ey = Y + Math.sin(ang) * len;
      g.beginPath();
      g.moveTo(X, Y);
      g.lineTo(ex, ey);
      g.stroke();
      g.lineWidth = lw * 0.65;
      for (let k = 0; k < 3; k++) {
        const t = (k + 1) / 4;
        const px = X + (ex - X) * t;
        const py = Y + (ey - Y) * t;
        const l2 = len * 0.38 * (1 - t * 0.5);
        for (const [sd, sa] of [
          [-1, sides[k][0]],
          [1, sides[k][1]],
        ]) {
          const a2 = ang + sd * sa;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + Math.cos(a2) * l2, py + Math.sin(a2) * l2);
          g.stroke();
        }
      }
    });
  }
  // Güneşte parlayan taze uçlar ve derin boşluklar
  for (let i = 0; i < 6000; i++) {
    const x = r() * W;
    const y = r() * Hh;
    const s = 1.5 + r() * 2.5;
    const col = r() < 0.5 ? '#d2e08e' : '#c0d27a';
    wrap(x, y, 4, (X, Y) => {
      g.fillStyle = col;
      g.fillRect(X, Y, s, s);
    });
  }
  for (let i = 0; i < 3500; i++) {
    const x = r() * W;
    const y = r() * Hh;
    const s = 2 + r() * 3;
    wrap(x, y, 6, (X, Y) => {
      g.fillStyle = 'rgba(22,32,12,0.55)';
      g.fillRect(X, Y, s, s * 1.4);
    });
  }
  return tex(c);
}

/** Tuğla kırmızısı kompozit panel (kulübe kaplaması) */
export function panelTexture(base: string): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 2, 256);
  for (let y = 0; y < 256; y += 128) g.fillRect(0, y, 256, 2);
  return tex(c);
}

/** Görme engelli kılavuz şeridi (sarı, kabartma çizgili), 30 cm genişlik → doku v yönünde */
export function tactileTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#d9b62c';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 4; x < 64; x += 16) g.fillRect(x, 0, 5, 64);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = 2; x < 64; x += 16) g.fillRect(x, 0, 2, 64);
  return tex(c);
}

/** Duvara yapıştırılmış harf tabela (şeffaf zemin): satırlar, renk, en/boy oranı (w/h) */
export function letterSignTexture(lines: string[], color: string, aspect = 3): THREE.Texture {
  const W = 1024;
  const Hh = Math.round(W / aspect);
  const [c, g] = canvas(W, Hh);
  g.clearRect(0, 0, W, Hh);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((t, i) => {
    const size = (Hh / n) * (i === 0 ? 0.78 : 0.55);
    g.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillText(t, W / 2 + 4, (Hh / n) * (i + 0.5) + 4);
    g.fillStyle = color;
    g.fillText(t, W / 2, (Hh / n) * (i + 0.5));
  });
  const t = tex(c, false);
  return t;
}

/** Trafik levhası (şeffaf zemin): 'curve' = tehlikeli viraj (sola-sağa), 'limit30' = azami hız 30 */
export function roadSignTexture(
  kind: 'curve' | 'limit30' | 'parking' | 'bike' | 'noentry' | 'noleft',
): THREE.Texture {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  if (kind === 'curve') {
    g.fillStyle = '#c8102e';
    g.beginPath();
    g.moveTo(S / 2, 10);
    g.lineTo(S - 8, S - 22);
    g.lineTo(8, S - 22);
    g.closePath();
    g.fill();
    g.fillStyle = '#f7f7f5';
    g.beginPath();
    g.moveTo(S / 2, 52);
    g.lineTo(S - 44, S - 42);
    g.lineTo(44, S - 42);
    g.closePath();
    g.fill();
    // Çift viraj simgesi
    g.strokeStyle = '#111';
    g.lineWidth = 11;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(S / 2 + 8, S - 58);
    g.bezierCurveTo(S / 2 + 40, S - 95, S / 2 - 40, S - 110, S / 2 - 6, S - 140);
    g.bezierCurveTo(S / 2 + 20, S - 162, S / 2 + 18, S - 170, S / 2 + 6, S - 176);
    g.stroke();
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(S / 2 - 12, S - 172);
    g.lineTo(S / 2 + 8, S - 196);
    g.lineTo(S / 2 + 22, S - 168);
    g.fill();
  } else if (kind === 'parking') {
    g.fillStyle = '#1f4ea8';
    g.fillRect(10, 10, S - 20, S - 20);
    g.strokeStyle = '#f7f7f5';
    g.lineWidth = 8;
    g.strokeRect(22, 22, S - 44, S - 44);
    g.fillStyle = '#f7f7f5';
    g.font = 'bold 170px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('P', S / 2, S / 2 + 10);
  } else if (kind === 'bike') {
    g.fillStyle = '#1f5fc0';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#f7f7f5';
    g.lineWidth = 10;
    for (const x of [S / 2 - 50, S / 2 + 50]) {
      g.beginPath();
      g.arc(x, S / 2 + 30, 34, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(S / 2 - 50, S / 2 + 30);
    g.lineTo(S / 2 - 10, S / 2 - 30);
    g.lineTo(S / 2 + 35, S / 2 - 30);
    g.lineTo(S / 2 + 50, S / 2 + 30);
    g.moveTo(S / 2 - 10, S / 2 - 30);
    g.lineTo(S / 2 + 5, S / 2 + 30);
    g.stroke();
  } else if (kind === 'noleft') {
    // Sola dönülmez: beyaz zemin, kırmızı çember, siyah sola kıvrık ok, kırmızı çapraz çizgi
    g.fillStyle = '#c8102e';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f7f7f5';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 34, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#111';
    g.lineWidth = 20;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(S / 2 + 20, S - 60);
    g.lineTo(S / 2 + 20, S / 2);
    g.quadraticCurveTo(S / 2 + 20, S / 2 - 30, S / 2 - 20, S / 2 - 30);
    g.lineTo(S / 2 - 40, S / 2 - 30);
    g.stroke();
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(S / 2 - 80, S / 2 - 30);
    g.lineTo(S / 2 - 38, S / 2 - 62);
    g.lineTo(S / 2 - 38, S / 2 + 2);
    g.fill();
    g.strokeStyle = '#c8102e';
    g.lineWidth = 22;
    g.beginPath();
    g.moveTo(S * 0.22, S * 0.22);
    g.lineTo(S * 0.78, S * 0.78);
    g.stroke();
  } else if (kind === 'noentry') {
    g.fillStyle = '#c8102e';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f7f7f5';
    g.fillRect(40, S / 2 - 22, S - 80, 44);
  } else {
    g.fillStyle = '#c8102e';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f7f7f5';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 36, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.font = 'bold 118px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('30', S / 2, S / 2 + 6);
  }
  return tex(c, false);
}

/** 3D panel tel çit: 20 cm × 20 cm karo, dikey teller 5 cm, yatay tel 20 cm (koyu yeşil, alfa) */
export function meshFenceTexture(): THREE.Texture {
  const N = 128;
  const [c, g] = canvas(N, N);
  g.clearRect(0, 0, N, N);
  g.strokeStyle = '#1f3a2a';
  g.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    const x = (k + 0.5) * (N / 4);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, N);
    g.stroke();
  }
  g.lineWidth = 3.5;
  g.beginPath();
  g.moveTo(0, N * 0.5);
  g.lineTo(N, N * 0.5);
  g.stroke();
  const t = tex(c);
  t.premultiplyAlpha = false;
  return t;
}
