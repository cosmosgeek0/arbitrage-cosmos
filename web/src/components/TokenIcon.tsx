import { useId, useState } from 'react';
import { baseOf } from '../format';

// Recognized token brand hues (vivid subset). Fallback = deterministic hue.
const BRAND: Record<string, string> = {
  BTC: '#F7931A', ETH: '#627EEA', BNB: '#F0B90B', SOL: '#9945FF', DOGE: '#C2A633',
  ADA: '#2A71D0', AVAX: '#E84142', DOT: '#E6007A', MATIC: '#8247E5', LINK: '#2A5ADA',
  LTC: '#345D9D', BCH: '#0AC18E', TRX: '#EF0027', UNI: '#FF007A', FIL: '#0090FF',
  ICP: '#F15A24', VET: '#15BDFF', AAVE: '#B6509E', MKR: '#1AAB9B', COMP: '#00D395',
  APE: '#0054F9', SAND: '#00ADEF', MANA: '#FF2D55', GRT: '#6747ED', STX: '#5546FF',
  NEAR: '#00C08B', FTM: '#1969FF', INJ: '#0BA5EC', TIA: '#7B2BF9', SUI: '#4DA2FF',
  ARB: '#12AAFF', OP: '#FF0420', ATOM: '#6F7CBA', XRP: '#8A93A6', XLM: '#7A8CF0',
};

function hueOf(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function brandColor(symbol: string): string {
  const b = baseOf(symbol);
  return BRAND[b] ?? `hsl(${hueOf(b)} 62% 46%)`;
}

// Manual alias map for bases whose icon lives under a different ticker.
const ALIAS: Record<string, string> = {
  RENDER: 'RNDR',
  IOTA: 'MIOTA',
  BEAMX: 'BEAM',
  POL: 'MATIC',
  FET: 'FET',
  '1000SATS': 'SATS',
  WBETH: 'ETH',
  BNSOL: 'SOL',
};

const SPOTHQ = (base: string) =>
  `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${base.toLowerCase()}.svg`;
const COINCAP = (base: string) => `https://assets.coincap.io/assets/icons/${base.toLowerCase()}@2x.png`;

/** Deterministic gradient monogram — a missing logo is never an empty circle. */
export function Monogram({ base, size }: { base: string; size: number }) {
  const gid = useId();
  const b = (base || '?').toUpperCase();
  const text = b.slice(0, 4);
  const h1 = hueOf(b);
  const h2 = (h1 + 26) % 360;
  const fs = text.length >= 4 ? 10.5 : text.length === 3 ? 13 : 17;
  return (
    <span className="tok-mono" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`hsl(${h1} 64% 54%)`} />
            <stop offset="1" stopColor={`hsl(${h2} 62% 42%)`} />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="20" fill={`url(#${gid})`} />
        <text
          x="20"
          y="20.5"
          textAnchor="middle"
          dominantBaseline="central"
          fontWeight={700}
          fontSize={fs}
          letterSpacing="-.3"
          fill="#fff"
        >
          {text}
        </text>
      </svg>
    </span>
  );
}

/**
 * Real logo resolver with a fallback chain (Signal Lab pattern): alias map →
 * spothq CC0 SVG → coincap PNG → gradient monogram. Never an empty circle.
 */
export function TokenIcon({ symbol, size = 26 }: { symbol: string; size?: number }) {
  const raw = baseOf(symbol);
  const base = ALIAS[raw] ?? raw;
  const chain = [SPOTHQ(base), COINCAP(base)];
  const [idx, setIdx] = useState(0);
  if (idx >= chain.length) return <Monogram base={raw} size={size} />;
  const cls = 'tok-ico' + (size <= 20 ? ' sm' : size >= 40 ? ' lg' : '');
  return (
    <img
      className={cls}
      src={chain[idx]}
      width={size}
      height={size}
      alt={raw}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={{ width: size, height: size }}
      onError={() => setIdx(idx + 1)}
    />
  );
}
