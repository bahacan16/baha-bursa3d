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
import { installUltraChunks, patchSkyClouds, probeUniforms, ultraState, weakGpu } from './env/ultra';
import { ReflectionProbe } from './env/probe';
import { loadHdriSky, measureSky, type HdriSky } from './env/hdrisky';
import { facadeSky } from './worlds/osm/facades';
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
/** Ultra: daha uzun görüş (pus uzakta doğal olarak kapatır) */
const ULTRA_VIEW_DIST = 6500;
const FOG: Record<Settings['quality'], [number, number]> = {
  low: [120, 650],
  medium: [500, 7000],
  high: [900, 26000],
};

/** Ortam haritası şehir silueti bandı parlaklık çarpanı (?skyline=, 0 = kapalı) */
const SKYLINE = Number(
  new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('skyline') ?? 1.4,
);
/** Ortam haritası zemin parlaklığı (?envg=) */
const ENV_GROUND = Number(
  new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('envg') ?? 4,
);
/** Pozlama deneme çarpanı (?exp=1.2) */
const EXPOSURE_TWEAK =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('exp')
    ? Number(new URLSearchParams(location.search).get('exp'))
    : 1;

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
  envScale = Number(new URLSearchParams(location.search).get('env') ?? 0.038);
  /** Fotoğraf modu: HUD gizli, serbest kamera, oyuncu donuk. */
  photoMode = false;
  private photo = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
  /** Hata ayıklama: Street View karesiyle birebir karşılaştırma için sabit kamera (heading/pitch derece, pusula). */
  debugCam: { x: number; y: number; z: number; heading: number; pitch: number; fov: number } | null = null;
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
  /** Ultra gerçekçilik paketi etkin mi (ayar + güçlü GPU; ?q=ultra zorlar). */
  readonly ultra: boolean;
  private probe: ReflectionProbe | null = null;
  /** Ultra + ?sky=hdri: fotoğraf gökyüzü (arka plan + yansıma) */
  private hdri: HdriSky | null = null;
  private time = 0;

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
    const forceUltra = new URLSearchParams(location.search).get('q') === 'ultra';
    // KARAR: Ultra kendiliğinden yalnız masaüstü + ayrık GPU'da açılır (yazılım işleyici / tümleşik GPU'da çok
    // yavaş); menüden açıkça seçilirse veya ?q=ultra ile her zaman.
    this.ultra =
      settings.ultra &&
      settings.quality === 'high' &&
      (forceUltra || !!settings.ultraExplicit || (!this.isTouch && !weakGpu(r)));
    ultraState.on = this.ultra;
    if (this.ultra) installUltraChunks();
    const maxDpr = this.isTouch ? 1.5 : settings.quality === 'high' ? 2 : 1.25;
    // Ultra: cihazın tam piksel yoğunluğu (4K/retina'da ağır — bilerek)
    if (this.ultra) r.setPixelRatio(Math.min(devicePixelRatio || 1, 3));
    else r.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr, settings.quality === 'low' ? 1 : 2));
    // KARAR: Neutral ton eşleme — ACES beyaz sıvayı griye, göğü soluk camgöbeğine çekiyordu; Street View
    // kareleriyle (ölçülmüş renkler) en yakın sonuç Neutral + ~1.5 pozlama ile alındı. ?tm=aces eskisi.
    const tm = new URLSearchParams(location.search).get('tm');
    r.toneMapping =
      tm === 'aces'
        ? THREE.ACESFilmicToneMapping
        : tm === 'agx'
          ? THREE.AgXToneMapping
          : THREE.NeutralToneMapping;
    r.toneMappingExposure = 0.9;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = settings.quality !== 'low';
    // Ultra: PCSS ham derinlik okur (karşılaştırmalı örnekleyici değil) → BasicShadowMap türü + kendi süzgecimiz
    r.shadowMap.type = this.ultra ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    r.domElement.className = 'game';
    container.appendChild(r.domElement);
    // Bağlam kaybı (GPU belleği tükenmesi / sürücü sıfırlaması) siyah ekran bırakır: açıkça günlüğe yaz; geri
    // gelince Ultra'nın zamansal tamponlarını (TAA geçmişi, pozlama) sıfırla
    r.domElement.addEventListener('webglcontextlost', () =>
      console.error('[game] WebGL bağlamı kaybedildi (GPU belleği / sürücü sıfırlaması) — ekran siyah kalır'),
    );
    r.domElement.addEventListener('webglcontextrestored', () => {
      if (this.post?.taa) this.post.taa.reset = true;
      this.post?.exposure?.snap();
    });
    if (this.isTouch) container.classList.add('is-touch');

    this.viewDistance = this.ultra ? ULTRA_VIEW_DIST : VIEW_DIST[settings.quality];
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 20000);
    this.follow = new FollowCamera(this.camera);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.sky = createSky(this.backdrop);
    this.sky.sky.scale.setScalar(50000);
    if (this.ultra) {
      // Street View kareleri çoğunlukla parçalı bulutlu yaz göğü: dünya düzleminde bulutlar (yer gölgesiyle aynı alan)
      const u = this.sky.sky.material.uniforms;
      if (patchSkyClouds(this.sky.sky.material)) {
        u.cloudCoverage.value = ultraState.cloudCover;
        u.cloudDensity.value = 0.4;
      }
    }
    this.backdropLights();
    this.lights = createLighting(this.scene, settings.quality, this.ultra);
    this.applyTimeOfDay();

    const noPost = new URLSearchParams(location.search).has('nopost');
    if (settings.quality !== 'low' && !noPost)
      this.post = new PostFX(r, this.scene, this.camera, settings.quality, this.ultra);
    if (this.ultra && !new URLSearchParams(location.search).has('noprobe'))
      this.probe = new ReflectionProbe(r, this.pmrem);
    if (this.ultra && new URLSearchParams(location.search).get('sky') === 'hdri') void this.loadHdri();
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

  private envGround: THREE.Mesh | null = null;
  private envSkyline: THREE.Mesh | null = null;
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
    // Ultra bulutları ortam haritasına girmesin (kalibrasyon bulutsuz gökle yapıldı)
    const cloud = u.cloudCoverage?.value ?? 0;
    if (u.cloudCoverage) u.cloudCoverage.value = 0;
    // Ortam haritasının alt yarısı: gök shader'ı ufkun altını mavi-camgöbeği verir → duvarlar camgöbeği
    // görünüyordu. Gerçekte alt yarım küre sıcak gri zemin (asfalt, kilit taşı, çim, cepheler) yansıtır.
    if (!this.envGround) {
      this.envGround = new THREE.Mesh(
        new THREE.CircleGeometry(90000, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ fog: false, side: THREE.DoubleSide }),
      );
      this.envGround.position.y = -40;
      this.backdrop.add(this.envGround);
    }
    (this.envGround.material as THREE.MeshBasicMaterial).color
      .setRGB(0.534, 0.553, 0.583)
      .multiplyScalar(ENV_GROUND * d.sunIntensity * (1 - d.night));
    // KARAR: şehir silueti — ufuktan ~14°'ye kadar sıcak gri bant (çevre binalar). Gök yalnız üstten görünür;
    // gölgede kalan zemin/cephe gökyüzünün mavisini değil binalardan seken nötr ışığı alır (Street View'da
    // gölgeler nötr gri; önceden belirgin mavi çıkıyordu). ?skyline=0 kapatır.
    if (!this.envSkyline && SKYLINE > 0) {
      this.envSkyline = new THREE.Mesh(
        new THREE.CylinderGeometry(50000, 50000, 12500, 48, 1, true).translate(0, 12500 / 2 - 40, 0),
        new THREE.MeshBasicMaterial({ fog: false, side: THREE.DoubleSide }),
      );
      this.backdrop.add(this.envSkyline);
    }
    if (this.envSkyline) {
      (this.envSkyline.material as THREE.MeshBasicMaterial).color
        .setRGB(0.57, 0.582, 0.605)
        .multiplyScalar(SKYLINE * ENV_GROUND * d.sunIntensity * (1 - d.night) + 0.02);
      this.envSkyline.visible = true;
    }
    this.envGround.visible = true;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.backdrop, 0, 1, 100000);
    this.envGround.visible = false;
    if (this.envSkyline) this.envSkyline.visible = false;
    if (u.showSunDisc) u.showSunDisc.value = disc;
    if (u.cloudCoverage) u.cloudCoverage.value = cloud;
    old?.dispose();
    if (far) far.visible = farVis;
    this.sky.stars.visible = stars;
    this.scene.environment = this.envRT.texture;
    // Sky shader'ı HDR (çok parlak) üretir: ortam katkısı düşük ölçekli
    this.scene.environmentIntensity = this.envScale * (1 - d.night * 0.7);
    if (!probeUniforms.uProbeReady.value) {
      probeUniforms.uProbe.value = this.envRT.texture;
      probeUniforms.uProbeI.value = this.scene.environmentIntensity;
    }
    // KARAR: Street View kalibrasyonu (71 yama, 11 görüş): ortam ışığı güneşe göre ~2× fazlaydı → soluk/pastel
    this.lights.hemi.intensity = d.hemiIntensity * 0.6;
  }

  private async loadHdri(): Promise<void> {
    const h = await loadHdriSky(`${import.meta.env.BASE_URL}textures/sky/sky.hdr`);
    if (!h) return;
    this.hdri = h;
    this.backdrop.add(h.mesh);
    // HDRI bulutlarıyla eşleşmeyen prosedürel bulut gölgesi kapalı
    const u = this.sky.sky.material.uniforms;
    if (u.cloudCoverage) u.cloudCoverage.value = 0;
    this.alignHdri();
  }

  private alignHdri(): void {
    const h = this.hdri;
    const d = this.daylight;
    if (!h || !d) return;
    const hide = [h.mesh, this.backdrop.getObjectByName('backdrop-object'), this.sky.stars].filter(
      (o): o is THREE.Object3D => !!o,
    );
    const vis = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const sv = this.sky.sky.visible;
    this.sky.sky.visible = true;
    this.sky.sky.position.set(0, 0, 0);
    h.align(d.azimuth, (dirs) => measureSky(this.renderer, this.backdrop, dirs, new THREE.Vector3()));
    this.sky.sky.visible = sv;
    hide.forEach((o, i) => (o.visible = vis[i]));
    h.mesh.visible = d.night < 0.3;
  }

  applyTimeOfDay(): void {
    const d = (this.daylight = daylight(this.settings.timeOfDay, this.geoCenter));
    this.sky.apply(d);
    this.lights.apply(d);
    nightUniform.value = d.night;
    // Mod A'da şehir uzakta da görünsün (tile'lar kendi LOD'unu yönetir).
    // Ultra: Fog near/far = pus sönüm katsayısı / ölçek yüksekliği (ultra.ts fog parçaları)
    const [near, far] = this.ultra
      ? [ultraState.hazeDensity, ultraState.hazeHeight]
      : this.world?.kind === 'google'
        ? [1500, 26000]
        : FOG[this.settings.quality];
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
    this.renderer.toneMappingExposure = d.exposure * EXPOSURE_TWEAK;
    this.post?.setNight(d.night);
    facadeSky.top.value.copy(d.hemiSky).multiplyScalar(0.8);
    facadeSky.horizon.value.copy(d.fogColor);
    facadeSky.ground.value.copy(d.hemiGround);
    if (this.hdri) this.hdri.mesh.visible = false;
    this.updateEnvironment(d);
    this.alignHdri();
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
    this.camera.far =
      world.kind === 'google' ? 20000 : Math.min(this.ultra ? 8000 : 5000, this.viewDistanceSafe * 1.1);
    this.camera.updateProjectionMatrix();
    this.applyTimeOfDay();
    if (this.ultra) this.maxAnisotropy(world.object);
    this.teleport(world.spawn.x, world.spawn.y, world.spawn.z);
  }

  /** Ultra: tüm dokularda donanımın en yüksek anizotropik süzgeci (yere eğik bakışta keskin kaldırım/asfalt). */
  private maxAnisotropy(root: THREE.Object3D): void {
    const max = this.renderer.capabilities.getMaxAnisotropy();
    const seen = new Set<THREE.Texture>();
    root.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        for (const v of Object.values(m as unknown as Record<string, unknown>)) {
          if (!(v instanceof THREE.Texture) || seen.has(v)) continue;
          seen.add(v);
          if (v.anisotropy < max) {
            v.anisotropy = max;
            if (v.version > 0) v.needsUpdate = true;
          }
        }
      }
    });
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

  /** Hata ayıklama (?debug=1): n kareyi eşzamanlı çiz (yavaş işleyicide karşılaştırma görüntüsü; TAA birikimi). */
  debugRender(n: number, dt = 1 / 30): void {
    if (!this.debug) return;
    for (let i = 0; i < n; i++) this.render(1, dt);
  }

  /** Ultra kare başı: bulut saati (gökyüzü + yer gölgesi aynı zaman), yansıma küresinin bir yüzü. */
  private ultraFrame(dt: number): void {
    this.time += dt;
    const u = this.sky.sky.material.uniforms;
    if (u.time) u.time.value = this.time;
    const night = this.daylight?.night ?? 0;
    const clock = this.lights.sun.userData.ultraClock as { t: number; cover: number } | undefined;
    if (clock) {
      clock.t = this.time;
      clock.cover = u.cloudCoverage ? u.cloudCoverage.value * (1 - night) : 0;
    }
    if (this.probe && night < 0.5) {
      const at = this.renderPos.clone();
      at.y += 1.7;
      if (this.debugCam) at.copy(this.camera.position);
      this.probe.update(this.scene, this.backdrop, at, [this.character.root]);
    }
  }

  private render(alpha: number, dt: number): void {
    const c = this.controller;
    this.renderPos.lerpVectors(c.prevPosition, c.position, alpha);
    this.character.update(dt, this.renderPos, c.heading, c.horizontalSpeed, c.onGround);
    if (this.debugCam) this.character.root.visible = false;
    if (this.debugCam) {
      const d = this.debugCam;
      const h = (d.heading * Math.PI) / 180;
      const p = (d.pitch * Math.PI) / 180;
      this.camera.position.set(d.x, d.y, d.z);
      this.camera.lookAt(d.x + Math.sin(h) * Math.cos(p), d.y + Math.sin(p), d.z - Math.cos(h) * Math.cos(p));
      if (this.camera.fov !== d.fov) {
        this.camera.fov = d.fov;
        this.camera.updateProjectionMatrix();
      }
    } else if (this.photoMode) {
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
    const hdriOn = !!this.hdri?.mesh.visible;
    const skyVis = this.sky.sky.visible;
    if (hdriOn) {
      this.hdri!.mesh.position.copy(bc.position);
      this.sky.sky.visible = false;
    }
    if (this.ultra) this.ultraFrame(dt);
    const taa = this.post?.taa ?? null;
    if (taa) {
      const sz = r.getDrawingBufferSize(new THREE.Vector2());
      this.camera.updateMatrixWorld();
      taa.jitter(sz.x, sz.y, [bc]);
    }
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
    taa?.unjitter([bc]);
    if (hdriOn) this.sky.sky.visible = skyVis;
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
