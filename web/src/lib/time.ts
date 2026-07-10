export const TIME_ZONE_OPTIONS = [
  { id: 'Asia/Kolkata', label: 'India' },
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'Asia/Singapore', label: 'Asia' },
  { id: 'Europe/London', label: 'Europe' },
] as const;

export function dayKey(date: Date, zone?: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function keyDate(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

export function addDays(key: string, days: number): string {
  const date = keyDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayFor(key: string): string {
  const weekday = keyDate(key).getUTCDay();
  return addDays(key, weekday === 0 ? -6 : 1 - weekday);
}

export function formatKey(key: string, options: Intl.DateTimeFormatOptions): string {
  return keyDate(key).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
}

export function resolvedZoneLabel(clockZone: string): string {
  return clockZone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : clockZone;
}
