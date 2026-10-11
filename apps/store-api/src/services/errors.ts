export type StoreOperationErrorCode =
  'product_not_found' | 'product_unavailable' | 'cart_empty' | 'cart_unavailable';

// Application failures carry business meaning; the HTTP adapter chooses a status.
export class StoreOperationError extends Error {
  constructor(
    readonly code: StoreOperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoreOperationError';
  }
}
