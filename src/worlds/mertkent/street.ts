import * as THREE from 'three';
import { Builder, type V2 } from './builder';
import { sideNormal, type StreetPlan } from './siteplan';

/**
 * Ölçülmüş sokak planı (data/street-plan.json): kaldırımlar (bordür hattından içeri w genişlik, kilit taşı
 * türü/bantları), bordür taşları, sokak eşyası (lamba direği, levha, direk, çöp kutusu, babalar, ayna, rögar,
 * sokak ağaçlarının çukuru).
 */

const KERB_W = 0.15;
const SHOW_BIKE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('bike');

export interface StreetResult {
  /** Yürüme yüksekliği için yükseltilmiş alanlar (arazinin üstünde h metre) */
  raised: { poly: [number, number][]; h: number }[];
  /** Kaldırım şeritlerinin kapsadığı alan (OSM kaldırımını/el kaldırımını çizmemek için) */
  covers: (x: number, z: number) => boolean;
}

function inside(r: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Bordür hattına göre kaldırım bandı: v0..v1 (m, bordürden kaldırım tarafına), h: bordür üstü kotu */
interface Band {
  v0: number;
  v1: number;
  key: string;
  h: number;
}
interface Layout {
  bands: Band[];
  /** Hissedilebilir kılavuz şerit (orta v, genişlik) */
  tactile?: [number, number];
  /** Ek bordürler (v, yükseklik) — ör. park cebi ile yaya kaldırımı arası */
  kerbs?: [number, number][];
  /** Yol tarafında bordüre bitişik bisiklet şeridi genişliği */
  bike?: number;
}

/**
 * Ölçüm notlarındaki kaldırım düzeni (street-plan.json malzeme metinlerinden, bordürden içeri metre).
 * KARAR: serbest metni ayrıştırmak yerine hat kimliğine göre tablo; bilinmeyen hatlar metinden tahmin edilir.
 */
/** Katman malzeme metninden anahtar */
function layerKey(m: string): string {
  const t = m.toLowerCase();
  if (/tactile|kılavuz|hissedilebilir/.test(t)) return 'tactile';
  if (/grass|çim|lawn|verge/.test(t)) return 'lawn';
  if (/asphalt|asfalt/.test(t)) return 'roadFill';
  if (/concrete|beton/.test(t) && !/interlock|kilit|paver/.test(t)) return 'spConcrete';
  if (/gravel|çakıl|toprak|dirt|soil/.test(t)) return 'spGravel';
  if (/red|kırmızı|kiremit|terracotta/.test(t)) return 'spPaverRed';
  return 'spPaverGrey';
}

function layoutOf(sw: {
  id?: string;
  w: number;
  kerbH?: number;
  material?: string;
  layers?: { w?: number; material?: string; h?: number; at?: number }[];
}): Layout {
  const W = sw.w;
  const h = sw.kerbH ?? 0.15;
  if (sw.layers?.length) {
    // Ölçülmüş katmanlar (bordürden içeri); "at" verilenler kılavuz şerit gibi üstte ince bantlar
    const bands: Band[] = [];
    let v = KERB_W;
    let tactile: [number, number] | undefined;
    const kerbs: [number, number][] = [];
    for (const L of sw.layers) {
      const key = layerKey(L.material ?? '');
      if (L.at != null) {
        tactile = [L.at, L.w ?? 0.5];
        continue;
      }
      const w = L.w ?? 0;
      if (w <= 0) continue;
      const lh = L.h ?? h;
      if (bands.length && Math.abs(bands[bands.length - 1].h - lh) > 0.05 && lh > 0.06) kerbs.push([v, lh]);
      bands.push({ v0: v, v1: Math.min(W, v + w), key, h: lh });
      v += w;
    }
    return { bands, tactile, kerbs };
  }
  switch (sw.id) {
    case 'east-west-side':
      // 502. Sk. batı: gri kilit taşı, ortada krem kılavuz (duvardan ~1.0 m), yol tarafında mavi bisiklet şeridi
      return { bands: [{ v0: KERB_W, v1: W, key: 'spPaverGrey', h }], tactile: [W - 1.0, 0.5], bike: 1.2 };
    case 'north-south-side':
      // Doğan Avcıoğlu güney: bordür boyunca kiremit bant ~1.3 m, duvara kadar gri + kılavuz
      return {
        bands: [
          { v0: KERB_W, v1: 1.45, key: 'spPaverRed', h },
          { v0: 1.45, v1: W, key: 'spPaverGrey', h },
        ],
        tactile: [Math.max(1.8, W - 0.8), 0.5],
      };
    case 'ne-island':
      return { bands: [{ v0: KERB_W, v1: W, key: 'spPaverGrey', h }], tactile: [W / 2, 0.5] };
    case 'west-east-side':
      // Cavit Orhan doğu: yol kotunda kiremit park cebi 1.5 m, iç bordür (0.12), gri 2.7 m, kılavuz duvardan ~1.95 m
      return {
        bands: [
          { v0: 0, v1: 1.5, key: 'spPaverRed', h: 0.03 },
          { v0: 1.62, v1: W, key: 'spPaverGrey', h: 0.12 },
        ],
        kerbs: [[1.5, 0.12]],
        tactile: [W - 1.95, 0.5],
      };
    case 'east-east-side':
      return { bands: [{ v0: KERB_W, v1: W, key: 'spConcrete', h }] };
    case 'south-north-side':
      return { bands: [{ v0: 0, v1: W, key: 'spConcrete', h: Math.max(0.04, h) }] };
  }
  const t = (sw.material ?? '').toLowerCase();
  const key = /kırmızı|red|kiremit/.test(t) && !/gri|grey/.test(t) ? 'spPaverRed' : 'spPaverGrey';
  return {
    bands: [{ v0: KERB_W, v1: W, key, h }],
    tactile: /kılavuz|tactile|hissedilebilir/.test(t) && W > 1.4 ? [W / 2, 0.5] : undefined,
    bike: /bisiklet|bike/.test(t) ? 1.2 : undefined,
  };
}

export function buildStreetPlan(
  b: Builder,
  plan: StreetPlan,
  H: (x: number, z: number) => number,
  roadCentre: (x: number, z: number) => number,
): StreetResult {
  const raised: StreetResult['raised'] = [];
  const polys: V2[][] = [];
  for (const sw of plan.sidewalks ?? []) {
    const pts = sw.pts;
    if (!pts || pts.length < 2) continue;
    const kerbH = sw.kerbH ?? 0.15;
    const lay = layoutOf(sw);
    // Köşe noktalarında asfalt dolgu diski (parçaların dış köşede bıraktığı kama boşlukları; kaldırım üstte kalır)
    for (let i = 1; i + 1 < pts.length; i++) {
      const c = pts[i];
      const ring: V2[] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        ring.push([c[0] + Math.cos(a) * 3, c[1] + Math.sin(a) * 3]);
      }
      b.drape('roadFill', ring, [], H, 0.027, 1, 2);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const e = pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.05) continue;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      // Kaldırım tarafı: ölçümdeki 'left'/'right'; yoksa yol ekseninden uzak olan yan
      let n: V2 = sideNormal(t, sw.side);
      if (sw.side !== 'left' && sw.side !== 'right') {
        const mx = (a[0] + e[0]) / 2;
        const mz = (a[1] + e[1]) / 2;
        if (roadCentre(mx + n[0] * 1.5, mz + n[1] * 1.5) < roadCentre(mx - n[0] * 1.5, mz - n[1] * 1.5))
          n = [-n[0], -n[1]];
      }
      const q = (u: number, v: number): V2 => [a[0] + t[0] * u + n[0] * v, a[1] + t[1] * u + n[1] * v];
      // Köşelerde komşu parçalarla birleşsin diye hafif uzat (iç tarafta daha çok: dış köşe açıklığı kapansın)
      const ext = 0.08;
      const strip = (v0: number, v1: number, key: string, off: number) => {
        const ring: V2[] = [q(-ext, v0), q(L + ext, v0), q(L + ext, v1), q(-ext, v1)];
        b.drape(key, ring, [], H, off, 1, 2);
        return ring;
      };
      for (const bd of lay.bands) {
        strip(bd.v0, bd.v1, bd.key, bd.h);
        if (bd.h > 0.06) raised.push({ poly: [q(0, bd.v0), q(L, bd.v0), q(L, bd.v1), q(0, bd.v1)], h: bd.h });
      }
      const top = lay.bands.length ? lay.bands[lay.bands.length - 1].h : kerbH;
      if (lay.tactile && lay.tactile[0] > 0.3)
        strip(
          lay.tactile[0] - lay.tactile[1] / 2,
          lay.tactile[0] + lay.tactile[1] / 2,
          'tactile',
          top + 0.006,
        );
      // Bordür taşları (1 m, yola bakan yüz dahil): yol kenarında + ara bordürler
      const kerbLine = (v: number, kh: number) => {
        if (kh < 0.05) return;
        const nS = Math.max(1, Math.round(L / 1));
        for (let k = 0; k < nS; k++) {
          const u0 = (L * k) / nS;
          const u1 = (L * (k + 1)) / nS;
          const c = q((u0 + u1) / 2, v + KERB_W / 2);
          const y = H(c[0], c[1]);
          b.box(
            'curb',
            [c[0], y + kh / 2 - 0.05, c[1]],
            [u1 - u0 - 0.006, kh + 0.1, KERB_W],
            Math.atan2(-t[1], t[0]),
          );
        }
      };
      if (lay.bands[0]?.v0 >= KERB_W - 1e-6) kerbLine(0, kerbH);
      for (const [v, kh] of lay.kerbs ?? []) kerbLine(v, kh);
      // Bisiklet şeridi (yol kotunda mavi boya) + dış kenarda beyaz kesikli çizgi
      // KARAR: bisiklet şeridi boyası çizilmez — iki eleştirmen turunda da gerçek karelerde mavi boya seçilemedi
      if (lay.bike && SHOW_BIKE) {
        strip(-lay.bike, 0, 'spBike', 0.075);
        for (let u = 0.5; u + 1 < L; u += 2) {
          const r: V2[] = [
            q(u, -lay.bike),
            q(u + 1, -lay.bike),
            q(u + 1, -lay.bike + 0.12),
            q(u, -lay.bike + 0.12),
          ];
          b.drape('spPaint', r, [], H, 0.08, 1, 1);
        }
      }
      // Bordürle OSM asfaltı arası boşluk kalmasın: yol tarafına asfalt dolgu (OSM yolunun altında kalır)
      strip(-3, 0.02, 'roadFill', 0.028);
      const full: V2[] = [q(0, 0), q(L, 0), q(L, sw.w), q(0, sw.w)];
      polys.push(full);
    }
  }
  // Sokak eşyası
  for (const s of plan.street ?? []) {
    const g0 = H(s.x, s.z);
    const onWalk = raised.find((r) => inside(r.poly, s.x, s.z));
    const y = g0 + (onWalk?.h ?? 0.15);
    const note = `${s.text ?? ''} ${s.note ?? ''}`.toLowerCase();
    const yaw = ((s.rot ?? 0) * Math.PI) / 180;
    switch (s.kind) {
      case 'lamp-post': {
        const h = s.h ?? 8;
        // Galvaniz konik direk + tek kol; kol yola (en yakın yol eksenine) doğru
        b.cylinder('pole', [s.x, y - 0.1, s.z], 0.085, h, 10);
        b.cylinder('pole', [s.x, y - 0.1, s.z], 0.13, 0.5, 10);
        let dx = Math.sin(yaw);
        let dz = -Math.cos(yaw);
        if (s.rot == null) {
          const d0 = roadCentre(s.x, s.z);
          let best = { d: d0, x: 0, z: 0 };
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const d = roadCentre(s.x + Math.cos(a) * 1.5, s.z + Math.sin(a) * 1.5);
            if (d < best.d) best = { d, x: Math.cos(a), z: Math.sin(a) };
          }
          if (best.d < d0) [dx, dz] = [best.x, best.z];
        }
        const ay = Math.atan2(dx, dz);
        b.box('pole', [s.x + dx * 0.8, y + h - 0.2, s.z + dz * 0.8], [0.06, 0.06, 1.6], ay);
        b.box('lampHead', [s.x + dx * 1.6, y + h - 0.3, s.z + dz * 1.6], [0.3, 0.12, 0.65], ay);
        break;
      }
      case 'pole':
        b.cylinder(
          /beton|concrete/.test(note) ? 'concretePole' : 'pole',
          [s.x, y - 0.1, s.z],
          0.11,
          s.h ?? 7,
          10,
        );
        break;
      case 'sign': {
        const h = s.h ?? 2.6;
        // Levha türleri (yukarıdan aşağı); duvar/kapı levhaları (h < 1.5) direksiz
        const keys: string[] = [];
        if (/viraj|curve|tehlike/.test(note)) keys.push('signCurve');
        if (/\b30\b/.test(note)) keys.push('sign30');
        if (/bisiklet|bike|cycle/.test(note)) keys.push('signBike');
        if (/park/.test(note)) keys.push('signP');
        if (/girilmez|no entry/.test(note)) keys.push('signNoEntry');
        if (/sola dönülmez|no left/.test(note)) keys.push('signNoLeft');
        if (!keys.length) break; // yazılı tabelalar (site adı vb.) ayrıca
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        const small = h < 1.5;
        const hw = small ? 0.16 : 0.33;
        if (!small) b.cylinder('pole', [s.x, y - 0.05, s.z], 0.035, h, 8);
        let top = small ? y + h + 0.2 : y + h - 0.04;
        for (const key of keys) {
          const A: V2 = [s.x - co * hw, s.z + si * hw];
          const E: V2 = [s.x + co * hw, s.z - si * hw];
          const ph = small ? 0.42 : 0.66;
          b.wall(key, A, E, top - ph, top);
          b.wall(`${key}Back`, E, A, top - ph, top);
          top -= ph + 0.04;
        }
        break;
      }
      case 'bin':
        // Belediye çöp kutusu: direk üstünde koyu yeşil kova
        b.cylinder('pole', [s.x, y - 0.05, s.z], 0.03, 1.0, 6);
        b.cylinder('binGreen', [s.x + 0.2, y + 0.45, s.z], 0.2, 0.55, 12);
        break;
      case 'bollard':
        // Turuncu esnek dikme (delinatör), beyaz yansıtıcı bantlı
        b.cylinder('bollardOrange', [s.x, g0, s.z], 0.04, s.h ?? 0.75, 8);
        b.cylinder('spPaint', [s.x, g0 + (s.h ?? 0.75) - 0.2, s.z], 0.042, 0.06, 8);
        break;
      case 'mirror': {
        // Trafik aynası: turuncu çerçeveli dışbükey daire
        const h = s.h ?? 2.8;
        b.cylinder('pole', [s.x, y - 0.05, s.z], 0.04, h, 8);
        const g = new THREE.SphereGeometry(0.4, 16, 8, 0, Math.PI * 2, 0, 0.5).rotateX(Math.PI / 2);
        g.rotateY(yaw);
        g.translate(s.x, y + h + 0.1, s.z);
        b.geometry('steel', g);
        const r = new THREE.TorusGeometry(0.2, 0.035, 6, 20).rotateY(yaw);
        r.translate(s.x, y + h + 0.1, s.z);
        b.geometry('bollardOrange', r);
        break;
      }
      case 'tree': {
        // Budanmış yuvarlak çalı (Street View: ~1.2 m şimşir topları); büyük ağaçlar vegetation'da
        if ((s.h ?? 5) >= 2) break;
        const h = s.h ?? 1.3;
        const g = new THREE.SphereGeometry(0.62, 14, 10);
        g.scale(1, (h * 0.9) / 1.24, 1);
        g.translate(s.x, g0 + 0.05 + h * 0.45, s.z);
        b.geometry('boxwood', g);
        break;
      }
      case 'drain': {
        // Yağmur ızgarası (bordür dibinde)
        const g = new THREE.PlaneGeometry(0.8, 0.4).rotateX(-Math.PI / 2).rotateY(yaw);
        g.translate(s.x, g0 + 0.035, s.z);
        b.geometry('darkMetal', g);
        break;
      }
      case 'bike-rack': {
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        for (let k = -2; k <= 2; k++) {
          const g = new THREE.TorusGeometry(0.38, 0.025, 6, 16, Math.PI).rotateY(yaw + Math.PI / 2);
          g.translate(s.x + co * k * 0.7, y, s.z - si * k * 0.7);
          b.geometry('steel', g);
        }
        break;
      }
      case 'hydrant':
        b.cylinder('hydrant', [s.x, y - 0.05, s.z], 0.1, 0.75, 10);
        break;
      case 'cabinet': {
        // Elektrik dağıtım panosu (not metnindeki ölçü: G×D×Y)
        const m = note.match(/([0-9.]+)\s*[×x]\s*([0-9.]+)\s*[×x]\s*([0-9.]+)/);
        const w = m ? Number(m[1]) : 0.9;
        const d = m ? Number(m[2]) : 0.4;
        const hh = m ? Number(m[3]) : (s.h ?? 1.3);
        b.box('cabinet', [s.x, y + hh / 2, s.z], [w, hh, d], yaw);
        b.box('cabinet', [s.x, y + hh + 0.02, s.z], [w + 0.06, 0.04, d + 0.06], yaw);
        break;
      }
      case 'scooter': {
        // Paylaşımlı e-scooter (turkuaz gövde)
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        b.box('scooter', [s.x, y + 0.1, s.z], [1.05, 0.06, 0.16], yaw);
        b.box('scooter', [s.x + co * 0.48, y + 0.6, s.z - si * 0.48], [0.05, 1.0, 0.05], yaw);
        b.box('darkMetal', [s.x + co * 0.48, y + 1.1, s.z - si * 0.48], [0.05, 0.04, 0.5], yaw);
        for (const u of [-0.45, 0.45])
          b.cylinder('darkMetal', [s.x + co * u, y + 0.1, s.z - si * u], 0.1, 0.05, 10);
        break;
      }
      case 'manhole': {
        const g = new THREE.CircleGeometry(0.33, 16).rotateX(-Math.PI / 2);
        g.translate(s.x, g0 + 0.045, s.z);
        b.geometry('darkMetal', g);
        break;
      }
      case 'tree-pit': {
        const r: V2[] = [
          [s.x - 0.6, s.z - 0.6],
          [s.x + 0.6, s.z - 0.6],
          [s.x + 0.6, s.z + 0.6],
          [s.x - 0.6, s.z + 0.6],
        ];
        b.drape('spMulch', r, [], H, (onWalk?.h ?? 0.15) + 0.008, 1, 2);
        break;
      }
      case 'bench': {
        // Ahşap çıtalı bank, siyah çelik ayak; rot: bakış yönü
        const co = Math.cos(yaw);
        const si = Math.sin(yaw);
        for (let k = 0; k < 3; k++) {
          const o = -0.12 + k * 0.12;
          b.box('wood', [s.x + si * o, y + 0.44, s.z + co * o], [1.7, 0.035, 0.09], yaw);
        }
        for (let k = 0; k < 2; k++) {
          const o = 0.22;
          b.box('wood', [s.x + si * o, y + 0.62 + k * 0.14, s.z + co * o], [1.7, 0.09, 0.03], yaw);
        }
        for (const u of [-0.7, 0.7])
          b.box('darkMetal', [s.x + co * u, y + 0.3, s.z - si * u], [0.05, 0.6, 0.5], yaw);
        break;
      }
    }
  }
  return { raised, covers: (x, z) => polys.some((p) => inside(p, x, z)) };
}
