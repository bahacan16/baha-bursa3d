#!/usr/bin/env node
// Street View pilotu: bir sitenin (OSM landuse adı) bina cephelerini gören Street View karelerini indirir.
// Anahtar yalnızca ortam değişkeninden okunur (GOOGLE_STREETVIEW_KEY, GitHub secret) — asla yazdırılmaz/kaydedilmez.
// 1) Yollar boyunca ~10 m arayla ücretsiz metadata sorgusu → benzersiz panoramalar
// 2) Her panoramadan hedef cepheleri gören yön/eğim kareleri (640², fov 90) — ücretli istekler
// Önceden indirilmiş kareler atlanır; toplam istek SV_MAX ile sınırlıdır.
// Çıktı: public/streetview/<slug>/index.json + <pano>_<heading>_<pitch>.jpg
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CENTER_LITE, project, unproject } from '../src/worlds/osm/simplify.ts';
import {
  FENCE_H,
  Occluders,
  centroid,
  headingOf,
  outwardNormal,
  pilotArea,
  siteFences,
} from './sv-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.GOOGLE_STREETVIEW_KEY;
const AREA = process.env.SV_AREA || 'Mertkent 2. Etap';
const BUFFER = Number(process.env.SV_BUFFER ?? 60);
const MAX = Number(process.env.SV_MAX ?? 2000);
const GROUND = process.env.SV_GROUND !== '0'; // yere bakan kareler (asfalt/kaldırım dokusu)
const DRY = process.env.SV_DRY === '1';
const CAM_H = 2.5; // Google aracı kamera yüksekliği (yaklaşık)
const FOV = 90;
const HEAD_STEP = 60; // yön kovaları (fov 90 → komşularla 15° örtüşme)
const MAX_DIST = 55;
const API = 'https://maps.googleapis.com/maps/api/streetview';

const slug = AREA.toLowerCase()
  .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c])
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const outDir = join(root, 'public', 'streetview', slug);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function get(url, asJson) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return asJson ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      // URL anahtar içerir: yalnızca hata mesajı yazılır
      if (a === 3) throw new Error(`istek başarısız: ${e.message}`, { cause: e });
      await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
    }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  if (!KEY) {
    console.error('✗ GOOGLE_STREETVIEW_KEY tanımlı değil (GitHub → Settings → Secrets → Actions).');
    process.exit(1);
  }
  const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
  let center = DEFAULT_CENTER_LITE;
  try {
    center = JSON.parse(await readFile(join(root, 'public', 'data', 'meta.json'), 'utf8')).center ?? center;
  } catch {
    /* varsayılan */
  }
  const { bbox, all, targets } = pilotArea(osm, AREA, BUFFER);
  console.log(
    `Alan: ${AREA} — ${targets.length} hedef bina, kutu ${bbox.map((v) => v.toFixed(0)).join(',')}`,
  );

  // 1) Yollar boyunca örnek noktalar
  const pts = [];
  const inBox = (x, z) => x >= bbox[0] && x <= bbox[2] && z >= bbox[1] && z <= bbox[3];
  for (const w of osm.ways) {
    if (!w.t || !w.t.highway) continue;
    const p = w.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      const n = Math.max(1, Math.round(len / 10));
      for (let s = 0; s < n; s++) {
        const x = p[i] + ((p[i + 2] - p[i]) * s) / n;
        const z = p[i + 1] + ((p[i + 3] - p[i + 1]) * s) / n;
        if (inBox(x, z)) pts.push([x, z]);
      }
    }
  }
  console.log(`${pts.length} örnek nokta → metadata (ücretsiz)`);

  const panos = new Map();
  let noPano = 0;
  await pool(pts, 8, async ([x, z]) => {
    const { lat, lon } = unproject(x, z, center);
    const m = await get(`${API}/metadata?location=${lat},${lon}&radius=12&source=outdoor&key=${KEY}`, true);
    if (m.status !== 'OK') {
      if (m.status === 'REQUEST_DENIED') throw new Error(`REQUEST_DENIED: ${m.error_message ?? ''}`);
      noPano++;
      return;
    }
    if (panos.has(m.pano_id)) return;
    // Yalnızca Google araç çekimleri (kamera yüksekliği bilinen); kullanıcı fotoküreleri atlanır
    if (!/Google/i.test(m.copyright ?? '')) return;
    const [px, pz] = project(m.location.lat, m.location.lng, center);
    panos.set(m.pano_id, {
      id: m.pano_id,
      lat: m.location.lat,
      lng: m.location.lng,
      x: px,
      z: pz,
      date: m.date,
    });
  });
  console.log(`${panos.size} Google panoraması (${noPano} noktada panorama yok)`);

  // 2) Her panorama için gereken yön/eğim kareleri
  const occ = new Occluders(all);
  const fences = siteFences(osm, bbox);
  console.log(`${targets.length} bina, ${fences.length} çit parçası`);
  const jobs = [];
  for (const pano of panos.values()) {
    const need = new Map(); // heading → maxPitchNeeded
    for (const b of targets) {
      const r = b.ring;
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [nx, nz] = outwardNormal(r, i);
        for (const t of [0.1, 0.5, 0.9]) {
          const wx = r[2 * i] + (r[2 * j] - r[2 * i]) * t;
          const wz = r[2 * i + 1] + (r[2 * j + 1] - r[2 * i + 1]) * t;
          const dx = pano.x - wx;
          const dz = pano.z - wz;
          const d = Math.hypot(dx, dz);
          if (d < 3 || d > MAX_DIST) continue;
          if ((dx * nx + dz * nz) / d < 0.2) continue; // cepheyi arkadan/çok yandan görüyor
          if (occ.blocked(pano.x, pano.z, wx + nx * 0.05, wz + nz * 0.05, [b.id, i])) continue;
          const h = headingOf(wx - pano.x, wz - pano.z);
          const bin = (Math.round(h / HEAD_STEP) * HEAD_STEP) % 360;
          const elev = (Math.atan2(b.height - CAM_H, d) * 180) / Math.PI;
          need.set(bin, Math.max(need.get(bin) ?? 0, elev));
        }
      }
    }
    // Site çitleri (yola bakan yüz)
    for (const f of fences) {
      const nx = -f[4];
      const nz = -f[5];
      for (const t of [0.2, 0.8]) {
        const wx = f[0] + (f[2] - f[0]) * t;
        const wz = f[1] + (f[3] - f[1]) * t;
        const dx = pano.x - wx;
        const dz = pano.z - wz;
        const d = Math.hypot(dx, dz);
        if (d < 2 || d > 30) continue;
        if ((dx * nx + dz * nz) / d < 0.2) continue;
        if (occ.blocked(pano.x, pano.z, wx, wz, null)) continue;
        const h = headingOf(wx - pano.x, wz - pano.z);
        const bin = (Math.round(h / HEAD_STEP) * HEAD_STEP) % 360;
        const elev = (Math.atan2(FENCE_H - CAM_H, d) * 180) / Math.PI;
        need.set(bin, Math.max(need.get(bin) ?? 0, elev));
      }
    }
    pano.views = [];
    if (GROUND)
      for (const h of [0, 90, 180, 270]) {
        const file = `${pano.id}_${h}_-50.jpg`;
        pano.views.push({ h, p: -50, fov: FOV, file, ground: true });
        jobs.push({ pano, h, p: -50, file });
      }
    for (const [h, elev] of need) {
      const pitches = elev > 40 ? [0, 40] : [0];
      for (const p of pitches) {
        const file = `${pano.id}_${h}_${p}.jpg`;
        pano.views.push({ h, p, fov: FOV, file });
        jobs.push({ pano, h, p, file });
      }
    }
  }
  const usable = [...panos.values()].filter((p) => p.views.length);
  let todo = [];
  for (const j of jobs) if (!(await exists(join(outDir, j.file)))) todo.push(j);
  console.log(`${usable.length} panorama kullanılacak, ${jobs.length} kare (${todo.length} yeni, ücretli)`);
  if (todo.length > MAX) {
    console.error(
      `✗ ${todo.length} kare SV_MAX=${MAX} sınırını aşıyor; durduruldu (hiç ücretli istek yapılmadı).`,
    );
    process.exit(1);
  }
  if (DRY) {
    console.log('SV_DRY=1 → yalnızca sayım yapıldı.');
    return;
  }

  await mkdir(outDir, { recursive: true });
  let done = 0;
  await pool(todo, 6, async (j) => {
    const buf = await get(
      `${API}?size=640x640&pano=${j.pano.id}&heading=${j.h}&pitch=${j.p}&fov=${FOV}&return_error_code=true&key=${KEY}`,
      false,
    );
    await writeFile(join(outDir, j.file), buf);
    if (++done % 50 === 0) console.log(`  ${done}/${todo.length}`);
  });

  const index = {
    area: AREA,
    slug,
    fetchedAt: new Date().toISOString(),
    camHeight: CAM_H,
    size: 640,
    targets: targets.map((b) => b.id),
    targetCentroids: targets.map((b) => centroid(b.ring).map((v) => +v.toFixed(2))),
    panos: usable.map(({ id, lat, lng, x, z, date, views }) => ({
      id,
      lat,
      lng,
      x: +x.toFixed(2),
      z: +z.toFixed(2),
      date,
      views,
    })),
    attribution: '© Google Street View',
  };
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`✓ ${done} kare indirildi → public/streetview/${slug}/`);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
