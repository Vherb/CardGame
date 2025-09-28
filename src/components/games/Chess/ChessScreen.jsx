/* eslint-disable no-console */
import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense, startTransition } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { Card, Row, Col, Button, Form, InputGroup, Badge } from 'react-bootstrap';
import GameSetup from '../../common/GameSetup';
import NavBar from '../../NavBar';
import './ChessScreen.css';
import LoginOverlay from '../../common/LoginOverlay';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, ContactShadows, AccumulativeShadows, RandomizedLight, Line } from '@react-three/drei';
import ChessVectorBoard from './ChessVectorBoard';
import ChessVector3D from './ChessVector3D';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import QuickChat from '../common/QuickChat';
import WaitingOverlay from '../common/WaitingOverlay';

// STL/FBX loaders removed; using GLB via useGLTF only

const CHESS_MODEL_SCALE = 0.35; // base multiplier; GLB auto-fit refines size
const CHESS_GLB_FOOTPRINT = 0.8; // GLB target footprint (tile units)
const CHESS_GLB_HEIGHT = 1.0;    // GLB target height (tile units)
const CHESS_GLB_GLOBAL_SCALE = 3.0;
const PROC_PIECE_SCALE = 0.6;

// Avatar set — match other games (Connect Four)
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
const Avatar=({id,size=72})=>{const a=findAvatar(id);return(
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
      color:'#fff',
      fontSize:Math.round(size*.55),
      lineHeight:1
    }}
    aria-label={a.label}
    title={a.label}
  >{a.glyph}</div>
);};

// Neon palette for bright piece tints
const NEON_PALETTE = ['#22D3EE','#60A5FA','#A78BFA','#F472B6','#F59E0B','#84CC16','#EF4444','#14B8A6','#EAB308','#FFFFFF'];
function ColorSwatch({ hex, active, onPick }){
  return (
    <button type="button" className={`sw led-swatch ${active? 'is-active':''}`} style={{ width: 44, height: 44, borderRadius: '50%', background: hex }} title={hex} aria-label={`Choose ${hex}`} onClick={()=>onPick(hex)}>
      <span className="led-ring" />
    </button>
  );
}

function modelsEnabled(){
  try{
    const qs = new URLSearchParams(window.location.search);
    const q = (qs.get('models')||'').toLowerCase();
    const ls = (localStorage.getItem('chessModels')||'').toLowerCase();
    const forceBasicMobile = (qs.get('mobileBasic')||localStorage.getItem('mobileBasic')||'').toLowerCase();
    if(forceBasicMobile==='1' || forceBasicMobile==='true' || forceBasicMobile==='on'){
      if (window.matchMedia && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches)) return false;
    }
    const forceOff = (q==='off') || (ls==='off' || ls==='false' || ls==='0');
    const forceOn  = (q==='on')  || (ls==='on'  || ls==='true'  || ls==='1');
    if(forceOff) return false;
    if(forceOn) return true;
    // Default: use GLB models on all devices; mobile perf is handled elsewhere
    return true;
  }catch{ return true; }
}

const API = (()=>{ const { protocol, hostname } = window.location; const envHost=(process.env.REACT_APP_SERVER_HOST||'').trim(); const winHost=(window.SERVER_HOST?String(window.SERVER_HOST).trim():''); let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{} const host=envHost||winHost||lsHost||hostname; return process.env.REACT_APP_API_BASE || `${protocol}//${host}:3002`; })();
function authFetch(path, options = {}) {
  const token = localStorage.getItem('token') || '';
  return fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers||{}), ...(token?{ Authorization:`Bearer ${token}`}:{}), }, });
}
async function scAdjust(delta, memo = '') { const r = await authFetch('/sc/adjust', { method:'POST', body: JSON.stringify({ delta:Number(delta), memo }) }); const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j?.message||'SC adjust failed'); return j; }
async function getBalance(){ const r = await authFetch('/balance'); const j = await r.json().catch(()=>({sc_balance:0})); return Number(j.sc_balance)||0; }

const getWsUrl = () => {
  const { protocol, hostname } = window.location;
  const proto = protocol === 'https:' ? 'wss' : 'ws';
  // Unified mode: use API base host:port so we hit the unified server (usually :3002 in dev)
  if (process.env.REACT_APP_UNIFIED_WS === '1') {
    try {
      const u = new URL(API);
      const wsProto = u.protocol === 'https:' ? 'wss' : 'ws';
      return `${wsProto}://${u.host}/ws/chess`;
    } catch {
      return `${proto}://${hostname}:3002/ws/chess`;
    }
  }
  // Legacy: direct to dedicated port
  const envHost=(process.env.REACT_APP_SERVER_HOST||'').trim(); const winHost=(window.SERVER_HOST?String(window.SERVER_HOST).trim():''); let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{} const host=envHost||winHost||lsHost||hostname; const port = 3012; return `${proto}://${host}:${port}`;
};

// Speed up model loads
THREE.Cache.enabled = true;
try{
  const names=['pawn','rook','knight','bishop','queen','king'];
  names.forEach(n=>{ try{ useGLTF.preload(`/models/chess/${n}.glb`); }catch{} });
  // Preload mobile low-poly variants
  const low = ['pawn','rook','knight','bishop','queen','king'];
  low.forEach(n=>{ try{ useGLTF.preload(`/models/chess/low_poly_${n}.glb`); }catch{} });
}catch{}

// Adaptive DPR for mobile: gently drop DPR if FPS is low
function MobileAdaptiveDpr({ minDpr=0.8, maxDpr=1.25, targetFps=45, activityRef, controlsMovingRef }){
  const { gl } = useThree();
  const last = useRef({ t: performance.now(), frames: 0, fps: 60, dpr: gl.getPixelRatio?.() || 1 });
  const isMobile = useMemo(()=>{
    try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;}
  },[]);
  useEffect(()=>{
    if(!isMobile) return;
    const pr = gl.getPixelRatio?.() || 1;
    if(pr>maxDpr) gl.setPixelRatio?.(maxDpr);
  },[gl,isMobile,maxDpr]);
  useFrame(()=>{
    if(!isMobile) return;
    const moving = !!(activityRef?.current?.moving || controlsMovingRef?.current);
    if(moving) return; // hold DPR steady while moving to avoid flashes
    const now = performance.now();
    last.current.frames++;
    const dt = now - last.current.t;
    if(dt >= 500){
      const fps = (last.current.frames * 1000) / dt;
      last.current.fps = fps;
      last.current.t = now;
      last.current.frames = 0;
      const cur = gl.getPixelRatio?.() || 1;
      let next = cur;
      if(fps < targetFps){
        next = Math.max(minDpr, cur * 0.9);
      }else if(fps > 58 && cur < maxDpr){
        next = Math.min(maxDpr, cur * 1.05);
      }
      if(Math.abs(next - cur) > 0.02){
        gl.setPixelRatio?.(next);
      }
    }
  });
  return null;
}

function MobileFXAA({ activityRef, controlsMovingRef }){
  const { gl, scene, camera, size, invalidate } = useThree();
  const composerRef = useRef();
  const fxaaRef = useRef();
  const lastDpr = useRef(0);
  const wasMoving = useRef(false);
  const isMobile = useMemo(()=>{
    try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;}
  },[]);
  useEffect(()=>{
    if(!isMobile) return;
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms['resolution'].value.set(1/size.width, 1/size.height);
    composer.addPass(fxaaPass);
    composerRef.current = composer;
    fxaaRef.current = fxaaPass;
    const resize = ()=>{
      composer.setSize(size.width, size.height);
      fxaaPass.material.uniforms['resolution'].value.set(1/size.width, 1/size.height);
    };
    resize();
    return ()=>{
      composer.dispose();
    };
  },[gl,scene,camera,size.width,size.height,isMobile]);
  useFrame((_,dt)=>{
    if(!isMobile) return;
    const comp = composerRef.current; if(!comp) return;
    const curDpr = gl.getPixelRatio?.() || 1;
    if(Math.abs(curDpr - lastDpr.current) > 0.01 && fxaaRef.current){
      // Pixel ratio changed: update composer size and FXAA resolution
      comp.setSize(size.width, size.height);
      fxaaRef.current.material.uniforms['resolution'].value.set(1/size.width, 1/size.height);
      lastDpr.current = curDpr;
    }
    const moving = !!(activityRef?.current?.moving || controlsMovingRef?.current);
    if(moving){
      wasMoving.current = true;
      return; // let default renderer handle moving frames (faster)
    }
    if(wasMoving.current){
      // Just stopped moving: render one FXAA pass to present a crisp frame
      comp.render(dt);
      wasMoving.current = false;
    }
  }, 1);
  return null;
}

function MobileQualityManager({ activityRef, controlsMovingRef }){
  const { gl, invalidate } = useThree();
  const isMobile = useMemo(()=>{
    try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;}
  },[]);
  const stateRef = useRef({ moving:false, timer:null });
  useEffect(()=>{
    if(!isMobile) return;
    // Start in high quality when idle
    try{ gl.setPixelRatio?.(1.15); invalidate(); }catch{}
    const el = gl.domElement;
    const onStart = ()=>{
      const st = stateRef.current; st.moving = true; if(st.timer){ clearTimeout(st.timer); st.timer=null; }
      // Do not drop DPR on start; keep stable during motion to avoid flashes
      try{ invalidate(); }catch{}
    };
    const onEnd = ()=>{
      const st = stateRef.current; st.moving = false; if(st.timer){ clearTimeout(st.timer); }
      st.timer = setTimeout(()=>{ if(!stateRef.current.moving){ try{ gl.setPixelRatio?.(1.15); invalidate(); }catch{} } }, 220);
    };
    const movePoll = setInterval(()=>{
      if(!isMobile) return;
      const m = !!(activityRef?.current?.moving || controlsMovingRef?.current);
      if(m && !stateRef.current.moving) onStart();
      if(!m && stateRef.current.moving) onEnd();
    }, 100);
    // Pointer listeners as a fallback
    el.addEventListener('pointerdown', onStart);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
    return ()=>{
      clearInterval(movePoll);
      el.removeEventListener('pointerdown', onStart);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      if(stateRef.current.timer){ clearTimeout(stateRef.current.timer); }
    };
  },[gl,isMobile,activityRef,controlsMovingRef,invalidate]);
  return null;
}

// Optional mobile pinch-zoom with anchored zoom (inspired by 2D board)
function MobileAltZoom({ enabled=false, minDistance=4.5, maxDistance=14.0, activityRef }){
  const { gl, camera, size, invalidate } = useThree();
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0,1,0), 0)); // y=0 board plane
  const rayRef = useRef(new THREE.Ray());
  const touches = useRef(new Map());
  const pinch = useRef({ active:false, startDist:1, startRadius:1, lastMid:{x:0,y:0} });
  const targetRef = useRef(new THREE.Vector3(3.5, 0, 3.5));
  const tmpVec = useRef(new THREE.Vector3());
  const tmpVec2 = useRef(new THREE.Vector3());

  // Initialize target from current camera lookAt assumption
  useEffect(()=>{
    try{
      targetRef.current.set(3.5,0,3.5);
      camera.lookAt(targetRef.current);
    }catch{}
  },[camera]);

  const getCanvasRect = useCallback(()=> gl.domElement.getBoundingClientRect(), [gl]);

  const screenToWorldOnPlane = useCallback((clientX, clientY)=>{
    const rect = getCanvasRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ndc = new THREE.Vector3(nx, ny, 0.5);
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    rayRef.current.set(camera.position, dir);
    const hit = rayRef.current.intersectPlane(planeRef.current, new THREE.Vector3());
    return hit || null;
  }, [camera, getCanvasRect]);

  const setRadiusAroundTarget = useCallback((newRadius)=>{
    const t = targetRef.current;
    const v = tmpVec.current.copy(camera.position).sub(t);
    const len = v.length();
    if (len < 1e-6) { v.set(0, 6, 0); }
    v.normalize().multiplyScalar(newRadius);
    camera.position.copy(t).add(v);
    camera.lookAt(t);
  }, [camera]);

  const anchoredZoomTo = useCallback((newRadius, anchorX, anchorY)=>{
    const t = targetRef.current;
    const before = screenToWorldOnPlane(anchorX, anchorY);
    const r = THREE.MathUtils.clamp(newRadius, minDistance, maxDistance);
    setRadiusAroundTarget(r);
    const after = screenToWorldOnPlane(anchorX, anchorY);
    if(before && after){
      const dx = before.x - after.x; const dz = before.z - after.z;
      t.add(tmpVec2.current.set(dx, 0, dz));
      camera.position.add(tmpVec2.current);
      camera.lookAt(t);
    }
    try{ invalidate(); }catch{}
  }, [camera, minDistance, maxDistance, screenToWorldOnPlane, setRadiusAroundTarget, invalidate]);

  useEffect(()=>{
    if(!enabled) return;
    const el = gl.domElement;
    const onWheel = (ev)=>{
      ev.preventDefault();
      const rect = getCanvasRect();
      const midX = ev.clientX, midY = ev.clientY;
      const t = targetRef.current;
      const curRadius = camera.position.distanceTo(t);
      const factor = Math.exp((-ev.deltaY) * 0.001);
      const next = curRadius / factor; // smaller radius = zoom in
      anchoredZoomTo(next, midX, midY);
    };
    const onPointerDown = (ev)=>{
      touches.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      el.setPointerCapture?.(ev.pointerId);
      if(touches.current.size===2){
        const vals = Array.from(touches.current.values());
        const a = vals[0], b = vals[1];
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        pinch.current.active = true;
        pinch.current.startDist = dist;
        pinch.current.startRadius = camera.position.distanceTo(targetRef.current);
        pinch.current.lastMid = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
        if(activityRef && activityRef.current) activityRef.current.moving = true;
      }
    };
    const onPointerMove = (ev)=>{
      if(!touches.current.has(ev.pointerId)) return;
      touches.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if(pinch.current.active && touches.current.size>=2){
        const vals = Array.from(touches.current.values());
        const a = vals[0], b = vals[1];
        const mid = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const scale = dist / (pinch.current.startDist || 1);
        const nextRadius = THREE.MathUtils.clamp(pinch.current.startRadius / scale, minDistance, maxDistance);
        // Keep anchor stable while zooming
        anchoredZoomTo(nextRadius, mid.x, mid.y);
        // Also apply pan based on midpoint movement mapped on plane
        const prevMid = pinch.current.lastMid;
        const before = screenToWorldOnPlane(prevMid.x, prevMid.y);
        const after = screenToWorldOnPlane(mid.x, mid.y);
        if(before && after){
          const dx = before.x - after.x; const dz = before.z - after.z;
          targetRef.current.add(tmpVec.current.set(dx,0,dz));
          camera.position.add(tmpVec.current);
          camera.lookAt(targetRef.current);
        }
        pinch.current.lastMid = mid;
        try{ invalidate(); }catch{}
      }
    };
    const onPointerUp = (ev)=>{
      touches.current.delete(ev.pointerId);
      if(touches.current.size<2 && pinch.current.active){
        pinch.current.active = false;
        if(activityRef && activityRef.current) activityRef.current.moving = false;
      }
    };
    el.addEventListener('wheel', onWheel, { passive:false });
    el.addEventListener('pointerdown', onPointerDown, { passive:false });
    el.addEventListener('pointermove', onPointerMove, { passive:false });
    el.addEventListener('pointerup', onPointerUp, { passive:true });
    el.addEventListener('pointercancel', onPointerUp, { passive:true });
    el.addEventListener('pointerleave', onPointerUp, { passive:true });
    return ()=>{
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('pointerleave', onPointerUp);
    };
  }, [enabled, gl, camera, anchoredZoomTo, getCanvasRect, invalidate, activityRef, minDistance, maxDistance]);

  useEffect(()=>{ if(!enabled) return; try{ invalidate(); }catch{} }, [enabled, invalidate]);
  return null;
}

// Drive continuous renders while moving in demand mode
function RenderWhileMoving({ activityRef, controlsMovingRef }){
  const { invalidate } = useThree();
  const wasMoving = useRef(false);
  useFrame(()=>{
    const moving = !!(activityRef?.current?.moving || controlsMovingRef?.current);
    if(moving){
      wasMoving.current = true;
      invalidate(); // keep frames flowing during motion
    } else if(wasMoving.current){
      invalidate(); // present one final frame after motion stops
      wasMoving.current = false;
    }
  }, 1);
  return null;
}

// Ensure initial frames render in demand mode on mobile
function InitialRenderPokes(){
  const { invalidate, size } = useThree();
  useEffect(()=>{
    let i = 0;
    const id = setInterval(()=>{ invalidate(); if(++i>6) clearInterval(id); }, 60);
    return ()=> clearInterval(id);
  },[invalidate]);
  useEffect(()=>{ try{ invalidate(); }catch{} }, [size.width, size.height, invalidate]);
  return null;
}

/* ====== Chess logic (simplified, no check enforcement) ====== */
const SIZE=8;
const EMPTY=null;
// Represent pieces as { c: 'w'|'b', t: 'p','r','n','b','q','k' }
const setupChess=()=>{
  const b=Array.from({length:8},()=>Array(8).fill(EMPTY));
  const back=['r','n','b','q','k','b','n','r'];
  for(let c=0;c<8;c++){ b[0][c]={c:'b',t:back[c]}; b[1][c]={c:'b',t:'p'}; b[6][c]={c:'w',t:'p'}; b[7][c]={c:'w',t:back[c]}; }
  return b;
};
function inBounds(r,c){return r>=0&&r<8&&c>=0&&c<8;}
function genMoves(board,r,c){
  const pc=board[r][c]; if(!pc) return [];
    const moves = [];
  const add=(rr,cc)=>{
    if(!inBounds(rr,cc)) return false;
    const dst=board[rr][cc];
    if(!dst){ moves.push({r2:rr,c2:cc}); return true; }
    if(dst.c!==pc.c){ moves.push({r2:rr,c2:cc}); return false; }
    return false;
  };
  const ray=(dr,dc)=>{ let rr=r+dr,cc=c+dc; while(inBounds(rr,cc)){ const cont=add(rr,cc); if(!cont) break; rr+=dr; cc+=dc; } };
  switch(pc.t){
    case 'p':{
      const dir=pc.c==='w'?-1:1; // pawns forward
      const startRow=pc.c==='w'?6:1;
      if(inBounds(r+dir,c) && !board[r+dir][c]) moves.push({r2:r+dir,c2:c});
      if(r===startRow && !board[r+dir][c] && !board[r+2*dir]?.[c]) moves.push({r2:r+2*dir,c2:c});
      for(const dc of [-1,1]){ const rr=r+dir, cc=c+dc; if(inBounds(rr,cc)&&board[rr][cc]&&board[rr][cc].c!==pc.c) moves.push({r2:rr,c2:cc}); }
      break;
    }
    case 'n':{
      const d=[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
      for(const [dr,dc] of d){ const rr=r+dr,cc=c+dc; if(!inBounds(rr,cc)) continue; const dst=board[rr][cc]; if(!dst||dst.c!==pc.c) moves.push({r2:rr,c2:cc}); }
      break;
    }
    case 'b': ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); break;
    case 'r': ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); break;
    case 'q': ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); ray(1,1); ray(1,-1); ray(-1,1); ray(-1,-1); break;
    case 'k':{
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){
        if(!dr&&!dc) continue; const rr=r+dr,cc=c+dc; if(!inBounds(rr,cc)) continue;
        const dst=board[rr][cc]; if(!dst||dst.c!==pc.c) moves.push({r2:rr,c2:cc});
      }
      break;
    }
    default: break;
  }
  return moves;
}

// --- Chess helpers: check detection, legal moves, recommendation ---
function cloneBoard(board){ return board.map(row=>row.slice()); }
function pieceValue(t){ switch(t){ case 'p': return 1; case 'n': case 'b': return 3; case 'r': return 5; case 'q': return 9; default: return 0; } }
function findKing(board, color){ for(let r=0;r<8;r++){ for(let c=0;c<8;c++){ const p=board[r][c]; if(p && p.c===color && p.t==='k') return {r,c}; } } return null; }
function applyMoveBoard(board, from, to){
  const b = cloneBoard(board);
  const src = b[from.r][from.c]; if(!src) return b;
  const dst = b[to.r2][to.c2];
  let moved = { ...src };
  if(moved.t==='p'){
    const reachEnd = (moved.c==='w' && to.r2===0) || (moved.c==='b' && to.r2===7);
    if(reachEnd){ moved = { c: moved.c, t: (to.promotion||'q') }; }
  }
  b[from.r][from.c] = EMPTY;
  b[to.r2][to.c2] = moved;
  return b;
}
function inCheck(board, color){
  const k = findKing(board, color); if(!k) return false;
  const opp = color==='w'?'b':'w';
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const pc = board[r][c]; if(!pc || pc.c!==opp) continue;
      // Special-case pawn attacks: only diagonals forward
      if(pc.t==='p'){
        const dir = opp==='w'?-1:1;
        for(const dc of [-1,1]){
          const rr=r+dir, cc=c+dc; if(rr===k.r && cc===k.c) return true;
        }
        continue;
      }
      const mvs = genMoves(board, r, c);
      if(mvs.some(m => m.r2===k.r && m.c2===k.c)) return true;
    }
  }
  return false;
}
function legalMovesFor(board, color){
  const out=[];
  for(let r=0;r<8;r++){
    for(let c=0;c<8;c++){
      const pc=board[r][c]; if(!pc || pc.c!==color) continue;
      const mvs = genMoves(board, r, c);
      for(const m of mvs){
        const next = applyMoveBoard(board, {r,c}, m);
        if(!inCheck(next, color)) out.push({ from:{r,c}, to:m });
      }
    }
  }
  return out;
}
function materialEval(board, forColor){
  let w=0,b=0; for(let r=0;r<8;r++){ for(let c=0;c<8;c++){ const p=board[r][c]; if(!p) continue; if(p.c==='w') w+=pieceValue(p.t); else b+=pieceValue(p.t); } }
  const my = forColor==='w'?w:b; const opp = forColor==='w'?b:w; return my-opp;
}
function recommendMove(board, color){
  const legals = legalMovesFor(board, color);
  if(legals.length===0) return null;
  let best = null; let bestScore = -1e9;
  const opp = color==='w'?'b':'w';
  for(const mv of legals){
    const next = applyMoveBoard(board, mv.from, mv.to);
    let score = materialEval(next, color);
    // Bonus if giving check
    if(inCheck(next, opp)) score += 0.35;
    // Small center preference
    const dr = Math.abs(3.5 - mv.to.r2), dc = Math.abs(3.5 - mv.to.c2);
    score += 0.05 * (4 - (dr+dc));
    if(score>bestScore){ bestScore=score; best={ ...mv, score } }
  }
  return best;
}
function toAlg(r,c){ return String.fromCharCode('a'.charCodeAt(0)+c) + String(8-r); }

/* ====== 3D Pieces (simple shapes as placeholders) ====== */
function Lights(){
  const rotY = 0;
  let isMobile = false;
  try { isMobile = (typeof window !== 'undefined') && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches); } catch {}
  return (
    <group position={[3.5,0,3.5]} rotation={[0, rotY, 0]}>
      <group position={[-3.5,0,-3.5]}>
        {isMobile ? (
          <>
            <hemisphereLight intensity={0.5} groundColor={"#1b1b1b"} />
            <ambientLight intensity={0.25} />
            <directionalLight position={[6,10,6]} intensity={0.6} />
          </>
        ) : (
          <>
            <hemisphereLight intensity={0.22} groundColor={"#1b1b1b"} />
            <ambientLight intensity={0.14} />
            <directionalLight
              position={[6,10,6]}
              intensity={0.7}
              castShadow
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
              shadow-bias={-0.0008}
            />
            <spotLight
              position={[3.5, 12.5, 3.5]}
              angle={1.0}
              penumbra={0.8}
              intensity={1.5}
              castShadow
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
              shadow-bias={-0.0006}
            />
            <pointLight position={[3.5,8.0,3.5]} intensity={0.8} distance={40} decay={2} />
          </>
        )}
      </group>
    </group>
  );
}

function SmartOrbitControls(props){
  const { invalidate } = useThree();
  const { onStart, onEnd, onChange, ...rest } = props || {};
  return (
    <OrbitControls
      {...rest}
      onStart={(e)=>{ try{ onStart && onStart(e); }finally{ invalidate(); } }}
      onEnd={(e)=>{ try{ onEnd && onEnd(e); }finally{ invalidate(); } }}
      onChange={(e)=>{ try{ onChange && onChange(e); }finally{ invalidate(); } }}
    />
  );
}

const AnimatedPiece = React.memo(function AnimatedPiece({ to=[0,0,0], from, children, speed=8, lift=0.14, onClick, activityRef }){
  const ref = useRef();
  const { invalidate } = useThree();
  const isMobile = useMemo(()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} },[]);
  const prevFrom = useRef([NaN,NaN,NaN]);
  const prevTo = useRef([NaN,NaN,NaN]);
  const startRef = useRef([0,0,0]);
  const endRef = useRef([0,0,0]);
  const totalXZRef = useRef(0.000001);
  const target = to;
  const nearlyEq = (a,b,eps=1e-4)=> Math.abs(a[0]-b[0])<eps && Math.abs(a[1]-b[1])<eps && Math.abs(a[2]-b[2])<eps;
  const distXZ = (a,b)=>{ const dx=(a[0]-b[0]); const dz=(a[2]-b[2]); return Math.sqrt(dx*dx+dz*dz); };
  useEffect(()=>{
    const f = from;
    const t = to;
    const fromChanged = f && !nearlyEq(prevFrom.current, f);
    const toChanged = !nearlyEq(prevTo.current, t);
    if(ref.current && (fromChanged || toChanged)){
      if(activityRef && activityRef.current) activityRef.current.moving = true;
      if(f){ ref.current.position.set(f[0], f[1], f[2]); }
      // Set start/end for progress tracking (XZ distance based)
      const start = f ? [f[0], f[1], f[2]] : [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      const end = [t[0], t[1], t[2]];
      startRef.current = start; endRef.current = end;
      totalXZRef.current = Math.max(0.000001, distXZ(start, end));
      // if no explicit from, keep current position and just lerp toward new target
      prevFrom.current = f ? [...f] : [...prevFrom.current];
      prevTo.current = [...t];
    }
  }, [from, to]);
  useFrame((_, dt)=>{
    if(!ref.current) return;
    const p = ref.current.position;
    const smooth = Math.max(1, Number(speed)||8); // higher = snappier
    p.x = THREE.MathUtils.damp(p.x, target[0], smooth, dt);
    p.z = THREE.MathUtils.damp(p.z, target[2], smooth, dt);
    // Compute progress along path (based on XZ), then lift arc
    const start = startRef.current, end = endRef.current;
    const total = totalXZRef.current;
    const remain = distXZ([p.x, 0, p.z], end);
    const progLin = THREE.MathUtils.clamp(1 - (remain/total), 0, 1);
    const prog = progLin*progLin*(3-2*progLin); // smoothstep easing
  const yBase = THREE.MathUtils.lerp(start[1], end[1], prog);
  const bump = lift > 0 ? (lift * 4 * prog * (1 - prog)) : 0; // eased parabola
    p.y = yBase + bump;
    const eps = 1e-3;
    const rx = target[0]-p.x, ry = target[1]-p.y, rz = target[2]-p.z;
    if (Math.abs(rx) < eps && Math.abs(ry) < eps && Math.abs(rz) < eps) {
      p.set(target[0], target[1], target[2]);
      if(activityRef && activityRef.current) activityRef.current.moving = false;
    }
    if(isMobile) invalidate();
  });
  return <group ref={ref} frustumCulled={false} raycast={() => null}>{children}</group>;
});

function Piece3D({ pc, tint, selected, glow=70, pauseRef, disableGlow=false }){
  const color = tint || '#ffffff';
  const metal = { metalness: 0.25, roughness: 0.5, emissive: color, emissiveIntensity: 0.06 };
  const rootRef = useRef();
  const isMobile = useMemo(()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} },[]);
  useFrame(({ clock })=>{
    if (disableGlow) return;
    const t = clock.getElapsedTime();
    const f = THREE.MathUtils.clamp(Number(glow)||0, 0, 100) / 100;
    const base = 0.02 + 0.08 * f;
    const amp = 0.00 + 0.06 * f;
    const e = base + amp * Math.sin(t/2.8);
    const g = rootRef.current; if(!g) return; g.traverse(o=>{ const m=o.material; if(m && 'emissiveIntensity' in m) m.emissiveIntensity = e; });
  });
  let piece = null;
  switch(pc.t){
    case 'p': piece = (
      <group>
        <mesh castShadow receiveShadow position={[0,0.2,0]}>
          <cylinderGeometry args={[0.35,0.45,0.2,32]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,0.5,0]}>
          <cylinderGeometry args={[0.22,0.28,0.5,24]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,0.9,0]}>
          <sphereGeometry args={[0.18, 20, 20]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        {selected&&<mesh position={[0,0.26,0]}><torusGeometry args={[0.32,0.04,16,48]} /><meshStandardMaterial color={'#f59e0b'} emissive={'#f59e0b'} emissiveIntensity={0.6}/></mesh>}
      </group>
    ); break;
    case 'r': piece = (
      <group>
        <mesh castShadow receiveShadow position={[0,0.2,0]}>
          <cylinderGeometry args={[0.38,0.5,0.25,32]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,0.6,0]}>
          <cylinderGeometry args={[0.34,0.34,0.7,24]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,1.0,0]}>
          <cylinderGeometry args={[0.42,0.32,0.2,24]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        {selected&&<mesh position={[0,0.34,0]}><torusGeometry args={[0.36,0.05,16,48]} /><meshStandardMaterial color={'#f59e0b'} emissive={'#f59e0b'} emissiveIntensity={0.6}/></mesh>}
      </group>
    ); break;
    case 'n': piece = (
      <group>
        <mesh castShadow receiveShadow position={[0,0.25,0]}>
          <cylinderGeometry args={[0.38,0.5,0.25,32]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,0.75,0]} rotation={[0,Math.PI/8,0]}>
          <boxGeometry args={[0.5,0.9,0.3]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        {selected&&<mesh position={[0,0.34,0]}><torusGeometry args={[0.36,0.05,16,48]} /><meshStandardMaterial color={'#f59e0b'} emissive={'#f59e0b'} emissiveIntensity={0.6}/></mesh>}
      </group>
    ); break;
    case 'b': piece = (
      <group>
        <mesh castShadow receiveShadow position={[0,0.2,0]}>
          <cylinderGeometry args={[0.36,0.48,0.22,32]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,0.7,0]}>
          <coneGeometry args={[0.3,0.9,24]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,1.2,0]}>
          <sphereGeometry args={[0.16, 20, 20]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        {selected&&<mesh position={[0,0.42,0]}><torusGeometry args={[0.28,0.05,16,48]} /><meshStandardMaterial color={'#f59e0b'} emissive={'#f59e0b'} emissiveIntensity={0.6}/></mesh>}
      </group>
    ); break;
    case 'q': piece = (
      <group>
        <mesh castShadow receiveShadow position={[0,0.25,0]}>
          <cylinderGeometry args={[0.42,0.52,0.25,32]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,0.9,0]}>
          <cylinderGeometry args={[0.28,0.36,1.0,32]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,1.5,0]}>
          <torusGeometry args={[0.28,0.05,16,48]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,1.68,0]}>
          <sphereGeometry args={[0.18, 20, 20]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        {selected&&<mesh position={[0,0.52,0]}><torusGeometry args={[0.35,0.05,16,48]} /><meshStandardMaterial color={'#f59e0b'} emissive={'#f59e0b'} emissiveIntensity={0.6}/></mesh>}
      </group>
    ); break;
    case 'k': piece = (
      <group>
        <mesh castShadow receiveShadow position={[0,0.25,0]}>
          <cylinderGeometry args={[0.44,0.54,0.28,32]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,1.0,0]}>
          <cylinderGeometry args={[0.3,0.38,1.2,32]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,1.7,0]}>
          <boxGeometry args={[0.06,0.3,0.06]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        <mesh castShadow receiveShadow position={[0,1.7,0]} rotation={[0,0,Math.PI/2]}>
          <boxGeometry args={[0.06,0.3,0.06]} />
          <meshStandardMaterial color={color} {...metal}/>
        </mesh>
        {selected&&<mesh position={[0,0.58,0]}><torusGeometry args={[0.38,0.05,16,48]} /><meshStandardMaterial color={'#f59e0b'} emissive={'#f59e0b'} emissiveIntensity={0.6}/></mesh>}
      </group>
    ); break;
    default: piece = null;
  }
  const procScale = PROC_PIECE_SCALE * (isMobile ? 0.85 : 1.0);
  return <group ref={rootRef} frustumCulled={false} scale={[procScale, procScale, procScale]}>{piece}</group>;
}

function ChessGLTFModel({ url, color, rotateY=0, glow=70, pauseRef, disableGlow=false }){
  const gltf = useGLTF(url);
  const { invalidate } = useThree();
  const matsRef = useRef([]);
  const mobileScale = useMemo(()=>{ try{ return (typeof window!== 'undefined') && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches) ? 0.85 : 1.0; }catch{return 1.0;} },[]);
  const scene = useMemo(()=>{
    matsRef.current = [];
    const clone = gltf.scene.clone(true);
    const col = new THREE.Color(color);
    clone.traverse((o)=>{
      if(o.isMesh){
        o.castShadow = true; o.receiveShadow = true;
        o.frustumCulled = false;
        if(o.geometry){
          try{ if(!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); }catch{}
          try{ if(!o.geometry.boundingBox) o.geometry.computeBoundingBox(); }catch{}
        }
        if(o.material){
          o.material = o.material.clone();
          if('color' in o.material) o.material.color = col; else o.material.color = col;
          if('metalness' in o.material) o.material.metalness = 0.2;
          if('roughness' in o.material) o.material.roughness = 0.55;
          if('emissive' in o.material) o.material.emissive = col;
          if('emissiveIntensity' in o.material) o.material.emissiveIntensity = 0.06;
          if('side' in o.material) o.material.side = THREE.FrontSide;
          matsRef.current.push(o.material);
        }
      }
    });
  // Apply orientation before measuring/centering
  if(rotateY) clone.rotation.y = rotateY;
    // Measure original size
    clone.updateMatrixWorld(true);
    const box0 = new THREE.Box3().setFromObject(clone);
    const size0 = new THREE.Vector3(); box0.getSize(size0);
    // Compute scale to fit tile
    const footprint = Math.max(size0.x, size0.z) || 1;
    const sf = CHESS_GLB_FOOTPRINT / footprint;
    const sh = size0.y > 0 ? (CHESS_GLB_HEIGHT / size0.y) : 1;
  const s = Math.min(sf, sh) * CHESS_GLB_GLOBAL_SCALE * CHESS_MODEL_SCALE * mobileScale;
    // First, center and ground before scaling
    const center0 = new THREE.Vector3(); box0.getCenter(center0);
    const minY0 = box0.min.y;
    clone.position.set(-center0.x, -minY0, -center0.z);
    clone.updateMatrixWorld(true);
    // Apply scale directly to the clone
    clone.scale.multiplyScalar(s);
    clone.updateMatrixWorld(true);
    // Final precise recenter after scaling (use base slice to center X/Z by footprint)
    const box1 = new THREE.Box3().setFromObject(clone);
    const size1 = new THREE.Vector3(); box1.getSize(size1);
    const baseMinY = box1.min.y;
  const sliceH = Math.max(0.0001, 0.01 * size1.y);
    let bxMin=Infinity, bxMax=-Infinity, bzMin=Infinity, bzMax=-Infinity, seen=0;
    clone.updateMatrixWorld(true);
    clone.traverse((o)=>{
      if(!o.isMesh || !o.geometry || !o.geometry.attributes?.position) return;
      const pos=o.geometry.attributes.position; const v=new THREE.Vector3();
      for(let i=0;i<pos.count;i++){
        v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
        if(v.y<=baseMinY+sliceH){
          if(v.x<bxMin) bxMin=v.x; if(v.x>bxMax) bxMax=v.x; if(v.z<bzMin) bzMin=v.z; if(v.z>bzMax) bzMax=v.z; seen++;
        }
      }
    });
    if(seen>0 && isFinite(bxMin) && isFinite(bxMax) && isFinite(bzMin) && isFinite(bzMax)){
      const cx=(bxMin+bxMax)/2; const cz=(bzMin+bzMax)/2;
      // also ground to baseMinY
      clone.position.x -= cx;
      clone.position.y -= baseMinY;
      clone.position.z -= cz;
      clone.updateMatrixWorld(true);
    } else {
      // fallback to bbox center
      const center1 = new THREE.Vector3(); box1.getCenter(center1);
      clone.position.x -= center1.x; clone.position.y -= baseMinY; clone.position.z -= center1.z; clone.updateMatrixWorld(true);
    }
    return clone;
  }, [gltf, color, rotateY, mobileScale]);
  // In demand mode, ensure we render after model is ready
  useEffect(()=>{ try{ invalidate(); }catch{} }, [scene, invalidate]);
  useFrame(({ clock })=>{
    if (disableGlow) return;
    const t = clock.getElapsedTime();
    const f = THREE.MathUtils.clamp(Number(glow)||0, 0, 100) / 100;
    const base = 0.02 + 0.08 * f;
    const amp = 0.00 + 0.06 * f;
    const e = base + amp * Math.sin(t/2.6);
    for(const m of matsRef.current){ if(m && 'emissiveIntensity' in m) m.emissiveIntensity = e; }
  });
  return <group frustumCulled={false}><primitive object={scene} /></group>;
}

class ModelErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={ hasError:false }; }
  static getDerivedStateFromError(){ return { hasError:true }; }
  componentDidCatch(err){ if(process.env.NODE_ENV!=='production'){ console.warn(`Model load failed: ${this.props.label||''}`, err); } }
  render(){ return this.state.hasError ? this.props.fallback : this.props.children; }
}

function ChessModel({ name, color, rotateY=0, glow=70, pauseRef, disableGlow=false }){
  // Prefer low_poly models on mobile for performance
  const isMobile = (()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} })();
  const lowUrl = `/models/chess/low_poly_${name}.glb`;
  const stdUrl = `/models/chess/${name}.glb`;
  const [url,setUrl] = React.useState(isMobile ? lowUrl : stdUrl);
  React.useEffect(()=>{
    let alive=true;
    if(isMobile){
      // Verify low-poly exists; fallback to standard if missing
      (async()=>{ try{ const r=await fetch(lowUrl,{method:'HEAD'}); if(!alive) return; setUrl(r.ok?lowUrl:stdUrl); }catch{ if(alive) setUrl(stdUrl); } })();
    } else { setUrl(stdUrl); }
    return ()=>{ alive=false; };
  },[isMobile, lowUrl, stdUrl]);
  return <ChessGLTFModel url={url} color={color} rotateY={rotateY} glow={glow} pauseRef={pauseRef} disableGlow={disableGlow} />;
}

function useAssetAvailable(url, options = {}){
  const skip = !!options.skip;
  const [ok, setOk] = useState(skip ? true : false);
  useEffect(()=>{
    let alive = true;
    if (skip) { setOk(true); return ()=>{}; }
    (async()=>{
      try{
        const r = await fetch(url, { method:'HEAD' });
        if(!alive) return;
        const ct = (r.headers.get('content-type')||'').toLowerCase();
        const looksModel = r.ok && (ct.includes('model') || ct.includes('octet-stream') || ct.includes('gltf'));
        setOk(looksModel);
      }catch{
        if(alive) setOk(false);
      }
    })();
    return ()=>{ alive = false; };
  }, [url, skip]);
  return ok;
}

function MaybeChessPiece({ pc, isSel, tint, glow=70, pauseRef, disableGlow=false }){
  const modelName = pc.t==='p'?'pawn': pc.t==='r'?'rook': pc.t==='n'?'knight': pc.t==='b'?'bishop': pc.t==='q'?'queen':'king';
  const fallback = <Piece3D pc={pc} tint={tint} selected={isSel} glow={glow} pauseRef={pauseRef} disableGlow={disableGlow} />;
  if(!modelsEnabled()) return fallback;
  const needsFlip = pc.c==='b';
  const isMobile = (()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} })();
  const extraYaw = (isMobile && pc.t==='n') ? (-Math.PI/2) : 0; // rotate knights 90° CW on mobile
  return (
    <ModelErrorBoundary fallback={fallback} label={`chess/${modelName}.glb`}>
      <Suspense fallback={fallback}>
        <ChessModel name={modelName} color={tint} rotateY={(needsFlip?Math.PI:0)+extraYaw} glow={glow} pauseRef={pauseRef} disableGlow={disableGlow} />
      </Suspense>
    </ModelErrorBoundary>
  );
}

function Board3D({ board, myColor, lastMove, onCellClick, selected, moves, pieceColors, shadowStrength=65, pieceGlow=60, hint=null, checkKing=null }){
  const tile=1;
  const pieceY = modelsEnabled() ? 0.0 : 0.08;
  // Original preset offsets
  const backOffset = 0.60;
  const ROW_Y = { 7: -0.36, 6: -0.26 };
  const ROW_Z = { 7: 0.0, 6: -0.14 };
  const TYPE_ADJ = { k:{y:0.22,z:-0.19}, q:{y:0.10,z:-0.12}, b:{y:1.96,z:-0.56}, n:{y:1.77,z:-0.60} };
  const START_PAWN_FORWARD = 0.08; // small forward nudge on starting rank only

  const spawnedRef = useRef(new Set());

  const isMobileDevice = useMemo(()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} },[]);
  const centerModelsMobile = isMobileDevice; // center models on mobile to avoid spread/misalignment
  const posFor = useCallback((pc, r, c) => {
    const x = c * tile;
    const z = r * tile;
    if (centerModelsMobile) {
      // Mobile: place GLB models centered on tiles without stylistic Z offsets
      const y = pieceY + 0.02;
      return [x, y, z];
    }
    const baseRowY = pc.t === 'p' ? Number(ROW_Y[6]||0) : Number(ROW_Y[7]||0);
    const tAdj = TYPE_ADJ[pc.t] || { y: 0, z: 0 };
    const y = pieceY + baseRowY + Number(tAdj.y||0);
    const side = pc.c === 'w' ? 1 : -1;
    let zAdj = side * backOffset;
    let zRowAdd = 0;
    if (pc.t === 'p') {
      zRowAdd = side * Number(ROW_Z[6] || 0);
      const isStart = (pc.c==='w' && r===6) || (pc.c==='b' && r===1);
      if (isStart) zRowAdd += -side * START_PAWN_FORWARD;
    } else {
      const hasZ = Object.prototype.hasOwnProperty.bind(ROW_Z);
      const rMirror = 7 - r;
      if (hasZ(r)) zRowAdd = Number(ROW_Z[r]||0);
      else if (hasZ(rMirror)) zRowAdd = -Number(ROW_Z[rMirror]||0);
    }
    zAdj += zRowAdd + side * Number(tAdj.z||0);
    return [x, y, z + zAdj];
  }, [tile, pieceY, backOffset, centerModelsMobile]);

  const NEON_BG_OUTER = '#030712';
  const NEON_BG_INNER = '#0b0f1a';
  const NEON_TILE_LIGHT = '#22d3ee';
  const NEON_TILE_DARK  = '#8b5cf6';

  // Derive dimmed pulse palette from players' chosen piece colors
  const pulsePalette = useMemo(()=>{
    try{
      // Swap: treat White as having Black's color and vice versa
      const wHex = pieceColors?.b || null;
      const bHex = pieceColors?.w || null;
      const fallback1 = '#22d3ee';
      const fallback2 = '#a78bfa';
      const toward = new THREE.Color('#05060a');
      const dim = (hex)=>{
        try{ const c=new THREE.Color(hex); return c.lerp(toward, 0.55).getStyle(); }catch{ return null; }
      };
      const cWhite = dim(wHex) || fallback1;
      const cBlack = dim(bHex) || fallback2;
      // Viewer perspective: your side color vs opponent color
      const you = myColor === 'b' ? cBlack : cWhite;
      const opp = myColor === 'b' ? cWhite : cBlack;
      // For you: light tiles use your color, dark tiles use opponent.
      // For the opponent (when they view), this mapping is naturally opposite by their myColor.
      return {
        c1: you,
        c2: opp,
        sweepLight: you,
        sweepDark:  opp
      };
    }catch{ return { c1:'#22d3ee', c2:'#a78bfa', sweepLight:'#22d3ee', sweepDark:'#8b5cf6' }; }
  }, [pieceColors, myColor]);

  // Radar sweep highlighting: tiles you can move to glow in your color as the sweep passes
  function readRadarEnabled(){
    try{
      const qs = new URLSearchParams(window.location.search);
      const q = (qs.get('radar')||'').toLowerCase();
      if(q==='0'||q==='off'||q==='false') return false;
      if(q==='1'||q==='on'||q==='true') return true;
      const ls = (localStorage.getItem('radarSweep')||'').toLowerCase();
      if(ls==='0'||ls==='off'||ls==='false') return false;
      if(ls==='1'||ls==='on'||ls==='true') return true;
      return true; // default on
    }catch{ return true; }
  }
  const RADAR_ON = useMemo(()=> readRadarEnabled(), []);
  // Precompute reachable target squares for both sides
  const radarReach = useMemo(()=>{
    if(!RADAR_ON) return null;
    try{
      const setW = new Set();
      const setB = new Set();
      const add = (s, r, c)=> s.add(`${r}-${c}`);
      const mW = legalMovesFor(board, 'w');
      const mB = legalMovesFor(board, 'b');
      for(const mv of (mW||[])) add(setW, mv.to.r2, mv.to.c2);
      for(const mv of (mB||[])) add(setB, mv.to.r2, mv.to.c2);
      return { w: setW, b: setB };
    }catch{ return null; }
  }, [board, RADAR_ON]);

  // Cursor-follow glow state (in tile coordinates)
  const tilesGroupRef = useRef();
  const cursorRef = useRef({ x: null, z: null, active: false });
  const pauseRef = { current: false }; // deprecated, kept for prop shape
  const handlePointerLeave = useCallback(()=>{ cursorRef.current.active = false; },[]);

  // Ultra-light pointer tracking using plane intersection (no scene raycast)
  const PointerTracker = () => {
    const { gl, camera, size } = useThree();
    const rcRef = useRef(null);
    const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0,1,0), 0));
    useEffect(()=>{
      const el = gl.domElement; if(!el) return;
      if(!rcRef.current) rcRef.current = new THREE.Raycaster();
      const onMove = (ev) => {
        const rect = el.getBoundingClientRect();
        const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
        const ray = rcRef.current; ray.setFromCamera({ x: nx, y: ny }, camera);
        const pt = new THREE.Vector3();
        if(ray.ray.intersectPlane(planeRef.current, pt)){
          const g = tilesGroupRef.current; if(!g) return;
          const lp = g.worldToLocal(pt.clone());
          cursorRef.current.x = THREE.MathUtils.clamp(lp.x, 0, SIZE-1);
          cursorRef.current.z = THREE.MathUtils.clamp(lp.z, 0, SIZE-1);
          cursorRef.current.active = true;
        }
      };
      const onLeave = () => { cursorRef.current.active = false; };
      el.addEventListener('pointermove', onMove, { passive: true });
      el.addEventListener('pointerleave', onLeave, { passive: true });
      return ()=>{
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
      };
    }, [gl, camera, size]);
    return null;
  };

  // Activity flag to prioritize piece motion
  const activityRef = useRef({ moving: false });

  function StripLED({ x, z, w, d, kind, stripMat, haloMat }){
    return (
      <group position={[x, 0.012, z]}>
        <mesh material={stripMat}>
          <boxGeometry args={[w, 0.012, d]} />
        </mesh>
        <mesh renderOrder={-1} material={haloMat}>
          <boxGeometry args={[kind==='H'? w*1.04 : w*1.5, 0.004, kind==='H'? d*1.5 : d*1.04]} />
        </mesh>
      </group>
    );
  }

  const GridLEDs = ({ animated=true, pulseSlow=false, c1= pulsePalette.c1, c2= pulsePalette.c2 }) => {
  const strips = [];
  const mobile = (()=>{ try{ return typeof window!=='undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches); }catch{return false;} })();
  const th = mobile ? 0.08 : 0.06; // slightly thicker on phones to reduce shimmer
    for(let re=0; re<=SIZE; re++){
      for(let c=0; c<SIZE; c++){
        strips.push({ kind:'H', x: c, z: re-0.5, w:1, d: th, key:`H-${re}-${c}` });
      }
    }
    for(let ce=0; ce<=SIZE; ce++){
      for(let r=0; r<SIZE; r++){
        strips.push({ kind:'V', x: ce-0.5, z: r, w: th, d: 1, key:`V-${ce}-${r}` });
      }
    }
    const stripMat = React.useMemo(()=>{
      const m = new THREE.MeshStandardMaterial({ color:(c1||'#22d3ee'), emissive:(c1||'#22d3ee'), emissiveIntensity:0.8 });
      return m;
    },[c1]);
    const haloMat = React.useMemo(()=>{
      const m = new THREE.MeshBasicMaterial({ color:(c1||'#22d3ee'), transparent:true, opacity:0.42, blending:THREE.AdditiveBlending, depthWrite:false });
      return m;
    },[c1]);
    function StripLEDController(){
      const lastRef = useRef(0);
      const periodRef = useRef(10);
      const c1Ref = useRef(new THREE.Color(c1||'#22d3ee'));
      const c2Ref = useRef(new THREE.Color(c2||'#a78bfa'));
      const blendRef = useRef(new THREE.Color('#22d3ee'));
      useEffect(()=>{ try{ c1Ref.current.set(c1||'#22d3ee'); }catch{} },[c1]);
      useEffect(()=>{ try{ c2Ref.current.set(c2||'#a78bfa'); }catch{} },[c2]);
      useEffect(()=>{ periodRef.current = readGlobalLedPeriodSec(); },[]);
      useFrame((st)=>{
        const t = st.clock.getElapsedTime();
        const budget = pulseSlow ? 1/12 : 1/28; // low-FPS but smooth on mobile
        if (t - lastRef.current < budget) return;
        lastRef.current = t;
        const baseT = Math.max(0.001, periodRef.current);
        const T = pulseSlow ? Math.max(6, baseT * 1.8) : (baseT * 1.2);
        const wv = (2*Math.PI)/T;
        const blendT = 0.5 + 0.5*Math.sin(wv*t);
        blendRef.current.copy(c1Ref.current).lerp(c2Ref.current, blendT);
  const base = pulseSlow ? 0.22 : 0.24;
  const amp = pulseSlow ? 0.28 : 0.42;
        const s = Math.sin(wv*t*0.8);
        const e = base + amp * (0.5 + 0.5*s);
        // apply to shared materials once
  if (stripMat) { stripMat.color.copy(blendRef.current); stripMat.emissive.copy(blendRef.current); stripMat.emissiveIntensity = e; stripMat.needsUpdate = true; }
  if (haloMat) { haloMat.color.copy(blendRef.current); haloMat.opacity = (pulseSlow ? 0.28 : 0.34) + (pulseSlow ? 0.22 : 0.36)*(0.5 + 0.5*s); haloMat.needsUpdate = true; }
      });
      return null;
    }
    return (
      <group raycast={() => null}>
        {animated && <StripLEDController />}
        {strips.map(s=> (
          <StripLED key={s.key} x={s.x} z={s.z} w={s.w} d={s.d} kind={s.kind} stripMat={stripMat} haloMat={haloMat} />
        ))}
      </group>
    );
  };

  // Lightweight, global sweep controller state (updated inside Canvas)
  // Speed unified with CSS var --global-led-speed (period T)
  const sweepRef = useRef({ angle: 0, head: -2, dir: [1,0], speed: 0.75, sigma: 0.75, amp: 0.18, min:-2, max: SIZE*2 });
  const globalLedPeriodRef = useRef(10); // seconds
  function readGlobalLedPeriodSec(){
    try {
      const root = document.documentElement;
      const val = getComputedStyle(root).getPropertyValue('--global-led-speed').trim();
      if (!val) return 10;
      if (val.endsWith('ms')) return Math.max(0.001, parseFloat(val) / 1000);
      if (val.endsWith('s')) return Math.max(0.001, parseFloat(val));
      const n = parseFloat(val); return isFinite(n) && n > 0 ? n : 10;
    } catch { return 10; }
  }
  function setSweepAngle(ang){
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const s = sweepRef.current;
    s.angle = ang; s.dir = [dx,dz];
    // Compute projection span using true min/max of the board's four corners
    // Corners (in tile units): (0,0), (SIZE,0), (0,SIZE), (SIZE,SIZE)
    const p00 = 0*dx + 0*dz;
    const p10 = SIZE*dx + 0*dz;
    const p01 = 0*dx + SIZE*dz;
    const p11 = SIZE*dx + SIZE*dz;
    const minProj = Math.min(p00,p10,p01,p11);
    const maxProj = Math.max(p00,p10,p01,p11);
    const margin = 1.5; // start/end outside board a bit
    s.min = minProj - margin; s.max = maxProj + margin;
    const T = globalLedPeriodRef.current || 10;
    const span = s.max - s.min;
    s.speed = span / (T * SIZE); // since head += dt * speed * SIZE
    s.head = s.min;
    // Slight variation per pass
  s.sigma = 0.70 + Math.random()*0.30; // 0.70..1.0 (band width)
  s.amp = 0.16 + Math.random()*0.08;   // 0.16..0.24 (brightness)
  }
  useEffect(()=>{
    const T = readGlobalLedPeriodSec();
    globalLedPeriodRef.current = T;
    const ang = Math.random() * Math.PI * 2; // any angle
    setSweepAngle(ang);
  },[]);
  function SweepController(){
    useFrame((_, dt)=>{
      const s = sweepRef.current; s.head += (dt||0) * s.speed * SIZE;
      if(s.head > s.max){
        const ang = Math.random() * Math.PI * 2;
        setSweepAngle(ang);
      }
    });
    return null;
  }

  // White snake glow running along the outermost grid edges
  function PerimeterSnake(){
    const thickness = 0.045;
    const y = 0.014;
  const total = SIZE * 4; // number of segments around perimeter
  // segments per second so that one full lap matches the global LED period
  const speed = total / Math.max(0.001, globalLedPeriodRef.current);
    const tail = 6; // how many segments trail stays visible
    const peak = 0.55; // peak emissive intensity
    const baseOpacity = 0.0;

    // Build segments around the perimeter in a serpentine loop
    const segments = useMemo(()=>{
      const segs = [];
      // top edge: left -> right (H strips at re=0, c=0..7)
      for(let c=0;c<SIZE;c++){ segs.push({ kind:'H', x:c, z:-0.5, w:1, d:thickness }); }
      // right edge: top -> bottom (V strips at ce=SIZE, r=0..7)
      for(let r=0;r<SIZE;r++){ segs.push({ kind:'V', x:SIZE-0.5, z:r, w:thickness, d:1 }); }
      // bottom edge: right -> left (H strips at re=SIZE, c=7..0)
      for(let c=SIZE-1;c>=0;c--){ segs.push({ kind:'H', x:c, z:SIZE-0.5, w:1, d:thickness }); }
      // left edge: bottom -> top (V strips at ce=0, r=7..0)
      for(let r=SIZE-1;r>=0;r--){ segs.push({ kind:'V', x:-0.5, z:r, w:thickness, d:1 }); }
      return segs;
    },[]);

    function Seg({ idx, x, z, w, d }){
      const matRef = useRef();
      const haloRef = useRef();
      const lastRef = useRef(0);
      const DISABLE_DECORATIVE_ANIMS = true;
      useFrame(({ clock })=>{
  if (DISABLE_DECORATIVE_ANIMS) return;
        const t = clock.getElapsedTime();
        const moving = activityRef.current.moving;
        const budget = moving ? 1/15 : 1/30;
        if (t - lastRef.current < budget) return; // throttle
        lastRef.current = t;
        const head = (t * speed) % total;
        let dist = (idx - head);
        if(dist < 0) dist += total; // circular distance ahead of head
        const glow = Math.max(0, 1 - dist / tail);
        const e = glow * peak;
        if(matRef.current){ matRef.current.emissiveIntensity = e; }
        if(haloRef.current){ haloRef.current.opacity = baseOpacity + glow * 0.45; }
      });
      return (
        <group position={[x, y, z]}>
          <mesh>
            <boxGeometry args={[w, 0.010, d]} />
            <meshStandardMaterial ref={matRef} color={'#ffffff'} emissive={'#ffffff'} emissiveIntensity={0.0} />
          </mesh>
          <mesh renderOrder={-2}>
            <boxGeometry args={[w*1.25, 0.003, d*1.25]} />
            <meshBasicMaterial ref={haloRef} color={'#ffffff'} transparent opacity={0.0} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        </group>
      );
    }

    return (
      <group raycast={() => null}>
        {segments.map((s, i)=> (
          <Seg key={i} idx={i} x={s.x} z={s.z} w={s.w} d={s.d} />
        ))}
      </group>
    );
  }


  const s = THREE.MathUtils.clamp(Number(shadowStrength)||0, 0, 100) / 100;
  const contactOpacity = 0.12 + 0.68 * s;
  const accumOpacity = 0.30 + 0.55 * s;
  const rlIntensity = 0.5 + 1.1 * s;

  // Mobile-friendly camera presets
  const isNarrow = (()=>{ try{ return typeof window!== 'undefined' && window.matchMedia('(max-width: 640px)').matches; }catch{return false;} })();
  const camPos = isNarrow ? [3.5, 12.0, 16.2] : [3.5, 9.5, 12.8];
  const camFov = isNarrow ? 54 : 40;
  const minDist = isNarrow ? 10 : 9;
  const maxDist = isNarrow ? 20 : 14;
  // Allow near top-down; restrict downward tilt a bit so bottom edge isn't visible
  const minPolar = isNarrow ? 0.06 : 0.08;           // ~3°–5° from perfect overhead
  const maxPolar = isNarrow ? Math.PI*0.42 : Math.PI*0.40; // slightly less downward than before
  // Give full side-to-side rotation, ±90°
  const azimuthRange = Math.PI * 0.50;
  const minAz = -azimuthRange;
  const maxAz =  azimuthRange;

  // (Sweep removed) — keep animations simple and responsive

  // Animated tile (desktop). On mobile the tile is static (no per-frame updates).
  const Tile = React.memo(function Tile({ r, c, isDark, isLast, isMove, isSelTile, isHintFrom, isHintTo, isCheckKing, onClick, pulse, radar }){
    const matRef = useRef();
    const baseColor = isDark ? '#0a0f1d' : '#0b1326';
    const x = c*tile, z = r*tile;
    // Stagger phases per tile for organic variation
    const phase = (r*0.35 + c*0.23);
  const isMobileTile = useMemo(()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} },[]);
    // Cache color objects to avoid per-frame allocations and material swaps
    const c1Ref = useRef(new THREE.Color(pulse?.c1 || '#22d3ee'));
    const c2Ref = useRef(new THREE.Color(pulse?.c2 || '#a78bfa'));
    const blendRef = useRef(new THREE.Color('#22d3ee'));
    // Sweep alternating tints (checkerboard)
    const sweepLightRef = useRef(new THREE.Color(pulse?.sweepLight || '#22d3ee'));
    const sweepDarkRef  = useRef(new THREE.Color(pulse?.sweepDark  || '#8b5cf6'));
    // Radar: your and opponent colors
    const youColRef = useRef(new THREE.Color(pulse?.c1 || '#22d3ee'));
    const oppColRef = useRef(new THREE.Color(pulse?.c2 || '#a78bfa'));
    useEffect(()=>{ try{ c1Ref.current.set(pulse?.c1 || '#22d3ee'); }catch{} },[pulse?.c1]);
    useEffect(()=>{ try{ c2Ref.current.set(pulse?.c2 || '#a78bfa'); }catch{} },[pulse?.c2]);
    useEffect(()=>{ try{ sweepLightRef.current.set(pulse?.sweepLight || '#22d3ee'); }catch{} },[pulse?.sweepLight]);
    useEffect(()=>{ try{ sweepDarkRef.current.set(pulse?.sweepDark || '#8b5cf6'); }catch{} },[pulse?.sweepDark]);
    useEffect(()=>{ try{ youColRef.current.set(pulse?.c1 || '#22d3ee'); }catch{} },[pulse?.c1]);
    useEffect(()=>{ try{ oppColRef.current.set(pulse?.c2 || '#a78bfa'); }catch{} },[pulse?.c2]);
    const finalColRef   = useRef(new THREE.Color('#22d3ee'));
    const lastRef = useRef(0);
    const tmpCol = useRef(new THREE.Color('#05060a'));
    useFrame(({ clock })=>{
      const t = clock.getElapsedTime();
      const budget = 1/26; // same cadence on mobile and desktop
      if (t - lastRef.current < budget) return; // throttle
      lastRef.current = t;
      const m = matRef.current; if(!m) return;
    // Slow hue fade between two neons
      const blendT = 0.5 + 0.5*Math.sin((t/14.0) + phase*0.15);
      blendRef.current.copy(c1Ref.current).lerp(c2Ref.current, blendT);
      // Slow breathing of intensity
  const breath = 0.10 + 0.06*(0.5 + 0.5*Math.sin((t/7.0) + phase));
      // Cursor-follow glow (skip on mobile)
      let cursorBoost = 0;
      if (!isMobile && cursorRef.current.active) {
        const dx = c - cursorRef.current.x;
        const dz = r - cursorRef.current.z;
        const dist = Math.hypot(dx, dz);
        const csigma = 0.7; // radius of influence in tiles
        const cval = Math.exp(-0.5 * (dist*dist) / (csigma*csigma));
        cursorBoost = 0.14 * cval; // cursor slightly brighter than sweep
      }

      // Global sweep boost (gaussian around moving line) — now also on mobile
      let sweepBoost = 0;
      {
        const s = sweepRef.current; const dx = s.dir[0], dz = s.dir[1];
        const u = (c + 0.5) * dx + (r + 0.5) * dz; // project tile center onto sweep axis (tile=1)
        const d = (u - s.head);
        const g = Math.exp(-0.5 * (d * d) / (s.sigma * s.sigma));
        sweepBoost = s.amp * g;
      }

      // Compose emissive intensity and color
      const baseEmit = breath + cursorBoost + sweepBoost;
      // Alternating sweep tint: blend base neon color toward a parity-based sweep color
      // Radar: during sweep, if this tile is reachable by you/opponent, tint to that color
      let sweepTint = isDark ? sweepDarkRef.current : sweepLightRef.current;
      if (radar?.on && sweepBoost > 0.02) {
        const key = `${r}-${c}`;
        if (radar.reachYou?.has && radar.reachYou.has(key)) sweepTint = youColRef.current; else if (radar.reachOpp?.has && radar.reachOpp.has(key)) sweepTint = oppColRef.current;
      }
  const k = THREE.MathUtils.clamp(sweepBoost * 3.6, 0, 1); // stronger mix from sweep
      finalColRef.current.copy(blendRef.current).lerp(sweepTint, k);
      // Overrides for move/last highlighting
      if (isLast) {
        tmpCol.current.set('#22c55e'); m.emissive.copy(tmpCol.current);
        m.emissiveIntensity = 0.58;
      } else if (isMove) {
        tmpCol.current.set(isDark ? NEON_TILE_DARK : NEON_TILE_LIGHT); m.emissive.copy(tmpCol.current);
        m.emissiveIntensity = 0.44;
      } else {
        // Neon base blended with alternating sweep tint (now also on mobile)
        m.emissive.copy(finalColRef.current);
        m.emissiveIntensity = baseEmit;
      }
    });
    const onTileClick = useCallback(()=> onClick(r,c), [onClick, r, c]);
    return (
      <group>
        <mesh position={[x,0.0005,z]} rotation={[-Math.PI/2,0,0]} onClick={onTileClick} receiveShadow>
          <planeGeometry args={[tile,tile]} />
          <meshStandardMaterial ref={matRef} color={baseColor} emissive={'#05060a'} emissiveIntensity={isMobileTile ? 0.10 : 0.08} />
        </mesh>
        {isCheckKing && (
          <mesh position={[x,0.036,z]} rotation={[-Math.PI/2,0,0]} raycast={() => null}>
            <ringGeometry args={[0.22,0.34,40]} />
            <meshStandardMaterial color={'#ef4444'} emissive={'#ef4444'} emissiveIntensity={0.85} transparent opacity={0.95} side={THREE.DoubleSide} />
          </mesh>
        )}
        {isSelTile && (
          <mesh position={[x,0.03,z]} rotation={[-Math.PI/2,0,0]} raycast={() => null}>
            <ringGeometry args={[0.22,0.32,32]} />
            <meshStandardMaterial color={'#a78bfa'} emissive={'#a78bfa'} emissiveIntensity={0.75} side={THREE.DoubleSide} />
          </mesh>
        )}
        {isMove && (
          <mesh position={[x,0.025,z]} rotation={[-Math.PI/2,0,0]} raycast={() => null}>
            <ringGeometry args={[0.18,0.26,32]} />
            <meshStandardMaterial color={'#22d3ee'} emissive={'#22d3ee'} emissiveIntensity={0.6} transparent opacity={0.95} side={THREE.DoubleSide} />
          </mesh>
        )}
        {isHintFrom && (
          <mesh position={[x,0.022,z]} rotation={[-Math.PI/2,0,0]} raycast={() => null}>
            <ringGeometry args={[0.20,0.30,40]} />
            <meshStandardMaterial color={'#f59e0b'} emissive={'#f59e0b'} emissiveIntensity={0.7} transparent opacity={0.95} side={THREE.DoubleSide} />
          </mesh>
        )}
        {isHintTo && (
          <mesh position={[x,0.018,z]} rotation={[-Math.PI/2,0,0]} raycast={() => null}>
            <ringGeometry args={[0.16,0.24,40]} />
            <meshStandardMaterial color={'#22c55e'} emissive={'#22c55e'} emissiveIntensity={0.7} transparent opacity={0.95} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    );
  });
  const isMobile = (()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches); }catch{return false;} })();
  // Use capped DPR with antialiasing on phones to reduce jaggies without blowing fill rate
  const dprVal = (()=>{ try{ return isMobile ? 1 : 1; }catch{return 1;} })();
  const controlsMovingRef = useRef(false);
  const pieceSpeed = isMobile ? 14 : 10;
  const pieceLift = isMobile ? 0.08 : 0.12;
  const mobileAltCam = useMemo(()=>{
    try{
      const qs = new URLSearchParams(window.location.search);
      const q = (qs.get('mobileCam') || localStorage.getItem('mobileCam') || '').toLowerCase();
      return (q==='1' || q==='true' || q==='on');
    }catch{ return false; }
  },[]);
  return (
    <Canvas
      shadows={!isMobile}
      frameloop={'always'}
      dpr={dprVal}
  camera={{ position: camPos, fov: camFov, near:0.08, far:100 }}
      style={{ width:'100%', height:'100%', touchAction: 'none' }}
  gl={{ powerPreference: 'high-performance', antialias: isMobile ? false : true, alpha:false, stencil:false, depth:true, preserveDrawingBuffer: false }}
  onCreated={(st)=>{ try{ st.gl.setClearColor('#0f172a'); }catch{} }}
    >
  {/* Continuous render; fixed DPR to avoid mobile flicker */}
      {isMobile && mobileAltCam ? (
        <MobileAltZoom enabled={true} minDistance={minDist} maxDistance={maxDist} activityRef={activityRef} />
      ) : isMobile ? (
      <SmartOrbitControls
        makeDefault
        target={[3.5,0,3.5]}
        enablePan={false}
        enableDamping={true}
        dampingFactor={0.12}
        minDistance={minDist}
        maxDistance={maxDist}
        minPolarAngle={minPolar}
        maxPolarAngle={maxPolar}
  minAzimuthAngle={minAz}
  maxAzimuthAngle={maxAz}
        zoomSpeed={isMobile ? 0.8 : 0.9}
        onStart={()=>{ controlsMovingRef.current = true; try{ const evt=new Event('invalidate'); }catch{} }}
        onEnd={()=>{ controlsMovingRef.current = false; try{ const evt=new Event('invalidate'); }catch{} }}
      />) : (
      <OrbitControls
        makeDefault
        target={[3.5,0,3.5]}
        enablePan={false}
        enableDamping={true}
        dampingFactor={0.12}
        minDistance={minDist}
        maxDistance={maxDist}
        minPolarAngle={minPolar}
        maxPolarAngle={maxPolar}
  minAzimuthAngle={minAz}
  maxAzimuthAngle={maxAz}
        zoomSpeed={1.0}
      />)}
  {/* Optional: Mobile FXAA — disabled for stability */}
  {/* {isMobile && <MobileFXAA />} */}
      {!isMobile && (
        <>
          <ContactShadows position={[3.5, 0.001, 3.5]} opacity={contactOpacity} width={16} height={16} blur={1.8} far={9.5} frames={1} color="#000000" />
          <AccumulativeShadows
            position={[3.5, 0.002, 3.5]}
            rotation={[-Math.PI/2, 0, 0]}
            scale={16}
            opacity={accumOpacity}
            temporal={false}
            frames={1}
            color="#000000"
          >
            <RandomizedLight amount={5} radius={5} intensity={rlIntensity*0.9} ambient={0.22} position={[3.5, 10, 3.5]} bias={0.001} />
          </AccumulativeShadows>
        </>
      )}
      <Lights />
      <group position={[3.5,0,3.5]} rotation={[0, myColor==='b'?Math.PI:0, 0]}>
  <group position={[-3.5,0,-3.5]} ref={tilesGroupRef}>
          <mesh receiveShadow rotation={[-Math.PI/2,0,0]} position={[3.5,-0.15,3.5]} raycast={() => null}>
            <planeGeometry args={[SIZE+2,SIZE+2]} />
            <meshStandardMaterial color={NEON_BG_OUTER} emissive={NEON_BG_OUTER} emissiveIntensity={0.2} />
          </mesh>
          <mesh receiveShadow rotation={[-Math.PI/2,0,0]} position={[3.5,-0.05,3.5]} raycast={() => null}>
            <planeGeometry args={[SIZE,SIZE]} />
            <meshStandardMaterial color={NEON_BG_INNER} emissive={NEON_BG_INNER} emissiveIntensity={0.35} />
          </mesh>
          {(() => { const mobile = (typeof window!=='undefined') && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches); return (
            <>
              <GridLEDs animated={true} pulseSlow={false} c1={pulsePalette.c1} c2={pulsePalette.c2} />
              {!mobile && <PointerTracker />}
              <SweepController />
            </>
          ); })()}
          {/* Perimeter chase effect (white snake along outer edges) */}
          {(() => { const mobile = (typeof window!=='undefined') && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches); return mobile ? null : <PerimeterSnake />; })()}
          {/* Neon arcade rim removed */}
          {(() => { const mobile = (typeof window!=='undefined') && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches); if(!mobile) return null; return (
            <group position={[0,0.012,0]}>
              {Array.from({length:SIZE+1}).map((_,i)=> (
                <Line key={`h-${i}`} points={[[0-0.5,0,i-0.5],[SIZE-0.5,0,i-0.5]]} color="#22d3ee" lineWidth={2.6} transparent opacity={0.55} />
              ))}
              {Array.from({length:SIZE+1}).map((_,i)=> (
                <Line key={`v-${i}`} points={[[i-0.5,0,0-0.5],[i-0.5,0,SIZE-0.5]]} color="#22d3ee" lineWidth={2.6} transparent opacity={0.55} />
              ))}
            </group>
          ); })()}
          {Array.from({length:SIZE}).map((_,r)=>Array.from({length:SIZE}).map((_,c)=>{
            const isDark=(r+c)%2===1; const isLast=lastMove&&lastMove.r2===r&&lastMove.c2===c; const isMove=moves?.some(m=>m.r2===r&&m.c2===c);
            const isSelTile = !!(selected && selected.r===r && selected.c===c);
            const isHintFrom = !!(hint && hint.from && hint.from.r===r && hint.from.c===c);
            const isHintTo = !!(hint && hint.to && hint.to.r2===r && hint.to.c2===c);
            const isCheckTile = !!(checkKing && checkKing.r===r && checkKing.c===c);
            return (
              <Tile
                key={`${r}-${c}`}
                r={r} c={c}
                isDark={isDark}
                isLast={!!isLast}
                isMove={!!isMove}
                isSelTile={isSelTile}
                isHintFrom={isHintFrom}
                isHintTo={isHintTo}
                isCheckKing={isCheckTile}
                onClick={onCellClick}
                pulse={pulsePalette}
                radar={{ on: RADAR_ON, reachYou: (radarReach ? (myColor==='w'?radarReach.w:radarReach.b) : null), reachOpp: (radarReach ? (myColor==='w'?radarReach.b:radarReach.w) : null) }}
              />
            );
          }))}
          <Suspense fallback={null}>
            {board.map((row,r)=>row.map((pc,c)=>{
              if(!pc) return null; const toPos = posFor(pc, r, c);
              const isSel=selected && selected.r===r && selected.c===c;
              const isMovedDest = !!(lastMove && lastMove.r2===r && lastMove.c2===c);
              const key = `${pc.c}-${pc.t}-${r}-${c}`;
              let fromPos = undefined;
              if (isMovedDest) {
                fromPos = posFor(pc, lastMove.r, lastMove.c);
              } else if (!spawnedRef.current.has(key)) {
                const spawnZ = pc.c==='w' ? (SIZE + 1) : -1;
                fromPos = [toPos[0], toPos[1], spawnZ];
                spawnedRef.current.add(key);
              }
              return (
                <AnimatedPiece key={`p-${r}-${c}`} to={toPos} from={fromPos} speed={pieceSpeed} lift={pieceLift} onClick={()=>onCellClick(r,c)} activityRef={activityRef}>
                  {/* Swap piece tints between sides */}
                  <MaybeChessPiece pc={pc} isSel={isSel} tint={pc.c==='w' ? (pieceColors?.b || '#111827') : (pieceColors?.w || '#e5e7eb')} glow={pieceGlow} pauseRef={pauseRef} disableGlow={true} />
                </AnimatedPiece>
              );
            }))}
          </Suspense>
        </group>
      </group>
    </Canvas>
  );
}

export default function ChessScreen(){
  const [board,setBoard]=useState(setupChess());
  const [currentColor,setCurrentColor]=useState('w');
  const [winner,setWinner]=useState(null);
  const [playerColor,setPlayerColor]=useState(null); // 'w'|'b'
  const [chatFeed, setChatFeed] = useState([]);
  const [lastMove,setLastMove]=useState(null);
  const [selected,setSelected]=useState(null);
  const [moves,setMoves]=useState([]);
  const [scores,setScores]=useState({ w:0, b:0 });
  const [material,setMaterial]=useState({ w:0, b:0 }); // capture points per side
  const [turnToast,setTurnToast] = useState(null);
  const [turnOverlayText, setTurnOverlayText] = useState(null);
  const [promotionReq, setPromotionReq] = useState(null); // { from:{r,c}, to:{r2,c2} }
  const [pieceColors, setPieceColors] = useState({ w:'#e5e7eb', b:'#111827' });
  const [myPieceColor, setMyPieceColor] = useState(()=> localStorage.getItem('profileColor') || localStorage.getItem('chesTint') || '#22d3ee');
  const [shadowStrength] = useState(()=>{
    const v = localStorage.getItem('chesShadow') || '70';
    const n = Math.max(0, Math.min(100, Number(v)||70));
    return n;
  });
  const [pieceGlow] = useState(()=>{
    const v = localStorage.getItem('chesGlow') || '60';
    const n = Math.max(0, Math.min(100, Number(v)||60));
    return n;
  });
  const [alertOverlay, setAlertOverlay] = useState(null); // { text, kind }
  const [inCheckColor, setInCheckColor] = useState(null); // 'w'|'b'|null
  const [checkKingSquare, setCheckKingSquare] = useState(null); // {r,c}|null
  const [hintMove, setHintMove] = useState(null); // {from,to,score}|null

  const [username,setUsername]=useState(localStorage.getItem('username') || localStorage.getItem('chesName') || '');
  const userIdRef = useRef(() => {
    const raw = localStorage.getItem('userId') ?? localStorage.getItem('id');
    const n = raw != null ? Number(raw) : null;
    return Number.isFinite(n) ? n : null;
  });
  const [avatarId, setAvatarId] = useState(localStorage.getItem('profileAvatar') || localStorage.getItem('chesAvatar') || 'rocket');
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [scBalance,setScBalance]=useState(0);
  const [stakeSC,setStakeSC]=useState(()=>Number(localStorage.getItem('chesStake')||'1')||1);
  const [stakeText,setStakeText]=useState(()=>localStorage.getItem('chesStake')||'1.00');
  // Game mode: 'strict' | 'free'
  const [gameMode, setGameMode] = useState(() => {
    const m = (localStorage.getItem('chesMode')||'strict').toLowerCase();
    return (m==='free') ? 'free' : 'strict';
  });
  const [showHints, setShowHints] = useState(() => localStorage.getItem('chesHints')==='1');

  const [showMatch,setShowMatch]=useState(false);
  const [pairedInfo,setPairedInfo]=useState(null);
  const [youAvatar,setYouAvatar]=useState(avatarId || 'rocket');
  const [oppAvatar,setOppAvatar]=useState('alien');
  const [countdown,setCountdown]=useState(null);
  const [rematchVotes,setRematchVotes]=useState(0);
  const [hasVotedRematch,setHasVotedRematch]=useState(false);
  const [presence, setPresence] = useState({ w: true, b: true });
  const [serverSaved, setServerSaved] = useState([]); // server-listed saved games by username
  // Auth + connection overlay state
  const isAuthed = useCallback(() => !!localStorage.getItem('token') && !!localStorage.getItem('username'), []);
  const [authed, setAuthed] = useState(isAuthed());
  const [wsConnected, setWsConnected] = useState(false);

  // Saved games (local only) helpers
  const loadSavedGames = useCallback(()=>{ try{ return JSON.parse(localStorage.getItem('chesGames')||'[]'); }catch{ return []; } },[]);
  const saveGameEntry = useCallback((entry)=>{
    try{
      if(!entry || !entry.gameId || !entry.token) return;
      const list = loadSavedGames();
      const idx = list.findIndex(g=>g.gameId===entry.gameId);
      const now = Date.now();
      const prev = idx>=0 ? list[idx] : {};
      const merged = { ...prev, ...entry, ts: now };
      if(idx>=0) list[idx]=merged; else list.unshift(merged);
      // Clamp to last 5
      while(list.length>5) list.pop();
      localStorage.setItem('chesGames', JSON.stringify(list));
    }catch{}
  },[loadSavedGames]);
  const removeGameEntry = useCallback((gameId)=>{
    try{
      const list = loadSavedGames().filter(g=>g.gameId!==gameId);
      localStorage.setItem('chesGames', JSON.stringify(list));
      // Also reset single-resume if it matches
      const cur = JSON.parse(localStorage.getItem('chesResume')||'null');
      if(cur && cur.gameId===gameId) localStorage.removeItem('chesResume');
    }catch{}
  },[loadSavedGames]);

  const wsRef=useRef(null); const connectWSRef=useRef(()=>{});
  const pendingSavedJoinRef = useRef(null);
  const lockedStakeRef=useRef(0); const settledOnceRef=useRef(false);

  useEffect(()=>{ (async()=>{ try{ setScBalance(await getBalance()); }catch{} })(); },[]);
  // Ensure a WS connection exists so we can fetch the server-side saved list
  // and keep it refreshed when username changes.
  useEffect(()=>{
    const name=(username||'').toString().slice(0,40);
    if(!name) return;
    const ws=wsRef.current;
    if(!ws || ws.readyState!==WebSocket.OPEN){
      // Open a lightweight connection to fetch saved games (no join)
      connectWSRef.current(false);
      return;
    }
    try{ ws.send(JSON.stringify({ type:'listMySavedGames', username: name, userId: userIdRef.current && userIdRef.current() })); }catch{}
  }, [username]);

  // No global gating; models load on-demand with Suspense fallbacks

  // Layout is baked; no runtime adjustment panel

  const lockStake=useCallback(async(amt)=>{ const a=Math.max(0.01,Number(amt)||0); if(!a) return false; if(lockedStakeRef.current>0) return true; try{ const j=await scAdjust(-a,'Chess — lock stake'); lockedStakeRef.current=a; setScBalance(Number(j.sc_balance)||0); return true; }catch(e){ alert(e.message||'Could not lock stake.'); return false; } },[]);
  const refundStake=useCallback(async(reason='refund')=>{ const a=lockedStakeRef.current; if(!a) return; try{ const j=await scAdjust(+a,`Chess — ${reason}`); setScBalance(Number(j.sc_balance)||0); lockedStakeRef.current=0; }catch(e){} },[]);
  const settleWin=useCallback(async(myStake,oppStake)=>{ const credit=Number(myStake||0)+Number(oppStake||0); try{ const j=await scAdjust(+credit,'Chess — win payout'); setScBalance(Number(j.sc_balance)||0);}catch(e){ try{ const j2=await scAdjust(+Number(myStake||0),'Chess — payout fallback refund'); setScBalance(Number(j2.sc_balance)||0);}catch{} } lockedStakeRef.current=0; },[]);

  const withOpenSocket=useCallback(fn=>{ const ws=wsRef.current; if(ws&&ws.readyState===WebSocket.OPEN) fn(ws); },[]);
  const isSocketOpen = useCallback(()=>{ const ws=wsRef.current; return !!ws && ws.readyState===WebSocket.OPEN; },[]);

  connectWSRef.current = useCallback((fromJoin=false)=>{
    try{ if(wsRef.current){ try{ wsRef.current.close(1000,'reconnect'); }catch{} wsRef.current=null; } }catch{}
    const url=getWsUrl(); const sock=new WebSocket(url); wsRef.current=sock;

  sock.onopen=()=>{
    setWsConnected(true);
    if(fromJoin){
  try{ sock.send(JSON.stringify({ type:'joinGame', username, userId: userIdRef.current && userIdRef.current(), stake: Number(stakeSC)||1, pieceColor: myPieceColor, avatar: avatarId, mode: gameMode })); }catch{}
    } else {
      const pend = pendingSavedJoinRef.current;
      if(pend && !pend.sent){
        try{
          if(pend.claim){ sock.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username, userId: userIdRef.current && userIdRef.current(), otherUsername: pend.otherUsername })); }
          else { sock.send(JSON.stringify({ type:'joinSavedGame', gameId: pend.gameId, token: pend.token, username, userId: userIdRef.current && userIdRef.current() })); }
          pendingSavedJoinRef.current = { ...pend, sent: true };
        }catch{}
      }
    }
    // Always refresh server-side saved list after connection
    try{ const name=(username||'').toString().slice(0,40); if(name){ sock.send(JSON.stringify({ type:'listMySavedGames', username: name, userId: userIdRef.current && userIdRef.current() })); } }catch{}
  };
    sock.onmessage=(evt)=>{
      const data = JSON.parse(evt.data||'{}');
  if(data.type==='quickChat'){
        const youCol = playerColor || 'w';
        const from = data.from === youCol ? 'you' : (data.from||'opp');
        setChatFeed(prev => [...prev, { from, username: data.username, text: String(data.text||'').slice(0,80), ts: Number(data.ts)||Date.now() }].slice(-12));
        return;
      }
      if(data.type==='queued'){ setShowMatch(true); setPairedInfo(null); setCountdown(null); return; }
      if(data.type==='savedQueued'){
        const youColor=data.you===2?'b':'w';
        pendingSavedJoinRef.current = null;
        setShowMatch(true);
        setPairedInfo({
          you:data.you,
          usernames:data.usernames||{ w:'White', b:'Black' },
          stakes:{ w:'—', b:'—' },
          avatars: data.avatars || { w:'rocket', b:'alien' },
          mode: (data.mode==='free'?'free':'strict'),
          gameId: data.gameId||null,
          token: data.token||null
        });
        const av = data.avatars || { w:'rocket', b:'alien' };
        setYouAvatar(youColor==='b' ? (av.b||'rocket') : (av.w||'rocket'));
        setOppAvatar(youColor==='b' ? (av.w||'alien') : (av.b||'alien'));
        if(data.pieceColors && (data.pieceColors.w || data.pieceColors.b)) setPieceColors({ w: data.pieceColors.w || '#e5e7eb', b: data.pieceColors.b || '#111827' });
        else setPieceColors(prev=>({ w: prev.w||'#e5e7eb', b: prev.b||'#111827' }));
        try{ if(data.gameId && data.token){ const u=data.usernames||{w:'White',b:'Black'}; const opp = youColor==='w'?'b':'w'; saveGameEntry({ gameId:data.gameId, token:data.token, mode:(data.mode==='free'?'free':'strict'), usernames:u, you: youColor, youName:u[youColor], oppName:u[opp] }); } }catch{}
        return;
      }
      if(data.type==='paired'){
        pendingSavedJoinRef.current = null;
        const youColor=data.you===2?'b':'w';
        setPairedInfo({
          you:data.you,
          usernames:data.usernames||{ w:'White', b:'Black' },
          stakes:data.stakes || (data.you===2 ? { w:'—', b:Number(stakeSC)||0 } : { w:Number(stakeSC)||0, b:'—' }),
          avatars: data.avatars || { w:'rocket', b:'alien' },
          mode: (data.mode==='free'?'free':'strict'),
          gameId: data.gameId||null,
          token: data.token||null
        });
        // Persist resume info locally
        try{ if(data.gameId && data.token){
          const u = data.usernames || { w:'White', b:'Black' };
          const opp = youColor==='w'?'b':'w';
          const pack={ gameId:data.gameId, token:data.token, mode:(data.mode==='free'?'free':'strict'), usernames: u, pieceColors:data.pieceColors||null, you: youColor, youName: u[youColor], oppName: u[opp] };
          localStorage.setItem('chesResume', JSON.stringify({ gameId:data.gameId, token:data.token }));
          saveGameEntry(pack);
        } }catch{}
  // Initialize avatars/colors for both sides
        const av = data.avatars || { w:'rocket', b:'alien' };
        setYouAvatar(youColor==='b' ? (av.b||'rocket') : (av.w||'rocket'));
        setOppAvatar(youColor==='b' ? (av.w||'alien') : (av.b||'alien'));
        // Send our latest cosmetics in case user changed after join
        try{ sock.send(JSON.stringify({ type:'setAvatar', avatar: avatarId })); }catch{}
        try{ sock.send(JSON.stringify({ type:'setUsername', username })); }catch{}
        try{ sock.send(JSON.stringify({ type:'setPieceColor', pieceColor: myPieceColor })); }catch{}
        // Do not lock on pair; lock on startGame
        return;
      }
  if (data.type==='presence' && data.present) { setPresence({ w: !!data.present.w, b: !!data.present.b }); return; }
  if (data.type==='mySavedGames') { try{ setServerSaved(Array.isArray(data.list)?data.list:[]); }catch{ setServerSaved([]); } return; }
      if (data.type==='savedDenied') {
        const pend = pendingSavedJoinRef.current; 
        // Fallback: try to claim by username if we haven't tried yet
        if(pend && !pend.triedClaim && username){
          pendingSavedJoinRef.current = { ...pend, triedClaim: true };
          try{ sock.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username, userId: userIdRef.current && userIdRef.current() })); }catch{}
        } else {
          setTurnToast('Saved game not found or not yours'); setTimeout(()=>setTurnToast(null), 1200);
          pendingSavedJoinRef.current = null;
        }
        return;
      }
      if (data.type==='playerLeft' && data.side) {
        setPresence(prev => ({ ...prev, [data.side]: false }));
        return;
      }
      if (data.type==='playerBack' && data.side) {
        setPresence(prev => ({ ...prev, [data.side]: true }));
        return;
      }
      if (data.type==='opponentLeft') {
        try{
          const youCol = (playerColor || (pairedInfo?.you===2?'b':'w'));
          if(youCol){ const oppCol = youCol==='w' ? 'b' : 'w'; setPresence(prev => ({ ...prev, [oppCol]: false })); }
        }catch{}
        return;
      }
      if (data.type==='opponentBack') {
        try{
          const youCol = (playerColor || (pairedInfo?.you===2?'b':'w'));
          if(youCol){ const oppCol = youCol==='w' ? 'b' : 'w'; setPresence(prev => ({ ...prev, [oppCol]: true })); }
        }catch{}
        return;
      }
      if (data.type==='usernames' && data.usernames) {
        setPairedInfo(prev => prev ? { ...prev, usernames: data.usernames } : prev);
        // Update saved entry names if we have a game
        try{
          if(pairedInfo?.gameId && pairedInfo?.token){
            const youCol = (pairedInfo?.you===2?'b':'w');
            const oppCol = youCol==='w'?'b':'w';
            saveGameEntry({ gameId: pairedInfo.gameId, token: pairedInfo.token, usernames: data.usernames, you: youCol, youName: data.usernames[youCol], oppName: data.usernames[oppCol] });
          }
        }catch{}
        return;
      }
      if (data.type==='avatars' && data.avatars) {
        const youCol = (pairedInfo?.you===2 ? 'b' : 'w');
        setYouAvatar(data.avatars[youCol] || youAvatar);
        setOppAvatar(data.avatars[youCol==='w'?'b':'w'] || oppAvatar);
        setPairedInfo(prev => prev ? { ...prev, avatars: data.avatars } : prev);
        return;
      }
      if(data.type==='stakes'){ setPairedInfo(p=>p?{...p, stakes:data.stakes}:{ you:1, stakes:data.stakes }); return; }
      if(data.type==='countdown'){ setCountdown(data.value); return; }
  if(data.type==='startGame'){
        setChatFeed([]);
        const you=data.playerNumber===2?'b':'w';
        setPlayerColor(you);
        setCurrentColor(data.currentColor||'w');
        setBoard(data.board || setupChess()); setWinner(null);
        if(data.avatars){ setYouAvatar(you==='b' ? (data.avatars?.b||'rocket') : (data.avatars?.w||'rocket')); setOppAvatar(you==='b' ? (data.avatars?.w||'alien') : (data.avatars?.b||'alien')); }
        if(data.pieceColors && (data.pieceColors.w || data.pieceColors.b)) setPieceColors({ w: data.pieceColors.w || '#e5e7eb', b: data.pieceColors.b || '#111827' });
        if(data.mode || data.gameId || data.token){ setPairedInfo(prev=> prev ? { ...prev, mode: (data.mode==='free'?'free':'strict'), gameId: data.gameId||prev?.gameId||null, token: data.token||prev?.token||null } : prev); }
        // Persist resume info locally
        try{ if(data.gameId && data.token){
          const u = (pairedInfo?.usernames) || { w:'White', b:'Black' };
          const opp = you==='w'?'b':'w';
          const pack={ gameId:data.gameId, token:data.token, mode:(data.mode==='free'?'free':'strict'), usernames: u, pieceColors:data.pieceColors||null, you: you, youName: u[you], oppName: u[opp] };
          localStorage.setItem('chesResume', JSON.stringify({ gameId:data.gameId, token:data.token }));
          saveGameEntry(pack);
        } }catch{}
  setShowMatch(false); setCountdown(null);
        const itsYou=(data.currentColor||'w')===you;
        setTurnToast( itsYou ? "It's your turn!" : "It's your opponent's turn!" ); setTimeout(()=>setTurnToast(null),1200);
        setTurnOverlayText(itsYou ? 'Your Turn' : "Opponent's Turn");
        setTimeout(()=>setTurnOverlayText(null), 1400);
        // Lock stake now (new staking model)
        try{ const desired=Math.max(0.01,Number(stakeText)||Number(stakeSC)||0); if(lockedStakeRef.current<=0){ (async()=>{ await lockStake(desired); })(); } }catch{}
        return;
      }
      if(data.type==='moves'){
        // Use server-provided moves for the currently selected piece.
        // In Strict mode these are fully legal; in Free-Play they are pseudo-legal.
        try{
          const from = data?.from;
          const list = Array.isArray(data?.moves) ? data.moves : [];
          if(selected && from && Number.isInteger(from.r) && Number.isInteger(from.c)){
            if(selected.r===from.r && selected.c===from.c){
              startTransition(()=> setMoves(list));
              return;
            }
          }
        }catch{}
        return;
      }
      if(data.type==='savedRemoved'){
        if(data.ok && data.gameId!=null){
          try{ setServerSaved(prev => Array.isArray(prev) ? prev.filter(x=>x.gameId!==data.gameId) : prev); }catch{}
        }
        return;
      }
      if(data.type==='gameUpdate'){
        // Compute capture material gain from previous -> new board using lastMove
        try{
          const prevB = board;
          const lm = data.lastMove;
          if(lm && Number.isInteger(lm.r) && Number.isInteger(lm.c) && Number.isInteger(lm.r2) && Number.isInteger(lm.c2)){
            const mover = prevB?.[lm.r]?.[lm.c];
            const taken = prevB?.[lm.r2]?.[lm.c2];
            if(mover && taken && mover.c!==taken.c){
              const val = pieceValue(taken.t);
              if(val>0){ setMaterial(prev=>({ ...prev, [mover.c]: (prev[mover.c]||0) + val })); }
            }
          }
        }catch{}
        setBoard(data.board||board); setCurrentColor(data.currentColor||'w'); setWinner(data.winner||null); setLastMove(data.lastMove||null);
        if(data.pieceColors && (data.pieceColors.w || data.pieceColors.b)) setPieceColors({ w: data.pieceColors.w || '#e5e7eb', b: data.pieceColors.b || '#111827' });
        if(!data.winner){
          const yours=(data.currentColor||'')===(playerColor||'');
          setTurnToast(yours?"It's your turn!":"It's your opponent's turn!"); setTimeout(()=>setTurnToast(null),1100);
          setTurnOverlayText(yours ? 'Your Turn' : "Opponent's Turn");
          setTimeout(()=>setTurnOverlayText(null), 1200);
        }
        if(data.winner){
          const txt = data.winner==='draw' ? 'Stalemate' : `Checkmate — ${(data.winner==='w'?'White':'Black')} wins!`;
          setAlertOverlay({ text: txt, kind: data.winner==='draw' ? 'stalemate' : 'checkmate' });
          setTimeout(()=>setAlertOverlay(null), 1800);
          // Remove saved entry if the game finished
          try{ const gid = (pairedInfo?.gameId)||null; if(gid) removeGameEntry(gid); }catch{}
        }
        if(data.winner){
          const myColor=playerColor||(data.playerNumber===2?'b':'w');
          if(data.winner!=='draw'){
            const stakes=(pairedInfo&&pairedInfo.stakes)||data.stakes||{}; const myStake=Number(stakes?.[myColor==='w'?'w':'b'])||lockedStakeRef.current||Number(stakeSC)||0; const oppStake=myStake;
            if(data.winner===myColor){ settleWin(myStake,oppStake); settledOnceRef.current=true; } else { lockedStakeRef.current=0; }
            setScores(prev=>({ ...prev, [data.winner]: (prev[data.winner]||0)+1 }));
          } else {
            // Draw: refund
            lockedStakeRef.current=0; refundStake('draw refund');
          }
        }
        return;
      }
      if(data.type==='gameEnded'){
        // Cleanup saved game on end
        try{ const gid=(pairedInfo?.gameId)||null; if(gid) removeGameEntry(gid); }catch{}
        return;
      }
      if(data.type==='rematchUpdate'){ setRematchVotes(data.count||0); return; }
      if(data.type==='rematchStart'){ setHasVotedRematch(false); setRematchVotes(0); setBoard(setupChess()); setWinner(null); setCurrentColor('w'); if(data.pieceColors) setPieceColors({ w:data.pieceColors.w||'#e5e7eb', b:data.pieceColors.b||'#111827' });
        try{ const desired=Math.max(0.01,Number(stakeText)||Number(stakeSC)||0); if(lockedStakeRef.current<=0){ (async()=>{ await lockStake(desired); })(); } }catch{}
        return; }
      if(data.type==='pieceColors'){ if(data.pieceColors) setPieceColors({ w:data.pieceColors.w||'#e5e7eb', b:data.pieceColors.b||'#111827' }); return; }
  if(data.type==='opponentLeft'){ return; }
      if(data.type==='resetAck'){ setBoard(setupChess()); setWinner(null); setCurrentColor('w'); return; }
    };
    sock.onclose=()=>{ setWsConnected(false); }; sock.onerror=()=>{ setWsConnected(false); };
  // Keep dependency set tight to avoid re-creating socket on frequent UI state changes
  },[username,stakeSC,stakeText,lockStake,refundStake,settleWin,myPieceColor,avatarId]);

  const onJoin=useCallback(async()=>{
    const stake=Math.max(0.01,Number(stakeText)||Number(stakeSC)||0); setStakeSC(stake); setStakeText(stake.toFixed(2)); localStorage.setItem('chesStake', String(stake));
    localStorage.setItem('chesTint', myPieceColor);
    localStorage.setItem('chesAvatar', avatarId);
    localStorage.setItem('chesName', (username||'').slice(0,16));
    // Do not lock here; lock on startGame
    setShowMatch(true); connectWSRef.current(true);
  },[stakeSC,stakeText,myPieceColor,avatarId,username]);

  const onCancelQueue=useCallback(()=>{ refundStake('canceled matchmaking'); const ws=wsRef.current; try{ if(ws) ws.close(1000,'cancel'); }catch{} setShowMatch(false); },[refundStake]);
  const onRematch=useCallback(async()=>{ const stake=Math.max(0.01,Number(stakeText)||Number(stakeSC)||0); withOpenSocket(sock=>{ try{ sock.send(JSON.stringify({ type:'rematchVote', stake })); }catch{} }); setHasVotedRematch(true); },[stakeSC,stakeText]);

  const needsPromotion = useCallback((pc, destR)=>{
    if(!pc || pc.t!=='p') return false;
    if(pc.c==='w' && destR===0) return true;
    if(pc.c==='b' && destR===7) return true;
    return false;
  },[]);

  const applyLocalMove = useCallback((r0,c0,r1,c1,promotion)=>{
    setBoard(prev=>{
      const src = prev?.[r0]?.[c0]; if(!src) return prev;
      const clone = prev.map(row=>row.slice());
      const dst = clone[r1][c1];
      let moved = { ...src };
      // Basic promotion
      if(moved.t==='p'){
        const reachEnd = (moved.c==='w' && r1===0) || (moved.c==='b' && r1===7);
        if(reachEnd){ moved = { c: moved.c, t: (promotion||'q') };
        }
      }
      clone[r0][c0] = EMPTY;
      clone[r1][c1] = moved;
      const lm = { r:r0, c:c0, r2:r1, c2:c1, capture: !!dst, promotion: moved.t!=='p' && src.t==='p' ? moved.t : undefined };
      setLastMove(lm);
      // Material scoring on local move
      if(dst && dst.c!==src.c){ const val = pieceValue(dst.t); if(val>0){ setMaterial(prev=>({ ...prev, [src.c]: (prev[src.c]||0) + val })); } }
      setCurrentColor(prevTurn => (prevTurn==='w'?'b':'w'));
      setSelected(null); setMoves([]);
      return clone;
    });
  },[]);

  const handleCellClick=useCallback((r,c)=>{
    const myTurn = playerColor ? (currentColor === playerColor) : false;
    const cell = board?.[r]?.[c];
    // If a piece is selected, prioritize moving to a highlighted square (including captures on occupied squares)
    if (selected) {
      const mv = moves.find(m => m.r2 === r && m.c2 === c);
      if (mv) {
        const { r: r0, c: c0 } = selected; const selPc = board?.[r0]?.[c0];
        if (myTurn && selPc && playerColor && selPc.c === playerColor) {
          // Check promotion
          if(needsPromotion(selPc, r)){
            startTransition(()=> setPromotionReq({ from:{ r:r0, c:c0 }, to:{ r2:r, c2:c } }));
          } else {
            // Send to server only; rely on authoritative updates (enforces check rules)
            withOpenSocket(sock => { try { sock.send(JSON.stringify({ type: 'makeMove', r: r0, c: c0, r2: r, c2: c })); } catch {} });
          }
        } else {
          setTurnToast(!myTurn ? 'Not your turn' : "Can't move opponent piece"); setTimeout(() => setTurnToast(null), 900);
        }
        startTransition(()=>{ setSelected(null); setMoves([]); });
        return;
      }
    }
    // Otherwise, clicking a piece requests its legal moves only if it's yours and it's your turn
    if (cell) {
      if (playerColor && myTurn && cell.c === playerColor) {
        // Request server-validated legal moves (enforces check rules)
        startTransition(()=> setSelected({ r, c }));
        withOpenSocket(sock => { try { sock.send(JSON.stringify({ type: 'getMoves', r, c })); } catch {} });
        // Optional local fallback while waiting
        try { const local = genMoves(board, r, c) || []; startTransition(()=> setMoves(local)); } catch { setMoves([]); }
      } else {
        startTransition(()=>{ setSelected(null); setMoves([]); });
        setTurnToast(!myTurn ? 'Wait for your turn' : 'Select your own piece'); setTimeout(() => setTurnToast(null), 900);
      }
      return;
    }
    // Clicked empty, non-highlighted square: clear selection
    if (selected) { startTransition(()=>{ setSelected(null); setMoves([]); }); }
  }, [board, playerColor, selected, moves, withOpenSocket, currentColor, needsPromotion, isSocketOpen, applyLocalMove]);

  const onPromotionPick = useCallback((piece)=>{
    const req = promotionReq; if(!req){ return; }
    const promo = (piece||'q').toLowerCase();
    // Send to server; rely on authoritative update
    withOpenSocket(sock=>{ try{ sock.send(JSON.stringify({ type:'makeMove', r:req.from.r, c:req.from.c, r2:req.to.r2, c2:req.to.c2, promotion: promo })); }catch{} });
    setPromotionReq(null);
  },[promotionReq, withOpenSocket, isSocketOpen, applyLocalMove]);

  // Analyze position for check status and optional hint (non-forcing). Avoid local mate popups.
  useEffect(()=>{
    try{
      if(!board) return;
      const you = playerColor || currentColor; // show status from side to move if unknown
      const chkW = inCheck(board, 'w');
      const chkB = inCheck(board, 'b');
      setInCheckColor(chkW ? 'w' : (chkB ? 'b' : null));
      const ksq = chkW ? findKing(board,'w') : (chkB ? findKing(board,'b') : null);
      setCheckKingSquare(ksq);
      // Mate/stalemate detection for side to move
      const legals = legalMovesFor(board, currentColor);
      if(legals.length===0){
        // Let server authoritative update handle winner + overlay to avoid duplicate popups
        setHintMove(null);
        return;
      }
      // Only suggest when enabled and it's player's turn (non-forcing)
      if(showHints && playerColor && playerColor===currentColor){
        const rec = recommendMove(board, currentColor);
        setHintMove(rec);
      } else {
        setHintMove(null);
      }
    }catch{
      setInCheckColor(null); setCheckKingSquare(null); setHintMove(null);
    }
  }, [board, currentColor, playerColor, showHints]);

  // Raise a brief Check alert when the check state toggles
  const lastCheckRef = useRef(null);
  useEffect(()=>{
    const cur = inCheckColor; const prev = lastCheckRef.current;
    if(cur && cur!==prev && !winner){
      setAlertOverlay({ text:`Check on ${cur==='w'?'White':'Black'}`, kind:'check' });
      setTimeout(()=>setAlertOverlay(null), 1400);
    }
    lastCheckRef.current = cur;
  }, [inCheckColor, winner]);

  // Ensure page stops exactly at bottom (remove global bottom pad) while Chess screen is mounted
  useEffect(()=>{
    try{
      const cls = 'no-bottom-pad';
      const html = document.documentElement; const body = document.body; const root = document.getElementById('root');
      html && html.classList.add(cls); body && body.classList.add(cls); root && root.classList.add(cls);
      return ()=>{ html && html.classList.remove(cls); body && body.classList.remove(cls); root && root.classList.remove(cls); };
    }catch{}
  }, []);

  // When the full board is active, remove global bottom padding to avoid scroll
  useEffect(()=>{
    const cls = 'no-bottom-pad';
    try{
      const html = document.documentElement;
      const body = document.body;
      const root = document.getElementById('root');
      if(playerColor){
        html && html.classList.add(cls);
        body && body.classList.add(cls);
        root && root.classList.add(cls);
      } else {
        html && html.classList.add(cls);
        body && body.classList.add(cls);
        root && root.classList.add(cls);
      }
      return () => {
        html && html.classList.remove(cls);
        body && body.classList.remove(cls);
        root && root.classList.remove(cls);
      };
    }catch{ return; }
  }, [playerColor]);

  // Listen for global auth changes
  useEffect(()=>{
    const onChange = ()=> setAuthed(isAuthed());
    window.addEventListener('authchange', onChange);
    return ()=> window.removeEventListener('authchange', onChange);
  }, [isAuthed]);

  // Ensure opponent sees "waiting" when user navigates away via bottom nav
  useEffect(()=>{
    const handler = () => {
      try {
        const ws = wsRef.current; if(ws && ws.readyState===WebSocket.OPEN){
          // Notify server we are leaving/pausing before route change
          try { ws.send(JSON.stringify({ type:'leaveGame' })); } catch {}
          try { ws.close(1000, 'navigate'); } catch {}
        }
      } catch {}
    };
    window.addEventListener('game:beforeNavigate', handler);
    return () => window.removeEventListener('game:beforeNavigate', handler);
  }, []);

  const showOverlay = (!playerColor ? !authed : (!authed || !wsConnected));

  return (
  <div className="cf-screen cf-chess">
      <NavBar />
      <div className="nav-spacer" aria-hidden="true" />
      <main className={`app-content ${playerColor ? 'app-content--full' : ''}`}>
  {showOverlay && (<LoginOverlay />)}
        {!playerColor ? (
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
                  joinLabel="Join Game"
                  onJoin={onJoin}
                  joinDisabled={!username}
                  avatarId={avatarId}
                  avatarGlyph={findAvatar(avatarId).glyph}
                  onOpenAvatarModal={()=> setShowAvatarModal(true)}
                  colors={NEON_PALETTE}
                  selectedColor={myPieceColor}
                  onPickColor={(v)=>{ setMyPieceColor(v); localStorage.setItem('chesTint', v); withOpenSocket(sock=>{ try{ sock.send(JSON.stringify({ type:'setPieceColor', pieceColor: v })); }catch{} }); }}
                  footerExtra={(
                    <>
                      <div className="d-flex align-items-center justify-content-between mb-1">
                        <div className="fw-bold">Reconnect & Continue</div>
                        <div>
                          <Button size="sm" variant="outline-light" onClick={()=>{
                            const nm=(username||'').toString().slice(0,40);
                            if(!nm){ alert('Set a username to fetch your saved games.'); return; }
                            if(wsRef.current && wsRef.current.readyState===WebSocket.OPEN){
                              try{ wsRef.current.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{}
                            } else { connectWSRef.current(false); }
                          }}>Refresh</Button>
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
                                      connectWSRef.current(false);
                                      setShowMatch(true);
                                      setPairedInfo(null);
                                    }}><i className="bi bi-play-fill me-1" />Continue</Button>
                                    <Button size="sm" variant="outline-danger" className="fw-semibold" onClick={()=>{
                                      const nm=(username||'').toString().slice(0,40);
                                      if(!nm) { alert('Set a username first.'); return; }
                                      try{ setServerSaved(prev => Array.isArray(prev) ? prev.filter(x=>x.gameId!==s.gameId) : prev); }catch{}
                                      const ws=wsRef.current;
                                      if(ws && ws.readyState===WebSocket.OPEN){
                                        try{ ws.send(JSON.stringify({ type:'finishSavedGame', gameId: s.gameId, username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{}
                                      } else { connectWSRef.current(false); setTimeout(()=>{ if(wsRef.current&&wsRef.current.readyState===WebSocket.OPEN){ try{ wsRef.current.send(JSON.stringify({ type:'finishSavedGame', gameId: s.gameId, username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} } }, 250); }
                                    }}><i className="bi bi-check2-circle me-1" />Finish</Button>
                                  </div>
                                </div>
                              ); })()}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                >
                  <div className="small text-secondary">

                    <div className="mb-2">
                      <Form.Label className="fw-bold">Hints</Form.Label>
                      <div className="d-flex gap-2 flex-wrap">
                        <Button variant={!showHints ? 'light':'outline-light'} size="sm" onClick={()=>{ setShowHints(false); localStorage.setItem('chesHints','0'); }}>Off</Button>
                        <Button variant={showHints ? 'light':'outline-light'} size="sm" onClick={()=>{ setShowHints(true); localStorage.setItem('chesHints','1'); }}>On</Button>
                      </div>
                      <div className="small text-secondary mt-1">Non-forcing suggestions only when it's your turn.</div>
                    </div>
                  </div>
                </GameSetup>
                {/* Bottom spacer so the last saved card isn't flush with the screen edge */}
                <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 18px)' }} />
            </div>
          </div>
        ) : (
          <div className="board-fullwrap">
            <div className="badge-row">
              <span className="badge-chip"><span className="mm-swab" style={{background: pieceColors?.w || '#e5e7eb'}}/> {(pairedInfo?.usernames?.['w']||'White')} ({scores['w']})</span>
              <span className="badge-chip"><span className="mm-swab" style={{background: pieceColors?.b || '#111827'}}/> {(pairedInfo?.usernames?.['b']||'Black')} ({scores['b']})</span>
              <span className="badge-chip" style={{background:'rgba(255,255,255,.08)'}}>W ✚{material.w||0} · B ✚{material.b||0}</span>
              {winner ? (
                <span className="badge-chip" style={{background:'rgba(34,197,94,.25)'}}> {winner==='draw' ? 'Draw' : (winner==='w'?'White':'Black') + ' wins!'} </span>
              ) : (
                <>
                  <span className="badge-chip" style={{background:'rgba(255,255,255,.20)'}}>
                    {currentColor === playerColor ? 'Your turn' : 'Opponent turn'}
                  </span>
                  {pairedInfo?.mode && (
                    <span className="badge-chip" style={{background:'rgba(255,255,255,.12)'}}>
                      Mode: {pairedInfo.mode==='free' ? 'Free-Play' : 'Strict'}
                    </span>
                  )}
                  <span className="badge-chip" style={{background:'rgba(255,255,255,.12)'}} onClick={()=>{ const nv=!showHints; setShowHints(nv); localStorage.setItem('chesHints', nv?'1':'0'); }}>
                    Hints: {showHints?'On':'Off'}
                  </span>
                  {inCheckColor && (
                    <span className="badge-chip" style={{background:'rgba(239,68,68,.25)'}}>Check on {inCheckColor==='w'?'White':'Black'}</span>
                  )}
                  {hintMove && (
                    <span className="badge-chip" style={{background:'rgba(34,197,94,.20)'}}>
                      Hint: {toAlg(hintMove.from.r, hintMove.from.c)}→{toAlg(hintMove.to.r2, hintMove.to.c2)}
                    </span>
                  )}
                </>
              )}
            </div>
              <div className="board-shell">
              {(() => {
                const useVector = (()=>{
                  try{
                    const qs = new URLSearchParams(window.location.search);
                    const raw = (qs.get('vector') || localStorage.getItem('vector') || '').toLowerCase();
                    if(raw==='1' || raw==='true' || raw==='on') return true;   // explicit on
                    if(raw==='0' || raw==='false' || raw==='off') return false; // explicit off
                    // Default: vector OFF on mobile (per request), OFF on desktop
                    return false;
                  }catch{ return false; }
                })();
                if(useVector){
                  const prefer3DVector = true; // default to 3D vector on mobile
                  if(prefer3DVector){
                    return (
                      <div style={{width:'100%', height:'100%'}}>
                        <ChessVector3D
                          board={board}
                          myColor={playerColor}
                          lastMove={lastMove}
                          onCellClick={handleCellClick}
                          selected={selected}
                          moves={moves}
                          pieceColors={pieceColors}
                          hint={hintMove}
                          checkKing={checkKingSquare}
                        />
                      </div>
                    );
                  }
                  // Fallback: 2D vector
                  return (
                    <ChessVectorBoard
                      board={board}
                      myColor={playerColor}
                      lastMove={lastMove}
                      onCellClick={handleCellClick}
                      selected={selected}
                      moves={moves}
                      pieceColors={pieceColors}
                      hint={hintMove}
                      checkKing={checkKingSquare}
                    />
                  );
                }
                const bMemo = board; const selMemo = selected; const mvMemo = moves; const pcMemo = pieceColors;
                return (
                  <Board3D
                    board={bMemo}
                    myColor={playerColor}
                    lastMove={lastMove}
                    onCellClick={handleCellClick}
                    selected={selMemo}
                    moves={mvMemo}
                    pieceColors={pcMemo}
                    shadowStrength={shadowStrength}
                    pieceGlow={pieceGlow}
                    hint={hintMove}
                    checkKing={checkKingSquare}
                  />
                );
              })()}
            </div>
            <QuickChat
              onSend={(text)=>{
                const raw = String(text||'').trim();
                const t = raw.slice(0,80);
                const cmd = t.toLowerCase();
                if (cmd==='undo' || cmd==='classic' || cmd==='off' || cmd==='radar off' || cmd==='radar:off') {
                  try{ localStorage.setItem('radarSweep','off'); }catch{}
                  try{ window.location.reload(); }catch{}
                  return;
                }
                if (cmd==='radar' || cmd==='on' || cmd==='radar on' || cmd==='radar:on') {
                  try{ localStorage.setItem('radarSweep','on'); }catch{}
                  try{ window.location.reload(); }catch{}
                  return;
                }
                withOpenSocket(sock=>{ try{ sock.send(JSON.stringify({ type:'quickChat', text:t })); }catch{} });
              }}
              messages={chatFeed}
              youKey="you"
              align="right"
              canSend={!!playerColor && wsConnected}
            />
            {promotionReq && (
              <div className="match-overlay" onClick={()=>setPromotionReq(null)}>
                <div className="match-card" onClick={(e)=>e.stopPropagation()}>
                  <div className="match-header">
                    <div className="fw-800">Promote Pawn</div>
                    <button className="mm-cancel" onClick={()=>setPromotionReq(null)}>Close</button>
                  </div>
                  <div className="p-3 d-flex gap-2 justify-content-center">
                    <Button variant="light" onClick={()=>onPromotionPick('q')}>Queen</Button>
                    <Button variant="outline-light" onClick={()=>onPromotionPick('r')}>Rook</Button>
                    <Button variant="outline-light" onClick={()=>onPromotionPick('b')}>Bishop</Button>
                    <Button variant="outline-light" onClick={()=>onPromotionPick('n')}>Knight</Button>
                  </div>
                </div>
              </div>
              )}
            {(() => {
              try{
                const youCol = (playerColor || (pairedInfo?.you===2?'b':'w') || null);
                const oppCol = youCol ? (youCol==='w' ? 'b' : 'w') : null;
                const oppMissing = !!(youCol && oppCol && presence && presence[oppCol]===false);
                return (<WaitingOverlay show={oppMissing} />);
              }catch{return null;}
            })()}
            
            {turnToast && <div className="turn-toast">{turnToast}</div>}
            {alertOverlay && (
              <div style={{position:'fixed', inset:0, zIndex:1050, display:'grid', placeItems:'center', pointerEvents:'none'}}>
                <div style={{
                  background: alertOverlay.kind==='check' ? 'radial-gradient(closest-side, rgba(239,68,68,.92), rgba(239,68,68,.55), rgba(2,6,23,.0))'
                           : alertOverlay.kind==='checkmate' ? 'radial-gradient(closest-side, rgba(250,204,21,.92), rgba(250,204,21,.55), rgba(2,6,23,.0))'
                           : 'radial-gradient(closest-side, rgba(34,211,238,.92), rgba(34,211,238,.55), rgba(2,6,23,.0))',
                  padding:'16px 24px', borderRadius:16, boxShadow:'0 14px 36px rgba(0,0,0,.50)',
                  color:'#04131a', fontWeight:900, fontSize:24, textShadow:'0 1px 0 rgba(255,255,255,.66)',
                  border:'2px solid rgba(255,255,255,.65)'
                }}>{alertOverlay.text}</div>
              </div>
            )}
            {turnOverlayText && (
              <div style={{position:'fixed', inset:0, zIndex:1040, display:'grid', placeItems:'center', pointerEvents:'none'}}>
                <div style={{
                  background:'radial-gradient(closest-side, rgba(34,211,238,.92), rgba(34,211,238,.55), rgba(2,6,23,.0))',
                  padding:'14px 22px', borderRadius:14, boxShadow:'0 10px 30px rgba(0,0,0,.45)',
                  color:'#04131a', fontWeight:900, fontSize:22, textShadow:'0 1px 0 rgba(255,255,255,.66)',
                  border:'2px solid rgba(255,255,255,.6)'
                }}>{turnOverlayText}</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Matchmaking modal */}
      {showMatch && (
        <div className="match-overlay">
          <div className="match-card">
            <div className="match-header">
              <div className="fw-800">Matchmaking</div>
              <button className="mm-cancel" onClick={onCancelQueue}>Cancel</button>
            </div>
            <div className="match-body">
              {(() => {
                const paired = !!pairedInfo;
                const youCol = (pairedInfo?.you===2?'b':'w');
                const oppCol = youCol==='w' ? 'b' : 'w';
                const youName = (pairedInfo?.usernames?.[youCol]) || (username || 'You');
                const oppName = pairedInfo?.usernames?.[oppCol] || 'Searching…';
                const youColor = paired ? (pieceColors?.[youCol] || (youCol==='w'?'#e5e7eb':'#111827')) : (myPieceColor || '#22d3ee');
                const oppColor = paired ? (pieceColors?.[oppCol] || (oppCol==='w'?'#e5e7eb':'#111827')) : '#111827';
                const youStake = pairedInfo?.stakes?.[youCol] ?? Number(stakeSC) ?? 0;
                const oppStake = pairedInfo?.stakes?.[oppCol];
                const youAv = (pairedInfo?.avatars?.[youCol]) || youAvatar || avatarId;
                const oppAv = (pairedInfo?.avatars?.[oppCol]) || oppAvatar || null;
                return (
                  <>
                    <div className="match-col">
                      <div className="mm-avatar" title="Your avatar"><Avatar id={youAv} size={86} /></div>
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
              })()}
            </div>
            <div className="p-3 text-center text-secondary">
              {pairedInfo ? (
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

      {/* Avatar Picker Overlay */}
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
    </div>
  );
}
