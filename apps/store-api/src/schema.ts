// Text timestamps retain the event contract's canonical UTC ISO representation.
export const schema = `
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT NOT NULL, brand TEXT NOT NULL, description TEXT NOT NULL, "priceCents" INTEGER NOT NULL CHECK("priceCents">0), available INTEGER NOT NULL CHECK(available IN (0,1)), "listedAt" TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trending(position INTEGER PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES products(id));
CREATE TABLE IF NOT EXISTS shoppers(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, "createdAt" TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, "shopperId" TEXT NOT NULL REFERENCES shoppers(id), "startedAt" TEXT NOT NULL, "lastActiveAt" TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS carts("shopperId" TEXT NOT NULL REFERENCES shoppers(id), "productId" TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99), PRIMARY KEY("shopperId","productId"));
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, "shopperId" TEXT NOT NULL REFERENCES shoppers(id), "sessionId" TEXT NOT NULL REFERENCES sessions(id), "createdAt" TEXT NOT NULL, "totalCents" INTEGER NOT NULL, "idempotencyKey" TEXT NOT NULL, UNIQUE("sessionId","idempotencyKey"));
CREATE TABLE IF NOT EXISTS order_items("orderId" TEXT NOT NULL REFERENCES orders(id), "productId" TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), "unitPriceCents" INTEGER NOT NULL, PRIMARY KEY("orderId","productId"));
CREATE TABLE IF NOT EXISTS event_counter(id INTEGER PRIMARY KEY CHECK(id=1), value BIGINT NOT NULL CHECK(value>=0));
INSERT INTO event_counter VALUES(1,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS events(seq BIGINT PRIMARY KEY CHECK(seq>0), id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, "occurredAt" TEXT NOT NULL, "ingestedAt" TEXT NOT NULL, "shopperId" TEXT NOT NULL REFERENCES shoppers(id), "sessionId" TEXT NOT NULL REFERENCES sessions(id), source TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_session ON events("sessionId");
CREATE INDEX IF NOT EXISTS orders_shopper ON orders("shopperId");
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS generation_runs(id TEXT PRIMARY KEY, manifest TEXT NOT NULL);
CREATE OR REPLACE FUNCTION reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Events are append-only'; END;
$$;
CREATE OR REPLACE TRIGGER events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON events
FOR EACH STATEMENT EXECUTE FUNCTION reject_event_mutation();
`;
