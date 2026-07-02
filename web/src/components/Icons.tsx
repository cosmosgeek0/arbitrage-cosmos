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

export const IconGrid = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const IconWallet = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10h18" />
    <circle cx="16.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconTicket = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7h16v4a2 2 0 0 0 0 4v2H4v-2a2 2 0 0 0 0-4z" />
    <path d="M14 7v10" strokeDasharray="2 2.5" />
  </svg>
);

export const IconBrain = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 4a4 4 0 0 0-4 4v8a4 4 0 0 0 8 0V8a4 4 0 0 0-4-4z" />
    <path d="M8 10h8M8 14h8" />
  </svg>
);

export const IconRadar = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 12a8 8 0 1 0 8-8" />
    <path d="M8 12a4 4 0 1 0 4-4" />
    <path d="M12 12 L18 6" />
  </svg>
);

export const IconList = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconLayers = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);

export const IconReceipt = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 3h14v18l-2.3-1.5L14.4 21l-2.4-1.5L9.6 21l-2.3-1.5L5 21z" />
    <path d="M9 8h6M9 12h6" />
  </svg>
);

export const IconChart = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M8 16v-5M12 16V8M16 16v-3" />
  </svg>
);

export const IconShield = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const IconBook = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z" />
    <path d="M4 19a2 2 0 0 1 2-2h14" />
  </svg>
);

export const IconGear = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
  </svg>
);

export const IconPower = ({ size = 18 }: IconProps) => (
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

export const IconLock = ({ size = 24 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const IconPulse = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </svg>
);

export const IconAlert = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 9v5" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);
