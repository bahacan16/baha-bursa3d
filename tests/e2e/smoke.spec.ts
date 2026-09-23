import { expect, test } from '@playwright/test';

test('sayfa açılır ve canvas render eder', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
});
