export type BookLevel = [number, number];

export interface NormalizedBook {
  bids: BookLevel[];
  asks: BookLevel[];
}
export interface NormalizedTrade {
  id: number;
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function level(value: unknown): BookLevel | null {
  const tuple = Array.isArray(value) ? value : null;
  const row = record(value);
  const price = Number(tuple?.[0] ?? row?.price);
  const qty = Number(tuple?.[1] ?? row?.qty);
  return Number.isFinite(price) && Number.isFinite(qty) && price > 0 && qty > 0 ? [price, qty] : null;
}

function side(value: unknown, descending: boolean): BookLevel[] {
  if (!Array.isArray(value)) return [];
  const byPrice = new Map<number, BookLevel>();
  for (const raw of value.slice(0, 1_000)) {
    const next = level(raw);
    if (next) byPrice.set(next[0], next);
  }
  return [...byPrice.values()]
    .sort((left, right) => descending ? right[0] - left[0] : left[0] - right[0])
    .slice(0, 200);
}

export function normalizeBook(value: unknown): NormalizedBook | null {
  const payload = record(value);
  if (!payload) return null;
  const bids = side(payload.bids, true);
  const asks = side(payload.asks, false);
  if (!bids.length || !asks.length || bids[0][0] >= asks[0][0]) return null;
  return { bids, asks };
}

export function normalizeTrades(value: unknown, limit = 100): NormalizedTrade[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<number, NormalizedTrade>();
  for (const raw of value.slice(0, 1_000)) {
    const row = record(raw);
    if (!row) continue;
    const id = Number(row.id);
    const price = Number(row.price);
    const qty = Number(row.qty);
    const time = Number(row.time);
    if (![id, price, qty, time].every(Number.isFinite) || id < 0 || price <= 0 || qty <= 0 || time <= 0) continue;
    if (typeof row.isBuyerMaker !== 'boolean') continue;
    byId.set(id, { id, price, qty, time, isBuyerMaker: row.isBuyerMaker });
  }
  return [...byId.values()]
    .sort((left, right) => right.time - left.time || right.id - left.id)
    .slice(0, Math.max(1, limit));
}
