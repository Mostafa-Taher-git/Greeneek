import { useState } from 'react'

const LOGO_URL =
  'https://raw.githubusercontent.com/Mostafa-Taher-git/Greeneek/main/apps/web/public/assets/logo-mark.png'

export function LogoMark({ size = 36 }: { size?: number }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="12" fill="#0F8A4A" />
        <path
          d="M33.5 15.5c-7 1.2-13 6-15.2 12.6-.5 1.5-.9 3.8-.7 5.4.1 1 1.4 1.4 2.1.7 2-2.1 4.6-3.4 7.4-3.8.7-.1 1 .7.6 1.2-2.1 2.7-2.4 6.1-.9 9.1.5 1 1.9 1.1 2.5.2 2.8-4.1 4.5-9 4.8-14.2.1-1.2.4-2.4.8-3.5.8-2.2 1.2-4.6 1-7-.1-1-1-1.5-2.4-.7Z"
          fill="#E9F9EF"
        />
        <path
          d="M18 34c3.5-7.5 10.5-12 18-12.5"
          stroke="#0F8A4A"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  return (
    <img
      src={LOGO_URL}
      alt="Greeneek logo"
      width={size}
      height={size}
      className="rounded-xl"
      style={{ width: size, height: size, objectFit: 'contain' }}
      onError={() => { setFailed(true) }}
      loading="eager"
    />
  )
}

export function Wordmark({ size = 36 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="leading-none">
        <span className="block text-[1.15rem] font-bold tracking-tight text-ink">
          Greeneek
        </span>
        <span className="mt-0.5 block text-[0.62rem] font-medium uppercase tracking-[0.18em] text-ink-mute">
          Desktop
        </span>
      </span>
    </span>
  )
}
