import type { MapImage } from './maprender';
import type { OsmWorldData, Pt } from '../worlds/osm/parse';

interface Label {
  name: string;
  x: number;
  z: number;
  angle: number;
  len: number;
}

/** Tam ekran harita (M): sokak adları, oyuncu konumu, işaretlenen noktaya ışınlanma. */
export class BigMap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private confirmBtn: HTMLButtonElement;
  private labels: Label[] = [];
  /** Görünüm: merkez (dünya) ve ölçek (px/m, CSS px). */
  private cx = 0;
  private cz = 0;
  private zoom = 0.4;
  private player = { x: 0, z: 0, heading: 0 };
  private marker: Pt | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = 0;
  open = false;
  onTeleport: (x: number, z: number) => void = () => {};
  onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly map: MapImage | null,
    data: OsmWorldData | null,
    private readonly boundaryR: number,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'bigmap hidden';
    this.el.innerHTML = `
      <div class="bigmap-bar">
        <strong>Harita</strong>
        <span class="note">Bir noktaya dokun/tıkla, sonra ışınlan. Sürükle: kaydır, tekerlek/iki parmak: yakınlaştır.</span>
        <span class="spacer"></span>
        <button class="btn primary hidden" data-act="go">Buraya ışınlan</button>
        <button class="btn" data-act="center">Beni bul</button>
        <button class="btn" data-act="close">Kapat (M)</button>
      </div>
      <canvas></canvas>`;
    parent.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.confirmBtn = this.el.querySelector('[data-act="go"]')!;
    this.el.querySelector('[data-act="close"]')!.addEventListener('click', () => this.onClose());
    this.el.querySelector('[data-act="center"]')!.addEventListener('click', () => {
      this.cx = this.player.x;
      this.cz = this.player.z;
      this.draw();
    });
    this.confirmBtn.addEventListener('click', () => {
      if (this.marker) this.onTeleport(this.marker[0], this.marker[1]);
    });
    if (data) this.labels = buildLabels(data);

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = 0;
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 1) {
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        this.moved += Math.abs(dx) + Math.abs(dy);
        this.cx -= dx / this.zoom;
        this.cz -= dy / this.zoom;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX;
        p.y = e.clientY;
        const [a2, b2] = [...this.pointers.values()];
        const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (before > 0) this.setZoom(this.zoom * (after / before));
        this.moved += 100;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      this.draw();
    });
    const up = (e: PointerEvent) => {
      const was = this.pointers.has(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (was && this.moved < 8 && this.pointers.size === 0) {
        const r = c.getBoundingClientRect();
        const w = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
        if (Math.hypot(w[0], w[1]) <= this.boundaryR) {
          this.marker = w;
          this.confirmBtn.classList.remove('hidden');
        }
        this.draw();
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015));
        this.draw();
      },
      { passive: false },
    );
  }

  private setZoom(z: number) {
    this.zoom = Math.max(0.12, Math.min(4, z));
  }

  private screenToWorld(sx: number, sy: number): Pt {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return [this.cx + (sx - w / 2) / this.zoom, this.cz + (sy - h / 2) / this.zoom];
  }

  show(px: number, pz: number, heading: number): void {
    this.open = true;
    this.player = { x: px, z: pz, heading };
    this.cx = px;
    this.cz = pz;
    this.marker = null;
    this.confirmBtn.classList.add('hidden');
    this.el.classList.remove('hidden');
    const fit = Math.min(this.el.clientWidth, this.el.clientHeight) / (this.boundaryR * 2.2);
    this.zoom = Math.max(fit, 0.35);
    requestAnimationFrame(() => this.draw());
  }

  hide(): void {
    this.open = false;
    this.el.classList.add('hidden');
  }

  draw(): void {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#23272b';
    ctx.fillRect(0, 0, w, h);
    const sx = (x: number) => (x - this.cx) * this.zoom + w / 2;
    const sy = (z: number) => (z - this.cz) * this.zoom + h / 2;
    if (this.map) {
      const m = this.map;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        m.canvas,
        sx(m.originX),
        sy(m.originZ),
        (m.canvas.width / m.scale) * this.zoom,
        (m.canvas.height / m.scale) * this.zoom,
      );
    }
    ctx.strokeStyle = '#e04848';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx(0), sy(0), this.boundaryR * this.zoom, 0, Math.PI * 2);
    ctx.stroke();

    // Sokak adları
    ctx.font = `700 ${Math.max(10, Math.min(14, 11 * Math.sqrt(this.zoom / 0.5)))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed: { x: number; y: number; r: number }[] = [];
    for (const l of this.labels) {
      const tw = ctx.measureText(l.name).width;
      if (l.len * this.zoom < tw * 0.9) continue;
      const x = sx(l.x);
      const y = sy(l.z);
      if (x < -50 || y < -50 || x > w + 50 || y > h + 50) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + tw / 2)) continue;
      placed.push({ x, y, r: tw / 2 });
      ctx.save();
      ctx.translate(x, y);
      let a = l.angle;
      if (a > Math.PI / 2) a -= Math.PI;
      if (a < -Math.PI / 2) a += Math.PI;
      ctx.rotate(a);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(l.name, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillText(l.name, 0, 0);
      ctx.restore();
    }

    if (this.marker) {
      const x = sx(this.marker[0]);
      const y = sy(this.marker[1]);
      ctx.fillStyle = '#f2b233';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y - 16, 8, Math.PI * 0.8, Math.PI * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // Oyuncu
    const p = this.player;
    ctx.save();
    ctx.translate(sx(p.x), sy(p.z));
    ctx.rotate(-p.heading);
    ctx.fillStyle = '#f2b233';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Her isimli yol için en uzun segmentin ortasına bir etiket. */
function buildLabels(d: OsmWorldData): Label[] {
  const byName = new Map<string, Label[]>();
  for (const r of d.roads) {
    if (!r.name || r.tunnel) continue;
    let best = -1;
    let bi = 0;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const l = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]);
      if (l > best) {
        best = l;
        bi = i;
      }
    }
    const a = r.pts[bi];
    const b = r.pts[bi + 1];
    const lab = {
      name: r.name,
      x: (a[0] + b[0]) / 2,
      z: (a[1] + b[1]) / 2,
      angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      len: best,
    };
    let arr = byName.get(r.name);
    if (!arr) byName.set(r.name, (arr = []));
    arr.push(lab);
  }
  const out: Label[] = [];
  for (const arr of byName.values()) {
    arr.sort((p, q) => q.len - p.len);
    // Aynı adın birbirinden en az 250 m uzak kopyaları
    const keep: Label[] = [];
    for (const l of arr) if (keep.every((k) => Math.hypot(k.x - l.x, k.z - l.z) > 250)) keep.push(l);
    out.push(...keep);
  }
  return out.sort((p, q) => q.len - p.len);
}
