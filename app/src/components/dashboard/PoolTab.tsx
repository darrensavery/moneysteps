// app/src/components/dashboard/PoolTab.tsx
import { useEffect, useState } from 'react';
import type { SharedExpense } from '../../lib/api';
import { apiUrl, authHeaders, getSharedExpenses } from '../../lib/api';
import { VoidExpenseSheet } from './VoidExpenseSheet';
import { ExpenseDetailSheet } from './ExpenseDetailSheet';
import { SkeletonList } from '../ui/Skeleton';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StickyActionBar } from '../ui/StickyActionBar';
import { Receipt } from 'lucide-react';

function CategoryIcon({ category, size = 14 }: { category: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (category) {
    case 'education':  return <svg {...p}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>;
    case 'health':     return <svg {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
    case 'clothing':   return <svg {...p}><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>;
    case 'travel':     return <svg {...p}><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21 4 19 4c0 0-1 0-3 1.5L8 9.2l-4.7-1.2c-.7-.2-1.3.6-.9 1.2l4 5.9c.4.6 1.2.8 1.8.4l1.9-1.2 2.5 2.5-1.2 1.9c-.4.6-.2 1.4.4 1.8l5.9 4c.6.4 1.4-.2 1.2-.9L17.8 19.2z"/></svg>;
    case 'activities': return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>;
    case 'childcare':  return <svg {...p}><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5.5 4.5 1.4"/><path d="M12 3c0 0 0 2-2 3"/></svg>;
    case 'food':       return <svg {...p}><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>;
    case 'tech':       return <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>;
    case 'gifts':      return <svg {...p}><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>;
    default:           return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>;
  }
}

function formatAmount(pence: number, currency: string): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : 'zł';
  return `${symbol}${(pence / 100).toFixed(2)}`;
}

function ledgerNote(
  expense: SharedExpense,
  _currentUserId: string,
): string {
  const loggedByName = expense.logged_by_name ?? 'Unknown';
  const authorisedByName = expense.authorised_by_name ?? '';
  if (expense.verification_status === 'committed_manual') {
    return `Logged by ${loggedByName}, Verified by ${authorisedByName}`;
  }
  if (expense.verification_status === 'pending') {
    return `Logged by ${loggedByName}, awaiting approval`;
  }
  return `Logged by ${loggedByName}`;
}

type SortKey = 'date-desc' | 'date-asc' | 'alpha-asc' | 'alpha-desc' | 'amount-desc' | 'amount-asc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date-desc',   label: 'Newest first' },
  { value: 'date-asc',    label: 'Oldest first' },
  { value: 'alpha-asc',   label: 'A → Z' },
  { value: 'alpha-desc',  label: 'Z → A' },
  { value: 'amount-desc', label: 'Highest amount' },
  { value: 'amount-asc',  label: 'Lowest amount' },
];

type Props = {
  familyId: string;
  currentUserId: string;
  parentingMode: 'single' | 'co-parenting';
  refreshKey?: number;
  onAddClick: () => void;
  onReconcileClick: (expenses: SharedExpense[]) => void;
};

export function PoolTab({ familyId, currentUserId, parentingMode, refreshKey, onAddClick, onReconcileClick }: Props) {
  const isCoParenting = parentingMode === 'co-parenting';
  const [expenses, setExpenses] = useState<SharedExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voidingExpense, setVoidingExpense] = useState<SharedExpense | null>(null);
  const [detailExpense, setDetailExpense] = useState<SharedExpense | null>(null);
  const [archiveSort, setArchiveSort] = useState<SortKey>('date-desc');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [removingExpense, setRemovingExpense] = useState<SharedExpense | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getSharedExpenses();
      setExpenses(data.expenses);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Couldn\'t load the shared expenses — check your connection.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [familyId, refreshKey]);

  async function handleApprove(id: number) {
    await fetch(apiUrl(`/api/shared-expenses/${id}/approve`), { method: 'POST', headers: await authHeaders() });
    load();
  }

  async function handleReject(id: number) {
    await fetch(apiUrl(`/api/shared-expenses/${id}/reject`), { method: 'POST', headers: await authHeaders() });
    load();
  }

  async function handleRemove(id: number) {
    await fetch(apiUrl(`/api/shared-expenses/${id}`), { method: 'DELETE', headers: await authHeaders() });
    load();
  }

  function exportCsv() {
    const settled = [...archiveBase].sort((a, b) => a.created_at - b.created_at);
    const rows = [
      ['Date', 'Description', 'Category', 'Amount', 'Currency', 'Logged By', 'Verified By', 'Settlement Period', 'Receipt'],
      ...settled.map(e => {
        const date = e.expense_date
          ? e.expense_date
          : new Date(e.created_at * 1000).toISOString().slice(0, 10);
        return [
          date,
          `"${e.description.replace(/"/g, '""')}"`,
          e.category,
          (e.total_amount / 100).toFixed(2),
          e.currency,
          e.logged_by_name ?? '',
          e.authorised_by_name ?? '',
          e.settlement_period ?? '',
          e.receipt_r2_key ? 'Yes' : 'No',
        ].join(',');
      }),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morechard-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  if (loading) return <div className="p-1"><SkeletonList count={4} withIcon={false} /></div>;
  if (error) return <div className="p-6 text-center text-red-500 text-sm">{error}</div>;

  const openExpenses = expenses.filter(
    e => !e.settlement_period && ['committed_auto', 'committed_manual'].includes(e.verification_status)
  );
  const pendingExpenses = expenses.filter(e => e.verification_status === 'pending');
  const flaggedExpenses = expenses.filter(e => e.verification_status === 'rejected');
  const voidedExpenses = expenses.filter(e => e.verification_status === 'voided');

  // Archive = committed expenses that have been settled (have a settlement_period)
  const archiveBase = expenses.filter(e =>
    ['committed_auto', 'committed_manual'].includes(e.verification_status) && e.settlement_period
  );

  // Sort within each group (alpha/amount sorts); date sorts control group order only
  const archiveSorted = [...archiveBase].sort((a, b) => {
    switch (archiveSort) {
      case 'alpha-asc':   return a.description.localeCompare(b.description);
      case 'alpha-desc':  return b.description.localeCompare(a.description);
      case 'amount-desc': return b.total_amount - a.total_amount;
      case 'amount-asc':  return a.total_amount - b.total_amount;
      default:            return b.created_at - a.created_at; // within group, default newest first
    }
  });

  // Group by settlement_period (YYYY-MM)
  const groupMap = new Map<string, SharedExpense[]>();
  for (const e of archiveSorted) {
    const key = e.settlement_period ?? e.expense_date?.slice(0, 7) ?? new Date(e.created_at * 1000).toISOString().slice(0, 7);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(e);
  }
  // Sort groups by period key
  const archiveGroups = [...groupMap.entries()].sort((a, b) =>
    archiveSort === 'date-asc' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])
  );

  let netPence = 0;
  for (const e of openExpenses) {
    const loggedByAmount = Math.round((e.total_amount * e.split_bp) / 10000);
    const otherAmount = e.total_amount - loggedByAmount;
    if (e.logged_by === currentUserId) {
      netPence -= otherAmount;
    } else {
      netPence += loggedByAmount;
    }
  }

  const currency = expenses[0]?.currency ?? 'GBP';

  return (
    <div className="flex flex-col gap-4 pb-48">

      {/* ── Sticky bottom action bar ─────────────────────────────────────────── */}
      <StickyActionBar>
        <button
          onClick={onAddClick}
          className="w-full h-11 flex items-center justify-center bg-[var(--brand-primary)] text-white font-bold rounded-xl text-[0.875rem] hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer shadow-lg"
        >
          {isCoParenting ? '+ Log shared expense' : '+ Log household expense'}
        </button>
      </StickyActionBar>

      {/* Running balance / month summary chip */}
      {openExpenses.length > 0 && (
        <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 flex items-center justify-between">
          <div className="flex-1 text-center">
            <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">This month</p>
            {isCoParenting ? (
              <p className={`text-2xl font-bold tabular-nums ${netPence < 0 ? 'text-green-600' : netPence > 0 ? 'text-red-500' : 'text-[var(--color-text)]'}`}>
                {netPence === 0 ? 'You are square' : netPence < 0
                  ? `You are owed ${formatAmount(Math.abs(netPence), currency)}`
                  : `You owe ${formatAmount(netPence, currency)}`}
              </p>
            ) : (
              <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">
                {formatAmount(openExpenses.reduce((s, e) => s + e.total_amount, 0), currency)}
              </p>
            )}
          </div>
          {isCoParenting && (
            <button
              onClick={() => onReconcileClick(openExpenses)}
              className="text-sm font-semibold text-[var(--brand-primary)] border border-[var(--brand-primary)] rounded-lg px-3 py-1.5 hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--brand-primary)_15%,transparent)] active:scale-[0.97] transition-all cursor-pointer"
            >
              Reconcile
            </button>
          )}
        </div>
      )}

      {/* Pending approvals — only relevant in co-parenting mode */}
      {isCoParenting && pendingExpenses.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            Needs your approval
          </h3>
          <div className="flex flex-col gap-2">
            {pendingExpenses.filter(e => e.logged_by !== currentUserId).map(e => (
              <PendingApprovalCard
                key={e.id}
                expense={e}
                currentUserId={currentUserId}
                onApprove={() => handleApprove(e.id)}
                onReject={() => handleReject(e.id)}
              />
            ))}
            {pendingExpenses.filter(e => e.logged_by === currentUserId).map(e => (
              <div key={e.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] card-depth p-4 opacity-70">
                <p className="font-semibold text-sm"><span className="inline-flex items-center gap-1.5"><CategoryIcon category={e.category} />{e.description}</span></p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Awaiting other parent's approval</p>
                <p className="text-sm font-bold tabular-nums mt-1">{formatAmount(e.total_amount, e.currency)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Flagged (rejected) expenses */}
      {flaggedExpenses.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">Flagged</h3>
          <div className="flex flex-col gap-2">
            {flaggedExpenses.map(e => (
              <div key={e.id} className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 card-depth p-4 opacity-80">
                <div className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0"><CategoryIcon category={e.category} /></span>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm line-through text-[var(--color-text-muted)]">{e.description}</p>
                    <p className="text-xs text-red-500 mt-0.5">Rejected — please discuss and re-submit if agreed</p>
                    <p className="text-sm font-bold tabular-nums mt-1 text-[var(--color-text-muted)]">
                      {formatAmount(e.total_amount, e.currency)}
                    </p>
                    {e.logged_by === currentUserId && (
                      <button
                        onClick={() => setRemovingExpense(e)}
                        className="mt-2 text-xs text-red-600 underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Open period committed expenses */}
      {openExpenses.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">
            {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h3>
          <div className="flex flex-col gap-2">
            {openExpenses.map(e => {
              const loggedByAmount = Math.round((e.total_amount * e.split_bp) / 10000);
              const otherAmount = e.total_amount - loggedByAmount;
              const myAmount = e.logged_by === currentUserId ? loggedByAmount : otherAmount;
              const uneven = loggedByAmount !== otherAmount;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setDetailExpense(e)}
                  className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] card-depth p-4 hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-surface-alt)] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 flex items-start gap-1.5">
                      <span className="mt-0.5 shrink-0"><CategoryIcon category={e.category} /></span>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm flex items-center gap-1">
                          <span className="truncate">{e.description}</span>
                          {e.receipt_r2_key && (
                            <Receipt size={11} className="text-[var(--brand-primary)] shrink-0" aria-label="Has receipt" />
                          )}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{ledgerNote(e, currentUserId)}</p>
                        {isCoParenting && uneven && (
                          <p className="text-[0.625rem] text-[var(--color-text-muted)] mt-0.5 italic">
                            Your share: {formatAmount(myAmount, e.currency)}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="text-sm font-bold tabular-nums shrink-0">{formatAmount(e.total_amount, e.currency)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Voided expenses — only relevant in co-parenting mode */}
      {isCoParenting && voidedExpenses.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-2">Voided</h3>
          <div className="flex flex-col gap-2">
            {voidedExpenses.map(e => (
              <div key={e.id} className="rounded-xl border border-[var(--color-border)] p-4 opacity-60">
                <p className="text-sm line-through text-[var(--color-text-muted)]">{e.description}</p>
                {e.note && <p className="text-xs text-[var(--color-text-muted)] mt-0.5 italic">{e.note}</p>}
                {e.voided_at && <p className="text-xs text-[var(--color-text-muted)]">Voided {new Date(e.voided_at * 1000).toLocaleDateString()}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Archive — all historical committed expenses, grouped by month */}
      {archiveBase.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setArchiveOpen(o => !o)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                Archive ({archiveBase.length})
              </h3>
              <span className="text-xs text-[var(--color-text-muted)]">{archiveOpen ? '▲' : '▼'}</span>
            </button>
            {archiveBase.length > 0 && (
              <button
                type="button"
                onClick={exportCsv}
                className="text-xs font-semibold text-[var(--brand-primary)] border border-[var(--brand-primary)] rounded-lg px-2.5 py-1 hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
              >
                Export CSV
              </button>
            )}
          </div>

          {archiveOpen && (
            <>
              {/* Sort control */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-[var(--color-text-muted)] shrink-0">Sort:</span>
                <select
                  value={archiveSort}
                  onChange={e => setArchiveSort(e.target.value as SortKey)}
                  className="text-xs bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-lg px-2 py-1 text-[var(--color-text)] focus:outline-none cursor-pointer"
                >
                  {SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-4">
                {archiveGroups.map(([period, items]) => {
                  const monthLabel = new Date(period + '-02').toLocaleString('default', { month: 'long', year: 'numeric' });
                  const monthTotal = items.reduce((s, e) => s + e.total_amount, 0);
                  const groupCurrency = items[0]?.currency ?? currency;
                  return (
                    <div key={period}>
                      {/* Month header */}
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">{monthLabel}</p>
                        <p className="text-xs font-bold tabular-nums text-[var(--color-text-muted)]">{formatAmount(monthTotal, groupCurrency)}</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        {items.map(e => {
                          const dateStr = e.expense_date
                            ? new Date(e.expense_date).toLocaleDateString('default', { day: 'numeric', month: 'short' })
                            : new Date(e.created_at * 1000).toLocaleDateString('default', { day: 'numeric', month: 'short' });
                          return (
                            <button
                              key={e.id}
                              type="button"
                              onClick={() => setDetailExpense(e)}
                              className="w-full text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] card-depth p-4 opacity-75 hover:opacity-100 hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-text-muted)] transition-all cursor-pointer"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0 flex items-start gap-1.5">
                                  <span className="mt-0.5 shrink-0"><CategoryIcon category={e.category} /></span>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-sm flex items-center gap-1">
                                      <span className="truncate">{e.description}</span>
                                      {e.receipt_r2_key && (
                                        <Receipt size={11} className="text-[var(--brand-primary)] shrink-0" aria-label="Has receipt" />
                                      )}
                                    </p>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{dateStr}</p>
                                  </div>
                                </div>
                                <p className="text-sm font-bold tabular-nums text-[var(--color-text-muted)]">
                                  {formatAmount(e.total_amount, e.currency)}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {expenses.length === 0 && (
        <div className="pt-2">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3" style={{ boxShadow: 'var(--shadow-card)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--color-surface-alt)] flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <p className="text-[0.875rem] font-bold text-[var(--color-text)] leading-snug">
                {isCoParenting ? 'Track shared child expenses' : 'Track household expenses'}
              </p>
            </div>
            <div>
              <p className="text-[0.75rem] text-[var(--color-text-muted)] leading-relaxed">
                {isCoParenting
                  ? 'Log costs you share for your child — school trips, clubs, clothing, medical. Each expense is split between you and your co-parent and kept in an immutable record you can both refer to.'
                  : 'Keep a running record of what you spend on your child — school trips, activities, clothing, and more. Every entry is logged and archived by month for easy reference.'}
              </p>
            </div>
            <div className="space-y-1.5 pt-1">
              {[
                isCoParenting ? 'Log an expense and your co-parent approves it' : 'Tap "+ Log household expense" to add your first entry',
                isCoParenting ? 'Both parents can view, approve, or flag entries' : 'Expenses are organised by month in the archive',
                'Attach a photo receipt to any entry for proof',
                'Export to CSV any time for your records',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[color-mix(in_srgb,var(--brand-primary)_15%,transparent)] text-[var(--brand-primary)] flex items-center justify-center text-[0.625rem] font-bold mt-0.5">{i + 1}</span>
                  <p className="text-[0.75rem] text-[var(--color-text-muted)] leading-snug">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {voidingExpense && (
        <VoidExpenseSheet
          expenseId={voidingExpense.id}
          description={voidingExpense.description}
          onClose={() => setVoidingExpense(null)}
          onVoided={() => { setVoidingExpense(null); load(); }}
        />
      )}

      {detailExpense && (
        <ExpenseDetailSheet
          expense={detailExpense}
          currentUserId={currentUserId}
          isCoParenting={isCoParenting}
          onClose={() => setDetailExpense(null)}
          onVoid={detailExpense.logged_by === currentUserId ? () => {
            setVoidingExpense(detailExpense);
            setDetailExpense(null);
          } : undefined}
        />
      )}

      {removingExpense && (
        <ConfirmDialog
          title="Remove this flagged expense?"
          description={`"${removingExpense.description}" will be permanently removed from the pool.`}
          confirmLabel="Remove"
          onConfirm={() => { handleRemove(removingExpense.id); setRemovingExpense(null); }}
          onCancel={() => setRemovingExpense(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PendingApprovalCard({ expense: e, onApprove, onReject }: {
  expense: SharedExpense;
  currentUserId: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4"
      style={{
        boxShadow: hovered ? 'var(--shadow-card-hover)' : 'var(--shadow-card)',
        backgroundColor: hovered ? 'color-mix(in srgb, #fef3c7 90%, transparent)' : undefined,
        transition: 'box-shadow 200ms ease, background-color 200ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">
            <span className="inline-flex items-center gap-1.5">
              <CategoryIcon category={e.category} />
              {e.description}
              {e.receipt_r2_key && <Receipt size={11} className="text-[var(--brand-primary)] shrink-0" />}
            </span>
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {e.logged_by_name ? `Logged by ${e.logged_by_name}` : 'Logged by other parent'}
          </p>
          <p className="text-sm font-bold tabular-nums mt-1">{formatAmount(e.total_amount, e.currency)}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => { if (navigator.vibrate) navigator.vibrate(50); onApprove(); }}
          className="flex-1 bg-[var(--brand-primary)] text-white text-sm font-semibold py-1.5 rounded-lg hover:opacity-90 active:opacity-80 active:scale-[0.97] transition-all cursor-pointer"
        >
          Approve
        </button>
        <button
          onClick={onReject}
          className="flex-1 border border-red-400 text-red-600 text-sm font-semibold py-1.5 rounded-lg hover:bg-red-50 hover:border-red-500 active:bg-red-100 active:scale-[0.97] transition-all cursor-pointer"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
