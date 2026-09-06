import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import { tick } from '../../lib/haptics';
import { cn } from '../../lib/utils';

type Row = { label: string; value: string };

type Props = {
  rows: Row[];
  warningBanner?: string; // e.g., "Details stored on this device only"
  apologyBanner?: string; // e.g., "Couldn't open Monzo — copy instead"
};

export function SmartCopyPanel({ rows, warningBanner, apologyBanner }: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-6">
      {apologyBanner && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[0.8125rem] text-amber-900">
          {apologyBanner}
        </div>
      )}
      {warningBanner && (
        <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2 text-[0.75rem] text-neutral-600">
          {warningBanner}
        </div>
      )}
      {rows.map((r) => (
        <CopyRow key={r.label} label={r.label} value={r.value} />
      ))}
    </div>
  );
}

function CopyRow({ label, value }: Row) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    // Fire haptic synchronously inside the click handler — required for
    // Android Chrome's user-gesture vibration rule.
    void tick();
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors',
        copied
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-white border-neutral-200 active:bg-neutral-50',
      )}
    >
      <div className="min-w-0">
        <div className="text-[0.6875rem] uppercase tracking-wide text-neutral-500">{label}</div>
        <div className="text-[0.9375rem] font-semibold font-mono truncate">{value}</div>
      </div>
      <div className={cn('shrink-0 ml-3', copied ? 'text-emerald-600' : 'text-neutral-400')}>
        {copied ? <Check size={20} /> : <Copy size={18} />}
      </div>
    </button>
  );
}
