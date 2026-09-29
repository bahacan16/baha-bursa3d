#!/usr/bin/env node
// Site içi ölçümü için yüksek çözünürlüklü hava fotoğrafları (Street View site içine girmiyor: havuz, yollar,
// bahçe düzeni buradan okunur). Birkaç kaynağı dener, her birini yerel ENU ızgarasına yeniden örnekler.
// Kişisel/hobi kullanım; yalnızca ölçüm referansı (oyunda yayınlanmaz). Geliştirme ortamı bu sunuculara
// erişemediği için Actions'ta çalışır.
// Çıktı: streetview-src/aerial/<kaynak>-z<Z>.jpg + index.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { unproject } from '../src/worlds/osm/simplify.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// AERIAL_DIR: çıktı klasörü (streetview-src/<dir>); birden çok pafta için ayrı klasörler (aerial, aerial-e, …)
const outDir = join(root, 'streetview-src', process.env.AERIAL_DIR || 'aerial');
/** Mertkent 2 + Salusvizyon + Özhan + çevre sokaklar (yerel metre) */
const CX = Number(process.env.AERIAL_CX ?? -40);
const CZ = Number(process.env.AERIAL_CZ ?? -90);
const HALF = Number(process.env.AERIAL_HALF ?? 130);
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function quadkey(x, y, z) {
  let q = '';
  for (let i = z; i > 0; i--) {
    let d = 0;
    const m = 1 << (i - 1);
    if (x & m) d += 1;
    if (y & m) d += 2;
    q += d;
  }
  return q;
}

const ONLY_SRC = process.env.AERIAL_SOURCES ? process.env.AERIAL_SOURCES.split(',') : null;
const SOURCES_ALL = [
  {
    name: 'google',
    zooms: [21, 20, 19],
    url: (z, x, y) => `https://mt${(x + y) % 4}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`,
  },
  {
    name: 'bing',
    zooms: [20, 19],
    url: (z, x, y) =>
      `https://ecn.t${(x + y) % 4}.tiles.virtualearth.net/tiles/a${quadkey(x, y, z)}.jpeg?g=14500`,
  },
  {
    name: 'esri',
    zooms: [20, 19],
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  },
];

const SOURCES = SOURCES_ALL.filter((s) => !ONLY_SRC || ONLY_SRC.includes(s.name));

const mercX = (lon, Z) => ((lon + 180) / 360) * 256 * 2 ** Z;
const mercY = (lat, Z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** Z;
};

async function fetchTile(url, tries = 3) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const { data, info } = await sharp(buf)
        .removeAlpha()
        .resize(256, 256)
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.width !== 256) throw new Error('boyut');
      return data;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 800 * (a + 1)));
    }
  }
  throw last;
}

/** Tek renkli / boş "veri yok" karosu mu? */
function blank(data) {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < data.length; i += 37) {
    s += data[i];
    s2 += data[i] * data[i];
  }
  const n = Math.ceil(data.length / 37);
  const v = s2 / n - (s / n) ** 2;
  return v < 20;
}

async function grab(src, Z, center) {
  const nw = unproject(CX - HALF, CZ - HALF, center);
  const se = unproject(CX + HALF, CZ + HALF, center);
  const tx0 = Math.floor(mercX(nw.lon, Z) / 256);
  const tx1 = Math.floor(mercX(se.lon, Z) / 256);
  const ty0 = Math.floor(mercY(nw.lat, Z) / 256);
  const ty1 = Math.floor(mercY(se.lat, Z) / 256);
  const tw = tx1 - tx0 + 1;
  const th = ty1 - ty0 + 1;
  // Önce ortadaki bir karo ile kaynağı dene
  const probe = await fetchTile(src.url(Z, (tx0 + tx1) >> 1, (ty0 + ty1) >> 1));
  if (blank(probe)) throw new Error('boş karo (bu yakınlıkta veri yok)');
  console.log(`${src.name} z${Z}: ${tw}×${th} = ${tw * th} karo`);
  const W = tw * 256;
  const Hh = th * 256;
  const mosaic = Buffer.alloc(W * Hh * 3);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0;
  let fails;
  let blanks = 0;
  const failed = [];
  const worker = async (tries) => {
    for (;;) {
      const j = jobs.shift();
      if (!j) return;
      const [tx, ty] = j;
      let data;
      try {
        data = await fetchTile(src.url(Z, tx, ty), tries);
      } catch {
        failed.push(j);
        continue;
      }
      if (blank(data)) blanks++;
      const ox = (tx - tx0) * 256;
      const oy = (ty - ty0) * 256;
      for (let r = 0; r < 256; r++)
        data.copy(mosaic, ((oy + r) * W + ox) * 3, r * 256 * 3, (r + 1) * 256 * 3);
      if (++done % 100 === 0) console.log(`  ${done}/${tw * th}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => worker(3)));
  // Başarısız karoları yavaşça yeniden dene
  for (let round = 0; round < 3 && failed.length; round++) {
    await new Promise((r) => setTimeout(r, 5000));
    jobs.push(...failed.splice(0));
    await Promise.all(Array.from({ length: 2 }, () => worker(6)));
  }
  fails = failed.length;
  if (fails > tw * th * 0.2) throw new Error(`${fails} karo alınamadı`);
  if (blanks > tw * th * 0.3) throw new Error(`${blanks} boş karo`);
  // Yerel ızgara: native çözünürlüğe yakın (en fazla 6000 piksel)
  const mpp = (156543.034 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** Z;
  const N = Math.min(6000, Math.round((HALF * 2) / mpp));
  const cell = (HALF * 2) / N;
  const out = Buffer.alloc(N * N * 3);
  const gx0 = tx0 * 256;
  const gy0 = ty0 * 256;
  for (let j = 0; j < N; j++) {
    const z = CZ - HALF + (j + 0.5) * cell;
    for (let i = 0; i < N; i++) {
      const x = CX - HALF + (i + 0.5) * cell;
      const ll = unproject(x, z, center);
      const px = mercX(ll.lon, Z) - gx0 - 0.5;
      const py = mercY(ll.lat, Z) - gy0 - 0.5;
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(px)));
      const y0 = Math.max(0, Math.min(Hh - 2, Math.floor(py)));
      const fx = px - x0;
      const fy = py - y0;
      const o = (j * N + i) * 3;
      for (let c = 0; c < 3; c++) {
        const a = mosaic[(y0 * W + x0) * 3 + c];
        const b = mosaic[(y0 * W + x0 + 1) * 3 + c];
        const d = mosaic[((y0 + 1) * W + x0) * 3 + c];
        const e = mosaic[((y0 + 1) * W + x0 + 1) * 3 + c];
        out[o + c] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + d * (1 - fx) * fy + e * fx * fy;
      }
    }
  }
  const file = `${src.name}-z${Z}.jpg`;
  await sharp(out, { raw: { width: N, height: N, channels: 3 } })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(join(outDir, file));
  return { file, source: src.name, zoom: Z, size: N, metersPerPixel: +cell.toFixed(4), blanks, fails };
}

async function main() {
  const center = JSON.parse(await readFile(join(root, 'public', 'data', 'meta.json'), 'utf8')).center;
  await mkdir(outDir, { recursive: true });
  const results = [];
  for (const src of SOURCES) {
    // Her kaynaktan alınabilen en yüksek yakınlık
    for (const Z of src.zooms) {
      try {
        results.push(await grab(src, Z, center));
        console.log(`✓ ${src.name} z${Z}`);
        break;
      } catch (e) {
        console.warn(`⚠ ${src.name} z${Z}: ${e.message}`);
      }
    }
  }
  if (!results.length) throw new Error('hiçbir kaynaktan alınamadı');
  await writeFile(
    join(outDir, 'index.json'),
    JSON.stringify(
      {
        note: 'Yerel ENU (x doğu, z güney): satır 0 = z CZ−HALF (kuzey), sütun 0 = x CX−HALF (batı)',
        cx: CX,
        cz: CZ,
        half: HALF,
        center,
        fetchedAt: new Date().toISOString(),
        images: results,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
