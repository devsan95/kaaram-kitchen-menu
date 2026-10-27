// Runs the REAL api/*.js handlers over HTTP, with an in-memory Redis that adds Upstash-like latency.
const http=require('http'),root=require('path').resolve(__dirname,'..');process.chdir(root);
const LAT=+process.env.LAT||20,kv={},hs={};let cmds=0,reqs=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function run(c){cmds++;const [op,k,...a]=c;switch(op){
 case 'GET':return kv[k]??null;case 'SET':kv[k]=a[0];return 'OK';
 case 'INCR':kv[k]=(+kv[k]||0)+1;return kv[k];case 'EXPIRE':return 1;
 case 'HLEN':return Object.keys(hs[k]||{}).length;
 case 'HSET':(hs[k]=hs[k]||{})[a[0]]=a[1];return 1;
 case 'HGET':return (hs[k]||{})[a[0]]??null;
 case 'HMGET':return a.map(f=>(hs[k]||{})[f]??null);
 case 'HGETALL':return Object.entries(hs[k]||{}).flat();
 case 'HDEL':a.forEach(f=>delete (hs[k]||{})[f]);return a.length}}
http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',async()=>{await sleep(LAT*(0.7+Math.random()*0.6));reqs++;
 const j=JSON.parse(b);r.end(JSON.stringify(q.url==='/pipeline'?j.map(c=>({result:run(c)})):{result:run(j)}))})}).listen(9931);
process.env.KAARAM_USER='owner';process.env.KAARAM_PASS='pw123';process.env.KV_REST_API_URL='http://localhost:9931';process.env.KV_REST_API_TOKEN='tok';
const routes={'/api/menu':require(root+'/api/menu'),'/api/orders':require(root+'/api/orders'),'/api/auth':require(root+'/api/auth')};
http.createServer((q,r)=>{const p=q.url.split('?')[0];if(p==='/_stats'){return r.end(JSON.stringify({cmds,reqs,open:Object.keys(hs['kaaram-orders']||{}).length}))}
 if(routes[p])return routes[p](q,r);r.statusCode=404;r.end()}).listen(9930,()=>console.log('up'));
