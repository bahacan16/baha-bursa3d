import * as THREE from 'three';
import { Builder, type V2 } from './builder';

/**
 * Komşu sitelerin çitleri (street-plan.json fence kind "other"): alçak duvar (sıva / taş / tuğla / nervürlü
 * prekast) + harpuşta, kolonlar (başlık, isteğe bağlı küre/fener lamba), üstte parmaklık / tel / panel ve arkada
 * çit bitkisi, jiletli tel. Renkler ölçümden; malzemeler anahtar+renk başına bir kez üretilir.
 */
export interface GenericFence {
  /** "other": komşu site çiti; "wall": serbest duvar (site çitine bağlı değil; dolgu verilmezse yok) */
  kind: string;
  id?: string;
  pts: V2[];
  n?: V2;
  wall?: {
    h?: number;
    t?: number;
    color?: string;
    finish?: string;
    /** Kemerli panel üstü: panel boyları (tekrar eden desen, m), ortada yükselme (m), panel arası derz rengi */
    arch?: {
      pattern: number[];
      rise: number;
      joint?: string;
      /**
       * v7: duvar yüzüne monte çelik kemerler (Λ bacaklı): her panelin kemeri iki uçtaki derzin `spread` m ötesindeki
       * ayaklara iner (komşu kemerler derz üstünde X'te kesişir), panel ortasında tepe `top` (tabandan m; verilmezse
       * duvar üstü + harpuşta + dolgu yüksekliği); şerit genişliği w (m, 0.06), renk (verilmezse joint). Verilirse V
       * derz şeritleri çizilmez (da3-fence-side-n: spread 1.3, top 2.31).
       */
      legs?: { spread: number; top?: number; w?: number; color?: string };
    };
    /**
     * Kabartmalı prekast panel (sokak yüzü): panel genişliği (m, verilmezse kolon aralığı ya da 2 m), motif
     * (rhombus = baklava, medallion = yuvarlak madalyon, frame = yalnız çerçeve), kabartma rengi ve çıkıntısı.
     */
    relief?: { panel?: number; motif?: 'rhombus' | 'medallion' | 'frame'; color?: string; d?: number };
  };
  coping?: { h?: number; color?: string } | string;
  pillars?: {
    every?: number;
    list?: (number | [number, number])[];
    w?: number;
    h?: number;
    color?: string;
    cap?: string | boolean;
    lamp?: string | boolean;
    /** 'ornate': kaideli, kademeli başlıklı, gövdesinde kabartma çerçeveli süslü kolon */
    style?: 'plain' | 'ornate';
    /** Kolon tepesi süsü: top (ball) / piramit (pyramid) */
    finial?: 'ball' | 'pyramid' | 'none';
  };
  infill?: string | { type?: string; h?: number; color?: string };
  /** style 'scattered': sürekli çit yerine aralıklı çalı öbekleri (gap: öbek aralığı, m) */
  hedge?: {
    h?: number;
    depth?: number;
    species?: string;
    color?: string;
    style?: 'solid' | 'scattered';
    gap?: number;
  } | null;
  razor?: boolean;
  /**
   * v7: taban kotu (arazinin üstünde m): verilirse sokak yürüme yüzeyi (ölçülmüş kaldırım bandı) yerine — kaldırımsız
   * sokakta duvar dibi yol kotunda (0), yüksek kaldırımda bordür üstü
   */
  base?: number;
  screen?: [number, number, string][];
  /** Ölçülmüş kolon konumları polyline boyunca (m) */
  pillarsU?: number[];
  /**
   * Dolgu ayrıntısı (ölçüm): yükseklik, renk; welded = 2D kaynaklı tel panel (5×20 cm göz, kalın tel, V kıvrımlı,
   * `post` arayla dikmeli — tip adında "2D"/"kaynaklı"/"welded" geçerse de), post = dikme aralığı (m)
   */
  infillSpec?: {
    h?: number;
    color?: string;
    type?: string;
    welded?: boolean;
    post?: number;
    /** Korkuluk üst borusu rengi (ör. galvaniz #859696); verilmezse tip metnindeki "üst boru … #hex" */
    topRail?: string;
    /** Üst boru adedi (çift boru: 2, 8 cm arayla) */
    topRails?: number;
  };
}

/**
 * Parça i'nin (pts[i]→pts[i+1]) iç tarafındaki (−n) çit bitkisi kutusunun u aralığı: komşu kol iç tarafa doğru
 * dönüyorsa (dışbükey köşe) o uçta komşu kolun duvar kalınlığı kadar (açıya göre) kırpılır.
 */
export function hedgeSpan(pts: V2[], i: number, n: V2, wallT: number): [number, number] {
  const a = pts[i];
  const e = pts[i + 1];
  const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
  const t: V2 = [(e[0] - a[0]) / (L || 1), (e[1] - a[1]) / (L || 1)];
  const dir = (p: V2, q: V2): V2 => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
  };
  const trim = (d: V2) => {
    // d: köşeden komşu kol boyunca birim yön; iç tarafa (−n) bileşeni
    const inward = -(d[0] * n[0] + d[1] * n[1]);
    if (inward < 0.25) return 0;
    const along = Math.abs(d[0] * t[0] + d[1] * t[1]);
    // Komşu kolun duvarı (kalınlık wallT, kolun kendi iç tarafında) bu parçanın ekseninde wallT / sin(açı) yer tutar
    return Math.min(L / 2, wallT / Math.max(0.3, inward) + along * wallT + 0.02);
  };
  const u0 = i > 0 ? trim(dir(a, pts[i - 1])) : 0;
  const u1 = i + 2 < pts.length ? L - trim(dir(e, pts[i + 2])) : L;
  return [u0, Math.max(u0, u1)];
}

const hex = (c: unknown, d: string) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d);

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

export function buildGenericFence(
  b: Builder,
  f: GenericFence,
  H: (x: number, z: number) => number,
  mat: (kind: string, color: string) => string,
  gaps: { c: V2; w: number }[],
  collide?: Collide,
  /** Yüksek/Ultra: harpuşta üst kenarları pahlı (m, 0 = yok) */
  bevel = 0,
  /**
   * v7: sokak yürüme yüzeyi kotu (street.ts surfaceAt; arazinin üstünde m, ölçülmüş bant yoksa null) — önceden
   * her noktada +0.15 (bordürlü kaldırım) varsayılıyordu: bordürsüz sokakta çit tabanı havada kalıyordu
   */
  surf?: (x: number, z: number) => number | null,
): void {
  // Taban: ölçülmüş base; yoksa çit hattının sokak yüzündeki yürüme yüzeyi (hat boyunca örneklerin ortancası — duvar
  // gövdesi bandın dışında kalsa da tüm parçalar aynı kotta); ölçülmüş bant yoksa +0.15 (eski varsayılan)
  const baseOff = (() => {
    if (f.base != null) return f.base;
    if (!surf) return 0.15;
    const v: number[] = [];
    for (let i = 0; i + 1 < f.pts.length; i++) {
      const a = f.pts[i];
      const e = f.pts[i + 1];
      const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 0.05) continue;
      const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
      const nn: V2 = f.n ?? [-t[1], t[0]];
      for (let k = 0; k <= Math.ceil(L / 2); k++) {
        const u = Math.min(L, k * 2);
        const h = surf(a[0] + t[0] * u + nn[0] * 0.1, a[1] + t[1] * u + nn[1] * 0.1);
        if (h != null) v.push(h);
      }
    }
    if (!v.length) return 0.15;
    v.sort((p, q) => p - q);
    return v[v.length >> 1];
  })();
  const baseY = (p: V2) => H(p[0], p[1]) + baseOff;
  const wallH = f.wall?.h ?? 0.6;
  const wallT = f.wall?.t ?? 0.22;
  const finish = (f.wall?.finish ?? 'render').toLowerCase();
  const wallKey = mat(
    /brick|tuğla/.test(finish)
      ? 'brick'
      : /stone|taş/.test(finish)
        ? 'stone'
        : /rib|nervür|precast/.test(finish)
          ? 'ribbed'
          : 'render',
    f.wall?.color ?? '#e6e3dc',
  );
  const cop = typeof f.coping === 'string' ? { color: f.coping } : (f.coping ?? {});
  const copKey = mat('render', cop.color ?? '#cfc8bb');
  const copH = cop.h ?? 0.06;
  const pil = f.pillars ?? {};
  const pW = pil.w ?? 0.4;
  const pH = pil.h ?? Math.max(wallH + 0.9, 1.5);
  const pKey = mat('render', hex(pil.color, hex(f.wall?.color, '#e6e3dc')));
  // Serbest duvar (kind "wall"): dolgu verilmemişse yok (yalnız duvar + harpuşta)
  const inf0 =
    typeof f.infill === 'string'
      ? { type: f.infill }
      : (f.infill ?? (f.kind === 'wall' ? { type: 'none' } : {}));
  const inf = { ...inf0, ...(f.infillSpec ?? {}), type: inf0.type ?? f.infillSpec?.type };
  const infType = (inf.type ?? 'railing').toLowerCase();
  // Ayrıntılı tanım (infillSpec.type) kısa tipi (infill: "railing") ezmesin: ikisi birlikte aranır
  const infDesc = `${inf0.type ?? ''} ${f.infillSpec?.type ?? ''}`.toLowerCase();
  const infH = inf.h ?? 1.0;
  const welded = !!f.infillSpec?.welded || /welded|kaynakl|\b2d\b/.test(infDesc) || /welded/.test(infType);
  const infKey = /mesh|tel|panel/.test(infType)
    ? mat('mesh', hex(inf.color, '#2f4a36'))
    : mat('bars', hex(inf.color, '#202224'));
  const hedgeH = f.hedge?.h ?? 0;
  const hedgeD = f.hedge?.depth ?? 0.8;
  const pts = f.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  // Sokak yönü: verilmişse n, yoksa polyline'ın sağı
  const at = (U: number) => {
    let i = 0;
    while (i + 2 < pts.length && cum[i + 1] < U) i++;
    const a = pts[i];
    const e = pts[i + 1];
    const L = cum[i + 1] - cum[i] || 1;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const u = U - cum[i];
    return { p: [a[0] + t[0] * u, a[1] + t[1] * u] as V2, t };
  };
  const gapsU: [number, number][] = [];
  for (const g of gaps) {
    let best = { d: Infinity, U: 0 };
    for (let U = 0; U <= total; U += 0.25) {
      const { p } = at(U);
      const d = Math.hypot(p[0] - g.c[0], p[1] - g.c[1]);
      if (d < best.d) best = { d, U };
    }
    if (best.d < 2.5) gapsU.push([best.U - g.w / 2, best.U + g.w / 2]);
  }
  const inGap = (U: number) => gapsU.some(([a, e]) => U > a && U < e);
  const scattered = f.hedge?.style === 'scattered';
  const screenAt = (U: number) => {
    for (const [a, e, s] of f.screen ?? []) if (U >= a && U <= e) return s;
    return hedgeH > 0 ? (scattered ? 'shrub' : 'real') : 'none';
  };
  // Kemerli panel üstü (ölçüm: 1540901772 istinat duvarı — panel uçlarında h − rise/2, ortada h + rise/2)
  const arch = f.wall?.arch;
  const archAt = (U: number): { f: number; joint: boolean } => {
    if (!arch?.pattern?.length) return { f: 0.5, joint: false };
    const per = arch.pattern.reduce((q, v) => q + v, 0);
    let r = ((U % per) + per) % per;
    for (const w of arch.pattern) {
      if (r <= w) return { f: r / w, joint: r < 0.12 || w - r < 0.12 };
      r -= w;
    }
    return { f: 0, joint: true };
  };
  // Panel üstü kemer: uçlarda (derzde) keskin düşüş, ortada düz yay (fotoğraf: bitişik kemerler sivri V'de birleşir)
  const wallTop = (U: number) =>
    arch ? wallH - arch.rise / 2 + arch.rise * Math.sin(Math.PI * archAt(U).f) : wallH;
  const legs = arch?.legs && arch.legs.spread > 0.1 ? arch.legs : null;
  if (arch?.pattern?.length && legs) {
    // v7 Λ bacaklı çelik kemerler: panel başına elips yayı, ayaklar derzin spread ötesinde, tepe panel ortasında
    const lk = mat('metal', hex(legs.color, hex(arch.joint, '#2c3a33')));
    const lw = Math.max(0.02, legs.w ?? 0.06);
    const per = arch.pattern.reduce((q, v) => q + v, 0);
    const infTop = infType === 'none' ? 0 : infH;
    const seg3 = (A: [number, number, number], B: [number, number, number]) => {
      const v = new THREE.Vector3(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      const L = v.length();
      if (L < 0.005) return;
      const g = new THREE.BoxGeometry(lw, L + 0.01, 0.04);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
      g.translate((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
      b.geometry(lk, g);
    };
    for (let U0 = 0; U0 < total; U0 += per) {
      let acc = U0;
      for (const w of arch.pattern) {
        const Ja = acc;
        const Jb = acc + w;
        acc += w;
        const Um = (Ja + Jb) / 2;
        if (Um > total) break;
        const A = w / 2 + legs.spread;
        const Ht = legs.top ?? wallTop(Um) + copH + infTop;
        const NSg = 18;
        let prev: [number, number, number] | null = null;
        for (let k = 0; k <= NSg; k++) {
          const U = Um - A + (2 * A * k) / NSg;
          if (U < 0 || U > total || inGap(U)) {
            prev = null;
            continue;
          }
          const { p, t: tt } = at(U);
          const nn: V2 = f.n ?? [-tt[1], tt[0]];
          const q: V2 = [p[0] + nn[0] * 0.02, p[1] + nn[1] * 0.02];
          const yy = baseY(q) + Ht * Math.sqrt(Math.max(0, 1 - ((U - Um) / A) ** 2));
          const cur: [number, number, number] = [q[0], yy, q[1]];
          if (prev) seg3(prev, cur);
          prev = cur;
        }
      }
    }
  }
  if (arch?.pattern?.length && !legs) {
    // Sivri kemer derzi: iki eğik koyu şerit, yerde birleşip yukarıda kemer uçlarına açılır (V)
    const jKey = mat('render', arch.joint ?? '#2c3a33');
    const per = arch.pattern.reduce((q, v) => q + v, 0);
    for (let U0 = 0; U0 < total; U0 += per) {
      let acc = U0;
      for (const w of arch.pattern) {
        if (acc > 0.2 && acc < total - 0.2 && !inGap(acc)) {
          const { p, t: tt } = at(acc);
          const nn: V2 = f.n ?? [-tt[1], tt[0]];
          const q: V2 = [p[0] + nn[0] * 0.01, p[1] + nn[1] * 0.01];
          const yy = baseY(q);
          const yawJ = Math.atan2(-tt[1], tt[0]);
          // Kemer kenarı: dörtte bir elips, derz dibinden (0.25 m) iki yana panel üstüne kıvrılır (ince koyu şerit)
          const reach = 1.4;
          const segs = 7;
          for (const sg of [-1, 1]) {
            let prev: [number, number] | null = null;
            for (let k = 0; k <= segs; k++) {
              const th = (k / segs) * (Math.PI / 2);
              const du = sg * reach * (1 - Math.cos(th));
              const top = wallTop(acc + du) - 0.02;
              const yv = 0.25 + (top - 0.25) * Math.sin(th);
              if (prev) {
                const [pu, py] = prev;
                const len = Math.hypot(du - pu, yv - py);
                const g = new THREE.BoxGeometry(0.06, len + 0.02, wallT + 0.03);
                g.rotateZ(-Math.atan2(du - pu, yv - py));
                g.translate((du + pu) / 2, (yv + py) / 2, 0);
                g.rotateY(yawJ);
                g.translate(q[0], yy, q[1]);
                b.geometry(jKey, g);
              }
              prev = [du, yv];
            }
          }
        }
        acc += w;
      }
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const e = pts[i + 1];
    const L = cum[i + 1] - cum[i];
    if (L < 0.05) continue;
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    let n: V2 = f.n ?? [-t[1], t[0]];
    if (f.n && n[0] * -t[1] + n[1] * t[0] < 0) n = [...f.n] as V2;
    const yaw = Math.atan2(-t[1], t[0]);
    // Sokak yüzü off=0, içeri −n
    const P = (u: number, off: number): V2 => [a[0] + t[0] * u - n[0] * off, a[1] + t[1] * u - n[1] * off];
    // Köşede komşu kol çitin iç tarafına (−n) dönüyorsa çit kutusu o kolun duvarında biter: önceden kutu köşeyi
    // aşıp komşu kolun duvar yüzünü örtüyordu (DA-2 kemerli duvar / 503. Sk. köşesi (202,−151), critic da2-03)
    const [hedgeU0, hedgeU1] = hedgeSpan(pts, i, n, wallT);
    const nS = Math.max(1, Math.ceil(L / (arch ? 0.35 : 2)));
    for (let k = 0; k < nS; k++) {
      const u0 = (L * k) / nS;
      const u1 = (L * (k + 1)) / nS;
      const mid = cum[i] + (u0 + u1) / 2;
      if (inGap(mid)) continue;
      const c = P((u0 + u1) / 2, wallT / 2);
      const y0 = baseY(c);
      const wH = wallTop(mid);
      if (wallH > 0.05) {
        b.box(wallKey, [c[0], y0 + (wH - 0.2) / 2, c[1]], [u1 - u0 + 0.004, wH + 0.2, wallT], yaw, 1);
        if (bevel > 0)
          b.bevelBox(
            copKey,
            [c[0], y0 + wH + copH / 2, c[1]],
            [u1 - u0 + 0.004, copH, wallT + 0.06],
            yaw,
            Math.min(bevel, copH * 0.4),
          );
        else b.box(copKey, [c[0], y0 + wH + copH / 2, c[1]], [u1 - u0 + 0.004, copH, wallT + 0.06], yaw);
      }
      if (/yatay|horizontal/.test(infDesc) && !/none|yok/.test(infType)) {
        // Yatay boru korkuluk (ölçüm: "4 sıra yatay gri çelik boru"): eşit aralıklı borular, dikey çubuk yok
        const nT = Number(/(\d+)\s*sıra/.exec(infDesc)?.[1] ?? 4) || 4;
        const yb = y0 + wH + copH;
        const m = P((u0 + u1) / 2, wallT / 2);
        const tk = mat('metal', hex(inf.color, '#61717d'));
        for (let j = 1; j <= nT; j++)
          b.box(tk, [m[0], yb + (infH * j) / nT - 0.02, m[1]], [u1 - u0 + 0.004, 0.04, 0.04], yaw);
      } else if (welded && !/none|yok/.test(infType)) {
        // 2D kaynaklı tel panel: kalın dikey teller (5 cm) + yatay teller (20 cm) dokusu, V kıvrımları, üst/alt tel
        const pa = P(u0, wallT / 2);
        const pe = P(u1, wallT / 2);
        const yb = y0 + wH + copH;
        const wk = mat('welded', hex(inf.color, '#2f4a36'));
        const rk = mat('metal', hex(inf.color, '#2f4a36'));
        b.wall(wk, pa, pe, yb, yb + infH, [0, 0, (u1 - u0) / 0.2, infH / 0.2]);
        b.wall(wk, pe, pa, yb, yb + infH, [0, 0, (u1 - u0) / 0.2, infH / 0.2]);
        const m = P((u0 + u1) / 2, wallT / 2);
        for (const fy of [0.03, 0.28, infH < 1.3 ? 0.62 : 0.5, infH - 0.03]) {
          if (fy > infH) continue;
          b.box(rk, [m[0], yb + fy, m[1]], [u1 - u0 + 0.004, 0.035, 0.03], yaw);
        }
      } else if (!/none|yok/.test(infType)) {
        const pa = P(u0, wallT / 2);
        const pe = P(u1, wallT / 2);
        const yb = y0 + wH + copH;
        b.wall(infKey, pa, pe, yb, yb + infH, [
          0,
          0,
          (u1 - u0) / (/mesh|tel|panel/.test(infType) ? 0.2 : 0.12),
          /mesh|tel|panel/.test(infType) ? infH / 0.2 : 1,
        ]);
        b.wall(infKey, pe, pa, yb, yb + infH, [
          0,
          0,
          (u1 - u0) / (/mesh|tel|panel/.test(infType) ? 0.2 : 0.12),
          /mesh|tel|panel/.test(infType) ? infH / 0.2 : 1,
        ]);
        const m = P((u0 + u1) / 2, wallT / 2);
        // Üst boru: ölçülen `topRail` rengi (ya da tip metnindeki "üst boru … #hex"), `topRails` adet (çift boru
        // 8 cm arayla); yoksa dolgu rengi
        const trHex =
          f.infillSpec?.topRail ?? /üst boru[^#]*?(#[0-9a-f]{6})/i.exec(f.infillSpec?.type ?? '')?.[1];
        const trKey = trHex
          ? mat('metal', hex(trHex, '#859696'))
          : infKey === mat('bars', inf.color ?? '#202224')
            ? mat('metal', inf.color ?? '#202224')
            : mat('metal', '#2f4a36');
        const nTr = Math.max(1, Math.min(3, f.infillSpec?.topRails ?? 1));
        for (let j = 0; j < nTr; j++)
          b.box(trKey, [m[0], yb + infH - j * 0.08, m[1]], [u1 - u0, 0.045, 0.045], yaw);
      }
      const scr = screenAt(mid);
      if (/shrub|çalı|partial|kesintili/.test(scr) && hedgeH > 0) {
        // Kesintili çalı öbekleri (sürekli çit değil)
        for (let uu = u0 + 0.5; uu < u1; uu += Math.max(0.5, f.hedge?.gap ?? 1.1)) {
          const hs = Math.sin((cum[i] + uu) * 7.31 + 1.7) * 43758.5453;
          const rr = hs - Math.floor(hs);
          if (rr < 0.35) continue;
          const bp = P(uu, wallT + 0.5 + rr * 0.6);
          const g = new THREE.SphereGeometry(0.55 + rr * 0.35, 9, 7);
          g.scale(1, (hedgeH * (0.6 + 0.5 * rr)) / (1.1 + rr * 0.7), 1);
          g.translate(bp[0], y0 + hedgeH * 0.45, bp[1]);
          b.geometry('boxwood', g);
        }
      }
      const hu0 = Math.max(u0, hedgeU0);
      const hu1 = Math.min(u1, hedgeU1);
      if (scr === 'real' && hedgeH > 0 && hu1 > hu0 + 0.01) {
        const hc = P((hu0 + hu1) / 2, wallT + hedgeD / 2 + 0.05);
        b.box(
          'mkHedge',
          [hc[0], y0 + hedgeH / 2 - 0.1, hc[1]],
          [hu1 - hu0 + (hu1 - hu0 < u1 - u0 ? 0 : 0.02), hedgeH + 0.2, hedgeD],
          yaw,
          0.5,
          0b111111 & ~0b100000,
        );
        for (let uu = u0 + 0.4; uu < u1; uu += 0.8) {
          if (uu < hedgeU0 + 0.3 || uu > hedgeU1 - 0.3) continue;
          const hs = Math.sin((cum[i] + uu) * 12.9898 + 3.1) * 43758.5453;
          const rr = hs - Math.floor(hs);
          const bp = P(uu, wallT + hedgeD * (0.35 + 0.3 * rr));
          const g = new THREE.SphereGeometry(0.45, 8, 6);
          g.scale(1.1, 0.35 + 0.3 * rr, 0.8);
          g.rotateY(yaw);
          g.translate(bp[0], y0 + hedgeH - 0.08, bp[1]);
          b.geometry('mkHedge', g);
        }
      }
      if (f.razor) {
        const rc = P((u0 + u1) / 2, wallT / 2);
        const top = y0 + wallH + copH + infH + 0.25;
        for (let uu = u0 + 0.1; uu < u1; uu += 0.2) {
          const p = P(uu, wallT / 2);
          const ring = new THREE.TorusGeometry(0.26, 0.005, 3, 14);
          ring.rotateY(yaw + Math.PI / 2 + 0.4);
          ring.translate(p[0], top, p[1]);
          b.geometry('wire', ring);
        }
        void rc;
      }
      collide?.(
        [
          P(u0, -0.02),
          P(u1, -0.02),
          P(u1, wallT + (hedgeH > 0 ? hedgeD : 0.05)),
          P(u0, wallT + (hedgeH > 0 ? hedgeD : 0.05)),
        ],
        y0 - 1,
        y0 + Math.max(wallH + infH, hedgeH),
      );
    }
  }
  // Kabartmalı prekast paneller (sokak yüzü): çerçeve + baklava / madalyon motifi
  const rel = f.wall?.relief;
  if (rel && wallH > 0.3) {
    const rk = mat('render', hex(rel.color, hex(f.wall?.color, '#e6e3dc')));
    const rd = Math.max(0.01, rel.d ?? 0.025);
    const pw = Math.max(0.6, rel.panel ?? pil.every ?? 2.0);
    const bar = (c: V2, yaw: number, lx: number, ly: number, len: number, ang: number, y: number) => {
      const g = new THREE.BoxGeometry(len, 0.05, rd);
      g.rotateZ(ang);
      g.translate(lx, ly, 0);
      g.rotateY(yaw);
      g.translate(c[0], y, c[1]);
      b.geometry(rk, g);
    };
    for (let U = 0; U + pw <= total + 0.05; U += pw) {
      const mid = U + pw / 2;
      if (inGap(mid) || inGap(U + 0.15) || inGap(U + pw - 0.15)) continue;
      const { p, t } = at(Math.min(total, mid));
      const n: V2 = f.n ?? [-t[1], t[0]];
      const c: V2 = [p[0] + n[0] * (rd / 2 + 0.005), p[1] + n[1] * (rd / 2 + 0.005)];
      const yaw = Math.atan2(-t[1], t[0]);
      const y0 = baseY(p);
      const wH = wallTop(mid);
      const hw = pw / 2 - 0.12;
      const y1 = wH - 0.12;
      const yl = 0.12;
      // Çerçeve
      bar(c, yaw, 0, yl, 2 * hw, 0, y0);
      bar(c, yaw, 0, y1, 2 * hw, 0, y0);
      bar(c, yaw, -hw, (yl + y1) / 2, y1 - yl, Math.PI / 2, y0);
      bar(c, yaw, hw, (yl + y1) / 2, y1 - yl, Math.PI / 2, y0);
      const ym = (yl + y1) / 2;
      if (rel.motif === 'rhombus') {
        const a = Math.min(hw * 0.7, 0.6);
        const cc = (y1 - yl) * 0.36;
        const L = Math.hypot(a, cc);
        const ang = Math.atan2(cc, a);
        bar(c, yaw, -a / 2, ym + cc / 2, L, ang, y0);
        bar(c, yaw, a / 2, ym + cc / 2, L, -ang, y0);
        bar(c, yaw, -a / 2, ym - cc / 2, L, -ang, y0);
        bar(c, yaw, a / 2, ym - cc / 2, L, ang, y0);
      } else if (rel.motif === 'medallion') {
        const r = Math.min(hw, (y1 - yl) / 2) * 0.55;
        const ring = new THREE.TorusGeometry(r, 0.03, 6, 24);
        ring.scale(1, 1, rd / 0.06);
        ring.translate(0, ym, 0);
        ring.rotateY(yaw);
        ring.translate(c[0], y0, c[1]);
        b.geometry(rk, ring);
        const disc = new THREE.CylinderGeometry(r * 0.45, r * 0.45, rd, 18);
        disc.rotateX(Math.PI / 2);
        disc.translate(0, ym, 0);
        disc.rotateY(yaw);
        disc.translate(c[0], y0, c[1]);
        b.geometry(rk, disc);
      }
    }
  }
  // 2D tel panel dikmeleri
  if (welded) {
    // Dikme aralığı: ölçülmüşse o, yoksa kolon aralığı (dikmeler kolonlarda), yoksa 2.5 m
    const every = Math.max(0.8, f.infillSpec?.post ?? pil.every ?? 2.5);
    const pk = mat('metal', hex(inf.color, '#2f4a36'));
    for (let U = 0; U <= total + 1e-6; U += every) {
      if (inGap(U)) continue;
      const { p, t } = at(Math.min(total, U));
      const yaw = Math.atan2(-t[1], t[0]);
      const n: V2 = f.n ?? [-t[1], t[0]];
      const q: V2 = [p[0] - n[0] * (wallT / 2), p[1] - n[1] * (wallT / 2)];
      const yb = baseY(p) + wallTop(U) + copH;
      b.box(pk, [q[0], yb + (infH + 0.05) / 2, q[1]], [0.06, infH + 0.05, 0.045], yaw);
    }
  }
  // Kolonlar (liste öğesi başına tekrar eden `every` konumları bir kez; önceden her dünya noktası için yineleniyordu)
  const Us: number[] = [];
  if (f.pillarsU?.length) Us.push(...f.pillarsU);
  else if (pil.list?.length) {
    for (const q of pil.list) if (typeof q === 'number') Us.push(q);
    if (pil.every && pil.list.some((q) => typeof q !== 'number'))
      for (let U = 0; U <= total + 1e-6; U += pil.every) Us.push(U);
  }
  for (const g of gapsU) Us.push(...g);
  const ornate = pil.style === 'ornate';
  for (const U of Us) {
    if (U < -0.01 || U > total + 0.01) continue;
    if (inGap(U + 0.02) && inGap(U - 0.02)) continue;
    const { p, t } = at(Math.max(0, Math.min(total, U)));
    const yaw = Math.atan2(-t[1], t[0]);
    const y0 = baseY(p);
    b.box(pKey, [p[0], y0 + pH / 2 - 0.1, p[1]], [pW, pH + 0.2, pW], yaw, 1);
    const capK = mat('render', hex(pil.cap, hex(pil.color, '#e8e4da')));
    let yTop = y0 + pH + 0.08;
    if (ornate) {
      // Süslü kolon: kaide, iki kademeli başlık, gövdenin iki yüzünde kabartma çerçeve
      b.box(capK, [p[0], y0 + 0.12, p[1]], [pW + 0.1, 0.24, pW + 0.1], yaw);
      b.box(capK, [p[0], y0 + pH + 0.035, p[1]], [pW + 0.14, 0.07, pW + 0.14], yaw);
      b.box(capK, [p[0], y0 + pH + 0.1, p[1]], [pW + 0.06, 0.06, pW + 0.06], yaw);
      yTop = y0 + pH + 0.13;
      const n: V2 = [-t[1], t[0]];
      for (const sg of [1, -1]) {
        const fc: V2 = [p[0] + n[0] * sg * (pW / 2 + 0.01), p[1] + n[1] * sg * (pW / 2 + 0.01)];
        const hh = pH - 0.6;
        if (hh < 0.3) continue;
        const ym = y0 + 0.3 + hh / 2;
        for (const du of [-pW / 2 + 0.07, pW / 2 - 0.07]) {
          const q: V2 = [fc[0] + t[0] * du, fc[1] + t[1] * du];
          b.box(capK, [q[0], ym, q[1]], [0.035, hh, 0.02], yaw);
        }
        for (const yy of [ym - hh / 2, ym + hh / 2])
          b.box(capK, [fc[0], yy, fc[1]], [pW - 0.1, 0.035, 0.02], yaw);
      }
    } else if (pil.cap !== false)
      b.box(capK, [p[0], y0 + pH + 0.04, p[1]], [pW + 0.08, 0.08, pW + 0.08], yaw);
    if (pil.finial === 'ball') b.sphere(capK, [p[0], yTop + pW * 0.28, p[1]], pW * 0.3, 10);
    else if (pil.finial === 'pyramid') {
      const g = new THREE.ConeGeometry(pW * 0.5, Math.max(0.15, pW * 0.6), 4);
      g.rotateY(Math.PI / 4 + yaw);
      g.translate(p[0], yTop + Math.max(0.15, pW * 0.6) / 2, p[1]);
      b.geometry(capK, g);
    }
    const lamp = typeof pil.lamp === 'string' ? pil.lamp.toLowerCase() : pil.lamp ? 'globe' : '';
    if (/globe|küre/.test(lamp)) {
      b.cylinder('capDark', [p[0], y0 + pH + 0.08, p[1]], 0.05, 0.1, 8);
      b.sphere('globe', [p[0], y0 + pH + 0.3, p[1]], 0.14, 12);
    } else if (/lantern|fener/.test(lamp)) {
      b.box('capDark', [p[0], y0 + pH + 0.25, p[1]], [0.2, 0.34, 0.2], yaw);
    }
    collide?.(
      [
        [p[0] - pW / 2, p[1] - pW / 2],
        [p[0] + pW / 2, p[1] - pW / 2],
        [p[0] + pW / 2, p[1] + pW / 2],
        [p[0] - pW / 2, p[1] + pW / 2],
      ],
      y0 - 1,
      y0 + pH,
    );
  }
}

/**
 * Siyah ferforje yaya kapısı (komşu siteler, street-plan gates style 'wrought'): tek/çift kanat, dikey çubuklar
 * (≈12 cm) mızrak uçlu, altta kıvrımlı süs bandı, orta kuşak; isteğe bağlı kolonlar. c: kapı merkezi (çit hattında),
 * n: sokak yönü, w: açıklık, h: kanat yüksekliği.
 */
export function buildWroughtGate(
  b: Builder,
  c: V2,
  n: V2,
  y0: number,
  w: number,
  h: number,
  mat: (kind: string, color: string) => string,
  o: { color?: string; leaves?: number; pillars?: { w: number; h: number; color: string } | null } = {},
): void {
  const t: V2 = [n[1], -n[0]];
  const yaw = Math.atan2(-t[1], t[0]);
  const P = (u: number, off: number): V2 => [c[0] + t[0] * u + n[0] * off, c[1] + t[1] * u + n[1] * off];
  const col = hex(o.color, '#1c1d1f');
  const k = mat('metal', col);
  if (o.pillars && o.pillars.w > 0.05) {
    const pk = mat('render', hex(o.pillars.color, '#d9d5cc'));
    for (const u of [-w / 2 - o.pillars.w / 2, w / 2 + o.pillars.w / 2]) {
      const p = P(u, 0);
      b.box(pk, [p[0], y0 + o.pillars.h / 2 - 0.1, p[1]], [o.pillars.w, o.pillars.h + 0.2, o.pillars.w], yaw);
      b.box(pk, [p[0], y0 + o.pillars.h + 0.03, p[1]], [o.pillars.w + 0.06, 0.06, o.pillars.w + 0.06], yaw);
    }
  }
  const leaves = Math.max(1, Math.min(2, o.leaves ?? (w > 1.8 ? 2 : 1)));
  const lw = w / leaves;
  for (let l = 0; l < leaves; l++) {
    const ua = -w / 2 + l * lw;
    const ue = ua + lw;
    const um = (ua + ue) / 2;
    // Çerçeve
    for (const u of [ua + 0.025, ue - 0.025]) {
      const p = P(u, 0);
      b.box(k, [p[0], y0 + h / 2, p[1]], [0.05, h, 0.05], yaw);
    }
    const m = P(um, 0);
    for (const yy of [0.06, 0.45, h * 0.62, h - 0.12])
      b.box(k, [m[0], y0 + yy, m[1]], [lw - 0.05, 0.04, 0.04], yaw);
    // Alt süs bandı (kıvrımlı), iki yüz
    const a = P(ua + 0.05, 0);
    const e = P(ue - 0.05, 0);
    b.wall('ironScroll', a, e, y0 + 0.08, y0 + 0.43, [0, 0, Math.max(1, Math.round(lw / 0.5)), 1]);
    b.wall('ironScroll', e, a, y0 + 0.08, y0 + 0.43, [0, 0, Math.max(1, Math.round(lw / 0.5)), 1]);
    // Dikey çubuklar + mızrak uçları (üst kuşağı aşar)
    const nb = Math.max(3, Math.round((lw - 0.1) / 0.12));
    for (let j = 1; j < nb; j++) {
      const u = ua + 0.05 + ((lw - 0.1) * j) / nb;
      const p = P(u, 0);
      b.box(k, [p[0], y0 + 0.45 + (h - 0.45) / 2 + 0.04, p[1]], [0.018, h - 0.45 + 0.08, 0.018], yaw);
      const g = new THREE.ConeGeometry(0.03, 0.1, 4);
      g.translate(p[0], y0 + h + 0.13, p[1]);
      b.geometry(k, g);
    }
  }
  // Kol + kilit
  const kp = P(leaves === 2 ? -0.08 : w / 2 - 0.12, 0.04);
  b.box('darkMetal', [kp[0], y0 + 1.0, kp[1]], [0.12, 0.03, 0.04], yaw);
}
