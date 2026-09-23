import { expect, test } from '@playwright/test';
import { canvasNotBlank, playerPos, serveFixture, waitForWorld, type GameDebug } from './helpers';

test('Mod B (fixture): render eder, W ile yürünür, binaya girilemez', async ({ page }) => {
  await serveFixture(page);
  await page.goto('/?debug=1');
  await waitForWorld(page);
  await page.waitForTimeout(1500);
  expect(await canvasNotBlank(page)).toBe(true);
  const calls = await page.evaluate(
    () => (window as unknown as { __game: GameDebug }).__game.renderer.info.render.calls,
  );
  expect(calls).toBeLessThan(300);

  const before = await playerPos(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  const after = await playerPos(page);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1);

  // Kuzeydeki binaya (x=−24, z∈[−28,−16]) doğru koş: ön yüz z=−16'yı geçememeli
  await page.evaluate(() => {
    const g = (window as unknown as { __game: GameDebug }).__game;
    g.teleport(-24, 0, -8);
    g.follow.yaw = 0;
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const blocked = await playerPos(page);
  expect(blocked.z).toBeGreaterThan(-16);
  expect(blocked.z).toBeLessThan(-14.5);
});

test('test dünyası: kutuya çarpılır', async ({ page }) => {
  await page.goto('/?debug=1&world=boxes');
  await waitForWorld(page);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(4000);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  expect((await playerPos(page)).z).toBeGreaterThan(-10);
});

test('veri yoksa anlaşılır hata ekranı', async ({ page }) => {
  await page.route('**/data/osm.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route(/overpass/, (r) => r.abort());
  await page.goto('/?debug=1');
  await expect(page.getByText('Harita verisi bulunamadı', { exact: false })).toBeVisible({ timeout: 30_000 });
});

test.describe('mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('joystick görünür', async ({ page }) => {
    await serveFixture(page);
    await page.goto('/?debug=1');
    await waitForWorld(page);
    await expect(page.getByTestId('joystick')).toBeVisible();
  });
});
