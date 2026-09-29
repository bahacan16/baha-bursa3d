import type * as THREE from 'three';
import type { Settings } from '../../core/settings';
import type { FootSurface } from './surfaces';

export type XZ = readonly [number, number];

/** Trafikteki araç (sim/traffic.ts), ses için anlık durum. */
export interface SoundCar {
  /** Kalıcı kimlik (ses sesi atamasında histerezis için). */
  id: number;
  x: number;
  y: number;
  z: number;
  /** Yön: ileri = (sin yaw, cos yaw) */
  yaw: number;
  /** m/s */
  speed: number;
  /** 0 sedan, 1 hatchback, 2 SUV, 3 hafif ticari (carmodel.ts CAR_KINDS sırası) */
  kind: number;
}

export interface SoundBuilding {
  ring: readonly XZ[];
  /** Taban ve üst kot (m, dünya). */
  base: number;
  top: number;
}

export interface SoundRoad {
  kind: string;
  name?: string;
  pts: readonly XZ[];
  width: number;
  vehicular: boolean;
}

export interface SoundRail {
  kind: string;
  name?: string;
  pts: readonly XZ[];
  tunnel: boolean;
  bridge: boolean;
}

export interface SoundPoint {
  id: string;
  x: number;
  z: number;
  name?: string;
}

export type SoundPlaceKind = 'playground' | 'courtyard' | 'park' | 'pitch' | 'construction' | 'green';

export interface SoundPlace {
  kind: SoundPlaceKind;
  x: number;
  z: number;
  /** Yaklaşık yarıçap (m) */
  r: number;
  name?: string;
}

/**
 * Dünyanın sese verdiği bilgi (IWorld.soundScene). Durağan kısımlar bir kez okunur; `cars()` her karede.
 */
export interface SoundScene {
  /** Ayak altındaki zemin. */
  surfaceAt(x: number, z: number): FootSurface;
  /** Zemin kotu (arazi). */
  groundY(x: number, z: number): number;
  readonly buildings: readonly SoundBuilding[];
  readonly roads: readonly SoundRoad[];
  readonly rails: readonly SoundRail[];
  readonly stations: readonly SoundPoint[];
  /** Camiler (OSM building=mosque / amenity=place_of_worship), ağırlık merkezi. */
  readonly mosques: readonly SoundPoint[];
  /** Ağaç konumları x,z çiftleri. */
  readonly trees: Float32Array;
  readonly places: readonly SoundPlace[];
  /** Hareketli araçlar (her karede). */
  cars(): readonly SoundCar[];
}

export type AudioSettings = Pick<
  Settings,
  | 'sound'
  | 'timeOfDay'
  | 'volMaster'
  | 'volAmbience'
  | 'volTraffic'
  | 'volSteps'
  | 'volEzan'
  | 'ezan'
  | 'quality'
>;

/**
 * Oyunun sese açtığı küçük arayüz (Game bunu yapısal olarak karşılar; `audio.update(dt, this)`).
 * Dinleyici kameradır; ayak sesleri karakter iskeletinden (3. şahıs) ya da kamera adım evresinden (1. şahıs).
 */
export interface AudioHost {
  readonly camera: THREE.Camera;
  readonly controller: {
    readonly position: THREE.Vector3;
    readonly velocity: THREE.Vector3;
    readonly onGround: boolean;
    readonly frozen: boolean;
    readonly heading: number;
  };
  readonly character: { readonly root: THREE.Object3D };
  readonly follow: { readonly firstPerson: boolean; readonly step?: number };
  readonly world: { soundScene?(): SoundScene | null } | null;
  readonly daylight: { readonly night: number } | null;
  readonly settings: AudioSettings;
  readonly geoCenter: { readonly lat: number; readonly lon: number };
  readonly photoMode: boolean;
}

export type Category = 'ambience' | 'traffic' | 'steps' | 'ezan';
