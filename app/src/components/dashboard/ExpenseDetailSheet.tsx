// app/src/components/dashboard/ExpenseDetailSheet.tsx
import { useState, useEffect } from 'react';
import { Receipt, Calendar, User, Tag, SplitSquareHorizontal } from 'lucide-react';
import type { SharedExpense } from '../../lib/api';
import { getReceiptUrl } from '../../lib/api';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { useDragToClose } from '../../hooks/useDragToClose';

function formatAmount(pence: number, currency: string): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : 'zł';
  return `${symbol}${(pence / 100).toFixed(2)}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  education: 'Education', health: 'Health', clothing: 'Clothing', travel: 'Travel',
  activities: 'Activities', childcare: 'Childcare', food: 'Food', tech: 'Tech',
  gifts: 'Gifts', other: 'Other',
};

type Props = {
  expense: SharedExpense;
  currentUserId: string;
  isCoParenting: boolean;
  onClose: () => void;
  onVoid?: () => void;
};

type ReceiptState = 'idle' | 'loading' | 'loaded' | 'error';

export function ExpenseDetailSheet({ expense: e, currentUserId, isCoParenting, onClose, onVoid }: Props) {
  useAndroidBack(true, onClose);
  const { sheetRef, handleProps } = useDragToClose(onClose);

  const [receiptState, setReceiptState] = useState<ReceiptState>('idle');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [_receiptError, setReceiptError] = useState<string | null>(null);

  const hasReceipt = Boolean(e.receipt_r2_key);

  useEffect(() => {
    function handleKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!hasReceipt) return;
    setReceiptState('loading');
    getReceiptUrl(e.id)
      .then(({ url }) => { setReceiptUrl(url); setReceiptState('loaded'); })
      .catch(() => { setReceiptError('Could not load receipt.'); setReceiptState('error'); });
  }, [e.id, hasReceipt]);

  const dateStr = e.expense_date
    ? new Date(e.expense_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date(e.created_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const loggedByLabel = e.logged_by_name ?? (e.logged_by === currentUserId ? 'You' : 'Other parent');
  const authorisedByLabel = e.authorised_by_name ?? null;

  const splitPct = (e.split_bp / 100).toFixed(0);
  const myShare = Math.round((e.total_amount * e.split_bp) / 10000);
  const otherShare = e.total_amount - myShare;
  const myShareAmt = e.logged_by === currentUserId ? myShare : otherShare;

  const statusLabel: Record<string, string> = {
    committed_auto: 'Auto-confirmed',
    committed_manual: 'Verified',
    pending: 'Awaiting approval',
    rejected: 'Rejected',
    voided: 'Voided',
    reversed: 'Reversed',
  };

  const isPdf = e.receipt_r2_key?.endsWith('.pdf') ?? false;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={e.description}
        tabIndex={-1}
        className="relative mt-auto w-full max-h-[90dvh] bg-[var(--color-surface)] rounded-t-2xl flex flex-col overflow-hidden shadow-2xl transition-transform duration-300"
      >

        {/* Drag handle */}
        <div {...handleProps}>
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[var(--color-border)] shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-0.5">
              {CATEGORY_LABELS[e.category] ?? e.category}
            </p>
            <h2 className="text-[16px] font-bold text-[var(--color-text)] leading-snug truncate pr-2">
              {e.description}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tap-target-44 shrink-0 w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] active:bg-[var(--color-border)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Amount hero */}
          <div className="rounded-xl bg-[var(--color-surface-raised)] border border-[var(--color-border)] p-4 text-center">
            <p className="text-3xl font-bold tabular-nums text-[var(--color-text)]">
              {formatAmount(e.total_amount, e.currency)}
            </p>
            {isCoParenting && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Your share: {formatAmount(myShareAmt, e.currency)} ({splitPct}/{100 - parseInt(splitPct)} split)
              </p>
            )}
          </div>

          {/* Detail rows */}
          <div className="rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            <DetailRow icon={<Calendar size={13} />} label="Date" value={dateStr} />
            <DetailRow icon={<Tag size={13} />} label="Category" value={CATEGORY_LABELS[e.category] ?? e.category} />
            <DetailRow icon={<User size={13} />} label="Logged by" value={loggedByLabel} />
            {authorisedByLabel && (
              <DetailRow icon={<User size={13} />} label="Verified by" value={authorisedByLabel} />
            )}
            {isCoParenting && (
              <DetailRow
                icon={<SplitSquareHorizontal size={13} />}
                label="Split"
                value={`${splitPct} / ${100 - parseInt(splitPct)}`}
              />
            )}
            <DetailRow
              icon={<span className="w-3 h-3 rounded-full inline-block"
                style={{ background: statusColor(e.verification_status) }} />}
              label="Status"
              value={statusLabel[e.verification_status] ?? e.verification_status}
            />
            {e.settlement_period && (
              <DetailRow
                icon={<Calendar size={13} />}
                label="Settled"
                value={new Date(e.settlement_period + '-02').toLocaleString('default', { month: 'long', year: 'numeric' })}
              />
            )}
          </div>

          {/* Note */}
          {e.note && (
            <div className="rounded-xl border border-[var(--color-border)] p-3">
              <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Note</p>
              <p className="text-sm text-[var(--color-text)] leading-snug">{e.note}</p>
            </div>
          )}

          {/* Receipt */}
          {hasReceipt && (
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-alt)] border-b border-[var(--color-border)]">
                <Receipt size={13} className="text-[var(--color-text-muted)]" />
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Receipt</p>
              </div>
              <div className="p-3">
                {receiptState === 'loading' && (
                  <div className="flex items-center justify-center h-40 rounded-lg bg-[var(--color-surface-alt)]">
                    <div className="flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                      <span className="text-xs">Loading receipt…</span>
                    </div>
                  </div>
                )}
                {receiptState === 'error' && (
                  <div className="flex flex-col items-center gap-2 py-6 text-center text-[var(--color-text-muted)]">
                    <Receipt size={24} className="opacity-40" />
                    <p className="text-sm font-medium">Receipt unavailable</p>
                    <p className="text-xs leading-snug max-w-[220px]">
                      The receipt file could not be loaded. It may have been removed or the link has expired.
                    </p>
                  </div>
                )}
                {receiptState === 'loaded' && receiptUrl && !isPdf && (
                  <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={receiptUrl}
                      alt="Receipt"
                      className="w-full rounded-lg object-contain max-h-80"
                    />
                    <p className="text-[10px] text-center text-[var(--color-text-muted)] mt-1.5">
                      Tap image to open full size ↗
                    </p>
                  </a>
                )}
                {receiptState === 'loaded' && receiptUrl && isPdf && (
                  <a
                    href={receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-surface-alt)] border border-[var(--color-border)] hover:bg-[var(--color-border)] transition-colors"
                  >
                    <Receipt size={20} className="text-[var(--brand-primary)] shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-[var(--color-text)]">View PDF receipt</p>
                      <p className="text-xs text-[var(--color-text-muted)]">Opens in new tab</p>
                    </div>
                    <span className="text-[var(--color-text-muted)] text-xs">↗</span>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {e.verification_status === 'committed_auto' || e.verification_status === 'committed_manual' ? (
          e.logged_by === currentUserId && onVoid ? (
            <div className="px-5 py-4 border-t border-[var(--color-border)] shrink-0">
              <button
                type="button"
                onClick={onVoid}
                className="w-full py-2.5 rounded-xl border border-red-300 text-red-600 text-sm font-semibold hover:bg-red-50 active:bg-red-50 transition-colors cursor-pointer"
              >
                Void this expense
              </button>
            </div>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="shrink-0 text-[var(--color-text-muted)]">{icon}</span>
      <span className="text-xs text-[var(--color-text-muted)] w-20 shrink-0">{label}</span>
      <span className="text-sm text-[var(--color-text)] flex-1 text-right font-medium">{value}</span>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'committed_auto':
    case 'committed_manual': return '#16a34a';
    case 'pending': return '#d97706';
    case 'rejected': return '#dc2626';
    case 'voided':
    case 'reversed': return '#9ca3af';
    default: return '#9ca3af';
  }
}
