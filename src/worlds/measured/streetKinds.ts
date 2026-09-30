import * as THREE from 'three';
import type { V2, V3 } from './builder';
import type { CK } from './facade';
import type { FurnCtx, StreetItem } from './streetFurniture';

/**
 * v8 (D4 — Özlüce Bulvarı / Uğur Mumcu / Muammer Aksoy): sokak planının yeni öğe türleri. Hepsi ölçülen konum /
 * ölçü / renkle; ölçülmeyen ayrıntı için yalnız tür varsayılanı (KARAR notlu) — renk uydurulmaz, verilmezse nottaki
 * açık renk sözcüğü (yaklaşık ton) ya da nötr malzeme:
 * gabion · bus-shelter · waste-container · bollard-light · low-fence · feather-flag · flower-arch · cart · mat ·
 * pouf · ac-unit · stone-bollard · kiosk (ATM) · ac-cage · statue.
 * Yön: `rot` pusula bakış yönü (streetFurniture.frame ile aynı); yoksa en yakın yol eksenine bakar (ctx.toRoad).
 */

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const hexOf = (v: unknown): string | null => (typeof v === 'string' && HEX.test(v) ? v : null);
const ck = (c: FurnCtx, kind: CK, hex: unknown, dflt: string) => {
  const h = hexOf(hex);
  return h && c.colorKey ? c.colorKey(kind, h) : dflt;
};

/**
 * Not metnindeki açık renk sözcüğü → yaklaşık ton (yalnız ölçülmüş hex yoksa). KARAR: sözcük görülen rengi söylüyor,
 * ton örneklenmedi — Türkiye sokak eşyasında yaygın doygunluk; ölçülünce `color` / `fg` alanı geçerlidir.
 */
const WORD_TONES: [RegExp, string][] = [
  [/turuncu|orange/, '#d9742e'],
  [/kırmızı|red\b/, '#b8282c'],
  [/yeşil|green/, '#2e6f3c'],
  [/mavi|blue/, '#1f4f9a'],
  [/sarı|yellow/, '#e0b52a'],
  [/beyaz|white/, '#ecebe6'],
  [/siyah|koyu|black|dark/, '#1f2124'],
];
export function wordTone(t: string): string | null {
  const s = t.toLocaleLowerCase('tr');
  for (const [re, hex] of WORD_TONES) if (re.test(s)) return hex;
  return null;
}

interface Frame {
  f: V2;
  t: V2;
  yaw: number;
}
function frameOf(c: FurnCtx, s: StreetItem): Frame {
  let f: V2;
  if (typeof s.rot === 'number') {
    const a = (s.rot * Math.PI) / 180;
    f = [Math.sin(a), -Math.cos(a)];
  } else f = c.toRoad?.(s.x, s.z) ?? [0, -1];
  const t: V2 = [f[1], -f[0]];
  return { f, t, yaw: Math.atan2(-t[1], t[0]) };
}
/** Yerel (lx yan, lz bakış) → dünya x,z */
const at = (s: { x: number; z: number }, F: Frame, lx: number, lz: number): V2 => [
  s.x + F.t[0] * lx + F.f[0] * lz,
  s.z + F.t[1] * lx + F.f[1] * lz,
];
function rect(s: { x: number; z: number }, F: Frame, w: number, d: number): [number, number][] {
  return [at(s, F, -w / 2, -d / 2), at(s, F, w / 2, -d / 2), at(s, F, w / 2, d / 2), at(s, F, -w / 2, d / 2)];
}
/** Yerel dikdörtgen yüz (lz düzleminde, bakış +f ya da −f), y0..y1 */
function faceAt(
  c: FurnCtx,
  key: string,
  s: { x: number; z: number },
  F: Frame,
  lx0: number,
  lx1: number,
  lz: number,
  y0: number,
  y1: number,
  back = false,
): void {
  const A = at(s, F, lx0, lz);
  const E = at(s, F, lx1, lz);
  // wall(a→e) normali (−(e−a).z, (e−a).x) = f (t = (f.z, −f.x) olduğundan a = −t tarafı)
  if (!back) c.b.wall(key, A, E, y0, y1, [0, 0, 1, 1]);
  else c.b.wall(key, E, A, y0, y1, [0, 0, 1, 1]);
}

function textFace(
  c: FurnCtx,
  text: string,
  bg: string | null,
  fg: string,
  w: number,
  h: number,
  lit = false,
) {
  if (!c.signFace) return null;
  return c.signFace({
    text,
    bg,
    fg,
    border: null,
    font: 'sans',
    bold: true,
    lit,
    style: bg ? 'box' : 'letters',
    w,
    h,
  });
}

/** Taş dolgulu tel kafes (gabion): taş dolgu (ölçülen ton) + galvaniz tel ızgara (10 cm göz) */
function gabion(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 2);
  const d = num(s.d, 1);
  const h = num(s.h, 0.8);
  let F = frameOf(c, s);
  // "≈3.5 m (yol boyunca)": uzun kenar yol boyunca (ölçülen rot bu yönle çelişiyorsa not geçerli — rot 0 = w doğu-batı)
  if (/yol boyunca|along the road/.test(`${s.note ?? ''}`)) {
    const r = c.toRoad?.(s.x, s.z);
    if (r) F = { f: r, t: [r[1], -r[0]], yaw: Math.atan2(r[0], r[1]) };
  }
  const stone = ck(c, 'plaster', s.color, 'stone');
  c.b.box(stone, [s.x, y + h / 2, s.z], [w - 0.03, h - 0.02, d - 0.03], F.yaw);
  // KARAR: tel rengi / gözü ölçülmedi → galvaniz gri, 10 cm kare göz (standart gabion)
  const wire = c.colorKey ? c.colorKey('cage:0.1', '#a4a8a9') : 'wire';
  c.b.box(wire, [s.x, y + h / 2, s.z], [w, h, d], F.yaw);
  c.collide?.(rect(s, F, w, d), y - 0.1, y + h);
}

/** Otobüs durağı sığınağı: çerçeve dikmeleri, cam arka / yan paneller, düz çatı, oturak, reklam panoları */
function busShelter(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 4);
  const d = num(s.d, 1.5);
  const h = num(s.h, 2.5);
  const F = frameOf(c, s);
  const fk = ck(c, 'metal', s.color, 'steel');
  const gk = ck(c, 'glass', s.glass, 'mkRailGlass');
  const P = (lx: number, lz: number, yy: number): V3 => {
    const q = at(s, F, lx, lz);
    return [q[0], yy, q[1]];
  };
  // Reklam / bilgi panoları: `ads` [{end: start|end, color, lit}] (start = yüze bakınca sol uç) ya da nottan
  // ("güney ucunda turuncu ışıklı reklam panosu", "iki koyu reklam/bilgi panosu")
  type Ad = { end?: string; color?: string; lit?: boolean };
  let ads: Ad[] = Array.isArray(s.ads) ? (s.ads as Ad[]) : s.ad ? [s.ad as Ad] : [];
  const note = `${s.note ?? ''}`.toLocaleLowerCase('tr');
  if (!ads.length && /reklam|bilgi pano/.test(note)) {
    const m = /([^.;]*?)(reklam|bilgi pano)[^.;]*/.exec(note);
    const phrase = m ? m[0] : note;
    const col = wordTone(phrase) ?? '#1f2124';
    const lit = /ışıklı|aydınlatmalı|lit/.test(phrase);
    const dirs: Record<string, V2> = { güney: [0, 1], kuzey: [0, -1], doğu: [1, 0], batı: [-1, 0] };
    const dm = /(güney|kuzey|doğu|batı)\s+ucu/.exec(phrase);
    if (dm) {
      const dv = dirs[dm[1]];
      ads = [{ end: F.t[0] * dv[0] + F.t[1] * dv[1] > 0 ? 'end' : 'start', color: col, lit }];
    } else if (/\biki\b|\b2\b/.test(phrase))
      ads = [
        { end: 'start', color: col, lit },
        { end: 'end', color: col, lit },
      ];
    else ads = [{ end: 'end', color: col, lit }];
  }
  const adEnds = new Set<number>(ads.map((a) => (a.end === 'start' ? -1 : 1)));
  // Dikmeler (4 köşe)
  for (const lx of [-w / 2 + 0.05, w / 2 - 0.05])
    for (const lz of [-d / 2 + 0.05, d / 2 - 0.08]) {
      const q = at(s, F, lx, lz);
      c.b.box(fk, [q[0], y + h / 2, q[1]], [0.07, h, 0.07], F.yaw);
    }
  // Çatı (öne ve yanlara taşan ince levha)
  const rc = at(s, F, 0, 0.05);
  c.b.box(fk, [rc[0], y + h + 0.04, rc[1]], [w + 0.2, 0.08, d + 0.3], F.yaw);
  // Arka cam (iki yüz) + alt/üst kayıt
  faceAt(c, gk, s, F, -w / 2 + 0.08, w / 2 - 0.08, -d / 2 + 0.05, y + 0.12, y + h - 0.1);
  faceAt(c, gk, s, F, -w / 2 + 0.08, w / 2 - 0.08, -d / 2 + 0.05, y + 0.12, y + h - 0.1, true);
  for (const yy of [y + 0.12, y + h - 0.1]) {
    const q = at(s, F, 0, -d / 2 + 0.05);
    c.b.box(fk, [q[0], yy, q[1]], [w - 0.1, 0.05, 0.05], F.yaw);
  }
  // Yanlar: cam ya da reklam panosu
  for (const sg of [-1, 1]) {
    const lx = sg * (w / 2 - 0.05);
    const A = P(lx, -d / 2 + 0.08, 0);
    const E = P(lx, d / 2 - 0.3, 0);
    const A2: V2 = [A[0], A[2]];
    const E2: V2 = [E[0], E[2]];
    const ad = ads.find((a) => (a.end === 'start' ? -1 : 1) === sg);
    if (!adEnds.has(sg)) {
      c.b.wall(gk, A2, E2, y + 0.12, y + h - 0.1);
      c.b.wall(gk, E2, A2, y + 0.12, y + h - 0.1);
    } else if (ad) {
      // KARAR: pano ölçüsü ölçülmedi → kutu 0.14 × (d − 0.4) × 1.75, alt kenar 0.3 (yaygın durak panosu)
      const pd = d - 0.4;
      const ph = 1.75;
      const pc = at(s, F, lx, -d / 2 + 0.08 + pd / 2);
      const col = hexOf(ad.color) ?? '#1f2124';
      c.b.box(fk, [pc[0], y + 0.3 + ph / 2, pc[1]], [0.14, ph + 0.08, pd + 0.08], F.yaw);
      const key = textFace(c, '', col, '#ffffff', pd, ph, !!ad.lit) ?? ck(c, 'fascia', col, 'billboardFace');
      // İki geniş yüz (±t yönünde): yerel çerçeve t'ye dönük
      const G: Frame = { f: F.t, t: [F.t[1], -F.t[0]], yaw: 0 };
      const cc = { x: pc[0], z: pc[1] };
      faceAt(c, key, cc, G, -pd / 2, pd / 2, 0.075, y + 0.3, y + 0.3 + ph);
      faceAt(
        c,
        key,
        cc,
        { f: [-F.t[0], -F.t[1]], t: [-F.t[1], F.t[0]], yaw: 0 },
        -pd / 2,
        pd / 2,
        0.075,
        y + 0.3,
        y + 0.3 + ph,
      );
    }
  }
  // Oturak (arka camın önünde) — KARAR: oturak ölçüsü görülmedi → 0.45 m kot, 0.35 derinlik, yarı boy
  const bc = at(s, F, 0, -d / 2 + 0.3);
  c.b.box(fk, [bc[0], y + 0.45, bc[1]], [Math.min(w * 0.6, 2.4), 0.05, 0.35], F.yaw);
  for (const lx of [-w * 0.25, w * 0.25]) {
    const q = at(s, F, lx, -d / 2 + 0.3);
    c.b.box(fk, [q[0], y + 0.22, q[1]], [0.05, 0.45, 0.3], F.yaw);
  }
  const back = [
    at(s, F, -w / 2, -d / 2),
    at(s, F, w / 2, -d / 2),
    at(s, F, w / 2, -d / 2 + 0.12),
    at(s, F, -w / 2, -d / 2 + 0.12),
  ];
  c.collide?.(back, y - 0.1, y + h);
}

/** Tekerlekli galvaniz çöp konteyneri (1100 L): gövde, taşan kapak, 4 teker, ön yüzde yazı */
function wasteContainer(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 1.37);
  const d = num(s.d, 1.07);
  const h = num(s.h, 1.3);
  const F = frameOf(c, s);
  const mk = ck(c, 'metal', s.color, 'steel');
  const lk = ck(c, 'metal', s.lidC ?? s.color, mk);
  const wh = 0.2;
  c.b.box(mk, [s.x, y + wh + (h - wh - 0.07) / 2, s.z], [w, h - wh - 0.07, d], F.yaw);
  c.b.box(lk, [s.x, y + h - 0.035, s.z], [w + 0.04, 0.07, d + 0.08], F.yaw);
  for (const lx of [-w / 2 + 0.12, w / 2 - 0.12])
    for (const lz of [-d / 2 + 0.12, d / 2 - 0.12]) {
      const q = at(s, F, lx, lz);
      c.b.cylinder('black', [q[0], y, q[1]], 0.1, wh, 10);
    }
  const text = typeof s.text === 'string' ? s.text : '';
  if (text) {
    // Yazı rengi: `fg`; yoksa notta "… yeşil "…" yazısı" (yazıdan hemen önceki renk sözcüğü); yoksa koyu
    const nt = `${s.note ?? ''}`;
    const fg =
      hexOf(s.fg) ?? (/yazı/.test(nt) ? wordTone(nt.split(/yazı/)[0].slice(-40)) : null) ?? '#1f2124';
    const key = textFace(c, text, null, fg, w * 0.85, 0.16);
    if (key) faceAt(c, key, s, F, -w * 0.425, w * 0.425, d / 2 + 0.006, y + h * 0.62, y + h * 0.62 + 0.16);
  }
  c.collide?.(rect(s, F, w, d), y - 0.1, y + h);
}

/** Küre başlı alçak aydınlatma: direk + opal küre; "yer lambası" / h ≤ 0.6 → yerde küre (çap h) */
function bollardLight(c: FurnCtx, s: StreetItem, y: number): void {
  const h = num(s.h, 0.7);
  const note = `${s.note ?? ''}`;
  if (/yer lambası|küre yer|ground globe/.test(note) || h <= 0.55) {
    c.b.sphere('globe', [s.x, y + h / 2, s.z], h / 2, 16);
    return;
  }
  // KARAR: küre çapı ölçülmedi → 0.3 m (bahçe küre armatürü)
  const R = 0.15;
  c.b.cylinder(ck(c, 'metal', s.color, 'steel'), [s.x, y - 0.02, s.z], 0.05, h - 2 * R + 0.04, 10);
  c.b.sphere('globe', [s.x, y + h - R, s.z], R, 16);
}

/** Alçak teras çiti / paneli: pts boyunca dolu panel + dikmeler (her ≤1.6 m) + üst kayıt */
function lowFence(c: FurnCtx, s: StreetItem): void {
  const pts = (s.pts as V2[] | undefined) ?? [];
  if (pts.length < 2) return;
  const h = num(s.h, 1);
  const pk = ck(c, 'metal', s.color, 'darkMetal');
  // KARAR: dolgu tipi (cam / çubuk / pano) ayrı ölçülmedi → aynı renkte dolu ince panel
  const fk = ck(c, 'plaster', s.color, 'kamSlab');
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const e = pts[i + 1];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 0.05) continue;
    const y0 = Math.min(c.H(a[0], a[1]) + c.walk(a[0], a[1]), c.H(e[0], e[1]) + c.walk(e[0], e[1]));
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const yaw = Math.atan2(-t[1], t[0]);
    const m: V2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    c.b.box(fk, [m[0], y0 + 0.05 + (h - 0.1) / 2, m[1]], [L, h - 0.1, 0.03], yaw);
    c.b.box(pk, [m[0], y0 + h - 0.02, m[1]], [L, 0.04, 0.05], yaw);
    const n = Math.max(1, Math.ceil(L / 1.6));
    for (let k = i ? 1 : 0; k <= n; k++) {
      const p: V2 = [a[0] + (t[0] * L * k) / n, a[1] + (t[1] * L * k) / n];
      c.b.box(pk, [p[0], y0 + h / 2, p[1]], [0.05, h, 0.05], yaw);
    }
    c.collide?.(
      [
        [a[0] - t[1] * 0.04, a[1] + t[0] * 0.04],
        [e[0] - t[1] * 0.04, e[1] + t[0] * 0.04],
        [e[0] + t[1] * 0.04, e[1] - t[0] * 0.04],
        [a[0] + t[1] * 0.04, a[1] - t[0] * 0.04],
      ],
      y0 - 0.1,
      y0 + h,
    );
  }
}

/**
 * Yelken (tüy) bayrak: esnek direk + dikey, dış üst köşesi yuvarlatılmış kumaş; yazı direk boyunca (alttan
 * yukarı okunur). KARAR: kumaş eni ölçülmedi → h × 0.25 (en çok 0.8 m), kumaş direk tepesinden h × 0.2'ye.
 */
function featherFlag(c: FurnCtx, s: StreetItem, y: number): void {
  const h = num(s.h, 3);
  const F = frameOf(c, s);
  const col = hexOf(s.color) ?? '#c8c8c8';
  c.b.cylinder('steel', [s.x, y - 0.05, s.z], 0.018, h + 0.05, 6);
  const cw = Math.min(0.8, h * 0.25);
  const y0 = y + Math.max(0.3, h * 0.2);
  const y1 = y + h - 0.03;
  const CL = y1 - y0;
  const light = new THREE.Color(col).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6;
  const key =
    textFace(
      c,
      typeof s.text === 'string' ? s.text : '',
      col,
      hexOf(s.fg) ?? (light ? '#1f1f20' : '#ffffff'),
      CL,
      cw,
    ) ?? ck(c, 'awning', col, 'instFabric');
  // Kumaş ızgarası: v (0 alt … 1 üst) × u (0 direk … 1 dış kenar); dış kenar üstte çeyrek elips
  const NV = 14;
  const NU = 3;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const widthAt = (v: number) => (v < 0.72 ? 1 : Math.sqrt(Math.max(0, 1 - ((v - 0.72) / 0.28) ** 2)));
  for (let i = 0; i <= NV; i++) {
    const v = i / NV;
    for (let j = 0; j <= NU; j++) {
      const u = (j / NU) * widthAt(v);
      const lx = 0.03 + u * cw;
      // Hafif kavis (rüzgârda şişkin): bakış yönünde en çok 4 cm
      const lz = 0.04 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
      const q = at(s, F, lx, lz);
      pos.push(q[0], y0 + v * CL, q[1]);
      // Doku yatay (en = kumaş boyu): x → yukarı, y → direkten dışa (yazının üstü direk tarafı)
      uv.push(v, 1 - u);
    }
  }
  for (let i = 0; i < NV; i++)
    for (let j = 0; j < NU; j++) {
      const a = i * (NU + 1) + j;
      const b2 = a + NU + 1;
      idx.push(a, a + 1, b2 + 1, a, b2 + 1, b2);
    }
  for (const side of [1, -1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(side > 0 ? idx : idx.map((_, k) => idx[k - (k % 3) + (2 - (k % 3))]));
    g.computeVertexNormals();
    c.b.geometry(key, g);
  }
}

/** Çiçek kemeri (yapay çiçekli yay): yarım elips boru, iki ayak; yüz yola / rot'a bakar */
function flowerArch(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 3);
  const h = num(s.h, 3);
  const F = frameOf(c, s);
  const key = ck(c, 'awning', s.color, 'roseRed');
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 24; k++) {
    const th = Math.PI - (k / 24) * Math.PI;
    const q = at(s, F, (Math.cos(th) * w) / 2, 0);
    pts.push(new THREE.Vector3(q[0], y + Math.sin(th) * (h - 0.2), q[1]));
  }
  // KARAR: kemer kalınlığı ölçülmedi → Ø 0.4 m çiçek kümesi
  c.b.geometry(key, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.2, 8, false));
}

/** Teşhir arabası sırası: n araba w boyunca, raflı kasa + tekerler, önde yazı bandı */
function cart(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 1.4);
  const d = num(s.d, 0.6);
  const h = num(s.h, 1);
  const n = Math.max(1, Math.min(8, Math.round(num(s.n, 1))));
  const F = frameOf(c, s);
  const k = ck(c, 'metal', s.color, 'steel');
  const cw = w / n - 0.05;
  const text = typeof s.text === 'string' ? s.text : '';
  const txt = text ? textFace(c, text, hexOf(s.color), hexOf(s.fg) ?? '#ffffff', cw * 0.95, 0.22) : null;
  for (let i = 0; i < n; i++) {
    const lx = -w / 2 + (w / n) * (i + 0.5);
    const cc = at(s, F, lx, 0);
    const o = { x: cc[0], z: cc[1] };
    for (const yy of [0.25, 0.6, h - 0.03]) c.b.box(k, [cc[0], y + yy, cc[1]], [cw, 0.03, d], F.yaw);
    for (const ux of [-cw / 2 + 0.02, cw / 2 - 0.02])
      for (const uz of [-d / 2 + 0.02, d / 2 - 0.02]) {
        const q = at(o, F, ux, uz);
        c.b.box(k, [q[0], y + 0.08 + (h - 0.08) / 2, q[1]], [0.03, h - 0.08, 0.03], F.yaw);
        c.b.cylinder('black', [q[0], y, q[1]], 0.05, 0.08, 8);
      }
    // Ön yazı bandı (üst rafın altında)
    c.b.box(k, [at(o, F, 0, d / 2)[0], y + h - 0.16, at(o, F, 0, d / 2)[1]], [cw, 0.26, 0.02], F.yaw);
    if (txt) faceAt(c, txt, o, F, -cw * 0.475, cw * 0.475, d / 2 + 0.012, y + h - 0.28, y + h - 0.05);
  }
  c.collide?.(rect(s, F, w, d), y - 0.1, y + h);
}

/** Giriş paspası: w × d ince dikdörtgen, yürüme yüzeyinin 1 cm üstünde */
function mat(c: FurnCtx, s: StreetItem): void {
  const F = frameOf(c, s);
  const r = rect(s, F, num(s.w, 1.2), num(s.d, 0.8));
  const off = c.walk(s.x, s.z) + 0.01;
  c.b.drape(ck(c, 'fascia', s.color, 'darkMetal'), r, [], c.H, off, 1, 2);
}

/** Puf sırası: n silindir w boyunca */
function pouf(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 1);
  const d = num(s.d, 0.5);
  const h = num(s.h, 0.4);
  const n = Math.max(1, Math.min(12, Math.round(num(s.n, 1))));
  const F = frameOf(c, s);
  const k = ck(c, 'fascia', s.color, 'wood');
  const r = Math.max(0.1, Math.min(d, w / n) / 2 - 0.02);
  for (let i = 0; i < n; i++) {
    const q = at(s, F, -w / 2 + (w / n) * (i + 0.5), 0);
    const g = new THREE.CylinderGeometry(r, r, h, 16);
    g.translate(q[0], y + h / 2, q[1]);
    c.b.geometry(k, g);
  }
}

/** Klima dış ünitesi (yerde): kutu + ön yüzde fan ızgarası + ayaklar */
function acUnit(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 0.8);
  const d = num(s.d, 0.3);
  const h = num(s.h, 0.6);
  const F = frameOf(c, s);
  const k = ck(c, 'plaster', s.color, 'mkAc');
  c.b.box(k, [s.x, y + 0.08 + h / 2, s.z], [w, h, d], F.yaw);
  for (const lx of [-w / 2 + 0.08, w / 2 - 0.08]) {
    const q = at(s, F, lx, 0);
    c.b.box('darkMetal', [q[0], y + 0.04, q[1]], [0.06, 0.08, d + 0.06], F.yaw);
  }
  const R = Math.min(h, w) * 0.36;
  const fc = at(s, F, -w * 0.15, d / 2 + 0.004);
  const g = new THREE.CircleGeometry(R, 20).rotateY(Math.atan2(F.f[0], F.f[1]));
  g.translate(fc[0], y + 0.08 + h / 2, fc[1]);
  c.b.geometry('darkMetal', g);
}

/** Taş baba: silindir gövde + kubbe tepe */
function stoneBollard(c: FurnCtx, s: StreetItem, y: number): void {
  const h = num(s.h, 0.5);
  // KARAR: çap ölçülmedi → 0.3 m
  const R = num(s.r, 0.15);
  const k = ck(c, 'plaster', s.color, 'stone');
  const g = new THREE.CylinderGeometry(R, R * 1.05, h - R * 0.6, 14);
  g.translate(s.x, y + (h - R * 0.6) / 2, s.z);
  c.b.geometry(k, g);
  const top = new THREE.SphereGeometry(R, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  top.scale(1, 0.6, 1);
  top.translate(s.x, y + h - R * 0.6, s.z);
  c.b.geometry(k, top);
}

/** ATM kulübesi: renkli kutu, ön yüzde ışıklı marka bandı + koyu ekran / tuş takımı paneli, üst şapka */
function kiosk(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 1);
  const d = num(s.d, 1);
  const h = num(s.h, 2.4);
  const F = frameOf(c, s);
  const col = hexOf(s.color) ?? '#c8c8c8';
  const k = ck(c, 'fascia', col, 'kamSlab');
  c.b.box(k, [s.x, y + h / 2, s.z], [w, h, d], F.yaw);
  c.b.box(k, [s.x, y + h + 0.04, s.z], [w + 0.08, 0.08, d + 0.08], F.yaw);
  // KARAR: ATM yüzü ölçülmedi → koyu panel 0.55 × 0.7, alt kenar 0.9 (standart ATM yüksekliği)
  const pc = at(s, F, 0, d / 2 + 0.01);
  c.b.box('black', [pc[0], y + 1.25, pc[1]], [Math.min(0.55, w * 0.7), 0.7, 0.03], F.yaw);
  const text = typeof s.text === 'string' ? s.text : '';
  if (text) {
    const key = textFace(c, text, col, hexOf(s.fg) ?? '#ffffff', w * 0.96, 0.32, true);
    if (key) faceAt(c, key, s, F, -w * 0.48, w * 0.48, d / 2 + 0.006, y + h - 0.42, y + h - 0.1);
  }
  c.collide?.(rect(s, F, w, d), y - 0.1, y + h);
}

/** Kafesli klima grubu: çokgen taban, h yükseklik tel kafes (ölçülen tel rengi) + içinde ünite kütlesi */
function acCage(c: FurnCtx, s: StreetItem): void {
  const poly = (s.poly as V2[] | undefined) ?? [];
  if (poly.length < 3) return;
  const h = num(s.h, 1.8);
  const y0 = Math.min(...poly.map((p) => c.H(p[0], p[1]) + c.walk(p[0], p[1])));
  const cage = c.colorKey && hexOf(s.color) ? c.colorKey('cage:0.05', hexOf(s.color)!) : 'mkMesh';
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const e = poly[(i + 1) % poly.length];
    c.b.wall(cage, a, e, y0, y0 + h, [0, 0, Math.hypot(e[0] - a[0], e[1] - a[1]), h]);
    c.b.box('darkMetal', [a[0], y0 + h / 2, a[1]], [0.05, h, 0.05]);
  }
  c.b.polygon(cage, poly, y0 + h);
  // Üniteler: kafesin 0.12 m içinde (KARAR: ünite sayısı / boyu seçilmedi → tek kütle, cepheli klima tonu)
  const inner = poly.map((p) => {
    const dx = p[0] - cx;
    const dz = p[1] - cz;
    const L = Math.hypot(dx, dz) || 1;
    const k = Math.max(0.3, (L - 0.15) / L);
    return [cx + dx * k, cz + dz * k] as V2;
  });
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const e = inner[(i + 1) % inner.length];
    c.b.wall('mkAc', a, e, y0, y0 + h * 0.75);
  }
  c.b.polygon('mkAc', inner, y0 + h * 0.75);
  c.collide?.(
    poly.map((p) => [p[0], p[1]] as [number, number]),
    y0 - 0.1,
    y0 + h,
  );
}

/**
 * Heykel / reklam figürü: "lobut" (bowling) → lobut profili (döndürme yüzeyi; oran standart lobuttan), diğerleri
 * kaide + sütun (biçim görülmedi — yalnız hacim).
 */
function statue(c: FurnCtx, s: StreetItem, y: number): void {
  const h = num(s.h, 2);
  const k = ck(c, 'plaster', s.color, 'mkAc');
  const note = `${s.note ?? ''}`.toLocaleLowerCase('tr');
  if (/lobut|bowling/.test(note)) {
    // r/H: taban 0.07, karın 0.158 @0.29, boyun 0.06 @0.66, baş 0.084 @0.84, tepe 0 (ABD standart lobut 38 cm)
    const prof: [number, number][] = [
      [0.0, 0],
      [0.07, 0],
      [0.12, 0.1],
      [0.158, 0.29],
      [0.13, 0.45],
      [0.075, 0.6],
      [0.06, 0.67],
      [0.075, 0.76],
      [0.084, 0.84],
      [0.07, 0.93],
      [0.035, 0.985],
      [0.0, 1],
    ];
    const g = new THREE.LatheGeometry(
      prof.map(([r, t]) => new THREE.Vector2(Math.max(0.001, r * h), t * h)),
      20,
    );
    g.translate(s.x, y, s.z);
    c.b.geometry(k, g);
    c.collide?.(
      [
        [s.x - 0.16 * h, s.z - 0.16 * h],
        [s.x + 0.16 * h, s.z - 0.16 * h],
        [s.x + 0.16 * h, s.z + 0.16 * h],
        [s.x - 0.16 * h, s.z + 0.16 * h],
      ],
      y - 0.1,
      y + h,
    );
    return;
  }
  c.b.box(k, [s.x, y + 0.2, s.z], [0.8, 0.4, 0.8]);
  c.b.cylinder(k, [s.x, y + 0.4, s.z], 0.25, h - 0.4, 12);
}

/** v8 türleri; işlenmediyse false */
export function buildStreetKind(c: FurnCtx, s: StreetItem, y: number): boolean {
  switch (s.kind) {
    case 'gabion':
      gabion(c, s, y);
      return true;
    case 'bus-shelter':
      busShelter(c, s, y);
      return true;
    case 'waste-container':
      wasteContainer(c, s, y);
      return true;
    case 'bollard-light':
      bollardLight(c, s, y);
      return true;
    case 'low-fence':
      lowFence(c, s);
      return true;
    case 'feather-flag':
      featherFlag(c, s, y);
      return true;
    case 'flower-arch':
      flowerArch(c, s, y);
      return true;
    case 'cart':
      cart(c, s, y);
      return true;
    case 'mat':
      mat(c, s);
      return true;
    case 'pouf':
      pouf(c, s, y);
      return true;
    case 'ac-unit':
      acUnit(c, s, y);
      return true;
    case 'stone-bollard':
      stoneBollard(c, s, y);
      return true;
    case 'kiosk':
      kiosk(c, s, y);
      return true;
    case 'ac-cage':
      acCage(c, s);
      return true;
    case 'statue':
      statue(c, s, y);
      return true;
    case 'steps-note':
      // Cephe öğesi kaydı (sokak katmanında çizilmez — cephe ajanının steps öğesi)
      return true;
  }
  return false;
}
