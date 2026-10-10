# 5. Build browser observation collection

You will add visible-product impressions and attributed clicks to **your lab**, validate them in its API, and store them alongside committed backend cart/purchase events. Continue after lesson 4. Keep PostgreSQL running. A browser observation means something was seen/activated; it is not a committed purchase.

## 1. Share a small runtime contract

From the lab root, run `npm install -w @learn/contracts zod@4`. Create `packages/contracts/src/events.ts`:

```ts
import { z } from 'zod';

export const observationSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.enum(['impression', 'click']),
    occurredAt: z.iso.datetime().transform((value) => new Date(value).toISOString()),
    context: z
      .object({
        productId: z.string().min(1),
        surface: z.literal('catalog'),
        position: z.number().int().min(1),
        impressionId: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.type === 'click' && !event.context.impressionId) {
      ctx.addIssue({ code: 'custom', message: 'Click requires an impression ID' });
    }
  });
export type Observation = z.infer<typeof observationSchema>;
```

Append these exports to `packages/contracts/src/index.ts`:

```ts
export { observationSchema } from './events.js';
export type { Observation } from './events.js';
```

This teaching contract accepts only catalog impressions/clicks. `position` starts at one. A click references an impression's ID. The API assigns shopper, session, producer source, ingestion time, and version; the browser cannot invent those fields or submit purchases.

## 2. Validate references inside the transaction

In `pg-store.ts`, add `import { observationSchema, type Observation } from '@learn/contracts';`. Add the following method **inside** `PgStore`, before `close()`:

```ts
async record(sessionId: string, inputs: Observation[]) {
    const observations = inputs.map((input) => observationSchema.parse(input));
    return this.transaction(async (client) => {
      await this.sessionOn(client, sessionId);
      for (const event of observations) {
        if (Date.parse(event.occurredAt) > Date.now() + 60_000) throw new Error('Future event');
        if (!(await client.query('SELECT id FROM products WHERE id=$1', [event.context.productId])).rows.length) {
          throw new Error('Unknown product');
        }
        if (event.type === 'click') {
          const row = (await client.query('SELECT payload FROM events WHERE id=$1', [event.context.impressionId])).rows[0];
          const impression = row ? JSON.parse(row.payload) : undefined;
          if (!impression || impression.type !== 'impression' || impression.sessionId !== sessionId ||
              impression.context.productId !== event.context.productId ||
              impression.context.surface !== event.context.surface ||
              impression.context.position !== event.context.position || impression.occurredAt > event.occurredAt) {
            throw new Error('Click has no matching prior impression');
          }
        }
        await this.appendOn(client, sessionId, event.type, event.context, event.id, event.occurredAt, 'browser');
      }
      return { accepted: observations.length };
    });
  }
```

In `server.ts`, add `import { observationSchema } from '@learn/contracts';` and add this route inside `buildServer`, before the close hook:

```ts
app.post('/events', async (req) => {
  const { events } = z
    .object({ events: z.array(observationSchema).max(100) })
    .strict()
    .parse(req.body);
  return store.record(sessionId(req), events);
});
```

The array order matters: impression first, then click. A later invalid event rolls back earlier inserts in the same batch, including the counter. `appendOn` accepts the same logical event on retry while tolerating a new receipt time. It rejects changed content under the same ID. Preserve payload/context structure when retrying.

## 3. Build an ordered in-memory queue

Create `apps/web/src/Telemetry.ts`:

```ts
import type { Observation } from '@learn/contracts';

export class Telemetry {
  private pending: Observation[] = [];
  private sending = false;
  private stopped = false;
  private retired = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly sessionId: string,
    readonly report: (message: string) => void,
  ) {}
  record(type: Observation['type'], context: Observation['context']) {
    if (this.retired) throw new Error('Retired telemetry session');
    const id = crypto.randomUUID();
    this.pending.push({ id, type, context, occurredAt: new Date().toISOString() });
    void this.flush();
    return id;
  }
  async flush() {
    if (this.sending || this.stopped || !this.pending.length) return;
    this.sending = true;
    const batch = this.pending.slice(0, 100);
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': this.sessionId },
        body: JSON.stringify({ events: batch }),
      });
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) this.stopped = true;
        throw new Error(`Event intake returned ${response.status}`);
      }
      this.pending.splice(0, batch.length);
    } catch (e) {
      this.report((e as Error).message);
      if (!this.stopped)
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.flush();
        }, 1000);
    } finally {
      this.sending = false;
      if (this.pending.length && !this.timer && !this.stopped) void this.flush();
    }
  }
  close() {
    this.retired = true;
    void this.flush();
  }
}
```

`record` returns the ID immediately so a click can reference its impression. Only one batch sends at a time; pending events remain until success. Network/server failures retry; other 4xx failures stop the queue. `close` retires a recorder while attempting to drain its original session's events. Page reload/closure can still lose data: this is an in-memory teaching queue, not a durable outbox.

## 4. Observe a card rather than counting a render

Create `apps/web/src/ObservedCatalog.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Product } from '@learn/contracts';
import { get } from './api';
import { Telemetry } from './Telemetry';

function ObservedCard({
  product,
  position,
  telemetry,
}: {
  product: Product;
  position: number;
  telemetry: Telemetry;
}) {
  const element = useRef<HTMLAnchorElement>(null);
  const exposure = useRef<string | undefined>(undefined);
  const context = { productId: product.id, surface: 'catalog' as const, position };
  useEffect(() => {
    exposure.current = undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5) &&
          !exposure.current
        ) {
          exposure.current = telemetry.record('impression', {
            productId: product.id,
            surface: 'catalog',
            position,
          });
        }
      },
      { threshold: 0.5 },
    );
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [product.id, position, telemetry]);
  return (
    <Link
      ref={element}
      to={`/products/${product.id}`}
      onClick={() => {
        exposure.current ??= telemetry.record('impression', context);
        telemetry.record('click', { ...context, impressionId: exposure.current });
      }}
      style={{ display: 'block', padding: '2rem', margin: '1rem', border: '1px solid' }}
    >
      {product.name} — {(product.priceCents / 100).toFixed(2)}
    </Link>
  );
}

export function ObservedCatalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [telemetry, setTelemetry] = useState<Telemetry>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let recorder: Telemetry | undefined;
    void (async () => {
      try {
        const response = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopperId: 'alex' }),
        });
        const session = await response.json();
        if (!response.ok) throw new Error(session.error);
        const catalog = await get<{ items: Product[] }>('/products');
        if (cancelled) return;
        recorder = new Telemetry(session.id, (message) => {
          if (!cancelled) setError(message);
        });
        setProducts(catalog.items);
        setTelemetry(recorder);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      recorder?.close();
    };
  }, []);
  return (
    <section>
      <h2>Observed catalog · Alex</h2>
      {error && <p role="alert">{error}</p>}
      {!telemetry && !error && <p>Opening session…</p>}
      {telemetry &&
        products.map((product, index) => (
          <ObservedCard
            key={product.id}
            product={product}
            position={index + 1}
            telemetry={telemetry}
          />
        ))}
    </section>
  );
}
```

`IntersectionObserver` tells you when half a card intersects the viewport. Merely rendering it does not mean it was visible. Activation can establish exposure before the observer callback, including keyboard activation. This screen uses Alex and its own session to keep the exercise small; the reference store manages recorder lifetime in its shared identity provider.

In `App.tsx`, import `ObservedCatalog` from `./ObservedCatalog`, add `<Link to="/observed">Observed catalog</Link>` beside Bag, and add `<Route path="/observed" element={<ObservedCatalog />} />` inside `Routes`.

## 5. Check replay and rollback

Create `apps/store-api/test/events.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgStore } from '../src/pg-store.js';
import { buildServer } from '../src/server.js';

test('observation replay and batch rollback preserve attribution and sequence', async () => {
  const namespace = `test_${randomUUID().replaceAll('-', '')}`;
  const store = await PgStore.open(undefined, namespace);
  const app = await buildServer(store);
  try {
    const session = (
      await app.inject({ method: 'POST', url: '/sessions', payload: { shopperId: 'alex' } })
    ).json();
    const headers = { 'x-session-id': session.id };
    const context = { productId: 'mug', surface: 'catalog', position: 1 };
    const impression = {
      id: 'seen',
      type: 'impression',
      occurredAt: new Date().toISOString(),
      context,
    };
    const click = {
      id: 'clicked',
      type: 'click',
      occurredAt: impression.occurredAt,
      context: { ...context, impressionId: impression.id },
    };
    const send = (events: unknown[]) =>
      app.inject({ method: 'POST', url: '/events', headers, payload: { events } });
    assert.equal(
      (
        await send([
          impression,
          { ...click, context: { ...click.context, impressionId: 'absent' } },
        ])
      ).statusCode,
      400,
    );
    assert.equal((await store.pool.query('SELECT count(*) FROM events')).rows[0].count, '0');
    assert.equal((await send([impression, click])).statusCode, 200);
    assert.equal((await send([impression, click])).statusCode, 200);
    assert.deepEqual(
      (await store.pool.query('SELECT seq FROM events ORDER BY seq')).rows.map((row) => row.seq),
      [1, 2],
    );
    assert.equal(
      (await send([{ ...impression, context: { ...context, position: 2 } }])).statusCode,
      400,
    );
    assert.equal(
      (await send([{ ...click, id: 'fake-purchase', type: 'purchase' }])).statusCode,
      400,
    );
  } finally {
    await app.close();
    await store.pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await store.close();
  }
});
```

Run `npm run check`, `npm test`, and `npm run build -w @learn/web`. Expect the mock tests, persistence test, and new event test to pass. The new test proves a failed batch leaves no records/gaps, exact retry adds no duplicate, changed content under the same ID conflicts, and browser purchases are rejected.

## 6. Follow the event from the browser

Run API/Vite as before. Open **Observed catalog**, wait for the cards, and click the mug. In another lab-root terminal:

```sh
docker compose exec -T postgres psql -U lab -d lab <<'SQL'
SELECT seq, payload::jsonb->>'type' AS type,
       payload::jsonb->>'source' AS source,
       payload::jsonb->'context' AS context
FROM tutorial.events ORDER BY seq DESC LIMIT 10;
SQL
```

Expect browser impressions and a click with `impressionId`. Follow that ID to its impression; product, session, surface, and position must match. Then use Bag to place a demo order: its event source is `store_backend`, and no browser purchase is emitted.

You have implemented both producers and the boundary between them. No model attribution is present because no recommender selected these products. The full [event contract](../reference/events.md) adds more types/surfaces and listing/order checks.

Next: [6. Build an immutable exporter](06-build-exports.md). Why exposures matter: [observations](../explanation/observations.md). [Index](../README.md).
