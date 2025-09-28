const WebSocket = require('ws');
const URL = process.env.WAR_URL || `ws://localhost:${process.env.WAR_PORT||3001}`;

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function connectWithRetry(url, retries=6, initialDelay=200){
  let attempt = 0;
  while(true){
    try{
      const ws = new WebSocket(url);
      await new Promise((resolve, reject)=>{
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      return ws;
    }catch(err){
      attempt++;
      if(attempt >= retries){ throw err; }
      const wait = Math.floor(initialDelay * Math.pow(1.6, attempt-1));
      await sleep(wait);
    }
  }
}

function waitFor(ws, type, timeout=10000){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const on = (msg)=>{ try{ const d = JSON.parse(msg.toString()); if(d && d.type===type){ clearTimeout(t); ws.off('message', on); resolve(d); } }catch{} };
    ws.on('message', on);
  });
}

(async()=>{
  const a = await connectWithRetry(URL);
  const b = await connectWithRetry(URL);
  a.send(JSON.stringify({ type:'joinGame', username:'A' }));
  b.send(JSON.stringify({ type:'joinGame', username:'B' }));
  await Promise.all([waitFor(a,'startGame',15000), waitFor(b,'startGame',15000)]);
  const qb = waitFor(b,'quickChat',5000);
  const qa = waitFor(a,'quickChat',5000);
  a.send(JSON.stringify({ type:'quickChat', text:'Hello from A (War)' }));
  const got = await Promise.race([qb, qa]);
  console.log('[war] quickChat OK ->', got.username, got.text);
  a.close(); b.close();
  process.exit(0);
})().catch(e=>{ console.error('[war] quickChat FAIL', e.message); process.exit(1); });
