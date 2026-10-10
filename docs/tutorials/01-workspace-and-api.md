# 1. Create a workspace and mock catalog API

You will build a tiny TypeScript API that serves two products and test it without opening a network port. You need Node 24 and npm. Use a new directory outside this repository; these files are teaching implementations, not replacements for the checked-in store.

Before starting, complete [machine setup](../how-to/prepare-your-machine.md) and read the **before lesson 1** section of [learning foundations](../explanation/learning-foundations.md).

## 1. Create the package boundaries

In a terminal, choose a parent directory where you keep learning projects. All commands use bash/zsh or a Linux terminal in WSL2. Run each block in order; the commands return you to the lab root whenever they enter a package directory.

```sh
node --version
npm --version
mkdir store-lab
cd store-lab
mkdir -p apps/store-api/src apps/store-api/test packages/contracts/src
npm init -y
```

Expect Node `v24.x`, an npm version, and a new root `package.json`. `mkdir -p` creates the nested directories, while `npm init -y` generates a package manifest with defaults. Now configure that manifest through npm:

```sh
npm pkg set name=store-lab type=module
npm pkg set private=true --json
npm pkg set 'workspaces=["apps/store-api","apps/web","packages/contracts"]' --json
npm pkg set 'scripts.dev:api=npm run dev -w @learn/api' 'scripts.test=npm run test -w @learn/api' 'scripts.check=tsc --noEmit -p apps/store-api'
npm pkg delete main description keywords author license
```

`npm pkg set` edits fields in `package.json`. Dotted names such as `scripts.test` edit nested fields. `--json` interprets values as JSON, so `private` becomes a boolean and `workspaces` becomes an array. The future `apps/web` directory will be created in lesson 2.

Initialize and configure the shared-contract package:

```sh
cd packages/contracts
npm init -y
npm pkg set name=@learn/contracts version=0.0.0 type=module exports=./src/index.ts
npm pkg set private=true --json
npm pkg delete main scripts description keywords author license
cd ../..
```

Its `exports` field tells consumers which source file to import. Initialize the API package next:

```sh
cd apps/store-api
npm init -y
npm pkg set name=@learn/api version=0.0.0 type=module
npm pkg set private=true --json
npm pkg set 'scripts.dev=tsx watch src/main.ts' 'scripts.test=node --import tsx --test test/*.test.ts' 'dependencies.@learn/contracts=*'
npm pkg delete main description keywords author license
cd ../..
```

The dependency on `@learn/contracts` links the API to the local workspace package. Check the package boundaries from the lab root:

```sh
npm pkg get name private workspaces
npm pkg get name --workspaces
```

Expect root name `store-lab`, `private: true`, the three workspace paths, and the two currently existing package names, `@learn/api` and `@learn/contracts`.

Install from the lab root:

```sh
npm install -w @learn/api fastify@5 zod@4
npm install -D typescript@5 tsx@4 @types/node@24
```

`-w @learn/api` installs runtime dependencies in the API workspace. `-D` installs development tools in the root package. Commit the resulting lockfile when saving your lab; future installs can use `npm ci`.

Create the ignore file from the terminal:

```sh
cat > .gitignore <<'EOF'
node_modules/
dist/
data/
.env
EOF
```

The following file-writing commands use a **here-document**: `cat > path <<'EOF'` writes every line up to the closing `EOF` into that file. Quoting `'EOF'` preserves source text without shell expansion. The closing marker must be on its own line. `>` replaces the file, so use these commands when creating the lesson's files. You can inspect and edit them in your editor afterward.

Create `tsconfig.base.json` from the lab root:

```sh
cat > tsconfig.base.json <<'EOF'
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
EOF
```

Create `apps/store-api/tsconfig.json` from the lab root:

```sh
cat > apps/store-api/tsconfig.json <<'EOF'
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
EOF
```

## 2. Define a small shared product shape

Create `packages/contracts/src/index.ts` from the lab root:

```sh
cat > packages/contracts/src/index.ts <<'EOF'
export type Product = {
  id: string;
  name: string;
  priceCents: number;
  available: boolean;
};
EOF
```

This teaching type is smaller than the project's product contract. Cents are integers: a 2500-cent mug costs 25.00, and totals can multiply quantities without floating-point currency arithmetic.

Create `apps/store-api/src/catalog.ts` from the lab root:

```sh
cat > apps/store-api/src/catalog.ts <<'EOF'
import type { Product } from '@learn/contracts';

export const products: Product[] = [
  { id: 'mug', name: 'Stoneware mug', priceCents: 2500, available: true },
  { id: 'kettle', name: 'Pour-over kettle', priceCents: 4500, available: true },
];
EOF
```

This array is the first mock: it substitutes for a catalog query.

## 3. Serve the mock through HTTP

Create `apps/store-api/src/server.ts` from the lab root:

```sh
cat > apps/store-api/src/server.ts <<'EOF'
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
EOF
```

Create `apps/store-api/src/main.ts` from the lab root:

```sh
cat > apps/store-api/src/main.ts <<'EOF'
import { buildServer } from './server.js';

const app = buildServer();
await app.listen({ port: 3001, host: '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void app.close());
}
EOF
```

Separate construction from listening so a test can use the same routes without a live server. `.js` import suffixes follow Node's ESM resolution even though the source files are TypeScript.

## 4. Check a visible result and a missing product

Create `apps/store-api/test/catalog.test.ts` from the lab root:

```sh
cat > apps/store-api/test/catalog.test.ts <<'EOF'
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
EOF
```

First check types and run the request test from `store-lab`:

```sh
npm run check
npm test
```

Expect the type check to finish without errors and the test summary to report one passing test. `app.inject` runs the route inside Fastify without listening on a port.

Start the API; this command keeps the terminal occupied until you stop it:

```sh
npm run dev:api
```

In another terminal, check health, search, and a missing product:

```sh
curl --fail 'http://127.0.0.1:3001/health'
curl --fail 'http://127.0.0.1:3001/products?q=mug'
curl -i 'http://127.0.0.1:3001/products/unknown'
```

Expect `{"status":"ok"}`, one search result with ID `mug`, and an HTTP 404 response containing `Product not found`. The final command uses `-i` to show response headers; it omits `--fail` so you can read the expected error body. You now have a shared contract, a mock dependency, a real HTTP boundary, and a regression check. Stop the API with Ctrl+C before changing ports or starting the repository's API later.

Next: [2. Build the storefront](02-storefront.md). Compare this small API with [the project's server](../../apps/store-api/src/server.ts), or read [why we start with mocks](../explanation/mocks-and-increments.md). [Index](../README.md).
