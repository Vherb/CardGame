const WebSocket = require('ws');
const URL = process.env.C4_URL || `ws://localhost:${process.env.C4_PORT||3014}`;

function waitFor(ws, type, timeout=10000){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const on = (msg)=>{ try{ const d = JSON.parse(msg.toString()); if(d && d.type===type){ clearTimeout(t); ws.off('message', on); resolve(d); } }catch{} };
    ws.on('message', on);
  });
}

(async()=>{
  const a = new WebSocket(URL);
  const b = new WebSocket(URL);
  await Promise.all([ new Promise(r=>a.on('open',r)), new Promise(r=>b.on('open',r)) ]);
  a.send(JSON.stringify({ type:'joinGame', username:'A' }));
  b.send(JSON.stringify({ type:'joinGame', username:'B' }));
  await Promise.all([waitFor(a,'startGame',15000), waitFor(b,'startGame',15000)]);
  const qb = waitFor(b,'quickChat',5000);
  const qa = waitFor(a,'quickChat',5000);
  a.send(JSON.stringify({ type:'quickChat', text:'Hello from A (C4)' }));
  const got = await Promise.race([qb, qa]);
  console.log('[connect4] quickChat OK ->', got.username, got.text);
  a.close(); b.close();
  process.exit(0);
})().catch(e=>{ console.error('[connect4] quickChat FAIL', e.message); process.exit(1); });
