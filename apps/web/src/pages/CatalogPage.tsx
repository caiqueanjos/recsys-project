import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { categories, type Product } from '@store/contracts';
import { useResource } from '../hooks/useResource';
import { useStore } from '../state/StoreProvider';
import { ProductGrid } from '../components/ProductGrid';
export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const rawPage = Number(params.get('page') ?? 1);
  const catalogPage = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const [query, setQuery] = useState(search);
  useEffect(() => setQuery(search), [search]);
  const { telemetry } = useStore();
  const { data, loading } = useResource<{ items: Product[]; total: number }>(
    `/products?q=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&page=${catalogPage}`,
  );
  const total = data?.total ?? 0;
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (!value || (key === 'page' && value === '1')) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">EXPLORE THE STORE</p>
          <h1 className="page-title">Find something useful.</h1>
        </div>
        <span>{total.toLocaleString()} items</span>
      </div>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: query.trim(), page: '1' });
          telemetry?.record('search', {
            query: query.trim(),
            surface: 'search',
            page: '/catalog',
          });
        }}
      >
        <input
          aria-label="Search products"
          placeholder="Try kettle, cotton, coffee…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary">Search</button>
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => {
            update({ category: e.target.value, page: '1' });
          }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </form>
      <ProductGrid
        items={data?.items ?? []}
        surface={search ? 'search' : 'catalog'}
        offset={(catalogPage - 1) * 24}
        loading={loading}
      />
      <div className="pagination">
        <button
          disabled={catalogPage === 1 || loading}
          onClick={() => update({ page: String(catalogPage - 1) })}
        >
          ← Previous
        </button>
        <span>
          Page {catalogPage} of {Math.max(1, Math.ceil(total / 24))}
        </span>
        <button
          disabled={catalogPage * 24 >= total || loading}
          onClick={() => update({ page: String(catalogPage + 1) })}
        >
          Next →
        </button>
      </div>
    </>
  );
}
