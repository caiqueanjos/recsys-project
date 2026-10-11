# Understand the store backend using Python concepts

Use this guide to read the implemented Node/TypeScript store API through concepts you already know from Python backend development. The closest comparison is an async FastAPI application with explicit validation, raw PostgreSQL queries, cart/checkout application services, and a custom persistence class.

The Python examples below are illustrative fragments, not runnable applications or a migration plan. They assume surrounding application setup and dependencies. The implemented store remains in `apps/store-api`; `apps/api` and `packages/recommender` are the separate, user-owned Python recommendation workspace.

## Translate the stack

| In this repository | Python equivalent by responsibility | Important distinction |
| --- | --- | --- |
| Node.js | Python runtime | Both execute backend code; their async execution models are not identical |
| TypeScript | Python annotations plus mypy/pyright | Types do not validate incoming data at runtime |
| Fastify | FastAPI or Flask | HTTP routes, request/response handling, and application lifecycle |
| Zod | Pydantic | Runtime parsing, validation, and custom rules |
| `pg` / node-postgres | Psycopg or asyncpg | Database driver, not an ORM |
| `CartService` and `CheckoutService` | Application services | Coordinate use cases and own their transaction boundaries |
| Custom `Store` class | Persistence class | Combines queries, transactions, and event integrity rules |
| `AsyncLocalStorage` | `contextvars.ContextVar` | Carries the active transaction connection through asynchronous calls |
| npm and `package.json` | Roughly uv/pip and `pyproject.toml` | Dependency management and project commands; not an exact correspondence |
| npm workspaces | Several local packages managed together | Web, API, and contracts share one npm installation and lockfile |
| `tsx` | TypeScript execution tool | Runs TypeScript source; it does not replace static type checking |
| `tsc --noEmit` | mypy/pyright check | Checks types without emitting JavaScript files |
| Node test runner and assertions | pytest/unittest | Runs behavioral tests and checks results |
| Prettier | Black or Ruff's formatting role | Formatting rather than application validation |
| Playwright | Playwright's Python API | Browser automation across the frontend/API boundary |

The exact commands and package boundaries are in the [workspace reference](../reference/workspace.md).

## Routes are asynchronous request handlers

[server.ts](../../apps/store-api/src/server.ts) registers this cart route:

```ts
app.get('/cart', async (req) => await store.cart((await session(req)).shopperId));
```

Read it as this Python fragment:

```python
@app.get("/cart")
async def get_cart(request: Request):
    session = await require_session(request)
    return await store.cart(session.shopper_id)
```

The helper reads `x-session-id`, finds a live session, rejects missing or expired sessions, and updates its activity timestamp. The route then loads the shopper's cart and returns JSON. This is demo session identity, not authentication.

FastAPI could express the helper as a dependency:

```python
@app.get("/cart")
async def get_cart(
    session: Annotated[Session, Depends(require_session)],
):
    return await store.cart(session.shopper_id)
```

Our implementation calls the helper directly. `Depends` would let FastAPI resolve it before invoking the handler. Snake-case attributes in these Python fragments assume a Python model; preserving the existing API would still require camel-case JSON fields, for example through aliases. See [FastAPI dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/) and the [store HTTP reference](../reference/http-api.md).

JavaScript `async` functions return promises; Python `async def` functions produce coroutines when called. `await` serves a similar purpose in both: wait for asynchronous work while allowing other work to proceed. However, calling a JavaScript async function starts execution immediately up to its first suspension; merely calling a Python coroutine function does not run its body. `Promise.all(...)` is roughly comparable to `asyncio.gather(...)`, with differences in scheduling and failure behavior.

## Static types and runtime validation are separate

[store-contracts](../../packages/store-contracts/src/index.ts) exports TypeScript shapes such as `Product` and `Session`. A simplified shape:

```ts
type Product = { id: string; priceCents: number };
```

is closer to a Python `TypedDict` than a Pydantic model:

```python
class Product(TypedDict):
    id: str
    priceCents: int
```

Neither definition validates an HTTP body. TypeScript's `number` also covers both integer and fractional values; integer constraints require validation. An assertion such as `row as Session` tells the type checker what to assume. It does not parse or verify the row, much like `typing.cast` in Python.

Zod handles runtime validation. The cart handler uses:

```ts
const { quantity } = z
  .object({ quantity: z.number().int().min(0).max(99) })
  .parse(req.body);
```

A Pydantic counterpart is:

```python
class CartUpdate(BaseModel):
    quantity: Annotated[int, Field(strict=True, ge=0, le=99)]

body = CartUpdate.model_validate(raw_body)
```

These have the same responsibility, but coercion and edge cases require deliberate alignment. The event schema also applies cross-field rules: a click requires an impression ID, and browser producers cannot record purchase transactions. Those map to Pydantic model validators. See [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/) and the [event reference](../reference/events.md).

FastAPI can validate and filter output using a response model. The current API does not implement that same response-model layer. Shared TypeScript types help during development, and the frontend's `request<T>()` declares an expected response type, but neither checks the received JSON at runtime. See [FastAPI response models](https://fastapi.tiangolo.com/tutorial/response-model/).

## Persistence uses raw SQL, not an ORM

[db.ts](../../apps/store-api/src/db.ts) uses a PostgreSQL connection pool. The query facade lets store methods write:

```ts
const row = await store.db
  .prepare('SELECT * FROM products WHERE id=$1')
  .get(id);
```

A Psycopg fragment with a dictionary row factory would look like:

```python
cursor = await conn.execute(
    "SELECT * FROM products WHERE id = %s",
    (product_id,),
)
row = await cursor.fetchone()
```

Both pass values separately from SQL. Placeholder syntax belongs to the driver: node-postgres uses `$1`, while Psycopg uses `%s` for positional parameters. Do not interpolate user values into either query.

Our `.prepare().get()`, `.all()`, and `.run()` methods are custom wrappers around driver queries. They mean fetch one row, fetch all rows, and execute without returning rows. The name `prepare` does not mean this wrapper creates a named server-side prepared statement.

[schema.ts](../../apps/store-api/src/schema.ts) contains SQL initialization statements, including keys, checks, indexes, and the append-only event trigger. Think of it as a bootstrap SQL script. There is no ORM model layer or Alembic-style migration history; `CREATE TABLE IF NOT EXISTS` does not update existing table definitions. The [database reference and diagram](../reference/database.md) document the exact schema.

## Transactions use a callback instead of a context manager

[CartService](../../apps/store-api/src/services/cart.ts) and [CheckoutService](../../apps/store-api/src/services/checkout.ts) provide a service layer for cart mutations and checkout. Their HTTP handlers resolve sessions and validate request bodies, then invoke the service. For example, the checkout handler delegates to `checkoutService.execute(s, idempotencyKey)`. That service owns the complete transaction: retry lookup, cart checks, total and snapshot calculation, order persistence, purchase recording, and cart clearing.

In Python terms, this is an application service depending on a concrete persistence class. The services raise `StoreOperationError` with a business code; `server.ts` maps that code to the existing HTTP status and error JSON. There are no repository interfaces or rich domain entities yet. Other routes retain their existing direct persistence calls.

The store wraps multi-step changes in:

```ts
await store.transaction(async () => {
  // Create order and order items.
  // Append purchase event.
  // Clear cart.
});
```

The closest Python structure is:

```python
async with pool.connection() as conn:
    async with conn.transaction():
        # Create order and order items.
        # Append purchase event.
        # Clear cart.
```

Psycopg provides [asynchronous pools](https://www.psycopg.org/psycopg3/docs/advanced/pool.html) and [transaction contexts](https://www.psycopg.org/psycopg3/docs/api/connections.html). In either design, these operations must use the same connection so an exception can roll them all back together.

Our wrapper additionally acquires a schema-scoped PostgreSQL advisory lock. It puts the checked-out connection in `AsyncLocalStorage`, so nested queries use that connection automatically. In Python, a `ContextVar` could carry it, or methods could accept the connection explicitly. [Python context variables](https://docs.python.org/3/library/contextvars.html) work with `asyncio`.

Nested calls to our `transaction()` join the existing transaction; they do not create savepoints. A Python implementation would need to preserve that behavior deliberately rather than assume nested context managers behave identically. The broad advisory lock favors understandable local correctness over write concurrency. See [transactions and retries](transactions.md).

Checkout idempotency is application and database behavior, not a Fastify feature: the handler checks for an existing order, and SQL enforces uniqueness on `(sessionId, idempotencyKey)`. Event sequences likewise come from a transactional counter, so rollbacks do not consume cursor positions.

## Application creation, lifecycle, and tests

`buildServer(providedStore?)` in `server.ts` is an application factory, comparable to Python's `create_app(store=None)`. Supplying a store lets tests inject isolated persistence. The factory registers routes and cleanup; [main.ts](../../apps/store-api/src/main.ts) starts the listener and handles termination signals.

With FastAPI, an ASGI server such as Uvicorn would serve HTTP, and the application's lifespan context would manage shared startup/shutdown resources such as a database pool. Fastify can listen directly. See [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/).

The current error handler returns `{ "error": "..." }`, with Zod failures mapped to HTTP 400. A FastAPI translation would need custom handlers to preserve that contract; simply raising `HTTPException` or accepting FastAPI's default validation response would change the response format or status.

[API tests](../../apps/store-api/test/store.test.ts) use Fastify's `app.inject()` to exercise requests without opening a TCP listener. That fills a role similar to an in-process FastAPI test client. The [database fixture](../../tools/validate/database.ts) creates and drops a temporary PostgreSQL schema, so these are real database integration tests rather than mocks. Playwright checks then cover the actual browser flow separately.

## Read the implementation in this order

1. [server.ts](../../apps/store-api/src/server.ts): translate routes into FastAPI handlers; follow session resolution, validation, and errors.
2. [cart.ts](../../apps/store-api/src/services/cart.ts) and [checkout.ts](../../apps/store-api/src/services/checkout.ts): follow application use cases independently of HTTP.
3. [db.ts](../../apps/store-api/src/db.ts): translate `Store` into a Python persistence class; trace which queries share a transaction.
4. [schema.ts](../../apps/store-api/src/schema.ts): inspect ordinary PostgreSQL tables and constraints, using the [diagram](../reference/database.md).
5. [store-contracts](../../packages/store-contracts/src/index.ts): distinguish static data shapes from runtime event validators.
6. [store.test.ts](../../apps/store-api/test/store.test.ts) and [services.test.ts](../../apps/store-api/test/services.test.ts): inspect HTTP and direct-service guarantees, especially isolation, replay, rollback, and checkout retries.

The HTTP and database boundaries remain familiar across languages. Understanding where validation, transaction ownership, and event integrity live will let you reason about this backend with your existing Python experience.

Related: [architecture](architecture.md), [learning foundations](learning-foundations.md), [documentation index](../README.md).
