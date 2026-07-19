import { createHash } from 'node:crypto';

export interface NewsItemIdentityShape {
  id: string;
  sourceKey: string;
  channel: string;
  ts: number | null;
  title: string;
  url: string | null;
}

function cleanIdentifierText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCharCode(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function boundedNewsIdentifier(value: unknown): string {
  const raw = String(value ?? '');
  const text = cleanIdentifierText(raw.slice(0, 4_096));
  if (text.length <= 240) return text;
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return `${text.slice(0, 210)}:${digest}`;
}

export function disambiguateNewsItemIds<T extends NewsItemIdentityShape>(items: readonly T[]): T[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  if ([...counts.values()].every((count) => count === 1)) return [...items];

  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const id = counts.get(item.id) === 1
      ? item.id
      : boundedNewsIdentifier(`${item.id}:collision:${createHash('sha256').update(JSON.stringify([
        item.sourceKey,
        item.channel,
        item.ts,
        item.title,
        item.url,
      ])).digest('hex')}`);
    // Exact duplicate persisted rows collapse to one row. Distinct rows with a
    // reused upstream identifier retain deterministic, content-bound IDs.
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id === item.id ? item : { ...item, id });
  }
  return result;
}
