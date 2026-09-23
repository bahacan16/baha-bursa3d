import type { Game } from '../../game';
import type { SimpleOsm } from '../osm/simplify';
import type { LoadingScreen } from '../../ui/screens';

/** Faz 4'te doldurulacak. */
export async function startGoogle(
  _game: Game,
  _data: SimpleOsm,
  _key: string,
  _loading: LoadingScreen,
): Promise<void> {
  throw new Error('Mod A henüz hazır değil.');
}
