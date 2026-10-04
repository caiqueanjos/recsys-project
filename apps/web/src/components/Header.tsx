import { Link, NavLink } from 'react-router';
import { useStore } from '../state/StoreProvider';
export function Header() {
  const { identity, personas, busy, cart, switchIdentity } = useStore();
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <header>
      <Link className="wordmark" to="/">
        everyday<span>●</span>
      </Link>
      <nav>
        <NavLink to="/catalog" className={({ isActive }) => (isActive ? 'selected' : '')}>
          Shop all
        </NavLink>
        <NavLink to="/orders" className={({ isActive }) => (isActive ? 'selected' : '')}>
          Your orders
        </NavLink>
      </nav>
      <div className="header-actions">
        <label className="identity">
          Shopping as
          <select
            aria-label="Shopping identity"
            disabled={busy}
            value={identity?.id ?? ''}
            onChange={(e) => {
              const guest = {
                id: localStorage.getItem('store.guest')!,
                name: 'Guest',
                kind: 'anonymous' as const,
                createdAt: '',
              };
              void switchIdentity(personas.find((p) => p.id === e.target.value) ?? guest);
            }}
          >
            <option value={localStorage.getItem('store.guest') ?? ''}>Guest</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Link className="cart-button" to="/cart">
          Bag <b>{count}</b>
        </Link>
      </div>
    </header>
  );
}
