import { useRef } from 'react'
import { useInView } from '../lib/useInView'
import { SiteCopy } from '../i18n'

export function Showcase({ copy }: { copy: SiteCopy }) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)

  return (
    <section className="relative pb-8 pt-10">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div
          ref={ref}
          className={`reveal ${visible ? 'is-visible' : ''} relative`}
        >
          {/* glow */}
          <div
            aria-hidden="true"
            className="absolute -inset-x-8 top-10 h-72 rounded-full bg-brand/15 blur-3xl"
          />

          {/* app frame */}
          <figure className="relative overflow-hidden rounded-2xl border border-line bg-white shadow-pop">
            {/* title bar */}
            <div className="flex items-center gap-2 border-b border-line-soft bg-paper px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              <span className="ml-3 rounded-md bg-paper-deep px-3 py-1 text-xs font-medium text-ink-mute">
                127.0.0.1:3080 — Greeneek
              </span>
            </div>
            <img
              src="/images/workspace.png"
              alt="Greeneek workspace screenshot"
              width={1200}
              height={750}
              className="block h-auto w-full"
              loading="lazy"
            />
          </figure>

          <figcaption className="mt-4 text-center text-sm text-ink-faint">
            {copy.screenshot.caption}
          </figcaption>
        </div>
      </div>
    </section>
  )
}
