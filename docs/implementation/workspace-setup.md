# Tutorial: build a workspace like this one

Create a new repository with a React/Vite frontend, a Fastify backend, a shared TypeScript package, and independent Python project boundaries. By the end, the browser will display a message fetched from the backend through Vite's development proxy.

This is a minimal runnable scaffold using the same workspace pattern as this project. It does not reproduce the store features, database schema, or recommendation platform. For running the existing repository, use the [local runbook](../local-development.md).

Use a POSIX shell, Node 24, npm, and Git. Python steps additionally require `uv`; they are optional for the TypeScript exercise. Run every command from the new repository root unless instructed otherwise. The dependency versions below follow this repository's manifests; npm resolves compatible versions and records them in a lockfile.

## 1. Create the directories and root manifest

Choose a new directory outside an existing repository:

```sh
mkdir recsys-workspace-demo
cd recsys-workspace-demo
git init
mkdir -p apps/web/src apps/store-api/src packages/store-contracts/src
mkdir -p tools/generate tools/validate tools/bronze
```

Create `package.json`:

```json
{
  "name": "recsys-workspace-demo",
  "private": true,
  "type": "module",
  "workspaces": ["apps/store-api", "apps/web", "packages/store-contracts"],
  "engines": { "node": ">=24" },
  "scripts": {
    "dev:api": "npm run dev -w @store/api",
    "dev:web": "npm run dev -w @store/web",
    "build": "npm run build -w @store/contracts && npm run build -w @store/api && npm run build -w @store/web"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0"
  }
}
```

An npm workspace is a package managed through one root install and lockfile. `-w @store/api` selects a package by its manifest name. `private` prevents accidental npm publication; `type: module` selects ECMAScript modules. The tools directories are ordinary source directories, not npm workspaces.

Create `.gitignore`:

```text
node_modules/
dist/
data/
*.sqlite*
.venv/
__pycache__/
.env
```

Commit source and lockfiles. Keep runtime databases, generated datasets, and virtual environments out of Git.

## 2. Share a TypeScript baseline

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

Create both `apps/store-api/tsconfig.json` and `packages/store-contracts/tsconfig.json` with this content:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "vite.config.ts"]
}
```

The backend uses Node's module rules. The frontend overrides resolution for Vite and enables JSX and browser types. All packages inherit strict checking. These build scripts will use `--noEmit` for type checks; Vite emits the frontend assets.

## 3. Create the shared contracts package

Create `packages/store-contracts/package.json`:

```json
{
  "name": "@store/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts",
  "scripts": { "build": "tsc --noEmit" },
  "dependencies": { "zod": "^4.1.0" }
}
```

Create `packages/store-contracts/src/index.ts`:

```ts
import { z } from 'zod';

export const healthSchema = z.object({ message: z.string() });
export type Health = z.infer<typeof healthSchema>;
```

Both applications can import the same type and runtime validator. A TypeScript type disappears at runtime; Zod checks the actual HTTP response. This package exports TypeScript source directly, so its consumers need a TypeScript-aware loader or bundler. Here those are `tsx` and Vite.

## 4. Create the Fastify application

Create `apps/store-api/package.json`:

```json
{
  "name": "@store/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@store/contracts": "*",
    "fastify": "^5.6.0"
  }
}
```

Create `apps/store-api/src/main.ts`:

```ts
import Fastify from 'fastify';
import type { Health } from '@store/contracts';

const app = Fastify();
app.get('/health', async (): Promise<Health> => ({
  message: 'Store API connected',
}));
await app.listen({
  host: '127.0.0.1',
  port: Number(process.env.PORT ?? 3001),
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
```

npm links the local `@store/contracts` workspace rather than requiring a published package. `tsx watch` runs TypeScript directly and restarts on changes. The server listens only on loopback.

This exercise stops at a health endpoint. The existing store separates [server construction](../../apps/store-api/src/server.ts) from [process startup](../../apps/store-api/src/main.ts) for injectable API tests and adds [SQLite persistence](../../apps/store-api/src/db.ts). See the [data model](data-model.md) before adding those features.

## 5. Create the React/Vite application

Create `apps/web/package.json`:

```json
{
  "name": "@store/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc --noEmit && vite build"
  },
  "dependencies": {
    "@store/contracts": "*",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "vite": "^7.1.0"
  }
}
```

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Workspace demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.STORE_API_ORIGIN ?? 'http://127.0.0.1:3001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
```

Create `apps/web/src/main.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { healthSchema } from '@store/contracts';

function App() {
  const [message, setMessage] = useState('Connecting…');
  useEffect(() => {
    void fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((body) => setMessage(healthSchema.parse(body).message))
      .catch((error: unknown) => setMessage(String(error)));
  }, []);
  return <h1>{message}</h1>;
}

createRoot(document.getElementById('root')!).render(<App />);
```

The browser calls its own origin at `/api/health`; Vite forwards it to the backend's `/health`. The development proxy avoids needing cross-origin configuration for this exercise. Production hosting must provide its own API routing; the development proxy is not included in the built assets.

## 6. Install, build, and verify

From the new repository root:

```sh
npm install
npm run build
npm run dev:api
```

Keep that terminal running. In another terminal, enter the same repository and run:

```sh
npm run dev:web
```

Open `http://127.0.0.1:5173`. You should see **Store API connected**. Optionally check the backend directly:

```sh
curl http://127.0.0.1:3001/health
```

Expected response: `{"message":"Store API connected"}`. If port 3001 is occupied, start the API with `PORT=3002 npm run dev:api` and Vite with `STORE_API_ORIGIN=http://127.0.0.1:3002 npm run dev:web`. Use the frontend URL Vite prints if its default port is occupied.

`npm install` creates the root `package-lock.json`. Commit it; subsequent clean checkouts use `npm ci`. A passing build validates the package imports and frontend bundle, but does not produce a backend deployment artifact.

Stop both servers with Ctrl-C, then commit the scaffold:

```sh
git add .
git commit -m "Create TypeScript application workspace"
```

## 7. Optionally reserve the independent Python boundaries

To match this repository's ownership split, create an application project and a library under a root uv workspace. These commands require uv and Python 3.14 availability:

```sh
uv init --bare --python 3.14
uv init --app --python 3.14 apps/api
uv init --lib --python 3.14 packages/recommender
```

Inspect the root `pyproject.toml`. Ensure it contains this workspace section once; uv may add members during initialization:

```toml
[tool.uv.workspace]
members = ["apps/api", "packages/recommender"]
```

Then resolve and install that workspace:

```sh
uv sync
uv run --package api python apps/api/main.py
```

The generated application prints its placeholder greeting. This creates a project boundary, not a recommendation API implementation. uv may create its own `.python-version`; keep Python version files aligned with the intended project runtime.

Bronze needs a separate Python 3.12 environment. Create `tools/bronze/pyproject.toml`:

```toml
[project]
name = "store-bronze"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = ["pyspark==4.0.1", "delta-spark==4.0.0"]

[tool.uv]
package = false
```

Keep `tools/bronze` out of the root uv workspace members. Install it separately:

```sh
uv sync --project tools/bronze
```

This yields an independent Bronze environment and lockfile. Running Spark additionally requires JDK 17/21 and the prerequisites in the [Bronze runbook](../local-development.md#bronze-prerequisites-and-ingestion); installing packages alone does not implement ingestion. Commit Python manifests and generated lockfiles when you add these boundaries.

## Continue from the scaffold

The existing repository adds [catalog/UI features](storefront.md), [sessions](identity.md), [transactional carts/orders](transactions.md), [event contracts](events.md), [synthetic generation](synthetic-history.md), and [raw ingestion](bronze.md) on these foundations. See [validation](validation.md) when adding API tests, browser checks, and formatting scripts. The [scaffolding explanation](scaffolding.md) maps the complete current workspace.
