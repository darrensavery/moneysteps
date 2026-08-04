interface IconProps {
  colour?: string;
  size?: number;
  className?: string;
  /** Set when adjacent visible text already conveys "Give", to avoid double-announcing. */
  decorative?: boolean;
}

export function GiveJarIcon({ colour, size = 40, className, decorative }: IconProps) {
  const gold = colour ?? '#d97706';
  const teal = '#0d9488';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'Give'}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {/* Left arm / wrist */}
      <path
        d="M8 30 C8 30 8 26 10 24 L14 20 C14.7 19.3 15.7 19.3 16.3 20 L18 22"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right arm / wrist */}
      <path
        d="M32 30 C32 30 32 26 30 24 L26 20 C25.3 19.3 24.3 19.3 23.7 20 L22 22"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cupped bowl — left half */}
      <path
        d="M18 22 L16 26 C16 28.2 17.8 30 20 30"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cupped bowl — right half */}
      <path
        d="M22 22 L24 26 C24 28.2 22.2 30 20 30"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Palm line across the top of cup */}
      <path
        d="M18 22 L22 22"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Teal shadow / base beneath hands */}
      <path
        d="M15 29 Q20 32 25 29"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* Coin rising from centre — circle */}
      <circle
        cx="20"
        cy="16"
        r="3.5"
        stroke={teal}
        strokeWidth="1.5"
      />
      {/* Coin highlight — vertical line inside */}
      <line
        x1="20"
        y1="13.5"
        x2="20"
        y2="18.5"
        stroke={teal}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* Small upward motion lines beside coin */}
      <path
        d="M16.5 17 L15.5 15.5"
        stroke={teal}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M23.5 17 L24.5 15.5"
        stroke={teal}
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}
