import * as THREE from 'three';
import { GameLoop } from './core/loop';
import { DesktopInput, InputState, type Action } from './core/input';
import type { Settings } from './core/settings';
import { createSky, type SkyRig } from './env/sky';
import { createLighting, type LightRig } from './env/lighting';
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

const VIEW_DIST: Record<Settings['quality'], number> = { low: 450, medium: 700, high: 1100 };

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
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
    const r = (this.renderer = new THREE.WebGLRenderer({
      antialias: settings.quality !== 'low',
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
    this.sky = createSky(this.scene);
    this.lights = createLighting(this.scene, settings.quality);
    this.applyTimeOfDay();

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

  applyTimeOfDay(): void {
    const t = this.settings.timeOfDay;
    this.sky.setTime(t);
    this.lights.setTime(t);
    const fogColor = t === 'day' ? 0xc4d3de : t === 'sunset' ? 0xd9a988 : 0x1a2230;
    const near = this.viewDistanceSafe * 0.35;
    this.scene.fog = new THREE.Fog(fogColor, near, this.viewDistanceSafe);
    this.renderer.toneMappingExposure = t === 'night' ? 0.7 : 0.9;
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
    this.camera.far = world.kind === 'google' ? 20000 : this.viewDistanceSafe * 1.1;
    this.camera.updateProjectionMatrix();
    // Sky kutusu kameraya bağlı; köşeleri far düzleminin içinde kalmalı.
    this.sky.sky.scale.setScalar(this.camera.far * 0.5);
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

  private handleAction(a: Action): void {
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
    this.follow.update(this.renderPos, dt, this.world?.collision ?? null);
    this.lights.follow(this.renderPos, this.sky.sunDir);
    this.sky.sky.position.copy(this.camera.position);
    this.world?.update(this.camera, this.renderPos, dt);
    this.hooks.onFrame?.(this, dt);
    this.renderer.render(this.scene, this.camera);

    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frameCount / this.fpsTime;
      this.frameCount = 0;
      this.fpsTime = 0;
    }
  }
}
