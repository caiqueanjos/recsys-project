import type { Product } from '@store/contracts';
import { useStore } from '../state/StoreProvider';
import { ProductCard } from './ProductCard';
export function ProductGrid({
  items,
  surface,
  offset = 0,
  loading,
}: {
  items: Product[];
  surface: 'home_trending' | 'catalog' | 'search';
  offset?: number;
  loading: boolean;
}) {
  const { telemetry } = useStore();
  return (
    <>
      <div className="product-grid">
        {telemetry &&
          items.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              position={offset + index + 1}
              surface={surface}
              telemetry={telemetry}
            />
          ))}
      </div>
      {!items.length && (
        <p className="empty">
          {loading
            ? 'Loading products…'
            : 'No items to show. Try another search, or seed the catalog.'}
        </p>
      )}
    </>
  );
}
