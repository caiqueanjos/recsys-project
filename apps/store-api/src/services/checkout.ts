import { randomUUID } from 'node:crypto';
import type { Order, Session } from '@store/contracts';
import type { Store } from '../db.js';
import { StoreOperationError } from './errors.js';

export class CheckoutService {
  constructor(private readonly store: Store) {}

  // Retry lookup and every checkout write share one transaction and lock.
  async execute(session: Session, idempotencyKey: string): Promise<Order> {
    return this.store.transaction(async () => {
      const prior = await this.store.orderForCheckout(session.id, idempotencyKey);
      if (prior) return prior;
      const items = await this.store.cart(session.shopperId);
      if (!items.length) throw new StoreOperationError('cart_empty', 'Cart is empty');
      if (items.some((item) => !item.product.available))
        throw new StoreOperationError('cart_unavailable', 'Cart contains unavailable products');
      const id = randomUUID(),
        now = new Date().toISOString(),
        total = items.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
      await this.store.createOrder(
        {
          id,
          shopperId: session.shopperId,
          sessionId: session.id,
          createdAt: now,
          totalCents: total,
          items: items.map(({ product, quantity }) => ({
            productId: product.id,
            name: product.name,
            quantity,
            unitPriceCents: product.priceCents,
          })),
        },
        idempotencyKey,
      );
      await this.store.event(session, 'purchase', { orderId: id }, now);
      await this.store.clearCart(session.shopperId);
      return this.store.order(id);
    });
  }
}
