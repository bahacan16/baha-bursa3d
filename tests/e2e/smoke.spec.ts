import { expect, test, type Page } from '@playwright/test';

type GameDebug = {
  controller: { position: { x: number; y: number; z: number } };
  renderer: { info: { render: { calls: number } } };
};

async function playerPos(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __game: GameDebug }).__game;
    const p = g.controller.position;
    return { x: p.x, y: p.y, z: p.z };
  });
}

async function canvasNotBlank(page: Page) {
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

test('test dünyası: render eder, W ile yürünür, kutuya çarpılır', async ({ page }) => {
  await page.goto('/?debug=1&world=boxes');
  await page.waitForFunction(() => !!(window as unknown as { __game?: unknown }).__game);
  await page.waitForTimeout(1500);
  expect(await canvasNotBlank(page)).toBe(true);
  const before = await playerPos(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  const mid = await playerPos(page);
  expect(mid.z).toBeLessThan(before.z - 1);
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(3500);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  const after = await playerPos(page);
  // (0, -12) merkezli 4 m derinlikte kutu: ön yüz z = −10
  expect(after.z).toBeGreaterThan(-10);
});

test.describe('mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('joystick görünür', async ({ page }) => {
    await page.goto('/?debug=1&world=boxes');
    await expect(page.getByTestId('joystick')).toBeVisible();
  });
});
