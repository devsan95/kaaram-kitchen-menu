const B='http://localhost:9930',AUTH='Basic '+Buffer.from('owner:pw123').toString('base64');
const {performance}=require('perf_hooks');
const pct=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.floor(a.length*p))]};
const order=(i)=>({table:String(1+i%20),lines:[{id:'cdb',name:'Hyderabadi Chicken Dum Biryani',qty:1+i%3,unit:420,opt:'Spice: Medium',note:'',v:false},{id:'idli',name:'Idli Sambar (3 pcs)',qty:1,unit:110,opt:'',note:'',v:true}],note:'',total:640,eta:30});
async function timed(fn){const t=performance.now();let ok=false,st=0,bytes=0;try{const r=await fn();st=r.status;const b=await r.text();bytes=b.length;ok=r.ok}catch(e){}return {ms:performance.now()-t,ok,st,bytes}}
async function pool(n,conc,mk){const res=[];let i=0;const t0=performance.now();await Promise.all(Array.from({length:conc},async()=>{while(i<n){const k=i++;res.push(await timed(()=>mk(k)))}}));const dur=(performance.now()-t0)/1000;
 const ms=res.map(r=>r.ms),errs=res.filter(r=>!r.ok);const codes={};errs.forEach(r=>codes[r.st||'net']=(codes[r.st||'net']||0)+1);
 return {n,conc,rps:+(n/dur).toFixed(0),p50:+pct(ms,.5).toFixed(0),p95:+pct(ms,.95).toFixed(0),p99:+pct(ms,.99).toFixed(0),max:+Math.max(...ms).toFixed(0),errors:errs.length,codes,avgKB:+(res.reduce((s,r)=>s+r.bytes,0)/res.length/1024).toFixed(1)}}
const post=k=>fetch(B+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json','x-forwarded-for':'10.0.'+(k%250)+'.'+Math.floor(k/250%250)},body:JSON.stringify(order(k))});
(async()=>{
 const row=(n,r)=>console.log(n.padEnd(34),JSON.stringify(r));
 const stats=async()=>(await fetch(B+'/_stats')).json();
 console.log('--- A. Burst: place orders (unique IPs)');
 for(const c of [10,50,200])row('POST /api/orders c='+c,await pool(150,c,post));
 console.log('--- B. Rate limiter: one IP, 100 requests');
 row('POST same IP c=20',await pool(100,20,k=>fetch(B+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json','x-forwarded-for':'9.9.9.9'},body:JSON.stringify(order(k))})));
 console.log('--- C. Guest status polls (3 tickets each)');
 for(const c of [50,200,500])row('GET ?nos= c='+c,await pool(2000,c,()=>fetch(B+'/api/orders?nos=KK-2417,KK-2418,KK-2419')));
 console.log('--- D. Kitchen full-feed poll vs open tickets');
 let st=await stats();
 for(const target of [30,100,300,500]){let n=0;while(st.open<target&&n++<40){await pool(100,25,x=>post(200000+st.open*500+x));st=await stats()}
  row('GET /api/orders open='+st.open,await pool(200,5,()=>fetch(B+'/api/orders',{headers:{Authorization:AUTH}})))}
 console.log('--- E. Bump (PATCH)');
 row('PATCH ticket c=20',await pool(400,20,k=>fetch(B+'/api/orders',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:AUTH},body:JSON.stringify({no:'KK-'+(2417+k%100),st:1+k%3})})));
 console.log('--- F. Menu read (guests opening the page)');
 row('GET /api/menu c=100',await pool(2000,100,()=>fetch(B+'/api/menu')));
 console.log('--- G. Realistic 60 s service: 25 tables, 2 tablets, polls every 3 s, an order per table every ~25 s');
 const before=await stats(),lat={order:[],gpoll:[],kpoll:[],bump:[]},errs={n:0};const T0=performance.now();let nos=[];
 const until=()=>performance.now()-T0<60000,sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const rec=async(k,fn)=>{const r=await timed(fn);lat[k].push(r.ms);if(!r.ok)errs.n++;return r};
 const tables=Array.from({length:25},async(_,t)=>{const mine=[];await sleep(Math.random()*3000);let nextOrder=Math.random()*25000+T0;
  while(until()){if(performance.now()>=nextOrder-0&&performance.now()-T0>=0&&performance.now()>nextOrder){const r=await fetch(B+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json','x-forwarded-for':'172.16.0.'+t},body:JSON.stringify(order(t))});const j=await r.json();if(j.no)mine.push(j.no);nextOrder=performance.now()+20000+Math.random()*10000}
   if(mine.length)await rec('gpoll',()=>fetch(B+'/api/orders?nos='+mine.slice(-3).join(',')));await sleep(3000)}});
 const tablets=[0,1].map(async()=>{while(until()){await rec('kpoll',()=>fetch(B+'/api/orders',{headers:{Authorization:AUTH}}));await sleep(3000)}});
 const cook=(async()=>{let k=0;while(until()){await sleep(1500);const r=await (await fetch(B+'/api/orders',{headers:{Authorization:AUTH}})).json();const t=r.find(x=>x.st<3);if(t)await rec('bump',()=>fetch(B+'/api/orders',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:AUTH},body:JSON.stringify({no:t.no,st:t.st+1})}))}})();
 await Promise.all([...tables,...tablets,cook]);
 const after=await stats(),secs=60;
 for(const k of Object.keys(lat))if(lat[k].length)console.log(k.padEnd(8),'n='+lat[k].length,'p50',pct(lat[k],.5).toFixed(0)+'ms','p95',pct(lat[k],.95).toFixed(0)+'ms','max',Math.max(...lat[k]).toFixed(0)+'ms');
 console.log('errors',errs.n,'| Redis commands in 60 s:',after.cmds-before.cmds,'(~'+((after.cmds-before.cmds)/secs).toFixed(1)+'/s)');
 process.exit();
})();
