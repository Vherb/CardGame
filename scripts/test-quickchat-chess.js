const WebSocket = require('ws');
const URL = process.env.CHESS_URL || `ws://localhost:${process.env.CHESS_PORT||3012}`;

function waitFor(ws, type, timeout=10000){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const on = (msg)=>{ try{ const d = JSON.parse(msg.toString()); if(d && d.type===type){ clearTimeout(t); ws.off('message', on); resolve(d); } }catch{} };
    ws.on('message', on);
  });
}

(async()=>{
  let attempt=0;
  while(attempt<3){
    attempt++;
    const a = new WebSocket(URL);
    const b = new WebSocket(URL);
    await Promise.all([ new Promise(r=>a.on('open',r)), new Promise(r=>b.on('open',r)) ]);
    const dbg = (tag)=> (msg)=>{ try{ const d=JSON.parse(msg.toString()); console.log(`[${tag}]`, d.type, d.got||'', d.text||'', d.gameId||''); }catch(e){ console.log(`[${tag}] raw`, String(msg)); } };
    a.on('message', dbg('a'));
    b.on('message', dbg('b'));
    a.send(JSON.stringify({ type:'joinGame', username:`A-${Date.now()}`, stake:1, mode:'free' }));
    b.send(JSON.stringify({ type:'joinGame', username:`B-${Date.now()}`, stake:1, mode:'free' }));
    // Get paired info which includes gameId
    const pA = waitFor(a,'paired',15000);
    const pB = waitFor(b,'paired',15000);
    let pa, pb;
    try{ [pa,pb] = await Promise.all([pA,pB]); }catch(e){ try{a.close();}catch{} try{b.close();}catch{} if(attempt>=3) throw e; else { console.log('[chess] retrying pair (no paired)'); continue; } }
    if(!pa || !pb || pa.gameId!==pb.gameId){
      try{a.close();}catch{} try{b.close();}catch{} if(attempt>=3) throw new Error('paired gameId mismatch'); else { console.log('[chess] retrying pair (mismatch)'); continue; }
    }
  // Wait for startGame for both then small delay to avoid races
  await Promise.all([waitFor(a,'startGame',15000), waitFor(b,'startGame',15000)]);
  await new Promise(r=>setTimeout(r, 800));
  const qb = waitFor(b,'quickChat',18000);
  const qa = waitFor(a,'quickChat',18000);
    a.send(JSON.stringify({ type:'quickChat', text:'Hello from A' }));
    const got = await Promise.race([qb, qa]);
    console.log('[chess] quickChat OK ->', got.username, got.text);
    a.close(); b.close();
    process.exit(0);
  }
  throw new Error('Failed to pair');
})().catch(e=>{ console.error('[chess] quickChat FAIL', e.message); process.exit(1); });
