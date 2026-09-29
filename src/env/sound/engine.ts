import { SoundCore } from './core';
import { Footsteps } from './footsteps';
import { TrafficSound, trafficDensity } from './traffic';
import { RailSound } from './rail';
import { Nature } from './nature';
import { Ezan } from './ezan';
import { GameClock } from './clock';
import type { AudioHost } from './types';

/**
 * Manifest gelince hemen çözülen yuvalar (scripts/sounds.json ile aynı adlar). Gece/avlu/şantiye zeminleri
 * (amb_night, crickets, children, construction) ilk gerektiğinde çözülür — çözülmüş PCM belleği (~40 MB) boşa
 * tutulmasın.
 */
export const PRELOAD_SLOTS = [
  'step_asphalt',
  'step_pavers',
  'step_concrete',
  'step_grass',
  'step_soil',
  'step_gravel',
  'step_metal',
  'step_wood',
  'car_engine',
  'car_engine_diesel',
  'car_tyres',
  'car_passby',
  'car_horn',
  'moped_passby',
  'traffic_bed',
  'amb_day',
  'wind_trees',
  'bird_sparrows',
  'bird_dove',
  'bird_crow',
  'bird_magpie',
  'bird_gull',
  'bird_pigeon',
  'dog_bark',
  'household',
  'rail_roll',
  'rail_brake',
] as const;

/**
 * Gerçekçi, konumlu mahalle ses manzarası (Web Audio): dinleyici kamerayı izler, tüm kaynaklar PannerNode
 * (yakınlarda HRTF) + mesafe modeli + binalarca örtme; çevre binalarından tahmin edilen kentsel yankı.
 */
export class SoundEngine {
  readonly core: SoundCore;
  readonly steps: Footsteps;
  readonly traffic: TrafficSound;
  readonly rail: RailSound;
  readonly nature: Nature;
  readonly ezan: Ezan;
  private clock: GameClock;
  private levelsKey = '';

  constructor(ctx: AudioContext, base: string, host: AudioHost) {
    this.core = new SoundCore(ctx, base, host.settings.quality);
    this.core.geoCenter = host.geoCenter;
    this.clock = new GameClock(host.geoCenter);
    const off = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('clock') : null;
    // Hata ayıklama: ?clock=+90 → ses saatini 90 dk ileri al
    if (off && Number.isFinite(Number(off))) this.clock.offsetMin = Number(off);
    this.core.clock = this.clock.now(host.settings.timeOfDay);
    this.steps = new Footsteps(this.core);
    this.traffic = new TrafficSound(this.core);
    this.rail = new RailSound(this.core);
    this.nature = new Nature(this.core);
    this.ezan = new Ezan(this.core);
    void this.core.bank.ready.then(() => this.core.bank.preload(PRELOAD_SLOTS));
  }

  update(dt: number, host: AudioHost): void {
    const core = this.core;
    const s = host.settings;
    const key = `${s.sound}|${s.volMaster}|${s.volAmbience}|${s.volTraffic}|${s.volSteps}|${s.volEzan}`;
    if (key !== this.levelsKey) {
      this.levelsKey = key;
      core.setLevels(s.sound ? (s.volMaster ?? 0.8) : 0, {
        ambience: s.volAmbience ?? 1,
        traffic: s.volTraffic ?? 1,
        steps: s.volSteps ?? 1,
        ezan: s.volEzan ?? 1,
      });
    }
    core.clock = this.clock.now(s.timeOfDay);
    core.night = host.daylight?.night ?? 0;
    const scene = host.world?.soundScene?.() ?? null;
    core.setScene(scene);
    core.updateListener(host.camera, dt);
    const density = trafficDensity(core.clock.minutes, core.clock.weekday);
    const p = host.controller.position;
    this.steps.update(dt, host, (slot) => core.bank.has(slot));
    this.traffic.update(dt, scene, p, density);
    this.rail.update(dt, scene);
    this.nature.update(dt, scene, density);
    this.ezan.enabled = s.ezan !== false;
    this.ezan.update(scene);
  }

  /** Hata ayıklama bilgisi (?debug=1 → window.__game.audio.info()) */
  info(): Record<string, unknown> {
    const c = this.core;
    const t = this.ezan.times();
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
    return {
      files: c.bank.available ? `${c.bank.loaded} çözüldü` : 'manifest yok (prosedürel)',
      clock: `${c.clock.year}-${c.clock.month}-${c.clock.day} ${fmt(c.clock.minutes)}`,
      acoustics: `${c.acoustics.kind} enc=${c.acoustics.enclosure.toFixed(2)} w=${c.acoustics.width.toFixed(0)} rt=${c.acoustics.rt60.toFixed(2)}`,
      surface: this.steps.surface,
      trains: this.rail.count,
      ezan: `${this.ezan.status}${this.ezan.playing ? '' : this.ezan.next ? ` (sonraki ${this.ezan.next.name} ${fmt(this.ezan.next.at)})` : ''}`,
      camiler: c.scene?.mosques.length ?? 0,
      vakitler: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fmt(v)])),
    };
  }
}
