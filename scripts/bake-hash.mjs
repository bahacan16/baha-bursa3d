// Pişirilmiş ışık kaynak özeti (docs/BAKE.md §Hat 3). Aynı fonksiyon: vite.config.ts (oyuna `__BAKE_SRC_HASH__`),
// scripts/bake-export.mjs (export.json) ve CI. Kullanım: node scripts/bake-hash.mjs [--list]
//
// SHA-1( her dosya için: göreli yol \0 içerik (CRLF → LF) \0 ), dosyalar yola göre sıralı.
// Kapsam: el modeli verisi + üretici kaynakları + OSM/arazi (engelleyiciler ve zemin kotu).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Özete giren dosyalar (kök dizine göre, sıralı) */
export function bakeSourceFiles(root = ROOT) {
  const out = [];
  const walk = (dir, filter) => {
    const abs = join(root, dir);
    if (!existsSync(abs)) return;
    for (const f of readdirSync(abs)) {
      const p = join(abs, f);
      if (statSync(p).isDirectory()) walk(join(dir, f), filter);
      else if (filter(f)) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  // Üretici: src/worlds/mertkent/**/*.ts (baked.ts/bakeexport.ts yalnız oyun tarafı → hariç)
  walk('src/worlds/mertkent', (f) => f.endsWith('.ts') && !/^bake(d|export)\.ts$/.test(f));
  // Ölçüm verisi (facades, footprints, street/site/park planı…)
  walk('src/worlds/mertkent/data', (f) => f.endsWith('.json'));
  for (const f of [
    'public/data/osm.json',
    'public/data/terrain.bin',
    'src/worlds/osm/height.ts',
    'src/env/terrain.ts',
  ])
    if (existsSync(join(root, f))) out.push(f);
  return [...new Set(out)].sort();
}

export function bakeHash(root = ROOT) {
  const h = createHash('sha1');
  for (const f of bakeSourceFiles(root)) {
    let buf = readFileSync(join(root, f));
    if (!f.endsWith('.bin')) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    h.update(f);
    h.update('\0');
    h.update(buf);
    h.update('\0');
  }
  return h.digest('hex');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--list')) for (const f of bakeSourceFiles()) console.log(f);
  console.log(bakeHash());
}
