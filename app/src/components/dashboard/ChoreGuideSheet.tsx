// app/src/components/dashboard/ChoreGuideSheet.tsx
import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMarketRates, fuzzyMatch } from '../../hooks/useMarketRates';
import { ErrorBox } from '../ui/ErrorBox';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { useDragToClose } from '../../hooks/useDragToClose';
import { tick } from '../../lib/haptics';
import { createSuggestion, suggestChore, getSuggestions } from '../../lib/api';
import type { MarketRate, Suggestion } from '../../lib/api';
import { currencySymbol } from '../../lib/locale';

interface NewChoreForm {
  title: string;
  amount: string;
  dueDate: string;
  reason: string;
}

// ── Filter + sort (mirrors the parent Rate Guide so the two stay consistent) ──
type SortKey = 'alpha' | 'category' | 'price_asc' | 'price_desc' | 'popularity';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'alpha',      label: 'A–Z'      },
  { value: 'category',   label: 'Category' },
  { value: 'price_asc',  label: 'Price ↑'  },
  { value: 'price_desc', label: 'Price ↓'  },
  { value: 'popularity', label: 'Popular'  },
];

function sortRates(rates: MarketRate[], sort: SortKey): MarketRate[] {
  const sorted = [...rates];
  switch (sort) {
    case 'alpha':
      return sorted.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
    case 'category':
      return sorted.sort((a, b) =>
        a.category.localeCompare(b.category) || a.canonical_name.localeCompare(b.canonical_name)
      );
    case 'price_asc':
      return sorted.sort((a, b) => (a.median_amount ?? 0) - (b.median_amount ?? 0));
    case 'price_desc':
      return sorted.sort((a, b) => (b.median_amount ?? 0) - (a.median_amount ?? 0));
    case 'popularity':
      return sorted.sort((a, b) => b.sample_count - a.sample_count);
  }
}

const CATEGORIES: { label: string; icon: string }[] = [
  { label: 'All',               icon: '✦'  },
  { label: 'Outdoor Work',      icon: '🌿' },
  { label: 'Cleaning',          icon: '🧹' },
  { label: 'Kitchen',           icon: '🍽' },
  { label: 'Laundry',           icon: '👕' },
  { label: 'Tidying',           icon: '📦' },
  { label: 'Garden',            icon: '🌱' },
  { label: 'Pets',              icon: '🐾' },
  { label: 'Errands',           icon: '🛒' },
  { label: 'Learning & Skills', icon: '📚' },
  { label: 'Good Habits',       icon: '⭐' },
];

function formatAmount(amount: number | null, symbol: string): string {
  if (amount == null) return '—';
  return `${symbol}${(amount / 100).toFixed(2)}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pass when used in child context — enables suggest-to-parent flow */
  familyId?: string;
  /** Optional: module slug passed when navigating from a Learning Lab module */
  context?: string | null;
  currency?: string;
  /** Child's app view — gates orchard metaphors out of CLEAN mode */
  appView?: 'ORCHARD' | 'CLEAN';
}

export function ChoreGuideSheet({ open, onClose, familyId, context = null, currency = 'GBP', appView = 'ORCHARD' }: Props) {
  const { rates, loading, error } = useMarketRates(currency);

  const symbol      = currencySymbol(currency);
  const regionLabel = currency === 'PLN' ? 'Poland' : currency === 'USD' ? 'the US' : 'your area';
  const isOrchard   = appView !== 'CLEAN';

  // List filter / sort state
  const [search,   setSearch]   = useState('');
  const [category, setCategory] = useState('All');
  const [sort,     setSort]     = useState<SortKey>('alpha');

  // List-level state
  const [suggested, setSuggested] = useState<string | null>(null);
  const [success,   setSuccess]   = useState(false);

  // My suggestions (child context — loads all statuses to show feedback)
  const [mySuggestions, setMySuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (!open || !familyId) return;
    Promise.all([
      getSuggestions(familyId, 'pending'),
      getSuggestions(familyId, 'approved'),
      getSuggestions(familyId, 'rejected'),
    ]).then(([p, a, r]) => {
      setMySuggestions([...p.suggestions, ...a.suggestions, ...r.suggestions]
        .sort((x, y) => y.submitted_at - x.submitted_at));
    }).catch(() => { /* degrade silently */ });
  }, [open, familyId]);

  // Lock body scroll while open so the page behind can't be dragged (iOS rubber-banding)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // New chore suggestion state (child context only)
  const [newChoreOpen, setNewChoreOpen] = useState(false);
  const [newChore, setNewChore] = useState<NewChoreForm>({ title: '', amount: '', dueDate: '', reason: '' });
  const [newChoreBusy, setNewChoreBusy] = useState(false);
  const [newChoreError, setNewChoreError] = useState<string | null>(null);

  // Amount-edit sheet state
  const [editRate,   setEditRate]   = useState<MarketRate | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editBusy,   setEditBusy]   = useState(false);
  const [editError,  setEditError]  = useState<string | null>(null);

  useAndroidBack(open && !editRate && !newChoreOpen, onClose);
  useAndroidBack(!!editRate, () => { setEditRate(null); setEditError(null); });
  useAndroidBack(newChoreOpen && !editRate, () => { setNewChoreOpen(false); setNewChoreError(null); });

  const closeNewChore = () => { void tick(); setNewChoreOpen(false); setNewChoreError(null); }
  const { sheetRef: newChoreSheetRef, handleProps: newChoreHandleProps } = useDragToClose(closeNewChore)

  const closeEditRate = () => { void tick(); setEditRate(null); setEditError(null); }
  const { sheetRef: editRateSheetRef, handleProps: editRateHandleProps } = useDragToClose(closeEditRate)

  useEffect(() => {
    if (!newChoreOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeNewChore();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [newChoreOpen]);

  useEffect(() => {
    if (!editRate) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeEditRate();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editRate]);

  async function handleNewChoreSuggest() {
    if (!familyId) return;
    const title = newChore.title.trim();
    if (!title) { setNewChoreError('Please enter a chore name.'); return; }
    const pence = Math.round(parseFloat(newChore.amount) * 100);
    if (!newChore.amount || isNaN(pence) || pence <= 0) { setNewChoreError('Please enter how much it should pay.'); return; }
    setNewChoreBusy(true);
    setNewChoreError(null);
    try {
      await createSuggestion({
        family_id:       familyId,
        title,
        proposed_amount: pence,
        due_date:        newChore.dueDate || undefined,
        reason:          newChore.reason.trim() || undefined,
      });
      setNewChoreOpen(false);
      setNewChore({ title: '', amount: '', dueDate: '', reason: '' });
      setSuccess(true);
    } catch {
      setNewChoreError('Something went wrong — please try again.');
    } finally {
      setNewChoreBusy(false);
    }
  }

  const filtered: MarketRate[] = useMemo(() => {
    const base = rates.filter(r => {
      const matchesCategory = category === 'All' || r.category === category;
      const matchesSearch   = fuzzyMatch(r, search);
      return matchesCategory && matchesSearch;
    });
    return sortRates(base, sort);
  }, [rates, search, category, sort]);

  function openEdit(rate: MarketRate) {
    setEditRate(rate);
    setEditAmount(rate.median_amount != null ? (rate.median_amount / 100).toFixed(2) : '');
    setEditReason('');
    setEditError(null);
  }

  async function handleConfirmSuggest() {
    if (!editRate) return;
    const pence = Math.round(parseFloat(editAmount) * 100);
    if (!editAmount || isNaN(pence) || pence <= 0) {
      setEditError('Please enter a valid amount.');
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      if (familyId) {
        // Child-to-parent suggestion flow
        await createSuggestion({
          family_id:       familyId,
          title:           editRate.canonical_name,
          proposed_amount: pence,
          reason:          editReason.trim() || undefined,
        });
      } else {
        // Fallback: market-rate feedback only (parent context / no familyId)
        await suggestChore({
          canonical_name: editRate.canonical_name,
          median_amount:  pence,
          currency,
          context,
        });
      }
      setSuggested(editRate.id);
      setEditRate(null);
      setSuccess(true);
    } catch {
      setEditError('Something went wrong — please try again.');
    } finally {
      setEditBusy(false);
    }
  }

  if (!open) return null;

  const noResults = !loading && !error && filtered.length === 0 && search.length > 0;

  // Success state
  if (success) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--color-bg)] px-8 text-center">
        {isOrchard ? (
          <p className="text-5xl mb-4">🌳</p>
        ) : (
          <div className="w-16 h-16 rounded-full bg-[var(--brand-primary)]/15 flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        )}
        <h2 className="text-xl font-semibold text-[--color-text] mb-2">
          {isOrchard ? 'Proposal sent!' : 'Suggestion sent!'}
        </h2>
        <p className="text-sm text-[--color-text-muted] mb-8">
          {isOrchard
            ? "Your parent will see that you're ready to grow some Great Oaks."
            : 'Your parent will review it and add it to your tasks if they approve.'}
        </p>
        <button
          onClick={() => { setSuccess(false); onClose(); }}
          className="rounded-full bg-[var(--brand-primary)] text-[--color-text-on-brand] px-8 py-3 text-sm font-semibold"
        >
          Done
        </button>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--color-bg)] overflow-hidden overscroll-none">
      {/* ── Sticky top: header + search + category pills ───────────── */}
      <div className="shrink-0 border-b border-[--color-border] px-4 pt-6 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-[--color-text]">Chore Guide</h2>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">What other families pay</p>
          </div>
          <button onClick={onClose} className="tap-target-44 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Search */}
        <div className="mb-3">
          <input
            type="search"
            placeholder="Search chores…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-xl border border-[var(--color-border)] bg-white dark:bg-[var(--color-surface)] px-3.5 py-2.5 text-[14px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] transition shadow-sm"
          />
        </div>

        {/* Category pills */}
        <div
          className="flex gap-2 pb-3 overflow-x-auto"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x' }}
        >
          {CATEGORIES.map(cat => (
            <button
              key={cat.label}
              onClick={() => setCategory(cat.label)}
              className={`tap-target-44 shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                category === cat.label
                  ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                  : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_85%,var(--color-text)_15%)] hover:text-[var(--color-text)]'
              }`}
            >
              <span className="text-[11px] leading-none">{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable list ───────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-8" style={{ touchAction: 'pan-y' }}>
        {loading && <p className="py-8 text-center text-sm text-[--color-text-muted]">Loading…</p>}
        <ErrorBox message={error} className="my-4" />

        {noResults && (
          <div className="py-12 flex flex-col items-center gap-3 px-6 text-center">
            <p className="text-[14px] text-[var(--color-text-muted)]">No chores found for "{search}"</p>
            {familyId && (
              <button
                onClick={() => { setNewChore(f => ({ ...f, title: search })); setSearch(''); setNewChoreOpen(true); }}
                className="px-4 py-2 rounded-xl border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[13px] font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition cursor-pointer"
              >
                Suggest "{search}" instead
              </button>
            )}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            {/* Sort control */}
            <div className="flex items-center justify-end gap-1.5 pt-3 pb-2">
              <span className="text-[11px] text-[var(--color-text-muted)] font-medium shrink-0">Sort:</span>
              <div className="flex gap-1 flex-wrap justify-end">
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSort(opt.value)}
                    className={`tap-target-44 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer
                      ${sort === opt.value
                        ? 'bg-[var(--brand-primary)] text-white'
                        : 'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[color-mix(in_srgb,var(--color-surface-alt)_70%,var(--color-border))] hover:text-[var(--color-text)]'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {filtered.map(rate => (
              <div
                key={rate.id}
                className="flex items-center justify-between py-3 border-b border-[--color-border] last:border-0"
              >
                <div className="flex-1 min-w-0 mr-3">
                  <p className="text-sm font-medium text-[--color-text] truncate">{rate.canonical_name}</p>
                  <p className="text-[11px] text-[--color-text-muted] mt-0.5">{rate.category}</p>
                  {!rate.median_is_local && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      We're still learning what this is worth in {regionLabel} — you could be the first!
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold tabular-nums text-[--color-text]">
                    {formatAmount(rate.median_amount, symbol)}
                  </span>
                  <button
                    disabled={suggested === rate.id}
                    onClick={() => openEdit(rate)}
                    className="h-7 px-2.5 rounded-lg bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--brand-primary)_30%,transparent)] text-[var(--brand-primary)] text-[11px] font-bold hover:bg-[color-mix(in_srgb,var(--brand-primary)_18%,transparent)] disabled:opacity-50 transition cursor-pointer"
                  >
                    {suggested === rate.id ? '✓ Sent' : 'Suggest'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* My suggestions — child context only */}
        {familyId && !loading && !error && mySuggestions.length > 0 && (
          <div className="mt-8 border-t border-[--color-border] pt-6">
            <h3 className="text-[11px] font-bold text-[--color-text-muted] uppercase tracking-wider mb-3">My suggestions</h3>
            <div className="space-y-2.5">
              {mySuggestions.map(s => {
                const isPending  = s.status === 'pending';
                const isApproved = s.status === 'approved';
                return (
                  <div key={s.id} className={`rounded-xl border px-3.5 py-3 ${
                    isPending  ? 'border-[--color-border] bg-[var(--color-surface-alt)]' :
                    isApproved ? 'border-green-500/30 bg-green-500/8' :
                                 'border-red-400/30 bg-red-500/5'
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[--color-text] truncate">{s.title}</p>
                        <p className="text-[12px] text-[--color-text-muted] tabular-nums mt-0.5">
                          {symbol}{(s.proposed_amount / 100).toFixed(2)}
                          {s.due_date && <> · by {s.due_date}</>}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${
                        isPending  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' :
                        isApproved ? 'bg-green-500/15 text-green-700 dark:text-green-400' :
                                     'bg-red-500/15 text-red-700 dark:text-red-400'
                      }`}>
                        {isPending ? 'Waiting' : isApproved ? 'Approved ✓' : 'Declined'}
                      </span>
                    </div>
                    {!isPending && !isApproved && s.rejection_note && (
                      <p className="text-[12px] text-[--color-text-muted] mt-2 pt-2 border-t border-red-400/20 italic">
                        "{s.rejection_note}"
                      </p>
                    )}
                    {isApproved && (
                      <p className="text-[11px] text-green-700 dark:text-green-400 mt-1.5">
                        Added to your chores! {isOrchard ? '🌱' : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Suggest a new chore — child context only */}
        {familyId && !loading && !error && (
          <div className="mt-6 border-t border-[--color-border] pt-6 text-center">
            <p className="text-[13px] text-[--color-text-muted] mb-3">
              Don't see the chore you want to do?
            </p>
            <button
              onClick={() => setNewChoreOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[var(--brand-primary)] text-[var(--brand-primary)] text-[13px] font-semibold hover:bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)] transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Suggest a new chore
            </button>
          </div>
        )}
      </div>

      {/* ── Suggest-a-new-chore bottom sheet (modal) ──────────────── */}
      {newChoreOpen && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={closeNewChore} />
          <div
            ref={newChoreSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Suggest a new chore"
            tabIndex={-1}
            className="relative bg-[var(--color-surface)] rounded-t-2xl px-5 pt-2 pb-8 max-h-[88vh] overflow-y-auto overscroll-contain"
          >
            {/* Drag handle */}
            <div {...newChoreHandleProps}>
              <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-[15px] font-bold text-[--color-text]">Suggest a new chore</p>
                <p className="text-[12px] text-[--color-text-muted] mt-0.5">Tell your parent what you'd like to do and how much it should pay.</p>
              </div>
              <ErrorBox message={newChoreError} />
              <div>
                <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-1.5">
                  Chore name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Clean the bathroom"
                  value={newChore.title}
                  onChange={e => setNewChore(f => ({ ...f, title: e.target.value }))}
                  className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[14px] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </div>
              <div>
                <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-1.5">
                  How much should it pay? <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-text-muted)]">{symbol}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={newChore.amount}
                    onChange={e => setNewChore(f => ({ ...f, amount: e.target.value }))}
                    className="w-full border border-[var(--color-border)] rounded-xl pl-7 pr-3 py-2.5 text-[14px] font-semibold bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                  />
                </div>
              </div>
              <div>
                <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-1.5">
                  When do you want to do it by? <span className="font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={newChore.dueDate}
                  onChange={e => setNewChore(f => ({ ...f, dueDate: e.target.value }))}
                  className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[13px] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </div>
              <div>
                <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-1.5">
                  Why should this be a chore? <span className="font-normal">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. I could do this every Saturday morning"
                  value={newChore.reason}
                  onChange={e => setNewChore(f => ({ ...f, reason: e.target.value }))}
                  className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[13px] resize-none bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={closeNewChore}
                  className="flex-1 border border-[var(--color-border)] rounded-xl py-2.5 text-[13px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNewChoreSuggest}
                  disabled={newChoreBusy}
                  className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-2.5 text-[13px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-all"
                >
                  {newChoreBusy ? 'Sending…' : 'Send to parent →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Amount-edit bottom sheet */}
      {editRate && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={closeEditRate} />
          <div
            ref={editRateSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Suggest this chore — ${editRate.canonical_name}`}
            tabIndex={-1}
            className="relative bg-[var(--color-surface)] rounded-t-2xl px-5 pt-2 pb-8 space-y-4"
          >
            {/* Drag handle */}
            <div {...editRateHandleProps}>
              <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
            </div>

            <div>
              <p className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">Suggest this chore</p>
              <p className="text-[16px] font-bold text-[var(--color-text)]">{editRate.canonical_name}</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                Market rate: {formatAmount(editRate.median_amount, symbol)} — change the amount if you think it's worth more or less.
              </p>
            </div>

            <ErrorBox message={editError} />

            {/* Amount input */}
            <div>
              <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-1.5">
                How much should it pay?
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-text-muted)]">
                  {symbol}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  autoFocus
                  value={editAmount}
                  onChange={e => setEditAmount(e.target.value)}
                  className="w-full border border-[var(--color-border)] rounded-xl pl-7 pr-3 py-3 text-[15px] font-semibold bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </div>
            </div>

            {/* Optional reason */}
            <div>
              <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-1.5">
                Why should this be a chore? <span className="font-normal">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="e.g. I could do this every week after school"
                value={editReason}
                onChange={e => setEditReason(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded-xl px-3.5 py-2.5 text-[13px] resize-none bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={closeEditRate}
                className="flex-1 border border-[var(--color-border)] rounded-xl py-3 text-[14px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSuggest}
                disabled={editBusy}
                className="flex-1 bg-[var(--brand-primary)] text-white rounded-xl py-3 text-[14px] font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer active:scale-[0.98] transition-all"
              >
                {editBusy ? 'Sending…' : 'Send to parent →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
