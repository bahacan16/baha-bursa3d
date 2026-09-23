import type { InputState } from '../core/input';

const STICK_RADIUS = 56;
const LONG_PRESS_MS = 550;

/** Kütüphanesiz dokunmatik kontroller: sol yarı dinamik joystick, sağ yarı kamera, butonlar. */
export class TouchControls {
  readonly el: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private origin = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };
  private runBtn: HTMLButtonElement;
  enabled = true;

  constructor(
    parent: HTMLElement,
    private readonly input: InputState,
  ) {
    const el = (this.el = document.createElement('div'));
    el.className = 'touch-layer';
    el.innerHTML = `
      <div class="joystick idle" data-testid="joystick"><div class="knob"></div></div>
      <div class="touch-buttons">
        <button class="tbtn tbtn-jump" data-act="jump" aria-label="Zıpla (uzun bas: hayalet adım)">Zıpla</button>
        <button class="tbtn tbtn-run" data-act="run" aria-label="Koş">Koş</button>
        <button class="tbtn" data-act="camera" aria-label="Kamera">Kam</button>
        <button class="tbtn" data-act="map" aria-label="Harita">Harita</button>
      </div>`;
    parent.appendChild(el);
    this.base = el.querySelector('.joystick')!;
    this.knob = el.querySelector('.knob')!;
    this.runBtn = el.querySelector('.tbtn-run')!;

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    for (const b of el.querySelectorAll<HTMLButtonElement>('.tbtn')) {
      const act = b.dataset.act!;
      let timer = 0;
      let long = false;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        b.classList.add('pressed');
        if (act === 'jump') {
          long = false;
          timer = window.setTimeout(() => {
            long = true;
            this.input.push('ghost');
          }, LONG_PRESS_MS);
        }
      });
      const release = (e: PointerEvent, fire: boolean) => {
        e.stopPropagation();
        b.classList.remove('pressed');
        if (!fire) {
          clearTimeout(timer);
          return;
        }
        if (act === 'jump') {
          clearTimeout(timer);
          if (!long) this.input.push('jump');
        } else if (act === 'run') {
          this.input.runToggle = !this.input.runToggle;
          this.runBtn.classList.toggle('on', this.input.runToggle);
        } else if (act === 'camera') this.input.push('camera');
        else if (act === 'map') this.input.push('map');
      };
      b.addEventListener('pointerup', (e) => release(e, true));
      b.addEventListener('pointercancel', (e) => release(e, false));
    }
    this.resetStick();
  }

  private down(e: PointerEvent): void {
    if (!this.enabled) return;
    const w = this.el.clientWidth || innerWidth;
    if (e.clientX < w / 2 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.classList.remove('idle');
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* yoksay */
    }
    e.preventDefault();
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.origin.x;
      let dy = e.clientY - this.origin.y;
      const l = Math.hypot(dx, dy);
      if (l > STICK_RADIUS) {
        dx *= STICK_RADIUS / l;
        dy *= STICK_RADIUS / l;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.input.stickMove.x = dx / STICK_RADIUS;
      this.input.stickMove.y = -dy / STICK_RADIUS;
    } else if (e.pointerId === this.lookId) {
      // Dokunmatikte bakış hassasiyeti biraz daha yüksek.
      this.input.lookDX += (e.clientX - this.lastLook.x) * 1.6;
      this.input.lookDY += (e.clientY - this.lastLook.y) * 1.6;
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.resetStick();
    } else if (e.pointerId === this.lookId) this.lookId = null;
  }

  private resetStick(): void {
    this.input.stickMove.x = 0;
    this.input.stickMove.y = 0;
    this.base.classList.add('idle');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
    if (!v) {
      this.stickId = this.lookId = null;
      this.resetStick();
    }
  }
}

export function isTouchDevice(): boolean {
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
  );
}
