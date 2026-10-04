import { buildServer } from './server.js';
const app = buildServer();
await app.listen({port:Number(process.env.PORT ?? 3001),host:'127.0.0.1'});
console.log('Store API listening on http://127.0.0.1:3001');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();process.exit(0);});
