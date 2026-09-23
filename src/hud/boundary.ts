/** Sınır uyarısı: 950 m'de ekran kenarları kırmızılaşır. */
export class BoundaryHud {
  private vignette: HTMLDivElement;
  private msg: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly warnR = 950,
    private readonly hardR = 1000,
  ) {
    this.vignette = document.createElement('div');
    this.vignette.className = 'boundary-vignette';
    this.msg = document.createElement('div');
    this.msg.className = 'boundary-msg';
    this.msg.textContent = 'Bölge sınırı';
    parent.append(this.vignette, this.msg);
  }

  update(x: number, z: number): void {
    const r = Math.hypot(x, z);
    const t = Math.max(0, Math.min(1, (r - this.warnR) / (this.hardR - this.warnR)));
    this.vignette.style.opacity = String(t > 0 ? 0.35 + t * 0.65 : 0);
    this.msg.style.opacity = t > 0 ? '1' : '0';
  }
}
