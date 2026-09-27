import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

for (const startRotated of [false, true]) {
  test(`first print uses the connected model (rotated first: ${startRotated})`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {} });
      localStorage.setItem('phomymo_print_settings', JSON.stringify({
        // Same 72 mm print head, but centered: stale settings shift a 50 mm
        // label by 11 mm relative to the connected M220's right alignment.
        printerModel: 'm260', density: 6, copies: 1, feed: 32,
      }));
      localStorage.setItem('phomymo_designs', JSON.stringify({
        'Connection alignment test': {
          labelSize: { width: 50, height: 80 }, editorRotation: 0,
          elements: [{ id: 'edge', type: 'shape', shapeType: 'rectangle',
            x: 0, y: 0, width: 32, height: 64, rotation: 0,
            fill: 'black', stroke: 'none', strokeWidth: 0 }],
          savedAt: Date.now(),
        },
      }));
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    await waitForAppReady(page);
    await dismissInfoDialog(page);
    await page.click('#load-btn');
    await page.locator('.design-item', { hasText: 'Connection alignment test' }).click();
    if (startRotated) await page.click('#rotate-design-btn');

    // Replace only the hardware transport; exercise the real connect, render,
    // model selection and protocol code, capturing exactly what it would send.
    await page.evaluate(async () => {
      const { BLETransport } = await import('/ble.js?v=104');
      let connected = false;
      let heldFirstRaster = false;
      const packets: number[][] = [];
      (window as any).printPackets = packets;
      // Keep the real queryAll/query implementation so the app's 500 ms
      // connection-time status timer runs against the actual print queue.
      Object.assign(BLETransport.getShared(), {
        connect: async () => { connected = true; },
        isConnected: () => connected,
        getDeviceName: () => 'M220-test',
        send: async (bytes: Uint8Array) => { packets.push(Array.from(bytes)); },
        delay: async (ms: number) => {
          if (ms === 20 && !heldFirstRaster) {
            heldFirstRaster = true;
            await new Promise(resolve => setTimeout(resolve, 650));
          }
        },
      });
    });
    await page.click('#print-btn');
    await expect(page.locator('#status-message')).toHaveText('Print complete!');
    await expect(page.locator('#printer-model')).toHaveValue('auto');
    await expect.poll(() => page.evaluate(() => (window as any).printPackets
      .filter((p: number[]) => p[0] === 0x1f && p[1] === 0x11).length)).toBe(4);
    const first = await page.evaluate(() => (window as any).printPackets.splice(0));
    const isQuery = (p: number[]) => p[0] === 0x1f && p[1] === 0x11;
    const feedIndex = first.findIndex((p: number[]) => p[0] === 0x1b && p[1] === 0x4a);
    expect(feedIndex).toBeGreaterThan(0);
    expect(first.findIndex(isQuery)).toBeGreaterThan(feedIndex);

    await page.click('#rotate-design-btn');
    await page.click('#print-btn');
    await expect(page.locator('#status-message')).toHaveText('Print complete!');
    const second = await page.evaluate(() => (window as any).printPackets.splice(0));
    expect(first.length).toBeGreaterThan(10);
    // Comparing as a boolean keeps failure output from dumping all raster bytes.
    expect(JSON.stringify(first.filter((p: number[]) => !isQuery(p))) === JSON.stringify(second)).toBe(true);
  });
}
