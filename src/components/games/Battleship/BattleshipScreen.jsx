/* eslint-disable no-console */
import React from 'react';
import NavBar from '../../NavBar';
import LoginOverlay from '../../common/LoginOverlay';
import GameSetup from '../../common/GameSetup';
import QuickChat from '../common/QuickChat';
import WaitingOverlay from '../common/WaitingOverlay';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import './BattleshipScreen.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

const SIZE = 10;
const SHIPS = [5,4,3,3,2];
const API_WS = (()=>{ const { protocol, hostname } = window.location; const proto = protocol==='https:'?'wss':'ws'; const host = (window.SERVER_HOST||localStorage.getItem('serverHost')||hostname); return `${proto}://${host}:3015`; })();

function emptyPlacement(){
  // Maintain server-required order with placeholders
  return SHIPS.map((len)=>({ len, r:null, c:null, dir:'H' }));
}

function randomPlacement(){
  // Simple randomized non-overlapping placement
  const used = new Set();
  const out = [];
  for(const len of SHIPS){
    let placed = null;
    for(let tries=0; tries<500 && !placed; tries++){
      const dir = Math.random()<0.5?'H':'V';
      const maxR = dir==='V' ? 10 - len : 10 - 1;
      const maxC = dir==='H' ? 10 - len : 10 - 1;
      const r = Math.floor(Math.random()*(maxR+1));
      const c = Math.floor(Math.random()*(maxC+1));
      let ok = true;
      for(let i=0;i<len;i++){
        const rr = r + (dir==='V'?i:0);
        const cc = c + (dir==='H'?i:0);
        const k = `${rr}-${cc}`;
        if(used.has(k)){ ok=false; break; }
      }
      if(ok){
        for(let i=0;i<len;i++){
          const rr = r + (dir==='V'?i:0);
          const cc = c + (dir==='H'?i:0);
          used.add(`${rr}-${cc}`);
        }
        placed = { len, r, c, dir };
      }
    }
    out.push(placed || { len, r:0, c:0, dir:'H' });
  }
  return out;
}

function BoardGrids({ x=0, z=0, size=SIZE, color='#22d3ee' }){
  const lines=[]; for(let i=0;i<=size;i++){ lines.push([[0,0,i],[size,0,i]]); lines.push([[i,0,0],[i,0,size]]); }
  return (
    <group position={[x,0,z]}>
      {lines.map((pts,i)=> (<Line key={i} points={pts} color={color} lineWidth={2.2} transparent opacity={0.55}/>))}
    </group>
  );
}

function ShipMesh({ len, dir='H', color='#a78bfa' }){
  const geomArgs = dir==='H' ? [len-0.2, 0.2, 0.8] : [0.8, 0.2, len-0.2];
  return (
    <mesh castShadow receiveShadow position={[0,0.11,0]}>
      <boxGeometry args={geomArgs} />
      <meshStandardMaterial color={color} metalness={0.2} roughness={0.4} emissive={color} emissiveIntensity={0.25} />
    </mesh>
  );
}

function Battleship3D({ phase, placed, myShips, hits, misses, targetHits, targetMisses, onCellClick, placement, onPlaceCell, onHoverCell, selectedIdx }){
  const isMobile = (()=>{ try{ return window.matchMedia('(max-width: 640px)').matches; }catch{return false;} })();
  const camPos = isMobile ? [6, 16, 24] : [6, 12, 18];
  const tile = 1;
  return (
    <Canvas camera={{ position: camPos, fov: 45, near:0.08, far:100 }} dpr={isMobile?1:1} style={{ width:'100%', height:'100%' }} onCreated={(st)=>{ try{ st.gl.setClearColor('#0f172a'); }catch{} }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[6,12,6]} intensity={1.0} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <spotLight position={[6,14,8]} angle={1.0} intensity={1.5} />
  <OrbitControls target={[5,0,11]} enablePan={false} minPolarAngle={0.06} maxPolarAngle={Math.PI*0.45} minDistance={10} maxDistance={24} />
      {/* Plates - front board (centered under grid) */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[5, -0.08, 5]}>
        <planeGeometry args={[SIZE+2, SIZE+2]} />
        <meshStandardMaterial color={'#030712'} emissive={'#030712'} emissiveIntensity={0.2}/>
      </mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[5, -0.03, 5]}>
        <planeGeometry args={[SIZE, SIZE]} />
        <meshStandardMaterial color={'#0b0f1a'} emissive={'#0b0f1a'} emissiveIntensity={0.35}/>
      </mesh>
      {/* Plates - back board (centered under rotated grid) */}
      <mesh rotation={[-Math.PI/2,0,0]} position={[5, -0.08, SIZE + 2.5 + 5]}>
        <planeGeometry args={[SIZE+2, SIZE+2]} />
        <meshStandardMaterial color={'#030712'} emissive={'#030712'} emissiveIntensity={0.2}/>
      </mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[5, -0.03, SIZE + 2.5 + 5]}>
        <planeGeometry args={[SIZE, SIZE]} />
        <meshStandardMaterial color={'#0b0f1a'} emissive={'#0b0f1a'} emissiveIntensity={0.35}/>
      </mesh>

      {/* Your board (front) */}
      <group position={[0,0,0]}>
        <BoardGrids x={0} z={0} />
        {/* Placement hover/tiles */}
        {phase==='place' && !placed && Array.from({length:SIZE}).map((_,r)=>Array.from({length:SIZE}).map((_,c)=>{
          const x=c*tile, z=r*tile;
          const preview = placement && placement.preview && placement.preview.r===r && placement.preview.c===c;
          const can = preview ? placement.preview.can : false;
          return (
            <mesh key={`pb-${r}-${c}`} position={[x,0.001,z]} rotation={[-Math.PI/2,0,0]}
              onPointerOver={()=> onHoverCell?.(r,c)} onPointerOut={()=> onHoverCell?.(null,null)}
              onClick={()=> onPlaceCell?.(r,c)}>
              <planeGeometry args={[tile,tile]} />
              <meshStandardMaterial color={preview? (can?'#073916':'#3a0a0a') : '#0b1326'} emissive={preview? (can?'#16a34a':'#ef4444') : '#05060a'} emissiveIntensity={preview?0.4:0.08} opacity={0.95} transparent/>
            </mesh>
          );
        }))}
        {/* Ships */}
        {Array.isArray(myShips) && myShips.map((s,i)=>{
          if(s.r==null || s.c==null) return null;
          const x = s.dir==='H' ? (s.c + (s.len/2)-0.5) : (s.c);
          const z = s.dir==='H' ? (s.r) : (s.r + (s.len/2)-0.5);
          const sel = (phase==='place' && !placed && selectedIdx===i);
          return (
            <group key={`ship-${i}`} position={[x,0.0,z]} onClick={()=> onHoverCell?.(s.r,s.c)}>
              <ShipMesh len={s.len} dir={s.dir} color={sel?'#fde047':'#a78bfa'} />
            </group>
          );
        })}
        {/* Ghost preview ship */}
        {phase==='place' && !placed && placement && placement.preview && (()=>{
          const s = myShips[selectedIdx]; if(!s) return null; const { r, c } = placement.preview; const dir = placement.dir||s.dir||'H';
          const x = dir==='H' ? (c + (s.len/2)-0.5) : (c);
          const z = dir==='H' ? (r) : (r + (s.len/2)-0.5);
          const color = placement.preview.can ? '#22c55e' : '#ef4444';
          return (
            <group position={[x,0.0,z]}>
              <ShipMesh len={s.len} dir={dir} color={color} />
            </group>
          );
        })()}
        {/* Hits/Misses on your board */}
        {(Array.isArray(hits)?hits:[]).map((k,i)=>{ const [r,c]=k.split('-').map(Number); return (
          <mesh key={`yh-${i}`} position={[c,0.02,r]}>
            <cylinderGeometry args={[0.18,0.18,0.04,24]} />
            <meshStandardMaterial color={'#ef4444'} emissive={'#ef4444'} emissiveIntensity={0.7} />
          </mesh>
        ); })}
        {(Array.isArray(misses)?misses:[]).map((k,i)=>{ const [r,c]=k.split('-').map(Number); return (
          <mesh key={`ym-${i}`} position={[c,0.02,r]}>
            <torusGeometry args={[0.18,0.04,10,24]} />
            <meshStandardMaterial color={'#22d3ee'} emissive={'#22d3ee'} emissiveIntensity={0.5} />
          </mesh>
        ); })}
      </group>

      {/* Target board (back, rotated; exact mirror over back plate) */}
      <group position={[0, 0, SIZE + 2.5]} rotation={[0, Math.PI, 0]}>
        <BoardGrids x={0} z={0} />
        {/* Interactive tiles */}
        {Array.from({length:SIZE}).map((_,r)=>Array.from({length:SIZE}).map((_,c)=>{
          const x=c*tile, z=r*tile; return (
            <mesh key={`t-${r}-${c}`} position={[x,0.001,z]} rotation={[-Math.PI/2,0,0]} onClick={()=> onCellClick?.(r,c)}>
              <planeGeometry args={[tile,tile]} />
              <meshStandardMaterial color={'#0b1326'} emissive={'#05060a'} emissiveIntensity={0.08} />
            </mesh>
          );
        }))}
        {/* Hits/Misses you scored on target board */}
        {(Array.isArray(targetHits)?targetHits:[]).map((k,i)=>{ const [r,c]=k.split('-').map(Number); return (
          <mesh key={`th-${i}`} position={[c,0.02,r]}>
            <cylinderGeometry args={[0.18,0.18,0.04,24]} />
            <meshStandardMaterial color={'#ef4444'} emissive={'#ef4444'} emissiveIntensity={0.7} />
          </mesh>
        ); })}
        {(Array.isArray(targetMisses)?targetMisses:[]).map((k,i)=>{ const [r,c]=k.split('-').map(Number); return (
          <mesh key={`tm-${i}`} position={[c,0.02,r]}>
            <torusGeometry args={[0.18,0.04,10,24]} />
            <meshStandardMaterial color={'#22d3ee'} emissive={'#22d3ee'} emissiveIntensity={0.5} />
          </mesh>
        ); })}
      </group>
    </Canvas>
  );
}

export default function BattleshipScreen(){
  const [authed, setAuthed] = React.useState(!!localStorage.getItem('token') && !!localStorage.getItem('username'));
  React.useEffect(()=>{ const onAuth=()=> setAuthed(!!localStorage.getItem('token') && !!localStorage.getItem('username')); window.addEventListener('authchange', onAuth); return ()=> window.removeEventListener('authchange', onAuth); },[]);
  const [wsConnected, setWsConnected] = React.useState(false);
  const [playerNum, setPlayerNum] = React.useState(null); // 1|2
  const playerNumRef = React.useRef(null);
  const [phase, setPhase] = React.useState('place');
  const [myShips, setMyShips] = React.useState(emptyPlacement());
  const [placed, setPlaced] = React.useState(false);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [hoverRC, setHoverRC] = React.useState({ r:null, c:null });
  const [yourTurn, setYourTurn] = React.useState(false);
  const [lastShot, setLastShot] = React.useState(null);
  const [winner, setWinner] = React.useState(null);
  const [chatFeed, setChatFeed] = React.useState([]);
  const [presence, setPresence] = React.useState({ p1: true, p2: true });
  const [targetHits, setTargetHits] = React.useState([]);
  const [targetMisses, setTargetMisses] = React.useState([]);
  const [yourBoardHits, setYourBoardHits] = React.useState([]);
  const [yourBoardMisses, setYourBoardMisses] = React.useState([]);
  const [showMatch, setShowMatch] = React.useState(false);
  const [pairedInfo, setPairedInfo] = React.useState(null); // { you, usernames, gameId, token }
  const [countdown, setCountdown] = React.useState(null);
  const [username, setUsername] = React.useState(localStorage.getItem('username') || '');
  const [joinPending, setJoinPending] = React.useState(false);
  const joinPendingRef = React.useRef(false);

  const wsRef = React.useRef(null);
  const connect = React.useCallback((join=false)=>{
    try{ if(wsRef.current){ try{ wsRef.current.close(1000,'reconnect'); }catch{} wsRef.current=null; } }catch{}
    const ws = new WebSocket(API_WS); wsRef.current = ws;
    ws.onopen = ()=>{ setWsConnected(true); if(join || joinPendingRef.current){ try{ ws.send(JSON.stringify({ type:'joinGame', username })); setJoinPending(false); joinPendingRef.current=false; }catch{} } };
    ws.onclose = ()=> setWsConnected(false);
    ws.onerror = ()=> setWsConnected(false);
    ws.onmessage = (ev)=>{
      let msg={}; try{ msg=JSON.parse(ev.data); }catch{}
      if(msg.type==='queued'){ setShowMatch(true); setPairedInfo(null); setCountdown(null); }
      if(msg.type==='paired'){
        // Store lightweight paired info to show in overlay
        setPairedInfo({ you: msg.you, usernames: msg.usernames||{ 'Player 1':'P1','Player 2':'P2' }, gameId: msg.gameId||null, token: msg.token||null });
        setPlayerNum(msg.you); playerNumRef.current = msg.you; setShowMatch(true);
      }
      if(msg.type==='countdown'){ setCountdown(Number(msg.value)||null); }
      if(msg.type==='startGame'){
        setPlayerNum(msg.you); playerNumRef.current = msg.you; setPhase(msg.phase||'place'); setShowMatch(false); setCountdown(null);
      }
      if(msg.type==='placeAck'){ setPlaced(true); }
      if(msg.type==='gameUpdate'){
        setPhase(msg.phase||'place'); setYourTurn(!!msg.yourTurn); setLastShot(msg.lastShot||null); setWinner(msg.winner||null);
        if(Array.isArray(msg.youHits)) setTargetHits(msg.youHits);
        if(Array.isArray(msg.youMisses)) setTargetMisses(msg.youMisses);
        if(Array.isArray(msg.yourBoardHits)) setYourBoardHits(msg.yourBoardHits);
        if(Array.isArray(msg.yourBoardMisses)) setYourBoardMisses(msg.yourBoardMisses);
      }
      if(msg.type==='quickChat'){
        const youSide = (playerNumRef.current===2?'p2':'p1');
        const from = msg.from === youSide ? 'you' : 'opp';
        setChatFeed(prev => [...prev, { from, username: msg.username, text: String(msg.text||'').slice(0,80), ts: Number(msg.ts)||Date.now() }].slice(-12));
      }
      if(msg.type==='presence'){ setPresence(msg.present||{p1:true,p2:true}); }
      if(msg.type==='opponentLeft'){
        // Reset queued/paired state if opponent bails pre-start
        setShowMatch(false); setPairedInfo(null); setCountdown(null);
      }
    };
  }, [username]);

  React.useEffect(()=>{ connect(false); return ()=>{ try{ wsRef.current && wsRef.current.close(1000,'cleanup'); }catch{} }; },[]);
  const withWS = React.useCallback(fn=>{ const ws=wsRef.current; if(ws && ws.readyState===WebSocket.OPEN) fn(ws); },[]);

  const onJoin = React.useCallback(()=>{
    setShowMatch(true);
    const ws = wsRef.current;
    if(ws && ws.readyState===WebSocket.OPEN){
      try{ ws.send(JSON.stringify({ type:'joinGame', username })); }catch{}
    }else{
      setJoinPending(true); joinPendingRef.current = true;
      if(!ws || ws.readyState===WebSocket.CLOSED){ connect(false); }
    }
  },[connect, username]);

  const onCancelQueue = React.useCallback(()=>{
    setShowMatch(false); setPairedInfo(null); setCountdown(null);
    const ws = wsRef.current; try{ if(ws && ws.readyState===WebSocket.OPEN){ ws.send(JSON.stringify({ type:'leaveGame' })); } }catch{}
    setJoinPending(false); joinPendingRef.current = false;
  },[]);

  // Client-side placement helpers
  const placementValid = React.useMemo(()=>{
    if(!Array.isArray(myShips) || myShips.length!==SHIPS.length) return false;
    const used=new Set();
    for(let i=0;i<myShips.length;i++){
      const s=myShips[i]; if(!s) return false; if(s.len!==SHIPS[i]) return false; if(s.r==null||s.c==null) return false; const dir=(s.dir==='V'?'V':'H');
      for(let k=0;k<s.len;k++){
        const rr=s.r+(dir==='V'?k:0), cc=s.c+(dir==='H'?k:0);
        if(rr<0||rr>=SIZE||cc<0||cc>=SIZE) return false; const key=`${rr}-${cc}`; if(used.has(key)) return false; used.add(key);
      }
    }
    return true;
  },[myShips]);

  const onPlace = React.useCallback(()=>{
    if(placed) return;
    if(!placementValid){ alert('Place all ships first without overlaps'); return; }
    withWS(ws=>{ ws.send(JSON.stringify({ type:'placeShips', ships: myShips })); });
  }, [placed, placementValid, myShips, withWS]);

  const rotateSelected = React.useCallback(()=>{
    setMyShips(prev=> prev.map((s,i)=> i===selectedIdx ? ({...s, dir: s.dir==='H'?'V':'H'}) : s));
  },[selectedIdx]);

  const clearPlacement = React.useCallback(()=>{
    setMyShips(emptyPlacement()); setSelectedIdx(0);
  },[]);

  const randomizePlacement = React.useCallback(()=>{
    setMyShips(randomPlacement()); setSelectedIdx(0);
  },[]);

  // Hover/preview + placement on your board
  const computePreview = React.useCallback((r,c)=>{
    const s = myShips[selectedIdx]; if(!s) return { r, c, can:false };
    const dir = s.dir==='V'?'V':'H';
    if(r==null||c==null) return { r:null, c:null, can:false };
    if(dir==='H' && c > SIZE - s.len) return { r, c, can:false };
    if(dir==='V' && r > SIZE - s.len) return { r, c, can:false };
    // overlap check
    const used=new Set();
    for(let i=0;i<myShips.length;i++){
      if(i===selectedIdx) continue; const ss=myShips[i]; if(!ss||ss.r==null||ss.c==null) continue; const d=ss.dir==='V'?'V':'H';
      for(let k=0;k<ss.len;k++){ const rr=ss.r+(d==='V'?k:0), cc=ss.c+(d==='H'?k:0); used.add(`${rr}-${cc}`); }
    }
    for(let k=0;k<s.len;k++){ const rr=r+(dir==='V'?k:0), cc=c+(dir==='H'?k:0); if(used.has(`${rr}-${cc}`)) return { r, c, can:false }; }
    return { r, c, can:true };
  },[myShips, selectedIdx]);

  const onHoverCell = React.useCallback((r,c)=>{ setHoverRC({ r, c }); },[]);
  const onPlaceCell = React.useCallback((r,c)=>{
    if(phase!=='place' || placed) return; const prev = computePreview(r,c); if(!prev.can) return;
    setMyShips(old=> old.map((s,i)=> i===selectedIdx ? ({...s, r, c}) : s));
    // Advance selection to next unplaced ship
    setSelectedIdx(curr=>{
      for(let i=0;i<myShips.length;i++){
        const idx = (curr + 1 + i) % myShips.length;
        const s = (idx===selectedIdx) ? { ...myShips[idx], r, c } : myShips[idx];
        if(s.r==null || s.c==null) return idx;
      }
      return curr;
    });
  },[phase, placed, selectedIdx, computePreview]);

  // Keyboard: R to rotate during placement
  React.useEffect(()=>{
    function onKey(e){
      if(e.key==='r' || e.key==='R'){
        if(phase==='place' && !placed){ e.preventDefault(); rotateSelected(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  },[phase, placed, rotateSelected]);
  const onFire = React.useCallback((r,c)=>{ if(phase!=='battle' || !yourTurn) return; withWS(ws=> ws.send(JSON.stringify({ type:'fire', r, c })) ); }, [phase, yourTurn, withWS]);

  const showLogin = !authed;
  const showConnecting = authed && !wsConnected && (showMatch || !!playerNum);
  const oppMissing = presence && (playerNum===1 ? (presence.p2===false) : (presence.p1===false));

  // Derived placement UI model for preview
  const placementModel = React.useMemo(()=>{
    const s = myShips[selectedIdx];
    const prev = computePreview(hoverRC.r, hoverRC.c);
    return { dir: s?.dir || 'H', preview: prev };
  },[myShips, selectedIdx, hoverRC, computePreview]);

  return (
    <div className="cf-screen cf-battleship">
      <NavBar />
      <div className="nav-spacer" aria-hidden="true" />
      <main className={`app-content ${playerNum ? 'app-content--full' : ''}`}>
        {showLogin && (<LoginOverlay />)}
        {!showLogin && showConnecting && (
          <WaitingOverlay show title="Connecting…" body="Establishing game connection." />
        )}
        {!playerNum && (
          <div className="d-flex justify-content-center">
            <div className="prejoin-float" style={{ width:'100%' }} onClick={(e)=>e.stopPropagation()}>
              <GameSetup
                title="Battleship"
                badge="PVP"
                username={username}
                setUsername={setUsername}
                stakeText={'0'}
                setStakeText={()=>{}}
                scBalance={0}
                currencyLabel="SC"
                joinLabel="Join Game"
                onJoin={onJoin}
                joinDisabled={!username}
                colors={["#22d3ee","#a78bfa"]}
                selectedColor="#22d3ee"
                onPickColor={()=>{}}
              />
            </div>
          </div>
        )}

        {showMatch && (
          <div className="match-overlay" onClick={onCancelQueue}>
            <div className="match-card" onClick={(e)=>e.stopPropagation()}>
              <div className="match-header">
                <h3>Matchmaking</h3>
                <button className="mm-cancel" onClick={onCancelQueue}>Cancel</button>
              </div>
              <div className="match-body">
                {(() => {
                  const youRole = (pairedInfo?.you===2 ? 'Player 2' : 'Player 1');
                  const oppRole = youRole==='Player 1' ? 'Player 2' : 'Player 1';
                  const youName = pairedInfo?.usernames?.[youRole] ?? (username || 'You');
                  const oppName = pairedInfo?.usernames?.[oppRole] ?? 'Searching…';
                  return (
                    <>
                      <div className="match-col">
                        <div className="mm-avatar" title="You">🚢</div>
                        <div className="mm-pill"><i className="bi bi-person-badge" />{youName}</div>
                        <div className="mm-pill"><i className="bi bi-bullseye" />Mode <strong className="ms-1">PvP</strong></div>
                      </div>
                      <div className="match-divider">VS</div>
                      <div className="match-col">
                        <div className="mm-avatar" title="Opponent">
                          <div className="mm-dots"><span className="mm-dot"/><span className="mm-dot"/><span className="mm-dot"/></div>
                        </div>
                        <div className="mm-pill"><i className="bi bi-person-badge" />{pairedInfo ? oppName : 'Searching…'}</div>
                        <div className="mm-pill"><i className="bi bi-radar" />Finding best match…</div>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div className="p-3 text-center text-secondary">
                {countdown!=null
                  ? (<><span>Starting in </span><strong>{countdown}</strong><span>s</span></>)
                  : (pairedInfo ? (<>Waiting for opponent…</>) : (<div className="mm-dots"><span className="mm-dot"/><span className="mm-dot"/><span className="mm-dot"/></div>))}
              </div>
            </div>
          </div>
        )}

        {playerNum && (
          <div className="game-area">
            <div className="board-fullwrap">
              <div className="board-shell">
                <Battleship3D
                  phase={phase}
                  placed={placed}
                  myShips={myShips}
                  hits={yourBoardHits}
                  misses={yourBoardMisses}
                  targetHits={targetHits}
                  targetMisses={targetMisses}
                  onCellClick={(r,c)=> onFire(r,c)}
                  placement={placementModel}
                  onHoverCell={onHoverCell}
                  onPlaceCell={onPlaceCell}
                  selectedIdx={selectedIdx}
                />
              </div>
            </div>
            <div className="text-center mt-2">
              {phase==='place' && !placed && (
                <div className="d-flex flex-wrap gap-2 justify-content-center align-items-center">
                  <div className="btn-group" role="group" aria-label="Ships">
                    {SHIPS.map((len, i)=>{
                      const s = myShips[i]; const done = s.r!=null && s.c!=null; const active = selectedIdx===i;
                      return (
                        <button key={i} className={`btn btn-sm ${active?'btn-warning':'btn-outline-secondary'}`} onClick={()=> setSelectedIdx(i)}>
                          {len}{done?'✓':''}
                        </button>
                      );
                    })}
                  </div>
                  <button className="btn btn-sm btn-outline-light" onClick={rotateSelected} title="Rotate (R)">Rotate</button>
                  <button className="btn btn-sm btn-outline-info" onClick={randomizePlacement}>Randomize</button>
                  <button className="btn btn-sm btn-outline-danger" onClick={clearPlacement}>Clear</button>
                  <button className="btn btn-light" disabled={!placementValid} onClick={onPlace}>Lock In Placement</button>
                </div>
              )}
              {phase==='battle' && (
                <div className="small text-secondary">{yourTurn ? 'Your turn — click a target square' : 'Waiting for opponent…'}</div>
              )}
              {winner && (<div className="win-banner mt-2">{winner===1?'Player 1':'Player 2'} wins!</div>)}
            </div>

            <QuickChat
              messages={chatFeed}
              youKey="you"
              align="right"
              canSend={!!playerNum && wsConnected}
              onSend={(text)=> withWS(ws=>{ try{ ws.send(JSON.stringify({ type:'quickChat', text:String(text).slice(0,80) })); }catch{} }) }
            />
            <WaitingOverlay show={!!oppMissing} />
          </div>
        )}
      </main>
    </div>
  );
}
