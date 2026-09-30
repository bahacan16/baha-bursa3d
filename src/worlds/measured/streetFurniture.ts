import * as THREE from 'three';
import type { Builder, V2, V3 } from './builder';
import type { CK, CPergola, SignSpec } from './facade';
import { buildPergola } from './facade';
import { buildStreetKind } from './streetKinds';

/**
 * v7 (D4 — Özlüce Bulvarı restoran önleri): sokak planı (street-plan.json `street`) öğeleri — kış bahçesi
 * kapatması, sokak pergolası, rüzgâr camı, hız kesici ve ÖRNEKLENEN (instanced) sokak eşyası: kafe masası /
 * sandalyesi, şemsiye, ısıtıcı, saksı, A-pano, totem, menü standı. Tümü ölçülen konum / boy / renkle; ölçülmeyen
 * alan için yalnız tür varsayılanı (ör. masa yüksekliği 0.75) — renk uydurulmaz (verilmezse nötr malzeme).
 *
 * Örneklenen eşya: `Builder.instance` (tür başına tek geometri, kova başına tek InstancedMesh; `inst*` kovalarında
 * örnek rengi) — yüzlerce masa / sandalye tek çizim çağrısı.
 */

export type Collide = (ring: [number, number][], bottom: number, top: number) => void;

/** Sokak öğesinin ortak alanları (siteplan.ts StreetPlan.street) */
export interface StreetItem {
  kind: string;
  id?: string;
  x: number;
  z: number;
  h?: number;
  w?: number;
  d?: number;
  rot?: number;
  text?: string;
  note?: string;
  [k: string]: unknown;
}

export interface FurnCtx {
  b: Builder;
  H: (x: number, z: number) => number;
  /** Yürüme yüzeyi kotu (arazinin üstünde m) — kaldırım bandı / ada / base */
  walk: (x: number, z: number) => number;
  colorKey?: (kind: CK | 'encglass' | 'interior', hex: string) => string;
  signFace?: (s: SignSpec) => string;
  collide?: Collide;
  /** v8: noktadan en yakın yol eksenine birim yön (yön ölçülmemiş eşyanın bakışı); yol yoksa null */
  toRoad?: (x: number, z: number) => V2 | null;
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Renk ölçülmemişse nötr gri (örnek rengi zorunlu; görülen renk yazılmalı) */
const NEUTRAL = '#c8c8c8';
const colOf = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v : NEUTRAL);
const ckOf = (c: FurnCtx, kind: CK | 'encglass' | 'interior', hex: unknown, dflt: string) =>
  typeof hex === 'string' && HEX.test(hex) && c.colorKey ? c.colorKey(kind, hex) : dflt;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** rot (pusula derecesi) → bakış yönü (sin, −cos) ve yaw (Builder.box / rotateY) */
function frame(rot: number | undefined): { f: V2; t: V2; yaw: number } {
  const a = ((rot ?? 0) * Math.PI) / 180;
  const f: V2 = [Math.sin(a), -Math.cos(a)];
  // Yan yön: f'nin sağı (wall(a→e) normali f olsun diye t = (f.z, −f.x))
  const t: V2 = [f[1], -f[0]];
  return { f, t, yaw: Math.atan2(-t[1], t[0]) };
}

const place = (x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(sx, sy, sz),
  );

/** Örnek prototipleri (yerel: taban y = 0, ön +z yerine bakış −z; ölçek matrisle) */
const PROTO = {
  /** Masa: tabla (inst renk) + ayak (koyu metal); birim çap 1, yükseklik 1 */
  tableRound: (pb: Builder) => {
    const top = new THREE.CylinderGeometry(0.5, 0.5, 0.03, 20);
    top.translate(0, 0.985, 0);
    pb.geometry('instPaint', top);
    pb.cylinder('darkMetal', [0, 0, 0], 0.03, 0.97, 8);
    const ft = new THREE.CylinderGeometry(0.22, 0.25, 0.03, 12);
    ft.translate(0, 0.015, 0);
    pb.geometry('darkMetal', ft);
  },
  tableSquare: (pb: Builder) => {
    pb.box('instPaint', [0, 0.985, 0], [1, 0.03, 1]);
    pb.cylinder('darkMetal', [0, 0, 0], 0.03, 0.97, 8);
    pb.box('darkMetal', [0, 0.015, 0], [0.5, 0.03, 0.5]);
  },
  /** Sandalye: oturak + sırt (inst renk) + dört ayak; bakış −z (sırt +z tarafında) */
  chair: (pb: Builder) => {
    pb.box('instPaint', [0, 0.45, 0], [0.44, 0.04, 0.42]);
    pb.box('instPaint', [0, 0.72, 0.2], [0.44, 0.5, 0.03]);
    for (const [x, z] of [
      [-0.19, -0.18],
      [0.19, -0.18],
      [-0.19, 0.18],
      [0.19, 0.18],
    ])
      pb.box('darkMetal', [x, 0.225, z], [0.025, 0.45, 0.025]);
  },
  /** Şemsiye (açık, kare / yuvarlak): direk + dört / on iki dilimli kubbe (inst renk), birim en 1, tepe 1 */
  parasolSquare: (pb: Builder) => {
    pb.cylinder('darkMetal', [0, 0, 0], 0.02, 1, 8);
    const hs = 0.5;
    const rim = 0.86;
    const C: V3 = [0, 1, 0];
    const cs: V3[] = [
      [-hs, rim, -hs],
      [hs, rim, -hs],
      [hs, rim, hs],
      [-hs, rim, hs],
    ];
    for (let k = 0; k < 4; k++) {
      const a = cs[k];
      const e = cs[(k + 1) % 4];
      pb.quad('instFabric', a, e, C, C);
      pb.quad('instFabric', e, a, C, C);
      // Valans (sarkan saçak)
      pb.quad('instFabric', [a[0], rim - 0.08, a[2]], [e[0], rim - 0.08, e[2]], e, a);
      pb.quad('instFabric', [e[0], rim - 0.08, e[2]], [a[0], rim - 0.08, a[2]], a, e);
    }
  },
  parasolRound: (pb: Builder) => {
    pb.cylinder('darkMetal', [0, 0, 0], 0.02, 1, 8);
    const g = new THREE.ConeGeometry(0.5, 0.16, 16, 1, true);
    g.translate(0, 0.92, 0);
    pb.geometry('instFabric', g);
  },
  /** Kapalı şemsiye: direk + sarılı kumaş (ince koni) */
  parasolClosed: (pb: Builder) => {
    pb.cylinder('darkMetal', [0, 0, 0], 0.02, 1, 8);
    const g = new THREE.ConeGeometry(0.06, 0.45, 8, 1);
    g.rotateX(Math.PI);
    g.translate(0, 0.72, 0);
    pb.geometry('instFabric', g);
  },
  /** Mantar ısıtıcı: taban, direk, gaz haznesi, yansıtıcı şapka (inst renk metal); tepe 1 */
  heater: (pb: Builder) => {
    const base = new THREE.CylinderGeometry(0.22, 0.25, 0.08, 14);
    base.translate(0, 0.04, 0);
    pb.geometry('instMetal', base);
    pb.cylinder('instMetal', [0, 0.08, 0], 0.03, 0.8, 8);
    pb.cylinder('instMetal', [0, 0.1, 0], 0.16, 0.5, 12);
    const hat = new THREE.ConeGeometry(0.4, 0.12, 16, 1, true);
    hat.translate(0, 0.95, 0);
    pb.geometry('instMetal', hat);
    const burner = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10);
    burner.translate(0, 0.86, 0);
    pb.geometry('darkMetal', burner);
  },
};

function cafeSet(c: FurnCtx, s: StreetItem, y: number): void {
  const a0 = ((s.rot ?? 0) * Math.PI) / 180;
  const w = num(s.w, 0.7);
  const h = num(s.h, 0.75);
  const shape = s.shape === 'square' ? 'tableSquare' : 'tableRound';
  const tc = colOf(s.color);
  c.b.instance(shape, PROTO[shape], place(s.x, y, s.z, -a0, w, h, w), tc);
  // Sandalyeler: masanın çevresinde eşit açıyla (ilki rot yönünde), masaya bakar
  const n = Math.max(0, Math.min(8, Math.round(num(s.chairs, 0))));
  const cr = num(s.chairR, w / 2 + 0.35);
  const cc = typeof s.chairC === 'string' && HEX.test(s.chairC) ? s.chairC : tc;
  for (let k = 0; k < n; k++) {
    const ang = a0 + (k / n) * Math.PI * 2;
    const dx = Math.sin(ang);
    const dz = -Math.cos(ang);
    // Yerel −z (oturanın bakışı) masaya doğru: (−sin θ, −cos θ) = (−dx, −dz)
    c.b.instance('chair', PROTO.chair, place(s.x + dx * cr, y, s.z + dz * cr, Math.atan2(dx, dz)), cc);
  }
}

function parasol(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 2.5);
  const h = num(s.h, 2.4);
  const col = colOf(s.color);
  const yaw = -((s.rot ?? 0) * Math.PI) / 180;
  const open = s.open !== false;
  const id = !open ? 'parasolClosed' : s.shape === 'round' ? 'parasolRound' : 'parasolSquare';
  c.b.instance(id, PROTO[id], place(s.x, y, s.z, yaw, open ? w : 1, h, open ? w : 1), col);
  // Valans yazısı (marka): kare şemsiyenin ölçülen yüzlerinde, atlas yüzü (örnek değil). v8: dizi → yüz başına
  // ayrı yazı / renk ([{text, fg, bg, sides}], kenar 0..3 yerel −z'den saat yönü)
  type Val = { text?: string; fg?: string; bg?: string; sides?: number[] };
  const vals: Val[] = Array.isArray(s.valance) ? (s.valance as Val[]) : s.valance ? [s.valance as Val] : [];
  for (const vt of vals) parasolValance(c, s, y, vt, open && id === 'parasolSquare', w, h, col, yaw);
}

function parasolValance(
  c: FurnCtx,
  s: StreetItem,
  y: number,
  vt: { text?: string; fg?: string; bg?: string; sides?: number[] },
  square: boolean,
  w: number,
  h: number,
  col: string,
  yaw: number,
): void {
  if (square && vt?.text && c.signFace) {
    const hs = w / 2;
    const rim = h * 0.86;
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    const W = (lx: number, lz: number): V2 => [s.x + co * lx + si * lz, s.z - si * lx + co * lz];
    const key = c.signFace({
      text: vt.text,
      bg: vt.bg ?? col,
      fg: vt.fg ?? '#ffffff',
      border: null,
      font: 'sans',
      bold: true,
      lit: false,
      style: 'panel',
      w,
      h: 0.08 * h,
    });
    const sides = vt.sides ?? [0, 1, 2, 3];
    const cs: [number, number][] = [
      [-hs, -hs],
      [hs, -hs],
      [hs, hs],
      [-hs, hs],
    ];
    for (const k of sides) {
      const a = cs[k % 4];
      const e = cs[(k + 1) % 4];
      // Dışa bakan yüz: köşe sırası saat yönünün tersi (yerel), 5 mm dışarıda
      const m: [number, number] = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
      const ml = Math.hypot(m[0], m[1]) || 1;
      const o = 0.006 / ml;
      c.b.wall(
        key,
        W(e[0] * (1 + o), e[1] * (1 + o)),
        W(a[0] * (1 + o), a[1] * (1 + o)),
        y + rim - 0.08 * h,
        y + rim,
        [0, 0, 1, 1],
      );
    }
  }
}

function planter(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 0.6);
  const d = num(s.d, w);
  const h = num(s.h, 0.5);
  const { yaw } = frame(s.rot);
  const pk = ckOf(c, 'plaster', s.color, 'kamSlab');
  if (s.shape === 'round') {
    c.b.cylinder(pk, [s.x, y, s.z], w / 2, h, 16);
    const top = new THREE.CircleGeometry(w / 2 - 0.03, 16).rotateX(-Math.PI / 2);
    top.translate(s.x, y + h - 0.04, s.z);
    c.b.geometry('spMulch', top);
  } else {
    c.b.box(pk, [s.x, y + h / 2, s.z], [w, h, d], yaw);
    const g = new THREE.PlaneGeometry(w - 0.06, d - 0.06).rotateX(-Math.PI / 2).rotateY(yaw);
    g.translate(s.x, y + h - 0.04, s.z);
    c.b.geometry('spMulch', g);
  }
  const pl = s.plant as { h?: number; color?: string; shape?: string } | undefined;
  if (pl && (pl.h ?? 0) > 0.05) {
    const plK = ckOf(c, 'fascia', pl.color, 'boxwood');
    const ph = pl.h!;
    if (pl.shape === 'cone') {
      const g = new THREE.ConeGeometry(Math.min(w, d) * 0.4, ph, 10);
      g.translate(s.x, y + h + ph / 2 - 0.05, s.z);
      c.b.geometry(plK, g);
    } else if (pl.shape === 'hedge')
      c.b.box(plK, [s.x, y + h + ph / 2 - 0.05, s.z], [w - 0.04, ph, d - 0.04], yaw);
    else {
      const g = new THREE.SphereGeometry(0.5, 10, 7);
      g.scale(w * 0.9, ph, d * 0.9);
      g.rotateY(yaw);
      g.translate(s.x, y + h + ph / 2 - 0.08, s.z);
      c.b.geometry(plK, g);
    }
  }
  if (h >= 0.4) {
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    const W = (lx: number, lz: number): [number, number] => [
      s.x + co * lx + si * lz,
      s.z - si * lx + co * lz,
    ];
    c.collide?.([W(-w / 2, -d / 2), W(w / 2, -d / 2), W(w / 2, d / 2), W(-w / 2, d / 2)], y - 0.1, y + h);
  }
}

/** Yazı yüzü (tabela atlası) iki yanlı pano: merkez, yan yön t, bakış f, genişlik, alt / üst kot */
function signPanel(
  c: FurnCtx,
  s: StreetItem,
  cx: number,
  cz: number,
  t: V2,
  f: V2,
  w: number,
  y0: number,
  y1: number,
  off: number,
  both: boolean,
  style = 'panel',
): void {
  if (!c.signFace || !(s.text || (s.lines as unknown[] | undefined)?.length)) return;
  const key = c.signFace({
    text: s.text ?? '',
    lines: (s.lines as SignSpec['lines']) ?? null,
    bg: typeof s.bg === 'string' ? s.bg : null,
    fg: typeof s.fg === 'string' ? s.fg : '#ffffff',
    border: null,
    font: typeof s.font === 'string' ? s.font : 'sans',
    bold: s.bold !== false,
    lit: !!s.lit,
    style,
    w,
    h: y1 - y0,
  });
  const P = (u: number, o: number): V2 => [cx + t[0] * u + f[0] * o, cz + t[1] * u + f[1] * o];
  c.b.wall(key, P(-w / 2, off), P(w / 2, off), y0, y1, [0, 0, 1, 1]);
  if (both) c.b.wall(key, P(w / 2, -off), P(-w / 2, -off), y0, y1, [0, 0, 1, 1]);
}

function aframe(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 0.6);
  const h = num(s.h, 1.0);
  const { f, t } = frame(s.rot);
  const fk = ckOf(c, 'frame', s.color, 'darkMetal');
  const spread = 0.28 * h;
  // İki eğik pano (ön / arka), tepede birleşik
  for (const sg of [1, -1]) {
    const A: V3 = [s.x + f[0] * sg * spread - (t[0] * w) / 2, y, s.z + f[1] * sg * spread - (t[1] * w) / 2];
    const B: V3 = [s.x + f[0] * sg * spread + (t[0] * w) / 2, y, s.z + f[1] * sg * spread + (t[1] * w) / 2];
    const C: V3 = [s.x + (t[0] * w) / 2, y + h, s.z + (t[1] * w) / 2];
    const D: V3 = [s.x - (t[0] * w) / 2, y + h, s.z - (t[1] * w) / 2];
    c.b.quad(fk, sg > 0 ? A : B, sg > 0 ? B : A, sg > 0 ? C : D, sg > 0 ? D : C);
    c.b.quad(fk, sg > 0 ? B : A, sg > 0 ? A : B, sg > 0 ? D : C, sg > 0 ? C : D);
    if (c.signFace && s.text) {
      const key = c.signFace({
        text: s.text,
        lines: (s.lines as SignSpec['lines']) ?? null,
        bg: typeof s.bg === 'string' ? s.bg : null,
        fg: typeof s.fg === 'string' ? s.fg : '#ffffff',
        border: null,
        font: typeof s.font === 'string' ? s.font : 'sans',
        bold: s.bold !== false,
        lit: false,
        style: 'panel',
        w: w * 0.9,
        h: h * 0.7,
      });
      const k0 = 0.12;
      const k1 = 0.82;
      const L = (k: number, side: number): V3 => [
        s.x + f[0] * sg * (spread * (1 - k) + 0.01) + t[0] * side * w * 0.45,
        y + h * k,
        s.z + f[1] * sg * (spread * (1 - k) + 0.01) + t[1] * side * w * 0.45,
      ];
      // Dışa (±f) bakan yüz
      if (sg > 0) c.b.quad(key, L(k0, -1), L(k0, 1), L(k1, 1), L(k1, -1));
      else c.b.quad(key, L(k0, 1), L(k0, -1), L(k1, -1), L(k1, 1));
    }
  }
}

function totem(c: FurnCtx, s: StreetItem, y: number): void {
  const w = num(s.w, 0.8);
  const h = num(s.h, 3);
  const d = num(s.d, 0.3);
  const { f, t, yaw } = frame(s.rot);
  const bk = ckOf(c, 'fascia', s.color, 'darkMetal');
  // v9: ince yuvarlak gövde (`bodyW` çap) üstünde ayrı biçimli pano başı (`head` {shape: capsule, y0, y1, w, d,
  // color}): uçları yuvarlak dikey kapsül (yarıçap = en / 2), gövde tabandan başa kadar
  const hd = s.head as
    { shape?: string; y0?: number; y1?: number; w?: number; d?: number; color?: string } | undefined;
  if (hd && hd.shape === 'capsule' && num(s.bodyW, 0) > 0.02) {
    const hy0 = num(hd.y0, h * 0.6);
    const hy1 = Math.min(h, num(hd.y1, h));
    const hw = num(hd.w, w);
    const hdp = num(hd.d, d);
    const r = Math.min(hw / 2, (hy1 - hy0) / 2);
    c.b.cylinder(bk, [s.x, y - 0.05, s.z], num(s.bodyW, 0.45) / 2, hy0 + 0.05 + Math.min(0.3, r), 16);
    const sh = new THREE.Shape();
    sh.absarc(0, hy0 + r, r, Math.PI, 2 * Math.PI, false);
    sh.absarc(0, hy1 - r, r, 0, Math.PI, false);
    const g = new THREE.ExtrudeGeometry(sh, { depth: hdp, bevelEnabled: false, curveSegments: 12 });
    g.translate(0, 0, -hdp / 2);
    g.rotateY(yaw);
    g.translate(s.x, y, s.z);
    c.b.geometry(ckOf(c, 'fascia', hd.color ?? (s.bg as string | undefined), bk), g);
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    const W = (lx: number, lz: number): [number, number] => [
      s.x + co * lx + si * lz,
      s.z - si * lx + co * lz,
    ];
    const bw = num(s.bodyW, 0.45);
    c.collide?.(
      [W(-bw / 2, -bw / 2), W(bw / 2, -bw / 2), W(bw / 2, bw / 2), W(-bw / 2, bw / 2)],
      y - 0.1,
      y + h,
    );
    return;
  }
  c.b.box(bk, [s.x, y + h / 2, s.z], [w, h, d], yaw);
  // Kiracı levhaları (ölçülen satırlar: y0..y1 tabandan, yazı, renk) ya da tek yüz
  const panels =
    (s.panels as { y0: number; y1: number; text?: string; bg?: string; fg?: string }[] | undefined) ?? [];
  const both = s.faces !== 1;
  if (panels.length)
    for (const p of panels)
      signPanel(
        c,
        { ...s, text: p.text ?? '', bg: p.bg ?? s.bg, fg: p.fg ?? s.fg, lines: undefined },
        s.x,
        s.z,
        t,
        f,
        w * 0.9,
        y + p.y0,
        y + p.y1,
        d / 2 + 0.006,
        both,
      );
  else
    signPanel(
      c,
      s,
      s.x,
      s.z,
      t,
      f,
      w * 0.9,
      y + num(s.y0, h * 0.55),
      y + num(s.y1, h * 0.95),
      d / 2 + 0.006,
      both,
    );
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const W = (lx: number, lz: number): [number, number] => [s.x + co * lx + si * lz, s.z - si * lx + co * lz];
  c.collide?.([W(-w / 2, -d / 2), W(w / 2, -d / 2), W(w / 2, d / 2), W(-w / 2, d / 2)], y - 0.1, y + h);
}

function menuStand(c: FurnCtx, s: StreetItem, y: number): void {
  const h = num(s.h, 1.25);
  const { f, t, yaw } = frame(s.rot);
  const mk = ckOf(c, 'frame', s.color, 'darkMetal');
  const base = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14);
  base.translate(s.x, y + 0.01, s.z);
  c.b.geometry(mk, base);
  c.b.cylinder(mk, [s.x, y, s.z], 0.02, h - 0.3, 6);
  const bw = num(s.w, 0.4);
  const bh = 0.5;
  // Eğik pano (tablet): 25° geriye yatık
  const tilt = 0.44;
  const cy = y + h - 0.2;
  void yaw;
  const top: V3 = [
    s.x - f[0] * Math.sin(tilt) * bh * 0.5,
    cy + Math.cos(tilt) * bh * 0.5,
    s.z - f[1] * Math.sin(tilt) * bh * 0.5,
  ];
  const bot: V3 = [
    s.x + f[0] * Math.sin(tilt) * bh * 0.5,
    cy - Math.cos(tilt) * bh * 0.5,
    s.z + f[1] * Math.sin(tilt) * bh * 0.5,
  ];
  const Q = (p: V3, u: number): V3 => [p[0] + t[0] * u, p[1], p[2] + t[1] * u];
  c.b.quad(mk, Q(bot, -bw / 2), Q(bot, bw / 2), Q(top, bw / 2), Q(top, -bw / 2));
  c.b.quad(mk, Q(bot, bw / 2), Q(bot, -bw / 2), Q(top, -bw / 2), Q(top, bw / 2));
}

function windscreen(c: FurnCtx, s: StreetItem): void {
  const pts = (s.pts as V2[] | undefined) ?? [];
  if (pts.length < 2) return;
  const h = num(s.h, 1.5);
  const every = Math.max(0.4, num(s.every, 1.2));
  const gk = ckOf(c, 'glass', s.glass, 'mkRailGlass');
  const fk = ckOf(c, 'frame', s.frame, 'darkMetal');
  const bs = s.base as { h?: number; color?: string } | undefined;
  const bh = Math.max(0, bs?.h ?? 0);
  const bk = bs ? ckOf(c, 'plaster', bs.color, 'kamSlab') : fk;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const e = pts[i + 1];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 0.05) continue;
    const yA = c.H(a[0], a[1]) + c.walk(a[0], a[1]);
    const yE = c.H(e[0], e[1]) + c.walk(e[0], e[1]);
    const y0 = Math.min(yA, yE);
    const tt: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const yaw = Math.atan2(-tt[1], tt[0]);
    if (bh > 0.02) b3(c.b, bk, a, e, y0, y0 + bh, 0.08, yaw);
    c.b.wall(gk, a, e, y0 + bh, y0 + h - 0.03, [0, 0, L, h]);
    c.b.wall(gk, e, a, y0 + bh, y0 + h - 0.03, [0, 0, L, h]);
    const n = Math.max(1, Math.round(L / every));
    for (let k = 0; k <= n; k++) {
      const p: V2 = [a[0] + (tt[0] * L * k) / n, a[1] + (tt[1] * L * k) / n];
      c.b.box(fk, [p[0], y0 + h / 2, p[1]], [0.05, h, 0.05], yaw);
    }
    const m: V2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    c.b.box(fk, [m[0], y0 + h - 0.02, m[1]], [L, 0.04, 0.05], yaw);
    c.collide?.(
      [
        [a[0] - tt[1] * 0.04, a[1] + tt[0] * 0.04],
        [e[0] - tt[1] * 0.04, e[1] + tt[0] * 0.04],
        [e[0] + tt[1] * 0.04, e[1] - tt[0] * 0.04],
        [a[0] + tt[1] * 0.04, a[1] - tt[0] * 0.04],
      ],
      y0 - 0.1,
      y0 + h,
    );
  }
}

/** a→e boyunca kalınlık th kutusu (y0..y1) */
function b3(b: Builder, key: string, a: V2, e: V2, y0: number, y1: number, th: number, yaw: number): void {
  const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
  b.box(key, [(a[0] + e[0]) / 2, (y0 + y1) / 2, (a[1] + e[1]) / 2], [L, y1 - y0, th], yaw);
}

/** Kış bahçesi alın yazısı: kenar indeksi, kenar boyunca u0..u1 (m, kenar başından), yazı ve renkler */
export interface FasciaSign {
  edge: number;
  u0?: number;
  u1?: number;
  text: string;
  fg?: string;
  bg?: string;
  font?: string;
  /** v9: alt alta satırlar (boy oranı size, renk fg) — iki boyutlu alın yazısı */
  lines?: { text: string; fg?: string; size?: number }[];
  /** v9: aynı satırda farklı renkli parçalar (u aralığı harf sayısıyla paylaşılır) */
  parts?: { text: string; fg?: string }[];
}

/**
 * v8 (critic d4c #5): kış bahçesi / pavyon alın yazıları. `fasciaSigns` [{edge, u0, u1, text, fg, bg, font}] ya da
 * kısayol `fasciaText` (+ `fasciaFg`, `fasciaEdge`): verilmezse dolu olmayan en uzun kenar. Yalnız görülen yazı
 * (ölçüm notundaki okunan metin) yazılır; renkler geçersizse yok sayılır.
 */
export function fasciaSigns(
  s: StreetItem,
  poly: V2[],
  solid: Set<number>,
  /** Noktadan en yakın yol eksenine birim yön (FurnCtx.toRoad): varsayılan kenar yola bakan kenar */
  toRoad?: (x: number, z: number) => V2 | null,
): FasciaSign[] {
  const hex = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v : undefined);
  const out: FasciaSign[] = [];
  const L = poly.length;
  const lenOf = (j: number) => {
    const a = poly[j];
    const e = poly[(j + 1) % L];
    return Math.hypot(e[0] - a[0], e[1] - a[1]);
  };
  if (Array.isArray(s.fasciaSigns))
    for (const q of s.fasciaSigns as Partial<FasciaSign>[]) {
      if (!q || typeof q.text !== 'string' || !q.text.trim()) continue;
      const edge = typeof q.edge === 'number' ? Math.round(q.edge) : -1;
      if (edge < 0 || edge >= L || solid.has(edge)) continue;
      out.push({
        edge,
        ...(typeof q.u0 === 'number' ? { u0: q.u0 } : {}),
        ...(typeof q.u1 === 'number' ? { u1: q.u1 } : {}),
        text: q.text,
        ...(hex(q.fg) ? { fg: hex(q.fg) } : {}),
        ...(hex(q.bg) ? { bg: hex(q.bg) } : {}),
        ...(typeof q.font === 'string' ? { font: q.font } : {}),
      });
    }
  else if (typeof s.fasciaText === 'string' && s.fasciaText.trim()) {
    let edge = typeof s.fasciaEdge === 'number' ? Math.round(s.fasciaEdge) : -1;
    if (edge < 0 || edge >= L || solid.has(edge)) {
      // Yola bakan kenar (boy × dış normalin yol yönüyle kosinüsü); yol bilinmiyorsa en uzun kenar
      const cx = poly.reduce((q, p) => q + p[0], 0) / L;
      const cz = poly.reduce((q, p) => q + p[1], 0) / L;
      const score = (j: number) => {
        const a = poly[j];
        const e = poly[(j + 1) % L];
        const len = lenOf(j);
        const m: V2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
        const r = toRoad?.(m[0], m[1]);
        if (!r || len < 1e-3) return len;
        let n: V2 = [-(e[1] - a[1]) / len, (e[0] - a[0]) / len];
        if ((cx - m[0]) * n[0] + (cz - m[1]) * n[1] > 0) n = [-n[0], -n[1]];
        return len * (1e-3 + Math.max(0, n[0] * r[0] + n[1] * r[1]));
      };
      edge = -1;
      for (let j = 0; j < L; j++) if (!solid.has(j) && (edge < 0 || score(j) > score(edge))) edge = j;
    }
    if (edge >= 0) {
      // v9: iki boyutlu (fasciaLines) / iki renkli (fasciaParts) alın yazısı
      const ln = Array.isArray(s.fasciaLines)
        ? (s.fasciaLines as { text?: unknown; fg?: unknown; size?: unknown }[])
            .filter((q) => q && typeof q.text === 'string' && q.text.trim())
            .map((q) => ({
              text: q.text as string,
              ...(hex(q.fg) ? { fg: hex(q.fg) } : {}),
              ...(typeof q.size === 'number' ? { size: q.size } : {}),
            }))
        : [];
      const pt = Array.isArray(s.fasciaParts)
        ? (s.fasciaParts as { text?: unknown; fg?: unknown }[])
            .filter((q) => q && typeof q.text === 'string' && q.text.trim())
            .map((q) => ({ text: q.text as string, ...(hex(q.fg) ? { fg: hex(q.fg) } : {}) }))
        : [];
      out.push({
        edge,
        text: s.fasciaText,
        ...(hex(s.fasciaFg) ? { fg: hex(s.fasciaFg) } : {}),
        ...(ln.length ? { lines: ln } : {}),
        ...(pt.length ? { parts: pt } : {}),
      });
    }
  }
  return out;
}

/**
 * Kış bahçesi kapatması (kaldırımda camlı teras): taban çokgeni poly (dünya), yükseklik h (ön kenar) ve h2 (arka,
 * eğik çatı; yoksa düz), cam (glass) + doğrama (frame) + dikme aralığı mullion, kapılar doors [{edge, u0, u1}],
 * dolu kenarlar solid (kenar indeksleri, wallC), taban bandı plinth {h, color}, çatı rengi roofC.
 */
function enclosure(c: FurnCtx, s: StreetItem): void {
  const poly = (s.poly as V2[] | undefined) ?? [];
  if (poly.length < 3) return;
  const L = poly.length;
  const g0 = Math.min(...poly.map((p) => c.H(p[0], p[1]) + c.walk(p[0], p[1])));
  const h = num(s.h, 2.4);
  const h2 = num(s.h2, h);
  // v8 (critic d4c #5): kış bahçesi camı saydam (ölçülen görünen cam tonu = yansıma + karanlık iç), içi koyu:
  // önceden korkuluk camı malzemesiyle (opaklık 0.86) gri kutu görünüyordu. İç yüzler yalnız içe bakar →
  // dışarıdan yalnız karşı duvarın içi, taban ve tavan görünür. KARAR: iç ton ölçülmedi (`interiorC` ile verilir) →
  // koyu nötr #262420 (critic vitrin içi ölçümleri #121512–#353121 aralığı).
  const gk = ckOf(c, 'encglass', s.glass ?? '#6a7478', ckOf(c, 'glass', s.glass, 'mkRailGlass'));
  const ik = ckOf(c, 'interior', s.interiorC ?? '#262420', 'darkMetal');
  const fk = ckOf(c, 'frame', s.frame, 'darkMetal');
  const rk = ckOf(c, 'fascia', s.roofC, fk);
  const wk = ckOf(c, 'plaster', s.wallC, 'kamSlab');
  const solid = new Set((s.solid as number[] | undefined) ?? []);
  const doors = (s.doors as { edge: number; u0: number; u1: number }[] | undefined) ?? [];
  const pl = s.plinth as { h?: number; color?: string } | undefined;
  const ph = Math.max(0, pl?.h ?? 0);
  const pk = pl ? ckOf(c, 'plaster', pl.color, wk) : wk;
  const mul = Math.max(0.3, num(s.mullion, 1.0));
  // Üst kot: ön kenar (poly kenar 0) h, en uzak nokta h2
  const a0 = poly[0];
  const e0 = poly[1];
  const l0 = Math.hypot(e0[0] - a0[0], e0[1] - a0[1]) || 1;
  const n0: V2 = [-(e0[1] - a0[1]) / l0, (e0[0] - a0[0]) / l0];
  const dOf = (p: V2) => Math.abs((p[0] - a0[0]) * n0[0] + (p[1] - a0[1]) * n0[1]);
  const dM = Math.max(1e-3, ...poly.map(dOf));
  const topAt = (p: V2) => g0 + h + ((h2 - h) * dOf(p)) / dM;
  for (let j = 0; j < L; j++) {
    const a = poly[j];
    const e = poly[(j + 1) % L];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (len < 0.05) continue;
    const t: V2 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len];
    const yaw = Math.atan2(-t[1], t[0]);
    const ya = topAt(a);
    const ye = topAt(e);
    const at = (u: number): V2 => [a[0] + t[0] * u, a[1] + t[1] * u];
    const yAt = (u: number) => ya + ((ye - ya) * u) / len;
    const face = (key: string, u0: number, u1: number, yb: number) => {
      const A = at(u0);
      const B = at(u1);
      c.b.quad(key, [A[0], yb, A[1]], [B[0], yb, B[1]], [B[0], yAt(u1), B[1]], [A[0], yAt(u0), A[1]]);
      c.b.quad(key, [B[0], yb, B[1]], [A[0], yb, A[1]], [A[0], yAt(u0), A[1]], [B[0], yAt(u1), B[1]]);
    };
    if (solid.has(j)) {
      face(wk, 0, len, g0);
      continue;
    }
    // İç yüz (yalnız içe bakan, camın 4 cm içinde): tabandan tavana koyu iç
    {
      const n: V2 = [-t[1], t[0]];
      const m: V2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
      const cxy = poly.reduce((q, p) => [q[0] + p[0] / L, q[1] + p[1] / L], [0, 0] as V2);
      const nIn: V2 = (cxy[0] - m[0]) * n[0] + (cxy[1] - m[1]) * n[1] > 0 ? n : [-n[0], -n[1]];
      const A: V2 = [a[0] + nIn[0] * 0.04, a[1] + nIn[1] * 0.04];
      const B: V2 = [e[0] + nIn[0] * 0.04, e[1] + nIn[1] * 0.04];
      // Builder.quad(A alt, B alt, B üst, A üst) = wall(A, B): ön yüz (−t.z, t.x) = n yönüne bakar
      const yb = g0 + 0.02;
      if (nIn === n)
        c.b.quad(ik, [A[0], yb, A[1]], [B[0], yb, B[1]], [B[0], ye - 0.02, B[1]], [A[0], ya - 0.02, A[1]]);
      else c.b.quad(ik, [B[0], yb, B[1]], [A[0], yb, A[1]], [A[0], ya - 0.02, A[1]], [B[0], ye - 0.02, B[1]]);
    }
    if (ph > 0.02) b3(c.b, pk, a, e, g0, g0 + ph, 0.08, yaw);
    // Cam + kapı boşlukları (kapıda cam kanat doğramalı, eşik yok)
    face(gk, 0, len, g0 + ph);
    const dr = doors.filter((q) => q.edge === j);
    const n = Math.max(1, Math.round(len / mul));
    for (let k = 0; k <= n; k++) {
      const u = (len * k) / n;
      const p = at(u);
      const yt = yAt(u);
      c.b.box(fk, [p[0], (g0 + yt) / 2, p[1]], [0.05, yt - g0, 0.06], yaw);
    }
    for (const q of dr) {
      for (const u of [q.u0, q.u1]) {
        const p = at(Math.max(0, Math.min(len, u)));
        c.b.box(fk, [p[0], g0 + 1.05, p[1]], [0.07, 2.1, 0.07], yaw);
      }
      const m = at((q.u0 + q.u1) / 2);
      c.b.box(fk, [m[0], g0 + 2.12, m[1]], [Math.abs(q.u1 - q.u0), 0.06, 0.07], yaw);
    }
    // Üst kayıt
    const m = at(len / 2);
    c.b.box(fk, [m[0], (ya + ye) / 2 - 0.03, m[1]], [len, 0.06, 0.07], yaw);
  }
  // Çatı (eğik düzlem) iki yüz
  const tris = THREE.ShapeUtils.triangulateShape(
    poly.map((p) => new THREE.Vector2(p[0], p[1])),
    [],
  );
  for (const sg of [1, -1]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        poly.flatMap((p) => [p[0], topAt(p) + (sg > 0 ? 0.02 : -0.03), p[1]]),
        3,
      ),
    );
    g.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(
        poly.flatMap((p) => [p[0], p[1]]),
        2,
      ),
    );
    g.setIndex(tris.flatMap((tr) => [tr[0], tr[1], tr[2]]));
    g.computeVertexNormals();
    if (Math.sign(g.attributes.normal.getY(0)) !== sg) {
      g.setIndex(tris.flatMap((tr) => [tr[0], tr[2], tr[1]]));
      g.computeVertexNormals();
    }
    c.b.geometry(sg > 0 ? rk : ik, g);
  }
  // İç taban (koyu)
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        poly.flatMap((p) => [p[0], g0 + 0.015, p[1]]),
        3,
      ),
    );
    g.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(
        poly.flatMap((p) => [p[0], p[1]]),
        2,
      ),
    );
    g.setIndex(tris.flatMap((tr) => [tr[0], tr[1], tr[2]]));
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) {
      g.setIndex(tris.flatMap((tr) => [tr[0], tr[2], tr[1]]));
      g.computeVertexNormals();
    }
    c.b.geometry(ik, g);
  }
  // v8: alın bandı (`fasciaC`, `fasciaH` — ör. Özdemiroğlu kuzey kış bahçesi yeşil alın #253837): dolu olmayan
  // kenarların üst kısmında dışta 6 cm taşan bant. KARAR: yükseklik ölçülmemişse 0.35 m
  const fsigns = fasciaSigns(s, poly, solid, c.toRoad);
  const fc =
    typeof s.fasciaC === 'string' && HEX.test(s.fasciaC)
      ? s.fasciaC
      : fsigns.length && typeof s.frame === 'string' && HEX.test(s.frame)
        ? s.frame
        : fsigns.length
          ? '#2a2c2e'
          : null;
  if (fc) {
    const fh = Math.max(0.05, num(s.fasciaH, 0.35));
    const fk2 = ckOf(c, 'fascia', fc, fk);
    const cx = poly.reduce((a, p) => a + p[0], 0) / L;
    const cz = poly.reduce((a, p) => a + p[1], 0) / L;
    for (let j = 0; j < L; j++) {
      if (solid.has(j)) continue;
      const a = poly[j];
      const e = poly[(j + 1) % L];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (len < 0.05) continue;
      const t: V2 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len];
      let nO: V2 = [-t[1], t[0]];
      const m: V2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
      if ((cx - m[0]) * nO[0] + (cz - m[1]) * nO[1] > 0) nO = [-nO[0], -nO[1]];
      const yt = (topAt(a) + topAt(e)) / 2;
      b3(
        c.b,
        fk2,
        [a[0] + nO[0] * 0.03, a[1] + nO[1] * 0.03],
        [e[0] + nO[0] * 0.03, e[1] + nO[1] * 0.03],
        yt - fh,
        yt + 0.04,
        0.06,
        Math.atan2(-t[1], t[0]),
      );
      // v8: alın yazısı (`fasciaText` / `fasciaSigns`): tabela atlası yüzü bandın dış yüzünde (6.5 cm)
      if (c.signFace)
        for (const sg of fsigns) {
          if (sg.edge !== j) continue;
          const u0 = Math.max(0, Math.min(len, sg.u0 ?? 0.1));
          const u1 = Math.max(u0 + 0.1, Math.min(len, sg.u1 ?? len - 0.1));
          const o = 0.065;
          const P = (u: number): V2 => [a[0] + t[0] * u + nO[0] * o, a[1] + t[1] * u + nO[1] * o];
          // wall(A, B) (−t.z, t.x)'e bakar: dışa (nO) bakacak sırayla
          const out = -t[1] * nO[0] + t[0] * nO[1] > 0;
          // Dışarıdan okuma yönü: out ise u artan yönde soldan sağa, değilse ters
          const put = (key: string, ua: number, ub: number) => {
            if (out) c.b.wall(key, P(ua), P(ub), yt - fh + 0.02, yt + 0.02, [0, 0, 1, 1]);
            else c.b.wall(key, P(ub), P(ua), yt - fh + 0.02, yt + 0.02, [0, 0, 1, 1]);
          };
          const spec = (text: string, fg: string | undefined, w: number) =>
            c.signFace!({
              text,
              lines: sg.lines?.length
                ? sg.lines.map((q) => ({ ...q, fg: q.fg ?? sg.fg ?? '#ffffff' }))
                : null,
              bg: sg.bg ?? fc,
              fg: fg ?? sg.fg ?? '#ffffff',
              border: null,
              font: sg.font ?? 'sans',
              bold: true,
              lit: false,
              style: 'panel',
              w,
              h: fh,
            });
          if (sg.parts?.length) {
            // v9: iki renkli satır: parçalar okuma sırasıyla, harf sayısı oranında (boşluk payı dahil)
            const tot = sg.parts.reduce((q, pp) => q + pp.text.length + 1, 0);
            let acc = 0;
            for (const pp of sg.parts) {
              const f0 = acc / tot;
              acc += pp.text.length + 1;
              const f1 = acc / tot;
              const W = u1 - u0;
              const [ua, ub] = out ? [u0 + W * f0, u0 + W * f1] : [u1 - W * f1, u1 - W * f0];
              put(spec(pp.text, pp.fg, ub - ua), ua, ub);
            }
          } else put(spec(sg.text, sg.fg, u1 - u0), u0, u1);
        }
    }
  }
  // v9: çatının ÜSTÜNE çerçeveyle takılı harfler (`roofSign` {text, lines, fg, h, frameC, edge, u0, u1}; ör. ZEUGMA
  // KÜNEFE): yola bakan (ya da `edge`) kenarın üst kotunda, ince koyu çerçeve (alt / üst kuşak + uç dikmeleri) ve
  // saydam zeminli harfler. KARAR: çerçeve kesiti ölçülmedi → 4 cm
  const rs = s.roofSign as
    | {
        text?: string;
        lines?: { text: string; fg?: string; size?: number }[];
        fg?: string;
        h?: number;
        frameC?: string;
        edge?: number;
        u0?: number;
        u1?: number;
      }
    | undefined;
  if (rs && (rs.text || rs.lines?.length) && c.signFace) {
    const ej =
      typeof rs.edge === 'number'
        ? Math.round(rs.edge)
        : (fasciaSigns(
            { ...s, fasciaSigns: undefined, fasciaText: 'x', fasciaEdge: undefined },
            poly,
            solid,
            c.toRoad,
          )[0]?.edge ?? -1);
    if (ej >= 0 && ej < L) {
      const a = poly[ej];
      const e = poly[(ej + 1) % L];
      const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      const t: V2 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len];
      const cx = poly.reduce((q, p) => q + p[0], 0) / L;
      const cz = poly.reduce((q, p) => q + p[1], 0) / L;
      let nO: V2 = [-t[1], t[0]];
      const m: V2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
      if ((cx - m[0]) * nO[0] + (cz - m[1]) * nO[1] > 0) nO = [-nO[0], -nO[1]];
      const u0 = Math.max(0, Math.min(len, rs.u0 ?? 0.1));
      const u1 = Math.max(u0 + 0.2, Math.min(len, rs.u1 ?? len - 0.1));
      const yb = (topAt(a) + topAt(e)) / 2 + 0.04;
      const hh = Math.max(0.2, num(rs.h, 0.8));
      const yaw = Math.atan2(-t[1], t[0]);
      const frK = ckOf(c, 'frame', rs.frameC, fk);
      const P = (u: number, o: number): V2 => [a[0] + t[0] * u + nO[0] * o, a[1] + t[1] * u + nO[1] * o];
      b3(c.b, frK, P(u0, 0.02), P(u1, 0.02), yb, yb + 0.04, 0.04, yaw);
      b3(c.b, frK, P(u0, 0.02), P(u1, 0.02), yb + hh - 0.04, yb + hh, 0.04, yaw);
      for (const u of [u0 + 0.02, u1 - 0.02]) {
        const q = P(u, 0.02);
        c.b.box(frK, [q[0], yb + hh / 2, q[1]], [0.04, hh, 0.04], yaw);
      }
      const fg = typeof rs.fg === 'string' && HEX.test(rs.fg) ? rs.fg : '#ecebe6';
      const key = c.signFace({
        text: rs.text ?? '',
        lines: rs.lines?.length ? rs.lines.map((q) => ({ ...q, fg: q.fg ?? fg })) : null,
        bg: null,
        fg,
        border: null,
        font: 'sans',
        bold: true,
        lit: false,
        style: 'letters',
        w: u1 - u0 - 0.1,
        h: hh - 0.1,
      });
      const out = -t[1] * nO[0] + t[0] * nO[1] > 0;
      const A = P(u0 + 0.05, 0.045);
      const B = P(u1 - 0.05, 0.045);
      if (out) c.b.wall(key, A, B, yb + 0.05, yb + hh - 0.05, [0, 0, 1, 1]);
      else c.b.wall(key, B, A, yb + 0.05, yb + hh - 0.05, [0, 0, 1, 1]);
    }
  }
  // v8: çatı mertekleri (`rafters` {every, color, w} ya da not "≈3.4 m aralıklı koyu mertekler"): kenar 0'a (bina
  // duvarı) dik, çatı üstünde; renk verilmezse doğrama rengi
  const rf = s.rafters as { every?: number; color?: string; w?: number } | undefined;
  const rm = /≈?\s*([0-9]+(?:[.,][0-9]+)?)\s*m\s*aralıklı[^.;]{0,20}mertek/.exec(`${s.note ?? ''}`);
  const every = rf?.every ?? (rm ? Number(rm[1].replace(',', '.')) : 0);
  if (every > 0.3) {
    const rk2 = ckOf(c, 'frame', rf?.color, fk);
    const t0: V2 = [(e0[0] - a0[0]) / l0, (e0[1] - a0[1]) / l0];
    // İçe bakan dik: poligon merkezi tarafı
    const cx = poly.reduce((a, p) => a + p[0], 0) / L;
    const cz = poly.reduce((a, p) => a + p[1], 0) / L;
    const nIn: V2 = (cx - a0[0]) * n0[0] + (cz - a0[1]) * n0[1] > 0 ? n0 : [-n0[0], -n0[1]];
    const rw = rf?.w ?? 0.08;
    for (let u = every / 2; u < l0 - 0.1; u += every) {
      const p0: V2 = [a0[0] + t0[0] * u, a0[1] + t0[1] * u];
      // Işın → poligon karşı kenarı
      let far = 0;
      for (let j = 1; j < L; j++) {
        const a = poly[j];
        const e = poly[(j + 1) % L];
        const ex = e[0] - a[0];
        const ez = e[1] - a[1];
        const den = nIn[0] * ez - nIn[1] * ex;
        if (Math.abs(den) < 1e-9) continue;
        const tr = ((a[0] - p0[0]) * ez - (a[1] - p0[1]) * ex) / den;
        const sg = ((a[0] - p0[0]) * nIn[1] - (a[1] - p0[1]) * nIn[0]) / den;
        if (tr > 0.05 && sg >= 0 && sg <= 1) far = Math.max(far, tr);
      }
      if (far < 0.2) continue;
      const p1: V2 = [p0[0] + nIn[0] * far, p0[1] + nIn[1] * far];
      const yA = topAt(p0) + 0.02;
      const yB = topAt(p1) + 0.02;
      const g = new THREE.BoxGeometry(rw, 0.12, far);
      const pitch = Math.atan2(yB - yA, far);
      g.rotateX(-pitch);
      g.rotateY(Math.atan2(nIn[0], nIn[1]));
      g.translate((p0[0] + p1[0]) / 2, (yA + yB) / 2 + 0.06, (p0[1] + p1[1]) / 2);
      c.b.geometry(rk2, g);
    }
  }
  c.collide?.(
    poly.map((p) => [p[0], p[1]] as [number, number]),
    g0 - 0.1,
    g0 + Math.max(h, h2),
  );
}

/**
 * Modüler kauçuk hız kesici: pts boyunca (yolu enine keser), derinlik w (yol boyunca, m), yükseklik h, renk color;
 * module = modül boyu (m, verilirse aralarında 1 cm derz), ends {color, len, at: start | end | both} uç parçası.
 */
function speedBump(c: FurnCtx, s: StreetItem): void {
  const pts = (s.pts as V2[] | undefined) ?? [];
  if (pts.length < 2) return;
  const w = num(s.w, 0.5);
  const h = Math.max(0.01, num(s.h, 0.05));
  const bk = ckOf(c, 'awning', s.color, 'darkMetal');
  const en = s.ends as { color?: string; len?: number; at?: string } | undefined;
  const ek = en ? ckOf(c, 'awning', en.color, bk) : bk;
  const mod = num(s.module, 0);
  const atS = !!en && (en.at === 'start' || en.at === 'both');
  const atE = !!en && (en.at == null || en.at === 'end' || en.at === 'both');
  const NS = 6;
  const prof = Array.from({ length: NS + 1 }, (_, k) => {
    const v = -w / 2 + (w * k) / NS;
    return [v, h * Math.sqrt(Math.max(0, 1 - ((2 * v) / w) ** 2))] as [number, number];
  });
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(L);
    total += L;
  }
  const eLen = en ? Math.max(0.1, en.len ?? 0.4) : 0;
  let s0 = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const e = pts[i + 1];
    const L = lens[i];
    if (L < 0.02) continue;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const n: V2 = [-t[1], t[0]];
    // Parçalar: modül derzleri + uç parçaları
    const cuts = [0, L];
    if (mod > 0.1) for (let u = mod - (s0 % mod); u < L; u += mod) cuts.push(u);
    const isEnd = (u: number) => (atS && s0 + u < eLen) || (atE && s0 + u > total - eLen);
    if (atS && s0 < eLen && s0 + L > eLen) cuts.push(eLen - s0);
    if (atE && s0 < total - eLen && s0 + L > total - eLen) cuts.push(total - eLen - s0);
    cuts.sort((p, q) => p - q);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const u0 = cuts[k] + (k > 0 && mod > 0.1 ? 0.005 : 0);
      const u1 = cuts[k + 1] - (k + 2 < cuts.length && mod > 0.1 ? 0.005 : 0);
      if (u1 - u0 < 0.01) continue;
      const key = isEnd((u0 + u1) / 2) ? ek : bk;
      for (let q = 0; q < NS; q++) {
        const [va, ha] = prof[q];
        const [vb, hb] = prof[q + 1];
        const P = (u: number, v: number, hh: number): V3 => {
          const x = a[0] + t[0] * u + n[0] * v;
          const z = a[1] + t[1] * u + n[1] * v;
          return [x, c.H(x, z) + hh + 0.005, z];
        };
        c.b.quad(key, P(u0, va, ha), P(u0, vb, hb), P(u1, vb, hb), P(u1, va, ha));
        c.b.quad(key, P(u1, va, ha), P(u1, vb, hb), P(u0, vb, hb), P(u0, va, ha));
      }
    }
    s0 += L;
  }
}

function streetPergola(c: FurnCtx, s: StreetItem): void {
  const poly = (s.poly as V2[] | undefined) ?? [];
  if (poly.length < 3 || !c.colorKey) return;
  const g0 = Math.min(...poly.map((p) => c.H(p[0], p[1]) + c.walk(p[0], p[1])));
  const pg: CPergola = {
    poly: poly.map((p) => [p[0], p[1]] as [number, number]),
    y0: 0,
    y1: num(s.h, 2.6),
    ...(typeof s.h2 === 'number' ? { y1s: s.h2 } : {}),
    color: typeof s.color === 'string' ? s.color : null,
    ...(typeof s.post === 'number' ? { post: s.post } : {}),
    ...(typeof s.every === 'number' ? { every: s.every } : {}),
    ...(typeof s.beam === 'number' ? { beam: s.beam } : {}),
    ...(typeof s.slat === 'number' ? { slat: s.slat } : {}),
    cover: typeof s.cover === 'string' ? s.cover : null,
    ...(typeof s.slatEdge === 'number' ? { slatEdge: s.slatEdge } : {}),
    ...(typeof s.slopeEdge === 'number' ? { slopeEdge: s.slopeEdge } : {}),
    ...(Array.isArray(s.postEdges) ? { postEdges: s.postEdges as number[] } : {}),
    ...(Array.isArray(s.posts) ? { posts: s.posts as [number, number][] } : {}),
    ...(s.beams ? { beams: s.beams as CPergola['beams'] } : {}),
  };
  const ck = (kind: CK, hex: string | null | undefined, dflt: string) =>
    hex && HEX.test(hex) && c.colorKey ? c.colorKey(kind, hex) : dflt;
  buildPergola(c.b, pg, g0, ck('metal', pg.color ?? null, 'darkMetal'), ck);
}

function bikeRack(c: FurnCtx, s: StreetItem, y: number): void {
  const yaw = ((s.rot ?? 0) * Math.PI) / 180;
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const n = Math.max(1, Math.min(20, Math.round(num(s.n, 5))));
  const ev = num(s.every, 0.7);
  const k0 = -(n - 1) / 2;
  const key = ckOf(c, 'metal', s.color, 'steel');
  for (let k = 0; k < n; k++) {
    const o = (k0 + k) * ev;
    const g = new THREE.TorusGeometry(0.38, 0.025, 6, 16, Math.PI).rotateY(yaw + Math.PI / 2);
    g.translate(s.x + co * o, y, s.z - si * o);
    c.b.geometry(key, g);
  }
}

/** v7 türleri; işlenmediyse false */
export function buildStreetFurniture(c: FurnCtx, s: StreetItem): boolean {
  const y = c.H(s.x, s.z) + c.walk(s.x, s.z);
  switch (s.kind) {
    case 'table':
      cafeSet(c, s, y);
      return true;
    case 'chair':
      // rot: oturanın baktığı pusula yönü (sin a, −cos a) = yerel −z → θ = −a
      c.b.instance('chair', PROTO.chair, place(s.x, y, s.z, -((s.rot ?? 0) * Math.PI) / 180), colOf(s.color));
      return true;
    case 'parasol':
      parasol(c, s, y);
      return true;
    case 'heater':
      c.b.instance('heater', PROTO.heater, place(s.x, y, s.z, 0, 1, num(s.h, 2.2), 1), colOf(s.color));
      return true;
    case 'planter':
      planter(c, s, y);
      return true;
    case 'aframe':
      aframe(c, s, y);
      return true;
    case 'totem':
      totem(c, s, y);
      return true;
    case 'menu-stand':
      menuStand(c, s, y);
      return true;
    case 'windscreen':
      windscreen(c, s);
      return true;
    case 'enclosure':
      enclosure(c, s);
      return true;
    case 'speed-bump':
      speedBump(c, s);
      return true;
    case 'pergola':
      streetPergola(c, s);
      return true;
    case 'bike-parking':
      bikeRack(c, s, y);
      return true;
  }
  return buildStreetKind(c, s, y);
}
