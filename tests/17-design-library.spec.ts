import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

async function openApp(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
}

async function folder(page, name) {
  await page.click('#library-new-folder');
  await page.locator('#library-edit-name').fill(name);
  await page.click('#library-edit-confirm');
  await expect(page.locator('#library-edit-dialog')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Seed only once, so navigation/reloads exercise real persistence.
    if (localStorage.getItem('phomymo_designs')) return;
    const text = (content, x, y, fontSize, width = 300) => ({ id: content, type: 'text', text: content, x, y, width, height: 65, fontSize, fontFamily: 'Arial', fill: 'black', color: 'black', align: 'center' });
    const designs = {
      'Ethiopia · Coffee beans': { labelSize: { width: 50, height: 80 }, elements: [text('ETHIOPIA', 50, 80, 42), text('Single origin coffee', 50, 150, 21), text('250 g  /  Whole beans', 50, 400, 20)], savedAt: 3 },
      'USB-C cable': { labelSize: { width: 40, height: 30 }, elements: [text('USB-C', 10, 35, 42), text('100W • DESK', 10, 100, 22)], savedAt: 2 },
      'Parts bin <M3>': { labelSize: { width: 50, height: 80 }, elements: [text('M3 × 12', 50, 80, 48), text('Socket head screws', 50, 160, 22)], savedAt: 1 },
    };
    localStorage.setItem('phomymo_designs', JSON.stringify(designs));
  });
  await openApp(page);
});

test('legacy designs are preserved with thumbnails, size fields and filters', async ({ page }) => {
  const before = await page.evaluate(() => localStorage.getItem('phomymo_designs'));
  await page.click('#load-btn');
  await expect(page.locator('.library-design-card')).toHaveCount(3);
  await expect(page.locator('.library-dimensions').first()).toContainText('Width50 mmHeight80 mm');
  const hasInk = await page.locator('.library-thumbnail').first().evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, i) => i % 4 === 0 && value < 100 && pixels[i + 3] > 0);
  });
  expect(hasInk).toBe(true);
  await expect(page.getByRole('button', { name: 'Open Parts bin <M3>' })).toBeVisible();
  await page.locator('#library-size-filter').selectOption('50x80');
  await expect(page.locator('.library-design-card')).toHaveCount(2);
  await page.locator('#library-search').fill('coffee');
  await expect(page.locator('.library-design-card')).toHaveCount(1);
  await page.locator('#library-search').fill('');
  await page.click('#library-current-size');
  await expect(page.locator('.library-design-card')).toHaveCount(1);
  await expect(page.locator('.library-design-card')).toContainText('USB-C');
  expect(await page.evaluate(() => localStorage.getItem('phomymo_designs'))).toBe(before);
});

test('nested folders, moves, rename and stable Save identity', async ({ page }) => {
  await page.click('#load-btn');
  await folder(page, 'Workshop');
  await page.locator('.library-folder', { hasText: 'Workshop' }).click();
  await folder(page, 'Cables');
  await page.locator('.library-folder', { hasText: 'Cables' }).click();
  await expect(page.locator('#library-breadcrumb')).toContainText('Library/Workshop/Cables');
  const destination = await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_library_folders')!).find(f => f.name === 'Cables').id);
  await page.locator('#library-tree').getByText('Library root', { exact: true }).click();
  await page.locator('.library-design-card', { hasText: 'USB-C cable' }).getByText('Move / rename').click();
  await page.locator('#library-edit-name').fill('Desk cable');
  await page.locator('#library-edit-parent').selectOption(destination);
  await page.click('#library-edit-confirm');
  await expect(page.locator('.library-design-card')).toHaveCount(2);
  await page.locator('#library-tree').getByText('▱  Cables', { exact: true }).click();
  await page.getByRole('button', { name: 'Open Desk cable', exact: true }).click();
  await page.click('#save-btn');
  await expect(page.locator('#save-dialog')).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!));
  expect(Object.keys(saved)).toHaveLength(3);
  expect(saved['USB-C cable']).toMatchObject({ name: 'Desk cable', folderId: destination });
  await page.reload();
  await waitForAppReady(page);
  await page.click('#load-btn');
  await expect(page.locator('#library-folder-title')).toHaveText('Cables');
  await expect(page.locator('.library-design-card')).toHaveCount(1);
});

test('save a copy to the viewed folder and retain the original', async ({ page }) => {
  await page.click('#load-btn');
  await page.getByRole('button', { name: 'Open USB-C cable' }).click();
  await page.click('#load-btn');
  await folder(page, 'Reusable labels');
  await page.locator('.library-folder').click();
  await page.click('#library-save-current');
  await expect(page.locator('#save-folder option:checked')).toContainText('Reusable labels');
  await page.locator('#save-name').fill('USB-C cable');
  await page.click('#save-confirm');
  await page.click('#load-btn');
  await expect(page.locator('.library-design-card')).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('phomymo_designs')!)).length)).toBe(4);
});

test('import into current folder, avoid collisions, and export complete design files', async ({ page }) => {
  await page.click('#load-btn');
  await folder(page, 'Imported');
  await page.locator('.library-folder').click();
  const design = {
    name: 'Folded parts label', labelSize: { width: 50, height: 80 }, editorRotation: 90,
    templateColumns: ['Part #', 'Description'], templateData: [{ 'Part #': '123', Description: 'Test' }],
    elements: [{ id: 'guide', type: 'shape', shapeType: 'rectangle', x: 20, y: 20, width: 100, height: 60, nonPrintable: true, pinned: true, fill: 'transparent' }],
  };
  const file = { name: 'example.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design)) };
  await page.locator('#import-file-input').setInputFiles(file);
  await expect(page.locator('.library-design-card')).toHaveCount(1);
  await expect(page.locator('#load-dialog')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.library-design-card').getByText('Export', { exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported).toMatchObject(design);
  expect(exported.folderId).toBeUndefined();
  await page.locator('#import-file-input').setInputFiles(file);
  await expect(page.locator('.library-design-card')).toHaveCount(2);
  await expect(page.locator('.library-design-card').last()).toContainText('Folded parts label');
  await page.getByRole('button', { name: 'Open Folded parts label', exact: true }).click();
  await expect(page.locator('#rotate-design-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#print-size')).toHaveText('50 x 80 mm');
});

test('folder moves reject cycles and deletion of nonempty folders', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const s = await import('/storage.js?v=107');
    const parent = s.saveFolder('Parent');
    const child = s.saveFolder('Child', parent);
    const destination = s.saveFolder('Destination');
    const before = localStorage.getItem('phomymo_library_folders');
    let cycle = '', deletion = '';
    try { s.saveFolder('Parent', child, parent); } catch (e) { cycle = e.message; }
    try { s.deleteFolder(parent); } catch (e) { deletion = e.message; }
    const unchanged = before === localStorage.getItem('phomymo_library_folders');
    s.saveFolder('Renamed', destination, parent);
    return { cycle, deletion, unchanged, path: s.folderPath(child) };
  });
  expect(results.cycle).toContain('descendants');
  expect(results.deletion).toContain('contents');
  expect(results.unchanged).toBe(true);
  expect(results.path).toBe('Library / Destination / Renamed / Child');
});

test('library presentation on desktop and mobile', async ({ page }) => {
  await page.click('#load-btn');
  await folder(page, 'Electronics');
  await folder(page, 'Kitchen & pantry');
  await page.screenshot({ path: '/tmp/phomymo-library-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#library-new-folder')).toBeInViewport();
  await expect(page.locator('#load-cancel')).toBeInViewport();
  const overflow = await page.locator('.library-main').evaluate(el => el.scrollWidth > el.clientWidth + 1);
  expect(overflow).toBe(false);
  const topmost = await page.locator('.library-shell').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 5));
  });
  expect(topmost).toBe(true);
  await page.screenshot({ path: '/tmp/phomymo-library-mobile.png', animations: 'disabled' });
});

test('Save copy suggests a new name and leaves the original intact', async ({ page }) => {
  await page.click('#load-btn');
  await page.getByRole('button', { name: 'Open USB-C cable', exact: true }).click();
  await page.click('#save-as-btn');
  await expect(page.locator('#save-name')).toHaveValue('USB-C cable copy');
  await page.click('#save-confirm');
  const names = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('phomymo_designs')!)).map((d: any) => d.name));
  expect(names).toContain('USB-C cable copy');
  expect(names).toHaveLength(4);
});

test('failed writes and unreadable storage never replace existing designs', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const storage = await import('/storage.js?v=107');
    const before = localStorage.getItem('phomymo_designs');
    const original = Storage.prototype.setItem;
    let error = '';
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
    try { storage.saveDesign('Not saved', { elements: [], labelSize: { width: 40, height: 30 } }); }
    catch (e) { error = e.message; }
    finally { Storage.prototype.setItem = original; }
    const unchanged = before === localStorage.getItem('phomymo_designs');
    localStorage.setItem('phomymo_designs', '{broken data');
    let corruptError = '';
    try { storage.saveDesign('Not saved either', { elements: [] }); }
    catch (e) { corruptError = e.message; }
    return { error, unchanged, corruptError, raw: localStorage.getItem('phomymo_designs') };
  });
  expect(result.error).toContain('Failed to save');
  expect(result.unchanged).toBe(true);
  expect(result.corruptError).toContain('not been changed');
  expect(result.raw).toBe('{broken data');
});

test('drag designs onto folder cards, nested sidebar folders and the root breadcrumb', async ({ page }) => {
  await page.click('#load-btn');
  await page.getByRole('button', { name: 'Open USB-C cable', exact: true }).click();
  await page.click('#load-btn');
  await folder(page, 'Workshop');
  await page.locator('.library-folder').click();
  await folder(page, 'Cables');
  await page.locator('#library-tree').getByText('Library root', { exact: true }).click();
  const source = page.getByRole('button', { name: 'Open USB-C cable', exact: true });
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!)['USB-C cable']);
  await source.dragTo(page.locator('.library-folder-card', { hasText: 'Workshop' }));
  await expect(source).toHaveCount(0);
  await expect(page.locator('#library-notice')).toContainText('Moved “USB-C cable” to Library / Workshop');
  await expect(page.locator('#load-dialog')).toBeVisible();
  await page.locator('.library-folder').click();
  await source.dragTo(page.locator('#library-tree').getByText('▱  Cables', { exact: true }));
  await expect(source).toHaveCount(0);
  await page.locator('.library-folder').click();
  await expect(source).toBeVisible();
  const moved = await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!)['USB-C cable']);
  expect(moved.elements).toEqual(before.elements);
  expect(moved.labelSize).toEqual(before.labelSize);
  // Saving the already-open design still targets its moved record.
  await page.click('#load-cancel');
  await page.click('#save-btn');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!)['USB-C cable'].folderId)).toBe(moved.folderId);
  await page.click('#load-btn');
  await source.dragTo(page.locator('#library-breadcrumb').getByRole('button', { name: 'Library', exact: true }));
  await expect(source).toHaveCount(0);
  await page.locator('#library-tree').getByText('Library root', { exact: true }).click();
  await expect(source).toBeVisible();
  await page.reload();
  await waitForAppReady(page);
  await page.click('#load-btn');
  await expect(source).toBeVisible();
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('phomymo_designs')!)).length)).toBe(3);
});

test('dragging highlights folders and cancelling or dropping in place changes nothing', async ({ page }) => {
  await page.click('#load-btn');
  await folder(page, 'Destination');
  const before = await page.evaluate(() => localStorage.getItem('phomymo_designs'));
  const source = page.getByRole('button', { name: 'Open USB-C cable', exact: true });
  const target = page.locator('.library-folder-card');
  await source.hover();
  await page.mouse.down();
  await target.hover();
  await target.hover();
  await expect(target).toHaveClass(/library-drop-target/);
  await expect(source).toHaveClass(/library-dragging/);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.library-drop-target, .library-dragging')).toHaveCount(0);
  await expect(page.locator('#load-dialog')).toBeVisible();
  await source.dragTo(page.locator('#library-tree').getByText('Library root', { exact: true }));
  expect(await page.evaluate(() => localStorage.getItem('phomymo_designs'))).toBe(before);
  // An external drag cannot move designs using a forged ID.
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData('application/x-phomymo-design', 'USB-C cable');
    return data;
  });
  await target.dispatchEvent('drop', { dataTransfer });
  expect(await page.evaluate(() => localStorage.getItem('phomymo_designs'))).toBe(before);
});

test('dragging into a folder with a duplicate name does not overwrite either design', async ({ page }) => {
  await page.evaluate(async () => {
    const storage = await import('/storage.js?v=107');
    const id = storage.saveFolder('Destination');
    storage.saveDesign('USB-C cable', { elements: [], labelSize: { width: 50, height: 80 } }, { folderId: id });
  });
  await page.click('#load-btn');
  const before = await page.evaluate(() => localStorage.getItem('phomymo_designs'));
  const source = page.getByRole('button', { name: 'Open USB-C cable', exact: true });
  await source.dragTo(page.locator('.library-folder-card'));
  await expect(page.locator('#library-error')).toContainText('already exists');
  await expect(source).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('phomymo_designs'))).toBe(before);
  await expect(page.locator('.library-drop-target, .library-dragging')).toHaveCount(0);
});

test('up-arrow tile navigates and accepts design drops exactly one level up', async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const s = await import('/storage.js?v=107');
    const parent = s.saveFolder('Workshop');
    const child = s.saveFolder('Cables', parent);
    s.organizeDesign('USB-C cable', 'USB-C cable', child);
    return { parent, child };
  });
  await page.click('#load-btn');
  await expect(page.locator('#library-up')).toHaveCount(0);
  await page.locator('.library-folder', { hasText: 'Workshop' }).click();
  await page.locator('.library-folder', { hasText: 'Cables' }).click();
  const up = page.locator('#library-up');
  await expect(up).toHaveAccessibleName('Go up to Workshop');
  // Navigation remains available even when search and size filters hide everything.
  await page.locator('#library-search').fill('No matches');
  await page.locator('#library-size-filter').selectOption('40x30');
  await expect(up).toBeVisible();
  await page.locator('#library-search').fill('');
  await page.screenshot({ path: '/tmp/phomymo-library-up.png', animations: 'disabled' });
  const source = page.getByRole('button', { name: 'Open USB-C cable', exact: true });
  await source.dragTo(up);
  await expect(source).toHaveCount(0);
  await expect(page.locator('#library-folder-title')).toHaveText('Cables');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!)['USB-C cable'].folderId)).toBe(ids.parent);
  await up.click();
  await expect(page.locator('#library-folder-title')).toHaveText('Workshop');
  await expect(source).toBeVisible();
  await expect(up).toHaveAccessibleName('Go up to Library root');
  await source.dragTo(up);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_designs')!)['USB-C cable'].folderId)).toBeNull();
  await up.click();
  await expect(up).toHaveCount(0);
  await expect(source).toBeVisible();
  // The same parent shortcut works without the sidebar on mobile.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.library-folder', { hasText: 'Workshop' }).click();
  await expect(up).toBeInViewport();
  await up.click();
  await expect(up).toHaveCount(0);
});
