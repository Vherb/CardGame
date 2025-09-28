const { registerOrLogin, getBalance, scAdjust, waitFor, wsConnect } = require('./test-utils');

const WS_URL = process.env.RSCH_URL || `ws://localhost:${process.env.RSCH_PORT||3013}`;
const STAKE = Number(process.env.STAKE||1.5);

(async () => {
  const aUser = `raumA_${Date.now()%1e6}`;
  const bUser = `raumB_${Date.now()%1e6}`;
  const a = await registerOrLogin(aUser);
  const b = await registerOrLogin(bUser);
  await scAdjust(a.token, +100, 'seed');
  await scAdjust(b.token, +100, 'seed');

  const aBal0 = await getBalance(a.token);
  const bBal0 = await getBalance(b.token);

  const A = await wsConnect(WS_URL);
  const B = await wsConnect(WS_URL);
  // Attach listeners before sending joinGame to avoid race on fast pair
  const pairedA = waitFor(A,'paired',15000);
  const pairedB = waitFor(B,'paired',15000);
  A.send(JSON.stringify({ type:'joinGame', username:a.username, userId:a.userId, pieceColor:'#22d3ee', avatar:'rocket', stake: STAKE }));
  await new Promise(r=>setTimeout(r, 60));
  B.send(JSON.stringify({ type:'joinGame', username:b.username, userId:b.userId, pieceColor:'#ef4444', avatar:'alien', stake: STAKE }));

  await pairedA; await pairedB;
  await waitFor(A,'startGame',20000); await waitFor(B,'startGame',20000);
  // Simulate client-side lock at game start
  await scAdjust(a.token, -STAKE, 'Raumschach — lock stake [smoke]');
  await scAdjust(b.token, -STAKE, 'Raumschach — lock stake [smoke]');

  // Opponent leaves before settle — no refund for saved/resume games
  B.send(JSON.stringify({ type:'leaveGame' }));
  await waitFor(A,'playerLeft',10000).catch(()=>{});
  const aBalRefund = await getBalance(a.token);
  const bBalRefund = await getBalance(b.token);
  if (Math.abs(aBalRefund - (aBal0 - STAKE)) > 0.01) throw new Error(`A should remain locked after DC: start=${aBal0} end=${aBalRefund}`);
  if (Math.abs(bBalRefund - (bBal0 - STAKE)) > 0.01) throw new Error(`B should remain locked after DC: start=${bBal0} end=${bBalRefund}`);

  try{ A.close(); }catch{}
  try{ B.close(); }catch{}
  console.log('[staking][raum] PASS lock+no-refund on disconnect');
  process.exit(0);
})().catch(e=>{ console.error('[staking][raum] FAIL', e.message); process.exit(1); });
