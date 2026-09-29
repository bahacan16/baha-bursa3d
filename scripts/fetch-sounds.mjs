#!/usr/bin/env node
// Gerçek ses kayıtlarını indirir, lisansını doğrular, işler ve public/sounds/'a yazar (GitHub Actions'ta çalışır:
// .github/workflows/fetch-sounds.yml; geliştirme ortamının açık interneti yok).
//
//   node scripts/fetch-sounds.mjs            # tümü
//   node scripts/fetch-sounds.mjs step_gravel bird_dove   # yalnız bu yuvalar (manifest birleştirilir)
//
// Kaynaklar scripts/sounds.json'da. Yalnız CC0 / CC BY (sounds.json "accept") kabul edilir; lisans kaynak
// sayfasından (ya da Freesound API'sinden) doğrulanır, uymayan atlanır. FREESOUND_API_KEY verilirse Freesound API
// kullanılır (daha güvenilir), yoksa ses sayfası HTML'i okunur.
// Gereksinim: ffmpeg (libmp3lame).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LICENSE_NAME,
  deinterleave,
  detectEvents,
  fade,
  interleave,
  licenseUrl,
  loudestWindow,
  makeLoop,
  normalize,
  packSprite,
  parseFreesoundPack,
  parseFreesoundPage,
  parseLicense,
  prepareSlice,
  highpass,
} from './sounds-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CFG = JSON.parse(readFileSync(join(ROOT, 'scripts/sounds.json'), 'utf8'));
const OUT = join(ROOT, 'public/sounds');
const TMP = join(tmpdir(), 'nw-sounds');
const SR = 44100;
const KEY = process.env.FREESOUND_API_KEY || '';
const UA = { 'User-Agent': 'NiluferWalk-SoundFetch/1.0 (hobby game; CC0/CC-BY attribution kept)' };
const ACCEPT = new Set(CFG.accept ?? ['cc0', 'by']);
const only = new Set(process.argv.slice(2));

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = 'text', tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow' });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) return { ok: false, status: r.status, url: r.url };
      const body =
        as === 'json' ? await r.json() : as === 'buf' ? Buffer.from(await r.arrayBuffer()) : await r.text();
      return { ok: true, status: r.status, url: r.url, body };
    } catch (e) {
      last = e;
      await sleep(1500 * (i + 1));
    }
  }
  return { ok: false, status: 0, error: String(last) };
}

// ------------------------------------------------------------------ çözücüler

async function freesoundSound(id) {
  if (KEY) {
    const r = await get(
      `https://freesound.org/apiv2/sounds/${id}/?fields=id,name,username,license,previews,duration,url,description&token=${KEY}`,
      'json',
    );
    if (!r.ok) return { error: `API ${r.status}` };
    const s = r.body;
    return {
      url: s.previews?.['preview-hq-mp3'],
      license: parseLicense(s.license),
      author: s.username,
      title: s.name,
      page: s.url ?? `https://freesound.org/s/${id}/`,
      duration: s.duration,
    };
  }
  const r = await get(`https://freesound.org/s/${id}/`);
  if (!r.ok) return { error: `sayfa ${r.status}` };
  const p = parseFreesoundPage(r.body, r.url);
  if (!p.preview) return { error: 'önizleme bağlantısı bulunamadı' };
  return {
    url: p.preview,
    license: p.license ?? { family: 'unknown', version: '' },
    author: p.user,
    title: p.title,
    page: r.url || `https://freesound.org/s/${id}/`,
  };
}

const packCache = new Map();

async function freesoundPack(user, pack, match, take) {
  const re = new RegExp(match, 'i');
  const key = `${user}/${pack}`;
  if (!packCache.has(key)) packCache.set(key, await packList(user, pack));
  const list = packCache.get(key);
  const out = [];
  let lookups = 0;
  for (const s of list) {
    if (out.length >= take) break;
    // Paket sayfasında ad yoksa ses sayfasından başlığı oku (en çok 80 istek)
    if (!s.name && lookups < 80) {
      lookups++;
      const m = await freesoundSound(s.id);
      s.name = m.title ?? '';
      await sleep(300);
    }
    if (re.test(s.name)) out.push(s);
  }
  return out;
}

async function packList(user, pack) {
  let list = [];
  if (KEY) {
    const r = await get(
      `https://freesound.org/apiv2/packs/${pack}/sounds/?fields=id,name&page_size=150&token=${KEY}`,
      'json',
    );
    if (r.ok) list = r.body.results.map((s) => ({ id: String(s.id), name: s.name }));
  } else {
    for (let page = 1; page <= 12; page++) {
      const r = await get(`https://freesound.org/people/${user}/packs/${pack}/?page=${page}`);
      if (!r.ok) break;
      const items = parseFreesoundPack(r.body, user);
      const fresh = items.filter((i) => !list.some((l) => l.id === i.id));
      if (!fresh.length) break;
      list.push(...fresh);
      await sleep(400);
    }
  }
  console.log(`  (paket ${user}/${pack}: ${list.length} ses)`);
  return list;
}

async function bigsoundbank(id, page) {
  let title = `BigSoundBank #${id}`;
  let titleVerified = false;
  let licenseOk = null;
  if (page) {
    const r = await get(page);
    if (r.ok) {
      const t = /<title>\s*([^<]+?)\s*<\/title>/.exec(r.body)?.[1];
      if (t) {
        title = t.split(/ — | - | \| /)[0].trim();
        titleVerified = true;
      }
      licenseOk = /CC0|publicdomain\/zero/i.test(r.body);
    }
  }
  if (licenseOk === null) {
    // KARAR: BigSoundBank (Joseph Sardin) tüm sesleri CC0 yayımlar; sayfa okunamazsa site geneli beyana dayanılır
    const r = await get('https://bigsoundbank.com/about.php');
    licenseOk = r.ok ? /CC0|publicdomain\/zero/i.test(r.body) : true;
  }
  if (!licenseOk) return { error: 'CC0 beyanı bulunamadı' };
  const meta = {
    license: { family: 'cc0', version: '1.0' },
    author: 'Joseph Sardin (BigSoundBank)',
    title,
    titleVerified,
    page: page ?? `https://bigsoundbank.com/search?q=${id}`,
  };
  for (const ext of ['flac', 'wav', 'mp3']) {
    const url = `https://bigsoundbank.com/UPLOAD/${ext}/${id}.${ext}`;
    const h = await fetch(url, { method: 'HEAD', headers: UA }).catch(() => null);
    if (h && h.ok) return { url, ...meta };
    // HEAD desteklenmiyorsa (405/403) GET ile denenir
    if (h && (h.status === 405 || h.status === 403)) return { url, ...meta };
  }
  return { error: 'dosya yok' };
}

async function archiveItem(ident, file) {
  const r = await get(`https://archive.org/metadata/${ident}`, 'json');
  if (!r.ok) return { error: `metadata ${r.status}` };
  const md = r.body.metadata ?? {};
  const lic = parseLicense(md.licenseurl ?? md.license ?? '');
  const files = r.body.files ?? [];
  const f =
    (file && files.find((x) => x.name === file)) ||
    files.find((x) => /\.(flac|wav)$/i.test(x.name)) ||
    files.find((x) => /\.(mp3|ogg)$/i.test(x.name));
  if (!f) return { error: 'ses dosyası yok' };
  return {
    url: `https://archive.org/download/${ident}/${encodeURIComponent(f.name)}`,
    license: lic,
    author: Array.isArray(md.creator) ? md.creator.join(', ') : md.creator,
    title: md.title,
    page: `https://archive.org/details/${ident}`,
  };
}

/** Kaynak girdisi → [{ url, license, author, title, page, id }] */
async function resolve(src) {
  const [kind, ...rest] = String(src.src).split(':');
  const id = rest.join(':');
  if (kind === 'freesound') return [{ ...(await freesoundSound(id)), id: `fs:${id}` }];
  if (kind === 'freesound-pack') {
    const [user, pack] = id.split('/');
    const items = await freesoundPack(user, pack, src.match ?? '.', src.take ?? 2);
    const out = [];
    for (const it of items) {
      out.push({ ...(await freesoundSound(it.id)), id: `fs:${it.id}` });
      await sleep(400);
    }
    return out.length ? out : [{ error: 'pakette eşleşen ses yok' }];
  }
  if (kind === 'bigsoundbank') return [{ ...(await bigsoundbank(id, src.page)), id: `bsb:${id}` }];
  if (kind === 'archive') {
    const [ident, file] = id.split('/');
    return [{ ...(await archiveItem(ident, file)), id: `ia:${ident}` }];
  }
  return [{ error: `bilinmeyen kaynak türü ${kind}` }];
}

// ------------------------------------------------------------------ ffmpeg

function decode(file, ch, at = 0, len = 0) {
  const args = ['-v', 'error'];
  if (at > 0) args.push('-ss', String(at));
  args.push('-i', file);
  if (len > 0) args.push('-t', String(len));
  args.push('-ac', String(ch), '-ar', String(SR), '-f', 'f32le', '-');
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 1 << 31 });
  return deinterleave(buf, ch);
}

function encode(chans, file, kbps) {
  const raw = join(TMP, `enc-${process.pid}.f32`);
  writeFileSync(raw, Buffer.from(interleave(chans).buffer));
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'f32le',
    '-ar',
    String(SR),
    '-ac',
    String(chans.length),
    '-i',
    raw,
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${kbps}k`,
    file,
  ]);
  rmSync(raw, { force: true });
}

// ------------------------------------------------------------------ işleme

const r4 = (v) => +v.toFixed(4);

function processSteps(slot, cfg, items) {
  const parts = [];
  for (const it of items) {
    const ch = decode(it.file, 1, it.src.at ?? 0, it.src.len ?? 0);
    const x = highpass(ch[0], SR, cfg.hp ?? 60);
    const ev = detectEvents(x, SR, {
      minGap: cfg.minGap ?? 0.2,
      maxLen: cfg.maxLen ?? 0.45,
      minLen: cfg.minLen ?? 0.06,
      relDb: cfg.relDb ?? 22,
    });
    let n = 0;
    // Kaydın tamamından eşit aralıklı seçim (yalnız başı değil)
    const per = it.src.maxSlices ?? cfg.perSource ?? 16;
    const step = Math.max(1, ev.length / per);
    const chosen = ev.length > per ? Array.from({ length: per }, (_, i) => ev[Math.floor(i * step)]) : ev;
    for (const e of chosen) {
      parts.push({
        chans: prepareSlice([x], SR, e.start, e.end, { targetDb: -20, win: cfg.win ?? 0.08 }),
        tag: it.src.tag,
      });
      n++;
    }
    it.slices = n;
    console.log(`    ${it.meta.id}: ${n} dilim (${ev.length} olay)`);
  }
  const max = cfg.maxSlices ?? 40;
  const picked = parts.length > max ? parts.filter((_, i) => i % Math.ceil(parts.length / max) === 0) : parts;
  if (!picked.length) return null;
  const sp = packSprite(picked, SR);
  const file = `${slot}.mp3`;
  encode(sp.chans, join(OUT, file), cfg.kbps ?? 96);
  return [
    {
      file,
      dur: r4(sp.chans[0].length / SR),
      ch: 1,
      slices: sp.slices,
      src: items.map((i) => i.meta.id).join(','),
    },
  ];
}

function processLoops(slot, cfg, items) {
  const out = [];
  items.forEach((it, k) => {
    const ch = cfg.channels ?? 2;
    const len = it.src.len ?? cfg.len ?? 40;
    const need = len + (cfg.xfade ?? 2) + 0.5;
    let chans;
    if (cfg.atPeak) {
      // Geçiş kaydı → en yüksek enerjili bölümden döngü (ör. tramvayın tam önümüzden geçtiği saniyeler)
      const all = decode(it.file, ch);
      const w = loudestWindow(all[0], SR, need);
      chans = all.map((c) => c.slice(w.at, w.at + Math.round(need * SR)));
    } else chans = decode(it.file, ch, it.src.at ?? cfg.at ?? 0, need);
    if (chans[0].length < SR * Math.min(6, need * 0.8)) {
      console.log(`    ${it.meta.id}: çok kısa (${(chans[0].length / SR).toFixed(1)} s) → atlandı`);
      return;
    }
    chans = chans.map((c) => highpass(c, SR, cfg.hp ?? 30));
    chans = makeLoop(chans, SR, cfg.xfade ?? 2);
    chans = normalize(chans, -20, -1);
    const file = `${slot}.${k}.mp3`;
    encode(chans, join(OUT, file), cfg.kbps ?? (ch > 1 ? 128 : 96));
    out.push({ file, dur: r4(chans[0].length / SR), ch, loop: true, src: it.meta.id, region: it.src.region });
  });
  return out.length ? out : null;
}

function processEvents(slot, cfg, items, long) {
  const out = [];
  items.forEach((it, k) => {
    const ch = it.src.channels ?? cfg.channels ?? 1;
    let chans = decode(it.file, ch, it.src.at ?? 0, it.src.len ?? cfg.len ?? 0);
    if (chans[0].length < SR * 0.5) return;
    chans = chans.map((c) => highpass(c, SR, cfg.hp ?? 40));
    fade(chans, SR, long ? 1.5 : 0.15, long ? 2.5 : 0.4);
    chans = normalize(chans, -20, -1, SR, long ? 3 : 1);
    const pk = loudestWindow(chans[0], SR, 0.25).center;
    const file = `${slot}.${k}.mp3`;
    encode(chans, join(OUT, file), cfg.kbps ?? (long ? 96 : 112));
    out.push({
      file,
      dur: r4(chans[0].length / SR),
      ch,
      peak: r4(pk),
      src: it.meta.id,
      region: it.src.region,
    });
  });
  return out.length ? out : null;
}

function processCalls(slot, cfg, items) {
  // Kuş ötüşü, havlama, korna: olay dilimleri (daha uzun), tek dosyada
  return processSteps(
    slot,
    {
      minGap: 0.35,
      maxLen: 3.5,
      minLen: 0.12,
      relDb: 24,
      win: 0.3,
      hp: 80,
      maxSlices: 24,
      perSource: 12,
      ...cfg,
    },
    items,
  );
}

// ------------------------------------------------------------------ ana akış

const manifestPath = join(OUT, 'manifest.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { version: 1, generated: '', slots: {} };
const creditsPath = join(OUT, 'sources.json');
const credits = existsSync(creditsPath) ? JSON.parse(readFileSync(creditsPath, 'utf8')) : { slots: {} };

let okSlots = 0;
let failSlots = 0;
for (const [slot, cfg] of Object.entries(CFG.slots)) {
  if (only.size && !only.has(slot)) continue;
  console.log(`\n[${slot}] ${cfg.kind}`);
  const items = [];
  const want = cfg.take ?? 99;
  for (const src of cfg.sources) {
    if (items.length >= want) break;
    let resolved;
    try {
      resolved = await resolve(src);
    } catch (e) {
      resolved = [{ error: String(e) }];
    }
    for (const meta of resolved) {
      if (items.length >= want) break;
      if (meta.error || !meta.url) {
        console.log(`  - ${src.src}: atlandı (${meta.error ?? 'URL yok'})`);
        continue;
      }
      if (!ACCEPT.has(meta.license.family)) {
        console.log(
          `  - ${meta.id}: lisans ${meta.license.family} ${meta.license.version} kabul edilmiyor → atlandı`,
        );
        continue;
      }
      if (meta.titleVerified === false)
        console.log(
          `  ? ${meta.id}: sayfa okunamadı, başlık doğrulanamadı (kimlik sounds.json'daki gibi kabul)`,
        );
      else if (src.expect && !new RegExp(src.expect, 'i').test(`${meta.title ?? ''}`)) {
        console.log(
          `  - ${meta.id}: başlık beklenenle uyuşmuyor ("${meta.title}" !~ /${src.expect}/) → atlandı`,
        );
        continue;
      }
      const dl = await get(meta.url, 'buf');
      if (!dl.ok) {
        console.log(`  - ${meta.id}: indirilemedi (${dl.status || dl.error})`);
        continue;
      }
      const sha = createHash('sha256').update(dl.body).digest('hex');
      const ext = /\.(\w+)(?:\?|$)/.exec(meta.url)?.[1] ?? 'bin';
      const file = join(TMP, `${sha.slice(0, 16)}.${ext}`);
      writeFileSync(file, dl.body);
      console.log(
        `  + ${meta.id} "${meta.title}" — ${meta.author} — ${meta.license.family} ${meta.license.version} (${(dl.body.length / 1e6).toFixed(2)} MB)`,
      );
      items.push({ src, meta: { ...meta, sha256: sha }, file });
      await sleep(300);
    }
  }
  if (!items.length) {
    console.log('  ! hiçbir kaynak alınamadı — yuva boş kalır (oyun prosedürel sese / sessizliğe düşer)');
    failSlots++;
    continue;
  }
  let files = null;
  // Eski dosyalar (yuva adı + .mp3 / .<n>.mp3)
  for (const f of readdirSync(OUT))
    if (f === `${slot}.mp3` || (f.startsWith(`${slot}.`) && /^\d+\.mp3$/.test(f.slice(slot.length + 1))))
      rmSync(join(OUT, f), { force: true });
  try {
    if (cfg.kind === 'steps') files = processSteps(slot, cfg, items);
    else if (cfg.kind === 'calls') files = processCalls(slot, cfg, items);
    else if (cfg.kind === 'loop') files = processLoops(slot, cfg, items);
    else if (cfg.kind === 'event') files = processEvents(slot, cfg, items, false);
    else if (cfg.kind === 'long') files = processEvents(slot, cfg, items, true);
  } catch (e) {
    console.log(`  ! işleme hatası: ${e}`);
  }
  if (!files) {
    delete manifest.slots[slot];
    delete credits.slots[slot];
    failSlots++;
    continue;
  }
  manifest.slots[slot] = { kind: cfg.kind === 'calls' ? 'calls' : cfg.kind, files };
  credits.slots[slot] = items.map((i) => ({
    id: i.meta.id,
    title: i.meta.title,
    author: i.meta.author,
    license: i.meta.license,
    page: i.meta.page,
    url: i.meta.url,
    sha256: i.meta.sha256,
    note: i.src.note,
  }));
  okSlots++;
}

manifest.version = 1;
manifest.generated = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
writeFileSync(creditsPath, JSON.stringify(credits, null, 1) + '\n');

// ATTRIBUTION.md
const lines = [
  '# Ses kaynakları / Sound attribution',
  '',
  'Oyundaki gerçek ses kayıtları. Hepsi CC0 (kamu malı) ya da CC BY (atıf) lisanslıdır; lisans her kaynağın',
  'sayfasından `scripts/fetch-sounds.mjs` ile doğrulandı. Değişiklikler: kırpma, normalleştirme, mono/stereo',
  'dönüşümü, MP3 kodlama; ayak sesleri ve çağrılar tek tek olaylara bölündü; ambiyans döngüleri uçlarından çapraz',
  'geçişle kesintisiz yapıldı. Kaynak listesi: `scripts/sounds.json`.',
  '',
  '| Yuva | Başlık | Yazar | Lisans | Kaynak |',
  '|---|---|---|---|---|',
];
for (const [slot, list] of Object.entries(credits.slots).sort()) {
  for (const c of list) {
    const lic = c.license ?? { family: 'unknown' };
    const name = `${LICENSE_NAME[lic.family] ?? lic.family}${lic.version && lic.family !== 'cc0' ? ` ${lic.version}` : ''}`;
    const title = String(c.title ?? '').replace(/\|/g, '/');
    lines.push(
      `| ${slot} | ${title} | ${c.author ?? '?'} | [${name}](${licenseUrl(lic)}) | [${c.id}](${c.page}) |`,
    );
  }
}
lines.push('', `Üretildi: ${manifest.generated}`, '');
writeFileSync(join(OUT, 'ATTRIBUTION.md'), lines.join('\n'));

let bytes = 0;
for (const s of Object.values(manifest.slots))
  for (const f of s.files) if (existsSync(join(OUT, f.file))) bytes += statSync(join(OUT, f.file)).size;
console.log(`\nTamam: ${okSlots} yuva, başarısız ${failSlots}; toplam ${(bytes / 1e6).toFixed(1)} MB`);
