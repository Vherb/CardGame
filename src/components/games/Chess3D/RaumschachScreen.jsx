import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'react-bootstrap';
import GameSetup from '../../common/GameSetup';
import LoginOverlay from '../../common/LoginOverlay';
import NavBar from '../../NavBar';
import '../Chess/ChessScreen.css';
import './RaumschachScreen.css';
import StackedBoard3D from './StackedBoard3D';
import * as eng from './raumEngine';
import QuickChat from '../common/QuickChat';
import WaitingOverlay from '../common/WaitingOverlay';

const API = (()=>{ const { protocol, hostname } = window.location; const envHost=(process.env.REACT_APP_SERVER_HOST||'').trim(); const winHost=(window.SERVER_HOST?String(window.SERVER_HOST).trim():''); let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{} const host=envHost||winHost||lsHost||hostname; return process.env.REACT_APP_API_BASE || `${protocol}//${host}:3002`; })();
function authFetch(path, options = {}){
  const token = localStorage.getItem('token') || '';
  return fetch(`${API}${path}`, { ...options, headers: { 'Content-Type':'application/json', ...(options.headers||{}), ...(token?{ Authorization:`Bearer ${token}` }:{}), } });
}
async function getBalance(){ const r = await authFetch('/balance'); const j = await r.json().catch(()=>({sc_balance:0})); return Number(j.sc_balance)||0; }
async function scAdjust(delta, memo = ''){ const r = await authFetch('/sc/adjust', { method:'POST', body: JSON.stringify({ delta:Number(delta), memo }) }); const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j?.message||'SC adjust failed'); return j; }

const DEFAULT_OFFSETS = {
  P: { x: 0, y: -0.25, z: 0.4 },
  R: { x: 0, y: -0.36, z: 0.48 },
  N: { x: 0, y: 1.35, z: 2.21 },
  B: { x: 0, y: 1.54, z: 2.02 },
  Q: { x: 0, y: -0.26, z: 0.41 },
  K: { x: 0, y: -0.14, z: 0.3 },
  U: { x: 0, y: -0.25, z: 0.38 },
};

// For low-poly mobile models, the Piece component auto-centers and floors models,
// so we don't need any type-specific offsets. Keep zeros to align to tile centers.
const ZERO_OFFSETS = {
  P: { x: 0, y: 0, z: 0 },
  R: { x: 0, y: 0, z: 0 },
  N: { x: 0, y: 0, z: 0 },
  B: { x: 0, y: 0, z: 0 },
  Q: { x: 0, y: 0, z: 0 },
  K: { x: 0, y: 0, z: 0 },
  U: { x: 0, y: 0, z: 0 },
};

// Matchmaking components (mirroring Chess)
const AVATAR_SET=[
  {id:'rocket',label:'Rocket',glyph:'🚀'},
  {id:'dragon',label:'Dragon',glyph:'🐉'},
  {id:'brain',label:'Brain',glyph:'🧠'},
  {id:'fox',label:'Fox',glyph:'🦊'},
  {id:'lion',label:'Lion',glyph:'🦁'},
  {id:'panda',label:'Panda',glyph:'🐼'},
  {id:'astronaut',label:'Astronaut',glyph:'🧑‍🚀'},
  {id:'alien',label:'Alien',glyph:'👾'}
];
const findAvatar=(id)=>AVATAR_SET.find(a=>a.id===id)||AVATAR_SET[0];
const Avatar=({id,size=64})=>{const a=findAvatar(id);return(
  <div style={{width:size,height:size,borderRadius:'50%',display:'grid',placeItems:'center',fontSize:Math.round(size*.55),lineHeight:1}} aria-label={a.label} title={a.label}>{a.glyph}</div>
)};
const NEON_PALETTE=['#22D3EE','#60A5FA','#A78BFA','#F472B6','#F59E0B','#84CC16','#EF4444','#14B8A6','#EAB308','#FFFFFF'];

export default function RaumschachScreen(){
  const [state, setState] = useState(()=> eng.createInitialState());
  const [selected, setSelected] = useState(null);
  const legal = useMemo(()=> eng.generateLegal(state), [state]);
  const checkSq = useMemo(()=> eng.kingInCheckSquare(state), [state]);
  const { isCheck, isMate, isStalemate } = useMemo(()=>{
    const chk = !!checkSq;
    const mate = chk && legal.length===0;
    const stale = !chk && legal.length===0;
    return { isCheck: chk, isMate: mate, isStalemate: stale };
  }, [checkSq, legal.length]);
  const isMobileLowPoly = React.useMemo(()=>{
    try{
      return typeof window!== 'undefined' && (
        window.matchMedia('(pointer:coarse)').matches ||
        window.matchMedia('(max-width: 640px)').matches
      );
    }catch{ return false; }
  },[]);
  const [offsets] = useState(() => JSON.parse(JSON.stringify(isMobileLowPoly ? ZERO_OFFSETS : DEFAULT_OFFSETS)));
  const wsRef = useRef(null);
  const youRef = useRef(null);
  const gameIdRef = useRef(null);
  const tokenRef = useRef(null);
  const lockedStakeRef = useRef(0);
  const settledOnceRef = useRef(false);
  const isAuthed = React.useCallback(()=> !!localStorage.getItem('token') && !!localStorage.getItem('username'), []);
  const [authed, setAuthed] = useState(isAuthed());
  const [scBalance, setScBalance] = useState(0);
  const [pieceColors, setPieceColors] = useState({ w:'#e5e7eb', b:'#111827' });
  const [username,setUsername]=useState(()=> localStorage.getItem('username') || localStorage.getItem('chesName') || '');
  const [avatarId, setAvatarId] = useState(()=> localStorage.getItem('profileAvatar') || localStorage.getItem('chesAvatar') || 'rocket');
  const userIdRef = useRef(() => {
    try{
      const raw = localStorage.getItem('userId') ?? localStorage.getItem('id');
      const n = raw != null ? Number(raw) : null;
      return Number.isFinite(n) ? n : null;
    }catch{ return null; }
  });
  const [myPieceColor, setMyPieceColor] = useState(()=> localStorage.getItem('chesTint') || '#22D3EE');
  const [showMatch, setShowMatch] = useState(true);
  const [queued, setQueued] = useState(false);
  const [showHints, setShowHints] = useState(()=> (localStorage.getItem('chesHints')||'0')==='1');
  const [stakeText, setStakeText] = useState('0.00');
  const [pairedInfo,setPairedInfo]=useState(null);
  const [countdown,setCountdown]=useState(null);
  const [presence, setPresence] = useState({ w: false, b: false });
  const [youAvatar, setYouAvatar] = useState(avatarId);
  const [oppAvatar] = useState(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [mmNotice, setMmNotice] = useState(null); // matchmaking notice/errors
  const [whiteKnightDeg] = useState(()=>{
    try{ const v = localStorage.getItem('whiteKnightDeg'); return v!=null ? Number(v) : 180; }catch{ return 180; }
  });
  useEffect(()=>{ try{ localStorage.setItem('whiteKnightDeg', String(whiteKnightDeg)); }catch{} }, [whiteKnightDeg]);
  const [whiteKnightZ] = useState(()=>{
    try{ const v = localStorage.getItem('whiteKnightZ'); return v!=null ? Number(v) : -4.5; }catch{ return -4.5; }
  });
  useEffect(()=>{ try{ localStorage.setItem('whiteKnightZ', String(whiteKnightZ)); }catch{} }, [whiteKnightZ]);
  const [turnPopup, setTurnPopup] = useState(null); // string|null
  const [dcPopup, setDcPopup] = useState(false); // Opponent disconnected modal
  const [chatFeed, setChatFeed] = useState([]); // {from:'w'|'b'|'you', username, text, ts}
  const lastTurnRef = useRef(state.sideToMove);
  useEffect(()=>{
    const prev = lastTurnRef.current; const cur = state.sideToMove;
    if(prev!==cur && !showMatch){
      const youNum = youRef.current||1; const youCol = (youNum===2?'b':'w');
      const msg = (cur===youCol) ? 'Your Turn' : "Opponent's Turn";
      setTurnPopup(msg);
      const t = setTimeout(()=> setTurnPopup(null), 1400);
      return ()=> clearTimeout(t);
    }
    lastTurnRef.current = cur;
  }, [state.sideToMove, showMatch]);

  const withOpenSocket = useCallback((fn)=>{ const ws=wsRef.current; if(ws && ws.readyState===1){ try{ fn(ws); }catch{} } },[]);

  const queueAfterConnectRef = useRef(false);

  // Saved games
  const [serverSaved, setServerSaved] = useState([]);
  const pendingSavedJoinRef = useRef(null);

  const connectWs = useCallback(()=>{
    try{ if(wsRef.current && wsRef.current.readyState===1){ return; } if(wsRef.current && wsRef.current.readyState===0){ return; } }catch{}
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const envHost=(process.env.REACT_APP_SERVER_HOST||'').trim(); const winHost=(window.SERVER_HOST?String(window.SERVER_HOST).trim():''); let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{} const host = envHost || winHost || lsHost || window.location.hostname; const port = 3013;
  const url = (process.env.REACT_APP_UNIFIED_WS === '1')
    // In unified mode, use the API base host:port (default 3002), not the client port
    ? (()=>{ const httpProto=(window.location && window.location.protocol)||'http:'; const apiBase=(process.env.REACT_APP_API_BASE && process.env.REACT_APP_API_BASE.trim()) || `${httpProto}//${host}:3002`; let u; try{ u=new URL(apiBase); }catch{ u={ host: `${host}:3002` }; } return `${proto}://${u.host}/ws/raum`; })()
    : `${proto}://${host}:${port}`;
  const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = ()=>{
      try{ ws.send(JSON.stringify({ type:'setAvatar', avatar: avatarId })); }catch{}
      try{ ws.send(JSON.stringify({ type:'setUsername', username })); }catch{}
      try{ ws.send(JSON.stringify({ type:'setPieceColor', pieceColor: myPieceColor })); }catch{}
  // mode removed: always strict
      try{ const st = Number(stakeText)||0; ws.send(JSON.stringify({ type:'setStake', stake: st })); }catch{}
      // If we were asked to resume a saved game, send that immediately (mirror Chess)
      try{
        const pend = pendingSavedJoinRef.current;
        if(pend && !pend.sent){
          if(pend.claim){ ws.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username, userId: userIdRef.current && userIdRef.current(), otherUsername: pend.otherUsername })); }
          else { ws.send(JSON.stringify({ type:'joinSavedGame', gameId: pend.gameId, token: pend.token, username, userId: userIdRef.current && userIdRef.current() })); }
          pendingSavedJoinRef.current = { ...pend, sent: true };
        }
      }catch{}
      if(queueAfterConnectRef.current){
        try{
          const st = Math.max(0, Number(stakeText)||0);
          ws.send(JSON.stringify({ type:'joinGame', username, userId: userIdRef.current && userIdRef.current(), pieceColor: myPieceColor, avatar: avatarId, stake: Math.round(st*100)/100 }));
          setQueued(true);
        }catch{}
        queueAfterConnectRef.current=false;
      }
      // Fetch saved games list after connecting
      try{ const name=(username||'').toString().slice(0,40); if(name){ ws.send(JSON.stringify({ type:'listMySavedGames', username: name, userId: userIdRef.current && userIdRef.current() })); } }catch{}
    };
    ws.onmessage = (ev)=>{
      let data; try{ data=JSON.parse(ev.data); }catch{ return; }
  if(data.type==='queued'){ setQueued(true); setShowMatch(true); setPairedInfo(null); setCountdown(null); setMmNotice(null); return; }
      if(data.type==='paired'){
        setDcPopup(false);
        youRef.current = data.you || youRef.current || 1;
        gameIdRef.current = data.gameId || gameIdRef.current || null;
        tokenRef.current = data.token || tokenRef.current || null;
  setPairedInfo({ you:data.you, usernames: data.usernames||{w:'White',b:'Black'}, pieceColors: data.pieceColors||null, avatars: data.avatars||null, gameId: data.gameId||null, token: data.token||null, stakes: data.stakes||{} });
  setMmNotice(null);
        setCountdown(data.countdown||null);
        try{ if(data.gameId && data.token){ localStorage.setItem('raumResume', JSON.stringify({ gameId:data.gameId, token:data.token })); } }catch{}
        return;
      }
      if(data.type==='presence' && data.present){ setPresence({ w: !!data.present.w, b: !!data.present.b }); return; }
      if(data.type==='quickChat'){
        const youNum = youRef.current||1; const youCol = (youNum===2?'b':'w');
        const from = data.from === youCol ? 'you' : (data.from||'opp');
        setChatFeed(prev => [...prev, { from, username: data.username, text: String(data.text||'').slice(0,80), ts: Number(data.ts)||Date.now() }].slice(-12));
        return;
      }
      if(data.type==='mySavedGames'){ try{ setServerSaved(Array.isArray(data.list)?data.list:[]); }catch{ setServerSaved([]); } return; }
      if(data.type==='savedDenied'){
        const pend = pendingSavedJoinRef.current; if(pend && !pend.triedClaim && username){
          pendingSavedJoinRef.current = { ...pend, triedClaim: true };
          try{ ws.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username, userId: userIdRef.current && userIdRef.current(), otherUsername: pend.otherUsername })); }catch{}
        } else {
          // show visible notice in matchmaking overlay
          const reason = (data && data.reason) ? String(data.reason) : '';
          const msg = reason ? `Cannot resume: ${reason}` : 'Cannot resume saved game.';
          setMmNotice(msg);
          pendingSavedJoinRef.current = null;
        }
        return;
      }
      if(data.type==='savedQueued'){
        setDcPopup(false);
        pendingSavedJoinRef.current = null;
        setShowMatch(true);
        setQueued(true);
        setMmNotice(null);
        const youColor = data.you===2?'b':'w';
        const av = data.avatars || { w:'rocket', b:'alien' };
        setPairedInfo({ you:data.you, usernames: data.usernames||{w:'White',b:'Black'}, stakes:{w:'—',b:'—'}, avatars: av, gameId:data.gameId||null, token:data.token||null });
        setYouAvatar(youColor==='b' ? (av.b||'rocket') : (av.w||'rocket'));
        setPresence(p=>p); // no-op, ensure rerender
        if(data.pieceColors && (data.pieceColors.w || data.pieceColors.b)) setPieceColors({ w: data.pieceColors.w || '#e5e7eb', b: data.pieceColors.b || '#111827' });
        try{ if(data.gameId && data.token){ localStorage.setItem('raumResume', JSON.stringify({ gameId:data.gameId, token:data.token })); } }catch{}
        return;
      }
      if(data.type==='savedRemoved'){
        try{ setServerSaved(prev => Array.isArray(prev)? prev.filter(x=>x.gameId!==data.gameId) : prev); }catch{}
        return;
      }
      if(data.type==='countdown'){ setCountdown(data.value); return; }
      if(data.type==='usernames' && data.usernames){ setPairedInfo(p=>p?{...p, usernames: data.usernames}:p); return; }
      if(data.type==='avatars' && data.avatars){ setPairedInfo(p=>p?{...p, avatars: data.avatars}:p); return; }
      if(data.type==='pieceColors' && data.pieceColors){ setPieceColors({ w:data.pieceColors.w||'#e5e7eb', b:data.pieceColors.b||'#111827' }); return; }
      if(data.type==='startGame'){
        const b = Array.from({length:5},()=>Array.from({length:5},()=>Array(5).fill(null)));
        for(let l=0;l<5;l++) for(let r=0;r<5;r++) for(let f=0;f<5;f++){
          const p = data.board?.[l]?.[r]?.[f]; if(p) b[l][r][f] = { t:p.t, c:p.c };
        }
        if(data.pieceColors) setPieceColors({ w: data.pieceColors.w || '#e5e7eb', b: data.pieceColors.b || '#111827' });
        youRef.current = data.playerNumber || youRef.current || 1;
        gameIdRef.current = data.gameId || gameIdRef.current || null;
        tokenRef.current = data.token || tokenRef.current || null;
  try{ if(data.gameId && data.token){ localStorage.setItem('raumResume', JSON.stringify({ gameId:data.gameId, token:data.token })); } }catch{}
        setState({ board: b, sideToMove: data.currentColor||'w', history: [] });
        setChatFeed([]);
        // Optimistically mark both sides online so the waiting overlay doesn't linger
        try{
          const youNum = (data.playerNumber || youRef.current || 1);
          const youCol = (youNum===2?'b':'w');
          setPresence({ w: true, b: true });
        }catch{}
        setShowMatch(false); setQueued(false); setCountdown(null); setSelected(null); setDcPopup(false); setMmNotice(null);
        // Lock stake at game start per new model
        try{ const desired=Math.max(0.01, Number(stakeText)||0); if(lockedStakeRef.current<=0){ (async()=>{ try{ const j=await scAdjust(-desired,'Raumschach — lock stake'); lockedStakeRef.current=desired; setScBalance(Number(j.sc_balance)||0); }catch(e){ alert(e.message||'Could not lock stake.'); } })(); } }catch{}
        return;
      }
      if(data.type==='update'){
        const b = Array.from({length:5},()=>Array.from({length:5},()=>Array(5).fill(null)));
        for(let l=0;l<5;l++) for(let r=0;r<5;r++) for(let f=0;f<5;f++){
          const p = data.board?.[l]?.[r]?.[f]; if(p) b[l][r][f] = { t:p.t, c:p.c };
        }
        setState(prev=>({ board: b, sideToMove: data.currentColor||prev.sideToMove, history: [...(prev.history||[]), data.lastMove||null].filter(Boolean) }));
        return;
      }
      if(data.type==='playerLeft'){ setPresence(prev=>({...prev, [data.side]: false})); return; }
      if(data.type==='playerBack'){ setPresence(prev=>({...prev, [data.side]: true})); return; }
      if(data.type==='opponentLeft'){
        // Mirror Chess behavior: keep you in-game and simply rely on presence[opp]===false
        // The UI will render a non-blocking "Waiting for opponent…" overlay until they return.
        return;
      }
    };
    ws.onclose = ()=>{};
    ws.onerror = ()=>{};
  }, [avatarId, username, myPieceColor, stakeText]);

  // Refresh saved list when returning to matchmaking, mirroring Chess experience
  useEffect(()=>{
    if(!(showMatch && !queued && !pairedInfo)) return;
    const nm=(username||'').toString().slice(0,40); if(!nm) return;
    const ws=wsRef.current;
    if(ws && ws.readyState===1){ try{ ws.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} }
    else { connectWs(); }
  }, [showMatch, queued, pairedInfo, username, connectWs]);

  // Keep server in sync with local inputs like Chess does
  useEffect(()=>{ withOpenSocket(ws=>{ try{ ws.send(JSON.stringify({ type:'setUsername', username })); }catch{} }); const nm=(username||'').slice(0,16); localStorage.setItem('username', nm); try{ localStorage.setItem('chesName', nm); }catch{} }, [username, withOpenSocket]);
  useEffect(()=>{ withOpenSocket(ws=>{ try{ ws.send(JSON.stringify({ type:'setPieceColor', pieceColor: myPieceColor })); }catch{} }); localStorage.setItem('chesTint', myPieceColor); }, [myPieceColor, withOpenSocket]);
  useEffect(()=>{ const n = Math.max(0, Number(stakeText)||0); const fixed = Math.round(n*100)/100; withOpenSocket(ws=>{ try{ ws.send(JSON.stringify({ type:'setStake', stake: fixed })); }catch{} }); }, [stakeText, withOpenSocket]);
  // mode removed: always strict

  const onCellClick = useCallback(({f,r,l})=>{
    if(isMate || isStalemate) return; // block input on terminal positions
    const pc = state.board?.[l]?.[r]?.[f];
    if(selected){
      const mv = legal.find(m=> m.from && selected && m.from.f===selected.f && m.from.r===selected.r && m.from.l===selected.l && m.to.f===f && m.to.r===r && m.to.l===l);
      if(mv){
        if(wsRef.current && wsRef.current.readyState===1){
          try{ wsRef.current.send(JSON.stringify({ type:'makeMove', from: mv.from, to: mv.to })); }catch{}
          setSelected(null);
          return;
        }
        const copy={ board: state.board.map(level=> level.map(row=> row.slice())), sideToMove: state.sideToMove, history: state.history.slice() };
        if(eng.makeMove(copy, mv)){ setState(copy); setSelected(null); }
        return;
      }
      if(pc && pc.c===state.sideToMove){ setSelected({f,r,l}); }
      else { setSelected(null); }
    } else {
      if(pc && pc.c===state.sideToMove){ setSelected({f,r,l}); }
    }
  }, [state, selected, legal, isMate, isStalemate]);

  const targets = useMemo(()=>{
    if(!selected) return [];
    const list = legal.filter(m=> m.from && m.from.f===selected.f && m.from.r===selected.r && m.from.l===selected.l);
    return list.map(m=> ({
      f: m.to.f,
      r: m.to.r,
      l: m.to.l,
      capture: !!state.board[m.to.l][m.to.r][m.to.f]
    }));
  }, [selected, legal, state.board]);

  // Settle staking on mate/draw at end of game
  const prevTerminalRef = useRef(false);
  useEffect(()=>{
    const terminal = !!(isMate || isStalemate);
    if(!showMatch && terminal && !prevTerminalRef.current){
      prevTerminalRef.current = true;
      const youNum = youRef.current||1; const youCol = (youNum===2?'b':'w');
      if(isStalemate){
        (async()=>{ try{ const a=lockedStakeRef.current; if(a>0){ const j=await scAdjust(+a,'Raumschach — draw refund'); lockedStakeRef.current=0; setScBalance(Number(j.sc_balance)||0); } settledOnceRef.current=true; }catch{} })();
      } else if(isMate){
        const winner = (state.sideToMove==='w' ? 'b' : 'w');
        if(winner===youCol){
          const my = lockedStakeRef.current||Math.max(0, Number(stakeText)||0);
          const payout = (my*2);
          (async()=>{ try{ const j=await scAdjust(+payout,'Raumschach — win payout'); setScBalance(Number(j.sc_balance)||0); lockedStakeRef.current=0; settledOnceRef.current=true; }catch{ try{ const j2=await scAdjust(+my,'Raumschach — payout fallback refund'); setScBalance(Number(j2.sc_balance)||0); lockedStakeRef.current=0; settledOnceRef.current=true; }catch{} } })();
        } else {
          // You lost; forfeit locked stake
          lockedStakeRef.current=0; settledOnceRef.current=true;
        }
      }
    }
    if(!terminal) prevTerminalRef.current=false;
  }, [isMate, isStalemate, showMatch, state.sideToMove, stakeText]);

  // Open WS and handle messages like Chess
  const onJoin = useCallback(()=>{
    if(wsRef.current && wsRef.current.readyState===1){
      try{
        const ws = wsRef.current;
        const st = Math.max(0, Number(stakeText)||0);
        ws.send(JSON.stringify({ type:'joinGame', username, userId: userIdRef.current && userIdRef.current(), pieceColor: myPieceColor, avatar: avatarId, stake: Math.round(st*100)/100 }));
        setQueued(true);
      }catch{}
      return;
    }
    queueAfterConnectRef.current = true;
    connectWs();
  }, [connectWs, username, myPieceColor, avatarId, stakeText]);

  const onCancelQueue=useCallback(()=>{
    const ws=wsRef.current; try{ if(ws) ws.close(1000,'cancel'); }catch{}
    setQueued(false); setPairedInfo(null); setCountdown(null); setShowMatch(true);
  },[]);

  // Auth sync + SC balance load
  useEffect(()=>{
    const onAuth = ()=> setAuthed(isAuthed());
    try{ window.addEventListener('authchange', onAuth); window.addEventListener('storage', onAuth); }catch{}
    return ()=>{ try{ window.removeEventListener('authchange', onAuth); window.removeEventListener('storage', onAuth); }catch{} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{ (async()=>{ if(authed){ try{ setScBalance(await getBalance()); }catch{} } else { setScBalance(0); } })(); }, [authed]);

  const inGame = !showMatch;
  // Show login overlay ONLY when not authenticated
  const showOverlay = !authed;

  useEffect(() => {
    try {
      const root = document.getElementById('root');
      document.documentElement.classList.add('no-bottom-pad');
      document.body.classList.add('no-bottom-pad');
      if (root) root.classList.add('no-bottom-pad');
      return () => {
        document.documentElement.classList.remove('no-bottom-pad');
        document.body.classList.remove('no-bottom-pad');
        if (root) root.classList.remove('no-bottom-pad');
      };
    } catch {}
  }, []);

  // Ensure opponent sees waiting overlay when navigating via bottom nav
  useEffect(()=>{
    const handler = () => {
      try {
        const ws = wsRef.current; if(ws && ws.readyState===1){
          try { ws.send(JSON.stringify({ type:'leaveGame' })); } catch {}
          try { ws.close(1000, 'navigate'); } catch {}
        }
      } catch {}
    };
    window.addEventListener('game:beforeNavigate', handler);
    return () => window.removeEventListener('game:beforeNavigate', handler);
  }, []);

  return (
    <div className="cf-screen cf-raum">
      <NavBar />
      <div className="nav-spacer" />
      <main className={`app-content ${inGame ? 'app-content--full' : ''}`}>
        {showOverlay && (<LoginOverlay />)}
        {!showMatch && (
        <div className="board-fullwrap">
          {/* Badges row like Chess */}
          {!showMatch && (
            <div className="badge-row">
              {(() => {
                const youNum = youRef.current||1; const youCol = (youNum===2?'b':'w'); const oppCol = youCol==='w'?'b':'w';
                const youName = (pairedInfo?.usernames?.[youCol]) || (username || 'You');
                const yourTurn = state.sideToMove === youCol;
                return (
                  <>
                    <span className="badge-chip"><i className="bi bi-person-badge" /> {youName} ({youCol==='w'?'White':'Black'})</span>
                    <span className="badge-chip"><i className="bi bi-hourglass-split" /> Turn: {state.sideToMove==='w'?'White':'Black'}</span>
                    <span className="badge-chip"><i className="bi bi-wifi" /> Opponent: {presence[oppCol] ? 'Online' : 'Offline'}</span>
                    <span className={`badge-chip ${yourTurn? 'good':'mute'}`}>
                      <i className="bi bi-lightning-charge" /> {yourTurn ? "Your Turn" : "Opponent's Turn"}
                    </span>
                    {isCheck && !(isMate||isStalemate) && (
                      <span className="badge-chip warn"><i className="bi bi-exclamation-triangle" /> CHECK</span>
                    )}
                  </>
                );
              })()}
            </div>
          )}
          <div className="board-shell">
            <StackedBoard3D
              board={state.board}
              onCellClick={onCellClick}
              offsets={offsets}
              whiteKnightDeg={whiteKnightDeg}
              whiteKnightZ={isMobileLowPoly ? 0 : whiteKnightZ}
              selected={selected}
              targets={targets}
              lastMove={state.history[state.history.length-1]||null}
              checkSq={checkSq}
            />
            <QuickChat
              onSend={(text)=>{ const t=String(text||'').slice(0,80); const ws=wsRef.current; if(ws && ws.readyState===1){ try{ ws.send(JSON.stringify({ type:'quickChat', text:t })); }catch{} } }}
              messages={chatFeed}
              youKey="you"
              align="right"
              canSend={!showMatch && !!wsRef.current && wsRef.current.readyState===1}
            />
            {(() => {
              try{
                const youNum = youRef.current||1; const youCol = (youNum===2?'b':'w'); const oppCol = youCol==='w'?'b':'w';
                const oppMissing = !showMatch && presence && presence[oppCol]===false;
                return (<WaitingOverlay show={!!oppMissing} />);
              }catch{return null;}
            })()}
            {isCheck && !(isMate||isStalemate) && (
              <div className="status-popup" role="status" aria-live="polite">CHECK</div>
            )}
            {turnPopup && !isMate && !isStalemate && (
              <div className={`status-popup turn ${turnPopup.includes('Your')?'good':'mute'}`} role="status" aria-live="polite">{turnPopup}</div>
            )}
          </div>
        </div>
        )}

      {/* Setup card using common GameSetup (mirror 2D Chess pregame layout) */}
      {showMatch && !queued && !pairedInfo && (
        <div className="d-flex justify-content-center">
          <div className="prejoin-float" style={{ position:'relative', width:'100%' }} onClick={(e)=>e.stopPropagation()}>
            <GameSetup
              title="Game Setup"
              badge="PVP"
              username={username}
              setUsername={setUsername}
              stakeText={stakeText}
              setStakeText={setStakeText}
              scBalance={scBalance}
              currencyLabel="SC"
              onJoin={onJoin}
              avatarId={avatarId}
              avatarGlyph={<span role="img" aria-label={findAvatar(avatarId).label}>{findAvatar(avatarId).glyph}</span>}
              onOpenAvatarModal={()=> setShowAvatarModal(true)}
              colors={NEON_PALETTE}
              selectedColor={myPieceColor}
              onPickColor={(hex)=> setMyPieceColor(hex)}
            >
              {/* Mode removed: always strict */}
              <div className="mb-2">
                <div className="fw-bold mb-1">Hints</div>
                <div className="d-flex gap-2 flex-wrap">
                  <button type="button" className={`btn btn-sm ${!showHints?'btn-light':'btn-outline-light'}`} onClick={()=>{ setShowHints(false); localStorage.setItem('chesHints','0'); }}>Off</button>
                  <button type="button" className={`btn btn-sm ${showHints?'btn-light':'btn-outline-light'}`} onClick={()=>{ setShowHints(true); localStorage.setItem('chesHints','1'); }}>On</button>
                </div>
                <div className="small text-secondary mt-1">Non-forcing suggestions only when it's your turn.</div>
              </div>
              <div className="mt-3">
                <div className="d-flex align-items-center justify-content-between mb-1">
                  <div className="fw-bold">Reconnect & Continue</div>
                  <div>
                    <Button size="sm" variant="outline-light" onClick={()=>{ const nm=(username||'').toString().slice(0,40); if(!nm){ alert('Set a username to fetch your saved games.'); return; } const ws=wsRef.current; if(ws && ws.readyState===1){ try{ ws.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} } else { connectWs(); setTimeout(()=>{ const w=wsRef.current; if(w&&w.readyState===1){ try{ w.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} } }, 250); } }}>Refresh</Button>
                  </div>
                </div>
                {serverSaved.length===0 ? (
                  <div className="text-secondary small">No paused games yet. Start a game, make a move, then leave to save it for later.</div>
                ) : (
                  <div className="saved-list">
                    {serverSaved.map(s=> (
                      <div key={`sv-${s.gameId}`} className="p-2 saved-card">
                        {(()=>{ const youCol = s.you===2?'b':'w'; const oppCol = youCol==='w'?'b':'w'; const ys = s?.usernames?.[youCol]; const os = s?.usernames?.[oppCol]; const youName = (ys && !['White','Black'].includes(ys)) ? ys : (username || 'You'); const oppName = (os && !['White','Black'].includes(os)) ? os : 'Opponent'; return (
                          <div className="d-flex align-items-center flex-wrap gap-2">
                            <div className="small d-flex flex-column">
                              <div className="fw-semibold d-flex align-items-center gap-2">
                                <span className="name-pill"><i className="bi bi-person-badge"/>{youName}</span>
                                <span className="text-secondary">VS</span>
                                <span className="name-pill"><i className="bi bi-person-badge"/>{oppName}</span>
                              </div>
                              <div className="saved-meta">Game #{s.gameId} · Mode: {s.mode==='free'?'Free-Play':'Strict'} · You: {youCol==='b'?'Black':'White'}</div>
                            </div>
                            <div className="saved-actions ms-auto">
                              <Button size="sm" variant="light" className="fw-semibold" onClick={()=>{
                                const youCol2 = s.you===2?'b':'w'; const oppCol2 = youCol2==='w'?'b':'w';
                                const otherUsername = s?.usernames?.[oppCol2] || undefined;
                                pendingSavedJoinRef.current = { gameId: s.gameId, triedClaim: false, sent: false, claim: true, otherUsername, allowAny: false };
                                setShowMatch(true); setPairedInfo(null); setQueued(false);
                                const nm=(username||'').toString().slice(0,40);
                                const ws=wsRef.current;
                                if(ws && ws.readyState===1){
                                  try{ ws.send(JSON.stringify({ type:'claimSavedGame', gameId: s.gameId, username: nm, userId: userIdRef.current && userIdRef.current(), otherUsername })); }catch{}
                                  pendingSavedJoinRef.current = null;
                                } else {
                                  connectWs();
                                }
                              }}><i className="bi bi-play-fill me-1"/>Continue</Button>
                              <Button size="sm" variant="outline-danger" className="fw-semibold" onClick={()=>{
                                const nm=(username||'').toString().slice(0,40);
                                if(!nm) { alert('Set a username first.'); return; }
                                // Optimistic removal from UI
                                try{ setServerSaved(prev => Array.isArray(prev) ? prev.filter(x=>x.gameId!==s.gameId) : prev); }catch{}
                                const ws=wsRef.current;
                                if(ws && ws.readyState===1){ try{ ws.send(JSON.stringify({ type:'finishSavedGame', gameId: s.gameId, username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} }
                                else { connectWs(); setTimeout(()=>{ const w=wsRef.current; if(w&&w.readyState===1){ try{ w.send(JSON.stringify({ type:'finishSavedGame', gameId: s.gameId, username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} } }, 250); }
                              }}><i className="bi bi-check2-circle me-1"/>Finish</Button>
                            </div>
                          </div>
                        ); })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </GameSetup>
            {/* Bottom spacer for safe-area */}
            <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 18px)' }} />
          </div>
        </div>
      )}

      {/* Endgame overlay */}
      {!showMatch && (isMate || isStalemate) && (
        <div className="match-overlay endgame-overlay">
          <div className="popup-card">
            <div className="popup-title">{isMate ? 'CHECKMATE' : 'STALEMATE'}</div>
            <div className="popup-body">
              {(() => {
                if(isMate){
                  const winner = state.sideToMove==='w' ? 'Black' : 'White';
                  const youNum = youRef.current||1; const youCol = (youNum===2?'b':'w');
                  const youWon = (winner.toLowerCase().startsWith('w') ? 'w':'b') === youCol;
                  return <div>{winner} wins. {youWon ? 'You win!' : 'You lose.'}</div>;
                }
                return <div>Draw by stalemate.</div>;
              })()}
            </div>
            <div className="popup-actions">
              <button
                className="mm-cancel"
                onClick={()=>{
                  try{ withOpenSocket(ws=>{ try{ ws.send(JSON.stringify({ type:'leaveGame' })); }catch{} }); }catch{}
                  try{ const ws=wsRef.current; if(ws) ws.close(1000,'leave'); }catch{}
                  setShowMatch(true); setQueued(false); setPairedInfo(null); setCountdown(null); setSelected(null);
                }}
              >Return to Matchmaking</button>
              <button
                className="mm-go"
                onClick={()=>{
                  try{ withOpenSocket(ws=>{ try{ ws.send(JSON.stringify({ type:'leaveGame' })); }catch{} }); }catch{}
                  try{ const ws=wsRef.current; if(ws) ws.close(1000,'play-again'); }catch{}
                  setShowMatch(true); setQueued(false); setPairedInfo(null); setCountdown(null); setSelected(null);
                  try{ React.startTransition?.(()=>{ onJoin(); }); }catch{ onJoin(); }
                }}
              >Play Again</button>
            </div>
          </div>
        </div>
      )}

      {/* Matchmaking modal */}
      {showMatch && (queued || pairedInfo) && (
        <div className="match-overlay">
          <div className="match-card">
            <div className="match-header">
              <div className="fw-800">Matchmaking</div>
              <button className="mm-cancel" onClick={()=>{ setMmNotice(null); onCancelQueue(); }}>Cancel</button>
            </div>
            <div className="match-body">
              {(!queued && !pairedInfo) ? (
                <>
                  <div className="mm-row">
                    <div className="mm-col">
                      <div className="mm-label">Your Name</div>
                      <input className="mm-input" value={username} maxLength={16} onChange={(e)=>setUsername(e.target.value)} onBlur={()=>{ localStorage.setItem('username', (username||'').slice(0,16)); withOpenSocket(sock=>{ try{ sock.send(JSON.stringify({ type:'setUsername', username })); }catch{} }); }} />
                    </div>
                    <div className="mm-col">
                      <div className="mm-label">Your Avatar</div>
                      <button className="mm-avatar" title="Choose avatar" onClick={()=> setShowAvatarModal(true)}>
                        <Avatar id={avatarId} size={56} />
                      </button>
                    </div>
                  </div>
                  <div className="mm-row">
                    <div className="mm-col">
                      <div className="mm-label">Piece Color</div>
                      <div className="mm-swatches">
                        {NEON_PALETTE.map(hex=> (
                          <button key={hex} type="button" className={`sw led-swatch ${(myPieceColor||'').toLowerCase()===hex.toLowerCase() ? 'is-active':''}`} style={{ width: 36, height: 36, borderRadius: '50%', background: hex }} onClick={()=>{ setMyPieceColor(hex); localStorage.setItem('chesTint', hex); withOpenSocket(sock=>{ try{ sock.send(JSON.stringify({ type:'setPieceColor', pieceColor: hex })); }catch{} }); }}>
                            <span className="led-ring" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mm-row mm-actions">
                    <div className="mm-btns">
                      <button className="mm-go" onClick={()=>{ setMmNotice(null); onJoin(); }}>Find Match</button>
                    </div>
                  </div>
                </>
              ) : (
              (() => {
                const paired = !!pairedInfo;
                const youCol = (pairedInfo?.you===2?'b':'w');
                const oppCol = youCol==='w' ? 'b' : 'w';
                const youName = (pairedInfo?.usernames?.[youCol]) || (username || 'You');
                const oppName = pairedInfo?.usernames?.[oppCol] || 'Searching…';
                const youColor = paired ? (pieceColors?.[youCol] || (youCol==='w'?'#e5e7eb':'#111827')) : (myPieceColor || '#22d3ee');
                const oppColor = paired ? (pieceColors?.[oppCol] || (oppCol==='w'?'#e5e7eb':'#111827')) : '#111827';
                const youStake = pairedInfo?.stakes?.[youCol] ?? 0;
                const oppStake = pairedInfo?.stakes?.[oppCol];
                const youAv = (pairedInfo?.avatars?.[youCol]) || youAvatar || avatarId;
                const oppAv = (pairedInfo?.avatars?.[oppCol]) || oppAvatar || null;
                return (
                  <>
                    <div className="match-col">
                      <button className="mm-avatar" title="Your avatar" onClick={()=> setShowAvatarModal(true)}>
                        <Avatar id={youAv} size={86} />
                      </button>
                      <div className="mm-pill"><i className="bi bi-person-badge" />{youName}</div>
                      <div className="mm-pill"><i className="bi bi-palette-fill" />Color <span className="mm-swab" style={{ background: youColor, marginLeft: 6 }} /></div>
                      <div className="mm-pill"><i className="bi bi-coin" />Your bet: <strong className="ms-1">{(Number(youStake)||0).toFixed(2)} SC</strong></div>
                    </div>

                    <div className="match-divider">VS</div>

                    <div className="match-col">
                      <div className="mm-avatar" title="Opponent avatar">
                        {oppAv ? <Avatar id={oppAv} size={86} /> : (
                          <div className="mm-dots"><span className="mm-dot"/><span className="mm-dot"/><span className="mm-dot"/></div>
                        )}
                      </div>
                      <div className="mm-pill"><i className="bi bi-person-badge" />{oppAv ? oppName : 'Searching…'}</div>
                      <div className="mm-pill"><i className="bi bi-palette-fill" />Color <span className="mm-swab" style={{ background: oppColor, marginLeft: 6 }} /></div>
                      <div className="mm-pill"><i className="bi bi-coin" />Opponent bet: <strong className="ms-1">{typeof oppStake==='number' ? (Number(oppStake)||0).toFixed(2)+ ' SC' : (oppStake || '—')}</strong></div>
                    </div>
                  </>
                );
              })()
              )}
            </div>
            <div className="p-3 text-center text-secondary">
              {mmNotice && (
                <div className="mb-2" style={{ color:'#f59e0b', fontWeight:600 }}>{mmNotice}</div>
              )}
              {queued || pairedInfo ? (
                countdown!=null
                  ? (<><span>Starting in </span><strong>{countdown}</strong><span>s</span></>)
                  : (<>Waiting for opponent…</>)
              ) : (
                <div className="mm-dots"><span className="mm-dot"/><span className="mm-dot"/><span className="mm-dot"/></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Opponent disconnected popup (mirrors Chess semantics) */}
      {showMatch && dcPopup && (
        <div className="match-overlay endgame-overlay">
          <div className="popup-card">
            <div className="popup-title">Opponent Disconnected</div>
            <div className="popup-body">
              <div>Your game is paused. Waiting for both players to reconnect.</div>
            </div>
            <div className="popup-actions">
              <button
                className="mm-go"
                onClick={()=>{
                  // Re-send claim to resume same game if we have ids
                  const gid = gameIdRef.current; const nm=(username||'').toString().slice(0,40);
                  if(gid && wsRef.current && wsRef.current.readyState===1){
                    try{ wsRef.current.send(JSON.stringify({ type:'claimSavedGame', gameId: gid, username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{}
                  } else if(gid){
                    pendingSavedJoinRef.current = { gameId: gid, triedClaim: false, sent: false, claim: true };
                    connectWs();
                  }
                }}
              >Continue</button>
              <button
                className="mm-cancel"
                onClick={()=>{ setDcPopup(false); }}
              >Close</button>
            </div>
          </div>
        </div>
      )}

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
                  onClick={() => { setAvatarId(a.id); setYouAvatar(a.id); localStorage.setItem('chesAvatar', a.id); withOpenSocket(sock=>{ try{ sock.send(JSON.stringify({ type:'setAvatar', avatar: a.id })); }catch{} }); setShowAvatarModal(false); }}
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
      </main>
    </div>
  );
}
