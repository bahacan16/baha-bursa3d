/** Klavye/fare/dokunmatik → soyut girdi durumu. */
export type Action = 'camera' | 'map' | 'teleport' | 'pause' | 'hud' | 'ghost' | 'jump' | 'photo' | 'shot';

export class InputState {
  /** Klavye hareket ekseni: x sağ, y ileri, [-1, 1]. */
  keyMove = { x: 0, y: 0 };
  /** Dokunmatik joystick: x sağ, y ileri, büyüklük [0, 1]. */
  stickMove = { x: 0, y: 0 };
  runHeld = false;
  /** Fotoğraf modunda dikey hareket: E yukarı, Q aşağı */
  vertical = 0;
  runToggle = false;
  jumpHeld = false;
  /** Biriken bakış deltası (piksel). */
  lookDX = 0;
  lookDY = 0;
  private actions: Action[] = [];
  private listeners = new Set<(a: Action) => void>();

  get move(): { x: number; y: number } {
    const sx = this.stickMove.x;
    const sy = this.stickMove.y;
    if (sx !== 0 || sy !== 0) return { x: sx, y: sy };
    const x = this.keyMove.x;
    const y = this.keyMove.y;
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  /** Koşu: Shift, koş düğmesi veya joystick %85'ten fazla itilmişse. */
  get running(): boolean {
    return this.runHeld || this.runToggle || Math.hypot(this.stickMove.x, this.stickMove.y) > 0.85;
  }

  push(a: Action): void {
    // Yalnızca fizik adımında tüketilen eylemler kuyruğa girer; diğerleri dinleyicilere gider.
    if (a === 'jump' && !this.actions.includes('jump')) this.actions.push(a);
    for (const l of this.listeners) l(a);
  }

  onAction(fn: (a: Action) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fizik adımında tüketilecek eylemler (ör. zıplama). */
  consume(a: Action): boolean {
    const i = this.actions.indexOf(a);
    if (i < 0) return false;
    this.actions.splice(i, 1);
    return true;
  }

  clearActions(): void {
    this.actions.length = 0;
  }

  takeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  reset(): void {
    this.keyMove.x = this.keyMove.y = 0;
    this.stickMove.x = this.stickMove.y = 0;
    this.runHeld = false;
    this.jumpHeld = false;
    this.lookDX = this.lookDY = 0;
  }
}

const KEYMAP: Record<string, Action> = {
  KeyV: 'camera',
  KeyM: 'map',
  KeyT: 'teleport',
  Escape: 'pause',
  KeyH: 'hud',
  KeyP: 'photo',
  KeyF: 'shot',
  ControlLeft: 'ghost',
  ControlRight: 'ghost',
  Space: 'jump',
};

/** Masaüstü klavye + fare (Pointer Lock) bağlayıcısı. */
export class DesktopInput {
  private pressed = new Set<string>();
  enabled = true;
  private disposers: (() => void)[] = [];

  constructor(
    private readonly state: InputState,
    private readonly canvas: HTMLElement,
  ) {
    const kd = (e: KeyboardEvent) => this.onKey(e, true);
    const ku = (e: KeyboardEvent) => this.onKey(e, false);
    const mm = (e: MouseEvent) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === this.canvas) {
        this.state.lookDX += e.movementX;
        this.state.lookDY += e.movementY;
      } else if (this.dragging) {
        this.state.lookDX += e.movementX;
        this.state.lookDY += e.movementY;
      }
    };
    const md = (e: MouseEvent) => {
      if (!this.enabled || e.button !== 0) return;
      this.dragging = true;
      // Pointer Lock bazı ortamlarda desteklenmez; sürükleme ile bakış yedek yoldur.
      try {
        const p = this.canvas.requestPointerLock?.() as unknown;
        if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
      } catch {
        /* yoksay */
      }
    };
    const mu = () => (this.dragging = false);
    const blur = () => {
      this.pressed.clear();
      this.sync();
      this.state.runHeld = false;
    };
    addEventListener('keydown', kd);
    addEventListener('keyup', ku);
    addEventListener('mousemove', mm);
    this.canvas.addEventListener('mousedown', md);
    addEventListener('mouseup', mu);
    addEventListener('blur', blur);
    this.disposers.push(
      () => removeEventListener('keydown', kd),
      () => removeEventListener('keyup', ku),
      () => removeEventListener('mousemove', mm),
      () => this.canvas.removeEventListener('mousedown', md),
      () => removeEventListener('mouseup', mu),
      () => removeEventListener('blur', blur),
    );
  }

  private dragging = false;

  private onKey(e: KeyboardEvent, down: boolean): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const code = e.code;
    if (down) {
      if (
        !e.repeat &&
        KEYMAP[code] &&
        (this.enabled || code === 'Escape' || code === 'KeyM' || code === 'KeyT')
      )
        this.state.push(KEYMAP[code]);
      this.pressed.add(code);
    } else this.pressed.delete(code);
    if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
    this.sync();
  }

  private sync(): void {
    const p = this.pressed;
    if (!this.enabled) {
      this.state.keyMove.x = this.state.keyMove.y = 0;
      this.state.runHeld = false;
      return;
    }
    this.state.keyMove.y =
      (p.has('KeyW') || p.has('ArrowUp') ? 1 : 0) - (p.has('KeyS') || p.has('ArrowDown') ? 1 : 0);
    this.state.keyMove.x =
      (p.has('KeyD') || p.has('ArrowRight') ? 1 : 0) - (p.has('KeyA') || p.has('ArrowLeft') ? 1 : 0);
    this.state.runHeld = p.has('ShiftLeft') || p.has('ShiftRight');
    this.state.jumpHeld = p.has('Space');
    this.state.vertical = (p.has('KeyE') ? 1 : 0) - (p.has('KeyQ') ? 1 : 0);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.pressed.clear();
      if (document.pointerLockElement) document.exitPointerLock?.();
    }
    this.sync();
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
