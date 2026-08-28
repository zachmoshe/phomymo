import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog, deselectAll, screenshot, elementScreenshot } from './helpers/app';

const CH = '03-element-properties';

test.describe.serial('Element Properties', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('text element properties', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(page.locator('#props-text')).toBeVisible();
    await elementScreenshot(page, '#props-panel', CH, 1, 'text-properties-panel');

    // Modify text content
    await page.locator('#prop-text-content').fill('Hello World');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.waitForTimeout(200);

    // Modify font size
    await page.locator('#prop-font-size').fill('36');
    await page.locator('#prop-font-size').dispatchEvent('change');
    await page.waitForTimeout(200);

    const content = await page.locator('#prop-text-content').inputValue();
    expect(content).toBe('Hello World');

    await screenshot(page, CH, 2, 'text-properties-modified');
  });

  test('barcode element properties', async ({ page }) => {
    await page.click('#add-barcode');
    await page.waitForTimeout(300);

    await expect(page.locator('#props-barcode')).toBeVisible();
    await elementScreenshot(page, '#props-panel', CH, 3, 'barcode-properties-panel');

    await page.locator('#prop-barcode-data').fill('PHOMYMO-TEST');
    await page.locator('#prop-barcode-data').dispatchEvent('input');
    await page.waitForTimeout(200);

    await screenshot(page, CH, 4, 'barcode-properties-modified');
  });

  test('QR code element properties', async ({ page }) => {
    await page.click('#add-qr');
    await page.waitForTimeout(300);

    await expect(page.locator('#props-qr')).toBeVisible();
    await elementScreenshot(page, '#props-panel', CH, 5, 'qr-properties-panel');

    await page.locator('#prop-qr-data').fill('https://phomymo.affordablemagic.net');
    await page.locator('#prop-qr-data').dispatchEvent('input');
    await page.waitForTimeout(200);

    await screenshot(page, CH, 6, 'qr-properties-modified');
  });

  test('shape element properties', async ({ page }) => {
    await page.click('#add-shape-btn');
    await page.click('button[data-shape="ellipse"]');
    await page.waitForTimeout(300);

    await expect(page.locator('#props-shape')).toBeVisible();
    await elementScreenshot(page, '#props-panel', CH, 7, 'shape-properties-panel');

    await page.locator('#prop-shape-type').selectOption('triangle');
    await page.waitForTimeout(200);

    const transparentFill = page.locator('.shape-fill-btn[data-fill="none"]');
    await transparentFill.click();
    await expect(transparentFill).toHaveAttribute('aria-pressed', 'true');

    await page.locator('.stroke-btn[data-stroke="black"]').click();
    const dashedStroke = page.locator('.stroke-dash-btn[data-dash="dashed"]');
    await dashedStroke.click();
    await expect(dashedStroke).toHaveAttribute('aria-pressed', 'true');

    const renderSupport = await page.evaluate(async () => {
      const [{ CanvasRenderer }, { createShapeElement }] = await Promise.all([
        import('/canvas.js'),
        import('/elements.js'),
      ]);
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 60;
      const renderer = new CanvasRenderer(canvas);
      renderer.ctx.translate(40, 30);
      renderer.renderShapeElement({
        shapeType: 'rectangle',
        fill: 'none',
        stroke: 'none',
        strokeWidth: 2,
        strokeDash: 'solid',
        cornerRadius: 0,
      }, 40, 30);

      return {
        transparentAlpha: renderer.ctx.getImageData(40, 30, 1, 1).data[3],
        defaultShape: createShapeElement('rectangle'),
        dashedPattern: renderer.getStrokeDashPattern('dashed', 2),
        dottedPattern: renderer.getStrokeDashPattern('dotted', 2),
        dashDotPattern: renderer.getStrokeDashPattern('dash-dot', 2),
      };
    });

    expect(renderSupport.transparentAlpha).toBe(0);
    expect(renderSupport.defaultShape.fill).toBe('none');
    expect(renderSupport.defaultShape.stroke).toBe('black');
    expect(renderSupport.defaultShape.strokeDash).toBe('solid');
    expect(renderSupport.dashedPattern.length).toBe(2);
    expect(renderSupport.dottedPattern.length).toBe(2);
    expect(renderSupport.dashDotPattern.length).toBe(4);

    await screenshot(page, CH, 8, 'shape-properties-modified');

    // The mobile bottom sheet exposes the same swatches and pattern choices.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobile-edit-btn').click();
    await expect(page.locator('[data-mobile-fill="none"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-mobile-dash="dashed"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-mobile-dash="dotted"]').click();
    await expect(page.locator('[data-mobile-dash="dotted"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('position and size properties', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(page.locator('#prop-x')).toBeVisible();
    await expect(page.locator('#prop-y')).toBeVisible();
    await expect(page.locator('#prop-width')).toBeVisible();
    await expect(page.locator('#prop-height')).toBeVisible();

    await screenshot(page, CH, 9, 'position-properties');
  });
});
