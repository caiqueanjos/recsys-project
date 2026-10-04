import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { useStore } from './state/StoreProvider';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';
import { CatalogPage } from './pages/CatalogPage';
import { ProductPage } from './pages/ProductPage';
import { CartPage } from './pages/CartPage';
import { OrderHistoryPage } from './pages/OrderHistoryPage';

export function App() {
  const location = useLocation();
  const { session, telemetry, error, setError, notice, setNotice, identity, switchIdentity } =
    useStore();
  useEffect(() => {
    window.scrollTo(0, 0);
    setError('');
    setNotice(location.state?.notice ?? '');
  }, [location, setError, setNotice]);
  useEffect(() => {
    if (!telemetry) return;
    const page =
      location.pathname === '/'
        ? '/home'
        : location.pathname === '/orders'
          ? '/history'
          : location.pathname;
    telemetry.record('session_activity', { page });
  }, [location, telemetry]);
  return (
    <>
      <div className="announcement">
        Everyday essentials. A little more considered. <span>Demo store · no real payments</span>
      </div>
      <Header />
      <main>
        {error && (
          <div className="alert" role="alert">
            {error}{' '}
            {error.includes('Session') && identity && (
              <button onClick={() => void switchIdentity(identity)}>Start a new session</button>
            )}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {!session ? (
          <div className="empty">Opening your store…</div>
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/products/:productId" element={<ProductPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/orders" element={<OrderHistoryPage />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  Page not found. <Link to="/">Return home</Link>
                </div>
              }
            />
          </Routes>
        )}
      </main>
      <Footer />
    </>
  );
}
