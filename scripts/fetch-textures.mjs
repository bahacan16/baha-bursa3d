#!/usr/bin/env node
// CC0 foto-taramalı PBR dokuları (Poly Haven, https://polyhaven.com — CC0) → public/textures/<rol>/
// Geliştirme ortamı Poly Haven'a erişemediği için GitHub Actions'ta çalışır.
// Kullanım: node scripts/fetch-textures.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'textures');
const API = 'https://api.polyhaven.com';
const UA = { 'User-Agent': 'nilufer-walk/0.1 (github.com/bahacan16/baha-bursa3d)' };

// Rol → tercih edilen id'ler (varsa) + arama anahtar kelimeleri (id/ad/etiket/kategori içinde)
const ROLES = {
  asphalt: { prefer: ['asphalt_02', 'asphalt_01', 'rough_asphalt'], words: ['asphalt'], res: '2k' },
  paving: {
    prefer: ['paving_stones', 'interlocking_paving', 'brick_pavement'],
    words: ['paving', 'pavement', 'interlock'],
    res: '1k',
  },
  concrete: {
    prefer: ['concrete_floor_02', 'concrete_pavement', 'concrete_wall_004'],
    words: ['concrete'],
    res: '1k',
  },
  plaster: {
    prefer: ['painted_plaster_wall', 'white_plaster_02', 'plaster_brick_pattern'],
    words: ['plaster', 'stucco'],
    res: '1k',
  },
  roof: { prefer: ['roof_tiles', 'clay_roof_tiles', 'roof_07'], words: ['roof'], res: '1k' },
  grass: { prefer: ['aerial_grass_rock', 'grass_path_2', 'forrest_ground_01'], words: ['grass'], res: '1k' },
  dirt: {
    prefer: ['brown_mud_leaves_01', 'dirt', 'aerial_ground_rock'],
    words: ['dirt', 'soil', 'ground'],
    res: '1k',
  },
  bark: { prefer: ['bark_brown_02', 'bark_willow', 'pine_bark'], words: ['bark'], res: '1k' },
};
const MAPS = [
  ['diffuse', ['Diffuse', 'diff']],
  ['normal', ['nor_gl', 'Normal']],
  ['rough', ['Rough', 'rough']],
];

async function json(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const assets = await json(`${API}/assets?t=textures`);
  const ids = Object.keys(assets);
  console.log(`Poly Haven: ${ids.length} doku`);
  const manifest = {
    source: 'Poly Haven (polyhaven.com)',
    license: 'CC0 1.0',
    fetchedAt: new Date().toISOString(),
    roles: {},
  };
  const used = new Set();
  for (const [role, spec] of Object.entries(ROLES)) {
    const hay = (id) => {
      const a = assets[id];
      return `${id} ${a.name} ${(a.tags ?? []).join(' ')} ${(a.categories ?? []).join(' ')}`.toLowerCase();
    };
    let id = spec.prefer.find((p) => assets[p] && !used.has(p));
    if (!id) {
      const cands = ids.filter((i) => !used.has(i) && spec.words.some((w) => hay(i).includes(w)));
      // En çok indirilen (popüler) olanı seç
      cands.sort((a, b) => (assets[b].download_count ?? 0) - (assets[a].download_count ?? 0));
      id = cands[0];
      console.log(`  ${role}: adaylar → ${cands.slice(0, 8).join(', ')}`);
    }
    if (!id) {
      console.warn(`⚠ ${role}: uygun doku bulunamadı`);
      continue;
    }
    used.add(id);
    const files = await json(`${API}/files/${id}`);
    const dir = join(outDir, role);
    await mkdir(dir, { recursive: true });
    const got = {};
    for (const [name, keys] of MAPS) {
      const key = keys.find((k) => files[k]);
      const entry = key && (files[key][spec.res] ?? files[key]['1k']);
      const url = entry?.jpg?.url ?? entry?.png?.url;
      if (!url) {
        console.warn(`  ${role}/${name}: yok`);
        continue;
      }
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      const ext = url.endsWith('.png') ? 'png' : 'jpg';
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(join(dir, `${name}.${ext}`), buf);
      got[name] = `${role}/${name}.${ext}`;
      console.log(`  ✓ ${role}/${name} ← ${id} (${(buf.length / 1024).toFixed(0)} KB)`);
    }
    const info = assets[id];
    manifest.roles[role] = {
      id,
      name: info.name,
      authors: Object.keys(info.authors ?? {}),
      url: `https://polyhaven.com/a/${id}`,
      // Dokunun gerçek boyutu (m) — varsa
      dimensions: info.dimensions ?? null,
      files: got,
    };
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('✓ manifest yazıldı');
}

main().catch((e) => {
  console.error('✗ Dokular alınamadı:', e.message);
  process.exit(1);
});
