const WebSocket = require('ws');

const URL = process.env.CHESS_URL || `ws://localhost:${process.env.CHESS_PORT||3012}`;

function waitFor(ws, type, timeout=10000){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(`Timeout waiting for ${type}`)), timeout);
    function onMsg(evt){
      try{ const data=JSON.parse(evt.data||evt); if(data && data.type===type){ clearTimeout(t); ws.off('message', onMsg); resolve(data); } }catch{}
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

  a.send(JSON.stringify({ type:'joinGame', username:'WhiteBot', stake:1 }));
  b.send(JSON.stringify({ type:'joinGame', username:'BlackBot', stake:1 }));

  // Wait for both to be paired & start
  while(true){
    const d = await Promise.race([waitFor(a,'startGame',15000), waitFor(b,'startGame',15000)]).catch(err=>{ console.error('startGame timeout', err.message); process.exit(1); });
    if(d && typeof d.playerNumber==='number'){
      if(d.playerNumber===1){
        console.log('White ready. Current turn:', d.currentColor);
      } else {
        console.log('Black ready. Current turn:', d.currentColor);
      }
      if(d.currentColor) break;
    }
  }

  // White makes e2e4: from (6,4) to (4,4)
  const move = { type:'makeMove', r:6, c:4, r2:4, c2:4 };
  a.send(JSON.stringify(move));

  // Expect gameUpdate with lastMove and currentColor 'b'
  const upd = await waitFor(a, 'gameUpdate', 10000).catch(err=>{ console.error('No gameUpdate after move:', err.message); process.exit(1); });
  console.log('Update received. lastMove:', upd.lastMove, 'currentColor:', upd.currentColor);
  if(!upd.lastMove || upd.lastMove.r!==6 || upd.lastMove.c!==4 || upd.lastMove.r2!==4 || upd.lastMove.c2!==4){
    console.error('Unexpected lastMove payload.'); process.exit(1);
  }
  if(upd.currentColor !== 'b'){
    console.error('Expected currentColor to be b after white move.'); process.exit(1);
  }
  console.log('Chess WS test passed.');
  a.close(); b.close();
  process.exit(0);
})();
