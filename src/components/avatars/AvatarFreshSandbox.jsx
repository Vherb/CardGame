import React, { useMemo, useRef, useState, useLayoutEffect, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useFBX, useAnimations, Billboard, Text } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';

function BasicGLTFModel({ url, scale=1, position=[0,0,0], yawOffset=0 }){
  const { scene } = useGLTF(url);
  const model = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const ref = useRef();
  useLayoutEffect(() => {
    if (!ref.current) return;
    const box = new THREE.Box3().setFromObject(ref.current);
    if (!box.isEmpty()) {
      ref.current.position.y += -box.min.y;
    }
    ref.current.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [model]);
  if (!model) return null;
  return (
    <group position={position}>
      <group ref={ref} scale={scale} rotation={[0, yawOffset, 0]}>
        <primitive object={model} dispose={null} />
      </group>
    </group>
  );
}

function BasicFBXModel({ url, scale=1, position=[0,0,0], yawOffset=0 }){
  const fbx = useFBX(url);
  const model = useMemo(() => (fbx ? skeletonClone(fbx) : null), [fbx]);
  const ref = useRef();
  // Hook animations to the model's root so tracks bind to the skinned meshes/bones underneath
  const { actions, names, mixer } = useAnimations((fbx && fbx.animations) ? fbx.animations : [], ref);

  // Ground at Y=0, enable shadows, disable frustum culling for skinned meshes
  useLayoutEffect(() => {
    if (!ref.current) return;
    const box = new THREE.Box3().setFromObject(ref.current);
    if (!box.isEmpty()) {
      ref.current.position.y += -box.min.y;
    }
    ref.current.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [model]);

  // Auto-play an idle clip if present, otherwise the first clip
  useEffect(() => {
    if (!actions || !names || names.length === 0) return;
    const pick = names.find(n => /idle|happy/i.test(n)) || names[0];
    const act = actions[pick];
    if (!act) return;
    act.reset();
    act.setLoop(THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = false;
    act.fadeIn(0.15).play();
    return () => {
      act.fadeOut(0.1);
    };
  }, [actions, names]);

  // Advance the FBX mixer each frame
  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
  });

  if (!model) return null;
  return (
    <group position={position}>
      <group ref={ref} scale={scale} rotation={[0, yawOffset, 0]}>
        <primitive object={model} dispose={null} />
      </group>
    </group>
  );
}

function TankMover({
  initialPosition=[0,0,0],
  initialYaw=0,
  moveSpeed=8,
  turnSpeed=2.4,
  keys={ forward:['arrowup'], back:['arrowdown'], left:['arrowleft'], right:['arrowright'] },
  forwardVec=[0,0,-1],
  yawBasis=0,
  forwardSign=1,
  onPose,
  outRef,
  children
}){
  const ref = useRef(); // actor root (rotate + translate this)
  const yawRef = useRef(initialYaw);
  const keysRef = useRef({});

  useEffect(() => {
    const dn = (e) => { keysRef.current[e.key.toLowerCase()] = true; };
    const up = (e) => { keysRef.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  // Initialize position once (avoid array dep re-runs that snap back)
  useEffect(() => {
    if (ref.current) {
      ref.current.position.set(initialPosition[0], initialPosition[1], initialPosition[2]);
      yawRef.current = initialYaw;
      ref.current.rotation.set(0, yawBasis + initialYaw, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dt) => {
    const root = ref.current; if (!root) return;
    const k = keysRef.current;
    let turning = 0, moving = 0;
    // Determine inputs by configured keys (arrays)
    const any = (arr) => Array.isArray(arr) && arr.some((key) => k[key.toLowerCase()]);
    const forwardPressed = any(keys.forward);
    const backPressed = any(keys.back);
    if (any(keys.left)) turning += 1;   // left arrow should turn left (positive yaw)
    if (any(keys.right)) turning -= 1;  // right arrow should turn right (negative yaw)
    if (forwardPressed) moving += 1;
    if (backPressed) moving -= 1;

    // Apply turn (around the basis)
    if (turning !== 0) {
      yawRef.current += turning * turnSpeed * dt;
    }
  const effYaw = yawBasis + yawRef.current;
  root.rotation.y = effYaw;

    // Apply forward/back using the visible heading of the root node
    let speedAbs = 0;
    if (moving !== 0) {
      const dir = new THREE.Vector3(0,0,-1); // model-space forward
      dir.applyAxisAngle(new THREE.Vector3(0,1,0), effYaw); // rotate by effYaw
      dir.y = 0; dir.normalize();
      const step = moveSpeed * dt * moving * (forwardSign || 1);
      root.position.x += dir.x * step;
      root.position.z += dir.z * step;
      speedAbs = Math.abs(step) / (dt || 0.016);
    }

    // emit pose for HUD/labels
    if (onPose) {
      onPose({
        x: root.position.x,
        y: root.position.y,
        z: root.position.z,
        yawRad: effYaw,
        yawDeg: (effYaw * 180) / Math.PI,
        moving: moving !== 0,
        speed: speedAbs,
        forwardPressed
      });
    }
  });

  useLayoutEffect(() => { if (outRef && typeof outRef === 'object') { outRef.current = ref.current; } }, [outRef]);
  return <group ref={ref}>{children}</group>;
}

// Specialized Ninja model that merges base FBX (with mesh) and an animation-only FBX (walk),
// and switches between Idle and Walk based on isMoving.
function NinjaFBXModel({ baseUrl, walkUrl, isWalking=false, scale=1, position=[0,0,0], yawOffset=0 }){
  // Always load both in fixed hook order
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  // Use the original FBX object to avoid any potential binding issues with animations
  const model = base;
  const ref = useRef();

  // Merge animations from both sources
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const baseAnims = useMemo(() => (
    baseAnimsRaw.map(c => new THREE.AnimationClip(`base:${c.name || 'clip'}`, c.duration, c.tracks))
  ), [baseAnimsRaw]);
  const walkAnims = useMemo(() => (
    walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, c.tracks))
  ), [walkAnimsRaw]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims]), [baseAnims, walkAnims]);

  const { actions, names, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (names && names.length) {
      // Helpful debug to confirm we see clips in the FBX files
      // eslint-disable-next-line no-console
      console.log('[NinjaFBXModel] Clips:', names);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[NinjaFBXModel] No animation clips found on provided FBX files');
    }
  }, [names]);

  // Ground and render settings on the model directly
  useLayoutEffect(() => {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    if (!box.isEmpty()) {
      model.position.y += -box.min.y;
    }
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [model]);

  // Helper to crossfade to a named action if it exists
  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) {
      prev.fadeOut(0.12);
    }
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    next.timeScale = 1.0;
    currentActionRef.current = next;
  };

  // Choose best matching clip names
  // Prefer idle from baseAnims and walk from walkAnims to avoid fallback collisions
  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(happy|idle)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);
  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  // Log resolved choices after they are defined
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[NinjaFBXModel] pickIdleName:', pickIdleName, 'pickWalkName:', pickWalkName, 'actions:', actions ? Object.keys(actions) : []);
  }, [pickIdleName, pickWalkName, actions]);

  // Initialize to idle once, then react to movement changes without hard-stopping actions
  useEffect(() => {
    if (!actions) return;
    // First-time setup: start idle immediately to avoid any bind-pose flash
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = 1.0;
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return; // wait for next render to process walking state
    }

    // Subsequent updates: cross-fade between walk and idle as needed
    if (isWalking && pickWalkName) {
      crossFadeTo(pickWalkName);
    } else if (pickIdleName) {
      crossFadeTo(pickIdleName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWalking, pickIdleName, pickWalkName, actions]);

  // Advance animation time
  useFrame((_, dt) => { if (mixer && dt) mixer.update(dt); });

  if (!model) return null;
  return (
    <group position={position}>
      <group scale={scale} rotation={[0, yawOffset, 0]}>
        <primitive ref={ref} object={model} dispose={null} />
      </group>
    </group>
  );
}

// Alien2: generic FBX character that behaves like Ninja (Idle when stopped, Walk when moving)
function Alien2FBXModel({ baseUrl, walkUrl, runUrl, isWalking=false, scale=1, position=[0,0,0], yawOffset=0 }){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  // Always call the hook; if runUrl is falsy, load base again and ignore animations via hasRun flag
  const run = useFBX(runUrl ?? baseUrl);
  const hasRun = !!runUrl;
  const model = base;
  const ref = useRef();

  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((hasRun && run && run.animations)  ? run.animations  : []), [hasRun, run]);
  const baseAnims = useMemo(() => (
    baseAnimsRaw.map(c => new THREE.AnimationClip(`base:${c.name || 'clip'}`, c.duration, c.tracks))
  ), [baseAnimsRaw]);
  const walkAnims = useMemo(() => (
    walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, c.tracks))
  ), [walkAnimsRaw]);
  const runAnims = useMemo(() => (
    runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, c.tracks))
  ), [runAnimsRaw]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims]), [baseAnims, walkAnims, runAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);

  useLayoutEffect(() => {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    if (!box.isEmpty()) {
      model.position.y += -box.min.y;
    }
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.12);
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    next.timeScale = 1.0;
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(happy|idle)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);
  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = 1.0;
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    if (isWalking && pickWalkName) {
      crossFadeTo(pickWalkName);
    } else if (pickIdleName) {
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, pickIdleName, pickWalkName, actions]);

  useFrame((_, dt) => { if (mixer && dt) mixer.update(dt); });

  if (!model) return null;
  return (
    <group position={position}>
      <group scale={scale} rotation={[0, yawOffset, 0]}>
        <primitive ref={ref} object={model} dispose={null} />
      </group>
    </group>
  );
}

export default function AvatarFreshSandbox(){
  const [robotScale, setRobotScale] = useState(1);
  const [alienScale, setAlienScale] = useState(1);
  const [ninjaScale, setNinjaScale] = useState(1);
  const [alien2Scale, setAlien2Scale] = useState(1);
  const [active, setActive] = useState('ninja'); // 'robot' | 'alien' | 'ninja' | 'alien2'
  const [robotPose, setRobotPose] = useState({x:0,y:0,z:0,yawDeg:0});
  const [alienPose, setAlienPose] = useState({x:0,y:0,z:0,yawDeg:0});
  const [ninjaPose, setNinjaPose] = useState({x:0,y:0,z:0,yawDeg:0});
  const [alien2Pose, setAlien2Pose] = useState({x:0,y:0,z:0,yawDeg:0});
  // Alien POV camera state (fresh POV system)
  const [alienPovMode, setAlienPovMode] = useState('orbit'); // 'orbit' | 'third' | 'shoulder' | 'first'
  const [alienPovSmooth, setAlienPovSmooth] = useState(true);
  const [alienPovDist, setAlienPovDist] = useState(24);
  const [alienPovHeight, setAlienPovHeight] = useState(2.2);
  const [alienPovSide, setAlienPovSide] = useState(1.4);
  const alienGroupRef = useRef(null);
  const alien2GroupRef = useRef(null);
  const spacing = 12;
  return (
    <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', width:'100%', height:'100vh', background:'#0b1324', color:'#fff' }}>
      {/* Left panel (teak style) */}
      <div style={{ background:'#704214', color:'#fff', padding:'14px 16px', boxShadow:'inset 0 0 0 2px rgba(0,0,0,0.25)', borderRight:'2px solid #3b220c' }}>
        <div style={{ fontWeight:700, marginBottom:10 }}>Model Scaling</div>
        <div style={{ marginBottom:10 }}>
          <div>Robot Scale: {robotScale.toFixed(2)}</div>
          <input type="range" min={0.05} max={3} step={0.01} value={robotScale} onChange={(e)=>setRobotScale(parseFloat(e.target.value))} style={{ width:'100%' }} />
        </div>
        {/* Alien POV controls */}
        <div style={{ marginTop:14, paddingTop:10, borderTop:'1px solid rgba(0,0,0,0.25)' }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Alien POV</div>
          <div style={{ display:'grid', gap:6, fontSize:13 }}>
            <label><input type="radio" name="alienPovMode" value="orbit" checked={alienPovMode==='orbit'} onChange={()=>setAlienPovMode('orbit')} /> Orbit</label>
            <label><input type="radio" name="alienPovMode" value="third" checked={alienPovMode==='third'} onChange={()=>setAlienPovMode('third')} /> Third-person</label>
            <label><input type="radio" name="alienPovMode" value="shoulder" checked={alienPovMode==='shoulder'} onChange={()=>setAlienPovMode('shoulder')} /> Over-shoulder</label>
            <label><input type="radio" name="alienPovMode" value="first" checked={alienPovMode==='first'} onChange={()=>setAlienPovMode('first')} /> First-person</label>
          </div>
          <div style={{ marginTop:8 }}>
            <label><input type="checkbox" checked={alienPovSmooth} onChange={e=>setAlienPovSmooth(e.target.checked)} /> Smooth camera</label>
          </div>
          {(alienPovMode==='third' || alienPovMode==='shoulder') && (
            <>
              <div style={{ marginTop:8 }}>Distance: {alienPovDist.toFixed(1)}</div>
              <input type="range" min={4} max={80} step={0.5} value={alienPovDist} onChange={e=>setAlienPovDist(parseFloat(e.target.value))} style={{ width:'100%' }} />
            </>
          )}
          {alienPovMode!=='orbit' && (
            <>
              <div style={{ marginTop:8 }}>Height: {alienPovHeight.toFixed(2)}</div>
              <input type="range" min={0.8} max={4.0} step={0.05} value={alienPovHeight} onChange={e=>setAlienPovHeight(parseFloat(e.target.value))} style={{ width:'100%' }} />
            </>
          )}
          {alienPovMode==='shoulder' && (
            <>
              <div style={{ marginTop:8 }}>Side Offset: {alienPovSide.toFixed(2)}</div>
              <input type="range" min={-2.5} max={2.5} step={0.05} value={alienPovSide} onChange={e=>setAlienPovSide(parseFloat(e.target.value))} style={{ width:'100%' }} />
            </>
          )}
        </div>
        <div style={{ marginBottom:10 }}>
          <div>Alien Scale: {alienScale.toFixed(2)}</div>
          <input type="range" min={0.05} max={3} step={0.01} value={alienScale} onChange={(e)=>setAlienScale(parseFloat(e.target.value))} style={{ width:'100%' }} />
        </div>
        <div style={{ marginBottom:10 }}>
          <div>Ninja Scale: {ninjaScale.toFixed(2)}</div>
          <input type="range" min={0.05} max={3} step={0.01} value={ninjaScale} onChange={(e)=>setNinjaScale(parseFloat(e.target.value))} style={{ width:'100%' }} />
        </div>
        <div style={{ marginBottom:10 }}>
          <div>Alien 2 Scale: {alien2Scale.toFixed(2)}</div>
          <input type="range" min={0.05} max={3} step={0.01} value={alien2Scale} onChange={(e)=>setAlien2Scale(parseFloat(e.target.value))} style={{ width:'100%' }} />
        </div>
        <div style={{ marginTop:14, paddingTop:10, borderTop:'1px solid rgba(0,0,0,0.25)' }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Active Character</div>
          <label style={{ display:'block', marginBottom:6 }}>
            <input type="radio" name="activeCharFresh" value="robot" checked={active==='robot'} onChange={()=>setActive('robot')} /> Robot (Arrow keys)
          </label>
          <label style={{ display:'block' }}>
            <input type="radio" name="activeCharFresh" value="alien" checked={active==='alien'} onChange={()=>setActive('alien')} /> Alien (Arrow keys)
          </label>
          <label style={{ display:'block', marginTop:6 }}>
            <input type="radio" name="activeCharFresh" value="ninja" checked={active==='ninja'} onChange={()=>setActive('ninja')} /> Ninja (Arrow keys)
          </label>
          <label style={{ display:'block', marginTop:6 }}>
            <input type="radio" name="activeCharFresh" value="alien2" checked={active==='alien2'} onChange={()=>setActive('alien2')} /> Alien 2 (Arrow keys)
          </label>
          <div style={{ fontSize:12, opacity:0.9, marginTop:8 }}>Left/Right: Turn • Up/Down: Forward/Back</div>
        </div>
        <div style={{ marginTop:14, paddingTop:10, borderTop:'1px solid rgba(0,0,0,0.25)' }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Live Pose</div>
          <div style={{ fontSize:12, opacity:0.95, marginBottom:4 }}>
            <strong style={{ color:'#ef4444', opacity: active==='robot'?1:0.7 }}>Robot</strong> — X {robotPose.x.toFixed(2)} | Z {robotPose.z.toFixed(2)} | Yaw {robotPose.yawDeg.toFixed(1)}°
          </div>
          <div style={{ fontSize:12, opacity:0.95 }}>
            <strong style={{ color:'#22c55e', opacity: active==='alien'?1:0.7 }}>Alien</strong> — X {alienPose.x.toFixed(2)} | Z {alienPose.z.toFixed(2)} | Yaw {alienPose.yawDeg.toFixed(1)}°
          </div>
          <div style={{ fontSize:12, opacity:0.95 }}>
            <strong style={{ color:'#60a5fa', opacity: active==='ninja'?1:0.7 }}>Ninja</strong> — X {ninjaPose.x.toFixed(2)} | Z {ninjaPose.z.toFixed(2)} | Yaw {ninjaPose.yawDeg.toFixed(1)}°
          </div>
          <div style={{ fontSize:12, opacity:0.95 }}>
            <strong style={{ color:'#a78bfa', opacity: active==='alien2'?1:0.7 }}>Alien 2</strong> — X {alien2Pose.x.toFixed(2)} | Z {alien2Pose.z.toFixed(2)} | Yaw {alien2Pose.yawDeg.toFixed(1)}°
          </div>
        </div>
  {/* Both spawn facing North (yaw 0); alien model is rotated internally to match */}
        <div style={{ fontSize:12, opacity:0.9 }}>Drag to orbit, scroll to zoom. Floor is auto-grounded; no auto-rescale.</div>
      </div>
      <div>
        <Canvas shadows camera={{ position:[0, 6, 28], fov:45 }} dpr={[1,2]}>
          <color attach="background" args={["#0b1324"]} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[18,22,12]} intensity={0.9} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
          <POVManagedControls activeAlien={(active==='alien' || active==='alien2')} povMode={alienPovMode} />
          <AlienPOVRig
            targetRef={(active==='alien') ? alienGroupRef : (active==='alien2' ? alien2GroupRef : alienGroupRef)}
            enabled={(active==='alien' || active==='alien2') && alienPovMode!=='orbit'}
            mode={alienPovMode}
            dist={alienPovDist}
            height={alienPovHeight}
            side={alienPovSide}
            smooth={alienPovSmooth}
          />
          {/* Floor */}
          <mesh rotation={[-Math.PI/2,0,0]} receiveShadow position={[0,-0.02,0]}> 
            <planeGeometry args={[240, 120]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.95} metalness={0.02} />
          </mesh>
          {/* World Compass: N/E/S/W axes */}
          <group>
            {/* Z axis (North/South, blue) */}
            <mesh rotation={[Math.PI/2,0,0]} position={[0,0,0]}>
              <cylinderGeometry args={[0.02,0.02,240,8]} />
              <meshStandardMaterial color="#3b82f6" />
            </mesh>
            {/* X axis (East/West, red) */}
            <mesh rotation={[0,0,Math.PI/2]} position={[0,0,0]}>
              <cylinderGeometry args={[0.02,0.02,120,8]} />
              <meshStandardMaterial color="#ef4444" />
            </mesh>
            {/* Labels */}
            <Billboard position={[0,0.06,-55]}><Text color="#3b82f6" fontSize={2.2}>N</Text></Billboard>
            <Billboard position={[0,0.06, 55]}><Text color="#3b82f6" fontSize={2.2}>S</Text></Billboard>
            <Billboard position={[ 60,0.06,0]}><Text color="#ef4444" fontSize={2.2}>E</Text></Billboard>
            <Billboard position={[-60,0.06,0]}><Text color="#ef4444" fontSize={2.2}>W</Text></Billboard>
          </group>
          <Suspense fallback={null}>
            {/* Robot: active-only Arrow keys */}
            <TankMover initialPosition={[-spacing,0,0]} initialYaw={0} yawBasis={0} onPose={setRobotPose} keys={active==='robot' ? { forward:['arrowup'], back:['arrowdown'], left:['arrowleft'], right:['arrowright'] } : {}}>
              <BasicGLTFModel url="/models/avatars/robot/scene.gltf" position={[0,0,0]} scale={robotScale} yawOffset={0} />
              {/* Facing gizmo (arrow) */}
              <group position={[0, 0.2, 0]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.025, 0.025, 0.5, 10]} />
                  <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" emissiveIntensity={0.25} />
                </mesh>
                <mesh position={[0, 0, -0.35]} castShadow>
                  <coneGeometry args={[0.08, 0.18, 12]} />
                  <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" emissiveIntensity={0.35} />
                </mesh>
              </group>
            </TankMover>
            {/* Alien 2: faces North, idle when stopped, walk when moving */}
            <TankMover initialPosition={[spacing*2,0,0]} initialYaw={0} yawBasis={0} moveSpeed={12} onPose={setAlien2Pose} keys={active==='alien2' ? { forward:['arrowup'], back:['arrowdown'], left:['arrowleft'], right:['arrowright'] } : {}} outRef={alien2GroupRef}>
              <Alien2FBXModel baseUrl="/models/avatars/alien 2/Animation_Idle_3_withSkin.fbx" walkUrl="/models/avatars/alien 2/Animation_Walking_withSkin.fbx" runUrl="/models/avatars/alien 2/Animation_Running_withSkin.fbx" isWalking={!!alien2Pose.moving} position={[0,0,0]} scale={alien2Scale} yawOffset={Math.PI} />
              {/* Facing gizmo (arrow) */}
              <group position={[0, 0.2, 0]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.025, 0.025, 0.5, 10]} />
                  <meshStandardMaterial color="#a78bfa" emissive="#4c1d95" emissiveIntensity={0.25} />
                </mesh>
                <mesh position={[0, 0, -0.35]} castShadow>
                  <coneGeometry args={[0.08, 0.18, 12]} />
                  <meshStandardMaterial color="#a78bfa" emissive="#4c1d95" emissiveIntensity={0.35} />
                </mesh>
              </group>
            </TankMover>
            {/* Ninja: faces North by default; use yawBasis=0 */}
            <TankMover initialPosition={[0,0,0]} initialYaw={0} yawBasis={0} moveSpeed={12} onPose={setNinjaPose} keys={active==='ninja' ? { forward:['arrowup'], back:['arrowdown'], left:['arrowleft'], right:['arrowright'] } : {}}>
              <NinjaFBXModel baseUrl="/models/avatars/Ninja/Happy Idle.fbx" walkUrl="/models/avatars/Ninja/Walking.fbx" isWalking={!!ninjaPose.moving} position={[0,0,0]} scale={ninjaScale} yawOffset={Math.PI} />
              {/* Facing gizmo (arrow) */}
              <group position={[0, 0.2, 0]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.025, 0.025, 0.5, 10]} />
                  <meshStandardMaterial color="#60a5fa" emissive="#1e3a8a" emissiveIntensity={0.25} />
                </mesh>
                <mesh position={[0, 0, -0.35]} castShadow>
                  <coneGeometry args={[0.08, 0.18, 12]} />
                  <meshStandardMaterial color="#60a5fa" emissive="#1e3a8a" emissiveIntensity={0.35} />
                </mesh>
              </group>
            </TankMover>

            {/* Alien: faces South at spawn (yawBasis=π), so Forward goes South; yawOffset=π aligns visual front with movement */}
            <TankMover initialPosition={[ spacing,0,0]} initialYaw={0} yawBasis={Math.PI} onPose={setAlienPose} keys={active==='alien' ? { forward:['arrowup'], back:['arrowdown'], left:['arrowleft'], right:['arrowright'] } : {}} outRef={alienGroupRef}>
              <BasicGLTFModel url="/models/avatars/alien/scene.gltf" position={[0,0,0]} scale={alienScale} yawOffset={Math.PI} />
              {/* Facing gizmo (arrow) */}
              <group position={[0, 0.2, 0]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.025, 0.025, 0.5, 10]} />
                  <meshStandardMaterial color="#22c55e" emissive="#064e3b" emissiveIntensity={0.25} />
                </mesh>
                <mesh position={[0, 0, -0.35]} castShadow>
                  <coneGeometry args={[0.08, 0.18, 12]} />
                  <meshStandardMaterial color="#22c55e" emissive="#064e3b" emissiveIntensity={0.35} />
                </mesh>
              </group>
            </TankMover>
            {/* Floating 3D labels with live numbers */}
            <Billboard position={[robotPose.x, 2.2, robotPose.z]}>
              <Text fontSize={0.32} color="#ef4444" outlineColor="#000" outlineWidth={0.01}>
                {`Robot  x ${robotPose.x.toFixed(2)}  z ${robotPose.z.toFixed(2)}  yaw ${robotPose.yawDeg.toFixed(1)}°`}
              </Text>
            </Billboard>
            <Billboard position={[ninjaPose.x, 2.2, ninjaPose.z]}>
              <Text fontSize={0.32} color="#60a5fa" outlineColor="#000" outlineWidth={0.01}>
                {`Ninja  x ${ninjaPose.x.toFixed(2)}  z ${ninjaPose.z.toFixed(2)}  yaw ${ninjaPose.yawDeg.toFixed(1)}°`}
              </Text>
            </Billboard>
            <Billboard position={[alienPose.x, 2.2, alienPose.z]}>
              <Text fontSize={0.32} color="#22c55e" outlineColor="#000" outlineWidth={0.01}>
                {`Alien  x ${alienPose.x.toFixed(2)}  z ${alienPose.z.toFixed(2)}  yaw ${alienPose.yawDeg.toFixed(1)}°`}
              </Text>
            </Billboard>
            <Billboard position={[alien2Pose.x, 2.2, alien2Pose.z]}>
              <Text fontSize={0.32} color="#a78bfa" outlineColor="#000" outlineWidth={0.01}>
                {`Alien 2  x ${alien2Pose.x.toFixed(2)}  z ${alien2Pose.z.toFixed(2)}  yaw ${alien2Pose.yawDeg.toFixed(1)}°`}
              </Text>
            </Billboard>
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}

// Alien POV camera rig: follows a target group (TankMover root) with selectable modes
function AlienPOVRig({ targetRef, enabled, mode='third', dist=9, height=2.2, side=1.4, smooth=true }){
  const { camera } = useThree();
  const smoothPos = useRef(new THREE.Vector3());
  const smoothTarget = useRef(new THREE.Vector3());
  useEffect(() => { if (camera) { smoothPos.current.copy(camera.position); } }, [camera]);
  useFrame((_, dt) => {
    if (!enabled || !camera || !targetRef || !targetRef.current) return;
    const root = targetRef.current;
    // Actor world basis
    const pos = new THREE.Vector3(); root.getWorldPosition(pos);
  let yaw = root.rotation.y; // rotation around Y
    const forward = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
    const up = new THREE.Vector3(0,1,0);

    // Desired camera position/target by mode
    let camPos = new THREE.Vector3();
    let camTarget = new THREE.Vector3();
    const headY = height; // eye/shoulder height
    if (mode === 'first') {
      camTarget.copy(pos).addScaledVector(forward, 4.0).addScaledVector(up, headY);
      camPos.copy(pos).addScaledVector(up, headY);
    } else if (mode === 'shoulder') {
      camTarget.copy(pos).addScaledVector(up, headY);
      camPos.copy(camTarget)
        .addScaledVector(right, side)
        .addScaledVector(forward, -dist);
    } else if (mode === 'third') {
      camTarget.copy(pos).addScaledVector(up, headY);
      // Pull the camera back and up proportionally to distance for a wide view
      const upBoost = Math.max(0, dist * 0.42);
      camPos.copy(camTarget).addScaledVector(forward, -dist).add(new THREE.Vector3(0, upBoost, 0));
    } else {
      // orbit mode not handled here; OrbitControls drives camera
      return;
    }

    if (smooth) {
      const a = Math.min(1, dt * 5.5);
      smoothTarget.current.lerp(camTarget, a * 1.2);
      smoothPos.current.lerp(camPos, a);
      camera.position.copy(smoothPos.current);
      camera.lookAt(smoothTarget.current);
    } else {
      camera.position.copy(camPos);
      camera.lookAt(camTarget);
    }
  });
  return null;
}

// Manages OrbitControls lifecycle/enable based on POV mode
function POVManagedControls({ activeAlien, povMode }){
  const ctrlRef = useRef();
  const { camera } = useThree();
  useEffect(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    // Disable OrbitControls when POV rig drives the camera
    const useOrbit = !(activeAlien && povMode !== 'orbit');
    ctrl.enabled = useOrbit;
  }, [activeAlien, povMode, camera]);

  return <OrbitControls ref={ctrlRef} makeDefault enablePan={true} minDistance={8} maxDistance={80} />;
}

// Preload
try { useGLTF.preload('/models/avatars/robot/scene.gltf'); } catch {}
try { useGLTF.preload('/models/avatars/alien/scene.gltf'); } catch {}
try { useFBX.preload('/models/avatars/Ninja/Happy Idle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/Ninja/Walking.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_3_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Walking_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Running_withSkin.fbx'); } catch {}
