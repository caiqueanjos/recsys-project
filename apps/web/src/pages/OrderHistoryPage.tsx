import type { Order } from '@store/contracts';
import { useResource } from '../hooks/useResource';
import { money } from '../lib/presentation';
export function OrderHistoryPage() {
  const { data, loading } = useResource<Order[]>('/orders');
  const orders = data ?? [];
  if (loading) return <p className="empty">Loading orders…</p>;
  return (
    <>
      <p className="eyebrow">YOUR EVERYDAY ARCHIVE</p>
      <h1 className="page-title">Past orders</h1>
      {!orders.length ? (
        <p className="empty">Your first order is still ahead.</p>
      ) : (
        orders.map((order) => (
          <article className="order" key={order.id}>
            <div className="section-heading">
              <div>
                <h3>Order {order.id.slice(0, 8)}</h3>
                <small>{new Date(order.createdAt).toLocaleString()}</small>
              </div>
              <b>{money(order.totalCents)}</b>
            </div>
            {order.items.map((i) => (
              <div className="order-item" key={i.productId}>
                <span>
                  {i.name} × {i.quantity}
                </span>
                <span>{money(i.unitPriceCents * i.quantity)}</span>
              </div>
            ))}
          </article>
        ))
      )}
    </>
  );
}
