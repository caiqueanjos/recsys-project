import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/store-api/src/db.js';

const store = await Store.open();
try {
  const count = await store.transaction(async () => {
    const shoppers = await store.db
      .prepare(
        'SELECT DISTINCT "shopperId" FROM carts JOIN shoppers ON shoppers.id=carts."shopperId" WHERE shoppers.kind!=\'synthetic\'',
      )
      .all();
    let removed = 0;
    for (const row of shoppers) {
      const now = new Date().toISOString(),
        s = { id: randomUUID(), shopperId: String(row.shopperId) };
      await store.db
        .prepare('INSERT INTO sessions VALUES($1,$2,$3,$4,$5)')
        .run(s.id, s.shopperId, now, now, 'live');
      for (const item of await store.cart(s.shopperId)) {
        await store.event(
          s,
          'cart_remove',
          { productId: item.product.id, quantity: 0, surface: 'cart', page: '/reset' },
          now,
        );
        removed++;
      }
      await store.db.prepare('DELETE FROM carts WHERE "shopperId"=$1').run(s.shopperId);
    }
    return removed;
  });
  console.log(
    `Cleared ${count} live cart items; historical events, identities, orders, and synthetic carts retained.`,
  );
} finally {
  await store.db.close();
}
