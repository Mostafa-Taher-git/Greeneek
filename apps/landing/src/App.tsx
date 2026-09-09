import { copy } from './i18n'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { Showcase } from './components/Showcase'
import { Features } from './components/Features'
import { QuickStart } from './components/QuickStart'
import { Download } from './components/Download'
import { StarCallout } from './components/StarCallout'
import { Faq } from './components/Faq'
import { Footer } from './components/Footer'

export default function App() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <Nav copy={copy} />
      <main>
        <Hero copy={copy} />
        <Showcase copy={copy} />
        <Features copy={copy} />
        <QuickStart copy={copy} />
        <Download copy={copy} />
        <StarCallout copy={copy} />
        <Faq copy={copy} />
      </main>
      <Footer copy={copy} />
    </div>
  )
}
