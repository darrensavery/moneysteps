/**
 * choreIcons — the single shared icon library for chore categories.
 *
 * Category keys are exactly the `market_rates.category` values (see
 * worker/migrations/0029_market_rates.sql) so a chore's `icon_key` lines up
 * 1:1 with the Going Rates taxonomy — no separate mapping table to drift.
 * `General` is the only key that isn't a real market-rate category; it's
 * the fallback for chores nothing else matches.
 */

export interface ChoreCategoryDef {
  key: string
  label: string
  render: (size: number) => React.ReactElement
}

const s = (size: number) => `${size}px`

export const CHORE_CATEGORIES: ChoreCategoryDef[] = [
  {
    key: 'Tidying', label: 'Tidying',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  },
  {
    key: 'Kitchen', label: 'Kitchen',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="17" rx="9" ry="3"/><path d="M3 17V7a9 3 0 0 1 18 0v10"/><path d="M7 6.5V3M7 3h1.4M17 6.5V3M17 3h-1.4"/></svg>,
  },
  {
    key: 'Cleaning', label: 'Cleaning',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="9" rx="1.5"/><path d="M12 12v3"/><path d="M6 15h12l2 6H4z"/><path d="M14 3l3-1"/></svg>,
  },
  {
    key: 'Errands', label: 'Errands',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  },
  {
    key: 'Pets', label: 'Pets',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.725 1.722 3.656 2.115"/><path d="M14.267 5.172c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 2.115"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75z"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444c0-1.084-.22-2.2-.682-3.31"/></svg>,
  },
  {
    key: 'Outdoor Work', label: 'Outdoor Work',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 1 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2z"/></svg>,
  },
  {
    key: 'Learning & Skills', label: 'Learning & Skills',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  },
  {
    key: 'Laundry', label: 'Laundry',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="12" cy="13" r="4"/><circle cx="8" cy="7" r="1"/></svg>,
  },
  {
    key: 'Garden', label: 'Garden',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M9 8c0-2.5-2-4-2-4s-2 1.5-2 4 2 4 2 4 2-1.5 2-4z"/><path d="M15 8c0-2.5-2-4-2-4s-2 1.5-2 4 2 4 2 4 2-1.5 2-4z"/><path d="M7 21v-9"/><path d="M13 21v-9"/><path d="M17 21v-6c0-2-1-3-3-3"/></svg>,
  },
  {
    key: 'Good Habits', label: 'Good Habits',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.6 6.6L21 9l-5 4.4L17.4 20 12 16.5 6.6 20 8 13.4 3 9l6.4-.4z"/></svg>,
  },
  {
    key: 'General', label: 'General',
    render: size => <svg width={s(size)} height={s(size)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 15 10"/></svg>,
  },
]

const BY_KEY = new Map(CHORE_CATEGORIES.map(c => [c.key, c]))

export function renderCategoryIcon(category: string | null | undefined, size = 20) {
  return (BY_KEY.get(category ?? '') ?? BY_KEY.get('General')!).render(size)
}

/** Best-guess category from free-text chore title — used for custom (typed) chores. */
export function guessChoreCategory(title: string): string {
  const t = title.toLowerCase()

  if (t.includes('tidy') || t.includes('toy') || t.includes('room') || t.includes('declutter') || t.includes('bed') || t.includes('bedroom'))
    return 'Tidying'
  if (t.includes('dish') || t.includes('wash up') || t.includes('washing up') || t.includes('crockery') || t.includes('cook') || t.includes('dinner') || t.includes('lunch') || t.includes('meal') || t.includes('bake') || t.includes('table') || t.includes('fridge'))
    return 'Kitchen'
  if (t.includes('vacuum') || t.includes('hoover') || t.includes('sweep') || t.includes('mop') || t.includes('floor') || t.includes('broom') || t.includes('window') || t.includes('bathroom') || t.includes('toilet') || t.includes('shower'))
    return 'Cleaning'
  if (t.includes('bin') || t.includes('rubbish') || t.includes('trash') || t.includes('recycl') || t.includes('shop') || t.includes('groceries') || t.includes('errand'))
    return 'Errands'
  if (t.includes('dog') || t.includes('walk') || t.includes('pet') || t.includes('cat') || t.includes('feed') || t.includes('cage') || t.includes('litter'))
    return 'Pets'
  if (t.includes('car') || t.includes('diy') || t.includes('fix') || t.includes('repair') || t.includes('tool') || t.includes('build') || t.includes('assemble') || t.includes('mend') || t.includes('paint') || t.includes('babysit') || t.includes('sibling'))
    return 'Outdoor Work'
  if (t.includes('homework') || t.includes('reading') || t.includes('study') || t.includes('book') || t.includes('read') || t.includes('music') || t.includes('piano') || t.includes('practice') || t.includes('instrument') || t.includes('guitar'))
    return 'Learning & Skills'
  if (t.includes('laundry') || t.includes('washing') || t.includes('clothes') || t.includes('fold') || t.includes('iron'))
    return 'Laundry'
  if (t.includes('lawn') || t.includes('garden') || t.includes('grass') || t.includes('mow') || t.includes('weed') || t.includes('plant') || t.includes('hedge') || t.includes('trim') || t.includes('prune') || t.includes('leaves') || t.includes('rake'))
    return 'Garden'
  if (t.includes('teeth') || t.includes('dressed') || t.includes('behav') || t.includes('routine') || t.includes('manners') || t.includes('helpful'))
    return 'Good Habits'

  return 'General'
}
