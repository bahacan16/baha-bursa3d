#!/usr/bin/env node
/**
 * Asfalt dokusundaki (Poly Haven asphalt_02) çatlakları temizler → public/textures/asphalt-clean/.
 * KARAR (kullanıcı kuralı §0.5): asfalt hasarı yalnızca Street View'da görülen yerde çizilir; dokunun her 3 m'de
 * tekrarlanan hazır çatlakları uydurma hasar sayılır. Yöntem: hafif bulanık parlaklık yerel ortalamadan (σ 14 px)
 * T kadar koyu olan pikseller aday; ≥ MINC piksellik bağlı bileşenler (uzun çatlaklar, tekil taneler değil) maske
 * (+GROW genişletme; ölçüm: fark > 30 dokunun ≈%0.9'u). Maskeli pikseller
 * dokunun maskesiz, kaydırılmış bir kopyasından doldurulur (tane dokusu korunur); normal ve pürüzlülük haritalarına
 * aynı maske uygulanır. Kaynak dosyalar fetch-textures ile yenilenirse bu betik yeniden çalıştırılır.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public', 'textures', 'asphalt');
const out = join(root, 'public', 'textures', 'asphalt-clean');
const T = Number(process.env.T ?? 30);
const GROW = Number(process.env.GROW ?? 2);
const MINC = Number(process.env.MINC ?? 60);

const raw = async (f) => sharp(join(src, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });

/** Sarmalanan (döşenebilir) ayrık max/min filtresi, kare pencere yarıçapı r */
function filter1(a, W, H, r, isMax, horiz) {
  const o = new Float32Array(a.length);
  const n = horiz ? W : H;
  const m = horiz ? H : W;
  const line = new Float32Array(n);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) line[i] = horiz ? a[j * W + i] : a[i * W + j];
    for (let i = 0; i < n; i++) {
      let v = line[i];
      for (let k = -r; k <= r; k++) {
        const q = line[(i + k + n) % n];
        if (isMax ? q > v : q < v) v = q;
      }
      if (horiz) o[j * W + i] = v;
      else o[i * W + j] = v;
    }
  }
  return o;
}
const morph = (a, W, H, r, isMax) => filter1(filter1(a, W, H, r, isMax, true), W, H, r, isMax, false);

async function main() {
  await mkdir(out, { recursive: true });
  const g = sharp(join(src, 'diffuse.jpg')).greyscale();
  const { data: A, info } = await g.clone().blur(1.2).raw().toBuffer({ resolveWithObject: true });
  const { data: M } = await g.clone().blur(14).raw().toBuffer({ resolveWithObject: true });
  // Geniş (≈2 cm+) bitümlü ana çatlak kendi koyuluğuyla σ14 ortalamasını düşürür → ikinci, geniş ölçek (σ40)
  const { data: M2 } = await g.clone().blur(40).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  let mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (M[p] - A[p] > T || M2[p] - A[p] > T) mask[p] = 1;
  // Maskeyi genişlet (çatlak kenarındaki koyu hale)
  const mf = morph(Float32Array.from(mask), W, H, GROW, true);
  mask = Uint8Array.from(mf, (v) => (v > 0 ? 1 : 0));
  // Küçük tekil noktaları (asfalt tanesi) maske dışı bırak: bağlı bileşen boyutu < MINC px olanlar
  const lab = new Int32Array(W * H).fill(-1);
  const keep = new Uint8Array(W * H);
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const comp = [];
    stack.push(s);
    lab[s] = s;
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      const x = p % W;
      const y = (p / W) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const q = ((y + dy + H) % H) * W + ((x + dx + W) % W);
        if (mask[q] && lab[q] < 0) {
          lab[q] = s;
          stack.push(q);
        }
      }
    }
    if (comp.length >= MINC) for (const p of comp) keep[p] = 1;
  }
  let nMask = 0;
  for (let p = 0; p < W * H; p++) nMask += keep[p];
  // Doldurma kaynağı: maskesiz ilk kaydırılmış konum
  const offs = [];
  for (let k = 1; k < 40; k++) offs.push([(k * 197) % W, (k * 331) % H]);
  const srcOf = new Int32Array(W * H).fill(-1);
  for (let p = 0; p < W * H; p++) {
    if (!keep[p]) continue;
    const x = p % W;
    const y = (p / W) | 0;
    for (const [ox, oy] of offs) {
      const q = ((y + oy) % H) * W + ((x + ox) % W);
      if (!keep[q]) {
        srcOf[p] = q;
        break;
      }
    }
  }
  const fill = async (name, ch) => {
    const im = await raw(name);
    const buf = Buffer.from(im.data);
    const c = im.info.channels;
    for (let p = 0; p < W * H; p++)
      if (srcOf[p] >= 0) for (let k = 0; k < c; k++) buf[p * c + k] = im.data[srcOf[p] * c + k];
    await sharp(buf, { raw: { width: W, height: H, channels: c } })
      .jpeg({ quality: 90 })
      .toFile(join(out, name));
    void ch;
  };
  await fill('diffuse.jpg');
  await fill('normal.jpg');
  await fill('rough.jpg');
  console.log(`✓ asfalt temizlendi: ${((nMask / (W * H)) * 100).toFixed(2)}% piksel dolduruldu → ${out}`);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
