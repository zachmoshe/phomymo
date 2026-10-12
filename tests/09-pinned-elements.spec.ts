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
    await page.screenshot({ path: '/tmp/phomymo-pinned-selection.png' });

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

  test('shows a dashed pinned selection, including rotated, grouped and zone-offset elements, only in the editor', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/canvas.js?v=126');
      const { createTextElement } = await import('/elements.js');
      const canvas = document.createElement('canvas');
      const renderer = new CanvasRenderer(canvas);
      renderer.setDimensions(50, 80);
      const pinned = createTextElement('Pinned', {
        x: 40, y: 50, width: 100, height: 40, rotation: 30, pinned: true,
      });
      const other = createTextElement('Other', { x: 180, y: 100 });
      const ctx = renderer.ctx;
      const strokes = [];
      const strokeRect = ctx.strokeRect.bind(ctx);
      ctx.strokeRect = (...args) => {
        strokes.push({ args, dash: ctx.getLineDash(), alpha: ctx.globalAlpha,
          color: ctx.strokeStyle, transform: Array.from(ctx.getTransform().toFloat64Array()) });
        strokeRect(...args);
      };
      const render = (elements, selection) => {
        strokes.length = 0;
        renderer.renderAll(elements, selection);
        return strokes.slice();
      };
      const single = render([pinned], [pinned.id]);
      const deselected = render([pinned], []);
      const unlocked = render([{ ...pinned, pinned: false }], [pinned.id]);
      const grouped = render([{ ...pinned, groupId: 'g' }, { ...other, groupId: 'g' }], [other.id]);
      const multiple = render([pinned, other], [pinned.id, other.id]);
      const linked = render([{ ...pinned, mirrorSourceId: other.id }], [pinned.id]);
      renderer.ditherPreview = true;
      const preview = render([pinned], [pinned.id]);
      renderer.ditherPreview = false;
      strokes.length = 0;
      renderer.renderAllToContext(ctx, [pinned], [pinned.id], { forPrint: true });
      const exported = strokes.slice();
      const raster = (el) => Array.from(renderer.getRasterDataRaw([el], 'threshold').data);
      const printUnchanged = JSON.stringify(raster(pinned)) === JSON.stringify(raster({ ...pinned, pinned: false }));
      renderer.multiLabel = { ...renderer.multiLabel, enabled: true,
        zones: [{ x: 20, y: 30, width: 300, height: 400 }] };
      const zoned = render([pinned], [pinned.id]);
      return { single, deselected, unlocked, grouped, multiple, linked, preview, exported, printUnchanged, zoned };
    });
    expect(result.single).toHaveLength(1); // No resize/rotation handles.
    expect(result.single[0].dash).toEqual([5, 3]);
    expect(result.single[0].alpha).toBeCloseTo(0.65);
    expect(result.single[0].color).toBe('#3b82f6');
    expect(result.single[0].args).toEqual([-53, -23, 106, 46]);
    expect(result.single[0].transform[0]).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(result.single[0].transform[1]).toBeCloseTo(Math.sin(Math.PI / 6));
    expect(result.deselected).toEqual([]);
    expect(result.unlocked[0].dash).toEqual([]);
    for (const selection of [result.grouped, result.multiple]) {
      expect(selection).toHaveLength(1);
      expect(selection[0].dash).toEqual([5, 3]);
    }
    expect(result.linked.some(stroke => stroke.color === '#3b82f6')).toBe(true);
    expect(result.preview).toEqual([]);
    expect(result.exported).toEqual([]);
    expect(result.printUnchanged).toBe(true);
    expect(result.zoned[0].transform[12] - result.single[0].transform[12]).toBe(20);
    expect(result.zoned[0].transform[13] - result.single[0].transform[13]).toBe(30);
  });
});
