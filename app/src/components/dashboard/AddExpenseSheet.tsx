// app/src/components/dashboard/AddExpenseSheet.tsx
import { useState, useEffect } from 'react';
import { createSharedExpense, uploadReceipt } from '../../lib/api';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { ErrorBox } from '../ui/ErrorBox';
import { useDragToClose } from '../../hooks/useDragToClose';
import type { ExpensePreset, ExpenseCategory } from '../../lib/sharedExpensePresets';
import {
  PRESETS,
  getPresetsForRegion, localiseName, fuzzyMatchPreset
} from '../../lib/sharedExpensePresets';
import { ReceiptPicker } from './ReceiptPicker';

type ExpenseRegion = 'UK' | 'US' | 'PL';

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'education',  label: 'Education' },
  { value: 'health',     label: 'Health' },
  { value: 'clothing',   label: 'Clothing' },
  { value: 'travel',     label: 'Travel' },
  { value: 'activities', label: 'Activities' },
  { value: 'childcare',  label: 'Childcare' },
  { value: 'food',       label: 'Food' },
  { value: 'tech',       label: 'Tech' },
  { value: 'gifts',      label: 'Gifts' },
  { value: 'other',      label: 'Other' },
];

function CategoryIcon({ category, size = 20 }: { category: string; size?: number }) {
  const s = size;
  const props = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (category) {
    case 'education':
      return <svg {...props}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>;
    case 'health':
      return <svg {...props}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
    case 'clothing':
      return <svg {...props}><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>;
    case 'travel':
      return <svg {...props}><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21 4 19 4c0 0-1 0-3 1.5L8 9.2l-4.7-1.2c-.7-.2-1.3.6-.9 1.2l4 5.9c.4.6 1.2.8 1.8.4l1.9-1.2 2.5 2.5-1.2 1.9c-.4.6-.2 1.4.4 1.8l5.9 4c.6.4 1.4-.2 1.2-.9L17.8 19.2z"/></svg>;
    case 'activities':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>;
    case 'childcare':
      return <svg {...props}><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5.5 4.5 1.4"/><path d="M12 3c0 0 0 2-2 3"/></svg>;
    case 'food':
      return <svg {...props}><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>;
    case 'tech':
      return <svg {...props}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>;
    case 'gifts':
      return <svg {...props}><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>;
    default: // other
      return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>;
  }
}

const TILE_PRESETS = PRESETS.filter(p => p.is_top_8);

type Props = {
  defaultSplitBp: number;
  currency: string;
  parentingMode: 'single' | 'co-parenting';
  region?: ExpenseRegion;
  familyName?: string;
  onClose: () => void;
  onSaved: () => void;
};

export function AddExpenseSheet({ defaultSplitBp, currency, parentingMode, region = 'UK', familyName, onClose, onSaved }: Props) {
  const isCoParenting = parentingMode === 'co-parenting';
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : 'zł';

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [amountStr, setAmountStr] = useState('');
  const [splitBp, setSplitBp] = useState(isCoParenting ? defaultSplitBp : 10000);
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCategoryOverride, setShowCategoryOverride] = useState(false);

  useAndroidBack(true, onClose);
  const { sheetRef, handleProps } = useDragToClose(onClose);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const regionPresets = getPresetsForRegion(region);
  const searchResults = searchQuery.trim()
    ? regionPresets.filter(p => fuzzyMatchPreset(p, searchQuery)).slice(0, 6)
    : [];

  function selectPreset(preset: ExpensePreset) {
    setDescription(localiseName(preset, 'en'));
    setCategory(preset.category);
    setSearchQuery('');
    if (preset.legally_distinguishable) {
      setNoteOpen(true);
    }
  }

  const totalPence = Math.round(parseFloat(amountStr || '0') * 100);
  const loggedByAmount = Math.round((totalPence * splitBp) / 10000);
  const otherAmount = totalPence - loggedByAmount;
  const uneven = totalPence > 0 && loggedByAmount !== otherAmount;

  // All mandatory fields must be populated to enable submit
  const canSubmit = description.trim().length > 0 && totalPence > 0 && expenseDate.length > 0;

  function formatP(p: number) {
    return `${symbol}${(p / 100).toFixed(2)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    try {
      const result = await createSharedExpense({
        description: description.trim(),
        category,
        total_amount: totalPence,
        split_bp: isCoParenting ? splitBp : undefined,
        expense_date: expenseDate,
        note: note.trim() || undefined,
      });

      if (receiptFile) {
        try {
          await uploadReceipt(result.id, receiptFile);
        } catch {
          setReceiptError('Expense saved, but receipt upload failed. You can retry from the expense list.');
          onSaved();
          return;
        }
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const selectedCategoryLabel = CATEGORIES.find(c => c.value === category)?.label ?? category;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Log shared expense"
        tabIndex={-1}
        className="relative bg-[var(--color-surface)] rounded-t-3xl shadow-2xl w-full max-w-[560px] flex flex-col max-h-[92dvh] transition-transform duration-300"
        onClick={e => e.stopPropagation()}
      >

        {/* Drag handle */}
        <div {...handleProps}>
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between shrink-0">
          <div>
            <p className="text-[17px] font-extrabold text-[var(--color-text)] tracking-tight leading-tight">
              Log shared expense
            </p>
            <p className="text-[12px] text-[var(--color-text-muted)]">
              for <span className="font-semibold text-[var(--brand-primary)]">{familyName ?? 'the family'}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="tap-target-44 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] cursor-pointer"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 pb-10">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Quick Pick tiles */}
            <div>
              <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-2">
                Quick pick
              </p>
              <div className="grid grid-cols-4 gap-2">
                {TILE_PRESETS.map(preset => {
                  const active = description === localiseName(preset, 'en');
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => selectPreset(preset)}
                      className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 py-2.5 px-1 text-center transition-all cursor-pointer
                        ${active
                          ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'
                          : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                        }`}
                    >
                      <CategoryIcon category={preset.category} size={20} />
                      <span className="text-[9px] font-semibold leading-tight text-center">
                        {localiseName(preset, 'en')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search all expenses…"
                className="w-full border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              />
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-lg overflow-hidden divide-y divide-[var(--color-border)]">
                  {searchResults.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => selectPreset(preset)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-surface-alt)] flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <CategoryIcon category={preset.category} size={15} />
                      <span className="font-medium text-[var(--color-text)]">{localiseName(preset, 'en')}</span>
                      <span className="text-xs text-[var(--color-text-muted)] ml-1 capitalize">{preset.category}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                Description <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. School trip payment"
                className="mt-1.5 w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
              />
            </div>

            {/* Filed under chip */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-muted)]">Filed under:</span>
              <button
                type="button"
                onClick={() => setShowCategoryOverride(v => !v)}
                className="tap-target-44 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-sm font-medium text-[var(--brand-primary)] cursor-pointer"
              >
                <CategoryIcon category={category} size={13} />
                {selectedCategoryLabel}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </div>

            {showCategoryOverride && (
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => { setCategory(c.value); setShowCategoryOverride(false); }}
                    className={`tap-target-44 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors cursor-pointer
                      ${category === c.value
                        ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,transparent)] text-[var(--brand-primary)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
                      }`}
                  >
                    <CategoryIcon category={c.value} size={13} />
                    {c.label}
                  </button>
                ))}
              </div>
            )}

            {/* Date + Amount row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                  Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={e => setExpenseDate(e.target.value)}
                  className="mt-1.5 w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                  Amount ({symbol}) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  step="0.01"
                  min="0.01"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  placeholder="0.00"
                  className="mt-1.5 w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]"
                />
              </div>
            </div>

            {/* Co-parent split slider */}
            {isCoParenting && (
              <div>
                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                  Your share — {(splitBp / 100).toFixed(0)}%
                </label>
                <input
                  type="range" min={0} max={10000} step={100}
                  value={splitBp}
                  onChange={e => setSplitBp(Number(e.target.value))}
                  className="w-full mt-2"
                />
                {totalPence > 0 && (
                  <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-1 tabular-nums">
                    <span>You: {formatP(loggedByAmount)}</span>
                    <span>Other parent: {formatP(otherAmount)}</span>
                  </div>
                )}
                {uneven && (
                  <p className="text-[10px] text-[var(--color-text-muted)] italic mt-1">
                    Rounded to {formatP(loggedByAmount)} / {formatP(otherAmount)}.
                  </p>
                )}
              </div>
            )}

            {/* Note collapsible */}
            <div>
              <button
                type="button"
                onClick={() => setNoteOpen(v => !v)}
                className="text-sm font-medium text-[var(--brand-primary)] cursor-pointer"
              >
                {noteOpen ? '▾ Note' : '▸ Add note'}
              </button>
              {noteOpen && (
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="e.g. why this expense was incurred"
                  rows={3}
                  className="mt-2 w-full border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] resize-none"
                />
              )}
            </div>

            {/* Receipt collapsible */}
            <div>
              <button
                type="button"
                onClick={() => setReceiptOpen(v => !v)}
                className="text-sm font-medium text-[var(--brand-primary)] cursor-pointer"
              >
                {receiptOpen ? '▾ Attach receipt' : '▸ Attach receipt'}
              </button>
              {receiptOpen && (
                <div className="mt-2">
                  <ReceiptPicker
                    onFile={f => { setReceiptFile(f); setReceiptError(null); }}
                    onClear={() => setReceiptFile(null)}
                    onError={msg => setReceiptError(msg)}
                  />
                  {receiptError && (
                    <p className="text-xs text-red-500 mt-1">{receiptError}</p>
                  )}
                </div>
              )}
            </div>

            <ErrorBox message={error} />

            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="w-full bg-[var(--brand-primary)] text-white font-semibold py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
            >
              {saving ? 'Saving…' : 'Log expense'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
