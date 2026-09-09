import { useRef } from 'react'
import { useInView } from '../lib/useInView'
import { SiteCopy } from '../i18n'
import { GithubIcon, StarIcon } from './icons'
import { REPO_URL } from '../lib/platform'

export function StarCallout({ copy }: { copy: SiteCopy }) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)

  return (
    <section className="py-10">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div
          ref={ref}
          className={`reveal ${visible ? 'is-visible' : ''} relative overflow-hidden rounded-3xl bg-brand-deep px-8 py-14 text-center shadow-pop sm:px-14`}
        >
          <div
            aria-hidden="true"
            className="dot-grid-light absolute inset-0 opacity-60 [mask-image:radial-gradient(70%_80%_at_50%_20%,black,transparent)]"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-24 left-1/2 h-64 w-[560px] -translate-x-1/2 rounded-full bg-brand/30 blur-3xl"
          />
          <div className="relative">
            <GithubIcon className="mx-auto h-10 w-10 text-brand-tint" />
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {copy.star.title}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-[15px] leading-relaxed text-white/65">
              {copy.star.sub}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-bold text-brand-deep transition-all hover:-translate-y-0.5 hover:bg-brand-tint"
              >
                <StarIcon className="h-4 w-4 text-brand" />
                {copy.star.cta}
              </a>
              <a
                href="#download"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3.5 text-sm font-semibold text-white/85 transition-all hover:bg-white/10"
              >
                {copy.star.later}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
