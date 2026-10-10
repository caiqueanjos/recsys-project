# The small concepts used in the lessons

Read the relevant section before its lesson, then return to the exercise. You need basic JavaScript functions, arrays, objects, and promises. The examples add types, rendering, and database concepts to that foundation.

## Before lesson 1: types describe values

`type Product = { id: string; priceCents: number }` describes an object. `const p: Product = ...` asks TypeScript to check that object. The annotation does not validate JSON arriving over HTTP; Zod performs runtime validation. `Promise<Product>` describes an async result. `import type` imports a type without a runtime dependency.

A workspace is a collection of npm packages installed together. One package can import the shared product type by package name rather than reaching into another app's source. ESM is the `import`/`export` module system selected by `"type": "module"`.

## Before lesson 2: a component renders its state

A React component is a function returning JSX, the markup-like syntax in a `.tsx` file. `useState` stores a value between renders. Calling its setter schedules another render; it does not replace the variable in the currently running function.

```tsx
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((previous) => previous + 1)}>{count}</button>;
}
```

This illustrative fragment assumes `useState` is imported from React; it is not a separate tutorial file. The callback runs when the button is clicked. In a list, `key={product.id}` lets React identify the same item across renders.

`useEffect` runs work after rendering. Its dependency array says when that work needs to restart. Returning a cleanup function retires the previous effect. In the lesson, a request started for one URL must not update the page after another URL becomes current. Setting a `cancelled` flag during cleanup tells its eventual response to be ignored; it does not cancel the network itself.

`useData<T>` is a generic helper: `T` is the result type supplied by the caller, such as `Product`. First follow the loading → success/error branches; then look at the cancellation guard. The URL owns committed search filters, while component state holds the input draft. [React's introductory tutorial](https://react.dev/learn) offers more practice with components/state if JSX is unfamiliar.

## Before lesson 3: refs and identity

A Map associates a key with a value. A shopper key groups carts across sessions; a session key groups activity within one visit. `useRef` retains a value without scheduling a render. The checkout ref keeps the same retry key when an HTTP response fails. It must not be regenerated on each click.

An HTTP request can succeed at the server even if its response is lost. Idempotency means a repeat has the same effect: one order, not an extra order. The test deliberately repeats the same session/key.

## Before lesson 4: rows, keys, and transactions

A table holds rows of a defined shape. A primary key uniquely identifies a row. A foreign key requires a referenced row to exist: a cart product must exist in the product table. A composite primary key, such as `(shopper_id, product_id)`, identifies a pair. CHECK constraints reject invalid quantities; UNIQUE constraints prevent duplicate checkout keys within a session.

A JOIN combines related rows. Joining carts to products retrieves quantities alongside current names/prices. JSONB stores parsed JSON, used here for a small purchased-item snapshot. The implemented project instead uses separate order-item rows.

A transaction groups writes into BEGIN → COMMIT, or BEGIN → ROLLBACK on error. The transaction must use one checked-out connection. A pool manages reusable connections; separate `pool.query` calls can use different ones. The advisory lock is a cooperative queue for lab writes so two retries cannot both see an uncompleted order.

SQL `$1` parameters keep values separate from SQL syntax. `ON CONFLICT DO NOTHING` preserves an existing fixture instead of duplicating it. These examples are local teaching choices; read [transaction design](transactions.md) for the full tradeoff.

## Before lesson 7: raw dataframes and merge keys

The ingestion lesson uses Python functions, lists, dictionaries, exceptions, and context managers (`with`). Indentation defines a block; a dictionary maps keys to values, and `Path` represents a filesystem path. If Python is new, work through the [Python 3.12 tutorial](https://docs.python.org/3.12/tutorial/) sections on control flow, data structures, files, and exceptions before copying the ingestion script.

A Spark dataframe is a table-shaped distributed computation. Its schema names columns and their types. A Delta table stores data with a transaction log. A merge matches incoming rows by a logical key and inserts only missing rows. It does not make two separate tables commit atomically together.

The cursor is the last fully completed source sequence. An event's occurrence time serves another purpose; it cannot substitute for the append cursor. Replaying a partial batch matches existing events, completes catalog rows, then advances progress. Read [Bronze recovery](bronze-recovery.md) for a concrete failure timeline.

Related: [learning index](../README.md), [mock-first increments](mocks-and-increments.md).
