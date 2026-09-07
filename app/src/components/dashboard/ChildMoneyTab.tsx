import { useState, useEffect, useCallback } from 'react'
import type { BalanceSummary, Goal, SpendingRecord, JarBalances, JarConfig, ChildNudge } from '../../lib/api'
import { getBalance, getGoals, getSpending, getJars, formatCurrency } from '../../lib/api'
import { ChildNudgeBanner } from '../child/ChildNudgeBanner'
import { spendCategoryHeading } from '../../lib/spendCategories'
import { ChildHistoryTab } from './ChildHistoryTab'
import { SpendGuideSheet } from './SpendGuideSheet'
import { JarCard } from './JarCard'
import { JarDetailSheet } from './JarDetailSheet'
import { JarSettingsSheet } from './JarSettingsSheet'
import { JarOnboardingWizard } from './JarOnboardingWizard'
import { GiveRequestSheet } from './GiveRequestSheet'
import { Button } from '../ui/button'
import { StickyActionBar } from '../ui/StickyActionBar'

interface Props {
  familyId:       string
  childId:        string
  currency:       string
  appView:        'ORCHARD' | 'CLEAN'
  nudge?:         ChildNudge | null
  onNudgeDismiss?: () => void
}

function fmtDate(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function ChildMoneyTab({ familyId, childId, currency, appView, nudge, onNudgeDismiss }: Props) {
  const [balance,     setBalance]     = useState<BalanceSummary | null>(null)
  const [goals,       setGoals]       = useState<Goal[]>([])
  const [spending,    setSpending]    = useState<SpendingRecord[]>([])
  const [loading,     setLoading]     = useState(true)
  const [logOpen,          setLogOpen]          = useState(false)
  const [jarBalances,      setJarBalances]      = useState<JarBalances | null>(null)
  const [jarConfig,        setJarConfig]        = useState<JarConfig | null>(null)
  const [activeJar,        setActiveJar]        = useState<'spend' | 'save' | 'give' | null>(null)
  const [showGiveRequest,  setShowGiveRequest]  = useState(false)
  const [showSettings,     setShowSettings]     = useState(false)
  const [showWizard,       setShowWizard]       = useState(false)
  const [_pendingConfig,   setPendingConfig]     = useState<{ spend: number; save: number; give: number } | null>(null)

  // `silent` skips the loading swap so background polls refresh data in place
  // without flashing the balance hero back to "£—" every 30s.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [b, g, s] = await Promise.all([
        getBalance(familyId, childId),
        getGoals(familyId, childId).then(r => r.goals).catch(() => [] as Goal[]),
        getSpending(familyId, childId).then(r => r.spending).catch(() => [] as SpendingRecord[]),
      ])
      setBalance(b)
      setGoals(g)
      setSpending(s)
    } catch { /* silently degrade */ }
    finally { setLoading(false) }
    // Jars load independently — failure must not affect the main money view
    getJars(familyId, childId).then(({ config, balances }) => {
      setJarConfig(config)
      if (balances.enabled) setJarBalances(balances)
      else setJarBalances(null)
    }).catch(() => {})
  }, [familyId, childId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(() => load(true), 30_000)
    const onVisible = () => { if (!document.hidden) load(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  const saved = goals
    .filter(g => g.status === 'ACTIVE' || !g.status)
    .reduce((s, g) => s + (g.current_saved_pence ?? 0), 0)

  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : 'zł'

  function handleSaved() {
    setLogOpen(false)
    load()
  }

  return (
    <div className="space-y-4 pb-48">

      {/* AI Mentor money nudge */}
      {nudge && onNudgeDismiss && (
        <ChildNudgeBanner nudge={nudge} appView={appView} onDismiss={onNudgeDismiss} />
      )}

      {/* Balance hero — replaced by jar cards when jars are enabled */}
      {jarBalances?.enabled ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[0.75rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">My jars</span>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="p-1.5 rounded-lg hover:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
              aria-label="Jar settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
          <div className="flex gap-2.5">
            <JarCard jar="spend" balances={jarBalances} currency={currency} onClick={setActiveJar} />
            <JarCard jar="save"  balances={jarBalances} currency={currency} onClick={setActiveJar} />
            <JarCard jar="give"  balances={jarBalances} currency={currency} onClick={setActiveJar} />
          </div>
        </div>
      ) : (
        <div className="bg-[var(--color-surface)] rounded-2xl card-depth border-t-[3px] border-t-[var(--brand-primary)] border border-[var(--color-border)] p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[0.75rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
              Available to spend
            </div>
            {jarConfig && (
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
                aria-label="Set up jars"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
            )}
          </div>
          <div className="text-[2.875rem] font-extrabold text-[var(--color-text)] leading-none tracking-tight tabular-nums">
            {loading || !balance ? `${symbol}—` : formatCurrency(balance.available, currency)}
          </div>
          {(balance?.pending ?? 0) > 0 && (
            <p className="text-[0.8125rem] text-[var(--color-text-muted)] mt-2">
              Pending approval:{' '}
              <strong className="text-amber-500 tabular-nums">
                {formatCurrency(balance!.pending, currency)}
              </strong>
            </p>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <StatCard label="Earned" value={loading || !balance ? '—' : formatCurrency(balance.earned, currency)} tone="brand" />
        <StatCard label="Spent"  value={loading || !balance ? '—' : formatCurrency(balance.spent,  currency)} tone="muted" />
        <StatCard label="Saved"  value={loading             ? '—' : formatCurrency(saved,           currency)} tone="muted" />
      </div>

      {/* Spending history */}
      {spending.length > 0 && (
        <SpendingHistory spending={spending} currency={currency} />
      )}

      {/* Earnings history (chore completions) */}
      <ChildHistoryTab
        familyId={familyId}
        childId={childId}
        currency={currency}
        variant="money"
      />

      {/* Log a spend — fixed above bottom nav dock */}
      <StickyActionBar>
        <Button onClick={() => setLogOpen(true)} className="w-full shadow-lg">
          {appView === 'CLEAN' ? 'Log a spend' : '💸 Log a spend'}
        </Button>
      </StickyActionBar>

      <SpendGuideSheet
        open={logOpen}
        familyId={familyId}
        childId={childId}
        currency={currency}
        appView={appView}
        availableBalancePence={balance?.available ?? 0}
        onClose={() => setLogOpen(false)}
        onSaved={handleSaved}
      />

      {activeJar && jarBalances && (
        <JarDetailSheet
          jar={activeJar}
          balances={jarBalances}
          currency={currency}
          familyId={familyId}
          childId={childId}
          onClose={() => setActiveJar(null)}
          onBalanceChange={(updated) => { setJarBalances(updated); }}
          onGiveRequest={() => { setActiveJar(null); setShowGiveRequest(true); }}
          onViewGoals={() => { setActiveJar(null); /* Task 13: switch to goals tab */ }}
        />
      )}

      {showSettings && jarConfig && (
        <JarSettingsSheet
          config={jarConfig}
          familyId={familyId}
          childId={childId}
          onClose={() => setShowSettings(false)}
          onSaved={(b) => { setJarBalances(b); setShowSettings(false); load(true); }}
          onFirstEnable={() => {
            setPendingConfig({ spend: jarConfig.spend_pct, save: jarConfig.save_pct, give: jarConfig.give_pct });
            setShowSettings(false);
            setShowWizard(true);
          }}
        />
      )}

      {showGiveRequest && jarBalances && (
        <GiveRequestSheet
          giveBalance={jarBalances.give}
          currency={currency}
          familyId={familyId}
          childId={childId}
          onClose={() => setShowGiveRequest(false)}
          onSubmitted={() => { setShowGiveRequest(false); load(true); }}
        />
      )}

      {showWizard && (
        <JarOnboardingWizard
          availableBalance={balance?.available ?? 0}
          currency={currency}
          familyId={familyId}
          childId={childId}
          onComplete={(b) => { setJarBalances(b); setShowWizard(false); load(true); }}
          onCancel={() => setShowWizard(false)}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: 'brand' | 'muted' }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-3 py-3 text-center">
      <p className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-[0.9375rem] font-extrabold tabular-nums ${tone === 'brand' ? 'text-[var(--brand-accent)]' : 'text-[var(--color-text)]'}`}>
        {value}
      </p>
    </div>
  )
}

function SpendingHistory({ spending, currency }: { spending: SpendingRecord[]; currency: string }) {
  const [open, setOpen] = useState(true)
  const total = spending.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[color-mix(in_srgb,var(--color-surface-alt)_70%,var(--color-border))] hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_55%,var(--color-border))] transition-colors cursor-pointer border-b border-[var(--color-border)]"
      >
        <div className="flex items-center gap-2">
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`text-[var(--color-text-muted)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          >
            <path d="M9 18l6-6-6-6"/>
          </svg>
          <span className="text-[0.8125rem] font-bold text-[var(--color-text)]">My spending</span>
          <span className="text-[0.6875rem] text-[var(--color-text-muted)]">
            ({spending.length} item{spending.length !== 1 ? 's' : ''})
          </span>
        </div>
        <span className="text-[0.8125rem] font-bold tabular-nums text-red-400">
          −{formatCurrency(total, currency)}
        </span>
      </button>

      {open && (
        <div className="divide-y divide-[var(--color-border)]">
          {spending.map(record => (
            <div key={record.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-semibold text-[var(--color-text)] truncate">
                  {record.title}
                </p>
                <p className="text-[0.6875rem] text-[var(--color-text-muted)] mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className="rounded-full bg-[var(--color-surface-alt)] px-1.5 py-0.5 text-[0.625rem] font-semibold text-[var(--color-text-muted)]">
                    {spendCategoryHeading(record.category)}
                  </span>
                  {fmtDate(record.spent_at)}
                  {record.note && (
                    <span className="italic">· {record.note}</span>
                  )}
                </p>
              </div>
              <span className="text-[0.875rem] font-bold tabular-nums text-red-400 shrink-0">
                −{formatCurrency(record.amount, record.currency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
