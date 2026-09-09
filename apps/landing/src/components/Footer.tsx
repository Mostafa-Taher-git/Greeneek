import { AlertTriangle } from 'lucide-react'
import { SiteCopy } from '../i18n'
import { Wordmark } from './Logo'
import { GithubIcon } from './icons'
import {
  DEV_DOCS_URL,
  DOCS_URL,
  ISSUES_URL,
  LICENSE_URL,
  PLUGINS_URL,
  RELEASES_URL,
  REPO_URL,
} from '../lib/platform'

export function Footer({ copy }: { copy: SiteCopy }) {
  const cols = [
    {
      title: copy.footer.product,
      links: [
        { label: copy.nav.download, href: '#download' },
        { label: copy.nav.features, href: '#features' },
        { label: copy.nav.quickstart, href: '#quickstart' },
        { label: copy.nav.faq, href: '#faq' },
      ],
    },
    {
      title: copy.footer.resources,
      links: [
        { label: copy.footer.docs, href: DOCS_URL },
        { label: copy.footer.devDocs, href: DEV_DOCS_URL },
        { label: copy.footer.releases, href: RELEASES_URL },
        { label: copy.footer.license, href: LICENSE_URL },
      ],
    },
    {
      title: copy.footer.community,
      links: [
        { label: copy.footer.issues, href: ISSUES_URL },
        { label: copy.footer.plugins, href: PLUGINS_URL },
        { label: copy.nav.github, href: REPO_URL },
      ],
    },
  ]

  return (
    <footer className="border-t border-line bg-white/60">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <Wordmark />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-ink-mute">
              {copy.footer.tagline}
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-all hover:border-ink-faint hover:shadow-card"
            >
              <GithubIcon className="h-4 w-4" />
              Mostafa-Taher-git/Greeneek
            </a>
          </div>

          {cols.map(col => (
            <div key={col.title} className="md:col-span-2">
              <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-ink-faint">
                {col.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map(l => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      target={l.href.startsWith('http') ? '_blank' : undefined}
                      rel={
                        l.href.startsWith('http') ? 'noreferrer' : undefined
                      }
                      className="text-sm text-ink-mute transition-colors hover:text-brand"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 rounded-2xl border border-line bg-paper px-5 py-4 sm:px-6">
          <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-faint">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <span>{copy.footer.disclaimer}</span>
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-line-soft pt-8 text-[13px] text-ink-faint sm:flex-row">
          <p>{copy.footer.rights}</p>
          <p>{copy.footer.preview}</p>
        </div>
      </div>
    </footer>
  )
}
