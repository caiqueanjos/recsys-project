# Tutorial: scaffold a workspace with the CLI

Start with an empty directory and use npm, Vite, TypeScript, and uv to generate the project foundations. Then connect the generated projects with shared contracts and a development proxy. The visible result is a React page displaying a message from a Fastify endpoint.

This creates a workspace with the same boundaries as this repository, not an exact copy of its dependencies or store implementation. `@latest` generates today's template; keep its generated configuration and commit the resulting lockfiles. For installing this existing repository, follow the [local runbook](../local-development.md).

Use Node 24, npm, Git, and a POSIX shell. The optional Python section also requires uv. Run commands from the new repository root unless stated otherwise.

## 1. Initialize the repository and npm workspace

```sh
mkdir recsys-workspace-demo
cd recsys-workspace-demo
git init
npm init -y
npm pkg set private=true --json
npm pkg set type=module 'engines.node=>=24'
npm pkg delete main scripts.test
```

`npm init` creates the root manifest. `npm pkg set` updates it without replacing the generated file. `private` prevents publishing the root package, and `type=module` selects ECMAScript modules.

Generate the two plain TypeScript packages:

```sh
npm init -y -w apps/store-api
npm init -y -w packages/store-contracts
```

The `-w` form creates each package and registers it in the root `workspaces` array. npm manages these packages through a root install and lockfile. See the [npm workspace initializer documentation](https://docs.npmjs.com/cli/v11/commands/npm-init).

## 2. Generate the React application with Vite

```sh
npm create vite@latest apps/web -- --template react-ts
```

Accept installation of `create-vite` if prompted. If the scaffolder offers to install dependencies and start the server immediately, decline that option for now: first register the frontend in the root workspace. The `react-ts` template supplies React entry points, HTML, TypeScript configuration, Vite configuration, starter styles/assets, and build scripts. [Vite's scaffolding guide](https://vite.dev/guide/) documents this command and the available templates.

Register the generated frontend after the two packages from step 1:

```sh
npm pkg set 'workspaces[2]=apps/web'
npm pkg set name=@store/web -w apps/web
npm pkg set name=@store/api type=module -w apps/store-api
npm pkg set name=@store/contracts type=module -w packages/store-contracts
npm pkg set private=true --json -w apps/store-api -w packages/store-contracts
npm pkg delete main scripts.test -w apps/store-api -w packages/store-contracts
```

Inspect the root `package.json`: its workspace paths should be `apps/store-api`, `packages/store-contracts`, and `apps/web`. Package names let subsequent commands use `-w @store/web` rather than a directory path.

Keep Vite's generated `tsconfig.json`, application/Node configs, React plugin, and build script. They can differ from this repository's older, simplified configuration. The goal is to connect the template, not overwrite it with historical boilerplate.

## 3. Install dependencies and define root commands

```sh
npm install -D typescript tsx @types/node
npm install fastify -w @store/api
npm install zod -w @store/contracts
npm pkg set 'dependencies.@store/contracts=*' -w @store/api -w @store/web
npm pkg set 'exports=./src/index.ts' 'scripts.build=tsc --noEmit' -w @store/contracts
npm pkg set 'scripts.dev=tsx watch src/main.ts' 'scripts.build=tsc --noEmit' -w @store/api
npm pkg set 'scripts.dev:api=npm run dev -w @store/api' 'scripts.dev:web=npm run dev -w @store/web'
npm pkg set 'scripts.build=npm run build -w @store/contracts && npm run build -w @store/api && npm run build -w @store/web'
npm install
```

The final install resolves the local contracts dependency and updates workspace links. `@store/contracts` must already be registered and named correctly before it is referenced. Its `*` dependency resolves to the local workspace; no registry publication is needed.

The frontend keeps the dependencies and scripts its template generated. The root toolchain supports the API and contracts. This project exports contracts as TypeScript source; `tsx` and Vite can consume it directly. These API/contracts build commands check types without emitting a production API bundle.

## 4. Initialize the backend TypeScript configuration

```sh
mkdir -p apps/store-api/src packages/store-contracts/src tools/generate tools/validate
npx tsc --init --target ES2023 --module NodeNext --strict --noEmit
```

Rename the generated root `tsconfig.json` to `tsconfig.base.json`. In that generated file, use `"types": ["node"]` instead of an empty `types` array. The backend needs Node globals such as `process`. Leave the generated strict/module options in place.

For each of `apps/store-api/tsconfig.json` and `packages/store-contracts/tsconfig.json`, add this small workspace-specific configuration:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

These two packages share Node's module resolution. Leave the Vite frontend using its generated browser/bundler configuration; forcing the backend config onto it would discard settings supplied by the template.

## 5. Add the code that connects the packages

Scaffolders supply project structure. The health contract, endpoint, and UI request below are application code that you add afterward.

In `packages/store-contracts/src/index.ts`:

```ts
import { z } from 'zod';

export const healthSchema = z.object({ message: z.string() });
export type Health = z.infer<typeof healthSchema>;
```

The inferred type helps TypeScript check the backend response. The schema validates the response at runtime in the browser.

In `apps/store-api/src/main.ts`:

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

In Vite's generated `apps/web/src/App.tsx`, replace the starter component with:

```tsx
import { useEffect, useState } from 'react';
import { healthSchema } from '@store/contracts';

export default function App() {
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
```

Keep the generated `main.tsx`; it already mounts `App`. There is no need to reconstruct the HTML or React entry point.

## 6. Add the development proxy to Vite's config

In `apps/web/vite.config.ts`, add the following `server` property inside the existing `defineConfig({ ... })`. Keep the generated imports and `plugins` configuration:

```ts
server: {
  proxy: {
    '/api': {
      target: process.env.STORE_API_ORIGIN ?? 'http://127.0.0.1:3001',
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
  },
},
```

The browser requests `/api/health` from Vite; the proxy forwards `/health` to Fastify. This proxy is for development. Production hosting needs its own API routing.

## 7. Build and observe the connection

```sh
npm run build
npm run dev:api
```

In a second terminal, enter the new repository and run:

```sh
npm run dev:web -- --host 127.0.0.1
```

Open the URL Vite prints, normally `http://127.0.0.1:5173`. You should see **Store API connected**. You can also check Fastify directly:

```sh
curl http://127.0.0.1:3001/health
```

Expected response: `{"message":"Store API connected"}`. If the API port is occupied, use `PORT=3002 npm run dev:api` and `STORE_API_ORIGIN=http://127.0.0.1:3002 npm run dev:web -- --host 127.0.0.1`. Stop both servers with Ctrl-C when finished.

Retain Vite's generated ignore rules. Add a root `.gitignore` for workspace-wide outputs:

```text
node_modules/
dist/
data/
*.sqlite*
.venv/
__pycache__/
.env
```

Commit the manifests, generated source/configuration, and root `package-lock.json`. Use `npm ci` for subsequent clean checkouts. Do not commit virtual environments, databases, or generated data.

```sh
git add .
git commit -m "Scaffold TypeScript application workspace"
```

## 8. Optionally scaffold the Python recommendation workspace

Use uv to initialize a root project, application, and library:

```sh
uv init --bare --python 3.14
uv init --app --python 3.14 apps/api
uv init --lib --python 3.14 packages/recommender
```

uv registers projects initialized beneath a root project as workspace members. Inspect the generated root `pyproject.toml`; its `tool.uv.workspace.members` should contain `apps/api` and `packages/recommender`. Keep the generated application and library layouts. These commands reserve the user-owned recommendation boundaries; they do not implement recommendation serving. See [uv project creation](https://docs.astral.sh/uv/concepts/projects/init/) and [workspace behavior](https://docs.astral.sh/uv/concepts/projects/workspaces/).

```sh
uv sync
uv run --package api python apps/api/main.py
```

Expect the generated application's greeting. uv creates its environment and lockfile when resolving/running the project. Preserve its generated Python version pins and commit the lockfile.

## 9. Initialize Bronze as a standalone Python project

Use the CLI to create Bronze outside the root uv workspace membership:

```sh
uv init --app --name store-bronze --python 3.12 --no-workspace tools/bronze
```

`--no-workspace` prevents automatic membership in the Python 3.14 workspace. To match the implemented Bronze runtime, narrow `requires-python` in the generated `tools/bronze/pyproject.toml` to `">=3.12,<3.13"`. Then add its versioned dependencies through uv:

```sh
uv add --project tools/bronze 'pyspark==4.0.1' 'delta-spark==4.0.0'
uv sync --project tools/bronze
```

Inspect the root workspace membership to confirm Bronze is absent. It has its own `.venv` and `uv.lock`. The generated `main.py` is a placeholder; this repository later adds [ingest.py](../../tools/bronze/ingest.py). Spark execution additionally requires JDK 17/21 and the [Bronze prerequisites](../local-development.md#bronze-prerequisites-and-ingestion). The [uv CLI reference](https://docs.astral.sh/uv/reference/cli/) describes `--no-workspace` and project-targeted dependency commands.

Commit the Python manifests, generated code, version pins, and lockfiles when adding these boundaries.

## Continue from the scaffold

The existing repository adds [catalog/UI features](storefront.md), [sessions](identity.md), [transactional carts/orders](transactions.md), [events](events.md), [synthetic generation](synthetic-history.md), and [Bronze ingestion](bronze.md). These are subsequent implementations, not capabilities provided by the initializers. The [scaffolding explanation](scaffolding.md) maps the complete current workspace.
