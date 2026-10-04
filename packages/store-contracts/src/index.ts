import { z } from 'zod';

export const categories = ['Electronics', 'Home & Kitchen', 'Personal Care', 'Clothing', 'Sports', 'Toys', 'Groceries'] as const;
export type Product = {
  id: string; name: string; category: string; subcategory: string; brand: string;
  description: string; priceCents: number; available: boolean; listedAt: string;
};
export type Shopper = { id: string; name: string; kind: 'anonymous' | 'persona' | 'synthetic'; createdAt: string };
export type Session = { id: string; shopperId: string; startedAt: string; lastActiveAt: string; source: 'live' | 'synthetic' };
export type CartItem = { product: Product; quantity: number };
export type Order = { id: string; shopperId: string; sessionId: string; createdAt: string; totalCents: number; items: { productId: string; name: string; quantity: number; unitPriceCents: number }[] };
export const browserTypes = ['session_activity', 'search', 'product_view', 'click', 'impression'] as const;
export const eventSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1).max(128),
  type: z.enum([...browserTypes, 'cart_add', 'cart_update', 'cart_remove', 'purchase']),
  occurredAt: z.iso.datetime(), ingestedAt: z.iso.datetime(),
  shopperId: z.string().min(1), sessionId: z.string().min(1),
  source: z.enum(['browser', 'store_backend', 'synthetic']),
  context: z.object({
    productId: z.string().optional(), page: z.string().max(256).optional(),
    surface: z.enum(['home_trending', 'catalog', 'search', 'product', 'cart', 'history']).optional(),
    position: z.number().int().min(1).optional(), query: z.string().max(200).optional(),
    quantity: z.number().int().min(0).max(99).optional(), orderId: z.string().optional(),
    impressionId: z.string().optional(), recommendationRequestId: z.string().optional(),
    recommendationListId: z.string().optional(), modelVersion: z.string().optional(),
  }).strict(),
}).strict().superRefine((event, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (['product_view', 'click', 'impression', 'cart_add', 'cart_update', 'cart_remove'].includes(event.type) && !event.context.productId) error('Product required');
  if (['click', 'impression'].includes(event.type) && (!event.context.surface || !event.context.position)) error('Exposure surface and position required');
  if (event.type === 'click' && !event.context.impressionId) error('Click requires an impression ID');
  if (event.type === 'search' && event.context.query === undefined) error('Search query required');
  if (event.type === 'purchase' && !event.context.orderId) error('Purchase order required');
  if (event.type.startsWith('cart_') && event.context.quantity === undefined) error('Cart quantity required');
  if (event.source === 'browser' && !(browserTypes as readonly string[]).includes(event.type)) error('Browser cannot record transactions');
  if (event.context.surface === 'home_trending' && (event.context.modelVersion || event.context.recommendationListId || event.context.recommendationRequestId)) error('Fixed trending has no model attribution');
});
export type StoreEvent = z.infer<typeof eventSchema>;
