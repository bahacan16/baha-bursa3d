import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DEFAULT_CENTER_LITE, simplifyOverpass, type OverpassJson } from '../../src/worlds/osm/simplify';

/** Ağ gerektirmeyen testler için: data/osm.json isteğini sentetik fixture ile karşıla. */
export async function serveFixture(page: Page): Promise<void> {
  // Yazılımsal GPU'da hızlı olsun: Düşük kalite
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nilufer-walk.settings', JSON.stringify({ quality: 'low' }));
    } catch {
      /* yoksay */
    }
  });
  const raw = JSON.parse(readFileSync('tests/fixtures/osm-small.json', 'utf8')) as OverpassJson;
  const body = JSON.stringify(simplifyOverpass(raw, DEFAULT_CENTER_LITE, 'fixture'));
  await page.route('**/data/osm.json', (r) => r.fulfill({ body, contentType: 'application/json' }));
  await page.route('**/data/meta.json', (r) =>
    r.fulfill({ body: JSON.stringify({ centerSource: 'fixture' }), contentType: 'application/json' }),
  );
  // Overpass'a gerçek istek gitmesin
  await page.route(/overpass/, (r) => r.abort());
}

export type GameDebug = {
  controller: { position: { x: number; y: number; z: number } };
  follow: { yaw: number };
  world: unknown;
  teleport(x: number, y: number, z: number): void;
  renderer: { info: { render: { calls: number } } };
};

export async function playerPos(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __game: GameDebug }).__game;
    const p = g.controller.position;
    return { x: p.x, y: p.y, z: p.z };
  });
}

export async function waitForWorld(page: Page) {
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __game?: GameDebug }).__game;
      return !!g && !!g.world;
    },
    null,
    { timeout: 60_000 },
  );
}

export async function canvasNotBlank(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas.game') as HTMLCanvasElement;
    const tmp = document.createElement('canvas');
    tmp.width = 64;
    tmp.height = 36;
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    const first = [d[0], d[1], d[2]];
    let distinct = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - first[0]) + Math.abs(d[i + 1] - first[1]) + Math.abs(d[i + 2] - first[2]) > 30)
        distinct++;
    }
    return distinct > 50;
  });
}
