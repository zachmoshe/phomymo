import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog, screenshot } from './helpers/app';

const CH = '01-getting-started';

test.describe.serial('Getting Started', () => {
  test('app loads successfully', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);

    await expect(page.locator('#preview-canvas')).toBeVisible();
    await expect(page.locator('#add-text')).toBeVisible();
    await expect(page.locator('#add-image')).toBeVisible();
    await expect(page.locator('#add-barcode')).toBeVisible();
    await expect(page.locator('#add-qr')).toBeVisible();

    await screenshot(page, CH, 1, 'app-loaded');
  });

  test('interface overview', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);

    await expect(page.locator('#props-panel')).toBeVisible();
    await expect(page.locator('#label-size')).toBeVisible();
    await expect(page.locator('.app-header .header-file-actions #new-btn')).toBeVisible();
    await expect(page.locator('.app-header .header-file-actions #save-btn')).toBeVisible();
    await expect(page.locator('.app-header .header-file-actions #load-btn')).toBeVisible();
    await expect(page.locator('.app-header .header-file-actions #export-btn')).toBeVisible();
    await expect(page.locator('#new-btn span')).toBeVisible();
    await expect(page.locator('#connect-btn')).toBeVisible();
    await expect(page.locator('#print-btn')).toBeVisible();

    const fileActionsFollowSize = await page.evaluate(() => {
      const size = document.querySelector('#label-size')!.getBoundingClientRect();
      const newButton = document.querySelector('#new-btn')!.getBoundingClientRect();
      return newButton.left >= size.right;
    });
    expect(fileActionsFollowSize).toBe(true);

    const newButtonStyle = await page.locator('#new-btn').evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.color, backgroundImage: style.backgroundImage };
    });
    expect(newButtonStyle.color).toBe('rgb(255, 255, 255)');
    expect(newButtonStyle.backgroundImage).toContain('linear-gradient');

    await screenshot(page, CH, 2, 'interface-overview');
  });
});
