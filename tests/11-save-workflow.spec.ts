import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

const STORAGE_KEY = 'phomymo_designs';

async function openApp(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
}

async function saveNamedDesign(page, name: string, text: string) {
  await page.click('#add-text');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.locator('#prop-text-content').fill(text);
  await page.click('#save-btn');
  await page.locator('#save-name').fill(name);
  await page.click('#save-confirm');
}

test.describe.serial('Save workflow', () => {
  test('Save updates the loaded design without reopening the naming dialog', async ({ page }) => {
    await openApp(page);
    await saveNamedDesign(page, 'Cable label', 'Original');

    page.once('dialog', dialog => dialog.accept());
    await page.click('#new-btn');
    await page.click('#load-btn');
    await page.locator('.design-item', { hasText: 'Cable label' }).click();

    await page.click('#elements-btn');
    await page.locator('.element-list-item').click();
    await page.locator('#prop-text-content').fill('Updated');
    await page.click('#save-btn');

    await expect(page.locator('#save-dialog')).toHaveClass(/hidden/);
    const savedDesigns = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), STORAGE_KEY);
    expect(Object.keys(savedDesigns)).toEqual(['Cable label']);
    expect(savedDesigns['Cable label'].elements[0].text).toBe('Updated');
  });

  test('Save As lists saved designs and keeps the selected name editable', async ({ page }) => {
    await openApp(page);
    await saveNamedDesign(page, 'First design', 'First');
    await page.evaluate(key => {
      const designs = JSON.parse(localStorage.getItem(key) || '{}');
      designs['Existing target'] = {
        elements: [{ type: 'text', text: 'Old value' }],
        labelSize: { width: 40, height: 30 },
        savedAt: Date.now() - 1000,
      };
      localStorage.setItem(key, JSON.stringify(designs));
    }, STORAGE_KEY);

    await page.click('#save-as-btn');
    await expect(page.locator('#save-dialog-title')).toHaveText('Save As');
    await expect(page.locator('#save-existing')).toContainText('First design');
    await expect(page.locator('#save-existing')).toContainText('Existing target');
    await page.locator('#save-existing').selectOption('Existing target');
    await expect(page.locator('#save-name')).toHaveValue('Existing target');

    await page.locator('#save-name').fill('Second design');
    await page.click('#save-confirm');

    await page.click('#save-as-btn');
    await page.locator('#save-existing').selectOption('Existing target');
    await page.click('#save-confirm');

    const savedDesigns = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), STORAGE_KEY);
    expect(Object.keys(savedDesigns).sort()).toEqual(['Existing target', 'First design', 'Second design']);
    expect(savedDesigns['Existing target'].elements[0].text).toBe('First');
  });
});
