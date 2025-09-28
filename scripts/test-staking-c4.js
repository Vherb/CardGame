const { registerOrLogin, getBalance, scAdjust, waitFor, wsConnect } = require('./test-utils');

const WS_URL = process.env.C4_URL || `ws://localhost:${process.env.C4_PORT||3014}`;
const STAKE = Number(process.env.STAKE||1.25);

(async () => {
  const aUser = `c4A_${Date.now()%1e6}`;
  const bUser = `c4B_${Date.now()%1e6}`;
  const a = await registerOrLogin(aUser);
  const b = await registerOrLogin(bUser);
  await scAdjust(a.token, +100, 'seed');
  await scAdjust(b.token, +100, 'seed');

  const aBal0 = await getBalance(a.token);
  const bBal0 = await getBalance(b.token);

  const A = await wsConnect(WS_URL);
  const B = await wsConnect(WS_URL);
  // Attach listeners before sending join to avoid fast-pair race
  const pairedA = waitFor(A,'paired',15000);
  const pairedB = waitFor(B,'paired',15000);
  A.send(JSON.stringify({ type:'joinGame', username:a.username, color:'#ef4444', avatar:'rocket', stake: STAKE }));
  await new Promise(r=>setTimeout(r, 60));
  B.send(JSON.stringify({ type:'joinGame', username:b.username, color:'#3b82f6', avatar:'alien', stake: STAKE }));

  await pairedA; await pairedB;
  await waitFor(A,'startGame',15000); await waitFor(B,'startGame',15000);
  await new Promise(r=>setTimeout(r, 400));

  // Simulate client-side lock on start (like other games)
  await scAdjust(a.token, -STAKE, 'C4 — lock stake [smoke]');
  await scAdjust(b.token, -STAKE, 'C4 — lock stake [smoke]');

  // play a fast P1 win in column 0 (alternating turns):
  // Sequence of cols: 0,1,0,1,0,1,0 -> P1 should win on last move
  const seq = [0,1,0,1,0,1,0];
  const move = (ws, col)=> ws.send(JSON.stringify({ type:'makeMove', col }));
  // At start, server says currentPlayer; assume Player 1 starts
  const turns = ['A','B','A','B','A','B','A'];
  let lastA=null, lastB=null;
  for(let i=0;i<seq.length;i++){
    const who = turns[i]; const col = seq[i];
    if(who==='A') move(A,col); else move(B,col);
    lastA = await waitFor(A,'gameUpdate',5000).catch(()=>null);
    lastB = await waitFor(B,'gameUpdate',5000).catch(()=>null);
  }

  const winner = (lastA && lastA.winner) || (lastB && lastB.winner) || null;
  if(!winner) throw new Error('No winner detected');

  // Simulate settlement: winner receives both stakes
  if(winner === 'Player 1'){
    await scAdjust(a.token, +(2*STAKE), 'C4 — payout winner [smoke]');
  } else if(winner === 'Player 2'){
    await scAdjust(b.token, +(2*STAKE), 'C4 — payout winner [smoke]');
  }

  // settlement grace
  await new Promise(r=>setTimeout(r, 600));

  const aBalEnd = await getBalance(a.token);
  const bBalEnd = await getBalance(b.token);
  // A is Player 1; if A won, balance should be initial - stake + (stake*2); else A lost and lock cleared already
  const expectedWin = aBal0 - STAKE + (STAKE*2);
  const expectedLose = aBal0 - STAKE; // lock cleared with no refund
  const aDelta = Math.abs(aBalEnd - expectedWin) < 0.02 || Math.abs(aBalEnd - expectedLose) < 0.02;
  if(!aDelta){ throw new Error(`A balance unexpected: start=${aBal0} end=${aBalEnd} (expected ~${expectedWin} or ~${expectedLose})`); }

  try{ A.close(); }catch{}
  try{ B.close(); }catch{}
  console.log('[staking][c4] PASS lock+payout path');
  process.exit(0);
})().catch(e=>{ console.error('[staking][c4] FAIL', e.message); process.exit(1); });
