import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eventSchema, type Product, type StoreEvent, type Order } from '@store/contracts';

export class Store {
  db: DatabaseSync;
  constructor(path = process.env.STORE_DB ?? 'data/store.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT NOT NULL, brand TEXT NOT NULL, description TEXT NOT NULL, priceCents INTEGER NOT NULL CHECK(priceCents>0), available INTEGER NOT NULL, listedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trending(position INTEGER PRIMARY KEY, productId TEXT NOT NULL REFERENCES products(id));
      CREATE TABLE IF NOT EXISTS shoppers(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, shopperId TEXT NOT NULL REFERENCES shoppers(id), startedAt TEXT NOT NULL, lastActiveAt TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS carts(shopperId TEXT NOT NULL REFERENCES shoppers(id), productId TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99), PRIMARY KEY(shopperId,productId));
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, shopperId TEXT NOT NULL REFERENCES shoppers(id), sessionId TEXT NOT NULL REFERENCES sessions(id), createdAt TEXT NOT NULL, totalCents INTEGER NOT NULL, idempotencyKey TEXT NOT NULL, UNIQUE(sessionId,idempotencyKey));
      CREATE TABLE IF NOT EXISTS order_items(orderId TEXT NOT NULL REFERENCES orders(id), productId TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unitPriceCents INTEGER NOT NULL, PRIMARY KEY(orderId,productId));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, occurredAt TEXT NOT NULL, ingestedAt TEXT NOT NULL, shopperId TEXT NOT NULL REFERENCES shoppers(id), sessionId TEXT NOT NULL REFERENCES sessions(id), source TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_session ON events(sessionId);
      CREATE INDEX IF NOT EXISTS orders_shopper ON orders(shopperId);
      CREATE TABLE IF NOT EXISTS generation_runs(id TEXT PRIMARY KEY, manifest TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  product(id: string): Product | undefined {
    const row = this.db.prepare('SELECT * FROM products WHERE id=?').get(id);
    return row ? { ...row, available: Boolean(row.available) } as Product : undefined;
  }
  cart(shopperId: string) {
    return (this.db.prepare('SELECT productId,quantity FROM carts WHERE shopperId=? ORDER BY productId').all(shopperId) as {productId:string;quantity:number}[])
      .map(row => ({ product: this.product(row.productId)!, quantity: row.quantity }));
  }
  order(id: string): Order {
    const row = this.db.prepare('SELECT id,shopperId,sessionId,createdAt,totalCents FROM orders WHERE id=?').get(id)!;
    return { ...row, items: this.db.prepare('SELECT productId,name,quantity,unitPriceCents FROM order_items WHERE orderId=? ORDER BY productId').all(id) } as Order;
  }
  append(input: StoreEvent): void {
    const event = eventSchema.parse(input);
    const existing = this.db.prepare('SELECT payload FROM events WHERE id=?').get(event.id);
    if (existing) {
      const previous = JSON.parse(String(existing.payload));
      if (JSON.stringify({ ...previous, ingestedAt: event.ingestedAt }) !== JSON.stringify(event)) throw new Error('Event ID conflicts with existing payload');
      return;
    }
    const session = this.db.prepare('SELECT shopperId,startedAt FROM sessions WHERE id=?').get(event.sessionId);
    if (!session || session.shopperId !== event.shopperId) throw new Error('Invalid event identity');
    if (event.occurredAt < String(session.startedAt)) throw new Error('Event precedes session');
    if (event.context.productId) {
      const product = this.product(event.context.productId);
      if (!product || product.listedAt > event.occurredAt) throw new Error('Product not listed at event time');
    }
    if (event.type === 'click') {
      const row = this.db.prepare('SELECT payload FROM events WHERE id=?').get(event.context.impressionId!);
      const impression = row ? JSON.parse(String(row.payload)) as StoreEvent : undefined;
      if (!impression || impression.type !== 'impression' || impression.sessionId !== event.sessionId || impression.context.productId !== event.context.productId || impression.context.surface !== event.context.surface || impression.context.position !== event.context.position || impression.occurredAt > event.occurredAt) throw new Error('Click has no matching prior impression');
    }
    if (event.type === 'purchase') {
      const order = this.db.prepare('SELECT sessionId,createdAt FROM orders WHERE id=?').get(event.context.orderId!);
      if (!order || order.sessionId !== event.sessionId || order.createdAt !== event.occurredAt) throw new Error('Purchase must match order');
    }
    this.db.prepare('INSERT INTO events(id,type,occurredAt,ingestedAt,shopperId,sessionId,source,payload) VALUES(?,?,?,?,?,?,?,?)').run(event.id,event.type,event.occurredAt,event.ingestedAt,event.shopperId,event.sessionId,event.source,JSON.stringify(event));
  }
  event(session: {id:string;shopperId:string}, type: StoreEvent['type'], context: StoreEvent['context'], time = new Date().toISOString(), source: StoreEvent['source'] = 'store_backend') {
    this.append({ schemaVersion:1, id:randomUUID(), type, occurredAt:time, ingestedAt:time, shopperId:session.shopperId, sessionId:session.id, source, context });
  }
  seedPersonas() {
    for (const [id,name] of [['persona-home','Alex · home projects'],['persona-active','Sam · active days'],['persona-family','Jo · family essentials']]) {
      this.db.prepare('INSERT OR IGNORE INTO shoppers VALUES(?,?,?,?)').run(id,name,'persona','2025-01-01T00:00:00.000Z');
    }
  }
}
