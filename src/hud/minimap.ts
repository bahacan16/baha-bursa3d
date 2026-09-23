import type { MapImage } from './maprender';

const VIEW_R = 150; // m

/** Dairesel, oyuncu yönüyle dönen mini harita (sol alt). */
export class Minimap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size = 0;

  constructor(
    parent: HTMLElement,
    private readonly map: MapImage | null,
    private readonly boundaryR: number,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'minimap hud-el';
    this.el.dataset.testid = 'minimap';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    parent.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** `yaw`: kamera yönü (0 = kuzey). `heading`: karakter yönü. */
  draw(x: number, z: number, yaw: number, heading: number): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const px = Math.round(this.el.clientWidth * dpr);
    if (!px) return;
    if (px !== this.size) {
      this.size = px;
      this.canvas.width = this.canvas.height = px;
    }
    const ctx = this.ctx;
    const s = px;
    const c = s / 2;
    const k = c / VIEW_R; // px / m
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#3d4247';
    ctx.fillRect(0, 0, s, s);
    ctx.save();
    ctx.translate(c, c);
    // Harita, kamera yukarı bakacak şekilde döner (kamera yaw'ı ekranın üstü).
    ctx.rotate(yaw);
    if (this.map) {
      const m = this.map;
      const f = k / m.scale;
      ctx.drawImage(
        m.canvas,
        (m.originX - x) * k,
        (m.originZ - z) * k,
        m.canvas.width * f,
        m.canvas.height * f,
      );
    }
    // Oynanabilir alan sınırı
    ctx.strokeStyle = '#e04848';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.arc(-x * k, -z * k, this.boundaryR * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Kuzey işareti (çember kenarında)
    const nx = c + Math.sin(yaw) * (c - 12 * dpr);
    const ny = c - Math.cos(yaw) * (c - 12 * dpr);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(nx, ny, 9 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${11 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', nx, ny + 0.5);

    // Oyuncu oku (karakter yönü, kameraya göre)
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-(heading - yaw));
    ctx.fillStyle = '#f2b233';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, -9 * dpr);
    ctx.lineTo(6.5 * dpr, 7 * dpr);
    ctx.lineTo(0, 3.5 * dpr);
    ctx.lineTo(-6.5 * dpr, 7 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
