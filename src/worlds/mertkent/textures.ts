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
export function plasterTexture(base: string, seed = 1): THREE.Texture {
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
  return tex(c);
}

/**
 * Pencere (bir kanat seti): beyaz PVC çerçeve, cam, yarı inik gri jaluzi / perde.
 * variant: jaluzi yüksekliği ve perde rengi farkı için.
 */
export function windowTexture(variant: number): THREE.Texture {
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
  g.fillStyle = '#f4f4f1';
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
export function roofTileTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const r = rng(21);
  g.fillStyle = '#9c4a2c';
  g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) {
    const y = row * 16;
    for (let col = 0; col < 12; col++) {
      const x = col * 22 + (row % 2) * 11;
      const l = 30 + r() * 12;
      g.fillStyle = `hsl(${14 + r() * 8},${48 + r() * 12}%,${l}%)`;
      g.beginPath();
      g.ellipse(x + 11, y + 8, 11, 9, 0, 0, Math.PI);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, y + 14, 256, 2);
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
  // Siyah ferforje kapı: ince altın kıvrımlı (dantel) motif tekrarı
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#181a19';
  g.fillRect(0, 0, 256, 512);
  g.strokeStyle = '#a8843f';
  g.lineWidth = 1.2;
  g.strokeRect(10, 10, 236, 492);
  for (let y = 24; y < 500; y += 34)
    for (let x = 24; x < 240; x += 34) {
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        g.moveTo(x, y);
        g.quadraticCurveTo(
          x + Math.cos(a + 0.8) * 16,
          y + Math.sin(a + 0.8) * 16,
          x + Math.cos(a) * 15,
          y + Math.sin(a) * 15,
        );
      }
      g.stroke();
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.stroke();
    }
  // Ortada büyük gül motifi
  g.lineWidth = 1.6;
  for (let rr = 18; rr <= 54; rr += 12) {
    g.beginPath();
    g.arc(128, 256, rr, 0, Math.PI * 2);
    g.stroke();
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
