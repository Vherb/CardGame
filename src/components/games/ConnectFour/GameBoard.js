/* eslint-disable no-console */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { Card, Row, Col, Button, Form, InputGroup, Badge } from "react-bootstrap";
import './GameBoard.css';
import NavBar from "./../../NavBar";

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
function LedBar({ color='rgba(255,110,220,0.95)', speed=3 }) {
  return (
    <div className="led-topbar">
      <div className="led-run" style={{ ['--led-color']: color, ['--led-speed']: `${speed}s` }} />
    </div>
  );
}

/* ========================= Constants ========================= */
const ROWS = 6;
const COLUMNS = 7;
const makeBoard = () => Array.from({ length: ROWS }, () => Array(COLUMNS).fill(null));

/* WebSocket endpoint (Render) */
const RENDER_WS = 'wss://con4-1.onrender.com/';
const getWsUrl = () => RENDER_WS;

/* ======= SC wallet helpers ======= */
const API =
  process.env.REACT_APP_API_BASE ||
  `http://${window.location.hostname}:3002`;

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
const AVATAR_SET=[{id:'rocket',label:'Rocket',glyph:'🚀'},{id:'dragon',label:'Dragon',glyph:'🐉'},{id:'brain',label:'Brain',glyph:'🧠'},{id:'fox',label:'Fox',glyph:'🦊'},{id:'lion',label:'Lion',glyph:'🦁'},{id:'panda',label:'Panda',glyph:'🐼'},{id:'penguin',label:'Penguin',glyph:'🧑‍🚀'},{id:'alien',label:'Alien',glyph:'👾'}];
const findAvatar=(id)=>AVATAR_SET.find(a=>a.id===id)||AVATAR_SET[0];
const Avatar=({id,size=22})=>{const a=findAvatar(id);return(<div style={{width:size,height:size,borderRadius:'50%',display:'grid',placeItems:'center',background:'#0f172a',color:'#fff',border:'2px solid rgba(255,255,255,.45)',boxShadow:'0 4px 10px rgba(0,0,0,.3)',fontSize:Math.round(size*.7),lineHeight:1}} aria-label={a.label} title={a.label}>{a.glyph}</div>);};

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
  scBalance,
  onJoin,
}) {
  return (
    <div className="prejoin-container">
      <Card.Header as="h3" className="fw-bold prejoin-header">
        Game Setup
        <Badge bg="light" text="dark" className="ms-2">Connect Four</Badge>
      </Card.Header>

      <Card.Body className="pb-3">
        <Row className="g-3 align-items-end">
          <Col xs={12} md={6}>
            <Form.Label className="fw-bold">
              <i className="bi bi-person-badge me-2" /> Screen Name
            </Form.Label>
            <InputGroup size="lg">
              <InputGroup.Text className="bg-dark-subtle text-light border-0">
                <i className="bi bi-person" />
              </InputGroup.Text>
              <Form.Control
                type="text"
                placeholder="Your name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-dark-subtle border-0 text-light"
                autoComplete="nickname"
                maxLength={16}
              />
            </InputGroup>
            <div className="small text-white mt-1">This is how other players will see you.</div>
          </Col>

          <Col xs={12} md={6}>
            <Form.Label className="fw-bold">
              <i className="bi bi-coin me-2" /> Stake (SC)
            </Form.Label>
            <InputGroup size="lg">
              <InputGroup.Text className="bg-dark-subtle text-light border-0">SC</InputGroup.Text>
              <Form.Control
                type="text"
                inputMode="decimal"
                placeholder="e.g. 1.00"
                value={stakeText}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d{0,6}(\.\d{0,2})?$/.test(v) || v === "") setStakeText(v);
                }}
                onBlur={() => {
                  const n = Math.max(0.01, Number(stakeText) || 0);
                  setStakeText(n.toFixed(2));
                }}
                className="bg-dark-subtle border-0 text-light"
              />
            </InputGroup>
            <div className="small text-white mt-1">
              Balance: <strong>{(Number(scBalance)||0).toFixed(2)} SC</strong>.
            </div>
          </Col>
        </Row>

        <Row className="g-3 mt-2">
          <Col xs={12} md={8}>
            <Form.Label className="fw-bold d-flex align-items-center">
              <i className="bi bi-palette-fill me-2" /> Chip Color
              <span className="ms-2 rounded-pill" style={{
                display:'inline-block',width:18,height:18,background:selectedColor,
                boxShadow:'inset 0 1px 0 rgba(255,255,255,.2), 0 6px 12px rgba(0,0,0,.35)'
              }}/>
            </Form.Label>

            <div className="d-flex flex-wrap gap-2">
              {PALETTE.map((hex) => (
                <ColorSwatch
                  key={hex}
                  hex={hex}
                  active={(selectedColor || '').toLowerCase() === hex.toLowerCase()}
                  onPick={setSelectedColor}
                />
              ))}
            </div>
            <div className="small text-secondary mt-2">Tip: choose a bright color for small screens.</div>
          </Col>

          <Col xs={12} md={4}>
            <Form.Label className="fw-bold d-flex align-items-center">
              <i className="bi bi-emoji-smile me-2" /> Avatar
            </Form.Label>
            <div className="d-flex align-items-center gap-2">
              <div className="avatar-xl"><Avatar id={avatarId} size={42} /></div>
              <Button variant="outline-light" size="sm" className="pill" title="Choose avatar" onClick={() => setShowAvatarModal(true)}>
                Change
              </Button>
            </div>
          </Col>
        </Row>
      </Card.Body>

      <Card.Footer className="bg-transparent border-0 pt-0 pb-3">
        <div className="d-grid">
          <Button
            variant="light"
            size="lg"
            className="fw-bold cta-join glimmer"
            onClick={onJoin}
            disabled={!username}
          >
            <i className="bi bi-play-fill me-1" />
            Join Game
          </Button>
        </div>
      </Card.Footer>
    </div>
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
  const [username, setUsername] = useState(() => (localStorage.getItem('username') || '').slice(0, 16));
  const [selectedColor, setSelectedColor] = useState(localStorage.getItem('cfColor') || '#EF4444');
  const [avatarId, setAvatarId] = useState(localStorage.getItem('cfAvatar') || 'rocket');

  const [colors, setColors] = useState({ 'Player 1': '#EF4444', 'Player 2': '#3B82F6' });
  const [myName, setMyName] = useState('You');
  const [oppName, setOppName] = useState('Opponent');
  const [myAvatarId, setMyAvatarId] = useState(avatarId);
  const [oppAvatarId, setOppAvatarId] = useState('alien');

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

  // sound timings
  const dropSound = useDropSound();
  const winSound = useAudioClip('/sounds/win.mp3', { volume: 0.9 });
  const loseSound = useAudioClip('/sounds/lose.mp3', { volume: 0.9 });
  const IMPACT_FRAC = 0.70;
  const FALL_ADVANCE_MS = 60;

  // refs
  const wsRef = useRef(null);
  const currentPlayerRef = useRef(currentPlayer);
  const playerRoleRef = useRef(playerRole);
  const mutedRef = useRef(muted);
  const prevBoardRef = useRef(makeBoard());
  const connectWSRef = useRef(() => {});
  const gameActiveRef = useRef(false);
  const playTimerRef = useRef(null);
  const didInitRef = useRef(false);
  const lobbyRef = useRef('idle');

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
    ws.onopen = () => { setLobbyStatus('idle', { force: true }); setCurrentPlayer('Looking for another player...'); };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'queued') { setLobbyStatus('queued'); return; }
      if (data.type === 'paired') {
        setPairedInfo({
          you: data.you,
          usernames: data.usernames || { 'Player 1':'Player 1','Player 2':'Player 2' },
          colors: data.colors || { 'Player 1':'#EF4444','Player 2':'#3B82F6' },
          avatars: data.avatars || { 'Player 1':'rocket','Player 2':'alien' },
          stakes: data.stakes || (data.you===2 ? { 'Player 1':'—','Player 2':Number(stakeSC)||0 } : { 'Player 1':Number(stakeSC)||0,'Player 2':'—' }),
          roomId: data.roomId || data.gameId || null,
        });
        setShowMatch(true); setCountdown(null); setLobbyStatus('matching'); return;
      }
      if (data.type === 'countdown' && typeof data.value === 'number') { setCountdown(data.value); return; }
      if (data.type === 'startGame') {
        setShowMatch(false); setCountdown(null); gameActiveRef.current = true; settledOnceRef.current = false;
        const desiredFromText = Math.max(0.01, Number(stakeText) || Number(stakeSC) || 0);
        (async () => { if (lockedStakeRef.current <= 0) await lockStake(desiredFromText); })();

        setIsGameStarted(true); setWinner(null);
        const role = data.playerNumber === 1 ? 'Player 1' : 'Player 2';
        setPlayerRole(role); setCurrentPlayer(data.currentPlayer || 'Player 1');

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

        if (data.stakes) setPairedInfo(prev=>prev?{...prev,stakes:data.stakes}:{you:role==='Player 2'?2:1,stakes:data.stakes});

        const clean=makeBoard(); setBoard(clean); prevBoardRef.current=clean.map(r=>r.slice()); setLastMove(null);
        setRematchVotes(0); setHasVotedRematch(false); setLobbyStatus('idle',{force:true});

        const yours=(data.currentPlayer||'Player 1')===role;
        setTurnToast(yours?"It's your turn!":"It's your opponent's turn!"); setTimeout(()=>setTurnToast(null),1100);
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
        if (!settledOnceRef.current) refundStake('opponent left (refund)');
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
      if (gameActiveRef.current || showMatch) {
        setCurrentPlayer('Reconnecting…');
        setTimeout(()=>connectWSRef.current(true),300);
      } else { setLobbyStatus('idle',{force:true}); setCurrentPlayer('Disconnected — click Join to play'); }
    };
  }, [player1Wins, player2Wins, rematchVotes, scheduleImpactSound, setLobbyStatus, showMatch, myAvatarId, oppAvatarId, pairedInfo, stakeSC, stakeText, lockStake, refundStake, settleWin]);

  useEffect(() => {
    const backoff = { current: 300 };
    connectWSRef.current = (isRetry=false) => {
      const cur=wsRef.current;
      if (cur && (cur.readyState===WebSocket.OPEN || cur.readyState===WebSocket.CONNECTING)) return;
      const delay=isRetry?Math.min(backoff.current,5000):0;
      const doConnect=()=>{ const url=getWsUrl(); console.log('[WS] connect:',url,'(retry:',isRetry,')'); const ws=new WebSocket(url); wsRef.current=ws; attachHandlers(ws); backoff.current=isRetry?Math.min(backoff.current*2,5000):300; };
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
    localStorage.setItem('cfStake', String(stake));
    const ok = await lockStake(stake);
    if (!ok) return;

    withOpenSocket((sock) => {
      try { sock.send(JSON.stringify({ type:'joinGame', username:name, color:selectedColor, avatar:avatarId, stake })); } catch {}
      setLobbyStatus('queued'); setShowMatch(true); setPairedInfo(null); setCountdown(null);
    });
  };

  const cancelMatchmaking = () => {
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
    withOpenSocket(sock => { try { sock.send(JSON.stringify({ type:'leaveGame' })); } catch {} });
    if (!settledOnceRef.current) refundStake('left game');
    setShowMatch(false); setPairedInfo(null); setCountdown(null);
    gameActiveRef.current=false; setIsGameStarted(false); setWinner(null); setPlayerRole(null);
    setRematchVotes(0); setHasVotedRematch(false); setCurrentPlayer('Left game — back to lobby');
    const clean=makeBoard(); setBoard(clean); prevBoardRef.current=clean.map(r=>r.slice()); setLastMove(null);
    setLobbyStatus('idle',{force:true}); cleanSocket(); connectWSRef.current(false);
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

      {/* Single LED bar at the very top (War vibe) */}
      <LedBar color="rgba(255,110,220,0.95)" speed={3} />

      {/* Full-bleed container, board not small on PC */}
      <div className="container-fluid px-0">
        <div className="row justify-content-center g-0">
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
                      </div>

                      <button className="mute-btn ms-md-2" onClick={(e)=>{e.stopPropagation(); setMuted(prev=>!prev);}} title={muted?'Unmute':'Mute'}>
                        <i className={`bi ${muted ? 'bi-volume-mute-fill' : 'bi-volume-up-fill'}`} />
                        <span className="mute-label">{muted ? 'Muted' : 'Sound'}</span>
                      </button>
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
           

            {/* Board area in LED frame */}
          
              <div className="board-full-wrap">

                {/* Winner / Loser Overlay */}
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

                <div className="board-outer">
                  <div className="board-wrap">
                    <div className="cf-stage">
                      <div className="board-frame">
                        <div className="board-skin position-relative">
                          <div className="board-glint"></div>

                          {/* Setup overlay spans board */}
                          {!isGameStarted && showNeutralLobby && (
                            <div className="hud-on-board" onClick={(e) => e.stopPropagation()}>
                              <div className="prejoin-float">
                                <PreGameSetup
                                  username={username}
                                  setUsername={setUsername}
                                  selectedColor={selectedColor}
                                  setSelectedColor={setSelectedColor}
                                  stakeText={stakeText}
                                  setStakeText={setStakeText}
                                  avatarId={avatarId}
                                  setShowAvatarModal={setShowAvatarModal}
                                  scBalance={scBalance}
                                  onJoin={handleJoinGame}
                                />
                              </div>
                            </div>
                          )}

                          {turnToast && <div className="turn-toast">{turnToast}</div>}

                          {isGameStarted && (
                            <div className="board position-relative">
                              {Array.from({ length: COLUMNS }).map((_, colIndex) => (
                                <div key={`arrow-${colIndex}`} className="col-arrow" style={{ left: `calc(${(colIndex + 0.5) / COLUMNS * 100}% )` }}>
                                  <i className="bi bi-caret-down-fill"></i>
                                </div>
                              ))}

                              {Array.from({ length: COLUMNS }).map((_, colIndex) => (
                                <div key={colIndex} className="d-grid column-hover position-relative">
                                  {Array.from({ length: ROWS }).map((_, rowIndex) => {
                                    const cellVal = board[rowIndex][colIndex];
                                    const isLast = lastMove && lastMove.row === rowIndex && lastMove.col === colIndex;
                                    const dropRows = isLast ? (rowIndex + 1) : 0;
                                    return (
                                      <div key={`${colIndex}-${rowIndex}`} className="cell" onClick={() => handleCellClick(rowIndex, colIndex)}>
                                        {cellVal && (
                                          <div
                                            className={`circle ${isLast ? 'token-drop' : ''}`}
                                            style={{ ...(tokenStyleFor(colors[cellVal])), ...(isLast ? { '--drop-rows': dropRows } : {}) }}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="board-stand"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="d-flex flex-wrap gap-2 justify-content-center px-3 pb-3">
                  {isGameStarted && winner && (
                    <button className="btn btn-success btn-resp" onClick={handleRematch}>
                      <i className="bi bi-arrow-repeat me-1" /> Rematch ({rematchVotes}/2)
                    </button>
                  )}
                  {isGameStarted && (
                    <button className="btn btn-outline-secondary btn-resp" onClick={handleLeave}>
                      <i className="bi bi-door-open me-1" /> Leave
                    </button>
                  )}
                </div>
              </div>
           

          </div>
        </div>
      </div>

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

        .cf-page { min-height: 100vh; color:#fff;
          background: radial-gradient(60% 60% at 50% 10%, #2b1340 0%, #0a0613 60%, #000 100%); }
        .nav-spacer { height:56px; }

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
          background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); color:#fff; }
        .mute-btn .mute-label { font-size:.8rem; }

        .lobby-strip { display:flex; align-items:center; gap:10px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
          border-radius:999px; padding:6px 12px; }
        .mm-dots { display:flex; gap:6px; align-items:center; }
        .mm-dot { width:8px; height:8px; border-radius:999px; background:#fff; opacity:.7; animation: dotblink 1.2s infinite ease-in-out; }
        .mm-dot:nth-child(2){ animation-delay:.15s } .mm-dot:nth-child(3){ animation-delay:.3s }
        @keyframes dotblink { 0%,100%{opacity:.35; transform:translateY(0)} 50%{opacity:1; transform:translateY(-2px)} }
        .lobby-text { opacity:.95; font-weight:700; }

        /* Board area */
        .board-full-wrap { position:relative; width:100%; max-width:100%; }
        .board-outer { width:100%; }
        .board-wrap { padding:10px; }
        .board-skin { border-radius:1rem; background: radial-gradient(120% 120% at 50% -10%, rgba(255,255,255,.06), rgba(0,0,0,.3)); }
        .board-glint { position:absolute; inset:0; border-radius:inherit; background: radial-gradient(50% 80% at 50% -20%, rgba(255,255,255,.18), transparent 60%); pointer-events:none; }

        .turn-toast { position:absolute; top:10px; left:50%; transform:translateX(-50%); z-index:5;
          background:linear-gradient(90deg,#ffe36e,#ffa761); color:#281400; padding:6px 10px; border-radius:999px;
          font-weight:800; box-shadow:0 10px 24px rgba(255,199,0,.25); }

        .winlose-overlay { position:absolute; inset:0; display:grid; place-items:center; z-index:6; }
        .winlose-card { background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.15); border-radius:16px; padding:18px 16px; }
        .win-glow { position:absolute; inset:-8px; border-radius:20px; box-shadow:0 0 60px rgba(0,255,160,.35); }
        .winlose-title { display:flex; align-items:center; gap:10px; font-weight:900; }
        .winlose-actions { display:flex; gap:10px; justify-content:center; }

        /* Matchmaking modal */
        .match-overlay{ position:fixed; inset:0; display:grid; place-items:center; z-index:50; background:rgba(0,0,0,.45); backdrop-filter: blur(4px); }
        .match-card{ width:min(900px,95vw); background:rgba(0,0,0,.6); border:1px solid rgba(255,255,255,.1);
          border-radius:20px; padding:18px; box-shadow:0 20px 50px rgba(0,0,0,.35); }
        .match-header{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
        .match-body{ display:grid; grid-template-columns:1fr auto 1fr; gap:12px; align-items:center; }
        .match-divider{ font-weight:800; font-size:18px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.1); }
        .mm-avatar{ display:grid; place-items:center; font-size:42px; }
        .mm-pill{ display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.14); }
        .mm-swab{ display:inline-block; width:14px; height:14px; border-radius:999px; border:1px solid rgba(0,0,0,.25); }
        .mm-cancel{ appearance:none; border:0; background:rgba(255,255,255,.08); color:#fff; border-radius:10px; padding:6px 10px; cursor:pointer; }
        .mm-footer{ margin-top:10px; display:flex; justify-content:center; }

        /* Avatar modal */
        .avatar-modal{ position:fixed; inset:0; display:grid; place-items:center; background:rgba(0,0,0,.55); z-index:60; }
        .avatar-card{ width:min(720px,95vw); background:rgba(0,0,0,.65); border:1px solid rgba(255,255,255,.14); border-radius:18px; padding:12px; }
        .avatar-hd{ display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
        .avatar-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; }
        .avatar-btn{ display:grid; gap:6px; place-items:center; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:10px; color:#fff; }
        .avatar-hero{ font-size:28px; }
        .avatar-ft{ display:flex; justify-content:flex-end; margin-top:10px; }

        /* Small tweaks */
        .btn-resp{ min-width:140px; }
      `}</style>
    </div>
  );
}
