import { useEffect, useState } from 'react';
import { getJarMovements, postJarMove, type JarMovement, type JarBalances } from '../../lib/api';
import { SpendJarIcon } from '../icons/SpendJarIcon';
import { SaveJarIcon  } from '../icons/SaveJarIcon';
import { GiveJarIcon  } from '../icons/GiveJarIcon';
import { BaseSheet } from '../ui/BaseSheet';
import { tick } from '../../lib/haptics';

type JarType = 'spend' | 'save' | 'give';

const KIND_LABELS: Record<string, string> = {
  allocation:      'Earned',
  enable_seed:     'Starting balance',
  manual_move:     'Moved',
  spend:           'Spent',
  give_request:    'Gift requested',
  give_fulfilled:  'Gift made',
  give_declined:   'Gift returned',
  goal_allocate:   'Saved for goal',
  goal_deallocate: 'Goal released',
  goal_purchase:   'Goal bought',
};

const ICONS: Record<JarType, React.ComponentType<{ size?: number; decorative?: boolean }>> = {
  spend: SpendJarIcon,
  save:  SaveJarIcon,
  give:  GiveJarIcon,
};

interface Props {
  jar: JarType;
  balances: JarBalances;
  currency: string;
  familyId: string;
  childId: string;
  onClose: () => void;
  onBalanceChange: (updated: JarBalances) => void;
  onGiveRequest: () => void;
  onViewGoals: () => void;
}

function fmt(pence: number, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(pence / 100);
}

function fmtDate(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  });
}

export function JarDetailSheet({
  jar, balances, currency, familyId, childId, onClose, onBalanceChange, onGiveRequest, onViewGoals,
}: Props) {
  const [movements, setMovements] = useState<JarMovement[]>([]);
  const [showMove, setShowMove]   = useState(false);
  const [moveTo, setMoveTo]       = useState<JarType>(jar === 'spend' ? 'save' : 'spend');
  const [moveAmt, setMoveAmt]     = useState('');
  const [moveErr, setMoveErr]     = useState('');
  const [moving, setMoving]       = useState(false);
  const Icon = ICONS[jar];

  useEffect(() => {
    getJarMovements(familyId, childId, 20).then(({ movements: m }) =>
      setMovements(m.filter(mv => mv.jar === jar).slice(0, 5))
    ).catch(() => {});
  }, [jar, familyId, childId]);

  // Reset moveTo whenever jar changes so it's always a valid "other" jar
  useEffect(() => {
    setMoveTo(jar === 'spend' ? 'save' : 'spend');
  }, [jar]);

  async function handleMove() {
    const amount = Math.round(parseFloat(moveAmt) * 100);
    if (!amount || amount <= 0) { setMoveErr('Enter a valid amount'); return; }
    setMoving(true);
    try {
      const { balances: updated } = await postJarMove({
        family_id: familyId,
        child_id: childId,
        from_jar: jar,
        to_jar: moveTo,
        amount,
      });
      onBalanceChange(updated);
      const fresh = await getJarMovements(familyId, childId, 20);
      setMovements(fresh.movements.filter(m => m.jar === jar).slice(0, 5));
      setShowMove(false);
      setMoveAmt('');
      setMoveErr('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not move money — try again';
      setMoveErr(msg);
    } finally {
      setMoving(false);
    }
  }

  return (
    <BaseSheet
      onClose={onClose}
      zIndex={200}
      label={`${jar} jar details`}
      panelStyle={{
        background: '#1a2e22',
        borderRadius: '20px 20px 0 0',
        padding: '8px 20px 40px',
        fontFamily: 'Manrope, sans-serif',
        maxHeight: '85vh',
        overflowY: 'auto',
      }}
    >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Icon size={32} decorative />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', textTransform: 'capitalize' }}>
              {jar}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(balances[jar], currency)}
            </div>
          </div>
          <button
            onClick={() => { void tick(); onClose(); }}
            className="tap-target-44"
            style={{
              marginLeft: 'auto',
              color: 'rgba(255,255,255,0.4)',
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Recent movements */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8, letterSpacing: '0.06em' }}>
            RECENT
          </div>
          {movements.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>No activity yet</div>
          )}
          {movements.map(m => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                  {KIND_LABELS[m.kind] ?? m.kind}
                </span>
                {m.note && (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>
                    {m.note}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: m.delta >= 0 ? '#34d399' : '#f87171',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {m.delta >= 0 ? '+' : ''}{fmt(m.delta, currency)}
                </span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                  {fmtDate(m.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        {!showMove ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => setShowMove(true)} style={actionBtn('#0d9488')}>
              Move money
            </button>
            {jar === 'give' && (
              <button onClick={onGiveRequest} style={actionBtn('#d97706')}>
                Make a gift
              </button>
            )}
            {jar === 'save' && (
              <button onClick={onViewGoals} style={actionBtn('#d97706')}>
                My goals
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <select
              value={moveTo}
              onChange={e => setMoveTo(e.target.value as JarType)}
              style={{
                padding: 12,
                borderRadius: 10,
                background: '#0f1a14',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: 15,
                fontFamily: 'Manrope, sans-serif',
              }}
            >
              {(['spend', 'save', 'give'] as JarType[]).filter(j => j !== jar).map(j => (
                <option key={j} value={j}>
                  Move to {j.charAt(0).toUpperCase() + j.slice(1)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Amount (e.g. 2.50)"
              value={moveAmt}
              onChange={e => setMoveAmt(e.target.value)}
              style={{
                padding: 12,
                borderRadius: 10,
                background: '#0f1a14',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: 15,
                fontFamily: 'Manrope, sans-serif',
              }}
            />
            {moveErr && (
              <div style={{ color: '#f87171', fontSize: 13 }}>{moveErr}</div>
            )}
            <button onClick={handleMove} disabled={moving} style={actionBtn(moving ? '#0a6b61' : '#0d9488')}>
              {moving ? 'Moving…' : 'Confirm move'}
            </button>
            <button
              onClick={() => { setShowMove(false); setMoveErr(''); setMoveAmt(''); }}
              style={actionBtn('rgba(255,255,255,0.08)')}
            >
              Cancel
            </button>
          </div>
        )}
    </BaseSheet>
  );
}

function actionBtn(bg: string): React.CSSProperties {
  return {
    padding: '14px',
    borderRadius: 12,
    background: bg,
    color: '#fff',
    border: 'none',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'Manrope, sans-serif',
    width: '100%',
    textAlign: 'center',
  };
}
