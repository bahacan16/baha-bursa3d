// Pişirilmiş ışık — dışa aktarma (docs/BAKE.md §Hat 1).
// Başsız oyunu `?debug=1&bakeexport=1` ile açar, el modeli meshlerini 100 m parçalar hâlinde (uv1'li) ve
// engelleyicileri GLB olarak yazar. Oyun önceden derlenip sunulmuş olmalı (vite preview).
//
// Kullanım:
//   npx vite build --outDir /tmp/bake-dist && npx vite preview --outDir /tmp/bake-dist --port 4180 --strictPort &
//   node scripts/bake-export.mjs [--url http://localhost:4180/] [--out bake-work/src] [--texel 0.08]
//        [--chunks 0_-1,-1_-1]   (yalnız bu parçalar; engelleyiciler bunların çevresinden)
//        [--chunk 100] [--maxatlas 4096]   (parça kenarı m / atlas kenarı px; ortam: BAKE_CHUNK_M, BAKE_MAX_ATLAS)
// Ortam: CHROMIUM=/yol/chrome (yoksa /opt/pw-browsers/... ya da Playwright'ın kendi tarayıcısı)
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bakeHash } from './bake-hash.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(/\s*--/)
    .filter(Boolean)
    .map((a) => {
      const [k, ...v] = a.split(/[\s=]+/);
      return [k, v.join(' ') || '1'];
    }),
);
const url = args.url ?? 'http://localhost:4180/';
const out = args.out ?? 'bake-work/src';
const texel = Number(args.texel ?? process.env.BAKE_TEXEL ?? 0.08);
const maxAtlas = Number(args.maxatlas ?? process.env.BAKE_MAX_ATLAS ?? 4096);
// Parça kenarı (m). 100 m + 4096² atlas pişirmede ~5.5 GB bellek ister; 50 m + 2048² ~¼'ü (küçük CI makinesi)
const chunkM = Number(args.chunk ?? process.env.BAKE_CHUNK_M ?? 100);
const only = args.chunks ? new Set(args.chunks.split(',')) : null;
const MARGIN = 60;

mkdirSync(out, { recursive: true });
const localChrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = process.env.CHROMIUM ?? (existsSync(localChrome) ? localChrome : undefined);
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (/^bake/.test(m.text())) console.log('[page]', m.text());
});
// Derlenmiş kopyadaki veri eski olabilir: güncel OSM doğrudan repodan
if (existsSync('public/data/osm.json'))
  await page.route('**/data/osm.json', (r) =>
    r.fulfill({ body: readFileSync('public/data/osm.json', 'utf8'), contentType: 'application/json' }),
  );
const t0 = Date.now();
await page.goto(
  `${url}?debug=1&mode=b&q=high&bakeexport=1&texel=${texel}&maxatlas=${maxAtlas}&chunk=${chunkM}`,
);
await page.waitForFunction(() => window.__bake && window.__game && window.__game.world, null, {
  timeout: 300000,
});
console.log(`oyun hazır (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
// Görüntü gerekmez: işlemciyi dışa aktarmaya bırak
await page.evaluate(() => {
  const g = window.__game;
  if (g?.loop?.stop) g.loop.stop();
});
const info = await page.evaluate(() => window.__bake.info());
const localHash = bakeHash();
if (info.srcHash !== localHash)
  console.warn(
    `UYARI: derlenmiş oyunun kaynak özeti (${info.srcHash}) repodakinden (${localHash}) farklı — önce yeniden derleyin`,
  );
const chunks = info.chunks.filter((c) => !only || only.has(c.id));
console.log(
  `${info.chunks.length} parça (${chunks.length} yazılacak), ${Object.keys(info.keys).length} anahtar`,
);
let totalTris = 0;
for (const c of chunks) {
  const r = await page.evaluate((id) => window.__bake.chunk(id), c.id);
  c.file = `chunk_${c.id}.glb`;
  c.size = r.size;
  c.texel = r.texel;
  c.charts = r.charts;
  writeFileSync(join(out, c.file), Buffer.from(r.glb, 'base64'));
  // Ada dikdörtgenleri + normalin yukarı bileşeni (float32 × 5): pişirmede E0(n) için
  c.rectsFile = `chunk_${c.id}.rects.bin`;
  writeFileSync(join(out, c.rectsFile), Buffer.from(r.rects, 'base64'));
  totalTris += c.tris;
  console.log(
    `  ${c.id}: ${c.tris} üçgen, ${r.charts} ada, atlas ${r.size}² @ ${(r.texel * 100).toFixed(1)} cm/px, ` +
      `doluluk %${Math.round(r.fill * 100)} (uv ${r.unwrapMs} ms)`,
  );
}
const x0 = Math.min(...chunks.map((c) => c.bbox[0]));
const z0 = Math.min(...chunks.map((c) => c.bbox[1]));
const x1 = Math.max(...chunks.map((c) => c.bbox[2]));
const z1 = Math.max(...chunks.map((c) => c.bbox[3]));
const occRect = [x0 - MARGIN, z0 - MARGIN, x1 + MARGIN, z1 + MARGIN];
const occ = await page.evaluate((rect) => window.__bake.occluders(rect), occRect);
writeFileSync(join(out, 'occluders.glb'), Buffer.from(occ.glb, 'base64'));
console.log(`engelleyiciler: ${occ.osm} OSM/SV mesh, ${occ.trees} ağaç`);
// Pişirilmemiş ama engelleyici olarak gereken el modeli parçaları (yalnız --chunks ile)
const neighbours = only
  ? info.chunks.filter(
      (c) =>
        !only.has(c.id) &&
        c.bbox[2] > occRect[0] &&
        c.bbox[0] < occRect[2] &&
        c.bbox[3] > occRect[1] &&
        c.bbox[1] < occRect[3],
    )
  : [];
for (const c of neighbours) {
  const r = await page.evaluate((id) => window.__bake.chunk(id), c.id);
  c.file = `chunk_${c.id}.glb`;
  c.size = r.size;
  c.texel = r.texel;
  writeFileSync(join(out, c.file), Buffer.from(r.glb, 'base64'));
  console.log(`  komşu (yalnız engelleyici) ${c.id}`);
}
await browser.close();
const exp = {
  ...info,
  createdAt: new Date().toISOString(),
  localHash,
  chunks,
  occluderChunks: neighbours,
  occluders: 'occluders.glb',
  region: [x0, z0, x1, z1],
  occluderRect: occRect,
};
writeFileSync(join(out, 'export.json'), JSON.stringify(exp, null, 1));
console.log(
  `bitti: ${chunks.length} parça, ${totalTris} üçgen, ${((Date.now() - t0) / 1000).toFixed(0)} s → ${out}`,
);
