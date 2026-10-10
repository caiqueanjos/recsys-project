# 5. Follow a browser action into an event

You will run the implemented store in a separate database, observe one exposure/click, and find a committed purchase. This lesson uses **this repository**, not `store-lab`. You need Node 24/npm and Docker Compose; no Spark yet. Stop the lab API and any existing API using port 3001.

## 1. Prepare an isolated store

From the repository root:

```sh
npm ci
npm run db:up
docker compose exec -T postgres createdb -U store docs_demo
export STORE_DATABASE_URL=postgresql://store:store@127.0.0.1:5432/docs_demo
npm run seed -- --seed 17 --products 140 --shoppers 80 --events 1000 --days 10 --start 2026-07-01T00:00:00.000Z
npm run dev:api
```

Use a new database name if `docs_demo` already exists, and substitute it throughout this lesson and lesson 7. The summary should contain a run ID and generated counts. This data is synthetic, but its records use the live contract.

In another repository-root terminal, run `npm run dev:web`. Open http://127.0.0.1:5173. Select **Alex · home projects** to make the SQL identity in this exercise stable.

## 2. Produce an exposure and click

Go to the catalog. Search for `mug`, let the first card appear, and open it. Wait for the product page. Reload the product URL; it should load again under a new session.

In another repository-root terminal, inspect recent live events:

```sh
docker compose exec -T postgres psql -U store -d docs_demo <<'SQL'
SELECT seq, type, source, "sessionId", payload::jsonb->'context' AS context
FROM events WHERE "shopperId"='persona-home'
ORDER BY seq DESC LIMIT 12;
SQL
```

Expect session activity, a search, impressions, a click, and product views. Browser observations arrive asynchronously; rerun the query if a recent action has not flushed yet. The click's `impressionId` should reference an earlier impression with matching product/surface/position in the same session.

Trace that relationship directly:

```sh
docker compose exec -T postgres psql -U store -d docs_demo <<'SQL'
SELECT c.id AS click_id, i.id AS impression_id,
       c.payload::jsonb->'context'->>'productId' AS product_id
FROM events c
JOIN events i ON i.id=c.payload::jsonb->'context'->>'impressionId'
WHERE c.type='click' AND c."shopperId"='persona-home'
ORDER BY c.seq DESC LIMIT 5;
SQL
```

This is the production-like contract missing from the early teaching mocks. [ProductCard](../../apps/web/src/components/ProductCard.tsx) establishes exposure; [Store.append](../../apps/store-api/src/db.ts) validates attribution.

## 3. Commit a demo purchase

Add the mug to the bag, open the bag, and place the demo order. Expect order confirmation, an empty bag, and an entry in purchase history.

```sh
docker compose exec -T postgres psql -U store -d docs_demo <<'SQL'
SELECT o.id, o."totalCents", e.source, e."occurredAt"=o."createdAt" AS matching_time
FROM orders o
JOIN events e ON e.payload::jsonb->'context'->>'orderId'=o.id
WHERE o."shopperId"='persona-home' AND e.type='purchase'
ORDER BY o."createdAt" DESC LIMIT 1;
SQL
```

Expect one matching order/purchase pair with `source=store_backend` and `matching_time=true`. It is not another browser observation. Review [checkout route](../../apps/store-api/src/server.ts) and compare its transaction with lesson 4.

## 4. Check identity continuity

Switch to Sam and open the bag/history. Alex's order should not appear. Switch back to Alex; the order remains. Each switch/reload creates a session without replacing the shopper. In SQL, multiple live sessions should now exist for `persona-home`.

You have observed the whole path from visible product to attributed click and authoritative purchase. Keep `docs_demo` for the next lesson. Stop API/Vite when finished; retain PostgreSQL.

Next: [6. Generate a tiny reproducible history](06-synthetic-history.md), then [7. Export and recover raw ingestion](07-bronze-replay.md). Look up [event rules](../reference/events.md) or read [what observations mean](../explanation/observations.md). [Index](../README.md).
