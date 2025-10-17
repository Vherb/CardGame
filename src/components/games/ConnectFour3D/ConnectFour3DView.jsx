import React, { useMemo, useRef, useLayoutEffect, Suspense, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useFBX, useAnimations, Text, Billboard } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';

const COLS = 7;
const ROWS = 6;
const CELL = 1;
const GAP = 0.1;
const BOARD_THICK = 0.22;
// Vertical clearance between the board's bottom and the floor plane
const GROUND_CLEAR = 2.8; // enough room for table top + some air

// Avatar sizing: normalize model to this base height, then multiply to reach final height
const AVATAR_BASE_HEIGHT = 2.2;  // normalized seated/standing baseline in scene units
const AVATAR_FINAL_HEIGHT = 14.0; // absolute final height (bigger presence, fixed)
// Model-specific extra scale boosts (multiplied after normalization -> final size)
const SHARK_SCALE_BOOST = 2.2;      // increase shark noticeably
const CAPUCCINO_SCALE_BOOST = 2.0;  // increase capuccino noticeably
// Small adjustment to keep apparent size consistent on phones (compensate for camera/FOV)
// Note: unified scale for mobile and PC; no separate multiplier currently used
// Subtle idle animation tuning
// Standing idle, breathing — slower and subtle
const AVATAR_IDLE_AMP_Y = 0.14;    // vertical bob amplitude (upper body) — more pronounced
const AVATAR_IDLE_SWAY_Z = 0.03;   // sway around Z (radians) — a bit less side-to-side
const AVATAR_IDLE_SPEED_Y = 0.36;  // slower bob/breath
const AVATAR_IDLE_SPEED_Z = 0.30;  // slower sway
// Final baked X offsets provided by you (updated defaults)
const AVATAR_X_FRONT = 0.22;   // Player 1 side (front)
const AVATAR_X_BACK  = -3.44;  // Player 2 side (back)
// const AVATAR_TWEAK_LS = 'c4_avatar_tweaks_v3'; // no longer used

// Baked avatar transform (apply to both GLTF and fallback avatars)
// const AVATAR_BAKED_ROT = [0, 3.09, 0]; // unused: we compute yaw dynamically
const AVATAR_BAKED_POS = [1.9, 0.0, -12.0]; // moved even further back on Z
const AVATAR_BAKED_SCALE_MUL = 1; // no extra custom scaling; use baseline only
// No per-model tweaks: robot and alien share identical placement pipeline

// Animation speed controls (can be tweaked live via window.__CF_ANIM_SPEEDS__)
const DEFAULT_WALK_ANIM_TIMESCALE = 0.6;
const DEFAULT_RUN_ANIM_TIMESCALE  = 0.9;

// Optional runtime override helper (non-reactive; read at render/effect time)
function getAnimSpeed(which, fallback) {
  try {
    const o = (typeof window !== 'undefined' && window.__CF_ANIM_SPEEDS__) || {};
    const v = o && o[which];
    return (typeof v === 'number' && isFinite(v) && v > 0) ? v : fallback;
  } catch {
    return fallback;
  }
}

// Shared defaults; components call getAnimSpeed to allow quick tuning without rebuild
const WALK_ANIM_TIMESCALE = DEFAULT_WALK_ANIM_TIMESCALE;
const RUN_ANIM_TIMESCALE  = DEFAULT_RUN_ANIM_TIMESCALE;
// Astronaut-specific default walk (faster)
const ASTRONAUT_WALK_DEFAULT = 0.55;
// Astronaut-specific default run (faster)
const ASTRONAUT_RUN_DEFAULT = 0.45;
// Astronaut-specific placement tweak to avoid initial floating
const ASTRONAUT_Y_OFFSET = -0.5;

// Simple ErrorBoundary to catch GLTF loading errors and show fallback
class ModelErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(){ return { hasError: true }; }
  componentDidCatch(err, info){ /* no-op; could log */ }
  render(){
    return this.props.children;
  }
}

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
  const w = COLS * (CELL + GAP) - GAP + 0.6;
  const h = ROWS * (CELL + GAP) - GAP + 0.6;
  const holeR = 0.46; // hole radius
  const depth = BOARD_THICK;
  const geom = useMemo(() => {
    // Base rounded rectangle frame
    const outer = RoundedRectShape(w, h, 0.28);
    // Carve the circular holes for each cell position
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
  }, [w, h, depth, holeR]);
  return (
    <mesh geometry={geom} position={[0, 0, -BOARD_THICK * 0.6]} castShadow receiveShadow raycast={() => null}>
      {/* Classic blue board */}
      <meshStandardMaterial color={'#1e3a8a'} metalness={0.1} roughness={0.6} />
    </mesh>
  );
}

function SideSupports() {
  // Inner grid width
  const w  = COLS * (CELL + GAP) - GAP;
  // Frame outer dims (must match FrontPlate)
  const fw = COLS * (CELL + GAP) - GAP + 0.6; // frame width
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; // frame height

  // Table-mounted: triangular brackets at frame base + shallow tray beam
  const legWidth  = 1.05;                                      // bracket base width (x)
  const legHeight = Math.min(1.6, Math.max(1.1, fh * 0.55));   // bracket rise (y)
  const legDepth  = 1.6;                                       // bracket depth (z)

  const trayW = Math.max(fw - 0.2, w + 0.6);  // tray spans nearly the frame
  const trayH = 0.16;                          // tray height
  const trayD = 1.2;                           // tray depth

  // Y positions relative to board center (board bottom is ~ -fh/2)
  const baseY = -fh / 2;                      // frame base
  const trayY = baseY + trayH / 2 + 0.02;     // just above base

  const color = '#1e3a8a';

  // Right-triangle prism with bevels; centered in Z afterward
  const triGeom = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(legWidth, 0);
    shape.lineTo(0, legHeight);
    shape.lineTo(0, 0);
    const eg = new THREE.ExtrudeGeometry(shape, {
      depth: legDepth,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      curveSegments: 16,
      steps: 1,
    });
    // center on Z so zAttach places it correctly
    eg.translate(0, 0, -legDepth / 2);
    return eg;
  }, [legWidth, legHeight, legDepth]);

  const zAttach = -BOARD_THICK * 0.6; // align with FrontPlate plane

  return (
    <group>
      {/* Bottom tray beam connecting both sides (table-mounted) */}
      <mesh position={[0, trayY, zAttach]} castShadow receiveShadow>
        <boxGeometry args={[trayW, trayH, trayD]} />
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.6} />
      </mesh>
      {/* Triangular side brackets flushed to frame sides */}
      <mesh geometry={triGeom} position={[ fw / 2, baseY, zAttach]} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.6} />
      </mesh>
      <mesh geometry={triGeom} position={[-fw / 2, baseY, zAttach]} rotation={[0, Math.PI, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.6} />
      </mesh>
    </group>
  );
}

// Shadow catcher behind the frame so board-hole shadows have a surface
function BackShadowCatcher({ opacity = 0.14 }){
  const innerW = COLS * (CELL + GAP) - GAP + 0.2;
  const innerH = ROWS * (CELL + GAP) - GAP + 0.2;
  const z = -BOARD_THICK - 0.35;
  return (
    <mesh position={[0, 0, z]} receiveShadow>
      <planeGeometry args={[innerW, innerH]} />
      <shadowMaterial transparent opacity={opacity * 0.8} />
    </mesh>
  );
}

// Neon LED rings around each hole with slow pulsing and darker neon colors
function NeonRings({ innerR = 0.44, outerR = 0.49, speed = 0.12, amp = 0.08, base = 0.12, overlay = false }){
  const refsFront = useRef([]);
  const refsBack = useRef([]);
  const palette = useMemo(() => [
    '#22d3ee', // cyan
    '#7c3aed', // purple
    '#14b8a6', // teal
    '#60a5fa', // blue
    '#f472b6', // pink
  ], []);

  // Build positions for all holes
  const holes = useMemo(() => {
    const arr = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const x = (c - (COLS - 1) / 2) * (CELL + GAP);
        const y = (r - (ROWS - 1) / 2) * (CELL + GAP);
        const idx = r * COLS + c;
        const col = palette[c % palette.length];
        arr.push({ x, y, idx, col });
      }
    }
    return arr;
  }, [palette]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const TWOPI = Math.PI * 2;
    for (let i = 0; i < holes.length; i++) {
      const ph = (i / holes.length) * TWOPI; // phase spread
      const osc = base + amp * (0.5 + 0.5 * Math.sin(t * speed + ph));
      const mF = refsFront.current[i];
      const mB = refsBack.current[i];
      if (mF) mF.opacity = osc;
      if (mB) mB.opacity = osc;
    }
  });

  // Place LEDs just outside the board faces so they always sit in front of the board, but respect other geometry in front
  const zAttach = -BOARD_THICK * 0.6;
  const halfT = BOARD_THICK * 0.5;
  const eps = 0.01;
  const zFront = zAttach + halfT + eps;
  const zBack  = zAttach - halfT - eps;

  const depthTest = !overlay; // when overlay=true (board view), draw on top; otherwise respect depth so avatar occludes
  return (
    <>
      {holes.map((h, i) => (
        <mesh key={`rf-${i}`} position={[h.x, h.y, zFront]} frustumCulled={false} renderOrder={10}>
          <ringGeometry args={[innerR, outerR, 48]} />
          <meshBasicMaterial ref={(m)=>{ if(m) refsFront.current[i] = m; }} color={h.col} toneMapped={false} transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={depthTest} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={overlay ? -1 : -4} polygonOffsetUnits={overlay ? -1 : -4} />
        </mesh>
      ))}
      {holes.map((h, i) => (
        <mesh key={`rb-${i}`} position={[h.x, h.y, zBack]} frustumCulled={false} renderOrder={10}>
          <ringGeometry args={[innerR, outerR, 48]} />
          <meshBasicMaterial ref={(m)=>{ if(m) refsBack.current[i] = m; }} color={h.col} toneMapped={false} transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={depthTest} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={overlay ? -1 : -4} polygonOffsetUnits={overlay ? -1 : -4} />
        </mesh>
      ))}
    </>
  );
}

// Bright LED border around the frame with sweeping colors
function NeonBorder({ thickness = 0.07, inset = 0.02, speed = 0.36, amp = 0.34, base = 0.22, colorRate = 0.04, overlay = false }){
  const matsFront = useRef([]);
  const matsBack = useRef([]);
  // Use a continuous HSL hue gradient for smoother blending
  const palette = useMemo(() => [
    '#22d3ee', '#60a5fa', '#7c3aed', '#f472b6', '#14b8a6'
  ], []);

  const fw = COLS * (CELL + GAP) - GAP + 0.6;
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const COUNT_H = 56; // higher density for smoother sweep
  const COUNT_V = 40; // higher density for smoother sweep
  const segW = (fw - inset * 2) / COUNT_H;
  const segH = (fh - inset * 2) / COUNT_V;

  const segments = useMemo(() => {
    const segs = [];
    // top edge (y = +fh/2 - inset)
    for (let i = 0; i < COUNT_H; i++) {
      const x = -fw / 2 + inset + segW * (i + 0.5);
      const y = fh / 2 - inset;
      segs.push({ x, y, w: segW, h: thickness, rot: 0 });
    }
    // bottom edge (y = -fh/2 + inset)
    for (let i = 0; i < COUNT_H; i++) {
      const x = -fw / 2 + inset + segW * (i + 0.5);
      const y = -fh / 2 + inset;
      segs.push({ x, y, w: segW, h: thickness, rot: 0 });
    }
    // left edge (x = -fw/2 + inset)
    for (let i = 0; i < COUNT_V; i++) {
      const x = -fw / 2 + inset;
      const y = -fh / 2 + inset + segH * (i + 0.5);
      segs.push({ x, y, w: thickness, h: segH, rot: 0 });
    }
    // right edge (x = +fw/2 - inset)
    for (let i = 0; i < COUNT_V; i++) {
      const x = fw / 2 - inset;
      const y = -fh / 2 + inset + segH * (i + 0.5);
      segs.push({ x, y, w: thickness, h: segH, rot: 0 });
    }
    return segs;
  }, [fw, fh, COUNT_H, COUNT_V, segW, segH, thickness, inset]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const K = segments.length;
    const TWOPI = Math.PI * 2;
    // Advance hue smoothly across the entire strip using a time-shifted gradient
    const hueBase = (t * colorRate) % 1; // 0..1
    for (let i = 0; i < K; i++) {
      const ph = (i / K) * TWOPI;
      // Ease opacity oscillation for smoother in/out
      const s = Math.sin(t * speed - ph);
      const eased = 0.5 - 0.5 * Math.cos((s * 0.5 + 0.5) * Math.PI);
      const osc = base + amp * eased;
      // Compute hue smoothly over segments
      const hue = (hueBase + i / K) % 1;
      const c = new THREE.Color().setHSL(0.58 + 0.6 * hue, 0.85, 0.55);
      const mF = matsFront.current[i];
      const mB = matsBack.current[i];
      if (mF) {
        mF.opacity = osc;
        mF.color && mF.color.set(c);
      }
      if (mB) {
        mB.opacity = osc;
        mB.color && mB.color.set(c);
      }
    }
  });

  const zAttach = -BOARD_THICK * 0.6;
  const halfT = BOARD_THICK * 0.5;
  const eps = 0.01;
  const zFront = zAttach + halfT + eps;
  const zBack  = zAttach - halfT - eps;

  const depthTest = !overlay; // when overlay=true (board view), draw on top; otherwise respect depth so avatar occludes
  return (
    <>
      {segments.map((s, i) => (
        <mesh key={`bf-${i}`} position={[s.x, s.y, zFront]} frustumCulled={false} renderOrder={9}>
          <boxGeometry args={[s.w, s.h, 0.02]} />
          <meshBasicMaterial ref={(m)=>{ if(m) matsFront.current[i] = m; }} color={'#22d3ee'} toneMapped={false} transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={depthTest} polygonOffset polygonOffsetFactor={overlay ? -1 : -4} polygonOffsetUnits={overlay ? -1 : -4} />
        </mesh>
      ))}
      {segments.map((s, i) => (
        <mesh key={`bb-${i}`} position={[s.x, s.y, zBack]} frustumCulled={false} renderOrder={9}>
          <boxGeometry args={[s.w, s.h, 0.02]} />
          <meshBasicMaterial ref={(m)=>{ if(m) matsBack.current[i] = m; }} color={'#22d3ee'} toneMapped={false} transparent opacity={base} blending={THREE.AdditiveBlending} depthWrite={false} depthTest={depthTest} polygonOffset polygonOffsetFactor={overlay ? -1 : -4} polygonOffsetUnits={overlay ? -1 : -4} />
        </mesh>
      ))}
    </>
  );
}

// Plain FBX table below the board (new table model)
function TableFBX() {
  // Frame sizes and floor reference
  const fw = COLS * (CELL + GAP) - GAP + 0.6;
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;
  // Static scale (no dynamic footprint scaling) — locked value
  const TABLE_STATIC_SCALE = 0.0825;

  // Simple table asset (no external texture mapping)
  const model = useFBX('/models/props/table/table.fbx');
  const lastFixRef = useRef(0);
  // Fixed Y tweak to raise/lower table (locked so it persists across reloads)
  const TABLE_Y_OFFSET = 0.00;
  useLayoutEffect(() => {
    try {
      if (!model) return;
      // Preserve FBX's original materials; enable shadows and set defaults
      model.traverse((o) => {
        if (o && o.isMesh) {
          o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
          let m = o.material;
          if (!m) {
            m = o.material = new THREE.MeshStandardMaterial({ color: '#6a523a', metalness: 0.15, roughness: 0.8 });
          }
          // Reasonable PBR defaults
          if (typeof m.metalness !== 'number') m.metalness = 0.15;
          if (typeof m.roughness !== 'number') m.roughness = 0.8;
          m.needsUpdate = true;
        }
      });
  // Normalize placement: center on XZ, apply static scale, place on ground
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const center = new THREE.Vector3(); box.getCenter(center);
      // center horizontally
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.updateMatrixWorld(true);
  // set table rotation to exactly 90° around Y
  model.rotation.y = Math.PI / 2;
  // apply static scale
      model.scale.setScalar(TABLE_STATIC_SCALE);
      model.updateMatrixWorld(true);
      // Place so the legs sit on the floor plane (table stands above the floor)
      const box2 = new THREE.Box3().setFromObject(model);
      const bottomWorld = box2.min.y;
      // Parent world Y (the table lives under a parent group with a Y offset)
      let parentWorldY = 0;
      try {
        if (model.parent) {
          const v = new THREE.Vector3();
          model.parent.getWorldPosition(v);
          parentWorldY = v.y || 0;
        }
      } catch {}
      const targetBottomWorld = parentWorldY + groundY + TABLE_Y_OFFSET;
      model.position.y += (targetBottomWorld - bottomWorld);
      model.updateMatrixWorld(true);
      // Publish the XZ footprint for collision/landing alignment
      const box3 = new THREE.Box3().setFromObject(model);
      try {
        window.__CF_TABLE_RECT__ = { minX: box3.min.x, maxX: box3.max.x, minZ: box3.min.z, maxZ: box3.max.z };
        window.__CF_TABLE_TOP_Y__ = box3.max.y; // publish tabletop height for aligning board
        // Also emit an event so other parts of the scene can react immediately on first load
        try {
          const detail = { topY: box3.max.y, rect: window.__CF_TABLE_RECT__ };
          window.dispatchEvent(new CustomEvent('cf:table-ready', { detail }));
        } catch {}
      } catch {}
    } catch {}
  }, [model, groundY, TABLE_STATIC_SCALE, TABLE_Y_OFFSET]);

  // Guard: if anything nudges the table after initial placement, re-clamp to floor
  useFrame((state) => {
    if (!model) return;
    const t = state.clock.getElapsedTime();
    if (t - (lastFixRef.current || 0) < 0.5) return; // throttle checks
    lastFixRef.current = t;
    try {
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const bottomWorld = box.min.y;
      let parentWorldY = 0;
      try {
        if (model.parent) {
          const v = new THREE.Vector3();
          model.parent.getWorldPosition(v);
          parentWorldY = v.y || 0;
        }
      } catch {}
      const targetBottomWorld = parentWorldY + groundY + TABLE_Y_OFFSET;
      const dyWorld = (targetBottomWorld - bottomWorld);
      if (Math.abs(dyWorld) > 0.001) {
        model.position.y += dyWorld;
        model.updateMatrixWorld(true);
      }
    } catch {}
  });

  return model ? <primitive object={model} dispose={null} /> : null;
}

// Asteroid surface floor with craters and scrolling motion to feel like flying over an asteroid
function AsteroidFloor({ opacity = 1.0, radius = 110, speed = 0.35, dir = [1.0, 0.25], scale = 0.8 }) {
  // Same ground reference used elsewhere
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - GROUND_CLEAR;
  const matRef = useRef();
  const shader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uRadius: { value: radius },
      uSpeed: { value: speed },
      uDir: { value: new THREE.Vector2(dir[0], dir[1]) },
      uScale: { value: scale },
  // Greyer rock palette
  uRockA: { value: new THREE.Color('#5e5f63') },
  uRockB: { value: new THREE.Color('#8a8b90') },
  uRockC: { value: new THREE.Color('#3a3b3f') },
      uLightDir: { value: new THREE.Vector3(-0.25, 1.0, 0.15).normalize() },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldPos;
      uniform float uTime, uOpacity, uRadius, uSpeed, uScale;
      uniform vec2 uDir;
      uniform vec3 uRockA, uRockB, uRockC;
      uniform vec3 uLightDir;

      // Hashes and noise
      float hash11(float n){ return fract(sin(n)*43758.5453123); }
      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.,0.));
        float c = hash21(i + vec2(0.,1.));
        float d = hash21(i + vec2(1.,1.));
        vec2 u = f*f*(3.-2.*f);
        return mix(a,b,u.x) + (c - a)*u.y*(1.-u.x) + (d - b)*u.x*u.y;
      }
      float fbm(vec2 p){
        float v = 0.0; float a = 0.5;
        for(int i=0;i<5;i++){
          v += a * noise(p); p *= 2.02; a *= 0.5;
        }
        return v;
      }

      // Crater field using nearest random point in a 3x3 cell neighborhood
      float craterField(vec2 p, out vec2 craterUV){
        vec2 ip = floor(p);
        vec2 fp = fract(p);
        float dmin = 1e9; vec2 closest = vec2(0.0);
        for(int j=-1;j<=1;j++){
          for(int i=-1;i<=1;i++){
            vec2 cell = ip + vec2(float(i), float(j));
            vec2 rnd = vec2(hash21(cell), hash21(cell+7.77));
            vec2 c = rnd*0.8 + 0.1; // random center inside cell
            vec2 diff = fp - (c + vec2(float(i), float(j)));
            float d = dot(diff, diff);
            if(d < dmin){ dmin = d; closest = diff; }
          }
        }
        float r = sqrt(dmin);
        craterUV = vec2(r, 0.0);
        // Profile: depression with a raised rim
        float rim = smoothstep(0.22, 0.18, r) - smoothstep(0.12, 0.10, r);
        float bowl = 0.35 * (1.0 - smoothstep(0.0, 0.22, r));
        return clamp(bowl - rim*0.45, -0.6, 0.6);
      }

      // Compute terrain height from fbm and craters
      float height(vec2 p){
        vec2 cuv; float cr = craterField(p*1.2, cuv);
        float base = fbm(p*1.8)*0.7 + fbm(p*4.3)*0.18;
        return base - cr; // lower in craters
      }

      // Approximate normal via central differences
      vec3 normalFromHeight(vec2 p){
        float e = 0.0025;
        float h = height(p);
        float hx = height(p + vec2(e,0.)) - h;
        float hy = height(p + vec2(0.,e)) - h;
        vec3 n = normalize(vec3(-hx, 1.0/e, -hy));
        return n;
      }

      void main(){
        // Irregular edge mask so the platform silhouette looks like an asteroid
        float distXZ = length(vWorldPos.xz);
        float rad = max(1.0, uRadius);
        // wobble the edge using low frequency fbm for jagged outline
        float edgeNoise = fbm(vWorldPos.xz * 0.12 + vec2(0.05*uTime, -0.04*uTime));
        float edged = distXZ / rad + (edgeNoise - 0.5) * 0.08; // +/- 4% wobble
        // 0..1, 1 inside, 0 outside with a narrow irregular falloff band
        float inside = 1.0 - smoothstep(0.94, 1.02, edged);
        if (inside <= 0.001) discard;
        // keep a secondary soft fade for the very outer rim
        float ring = smoothstep(0.0, 0.2, inside);

        // Scroll world to simulate flying forward
        vec2 dir = normalize(uDir);
        vec2 p = (vWorldPos.xz * uScale) + dir * (uTime * uSpeed * 12.0);

        // Terrain
        float h = height(p);
        vec3 n = normalFromHeight(p);

        // Rock albedo
        float c1 = smoothstep(0.0, 1.0, h);
        float c2 = smoothstep(0.2, 0.8, fbm(p*2.7));
        vec3 albedo = mix(uRockA, uRockB, c1);
        albedo = mix(albedo, uRockC, 0.25*(1.0-c2));

        // Lighting: single directional + ambient + subtle rim
        float ndl = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
        float rim = pow(1.0 - clamp(dot(n, vec3(0.0,1.0,0.0)), 0.0, 1.0), 1.6);
        vec3 ambient = albedo * 0.40;
        vec3 diffuse = albedo * (0.80 * ndl);
        vec3 rimCol = vec3(0.45,0.5,0.6) * rim * 0.18;
        vec3 col = ambient + diffuse + rimCol;

        // Alpha: fully opaque inside, fade only near irregular edge so stars never show over the floor
        float a = mix(uOpacity, 0.0, 1.0 - ring);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: true,
  }), [opacity, radius, speed, dir, scale]);

  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });

  const planeSize = radius * 2.6;
  return (
    <group position={[0, groundY, 0]}>
      <mesh rotation={[-Math.PI/2, 0, 0]} renderOrder={-3} receiveShadow={false}>
        <planeGeometry args={[planeSize, planeSize, 1, 1]} />
        <shaderMaterial ref={matRef} args={[shader]} />
      </mesh>
      {/* Shadow catcher slightly above */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0015, 0]} receiveShadow renderOrder={-2}>
        <planeGeometry args={[planeSize, planeSize, 1, 1]} />
        <shadowMaterial transparent opacity={0.22} />
      </mesh>
    </group>
  );
}

// Star dome + drifting dust + a couple of procedural planets for deep space vibe
function SpaceBackdrop({ speed = 0.3, dir = [1.0, 0.25], starIntensity = 1.8, clusterStrength = 2.2 }) {
  const domeMatRef = useRef();
  const planet1Ref = useRef();
  const planet2Ref = useRef();
  const dustRef = useRef();
  const groupRef = useRef();

  const uDir = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);

  // Star dome shader (inward-facing sphere)
  const domeShader = useMemo(() => ({
    uniforms: {
      uTime: { value: 0 },
      uTwinkle: { value: 0.35 },
      uNebula: { value: 0.0 },
      uIntensity: { value: starIntensity },
      uCluster: { value: clusterStrength },
      uDir: { value: new THREE.Vector2(uDir.x, uDir.y) },
      uSpeed: { value: speed },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorldPos;
      uniform float uTime, uTwinkle, uNebula, uIntensity, uCluster, uSpeed;
      uniform vec2 uDir;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float a = hash(i);
        float b = hash(i+vec2(1.,0.));
        float c = hash(i+vec2(0.,1.));
        float d = hash(i+vec2(1.,1.));
        vec2 u = f*f*(3.-2.*f);
        return mix(a,b,u.x) + (c-a)*u.y*(1.-u.x) + (d-b)*u.x*u.y;
      }
      float fbm(vec2 p){ float v=0., a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5;} return v; }

      void main(){
        // Map world dir to a stable UV on the dome
        vec3 d = normalize(vWorldPos);
        float lon = atan(d.z, d.x); // -pi..pi
        float lat = asin(clamp(d.y, -1.0, 1.0)); // -pi/2..pi/2
        vec2 uv = vec2(lon/(6.28318530718)+0.5, lat/3.14159265359+0.5);

        // Scroll for subtle parallax in star pattern
        vec2 scroll = uDir * (uTime * uSpeed * 0.08);
  vec2 suv = uv * 220.0 + scroll; // much denser star field

        // Clustering mask (bigger, smoother regions of higher star density)
  float cl = fbm(uv*4.6 + scroll*0.12);
  float clusterMask = pow(smoothstep(0.45, 0.98, cl), 4.0) * (uCluster * 1.8); // stronger clusters

        // Multi-layer stars via noise thresholds
        float n1 = noise(suv);
        float n2 = noise(suv*1.7 + 5.17);
        float n3 = noise(suv*2.3 + 17.9);
  float starS = smoothstep(0.992, 1.0, n1);
  float starM = smoothstep(0.9965, 1.0, n2);
  float starL = smoothstep(0.9985, 1.0, n3);
        // Bright cores for the largest stars
  float core = pow(max(0.0, n3 - 0.9991)/0.0009, 3.0);

        // Twinkle modulation
        float tw1 = 0.5 + 0.5*sin(uTime*3.1 + 11.0*noise(suv*0.08));
        float tw2 = 0.5 + 0.5*sin(uTime*2.2 + 7.0*noise(suv*0.11 + 4.3));
        float twinkle = (0.6 + 0.4*mix(tw1, tw2, 0.5)) * (1.0 + 0.35*clusterMask) * uTwinkle;

        float stars = (starS*0.9 + starM*2.2 + starL*3.4 + core*4.0);
        stars *= (1.0 + clusterMask);
        stars *= (0.75 + twinkle);

        // Subtle nebula gradient (kept low to emphasize bright dots)
        float neb = fbm(uv*2.6 + scroll*0.12);
        vec3 nebCol = mix(vec3(0.03,0.02,0.05), vec3(0.08,0.05,0.12), neb) * uNebula;

        // Remove nebula tint to avoid dome “bubble” look; render only stars
        vec3 col = vec3(1.0)*stars*uIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  }), [uDir, speed, starIntensity, clusterStrength]);

  // Simple procedural planet shader material factory
  const makePlanetShader = useCallback((baseA, baseB, banding, clouds) => ({
    uniforms: {
      uTime: { value: 0 },
      uBaseA: { value: new THREE.Color(baseA) },
      uBaseB: { value: new THREE.Color(baseB) },
      uBand: { value: banding },
      uClouds: { value: clouds },
      uLightDir: { value: new THREE.Vector3(-0.2, 0.9, 0.1).normalize() },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normalMatrix * normal); vP = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vP,1.0); }
    `,
    fragmentShader: `
      precision highp float; varying vec3 vN; varying vec3 vP;
      uniform vec3 uBaseA, uBaseB, uLightDir; uniform float uTime, uBand, uClouds;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }
      float fbm(vec2 p){ float v=0., a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5;} return v; }
      void main(){
        vec3 n = normalize(vN);
        // spherical uv from normal
        float lon = atan(n.z, n.x); float lat = asin(clamp(n.y,-1.0,1.0));
        vec2 uv = vec2(lon/6.2831853+0.5, lat/3.14159265+0.5);
        // gas bands or continents
        float bands = 0.5 + 0.5*sin((uv.y*6.28318)*uBand + 2.0*fbm(uv*4.0 + vec2(0.1*uTime)));
        vec3 base = mix(uBaseA, uBaseB, bands);
        // clouds
        float c = smoothstep(0.65, 0.9, fbm(uv*5.0 + vec2(0.05*uTime, 0.07*uTime)));
        vec3 col = base + vec3(1.0)*c*uClouds*0.25;
        // lighting
        float ndl = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
        vec3 ambient = col*0.35; vec3 diffuse = col*0.85*ndl;
        float rim = pow(1.0 - clamp(dot(n, vec3(0,1,0)), 0.0, 1.0), 2.0)*0.25;
        col = ambient + diffuse + vec3(0.7,0.8,1.0)*rim*0.2;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }), []);

  // Create planet shader materials
  const planet1Shader = useMemo(() => makePlanetShader('#557799', '#88aacc', 18.0, 0.4), [makePlanetShader]);
  const planet2Shader = useMemo(() => makePlanetShader('#704a2a', '#c79a5f', 8.0, 0.15), [makePlanetShader]);

  // Dust points
  const dustCount = 350;
  const dustGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      positions[i*3+0] = (Math.random()-0.5) * 380;
      positions[i*3+1] = (Math.random()-0.2) * 250;
      positions[i*3+2] = (Math.random()-0.5) * 520;
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  const dustMat = useMemo(() => new THREE.PointsMaterial({ size: 0.9, color: '#aab3ff', opacity: 0.6, transparent: true, depthWrite: false }), []);

  // Cleanup geometries/materials on unmount to avoid memory buildup in dev
  useEffect(() => {
    return () => {
      try { dustGeom?.dispose?.(); } catch {}
      try { dustMat?.dispose?.(); } catch {}
      try { if (planet1Ref.current && planet1Ref.current.material) planet1Ref.current.material.dispose(); } catch {}
      try { if (planet2Ref.current && planet2Ref.current.material) planet2Ref.current.material.dispose(); } catch {}
      try { domeMatRef.current?.dispose?.(); } catch {}
    };
  }, [dustGeom, dustMat]);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    if (domeMatRef.current) domeMatRef.current.uniforms.uTime.value = t;
    if (planet1Ref.current && planet1Ref.current.material) planet1Ref.current.material.uniforms.uTime.value = t;
    if (planet2Ref.current && planet2Ref.current.material) planet2Ref.current.material.uniforms.uTime.value = t*0.8;
    // Drift dust opposite to travel dir
    if (dustRef.current) {
      const geom = dustRef.current.geometry; const pos = geom.getAttribute('position');
      const dx = -uDir.x * speed * 0.6 * delta * 60.0;
      const dz = -uDir.y * speed * 1.2 * delta * 60.0;
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i) + dx; let z = pos.getZ(i) + dz;
        if (x > 200) x = -200; if (x < -200) x = 200;
        if (z > 280) z = -280; if (z < -280) z = 280;
        pos.setX(i, x); pos.setZ(i, z);
      }
      pos.needsUpdate = true;
    }
    // slow planet rotations
    if (planet1Ref.current) planet1Ref.current.rotation.y = t * 0.02;
    if (planet2Ref.current) planet2Ref.current.rotation.y = -t * 0.015;
  });

  const radius = 800; // bring within camera far plane
  return (
    <group ref={groupRef}>
      {/* Stars dome */}
      <mesh renderOrder={-20}>
        <sphereGeometry args={[radius, 48, 32]} />
        <shaderMaterial ref={domeMatRef} args={[domeShader]} />
      </mesh>
      {/* Drifting dust for speed cue */}
      <points ref={dustRef} geometry={dustGeom} material={dustMat} renderOrder={-9} frustumCulled={false} />
      {/* Planets: far background */}
      <mesh position={[-250, 80, -650]} ref={planet1Ref} renderOrder={-8}>
        <sphereGeometry args={[65, 32, 16]} />
        <shaderMaterial args={[planet1Shader]} />
      </mesh>
      <mesh position={[300, -40, -520]} ref={planet2Ref} renderOrder={-8}>
        <sphereGeometry args={[40, 32, 16]} />
        <shaderMaterial args={[planet2Shader]} />
      </mesh>
    </group>
  );
}

// Large 3D asteroids drifting by in the far background
function FlybyAsteroids({ count = 3, speed = 0.22, dir = [1, 0.25] }) {
  const groupRef = useRef();
  const rng = useMemo(() => Math.random() * 1000, []);
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  const asteroids = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        pos: new THREE.Vector3(
          (Math.random()-0.5)*480,
          (Math.random()-0.35)*220,
          -360 - Math.random()*420
        ),
        rot: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI),
        rps: new THREE.Vector3((Math.random()*0.2-0.1), (Math.random()*0.2-0.1), (Math.random()*0.2-0.1)),
        scale: 20 + Math.random()*35,
        color: new THREE.Color().setHSL(0.62 + (Math.random()*0.03-0.015), 0.12, 0.36),
      });
    }
    return arr;
  }, [count]);

  // Make a bumpy rock material
  const rockMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a7b7f', roughness: 0.95, metalness: 0.02 }), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + rng;
    if (!groupRef.current) return;
    groupRef.current.children.forEach((m, i) => {
      // Translate in opposite to camera travel (to the left/back) for drift
      const base = asteroids[i]; if (!base) return;
      const drift = speed * 0.6;
      m.position.x += -d.x * drift;
      m.position.z += -d.y * drift * 1.3;
      // wrap around when far past edges
  if (m.position.x > 280) m.position.x = -280;
  if (m.position.x < -280) m.position.x = 280;
  if (m.position.z > -180) m.position.z = -780 - Math.random()*180;
      // slow spin
      m.rotation.x += base.rps.x * 0.01;
      m.rotation.y += base.rps.y * 0.01;
      m.rotation.z += base.rps.z * 0.01;
    });
  });

  return (
    <group ref={groupRef} renderOrder={-7}>
      {asteroids.map((a, idx) => (
        <mesh key={idx} position={a.pos} rotation={a.rot} scale={a.scale} castShadow receiveShadow>
          <icosahedronGeometry args={[1, 2]} />
          <meshStandardMaterial color={a.color} roughness={0.96} metalness={0.03} />
        </mesh>
      ))}
    </group>
  );
}

// Dense, small galaxy-like star clusters (hundreds of tight points per cluster)
function GalaxyClusters({ clusterCount = 7, pointsPerCluster = 600, radius = 720, spread = 0.035, speed = 0.08, dir = [1, 0.25] }) {
  const groupRef = useRef();
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  const childRefs = useRef([]);
  const axesRef = useRef([]);
  const spinRef = useRef([]);

  const clusters = useMemo(() => {
    const list = [];
    const randOnSphere = () => {
      // Bias to be mostly in the far background (z negative)
      let v;
      do {
        const u = Math.random();
        const v1 = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v1 - 1);
        v = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta)
        );
      } while (v.z > -0.1); // ensure it’s generally behind
      return v.normalize();
    };
    for (let i = 0; i < clusterCount; i++) {
      const dirV = randOnSphere();
      // Build tangent frame (u,v) for sampling on the sphere around dirV
      const up = Math.abs(dirV.y) > 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const u = new THREE.Vector3().crossVectors(up, dirV).normalize();
      const v = new THREE.Vector3().crossVectors(dirV, u).normalize();
      const center = dirV.clone().multiplyScalar(radius);
      // Generate local points around origin; we'll place a group at `center`
      const positions = new Float32Array(pointsPerCluster * 3);
      const colors = new Float32Array(pointsPerCluster * 3);
      // random tilt of cluster disc within its own local frame (rotate u/v basis)
      const tilt = new THREE.Euler(Math.random()*0.6 - 0.3, Math.random()*Math.PI*2.0, Math.random()*0.6 - 0.3);
      const rotM = new THREE.Matrix4().makeRotationFromEuler(tilt);
      const uu = u.clone().applyMatrix4(rotM);
      const vv = v.clone().applyMatrix4(rotM);
      for (let p = 0; p < pointsPerCluster; p++) {
        const r1 = Math.sqrt(-2.0 * Math.log(Math.max(1e-6, Math.random())));
        const th = 2.0 * Math.PI * Math.random();
        const gx = r1 * Math.cos(th) * spread * radius;
        const gy = r1 * Math.sin(th) * spread * radius;
        const pos = uu.clone().multiplyScalar(gx).add(vv.clone().multiplyScalar(gy));
        positions[p*3+0] = pos.x; positions[p*3+1] = pos.y; positions[p*3+2] = pos.z;
        const c = 0.92 + Math.random()*0.08;
        colors[p*3+0] = c; colors[p*3+1] = c; colors[p*3+2] = 1.0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // random spin axis and speed per cluster
      const axis = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
      const spin = 0.0003 + Math.random()*0.0007; // slow spin
      list.push({ geometry: g, center, axis, spin });
    }
    return list;
  }, [clusterCount, pointsPerCluster, radius, spread]);

  const mat = useMemo(() => new THREE.PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);

  // Dispose generated cluster geometries/material on unmount
  useEffect(() => {
    return () => {
      try { mat?.dispose?.(); } catch {}
      try { clusters?.forEach?.(c => c.geometry?.dispose?.()); } catch {}
    };
  }, [mat, clusters]);

  useFrame(() => {
    // Subtle drift and slow rotation to suggest movement
    if (!groupRef.current) return;
    groupRef.current.rotation.y += 0.0006; // slow yaw
    groupRef.current.position.x += -d.x * speed * 0.5;
    groupRef.current.position.z += -d.y * speed * 0.9;
    // wrap position slightly to prevent drift far from origin
    const gx = groupRef.current.position.x;
    const gz = groupRef.current.position.z;
    if (gx > 200) groupRef.current.position.x = -200;
    if (gx < -200) groupRef.current.position.x = 200;
    if (gz > 200) groupRef.current.position.z = -200;
    if (gz < -200) groupRef.current.position.z = 200;
    // Per-cluster gentle spin
    if (childRefs.current) {
      for (let i = 0; i < childRefs.current.length; i++) {
        const child = childRefs.current[i];
        const axis = axesRef.current[i];
        const s = spinRef.current[i];
        if (child && axis && s) {
          child.rotateOnAxis(axis, s);
        }
      }
    }
  });

  return (
    <group ref={groupRef} renderOrder={-9}>
      {clusters.map((c, i) => (
        <group
          key={i}
          position={c.center}
          ref={el => { childRefs.current[i] = el; axesRef.current[i] = c.axis; spinRef.current[i] = c.spin; }}
        >
          <points geometry={c.geometry} material={mat} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}

// Foreground "star swarms": occasional tight clusters of various sizes flying by
function StarSwarms({ maxSwarms = 5, basePoints = 500, dir = [1.0, 0.25], speed = 0.18, spawnMin = 4, spawnMax = 9 }) {
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);
  const groupRef = useRef();
  const timerRef = useRef(0);
  const nextSpawnRef = useRef((spawnMin + Math.random() * (spawnMax - spawnMin)));

  // Build N reusable swarm groups, each made of 3 point sets (small/med/large)
  const swarms = useMemo(() => {
    const makeGeom = (count, spread) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        // gaussian cluster around origin
        const r1 = Math.sqrt(-2.0 * Math.log(Math.max(1e-6, Math.random())));
        const th = 2.0 * Math.PI * Math.random();
        const rx = r1 * Math.cos(th) * spread;
        const ry = r1 * Math.sin(th) * spread * 0.6; // slightly flattened
        pos[i*3+0] = rx;
        pos[i*3+1] = (Math.random()-0.5) * spread * 0.4; // a little thickness
        pos[i*3+2] = ry;
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      return g;
    };
    const list = [];
    for (let i = 0; i < maxSwarms; i++) {
      // Less clustery, larger spread so it reads as a background galaxy patch
      const small = makeGeom(Math.floor(basePoints * 0.65), 30.0);
      const medium = makeGeom(Math.floor(basePoints * 0.28), 22.0);
      const large = makeGeom(Math.floor(basePoints * 0.12), 14.0);
      list.push({
        small, medium, large,
        state: { active: false, ttl: 0, spd: 0.5 + Math.random()*0.6 },
        ref: React.createRef()
      });
    }
    return list;
  }, [maxSwarms, basePoints]);

  const matSmall = useMemo(() => new THREE.PointsMaterial({ size: 1.2, color: '#e6ecff', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);
  const matMedium = useMemo(() => new THREE.PointsMaterial({ size: 2.0, color: '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);
  const matLarge = useMemo(() => new THREE.PointsMaterial({ size: 3.2, color: '#fff7df', transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending }), []);

  useEffect(() => {
    return () => { try { matSmall?.dispose?.(); matMedium?.dispose?.(); matLarge?.dispose?.(); } catch {} };
  }, [matSmall, matMedium, matLarge]);

  // Spawn a swarm from ahead in travel direction
  const spawnSwarm = useCallback((item) => {
    const g = item.ref.current;
    if (!g) return;
    // Place "waaaay" in the background but within far plane
  const zStart = -650 + Math.random()*200; // [-650, -450]
  const startX = (Math.random()-0.5) * 300; // centered horizontally
  const updown = (Math.random()-0.2) * 110; // slight vertical variance
  g.position.set(startX, updown, zStart);
    item.state.active = true;
    item.state.ttl = 15.0 + Math.random() * 7.0; // seconds
    item.state.spd = 0.6 + Math.random()*0.6;
    g.visible = true;
  }, [d]);

  useFrame((_, delta) => {
    timerRef.current += delta;
    if (timerRef.current >= nextSpawnRef.current) {
      // find an inactive swarm and spawn
      const target = swarms.find(s => !s.state.active);
      if (target) spawnSwarm(target);
      timerRef.current = 0;
      nextSpawnRef.current = (spawnMin + Math.random() * (spawnMax - spawnMin));
    }
    // update active swarms
    swarms.forEach((s) => {
      if (!s.state.active || !s.ref.current) return;
      s.state.ttl -= delta;
      // Drift mostly sideways across the background with minimal depth change
      const perp = new THREE.Vector2(-d.y, d.x);
      const vx = perp.x * speed * s.state.spd * 40.0 * delta;
      const vz = perp.y * speed * s.state.spd * 40.0 * delta + (-d.y * speed * 8.0 * delta);
      s.ref.current.position.x += vx;
      s.ref.current.position.z += vz;
      // Keep within a background band and screen-ish X range
      if (s.state.ttl <= 0 || Math.abs(s.ref.current.position.x) > 480 || s.ref.current.position.z < -900 || s.ref.current.position.z > -380) {
        s.state.active = false;
        s.ref.current.visible = false;
      }
    });
  });

  return (
    <group ref={groupRef} renderOrder={-6}>
      {swarms.map((s, i) => (
        <group key={i} ref={s.ref} visible={false}>
          <points geometry={s.small} material={matSmall} frustumCulled={false} />
          <points geometry={s.medium} material={matMedium} frustumCulled={false} />
          <points geometry={s.large} material={matLarge} frustumCulled={false} />
        </group>
      ))}
    </group>
  );
}

// Very dense galaxy field (~200k points) with tight clusters and mixed sizes
function DenseGalaxyField({ totalPoints = 220000, clusters = 12, radius = 750, clusterSpread = 0.02, speed = 0.05, dir = [1.0, 0.25], sizeRange = [1.4, 3.6] }) {
  const groupRef = useRef();
  const d = useMemo(() => new THREE.Vector2(dir[0], dir[1]).normalize(), [dir]);

  // Generate cluster centers on far sphere (behind camera mostly)
  const centers = useMemo(() => {
    const arr = [];
    const pickDir = () => {
      let v;
      do {
        const u = Math.random();
        const v1 = Math.random();
        const theta = 2*Math.PI*u;
        const phi = Math.acos(2*v1-1);
        v = new THREE.Vector3(
          Math.sin(phi)*Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi)*Math.sin(theta)
        );
      } while (v.z > -0.05);
      return v.normalize();
    };
    for (let i=0;i<clusters;i++) {
      const dirV = pickDir();
      // build tangent basis
      const up = Math.abs(dirV.y) > 0.9 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
      const u = new THREE.Vector3().crossVectors(up, dirV).normalize();
      const v = new THREE.Vector3().crossVectors(dirV, u).normalize();
      const center = dirV.clone().multiplyScalar(radius);
      arr.push({ dirV, u, v, center, weight: 0.8 + Math.random()*0.6 });
    }
    return arr;
  }, [clusters, radius]);

  // Allocate attributes once with defensive fallback to avoid huge/NaN allocations
  const { geometry } = useMemo(() => {
    // Sanitize and clamp total points
    const maxPts = 350000;
    const minPts = 8000;
    let target = Number(totalPoints);
    if (!Number.isFinite(target) || target <= 0) target = 220000;
    if (process.env.NODE_ENV !== 'production') target = Math.min(target, 180000);
    target = Math.max(minPts, Math.min(maxPts, Math.floor(target)));

    let g = null;
    let attempts = 0;
    while (!g && target >= minPts && attempts < 6) {
      try {
        const positions = new Float32Array(target * 3);
        const colors = new Float32Array(target * 3);
        const sizes = new Float32Array(target);
        // Weighted cluster selection
        const weights = centers.map(c => c.weight);
        const sumW = weights.reduce((a,b)=>a+b,0) || 1;
        for (let i=0;i<target;i++){
          // pick a center
          let r = Math.random()*sumW; let k=0; for(;k<centers.length;k++){ r-=weights[k]; if (r<=0) break; }
          const C = centers[k] || centers[0];
          // 2D gaussian offset in tangent plane
          const r1 = Math.sqrt(-2.0*Math.log(Math.max(1e-6, Math.random())));
          const th = 2.0*Math.PI*Math.random();
          const gx = r1*Math.cos(th)*clusterSpread*radius;
          const gy = r1*Math.sin(th)*clusterSpread*radius*0.75;
          const pos = C.center.clone().add(C.u.clone().multiplyScalar(gx)).add(C.v.clone().multiplyScalar(gy));
          const npos = pos.normalize().multiplyScalar(radius);
          const idx = i*3;
          positions[idx+0]=npos.x; positions[idx+1]=npos.y; positions[idx+2]=npos.z;
          // color with slight blue-white variance
          const c = 0.9 + Math.random()*0.1;
          colors[idx+0]=c; colors[idx+1]=c; colors[idx+2]=1.0;
          // size: more small than large
          const tsize = Math.pow(Math.random(), 2.2); // bias small
          sizes[i] = sizeRange[0] + (sizeRange[1]-sizeRange[0]) * tsize;
        }
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.BufferAttribute(positions,3));
        gg.setAttribute('color', new THREE.BufferAttribute(colors,3));
        gg.setAttribute('aSize', new THREE.BufferAttribute(sizes,1));
        g = gg;
      } catch (e) {
        try { console.warn('[DenseGalaxyField] allocation failed for', target, 'points; reducing.', e?.message || e); } catch {}
        target = Math.floor(target * 0.6);
        attempts++;
      }
    }
    if (!g) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(minPts*3),3));
      gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(minPts*3),3));
      gg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(minPts),1));
      return { geometry: gg };
    }
    return { geometry: g };
  }, [totalPoints, centers, clusterSpread, radius, sizeRange]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1.0 },
    },
    vertexShader: `
      attribute float aSize; varying vec3 vColor;
      void main(){
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = -mv.z;
        float size = aSize * (300.0 / max(1.0, dist));
        gl_PointSize = size;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float; varying vec3 vColor; uniform float uOpacity;
      void main(){
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float r = dot(uv, uv);
        float alpha = smoothstep(1.0, 0.0, r);
        vec3 col = vColor * 1.15;
        gl_FragColor = vec4(col, alpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  }), []);

  // Cleanup to reduce memory pressure during hot reloads
  useEffect(() => {
    return () => {
      try { geometry?.dispose?.(); } catch {}
      try { material?.dispose?.(); } catch {}
    };
  }, [geometry, material]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += 0.00035; // slow yaw
    groupRef.current.position.x += -d.x * speed * 30.0 * delta;
    groupRef.current.position.z += -d.y * speed * 60.0 * delta;
    const gx = groupRef.current.position.x;
    const gz = groupRef.current.position.z;
    if (gx > 200) groupRef.current.position.x = -200;
    if (gx < -200) groupRef.current.position.x = 200;
    if (gz > 200) groupRef.current.position.z = -200;
    if (gz < -200) groupRef.current.position.z = 200;
  });

  return (
    <group ref={groupRef} renderOrder={-9}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

function OpponentAvatar({ flip180 = false, rotationOverride = null, scaleOverride = 1, positionOverride = null, xFront, xBack, zSign = -1 }) {
  // Match key dims used by other parts so placement stays consistent
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; // frame height
  const groundY = -fh / 2 - GROUND_CLEAR;

  // WoodenTable dims (keep in sync with WoodenTable)
  // (Not directly used here; avatar anchors to groundY)

  // Place avatar across the table relative to current camera: same distance, opposite side
  const posX = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (typeof xFront === 'number' ? xFront : AVATAR_X_FRONT) : (typeof xBack === 'number' ? xBack : AVATAR_X_BACK));
  const posY = AVATAR_BAKED_POS[1];
  const posZ = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const faceDir = posZ >= 0 ? -1 : 1; // look toward board center (z=0)

  // Scale avatar (mobile adjustment currently unified to 1)
  const scale = 5 * (Number.isFinite(scaleOverride) ? scaleOverride : 1);

  // Anchor the avatar feet on the ground, level with table leg bottoms
  // Stand on the same floor plane used by NeonFloor and table legs
  const anchorY = groundY;

  // Simple stylized figure
  const bodyH = 1.8;
  const bodyR = 0.4;
  const headR = 0.36;
  const neckH = 0.18;
  const shoulderW = 1.0;
  const armR = 0.16;
  const armL = 0.9;

  const fabric = '#1f2937';
  const fabricEm = '#0b1220';
  const skin = '#d1a68a';

  const groupRotation = rotationOverride ?? [0, posZ > 0 ? Math.PI : 0, 0];
  const groupRef = useRef();
  const upperRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();
  const baseY = anchorY + posY; // keep root anchored
  const startRotZ = groupRotation?.[2] || 0;
  useFrame(({ clock }) => {
    const g = groupRef.current;
    const u = upperRef.current;
    if (!g || !u) return;
    const t = clock.getElapsedTime();
  g.position.x = posX;
  g.position.y = baseY;
  g.position.z = posZ;
  g.scale.set(scale, scale, scale);
    // Move only the upper body: root stays fixed at ground
    const bob = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * AVATAR_IDLE_AMP_Y;
    const sway = Math.sin(t * AVATAR_IDLE_SPEED_Z * 2 * Math.PI) * AVATAR_IDLE_SWAY_Z;
    const breath = Math.sin(t * 0.45) * 0.02;         // slower chest/torso pitch
    g.rotation.z = startRotZ;      // no whole-body tilt
    u.position.y = 0.15 + bob;     // upper body bob
    u.rotation.z = sway;           // upper body sway
    u.rotation.x = breath;         // gentle forward/back rock
    // arm micro motion (adds a little life)
    if (leftArmRef.current)  leftArmRef.current.rotation.x =  0.03 * Math.sin(t * 1.1);
    if (rightArmRef.current) rightArmRef.current.rotation.x = -0.03 * Math.sin(t * 1.1);
  });
  return (
  <group ref={groupRef} position={[posX, baseY, posZ]} rotation={groupRotation} scale={[scale, scale, scale]} raycast={null} frustumCulled={false}>
      {/* Upper body wrapper so feet/root remain planted */}
      <group ref={upperRef} position={[0, 0.15, 0]}>
        {/* Torso */}
        <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[bodyR, Math.max(0.2, bodyH - bodyR * 2), 8, 16]} />
        <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
        </mesh>
        {/* Head + neck */}
        <mesh position={[0, bodyH + neckH + headR, 0]} castShadow>
        <sphereGeometry args={[headR, 24, 24]} />
        <meshStandardMaterial color={skin} emissive={'#3b2a21'} emissiveIntensity={0.05} metalness={0.05} roughness={0.7} />
        </mesh>
        <mesh position={[0, bodyH + neckH / 2, 0]} castShadow>
        <cylinderGeometry args={[headR * 0.45, headR * 0.5, neckH, 12]} />
        <meshStandardMaterial color={skin} emissive={'#3b2a21'} emissiveIntensity={0.05} metalness={0.05} roughness={0.7} />
        </mesh>

        {/* Simple shoulders */}
        <mesh position={[0, bodyH - 0.3, 0]} castShadow>
        <boxGeometry args={[shoulderW, 0.28, 0.5]} />
        <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
        </mesh>

        {/* Arms resting on table edge */}
        <group position={[0, 0.05, faceDir * 0.25]}>
        <mesh ref={leftArmRef} position={[ shoulderW / 2 - 0.2, 0, 0]} rotation={[0, 0, Math.PI * 0.04]} castShadow>
          <cylinderGeometry args={[armR, armR, armL, 12]} />
          <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
          </mesh>
          <mesh ref={rightArmRef} position={[-shoulderW / 2 + 0.2, 0, 0]} rotation={[0, 0, -Math.PI * 0.04]} castShadow>
          <cylinderGeometry args={[armR, armR, armL, 12]} />
          <meshStandardMaterial color={fabric} emissive={fabricEm} emissiveIntensity={0.06} metalness={0.1} roughness={0.8} />
          </mesh>
        </group>

        {/* Minimal face hint: two eyes (always toward center) */}
        <group position={[0, bodyH + neckH + headR, faceDir * 0.28]}>
        <mesh position={[-0.12, 0.05, 0]} castShadow>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial color={'#111827'} roughness={0.9} metalness={0.0} />
          </mesh>
          <mesh position={[ 0.12, 0.05, 0]} castShadow>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial color={'#111827'} roughness={0.9} metalness={0.0} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function resolveAvatarUrl({ flip180 } = {}) {
  try {
    const envUrl = (process.env.REACT_APP_OPPONENT_MODEL_URL || process.env.REACT_APP_AVATAR_URL || '').trim();
    if (envUrl) return envUrl;
  } catch {}
  try {
    const winUrl = (window.OPPONENT_MODEL_URL ? String(window.OPPONENT_MODEL_URL).trim() : (window.AVATAR_URL ? String(window.AVATAR_URL).trim() : ''));
    if (winUrl) return winUrl;
  } catch {}
  // Always use the robot model (two separate instances)
  return '/models/avatars/robot/scene.gltf';
}

// Preload avatars (Player1 robot, Player2 tire)
try { useGLTF.preload('/models/avatars/robot/scene.gltf'); } catch {}
try { useGLTF.preload('/models/avatars/tire/scene.gltf'); } catch {} // may still be used later
try { useGLTF.preload('/models/avatars/capuccino/scene.gltf'); } catch {} // kept for future
try { useGLTF.preload('/models/avatars/shark/scene.gltf'); } catch {}

// Preload Alien 2 FBX clips for faster switch-in
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_3_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Walking_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Running_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_Turn_Left_withSkin.fbx'); } catch {}
try { useFBX.preload('/models/avatars/alien 2/Animation_Idle_Turn_Right_withSkin.fbx'); } catch {}
// Preload Astronaut FBX clips for faster switch-in
try { useFBX.preload('/models/avatars/astronaut/Breathing Idle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/Breathing Idle.fbx'); } catch {}
try { useFBX.preload('/models/avatars/astronaut/Walking.fbx'); } catch {}

// Fixed scale multiplier to reach final absolute height after normalization (inlined where needed)

function LoadedOpponent({ url, flip180, anchorY, z, faceDir, scaleMul, rotationOverride = null, positionOverride = null, xFront, xBack, zSign = -1 }) {
  const { scene, animations } = useGLTF(url);
  const isCapuccino = /capuccino/i.test(url);
  // Use SkeletonUtils.clone to preserve skinned mesh + skeleton hierarchy (fixes partial/missing geometry)
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const ref = useRef();
  const spineRef = useRef(null);
  const headRef = useRef(null);
  const shoulders = useRef({ left: null, right: null });
  // Attempt to keep decorative tube(s) anchored: collect all likely nodes by name
  const tubeRefs = useRef({ head: new Set(), body: new Set() });
  // Explicit bone map for the Neon Robot model (from provided GLTF node names)
  const boneMap = useRef({ spine0: null, spine1: null, spine2: null, lShoulder: null, rShoulder: null, lElbow: null, rElbow: null });
  // Base positions to allow gentle up/down bobbing without drifting
  const basePos = useRef({ spine: null, l: null, r: null, head: null, spine0: null, spine1: null, spine2: null, lSh: null, rSh: null, lEl: null, rEl: null });
  // Store initial rotations so we animate relative to the bind pose
  const baseRot = useRef({ spine: null, head: null, l: null, r: null, spine0: null, spine1: null, spine2: null, lSh: null, rSh: null, lEl: null, rEl: null });
  // Store the model root's normalized transform so animations can't drift it
  const baseRoot = useRef({ pos: new THREE.Vector3(0,0,0), rot: new THREE.Euler(0,0,0), scale: new THREE.Vector3(1,1,1) });
  // Built-in animation handling
  const groupRef = useRef();
  const { actions, names, clips } = useAnimations(animations || [], ref);
  const hasClips = !!(clips && clips.length);
  useLayoutEffect(() => {
  if (!ref.current || !cloned) return;
    const box = new THREE.Box3().setFromObject(ref.current);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      // Center inner root around its visual center so group pivot acts as true center
      ref.current.position.x += -center.x;
      ref.current.position.z += -center.z;
      const isCap = /capuccino/i.test(url);
      const isShark = /shark/i.test(url);
      if (isCap) {
        // Heuristic: choose a child with a moderate vertical extent as the "body" (ignoring far separated props)
        let bodyNode = null;
        let bodyHeight = Infinity;
        let bodyMinY = 0;
        ref.current.children.forEach(ch => {
          if (!ch.isObject3D) return;
          const cb = new THREE.Box3().setFromObject(ch);
            if (cb.isEmpty()) return;
            const h = cb.max.y - cb.min.y;
            // Skip extremely tall groups (likely including floating weapons) and very tiny ones
            if (h <= 0) return;
            if (h > size.y * 0.95) return; // looks like full range including props
            if (h < size.y * 0.02) return; // too small (single part)
            // Prefer a height closest to 30% of global size or just the first reasonable one
            const targetFrac = 0.30 * size.y;
            const score = Math.abs(h - targetFrac);
            // Track best candidate by minimal score; fallback to smallest reasonable height if not set
            if (!bodyNode || score < bodyHeight) {
              bodyNode = ch;
              bodyHeight = score;
              bodyMinY = cb.min.y;
            }
        });
        // Fallback: if no candidate, use global but clamp to avoid huge compression
        let effectiveHeight;
        let effectiveMinY;
        if (bodyNode) {
          const bb = new THREE.Box3().setFromObject(bodyNode);
          effectiveHeight = Math.max(0.0001, bb.max.y - bb.min.y);
          effectiveMinY = bb.min.y;
        } else {
          effectiveHeight = Math.max(0.0001, size.y * 0.45); // assume body is ~45% of total span
          effectiveMinY = box.min.y + size.y * 0.25; // ignore bottom quarter (possible outliers)
        }
        // Ground by shifting so chosen minY lands at y=0
        ref.current.position.y += -effectiveMinY;
        const desired = AVATAR_BASE_HEIGHT;
        const s = desired / effectiveHeight;
        ref.current.scale.multiplyScalar(s);
      } else if (isShark) {
        // Shark path: treat like robot (full recenter) PLUS glue obvious accessories to closest large parent before scaling
        const accessoryRegex = /(tooth|teeth|jaw|mouth|eye|fin)/i;
        const meshes = [];
        ref.current.traverse(o => { if (o.isMesh) meshes.push(o); });
        // Determine primary body as largest volume mesh
        let bodyMesh = null; let maxVol = 0;
        meshes.forEach(m => { const b = new THREE.Box3().setFromObject(m); if (b.isEmpty()) return; const s2 = new THREE.Vector3(); b.getSize(s2); const vol = s2.x*s2.y*s2.z; if (vol > maxVol) { maxVol = vol; bodyMesh = m; } });
        if (bodyMesh) {
          meshes.forEach(m => {
            if (m === bodyMesh) return;
            if (accessoryRegex.test(m.name || '')) {
              try { bodyMesh.attach(m); } catch {}
            }
          });
        }
        // Recompute box after attaching
        const box2 = new THREE.Box3().setFromObject(ref.current);
        const size2 = new THREE.Vector3(); const center2 = new THREE.Vector3();
        box2.getSize(size2); box2.getCenter(center2);
        ref.current.position.x += -center2.x;
        ref.current.position.z += -center2.z;
        ref.current.position.y += -box2.min.y;
        if (size2.y > 0) {
          const s = AVATAR_BASE_HEIGHT / size2.y;
          ref.current.scale.setScalar(s);
        }
      } else {
        // Robot (default) path: full recenter
        ref.current.position.x += -center.x;
        ref.current.position.z += -center.z;
        ref.current.position.y += -box.min.y;
        if (size.y > 0) {
          const s = AVATAR_BASE_HEIGHT / size.y;
          ref.current.scale.setScalar(s);
        }
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      try {
        const dbgBox = new THREE.Box3().setFromObject(ref.current);
        const dbgSize = new THREE.Vector3(); dbgBox.getSize(dbgSize);
        // eslint-disable-next-line no-console
        console.log('[Capuccino Avatar] normalized root', {
          pos: ref.current.position.clone(),
          scale: ref.current.scale.clone(),
          size: dbgSize
        });
      } catch {}
    }
    // Record the normalized root transform as our baseline
    baseRoot.current.pos.copy(ref.current.position);
    baseRoot.current.rot.copy(ref.current.rotation);
    baseRoot.current.scale.copy(ref.current.scale);
    // Skip robot-specific bone/tube mapping for capuccino model to prevent scattering
  if (!/capuccino/i.test(url) && !/shark/i.test(url)) {
      ref.current.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
        if (o.isBone) {
          const name = (o.name || '').toLowerCase();
          if (!spineRef.current && (name.includes('spine') || name.includes('chest'))) spineRef.current = o;
          if (!headRef.current && name.includes('head')) headRef.current = o;
          if (!spineRef.current && name.includes('hips')) spineRef.current = o;
          if (!shoulders.current.left && (name.includes('shoulder') && (name.includes('l') || name.includes('left') || name.endsWith('.l')))) shoulders.current.left = o;
          if (!shoulders.current.right && (name.includes('shoulder') && (name.includes('r') || name.includes('right') || name.endsWith('.r')))) shoulders.current.right = o;
          switch (o.name) {
            case 'Bone_00': boneMap.current.spine0 = o; break;
            case 'Bone.001_01': boneMap.current.spine1 = o; break;
            case 'Bone.002_02': boneMap.current.spine2 = o; break;
            case 'Bone.003_03': boneMap.current.lShoulder = o; break;
            case 'Bone.004_04': boneMap.current.lElbow = o; break;
            case 'Bone.005_05': boneMap.current.rShoulder = o; break;
            case 'Bone.006_06': boneMap.current.rElbow = o; break;
            default: break;
          }
        }
      });
    } else {
      // Still enable shadows for meshes in capuccino hierarchy
      ref.current.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    }

    // If we detected tube nodes, attach them to the appropriate bones/groups so they follow animation
    const headBone = headRef.current || boneMap.current.spine2 || null;
    const bodyBone = boneMap.current.spine1 || boneMap.current.spine0 || spineRef.current || null;
    try {
      if (headBone && tubeRefs.current.head.size) {
        tubeRefs.current.head.forEach((node) => {
          if (node && node.parent !== headBone) headBone.attach(node);
        });
      }
    } catch {}
    try {
      if (bodyBone && tubeRefs.current.body.size) {
        tubeRefs.current.body.forEach((node) => {
          if (node && node.parent !== bodyBone) bodyBone.attach(node);
        });
      }
    } catch {}
    // Record base rotations once
    baseRot.current.spine  = spineRef.current?.rotation ? spineRef.current.rotation.clone() : null;
    baseRot.current.head   = headRef.current?.rotation ? headRef.current.rotation.clone() : null;
    baseRot.current.l      = shoulders.current.left?.rotation ? shoulders.current.left.rotation.clone() : null;
    baseRot.current.r      = shoulders.current.right?.rotation ? shoulders.current.right.rotation.clone() : null;
    baseRot.current.spine0 = boneMap.current.spine0?.rotation ? boneMap.current.spine0.rotation.clone() : null;
    baseRot.current.spine1 = boneMap.current.spine1?.rotation ? boneMap.current.spine1.rotation.clone() : null;
    baseRot.current.spine2 = boneMap.current.spine2?.rotation ? boneMap.current.spine2.rotation.clone() : null;
    baseRot.current.lSh    = boneMap.current.lShoulder?.rotation ? boneMap.current.lShoulder.rotation.clone() : null;
    baseRot.current.rSh    = boneMap.current.rShoulder?.rotation ? boneMap.current.rShoulder.rotation.clone() : null;
    baseRot.current.lEl    = boneMap.current.lElbow?.rotation ? boneMap.current.lElbow.rotation.clone() : null;
    baseRot.current.rEl    = boneMap.current.rElbow?.rotation ? boneMap.current.rElbow.rotation.clone() : null;
  // Record base positions once (for subtle vertical bobbing of upper body)
  basePos.current.spine  = spineRef.current?.position ? spineRef.current.position.clone() : null;
  basePos.current.l      = shoulders.current.left?.position ? shoulders.current.left.position.clone() : null;
  basePos.current.r      = shoulders.current.right?.position ? shoulders.current.right.position.clone() : null;
  basePos.current.head   = headRef.current?.position ? headRef.current.position.clone() : null;
  basePos.current.spine0 = boneMap.current.spine0?.position ? boneMap.current.spine0.position.clone() : null;
  basePos.current.spine1 = boneMap.current.spine1?.position ? boneMap.current.spine1.position.clone() : null;
  basePos.current.spine2 = boneMap.current.spine2?.position ? boneMap.current.spine2.position.clone() : null;
  basePos.current.lSh    = boneMap.current.lShoulder?.position ? boneMap.current.lShoulder.position.clone() : null;
  basePos.current.rSh    = boneMap.current.rShoulder?.position ? boneMap.current.rShoulder.position.clone() : null;
  basePos.current.lEl    = boneMap.current.lElbow?.position ? boneMap.current.lElbow.position.clone() : null;
  basePos.current.rEl    = boneMap.current.rElbow?.position ? boneMap.current.rElbow.position.clone() : null;
  }, [cloned, scaleMul]);
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (typeof xFront === 'number' ? xFront : AVATAR_X_FRONT) : (typeof xBack === 'number' ? xBack : AVATAR_X_BACK));
  const py = AVATAR_BAKED_POS[1];
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const groupRotation = rotationOverride ?? [0, pz > 0 ? Math.PI : 0, 0];
  const baseY = anchorY + py; // support Y anchor
  useFrame(({ clock }) => {
    const g = groupRef.current; if (!g) return;
    // Root stays put so feet contact remains constant (unless overridden)
    const useOverride = Array.isArray(positionOverride);
    const outX = useOverride ? (positionOverride[0] || 0) : px;
    const outZ = useOverride ? (positionOverride[2] || 0) : pz;
    g.position.x = outX;
    g.position.y = baseY;
    g.position.z = outZ;
    g.scale.set(scaleMul, scaleMul, scaleMul);
    // Apply full rotation override if provided, else preserve existing y (camera-facing) and set z from groupRotation
    if (Array.isArray(rotationOverride)) {
      g.rotation.set(rotationOverride[0] || 0, rotationOverride[1] || 0, rotationOverride[2] || 0);
    } else {
      g.rotation.z = groupRotation?.[2] || 0;
    }
    // If model has native animation clips, lock the model root to baseline so placement matches robot
    if (ref.current && baseRoot.current) {
      ref.current.position.copy(baseRoot.current.pos);
      ref.current.rotation.copy(baseRoot.current.rot);
      ref.current.scale.copy(baseRoot.current.scale);
    }
    // Skip custom robot bone sway logic for capuccino model (prevents malformed pose / missing parts)
    if (isCapuccino) return;
    // Apply tiny rotations to upper bones if we found them
  const t = clock.getElapsedTime();
    const sway = Math.sin(t * AVATAR_IDLE_SPEED_Z * 2 * Math.PI) * AVATAR_IDLE_SWAY_Z;
    const nodFast  = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.10);
    const nodSlow  = Math.sin(t * (AVATAR_IDLE_SPEED_Y * 0.65) * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.06);
    // Gentle vertical bob for breathing – apply as translation to upper body anchors
  const bob  = Math.sin(t * AVATAR_IDLE_SPEED_Y * 2 * Math.PI) * (AVATAR_IDLE_AMP_Y * 0.30);
  // Occasional slow weight shift (very low frequency lean)
  // Much subtler occasional weight shift: slower and smaller
  const shift = Math.sin(t * 0.05 * 2 * Math.PI) * 0.02; // ~20s period, ~1.1°

    // Prefer explicit robot bones for more natural distribution
    const b = boneMap.current;
    if (b.spine0 && baseRot.current.spine0) {
      // hips/base: keep feet planted; very subtle slow lean
      b.spine0.rotation.z = baseRot.current.spine0.z + (-sway * 0.25) + (shift * 0.3);
      b.spine0.rotation.x = baseRot.current.spine0.x + (nodSlow * 0.3);
    }
    if (b.spine1 && baseRot.current.spine1) {
      b.spine1.rotation.z = baseRot.current.spine1.z + (sway * 0.6) + (shift * 0.25);
      b.spine1.rotation.x = baseRot.current.spine1.x + (nodSlow * 0.6);
    }
    if (b.spine2 && baseRot.current.spine2) {
      b.spine2.rotation.z = baseRot.current.spine2.z + (sway * 0.85) + (shift * 0.12);
      b.spine2.rotation.x = baseRot.current.spine2.x + (nodFast * 1.0);
      if (b.spine2.position && basePos.current.spine) b.spine2.position.y = basePos.current.spine.y + bob * 0.6;
    }
    if (b.lShoulder && baseRot.current.lSh) b.lShoulder.rotation.z = baseRot.current.lSh.z + (-sway * 0.9) + (-shift * 0.18);
    if (b.rShoulder && baseRot.current.rSh) b.rShoulder.rotation.z = baseRot.current.rSh.z + (sway * 0.9) + (shift * 0.18);
    if (b.lElbow && baseRot.current.lEl) b.lElbow.rotation.z = baseRot.current.lEl.z + (sway * 0.15);
    if (b.rElbow && baseRot.current.rEl) b.rElbow.rotation.z = baseRot.current.rEl.z + (-sway * 0.15);

    // Fallback to generic captures if explicit ones are missing
    if (!b.spine0 && spineRef.current && baseRot.current.spine) {
      spineRef.current.rotation.z = baseRot.current.spine.z + sway * 1.0;
      spineRef.current.rotation.x = baseRot.current.spine.x + nodFast * 0.28;
      if (basePos.current.spine) spineRef.current.position.y = basePos.current.spine.y + bob;
    }
    if (!b.lShoulder && shoulders.current.left && baseRot.current.l) {
      shoulders.current.left.rotation.z = baseRot.current.l.z + (-sway * 0.9);
      if (basePos.current.l) shoulders.current.left.position.y = basePos.current.l.y + bob;
    }
    if (!b.rShoulder && shoulders.current.right && baseRot.current.r) {
      shoulders.current.right.rotation.z = baseRot.current.r.z + (sway * 0.9);
      if (basePos.current.r) shoulders.current.right.position.y = basePos.current.r.y + bob;
    }
    // No camera-aware motion per request
  });
  // Play built-in idle (or first clip) if present
  useLayoutEffect(() => {
    if (!hasClips || !actions) return;
    const idleName = (names && names.find(n => /idle/i.test(n))) || Object.keys(actions)[0];
    const a = idleName ? actions[idleName] : null;
    if (a) {
      a.reset().fadeIn(0.25).play();
    }
    return () => { if (a) a.fadeOut(0.2); };
  }, [hasClips, actions, names]);
  return (
  <group ref={groupRef} position={[px, baseY, pz]} rotation={groupRotation} scale={[scaleMul, scaleMul, scaleMul]} raycast={null} frustumCulled={false}>
      <primitive ref={ref} object={cloned} dispose={null} />
      <group position={[0, 0, faceDir * 0.12]} />
    </group>
  );
}

// Minimal loader for inspection (no bone logic) – used for capuccino test
// Specialized component to properly normalize and display the capuccino model.
// Strategy:
// 1. Clone with SkeletonUtils to preserve any skinning.
// 2. Identify "core" meshes (body/limbs/head/shoes) by name patterns, ignoring accessories (katana, bandana, facial detail) for scaling.
// 3. Compute bounding box of core set; fallback to global if none.
// 4. Recentre X/Z on core center, ground on core minY, scale core height to AVATAR_BASE_HEIGHT.
// 5. Do not manipulate bones or apply robot idle sway; remain static for integrity.
function CapuccinoOpponent({ rotation=[0,Math.PI,0], xOffset=0, zSign=-1, xFront=AVATAR_X_FRONT, xBack=AVATAR_X_BACK }) {
  const url = '/models/avatars/capuccino/scene.gltf';
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const wrapRef = useRef(); // group we move/scale
  const modelRef = useRef();
  useLayoutEffect(() => {
    if (!cloned || !modelRef.current || !wrapRef.current) return;
    // Collect candidate core meshes
    const coreRegex = /(body_|legs_|arms_|hands_|shoes_|capuccinoassasino|spine_|root_01|head_)/i;
  const accessoryRegex = /(katana|bandana|cup|eyebrow|eyelid|eyes?)/i;
  const accessories = [];
    const coreMeshes = [];
    modelRef.current.traverse(o => {
      if (o.isMesh) {
        const n = (o.name||'');
        if (coreRegex.test(n) && !accessoryRegex.test(n)) coreMeshes.push(o); else if (accessoryRegex.test(n)) accessories.push(o);
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      }
    });
    let coreBox = new THREE.Box3();
    if (coreMeshes.length) {
      coreMeshes.forEach(m => coreBox.expandByObject(m));
    } else {
      coreBox.setFromObject(modelRef.current);
    }
    if (coreBox.isEmpty()) return;
    const coreSize = new THREE.Vector3(); coreBox.getSize(coreSize);
    const coreCenter = new THREE.Vector3(); coreBox.getCenter(coreCenter);
    const coreHeight = coreSize.y > 0 ? coreSize.y : 1;
    const scale = AVATAR_BASE_HEIGHT / coreHeight;
    // Apply transforms to modelRef (child of wrapRef) so we can still position wrapRef in world
    modelRef.current.position.x += -coreCenter.x;
    modelRef.current.position.z += -coreCenter.z;
    modelRef.current.position.y += -coreBox.min.y; // ground feet/base
    modelRef.current.scale.multiplyScalar(scale);

    // Process accessories: either hide distant ones or pull them toward the body root.
    const MAX_DIST = coreSize.length() * 1.2; // heuristic threshold
    accessories.forEach(a => {
      const apos = new THREE.Vector3(); a.getWorldPosition(apos);
      const rel = apos.clone().sub(coreCenter);
      if (rel.length() > MAX_DIST) {
        // Hide extreme outliers (likely duplicate props far away)
        a.visible = false;
      } else {
        // Recentre moderate-distance accessories so they cling to body (preserve vertical offset a bit)
        a.position.x += -coreCenter.x * 0.9;
        a.position.z += -coreCenter.z * 0.9;
      }
    });
  }, [cloned]);

  if (!cloned) return null;
  // Compute anchored world placement similar to other avatars
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? xFront : xBack) + xOffset;
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - 0.02; const py = AVATAR_BAKED_POS[1];
  const baseScale = AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT * CAPUCCINO_SCALE_BOOST;
  return (
    <group ref={wrapRef} position={[px, groundY + py, pz]} rotation={rotation} scale={[baseScale, baseScale, baseScale]} frustumCulled={false}>
      <group ref={modelRef}>
        <primitive object={cloned} dispose={null} />
      </group>
    </group>
  );
}

// (Removed custom SharkOpponent; shark now uses the same GLTFOpponent pipeline as robot.)

function GLTFOpponent({ url, flip180 = false, rotationOverride = null, scaleOverride = 1, positionOverride = null, xFront, xBack, zSign = -1 }) {
  // Match ground/table reference used elsewhere
  const fh = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fh / 2 - 0.02;
  const scaleMul = (AVATAR_FINAL_HEIGHT / AVATAR_BASE_HEIGHT) * (Number.isFinite(scaleOverride) ? scaleOverride : 1);
  // LoadedOpponent normalizes then applies scaleMul and idle animation
  return (
    <LoadedOpponent
      url={url}
      flip180={flip180}
      anchorY={groundY}
      z={0}
      faceDir={0}
      scaleMul={scaleMul}
      rotationOverride={rotationOverride}
      positionOverride={positionOverride}
      xFront={xFront}
      xBack={xBack}
      zSign={zSign}
    />
  );
}

// RawSharkOpponent: load shark exactly as authored (no recenter per child, no accessory re-parent),
// only ground and uniformly scale via inner pivot, then place via outer group.
function RawSharkOpponent({ xFront, xBack, zSign = -1 }) {
  const url = '/models/avatars/shark/scene.gltf';
  const { scene, animations } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef(); // we shift & scale this
  const { actions, clips } = useAnimations(animations || [], pivotRef);
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    // Add cloned scene once under pivot
    if (!pivotRef.current.__added && cloned) {
      pivotRef.current.add(cloned);
      pivotRef.current.__added = true;
    }
    // Compute full scene bounds WITHOUT altering child transforms (preserve layout)
    const box = new THREE.Box3().setFromObject(cloned);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      // Do NOT move or re-parent any skinned child; adjust only the pivot to keep authored hierarchy intact
      pivotRef.current.position.set(-center.x, -box.min.y, -center.z);
      if (size.y > 0) {
        const innerScale = AVATAR_BASE_HEIGHT / size.y; // normalize height
        pivotRef.current.scale.setScalar(innerScale);
      }
    }
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  // Play first animation clip (if any) similar to robot approach
  useLayoutEffect(() => {
    if (!actions || !clips || !clips.length) return;
    const first = clips[0];
    const act = actions[first.name];
    if (act) { act.reset().fadeIn(0.25).play(); }
    return () => { if (act) act.fadeOut(0.2); };
  }, [actions, clips]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const outerScale = (AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT) * SHARK_SCALE_BOOST; // boosted final presence
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? 0 : Math.PI), 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef} />
    </group>
  );
}

// SharkFixed: "glue" scattered shark parts (teeth/eyes/fins) to the main body and apply only wrapper scaling.
// Strategy:
// 1. Clone scene untouched.
// 2. Identify main body mesh (largest volume or name match).
// 3. Categorize accessory meshes (teeth/eyes/mouth/jaw) and re-parent them to body root (preserves world transforms but keeps them together).
// 4. Compute body bounding box (body root only) to determine scale + ground offset.
// 5. Apply translation (ground) and uniform scale ONLY at an inner pivot group; outer group handles world placement & final size.
// 6. Optionally down-scale oversized accessories ( > 20% of body height ).
function SharkFixed({ xFront, xBack, zSign = -1 }) {
  const url = '/models/avatars/shark/scene.gltf';
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef();
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    const bodyRegex = /(body|torso|main|mesh)/i;
    const accessoryRegex = /(tooth|teeth|jaw|mouth|eye|fin)/i;
    let bodyMesh = null;
    const accessories = [];
    const meshes = [];
    cloned.traverse(o => {
      if (o.isMesh) {
        meshes.push(o);
        // choose body by name first, else largest volume
        if (bodyRegex.test(o.name || '')) {
          if (!bodyMesh) bodyMesh = o;
        }
      }
    });
    if (!bodyMesh) {
      // fallback: largest volume
      let maxVol = 0;
      meshes.forEach(m => {
        const b = new THREE.Box3().setFromObject(m); if (b.isEmpty()) return;
        const s = new THREE.Vector3(); b.getSize(s); const vol = s.x*s.y*s.z;
        if (vol > maxVol) { maxVol = vol; bodyMesh = m; }
      });
    }
    // collect accessories (exclude body)
    meshes.forEach(m => { if (m !== bodyMesh && accessoryRegex.test(m.name || '')) accessories.push(m); });
    // Re-parent accessories to body so scaling/placement remains cohesive
    if (bodyMesh) {
      accessories.forEach(a => { if (a.parent !== bodyMesh) try { bodyMesh.attach(a); } catch {} });
    }
    // Compute body bounding box AFTER re-parent
    const bodyBox = bodyMesh ? new THREE.Box3().setFromObject(bodyMesh) : new THREE.Box3().setFromObject(cloned);
    if (bodyBox.isEmpty()) return;
    const bodySize = new THREE.Vector3(); bodyBox.getSize(bodySize);
    const bodyHeight = bodySize.y || 1;
    const minY = bodyBox.min.y;
    // Ground offset: shift pivot so body minY -> 0
    pivotRef.current.position.y += -minY;
    // Normalize body to base height at pivot level
    const normScale = AVATAR_BASE_HEIGHT / bodyHeight;
    pivotRef.current.scale.set(normScale, normScale, normScale);
    // Clamp huge accessories relative to body height
    accessories.forEach(a => {
      try {
        const ab = new THREE.Box3().setFromObject(a); if (ab.isEmpty()) return;
        const as = new THREE.Vector3(); ab.getSize(as);
        const maxDim = Math.max(as.x, as.y, as.z);
        const desired = bodyHeight * 0.20;
        if (maxDim > desired && maxDim > 0) {
          const s = desired / maxDim;
            a.scale.multiplyScalar(s);
        }
      } catch {}
    });
    // Shadows & culling flags
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const finalScale = AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT; // amplify normalized body
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? Math.PI : 0), 0]} scale={[finalScale, finalScale, finalScale]} frustumCulled={false}>
      <group ref={pivotRef}>
        <primitive object={cloned} dispose={null} />
      </group>
    </group>
  );
}

// Generic skinned GLTF opponent that preserves authored skeleton and node parenting.
// It centers on X/Z, grounds at minY, and normalizes height by moving/scaling a pivot above the cloned scene.
// No re-parenting or per-mesh transforms are applied to avoid breaking skinning.
function SkinnedGLTFOpponent({ url, xFront, xBack, zSign = -1, scaleBoost = 1 }) {
  const { scene, animations } = useGLTF(url);
  const cloned = useMemo(() => (scene ? skeletonClone(scene) : null), [scene]);
  const pivotRef = useRef();
  const { actions, clips } = useAnimations(animations || [], pivotRef);
  useLayoutEffect(() => {
    if (!cloned || !pivotRef.current) return;
    // Add once
    if (!pivotRef.current.__added && cloned) {
      pivotRef.current.add(cloned);
      pivotRef.current.__added = true;
    }
    // Compute bounds of the authored hierarchy
    const box = new THREE.Box3().setFromObject(cloned);
    if (!box.isEmpty()) {
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      // Shift only the pivot so minY -> 0 and model is centered in X/Z
      pivotRef.current.position.set(-center.x, -box.min.y, -center.z);
      if (size.y > 0) {
        const innerScale = AVATAR_BASE_HEIGHT / size.y; // normalize height
        pivotRef.current.scale.setScalar(innerScale);
      }
    }
    // Enable shadows on meshes
    cloned.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  }, [cloned]);
  // Play first clip if present
  useLayoutEffect(() => {
    if (!actions || !clips || !clips.length) return;
    const first = clips[0];
    const act = actions[first.name];
    if (act) { act.reset().fadeIn(0.25).play(); }
    return () => { if (act) act.fadeOut(0.2); };
  }, [actions, clips]);
  if (!cloned) return null;
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh/2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const outerScale = (AVATAR_FINAL_HEIGHT/AVATAR_BASE_HEIGHT) * (Number.isFinite(scaleBoost) ? scaleBoost : 1);
  return (
    <group position={[px, groundY + py, pz]} rotation={[0, (zSign === -1 ? Math.PI : 0), 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef} />
    </group>
  );
}

// Sandbox-style alien loader: no normalization of inner hierarchy; enforce skinning; filter tracks; lock root motion; clamp bone scale; zero non-bone transforms.
function AlienSandboxOpponent({ url = '/models/avatars/alien/scene.gltf', xFront, xBack, zSign = -1, centerInParent = false, positionOverride = null, isWalking = false }) {
  const { scene, animations } = useGLTF(url);
  const innerRef = useRef();
  const pivotRef = useRef();
  const outerRef = useRef();
  const anchorBoneRef = useRef(null);
  const anchorInitPos = useRef(new THREE.Vector3());
  const pivotBasePos = useRef(new THREE.Vector3());
  // Enforce skinning and basic render flags; optionally zero out non-bone transforms
  useLayoutEffect(() => {
  if (!scene) return;
  scene.traverse((o) => {
      if (o.isSkinnedMesh && o.material) {
        if (!o.material.skinning) { o.material.skinning = true; o.material.needsUpdate = true; }
      }
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
      const isBone = o.isBone || o.type === 'Bone';
      if (!isBone) {
        if (o.position && (o.position.x !== 0 || o.position.y !== 0 || o.position.z !== 0)) o.position.set(0,0,0);
        if (o.scale && (o.scale.x !== 1 || o.scale.y !== 1 || o.scale.z !== 1)) o.scale.set(1,1,1);
        if (o.updateMatrix) o.updateMatrix();
      }
    });
    // Removed auto-grounding (minY -> 0) for Alien
  }, [scene]);
  // Optionally center the model in its parent so the pivot is at the visual center
  useLayoutEffect(() => {
  if (!centerInParent || !scene || !pivotRef.current) return;
    if (pivotRef.current.__centeredOnce) return;
    try {
      const box = new THREE.Box3();
  scene.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox?.clone();
          if (bb) { bb.applyMatrix4(o.matrixWorld); box.union(bb); }
        }
      });
      if (!box.isEmpty()) {
        const center = new THREE.Vector3(); box.getCenter(center);
        // move inner model so its center aligns with parent's origin (idempotent)
        const px = pivotRef.current.position.x;
        const pz = pivotRef.current.position.z;
        pivotRef.current.position.set(-center.x, pivotRef.current.position.y, -center.z);
        // Update base after first centering
        pivotBasePos.current.copy(pivotRef.current.position);
        pivotRef.current.__centeredOnce = true;
      }
    } catch {}
  }, [centerInParent, scene]);
  // Filter animations like sandbox: drop non-bone tracks, lock root bone position/scale, clamp bone scales
  const filteredClips = useMemo(() => {
  if (!animations || !scene) return animations || [];
    const nameToObj = new Map();
  scene.traverse((o) => { if (o.name) nameToObj.set(o.name, o); });
    const rootBoneNames = new Set();
  scene.traverse((o) => {
      if ((o.isBone || o.type === 'Bone') && (!o.parent || !(o.parent.isBone || o.parent.type === 'Bone'))) {
        if (o.name) rootBoneNames.add(o.name);
      }
    });
  const filterNonBoneTransforms = true;
  const lockRootMotion = false; // allow authored root motion
  const clampBoneScale = true;
  const stripBoneXZTranslation = false; // keep authored bone translations
    return animations.map((clip) => {
      const dropped = [];
      const newTracks = [];
      for (const track of clip.tracks) {
        const firstDot = track.name.indexOf('.');
        const nodeName = firstDot === -1 ? track.name : track.name.slice(0, firstDot);
        const property = firstDot === -1 ? '' : track.name.slice(firstDot + 1);
        const obj = nameToObj.get(nodeName);
  // If the target node doesn't exist in the loaded scene, drop the track to avoid unexpected transforms.
  if (!obj) { dropped.push(track.name); continue; }
        const isBone = obj.isBone || obj.type === 'Bone';
  // Keep animation only on bones; drop transforms on meshes or groups
  if (filterNonBoneTransforms && !isBone) { dropped.push(track.name); continue; }
        if (lockRootMotion && isBone && (property.startsWith('position') || property.startsWith('scale')) && rootBoneNames.has(nodeName)) {
          dropped.push(track.name); continue;
        }
        // Remove forward locomotion baked into bone position tracks: keep vertical bob (Y), zero X/Z.
        if (
          stripBoneXZTranslation &&
          isBone &&
          property.startsWith('position')
        ) {
          try {
            const ctor = track.constructor;
            const times = track.times?.slice();
            const values = track.values?.slice();
            if (values && values.length % 3 === 0) {
              // Check if X/Z have meaningful movement to avoid touching non-moving tracks
              let sumXZ = 0;
              for (let i = 0; i < values.length; i += 3) {
                sumXZ += Math.abs(values[i]) + Math.abs(values[i+2]);
              }
              if (sumXZ > 1e-5) {
                for (let i = 0; i < values.length; i += 3) {
                  // x, y, z — keep y (vertical), zero x/z to eliminate drift
                  values[i] = 0;
                  // values[i+1] stays as is (breathe/bounce)
                  values[i+2] = 0;
                }
                newTracks.push(new ctor(track.name, times, values, track.interpolation));
                continue;
              }
            }
          } catch {}
        }
        if (clampBoneScale && isBone && property.startsWith('scale')) {
          try {
            const ctor = track.constructor;
            const times = track.times?.slice();
            const values = track.values?.slice();
            if (values && values.length % 3 === 0) {
              const minS = 0.01, maxS = 100;
              for (let i = 0; i < values.length; i += 3) {
                values[i]   = Math.min(maxS, Math.max(minS, values[i]));
                values[i+1] = Math.min(maxS, Math.max(minS, values[i+1]));
                values[i+2] = Math.min(maxS, Math.max(minS, values[i+2]));
              }
              newTracks.push(new ctor(track.name, times, values, track.interpolation));
              continue;
            }
          } catch {}
        }
        newTracks.push(track);
      }
      if (newTracks.length === clip.tracks.length) return clip;
      const clonedClip = clip.clone();
      clonedClip.tracks = newTracks;
      if (dropped.length) {
        try { console.info('[C4 Alien] Dropped tracks:', dropped); } catch {}
      }
      return clonedClip;
    });
  }, [animations, scene]);
  // Use one mixer for all clips and cross-fade between idle and walk
  const { actions: allActions, names: clipNames } = useAnimations(filteredClips || [], innerRef);
  const currentActionRef = useRef(null); // 'idle' | 'walk' | null
  const pickIdleName = useMemo(() => {
    const clips = filteredClips || [];
    if (!clips.length) return null;
    const byName = (re) => clips.find((c) => re.test(c.name || ''));
    let idle = byName(/idle|stand|breath|breathe/i);
    if (!idle) idle = clips.reduce((a,b)=> (a && a.duration>=b.duration?a:b), null) || clips[0];
    return idle ? (idle.name || null) : null;
  }, [filteredClips]);
  const pickWalkName = useMemo(() => {
    const clips = filteredClips || [];
    if (!clips.length) return null;
    const byName = (re) => clips.find((c) => re.test(c.name || ''));
    // Prefer explicit alien clip names if present
    let w = clips.find(c => (c.name||'').toLowerCase() === 'zbs_phobos.qc_skeleton|zbs_walk'.toLowerCase());
    if (!w) w = byName(/walk|run|move|stride|jog|locomotion|forward|pace|step/i);
    if (!w) {
      const idleLike = /idle|stand|breath|breathe|pose|look/i;
      w = clips.find(c => !idleLike.test(c.name||'') && (c.duration||0) > 0.5) || null;
    }
    return w ? (w.name || null) : null;
  }, [filteredClips]);
  useLayoutEffect(() => {
    if (!allActions) return;
    const idle = pickIdleName ? allActions[pickIdleName] : null;
    const walk = pickWalkName ? allActions[pickWalkName] : null;
    const want = isWalking ? 'walk' : 'idle';
    if (currentActionRef.current === want) return;
    // stop previous
    try {
      if (currentActionRef.current === 'walk' && walk) walk.stop();
      if (currentActionRef.current === 'idle' && idle) idle.stop();
    } catch {}
    // start next
    if (isWalking && walk) {
      try { walk.reset().setEffectiveWeight(1).setEffectiveTimeScale(1.0).setLoop(THREE.LoopRepeat, Infinity).play(); } catch {}
    } else if (!isWalking && idle) {
      try { idle.reset().setEffectiveWeight(1).setEffectiveTimeScale(1.0).setLoop(THREE.LoopRepeat, Infinity).play(); } catch {}
      // when going to idle, snap pivot back to base to clear any in-place offsets
      if (pivotRef.current && pivotBasePos.current) {
        pivotRef.current.position.x = pivotBasePos.current.x;
        pivotRef.current.position.z = pivotBasePos.current.z;
      }
    }
    currentActionRef.current = want;
    return () => { /* keep actions managed by drei mixer lifecycle */ };
  }, [allActions, isWalking, pickIdleName, pickWalkName]);

  // Find an anchor bone (prefer hips/pelvis, fallback to any root bone) and capture its initial parent-local XZ baseline
  useEffect(() => {
  if (!scene || !pivotRef.current) return;
    let hips = null;
    const roots = [];
  scene.traverse((o) => {
      if (o && (o.isBone || o.type === 'Bone')) {
        const nm = (o.name || '').toLowerCase();
        if (/hip|pelvis/.test(nm)) hips = o;
        if (!o.parent || !(o.parent.isBone || o.parent.type === 'Bone')) roots.push(o);
      }
    });
    const anchor = hips || roots[0] || null;
    anchorBoneRef.current = anchor;
    if (anchor) {
      try {
        anchor.updateWorldMatrix && anchor.updateWorldMatrix(true, false);
        const world = new THREE.Vector3();
        anchor.getWorldPosition(world);
        const parent = outerRef.current;
        if (parent && parent.worldToLocal) {
          const local = world.clone();
          parent.worldToLocal(local);
          anchorInitPos.current.copy(local);
        } else {
          anchorInitPos.current.copy(world);
        }
      } catch {}
    }
    // record current pivot offset as base
    if (pivotRef.current) pivotBasePos.current.copy(pivotRef.current.position || new THREE.Vector3());
  }, [scene]);

  // (Removed re-baseline on state change to avoid any visual separation or snapping)

  // Runtime inverse-offset to keep animation in-place on X/Z (preserve vertical bob).
  // Compute anchor drift in the parent's local space so we don't fight parent rotation/translation.
  useFrame(() => { /* no in-place enforcement; play clips as-authored */ });
  // World placement using only parent-level transforms (no inner normalization)
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const baseY = groundY + py;
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;
  const outerScale = 0.09; // slightly reduced alien presence
  // Do not auto-flip by side; facing is controlled by parent mover/overrides
  const rotY = 0;
  // Note: removed auto floor calibration and per-frame height adjustments for Alien

  return (
  <group ref={outerRef} position={[outX, baseY, outZ]} rotation={[0, rotY, 0]} scale={[outerScale, outerScale, outerScale]} frustumCulled={false}>
      <group ref={pivotRef}>
  {scene ? <primitive ref={innerRef} object={scene} dispose={null} /> : null}
      </group>
    </group>
  );
}

// FBX-based Alien 2 opponent: Idle when stopped, Walk when moving
function Alien2FBXOpponent({
  baseUrl = '/models/avatars/alien 2/Animation_Idle_3_withSkin.fbx',
  walkUrl = '/models/avatars/alien 2/Animation_Walking_withSkin.fbx',
  runUrl = '/models/avatars/alien 2/Animation_Running_withSkin.fbx',
  turnLeftUrl = '/models/avatars/alien 2/Animation_Idle_Turn_Left_withSkin.fbx',
  turnRightUrl = '/models/avatars/alien 2/Animation_Idle_Turn_Right_withSkin.fbx',
  jumpUrl = '/models/avatars/alien 2/Animation_Regular_Jump_withSkin.fbx',
  xFront,
  xBack,
  zSign = -1,
  positionOverride = null,
  isWalking = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  yawOffset = 0,
  scaleMul = 0.09, // slightly reduced default size
  isJumping = false,
  extraLiftY = 0
}){
  // Load both FBXs unconditionally for stable hook order
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  // Clone the loaded FBX so multiple instances don't share the same skinned meshes
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();
  

  // Merge animations and namespace to pick deterministically
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run  && run.animations)  ? run.animations  : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations)? tright.animations: []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);
  const baseAnims = useMemo(() => baseAnimsRaw.map(c => new THREE.AnimationClip(`base:${c.name || 'clip'}`, c.duration, c.tracks)), [baseAnimsRaw]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, c.tracks)), [walkAnimsRaw]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, c.tracks)), [runAnimsRaw]);
  // For turn clips, filter tracks so animation is in-place (no root translation and no hips/pelvis yaw)
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        // drop all position tracks to avoid lateral drift
        if (n.endsWith('.position')) return false;
        // drop hips/pelvis rotation so the clip doesn't rotate the whole body root
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  // For jump, drop root position tracks so animation stays in-place; keep rotations intact
  const filterJumpTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        return true;
      });
    } catch { return tracks; }
  }, []);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, filterJumpTracks(c.tracks)
  )), [jumpAnimsRaw, filterJumpTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);

  // Ground and enable shadows on the authored model directly
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) model.position.y += -box.min.y;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      // Adjust idle stance: bring feet closer together by slightly adducting upper legs
      try {
        const normName = (s)=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
        const bones = [];
        model.traverse(o => { if (o && (o.isBone || o.type==='Bone')) bones.push(o); });
        const findUpper = (side)=>{
          const targetA = side==='L' ? ['leftupleg','leftthigh'] : ['rightupleg','rightthigh'];
          return bones.find(b=>{ const n=normName(b.name); return targetA.some(t=>n.includes(t)); });
        };
        const L = findUpper('L');
        const R = findUpper('R');
        const angle = 0.10; // ~5.7 degrees inward
        if (L) { L.rotation.z = (L.rotation?.z || 0) - angle; }
        if (R) { R.rotation.z = (R.rotation?.z || 0) + angle; }
      } catch {}
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    // Apply current UI speed immediately
    try {
      let v = 1.0;
      if (name.startsWith('walk:')) v = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE);
      else if (name.startsWith('run:')) v = getAnimSpeed('alien.run', RUN_ANIM_TIMESCALE);
  else if (name.startsWith('jump:')) v = getAnimSpeed('alien.jump', 0.4);
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
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
  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);
  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);

  // Start idle immediately to avoid bind-pose flash; then cross-fade based on isWalking
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
    // Jump takes precedence when flagged
    if (isJumping && pickJumpName) {
      crossFadeTo(pickJumpName);
  try { actions[pickJumpName].timeScale = getAnimSpeed('alien.jump', 0.4); } catch {}
    } else if (isRunning && pickRunName) {
      crossFadeTo(pickRunName);
      // Slow run even more by default (can be overridden via window.__CF_ANIM_SPEEDS__)
  try { actions[pickRunName].timeScale = getAnimSpeed('alien.run', 0.42); } catch {}
    } else if (isWalking && pickWalkName) {
      crossFadeTo(pickWalkName);
      // Walk faster than before
  try { actions[pickWalkName].timeScale = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE + 0.30); } catch {}
    } else if (isWalking && pickRunName) { // fallback: no walk clip available
      crossFadeTo(pickRunName);
  try { actions[pickRunName].timeScale = Math.max(0.5, getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE + 0.30) + 0.05); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    // Apply latest UI speeds every frame so changes take effect immediately
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
  if (nm.startsWith('walk:')) v = getAnimSpeed('alien.walk', WALK_ANIM_TIMESCALE + 0.30);
  else if (nm.startsWith('run:')) v = getAnimSpeed('alien.run', 0.42);
  else if (nm.startsWith('jump:')) v = getAnimSpeed('alien.jump', 0.4);
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
  });

  // World placement: keep consistent with GLTF avatars using baked constants
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  // Use the provided instance yawOffset
  const effYawOffset = yawOffset;
  // Slightly lift the astronaut during walk/run so feet don't sink into the floor
  const walkLiftY = 0.24; // increased significantly per request
  const runLiftY = 0.34;  // higher lift while running
  const liftY = isRunning ? runLiftY : (isWalking ? walkLiftY : 0);
  return (
    <group ref={outerRef} position={[outX, groundY + py, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY + (extraLiftY || 0), 0]}>
        <primitive object={model} dispose={null} />
      </group>
    </group>
  );
}

// FBX-based Astronaut (Player 1 replacement for robot): Idle/Walk/Run with cross-fades
function AstronautFBXOpponent({
  baseUrl = '/models/avatars/astronaut/Breathing Idle.fbx',
  walkUrl = '/models/avatars/astronaut/Walking.fbx',
  runUrl = '/models/avatars/astronaut/Running.fbx',
  turnLeftUrl = '/models/avatars/astronaut/Left Turn.fbx',
  turnRightUrl = '/models/avatars/astronaut/Right Turn.fbx',
  jumpUrl = '/models/avatars/astronaut/Jump.fbx',
  xFront,
  xBack,
  zSign = 1,
  positionOverride = null,
  isWalking = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  isJumping = false,
  yawOffset = 0,
  scaleMul = 0.09,
  extraLiftY = 0
}){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  // Include run animation now that it's available
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();

  // Merge animations with namespaced clips for deterministic selection
  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run && run.animations) ? run.animations : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations) ? tright.animations : []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);
  // Build a simple bone-name map for retargeting breathing tracks to the rig
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);
  // Sanitize breathing idle clips: drop root translation and hips/pelvis rotation tracks, and trim leading static T-pose frames
  const sanitizeBreathingClip = useCallback((clip) => {
    try {
      const nameL = String(clip && clip.name || '').toLowerCase();
      const isBreathByName = /breath|breathing/.test(nameL);
      const isBreathByUrl = /breathing\s*idle/i.test(String(baseUrl || '')); // handle space in filename
      const isBreathing = isBreathByName || isBreathByUrl;
      let tracks = (clip && clip.tracks) ? clip.tracks.slice() : [];
      if (isBreathing && tracks && tracks.length) {
        // Drop root position and hips/pelvis rotation to avoid offsets/pops
        tracks = tracks.filter(tr => {
          const n = String(tr && tr.name || '').toLowerCase();
          if (n.endsWith('.position')) return false;
          const isHips = n.includes('hips') || n.includes('pelvis');
          if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
          return true;
        });
        // Retarget node names to the rig's bones (normalize names and strip separators)
        const LEG_IDLE_SCALE = 0.28; // keep ~28% of leg rotation to preserve subtle motion
        tracks = tracks.map(tr => {
          try {
            const nm = String(tr.name || '');
            const dot = nm.indexOf('.');
            const node = dot >= 0 ? nm.substring(0, dot) : nm;
            const prop = dot >= 0 ? nm.substring(dot) : '';
            const key = node.toLowerCase().replace(/[^a-z0-9]/g, '');
            const tgt = rigBoneMap.get(key);
            if (tgt && tgt !== node) {
              const NewTrackClass = tr.constructor;
              const newName = `${tgt}${prop}`;
              let values = tr.values ? tr.values.slice() : tr.values;
              // If this is a leg chain quaternion rotation, attenuate to reduce foot displacement
              const nodeL = node.toLowerCase();
              const isLegChain = (nodeL.includes('thigh') || nodeL.includes('leg') || nodeL.includes('calf') || nodeL.includes('knee') || nodeL.includes('shin'));
              if (isLegChain && prop.toLowerCase() === '.quaternion' && (Array.isArray(values) || (values && values.length))) {
                try {
                  const arr = Array.isArray(values) ? values : Array.from(values);
                  for (let i = 0; i + 3 < arr.length; i += 4) {
                    const q = new THREE.Quaternion(arr[i], arr[i+1], arr[i+2], arr[i+3]).normalize();
                    const qi = new THREE.Quaternion();
                    qi.slerp(q, Math.max(0, Math.min(1, LEG_IDLE_SCALE)));
                    arr[i] = qi.x; arr[i+1] = qi.y; arr[i+2] = qi.z; arr[i+3] = qi.w;
                  }
                  values = (tr.values instanceof Float32Array) ? new Float32Array(arr) : arr;
                } catch {}
              }
              return new NewTrackClass(newName, tr.times.slice(), values);
            }
          } catch {}
          return tr;
        });
      }
      // Trim a small leading segment to skip any bind/T-pose that some FBX exports include
      // Only trim when we believe it's the breathing idle to avoid altering other idles unintentionally
      if (isBreathing && tracks && tracks.length) {
        const startOffset = 0.15; // seconds to skip at clip start
        tracks = tracks.map(tr => {
          const times = tr.times; const values = tr.values;
          if (!times || times.length < 2) return tr;
          let idx = 0;
          while (idx < times.length && times[idx] < startOffset) idx++;
          // If no key at/after offset, just drop the very first keyframe to avoid starting at bind pose
          if (idx <= 0 && times.length > 1) idx = 1;
          if (idx <= 0 || idx >= times.length) return tr;
          const NewTrackClass = tr.constructor;
          const itemSize = (typeof tr.getValueSize === 'function') ? tr.getValueSize() : undefined;
          if (!itemSize || itemSize <= 0) return tr;
          const newTimes = times.slice(idx).map(t => t - times[idx]);
          const startValueIndex = idx * itemSize;
          const newValues = values.slice(startValueIndex);
          try { return new NewTrackClass(tr.name, newTimes, newValues); } catch { return tr; }
        });
      }
      // Recompute duration from tracks' last key time
      let duration = 0;
      try {
        for (const tr of tracks) {
          const tarr = tr.times; if (tarr && tarr.length) duration = Math.max(duration, tarr[tarr.length - 1] || 0);
        }
      } catch {}
      if (!Number.isFinite(duration) || duration <= 0) duration = clip.duration || -1;
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, duration, tracks);
    } catch {
      return new THREE.AnimationClip(`base:${clip && clip.name || 'clip'}`, clip && clip.duration, (clip && clip.tracks) || []);
    }
  }, [baseUrl]);

  // Retarget walking clip's tracks to base rig and drop root position for in-place locomotion (uses rigBoneMap defined above)
  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position'); // drop root translation
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);

  const baseAnims = useMemo(() => baseAnimsRaw.map(c => sanitizeBreathingClip(c)), [baseAnimsRaw, sanitizeBreathingClip]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkAnimsRaw, retargetTracks]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [runAnimsRaw, retargetTracks]);
  // Filter turn clips to be in-place (drop root position and hips/pelvis rotation)
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [jumpAnimsRaw, retargetTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);

  // Ground model and enable shadows
  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) model.position.y += -box.min.y;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    // Apply current UI speed immediately
    try {
      let v = 1.0;
  if (name.startsWith('walk:')) v = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT);
      else if (name.startsWith('run:')) v = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT);
  else if (name.startsWith('jump:')) v = getAnimSpeed('astronaut.jump', 0.65);
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(idle|breath|stand)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);

  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);

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
    if (isJumping && pickJumpName) {
      crossFadeTo(pickJumpName);
  try { actions[pickJumpName].timeScale = getAnimSpeed('astronaut.jump', 0.65); } catch {}
    } else if (isRunning && pickRunName) {
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT); } catch {}
    } else if ((isRunning || isWalking) && pickWalkName) {
      crossFadeTo(pickWalkName);
      try { actions[pickWalkName].timeScale = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    // Apply latest UI speeds every frame so changes take effect immediately
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
        if (nm.startsWith('walk:')) v = getAnimSpeed('astronaut.walk', ASTRONAUT_WALK_DEFAULT);
        else if (nm.startsWith('run:')) v = getAnimSpeed('astronaut.run', ASTRONAUT_RUN_DEFAULT);
  else if (nm.startsWith('jump:')) v = getAnimSpeed('astronaut.jump', 0.65);
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
  });

  // Placement consistent with GLTF avatars
  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  const effYawOffset = (typeof yawOffset === 'number') ? yawOffset : 0;
  // Slight lift while walking/running to keep feet from clipping
  const walkLiftY_A = 0.24;
  const runLiftY_A = 0.34;
  const liftY = isRunning ? runLiftY_A : (isWalking ? walkLiftY_A : 0);
  return (
    <group ref={outerRef} position={[outX, groundY + py + ASTRONAUT_Y_OFFSET, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY + (extraLiftY || 0), 0]}>
        <primitive object={model} dispose={null} />
      </group>
    </group>
  );
}

// FBX-based Robot 4 (animated like Astronaut): Idle/Walk/Run/Turn/Jump with cross-fades
function Robot4FBXOpponent({
  baseUrl = '/models/avatars/robot 4/Breathing Idle (2).fbx',
  walkUrl = '/models/avatars/robot 4/Walking (2).fbx',
  runUrl = '/models/avatars/robot 4/Running (2).fbx',
  turnLeftUrl = '/models/avatars/robot 4/Left Turn (1).fbx',
  turnRightUrl = '/models/avatars/robot 4/Right Turn (1).fbx',
  jumpUrl = '/models/avatars/robot 4/Jump (1).fbx',
  xFront,
  xBack,
  zSign = 1,
  positionOverride = null,
  isWalking = false,
  isRunning = false,
  isTurningLeft = false,
  isTurningRight = false,
  isJumping = false,
  yawOffset = 0,
  scaleMul = 0.09,
  extraLiftY = 0
}){
  const base = useFBX(baseUrl);
  const walk = useFBX(walkUrl);
  const run  = useFBX(runUrl);
  const tleft = useFBX(turnLeftUrl);
  const tright= useFBX(turnRightUrl);
  const jump  = useFBX(jumpUrl);
  const model = useMemo(() => (base ? skeletonClone(base) : null), [base]);
  const outerRef = useRef();
  const innerRef = useRef();

  // Build bone map for retargeting
  const rigBoneMap = useMemo(() => {
    const map = new Map();
    try {
      if (model) {
        model.traverse(o => {
          if (o && (o.isBone || o.type === 'Bone')) {
            const n = String(o.name || '');
            const key = n.toLowerCase().replace(/[^a-z0-9]/g, '');
            map.set(key, n);
          }
        });
      }
    } catch {}
    return map;
  }, [model]);

  const baseAnimsRaw = useMemo(() => ((base && base.animations) ? base.animations : []), [base]);
  const walkAnimsRaw = useMemo(() => ((walk && walk.animations) ? walk.animations : []), [walk]);
  const runAnimsRaw  = useMemo(() => ((run  && run.animations)  ? run.animations  : []), [run]);
  const leftAnimsRaw = useMemo(() => ((tleft && tleft.animations) ? tleft.animations : []), [tleft]);
  const rightAnimsRaw= useMemo(() => ((tright && tright.animations)? tright.animations: []), [tright]);
  const jumpAnimsRaw = useMemo(() => ((jump && jump.animations) ? jump.animations : []), [jump]);

  // Sanitize breathing idle: drop root position and hips/pelvis rotation, trim initial bind-pose frames
  const sanitizeBreathingClip = useCallback((clip) => {
    try {
      const nameL = String(clip && clip.name || '').toLowerCase();
      const isBreathByName = /breath|breathing/.test(nameL);
      const isBreathByUrl = /breathing\s*idle/i.test(String(baseUrl || ''));
      const isBreathing = isBreathByName || isBreathByUrl;
      let tracks = (clip && clip.tracks) ? clip.tracks.slice() : [];
      if (isBreathing && tracks && tracks.length) {
        tracks = tracks.filter(tr => {
          const n = String(tr && tr.name || '').toLowerCase();
          // Drop any root translations
          if (n.endsWith('.position')) return false;
          // Identify node name (before the property suffix)
          const dot = n.indexOf('.');
          const node = dot >= 0 ? n.substring(0, dot) : n;
          // Remove hips/pelvis rotation entirely (keep upper body breathing independent of root)
          const isHips = node.includes('hips') || node.includes('pelvis');
          if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation') || n.endsWith('.scale'))) return false;
          // Pin feet: drop ankle/foot/toe animations; keep thigh/calf/knee so legs can subtly move
          const isAnkleFootToe = node.includes('ankle') || node.includes('foot') || node.includes('toe');
          if (isAnkleFootToe) return false;
          return true;
        });
        const LEG_IDLE_SCALE = 0.28; // subtle leg motion to keep sway without foot drift
        tracks = tracks.map(tr => {
          try {
            const nm = String(tr.name || '');
            const dot = nm.indexOf('.');
            const node = dot >= 0 ? nm.substring(0, dot) : nm;
            const prop = dot >= 0 ? nm.substring(dot) : '';
            const key = node.toLowerCase().replace(/[^a-z0-9]/g, '');
            const tgt = rigBoneMap.get(key);
            if (tgt && tgt !== node) {
              const NewTrackClass = tr.constructor;
              const newName = `${tgt}${prop}`;
              let values = tr.values ? tr.values.slice() : tr.values;
              // Attenuate thigh/calf/knee quaternion rotations to reduce end-effector (foot) movement
              const nodeL = node.toLowerCase();
              const isLegChain = (nodeL.includes('thigh') || nodeL.includes('leg') || nodeL.includes('calf') || nodeL.includes('knee') || nodeL.includes('shin'));
              if (isLegChain && prop.toLowerCase() === '.quaternion' && (Array.isArray(values) || (values && values.length))) {
                try {
                  const arr = Array.isArray(values) ? values : Array.from(values);
                  for (let i = 0; i + 3 < arr.length; i += 4) {
                    const q = new THREE.Quaternion(arr[i], arr[i+1], arr[i+2], arr[i+3]).normalize();
                    const qi = new THREE.Quaternion();
                    qi.slerp(q, Math.max(0, Math.min(1, LEG_IDLE_SCALE)));
                    arr[i] = qi.x; arr[i+1] = qi.y; arr[i+2] = qi.z; arr[i+3] = qi.w;
                  }
                  values = (tr.values instanceof Float32Array) ? new Float32Array(arr) : arr;
                } catch {}
              }
              return new NewTrackClass(newName, tr.times.slice(), values);
            }
          } catch {}
          return tr;
        });
      }
      if (isBreathing && tracks && tracks.length) {
        const startOffset = 0.15;
        tracks = tracks.map(tr => {
          const times = tr.times; const values = tr.values;
          if (!times || times.length < 2) return tr;
          let idx = 0;
          while (idx < times.length && times[idx] < startOffset) idx++;
          if (idx <= 0 && times.length > 1) idx = 1;
          if (idx <= 0 || idx >= times.length) return tr;
          const NewTrackClass = tr.constructor;
          const itemSize = (typeof tr.getValueSize === 'function') ? tr.getValueSize() : undefined;
          if (!itemSize || itemSize <= 0) return tr;
          const newTimes = times.slice(idx).map(t => t - times[idx]);
          const startValueIndex = idx * itemSize;
          const newValues = values.slice(startValueIndex);
          try { return new NewTrackClass(tr.name, newTimes, newValues); } catch { return tr; }
        });
      }
      let duration = 0;
      try { for (const tr of tracks) { const tarr = tr.times; if (tarr && tarr.length) duration = Math.max(duration, tarr[tarr.length - 1] || 0); } } catch {}
      if (!Number.isFinite(duration) || duration <= 0) duration = clip.duration || -1;
      return new THREE.AnimationClip(`base:${clip.name || 'clip'}`, duration, tracks);
    } catch {
      return new THREE.AnimationClip(`base:${clip && clip.name || 'clip'}`, clip && clip.duration, (clip && clip.tracks) || []);
    }
  }, [baseUrl, rigBoneMap]);

  const retargetTracks = useCallback((tracks) => {
    if (!tracks) return tracks;
    return tracks
      .filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        return !n.endsWith('.position');
      })
      .map(tr => {
        try {
          const nm = String(tr.name||''); const i = nm.indexOf('.');
          const node = i>=0? nm.substring(0,i): nm; const prop = i>=0? nm.substring(i): '';
          const key = node.toLowerCase().replace(/[^a-z0-9]/g,'');
          const tgt = rigBoneMap.get(key);
          if (tgt && tgt !== node) { const C = tr.constructor; return new C(`${tgt}${prop}`, tr.times.slice(), tr.values.slice()); }
        } catch {}
        return tr;
      });
  }, [rigBoneMap]);

  const baseAnims = useMemo(() => baseAnimsRaw.map(c => sanitizeBreathingClip(c)), [baseAnimsRaw, sanitizeBreathingClip]);
  const walkAnims = useMemo(() => walkAnimsRaw.map(c => new THREE.AnimationClip(`walk:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [walkAnimsRaw, retargetTracks]);
  const runAnims  = useMemo(() => runAnimsRaw.map(c => new THREE.AnimationClip(`run:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks))), [runAnimsRaw, retargetTracks]);
  const filterTurnTracks = useCallback((tracks) => {
    try {
      return tracks.filter(tr => {
        const n = String(tr && tr.name || '').toLowerCase();
        if (n.endsWith('.position')) return false;
        const isHips = n.includes('hips') || n.includes('pelvis');
        if (isHips && (n.endsWith('.quaternion') || n.endsWith('.rotation'))) return false;
        return true;
      });
    } catch {
      return tracks;
    }
  }, []);
  const leftAnims = useMemo(() => leftAnimsRaw.map(c => new THREE.AnimationClip(
    `left:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [leftAnimsRaw, filterTurnTracks]);
  const rightAnims= useMemo(() => rightAnimsRaw.map(c => new THREE.AnimationClip(
    `right:${c.name || 'clip'}`, c.duration, filterTurnTracks(c.tracks)
  )), [rightAnimsRaw, filterTurnTracks]);
  const jumpAnims = useMemo(() => jumpAnimsRaw.map(c => new THREE.AnimationClip(
    `jump:${c.name || 'clip'}`, c.duration, retargetTracks(c.tracks)
  )), [jumpAnimsRaw, retargetTracks]);
  const mergedAnims = useMemo(() => ([...baseAnims, ...walkAnims, ...runAnims, ...leftAnims, ...rightAnims, ...jumpAnims]), [baseAnims, walkAnims, runAnims, leftAnims, rightAnims, jumpAnims]);

  const { actions, mixer } = useAnimations(mergedAnims, model);
  const currentActionRef = useRef(null);
  const startedRef = useRef(false);

  useLayoutEffect(() => {
    if (!model) return;
    try {
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) model.position.y += -box.min.y;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    } catch {}
  }, [model]);

  const crossFadeTo = (name) => {
    if (!actions) return;
    const next = actions[name];
    if (!next) return;
    const prev = currentActionRef.current;
    if (prev && prev !== next) prev.fadeOut(0.12);
    const isJump = name.startsWith('jump:');
    next.reset().setLoop(isJump ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).fadeIn(0.12).play();
    if (isJump) { try { next.clampWhenFinished = true; } catch {} }
    try {
      let v = 1.0;
      if (name.startsWith('walk:')) v = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT);
      else if (name.startsWith('run:')) v = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT);
      else if (name.startsWith('jump:')) v = getAnimSpeed('robot.jump', 0.65);
      else if (name.startsWith('base:')) v = getAnimSpeed('robot.idle', 0.25);
      next.timeScale = v;
      if (typeof next.setEffectiveTimeScale === 'function') next.setEffectiveTimeScale(v);
    } catch {}
    currentActionRef.current = next;
  };

  const pickIdleName = useMemo(() => {
    if (!baseAnimsRaw || baseAnimsRaw.length === 0) return null;
    const byName = baseAnimsRaw.find(c => /(^|\b)(idle|breath|stand)(\b|$)/i.test(c.name));
    const chosen = byName || baseAnimsRaw.find(c => !/(walk|walking|run|jog|move|strafe)/i.test(c.name));
    return chosen ? `base:${chosen.name || 'clip'}` : null;
  }, [baseAnimsRaw]);

  const pickWalkName = useMemo(() => {
    if (!walkAnimsRaw || walkAnimsRaw.length === 0) return null;
    const byName = walkAnimsRaw.find(c => /walk|walking/i.test(c.name));
    const chosen = byName || walkAnimsRaw[0];
    return chosen ? `walk:${chosen.name || 'clip'}` : null;
  }, [walkAnimsRaw]);

  const pickRunName = useMemo(() => {
    if (!runAnimsRaw || runAnimsRaw.length === 0) return null;
    const byName = runAnimsRaw.find(c => /run|running/i.test(c.name));
    const chosen = byName || runAnimsRaw[0];
    return chosen ? `run:${chosen.name || 'clip'}` : null;
  }, [runAnimsRaw]);

  const pickLeftName = useMemo(() => {
    if (!leftAnimsRaw || leftAnimsRaw.length === 0) return null;
    const chosen = leftAnimsRaw[0];
    return chosen ? `left:${chosen.name || 'clip'}` : null;
  }, [leftAnimsRaw]);
  const pickRightName = useMemo(() => {
    if (!rightAnimsRaw || rightAnimsRaw.length === 0) return null;
    const chosen = rightAnimsRaw[0];
    return chosen ? `right:${chosen.name || 'clip'}` : null;
  }, [rightAnimsRaw]);
  const pickJumpName = useMemo(() => {
    if (!jumpAnimsRaw || jumpAnimsRaw.length === 0) return null;
    const byName = jumpAnimsRaw.find(c => /jump|hop/i.test(c.name));
    const chosen = byName || jumpAnimsRaw[0];
    return chosen ? `jump:${chosen.name || 'clip'}` : null;
  }, [jumpAnimsRaw]);

  useEffect(() => {
    if (!actions) return;
    if (!startedRef.current) {
      if (pickIdleName && actions[pickIdleName]) {
        const idle = actions[pickIdleName];
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        idle.enabled = true;
        idle.fadeIn(0.0);
        idle.timeScale = getAnimSpeed('robot.idle', 0.25);
        if (typeof idle.setEffectiveTimeScale === 'function') idle.setEffectiveTimeScale(getAnimSpeed('robot.idle', 0.25));
        currentActionRef.current = idle;
      }
      startedRef.current = true;
      return;
    }
    if (isJumping && pickJumpName) {
      crossFadeTo(pickJumpName);
      try { actions[pickJumpName].timeScale = getAnimSpeed('robot.jump', 0.65); } catch {}
    } else if (isRunning && pickRunName) {
      crossFadeTo(pickRunName);
      try { actions[pickRunName].timeScale = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT); } catch {}
    } else if ((isRunning || isWalking) && pickWalkName) {
      crossFadeTo(pickWalkName);
      try { actions[pickWalkName].timeScale = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT); } catch {}
    } else if (!isWalking && !isRunning && isTurningLeft && pickLeftName) {
      crossFadeTo(pickLeftName);
      try { actions[pickLeftName].timeScale = 1.0; } catch {}
    } else if (!isWalking && !isRunning && isTurningRight && pickRightName) {
      crossFadeTo(pickRightName);
      try { actions[pickRightName].timeScale = 1.0; } catch {}
    } else if (pickIdleName) {
      crossFadeTo(pickIdleName);
    }
  }, [isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, pickIdleName, pickWalkName, pickRunName, pickLeftName, pickRightName, pickJumpName, actions]);

  useFrame((_, dt) => {
    if (mixer && dt) mixer.update(dt);
    try {
      const cur = currentActionRef.current;
      if (cur) {
        const clip = (typeof cur.getClip === 'function') ? cur.getClip() : (cur._clip || null);
        const nm = String(clip && clip.name || '');
        let v = null;
        if (nm.startsWith('walk:')) v = getAnimSpeed('robot.walk', ASTRONAUT_WALK_DEFAULT);
        else if (nm.startsWith('run:')) v = getAnimSpeed('robot.run', ASTRONAUT_RUN_DEFAULT);
        else if (nm.startsWith('jump:')) v = getAnimSpeed('robot.jump', 0.65);
        else if (nm.startsWith('base:')) v = getAnimSpeed('robot.idle', 0.25);
        if (v != null) {
          cur.timeScale = v;
          if (typeof cur.setEffectiveTimeScale === 'function') cur.setEffectiveTimeScale(v);
        }
      }
    } catch {}
  });

  const fh = ROWS * (CELL + GAP) - GAP + 0.6; const groundY = -fh / 2 - GROUND_CLEAR; const py = AVATAR_BAKED_POS[1];
  const px = AVATAR_BAKED_POS[0] + ((zSign < 0) ? (xFront ?? AVATAR_X_FRONT) : (xBack ?? AVATAR_X_BACK));
  const pz = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  const useOverride = Array.isArray(positionOverride);
  const outX = useOverride ? (positionOverride[0] || 0) : px;
  const outZ = useOverride ? (positionOverride[2] || 0) : pz;

  if (!model) return null;
  const effYawOffset = (typeof yawOffset === 'number') ? yawOffset : 0;
  const walkLiftY = 0.24;
  const runLiftY = 0.34;
  const liftY = isRunning ? runLiftY : (isWalking ? walkLiftY : 0);
  // Slight Y offset similar to astronaut to avoid any initial floating
  const ROBOT4_Y_OFFSET = -0.5;
  return (
    <group ref={outerRef} position={[outX, groundY + py + ROBOT4_Y_OFFSET, outZ]} rotation={[0, 0, 0]} scale={[scaleMul, scaleMul, scaleMul]} frustumCulled={false}>
      <group ref={innerRef} rotation={[0, effYawOffset, 0]} position={[0, liftY + (extraLiftY || 0), 0]}>
        <primitive object={model} dispose={null} />
      </group>
    </group>
  );
}

function Piece({ color = '#e63946', c, r, flip180 = false }) {
  const ref = useRef();
  const x = (c - (COLS - 1) / 2) * (CELL + GAP);
  // Map logical board row (0=top, ROWS-1=bottom) to visual row index (0=bottom)
  const rv = (ROWS - 1 - r);
  // Direction-aware positions so pieces always fall from the top of the screen
  const dirY = flip180 ? -1 : 1;
  const targetY = dirY * ((rv - (ROWS - 1) / 2) * (CELL + GAP));
  const startY = dirY * (ROWS * (CELL + GAP) + 2);
  const vy = useRef(0);
  // Set initial position once on mount; avoid controlling position via props so animation isn't reset every render
  const didInit = useRef(false);
  useLayoutEffect(() => {
    if (ref.current && !didInit.current) {
      ref.current.position.set(x, startY, -0.1);
      didInit.current = true;
    }
  }, [x, startY]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    // Move toward target from above, respecting orientation
    if ((dirY > 0 && ref.current.position.y > targetY) || (dirY < 0 && ref.current.position.y < targetY)) {
      vy.current = Math.min(vy.current + 20 * dt, 12);
      if (dirY > 0) {
        ref.current.position.y = Math.max(targetY, ref.current.position.y - vy.current * dt);
      } else {
        ref.current.position.y = Math.min(targetY, ref.current.position.y + vy.current * dt);
      }
    }
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.46, 0.46, 0.18, 40]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.45} emissive={color} emissiveIntensity={0.22} />
    </mesh>
  );
}

// Keyboard movement wrapper for the local player's avatar
function PlayerMover({ enabled = false, maxRadius = 110, speed = 16, baseOffset = [0,0], onPositionChange, moveTarget = null, onArrive, turnSpeed = 2.4, initialYaw = 0, invertForward = false, clickYawOffset = 0, obstacles = [], collisionRadius = 2.2, labelName = null, labelSide = null, children }) {
  // Physics constants for jump feel
  const GRAVITY = -1200.0;             // ultra-strong gravity for extremely fast fall
  const TARGET_JUMP_HEIGHT = 80.0;     // desired apex height in world units (huge jump)
  const ref = useRef();
  const pressed = useRef({});
  const justPressed = useRef({});
  const lastSent = useRef({ x: Infinity, z: Infinity, yaw: 0, t: 0, lift: 0, isJumping: false });
  const targetRef = useRef(null);
  const yawRef = useRef(0);
  const velRef = useRef({ x: 0, z: 0 });
  const childRef = useRef();
  const dbgSize = useRef(new THREE.Vector3(0,0,0));
  const dbgCenter = useRef(new THREE.Vector3(0,0,0));
  const prevLocalPos = useRef(new THREE.Vector3(0,0,0));
  // Jump physics
  const [jumpY, setJumpY] = useState(0);
  const jumpVyRef = useRef(0);
  const [isJumping, setIsJumping] = useState(false);
  // Platform support: allow landing on the tabletop and staying there
  const fhForGround = ROWS * (CELL + GAP) - GAP + 0.6;
  const localGroundY = -fhForGround / 2 - GROUND_CLEAR;
  const TABLE_TOP_OFFSET = 37.0; // standing ~37 units above tabletop
  const TABLE_TOP_LIFT = -localGroundY + TABLE_TOP_OFFSET; // lift needed (relative to ground) to stand on tabletop
  const [platformLift, setPlatformLift] = useState(0); // 0=ground, TABLE_TOP_LIFT=on table
  const [onTable, setOnTable] = useState(false);
  // Live HUD text above head (updated ~10Hz to avoid excessive re-renders)
  const [hudText, setHudText] = useState('');
  const [isWalking, setIsWalking] = useState(false);
  const hudTick = useRef(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isTurningLeft, setIsTurningLeft] = useState(false);
  const [isTurningRight, setIsTurningRight] = useState(false);
  useEffect(() => { targetRef.current = moveTarget; }, [moveTarget]);
  useLayoutEffect(() => { yawRef.current = Number(initialYaw)||0; if(ref.current){ ref.current.rotation.y = yawRef.current; } }, [initialYaw]);
  // Compute debug bounds for child once (approx)
  useEffect(() => {
    if (!childRef.current || !ref.current) return;
    try {
      const box = new THREE.Box3();
      childRef.current.traverse((o) => {
        if (o && o.isMesh && o.geometry) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox?.clone();
          if (bb) {
            bb.applyMatrix4(o.matrixWorld);
            box.union(bb);
          }
        }
      });
      if (!box.isEmpty()) {
        const size = new THREE.Vector3(); box.getSize(size);
        const centerW = new THREE.Vector3(); box.getCenter(centerW);
        const centerL = centerW.clone();
        ref.current.worldToLocal(centerL);
        dbgSize.current.copy(size);
        dbgCenter.current.copy(centerL);
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (!enabled) return; // no listeners if not enabled
    const down = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      const k = e.key;
      const code = e.code;
      const isSpace = (k === ' ' || k === 'Spacebar' || k === 'Space' || code === 'Space' || code === 'SpaceBar');
      const keyToken = isSpace ? 'Space' : k;
    if (keyToken === 'ArrowUp' || keyToken === 'ArrowDown' || keyToken === 'ArrowLeft' || keyToken === 'ArrowRight' ||
      keyToken === 'w' || keyToken === 'a' || keyToken === 's' || keyToken === 'd' ||
      keyToken === 'W' || keyToken === 'A' || keyToken === 'S' || keyToken === 'D' ||
      keyToken === 'r' || keyToken === 'R' || keyToken === 'Space') {
        if (!pressed.current[keyToken]) { justPressed.current[keyToken] = true; }
        pressed.current[keyToken] = true;
        try { e.preventDefault(); } catch {}
      }
    };
    const up = (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
      const k = e.key;
      const code = e.code;
      const isSpace = (k === ' ' || k === 'Spacebar' || k === 'Space' || code === 'Space' || code === 'SpaceBar');
      const keyToken = isSpace ? 'Space' : k;
      if (pressed.current[keyToken]) delete pressed.current[keyToken];
      try { e.preventDefault(); } catch {}
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [enabled]);

  useFrame((_, dt) => {
    if (!enabled || !ref.current) return;
    const p = pressed.current;
    const jp = justPressed.current;
  // Tank controls with incremental turns on key tap
    let turning = 0, moving = 0;
  const leftHeld = !!(p['ArrowLeft'] || p['a'] || p['A']);
  const rightHeld = !!(p['ArrowRight'] || p['d'] || p['D']);
  if (leftHeld) turning += 1;   // hold = continuous
  if (rightHeld) turning -= 1;  // hold = continuous
    if (p['ArrowUp'] || p['w'] || p['W']) moving += 1;      // forward
    if (p['ArrowDown'] || p['s'] || p['S']) moving -= 1;    // backward
    if (invertForward) moving = -moving; // flip forward/back mapping for near side if needed
  // Running: Up + 'R' key (independent of invertForward)
  const forwardKey = !!(p['ArrowUp'] || p['w'] || p['W']);
  const rPressed = !!(p['r'] || p['R']);
  const runningNow = forwardKey && rPressed; // requires forward key held
  if (runningNow !== isRunning) setIsRunning(runningNow);

  const keysActive = (turning !== 0) || (moving !== 0) || Object.keys(jp).length > 0;

    // Apply incremental turn on tap (discrete nudge), plus continuous when held
  const turnStep = 0.12; // ~6.9° per tap
    if (jp['ArrowLeft'] || jp['a'] || jp['A']) { yawRef.current += turnStep; }
    if (jp['ArrowRight'] || jp['d'] || jp['D']) { yawRef.current -= turnStep; }
    // Clear justPressed after consuming
    justPressed.current = {};
    // Continuous turn while held
    if (turning !== 0) {
      yawRef.current += turning * (turnSpeed || 0) * dt;
    }
    // Update turning state flags for animations (only when idle)
    setIsTurningLeft(leftHeld && moving === 0);
    setIsTurningRight(rightHeld && moving === 0);
    const effYaw = yawRef.current || 0;
    ref.current.rotation.y = effYaw;

    // Jump trigger on Space press (only if grounded / not already jumping)
  const spaceTapped = !!(jp['Space']);
    const grounded = (jumpY <= 0.0001);
    if (spaceTapped && grounded && !isJumping) {
      // Set initial upward velocity based on desired apex height: vy = sqrt(2 * |g| * H)
      const vy0 = Math.sqrt(2 * Math.abs(GRAVITY) * TARGET_JUMP_HEIGHT);
      jumpVyRef.current = vy0;
      setIsJumping(true);
    }

  // Apply forward/back movement using facing direction
    if (moving !== 0) {
      const dir = new THREE.Vector3(0,0,-1);
      dir.applyAxisAngle(new THREE.Vector3(0,1,0), effYaw);
      dir.y = 0; dir.normalize();
  const speedMul = (runningNow ? 2.0 : 1.0);
      const step = speed * speedMul * dt * moving;
      let nx = ref.current.position.x + dir.x * step;
      let nz = ref.current.position.z + dir.z * step;
      // remember velocity for optional facing logic (disabled during keys)
      velRef.current.x = dir.x * moving;
      velRef.current.z = dir.z * moving;
      // Collision against rectangular obstacles (world coords)
      const wxTry = nx + (baseOffset?.[0] || 0);
      const wzTry = nz + (baseOffset?.[1] || 0);
      const intersectsAny = (xw, zw) => {
        for (const r of obstacles || []) {
          if (!r) continue;
          const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
          if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
            // Expand rect by radius
            if (xw >= (minX - collisionRadius) && xw <= (maxX + collisionRadius) &&
                zw >= (minZ - collisionRadius) && zw <= (maxZ + collisionRadius)) {
              return true;
            }
          }
        }
        return false;
      };
      // Allow passing through table rect when sufficiently airborne or already on table
      const allowRectPass = onTable || ((platformLift + jumpY) >= (TABLE_TOP_LIFT * 0.6));
      const shouldBlock = (xw, zw) => {
        const hit = intersectsAny(xw, zw);
        return hit && !allowRectPass;
      };
      if (shouldBlock(wxTry, wzTry)) {
        // Try slide on X only
        const wxX = (ref.current.position.x) + (baseOffset?.[0] || 0);
        const wzX = wzTry;
        if (!shouldBlock(wxX, wzX)) {
          nz = ref.current.position.z + dir.z * step;
        } else {
          // Try slide on Z only
          const wxZ = wxTry;
          const wzZ = (ref.current.position.z) + (baseOffset?.[1] || 0);
          if (!shouldBlock(wxZ, wzZ)) {
            nx = ref.current.position.x + dir.x * step;
          } else {
            // Block movement
            nx = ref.current.position.x;
            nz = ref.current.position.z;
          }
        }
      }
      // Clamp based on world position = parent + baseOffset
      const wx = nx + (baseOffset?.[0] || 0);
      const wz = nz + (baseOffset?.[1] || 0);
      const r = Math.hypot(wx, wz);
      if (r <= maxRadius) {
        ref.current.position.x = nx;
        ref.current.position.z = nz;
      } else {
        // project onto boundary, then subtract baseOffset to get parent pos
        const ang = Math.atan2(wz, wx);
        ref.current.position.x = Math.cos(ang) * maxRadius - (baseOffset?.[0] || 0);
        ref.current.position.z = Math.sin(ang) * maxRadius - (baseOffset?.[1] || 0);
      }
    // mark walking when keys cause translation
    setIsWalking(true);
  } else if (targetRef.current) {
      // Click-to-move: ease toward target when no key input
      const tx = Number(targetRef.current.x);
      const tz = Number(targetRef.current.z);
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        const wx = (baseOffset?.[0] || 0) + ref.current.position.x;
        const wz = (baseOffset?.[1] || 0) + ref.current.position.z;
        let vx = tx - wx;
        let vz = tz - wz;
        let dist = Math.hypot(vx, vz);
        const arriveEps = 0.25;
        if (dist <= arriveEps) {
          // Snap to target and notify arrival
          const localX = tx - (baseOffset?.[0] || 0);
          const localZ = tz - (baseOffset?.[1] || 0);
          // Respect radius constraint when snapping
          const rr = Math.hypot(tx, tz);
          if (rr <= maxRadius) {
            ref.current.position.x = localX;
            ref.current.position.z = localZ;
          } else {
            const ang = Math.atan2(tz, tx);
            ref.current.position.x = Math.cos(ang) * maxRadius - (baseOffset?.[0] || 0);
            ref.current.position.z = Math.sin(ang) * maxRadius - (baseOffset?.[1] || 0);
          }
          // On arrival: face a canonical board-facing yaw (0 radians)
          yawRef.current = 0;
          ref.current.rotation.y = 0;
          velRef.current.x = 0;
          velRef.current.z = 0;
          // Immediately publish final pose so remote opponent sees the correct facing
          try {
            const wxFinal = (baseOffset?.[0] || 0) + ref.current.position.x;
            const wzFinal = (baseOffset?.[1] || 0) + ref.current.position.z;
            if (typeof onPositionChange === 'function') onPositionChange(wxFinal, wzFinal, yawRef.current || 0);
          } catch {}
          if (typeof onArrive === 'function') {
            try { onArrive(); } catch {}
          }
          // Clear target once we reached it
          targetRef.current = null;
          setIsWalking(false);
        } else {
          // Move toward target with same speed as keys
          vx /= (dist || 1);
          vz /= (dist || 1);
          const step = speed * dt;
          let nx = ref.current.position.x + vx * step;
          let nz = ref.current.position.z + vz * step;
          // remember velocity for facing
          velRef.current.x = vx;
          velRef.current.z = vz;
          // Collision against rectangular obstacles (world coords)
          const wxTry = nx + (baseOffset?.[0] || 0);
          const wzTry = nz + (baseOffset?.[1] || 0);
          const intersectsAny = (xw, zw) => {
            for (const r of obstacles || []) {
              if (!r) continue;
              const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
              if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
                if (xw >= (minX - collisionRadius) && xw <= (maxX + collisionRadius) &&
                    zw >= (minZ - collisionRadius) && zw <= (maxZ + collisionRadius)) {
                  return true;
                }
              }
            }
            return false;
          };
          const allowRectPass = onTable || ((platformLift + jumpY) >= (TABLE_TOP_LIFT * 0.6));
          const shouldBlock = (xw, zw) => {
            const hit = intersectsAny(xw, zw);
            return hit && !allowRectPass;
          };
          if (shouldBlock(wxTry, wzTry)) {
            // Try slide toward axis with less penetration using small split
            const tryX = ref.current.position.x + vx * step;
            const tryZ = ref.current.position.z + vz * step;
            const wxX = (ref.current.position.x) + (baseOffset?.[0] || 0);
            const wzX = (ref.current.position.z + vz * step) + (baseOffset?.[1] || 0);
            const wxZ = (ref.current.position.x + vx * step) + (baseOffset?.[0] || 0);
            const wzZ = (ref.current.position.z) + (baseOffset?.[1] || 0);
            if (!shouldBlock(wxX, wzX)) {
              nx = ref.current.position.x;
              nz = ref.current.position.z + vz * step;
            } else if (!shouldBlock(wxZ, wzZ)) {
              nx = ref.current.position.x + vx * step;
              nz = ref.current.position.z;
            } else {
              // Block movement this frame
              nx = ref.current.position.x;
              nz = ref.current.position.z;
            }
          }
          // Clamp to radius from world origin considering baseOffset
          const nwx = nx + (baseOffset?.[0] || 0);
          const nwz = nz + (baseOffset?.[1] || 0);
          const r = Math.hypot(nwx, nwz);
          if (r <= maxRadius) {
            ref.current.position.x = nx;
            ref.current.position.z = nz;
          } else {
            const ang = Math.atan2(nwz, nwx);
            ref.current.position.x = Math.cos(ang) * maxRadius - (baseOffset?.[0] || 0);
            ref.current.position.z = Math.sin(ang) * maxRadius - (baseOffset?.[1] || 0);
          }
          setIsWalking(true);
        }
      }
    } else {
      // No keys and no click target: clear residual velocity so we don't auto-face old movement
      velRef.current.x = 0;
      velRef.current.z = 0;
      // defer isWalking decision to displacement check below
    }

    // Update jump physics and tabletop interactions
    // World position for tabletop checks
    const wxNow = (baseOffset?.[0] || 0) + (ref.current?.position.x || 0);
    const wzNow = (baseOffset?.[1] || 0) + (ref.current?.position.z || 0);
    // Consider tabletop "overlap" if the avatar's collision disk overlaps the tabletop rect
    const overlapsTable = (() => {
      for (const r of obstacles || []) {
        if (!r) continue;
        const minX = Number(r.minX), maxX = Number(r.maxX), minZ = Number(r.minZ), maxZ = Number(r.maxZ);
        if ([minX, maxX, minZ, maxZ].every(Number.isFinite)) {
          if (wxNow >= (minX - collisionRadius) && wxNow <= (maxX + collisionRadius) &&
              wzNow >= (minZ - collisionRadius) && wzNow <= (maxZ + collisionRadius)) {
            return true;
          }
        }
      }
      return false;
    })();

    if (isJumping || jumpY > 0.0001) {
      const g = GRAVITY; // use shared gravity constant
      let vy = jumpVyRef.current + g * dt;
      let y = jumpY + vy * dt;
      // Absolute height above ground plane
      let absY = platformLift + y;
      // Handle landing on tabletop if descending and near/below plane (with snap band to be forgiving)
  const TABLE_SNAP_BAND = 8.0; // allow fast descents to snap reliably
      if (!onTable && overlapsTable && vy < 0 && absY <= (TABLE_TOP_LIFT + TABLE_SNAP_BAND)) {
        // Snap to tabletop
        y = 0; vy = 0; absY = TABLE_TOP_LIFT; setPlatformLift(TABLE_TOP_LIFT); setOnTable(true); setIsJumping(false);
      } else if (onTable) {
        if (!overlapsTable) {
          // Stepping/falling off the table: convert platform height into jump height to fall down
          const carry = platformLift + y;
          setPlatformLift(0); setOnTable(false);
          y = Math.max(0, carry); // start falling from current absolute height
          // keep vy as-is; if upward it's fine, if downward, continue falling
        } else if (vy < 0 && y <= 0) {
          // Land back on the tabletop
          y = 0; vy = 0; setIsJumping(false);
        }
      } else if (!onTable && absY <= 0) {
        // Land on ground
        y = 0; vy = 0; setIsJumping(false);
      }
      // Commit
      jumpVyRef.current = vy;
      if (Math.abs(y - jumpY) > 0.00001) setJumpY(y);
    }
    // If standing on the table and walking off its core without jumping, start a fall
    if (onTable && !overlapsTable && !isJumping) {
      const carry = platformLift + 0;
      setPlatformLift(0); setOnTable(false);
      // Begin falling from current absolute height
      setIsJumping(true);
      jumpVyRef.current = 0;
      if (carry > 0) setJumpY(carry);
    }
    // Smoothly rotate toward click-move direction only when keys are not active
    if (ref.current && !keysActive && !!targetRef.current) {
      const vx = velRef.current.x;
      const vz = velRef.current.z;
      const mag = Math.hypot(vx, vz);
      const movingVec = mag > 0.001;
      if (movingVec) {
        let cur = yawRef.current || 0;
        // Align with arrow-move mapping: dir = R_y(yaw) * (0,0,-1)
        // So yaw should be atan2(vx, vz) + PI for a world direction (vx,vz)
        const desired = Math.atan2(vx, vz) + Math.PI + (clickYawOffset || 0);
        let diff = ((desired - cur + Math.PI) % (2 * Math.PI)) - Math.PI;
        cur += Math.sign(diff) * Math.min(Math.abs(diff), ((turnSpeed || 0) * dt));
        yawRef.current = cur;
        ref.current.rotation.y = cur;
      }
    }
    // Publish world position and yaw (baseOffset + local). Also publish when yaw changes while standing still.
    if (ref.current) {
      // Displacement-based walking detection (covers all motion sources)
      const cx = ref.current.position.x;
      const cz = ref.current.position.z;
      const dxLoc = cx - prevLocalPos.current.x;
      const dzLoc = cz - prevLocalPos.current.z;
      const disp = Math.hypot(dxLoc, dzLoc);
      prevLocalPos.current.set(cx, 0, cz);
      // Toggle walk if moved more than a tiny epsilon this frame
      const movingNow = disp > 0.0002;
      if (!targetRef.current && moving === 0) {
        // when neither keys nor click-to-move is active, use displacement to decide
        if (movingNow !== isWalking) setIsWalking(movingNow);
      }
  const wx = (baseOffset?.[0] || 0) + ref.current.position.x;
  const wz = (baseOffset?.[1] || 0) + ref.current.position.z;
  const wyaw = yawRef.current || 0;
  // Publish local avatar pose globally for follow camera (mirrors remote pattern)
  try { window.__CF_LOCAL_AVATAR__ = { x: wx, z: wz, yaw: wyaw, isRunning: runningNow, isJumping: !!isJumping, lift: (platformLift + jumpY) }; } catch {}
      const t = performance.now();
      const dxs = Math.abs(wx - lastSent.current.x);
      const dzs = Math.abs(wz - lastSent.current.z);
      // shortest angular difference in radians
      const yawDiff = (((wyaw - (lastSent.current.yaw||0)) + Math.PI) % (2*Math.PI)) - Math.PI;
      const yawChanged = Math.abs(yawDiff) > 0.02; // ~1.1°
      // Also send when turning-in-place so spectators see live yaw; align throttle with server (~35ms)
      const turningNow = !!(pressed.current['ArrowLeft'] || pressed.current['a'] || pressed.current['A'] || pressed.current['ArrowRight'] || pressed.current['d'] || pressed.current['D']);
      const liftNow = (platformLift + jumpY);
      const liftDiff = Math.abs(liftNow - (lastSent.current.lift || 0));
      const jumpChanged = (!!isJumping !== !!lastSent.current.isJumping);
      if (typeof onPositionChange === 'function' && (((dxs + dzs) > 0.1) || yawChanged || turningNow || liftDiff > 0.5 || jumpChanged) && (t - lastSent.current.t) > 35) {
        lastSent.current = { x: wx, z: wz, yaw: wyaw, t, lift: liftNow, isJumping: !!isJumping };
        onPositionChange(wx, wz, wyaw);
      }
      // Update HUD every ~100ms
      hudTick.current += dt;
      if (hudTick.current >= 0.1) {
        hudTick.current = 0;
        const yawDeg = ((yawRef.current * 180 / Math.PI) % 360 + 360) % 360;
        setHudText(`x: ${wx.toFixed(1)}  z: ${wz.toFixed(1)}  yaw: ${yawDeg.toFixed(0)}°`);
      }
    }
  });

  // Inject motion props into the first child (avatar), preserve other children
  const childWithMotion = useMemo(() => {
    const arr = React.Children.toArray(children);
    if (arr.length > 0 && React.isValidElement(arr[0])) {
      try { arr[0] = React.cloneElement(arr[0], { isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, extraLiftY: (platformLift + jumpY) }); } catch {}
    }
    return arr;
  }, [children, isWalking, isRunning, isTurningLeft, isTurningRight, isJumping, jumpY, platformLift]);

  return (
    <group position={[ (baseOffset?.[0]||0), 0, (baseOffset?.[1]||0) ]}>
      <group ref={ref}>
        <group ref={childRef}>{childWithMotion}</group>
        {/* Side + Username label higher above head */}
        {(labelName || labelSide) && (
          <Billboard follow={true} position={[0, 8.5, 0]}>
            <group>
              {labelSide && (
                <Text fontSize={1.6} color={'#94a3b8'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                  {labelSide}
                </Text>
              )}
              {labelName && (
                <Text position={[0,-1.6,0]} fontSize={2.2} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                  {labelName}
                </Text>
              )}
            </group>
          </Billboard>
        )}
      {/* Live HUD label above head */}
      <Billboard follow={true} position={[0, 6, 0]}>
        <Text fontSize={1.8} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
          {hudText}
        </Text>
      </Billboard>
      </group>
    </group>
  );
}

export default function ConnectFour3DView({ board, lastMove, colors, onSelectColumn, flip180 = false, myCharacterId = 'astronaut', oppCharacterId = 'alien', onAvatarMove, myName = 'You', oppName = 'Opponent' }) {
  // Use baked constants for avatar X offsets
  const xFront = AVATAR_X_FRONT;
  const xBack = AVATAR_X_BACK;

  // Define a simple rectangular obstacle for the wooden table top to prevent walking through it
  const tableRect = useMemo(() => {
    // Prefer the actual FBX footprint if available (published by WoodenTable loader)
    try {
      const r = (typeof window !== 'undefined') ? window.__CF_TABLE_RECT__ : null;
      if (r && Number.isFinite(r.minX) && Number.isFinite(r.maxX) && Number.isFinite(r.minZ) && Number.isFinite(r.maxZ)) {
        return { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      }
    } catch {}
    // Fallback to baked dimensions
    const fw = COLS * (CELL + GAP) - GAP + 0.6;
    const fh = ROWS * (CELL + GAP) - GAP + 0.6;
    const topW = Math.max(fw + 4.0, 12.0);
    const topD = Math.max(fh + 6.0, 16.0);
    return { minX: -topW / 2, maxX: topW / 2, minZ: -topD / 2, maxZ: topD / 2 };
  }, []);

  // Baked-in transform (scale override) + dynamic facing toward camera
  const effScaleMulOverride = AVATAR_BAKED_SCALE_MUL;
  // Screen size first (used for camera defaults)
  const isNarrow = (()=>{ try{ return typeof window!== 'undefined' && window.matchMedia('(max-width: 640px)').matches; }catch{return false;} })();
  // Camera side: Player 1 sees from +Z (front), Player 2 from -Z (back)
  // Start a bit farther so it loads more zoomed out
  const camPosFront = isNarrow ? [0, 13.0, 18.0] : [0, 10.5, 14.5];
  const camPosBack  = isNarrow ? [0, 13.0,-18.0] : [0, 10.5,-14.5];
  const camPos  = flip180 ? camPosBack : camPosFront;
  const camFov  = isNarrow ? 54 : 40;
  // UI toggles
  const [showSelf, setShowSelf] = useState(false);
  const [moveEnabled, setMoveEnabled] = useState(true);
  const [clickMove, setClickMove] = useState(false);
  const [fullCamera, setFullCamera] = useState(false);
  const [followCam, setFollowCam] = useState(false);
  const [followZoom, setFollowZoom] = useState(38); // zoomed-out follow distance
  const [followYawOffset, setFollowYawOffset] = useState(0);      // side-to-side in radians
  const [followPitchOffset, setFollowPitchOffset] = useState(0);  // up/down in radians
  const [followSeed, setFollowSeed] = useState(0);                // reseed follower from current camera
  const [smoothFollow, setSmoothFollow] = useState(false);        // keep snapped follow only (smooth disabled)
  const controlsRef = useRef();
  const lastLocalPosRef = useRef({ x: null, z: null });
  const smoothEnableTimerRef = useRef(null);
  // Gate: skip the very next smooth-enable after pressing Leave (user request)
  const suppressNextSmoothRef = useRef(false);

  // When Full Camera controls are enabled, turn OFF 3rd-person follow and clear any follow timers
  useEffect(() => {
    if (fullCamera) {
      try {
        setFollowCam(false);
        if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; }
        setSmoothFollow(false);
        window.__CF_USER_ORBIT__ = false;
        window.__CF_RESUME_FOLLOW_AT__ = 0;
        window.__CF_FORCE_SNAP__ = 0;
      } catch {}
    }
  }, [fullCamera]);
  // Helper: ensure 3rd-person follow is ON and centered behind the avatar
  const centerThirdPerson = useCallback(() => {
    try {
      // Ensure 3rd-person is enabled and presets are centered (do not force-disable full camera here)
      // Cancel any pending smooth-enable and force snapped mode
      try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {}
      setSmoothFollow(false);
      // Reset last movement sample so auto-enable waits for fresh steps
      lastLocalPosRef.current = { x: null, z: null };
      setFollowYawOffset(0);
      setFollowPitchOffset(0);
      // Compute distances locally to avoid ordering issues
      const localMinDist = fullCamera ? 2 : (isNarrow ? 10 : 9);
      const localMaxDist = fullCamera ? 400 : (isNarrow ? 60 : 40);
      const dz = Math.min(Math.max(localMinDist, 38), (localMaxDist - 1));
      setFollowZoom(dz);
      const ctrl = controlsRef.current; const cam = ctrl?.object;
      const msg = window.__CF_LOCAL_AVATAR__;
      if (cam && msg && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
        const ty = ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 + 0.15;
        const fwdOffset = (flip180 ? Math.PI : 0);
        const yaw = (typeof msg.yaw === 'number' ? msg.yaw : 0) + fwdOffset;
        const forward = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
        const targetV = new THREE.Vector3(msg.x, ty, msg.z);
        const upOff = new THREE.Vector3(0, 7.5, 0);
        const desired = targetV.clone().addScaledVector(forward, -dz).add(upOff);
        cam.position.copy(desired);
        cam.lookAt(targetV);
        if (ctrl) { ctrl.target.copy(targetV); ctrl.update(); }
      }
      // Engage follower immediately with no grace
      try { window.__CF_USER_ORBIT__ = false; window.__CF_RESUME_FOLLOW_AT__ = 0; } catch {}
      // Force follower to snap for a few frames to guarantee alignment without user interaction
      try { window.__CF_FORCE_SNAP__ = 3; } catch {}
      setFollowSeed((s) => s + 1);
      setFollowCam(true);
    } catch {}
  }, [controlsRef, fullCamera, isNarrow, flip180]);

  // Clear any pending smooth-enable timer on unmount
  useEffect(() => {
    return () => { try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {} };
  }, []);

  // Helper: after the user walks a bit, auto-enable smooth follow with a short delay
  const autoEnableSmoothIfWalking = useCallback((x, z) => {
    // Smooth follow is disabled: ensure no timers and keep snapped mode
    try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {}
    try { suppressNextSmoothRef.current = false; } catch {}
    try { setSmoothFollow(false); } catch {}
    return;
  }, [followCam, smoothFollow]);

  // When followCam is turned on elsewhere, auto-center it once
  useEffect(() => {
    if (followCam && !fullCamera) {
      centerThirdPerson();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followCam, fullCamera]);

  
  // Zoom ranges (more zoom out by default; very long when fullCamera)
  const minDist = fullCamera ? 2 : (isNarrow ? 10 : 9);
  const maxDist = fullCamera ? 400 : (isNarrow ? 60 : 40);
  // Position the HUD below the navbar
  const hudTop = isNarrow ? 76 : 64;

  // No on-screen animation speed sliders; values can still be overridden via window.__CF_ANIM_SPEEDS__ if needed.

  // Compute avatar facing toward current camera position using baked per-side X offsets
  // Opponent should always be on the far side of the table from the camera
  const zSign = camPos[2] >= 0 ? -1 : 1; // camera z>0 means near side is +Z; opponent goes to -Z (and vice versa)
  const pxFixed = AVATAR_BAKED_POS[0] + ((zSign < 0) ? AVATAR_X_FRONT : AVATAR_X_BACK);
  const pzFixed = (zSign >= 0 ? 1 : -1) * Math.abs(AVATAR_BAKED_POS[2]);
  // Face the camera: our models/groups default to looking toward -Z, so add π to align toward the camera direction
  const yaw = Math.atan2(camPos[0] - pxFixed, camPos[2] - pzFixed) + Math.PI;
  const rotationOverride = [0, yaw, 0];
  const positionOverride = null; // position is computed inside avatar components now

  const GRID_H = ROWS * (CELL + GAP) - GAP;
  const groupY = (GRID_H + 0.6) / 2 + 0.15;
  // Compute a local Y offset so the board (base at -fh/2) rests on the table top (published by WoodenTable)
  const fhBoard = GRID_H + 0.6; // same as fh in FrontPlate/SideSupports
  const [tableTopY, setTableTopY] = useState(() => {
    const top = (typeof window !== 'undefined') ? Number(window.__CF_TABLE_TOP_Y__) : NaN;
    return Number.isFinite(top) ? top : null;
  });
  // Use a layout effect so the listener is attached before TableFBX dispatches in its own layout effect
  useLayoutEffect(() => {
    const onReady = (e) => {
      try {
        const ty = Number(e?.detail?.topY);
        if (Number.isFinite(ty)) setTableTopY(ty);
      } catch {}
    };
    try { window.addEventListener('cf:table-ready', onReady); } catch {}
    return () => { try { window.removeEventListener('cf:table-ready', onReady); } catch {} };
  }, []);
  const boardOnTableYOffset = (() => {
    try {
      const top = (tableTopY != null) ? tableTopY : (typeof window !== 'undefined' ? Number(window.__CF_TABLE_TOP_Y__) : NaN);
      if (!Number.isFinite(top)) return 0; // fallback: leave as-is
      const epsilon = 0.02; // tiny lift to avoid z-fighting
      // Parent group is at groupY (world Y). The board subgroup's origin is centered; base is at -fh/2.
      // Solve for childY so the board base rests exactly on the tabletop: groupY + childY - fh/2 = top + epsilon
      // => childY = top + epsilon + fh/2 - groupY
      return (top + epsilon + fhBoard / 2 - groupY);
    } catch { return 0; }
  })();
  // Ensure the board starts visibly above the floor even if tabletop detection lags slightly on first paint
  const BOARD_EXTRA_LIFT = -4.0;
  const tableTopKnown = useMemo(() => {
    if (tableTopY != null && Number.isFinite(tableTopY)) return true;
    const g = (typeof window !== 'undefined') ? Number(window.__CF_TABLE_TOP_Y__) : NaN;
    return Number.isFinite(g);
  }, [tableTopY]);

  // Player-specific avatar URLs (Player 2 shark kept for now)
  const player2Url = '/models/avatars/shark/scene.gltf';

  // Precompute positions for both player avatars (consistent regardless of camera side)
  const avatarZ = Math.abs(AVATAR_BAKED_POS[2]);
  const player1Pos = useMemo(() => ({
    x: AVATAR_BAKED_POS[0] + AVATAR_X_FRONT,
    y: AVATAR_BAKED_POS[1],
    z: avatarZ, // Player 1 on +Z side facing center
    zSign: 1
  }), [avatarZ]);
  const player2Pos = useMemo(() => ({
    x: AVATAR_BAKED_POS[0] + AVATAR_X_BACK,
    y: AVATAR_BAKED_POS[1],
    z: -avatarZ, // Player 2 on -Z side facing center
    zSign: -1
  }), [avatarZ]);
  // Determine which player is "you" based on flip180 (if flipped, Player 2 viewpoint)
  const youArePlayer2 = !!flip180;
  // State for the local player's label position (XZ), so Billboards update via React props
  const [youLabelPos, setYouLabelPos] = useState({ x: youArePlayer2 ? player2Pos.x : player1Pos.x, z: youArePlayer2 ? player2Pos.z : player1Pos.z });
  // Remote avatar position (world XZ). Start at the base position of the opponent side.
  const remoteBase = youArePlayer2 ? player1Pos : player2Pos;
  const remoteSide = youArePlayer2 ? 'Player 1' : 'Player 2';
  const [remoteLabelPos, setRemoteLabelPos] = useState({ x: remoteBase.x, z: remoteBase.z });
  const remoteRef = useRef({ x: remoteBase.x, z: remoteBase.z });

  // When the user returns to third-person (showSelf=true), seed a local pose and re-center the camera
  useEffect(() => {
    if (!showSelf) return;
    // If user enabled Full Camera, do not auto-enable follow/centering
    if (fullCamera) return;
    // Seed a synthetic local pose so follower/camera has a target immediately
    try {
      const base = youArePlayer2 ? { x: player2Pos.x, z: player2Pos.z } : { x: player1Pos.x, z: player1Pos.z };
      window.__CF_LOCAL_AVATAR__ = {
        x: base.x,
        z: base.z,
        yaw: youArePlayer2 ? Math.PI : 0,
        isRunning: false,
        isJumping: false,
        lift: 0,
      };
    } catch {}
    // Defer a bit so PlayerMover mounts and publishes its live position, then center
    const id = setTimeout(() => { try { centerThirdPerson(); } catch {} }, 160);
    return () => { try { clearTimeout(id); } catch {} };
  }, [showSelf, fullCamera, centerThirdPerson, youArePlayer2, player1Pos.x, player1Pos.z, player2Pos.x, player2Pos.z]);

  // Click-to-move target for the local player (world XZ). Separate state for P1/P2 for clarity.
  const [p1Target, setP1Target] = useState(null);
  const [p2Target, setP2Target] = useState(null);

  // Floor Y for click-plane
  const fhForGround = ROWS * (CELL + GAP) - GAP + 0.6;
  const groundY = -fhForGround / 2 - GROUND_CLEAR;

  // Handle floor click -> set target for the current local player
  const handleFloorClick = useCallback((e) => {
    // r3f pointer event gives world point
    const pt = e?.point;
    if (!pt) return;
    try { e.stopPropagation && e.stopPropagation(); } catch {}
    try { e.preventDefault && e.preventDefault(); } catch {}
    const tx = pt.x;
    const tz = pt.z;
    // Clamp to mover radius around origin (0,0) in world XZ — PlayerMover enforces too, but we pre-clamp target
    const maxR = 115;
    const rr = Math.hypot(tx, tz);
    let cx = tx, cz = tz;
    if (rr > maxR) {
      const ang = Math.atan2(tz, tx);
      cx = Math.cos(ang) * maxR;
      cz = Math.sin(ang) * maxR;
    }
    if (youArePlayer2) setP2Target({ x: cx, z: cz }); else setP1Target({ x: cx, z: cz });
  }, [youArePlayer2]);

  const resetCamera = useCallback(() => {
    try {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const cam = ctrl.object;
      cam.position.set(camPos[0], camPos[1], camPos[2]);
      ctrl.target.set(0, ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 + 0.15, 0);
      ctrl.update();
    } catch {}
  }, [camPos]);

  // Jump helper: move local avatar to a side's base position and reset camera
  const gotoTableSide = useCallback((sideKey) => {
    try {
      const dest = sideKey === 'Player 1' ? { x: player1Pos.x, z: player1Pos.z } : { x: player2Pos.x, z: player2Pos.z };
      if (youArePlayer2) setP2Target(dest); else setP1Target(dest);
      // Disable 3rd-person follow when switching to board view
      setFollowCam(false);
      // Ensure smooth is off and pending timers are cleared while in board view
      try { if (smoothEnableTimerRef.current) { clearTimeout(smoothEnableTimerRef.current); smoothEnableTimerRef.current = null; } } catch {}
      setSmoothFollow(false);
      lastLocalPosRef.current = { x: null, z: null };
      // Reset camera to the chosen side's initial board view
      const ctrl = controlsRef.current;
      if (ctrl) {
        const cam = ctrl.object;
        const useCam = (sideKey === 'Player 1') ? camPosFront : camPosBack;
        cam.position.set(useCam[0], useCam[1], useCam[2]);
        ctrl.target.set(0, ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 + 0.15, 0);
        ctrl.update();
      }
    } catch {}
  }, [youArePlayer2, player1Pos.x, player1Pos.z, player2Pos.x, player2Pos.z, resetCamera]);

  // Canvas-aware controls wrapper to avoid constructing OrbitControls before camera exists
  function Controls({ target, isNarrow, flip180, fullCamera, minDist, maxDist }){
    const { camera } = useThree();
    useEffect(() => {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const onStart = () => { try{ window.__CF_USER_ORBIT__ = true; }catch{} };
      const onEnd = () => { try{ window.__CF_USER_ORBIT__ = false; window.__CF_RESUME_FOLLOW_AT__ = performance.now() + 800; }catch{} };
      try { ctrl.addEventListener('start', onStart); ctrl.addEventListener('end', onEnd); } catch {}
      return () => { try { ctrl.removeEventListener('start', onStart); ctrl.removeEventListener('end', onEnd); } catch {} };
    }, []);
    if (!camera) return null;
    return (
      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={target}
        enablePan={fullCamera}
        enableKeys={false}
        enableDamping={true}
        dampingFactor={0.12}
        minDistance={minDist}
        maxDistance={maxDist}
        enableRotate={true}
        enableZoom={true}
        {...((fullCamera || followCam) ? {} : { minPolarAngle: (isNarrow ? 0.06 : 0.08), maxPolarAngle: Math.PI*0.5 })}
        {...((fullCamera || followCam) ? {} : { minAzimuthAngle: (flip180 ? Math.PI - Math.PI*0.25 : -Math.PI*0.25), maxAzimuthAngle: (flip180 ? Math.PI + Math.PI*0.25 : Math.PI*0.25) })}
        zoomSpeed={1.0}
      />
    );
  }

  // Internal helper: runs inside Canvas so we can use useFrame safely
  function RemoteAvatarGroup({ side, base, children }){
    const gref = useRef();
    const pos = useRef({ x: base.x, z: base.z });
    const target = useRef({ x: base.x, z: base.z, has: false });
    const yawRef = useRef(0);            // current rotation Y (unwrapped radians)
    const yawTargetRef = useRef(null);   // target yaw (unwrapped)
    // Track last server target and timing to derive walking state without relying on smoothing residuals
    const lastTargetPos = useRef({ x: base.x, z: base.z });
    const lastMoveAtRef = useRef(0);
    const lastMsgAtRef = useRef(0);
    const lastRunRef = useRef(false);
    const lastJumpRef = useRef(false);
    const lastLiftRef = useRef(0);
  const [isWalking, setIsWalking] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isTurningLeft, setIsTurningLeft] = useState(false);
  const [isTurningRight, setIsTurningRight] = useState(false);
  const [isJumpingRemote, setIsJumpingRemote] = useState(false);
  const [liftRemote, setLiftRemote] = useState(0);
    // Track yaw velocity to infer turning when idle
    const prevYawRef = useRef(0);
    const prevYawTsRef = useRef(0);
    const norm = (a)=>{ let v=(a+Math.PI)%(2*Math.PI); if(v<0) v+=2*Math.PI; return v-Math.PI; };
    const unwrapToNear = (wrapped, near)=>{ const w = norm(wrapped); const k = Math.round((near - w)/(2*Math.PI)); return w + k*2*Math.PI; };
    // Initialize from any cached global to avoid visual snap on rare remounts
    useLayoutEffect(() => {
      try {
        const msg = window.__CF_REMOTE_AVATAR__;
        if (msg && msg.side === side && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
          pos.current = { x: Number(msg.x), z: Number(msg.z) };
          if (typeof msg.yaw === 'number' && Number.isFinite(msg.yaw)) {
            const yw = norm(Number(msg.yaw));
            yawRef.current = yw; yawTargetRef.current = yw;
            prevYawRef.current = yw; prevYawTsRef.current = performance.now();
          }
        }
      } catch {}
    }, [side, base.x, base.z]);
  useFrame((_, delta) => {
      try {
        const msg = window.__CF_REMOTE_AVATAR__;
        if (msg && msg.side === side) {
          const tx = Number(msg.x); const tz = Number(msg.z);
          if (Number.isFinite(tx) && Number.isFinite(tz)) {
            target.current = { x: tx, z: tz, has: true };
            // Update timing and movement detection from raw server targets (not smoothed)
            const dxT = tx - lastTargetPos.current.x;
            const dzT = tz - lastTargetPos.current.z;
            const moved2 = dxT*dxT + dzT*dzT;
            // mark as moving when the server-reported target changes meaningfully
            if (moved2 > 1e-6) {
              lastMoveAtRef.current = performance.now();
              lastTargetPos.current.x = tx; lastTargetPos.current.z = tz;
            }
            lastMsgAtRef.current = performance.now();
          }
          if (typeof msg.yaw === 'number' && Number.isFinite(msg.yaw)) {
            const prev = (typeof yawTargetRef.current === 'number') ? yawTargetRef.current : yawRef.current || 0;
            yawTargetRef.current = unwrapToNear(Number(msg.yaw), prev);
          }
          if (typeof msg.run === 'boolean') {
            lastRunRef.current = !!msg.run;
          }
          if (typeof msg.isJumping === 'boolean') {
            lastJumpRef.current = !!msg.isJumping;
          }
          if (typeof msg.lift === 'number' && Number.isFinite(msg.lift)) {
            lastLiftRef.current = Number(msg.lift);
          }
        }
        const alpha = Math.min(1, delta * 10.0);
        const tx = target.current.has ? target.current.x : pos.current.x;
        const tz = target.current.has ? target.current.z : pos.current.z;
        pos.current.x += (tx - pos.current.x) * alpha;
        pos.current.z += (tz - pos.current.z) * alpha;
        // Smoothly rotate toward target yaw using unwrapped angles to avoid wrap spinning
        if (typeof yawTargetRef.current === 'number') {
          const cur = yawRef.current;
          const tgt = yawTargetRef.current;
          const rotAlpha = Math.min(1, delta * 10.0);
          yawRef.current = cur + (tgt - cur) * rotAlpha;
        }
        if (gref.current) {
          // Place group at absolute world position; children should be at local origin
          gref.current.position.set(pos.current.x, 0, pos.current.z);
          gref.current.rotation.y = norm(yawRef.current || 0);
        }
  // Update walk/run animation state: prefer server-run; walk based on recent move updates, not smoothing residual
        const now = performance.now();
        const running = !!lastRunRef.current;
        const WALK_GRACE_MS = 85; // short grace so opponent stops nearly instantly
        const walking = running || ((now - lastMoveAtRef.current) < WALK_GRACE_MS);
        if (walking !== isWalking) setIsWalking(walking);
        if (running !== isRunning) setIsRunning(running);
  // Remote jump/lift
  const newJump = !!lastJumpRef.current;
  const newLift = Number(lastLiftRef.current) || 0;
  if (newJump !== isJumpingRemote) setIsJumpingRemote(newJump);
  if (Math.abs(newLift - liftRemote) > 0.00001) setLiftRemote(newLift);
        // Turning detection when idle: compute yaw velocity
        const prevTs = prevYawTsRef.current || now - Math.max(1, delta*1000);
        const dtMs = Math.max(1, now - prevTs);
        const dtSec = dtMs / 1000;
        const yawVel = (yawRef.current - prevYawRef.current) / dtSec; // rad/s
        const TURN_THRESH = 0.5; // rad/s threshold
        const turningL = !walking && (yawVel > TURN_THRESH);
        const turningR = !walking && (yawVel < -TURN_THRESH);
        if (turningL !== isTurningLeft) setIsTurningLeft(turningL);
        if (turningR !== isTurningRight) setIsTurningRight(turningR);
        prevYawRef.current = yawRef.current;
        prevYawTsRef.current = now;
      } catch {}
    });
    // Remove smoothed-displacement-based walking detection to avoid lingering walk after stop
    // Inject motion props into the first child (avatar), preserve other children (e.g., label)
    const withMotionChildren = useMemo(() => {
      const arr = React.Children.toArray(children);
      if (arr.length > 0 && React.isValidElement(arr[0])) {
        try {
          arr[0] = React.cloneElement(arr[0], { isWalking, isRunning, isTurningLeft, isTurningRight, isJumping: isJumpingRemote, extraLiftY: liftRemote });
        } catch {}
      }
      return arr;
    }, [children, isWalking, isRunning, isTurningLeft, isTurningRight, isJumpingRemote, liftRemote]);
    return <group ref={gref}>{withMotionChildren}</group>;
  }

  // Camera follower keeps OrbitControls' camera behind the local avatar when enabled
  function CameraFollower({ followZoom, forwardOffset = 0, yawOffset = 0, pitchOffset = 0, seedToken = 0, snap = true }){
    const { camera } = useThree();
    const target = useRef(new THREE.Vector3());
    const smoothPos = useRef(new THREE.Vector3());
    useEffect(() => {
      smoothPos.current.copy(camera.position);
    }, [camera]);
    // Reseed smooth position from current camera when requested to avoid snap
    useEffect(() => {
      try {
        if (camera) {
          smoothPos.current.copy(camera.position);
        }
      } catch {}
    }, [seedToken, camera]);
    useFrame((_, dt) => {
      try {
        const msg = window.__CF_LOCAL_AVATAR__;
        if (!msg || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
        // Desired camera target is a bit above the avatar
        const ty = ((ROWS * (CELL + GAP) - GAP) + 0.6) / 2 + 0.15;
        target.current.set(msg.x, ty, msg.z);
  let yaw = (typeof msg.yaw === 'number') ? msg.yaw : 0;
  // Account for model-specific yaw offsets so 'forward' matches the visual facing
  yaw += forwardOffset;
  // Compute adjusted camera basis with yaw/pitch offsets
  const baseForward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
  // Apply yaw side offset (rotate around Y)
  const sideForward = baseForward.clone().applyAxisAngle(new THREE.Vector3(0,1,0), yawOffset || 0);
  // Apply pitch offset by rotating around camera-local X axis; approximate by tilting the offset vector
  const pitchAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), sideForward).normalize();
  const forward = sideForward.clone().applyAxisAngle(pitchAxis, pitchOffset || 0);
        const userOrbiting = !!(window.__CF_USER_ORBIT__);
        // Place camera behind the avatar (target - forward * distance), slightly above
        const desired = new THREE.Vector3(msg.x, ty, msg.z)
          .addScaledVector(forward, -followZoom)
          .add(new THREE.Vector3(0, 7.5, 0));
        // Always snap mode (when smoothFollow is off) OR in forced-snap window
        const forceSnap = Math.max(0, Number(window.__CF_FORCE_SNAP__ || 0));
        if (snap || forceSnap > 0) {
          const ctrl2 = controlsRef.current;
          camera.position.copy(desired);
          camera.lookAt(target.current);
          if (ctrl2) { ctrl2.target.copy(target.current); ctrl2.update(); }
          if (forceSnap > 0) { try { window.__CF_FORCE_SNAP__ = forceSnap - 1; } catch {} }
          return;
        }
        // Smooth toward desired; if user is orbiting, don't fight them
        const alpha = Math.min(1, dt * 5.0);
        const ctrl2 = controlsRef.current;
        const resumeAt = Number(window.__CF_RESUME_FOLLOW_AT__ || 0);
        const withinGrace = performance.now() < resumeAt;
        if (ctrl2 && (userOrbiting || withinGrace)) {
          ctrl2.target.lerp(target.current, alpha * 1.2);
          ctrl2.update();
          return;
        }
        smoothPos.current.lerp(desired, alpha);
        camera.position.copy(smoothPos.current);
        camera.lookAt(target.current);
        if (ctrl2) { ctrl2.target.lerp(target.current, alpha); ctrl2.update(); }
      } catch {}
    });
    return null;
  }

  // Glowing clickable portal pad for local side
  function PortalPad({ position = [0,0,0], color = '#7dd3fc', onClick }) {
    const groupRef = useRef();
    const ringRef = useRef();
    const coreRef = useRef();
    const [hover, setHover] = useState(false);
    useFrame((state, dt) => {
      const t = state.clock.getElapsedTime();
      // gentle rotation and pulse
      if (ringRef.current) {
        ringRef.current.rotation.z = t * 0.6;
        const s = 1.0 + Math.sin(t * 2.2) * 0.06;
        ringRef.current.scale.setScalar(s);
      }
      if (coreRef.current) {
        const o = 0.35 + (hover ? 0.25 : 0.0) + Math.max(0, Math.sin(t * 3.0)) * 0.18;
        coreRef.current.material.opacity = Math.min(0.95, o);
        const s2 = 1.0 + Math.sin(t * 2.0 + 0.7) * 0.04;
        coreRef.current.scale.setScalar(s2);
      }
    });
    return (
      <group ref={groupRef} position={position}
        onPointerOver={() => { try { setHover(true); document.body.style.cursor = 'pointer'; } catch {} }}
        onPointerOut={() => { try { setHover(false); document.body.style.cursor = ''; } catch {} }}
        onPointerDown={(e) => { try { e.stopPropagation(); } catch {} if (onClick) onClick(); }}>
        {/* Outer neon ring */}
        <mesh ref={ringRef} rotation={[-Math.PI/2, 0, 0]}
          castShadow receiveShadow>
          <ringGeometry args={[1.8, 2.2, 64]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hover ? 1.2 : 0.85} metalness={0.35} roughness={0.4} transparent opacity={0.9} />
        </mesh>
        {/* Soft inner glow (additive) */}
        <mesh ref={coreRef} rotation={[-Math.PI/2, 0, 0]} renderOrder={1}>
          <circleGeometry args={[1.55, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {/* Subtle vertical shimmer */}
        <mesh position={[0, 0.02, 0]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.6, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hover ? 2.0 : 1.3} metalness={0.0} roughness={0.2} transparent opacity={0.85} />
        </mesh>
      </group>
    );
  }

  // Leave Game button (on-table, user side only when in board view)
  function LeaveButton({ position = [0,0,0], color = '#f43f5e', label = 'Leave Game', onClick }) {
    const baseRef = useRef();
    const [hover, setHover] = useState(false);
    useFrame((state) => {
      const t = state.clock.getElapsedTime();
      if (baseRef.current) {
        const pulse = 0.04 + Math.max(0, Math.sin(t * 2.3)) * 0.06 + (hover ? 0.08 : 0);
        baseRef.current.material.emissiveIntensity = 0.6 + pulse;
      }
    });
    return (
      <group position={position}
        onPointerOver={() => { try { setHover(true); document.body.style.cursor = 'pointer'; } catch {} }}
        onPointerOut={() => { try { setHover(false); document.body.style.cursor = ''; } catch {} }}
        onPointerDown={(e) => { try { e.stopPropagation(); } catch {} if (onClick) onClick(); }}>
        {/* Thin pill button */}
        <mesh ref={baseRef} rotation={[-Math.PI/2, 0, 0]} castShadow receiveShadow>
          <ringGeometry args={[0.0, 1.35, 48]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.85} metalness={0.1} roughness={0.35} transparent opacity={0.95} />
        </mesh>
        {/* Text label above */}
        <Billboard follow={true} position={[0, 0.9, 0]}>
          <Text fontSize={1.6} color={'#fee2e2'} anchorX="center" anchorY="middle" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
            {label}
          </Text>
        </Billboard>
      </group>
    );
  }

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', minHeight: 520, zIndex: 1 }}>
      {/* No tweak panel; avatars share identical placement */}
      <div style={{ position:'absolute', inset:0, zIndex: 1000 }}>
        {/* Simple HUD for toggles (fixed at top, above nav) */}
  <div style={{ position:'fixed', top:hudTop, left:10, zIndex: 2147483647, background:'rgba(15,23,42,0.75)', padding:'8px 10px', borderRadius:8, color:'#e2e8f0', fontSize:12, display:'flex', flexDirection:'column', gap:6, boxShadow:'0 4px 12px rgba(0,0,0,0.35)', backdropFilter:'blur(4px)' }}>
          <label style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" checked={showSelf} onChange={e=>setShowSelf(e.target.checked)} /> Show my character
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" checked={moveEnabled} onChange={e=>setMoveEnabled(e.target.checked)} disabled={!showSelf} /> Movement (arrows)
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" checked={clickMove} onChange={e=>setClickMove(e.target.checked)} disabled={!showSelf || !moveEnabled} /> Click-to-move
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" checked={fullCamera} onChange={e=>setFullCamera(e.target.checked)} /> Full camera controls
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" checked={followCam} onChange={e=>setFollowCam(e.target.checked)} /> 3rd-person follow
          </label>
          {followCam && (
            <label style={{ display:'flex', alignItems:'center', gap:6 }}>
              <input type="checkbox" checked={smoothFollow} onChange={e=>setSmoothFollow(e.target.checked)} disabled={!showSelf} /> Smooth follow (otherwise snapped)
            </label>
          )}
          {/* No on-screen animation controls */}
          <button onClick={resetCamera} style={{ marginTop:4, padding:'4px 8px', borderRadius:6, border:'1px solid #334155', background:'#0f172a', color:'#e2e8f0', cursor:'pointer' }}>Reset Camera</button>
        </div>
        <Canvas
          key={flip180 ? 'cam-back' : 'cam-front'}
          frameloop={'always'}
          dpr={isNarrow ? 1 : 1}
          camera={{ position: camPos, fov: camFov, near:0.08, far: fullCamera ? 1000 : 900 }}
          style={{ width: '100%', height: '100%' }}
          shadows
          gl={{ powerPreference:'high-performance', antialias: isNarrow ? false : true, alpha:false, stencil:false, depth:true, preserveDrawingBuffer:false }}
          onCreated={(st)=>{ try{ st.gl.setClearColor('#0f172a'); st.gl.shadowMap.enabled = true; st.gl.shadowMap.type = THREE.PCFSoftShadowMap; }catch{} }}
        >
          <hemisphereLight intensity={0.55} groundColor={'#1b1b1b'} />
          <ambientLight intensity={0.5} />
          {/* Main soft angled light: widen frustum to avoid cut-off; subtle + fuzzy */}
          <directionalLight
            position={[22, 24, -18]}
            intensity={0.7}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-near={1}
            shadow-camera-far={60}
            shadow-camera-left={-30}
            shadow-camera-right={30}
            shadow-camera-top={30}
            shadow-camera-bottom={-30}
            shadow-bias={-0.0004}
            shadow-normalBias={0.03}
            shadow-radius={6}
          />
          {/* Gentle fills without shadows so the scene stays readable */}
          <pointLight position={[0,10,0]} intensity={0.5} distance={60} decay={2} />
          <pointLight position={[10,8,6]} intensity={0.35} distance={60} decay={2} />
          <pointLight position={[-10,8,-6]} intensity={0.35} distance={60} decay={2} />

          <Controls target={[0,groupY,0]} isNarrow={isNarrow} flip180={flip180} fullCamera={fullCamera} minDist={minDist} maxDist={maxDist} />
          {followCam && (
            <CameraFollower
              followZoom={followZoom}
              forwardOffset={youArePlayer2 ? Math.PI : 0}
              yawOffset={followYawOffset}
              pitchOffset={followPitchOffset}
              seedToken={followSeed}
              snap={!smoothFollow}
            />
          )}

          {/* Keep the board unrotated; use camera side for Player 2 */}
          <group position={[0, groupY, 0]} rotation={[0, 0, 0]}>
            {/* Space background: stars, dust, planets */}
            <SpaceBackdrop speed={0.22} dir={[1.0, 0.25]} starIntensity={3.2} clusterStrength={5.0} />
            <DenseGalaxyField totalPoints={600} clusters={6} radius={750} clusterSpread={0.02} speed={0.05} dir={[1.0, 0.25]} sizeRange={[1.4, 3.6]} />
            <GalaxyClusters clusterCount={5} pointsPerCluster={100} radius={720} spread={0.028} speed={0.06} dir={[1.0, 0.25]} />
            <FlybyAsteroids count={4} speed={0.18} dir={[1.0, 0.25]} />
            <StarSwarms maxSwarms={3} basePoints={120} speed={0.55} dir={[1.0, 0.25]} />
            {/* Asteroid surface floor for a flying-over-asteroid vibe */}
            <AsteroidFloor opacity={1.0} radius={120} speed={0.0} dir={[1.0, 0.3]} scale={0.75} />
            {/* Floor click-to-move disabled: only side pads are clickable */}
            <mesh position={[0, groundY + 0.002, 0]} rotation={[-Math.PI/2, 0, 0]} renderOrder={-1} raycast={() => null}>
              <planeGeometry args={[800, 800, 1, 1]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {/* Board assembly: render only after the table reports top Y (state or global) to avoid initial snap */}
            {tableTopKnown && (
              <group position={[0, boardOnTableYOffset + BOARD_EXTRA_LIFT, 0]}>
                <FrontPlate />
                <SideSupports />
                {/* Classic board without neon accents */}
                {/* Disable shadow catcher on very small screens to avoid any perceived haze */}
                {(!isNarrow) && <BackShadowCatcher opacity={0.14} />}

                {/* Pieces from board state */}
                {Array.from({ length: ROWS }).map((_, r) => (
                  Array.from({ length: COLS }).map((_, c) => {
                    const v = board?.[r]?.[c];
                    if (!v) return null;
                    const col = colors?.[v] || (v === 1 ? '#ff3b5c' : '#ffd166');
                    // Always drop pieces top-down regardless of camera side
                    return <Piece key={`p-${r}-${c}`} color={col} c={c} r={r} flip180={false} />;
                  })
                ))}

                {/* Input hotspots */}
                {Array.from({ length: COLS }, (_, c) => {
                  const x = (c - (COLS - 1) / 2) * (CELL + GAP);
                  const H = ROWS * (CELL + GAP) - GAP;
                  return (
                    <mesh key={`hs-${c}`} position={[x, 0, 0]} onPointerDown={() => onSelectColumn && onSelectColumn(c)}>
                      <boxGeometry args={[CELL, H + 0.5, 1.2]} />
                      <meshBasicMaterial transparent opacity={0} />
                    </mesh>
                  );
                })}
              </group>
            )}
            <TableFBX />

              {/* Local-only clickable portal (require Click-to-move to be ON) */}
              {showSelf && moveEnabled && clickMove && (
                youArePlayer2 ? (
                  <PortalPad position={[player2Pos.x, groundY + 0.012, player2Pos.z]} color={'#a78bfa'} onClick={() => gotoTableSide('Player 2')} />
                ) : (
                  <PortalPad position={[player1Pos.x, groundY + 0.012, player1Pos.z]} color={'#22d3ee'} onClick={() => gotoTableSide('Player 1')} />
                )
              )}

              {/* Leave Game button: on the tabletop, centered in front of the board on your side when hidden */}
              {!showSelf && (
                (() => {
                  // Center X with tiny nudge toward your avatar's X offset; move Z further onto the table (away from the edge)
                  const forward = 5.3; // distance from board center toward the local side
                  const z = (youArePlayer2 ? -1 : 1) * forward;
                  const x = 0; // centered horizontally
                  return (
                    <LeaveButton
                      position={[x, -2.1, z]}
                      color={'#f43f5e'}
                      label={'Leave Game'}
                      onClick={() => {
                        try {
                          // Return to third-person and disable click-to-move when leaving
                          setShowSelf(true);
                          centerThirdPerson();
                          setClickMove(false);
                          setP1Target(null);
                          setP2Target(null);
                          // After leaving board view, keep smooth off even on the first walk
                          try { suppressNextSmoothRef.current = true; } catch {}
                        } catch {}
                      }}
                    />
                  );
                })()
              )}

            {/* Player 1 Avatar (Astronaut FBX) */}
            <Suspense fallback={null}> 
              <ModelErrorBoundary fallback={null}> 
                {youArePlayer2 ? (
                  <RemoteAvatarGroup side={remoteSide} base={player1Pos}>
                    {/* Remote P1: show opponent's chosen character (default alien) */}
                    {oppCharacterId === 'astronaut' ? (
                      <AstronautFBXOpponent key={`opp-p1-astronaut`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0, 0, 0]} yawOffset={Math.PI} />
                    ) : oppCharacterId === 'robot4' ? (
                      <Robot4FBXOpponent key={`opp-p1-robot4`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0, 0, 0]} yawOffset={Math.PI} />
                    ) : (
                      <Alien2FBXOpponent key={`opp-p1-alien`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0, 0, 0]} yawOffset={Math.PI} />
                    )}
                    <Billboard follow={true} position={[0, 8.5, 0]}>
                      <group>
                        <Text fontSize={1.6} color={'#94a3b8'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                          {youArePlayer2 ? 'Player 1' : 'Player 2'}
                        </Text>
                        <Text position={[0,-1.6,0]} fontSize={2.2} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                          {oppName || 'Opponent'}
                        </Text>
                      </group>
                    </Billboard>
                  </RemoteAvatarGroup>
                ) : (
                  showSelf && (
                    <PlayerMover enabled={moveEnabled} maxRadius={115} speed={15.5} invertForward={false} baseOffset={[player1Pos.x, player1Pos.z]} initialYaw={0} obstacles={[tableRect]} collisionRadius={2.6} labelSide={'Player 1'} labelName={myName} moveTarget={clickMove ? p1Target : null} onArrive={() => {
                      try {
                        // final resend after arrival to guarantee opponent sees yaw=0
                        const msg = window.__CF_LOCAL_AVATAR__;
                        if (msg && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
                          const { x, z, yaw } = msg;
                          const send = () => { try { const la=(window.__CF_LOCAL_AVATAR__||{}); const run=!!la.isRunning; const isJumping=!!la.isJumping; const lift=(typeof la.lift==='number'?la.lift:undefined); onAvatarMove && onAvatarMove({ player: 1, x, z, yaw: 0, run, isJumping, lift }); } catch {} };
                          setTimeout(send, 60);
                          setTimeout(send, 140);
                        }
                        // Ensure camera goes to board-front view on arrival, not to the side
                        try { setFollowCam(false); resetCamera(); } catch {}
                      } catch {}
                      setP1Target(null); setFullCamera(false); setShowSelf(false); setSmoothFollow(false);
                    }} onPositionChange={(x,z,yaw)=>{ try{ const la = (window.__CF_LOCAL_AVATAR__ || {}); const run = !!la.isRunning; const isJumping = !!la.isJumping; const lift = (typeof la.lift === 'number' ? la.lift : undefined); onAvatarMove && onAvatarMove({ player: 1, x, z, yaw, run, isJumping, lift }); }catch{} }}>
                      {/* Local P1: render selected character */}
                      {myCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key={`local-p1-astronaut`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      ) : myCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key={`local-p1-robot4`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      ) : (
                        <Alien2FBXOpponent key={`local-p1-alien`} xFront={xFront} xBack={xBack} zSign={player1Pos.zSign} positionOverride={[0,0,0]} yawOffset={Math.PI} />
                      )}
                    </PlayerMover>
                  )
                )}
              </ModelErrorBoundary>
            </Suspense>
            {/* Player 2 Avatar */}
            <Suspense fallback={null}> 
              <ModelErrorBoundary fallback={null}> 
                {!youArePlayer2 ? (
                  <RemoteAvatarGroup side={remoteSide} base={player2Pos}>
                    {/* Remote P2: show opponent's chosen character */}
                    {oppCharacterId === 'astronaut' ? (
                      <AstronautFBXOpponent key={`opp-p2-astronaut`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0, 0, 0]} yawOffset={0} />
                    ) : oppCharacterId === 'robot4' ? (
                      <Robot4FBXOpponent key={`opp-p2-robot4`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0, 0, 0]} yawOffset={0} />
                    ) : (
                      <Alien2FBXOpponent key={`opp-p2-alien`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0, 0, 0]} yawOffset={0} />
                    )}
                    <Billboard follow={true} position={[0, 8.5, 0]}>
                      <group>
                        <Text fontSize={1.6} color={'#94a3b8'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                          {youArePlayer2 ? 'Player 1' : 'Player 2'}
                        </Text>
                        <Text position={[0,-1.6,0]} fontSize={2.2} color={'#cbd5e1'} anchorX="center" anchorY="bottom" outlineWidth={0.04} outlineColor={'#000'} font={'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf'}>
                          {oppName || 'Opponent'}
                        </Text>
                      </group>
                    </Billboard>
                  </RemoteAvatarGroup>
                ) : (
                  showSelf && (
                    <PlayerMover enabled={moveEnabled} maxRadius={115} speed={16} invertForward={true} baseOffset={[player2Pos.x, player2Pos.z]} initialYaw={0} clickYawOffset={Math.PI} obstacles={[tableRect]} collisionRadius={2.6} labelSide={'Player 2'} labelName={myName} moveTarget={clickMove ? p2Target : null} onArrive={() => {
                      try {
                        const msg = window.__CF_LOCAL_AVATAR__;
                        if (msg && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
                          const { x, z, yaw } = msg;
                          const send = () => { try { const la=(window.__CF_LOCAL_AVATAR__||{}); const run=!!la.isRunning; const isJumping=!!la.isJumping; const lift=(typeof la.lift==='number'?la.lift:undefined); onAvatarMove && onAvatarMove({ player: 2, x, z, yaw: 0, run, isJumping, lift }); } catch {} };
                          setTimeout(send, 60);
                          setTimeout(send, 140);
                        }
                        // Ensure camera goes to board-front view on arrival, not to the side
                        try { setFollowCam(false); resetCamera(); } catch {}
                      } catch {}
                      setP2Target(null); setFullCamera(false); setShowSelf(false); setSmoothFollow(false);
                    }} onPositionChange={(x,z,yaw)=>{ try{ const la = (window.__CF_LOCAL_AVATAR__ || {}); const run = !!la.isRunning; const isJumping = !!la.isJumping; const lift = (typeof la.lift === 'number' ? la.lift : undefined); onAvatarMove && onAvatarMove({ player: 2, x, z, yaw, run, isJumping, lift }); }catch{} }}>
                      {/* Local P2: render selected character */}
                      {myCharacterId === 'astronaut' ? (
                        <AstronautFBXOpponent key={`local-p2-astronaut`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      ) : myCharacterId === 'robot4' ? (
                        <Robot4FBXOpponent key={`local-p2-robot4`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      ) : (
                        <Alien2FBXOpponent key={`local-p2-alien`} xFront={xFront} xBack={xBack} zSign={player2Pos.zSign} positionOverride={[0,0,0]} yawOffset={0} />
                      )}
                    </PlayerMover>
                  )
                )}
              </ModelErrorBoundary>
            </Suspense>

            {/* Labels are now attached and follow avatars (Billboard faces camera) */}

          </group>
        </Canvas>
      </div>
    </div>
  );
}
