import './hud/hud.css';
import { loadSettings } from './core/settings';
import { Game } from './game';
import { Hud } from './hud/hud';
import { BoxesWorld } from './worlds/boxes';
import { DataError, loadOsmData } from './worlds/osm/data';
import { OsmWorld } from './worlds/osm/world';
import { loadTerrain } from './env/terrain';
import { createFarTerrain } from './env/backdrop';
import { LoadingScreen, showError, showStartScreen, webglAvailable, type Mode } from './ui/screens';

const app = document.getElementById('app')!;
const settings = loadSettings();
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const base = import.meta.env.BASE_URL;

async function run(mode: Mode, key: string): Promise<void> {
  const loading = new LoadingScreen(app);
  const game = new Game(app, settings);
  if (debug) (window as unknown as { __game: Game }).__game = game;
  const charReady = game.character.load(`${base}models/RobotExpressive.glb`);
  try {
    if (params.get('world') === 'boxes') {
      game.setWorld(new BoxesWorld());
      new Hud(game, null);
    } else {
      const [data, terrain] = await Promise.all([
        loadOsmData(base, (f, l) => loading.set(f * 0.4, l)),
        mode === 'google' ? Promise.resolve(null) : loadTerrain(base),
      ]);
      if (mode === 'google') {
        const { startGoogle } = await import('./worlds/google/start');
        await startGoogle(game, data, key, loading);
      } else {
        const world = await OsmWorld.create(
          data,
          settings.quality,
          game.viewDistance,
          (f, l) => loading.set(0.4 + f * 0.58, l),
          terrain,
        );
        if (terrain?.far && settings.quality !== 'low')
          game.setBackdropObject(createFarTerrain(terrain.far, terrain.near.half + 200));
        game.setWorld(world);
        const hud = new Hud(game, world.data);
        if (debug) (window as unknown as { __hud: Hud }).__hud = hud;
      }
    }
    await Promise.race([charReady, new Promise((r) => setTimeout(r, 4000))]);
    loading.remove();
    game.start();
  } catch (err) {
    console.error(err);
    loading.remove();
    game.renderer.domElement.remove();
    const msg = (err as Error).message ?? String(err);
    showError(app, err instanceof DataError ? 'Harita verisi yok' : 'Hata', msg);
  }
}

async function main(): Promise<void> {
  if (!webglAvailable()) {
    showError(
      app,
      'WebGL desteklenmiyor',
      'Bu tarayıcı/cihaz WebGL 2 desteklemiyor. Güncel Chrome, Safari veya Firefox deneyin.',
    );
    return;
  }
  const auto = params.get('mode');
  if (auto === 'b' || params.get('world') === 'boxes') return run('osm', '');
  const choice = await showStartScreen(app, settings);
  await run(choice.mode, choice.key);
}

void main();
