import type { Game } from '../game';
import type { Action } from '../core/input';
import { saveSettings, type Quality, type TimeOfDay } from '../core/settings';
import type { OsmWorldData } from '../worlds/osm/parse';
import { renderMap } from './maprender';
import { Minimap } from './minimap';
import { BigMap } from './bigmap';
import { StreetLocator, StreetNameHud } from './streetname';
import { BoundaryHud } from './boundary';
import { findPlaces, type Place } from './places';

const AREA_LABEL = '29 Ekim · Nilüfer';

type Modal = 'none' | 'map' | 'teleport' | 'pause';

/** GTA tarzı HUD: mini harita, büyük harita, sokak adı, sınır, ışınlanma, duraklatma menüsü, atıf, FPS. */
export class Hud {
  readonly root: HTMLDivElement;
  private minimap: Minimap;
  private bigmap: BigMap;
  private street: StreetNameHud | null = null;
  private locator: StreetLocator | null = null;
  private boundary: BoundaryHud;
  private attribution: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private teleportEl: HTMLDivElement;
  private pauseEl: HTMLDivElement;
  private modal: Modal = 'none';
  private places: Place[] = [];
  private time = 0;
  private toastTimer = 0;
  private hudVisible = true;
  private lastAttribution = '';
  private streetAccum = 0;

  constructor(
    private readonly game: Game,
    data: OsmWorldData | null,
  ) {
    const parent = game.container;
    const root = (this.root = document.createElement('div'));
    root.className = 'hud';
    parent.appendChild(root);
    const R = game.controller.cfg.boundaryRadius;
    const map = data ? renderMap(data, game.isTouch ? 0.75 : 1) : null;
    this.minimap = new Minimap(root, map, R);
    if (data) {
      this.locator = new StreetLocator(data);
      this.street = new StreetNameHud(root, AREA_LABEL);
      this.places = findPlaces(data, R);
    }
    this.boundary = new BoundaryHud(root, R - 50, R);
    this.attribution = document.createElement('div');
    this.attribution.className = 'attribution';
    this.attribution.dataset.testid = 'attribution';
    root.appendChild(this.attribution);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps hud-el';
    this.fpsEl.style.display = game.settings.showFps ? '' : 'none';
    root.appendChild(this.fpsEl);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    root.appendChild(this.toastEl);

    const top = document.createElement('div');
    top.className = 'hud-top-right hud-el';
    top.innerHTML = `
      <button class="icon-btn" data-act="teleport" title="Işınlan (T)" aria-label="Işınlan">⌖</button>
      <button class="icon-btn" data-act="map" title="Harita (M)" aria-label="Harita">▦</button>
      <button class="icon-btn" data-act="pause" title="Menü (Esc)" aria-label="Menü">☰</button>`;
    for (const b of top.querySelectorAll<HTMLButtonElement>('button'))
      b.addEventListener('click', () => this.handle(b.dataset.act as Action));
    root.appendChild(top);

    this.bigmap = new BigMap(parent, map, data, R);
    this.bigmap.onClose = () => this.close();
    this.bigmap.onTeleport = (x, z) => {
      this.close();
      this.teleport(x, z, 'Işınlanıldı');
    };

    this.teleportEl = document.createElement('div');
    this.teleportEl.className = 'screen overlay hidden';
    parent.appendChild(this.teleportEl);
    this.renderTeleport();

    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'screen overlay hidden';
    parent.appendChild(this.pauseEl);
    this.renderPause();

    game.hooks.onAction = (_g, a) => this.handle(a);
    // Pointer Lock'tan Esc ile çıkılınca (tarayıcı Esc tuşunu iletmez) duraklat.
    let wasLocked = false;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === game.renderer.domElement;
      if (wasLocked && !locked && this.modal === 'none') this.openModal('pause');
      wasLocked = locked;
    });
    game.hooks.onFrame = (_g, dt) => this.frame(dt);
  }

  get streetText(): string {
    return this.street?.text ?? '';
  }

  toast(msg: string, secs = 3): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = this.time + secs;
  }

  private teleport(x: number, z: number, msg: string): void {
    const p = this.game.world?.findFreeSpot?.(x, z) ?? { x, z };
    const y = this.game.world?.collision.groundHeight(p.x, p.z, 50) ?? 0;
    this.game.teleport(p.x, y ?? 0, p.z);
    this.toast(msg);
  }

  /** Eylem işlendiyse true (oyun ayrıca işlemesin). */
  private handle(a: Action): boolean {
    if (a === 'pause') {
      if (this.modal !== 'none') this.close();
      else this.openModal('pause');
      return true;
    }
    if (a === 'map') {
      if (this.modal === 'map') this.close();
      else if (this.modal === 'none') this.openModal('map');
      return true;
    }
    if (a === 'teleport') {
      if (this.modal === 'teleport') this.close();
      else if (this.modal === 'none') this.openModal('teleport');
      return true;
    }
    if (a === 'hud' && this.modal === 'none') {
      this.hudVisible = !this.hudVisible;
      this.game.container.classList.toggle('hud-off', !this.hudVisible);
      return true;
    }
    return this.modal !== 'none';
  }

  private openModal(m: Modal): void {
    this.modal = m;
    this.game.block(true);
    this.game.touch?.setVisible(false);
    if (m === 'map') {
      const p = this.game.controller.position;
      this.bigmap.show(p.x, p.z, this.game.controller.heading);
    } else if (m === 'teleport') this.teleportEl.classList.remove('hidden');
    else if (m === 'pause') {
      this.game.loop.paused = true;
      this.renderPause();
      this.pauseEl.classList.remove('hidden');
    }
  }

  close(): void {
    if (this.modal === 'none') return;
    this.bigmap.hide();
    this.teleportEl.classList.add('hidden');
    this.pauseEl.classList.add('hidden');
    this.game.loop.paused = false;
    this.modal = 'none';
    this.game.block(false);
    this.game.touch?.setVisible(true);
    this.street?.flash(this.time);
  }

  private renderTeleport(): void {
    const el = this.teleportEl;
    el.innerHTML = `<div class="screen-inner" style="max-width:480px"><div class="panel">
      <h4>Işınlan (T)</h4>
      <div class="list"></div>
      <p class="note">Liste OpenStreetMap verisinde adıyla bulunan yerlerden oluşur. Haritadan (M) herhangi bir noktaya da ışınlanabilirsin.</p>
      <div class="row"><button class="btn" data-act="close">Kapat</button></div></div></div>`;
    const list = el.querySelector('.list')!;
    for (const p of this.places) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = p.label;
      b.addEventListener('click', () => {
        this.close();
        this.teleport(p.x, p.z, p.label);
      });
      list.appendChild(b);
    }
    if (!this.places.length) list.innerHTML = '<p class="note">Harita verisi yok.</p>';
    el.querySelector('[data-act="close"]')!.addEventListener('click', () => this.close());
  }

  private renderPause(): void {
    const s = this.game.settings;
    const seg = (name: string, opts: [string, string][], cur: string) =>
      `<div class="seg" data-seg="${name}">${opts
        .map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`)
        .join('')}</div>`;
    const el = this.pauseEl;
    el.innerHTML = `<div class="screen-inner" style="max-width:520px"><div class="panel">
      <h4>Duraklatıldı</h4>
      <div class="row" style="margin-bottom:12px"><button class="btn primary" data-act="resume">Devam et</button>
      <button class="btn" data-act="menu">Ana menü</button></div>
      <h4>Zaman</h4>${seg(
        'time',
        [
          ['day', 'Gündüz'],
          ['sunset', 'Gün batımı'],
          ['night', 'Gece'],
        ],
        s.timeOfDay,
      )}
      <h4 style="margin-top:12px">Grafik kalitesi <span class="note">(yeniden yükler)</span></h4>
      ${seg(
        'quality',
        [
          ['low', 'Düşük'],
          ['medium', 'Orta'],
          ['high', 'Yüksek'],
        ],
        s.quality,
      )}
      <h4 style="margin-top:12px">Göstergeler</h4>
      <div class="row">
        <label><input type="checkbox" data-opt="fps" ${s.showFps ? 'checked' : ''}/> FPS sayacı</label>
        <label><input type="checkbox" data-opt="hud" ${this.hudVisible ? 'checked' : ''}/> HUD (H)</label>
      </div>
      <h4 style="margin-top:12px">Koşu hızı: <span data-run>${s.runSpeed.toFixed(1)}</span> m/s</h4>
      <input type="range" min="3" max="9" step="0.5" value="${s.runSpeed}" data-opt="run" style="width:100%"/>
      <p class="note" style="margin-top:12px"><kbd>WASD</kbd> yürü · <kbd>Shift</kbd> koş · <kbd>Space</kbd> zıpla · <kbd>V</kbd> kamera · <kbd>M</kbd> harita · <kbd>T</kbd> ışınlan · <kbd>H</kbd> HUD · <kbd>Ctrl</kbd> hayalet adım</p>
      </div></div>`;
    el.querySelector('[data-act="resume"]')!.addEventListener('click', () => this.close());
    el.querySelector('[data-act="menu"]')!.addEventListener('click', () => {
      location.href = location.pathname + (location.search.includes('debug') ? '?debug=1' : '');
    });
    el.querySelectorAll<HTMLDivElement>('[data-seg]').forEach((segEl) => {
      segEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.addEventListener('click', () => {
          const v = b.dataset.v!;
          if (segEl.dataset.seg === 'time') {
            s.timeOfDay = v as TimeOfDay;
            this.game.applyTimeOfDay();
          } else if (segEl.dataset.seg === 'quality' && v !== s.quality) {
            s.quality = v as Quality;
            saveSettings(s);
            location.reload();
            return;
          }
          saveSettings(s);
          this.renderPause();
        }),
      );
    });
    el.querySelector<HTMLInputElement>('[data-opt="fps"]')!.addEventListener('change', (e) => {
      s.showFps = (e.target as HTMLInputElement).checked;
      this.fpsEl.style.display = s.showFps ? '' : 'none';
      saveSettings(s);
    });
    el.querySelector<HTMLInputElement>('[data-opt="hud"]')!.addEventListener('change', (e) => {
      this.hudVisible = (e.target as HTMLInputElement).checked;
      this.game.container.classList.toggle('hud-off', !this.hudVisible);
    });
    el.querySelector<HTMLInputElement>('[data-opt="run"]')!.addEventListener('input', (e) => {
      s.runSpeed = Number((e.target as HTMLInputElement).value);
      this.game.controller.cfg.runSpeed = s.runSpeed;
      el.querySelector('[data-run]')!.textContent = s.runSpeed.toFixed(1);
      saveSettings(s);
    });
  }

  private frame(dt: number): void {
    this.time += dt || 1 / 60;
    const g = this.game;
    const p = g.controller.position;
    if (this.hudVisible) this.minimap.draw(p.x, p.z, g.follow.yaw, g.controller.heading);
    this.boundary.update(p.x, p.z);
    this.streetAccum += dt;
    if (this.locator && this.street && this.streetAccum > 0.2) {
      this.streetAccum = 0;
      this.street.update(this.locator.locate(p.x, p.z), this.time);
    }
    if (this.toastTimer && this.time > this.toastTimer) {
      this.toastEl.classList.remove('show');
      this.toastTimer = 0;
    }
    const attr = g.world?.attributionHtml() ?? '';
    if (attr !== this.lastAttribution) {
      this.lastAttribution = attr;
      this.attribution.innerHTML = attr;
    }
    if (g.settings.showFps) {
      const info = g.renderer.info.render;
      let txt = `${g.fps.toFixed(0)} FPS`;
      if (g.debug) {
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        txt += `\n${info.calls} draw · ${(info.triangles / 1000).toFixed(0)}k üçgen`;
        if (mem) txt += `\n${(mem.usedJSHeapSize / 1e6).toFixed(0)} MB`;
        txt += `\n${p.x.toFixed(0)}, ${p.z.toFixed(0)}`;
      }
      this.fpsEl.textContent = txt;
    }
  }
}
