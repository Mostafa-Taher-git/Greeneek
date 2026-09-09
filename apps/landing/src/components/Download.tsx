import { useRef } from 'react'
import { ArrowUpRight, AppWindow, Download as DownloadIcon, Package, TerminalSquare } from 'lucide-react'
import { useInView } from '../lib/useInView'
import { SiteCopy } from '../i18n'
import { download, RELEASES_URL } from '../lib/platform'

export function Download({ copy }: { copy: SiteCopy }) {
  const headRef = useRef<HTMLDivElement>(null)
  const headVisible = useInView(headRef)

  return (
    <section id="download" className="scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div
          ref={headRef}
          className={`reveal ${headVisible ? 'is-visible' : ''} max-w-2xl`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand">
            {copy.download.eyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-5xl">
            {copy.download.title}
          </h2>
          <p className="mt-4 text-base text-ink-mute sm:text-lg">
            {copy.download.sub}
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {/* Windows */}
          <PlatformCard
            index={0}
            icon={<AppWindow className="h-6 w-6" />}
            title={copy.download.windows}
            arch={copy.download.windowsArch}
            options={[
              { label: copy.download.installer, href: download.windowsInstaller, primary: true },
              { label: copy.download.portable, href: download.windowsPortable },
            ]}
          />

          {/* Linux */}
          <PlatformCard
            index={1}
            icon={<Package className="h-6 w-6" />}
            title={copy.download.linux}
            arch={copy.download.linuxArch}
            options={[
              { label: copy.download.deb, href: download.linuxDeb, primary: true },
              { label: copy.download.appimage, href: download.linuxAppImage },
            ]}
          />

          {/* Any platform / npm */}
          <PlatformCard
            index={2}
            icon={<TerminalSquare className="h-6 w-6" />}
            title={copy.download.any}
            arch="npm"
            desc={copy.download.anyDesc}
            options={[
              { label: copy.download.run, href: '#quickstart', primary: true },
            ]}
            dark
          />
        </div>

        <div className="mt-6 flex justify-center">
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-5 py-2.5 text-sm font-semibold text-ink-soft transition-all hover:border-ink-faint hover:shadow-card"
          >
            {copy.download.allReleases}
            <ArrowUpRight className="h-4 w-4 text-ink-faint" />
          </a>
        </div>
      </div>
    </section>
  )
}

interface Option {
  label: string
  href: string
  primary?: boolean
}

function PlatformCard({
  icon,
  title,
  arch,
  desc,
  options,
  index,
  dark,
}: {
  icon: React.ReactNode
  title: string
  arch: string
  desc?: string
  options: Option[]
  index: number
  dark?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} flex flex-col rounded-2xl border p-7 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-pop ${
        dark
          ? 'border-ink bg-ink text-white'
          : 'border-line bg-white'
      }`}
      style={{ transitionDelay: `${index * 100}ms` }}
    >
      <div className="flex items-start justify-between">
        <div
          className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${
            dark ? 'bg-white/10 text-brand-tint' : 'bg-brand-tint text-brand-strong'
          }`}
        >
          {icon}
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
            dark ? 'bg-white/10 text-white/70' : 'bg-paper-deep text-ink-mute'
          }`}
        >
          {arch}
        </span>
      </div>

      <h3 className="mt-5 text-xl font-bold tracking-tight">{title}</h3>
      {desc && (
        <p className={`mt-2 text-sm leading-relaxed ${dark ? 'text-white/60' : 'text-ink-mute'}`}>
          {desc}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2.5">
        {options.map(o => (
          <a
            key={o.label}
            href={o.href}
            target={o.href.startsWith('http') ? '_blank' : undefined}
            rel={o.href.startsWith('http') ? 'noreferrer' : undefined}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
              o.primary
                ? 'bg-brand text-white hover:bg-brand-strong'
                : dark
                  ? 'border border-white/20 text-white/85 hover:bg-white/10'
                  : 'border border-line text-ink-soft hover:bg-paper-deep'
            }`}
          >
            {o.href.startsWith('http') ? (
              <DownloadIcon className="h-4 w-4" />
            ) : (
              <TerminalSquare className="h-4 w-4" />
            )}
            {o.label}
          </a>
        ))}
      </div>
    </div>
  )
}
