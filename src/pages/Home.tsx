import { useRef } from 'react'
import Navbar from '@/sections/Navbar'
import FloatingWidget from '@/components/widget/FloatingWidget'
import Hero from '@/sections/Hero'
import Playground from '@/sections/Playground'
import Workforce from '@/sections/Workforce'
import Capabilities from '@/sections/Capabilities'
import Providers from '@/sections/Providers'
import Integrate from '@/sections/Integrate'
import Security from '@/sections/Security'
import OpenSource from '@/sections/OpenSource'
import Pricing from '@/sections/Pricing'
import Footer from '@/sections/Footer'
import { gsap, useGsap } from '@/lib/anim'
import ScrollToTop from '@/components/site-fx/ScrollToTop'

export default function Home() {
  const mainRef = useRef<HTMLElement>(null)

  // Scroll choreography — every "Fig." chapter assembles itself as you scroll.
  // All reveals are one-shot (once:true), transform+opacity only, so mobile
  // scrolling stays on the compositor. Sections with their own choreography
  // (Capabilities scan-line, Pricing stamp, Playground binder-flip, Hero)
  // keep it — we only add the shared fade-rise layer here.
  useGsap(mainRef, () => {
    gsap.utils.toArray<HTMLElement>('main section:not(#top)').forEach((sec) => {
      const label = sec.querySelector('.spec-label')
      const h2 = sec.querySelector('h2')
      if (label) {
        gsap.from(label, {
          x: -24,
          opacity: 0,
          duration: 0.55,
          ease: 'power3.out',
          scrollTrigger: { trigger: label, start: 'top 88%', once: true },
        })
      }
      if (h2) {
        gsap.from(h2, {
          y: 42,
          opacity: 0,
          duration: 0.75,
          delay: 0.08,
          ease: 'power4.out',
          scrollTrigger: { trigger: h2, start: 'top 88%', once: true },
        })
      }
      // figure cards + framed panels rise as each one enters the viewport
      sec.querySelectorAll('.hard-shadow, .hard-shadow-sm').forEach((el) => {
        gsap.from(el, {
          y: 26,
          opacity: 0,
          duration: 0.6,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 92%', once: true },
        })
      })
    })
  })

  return (
    <div className="vt-page min-h-screen bg-background">
      <ScrollToTop />
      <Navbar />
      <main ref={mainRef}>
        <Hero />
        <Playground />
        <Workforce />
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
