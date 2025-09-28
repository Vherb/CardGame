/* eslint-disable no-console */
import React, { Suspense, useCallback, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

const SIZE = 8;

const AnimatedPiece = React.memo(function AnimatedPiece({ to=[0,0,0], from, children, speed=10, lift=0.08, onSettled }){
  const ref = useRef();
  const prevTo = useRef([NaN,NaN,NaN]);
  const startRef = useRef([0,0,0]);
  const endRef = useRef([0,0,0]);
  const totalXZRef = useRef(0.000001);
  const target = to;
  const nearlyEq = (a,b,eps=1e-4)=> Math.abs(a[0]-b[0])<eps && Math.abs(a[1]-b[1])<eps && Math.abs(a[2]-b[2])<eps;
  const distXZ = (a,b)=>{ const dx=(a[0]-b[0]); const dz=(a[2]-b[2]); return Math.sqrt(dx*dx+dz*dz); };
  React.useEffect(()=>{
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
});

function Piece3D({ pc, tint }){
  const color = tint || '#e5e7eb';
  const metal = { metalness: 0.2, roughness: 0.55, emissive: color, emissiveIntensity: 0.05 };
  let piece = null;
  switch(pc.t){
    case 'p': piece = (
      <group>
        <mesh position={[0,0.2,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.35,0.45,0.2,24]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
        <mesh position={[0,0.5,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.22,0.28,0.5,20]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
        <mesh position={[0,0.9,0]} castShadow receiveShadow>
          <sphereGeometry args={[0.18, 16, 16]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
      </group>
    ); break;
    case 'r': piece = (
      <group>
        <mesh position={[0,0.2,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.38,0.5,0.25,24]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
        <mesh position={[0,0.6,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.34,0.34,0.7,20]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
      </group>
    ); break;
    case 'n': piece = (
      <group>
        <mesh position={[0,0.25,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.38,0.5,0.25,24]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
        <mesh position={[0,0.75,0]} rotation={[0,Math.PI/8,0]} castShadow receiveShadow>
          <boxGeometry args={[0.5,0.9,0.3]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
      </group>
    ); break;
    case 'b': piece = (
      <group>
        <mesh position={[0,0.2,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.36,0.48,0.22,24]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
        <mesh position={[0,0.7,0]} castShadow receiveShadow>
          <coneGeometry args={[0.3,0.9,20]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
      </group>
    ); break;
    case 'q': piece = (
      <group>
        <mesh position={[0,0.25,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.42,0.52,0.25,24]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
        <mesh position={[0,0.9,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.28,0.36,1.0,24]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
      </group>
    ); break;
    case 'k': piece = (
      <group>
        <mesh position={[0,0.25,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.44,0.54,0.28,24]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
        <mesh position={[0,1.0,0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.3,0.38,1.2,24]} />
          <meshStandardMaterial color={color} {...metal} />
        </mesh>
      </group>
    ); break;
    default: piece = null;
  }
  return <group scale={[0.6,0.6,0.6]}>{piece}</group>;
}

function Lights(){
  return (
    <group>
      <hemisphereLight intensity={0.5} groundColor={'#1b1b1b'} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[6,10,6]} intensity={0.7} />
    </group>
  );
}

export default function ChessVector3D({ board, myColor, lastMove, onCellClick, selected, moves, pieceColors, hint, checkKing }){
  const tile = 1;
  const pieceY = 0.0;
  const isMobile = useMemo(()=>{
    try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;}
  },[]);

  const posFor = useCallback((pc, r, c)=>{
    const x = c*tile;
    const z = r*tile;
    const y = pieceY + 0.02;
    return [x, y, z];
  }, [tile]);

  const onTileClick = useCallback((r,c)=> onCellClick && onCellClick(r,c), [onCellClick]);

  const camPos = useMemo(()=> (isMobile ? [3.5, 10.5, 15.5] : [3.5, 8.5, 12.0]), [isMobile]);
  const camFov = isMobile ? 50 : 40;
  const minDist = isMobile ? 10.5 : 9;
  const maxDist = isMobile ? 18 : 14;
  const minPolar = 0.06; const maxPolar = Math.PI*0.42;
  const minAz = -Math.PI*0.02, maxAz = Math.PI*0.02;

  const pieceTint = (pc)=> (pc.c==='w' ? (pieceColors?.w || '#e5e7eb') : (pieceColors?.b || '#111827'));

  return (
    <Canvas
      frameloop={'always'}
      dpr={isMobile ? 1 : 1}
      camera={{ position: camPos, fov: camFov, near:0.08, far:100 }}
      style={{ width:'100%', height:'100%', touchAction:'none' }}
      gl={{ powerPreference:'high-performance', antialias: isMobile ? false : true, alpha:false, stencil:false, depth:true, preserveDrawingBuffer:false }}
      onCreated={(st)=>{ try{ st.gl.setClearColor('#0f172a'); }catch{} }}
    >
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
        zoomSpeed={isMobile ? 0.8 : 0.9}
      />
      <Lights />

      <group position={[3.5,0,3.5]} rotation={[0, myColor==='b'?Math.PI:0, 0]}>
        <group position={[-3.5,0,-3.5]}>
          {/* Base */}
          <mesh receiveShadow rotation={[-Math.PI/2,0,0]} position={[3.5,-0.05,3.5]} raycast={() => null}>
            <planeGeometry args={[SIZE,SIZE]} />
            <meshStandardMaterial color={'#0b0f1a'} />
          </mesh>
          {/* Vector grid using fat lines (resolution independent) */}
          <group position={[0,0.012,0]}>
            {Array.from({length:SIZE+1}).map((_,i)=> (
              <Line key={`h-${i}`} points={[[0-0.5,0,i-0.5],[SIZE-0.5,0,i-0.5]]} color="#22d3ee" lineWidth={1.5} transparent opacity={0.65} />
            ))}
            {Array.from({length:SIZE+1}).map((_,i)=> (
              <Line key={`v-${i}`} points={[[i-0.5,0,0-0.5],[i-0.5,0,SIZE-0.5]]} color="#22d3ee" lineWidth={1.5} transparent opacity={0.65} />
            ))}
          </group>

          {/* Click tiles (invisible planes) + highlights */}
          {Array.from({length:SIZE}).map((_,r)=>Array.from({length:SIZE}).map((_,c)=>{
            const x=c, z=r;
            const isSel = !!(selected && selected.r===r && selected.c===c);
            const isMove = !!(moves?.some(m=>m.r2===r && m.c2===c));
            const isHintFrom = !!(hint && hint.from && hint.from.r===r && hint.from.c===c);
            const isHintTo = !!(hint && hint.to && hint.to.r2===r && hint.to.c2===c);
            const isCheck = !!(checkKing && checkKing.r===r && checkKing.c===c);
            return (
              <group key={`t-${r}-${c}`}>
                <mesh position={[x,0.0005,z]} rotation={[-Math.PI/2,0,0]} onClick={()=>onTileClick(r,c)}>
                  <planeGeometry args={[tile,tile]} />
                  <meshBasicMaterial transparent opacity={0} />
                </mesh>
                {isCheck && (
                  <mesh position={[x,0.036,z]} rotation={[-Math.PI/2,0,0]}>
                    <ringGeometry args={[0.22,0.34,40]} />
                    <meshStandardMaterial color={'#ef4444'} emissive={'#ef4444'} emissiveIntensity={0.85} transparent opacity={0.95} side={THREE.DoubleSide} />
                  </mesh>
                )}
                {isSel && (
                  <mesh position={[x,0.03,z]} rotation={[-Math.PI/2,0,0]}>
                    <ringGeometry args={[0.22,0.32,32]} />
                    <meshStandardMaterial color={'#a78bfa'} emissive={'#a78bfa'} emissiveIntensity={0.75} side={THREE.DoubleSide} />
                  </mesh>
                )}
                {isMove && (
                  <mesh position={[x,0.025,z]} rotation={[-Math.PI/2,0,0]}>
                    <ringGeometry args={[0.18,0.26,32]} />
                    <meshStandardMaterial color={'#22d3ee'} emissive={'#22d3ee'} emissiveIntensity={0.6} transparent opacity={0.95} side={THREE.DoubleSide} />
                  </mesh>
                )}
                {isHintFrom && (
                  <mesh position={[x,0.022,z]} rotation={[-Math.PI/2,0,0]}>
                    <ringGeometry args={[0.20,0.30,40]} />
                    <meshStandardMaterial color={'#f59e0b'} emissive={'#f59e0b'} emissiveIntensity={0.7} transparent opacity={0.95} side={THREE.DoubleSide} />
                  </mesh>
                )}
                {isHintTo && (
                  <mesh position={[x,0.018,z]} rotation={[-Math.PI/2,0,0]}>
                    <ringGeometry args={[0.16,0.24,40]} />
                    <meshStandardMaterial color={'#22c55e'} emissive={'#22c55e'} emissiveIntensity={0.7} transparent opacity={0.95} side={THREE.DoubleSide} />
                  </mesh>
                )}
              </group>
            );
          }))}

          {/* Pieces */}
          <Suspense fallback={null}>
            {board.map((row,r)=>row.map((pc,c)=>{
              if(!pc) return null;
              const toPos = posFor(pc, r, c);
              const key = `${pc.c}-${pc.t}-${r}-${c}`;
              let fromPos = undefined;
              if(lastMove && lastMove.r2===r && lastMove.c2===c){
                fromPos = posFor(pc, lastMove.r, lastMove.c);
              }
              return (
                <AnimatedPiece key={`p-${r}-${c}`} to={toPos} from={fromPos} speed={isMobile?14:10} lift={isMobile?0.06:0.10}>
                  <Piece3D pc={pc} tint={pieceTint(pc)} />
                </AnimatedPiece>
              );
            }))}
          </Suspense>
        </group>
      </group>
    </Canvas>
  );
}
