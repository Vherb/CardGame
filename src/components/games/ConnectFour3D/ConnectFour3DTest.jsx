import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import NavBar from '../../NavBar';
import '../Checkers/CheckersScreen.css';

const COLS = 7;
const ROWS = 6;
const CELL = 1; // unit size
const GAP = 0.1;
const BOARD_THICK = 0.22;

function RoundedRectShape(w, h, r) {
  const shape = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  const cr = Math.min(r, hw, hh);
  shape.moveTo(-hw + cr, -hh);
  shape.lineTo(hw - cr, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + cr);
  shape.lineTo(hw, hh - cr);
  shape.quadraticCurveTo(hw, hh, hw - cr, hh);
  shape.lineTo(-hw + cr, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - cr);
  shape.lineTo(-hw, -hh + cr);
  shape.quadraticCurveTo(-hw, -hh, -hw + cr, -hh);
  return shape;
}

function FrontPlate() {
  // Classic Connect Four front plate with circular holes (extruded shape with holes)
  const w = COLS * (CELL + GAP) - GAP + 0.6; // a bit wider than grid
  const h = ROWS * (CELL + GAP) - GAP + 0.6; // a bit taller than grid
  const holeR = 0.46; // hole radius relative to CELL size
  const depth = BOARD_THICK;
  const geom = useMemo(() => {
    const outer = RoundedRectShape(w, h, 0.28);
    // add holes centered on each grid position
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const cx = (c - (COLS - 1) / 2) * (CELL + GAP);
        const cy = (r - (ROWS - 1) / 2) * (CELL + GAP);
        const path = new THREE.Path();
        path.absarc(cx, cy, holeR, 0, Math.PI * 2, false);
        outer.holes.push(path);
      }
    }
    const eg = new THREE.ExtrudeGeometry(outer, {
      depth: depth,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      bevelSegments: 2,
      curveSegments: 32,
      steps: 1,
    });
    eg.center();
    return eg;
  }, []);
  return (
    <mesh geometry={geom} position={[0, 0, -depth * 0.6]} castShadow receiveShadow raycast={() => null}>
      <meshStandardMaterial color="#1e3a8a" emissive="#1e40af" emissiveIntensity={0.35} metalness={0.25} roughness={0.45} />
    </mesh>
  );
}

function BackPlate() {
  // Behind the holes, a dim back panel to add contrast
  const w = COLS * (CELL + GAP) - GAP + 0.4;
  const h = ROWS * (CELL + GAP) - GAP + 0.4;
  return (
    <mesh position={[0, 0, -BOARD_THICK - 0.2]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color="#0b1533" emissive="#0c1840" emissiveIntensity={0.35} metalness={0.1} roughness={0.9} />
    </mesh>
  );
}

function SideSupports() {
  // Simple side feet/legs under the board
  const footW = 0.4, footH = 0.2, footL = 1.8;
  const w = COLS * (CELL + GAP) - GAP;
  return (
    <group position={[0, -((CELL + GAP) / 2) - 0.45, -0.3]}>
      <mesh position={[w / 2 + 0.45, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[footW, footH, footL]} />
        <meshStandardMaterial color="#1b2f6e" emissive="#1b2f6e" emissiveIntensity={0.22} metalness={0.25} roughness={0.5} />
      </mesh>
      <mesh position={[-(w / 2 + 0.45), 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[footW, footH, footL]} />
        <meshStandardMaterial color="#1b2f6e" emissive="#1b2f6e" emissiveIntensity={0.22} metalness={0.25} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Piece({ color = '#e63946', x, row }) {
  const ref = useRef();
  // Centered coordinate system: bottom row at -(ROWS-1)/2 * (CELL+GAP)
  const targetY = (row - (ROWS - 1) / 2) * (CELL + GAP);
  const startY = ROWS * (CELL + GAP) + 2;
  const vy = useRef(0);
  useFrame((_, dt) => {
    if (!ref.current) return;
    // basic gravity drop
    if (ref.current.position.y > targetY) {
      vy.current = Math.min(vy.current + 20 * dt, 12);
      ref.current.position.y = Math.max(targetY, ref.current.position.y - vy.current * dt);
    }
  });
  return (
    <mesh ref={ref} position={[x, startY, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.46, 0.46, 0.18, 40]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.45} emissive={color} emissiveIntensity={0.22} />
    </mesh>
  );
}

function ColumnHotspot({ col, onSelect }) {
  const x = (col - (COLS - 1) / 2) * (CELL + GAP);
  const H = ROWS * (CELL + GAP) - GAP;
  return (
    <mesh position={[x, 0, 0]} onPointerDown={() => onSelect(col)}>
      <boxGeometry args={[CELL, H + 0.5, 1.2]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
}

export default function ConnectFour3DTest() {
  // Match Checkers screen layout and mobile sizing
  const isNarrow = (()=>{ try{ return typeof window!== 'undefined' && window.matchMedia('(max-width: 640px)').matches; }catch{return false;} })();
  const camPos  = isNarrow ? [0, 12.0, 16.2] : [0, 9.5, 12.8];
  const camFov  = isNarrow ? 54 : 40;
  const minDist = isNarrow ? 10 : 9;
  // Double the previous max zoom-out for testing scene as well
  const maxDist = isNarrow ? 40 : 28;
  const minPolar = isNarrow ? 0.06 : 0.08;
  const maxPolar = isNarrow ? Math.PI*0.42 : Math.PI*0.40;
  const azimuthRange = Math.PI * 0.50;
  const minAz = -azimuthRange;
  const maxAz =  azimuthRange;

  // Remove global bottom padding while on this screen (edge-to-edge), like Checkers
  useEffect(()=>{
    const cls='no-bottom-pad';
    try{
      const els=[document.documentElement, document.body, document.getElementById('root')].filter(Boolean);
      els.forEach(el=>{ try{ el.classList && el.classList.add(cls);}catch{} });
      return ()=>{ els.forEach(el=>{ try{ el.classList && el.classList.remove(cls);}catch{} }); };
    }catch{}
  }, []);

  // Derived sizes for board placement
  const GRID_H = ROWS * (CELL + GAP) - GAP;
  const PLATE_H = GRID_H + 0.6;
  const groupY = PLATE_H / 2 + 0.15; // lift so the bottom sits just above floor
  const [board, setBoard] = useState(() => Array.from({ length: ROWS }, () => Array(COLS).fill(0)));
  const [turn, setTurn] = useState(1); // 1 = Red, 2 = Yellow

  const place = useCallback((c) => {
    // find lowest empty row in column c
    let r = 0;
    for (let i = 0; i < ROWS; i++) if (board[i][c] === 0) r = i; else break;
    if (board[r][c] !== 0) return; // column full
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      // drop to the lowest empty slot
      for (let i = 0; i < ROWS; i++) {
        if (next[i][c] !== 0) { r = i - 1; break; }
        if (i === ROWS - 1) r = i;
      }
      next[r][c] = turn;
      return next;
    });
    setTurn((t) => (t === 1 ? 2 : 1));
  }, [board, turn]);

  const pieces = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (!v) continue;
      const x = (c - (COLS - 1) / 2) * (CELL + GAP);
      pieces.push(
        <Piece key={`p-${r}-${c}-${v}`} color={v === 1 ? '#ff3b5c' : '#ffd166'} x={x} row={r} />
      );
    }
  }

  return (
    <div className="cf-screen cf-checkers">
      <NavBar />
      <div className="nav-spacer" aria-hidden="true" />
      <main className="app-content app-content--full">
        <div className="game-area">
          <div className="board-fullwrap">
            <div className="board-shell">
              <Canvas
                frameloop={'always'}
                dpr={isNarrow ? 1 : 1}
                camera={{ position: camPos, fov: camFov, near:0.08, far:100 }}
                style={{ width: '100%', height: '100%' }}
                gl={{ powerPreference:'high-performance', antialias: isNarrow ? false : true, alpha:false, stencil:false, depth:true, preserveDrawingBuffer:false }}
                onCreated={(st)=>{ try{ st.gl.setClearColor('#0f172a'); }catch{} }}
              >
                <hemisphereLight intensity={0.8} groundColor={'#1b1b1b'} />
                <ambientLight intensity={0.75} />
                <directionalLight position={[4,12,8]} intensity={1.2} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
                <spotLight position={[0, 14.0, 8]} angle={0.9} penumbra={0.8} intensity={2.4} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
                <spotLight position={[0, 14.0, -8]} angle={0.9} penumbra={0.7} intensity={1.8} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
                <pointLight position={[0,8.0,0]} intensity={1.6} distance={50} decay={2} />
                <pointLight position={[8,6,0]} intensity={0.9} distance={40} decay={2} />
                <pointLight position={[-8,6,0]} intensity={0.9} distance={40} decay={2} />

                <OrbitControls
                  makeDefault
                  target={[0,groupY,0]}
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

                <group position={[0, groupY, 0]} rotation={[0, 0, 0]}>
                  <BackPlate />
                  <FrontPlate />
                  <SideSupports />
                  {/* Floor */}
                  <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                    <planeGeometry args={[30, 30]} />
                    <meshStandardMaterial color="#0b1220" />
                  </mesh>
                  {/* Pieces */}
                  {pieces}
                  {/* Input hotspots */}
                  {Array.from({ length: COLS }, (_, c) => (
                    <ColumnHotspot key={c} col={c} onSelect={place} />
                  ))}
                </group>
              </Canvas>
            </div>
          </div>
        </div>
        <div className="text-center text-light mt-2" style={{ opacity: 0.85 }}>
          3D Connect Four (test) — tap a column to drop a piece. Current: {turn === 1 ? 'Red' : 'Yellow'}
        </div>
      </main>
    </div>
  );
}
