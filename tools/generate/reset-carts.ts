import { randomUUID } from 'node:crypto';
import { Store } from '../../apps/store-api/src/db.js';
const store = new Store();
try {
  const count = store.transaction(() => {
    const shoppers = store.db
      .prepare(
        "SELECT DISTINCT shopperId FROM carts JOIN shoppers ON shoppers.id=carts.shopperId WHERE shoppers.kind!='synthetic'",
      )
      .all();
    let removed = 0;
    for (const row of shoppers) {
      const now = new Date().toISOString(),
        s = { id: randomUUID(), shopperId: String(row.shopperId) };
      store.db
        .prepare('INSERT INTO sessions VALUES(?,?,?,?,?)')
        .run(s.id, s.shopperId, now, now, 'live');
      for (const item of store.cart(s.shopperId)) {
        store.event(
          s,
          'cart_remove',
          { productId: item.product.id, quantity: 0, surface: 'cart', page: '/reset' },
          now,
        );
        removed++;
      }
      store.db.prepare('DELETE FROM carts WHERE shopperId=?').run(s.shopperId);
    }
    return removed;
  });
  console.log(
    `Cleared ${count} live cart items; historical events, identities, orders, and synthetic carts retained.`,
  );
} finally {
  store.db.close();
}
