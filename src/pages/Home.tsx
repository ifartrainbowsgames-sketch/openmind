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

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
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
