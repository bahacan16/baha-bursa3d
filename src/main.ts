import './hud/hud.css';
import { loadSettings } from './core/settings';
import { Game } from './game';
import { BoxesWorld } from './worlds/boxes';
import { loadOsmData } from './worlds/osm/data';
import { OsmWorld } from './worlds/osm/world';

const app = document.getElementById('app')!;
const settings = loadSettings();
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const base = import.meta.env.BASE_URL;

const loading = document.createElement('div');
loading.className = 'screen';
loading.innerHTML = `<div class="loading-box"><h2>Dünya yükleniyor…</h2><div class="progress"><div></div></div><div class="note" data-label></div></div>`;
app.appendChild(loading);
const bar = loading.querySelector<HTMLDivElement>('.progress > div')!;
const label = loading.querySelector<HTMLDivElement>('[data-label]')!;
const progress = (f: number, l: string) => {
  bar.style.width = `${Math.round(f * 100)}%`;
  label.textContent = l;
};

async function start() {
  const game = new Game(app, settings);
  if (debug) (window as unknown as { __game: Game }).__game = game;
  void game.character.load(`${base}models/RobotExpressive.glb`);
  if (params.get('world') === 'boxes') {
    game.setWorld(new BoxesWorld());
  } else {
    const data = await loadOsmData(base, (f, l) => progress(f * 0.4, l));
    const world = await OsmWorld.create(data, settings.quality, game.viewDistance, (f, l) =>
      progress(0.4 + f * 0.6, l),
    );
    game.setWorld(world);
  }
  loading.remove();
  game.start();
}

start().catch((err) => {
  console.error(err);
  loading.innerHTML = `<div class="error-box"><h2>Hata</h2><p>${(err as Error).message}</p></div>`;
});
