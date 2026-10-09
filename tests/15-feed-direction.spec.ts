import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

async function openDesign(page, editorRotation = 0) {
  await page.addInitScript(rotation => {
    localStorage.setItem('phomymo_designs', JSON.stringify({
      'Feed direction test': {
        labelSize: { width: 50, height: 80 }, editorRotation: rotation,
        elements: [], savedAt: Date.now(),
      },
    }));
  }, editorRotation);
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
  await page.click('#load-btn');
  await page.locator('.design-item', { hasText: 'Feed direction test' }).click();
}

test('feed arrow follows rotation and zoom without intercepting canvas clicks', async ({ page }) => {
  await openDesign(page);
  const indicator = page.locator('#feed-direction');
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveAttribute('data-direction', 'up');
  await expect(indicator).toHaveCSS('pointer-events', 'none');
  await page.screenshot({ path: '/tmp/phomymo-feed-direction-portrait.png' });
  await expect(indicator).toBeInViewport();
  const initialTop = (await indicator.boundingBox())!.y;
  await page.click('#zoom-out');
  expect((await indicator.boundingBox())!.y).toBe(initialTop);
  await page.click('#rotate-design-btn');
  await expect(indicator).toHaveAttribute('data-direction', 'right');
  await expect(indicator).toHaveAttribute('aria-label', /edge printed first/);
  await page.screenshot({ path: '/tmp/phomymo-feed-direction-landscape.png' });
  await page.click('#rotate-design-btn');
  await expect(indicator).toHaveAttribute('data-direction', 'up');
});

test('saved rotated designs restore the arrow and exports remain blank', async ({ page }) => {
  await openDesign(page, 90);
  await expect(page.locator('#feed-direction')).toHaveAttribute('data-direction', 'right');
  const output = await page.evaluate(async () => {
    const { CanvasRenderer } = await import('/canvas.js');
    const renderer = new CanvasRenderer(document.createElement('canvas'));
    renderer.setDimensions(80, 50);
    const raster = renderer.getRasterData([], 72, 203, 'threshold', 'right', 'ccw');
    const exported = document.createElement('canvas');
    exported.width = renderer.labelWidth;
    exported.height = renderer.labelHeight;
    const context = exported.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, exported.width, exported.height);
    renderer.renderAllToContext(context, [], [], { forPrint: true });
    return {
      blankRaster: raster.data.every(byte => byte === 0),
      blankExport: context.getImageData(0, 0, exported.width, exported.height).data.every(byte => byte === 255),
    };
  });
  expect(output).toEqual({ blankRaster: true, blankExport: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#props-close')).not.toBeInViewport();
  await expect(page.locator('#feed-direction')).toBeInViewport();
  await page.screenshot({ path: '/tmp/phomymo-feed-direction-mobile.png', animations: 'disabled' });
});

test('feed arrow accounts for printers that rotate their raster', async ({ page }) => {
  await openDesign(page);
  await page.click('#print-settings-btn');
  await page.locator('#printer-model').selectOption('p12');
  await page.click('#print-settings-save');
  await expect(page.locator('#feed-direction')).toHaveAttribute('data-direction', 'left');
});
