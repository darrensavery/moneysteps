import { SpendJarIcon } from '../icons/SpendJarIcon';
import { SaveJarIcon }  from '../icons/SaveJarIcon';
import { GiveJarIcon }  from '../icons/GiveJarIcon';
import type { JarBalances } from '../../lib/api';

type JarType = 'spend' | 'save' | 'give';

const JAR_LABELS: Record<JarType, string> = {
  spend: 'Spend',
  save:  'Save',
  give:  'Give',
};

const JAR_ICONS: Record<JarType, React.ComponentType<{ size?: number; className?: string; decorative?: boolean }>> = {
  spend: SpendJarIcon,
  save:  SaveJarIcon,
  give:  GiveJarIcon,
};

interface JarCardProps {
  jar:      JarType;
  balances: JarBalances;
  currency: string;
  onClick:  (jar: JarType) => void;
}

function formatJarBalance(pence: number, currency: string): string {
  const amount = pence / 100;
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
}

export function JarCard({ jar, balances, currency, onClick }: JarCardProps) {
  const Icon    = JAR_ICONS[jar];
  const label   = JAR_LABELS[jar];
  const balance = balances[jar];

  return (
    <button
      type="button"
      onClick={() => onClick(jar)}
      className="flex-1 flex flex-col items-center gap-2 px-3 py-4 bg-[#1a2e25] border border-white/10 rounded-xl cursor-pointer transition-colors hover:bg-[#1f3a2e] active:bg-[#172a21] min-w-0"
    >
      <Icon size={36} decorative />
      <span className="text-[0.6875rem] font-semibold text-white/50 uppercase tracking-widest">
        {label}
      </span>
      <span className="text-[1.125rem] font-bold text-white tabular-nums">
        {formatJarBalance(balance, currency)}
      </span>
    </button>
  );
}
