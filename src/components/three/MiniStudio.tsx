import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Float, RoundedBox } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'

const IVORY = '#F7F5F0'
const FOREST = '#163C35'
const CHAMPAGNE = '#C8AD7F'
const SAGE = '#E3EBE5'
const WOOD = '#A67C52'

function Book({ position, color, rotation = 0 }: { position: [number, number, number]; color: string; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <RoundedBox args={[0.42, 0.06, 0.3]} radius={0.01} smoothness={2}><meshStandardMaterial color={color} roughness={0.7} /></RoundedBox>
      <mesh position={[0, 0.031, 0]}><boxGeometry args={[0.4, 0.002, 0.28]} /><meshStandardMaterial color={IVORY} roughness={0.9} /></mesh>
    </group>
  )
}

function Lamp() {
  return (
    <group position={[-0.95, 0.3, -0.3]}>
      <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.1, 0.12, 0.04, 24]} /><meshStandardMaterial color={CHAMPAGNE} metalness={0.6} roughness={0.3} /></mesh>
      <mesh position={[0, 0.35, 0]}><cylinderGeometry args={[0.012, 0.012, 0.66, 12]} /><meshStandardMaterial color={CHAMPAGNE} metalness={0.6} roughness={0.3} /></mesh>
      <mesh position={[0.12, 0.66, 0]} rotation={[0, 0, -0.5]}><coneGeometry args={[0.16, 0.18, 24, 1, true]} /><meshStandardMaterial color={FOREST} side={THREE.DoubleSide} roughness={0.5} /></mesh>
      <pointLight position={[0.14, 0.58, 0]} intensity={1.6} distance={2.2} color="#FFE9C4" />
    </group>
  )
}

function Scene({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null)
  const panel = useRef<THREE.Mesh>(null)
  useFrame((state) => {
    if (!group.current) return
    if (animate) {
      const t = state.clock.getElapsedTime()
      group.current.rotation.y = Math.sin(t * 0.25) * 0.35 - 0.4
      if (panel.current) panel.current.position.y = 1.05 + Math.sin(t * 0.9) * 0.03
    } else {
      group.current.rotation.y = -0.4
    }
  })
  return (
    <group ref={group} position={[0, -0.45, 0]}>
      {/* Floor tile */}
      <RoundedBox args={[3.2, 0.08, 2.2]} radius={0.04} position={[0, -0.04, 0]}><meshStandardMaterial color={SAGE} roughness={0.95} /></RoundedBox>
      {/* Desk */}
      <RoundedBox args={[2.1, 0.06, 0.9]} radius={0.02} position={[0, 0.5, 0]}><meshStandardMaterial color={WOOD} roughness={0.55} /></RoundedBox>
      {[[-0.95, -0.35], [0.95, -0.35], [-0.95, 0.35], [0.95, 0.35]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.24, z]}><cylinderGeometry args={[0.025, 0.025, 0.48, 12]} /><meshStandardMaterial color={FOREST} roughness={0.6} /></mesh>
      ))}
      {/* Books */}
      <Book position={[0.55, 0.56, 0.1]} color={FOREST} />
      <Book position={[0.55, 0.62, 0.1]} color={CHAMPAGNE} rotation={0.18} />
      <Book position={[0.55, 0.68, 0.1]} color="#4E6E68" rotation={-0.12} />
      {/* Notebook + pencil */}
      <RoundedBox args={[0.5, 0.02, 0.36]} radius={0.01} position={[-0.15, 0.54, 0.15]} rotation={[0, 0.2, 0]}><meshStandardMaterial color={IVORY} roughness={0.9} /></RoundedBox>
      <mesh position={[-0.05, 0.56, 0.32]} rotation={[0, 0.9, Math.PI / 2]}><cylinderGeometry args={[0.012, 0.012, 0.4, 8]} /><meshStandardMaterial color={CHAMPAGNE} roughness={0.5} /></mesh>
      <Lamp />
      {/* Floating lesson panel */}
      <Float speed={animate ? 1.2 : 0} rotationIntensity={0.15} floatIntensity={0.35}>
        <group position={[0.15, 1.2, -0.35]}>
          <RoundedBox ref={panel} args={[1.1, 0.68, 0.04]} radius={0.03}><meshStandardMaterial color={IVORY} roughness={0.8} /></RoundedBox>
          <mesh position={[-0.25, 0.14, 0.03]}><planeGeometry args={[0.45, 0.05]} /><meshBasicMaterial color={FOREST} /></mesh>
          <mesh position={[-0.12, 0.02, 0.03]}><planeGeometry args={[0.7, 0.03]} /><meshBasicMaterial color={CHAMPAGNE} /></mesh>
          <mesh position={[-0.2, -0.06, 0.03]}><planeGeometry args={[0.55, 0.03]} /><meshBasicMaterial color={CHAMPAGNE} /></mesh>
          <mesh position={[0.32, -0.16, 0.03]}><circleGeometry args={[0.09, 32]} /><meshBasicMaterial color={FOREST} /></mesh>
          <mesh position={[0.34, -0.16, 0.035]}><shapeGeometry args={[triangle()]} /><meshBasicMaterial color={IVORY} /></mesh>
        </group>
      </Float>
      {/* Plant */}
      <group position={[1.15, 0.3, 0.55]}>
        <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[0.11, 0.09, 0.2, 20]} /><meshStandardMaterial color={IVORY} roughness={0.9} /></mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[Math.cos(i * 1.25) * 0.05, 0.3 + i * 0.03, Math.sin(i * 1.25) * 0.05]} rotation={[Math.cos(i) * 0.5, i, Math.sin(i) * 0.4]}>
            <sphereGeometry args={[0.07, 12, 12]} /><meshStandardMaterial color={i % 2 ? '#4E6E68' : FOREST} roughness={0.8} />
          </mesh>
        ))}
      </group>
      <ContactShadows position={[0, 0.001, 0]} opacity={0.35} scale={5} blur={2.4} far={2} color={FOREST} />
    </group>
  )
}

function triangle() {
  const s = new THREE.Shape()
  s.moveTo(-0.03, -0.04); s.lineTo(0.045, 0); s.lineTo(-0.03, 0.04); s.closePath()
  return s
}

export default function MiniStudio({ animate }: { animate: boolean }) {
  return (
    <Canvas dpr={[1, 1.5]} frameloop={animate ? 'always' : 'demand'} camera={{ position: [2.6, 1.9, 3.1], fov: 34 }} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }} style={{ background: 'transparent' }}>
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 2]} intensity={1.4} color="#FFF6E5" />
      <directionalLight position={[-3, 2, -2]} intensity={0.4} color={SAGE} />
      <Scene animate={animate} />
    </Canvas>
  )
}
