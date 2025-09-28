/* eslint-disable no-console */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { Button } from 'react-bootstrap';
import GameSetup from '../../common/GameSetup';
import NavBar from '../../NavBar';
import './CheckersScreen.css';
import LoginOverlay from '../../common/LoginOverlay';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import QuickChat from '../common/QuickChat';
import WaitingOverlay from '../common/WaitingOverlay';

const SIZE = 8;
THREE.Cache.enabled = true;
// Simple module-level cache for the checker piece GLB to avoid reloading
let CHECKER_PIECE_SCENE = null;
let CHECKER_PIECE_PROMISE = null;
function loadCheckerPiece() {
  if (CHECKER_PIECE_SCENE) return Promise.resolve(CHECKER_PIECE_SCENE);
  if (!CHECKER_PIECE_PROMISE) {
    const loader = new GLTFLoader();
    CHECKER_PIECE_PROMISE = new Promise((resolve, reject) => {
      try {
        loader.load('/models/checkers/piece.glb', (gltf) => {
          CHECKER_PIECE_SCENE = gltf.scene;
          resolve(CHECKER_PIECE_SCENE);
        }, undefined, (err) => reject(err));
      } catch (e) { reject(e); }
    });
  }
  return CHECKER_PIECE_PROMISE;
}

// API + wallet helpers (parity with Chess/C4)
const API = (()=>{ const { protocol, hostname } = window.location; const envHost=(process.env.REACT_APP_SERVER_HOST||'').trim(); const winHost=(window.SERVER_HOST?String(window.SERVER_HOST).trim():''); let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{} const host=envHost||winHost||lsHost||hostname; return process.env.REACT_APP_API_BASE || `${protocol}//${host}:3002`; })();
function authFetch(path, options = {}) { const token = localStorage.getItem('token') || ''; return fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers||{}), ...(token?{ Authorization:`Bearer ${token}`}:{}), }, }); }
async function scAdjust(delta, memo = '') { const r = await authFetch('/sc/adjust', { method:'POST', body: JSON.stringify({ delta:Number(delta), memo }) }); const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j?.message||'SC adjust failed'); return j; }
async function getBalance(){ const r = await authFetch('/balance'); const j = await r.json().catch(()=>({sc_balance:0})); return Number(j.sc_balance)||0; }
const getWsUrl = () => {
  const { protocol, hostname } = window.location; const proto = protocol === 'https:' ? 'wss' : 'ws';
  if (process.env.REACT_APP_UNIFIED_WS === '1'){
    try{ const u=new URL(API); const wsProto=u.protocol==='https:'?'wss':'ws'; return `${wsProto}://${u.host}/ws/checkers`; }catch{ return `${proto}://${hostname}:3002/ws/checkers`; }
  }
  const envHost=(process.env.REACT_APP_SERVER_HOST||'').trim(); const winHost=(window.SERVER_HOST?String(window.SERVER_HOST).trim():''); let lsHost=''; try{ lsHost=(localStorage.getItem('serverHost')||'').trim(); }catch{} const host=envHost||winHost||lsHost||hostname; return `${proto}://${host}:3011`;
};

// Default piece positioning/scaling for Checkers pieces
const CHECKER_PIECE_DEFAULTS = Object.freeze({ yOffset: -0.505, yScale: 1, zOffset: 0.12, xzScale: 0.75 });

// Minimal checkers client helpers
function initBoard(){
  const b = Array.from({length:SIZE},()=>Array(SIZE).fill(null));
  for(let r=0;r<3;r++){ for(let c=0;c<SIZE;c++){ if((r+c)%2===1) b[r][c]={ owner:'Player 2', king:false }; } }
  for(let r=SIZE-3;r<SIZE;r++){ for(let c=0;c<SIZE;c++){ if((r+c)%2===1) b[r][c]={ owner:'Player 1', king:false }; } }
  return b;
}
function validMoves(board, r, c, role){
  const cell = board?.[r]?.[c]; if(!cell) return [];
  const dirs = [];
  if(cell.king || role==='Player 1') dirs.push([-1,-1],[-1,1]);
  if(cell.king || role==='Player 2') dirs.push([1,-1],[1,1]);
  const inside=(rr,cc)=> rr>=0&&rr<SIZE&&cc>=0&&cc<SIZE;
  const res=[];
  for(const [dr,dc] of dirs){
    const r1=r+dr, c1=c+dc; if(inside(r1,c1) && !board[r1][c1]) res.push({ r2:r1, c2:c1 });
    const r2=r+2*dr, c2=c+2*dc; if(inside(r2,c2) && !board[r2][c2]){ const mid=board[r1]?.[c1]; if(mid && mid.owner!==cell.owner) res.push({ r2,c2,capture:true }); }
  }
  return res;
}

function AnimatedPiece({ to=[0,0,0], from, children, speed=10, lift=0.10, onSettled }){
  const ref = useRef();
  const prevTo = useRef([NaN,NaN,NaN]);
  const startRef = useRef([0,0,0]);
  const endRef = useRef([0,0,0]);
  const totalXZRef = useRef(0.000001);
  const target = to;
  const nearlyEq = (a,b,eps=1e-4)=> Math.abs(a[0]-b[0])<eps && Math.abs(a[1]-b[1])<eps && Math.abs(a[2]-b[2])<eps;
  const distXZ = (a,b)=>{ const dx=(a[0]-b[0]); const dz=(a[2]-b[2]); return Math.sqrt(dx*dx+dz*dz); };
  useEffect(()=>{
    const f = from; const t = to;
    const toChanged = !nearlyEq(prevTo.current, t);
    if(ref.current && (toChanged || f)){
      if(f) ref.current.position.set(f[0], f[1], f[2]);
      const start = f ? [f[0],f[1],f[2]] : [ref.current.position.x, ref.current.position.y, ref.current.position.z];
      const end = [t[0], t[1], t[2]];
      startRef.current = start; endRef.current = end;
      totalXZRef.current = Math.max(0.000001, distXZ(start, end));
      prevTo.current = [...t];
    }
  }, [from, to]);
  useFrame((_, dt)=>{
    if(!ref.current) return;
    const p = ref.current.position;
    const smooth = Math.max(1, Number(speed)||10);
    p.x = THREE.MathUtils.damp(p.x, target[0], smooth, dt);
    p.z = THREE.MathUtils.damp(p.z, target[2], smooth, dt);
    const start = startRef.current, end = endRef.current;
    const total = totalXZRef.current;
    const remain = distXZ([p.x, 0, p.z], end);
    const lin = THREE.MathUtils.clamp(1 - (remain/total), 0, 1);
    const prog = lin*lin*(3-2*lin);
    const yBase = THREE.MathUtils.lerp(start[1], end[1], prog);
    const bump = lift>0 ? (lift * 4 * prog * (1-prog)) : 0;
    p.y = yBase + bump;
    if(Math.abs(target[0]-p.x)<1e-3 && Math.abs(target[1]-p.y)<1e-3 && Math.abs(target[2]-p.z)<1e-3){
      p.set(target[0], target[1], target[2]);
      onSettled && onSettled();
    }
  });
  return <group ref={ref} frustumCulled={false}>{children}</group>;
}

function CheckerPiece({ color = '#ef4444', king = false, selected = false, userYScale = 1, userXZScale = 1, userZOffset = 0 }){
  const [model, setModel] = React.useState(null);
  const [pieceHeight, setPieceHeight] = React.useState(0.12);
  const baseScaleRef = React.useRef(new THREE.Vector3(1,1,1));
  const pulseRef = React.useRef(null);

  // Load and cache the GLB; clone for this instance
  React.useEffect(() => {
    let mounted = true;
    loadCheckerPiece()
      .then((scene) => {
        if (!mounted || !scene) return;
        const clone = scene.clone(true);
        // initial material setup
        clone.traverse((obj) => {
          if (obj && obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            if (obj.material && (obj.material.isMeshStandardMaterial || obj.material.isMeshPhysicalMaterial)) {
              obj.material = obj.material.clone();
              obj.material.metalness = 0.25;
              obj.material.roughness = 0.38;
              // slight emissive so pulse is visible
              try{ obj.material.emissive = new THREE.Color(color); obj.material.emissiveIntensity = 0.06; }catch{}
            }
          }
        });

        // Fit the model to the 1x1 tile footprint: target diameter ~0.96, height ~0.14
        try {
          // 1) Initial size
          const bbox0 = new THREE.Box3().setFromObject(clone);
          const size0 = new THREE.Vector3();
          bbox0.getSize(size0);
          const widthXZ0 = Math.max(size0.x || 1, size0.z || 1);
          const targetDia = 1.10; // overshoot to counter any GLB padding
          const targetH = 0.14;   // slim checker height
          const sDia0 = widthXZ0 > 0 ? (targetDia / widthXZ0) : 1;
          const sH0 = (size0.y && size0.y > 0) ? (targetH / size0.y) : 1;
          const sx0 = sDia0, sz0 = sDia0, sy0 = sH0;
          if ([sx0,sy0,sz0].every(v => Number.isFinite(v) && v > 0 && v < 100)) {
            clone.scale.set(sx0, sy0, sz0);
          }

          // 2) Center horizontally after scaling
          const bbox1 = new THREE.Box3().setFromObject(clone);
          const center1 = new THREE.Vector3();
          bbox1.getCenter(center1);
          clone.position.x += -center1.x;
          clone.position.z += -center1.z;

          // 3) Align base to y=0
          const bbox2 = new THREE.Box3().setFromObject(clone);
          const size2 = new THREE.Vector3();
          bbox2.getSize(size2);
          const bottom2 = bbox2.min.y;
          if (Number.isFinite(bottom2)) {
            clone.position.y += -bottom2;
          }

          // 4) Final boost to ensure diameter is close to 0.98 without exceeding max height
          const finalTargetDia = 1.40; // aggressive to fight padded bounds
          const maxH = 0.20;           // allow a bit taller if needed
          const bbox3 = new THREE.Box3().setFromObject(clone);
          const size3 = new THREE.Vector3();
          bbox3.getSize(size3);
          const curDia = Math.max(size3.x || 1, size3.z || 1);
          const needBoost = (curDia > 0) ? (finalTargetDia / curDia) : 1;
          const maxBoostY = (size3.y && size3.y > 0) ? (maxH / size3.y) : 1;
          const boostXZ = needBoost;
          const boostY = Math.min(needBoost, maxBoostY);
          if ([boostXZ, boostY].every(v => Number.isFinite(v) && v > 0 && v < 100)) {
            clone.scale.set(clone.scale.x * boostXZ, clone.scale.y * boostY, clone.scale.z * boostXZ);
          }

          // 5) Re-align base after boost
          const bbox4 = new THREE.Box3().setFromObject(clone);
          const size4 = new THREE.Vector3();
          bbox4.getSize(size4);
          const bottom4 = bbox4.min.y;
          if (Number.isFinite(bottom4)) {
            clone.position.y += -bottom4;
          }
          setPieceHeight(size4.y || 0.12);

          // 6) User adjustment: 35% smaller (XZ) and 10% taller (Y)
          const adjXZ = 0.65; // 35% smaller
          const adjY = 4.00;  // 300% taller (i.e., 4x height)
          clone.scale.set(clone.scale.x * adjXZ, clone.scale.y * adjY, clone.scale.z * adjXZ);
          // Re-align base after relative adjustment
          const bbox5 = new THREE.Box3().setFromObject(clone);
          const size5 = new THREE.Vector3();
          bbox5.getSize(size5);
          const bottom5 = bbox5.min.y;
          if (Number.isFinite(bottom5)) {
            clone.position.y += -bottom5;
          }
          setPieceHeight(size5.y || size4.y || 0.12);
          // Remember the final base scale to support dynamic Y scaling without compounding
          baseScaleRef.current = clone.scale.clone();
        } catch {}
        setModel(clone);
        pulseRef.current = clone;
      })
      .catch(() => setModel(null));
    return () => { mounted = false; };
  }, []);

  // Apply dynamic Y-scale from user control; re-align base and recompute crown height
  React.useEffect(() => {
    if (!model || !baseScaleRef.current) return;
    try {
      const base = baseScaleRef.current;
      const sxz = Math.max(0.05, Number(userXZScale)||1);
      const sy  = Math.max(0.05, Number(userYScale)||1);
      model.scale.set(base.x * sxz, base.y * sy, base.z * sxz);
      // re-align base to y=0 after scaling
      const bbox = new THREE.Box3().setFromObject(model);
      const bottom = bbox.min.y;
      if (Number.isFinite(bottom)) {
        model.position.y += -bottom;
      }
      const size = new THREE.Vector3();
      bbox.getSize(size);
      setPieceHeight(size.y || pieceHeight);
    } catch {}
  }, [model, userYScale, userXZScale]);

  // Retint on color change
  React.useEffect(() => {
    if (!model) return;
    try {
      model.traverse((obj) => {
        if (obj && obj.isMesh && obj.material && (obj.material.isMeshStandardMaterial || obj.material.isMeshPhysicalMaterial)) {
          obj.material.color = new THREE.Color(color);
          try{ obj.material.emissive = new THREE.Color(color); }catch{}
        }
      });
    } catch {}
  }, [model, color]);

  // Pulse like Chess: modulate emissiveIntensity over time
  useFrame(({ clock }) => {
    const root = pulseRef.current; if(!root) return;
    const t = clock.getElapsedTime();
    const base = 0.05; // similar to Chess
    const amp = 0.06;
    const e = base + amp * Math.sin(t/2.8);
    try{
      root.traverse(o => { const m = o && o.material; if(m && 'emissiveIntensity' in m){ m.emissiveIntensity = e; } });
    }catch{}
  });

  // Fallback: render a simple cylinder if model missing
  if (!model) {
    return (
      <group>
        <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.12, 32]} />
          <meshStandardMaterial color={color} metalness={0.2} roughness={0.35} />
        </mesh>
        {selected && (
          <mesh position={[0, 0.12, 0]}>
            <torusGeometry args={[0.46, 0.03, 12, 32]} />
            <meshStandardMaterial color={'#fbbf24'} emissive={'#f59e0b'} emissiveIntensity={0.6} />
          </mesh>
        )}
        {king && (
          <mesh position={[0, 0.16, 0]}>
            <torusGeometry args={[0.3, 0.04, 12, 32]} />
            <meshStandardMaterial color={'#eab308'} emissive={'#f59e0b'} emissiveIntensity={0.5} />
          </mesh>
        )}
      </group>
    );
  }

  // Decorative crown for kings: torus base + 5 cones
  const Crown = ({ y = Math.max(0.16, pieceHeight * 0.92) }) => (
    <group position={[0, y, 0]}>
      <mesh>
        <torusGeometry args={[0.26, 0.035, 12, 28]} />
        <meshStandardMaterial color={'#eab308'} emissive={'#f59e0b'} emissiveIntensity={0.4} metalness={0.45} roughness={0.35} />
      </mesh>
      {Array.from({ length: 5 }).map((_, i) => {
        const ang = (i / 5) * Math.PI * 2;
        const rx = Math.cos(ang) * 0.22;
        const rz = Math.sin(ang) * 0.22;
        return (
          <mesh key={i} position={[rx, 0.08, rz]} rotation={[-Math.PI * 0.08, ang, 0]} castShadow>
            <coneGeometry args={[0.08, 0.16, 12]} />
            <meshStandardMaterial color={'#facc15'} emissive={'#f59e0b'} emissiveIntensity={0.35} metalness={0.5} roughness={0.3} />
          </mesh>
        );
      })}
    </group>
  );

  return (
    <group>
      {/* Center the model at tile center; model is already scaled to tile */}
  <group position={[0, 0.05, 0]}>
        {/* eslint-disable-next-line react/no-unknown-property */}
        <primitive object={model} />
      </group>
      {selected && (
        <mesh position={[0, 0.12, 0]}>
          <torusGeometry args={[0.46 * Math.max(0.05, Number(userXZScale)||1), 0.03, 12, 32]} />
          <meshStandardMaterial color={'#fbbf24'} emissive={'#f59e0b'} emissiveIntensity={0.6} />
        </mesh>
      )}
      {king && <Crown />}
    </group>
  );
}

function Board3D({ board, lastMove, myRole, onCellClick, selected, moves, colors, pieceYOffset = 0, pieceYScale = 1, pieceZOffset = 0, pieceXZScale = 1 }){
  const tile = 1;
  const isNarrow = (()=>{ try{ return typeof window!== 'undefined' && window.matchMedia('(max-width: 640px)').matches; }catch{return false;} })();
  const camPos  = isNarrow ? [3.5, 12.0, 16.2] : [3.5, 9.5, 12.8];
  const camFov  = isNarrow ? 54 : 40;
  const minDist = isNarrow ? 10 : 9;
  const maxDist = isNarrow ? 20 : 14;
  const minPolar = isNarrow ? 0.06 : 0.08;
  const maxPolar = isNarrow ? Math.PI*0.42 : Math.PI*0.40;
  const azimuthRange = Math.PI * 0.50;
  const minAz = -azimuthRange;
  const maxAz =  azimuthRange;
  const isMobile = isNarrow;

  // Chess-like neon constants
  const NEON_BG_OUTER = '#030712';
  const NEON_BG_INNER = '#0b0f1a';
  const NEON_TILE_LIGHT = '#22d3ee';
  const NEON_TILE_DARK  = '#8b5cf6';

  // Derive dimmed pulse palette from players' chosen colors (colors prop)
  const pulsePalette = useMemo(()=>{
    try{
      const cP1 = colors?.['Player 1'] || null; // usually your side if P1
      const cP2 = colors?.['Player 2'] || null;
      const fallback1 = '#22d3ee';
      const fallback2 = '#a78bfa';
      const toward = new THREE.Color('#05060a');
      const dim = (hex)=>{ try{ const c=new THREE.Color(hex); return c.lerp(toward, 0.55).getStyle(); }catch{ return null; } };
  const dP1 = dim(cP1) || fallback1;
  const dP2 = dim(cP2) || fallback2;
  // Piece colors are swapped when rendering; match sweep to visible piece colors
  const you = myRole === 'Player 2' ? dP1 : dP2; // P2 sees P1 color on their pieces after swap
  const opp = myRole === 'Player 2' ? dP2 : dP1;
      return { c1: you, c2: opp, sweepLight: you, sweepDark: opp };
    }catch{ return { c1:'#22d3ee', c2:'#a78bfa', sweepLight:'#22d3ee', sweepDark:'#8b5cf6' }; }
  }, [colors, myRole]);

  // Radar sweep: highlight tiles you can move to with your color during the sweep
  function readRadarEnabled(){
    try{
      const qs=new URLSearchParams(window.location.search);
      const q=(qs.get('radar')||'').toLowerCase();
      if(q==='0'||q==='off'||q==='false') return false;
      if(q==='1'||q==='on'||q==='true') return true;
      const ls=(localStorage.getItem('radarSweep')||'').toLowerCase();
      if(ls==='0'||ls==='off'||ls==='false') return false;
      if(ls==='1'||ls==='on'||ls==='true') return true;
      return true; // default on
    }catch{ return true; }
  }
  const RADAR_ON = useMemo(()=> readRadarEnabled(), []);
  const radarReach = useMemo(()=>{
    if(!RADAR_ON) return null;
    try{
      const sP1 = new Set();
      const sP2 = new Set();
      const add=(s,r,c)=> s.add(`${r}-${c}`);
      for(let r=0;r<SIZE;r++){
        for(let c=0;c<SIZE;c++){
          const cell = board?.[r]?.[c]; if(!cell) continue;
          if(cell.owner==='Player 1'){
            const mv = validMoves(board, r, c, 'Player 1');
            for(const m of (mv||[])) add(sP1, m.r2, m.c2);
          } else if(cell.owner==='Player 2'){
            const mv = validMoves(board, r, c, 'Player 2');
            for(const m of (mv||[])) add(sP2, m.r2, m.c2);
          }
        }
      }
      return { P1: sP1, P2: sP2 };
    }catch{ return null; }
  }, [board, RADAR_ON]);

  // Cursor tracker for cursor-follow glow (like Chess)
  const cursorRef = useRef({ active:false, x:0, z:0 });
  function CursorPointer(){
    const { gl, camera, size } = useThree();
    useEffect(()=>{
      const el = gl.domElement; if(!el) return;
      const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0); // y=0
      const raycaster = new THREE.Raycaster();
      const onMove = (ev)=>{
        try{
          const rect = el.getBoundingClientRect();
          const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
          const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
          raycaster.setFromCamera({ x, y }, camera);
          const pt = new THREE.Vector3();
          raycaster.ray.intersectPlane(plane, pt);
          const px = THREE.MathUtils.clamp(pt.x, 0, SIZE-1);
          const pz = THREE.MathUtils.clamp(pt.z, 0, SIZE-1);
          cursorRef.current.x = px; cursorRef.current.z = pz; cursorRef.current.active = true;
        }catch{ cursorRef.current.active = false; }
      };
      const onLeave = ()=>{ cursorRef.current.active = false; };
      el.addEventListener('pointermove', onMove, { passive: true });
      el.addEventListener('pointerleave', onLeave, { passive: true });
      return ()=>{ el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); };
    }, [gl, camera, size]);
    return null;
  }

  // Global LED sweep controller (mirrors Chess)
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
    const p00 = 0*dx + 0*dz;
    const p10 = SIZE*dx + 0*dz;
    const p01 = 0*dx + SIZE*dz;
    const p11 = SIZE*dx + SIZE*dz;
    const minProj = Math.min(p00,p10,p01,p11);
    const maxProj = Math.max(p00,p10,p01,p11);
    const margin = 1.5;
    s.min = minProj - margin; s.max = maxProj + margin;
    const T = globalLedPeriodRef.current || 10;
    const span = s.max - s.min;
    s.speed = span / (T * SIZE);
    s.head = s.min;
    s.sigma = 0.70 + Math.random()*0.30;
    s.amp = 0.16 + Math.random()*0.08;
  }
  useEffect(()=>{ const T = readGlobalLedPeriodSec(); globalLedPeriodRef.current = T; setSweepAngle(Math.random()*Math.PI*2); },[]);
  function SweepController(){ useFrame((_,dt)=>{ const s=sweepRef.current; s.head += (dt||0) * s.speed * SIZE; if(s.head > s.max){ setSweepAngle(Math.random()*Math.PI*2); } }); return null; }

  // LED strips across grid (like Chess GridLEDs)
  function GridLEDs({ animated=true, pulseSlow=false, c1=pulsePalette.c1, c2=pulsePalette.c2 }){
    const strips = [];
    const mobile = (()=>{ try{ return typeof window!=='undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches); }catch{return false;} })();
    const th = mobile ? 0.08 : 0.06;
    for(let re=0; re<=SIZE; re++){
      for(let c=0; c<SIZE; c++) strips.push({ kind:'H', x: c, z: re-0.5, w:1, d: th, key:`H-${re}-${c}` });
    }
    for(let ce=0; ce<=SIZE; ce++){
      for(let r=0; r<SIZE; r++) strips.push({ kind:'V', x: ce-0.5, z: r, w: th, d: 1, key:`V-${ce}-${r}` });
    }
  const stripMat = React.useMemo(()=> new THREE.MeshStandardMaterial({ color:(c1||'#22d3ee'), emissive:(c1||'#22d3ee'), emissiveIntensity:0.8 }), [c1]);
  const haloMat  = React.useMemo(()=> new THREE.MeshBasicMaterial({ color:(c1||'#22d3ee'), transparent:true, opacity:0.42, blending:THREE.AdditiveBlending, depthWrite:false }), [c1]);
    function StripLED({ x, z, w, d }){
      return (
        <group position={[x, 0.012, z]} raycast={() => null}>
          <mesh material={stripMat}><boxGeometry args={[w, 0.012, d]} /></mesh>
          <mesh renderOrder={-1} material={haloMat}><boxGeometry args={[w*1.25, 0.004, d*1.25]} /></mesh>
        </group>
      );
    }
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
        const budget = pulseSlow ? 1/12 : 1/28; if (t - lastRef.current < budget) return; lastRef.current = t;
        const baseT = Math.max(0.001, periodRef.current);
        const T = pulseSlow ? Math.max(6, baseT * 1.8) : (baseT * 1.2);
        const wv = (2*Math.PI)/T;
        const blendT = 0.5 + 0.5*Math.sin(wv*t);
        blendRef.current.copy(c1Ref.current).lerp(c2Ref.current, blendT);
        const base = pulseSlow ? 0.22 : 0.24;
        const amp  = pulseSlow ? 0.28 : 0.42;
        const s = Math.sin(wv*t*0.8);
        const e = base + amp * (0.5 + 0.5*s);
        if (stripMat) { stripMat.color.copy(blendRef.current); stripMat.emissive.copy(blendRef.current); stripMat.emissiveIntensity = e; stripMat.needsUpdate = true; }
        if (haloMat)  { haloMat.color.copy(blendRef.current); haloMat.opacity = (pulseSlow ? 0.28 : 0.34) + (pulseSlow ? 0.22 : 0.36)*(0.5 + 0.5*s); haloMat.needsUpdate = true; }
      });
      return null;
    }
    return (
      <group raycast={() => null}>
        {animated && <StripLEDController />}
        {strips.map(s => <StripLED key={s.key} x={s.x} z={s.z} w={s.w} d={s.d} />)}
      </group>
    );
  }


  // Animated tile exactly like Chess
  const Tile = React.memo(function Tile({ r, c, isDark, isLast, isMove, isSelTile, onClick, pulse, radar }){
    const matRef = useRef();
    const baseColor = isDark ? '#0a0f1d' : '#0b1326';
    const x = c*tile, z = r*tile;
    const phase = (r*0.35 + c*0.23);
    const isMobileTile = useMemo(()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} },[]);
  const c1Ref = useRef(new THREE.Color(pulse?.c1 || '#22d3ee'));
  const c2Ref = useRef(new THREE.Color(pulse?.c2 || '#a78bfa'));
    const blendRef = useRef(new THREE.Color('#22d3ee'));
  const sweepLightRef = useRef(new THREE.Color(pulse?.sweepLight || '#22d3ee'));
  const sweepDarkRef  = useRef(new THREE.Color(pulse?.sweepDark  || '#8b5cf6'));
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
      const budget = 1/26; if (t - lastRef.current < budget) return; lastRef.current = t;
      const m = matRef.current; if(!m) return;
      const blendT = 0.5 + 0.5*Math.sin((t/14.0) + phase*0.15);
      blendRef.current.copy(c1Ref.current).lerp(c2Ref.current, blendT);
      const breath = 0.10 + 0.06*(0.5 + 0.5*Math.sin((t/7.0) + phase));
      let cursorBoost = 0;
      if (!isMobile && cursorRef.current.active) {
        const dx = c - cursorRef.current.x;
        const dz = r - cursorRef.current.z;
        const dist = Math.hypot(dx, dz);
        const csigma = 0.7;
        const cval = Math.exp(-0.5 * (dist*dist) / (csigma*csigma));
        cursorBoost = 0.14 * cval;
      }
      let sweepBoost = 0; {
        const s = sweepRef.current; const dx = s.dir[0], dz = s.dir[1];
        const u = (c + 0.5) * dx + (r + 0.5) * dz;
        const d = (u - s.head);
        const g = Math.exp(-0.5 * (d * d) / (s.sigma * s.sigma));
        sweepBoost = s.amp * g;
      }
      const baseEmit = breath + cursorBoost + sweepBoost;
      let sweepTint = isDark ? sweepDarkRef.current : sweepLightRef.current;
      if (radar?.on) {
        const s = sweepRef.current; const dx = s.dir[0], dz = s.dir[1];
        const u = (c + 0.5) * dx + (r + 0.5) * dz;
        const d = (u - s.head);
        const g = Math.exp(-0.5 * (d * d) / (s.sigma * s.sigma));
        const sweepBoost = s.amp * g;
        if (sweepBoost > 0.02) {
          const key = `${r}-${c}`;
          if (radar.reachYou?.has && radar.reachYou.has(key)) sweepTint = youColRef.current; else if (radar.reachOpp?.has && radar.reachOpp.has(key)) sweepTint = oppColRef.current;
        }
      }
      const k = THREE.MathUtils.clamp(sweepBoost * 3.6, 0, 1);
      finalColRef.current.copy(blendRef.current).lerp(sweepTint, k);
      if (isLast) {
        tmpCol.current.set('#22c55e'); m.emissive.copy(tmpCol.current); m.emissiveIntensity = 0.58;
      } else if (isMove) {
        tmpCol.current.set(isDark ? NEON_TILE_DARK : NEON_TILE_LIGHT); m.emissive.copy(tmpCol.current); m.emissiveIntensity = 0.44;
      } else {
        m.emissive.copy(finalColRef.current); m.emissiveIntensity = baseEmit;
      }
    });
    const onTileClick = useCallback(()=> onCellClick(r,c), [onCellClick, r, c]);
    return (
      <group>
        <mesh position={[x,0.0005,z]} rotation={[-Math.PI/2,0,0]} onClick={onTileClick} receiveShadow>
          <planeGeometry args={[tile,tile]} />
          <meshStandardMaterial ref={matRef} color={baseColor} emissive={'#05060a'} emissiveIntensity={isMobileTile ? 0.10 : 0.08} />
        </mesh>
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
        {isLast && (
          <mesh position={[x,0.036,z]} rotation={[-Math.PI/2,0,0]} raycast={() => null}>
            <ringGeometry args={[0.16,0.24,40]} />
            <meshStandardMaterial color={'#22c55e'} emissive={'#22c55e'} emissiveIntensity={0.7} transparent opacity={0.95} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    );
  });
  return (
    <Canvas
      frameloop={'always'}
      dpr={isMobile ? 1 : 1}
      camera={{ position: camPos, fov: camFov, near:0.08, far:100 }}
      style={{ width: '100%', height: '100%' }}
      gl={{ powerPreference:'high-performance', antialias: isMobile ? false : true, alpha:false, stencil:false, depth:true, preserveDrawingBuffer:false }}
      onCreated={(st)=>{ try{ st.gl.setClearColor('#0f172a'); }catch{} }}
    >
      <hemisphereLight intensity={0.6} groundColor={'#1b1b1b'} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[6,10,6]} intensity={0.9} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <spotLight position={[3.5, 12.5, 3.5]} angle={1.0} penumbra={0.7} intensity={2.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <pointLight position={[3.5,8.0,3.5]} intensity={1.3} distance={40} decay={2} />

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
      />

      <group position={[3.5,0,3.5]} rotation={[0, myRole==='Player 2'?Math.PI:0, 0]}>
        <group position={[-3.5,0,-3.5]}>
          {/* Outer and inner plates (Chess neon palette) */}
          <mesh receiveShadow rotation={[-Math.PI/2,0,0]} position={[3.5, -0.12, 3.5]} raycast={() => null}>
            <planeGeometry args={[SIZE+2, SIZE+2]} />
            <meshStandardMaterial color={NEON_BG_OUTER} emissive={NEON_BG_OUTER} emissiveIntensity={0.2} />
          </mesh>
          <mesh receiveShadow rotation={[-Math.PI/2,0,0]} position={[3.5, -0.05, 3.5]} raycast={() => null}>
            <planeGeometry args={[SIZE, SIZE]} />
            <meshStandardMaterial color={NEON_BG_INNER} emissive={NEON_BG_INNER} emissiveIntensity={0.35} />
          </mesh>

          {/* LED strips + faint vector grid lines (like Chess) */}
          <GridLEDs animated={true} pulseSlow={false} c1={pulsePalette.c1} c2={pulsePalette.c2} />
          <group position={[0,0.012,0]} raycast={() => null}>
            {Array.from({length:SIZE+1}).map((_,i)=> (
              <Line key={`h-${i}`} points={[[0-0.5,0,i-0.5],[SIZE-0.5,0,i-0.5]]} color="#22d3ee" lineWidth={2.6} transparent opacity={0.55} />
            ))}
            {Array.from({length:SIZE+1}).map((_,i)=> (
              <Line key={`v-${i}`} points={[[i-0.5,0,0-0.5],[i-0.5,0,SIZE-0.5]]} color="#22d3ee" lineWidth={2.6} transparent opacity={0.55} />
            ))}
          </group>

          {/* Cursor + sweep controllers */}
          <CursorPointer />
          <SweepController />

          {/* Neon arcade rim removed */}

          {/* Tiles with Chess-like pulsing and highlights */}
          {Array.from({length:SIZE}).map((_,r)=>Array.from({length:SIZE}).map((_,c)=>{
            const isSel = !!(selected && selected.r===r && selected.c===c);
            const isMove = !!(moves?.some(m=>m.r2===r && m.c2===c));
            const isLast = !!(lastMove && lastMove.r2===r && lastMove.c2===c);
            const isDark = ((r+c)&1)===1;
            return (
              <Tile
                key={`t-${r}-${c}`}
                r={r} c={c}
                isDark={isDark}
                isLast={isLast}
                isMove={isMove}
                isSelTile={isSel}
                onClick={onCellClick}
                pulse={pulsePalette}
                radar={{ on: RADAR_ON, reachYou: (radarReach ? (myRole==='Player 1'?radarReach.P1:radarReach.P2) : null), reachOpp: (radarReach ? (myRole==='Player 1'?radarReach.P2:radarReach.P1) : null) }}
              />
            );
          }))}

          <React.Suspense fallback={null}>
            {board.map((row,r)=>row.map((cell,c)=>{
              if (!cell) return null;
              const x=c*tile; const z=r*tile;
              // Swap piece colors between players
              const col = cell.owner === 'Player 1' ? (colors?.['Player 2'] || '#3b82f6') : (colors?.['Player 1'] || '#ef4444');
              const isMovedDest = !!(lastMove && lastMove.r2===r && lastMove.c2===c);
              const yBase = 0.08 + (Number(pieceYOffset)||0);
              const zShift = Number(pieceZOffset)||0;
              const fromPos = isMovedDest ? [lastMove.c*tile, yBase, lastMove.r*tile + zShift] : undefined;
              const toPos = [x, yBase, z + zShift];
              return (
                <group key={`p-${r}-${c}`} onClick={(e)=>{ e.stopPropagation(); onCellClick(r,c); }}>
                  <AnimatedPiece to={toPos} from={fromPos} speed={isMobile?14:10} lift={isMobile?0.06:0.10}>
                    <CheckerPiece
                      king={!!cell.king}
                      color={col}
                      selected={false}
                      userYScale={pieceYScale}
                      userXZScale={pieceXZScale}
                      userZOffset={pieceZOffset}
                    />
                  </AnimatedPiece>
                </group>
              );
            }))}
          </React.Suspense>
        </group>
      </group>
    </Canvas>
  );
}

export default function CheckersScreen(){
  const PALETTE = ['#EF4444','#3B82F6','#A855F7','#FFFFFF','#22C55E','#F97316','#000000','#6B7280'];
  const [board, setBoard] = useState(initBoard());
  const [currentPlayer, setCurrentPlayer] = useState('Looking for another player...');
  const [winner, setWinner] = useState(null);
  const [playerRole, setPlayerRole] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [selected, setSelected] = useState(null);
  const [moves, setMoves] = useState([]);
  const [scores, setScores] = useState({ 'Player 1': 0, 'Player 2': 0 });
  const [turnToast, setTurnToast] = useState(null);
  const [chatFeed, setChatFeed] = useState([]);
  const [presence, setPresence] = useState({ 'Player 1': true, 'Player 2': true });

  // Piece height controls (persisted)
  const [pieceYOffset, setPieceYOffset] = useState(CHECKER_PIECE_DEFAULTS.yOffset);
  const [pieceYScale, setPieceYScale] = useState(CHECKER_PIECE_DEFAULTS.yScale);
  const [pieceZOffset, setPieceZOffset] = useState(CHECKER_PIECE_DEFAULTS.zOffset);
  const [pieceXZScale, setPieceXZScale] = useState(CHECKER_PIECE_DEFAULTS.xzScale);
  // Try to hydrate defaults from server once (does not override user-local edits after load)
  useEffect(()=>{
    (async()=>{
      try{
        const r = await fetch(`${API}/config/checkers/piece-defaults`, { headers:{ 'Content-Type':'application/json' } });
        const j = await r.json().catch(()=>null);
        if (j && typeof j === 'object'){
          const yO = Number(j.yOffset); const yS = Number(j.yScale); const zO = Number(j.zOffset); const xS = Number(j.xzScale);
          if (Number.isFinite(yO)) { setPieceYOffset(yO); }
          if (Number.isFinite(yS) && yS>0) { setPieceYScale(yS); }
          if (Number.isFinite(zO)) { setPieceZOffset(zO); }
          if (Number.isFinite(xS) && xS>0) { setPieceXZScale(xS); }
        }
      }catch{}
    })();
  },[]);
  // Controls are removed; values hydrate once from server and remain static during a session.

  const [username, setUsername] = useState(localStorage.getItem('username') || localStorage.getItem('chkName') || '');
  const [scBalance, setScBalance] = useState(0);
  const [stakeSC, setStakeSC] = useState(()=>Number(localStorage.getItem('chkStake')||'1')||1);
  const [stakeText, setStakeText] = useState(()=>localStorage.getItem('chkStake') || '1.00');

  const [showMatch, setShowMatch] = useState(false);
  const [pairedInfo, setPairedInfo] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [serverSaved, setServerSaved] = useState([]);
  const pendingSavedJoinRef = useRef(null);

  const [desiredColor, setDesiredColor] = useState(localStorage.getItem('profileColor') || '#ef4444');
  const [avatar, setAvatar] = useState(localStorage.getItem('profileAvatar') || 'rocket');
  const AVATAR_IDS = useRef(['rocket','dragon','brain','fox','lion','panda','penguin','alien']);
  const cycleAvatar = useCallback(()=>{
    try{
      const list = AVATAR_IDS.current;
      const idx = Math.max(0, list.indexOf(String(avatar)));
      const next = list[(idx+1)%list.length];
      setAvatar(next);
      try{ localStorage.setItem('profileAvatar', next); }catch{}
      // Optional: notify server if supported
      const ws=wsRef.current; if(ws && ws.readyState===WebSocket.OPEN){ try{ ws.send(JSON.stringify({ type:'setAvatar', avatar: next })); }catch{} }
    }catch{}
  }, [avatar]);
  const glyphForAvatar = useCallback((id)=>{ switch(String(id||'').toLowerCase()){ case 'rocket': return '🚀'; case 'dragon': return '🐉'; case 'brain': return '🧠'; case 'fox': return '🦊'; case 'lion': return '🦁'; case 'panda': return '🐼'; case 'penguin': return '🐧'; case 'alien': return '👾'; default: return (id && String(id)[0]) ? String(id)[0].toUpperCase() : '🙂'; } },[]);
  const fmtStakeMM = useCallback((v)=>{ const n=Number(v); return Number.isFinite(n) && n>0 ? `${n.toFixed(2)} SC` : '—'; },[]);
  const isAuthed = useCallback(() => !!localStorage.getItem('token') && !!localStorage.getItem('username'), []);
  const [authed, setAuthed] = useState(isAuthed());
  const [wsConnected, setWsConnected] = useState(false);
  useEffect(()=>{ const onAuth = ()=> setAuthed(isAuthed()); try{ window.addEventListener('authchange', onAuth);}catch{} return ()=>{ try{ window.removeEventListener('authchange', onAuth);}catch{} }; },[isAuthed]);
  useEffect(()=>{ const applyProfile=()=>{ try{ const n=localStorage.getItem('username')||''; const a=localStorage.getItem('profileAvatar')||null; const c=localStorage.getItem('profileColor')||null; if(n) setUsername(n.slice(0,16)); if(a) setAvatar(a); if(c) setDesiredColor(c);}catch{} }; try{ window.addEventListener('profile:update', applyProfile); window.addEventListener('storage', applyProfile);}catch{} return ()=>{ try{ window.removeEventListener('profile:update', applyProfile); window.removeEventListener('storage', applyProfile);}catch{} }; },[]);

  const wsRef = useRef(null);
  const connectWSRef = useRef(()=>{});
  const lockedStakeRef = useRef(0);
  const settledOnceRef = useRef(false);
  const userIdRef = useRef(() => { try{ const raw = localStorage.getItem('userId') ?? localStorage.getItem('id'); const n = raw != null ? Number(raw) : null; return Number.isFinite(n) ? n : null; }catch{ return null; } });
  useEffect(()=>{ (async()=>{ try{ setScBalance(await getBalance()); }catch{} })(); },[]);
  const lockStake = useCallback(async (amt)=>{ const a=Math.max(0.01, Number(amt)||0); if(!a) return false; if(lockedStakeRef.current>0) return true; try{ const j=await scAdjust(-a,'Checkers — lock stake'); lockedStakeRef.current=a; setScBalance(Number(j.sc_balance)||0); return true; }catch(e){ alert(e.message||'Could not lock stake.'); return false; } },[]);
  const refundStake = useCallback(async (reason='refund')=>{ const a=lockedStakeRef.current; if(!a) return; try{ const j=await scAdjust(+a,`Checkers — ${reason}`); setScBalance(Number(j.sc_balance)||0); lockedStakeRef.current=0; }catch{} },[]);
  const settleWin = useCallback(async (myStake,oppStake)=>{ const credit=Number(myStake||0)+Number(oppStake||0); try{ const j=await scAdjust(+credit,'Checkers — win payout'); setScBalance(Number(j.sc_balance)||0); }catch(e){ try{ const j2=await scAdjust(+Number(myStake||0),'Checkers — payout fallback refund'); setScBalance(Number(j2.sc_balance)||0);}catch{} } lockedStakeRef.current=0; },[]);
  const withOpenSocket = useCallback((fn)=>{ const ws=wsRef.current; if(ws&&ws.readyState===WebSocket.OPEN) fn(ws); },[]);

  connectWSRef.current = useCallback((fromJoin=false)=>{
    try{ if(wsRef.current){ try{ wsRef.current.close(1000,'reconnect'); }catch{} wsRef.current=null; } }catch{}
    const sock = new WebSocket(getWsUrl()); wsRef.current = sock;
    sock.onopen = () => {
      setWsConnected(true);
      if(fromJoin){ try{ sock.send(JSON.stringify({ type:'joinGame', username, userId: userIdRef.current && userIdRef.current(), stake: Number(stakeSC)||1, color: desiredColor, avatar })); }catch{} }
      try{
        const pend = pendingSavedJoinRef.current; const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); const uid = userIdRef.current && userIdRef.current();
        if(pend && !pend.sent){ if(pend.claim){ sock.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username: nm, userId: uid, otherUsername: pend.otherUsername, allowAny:false })); } else { sock.send(JSON.stringify({ type:'joinSavedGame', gameId: pend.gameId, token: pend.token, username: nm, userId: uid, allowAny:false })); } pendingSavedJoinRef.current={...pend,sent:true}; }
      }catch{}
      try{ const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); if(nm){ sock.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); } }catch{}
    };
    sock.onmessage = (evt) => {
      const data = JSON.parse(evt.data||'{}');
      if (data.type === 'queued') { setShowMatch(true); return; }
      if (data.type === 'mySavedGames') { try{ setServerSaved(Array.isArray(data.list)?data.list:[]); }catch{ setServerSaved([]); } return; }
      if (data.type === 'savedDenied') {
        const pend = pendingSavedJoinRef.current;
        if(pend && (pend.claim || !pend.triedClaim)){
          pendingSavedJoinRef.current = { ...pend, triedClaim: true, claim: true };
          try{ const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); sock.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username: nm, userId: userIdRef.current && userIdRef.current(), otherUsername: pend.otherUsername, allowAny:false })); }catch{}
        } else { setTurnToast('Saved game not found or not yours'); setTimeout(()=>setTurnToast(null), 1200); pendingSavedJoinRef.current = null; }
        return;
      }
      if (data.type === 'savedRemoved') { try{ if(data.ok && data.gameId!=null){ setServerSaved(prev => Array.isArray(prev) ? prev.filter(x=>x.gameId!==data.gameId) : prev); } }catch{} return; }
      if (data.type === 'savedQueued') {
        setPairedInfo({ you: data.you, usernames: data.usernames||{'Player 1':'P1','Player 2':'P2'}, colors: data.colors||{'Player 1':'#ef4444','Player 2':'#3b82f6'}, avatars: data.avatars||{'Player 1':'rocket','Player 2':'alien'}, stakes: pairedInfo?.stakes||{}, gameId: data.gameId||null, token: data.token||null }); setShowMatch(true); setCountdown(null); pendingSavedJoinRef.current = null; return;
      }
      if (data.type === 'paired') {
        setPairedInfo({ you: data.you, usernames: data.usernames||{'Player 1':'P1','Player 2':'P2'}, colors: data.colors||{'Player 1':'#ef4444','Player 2':'#3b82f6'}, avatars: data.avatars||{'Player 1':'rocket','Player 2':'alien'}, stakes: data.stakes || (data.you===2 ? { 'Player 1':'—','Player 2':Number(stakeSC)||0 } : { 'Player 1':Number(stakeSC)||0,'Player 2':'—' }) }); return; }
      if (data.type === 'presence' && data.present) { setPresence({'Player 1':!!data.present['Player 1'],'Player 2':!!data.present['Player 2']}); return; }
      if (data.type === 'playerLeft' && data.side) { setPresence(prev=>({ ...prev, [data.side]: false })); return; }
      if (data.type === 'playerBack' && data.side) { setPresence(prev=>({ ...prev, [data.side]: true })); return; }
      if (data.type === 'quickChat'){ const youRole = playerRole || (pairedInfo?.you===2?'Player 2':'Player 1') || 'Player 1'; const from = data.from === youRole ? 'you' : (data.from||'opp'); setChatFeed(prev => [...prev, { from, username: data.username, text: String(data.text||'').slice(0,80), ts: Number(data.ts)||Date.now() }].slice(-12)); return; }
      if (data.type === 'countdown') { setCountdown(data.value); return; }
      if (data.type === 'startGame') {
        setChatFeed([]); setPresence({'Player 1':true,'Player 2':true});
        const you = data.playerNumber===2?'Player 2':'Player 1'; setPlayerRole(you);
        setCurrentPlayer(data.currentPlayer||'Player 1'); setBoard(data.board || initBoard()); setWinner(null);
        setShowMatch(false); setCountdown(null);
        setTurnToast( (data.currentPlayer||'Player 1')===you ? "It's your turn!" : "It's your opponent's turn!" ); setTimeout(()=>setTurnToast(null), 1200);
        try{ const gid=data.gameId; const tok=data.token; if(gid && tok){ localStorage.setItem('chkResume', JSON.stringify({ gameId: gid, token: tok })); } }catch{}
        try{ const desired=Math.max(0.01, Number(stakeText)||Number(stakeSC)||0); if(lockedStakeRef.current<=0){ (async()=>{ await lockStake(desired); })(); } }catch{}
        return;
      }
      if (data.type === 'gameUpdate') {
        setBoard(data.board||board); setCurrentPlayer(data.currentPlayer||''); setWinner(data.winner||null); setLastMove(data.lastMove||null);
        if (!data.winner) { const yours = (data.currentPlayer||'') === (playerRole||''); setTurnToast(yours ? "It's your turn!" : "It's your opponent's turn!"); setTimeout(()=>setTurnToast(null), 1100); }
        if (data.winner) {
          const myRole = playerRole || (data.playerNumber===2?'Player 2':'Player 1'); const stakes=(pairedInfo&&pairedInfo.stakes)||data.stakes||{}; const myStake=Number(stakes?.[myRole])||lockedStakeRef.current||Number(stakeSC)||0; const oppStake=myStake; if (data.winner===myRole) { settleWin(myStake,oppStake); settledOnceRef.current=true; } else { lockedStakeRef.current=0; } setScores(prev => ({ ...prev, [data.winner]: (prev[data.winner]||0) + 1 }));
        }
        return;
      }
      if (data.type === 'opponentLeft') { return; }
      if (data.type === 'resetAck') { setBoard(initBoard()); setWinner(null); setCurrentPlayer('Player 1'); return; }
    };
    sock.onclose = () => { setWsConnected(false); };
    sock.onerror = () => { setWsConnected(false); };
  }, [username, stakeSC, stakeText, lockStake, refundStake, settleWin, playerRole, pairedInfo, board, desiredColor, avatar]);

  const onJoin = useCallback(async()=>{
    const stake = Math.max(0.01, Number(stakeText)||Number(stakeSC)||0); const nn = Number.isFinite(stake) ? stake : 0.01;
    setStakeSC(nn); setStakeText(nn.toFixed(2)); localStorage.setItem('chkStake', String(nn));
    setShowMatch(true); connectWSRef.current(true);
  }, [stakeSC, stakeText]);
  const onCancelQueue = useCallback(()=>{ refundStake('canceled matchmaking'); const ws=wsRef.current; try{ if(ws) ws.close(1000,'cancel'); }catch{} setShowMatch(false); }, [refundStake]);

  useEffect(() => { connectWSRef.current(false); return () => { try{ const w=wsRef.current; if(w) w.close(1000,'cleanup'); }catch{} }; }, []);
  useEffect(() => { try{ const w = wsRef.current; const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); if(w && w.readyState===WebSocket.OPEN && nm){ w.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); } else { connectWSRef.current(false); } }catch{} }, [username]);
  useEffect(() => { const t=setInterval(()=>{ try{ if (playerRole) return; const w=wsRef.current; const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); if(w && w.readyState===WebSocket.OPEN && nm){ w.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); } }catch{} }, 12000); return ()=>clearInterval(t); }, [playerRole, username]);

  const claimSaved = useCallback((gameId, otherUsername) => {
    try{ const raw=localStorage.getItem('chkResume'); if(raw){ const obj=JSON.parse(raw); if(obj && Number(obj.gameId)===Number(gameId) && obj.token){ pendingSavedJoinRef.current={ gameId, token:String(obj.token), sent:false, claim:false, allowAny:false }; } else { pendingSavedJoinRef.current={ gameId, triedClaim:false, sent:false, claim:true, otherUsername, allowAny:false }; } } else { pendingSavedJoinRef.current={ gameId, triedClaim:false, sent:false, claim:true, otherUsername, allowAny:false }; } }catch{ pendingSavedJoinRef.current={ gameId, triedClaim:false, sent:false, claim:true, otherUsername, allowAny:false }; }
    const tryImmediate=()=>{ try{ const ws=wsRef.current; const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); const uid=userIdRef.current && userIdRef.current(); const pend=pendingSavedJoinRef.current; if(ws && ws.readyState===WebSocket.OPEN && pend && !pend.sent){ if(pend.claim){ ws.send(JSON.stringify({ type:'claimSavedGame', gameId: pend.gameId, username: nm, userId: uid, otherUsername: pend.otherUsername, allowAny:false })); } else { ws.send(JSON.stringify({ type:'joinSavedGame', gameId: pend.gameId, token: pend.token, username: nm, userId: uid, allowAny:false })); } pendingSavedJoinRef.current={...pend,sent:true}; return true; } }catch{} return false; };
    if(!tryImmediate()) connectWSRef.current(false); setShowMatch(true); setCountdown(null);
  }, [username]);

  const handleCellClick = useCallback((r,c)=>{
    if (!playerRole || currentPlayer !== playerRole) return;
    const cell = board?.[r]?.[c]; const me = playerRole;
    if (cell && cell.owner === me) { const mv = validMoves(board, r, c, playerRole); setSelected({ r, c }); setMoves(mv); return; }
    if (selected) { const mv = moves.find(m => m.r2===r && m.c2===c); if (mv) { const { r: r0, c: c0 } = selected; withOpenSocket(sock => { try { sock.send(JSON.stringify({ type:'makeMove', r: r0, c: c0, r2: r, c2: c })); } catch {} }); } setSelected(null); setMoves([]); return; }
  }, [board, playerRole, selected, moves, withOpenSocket, currentPlayer]);

  const showOverlay = (!playerRole ? !authed : (!authed || !wsConnected));
  // Always remove global bottom padding while on the Checkers screen (edge-to-edge bottom)
  useEffect(()=>{
    const cls='no-bottom-pad';
    try{
      const els=[document.documentElement, document.body, document.getElementById('root')].filter(Boolean);
      els.forEach(el=>{ try{ el.classList && el.classList.add(cls);}catch{} });
      if (playerRole) { try{ window.scrollTo({ top:0,left:0,behavior:'auto' }); }catch{} }
      return ()=>{ els.forEach(el=>{ try{ el.classList && el.classList.remove(cls);}catch{} }); };
    }catch{}
  }, [playerRole]);

  return (
    <div className="cf-screen cf-checkers">
      <NavBar />
      <div className="nav-spacer" aria-hidden="true" />
      <main className={`app-content ${playerRole ? 'app-content--full' : ''}`}>
        {showOverlay && (<LoginOverlay />)}
        {!playerRole && (
          <div className="d-flex justify-content-center">
            <div className="prejoin-float" style={{ width:'100%' }} onClick={(e)=>e.stopPropagation()}>
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
                avatarId={avatar}
                avatarGlyph={glyphForAvatar(avatar)}
                onOpenAvatarModal={()=>{}}
                colors={PALETTE}
                selectedColor={desiredColor}
                onPickColor={(hex)=>{ setDesiredColor(hex); try{ localStorage.setItem('profileColor', hex); }catch{} }}
                footerExtra={(
                  <div>
                    <div className="d-flex align-items-center justify-content-between mb-1">
                      <div className="fw-bold">Reconnect & Continue</div>
                      <div>
                        <Button size="sm" variant="outline-light" onClick={()=>{ const ws=wsRef.current; const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); if(ws&&ws.readyState===WebSocket.OPEN){ try{ ws.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} } else { connectWSRef.current(false); setTimeout(()=>{ const w=wsRef.current; if(w&&w.readyState===WebSocket.OPEN){ try{ w.send(JSON.stringify({ type:'listMySavedGames', username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} } }, 250); } }}>
                          Refresh
                        </Button>
                      </div>
                    </div>
                    {Array.isArray(serverSaved) && serverSaved.length>0 ? (
                      <div className="saved-list">
                        {serverSaved.map(s => (
                          <div key={`sv-${s.gameId}`} className="p-2 saved-card">
                            {(() => {
                              try {
                                const youRole = (s?.you===2 ? 'Player 2' : (s?.you===1 ? 'Player 1' : null)) || (()=>{
                                  const me=(localStorage.getItem('username')||username||'').toString().slice(0,40);
                                  const p1=s?.usernames?.['Player 1'];
                                  const p2=s?.usernames?.['Player 2'];
                                  if (p1===me) return 'Player 1';
                                  if (p2===me) return 'Player 2';
                                  return 'Player 1';
                                })();
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
                                      <Button size="sm" variant="light" className="fw-semibold" onClick={()=>{
                                        const youName2 = (s?.usernames?.[youRole]||'').toString().slice(0,40);
                                        if (youName2) { try{ localStorage.setItem('username', youName2); }catch{} setUsername(youName2.slice(0,16)); }
                                        const otherUsername = s?.usernames?.[oppRole] || undefined;
                                        claimSaved(s.gameId, otherUsername);
                                      }}><i className="bi bi-play-fill me-1" />Continue</Button>
                                      <Button size="sm" variant="outline-danger" className="fw-semibold" onClick={()=>{ const ws=wsRef.current; const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); if(ws&&ws.readyState===WebSocket.OPEN){ try{ ws.send(JSON.stringify({ type:'finishSavedGame', gameId: s.gameId, username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} } setServerSaved(prev=>Array.isArray(prev)?prev.filter(x=>x.gameId!==s.gameId):prev); }}><i className="bi bi-check2-circle me-1" />Finish</Button>
                                    </div>
                                  </div>
                                );
                              } catch {
                                return (
                                  <div className="d-flex align-items-center flex-wrap gap-2">
                                    <div className="small">Game #{s.gameId}</div>
                                    <div className="saved-actions ms-auto">
                                      <Button size="sm" variant="light" className="fw-semibold" onClick={()=> claimSaved(s.gameId)}><i className="bi bi-play-fill me-1" />Continue</Button>
                                      <Button size="sm" variant="outline-danger" className="fw-semibold" onClick={()=>{ const ws=wsRef.current; const nm=(localStorage.getItem('username')||username||'').toString().slice(0,40); if(ws&&ws.readyState===WebSocket.OPEN){ try{ ws.send(JSON.stringify({ type:'finishSavedGame', gameId: s.gameId, username: nm, userId: userIdRef.current && userIdRef.current() })); }catch{} } setServerSaved(prev=>Array.isArray(prev)?prev.filter(x=>x.gameId!==s.gameId):prev); }}><i className="bi bi-check2-circle me-1" />Finish</Button>
                                    </div>
                                  </div>
                                );
                              }
                            })()}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-secondary small">No paused games yet. Start a game, make a move, then leave to save it for later.</div>
                    )}
                  </div>
                )}
              >

              </GameSetup>
              {/* Bottom spacer to guarantee the last saved card isn't behind OS chrome */}
              <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 18px)' }} />
            </div>
          </div>
        )}

        {showMatch && (
          <div className="match-overlay">
            <div className="match-card">
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
                  const youColor = pairedInfo?.colors?.[youRole] ?? desiredColor;
                  const oppColor = pairedInfo?.colors?.[oppRole] ?? '#3b82f6';
                  const youAvatar = pairedInfo?.avatars?.[youRole] ?? avatar;
                  const oppAvatar = pairedInfo?.avatars?.[oppRole] ?? null;
                  const youStake = (pairedInfo?.stakes?.[youRole] ?? (Number(stakeSC)||0));
                  const oppStake = pairedInfo?.stakes?.[oppRole];
                  return (
                    <>
                      <div className="match-col">
                        <button className="mm-avatar" title="Your avatar" onClick={cycleAvatar}>
                          {glyphForAvatar(youAvatar)}
                        </button>
                        <div className="mm-pill"><i className="bi bi-person-badge" />{youName}</div>
                        <div className="mm-pill"><i className="bi bi-palette-fill" />Color <span className="mm-swab" style={{ background: youColor, marginLeft: 6 }} /></div>
                        <div className="mm-pill"><i className="bi bi-coin" />Your bet: <strong className="ms-1">{fmtStakeMM(youStake)}</strong></div>
                      </div>
                      <div className="match-divider">VS</div>
                      <div className="match-col">
                        <div className="mm-avatar" title="Opponent avatar">{oppAvatar ? glyphForAvatar(oppAvatar) : (<div className="mm-dots"><span className="mm-dot"/><span className="mm-dot"/><span className="mm-dot"/></div>)}</div>
                        <div className="mm-pill"><i className="bi bi-person-badge" />{oppAvatar ? oppName : 'Searching…'}</div>
                        <div className="mm-pill"><i className="bi bi-palette-fill" />Color <span className="mm-swab" style={{ background: oppColor, marginLeft: 6 }} /></div>
                        <div className="mm-pill"><i className="bi bi-coin" />Opponent bet: <strong className="ms-1">{typeof oppStake==='number' ? fmtStakeMM(oppStake) : (oppStake || '—')}</strong></div>
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
              {/* Controls removed now that defaults are dialed in */}
            </div>
          </div>
        )}

        {playerRole && (
          <div className="game-area">
            <div className="board-fullwrap">
              <div className="board-shell">
                {(() => {
                  // Determine piece colors: prefer server-provided, else apply desiredColor to your side
                  const serverColors = pairedInfo?.colors;
                  let boardColors = serverColors && serverColors['Player 1'] && serverColors['Player 2']
                    ? serverColors
                    : (playerRole==='Player 2'
                        ? { 'Player 1': '#ef4444', 'Player 2': desiredColor }
                        : { 'Player 1': desiredColor, 'Player 2': '#3b82f6' });
                  return (
              <Board3D
                board={board}
                lastMove={lastMove}
                myRole={playerRole}
                onCellClick={handleCellClick}
                selected={selected}
                moves={moves}
                    colors={boardColors}
                    pieceYOffset={pieceYOffset}
                    pieceYScale={pieceYScale}
                    pieceZOffset={pieceZOffset}
                    pieceXZScale={pieceXZScale}
              />
                  );
                })()}
              </div>
            </div>
            {/* Piece tuning controls removed */}
            <QuickChat
              messages={chatFeed}
              youKey="you"
              align="right"
              canSend={!!playerRole && wsConnected}
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
            />
            {(() => {
              try{
                const oppRole = playerRole==='Player 1' ? 'Player 2' : 'Player 1';
                const oppMissing = presence && presence[oppRole]===false;
                return (
                  <WaitingOverlay show={!!oppMissing} />
                );
              }catch{return null;}
            })()}
            {turnToast && (<div className="turn-toast">{turnToast}</div>)}
            {winner && (<div className="win-banner">{winner} wins!</div>)}
          </div>
        )}
      </main>
    </div>
  );
}
