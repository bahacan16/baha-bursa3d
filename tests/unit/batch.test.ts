import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { batchHandModel } from '../../src/worlds/measured/batch';
import { shadowOnlyRoots } from '../../src/env/ultra';

function boxMesh(x: number, mat: THREE.Material, cast = true): THREE.Mesh {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(x + 10, 0.5, 10);
  g.clearGroups();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

describe('el modeli birleştirme (Ultra)', () => {
  it('yalnız rengi farklı malzemeleri köşe rengiyle birleştirir, gölgeyi vekile taşır', () => {
    const group = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x0000ff, roughness: 0.4 });
    const rough = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.4, side: THREE.DoubleSide });
    const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    group.add(boxMesh(0, red), boxMesh(3, blue), boxMesh(6, rough), boxMesh(9, glass, false));
    const st = batchHandModel(group);

    expect(st.colorMerged).toBe(2);
    expect(st.colorMeshes).toBe(1);
    expect(st.shadowCastersBefore).toBe(3);
    const merged = group.children.find((o) => o.name.startsWith('mertkent-batch vc')) as THREE.Mesh;
    const mm = merged.material as THREE.MeshStandardMaterial;
    expect(mm.vertexColors).toBe(true);
    expect(mm.color.getHex()).toBe(0xffffff);
    expect(mm.roughness).toBe(0.4);
    // köşe renkleri eski malzeme renkleri (doğrusal) — çarpım aynı kalır
    const col = merged.geometry.attributes.color;
    const pos = merged.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const want = pos.getX(i) < 11.5 ? red.color : blue.color;
      expect(col.getX(i)).toBeCloseTo(want.r, 6);
      expect(col.getZ(i)).toBeCloseTo(want.b, 6);
    }
    expect(merged.geometry.index!.count).toBe(72);
    expect(merged.geometry.attributes.batchRM).toBeUndefined();
    // farklı yüz ve saydam ayrı kalır
    const mats = group.children.map((o) => (o as THREE.Mesh).material as THREE.MeshStandardMaterial);
    expect(mats.filter((m) => m?.side === THREE.DoubleSide && !m.vertexColors)).toHaveLength(1);
    expect(mats.filter((m) => m?.transparent)).toHaveLength(1);

    // gölge: özgün meshler dökmez; vekil kök görünmez, gölge köklerine kayıtlı, üçgenlerin hepsi
    for (const o of group.children)
      if (!o.name.startsWith('mertkent-shadow')) expect(o.castShadow).toBe(false);
    const root = group.getObjectByName('mertkent-shadow-proxies')!;
    expect(root.visible).toBe(false);
    expect(shadowOnlyRoots.has(root)).toBe(true);
    let tris = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        expect(m.castShadow).toBe(true);
        tris += m.geometry.index!.count / 3;
      }
    });
    expect(tris).toBe(36);
    shadowOnlyRoots.delete(root);
  });

  it('büyük meshleri ızgara hücrelerine böler (ayıklama çalışsın)', () => {
    const group = new THREE.Group();
    const a = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const b = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    group.add(boxMesh(0, a), boxMesh(1100, a.clone()), boxMesh(10, b));
    const st = batchHandModel(group);
    expect(st.colorMerged).toBe(3);
    expect(st.colorMeshes).toBe(2);
    for (const o of group.children) {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name.startsWith('mertkent-batch'))
        expect(m.geometry.boundingSphere!.radius).toBeLessThan(20);
    }
    for (const r of [...shadowOnlyRoots]) shadowOnlyRoots.delete(r);
  });

  it('özel gölgelendirici eklentisi: aynı çıktı birleşir, farklı sabit ayrı kalır', () => {
    const patched = (hex: number, k: number) => {
      const m = new THREE.MeshStandardMaterial({ color: hex });
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>\nreflectedLight.indirectSpecular *= ${k.toFixed(1)};`,
        );
      };
      m.customProgramCacheKey = () => 'test-patch';
      return m;
    };
    const group = new THREE.Group();
    group.add(
      boxMesh(0, patched(0xff0000, 2)),
      boxMesh(3, patched(0x00ff00, 2)),
      boxMesh(6, patched(0x0000ff, 3)),
    );
    const st = batchHandModel(group);
    expect(st.colorMerged).toBe(2);
    const merged = group.children.find((o) => o.name.startsWith('mertkent-batch vc')) as THREE.Mesh;
    const sh = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {},
    };
    (merged.material as THREE.Material).onBeforeCompile(sh as never, null as never);
    expect(sh.fragmentShader).toContain('indirectSpecular *= 2.0');
    for (const r of [...shadowOnlyRoots]) shadowOnlyRoots.delete(r);
  });

  it('pürüzlülük / metallik farkı köşe özniteliğine taşınır', () => {
    const group = new THREE.Group();
    const a = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4, metalness: 0.1 });
    const b = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.85, metalness: 0 });
    group.add(boxMesh(0, a), boxMesh(3, b));
    const st = batchHandModel(group);
    expect(st.colorMerged).toBe(2);
    const merged = group.children.find((o) => o.name.startsWith('mertkent-batch vc')) as THREE.Mesh;
    const rm = merged.geometry.attributes.batchRM;
    const pos = merged.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const want = pos.getX(i) < 11.5 ? a : b;
      expect(rm.getX(i)).toBeCloseTo(want.roughness, 6);
      expect(rm.getY(i)).toBeCloseTo(want.metalness, 6);
    }
    const sh = {
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
      uniforms: {},
    };
    (merged.material as THREE.Material).onBeforeCompile(sh as never, null as never);
    expect(sh.fragmentShader).toContain('float roughnessFactor = vBatchRM.x;');
    expect(sh.fragmentShader).toContain('float metalnessFactor = vBatchRM.y;');
    expect(sh.vertexShader).toContain('vBatchRM = batchRM;');
    for (const r of [...shadowOnlyRoots]) shadowOnlyRoots.delete(r);
  });

  it('çizim sırası (malzeme kimliği) özgün sırayı izler', () => {
    const group = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const panel = new THREE.MeshStandardMaterial({ color: 0x2255aa, side: THREE.DoubleSide });
    const wall2 = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    group.add(boxMesh(0, wall), boxMesh(3, panel), boxMesh(6, wall2));
    batchHandModel(group);
    const id = (o: THREE.Object3D) => ((o as THREE.Mesh).material as unknown as { id: number }).id;
    const merged = group.children.find((o) => o.name.startsWith('mertkent-batch vc'))!;
    const pan = group.children.find(
      (o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.side === THREE.DoubleSide,
    )!;
    // duvar grubu (en küçük kaynak: wall) panelden önce çizilir, özgündeki gibi panel eşit derinlikte kazanır
    expect(id(merged)).toBeLessThan(id(pan));
    for (const r of [...shadowOnlyRoots]) shadowOnlyRoots.delete(r);
  });
});
