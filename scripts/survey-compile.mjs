#!/usr/bin/env node
// Cephe ölçümlerini (survey/<id>.json, ortofoto "görünen" koordinatları) gerçek metreye çevirir:
// → src/worlds/mertkent/data/facades.json  { <id>: CompiledBlock }  (oyun bu dosyayı kullanır)
//
// Dönüşüm (kenar başına, referans ortofotonun kamera pozu ile):
// - u: iki duvar köşesi (cal.u) → [0, len] doğrusal.
// - Kat yüksekliği: bloktaki fotoğraflı kenarlarda (görünen kat aralığı × yatay ölçek) medyanı — derinlik hatası
//   yatay ve düşeyi aynı oranda ölçekler, bu yüzden ikisi tutarlı olmalı.
// - Yükseklikler: kamera yüksekliği etrafında homotetik ölçek (sY = kat yüksekliği / görünen kat aralığı);
//   zemin kat kotu (groundRaise) = lento − kat·H − HEAD, kenarların medyanı.
// - Balkon ön yüzleri duvarın d önünde → görünen genişlik kamera ayağı etrafında D/(D−d) büyür; geri alınır.
// Kullanım: node --experimental-strip-types scripts/survey-compile.mjs [id,...]
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTerrain, sampleGrid } from '../src/env/terrain.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEAD = 2.25; // lento, kat döşemesinden
const CAM_H = 2.5;
const median = (a) => {
  const s = [...a].sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : NaN;
};
const r2 = (v) => Math.round(v * 100) / 100;

async function main() {
  const sdir = join(root, 'src', 'worlds', 'mertkent', 'survey');
  const ids = process.argv[2]
    ? process.argv[2].split(',').map(Number)
    : (await readdir(sdir)).filter((f) => /^\d+\.json$/.test(f)).map((f) => Number(f.slice(0, -5)));
  const fp = JSON.parse(
    await readFile(join(root, 'src', 'worlds', 'mertkent', 'data', 'footprints.json'), 'utf8'),
  );
  const cfg = JSON.parse(await readFile(join(root, 'scripts', 'sv-extra.json'), 'utf8'));
  const idx = JSON.parse(
    await readFile(join(root, 'streetview-src', 'mertkent-2-etap', 'index.json'), 'utf8'),
  );
  const tb = await readFile(join(root, 'public', 'data', 'terrain.bin'));
  const T = parseTerrain(tb.buffer.slice(tb.byteOffset, tb.byteOffset + tb.byteLength));
  const H = (x, z) => sampleGrid(T.near, x, z);
  const outPath = join(root, 'src', 'worlds', 'mertkent', 'data', 'facades.json');
  let out = {};
  try {
    out = JSON.parse(await readFile(outPath, 'utf8'));
  } catch {
    /* yeni */
  }
  for (const id of ids) {
    const sv = JSON.parse(await readFile(join(sdir, `${id}.json`), 'utf8'));
    const ring = fp[id]?.ring;
    if (!ring) {
      console.warn(`⚠ ${id}: footprints.json'da yok`);
      continue;
    }
    const baseRun = Math.min(...ring.map((p) => H(p[0], p[1])));
    const len = (e) => {
      const a = ring[e];
      const b = ring[(e + 1) % ring.length];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    // Kenar pozları
    const pose = (spec) => {
      const e = spec.edge;
      const a = ring[e];
      const b = ring[(e + 1) % ring.length];
      const L = len(e);
      const f = spec.ref?.replace('_grid', '').replace(/\.jpg$/, '') ?? '';
      const m = f.match(/^(\d+)_(\d+)_(.+)$/);
      let ent = null;
      if (m)
        ent = cfg.survey.find(
          (q) => q.building === Number(m[1]) && q.edge === Number(m[2]) && q.pano.startsWith(m[3]),
        );
      const pano = ent && idx.panos.find((q) => q.id === ent.pano);
      const base = ent?.base ?? baseRun;
      if (!pano || Number(m?.[2]) !== e) return { D: 1e6, uF: L / 2, yCam: CAM_H, base };
      const tx = (b[0] - a[0]) / L;
      const tz = (b[1] - a[1]) / L;
      return {
        D: Math.abs((pano.x - a[0]) * -tz + (pano.z - a[1]) * tx),
        uF: (pano.x - a[0]) * tx + (pano.z - a[1]) * tz,
        yCam: H(pano.x, pano.z) + CAM_H - base,
        base,
      };
    };
    // 1) Kat yüksekliği: fotoğraflı kenarlarda görünen aralık × yatay ölçek
    const fhs = [];
    for (const s of sv.edges) {
      if (!s.cal || s.seen === 'none' || s.copyOf != null) continue;
      const [[k1, y1], [k2, y2]] = s.cal.head;
      if (k1 === k2) continue;
      const pitch = (y2 - y1) / (k2 - k1);
      const sU = len(s.edge) / (s.cal.u[1] - s.cal.u[0]);
      if (len(s.edge) >= 6) fhs.push({ fh: pitch * sU, w: len(s.edge) });
    }
    const FH = sv.floorH ?? (fhs.length ? median(fhs.map((q) => q.fh)) : 2.95);
    // 2) Kenar dönüşümleri + zemin kat kotu tahmini
    const gRs = [];
    const conv = new Map();
    for (const s of sv.edges) {
      if (!s.cal || s.copyOf != null) continue;
      const [[k1, y1], [k2, y2]] = s.cal.head;
      const pitch = k1 !== k2 ? (y2 - y1) / (k2 - k1) : FH;
      const sY = FH / pitch;
      const P = pose(s);
      const L = len(s.edge);
      const sU = L / (s.cal.u[1] - s.cal.u[0]);
      const unseen = s.seen === 'none';
      const U = (u) => (u - s.cal.u[0]) * sU;
      const Ud = (u, d) => (unseen ? U(u) : U(P.uF + (u - P.uF) * ((P.D - d) / P.D)));
      const headApp = (k) => y1 + (k - k1) * pitch;
      // Görünen y → tabandan gerçek (bu kenarın kat çizgilerine göre)
      const Yabs = (y) => P.yCam + (y - P.yCam) * sY + (P.base - baseRun);
      const rel = (y, k) => HEAD + (y - headApp(k)) * sY; // kat k döşemesinden
      if (!unseen) gRs.push(Yabs(y1) - k1 * FH - HEAD);
      conv.set(s.edge, { U, Ud, rel, headApp, sY, L, Yabs, k1, y1 });
    }
    const gR = sv.groundRaise ?? (gRs.length ? median(gRs) : 0.6);
    const storeysArr = (s, except = []) => {
      const a = [];
      for (let k = s[0]; k <= s[1]; k++) if (!except.includes(k)) a.push(k);
      return a;
    };
    const compileEdge = (s) => {
      const c = conv.get(s.edge);
      if (!c) return [];
      // Mutlak görünen y → tabandan gerçek: kat çizgilerine göre (gR ile tutarlı)
      const absY = (y) => gR + HEAD + (y - c.headApp(0)) * c.sY;
      const items = [];
      for (const it of s.items ?? []) {
        switch (it.t) {
          case 'win':
            items.push({
              t: 'win',
              u0: r2(c.U(Math.min(it.u0, it.u1))),
              u1: r2(c.U(Math.max(it.u0, it.u1))),
              sill: r2(c.rel(it.y0, it.k)),
              head: r2(c.rel(it.y1, it.k)),
              storeys: storeysArr(it.s, it.except),
              kind: it.kind ?? 'std',
              rail: !!it.rail,
              split: it.split ?? 2,
              box: !!it.box,
            });
            break;
          case 'strip':
            items.push({
              t: 'strip',
              u: r2(c.U(it.u)),
              w: r2((it.w ?? 0.24) * c.sY),
              y0: r2(absY(Math.min(it.y0, it.y1))),
              y1: r2(absY(Math.max(it.y0, it.y1))),
            });
            break;
          case 'bal': {
            const a = c.Ud(Math.min(it.u0, it.u1), it.d ?? 1.4);
            const b = c.Ud(Math.max(it.u0, it.u1), it.d ?? 1.4);
            items.push({
              t: 'bal',
              u0: r2(a),
              u1: r2(b),
              d: it.d ?? 1.4,
              storeys: storeysArr(it.s),
              glazed: it.glazed ?? [],
              tint: it.tint ?? {},
              cap: !!it.cap,
              sides: it.sides ?? 'open',
              inset: it.inset ?? null,
            });
            break;
          }
          case 'pipe':
            items.push({ t: 'pipe', u: r2(it.off ? c.Ud(it.u, it.off) : c.U(it.u)), off: it.off ?? 0.08 });
            break;
          case 'ac':
          case 'dish':
          case 'camera':
          case 'flag':
            items.push({
              t: it.t,
              u: r2(it.onBal ? c.Ud(it.u, 1.4) : c.U(it.u)),
              s: it.s,
              y: it.y != null ? r2(absY(it.y) - (gR + it.s * FH)) : null,
              onBal: !!it.onBal,
            });
            break;
          case 'band':
          case 'panel':
            items.push({
              t: it.t,
              u0: r2(it.u0 != null ? c.U(it.u0) : 0),
              u1: r2(it.u1 != null ? c.U(it.u1) : c.L),
              y0: r2(absY(Math.min(it.y0, it.y1))),
              y1: r2(absY(Math.max(it.y0, it.y1))),
              color: it.color,
              proud: it.proud ?? 0,
            });
            break;
          case 'entrance':
            items.push({
              t: 'entrance',
              u0: r2(c.U(Math.min(it.u0, it.u1))),
              u1: r2(c.U(Math.max(it.u0, it.u1))),
              kind: it.kind,
              canopy: !!it.canopy,
              sign: it.sign ?? null,
              steps: it.steps ?? null,
            });
            break;
        }
      }
      return items;
    };
    const compiled = new Map();
    for (const s of sv.edges) if (s.copyOf == null) compiled.set(s.edge, compileEdge(s));
    const edges = [];
    for (const s of sv.edges) {
      let items = compiled.get(s.edge) ?? [];
      if (s.copyOf != null) {
        const src = compiled.get(s.copyOf) ?? [];
        const k = len(s.edge) / len(s.copyOf);
        const M = (u) => (s.mirror ? len(s.edge) - u * k : u * k);
        items = src.map((it) => {
          const o = { ...it };
          if ('u' in o) o.u = r2(M(o.u));
          if ('u0' in o) {
            const a = M(o.u0);
            const b = M(o.u1);
            o.u0 = r2(Math.min(a, b));
            o.u1 = r2(Math.max(a, b));
          }
          return o;
        });
      }
      edges.push({ edge: s.edge, len: r2(len(s.edge)), seen: s.seen, items });
    }
    out[id] = {
      id,
      name: sv.name ?? null,
      ring,
      storeys: sv.storeys,
      floorH: r2(FH),
      groundRaise: r2(gR),
      roof: sv.roof,
      colors: sv.colors ?? {},
      edges,
      notes: sv.notes ?? [],
    };
    console.log(
      `${id}: ${edges.length} kenar, kat ${sv.storeys} × ${FH.toFixed(2)} m (örnekler ${fhs.map((q) => q.fh.toFixed(2)).join(' ')}), zemin kat +${gR.toFixed(2)} m (örnekler ${gRs.map((v) => v.toFixed(2)).join(' ')})`,
    );
  }
  await writeFile(outPath, JSON.stringify(out) + '\n');
  console.log(`→ ${outPath}`);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
