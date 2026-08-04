interface IconProps {
  colour?: string;
  size?: number;
  className?: string;
  /** Set when adjacent visible text already conveys "Save", to avoid double-announcing. */
  decorative?: boolean;
}

export function SaveJarIcon({ colour, size = 40, className, decorative }: IconProps) {
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
      aria-label={decorative ? undefined : 'Save'}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {/* Jar body */}
      <path
        d="M13 21 L13 31 C13 32.1 13.9 33 15 33 L25 33 C26.1 33 27 32.1 27 31 L27 21"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Jar shoulder taper */}
      <path
        d="M13 21 C13 21 11.5 19.5 12 18 L16 18 L16 19.5"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M27 21 C27 21 28.5 19.5 28 18 L24 18 L24 19.5"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Rim */}
      <path
        d="M15.5 18 L24.5 18"
        stroke={teal}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Lid */}
      <rect
        x="15"
        y="16"
        width="10"
        height="2"
        rx="1"
        stroke={teal}
        strokeWidth="1.5"
      />
      {/* Seedling stem */}
      <path
        d="M20 30 L20 22"
        stroke={gold}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Left leaf */}
      <path
        d="M20 25 C20 25 17.5 23.5 16.5 20.5 C18.5 20.5 20 22.5 20 25"
        fill={gold}
        fillOpacity="0.7"
        stroke={gold}
        strokeWidth="0.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right leaf */}
      <path
        d="M20 23.5 C20 23.5 22.5 22 23.5 19 C21.5 19 20 21 20 23.5"
        fill={gold}
        fillOpacity="0.5"
        stroke={gold}
        strokeWidth="0.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
