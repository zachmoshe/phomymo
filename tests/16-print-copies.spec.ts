import { test, expect } from '@playwright/test';
import { waitForAppReady, dismissInfoDialog } from './helpers/app';

async function openApp(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForAppReady(page);
  await dismissInfoDialog(page);
}

test('copies are beside Print, persist immediately, and are independent of settings', async ({ page }) => {
  await openApp(page);
  const copies = page.locator('#print-copies');
  await expect(copies).toBeVisible();
  const singleDigitWidth = (await copies.boundingBox())!.width;
  await expect(page.locator('#print-settings-dialog #print-copies')).toHaveCount(0);
  await copies.fill('');
  await copies.pressSequentially('12');
  await expect(copies).toHaveValue('12');
  expect((await copies.boundingBox())!.width).toBeCloseTo(singleDigitWidth * 2, 0);
  await expect(copies).toHaveCSS('border-right-width', '0px');
  await expect(copies).toHaveCSS('outline-style', 'none');
  await expect(page.locator('#mobile-print-copies')).toHaveValue('12');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('phomymo_print_settings')!).copies)).toBe(12);
  await page.reload();
  await waitForAppReady(page);
  await expect(copies).toHaveValue('12');
  await page.click('#print-settings-btn');
  await page.click('#print-settings-reset');
  await page.click('#print-settings-save');
  await expect(copies).toHaveValue('12');
  await page.screenshot({ path: '/tmp/phomymo-print-copies-desktop.png', animations: 'disabled' });
});

test('copies normalize to whole numbers between 1 and 99 on blur', async ({ page }) => {
  await openApp(page);
  const copies = page.locator('#print-copies');
  for (const [value, expected] of [['', '1'], ['0', '1'], ['-3', '1'], ['150', '99'], ['2.5', '2']]) {
    await copies.fill(value);
    await copies.blur();
    await expect(copies).toHaveValue(expected);
    await expect(page.locator('#mobile-print-copies')).toHaveValue(expected);
  }
});

for (const mobile of [false, true]) {
  test(`Print uses the inline copy count (mobile: ${mobile})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {} });
    });
    await openApp(page);
    await page.evaluate(async () => {
      const { BLETransport } = await import('/ble.js?v=104');
      let connected = false;
      (window as any).rasterCount = 0;
      BLETransport.getShared = () => ({
        connect: async () => { connected = true; },
        isConnected: () => connected,
        getDeviceName: () => 'M220-test',
        send: async (bytes: Uint8Array) => {
          if (bytes[0] === 0x1d && bytes[1] === 0x76) (window as any).rasterCount++;
        },
        delay: async () => {},
      });
    });
    const copies = page.locator(mobile ? '#mobile-print-copies' : '#print-copies');
    const printButton = page.locator(mobile ? '#mobile-print-btn' : '#print-btn');
    await expect(copies).toBeInViewport();
    await expect(printButton).toBeInViewport();
    const inputBox = (await copies.boundingBox())!;
    const printBox = (await printButton.boundingBox())!;
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(printBox.x);
    expect(Math.abs(inputBox.y - printBox.y)).toBeLessThan(24);
    await copies.fill('3');
    const numberBox = (await copies.boundingBox())!;
    const arrowsBox = (await copies.locator('..').locator('.print-copies-stepper').boundingBox())!;
    expect(arrowsBox.x - numberBox.x - numberBox.width).toBeLessThanOrEqual(2);
    const control = copies.locator('..');
    await expect(control.locator('span')).toHaveText('×');
    await expect(control).toHaveCSS('border-top-width', '0px');
    await expect(copies).toHaveCSS('height', '38px');
    await control.getByRole('button', { name: 'Increase copies' }).click();
    await expect(copies).toHaveValue('4');
    await control.getByRole('button', { name: 'Decrease copies' }).click();
    await expect(copies).toHaveValue('3');
    await printButton.click();
    await expect(page.locator('#status-message')).toHaveText('Printed 3 copies!');
    expect(await page.evaluate(() => (window as any).rasterCount)).toBe(3);
    if (mobile) {
      await page.screenshot({ path: '/tmp/phomymo-print-copies-mobile.png', animations: 'disabled' });
    }
  });
}
