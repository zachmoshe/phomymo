import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

test.describe('Label-style text', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('wraps whitespace-separated words and draws one rounded badge per word', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { CanvasRenderer } = await import('/canvas.js');
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 120;
      const renderer = new CanvasRenderer(canvas);

      const wrapped = renderer.layoutLabelBadges('A B C D', 80, 20);
      const unwrapped = renderer.layoutLabelBadges('A B C D', 80, 20, undefined, undefined, undefined, true);
      const templateWords = renderer.layoutLabelBadges('{{LCSC Part #}} stock', 300, 20);
      const quotedWords = renderer.layoutLabelBadges('"Zach Moshe" coffee beans', 400, 20);
      const hebrewQuotedWords = renderer.layoutLabelBadges('״צח משה״ קפה פולים', 400, 20);
      const escapedQuoteWords = renderer.layoutLabelBadges('"Zach \\"The Roaster\\" Moshe" coffee', 500, 20);

      const output = document.createElement('canvas');
      output.width = 200;
      output.height = 120;
      const ctx = output.getContext('2d')!;
      let roundedRectCount = 0;
      const originalRoundRect = ctx.roundRect.bind(ctx);
      ctx.roundRect = (...args) => {
        roundedRectCount += 1;
        return originalRoundRect(...args);
      };
      renderer.renderAllToContext(ctx, [{
        id: 'labels',
        type: 'text',
        textMode: 'labels',
        text: 'Alpha Beta Gamma Delta',
        x: 0,
        y: 0,
        width: 150,
        height: 110,
        rotation: 0,
        fontSize: 18,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'normal',
        fontStyle: 'normal',
        textDecoration: 'none',
        color: 'black',
        background: 'transparent',
        align: 'left',
        verticalAlign: 'top',
        noWrap: false,
        clipOverflow: false,
        autoScale: false,
      }]);

      return {
        wrappedWords: wrapped.rows.map(row => row.badges.map(badge => badge.text)),
        wrappedWidths: wrapped.rows.map(row => row.width),
        unwrappedRows: unwrapped.rows.length,
        templateWords: templateWords.rows.flatMap(row => row.badges.map(badge => badge.text)),
        quotedWords: quotedWords.rows.flatMap(row => row.badges.map(badge => badge.text)),
        hebrewQuotedWords: hebrewQuotedWords.rows.flatMap(row => row.badges.map(badge => badge.text)),
        escapedQuoteWords: escapedQuoteWords.rows.flatMap(row => row.badges.map(badge => badge.text)),
        roundedRectCount,
      };
    });

    expect(result.wrappedWords).toEqual([['A', 'B'], ['C', 'D']]);
    expect(result.wrappedWidths.every(width => width <= 80)).toBe(true);
    expect(result.unwrappedRows).toBe(1);
    expect(result.templateWords).toEqual(['{{LCSC Part #}}', 'stock']);
    expect(result.quotedWords).toEqual(['Zach Moshe', 'coffee', 'beans']);
    expect(result.hebrewQuotedWords).toEqual(['צח משה', 'קפה', 'פולים']);
    expect(result.escapedQuoteWords).toEqual(['Zach "The Roaster" Moshe', 'coffee']);
    expect(result.roundedRectCount).toBe(4);
  });

  test('selects Labels mode in the editor and saves it with the text element', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');

    await expect(page.locator('#prop-text-mode')).toHaveValue('text');
    await page.locator('#prop-text-content').fill('Red Green Blue Orange');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.locator('#prop-text-mode').selectOption('labels');
    await expect(page.locator('#prop-text-mode')).toHaveValue('labels');

    await page.click('#save-btn');
    await page.locator('#save-name').fill('Badge labels');
    await page.click('#save-confirm');

    const savedElement = await page.evaluate(() => {
      const designs = JSON.parse(localStorage.getItem('phomymo_designs') || '{}');
      return designs['Badge labels'].elements[0];
    });
    expect(savedElement.textMode).toBe('labels');
    expect(savedElement.text).toBe('Red Green Blue Orange');
  });
});
