import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog, screenshot } from './helpers/app';
import path from 'path';

const CH = '04-templates-batch';

test.describe.serial('Templates and Batch Printing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
  });

  test('create text with template field', async ({ page }) => {
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.locator('#prop-text-content').fill('{{Name}} - ${{Price}}');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.waitForTimeout(500);

    await expect(page.locator('#template-toolbar-btn')).toBeVisible({ timeout: 5000 });

    await screenshot(page, CH, 1, 'template-field-in-text');
  });

  test('open template panel', async ({ page }) => {
    // Add element with template fields
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('#prop-text-content').fill('{{Name}} - ${{Price}}');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.waitForTimeout(500);

    await page.click('#template-toolbar-btn');
    await expect(page.locator('#template-panel')).toBeVisible();

    await screenshot(page, CH, 2, 'template-panel-open');
  });

  test('add a column before entering rows manually', async ({ page }) => {
    await page.click('#template-toolbar-btn');
    await page.click('#template-manage-data');
    await expect(page.locator('#template-data-dialog')).toBeVisible();

    await page.click('#template-add-column');
    await expect(page.locator('#template-column-dialog')).toBeVisible();
    await page.locator('#template-column-name').fill('Serial Number');
    await page.locator('#template-column-form button[type="submit"]').click();

    await expect(page.locator('#template-column-dialog')).toBeHidden();
    const manualHeader = page.locator('.template-column-header-input').first();
    await expect(manualHeader).toHaveValue('Serial Number');
    await expect(page.locator('#template-data-empty-title')).toHaveText('1 column ready');

    // Headers can be renamed before rows exist, including names with spaces and punctuation.
    await manualHeader.fill('Serial #');
    await manualHeader.press('Enter');
    await expect(page.locator('.template-column-header-input').first()).toHaveValue('Serial #');

    await page.click('#template-add-row');
    const serialInput = page.locator('.template-field-input[data-field="Serial #"]');
    await expect(serialInput).toHaveCount(1);
    await serialInput.fill('SN-0001');
    await serialInput.dispatchEvent('change');
    await expect(serialInput).toHaveValue('SN-0001');
  });

  test('import CSV data', async ({ page }) => {
    // Setup: add template field and open data dialog
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('#prop-text-content').fill('{{Name}} - ${{Price}}');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.waitForTimeout(500);

    await page.click('#template-toolbar-btn');
    await expect(page.locator('#template-panel')).toBeVisible();

    await page.click('#template-manage-data');
    await expect(page.locator('#template-data-dialog')).toBeVisible();
    await screenshot(page, CH, 3, 'template-data-dialog-empty');

    // Import CSV
    const csvPath = path.join(__dirname, 'fixtures', 'sample.csv');
    await page.locator('#template-csv-input').setInputFiles(csvPath);
    await page.waitForTimeout(500);

    // Verify data loaded
    const rows = page.locator('#template-data-body tr');
    await expect(rows).toHaveCount(3);

    // CSV columns are loaded even when the current template does not use them.
    await expect(page.locator('.template-column-header-input').nth(2)).toHaveValue('SKU');
    await expect(page.locator('.template-column-header-input').nth(3)).toHaveValue('Notes');
    await expect(page.locator('.template-field-input[data-field="SKU"]').first()).toHaveValue('WA-001');
    await expect(page.locator('.template-field-input[data-field="Notes"]').first()).toHaveValue('Popular item');

    // Renaming preserves row values and updates placeholders already used by the label.
    const nameHeader = page.locator('.template-column-header-input').first();
    await nameHeader.fill('Product Name');
    await nameHeader.press('Enter');
    await expect(page.locator('.template-column-header-input').first()).toHaveValue('Product Name');
    await expect(page.locator('.template-field-input[data-field="Product Name"]').first()).toHaveValue('Widget A');
    await expect(page.locator('#prop-text-content')).toHaveValue('{{Product Name}} - ${{Price}}');

    // Columns can also be appended to an imported dataset and edited manually.
    await page.click('#template-add-column');
    await page.locator('#template-column-name').fill('Warehouse');
    await page.locator('#template-column-form button[type="submit"]').click();
    const warehouseInputs = page.locator('.template-field-input[data-field="Warehouse"]');
    await expect(warehouseInputs).toHaveCount(3);
    await warehouseInputs.first().fill('TLV');
    await warehouseInputs.first().dispatchEvent('change');
    await expect(warehouseInputs.first()).toHaveValue('TLV');

    await screenshot(page, CH, 4, 'csv-data-imported');
  });

  test('data dialog stays anchored while rows are deleted', async ({ page }) => {
    await page.click('#template-toolbar-btn');
    await page.click('#template-manage-data');

    const csvPath = path.join(__dirname, 'fixtures', 'sample.csv');
    await page.locator('#template-csv-input').setInputFiles(csvPath);
    await expect(page.locator('#template-data-body tr')).toHaveCount(3);

    const dialogWindow = page.locator('#template-data-window');
    const firstWindowBox = await dialogWindow.boundingBox();
    const firstDeleteBox = await page.locator('.template-delete-row').first().boundingBox();
    expect(firstWindowBox).not.toBeNull();
    expect(firstDeleteBox).not.toBeNull();

    await page.locator('.template-delete-row').first().click();
    await expect(page.locator('#template-data-body tr')).toHaveCount(2);

    const secondWindowBox = await dialogWindow.boundingBox();
    const secondDeleteBox = await page.locator('.template-delete-row').first().boundingBox();
    expect(secondWindowBox?.y).toBeCloseTo(firstWindowBox!.y, 1);
    expect(secondDeleteBox?.y).toBeCloseTo(firstDeleteBox!.y, 1);

    await page.locator('.template-delete-row').first().click();
    await expect(page.locator('#template-data-body tr')).toHaveCount(1);
    const thirdWindowBox = await dialogWindow.boundingBox();
    expect(thirdWindowBox?.y).toBeCloseTo(firstWindowBox!.y, 1);
  });

  test('preview labels', async ({ page }) => {
    // Full setup: template field + CSV data + preview
    await page.click('#add-text');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('#prop-text-content').fill('{{Name}} - ${{Price}}');
    await page.locator('#prop-text-content').dispatchEvent('input');
    await page.waitForTimeout(500);

    await page.click('#template-toolbar-btn');
    await page.click('#template-manage-data');
    await expect(page.locator('#template-data-dialog')).toBeVisible();

    const csvPath = path.join(__dirname, 'fixtures', 'sample.csv');
    await page.locator('#template-csv-input').setInputFiles(csvPath);
    await page.waitForTimeout(500);

    await page.click('#template-preview-btn');
    await expect(page.locator('#preview-dialog')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000); // Wait for previews to render

    await screenshot(page, CH, 5, 'preview-grid');
  });
});
