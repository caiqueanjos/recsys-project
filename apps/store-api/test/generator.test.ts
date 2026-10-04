import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/db.js';
import { generate, defaults } from '../../../tools/generate/generator.js';
import { exportBronze } from '../../../tools/generate/export.js';

test('seeded history is reproducible, chronological, referentially valid and reconciled',()=>{
  const a=new Store(':memory:'),b=new Store(':memory:');
  const config={...defaults,products:140,shoppers:80,events:5000};
  const first=generate(a,config),second=generate(b,config);
  assert.deepEqual(first,second);
  assert.ok("diagnostics" in first);
  for(const table of ['products','shoppers','sessions','carts','orders','order_items','events'])assert.deepEqual(a.db.prepare(`SELECT * FROM ${table}`).all(),b.db.prepare(`SELECT * FROM ${table}`).all());
  const before=a.db.prepare('SELECT count(*) AS n FROM events').get()!.n;
  assert.equal(generate(a,config).alreadyGenerated,true);
  assert.equal(a.db.prepare('SELECT count(*) AS n FROM events').get()!.n,before);
  assert.deepEqual(a.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(a.db.prepare('SELECT count(*) AS n FROM orders o WHERE totalCents != (SELECT sum(quantity*unitPriceCents) FROM order_items i WHERE i.orderId=o.id)').get()!.n,0);
  assert.equal(a.db.prepare("SELECT count(*) AS n FROM orders o WHERE (SELECT count(*) FROM events e WHERE e.type='purchase' AND json_extract(e.payload,'$.context.orderId')=o.id)!=1").get()!.n,0);
  assert.equal(a.db.prepare('SELECT count(*) AS n FROM events e JOIN shoppers s ON s.id=e.shopperId WHERE e.occurredAt<s.createdAt').get()!.n,0);
  const events=a.db.prepare('SELECT payload FROM events ORDER BY seq').all().map(r=>JSON.parse(String(r.payload)));
  const times=new Map<string,string>();
  for(const e of events){assert.ok(!times.has(e.sessionId)||times.get(e.sessionId)!<=e.occurredAt);times.set(e.sessionId,e.occurredAt);assert.ok(e.occurredAt<first.end!);}
  const diagnostics=first.diagnostics!;
  for(const u of diagnostics.users.filter(u=>u.unobserved))assert.equal(a.db.prepare('SELECT count(*) AS n FROM events WHERE shopperId=?').get(u.id)!.n,0);
  for(const p of diagnostics.unobservedProducts)assert.equal(a.db.prepare("SELECT count(*) AS n FROM events WHERE json_extract(payload,'$.context.productId')=?").get(p)!.n,0);
  assert.ok(a.db.prepare('SELECT count(*) AS n FROM shoppers WHERE createdAt>?').get(first.cutoff!)!.n as number>0);
  assert.ok(a.db.prepare('SELECT count(*) AS n FROM products WHERE listedAt>?').get(first.cutoff!)!.n as number>0);
  const dir=mkdtempSync(join(tmpdir(),'store-export-'));
  try{
    const manifest=exportBronze(a,join(dir,'batch'),0,'2026-10-01T00:00:00.000Z');
    assert.equal(manifest.files['events.ndjson'].count,before);
    const raw=readFileSync(join(dir,'batch','events.ndjson'),'utf8');assert.ok(!raw.includes('propensity'));assert.ok(!raw.includes('budget'));
    assert.equal(exportBronze(a,join(dir,'empty'),manifest.highWater).files['events.ndjson'].count,0);
  }finally{rmSync(dir,{recursive:true,force:true});a.db.close();b.db.close();}
});
