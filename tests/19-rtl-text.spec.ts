import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
});

test('auto detects Hebrew/Arabic, ignores leading punctuation and digits, and respects overrides', async ({ page }) => {
  const directions = await page.evaluate(async () => {
    const { resolveTextDirection } = await import('/utils/text-direction.js');
    return [
      resolveTextDirection('שלום עולם!'), resolveTextDirection('123 — ״צח משה״?'),
      resolveTextDirection('مرحبا بالعالم!'), resolveTextDirection('USB-C: שלום!'),
      resolveTextDirection('שלום!', 'ltr'), resolveTextDirection('USB-C 123!', 'rtl'),
      resolveTextDirection('123?!'),
    ];
  });
  expect(directions).toEqual(['rtl', 'rtl', 'rtl', 'ltr', 'ltr', 'rtl', 'ltr']);
});

test('Hebrew punctuation pixels match native RTL shaping in editor, preview and print raster', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { CanvasRenderer } = await import('/canvas.js?v=125');
    const { createTextElement } = await import('/elements.js?v=108');
    const canvas = document.createElement('canvas');
    canvas.width = 440; canvas.height = 110;
    const renderer = new CanvasRenderer(canvas);
    const el = createTextElement('שלום (USB-C 123)!', { x: 0, y: 0, width: 440, height: 110, fontSize: 32, fontFamily: 'Arial', align: 'left', noWrap: true });
    renderer.renderAllToContext(canvas.getContext('2d'), [el]);
    const reference = document.createElement('canvas');
    reference.width = 440; reference.height = 110;
    const ctx = reference.getContext('2d');
    ctx.font = '32px Arial'; ctx.direction = 'rtl'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(el.text, 4, 55);
    const identical = canvas.toDataURL() === reference.toDataURL();
    renderer.setDimensions(60, 20);
    const raw = (direction) => Array.from(renderer.getRasterDataRaw([{ ...el, textDirection: direction }], 'threshold').data);
    const auto = raw('auto'), rtl = raw('rtl'), ltr = raw('ltr');
    const previewAuto = renderer.generateFullLabelPreview([{ ...el, textDirection: 'auto' }], 'threshold').toDataURL();
    const previewLtr = renderer.generateFullLabelPreview([{ ...el, textDirection: 'ltr' }], 'threshold').toDataURL();
    return { identical, hasInk: auto.some(n => n !== 0), printMatches: JSON.stringify(auto) === JSON.stringify(rtl), printDiffers: JSON.stringify(auto) !== JSON.stringify(ltr), previewDiffers: previewAuto !== previewLtr };
  });
  expect(results).toEqual({ identical: true, hasInk: true, printMatches: true, printDiffers: true, previewDiffers: true });
});

test('wrapped paragraphs keep direction and badges flow RTL without reversing numbers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import('/canvas.js?v=125');
    const { createTextElement } = await import('/elements.js?v=108');
    const canvas = document.createElement('canvas');
    canvas.width = 500; canvas.height = 300;
    const renderer = new CanvasRenderer(canvas);
    const ctx = canvas.getContext('2d');
    const draws = [];
    const original = ctx.fillText.bind(ctx);
    ctx.fillText = (text, x, y) => { draws.push({ text, x, direction: ctx.direction }); original(text, x, y); };
    renderer.renderAllToContext(ctx, [createTextElement('שלום ABCDEFG 123!\nHello עולם!', { width: 90, height: 200, fontFamily: 'Arial', fontSize: 20 })]);
    const paragraphDraws = draws.splice(0);
    renderer.renderAllToContext(ctx, [createTextElement('״צח משה!״ קפה 123', { textMode: 'labels', width: 450, height: 100, fontFamily: 'Arial', fontSize: 20 })]);
    const badgeDraws = draws.splice(0);
    const wrappedBadges = renderer.layoutLabelBadges('צח משה קפה פולים', 70, 20);
    return { paragraphDraws, badgeDraws, rows: wrappedBadges.rows.map(r => r.direction) };
  });
  expect(result.paragraphDraws.find(d => d.text === 'ABCDEFG')?.direction).toBe('rtl');
  expect(result.paragraphDraws.find(d => d.text === '123!')?.direction).toBe('rtl');
  expect(result.paragraphDraws.find(d => d.text === 'Hello')?.direction).toBe('ltr');
  const badges = result.badgeDraws;
  expect(badges.map(d => d.text)).toEqual(['123', 'קפה', 'צח משה!']);
  expect(badges[2].x).toBeGreaterThan(badges[1].x);
  expect(badges[1].x).toBeGreaterThan(badges[0].x);
  expect(badges[2].direction).toBe('rtl');
  expect(result.rows.length).toBeGreaterThan(1);
  expect(result.rows.every(d => d === 'rtl')).toBe(true);
});

test('direction controls persist and are inherited by linked copies', async ({ page }) => {
  await page.click('#add-text');
  await expect(page.locator('#inline-text-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#prop-text-content').fill('צח משה: קפה (250 גרם)!');
  await expect(page.locator('#prop-text-direction')).toHaveValue('auto');
  await expect(page.locator('#prop-text-content')).toHaveAttribute('dir', 'auto');
  await page.locator('#prop-text-direction').selectOption('rtl');
  await expect(page.locator('#prop-text-content')).toHaveAttribute('dir', 'rtl');
  await page.click('#prop-create-mirror');
  await page.click('#save-btn');
  await page.locator('#save-name').fill('RTL label');
  await page.click('#save-confirm');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!)['RTL label']);
  expect(saved.elements).toHaveLength(2);
  expect(saved.elements.every(el => el.textDirection === 'rtl')).toBe(true);
  await page.click('#load-btn');
  await page.getByRole('button', { name: 'Open RTL label', exact: true }).click();
  await page.click('#elements-btn');
  await page.locator('.element-list-item').last().click();
  await expect(page.locator('#prop-text-direction')).toHaveValue('rtl');
  await page.screenshot({ path: '/tmp/phomymo-rtl.png', animations: 'disabled' });
});

test('mobile direction selector updates the text input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#mobile-add-text');
  await expect(page.locator('#inline-text-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.click('#mobile-edit-btn');
  await page.locator('#mobile-prop-textDirection').selectOption('rtl');
  await expect(page.locator('#mobile-prop-text')).toHaveAttribute('dir', 'rtl');
  await page.locator('#mobile-prop-textDirection').selectOption('ltr');
  await expect(page.locator('#mobile-prop-text')).toHaveAttribute('dir', 'ltr');
});
