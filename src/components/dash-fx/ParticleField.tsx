/**
 * dash-fx — ParticleField: a small ambient particle-network for the
 * dashboard header. Sparse near-black nodes drift slowly and link up;
 * a few accent-orange nodes echo the brand. Pure atmosphere — it is
 * pointer-events-none, lazy (three ships in its own chunk), viewport-gated
 * and replaced by a static SVG poster under reduced motion.
 */
import { LazyThree } from '@/components/fx'
import { mulberry } from '@/lib/demo'

/** Static poster rendered under reduced motion (and before three arrives). */
function Poster() {
  return (
    <svg className="h-full w-full" viewBox="0 0 200 64" aria-hidden="true">
      <g stroke="#171310" strokeOpacity="0.18" strokeWidth="1">
        <line x1="24" y1="40" x2="66" y2="18" />
        <line x1="66" y1="18" x2="112" y2="34" />
        <line x1="112" y1="34" x2="152" y2="14" />
        <line x1="112" y1="34" x2="150" y2="50" />
        <line x1="66" y1="18" x2="88" y2="52" />
      </g>
      <g fill="#171310" fillOpacity="0.5">
        <circle cx="24" cy="40" r="2.4" />
        <circle cx="66" cy="18" r="2.4" />
        <circle cx="88" cy="52" r="2.4" />
        <circle cx="150" cy="50" r="2.4" />
      </g>
      <circle cx="112" cy="34" r="3" fill="#ff4d00" />
      <circle cx="152" cy="14" r="2.4" fill="#ff4d00" />
    </svg>
  )
}

const COUNT = 40
const LINK_DIST = 7.5
const BOUNDS = { x: 19, y: 6.5, z: 4 }

// deterministic layout (seeded PRNG at module scope — render stays pure);
// setup copies these templates so viewport re-mounts restart identically
const POS_T = new Float32Array(COUNT * 3)
const VEL_T = new Float32Array(COUNT * 3)
const ACCENT_T = new Float32Array(5 * 3)
{
  const rnd = mulberry(20240521)
  for (let i = 0; i < COUNT; i++) {
    POS_T[i * 3] = (rnd() * 2 - 1) * BOUNDS.x
    POS_T[i * 3 + 1] = (rnd() * 2 - 1) * BOUNDS.y
    POS_T[i * 3 + 2] = (rnd() * 2 - 1) * BOUNDS.z
    VEL_T[i * 3] = (rnd() * 2 - 1) * 0.012
    VEL_T[i * 3 + 1] = (rnd() * 2 - 1) * 0.009
    VEL_T[i * 3 + 2] = (rnd() * 2 - 1) * 0.006
  }
  for (let i = 0; i < 5; i++) {
    ACCENT_T[i * 3] = (rnd() * 2 - 1) * BOUNDS.x
    ACCENT_T[i * 3 + 1] = (rnd() * 2 - 1) * BOUNDS.y
    ACCENT_T[i * 3 + 2] = (rnd() * 2 - 1) * BOUNDS.z
  }
}

export default function ParticleField({ className }: { className?: string }) {
  return (
    <LazyThree className={className} fallback={<Poster />} rootMargin="100px">
      {(THREE, canvas) => {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setClearColor(0x000000, 0)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
        camera.position.set(0, 0, 26)

        // node positions + slow drift velocities (copied from the seeded template)
        const pos = new Float32Array(POS_T)
        const vel = new Float32Array(VEL_T)
        const ptsGeo = new THREE.BufferGeometry()
        ptsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        const pts = new THREE.Points(
          ptsGeo,
          new THREE.PointsMaterial({ color: 0x171310, size: 0.34, transparent: true, opacity: 0.6 }),
        )
        scene.add(pts)

        // a few accent nodes drifting as brighter points
        const accentPos = new Float32Array(ACCENT_T)
        const accentGeo = new THREE.BufferGeometry()
        accentGeo.setAttribute('position', new THREE.BufferAttribute(accentPos, 3))
        const accentPts = new THREE.Points(
          accentGeo,
          new THREE.PointsMaterial({ color: 0xff4d00, size: 0.55, transparent: true, opacity: 0.9 }),
        )
        scene.add(accentPts)

        // link lines — preallocated segment buffer, rewritten each frame
        const maxSeg = COUNT * 5
        const linePos = new Float32Array(maxSeg * 6)
        const lineGeo = new THREE.BufferGeometry()
        lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
        const lines = new THREE.LineSegments(
          lineGeo,
          new THREE.LineBasicMaterial({ color: 0x171310, transparent: true, opacity: 0.16 }),
        )
        scene.add(lines)

        const resize = () => {
          const w = canvas.clientWidth || 1
          const h = canvas.clientHeight || 1
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
        resize()
        window.addEventListener('resize', resize)

        let raf = 0
        const tick = () => {
          raf = requestAnimationFrame(tick)
          // drift + soft-bounce at bounds
          for (let i = 0; i < COUNT; i++) {
            for (let a = 0; a < 3; a++) {
              const k = i * 3 + a
              pos[k] += vel[k]
              const b = a === 0 ? BOUNDS.x : a === 1 ? BOUNDS.y : BOUNDS.z
              if (pos[k] > b || pos[k] < -b) vel[k] *= -1
            }
          }
          ptsGeo.attributes.position.needsUpdate = true

          // rebuild links between near nodes
          let seg = 0
          for (let i = 0; i < COUNT && seg < maxSeg; i++) {
            for (let j = i + 1; j < COUNT && seg < maxSeg; j++) {
              const dx = pos[i * 3] - pos[j * 3]
              const dy = pos[i * 3 + 1] - pos[j * 3 + 1]
              const dz = pos[i * 3 + 2] - pos[j * 3 + 2]
              if (dx * dx + dy * dy + dz * dz < LINK_DIST * LINK_DIST) {
                linePos.set(
                  [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]],
                  seg * 6,
                )
                seg++
              }
            }
          }
          lineGeo.setDrawRange(0, seg * 2)
          lineGeo.attributes.position.needsUpdate = true

          renderer.render(scene, camera)
        }
        tick()

        return () => {
          cancelAnimationFrame(raf)
          window.removeEventListener('resize', resize)
          ptsGeo.dispose()
          accentGeo.dispose()
          lineGeo.dispose()
          pts.material.dispose()
          accentPts.material.dispose()
          lines.material.dispose()
          renderer.dispose()
        }
      }}
    </LazyThree>
  )
}
