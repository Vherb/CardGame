const { registerOrLogin, getBalance, scAdjust, waitFor, wsConnect } = require('./test-utils');

const WS_URL = process.env.CHESS_URL || `ws://localhost:${process.env.CHESS_PORT||3012}`;
const STAKE = Number(process.env.STAKE||1.5);

(async () => {
  const aUser = `chessA_${Date.now()%1e6}`;
  const bUser = `chessB_${Date.now()%1e6}`;
  const a = await registerOrLogin(aUser);
  const b = await registerOrLogin(bUser);
  await scAdjust(a.token, +100, 'seed');
  await scAdjust(b.token, +100, 'seed');

  const aBal0 = await getBalance(a.token);
  const bBal0 = await getBalance(b.token);

  const A = await wsConnect(WS_URL);
  const B = await wsConnect(WS_URL);
  // queue both with stake; stagger a bit to let server register state
  A.send(JSON.stringify({ type:'joinGame', username:a.username, userId:a.userId, pieceColor:'#22d3ee', avatar:'rocket', stake: STAKE }));
  await new Promise(r=>setTimeout(r, 60));
  B.send(JSON.stringify({ type:'joinGame', username:b.username, userId:b.userId, pieceColor:'#ef4444', avatar:'alien', stake: STAKE }));

  // pair and start
  await waitFor(A,'paired',15000); await waitFor(B,'paired',15000);
  await waitFor(A,'startGame',15000); await waitFor(B,'startGame',15000);
  // Simulate client lock on start
  await scAdjust(a.token, -STAKE, 'Chess — lock stake [smoke]');
  await scAdjust(b.token, -STAKE, 'Chess — lock stake [smoke]');

  // simulate opponent leave (no refund for saved/resume games)
  B.send(JSON.stringify({ type:'leaveGame' }));
  await waitFor(A,'playerLeft',10000).catch(()=>{});
  // No refund on disconnect — balances should remain locked

  const aBalRefund = await getBalance(a.token);
  const bBalRefund = await getBalance(b.token);
  if (Math.abs(aBalRefund - (aBal0 - STAKE)) > 0.01) throw new Error(`A should remain locked after DC: start=${aBal0} end=${aBalRefund}`);
  if (Math.abs(bBalRefund - (bBal0 - STAKE)) > 0.01) throw new Error(`B should remain locked after DC: start=${bBal0} end=${bBalRefund}`);

  try{ A.close(); }catch{}
  try{ B.close(); }catch{}
  console.log('[staking][chess] PASS lock+no-refund on disconnect');
  process.exit(0);
})().catch(e=>{ console.error('[staking][chess] FAIL', e.message); process.exit(1); });
