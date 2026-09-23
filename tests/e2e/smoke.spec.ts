import { expect, test } from '@playwright/test';
import { canvasNotBlank, playerPos, serveFixture, waitForWorld, type GameDebug } from './helpers';

test('Mod B (fixture): render eder, W ile yürünür, binaya girilemez', async ({ page }) => {
  await serveFixture(page);
  await page.goto('/?debug=1');
  await page.getByTestId('mode-osm').click();
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

test('HUD: sokak adı, mini harita, ışınlanma menüsü', async ({ page }) => {
  await serveFixture(page);
  await page.goto('/?debug=1&mode=b');
  await waitForWorld(page);
  await expect(page.getByTestId('street-name')).toHaveText('502. Sokak', { timeout: 10_000 });
  const minimapDrawn = await page.evaluate(() => {
    const c = document.querySelector('.minimap canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220) white++;
    return white > 50; // yollar beyaz
  });
  expect(minimapDrawn).toBe(true);
  await expect(page.getByTestId('attribution')).toContainText('OpenStreetMap');

  // Doğan Avcıoğlu Caddesi'ne ışınlan → sokak adı değişir
  await page.keyboard.press('KeyT');
  await page.getByRole('button', { name: 'Doğan Avcıoğlu Caddesi' }).click();
  await expect(page.getByTestId('street-name')).toHaveText('Doğan Avcıoğlu Caddesi', { timeout: 10_000 });
  const p = await playerPos(page);
  expect(Math.abs(p.x - 160)).toBeLessThan(8);

  // Fotoğraf modu: HUD gizlenir, P ile çıkılır
  await page.keyboard.press('KeyP');
  await expect(page.locator('.hud')).toBeHidden();
  await page.keyboard.press('KeyP');
  await expect(page.locator('.hud')).toBeVisible();

  // Büyük harita açılır/kapanır
  await page.keyboard.press('KeyM');
  await expect(page.locator('.bigmap')).toBeVisible();
  await page.keyboard.press('KeyM');
  await expect(page.locator('.bigmap')).toBeHidden();
});

test('başlangıç ekranı: anahtarsız Mod A pasif', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('mode-google')).toBeDisabled();
  await expect(page.getByTestId('mode-osm')).toBeEnabled();
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
  await page.goto('/?debug=1&mode=b');
  await expect(page.getByText('Harita verisi bulunamadı', { exact: false })).toBeVisible({ timeout: 30_000 });
});

test.describe('mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('joystick görünür', async ({ page }) => {
    await serveFixture(page);
    await page.goto('/?debug=1&mode=b');
    await waitForWorld(page);
    await expect(page.getByTestId('joystick')).toBeVisible();
    await expect(page.getByTestId('minimap')).toBeVisible();
  });
});

test('Mod A: geçersiz anahtar (403) anlaşılır hata verir', async ({ page }) => {
  await serveFixture(page);
  await page.route('https://tile.googleapis.com/**', (r) =>
    r.fulfill({ status: 403, body: '{"error":{"code":403}}', contentType: 'application/json' }),
  );
  await page.goto('/?debug=1');
  await expect(page.getByTestId('mode-google')).toBeDisabled();
  await page.locator('[data-key]').fill('AIza-test-not-a-real-key-000');
  await page.locator('[data-act="save"]').click();
  await expect(page.getByTestId('mode-google')).toBeEnabled();
  await page.getByTestId('mode-google').click();
  await expect(page.getByTestId('error')).toContainText('403', { timeout: 30_000 });
});
