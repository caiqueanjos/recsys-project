import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../../apps/store-api/src/db.js';
import { generate, defaults } from './generator.js';
const {values}=parseArgs({options:{seed:{type:'string'},products:{type:'string'},shoppers:{type:'string'},events:{type:'string'},days:{type:'string'},start:{type:'string'},db:{type:'string'},diagnostics:{type:'string',default:'data/generator-diagnostics'}}});
const config={...defaults};
for(const key of ['seed','products','shoppers','events','days'] as const)if(values[key])config[key]=Number(values[key]);
if(values.start)config.start=values.start;
const store=new Store(values.db);store.seedPersonas();
try{
  const result=generate(store,config);
  if('diagnostics' in result){mkdirSync(values.diagnostics!,{recursive:true});writeFileSync(`${values.diagnostics}/${result.run}.json`,JSON.stringify(result.diagnostics));}
  const {diagnostics,...summary}=result as typeof result & {diagnostics?:unknown};console.log(JSON.stringify(summary,null,2));
}finally{store.db.close();}
