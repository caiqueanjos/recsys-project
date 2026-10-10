# 1. Create a workspace and mock catalog API

You will build a tiny TypeScript API that serves two products and test it without opening a network port. You need Node 24 and npm. Use a new directory outside this repository; these files are teaching implementations, not replacements for the checked-in store.

Before starting, complete [machine setup](../how-to/prepare-your-machine.md) and read the **before lesson 1** section of [learning foundations](../explanation/learning-foundations.md).

## 1. Create the package boundaries

In a terminal, choose a parent directory where you keep learning projects:

```sh
mkdir store-lab
cd store-lab
mkdir -p apps/store-api/src apps/store-api/test packages/contracts/src
```

Create root `package.json`:

```json
{
  "name": "store-lab",
  "private": true,
  "type": "module",
  "workspaces": ["apps/store-api", "apps/web", "packages/contracts"],
  "scripts": {
    "dev:api": "npm run dev -w @learn/api",
    "test": "npm run test -w @learn/api",
    "check": "tsc --noEmit -p apps/store-api"
  }
}
```

The future `apps/web` directory will be created in lesson 2. Create `packages/contracts/package.json`:

```json
{
  "name": "@learn/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts"
}
```

Create `apps/store-api/package.json`:

```json
{
  "name": "@learn/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "test": "node --import tsx --test test/*.test.ts"
  },
  "dependencies": { "@learn/contracts": "*" }
}
```

Install from the lab root:

```sh
npm install -w @learn/api fastify@5 zod@4
npm install -D typescript@5 tsx@4 @types/node@24
```

Commit the resulting lockfile when saving your lab; future installs can use `npm ci`. Create `.gitignore` containing `node_modules/`, `dist/`, `data/`, and `.env`, one per line.

Create root `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

Create `apps/store-api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

## 2. Define a small shared product shape

Create `packages/contracts/src/index.ts`:

```ts
export type Product = {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
};
```

This teaching type is smaller than the project's product contract. Cents are integers: a 2500-cent mug costs 25.00, and totals can multiply quantities without floating-point currency arithmetic.

Create `apps/store-api/src/catalog.ts`:

```ts
import type { Product } from '@learn/contracts';

export const products: Product[] = [
  { id: 'mug', name: 'Stoneware mug', priceCents: 2500, available: true },
  { id: 'kettle', name: 'Pour-over kettle', priceCents: 4500, available: true },
];
```

This array is the first mock: it substitutes for a catalog query.

## 3. Serve the mock through HTTP

Create `apps/store-api/src/server.ts`:

```ts
import Fastify from 'fastify';
import { z } from 'zod';
import { products } from './catalog.js';

export function buildServer() {
  const app = Fastify();
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/products', async (req) => {
    const { q } = z.object({ q: z.string().max(200).default('') }).parse(req.query);
    const items = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    return { items, total: items.length };
  });
  app.get('/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const product = products.find((p) => p.id === id);
    if (!product) return reply.code(404).send({ error: 'Product not found' });
    return product;
  });
  return app;
}
```

Create `apps/store-api/src/main.ts`:

```ts
import { buildServer } from './server.js';

const app = buildServer();
await app.listen({ port: 3001, host: '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void app.close());
}
```

Separate construction from listening so a test can use the same routes without a live server. `.js` import suffixes follow Node's ESM resolution even though the source files are TypeScript.

## 4. Check a visible result and a missing product

Create `apps/store-api/test/catalog.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';

test('catalog search and missing product', async (t) => {
  const app = buildServer();
  t.after(() => app.close());
  const found = await app.inject({ method: 'GET', url: '/products?q=mug' });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(
    found.json().items.map((p: { id: string }) => p.id),
    ['mug'],
  );
  const missing = await app.inject({ method: 'GET', url: '/products/unknown' });
  assert.equal(missing.statusCode, 404);
});
```

Run from `store-lab`:

```sh
npm run check
npm test
npm run dev:api
```

In another terminal:

```sh
curl --fail 'http://127.0.0.1:3001/products?q=mug'
```

Expect one product with ID `mug`. You now have a shared contract, a mock dependency, a real HTTP boundary, and a regression check. Stop the API with Ctrl+C before changing ports or starting the repository's API later.

Next: [2. Build the storefront](02-storefront.md). Compare this small API with [the project's server](../../apps/store-api/src/server.ts), or read [why we start with mocks](../explanation/mocks-and-increments.md). [Index](../README.md).
