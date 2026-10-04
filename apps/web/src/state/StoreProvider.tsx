import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { Shopper, Session, CartItem, Product, Order } from '@store/contracts';
import { ApiError, request } from '../lib/api';
import { Telemetry } from '../lib/telemetry';

function useStoreState() {
  const navigate = useNavigate();
  const [identity, setIdentity] = useState<Shopper>();
  const [personas, setPersonas] = useState<Shopper[]>([]);
  const [session, setSession] = useState<Session>();
  const [telemetry, setTelemetry] = useState<Telemetry>();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const checkoutKey = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const telemetryRef = useRef<Telemetry | undefined>(undefined);

  function adoptSession(shopper: Shopper, nextSession: Session) {
    const next: Telemetry = new Telemetry(nextSession, (message) => {
      if (telemetryRef.current === next) setError(message);
    });
    telemetryRef.current?.close();
    telemetryRef.current = next;
    generation.current++;
    setIdentity(shopper);
    setCart([]);
    setSession(nextSession);
    setTelemetry(next);
    setNotice('');
    checkoutKey.current = undefined;
    localStorage.setItem('store.active', shopper.id);
    return generation.current;
  }

  async function switchIdentity(shopper: Shopper) {
    setBusy(true);
    setError('');
    try {
      const nextSession = await request<Session>('/sessions', undefined, { shopperId: shopper.id });
      const version = adoptSession(shopper, nextSession);
      navigate('/');
      const items = await request<CartItem[]>('/cart', nextSession.id);
      if (generation.current === version) setCart(items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const demo = await request<Shopper[]>('/personas');
        if (cancelled) return;
        setPersonas(demo);
        let guest: Shopper;
        const stored = localStorage.getItem('store.guest');
        if (stored) {
          guest = { id: stored, name: 'Guest', kind: 'anonymous', createdAt: '' };
        } else {
          guest = await request<Shopper>('/shoppers', undefined, {}, 'POST');
          localStorage.setItem('store.guest', guest.id);
        }
        let active = demo.find((p) => p.id === localStorage.getItem('store.active')) ?? guest;
        let nextSession: Session;
        try {
          nextSession = await request<Session>('/sessions', undefined, { shopperId: active.id });
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
          // A deleted local database invalidates the persisted guest ID.
          active = await request<Shopper>('/shoppers', undefined, {}, 'POST');
          localStorage.setItem('store.guest', active.id);
          nextSession = await request<Session>('/sessions', undefined, { shopperId: active.id });
        }
        if (cancelled) return;
        const version = adoptSession(active, nextSession);
        const items = await request<CartItem[]>('/cart', nextSession.id);
        if (!cancelled && generation.current === version) setCart(items);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      telemetryRef.current?.close();
    };
  }, []);

  async function mutate(product: Product, quantity: number) {
    if (!session) return;
    setBusy(true);
    setError('');
    const version = generation.current;
    try {
      const items = await request<CartItem[]>(
        `/cart/${product.id}`,
        session.id,
        { quantity },
        'PUT',
      );
      if (version === generation.current) {
        setCart(items);
        checkoutKey.current = undefined;
        setNotice(quantity ? `${product.name} added to your cart` : 'Item removed');
      }
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }

  async function checkout() {
    if (!session) return;
    setBusy(true);
    setError('');
    const version = generation.current;
    checkoutKey.current ??= crypto.randomUUID();
    try {
      const order = await request<Order>('/checkout', session.id, {
        idempotencyKey: checkoutKey.current,
      });
      if (version !== generation.current) return;
      setCart([]);
      checkoutKey.current = undefined;
      navigate('/orders', {
        state: { notice: `Order ${order.id.slice(0, 8)} placed. Thanks for stopping by!` },
      });
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }

  return {
    identity,
    personas,
    session,
    telemetry,
    cart,
    setCart,
    error,
    setError,
    notice,
    setNotice,
    busy,
    switchIdentity,
    mutate,
    checkout,
  };
}
const StoreContext = createContext<ReturnType<typeof useStoreState> | undefined>(undefined);
export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useStoreState();
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore requires StoreProvider');
  return store;
}
