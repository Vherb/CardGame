const WebSocket = require('ws');
const URL = `ws://localhost:${process.env.CHESS_PORT||3012}`;

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
  const dbg = (tag)=> (msg)=>{ try{ const d=JSON.parse(msg.toString()); console.log(`[${tag}]`, d.type, d.text||'', d.username||'', d.from||'', d.gameId||''); }catch(e){ console.log(`[${tag}] raw`, String(msg)); } };
  a.on('message', dbg('a'));
  b.on('message', dbg('b'));
  a.send(JSON.stringify({ type:'joinGame', username:`A-${Date.now()}`, mode:'free' }));
  b.send(JSON.stringify({ type:'joinGame', username:`B-${Date.now()}`, mode:'free' }));
  const [pa,pb] = await Promise.all([waitFor(a,'paired',15000), waitFor(b,'paired',15000)]);
  if(pa.gameId !== pb.gameId) throw new Error('paired mismatch');
  await Promise.all([waitFor(a,'startGame',15000), waitFor(b,'startGame',15000)]);
  await new Promise(r=>setTimeout(r, 500));
  a.send(JSON.stringify({ type:'setUsername', username:'Alpha' }));
  await Promise.race([waitFor(a,'usernames',5000), waitFor(b,'usernames',5000)]);
  console.log('usernames broadcast OK');
  a.send(JSON.stringify({ type:'quickChat', text:'Hello from A' }));
  await Promise.race([waitFor(a,'quickChat',8000), waitFor(b,'quickChat',8000)]);
  console.log('quickChat broadcast OK');
  a.close(); b.close(); process.exit(0);
})().catch(e=>{ console.error('test-chess-broadcast FAIL', e.message); process.exit(1); });