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

/** Exact UTC boundaries for a calendar day in an IANA time zone. */
export function dayBounds(key: string, zone?: string): { since: number; until: number } {
  const timeZone = zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locate = (dateKey: string): number => {
    const target = Date.parse(`${dateKey}T00:00:00Z`);
    let guess = target;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    for (let pass = 0; pass < 3; pass += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
      const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      guess += target - displayed;
    }
    return guess;
  };
  return { since: locate(key), until: locate(addDays(key, 1)) };
}
