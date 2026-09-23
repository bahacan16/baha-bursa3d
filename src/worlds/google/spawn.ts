import type { CharacterController } from '../../player/controller';

export type SpawnState = 'waiting' | 'settling' | 'ready' | 'nocoverage';

/** Spawn/dondurma mantığı için gereken en küçük arayüz (test için mock'lanabilir). */
export interface GroundProbe {
  probe(x: number, z: number, fromY?: number): number | null;
}

const SETTLE_TIME = 2.5;
const COVERAGE_TIMEOUT = 45;

/**
 * Spawn: oyuncu merkezin yüksek üstünde, fizik dondurulmuş başlar.
 * 1) Aşağı tarama isabet edince zemine yakın konuma iner (hâlâ donuk) — yakın tile'lar incelsin.
 * 2) Kısa süre sonra yeniden tarar ve fiziği açar.
 * Uzun süre isabet yoksa "kapsam yok" durumuna geçer.
 */
export class SpawnController {
  state: SpawnState = 'waiting';
  private t = 0;
  private settleT = 0;
  x = 0;
  z = 0;

  constructor(private readonly probeSrc: GroundProbe) {}

  reset(x: number, z: number): void {
    this.state = 'waiting';
    this.x = x;
    this.z = z;
    this.t = 0;
    this.settleT = 0;
  }

  /** Her karede çağrılır. `idle`: bekleyen tile indirmesi yok. */
  update(dt: number, ctl: CharacterController, idle: boolean): SpawnState {
    this.t += dt;
    if (this.state === 'ready' || this.state === 'nocoverage') return this.state;
    ctl.hold = true;
    const y = this.probeSrc.probe(this.x, this.z);
    if (this.state === 'waiting') {
      if (y !== null) {
        ctl.teleport(this.x, y + 0.5, this.z);
        this.state = 'settling';
        this.settleT = 0;
      } else if (this.t > COVERAGE_TIMEOUT && idle) {
        this.state = 'nocoverage';
      }
    } else if (this.state === 'settling') {
      this.settleT += dt;
      if (y !== null && this.settleT > SETTLE_TIME && idle) {
        ctl.teleport(this.x, y + 0.05, this.z);
        ctl.hold = false;
        this.state = 'ready';
      } else if (y === null && this.settleT > SETTLE_TIME * 4) {
        this.state = 'waiting';
      }
    }
    return this.state;
  }
}
