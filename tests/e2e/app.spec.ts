// End-to-end checks from PLAN §9, run against the production build (real service worker).
// The download test talks to the real tile servers, so it needs an internet connection.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { destinationPoint, bearingDeg } from '../../src/domain/geo';
import { buildTrail, parseGpx } from '../../src/domain/gpx';

const fixture = fileURLToPath(new URL('../fixtures/example.gpx', import.meta.url));
const trail = buildTrail(parseGpx(readFileSync(fixture, 'utf8')), { id: 'x', fileName: 'example.gpx', gpxText: '', now: 0 });
const seg = trail.segments[0]!;
const cd = trail.cumDist[0]!;
const ON_TRAIL = 400; // a point about a third of the way round the loop

const chalten = fileURLToPath(new URL('../fixtures/chalten-no-elevation.gpx', import.meta.url));

const TILE_HOSTS = /openfreemap\.org|amazonaws\.com/;

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
const failedTileRequests: string[] = [];

async function waitForMapIdle(p: Page): Promise<void> {
  await p.waitForFunction(
    () => {
      const m = (window as unknown as { __trailkeepMap?: { loaded(): boolean; areTilesLoaded(): boolean } }).__trailkeepMap;
      return Boolean(m && m.loaded() && m.areTilesLoaded());
    },
    undefined,
    { timeout: 60_000 },
  );
  await p.waitForTimeout(800);
}

/** Counts what is drawn and how many distinct colours the map canvas has. */
async function mapReport(p: Page) {
  return p.evaluate(() => {
    type M = { queryRenderedFeatures(o: { layers: string[] }): unknown[]; getCanvas(): HTMLCanvasElement; getStyle(): { layers: { id: string; source?: string; type: string }[] } };
    const m = (window as unknown as { __trailkeepMap: M }).__trailkeepMap;
    const layers = m.getStyle().layers;
    const ids = (pred: (l: { id: string; source?: string; type: string }) => boolean) => layers.filter(pred).map((l) => l.id);
    const count = (list: string[]) => (list.length ? m.queryRenderedFeatures({ layers: list }).length : 0);
    const src = m.getCanvas();
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0, 64, 64);
    const px = ctx.getImageData(0, 0, 64, 64).data;
    const colours = new Set<number>();
    for (let i = 0; i < px.length; i += 4) colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
    return {
      basemap: count(ids((l) => l.source === 'openmaptiles' && l.type !== 'symbol')),
      labels: count(ids((l) => l.source === 'openmaptiles' && l.type === 'symbol')),
      contours: count(['tk_contour_lines']),
      trail: count(['tk-trail-line']),
      colours: colours.size,
    };
  });
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext({
    ...test.info().project.use,
    permissions: ['geolocation'],
    geolocation: { latitude: seg[ON_TRAIL]![0], longitude: seg[ON_TRAIL]![1], accuracy: 8 },
  });
  await context.addInitScript(() => {
    const geo = navigator.geolocation;
    const w = window as unknown as { __clearWatchCalls: number; __watchCalls: number };
    w.__clearWatchCalls = 0;
    w.__watchCalls = 0;
    const clear = geo.clearWatch.bind(geo);
    const watch = geo.watchPosition.bind(geo);
    geo.clearWatch = (id: number) => {
      w.__clearWatchCalls++;
      clear(id);
    };
    geo.watchPosition = (...args: Parameters<Geolocation['watchPosition']>) => {
      w.__watchCalls++;
      return watch(...args);
    };
  });
  page = await context.newPage();
  page.on('requestfailed', (req) => {
    if (TILE_HOSTS.test(req.url())) failedTileRequests.push(req.url());
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('1. import example.gpx and see its stats', async () => {
  await page.goto('./');
  await expect(page.getByText('No trails yet')).toBeVisible();
  await page.setInputFiles('[data-testid=gpx-input]', fixture);

  // Import offers the map download straight away.
  await expect(page.getByRole('dialog', { name: 'Download map' })).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();

  const card = page.locator('.trail-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Estany de Sant Maurici - Amitges - Obagues de Ratera');
  await expect(card).toContainText('17.3 km');
  await expect(card).toContainText('↑ 860 m');
  await expect(card).toContainText('loop');
  await expect(card).toContainText('Not downloaded');
});

test('2. reject a file that is not GPX with a friendly message', async () => {
  await page.setInputFiles('[data-testid=gpx-input]', { name: 'notes.gpx', mimeType: 'text/plain', buffer: Buffer.from('hello, not xml') });
  await expect(page.getByText('This does not look like a GPX file.')).toBeVisible();
  await expect(page.locator('.trail-card')).toHaveCount(1);
});

test('3. download the trail map', async () => {
  await page.getByRole('button', { name: /^Actions for/ }).click();
  await page.getByRole('button', { name: 'Download map…' }).click();
  await expect(page.getByText(/About .* MB/)).toBeVisible();
  await page.getByRole('button', { name: 'Download map', exact: true }).click();
  await expect(page.getByText('Ready offline.')).toBeVisible({ timeout: 100_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.trail-card')).toContainText('Ready offline');
});

test('4. offline: reload with no network, map still draws with labels and contours', async () => {
  // The app shell must be precached before going offline.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(async () => Boolean(await caches.match(new URL('index.html', document.baseURI).toString())), undefined, {
    timeout: 60_000,
  });

  await context.setOffline(true);
  failedTileRequests.length = 0;
  await page.reload();
  await expect(page.locator('.trail-card')).toContainText('Ready offline');

  await page.locator('.trail-open').click();
  await waitForMapIdle(page);
  await expect(page.getByTestId('net')).toHaveText('Offline');

  const overview = await mapReport(page);
  expect(overview.basemap).toBeGreaterThan(20);
  expect(overview.labels).toBeGreaterThan(0);
  expect(overview.trail).toBeGreaterThan(0);
  expect(overview.colours).toBeGreaterThan(50);

  // Zoom right in on the trail: basemap over-zooms from z14, contours are generated on the device.
  await page.evaluate(
    ([lat, lon]) => {
      (window as unknown as { __trailkeepMap: { jumpTo(o: object): void } }).__trailkeepMap.jumpTo({ center: [lon, lat], zoom: 15.5 });
    },
    [seg[ON_TRAIL]![0], seg[ON_TRAIL]![1]] as const,
  );
  await waitForMapIdle(page);
  const close = await mapReport(page);
  expect(close.basemap).toBeGreaterThan(0);
  expect(close.contours).toBeGreaterThan(5);
  expect(close.colours).toBeGreaterThan(30);

  // Far outside the downloaded area the z0-10 context still shows instead of a blank map.
  await page.evaluate(() => {
    (window as unknown as { __trailkeepMap: { jumpTo(o: object): void } }).__trailkeepMap.jumpTo({ center: [1.25, 42.75], zoom: 12 });
  });
  await waitForMapIdle(page);
  const outside = await mapReport(page);
  expect(outside.basemap).toBeGreaterThan(0);

  expect(failedTileRequests).toEqual([]);
  await context.setOffline(false);
});

test('5. mocked GPS on the trail shows progress', async () => {
  await page.reload();
  await waitForMapIdle(page);
  await page.getByTestId('enable-location').click();

  await expect(page.getByTestId('gps-chip')).toContainText('GPS ±8 m');
  const done = page.getByTestId('done');
  await expect(done).toBeVisible();
  const km = Number((await done.textContent())!.replace(/[^0-9.]/g, ''));
  expect(Math.abs(km - cd[ON_TRAIL]! / 1000)).toBeLessThan(0.03);

  // "Left" is above 10 km here, so it is shown to one decimal: allow for that rounding.
  const left = Number((await page.getByTestId('left').textContent())!.replace(/[^0-9.]/g, ''));
  expect(Math.abs(km + left - trail.stats.distanceM / 1000)).toBeLessThan(0.08);
  await expect(page.getByTestId('key-line')).toContainText('≈');
  await expect(page.getByTestId('offtrail')).toHaveCount(0);

  // Step 120 m sideways off the trail: the off-trail warning appears.
  const a = seg[ON_TRAIL]!;
  const b = seg[ON_TRAIL + 1]!;
  const [lat, lon] = destinationPoint(a[0], a[1], bearingDeg(a[0], a[1], b[0], b[1]) + 90, 120);
  await context.setGeolocation({ latitude: lat, longitude: lon, accuracy: 8 });
  await expect(page.getByTestId('offtrail')).toContainText('Off trail', { timeout: 15_000 });
});

test('6. GPS stops when the app is hidden and restarts when it is shown', async () => {
  const before = await page.evaluate(() => (window as unknown as { __clearWatchCalls: number }).__clearWatchCalls);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const after = await page.evaluate(() => (window as unknown as { __clearWatchCalls: number }).__clearWatchCalls);
  expect(after).toBe(before + 1);
  const log = await page.evaluate(() => (window as unknown as { __trailkeepGeoLog(): { event: string; detail?: string }[] }).__trailkeepGeoLog());
  expect(log[log.length - 1]).toMatchObject({ event: 'clear', detail: 'hidden' });

  const watches = await page.evaluate(() => (window as unknown as { __watchCalls: number }).__watchCalls);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => (window as unknown as { __watchCalls: number }).__watchCalls)).toBe(watches + 1);
});

test('7. elevation profile scrubbing highlights a point', async () => {
  await page.getByRole('button', { name: 'Expand panel' }).click();
  await expect(page.getByTestId('eta')).toContainText('≈');
  const scrub = page.getByTestId('profile-scrub');
  const box = (await scrub.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.profile-tip')).toContainText('km');
  await expect(page.locator('.profile-tip')).toContainText(' m ');
  await expect(page.getByRole('button', { name: 'Show on map' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.profile-tip')).toBeHidden();
});

test('8. custom area: draw, name, download; then the trip check', async () => {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /^Download area/ }).click();
  await expect(page.getByTestId('area-estimate')).toContainText('tiles');
  const download = page.getByRole('button', { name: 'Download', exact: true });
  await expect(download).toBeDisabled(); // a name is required
  await page.getByTestId('area-name').fill('Test valley');
  await expect(download).toBeEnabled();
  await download.click();

  await page.goto('./#/storage');
  const row = page.locator('.region-row', { hasText: 'Test valley' });
  await expect(row).toContainText('Ready', { timeout: 100_000 });
  await expect(row).toContainText('Custom area');

  await page.getByTestId('run-checks').click();
  await expect(page.getByTestId('verdict')).toBeVisible();
  for (const id of ['shell', 'fonts', 'regions', 'location']) {
    await expect(page.locator(`[data-check=${id}]`)).toHaveClass(/\bok\b/);
  }
});

test('9. Argentina: interrupted download resumes, and missing elevation is filled from terrain', async () => {
  await page.goto('./');
  // Slow the tile servers down so the download can be interrupted half way.
  await context.route(/\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf|\/terrarium\//, async (route) => {
    await new Promise((r) => setTimeout(r, 150));
    await route.continue();
  });

  await page.setInputFiles('[data-testid=gpx-input]', chalten);
  await expect(page.getByRole('dialog', { name: 'Download map' })).toBeVisible();
  const card = page.locator('.trail-card', { hasText: 'El Chaltén' });
  await expect(card).toContainText('km');
  await expect(card).not.toContainText('↑'); // the file has no elevation

  await page.getByRole('button', { name: 'Download map', exact: true }).click();
  await expect(page.getByText(/^[2-9]\d \/ \d+ tiles/)).toBeVisible({ timeout: 60_000 });

  // Simulate iOS killing the app mid-download.
  await page.reload();
  await expect(card).toContainText('Downloading', { timeout: 20_000 });
  // Let requests that are still being delayed finish before removing the delay.
  await context.unrouteAll({ behavior: 'wait' });
  await expect(card).toContainText('Ready offline', { timeout: 100_000 });

  // Elevation came from the downloaded DEM tiles.
  await expect(card).toContainText('↑');
  const gain = Number(/↑ (\d+) m/.exec((await card.textContent())!)![1]);
  expect(gain).toBeGreaterThan(200);
  expect(gain).toBeLessThan(2500);

  // The map draws at the Patagonian trailhead with no network.
  await context.setOffline(true);
  await card.locator('.trail-open').click();
  await waitForMapIdle(page);
  const report = await mapReport(page);
  expect(report.basemap).toBeGreaterThan(5);
  expect(report.trail).toBeGreaterThan(0);
  expect(report.colours).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Expand panel' }).click();
  await expect(page.locator('.profile svg')).toBeVisible();
  await context.setOffline(false);
});
