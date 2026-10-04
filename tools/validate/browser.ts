import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Store } from '../../apps/store-api/src/db.js';
import { buildServer } from '../../apps/store-api/src/server.js';
import { defaults, generate } from '../generate/generator.js';

const temp = mkdtempSync(join(tmpdir(), 'store-browser-'));
const store = new Store(join(temp, 'store.sqlite'));
generate(store, { ...defaults, products: 140, shoppers: 80, events: 1000 });
const app = buildServer(store);
let vite: ReturnType<typeof spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  vite = spawn(
    process.execPath,
    [
      '../../node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      '5175',
      '--strictPort',
    ],
    {
      cwd: join(process.cwd(), 'apps/web'),
      env: { ...process.env, STORE_API_ORIGIN: address },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Vite startup timed out')), 15000);
    vite!.stdout!.on('data', (chunk) => {
      if (String(chunk).includes('Local:')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    vite!.stderr!.on('data', (chunk) => process.stderr.write(chunk));
    vite!.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Vite exited: ${code}`));
    });
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5175');
  await page.locator('.product-card').first().waitFor();
  await page.getByRole('link', { name: 'Shop all', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search products' }).fill('kettle');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.product-card h3')?.textContent?.toLowerCase().includes('kettle'),
  );
  assert.equal(new URL(page.url()).searchParams.get('q'), 'kettle');
  const guestId = await page.evaluate(() => localStorage.getItem('store.guest')!);
  const sessionCount = () =>
    Number(
      store.db.prepare('SELECT count(*) AS n FROM sessions WHERE shopperId=?').get(guestId)!.n,
    );
  const initialSessions = sessionCount();
  const currentSessionId = () =>
    String(
      store.db
        .prepare('SELECT id FROM sessions WHERE shopperId=? ORDER BY rowid DESC LIMIT 1')
        .get(guestId)!.id,
    );
  const initialSessionId = currentSessionId();
  const productViews = (sessionId: string) =>
    Number(
      store.db
        .prepare("SELECT count(*) AS n FROM events WHERE sessionId=? AND type='product_view'")
        .get(sessionId)!.n,
    );
  async function expectProductViews(sessionId: string, count: number) {
    const deadline = Date.now() + 5000;
    while (productViews(sessionId) < count && Date.now() < deadline) await page.waitForTimeout(25);
    assert.equal(productViews(sessionId), count, 'Emit one product view per visit');
  }
  const productUrl = await page.locator('.product-card').first().getAttribute('href');
  assert.ok(productUrl);
  await page.locator('.product-card').first().click();
  await page.locator('.product-detail').waitFor();
  assert.equal(new URL(page.url()).pathname, productUrl);
  await expectProductViews(initialSessionId, 1);
  await page.goBack();
  await page.locator('.product-card').first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('q'), 'kettle');
  assert.equal(await page.getByRole('textbox', { name: 'Search products' }).inputValue(), 'kettle');
  await page.goForward();
  await page.locator('.product-detail').waitFor();
  assert.equal(sessionCount(), initialSessions, 'Client navigation must keep the session');
  await expectProductViews(initialSessionId, 2);
  await page.reload();
  await page.locator('.product-detail').waitFor();
  assert.equal(new URL(page.url()).pathname, productUrl);
  assert.equal(sessionCount(), initialSessions + 1, 'Reload must open one new session');
  // Loading a product URL directly must work without a catalog object in React state.
  await page.goto(`http://127.0.0.1:5175${productUrl}`);
  await page.locator('.product-detail').waitFor();
  assert.equal(sessionCount(), initialSessions + 2);
  await page.goto('http://127.0.0.1:5175/products/does-not-exist');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('.product-detail').count(), 0);
  await page.goto('http://127.0.0.1:5175/missing-page');
  await page.getByText('Page not found.').waitFor();
  await page.getByRole('link', { name: 'Return home' }).click();
  await page.locator('.product-card').first().waitFor();
  // Filters and pagination survive refresh and browser history.
  await page.getByRole('link', { name: 'Shop all', exact: true }).click();
  await page.locator('.product-card').first().waitFor();
  await page.getByRole('button', { name: 'Next →', exact: true }).click();
  await page.waitForFunction(
    () =>
      location.search.includes('page=2') && document.querySelectorAll('.product-card').length > 0,
  );
  await page.reload();
  await page.locator('.product-card').first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('page'), '2');
  await page
    .getByRole('combobox', { name: 'Category', exact: true })
    .selectOption('Home & Kitchen');
  await page.locator('.product-card').first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('category'), 'Home & Kitchen');
  assert.equal(new URL(page.url()).searchParams.get('page'), null);
  await page.goBack();
  await page.locator('.product-card').first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('page'), '2');
  assert.equal(
    await page.getByRole('combobox', { name: 'Category', exact: true }).inputValue(),
    '',
  );
  await page.goto(`http://127.0.0.1:5175${productUrl}`);
  await page.locator('.product-detail').waitFor();
  await page.getByRole('button', { name: 'Add to bag' }).click();
  await page.getByRole('status').waitFor();
  await expectProductViews(currentSessionId(), 1);
  await page.getByRole('link', { name: 'View bag →' }).click();
  await page.locator('.cart-row').waitFor();
  await page.getByRole('combobox', { name: 'Shopping identity' }).selectOption('persona-active');
  await page.getByRole('heading', { name: 'Little things. Better days.' }).waitFor();
  await page.getByRole('link', { name: 'Bag 0', exact: true }).click();
  await page.getByText('Your bag is waiting for something good.').waitFor();
  await page.getByRole('combobox', { name: 'Shopping identity' }).selectOption(guestId);
  await page.getByRole('heading', { name: 'Little things. Better days.' }).waitFor();
  await page.getByRole('link', { name: 'Bag 1', exact: true }).click();
  await page.locator('.cart-row').waitFor();
  await page.reload();
  assert.equal(new URL(page.url()).pathname, '/cart');
  await page.locator('.cart-row').waitFor();
  const checkoutKeys: string[] = [];
  let loseFirstResponse = true;
  await page.route('**/api/checkout', async (route) => {
    checkoutKeys.push(route.request().postDataJSON().idempotencyKey);
    const response = await route.fetch();
    if (loseFirstResponse) {
      loseFirstResponse = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Checkout response lost; try again' }),
      });
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Place demo order ↗' }).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Place demo order ↗' }).click();
  await page.locator('.order').waitFor();
  assert.equal(checkoutKeys.length, 2);
  assert.equal(checkoutKeys[0], checkoutKeys[1], 'Checkout retries must reuse the key');
  assert.equal(new URL(page.url()).pathname, '/orders');
  await page.getByRole('status').waitFor();
  await page.unroute('**/api/checkout');
  assert.equal(await page.locator('.order').count(), 1);
  await page.getByRole('link', { name: 'Bag 0', exact: true }).click();
  await page.getByText('Your bag is waiting for something good.').waitFor();
  store.db
    .prepare("UPDATE sessions SET lastActiveAt='2025-01-01T00:00:00.000Z' WHERE shopperId=?")
    .run(guestId);
  await page.getByRole('link', { name: 'Your orders', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new session', exact: true }).click();
  await page.getByRole('heading', { name: 'Little things. Better days.' }).waitFor();
  await page.waitForTimeout(5500); // An expired telemetry queue must not retry into the recovered session.
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'everyday●', exact: true }).click();
  await page.locator('.product-card').first().waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(
    store.db
      .prepare("SELECT count(*) AS n FROM events WHERE shopperId=? AND type='purchase'")
      .get(guestId)!.n,
    1,
  );
  assert.ok(
    Number(
      store.db
        .prepare("SELECT count(*) AS n FROM events WHERE source='browser' AND type='impression'")
        .get()!.n,
    ) > 0,
  );
  const clicks = store.db
    .prepare("SELECT payload FROM events WHERE source='browser' AND type='click'")
    .all();
  assert.ok(clicks.length > 0);
  for (const row of clicks) {
    const click = JSON.parse(String(row.payload));
    const prior = store.db
      .prepare('SELECT payload FROM events WHERE id=?')
      .get(click.context.impressionId);
    assert.ok(prior, 'Clicks must reference persisted impressions');
    const impression = JSON.parse(String(prior.payload));
    assert.equal(impression.sessionId, click.sessionId);
    assert.equal(impression.context.productId, click.context.productId);
    assert.equal(impression.context.surface, click.context.surface);
    assert.equal(impression.context.position, click.context.position);
    assert.ok(impression.occurredAt <= click.occurredAt);
  }
  assert.ok(
    Number(
      store.db.prepare('SELECT count(*) AS n FROM sessions WHERE shopperId=?').get(guestId)!.n,
    ) >= 3,
  );
  console.log(
    'Browser checks passed: URL filters/pagination, Back/Forward, direct product links, refresh, missing routes/products, persona/cart isolation, checkout retries, history, mobile, observed events.',
  );
} finally {
  await browser?.close();
  if (vite && vite.exitCode === null) {
    const exited = new Promise((resolve) => vite!.once('exit', resolve));
    vite.kill();
    await exited;
  }
  await app.close();
  store.db.close();
  rmSync(temp, { recursive: true, force: true });
}
