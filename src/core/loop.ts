/** Sabit adımlı fizik (60 Hz) + değişken render döngüsü (akümülatör). */
export const FIXED_DT = 1 / 60;
const MAX_FRAME = 0.25;

export interface LoopCallbacks {
  fixedUpdate(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class Accumulator {
  private acc = 0;
  constructor(private readonly step = FIXED_DT) {}

  /** Geçen süreyi ekler, çalıştırılması gereken sabit adım sayısını döndürür. */
  advance(dt: number): number {
    this.acc += Math.min(Math.max(dt, 0), MAX_FRAME);
    let n = 0;
    while (this.acc >= this.step - 1e-9) {
      this.acc = Math.max(0, this.acc - this.step);
      n++;
    }
    return n;
  }

  get alpha(): number {
    return this.acc / this.step;
  }
}

export class GameLoop {
  private acc = new Accumulator();
  private last = 0;
  private raf = 0;
  private running = false;
  paused = false;

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = (now - this.last) / 1000;
      this.last = now;
      if (!this.paused) {
        const n = this.acc.advance(dt);
        for (let i = 0; i < n; i++) this.cb.fixedUpdate(FIXED_DT);
      }
      this.cb.render(this.acc.alpha, this.paused ? 0 : Math.min(dt, MAX_FRAME));
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
