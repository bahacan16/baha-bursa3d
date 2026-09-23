import type * as THREE from 'three';
import type { ICollisionWorld } from '../player/colliders';

/** Oyun dünyası (Mod A / Mod B / test kutuları) ortak arayüzü. */
export interface IWorld {
  readonly kind: 'osm' | 'google' | 'boxes';
  readonly object: THREE.Object3D;
  readonly collision: ICollisionWorld;
  /** Oyuncunun doğacağı nokta (ayak). */
  readonly spawn: THREE.Vector3;
  /** Her render karesinde (kamera güncellendikten sonra). */
  update(camera: THREE.PerspectiveCamera, player: THREE.Vector3, dt: number): void;
  /** Oyuncu nerede? Spawn için zemin hazır mı? (Mod A tile yüklenmesi) */
  isGroundReady?(x: number, z: number): boolean;
  /** Işınlanma: verilen noktaya en yakın boş (bina dışı) nokta. */
  findFreeSpot?(x: number, z: number): { x: number; z: number };
  /** Ses için: ayak altındaki zemin ve en yakın araç mesafesi. */
  audioInfo?(x: number, z: number): { surface: 'hard' | 'soft' | 'gravel'; nearestCar: number };
  /** Ekrandaki atıf metni (HTML). */
  attributionHtml(): string;
  /** debug göstergeleri için */
  stats?(): Record<string, number | string>;
  dispose(): void;
}
