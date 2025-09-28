// GameTable.js — Gambit: War (cards) PvP with LED/arcade flair (no wagering language)
// - Symmetric per-round points keyed by face-up cards
// - 3D card reveal, YOU/OPP labels
// - Works regardless of who clicks Deal
// - LED look + original NavBar restored above HUD
// - Card board LED stripe is true full-bleed so cards can fly left/right
// - Phone: deck off-screen right; two cards land side-by-side near center (exactly like your original)

import React, { useEffect, useRef, useState, useCallback } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './GameTable.css';
import { motion, AnimatePresence } from 'framer-motion';
import NavBar from "./../../NavBar";
import CardReveal from './CardReveal.jsx';
import LoginOverlay from './../../common/LoginOverlay';
import GameSetup from './../../common/GameSetup';
import QuickChat from '../common/QuickChat';

/*************************
 * Config (WS + API base)
 *************************/
const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
const curHost = (()=>{ if(typeof window==='undefined') return 'localhost'; const envHost=(process.env.REACT_APP_SERVER_HOST||'').trim(); const winHost=(window.SERVER_HOST?String(window.SERVER_HOST).trim():''); let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{} return envHost||winHost||lsHost||((window.location&&window.location.hostname)||'localhost'); })();
const WS_URL = (process.env.REACT_APP_WAR_WS || `${isSecure ? 'wss' : 'ws'}://${curHost}:3001`);
const API    = (process.env.REACT_APP_API_BASE || `${isSecure ? 'https' : 'http'}://${curHost}:3002`);

/***********************
 * Points/Wallet helpers
 ***********************/
function authFetch(path, options = {}) {
  const token = (typeof localStorage !== 'undefined') ? (localStorage.getItem('token') || '') : '';
  return fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers||{}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}
async function adjustPoints(delta, memo='') {
  const r = await authFetch('/sc/adjust', { method:'POST', body: JSON.stringify({ delta:Number(delta), memo }) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(j?.message || 'Points adjust failed');
  return j;
}
async function getPoints() {
  const r = await authFetch('/balance');
  const j = await r.json().catch(()=>({ sc_balance: 0 }));
  return Number(j.sc_balance)||0;
}

/***********
 * Avatars *
 ***********/
const AVATARS = ['rocket','dragon','brain','fox','lion','panda','penguin','alien'];
const GLYPHS  = { rocket:'🚀', dragon:'🐉', brain:'🧠', fox:'🦊', lion:'🦁', panda:'🐼', penguin:'🐧', alien:'👾' };
const Avatar = ({ id='rocket', size=28 }) => (
  <span className="ava" style={{ fontSize: size * 0.72, width:size, height:size }}>{GLYPHS[id] || '👾'}</span>
);

/*****************
 * LED FX helper  *
 *****************/
function LedFrame({ children, color='rgba(255,110,220,0.9)', speed=2, rounded='1.5rem', thickness=4, className='' }) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0 pointer-events-none" style={{
        borderRadius: rounded, boxShadow: `0 0 24px ${color}, inset 0 0 12px ${color}`,
        animation: `gflash ${speed}s linear infinite`,
        border: `${thickness}px solid`, borderColor: 'transparent',
        background: `linear-gradient(90deg, ${color} 0%, transparent 40%, transparent 60%, ${color} 100%)`,
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor', maskComposite: 'exclude', padding: 2
      }}/>
      <div className="relative">{children}</div>
    </div>
  );
}

/****************
 * Main Component
 ****************/
export default function GameTable({ embedded = false }) {
  const [ws, setWs] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [queued, setQueued] = useState(false);
  const [paired, setPaired] = useState(null); // {you, usernames, avatars, pointsPerRound}
  const [countdown, setCountdown] = useState(null);
  const [started, setStarted] = useState(false);
  const [playerNumber, setPlayerNumber] = useState(null);

  const [username, setUsername] = useState(() => (typeof localStorage !== 'undefined'
    ? ((localStorage.getItem('username') || localStorage.getItem('war_user') || '').slice(0, 16))
    : ''));
  const [avatar, setAvatar] = useState(() => (typeof localStorage !== 'undefined'
    ? (localStorage.getItem('profileAvatar') || localStorage.getItem('war_avatar') || 'rocket')
    : 'rocket'));
  const [roundPoints, setRoundPoints] = useState(() => (typeof localStorage !== 'undefined' ? Number(localStorage.getItem('war_stake') || 1) || 1 : 1));
  const [stakeText, setStakeText] = useState(() => {
    try {
      const s = (typeof localStorage !== 'undefined') ? Number(localStorage.getItem('war_stake') || 1) : 1;
      const n = Math.max(0.01, Number.isFinite(s) ? s : 1);
      return n.toFixed(2);
    } catch { return '1.00'; }
  });
  const [points, setPoints] = useState(0);

  // Auth tracking (shared with other games)
  const isAuthed = useCallback(() => {
    try {
      const t = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : '';
      const u = (typeof localStorage !== 'undefined') ? localStorage.getItem('username') : '';
      return !!(t && u);
    } catch { return false; }
  }, []);

  // Keep numeric roundPoints in sync with editable stakeText
  useEffect(() => {
    const n = Math.max(0.01, Number(stakeText) || 0);
    setRoundPoints(n);
  }, [stakeText]);
  const [authed, setAuthed] = useState(isAuthed());
  useEffect(() => {
    setAuthed(isAuthed());
    const onAuth = () => setAuthed(isAuthed());
    if (typeof window !== 'undefined') window.addEventListener('authchange', onAuth);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('authchange', onAuth); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cards from server e.g. {rank:'A', suit:'♠'}
  const [p1Card, setP1Card] = useState(null);
  const [p2Card, setP2Card] = useState(null);

  const [scores, setScores] = useState({ 'Player 1': 0, 'Player 2': 0 });
  const [round, setRound] = useState(0);
  const [roundWinner, setRoundWinner] = useState(null);
  const [matchWinner, setMatchWinner] = useState(null);
  const [canDeal, setCanDeal] = useState(false);
  const [warDepth, setWarDepth] = useState(0);
  const [chatFeed, setChatFeed] = useState([]);

  // Match-level staking (lock once at start; settle on game over)
  const lockedStakeRef = useRef(0);
  const settledOnceRef = useRef(false);

  /** Points */
  useEffect(() => { (async()=>{ try { setPoints(await getPoints()); } catch {} })(); }, []);
  const lockStake = useCallback(async (amt) => {
    const a = Math.max(0.01, Number(amt)||0);
    if (lockedStakeRef.current > 0) return true;
    const bal = await getPoints().catch(()=>0);
    if (bal < a) { alert(`Not enough points. You have ${bal.toFixed(2)}, need ${a.toFixed(2)}.`); return false; }
    try { const j = await adjustPoints(-a, 'Gambit War — lock stake'); lockedStakeRef.current = a; setPoints(Number(j.sc_balance)||0); return true; }
    catch (e) { alert(e.message || 'Could not lock.'); return false; }
  }, []);
  const refundStake = useCallback(async (reason='refund') => {
    const a = lockedStakeRef.current;
    if (a > 0) {
      try { const j = await adjustPoints(+a, `Gambit War — ${reason}`); setPoints(Number(j.sc_balance)||0); } catch {}
      lockedStakeRef.current = 0;
    }
  }, []);

  // Settlement helper
  const settleWin = useCallback(async (myStake, oppStake) => {
    const credit = Number(myStake||0) + Number(oppStake||0);
    if (credit <= 0) { lockedStakeRef.current = 0; return; }
    try {
      const j = await adjustPoints(+credit, 'Gambit War — win payout');
      setPoints(Number(j.sc_balance)||0);
    } catch (e) {
      // fallback: at least restore my locked stake to avoid being stuck
      try { const j2 = await adjustPoints(+Number(myStake||0), 'Gambit War — payout fallback refund'); setPoints(Number(j2.sc_balance)||0); } catch {}
    }
    lockedStakeRef.current = 0;
  }, []);

  /****************
   * WS lifecycle *
   ****************/
  const connect = useCallback(() => {
    const sock = new WebSocket(WS_URL);
    setWs(sock);
    sock.onopen = () => setWsConnected(true);

    sock.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'queued') { setQueued(true); return; }
      if (msg.type === 'paired') { setPaired({ you: msg.you, usernames: msg.usernames, avatars: msg.avatars, pointsPerRound: msg.stakes }); setQueued(false); return; }
      if (msg.type === 'quickChat'){
        const youRole = (playerNumber === 1 ? 'Player 1' : (playerNumber === 2 ? 'Player 2' : 'Player 1'));
        const from = msg.from === youRole ? 'you' : (msg.from||'opp');
        setChatFeed(prev => [...prev, { from, username: msg.username, text: String(msg.text||'').slice(0,80), ts: Number(msg.ts)||Date.now() }].slice(-12));
        return;
      }
      if (msg.type === 'countdown') { setCountdown(msg.value); return; }
      if (msg.type === 'startGame') { setStarted(true); setChatFeed([]); setPlayerNumber(msg.playerNumber); setScores(msg.scores || { 'Player 1':0, 'Player 2':0 }); setRound(msg.currentRound || 0); setCountdown(null); settledOnceRef.current = false; (async()=>{ const s = paired?.pointsPerRound || {}; const myRole = (msg.playerNumber===1?'Player 1':'Player 2'); const myStake = Number(s[myRole] ?? roundPoints) || Number(roundPoints)||0; if (lockedStakeRef.current<=0) await lockStake(myStake); })(); return; }
      if (msg.type === 'turn') { setCanDeal(!!msg.canDeal); return; }

      if (msg.type === 'round') {
        // Update UI
        setP1Card(msg.p1Card || null);
        setP2Card(msg.p2Card || null);
        setRoundWinner(msg.roundWinner || null);
        setScores(msg.scores || { 'Player 1':0, 'Player 2':0 });
        setRound(Number(msg.round || 0));
        setWarDepth(Number(msg.warDepth || 0));
        if (msg.matchWinner) setMatchWinner(msg.matchWinner);
        return;
      }

      if (msg.type === 'gameOver') {
        setMatchWinner(msg.winner || null);
        setScores(msg.scores || scores);
        // Settle stakes once: winner receives both stakes; loser loses locked stake
        if (!settledOnceRef.current && msg.winner) {
          settledOnceRef.current = true;
          const myRole = playerNumber === 1 ? 'Player 1' : 'Player 2';
          const oppRole = myRole === 'Player 1' ? 'Player 2' : 'Player 1';
          const stakes = paired?.pointsPerRound || {};
          const myStake = Number(stakes[myRole]) || lockedStakeRef.current || Number(roundPoints) || 0;
          const oppStake = Number(stakes[oppRole]) || 0;
          if (msg.winner === myRole) {
            (async()=>{ await settleWin(myStake, oppStake); })();
          } else {
            // lost or no winner: clear lock without refund
            lockedStakeRef.current = 0;
          }
        }
        return;
      }

      if (msg.type === 'rematchStart') {
        setMatchWinner(null);
        setRound(0);
        setP1Card(null); setP2Card(null); setRoundWinner(null); setWarDepth(0);
        setScores(msg.scores || { 'Player 1':0, 'Player 2':0 });
        settledOnceRef.current = false;
        // Lock again for the new match if not already
        (async()=>{ const s = paired?.pointsPerRound || {}; const myRole = (playerNumber===1?'Player 1':'Player 2'); const myStake = Number(s[myRole] ?? roundPoints) || Number(roundPoints)||0; if (lockedStakeRef.current<=0) await lockStake(myStake); })();
        return;
      }

      if (msg.type === 'opponentLeft') {
        // If match not decided, refund any lock (room canceled)
        if (!settledOnceRef.current) (async () => { await refundStake('opponent left'); })();
        setQueued(false); setPaired(null); setCountdown(null); setStarted(false);
        setP1Card(null); setP2Card(null); setRoundWinner(null); setWarDepth(0);
        settledOnceRef.current = false;
        return;
      }
    };

    sock.onclose = () => { setWsConnected(false); setWs(null); };
    sock.onerror = () => { setWsConnected(false); };
  }, [paired, playerNumber, roundPoints, scores, refundStake, lockStake, settleWin]);

  useEffect(() => { connect(); return () => { try { ws?.close(); } catch {} }; /* eslint-disable-next-line */ }, []);

  // Sync with global Gaming Profile (NavBar)
  useEffect(()=>{
    const applyProfile = ()=>{
      try{
        const n = localStorage.getItem('username') || '';
        const a = localStorage.getItem('profileAvatar') || '';
        if (n) setUsername(n.slice(0,16));
        if (a) setAvatar(a);
      }catch{}
    };
    if (typeof window !== 'undefined'){
      window.addEventListener('profile:update', applyProfile);
      window.addEventListener('storage', applyProfile);
    }
    return ()=>{
      if (typeof window !== 'undefined'){
        window.removeEventListener('profile:update', applyProfile);
        window.removeEventListener('storage', applyProfile);
      }
    };
  },[]);

  /**********
   * Actions
   **********/
  const join = async () => {
    const name = (username || 'You').trim().slice(0, 16);
    const pts = Math.max(0.01, Number(roundPoints) || 0);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('war_user', name);
      localStorage.setItem('war_avatar', avatar);
      localStorage.setItem('war_stake', String(pts));
    }
    ws?.send(JSON.stringify({ type:'joinGame', username:name, avatar, stake:pts }));
  };
  const deal = () => { if (canDeal) { setCanDeal(false); ws?.send(JSON.stringify({ type:'deal' })); } };
  const rematch = async () => {
    ws?.send(JSON.stringify({ type:'rematchVote' }));
  };
  const leave = () => {
    ws?.send(JSON.stringify({ type:'leaveGame' }));
    if (!settledOnceRef.current) (async () => { await refundStake('left game'); })();
    setQueued(false); setPaired(null); setCountdown(null); setStarted(false);
    setP1Card(null); setP2Card(null); setRoundWinner(null); setWarDepth(0);
    settledOnceRef.current = false;
  };

  /***********
   * Helpers *
   ***********/
  const myRole = playerNumber === 1 ? 'Player 1' : playerNumber === 2 ? 'Player 2' : '—';
  const oppRole = myRole === 'Player 1' ? 'Player 2' : 'Player 1';
  const myName  = paired?.usernames?.[myRole] || (username || 'You');
  const oppName = paired?.usernames?.[oppRole] || 'Opponent';
  const myAvatar = paired?.avatars?.[myRole] || avatar;
  const oppAvatar = paired?.avatars?.[oppRole] || 'alien';
  const stakes = paired?.pointsPerRound || {};
  const fmtPTS = (n) => `${(Number(n)||0).toFixed(2)} PTS`;

  // Responsive sizing & deck positions for CardReveal (matches your original)
  const [cardHeight, setCardHeight] = useState(320);
  const [cameraZoom, setCameraZoom] = useState(120);
  const [deckX, setDeckX] = useState(0);
  const [leftX, setLeftX] = useState(-1.35);
  const [rightX, setRightX] = useState(1.35);
  const [zLift, setZLift] = useState(0.16);

  useEffect(() => {
    function recalc() {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const isMobile = w < 600;

      setCardHeight(isMobile ? 240 : 340);
      setCameraZoom(isMobile ? 150 : 120);
      setZLift(isMobile ? 0.12 : 0.16);

      // Phone: deck off to the right, two cards land side-by-side near center
      setDeckX(isMobile ? 2.1 : 0);
      setLeftX(isMobile ? -0.40 : -1.35);
      setRightX(isMobile ?  0.40 :  1.35);
    }
    recalc();
    if (typeof window !== 'undefined') window.addEventListener('resize', recalc);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('resize', recalc); };
  }, []);

  return (
    <div className={`gambit-war-page ${embedded ? 'war-embed' : ''}`} style={{ ['--nav-height']: '64px' }}>
      {/* Original Nav stays above HUD */}
      {!embedded && <NavBar />}
      {!embedded && <div className="nav-spacer" />}

      {/* HUD removed per request */}

      <main className="app-content">
      {(!authed || (started && !wsConnected)) && (<LoginOverlay />)}
      {/* Setup (shared layout) */}
      {!started && !paired && (
        <div className="d-flex justify-content-center p-3">
          <GameSetup
            title="Game Setup"
            badge="War — PvP"
            username={username}
            setUsername={(v)=>setUsername((v||'').slice(0,16))}
            stakeText={stakeText}
            setStakeText={setStakeText}
            scBalance={points}
            currencyLabel="PTS"
            joinLabel="Find opponent"
            onJoin={join}
            joinDisabled={!username}
            // Optional: provide avatar UI later
          />
        </div>
      )}

      {/* Matchmaking */}
      {(queued || paired || countdown!=null) && !started && (
        <div className="match-overlay">
          <LedFrame color="rgba(255,230,0,0.9)">
            <div className="match-card">
              <div className="match-header">
                <h3>Matchmaking</h3>
                <button className="mm-cancel" onClick={leave}>Cancel</button>
              </div>
              <div className="match-body">
                <div className="match-col">
                  <div className="mm-avatar"><Avatar id={myAvatar} size={72} /></div>
                  <div className="mm-pill"><i className="bi bi-person-badge" /> {myName}</div>
                  <div className="mm-pill"><i className="bi bi-stars" /> Your stake: <strong>{fmtPTS(stakes['Player 1'] ?? roundPoints)}</strong></div>
                </div>
                <div className="match-divider">VS</div>
                <div className="match-col">
                  <div className="mm-avatar"><Avatar id={oppAvatar} size={72} /></div>
                  <div className="mm-pill"><i className="bi bi-person-badge" /> {paired ? oppName : 'Searching…'}</div>
                  <div className="mm-pill"><i className="bi bi-stars" /> Opponent stake: <strong>{fmtPTS(stakes['Player 2'])}</strong></div>
                </div>
              </div>
              <div className="mm-footer">
                {countdown!=null ? <div className="mm-pill">Game starts in <strong>{countdown}</strong>…</div>
                                 : <div className="mm-pill">Waiting for opponent…</div>}
              </div>
            </div>
          </LedFrame>
        </div>
      )}

      {/* Table */}
      {started && (
        <div className="table-wrap" style={{ position:'relative' }}>
          <div className="player-row">
            <Avatar id={myAvatar} /> <strong>{myName}</strong>
            <span className="score">Score: {scores['Player 1']}</span>
            <span className="stake"><i className="bi bi-stars" /> {fmtPTS(stakes['Player 1'])}</span>
          </div>

          {/* Cards / 3D — exactly your landing layout, inside a true full-bleed LED rail */}
          <div className="cards-row full-bleed">
            <LedFrame color="rgba(255,110,220,0.9)" rounded="1.5rem" className="led-full">
              <CardReveal
                you={p1Card}
                opp={p2Card}
                round={round}
                basePath="/cards/meuk"
                height={cardHeight}
                cameraZoom={cameraZoom}
                deckX={deckX} deckY={0}
                leftX={leftX} rightX={rightX}
                zLift={zLift}
                firstDelayMs={240}
                staggerMs={820}
                totalMs={980}
                showLandingLabels
              />
            </LedFrame>
          </div>

          {/* round banners + controls */}
          <div className="mid-controls">
            <AnimatePresence>
              {roundWinner && (
                <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-8}} className="round-banner">
                  {roundWinner} won the round
                </motion.div>
              )}
            </AnimatePresence>
            {warDepth > 0 && <div className="war-badge">WAR x{warDepth}</div>}

            {!matchWinner && (
              <button className="btn-deal" disabled={!canDeal} onClick={deal}>
                <i className="bi bi-lightning-charge-fill" /> Deal
              </button>
            )}
            {matchWinner && (
              <div className="end-row">
                <div className="final-banner">{matchWinner} wins!</div>
                <button className="btn-rematch" onClick={rematch}><i className="bi bi-arrow-repeat" /> Rematch</button>
                <button className="btn-leave subtle" onClick={leave}><i className="bi bi-door-open" /> Leave</button>
              </div>
            )}
          </div>

          <div className="player-row">
            <Avatar id={oppAvatar} /> <strong>{oppName}</strong>
            <span className="score">Score: {scores['Player 2']}</span>
            <span className="stake"><i className="bi bi-stars" /> {fmtPTS(stakes['Player 2'])}</span>
          </div>

          <QuickChat
            onSend={(text)=>{ const t=String(text||'').slice(0,80); if(ws && ws.readyState===WebSocket.OPEN){ try{ ws.send(JSON.stringify({ type:'quickChat', text: t })); }catch{} } }}
            messages={chatFeed}
            youKey="you"
            align="right"
            canSend={wsConnected && started}
          />
        </div>
      )}
      </main>

      {/* LED + full-bleed glue (kept separate so it overrides external CSS safely) */}
      <style jsx>{`
        @keyframes gflash { 0%,100%{opacity:1} 50%{opacity:.45} }

        /* Hide horizontal scroll; allow true edge-to-edge */
        .gambit-war-page { overflow-x: hidden; }

        /* Full-bleed container technique: pull the row out to viewport edges */
        .cards-row.full-bleed {
          position: relative;
          left: 50%;
          right: 50%;
          margin-left: -50vw;
          margin-right: -50vw;
          width: 100vw;
          max-width: 100vw;
          padding: 0;
        }

        /* Ensure the LED frame itself spans the viewport */
        .led-full {
          display: block;
          width: 100vw;
          max-width: 100vw;
        }

        /* Compatibility: reuse global LED variables if present (no duplicate animation) */
  .led-full .led-run { --led-speed: var(--global-led-speed); --led-color: var(--led-color, rgba(255,110,220,0.95)); }
      `}</style>

      {/* Minimal arcade CSS (scoped) — preserves your layout */}
      <style jsx>{`
  .gambit-war-page { min-height: 100vh; padding: 0 16px 16px; color: var(--text); background: var(--bg-body); }
        .nav-spacer{ height:56px; }
        .war-hud { display:flex; justify-content:space-between; align-items:center; gap:12px; position:sticky; top:0; z-index:10; padding:10px 12px; background:rgba(0,0,0,.35); backdrop-filter: blur(8px); border-radius:14px; border:1px solid rgba(255,255,255,.1); }
        .hud-chip { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); }
  /* button gradients now provided globally; keep only width helper */

        .setup{ display:flex; justify-content:center; padding:20px; }
  .setup-card{ position:relative; z-index:1; width:min(720px,100%); background: var(--card-bg); border:1px solid var(--card-border); border-radius:20px; padding:18px; box-shadow:0 20px 50px rgba(0,0,0,.35); }
        .setup-card h3{ margin:0 0 12px; }
        .row{ display:grid; gap:8px; margin:10px 0; }
        .ava-row{ display:flex; flex-wrap:wrap; gap:8px; }
  .ava-btn{ font-size:20px; padding:8px 10px; border-radius:12px; background:rgba(255,255,255,.08); border:1px solid var(--divider); color: var(--text); }
        .ava-btn.is-active{ outline:2px solid #ffd857; }
  .stake-input{ display:flex; align-items:center; gap:8px; background: var(--input-bg); border:1px solid var(--input-border); padding:8px 10px; border-radius:12px; }
  .stake-input input{ background:transparent; border:0; color: var(--input-text); width:120px; outline:none; }
        .btn-join.wide{ width:100%; margin-top:8px; }

        .match-overlay{ display:flex; justify-content:center; padding:20px; }
  .match-card{ position:relative; z-index:1; width:min(900px,100%); background: var(--card-bg); border:1px solid var(--card-border); border-radius:20px; padding:18px; box-shadow:0 20px 50px rgba(0,0,0,.35); }
        .match-header{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
        .match-body{ display:grid; grid-template-columns:1fr auto 1fr; gap:12px; align-items:center; }
  .match-divider{ font-weight:800; font-size:18px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.1); color: var(--text); }
        .mm-avatar{ display:grid; place-items:center; }
  .mm-pill{ display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.08); border:1px solid var(--divider); color: var(--text); }
  .mm-cancel{ appearance:none; border:0; background:rgba(255,255,255,.08); color: var(--text); border-radius:10px; padding:6px 10px; cursor:pointer; }

        .table-wrap{ display:grid; gap:14px; padding:16px; overflow:visible; }
  .player-row{ display:flex; align-items:center; gap:10px; justify-content:space-between; background: var(--card-bg); border:1px solid var(--card-border); border-radius:14px; padding:10px 12px; color: var(--text); }
        .player-row .score, .player-row .stake{ opacity:.9; }

        /* Normal centered container for mobile/embeds; full-bleed on desktop is handled above */
        .cards-row{ display:flex; justify-content:center; padding:8px; }
      `}</style>
    </div>
  );
}

/**********************
 * Dev-only smoke tests
 **********************/
if (typeof window !== 'undefined') {
  window.__warTests__ = {
    wsUrlProtoOK: WS_URL.startsWith('ws') || WS_URL.startsWith('wss'),
    apiProtoOK: API.startsWith('http'),
    noBettingWords: !/bet|wager|stake\s*\(SC\)/i.test(document?.body?.innerText || ''),
  };
}
