import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Float, RoundedBox } from '@react-three/drei'
import { useRef, useState } from 'react'
import * as THREE from 'three'

const IVORY = '#F7F5F0'
const FOREST = '#163C35'
const CHAMPAGNE = '#C8AD7F'
const SAGE = '#E3EBE5'
const CHARCOAL = '#202725'
const GOLD_LIGHT = '#F8E9CB'
const EMERALD = '#34D399'

type CardType = 'language' | 'furniture' | 'tech'

function CardGlyph3D({ type }: { type: CardType }) {
  if (type === 'language') {
    // 3D Miniature Book & Bookmark
    return (
      <group position={[-0.48, 0.02, 0.04]} rotation={[0, 0.1, 0.08]}>
        <RoundedBox args={[0.26, 0.32, 0.04]} radius={0.01}>
          <meshStandardMaterial color={FOREST} roughness={0.4} />
        </RoundedBox>
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[0.2, 0.28]} />
          <meshStandardMaterial color={IVORY} roughness={0.8} />
        </mesh>
        <mesh position={[0.04, 0.12, 0.03]} rotation={[0, 0, -0.2]}>
          <planeGeometry args={[0.04, 0.14]} />
          <meshBasicMaterial color={CHAMPAGNE} />
        </mesh>
      </group>
    )
  }

  if (type === 'furniture') {
    // 3D Miniature Isometric Table/Stool
    return (
      <group position={[-0.48, 0.02, 0.04]} rotation={[0.4, 0.6, 0]}>
        <RoundedBox args={[0.26, 0.03, 0.22]} radius={0.008}>
          <meshStandardMaterial color={CHAMPAGNE} roughness={0.3} metalness={0.2} />
        </RoundedBox>
        {[[-0.09, -0.07], [0.09, -0.07], [-0.09, 0.07], [0.09, 0.07]].map(([x, z], i) => (
          <mesh key={i} position={[x, -0.08, z]}>
            <cylinderGeometry args={[0.012, 0.012, 0.14, 8]} />
            <meshStandardMaterial color={FOREST} roughness={0.5} />
          </mesh>
        ))}
      </group>
    )
  }

  // 3D Tech & Mathematics Grid Cube
  return (
    <group position={[-0.48, 0.02, 0.04]} rotation={[0.3, 0.4, 0.2]}>
      <RoundedBox args={[0.2, 0.2, 0.2]} radius={0.02}>
        <meshStandardMaterial color={FOREST} roughness={0.3} metalness={0.5} />
      </RoundedBox>
      <mesh position={[0, 0, 0.11]}>
        <circleGeometry args={[0.04, 16]} />
        <meshBasicMaterial color={EMERALD} />
      </mesh>
    </group>
  )
}

function CourseCardMesh({
  position,
  rotation,
  titleWidth = 0.72,
  badgeColor = CHAMPAGNE,
  accentColor = FOREST,
  hovered,
  onPointerOver,
  onPointerOut,
  type = 'language',
}: {
  position: [number, number, number]
  rotation: [number, number, number]
  titleWidth?: number
  badgeColor?: string
  accentColor?: string
  hovered: boolean
  onPointerOver: () => void
  onPointerOut: () => void
  type?: CardType
}) {
  const meshRef = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (!meshRef.current) return
    const targetY = hovered ? position[1] + 0.14 : position[1]
    meshRef.current.position.y = THREE.MathUtils.lerp(meshRef.current.position.y, targetY, delta * 6)
  })

  return (
    <group
      ref={meshRef}
      position={position}
      rotation={rotation}
      onPointerOver={(e) => { e.stopPropagation(); onPointerOver() }}
      onPointerOut={onPointerOut}
    >
      {/* High-grade Ceramic Card Body */}
      <RoundedBox args={[1.52, 1.04, 0.05]} radius={0.04} smoothness={4}>
        <meshStandardMaterial
          color={IVORY}
          roughness={0.18}
          metalness={0.06}
        />
      </RoundedBox>

      {/* Subtle Chamfer Border Highlight */}
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[1.46, 0.98]} />
        <meshBasicMaterial color={SAGE} opacity={0.4} transparent />
      </mesh>

      {/* Top category badge pill */}
      <mesh position={[-0.4, 0.34, 0.03]}>
        <planeGeometry args={[0.45, 0.12]} />
        <meshBasicMaterial color={badgeColor} />
      </mesh>

      {/* Glowing live status beacon */}
      <mesh position={[0.56, 0.34, 0.03]}>
        <circleGeometry args={[0.042, 16]} />
        <meshBasicMaterial color={EMERALD} />
      </mesh>
      <mesh position={[0.56, 0.34, 0.029]}>
        <circleGeometry args={[0.065, 16]} />
        <meshBasicMaterial color={EMERALD} opacity={0.3} transparent />
      </mesh>

      {/* 3D Distinctive Subject Iconography */}
      <CardGlyph3D type={type} />

      {/* Title & metadata bars (scaled proportionally next to glyph) */}
      <mesh position={[0.1, 0.1, 0.03]}>
        <planeGeometry args={[titleWidth, 0.08]} />
        <meshBasicMaterial color={CHARCOAL} />
      </mesh>

      <mesh position={[0.02, -0.04, 0.03]}>
        <planeGeometry args={[titleWidth * 0.75, 0.05]} />
        <meshBasicMaterial color={CHARCOAL} opacity={0.45} transparent />
      </mesh>

      {/* Schedule / Center tag pill */}
      <mesh position={[-0.04, -0.24, 0.03]}>
        <planeGeometry args={[0.68, 0.09]} />
        <meshBasicMaterial color={SAGE} />
      </mesh>

      {/* Price / subscription action tag */}
      <mesh position={[0.44, -0.24, 0.03]}>
        <planeGeometry args={[0.38, 0.09]} />
        <meshBasicMaterial color={accentColor} />
      </mesh>
    </group>
  )
}

function CentralSubscriptionRing({ animate }: { animate: boolean }) {
  const ringRef = useRef<THREE.Group>(null)
  const satellite1 = useRef<THREE.Mesh>(null)
  const satellite2 = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (!ringRef.current || !animate) return
    const t = state.clock.getElapsedTime()
    ringRef.current.rotation.z = t * 0.12
    ringRef.current.rotation.x = 0.5 + Math.sin(t * 0.25) * 0.06

    if (satellite1.current) {
      satellite1.current.position.x = Math.cos(t * 0.8) * 1.42
      satellite1.current.position.y = Math.sin(t * 0.8) * 1.42
    }
    if (satellite2.current) {
      satellite2.current.position.x = Math.cos(t * 0.8 + Math.PI) * 1.42
      satellite2.current.position.y = Math.sin(t * 0.8 + Math.PI) * 1.42
    }
  })

  return (
    <group ref={ringRef} position={[0, -0.05, -0.2]} rotation={[0.5, 0, 0]}>
      {/* Outer Golden Torus */}
      <mesh>
        <torusGeometry args={[1.42, 0.026, 24, 80]} />
        <meshStandardMaterial color={CHAMPAGNE} metalness={0.8} roughness={0.18} />
      </mesh>

      {/* Orbiting Satellite Dots representing active sessions */}
      <mesh ref={satellite1}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshBasicMaterial color={GOLD_LIGHT} />
      </mesh>
      <mesh ref={satellite2}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshBasicMaterial color={EMERALD} />
      </mesh>

      {/* Inner Emerald Accent Ring */}
      <mesh rotation={[0.4, 0.2, 0]}>
        <torusGeometry args={[1.16, 0.016, 16, 64]} />
        <meshStandardMaterial color={FOREST} metalness={0.4} roughness={0.3} />
      </mesh>

      {/* Central ILMORA Unified Hub Token */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.06, 32]} />
        <meshStandardMaterial color={FOREST} roughness={0.25} metalness={0.45} />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <ringGeometry args={[0.24, 0.34, 32]} />
        <meshBasicMaterial color={CHAMPAGNE} />
      </mesh>
      <mesh position={[0, 0, 0.036]}>
        <circleGeometry args={[0.14, 24]} />
        <meshBasicMaterial color={GOLD_LIGHT} />
      </mesh>
    </group>
  )
}

function FloatingOrb({ position, color, size = 0.1 }: { position: [number, number, number]; color: string; size?: number }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 20, 20]} />
      <meshStandardMaterial color={color} roughness={0.2} metalness={0.6} />
    </mesh>
  )
}

function Scene({ animate }: { animate: boolean }) {
  const rootGroup = useRef<THREE.Group>(null)
  const [hoveredCard, setHoveredCard] = useState<number | null>(null)

  useFrame((state, delta) => {
    if (!rootGroup.current) return
    if (animate) {
      const px = state.pointer.x * 0.45
      const py = state.pointer.y * 0.35
      rootGroup.current.rotation.y = THREE.MathUtils.lerp(rootGroup.current.rotation.y, px, delta * 3)
      rootGroup.current.rotation.x = THREE.MathUtils.lerp(rootGroup.current.rotation.x, -py, delta * 3)
    }
  })

  return (
    <group ref={rootGroup}>
      {/* Central ILMORA Subscription Core */}
      <CentralSubscriptionRing animate={animate} />

      {/* Orbiting / Floating Course Cards with distinct 3D identities */}
      <Float speed={animate ? 1.6 : 0} rotationIntensity={0.12} floatIntensity={0.28}>
        {/* Card 1 — Languages / General English */}
        <CourseCardMesh
          position={[-1.15, 0.35, 0.45]}
          rotation={[0.1, 0.25, -0.06]}
          titleWidth={0.7}
          badgeColor={CHAMPAGNE}
          accentColor={FOREST}
          type="language"
          hovered={hoveredCard === 0}
          onPointerOver={() => setHoveredCard(0)}
          onPointerOut={() => setHoveredCard(null)}
        />
      </Float>

      <Float speed={animate ? 1.4 : 0} rotationIntensity={0.15} floatIntensity={0.32}>
        {/* Card 2 — Bazis 3D Furniture & Architecture */}
        <CourseCardMesh
          position={[1.2, 0.55, 0.15]}
          rotation={[-0.05, -0.22, 0.08]}
          titleWidth={0.65}
          badgeColor="#4E6E68"
          accentColor={CHAMPAGNE}
          type="furniture"
          hovered={hoveredCard === 1}
          onPointerOver={() => setHoveredCard(1)}
          onPointerOut={() => setHoveredCard(null)}
        />
      </Float>

      <Float speed={animate ? 1.8 : 0} rotationIntensity={0.1} floatIntensity={0.24}>
        {/* Card 3 — Mathematics & IT */}
        <CourseCardMesh
          position={[0.25, -0.65, 0.6]}
          rotation={[0.08, -0.12, 0.04]}
          titleWidth={0.75}
          badgeColor={SAGE}
          accentColor={FOREST}
          type="tech"
          hovered={hoveredCard === 2}
          onPointerOver={() => setHoveredCard(2)}
          onPointerOut={() => setHoveredCard(null)}
        />
      </Float>

      {/* Floating decorative ambient beads */}
      <Float speed={animate ? 2.2 : 0} floatIntensity={0.5}>
        <FloatingOrb position={[-1.8, -0.3, 0.2]} color={CHAMPAGNE} size={0.07} />
        <FloatingOrb position={[1.75, -0.4, 0.3]} color={FOREST} size={0.06} />
        <FloatingOrb position={[0.85, 1.1, -0.2]} color={GOLD_LIGHT} size={0.05} />
        <FloatingOrb position={[-0.9, 1.0, 0.1]} color={SAGE} size={0.05} />
      </Float>

      {/* Soft Ground Contact Shadow */}
      <ContactShadows
        position={[0, -1.25, 0]}
        opacity={0.45}
        scale={6.5}
        blur={2.6}
        far={3.5}
        color={FOREST}
      />
    </group>
  )
}

export default function Hero3DCanvas({ animate }: { animate: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={animate ? 'always' : 'demand'}
      camera={{ position: [0, 0.2, 4.2], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 4]} intensity={1.6} color="#FFF8ED" />
      <directionalLight position={[-4, 3, 2]} intensity={0.8} color="#D8E8E2" />
      <pointLight position={[0, 0.2, 1.8]} intensity={1.2} color="#FFE6A3" distance={5} />
      <Scene animate={animate} />
    </Canvas>
  )
}
