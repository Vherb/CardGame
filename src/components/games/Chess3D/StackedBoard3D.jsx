import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, useGLTF, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function Piece({ t='P', color='#e5e7eb', rotationY=0 }){
  const map={ P:'pawn', R:'rook', N:'knight', B:'bishop', Q:'queen', K:'king', U:'queen' };
  const name = map[t]||'pawn';
  // Prefer low-poly models on mobile for performance, fallback to standard
  const isMobile = React.useMemo(()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} },[]);
  const lowUrl = `/models/chess/low_poly_${name}.glb`;
  const stdUrl = `/models/chess/${name}.glb`;
  const [url, setUrl] = React.useState(isMobile ? lowUrl : stdUrl);
  React.useEffect(()=>{
    let alive=true;
    if(isMobile){ (async()=>{ try{ const r=await fetch(lowUrl,{method:'HEAD'}); if(!alive) return; setUrl(r.ok?lowUrl:stdUrl); }catch{ if(alive) setUrl(stdUrl); } })(); }
    else { setUrl(stdUrl); }
    return ()=>{ alive=false; };
  },[isMobile, lowUrl, stdUrl]);
  const gltf = useGLTF(url);
  const scene = useMemo(()=>{
    const clone = gltf.scene.clone(true);
    clone.traverse(o=>{
      if(o.isMesh){
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const applyMat = (m)=>{
          if(!m) return m;
          const mat = m.clone();
          if(mat.color) mat.color = new THREE.Color(color);
          if('emissive' in mat) mat.emissive = new THREE.Color(color);
          if('emissiveIntensity' in mat) mat.emissiveIntensity = 0.08;
          mat.side = THREE.DoubleSide;
          if('depthWrite' in mat) mat.depthWrite = true;
          if('depthTest' in mat) mat.depthTest = true;
          return mat;
        };
        if(Array.isArray(o.material)){
          o.material = o.material.map(applyMat);
        } else if(o.material){
          o.material = applyMat(o.material);
        }
      }
    });
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone); const size = new THREE.Vector3(); box.getSize(size);
  const sFoot = 0.8/Math.max(1e-6, Math.max(size.x,size.z)); const sTall = 1.0/Math.max(1e-6,size.y); const s=Math.min(sFoot,sTall);
  const mobileScale = isMobile ? 0.75 : 1.0;
  clone.scale.setScalar(s * mobileScale);
    clone.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(clone); const center=new THREE.Vector3(); box2.getCenter(center);
    clone.position.x -= center.x; clone.position.z -= center.z; clone.position.y -= box2.min.y;
    try {
      if(rotationY){
        clone.rotation.y = rotationY;
        clone.updateMatrixWorld(true);
        const boxR = new THREE.Box3().setFromObject(clone);
        const ctrR = new THREE.Vector3(); boxR.getCenter(ctrR);
        clone.position.x -= ctrR.x; clone.position.z -= ctrR.z;
        // keep the piece sitting on the plane after rotation
        clone.position.y -= boxR.min.y;
        clone.updateMatrixWorld(true);
      }
    } catch {}
    return clone;
  },[gltf,color,rotationY,isMobile]);
  return <group frustumCulled={false}><primitive object={scene} /></group>;
}

function PulseLine({ points, color='#38bdf8', base=0.5, amp=0.3, speed=0.8, phase=0, width=1.6 }){
  const ref = useRef();
  const t = useRef(0);
  useFrame((_, delta) => {
    t.current += delta;
    const mat = ref.current?.material;
    if(mat){
      const op = Math.min(1, Math.max(0, base + amp * Math.sin(t.current * speed + phase)));
      mat.opacity = op;
      mat.needsUpdate = true;
    }
  });
  return <Line ref={ref} points={points} color={color} lineWidth={width} transparent opacity={base} />;
}

function GridLEDs({ size=5, color='#38bdf8', base=0.6, amp=0.25, speed=0.6, width=1.6 }){
  const gridColor = color;
  return (
    <group>
      {Array.from({length:size+1}).map((_,i)=> (
        <PulseLine key={`h-${i}`} points={[[0-0.5,0,i-0.5],[size-0.5,0,i-0.5]]} color={gridColor} width={width} phase={i*0.25} base={base} amp={amp} speed={speed} />
      ))}
      {Array.from({length:size+1}).map((_,i)=> (
        <PulseLine key={`v-${i}`} points={[[i-0.5,0,0-0.5],[i-0.5,0,size-0.5]]} color={gridColor} width={width} phase={i*0.25 + Math.PI/3} base={base} amp={amp} speed={speed} />
      ))}
    </group>
  );
}

function LevelPlane({ size=5, color='#38bdf8', base=0.08, amp=0.05, speed=0.6, phase=0, ...props }){
  const matRef = React.useRef();
  const t = React.useRef(0);
  useFrame((_, delta) => {
    t.current += delta;
    const mat = matRef.current;
    if(mat){
      const op = Math.min(1, Math.max(0, base + amp * Math.sin(t.current * speed + phase)));
      mat.opacity = op;
      mat.needsUpdate = true;
    }
  });
  return (
    <mesh {...props} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial ref={matRef} color={color} transparent blending={THREE.AdditiveBlending} opacity={base} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

export default function StackedBoard3D({ board, onCellClick, pieceColors, offsets, whiteKnightDeg = 180, whiteKnightZ = 0, selected=null, targets=[], lastMove=null, checkSq=null }){
  const levelGap = 1.1; const tile = 1;
  const LEVELS = Array.isArray(board) ? board.length : 1;
  const RANKS = Array.isArray(board?.[0]) ? board[0].length : 8;
  const FILES = Array.isArray(board?.[0]?.[0]) ? board[0][0].length : 8;
  const colW = (pieceColors && pieceColors.w) || '#e5e7eb';
  const colB = (pieceColors && pieceColors.b) || '#111827';

  const center = [(FILES - 1) / 2, ((LEVELS - 1) / 2) * levelGap, (RANKS - 1) / 2];

  const isMobile = React.useMemo(()=>{ try{ return typeof window!== 'undefined' && (window.matchMedia('(pointer:coarse)').matches || window.matchMedia('(max-width: 640px)').matches);}catch{return false;} },[]);

  return (
    <Canvas
      gl={{ antialias:true, logarithmicDepthBuffer:true }}
      camera={{ position: [10, 11, 10], fov: 45 }}
      style={{ position:'absolute', inset:0, width: '100%', height: '100%' }}
      onCreated={({ gl, camera }) => { 
        try { gl.setClearColor('#0f172a'); } catch {}
        try { camera.lookAt(center[0], center[1], center[2]); } catch {}
      }}
      shadows
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 12, 8]} intensity={0.9} castShadow />

      <OrbitControls
        makeDefault
        target={[center[0], center[1], center[2]]}
        autoRotate={false}
        enableDamping={false}
        dampingFactor={0}
        enableZoom={true}
        enablePan={true}
        minDistance={4}
        maxDistance={50}
        minPolarAngle={0.01}
        maxPolarAngle={Math.PI - 0.01}
        zoomSpeed={0.8}
        rotateSpeed={0.9}
        panSpeed={0.8}
        // Don’t let controls eat click if pointer didn’t drag
        onEnd={undefined}
      />

      <group>
        {Array.from({ length: LEVELS }).map((_, level) => (
          <group key={`lvl-${level}`} position={[0, level * levelGap, 0]}>
            <LevelPlane size={FILES} color={'#38bdf8'} base={isMobile?0.12:0.08} amp={isMobile?0.05:0.035} speed={0.55} phase={level * 0.5}
              rotation={[-Math.PI / 2, 0, 0]} position={[(FILES - 1) / 2, 0, (RANKS - 1) / 2]} raycast={() => null} />

            <group position={[0, 0.01, 0]} raycast={() => null}>
              <GridLEDs size={FILES} color={'#38bdf8'} base={isMobile?0.5:0.45} amp={isMobile?0.2:0.18} speed={0.6} width={isMobile?1.8:1.4} />
            </group>

            {Array.from({ length: RANKS }).map((__, r) =>
              Array.from({ length: FILES }).map((__, f) => {
                const isSel = selected && selected.l===level && selected.r===r && selected.f===f;
                const isTgt = targets && targets.some(t=> t.l===level && t.r===r && t.f===f);
                const isFrom = lastMove && lastMove.from && lastMove.from.l===level && lastMove.from.r===r && lastMove.from.f===f;
                const isTo   = lastMove && lastMove.to   && lastMove.to.l===level   && lastMove.to.r===r   && lastMove.to.f===f;
                const isCheck= checkSq && checkSq.l===level && checkSq.r===r && checkSq.f===f;
                const tgtInfo = isTgt ? (targets.find(t=> t.l===level && t.r===r && t.f===f) || null) : null;
                const color = isCheck ? '#ef4444' : (isFrom ? '#60a5fa' : (isTo ? '#93c5fd' : (isSel ? '#22c55e' : null)));
                return (
                  <group key={`t-${level}-${r}-${f}`}>
                    {color && (
                      <mesh position={[f, 0.006, r]} rotation={[-Math.PI/2,0,0]} raycast={() => null}>
                        <circleGeometry args={[0.38, 24]} />
                        <meshBasicMaterial color={color} transparent opacity={0.55} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} />
                      </mesh>
                    )}
                    {isTgt && (
                      tgtInfo && tgtInfo.capture ? (
                        <mesh position={[f, 0.006, r]} rotation={[-Math.PI/2,0,0]}
                              onClick={(e)=>{ e.stopPropagation(); onCellClick && onCellClick({ f, r, l: level }); }}>
                          <ringGeometry args={[0.22, 0.38, 24]} />
                          <meshBasicMaterial color={'#f97316'} transparent opacity={0.75} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} />
                        </mesh>
                      ) : (
                        <mesh position={[f, 0.006, r]} rotation={[-Math.PI/2,0,0]}
                              onClick={(e)=>{ e.stopPropagation(); onCellClick && onCellClick({ f, r, l: level }); }}>
                          <circleGeometry args={[0.14, 24]} />
                          <meshBasicMaterial color={'#f59e0b'} transparent opacity={0.9} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} depthWrite={false} />
                        </mesh>
                      )
                    )}
                    <mesh
                      position={[f, 0.0005, r]}
                      rotation={[-Math.PI / 2, 0, 0]}
                      renderOrder={-10}
                      userData={{ kind:'tile', cell:{ f, r, l: level } }}
                      onPointerOver={()=>{}}
                      raycast={() => null}
                    >
                      <planeGeometry args={[tile, tile]} />
                      <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
                    </mesh>
                  </group>
                );
              })
            )}

            <Suspense fallback={null}>
              {board?.[level]?.map((rankRow, r) =>
                rankRow.map((pc, f) => {
                  if(!pc) return null;
                  const t = pc.t;
                  const off = (offsets && offsets[t]) ? offsets[t] : { x:0, y:0, z:0 };
                  const unicornTint = '#a78bfa';
                  const pieceColor = t === 'U' ? unicornTint : (pc.c === 'w' ? colW : colB);
                  let rotationY = 0;
                  if(t === 'N'){
                    if(isMobile){
                      rotationY = -Math.PI / 2; // 90° clockwise on phones
                    } else if(pc.c === 'w'){
                      rotationY = (Number(whiteKnightDeg) * Math.PI / 180);
                    }
                  }
                  const extraZ = (t === 'N' && pc.c === 'w') ? Number(whiteKnightZ||0) : 0;
                  return (
                    <group
                      key={`p-${level}-${r}-${f}`}
                      position={[f + off.x, 0.012 + off.y, r + off.z + extraZ]}
                      renderOrder={10}
                      frustumCulled={false}
                      userData={{ kind:'piece', cell:{ f, r, l: level } }}
                      onPointerOver={()=>{}}
                      onClick={(e)=>{ e.stopPropagation(); onCellClick && onCellClick({ f, r, l: level }); }}
                    >
                      <mesh raycast={undefined} renderOrder={-1000}>
                        <cylinderGeometry args={[0.5, 0.5, 1.0, 12]} />
                        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
                      </mesh>
                      <Piece t={t} color={pieceColor} rotationY={rotationY} />
                    </group>
                  );
                })
              )}
            </Suspense>
          </group>
        ))}
      </group>
    </Canvas>
  );
}

// Preload both std and low-poly GLBs for snappier loads on phones
try{
  const names=['pawn','rook','knight','bishop','queen','king'];
  names.forEach(n=>{ try{ useGLTF.preload(`/models/chess/${n}.glb`); }catch{} });
  names.forEach(n=>{ try{ useGLTF.preload(`/models/chess/low_poly_${n}.glb`); }catch{} });
}catch{}
