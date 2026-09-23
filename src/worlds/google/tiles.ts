import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
  ReorientationPlugin,
  TilesFadePlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
} from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { IWorld } from '../world';
import type { LatLon } from '../../core/geo';
import { TilesCollisionWorld } from './collision';
import { googleAttributionHtml } from './attribution';
import { SpawnController, type SpawnState } from './spawn';

export const GOOGLE_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';
const DEG = Math.PI / 180;

export interface GoogleWorldOptions {
  apiKey: string;
  center: LatLon;
  errorTarget: number;
  mobile: boolean;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Kalibrasyon ofseti (m): Google mesh'i ile OSM arasında fark varsa. */
  offset?: { x: number; z: number };
}

/** Mod A: Google Photorealistic 3D Tiles dünyası. */
export class GoogleWorld implements IWorld {
  readonly kind = 'google' as const;
  readonly object = new THREE.Group();
  readonly collision = new TilesCollisionWorld();
  readonly spawn = new THREE.Vector3(0, 450, 0);
  readonly tiles: TilesRenderer;
  readonly spawner: SpawnController;
  private refreshTimer = 0;
  private attrTimer = 0;
  private attrHtml = '';
  lastError: string | null = null;
  onError: (msg: string) => void = () => {};

  constructor(private readonly opts: GoogleWorldOptions) {
    this.object.name = 'google-world';
    const tiles = (this.tiles = new TilesRenderer(GOOGLE_ROOT));
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: opts.apiKey, autoRefreshToken: true }));
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    // ReorientationPlugin lat/lon'u RADYAN alır; sonuç: merkez orijinde, +Y yukarı, X batı, Z kuzey.
    tiles.registerPlugin(
      new ReorientationPlugin({ lat: opts.center.lat * DEG, lon: opts.center.lon * DEG, height: 0 }),
    );
    // GoogleCloudAuthPlugin errorTarget'ı 20 yapar; yaya gözü için kendi değerimizi kullan.
    tiles.errorTarget = opts.errorTarget;
    if (opts.mobile) {
      tiles.lruCache.minBytesSize = 0.15 * 2 ** 30;
      tiles.lruCache.maxBytesSize = 0.25 * 2 ** 30;
    } else {
      tiles.lruCache.minBytesSize = 0.4 * 2 ** 30;
      tiles.lruCache.maxBytesSize = 0.6 * 2 ** 30;
    }
    tiles.setCamera(opts.camera);
    tiles.setResolutionFromRenderer(opts.camera, opts.renderer);

    // Oyunun ENU sistemi: +X doğu, −Z kuzey → kütüphane çerçevesini Y etrafında 180° çevir.
    const holder = new THREE.Group();
    holder.name = 'enu-align';
    holder.rotation.y = Math.PI;
    holder.position.set(opts.offset?.x ?? 0, 0, opts.offset?.z ?? 0);
    holder.add(tiles.group);
    this.object.add(holder);

    tiles.addEventListener('load-model', (e) =>
      this.collision.addModel((e as unknown as { scene: THREE.Object3D }).scene),
    );
    tiles.addEventListener('dispose-model', (e) =>
      this.collision.removeModel((e as unknown as { scene: THREE.Object3D }).scene),
    );
    tiles.addEventListener('tile-visibility-change', (e) => {
      const ev = e as unknown as { scene: THREE.Object3D; visible: boolean };
      if (ev.scene) this.collision.setVisible(ev.scene, ev.visible);
    });
    tiles.addEventListener('load-error', (e) => {
      const ev = e as unknown as { error: Error; url: string | URL; tile: unknown };
      const msg = String(ev.error?.message ?? ev.error);
      console.warn('3D Tiles yükleme hatası:', msg);
      if (!ev.tile || /\b40[0-9]\b/.test(msg)) {
        this.lastError = /40[13]/.test(msg)
          ? 'Google API anahtarı geçersiz ya da Map Tiles API bu anahtar için etkin değil (HTTP 403). Anahtarı, faturalandırmayı ve referrer kısıtlamasını kontrol edin.'
          : `Google 3D Tiles yüklenemedi: ${msg}`;
        this.onError(this.lastError);
      }
    });
    this.spawner = new SpawnController(this.collision);
  }

  get spawnState(): SpawnState {
    return this.spawner.state;
  }

  get loadProgress(): number {
    return this.tiles.loadProgress;
  }

  update(camera: THREE.PerspectiveCamera, player: THREE.Vector3, dt: number): void {
    const t = this.tiles;
    camera.updateMatrixWorld();
    t.setCamera(camera);
    t.setResolutionFromRenderer(camera, this.opts.renderer);
    t.update();
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 0.25;
      this.collision.refresh(player, this.spawner.state !== 'ready');
    }
    this.attrTimer -= dt;
    if (this.attrTimer <= 0) {
      this.attrTimer = 1;
      this.attrHtml = googleAttributionHtml(t);
    }
  }

  attributionHtml(): string {
    return this.attrHtml || googleAttributionHtml(this.tiles);
  }

  stats(): Record<string, number | string> {
    return {
      visibleTiles: this.tiles.visibleTiles.size,
      collisionMeshes: this.collision.meshCount,
      progress: Math.round(this.tiles.loadProgress * 100),
      spawn: this.spawner.state,
    };
  }

  dispose(): void {
    this.tiles.dispose();
  }
}
