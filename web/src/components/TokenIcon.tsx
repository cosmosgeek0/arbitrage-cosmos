import { useEffect, useId, useReducer, useState } from 'react';
import { baseOf } from '../format';
import { iconUrl, onIcons, requestIcon } from '../lib/iconManifest';

// Recognized token brand hues (vivid subset). Fallback = deterministic hue.
const BRAND: Record<string, string> = {
  BTC: '#F7931A', ETH: '#627EEA', BNB: '#F0B90B', SOL: '#9945FF', DOGE: '#C2A633',
  ADA: '#2A71D0', AVAX: '#E84142', DOT: '#E6007A', MATIC: '#8247E5', POL: '#8247E5',
  LINK: '#2A5ADA', LTC: '#345D9D', BCH: '#0AC18E', TRX: '#EF0027', UNI: '#FF007A',
  FIL: '#0090FF', ICP: '#F15A24', VET: '#15BDFF', AAVE: '#B6509E', MKR: '#1AAB9B',
  COMP: '#00D395', APE: '#0054F9', SAND: '#00ADEF', MANA: '#FF2D55', GRT: '#6747ED',
  STX: '#5546FF', NEAR: '#00C08B', FTM: '#1969FF', INJ: '#0BA5EC', TIA: '#7B2BF9',
  SUI: '#4DA2FF', ARB: '#12AAFF', OP: '#FF0420', ATOM: '#6F7CBA', XRP: '#23292F',
  XLM: '#7A8CF0', TLM: '#F5A623', ALICE: '#F0648C', SLP: '#00B4D8', BREV: '#635BFF',
  NFP: '#7B61FF', BANK: '#2E7D32', POND: '#00C2A8', ALLO: '#6366F1', BERA: '#8B4513',
  NOM: '#EC4899', SYN: '#8B5CF6', ME: '#111111', DYDX: '#6966FF', WLD: '#000000',
  ZEC: '#ECB244', RE: '#22C55E', HYPER: '#12B981', SEI: '#9E1F19', ENA: '#4B5563',
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
  LDUSDT: 'USDT', LDUSDC: 'USDC', LDBTC: 'BTC', LDETH: 'ETH', LDBNB: 'BNB',
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

// Binance tokenized equities (…B suffix): stocks, not crypto — no logo CDN has
// them. They get a deliberate dark "stock badge" with the real equity ticker.
const STOCK_TOKENS = new Set([
  'AMDB', 'COINB', 'EWYB', 'INTCB', 'MSFTB', 'MSTRB', 'QCOMB', 'WDCB',
  'METAB', 'PLTRB', 'QQQB', 'LITEB', 'TSLAB', 'NVDAB', 'AAPLB', 'GOOGB',
  'AMZNB', 'HOODB', 'CRCLB', 'SPYB',
]);

/** Premium monogram chip — solid brand-hued fill with a subtle top light and
 * crisp initials (TradingView-style fallback). A missing logo reads as a
 * designed token badge, never an empty or muddy circle. */
export function Monogram({ base, size }: { base: string; size: number }) {
  const gid = useId().replace(/:/g, '');
  const b = (base || '?').toUpperCase();
  const stock = STOCK_TOKENS.has(b);
  // 1–3 crisp letters: strip leading multiplier digits (1000SATS → SATS);
  // tokenized stocks show the underlying equity ticker (MSTRB → MSTR)
  const clean = stock ? b.slice(0, -1) : b.replace(/^\d+/, '') || b;
  const text = clean.length > 4 ? clean.slice(0, 3) : clean.length === 4 ? clean.slice(0, 4) : clean;
  const c = stock ? '#1e2733' : brandColor(`${b}USDT`);
  const fs = text.length >= 4 ? 12 : text.length === 3 ? 14.5 : 18;
  return (
    <span className="tok-mono" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(255,255,255,.22)" />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="20" fill={c} />
        <circle cx="20" cy="20" r="20" fill={`url(#${gid})`} />
        <circle cx="20" cy="20" r="19.2" fill="none" stroke="rgba(0,0,0,.12)" strokeWidth="1.2" />
        <text
          x="20"
          y="21"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Inter, -apple-system, sans-serif"
          fontWeight={750}
          fontSize={fs}
          letterSpacing="-.4"
          fill="#fff"
        >
          {text}
        </text>
      </svg>
    </span>
  );
}

/**
 * Real logo resolver with a fallback chain: server-resolved CoinGecko logo
 * (near-total coverage, cached to disk) → spothq CC0 SVG → coincap PNG →
 * gradient monogram. Every icon sits in a uniform circular badge with a
 * hairline ring so all sources look consistent — never an empty circle, never
 * a jarring size mismatch. Monograms upgrade to the real logo in place once
 * the background resolver finds it.
 */
export function TokenIcon({ symbol, size = 26 }: { symbol: string; size?: number }) {
  const raw = baseOf(symbol);
  const base = ALIAS[raw] ?? raw;
  const [idx, setIdx] = useState(0);
  const [, force] = useReducer((x: number) => x + 1, 0);

  // ask the manifest for this base and re-render when its logo resolves
  useEffect(() => {
    requestIcon(base);
    setIdx(0);
    return onIcons(force);
  }, [base]);

  const resolved = iconUrl(base);
  const chain = [resolved, SPOTHQ(base), COINCAP(base)].filter(Boolean) as string[];

  const inner =
    idx >= chain.length ? (
      <Monogram base={raw} size={size} />
    ) : (
      <img
        key={chain[idx]}
        src={chain[idx]}
        width={size}
        height={size}
        alt={raw}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        style={{ width: size, height: size, display: 'block' }}
        onError={() => setIdx((i) => i + 1)}
      />
    );
  return (
    <span className="tok-badge" style={{ width: size, height: size }}>
      {inner}
    </span>
  );
}
