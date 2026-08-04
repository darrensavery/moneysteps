import { useState } from 'react';
import { putJarConfig, type JarBalances } from '../../lib/api';
import { SpendJarIcon } from '../icons/SpendJarIcon';
import { SaveJarIcon  } from '../icons/SaveJarIcon';
import { GiveJarIcon  } from '../icons/GiveJarIcon';

interface Props {
  availableBalance: number; // pence — current total to seed
  currency: string;
  familyId: string;
  childId: string;
  onComplete: (balances: JarBalances) => void;
  onCancel: () => void;
}

function fmt(pence: number, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(pence / 100);
}

export function JarOnboardingWizard({
  availableBalance, currency, familyId, childId,
  onComplete, onCancel,
}: Props) {
  // Default split: 70% Spend / 20% Save / 10% Give (spec 70/20/10)
  const defaultSpend = Math.round(availableBalance * 0.7);
  const defaultSave  = Math.round(availableBalance * 0.2);

  const [spend, setSpend]   = useState(defaultSpend);
  const [save, setSave]     = useState(defaultSave);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // Give is always the remainder so the total stays locked to availableBalance
  const giveComputed = availableBalance - spend - save;

  function setSpendAdj(v: number) {
    const clamped = Math.min(Math.max(0, v), availableBalance - save);
    setSpend(clamped);
  }

  function setSaveAdj(v: number) {
    const clamped = Math.min(Math.max(0, v), availableBalance - spend);
    setSave(clamped);
  }

  async function handleConfirm() {
    if (giveComputed < 0) return;
    setSaving(true);
    setError(null);
    try {
      // Derive percentages from entered amounts
      const total = spend + save + giveComputed;
      const spend_pct = Math.round((spend / total) * 100);
      const save_pct = Math.round((save / total) * 100);
      const give_pct = 100 - spend_pct - save_pct; // remainder to Give

      const { balances } = await putJarConfig({
        family_id: familyId,
        child_id: childId,
        enabled: 1,
        spend_pct,
        save_pct,
        give_pct,
        initial_seed: { spend, save, give: Math.max(0, giveComputed) },
      });
      onComplete(balances);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error('Jar config error:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: '#0f1a14', display: 'flex', flexDirection: 'column',
      padding: '40px 20px', fontFamily: 'Manrope',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
        Split your money
      </div>
      <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', marginBottom: 32 }}>
        You have {fmt(availableBalance, currency)} — how do you want to split it across your jars?
      </div>

      {/* Spend input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <SpendJarIcon size={32} decorative />
        <div style={{ flex: 1 }}>
          <label htmlFor="jar-onboarding-spend" style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 13, textTransform: 'capitalize', marginBottom: 4 }}>
            Spend
          </label>
          <input
            id="jar-onboarding-spend"
            type="number"
            min="0"
            step="1"
            value={(spend / 100).toFixed(2)}
            onChange={e => setSpendAdj(Math.round(parseFloat(e.target.value || '0') * 100))}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff', fontSize: 16, fontVariantNumeric: 'tabular-nums',
            }}
          />
        </div>
      </div>

      {/* Save input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <SaveJarIcon size={32} decorative />
        <div style={{ flex: 1 }}>
          <label htmlFor="jar-onboarding-save" style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 13, textTransform: 'capitalize', marginBottom: 4 }}>
            Save
          </label>
          <input
            id="jar-onboarding-save"
            type="number"
            min="0"
            step="1"
            value={(save / 100).toFixed(2)}
            onChange={e => setSaveAdj(Math.round(parseFloat(e.target.value || '0') * 100))}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff', fontSize: 16, fontVariantNumeric: 'tabular-nums',
            }}
          />
        </div>
      </div>

      {/* Give — read-only remainder */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <GiveJarIcon size={32} decorative />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, textTransform: 'capitalize', marginBottom: 4 }}>
            Give
          </div>
          <div style={{
            padding: '10px 12px', borderRadius: 10,
            background: 'rgba(255,255,255,0.03)',
            color: giveComputed < 0 ? '#f87171' : 'rgba(255,255,255,0.4)',
            fontSize: 16, fontVariantNumeric: 'tabular-nums',
          }}>
            {giveComputed < 0
              ? 'Overspent — reduce Spend or Save'
              : `${fmt(giveComputed, currency)} (remainder)`}
          </div>
        </div>
      </div>

      {/* Remaining counter */}
      <div style={{
        color: giveComputed === 0 ? '#10b981' : '#f59e0b',
        fontSize: 13,
        marginBottom: 24,
      }}>
        Remaining: {fmt(Math.max(0, giveComputed), currency)}
      </div>

      {error && (
        <div style={{ color: '#f87171', fontSize: 13, marginBottom: 16, padding: 12, background: 'rgba(248, 113, 113, 0.1)', borderRadius: 8 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={saving || giveComputed !== 0}
        style={{
          padding: 16, borderRadius: 14, background: '#0d9488',
          color: '#fff', border: 'none', fontSize: 16, fontWeight: 700,
          cursor: giveComputed !== 0 ? 'not-allowed' : 'pointer',
          marginBottom: 12,
          opacity: giveComputed !== 0 ? 0.5 : 1,
        }}
      >
        {saving ? 'Setting up…' : 'Start splitting my money'}
      </button>

      <button
        onClick={onCancel}
        style={{
          padding: 14, borderRadius: 14, background: 'none',
          color: 'rgba(255,255,255,0.4)', border: 'none',
          fontSize: 15, cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}
