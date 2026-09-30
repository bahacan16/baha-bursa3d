import { saveSettings, type Settings } from '../core/settings';

export type Mode = 'osm' | 'google';

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/**
 * Başlangıç ekranı: başlık, kalite, kontrol kılavuzu, "Başla".
 * KARAR: Mod A (Google 3D) seçimi ve API anahtarı kutusu kullanıcı isteğiyle kaldırıldı — oyun artık el ile
 * modellenmiş Mod B dünyası. Google modu kodda duruyor; yalnız ?mode=a ile (tarayıcıda kayıtlı anahtarla) açılır.
 */
export function showStartScreen(
  parent: HTMLElement,
  settings: Settings,
): Promise<{ mode: Mode; key: string }> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'screen';
    el.dataset.testid = 'start-screen';
    parent.appendChild(el);

    const render = () => {
      const q = settings.ultra && settings.quality === 'high' ? 'ultra' : settings.quality;
      el.innerHTML = `<div class="screen-inner">
        <h1 class="title">Nilüfer <span>Walk</span></h1>
        <p class="subtitle">Bursa · Nilüfer · 29 Ekim Mahallesi. Sokaklar ve siteler gerçek ölçülerle modellendi;
        2 km'lik alanda üçüncü şahıs yürüyüş.</p>
        <button class="btn primary start-btn" data-testid="mode-osm">Başla ▸</button>
        <div class="panel">
          <h4>Grafik kalitesi</h4>
          <div class="seg" data-seg="quality">
            ${(['low', 'medium', 'high', 'ultra'] as const)
              .map(
                (v) =>
                  `<button data-v="${v}" class="${q === v ? 'on' : ''}">${{ low: 'Düşük', medium: 'Orta', high: 'Yüksek', ultra: 'Ultra' }[v]}</button>`,
              )
              .join('')}
          </div>
          <p class="note">Telefonlarda Düşük önerilir. Ultra: güçlü masaüstü ekran kartı için (yumuşak kademeli
          gölgeler, bulutlar, pus, TAA, film greni, cam yansımaları).</p>
        </div>
        <div class="panel">
          <h4>Kontroller</h4>
          <div class="controls-grid">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Yürü (kamera yönüne göre)</span>
            <span><kbd>Fare</kbd></span><span>Bak (tıkla: fareyi kilitle)</span>
            <span><kbd>Shift</kbd></span><span>Koş</span>
            <span><kbd>Space</kbd></span><span>Zıpla</span>
            <span><kbd>V</kbd></span><span>1. / 3. şahıs kamera</span>
            <span><kbd>M</kbd> <kbd>T</kbd></span><span>Harita · Işınlanma menüsü</span>
            <span><kbd>P</kbd></span><span>Fotoğraf modu</span>
            <span><kbd>Esc</kbd> <kbd>H</kbd></span><span>Duraklat/ayarlar · HUD aç/kapa</span>
            <span><kbd>Ctrl</kbd></span><span>Hayalet adım (çarpışmasız 1 m, sıkışınca)</span>
            <span>📱</span><span>Sol yarı: joystick (sona kadar it = koş) · sağ yarı: kamera · butonlar sağ altta</span>
          </div>
        </div>
        <p class="note">Harita verisi © OpenStreetMap katkıcıları (ODbL). İnsan modelleri: three.js örnekleri (Ready Player Me, Mixamo).</p>
      </div>`;
      el.querySelectorAll<HTMLButtonElement>('[data-seg="quality"] button').forEach((b) =>
        b.addEventListener('click', () => {
          const v = b.dataset.v!;
          settings.ultra = v === 'ultra';
          settings.ultraExplicit = v === 'ultra';
          settings.quality = (v === 'ultra' ? 'high' : v) as Settings['quality'];
          saveSettings(settings);
          render();
        }),
      );
      el.querySelector('[data-testid="mode-osm"]')!.addEventListener('click', () => {
        el.remove();
        resolve({ mode: 'osm', key: '' });
      });
    };
    render();
  });
}

export class LoadingScreen {
  readonly el: HTMLDivElement;
  private bar: HTMLDivElement;
  private label: HTMLDivElement;
  private pct: HTMLSpanElement;

  constructor(parent: HTMLElement, title = 'Dünya yükleniyor…') {
    this.el = document.createElement('div');
    this.el.className = 'screen';
    this.el.dataset.testid = 'loading';
    this.el.innerHTML = `<div class="loading-box"><h2>${esc(title)} <span data-pct>0%</span></h2>
      <div class="progress"><div></div></div><div class="note" data-label></div></div>`;
    parent.appendChild(this.el);
    this.bar = this.el.querySelector('.progress > div')!;
    this.label = this.el.querySelector('[data-label]')!;
    this.pct = this.el.querySelector('[data-pct]')!;
  }

  set(f: number, label: string): void {
    const p = Math.round(Math.max(0, Math.min(1, f)) * 100);
    this.bar.style.width = `${p}%`;
    this.pct.textContent = `${p}%`;
    if (label) this.label.textContent = label;
  }

  remove(): void {
    this.el.remove();
  }
}

export function showError(
  parent: HTMLElement,
  title: string,
  message: string,
  actions: { label: string; fn: () => void }[] = [],
): void {
  const el = document.createElement('div');
  el.className = 'screen';
  el.dataset.testid = 'error';
  el.innerHTML = `<div class="error-box panel"><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="row"></div></div>`;
  const row = el.querySelector('.row')!;
  for (const a of [...actions, { label: 'Ana menü', fn: () => location.reload() }]) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = a.label;
    b.addEventListener('click', a.fn);
    row.appendChild(b);
  }
  parent.appendChild(el);
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
