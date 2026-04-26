/**
 * CreateChoreSheet — zero-scroll bottom-sheet for creating a new chore.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { ChildRecord, MarketRate } from '../../lib/api'
import { createChore } from '../../lib/api'
import { currencySymbol } from '../../lib/locale'
import { useMarketRates, fuzzyMatch } from '../../hooks/useMarketRates'
import { useAndroidBack } from '../../hooks/useAndroidBack'

interface Props {
  familyId: string
  children: ChildRecord[]
  currency: string
  initialTitle?: string
  initialRewardAmount?: number  // in minor units (pence/groszy)
  onCreated: () => void
  onClose: () => void
}

interface Form {
  title: string
  reward_amount: string
  frequency: string
  weekly_day: number
  description: string
  due_date: string
  proof_required: boolean
  auto_approve: boolean
}

const BLANK: Form = {
  title: '', reward_amount: '', frequency: 'as_needed', weekly_day: 1,
  description: '', due_date: '', proof_required: false, auto_approve: false,
}

const FREQUENCY_OPTIONS = [
  { label: 'One-off',     value: 'as_needed'  },
  { label: 'Daily',       value: 'daily'       },
  { label: 'Weekly',      value: 'weekly'      },
  { label: 'Fortnightly', value: 'bi_weekly'   },
  { label: 'Monthly',     value: 'monthly'     },
  { label: 'School days', value: 'school_days' },
]

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── Tile SVG icons — monochromatic line art ────────────────────────────────────

function IconTidying()  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> }
function IconDishes()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M12 2a10 10 0 0 1 0 20"/><path d="M12 2a10 10 0 0 0 0 20"/><path d="M2 12h20"/></svg> }
function IconVacuum()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="12" cy="12" r="3"/><path d="M12 9V3"/><path d="M6.6 6.6 4.5 4.5"/><path d="M9 12H3"/><path d="M6.6 17.4l-2.1 2.1"/><path d="M12 15v6"/><path d="M17.4 17.4l2.1 2.1"/><path d="M15 12h6"/><path d="M17.4 6.6l2.1-2.1"/></svg> }
function IconBins()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> }
function IconDog()      { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.725 1.722 3.656 2.115"/><path d="M14.267 5.172c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 2.115"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75z"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444c0-1.084-.22-2.2-.682-3.31"/></svg> }
function IconCar()      { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-3h10l2 3h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg> }
function IconBook()     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> }
function IconBed()      { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M2 4v16"/><path d="M22 4v16"/><path d="M2 8h20"/><path d="M2 20h20"/><path d="M2 12h6a2 2 0 0 1 2 2v4H2v-6z"/><path d="M16 12h6v8h-8v-4a2 2 0 0 1 2-2z"/></svg> }

const TILE_ICONS: Record<string, () => React.ReactElement> = {
  'Tidy the Room':      IconTidying,
  'Wash the Dishes':    IconDishes,
  'Vacuum the House':   IconVacuum,
  'Take Out the Bins':  IconBins,
  'Walk the Dog':       IconDog,
  'Wash the Car':       IconCar,
  'Do Homework / Read': IconBook,
  'Make the Bed':       IconBed,
}

function TileIcon({ name }: { name: string }) {
  const Icon = TILE_ICONS[name]
  return Icon
    ? <Icon />
    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-6 h-6"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/></svg>
}

// ── Component ─────────────────────────────────────────────────────────────────

// Assignment mode for multi-child selector
type AssignMode = 'named' | 'anyone' | 'everyone'

export function CreateChoreSheet({
  familyId, children, currency,
  initialTitle, initialRewardAmount,
  onCreated, onClose,
}: Props) {
  const [form, setForm] = useState<Form>(() => ({
    ...BLANK,
    ...(initialTitle        !== undefined ? { title: initialTitle } : {}),
    ...(initialRewardAmount !== undefined ? { reward_amount: (initialRewardAmount / 100).toFixed(2) } : {}),
  }))
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [showDesc, setShowDesc] = useState(false)
  // Conflict message: shown when parent tries to enable Auto-pay while Photo Proof is on
  const [conflictMsg, setConflictMsg] = useState(false)
  // Tooltip visibility for Skip Approval card
  const [showTooltip, setShowTooltip] = useState(false)

  useAndroidBack(true, onClose)

  // ── Assignment state ────────────────────────────────────────────────────────
  const singleChild = children.length === 1 ? children[0] : null
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(singleChild ? [singleChild.id] : [])
  )
  const [assignMode, setAssignMode] = useState<AssignMode>('named')

  function toggleChildId(id: string) {
    setAssignMode('named')
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function setModeAnyone() {
    setAssignMode('anyone')
    setSelectedIds(new Set())
  }

  function setModeEveryone() {
    setAssignMode('everyone')
    setSelectedIds(new Set())
  }

  // Derived: who does the CTA button say?
  const ctaLabel = (() => {
    if (assignMode === 'anyone')   return 'Post for Anyone →'
    if (assignMode === 'everyone') return `Post to Everyone (${children.length}) →`
    if (selectedIds.size === 0)    return 'Select who →'
    if (selectedIds.size === 1) {
      const name = children.find(c => c.id === [...selectedIds][0])?.display_name ?? '?'
      return `Assign to ${name} →`
    }
    return `Assign to ${selectedIds.size} Children →`
  })()

  const canSubmit = (
    form.title.trim() !== '' &&
    form.reward_amount !== '' &&
    (assignMode === 'anyone' || assignMode === 'everyone' || selectedIds.size > 0)
  )

  const titleRef       = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  const { rates, loading: ratesLoading, error: ratesError } = useMarketRates(currency)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedRate,    setSelectedRate]    = useState<MarketRate | null>(null)
  const [sparkActive,     setSparkActive]     = useState(false)
  const sparkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sym = currencySymbol(currency)

  // Focus title on open (don't open suggestions on initial focus)
  useEffect(() => {
    const t = setTimeout(() => {
      titleRef.current?.focus({ preventScroll: true })
    }, 120)
    return () => clearTimeout(t)
  }, [])

  // Dismiss suggestions on outside click
  useEffect(() => {
    if (!showSuggestions) return
    const handler = (e: MouseEvent) => {
      if (!suggestionsRef.current?.contains(e.target as Node)) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSuggestions])

  // Auto-dismiss conflict message after 3s
  useEffect(() => {
    if (!conflictMsg) return
    const t = setTimeout(() => setConflictMsg(false), 3000)
    return () => clearTimeout(t)
  }, [conflictMsg])

  const triggerSpark = useCallback(() => {
    if (sparkTimerRef.current) clearTimeout(sparkTimerRef.current)
    setSparkActive(true)
    sparkTimerRef.current = setTimeout(() => setSparkActive(false), 850)
  }, [])

  const selectRate = useCallback((rate: MarketRate) => {
    setField('title', rate.canonical_name)
    setSelectedRate(rate)
    setSearchQuery('')
    setShowSuggestions(false)
  }, [])

  const applySuggestion = useCallback((rate: MarketRate) => {
    if (rate.median_amount != null) {
      setField('reward_amount', (rate.median_amount / 100).toFixed(2))
      triggerSpark()
    }
  }, [triggerSpark])

  function setField<K extends keyof Form>(k: K, v: Form[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  // ── Completion Rules toggle logic ──────────────────────────────────────────

  function toggleProofRequired() {
    const next = !form.proof_required
    setForm(f => ({
      ...f,
      proof_required: next,
      // If enabling photo proof, disable auto-approve (incompatible)
      auto_approve: next ? false : f.auto_approve,
    }))
    setConflictMsg(false)
  }

  function toggleAutoApprove() {
    if (!form.auto_approve && form.proof_required) {
      // Conflict: can't auto-pay a task that requires photo review
      setConflictMsg(true)
      return
    }
    setField('auto_approve', !form.auto_approve)
    setConflictMsg(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const isRecurring = form.frequency !== 'as_needed'
      const base = {
        family_id:      familyId,
        title:          form.title.trim(),
        reward_amount:  Math.round(parseFloat(form.reward_amount) * 100),
        currency,
        frequency:      form.frequency,
        description:    form.description.trim() || undefined,
        due_date:       isRecurring ? undefined : (form.due_date || undefined),
        proof_required: form.proof_required,
        auto_approve:   form.auto_approve,
      }

      if (assignMode === 'anyone') {
        await createChore({ ...base, assigned_to: 'anyone' } as Parameters<typeof createChore>[0])
      } else if (assignMode === 'everyone') {
        // Fan out — one record per child
        await Promise.all(
          children.map(c => createChore({ ...base, assigned_to: c.id } as Parameters<typeof createChore>[0]))
        )
      } else {
        // Named — one record per selected child
        await Promise.all(
          [...selectedIds].map(id => createChore({ ...base, assigned_to: id } as Parameters<typeof createChore>[0]))
        )
      }

      onCreated()
    } catch (err: unknown) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  // Smart suggestion: prefer selected tile, fall back to exact title match
  const suggestion = selectedRate ?? (
    form.title.trim()
      ? rates.find(r => r.canonical_name.toLowerCase() === form.title.trim().toLowerCase()) ?? null
      : null
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-[var(--color-surface)] rounded-t-3xl shadow-2xl max-w-[560px] w-full mx-auto flex flex-col max-h-[92svh]">

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* Header */}
        <div className="px-5 pt-1 pb-2 flex items-center justify-between shrink-0">
          <div>
            <p className="text-[17px] font-extrabold text-[var(--color-text)] tracking-tight leading-tight">New chore</p>
            {singleChild && (
              <p className="text-[12px] text-[var(--color-text-muted)]">
                for <span className="font-semibold text-[var(--brand-primary)]">{singleChild.display_name}</span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Child selector pills — only shown when 2+ children */}
        {children.length > 1 && (
          <div
            className="px-5 pb-3 flex gap-2 overflow-x-auto shrink-0"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
          >
            {children.map(c => {
              const active = assignMode === 'named' && selectedIds.has(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChildId(c.id)}
                  className={`shrink-0 px-3 py-1 rounded-full text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap
                    ${active
                      ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                    }`}
                >
                  {c.display_name}
                </button>
              )
            })}
            {/* Anyone pill */}
            <button
              type="button"
              onClick={setModeAnyone}
              className={`shrink-0 px-3 py-1 rounded-full text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap
                ${assignMode === 'anyone'
                  ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                }`}
            >
              Anyone
            </button>
            {/* Everyone pill */}
            <button
              type="button"
              onClick={setModeEveryone}
              className={`shrink-0 px-3 py-1 rounded-full text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap
                ${assignMode === 'everyone'
                  ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                }`}
            >
              Everyone
            </button>
          </div>
        )}

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-4 pb-3 space-y-4">

          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-2.5">
              <p className="text-[12px] text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* ── Quick Pick tile grid ─────────────────────────────── */}
          <div>
            <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">
              Quick Pick
            </p>
            {ratesLoading ? (
              <div className="py-3 text-center text-xs text-[var(--color-text-muted)]">Loading…</div>
            ) : ratesError ? (
              <div className="py-2 text-center text-[11px] text-red-500">{ratesError}</div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {rates
                  .filter(r => r.is_orchard_8)
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map(rate => {
                    const active = form.title === rate.canonical_name
                    return (
                      <button
                        key={rate.id}
                        type="button"
                        onClick={() => selectRate(rate)}
                        className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 py-2.5 px-1 text-center transition-all cursor-pointer
                          ${active
                            ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'
                            : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                          }`}
                      >
                        <TileIcon name={rate.canonical_name} />
                        <span className="text-[9px] font-semibold leading-tight text-center">
                          {rate.canonical_name.split('/')[0]}
                        </span>
                      </button>
                    )
                  })}
              </div>
            )}
          </div>

          {/* ── Search / title input + dropdown ─────────────────── */}
          <div className="relative">
            <input
              ref={titleRef}
              type="text"
              value={form.title}
              placeholder="Or type a chore name…"
              onFocus={() => { /* only open on typing, not focus */ }}
              onChange={e => {
                const val = e.target.value
                setField('title', val)
                setSearchQuery(val)
                setShowSuggestions(val.length > 0)
                setSelectedRate(null)
              }}
              className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              required
            />

            {/* Suggestions dropdown — only when user is typing */}
            {showSuggestions && rates.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute top-full left-0 right-0 z-10 mt-1 max-h-44 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg divide-y divide-[var(--color-border)]"
              >
                {rates
                  .filter(r => !r.is_orchard_8 && fuzzyMatch(r, searchQuery))
                  .map(rate => (
                    <button
                      key={rate.id}
                      type="button"
                      onClick={() => selectRate(rate)}
                      className="w-full flex items-center px-3 py-2.5 text-left hover:bg-[var(--color-surface-alt)] transition-colors"
                    >
                      {/* No price shown — price surfaced via Smart Suggestion banner */}
                      <span className="text-[13px] text-[var(--color-text)]">{rate.canonical_name}</span>
                    </button>
                  ))}
                {rates.filter(r => !r.is_orchard_8 && fuzzyMatch(r, searchQuery)).length === 0 && (
                  <p className="px-3 py-2.5 text-[12px] text-[var(--color-text-muted)]">
                    Custom chore — type your own.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Smart Suggestion banner — reserved height so layout never shifts ── */}
          <div className="h-8 flex items-center justify-center">
            {suggestion && suggestion.median_amount != null ? (
              <div className="flex items-center gap-2">
                {/* Dim label — price pill is the star */}
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {suggestion.sample_count > 5 ? 'Morechard parents pay' : 'Industry average'}
                </span>
                {/* Tappable price pill — no "use" text, whole pill is the action */}
                <button
                  type="button"
                  onClick={() => applySuggestion(suggestion)}
                  className="px-3 py-1 rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_12%,transparent)] border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[13px] font-bold tabular-nums hover:bg-[color-mix(in_srgb,var(--brand-primary)_22%,transparent)] active:scale-95 transition-all cursor-pointer"
                >
                  {sym}{(suggestion.median_amount / 100).toFixed(2)}
                </button>
              </div>
            ) : (
              /* Invisible placeholder — holds space so Reward row never jumps */
              <span aria-hidden="true" />
            )}
          </div>

          {/* ── Reward + Due Date inline row ─────────────────────── */}
          <div className="flex gap-3">
            {/* Reward — left half */}
            <div className="flex-1">
              <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest block mb-1.5">
                Reward
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-bold text-[var(--color-text-muted)]">
                  {sym}
                </span>
                <input
                  className={`w-full border border-[var(--color-border)] rounded-xl pl-8 pr-3 py-2.5 text-[15px] font-semibold tabular-nums bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition${sparkActive ? ' ring-2 ring-[var(--brand-primary)]' : ''}`}
                  placeholder="0.00"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={form.reward_amount}
                  onChange={e => {
                    setSparkActive(false)
                    setField('reward_amount', e.target.value)
                  }}
                  required
                />
              </div>
            </div>

            {/* Due Date / Day — right half */}
            <div className="flex-1">
              <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest block mb-1.5">
                {form.frequency === 'as_needed' ? 'Due date' : form.frequency === 'weekly' ? 'Day' : 'Schedule'}
              </label>
              {form.frequency === 'as_needed' ? (
                <input
                  type="date"
                  className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
                  value={form.due_date}
                  onChange={e => setField('due_date', e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              ) : form.frequency === 'weekly' ? (
                <select
                  className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition"
                  value={form.weekly_day}
                  onChange={e => setField('weekly_day', Number(e.target.value))}
                >
                  {DAYS_SHORT.map((d, i) => (
                    <option key={d} value={i + 1}>{d}</option>
                  ))}
                </select>
              ) : (
                <div className="w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[13px] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]">
                  Recurring
                </div>
              )}
            </div>
          </div>

          {/* ── Frequency horizontal pill scroll ─────────────────── */}
          {/* overflow-x-auto + flex-nowrap = true horizontal scroll, never wraps */}
          <div>
            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest block mb-1.5">
              Frequency
            </label>
            <div
              className="flex gap-2 overflow-x-auto"
              style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
            >
              {FREQUENCY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setField('frequency', opt.value)}
                  className={`shrink-0 px-4 py-1.5 rounded-full text-[12px] font-semibold border transition-all cursor-pointer whitespace-nowrap
                    ${form.frequency === opt.value
                      ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                      : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Completion Rules ─────────────────────────────────── */}
          <div>
            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest block mb-1.5">
              Completion Rules
            </label>

            <div className="flex gap-3">

              {/* Photo Proof card */}
              <button
                type="button"
                onClick={toggleProofRequired}
                className={`relative flex-1 flex flex-col items-center justify-center gap-1.5 h-[72px] rounded-2xl border-2 shadow-sm transition-all cursor-pointer
                  ${form.proof_required
                    ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:shadow-md'
                  }`}
              >
                <CameraIcon active={form.proof_required} />
                <span className="text-[11px] font-semibold leading-none">Photo Proof</span>
              </button>

              {/* Skip Approval (Auto-pay) card */}
              <div className="relative flex-1">
                <button
                  type="button"
                  onClick={toggleAutoApprove}
                  className={`relative w-full flex flex-col items-center justify-center gap-1.5 h-[72px] rounded-2xl border-2 shadow-sm transition-all cursor-pointer
                    ${form.auto_approve
                      ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:shadow-md'
                    }`}
                >
                  <BoltIcon active={form.auto_approve} />
                  <span className="text-[11px] font-semibold leading-none">Skip Approval</span>

                  {/* Info tooltip trigger — top-right corner */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="About Skip Approval"
                    onClick={e => { e.stopPropagation(); setShowTooltip(v => !v) }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setShowTooltip(v => !v) } }}
                    className="absolute top-1.5 right-2 w-4 h-4 rounded-full border border-current flex items-center justify-center text-[9px] font-bold opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    i
                  </span>
                </button>

                {/* Tooltip bubble */}
                {showTooltip && (
                  <div
                    className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-52 z-20 bg-[var(--color-text)] text-[var(--color-surface)] text-[11px] leading-relaxed px-3 py-2 rounded-xl shadow-lg"
                    onClick={() => setShowTooltip(false)}
                  >
                    Turn on to pay them the moment they finish. Leave off if you want to review their work first.
                    <span className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[var(--color-text)] rotate-45 rounded-sm" />
                  </div>
                )}
              </div>
            </div>

            {/* Conflict message — shown when trying to enable Auto-pay with Photo Proof on */}
            {conflictMsg && (
              <p className="mt-2 text-[11px] text-center text-[var(--color-text-muted)] italic">
                Tasks requiring photo proof usually need a quick look before paying!
              </p>
            )}
          </div>

          {/* ── Detailed instructions (collapsible) ─────────────── */}
          <div>
            <button
              type="button"
              onClick={() => setShowDesc(v => !v)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--brand-primary)] transition-colors cursor-pointer"
            >
              <span className={`inline-block transition-transform duration-150 ${showDesc ? 'rotate-90' : ''}`}>▶</span>
              {showDesc ? 'Hide' : 'Add'} detailed instructions
            </button>
            {showDesc && (
              <textarea
                className="mt-2 w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-[13px] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] resize-none transition"
                placeholder="Step-by-step instructions, standards expected…"
                rows={3}
                value={form.description}
                onChange={e => setField('description', e.target.value)}
              />
            )}
          </div>

          <div className="h-1" />
        </form>

        {/* Sticky CTA — always visible, never scrolls away */}
        <div className="shrink-0 px-4 py-3 bg-[var(--color-surface)] border-t border-[var(--color-border)]">
          <button
            type="submit"
            form=""
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
            className="w-full h-13 bg-[var(--brand-primary)] disabled:opacity-40 text-white font-extrabold text-[15px] rounded-2xl shadow-lg hover:brightness-90 active:scale-[0.98] transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <SpinnerIcon />
                Creating…
              </span>
            ) : ctaLabel}
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CameraIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  )
}

function BoltIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke={active ? 'none' : 'currentColor'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
    </svg>
  )
}
