#!/usr/bin/env node
// Bina taban izi düzeltmesi: sv-plane.mjs'nin kenar başına düzlem ofseti (δ) ölçümlerine, binanın ana eksenlerinde
// öteleme + eksen başına ölçek (4 parametre) sağlam en küçük kareler ile oturtulur. OSM izleri eğik hava
// fotoğraflarından çizildiği için birkaç metre kayık / geniş olabiliyor (ör. doğu cepheler ~3 m içeride).
// Girdi: docs/survey/planes/<id>.json  Çıktı: src/worlds/measured/data/footprints.json (id → halka, yerel m)
// Kullanım: node scripts/sv-footprint-fit.mjs [id,...]
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'src', 'worlds', 'measured', 'data', 'footprints.json');

function orient(p) {
  const r =
    p.length >= 4 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1] ? p.slice(0, -2) : p.slice();
  const n = r.length / 2;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a2 += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
  }
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([r[2 * i], r[2 * i + 1]]);
  return a2 > 0 ? pts.reverse() : pts;
}

/** En küçük alanlı yönlü dikdörtgen → ana eksenler */
function axes(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const e = pts[(i + 1) % pts.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 1) continue;
    const U = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const V = [-U[1], U[0]];
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pts) {
      const u = p[0] * U[0] + p[1] * U[1];
      const v = p[0] * V[0] + p[1] * V[1];
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      best = { area, U, V, c: [U[0] * uc + V[0] * vc, U[1] * uc + V[1] * vc], w: u1 - u0, d: v1 - v0 };
    }
  }
  return best;
}

/** 4×4 doğrusal sistem (Gauss) */
function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}

function fit(pts, meas) {
  const ax = axes(pts);
  const { U, V, c } = ax;
  // Her ölçüm: n, m, adaylar [{d, s}]
  const rows = meas.map((m) => {
    const du = (m.mid[0] - c[0]) * U[0] + (m.mid[1] - c[1]) * U[1];
    const dv = (m.mid[0] - c[0]) * V[0] + (m.mid[1] - c[1]) * V[1];
    const nu = m.n[0] * U[0] + m.n[1] * U[1];
    const nv = m.n[0] * V[0] + m.n[1] * V[1];
    return { ...m, f: [m.n[0], m.n[1], du * nu, dv * nv] };
  });
  let p = [0, 0, 0, 0];
  const pick = rows.map((r) => r.cands[0]);
  const PRIOR = 30; // ölçek ≈ 1 ön bilgisi (ağırlık)
  for (let it = 0; it < 8; it++) {
    const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    const b = [0, 0, 0, 0];
    rows.forEach((r, k) => {
      const c0 = pick[k];
      const pred = r.f.reduce((s, f, i) => s + f * p[i], 0);
      const res = c0.d - pred;
      const huber = it === 0 ? 1 : Math.min(1, 0.6 / Math.max(0.05, Math.abs(res)));
      const w = r.w * huber;
      for (let i = 0; i < 4; i++) {
        b[i] += w * r.f[i] * c0.d;
        for (let j = 0; j < 4; j++) A[i][j] += w * r.f[i] * r.f[j];
      }
    });
    A[2][2] += PRIOR;
    A[3][3] += PRIOR;
    p = solve(A, b);
    // Aday seçimi: tahmine en yakın, yeterince güçlü tepe
    rows.forEach((r, k) => {
      const pred = r.f.reduce((s, f, i) => s + f * p[i], 0);
      const top = r.cands[0].s;
      let best = r.cands[0];
      for (const cd of r.cands)
        if (cd.s >= top * 0.6 && Math.abs(cd.d - pred) < Math.abs(best.d - pred)) best = cd;
      pick[k] = best;
    });
  }
  const tr = (q) => {
    const du = (q[0] - c[0]) * U[0] + (q[1] - c[1]) * U[1];
    const dv = (q[0] - c[0]) * V[0] + (q[1] - c[1]) * V[1];
    return [
      c[0] + p[0] + U[0] * du * (1 + p[2]) + V[0] * dv * (1 + p[3]),
      c[1] + p[1] + U[1] * du * (1 + p[2]) + V[1] * dv * (1 + p[3]),
    ];
  };
  const report = rows.map((r, k) => {
    const pred = r.f.reduce((s, f, i) => s + f * p[i], 0);
    return { edge: r.edge, len: r.len, meas: pick[k].d, s: +pick[k].s.toFixed(3), pred: +pred.toFixed(2) };
  });
  return { p, ax, ring: pts.map(tr), report };
}

async function main() {
  const osm = JSON.parse(await readFile(join(root, 'public', 'data', 'osm.json'), 'utf8'));
  const dir = join(root, 'docs', 'survey', 'planes');
  const ids = process.argv[2]
    ? process.argv[2].split(',').map(Number)
    : (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => Number(f.slice(0, -5)));
  let out = {};
  try {
    out = JSON.parse(await readFile(outPath, 'utf8'));
  } catch {
    /* yeni dosya */
  }
  for (const id of ids) {
    const w = osm.ways.find((x) => x.i === id);
    if (!w) continue;
    const pts = orient(w.p);
    const J = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'));
    const meas = [];
    for (const e of J.edges) {
      const L = Math.hypot(e.e[0] - e.a[0], e.e[1] - e.a[1]);
      const n = [-(e.e[1] - e.a[1]) / L, (e.e[0] - e.a[0]) / L];
      const cands = e.peaks.map((pk) => ({ d: pk.d, s: pk.v - e.med })).filter((c) => c.s > 0.03);
      if (!cands.length) continue;
      cands.sort((a, b) => b.s - a.s);
      // Güven: tepe keskinliği × uzunluk
      meas.push({
        edge: e.edge,
        len: L,
        n,
        mid: [(e.a[0] + e.e[0]) / 2, (e.a[1] + e.e[1]) / 2],
        cands,
        w: cands[0].s * Math.sqrt(L) * Math.min(1, e.panos.length / 3),
      });
    }
    if (meas.length < 2) {
      console.log(`${id}: yetersiz ölçüm (${meas.length})`);
      continue;
    }
    const r = fit(pts, meas);
    const [tx, tz, su, sv] = r.p;
    console.log(
      `${id}: öteleme (${tx.toFixed(2)}, ${tz.toFixed(2)}) m, ölçek U ${(1 + su).toFixed(3)} (${r.ax.w.toFixed(1)} m) V ${(1 + sv).toFixed(3)} (${r.ax.d.toFixed(1)} m)`,
    );
    for (const q of r.report)
      console.log(
        `   kenar ${String(q.edge).padStart(2)} ${q.len.toFixed(1).padStart(5)} m  ölçülen δ ${q.meas.toFixed(1).padStart(5)} (${q.s})  model ${q.pred.toFixed(1).padStart(5)}`,
      );
    out[id] = {
      ring: r.ring.map((q) => [+q[0].toFixed(2), +q[1].toFixed(2)]),
      shift: [+tx.toFixed(2), +tz.toFixed(2)],
      scale: [+(1 + su).toFixed(3), +(1 + sv).toFixed(3)],
      axis: r.ax.U.map((v) => +v.toFixed(4)),
    };
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(out, null, 1) + '\n');
  console.log(`→ ${outPath}`);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
