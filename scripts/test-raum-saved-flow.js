/*
 Simulate Raumschach saved-game flow (port 3013):
 1) Two players join and start a game
 2) Both leave to pause and persist the room
 3) Both reconnect via claimSavedGame and resume (countdown -> start)
*/
const WebSocket = require('ws');

const URL = process.env.RSCH_URL || `ws://localhost:${process.env.RSCH_PORT||3013}`;
const P1 = { username: process.env.P1 || 'Alpha', avatar:'rocket', pieceColor:'#22D3EE', stake:0 };
const P2 = { username: process.env.P2 || 'Beta',  avatar:'alien', pieceColor:'#EF4444', stake:0 };

function openClient(label){
  const ws = new WebSocket(URL);
  ws.label = label;
  return new Promise((resolve)=> ws.on('open', ()=> resolve(ws)));
}

function sendJson(ws, obj){ try{ ws.send(JSON.stringify(obj)); }catch(e){}}

function waitFor(ws, type, timeout=15000){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>{ ws.off('message', onMsg); reject(new Error(`${ws.label||'client'} timeout waiting for ${type}`)); }, timeout);
    function onMsg(buf){
      try{ const d = JSON.parse(buf.toString()); if(d && d.type === type){ clearTimeout(t); ws.off('message', onMsg); resolve(d); } }catch{}
    }
    ws.on('message', onMsg);
  });
}

(async function run(){
  console.log('Opening two clients to', URL);
  const [a, b] = await Promise.all([openClient('A'), openClient('B')]);
  // Identity
  sendJson(a, { type:'setUsername', username: P1.username });
  sendJson(a, { type:'setAvatar', avatar: P1.avatar });
  sendJson(a, { type:'setPieceColor', pieceColor: P1.pieceColor });
  sendJson(a, { type:'setStake', stake: P1.stake });
  sendJson(b, { type:'setUsername', username: P2.username });
  sendJson(b, { type:'setAvatar', avatar: P2.avatar });
  sendJson(b, { type:'setPieceColor', pieceColor: P2.pieceColor });
  sendJson(b, { type:'setStake', stake: P2.stake });
  // Join matchmaking
  setTimeout(()=>{ sendJson(a, { type:'joinGame', username:P1.username, pieceColor:P1.pieceColor, avatar:P1.avatar, stake:P1.stake }); }, 50);
  setTimeout(()=>{ sendJson(b, { type:'joinGame', username:P2.username, pieceColor:P2.pieceColor, avatar:P2.avatar, stake:P2.stake }); }, 60);

  console.log('Waiting for startGame on both clients...');
  const [sa, sb] = await Promise.all([ waitFor(a,'startGame',20000), waitFor(b,'startGame',20000) ]);
  const gameId = sa.gameId || sb.gameId;
  console.log('Started gameId', gameId, 'A you=', sa.playerNumber, 'B you=', sb.playerNumber);

  // Leave to pause
  console.log('Both leaving to pause room...');
  sendJson(a, { type:'leave' });
  sendJson(b, { type:'leave' });
  await new Promise(res=> setTimeout(res, 500));
  try{ a.close(); }catch{}
  try{ b.close(); }catch{}

  // Reconnect both via claimSavedGame
  console.log('Reconnecting both via claimSavedGame...');
  const [a2, b2] = await Promise.all([openClient('A2'), openClient('B2')]);
  // Verbose logging for diagnostics
  for(const [label, ws] of [["A2",a2],["B2",b2]]){
    ws.on('message', (buf)=>{ try{ const d=JSON.parse(buf.toString()); console.log(label,'<-', d.type, d); }catch{ console.log(label,'<- raw', String(buf)); } });
  }
  sendJson(a2, { type:'claimSavedGame', gameId, username: P1.username });
  sendJson(b2, { type:'claimSavedGame', gameId, username: P2.username });
  // Expect savedQueued -> paired/countdown -> startGame; we just wait for startGame
  const [sa2, sb2] = await Promise.all([ waitFor(a2,'startGame',20000), waitFor(b2,'startGame',20000) ]);
  console.log('Resumed. A2 you=', sa2.playerNumber, 'B2 you=', sb2.playerNumber, 'currentColor=', sa2.currentColor || sb2.currentColor);
  try{ a2.close(); }catch{}
  try{ b2.close(); }catch{}
  console.log('Success.');
  process.exit(0);
})().catch(err=>{ console.error('Test failed:', err.message); process.exit(1); });
