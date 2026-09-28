#!/usr/bin/env node
// Elle modelleme için ek referans kareleri (yakınlaştırılmış, belirli yön/eğim) ve site içi panorama taraması.
// Girdi: scripts/sv-extra.json  { requests: [{ pano, h, p, fov }], probe: { poly: [x,z,...] , step } }
// Çıktı: streetview-src/extra/<pano>_<h>_<p>_<fov>.jpg + extra.json (bulunan iç panoramalar dahil)
// Anahtar yalnızca GOOGLE_STREETVIEW_KEY ortam değişkeninden okunur, yazdırılmaz.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CENTER_LITE, project, unproject } from '../src/worlds/osm/simplify.ts';
import { inside } from './sv-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.GOOGLE_STREETVIEW_KEY;
const MAX = Number(process.env.SV_MAX ?? 400);
const API = 'https://maps.googleapis.com/maps/api/streetview';
const outDir = join(root, 'streetview-src', 'extra');

async function get(url, asJson) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return asJson ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (a === 3) throw new Error(`istek başarısız: ${e.message}`, { cause: e });
      await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
    }
  }
}
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

async function main() {
  if (!KEY) throw new Error('GOOGLE_STREETVIEW_KEY tanımlı değil');
  const cfg = JSON.parse(await readFile(join(root, 'scripts', 'sv-extra.json'), 'utf8'));
  let center = DEFAULT_CENTER_LITE;
  try {
    center = JSON.parse(await readFile(join(root, 'public', 'data', 'meta.json'), 'utf8')).center ?? center;
  } catch {
    /* varsayılan */
  }
  await mkdir(outDir, { recursive: true });
  const out = { inner: [], frames: [] };
  // 1) Site içi panorama taraması (ücretsiz metadata; kullanıcı fotoküreleri dahil)
  const requests = [...cfg.requests];
  if (cfg.probe) {
    const { poly, step } = cfg.probe;
    const seen = new Set();
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      x0 = Math.min(x0, poly[i]);
      x1 = Math.max(x1, poly[i]);
      z0 = Math.min(z0, poly[i + 1]);
      z1 = Math.max(z1, poly[i + 1]);
    }
    for (let x = x0; x <= x1; x += step)
      for (let z = z0; z <= z1; z += step) {
        if (!inside(poly, x, z)) continue;
        const { lat, lon } = unproject(x, z, center);
        const m = await get(
          `${API}/metadata?location=${lat},${lon}&radius=${step}&source=default&key=${KEY}`,
          true,
        );
        if (m.status !== 'OK' || seen.has(m.pano_id)) continue;
        const [px, pz] = project(m.location.lat, m.location.lng, center);
        if (!inside(poly, px, pz)) continue;
        seen.add(m.pano_id);
        out.inner.push({
          id: m.pano_id,
          x: +px.toFixed(2),
          z: +pz.toFixed(2),
          date: m.date,
          copyright: m.copyright,
        });
        for (let h = 0; h < 360; h += 45) requests.push({ pano: m.pano_id, h, p: 5, fov: 60 });
      }
    console.log(`site içi: ${out.inner.length} panorama`);
  }
  const todo = [];
  for (const r of requests) {
    const file = `${r.pano}_${r.h}_${r.p}_${r.fov}.jpg`;
    out.frames.push({ ...r, file });
    if (!(await exists(join(outDir, file)))) todo.push({ ...r, file });
  }
  console.log(`${requests.length} kare (${todo.length} yeni)`);
  if (todo.length > MAX) throw new Error(`${todo.length} > SV_MAX=${MAX}; durduruldu`);
  for (const r of todo) {
    const buf = await get(
      `${API}?size=640x640&pano=${r.pano}&heading=${r.h}&pitch=${r.p}&fov=${r.fov}&return_error_code=true&key=${KEY}`,
      false,
    );
    await writeFile(join(outDir, r.file), buf);
  }
  await writeFile(join(outDir, 'extra.json'), JSON.stringify(out, null, 1));
  console.log('✓ tamam');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
