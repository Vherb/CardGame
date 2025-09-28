const WebSocket = require('ws');
const assert = require('assert');
const URL = process.env.C4_URL || `ws://127.0.0.1:${process.env.C4_PORT||3014}`;

function waitFor(ws, type, timeout=10000){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const on = (msg)=>{ try{ const d = JSON.parse(msg.toString()); if(d && d.type===type){ clearTimeout(t); ws.off('message', on); resolve(d); } }catch{} };
    ws.on('message', on);
  });
}
async function open(){ return new Promise(r=>{ const ws = new WebSocket(URL); ws.on('open',()=>r(ws)); }); }

(async()=>{
  // Step 1: create a saved game by pairing A and B, then have A leave
  const a = await open();
  const b = await open();
  a.send(JSON.stringify({ type:'joinGame', username:'Alice', userId: 101 }));
  b.send(JSON.stringify({ type:'joinGame', username:'Bob', userId: 202 }));
  const sa = await waitFor(a,'startGame',15000);
  const sb = await waitFor(b,'startGame',15000);
  assert.ok(sa.gameId && sb.gameId, 'startGame should include gameId');
  const gid = sa.gameId;
  // Make a move to ensure persisted state
  if(sa.playerNumber===1){ a.send(JSON.stringify({ type:'makeMove', col: 3 })); } else { b.send(JSON.stringify({ type:'makeMove', col: 3 })); }
  // A leaves; room becomes paused/saved
  a.send(JSON.stringify({ type:'leaveGame' }));
  a.close();

  // Step 2: new client C fetches saved list for Alice
  const c = await open();
  c.send(JSON.stringify({ type:'listMySavedGames', username:'Alice', userId: 101 }));
  const list = await waitFor(c,'mySavedGames',5000);
  assert.ok(Array.isArray(list.list) && list.list.some(x=>x.gameId===gid), 'saved list should contain the paused game');

  // Step 3: Opening a fresh joinGame should create a new game, not auto-resume
  // Pair Alice with a new opponent so the game actually starts
  const d = await open();
  const e = await open();
  d.send(JSON.stringify({ type:'joinGame', username:'Alice', userId: 101 }));
  e.send(JSON.stringify({ type:'joinGame', username:'Eve', userId: 303 }));
  const sd = await waitFor(d,'startGame',20000);
  assert.ok(sd.gameId && sd.gameId !== gid, 'joinGame should start a new game, not resume saved one');
  console.log('[connect4] saved flow OK -> saved gid', gid, 'new gid', sd.gameId);

  // Cleanup
  try{ b.close(); }catch{}
  try{ c.close(); }catch{}
  try{ d.close(); }catch{}
  try{ e.close(); }catch{}
  process.exit(0);
})().catch(e=>{ console.error('[connect4] saved flow FAIL', e.message); process.exit(1); });
