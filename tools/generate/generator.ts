import { createHash } from 'node:crypto';
import { categories, type Product, type StoreEvent } from '@store/contracts';
import { Store } from '../../apps/store-api/src/db.js';

export type Config = {seed:number;products:number;shoppers:number;events:number;days:number;start:string};
export const defaults:Config={seed:42,products:10_000,shoppers:20_000,events:1_000_000,days:90,start:'2026-07-01T00:00:00.000Z'};
const catalog = [
  {types:['Wireless headphones','Portable speaker','USB-C charger','Desk lamp','Travel power bank'],sub:['Audio','Audio','Accessories','Lighting','Accessories'],brands:['Circuit','Northwave','Volt'],prices:[6900,4900,2400,3900,3500]},
  {types:['Pour-over kettle','Cotton kitchen towels','Stoneware mug','Glass storage jars','Bamboo cutting board'],sub:['Kitchen','Kitchen','Tableware','Storage','Kitchen'],brands:['Hearth','Oak & Clay','Nest'],prices:[4500,1800,1400,2200,2600]},
  {types:['Gentle hand soap','Daily moisturizer','Botanical shampoo','Mineral sunscreen','Soft bath towel'],sub:['Bath','Skincare','Haircare','Skincare','Bath'],brands:['Pureday','Botanica','Kind'],prices:[800,1900,1400,2100,2400]},
  {types:['Cotton crew tee','Everyday socks','Linen shirt','Fleece sweatshirt','Canvas tote'],sub:['Tops','Basics','Tops','Layers','Accessories'],brands:['Thread','Fieldwork','Common'],prices:[2200,1200,4800,5200,1800]},
  {types:['Yoga mat','Insulated water bottle','Resistance bands','Running cap','Trail daypack'],sub:['Fitness','Hydration','Fitness','Running','Outdoors'],brands:['Stride','Summit','Move'],prices:[3500,2800,1800,2400,6500]},
  {types:['Wooden building blocks','Family board game','Animal puzzle','Watercolor set','Plush bear'],sub:['Building','Games','Puzzles','Creative','Plush'],brands:['Playroom','Wonder','Little Oak'],prices:[2800,3200,1600,1800,2200]},
  {types:['Whole-bean coffee','Rolled oats','Dark chocolate','Herbal tea','Roasted almonds'],sub:['Coffee','Pantry','Snacks','Tea','Snacks'],brands:['Harvest','Daily Pantry','Greenleaf'],prices:[1400,600,500,900,1100]},
];
function random(seed:number){let state=seed>>>0;return()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
export function generate(store:Store,config:Config){
  for(const key of ['products','shoppers','events','days'] as const)if(!Number.isSafeInteger(config[key])||config[key]<1)throw new Error(`${key} must be a positive integer`);
  if(!Number.isSafeInteger(config.seed)||!Number.isFinite(Date.parse(config.start)))throw new Error('Invalid seed or start');
  if(config.products<35||config.shoppers<20)throw new Error('Use at least 35 products and 20 shoppers for cohort coverage');
  if(config.days<10)throw new Error('At least 10 days needed for cold-start cohorts');
  const end=Date.parse(config.start)+config.days*86400000;
  if(end>Date.now())throw new Error('Historical generation must end in the past');
  const run=createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0,12);
  if(store.db.prepare('SELECT id FROM generation_runs WHERE id=?').get(run))return {run,alreadyGenerated:true};
  const rng=random(config.seed),pick=<T>(values:T[])=>values[Math.floor(rng()*values.length)],iso=(ms:number)=>new Date(ms).toISOString(),start=Date.parse(config.start);
  const cutoff=start+Math.floor(config.days*.8)*86400000;
  const id=(kind:string,n:number)=>`${run}-${kind}-${n.toString().padStart(7,'0')}`;
  const products:Product[]=[],users:{id:string;createdAt:string;interest:number;brand:number;budget:number;propensity:number;unobserved:boolean;sparse:boolean}[]=[];
  let eventCount=0,sessionCount=0,orderCount=0;
  const manifest={run,config,cutoff:iso(cutoff),end:iso(end),coldProductFraction:0.15,coldShopperFraction:0.15,unobservedFraction:0.05,sparseFraction:0.10,source:'synthetic',generatorVersion:1};
  store.transaction(()=>{
    for(let n=0;n<config.products;n++){
      const c=n%7,entry=catalog[c],t=Math.floor(n/7)%5,variant=Math.floor(n/35);
      const unobserved=n>=Math.floor(config.products*.95),cold=n>=Math.floor(config.products*.85);
      const listedAt=iso(cold?cutoff+Math.floor(rng()*Math.max(1,config.days*.12))*86400000:start-30*86400000);
      const p:Product={id:id('product',n),name:`${entry.types[t]} · ${['Classic','Everyday','Compact','Premium'][variant%4]} ${Math.floor(variant/4)+1}`,category:categories[c],subcategory:entry.sub[t],brand:entry.brands[Math.floor(rng()*3)],description:`${entry.types[t]} from ${entry.brands[variant%3]}, designed for ${c===6?'a well-stocked pantry':'comfortable everyday use'}. ${['A practical essential with a simple finish.','A considered choice for your daily routine.','Thoughtful details, easy to enjoy.'][variant%3]}`,priceCents:Math.max(100,Math.round(entry.prices[t]*(.65+rng()*1.15)/100)*100),available:rng()>.04,listedAt};
      // Keep brand and description coherent.
      p.description=p.description.replace(entry.brands[variant%3],p.brand);
      store.db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?)').run(p.id,p.name,p.category,p.subcategory,p.brand,p.description,p.priceCents,Number(p.available),p.listedAt);
      products.push(p);
      if(!unobserved&&n<12&&p.available)store.db.prepare('INSERT OR IGNORE INTO trending VALUES(?,?)').run(n+1,p.id);
    }
    for(let n=0;n<config.shoppers;n++){
      const cold=n>=Math.floor(config.shoppers*.85),unobserved=n>=Math.floor(config.shoppers*.95),sparse=n>=Math.floor(config.shoppers*.75)&&!unobserved;
      const user={id:id('shopper',n),createdAt:iso(cold?cutoff+Math.floor(rng()*config.days*.12)*86400000:start),interest:Math.floor(rng()*7),brand:Math.floor(rng()*3),budget:.5+rng()*1.5,propensity:.08+rng()*.55,unobserved,sparse};
      users.push(user);store.db.prepare('INSERT INTO shoppers VALUES(?,?,?,?)').run(user.id,`Synthetic shopper ${n+1}`,'synthetic',user.createdAt);
    }
    const pools=new Map<number,Product[][]>();
    const usedSparse=new Set<string>();
    const lastActivity=new Map<string,number>();
    while(eventCount<config.events){
      // Mixture yields heavy activity plus long-tail and cold shoppers.
      const user=users[Math.floor((rng()<.65?Math.pow(rng(),2.5):rng())*users.length)];
      if(user.unobserved||user.sparse&&usedSparse.has(user.id))continue;
      const scheduled=start+Math.floor(eventCount/config.events*(config.days*86400000-2*3600000));
      const base=Math.max(scheduled, (lastActivity.get(user.id)??start-1000)+1000);
      const day=Math.floor((base-start)/86400000);
      if(base<Date.parse(user.createdAt))continue;
      if(!pools.has(day))pools.set(day,categories.map(c=>products.filter((p,n)=>p.category===c&&p.available&&n<Math.floor(config.products*.95)&&Date.parse(p.listedAt)<=start+day*86400000)));
      const pool=pools.get(day)!;
      if(!pool.some(p=>p.length))throw new Error('Not enough available products to generate history');
      const sid=id('session',sessionCount++);let time=base;
      const s={id:sid,shopperId:user.id};
      store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sid,user.id,iso(time),iso(time),'synthetic');
      const emit=(type:StoreEvent['type'],context:StoreEvent['context'])=>{
        time+=1000+Math.floor(rng()*15000);
        const event:StoreEvent={schemaVersion:1,id:id('event',eventCount++),type,occurredAt:iso(time),ingestedAt:iso(time+1000+Math.floor(rng()*4000)),shopperId:user.id,sessionId:sid,source:'synthetic',context};
        store.append(event);return event.id;
      };
      emit('session_activity',{page:'/home'});
      const intent=rng()<.75?user.interest:Math.floor(rng()*7),categoryPool=pool[intent].length?pool[intent]:pool.flat();
      const searching=rng()<.45;
      if(searching)emit('search',{query:pick(categoryPool).subcategory.toLowerCase(),surface:'search',page:'/catalog'});
      const rounds=user.sparse?1:1+Math.floor(rng()*3);
      for(let round=0;round<rounds;round++){
        const exposure: {p:Product;impression:string;position:number}[]=[];
        const seen=new Set<string>();
        for(let position=1;position<=6;position++){
          const relevant=rng()<.82;
          const candidates=relevant?categoryPool:pick(pool.filter(p=>p.length));
          // Skew candidate frequency toward a reproducible popular head, independently of click position bias.
          const p=candidates[Math.min(candidates.length-1,Math.floor(Math.pow(rng(),1.9)*candidates.length))];
          if(seen.has(p.id))continue;seen.add(p.id);
          const impression=emit('impression',{productId:p.id,surface:searching?'search':'catalog',position,page:'/catalog'});
          exposure.push({p,impression,position});
        }
        for(const {p,impression,position} of exposure){
          const affinity=p.category===categories[user.interest]?1:.4;
          const brandBonus=p.brand===catalog[categories.indexOf(p.category as typeof categories[number])].brands[user.brand]?1.3:1;
          const pricePenalty=1/(1+p.priceCents/(3500*user.budget));
          const clickChance=.65*affinity*brandBonus*pricePenalty/Math.pow(position,.55)+.025;
          if(rng()>clickChance)continue;
          emit('click',{productId:p.id,surface:searching?'search':'catalog',position,impressionId:impression});
          emit('product_view',{productId:p.id,page:`/products/${p.id}`,surface:'product'});
          if(rng()<user.propensity*pricePenalty+.035){
            const previous=store.cart(user.id).find(item=>item.product.id===p.id)?.quantity??0;
            const quantity=Math.min(99,previous+1);
            store.db.prepare('INSERT INTO carts VALUES(?,?,?) ON CONFLICT(shopperId,productId) DO UPDATE SET quantity=excluded.quantity').run(user.id,p.id,quantity);
            emit(previous?'cart_update':'cart_add',{productId:p.id,quantity,surface:'cart',page:'/cart'});
          }
        }
      }
      const cart=store.cart(user.id);
      if(cart.length&&rng()<user.propensity+.12){
        const oid=id('order',orderCount++),orderTime=iso(time+1000+Math.floor(rng()*15000));
        const total=cart.reduce((sum,item)=>sum+item.product.priceCents*item.quantity,0);
        store.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(oid,user.id,sid,orderTime,total,oid);
        for(const item of cart)store.db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)').run(oid,item.product.id,item.product.name,item.quantity,item.product.priceCents);
        // Purchase timestamp must exactly match its authoritative order.
        time=Date.parse(orderTime);
        store.append({schemaVersion:1,id:id('event',eventCount++),type:'purchase',occurredAt:orderTime,ingestedAt:iso(time+2000),shopperId:user.id,sessionId:sid,source:'synthetic',context:{orderId:oid}});
        store.db.prepare('DELETE FROM carts WHERE shopperId=?').run(user.id);
      }
      store.db.prepare('UPDATE sessions SET lastActiveAt=? WHERE id=?').run(iso(time),sid);
      lastActivity.set(user.id,time);
      if(user.sparse)usedSparse.add(user.id);
    }
    store.db.prepare('INSERT INTO generation_runs VALUES(?,?)').run(run,JSON.stringify({...manifest,eventCount,sessionCount,orderCount}));
  });
  return {...manifest,eventCount,sessionCount,orderCount,diagnostics:{users,unobservedProducts:products.slice(Math.floor(config.products*.95)).map(p=>p.id)}};
}
