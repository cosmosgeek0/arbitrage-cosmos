export interface CalItem {
  id: string;
  title: string;
  country: string;
  indicator: string;
  importance: number;
  period: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  unit: string | null;
  scale?: string | null;
  currency?: string | null;
  category?: string | null;
  comment?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  date: string;
}

export const CALENDAR_COUNTRIES = [
  'US', 'EU', 'GB', 'JP', 'CN', 'IN', 'DE', 'CA', 'AU', 'FR',
  'KR', 'ID', 'TR', 'IT', 'MX', 'BR', 'CH', 'NZ', 'ZA', 'SA',
] as const;

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', EU: 'European Union', GB: 'United Kingdom', JP: 'Japan', CN: 'China',
  IN: 'India', DE: 'Germany', CA: 'Canada', AU: 'Australia', FR: 'France', KR: 'South Korea',
  ID: 'Indonesia', TR: 'Turkey', IT: 'Italy', MX: 'Mexico', BR: 'Brazil', CH: 'Switzerland',
  NZ: 'New Zealand', ZA: 'South Africa', SA: 'Saudi Arabia',
};

const CATEGORY_NAMES: Record<string, string> = {
  bnd: 'Bond Market', bsnss: 'Business Activity', cnsm: 'Consumer Activity', enrg: 'Energy',
  gov: 'Government', hse: 'Housing', lbr: 'Labour Market', mny: 'Monetary Policy',
  prce: 'Prices', trd: 'Trade',
};

export function flag(country: string): string {
  if (!country || country.length !== 2) return '🏳️';
  return String.fromCodePoint(...[...country.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

export function countryName(country: string): string {
  return COUNTRY_NAMES[country] ?? country;
}

export function categoryName(item: CalItem): string {
  const raw = item.category?.trim().toLowerCase();
  if (raw && CATEGORY_NAMES[raw]) return CATEGORY_NAMES[raw];
  if (item.indicator?.trim()) return item.indicator.trim();
  return raw ? raw.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Economic Release';
}

export function calVal(value: number | null, unit: string | null, scale?: string | null): string {
  if (value === null || value === undefined) return '—';
  const digits = Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3;
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
  const suffix = scale ?? '';
  if (!unit) return `${number}${suffix}`;
  if (unit === '$' || unit === '¥' || unit === '€' || unit === '£') return `${unit}${number}${suffix}`;
  return `${number}${unit}${suffix}`;
}
