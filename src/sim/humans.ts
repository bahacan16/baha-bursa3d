import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  bakeRetarget,
  bonePrefix,
  firstSkinned,
  loadGltf,
  normalizeModel,
  xbotSource,
} from '../player/people';

/**
 * Yakın yayalar için animasyonlu insan modelleri (Michelle + Ready Player Me erkek, kıyafet tonları değişken).
 * KARAR: yalnızca oyuncuya en yakın K yaya iskeletli modelle çizilir (draw call bütçesi); uzaktakiler basit figür.
 */
export interface HumanSlot {
  obj: THREE.Group;
  mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction;
  idle: THREE.AnimationAction;
  walker: number;
  moving: boolean;
}

interface Template {
  scene: THREE.Object3D;
  walk: THREE.AnimationClip;
  idle: THREE.AnimationClip;
  keep?: RegExp;
  tint?: RegExp;
}

const SHIRTS = [
  0x2f4d7a, 0x8a2e2e, 0xd8d2c4, 0x3b6b45, 0x2a2a2a, 0xc28a3a, 0x6a4c8a, 0x9aa3ad, 0x4f5f6f, 0xb85b7a,
];
const PANTS = [0x1f2a3a, 0x2b2b2b, 0x4a3f33, 0x5a6470, 0x223355, 0x6b5a45];

export class HumanPool {
  readonly group = new THREE.Group();
  slots: HumanSlot[] = [];
  ready = false;

  constructor(private readonly count: number) {
    this.group.name = 'humans';
  }

  async init(base: string, shadows: boolean): Promise<void> {
    if (this.count <= 0) return;
    const src = await xbotSource(base);
    const templates: Template[] = [];
    const make = async (url: string, keep?: RegExp, tint?: RegExp) => {
      const g = await loadGltf(url);
      // Şablon sahnesini klonla (oyuncu aynı dosyayı kullanıyor olabilir)
      const scene = cloneSkinned(g.scene);
      const sk = firstSkinned(scene);
      if (!sk) return;
      const prefix = bonePrefix(scene);
      const map = (n: string) => `mixamorig${n.slice(prefix.length)}`;
      templates.push({
        scene,
        walk: bakeRetarget(sk, src.mesh, src.clips.get('Walking')!, 'Walking', map),
        idle: bakeRetarget(sk, src.mesh, src.clips.get('Idle')!, 'Idle', map),
        keep,
        tint,
      });
    };
    await make(`${base}models/people/Michelle.glb`);
    await make(
      `${base}models/people/readyplayer.me.glb`,
      /Body|Outfit|Hair|Headwear|Footwear|Head|Eye|Beard/,
      /Outfit_(Top|Bottom)/,
    );
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < this.count; i++) {
      const t = templates[i % templates.length];
      const scene = cloneSkinned(t.scene);
      const drop: THREE.Object3D[] = [];
      scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        if (t.keep && !t.keep.test(m.name)) {
          drop.push(m);
          return;
        }
        m.castShadow = shadows;
        m.frustumCulled = false;
        if (t.tint?.test(m.name)) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          const top = /Top/.test(m.name);
          mat.color.set(
            top ? SHIRTS[Math.floor(rnd() * SHIRTS.length)] : PANTS[Math.floor(rnd() * PANTS.length)],
          );
          m.material = mat;
        }
      });
      for (const d of drop) d.removeFromParent();
      const mixer = new THREE.AnimationMixer(scene);
      const walk = mixer.clipAction(t.walk);
      const idle = mixer.clipAction(t.idle);
      walk.play();
      walk.time = rnd() * t.walk.duration;
      idle.play();
      idle.setEffectiveWeight(0);
      const holder = normalizeModel(scene, 1.62 + rnd() * 0.2);
      const obj = new THREE.Group();
      obj.add(holder);
      obj.visible = false;
      this.group.add(obj);
      this.slots.push({ obj, mixer, walk, idle, walker: -1, moving: true });
    }
    this.ready = true;
  }

  /** Yayaları en yakından başlayarak slotlara ata; atanmış yürüyüşçü dizisini döndür. */
  assign(
    walkers: { x: number; y: number; z: number; yaw: number; speed: number }[],
    moving: boolean[],
    player: THREE.Vector3,
    dt: number,
    radius = 70,
  ): Set<number> {
    const used = new Set<number>();
    if (!this.ready) return used;
    const near = walkers
      .map((w, i) => ({ i, d: Math.hypot(w.x - player.x, w.z - player.z) }))
      .filter((e) => e.d < radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.slots.length)
      .map((e) => e.i);
    const want = new Set(near);
    // Mevcut atamaları koru (animasyon zıplamasın)
    for (const s of this.slots) if (s.walker >= 0 && !want.has(s.walker)) s.walker = -1;
    const taken = new Set(this.slots.filter((s) => s.walker >= 0).map((s) => s.walker));
    for (const i of near) {
      if (taken.has(i)) continue;
      const free = this.slots.find((s) => s.walker < 0);
      if (!free) break;
      free.walker = i;
      taken.add(i);
    }
    for (const s of this.slots) {
      if (s.walker < 0) {
        s.obj.visible = false;
        continue;
      }
      const w = walkers[s.walker];
      const mv = moving[s.walker];
      used.add(s.walker);
      s.obj.visible = true;
      s.obj.position.set(w.x, w.y, w.z);
      // Yürüyüşçü yaw'ı +Z'ye göre; model tutucusu −Z'ye bakıyor
      s.obj.rotation.y = w.yaw + Math.PI;
      if (mv !== s.moving) {
        s.moving = mv;
        const from = mv ? s.idle : s.walk;
        const to = mv ? s.walk : s.idle;
        to.setEffectiveWeight(1);
        from.crossFadeTo(to, 0.3, false);
      }
      s.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(w.speed / 1.45, 0.6, 1.4));
      s.mixer.update(dt);
    }
    return used;
  }
}
