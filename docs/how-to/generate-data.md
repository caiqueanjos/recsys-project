# Generate history and delivery experiments

Use this guide to create a reproducible dataset for development. Prerequisites: npm dependencies and a running PostgreSQL database. Use an [isolated database](manage-experiments.md) if the population should not share your normal store.

## Generate a small population

From the repository root:

```sh
npm run seed -- --seed 17 --products 140 --shoppers 80 --events 1000 --days 10 --start 2026-07-01T00:00:00.000Z
```

Confirm the summary contains `run`, `eventCount`, `sessionCount`, and `orderCount`. Event count can exceed the target because the last session finishes. Inspect the corresponding diagnostics file under `data/generator-diagnostics` separately from model inputs.

Run the same command again. Expect `alreadyGenerated: true`, with no additional population. Changing seed, scale, start, or duration creates a new population; it does not replace previous records. The first seed establishes occupied homepage trending positions.

## Choose a larger dataset

For a moderate experiment:

```sh
npm run seed -- --seed 7 --products 350 --shoppers 200 --events 20000 --days 30 --start 2026-07-01T00:00:00.000Z
```

Use a history window ending in the past. At least 35 products, 20 shoppers, and 10 days are required. Generation serializes participating store writes for the whole run. Increase scale deliberately; the PostgreSQL default million-event configuration has no measured runtime guarantee.

## Create a separate delivery artifact

Choose a new output path:

```sh
npm run seed -- --seed 17 --products 140 --shoppers 80 --events 1000 --days 10 --start 2026-07-01T00:00:00.000Z --delivery data/delivery/seed17.ndjson --missing-rate 0.1 --duplicate-rate 0.2 --max-delay-seconds 60
```

If history already exists, it is reused. Expect a second summary with original, missing, duplicate, and delivered counts. Read the first line to see `deliveryId`, `deliveredAt`, and unchanged nested `event`. Repeating with the same configuration and another output path reproduces the artifact. Existing files are not overwritten.

This tests transport behavior in a separate file. Do not feed it to the ordinary Bronze ingestion CLI: that CLI accepts manifest-backed authoritative exports. A delivery-aware ingestion experiment would require separate user-designed work.

Verify consistency with `npm test`; [generator reference](../reference/generator.md) lists exact options/cohorts. Read [synthetic-data explanation](../explanation/synthetic-data.md) before designing evaluation. [Index](../README.md).
