import { formatCurrency } from '../../lib/api';

type Props = {
  unpaidMinorUnits: number;
  currency: string;
  onClick?: () => void;
};

export function UnpaidIndicator({ unpaidMinorUnits, currency, onClick }: Props) {
  if (unpaidMinorUnits <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-1 text-[12px] font-semibold text-amber-900"
    >
      Unpaid: {formatCurrency(unpaidMinorUnits, currency)}
    </button>
  );
}
