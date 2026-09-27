import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

test.describe('Pinned element placement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('supports pinning every element type and blocks geometry transforms', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const elements = await import('/elements.js');
      const factories = [
        () => elements.createTextElement('Text', { pinned: true }),
        () => elements.createImageElement('', { pinned: true }),
        () => elements.createBarcodeElement('123', { pinned: true }),
        () => elements.createQRElement('test', { pinned: true }),
        () => elements.createShapeElement('rectangle', { pinned: true }),
      ];
      const flags = factories.map(factory => factory().pinned);

      const pinned = elements.createShapeElement('rectangle', {
        pinned: true,
        x: 20,
        y: 30,
        width: 80,
        height: 60,
        rotation: 15,
      });
      const geometry = (element) => ({
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
      });

      const moved = elements.moveElements([pinned], [pinned.id], 50, 40)[0];
      const scaled = elements.scaleElements([pinned], [pinned.id], 2, 2, { x: 0, y: 0 })[0];
      const rotated = elements.rotateElements([pinned], [pinned.id], 90, { x: 0, y: 0 })[0];

      return {
        flags,
        original: geometry(pinned),
        moved: geometry(moved),
        scaled: geometry(scaled),
        rotated: geometry(rotated),
      };
    });

    expect(result.flags).toEqual([true, true, true, true, true]);
    expect(result.moved).toEqual(result.original);
    expect(result.scaled).toEqual(result.original);
    expect(result.rotated).toEqual(result.original);
  });

  test('keeps content editable, blocks placement controls, and persists the pin', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');

    await page.locator('#prop-x').fill('10');
    await page.locator('#prop-x').dispatchEvent('change');
    await expect(page.locator('#prop-pinned')).not.toBeChecked();

    await page.locator('#prop-pinned').check();
    await expect(page.locator('#prop-x')).toBeDisabled();
    await expect(page.locator('#prop-y')).toBeDisabled();
    await expect(page.locator('#prop-width')).toBeDisabled();
    await expect(page.locator('#prop-height')).toBeDisabled();
    await expect(page.locator('#prop-rotation')).toBeDisabled();
    await expect(page.locator('#prop-text-content')).toBeEnabled();

    const canvasBox = await page.locator('#preview-canvas').boundingBox();
    if (!canvasBox) throw new Error('Canvas is not visible');
    // The text is at x=80px after the 10mm edit, y=100px, and is 150x40px.
    // Canvas label coordinates start after the renderer's 120px overflow pad.
    const elementCenter = {
      x: canvasBox.x + 120 + 80 + 75,
      y: canvasBox.y + 120 + 100 + 20,
    };
    await page.mouse.move(elementCenter.x, elementCenter.y);
    await page.mouse.down();
    await page.mouse.move(elementCenter.x + 40, elementCenter.y + 25);
    await page.mouse.up();

    await page.locator('#prop-text-content').fill('Editable while pinned');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.click('#elements-btn');
    await expect(page.locator('#elements-list')).toContainText('Pinned');
    await page.click('#elements-btn');

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ArrowRight');

    await page.click('#save-btn');
    await page.locator('#save-name').fill('Pinned template');
    await page.click('#save-confirm');

    const savedElement = await page.evaluate(() => {
      const designs = JSON.parse(localStorage.getItem('phomymo_designs') || '{}');
      return designs['Pinned template'].elements[0];
    });
    expect(savedElement.pinned).toBe(true);
    expect(savedElement.x).toBe(80);
    expect(savedElement.text).toBe('Editable while pinned');

    await page.locator('#prop-pinned').uncheck();
    await expect(page.locator('#prop-x')).toBeEnabled();
    await expect(page.locator('#prop-y')).toBeEnabled();
    await expect(page.locator('#prop-width')).toBeEnabled();
    await expect(page.locator('#prop-height')).toBeEnabled();
    await expect(page.locator('#prop-rotation')).toBeEnabled();
  });
});
