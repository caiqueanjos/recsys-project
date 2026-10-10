# 2. Build a storefront from a mock

You will render fixed products first, then fetch them through the API from lesson 1. You will also make search and product links survive a reload. Continue in the same `store-lab` directory, with Node/npm installed.

Before starting, complete [machine setup](../how-to/prepare-your-machine.md) and read the **before lesson 2** section of [learning foundations](../explanation/learning-foundations.md).

## 1. Add a React workspace

From the lab root:

```sh
mkdir -p apps/web/src
```

Create `apps/web/package.json`:

```json
{
  "name": "@learn/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite --host 127.0.0.1", "build": "tsc --noEmit && vite build" },
  "dependencies": { "@learn/contracts": "*" }
}
```

Register the new workspace in the existing install, then add dependencies:

```sh
npm install
npm install -w @learn/web react@19 react-dom@19 react-router@8
npm install -D -w @learn/web vite@7 @types/react@19 @types/react-dom@19
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

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Store lab</title>
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
        target: 'http://127.0.0.1:3001',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
```

## 2. Render one mock product

Create `apps/web/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
```

Create `apps/web/src/App.tsx`:

```tsx
import type { Product } from '@learn/contracts';

const mug: Product = { id: 'mug', name: 'Stoneware mug', priceCents: 2500, available: true };
export function App() {
  return (
    <main>
      <h1>Store lab</h1>
      <p>
        {mug.name}: {(mug.priceCents / 100).toFixed(2)}
      </p>
    </main>
  );
}
```

Run `npm run dev -w @learn/web` and open the displayed Vite URL. Expect **Stoneware mug: 25.00**. No backend is needed for this checkpoint.

## 3. Replace the mock with an API boundary

Create `apps/web/src/api.ts`:

```ts
export async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Request failed');
  return body;
}
```

Replace the entire `apps/web/src/App.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router';
import type { Product } from '@learn/contracts';
import { get } from './api';

function useData<T>(path: string) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string }>();
  useEffect(() => {
    let cancelled = false;
    get<T>(path).then(
      (data) => {
        if (!cancelled) setResult({ path, data });
      },
      (error: Error) => {
        if (!cancelled) setResult({ path, error: error.message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path]);
  return result?.path === path ? result : undefined;
}

function Catalog() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const result = useData<{ items: Product[]; total: number }>(
    `/products?q=${encodeURIComponent(q)}`,
  );
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParams(draft ? { q: draft } : {});
        }}
      >
        <input
          aria-label="Search products"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button>Search</button>
      </form>
      {!result && <p>Loading products…</p>}
      {result?.error && <p role="alert">{result.error}</p>}
      {result?.data && (
        <>
          <p>{result.data.total} products</p>
          <ul>
            {result.data.items.map((p) => (
              <li key={p.id}>
                <Link to={`/products/${p.id}`}>{p.name}</Link> — {(p.priceCents / 100).toFixed(2)}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ProductPage() {
  const { id } = useParams();
  const result = useData<Product>(`/products/${encodeURIComponent(id!)}`);
  if (!result) return <p>Loading product…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return (
    <article>
      <h2>{result.data!.name}</h2>
      <p>{(result.data!.priceCents / 100).toFixed(2)}</p>
    </article>
  );
}

export function App() {
  return (
    <main>
      <h1>Store lab</h1>
      <Link to="/">Catalog</Link>
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/products/:id" element={<ProductPage />} />
        <Route path="*" element={<p>Page not found</p>} />
      </Routes>
    </main>
  );
}
```

The result is keyed by request path so old results do not appear under a new URL. This is a small version of the project's [useResource](../../apps/web/src/hooks/useResource.ts).

## 4. Check navigation and a failed request

Start `npm run dev:api` in another lab-root terminal. In the browser, search for `mug`. Expect one result and `?q=mug` in the URL. Open it; expect `/products/mug`. Reload that product URL, then use Back to return to the filter. Open `/products/unknown` and expect the missing-product message.

Stop the API and reload: you should see a request error instead of silently showing the earlier mock. Restart it and reload to recover.

Run `npm run build -w @learn/web` from the lab root. Expect a successful type check and production asset build. Vite's proxy works in development; a production host needs its own API routing and frontend route fallback.

Next: [3. Add mock checkout](03-mock-checkout.md). For the full implemented page/state map, see [frontend reference](../reference/frontend.md). [Index](../README.md).
