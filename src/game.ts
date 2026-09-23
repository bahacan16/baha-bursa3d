import * as THREE from 'three';
import { GameLoop } from './core/loop';
import { DesktopInput, InputState, type Action } from './core/input';
import type { Settings } from './core/settings';
import { createSky, type SkyRig } from './env/sky';
import { createLighting, type LightRig } from './env/lighting';
import { daylight, type Daylight } from './env/daylight';
import { nightUniform } from './env/night';
import { GameAudio } from './env/audio';
import { PostFX } from './env/post';
import { CharacterController } from './player/controller';
import { Character } from './player/character';
import { FollowCamera } from './player/camera';
import { TouchControls, isTouchDevice } from './hud/touch';
import type { IWorld } from './worlds/world';

export interface GameHooks {
  /** Her render karesinde HUD güncellemesi. */
  onFrame?(game: Game, dt: number): void;
  onAction?(game: Game, a: Action): boolean | void;
}

// Görüş mesafesi (chunk kırpma) ve sis — ana sahne ile arka plan (uzak arazi) aynı sisi kullanır, geçiş dikişsiz olur.
// KARAR: Düşük kalitede yoğun sis + kısa görüş (mobil), yüksekte uzak Uludağ silüeti görünür.
const VIEW_DIST: Record<Settings['quality'], number> = { low: 650, medium: 2000, high: 4000 };
const FOG: Record<Settings['quality'], [number, number]> = {
  low: [120, 650],
  medium: [500, 7000],
  high: [900, 26000],
};

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Gökyüzü + uzak arazi (uzun menzilli kamera ile önce çizilir). */
  readonly backdrop = new THREE.Scene();
  readonly backdropCamera = new THREE.PerspectiveCamera(62, 1, 20, 120000);
  readonly camera: THREE.PerspectiveCamera;
  readonly input = new InputState();
  readonly desktop: DesktopInput;
  readonly touch: TouchControls | null;
  readonly controller: CharacterController;
  readonly character = new Character();
  readonly follow: FollowCamera;
  readonly sky: SkyRig;
  readonly lights: LightRig;
  readonly loop: GameLoop;
  readonly audio = new GameAudio();
  /** Son işleme (Düşük kalitede yok; ?nopost=1 ile kapatılabilir). */
  post: PostFX | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  envScale = Number(new URLSearchParams(location.search).get('env') ?? 0.06);
  /** Fotoğraf modu: HUD gizli, serbest kamera, oyuncu donuk. */
  photoMode = false;
  private photo = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  private pendingShot = false;
  onPhotoChange: (on: boolean) => void = () => {};
  world: IWorld | null = null;
  hooks: GameHooks = {};
  /** HUD/menü açıkken oyuncu girdisi kapalı. */
  private blocked = 0;
  private renderPos = new THREE.Vector3();
  private frameCount = 0;
  private fpsTime = 0;
  fps = 0;
  readonly isTouch: boolean;
  readonly debug = new URLSearchParams(location.search).has('debug');
  readonly viewDistance: number;

  constructor(
    readonly container: HTMLElement,
    readonly settings: Settings,
  ) {
    this.isTouch = isTouchDevice();
    this.audio.setEnabled(settings.sound);
    const r = (this.renderer = new THREE.WebGLRenderer({
      // Son işleme açıkken MSAA yerine SMAA kullanılır
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: new URLSearchParams(location.search).has('debug'),
    }));
    const maxDpr = this.isTouch ? 1.5 : settings.quality === 'high' ? 2 : 1.25;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr, settings.quality === 'low' ? 1 : 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = settings.quality !== 'low';
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.className = 'game';
    container.appendChild(r.domElement);
    if (this.isTouch) container.classList.add('is-touch');

    this.viewDistance = VIEW_DIST[settings.quality];
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 20000);
    this.follow = new FollowCamera(this.camera);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.sky = createSky(this.backdrop);
    this.sky.sky.scale.setScalar(50000);
    this.backdropLights();
    this.lights = createLighting(this.scene, settings.quality);
    this.applyTimeOfDay();

    const noPost = new URLSearchParams(location.search).has('nopost');
    if (settings.quality !== 'low' && !noPost)
      this.post = new PostFX(r, this.scene, this.camera, settings.quality);
    this.desktop = new DesktopInput(this.input, r.domElement);
    this.touch = this.isTouch ? new TouchControls(container, this.input) : null;

    this.controller = new CharacterController(
      { moveHorizontal: () => {}, groundHeight: () => 0, raycast: () => null },
      { walkSpeed: settings.walkSpeed, runSpeed: settings.runSpeed },
    );
    this.scene.add(this.character.root);

    this.input.onAction((a) => this.handleAction(a));
    this.loop = new GameLoop({
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, dt) => this.render(alpha, dt),
    });

    this.resize();
    addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  private backdropSun = new THREE.DirectionalLight(0xffffff, 2);
  private backdropHemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5448, 1);

  private backdropLights(): void {
    this.backdrop.add(this.backdropSun, this.backdropHemi);
  }

  /** Uzak arka plan nesnesi (ör. Uludağ silüeti). */
  setBackdropObject(o: THREE.Object3D | null): void {
    const old = this.backdrop.getObjectByName('backdrop-object');
    if (old) this.backdrop.remove(old);
    if (o) {
      o.name = 'backdrop-object';
      this.backdrop.add(o);
    }
  }

  /** Coğrafi merkez (gerçek saat modunda güneş konumu için). */
  geoCenter = { lat: 40.2180548, lon: 28.9073262 };
  daylight: Daylight | null = null;
  private daylightTimer = 0;

  /**
   * Gökyüzünden ortam haritası (PMREM): cam/araç yansımaları ve yumuşak ortam ışığı.
   * KARAR: Yarım küre ışığı ortam haritasıyla birlikte azaltılır (çift ortam ışığı olmasın).
   */
  private updateEnvironment(d: Daylight): void {
    if (this.settings.quality === 'low') return;
    const stars = this.sky.stars.visible;
    this.sky.stars.visible = false;
    this.sky.sky.position.set(0, 0, 0);
    const far = this.backdrop.getObjectByName('backdrop-object');
    const farVis = far?.visible ?? false;
    if (far) far.visible = false;
    const u = this.sky.sky.material.uniforms;
    const disc = u.showSunDisc?.value ?? 1;
    if (u.showSunDisc) u.showSunDisc.value = 0; // güneş diski ortam haritasını patlatır
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.backdrop, 0, 1, 100000);
    if (u.showSunDisc) u.showSunDisc.value = disc;
    old?.dispose();
    if (far) far.visible = farVis;
    this.sky.stars.visible = stars;
    this.scene.environment = this.envRT.texture;
    // Sky shader'ı HDR (çok parlak) üretir: ortam katkısı düşük ölçekli
    this.scene.environmentIntensity = this.envScale * (1 - d.night * 0.7);
    this.lights.hemi.intensity = d.hemiIntensity * 0.75;
  }

  applyTimeOfDay(): void {
    const d = (this.daylight = daylight(this.settings.timeOfDay, this.geoCenter));
    this.sky.apply(d);
    this.lights.apply(d);
    nightUniform.value = d.night;
    // Mod A'da şehir uzakta da görünsün (tile'lar kendi LOD'unu yönetir).
    const [near, far] = this.world?.kind === 'google' ? [1500, 26000] : FOG[this.settings.quality];
    if (!(this.scene.fog instanceof THREE.Fog)) this.scene.fog = new THREE.Fog(d.fogColor, near, far);
    if (!(this.backdrop.fog instanceof THREE.Fog)) this.backdrop.fog = new THREE.Fog(d.fogColor, near, far);
    for (const f of [this.scene.fog, this.backdrop.fog] as THREE.Fog[]) {
      f.color.copy(d.fogColor);
      f.near = near;
      f.far = far;
    }
    this.backdropSun.position.copy(d.lightDir).multiplyScalar(1000);
    this.backdropSun.intensity = d.sunIntensity * 0.8;
    this.backdropSun.color.copy(d.sunColor);
    this.backdropHemi.intensity = d.hemiIntensity;
    this.backdropHemi.color.copy(d.hemiSky);
    this.renderer.toneMappingExposure = d.exposure;
    this.post?.setNight(d.night);
    this.updateEnvironment(d);
    // Gece gökyüzü rengi (Sky shader'ı gizlendiğinde görünür)
    this.renderer.setClearColor(0x0a1224);
  }

  private get viewDistanceSafe(): number {
    return this.viewDistance ?? 700;
  }

  resize(): void {
    const vv = window.visualViewport;
    const w = Math.round(vv?.width ?? innerWidth);
    const h = Math.round(vv?.height ?? innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.backdropCamera.aspect = this.camera.aspect;
    this.backdropCamera.updateProjectionMatrix();
    this.post?.setSize(w, h);
  }

  setWorld(world: IWorld): void {
    if (this.world) {
      this.scene.remove(this.world.object);
      this.world.dispose();
    }
    this.world = world;
    this.scene.add(world.object);
    this.controller.world = world.collision;
    // Google modunda gökyüzü/sis mesafesi daha geniş olabilir; Mod B'de görüş mesafesi sisle sınırlı.
    this.camera.far = world.kind === 'google' ? 20000 : Math.min(5000, this.viewDistanceSafe * 1.1);
    this.camera.updateProjectionMatrix();
    this.applyTimeOfDay();
    this.teleport(world.spawn.x, world.spawn.y, world.spawn.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.controller.teleport(x, y, z);
    this.renderPos.set(x, y, z);
    this.follow.snap();
  }

  /** HUD menüsü açılınca oyuncu girdisini kilitle. */
  block(on: boolean): void {
    this.blocked = Math.max(0, this.blocked + (on ? 1 : -1));
    const en = this.blocked === 0;
    this.desktop.setEnabled(en);
    if (this.touch) this.touch.enabled = en;
    if (!en) this.input.reset();
  }

  get inputBlocked(): boolean {
    return this.blocked > 0;
  }

  setPhotoMode(on: boolean): void {
    if (on === this.photoMode) return;
    this.photoMode = on;
    this.controller.hold = on;
    if (on) {
      this.photo.pos.copy(this.camera.position);
      this.photo.yaw = this.follow.yaw;
      this.photo.pitch = this.follow.pitch;
    } else this.follow.snap();
    this.onPhotoChange(on);
  }

  /** Bir sonraki karede ekran görüntüsünü PNG olarak indir. */
  takeScreenshot(): void {
    this.pendingShot = true;
  }

  private handleAction(a: Action): void {
    if (a === 'photo' && !this.inputBlocked) {
      this.setPhotoMode(!this.photoMode);
      return;
    }
    if (this.photoMode) {
      if (a === 'pause' || a === 'camera') this.setPhotoMode(false);
      else if (a === 'shot' || a === 'jump') this.takeScreenshot();
      return;
    }
    if (a === 'shot') return;
    if (this.hooks.onAction?.(this, a)) return;
    if (this.inputBlocked) return;
    if (a === 'camera') {
      this.follow.toggleMode();
      this.character.setVisible(!this.follow.firstPerson);
    } else if (a === 'ghost') {
      this.controller.ghostStep();
    }
  }

  start(): void {
    this.loop.start();
  }

  private fixedUpdate(dt: number): void {
    if (this.photoMode) {
      const look = this.input.takeLook();
      const ph = this.photo;
      ph.yaw -= look.dx * 0.0025;
      ph.pitch = THREE.MathUtils.clamp(ph.pitch - look.dy * 0.0025, -1.5, 1.5);
      const m = this.input.move;
      const sp = (this.input.running ? 25 : 6) * dt;
      const cp = Math.cos(ph.pitch);
      const fx = -Math.sin(ph.yaw) * cp;
      const fy = Math.sin(ph.pitch);
      const fz = -Math.cos(ph.yaw) * cp;
      const rx = Math.cos(ph.yaw);
      const rz = -Math.sin(ph.yaw);
      ph.pos.x += (fx * m.y + rx * m.x) * sp;
      ph.pos.y += (fy * m.y + this.input.vertical) * sp;
      ph.pos.z += (fz * m.y + rz * m.x) * sp;
      const g = this.world?.collision.groundHeight(ph.pos.x, ph.pos.z, ph.pos.y) ?? 0;
      if (g !== null && ph.pos.y < g + 0.3) ph.pos.y = g + 0.3;
      this.input.consume('jump');
      return;
    }
    const look = this.input.takeLook();
    if (!this.inputBlocked) this.follow.look(look.dx, look.dy);
    const m = this.inputBlocked ? { x: 0, y: 0 } : this.input.move;
    const jump = this.input.consume('jump');
    this.controller.update(dt, {
      moveX: m.x,
      moveY: m.y,
      run: this.input.running && !this.inputBlocked,
      jump: jump && !this.inputBlocked,
      cameraYaw: this.follow.yaw,
    });
    if (this.controller.jumpedThisStep) this.character.jump();
  }

  private render(alpha: number, dt: number): void {
    const c = this.controller;
    this.renderPos.lerpVectors(c.prevPosition, c.position, alpha);
    this.character.update(dt, this.renderPos, c.heading, c.horizontalSpeed, c.onGround);
    if (this.photoMode) {
      const ph = this.photo;
      const cp = Math.cos(ph.pitch);
      this.camera.position.copy(ph.pos);
      this.camera.lookAt(
        ph.pos.x - Math.sin(ph.yaw) * cp,
        ph.pos.y + Math.sin(ph.pitch),
        ph.pos.z - Math.cos(ph.yaw) * cp,
      );
    } else this.follow.update(this.renderPos, dt, this.world?.collision ?? null);
    this.lights.follow(this.renderPos, this.daylight?.lightDir ?? this.sky.sunDir);
    if (this.settings.timeOfDay === 'real') {
      this.daylightTimer -= dt;
      if (this.daylightTimer <= 0) {
        this.daylightTimer = 20;
        this.applyTimeOfDay();
      }
    }
    this.world?.update(this.camera, this.renderPos, dt);
    this.hooks.onFrame?.(this, dt);
    const ai = this.world?.audioInfo?.(this.renderPos.x, this.renderPos.z) ?? {
      surface: 'hard' as const,
      nearestCar: Infinity,
    };
    this.audio.update(
      dt,
      c.horizontalSpeed,
      c.onGround && !c.frozen,
      ai.surface,
      ai.nearestCar,
      this.daylight?.night ?? 0,
    );
    // Arka plan: aynı konum/yön, uzun menzil
    const bc = this.backdropCamera;
    bc.position.copy(this.camera.position);
    bc.quaternion.copy(this.camera.quaternion);
    bc.fov = this.camera.fov;
    bc.updateProjectionMatrix();
    this.sky.sky.position.copy(bc.position);
    this.sky.stars.position.copy(bc.position);
    const r = this.renderer;
    r.autoClear = false;
    r.info.autoReset = false;
    r.info.reset();
    if (this.post) r.setRenderTarget(this.post.target);
    r.clear();
    r.render(this.backdrop, bc);
    r.clearDepth();
    r.render(this.scene, this.camera);
    if (this.post) {
      r.setRenderTarget(null);
      this.post.render(dt);
    }
    if (this.pendingShot) {
      this.pendingShot = false;
      // Aynı karede (çizim tamponu temizlenmeden) al
      r.domElement.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `nilufer-walk-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }, 'image/png');
    }

    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frameCount / this.fpsTime;
      this.frameCount = 0;
      this.fpsTime = 0;
    }
  }
}
