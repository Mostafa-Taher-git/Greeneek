import { useRef } from 'react'
import { Blocks, KeyRound, MousePointerClick, Workflow } from 'lucide-react'
import { useInView } from '../lib/useInView'
import { SiteCopy } from '../i18n'

const icons = [MousePointerClick, KeyRound, Blocks, Workflow]

export function Features({ copy }: { copy: SiteCopy }) {
  const headRef = useRef<HTMLDivElement>(null)
  const headVisible = useInView(headRef)

  return (
    <section id="features" className="scroll-mt-24 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div
          ref={headRef}
          className={`reveal ${headVisible ? 'is-visible' : ''} max-w-2xl`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-brand">
            {copy.features.eyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-5xl">
            {copy.features.title}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-mute sm:text-lg">
            {copy.features.sub}
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {copy.features.items.map((f, i) => {
            const Icon = icons[i % icons.length]
            return <FeatureCard key={f.title} icon={Icon} title={f.title} desc={f.desc} index={i} />
          })}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
  index,
}: {
  icon: typeof Blocks
  title: string
  desc: string
  index: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-white p-7 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-pop sm:p-9`}
      style={{ transitionDelay: `${(index % 2) * 90}ms` }}
    >
      <div
        aria-hidden="true"
        className="absolute -right-14 -top-14 h-36 w-36 rounded-full bg-brand-mist transition-transform duration-500 group-hover:scale-150"
      />
      <div className="relative">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-brand-tint text-brand-strong transition-colors group-hover:bg-brand group-hover:text-white">
          <Icon className="h-5.5 w-5.5" strokeWidth={2} />
        </div>
        <h3 className="mt-6 text-xl font-bold tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-mute">{desc}</p>
      </div>
    </div>
  )
}
