import type { CartItem, Session } from '@store/contracts';
import type { Store } from '../db.js';
import { StoreOperationError } from './errors.js';

export class CartService {
  constructor(private readonly store: Store) {}

  // Callers provide a resolved session and a validated absolute quantity (0–99).
  async setQuantity(session: Session, productId: string, quantity: number): Promise<CartItem[]> {
    return this.store.transaction(async () => {
      const product = await this.store.product(productId);
      if (!product || product.listedAt > new Date().toISOString())
        throw new StoreOperationError('product_not_found', 'Product not found');
      if (quantity && !product.available)
        throw new StoreOperationError('product_unavailable', 'Product unavailable');
      const previous =
        (await this.store.cart(session.shopperId)).find((item) => item.product.id === productId)
          ?.quantity ?? 0;
      if (previous !== quantity) {
        await this.store.setCartQuantity(session.shopperId, productId, quantity);
        await this.store.event(
          session,
          quantity === 0 ? 'cart_remove' : previous === 0 ? 'cart_add' : 'cart_update',
          { productId, quantity, page: '/cart', surface: 'cart' },
        );
      }
      return this.store.cart(session.shopperId);
    });
  }
}
