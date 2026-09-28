import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * İnsan modelleri (three.js örnek deposu, Mixamo iskeleti):
 * - readyplayer.me.glb: gerçekçi sivil erkek avatar (animasyonsuz, kemik adları önek-siz: "Hips")
 * - Michelle.glb: gerçekçi sivil kadın (kemikler "mixamorig:*")
 * - Xbot.glb: yalnızca animasyon kaynağı (idle / walk / run)
 * Klipler kemik adı eşlemesiyle hedef modele aktarılır; yalnızca dönüş (quaternion) izleri kullanılır
 * (konum izleri model ölçeğine bağlı olduğundan atılır).
 */
export type Gait = 'Idle' | 'Walking' | 'Running';

const cache = new Map<string, Promise<GLTF>>();
export function loadGltf(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url);
    cache.set(url, p);
  }
  return p;
}

/** Modelde kullanılan kemik adı öneki: "mixamorig" ya da "" */
export function bonePrefix(root: THREE.Object3D): string {
  let prefix = '';
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone && /^mixamorig.*Hips$/.test(o.name)) prefix = o.name.replace(/Hips$/, '');
  });
  return prefix;
}

let clipsPromise: Promise<Map<Gait, THREE.AnimationClip>> | null = null;

/** Xbot'tan ham klipler (mixamorig önekli) */
export function baseClips(base: string): Promise<Map<Gait, THREE.AnimationClip>> {
  if (!clipsPromise)
    clipsPromise = loadGltf(`${base}models/people/Xbot.glb`).then((g) => {
      const m = new Map<Gait, THREE.AnimationClip>();
      const pick: [Gait, string][] = [
        ['Idle', 'idle'],
        ['Walking', 'walk'],
        ['Running', 'run'],
      ];
      for (const [gait, name] of pick) {
        const c = g.animations.find((a) => a.name === name);
        if (c) m.set(gait, c);
      }
      return m;
    });
  return clipsPromise;
}

/** Klibi hedef iskelete uyarla: önek değiştir, konum izlerini at. */
export function retarget(clip: THREE.AnimationClip, prefix: string, name: string): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.quaternion')) continue;
    const bone = t.name.slice(0, -'.quaternion'.length).replace(/^mixamorig/, '');
    const tt = t.clone();
    tt.name = `${prefix}${bone}.quaternion`;
    tracks.push(tt);
  }
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

/** Modeli hedef boya ölçekle, ayakları y=0'a oturt; +Z'ye bakan modeli oyunun −Z yönüne çevir. */
/** Dinlenme duruşunda boy ölçümü (kemiklerden; yoksa kutudan): [boy, taban] */
export function measureModel(model: THREE.Object3D): [number, number] {
  model.updateMatrixWorld(true);
  // KARAR: boy, iskelet varsa kemiklerden (ayak–baş) ölçülür; skinned mesh kutuları bazı modellerde güvenilmez
  let minY = Infinity;
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      o.getWorldPosition(v);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  });
  if (Number.isFinite(minY) && maxY - minY > 1e-6) return [(maxY - minY) * 1.07, minY]; // baş kemiği tepeden biraz aşağıda
  const box = new THREE.Box3().setFromObject(model);
  return [box.max.y - box.min.y, box.min.y];
}

/**
 * Modeli hedef boya ölçekle, tabanı y=0'a oturt, yüzünü +Z'ye çevir.
 * `measured`: klip aktarımı kemikleri bozmadan önce alınmış ölçü (şablondan kopyalarda).
 */
export function normalizeModel(
  model: THREE.Object3D,
  height: number,
  measured?: [number, number],
): THREE.Group {
  const [h, floor] = measured ?? measureModel(model);
  const s = h > 1e-6 ? height / h : 1;
  model.scale.multiplyScalar(s);
  model.position.y -= floor * s;
  // Bakış yönü: +Z'ye bakan modelde sol kol +X'te. Ters kaydedilmiş modelleri (−Z) düzelt.
  let L: THREE.Object3D | null = null;
  let R: THREE.Object3D | null = null;
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone && /LeftArm$/.test(o.name)) L = o;
    if ((o as THREE.Bone).isBone && /RightArm$/.test(o.name)) R = o;
  });
  let facesMinusZ = false;
  if (L && R) {
    model.updateMatrixWorld(true);
    const lx = (L as THREE.Object3D).getWorldPosition(new THREE.Vector3()).x;
    const rx = (R as THREE.Object3D).getWorldPosition(new THREE.Vector3()).x;
    facesMinusZ = lx < rx;
  }
  const holder = new THREE.Group();
  holder.rotation.y = facesMinusZ ? 0 : Math.PI;
  holder.add(model);
  return holder;
}

/**
 * Dinlenme duruşuna dön. KARAR: `skeleton.pose()` kullanılmaz — kök kemiğin ebeveyni ölçekliyse (Michelle: 0.01)
 * bağlama matrisini yerel dönüşüm sanıp modeli 100 kat küçültüyordu. İlk görüldüğündeki yerel dönüşümler saklanır.
 */
const restCache = new WeakMap<THREE.Bone, [THREE.Vector3, THREE.Quaternion, THREE.Vector3]>();
export function restPose(mesh: THREE.SkinnedMesh): void {
  for (const b of mesh.skeleton.bones) {
    const r = restCache.get(b);
    if (!r) restCache.set(b, [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
    else {
      b.position.copy(r[0]);
      b.quaternion.copy(r[1]);
      b.scale.copy(r[2]);
    }
  }
}

/**
 * Dünya uzayında dinlenme-duruşu farkıyla klip aktarımı (kemik eksenleri farklı iskeletler için):
 *   ΔR_src(t) = R_src_world(t) · R_src_world_rest⁻¹
 *   R_tgt_world(t) = ΔR_src(t) · R_tgt_world_rest
 *   q_local = R_parent_world(t)⁻¹ · R_tgt_world(t)
 * Kalça yüksekliği oranla ölçeklenmiş dikey sallanma korunur. Sonuç 30 fps'lik bir klip olur.
 */
export function bakeRetarget(
  target: THREE.SkinnedMesh,
  source: THREE.SkinnedMesh,
  clip: THREE.AnimationClip,
  name: string,
  mapName: (targetBone: string) => string,
  fps = 30,
): THREE.AnimationClip {
  const tb = target.skeleton.bones;
  const sb = new Map(source.skeleton.bones.map((b) => [b.name, b]));
  const sRoot = source.skeleton.bones[0].parent ?? source;
  // Dinlenme duruşları
  restPose(source);
  restPose(target);
  sRoot.updateMatrixWorld(true);
  tb[0].parent?.updateMatrixWorld(true);
  const q = new THREE.Quaternion();
  const worldQ = (o: THREE.Object3D, out: THREE.Quaternion) => {
    o.updateWorldMatrix(true, false);
    return o.getWorldQuaternion(out);
  };
  const srcRest = new Map<string, THREE.Quaternion>();
  for (const b of source.skeleton.bones) srcRest.set(b.name, worldQ(b, new THREE.Quaternion()));
  const tgtRest = tb.map((b) => worldQ(b, new THREE.Quaternion()));
  const tgtParentRest = worldQ(tb[0].parent ?? target, new THREE.Quaternion());
  const hipT = tb.find((b) => /Hips$/.test(b.name));
  const hipS = hipT ? sb.get(mapName(hipT.name)) : undefined;
  const hipRestS = hipS ? hipS.getWorldPosition(new THREE.Vector3()) : null;
  const hipRestT = hipT ? hipT.getWorldPosition(new THREE.Vector3()) : null;
  const hipLocal0 = hipT ? hipT.position.clone() : null;
  const scale = hipRestS && hipRestT && hipRestS.y > 1e-6 ? hipRestT.y / hipRestS.y : 1;

  // Yön düzeltmesi: iki iskeletin dinlenmede baktığı yön farklı olabilir (sol→sağ omuz vektörü üzerinden, Y ekseni)
  const side = (bones: Map<string, THREE.Bone> | THREE.Bone[], l: string, r: string) => {
    const find = (n: string) =>
      bones instanceof Map ? bones.get(n) : (bones as THREE.Bone[]).find((b) => b.name === n);
    const L = find(l);
    const R = find(r);
    if (!L || !R) return null;
    return R.getWorldPosition(new THREE.Vector3())
      .sub(L.getWorldPosition(new THREE.Vector3()))
      .setY(0)
      .normalize();
  };
  const tl = tb.find((b) => /LeftArm$/.test(b.name));
  const tr = tb.find((b) => /RightArm$/.test(b.name));
  const vt = tl && tr ? side(tb, tl.name, tr.name) : null;
  const vs = tl && tr ? side(sb, mapName(tl.name), mapName(tr.name)) : null;
  const corr = new THREE.Quaternion();
  if (vt && vs && vt.lengthSq() > 0.5 && vs.lengthSq() > 0.5) corr.setFromUnitVectors(vs, vt);
  const corrInv = corr.clone().invert();

  // Dinlenme duruşu farkı (A-poz ↔ T-poz): her hedef kemiği, kaynağın dinlenme kemik yönüne hizala
  const align = tb.map(() => new THREE.Quaternion());
  for (let i = 0; i < tb.length; i++) {
    const b = tb[i];
    const sbn = sb.get(mapName(b.name));
    if (!sbn) continue;
    const child = b.children.find((c) => (c as THREE.Bone).isBone && sb.has(mapName(c.name))) as
      THREE.Bone | undefined;
    if (!child) continue;
    const sChild = sb.get(mapName(child.name))!;
    const dT = child.getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3()));
    const dS = sChild.getWorldPosition(new THREE.Vector3()).sub(sbn.getWorldPosition(new THREE.Vector3()));
    if (dT.lengthSq() < 1e-12 || dS.lengthSq() < 1e-12) continue;
    dS.applyQuaternion(corr);
    align[i].setFromUnitVectors(dT.normalize(), dS.normalize());
  }

  const mixer = new THREE.AnimationMixer(sRoot);
  mixer.clipAction(clip).play();
  const frames = Math.max(2, Math.round(clip.duration * fps));
  const times = new Float32Array(frames);
  const quats = tb.map(() => new Float32Array(frames * 4));
  const hipY = new Float32Array(frames * 3);
  const deltaQ = new THREE.Quaternion();
  const worldNow: THREE.Quaternion[] = tb.map(() => new THREE.Quaternion());
  for (let f = 0; f < frames; f++) {
    const t = (f / (frames - 1)) * clip.duration;
    times[f] = t;
    mixer.setTime(t);
    sRoot.updateMatrixWorld(true);
    for (let i = 0; i < tb.length; i++) {
      const b = tb[i];
      const sbn = sb.get(mapName(b.name));
      if (sbn) {
        worldQ(sbn, q);
        deltaQ.copy(q).multiply(srcRest.get(sbn.name)!.clone().invert());
        // Kaynak çerçevesindeki farkı hedef çerçevesine taşı
        deltaQ.premultiply(corr).multiply(corrInv);
        worldNow[i].copy(deltaQ).multiply(align[i]).multiply(tgtRest[i]);
      } else {
        // Eşi yoksa ebeveynle birlikte dön (dinlenme göreli)
        const pi = b.parent ? tb.indexOf(b.parent as THREE.Bone) : -1;
        const parentNow = pi >= 0 ? worldNow[pi] : tgtParentRest;
        const parentRest = pi >= 0 ? tgtRest[pi] : tgtParentRest;
        worldNow[i].copy(parentNow).multiply(parentRest.clone().invert()).multiply(tgtRest[i]);
      }
    }
    for (let i = 0; i < tb.length; i++) {
      const b = tb[i];
      const pi = b.parent ? tb.indexOf(b.parent as THREE.Bone) : -1;
      const parentNow = pi >= 0 ? worldNow[pi] : tgtParentRest;
      q.copy(parentNow).invert().multiply(worldNow[i]);
      q.toArray(quats[i], f * 4);
    }
    if (hipS && hipT && hipRestS && hipLocal0) {
      const p = hipS.getWorldPosition(new THREE.Vector3());
      const dy = (p.y - hipRestS.y) * scale;
      // Dikey sallanmayı ebeveyn uzayında y'ye yaklaşık uygula
      hipY[f * 3] = hipLocal0.x;
      hipY[f * 3 + 1] =
        hipLocal0.y + dy / Math.max(1e-6, hipT.parent ? hipT.parent.getWorldScale(new THREE.Vector3()).y : 1);
      hipY[f * 3 + 2] = hipLocal0.z;
    }
  }
  mixer.stopAllAction();
  const tracks: THREE.KeyframeTrack[] = tb.map(
    (b, i) =>
      new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, Array.from(times), Array.from(quats[i])),
  );
  // KARAR: kalça konum izi eklenmez (ölçek dönüşümü modele göre değişiyor; dönüşler yürümeyi zaten taşıyor)
  void hipY;
  restPose(source);
  restPose(target);
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

let xbotPromise: Promise<{ mesh: THREE.SkinnedMesh; clips: Map<Gait, THREE.AnimationClip> }> | null = null;
/** Xbot iskeleti + klipleri (aktarım kaynağı) */
export function xbotSource(base: string) {
  if (!xbotPromise)
    xbotPromise = Promise.all([loadGltf(`${base}models/people/Xbot.glb`), baseClips(base)]).then(
      ([g, clips]) => {
        let mesh: THREE.SkinnedMesh | null = null;
        g.scene.traverse((o) => {
          if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
        });
        if (!mesh) throw new Error('Xbot iskeleti yok');
        return { mesh, clips };
      },
    );
  return xbotPromise;
}

/** Hedef modelin ilk SkinnedMesh'i */
export function firstSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let m: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!m && (o as THREE.SkinnedMesh).isSkinnedMesh) m = o as THREE.SkinnedMesh;
  });
  return m;
}
