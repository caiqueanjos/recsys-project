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
  await page.getByRole('button', { name: 'Shop all', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search products' }).fill('kettle');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('.product-card h3')?.textContent?.toLowerCase().includes('kettle'),
  );
  await page.locator('.product-card').first().click();
  await page.getByRole('button', { name: 'Add to bag' }).click();
  await page.getByRole('status').waitFor();
  await page.getByRole('button', { name: 'View bag →' }).click();
  await page.locator('.cart-row').waitFor();
  const guestId = await page.evaluate(() => localStorage.getItem('store.guest')!);
  await page.getByRole('combobox', { name: 'Shopping identity' }).selectOption('persona-active');
  await page.getByRole('heading', { name: 'Little things. Better days.' }).waitFor();
  await page.getByRole('button', { name: 'Bag 0', exact: true }).click();
  await page.getByText('Your bag is waiting for something good.').waitFor();
  await page.getByRole('combobox', { name: 'Shopping identity' }).selectOption(guestId);
  await page.getByRole('heading', { name: 'Little things. Better days.' }).waitFor();
  await page.getByRole('button', { name: 'Bag 1', exact: true }).click();
  await page.locator('.cart-row').waitFor();
  await page.reload();
  await page.locator('.product-card').first().waitFor();
  await page.getByRole('button', { name: 'Bag 1', exact: true }).click();
  await page.locator('.cart-row').waitFor();
  await page.getByRole('button', { name: 'Place demo order ↗' }).click();
  await page.locator('.order').waitFor();
  assert.equal(await page.locator('.order').count(), 1);
  await page.getByRole('button', { name: 'Bag 0', exact: true }).click();
  await page.getByText('Your bag is waiting for something good.').waitFor();
  store.db
    .prepare("UPDATE sessions SET lastActiveAt='2025-01-01T00:00:00.000Z' WHERE shopperId=?")
    .run(guestId);
  await page.getByRole('button', { name: 'Your orders', exact: true }).click();
  await page.getByRole('button', { name: 'Start a new session', exact: true }).click();
  await page.getByRole('heading', { name: 'Little things. Better days.' }).waitFor();
  await page.waitForTimeout(5500); // An expired telemetry queue must not retry into the recovered session.
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'everyday●', exact: true }).click();
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
  assert.ok(
    Number(
      store.db.prepare('SELECT count(*) AS n FROM sessions WHERE shopperId=?').get(guestId)!.n,
    ) >= 3,
  );
  console.log(
    'Browser checks passed: search, product, persona/cart isolation, reload, checkout, history, mobile, observed events.',
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
