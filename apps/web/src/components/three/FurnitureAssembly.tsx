import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Grid, RoundedBox } from '@react-three/drei'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'

/** Phones and tablets: render at 1× without antialiasing — the scene stays the same, the GPU does far less work per frame. */
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

/**
 * Bazis "from sketch to object" sequence, driven by a 0→1 progress value.
 * Timeline (matches the course curriculum):
 *   0.00–0.17 sketch      wireframe of the chair draws in on the blueprint grid
 *   0.17–0.33 measure     dimension lines and labels appear
 *   0.33–0.50 materials   cut boards appear laid flat on the bench, material swatches rise
 *   0.50–0.62 fittings    dowels line up next to the boards
 *   0.62–0.80 3D model    boards lift, rotate and travel into their final positions
 *   0.80–1.00 assembly    joints get their fittings, the wood is varnished, the light warms up
 * Two modes: looping demo (`animate`) or external scroll progress (`progressRef`).
 * In scroll mode the whole frame is lens-shifted to the right on wide screens so the
 * model never sits under the copy on the left.
 */

const RAW = '#C9A67A'
const WOOD = '#A67C52'
const WOOD_DARK = '#6B4F3A'
const FOREST = '#0E5A44'
const CHAMPAGNE = '#CA9A36'
const IVORY = '#FBF3E3'

interface Part {
  size: [number, number, number]
  final: [number, number, number]
  flat: { pos: [number, number, number]; rot: [number, number, number] }
  dark?: boolean
}

// Chair parts: legs, seat, back posts, backrest, stretchers.
// `flat` = laid out on the bench beside the chair (kept within ±1.5 units so it stays in frame).
const PARTS: Part[] = [
  { size: [0.06, 0.6, 0.06], final: [-0.32, 0.3, -0.32], flat: { pos: [0.52, 0.03, -0.6], rot: [Math.PI / 2, 0, 0] }, dark: true },
  { size: [0.06, 0.6, 0.06], final: [0.32, 0.3, -0.32], flat: { pos: [0.64, 0.03, -0.6], rot: [Math.PI / 2, 0, 0] }, dark: true },
  { size: [0.06, 0.6, 0.06], final: [-0.32, 0.3, 0.32], flat: { pos: [0.76, 0.03, -0.6], rot: [Math.PI / 2, 0, 0] }, dark: true },
  { size: [0.06, 0.6, 0.06], final: [0.32, 0.3, 0.32], flat: { pos: [0.88, 0.03, -0.6], rot: [Math.PI / 2, 0, 0] }, dark: true },
  { size: [0.76, 0.06, 0.76], final: [0, 0.63, 0], flat: { pos: [0.8, 0.03, 0.25], rot: [0, 0, 0] } },
  { size: [0.06, 0.7, 0.06], final: [-0.32, 1.0, -0.32], flat: { pos: [1.0, 0.03, -0.6], rot: [Math.PI / 2, 0, 0] }, dark: true },
  { size: [0.06, 0.7, 0.06], final: [0.32, 1.0, -0.32], flat: { pos: [1.12, 0.03, -0.6], rot: [Math.PI / 2, 0, 0] }, dark: true },
  { size: [0.7, 0.22, 0.05], final: [0, 1.12, -0.32], flat: { pos: [0.8, 0.025, 0.85], rot: [Math.PI / 2, 0, 0] } },
  { size: [0.7, 0.05, 0.05], final: [0, 0.4, -0.32], flat: { pos: [0.8, 0.025, 1.05], rot: [0, 0, 0] }, dark: true },
  { size: [0.7, 0.05, 0.05], final: [0, 0.4, 0.32], flat: { pos: [0.8, 0.025, 1.17], rot: [0, 0, 0] }, dark: true },
]

const JOINTS: [number, number, number][] = [
  [-0.32, 0.6, -0.32], [0.32, 0.6, -0.32], [-0.32, 0.6, 0.32], [0.32, 0.6, 0.32], // leg → seat
  [-0.32, 1.0, -0.32], [0.32, 1.0, -0.32], // back posts → backrest
  [-0.32, 0.4, -0.32], [0.32, 0.4, 0.32], // stretchers
]

const seg = (p: number, a: number, b: number) => THREE.MathUtils.clamp((p - a) / (b - a), 0, 1)
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const stagger = (k: number, i: number, n: number, span = 0.55) => THREE.MathUtils.clamp((k - (i / n) * span) / (1 - span), 0, 1)

const rawColor = new THREE.Color(RAW)
const woodColor = new THREE.Color(WOOD)
const darkColor = new THREE.Color(WOOD_DARK)
const tmpColor = new THREE.Color()
const tmpV = new THREE.Vector3()
const CAM_A = new THREE.Vector3(0.4, 3.4, 2.4)
const CAM_B = new THREE.Vector3(3.0, 1.9, 3.2)
const CAM_C = new THREE.Vector3(2.45, 1.45, 2.7)

/** One chair part: wireframe sketch + solid board that travels from the bench to its final place. */
function PartMesh({ part, index, progress }: { part: Part; index: number; progress: MutableRefObject<number> }) {
  const solid = useRef<THREE.Mesh>(null)
  const wire = useRef<THREE.LineSegments>(null)
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(...part.size)), [part.size])
  const n = PARTS.length
  useFrame(() => {
    const p = progress.current
    const sketch = stagger(seg(p, 0, 0.17), index, n)
    const material = stagger(seg(p, 0.33, 0.5), index, n)
    const build = easeInOut(stagger(seg(p, 0.62, 0.8), index, n, 0.6))
    const finish = seg(p, 0.8, 1)
    if (wire.current) {
      const m = wire.current.material as THREE.LineBasicMaterial
      m.opacity = sketch * (1 - seg(p, 0.62, 0.8)) * 0.9
      wire.current.visible = m.opacity > 0.01
    }
    if (solid.current) {
      const m = solid.current.material as THREE.MeshStandardMaterial
      m.opacity = material
      solid.current.visible = material > 0.01
      const { pos, rot } = part.flat
      const appearLift = (1 - easeOut(material)) * 0.15
      solid.current.position.set(
        THREE.MathUtils.lerp(pos[0], part.final[0], build),
        THREE.MathUtils.lerp(pos[1] + appearLift, part.final[1], build) + Math.sin(build * Math.PI) * 0.35,
        THREE.MathUtils.lerp(pos[2], part.final[2], build),
      )
      solid.current.rotation.set(THREE.MathUtils.lerp(rot[0], 0, build), THREE.MathUtils.lerp(rot[1], 0, build) + Math.sin(build * Math.PI) * 0.6, THREE.MathUtils.lerp(rot[2], 0, build))
      tmpColor.lerpColors(rawColor, part.dark ? darkColor : woodColor, finish)
      m.color.copy(tmpColor)
      m.roughness = THREE.MathUtils.lerp(0.85, 0.45, finish)
    }
  })
  return (
    <>
      <lineSegments ref={wire} geometry={edges} position={part.final}>
        <lineBasicMaterial color={CHAMPAGNE} transparent opacity={0} />
      </lineSegments>
      <RoundedBox ref={solid} args={part.size} radius={0.012} smoothness={2} position={part.flat.pos} visible={false}>
        <meshStandardMaterial color={RAW} roughness={0.85} transparent opacity={0} />
      </RoundedBox>
    </>
  )
}

/** Text label as a sprite texture (no DOM portals, so unmounting the canvas is always safe). */
function makeLabelTexture(text: string) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.font = '500 28px Inter, Manrope, system-ui, sans-serif'
    ctx.fillStyle = CHAMPAGNE
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, c.width / 2, c.height / 2)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Dimension lines + labels for the measurement stage. */
function Dimensions({ progress }: { progress: MutableRefObject<number> }) {
  const line = useRef<THREE.LineSegments>(null)
  const matH = useRef<THREE.SpriteMaterial>(null)
  const matW = useRef<THREE.SpriteMaterial>(null)
  const texH = useMemo(() => makeLabelTexture('890 mm'), [])
  const texW = useMemo(() => makeLabelTexture('420 mm'), [])
  useEffect(() => () => { texH.dispose(); texW.dispose() }, [texH, texW])
  const geom = useMemo(() => {
    const pts: number[] = []
    const add = (a: number[], b: number[]) => pts.push(...a, ...b)
    add([-0.62, 0, -0.32], [-0.62, 1.23, -0.32]); add([-0.68, 0, -0.32], [-0.56, 0, -0.32]); add([-0.68, 1.23, -0.32], [-0.56, 1.23, -0.32])
    add([-0.38, 0, 0.62], [0.38, 0, 0.62]); add([-0.38, -0.06, 0.62], [-0.38, 0.06, 0.62]); add([0.38, -0.06, 0.62], [0.38, 0.06, 0.62])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  useFrame(() => {
    const p = progress.current
    const k = seg(p, 0.17, 0.3) * (1 - seg(p, 0.62, 0.72))
    if (line.current) { line.current.visible = k > 0.01; (line.current.material as THREE.LineBasicMaterial).opacity = k }
    if (matH.current) matH.current.opacity = k
    if (matW.current) matW.current.opacity = k
  })
  return (
    <group>
      <lineSegments ref={line} geometry={geom}><lineBasicMaterial color={CHAMPAGNE} transparent opacity={0} /></lineSegments>
      <sprite position={[-0.86, 0.62, -0.32]} scale={[0.56, 0.14, 1]}><spriteMaterial ref={matH} map={texH} transparent opacity={0} depthTest={false} /></sprite>
      <sprite position={[0, -0.17, 0.62]} scale={[0.56, 0.14, 1]}><spriteMaterial ref={matW} map={texW} transparent opacity={0} depthTest={false} /></sprite>
    </group>
  )
}

/** Material swatches (wood / MDF / laminate) and dowel fittings lined up on the bench. */
function BenchExtras({ progress }: { progress: MutableRefObject<number> }) {
  const swatches = useRef<THREE.Group>(null)
  const dowels = useRef<THREE.Group>(null)
  useFrame(() => {
    const p = progress.current
    const ks = easeOut(seg(p, 0.36, 0.48)) * (1 - seg(p, 0.62, 0.72))
    const kd = easeOut(seg(p, 0.5, 0.6)) * (1 - seg(p, 0.78, 0.86))
    if (swatches.current) { swatches.current.scale.setScalar(Math.max(0.001, ks)); swatches.current.visible = ks > 0.01 }
    if (dowels.current) { dowels.current.scale.setScalar(Math.max(0.001, kd)); dowels.current.visible = kd > 0.01 }
  })
  return (
    <>
      <group ref={swatches} position={[0.2, 0.04, 1.35]} visible={false}>
        {[WOOD, '#C8B79A', IVORY].map((c, i) => (
          <RoundedBox key={c} args={[0.22, 0.03, 0.22]} radius={0.01} position={[i * 0.28, 0, 0]}><meshStandardMaterial color={c} roughness={0.7} /></RoundedBox>
        ))}
      </group>
      <group ref={dowels} position={[1.3, 0.03, 0.2]} visible={false}>
        {Array.from({ length: 8 }).map((_, i) => (
          <mesh key={i} position={[0, 0, -0.45 + i * 0.13]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.012, 0.012, 0.16, 8]} /><meshStandardMaterial color={CHAMPAGNE} roughness={0.4} metalness={0.3} /></mesh>
        ))}
      </group>
    </>
  )
}

/** Fittings that appear at the joints during the final assembly stage. */
function Joints({ progress }: { progress: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const k = easeOut(seg(progress.current, 0.82, 0.94))
    if (!group.current) return
    group.current.visible = k > 0.01
    group.current.children.forEach((c, i) => c.scale.setScalar(Math.max(0.001, stagger(k, i, JOINTS.length, 0.6))))
  })
  return (
    <group ref={group} visible={false}>
      {JOINTS.map((pos, i) => (
        <mesh key={i} position={pos}><sphereGeometry args={[0.028, 12, 12]} /><meshStandardMaterial color={CHAMPAGNE} roughness={0.35} metalness={0.4} /></mesh>
      ))}
    </group>
  )
}

/** Blueprint top view → three-quarter view → closer finished view. */
function CameraRig({ progress }: { progress: MutableRefObject<number> }) {
  const { camera } = useThree()
  const target = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const p = progress.current
    const k1 = easeInOut(seg(p, 0.05, 0.45))
    const k2 = easeInOut(seg(p, 0.75, 1))
    tmpV.lerpVectors(CAM_A, CAM_B, k1).lerp(CAM_C, k2)
    camera.position.lerp(tmpV, 0.12)
    target.set(THREE.MathUtils.lerp(0.5, 0.05, k1), 0.55, 0.1)
    camera.lookAt(target)
  })
  return null
}

/** Lens shift: renders the scene offset to the right by `frac` of the width without changing perspective. */
function ViewShift({ frac }: { frac: number }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (frac > 0) cam.setViewOffset(size.width, size.height, -size.width * frac, 0, size.width, size.height)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()
    return () => { cam.clearViewOffset(); cam.updateProjectionMatrix() }
  }, [camera, size.width, size.height, frac])
  return null
}

function Scene({ animate, external }: { animate: boolean; external?: MutableRefObject<number> }) {
  const progress = useRef(external ? external.current : 1)
  const light = useRef<THREE.SpotLight>(null)
  useFrame((state) => {
    let goal: number
    if (external) goal = external.current
    else if (animate) {
      const t = state.clock.getElapsedTime() % 14 // 0→1 over 10s, hold 3s, quick reset
      goal = t < 10 ? t / 10 : t < 13 ? 1 : 0
    } else goal = 1
    progress.current += (goal - progress.current) * (Math.abs(goal - progress.current) > 0.5 ? 0.35 : 0.12)
    if (light.current) light.current.intensity = 0.4 + seg(progress.current, 0.8, 1) * 2.2
  })
  return (
    <group>
      <Grid position={[0, 0.001, 0]} args={[10, 10]} cellSize={0.2} cellThickness={0.5} cellColor="#3a5049" sectionSize={1} sectionThickness={0.9} sectionColor="#4f6b62" fadeDistance={7} fadeStrength={1.2} infiniteGrid />
      {PARTS.map((part, i) => <PartMesh key={i} part={part} index={i} progress={progress} />)}
      <Dimensions progress={progress} />
      <BenchExtras progress={progress} />
      <Joints progress={progress} />
      <spotLight ref={light} position={[1.5, 3.5, 2]} angle={0.5} penumbra={0.8} intensity={0.4} color="#FFE9C4" />
      <ContactShadows position={[0, 0.002, 0]} opacity={0.5} scale={5} blur={2.4} far={2.5} color={FOREST} />
      <CameraRig progress={progress} />
    </group>
  )
}

function Responsive({ animate, progressRef }: { animate: boolean; progressRef?: MutableRefObject<number> }) {
  const { size } = useThree()
  // Scroll mode: the copy sits on the left, so the model is lens-shifted into the right half on wide screens.
  const frac = progressRef ? (size.width > 1100 ? 0.17 : size.width > 760 ? 0.1 : 0) : 0
  return (
    <>
      <ViewShift frac={frac} />
      <Scene animate={animate} external={progressRef} />
    </>
  )
}

export default function FurnitureAssembly({ animate, progressRef }: { animate: boolean; progressRef?: MutableRefObject<number> }) {
  return (
    <Canvas dpr={COARSE ? 1 : [1, 1.5]} frameloop={animate || progressRef ? 'always' : 'demand'} camera={{ position: [2.4, 1.7, 2.8], fov: 34 }} gl={{ antialias: !COARSE, alpha: true, powerPreference: 'low-power' }} style={{ background: 'transparent' }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 5, 2]} intensity={1.1} color="#FFF6E5" />
      <directionalLight position={[-3, 2, -2]} intensity={0.35} />
      <Responsive animate={animate} progressRef={progressRef} />
    </Canvas>
  )
}
