import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

test('low battery blinks red in the header and clears on recovery or disconnect', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {} });
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
  await page.evaluate(async () => {
    const { BLETransport } = await import('/ble.js?v=104');
    let connected = false;
    const transport = BLETransport.getShared();
    Object.assign(transport, {
      connect: async () => { connected = true; },
      disconnect: async () => { connected = false; },
      isConnected: () => connected,
      getDeviceName: () => 'M220-test',
      queryAll: async () => {},
    });
    (window as any).reportBattery = (value: number | null) => {
      transport.printerInfo.battery = value;
      transport.onPrinterInfo('battery', value, transport.printerInfo);
    };
  });
  await page.click('#connect-btn');
  await expect(page.locator('#printer-info-summary')).toContainText('M220');
  const desktop = page.locator('#status-dot');
  const mobile = page.locator('#mobile-status-dot');
  const report = (value: number | null) => page.evaluate(v => (window as any).reportBattery(v), value);
  await expect(desktop).not.toHaveClass(/printer-battery-low/);
  for (const level of [29, 10, 0]) {
    await report(level);
    for (const dot of [desktop, mobile]) {
      await expect(dot).toHaveClass(/printer-battery-low/);
      await expect(dot).toHaveCSS('background-color', 'rgb(239, 68, 68)');
      await expect(dot).toHaveCSS('animation-name', 'printer-battery-blink');
      await expect(dot).toHaveAttribute('aria-label', `Low printer battery (${level}%) — please charge`);
    }
    await expect(page.locator('#pi-battery-icon')).toHaveClass(/text-red-500/);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mobile).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(mobile).toHaveCSS('animation-name', 'none');
  await expect(mobile).toHaveCSS('opacity', '1');
  await expect(mobile).toHaveCSS('background-color', 'rgb(239, 68, 68)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const level of [30, 80, null, -1, 101]) {
    await report(level);
    for (const dot of [desktop, mobile]) {
      await expect(dot).not.toHaveClass(/printer-battery-low/);
      await expect(dot).toHaveCSS('animation-name', 'none');
    }
    await expect(page.locator('#pi-battery-icon')).not.toHaveClass(/text-red-500/);
    await expect(page.locator('#printer-info-btn')).toHaveAttribute('title', 'Printer Info');
  }
  await report(25);
  await page.click('#printer-info-btn');
  await page.click('#printer-info-disconnect');
  for (const dot of [desktop, mobile]) {
    await expect(dot).not.toHaveClass(/printer-battery-low/);
    await expect(dot).toHaveAttribute('aria-label', 'Printer disconnected');
  }
});
