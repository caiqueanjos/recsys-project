# How mocks help you build in stages

Understand why the tutorials begin with fixed data and an in-memory checkout. A mock is a deliberately small substitute for a dependency or behavior. Here, a two-product array substitutes for a catalog query; a Map substitutes for persistence; a demo order substitutes for payment processing.

## Keep the interface stable while adding one responsibility

A React page can render `{ id, name, priceCents, available }` before PostgreSQL exists. Fetching that same shape from a small Fastify route introduces HTTP without also introducing schema setup. Adding shopper/session IDs next teaches whose cart a mutation affects. A later PostgreSQL adapter preserves the HTTP shapes while adding persistence and rollback.

Each step keeps the prior result visible. When a new dependency fails, you know which boundary you just added. Starting with every service at once makes a blank page harder to diagnose: it could be data, networking, identity, or rendering.

| Stage              | Mock/substitute                 | What it lets you learn                   | What it cannot establish                         |
| ------------------ | ------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| Fixed catalog      | Two products                    | Types, rendering, URLs                   | Catalog distribution or inventory history        |
| Mock HTTP API      | Array-backed routes             | Request/response boundaries              | SQL correctness                                  |
| In-memory checkout | Maps and synchronous operations | Identity isolation, retry keys           | Durable rollback or multiple-process concurrency |
| PostgreSQL adapter | Small relational schema         | Atomic commits, rollback, durable replay | Full store contract or production throughput     |
| Existing store     | Synthetic history and personas  | Complete integration and raw provenance  | Real customer behavior or payment safety         |

## Use a mock at the dependency boundary

Return a normal product shape from the mock rather than adding `isMock` branches through the UI. Then replace the implementation behind that boundary. Keep tests focused on visible outcomes: a copied product URL loads, shoppers cannot see each other's carts, and repeating checkout returns the same order.

Some differences require explicit redesign. A synchronous Map operation can finish without interleaving; async database calls can interleave unless a transaction/lock protects them. Lesson 4 replaces the Map-backed HTTP dependency with a PostgreSQL adapter and verifies the existing UI against it. The final store also uses a relational event counter because analytical ingestion requires contiguous committed append ranges.

## Make shortcuts visible

The tutorial mocks do not expire sessions, guarantee delivery, or authenticate anyone. The completed project adds expiry and durable transactions, but still uses demo identity, fake checkout, and synthetic data. Name these limits where they matter instead of hiding them behind production-sounding claims.

The tutorials teach the store/ingestion scaffold. They do not provide a mock recommender that could be confused with actual personalization or evaluation evidence.

Related: [start building](../tutorials/01-workspace-and-api.md), [transaction design](transactions.md), [index](../README.md).
