/**
 * `?debug=1&bakeexport=1`: pişirme için dışa aktarma kancası (docs/BAKE.md §Hat 1). `scripts/bake-export.mjs`
 * (Playwright) `window.__bake` üzerinden parça GLB'lerini, engelleyicileri ve export.json bilgisini alır.
 * Yalnızca bu parametreyle dinamik yüklenir (GLTFExporter ana pakete girmez).
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  BAKE_CHUNK,
  BAKE_UV_VERSION,
  DEFAULT_UNWRAP,
  chunkSignature,
  splitChunks,
  unwrapChunk,
  type BakeChunk,
  type BakeSource,
  type UnwrapOptions,
} from './lightmap';
import { BAKE_SRC_HASH, collectBakeSources, partGeometry, type MatInfo } from './baked';

/** Engelleyici arazinin indirildiği miktar (m) — export.json `terrainDrop` */
const TERRAIN_DROP = 0.3;

interface WorldLike {
  object: THREE.Object3D;
  treeMeshes?: { im: THREE.InstancedMesh; mats: Float32Array }[];
}

async function toGlb(scene: THREE.Object3D): Promise<string> {
  const buf = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(s);
}

function plainMat(key: string, info: MatInfo): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: key,
    color: info.color,
    transparent: info.transparent,
    opacity: info.opacity,
    alphaTest: info.alphaTest,
    side: info.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** Dünya uzayında üçgen süzgeci: ağırlık merkezi dikdörtgen içindeyse al */
function clipMesh(
  src: THREE.Mesh,
  rect: [number, number, number, number],
  minHeight = -Infinity,
): THREE.BufferGeometry | null {
  const g = src.geometry;
  src.updateWorldMatrix(true, false);
  const p = g.attributes.position;
  const n = g.index ? g.index.count / 3 : p.count / 3;
  const out: number[] = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const i = g.index ? g.index.getX(t * 3 + k) : t * 3 + k;
      v[k].fromBufferAttribute(p, i).applyMatrix4(src.matrixWorld);
    }
    const cx = (v[0].x + v[1].x + v[2].x) / 3;
    const cz = (v[0].z + v[1].z + v[2].z) / 3;
    if (cx < rect[0] || cx > rect[2] || cz < rect[1] || cz > rect[3]) continue;
    if (Math.max(v[0].y, v[1].y, v[2].y) - Math.min(v[0].y, v[1].y, v[2].y) < minHeight) continue;
    for (const w of v) out.push(w.x, w.y, w.z);
  }
  if (!out.length) return null;
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  r.computeVertexNormals();
  return r;
}

export function installBakeExport(world: WorldLike): void {
  const params = new URLSearchParams(location.search);
  const opts: UnwrapOptions = {
    ...DEFAULT_UNWRAP,
    texel: Number(params.get('texel')) || DEFAULT_UNWRAP.texel,
    maxAtlas: Number(params.get('maxatlas')) || DEFAULT_UNWRAP.maxAtlas,
  };
  let cache: {
    sources: BakeSource[];
    others: BakeSource[];
    info: Map<string, MatInfo>;
    chunks: BakeChunk[];
  } | null = null;
  const prep = () => {
    if (!cache) {
      const c = collectBakeSources(world.object);
      if (!c) throw new Error('mertkent grubu yok');
      cache = { sources: c.sources, others: c.others, info: c.info, chunks: splitChunks(c.sources) };
    }
    return cache;
  };
  const api = {
    /** Parça listesi + malzeme bilgileri (export.json'un çekirdeği) */
    info() {
      const { sources, info, chunks } = prep();
      return {
        version: 1,
        terrainDrop: TERRAIN_DROP,
        uvVersion: BAKE_UV_VERSION,
        srcHash: BAKE_SRC_HASH,
        chunkSize: BAKE_CHUNK,
        unwrap: opts,
        keys: Object.fromEntries([...info.entries()]),
        chunks: chunks.map((c) => ({
          id: c.id,
          cx: c.cx,
          cz: c.cz,
          bbox: [c.cx * BAKE_CHUNK, c.cz * BAKE_CHUNK, (c.cx + 1) * BAKE_CHUNK, (c.cz + 1) * BAKE_CHUNK],
          sig: chunkSignature(c, sources),
          keys: c.parts.map((p) => sources[p.src].key),
          tris: c.parts.reduce((a, p) => a + p.tris.length, 0),
        })),
      };
    },
    /** Tek parça: uv1'li GLB (base64) + atlas boyutu */
    async chunk(id: string) {
      const { sources, info, chunks } = prep();
      const c = chunks.find((x) => x.id === id);
      if (!c) throw new Error(`parça yok: ${id}`);
      const t0 = performance.now();
      const u = unwrapChunk(c, sources, opts);
      const ms = performance.now() - t0;
      const scene = new THREE.Scene();
      c.parts.forEach((p, i) => {
        const key = sources[p.src].key;
        const g = partGeometry(sources[p.src].geometry, u.parts[i]);
        const m = new THREE.Mesh(g, plainMat(key, info.get(key) as MatInfo));
        m.name = key;
        scene.add(m);
      });
      const glb = await toGlb(scene);
      scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      return { glb, size: u.size, texel: u.texel, charts: u.charts, unwrapMs: Math.round(ms) };
    },
    /**
     * Engelleyiciler (alıcı değil): arazi, OSM/Street View binaları, ağaç taçları (küre/koni vekil),
     * pişirilmeyen el modeli meshleri (yaprak kartları vb.). rect: dünya x0,z0,x1,z1.
     */
    async occluders(rect: [number, number, number, number]) {
      const { others, info } = prep();
      const scene = new THREE.Scene();
      const add = (g: THREE.BufferGeometry | null, name: string, color = 0x999999) => {
        if (!g) return;
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name, color }));
        m.name = name;
        scene.add(m);
      };
      const ground = world.object.getObjectByName('ground') as THREE.Mesh | undefined;
      // Arazi 0.3 m aşağıda: vekil üçgenler (10 m ızgara) çift doğrusal H'den birkaç cm sapar ve üstüne serilen
      // döşeme katmanlarını (H + 1..15 cm) örtüp karartıyordu. Zemin AO düzlemi bunu geri ekler (bake_ao.py).
      if (ground) add(clipMesh(ground, rect)?.translate(0, -TERRAIN_DROP, 0) ?? null, 'occ_terrain', 0x807a70);
      const osm: THREE.BufferGeometry[] = [];
      world.object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        if (/^(wall|roof|roofTile|detail|barrier|rail)@/.test(m.name) || /^streetview (facades|hedges)/.test(m.name)) {
          const g = clipMesh(m, rect, 0);
          if (g) osm.push(g);
        }
      });
      for (const [i, g] of osm.entries()) add(g, `occ_osm_${i}`);
      // Pişirilmeyen el modeli meshleri (alfa testli yapraklar vb.): anahtar adıyla, saydamlık bilgisi keys'te
      for (const s of others) {
        const inf = info.get(s.key) as MatInfo;
        const m = new THREE.Mesh(s.geometry);
        const g = clipMesh(m, rect);
        if (g) {
          const mm = new THREE.Mesh(g, plainMat(s.key, inf));
          mm.name = `occ_mk_${s.key}`;
          scene.add(mm);
        }
      }
      // Ağaçlar: örnek başına taç elipsoidi + gövde (yinelenenler konumdan ayıklanır)
      const seen = new Set<string>();
      const canopy: THREE.BufferGeometry[] = [];
      const trunk: THREE.BufferGeometry[] = [];
      const sph = new THREE.IcosahedronGeometry(1, 1);
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
      const mtx = new THREE.Matrix4();
      const box = new THREE.Box3();
      const tm = world.treeMeshes ?? [];
      const ims: { im: THREE.InstancedMesh; mats: ArrayLike<number> }[] = tm.length
        ? tm
        : [];
      if (!ims.length)
        world.object.traverse((o) => {
          const im = o as THREE.InstancedMesh;
          if (im.isInstancedMesh && /^trees\d/.test(im.name))
            ims.push({ im, mats: im.instanceMatrix.array as Float32Array });
        });
      for (const { im, mats } of ims) {
        im.geometry.computeBoundingBox();
        const bb = im.geometry.boundingBox as THREE.Box3;
        for (let i = 0; i < im.count; i++) {
          mtx.fromArray(mats as number[], i * 16);
          const sc = new THREE.Vector3().setFromMatrixScale(mtx);
          if (sc.x < 1e-3) continue;
          box.copy(bb).applyMatrix4(mtx);
          const cx = (box.min.x + box.max.x) / 2;
          const cz = (box.min.z + box.max.z) / 2;
          if (cx < rect[0] || cx > rect[2] || cz < rect[1] || cz > rect[3]) continue;
          const k = `${Math.round(cx * 2)},${Math.round(cz * 2)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const h = box.max.y - box.min.y;
          const rx = (box.max.x - box.min.x) / 2;
          const rz = (box.max.z - box.min.z) / 2;
          const c0 = box.min.y + h * 0.3;
          const e = sph.clone();
          e.scale(rx * 0.92, (box.max.y - c0) / 2, rz * 0.92);
          e.translate(cx, (c0 + box.max.y) / 2, cz);
          canopy.push(e);
          const t = cyl.clone();
          const r = Math.max(0.08, Math.min(0.25, h * 0.02));
          t.scale(r, c0 - box.min.y + 0.5, r);
          t.translate(cx, (box.min.y + c0 + 0.5) / 2, cz);
          trunk.push(t);
        }
      }
      const merge = (gs: THREE.BufferGeometry[]) => {
        if (!gs.length) return null;
        let n = 0;
        for (const g of gs) n += (g.index ? g.index.count : g.attributes.position.count) * 3;
        const out = new Float32Array(n);
        let o = 0;
        for (const g of gs) {
          const ng = g.index ? g.toNonIndexed() : g;
          out.set(ng.attributes.position.array as Float32Array, o);
          o += ng.attributes.position.array.length;
        }
        const r = new THREE.BufferGeometry();
        r.setAttribute('position', new THREE.BufferAttribute(out, 3));
        r.computeVertexNormals();
        return r;
      };
      add(merge(canopy), 'occ_canopy', 0x3d5a2a);
      add(merge(trunk), 'occ_trunk', 0x5a4632);
      const glb = await toGlb(scene);
      return { glb, trees: canopy.length, osm: osm.length };
    },
  };
  (window as unknown as { __bake: typeof api }).__bake = api;
}
