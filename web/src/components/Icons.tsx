interface IconProps {
  size?: number;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

export const IconGrid = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const IconRadar = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 12a8 8 0 1 0 8-8" />
    <path d="M8 12a4 4 0 1 0 4-4" />
    <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    <path d="M12 12 L18 6" />
  </svg>
);

export const IconWallet = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10h18" />
    <circle cx="16.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSliders = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
    <circle cx="15.5" cy="8" r="2" />
    <circle cx="9.5" cy="16" r="2" />
  </svg>
);

export const IconPower = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3v8" />
    <path d="M6.3 6.5a8 8 0 1 0 11.4 0" />
  </svg>
);

export const IconSearch = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconLock = ({ size = 28 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const IconPulse = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </svg>
);
