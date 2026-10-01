import * as THREE from 'three';
import type { Builder, V2, V3 } from './builder';
import type { CBlade, CK, CNeon, CRoofSign, CScreen, CVinyl, SignSpec, SignText } from './facade';

/**
 * v7 (D4 — Özlüce Bulvarı dükkân / ofis cepheleri): cephe öğesi olarak tabela türleri. Tümü ölçüm verisinden
 * (survey → facades.json): konum, boy, yazı, renk, ışıklı mı. Yüz dokuları `signFace` ile tabela atlasına kaydedilir
 * (tabela başına doku yok, sayfa başına tek malzeme).
 *
 * - blade: cepheye DİK, çift yüzlü bayrak tabela (kutu + iki yüz; yüz A +t'ye, yüz B −t'ye bakar), taşıyıcı kol
 * - vinyl: pencere camı üstünde folyo yazı (camın düzleminde, kalınlıksız)
 * - roofsign: çatı kenarının gerisinde çelik iskelet üstünde tek tek 3B harfler
 * - screen: LED ekran (gündüz de parlak), çerçeveli kutu
 * - neon: cephe düzleminde çoklu çizgi boyunca ışıklı tüp (gece parlar)
 */

export interface SignEdge {
  a: V2;
  t: V2;
  n: V2;
  yaw: number;
  len: number;
}

export interface SignCtx {
  b: Builder;
  P: (i: number, u: number, off?: number) => V2;
  E: SignEdge;
  i: number;
  base: number;
  wallTop: number;
  roofH: (p: V2) => number | null;
  ck: (kind: CK, hex: string | null | undefined, dflt: string) => string;
  signFace?: (s: SignSpec) => string;
  /** Kenar üzerinde (u, mutlak y) noktasında girinti / loca derinliği (öğe arka duvara taşınır) */
  recDepthAt: (u: number, y: number) => number;
  collide?: (ring: [number, number][], bottom: number, top: number) => void;
  floorY: (k: number) => number;
}

/** Pencere camı düzlemi (addWindow: −REVEAL + 0.02) + 4 mm */
const GLASS_OFF = -0.096;

function specOf(it: SignText, w: number, h: number, style: string, extra: Partial<SignSpec> = {}): SignSpec {
  return {
    text: it.text ?? '',
    lines: it.lines ?? null,
    bg: it.bg ?? null,
    fg: it.fg,
    border: it.border ?? null,
    font: it.font ?? 'sans',
    bold: it.bold !== false,
    lit: !!it.lit,
    style,
    w,
    h,
    shape: it.shape ?? null,
    ...(it.glyphs?.length ? { glyphs: it.glyphs, join: it.join ?? null } : {}),
    ...(it.capH != null ? { capH: it.capH } : {}),
    ...(it.align ? { align: it.align } : {}),
    ...extra,
  };
}

function rod(b: Builder, key: string, A: V3, B: V3, r: number, seg = 6): void {
  const v = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
  const L = v.length();
  if (L < 0.005) return;
  const g = new THREE.CylinderGeometry(r, r, L, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
  g.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
  b.geometry(key, g);
}

/** Katmanlı (3B) harfler: ön yüz + d boyunca koyulaştırılmış arka katmanlar (alfa testli harf dokusu) */
function layeredLetters(
  c: SignCtx,
  spec: SignSpec,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  off: number,
  d: number,
): void {
  if (!c.signFace) return;
  const { b, P, i } = c;
  const fk = c.signFace(spec);
  b.wall(fk, P(i, u0, off + d), P(i, u1, off + d), y0, y1, [0, 0, 1, 1]);
  if (d >= 0.015) {
    const sk = c.signFace({ ...spec, side: true });
    const nl = Math.max(2, Math.min(10, Math.round(d / 0.006)));
    for (let l = 0; l < nl; l++) {
      const o = off + (d * l) / nl;
      b.wall(sk, P(i, u0, o), P(i, u1, o), y0, y1, [0, 0, 1, 1]);
    }
  }
}

function blade(c: SignCtx, it: CBlade): void {
  const { b, P, i, E } = c;
  const w = Math.max(0.05, it.w);
  const y0 = c.base + Math.min(it.y0, it.y1);
  const y1 = c.base + Math.max(it.y0, it.y1);
  const h = y1 - y0;
  if (h < 0.05) return;
  const d = Math.max(0.01, it.d || 0.1);
  const rd = c.recDepthAt(it.u, (y0 + y1) / 2);
  const g0 = Math.max(0, it.gap ?? 0.1) - rd;
  const yc = (y0 + y1) / 2;
  const sideK = c.ck('fascia', it.border ?? it.bg ?? '#d8d8d4', 'mkRail');
  const round = it.shape === 'round' || it.shape === 'oval';
  const mid = P(i, it.u, g0 + w / 2);
  if (round) {
    // Yuvarlak / oval bayrak tabela: ekseni cephe boyunca (t) disk
    const g = new THREE.CylinderGeometry(0.5, 0.5, d, 32);
    g.rotateZ(Math.PI / 2);
    g.scale(1, h, it.shape === 'round' ? Math.min(w, h) : w);
    g.rotateY(E.yaw);
    g.translate(mid[0], yc, mid[1]);
    b.geometry(sideK, g);
  } else b.box(sideK, [mid[0], yc, mid[1]], [d, h, w], E.yaw);
  if (c.signFace) {
    const style = it.bg ? 'panel' : 'letters';
    const fa = c.signFace(specOf(it, w, h, style));
    const fb = c.signFace(
      specOf({ ...it, text: it.textB ?? it.text, lines: it.linesB ?? it.lines ?? null }, w, h, style),
    );
    const e = d / 2 + 0.004;
    // +t'ye bakan yüz: a→e −n yönünde (sağa doğru okunur); −t'ye bakan: +n yönünde
    b.wall(fa, P(i, it.u + e, g0 + w), P(i, it.u + e, g0), y0, y1, [0, 0, 1, 1]);
    b.wall(fb, P(i, it.u - e, g0), P(i, it.u - e, g0 + w), y0, y1, [0, 0, 1, 1]);
  }
  // Taşıyıcı: arm (üstte duvardan panonun ucuna yatay kol + duvar plakası), plate (duvarda düşey plaka), none
  const bk = it.bracket?.kind ?? (g0 + rd > 0.03 ? 'arm' : 'plate');
  const mk = c.ck('metal', it.bracket?.color ?? '#2a2c2e', 'darkMetal');
  if (bk === 'arm') {
    const a = P(i, it.u, -rd);
    const e = P(i, it.u, g0 + w + 0.04);
    rod(b, mk, [a[0], y1 + 0.05, a[1]], [e[0], y1 + 0.05, e[1]], 0.02, 6);
    const pl = P(i, it.u, -rd + 0.01);
    b.box(mk, [pl[0], y1 + 0.02, pl[1]], [0.14, 0.24, 0.02], E.yaw);
    if (g0 > 0.03)
      for (const q of [0.15, w - 0.15]) {
        if (q <= 0 || q >= w) continue;
        const p = P(i, it.u, g0 + q);
        rod(b, mk, [p[0], y1 + 0.05, p[1]], [p[0], y1, p[1]], 0.008, 5);
      }
  } else if (bk === 'plate') {
    const pl = P(i, it.u, -rd + 0.015);
    b.box(mk, [pl[0], yc, pl[1]], [0.1, Math.min(h, Math.max(0.2, h * 0.8)), 0.03], E.yaw);
    if (g0 > 0.03) {
      const s = P(i, it.u, (g0 - rd) / 2);
      b.box(mk, [s[0], yc, s[1]], [0.04, Math.min(h, 0.3), Math.max(0.01, g0 + rd)], E.yaw);
    }
  }
}

function vinyl(c: SignCtx, it: CVinyl): void {
  if (!c.signFace) return;
  const u0 = Math.min(it.u0, it.u1);
  const u1 = Math.max(it.u0, it.u1);
  const y0 = c.base + Math.min(it.y0, it.y1);
  const y1 = c.base + Math.max(it.y0, it.y1);
  if (u1 - u0 < 0.03 || y1 - y0 < 0.02) return;
  const rd = c.recDepthAt((u0 + u1) / 2, (y0 + y1) / 2);
  const off = (it.off ?? GLASS_OFF) - rd;
  const fk = c.signFace(specOf(it, u1 - u0, y1 - y0, it.bg ? 'panel' : 'letters'));
  c.b.wall(fk, c.P(c.i, u0, off), c.P(c.i, u1, off), y0, y1, [0, 0, 1, 1]);
}

function roofSign(c: SignCtx, it: CRoofSign): void {
  const { b, P, i, E } = c;
  const u0 = Math.min(it.u0, it.u1);
  const u1 = Math.max(it.u0, it.u1);
  const W = u1 - u0;
  const y0 = c.base + Math.min(it.y0, it.y1);
  const y1 = c.base + Math.max(it.y0, it.y1);
  const h = y1 - y0;
  if (W < 0.2 || h < 0.1) return;
  const sb = Math.max(0, it.setback);
  const d = Math.max(0.01, it.d || 0.08);
  const fr = it.frame;
  const fk = c.ck('metal', fr?.color ?? '#3a3c3e', 'darkMetal');
  const offF = -sb - d - 0.08;
  const yRoof = (u: number) => c.roofH(P(i, u, offF)) ?? c.wallTop;
  const np = Math.max(2, Math.min(40, fr?.posts ?? Math.round(W / 2) + 1));
  const fh = Math.max(0, fr?.h ?? 0);
  // Dikmeler: çatı yüzeyinden harflerin üst kısmına (harflerin arkasında); v11 `under`: harf alt kotuna kadar
  const under = !!fr?.under;
  const yTop = under ? y0 - 0.03 : y1 - 0.05 * h;
  for (let k = 0; k < np; k++) {
    const u = u0 + 0.1 + ((W - 0.2) * k) / (np - 1);
    const p = P(i, u, offF);
    const yb = Math.min(yRoof(u), y0 - fh) - 0.05;
    if (yTop - yb < 0.02) continue;
    b.box(fk, [p[0], (yb + yTop) / 2, p[1]], [0.06, yTop - yb, 0.06], E.yaw);
  }
  // Yatay kuşaklar (harf arkası; `under` ise yok) + harf altı kafes (frame.h)
  const rails = under ? [] : [y0 + 0.2 * h, y0 + 0.8 * h];
  if (fh > 0.05) rails.push(y0 - 0.03, y0 - fh);
  const rc = P(i, (u0 + u1) / 2, offF + 0.02);
  for (const yy of rails) b.box(fk, [rc[0], yy, rc[1]], [W, 0.05, 0.05], E.yaw);
  if (fh > 0.3)
    for (let k = 0; k + 1 < np; k++) {
      const ua = u0 + 0.1 + ((W - 0.2) * k) / (np - 1);
      const ue = u0 + 0.1 + ((W - 0.2) * (k + 1)) / (np - 1);
      const A = P(i, ua, offF + 0.02);
      const B = P(i, ue, offF + 0.02);
      rod(b, fk, [A[0], y0 - fh, A[1]], [B[0], y0 - 0.03, B[1]], 0.015, 5);
    }
  // Harf arkası taşıyıcı pano (bg verilirse): harflerin arkasında dolu levha
  if (it.bg) {
    const pc = P(i, (u0 + u1) / 2, -sb - d - 0.02);
    b.box(c.ck('fascia', it.bg, 'mkRail'), [pc[0], (y0 + y1) / 2, pc[1]], [W, h, 0.04], E.yaw);
  }
  layeredLetters(c, specOf({ ...it, bg: null }, W, h, 'letters'), u0, u1, y0, y1, -sb - d, d);
}

function screen(c: SignCtx, it: CScreen): void {
  const { b, P, i, E } = c;
  const u0 = Math.min(it.u0, it.u1);
  const u1 = Math.max(it.u0, it.u1);
  const y0 = c.base + Math.min(it.y0, it.y1);
  const y1 = c.base + Math.max(it.y0, it.y1);
  const W = u1 - u0;
  const H = y1 - y0;
  if (W < 0.1 || H < 0.1) return;
  const rd = c.recDepthAt((u0 + u1) / 2, (y0 + y1) / 2);
  const off0 = Math.max(0, it.off ?? 0) - rd;
  const d = Math.max(0.02, it.d || 0.12);
  const bz = Math.max(0, Math.min(Math.min(W, H) / 3, it.bezel ?? 0.05));
  const fk = c.ck('frame', it.frame ?? '#1a1b1c', 'darkMetal');
  const cc = P(i, (u0 + u1) / 2, off0 + d / 2);
  b.box(fk, [cc[0], (y0 + y1) / 2, cc[1]], [W, H, d], E.yaw);
  if (c.signFace) {
    const k = c.signFace(
      specOf({ ...it, bg: it.bg ?? '#07090c', lit: true }, W - 2 * bz, H - 2 * bz, 'screen', {
        ...(it.blocks?.length ? { blocks: it.blocks } : {}),
      }),
    );
    b.wall(
      k,
      P(i, u0 + bz, off0 + d + 0.004),
      P(i, u1 - bz, off0 + d + 0.004),
      y0 + bz,
      y1 - bz,
      [0, 0, 1, 1],
    );
  }
  if (y0 - c.base < 2.3 && off0 + d > 0.05)
    c.collide?.(
      [P(i, u0, off0), P(i, u1, off0), P(i, u1, off0 + d), P(i, u0, off0 + d)].map((p) => [p[0], p[1]]),
      y0,
      y1,
    );
}

function neonTube(c: SignCtx, it: CNeon): void {
  const pts = it.pts ?? [];
  if (pts.length < 2) return;
  const { b, P, i } = c;
  const r = Math.max(0.005, Math.min(0.05, (it.d || 0.02) / 2));
  const um = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const ym = c.base + pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const off = Math.max(r + 0.005, it.off ?? 0.03) - c.recDepthAt(um, ym);
  const k = c.ck('neon', it.color, 'wallLamp');
  const W = (q: [number, number]): V3 => {
    const p = P(i, q[0], off);
    return [p[0], c.base + q[1], p[1]];
  };
  const n = it.closed ? pts.length : pts.length - 1;
  for (let s = 0; s < n; s++) {
    const A = W(pts[s]);
    const B = W(pts[(s + 1) % pts.length]);
    // Birleşimlerde boşluk kalmasın: uçlardan r kadar uzat
    const v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const L = Math.hypot(v[0], v[1], v[2]);
    if (L < 1e-3) continue;
    const e = r / L;
    rod(
      b,
      k,
      [A[0] - v[0] * e, A[1] - v[1] * e, A[2] - v[2] * e],
      [B[0] + v[0] * e, B[1] + v[1] * e, B[2] + v[2] * e],
      r,
      6,
    );
  }
}

export function drawSignItem(c: SignCtx, it: CBlade | CVinyl | CRoofSign | CScreen | CNeon): void {
  if (it.t === 'blade') blade(c, it);
  else if (it.t === 'vinyl') vinyl(c, it);
  else if (it.t === 'roofsign') roofSign(c, it);
  else if (it.t === 'screen') screen(c, it);
  else if (it.t === 'neon') neonTube(c, it);
}
