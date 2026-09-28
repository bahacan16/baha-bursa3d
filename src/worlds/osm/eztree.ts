import * as THREE from 'three';
import { nightUniform } from '../../env/night';

/**
 * Prosedürel dallı ağaç üreteci — ez-tree (Daniel Greenheck, MIT, github.com/dgreenheck/ez-tree) algoritmasının
 * sadeleştirilmiş TypeScript uyarlaması. Yalnızca geometri üretir; doku ve malzeme oyunda.
 * KARAR: paket yalnızca kök modülü dışa açıyor ve içe aktarılınca 20 dokuyu birden yüklüyor → üreteç buraya taşındı,
 * gereken yaprak/kabuk dokuları public/textures/trees/ altına kopyalandı.
 */
export interface EzTreeOptions {
  seed: number;
  type: 'deciduous' | 'evergreen';
  levels: number;
  /** Seviye başına (0 = gövde) */
  angle: number[];
  children: number[];
  force: number;
  gnarliness: number[];
  length: number[];
  radius: number[];
  sections: number[];
  segments: number[];
  start: number[];
  taper: number[];
  twist: number[];
  leaves: {
    angle: number;
    count: number;
    start: number;
    size: number;
    sizeVariance: number;
    double: boolean;
  };
}

class Rng {
  private w: number;
  private z: number;
  constructor(seed: number) {
    this.w = (123456789 + seed) & 0xffffffff;
    this.z = (987654321 - seed) & 0xffffffff;
  }
  random(max = 1, min = 0): number {
    this.z = (36969 * (this.z & 65535) + (this.z >> 16)) & 0xffffffff;
    this.w = (18000 * (this.w & 65535) + (this.w >> 16)) & 0xffffffff;
    const r = (((this.z << 16) + (this.w & 65535)) >>> 0) / 4294967296;
    return (max - min) * r + min;
  }
}

interface Branch {
  origin: THREE.Vector3;
  orientation: THREE.Euler;
  length: number;
  radius: number;
  level: number;
  sectionCount: number;
  segmentCount: number;
}

interface Section {
  origin: THREE.Vector3;
  orientation: THREE.Euler;
  radius: number;
}

export interface EzTreeGeometry {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

export function generateEzTree(o: EzTreeOptions): EzTreeGeometry {
  const rng = new Rng(o.seed);
  const bv: number[] = [];
  const bn: number[] = [];
  const buv: number[] = [];
  const bi: number[] = [];
  const lv: number[] = [];
  const luv: number[] = [];
  const li: number[] = [];
  const queue: Branch[] = [
    {
      origin: new THREE.Vector3(),
      orientation: new THREE.Euler(),
      length: o.length[0],
      radius: o.radius[0],
      level: 0,
      sectionCount: o.sections[0],
      segmentCount: o.segments[0],
    },
  ];
  const qForce = new THREE.Quaternion().setFromUnitVectors(UP, UP);

  const leaf = (origin: THREE.Vector3, orientation: THREE.Euler) => {
    const size = o.leaves.size * (1 + rng.random(o.leaves.sizeVariance, -o.leaves.sizeVariance));
    const quad = (rot: number) => {
      const i = lv.length / 3;
      const e = new THREE.Euler(0, rot, 0);
      for (const [x, y] of [
        [-size / 2, size],
        [-size / 2, 0],
        [size / 2, 0],
        [size / 2, size],
      ]) {
        const v = new THREE.Vector3(x, y, 0).applyEuler(e).applyEuler(orientation).add(origin);
        lv.push(v.x, v.y, v.z);
      }
      luv.push(0, 1, 0, 0, 1, 0, 1, 1);
      li.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    quad(0);
    if (o.leaves.double) quad(Math.PI / 2);
  };

  const pick = (sections: Section[], t: number) => {
    const idx = Math.floor(t * (sections.length - 1));
    const a = sections[idx];
    const b = idx === sections.length - 1 ? a : sections[idx + 1];
    const alpha = (t - idx / (sections.length - 1)) / (1 / (sections.length - 1));
    const origin = new THREE.Vector3().lerpVectors(a.origin, b.origin, alpha);
    const qa = new THREE.Quaternion().setFromEuler(a.orientation);
    const qb = new THREE.Quaternion().setFromEuler(b.orientation);
    const parent = new THREE.Euler().setFromQuaternion(qb.slerp(qa, alpha));
    return { a, b, alpha, origin, parent };
  };

  const orient = (parent: THREE.Euler, angleDeg: number, radial: number) => {
    const q1 = new THREE.Quaternion().setFromAxisAngle(X, (angleDeg * Math.PI) / 180);
    const q2 = new THREE.Quaternion().setFromAxisAngle(UP, radial);
    const q3 = new THREE.Quaternion().setFromEuler(parent);
    return new THREE.Euler().setFromQuaternion(q3.multiply(q2.multiply(q1)));
  };

  while (queue.length) {
    const br = queue.shift()!;
    const indexOffset = bv.length / 3;
    const ori = br.orientation.clone();
    const org = br.origin.clone();
    // Özgün kodda tür karşılaştırması büyük harfle ('Deciduous') olduğundan bölen hep 1; ön ayarlar buna göre
    const secLen = br.length / br.sectionCount;
    const sections: Section[] = [];
    for (let i = 0; i <= br.sectionCount; i++) {
      let r = br.radius;
      if (i === br.sectionCount && br.level === o.levels) r = 0.001;
      else if (o.type === 'deciduous') r *= 1 - o.taper[br.level] * (i / br.sectionCount);
      else r *= 1 - i / br.sectionCount;
      let first: THREE.Vector3 | null = null;
      let firstN: THREE.Vector3 | null = null;
      for (let j = 0; j < br.segmentCount; j++) {
        const a = (2 * Math.PI * j) / br.segmentCount;
        const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyEuler(ori).normalize();
        const v = n.clone().multiplyScalar(r).add(org);
        bv.push(v.x, v.y, v.z);
        bn.push(n.x, n.y, n.z);
        buv.push(j / br.segmentCount, i % 2 === 0 ? 0 : 1);
        if (j === 0) {
          first = v;
          firstN = n;
        }
      }
      bv.push(first!.x, first!.y, first!.z);
      bn.push(firstN!.x, firstN!.y, firstN!.z);
      buv.push(1, i % 2 === 0 ? 0 : 1);
      sections.push({ origin: org.clone(), orientation: ori.clone(), radius: r });
      org.add(new THREE.Vector3(0, secLen, 0).applyEuler(ori));
      const g = Math.max(1, 1 / Math.sqrt(Math.max(r, 1e-4))) * o.gnarliness[br.level];
      ori.x += rng.random(g, -g);
      ori.z += rng.random(g, -g);
      const qs = new THREE.Quaternion().setFromEuler(ori);
      qs.multiply(new THREE.Quaternion().setFromAxisAngle(UP, o.twist[br.level]));
      qs.rotateTowards(qForce, o.force / Math.max(r, 1e-4));
      ori.setFromQuaternion(qs);
    }
    const N = br.segmentCount + 1;
    for (let i = 0; i < br.sectionCount; i++)
      for (let j = 0; j < br.segmentCount; j++) {
        const v1 = indexOffset + i * N + j;
        const v2 = v1 + 1;
        bi.push(v1, v1 + N, v2, v2, v1 + N, v2 + N);
      }
    const last = sections[sections.length - 1];
    if (o.type === 'deciduous') {
      if (br.level < o.levels)
        queue.push({
          origin: last.origin,
          orientation: last.orientation,
          length: o.length[br.level + 1],
          radius: last.radius,
          level: br.level + 1,
          sectionCount: br.sectionCount,
          segmentCount: br.segmentCount,
        });
      else leaf(last.origin, last.orientation);
    }
    if (br.level === o.levels) {
      const off = rng.random();
      for (let i = 0; i < o.leaves.count; i++) {
        const s = pick(sections, rng.random(1, o.leaves.start));
        leaf(s.origin, orient(s.parent, o.leaves.angle, 2 * Math.PI * (off + i / o.leaves.count)));
      }
    } else if (br.level < o.levels) {
      const level = br.level + 1;
      const count = o.children[br.level];
      const off = rng.random();
      for (let i = 0; i < count; i++) {
        const t = rng.random(1, o.start[level]);
        const s = pick(sections, t);
        queue.push({
          origin: s.origin,
          orientation: orient(s.parent, o.angle[level], 2 * Math.PI * (off + i / count)),
          length: o.length[level] * (o.type === 'evergreen' ? 1 - t : 1),
          radius: o.radius[level] * ((1 - s.alpha) * s.a.radius + s.alpha * s.b.radius),
          level,
          sectionCount: o.sections[level],
          segmentCount: o.segments[level],
        });
      }
    }
  }

  const branches = new THREE.BufferGeometry();
  branches.setAttribute('position', new THREE.Float32BufferAttribute(bv, 3));
  branches.setAttribute('normal', new THREE.Float32BufferAttribute(bn, 3));
  branches.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  branches.setIndex(bi);
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(lv, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  leaves.setIndex(li);
  return { branches, leaves };
}

/**
 * Ağacı hedef boya/tepe genişliğine ölçekle; yaprak normallerini tepe merkezinden dışa doğru ayarla
 * (düz kartlar yerine hacimli tepe gölgelemesi — oyunlarda yaygın hile).
 */
export function fitTree(t: EzTreeGeometry, height: number, width: number): EzTreeGeometry {
  const box = new THREE.Box3().setFromBufferAttribute(t.leaves.attributes.position as THREE.BufferAttribute);
  box.union(new THREE.Box3().setFromBufferAttribute(t.branches.attributes.position as THREE.BufferAttribute));
  const sy = height / Math.max(1e-3, box.max.y);
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const sxz = width / Math.max(1e-3, w);
  const cx = (box.max.x + box.min.x) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  for (const g of [t.branches, t.leaves]) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++)
      p.setXYZ(i, (p.getX(i) - cx) * sxz, p.getY(i) * sy, (p.getZ(i) - cz) * sxz);
  }
  // Gövde normalleri ölçekle bozulur → yeniden hesapla (dikiş yerleri kopya köşe, pürüzsüz kalır)
  t.branches.computeVertexNormals();
  // Yaprak normalleri: tepe elipsoidinin merkezinden dışa, yukarı eğilimli
  const lb = new THREE.Box3().setFromBufferAttribute(t.leaves.attributes.position as THREE.BufferAttribute);
  const c = lb.getCenter(new THREE.Vector3());
  const half = lb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const p = t.leaves.attributes.position;
  const nrm = new Float32Array(p.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.set(
      (p.getX(i) - c.x) / Math.max(half.x, 0.1),
      (p.getY(i) - c.y) / Math.max(half.y, 0.1) + 0.35,
      (p.getZ(i) - c.z) / Math.max(half.z, 0.1),
    ).normalize();
    nrm.set([n.x, n.y, n.z], i * 3);
  }
  t.leaves.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  // Tepe yüksekliği (0 alt … 1 üst): gölgede sahte ortam kapanması ve rüzgârda salınım için
  const hgt = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++)
    hgt[i] = THREE.MathUtils.clamp((p.getY(i) - lb.min.y) / (lb.max.y - lb.min.y), 0, 1);
  t.leaves.setAttribute('crown', new THREE.BufferAttribute(hgt, 1));
  t.branches.computeBoundingSphere();
  t.leaves.computeBoundingSphere();
  return t;
}

/** Rüzgâr zamanı (saniye) — dünya güncellemesinde artırılır. */
export const windTime = { value: 0 };

export interface EzTreeKind {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  bark: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  triangles: number;
}

/** Türü üret: önce ölçek bulunur, yaprak kartları gerçek boyda (m) olacak şekilde yeniden üretilir. */
function makeSpecies(sp: (typeof TREE_SPECIES)[number]): EzTreeGeometry {
  const probe = generateEzTree(sp.opts);
  const box = new THREE.Box3().setFromBufferAttribute(
    probe.leaves.attributes.position as THREE.BufferAttribute,
  );
  const s = sp.height / Math.max(1e-3, box.max.y);
  probe.branches.dispose();
  probe.leaves.dispose();
  const t = generateEzTree({ ...sp.opts, leaves: { ...sp.opts.leaves, size: sp.cardSize / s } });
  return fitTree(t, sp.height, sp.width);
}

export function createEzTrees(base: string): EzTreeKind[] {
  const loader = new THREE.TextureLoader();
  const tex = new Map<string, THREE.Texture>();
  const load = (name: string, srgb: boolean, repeat = false) => {
    let t = tex.get(name);
    if (!t) {
      t = loader.load(`${base}textures/trees/${name}`);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      // Saydam PNG kenarında beyaz saçak olmasın (ez-tree de böyle yükler)
      if (name.endsWith('.png')) t.premultiplyAlpha = true;
      t.anisotropy = 4;
      tex.set(name, t);
    }
    return t;
  };
  return TREE_SPECIES.map((sp) => {
    const g = makeSpecies(sp);
    const bark = new THREE.MeshStandardMaterial({
      map: load(`${sp.bark}_color.jpg`, true, true),
      normalMap: load(`${sp.bark}_normal.jpg`, false, true),
      roughness: 0.95,
      color: 0xd8d0c4,
    });
    // Kabuk dokusu: gövde çevresi 1, boy boyunca birkaç tekrar
    bark.map!.repeat.set(1, 3);
    bark.normalMap!.repeat.set(1, 3);
    const leaf = new THREE.MeshStandardMaterial({
      map: load(`${sp.leaf}_color.png`, true),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.8,
      color: sp.tint,
    });
    leaf.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = windTime;
      sh.uniforms.uNight = nightUniform;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float crown;\nuniform float uWind;\nvarying float vCrown;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vCrown = crown;
#ifdef USE_INSTANCING
vec2 wph = instanceMatrix[3].xz * 0.21;
#else
vec2 wph = vec2(0.0);
#endif
float ws = crown * crown;
transformed.x += ws * (0.10 * sin(uWind * 1.1 + wph.x) + 0.035 * sin(uWind * 3.7 + position.y * 2.0 + wph.y));
transformed.z += ws * (0.08 * cos(uWind * 0.9 + wph.y) + 0.035 * sin(uWind * 4.3 + position.x * 2.0));`,
        );
      // Tepenin alt/iç kısmı gölgede (sahte ortam kapanması)
      // Yaprak ışık geçirgenliği: güneşe sırtı dönük yapraklar da gün ışığında parlak yeşil görünür (Street View
      // karelerinde taçlar aydınlık ~#768646); gece kapanır.
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCrown;\nuniform float uNight;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= 0.8 + 0.52 * vCrown;',
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.1 + 0.16 * vCrown) * (1.0 - uNight);',
        );
    };
    leaf.customProgramCacheKey = () => 'eztree-leaf-v2';
    const triangles = ((g.branches.index?.count ?? 0) + (g.leaves.index?.count ?? 0)) / 3;
    return { branches: g.branches, leaves: g.leaves, bark, leaf, triangles };
  });
}

/** Oyundaki üç ağaç türü: 0 yuvarlak (çınar/ıhlamur/akasya), 1 selvi (sütun), 2 kavak/oval. */
export const TREE_SPECIES: {
  opts: EzTreeOptions;
  height: number;
  width: number;
  /** yaprak kartı boyu (m) */
  cardSize: number;
  leaf: string;
  bark: string;
  tint: number;
}[] = [
  {
    // Yuvarlak tepeli yaprak döken (ash_medium'dan, daha az dal)
    height: 7.2,
    width: 5.6,
    cardSize: 1.25,
    leaf: 'ash',
    bark: 'oak',
    tint: 0xe6f0c2,
    opts: {
      seed: 36330,
      type: 'deciduous',
      levels: 3,
      angle: [0, 48, 70, 60],
      children: [5, 3, 2],
      force: -0.04,
      gnarliness: [0.03, 0.22, 0.2, 0.09],
      length: [43, 25, 10, 4.6],
      radius: [2, 0.63, 0.76, 0.7],
      sections: [8, 6, 3, 2],
      segments: [8, 5, 3, 3],
      start: [0, 0.3, 0.33, 0],
      taper: [0.7, 0.7, 0.7, 0.7],
      twist: [0.09, -0.07, 0, 0],
      leaves: { angle: 55, count: 7, start: 0, size: 4.2, sizeVariance: 0.4, double: true },
    },
  },
  {
    // Selvi: dar sütun, dik dallar, yoğun yaprak
    height: 8.8,
    width: 2.2,
    cardSize: 0.9,
    leaf: 'pine',
    bark: 'pine',
    tint: 0xa9ba9a,
    opts: {
      seed: 13977,
      type: 'evergreen',
      levels: 1,
      angle: [0, 30, 16, 60],
      children: [34, 3, 5],
      force: -0.001,
      gnarliness: [0.02, 0.04, 0, 0],
      length: [50, 16, 14, 1],
      radius: [1.05, 0.36, 0.7, 0.7],
      sections: [8, 4, 1, 1],
      segments: [7, 3, 3, 3],
      start: [0, 0.08, 0.14, 0.3],
      taper: [0.7, 0.7, 0.7, 0.7],
      twist: [0, 0, 0, 0],
      leaves: { angle: 30, count: 9, start: 0.05, size: 5.5, sizeVariance: 0.25, double: true },
    },
  },
  {
    // Kavak/akçaağaç: uzun oval tepe (aspen_medium'dan)
    height: 8.6,
    width: 3.8,
    cardSize: 1.1,
    leaf: 'aspen',
    bark: 'birch',
    // Doku sonbahar sarısı (~#c39637); Eylül Street View karelerinde tüm ağaçlar yeşil → yeşile çekilir
    tint: 0x60c090,
    opts: {
      seed: 18020,
      type: 'deciduous',
      levels: 2,
      angle: [0, 50, 32, 7],
      children: [10, 3, 3],
      force: 0.0148,
      gnarliness: [0.05, 0.12, 0.12, 0.02],
      length: [50, 8, 11, 1],
      radius: [0.72, 0.41, 0.7, 0.7],
      sections: [10, 5, 3, 3],
      segments: [7, 4, 3, 3],
      start: [0, 0.4, 0.35, 0],
      taper: [0.37, 0.13, 0.7, 0.7],
      twist: [0, 0, 0, 0],
      leaves: { angle: 30, count: 9, start: 0.1, size: 3.6, sizeVariance: 0.5, double: true },
    },
  },
];
