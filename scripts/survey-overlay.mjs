#!/usr/bin/env node
// Cephe ölçümü kontrolü: survey/<id>.json öğelerini düzeltilmiş ortofotoların (docs/survey/c) üzerine çizer.
// Çıktı: docs/survey/overlay/<id>_<kenar>_<pano8>.jpg — ölçüm fotoğrafla örtüşene kadar JSON düzeltilir.
// Renkler: kat çizgileri beyaz kesikli, pencere camgöbeği, fransız/kapı mavi, şerit turuncu, balkon sarı
// (döşeme+parapet bandı), cam balkon yeşil çapraz, boru mor, klima beyaz kare, çanak beyaz daire, pano/bant pembe.
// Kullanım: node scripts/survey-overlay.mjs <id> [kenar,...]
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PX = 40;
const MARGIN = 1.5;

async function main() {
  const id = Number(process.argv[2]);
  const only = process.argv[3] ? new Set(process.argv[3].split(',').map(Number)) : null;
  const sv = JSON.parse(
    await readFile(join(root, 'src', 'worlds', 'mertkent', 'survey', `${id}.json`), 'utf8'),
  );
  const fp = JSON.parse(
    await readFile(join(root, 'src', 'worlds', 'mertkent', 'data', 'footprints.json'), 'utf8'),
  );
  const ring = fp[id].ring;
  const cdir = join(root, 'docs', 'survey', 'c');
  const outDir = join(root, 'docs', 'survey', 'overlay');
  await mkdir(outDir, { recursive: true });
  const floorH = sv.floorH ?? 2.95;
  // Balkon ön yüzleri duvar düzleminin önünde → ortofotoda kamera merkezli büyütme (m = D / (D − d))
  const cfg = JSON.parse(await readFile(join(root, 'scripts', 'sv-extra.json'), 'utf8'));
  const idx = JSON.parse(
    await readFile(join(root, 'streetview-src', 'mertkent-2-etap', 'index.json'), 'utf8'),
  );
  const tb = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const T = parseTerrain(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
  const Hg = (x, z) => sampleGrid(T.near, x, z);
  let made = 0;
  for (const spec0 of sv.edges) {
    if (only && !only.has(spec0.edge)) continue;
    let spec = spec0;
    if (spec0.copyOf != null) continue;
    if (!spec.ref) continue;
    const edge = spec.edge;
    const f = spec.ref.replace('_grid', '');
    const a = ring[edge];
    const e = ring[(edge + 1) % ring.length];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
    let meta;
    try {
      meta = await sharp(join(cdir, f)).metadata();
    } catch {
      console.warn(`⚠ kenar ${edge}: ${f} yok`);
      continue;
    }
    const W = meta.width;
    const Hh = meta.height;
    const pref = f.slice(`${id}_${edge}_`.length, -4);
    const sEnt = cfg.survey.find((q) => q.building === id && q.edge === edge && q.pano.startsWith(pref));
    const pano = sEnt && idx.panos.find((q) => q.id === sEnt.pano);
    let D = 20;
    let yCam = 2.5;
    if (pano) {
      const tx = (e[0] - a[0]) / len;
      const tz = (e[1] - a[1]) / len;
      D = Math.abs((pano.x - a[0]) * -tz + (pano.z - a[1]) * tx);
      yCam = Hg(pano.x, pano.z) + 2.5 - sEnt.base;
    }
    const mag = (d) => D / Math.max(1, D - d);
    const magY = (y, d) => yCam + (y - yCam) * mag(d);
    const X = (u) => (u + MARGIN) * PX;
    const Y = (h) => Hh - 1 - (h + 0.5) * PX;
    // Görünen kat aralığı
    const [[k1, y1], [k2, y2]] = spec.cal?.head ?? [
      [0, 2.3],
      [1, 2.3 + floorH],
    ];
    const pitch = k2 !== k1 ? (y2 - y1) / (k2 - k1) : floorH;
    const r = pitch / floorH;
    const head = (j) => y1 + (j - k1) * pitch;
    const floorY = (j) => head(j) - 2.25 * r;
    const rect = (u0, u1, h0, h1, stroke, extra = '') => {
      const x0 = Math.min(X(u0), X(u1));
      const x1 = Math.max(X(u0), X(u1));
      return `<rect x="${x0.toFixed(1)}" y="${Y(h1).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(Y(h0) - Y(h1)).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="2" ${extra}/>`;
    };
    let s = `<svg width="${W}" height="${Hh}" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">`;
    // Köşe kalibrasyonu
    if (spec.cal)
      for (const u of spec.cal.u)
        s += `<line x1="${X(u)}" y1="0" x2="${X(u)}" y2="${Hh}" stroke="#ff3030" stroke-width="2" stroke-dasharray="10 6"/>`;
    // Lento çizgileri (kat başına)
    for (let k = 0; k < sv.storeys; k++) {
      const y = Y(head(k));
      s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#fff" stroke-opacity="0.7" stroke-width="1" stroke-dasharray="4 6"/>`;
      s += `<text x="3" y="${y - 3}" font-size="13" fill="#fff" stroke="#000" stroke-width="0.5">K${k}</text>`;
    }
    const inS = (it, k) => k >= it.s[0] && k <= it.s[1] && !(it.except ?? []).includes(k);
    for (const it of spec.items) {
      switch (it.t) {
        case 'win':
          for (let k = 0; k < sv.storeys; k++)
            if (inS(it, k)) {
              const dy = (k - it.k) * pitch;
              s += rect(
                it.u0,
                it.u1,
                it.y0 + dy,
                it.y1 + dy,
                it.kind === 'french' || it.kind === 'door'
                  ? '#3a7bff'
                  : it.kind === 'small'
                    ? '#a0ffff'
                    : '#00ffff',
              );
              if (it.rail)
                s += rect(
                  it.u0,
                  it.u1,
                  it.y0 + dy,
                  it.y0 + dy + 0.9 * r,
                  '#c0c0ff',
                  'stroke-dasharray="3 3"',
                );
            }
          break;
        case 'strip': {
          const w = it.w ?? 0.24;
          s += rect(it.u - w / 2, it.u + w / 2, it.y0, it.y1, '#ff8a00', 'rx="4"');
          break;
        }
        case 'bal': {
          const M = (y) => magY(y, it.d);
          for (let k = it.s[0]; k <= it.s[1]; k++) {
            const y = floorY(k);
            s += rect(it.u0, it.u1, M(y - 0.2 * r), M(y + 1.0 * r), '#ffd000');
            if ((it.glazed ?? []).includes(k)) {
              const x0 = X(it.u0);
              const x1 = X(it.u1);
              const ya = Y(M(y + r));
              const yb = Y(M(y + pitch - 0.2 * r));
              s += `<line x1="${x0}" y1="${ya}" x2="${x1}" y2="${yb}" stroke="#30ff60" stroke-width="2"/>`;
              s += `<line x1="${x1}" y1="${ya}" x2="${x0}" y2="${yb}" stroke="#30ff60" stroke-width="2"/>`;
            }
          }
          if (it.cap) {
            const y = floorY(it.s[1] + 1);
            s += rect(
              it.u0 - 0.2,
              it.u1 + 0.2,
              M(y - 0.2 * r),
              M(y + 0.5 * r),
              '#ffd000',
              'stroke-dasharray="4 3"',
            );
          }
          break;
        }
        case 'pipe':
          s += `<line x1="${X(it.u)}" y1="${Y(0)}" x2="${X(it.u)}" y2="${Y(head(sv.storeys - 1) + 0.8)}" stroke="#ff30ff" stroke-width="3"/>`;
          break;
        case 'ac':
        case 'dish':
        case 'camera':
        case 'flag': {
          const y = it.y ?? floorY(it.s) + (it.t === 'ac' ? 0.5 : 1.3) * r;
          if (it.t === 'dish')
            s += `<circle cx="${X(it.u)}" cy="${Y(y)}" r="${0.4 * PX}" fill="none" stroke="#fff" stroke-width="2"/>`;
          else
            s += `<rect x="${X(it.u) - 0.4 * PX}" y="${Y(y + 0.3)}" width="${0.8 * PX}" height="${0.6 * PX}" fill="none" stroke="#fff" stroke-width="2"/>`;
          s += `<text x="${X(it.u) - 12}" y="${Y(y) + 4}" font-size="11" fill="#fff">${it.t}</text>`;
          break;
        }
        case 'band':
          s += rect(it.u0 ?? spec.cal?.u[0] ?? 0, it.u1 ?? spec.cal?.u[1] ?? len, it.y0, it.y1, '#ff4fa0');
          break;
        case 'panel':
          s += rect(it.u0, it.u1, it.y0, it.y1, '#ff4fa0', 'stroke-dasharray="8 4"');
          break;
        case 'entrance':
          s += rect(it.u0, it.u1, floorY(0), floorY(0) + 2.4 * r, '#30ff60');
          break;
        case 'sign': {
          // Tabela: sarı kutu + yazı (ilk satır)
          s += rect(it.u0, it.u1, it.y0, it.y1, '#ffee00', 'stroke-dasharray="2 2"');
          const txt = String(it.text ?? '')
            .split('\n')[0]
            .replace(/[<&>]/g, '');
          s += `<text x="${Math.min(X(it.u0), X(it.u1)) + 2}" y="${Y(it.y1) - 3}" font-size="12" fill="#ffee00" stroke="#000" stroke-width="0.4">${txt}</text>`;
          break;
        }
        case 'awning': {
          const drop = it.drop ?? 0.4;
          s += rect(it.u0, it.u1, magY(it.y - drop, it.d ?? 1), it.y, '#ff6ad5');
          break;
        }
        case 'proj': {
          // Çıkma: ön yüz (derinlikle büyütülmüş) + ön yüz pencereleri
          const M = (y) => magY(y, it.d ?? 0.6);
          s += rect(it.u0, it.u1, M(it.y0), M(it.y1), '#b070ff');
          for (const w of it.wins ?? [])
            s += rect(w.u0, w.u1, M(w.y0), M(w.y1), '#00ffff', 'stroke-dasharray="3 2"');
          break;
        }
        case 'groove':
          if (it.dir === 'v') s += rect(it.u - 0.03, it.u + 0.03, it.y0, it.y1, '#999');
          else s += rect(it.u0, it.u1, it.y - 0.03, it.y + 0.03, '#999');
          break;
        case 'vent':
          for (let k = 0; k < Math.max(1, it.count ?? 1); k++)
            s += `<circle cx="${X(it.u + k * (it.spacing ?? 0))}" cy="${Y(it.y)}" r="${((it.s ?? 0.15) / 2) * PX}" fill="none" stroke="#fff" stroke-width="1.5"/>`;
          break;
      }
    }
    s += `<text x="8" y="22" font-size="18" fill="#ffe000" stroke="#000" stroke-width="0.6">${f} · kenar ${edge} len ${len.toFixed(2)} m · ${spec.seen} · kat aralığı ${pitch.toFixed(2)} · kamera D ${D.toFixed(1)} m</text></svg>`;
    await sharp(join(cdir, f))
      .composite([{ input: Buffer.from(s), left: 0, top: 0 }])
      .jpeg({ quality: 85 })
      .toFile(join(outDir, `${id}_${edge}_ov.jpg`));
    made++;
  }
  console.log(`✓ ${made} bindirme → docs/survey/overlay/`);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
