import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { SiteCopy } from '../i18n'
import { Wordmark } from './Logo'
import { GithubIcon } from './icons'
import { REPO_URL } from '../lib/platform'

interface NavProps {
  copy: SiteCopy
}

export function Nav({ copy }: NavProps) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { href: '#features', label: copy.nav.features },
    { href: '#quickstart', label: copy.nav.quickstart },
    { href: '#download', label: copy.nav.download },
    { href: '#faq', label: copy.nav.faq },
  ]

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-line bg-paper/85 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <a href="#top" className="shrink-0" aria-label="Greeneek Desktop home">
          <Wordmark />
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map(l => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-mute transition-colors hover:bg-paper-deep hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-deep sm:inline-flex"
          >
            <GithubIcon className="h-4 w-4" />
            <span className="hidden lg:inline">{copy.nav.github}</span>
          </a>

          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white text-ink md:hidden"
            onClick={() => setOpen(v => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* mobile menu */}
      {open && (
        <div className="border-b border-line bg-paper/95 backdrop-blur-xl md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col px-5 py-3">
            {links.map(l => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-3 text-base font-medium text-ink-soft hover:bg-paper-deep"
              >
                {l.label}
              </a>
            ))}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-ink px-3 py-3 text-sm font-semibold text-white"
            >
              <GithubIcon className="h-4 w-4" /> {copy.nav.github}
            </a>
          </nav>
        </div>
      )}
    </header>
  )
}
