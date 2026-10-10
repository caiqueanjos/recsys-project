# 3. Add shoppers, carts, and mock checkout

You will give two demo shoppers separate carts and make repeated checkout requests return one order. Continue in `store-lab` after lessons 1–2. This lesson adds the API behavior first; the existing catalog UI continues to work. There are no payments, shipping, authentication, or persistent storage in this mock.

Before starting, complete [machine setup](../how-to/prepare-your-machine.md) and read the **before lesson 3** section of [learning foundations](../explanation/learning-foundations.md).

## 1. Model the state in memory

Create `apps/store-api/src/checkout.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { products } from './catalog.js';

type Item = { productId: string; name: string; quantity: number; unitPriceCents: number };
export type Order = {
  id: string;
  shopperId: string;
  sessionId: string;
  totalCents: number;
  items: Item[];
};

export class MockStore {
  readonly sessions = new Map<string, string>();
  readonly carts = new Map<string, Map<string, number>>();
  readonly orders = new Map<string, Order>();

  start(shopperId: string) {
    if (!['alex', 'sam'].includes(shopperId)) throw new Error('Unknown demo shopper');
    const id = randomUUID();
    this.sessions.set(id, shopperId);
    return { id, shopperId };
  }
  shopper(sessionId: string) {
    const shopperId = this.sessions.get(sessionId);
    if (!shopperId) throw new Error('Session required');
    return shopperId;
  }
  cart(sessionId: string): Item[] {
    const cart = this.carts.get(this.shopper(sessionId)) ?? new Map<string, number>();
    return [...cart].map(([productId, quantity]) => {
      const product = products.find((p) => p.id === productId)!;
      return { productId, name: product.name, quantity, unitPriceCents: product.priceCents };
    });
  }
  set(sessionId: string, productId: string, quantity: number) {
    const shopperId = this.shopper(sessionId);
    const product = products.find((p) => p.id === productId);
    if (!product || (quantity > 0 && !product.available)) throw new Error('Product unavailable');
    const cart = this.carts.get(shopperId) ?? new Map<string, number>();
    if (quantity === 0) cart.delete(productId);
    else cart.set(productId, quantity);
    this.carts.set(shopperId, cart);
    return this.cart(sessionId);
  }
  checkout(sessionId: string, key: string) {
    const shopperId = this.shopper(sessionId);
    const lookup = JSON.stringify([sessionId, key]);
    const prior = this.orders.get(lookup);
    if (prior) return prior;
    const items = this.cart(sessionId);
    if (!items.length) throw new Error('Cart is empty');
    if (items.some((item) => !products.find((p) => p.id === item.productId)?.available)) {
      throw new Error('Product unavailable');
    }
    const order: Order = {
      id: randomUUID(),
      shopperId,
      sessionId,
      items,
      totalCents: items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0),
    };
    this.orders.set(lookup, order);
    this.carts.delete(shopperId);
    return order;
  }
}
```

The cart is keyed by shopper; retry lookup is keyed by session plus checkout key. All checkout validation happens before changing maps. The operation is synchronous in one process; it is not a database transaction or a durable concurrency guarantee. Session expiry and events will be examined in the full project later.

## 2. Expose the actions

In `apps/store-api/src/server.ts`, add these imports:

```ts
import type { FastifyRequest } from 'fastify';
import { MockStore } from './checkout.js';
```

Inside `buildServer()`, immediately after `const app = Fastify();`, insert:

```ts
const store = new MockStore();
const sessionId = (req: FastifyRequest) => {
  const value = req.headers['x-session-id'];
  if (typeof value !== 'string') throw new Error('Session required');
  return value;
};
app.setErrorHandler((error, _req, reply) => {
  reply.code(400).send({ error: (error as Error).message });
});
app.post('/sessions', async (req) => {
  const { shopperId } = z.object({ shopperId: z.string() }).parse(req.body);
  return store.start(shopperId);
});
app.get('/cart', async (req) => store.cart(sessionId(req)));
app.put('/cart/:productId', async (req) => {
  const { productId } = req.params as { productId: string };
  const { quantity } = z.object({ quantity: z.number().int().min(0).max(99) }).parse(req.body);
  return store.set(sessionId(req), productId, quantity);
});
app.post('/checkout', async (req) => {
  const { idempotencyKey } = z
    .object({ idempotencyKey: z.string().min(1).max(128) })
    .parse(req.body);
  return store.checkout(sessionId(req), idempotencyKey);
});
```

Keep the catalog routes and return statement from lesson 1. This mock returns 400 for invalid identity/domain actions; the final project has the more specific statuses documented in [API reference](../reference/http-api.md).

## 3. Prove cart isolation and retry behavior

Create `apps/store-api/test/checkout.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';

test('shoppers retain carts across sessions and checkout can be retried', async (t) => {
  const app = buildServer();
  t.after(() => app.close());
  const start = async (shopperId: string) =>
    (await app.inject({ method: 'POST', url: '/sessions', payload: { shopperId } })).json();
  const alex = await start('alex');
  const sam = await start('sam');
  const headers = { 'x-session-id': alex.id };
  const changed = await app.inject({
    method: 'PUT',
    url: '/cart/mug',
    headers,
    payload: { quantity: 2 },
  });
  assert.equal(changed.statusCode, 200);
  const samCart = await app.inject({
    method: 'GET',
    url: '/cart',
    headers: { 'x-session-id': sam.id },
  });
  assert.deepEqual(samCart.json(), []);
  const alexAgain = await start('alex');
  const retained = await app.inject({
    method: 'GET',
    url: '/cart',
    headers: { 'x-session-id': alexAgain.id },
  });
  assert.equal(retained.json()[0].quantity, 2);
  const request = {
    method: 'POST' as const,
    url: '/checkout',
    headers,
    payload: { idempotencyKey: 'one-order' },
  };
  const first = await app.inject(request);
  const retry = await app.inject(request);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().totalCents, 5000);
  assert.deepEqual(retry.json(), first.json());
  const empty = await app.inject({ method: 'GET', url: '/cart', headers });
  assert.deepEqual(empty.json(), []);
  const newScope = await app.inject({ ...request, headers: { 'x-session-id': alexAgain.id } });
  assert.equal(newScope.statusCode, 400);
});
```

Run `npm run check` and `npm test`. Expect both catalog and checkout tests to pass. The final assertion demonstrates that another session does not retrieve the original checkout using the same key.

## 4. Connect a small checkout screen

Create `apps/web/src/Checkout.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

type Item = { productId: string; name: string; quantity: number; unitPriceCents: number };
type Order = { id: string; totalCents: number; items: Item[] };

async function call<T>(path: string, method = 'GET', body?: unknown, session?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { 'x-session-id': session } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

export function Checkout() {
  const [shopper, setShopper] = useState('alex');
  const [session, setSession] = useState<string>();
  const [cart, setCart] = useState<Item[]>([]);
  const [order, setOrder] = useState<Order>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const key = useRef<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setSession(undefined);
    setCart([]);
    setOrder(undefined);
    setError('');
    key.current = undefined;
    void (async () => {
      try {
        const next = await call<{ id: string }>('/sessions', 'POST', { shopperId: shopper });
        const items = await call<Item[]>('/cart', 'GET', undefined, next.id);
        if (!cancelled) {
          setSession(next.id);
          setCart(items);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopper]);
  async function act(purchase: boolean) {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      if (purchase) {
        key.current ??= crypto.randomUUID();
        const placed = await call<Order>(
          '/checkout',
          'POST',
          { idempotencyKey: key.current },
          session,
        );
        setOrder(placed);
        setCart([]);
        key.current = undefined;
      } else {
        const quantity = (cart.find((item) => item.productId === 'mug')?.quantity ?? 0) + 1;
        const items = await call<Item[]>('/cart/mug', 'PUT', { quantity }, session);
        setCart(items);
        setOrder(undefined);
        key.current = undefined;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Demo checkout</h2>
      <select
        aria-label="Shopper"
        disabled={busy}
        value={shopper}
        onChange={(e) => setShopper(e.target.value)}
      >
        <option value="alex">Alex</option>
        <option value="sam">Sam</option>
      </select>
      {error && <p role="alert">{error}</p>}
      <ul>
        {cart.map((item) => (
          <li key={item.productId}>
            {item.name}: {item.quantity}
          </li>
        ))}
      </ul>
      <button
        disabled={busy || !session || (cart[0]?.quantity ?? 0) >= 99}
        onClick={() => void act(false)}
      >
        Add a mug
      </button>
      <button disabled={busy || !cart.length} onClick={() => void act(true)}>
        Place demo order
      </button>
      {order && (
        <p role="status">
          Order {order.id}: {(order.totalCents / 100).toFixed(2)}
        </p>
      )}
    </section>
  );
}
```

In `apps/web/src/App.tsx`, import `Checkout` from `./Checkout`, add `<Link to="/cart">Bag</Link>` beside the catalog link, and add `<Route path="/cart" element={<Checkout />} />` inside `Routes`.

With API/Vite running, open **Bag**, add two mugs as Alex, and switch to Sam. Expect an empty bag. Switch back to Alex and place the order. Expect **50.00**, with Alex's bag cleared. The display confirmation lives only in this page; the next lesson introduces durable orders. Reload creates a new session; it does not clear the shopper's in-memory cart while the API stays running.

Run `npm run build -w @learn/web` to check the screen's types. The completed project adds guest persistence, expiry recovery, quantity controls, and purchase history through [StoreProvider](../../apps/web/src/state/StoreProvider.tsx).

## 5. Exercise the HTTP flow

Start `npm run dev:api` if it is not running. From another lab-root terminal, use Node as a small HTTP client:

```sh
node --input-type=module <<'JS'
const base = 'http://127.0.0.1:3001';
async function call(path, method = 'GET', body, session) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { 'x-session-id': session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
const session = await call('/sessions', 'POST', { shopperId: 'alex' });
await call('/cart/mug', 'PUT', { quantity: 2 }, session.id);
const order = await call('/checkout', 'POST', { idempotencyKey: 'demo-order' }, session.id);
const retry = await call('/checkout', 'POST', { idempotencyKey: 'demo-order' }, session.id);
console.log({ totalCents: order.totalCents, sameOrder: order.id === retry.id });
JS
```

Expect `totalCents: 5000` and `sameOrder: true`. Restart the API and repeat with a new session: all old state is gone. That is the next problem we will solve.

The screen retains its checkout key after a request error and clears it after a successful mutation, purchase, or shopper switch. Compare that behavior with [StoreProvider](../../apps/web/src/state/StoreProvider.tsx) in the completed project.

Next: [4. Make checkout durable](04-postgres-transactions.md). Read [identity and sessions](../explanation/identity-and-navigation.md) for the design behind the keys. [Index](../README.md).
