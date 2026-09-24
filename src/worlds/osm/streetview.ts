import * as THREE from 'three';

/** scripts/bake-streetview.mjs çıktıları */
interface FacadeWall {
  b: number;
  a: [number, number];
  e: [number, number];
  y0: number;
  y1: number;
  rect: [number, number, number, number];
  cover: number;
  n: [number, number];
}

interface FacadeBake {
  slug: string;
  atlas: [number, number];
  walls: FacadeWall[];
}

interface FenceSeg {
  a: [number, number];
  e: [number, number];
  y0: number;
  n: [number, number];
}

/** Street View'dan bake edilmiş pilot alanlar (public/streetview/<slug>/) */
export const STREETVIEW_SLUGS = ['mertkent-2-etap'];

const MIN_COVER = 0.5;
const LIFT = 0.05; // prosedürel duvarın hemen önünde (z-fighting yok)
// Site çiti: bordür + yeşil panel çit önünde sık çalı (Street View karesinden kesit, ~3.8 m × 1.5 m)
const CURB_H = 0.18;
const CURB_D = 0.25;
const HEDGE_H = 1.5;
const HEDGE_D = 0.8;
const HEDGE_TILE = 3.8;

type Collider = (ring: [number, number][], bottom: number, top: number) => void;

class QuadBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  /** a→b yatay kenar, y0..y1; n: istenen ön yüz normali (x, y, z). */
  quad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    n: [number, number, number],
    uv: [number, number, number, number, number, number, number, number],
  ): void {
    const o = this.pos.length / 3;
    this.pos.push(...p0, ...p1, ...p2, ...p3);
    for (let k = 0; k < 4; k++) this.nor.push(...n);
    this.uv.push(...uv);
    // (p0,p1,p2) CCW normali
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] > 0) this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    else this.idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Pilot alanın gerçek fotoğraf dokularını ekler:
 * - cepheler: bake edilmiş atlas, ilgili duvarların 5 cm önünde ince kabuk (fotoğraf + aynı binadan döşenmiş)
 * - site çitleri: bordür + fotoğraf dokulu çalı/panel çit kutusu (çarpışmalı)
 */
export async function loadStreetViewFacades(base: string, collide?: Collider): Promise<THREE.Group | null> {
  const group = new THREE.Group();
  group.name = 'streetview';
  const loader = new THREE.TextureLoader();
  for (const slug of STREETVIEW_SLUGS) {
    const dir = `${base}streetview/${slug}/`;
    const bake = await json<FacadeBake>(`${dir}facades.json`);
    if (bake) {
      const walls = bake.walls.filter((w) => w.cover >= MIN_COVER);
      const tex = await loader.loadAsync(`${dir}facades.jpg`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const [AW, AH] = bake.atlas;
      const q = new QuadBuilder();
      for (const w of walls) {
        const [nx, nz] = w.n;
        const ax = w.a[0] + nx * LIFT;
        const az = w.a[1] + nz * LIFT;
        const ex = w.e[0] + nx * LIFT;
        const ez = w.e[1] + nz * LIFT;
        const [rx, ry, rw, rh] = w.rect;
        const u0 = rx / AW;
        const u1 = (rx + rw) / AW;
        const vTop = 1 - ry / AH;
        const vBot = 1 - (ry + rh) / AH;
        q.quad(
          [ax, w.y0, az],
          [ex, w.y0, ez],
          [ex, w.y1, ez],
          [ax, w.y1, az],
          [nx, 0, nz],
          [u0, vBot, u1, vBot, u1, vTop, u0, vTop],
        );
      }
      const mesh = new THREE.Mesh(q.geometry(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      mesh.name = `streetview facades ${slug}`;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    const fences = await json<{ segs: FenceSeg[] }>(`${dir}fences.json`);
    if (fences?.segs.length) {
      const hedge = await loader.loadAsync(`${dir}hedge.jpg`);
      hedge.colorSpace = THREE.SRGBColorSpace;
      hedge.wrapS = THREE.MirroredRepeatWrapping;
      hedge.anisotropy = 8;
      const hq = new QuadBuilder();
      const cq = new QuadBuilder();
      let run = 0;
      for (const s of fences.segs) {
        // n: yola bakan yön; çalı kutusu çit hattından içeri (−n) doğru HEDGE_D derinlikte
        const [nx, nz] = s.n;
        const len = Math.hypot(s.e[0] - s.a[0], s.e[1] - s.a[1]);
        const u0 = run / HEDGE_TILE;
        const u1 = (run + len) / HEDGE_TILE;
        run += len;
        const y0 = s.y0 + 0.1;
        const yb = y0 + CURB_H;
        const yt = yb + HEDGE_H;
        const A = s.a;
        const E = s.e;
        const Ai: [number, number] = [A[0] - nx * HEDGE_D, A[1] - nz * HEDGE_D];
        const Ei: [number, number] = [E[0] - nx * HEDGE_D, E[1] - nz * HEDGE_D];
        const uv = (a: number, b: number, v0: number, v1: number) =>
          [a, v0, b, v0, b, v1, a, v1] as [number, number, number, number, number, number, number, number];
        // Yola bakan yüz, iç yüz, üst yüz (çalının tepesi: dokunun üst bandı)
        hq.quad(
          [A[0], yb, A[1]],
          [E[0], yb, E[1]],
          [E[0], yt, E[1]],
          [A[0], yt, A[1]],
          [nx, 0, nz],
          uv(u0, u1, 0, 1),
        );
        hq.quad(
          [Ai[0], yb, Ai[1]],
          [Ei[0], yb, Ei[1]],
          [Ei[0], yt, Ei[1]],
          [Ai[0], yt, Ai[1]],
          [-nx, 0, -nz],
          uv(u0, u1, 0.15, 1),
        );
        hq.quad(
          [A[0], yt, A[1]],
          [E[0], yt, E[1]],
          [Ei[0], yt, Ei[1]],
          [Ai[0], yt, Ai[1]],
          [0, 1, 0],
          uv(u0, u1, 0.75, 0.95),
        );
        // Bordür (taş): yola bakan yüz + üst
        const Ac: [number, number] = [A[0] + nx * CURB_D * 0.5, A[1] + nz * CURB_D * 0.5];
        const Ec: [number, number] = [E[0] + nx * CURB_D * 0.5, E[1] + nz * CURB_D * 0.5];
        cq.quad(
          [Ac[0], y0 - 0.2, Ac[1]],
          [Ec[0], y0 - 0.2, Ec[1]],
          [Ec[0], yb, Ec[1]],
          [Ac[0], yb, Ac[1]],
          [nx, 0, nz],
          uv(0, 1, 0, 1),
        );
        cq.quad(
          [Ac[0], yb, Ac[1]],
          [Ec[0], yb, Ec[1]],
          [E[0], yb, E[1]],
          [A[0], yb, A[1]],
          [0, 1, 0],
          uv(0, 1, 0, 1),
        );
        collide?.(
          [
            [Ac[0], Ac[1]],
            [Ec[0], Ec[1]],
            [Ei[0], Ei[1]],
            [Ai[0], Ai[1]],
          ],
          y0 - 1,
          yt,
        );
      }
      const hm = new THREE.Mesh(
        hq.geometry(),
        new THREE.MeshStandardMaterial({ map: hedge, roughness: 0.95 }),
      );
      hm.name = `streetview hedges ${slug}`;
      hm.castShadow = true;
      hm.receiveShadow = true;
      // Ölçüldü: bordür krem-taş (sRGB ≈ 214,196,160)
      const cm = new THREE.Mesh(
        cq.geometry(),
        new THREE.MeshStandardMaterial({ color: 0xd6c4a0, roughness: 0.85 }),
      );
      cm.name = `streetview curbs ${slug}`;
      cm.receiveShadow = true;
      group.add(hm, cm);
    }
  }
  return group.children.length ? group : null;
}
