import { clearApiKey, loadApiKey, saveApiKey, saveSettings, type Settings } from '../core/settings';

export type Mode = 'osm' | 'google';

const README_KEY_URL = 'https://github.com/bahacan16/baha-bursa3d#mod-a-google-api-anahtar%C4%B1';

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Başlangıç ekranı: mod seçimi, API anahtarı, kalite, kontrol kılavuzu. */
export function showStartScreen(
  parent: HTMLElement,
  settings: Settings,
): Promise<{ mode: Mode; key: string }> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'screen';
    el.dataset.testid = 'start-screen';
    parent.appendChild(el);
    let key = loadApiKey();

    const render = () => {
      const hasKey = key.length > 10;
      const q = settings.quality;
      el.innerHTML = `<div class="screen-inner">
        <h1 class="title">Nilüfer <span>Walk</span></h1>
        <p class="subtitle">Bursa · Nilüfer · 29 Ekim Mahallesi · 502. Sokak çevresinde 2 km'lik alanda üçüncü şahıs yürüyüş.
        Binalar, yollar ve ağaçlar gerçek 3D geometri.</p>
        <div class="modes">
          <button class="mode-card" data-mode="osm" data-testid="mode-osm">
            <span class="tag">Varsayılan · anahtar gerekmez</span>
            <h3>Mod B — Oyun (OpenStreetMap 3D)</h3>
            <p>Temiz, oyun gibi görünüm. Bina şekilleri ve kat yükseklikleri OpenStreetMap'ten, cepheler prosedürel.</p>
            <div class="play">Oyna ▸</div>
          </button>
          <button class="mode-card" data-mode="google" data-testid="mode-google" ${hasKey ? '' : 'disabled'}>
            <span class="tag">${hasKey ? 'Anahtar kayıtlı' : 'Google API anahtarı gerekir'}</span>
            <h3>Mod A — Gerçekçi (Google 3D)</h3>
            <p>Google Photorealistic 3D Tiles: fotoğraf dokulu gerçek şehir modeli. Uzaktan çok gerçekçi, yakından "erimiş" görünebilir.
            ${hasKey ? '' : '<br/><strong>Aşağıya Map Tiles API anahtarını gir.</strong>'}</p>
            <div class="play">${hasKey ? 'Oyna ▸' : 'Pasif'}</div>
          </button>
        </div>
        <div class="panel">
          <h4>Google Maps API anahtarı (Mod A için)</h4>
          <div class="row">
            <input class="field" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…" value="${esc(key)}" data-key />
            <button class="btn" data-act="show">Göster</button>
            <button class="btn primary" data-act="save">Kaydet</button>
            <button class="btn" data-act="clear">Sil</button>
          </div>
          <p class="note">Anahtar yalnızca bu tarayıcıda (localStorage) saklanır, hiçbir yere gönderilmez (Google dışında).
          <a href="${README_KEY_URL}" target="_blank" rel="noopener">Nasıl alınır?</a></p>
        </div>
        <div class="panel">
          <h4>Grafik kalitesi</h4>
          <div class="seg" data-seg="quality">
            ${(['low', 'medium', 'high'] as const)
              .map(
                (v) =>
                  `<button data-v="${v}" class="${q === v ? 'on' : ''}">${{ low: 'Düşük', medium: 'Orta', high: 'Yüksek' }[v]}</button>`,
              )
              .join('')}
          </div>
          <p class="note">Telefonlarda Düşük önerilir.</p>
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
            <span><kbd>Esc</kbd> <kbd>H</kbd></span><span>Duraklat/ayarlar · HUD aç/kapa</span>
            <span><kbd>Ctrl</kbd></span><span>Hayalet adım (çarpışmasız 1 m, sıkışınca)</span>
            <span>📱</span><span>Sol yarı: joystick (sona kadar it = koş) · sağ yarı: kamera · butonlar sağ altta</span>
          </div>
        </div>
        <p class="note">Harita verisi © OpenStreetMap katkıcıları (ODbL). Karakter: RobotExpressive, Tomás Laulhé (CC0).</p>
      </div>`;
      const input = el.querySelector<HTMLInputElement>('[data-key]')!;
      el.querySelector('[data-act="show"]')!.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
      });
      el.querySelector('[data-act="save"]')!.addEventListener('click', () => {
        key = input.value.trim();
        saveApiKey(key);
        render();
      });
      el.querySelector('[data-act="clear"]')!.addEventListener('click', () => {
        key = '';
        clearApiKey();
        render();
      });
      el.querySelectorAll<HTMLButtonElement>('[data-seg="quality"] button').forEach((b) =>
        b.addEventListener('click', () => {
          settings.quality = b.dataset.v as Settings['quality'];
          saveSettings(settings);
          render();
        }),
      );
      el.querySelectorAll<HTMLButtonElement>('.mode-card').forEach((b) =>
        b.addEventListener('click', () => {
          if (b.disabled) return;
          const typed = input.value.trim();
          if (typed && typed !== key) {
            key = typed;
            saveApiKey(key);
          }
          el.remove();
          resolve({ mode: b.dataset.mode as Mode, key });
        }),
      );
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
