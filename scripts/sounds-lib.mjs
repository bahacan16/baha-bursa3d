// Ses işleme yardımcıları (saf fonksiyonlar; fetch-sounds.mjs ve birim testleri kullanır).
// Tüm işlem ham PCM üzerinde (Float32Array, kanal başına); ffmpeg yalnız çözme/kodlama için.

/** CC lisans URL'si / adı → { family, version } (family: cc0 | by | by-sa | by-nc | by-nd | sampling+ | pdm | unknown) */
export function parseLicense(s) {
  const t = String(s ?? '').toLowerCase();
  if (/publicdomain\/zero|creative commons 0|\bcc0\b/.test(t)) return { family: 'cc0', version: '1.0' };
  if (/publicdomain\/mark/.test(t)) return { family: 'pdm', version: '1.0' };
  const m = /licenses\/([a-z+-]+)\/(\d\.\d)/.exec(t);
  if (m) return { family: m[1], version: m[2] };
  if (/attribution[- ]noncommercial|\bby-nc\b/.test(t)) return { family: 'by-nc', version: '' };
  if (/attribution[- ]sharealike|\bby-sa\b/.test(t)) return { family: 'by-sa', version: '' };
  if (/sampling\+|sampling plus/.test(t)) return { family: 'sampling+', version: '' };
  if (/attribution/.test(t))
    return { family: 'by', version: /4\.0/.test(t) ? '4.0' : /3\.0/.test(t) ? '3.0' : '' };
  return { family: 'unknown', version: '' };
}

export const LICENSE_NAME = {
  cc0: 'CC0 1.0 (Kamu malı)',
  pdm: 'Public Domain Mark 1.0',
  by: 'CC BY',
  'by-sa': 'CC BY-SA',
};

export function licenseUrl(l) {
  if (l.family === 'cc0') return 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (l.family === 'pdm') return 'https://creativecommons.org/publicdomain/mark/1.0/';
  return `https://creativecommons.org/licenses/${l.family}/${l.version || '4.0'}/`;
}

/**
 * Freesound ses sayfası HTML'inden: önizleme MP3 URL'si, lisans, başlık, kullanıcı.
 * Birden çok CC bağlantısı varsa "License" sözcüğünden sonraki ilk bağlantı esas alınır.
 */
export function parseFreesoundPage(html, finalUrl = '') {
  const prev =
    /https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-hq\.mp3/.exec(html)?.[0] ??
    /https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-lq\.mp3/.exec(html)?.[0] ??
    null;
  const ccRe =
    /https?:\/\/creativecommons\.org\/(?:publicdomain\/(?:zero|mark)\/1\.0|licenses\/[a-z+-]+\/\d\.\d)\/?/gi;
  const all = [...html.matchAll(ccRe)].map((m) => ({ url: m[0], at: m.index ?? 0 }));
  let license = null;
  const fams = new Set(all.map((a) => parseLicense(a.url).family));
  if (fams.size === 1) license = parseLicense(all[0].url);
  else if (all.length) {
    const li = html.search(/licen[cs]e/i);
    const after = all.find((a) => a.at > li);
    license = li >= 0 && after ? parseLicense(after.url) : null;
  }
  // Bağlantı yoksa: "License" sözcüğünün hemen ardındaki metin (etiketler atılarak). Emin olunamazsa null →
  // lisans bilinmiyor → kaynak atlanır (yanlışlıkla NC bir kaydı almamak için).
  if (!license) {
    for (const m of html.matchAll(/licen[cs]e/gi)) {
      const win = html
        .slice(m.index ?? 0, (m.index ?? 0) + 700)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      if (/non-?commercial/i.test(win)) license = { family: 'by-nc', version: '' };
      else if (/creative commons 0|\bcc0\b|public domain dedication/i.test(win))
        license = { family: 'cc0', version: '1.0' };
      else if (/attribution/i.test(win)) license = parseLicense(win);
      if (license) break;
    }
  }
  const title =
    /<meta property="og:title" content="([^"]+)"/.exec(html)?.[1] ??
    /<title>\s*Freesound - (?:"?)([^<]+?)(?:"?) by [^<]+<\/title>/.exec(html)?.[1] ??
    null;
  const user =
    /freesound\.org\/people\/([^/]+)\/sounds\//.exec(finalUrl)?.[1] ??
    /\/people\/([^/"]+)\/sounds\/\d+/.exec(html)?.[1] ??
    null;
  return { preview: prev, license, title: title ? decodeHtml(title) : null, user };
}

export function decodeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Paket sayfasından ses kimlikleri ve (bulunabilirse) adları. Ad bulunamazsa '' — çağıran ses sayfasından okur.
 */
export function parseFreesoundPack(html, user) {
  const out = new Map();
  const u = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`/people/${u}/sounds/(\\d+)/"[^>]*>\\s*([^<]{2,200}?)\\s*<`, 'g');
  for (const m of html.matchAll(named)) if (!out.get(m[1])) out.set(m[1], decodeHtml(m[2]).trim());
  const titled = new RegExp(`/people/${u}/sounds/(\\d+)/"[^>]*title="([^"]{2,200})"`, 'g');
  for (const m of html.matchAll(titled)) if (!out.get(m[1])) out.set(m[1], decodeHtml(m[2]).trim());
  for (const m of html.matchAll(new RegExp(`/people/${u}/sounds/(\\d+)/`, 'g')))
    if (!out.has(m[1])) out.set(m[1], '');
  return [...out].map(([id, name]) => ({ id, name }));
}

// ---------------------------------------------------------------- DSP

export function rms(x, a = 0, b = x.length) {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

export function peak(x, a = 0, b = x.length) {
  let p = 0;
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** En yüksek enerjili pencerenin RMS'i ve konumu. */
export function loudestWindow(x, sr, winSec) {
  const w = Math.max(1, Math.min(x.length, Math.round(winSec * sr)));
  let s = 0;
  for (let i = 0; i < w; i++) s += x[i] * x[i];
  let best = s;
  let at = 0;
  const hop = Math.max(1, Math.floor(w / 8));
  for (let i = w; i < x.length; i++) {
    s += x[i] * x[i] - x[i - w] * x[i - w];
    if ((i - w) % hop === 0 && s > best) {
      best = s;
      at = i - w + 1;
    }
  }
  return { rms: Math.sqrt(Math.max(0, best) / w), at, center: (at + w / 2) / sr };
}

export const dbToLin = (d) => Math.pow(10, d / 20);
export const linToDb = (v) => 20 * Math.log10(Math.max(1e-12, v));

/** Birinci dereceden yüksek geçiren (gürültü/uğultu temizliği). */
export function highpass(x, sr, fc) {
  const rc = 1 / (2 * Math.PI * fc);
  const dt = 1 / sr;
  const a = rc / (rc + dt);
  const y = new Float32Array(x.length);
  let px = 0;
  let py = 0;
  for (let i = 0; i < x.length; i++) {
    py = a * (py + x[i] - px);
    px = x[i];
    y[i] = py;
  }
  return y;
}

/** 5 ms adımlı enerji zarfı (dB). */
export function envelopeDb(x, sr, hopSec = 0.005) {
  const hop = Math.max(1, Math.round(sr * hopSec));
  const win = hop * 2;
  const n = Math.max(0, Math.floor((x.length - win) / hop));
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * hop;
    for (let j = 0; j < win; j++) s += x[o + j] * x[o + j];
    env[i] = 10 * Math.log10(s / win + 1e-12);
  }
  return { env, hop };
}

function percentile(a, p) {
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
}

/**
 * Olay (adım, ötüş, havlama…) başlangıç tespiti ve dilimleme.
 * Eşik: gürültü tabanı (%20 dilim) + 8 dB'den ve en yüksek düzeyin `relDb` altından büyük olanı.
 * @returns [{ start, end }] örnek indisleri
 */
export function detectEvents(
  x,
  sr,
  { minGap = 0.2, maxLen = 0.45, minLen = 0.08, relDb = 22, tailDb = 5, preRoll = 0.012, rise = 5 } = {},
) {
  const { env, hop } = envelopeDb(x, sr);
  const n = env.length;
  if (n < 10) return [];
  const floor = percentile(env, 0.2);
  const top = percentile(env, 0.998);
  const thr = Math.max(floor + 8, top - relDb);
  const gapF = Math.round(minGap / (hop / sr));
  const out = [];
  let last = -1e9;
  for (let i = 4; i < n; i++) {
    if (!(env[i] >= thr && env[i - 1] < thr)) continue;
    const before = Math.min(env[i - 1], env[i - 2], env[i - 3], env[i - 4]);
    if (env[i] - before < rise) continue;
    if (i - last < gapF) continue;
    last = i;
    // Başlangıcı geri izle (eşik − 10 dB, en çok 30 ms)
    let s = i;
    for (let k = 0; k < 6 && s > 0 && env[s - 1] > thr - 10; k++) s--;
    const start = Math.max(0, s * hop - Math.round(preRoll * sr));
    out.push({ i, start });
  }
  const slices = [];
  for (let k = 0; k < out.length; k++) {
    const { i, start } = out[k];
    const nextStart = k + 1 < out.length ? out[k + 1].start : x.length;
    const maxEnd = Math.min(x.length, start + Math.round(maxLen * sr), nextStart - Math.round(0.01 * sr));
    const minEnd = start + Math.round(minLen * sr);
    // Kuyruk: taban + tailDb altına 30 ms boyunca inince bitir
    let end = maxEnd;
    let quiet = 0;
    for (let f = i; f * hop < maxEnd; f++) {
      if (f >= n) break;
      if (env[f] < floor + tailDb) {
        quiet++;
        if (quiet >= 6 && f * hop >= minEnd) {
          end = Math.min(maxEnd, f * hop);
          break;
        }
      } else quiet = 0;
    }
    if (end - start < Math.round(minLen * sr * 0.6)) continue;
    // Çok zayıf olayları at (en yüksekten 20 dB aşağı)
    if (linToDb(peak(x, start, end)) < linToDb(peak(x)) - 24) continue;
    slices.push({ start, end });
  }
  return slices;
}

/** Dilimi kopyala, uçlarına rampa uygula, RMS'i (en yüksek `win` saniyelik pencere) hedefe normalleştir. */
export function prepareSlice(
  chans,
  sr,
  start,
  end,
  { targetDb = -20, win = 0.08, fadeIn = 0.002, fadeOut = 0.025, ceiling = -1 } = {},
) {
  const out = chans.map((c) => c.slice(start, end));
  const len = end - start;
  const fi = Math.min(len, Math.round(fadeIn * sr));
  const fo = Math.min(len, Math.round(fadeOut * sr));
  for (const c of out) {
    for (let i = 0; i < fi; i++) c[i] *= i / fi;
    for (let i = 0; i < fo; i++) c[len - 1 - i] *= i / fo;
  }
  const mono = out[0];
  const lw = loudestWindow(mono, sr, win);
  let g = dbToLin(targetDb) / Math.max(1e-6, lw.rms);
  const pk = Math.max(...out.map((c) => peak(c))) * g;
  if (pk > dbToLin(ceiling)) g *= dbToLin(ceiling) / pk;
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= g;
  return out;
}

/**
 * Dilimleri tek dosyada art arda dizer (başta 50 ms, aralarda 80 ms sessizlik: MP3 kod çözücü gecikmesi ±25 ms
 * dilimleri kesmesin). @returns { chans, slices: [[start, dur, tag?]] } saniye
 */
export function packSprite(parts, sr, { lead = 0.05, gap = 0.08 } = {}) {
  const ch = parts[0]?.chans.length ?? 1;
  const L = Math.round(lead * sr);
  const G = Math.round(gap * sr);
  let total = L;
  for (const p of parts) total += p.chans[0].length + G;
  const chans = Array.from({ length: ch }, () => new Float32Array(total));
  const slices = [];
  let o = L;
  for (const p of parts) {
    for (let c = 0; c < ch; c++) chans[c].set(p.chans[Math.min(c, p.chans.length - 1)], o);
    const s = [+(o / sr).toFixed(4), +(p.chans[0].length / sr).toFixed(4)];
    if (p.tag) s.push(p.tag);
    slices.push(s);
    o += p.chans[0].length + G;
  }
  return { chans, slices };
}

/**
 * Kesintisiz döngü: kuyruğun son `xfade` saniyesi başa eşit güçlü çapraz geçişle karıştırılır.
 * Çıktı uzunluğu L − X; son örnekten ilk örneğe geçiş süreklidir.
 */
export function makeLoop(chans, sr, xfade = 2) {
  const L = chans[0].length;
  const X = Math.min(Math.round(xfade * sr), Math.floor(L / 3));
  return chans.map((c) => {
    const out = new Float32Array(L - X);
    out.set(c.subarray(0, L - X));
    for (let t = 0; t < X; t++) {
      const a = (t / X) * (Math.PI / 2);
      out[t] = c[t] * Math.sin(a) + c[L - X + t] * Math.cos(a);
    }
    return out;
  });
}

/** Tüm tamponu RMS hedefine ölçekle (tepe sınırı ile). */
export function normalize(chans, targetDb = -20, ceiling = -1, sr = 44100, win = 0) {
  const ref = win > 0 ? loudestWindow(chans[0], sr, win).rms : rms(chans[0]);
  let g = dbToLin(targetDb) / Math.max(1e-6, ref);
  const pk = Math.max(...chans.map((c) => peak(c))) * g;
  if (pk > dbToLin(ceiling)) g *= dbToLin(ceiling) / pk;
  return chans.map((c) => c.map((v) => v * g));
}

export function fade(chans, sr, inSec, outSec) {
  for (const c of chans) {
    const n = c.length;
    const fi = Math.min(n, Math.round(inSec * sr));
    const fo = Math.min(n, Math.round(outSec * sr));
    for (let i = 0; i < fi; i++) c[i] *= i / fi;
    for (let i = 0; i < fo; i++) c[n - 1 - i] *= i / fo;
  }
  return chans;
}

/** Karıştırılmış çok kanallı f32 → kanal dizileri */
export function deinterleave(buf, ch) {
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const n = Math.floor(f.length / ch);
  const out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out[c][i] = f[i * ch + c];
  return out;
}

export function interleave(chans) {
  const ch = chans.length;
  const n = chans[0].length;
  const f = new Float32Array(n * ch);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) f[i * ch + c] = chans[c][i];
  return f;
}
