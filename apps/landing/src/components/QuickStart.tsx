import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useInView } from '../lib/useInView'
import { SiteCopy } from '../i18n'

const COMMAND = 'npx @greeneek/gnk web'

export function QuickStart({ copy }: { copy: SiteCopy }) {
  const headRef = useRef<HTMLDivElement>(null)
  const headVisible = useInView(headRef)
  const [copied, setCopied] = useState(false)

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND)
    } catch {
      return
    }
    setCopied(true)
    setTimeout(() => { setCopied(false) }, 2000)
  }

  return (
    <section id="quickstart" className="scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div
          ref={headRef}
          className={`reveal ${headVisible ? 'is-visible' : ''} max-w-2xl`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand">
            {copy.steps.eyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-5xl">
            {copy.steps.title}
          </h2>
          <p className="mt-4 text-base text-ink-mute sm:text-lg">
            {copy.steps.sub}
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-5">
          {/* steps */}
          <ol className="grid gap-4 sm:grid-cols-3 lg:col-span-3 lg:grid-cols-1 lg:gap-3">
            {copy.steps.items.map((s, i) => (
              <StepRow key={s.step} step={s.step} title={s.title} desc={s.desc} index={i} />
            ))}
          </ol>

          {/* command panel */}
          <div className="lg:col-span-2">
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-ink text-white shadow-pop">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
                <p className="text-sm font-semibold text-white/90">
                  {copy.steps.runFromNpm}
                </p>
                <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-white/70">
                  bash
                </span>
              </div>
              <div className="flex flex-1 flex-col justify-center gap-4 px-5 py-8">
                <p className="text-sm text-white/55">{copy.steps.installNode}</p>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/40 px-4 py-3.5">
                  <code className="break-all text-[15px] text-brand-tint">
                    <span className="mr-2 select-none text-white/40">$</span>
                    {COMMAND}
                  </code>
                  <button
                    onClick={() => { void copyCommand() }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                      copied
                        ? 'bg-brand text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/20 hover:text-white'
                    }`}
                    aria-label={copy.steps.copy}
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        {copy.steps.copied}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        {copy.steps.copy}
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[13px] leading-relaxed text-white/50">
                  {copy.steps.servesAt}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function StepRow({
  step,
  title,
  desc,
  index,
}: {
  step: string
  title: string
  desc: string
  index: number
}) {
  const ref = useRef<HTMLLIElement>(null)
  const visible = useInView(ref)

  return (
    <li
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} group relative flex gap-5 overflow-hidden rounded-2xl border border-line bg-white p-6 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-pop sm:p-5 lg:p-6`}
      style={{ transitionDelay: `${index * 90}ms` }}
    >
      <span className="font-mono text-3xl font-bold text-brand/30 transition-colors group-hover:text-brand/70">
        {step}
      </span>
      <div className="min-w-0">
        <h3 className="text-lg font-bold tracking-tight text-ink">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-mute">{desc}</p>
      </div>
    </li>
  )
}
