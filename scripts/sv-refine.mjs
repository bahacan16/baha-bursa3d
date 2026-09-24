// Street View çok-görüş tutarlılığı ile bina taban izi düzeltme ("plane sweep").
// Her duvar kendi normali boyunca −SWEEP..+SWEEP m kaydırılır; farklı panoramalardan gelen kareler
// yalnızca duvar doğru yerdeyken aynı deseni gösterir. En yüksek ortalama NCC'yi veren kayma seçilir,
// köşeler komşu kaydırılmış duvar çizgilerinin kesişimiyle yeniden kurulur.
import { outwardNormal } from './sv-common.mjs';

const SWEEP = 5;
const STEP = 0.25;

function project(c, focal, half, x, y, z) {
  const dx = x - c.c[0];
  const dy = y - c.c[1];
  const dz = z - c.c[2];
  const zc = dx * c.f[0] + dy * c.f[1] + dz * c.f[2];
  if (zc <= 0.5) return null;
  return [
    half + (focal * (dx * c.r[0] + dy * c.r[1] + dz * c.r[2])) / zc,
    half - (focal * (dx * c.u[0] + dy * c.u[1] + dz * c.u[2])) / zc,
  ];
}

function sampleGray(g, S, u, v) {
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = u - iu;
  const fv = v - iv;
  const o = iv * S + iu;
  return (
    g[o] * (1 - fu) * (1 - fv) + g[o + 1] * fu * (1 - fv) + g[o + S] * (1 - fu) * fv + g[o + S + 1] * fu * fv
  );
}

function ncc(a, b) {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    n++;
    sa += a[i];
    sb += b[i];
  }
  if (n < 30) return null;
  const ma = sa / n;
  const mb = sb / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    const x = a[i] - ma;
    const y = b[i] - mb;
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  if (aa < 1e-6 || bb < 1e-6) return null;
  return ab / Math.sqrt(aa * bb);
}

/**
 * @param b hedef bina {id, ring, height}
 * @param base bina taban kotu
 * @param cams kameralar ({pano, c, f, r, u, file})
 * @param gray (cam) → Promise<Uint8Array> gri, bulanık görüntü
 * @returns {ring, offsets, scores}
 */
export async function refineBuilding(b, base, cams, gray, occ, focal, S, log) {
  const r = b.ring;
  const n = r.length / 2;
  const half = S / 2;
  const offsets = new Array(n).fill(0);
  const scores = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[2 * i];
    const az = r[2 * i + 1];
    const ex = r[2 * j];
    const ez = r[2 * j + 1];
    const len = Math.hypot(ex - ax, ez - az);
    if (len < 2.5) continue;
    const [nx, nz] = outwardNormal(r, i);
    const mx = (ax + ex) / 2;
    const mz = (az + ez) / 2;
    // Duvarı dışarıdan, engelsiz gören kameralar
    const cand = [];
    for (const c of cams) {
      const dx = c.c[0] - mx;
      const dz = c.c[2] - mz;
      const d = Math.hypot(dx, dz);
      if (d > 45 || (dx * nx + dz * nz) / d < 0.25) continue;
      if (occ.blocked(c.c[0], c.c[2], mx + nx * 0.05, mz + nz * 0.05, [b.id, i])) continue;
      cand.push(c);
    }
    if (new Set(cand.map((c) => c.pano)).size < 2) continue;
    const imgs = await Promise.all(cand.map((c) => gray(c)));
    const NU = Math.max(6, Math.min(16, Math.round(len / 1.2)));
    const NV = 10;
    const y0 = base + 3.2; // çit/çalı üstü
    const y1 = base + b.height - 0.8;
    let best = -Infinity;
    let bestD = 0;
    const curve = [];
    for (let d = -SWEEP; d <= SWEEP + 1e-6; d += STEP) {
      const vecs = cand.map(() => new Float32Array(NU * NV).fill(NaN));
      let k = 0;
      for (let iu = 0; iu < NU; iu++) {
        const t = 0.12 + (0.76 * (iu + 0.5)) / NU;
        const wx = ax + (ex - ax) * t + nx * d;
        const wz = az + (ez - az) * t + nz * d;
        for (let iv = 0; iv < NV; iv++, k++) {
          const wy = y0 + ((y1 - y0) * (iv + 0.5)) / NV;
          for (let ci = 0; ci < cand.length; ci++) {
            const p = project(cand[ci], focal, half, wx, wy, wz);
            if (!p || p[0] < 2 || p[1] < 2 || p[0] > S - 3 || p[1] > S * 0.85) continue;
            vecs[ci][k] = sampleGray(imgs[ci], S, p[0], p[1]);
          }
        }
      }
      let sum = 0;
      let cnt = 0;
      for (let a = 0; a < cand.length; a++)
        for (let c = a + 1; c < cand.length; c++) {
          if (cand[a].pano === cand[c].pano) continue; // aynı merkez: derinlik bilgisi yok
          const v = ncc(vecs[a], vecs[c]);
          if (v === null) continue;
          sum += v;
          cnt++;
        }
      const s = cnt ? sum / cnt : -Infinity;
      curve.push(s);
      if (s > best) {
        best = s;
        bestD = d;
      }
    }
    // Güven: tepe belirgin mi (ortalamadan yeterince yüksek) ve pozitif mi
    const valid = curve.filter(Number.isFinite);
    const mean = valid.reduce((a, v) => a + v, 0) / (valid.length || 1);
    if (best > 0.35 && best - mean > 0.08) {
      offsets[i] = bestD;
      scores[i] = +best.toFixed(3);
    }
    log?.(
      `  duvar ${i} (${len.toFixed(1)} m): kayma ${offsets[i].toFixed(2)} m, NCC ${best.toFixed(2)} (ort ${mean.toFixed(2)}), ${cand.length} kare`,
    );
  }

  // Köşeleri kaydırılmış çizgilerin kesişimiyle yeniden kur
  const lines = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [nx, nz] = outwardNormal(r, i);
    const tx = r[2 * j] - r[2 * i];
    const tz = r[2 * j + 1] - r[2 * i + 1];
    const L = Math.hypot(tx, tz) || 1;
    lines.push({
      px: r[2 * i] + nx * offsets[i],
      pz: r[2 * i + 1] + nz * offsets[i],
      tx: tx / L,
      tz: tz / L,
      nx,
      nz,
    });
  }
  const out = [];
  for (let j = 0; j < n; j++) {
    const a = lines[(j - 1 + n) % n];
    const c = lines[j];
    const ox = r[2 * j];
    const oz = r[2 * j + 1];
    const cr = a.tx * c.tz - a.tz * c.tx;
    let vx;
    let vz;
    if (Math.abs(cr) < 0.2) {
      const oa = offsets[(j - 1 + n) % n];
      const oc = offsets[j];
      vx = ox + (a.nx * oa + c.nx * oc) / 2;
      vz = oz + (a.nz * oa + c.nz * oc) / 2;
    } else {
      const s = ((c.px - a.px) * c.tz - (c.pz - a.pz) * c.tx) / cr;
      vx = a.px + a.tx * s;
      vz = a.pz + a.tz * s;
      if (Math.hypot(vx - ox, vz - oz) > 7) {
        vx = ox;
        vz = oz;
      }
    }
    out.push(+vx.toFixed(2), +vz.toFixed(2));
  }
  return { ring: out, offsets, scores };
}
