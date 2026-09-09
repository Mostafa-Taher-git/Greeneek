import { useEffect, useState } from 'react'
import { ArrowRight, Download, ShieldCheck } from 'lucide-react'
import { SiteCopy } from '../i18n'
import { LogoMark } from './Logo'
import { GithubIcon } from './icons'
import { detectPlatform, download, Platform, REPO_URL } from '../lib/platform'

interface HeroProps {
  copy: SiteCopy
}

const platformLabel: Record<Platform, string> = {
  windows: 'Windows x64 · Setup',
  macos: 'npm · cross-platform',
  linux: 'Linux x64 · .deb / AppImage',
  unknown: 'All platforms',
}

export function Hero({ copy }: HeroProps) {
  const [platform, setPlatform] = useState<Platform>('unknown')

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  const primaryHref =
    platform === 'linux'
      ? download.linuxDeb
      : platform === 'macos'
        ? '#quickstart'
        : download.windowsInstaller

  return (
    <section id="top" className="relative overflow-hidden pt-36 pb-14 sm:pt-44">
      {/* backdrop texture */}
      <div
        aria-hidden="true"
        className="dot-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl"
      />

      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-col items-center text-center">
          <div className="animate-float-slow mb-7">
            <LogoMark size={72} />
          </div>

          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 text-xs font-semibold tracking-wide text-ink-soft shadow-card">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            {copy.hero.badge}
          </span>

          <h1 className="mt-6 max-w-3xl text-balance text-5xl font-bold leading-[1.04] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            {copy.hero.titleA}
            <br />
            <span className="text-brand">{copy.hero.titleB}</span>
          </h1>

          <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-ink-mute sm:text-lg">
            {copy.hero.sub}
          </p>

          {/* CTAs */}
          <div className="mt-10 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <a
              href={primaryHref}
              className="group inline-flex w-full items-center justify-center gap-3 rounded-full bg-brand px-7 py-4 text-base font-semibold text-white shadow-pop transition-all hover:-translate-y-0.5 hover:bg-brand-strong sm:w-auto"
            >
              <Download className="h-5 w-5" />
              <span>{copy.hero.download}</span>
              <span className="hidden rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold sm:inline">
                {copy.hero.currentDevice} · {platformLabel[platform]}
              </span>
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-full border border-line bg-white px-7 py-4 text-base font-semibold text-ink transition-all hover:-translate-y-0.5 hover:border-ink-faint hover:shadow-card sm:w-auto"
            >
              <GithubIcon className="h-5 w-5" />
              {copy.hero.viewGithub}
            </a>
          </div>

          <p className="mt-7 inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-ink-faint">
            <ShieldCheck className="h-4 w-4 text-brand" />
            {copy.hero.runsLocal}
            <span className="text-ink-faint/60">·</span>
            <span>{copy.hero.orRun}</span>
            <code className="rounded-md border border-line bg-white px-2 py-0.5 text-[13px] text-brand-deep">
              npx @greeneek/gnk web
            </code>
          </p>
        </div>

        {/* provider marquee */}
        <div className="mt-16">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
            {copy.hero.providers}
          </p>
          <div className="relative mt-5 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
            <div className="animate-marquee flex w-max items-center gap-3 pr-3">
              {[0, 1].map(copyIdx => (
                <div key={copyIdx} className="flex items-center gap-3 pr-3">
                  {copy.hero.providersList.map(p => (
                    <span
                      key={`${copyIdx}-${p}`}
                      className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                      {p}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                    +35
                    <ArrowRight className="h-3.5 w-3.5 text-ink-faint" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
