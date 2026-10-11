import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

async function history(page) {
  return page.evaluate(async () => {
    const s = await import('/storage.js?v=108');
    return s.listDesigns().filter(d => d.folderId === s.PRINT_HISTORY_FOLDER).map(d => ({ id: d.id, ...s.loadDesign(d.id) }));
  });
}

async function openHistory(page) {
  await page.click('#load-btn');
  await page.locator('#library-tree').getByText('Previously printed', { exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {} });
    localStorage.setItem('phomymo_designs', JSON.stringify({
      'Cable template': {
        labelSize: { width: 50, height: 80 }, editorRotation: 90,
        elements: [
          { id: 'text', type: 'text', text: '{{Name}} [[date]]', x: 10, y: 20, width: 250, height: 50, fontSize: 20, fontFamily: 'Arial', color: 'black', pinned: true },
          { id: 'barcode', type: 'barcode', barcodeData: '{{Code}}', barcodeFormat: 'CODE128', x: 10, y: 80, width: 200, height: 60 },
          { id: 'qr', type: 'qr', qrData: '{{Name}}', x: 250, y: 80, width: 80, height: 80 },
        ],
        templateColumns: ['Name', 'Code'], templateData: [{ Name: 'Alice', Code: '12345' }, { Name: 'Bob', Code: '67890' }],
        savedAt: 1,
      },
    }));
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
  await page.evaluate(async () => {
    const { BLETransport } = await import('/ble.js?v=104');
    let connected = false;
    (window as any).rasterCount = 0;
    BLETransport.getShared = () => ({
      connect: async () => { connected = true; },
      isConnected: () => connected,
      getDeviceName: () => 'M220-test',
      send: async (bytes: Uint8Array) => {
        if ((window as any).failPrint) throw new Error('Test printer disconnected');
        if (bytes[0] === 0x1d && bytes[1] === 0x76) (window as any).rasterCount++;
      },
      delay: async () => {},
    });
  });
  await page.click('#load-btn');
  await page.getByRole('button', { name: 'Open Cable template', exact: true }).click();
});

test('every print action snapshots resolved values, not the template, and opens an editable copy', async ({ page }) => {
  await page.locator('#print-copies').fill('2');
  await page.click('#print-btn');
  await expect(page.locator('#status-message')).toHaveText('Printed 2 copies!');
  let prints = await history(page);
  expect(prints).toHaveLength(1);
  expect(prints[0]).toMatchObject({ labelSize: { width: 50, height: 80 }, editorRotation: 90 });
  expect(prints[0].elements[0].text).toMatch(/^Alice /);
  expect(prints[0].elements[0].text).not.toContain('[[');
  expect(prints[0].elements[1].barcodeData).toBe('12345');
  expect(prints[0].elements[2].qrData).toBe('Alice');
  expect(prints[0].templateData).toBeUndefined();
  expect(prints[0].templateColumns).toBeUndefined();
  const firstText = prints[0].elements[0].text;
  // Change only the text and print again, without saving the template.
  await page.click('#elements-btn');
  await page.locator('.element-list-item[data-element-id="text"]').click();
  await page.locator('#prop-text-content').fill('Changed text');
  await page.locator('#print-copies').fill('1');
  await page.click('#print-btn');
  await expect(page.locator('#status-message')).toHaveText('Print complete!');
  prints = await history(page);
  expect(prints).toHaveLength(2);
  expect(prints[0].elements[0].text).toBe('Changed text');
  expect(prints[1].elements[0].text).toBe(firstText);
  await openHistory(page);
  await expect(page.locator('.library-design-card')).toHaveCount(2);
  await expect(page.locator('#library-new-folder')).toBeHidden();
  await expect(page.locator('#import-file-btn')).toBeHidden();
  await page.screenshot({ path: '/tmp/phomymo-previously-printed.png', animations: 'disabled' });
  await page.locator('.design-item').first().click();
  await expect(page.locator('#rotate-design-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#save-btn');
  await expect(page.locator('#save-dialog')).toBeVisible();
  await expect(page.locator('#save-folder')).toHaveValue('');
  await page.locator('#save-name').fill('Permanent copy');
  await page.click('#save-confirm');
  expect(await history(page)).toHaveLength(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!)['Permanent copy'].folderId)).toBeNull();
});

test('history keeps 20 newest snapshots and moved designs survive eviction', async ({ page }) => {
  await page.evaluate(async () => {
    const s = await import('/storage.js?v=108');
    for (let i = 0; i < 25; i++) s.recordPrintedDesign(`Print ${i}`, { elements: [], labelSize: { width: 40, height: 30 } });
  });
  let prints = await history(page);
  expect(prints).toHaveLength(20);
  expect(prints[0].name).toBe('Print 24');
  expect(prints[19].name).toBe('Print 5');
  await openHistory(page);
  await page.locator('.library-design-card', { hasText: 'Print 5' }).getByText('Keep in library').click();
  await expect(page.locator('#library-edit-parent')).toHaveValue('');
  await page.click('#library-edit-confirm');
  const keptId = prints[19].id;
  await page.evaluate(async () => {
    const s = await import('/storage.js?v=108');
    for (let i = 25; i < 50; i++) s.recordPrintedDesign(`Print ${i}`, { elements: [], labelSize: { width: 40, height: 30 } });
  });
  prints = await history(page);
  expect(prints).toHaveLength(20);
  expect(prints[0].name).toBe('Print 49');
  expect(prints[19].name).toBe('Print 30');
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem('phomymo_designs')!)[id].folderId, keptId)).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!)['Cable template'].elements[0].text)).toBe('{{Name}} [[date]]');
});

test('batch printing stores each selected record and failed attempts add nothing', async ({ page }) => {
  await page.click('#template-toolbar-btn');
  await page.click('#template-manage-data');
  await page.click('#template-print-btn');
  await expect(page.locator('#status-message')).toHaveText('Printed 2 labels!');
  const prints = await history(page);
  expect(prints).toHaveLength(2);
  expect(prints[0].elements[0].text).toMatch(/^Bob /);
  expect(prints[1].elements[0].text).toMatch(/^Alice /);
  await page.evaluate(() => { (window as any).failPrint = true; });
  await page.click('#template-print-btn');
  await expect(page.locator('#status-message')).toContainText('Test printer disconnected');
  expect(await history(page)).toEqual(prints);
});

test('history storage failure preserves both history and library', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const s = await import('/storage.js?v=108');
    for (let i = 0; i < 20; i++) s.recordPrintedDesign(`Print ${i}`, { elements: [], labelSize: { width: 40, height: 30 } });
    const before = localStorage.getItem('phomymo_designs');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
    let message = '';
    try { s.recordPrintedDesign('Not stored', { elements: [] }); } catch (e) { message = e.message; }
    finally { Storage.prototype.setItem = original; }
    return { message, unchanged: before === localStorage.getItem('phomymo_designs') };
  });
  expect(result.message).toContain('history snapshot could not be saved');
  expect(result.unchanged).toBe(true);
});

test('printing from a single-record preview stores only that record', async ({ page }) => {
  await page.click('#template-toolbar-btn');
  await page.click('#template-manage-data');
  await page.click('#template-preview-btn');
  await page.locator('.preview-thumbnail[data-index="1"]').click();
  await page.click('#full-preview-print');
  await expect(page.locator('#status-message')).toHaveText('Label printed!');
  const prints = await history(page);
  expect(prints).toHaveLength(1);
  expect(prints[0].elements[0].text).toMatch(/^Bob /);
  expect(prints[0].elements[1].barcodeData).toBe('67890');
});

test('multi-label batches retain actual per-zone data and layout for each printed row', async ({ page }) => {
  await page.evaluate(async () => {
    const s = await import('/storage.js?v=108');
    const original = s.loadDesign('Cable template');
    s.saveDesign('Multi-label', {
      labelSize: { width: 62, height: 20 },
      multiLabel: { enabled: true, labelWidth: 30, labelHeight: 20, labelsAcross: 2, gapMm: 2, cloneMode: false },
      elements: [0, 1].map(zone => ({ ...original.elements[0], id: `zone-${zone}`, zone })),
      templateData: [{ Name: 'One' }, { Name: 'Two' }, { Name: 'Three' }, { Name: 'Four' }],
    });
  });
  await page.click('#load-btn');
  await page.getByRole('button', { name: 'Open Multi-label', exact: true }).click();
  await page.click('#template-toolbar-btn');
  await page.click('#template-manage-data');
  await page.click('#template-print-btn');
  await expect(page.locator('#status-message')).toHaveText('Printed 2 rows (4 labels)!');
  const prints = await history(page);
  expect(prints).toHaveLength(2);
  expect(prints[1].elements.map(e => e.text.split(' ')[0])).toEqual(['One', 'Two']);
  expect(prints[0].elements.map(e => e.text.split(' ')[0])).toEqual(['Three', 'Four']);
  expect(prints[0].multiLabel).toMatchObject({ enabled: true, labelsAcross: 2, cloneMode: false, gapMm: 2 });
});

test('history is accessible on mobile and does not allow manual destinations into it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#mobile-menu-btn');
  await page.click('#mobile-load-btn');
  await page.click('#library-location-history');
  await expect(page.locator('#library-folder-title')).toHaveText('Previously printed');
  await expect(page.locator('#library-new-folder')).toBeHidden();
  await page.click('#library-location-root');
  await page.locator('.library-design-card').getByText('Move / rename').click();
  await expect(page.locator('#library-edit-parent')).not.toContainText('Previously printed');
});
