import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

test.describe('Linked copies', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('creates, synchronizes, migrates, and cascade-deletes links for every element type', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const elements = await import('/elements.js');
      const sources = [
        elements.createTextElement('Front'),
        elements.createImageElement('data:image/png;base64,'),
        elements.createBarcodeElement('123456'),
        elements.createQRElement('https://example.com'),
        elements.createShapeElement('rectangle'),
      ];

      const supportedTypes = sources.map((source) => {
        const withMirror = elements.createMirroredElement([source], source.id, 'horizontal');
        const child = elements.getMirroredChild(withMirror, source.id);
        return {
          type: child?.type,
          sourceId: child?.mirrorSourceId,
          layout: child?.linkedCopyLayout,
          horizontal: child?.linkedFlipHorizontal,
          vertical: child?.linkedFlipVertical,
        };
      });
      const layouts = ['horizontal', 'vertical'].map((layout) => {
        const withMirror = elements.createMirroredElement([sources[0]], sources[0].id, layout);
        return elements.getMirroredChild(withMirror, sources[0].id)?.linkedCopyLayout;
      });

      const source = elements.createTextElement('Front', {
        x: 10,
        y: 15,
        width: 100,
        height: 40,
        fontSize: 20,
      });
      let design = elements.createMirroredElement([source], source.id, 'vertical');
      let child = elements.getMirroredChild(design, source.id);
      child.x = 260;
      child.y = 180;
      child.linkedFlipHorizontal = true;

      design = elements.updateElement(design, source.id, {
        text: 'Back follows front',
        width: 140,
        height: 55,
        rotation: 30,
        fontSize: 32,
        x: 75,
        y: 85,
      });
      design = elements.synchronizeMirroredElements(design);
      child = elements.getMirroredChild(design, source.id);

      const synchronized = {
        text: child.text,
        width: child.width,
        height: child.height,
        rotation: child.rotation,
        fontSize: child.fontSize,
        x: child.x,
        y: child.y,
        horizontal: child.linkedFlipHorizontal,
        vertical: child.linkedFlipVertical,
      };

      const legacySource = elements.createTextElement('Legacy');
      let legacyDesign = elements.createMirroredElement([legacySource], legacySource.id, 'horizontal');
      const legacyChild = elements.getMirroredChild(legacyDesign, legacySource.id);
      delete legacyChild.linkedCopyLayout;
      delete legacyChild.linkedFlipHorizontal;
      delete legacyChild.linkedFlipVertical;
      legacyChild.mirrorAxis = 'x';
      legacyDesign = elements.synchronizeMirroredElements(legacyDesign);
      const migratedChild = elements.getMirroredChild(legacyDesign, legacySource.id);

      const duplicate = elements.duplicateElement(design, child.id).at(-1);
      const afterChildDelete = elements.deleteElement(design, child.id);
      const afterSourceDelete = elements.deleteElement(design, source.id);

      return {
        supportedTypes,
        layouts,
        sourceIds: sources.map((item) => item.id),
        synchronized,
        migrated: {
          layout: migratedChild.linkedCopyLayout,
          horizontal: migratedChild.linkedFlipHorizontal,
          vertical: migratedChild.linkedFlipVertical,
          hasOldMode: Object.prototype.hasOwnProperty.call(migratedChild, 'mirrorAxis'),
        },
        duplicateIsIndependent: !duplicate.mirrorSourceId &&
          !duplicate.linkedCopyLayout &&
          duplicate.linkedFlipHorizontal === undefined &&
          duplicate.linkedFlipVertical === undefined,
        sourceSurvivesChildDelete: afterChildDelete.some((item) => item.id === source.id),
        sourceDeleteCount: afterSourceDelete.length,
      };
    });

    expect(result.supportedTypes.map((item) => item.type)).toEqual([
      'text', 'image', 'barcode', 'qr', 'shape',
    ]);
    expect(result.supportedTypes.map((item) => item.layout)).toEqual([
      'horizontal', 'horizontal', 'horizontal', 'horizontal', 'horizontal',
    ]);
    expect(result.supportedTypes.map((item) => item.horizontal)).toEqual([
      false, false, false, false, false,
    ]);
    expect(result.supportedTypes.map((item) => item.vertical)).toEqual([
      false, false, false, false, false,
    ]);
    expect(result.supportedTypes.map((item) => item.sourceId)).toEqual(result.sourceIds);
    expect(result.layouts).toEqual(['horizontal', 'vertical']);
    expect(result.synchronized).toEqual({
      text: 'Back follows front',
      width: 140,
      height: 55,
      rotation: 30,
      fontSize: 32,
      x: 260,
      y: 180,
      horizontal: true,
      vertical: false,
    });
    expect(result.migrated).toEqual({
      layout: 'vertical',
      horizontal: false,
      vertical: true,
      hasOldMode: false,
    });
    expect(result.duplicateIsIndependent).toBe(true);
    expect(result.sourceSurvivesChildDelete).toBe(true);
    expect(result.sourceDeleteCount).toBe(0);
  });

  test('offers linked-copy controls while keeping only placement editable on the child', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await expect(page.locator('#prop-create-mirror')).toBeVisible();
    await page.locator('#prop-mirror-layout').selectOption('horizontal');
    await page.click('#prop-create-mirror');

    await expect(page.locator('#prop-mirror-child-controls')).toBeVisible();
    await expect(page.locator('#props-text')).toBeHidden();
    await expect(page.locator('#prop-width')).toBeDisabled();
    await expect(page.locator('#prop-height')).toBeDisabled();
    await expect(page.locator('#prop-rotation')).toBeDisabled();
    await expect(page.locator('#prop-x')).toBeEnabled();
    await expect(page.locator('#prop-y')).toBeEnabled();
    await expect(page.locator('#prop-linked-flip-horizontal')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#prop-linked-flip-vertical')).toHaveAttribute('aria-pressed', 'false');

    await page.click('#prop-linked-flip-horizontal');
    await expect(page.locator('#prop-linked-flip-horizontal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#prop-linked-flip-vertical')).toHaveAttribute('aria-pressed', 'false');
    await page.click('#prop-linked-flip-vertical');
    await expect(page.locator('#prop-linked-rotate-180')).toHaveAttribute('aria-pressed', 'true');
    await page.click('[data-linked-transform="reset"]');
    await expect(page.locator('#prop-linked-flip-horizontal')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#prop-linked-flip-vertical')).toHaveAttribute('aria-pressed', 'false');
    await page.click('#prop-linked-rotate-180');
    await expect(page.locator('#prop-linked-flip-horizontal')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#prop-linked-flip-vertical')).toHaveAttribute('aria-pressed', 'true');

    const initialBounds = await Promise.all([
      page.locator('#prop-x').inputValue(),
      page.locator('#prop-y').inputValue(),
      page.locator('#prop-width').inputValue(),
      page.locator('#prop-height').inputValue(),
    ]).then(([x, y, width, height]) => ({
      x: Number(x), y: Number(y), width: Number(width), height: Number(height),
    }));
    expect(initialBounds.x).toBeGreaterThanOrEqual(0);
    expect(initialBounds.y).toBeGreaterThanOrEqual(0);
    expect(initialBounds.x + initialBounds.width).toBeLessThanOrEqual(40);
    expect(initialBounds.y + initialBounds.height).toBeLessThanOrEqual(30);

    await page.click('#prop-select-mirror-source');
    const sourceBounds = await Promise.all([
      page.locator('#prop-x').inputValue(),
      page.locator('#prop-width').inputValue(),
    ]).then(([x, width]) => ({ x: Number(x), width: Number(width) }));
    expect(
      sourceBounds.x + sourceBounds.width <= initialBounds.x ||
      initialBounds.x + initialBounds.width <= sourceBounds.x
    ).toBe(true);
    await page.click('#prop-select-mirror');

    await page.locator('#prop-x').fill('35');
    await page.locator('#prop-x').dispatchEvent('change');
    await page.click('#prop-select-mirror-source');

    await expect(page.locator('#props-text')).toBeVisible();
    await page.locator('#prop-text-content').fill('Folded label');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.locator('#prop-width').fill('18');
    await page.locator('#prop-width').dispatchEvent('change');
    await page.locator('#prop-rotation').fill('30');
    await page.locator('#prop-rotation').dispatchEvent('change');

    await page.click('#prop-select-mirror');
    await expect(page.locator('#prop-width')).toHaveValue('18');
    await expect(page.locator('#prop-rotation')).toHaveValue('30');
    await expect(page.locator('#prop-x')).toHaveValue('35');

    await page.click('#save-btn');
    await page.locator('#save-name').fill('Folded sticker');
    await page.click('#save-confirm');
    const savedElements = await page.evaluate(() => {
      const designs = JSON.parse(localStorage.getItem('phomymo_designs') || '{}');
      return designs['Folded sticker'].elements;
    });
    const savedSource = savedElements.find((element) => !element.mirrorSourceId);
    const savedChild = savedElements.find((element) => element.mirrorSourceId);
    expect(savedElements).toHaveLength(2);
    expect(savedChild.mirrorSourceId).toBe(savedSource.id);
    expect(savedChild.linkedCopyLayout).toBe('horizontal');
    expect(savedChild.linkedFlipHorizontal).toBe(true);
    expect(savedChild.linkedFlipVertical).toBe(true);
    expect(savedChild.mirrorAxis).toBeUndefined();
    expect(savedChild.text).toBe('Folded label');
    expect(savedChild.x).not.toBe(savedSource.x);

    await page.click('#prop-select-mirror-source');
    await page.click('#delete-btn');
    await page.click('#elements-btn');
    await expect(page.locator('#elements-list')).toContainText('No elements');
  });

  test('renders composable transforms while keeping markers editor-only', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/canvas.js');

      const canvas = document.createElement('canvas');
      const renderer = new CanvasRenderer(canvas);
      renderer.setDimensions(30, 20);

      const child = {
        id: 'mirror',
        type: 'shape',
        x: 20,
        y: 20,
        width: 40,
        height: 30,
        rotation: 0,
        shapeType: 'triangle',
        fill: 'black',
        stroke: 'none',
        strokeWidth: 0,
        mirrorSourceId: 'source',
        linkedCopyLayout: 'horizontal',
        linkedFlipHorizontal: false,
        linkedFlipVertical: false,
      };

      const scaleCalls = [];
      const rotateCalls = [];
      const context = canvas.getContext('2d');
      const nativeScale = context.scale.bind(context);
      const nativeRotate = context.rotate.bind(context);
      context.scale = (x, y) => {
        scaleCalls.push([x, y]);
        nativeScale(x, y);
      };
      context.rotate = (angle) => {
        rotateCalls.push(angle);
        nativeRotate(angle);
      };
      const scaleCountBeforeFlips = scaleCalls.length;
      const rotateCountBeforeFlips = rotateCalls.length;
      renderer.renderElement({ ...child, linkedFlipHorizontal: true });
      const horizontalFlipScaleCalls = scaleCalls.slice(scaleCountBeforeFlips);
      renderer.renderElement({ ...child, linkedFlipVertical: true });
      const verticalFlipScaleCalls = scaleCalls.slice(scaleCountBeforeFlips + horizontalFlipScaleCalls.length);
      renderer.renderElement({
        ...child,
        linkedFlipHorizontal: true,
        linkedFlipVertical: true,
      });
      const rotate180ScaleCalls = scaleCalls.slice(
        scaleCountBeforeFlips + horizontalFlipScaleCalls.length + verticalFlipScaleCalls.length
      );
      const flipRotateCalls = rotateCalls.slice(rotateCountBeforeFlips);

      const foldedChild = {
        ...child,
        linkedFlipHorizontal: true,
        linkedFlipVertical: true,
      };
      renderer.renderAll([foldedChild]);
      const editorPixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let editorHasPurple = false;
      for (let i = 0; i < editorPixels.length; i += 4) {
        if (editorPixels[i] > 90 && editorPixels[i] < 170 &&
            editorPixels[i + 1] < 120 && editorPixels[i + 2] > 160) {
          editorHasPurple = true;
          break;
        }
      }

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = 100;
      outputCanvas.height = 100;
      const outputContext = outputCanvas.getContext('2d');
      renderer.renderAllToContext(outputContext, [foldedChild], [], { forPrint: true });
      const outputPixels = outputContext.getImageData(0, 0, 100, 100).data;
      let outputHasPurple = false;
      let outputHasInk = false;
      for (let i = 0; i < outputPixels.length; i += 4) {
        if (outputPixels[i + 3] > 0) outputHasInk = true;
        if (outputPixels[i] > 90 && outputPixels[i] < 170 &&
            outputPixels[i + 1] < 120 && outputPixels[i + 2] > 160) {
          outputHasPurple = true;
          break;
        }
      }

      return {
        scaleCalls,
        horizontalFlipScaleCalls,
        verticalFlipScaleCalls,
        rotate180ScaleCalls,
        flipRotateCalls,
        editorHasPurple,
        outputHasPurple,
        outputHasInk,
      };
    });

    expect(result.horizontalFlipScaleCalls).toEqual([[-1, 1]]);
    expect(result.verticalFlipScaleCalls).toEqual([[1, -1]]);
    expect(result.rotate180ScaleCalls).toEqual([[-1, -1]]);
    expect(result.flipRotateCalls).toEqual([]);
    expect(result.editorHasPurple).toBe(true);
    expect(result.outputHasPurple).toBe(false);
    expect(result.outputHasInk).toBe(true);
  });
});
