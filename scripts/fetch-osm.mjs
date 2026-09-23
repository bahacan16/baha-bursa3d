#!/usr/bin/env node
// Overpass → public/data/osm.json + meta.json
// Kullanım: node scripts/fetch-osm.mjs
// Not: Bu script ağ erişimi ister. Başarısız olursa sahte veri ÜRETMEZ; çıkış kodu 1 döner.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CENTER_STREET,
  DATA_HALF,
  DEFAULT_CENTER_LITE,
  OVERPASS_ENDPOINTS,
  bboxString,
  centerQuery,
  countFeatures,
  dataQuery,
  simplifyOverpass,
  streetMidpoint,
} from '../src/worlds/osm/simplify.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'data');

async function overpass(query) {
  let lastErr;
  // Overpass sunucuları yoğunlukta 429/504 döner: tüm aynaları 3 tur dene.
  for (let round = 0; round < 3; round++)
    for (const url of OVERPASS_ENDPOINTS) {
      for (let attempt = 0; attempt < 1; attempt++) {
        try {
          console.log(`→ ${url} (tur ${round + 1})`);
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'nilufer-walk/0.1',
            },
            body: 'data=' + encodeURIComponent(query),
            signal: AbortSignal.timeout(180_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          if (!Array.isArray(json.elements)) throw new Error('geçersiz yanıt');
          if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark);
          return json;
        } catch (err) {
          lastErr = err;
          console.warn(`  başarısız: ${err.message}`);
          await new Promise((r) => setTimeout(r, 5000 * (round + 1)));
        }
      }
    }
  throw lastErr;
}

async function main() {
  let center = DEFAULT_CENTER_LITE;
  let centerSource = 'default';
  try {
    const q = await overpass(centerQuery(DEFAULT_CENTER_LITE));
    const mid = streetMidpoint(q, DEFAULT_CENTER_LITE, CENTER_STREET);
    if (mid) {
      center = { lat: +mid.lat.toFixed(7), lon: +mid.lon.toFixed(7) };
      centerSource = `osm:${CENTER_STREET}`;
      console.log(`✓ ${CENTER_STREET} bulundu, merkez: ${center.lat}, ${center.lon}`);
    } else {
      console.warn(`⚠ ${CENTER_STREET} 1.5 km içinde bulunamadı; varsayılan merkez kullanılıyor.`);
    }
  } catch (err) {
    console.warn(`⚠ Merkez sorgusu başarısız (${err.message}); varsayılan merkez kullanılıyor.`);
  }

  const raw = await overpass(dataQuery(center, DATA_HALF));
  const data = simplifyOverpass(raw, center, centerSource, DATA_HALF);
  const counts = countFeatures(data);
  // Kısmi/boş yanıtları kaydetme (bölgede binlerce bina var).
  if (counts.buildings < 200 || counts.roads < 200)
    throw new Error(`şüpheli az veri: ${JSON.stringify(counts)}`);
  // Bazı Overpass aynaları eksik yanıt döndürebiliyor: mevcut veriden belirgin azsa kaydetme.
  let prev = null;
  try {
    prev = JSON.parse(await readFile(join(outDir, 'meta.json'), 'utf8'));
  } catch {
    /* ilk çalıştırma */
  }
  for (const k of ['buildings', 'roads', 'nodes']) {
    if (prev?.counts?.[k] && counts[k] < prev.counts[k] * 0.8)
      throw new Error(`eksik yanıt: ${k} ${counts[k]} < önceki ${prev.counts[k]} × 0.8`);
  }
  const json = JSON.stringify(data);
  const meta = {
    center,
    centerSource,
    fetchedAt: new Date().toISOString(),
    bbox: bboxString(center, DATA_HALF),
    half: DATA_HALF,
    counts,
    attribution: '© OpenStreetMap contributors (ODbL)',
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'osm.json'), json);
  await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`✓ osm.json ${(json.length / 1e6).toFixed(2)} MB`, meta.counts);
  if (json.length > 10e6) console.warn('⚠ osm.json 10 MB sınırını aşıyor!');
}

main().catch((err) => {
  console.error('✗ OSM verisi alınamadı:', err.message);
  process.exit(1);
});
