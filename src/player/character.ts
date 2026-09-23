import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TARGET_HEIGHT = 1.75;

type State = 'idle' | 'walk' | 'run';

/**
 * glTF karakter (RobotExpressive, CC0 — Tomás Laulhé) + AnimationMixer.
 * Model yüklenemezse basit kapsül yedeği kullanılır.
 */
export class Character {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private state: State = 'idle';
  private current: THREE.AnimationAction | null = null;
  private jumpAction: THREE.AnimationAction | null = null;
  private heading = 0;
  loaded = false;
  /** Malzemesine renk tonu verilebilen mesh'ler (NPC'ler için). */
  meshes: THREE.Mesh[] = [];

  constructor() {
    this.root.name = 'player';
    const fallback = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 1.1, 4, 12).translate(0, 0.85, 0),
      new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.6 }),
    );
    fallback.name = 'fallback';
    fallback.castShadow = true;
    this.root.add(fallback);
  }

  async load(url: string): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model, true);
      const h = box.max.y - box.min.y;
      const s = h > 0.1 && h < 100 ? TARGET_HEIGHT / h : TARGET_HEIGHT / 4.4;
      model.scale.setScalar(s);
      model.position.y = h > 0.1 && h < 100 ? -box.min.y * s : 0;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.frustumCulled = false;
          this.meshes.push(m);
        }
      });
      // Model +Z'ye bakar; oyunda yaw 0 = −Z.
      const holder = new THREE.Group();
      holder.rotation.y = Math.PI;
      holder.add(model);
      this.root.getObjectByName('fallback')?.removeFromParent();
      this.root.add(holder);

      this.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
      const jump = this.actions.get('Jump');
      if (jump) {
        jump.setLoop(THREE.LoopOnce, 1);
        jump.clampWhenFinished = false;
        this.jumpAction = jump;
      }
      this.current = this.actions.get('Idle') ?? null;
      this.current?.play();
      this.mixer.addEventListener('finished', (e) => {
        if (e.action === this.jumpAction) this.fadeTo(this.state, 0.2, true);
      });
      this.loaded = true;
    } catch (err) {
      console.warn('Karakter modeli yüklenemedi, yedek kapsül kullanılıyor.', err);
    }
  }

  private clipFor(s: State): THREE.AnimationAction | null {
    const name = s === 'idle' ? 'Idle' : s === 'walk' ? 'Walking' : 'Running';
    return this.actions.get(name) ?? null;
  }

  private fadeTo(s: State, dur: number, force = false): void {
    const next = this.clipFor(s);
    if (!next || (next === this.current && !force)) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, dur, false);
    this.current = next;
  }

  jump(): void {
    if (!this.jumpAction || !this.current) return;
    this.jumpAction.reset().setEffectiveTimeScale(1.4).play();
    this.current.crossFadeTo(this.jumpAction, 0.1, false);
    this.current = this.jumpAction;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  /** Konum/yön/animasyon güncellemesi. `speed` yatay hız (m/s). */
  update(dt: number, position: THREE.Vector3, heading: number, speed: number, onGround: boolean): void {
    this.root.position.copy(position);
    // Yön: slerp benzeri yumuşak dönüş
    let d = heading - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * (1 - Math.exp(-15 * dt));
    this.root.rotation.y = this.heading;

    if (!this.mixer) return;
    const s: State = speed < 0.25 ? 'idle' : speed < 3.2 ? 'walk' : 'run';
    const jumping = this.current === this.jumpAction && this.jumpAction?.isRunning();
    if (s !== this.state) {
      this.state = s;
      if (!jumping) this.fadeTo(s, 0.2);
    }
    if (!jumping && onGround) {
      const walk = this.actions.get('Walking');
      const run = this.actions.get('Running');
      if (walk && s === 'walk') walk.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 1.6, 0.5, 1.8));
      if (run && s === 'run') run.setEffectiveTimeScale(THREE.MathUtils.clamp(speed / 5.5, 0.6, 1.4));
    }
    this.mixer.update(dt);
  }
}
