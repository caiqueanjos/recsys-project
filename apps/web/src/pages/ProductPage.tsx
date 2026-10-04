import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { categories, type Product } from '@store/contracts';
import { useStore } from '../state/StoreProvider';
import { useResource } from '../hooks/useResource';
import { money, symbols } from '../lib/presentation';
export function ProductPage() {
  const { productId } = useParams();
  const location = useLocation();
  const { telemetry, busy, cart, mutate } = useStore();
  const { data: product, loading } = useResource<Product>(
    `/products/${encodeURIComponent(productId!)}`,
  );
  const viewedProductId = product?.id;
  useEffect(() => {
    if (viewedProductId && telemetry)
      telemetry.record('product_view', {
        productId: viewedProductId,
        page: `/products/${viewedProductId}`,
        surface: 'product',
      });
  }, [viewedProductId, telemetry, location.key]);
  if (!product)
    return <p className="empty">{loading ? 'Loading item…' : 'This item could not be loaded.'}</p>;
  return (
    <>
      <Link className="back" to="/catalog">
        ← Back to shop
      </Link>
      <section className="product-detail">
        <div
          className={`product-art art-${categories.indexOf(product.category as (typeof categories)[number])}`}
        >
          {symbols[product.category]}
        </div>
        <div>
          <p className="eyebrow">
            {product.category} / {product.subcategory}
          </p>
          <h1>{product.name}</h1>
          <p className="brand">By {product.brand}</p>
          <p>{product.description}</p>
          <h2>{money(product.priceCents)}</h2>
          <p>{product.available ? 'Available for your daily routine' : 'Currently unavailable'}</p>
          <button
            className="primary"
            disabled={busy || !product.available}
            onClick={() =>
              void mutate(
                product,
                (cart.find((i) => i.product.id === product.id)?.quantity ?? 0) + 1,
              )
            }
          >
            Add to bag
          </button>
          <Link className="back" to="/cart">
            View bag →
          </Link>
        </div>
      </section>
    </>
  );
}
