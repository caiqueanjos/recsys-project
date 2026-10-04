import { Link } from 'react-router';
import { useEffect, useRef } from 'react';
import { categories, type Product } from '@store/contracts';
import { money, symbols } from '../lib/presentation';
import { Telemetry } from '../lib/telemetry';
export function ProductCard({
  product,
  position,
  surface,
  telemetry,
}: {
  product: Product;
  position: number;
  surface: 'home_trending' | 'catalog' | 'search';
  telemetry: Telemetry;
}) {
  const ref = useRef<HTMLAnchorElement>(null),
    exposure = useRef<string | undefined>(undefined);
  useEffect(() => {
    exposure.current = undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5) &&
          !exposure.current
        ) {
          exposure.current = telemetry.record('impression', {
            productId: product.id,
            surface,
            position,
            page: surface === 'home_trending' ? '/home' : '/catalog',
          });
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [product.id, surface, position, telemetry]);
  return (
    <Link
      to={`/products/${product.id}`}
      ref={ref}
      className="product-card"
      onClick={() => {
        // A keyboard activation can occur before the observer callback; activation establishes visibility.
        exposure.current ??= telemetry.record('impression', {
          productId: product.id,
          surface,
          position,
          page: surface === 'home_trending' ? '/home' : '/catalog',
        });
        telemetry.record('click', {
          productId: product.id,
          surface,
          position,
          impressionId: exposure.current,
        });
      }}
    >
      <div
        className={`product-art art-${categories.indexOf(product.category as (typeof categories)[number])}`}
        aria-hidden="true"
      >
        {symbols[product.category]}
        <span>{product.subcategory}</span>
      </div>
      <div className="product-info">
        <small>
          {product.brand} / {product.category}
        </small>
        <h3>{product.name}</h3>
        <div className="product-price">
          {money(product.priceCents)}
          <span>{product.available ? 'View item ↗' : 'Unavailable'}</span>
        </div>
      </div>
    </Link>
  );
}
