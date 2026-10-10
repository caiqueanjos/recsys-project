# Run validation checks

Use this guide to verify a change at its actual boundary. Prerequisites: Node 24/npm dependencies and a running PostgreSQL instance. Tests create private schemas; the test database role needs CREATE/DROP SCHEMA permission.

## Select checks

| Change                                       | Checks                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| API, event contract, SQL, generator/export   | `npm test`; `npm run build`; `npm run format:check`                          |
| Storefront flow, routing, persona/cart state | Above plus `npm run test:browser`                                            |
| Bronze ingestion                             | Python integration suite below                                               |
| Documentation only                           | Local file/anchor links, consistency with source, runnable changed exercises |

From the repository root:

```sh
npm run db:up
npm test
npm run build
npm run format:check
```

API tests use Fastify injection. History tests check deterministic rows, chronology, cohorts, cart/order/event reconciliation, exports, and separate transport artifacts. Transaction tests include concurrent checkout retries, batch rollback with contiguous sequences, and append-only rejection. These are selected regressions, not exhaustive security/concurrency assurance.

## Browser validation

Install browser/runtime dependencies once:

```sh
npx playwright install --with-deps chromium
npm run test:browser
```

On Linux, system dependency installation may require administrator access. The suite creates a private PostgreSQL schema, starts an ephemeral API and Vite on port 5175, and checks desktop/mobile navigation, direct URLs, refresh, checkout, persona isolation, recovery, and observations. The runner cleans up after execution. A launch error such as missing `libnspr4.so` means the browser prerequisite is absent; it is not a completed application regression run.

## Bronze integration validation

From `tools/bronze`:

```sh
cd tools/bronze
uv run python -m unittest discover -s tests -v
```

The suite uses a real local Spark/Delta session and temporary directories. It checks injected failure/recovery, exact replay, incremental/empty batches, snapshot retention, monotonic progress, gaps, conflicts, missing-table progress, and corrupt bytes. JVM sockets and first-run Maven downloads are required.

None of these checks establishes real-world recommendation effectiveness, managed-service latency, default-scale PostgreSQL throughput, or production payment/authentication behavior. For failed prerequisites use [troubleshooting](troubleshoot.md). [Index](../README.md).
