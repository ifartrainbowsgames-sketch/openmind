import { useRef } from 'react'
import Navbar from '@/sections/Navbar'
import FloatingWidget from '@/components/widget/FloatingWidget'
import Hero from '@/sections/Hero'
import Playground from '@/sections/Playground'
import Capabilities from '@/sections/Capabilities'
import Providers from '@/sections/Providers'
import Integrate from '@/sections/Integrate'
import Security from '@/sections/Security'
import OpenSource from '@/sections/OpenSource'
import Pricing from '@/sections/Pricing'
import Footer from '@/sections/Footer'
import { gsap, useGsap } from '@/lib/anim'

export default function Home() {
  const mainRef = useRef<HTMLElement>(null)

  // Section machinery — every "Fig." chapter assembles itself as you scroll.
  // Scrubbed, so scrolling back up reverses the press.
  useGsap(mainRef, () => {
    gsap.utils.toArray<HTMLElement>('main section:not(#top)').forEach((sec) => {
      const label = sec.querySelector('.spec-label')
      const h2 = sec.querySelector('h2')
      if (label || h2) {
        const tl = gsap.timeline({
          scrollTrigger: { trigger: sec, start: 'top 82%', end: 'top 38%', scrub: 1 },
        })
        if (label) tl.from(label, { x: -36, opacity: 0, ease: 'none' }, 0)
        if (h2) {
          tl.from(
            h2,
            { y: 46, opacity: 0, clipPath: 'inset(100% 0% -10% 0%)', ease: 'none' },
            0.08,
          )
        }
      }
      // letterpress settle — hard shadows "press down" as cards arrive
      sec.querySelectorAll('.hard-shadow, .hard-shadow-sm').forEach((el) => {
        gsap.from(el, {
          boxShadow: '0px 0px 0 0 rgba(23,20,15,0)',
          y: 6,
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'top 92%', end: 'top 62%', scrub: 1 },
        })
      })
    })
  })

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main ref={mainRef}>
        <Hero />
        <Playground />
        <Capabilities />
        <Providers />
        <Integrate />
        <Security />
        <OpenSource />
        <Pricing />
      </main>
      <Footer />
      <FloatingWidget />
    </div>
  )
}
