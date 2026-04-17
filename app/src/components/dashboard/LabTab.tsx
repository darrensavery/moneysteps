// app/src/components/dashboard/LabTab.tsx
// The Orchard Learning Lab — chat input, history feed, module grid.

import { useState, useEffect, useRef } from 'react'
import {
  postChat, getChatHistory, getChatModules,
  type ChatHistoryItem, type MentorResponse,
} from '../../lib/api'

// ─── Module catalogue (Phase 1+2: one module) ────────────────────

interface ModuleDef {
  slug:        string
  title:       string
  description: string
  triggerHint: string
  content:     string
}

const MODULE_CATALOGUE: ModuleDef[] = [
  {
    slug:        'compound-interest',
    title:       'The Snowball',
    description: 'How money grows when you leave it alone.',
    triggerHint: 'Ask us about growing your money',
    content:     'When you save money and leave it alone, it starts to grow on its own. This is called compound interest. Imagine you plant a seed and instead of picking the fruit, you let it fall back into the ground. Next season, you have two trees. Then four. The longer you wait, the faster it grows. A £50 saving today, left untouched at 5% interest, becomes £81 in ten years — without a single extra chore. The secret is simply: wait.',
  },
]

// ─── Pillar badge colours ─────────────────────────────────────────

const PILLAR_COLOURS: Record<string, string> = {
  LABOR_VALUE:           'bg-amber-100 text-amber-800',
  DELAYED_GRATIFICATION: 'bg-blue-100 text-blue-800',
  OPPORTUNITY_COST:      'bg-orange-100 text-orange-800',
  CAPITAL_MANAGEMENT:    'bg-green-100 text-green-800',
  SOCIAL_RESPONSIBILITY: 'bg-purple-100 text-purple-800',
}

const PILLAR_LABELS: Record<string, string> = {
  LABOR_VALUE:           'Labour Value',
  DELAYED_GRATIFICATION: 'Patience',
  OPPORTUNITY_COST:      'Trade-offs',
  CAPITAL_MANAGEMENT:    'Growth',
  SOCIAL_RESPONSIBILITY: 'Giving',
}

// ─── Props ────────────────────────────────────────────────────────

interface LabTabProps {
  childId: string
  appView: 'ORCHARD' | 'CLEAN'
}

// ─── Component ───────────────────────────────────────────────────

export function LabTab({ appView }: LabTabProps) {
  const [history,        setHistory]        = useState<ChatHistoryItem[]>([])
  const [unlockedSlugs,  setUnlockedSlugs]  = useState<string[]>([])
  const [loading,        setLoading]        = useState(true)
  const [historyError,   setHistoryError]   = useState<string | null>(null)
  const [modulesError,   setModulesError]   = useState<string | null>(null)
  const [inputValue,     setInputValue]     = useState('')
  const [sending,        setSending]        = useState(false)
  const [sendError,      setSendError]      = useState<string | null>(null)
  const [historyOffset,  setHistoryOffset]  = useState(0)
  const [hasMore,        setHasMore]        = useState(false)
  const [loadingMore,    setLoadingMore]    = useState(false)
  const [activeModule,   setActiveModule]   = useState<ModuleDef | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  // ── Load history + modules in parallel on mount ────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setHistoryError(null)
    setModulesError(null)

    Promise.all([
      getChatHistory(20, 0).catch(() => {
        if (!cancelled) setHistoryError('History could not be loaded.')
        return null
      }),
      getChatModules().catch(() => {
        if (!cancelled) setModulesError('Modules could not be loaded.')
        return null
      }),
    ]).then(([histRes, modRes]) => {
      if (cancelled) return
      if (histRes) {
        setHistory(histRes.history)
        setHasMore(histRes.history.length === 20)
      }
      if (modRes) {
        setUnlockedSlugs(modRes.modules.map(m => m.module_slug))
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  // ── Open/close dialog ─────────────────────────────────────────
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (activeModule) {
      if (!el.open) el.showModal()
    } else {
      if (el.open) el.close()
    }
  }, [activeModule])

  // ── Send message ──────────────────────────────────────────────
  async function handleSend() {
    const msg = inputValue.trim()
    if (!msg || sending) return
    setSending(true)
    setSendError(null)
    setInputValue('')

    try {
      const res: MentorResponse = await postChat(msg)

      const newItem: ChatHistoryItem = {
        id:          crypto.randomUUID(),
        message:     msg,
        reply:       res.reply,
        pillar:      res.pillar,
        unlock_slug: res.unlock_slug ?? null,
        app_view:    res.app_view,
        locale:      res.locale,
        created_at:  Math.floor(Date.now() / 1000),
      }

      setHistory(prev => [newItem, ...prev])

      if (res.unlock_slug && !unlockedSlugs.includes(res.unlock_slug)) {
        setUnlockedSlugs(prev => [...prev, res.unlock_slug!])
      }
    } catch {
      setSendError('Message could not be sent. Please try again.')
      setInputValue(msg) // restore so user doesn't lose their message
    } finally {
      setSending(false)
    }
  }

  // ── Load more history ─────────────────────────────────────────
  async function handleLoadMore() {
    if (loadingMore) return
    setLoadingMore(true)
    const nextOffset = historyOffset + 20
    try {
      const res = await getChatHistory(20, nextOffset)
      setHistory(prev => [...prev, ...res.history])
      setHistoryOffset(nextOffset)
      setHasMore(res.history.length === 20)
    } catch {
      // silent — user can retry
    } finally {
      setLoadingMore(false)
    }
  }

  // ── Skeleton ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-[var(--color-text-muted)] text-center py-2">
          {appView === 'ORCHARD' ? 'Consulting the Mentor...' : 'Loading your history...'}
        </p>
        {/* History skeletons */}
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded-xl bg-[var(--color-border)] h-20" />
          ))}
        </div>
        {/* Module skeleton */}
        <div className="animate-pulse rounded-xl bg-[var(--color-border)] h-24 mt-2" />
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">

      {/* ── Chat Input ── */}
      <div className="flex gap-2 items-end">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
          placeholder={appView === 'ORCHARD' ? 'Ask your Mentor...' : 'Ask a question...'}
          disabled={sending}
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--brand-primary)] disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={sending || !inputValue.trim()}
          className="rounded-xl bg-[var(--brand-primary)] text-white px-4 py-2.5 text-[13px] font-semibold disabled:opacity-40 cursor-pointer"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
      {sendError && (
        <p className="text-[12px] text-red-500 -mt-3">{sendError}</p>
      )}

      {/* ── History Feed ── */}
      <section>
        <h2 className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
          History
        </h2>
        {historyError ? (
          <p className="text-[13px] text-red-500">{historyError}</p>
        ) : history.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {appView === 'ORCHARD'
              ? 'No conversations yet. Ask the Mentor anything! 🌱'
              : 'No conversations yet. Send a message to get started.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map(item => (
              <div
                key={item.id}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 flex flex-col gap-1.5"
              >
                {/* User bubble */}
                <p className="text-[12px] text-[var(--color-text-muted)] text-right">{item.message}</p>
                {/* Pillar badge */}
                <span className={`self-start text-[10px] font-semibold px-2 py-0.5 rounded-full ${PILLAR_COLOURS[item.pillar] ?? 'bg-gray-100 text-gray-700'}`}>
                  {PILLAR_LABELS[item.pillar] ?? item.pillar}
                </span>
                {/* Reply */}
                <p className="text-[13px] text-[var(--color-text)] leading-snug">{item.reply}</p>
                {/* Unlock indicator */}
                {item.unlock_slug && (
                  <p className="text-[11px] text-[var(--brand-primary)] font-semibold">🔓 New module unlocked</p>
                )}
              </div>
            ))}

            {/* Load more */}
            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-[13px] text-[var(--brand-primary)] font-semibold py-2 disabled:opacity-40 cursor-pointer"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Module Grid ── */}
      <section>
        <h2 className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
          Your Modules
        </h2>
        {modulesError ? (
          <p className="text-[13px] text-red-500">{modulesError}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {MODULE_CATALOGUE.map(mod => {
              const isUnlocked = unlockedSlugs.includes(mod.slug)
              return (
                <button
                  key={mod.slug}
                  onClick={() => isUnlocked && setActiveModule(mod)}
                  disabled={!isUnlocked}
                  className={`text-left rounded-xl border p-4 transition-colors cursor-pointer
                    ${isUnlocked
                      ? 'border-[var(--brand-primary)] bg-[var(--color-surface)] hover:bg-[var(--color-border)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] opacity-50 cursor-default grayscale'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[14px] font-bold text-[var(--color-text)]">{mod.title}</p>
                      <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                        {isUnlocked ? mod.description : mod.triggerHint}
                      </p>
                    </div>
                    <span className="text-[18px] flex-shrink-0 mt-0.5">
                      {isUnlocked ? '📖' : '🔒'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Module Detail Dialog ── */}
      <dialog
        ref={dialogRef}
        onClose={() => setActiveModule(null)}
        className="fixed inset-0 m-auto w-full max-w-[520px] rounded-t-2xl rounded-b-none sm:rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-0 shadow-xl backdrop:bg-black/50 max-h-[80vh] overflow-y-auto"
        style={{ bottom: 0, top: 'auto', left: 0, right: 0, maxWidth: '520px', margin: '0 auto' }}
      >
        {activeModule && (
          <div className="p-5 flex flex-col gap-4">
            {/* Header with explicit close button — min 44×44px tap target */}
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[18px] font-extrabold text-[var(--color-text)]">{activeModule.title}</h3>
              <button
                onClick={() => setActiveModule(null)}
                className="w-11 h-11 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] text-[22px] leading-none flex-shrink-0 cursor-pointer"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {/* Content */}
            <p className="text-[14px] text-[var(--color-text)] leading-relaxed">{activeModule.content}</p>
            {/* Bottom close button — large, explicit */}
            <button
              onClick={() => setActiveModule(null)}
              className="w-full py-3 rounded-xl bg-[var(--brand-primary)] text-white text-[14px] font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        )}
      </dialog>

    </div>
  )
}
