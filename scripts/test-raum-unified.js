/* Pairing simulation against unified server /ws/raum (API_PORT 3002)
   Spawns two WS clients and waits for both to receive startGame */
const WebSocket = require('ws');

function makeClient(label, url, opts){
  const ws = new WebSocket(url);
  ws.on('open', () => {
    console.log(`[${label}] open -> ${url}`);
    try { ws.send(JSON.stringify({ type:'setUsername', username: opts.username })); } catch {}
    try { ws.send(JSON.stringify({ type:'setAvatar', avatar: opts.avatar })); } catch {}
    try { ws.send(JSON.stringify({ type:'setPieceColor', pieceColor: opts.pieceColor })); } catch {}
    try { ws.send(JSON.stringify({ type:'setStake', stake: opts.stake })); } catch {}
    setTimeout(()=>{
      console.log(`[${label}] sending joinGame`);
      try { ws.send(JSON.stringify({ type:'joinGame', username: opts.username, pieceColor: opts.pieceColor, avatar: opts.avatar, stake: opts.stake })); } catch {}
    }, 100);
  });
  return ws;
}

(async function run(){
  const proto = process.env.PROTO || 'ws';
  const host = process.env.HOST || 'localhost';
  const port = process.env.PORT || '3002';
  const url = `${proto}://${host}:${port}/ws/raum`;

  const a = makeClient('A', url, { username:'Alpha', avatar:'rocket', pieceColor:'#22D3EE', stake:0 });
  const b = makeClient('B', url, { username:'Beta', avatar:'alien', pieceColor:'#EF4444', stake:0 });

  let aStarted=false, bStarted=false;
  const onMsg = (label) => (buf)=>{
    let msg; try{ msg=JSON.parse(buf.toString()); }catch{ msg=null; }
    if(msg && msg.type){
      console.log(`[${label}] ${msg.type}`);
      if(msg.type==='startGame'){
        if(label==='A') aStarted=true; else bStarted=true;
        if(aStarted && bStarted){
          console.log('Both started. Success.');
          try{ a.close(); }catch{}
          try{ b.close(); }catch{}
          process.exit(0);
        }
      }
    }
  };
  a.on('message', onMsg('A'));
  b.on('message', onMsg('B'));

  const start = Date.now();
  const timer = setInterval(()=>{
    if(Date.now()-start>15000){ console.log('Timeout after 15s'); try{a.terminate();}catch{} try{b.terminate();}catch{} clearInterval(timer); process.exit(1); }
  }, 500);
})();
