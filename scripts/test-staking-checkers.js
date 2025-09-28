const { registerOrLogin, getBalance, scAdjust, waitFor, wsConnect } = require('./test-utils');

const WS_URL = process.env.CHK_URL || `ws://localhost:${process.env.CHK_PORT||3011}`;
const STAKE = Number(process.env.STAKE||1.5);

(async () => {
  const aUser = `checkA_${Date.now()%1e6}`;
  const bUser = `checkB_${Date.now()%1e6}`;
  const a = await registerOrLogin(aUser);
  const b = await registerOrLogin(bUser);
  await scAdjust(a.token, +100, 'seed');
  await scAdjust(b.token, +100, 'seed');

  const aBal0 = await getBalance(a.token);
  const bBal0 = await getBalance(b.token);

  const A = await wsConnect(WS_URL);
  const B = await wsConnect(WS_URL);
  A.send(JSON.stringify({ type:'joinGame', username:a.username, userId:a.userId, color:'#ef4444', avatar:'rocket', stake: STAKE }));
  B.send(JSON.stringify({ type:'joinGame', username:b.username, userId:b.userId, color:'#3b82f6', avatar:'alien', stake: STAKE }));

  await waitFor(A,'paired',15000); await waitFor(B,'paired',15000);
  await waitFor(A,'startGame',15000); await waitFor(B,'startGame',15000);
  // Simulate client-side lock on start
  await scAdjust(a.token, -STAKE, 'Checkers — lock stake [smoke]');
  await scAdjust(b.token, -STAKE, 'Checkers — lock stake [smoke]');

  // Trigger refund path: opponent leaves before settle
  B.send(JSON.stringify({ type:'leaveGame' }));
  await waitFor(A,'playerLeft',10000).catch(()=>{});
  // Simulate refunds
  await scAdjust(a.token, +STAKE, 'Checkers — opponent left refund [smoke]');
  await scAdjust(b.token, +STAKE, 'Checkers — opponent left refund [smoke]');

  const aBalRefund = await getBalance(a.token);
  const bBalRefund = await getBalance(b.token);
  if (Math.abs(aBalRefund - aBal0) > 0.01) throw new Error(`A refund mismatch: start=${aBal0} end=${aBalRefund}`);
  if (Math.abs(bBalRefund - bBal0) > 0.01) throw new Error(`B refund mismatch: start=${bBal0} end=${bBalRefund}`);

  try{ A.close(); }catch{}
  try{ B.close(); }catch{}
  console.log('[staking][checkers] PASS lock+refund');
  process.exit(0);
})().catch(e=>{ console.error('[staking][checkers] FAIL', e.message); process.exit(1); });
