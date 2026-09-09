import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useInView } from '../lib/useInView'
import { SiteCopy } from '../i18n'

export function Faq({ copy }: { copy: SiteCopy }) {
  const headRef = useRef<HTMLDivElement>(null)
  const headVisible = useInView(headRef)

  return (
    <section id="faq" className="scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <div
          ref={headRef}
          className={`reveal ${headVisible ? 'is-visible' : ''} text-center`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand">
            {copy.faq.eyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-5xl">
            {copy.faq.title}
          </h2>
        </div>

        <div className="mt-12 flex flex-col gap-3">
          {copy.faq.items.map((item, i) => (
            <FaqItem key={i} q={item.q} a={item.a} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FaqItem({
  q,
  a,
  index,
}: {
  q: string
  a: string
  index: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)
  const [open, setOpen] = useState(index === 0)

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-colors ${
        open ? 'border-brand/40' : ''
      }`}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
        aria-expanded={open}
      >
        <span className="text-[15px] font-bold text-ink sm:text-base">{q}</span>
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
            open
              ? 'rotate-180 border-brand bg-brand text-white'
              : 'border-line bg-paper text-ink-mute'
          }`}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <p className="px-6 pb-6 text-sm leading-relaxed text-ink-mute">
            {a}
          </p>
        </div>
      </div>
    </div>
  )
}
