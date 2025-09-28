/* Simple pairing simulation for Raumschach (3013)
   Spawns two WS clients, sets identity, sends joinGame, and logs until startGame
*/
const WebSocket = require('ws');

function makeClient(label, opts){
  const url = `ws://localhost:3013`;
  const ws = new WebSocket(url);
  const state = { queued:false, paired:false, started:false };
  ws.on('open', () => {
    console.log(`[${label}] open`);
    ws.send(JSON.stringify({ type:'setUsername', username: opts.username }));
    ws.send(JSON.stringify({ type:'setAvatar', avatar: opts.avatar }));
    ws.send(JSON.stringify({ type:'setPieceColor', pieceColor: opts.pieceColor }));
    ws.send(JSON.stringify({ type:'setStake', stake: opts.stake }));
    setTimeout(()=>{
      console.log(`[${label}] sending joinGame`);
      ws.send(JSON.stringify({ type:'joinGame', username: opts.username, pieceColor: opts.pieceColor, avatar: opts.avatar, stake: opts.stake }));
    }, 100);
  });
  ws.on('message', (buf)=>{
    let msg; try{ msg=JSON.parse(buf.toString()); }catch{return;}
    if(msg.type==='queued'){ state.queued=true; console.log(`[${label}] queued`); }
    if(msg.type==='paired'){ state.paired=true; console.log(`[${label}] paired you=${msg.you} gameId=${msg.gameId}`); }
    if(msg.type==='countdown'){ console.log(`[${label}] countdown ${msg.value}`); }
    if(msg.type==='startGame'){ state.started=true; console.log(`[${label}] startGame you=${msg.playerNumber} colorNow=${msg.currentColor} gameId=${msg.gameId}`); }
    if(msg.type==='update'){ /* ignore */ }
  });
  ws.on('close', ()=> console.log(`[${label}] close`));
  ws.on('error', (e)=> console.log(`[${label}] error`, e.message));
  return ws;
}

(async function run(){
  const a = makeClient('A', { username:'Alpha', avatar:'rocket', pieceColor:'#22D3EE', stake:0 });
  const b = makeClient('B', { username:'Beta', avatar:'alien', pieceColor:'#EF4444', stake:0 });
  // exit after both received start
  let aStarted=false, bStarted=false;
  const origA = a.listeners('message')[0];
  const origB = b.listeners('message')[0];
  a.removeAllListeners('message');
  b.removeAllListeners('message');
  a.on('message', (buf)=>{ origA(buf); try{ const m=JSON.parse(buf.toString()); if(m.type==='startGame'){ aStarted=true; if(aStarted&&bStarted){ console.log('Both started. Success.'); try{a.close();}catch{} try{b.close();}catch{} process.exit(0); } } }catch{} });
  b.on('message', (buf)=>{ origB(buf); try{ const m=JSON.parse(buf.toString()); if(m.type==='startGame'){ bStarted=true; if(aStarted&&bStarted){ console.log('Both started. Success.'); try{a.close();}catch{} try{b.close();}catch{} process.exit(0); } } }catch{} });
  const start = Date.now();
  const timer = setInterval(()=>{
    if(Date.now()-start>15000){ console.log('Timeout after 15s'); try{a.close();}catch{} try{b.close();}catch{} clearInterval(timer); process.exit(1); }
  }, 500);
})();
