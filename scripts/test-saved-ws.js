const WebSocket = require('ws');

const URL = process.env.CHESS_URL || `ws://localhost:${process.env.CHESS_PORT||3012}`;
const GAME_ID = Number(process.env.GAME_ID || 7);
const P1_NAME = process.env.P1 || 'vherb';
const P2_NAME = process.env.P2 || '1234';

function waitFor(ws, type, timeout=15000){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(`Timeout waiting for ${type}`)), timeout);
    function onMsg(data){
      try{ const d = JSON.parse(typeof data === 'string' ? data : data.toString()); if(d && d.type===type){ clearTimeout(t); ws.off('message', onMsg); resolve(d); } }catch{}
    }
    ws.on('message', onMsg);
  });
}

(async()=>{
  const a = new WebSocket(URL);
  const b = new WebSocket(URL);

  await Promise.all([
    new Promise(res=>a.on('open',res)),
    new Promise(res=>b.on('open',res))
  ]);
  console.log('Both sockets opened to', URL);

  // Claim saved room by username
  a.send(JSON.stringify({ type:'claimSavedGame', gameId: GAME_ID, username: P1_NAME }));
  b.send(JSON.stringify({ type:'claimSavedGame', gameId: GAME_ID, username: P2_NAME }));

  // Expect savedQueued then paired/countdown/startGame
  for(const [label, ws] of [['A',a],['B',b]]){
    ws.on('message', (msg)=>{
      try{ const d=JSON.parse(typeof msg==='string'?msg:msg.toString());
        console.log(label,'<-', d.type, d);
      }catch{ console.log(label,'<- raw', String(msg)); }
    });
  }

  // Wait for both startGame messages
  try{
    const [sa, sb] = await Promise.all([
      waitFor(a,'startGame',20000),
      waitFor(b,'startGame',20000)
    ]);
    console.log('Start received: A you=', sa.playerNumber===2?'Black':'White', 'B you=', sb.playerNumber===2?'Black':'White');
    console.log('Current color at start:', sa.currentColor || sb.currentColor);
    a.close(); b.close();
    process.exit(0);
  }catch(err){
    console.error('Did not receive startGame on both clients:', err.message);
    setTimeout(()=>{ a.close(); b.close(); process.exit(1); }, 500);
  }
})();
