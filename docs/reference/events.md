# Event contract v1

Use this reference to interpret stored events or change instrumentation. Schema: [contracts](../../packages/store-contracts/src/index.ts). Referential checks: [Store.append](../../apps/store-api/src/db.ts). Browser intake: [server.ts](../../apps/store-api/src/server.ts).

## Envelope

| Field                      | Type/rule                                                            |
| -------------------------- | -------------------------------------------------------------------- |
| `schemaVersion`            | Literal `1`                                                          |
| `id`                       | Nonempty string, <=128 characters; unique within the source database |
| `type`                     | One of the event types below                                         |
| `occurredAt`, `ingestedAt` | ISO datetime, normalized by Zod to canonical UTC strings             |
| `shopperId`, `sessionId`   | Nonempty strings; session must belong to shopper                     |
| `source`                   | `browser`, `store_backend`, or `synthetic`                           |
| `context`                  | Strict object containing only the fields below                       |

The envelope is strict too. `occurredAt` must not precede session start. Referenced products must exist and be listed by event occurrence. These checks do not reconstruct historical stock availability.

## Event types

| Type                                     | Required context                         | Live producer                          |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------- |
| `session_activity`                       | No type-specific fields                  | Browser navigation                     |
| `search`                                 | `query` (empty permitted)                | Browser search form submission         |
| `product_view`                           | `productId`                              | Browser after product load             |
| `impression`                             | `productId`, `surface`, `position`       | Browser card visibility/activation     |
| `click`                                  | Same exposure fields plus `impressionId` | Browser product card activation        |
| `cart_add`, `cart_update`, `cart_remove` | `productId`, `quantity`                  | Successful backend cart mutation/reset |
| `purchase`                               | `orderId`                                | Successful backend checkout            |

Synthetic generation can produce these events with `source=synthetic`. Browser events cannot use transactional types. The context quantity is the resulting absolute quantity, including zero for removal. The schema allows 0–99 for all cart types; it does not impose separate positive/zero constraints by cart subtype.

## Context fields

| Field                                                             | Constraint                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `productId`, `orderId`, `impressionId`                            | Optional strings, required by relevant type above                  |
| `page`                                                            | Optional string, <=256 characters                                  |
| `surface`                                                         | `home_trending`, `catalog`, `search`, `product`, `cart`, `history` |
| `position`                                                        | Integer >=1; catalog pages use offset + local index + 1            |
| `query`                                                           | Optional string, <=200 characters                                  |
| `quantity`                                                        | Integer 0–99                                                       |
| `recommendationRequestId`, `recommendationListId`, `modelVersion` | Optional strings reserved for future recommendation attribution    |

`home_trending` rejects nonempty recommendation attribution fields because the list is fixed.

## Referential and retry rules

A click must reference a stored impression with the same session, product, surface, and position. The impression's occurrence cannot be later than the click. A purchase must reference an order with the same session and exact creation timestamp.

`Store.append` validates before insertion. An existing event ID is accepted only when its serialized parsed payload matches the previous payload after substituting the incoming ingestion time. This tolerates a new ingestion timestamp on a retry, but is not a general semantic JSON equality comparison: preserve the same payload structure and context key ordering when replaying observations. A conflicting ID raises an error.

In an HTTP batch, an impression can precede its click in the same array. Reversing them fails if no prior impression exists. Validation or insertion failure rolls back the whole batch and its sequence counter.

## Example browser submission

The IDs and timestamps below illustrate the shape; submit real current timestamps and valid product/session IDs when using the API.

```json
{
  "events": [
    {
      "id": "exposure-1",
      "type": "impression",
      "occurredAt": "2026-10-10T12:00:00.000Z",
      "context": { "productId": "product-1", "surface": "catalog", "position": 1 }
    },
    {
      "id": "click-1",
      "type": "click",
      "occurredAt": "2026-10-10T12:00:01.000Z",
      "context": {
        "productId": "product-1",
        "surface": "catalog",
        "position": 1,
        "impressionId": "exposure-1"
      }
    }
  ]
}
```

Related: [observe events tutorial](../tutorials/05-observe-the-store.md), [observation explanation](../explanation/observations.md), [export envelopes](bronze.md), [index](../README.md).
