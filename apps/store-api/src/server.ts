import Fastify, { type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { browserTypes, eventSchema, type Session, type StoreEvent } from '@store/contracts';
import { Store } from './db.js';

export function buildServer(store = new Store()) {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  store.seedPersonas();
  const fail = (message: string, statusCode = 400): never => { throw Object.assign(new Error(message), { statusCode }); };
  const session = (req: FastifyRequest): Session => {
    const id = req.headers['x-session-id'];
    if (typeof id !== 'string') return fail('Session required',401);
    const row = store.db.prepare('SELECT * FROM sessions WHERE id=? AND source=?').get(id,'live') as Session | undefined;
    if (!row || Date.now() - Date.parse(row.lastActiveAt) > 30 * 60_000) return fail('Session expired; start a new session',401);
    store.db.prepare('UPDATE sessions SET lastActiveAt=? WHERE id=?').run(new Date().toISOString(),id);
    return row;
  };
  app.setErrorHandler((error, _req, reply) => {
    const e = error as Error & { statusCode?:number };
    reply.code(e instanceof z.ZodError ? 400 : e.statusCode ?? 400).send({error:e.message});
  });
  app.get('/health',async () => ({status:'ok'}));
  app.get('/personas',async () => store.db.prepare("SELECT * FROM shoppers WHERE kind='persona' ORDER BY id").all());
  app.post('/shoppers',async () => {
    const shopper = {id:randomUUID(),name:'Guest',kind:'anonymous',createdAt:new Date().toISOString()};
    store.db.prepare('INSERT INTO shoppers VALUES(?,?,?,?)').run(shopper.id,shopper.name,shopper.kind,shopper.createdAt);
    return shopper;
  });
  app.post('/sessions',async req => {
    const {shopperId} = z.object({shopperId:z.string()}).parse(req.body);
    if (!store.db.prepare("SELECT id FROM shoppers WHERE id=? AND kind != 'synthetic'").get(shopperId)) fail('Shopper not found',404);
    const now = new Date().toISOString();
    const result: Session = {id:randomUUID(),shopperId,startedAt:now,lastActiveAt:now,source:'live'};
    store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(result.id,shopperId,now,now,'live');
    return result;
  });
  app.get('/products',async req => {
    const {q,category,page,limit} = z.object({q:z.string().max(200).default(''),category:z.string().default(''),page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(24)}).parse(req.query);
    const params = [new Date().toISOString(),`%${q}%`,`%${q}%`,category,category];
    const where = 'listedAt<=? AND (name LIKE ? OR description LIKE ?) AND (?=\'\' OR category=?)';
    const rows = store.db.prepare(`SELECT id FROM products WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit);
    return {items:rows.map(row => store.product(String(row.id))),total:store.db.prepare(`SELECT count(*) AS n FROM products WHERE ${where}`).get(...params)!.n,page,limit};
  });
  app.get('/products/:id',async req => {
    const {id} = req.params as {id:string}; const product = store.product(id);
    if (!product || product.listedAt > new Date().toISOString()) return fail('Product not found',404);
    return product;
  });
  app.get('/trending',async () => store.db.prepare('SELECT productId FROM trending ORDER BY position').all().map(row => store.product(String(row.productId))).filter(p => p && p.listedAt<=new Date().toISOString()));
  app.get('/cart',async req => store.cart(session(req).shopperId));
  app.put('/cart/:productId',async req => {
    const s = session(req), {productId} = req.params as {productId:string};
    const {quantity} = z.object({quantity:z.number().int().min(0).max(99)}).parse(req.body);
    return store.transaction(() => {
      const product = store.product(productId);
      if (!product || product.listedAt > new Date().toISOString()) return fail('Product not found',404);
      if (quantity && !product.available) fail('Product unavailable',409);
      const previous = store.cart(s.shopperId).find(item => item.product.id===productId)?.quantity ?? 0;
      if (previous !== quantity) {
        if (quantity===0) store.db.prepare('DELETE FROM carts WHERE shopperId=? AND productId=?').run(s.shopperId,productId);
        else store.db.prepare('INSERT INTO carts VALUES(?,?,?) ON CONFLICT(shopperId,productId) DO UPDATE SET quantity=excluded.quantity').run(s.shopperId,productId,quantity);
        store.event(s,quantity===0?'cart_remove':previous===0?'cart_add':'cart_update',{productId,quantity,page:'/cart',surface:'cart'});
      }
      return store.cart(s.shopperId);
    });
  });
  app.post('/checkout',async req => {
    const s = session(req);
    const {idempotencyKey} = z.object({idempotencyKey:z.string().min(1).max(128)}).parse(req.body);
    return store.transaction(() => {
      const prior = store.db.prepare('SELECT id FROM orders WHERE sessionId=? AND idempotencyKey=?').get(s.id,idempotencyKey);
      if (prior) return store.order(String(prior.id));
      const items = store.cart(s.shopperId);
      if (!items.length) fail('Cart is empty',409);
      if (items.some(item => !item.product.available)) fail('Cart contains unavailable products',409);
      const id=randomUUID(),now=new Date().toISOString(),total=items.reduce((sum,item)=>sum+item.product.priceCents*item.quantity,0);
      store.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(id,s.shopperId,s.id,now,total,idempotencyKey);
      for (const item of items) store.db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)').run(id,item.product.id,item.product.name,item.quantity,item.product.priceCents);
      store.event(s,'purchase',{orderId:id},now);
      store.db.prepare('DELETE FROM carts WHERE shopperId=?').run(s.shopperId);
      return store.order(id);
    });
  });
  app.get('/orders',async req => {
    const s=session(req);
    return store.db.prepare('SELECT id FROM orders WHERE shopperId=? ORDER BY createdAt DESC').all(s.shopperId).map(row=>store.order(String(row.id)));
  });
  app.post('/events',async req => {
    const s=session(req),now=new Date().toISOString();
    const {events} = z.object({events:z.array(z.object({id:z.string(),type:z.enum(browserTypes),occurredAt:z.iso.datetime(),context:z.unknown()}).strict()).max(100)}).parse(req.body);
    store.transaction(() => {
      for (const input of events) {
        if (Date.parse(input.occurredAt)>Date.now()+60_000) fail('Future event timestamp');
        const event = eventSchema.parse({...input,schemaVersion:1,ingestedAt:now,shopperId:s.shopperId,sessionId:s.id,source:'browser'}) as StoreEvent;
        store.append(event);
      }
    });
    return {accepted:events.length};
  });
  return app;
}
