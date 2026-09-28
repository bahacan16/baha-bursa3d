import * as THREE from 'three';
import { Builder, type V2, type V3 } from './builder';

/**
 * Mertkent 2 apartman bloğu (Street View karelerinden):
 * - Beyaz ince sıva, her katta ince derz; balkon arkası duvarlar açık gri.
 * - OSM taban izindeki 1–4 m'lik girinti/çıkıntılar gerçek: iç köşelere (girintilere) oturan, çıkıntının
 *   önüne ~35 cm taşan balkonlar ("basamaklı" görünüm), dış köşelerde köşeyi saran balkonlar.
 * - Çıkıntı yüzlerinde pencere sütunları, iki yanında bej-turuncu dikey şeritler.
 * - Pencereler duvara 14 cm gömülü (söve/lento/denizlik yüzeyleri ayrı), beyaz PVC; bazılarında panjur kutusu,
 *   en üst katta bazılarında fransız balkon korkuluğu.
 * - Balkon: 16 cm döşeme, orta gri alın bandı, açık yeşilimsi cam korkuluk + paslanmaz küpeşte, tavanda spot;
 *   ~%30 cam balkon; klima dış üniteleri, Türksat'a (GGD) bakan çanak antenler; iç köşelerde yağmur borusu.
 * - Giriş: çift kanat alüminyum kapı, basamaklar, cam saçak, blok adı; çatıda kırma kiremit + güneş enerjili
 *   su ısıtıcıları (güneye bakan yüzde).
 */
export interface ApartmentOptions {
  ring: V2[];
  base: number;
  floors?: number;
  floorH?: number;
  seed: number;
  /** Site içinin bir noktası: giriş bu yöne bakan cepheye konur */
  inside?: V2;
  /** Blok adı ("A") */
  name?: string;
  /** Blok adı levhasının malzeme anahtarı */
  signKey?: string;
}

export const FLOOR_H = 2.95;
const PLINTH = 0.45;
const WIN_W = 1.15;
const WIN_H = 1.45;
const SILL = 0.9;
const COL_PITCH = 2.6;
const REVEAL = 0.14;
const SLAB_T = 0.16;
const FASCIA_H = 0.45;
const DOOR_W = 0.9;
const DOOR_H = 2.2;
const BAL_W = 3.0;
const BAL_D = 1.3;
const STRIP_OFF = 0.26;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function insidePoly(r: V2[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Halka yönünü, (−dz, dx) dış normal olacak şekilde ayarla (Builder.wall ön yüzüyle uyumlu). */
export function orientOutward(r: V2[]): V2[] {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, z0] = r[i];
    const [x1, z1] = r[(i + 1) % r.length];
    a += x0 * z1 - x1 * z0;
  }
  // a>0: x→z yönünde CCW (z aşağı ekranda) → (−dz,dx) içe bakar; ters çevir
  return a > 0 ? [...r].reverse() : r;
}

/** Neredeyse aynı doğrultudaki ve çok kısa kenarları temizle. */
function cleanRing(r: V2[]): V2[] {
  let out = r.slice();
  for (let pass = 0; pass < 3; pass++) {
    const next: V2[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[(i - 1 + out.length) % out.length];
      const c = out[i];
      const n = out[(i + 1) % out.length];
      const ax = c[0] - p[0];
      const az = c[1] - p[1];
      const bx = n[0] - c[0];
      const bz = n[1] - c[1];
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      if (la < 0.05) continue;
      const cross = (ax * bz - az * bx) / (la * lb || 1);
      if (Math.abs(cross) < 0.05 && ax * bx + az * bz > 0) continue; // doğrusal
      next.push(c);
    }
    out = next;
  }
  return out;
}

function edgeInfo(r: V2[], i: number) {
  const a = r[i];
  const e = r[(i + 1) % r.length];
  const dx = e[0] - a[0];
  const dz = e[1] - a[1];
  const len = Math.hypot(dx, dz);
  const t: V2 = [dx / len, dz / len];
  const n: V2 = [-t[1], t[0]];
  return { a, e, len, t, n };
}

/** En küçük alanlı yönlü dikdörtgen (kenar yönleri üzerinden). */
function obb(r: V2[]) {
  let best = { area: Infinity, c: [0, 0] as V2, ax: [1, 0] as V2, w: 0, d: 0 };
  for (let i = 0; i < r.length; i++) {
    const { t, len } = edgeInfo(r, i);
    if (len < 1) continue;
    const n: V2 = [-t[1], t[0]];
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of r) {
      const u = p[0] * t[0] + p[1] * t[1];
      const v = p[0] * n[0] + p[1] * n[1];
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      best = { area, c: [t[0] * uc + n[0] * vc, t[1] * uc + n[1] * vc], ax: t, w: u1 - u0, d: v1 - v0 };
    }
  }
  return best;
}

interface Opening {
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  key: string;
  sill: boolean;
  shutter?: boolean;
  juliet?: boolean;
}

interface Balcony {
  /** Döşeme dış çizgisi */
  slab: V2[];
  /** Korkuluk hattı (duvardan duvara) */
  rail: V2[];
  /** Klima/çanak yerleşimi için: duvar dibi noktası ve duvar normali */
  wallPt: V2;
  wallN: V2;
  enclosed: boolean[];
  ac: boolean[];
  dish: boolean[];
}

/** Kenar üzerinde bir aralık: balkon arkası mı, pencere bölgesi mi */
interface Claim {
  s0: number;
  s1: number;
  balcony: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Türksat 42°D: Bursa'dan ~GGD (157°), ~40° yükseklik → çanağın bombe ekseni bunun tersi */
const DISH_POLE = new THREE.Vector3(-0.293, -0.643, -0.708).normalize();

export function buildApartment(b: Builder, o: ApartmentOptions): { top: number } {
  const floors = o.floors ?? 7;
  const FH = o.floorH ?? FLOOR_H;
  const r = cleanRing(orientOutward(o.ring));
  const N = r.length;
  const rnd = rng(o.seed);
  const y0 = o.base - 0.6;
  const yG = o.base + PLINTH; // zemin kat döşemesi
  const yF = (k: number) => yG + k * FH;
  const top = yF(floors) + 0.15;
  const E = r.map((_, i) => edgeInfo(r, i));
  // Köşe türü: köşe i, kenar i−1'in sonu ve kenar i'nin başı
  const turn = r.map((_, i) => {
    const A = E[(i - 1 + N) % N];
    const B = E[i];
    return A.t[0] * B.t[1] - A.t[1] * B.t[0];
  });
  const convex = (i: number) => turn[(i + N) % N] < -0.5;
  const concave = (i: number) => turn[(i + N) % N] > 0.5;

  const claims: Claim[][] = r.map(() => []);
  const bals: Balcony[] = [];
  const mkFloors = (p: number) => Array.from({ length: floors }, () => rnd() < p);
  const P = (i: number, s: number, off = 0): V2 => {
    const { a, t, n } = E[i];
    return [a[0] + t[0] * s + n[0] * off, a[1] + t[1] * s + n[1] * off];
  };

  // ── Dış köşe balkonları (köşeyi saran) ──
  for (let i = 0; i < N; i++) {
    if (!convex(i)) continue;
    const ia = (i - 1 + N) % N;
    const A = E[ia];
    const B = E[i];
    if (A.len < 2.6 || B.len < 2.6) continue;
    // Karşı uçta da balkon olabilir: kenarın yarısını geçme
    const la = Math.min(BAL_W, A.len / 2 - 0.1);
    const lb = Math.min(BAL_W * 0.8, B.len / 2 - 0.1);
    const c = r[i];
    const pA: V2 = [c[0] - A.t[0] * la, c[1] - A.t[1] * la];
    const pB: V2 = [c[0] + B.t[0] * lb, c[1] + B.t[1] * lb];
    const oA: V2 = [pA[0] + A.n[0] * BAL_D, pA[1] + A.n[1] * BAL_D];
    const oB: V2 = [pB[0] + B.n[0] * BAL_D, pB[1] + B.n[1] * BAL_D];
    const oc: V2 = [c[0] + (A.n[0] + B.n[0]) * BAL_D, c[1] + (A.n[1] + B.n[1]) * BAL_D];
    bals.push({
      slab: [pA, c, pB, oB, oc, oA],
      rail: [pA, oA, oc, oB, pB],
      wallPt: pA,
      wallN: A.n,
      enclosed: mkFloors(0.2),
      ac: mkFloors(0.3),
      dish: mkFloors(0.2),
    });
    claims[ia].push({ s0: A.len - la, s1: A.len, balcony: true });
    claims[i].push({ s0: 0, s1: lb, balcony: true });
  }

  // ── İç köşe (girinti) balkonları ──
  const used = new Set<string>();
  for (let i = 0; i < N; i++) {
    if (!concave(i)) continue;
    const ia = (i - 1 + N) % N;
    const A = E[ia];
    const B = E[i];
    // Ana kenar uzun olan; dönüş (basamak) kısa
    const mainIsB = B.len >= A.len;
    const main = mainIsB ? i : ia;
    const ret = mainIsB ? A : B;
    const M = E[main];
    if (M.len < 2.2 || ret.len < 0.5 || ret.len > 6) continue;
    // Ana kenarın diğer ucu da iç köşe ve kenar kısaysa: tüm kenar boyunca tek balkon (girinti)
    const otherEnd = mainIsB ? i + 1 : ia;
    const otherConcave = concave(otherEnd);
    const key = `${main}`;
    if (used.has(key) && otherConcave) continue;
    let s0: number;
    let s1: number;
    if (otherConcave && M.len < BAL_W * 2 + 1.2) {
      s0 = 0;
      s1 = M.len;
      used.add(key);
    } else if (mainIsB) {
      s0 = 0;
      s1 = Math.min(BAL_W, M.len - 0.3);
    } else {
      s0 = Math.max(0.3, M.len - BAL_W);
      s1 = M.len;
    }
    // Önceden alınmış (dış köşe balkonu) aralıklarla çakışmasın
    for (const c of claims[main]) {
      if (c.s1 <= s0 || c.s0 >= s1) continue;
      if (c.s0 <= s0) s0 = c.s1 + 0.3;
      else s1 = c.s0 - 0.3;
    }
    if (s1 - s0 < 1.6) continue;
    // Basamak derinliği: iki uçtaki dönüşlerden büyüğü
    let depth = ret.len;
    if (s0 === 0 && s1 === M.len) {
      const rA = E[(main - 1 + N) % N].len;
      const rB = E[(main + 1) % N].len;
      depth = Math.max(concave(main) ? rA : 0, concave(main + 1) ? rB : 0);
    }
    if (depth > 2.4) depth = BAL_D - 0.35;
    const D = Math.min(2.1, depth + 0.35);
    const a0 = P(main, s0);
    const a1 = P(main, s1);
    const o0 = P(main, s0, D);
    const o1 = P(main, s1, D);
    // Korkuluk, dönüş duvarının bittiği yerden başlar
    const rail: V2[] = [];
    const startsAtWall = s0 === 0 && concave(main);
    const endsAtWall = s1 === M.len && concave(main + 1);
    const rS = E[(main - 1 + N) % N].len;
    const rE = E[(main + 1) % N].len;
    if (startsAtWall && rS < D) rail.push(P(main, s0, rS));
    if (!startsAtWall) rail.push(a0);
    rail.push(o0, o1);
    if (!endsAtWall) rail.push(a1);
    if (endsAtWall && rE < D) rail.push(P(main, s1, rE));
    bals.push({
      slab: [a0, a1, o1, o0],
      rail,
      wallPt: P(main, (s0 + s1) / 2),
      wallN: M.n,
      enclosed: mkFloors(0.25),
      ac: mkFloors(0.35),
      dish: mkFloors(0.25),
    });
    claims[main].push({ s0, s1, balcony: true });
    // Dönüş duvarının balkon arkasında kalan kısmı
    const retIdx = mainIsB ? ia : i;
    const RL = E[retIdx].len;
    const cover = Math.min(D, RL);
    if (mainIsB) claims[retIdx].push({ s0: RL - cover, s1: RL, balcony: true });
    else claims[retIdx].push({ s0: 0, s1: cover, balcony: true });
  }

  // ── Uzun düz cephelerin ortasında çıkma balkonlar (OSM izi sadeleştirilmiş cepheler) ──
  for (let i = 0; i < N; i++) {
    const M = E[i];
    for (const [u0, u1] of freeIntervals(M.len, claims[i])) {
      const L = u1 - u0;
      if (L < 9) continue;
      const pair = L >= 15;
      const w = pair ? 2.9 : 3.0;
      const mid = (u0 + u1) / 2;
      const starts = pair ? [mid - w, mid] : [mid - w / 2];
      for (const s0 of starts) {
        const s1 = s0 + w;
        const a0 = P(i, s0);
        const a1 = P(i, s1);
        const o0 = P(i, s0, BAL_D);
        const o1 = P(i, s1, BAL_D);
        bals.push({
          slab: [a0, a1, o1, o0],
          rail: [a0, o0, o1, a1],
          wallPt: P(i, (s0 + s1) / 2),
          wallN: M.n,
          enclosed: mkFloors(0.2),
          ac: mkFloors(0.3),
          dish: mkFloors(0.2),
        });
        claims[i].push({ s0, s1, balcony: true });
      }
    }
  }

  // ── Giriş kenarı: site içine en iyi bakan uzun kenar ──
  let entryEdge = -1;
  let entryS = 0;
  if (o.inside) {
    let bestScore = -Infinity;
    for (let i = 0; i < N; i++) {
      const { a, e, len, n } = E[i];
      if (len < 3) continue;
      const mx = (a[0] + e[0]) / 2;
      const mz = (a[1] + e[1]) / 2;
      const dx = o.inside[0] - mx;
      const dz = o.inside[1] - mz;
      const d = Math.hypot(dx, dz) || 1;
      const face = (dx * n[0] + dz * n[1]) / d;
      if (face < 0.3) continue;
      // Serbest (balkonsuz) en geniş aralık
      const free = freeIntervals(len, claims[i]);
      const best = free.reduce((m, f) => (f[1] - f[0] > m[1] - m[0] ? f : m), [0, 0] as [number, number]);
      if (best[1] - best[0] < 2.4) continue;
      const score = face * 2 + (best[1] - best[0]) * 0.1 - d * 0.02;
      if (score > bestScore) {
        bestScore = score;
        entryEdge = i;
        entryS = (best[0] + best[1]) / 2;
      }
    }
  }

  // ── Duvarlar: açıklıklar, şeritler, pencereler ──
  for (let i = 0; i < N; i++) {
    const { a, e, len, t } = E[i];
    if (len < 0.05) continue;
    const yaw = Math.atan2(-t[1], t[0]);
    b.wall('plinth', a, e, y0, yG, [0, 0, len, PLINTH + 0.6]);
    const openings: Opening[] = [];
    const cl = claims[i];
    // Balkon arkası: her katta kapı (+ yer varsa pencere)
    for (const c of cl) {
      const w = c.s1 - c.s0;
      if (w < 1.3) continue;
      const hasWin = w >= 2.6;
      const dc = hasWin ? c.s0 + w * 0.3 : (c.s0 + c.s1) / 2;
      for (let k = 0; k < floors; k++) {
        openings.push({
          s0: dc - DOOR_W / 2,
          s1: dc + DOOR_W / 2,
          y0: yF(k) + 0.02,
          y1: yF(k) + DOOR_H,
          key: `win${Math.floor(rnd() * 4)}`,
          sill: false,
        });
        if (hasWin) {
          const wc = c.s0 + w * 0.72;
          openings.push({
            s0: wc - WIN_W / 2,
            s1: wc + WIN_W / 2,
            y0: yF(k) + SILL,
            y1: yF(k) + SILL + WIN_H,
            key: `win${Math.floor(rnd() * 4)}`,
            sill: false,
          });
        }
      }
    }
    // Pencere bölgeleri
    const free = freeIntervals(len, cl);
    for (const [u0, u1] of free) {
      const L = u1 - u0;
      if (L < 1.5) continue;
      const nCols = Math.max(1, Math.floor(L / COL_PITCH));
      const ww = Math.min(WIN_W, L - 0.5);
      if (ww < 0.5) continue;
      for (let c = 0; c < nCols; c++) {
        const s = u0 + ((c + 0.5) / nCols) * L;
        const isEntry = i === entryEdge && Math.abs(s - entryS) < COL_PITCH / 2;
        // Şeritler: dar bölgelerde her sütunda, geniş bölgelerde dönüşümlü
        if (nCols <= 2 || c % 2 === 0) {
          for (const side of [-1, 1]) {
            const sx = s + side * (ww / 2 + STRIP_OFF);
            if (sx < 0.15 || sx > len - 0.15) continue;
            const p = P(i, sx, 0.035);
            b.box('ochre', [p[0], (yG + top - 0.25) / 2, p[1]], [0.2, top - 0.25 - yG, 0.07], yaw);
          }
        }
        const shutterCol = rnd() < 0.3;
        for (let k = 0; k < floors; k++) {
          if (isEntry && k === 0) continue;
          openings.push({
            s0: s - ww / 2,
            s1: s + ww / 2,
            y0: yF(k) + SILL,
            y1: yF(k) + SILL + WIN_H,
            key: `win${Math.floor(rnd() * 4)}`,
            sill: true,
            shutter: shutterCol && rnd() < 0.7,
            juliet: k === floors - 1 && rnd() < 0.5,
          });
        }
      }
    }
    // Giriş
    if (i === entryEdge) {
      const dw = 1.8;
      openings.push({
        s0: entryS - dw / 2,
        s1: entryS + dw / 2,
        y0: yG,
        y1: yG + 2.35,
        key: 'entryDoor',
        sill: false,
      });
      buildEntrance(b, P, i, entryS, o.base, yG, yaw, o.signKey);
    }
    // Duvar yüzeyi (açıklıkları dışarıda bırakarak), balkon arkası açık gri
    wallWithOpenings(b, i, P, len, yG, top, FH, openings, cl);
    for (const op of openings) addOpening(b, P, i, op, yaw);
    // Çatı saçağı alın bandı (koyu gri), duvardan 0.35 m dışarıda
    const ea = P(i, -0.35, 0.35);
    const ee = P(i, len + 0.35, 0.35);
    b.wall('eave', ea, ee, top - 0.05, top + 0.4);
  }

  // ── Yağmur boruları: iç köşeler + bazı dış köşeler ──
  for (let i = 0; i < N; i++) {
    const A = E[(i - 1 + N) % N];
    const B = E[i];
    if (!concave(i) && !(convex(i) && rnd() < 0.35)) continue;
    const c = r[i];
    const k = concave(i) ? 0.12 : -0.06;
    const px = c[0] + (A.n[0] + B.n[0]) * k + (concave(i) ? 0 : (A.n[0] + B.n[0]) * 0.14);
    const pz = c[1] + (A.n[1] + B.n[1]) * k + (concave(i) ? 0 : (A.n[1] + B.n[1]) * 0.14);
    b.cylinder('pipe', [px, o.base, pz], 0.05, top - o.base, 8);
    for (let y = yG + 1.5; y < top; y += FH) b.box('pipe', [px, y, pz], [0.14, 0.04, 0.14]);
  }

  // ── Balkonlar ──
  for (const bl of bals) buildBalcony(b, bl, floors, yF, FH, rnd);

  // ── Çatı ──
  const roofTop = buildRoof(b, r, top, rnd);
  return { top: roofTop };
}

/** [0,len] içinde balkon arkası olmayan aralıklar */
function freeIntervals(len: number, cl: Claim[]): [number, number][] {
  const s = cl.map((c) => [c.s0 - 0.25, c.s1 + 0.25] as [number, number]).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cur = 0.2;
  for (const [a, e] of s) {
    if (a > cur) out.push([cur, a]);
    cur = Math.max(cur, e);
  }
  if (len - 0.2 > cur) out.push([cur, len - 0.2]);
  return out;
}

type PFn = (i: number, s: number, off?: number) => V2;

/** Duvarı açıklıkların etrafında parçalara böl (yatay bantlar), UV: 2 m × 1 kat */
function wallWithOpenings(
  b: Builder,
  i: number,
  P: PFn,
  len: number,
  Y0: number,
  Y1: number,
  FH: number,
  ops: Opening[],
  cl: Claim[],
): void {
  const ys = new Set<number>([Y0, Y1]);
  for (const o of ops) {
    ys.add(Math.max(Y0, Math.min(Y1, o.y0)));
    ys.add(Math.max(Y0, Math.min(Y1, o.y1)));
  }
  // Balkon arkası bölge sınırları (renk değişimi)
  const xs = new Set<number>([0, len]);
  for (const c of cl) {
    xs.add(Math.max(0, Math.min(len, c.s0)));
    xs.add(Math.max(0, Math.min(len, c.s1)));
  }
  const yl = [...ys].sort((p, q) => p - q);
  const xl = [...xs].sort((p, q) => p - q);
  for (let k = 0; k + 1 < yl.length; k++) {
    const ya = yl[k];
    const yb = yl[k + 1];
    if (yb - ya < 1e-4) continue;
    const cover = ops
      .filter((o) => o.y0 <= ya + 1e-4 && o.y1 >= yb - 1e-4)
      .map((o) => [Math.max(0, o.s0), Math.min(len, o.s1)] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    // Boşluklar
    const gaps: [number, number][] = [];
    let cur = 0;
    for (const [a, e] of cover) {
      if (a > cur) gaps.push([cur, a]);
      cur = Math.max(cur, e);
    }
    if (cur < len) gaps.push([cur, len]);
    for (const [g0, g1] of gaps) {
      // Balkon arkası sınırlarında da böl
      const cuts = [g0, ...xl.filter((x) => x > g0 + 1e-4 && x < g1 - 1e-4), g1];
      for (let j = 0; j + 1 < cuts.length; j++) {
        const sa = cuts[j];
        const sb = cuts[j + 1];
        if (sb - sa < 1e-4) continue;
        const mid = (sa + sb) / 2;
        const grey = cl.some((c) => mid > c.s0 && mid < c.s1);
        b.wall(grey ? 'plasterGrey' : 'plaster', P(i, sa), P(i, sb), ya, yb, [
          sa / 2,
          (ya - Y0) / FH,
          sb / 2,
          (yb - Y0) / FH,
        ]);
      }
    }
  }
}

function addOpening(b: Builder, P: PFn, i: number, o: Opening, yaw: number): void {
  const R = o.key === 'entryDoor' ? 0.22 : REVEAL;
  const V = (p: V2, y: number): V3 => [p[0], y, p[1]];
  const a0 = P(i, o.s0);
  const a1 = P(i, o.s1);
  const b0 = P(i, o.s0, -R);
  const b1 = P(i, o.s1, -R);
  // Söveler, lento, iç denizlik
  b.wall('reveal', a0, b0, o.y0, o.y1, [0, 0, R, o.y1 - o.y0]);
  b.wall('reveal', b1, a1, o.y0, o.y1, [0, 0, R, o.y1 - o.y0]);
  b.quad('reveal', V(b0, o.y1), V(b1, o.y1), V(a1, o.y1), V(a0, o.y1));
  b.quad('revealSill', V(a0, o.y0), V(a1, o.y0), V(b1, o.y0), V(b0, o.y0));
  // Doğrama + cam
  b.wall(o.key, b0, b1, o.y0, o.y1);
  const w = o.s1 - o.s0;
  const sm = (o.s0 + o.s1) / 2;
  if (o.sill) {
    const ps = P(i, sm, 0.04);
    b.box('sill', [ps[0], o.y0 - 0.025, ps[1]], [w + 0.12, 0.05, 0.16], yaw);
  }
  if (o.shutter) {
    // Panjur kutusu (lentonun hemen üstünde, duvar yüzünde)
    const ps = P(i, sm, 0.07);
    b.box('shutterBox', [ps[0], o.y1 + 0.1, ps[1]], [w + 0.1, 0.2, 0.14], yaw);
    // Yarı inik panjur
    const drop = 0.2 + ((sm * 7.3) % 1) * 0.5;
    b.wall('shutter', P(i, o.s0, -0.02), P(i, o.s1, -0.02), o.y1 - drop, o.y1, [0, 0, 1, drop / 0.05]);
  }
  if (o.juliet) {
    for (const h of [0.35, 0.65, 0.95]) {
      const pr = P(i, sm, 0.06);
      b.box('rail', [pr[0], o.y0 + h, pr[1]], [w + 0.05, 0.025, 0.025], yaw);
    }
    for (const s of [o.s0 + 0.02, o.s1 - 0.02]) {
      const pr = P(i, s, 0.06);
      b.box('rail', [pr[0], o.y0 + 0.5, pr[1]], [0.03, 1.0, 0.03], yaw);
    }
  }
}

function buildEntrance(
  b: Builder,
  P: PFn,
  i: number,
  s: number,
  base: number,
  yG: number,
  yaw: number,
  signKey?: string,
): void {
  // Basamaklar + sahanlık
  const W = 2.6;
  const steps = 3;
  const rise = (yG - base) / steps;
  for (let k = 0; k < steps; k++) {
    const d = 1.6 - k * 0.32;
    const c = P(i, s, d / 2);
    const h = rise * (k + 1);
    b.box('stepStone', [c[0], base + h / 2 - 0.05, c[1]], [W + 0.6 - k * 0.2, h + 0.1, d], yaw);
  }
  // Cam saçak (paslanmaz taşıyıcı)
  const cc = P(i, s, 0.75);
  b.box('canopyFrame', [cc[0], yG + 2.75, cc[1]], [W + 0.4, 0.08, 1.5], yaw);
  b.box('canopyGlass', [cc[0], yG + 2.8, cc[1]], [W + 0.3, 0.02, 1.4], yaw);
  for (const side of [-1, 1]) {
    const pr = P(i, s + side * (W / 2), 0.7);
    b.box('canopyFrame', [pr[0], yG + 2.95, pr[1]], [0.04, 0.35, 1.4], yaw);
  }
  // Blok adı levhası ve aplikler
  if (signKey) {
    const ps = P(i, s, 0.03);
    b.wall(signKey, P(i, s - 0.45, 0.03), P(i, s + 0.45, 0.03), yG + 3.0, yG + 3.34);
    void ps;
  }
  for (const side of [-1, 1]) {
    const pl = P(i, s + side * 1.25, 0.08);
    b.box('wallLamp', [pl[0], yG + 2.2, pl[1]], [0.14, 0.24, 0.1], yaw);
  }
  // Zil paneli
  const pz = P(i, s + 1.05, 0.02);
  b.box('bellPanel', [pz[0], yG + 1.35, pz[1]], [0.16, 0.34, 0.03], yaw);
}

function buildBalcony(
  b: Builder,
  bl: Balcony,
  floors: number,
  yF: (k: number) => number,
  FH: number,
  rnd: () => number,
): void {
  const seg = (p: V2, q: V2) => ({
    L: Math.hypot(q[0] - p[0], q[1] - p[1]),
    m: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as V2,
    yaw: Math.atan2(-(q[1] - p[1]), q[0] - p[0]),
  });
  // Döşeme ortası (spot için)
  let cx = 0;
  let cz = 0;
  for (const p of bl.slab) {
    cx += p[0];
    cz += p[1];
  }
  cx /= bl.slab.length;
  cz /= bl.slab.length;
  for (let k = 0; k <= floors; k++) {
    const ys = k === floors ? yF(k) + 0.05 : yF(k);
    b.polygon('slabTop', bl.slab, ys + 0.02, true, 0.5);
    b.polygon('slabBottom', bl.slab, ys - SLAB_T, false, 0.5);
    // Alın bandı
    for (let j = 0; j + 1 < bl.rail.length; j++)
      b.wall('fascia', bl.rail[j], bl.rail[j + 1], ys - FASCIA_H + 0.02, ys + 0.03);
    // Tavan spotu (bir alttaki balkonun tavanı = bu döşemenin altı)
    if (k > 0) {
      const g = new THREE.CircleGeometry(0.07, 10)
        .rotateX(Math.PI / 2)
        .translate(cx, ys - SLAB_T - 0.005, cz);
      b.geometry('downlight', g);
    }
    if (k === floors) continue;
    const yTop = yF(k + 1) - SLAB_T - 0.01;
    if (bl.enclosed[k]) {
      for (let j = 0; j + 1 < bl.rail.length; j++) {
        const s = seg(bl.rail[j], bl.rail[j + 1]);
        b.wall('glazing', bl.rail[j], bl.rail[j + 1], ys + 0.03, yTop, [0, 0, Math.max(1, s.L / 0.75), 1]);
        // Alt dolu panel (alüminyum)
        b.wall('fascia', bl.rail[j], bl.rail[j + 1], ys + 0.03, ys + 0.12);
      }
    } else {
      for (let j = 0; j + 1 < bl.rail.length; j++) {
        const p = bl.rail[j];
        const q = bl.rail[j + 1];
        const s = seg(p, q);
        b.wall('glass', p, q, ys + 0.1, ys + 0.98);
        b.box('rail', [s.m[0], ys + 1.0, s.m[1]], [s.L, 0.045, 0.05], s.yaw);
        b.box('rail', [s.m[0], ys + 0.09, s.m[1]], [s.L, 0.03, 0.03], s.yaw);
        const np = Math.max(1, Math.round(s.L / 1.2));
        for (let u = 0; u <= np; u++) {
          const f = u / np;
          b.box(
            'rail',
            [p[0] + (q[0] - p[0]) * f, ys + 0.55, p[1] + (q[1] - p[1]) * f],
            [0.04, 0.92, 0.04],
            s.yaw,
          );
        }
      }
      // Çanak anten (Türksat 42°D → güney-güneydoğuya, ~40° yukarı)
      if (bl.dish[k]) {
        const q = bl.rail[Math.min(1, bl.rail.length - 1)];
        const dish = new THREE.SphereGeometry(0.38, 12, 4, 0, Math.PI * 2, 0, 0.55);
        dish.scale(1, 0.45, 1);
        dish.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, DISH_POLE));
        dish.translate(q[0] - bl.wallN[0] * 0.25, ys + 1.25, q[1] - bl.wallN[1] * 0.25);
        b.geometry('dish', dish);
        b.box('rail', [q[0] - bl.wallN[0] * 0.2, ys + 1.05, q[1] - bl.wallN[1] * 0.2], [0.04, 0.35, 0.04]);
      }
    }
    // Klima dış ünitesi (balkon zemininde, duvar dibinde)
    if (bl.ac[k]) {
      const w = bl.wallPt;
      const n = bl.wallN;
      const yaw = Math.atan2(n[0], n[1]);
      const off = 0.35 + rnd() * 0.3;
      const c: V3 = [w[0] + n[0] * 0.2 - n[1] * off, ys + 0.3, w[1] + n[1] * 0.2 + n[0] * off];
      b.box('ac', c, [0.78, 0.55, 0.27], yaw, 1, 0b111110);
      b.box(
        'acFront',
        [c[0] + n[0] * 0.136, c[1], c[2] + n[1] * 0.136],
        [0.78, 0.55, 0.001],
        yaw,
        1,
        0b000001,
      );
    }
  }
  void FH;
}

/** Kırma kiremit çatı + güneye bakan yüzde güneş enerjili su ısıtıcıları */
function buildRoof(b: Builder, r: V2[], top: number, rnd: () => number): number {
  const bx = obb(r);
  const ax = bx.ax;
  const nx: V2 = [-ax[1], ax[0]];
  const W = bx.w / 2 + 0.45;
  const D = bx.d / 2 + 0.45;
  const C = (u: number, v: number): V2 => [bx.c[0] + ax[0] * u + nx[0] * v, bx.c[1] + ax[1] * u + nx[1] * v];
  const yr = top + 0.4;
  const rise = Math.min(W, D) * 0.5;
  const p00 = C(-W, -D);
  const p10 = C(W, -D);
  const p11 = C(W, D);
  const p01 = C(-W, D);
  b.polygon('eaveBottom', [p00, p10, p11, p01], yr - 0.02, false, 0.5);
  const long = W >= D;
  const hr = long ? W - D : D - W;
  const r0 = long ? C(-hr, 0) : C(0, -hr);
  const r1 = long ? C(hr, 0) : C(0, hr);
  const ry = yr + rise;
  const V = (p: V2, y: number): V3 => [p[0], y, p[1]];
  const faces: [V2, V2, V2, V2][] = long
    ? [
        [p00, p10, r1, r0],
        [p11, p01, r0, r1],
      ]
    : [
        [p10, p11, r1, r0],
        [p01, p00, r0, r1],
      ];
  for (const [q0, q1, q2, q3] of faces) {
    b.quad('roof', V(q0, yr), V(q1, yr), V(q2, ry), V(q3, ry), [
      0,
      0,
      Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / 2,
      rise / 1.5,
    ]);
  }
  const tri: [V2, V2, V2][] = long
    ? [
        [p10, p11, r1],
        [p01, p00, r0],
      ]
    : [
        [p11, p01, r1],
        [p00, p10, r0],
      ];
  for (const [q0, q1, q2] of tri)
    b.quad('roof', V(q0, yr), V(q1, yr), V(q2, ry), V(q2, ry), [0, 0, 2, rise / 1.5]);
  // Mahya kiremitleri
  const rl = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
  if (rl > 0.1)
    b.box(
      'ridge',
      [(r0[0] + r1[0]) / 2, ry + 0.04, (r0[1] + r1[1]) / 2],
      [rl + 0.2, 0.1, 0.22],
      Math.atan2(-(r1[1] - r0[1]), r1[0] - r0[0]),
    );
  for (const [q0, q1] of [
    [p00, p10],
    [p10, p11],
    [p11, p01],
    [p01, p00],
  ] as [V2, V2][])
    b.wall('eave', q1, q0, yr - 0.22, yr + 0.02);
  // Güneye (+z) en çok bakan uzun yüz
  const cand = faces.map(([q0, q1, q2, q3]) => {
    const e = [q1[0] - q0[0], q1[1] - q0[1]];
    const m = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2];
    const rm = [(q2[0] + q3[0]) / 2, (q2[1] + q3[1]) / 2];
    // Aşağı eğim yönü (sırttan saçağa)
    const dx = m[0] - rm[0];
    const dz = m[1] - rm[1];
    const l = Math.hypot(dx, dz) || 1;
    return { q0, q1, e, m, rm, south: dz / l, run: l };
  });
  const f = cand.reduce((p, q) => (q.south > p.south ? q : p));
  if (f.south > 0.3) {
    const el = Math.hypot(f.e[0], f.e[1]);
    const ex = f.e[0] / el;
    const ez = f.e[1] / el;
    // Aşağı eğim (yatay birim) ve eğime dik yatay yön
    const dx = (f.m[0] - f.rm[0]) / f.run;
    const dz = (f.m[1] - f.rm[1]) / f.run;
    const tx = dz;
    const tz = -dx;
    const tanA = rise / f.run;
    const th = Math.max(Math.atan(tanA), 0.7); // panel ~40°
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const n = Math.min(8, Math.floor((el - 4) / 1.3));
    const yawT = Math.atan2(-tz, tx);
    const mx = (f.q0[0] + f.q1[0]) / 2;
    const mz = (f.q0[1] + f.q1[1]) / 2;
    for (let k = 0; k < n; k++) {
      if (rnd() < 0.2) continue;
      const u = (k - (n - 1) / 2) * 1.3;
      const dC = f.run * 0.45; // saçaktan yatay uzaklık
      const cx = mx + ex * u - dx * dC;
      const cz = mz + ez * u - dz * dC;
      const yLow = yr + (dC - ct) * tanA + 0.12;
      const cy = yLow + st;
      const Q = (a: number, s2: number): V3 => [
        cx + tx * a + dx * ct * s2,
        cy - st * s2,
        cz + tz * a + dz * ct * s2,
      ];
      // s2 = +1 alt kenar (saçak tarafı), −1 üst kenar
      b.quad('solar', Q(-0.5, 1), Q(0.5, 1), Q(0.5, -1), Q(-0.5, -1));
      b.quad('solarBack', Q(0.5, 1), Q(-0.5, 1), Q(-0.5, -1), Q(0.5, -1));
      // Depo: üst kenarda yatay silindir
      const ux = cx - dx * (ct + 0.28);
      const uz = cz - dz * (ct + 0.28);
      const uy = cy + st + 0.2;
      const tank = new THREE.CylinderGeometry(0.24, 0.24, 1.35, 12);
      tank.rotateZ(Math.PI / 2);
      tank.rotateY(yawT);
      tank.translate(ux, uy, uz);
      b.geometry('tank', tank);
      // Ayaklar: üst kenardan çatıya
      const roofUp = yr + (dC + ct) * tanA;
      const legH = Math.max(0.1, cy + st - roofUp);
      for (const a of [-0.45, 0.45]) {
        const lx = cx - dx * ct + tx * a;
        const lz = cz - dz * ct + tz * a;
        b.box('tankLeg', [lx, roofUp + legH / 2, lz], [0.04, legH, 0.04], yawT);
      }
    }
  }
  return ry;
}
