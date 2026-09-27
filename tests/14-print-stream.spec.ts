import { test, expect } from '@playwright/test';

for (const densityTest of [false, true]) {
  test(`status queries cannot interrupt printing (density test: ${densityTest})`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (densityTest) => {
      const { BLETransport } = await import('/ble.js');
      const { print, printDensityTest } = await import('/printer.js');
      const transport = new BLETransport();
      const packets: number[][] = [];
      let releaseRaster!: () => void;
      let rasterStarted!: () => void;
      const paused = new Promise<void>(resolve => { releaseRaster = resolve; });
      const started = new Promise<void>(resolve => { rasterStarted = resolve; });
      let held = false;
      transport.isConnected = () => true;
      transport.delay = async () => {};
      transport.send = async (bytes: Uint8Array) => {
        packets.push(Array.from(bytes));
        if (bytes.length === 128 && !held) {
          held = true;
          rasterStarted();
          await paused;
        }
      };
      const job = densityTest ? printDensityTest(transport) : print(transport, {
        data: new Uint8Array(72 * 10).fill(0xaa), widthBytes: 72, heightLines: 10,
      }, { isBLE: true, deviceName: 'M220' });
      await started;
      // Deterministically fire the connection-time query while raster data is
      // in flight, instead of relying on real Bluetooth or timer timing.
      const queries = transport.queryAll();
      await new Promise(resolve => setTimeout(resolve, 0));
      const queriedDuringRaster = packets.some(p => p[0] === 0x1f && p[1] === 0x11);
      releaseRaster();
      await Promise.all([job, queries]);
      const feedIndex = packets.findLastIndex(p => p[0] === 0x1b && p[1] === 0x4a);
      const queryIndexes = packets.flatMap((p, i) => p[0] === 0x1f && p[1] === 0x11 ? [i] : []);
      return { queriedDuringRaster, feedIndex, queryIndexes };
    }, densityTest);
    expect(result.queriedDuringRaster).toBe(false);
    expect(result.feedIndex).toBeGreaterThan(0);
    expect(result.queryIndexes).toHaveLength(4);
    expect(result.queryIndexes.every(index => index > result.feedIndex)).toBe(true);
  });
}

test('printing waits for an in-flight query and recovers after a failed job', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { BLETransport } = await import('/ble.js');
    const { print } = await import('/printer.js');
    const transport = new BLETransport();
    const events: string[] = [];
    let releaseQuery!: () => void;
    let queryStarted!: () => void;
    const paused = new Promise<void>(resolve => { releaseQuery = resolve; });
    const started = new Promise<void>(resolve => { queryStarted = resolve; });
    transport.isConnected = () => true;
    transport.delay = async () => {};
    let failPrint = true;
    transport.send = async (bytes: Uint8Array) => {
      if (bytes[0] === 0x1f) {
        events.push('query-start');
        queryStarted();
        await paused;
        events.push('query-end');
      } else if (bytes[0] === 0x1b && bytes[1] === 0x40) {
        events.push('print-init');
        if (failPrint) throw new Error('Simulated write failure');
      }
    };
    const query = transport.query('battery');
    await started;
    const raster = { data: new Uint8Array(72), widthBytes: 72, heightLines: 1 };
    const job = print(transport, raster, { isBLE: true }).catch(error => error.message);
    await new Promise(resolve => setTimeout(resolve, 0));
    const beforeRelease = [...events];
    releaseQuery();
    await query;
    const failure = await job;
    failPrint = false;
    await print(transport, raster, { isBLE: true });
    await transport.query('paper');
    return { beforeRelease, failure, events };
  });
  expect(result.beforeRelease).toEqual(['query-start']);
  expect(result.failure).toBe('Simulated write failure');
  expect(result.events).toEqual([
    'query-start', 'query-end', 'print-init', 'print-init', 'query-start', 'query-end',
  ]);
});
