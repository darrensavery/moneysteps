/**
 * ChoreIcon — keyword → icon lookup for chore cards.
 * Falls back to a generic checkmark when no keyword matches.
 */
export function ChoreIcon({ title, size = 20 }: { title: string; size?: number }) {
  const s = `${size}px`
  const t = title.toLowerCase()

  if (t.includes('tidy') || t.includes('toy') || t.includes('room') || t.includes('clean room') || t.includes('declutter'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  if (t.includes('dish') || t.includes('wash up') || t.includes('washing up') || t.includes('crockery'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="17" rx="9" ry="3"/><path d="M3 17V7a9 3 0 0 1 18 0v10"/><path d="M7 6.5V3M7 3h1.4M17 6.5V3M17 3h-1.4"/></svg>
  if (t.includes('vacuum') || t.includes('hoover'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="9" rx="1.5"/><path d="M12 12v3"/><path d="M6 15h12l2 6H4z"/><path d="M14 3l3-1"/></svg>
  if (t.includes('sweep') || t.includes('mop') || t.includes('floor') || t.includes('broom'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3 5 19"/><path d="M9 21h9"/><path d="M4 21l3.5-7h6L18 21z"/></svg>
  if (t.includes('window'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M3 12h18"/></svg>
  if (t.includes('iron'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h13a3 3 0 0 0 3-3c0-5-4-9-9-9H8a4 4 0 0 0-4 4z"/><path d="M4 20v-3"/><path d="M10 8V5"/></svg>
  if (t.includes('bin') || t.includes('rubbish') || t.includes('trash') || t.includes('recycl'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
  if (t.includes('plant') || t.includes('water') && !t.includes('washing') || t.includes('garden water'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h11l3-3h5l-2 3 2 3h-5l-3-3"/><path d="M7 12v4a2 2 0 0 0 2 2h1"/></svg>
  if (t.includes('dog') || t.includes('walk') || t.includes('pet') || t.includes('cat') || t.includes('feed'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.725 1.722 3.656 2.115"/><path d="M14.267 5.172c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 2.115"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75z"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444c0-1.084-.22-2.2-.682-3.31"/></svg>
  if (t.includes('car') || t.includes('wash car'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-3h10l2 3h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
  if (t.includes('diy') || t.includes('fix') || t.includes('repair') || t.includes('tool') || t.includes('build') || t.includes('assemble') || t.includes('mend'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 1 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2z"/></svg>
  if (t.includes('shop') || t.includes('groceries') || t.includes('errand'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
  if (t.includes('table') || t.includes('set the table') || t.includes('lay the table'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v9M3 2a2 2 0 0 0 3 0M3 6a2 2 0 0 1 3 0M6 2v9"/><path d="M11 2v9"/><path d="M14.5 2c-1.5 0-2.5 1.5-2.5 3.5S13 9 14.5 9"/><path d="M14.5 2v9"/><rect x="18" y="2" width="4" height="7" rx="1"/><path d="M20 9v2"/><path d="M2 21h20"/></svg>
  if (t.includes('homework') || t.includes('reading') || t.includes('study') || t.includes('book') || t.includes('read'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
  if (t.includes('music') || t.includes('piano') || t.includes('practice') || t.includes('instrument') || t.includes('guitar'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
  if (t.includes('sport') || t.includes('exercise') || t.includes('gym') || t.includes('run') || t.includes('training'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5 3 3M17.5 17.5 21 21M6.5 17.5 3 21M17.5 6.5 21 3"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/></svg>
  if (t.includes('bed') || t.includes('bedroom'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4v16"/><path d="M22 4v16"/><path d="M2 8h20"/><path d="M2 20h20"/><path d="M2 12h6a2 2 0 0 1 2 2v4H2v-6z"/><path d="M16 12h6v8h-8v-4a2 2 0 0 1 2-2z"/></svg>
  if (t.includes('lawn') || t.includes('garden') || t.includes('grass') || t.includes('mow') || t.includes('weed'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M9 8c0-2.5-2-4-2-4s-2 1.5-2 4 2 4 2 4 2-1.5 2-4z"/><path d="M15 8c0-2.5-2-4-2-4s-2 1.5-2 4 2 4 2 4 2-1.5 2-4z"/><path d="M7 21v-9"/><path d="M13 21v-9"/><path d="M17 21v-6c0-2-1-3-3-3"/></svg>
  if (t.includes('cook') || t.includes('dinner') || t.includes('lunch') || t.includes('meal') || t.includes('bake'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 11v6"/><path d="M9 11v2a3 3 0 0 0 6 0v-2"/><path d="M3 11h18"/><path d="M12 2v3"/><path d="M8 2c0 2.5 4 2.5 4 5"/><path d="M16 2c0 2.5-4 2.5-4 5"/></svg>
  if (t.includes('laundry') || t.includes('washing') || t.includes('clothes') || t.includes('fold'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="12" cy="13" r="4"/><circle cx="8" cy="7" r="1"/></svg>
  if (t.includes('screen') || t.includes('computer') || t.includes('tech') || t.includes('desk'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
  if (t.includes('sibling') || t.includes('babysit') || t.includes('help mum') || t.includes('help dad'))
    return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="3"/><path d="M2 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2"/><circle cx="18" cy="8" r="2.5"/><path d="M15.5 13.2A4 4 0 0 1 22 16.5V19"/></svg>
  // fallback — generic task circle
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 15 10"/></svg>
}
