const WebSocket = require('ws');
const assert = require('assert');
const URL = process.env.C4_URL || `ws://127.0.0.1:${process.env.C4_PORT||3014}`;

function waitFor(ws, type, timeout=15000){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const on = (msg)=>{ try{ const d = JSON.parse(msg.toString()); if(d && d.type===type){ clearTimeout(t); ws.off('message', on); resolve(d); } }catch{} };
    ws.on('message', on);
  });
}
async function open(name){
  return new Promise(r=>{
    const ws = new WebSocket(URL);
    ws.on('open',()=>{ console.log(`[test] ${name||'ws'} open`); r(ws); });
    ws.on('error',(e)=>{ console.log(`[test] ${name||'ws'} error`, e?.message||e); });
    ws.on('close',()=>{ console.log(`[test] ${name||'ws'} close`); });
    ws.on('message',(m)=>{ try{ const d=JSON.parse(m.toString()); console.log(`[test] ${name||'ws'} <-`, d.type); }catch{ console.log(`[test] ${name||'ws'} <- raw`); } });
  });
}

(async()=>{
  // 1) Create a game between Alice and Bob
  const a = await open('A');
  const b = await open('B');
  a.send(JSON.stringify({ type:'joinGame', username:'Alice', userId: 101 }));
  b.send(JSON.stringify({ type:'joinGame', username:'Bob', userId: 202 }));
  const sa = await waitFor(a,'startGame',20000);
  const sb = await waitFor(b,'startGame',20000);
  const gid = sa.gameId; assert.ok(gid, 'expected gameId');
  const tokA = sa.token; const tokB = sb.token;

  // 2) Both leave to pause
  a.send(JSON.stringify({ type:'leaveGame' }));
  b.send(JSON.stringify({ type:'leaveGame' }));
  a.close(); b.close();

  // 3) Simulate Continue from fresh clients
  const a2 = await open('A2');
  const b2 = await open('B2');
  // Alice uses token (joinSavedGame), Bob uses identity claim (claimSavedGame)
  a2.send(JSON.stringify({ type:'joinSavedGame', gameId: gid, token: tokA, username:'Alice', userId: 101 }));
  b2.send(JSON.stringify({ type:'claimSavedGame', gameId: gid, username:'Bob', userId: 202 }));

  // 4) Expect queued -> paired -> countdown -> startGame again
  const qa = await waitFor(a2,'savedQueued',5000); assert.ok(qa && qa.gameId===gid, 'Alice queued on saved');
  const qb = await waitFor(b2,'savedQueued',5000); assert.ok(qb && qb.gameId===gid, 'Bob queued on saved');

  const p1 = await waitFor(a2,'paired',5000); assert.ok(p1 && (p1.gameId===gid || p1.roomId===gid), 'paired for saved');
  const cd = await waitFor(a2,'countdown',7000); assert.strictEqual(typeof cd.value,'number');
  const rs = await waitFor(a2,'startGame',12000); assert.ok(rs && rs.gameId===gid, 'resumed startGame for saved');

  console.log('[connect4] continue flow OK -> resumed gid', gid);
  try{ a2.close(); }catch{}; try{ b2.close(); }catch{};
  process.exit(0);
})().catch(e=>{ console.error('[connect4] continue flow FAIL', e.message); process.exit(1); });
