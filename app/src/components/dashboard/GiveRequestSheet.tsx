import { useState } from 'react';
import { blurOnWheel, blockInvalidAmountKeys } from '../../lib/utils';
import { postGiveRequest } from '../../lib/api';
import { BaseSheet } from '../ui/BaseSheet';
import { tick } from '../../lib/haptics';

interface Props {
  giveBalance: number;
  currency: string;
  familyId: string;
  childId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

function fmt(pence: number, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(pence / 100);
}

export function GiveRequestSheet({ giveBalance, currency, familyId, childId, onClose, onSubmitted }: Props) {
  const [cause, setCause]   = useState('');
  const [amt, setAmt]       = useState('');
  const [err, setErr]       = useState('');
  const [done, setDone]     = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    const amount = Math.round(parseFloat(amt) * 100);
    if (!cause.trim()) { setErr('Tell us what this is for'); return; }
    if (cause.length > 60) { setErr('Keep it under 60 characters'); return; }
    if (!amount || amount <= 0) { setErr('Enter a valid amount'); return; }
    if (amount > giveBalance) { setErr(`You only have ${fmt(giveBalance, currency)} in your Give jar`); return; }
    setSaving(true);
    try {
      await postGiveRequest({ family_id: familyId, child_id: childId, cause: cause.trim(), amount });
      setDone(true);
    } catch (e: unknown) {
      setErr((e instanceof Error ? e.message : null) ?? 'Something went wrong — try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BaseSheet
      onClose={onClose}
      zIndex={200}
      label={done ? 'Gift request sent' : 'Make a gift'}
      panelStyle={{ background: '#1a2e22', borderRadius: '20px 20px 0 0', padding: '8px 20px 40px', fontFamily: 'Manrope' }}
    >
      {done ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Gift request sent!</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 24 }}>Your parent will make the donation and let you know.</div>
          <button onClick={() => { void tick(); onSubmitted(); onClose(); }} style={{ padding: '14px 28px', borderRadius: 12, background: '#0d9488', color: '#fff', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Done</button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Make a gift</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 24 }}>
            Give jar: {fmt(giveBalance, currency)} available
          </div>

          <label htmlFor="give-request-cause" style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 6 }}>What is it for?</label>
          <input
            id="give-request-cause"
            type="text" maxLength={60} placeholder="e.g. Cancer Research, school fundraiser…"
            value={cause} onChange={e => setCause(e.target.value)}
            required aria-required="true" aria-invalid={!!err} aria-describedby={err ? 'give-request-error' : undefined}
            style={{ width: '100%', padding: '12px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 15, marginBottom: 4, boxSizing: 'border-box' }}
          />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 20, textAlign: 'right' }}>{cause.length}/60</div>

          <label htmlFor="give-request-amount" style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 6 }}>Amount</label>
          <input
            id="give-request-amount"
            type="number" min="0.01" max={giveBalance / 100} step="0.01" placeholder="0.00"
            value={amt} onChange={e => setAmt(e.target.value)}
            onWheel={blurOnWheel} onKeyDown={blockInvalidAmountKeys}
            required aria-required="true" aria-invalid={!!err} aria-describedby={err ? 'give-request-error' : undefined}
            style={{ width: '100%', padding: '12px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 15, marginBottom: 20, boxSizing: 'border-box' }}
          />

          {err && <div id="give-request-error" role="alert" style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{err}</div>}

          <button onClick={() => { void tick(); handleSubmit(); }} disabled={saving}
            style={{ width: '100%', padding: 14, borderRadius: 12, background: '#d97706', color: '#fff', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 10 }}>
            {saving ? 'Sending…' : 'Send request to parent'}
          </button>
          <button onClick={() => { void tick(); onClose(); }} style={{ width: '100%', padding: 12, borderRadius: 12, background: 'none', color: 'rgba(255,255,255,0.4)', border: 'none', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
        </>
      )}
    </BaseSheet>
  );
}
