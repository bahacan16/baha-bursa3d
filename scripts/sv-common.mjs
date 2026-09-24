// Street View pilotu için ortak geometri yardımcıları (indirme + cephe bake).
// Koordinatlar oyunun yerel ENU metre uzayı: +X doğu, −Z kuzey.
import { parseOsm } from '../src/worlds/osm/parse.ts';

const SIDEWALK_W = 2; // src/worlds/osm/roads.ts ile aynı
export const FENCE_H = 2.4;

/** Nokta-poligon testi (düz [x,z,x,z,...] dizisi). */
export function inside(p, x, z) {
  let c = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i];
    const zi = p[2 * i + 1];
    const xj = p[2 * j];
    const zj = p[2 * j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function centroid(p) {
  let x = 0;
  let z = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    x += p[2 * i];
    z += p[2 * i + 1];
  }
  return [x / n, z / n];
}

/** Kapalı halka ise son (tekrar eden) noktayı at. */
export function ring(p) {
  const n = p.length;
  if (n >= 4 && p[0] === p[n - 2] && p[1] === p[n - 1]) return p.slice(0, n - 2);
  return p.slice();
}

/** İki doğru parçası kesişiyor mu (uç noktalar hariç küçük pay ile). */
function segHit(ax, az, bx, bz, cx, cz, dx, dz) {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return t > 1e-4 && t < 1 - 1e-3 && u > 1e-4 && u < 1 - 1e-4;
}

/** Bina kenarları için kaba ızgara; görüş hattı testi (2D, bina taban izleri). */
export class Occluders {
  constructor(buildings, cell = 20) {
    this.cell = cell;
    this.grid = new Map();
    for (const b of buildings) {
      const r = b.ring;
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const e = [r[2 * i], r[2 * i + 1], r[2 * j], r[2 * j + 1], b.id, i];
        const x0 = Math.floor(Math.min(e[0], e[2]) / cell);
        const x1 = Math.floor(Math.max(e[0], e[2]) / cell);
        const z0 = Math.floor(Math.min(e[1], e[3]) / cell);
        const z1 = Math.floor(Math.max(e[1], e[3]) / cell);
        for (let gx = x0; gx <= x1; gx++)
          for (let gz = z0; gz <= z1; gz++) {
            const k = `${gx},${gz}`;
            if (!this.grid.has(k)) this.grid.set(k, []);
            this.grid.get(k).push(e);
          }
      }
    }
  }

  /** (ax,az)→(bx,bz) arası bir bina kenarı kesiyor mu? `skip` = [binaId, kenarNo] hedef kenar. */
  blocked(ax, az, bx, bz, skip) {
    const c = this.cell;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (c * 0.5)));
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const z = az + ((bz - az) * s) / steps;
      const gx = Math.floor(x / c);
      const gz = Math.floor(z / c);
      for (let ox = -1; ox <= 1; ox++)
        for (let oz = -1; oz <= 1; oz++) {
          const list = this.grid.get(`${gx + ox},${gz + oz}`);
          if (!list) continue;
          for (const e of list) {
            if (seen.has(e)) continue;
            seen.add(e);
            if (skip && e[4] === skip[0] && e[5] === skip[1]) continue;
            if (segHit(ax, az, bx, bz, e[0], e[1], e[2], e[3])) return true;
          }
        }
    }
    return false;
  }
}

/** Oyundaki bina yükseklik kuralının sade hali (height → levels → 5 kat). */
export function buildingHeight(t) {
  const h = parseFloat(t.height);
  if (Number.isFinite(h) && h > 0) return h;
  const l = parseFloat(t['building:levels']);
  if (Number.isFinite(l) && l > 0) return l * 3.1 + 1;
  return 5 * 3.1 + 1;
}

/** Yerel (dx,dz) → pusula açısı (derece, kuzey=0, doğu=90). */
export function headingOf(dx, dz) {
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}

/** Pilot alanını ve hedef binaları seç. */
export function pilotArea(osm, areaName, buffer) {
  const area = osm.ways.find((w) => w.t && w.t.name === areaName && !w.t.highway);
  if (!area) throw new Error(`Alan bulunamadı: ${areaName}`);
  const poly = ring(area.p);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i]);
    maxX = Math.max(maxX, poly[i]);
    minZ = Math.min(minZ, poly[i + 1]);
    maxZ = Math.max(maxZ, poly[i + 1]);
  }
  const bbox = [minX - buffer, minZ - buffer, maxX + buffer, maxZ + buffer];
  const all = osm.ways
    .filter((w) => w.t && w.t.building && w.p.length >= 6)
    .map((w) => ({ id: w.i, ring: ring(w.p), tags: w.t, height: buildingHeight(w.t) }));
  const core = all.filter((b) => {
    const [cx, cz] = centroid(b.ring);
    return inside(poly, cx, cz);
  });
  // Hedef: sitenin kendisi + çevresi (kutu içindeki tüm binalar)
  const targets = all.filter((b) => {
    const [cx, cz] = centroid(b.ring);
    return cx >= bbox[0] && cx <= bbox[2] && cz >= bbox[1] && cz <= bbox[3];
  });
  return { area, poly, bbox, all, targets, core };
}

/** Bir hedef kenarın dış normali (poligonun dışına bakan). */
export function outwardNormal(r, i) {
  const n = r.length / 2;
  const j = (i + 1) % n;
  const ax = r[2 * i];
  const az = r[2 * i + 1];
  const bx = r[2 * j];
  const bz = r[2 * j + 1];
  const len = Math.hypot(bx - ax, bz - az) || 1;
  let nx = (bz - az) / len;
  let nz = -(bx - ax) / len;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  if (inside(r, mx + nx * 0.3, mz + nz * 0.3)) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz];
}

/**
 * Site çitleri: OSM'de çizilmemiş; araç yollarının kaldırım dış kenarı boyunca, konut/park alanına bakan
 * taraflara yerleştirilir (gerçekte çit + çalı tam orada). Dönüş: [[ax,az,bx,bz], ...] parçaları.
 */
export function siteFences(osm, bbox) {
  const data = parseOsm(osm);
  const zones = osm.ways
    .filter((w) => w.t && (w.t.landuse === 'residential' || w.t.leisure === 'park') && w.p.length >= 6)
    .map((w) => ring(w.p));
  const blds = osm.ways.filter((w) => w.t && w.t.building).map((w) => ring(w.p));
  const inZone = (x, z) => zones.some((p) => inside(p, x, z));
  const inBld = (x, z) => blds.some((p) => inside(p, x, z));
  const inBox = (x, z) => x >= bbox[0] && x <= bbox[2] && z >= bbox[1] && z <= bbox[3];
  // Giriş boşlukları: yaya/servis yolları çiti keser
  const gates = data.roads.filter((r) => !r.vehicular || r.kind === 'service');
  const nearGate = (x, z) =>
    gates.some((g) => {
      for (let i = 0; i + 1 < g.pts.length; i++) {
        const [ax, az] = g.pts[i];
        const [bx, bz] = g.pts[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < g.width / 2 + 1.2) return true;
      }
      return false;
    });
  const segs = [];
  for (const r of data.roads) {
    if (!r.vehicular || r.area || r.tunnel || r.bridge) continue;
    for (const side of [1, -1]) {
      const sw = side === 1 ? r.sidewalkRight : r.sidewalkLeft;
      const off = r.width / 2 + (sw ? SIDEWALK_W : 0) + 0.25;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const [ax, az] = r.pts[i];
        const [bx, bz] = r.pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        // Sağ taraf (çizim yönüne göre): (−dz, dx)·(−1) → oyundaki offsetPolyline işaretiyle uyumlu
        const nx = (-(bz - az) / L) * side;
        const nz = ((bx - ax) / L) * side;
        const n = Math.max(1, Math.round(L / 4));
        for (let k = 0; k < n; k++) {
          const t0 = k / n;
          const t1 = (k + 1) / n;
          const x0 = ax + (bx - ax) * t0 + nx * off;
          const z0 = az + (bz - az) * t0 + nz * off;
          const x1 = ax + (bx - ax) * t1 + nx * off;
          const z1 = az + (bz - az) * t1 + nz * off;
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;
          if (!inBox(mx, mz)) continue;
          // Çitin arkası (yoldan uzağa 1.5 m) site/park içinde olmalı, çit bina içinde olmamalı
          // OSM site sınırları çoğu zaman kaldırımdan birkaç metre içeride çizilmiş: 1.5–9 m arası ara
          if (inBld(mx, mz) || nearGate(mx, mz)) continue;
          let z = false;
          for (let dd = 1.5; dd <= 9 && !z; dd += 1.5) z = inZone(mx + nx * dd, mz + nz * dd);
          if (!z) continue;
          segs.push([x0, z0, x1, z1, nx, nz]);
        }
      }
    }
  }
  return segs;
}
