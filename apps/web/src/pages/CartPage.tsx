import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import type { CartItem } from '@store/contracts';
import { useStore } from '../state/StoreProvider';
import { request } from '../lib/api';
import { money, symbols } from '../lib/presentation';
export function CartPage() {
  const { session, cart, setCart, setError, busy, mutate, checkout } = useStore();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    if (!session) return;
    let cancelled = false;
    void request<CartItem[]>('/cart', session.id).then(
      (items) => {
        if (!cancelled) {
          setCart(items);
          setLoading(false);
        }
      },
      (error) => {
        if (!cancelled) {
          setError(error.message);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [session, setCart, setError]);
  if (loading) return <p className="empty">Loading bag…</p>;
  const subtotal = cart.reduce((sum, item) => sum + item.quantity * item.product.priceCents, 0);
  return (
    <>
      <p className="eyebrow">YOUR DAILY FINDS</p>
      <h1 className="page-title">Shopping bag</h1>
      {!cart.length ? (
        <div className="empty">
          Your bag is waiting for something good.
          <br />
          <Link className="primary" to="/catalog">
            Explore the store
          </Link>
        </div>
      ) : (
        <div className="cart-layout">
          <div>
            {cart.map((item) => (
              <div className="cart-row" key={item.product.id}>
                <div className="mini-art">{symbols[item.product.category]}</div>
                <div>
                  <h3>{item.product.name}</h3>
                  <small>{money(item.product.priceCents)} each</small>
                  <div className="quantity">
                    <button
                      aria-label={`Decrease ${item.product.name}`}
                      disabled={busy}
                      onClick={() => void mutate(item.product, item.quantity - 1)}
                    >
                      −
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      aria-label={`Increase ${item.product.name}`}
                      disabled={busy || item.quantity >= 99}
                      onClick={() => void mutate(item.product, item.quantity + 1)}
                    >
                      +
                    </button>
                    <button disabled={busy} onClick={() => void mutate(item.product, 0)}>
                      Remove
                    </button>
                  </div>
                </div>
                <b>{money(item.quantity * item.product.priceCents)}</b>
              </div>
            ))}
          </div>
          <aside>
            <h2>A good little haul.</h2>
            <div className="subtotal">
              <span>Subtotal</span>
              <b>{money(subtotal)}</b>
            </div>
            <p>This is a demo checkout. No payment or shipping details needed.</p>
            <button className="primary" disabled={busy} onClick={() => void checkout()}>
              {busy ? 'Working…' : 'Place demo order ↗'}
            </button>
          </aside>
        </div>
      )}
    </>
  );
}
