/**
 * Roll of Cards Monte Carlo Simulator (standalone Node script)
 * Mirrors the current game logic in src/components/games/RollofCards/Game.js
 * No side bets modeled (SC pool tickets) since they transfer value among players.
 */

// ---- Current game constants (keep in sync with Game.js) ----
const JACKPOT_EXACT_PROFIT = 2.0;             // sum == a + b
const JACKPOT_ACE_SNAKE_PROFIT = 5.0;         // one Ace + snake eyes
const JACKPOT_DOUBLE_ACE_SNAKE_PROFIT = 10.0; // double Ace + snake eyes
// Engagement-balanced defaults (can be tuned)
const HOUSE_EDGE = 0.99;                       // High-Engage: ~1.0% rake on profit
const BETWEEN_BASE = 0.16;                     // Target ~8% edge

// Streak behavior
const MULTIPLIER_MIN = 1.16; // High-Engage floor
const MULTIPLIER_MAX = 100.0;
const bumpOnNormalWin = (m) => clamp(round2(m + 0.12), MULTIPLIER_MIN, MULTIPLIER_MAX);
const bumpOnJackpotWin = (m) => clamp(round2(m + 0.50), MULTIPLIER_MIN, MULTIPLIER_MAX);
const resetOnLoss      = (m) => clamp(round2(m - 0.148), MULTIPLIER_MIN, MULTIPLIER_MAX); // tuned for ~8%
const bumpOnTie        = (m) => clamp(round2(m + 0.045), MULTIPLIER_MIN, MULTIPLIER_MAX); // slightly stronger tie bump

function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function round2(n){ return Math.round(n*100)/100; }

// Spread bonus: rewards tighter spreads on BETWEEN wins
function spreadBonus(lo, hi){
  const w = Math.max(0, hi - lo - 1);
  const tight = 1 - (w/9);
  return clamp(1 + 0.30 * tight, 1, 1.45); // same cap
}

// Build a deck-number array with mapping Ace=1, J/Q/K=10
function buildDeckNumbers(){
  const nums = [];
  const ranks = [1,2,3,4,5,6,7,8,9,10,'J','Q','K'];
  for(let s=0;s<4;s++){
    for(const r of ranks){
      if(r === 1) nums.push(1);
      else if (typeof r === 'string') nums.push(10);
      else nums.push(r);
    }
  }
  return nums; // length 52
}

const DECK_NUMS = buildDeckNumbers();

function drawCardNumber(){
  const i = Math.floor(Math.random()*DECK_NUMS.length);
  return DECK_NUMS[i];
}

function rollDie(){ return 1 + Math.floor(Math.random()*6); }

function settleRound({ bet, streak }){
  // Draw cards (independent samples with replacement like in UI)
  const a = drawCardNumber();
  const b = drawCardNumber();
  const lo = Math.min(a,b);
  const hi = Math.max(a,b);
  const d1 = rollDie();
  const d2 = rollDie();
  const sum = d1 + d2;

  let delta = -bet; // stake is deducted upfront (player perspective)
  let rakeCollected = 0; // track house rake on profits
  let nextStreak = streak;
  let outcome = 'loss';

  async function payJackpot(profitFactor){
    const mainProfitRaw = bet * profitFactor * streak; // profit only
    const mainProfit = mainProfitRaw * HOUSE_EDGE;
    rakeCollected += (mainProfitRaw - mainProfit);
    delta += bet + mainProfit; // return stake + profit
  }

  if (a === 1 && b === 1 && d1 === 1 && d2 === 1) {
    payJackpot(JACKPOT_DOUBLE_ACE_SNAKE_PROFIT);
    nextStreak = bumpOnJackpotWin(streak);
    outcome = 'jackpot-double-ace-snake';
  } else if (sum === a + b) {
    payJackpot(JACKPOT_EXACT_PROFIT);
    nextStreak = bumpOnNormalWin(streak >= MULTIPLIER_MIN+0.4 ? streak : streak); // jackpots use normal bump in UI except +0.5 on some
    outcome = 'jackpot-exact';
  } else if ((a === 1 || b === 1) && d1 === 1 && d2 === 1) {
    payJackpot(JACKPOT_ACE_SNAKE_PROFIT);
    nextStreak = bumpOnJackpotWin(streak);
    outcome = 'jackpot-ace-snake';
  } else if (sum > lo && sum < hi) {
    const B = spreadBonus(lo, hi);
    const rawProfit = bet * Math.max(0, (streak - 1) + BETWEEN_BASE) * B;
    const totalProfit = rawProfit * HOUSE_EDGE;
    rakeCollected += (rawProfit - totalProfit);
    delta += bet + totalProfit; // stake back + profit
    nextStreak = bumpOnNormalWin(streak);
    outcome = 'between';
  } else if (sum === a || sum === b) {
    delta += bet; // tie returns stake
    nextStreak = bumpOnTie(streak);
    outcome = 'tie';
  } else {
    // loss: stake already deducted
    nextStreak = resetOnLoss(streak);
  }

  return { delta, nextStreak, a, b, d1, d2, outcome, rakeCollected };
}

function sampleBet(bankroll, prevBet, lastOutcome, maxFrac){
  // "Normal" varying bets: favor small chips and occasionally step up/down after win/loss
  const tiers = [1,5,10,25,50];
  let base;
  const r = Math.random();
  if (r < 0.40) base = 1 + 4*Math.random();      // 40%: 1–5
  else if (r < 0.75) base = 5 + 20*Math.random(); // 35%: 5–25
  else if (r < 0.93) base = 10 + 40*Math.random();// 18%: 10–50
  else base = 25 + 75*Math.random();              // 7%: 25–100

  // Slight momentum: after a win, 20% chance to step up; after a loss, 20% chance to step down
  let bet = base;
  if (lastOutcome === 'between' || lastOutcome.startsWith?.('jackpot')) {
    if (Math.random() < 0.2) bet *= 1.5;
  } else if (lastOutcome === 'loss') {
    if (Math.random() < 0.2) bet *= 0.7;
  }

  // Clamp to bankroll and a sane min; also cap by a fraction of bankroll to extend sessions
  const cap = Math.max(1, Math.floor(bankroll * (maxFrac || 1.0)));
  bet = Math.max(1, Math.min(bet, bankroll, cap));
  // Snap to nearest chip tier roughly
  const nearest = tiers.reduce((best, t) => Math.abs(t-bet) < Math.abs(best-bet) ? t : best, tiers[0]);
  // Allow some jitter around the tier
  bet = Math.max(1, Math.min(bankroll, Math.round( (nearest + (Math.random()-0.5)*nearest*0.2) )));
  return bet;
}

function runTrial({ rounds = 5000, startBankroll = 100, variableBets = true, maxBetFrac = 1.0 }){
  let bankroll = startBankroll;
  let totalStaked = 0;
  let net = 0;
  let streak = MULTIPLIER_MIN;
  let lastOutcome = 'loss';
  let wins=0, losses=0, ties=0, jackpots=0;
  let roundsPlayed = 0;
  let rakeTotal = 0;

  for (let i=0;i<rounds;i++){
    if (bankroll <= 0.99) break; // busted or too low to meaningfully bet
  const bet = variableBets ? sampleBet(bankroll, i?undefined:undefined, lastOutcome, maxBetFrac) : Math.min(5, Math.max(1, Math.floor(bankroll * maxBetFrac)));
    totalStaked += bet;
    const { delta, nextStreak, outcome, rakeCollected } = settleRound({ bet, streak });
    bankroll += delta;
    net += delta;
    rakeTotal += rakeCollected;
    streak = nextStreak;
    lastOutcome = outcome;
    if(outcome==='between') wins++; else if (outcome==='tie') ties++; else if (outcome==='loss') losses++; else jackpots++;
    roundsPlayed = i+1;
  }
  // House revenue this trial = -net (player loss) = rakeTotal + other (lost stakes - payouts)
  const houseRevenue = -net;
  const otherHouseRev = houseRevenue - rakeTotal;
  return { endBankroll: bankroll, net, totalStaked, streak, wins, losses, ties, jackpots, roundsPlayed, rakeTotal, houseRevenue, otherHouseRev };
}

function runSim({ trials=50, rounds=5000, startBankroll=100, variableBets=true, maxBetFrac=1.0 }){
  const results = [];
  for(let t=0;t<trials;t++){
    results.push(runTrial({ rounds, startBankroll, variableBets, maxBetFrac }));
  }
  const sum = (k) => results.reduce((a,r)=>a+r[k],0);
  const meanEnd = sum('endBankroll')/results.length;
  const meanNet = sum('net')/results.length;
  const meanStaked = sum('totalStaked')/results.length;
  const meanRake = sum('rakeTotal')/results.length;
  const meanHouse = sum('houseRevenue')/results.length; // should be -meanNet
  const meanOther = sum('otherHouseRev')/results.length;
  const roi = meanNet / (meanStaked || 1); // per staked unit
  const houseEdge = -roi; // house edge ~ -player ROI
  const bustRate = results.filter(r=>r.endBankroll < 1).length / results.length;
  const meanRounds = sum('roundsPlayed')/results.length;

  const sortEnd = results.map(r=>r.endBankroll).sort((a,b)=>a-b);
  const p50 = sortEnd[Math.floor(sortEnd.length*0.5)];
  const p25 = sortEnd[Math.floor(sortEnd.length*0.25)];
  const p75 = sortEnd[Math.floor(sortEnd.length*0.75)];
  const sortRounds = results.map(r=>r.roundsPlayed).sort((a,b)=>a-b);
  const r50 = sortRounds[Math.floor(sortRounds.length*0.5)];
  const r25 = sortRounds[Math.floor(sortRounds.length*0.25)];
  const r75 = sortRounds[Math.floor(sortRounds.length*0.75)];

  console.log("--- Roll of Cards Monte Carlo ---");
  console.log(`Trials: ${trials} \tRounds/trial: ${rounds} \tStart bankroll: ${startBankroll} \tVariable bets: ${variableBets} \tMax bet: ${(maxBetFrac*100).toFixed(1)}% of bankroll`);
  console.log(`Avg end bankroll: ${meanEnd.toFixed(2)}  (median: ${p50.toFixed(2)}; IQR: ${p25.toFixed(2)}–${p75.toFixed(2)})`);
  console.log(`Avg net: ${meanNet.toFixed(2)}  over avg staked ${meanStaked.toFixed(2)}  => player ROI: ${(roi*100).toFixed(2)}%  (house edge: ${(houseEdge*100).toFixed(2)}%)`);
  console.log(`House take (avg per trial): ${meanHouse.toFixed(2)} SC  — rake: ${meanRake.toFixed(2)} SC, other: ${meanOther.toFixed(2)} SC`);
  console.log(`Bust rate: ${(bustRate*100).toFixed(1)}%`);
  console.log(`Rounds played before bust (if any): avg ${meanRounds.toFixed(0)}  (median ${r50}| IQR ${r25}-${r75})`);
  const W = sum('wins'), L = sum('losses'), T = sum('ties'), J = sum('jackpots');
  const N = W+L+T+J;
  console.log(`Outcome mix (across all trials): W ${(W/N*100).toFixed(1)}% | L ${(L/N*100).toFixed(1)}% | T ${(T/N*100).toFixed(1)}% | JP ${(J/N*100).toFixed(3)}%`);
}

// Run default sim when executed directly
if (require.main === module) {
  const trials = Number(process.argv[2]) || 50;
  const rounds = Number(process.argv[3]) || 5000;
  const start = Number(process.argv[4]) || 100;
  const variable = (process.argv[5] ?? '1') !== '0';
  const maxBetFrac = Number(process.argv[6]);
  runSim({ trials, rounds, startBankroll: start, variableBets: variable, maxBetFrac: Number.isFinite(maxBetFrac) ? maxBetFrac : 1.0 });
}

module.exports = { runTrial, runSim };
