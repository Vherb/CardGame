import React, { Suspense, useMemo, useLayoutEffect, useRef, useEffect, useState, useCallback, forwardRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';

// List of avatar model paths to showcase (robot + alien, side by side)
const AVATARS = [
  { id: 'robot', url: '/models/avatars/robot/scene.gltf' },
  { id: 'alien', url: '/models/avatars/alien/scene.gltf' },
].filter(Boolean);

// Basic load: keep authored transforms and scale; only shift Y so the model rests on the floor (minY -> 0).
function NormalizedGLTF({ url }) {
  const { scene, animations } = useGLTF(url);
  const targetObject = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const innerRef = useRef(); // ref to the normalized model root
  useLayoutEffect(() => {
    if (!targetObject) return;
    targetObject.traverse((o) => {
      if (o.isSkinnedMesh && o.material && !o.material.skinning) {
        o.material.skinning = true;
        o.material.needsUpdate = true;
      }
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
  }, [targetObject]);

  // Ground the model at Y=0 (no scaling, no XZ recenter)
  useLayoutEffect(() => {
    if (!innerRef.current) return;
    const root = innerRef.current;
    const box = new THREE.Box3().setFromObject(root);
    if (!box.isEmpty()) {
      // Ground on Y only
      root.position.y += -box.min.y;
    }
  }, [targetObject]);

  // No animation playback in basic sandbox mode

  if (!targetObject) return null;
  return (
    <primitive ref={innerRef} object={targetObject} dispose={null} />
  );
}

export default function AvatarSandbox() {
  // Two avatars side-by-side. Toggles for: movement (WASD/arrows), click-to-move, and which character is controlled.

  // Simple mover with optional keyboard control and click target
  const Mover = useMemo(() => forwardRef(function MoverInner({ enabled, speed=10, base=[0,0,0], moveTarget=null, onArrive, children }, ref){
    const localRef = useRef();
    const groupRef = ref || localRef;
    const keys = useRef({});
    const target = useRef(moveTarget);
    useEffect(()=>{ target.current = moveTarget || null; }, [moveTarget]);
    useEffect(()=>{
      const dn = (e)=>{ keys.current[e.key.toLowerCase()] = true; };
      const up = (e)=>{ keys.current[e.key.toLowerCase()] = false; };
      window.addEventListener('keydown', dn);
      window.addEventListener('keyup', up);
      return ()=>{ window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
    },[]);
    useFrame((_, dt)=>{
      const g = groupRef.current; if (!g) return;
      if (enabled){
        let dx=0, dz=0;
        const k = keys.current;
        if (k['arrowup']||k['w']) dz -= 1;
        if (k['arrowdown']||k['s']) dz += 1;
        if (k['arrowleft']||k['a']) dx -= 1;
        if (k['arrowright']||k['d']) dx += 1;
        if (dx!==0||dz!==0){
          const len = Math.hypot(dx,dz)||1; dx/=len; dz/=len;
          g.position.x += dx*speed*dt;
          g.position.z += dz*speed*dt;
          target.current = null; // cancel click target on manual input
          return;
        }
      }
      if (target.current){
        const tx = target.current.x - base[0];
        const tz = target.current.z - base[2];
        const cx = g.position.x; const cz = g.position.z;
        const vx = tx - cx; const vz = tz - cz; const d = Math.hypot(vx,vz);
        if (d<0.06){ g.position.set(tx, 0, tz); target.current=null; onArrive && onArrive(); }
        else { const step = Math.min(d, (enabled?speed:6)*dt); g.position.x += (vx/d)*step; g.position.z += (vz/d)*step; }
      }
    });
    return <group ref={groupRef} position={[0,0,0]}>{children}</group>;
  }), []);

  const spacing = 9;
  const ids = ['robot','alien'];
  const baseById = useMemo(() => ({
    robot: (0 - (ids.length - 1) / 2) * spacing,
    alien: (1 - (ids.length - 1) / 2) * spacing,
  }), []);

  const robotRef = useRef();
  const alienRef = useRef();
  const [activeId, setActiveId] = useState('robot');
  const [moveEnabled, setMoveEnabled] = useState(true);
  const [clickMove, setClickMove] = useState(true);
  const [robotTarget, setRobotTarget] = useState(null);
  const [alienTarget, setAlienTarget] = useState(null);

  const handleFloorClick = useCallback((e)=>{
    if (!clickMove || !moveEnabled) return;
    const pt = e?.point; if (!pt) return;
    const tgt = { x: pt.x, z: pt.z };
    if (activeId==='robot') setRobotTarget(tgt); else setAlienTarget(tgt);
  }, [activeId, clickMove, moveEnabled]);

  return (
    <div style={{ width:'100%', height:'100vh', background:'#0b1324', color:'#fff' }}>
      <Canvas shadows camera={{ position:[0, 6, 28], fov: 45 }} dpr={[1,2]}>
        <color attach="background" args={['#0b1324']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[18,22,12]} intensity={0.9} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <OrbitControls makeDefault enablePan={true} minDistance={10} maxDistance={80} />
        {/* Ground (soft grey) + click capture */}
        <mesh rotation={[-Math.PI/2,0,0]} receiveShadow position={[0,-0.02,0]} onPointerDown={handleFloorClick}> 
          <planeGeometry args={[240, 120]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.95} metalness={0.02} />
        </mesh>
        <Suspense fallback={null}>
          {/* Robot */}
          <group position={[baseById.robot, 0, 0]}>
            <Mover ref={robotRef} enabled={moveEnabled && activeId==='robot'} speed={10} base={[baseById.robot,0,0]} moveTarget={activeId==='robot' ? robotTarget : null} onArrive={() => setRobotTarget(null)}>
              <NormalizedGLTF url="/models/avatars/robot/scene.gltf" />
            </Mover>
          </group>
          {/* Alien */}
          <group position={[baseById.alien, 0, 0]}>
            <Mover ref={alienRef} enabled={moveEnabled && activeId==='alien'} speed={10} base={[baseById.alien,0,0]} moveTarget={activeId==='alien' ? alienTarget : null} onArrive={() => setAlienTarget(null)}>
              <NormalizedGLTF url="/models/avatars/alien/scene.gltf" />
            </Mover>
          </group>
        </Suspense>
      </Canvas>
      {/* Minimal controls: choose active character and enable/disable arrow/click movement */}
      <div style={{ position:'absolute', top:10, left:12, fontFamily:'monospace', fontSize:14, background:'rgba(0,0,0,0.35)', padding:'6px 10px', borderRadius:8, maxWidth: 320 }}>
        <strong>Sandbox Controls</strong>
        <div style={{ marginTop:6 }}>
          <div>
            <label style={{marginRight:8}}><input type="radio" name="activeChar" value="robot" checked={activeId==='robot'} onChange={()=>setActiveId('robot')} /> Robot</label>
            <label><input type="radio" name="activeChar" value="alien" checked={activeId==='alien'} onChange={()=>setActiveId('alien')} /> Alien</label>
          </div>
          <label style={{display:'block', marginTop:6}}>
            <input type="checkbox" checked={moveEnabled} onChange={(e)=>setMoveEnabled(e.target.checked)} /> Movement (arrows/WASD)
          </label>
          <label style={{display:'block', marginTop:4}}>
            <input type="checkbox" checked={clickMove} onChange={(e)=>setClickMove(e.target.checked)} /> Click-to-move
          </label>
          <button style={{marginTop:6}} onClick={()=>{ setRobotTarget(null); setAlienTarget(null); }}>Clear Target</button>
        </div>
      </div>
    </div>
  );
}

// Preload models (GLTF/FBX)
AVATARS.forEach(v => {
  try {
    useGLTF.preload(v.url);
  } catch {}
});
