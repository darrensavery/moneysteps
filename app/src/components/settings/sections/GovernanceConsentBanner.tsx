import { useEffect, useState } from 'react'
import {
  getGovernanceLog,
  confirmGovernanceRequest,
  rejectGovernanceRequest,
  type GovernanceLogRow,
} from '../../../lib/api'

interface Props {
  familyId: string
  userId:   string
}

function fmtExpiry(epochSec: number): string {
  const h = Math.max(0, Math.floor((epochSec - Date.now() / 1000) / 3600));
  if (h < 1) return 'less than 1 hour';
  return `${h} hour${h !== 1 ? 's' : ''}`;
}

export function GovernanceConsentBanner({ familyId, userId }: Props) {
  const [pending, setPending] = useState<GovernanceLogRow | null>(null);
  const [busy,    setBusy]    = useState(false);
  const [done,    setDone]    = useState<'confirmed' | 'rejected' | null>(null);

  useEffect(() => {
    getGovernanceLog(familyId)
      .then(({ log }) => {
        const p = log.find(r => r.status === 'pending') ?? null;
        setPending(p);
      })
      .catch(() => {});
  }, [familyId]);

  if (!pending || done) return null;

  const isRequester = pending.requested_by === userId;
  const modeLabel   = pending.new_mode === 'amicable' ? 'Auto-Verify (Amicable)' : 'Manual Approval (Standard)';

  async function handleConfirm() {
    setBusy(true);
    try {
      await confirmGovernanceRequest(pending!.id);
      setDone('confirmed');
    } catch { /* non-fatal */ }
    finally { setBusy(false); }
  }

  async function handleReject() {
    setBusy(true);
    try {
      await rejectGovernanceRequest(pending!.id);
      setDone('rejected');
    } catch { /* non-fatal */ }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3.5 mb-4">
      <div className="flex items-start gap-3">
        <span className="text-amber-500 text-lg shrink-0 mt-0.5">⚖️</span>
        <div className="flex-1 min-w-0">
          <p className="text-[0.8125rem] font-bold text-amber-700 dark:text-amber-300 mb-1">
            {isRequester ? 'Awaiting co-parent consent' : 'Co-parent consent required'}
          </p>
          <p className="text-[0.75rem] text-amber-800/80 dark:text-amber-300/80 leading-snug mb-3">
            {isRequester
              ? `You requested a switch to ${modeLabel}. Waiting for your co-parent to confirm. Expires in ${fmtExpiry(pending.expires_at)}.`
              : `Your co-parent wants to switch to ${modeLabel}. This changes how chore payments are verified. Expires in ${fmtExpiry(pending.expires_at)}.`
            }
          </p>
          {!isRequester && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="flex-1 rounded-lg bg-amber-600 text-white text-[0.75rem] font-semibold py-2 px-3 disabled:opacity-50 cursor-pointer hover:bg-amber-700 transition-colors"
              >
                {busy ? '…' : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={busy}
                className="flex-1 rounded-lg bg-white/10 text-[var(--color-text-muted)] text-[0.75rem] py-2 px-3 disabled:opacity-50 cursor-pointer hover:bg-white/20 transition-colors"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
