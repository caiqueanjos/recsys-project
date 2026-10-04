# Validation coverage and implementation limits

Use this reference to choose checks when changing a feature. These are existing checks inspected for this documentation; historical host measurements are recorded in the [runbook](../local-development.md), not new benchmark results.

| Check | What it establishes | Source |
| --- | --- | --- |
| `npm test` | Identity/cart isolation, expiry, checkout replay/rollback, event attribution and append-only behavior; deterministic history, chronological references/carts/orders, cohorts, exports and delivery artifacts | [store tests](../../apps/store-api/test/store.test.ts), [generator tests](../../apps/store-api/test/generator.test.ts) |
| `npm run test:browser` | URL filters/pagination, Back/Forward, product direct links/refresh, missing routes/products; cart/persona isolation, checkout retry/history, expiry recovery, mobile overflow, observed events | [browser.ts](../../tools/validate/browser.ts) |
| `npm run build` | TypeScript compatibility and Vite production assets | [scripts](../../package.json) |
| `npm run format:check` | Formatting of configured TypeScript/TSX/CSS paths | [scripts](../../package.json) |
| Bronze unittest discovery | Real Spark/Delta crash recovery, replay, incremental/empty batches, snapshots, monotonic progress, gap/conflict/checksum/missing-table rejection | [test_ingest.py](../../tools/bronze/tests/test_ingest.py) |

API tests use Fastify injection and in-memory SQLite. Browser validation seeds a temporary database, starts an ephemeral API and Vite on port 5175, launches Chromium, and cleans up its processes/database. It does not operate on your default learning store. Bronze tests use a temporary root and a real Spark session.

Use the [runbook](../local-development.md#validation-and-selective-resets) for prerequisites and invocation, including browser installation and the Bronze working directory. Documentation-only edits do not require application builds. The formatting script does not include Markdown.

## What passing checks does not establish

The tests cover selected flows, not production authentication/security, all browser/device combinations, payment correctness, or distributed infrastructure. Synthetic consistency checks validate the simulator's internal rules; they do not demonstrate recommendation quality. The recorded million-event generation run is local feasibility evidence, not a throughput or latency guarantee.

There is no automatic export scheduler, persistent browser event outbox, production hosting setup, database migration system, historical inventory reconstruction, or recommendation pipeline. Keep those boundaries explicit when extending the project.

For a repeatable learner exercise, follow the [store walkthrough](walkthrough.md). For agreed future ownership, see [architecture](architecture.md).
