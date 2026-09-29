import * as THREE from 'three';

/** Malzeme anahtarına göre üçgen biriktirir; sonunda her anahtar için tek mesh üretir (az draw call). */
export class Builder {
  private buckets = new Map<
    string,
    { pos: number[]; nor: number[]; uv: number[]; idx: number[]; aux: number[] | null }
  >();

  private bucket(key: string) {
    let b = this.buckets.get(key);
    if (!b) {
      b = { pos: [], nor: [], uv: [], idx: [], aux: null };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Köşe başına ek veri (vec4, `aux` özniteliği) — yalnızca kullanan kovalarda tutulur, diğerleri 0 */
  private pushAux(b: { pos: number[]; aux: number[] | null }, n: number, aux?: V4): void {
    if (!aux && !b.aux) return;
    if (!b.aux) b.aux = new Array(((b.pos.length / 3 - n) | 0) * 4).fill(0);
    for (let k = 0; k < n; k++) b.aux.push(...(aux ?? [0, 0, 0, 0]));
  }

  /**
   * Dörtgen: p0→p1 alt kenar, p3→p2 üst kenar. Normal (p1−p0)×(p3−p0) yönünde ön yüz.
   * uv: [u0,v0,u1,v1] (p0=(u0,v0), p2=(u1,v1)).
   */
  quad(
    key: string,
    p0: V3,
    p1: V3,
    p2: V3,
    p3: V3,
    uv: [number, number, number, number] = [0, 0, 1, 1],
    aux?: V4,
  ): void {
    const b = this.bucket(key);
    const o = b.pos.length / 3;
    const ax = p1[0] - p0[0];
    const ay = p1[1] - p0[1];
    const az = p1[2] - p0[2];
    const bx = p3[0] - p0[0];
    const by = p3[1] - p0[1];
    const bz = p3[2] - p0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    b.pos.push(...p0, ...p1, ...p2, ...p3);
    for (let k = 0; k < 4; k++) b.nor.push(nx, ny, nz);
    const [u0, v0, u1, v1] = uv;
    b.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    b.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    this.pushAux(b, 4, aux);
  }

  /** Dikey dikdörtgen yüz: a→e yatay (x,z), y0..y1; dışa bakan yön (a→e) × yukarı sağ taraf. */
  wall(
    key: string,
    a: V2,
    e: V2,
    y0: number,
    y1: number,
    uv?: [number, number, number, number],
    aux?: V4,
  ): void {
    this.quad(key, [a[0], y0, a[1]], [e[0], y0, e[1]], [e[0], y1, e[1]], [a[0], y1, a[1]], uv, aux);
  }

  /** Eksen hizalı değil, Y etrafında dönmüş kutu. c: merkez, s: boyut (x=genişlik yön boyunca, z=derinlik). */
  box(key: string, c: V3, s: V3, yaw = 0, uvScale = 1, faces = 0b111111): void {
    const [cx, cy, cz] = c;
    const hx = s[0] / 2;
    const hy = s[1] / 2;
    const hz = s[2] / 2;
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    const P = (x: number, y: number, z: number): V3 => [cx + x * co + z * si, cy + y, cz - x * si + z * co];
    const U = uvScale;
    // +z, −z, +x, −x, +y, −y
    if (faces & 1)
      this.quad(key, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), [
        0,
        0,
        s[0] * U,
        s[1] * U,
      ]);
    if (faces & 2)
      this.quad(key, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), [
        0,
        0,
        s[0] * U,
        s[1] * U,
      ]);
    if (faces & 4)
      this.quad(key, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), [
        0,
        0,
        s[2] * U,
        s[1] * U,
      ]);
    if (faces & 8)
      this.quad(key, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), [
        0,
        0,
        s[2] * U,
        s[1] * U,
      ]);
    if (faces & 16)
      this.quad(key, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), [
        0,
        0,
        s[0] * U,
        s[2] * U,
      ]);
    if (faces & 32)
      this.quad(key, P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), [
        0,
        0,
        s[0] * U,
        s[2] * U,
      ]);
  }

  /** Yatay çokgen (üçgenlenmiş), y yüksekliğinde; up=true yukarı bakar. UV = dünya x,z × uvScale. */
  polygon(key: string, ring: V2[], y: number, up = true, uvScale = 1): void {
    const tris = THREE.ShapeUtils.triangulateShape(
      ring.map((p) => new THREE.Vector2(p[0], p[1])),
      [],
    );
    const b = this.bucket(key);
    const o = b.pos.length / 3;
    for (const p of ring) {
      b.pos.push(p[0], y, p[1]);
      b.nor.push(0, up ? 1 : -1, 0);
      b.uv.push(p[0] * uvScale, -p[1] * uvScale);
    }
    this.pushAux(b, ring.length);
    // ShapeUtils x,y düzleminde CCW → x,z düzleminde (z aşağı) yön ters; yukarı bakış için sırayı çevir
    for (const t of tris) {
      if (up) b.idx.push(o + t[0], o + t[2], o + t[1]);
      else b.idx.push(o + t[0], o + t[1], o + t[2]);
    }
  }

  /**
   * Araziye oturan yatay çokgen (delikli): üçgenler küçük parçalara bölünür, her köşe y = H(x,z) + off.
   * UV = dünya x,−z × uvScale; frame verilirse yerel eksen: u = (p−o)·t, v = (p−o)·n (şerit boyunca döşeme).
   * Normal yukarı (arazi neredeyse düz).
   */
  drape(
    key: string,
    ring: V2[],
    holes: V2[][],
    H: (x: number, z: number) => number,
    off: number,
    uvScale = 1,
    maxEdge = 2,
    frame?: { o: V2; t: V2; n: V2 },
  ): void {
    const all = [...ring, ...holes.flat()];
    const tris = THREE.ShapeUtils.triangulateShape(
      ring.map((p) => new THREE.Vector2(p[0], p[1])),
      holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))),
    );
    const b = this.bucket(key);
    for (const t of tris) {
      // Yukarı bakış için sıra: t0, t2, t1
      const A = all[t[0]];
      const B = all[t[2]];
      const C = all[t[1]];
      const L = Math.max(
        Math.hypot(B[0] - A[0], B[1] - A[1]),
        Math.hypot(C[0] - B[0], C[1] - B[1]),
        Math.hypot(A[0] - C[0], A[1] - C[1]),
      );
      const n = Math.max(1, Math.ceil(L / maxEdge));
      const o = b.pos.length / 3;
      const idx = (i: number, j: number) => o + (i * (2 * n + 3 - i)) / 2 + j;
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          const u = i / n;
          const v = j / n;
          const x = A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v;
          const z = A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v;
          b.pos.push(x, H(x, z) + off, z);
          b.nor.push(0, 1, 0);
          if (frame) {
            const dx = x - frame.o[0];
            const dz = z - frame.o[1];
            b.uv.push(
              (dx * frame.t[0] + dz * frame.t[1]) * uvScale,
              (dx * frame.n[0] + dz * frame.n[1]) * uvScale,
            );
          } else b.uv.push(x * uvScale, -z * uvScale);
          this.pushAux(b, 1);
        }
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n - i; j++) {
          b.idx.push(idx(i, j), idx(i + 1, j), idx(i, j + 1));
          if (j + 1 < n - i) b.idx.push(idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1));
        }
    }
  }

  /** Silindir (dikey), segment sayısı az. */
  cylinder(key: string, c: V3, r: number, h: number, seg = 8): void {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.quad(
        key,
        [c[0] + Math.cos(a0) * r, c[1], c[2] - Math.sin(a0) * r],
        [c[0] + Math.cos(a1) * r, c[1], c[2] - Math.sin(a1) * r],
        [c[0] + Math.cos(a1) * r, c[1] + h, c[2] - Math.sin(a1) * r],
        [c[0] + Math.cos(a0) * r, c[1] + h, c[2] - Math.sin(a0) * r],
        [i / seg, 0, (i + 1) / seg, 1],
      );
    }
  }

  /** Küre (düşük çözünürlük) */
  sphere(key: string, c: V3, r: number, seg = 10): void {
    const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2));
    g.translate(c[0], c[1], c[2]);
    this.geometry(key, g);
  }

  /** Hazır geometri ekle (indexed ya da değil). */
  geometry(key: string, g: THREE.BufferGeometry): void {
    const b = this.bucket(key);
    const o = b.pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      b.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      b.nor.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
      b.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    this.pushAux(b, p.count);
    if (g.index) for (let i = 0; i < g.index.count; i++) b.idx.push(o + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) b.idx.push(o + i);
    g.dispose();
  }

  build(materials: Record<string, THREE.Material>, group: THREE.Group, shadows: boolean): void {
    for (const [key, b] of this.buckets) {
      if (!b.idx.length) continue;
      const mat = materials[key];
      if (!mat) throw new Error(`malzeme yok: ${key}`);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      if (b.aux) g.setAttribute('aux', new THREE.Float32BufferAttribute(b.aux, 4));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = `mertkent ${key}`;
      const transparent = (mat as THREE.MeshStandardMaterial).transparent;
      m.castShadow = shadows && !transparent && !mat.userData.noCast;
      // Düz cam yüzeylerde gölge sivilcesi (acne) olmasın diye bazı malzemeler gölge almaz
      m.receiveShadow = shadows && !mat.userData.noReceive;
      group.add(m);
    }
  }
}

export type V2 = [number, number];
export type V3 = [number, number, number];
export type V4 = [number, number, number, number];

/**
 * Bir bitki yüzeyine (çit gövdesi) yaprak kartları serpiştir: düz dokulu kutu silüetini kırar.
 * a→e: çit ekseni, n: ön yüz normali (yalnızca bu yüz + üst kaplanır), y0..y1 yükseklik, depth: gövde kalınlığı.
 */
export function leafFringe(
  b: Builder,
  key: string,
  a: V2,
  e: V2,
  y0: number,
  y1: number,
  depth: number,
  n: V2,
  perM2: number,
  seed: number,
  size = 0.6,
): void {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const dx = e[0] - a[0];
  const dz = e[1] - a[1];
  const L = Math.hypot(dx, dz);
  if (L < 0.2) return;
  const t: V2 = [dx / L, dz / L];
  const card = (c: V3, u: V3, v: V3) => {
    // u: yatay yarı-vektör, v: dikey yarı-vektör
    b.quad(
      key,
      [c[0] - u[0] - v[0], c[1] - u[1] - v[1], c[2] - u[2] - v[2]],
      [c[0] + u[0] - v[0], c[1] + u[1] - v[1], c[2] + u[2] - v[2]],
      [c[0] + u[0] + v[0], c[1] + u[1] + v[1], c[2] + u[2] + v[2]],
      [c[0] - u[0] + v[0], c[1] - u[1] + v[1], c[2] - u[2] + v[2]],
    );
  };
  const h = y1 - y0;
  // Ön yüz
  const nFace = Math.round(L * h * perM2);
  for (let i = 0; i < nFace; i++) {
    const along = rnd() * L;
    const y = y0 + 0.1 + rnd() * (h - 0.1);
    const out = 0.02 + rnd() * 0.08;
    const c: V3 = [a[0] + t[0] * along + n[0] * out, y, a[1] + t[1] * along + n[1] * out];
    const sz = size * (0.7 + rnd() * 0.6);
    const ang = (rnd() - 0.5) * 1.6; // kartın yüzeye göre dönüşü
    const tilt = (rnd() - 0.5) * 0.9;
    const ux = t[0] * Math.cos(ang) + n[0] * Math.sin(ang);
    const uz = t[1] * Math.cos(ang) + n[1] * Math.sin(ang);
    card(
      c,
      [(ux * sz) / 2, 0, (uz * sz) / 2],
      [n[0] * Math.sin(tilt) * sz * 0.5, (Math.cos(tilt) * sz) / 2, n[1] * Math.sin(tilt) * sz * 0.5],
    );
  }
  // Üst yüz
  const nTop = Math.round(L * depth * perM2 * 1.2);
  for (let i = 0; i < nTop; i++) {
    const along = rnd() * L;
    const across = (rnd() - 0.2) * depth;
    const c: V3 = [
      a[0] + t[0] * along - n[0] * across,
      y1 + 0.02 + rnd() * 0.12,
      a[1] + t[1] * along - n[1] * across,
    ];
    const sz = size * (0.7 + rnd() * 0.6);
    const ang = rnd() * Math.PI;
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    card(c, [(ux * sz) / 2, 0, (uz * sz) / 2], [((-uz * sz) / 2) * 0.6, sz * 0.35, ((ux * sz) / 2) * 0.6]);
  }
}
