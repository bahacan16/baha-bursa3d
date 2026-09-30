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
  // SURVEY_OUT: deneme derlemesi için başka dosyaya yaz (repo verisine dokunmadan)
  const outPath = process.env.SURVEY_OUT ?? join(root, 'src', 'worlds', 'mertkent', 'data', 'facades.json');
  let out = {};
  try {
    out = JSON.parse(await readFile(outPath, 'utf8'));
  } catch {
    /* yeni */
  }
  // SURVEY_DIR: ölçüm dosyalarını başka klasörden oku (sentetik deneme)
  const sdirRead = process.env.SURVEY_DIR ?? sdir;
  for (const id of ids) {
    const sv = JSON.parse(await readFile(join(sdirRead, `${id}.json`), 'utf8'));
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
      // trueCoords: ölçümler zaten gerçek derinlikte (çift pano stereo) → balkon büyütmesi geri alınmaz
      if (!pano || Number(m?.[2]) !== e || sv.trueCoords) return { D: 1e6, uF: L / 2, yCam: CAM_H, base };
      const tx = (b[0] - a[0]) / L;
      const tz = (b[1] - a[1]) / L;
      // v7: cal.dist — ortofoto eski bir taban izi üzerinde üretildiyse (kamera–cephe uzaklığı farklı) derinlik
      // düzeltmeleri (balkon d, behind, lamba, tabela off …) ortofotonun üretildiği uzaklıkla yapılır
      const dist = Number(spec.cal?.dist);
      return {
        D: dist > 0.5 ? dist : Math.abs((pano.x - a[0]) * -tz + (pano.z - a[1]) * tx),
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
      // Duvarın d önündeki öğeler (balkon önü bez / pankart): görünen boy kamera ufku etrafında D/(D−d) büyür
      const yCamRel = P.yCam + (P.base - baseRun);
      const depthK = (d) => (unseen ? 1 : (P.D - d) / P.D);
      conv.set(s.edge, { U, Ud, rel, headApp, sY, L, Yabs, k1, y1, yCamRel, depthK, D: P.D });
    }
    const gR = sv.groundRaise ?? (gRs.length ? median(gRs) : 0.6);
    const storeysArr = (s, except = []) => {
      const a = [];
      for (let k = s[0]; k <= s[1]; k++) if (!except.includes(k)) a.push(k);
      return a;
    };
    // Kat anahtarları: "K3" → "3" ("*" korunur)
    const keyK = (m) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [String(k).replace(/^K/, ''), v]));
    // v8: kesim yüzü kenarları (cutEdges) kendi dönüşümünü (c.absY / c.floorAt) ve dünya doğrusunu (uW) getirir
    const compileEdge = (s, c = conv.get(s.edge), uW = null) => {
      if (!c) return [];
      // Mutlak görünen y → tabandan gerçek: kat çizgilerine göre (gR ile tutarlı)
      const absY = c.absY ?? ((y) => gR + HEAD + (y - c.headApp(0)) * c.sY);
      // Duvarın d önündeki düzlemde görünen y → gerçek (kamera yüksekliği etrafında derinlik düzeltmesi)
      const absYd = (y, d) => c.yCamRel + (absY(y) - c.yCamRel) * c.depthK(d);
      const ring0 = ring;
      /** Dünya noktasının kenar boyunca gerçek u'su */
      const uWorld =
        uW ??
        ((x, z) => {
          const a = ring0[s.edge];
          const b = ring0[(s.edge + 1) % ring0.length];
          const Le = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / Le;
        });
      // v7: düzensiz düşey kaplama derzleri (clad.us, görünen) → gerçek u
      const cladOf = (cl) => (cl?.us?.length ? { ...cl, us: cl.us.map((u) => r2(c.U(u))) } : cl);
      // v7: tabela yazı alanları (sign / blade / vinyl / roofsign / screen): capH görünen harf boyu → gerçek (düzlem d)
      const textOf = (it, d = 0) => ({
        text: it.text ?? '',
        lines: it.lines ?? null,
        bg: it.bg ?? null,
        fg: it.fg ?? '#ffffff',
        border: it.border ?? null,
        font: it.font ?? 'sans',
        bold: it.bold !== false,
        lit: !!it.lit,
        ...(it.shape ? { shape: it.shape } : {}),
        ...(it.glyphs ? { glyphs: it.glyphs, join: it.join ?? null } : {}),
        ...(it.capH ? { capH: r2(it.capH * c.sY * c.depthK(d)) } : {}),
        ...(it.align ? { align: it.align } : {}),
      });
      const items = [];
      for (const it of s.items ?? []) {
        switch (it.t) {
          case 'win': {
            // Loca arka duvarındaki pencere (behind: cephe düzleminin kaç m gerisinde): ortofoto ön düzleme göre
            // düzeltilmiş → arka düzlemin perspektif ölçeğine çevrilir (kamera ufku etrafında D/(D+behind))
            const dB = it.behind ? -Math.abs(it.behind) : 0;
            const Uw = (u) => (dB ? c.Ud(u, dB) : c.U(u));
            const relW = (y, k) =>
              dB ? (c.floorAt ? absYd(y, dB) - c.floorAt(k) : absYd(y, dB) - gR - k * FH) : c.rel(y, k);
            items.push({
              t: 'win',
              u0: r2(Uw(Math.min(it.u0, it.u1))),
              u1: r2(Uw(Math.max(it.u0, it.u1))),
              sill: r2(relW(it.y0, it.k)),
              head: r2(relW(it.y1, it.k)),
              storeys: storeysArr(it.s, it.except),
              kind: it.kind ?? 'std',
              rail: !!it.rail,
              split: it.split ?? 2,
              box: !!it.box,
              ...(it.grille ? { grille: keyK(it.grille) } : {}),
              ...(it.lower ? { lower: it.lower, lowerC: it.lowerC ?? null } : {}),
              ...(it.grilleC ? { grilleC: it.grilleC } : {}),
              ...(it.frameC ? { frameC: it.frameC } : {}),
              ...(it.tint ? { tint: it.tint } : {}),
              ...(it.surround ? { surround: it.surround } : {}),
              ...(it.curt
                ? {
                    curt: Object.fromEntries(
                      Object.entries(it.curt).map(([k, v]) => [String(k).replace(/^K/, ''), v]),
                    ),
                  }
                : {}),
              ...(it.shut
                ? {
                    shut: Object.fromEntries(
                      Object.entries(it.shut).map(([k, v]) => [String(k).replace(/^K/, ''), v]),
                    ),
                  }
                : {}),
              ...(it.shutC ? { shutC: it.shutC } : {}),
              ...(it.curtC ? { curtC: keyK(it.curtC) } : {}),
              ...(it.curtF ? { curtF: keyK(it.curtF) } : {}),
              // Yatay kayıtlar: referans kattaki görünen y → kat döşemesinden gerçek yükseklik
              ...(it.hbars?.length ? { hbars: it.hbars.map((y) => r2(relW(y, it.k))) } : {}),
              ...(it.stair ? { stair: true } : {}),
              // v7: yuvarlak pencere (oculus: u0..u1 × y0..y1 kutusunda elips), desenli cam folyo
              ...(it.shape === 'round' ? { shape: 'round' } : {}),
              ...(it.film?.color ? { film: { color: it.film.color, pattern: it.film.pattern ?? null } } : {}),
            });
            break;
          }
          case 'pilaster': {
            const pu0 = it.u != null ? it.u - (it.w ?? 0.4) / 2 : Math.min(it.u0, it.u1);
            const pu1 = it.u != null ? it.u + (it.w ?? 0.4) / 2 : Math.max(it.u0, it.u1);
            items.push({
              t: 'pilaster',
              u0: r2(c.U(pu0)),
              u1: r2(c.U(pu1)),
              y0: it.s ? null : r2(absY(Math.min(it.y0, it.y1))),
              y1: it.s ? null : r2(absY(Math.max(it.y0, it.y1))),
              storeys: it.s ?? null,
              d: it.d ?? 0.06,
              color: it.color ?? 'plaster2',
              cap: it.cap ?? null,
              base: it.base ?? null,
              ...(it.corner ? { corner: it.corner } : {}),
              ...(it.joints ? { joints: it.joints } : {}),
            });
            break;
          }
          case 'pediment': {
            const dd = it.d ?? 0;
            const pa = c.Ud(Math.min(it.u0, it.u1), dd);
            const pb = c.Ud(Math.max(it.u0, it.u1), dd);
            items.push({
              t: 'pediment',
              u0: r2(pa),
              u1: r2(pb),
              apex: r2(it.apex != null ? c.Ud(it.apex, dd) : (pa + pb) / 2),
              y: it.y != null ? r2(absY(it.y)) : null,
              top: it.yTop != null ? r2(absY(it.yTop)) : null,
              h: it.h ?? null,
              d: dd,
              depth: it.depth ?? null,
              color: it.color ?? 'plaster2',
              trim: it.trim ?? null,
              roofC: it.roofC ?? null,
            });
            break;
          }
          case 'recess':
            items.push({
              t: 'recess',
              u0: r2(c.U(Math.min(it.u0, it.u1))),
              u1: r2(c.U(Math.max(it.u0, it.u1))),
              y0: it.s ? null : r2(absY(Math.min(it.y0, it.y1))),
              y1: it.s ? null : r2(absY(Math.max(it.y0, it.y1))),
              storeys: it.s ?? null,
              depth: it.depth ?? 1.0,
              back: it.back ?? null,
              side: it.side ?? null,
              ceil: it.ceil ?? null,
              floor: it.floor ?? null,
              ...(it.backS ? { backS: keyK(it.backS) } : {}),
              ...(it.sideS ? { sideS: keyK(it.sideS) } : {}),
              ...(it.clad ? { clad: it.clad } : {}),
            });
            break;
          case 'mast':
            items.push({
              t: 'mast',
              u: r2(c.U(it.u)),
              off: it.off ?? 0.3,
              y0: it.y0 != null ? r2(absY(it.y0)) : null,
              h: it.h ?? 6,
              color: it.color ?? '#d9dadb',
              flag: it.flag ?? null,
              ...(it.top ? { top: it.top } : {}),
            });
            break;
          case 'cloth': {
            const d = it.d ?? 1.0;
            items.push({
              t: 'cloth',
              u0: r2(c.Ud(Math.min(it.u0, it.u1), d)),
              u1: r2(c.Ud(Math.max(it.u0, it.u1), d)),
              y0: r2(absYd(Math.min(it.y0, it.y1), d)),
              y1: r2(absYd(Math.max(it.y0, it.y1), d)),
              d,
              color: it.color ?? '#8a6a50',
              back: it.back ?? 0,
            });
            break;
          }
          case 'banner': {
            const d = it.d ?? 1.4;
            items.push({
              t: 'banner',
              u0: r2(c.Ud(Math.min(it.u0, it.u1), d)),
              u1: r2(c.Ud(Math.max(it.u0, it.u1), d)),
              y0: r2(absYd(Math.min(it.y0, it.y1), d)),
              y1: r2(absYd(Math.max(it.y0, it.y1), d)),
              d,
              style: it.style ?? 'portrait',
              bg: it.bg ?? null,
              fg: it.fg ?? null,
              text: it.text ?? null,
              // v7 (style print): satırlar, renk blokları (pankart oranında), file pankart
              ...(it.lines?.length ? { lines: it.lines } : {}),
              ...(it.blocks?.length ? { blocks: it.blocks } : {}),
              ...(it.mesh ? { mesh: true } : {}),
            });
            break;
          }
          case 'lamp': {
            const us = (it.us ?? [it.u]).filter((u) => u != null).map((u) => r2(c.U(u)));
            const st = it.s ? storeysArr(it.s) : null;
            items.push({
              t: 'lamp',
              us,
              y: st ? null : it.y != null ? r2(absY(it.y)) : null,
              yRel: st ? (it.yRel ?? (it.y != null ? r2(c.rel(it.y, it.k ?? it.s[0])) : 2.3)) : null,
              storeys: st,
              style: it.style ?? 'cylinder',
              d: it.d ?? 0.1,
              h: it.h ?? 0.22,
              proud: it.proud ?? 0.12,
              color: it.color ?? null,
              tip: it.tip ?? null,
              dir: it.dir ?? 'down',
              // v7: kollu / eğik baş, payenin yan yüzünde montaj
              ...(it.arm != null ? { arm: it.arm } : {}),
              ...(it.tilt != null ? { tilt: it.tilt } : {}),
              ...(it.side ? { side: it.side, off: it.off ?? null } : {}),
            });
            break;
          }
          case 'dormer': {
            const sb = it.setback ?? 2.0;
            let a;
            let e;
            if (it.x != null && it.z != null) {
              // Dünya konumu (hava fotoğrafı): kenar boyunca gerçek u, genişlik w
              const um = uWorld(it.x, it.z);
              a = um - (it.w ?? 1.6) / 2;
              e = um + (it.w ?? 1.6) / 2;
            } else if (it.u != null) {
              const um = c.Ud(it.u, -sb);
              a = um - (it.w ?? 1.6) / 2;
              e = um + (it.w ?? 1.6) / 2;
            } else {
              a = c.Ud(Math.min(it.u0, it.u1), -sb);
              e = c.Ud(Math.max(it.u0, it.u1), -sb);
            }
            items.push({
              t: 'dormer',
              u0: r2(a),
              u1: r2(e),
              setback: sb,
              ridge: it.ridge ?? null,
              h: it.h ?? null,
              wallH: it.wallH ?? null,
              pitch: it.pitch ?? 45,
              color: it.color ?? null,
              roofC: it.roofC ?? null,
              trim: it.trim ?? null,
              win: it.win ?? null,
            });
            break;
          }
          case 'roofobj': {
            const sb = it.setback ?? 1.0;
            const u = it.x != null && it.z != null ? uWorld(it.x, it.z) : c.Ud(it.u, -sb);
            items.push({
              t: 'roofobj',
              kind: it.kind ?? 'chimney',
              u: r2(u),
              setback: sb,
              h: it.h ?? 0.8,
              w: it.w ?? 0.45,
              d: it.depth ?? it.w ?? 0.45,
              color: it.color ?? null,
              cap: it.cap ?? (it.kind === 'chimney' || !it.kind ? { kind: 'hip' } : null),
              ...(it.top ? { top: it.top } : {}),
            });
            break;
          }
          case 'ribbon':
            items.push({
              t: 'ribbon',
              pts: (it.pts ?? []).map(([u, y]) => [r2(c.U(u)), r2(absY(y))]),
              w: it.w ?? 0.1,
              d: it.d ?? 0.01,
              color: it.color ?? 'plaster',
            });
            break;
          case 'arch': {
            const d = it.d ?? 0;
            items.push({
              t: 'arch',
              u0: r2(c.Ud(Math.min(it.u0, it.u1), d)),
              u1: r2(c.Ud(Math.max(it.u0, it.u1), d)),
              y: it.y != null ? r2(absY(it.y)) : null,
              rise: it.rise ?? null,
              top: it.yTop != null ? r2(absY(it.yTop)) : null,
              spring: it.spring ?? 0,
              d,
              shape: it.shape ?? 'segment',
              thick: it.thick ?? 0.25,
              color: it.color ?? 'plaster2',
              coping: it.coping ?? null,
              vault: it.vault ?? 0,
              roofC: it.roofC ?? null,
              // v7: kısmi kemer (görünen u aralığı) ve arka alın yüzü
              ...(it.clip?.length === 2
                ? {
                    clip: [
                      r2(c.Ud(Math.min(it.clip[0], it.clip[1]), d)),
                      r2(c.Ud(Math.max(it.clip[0], it.clip[1]), d)),
                    ],
                  }
                : {}),
              ...(it.backFace === false ? { backFace: false } : {}),
            });
            break;
          }
          case 'strip':
            items.push({
              t: 'strip',
              u: r2(c.U(it.u)),
              w: r2((it.w ?? 0.24) * c.sY),
              y0: r2(absY(Math.min(it.y0, it.y1))),
              y1: r2(absY(Math.max(it.y0, it.y1))),
              ...(it.top ? { top: it.top } : {}),
              ...(it.bottom ? { bottom: it.bottom } : {}),
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
              // Kat anahtarları "K3" → "3" (önceden normalize edilmiyordu: K'li ölçülmüş tonlar yok sayılıyordu)
              tint: keyK(it.tint ?? {}),
              cap: !!it.cap,
              sides: it.sides ?? 'open',
              inset: it.inset ?? null,
              ...(it.rail ? { rail: keyK(it.rail) } : {}),
              ...(it.fasciaC ? { fasciaC: keyK(it.fasciaC) } : {}),
              ...(it.railC ? { railC: it.railC } : {}),
              ...(it.parapetH ? { parapetH: keyK(it.parapetH) } : {}),
              ...(it.net ? { net: it.net } : {}),
              ...(it.glassC ? { glassC: keyK(it.glassC) } : {}),
              ...(it.bulge ? { bulge: it.bulge } : {}),
              // Ortak yay açıklığı (görünen u, balkon ön yüzünde) → gerçek u
              ...(it.arc?.length === 2
                ? {
                    arc: [
                      r2(c.Ud(Math.min(it.arc[0], it.arc[1]), it.d ?? 1.4)),
                      r2(c.Ud(Math.max(it.arc[0], it.arc[1]), it.d ?? 1.4)),
                    ],
                  }
                : {}),
              ...(it.round ? { round: it.round } : {}),
              ...(it.frameC ? { frameC: keyK(it.frameC) } : {}),
              ...(it.glazeEvery > 0.2 ? { glazeEvery: r2(it.glazeEvery) } : {}),
              ...(it.frostC ? { frostC: it.frostC } : {}),
              ...(it.beam ? { beam: keyK(it.beam) } : {}),
              ...(it.railH ? { railH: keyK(it.railH) } : {}),
              // Saksılar: kat → görünen u listesi (balkon ön yüzünde) → gerçek u
              ...(it.pots
                ? {
                    pots: Object.fromEntries(
                      Object.entries(keyK(it.pots)).map(([k, us]) => [
                        k,
                        us.map((u) => r2(c.Ud(u, it.d ?? 1.4))),
                      ]),
                    ),
                    potsOn: it.potsOn ?? 'rail',
                    potC: it.potC ?? null,
                    plantC: it.plantC ?? null,
                  }
                : {}),
              ...(it.curtC ? { curtC: keyK(it.curtC) } : {}),
              ...(it.curtF ? { curtF: keyK(it.curtF) } : {}),
              ...(it.grille
                ? { grille: keyK(it.grille), grilleC: it.grilleC ?? null, grilleW: it.grilleW ?? null }
                : {}),
              // v7: ölçülen spot konumları (görünen u, tavanda ön kenardan inset içeride) → gerçek u
              ...(it.spots
                ? {
                    spots: it.spots.us?.length
                      ? {
                          ...it.spots,
                          us: it.spots.us.map((u) => r2(c.Ud(u, (it.d ?? 1.4) - (it.spots.inset ?? 0.5)))),
                        }
                      : it.spots,
                  }
                : {}),
              ...(it.postEvery ? { postEvery: it.postEvery } : {}),
              ...(it.postW ? { postW: it.postW } : {}),
              ...(it.hand ? { hand: keyK(it.hand) } : {}),
              ...(it.capC ? { capC: it.capC } : {}),
              ...(it.capH ? { capH: it.capH } : {}),
              ...(it.capSlope ? { capSlope: it.capSlope } : {}),
              ...(it.capRail
                ? { capRail: it.capRail, capRailC: it.capRailC ?? null, capRailH: it.capRailH ?? null }
                : {}),
              ...(it.blinds
                ? { blinds: keyK(it.blinds), ...(it.blindTo ? { blindTo: keyK(it.blindTo) } : {}) }
                : {}),
              ...(it.coping ? { coping: keyK(it.coping) } : {}),
              ...(it.capTrim ? { capTrim: it.capTrim } : {}),
              ...(it.keepDoor ? { keepDoor: true } : {}),
              ...(it.flowerC?.length ? { flowerC: it.flowerC } : {}),
              // v7 alanları
              ...(it.potSpec
                ? {
                    potSpec: Object.fromEntries(
                      Object.entries(keyK(it.potSpec)).map(([k, arr]) => [
                        k,
                        arr.map((q) => ({ ...q, u: r2(c.Ud(q.u, it.d ?? 1.4)) })),
                      ]),
                    ),
                  }
                : {}),
              ...(it.chamfer != null ? { chamfer: it.chamfer } : {}),
              ...(it.wrap ? { wrap: it.wrap } : {}),
              ...(it.merge === false ? { merge: false } : {}),
              ...(it.endIn != null ? { endIn: it.endIn, endShape: it.endShape ?? null } : {}),
              ...(it.capGrid ? { capGrid: it.capGrid } : {}),
              ...(it.grilleH ? { grilleH: keyK(it.grilleH) } : {}),
              ...(it.grilleIn ? { grilleIn: true } : {}),
              ...(it.cage ? { cage: keyK(it.cage), cageEvery: it.cageEvery ?? null } : {}),
              ...(it.capOver != null ? { capOver: it.capOver } : {}),
            });
            break;
          }
          case 'proj':
            items.push({
              t: 'proj',
              u0: r2(c.U(Math.min(it.u0, it.u1))),
              u1: r2(c.U(Math.max(it.u0, it.u1))),
              d: it.d ?? 0.6,
              y0: r2(absY(Math.min(it.y0, it.y1))),
              y1: r2(absY(Math.max(it.y0, it.y1))),
              color: it.color ?? 'plaster',
              wins: (it.wins ?? []).map((w) => ({
                u0: r2(c.U(Math.min(w.u0, w.u1))),
                u1: r2(c.U(Math.max(w.u0, w.u1))),
                y0: r2(absY(Math.min(w.y0, w.y1))),
                y1: r2(absY(Math.max(w.y0, w.y1))),
                kind: w.kind ?? 'std',
                curt: w.curt ?? null,
                ...(w.rail ? { rail: true } : {}),
                ...(w.split ? { split: w.split } : {}),
                ...(w.frameC ? { frameC: w.frameC } : {}),
              })),
              ...(it.clad ? { clad: cladOf(it.clad) } : {}),
              ...(it.topRail
                ? {
                    topRail: it.topRail,
                    topRailC: it.topRailC ?? null,
                    topParH: it.topParH ?? null,
                    ...(it.topRailH ? { topRailH: it.topRailH } : {}),
                  }
                : {}),
              ...(it.back ? { back: it.back } : {}),
              ...(it.topC ? { topC: it.topC } : {}),
              ...(it.cap ? { cap: it.cap } : {}),
              ...(it.topGlassC ? { topGlassC: it.topGlassC } : {}),
              ...(it.d1 != null ? { d1: it.d1 } : {}),
              ...(it.finish ? { finish: it.finish } : {}),
            });
            break;
          case 'sign': {
            // v7: off → tabela duvardan uzakta (balkon alnına monte): o düzlemde görünen u / y düzeltilir
            const so = it.off != null ? it.off : null;
            const Us = (u) => (so != null ? c.Ud(u, so) : c.U(u));
            const Ys = (y) => (so != null ? absYd(y, so) : absY(y));
            items.push({
              t: 'sign',
              u0: r2(Us(Math.min(it.u0, it.u1))),
              u1: r2(Us(Math.max(it.u0, it.u1))),
              y0: r2(Ys(Math.min(it.y0, it.y1))),
              y1: r2(Ys(Math.max(it.y0, it.y1))),
              d: it.d ?? (it.style === 'letters' ? 0.04 : 0.12),
              text: it.text ?? '',
              lines: it.lines ?? null,
              bg: it.bg ?? null,
              fg: it.fg ?? '#ffffff',
              border: it.border ?? null,
              style: it.style ?? 'box',
              font: it.font ?? 'sans',
              bold: it.bold !== false,
              lit: !!it.lit,
              ...(it.outline ? { outline: it.outline } : {}),
              ...(it.shape ? { shape: it.shape } : {}),
              ...(it.icon ? { icon: it.icon, iconC: it.iconC ?? null } : {}),
              ...(it.glyphs ? { glyphs: it.glyphs, join: it.join ?? null } : {}),
              // v7: montaj uzaklığı, arkadan aydınlatma halesi, kanal harf arkası pano, ölçülen harf boyu, hiza
              ...(so != null ? { off: so } : {}),
              ...(it.halo ? { halo: it.halo } : {}),
              ...(it.back ? { back: it.back } : {}),
              ...(it.capH ? { capH: r2(it.capH * c.sY * c.depthK(so ?? 0)) } : {}),
              ...(it.align ? { align: it.align } : {}),
            });
            break;
          }
          case 'groove':
            items.push(
              it.dir === 'v'
                ? {
                    t: 'groove',
                    dir: 'v',
                    u: r2(c.U(it.u)),
                    y0: r2(absY(Math.min(it.y0, it.y1))),
                    y1: r2(absY(Math.max(it.y0, it.y1))),
                    w: it.w ?? 0.03,
                    color: it.color ?? null,
                  }
                : {
                    t: 'groove',
                    dir: 'h',
                    u0: r2(it.u0 != null ? c.U(Math.min(it.u0, it.u1)) : 0),
                    u1: r2(it.u1 != null ? c.U(Math.max(it.u0, it.u1)) : c.L),
                    y: r2(absY(it.y)),
                    w: it.w ?? 0.03,
                    color: it.color ?? null,
                  },
            );
            break;
          case 'vent':
            items.push({
              t: 'vent',
              u: r2(c.U(it.u)),
              y: r2(absY(it.y)),
              s: it.s ?? 0.12,
              shape: it.shape ?? 'round',
              count: it.count ?? 1,
              spacing: it.spacing ?? 0.3,
              color: it.color ?? null,
            });
            break;
          case 'awning':
            items.push({
              t: 'awning',
              u0: r2(c.U(Math.min(it.u0, it.u1))),
              u1: r2(c.U(Math.max(it.u0, it.u1))),
              y: r2(absY(it.y)),
              d: it.d ?? 1.2,
              drop: it.drop ?? 0.5,
              color: it.color ?? '#7a2e2a',
              stripe: it.stripe ?? null,
              text: it.text ?? null,
              textColor: it.textColor ?? '#ffffff',
              ...(it.style ? { style: it.style } : {}),
              // v7: valansta birden çok yazı / monogram, katlanır kollar, köşe çeyrek kubbesi
              ...(it.texts?.length
                ? {
                    texts: it.texts.map((q) => ({
                      ...q,
                      u0: r2(c.U(Math.min(q.u0, q.u1))),
                      u1: r2(c.U(Math.max(q.u0, q.u1))),
                    })),
                  }
                : {}),
              ...(it.arms
                ? {
                    arms: {
                      ...it.arms,
                      ...(it.arms.us?.length ? { us: it.arms.us.map((u) => r2(c.U(u))) } : {}),
                    },
                  }
                : {}),
              ...(it.dome ? { dome: it.dome } : {}),
            });
            break;
          case 'pipe':
            items.push({
              t: 'pipe',
              u: r2(it.off ? c.Ud(it.u, it.off) : c.U(it.u)),
              off: it.off ?? 0.08,
              ...(it.color ? { color: it.color } : {}),
              ...(it.r ? { r: it.r } : {}),
              ...(it.y0 != null && it.y1 != null
                ? { y0: r2(absY(Math.min(it.y0, it.y1))), y1: r2(absY(Math.max(it.y0, it.y1))) }
                : {}),
              ...(it.brackets === false ? { brackets: false } : {}),
              ...(it.stubs ? { stubs: it.stubs } : {}),
            });
            break;
          case 'ac':
          case 'dish':
          case 'camera':
          case 'flag':
            items.push({
              t: it.t,
              u: r2(it.onBal ? c.Ud(it.u, 1.4) : c.U(it.u)),
              s: it.s,
              y: it.y != null ? r2(absY(it.y) - (c.floorAt ? c.floorAt(it.s) : gR + it.s * FH)) : null,
              onBal: !!it.onBal,
              ...(it.style ? { style: it.style } : {}),
              ...(it.color ? { color: it.color } : {}),
              ...(it.off != null ? { off: it.off } : {}),
              ...(it.pair ? { pair: true } : {}),
              ...(it.side ? { side: true } : {}),
              ...(it.yaw != null ? { yaw: it.yaw } : {}),
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
              ...(it.style ? { style: it.style } : {}),
              ...(it.slats ? { slats: it.slats } : {}),
              ...(it.shade ? { shade: it.shade } : {}),
              ...(it.clad ? { clad: cladOf(it.clad) } : {}),
              // v7: çok renkli karo bandı (style tiles), yüzey bitişi (acp / matte)
              ...(it.tile ? { tile: it.tile } : {}),
              ...(it.colors?.length ? { colors: it.colors } : {}),
              ...(it.seq?.length ? { seq: it.seq } : {}),
              ...(it.finish ? { finish: it.finish } : {}),
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
              // v7: kapı eşiği (görünen y → tabandan gerçek)
              ...(it.y != null ? { y: r2(absY(it.y)) } : {}),
            });
            break;
          // ── v7 öğeleri ──
          case 'rod': {
            // Tabela çubuğu / gergi: uçlar [görünen u, görünen y, duvardan uzaklık m]
            const cv = (q) => {
              const off = q[2] ?? 0;
              return [r2(c.Ud(q[0], off)), r2(absYd(q[1], off)), off];
            };
            items.push({ t: 'rod', a: cv(it.a), e: cv(it.e), r: it.r ?? 0.015, color: it.color ?? null });
            break;
          }
          case 'steps': {
            const off = it.off ?? 0;
            items.push({
              t: 'steps',
              u0: r2(c.Ud(Math.min(it.u0, it.u1), off)),
              u1: r2(c.Ud(Math.max(it.u0, it.u1), off)),
              top: it.top != null ? it.top : it.yTop != null ? r2(absYd(it.yTop, off)) : 0,
              n: it.n ?? 2,
              tread: it.tread ?? 0.3,
              off,
              color: it.color ?? null,
            });
            break;
          }
          case 'box': {
            // Balkon / loca eşyası: görünen ön yüzü `at` düzleminde (+ önde / − geride m)
            const at = it.at ?? 0;
            items.push({
              t: 'box',
              kind: it.kind ?? 'box',
              u0: r2(c.Ud(Math.min(it.u0, it.u1), at)),
              u1: r2(c.Ud(Math.max(it.u0, it.u1), at)),
              y0: r2(absYd(Math.min(it.y0, it.y1), at)),
              y1: r2(absYd(Math.max(it.y0, it.y1), at)),
              s: it.s ?? 0,
              d: it.d ?? 0.4,
              off: it.off ?? 0.02,
              mount: it.mount ?? 'wall',
              color: it.color ?? null,
              color2: it.color2 ?? null,
            });
            break;
          }
          case 'blade': {
            const w = it.w ?? 0.8;
            const gap = it.gap ?? 0.1;
            const dm = gap + w / 2;
            items.push({
              t: 'blade',
              ...textOf(it, dm),
              u: r2(c.U(it.u)),
              y0: r2(absYd(Math.min(it.y0, it.y1), dm)),
              y1: r2(absYd(Math.max(it.y0, it.y1), dm)),
              w,
              gap,
              d: it.d ?? 0.12,
              ...(it.textB != null ? { textB: it.textB } : {}),
              ...(it.linesB?.length ? { linesB: it.linesB } : {}),
              ...(it.bracket ? { bracket: it.bracket } : {}),
            });
            break;
          }
          case 'vinyl':
            items.push({
              t: 'vinyl',
              ...textOf(it),
              u0: r2(c.U(Math.min(it.u0, it.u1))),
              u1: r2(c.U(Math.max(it.u0, it.u1))),
              y0: r2(absY(Math.min(it.y0, it.y1))),
              y1: r2(absY(Math.max(it.y0, it.y1))),
              ...(it.off != null ? { off: it.off } : {}),
            });
            break;
          case 'roofsign': {
            const sb = it.setback ?? 1.0;
            items.push({
              t: 'roofsign',
              ...textOf(it, -sb),
              u0: r2(c.Ud(Math.min(it.u0, it.u1), -sb)),
              u1: r2(c.Ud(Math.max(it.u0, it.u1), -sb)),
              y0: r2(absYd(Math.min(it.y0, it.y1), -sb)),
              y1: r2(absYd(Math.max(it.y0, it.y1), -sb)),
              setback: sb,
              d: it.d ?? 0.1,
              ...(it.frame ? { frame: it.frame } : {}),
            });
            break;
          }
          case 'screen': {
            const off = it.off ?? 0;
            const dd = it.d ?? 0.12;
            items.push({
              t: 'screen',
              ...textOf(it, off + dd),
              u0: r2(c.Ud(Math.min(it.u0, it.u1), off + dd)),
              u1: r2(c.Ud(Math.max(it.u0, it.u1), off + dd)),
              y0: r2(absYd(Math.min(it.y0, it.y1), off + dd)),
              y1: r2(absYd(Math.max(it.y0, it.y1), off + dd)),
              d: dd,
              off,
              frame: it.frame ?? null,
              ...(it.bezel != null ? { bezel: it.bezel } : {}),
              ...(it.blocks?.length ? { blocks: it.blocks } : {}),
            });
            break;
          }
          case 'neon': {
            const off = it.off ?? 0.03;
            items.push({
              t: 'neon',
              pts: (it.pts ?? []).map(([u, y]) => [r2(c.Ud(u, off)), r2(absYd(y, off))]),
              closed: !!it.closed,
              d: it.d ?? 0.02,
              off,
              color: it.color ?? null,
            });
            break;
          }
        }
      }
      return items;
    };
    const compiled = new Map();
    for (const s of sv.edges) if (s.copyOf == null) compiled.set(s.edge, compileEdge(s));
    /** Kopya kenar öğeleri: k = hedef/kaynak boy oranı, Ld = hedef boy (ayna için) */
    const copyItems = (src, k, mirror, Ld) => {
      const M = (u) => (mirror ? Ld - u * k : u * k);
      // KARAR (CLAUDE.md §0.1): kopya (görülmemiş) kenara yalnız GEOMETRİ geçer — tabela, bayrak, klima/çanak/
      // kamera, perde/kepenk/parmaklık durumu, cam balkon tonu, kuş filesi, saksı, tente yazısı fotoğrafta
      // görülmedi → kopyalanmaz (nötr varsayılan). Pencere/balkon/şerit/boru/bant gibi yapı öğeleri kalır.
      const OBSERVED_ONLY = new Set([
        'sign',
        'flag',
        'ac',
        'dish',
        'camera',
        'banner',
        'cloth',
        'lamp',
        'roofobj',
        // v7: tabela / ışık / eşya / basamak öğeleri de yalnız görüldüğü yerde
        'blade',
        'vinyl',
        'roofsign',
        'screen',
        'neon',
        'rod',
        'box',
        'steps',
      ]);
      return src
        .filter((it) => !OBSERVED_ONLY.has(it.t))
        .map((it) => {
          const o = { ...it };
          if (o.t === 'win') {
            delete o.curt;
            delete o.shut;
            delete o.grille;
            delete o.film;
          } else if (o.t === 'bal') {
            o.tint = {};
            delete o.net;
            delete o.pots;
            delete o.potSpec;
            delete o.cage;
            delete o.cageEvery;
            delete o.grilleH;
            delete o.grilleIn;
            // Görülmemiş kenarda perde / parmaklık / stor durumu bilinmez
            delete o.curtC;
            delete o.curtF;
            delete o.grille;
            delete o.blinds;
          } else if (o.t === 'awning') {
            o.text = null;
            delete o.texts;
          }
          if (o.t === 'win') {
            delete o.curtC;
            delete o.curtF;
          }
          if ('u' in o) o.u = r2(M(o.u));
          if (o.t === 'ribbon') o.pts = o.pts.map(([u, y]) => [r2(M(u)), y]);
          if ('apex' in o && o.apex != null) o.apex = r2(M(o.apex));
          // v7: kenar boyu u listeleri / aralıkları da aynalanır
          if (o.clip) {
            const a = M(o.clip[0]);
            const b = M(o.clip[1]);
            o.clip = [r2(Math.min(a, b)), r2(Math.max(a, b))];
          }
          if (o.clad?.us) o.clad = { ...o.clad, us: o.clad.us.map((u) => r2(M(u))) };
          if (o.spots?.us) o.spots = { ...o.spots, us: o.spots.us.map((u) => r2(M(u))) };
          if (o.arms?.us) o.arms = { ...o.arms, us: o.arms.us.map((u) => r2(M(u))) };
          if ('u0' in o) {
            const a = M(o.u0);
            const b = M(o.u1);
            o.u0 = r2(Math.min(a, b));
            o.u1 = r2(Math.max(a, b));
          }
          return o;
        });
    };
    const edges = [];
    for (const s of sv.edges) {
      let items = compiled.get(s.edge) ?? [];
      if (s.copyOf != null) {
        const src = compiled.get(s.copyOf) ?? [];
        items = copyItems(src, len(s.edge) / len(s.copyOf), s.mirror, len(s.edge));
      }
      edges.push({ edge: s.edge, len: r2(len(s.edge)), seen: s.seen, items });
    }
    // v8: kütle kesim yüzü kenarları (cutEdges) — massing parçaları arasındaki yan duvarlar, kule yüzleri.
    // KARAR: kesim kenarı parça + DÜNYA doğrusu (a → e, taban izi halkasıyla aynı yönde: yukarıdan bakınca bina
    // solda) ile adreslenir; kesim kenarlarının indisleri çalışma anındaki çokgen kırpmasına bağlı (taban izi / massing
    // değişince kayar), doğru ise kararlı. u = a'dan doğru boyunca, öğe şeması normal kenarla aynı. `cal` yoksa u / y
    // GERÇEK metre (y blok tabanından, kat k'ya göre yükseklikler parçanın kendi kat ızgarasıyla); `cal` varsa görünen
    // (kendi düzleminde üretilmiş ortofoto) koordinat: u iki köşeden doğrusal, y iki kat lentosundan (parçanın kat
    // kotlarıyla). Perspektif / derinlik düzeltmesi yok (ortofoto bilinen bir panoramanın kenar ortosu değil).
    // Çalışma anında massing.ts bu doğruya paralel (≤ 15°), `tol` (1.5 m) içindeki parça kesim kenarlarına dağıtır.
    const cutOut = [];
    if (sv.cutEdges?.length) {
      const towers = sv.massing?.towers ?? [];
      const FHr = r2(FH);
      const gRr = r2(gR);
      // Çalışma anındaki parça kat kotlarıyla aynı (facade.ts floorY: parça floorHs ya da blok floorHs, yoksa floorH)
      const floorAtOf = (part) => {
        const tw = part === 'gap' ? null : towers[part];
        const fhs = tw?.floorHs?.length ? tw.floorHs : sv.floorHs?.length ? sv.floorHs : null;
        const fh = tw?.floorH ?? FHr;
        return (k) => {
          if (!fhs) return gRr + k * fh;
          let y = 0;
          for (let q = 0; q < k; q++) y += fhs[q] ?? fh;
          return gRr + y;
        };
      };
      const cutC = (ce) => {
        const Lc = Math.hypot(ce.e[0] - ce.a[0], ce.e[1] - ce.a[1]);
        const floorAt = floorAtOf(ce.part);
        let U = (u) => u;
        let absY = (y) => y;
        let sY = 1;
        if (ce.cal) {
          const sU = Lc / (ce.cal.u[1] - ce.cal.u[0]);
          const [[k1, y1], [k2, y2]] = ce.cal.head;
          sY = k1 !== k2 ? (floorAt(k2) - floorAt(k1)) / (y2 - y1) : sU;
          U = (u) => (u - ce.cal.u[0]) * sU;
          absY = (y) => floorAt(k1) + HEAD + (y - y1) * sY;
        }
        return {
          U,
          Ud: (u) => U(u),
          rel: (y, k) => absY(y) - floorAt(k),
          headApp: null,
          sY,
          L: Lc,
          Yabs: absY,
          yCamRel: 0,
          depthK: () => 1,
          D: 1e6,
          absY,
          floorAt,
        };
      };
      const lineU = (ce) => {
        const Lc = Math.hypot(ce.e[0] - ce.a[0], ce.e[1] - ce.a[1]) || 1;
        return (x, z) => ((x - ce.a[0]) * (ce.e[0] - ce.a[0]) + (z - ce.a[1]) * (ce.e[1] - ce.a[1])) / Lc;
      };
      // Denetim: parça çokgeni biliniyorsa doğruya uyan (aynı yönlü) bir kenar var mı
      const check = (ce, j) => {
        const tw = ce.part === 'gap' ? null : towers[ce.part];
        if (ce.part !== 'gap' && !tw) {
          console.warn(`⚠ ${id} cutEdges[${j}]: massing.towers[${ce.part}] yok`);
          return;
        }
        let poly = tw?.poly;
        if (!poly?.length) return;
        const A = poly.reduce(
          (a, p, i) => a + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1],
          0,
        );
        if (A > 0) poly = [...poly].reverse();
        const Lc = Math.hypot(ce.e[0] - ce.a[0], ce.e[1] - ce.a[1]);
        const t = [(ce.e[0] - ce.a[0]) / Lc, (ce.e[1] - ce.a[1]) / Lc];
        const tol = ce.tol ?? 1.5;
        let fw = 0;
        let bw = 0;
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i];
          const q = poly[(i + 1) % poly.length];
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L < 0.3) continue;
          const dot = ((q[0] - p[0]) * t[0] + (q[1] - p[1]) * t[1]) / L;
          const off = (v) => Math.abs((v[0] - ce.a[0]) * t[1] - (v[1] - ce.a[1]) * t[0]);
          if (off(p) > tol || off(q) > tol || Math.abs(dot) < Math.cos((15 * Math.PI) / 180)) continue;
          if (dot > 0) fw++;
          else bw++;
        }
        if (!fw)
          console.warn(
            `⚠ ${id} cutEdges[${j}]: parça ${ce.part} çokgeninde doğruya uyan kenar yok${bw ? ' (a → e ters yönde yazılmış olabilir)' : ''}`,
          );
      };
      if (!sv.massing?.towers?.length) console.warn(`⚠ ${id}: cutEdges massing olmadan çizilmez`);
      const compiledCut = sv.cutEdges.map((ce, j) => {
        check(ce, j);
        return ce.copyOf == null ? compileEdge(ce, cutC(ce), lineU(ce)) : null;
      });
      sv.cutEdges.forEach((ce, j) => {
        const Lc = Math.hypot(ce.e[0] - ce.a[0], ce.e[1] - ce.a[1]);
        let items = compiledCut[j] ?? [];
        if (ce.copyOf != null) {
          const src = sv.cutEdges[ce.copyOf];
          const Ls = src ? Math.hypot(src.e[0] - src.a[0], src.e[1] - src.a[1]) : Lc;
          items = copyItems(compiledCut[ce.copyOf] ?? [], Lc / Ls, ce.mirror, Lc);
        }
        cutOut.push({
          part: ce.part,
          a: ce.a,
          e: ce.e,
          len: r2(Lc),
          seen: ce.seen,
          ...(ce.tol != null ? { tol: ce.tol } : {}),
          items,
        });
      });
    }
    const baseHOf = () => {
      if (sv.baseH != null) return sv.baseH;
      const fhs = sv.floorHs?.length ? sv.floorHs : null;
      let y = r2(gR);
      for (let q = 0; q < sv.startK; q++) y += fhs?.[q] ?? r2(FH);
      return r2(y);
    };
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
      ...(sv.massing ? { massing: sv.massing } : {}),
      ...(cutOut.length ? { cutEdges: cutOut } : {}),
      // Dünya koordinatlı ek hacimler ve kat başına yükseklikler aynen (ölçüm dosyasında gerçek metre)
      ...(sv.volumes?.length ? { volumes: sv.volumes } : {}),
      ...(sv.floorHs?.length ? { floorHs: sv.floorHs } : {}),
      ...(sv.pergolas?.length ? { pergolas: sv.pergolas } : {}),
      ...(sv.plinthH != null ? { plinthH: sv.plinthH } : {}),
      ...(sv.wallTop != null ? { wallTop: sv.wallTop } : {}),
      // v8: podyum üstündeki kulenin duvar / öğe başlangıç kotu (startK → o katın döşeme kotu, çalışma anındaki gibi)
      ...(sv.baseH != null || sv.startK != null ? { baseH: baseHOf() } : {}),
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
