import { categories, type Product } from '@store/contracts';
import { Link } from 'react-router';
import { symbols } from '../lib/presentation';
import { useResource } from '../hooks/useResource';
import { ProductGrid } from '../components/ProductGrid';
export function HomePage() {
  const { data: items, loading } = useResource<Product[]>('/trending');
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">THE DAILY EDIT / 01</p>
          <h1>
            Little things.
            <br />
            Better days.
          </h1>
          <p>Useful finds for your home, your routine, and everything in between.</p>
          <Link className="primary" to="/catalog">
            Find your everyday ↗
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one">⌂</div>
          <div className="orbit orbit-two">✦</div>
          <div className="orbit orbit-three">◎</div>
          <span>GOOD THINGS, EVERY DAY</span>
        </div>
      </section>
      <section className="category-strip">
        {categories.map((c) => (
          <Link key={c} to={`/catalog?category=${encodeURIComponent(c)}`}>
            <span>{symbols[c]}</span>
            {c}
          </Link>
        ))}
      </section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">A FEW FAVORITES</p>
          <h2>The everyday edit</h2>
        </div>
        <p>A fixed selection of store favorites.</p>
      </div>
      <ProductGrid items={items ?? []} surface="home_trending" loading={loading} />
    </>
  );
}
