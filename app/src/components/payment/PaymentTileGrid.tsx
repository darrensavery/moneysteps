import { Landmark } from 'lucide-react';

export type Provider = 'monzo' | 'revolut' | 'paypal' | 'venmo' | 'bank';

type Props = {
  onSelect: (p: Provider) => void;
  availability: Record<Provider, boolean>; // false → tile shows "Add handle" hint
};

const TILES: { id: Provider; label: string; emoji: string }[] = [
  { id: 'monzo',   label: 'Monzo',         emoji: '🟡' },
  { id: 'revolut', label: 'Revolut',       emoji: '⚫' },
  { id: 'paypal',  label: 'PayPal',        emoji: '🔵' },
  { id: 'venmo',   label: 'Venmo',         emoji: '💙' },
  { id: 'bank',    label: 'Bank Transfer', emoji: '🏦' },
];

export function PaymentTileGrid({ onSelect, availability }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3 px-4 pt-2 pb-4">
      {TILES.map((t) => {
        const ok = availability[t.id];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white py-4 active:bg-neutral-50"
          >
            {t.id === 'bank' ? (
              <Landmark size={24} />
            ) : (
              <span className="text-[22px]" aria-hidden>{t.emoji}</span>
            )}
            <span className="text-[13px] font-semibold">{t.label}</span>
            {!ok && t.id !== 'bank' && (
              <span className="text-[10px] text-neutral-400">No handle</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
