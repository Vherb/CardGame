const WebSocket = require('ws');
const URL = process.env.RAUM_URL || `ws://localhost:${process.env.RAUM_PORT||3013}`;

function waitFor(ws, type, timeout=12000){
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
  a.send(JSON.stringify({ type:'joinGame', username:'A', strict:true }));
  b.send(JSON.stringify({ type:'joinGame', username:'B', strict:true }));
  await Promise.all([waitFor(a,'startGame',20000), waitFor(b,'startGame',20000)]);
  await new Promise(r=>setTimeout(r, 800));
  const qb = waitFor(b,'quickChat',8000);
  const qa = waitFor(a,'quickChat',8000);
  a.send(JSON.stringify({ type:'quickChat', text:'Hello from A (Raum)' }));
  const got = await Promise.race([qb, qa]);
  console.log('[raum] quickChat OK ->', got.username, got.text);
  a.close(); b.close();
  process.exit(0);
})().catch(e=>{ console.error('[raum] quickChat FAIL', e.message); process.exit(1); });
