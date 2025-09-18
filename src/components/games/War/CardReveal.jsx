// src/components/War/CardReveal.jsx
import * as React from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, OrthographicCamera } from '@react-three/drei'

function loadTexture(url){
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader()
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 8
        tex.flipY = false
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        resolve(tex)
      },
      undefined,
      (err) => reject(err)
    )
  })
}
function useTextureCandidates(candidates, deps){
  const [tex, setTex] = React.useState(null)
  React.useEffect(() => {
    let cancelled = false
    setTex(null)
    ;(async () => {
      for (const u of candidates){
        try {
          const t = await loadTexture(u)
          if (!cancelled){ setTex(t); return }
        } catch {}
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return tex
}

const SUIT_NAME = { S:'spades', C:'clubs', H:'hearts', D:'diamonds' }
const suitChar   = (s) => ({S:'♠', H:'♥', D:'♦', C:'♣'}[String(s).toUpperCase()] || s)
const rankChar   = (r) => (r==='10'?'T':r)
function normRank(label){
  if (!label) return 'A'
  const s = String(label).trim().toUpperCase()
  if (s === 'ACE' || s === 'A') return 'A'
  if (s === 'JACK' || s === 'J') return 'J'
  if (s === 'QUEEN' || s === 'Q') return 'Q'
  if (s === 'KING' || s === 'K') return 'K'
  if (s === 'TEN'  || s === 'T' || s === '10') return 'T'
  return String(parseInt(s, 10) || s)
}
function normSuit(suit){
  const st = String(suit || '').trim().toUpperCase()
  if (st.startsWith('C')) return 'C'
  if (st.startsWith('D')) return 'D'
  if (st.startsWith('H')) return 'H'
  if (st.startsWith('S')) return 'S'
  // also accept unicode
  const u = suitChar(st)
  if (u === '♣') return 'C'
  if (u === '♦') return 'D'
  if (u === '♥') return 'H'
  if (u === '♠') return 'S'
  return 'S'
}
function buildFrontCandidates(basePath, label, suit){
  const r = normRank(label)
  const s = normSuit(suit)
  const rn = (r === 'T') ? '10' : r
  const suitLower = SUIT_NAME[s]
  const bases = [
    `${r}${s}`, `${s}${r}`, `${rn}${s}`, `${s}${rn}`,
    `${r}_${suitLower}`, `${r}-of-${suitLower}`, `${r}-${suitLower}`,
    `${suitLower}-${r}`, `${r} of ${suitLower}`,
  ]
  const exts = ['svg','png','webp','jpg','jpeg']
  const list = []
  for (const b of bases) for (const e of exts) list.push(`${basePath}/${b}.${e}`.replace(/\/+/g,'/'))
  return list
}
function buildBackCandidates(basePath){
  const names = ['1B','BACK','back','2B','card-back','back-blue','back-red','Back']
  const exts = ['svg','png','webp','jpg','jpeg']
  const list = []
  for (const n of names) for (const e of exts) list.push(`${basePath}/${n}.${e}`.replace(/\/+/g,'/'))
  return list
}
function easeInOutQuint(t){
  return t < 0.5 ? 16*t*t*t*t*t : 1 - Math.pow(-2*t + 2, 5)/2
}

function DeckStack({ backTex, x=0, y=0 }){
  const w=0.63, h=0.88, d=0.02, eps=0.0012
  if (!backTex) return null
  const layers = [0, 0.006, 0.012, 0.018]
  return (
    <group position={[x,y,0]}>
      {layers.map((dy,i) => (
        <group key={i} position={[0, dy, 0]}>
          <mesh position={[0,0,d/2 + eps]}>
            <planeGeometry args={[w,h]} />
            <meshBasicMaterial map={backTex} toneMapped={false} transparent alphaTest={0.01} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function CardFaceMat({ frontTex, backTex }){
  const matRef = React.useRef()
  const uniforms = React.useMemo(() => ({
    uFront: { value: frontTex },
    uBack:  { value: backTex  },
    uAlphaCutoff: { value: 0.02 },
  }), [frontTex, backTex])

  React.useEffect(() => { if (matRef.current) { matRef.current.uniforms.uFront.value = frontTex; matRef.current.needsUpdate = true } }, [frontTex])
  React.useEffect(() => { if (matRef.current) { matRef.current.uniforms.uBack.value  = backTex;  matRef.current.needsUpdate = true } }, [backTex])

  const vertex = /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `
  const fragment = /* glsl */`
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uFront;
    uniform sampler2D uBack;
    uniform float uAlphaCutoff;
    void main(){
      vec4 col = gl_FrontFacing ? texture2D(uBack, vUv) : texture2D(uFront, vUv);
      if (col.a < uAlphaCutoff) discard;
      gl_FragColor = col;
    }
  `
  return (
    <shaderMaterial
      ref={matRef}
      args={[{ uniforms, vertexShader: vertex, fragmentShader: fragment }]}
      transparent
      depthWrite={false}
      side={THREE.DoubleSide}
      polygonOffset
      polygonOffsetFactor={-2}
      toneMapped={false}
    />
  )
}

function FlipThenTravelCard({
  label, suit,
  basePath='/cards/meuk',
  deck=[0,0,0],
  target=[-1.2,0,0],
  finalRotZ=-0.06,
  dealDelay=0,
  totalMs=1000,
  zLift=0.035,
  edge='right',
  arc=0.02
}){
  const w=0.63, h=0.88, eps=0.0008
  const frontTex = useTextureCandidates(buildFrontCandidates(basePath, label, suit), [label, suit, basePath])
  const backTex  = useTextureCandidates(buildBackCandidates(basePath), [basePath])

  const root = React.useRef(null)
  const face = React.useRef(null)
  const clock = React.useRef(0)
  const started = React.useRef(false)
  const [visible, setVisible] = React.useState(false)
  const ready = !!frontTex && !!backTex
  const sign = edge === 'right' ? -1 : 1

  useFrame((_, delta) => {
    if (!ready) return
    clock.current += delta * 1000
    if (!started.current){
      if (clock.current >= dealDelay){
        started.current = true
        setVisible(true)
        if (root.current){
          root.current.position.set(deck[0], deck[1], (deck[2]||0) + zLift)
          root.current.rotation.set(0,0,-0.08)
        }
        if (face.current){ face.current.rotation.y = 0 }
      } else { return }
    }

    const t = Math.max(0, clock.current - dealDelay)
    const p = Math.min(1, t / totalMs)
    const e = easeInOutQuint(p)

    if (face.current){ face.current.rotation.y = Math.PI * sign * e }
    if (root.current){
      const x = THREE.MathUtils.lerp(deck[0], target[0], e)
      const y = THREE.MathUtils.lerp(deck[1], target[1], e) + Math.sin(e * Math.PI) * arc
      const rz = THREE.MathUtils.lerp(-0.02, finalRotZ, e)
      root.current.position.set(x, y, (deck[2]||0) + zLift)
      root.current.rotation.set(0,0,rz)
    }
  })

  if (!ready || !visible) return null
  return (
    <group ref={root}>
      <mesh ref={face} position={[0,0,eps]} renderOrder={2}>
        <planeGeometry args={[w,h]} />
        <CardFaceMat frontTex={frontTex} backTex={backTex} />
      </mesh>
    </group>
  )
}

export default function CardReveal({
  you,             // {rank:'A'|'2'..'K', suit:'♠'|'♥'|'♦'|'♣'} or {label,suit}
  opp,
  round = 0,       // used to key animations
  basePath = '/cards/meuk',

  // positions (world units). 0,0 is canvas center.
  deckX = 0, deckY = 0,
  leftX = -1.2, rightX = 1.2, // landing slots
  zLift = 0.12,

  // multiplier to push both landings farther from the deck without touching your props
  distance = 1.0,

  // camera / anim
  height = 300,
  cameraZoom = 120,
  firstDelayMs = 250,
  staggerMs = 900,
  totalMs = 1000,
}){
  // apply distance multiplier
  const L = leftX  * distance
  const R = rightX * distance
  const D = [deckX, deckY, 0]

  // auto zoom out if targets exceed view (so pushing farther *actually shows up*)
  const maxAbs = Math.max(Math.abs(L), Math.abs(R), Math.abs(deckX)) + 0.25
  const autoZoom = Math.max(70, cameraZoom * (1.1 + (maxAbs - 1.2) * 0.35))

  const key1 = `${round}-you-${you?.rank || you?.label}-${you?.suit}`
  const key2 = `${round}-opp-${opp?.rank || opp?.label}-${opp?.suit}`

  // normalize incoming shapes from server/game
  const yRank = rankChar(you?.rank ?? you?.label)
  const ySuit = you?.suit
  const oRank = rankChar(opp?.rank ?? opp?.label)
  const oSuit = opp?.suit

  return (
    <div style={{ width:'100%', height, position:'relative', overflow:'visible' }}>
      <Canvas dpr={[1,2]} gl={{ alpha: true }} onCreated={(st)=>st.gl.setClearAlpha(0)} style={{ background:'transparent' }}>
        <OrthographicCamera makeDefault position={[0,0,5]} zoom={autoZoom} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[2,3,5]} intensity={0.88} castShadow={false} />
        <ContactShadows position={[0,-0.52,0]} opacity={0.25} width={10} height={10} blur={1.4} far={0.8} />

        {/* deck in the middle (your coordinates) */}
        <DeckStack backTex={useTextureCandidates(buildBackCandidates(basePath), [basePath])} x={deckX} y={deckY} />

        {/* YOU → left */}
        {you && (
          <FlipThenTravelCard
            key={key1}
            label={yRank} suit={ySuit}
            basePath={basePath}
            deck={D}
            target={[L, 0, 0]}
            finalRotZ={-0.06}
            dealDelay={firstDelayMs}
            totalMs={totalMs}
            zLift={zLift}
            edge="right"
            arc={0.02}
          />
        )}

        {/* OPP → right */}
        {opp && (
          <FlipThenTravelCard
            key={key2}
            label={oRank} suit={oSuit}
            basePath={basePath}
            deck={D}
            target={[R, 0, 0]}
            finalRotZ={0.06}
            dealDelay={firstDelayMs + staggerMs}
            totalMs={totalMs}
            zLift={zLift}
            edge="left"
            arc={0.02}
          />
        )}
      </Canvas>
    </div>
  )
}
