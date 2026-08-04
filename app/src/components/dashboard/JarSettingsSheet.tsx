import { useState } from 'react';
import { putJarConfig, type JarConfig, type JarBalances } from '../../lib/api';
import { BaseSheet } from '../ui/BaseSheet';
import { tick } from '../../lib/haptics';

interface Props {
  config: JarConfig;
  familyId: string;
  childId: string;
  onClose: () => void;
  onSaved: (balances: JarBalances) => void;
  onFirstEnable: () => void; // trigger wizard instead of direct save
}

const stepBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8,
  background: 'rgba(255,255,255,0.08)', border: 'none',
  color: '#fff', fontSize: 18, cursor: 'pointer',
};

export function JarSettingsSheet({ config, familyId, childId, onClose, onSaved, onFirstEnable }: Props) {
  const [enabled, setEnabled] = useState(!!config.enabled);
  const [spend, setSpend]     = useState(config.spend_pct);
  const [save, setSave]       = useState(config.save_pct);
  const [give, setGive]       = useState(config.give_pct);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  const sum = spend + save + give;
  const showSavingWarn = save < 20;
  const showGiveWarn   = give === 0;

  async function handleSave() {
    if (sum !== 100) { setErr('Percentages must add up to 100'); return; }
    // If enabling for first time, open wizard instead
    if (enabled && !config.enabled) { onFirstEnable(); return; }
    setSaving(true);
    try {
      const { balances } = await putJarConfig({
        family_id: familyId,
        child_id: childId,
        enabled: enabled ? 1 : 0,
        spend_pct: spend,
        save_pct: save,
        give_pct: give,
      });
      onSaved(balances);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not save — try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BaseSheet
      onClose={onClose}
      zIndex={200}
      label="Jar settings"
      panelStyle={{ background: '#1a2e22', borderRadius: '20px 20px 0 0', padding: '8px 20px 40px', fontFamily: 'Manrope' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Jar settings</span>
        <button
          onClick={() => { void tick(); onClose(); }}
          aria-label="Close"
          className="tap-target-44"
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer' }}
        >
          ✕
        </button>
      </div>

      {/* Enable toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <span id="jar-split-toggle-label" style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15 }}>Split my earnings automatically</span>
        <button
          onClick={() => { void tick(); setEnabled(!enabled) }}
          role="switch"
          aria-checked={enabled}
          aria-labelledby="jar-split-toggle-label"
          style={{
            width: 48, height: 28, borderRadius: 14,
            background: enabled ? '#0d9488' : 'rgba(255,255,255,0.12)',
            border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: enabled ? 22 : 3,
            width: 22, height: 22, borderRadius: '50%',
            background: '#fff', transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Percentage steppers — only when enabled */}
      {enabled && (
        <>
          {([['Spend', spend, setSpend], ['Save', save, setSave], ['Give', give, setGive]] as const).map(([label, val, setter]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15 }}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setter(Math.max(0, val - 5))} aria-label={`Decrease ${label} percentage`} style={stepBtn}>−</button>
                <span style={{ color: '#fff', fontSize: 16, fontWeight: 700, width: 36, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  {val}%
                </span>
                <button onClick={() => setter(Math.min(100, val + 5))} aria-label={`Increase ${label} percentage`} style={stepBtn}>+</button>
              </div>
            </div>
          ))}

          {/* Sum indicator */}
          <div style={{ fontSize: 13, color: sum === 100 ? '#34d399' : '#f87171', marginBottom: 16, fontVariantNumeric: 'tabular-nums' }}>
            Total: {sum}% {sum !== 100 ? '— must equal 100' : '✓'}
          </div>

          {/* Mentor soft-warnings */}
          {showSavingWarn && (
            <div style={{ fontSize: 13, color: '#fbbf24', marginBottom: 8 }}>
              Save below 20% — consider saving a little more
            </div>
          )}
          {showGiveWarn && (
            <div style={{ fontSize: 13, color: '#fbbf24', marginBottom: 8 }}>
              No giving set — that's OK, it's your choice
            </div>
          )}
        </>
      )}

      {err && <div role="alert" style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <button
        onClick={handleSave}
        disabled={saving || (enabled && sum !== 100)}
        style={{
          width: '100%', padding: 14, borderRadius: 12,
          background: '#0d9488', color: '#fff', border: 'none',
          fontSize: 15, fontWeight: 600, cursor: 'pointer',
          opacity: enabled && sum !== 100 ? 0.5 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </BaseSheet>
  );
}
