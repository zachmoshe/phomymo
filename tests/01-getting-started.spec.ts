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

    // The labeled actions should still fit without colliding with connection controls.
    await page.setViewportSize({ width: 1200, height: 900 });
    const topRowFits = await page.evaluate(() => {
      const actions = document.querySelector('.header-file-actions')!.getBoundingClientRect();
      const connection = document.querySelector('#conn-type')!.getBoundingClientRect();
      return actions.right <= connection.left;
    });
    expect(topRowFits).toBe(true);
  });

  test('new label clears the design but preserves the selected size', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);

    await page.locator('#label-size').selectOption('50x30');
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await expect(page.locator('#props-text')).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    await page.click('#new-btn');

    await expect(page.locator('#label-size')).toHaveValue('50x30');
    await expect(page.locator('#print-size')).toHaveText('50 x 30 mm');
    await expect(page.locator('#props-empty')).toBeVisible();
    await expect(page.locator('#undo-btn')).toBeDisabled();

    await page.click('#elements-btn');
    await expect(page.locator('#elements-list')).toContainText('No elements');
  });

  test('template button is available before fields are added', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);

    await expect(page.locator('#template-toolbar-btn')).toBeVisible();
    await expect(page.locator('#template-toolbar-label')).toHaveText('Template');
    await page.click('#template-toolbar-btn');
    await expect(page.locator('#template-panel')).toBeVisible();
    await expect(page.locator('#template-field-count')).toHaveText('0');
  });

  test('template button stays intact at compact desktop widths', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);

    const bounds = await page.locator('#template-toolbar-btn').evaluate(button => {
      const buttonRect = button.getBoundingClientRect();
      const iconRect = button.querySelector('svg')!.getBoundingClientRect();
      const labelRect = button.querySelector('#template-toolbar-label')!.getBoundingClientRect();
      return {
        button: { left: buttonRect.left, right: buttonRect.right, width: buttonRect.width },
        icon: { left: iconRect.left, right: iconRect.right },
        label: { left: labelRect.left, right: labelRect.right },
        viewportWidth: window.innerWidth,
      };
    });

    expect(bounds.button.width).toBeGreaterThanOrEqual(96);
    expect(bounds.icon.left).toBeGreaterThanOrEqual(bounds.button.left);
    expect(bounds.label.left).toBeGreaterThan(bounds.icon.right);
    expect(bounds.label.right).toBeLessThanOrEqual(bounds.button.right);
    expect(bounds.button.right).toBeLessThanOrEqual(bounds.viewportWidth);
  });
});
