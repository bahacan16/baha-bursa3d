import type { Game } from '../../game';
import type { SimpleOsm } from '../osm/simplify';
import type { LoadingScreen } from '../../ui/screens';
import { parseOsm } from '../osm/parse';
import { Hud } from '../../hud/hud';
import { isMobileDevice } from '../../core/settings';
import { GoogleWorld } from './tiles';
import { showError } from '../../ui/screens';
import { OsmSoundScene } from '../../env/sound/osmscene';
import { startPoint } from '../../core/start';

function calibration(): { x: number; z: number } | undefined {
  const v = new URLSearchParams(location.search).get('gcal');
  if (!v) return undefined;
  const [x, z] = v.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : undefined;
}

/**
 * Mod A başlatma: OSM verisi yalnızca HUD için ayrıştırılır (render edilmez).
 * Tile'lar yüklenip oyuncunun altına zemin gelene kadar yükleme ekranı gösterilir.
 */
export async function startGoogle(
  game: Game,
  data: SimpleOsm,
  key: string,
  loading: LoadingScreen,
): Promise<void> {
  const osm = parseOsm(data);
  const world = new GoogleWorld({
    apiKey: key,
    center: data.center,
    errorTarget: game.settings.googleErrorTarget,
    mobile: isMobileDevice(),
    renderer: game.renderer,
    camera: game.camera,
    offset: calibration(),
  });
  world.sound = new OsmSoundScene(osm, { real: data.centerSource !== 'fixture' });
  game.setWorld(world);
  // Yüksekten başla, kamera aşağı baksın
  const st = startPoint(data.centerSource !== 'fixture');
  game.teleport(st.x, 450, st.z);
  game.follow.pitch = -0.6;
  world.spawner.reset(st.x, st.z);
  const hud = new Hud(game, osm);
  if (game.debug) (window as unknown as { __hud: Hud }).__hud = hud;

  let fired = false;
  await new Promise<void>((resolve, reject) => {
    world.onError = (msg) => {
      if (fired) {
        hud.toast(msg, 8);
        return;
      }
      fired = true;
      reject(new Error(msg));
    };
    const prev = game.hooks.onFrame;
    game.hooks.onFrame = (g, dt) => {
      prev?.(g, dt);
      const idle = world.tiles.loadProgress >= 0.999;
      const st = world.spawner.update(dt, g.controller, idle);
      if (fired) return;
      if (st === 'ready') {
        fired = true;
        g.follow.pitch = -0.2;
        g.follow.snap();
        resolve();
      } else if (st === 'nocoverage') {
        fired = true;
        loading.remove();
        showError(
          game.container,
          'Bu bölgede Google 3D verisi yok',
          'Merkez çevresinde fotogerçekçi 3D mesh bulunamadı. Mod B (OpenStreetMap) ile oynayabilirsiniz.',
          [{ label: 'Mod B ile oyna', fn: () => (location.href = location.pathname + '?mode=b') }],
        );
        resolve();
      } else {
        const p = world.tiles.loadProgress;
        loading.set(
          0.4 + 0.6 * (st === 'settling' ? 0.7 + 0.3 * p : 0.7 * p),
          st === 'settling' ? 'Yakın çevre yükleniyor…' : "Google 3D tile'ları yükleniyor…",
        );
      }
    };
    game.start();
  });
}
