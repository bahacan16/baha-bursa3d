import * as THREE from 'three';
import type { Builder, V2, V3 } from './builder';

/**
 * Mertkent 2 site içi donatıları — kullanıcının site içinden çektiği fotoğraflara göre (streetview-src/user/site-*.jpg):
 * kamelya (somon kare dikmeler, kahve oluklu saçak, kiremit-kahve shingle kırma çatı, ferforje korkuluk, iç banklar),
 * oyun grubu (yeşil çatılı kule, mavi spiral + kırmızı düz kaydırak, sarı salıncak, tahterevalli), yeşil panel çit,
 * çift küreli bahçe lambası, sarı ayaklı mavi çöp kovası, gül, konik servi, halı saha çiti.
 */

type Collide = (ring: [number, number][], bottom: number, top: number) => void;

/** Yerel çerçeve: c merkez, yaw (u ekseni dünya yönü: (cos, −sin)) */
function frame(c: V3, yaw: number) {
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const P = (u: number, y: number, v: number): V3 => [
    c[0] + u * co + v * si,
    c[1] + y,
    c[2] - u * si + v * co,
  ];
  const P2 = (u: number, v: number): V2 => [c[0] + u * co + v * si, c[2] - u * si + v * co];
  return { P, P2 };
}

function rectRing(P2: (u: number, v: number) => V2, hu: number, hv: number): [number, number][] {
  return [P2(-hu, -hv), P2(hu, -hv), P2(hu, hv), P2(-hu, hv)] as [number, number][];
}

/**
 * Kamelya: L (u, uzun) × W (v) m, ön yüz +v. Girişler ön ve arka ortada (fotoğraf: içinden oyun parkı görünüyor).
 */
export function kamelya(b: Builder, c: V3, L: number, W: number, yaw: number, collide?: Collide): void {
  const { P, P2 } = frame(c, yaw);
  const H = 2.35;
  const hu = L / 2;
  const hv = W / 2;
  // Beton döşeme
  const slab = new THREE.BoxGeometry(L + 0.3, 0.12, W + 0.3);
  slab.rotateY(yaw);
  slab.translate(c[0], c[1] + 0.06, c[2]);
  b.geometry('kamSlab', slab);
  // Dikmeler: uzun kenarda 4, kısa kenarda 3
  const nU = 4;
  const nV = 3;
  const posts: V2[] = [];
  for (let i = 0; i < nU; i++) {
    const u = -hu + (L * i) / (nU - 1);
    posts.push([u, -hv], [u, hv]);
  }
  for (let j = 1; j < nV - 1; j++) {
    const v = -hv + (W * j) / (nV - 1);
    posts.push([-hu, v], [hu, v]);
  }
  for (const [u, v] of posts) b.box('kamPost', P(u, 0.12 + H / 2, v), [0.16, H, 0.16], yaw);
  // Kiriş + oluklu (dalgalı) ahşap saçak bandı
  const fasciaY = 0.12 + H + 0.14;
  for (const s of [-1, 1]) {
    b.box('kamWood', P(0, fasciaY, s * (hv + 0.32)), [L + 0.76, 0.3, 0.05], yaw);
    b.box('kamWood', P(s * (hu + 0.32), fasciaY, 0), [0.05, 0.3, W + 0.76], yaw);
    // Dalga dişleri (alt kenarda yarım daireler)
    const nT = Math.round((L + 0.6) / 0.28);
    for (let k = 0; k < nT; k++) {
      const u = -hu - 0.3 + (k + 0.5) * ((L + 0.6) / nT);
      b.box('kamWood', P(u, fasciaY - 0.19, s * (hv + 0.32)), [0.16, 0.08, 0.05], yaw);
    }
    const nS = Math.round((W + 0.6) / 0.28);
    for (let k = 0; k < nS; k++) {
      const v = -hv - 0.3 + (k + 0.5) * ((W + 0.6) / nS);
      b.box('kamWood', P(s * (hu + 0.32), fasciaY - 0.19, v), [0.05, 0.08, 0.16], yaw);
    }
    b.box('kamWood', P(0, 0.12 + H - 0.06, s * hv), [L + 0.16, 0.14, 0.12], yaw);
    b.box('kamWood', P(s * hu, 0.12 + H - 0.06, 0), [0.12, 0.14, W + 0.16], yaw);
  }
  // İç tavan kirişleri
  for (let k = 1; k < 6; k++) b.box('kamWood', P(-hu + (L * k) / 6, 0.12 + H + 0.05, 0), [0.06, 0.1, W], yaw);
  // Kırma çatı (alçak eğim, 0.35 m saçak)
  const ro = 0.35;
  const y0 = fasciaY + 0.15;
  const rise = Math.min(1.1, W * 0.22);
  const A = P(-hu - ro, y0, -hv - ro);
  const B = P(hu + ro, y0, -hv - ro);
  const C = P(hu + ro, y0, hv + ro);
  const D = P(-hu - ro, y0, hv + ro);
  const r1 = P(-(hu - hv * 0.6), y0 + rise, 0);
  const r2 = P(hu - hv * 0.6, y0 + rise, 0);
  const roof = new THREE.BufferGeometry();
  const tri = (a: V3, b2: V3, c2: V3) => [...a, ...b2, ...c2];
  const pos = [
    ...tri(A, r1, r2),
    ...tri(A, r2, B),
    ...tri(B, r2, C),
    ...tri(C, r2, r1),
    ...tri(C, r1, D),
    ...tri(D, r1, A),
  ];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] * 1.2, pos[i + 2] * 1.2 + pos[i + 1] * 1.4);
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roof.computeVertexNormals();
  // Aşağı bakan yüzler de görünsün (tavan)
  const under = roof.clone();
  under.translate(0, -0.04, 0);
  const idx = under.getAttribute('position');
  for (let i = 0; i < idx.count; i += 3) {
    const x = idx.getX(i + 1);
    const y = idx.getY(i + 1);
    const z = idx.getZ(i + 1);
    idx.setXYZ(i + 1, idx.getX(i + 2), idx.getY(i + 2), idx.getZ(i + 2));
    idx.setXYZ(i + 2, x, y, z);
  }
  under.computeVertexNormals();
  b.geometry('kamRoof', roof);
  b.geometry('kamWood', under);
  // Ferforje korkuluk (0.25–0.85 m): ön/arka ortadaki açıklık hariç, çerçeve + kıvrımlı dolgu paneli
  const railSeg = (u0: number, v0: number, u1: number, v1: number) => {
    const a = P2(u0, v0);
    const e = P2(u1, v1);
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (len < 0.2) return;
    const m = P((u0 + u1) / 2, 0, (v0 + v1) / 2);
    const ry = yaw + (Math.abs(u1 - u0) > Math.abs(v1 - v0) ? 0 : Math.PI / 2);
    b.box('darkMetal', [m[0], c[1] + 0.95, m[2]], [len, 0.05, 0.05], ry);
    b.box('darkMetal', [m[0], c[1] + 0.3, m[2]], [len, 0.05, 0.05], ry);
    b.wall('ironScroll', a, e, c[1] + 0.32, c[1] + 0.93, [0, 0, Math.max(1, Math.round(len / 1.1)), 1]);
    b.wall('ironScroll', e, a, c[1] + 0.32, c[1] + 0.93, [0, 0, Math.max(1, Math.round(len / 1.1)), 1]);
    // İç bank (korkuluğa yaslı, içe bakan)
    const nIn: V2 = [-(v0 + v1) / 2, -(u0 + u1) / 2];
    const inU = Math.abs(u1 - u0) > Math.abs(v1 - v0) ? 0 : Math.sign(nIn[1] || 1) * 0.3;
    const inV = Math.abs(u1 - u0) > Math.abs(v1 - v0) ? Math.sign(nIn[0] || 1) * 0.3 : 0;
    const sm = P((u0 + u1) / 2 + inU, 0.45, (v0 + v1) / 2 + inV);
    b.box(
      'kamWood',
      sm,
      [Math.abs(u1 - u0) > 0.1 ? len - 0.2 : 0.36, 0.05, Math.abs(u1 - u0) > 0.1 ? 0.36 : len - 0.2],
      yaw,
    );
    const bk = P((u0 + u1) / 2 + inU * 0.3, 0.72, (v0 + v1) / 2 + inV * 0.3);
    b.box(
      'kamWood',
      bk,
      [Math.abs(u1 - u0) > 0.1 ? len - 0.2 : 0.04, 0.28, Math.abs(u1 - u0) > 0.1 ? 0.04 : len - 0.2],
      yaw,
    );
  };
  const gap = 0.55;
  for (const s of [-1, 1]) {
    railSeg(-hu, s * hv, -gap, s * hv);
    railSeg(gap, s * hv, hu, s * hv);
    railSeg(s * hu, -hv, s * hu, hv);
  }
  // Piknik masası (ortada) + küllük
  b.box('kamWood', P(0.6, 0.76, 0), [1.8, 0.05, 0.75], yaw);
  for (const s of [-1, 1]) {
    b.box('kamWood', P(0.6, 0.45, s * 0.62), [1.8, 0.04, 0.28], yaw);
    for (const t of [-0.7, 0.7]) b.box('darkMetal', P(0.6 + t, 0.4, s * 0.25), [0.05, 0.75, 0.05], yaw);
  }
  b.cylinder('steel', P(-1.2, 0.12, 0.4), 0.13, 0.65, 10);
  collide?.(rectRing(P2, 0.12, 0.12), c[1] - 0.5, c[1] + 2.4);
  for (const [u, v] of posts)
    collide?.(
      rectRing((a, e) => P2(u + a, v + e), 0.1, 0.1),
      c[1] - 0.5,
      c[1] + 2.4,
    );
}

/** Yeşil 3B panel çit (fotoğraf: oyun parkı çevresi, ~1.0 m); pts açık çizgi */
export function panelFence(
  b: Builder,
  pts: V2[],
  y: (x: number, z: number) => number,
  h = 1.0,
  collide?: Collide,
): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const e = pts[i + 1];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    if (L < 0.1) continue;
    const yy = Math.min(y(a[0], a[1]), y(e[0], e[1]));
    b.wall('mkMesh', a, e, yy, yy + h, [0, 0, L / 0.2, h / 0.2]);
    const n = Math.max(1, Math.round(L / 2.5));
    const yaw = Math.atan2(-(e[1] - a[1]), e[0] - a[0]);
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      b.box(
        'mkMeshPost',
        [a[0] + (e[0] - a[0]) * f, yy + (h + 0.1) / 2, a[1] + (e[1] - a[1]) * f],
        [0.06, h + 0.1, 0.04],
        yaw,
      );
    }
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const nn: V2 = [-t[1] * 0.05, t[0] * 0.05];
    collide?.(
      [
        [a[0] + nn[0], a[1] + nn[1]],
        [e[0] + nn[0], e[1] + nn[1]],
        [e[0] - nn[0], e[1] - nn[1]],
        [a[0] - nn[0], a[1] - nn[1]],
      ],
      yy - 0.5,
      yy + h,
    );
  }
}

/** Oyun grubu: kule (yeşil çatı), mavi spiral + kırmızı düz kaydırak, salıncak, tahterevalli. u ekseni yaw. */
export function playSet(b: Builder, c: V3, yaw: number, collide?: Collide): void {
  const { P, P2 } = frame(c, yaw);
  // Kule: 1.3 × 1.3 m, platform 1.1 m
  for (const [u, v] of [
    [-0.65, -0.65],
    [0.65, -0.65],
    [-0.65, 0.65],
    [0.65, 0.65],
  ])
    b.box('playBeige', P(u, 1.35, v), [0.12, 2.7, 0.12], yaw);
  b.box('playBeige', P(0, 1.1, 0), [1.35, 0.08, 1.35], yaw);
  // Yeşil çatı (kırma, dört yüz)
  const roof = new THREE.ConeGeometry(1.15, 0.75, 4, 1);
  roof.rotateY(Math.PI / 4 + yaw);
  roof.translate(...P(0, 3.05, 0));
  b.geometry('playGreen', roof);
  // Mavi kemerli panel (ön) + sarı tırmanma korkuluğu (arka)
  b.box('spPlayBlue', P(0, 1.75, 0.66), [1.1, 1.1, 0.06], yaw);
  b.box('spPlayYellow', P(0, 1.55, -0.66), [1.1, 0.7, 0.05], yaw);
  // Kırmızı düz kaydırak (+v yönünde)
  const sl = new THREE.BoxGeometry(0.55, 0.06, 2.5);
  sl.rotateX(0.44);
  sl.rotateY(yaw);
  sl.translate(...P(0.3, 0.6, 1.8));
  b.geometry('playRed', sl);
  for (const s of [-1, 1]) {
    const w = new THREE.BoxGeometry(0.05, 0.22, 2.5);
    w.rotateX(0.44);
    w.rotateY(yaw);
    w.translate(...P(0.3 + s * 0.28, 0.7, 1.8));
    b.geometry('playRed', w);
  }
  // Mavi spiral kaydırak (−u yönünde, 1 tur)
  const steps = 16;
  for (let k = 0; k < steps; k++) {
    const t = k / steps;
    const a = t * Math.PI * 1.6;
    const R = 0.85;
    const cu = -1.5 + Math.cos(a) * R;
    const cv = Math.sin(a) * R;
    const seg = new THREE.BoxGeometry(0.55, 0.22, 0.42);
    seg.rotateY(-a + yaw);
    seg.translate(...P(cu, 1.1 - t * 0.9, cv));
    b.geometry('spPlayBlue', seg);
  }
  b.box('playBeige', P(-1.5, 0.55, 0), [0.1, 1.1, 0.1], yaw);
  // Salıncak (kuleden +u yönünde): sarı üst kiriş 3 m, bej A ayaklar, 2 yeşil oturak
  const su = 2.9;
  b.box('spPlayYellow', P(su, 2.25, 0), [0.1, 0.1, 3.0], yaw);
  for (const s of [-1, 1])
    for (const d of [-0.35, 0.35]) {
      const leg = new THREE.BoxGeometry(0.09, 2.35, 0.09);
      leg.rotateX(d > 0 ? 0.15 : -0.15);
      leg.rotateY(yaw);
      leg.translate(...P(su + d, 1.12, s * 1.5));
      b.geometry('playBeige', leg);
    }
  for (const s of [-0.65, 0.65]) {
    for (const d of [-0.18, 0.18]) b.box('steel', P(su + d, 1.37, s), [0.015, 1.75, 0.015], yaw);
    b.box('playGreen', P(su, 0.48, s), [0.45, 0.07, 0.3], yaw);
  }
  // Tahterevalli (kulenin önünde, −v)
  const tv = -2.6;
  b.box('playBeige', P(0.6, 0.25, tv), [0.2, 0.5, 0.35], yaw);
  b.box('spPlayYellow', P(0.6, 0.52, tv), [2.6, 0.08, 0.08], yaw);
  for (const s of [-1, 1]) {
    b.box('playPink', P(0.6 + s * 1.15, 0.6, tv), [0.3, 0.06, 0.28], yaw);
    b.box('playRed', P(0.6 + s * 1.2, 0.18, tv), [0.14, 0.36, 0.14], yaw);
  }
  collide?.(rectRing(P2, 0.75, 0.75), c[1] - 0.5, c[1] + 3);
}

/** Çift küreli bahçe lambası (siyah döküm direk, iki kıvrık kol, şeffaf küre) */
export function lamp2(b: Builder, c: V3, yaw = 0): void {
  const { P } = frame(c, yaw);
  b.cylinder('darkMetal', P(0, 0, 0), 0.11, 0.45, 10);
  b.cylinder('steel', P(0, 0.45, 0), 0.05, 2.35, 8);
  b.cylinder('darkMetal', P(0, 2.8, 0), 0.07, 0.25, 8);
  for (const s of [-1, 1]) {
    b.box('darkMetal', P(s * 0.22, 3.1, 0), [0.44, 0.035, 0.035], yaw);
    b.box('darkMetal', P(s * 0.44, 3.02, 0), [0.03, 0.18, 0.03], yaw);
    const g = new THREE.SphereGeometry(0.17, 12, 8);
    g.translate(...P(s * 0.44, 2.84, 0));
    b.geometry('gardenGlobe', g);
  }
  const top = new THREE.SphereGeometry(0.07, 8, 6);
  top.translate(...P(0, 3.15, 0));
  b.geometry('darkMetal', top);
}

/** Sarı ayaklı mavi çöp kovası ("MERTKENT SİTESİ") */
export function binStand(b: Builder, c: V3, yaw = 0): void {
  const { P } = frame(c, yaw);
  for (const s of [-1, 1]) b.box('spPlayYellow', P(s * 0.3, 0.55, 0), [0.05, 1.1, 0.05], yaw);
  b.box('spPlayYellow', P(0, 0.2, 0), [0.6, 0.04, 0.04], yaw);
  const g = new THREE.CylinderGeometry(0.24, 0.22, 0.55, 14, 1, true);
  g.translate(...P(0, 0.72, 0));
  b.geometry('binBlue', g);
}

/** Gül fidanı: yapraklı top + kırmızı/pembe çiçek noktaları */
export function roseBush(b: Builder, c: V3, seed: number): void {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const h = 0.8 + r() * 0.5;
  const g = new THREE.SphereGeometry(0.38, 8, 6);
  g.scale(1, h / 0.76, 1);
  g.translate(c[0], c[1] + h / 2, c[2]);
  b.geometry('boxwood', g);
  const key = r() < 0.5 ? 'roseRed' : 'rosePink';
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2;
    const f = new THREE.SphereGeometry(0.055, 6, 4);
    f.translate(c[0] + Math.cos(a) * 0.33, c[1] + h * (0.45 + r() * 0.55), c[2] + Math.sin(a) * 0.33);
    b.geometry(key, f);
  }
}

/** Konik servi / leylandi (sarımsı yeşil, kullanıcı fotoğrafları): taban yarıçapı r, boy h */
export function cypressCone(b: Builder, c: V3, r: number, h: number): void {
  const g = new THREE.ConeGeometry(r, h * 0.92, 10, 3);
  g.translate(c[0], c[1] + h * 0.46 + 0.08, c[2]);
  b.geometry('cypress', g);
  b.cylinder('wood', c, 0.06, 0.25, 6);
}

/** Halı saha çiti: kapalı çokgen, yeşil tel 4 m, üst/alt boru, kapı açıklığı (merkez, genişlik) */
export function pitchFence(
  b: Builder,
  ring: V2[],
  y: (x: number, z: number) => number,
  gate?: { c: V2; w: number },
  collide?: Collide,
): void {
  const h = 4;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const e = ring[(i + 1) % ring.length];
    const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
    const t: V2 = [(e[0] - a[0]) / L, (e[1] - a[1]) / L];
    const parts: [number, number][] = [[0, L]];
    if (gate) {
      const gu = (gate.c[0] - a[0]) * t[0] + (gate.c[1] - a[1]) * t[1];
      const off = Math.abs((gate.c[0] - a[0]) * t[1] - (gate.c[1] - a[1]) * t[0]);
      if (off < 0.6 && gu > 0 && gu < L) {
        parts.length = 0;
        parts.push([0, gu - gate.w / 2], [gu + gate.w / 2, L]);
      }
    }
    for (const [u0, u1] of parts) {
      if (u1 - u0 < 0.1) continue;
      const p: V2 = [a[0] + t[0] * u0, a[1] + t[1] * u0];
      const q: V2 = [a[0] + t[0] * u1, a[1] + t[1] * u1];
      const yy = Math.min(y(p[0], p[1]), y(q[0], q[1]));
      b.wall('pitchMesh', p, q, yy, yy + h, [0, 0, (u1 - u0) / 0.2, h / 0.2]);
      const n = Math.max(1, Math.round((u1 - u0) / 3));
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        b.cylinder('mkMeshPost', [p[0] + (q[0] - p[0]) * f, yy, p[1] + (q[1] - p[1]) * f], 0.04, h + 0.05, 6);
      }
      const nn: V2 = [-t[1] * 0.05, t[0] * 0.05];
      collide?.(
        [
          [p[0] + nn[0], p[1] + nn[1]],
          [q[0] + nn[0], q[1] + nn[1]],
          [q[0] - nn[0], q[1] - nn[1]],
          [p[0] - nn[0], p[1] - nn[1]],
        ],
        yy - 0.5,
        yy + h,
      );
    }
  }
}

/** Kale (beyaz boru): ağız ortası c, sahaya bakış yönü yaw (u = ağız boyunca) */
export function goal(b: Builder, c: V3, yaw: number): void {
  const { P } = frame(c, yaw);
  for (const s of [-1, 1]) b.box('coping', P(s * 1.5, 1.0, 0), [0.08, 2.0, 0.08], yaw);
  b.box('coping', P(0, 2.0, 0), [3.08, 0.08, 0.08], yaw);
  for (const s of [-1, 1]) b.box('coping', P(s * 1.5, 0.5, -0.8), [0.05, 0.05, 1.6], yaw);
  b.wall('mkMesh', P2of(P, -1.5, -0.8), P2of(P, 1.5, -0.8), c[1], c[1] + 2, [0, 0, 15, 10]);
}

function P2of(P: (u: number, y: number, v: number) => V3, u: number, v: number): V2 {
  const p = P(u, 0, v);
  return [p[0], p[2]];
}
