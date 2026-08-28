import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

test.describe('Measurements and non-printable guides', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('uses millimetres by default and can switch to pixels', async ({ page }) => {
    await page.click('#add-shape-btn');
    await page.click('button[data-shape="rectangle"]');

    await expect(page.locator('#measurement-unit')).toHaveValue('mm');
    await expect(page.locator('#prop-width')).toHaveValue('10');

    await page.locator('#prop-width').fill('12.5');
    await page.locator('#prop-width').dispatchEvent('change');
    await page.locator('#measurement-unit').selectOption('px');
    await expect(page.locator('#prop-width')).toHaveValue('100');

    await page.locator('#prop-width').fill('160');
    await page.locator('#prop-width').dispatchEvent('change');
    await page.locator('#measurement-unit').selectOption('mm');
    await expect(page.locator('#prop-width')).toHaveValue('20');
  });

  test('supports the non-printable flag on every element type', async ({ page }) => {
    const flags = await page.evaluate(async () => {
      const elements = await import('/elements.js');
      const factories = [
        () => elements.createTextElement('Text', { nonPrintable: true }),
        () => elements.createImageElement('', { nonPrintable: true }),
        () => elements.createBarcodeElement('123', { nonPrintable: true }),
        () => elements.createQRElement('test', { nonPrintable: true }),
        () => elements.createShapeElement('rectangle', { nonPrintable: true }),
      ];
      return factories.map(factory => factory().nonPrintable);
    });

    expect(flags).toEqual([true, true, true, true, true]);

    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await expect(page.locator('#prop-non-printable')).toBeVisible();
    await expect(page.locator('#prop-non-printable')).not.toBeChecked();
    await page.locator('#prop-non-printable').check();
    await expect(page.locator('#prop-non-printable')).toBeChecked();
  });

  test('renders guides at 50% but omits them from print output', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/canvas.js');
      const rendererCanvas = document.createElement('canvas');
      const renderer = new CanvasRenderer(rendererCanvas);
      renderer.setDimensions(10, 10);

      const guide = {
        id: 'guide',
        type: 'shape',
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        rotation: 0,
        shapeType: 'rectangle',
        fill: 'black',
        stroke: 'none',
        strokeWidth: 0,
        cornerRadius: 0,
        nonPrintable: true,
      };

      const designCanvas = document.createElement('canvas');
      designCanvas.width = 80;
      designCanvas.height = 80;
      const designCtx = designCanvas.getContext('2d')!;
      renderer.renderAllToContext(designCtx, [guide]);
      const designAlpha = designCtx.getImageData(40, 40, 1, 1).data[3];

      const guideRaster = renderer.getRasterDataRaw([guide], 'threshold').data;
      const printableRaster = renderer.getRasterDataRaw(
        [{ ...guide, nonPrintable: false }],
        'threshold'
      ).data;

      return {
        designAlpha,
        guideHasInk: Array.from(guideRaster).some(value => value !== 0),
        printableHasInk: Array.from(printableRaster).some(value => value !== 0),
      };
    });

    expect(result.designAlpha).toBeGreaterThanOrEqual(127);
    expect(result.designAlpha).toBeLessThanOrEqual(128);
    expect(result.guideHasInk).toBe(false);
    expect(result.printableHasInk).toBe(true);
  });
});
