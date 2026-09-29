/**
 * Oyun sesi (Web Audio): gerçek kayıtlarla konumlu mahalle ses manzarası — `src/env/sound/`.
 * Kayıtlar `public/sounds/` (Actions: .github/workflows/fetch-sounds.yml, scripts/sounds.json) yoksa eski
 * prosedürel sese düşer. Tarayıcı kuralı gereği ilk kullanıcı etkileşiminde başlar; sekme gizlenince durur.
 */
import { SoundEngine } from './sound/engine';
import type { AudioHost } from './sound/types';

export type { AudioHost, SoundScene, SoundCar } from './sound/types';
export type { FootSurface } from './sound/surfaces';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private engine: SoundEngine | null = null;
  enabled = true;

  constructor() {
    if (typeof window === 'undefined') return;
    const start = () => {
      this.init();
      if (this.ctx && this.enabled && this.ctx.state !== 'running') void this.ctx.resume();
      if (this.ctx?.state === 'running' || !this.enabled) {
        removeEventListener('pointerdown', start);
        removeEventListener('keydown', start);
        removeEventListener('touchend', start);
      }
    };
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
    addEventListener('touchend', start);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled) void this.ctx.resume();
    });
  }

  private init(): void {
    if (this.ctx) return;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      this.ctx = new AC();
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    const ctx = this.ctx;
    if (!ctx) return;
    if (v) {
      if (!document.hidden) void ctx.resume();
    } else
      setTimeout(() => {
        if (!this.enabled) void ctx.suspend();
      }, 400);
  }

  /** Her render karesinde: oyun kendini (AudioHost) verir. */
  update(dt: number, host: AudioHost): void {
    if (host.settings.sound !== this.enabled) this.setEnabled(host.settings.sound);
    if (!this.ctx) return;
    if (!this.engine) {
      try {
        this.engine = new SoundEngine(this.ctx, import.meta.env?.BASE_URL ?? './', host);
      } catch (e) {
        console.warn('Ses motoru başlatılamadı', e);
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state !== 'running') return;
    this.engine.update(Math.min(0.1, dt), host);
  }

  /** Hata ayıklama: `__game.audio.info()` */
  info(): Record<string, unknown> {
    return this.engine?.info() ?? { durum: this.ctx ? 'başlatılıyor' : 'ilk dokunuş bekleniyor' };
  }

  /** Hata ayıklama: hemen bir Bursaray geçişi */
  debugTrain(): void {
    this.engine?.rail.spawnNow();
  }
}
