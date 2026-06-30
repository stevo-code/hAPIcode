import { useId } from 'react'

/** Glyphe du logo hAPIcode : carré arrondi à dégradé violet + chevrons </> blancs. */
export function IconMark({ size = 28 }: { size?: number }): JSX.Element {
  const gid = `hapi-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9B6BFF" />
          <stop offset="1" stopColor="#5B6CFF" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="108" height="108" rx="32" fill={`url(#${gid})`} />
      <path d="M40 44 L26 60 L40 76" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M64 38 L52 82" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M80 44 L94 60 L80 76" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="44" y="92" width="32" height="6" rx="3" fill="#fff" />
    </svg>
  )
}

/** Mot-symbole « <hAPIcode/> » en monospace, chevrons en accent. */
export function Wordmark(): JSX.Element {
  return (
    <span className="wordmark">
      <span className="wm-accent">&lt;</span>h<span className="wm-accent">API</span>code<span className="wm-accent">/&gt;</span>
    </span>
  )
}
