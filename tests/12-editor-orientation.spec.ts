import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

const STORAGE_KEY = 'phomymo_designs';

async function openApp(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
}

test.describe('Rotated design view', () => {
  test('keeps physical size while rotating the editor and existing elements', async ({ page }) => {
    await openApp(page);
    await page.evaluate(key => {
      localStorage.setItem(key, JSON.stringify({
        'M220 folded label': {
          labelSize: { width: 50, height: 80 },
          editorRotation: 0,
          elements: [{
            id: 'shape-1',
            type: 'shape',
            shapeType: 'rectangle',
            x: 20,
            y: 30,
            width: 80,
            height: 40,
            rotation: 0,
            fill: 'transparent',
            stroke: 'black',
            strokeWidth: 2,
          }],
          savedAt: Date.now(),
        },
      }));
    }, STORAGE_KEY);

    await page.click('#load-btn');
    await page.locator('.design-item', { hasText: 'M220 folded label' }).click();
    const portraitCanvas = await page.locator('#preview-canvas').evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width,
      height: canvas.height,
    }));

    await page.click('#rotate-design-btn');

    await expect(page.locator('#print-size')).toHaveText('50 x 80 mm');
    await expect(page.locator('#rotate-design-btn')).toHaveAttribute('aria-pressed', 'true');
    const landscapeCanvas = await page.locator('#preview-canvas').evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    expect(landscapeCanvas.width).toBe(portraitCanvas.height);
    expect(landscapeCanvas.height).toBe(portraitCanvas.width);

    await page.click('#save-btn');
    if (await page.locator('#save-dialog').isVisible()) {
      await page.locator('#save-name').fill('M220 folded label');
      await page.click('#save-confirm');
    }
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}')['M220 folded label'], STORAGE_KEY);
    expect(saved.labelSize).toMatchObject({ width: 50, height: 80 });
    expect(saved.editorRotation).toBe(90);
    expect(saved.elements[0].rotation).toBe(90);
    expect(saved.elements[0].x).toBeCloseTo(550);
    expect(saved.elements[0].y).toBeCloseTo(40);

    await page.click('#rotate-design-btn');
    await page.click('#save-btn');
    if (await page.locator('#save-dialog').isVisible()) {
      await page.locator('#save-name').fill('M220 folded label');
      await page.click('#save-confirm');
    }
    const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}')['M220 folded label'], STORAGE_KEY);
    expect(restored.editorRotation).toBe(0);
    expect(restored.elements[0].rotation).toBe(0);
    expect(restored.elements[0].x).toBeCloseTo(20);
    expect(restored.elements[0].y).toBeCloseTo(30);
  });

  test('rotates the editor raster back to physical dimensions', async ({ page }) => {
    await openApp(page);

    const raster = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/canvas.js?v=123');
      const canvas = document.createElement('canvas');
      const renderer = new CanvasRenderer(canvas);
      renderer.setDimensions(8, 5, 1, false);
      const result = renderer.getRasterDataRaw([], 'threshold', 'ccw');
      return { widthBytes: result.widthBytes, heightLines: result.heightLines };
    });

    // The 8 × 5 mm editor surface is 64 × 40 dots. Rotating it back produces
    // a physical 5 × 8 mm raster: 40 dots wide and 64 dots tall.
    expect(raster).toEqual({ widthBytes: 5, heightLines: 64 });
  });
});
