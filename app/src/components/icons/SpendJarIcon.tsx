interface IconProps {
  colour?: string;
  size?: number;
  className?: string;
  /** Set when adjacent visible text already conveys "Spend", to avoid double-announcing. */
  decorative?: boolean;
}

export function SpendJarIcon({ colour, size = 40, className, decorative }: IconProps) {
  const teal = colour ?? '#0d9488';
  const gold = '#d97706';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'Spend'}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {/* Thumb */}
      <path
        d="M10 26 C10 26 8 24 8 21 L8 18 C8 16.9 8.9 16 10 16 C11.1 16 12 16.9 12 18 L12 20"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Index finger */}
      <path
        d="M12 20 L12 13 C12 11.9 12.9 11 14 11 C15.1 11 16 11.9 16 13 L16 20"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Middle finger */}
      <path
        d="M16 20 L16 12 C16 10.9 16.9 10 18 10 C19.1 10 20 10.9 20 12 L20 20"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Ring finger */}
      <path
        d="M20 20 L20 13 C20 11.9 20.9 11 22 11 C23.1 11 24 11.9 24 13 L24 20"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Pinky + palm closing arc */}
      <path
        d="M24 20 L24 16 C24 14.9 24.9 14 26 14 C27.1 14 28 14.9 28 16 L28 22 C28 25 26 28 22 29 L14 29 C12 29 10 27.5 10 26"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Teal wrist accent line */}
      <line
        x1="10"
        y1="26"
        x2="28"
        y2="26"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />
      {/* Arrow up from palm — spending going out */}
      <path
        d="M20 22 L20 7"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M17 10 L20 7 L23 10"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
