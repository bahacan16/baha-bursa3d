#!/usr/bin/env node
// Street View yakın plan dik görüntülerinden (docs/survey/perim200, PX_PER_M=200) döşenebilir dokular:
//  - mk-foliage.jpg : yapay çit paneli (yaprak), yatayda çapraz geçişle, düşeyde aynalanarak döşenebilir
//  - mk-wave.jpg    : beyaz dalga desenli prekast duvar paneli (bir modül, iki derz arası), + mk-wave-n.png normal
//  - mk-hedge.jpg   : gerçek leylandi yüzü
// Kaynak üretimi: PX_PER_M=200 PERIM_OUT=perim200 PANOS=XRdO,Y11W,1Jme,4RYu,G8RU
//                 node --experimental-strip-types scripts/sv-ortho-perimeter.mjs
// Çıktı: public/textures/mk/
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'docs', 'survey', 'perim200');
const out = join(root, 'public', 'textures', 'mk');
const PX = 200;
/** Dik görüntüde (u, y) metre → piksel (sv-ortho-perimeter: u ∈ [−12, 12], y ∈ [−0.5, 3.5]) */
const col = (u) => Math.round((u + 12) * PX);
const row = (y) => Math.round((3.5 - y) * PX);

async function crop(file, u0, u1, y0, y1) {
  const { data, info } = await sharp(join(src, file))
    .extract({ left: col(u0), top: row(y1), width: col(u1) - col(u0), height: row(y0) - row(y1) })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Yatay döşenebilirlik: son `blend` pikseli başa çapraz geçişle karıştır, genişliği kısalt */
function tileX(img, blend) {
  const { data, w, h } = img;
  const W = w - blend;
  const o = Buffer.alloc(W * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) {
        let v = data[(y * w + x) * 3 + c];
        if (x < blend) {
          const t = x / blend;
          const s = t * t * (3 - 2 * t);
          v = v * s + data[(y * w + (W + x)) * 3 + c] * (1 - s);
        }
        o[(y * W + x) * 3 + c] = v;
      }
    }
  return { data: o, w: W, h };
}

/** Düşey aynalama (üst-alt birleşimi dikişsiz) */
function mirrorY(img) {
  const { data, w, h } = img;
  const o = Buffer.alloc(w * h * 2 * 3);
  data.copy(o, 0);
  for (let y = 0; y < h; y++) data.copy(o, (h + y) * w * 3, (h - 1 - y) * w * 3, (h - y) * w * 3);
  return { data: o, w, h: h * 2 };
}

/** Parlaklık dengeleme: düşük frekanslı aydınlatmayı böl (gölge/güneş lekesi kalmasın) */
function flatten(img, radius, target = 0) {
  const { data, w, h } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2]) / 3 + 1;
  // Kutu bulanıklık (ayrılabilir, sarmal)
  const tmp = new Float32Array(w * h);
  const blur = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += lum[y * w + ((x + k + w) % w)];
      tmp[y * w + x] = s / (2 * radius + 1);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[((y + k + h) % h) * w + x];
      blur[y * w + x] = s / (2 * radius + 1);
    }
  let mean = 0;
  for (let i = 0; i < w * h; i++) mean += blur[i];
  mean /= w * h;
  const goal = target || mean;
  const o = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const f = goal / blur[i];
    for (let c = 0; c < 3; c++) o[i * 3 + c] = Math.max(0, Math.min(255, data[i * 3 + c] * f));
  }
  return { data: o, w, h };
}

async function save(img, name, W, H) {
  await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 3 } })
    .resize(W, H, { fit: 'fill' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(join(out, name));
  console.log('✓', name, `${img.w}×${img.h} → ${W}×${H}`);
}

/** Parlaklıktan normal haritası (dalga kabartması) */
async function normalFromLum(img, name, strength, W, H) {
  const { data, w, h } = img;
  const L = (x, y) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 3;
    return (data[i] + data[i + 1] + data[i + 2]) / 765;
  };
  const o = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (L(x + 1, y) - L(x - 1, y)) * strength;
      const dy = (L(x, y + 1) - L(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * w + x) * 3;
      o[i] = (nx * 0.5 + 0.5) * 255;
      o[i + 1] = (ny * 0.5 + 0.5) * 255;
      o[i + 2] = (nz * 0.5 + 0.5) * 255;
    }
  await sharp(o, { raw: { width: w, height: h, channels: 3 } })
    .resize(W, H, { fit: 'fill' })
    .png()
    .toFile(join(out, name));
  console.log('✓', name);
}

async function main() {
  await mkdir(out, { recursive: true });
  // Yapay çit paneli: XRdO, u −3.55…0.45 (4 m), y 1.3…2.05
  {
    let img = await crop('XRdOu03s_fence.jpg', -1.7, 0.45, 1.42, 2.0);
    img = flatten(img, 40);
    img = tileX(img, 60);
    img = mirrorY(img);
    await save(img, 'mk-foliage.jpg', 1024, 512);
  }
  // Dalga duvar modülü: XRdO, iki derz arası (u −2.815…−1.09), y 0.61…1.075 (görünen)
  {
    let img = await crop('XRdOu03s_fence.jpg', -2.83, -1.08, 0.7, 1.08);
    img = flatten(img, 60);
    await save(img, 'mk-wave.jpg', 512, 160);
    await normalFromLum(img, 'mk-wave-n.png', 5, 512, 160);
  }
  // Gerçek leylandi: Y11W, u −6…2, y 1.3…2.2
  {
    let img = await crop('Y11WZ-ul_fence.jpg', -6.2, -2.3, 1.3, 2.2);
    img = flatten(img, 50, 128);
    img = tileX(img, 80);
    img = mirrorY(img);
    await save(img, 'mk-hedge.jpg', 1024, 512);
  }
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
