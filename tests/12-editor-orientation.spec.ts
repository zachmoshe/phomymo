import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

const STORAGE_KEY = 'phomymo_designs';

async function openApp(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
}

test.describe('Rotated design view', () => {
  test('M220 preserves physical roll alignment in both editor views', async ({ page }) => {
    await openApp(page);
    const results = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/canvas.js');
      const { createShapeElement } = await import('/elements.js');
      const printers = await import('/printer.js');
      await printers.loadPrinterDefinitions();
      const renderer = new CanvasRenderer(document.createElement('canvas'));
      return ['auto', 'm220'].flatMap(model =>
        ['none', 'ccw'].flatMap(rotation =>
        ['threshold', 'floyd-steinberg'].map(dither => {
          const rotated = rotation === 'ccw';
          renderer.setDimensions(rotated ? 80 : 50, rotated ? 50 : 80);
          // A solid full-label rectangle makes both physical edges measurable.
          const elements = [createShapeElement('rectangle', {
            x: 0, y: 0, width: renderer.labelWidth, height: renderer.labelHeight,
            fill: 'black', stroke: 'none',
          })];
          const raster = renderer.getRasterData(
            elements,
            printers.getPrinterWidthBytes('M220', model),
            printers.getPrinterDpi('M220', model),
            dither,
            printers.getPrinterAlignment('M220', model),
            rotation
          );
          // Both views keep the same 22 mm leading print-head padding.
          const start = 22;
          const rowsCorrect = Array.from({ length: raster.heightLines }, (_, y) => {
            const row = raster.data.slice(y * raster.widthBytes, (y + 1) * raster.widthBytes);
            return row.every((byte, x) => byte === (x >= start && x < start + 50 ? 255 : 0));
          }).every(Boolean);
          return { model, rotation, dither, width: raster.widthBytes, height: raster.heightLines, rowsCorrect };
        }))
      );
    });
    for (const result of results) {
      expect(result, `${result.model}, ${result.rotation}, ${result.dither}`).toMatchObject({
        width: 72, height: 640, rowsCorrect: true,
      });
    }
  });

  test('M220 prints asymmetric edge markers identically from portrait and rotated views', async ({ page }) => {
    await openApp(page);
    const results = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/canvas.js');
      const { createShapeElement } = await import('/elements.js');
      const printers = await import('/printer.js');
      await printers.loadPrinterDefinitions();
      const renderer = new CanvasRenderer(document.createElement('canvas'));
      // Different marks at all four physical edges catch clipping, translation,
      // and a rotation in the wrong direction (a solid label cannot).
      const rectangles = [
        { x: 0, y: 16, width: 8, height: 40 },
        { x: 384, y: 560, width: 16, height: 64 },
        { x: 80, y: 0, width: 48, height: 8 },
        { x: 240, y: 624, width: 72, height: 16 },
      ];
      const portrait = rectangles.map(rect => createShapeElement('rectangle', {
        ...rect, fill: 'black', stroke: 'none',
      }));
      const landscape = rectangles.map(rect => createShapeElement('rectangle', {
        x: 640 - rect.y - rect.height, y: rect.x,
        width: rect.height, height: rect.width, fill: 'black', stroke: 'none',
      }));
      return ['threshold', 'floyd-steinberg'].map(dither => {
        const width = printers.getPrinterWidthBytes('M220');
        const dpi = printers.getPrinterDpi('M220');
        const alignment = printers.getPrinterAlignment('M220');
        renderer.setDimensions(50, 80);
        const regular = renderer.getRasterData(portrait, width, dpi, dither, alignment);
        renderer.setDimensions(80, 50);
        const rotated = renderer.getRasterData(landscape, width, dpi, dither, alignment, 'ccw');
        return {
          dither,
          hasInk: regular.data.some(byte => byte !== 0),
          identical: regular.widthBytes === rotated.widthBytes
            && regular.heightLines === rotated.heightLines
            && regular.data.length === rotated.data.length
            && regular.data.every((byte, index) => byte === rotated.data[index]),
        };
      });
    });
    for (const result of results) {
      expect(result, result.dither).toMatchObject({ hasInk: true, identical: true });
    }
  });

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
