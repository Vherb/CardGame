/* eslint-disable no-console */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';

// Vector (2D canvas) chess board for mobile smoothness: resolution-independent lines
// Props mirror the 3D board where useful
// props: { board, myColor, lastMove, onCellClick, selected, moves, pieceColors, hint, checkKing }

const SIZE = 8;

export default function ChessVectorBoard({
  board,
  myColor,
  lastMove,
  onCellClick,
  selected,
  moves,
  pieceColors,
  hint,
  checkKing,
}){
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  // Camera state: zoom (world unit 1 == one tile), panX/panY in CSS pixels
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const needsFrame = useRef(false);

  // Piece animation state (simple: animate lastMove)
  const animRef = useRef(null); // { from:{r,c}, to:{r,c}, start:number, dur:number }
  const lastMoveKey = useRef('');

  const isBlack = (myColor === 'b');

  // Fit-to-view helpers
  const getMinZoomToFit = useCallback(()=>{
    const canvas = canvasRef.current; if(!canvas) return 1;
    const rect = canvas.getBoundingClientRect();
    const worldW = SIZE, worldH = SIZE;
    const fitW = rect.width / worldW;
    const fitH = rect.height / worldH;
    return Math.min(fitW, fitH);
  },[]);

  const requestFrame = useCallback(()=>{
    if(!needsFrame.current){
      needsFrame.current = true;
      requestAnimationFrame(()=>{ needsFrame.current = false; render(); });
    }
  },[]);

  // World<->Screen transforms
  function getCamera(){
    const canvas = canvasRef.current; if(!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = rect.width, cssH = rect.height;
    const s = zoomRef.current; // px per world unit
    const pan = panRef.current;
    // Center world [0,SIZE]x[0,SIZE] at screen center plus pan
    const cx = cssW/2 + pan.x;
    const cy = cssH/2 + pan.y;
    const tlx = cx - (SIZE*s)/2;
    const tly = cy - (SIZE*s)/2;
    return { dpr, cssW, cssH, s, cx, cy, tlx, tly };
  }
  function worldToScreen(wx, wy){
    const c = getCamera(); if(!c) return [0,0];
    // Optional flip for black perspective
    const fx = isBlack ? (SIZE - wx) : wx;
    const fy = isBlack ? (SIZE - wy) : wy;
    return [ c.tlx + fx*c.s, c.tly + fy*c.s ];
  }
  function screenToWorld(mx, my){
    const c = getCamera(); if(!c) return [0,0];
    const wx = (mx - c.tlx) / c.s;
    const wy = (my - c.tly) / c.s;
    // Inverse flip if black
    return isBlack ? [ SIZE - wx, SIZE - wy ] : [ wx, wy ];
  }

  // Anchored zoom to keep cursor position stable on zoom
  const anchoredZoomTo = useCallback((newZoom, anchorX, anchorY)=>{
    const zMin = getMinZoomToFit();
    const z = Math.max(newZoom, zMin);
    const before = screenToWorld(anchorX, anchorY);
    zoomRef.current = z;
    const after = screenToWorld(anchorX, anchorY);
    const dx = (after[0] - before[0]) * z; // convert world delta to pixels in current zoom
    const dy = (after[1] - before[1]) * z;
    panRef.current.x += dx;
    panRef.current.y += dy;
    requestFrame();
  },[getMinZoomToFit, requestFrame]);

  // Resize/backing store
  const ensureSize = useCallback(()=>{
    const canvas = canvasRef.current; const box = boxRef.current; if(!canvas||!box) return;
    const rect = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, Math.floor(rect.width * dpr));
    const h = Math.max(150, Math.floor(rect.height * dpr));
    if(canvas.width !== w || canvas.height !== h){
      canvas.width = w; canvas.height = h;
      canvas.style.width = rect.width+'px';
      canvas.style.height = rect.height+'px';
      const zMin = getMinZoomToFit();
      if(!Number.isFinite(zoomRef.current) || zoomRef.current < zMin) zoomRef.current = zMin;
      requestFrame();
    }
  },[getMinZoomToFit, requestFrame]);

  // Init
  useEffect(()=>{
    const canvas = canvasRef.current; if(!canvas) return;
    ctxRef.current = canvas.getContext('2d');
    ensureSize();
    // Fit view
    zoomRef.current = getMinZoomToFit();
    panRef.current = { x:0, y:0 };
    requestFrame();
    const onResize = ()=>{ ensureSize(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return ()=>{
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [ensureSize, getMinZoomToFit, requestFrame]);

  // Piece animation when lastMove changes
  useEffect(()=>{
    try{
      const key = lastMove ? `${lastMove.r},${lastMove.c}->${lastMove.r2},${lastMove.c2}` : '';
      if(key && key !== lastMoveKey.current){
        lastMoveKey.current = key;
        animRef.current = { from:{ r:lastMove.r, c:lastMove.c }, to:{ r:lastMove.r2, c:lastMove.c2 }, start: performance.now(), dur: 220 };
        requestFrame();
      }
    }catch{}
  },[lastMove, requestFrame]);

  // Input: tap cells + pinch zoom & two-finger pan
  useEffect(()=>{
    const canvas = canvasRef.current; if(!canvas) return;
    const touches = new Map();
    let isDragging = false;
    let lastX=0, lastY=0;

    const onPointerDown = (ev)=>{
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      canvas.setPointerCapture?.(ev.pointerId);
      lastX = ev.clientX; lastY = ev.clientY;
      if(touches.size===2){ isDragging = false; }
    };
    const onPointerMove = (ev)=>{
      if(!touches.has(ev.pointerId)) return;
      const prev = touches.get(ev.pointerId);
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if(touches.size>=2){
        const vals = Array.from(touches.values());
        const a = vals[0], b = vals[1];
        const mid = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        if(!onPointerMove._init){ onPointerMove._init = { dist, radius: zoomRef.current, mid };
        } else {
          const init = onPointerMove._init;
          const scale = dist / (init.dist || 1);
          const nextZoom = init.radius * scale;
          anchoredZoomTo(nextZoom, mid.x, mid.y);
          // Pan by midpoint delta
          const dx = mid.x - init.mid.x; const dy = mid.y - init.mid.y;
          panRef.current.x += dx; panRef.current.y += dy; init.mid = mid;
          requestFrame();
        }
      } else {
        // One-finger drag: minimal camera move (optional). Keep for now to avoid accidental drags.
        if(isDragging){
          panRef.current.x += (ev.clientX - lastX);
          panRef.current.y += (ev.clientY - lastY);
          lastX = ev.clientX; lastY = ev.clientY;
          requestFrame();
        }
      }
    };
    const onPointerUp = (ev)=>{
      if(touches.size<=1 && !isDragging){
        // Treat as tap -> select/move
        const rect = canvas.getBoundingClientRect();
        const wxwy = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
        const c = Math.floor(wxwy[0]);
        const r = Math.floor(wxwy[1]);
        if(r>=0&&r<8&&c>=0&&c<8) onCellClick && onCellClick(r,c);
      }
      touches.delete(ev.pointerId);
      if(touches.size<2) onPointerMove._init = null;
      isDragging = false;
    };
    const onWheel = (ev)=>{
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const ax = ev.clientX - rect.left; const ay = ev.clientY - rect.top;
      const factor = Math.exp(-ev.deltaY * 0.001);
      anchoredZoomTo(zoomRef.current * factor, ax, ay);
    };
    const onClickStart = ()=>{ isDragging = false; };
    canvas.addEventListener('pointerdown', onPointerDown, { passive:false });
    canvas.addEventListener('pointermove', onPointerMove, { passive:false });
    canvas.addEventListener('pointerup', onPointerUp, { passive:true });
    canvas.addEventListener('pointercancel', onPointerUp, { passive:true });
    canvas.addEventListener('pointerleave', onPointerUp, { passive:true });
    canvas.addEventListener('wheel', onWheel, { passive:false });
    canvas.addEventListener('mousedown', onClickStart, { passive:true });
    return ()=>{
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onClickStart);
    };
  }, [anchoredZoomTo, onCellClick]);

  // Drawing helpers
  function drawBoard(ctx, c){
    // Clear
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0, ctx.canvas.width, ctx.canvas.height);
    // Screen-space transform
    ctx.setTransform(c.dpr,0,0,c.dpr,0,0);
    ctx.save();
    // Board background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0,0, c.cssW, c.cssH);
    // Draw world content
    // Tiles
    for(let r=0;r<SIZE;r++){
      for(let col=0;col<SIZE;col++){
        const x = col, y = r;
        const dark = ((r+col)&1)===1;
        ctx.fillStyle = dark ? '#0b1220' : '#111827';
        const p0 = worldToScreen(x,y);
        const p1 = worldToScreen(x+1,y+1);
        const x0 = Math.min(p0[0],p1[0]), y0 = Math.min(p0[1],p1[1]);
        const w = Math.abs(p1[0]-p0[0]), h = Math.abs(p1[1]-p0[1]);
        ctx.fillRect(x0,y0,w,h);
      }
    }
    // Grid lines (neon style, faint)
    ctx.strokeStyle = 'rgba(34,211,238,0.45)';
    ctx.lineWidth = Math.max(1, c.dpr); // crisp
    for(let i=0;i<=SIZE;i++){
      const a = worldToScreen(0,i); const b = worldToScreen(SIZE,i);
      ctx.beginPath(); ctx.moveTo(a[0]+0.5, a[1]+0.5); ctx.lineTo(b[0]+0.5, b[1]+0.5); ctx.stroke();
      const a2 = worldToScreen(i,0); const b2 = worldToScreen(i,SIZE);
      ctx.beginPath(); ctx.moveTo(a2[0]+0.5, a2[1]+0.5); ctx.lineTo(b2[0]+0.5, b2[1]+0.5); ctx.stroke();
    }
  }

  function drawRings(ctx){
    // Highlights: selected, moves, hint, check
    function ring(x,y, inner, outer, color, alpha){
      const p = worldToScreen(x+0.5, y+0.5);
      const r0 = inner * zoomRef.current; const r1 = outer * zoomRef.current;
      ctx.save();
      ctx.globalAlpha = alpha==null?1:alpha;
      ctx.beginPath(); ctx.arc(p[0], p[1], r1, 0, Math.PI*2);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, (r1-r0)); ctx.stroke();
      ctx.restore();
    }
    if(selected){ ring(selected.c, selected.r, 0.22, 0.32, '#a78bfa', 0.95); }
    if(Array.isArray(moves)) moves.forEach(m => ring(m.c2, m.r2, 0.18, 0.26, '#22d3ee', 0.95));
    if(hint && hint.from){ ring(hint.from.c, hint.from.r, 0.20, 0.30, '#f59e0b', 0.95); }
    if(hint && hint.to){ ring(hint.to.c2, hint.to.r2, 0.16, 0.24, '#22c55e', 0.95); }
    if(checkKing){ ring(checkKing.c, checkKing.r, 0.22, 0.34, '#ef4444', 1.0); }
  }

  function pieceTint(pc){ return pc.c==='w' ? (pieceColors?.w || '#e5e7eb') : (pieceColors?.b || '#111827'); }

  function drawPieces(ctx){
    // Determine animated piece position if any
    let animFrom = null, animTo = null, animT = 1;
    const anim = animRef.current;
    if(anim){
      const now = performance.now();
      const t = Math.min(1, (now - anim.start)/(anim.dur||220));
      // smoothstep
      animT = t*t*(3-2*t);
      animFrom = { r: anim.from.r, c: anim.from.c };
      animTo = { r: anim.to.r, c: anim.to.c };
      if(t>=1) animRef.current = null;
    }
    // Draw pieces
    for(let r=0;r<SIZE;r++){
      for(let c=0;c<SIZE;c++){
        const pc = board?.[r]?.[c]; if(!pc) continue;
        let cx = c + 0.5, cy = r + 0.5;
        if(animFrom && animTo && r===animTo.r && c===animTo.c){
          const sx = animFrom.c + 0.5, sy = animFrom.r + 0.5;
          cx = sx + (cx - sx) * animT;
          cy = sy + (cy - sy) * animT;
        }
        drawPieceGlyph(ctx, cx, cy, pc, pieceTint(pc));
      }
    }
  }

  function drawPieceGlyph(ctx, cxw, cyw, pc, color){
    const p = worldToScreen(cxw, cyw);
    const unit = zoomRef.current; // pixels per world
    const radius = unit * 0.32;
    // Base disk
    ctx.save();
    ctx.beginPath(); ctx.arc(p[0], p[1], radius, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = Math.max(1, unit*0.06);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
    // Inner symbol using lines for vector crispness
    ctx.strokeStyle = '#0b1220'; ctx.lineWidth = Math.max(1.5, unit*0.08); ctx.lineCap='round';
    const t = pc.t;
    // Simple glyphs by piece type
    if(t==='p'){
      // Pawn: small head + stem
      ctx.beginPath(); ctx.moveTo(p[0], p[1]-radius*0.35); ctx.lineTo(p[0], p[1]+radius*0.30); ctx.stroke();
      ctx.beginPath(); ctx.arc(p[0], p[1]-radius*0.5, radius*0.18, 0, Math.PI*2); ctx.stroke();
    } else if(t==='r'){
      // Rook: crenellation
      const y0=p[1]-radius*0.45, y1=p[1]+radius*0.35;
      ctx.beginPath(); ctx.moveTo(p[0]-radius*0.35,y0); ctx.lineTo(p[0]-radius*0.35,y1);
      ctx.lineTo(p[0]+radius*0.35,y1); ctx.lineTo(p[0]+radius*0.35,y0);
      ctx.stroke();
      ctx.beginPath();
      const step = radius*0.22;
      ctx.moveTo(p[0]-step,y0); ctx.lineTo(p[0]-step,y0-radius*0.15);
      ctx.moveTo(p[0],y0); ctx.lineTo(p[0],y0-radius*0.15);
      ctx.moveTo(p[0]+step,y0); ctx.lineTo(p[0]+step,y0-radius*0.15);
      ctx.stroke();
    } else if(t==='n'){
      // Knight: stylized neck + head
      ctx.beginPath();
      ctx.moveTo(p[0]-radius*0.25, p[1]+radius*0.30);
      ctx.quadraticCurveTo(p[0]+radius*0.10, p[1]+radius*0.10, p[0]+radius*0.05, p[1]-radius*0.35);
      ctx.quadraticCurveTo(p[0]-radius*0.10, p[1]-radius*0.45, p[0]-radius*0.05, p[1]-radius*0.15);
      ctx.stroke();
    } else if(t==='b'){
      // Bishop: diagonal slash
      ctx.beginPath(); ctx.moveTo(p[0]-radius*0.30, p[1]+radius*0.30); ctx.lineTo(p[0]+radius*0.30, p[1]-radius*0.30); ctx.stroke();
      ctx.beginPath(); ctx.arc(p[0], p[1]-radius*0.45, radius*0.12, 0, Math.PI*2); ctx.stroke();
    } else if(t==='q'){
      // Queen: crown points
      ctx.beginPath();
      ctx.moveTo(p[0]-radius*0.35,p[1]+radius*0.25);
      ctx.lineTo(p[0]-radius*0.20,p[1]-radius*0.30);
      ctx.lineTo(p[0],p[1]+radius*0.05);
      ctx.lineTo(p[0]+radius*0.20,p[1]-radius*0.30);
      ctx.lineTo(p[0]+radius*0.35,p[1]+radius*0.25);
      ctx.stroke();
    } else if(t==='k'){
      // King: cross
      ctx.beginPath(); ctx.moveTo(p[0], p[1]-radius*0.40); ctx.lineTo(p[0], p[1]+radius*0.30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p[0]-radius*0.22, p[1]-radius*0.12); ctx.lineTo(p[0]+radius*0.22, p[1]-radius*0.12); ctx.stroke();
    }
    ctx.restore();
  }

  function render(){
    const canvas = canvasRef.current; const ctx = ctxRef.current; if(!canvas||!ctx) return;
    const c = getCamera(); if(!c) return;
    drawBoard(ctx, c);
    drawRings(ctx);
    drawPieces(ctx);
  }

  return (
    <div ref={boxRef} style={{ width:'100%', height:'100%', position:'relative', background:'#0f172a', touchAction:'none' }}>
      <canvas ref={canvasRef} style={{ width:'100%', height:'100%', display:'block' }} />
    </div>
  );
}
