/**
 * Avatar library — DiceBear-powered avatars across 6 styles.
 * avatar_id format: "style:seed"  e.g. "adventurer:felix"
 */

import { createAvatar } from '@dicebear/core'
import {
  adventurer,
  bottts,
  croodles,
  funEmoji,
  shapes,
  thumbs,
  loreleiNeutral,
  personas,
  pixelArtNeutral,
  icons,
  bigEarsNeutral,
} from '@dicebear/collection'

// ── Fixed seed grid (6 per style = 66 total) ──────────────────────

export const AVATAR_CATEGORIES = [
  { id: 'adventurer',        label: 'Adventurer'       },
  { id: 'bottts',            label: 'Bottts'           },
  { id: 'croodles',          label: 'Croodles'         },
  { id: 'fun-emoji',         label: 'Fun Emoji'        },
  { id: 'shapes',            label: 'Shapes'           },
  { id: 'thumbs',            label: 'Thumbs'           },
  { id: 'lorelei-neutral',   label: 'Lorelei'          },
  { id: 'personas',          label: 'Personas'         },
  { id: 'pixel-art-neutral', label: 'Pixel Art'        },
  { id: 'icons',             label: 'Icons'            },
  { id: 'big-ears-neutral',  label: 'Big Ears'         },
] as const

export type AvatarCategory = typeof AVATAR_CATEGORIES[number]['id']

const SEEDS: Record<AvatarCategory, string[]> = {
  'adventurer':        ['felix', 'luna',  'jasper', 'nova',  'orion', 'sage' ],
  'bottts':            ['spark', 'volt',  'byte',   'nano',  'pixel', 'core' ],
  'croodles':          ['wisp',  'fern',  'mossy',  'dune',  'ember', 'cove' ],
  'fun-emoji':         ['bliss', 'zest',  'glee',   'whim',  'fizz',  'hype' ],
  'shapes':            ['prism', 'arc',   'delta',  'grid',  'wave',  'facet'],
  'thumbs':            ['scout', 'ivy',   'echo',   'vale',  'rook',  'flint'],
  'lorelei-neutral':   ['mara',  'reed',  'quinn',  'sable', 'lark',  'wren' ],
  'personas':          ['juno',  'atlas', 'sol',    'cleo',  'rex',   'vera' ],
  'pixel-art-neutral': ['ash',   'birch', 'cedar',  'elm',   'hazel', 'oak'  ],
  'icons':             ['bolt',  'gem',   'star',   'leaf',  'drop',  'moon' ],
  'big-ears-neutral':  ['beau',  'cade',  'drew',   'finn',  'gray',  'hope' ],
}

// Flat list of all avatar IDs in "style:seed" format
export const AVATAR_IDS: string[] = AVATAR_CATEGORIES.flatMap(cat =>
  SEEDS[cat.id].map(seed => `${cat.id}:${seed}`)
)

// IDs for a single category
export function avatarsForCategory(catId: AvatarCategory): string[] {
  return SEEDS[catId].map(seed => `${catId}:${seed}`)
}

// ── DiceBear style map ─────────────────────────────────────────────

const STYLE_MAP = {
  'adventurer':        adventurer,
  'bottts':            bottts,
  'croodles':          croodles,
  'fun-emoji':         funEmoji,
  'shapes':            shapes,
  'thumbs':            thumbs,
  'lorelei-neutral':   loreleiNeutral,
  'personas':          personas,
  'pixel-art-neutral': pixelArtNeutral,
  'icons':             icons,
  'big-ears-neutral':  bigEarsNeutral,
} as const

// ── Render helpers ─────────────────────────────────────────────────

function parseid(id: string): { style: AvatarCategory; seed: string } | null {
  const idx = id.indexOf(':')
  if (idx === -1) return null
  const style = id.slice(0, idx) as AvatarCategory
  const seed  = id.slice(idx + 1)
  if (!(style in STYLE_MAP)) return null
  return { style, seed }
}

function renderSvg(style: AvatarCategory, seed: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createAvatar(STYLE_MAP[style] as any, { seed, size: 80 }).toString()
}

export function AvatarSVG({ id, size = 52 }: { id: string; size?: number }) {
  const parsed = parseid(id)
  if (!parsed) return <DefaultAvatar size={size} />

  const svg = renderSvg(parsed.style, parsed.seed)
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  return (
    <img
      src={dataUri}
      width={size}
      height={size}
      alt=""
      style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}
    />
  )
}

export function DefaultAvatar({ size = 52, initials = '?', color = '#0d9488' }: {
  size?: number; initials?: string; color?: string
}) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}>
      <circle cx="50" cy="50" r="50" fill={color} />
      <text x="50" y="62" textAnchor="middle" fontSize="42" fontWeight="800"
        fill="#ffffff" fontFamily="Manrope, sans-serif">{initials[0]?.toUpperCase()}</text>
    </svg>
  )
}
