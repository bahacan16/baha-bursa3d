import * as THREE from 'three';

/**
 * Prosedürel dallı ağaç üreteci — ez-tree (Daniel Greenheck, MIT, github.com/dgreenheck/ez-tree) algoritmasının
 * sadeleştirilmiş TypeScript uyarlaması. Yalnızca geometri üretir; doku, malzeme ve türler `treelib.ts`'de.
 * KARAR: paket yalnızca kök modülü dışa açıyor ve içe aktarılınca 20 dokuyu birden yüklüyor → üreteç buraya taşındı.
 *
 * Özgün algoritmaya eklenenler (tür silüetleri için):
 * - `envelope`: taç zarfı (budama şekli). Alt dal boyu, dal yönünde zarfın dışına taşmayacak kadar kısaltılır
 *   → top akasyanın küresi, ıhlamurun yumurtası, karaağacın kubbesi.
 * - `forceLevel`: seviye başına yerçekimi/ışık yönelimi (negatif = sarkma; sedirin sarkık dalları).
 * - `leaderDroop`: gövdenin son çeyreğinde tepe eğilmesi (Himalaya sedirinin eğik tepe sürgünü).
 * - `levelStart`: dal index tamponunda seviyelerin başlangıcı → orta LOD'da ince dallar atılır.
 */
export interface EzTreeOptions {
  seed: number;
  type: 'deciduous' | 'evergreen';
  levels: number;
  /** Seviye başına (0 = gövde) */
  angle: number[];
  children: number[];
  force: number;
  /** Seviye başına yönelim gücü (verilirse `force` yerine) */
  forceLevel?: number[];
  gnarliness: number[];
  length: number[];
  radius: number[];
  sections: number[];
  segments: number[];
  start: number[];
  taper: number[];
  twist: number[];
  /** Tepe sürgünü eğilmesi (radyan, gövdenin son çeyreğinde birikimli) */
  leaderDroop?: number;
  /**
   * Seviye başına halka (whorl) başına dal sayısı: verilirse o seviyenin dalları rastgele değil, eşit aralıklı
   * halkalar hâlinde dizilir (ladin/sedir katları). 0 = rastgele (özgün davranış).
   */
  whorl?: number[];
  /**
   * Taç zarfı: gövde boyuna (length[0]) bölünmüş koordinatlarda (x, y, z) → > 0 içeride. Alt dallar (seviye ≥ 1)
   * zarfın dışına uzamaz; `envelopeMin` en kısa kalan oran.
   */
  envelope?: (x: number, y: number, z: number) => number;
  envelopeMin?: number;
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
  /** Dal index tamponunda seviye başlangıçları (levelStart[l] = l. seviyenin ilk index'i; son eleman = toplam) */
  levelStart: number[];
  /** Yaprak başına dörtgen sayısı (double → 2) */
  quadsPerLeaf: number;
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
  const levelStart: number[] = [];
  const L0 = Math.max(1e-3, o.length[0]);
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
  const dir = new THREE.Vector3();
  const probe = new THREE.Vector3();

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

  /** Zarfa göre dal boyu: dal yönünde zarftan çıkılan ilk nokta */
  const clip = (origin: THREE.Vector3, ori: THREE.Euler, len: number): number => {
    const env = o.envelope;
    if (!env) return len;
    dir.set(0, 1, 0).applyEuler(ori);
    const steps = 10;
    for (let k = 1; k <= steps; k++) {
      const s = (len * k) / steps;
      probe.copy(origin).addScaledVector(dir, s);
      if (env(probe.x / L0, probe.y / L0, probe.z / L0) < 0) {
        return Math.max(len * (o.envelopeMin ?? 0.15), (len * (k - 0.5)) / steps);
      }
    }
    return len;
  };

  while (queue.length) {
    const br = queue.shift()!;
    while (levelStart.length <= br.level) levelStart.push(bi.length);
    const indexOffset = bv.length / 3;
    const ori = br.orientation.clone();
    const org = br.origin.clone();
    // Özgün kodda tür karşılaştırması büyük harfle ('Deciduous') olduğundan bölen hep 1; ön ayarlar buna göre
    const secLen = br.length / br.sectionCount;
    const sections: Section[] = [];
    const force = o.forceLevel?.[br.level] ?? o.force;
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
      if (br.level === 0 && o.leaderDroop) {
        const f = (i + 1) / br.sectionCount;
        if (f > 0.75) ori.z += o.leaderDroop / Math.max(1, br.sectionCount * 0.25);
      }
      const qs = new THREE.Quaternion().setFromEuler(ori);
      qs.multiply(new THREE.Quaternion().setFromAxisAngle(UP, o.twist[br.level]));
      qs.rotateTowards(qForce, force / Math.max(r, 1e-4));
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
      const wh = o.whorl?.[level] ?? 0;
      const nW = wh > 0 ? Math.ceil(count / wh) : 0;
      for (let i = 0; i < count; i++) {
        let t: number;
        let radial: number;
        if (wh > 0) {
          const w = Math.floor(i / wh);
          const s0 = o.start[level];
          t = Math.min(0.995, s0 + ((1 - s0) * (w + 0.5 + rng.random(0.18, -0.18))) / nW);
          radial = 2 * Math.PI * (off + (i % wh) / wh + (w * 0.5) / wh + rng.random(0.06, -0.06));
        } else {
          t = rng.random(1, o.start[level]);
          radial = 2 * Math.PI * (off + i / count);
        }
        const s = pick(sections, t);
        const ori2 = orient(s.parent, o.angle[level], radial);
        const len = o.length[level] * (o.type === 'evergreen' ? 1 - t : 1);
        queue.push({
          origin: s.origin,
          orientation: ori2,
          length: clip(s.origin, ori2, len),
          radius: o.radius[level] * ((1 - s.alpha) * s.a.radius + s.alpha * s.b.radius),
          level,
          sectionCount: o.sections[level],
          segmentCount: o.segments[level],
        });
      }
    }
  }
  levelStart.push(bi.length);

  const branches = new THREE.BufferGeometry();
  branches.setAttribute('position', new THREE.Float32BufferAttribute(bv, 3));
  branches.setAttribute('normal', new THREE.Float32BufferAttribute(bn, 3));
  branches.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  branches.setIndex(bi);
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(lv, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  leaves.setIndex(li);
  return { branches, leaves, levelStart, quadsPerLeaf: o.leaves.double ? 2 : 1 };
}

/**
 * Ağacı hedef boya/tepe genişliğine ölçekle; yaprak normallerini tepe merkezinden dışa doğru ayarla
 * (düz kartlar yerine hacimli tepe gölgelemesi — oyunlarda yaygın hile). `bias`: normallerin yukarı eğilimi.
 */
/**
 * Görünen taç genişliği (m): gövde ekseninden yatay uzaklıkların 10 boy diliminde %95'liği, en geniş dilim × 2.
 * Sınır kutusu tek bir uzun dalın ucuyla belirleniyordu → sık taç başvuru genişliğinin ~%80'i kalıyordu (critic
 * rb/b-05: sedir ölçülen r'den dar). Yaprak köşesi azsa sınır kutusu.
 */
export function crownWidth(leaves: THREE.BufferGeometry): number {
  const p = leaves.attributes.position;
  if (!p || p.count === 0) return 0;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < p.count; i++) {
    y0 = Math.min(y0, p.getY(i));
    y1 = Math.max(y1, p.getY(i));
  }
  const NS = 10;
  const sl: number[][] = Array.from({ length: NS }, () => []);
  const span = Math.max(1e-3, y1 - y0);
  for (let i = 0; i < p.count; i++) {
    const k = Math.min(NS - 1, Math.max(0, Math.floor(((p.getY(i) - y0) / span) * NS)));
    sl[k].push(Math.hypot(p.getX(i), p.getZ(i)));
  }
  const minN = Math.max(8, Math.floor(p.count / (NS * 8)));
  let best = 0;
  for (const s of sl) {
    if (s.length < minN) continue;
    s.sort((a, b) => a - b);
    best = Math.max(best, s[Math.floor(0.95 * (s.length - 1))]);
  }
  if (best > 0) return 2 * best;
  const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  return Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
}

export function fitTree(t: EzTreeGeometry, height: number, width: number, bias = 0.35): EzTreeGeometry {
  const box = new THREE.Box3().setFromBufferAttribute(t.leaves.attributes.position as THREE.BufferAttribute);
  box.union(new THREE.Box3().setFromBufferAttribute(t.branches.attributes.position as THREE.BufferAttribute));
  const sy = height / Math.max(1e-3, box.max.y);
  // Ölçülen / başvuru taç genişliği görünen (sık) taç genişliğine uyar (sınır kutusuna değil)
  const w = crownWidth(t.leaves);
  const sxz = width / Math.max(1e-3, w);
  // KARAR: gövde dibi (0,0,0) yerinde kalır (ölçülen konum gövdedir; çarpışma kutusu da orada) — eski sürüm
  // asimetrik tepeyi ortalıyor, gövdeyi kaydırıyordu
  for (const g of [t.branches, t.leaves]) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * sxz, p.getY(i) * sy, p.getZ(i) * sxz);
  }
  // Gövde normalleri ölçekle bozulur → yeniden hesapla (dikiş yerleri kopya köşe, pürüzsüz kalır)
  t.branches.computeVertexNormals();
  crownAttributes(t.leaves, bias);
  t.branches.computeBoundingSphere();
  t.leaves.computeBoundingSphere();
  return t;
}

/**
 * Yaprak normalleri: tepe elipsoidinin merkezinden dışa, yukarı eğilimli; `crown` (0 alt … 1 üst): gölgede sahte
 * ortam kapanması ve rüzgârda salınım için.
 */
export function crownAttributes(leaves: THREE.BufferGeometry, bias = 0.35): void {
  const p = leaves.attributes.position;
  const lb = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  const c = lb.getCenter(new THREE.Vector3());
  const half = lb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const nrm = new Float32Array(p.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.set(
      (p.getX(i) - c.x) / Math.max(half.x, 0.1),
      (p.getY(i) - c.y) / Math.max(half.y, 0.1) + bias,
      (p.getZ(i) - c.z) / Math.max(half.z, 0.1),
    ).normalize();
    nrm.set([n.x, n.y, n.z], i * 3);
  }
  leaves.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (!leaves.getAttribute('crown')) {
    const hgt = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++)
      hgt[i] = THREE.MathUtils.clamp((p.getY(i) - lb.min.y) / Math.max(1e-3, lb.max.y - lb.min.y), 0, 1);
    leaves.setAttribute('crown', new THREE.BufferAttribute(hgt, 1));
  }
}

/** Rüzgâr zamanı (saniye) — dünya güncellemesinde artırılır. */
export const windTime = { value: 0 };
