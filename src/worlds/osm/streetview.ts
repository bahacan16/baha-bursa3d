import * as THREE from 'three';

/** scripts/bake-streetview.mjs çıktısı */
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

/** Street View'dan bake edilmiş pilot alanlar (public/streetview/<slug>/) */
export const STREETVIEW_SLUGS = ['mertkent-2-etap'];

const MIN_COVER = 0.5;
const LIFT = 0.05; // prosedürel duvarın hemen önünde (z-fighting yok)

/**
 * Bake edilmiş gerçek fotoğraf cephelerini, ilgili duvarların birkaç cm önüne ince bir kabuk olarak ekler.
 * KARAR: yalnızca yeterince kaplanmış (ve gökyüzü testini geçmiş) duvarlar; diğerleri prosedürel kalır.
 */
export async function loadStreetViewFacades(base: string): Promise<THREE.Group | null> {
  const group = new THREE.Group();
  group.name = 'streetview-facades';
  const loader = new THREE.TextureLoader();
  for (const slug of STREETVIEW_SLUGS) {
    let bake: FacadeBake;
    try {
      const r = await fetch(`${base}streetview/${slug}/facades.json`);
      if (!r.ok) continue;
      bake = (await r.json()) as FacadeBake;
    } catch {
      continue;
    }
    const walls = bake.walls.filter((w) => w.cover >= MIN_COVER);
    if (!walls.length) continue;
    const tex = await loader.loadAsync(`${base}streetview/${slug}/facades.jpg`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const [AW, AH] = bake.atlas;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
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
      const o = pos.length / 3;
      pos.push(ax, w.y0, az, ex, w.y0, ez, ex, w.y1, ez, ax, w.y1, az);
      for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
      uv.push(u0, vBot, u1, vBot, u1, vTop, u0, vTop);
      // (a0,e0,e1) üçgeninin CCW normali (−tz, 0, tx); dış normalle aynı yöndeyse bu sıra ön yüzdür
      const tx = ex - ax;
      const tz = ez - az;
      if (-tz * nx + tx * nz > 0) idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      else idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `streetview ${slug}`;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group.children.length ? group : null;
}
