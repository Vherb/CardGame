/* eslint-disable no-console */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { Card, Row, Col, Button, Form, InputGroup, Badge } from "react-bootstrap";
import GameSetup from "../../common/GameSetup";
import './GameBoard.css';
import NavBar from "./../../NavBar";
import QuickChat from '../common/QuickChat';
import WaitingOverlay from '../common/WaitingOverlay';
import ConnectFour3DView from '../ConnectFour3D/ConnectFour3DView';

/* ============== LED helpers (War vibe) ============== */
function LedFrame({ children, color='rgba(255,110,220,0.9)', speed=2, rounded='1rem', thickness=3, className='' }) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0 pointer-events-none" style={{
        borderRadius: rounded,
        boxShadow: `0 0 24px ${color}, inset 0 0 12px ${color}`,
        animation: `gflash ${speed}s linear infinite`,
        border: `${thickness}px solid`, borderColor: 'transparent',
        background: `linear-gradient(90deg, ${color} 0%, transparent 40%, transparent 60%, ${color} 100%)`,
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor', maskComposite: 'exclude', padding: 2
      }} />
      <div className="relative">{children}</div>
    </div>
  );
}
function LedBar({ color='rgba(255,110,220,0.95)', speed }) {
  return (
    <div className="led-topbar">
      <div className="led-run" style={{ ['--led-color']: color }} />
    </div>
  );
}

/* ========================= Constants ========================= */
const ROWS = 6;
const COLUMNS = 7;
const makeBoard = () => Array.from({ length: ROWS }, () => Array(COLUMNS).fill(null));

/* WebSocket endpoint: follow current host like Chess (no remote fallback)
   Overrides supported via: env REACT_APP_CF_WS, ?cfws=..., window.CF_WS, or localStorage.CF_WS */
const getWsUrl = () => {
  try{
    const env = (process.env.REACT_APP_CF_WS || '').trim(); if(env) return env;
    let qsOver = '';
    try { const sp = new URLSearchParams(window.location.search); qsOver = (sp.get('cfws')||'').trim(); } catch {}
    if (qsOver) return qsOver;
    const over = (window.CF_WS || '').trim?.() || '';
    if (over) return over;
    try { const lsOver = (localStorage.getItem('CF_WS') || '').trim(); if (lsOver) return lsOver; } catch {}
    const envHost = (process.env.REACT_APP_SERVER_HOST||'').trim();
    const winHost = (window.SERVER_HOST?String(window.SERVER_HOST).trim():'');
    let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{}
    const host = envHost || winHost || lsHost || ((window.location && window.location.hostname) || 'localhost');
    const proto = (window.location && window.location.protocol === 'https:') ? 'wss' : 'ws';
    if (process.env.REACT_APP_UNIFIED_WS === '1'){
      // In unified mode, connect to the API host:port (defaults to 3002) and not the client port (3000)
      const httpProto = (window.location && window.location.protocol) || 'http:';
      const apiBase = (process.env.REACT_APP_API_BASE && process.env.REACT_APP_API_BASE.trim()) || `${httpProto}//${host}:3002`;
      let u; try { u = new URL(apiBase); } catch { u = { host: `${host}:3002` }; }
      return `${proto}://${u.host}/ws/c4`;
    }
    return `${proto}://${host}:3014`;
  }catch{
    return 'ws://localhost:3014';
  }
};

/* ======= SC wallet helpers ======= */
const API = (()=>{
  const { protocol, hostname } = window.location;
  const envHost=(process.env.REACT_APP_SERVER_HOST||'').trim();
  const winHost=(window.SERVER_HOST?String(window.SERVER_HOST).trim():'');
  let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{}
  const host=envHost||winHost||lsHost||hostname;
  return process.env.REACT_APP_API_BASE || `${protocol}//${host}:3002`;
})();

function authFetch(path, options = {}) {
  const token = localStorage.getItem('token') || '';
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
async function scAdjust(delta, memo = '') {
  const r = await authFetch('/sc/adjust', {
    method: 'POST',
    body: JSON.stringify({ delta: Number(delta), memo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || 'SC adjust failed');
  return j;
}
async function getBalance() {
  const r = await authFetch('/balance');
  const j = await r.json().catch(()=>({ sc_balance: 0 }));
  return Number(j.sc_balance) || 0;
}

/* ========================= Audio ========================= */
function useDropSound() {
  const ctxRef = useRef(null);
  const interactedRef = useRef(false);

  const prime = useCallback(() => {
    interactedRef.current = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctxRef.current) ctxRef.current = new AC();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
  }, []);

  const playDrop = useCallback(() => {
    if (!interactedRef.current || !ctxRef.current) return;
    const ctx = ctxRef.current;
    const now = ctx.currentTime;

    const noiseBuf = ctx.createBuffer(1, 2048, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * 0.35;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'lowpass';
    nFilter.frequency.setValueAtTime(900, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0, now);
    nGain.gain.linearRampToValueAtTime(0.06, now + 0.005);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    noise.connect(nFilter).connect(nGain).connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.08);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.0, now);
    oGain.gain.linearRampToValueAtTime(0.05, now + 0.005);
    oGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(oGain).connect(ctx.destination);

    noise.start(now); noise.stop(now + 0.1);
    osc.start(now);   osc.stop(now + 0.14);
  }, []);

  return { prime, playDrop };
}
function useAudioClip(src, { volume = 1 } = {}) {
  const audioRef = useRef(null);
  useEffect(() => {
    const a = new Audio(src);
    a.preload = 'auto';
    a.volume = volume;
    a.addEventListener('error', () => {});
    audioRef.current = a;
    return () => { try { a.pause(); } catch {} audioRef.current = null; };
  }, [src, volume]);
  const play = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    try { a.currentTime = 0; a.play().catch(() => {}); } catch {}
  }, []);
  return { play };
}

/* ========================= Color helpers ========================= */
const PALETTE = ['#EF4444','#3B82F6','#A855F7','#FFFFFF','#22C55E','#F97316','#000000','#6B7280'];
function hexToRgb(hex){const s=hex.replace('#','');const v=s.length===3?s.split('').map(c=>c+c).join(''):s;const n=parseInt(v,16);return{r:(n>>16)&255,g:(n>>8)&255,b:n&255};}
function darken(hex,amt=0.25){const{r,g,b}=hexToRgb(hex);const mix=c=>Math.max(0,Math.floor(c*(1-amt)));return`rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;}
function tokenStyleFor(color){const base=color||'#ef4444';const edge=darken(base,.25);const shadow=darken(base,.45);return{background:`radial-gradient(circle at 30% 30%, ${base} 0%, ${edge} 55%, ${shadow} 100%)`,boxShadow:`inset 0 .4rem 1rem rgba(0,0,0,.22), 0 3px 8px rgba(0,0,0,.25)`};}
function contrastText(hex){const{r,g,b}=hexToRgb(hex);const y=.2126*r+.7152*g+.0722*b;return y>140?'#0b1220':'#ffffff';}

/* ========================= Avatars ========================= */
const AVATAR_SET=[
  {id:'rocket',label:'Rocket',glyph:'🚀'},
  {id:'dragon',label:'Dragon',glyph:'🐉'},
  {id:'brain',label:'Brain',glyph:'🧠'},
  {id:'fox',label:'Fox',glyph:'🦊'},
  {id:'lion',label:'Lion',glyph:'🦁'},
  {id:'panda',label:'Panda',glyph:'🐼'},
  {id:'penguin',label:'Penguin',glyph:'🧑‍🚀'},
  {id:'alien',label:'Alien',glyph:'👾'},
  {id:'astronaut',label:'Astronaut',glyph:'👨‍🚀'}
];
const findAvatar=(id)=>AVATAR_SET.find(a=>a.id===id)||AVATAR_SET[0];
const Avatar=({id,size=22})=>{const a=findAvatar(id);return(
  <div
    style={{
      width:size,
      height:size,
      borderRadius:'50%',
      display:'grid',
      placeItems:'center',
      background:'transparent',
      border:'none',
      boxShadow:'none',
      fontSize:Math.round(size*.7),
      lineHeight:1
    }}
    aria-label={a.label}
    title={a.label}
  >{a.glyph}</div>
);};

/* ========================= Fancy LED Color Swatch ========================= */
function ColorSwatch({ hex, active, onPick }) {
  return (
    <button
      type="button"
      className={`sw led-swatch ${active ? "is-active" : ""}`}
      style={{ width: 44, height: 44, borderRadius: '50%', background: hex }}
      title={hex}
      aria-label={`Choose ${hex}`}
      onClick={() => onPick(hex)}
    >
      <span className="led-ring" />
    </button>
  );
}

/* ========================= PreGame / Setup ========================= */
function PreGameSetup({
  username, setUsername,
  selectedColor, setSelectedColor,
  stakeText, setStakeText,
  avatarId, setShowAvatarModal,
  // New: character picker wiring
  characterId, onPickCharacter,
  scBalance,
  onJoin,
  serverSaved,
  refreshSaved,
  claimSaved,
}) {
  return (
    <GameSetup
      title="Game Setup"
      badge="Connect Four"
      username={username}
      setUsername={setUsername}
      stakeText={stakeText}
      setStakeText={setStakeText}
      scBalance={scBalance}
      currencyLabel="SC"
      joinLabel="Join Game"
      onJoin={onJoin}
      joinDisabled={!username}
      // Character selection
      characterId={characterId}
      onPickCharacter={onPickCharacter}
      avatarId={avatarId}
      avatarGlyph={findAvatar(avatarId).glyph}
      onOpenAvatarModal={() => setShowAvatarModal(true)}
      colors={PALETTE}
      selectedColor={selectedColor}
      onPickColor={setSelectedColor}
      footerExtra={(
        <div>
          <div className="d-flex align-items-center justify-content-between mb-1">
            <div className="fw-bold">Reconnect & Continue</div>
            <div>
              <Button size="sm" variant="outline-light" onClick={refreshSaved}>Refresh</Button>
            </div>
          </div>
          {(!Array.isArray(serverSaved) || serverSaved.length===0) ? (
            <div className="text-secondary small">No paused games yet. Start a game, make a move, then leave to save it for later.</div>
          ) : (
            <div className="saved-list">
              {serverSaved.map(s => (
                <div key={`sv-${s.gameId}`} className="p-2 saved-card">
                  {(() => {
                    const youRole = s.you===2 ? 'Player 2' : 'Player 1';
                    const oppRole = youRole==='Player 1' ? 'Player 2' : 'Player 1';
                    const ys = s?.usernames?.[youRole];
                    const os = s?.usernames?.[oppRole];
                    const youName = (ys && !['Player 1','Player 2'].includes(ys)) ? ys : (username || 'You');
                    const oppName = (os && !['Player 1','Player 2'].includes(os)) ? os : 'Opponent';
                    return (
                      <div className="d-flex align-items-center flex-wrap gap-2">
                        <div className="small d-flex flex-column">
                          <div className="fw-semibold d-flex align-items-center gap-2">
                            <span className="name-pill"><i className="bi bi-person-badge"/>{youName}</span>
                            <span className="text-secondary">VS</span>
                            <span className="name-pill"><i className="bi bi-person-badge"/>{oppName}</span>
                          </div>
                          <div className="saved-meta">Game #{s.gameId} · You: {youRole}</div>
                        </div>
                        <div className="saved-actions ms-auto">
                          <Button size="sm" variant="light" className="fw-semibold" onClick={() => {
                            const youName = (s?.usernames?.[youRole]||'').toString().slice(0,40);
                            if (youName) {
                              try { localStorage.setItem('username', youName); } catch {}
                              setUsername(youName.slice(0,16));
                            }
                            const otherUsername = s?.usernames?.[oppRole] || undefined;
                            claimSaved(s.gameId, otherUsername);
                          }}><i className="bi bi-play-fill me-1" />Continue</Button>
                          <Button size="sm" variant="outline-danger" className="fw-semibold" onClick={() => refreshSaved('finish', s.gameId)}><i className="bi bi-check2-circle me-1" />Finish</Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    />
  );
}

/* ========================= Component ========================= */
export default function GameBoard({ embedded = false }) {
  // core game state
  const [board, setBoard] = useState(makeBoard());
  const [currentPlayer, setCurrentPlayer] = useState('Looking for another player...');
  const [winner, setWinner] = useState(null);
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [playerRole, setPlayerRole] = useState(null);

  // scoreboard
  const [player1Wins, setPlayer1Wins] = useState(parseInt(localStorage.getItem('player1Wins') || '0', 10));
  const [player2Wins, setPlayer2Wins] = useState(parseInt(localStorage.getItem('player2Wins') || '0', 10));

  // ui & audio
  const [muted, setMuted] = useState(false);
  const [lastMove, setLastMove] = useState(null);
  const [turnToast, setTurnToast] = useState(null);
  const [, _setLobbyStatus] = useState('idle');

  // identity & cosmetics
  const [username, setUsername] = useState(() => (
    (localStorage.getItem('username') || localStorage.getItem('cfName') || '')
  ).slice(0, 16));
  const [selectedColor, setSelectedColor] = useState(
    localStorage.getItem('profileColor') || localStorage.getItem('cfColor') || '#EF4444'
  );
  const [avatarId, setAvatarId] = useState(
    localStorage.getItem('profileAvatar') || localStorage.getItem('cfAvatar') || 'rocket'
  );
  // Character selection (Astronaut vs Alien)
  const [characterId, setCharacterId] = useState(
    localStorage.getItem('cfCharacter') || 'astronaut'
  );

  const [colors, setColors] = useState({ 'Player 1': '#EF4444', 'Player 2': '#3B82F6' });
  const [myName, setMyName] = useState('You');
  const [oppName, setOppName] = useState('Opponent');
  const [myAvatarId, setMyAvatarId] = useState(avatarId);
  const [oppAvatarId, setOppAvatarId] = useState('alien');
  // Opponent 3D character (astronaut/alien) is independent from emoji avatar
  const [oppCharacterId, setOppCharacterId] = useState('alien');

  // SC wallet
  const [scBalance, setScBalance] = useState(0);

  // stake typed by user
  const [stakeSC, setStakeSC] = useState(() => {
    const v = Number(localStorage.getItem('cfStake') || '1');
    return Number.isFinite(v) && v > 0 ? v : 1;
  });
  const [stakeText, setStakeText] = useState(() =>
    (localStorage.getItem('cfStake') ?? (Number.isFinite(stakeSC) ? stakeSC.toFixed(2) : '1.00'))
  );

  // avatar modal
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  // rematch
  const [rematchVotes, setRematchVotes] = useState(0);
  const [hasVotedRematch, setHasVotedRematch] = useState(false);

  // matchmaking modal
  const [showMatch, setShowMatch] = useState(false);
  const [pairedInfo, setPairedInfo] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [serverSaved, setServerSaved] = useState([]);
  const pendingSavedJoinRef = useRef(null);

  // chat
  const [chatFeed, setChatFeed] = useState([]);
  // quick chat top offset (below navbar)
  // Sit a bit lower under the nav so it doesn't crowd top-right content
  const [qcTopOffset, setQcTopOffset] = useState(140);
  useEffect(() => {
    const compute = () => {
      try {
        const nav = document.querySelector('.navbar');
        const h = nav ? nav.getBoundingClientRect().height : 56;
        // Add extra spacing beneath the nav (previously +24). Make it clearly lower.
  setQcTopOffset(Math.max(160, Math.round(h) + 120));
      } catch { setQcTopOffset(140); }
    };
    compute();
    window.addEventListener('resize', compute, { passive: true });
    return () => window.removeEventListener('resize', compute);
  }, []);

  // sound timings
  const dropSound = useDropSound();
  const winSound = useAudioClip('/sounds/win.mp3', { volume: 0.9 });
  const loseSound = useAudioClip('/sounds/lose.mp3', { volume: 0.9 });
  const IMPACT_FRAC = 0.70;
  const FALL_ADVANCE_MS = 60;

  // refs
  const wsRef = useRef(null);
  const [wsReady, setWsReady] = useState(false);
  const currentPlayerRef = useRef(currentPlayer);
  const playerRoleRef = useRef(playerRole);
  const mutedRef = useRef(muted);
  const prevBoardRef = useRef(makeBoard());
  const connectWSRef = useRef(() => {});
  const gameActiveRef = useRef(false);
  const playTimerRef = useRef(null);
  const didInitRef = useRef(false);
  const lobbyRef = useRef('idle');
  const pendingChatRef = useRef(null);
  const joinIntentRef = useRef(null); // 'new' | null — avoid auto-resume when explicitly joining new game
  const [presence, setPresence] = useState({ 'Player 1': true, 'Player 2': true });
  const userIdRef = useRef(() => {
    try{
      const raw = localStorage.getItem('userId') ?? localStorage.getItem('id');
      const n = raw != null ? Number(raw) : null;
      return Number.isFinite(n) ? n : null;
    }catch{ return null; }
  });

  // escrow / settlement refs
  const lockedStakeRef = useRef(0);
  const settledOnceRef = useRef(false);

  useEffect(() => { currentPlayerRef.current = currentPlayer; }, [currentPlayer]);
  useEffect(() => { playerRoleRef.current = playerRole; }, [playerRole]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // load SC balance
  useEffect(() => { (async () => { try { setScBalance(await getBalance()); } catch {} })(); }, []);

  const setLobbyStatus = useCallback((next, { force = false } = {}) => {
    const cur = lobbyRef.current;
    const isDowngrade = (cur === 'queued' || cur === 'matching') && (next === 'idle' || next === 'waiting');
    if (isDowngrade && !force) return;
    lobbyRef.current = next;
    _setLobbyStatus(next);
  }, [_setLobbyStatus]);

  const primeAudio = useCallback(() => { dropSound.prime(); }, [dropSound]);

  const scheduleImpactSound = useCallback(() => {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { if (!mutedRef.current) dropSound.playDrop(); return; }
    const prefersMobile = window.matchMedia && window.matchMedia('(max-width: 480px)').matches;
    const baseMs = prefersMobile ? 1100 : 900;
    const impactMs = Math.max(0, Math.floor(baseMs * IMPACT_FRAC) - FALL_ADVANCE_MS);
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playTimerRef.current = setTimeout(() => { playTimerRef.current = null; if (!mutedRef.current) dropSound.playDrop(); }, impactMs);
  }, [dropSound]);

  /* ========================= WebSocket ========================= */
  const cleanSocket = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; } catch {}
      try { if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'cleanup'); } catch {}
    }
    wsRef.current = null;
  }, []);

  const lockStake = useCallback(async (amt) => {
    const a = Math.max(0.01, Number(amt) || 0);
    if (lockedStakeRef.current > 0) return true;
    const bal = await getBalance().catch(() => 0);
    if (bal < a) { alert(`Insufficient SC. You have ${bal.toFixed(2)} SC, need ${a.toFixed(2)} SC.`); return false; }
    try {
      const j = await scAdjust(-a, 'Connect Four — lock stake');
      lockedStakeRef.current = a;
      setScBalance(Number(j.sc_balance) || 0);
      return true;
    } catch (e) { alert(e.message || 'Could not lock stake.'); return false; }
  }, []);

  const refundStake = useCallback(async (reason = 'refund') => {
    const a = lockedStakeRef.current;
    if (a > 0) {
      try { const j = await scAdjust(+a, `Connect Four — ${reason}`); setScBalance(Number(j.sc_balance) || 0); } catch {}
      lockedStakeRef.current = 0;
    }
  }, []);

  const settleWin = useCallback(async (myStake, oppStake) => {
    const credit = Number(myStake || 0) + Number(oppStake || 0);
    if (!credit || credit <= 0) return;
    try { const j = await scAdjust(+credit, 'Connect Four — win payout'); setScBalance(Number(j.sc_balance) || 0); }
    catch {
      try { const j2 = await scAdjust(+Number(myStake || 0), 'Connect Four — payout fallback refund'); setScBalance(Number(j2.sc_balance) || 0); } catch {}
    }
    lockedStakeRef.current = 0;
  }, []);

  const attachHandlers = useCallback((ws) => {
  ws.onopen = () => {
    setWsReady(true);
    setLobbyStatus('idle', { force: true });
    setCurrentPlayer('Looking for another player...');
    try{
      // If we queued a saved-join request (like Chess/Raumschach), send it now
      try{
        const pend = pendingSavedJoinRef.current;
        if(pend && !pend.sent){
          if(pend.claim){ ws.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username: (localStorage.getItem('username')||username||'').toString().slice(0,40), userId: userIdRef.current && userIdRef.current(), otherUsername: pend.otherUsername, allowAny: false })); }
          else { ws.send(JSON.stringify({ type:'joinSavedGame', gameId: pend.gameId, token: pend.token, username: (localStorage.getItem('username')||username||'').toString().slice(0,40), userId: userIdRef.current && userIdRef.current(), allowAny: false })); }
          pendingSavedJoinRef.current = { ...pend, sent: true };
        }
      }catch{}
      // Always refresh saved list on open so entries appear immediately
      try{ ws.send(JSON.stringify({ type:'listMySavedGames', username: (localStorage.getItem('username')||username||'').toString().slice(0,40), userId: userIdRef.current && userIdRef.current() })); }catch{}
    }catch{}
  };
    ws.onerror = () => {
      setTurnToast('Connection failed — retrying…');
      setTimeout(()=>setTurnToast(null), 1400);
    };
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
  if (data.type === 'queued') { setLobbyStatus('queued'); joinIntentRef.current = null; return; }
      if (data.type === 'presence' && data.present) { setPresence({ 'Player 1': !!data.present['Player 1'], 'Player 2': !!data.present['Player 2'] }); return; }
      if (data.type === 'mySavedGames') { try{ setServerSaved(Array.isArray(data.list)?data.list:[]); }catch{ setServerSaved([]); } return; }
      if (data.type === 'savedDenied') {
        const pend = pendingSavedJoinRef.current;
        if(pend && (pend.claim || !pend.triedClaim)){
          pendingSavedJoinRef.current = { ...pend, triedClaim: true, claim: true };
          try{ const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); ws.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username: nm, userId: userIdRef.current && userIdRef.current(), otherUsername: pend.otherUsername, allowAny: false })); }catch{}
        } else {
          setTurnToast('Saved game not found or not yours'); setTimeout(()=>setTurnToast(null), 1200);
          pendingSavedJoinRef.current = null;
        }
        return;
      }
      if (data.type === 'savedRemoved') {
        try{ if(data.ok && data.gameId!=null){ setServerSaved(prev => Array.isArray(prev) ? prev.filter(x=>x.gameId!==data.gameId) : prev); } }catch{}
        return;
      }
      if (data.type === 'savedQueued') {
        const youRole = data.you === 2 ? 'Player 2' : 'Player 1';
        setPairedInfo({ you: data.you, usernames: data.usernames||{'Player 1':'P1','Player 2':'P2'}, colors: data.colors||{'Player 1':'#EF4444','Player 2':'#3B82F6'}, avatars: data.avatars||{'Player 1':'rocket','Player 2':'alien'}, characters: data.characters || { 'Player 1': characterId || 'astronaut', 'Player 2': 'alien' }, stakes: pairedInfo?.stakes||{}, gameId: data.gameId||null, token: data.token||null });
        setShowMatch(true); setCountdown(null); setLobbyStatus('matching');
        pendingSavedJoinRef.current = null;
        joinIntentRef.current = null;
        return;
      }
      if (data.type === 'paired') {
        setPairedInfo({
          you: data.you,
          usernames: data.usernames || { 'Player 1':'Player 1','Player 2':'Player 2' },
          colors: data.colors || { 'Player 1':'#EF4444','Player 2':'#3B82F6' },
          avatars: data.avatars || { 'Player 1':'rocket','Player 2':'alien' },
          characters: data.characters || { 'Player 1': characterId || 'astronaut', 'Player 2': 'alien' },
          stakes: data.stakes || (data.you===2 ? { 'Player 1':'—','Player 2':Number(stakeSC)||0 } : { 'Player 1':Number(stakeSC)||0,'Player 2':'—' }),
          roomId: data.roomId || data.gameId || null,
          gameId: data.gameId || null,
          token: data.token || null,
        });
        setShowMatch(true); setCountdown(null); setLobbyStatus('matching'); joinIntentRef.current = null; return;
      }
      if (data.type === 'quickChat'){
        const youRole = playerRoleRef.current || (pairedInfo?.you===2?'Player 2':'Player 1') || 'Player 1';
        const from = data.from === youRole ? 'you' : (data.from||'opp');
        setChatFeed(prev => [...prev, { from, username: data.username, text: String(data.text||'').slice(0,80), ts: Number(data.ts)||Date.now() }].slice(-12));
        return;
      }
      if (data.type === 'countdown' && typeof data.value === 'number') { setCountdown(data.value); return; }
      if (data.type === 'startGame') {
        setPresence({ 'Player 1': true, 'Player 2': true });
        setChatFeed([]);
        // defensively close any matchmaking UI
        setShowMatch(false);
        setLobbyStatus('idle', { force: true });
        setCountdown(null);
        gameActiveRef.current = true; settledOnceRef.current = false;
        const desiredFromText = Math.max(0.01, Number(stakeText) || Number(stakeSC) || 0);
        (async () => { if (lockedStakeRef.current <= 0) await lockStake(desiredFromText); })();

        setIsGameStarted(true); setWinner(null);
  const role = data.playerNumber === 1 ? 'Player 1' : 'Player 2';
        setPlayerRole(role); setCurrentPlayer(data.currentPlayer || 'Player 1');
        joinIntentRef.current = null;

        // cache resume tokens
        try{
          const gid = data.gameId || (pairedInfo && pairedInfo.gameId) || null;
          const tok = data.token || (pairedInfo && pairedInfo.token) || null;
          setPairedInfo(prev => ({ ...(prev||{}), gameId: gid, token: tok }));
          if (gid && tok) localStorage.setItem('cfResume', JSON.stringify({ gameId: gid, token: tok }));
        }catch{}
        if (data.usernames) {
          const n1=(data.usernames['Player 1']||'Player 1').slice(0,16); const n2=(data.usernames['Player 2']||'Player 2').slice(0,16);
          setMyName(role==='Player 1'?n1:n2); setOppName(role==='Player 1'?n2:n1);
        } else { const me=(localStorage.getItem('username')||'You').slice(0,16); setMyName(me||'You'); setOppName(role==='Player 1'?'Player 2':'Player 1'); }

        if (data.colors) {
          setColors({'Player 1':data.colors['Player 1']||'#EF4444','Player 2':data.colors['Player 2']||'#3B82F6'});
          const myColor = data.colors[role] || (role==='Player 1'?'#EF4444':'#3B82F6');
          if (role==='Player 1') localStorage.setItem('cfColor', myColor);
          setSelectedColor(myColor);
        } else {
          const myColor = role==='Player 1'?'#EF4444':'#3B82F6';
          setColors({'Player 1':'#EF4444','Player 2':'#3B82F6'}); setSelectedColor(myColor); localStorage.setItem('cfColor', myColor);
        }

  const av=data.avatars||{'Player 1':'rocket','Player 2':'alien'};
  setMyAvatarId(av[role]||localStorage.getItem('cfAvatar')||'rocket');
  setOppAvatarId(av[role==='Player 1'?'Player 2':'Player 1']||'alien');

  // Characters (3D model selection) — independent from emoji avatars
  const ch = data.characters || (pairedInfo && pairedInfo.characters) || { 'Player 1': characterId || 'astronaut', 'Player 2': 'alien' };
  const myChar = ch[role] || characterId || 'astronaut';
  const oppChar = ch[role==='Player 1'?'Player 2':'Player 1'] || 'alien';
  try { localStorage.setItem('cfCharacter', myChar); } catch {}
  setCharacterId(myChar);
  setOppCharacterId(oppChar);

  if (data.stakes) setPairedInfo(prev=>prev?{...prev,stakes:data.stakes, gameId: data.gameId||prev?.gameId, token: data.token||prev?.token}:{you:role==='Player 2'?2:1,stakes:data.stakes, gameId: data.gameId||null, token: data.token||null});

  const initBoard = Array.isArray(data.board) && data.board.length === ROWS ? data.board : makeBoard();
  setBoard(initBoard); prevBoardRef.current=initBoard.map(r=>r.slice()); setLastMove(null);
        setRematchVotes(0); setHasVotedRematch(false); setLobbyStatus('idle',{force:true});

        const yours=(data.currentPlayer||'Player 1')===role;
        setTurnToast(yours?"It's your turn!":"It's your opponent's turn!"); setTimeout(()=>setTurnToast(null),1100);
        // flush any pending chat queued during reconnect
        try{
          const msg = pendingChatRef.current;
          if (msg && wsRef.current && wsRef.current.readyState===WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type:'quickChat', text: String(msg).slice(0,80) }));
          }
          pendingChatRef.current = null;
        }catch{}
        return;
      }
  if (data.type === 'avatarUpdate' && data.side) {
        // Cache the latest remote avatar target; always allow yaw-only updates so turning-in-place is visible
        try {
          const you = playerRoleRef.current || (pairedInfo?.you===2?'Player 2':'Player 1') || 'Player 1';
          const remoteSide = (you === 'Player 1') ? 'Player 2' : 'Player 1';
          if (data.side === remoteSide) {
            const prev = (window.__CF_REMOTE_AVATAR__ || {});
            const gx = Number(data.x);
            const gz = Number(data.z);
            const gts = Number(data.ts) || Date.now();
            const gyaw = (typeof data.yaw === 'number') ? Number(data.yaw) : null;
            const grun = !!data.run;
            const gjump = !!data.isJumping;
            const glift = (typeof data.lift === 'number' && Number.isFinite(data.lift)) ? Number(data.lift) : undefined;
            const pts = Number(prev.ts) || 0;
            // If we have valid x/z away from origin, update full pose
            const nearZero = Number.isFinite(gx) && Number.isFinite(gz) && (Math.abs(gx) < 0.0005 && Math.abs(gz) < 0.0005);
            if (Number.isFinite(gx) && Number.isFinite(gz) && !nearZero) {
              if (gts >= pts) {
                window.__CF_REMOTE_AVATAR__ = { x: gx, z: gz, ts: gts, side: data.side, yaw: gyaw, run: grun, isJumping: gjump, lift: glift };
              }
            } else if (typeof gyaw === 'number') {
              // Yaw-only update: preserve last known x/z and just update yaw/time/run
              const keepX = Number.isFinite(prev.x) ? Number(prev.x) : 0;
              const keepZ = Number.isFinite(prev.z) ? Number(prev.z) : 0;
              const nts = Math.max(gts, pts + 1); // ensure monotonic ts
              window.__CF_REMOTE_AVATAR__ = { x: keepX, z: keepZ, ts: nts, side: data.side, yaw: gyaw, run: grun, isJumping: gjump, lift: glift };
            }
          }
        } catch {}
        return;
      }
      if (data.type === 'playerLeft' && data.side) {
        setPresence(prev => ({ ...prev, [data.side]: false }));
        setTurnToast('Opponent disconnected — waiting…'); setTimeout(()=>setTurnToast(null), 1400);
        return;
      }
      if (data.type === 'playerBack' && data.side) {
        setPresence(prev => ({ ...prev, [data.side]: true }));
        setTurnToast('Opponent reconnected'); setTimeout(()=>setTurnToast(null), 1200);
        return;
      }

      if (data.type === 'usernames' && data.usernames) {
        const role=playerRoleRef.current; const n1=(data.usernames['Player 1']||'Player 1').slice(0,16); const n2=(data.usernames['Player 2']||'Player 2').slice(0,16);
        setMyName(role==='Player 1'?n1:n2); setOppName(role==='Player 1'?n2:n1); return;
      }
      if (data.type === 'avatars' && data.avatars) {
        const role=playerRoleRef.current || (pairedInfo?.you===2?'Player 2':'Player 1');
        setMyAvatarId(data.avatars[role]||myAvatarId);
        setOppAvatarId(data.avatars[role==='Player 1'?'Player 2':'Player 1']||oppAvatarId);
        return;
      }
      if (data.type === 'stakes') {
        setPairedInfo(prev => {
          if (prev) return { ...prev, stakes: data.stakes };
          const youNum = playerRoleRef.current === 'Player 2' ? 2 : 1;
          return { you: youNum, stakes: data.stakes };
        });
        return;
      }

      if (data.type === 'gameUpdate') {
        const nextBoard = data.board || makeBoard();
        const move = data.lastMove && typeof data.lastMove.row==='number' ? data.lastMove
                    : (()=>{for(let r=ROWS-1;r>=0;r--){for(let c=0;c<COLUMNS;c++){if(prevBoardRef.current[r][c]==null && nextBoard[r][c]!=null) return {row:r,col:c};}}return null;})();
        setBoard(nextBoard); prevBoardRef.current = nextBoard.map(r=>r.slice());
        if (move){ setLastMove(move); if (!data.winner) scheduleImpactSound(); else { if (playTimerRef.current){clearTimeout(playTimerRef.current); playTimerRef.current=null;} } } else setLastMove(null);

        const prev=currentPlayerRef.current; const next=data.currentPlayer||'Player 1';
        if (!data.winner && prev && next!==prev && playerRoleRef.current) {
          const yours = next===playerRoleRef.current;
          setTurnToast(yours?"It's your turn!":"It's your opponent's turn!"); setTimeout(()=>setTurnToast(null),1100);
        }
        setCurrentPlayer(next); setWinner(data.winner||null);

        if (data.winner && !settledOnceRef.current) {
          settledOnceRef.current=true;
          const myRole=playerRoleRef.current; const oppRole=myRole==='Player 1'?'Player 2':'Player 1';
          const stakes=(pairedInfo&&pairedInfo.stakes)||data.stakes||{};
          const myStake=Number(stakes?.[myRole])||lockedStakeRef.current||Number(stakeSC)||0;
          const oppStake=Number(stakes?.[oppRole])||myStake;
          if (data.winner===myRole){
            settleWin(myStake,oppStake);
            const nw=player1Wins+(myRole==='Player 1'?1:0), nw2=player2Wins+(myRole==='Player 2'?1:0);
            if (myRole==='Player 1'){ setPlayer1Wins(nw); localStorage.setItem('player1Wins',String(nw)); }
            else { setPlayer2Wins(nw2); localStorage.setItem('player2Wins',String(nw2)); }
          } else {
            lockedStakeRef.current=0;
            const nw=player1Wins+(data.winner==='Player 1'?1:0), nw2=player2Wins+(data.winner==='Player 2'?1:0);
            setPlayer1Wins(nw); localStorage.setItem('player1Wins',String(nw));
            setPlayer2Wins(nw2); localStorage.setItem('player2Wins',String(nw2));
          }
        }
        return;
      }

      if (data.type === 'rematchUpdate') { const count=typeof data.count==='number'?data.count:rematchVotes; setRematchVotes(Math.max(0,Math.min(2,count))); return; }

      if (data.type === 'rematchStart') {
        gameActiveRef.current=true; settledOnceRef.current=false;
        const clean=makeBoard(); setBoard(clean); prevBoardRef.current=clean.map(r=>r.slice());
        setWinner(null); setCurrentPlayer('Player 1'); setLastMove(null); setRematchVotes(0); setHasVotedRematch(false);
        setTurnToast("It's your turn!"); setTimeout(()=>setTurnToast(null),1100);
        const desired=Math.max(0.01,Number(stakeText)||Number(stakeSC)||0);
        (async()=>{ if (lockedStakeRef.current<=0) await lockStake(desired); })();
        return;
      }

      if (data.type === 'opponentLeft') {
        // No refund on disconnect when saved/rejoin is supported
        setShowMatch(false); setPairedInfo(null); setCountdown(null);
        gameActiveRef.current=false; setIsGameStarted(false); setWinner(null); setPlayerRole(null);
        setCurrentPlayer('Opponent left — back to lobby');
        const clean=makeBoard(); setBoard(clean); prevBoardRef.current=clean.map(r=>r.slice()); setLastMove(null);
        setRematchVotes(0); setHasVotedRematch(false); setLobbyStatus('idle',{force:true}); return;
      }

      if (data.type === 'end') {
        if (!settledOnceRef.current) refundStake('match end (refund)');
        setShowMatch(false); setPairedInfo(null); setCountdown(null);
        gameActiveRef.current=false; setIsGameStarted(false); setWinner(null); setPlayerRole(null);
        setCurrentPlayer('Back to lobby');
        const clean=makeBoard(); setBoard(clean); prevBoardRef.current=clean.map(r=>r.slice()); setLastMove(null);
        setRematchVotes(0); setHasVotedRematch(false); setLobbyStatus('idle',{force:true}); return;
      }
    };

    ws.onclose = () => {
      setWsReady(false);
      if (gameActiveRef.current || showMatch) {
        setCurrentPlayer('Reconnecting…');
        setTimeout(()=>connectWSRef.current(true),300);
      } else { setLobbyStatus('idle',{force:true}); setCurrentPlayer('Disconnected — click Join to play'); }
    };
  }, [pairedInfo, stakeText, stakeSC, lockStake, setLobbyStatus, showMatch, myAvatarId, oppAvatarId]);

  useEffect(() => {
    // When the game starts, ensure page is scrolled to top and prevent scroll jank
    if (isGameStarted) {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      } catch {}
      try {
        const app = document.querySelector('.app-content');
        if (app) { app.scrollTop = 0; app.style.overflow = 'hidden'; }
        document.documentElement && (document.documentElement.style.overflow = 'hidden');
        document.body && (document.body.style.overflow = 'hidden');
      } catch {}
    } else {
      try {
        const app = document.querySelector('.app-content');
        if (app) { app.style.overflow = 'auto'; }
        document.documentElement && (document.documentElement.style.overflow = 'auto');
        document.body && (document.body.style.overflow = 'auto');
      } catch {}
    }
    return () => {
      try {
        const app = document.querySelector('.app-content'); if (app) app.style.overflow = 'auto';
        document.documentElement && (document.documentElement.style.overflow = 'auto');
        document.body && (document.body.style.overflow = 'auto');
      } catch {}
    };
  }, [isGameStarted]);

  useEffect(() => {
    const backoff = { current: 300 };
    connectWSRef.current = (isRetry=false) => {
      const cur=wsRef.current;
      if (cur && (cur.readyState===WebSocket.OPEN || cur.readyState===WebSocket.CONNECTING)) return;
      const delay=isRetry?Math.min(backoff.current,5000):0;
      const doConnect=()=>{ const url=getWsUrl(); console.log('[WS] connect:',url,'(retry:',isRetry,')'); const ws=new WebSocket(url); wsRef.current=ws; attachHandlers(ws); backoff.current=isRetry?Math.min(backoff.current*2,5000):300; setTimeout(()=>{
        try{ if(ws.readyState===WebSocket.OPEN){ ws.send(JSON.stringify({ type:'listMySavedGames', username: (localStorage.getItem('username')||username||'').toString().slice(0,40), userId: userIdRef.current && userIdRef.current() })); } }catch{}
      }, 250); };
      if (delay) setTimeout(doConnect,delay); else doConnect();
    };
  }, [attachHandlers]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    connectWSRef.current(false);
    return () => {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      cleanSocket();
    };
  }, [cleanSocket]);

  // Listen for global Gaming Profile updates (NavBar)
  useEffect(()=>{
    const applyProfile = ()=>{
      try{
        const n = localStorage.getItem('username') || '';
        const a = localStorage.getItem('profileAvatar') || '';
        const c = localStorage.getItem('profileColor') || '';
        if (n) setUsername(n.slice(0,16));
        if (a) { setAvatarId(a); setMyAvatarId(a); }
        if (c) setSelectedColor(c);
      }catch{}
    };
    window.addEventListener('profile:update', applyProfile);
    window.addEventListener('storage', applyProfile);
    return ()=>{
      window.removeEventListener('profile:update', applyProfile);
      window.removeEventListener('storage', applyProfile);
    };
  },[]);

  // Refresh server-side saved list when username changes (like Chess). Do not require username.
  useEffect(() => {
    try{
      const ws = wsRef.current;
      if(ws && ws.readyState === WebSocket.OPEN){
        try{ ws.send(JSON.stringify({ type:'listMySavedGames', username: (localStorage.getItem('username') || username || '').toString().slice(0,40), userId: userIdRef.current && userIdRef.current() })); }catch{}
      } else {
        // open a lightweight connection to fetch list, no auto-resume
        connectWSRef.current(false);
      }
    }catch{}
  }, [username]);

  // Periodically refresh saved list while idle in lobby so entries appear automatically
  useEffect(() => {
    let timer = null;
    const tick = () => {
      try{
        if (isGameStarted) return;
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type:'listMySavedGames', username: (localStorage.getItem('username') || username || '').toString().slice(0,40), userId: userIdRef.current && userIdRef.current() }));
        }
      }catch{}
    };
    timer = setInterval(tick, 12000);
    return () => { if (timer) clearInterval(timer); };
  }, [isGameStarted, username]);

  const withOpenSocket = (cb) => {
    const cur = wsRef.current;
    if (cur && cur.readyState === WebSocket.OPEN) { cb(cur); return; }
    if (cur && cur.readyState === WebSocket.CONNECTING) { setTimeout(() => withOpenSocket(cb), 120); return; }
    connectWSRef.current(true);
    setTimeout(() => withOpenSocket(cb), 180);
  };

  const handleCellClick = (_row, col) => {
    if (winner || !isGameStarted || playerRole !== currentPlayer) return;
    withOpenSocket((sock) => sock.send(JSON.stringify({ type: 'makeMove', col })));
  };

  const handleJoinGame = async () => {
    dropSound.prime();
    const name = (username || 'You').trim().slice(0, 16);
    const stake = Math.max(0.01, Number(stakeText) || Number(stakeSC) || 0);
    setStakeSC(stake);
    setStakeText(stake.toFixed(2));

    localStorage.setItem('username', name);
    localStorage.setItem('cfColor', selectedColor);
    localStorage.setItem('cfAvatar', avatarId);
  localStorage.setItem('cfCharacter', characterId);
    localStorage.setItem('cfStake', String(stake));
    const ok = await lockStake(stake);
    if (!ok) return;

    // Prevent auto-resume on the next socket open
    joinIntentRef.current = 'new';
    withOpenSocket((sock) => {
      try {
        sock.send(JSON.stringify({ type:'joinGame', username:name, userId: userIdRef.current && userIdRef.current(), color:selectedColor, avatar:avatarId, character: characterId, stake }));
      } catch {}
      setLobbyStatus('queued'); setShowMatch(true); setPairedInfo(null); setCountdown(null);
    });
  };

  // Feed for 3D view: send my live avatar movement over the socket
  const handleAvatarMove = useCallback((msg) => {
    if (!msg || typeof msg.x !== 'number' || typeof msg.z !== 'number') return;
    const yaw = typeof msg.yaw === 'number' ? msg.yaw : null;
    const run = !!msg.run;
    const isJumping = !!msg.isJumping;
    const lift = (typeof msg.lift === 'number' && Number.isFinite(msg.lift)) ? Number(msg.lift) : undefined;
    withOpenSocket((sock) => {
      try {
        const payload = { type: 'avatarMove', x: msg.x, z: msg.z, yaw, run, isJumping };
        if (typeof lift === 'number') payload.lift = lift;
        sock.send(JSON.stringify(payload));
      } catch {}
    });
  }, []);

  const cancelMatchmaking = () => {
    pendingSavedJoinRef.current = null;
    // Avoid auto-resume on immediate reconnect
    joinIntentRef.current = 'suppress';
    setShowMatch(false); setPairedInfo(null); setCountdown(null);
    setLobbyStatus('idle', { force: true }); setCurrentPlayer('Canceled — back to lobby');
    refundStake('canceled matchmaking'); cleanSocket(); setTimeout(()=>connectWSRef.current(false),150);
  };

  const handleRematch = async () => {
    if (hasVotedRematch) return;
    setHasVotedRematch(true); setRematchVotes(v => Math.max(v, 1));
    const stake = Math.max(0.01, Number(stakeText) || Number(stakeSC) || 0);
    if (lockedStakeRef.current <= 0) { const ok = await lockStake(stake); if (!ok) return; }
    withOpenSocket(sock => { try { sock.send(JSON.stringify({ type:'rematchVote', stake })); } catch {} });
  };
  const handleLeave = () => {
    pendingSavedJoinRef.current = null;
    withOpenSocket(sock => { try { sock.send(JSON.stringify({ type:'leaveGame' })); } catch {} });
    setShowMatch(false); setPairedInfo(null); setCountdown(null);
    gameActiveRef.current=false; setIsGameStarted(false); setWinner(null); setPlayerRole(null);
    setRematchVotes(0); setHasVotedRematch(false); setCurrentPlayer('Left game — back to lobby');
    const clean=makeBoard(); setBoard(clean); prevBoardRef.current=clean.map(r=>r.slice()); setLastMove(null);
    setLobbyStatus('idle',{force:true});
    // Avoid instantly rejoining saved game on reconnect; we still keep cfResume for later
    joinIntentRef.current = 'suppress';
    cleanSocket(); connectWSRef.current(false);
  };

  const refreshSaved = () => {
    const nm = (localStorage.getItem('username') || username || '').toString().slice(0,40);
    if(!nm){ alert('Set a username to fetch your saved games.'); return; }
    withOpenSocket(sock => { try{ sock.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} });
  };
  const claimSaved = (gameId, otherUsername) => {
    // Prefer exact slot using local resume token if we have it; else fall back to claim
    try{
      let useJoin = false;
      let token = null;
      const raw = localStorage.getItem('cfResume');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && Number(obj.gameId) === Number(gameId) && obj.token) {
          useJoin = true; token = String(obj.token);
        }
      }
      if (useJoin) {
        pendingSavedJoinRef.current = { gameId, token, sent: false, claim: false, allowAny: false };
      } else {
        pendingSavedJoinRef.current = { gameId, triedClaim: false, sent: false, claim: true, otherUsername, allowAny: false };
      }
    }catch{
      pendingSavedJoinRef.current = { gameId, triedClaim: false, sent: false, claim: true, otherUsername, allowAny: false };
    }
    const tryImmediateSend = () => {
      try{
        const ws = wsRef.current;
        const nm = (localStorage.getItem('username') || username || '').toString().slice(0,40);
        const uid = userIdRef.current && userIdRef.current();
        const pend = pendingSavedJoinRef.current;
        if(ws && ws.readyState === WebSocket.OPEN && pend && !pend.sent){
          if(pend.claim){ ws.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username: nm, userId: uid, otherUsername: pend.otherUsername, allowAny: false })); }
          else { ws.send(JSON.stringify({ type:'joinSavedGame', gameId: pend.gameId, token: pend.token, username: nm, userId: uid, allowAny: false })); }
          pendingSavedJoinRef.current = { ...pend, sent: true };
          return true;
        }
      }catch{}
      return false;
    };

    if(!tryImmediateSend()){
      connectWSRef.current(false);
    }
    setShowMatch(true);
    setPairedInfo(null);
    setLobbyStatus('matching');
    setCountdown(null);
    setTurnToast('Connecting to saved game…'); setTimeout(()=>setTurnToast(null), 900);
  };
  const removeSaved = (gameId) => {
    const nm = (localStorage.getItem('username') || username || '').toString().slice(0,40);
    withOpenSocket(sock => { try{ sock.send(JSON.stringify({ type:'finishSavedGame', gameId, username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} });
    // optimistic removal; server will also echo savedRemoved
    setServerSaved(list => list.filter(x => x.gameId !== gameId));
  };

  // kill weird legacy hover circle
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `.col-hover { display: none !important; }`;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const isWinner = Boolean(winner && playerRole && winner === playerRole);
  const showOverlay = Boolean(winner && isGameStarted);
  const myRole = playerRole || '—';
  const myColor = colors[playerRole] || (playerRole === 'Player 2' ? '#3B82F6' : '#EF4444');
  const oppRole = playerRole === 'Player 1' ? 'Player 2' : 'Player 1';
  const oppColor = colors[oppRole] || '#3B82F6';
  const showNeutralLobby = !isGameStarted && (lobbyRef.current === 'idle' || lobbyRef.current === 'waiting');
  const showSearching    = !isGameStarted && (lobbyRef.current === 'queued' || lobbyRef.current === 'matching');
  const fmtSC = (n) => `${(Number(n) || 0).toFixed(2)} SC`;

  const fmtStakeMM = (v) =>
    (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(2) + ' SC' :
    (typeof v === 'string' && v !== '—' && v !== '') ? (Number(v)||0).toFixed(2) + ' SC' :
    (v || '—');

  return (
    <div className={`cf-page ${embedded ? 'cf-embed' : ''}`} onClick={primeAudio}>
      {!embedded && <NavBar />}
      {!embedded && <div className="nav-spacer" />}

  {/* Single LED bar at the very top (War vibe) — hide in embedded mode */}
  {!embedded && <LedBar color="rgba(255,110,220,0.95)" speed={3} />}

      {/* Full-bleed container, board not small on PC */}
      <div className="container-fluid px-0">
        <div className="row justify-content-center g-0 position-relative">
          <div className="col-12">

            {/* Header with LED frame */}
         
              <div className="cf-hero px-2 py-2">
                <div className="d-flex flex-column gap-2">
                  <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2">
                    <div className="d-flex align-items-center gap-2">
                      <div className="badge-row">
                        <span className="badge-chip">
                          <i className="bi bi-person-check" />
                          {isGameStarted ? `You're ${myRole}` :
                            (lobbyRef.current === 'queued' ? 'Queued…' :
                            lobbyRef.current === 'matching' ? 'Matching…' : 'Ready to play')}
                        </span>

                        <span className="badge-chip">
                          <i className="bi bi-wallet2" />
                          Balance: <strong className="ms-1">{fmtSC(scBalance)}</strong>
                        </span>

                        <span className="badge-chip" style={{ background: myColor, color: contrastText(myColor), fontWeight: 900 }}>
                          {myName || 'You'}
                        </span>

                        {isGameStarted && (
                          <div className="vs-row">
                            <Avatar id={myAvatarId} size={22} />
                            <span className="vs-name">{myName || 'You'}</span>
                            <span className="vs-sep">VS</span>
                            <Avatar id={oppAvatarId} size={22} />
                            <span className="vs-name">{oppName || 'Opponent'}</span>
                          </div>
                        )}

                        <span className="badge-chip">
                          <i className="bi bi-hourglass-split" />
                          {winner ? `${winner} wins!` : (isGameStarted ? `Turn: ${currentPlayer}` : 'Idle')}
                        </span>

                        {isGameStarted && (
                          <span className="badge-chip">
                            <i className="bi bi-palette-fill" />
                            {oppRole}: <span className="opp-dot" style={{background:oppColor}} />
                          </span>
                        )}
                        {isGameStarted && (
                          <span className="badge-chip">
                            <i className="bi bi-wifi" /> Opponent: {presence[oppRole] ? 'Online' : 'Offline'}
                          </span>
                        )}
                      </div>

                      <button className="mute-btn ms-md-2" onClick={(e)=>{e.stopPropagation(); setMuted(prev=>!prev);}} title={muted?'Unmute':'Mute'}>
                        <i className={`bi ${muted ? 'bi-volume-mute-fill' : 'bi-volume-up-fill'}`} />
                        <span className="mute-label">{muted ? 'Muted' : 'Sound'}</span>
                      </button>

                      {false && isGameStarted && (
                        <button className="btn btn-outline-light btn-sm ms-2" onClick={(e)=>{ e.stopPropagation(); handleLeave(); }} title="Leave game" style={{ borderRadius: '999px', padding: '6px 10px', fontWeight: 800 }}>
                          <i className="bi bi-door-open me-1"/> Leave
                        </button>
                      )}
                    </div>
                  </div>

                  {showSearching && !showMatch && (
                    <div className="lobby-strip" style={{justifyContent:'center'}}>
                      <div className="mm-dots"><div className="mm-dot" /><div className="mm-dot" /><div className="mm-dot" /></div>
                      <span className="lobby-text">Looking for an opponent…</span>
                    </div>
                  )}
                </div>
              </div>
           

            {/* Pre-game: show setup only, no board UI rendered */}
            {!isGameStarted && showNeutralLobby && (
              <>
                <div className="d-flex justify-content-center px-lg-3 pt-0 pb-3">
                  <div className="prejoin-float" style={{ width:'100%' }} onClick={(e)=>e.stopPropagation()}>
                    <PreGameSetup
                      username={username}
                      setUsername={setUsername}
                      selectedColor={selectedColor}
                      setSelectedColor={setSelectedColor}
                      stakeText={stakeText}
                      setStakeText={setStakeText}
                      characterId={characterId}
                      onPickCharacter={setCharacterId}
                      avatarId={avatarId}
                      setShowAvatarModal={setShowAvatarModal}
                      scBalance={scBalance}
                      onJoin={handleJoinGame}
                      serverSaved={serverSaved}
                      refreshSaved={refreshSaved}
                      claimSaved={claimSaved}
                    />
                  </div>
                </div>
                {/* Safe-area bottom spacer so last saved card / actions are not clipped */}
                <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 18px)' }} />
              </>
            )}

            {/* Board area: render only after game starts */}
            {isGameStarted && (
              <div className="board-full-wrap">
                {(() => {
                  const fsNode = (
                    <div className="c4-fs-shell">
                      {/* Turn toast & Win/Loss overlay rendered inside portal so they are above Canvas */}
                      {turnToast && <div className="turn-toast">{turnToast}</div>}
                      {showOverlay && (
                        <div className="winlose-overlay">
                          <div className="winlose-card position-relative">
                            {isWinner && <div className="win-glow" aria-hidden="true" />}
                            <h2 className="winlose-title mb-2">
                              {isWinner ? (<><i className="bi bi-trophy-fill text-success" />You won!</>) : (<><i className="bi bi-emoji-frown-fill text-danger" />You lost!</>)}
                            </h2>
                            <div className="winlose-actions">
                              <button className="btn btn-success btn-resp" onClick={handleRematch}><i className="bi bi-arrow-repeat me-1" /> Rematch ({rematchVotes}/2)</button>
                              <button className="btn btn-outline-secondary btn-resp" onClick={handleLeave}><i className="bi bi-door-open me-1" /> Leave</button>
                            </div>
                          </div>
                        </div>
                      )}
                      <ConnectFour3DView
                        board={board}
                        lastMove={lastMove}
                        colors={colors}
                        myCharacterId={characterId}
                        oppCharacterId={oppCharacterId}
                        flip180={playerRole === 'Player 2'}
                        myName={myName}
                        oppName={oppName}
                        onAvatarMove={handleAvatarMove}
                        onSelectColumn={(col)=>{
                          const r = (()=>{ for(let rr=ROWS-1; rr>=0; rr--){ if(!board[rr][col]) return rr; } return null; })();
                          if (r==null) return;
                          handleCellClick(r, col);
                        }}
                      />
                    </div>
                  );
                  try { return ReactDOM.createPortal(fsNode, document.body); } catch { return null; }
                })()}
                {/* Bottom actions below entire board */}
                <div className="board-actions">
                  {isGameStarted && (
                    <>
                      {winner && (
                        <button className="btn btn-success btn-resp" onClick={handleRematch}>
                          <i className="bi bi-arrow-repeat me-1" /> Rematch ({rematchVotes}/2)
                        </button>
                      )}
                      <button className="btn btn-outline-secondary btn-resp" onClick={handleLeave}>
                        <i className="bi bi-door-open me-1" /> Leave
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* QuickChat absolutely positioned within page, right-aligned below nav; show only during game */}
            {isGameStarted && (
              <QuickChat
                onSend={(text)=>{
                  const t = String(text||'').slice(0,80);
                  const sock = wsRef.current;
                  const inRoom = !!playerRoleRef.current;
                  if (sock && sock.readyState === WebSocket.OPEN && inRoom) {
                    try { sock.send(JSON.stringify({ type:'quickChat', text: t })); } catch {}
                  } else {
                    // Queue until we’re in-room; do not force resume
                    pendingChatRef.current = t;
                    if (!sock || sock.readyState !== WebSocket.OPEN) connectWSRef.current(true);
                  }
                }}
                messages={chatFeed}
                youKey="you"
                align="right"
                canSend={wsReady}
              />
            )}

          </div>
        </div>
      </div>

      {(() => {
        try{
          if(!isGameStarted || !playerRole) return null;
          const opp = playerRole === 'Player 1' ? 'Player 2' : 'Player 1';
          const oppMissing = presence[opp] === false;
          return (<WaitingOverlay show={!!oppMissing} />);
        }catch{return null;}
      })()}

      {/* ===== Matchmaking Modal ===== */}
      {showMatch && (
        <div className="match-overlay">
          <div className="match-card">
            <div className="match-header">
              <h3>Matchmaking</h3>
              <button className="mm-cancel" onClick={cancelMatchmaking}>Cancel</button>
            </div>

            <div className="match-body">
              {(() => {
                const youRole = pairedInfo?.you === 2 ? 'Player 2' : 'Player 1';
                const oppRole2 = youRole === 'Player 1' ? 'Player 2' : 'Player 1';
                const youName = pairedInfo?.usernames?.[youRole] ?? (username || 'You');
                const oppNameMM = pairedInfo?.usernames?.[oppRole2] ?? 'Searching…';
                const youColor = pairedInfo?.colors?.[youRole] ?? selectedColor;
                const oppColorMM = pairedInfo?.colors?.[oppRole2] ?? '#3B82F6';
                const youAvatar = pairedInfo?.avatars?.[youRole] ?? avatarId;
                const oppAvatar = pairedInfo?.avatars?.[oppRole2] ?? null;
                const youStake = pairedInfo?.stakes?.[youRole];
                const oppStake = pairedInfo?.stakes?.[oppRole2];

                return (
                  <>
                    <div className="match-col">
                      <div className="mm-avatar" title="Your avatar">{findAvatar(youAvatar).glyph}</div>
                      <div className="mm-pill"><i className="bi bi-person-badge" />{youName}</div>
                      <div className="mm-pill"><i className="bi bi-palette-fill" />Color <span className="mm-swab" style={{ background: youColor, marginLeft: 6 }} /></div>
                      <div className="mm-pill"><i className="bi bi-coin" />Your bet: <strong className="ms-1">{fmtStakeMM(((youStake ?? Number(stakeSC)) || 0))}</strong></div>
                    </div>

                    <div className="match-divider">VS</div>

                    <div className="match-col">
                      <div className="mm-avatar" title="Opponent avatar">
                        {oppAvatar ? findAvatar(oppAvatar).glyph : (
                          <div className="mm-dots"><div className="mm-dot" /><div className="mm-dot" /><div className="mm-dot" /></div>
                        )}
                      </div>
                      <div className="mm-pill"><i className="bi bi-person-badge" />{oppAvatar ? oppNameMM : 'Searching…'}</div>
                      <div className="mm-pill"><i className="bi bi-palette-fill" />Color <span className="mm-swab" style={{ background: oppColorMM, marginLeft: 6 }} /></div>
                      <div className="mm-pill"><i className="bi bi-coin" />Opponent bet: <strong className="ms-1">{fmtStakeMM(oppStake)}</strong></div>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="mm-footer">
              {typeof countdown === 'number'
                ? <div className="mm-pill">Game starts in <strong style={{marginLeft:4}}>{countdown}</strong>…</div>
                : <div className="mm-pill">Waiting for opponent…</div>}
            </div>
          </div>
        </div>
      )}

      {/* ===== Avatar Picker Modal ===== */}
      {showAvatarModal && (
        <div className="avatar-modal" onClick={() => setShowAvatarModal(false)}>
          <div className="avatar-card" onClick={e => e.stopPropagation()}>
            <div className="avatar-hd">
              <strong>Choose your avatar</strong>
              <button className="mm-cancel" onClick={() => setShowAvatarModal(false)}>Close</button>
            </div>

            <div className="avatar-grid">
              {AVATAR_SET.map(a => (
                <button
                  key={a.id}
                  className="avatar-btn"
                  onClick={() => { setAvatarId(a.id); setMyAvatarId(a.id); localStorage.setItem('cfAvatar', a.id); setShowAvatarModal(false); }}
                  title={a.label}
                >
                  <div className="avatar-hero">{a.glyph}</div>
                  <div className="avatar-name">{a.label}</div>
                </button>
              ))}
            </div>

            <div className="avatar-ft">
              <button className="mm-cancel" onClick={() => setShowAvatarModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* --- LED & arcade skin (scoped) --- */}
      <style jsx>{`
        @keyframes gflash { 0%,100%{opacity:1} 50%{opacity:.45} }

        .cf-page { min-height: 100vh; color: var(--text);
          background: var(--bg-body); }
        .nav-spacer { height: var(--nav-h, 56px); }

        /* Top LED bar (single) */
        .led-topbar { position: relative; width: 100vw; left: 50%; right: 50%; margin-left:-50vw; margin-right:-50vw; height: 8px; }
        .led-run { position:absolute; inset:0; background:linear-gradient(90deg, transparent, var(--led-color), transparent);
          background-size:200% 100%; animation: ledScroll var(--led-speed) linear infinite; filter: drop-shadow(0 0 6px var(--led-color)); }
        @keyframes ledScroll { 0%{background-position:0% 0} 100%{background-position:200% 0} }

        /* Fancy LED/glow color swatches */
        .led-swatch { position:relative; padding:0; border:none; outline:none; cursor:pointer; display:inline-grid; place-items:center; }
        .led-swatch .led-ring {
          position:absolute; inset:-6px; border-radius:999px;
          background: radial-gradient(closest-side, rgba(255,255,255,.45), transparent 60%),
                      conic-gradient(from 0deg, rgba(255,255,255,.0), rgba(255,255,255,.35), rgba(255,255,255,.0));
          animation: ringSpin 3.4s linear infinite; filter: blur(0.4px); pointer-events:none;
        }
        .led-swatch.is-active .led-ring { box-shadow: 0 0 14px rgba(255,255,255,.5), inset 0 0 8px rgba(255,255,255,.35); }
        @keyframes ringSpin { to { transform: rotate(360deg); } }

        .cf-hero { background: rgba(0,0,0,.35); border-radius: 1rem; }

        .badge-row { display:flex; flex-wrap:wrap; gap:8px; }
        .badge-chip { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
          background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); }
        .vs-row { display:flex; align-items:center; gap:8px; background:rgba(255,255,255,.16);
          padding:.28rem .55rem; border-radius:999px; }
        .vs-sep { opacity:.85; font-weight:900; margin-inline:6px; }
        .vs-name { font-weight:900; }
        .opp-dot { display:inline-block; width:12px; height:12px; border-radius:999px; margin-left:6px; margin-right:2px; border:1px solid rgba(0,0,0,.25); }

        .mute-btn { display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
          background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); color: var(--text); }
        .mute-btn .mute-label { font-size:.8rem; }

        .lobby-strip { display:flex; align-items:center; gap:10px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
          border-radius:999px; padding:6px 12px; }
        .mm-dots { display:flex; gap:6px; align-items:center; }
  .mm-dot { width:8px; height:8px; border-radius:999px; background: var(--text); opacity:.7; animation: dotblink 1.2s infinite ease-in-out; }
        .mm-dot:nth-child(2){ animation-delay:.15s } .mm-dot:nth-child(3){ animation-delay:.3s }
        @keyframes dotblink { 0%,100%{opacity:.35; transform:translateY(0)} 50%{opacity:1; transform:translateY(-2px)} }
        .lobby-text { opacity:.95; font-weight:700; }

        /* Board area */
  .board-full-wrap { position:relative; width:100%; max-width:100%; min-height: calc(100dvh - var(--nav-h, 56px) - var(--footer-h, 0px)); overflow:hidden; }
  .board-outer { width:100%; }
  .board-wrap { padding:10px 10px 0; height:100%; display:flex; flex-direction:column; }
  .cf-stage { flex: 1; display:flex; align-items: stretch; }
  .topright-controls{ display:none }
  .board-actions{ position:fixed; left:0; right:0; bottom:0; z-index:210; display:flex; justify-content:center; gap:.5rem; padding: .6rem 12px; background: linear-gradient(180deg, rgba(2,6,14,.0) 0%, rgba(2,6,14,.55) 20%, rgba(2,6,14,.85) 100%); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }

        @media (max-width: 640px){
    .board-outer{ padding-right: 0; }
          .board-actions{ padding: .4rem 8px; flex-wrap: wrap; }
        }
        .board-skin { border-radius:1rem; background: radial-gradient(120% 120% at 50% -10%, rgba(255,255,255,.06), rgba(0,0,0,.3)); }
        .board-glint { position:absolute; inset:0; border-radius:inherit; background: radial-gradient(50% 80% at 50% -20%, rgba(255,255,255,.18), transparent 60%); pointer-events:none; }

        .turn-toast { position:absolute; top:10px; left:50%; transform:translateX(-50%); z-index:5;
          background:linear-gradient(90deg,#ffe36e,#ffa761); color:#281400; padding:6px 10px; border-radius:999px;
          font-weight:800; box-shadow:0 10px 24px rgba(255,199,0,.25); }

        .winlose-overlay { position:absolute; inset:0; display:grid; place-items:center; z-index:6; }
  .winlose-card { background: var(--card-bg); border:1px solid var(--card-border); border-radius:16px; padding:18px 16px; color: var(--text); }
        .win-glow { position:absolute; inset:-8px; border-radius:20px; box-shadow:0 0 60px rgba(0,255,160,.35); }
        .winlose-title { display:flex; align-items:center; gap:10px; font-weight:900; }
        .winlose-actions { display:flex; gap:10px; justify-content:center; }

        /* Matchmaking modal */
        .match-overlay{ position:fixed; inset:0; display:grid; place-items:center; z-index:50; background:rgba(0,0,0,.45); backdrop-filter: blur(4px); }
        .match-card{ width:min(900px,95vw); background: var(--card-bg); border:1px solid var(--card-border);
          border-radius:20px; padding:18px; box-shadow:0 20px 50px rgba(0,0,0,.35); }
        .match-header{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
        .match-body{ display:grid; grid-template-columns:1fr auto 1fr; gap:12px; align-items:center; }
  .match-divider{ font-weight:800; font-size:18px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.1); color: var(--text); }
        .mm-avatar{ display:grid; place-items:center; font-size:42px; }
  .mm-pill{ display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.14); color: var(--text); }
        .mm-swab{ display:inline-block; width:14px; height:14px; border-radius:999px; border:1px solid rgba(0,0,0,.25); }
  .mm-cancel{ appearance:none; border:0; background:rgba(255,255,255,.08); color: var(--text); border-radius:10px; padding:6px 10px; cursor:pointer; }
        .mm-footer{ margin-top:10px; display:flex; justify-content:center; }

        /* Avatar modal */
        .avatar-modal{ position:fixed; inset:0; display:grid; place-items:center; background:rgba(0,0,0,.55); z-index:60; }
  .avatar-card{ width:min(720px,95vw); background: var(--card-bg); border:1px solid var(--card-border); border-radius:18px; padding:12px; color: var(--text); }
        .avatar-hd{ display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
        .avatar-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; }
  .avatar-btn{ display:grid; gap:6px; place-items:center; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:10px; color: var(--text); }
        .avatar-hero{ font-size:28px; }
        .avatar-ft{ display:flex; justify-content:flex-end; margin-top:10px; }

        /* Small tweaks */
        .btn-resp{ min-width:140px; }

        /* Saved games list styling (match Chess/Raumschach) */
        .prejoin-float { width: min(960px, 100%); }
        .saved-list { display: grid; grid-template-columns: 1fr; gap: 8px; }
        @media (min-width: 992px) { .saved-list { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } }
        .saved-card {
          background: linear-gradient(135deg, rgba(34,197,94,.12), rgba(20,184,166,.08));
          border: 1px solid rgba(255,255,255,.10);
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.05);
          transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
        }
        .saved-card:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.07); border-color: rgba(255,255,255,.16); }
        .name-pill { padding: 2px 10px; border-radius: 999px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); display: inline-flex; align-items: center; gap: 6px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .saved-meta { color: rgba(255,255,255,.75); }
        .saved-actions { display:flex; gap:8px; margin-left:auto; flex-wrap: wrap; }
        @media (max-width: 520px){ .saved-actions { width:100%; margin-left:0; margin-top:8px; } }
        @media (max-width: 360px){ .saved-actions .btn { flex:1 1 auto; min-width: 0; } }
      `}</style>
    </div>
  );
}
