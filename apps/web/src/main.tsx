import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { categories, type Product, type Shopper, type Session, type CartItem, type Order, type StoreEvent } from '@store/contracts';
import './style.css';

const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const symbols:Record<string,string>={'Electronics':'⌘','Home & Kitchen':'⌂','Personal Care':'✦','Clothing':'◈','Sports':'◎','Toys':'✳','Groceries':'❋'};
async function request<T>(path:string,session?:string,body?:unknown,method?:string):Promise<T> {
  const response=await fetch(`/api${path}`,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(session?{'x-session-id':session}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Request failed');return data;
}
type Observation=Pick<StoreEvent,'id'|'type'|'occurredAt'|'context'>;
class Telemetry {
  pending:Observation[]=[];sending=false;stopped=false;timer?:ReturnType<typeof setTimeout>;
  constructor(readonly session:Session,readonly report:(message:string)=>void){}
  record(type:Observation['type'],context:Observation['context']) {
    const event={id:crypto.randomUUID(),type,occurredAt:new Date().toISOString(),context};this.pending.push(event);void this.flush();return event.id;
  }
  async flush(){
    if(this.sending||!this.pending.length||this.stopped)return;
    this.sending=true;const batch=this.pending.slice(0,100);
    try{await request('/events',this.session.id,{events:batch});this.pending.splice(0,batch.length);}
    catch(error){this.report(`Activity recording: ${(error as Error).message}`);this.timer=setTimeout(()=>void this.flush(),5000);}
    finally{this.sending=false;if(this.pending.length&&!this.timer)void this.flush();}
  }
  close(){this.stopped=true;clearTimeout(this.timer);}
}
function ProductCard({product,position,surface,telemetry,onOpen}:{product:Product;position:number;surface:'home_trending'|'catalog'|'search';telemetry:Telemetry;onOpen:(p:Product)=>void}) {
  const ref=useRef<HTMLButtonElement>(null),exposure=useRef<string|undefined>(undefined);
  useEffect(()=>{
    exposure.current=undefined;
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting&&e.intersectionRatio>=0.5)&&!exposure.current){exposure.current=telemetry.record('impression',{productId:product.id,surface,position,page:location.hash||'#home'});}}, {threshold:0.5});
    if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();
  },[product.id,surface,position,telemetry]);
  return <button ref={ref} className="product-card" onClick={()=>{
    // A keyboard activation can occur before the observer callback; activation establishes visibility.
    exposure.current??=telemetry.record('impression',{productId:product.id,surface,position,page:location.hash||'#home'});
    telemetry.record('click',{productId:product.id,surface,position,impressionId:exposure.current});onOpen(product);
  }}><div className={`product-art art-${categories.indexOf(product.category as typeof categories[number])}`} aria-hidden="true">{symbols[product.category]}<span>{product.subcategory}</span></div><div className="product-info"><small>{product.brand} / {product.category}</small><h3>{product.name}</h3><div className="product-price">{money(product.priceCents)}<span>{product.available?'View item ↗':'Unavailable'}</span></div></div></button>;
}
function App(){
  const [identity,setIdentity]=useState<Shopper>(),[personas,setPersonas]=useState<Shopper[]>([]),[session,setSession]=useState<Session>(),[telemetry,setTelemetry]=useState<Telemetry>();
  const [page,setPage]=useState('home'),[product,setProduct]=useState<Product>(),[items,setItems]=useState<Product[]>([]),[total,setTotal]=useState(0),[catalogPage,setCatalogPage]=useState(1);
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[category,setCategory]=useState(''),[cart,setCart]=useState<CartItem[]>([]),[orders,setOrders]=useState<Order[]>([]);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const checkoutKey=useRef<string|undefined>(undefined),generation=useRef(0),telemetryRef=useRef<Telemetry|undefined>(undefined);
  async function switchIdentity(shopper:Shopper){
    setBusy(true);setError('');
    try{
      const s=await request<Session>('/sessions',undefined,{shopperId:shopper.id});
      const next=new Telemetry(s,setError);telemetryRef.current?.close();telemetryRef.current=next;
      generation.current++;setIdentity(shopper);setSession(s);setTelemetry(next);setPage('home');setProduct(undefined);setNotice('');checkoutKey.current=undefined;
      localStorage.setItem('store.active',shopper.id);next.record('session_activity',{page:'/home'});
      setCart(await request<CartItem[]>('/cart',s.id));
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  useEffect(()=>{let cancelled=false;
    void(async()=>{try{
      const demo=await request<Shopper[]>('/personas');if(cancelled)return;setPersonas(demo);
      let guest:Shopper;const stored=localStorage.getItem('store.guest');
      if(stored){guest={id:stored,name:'Guest',kind:'anonymous',createdAt:''};}
      else{guest=await request<Shopper>('/shoppers');localStorage.setItem('store.guest',guest.id);}
      const active=demo.find(p=>p.id===localStorage.getItem('store.active'))??guest;
      // A deleted local database invalidates the persisted anonymous ID.
      try{const check=await request<Session>('/sessions',undefined,{shopperId:active.id});
        if(cancelled)return;const t=new Telemetry(check,setError);telemetryRef.current=t;setIdentity(active);setSession(check);setTelemetry(t);setCart(await request('/cart',check.id));t.record('session_activity',{page:'/home'});
      }catch{guest=await request<Shopper>('/shoppers');localStorage.setItem('store.guest',guest.id);if(!cancelled)await switchIdentity(guest);}
    }catch(e){if(!cancelled)setError((e as Error).message);}})();
    return()=>{cancelled=true;telemetryRef.current?.close();};
  },[]);
  useEffect(()=>{if(!session||!telemetry)return;let cancelled=false;setItems([]);setError('');
    void(async()=>{try{
      if(page==='home'){const data=await request<Product[]>('/trending');if(!cancelled){setItems(data);setTotal(data.length);}}
      if(page==='catalog'){const data=await request<{items:Product[];total:number}>(`/products?q=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&page=${catalogPage}`);if(!cancelled){setItems(data.items);setTotal(data.total);}}
      if(page==='cart'){const data=await request<CartItem[]>('/cart',session.id);if(!cancelled)setCart(data);}
      if(page==='history'){const data=await request<Order[]>('/orders',session.id);if(!cancelled)setOrders(data);}
      if(page==='product'&&product)telemetry.record('product_view',{productId:product.id,page:`/products/${product.id}`,surface:'product'});
      telemetry.record('session_activity',{page:`/${page}`});
    }catch(e){if(!cancelled)setError((e as Error).message);}})();return()=>{cancelled=true;};
  },[page,session,telemetry,search,category,catalogPage,product]);
  async function mutate(p:Product,quantity:number){if(!session)return;setBusy(true);setError('');const version=generation.current;
    try{const result=await request<CartItem[]>(`/cart/${p.id}`,session.id,{quantity},'PUT');if(version===generation.current){setCart(result);checkoutKey.current=undefined;setNotice(quantity?`${p.name} added to your cart`:'Item removed');}}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function checkout(){if(!session)return;setBusy(true);setError('');checkoutKey.current??=crypto.randomUUID();
    try{const order=await request<Order>('/checkout',session.id,{idempotencyKey:checkoutKey.current});setCart([]);setNotice(`Order ${order.id.slice(0,8)} placed. Thanks for stopping by!`);checkoutKey.current=undefined;setPage('history');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const count=cart.reduce((s,i)=>s+i.quantity,0),subtotal=cart.reduce((s,i)=>s+i.quantity*i.product.priceCents,0);
  const navigate=(next:string)=>{setPage(next);setNotice('');window.scrollTo(0,0);};
  const open=(p:Product)=>{setProduct(p);navigate('product');};
  return <><div className="announcement">Everyday essentials. A little more considered. <span>Demo store · no real payments</span></div><header><button className="wordmark" onClick={()=>navigate('home')}>everyday<span>●</span></button><nav><button className={page==='catalog'?'selected':''} onClick={()=>navigate('catalog')}>Shop all</button><button onClick={()=>navigate('history')}>Your orders</button></nav><div className="header-actions"><label className="identity">Shopping as<select aria-label="Shopping identity" disabled={busy} value={identity?.id??''} onChange={e=>{const guest={id:localStorage.getItem('store.guest')!,name:'Guest',kind:'anonymous' as const,createdAt:''};void switchIdentity(personas.find(p=>p.id===e.target.value)??guest);}}><option value={localStorage.getItem('store.guest')??''}>Guest</option>{personas.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="cart-button" onClick={()=>navigate('cart')}>Bag <b>{count}</b></button></div></header>
    <main>{error&&<div className="alert" role="alert">{error} {error.includes('Session')&&identity&&<button onClick={()=>void switchIdentity(identity)}>Start a new session</button>}</div>}{notice&&<div className="notice" role="status">{notice}</div>}
    {!session?<div className="empty">Opening your store…</div>:<>
    {page==='home'&&<><section className="hero"><div><p className="eyebrow">THE DAILY EDIT / 01</p><h1>Little things.<br/>Better days.</h1><p>Useful finds for your home, your routine, and everything in between.</p><button className="primary" onClick={()=>navigate('catalog')}>Find your everyday ↗</button></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one">⌂</div><div className="orbit orbit-two">✦</div><div className="orbit orbit-three">◎</div><span>GOOD THINGS, EVERY DAY</span></div></section><section className="category-strip">{categories.map(c=><button key={c} onClick={()=>{setCategory(c);setCatalogPage(1);navigate('catalog');}}><span>{symbols[c]}</span>{c}</button>)}</section><div className="section-heading"><div><p className="eyebrow">A FEW FAVORITES</p><h2>The everyday edit</h2></div><p>A fixed selection of store favorites.</p></div></>}
    {page==='catalog'&&<><div className="section-heading"><div><p className="eyebrow">EXPLORE THE STORE</p><h1 className="page-title">Find something useful.</h1></div><span>{total.toLocaleString()} items</span></div><form className="filters" onSubmit={e=>{e.preventDefault();setSearch(query.trim());setCatalogPage(1);telemetry?.record('search',{query:query.trim(),surface:'search',page:'/catalog'});}}><input aria-label="Search products" placeholder="Try kettle, cotton, coffee…" value={query} onChange={e=>setQuery(e.target.value)}/><button className="primary">Search</button><select aria-label="Category" value={category} onChange={e=>{setCategory(e.target.value);setCatalogPage(1);}}><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></form></>}
    {(page==='home'||page==='catalog')&&<><div className="product-grid">{items.map((p,index)=><ProductCard key={`${session.id}-${p.id}-${catalogPage}-${search}-${category}`} product={p} position={(page==='catalog'?(catalogPage-1)*24:0)+index+1} surface={page==='home'?'home_trending':search?'search':'catalog'} telemetry={telemetry!} onOpen={open}/>)}</div>{page==='catalog'&&<div className="pagination"><button disabled={catalogPage===1} onClick={()=>setCatalogPage(p=>p-1)}>← Previous</button><span>Page {catalogPage} of {Math.max(1,Math.ceil(total/24))}</span><button disabled={catalogPage*24>=total} onClick={()=>setCatalogPage(p=>p+1)}>Next →</button></div>}{!items.length&&<p className="empty">No items to show. Try another search, or seed the catalog.</p>}</>}
    {page==='product'&&product&&<><button className="back" onClick={()=>navigate('catalog')}>← Back to shop</button><section className="product-detail"><div className={`product-art art-${categories.indexOf(product.category as typeof categories[number])}`}>{symbols[product.category]}</div><div><p className="eyebrow">{product.category} / {product.subcategory}</p><h1>{product.name}</h1><p className="brand">By {product.brand}</p><p>{product.description}</p><h2>{money(product.priceCents)}</h2><p>{product.available?'Available for your daily routine':'Currently unavailable'}</p><button className="primary" disabled={busy||!product.available} onClick={()=>void mutate(product,(cart.find(i=>i.product.id===product.id)?.quantity??0)+1)}>Add to bag</button><button className="back" onClick={()=>navigate('cart')}>View bag →</button></div></section></>}
    {page==='cart'&&<><p className="eyebrow">YOUR DAILY FINDS</p><h1 className="page-title">Shopping bag</h1>{!cart.length?<div className="empty">Your bag is waiting for something good.<br/><button className="primary" onClick={()=>navigate('catalog')}>Explore the store</button></div>:<div className="cart-layout"><div>{cart.map(item=><div className="cart-row" key={item.product.id}><div className="mini-art">{symbols[item.product.category]}</div><div><h3>{item.product.name}</h3><small>{money(item.product.priceCents)} each</small><div className="quantity"><button aria-label={`Decrease ${item.product.name}`} disabled={busy} onClick={()=>void mutate(item.product,item.quantity-1)}>−</button><span>{item.quantity}</span><button aria-label={`Increase ${item.product.name}`} disabled={busy||item.quantity>=99} onClick={()=>void mutate(item.product,item.quantity+1)}>+</button><button disabled={busy} onClick={()=>void mutate(item.product,0)}>Remove</button></div></div><b>{money(item.quantity*item.product.priceCents)}</b></div>)}</div><aside><h2>A good little haul.</h2><div className="subtotal"><span>Subtotal</span><b>{money(subtotal)}</b></div><p>This is a demo checkout. No payment or shipping details needed.</p><button className="primary" disabled={busy} onClick={()=>void checkout()}>{busy?'Working…':'Place demo order ↗'}</button></aside></div>}</>}
    {page==='history'&&<><p className="eyebrow">YOUR EVERYDAY ARCHIVE</p><h1 className="page-title">Past orders</h1>{!orders.length?<p className="empty">Your first order is still ahead.</p>:orders.map(order=><article className="order" key={order.id}><div className="section-heading"><div><h3>Order {order.id.slice(0,8)}</h3><small>{new Date(order.createdAt).toLocaleString()}</small></div><b>{money(order.totalCents)}</b></div>{order.items.map(i=><div className="order-item" key={i.productId}><span>{i.name} × {i.quantity}</span><span>{money(i.unitPriceCents*i.quantity)}</span></div>)}</article>)}</>}
    </>}</main><footer><span className="wordmark">everyday<span>●</span></span><p>A small store. A place to learn.<br/>Synthetic catalog · demo personas · fixed favorites</p><span>Made for the everyday.</span></footer></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
