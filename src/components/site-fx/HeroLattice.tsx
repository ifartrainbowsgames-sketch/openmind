/**
 * HeroLattice — abstract 3D accent for the Home hero.
 *
 * A slowly tumbling point-cloud network: ~130 near-black nodes in a
 * flattened ellipsoid shell, nearest-neighbour edges, every 9th node
 * picked out in the brand accent (#ff4d00). It echoes the agent-workforce
 * org graph without illustrating anything literally.
 *
 * Performance contract:
 * - < 1k vertices total, one draw call per primitive (3 total).
 * - devicePixelRatio capped at 2; alpha renderer over the cream hero.
 * - LazyThree owns the lifecycle: three.js is dynamic-imported on viewport
 *   entry, rendering pauses offscreen, and the cleanup below disposes
 *   everything on unmount. Reduced motion renders the static SVG fallback.
 *
 * The host must be explicitly sized by the caller (absolute inset-0).
 */
import { LazyThree } from '@/components/fx'

/** Deterministic PRNG so the lattice is identical on every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NODE_COUNT = 130
const ACCENT_EVERY = 9
const LINK_DIST = 2.55
const MAX_LINKS_PER_NODE = 3

/** Static reduced-motion fallback: a fixed line-art lattice in brand inks. */
function LatticeFallback() {
  const dots: Array<[number, number, boolean]> = [
    [18, 30, false], [44, 14, false], [72, 26, true], [96, 10, false],
    [120, 30, false], [146, 16, false], [34, 58, false], [64, 50, false],
    [92, 62, true], [122, 52, false], [150, 66, false], [20, 88, false],
    [50, 82, false], [80, 94, false], [110, 84, true], [140, 96, false],
    [36, 116, false], [68, 122, false], [100, 112, false], [130, 124, false],
  ]
  const links: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [2, 4], [3, 5], [4, 5], [0, 6], [1, 7],
    [2, 8], [4, 9], [5, 10], [6, 7], [7, 8], [8, 9], [9, 10], [6, 11],
    [7, 12], [8, 14], [9, 13], [10, 15], [11, 12], [12, 13], [13, 14],
    [14, 15], [12, 17], [13, 18], [14, 19], [11, 16], [16, 17], [17, 18],
    [18, 19],
  ]
  return (
    <svg
      className="h-full w-full opacity-50"
      viewBox="0 0 170 140"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {links.map(([a, b], i) => (
        <line
          key={i}
          x1={dots[a][0]}
          y1={dots[a][1]}
          x2={dots[b][0]}
          y2={dots[b][1]}
          stroke="#171310"
          strokeOpacity="0.22"
          strokeWidth="0.75"
        />
      ))}
      {dots.map(([x, y, accent], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={accent ? 2.4 : 1.6}
          fill={accent ? '#ff4d00' : '#171310'}
          fillOpacity={accent ? 1 : 0.75}
        />
      ))}
    </svg>
  )
}

export interface HeroLatticeProps {
  /** Classes for the LazyThree host — give it an explicit size. */
  className?: string
}

export default function HeroLattice({ className }: HeroLatticeProps) {
  return (
    <LazyThree className={className} fallback={<LatticeFallback />} rootMargin="120px">
      {(THREE, canvas) => {
        const host = canvas.parentElement
        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: true,
          powerPreference: 'low-power',
        })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.setClearColor(0x000000, 0)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
        camera.position.set(0, 0, 14)

        const group = new THREE.Group()
        group.rotation.x = 0.32
        scene.add(group)

        // nodes — random directions, flattened shell (wide, shallow in Y)
        const rand = mulberry32(20250601)
        const nodes: import('three').Vector3[] = []
        for (let i = 0; i < NODE_COUNT; i++) {
          const theta = rand() * Math.PI * 2
          const phi = Math.acos(2 * rand() - 1)
          const r = 3.6 + rand() * 2.6
          nodes.push(
            new THREE.Vector3(
              Math.sin(phi) * Math.cos(theta) * r * 1.45,
              Math.cos(phi) * r * 0.62,
              Math.sin(phi) * Math.sin(theta) * r,
            ),
          )
        }

        // split into plain vs accent point clouds
        const plain: number[] = []
        const accent: number[] = []
        nodes.forEach((n, i) => {
          const bucket = i % ACCENT_EVERY === 0 ? accent : plain
          bucket.push(n.x, n.y, n.z)
        })
        const plainGeo = new THREE.BufferGeometry()
        plainGeo.setAttribute('position', new THREE.Float32BufferAttribute(plain, 3))
        const plainMat = new THREE.PointsMaterial({
          color: 0x171310,
          size: 0.1,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.85,
        })
        group.add(new THREE.Points(plainGeo, plainMat))

        const accentGeo = new THREE.BufferGeometry()
        accentGeo.setAttribute('position', new THREE.Float32BufferAttribute(accent, 3))
        const accentMat = new THREE.PointsMaterial({
          color: 0xff4d00,
          size: 0.17,
          sizeAttenuation: true,
          transparent: true,
          opacity: 1,
        })
        group.add(new THREE.Points(accentGeo, accentMat))

        // edges — nearest neighbours, capped degree
        const segs: number[] = []
        const degree = new Array<number>(NODE_COUNT).fill(0)
        for (let i = 0; i < NODE_COUNT; i++) {
          for (let j = i + 1; j < NODE_COUNT; j++) {
            if (degree[i] >= MAX_LINKS_PER_NODE) break
            if (degree[j] >= MAX_LINKS_PER_NODE) continue
            if (nodes[i].distanceTo(nodes[j]) < LINK_DIST) {
              segs.push(nodes[i].x, nodes[i].y, nodes[i].z, nodes[j].x, nodes[j].y, nodes[j].z)
              degree[i] += 1
              degree[j] += 1
            }
          }
        }
        const lineGeo = new THREE.BufferGeometry()
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3))
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x171310,
          transparent: true,
          opacity: 0.2,
        })
        group.add(new THREE.LineSegments(lineGeo, lineMat))

        const resize = () => {
          if (!host) return
          const w = host.clientWidth || 1
          const h = host.clientHeight || 1
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
        const ro = new ResizeObserver(resize)
        if (host) ro.observe(host)
        resize()

        let raf = 0
        const loop = (t: number) => {
          raf = requestAnimationFrame(loop)
          // slow tumble + a whisper of breathing — reads calm, not flashy
          group.rotation.y = t * 0.00011
          group.rotation.x = 0.32 + Math.sin(t * 0.00021) * 0.045
          renderer.render(scene, camera)
        }
        raf = requestAnimationFrame(loop)

        return () => {
          cancelAnimationFrame(raf)
          ro.disconnect()
          plainGeo.dispose()
          accentGeo.dispose()
          lineGeo.dispose()
          plainMat.dispose()
          accentMat.dispose()
          lineMat.dispose()
          renderer.dispose()
        }
      }}
    </LazyThree>
  )
}
