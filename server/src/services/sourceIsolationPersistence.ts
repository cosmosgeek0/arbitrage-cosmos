import type { Ledger } from '../ledger.js';
import type {
  SourceIsolationPersistencePort,
  SourceIsolationState,
} from '../intelligenceRuntime/lifecycle/index.js';

const KEY = 'ops.public-source-isolation.v1';

function parse(raw: string | null): Readonly<SourceIsolationState> | null {
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('source isolation state is corrupt'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('source isolation state is corrupt');
  const row = value as Record<string, unknown>;
  if (row.schema !== 'cosmos.source-isolation.v1'
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
    || row.sources === null || typeof row.sources !== 'object' || Array.isArray(row.sources)
    || !Array.isArray(row.receipts)) throw new Error('source isolation state is corrupt');
  return Object.freeze(value as SourceIsolationState);
}

export function createSourceIsolationPersistence(
  ledger: Pick<Ledger, 'getConfigValue' | 'compareAndSetConfigValueAndLogEvents'>,
): SourceIsolationPersistencePort {
  if (!ledger || typeof ledger.getConfigValue !== 'function'
    || typeof ledger.compareAndSetConfigValueAndLogEvents !== 'function') {
    throw new TypeError('source isolation persistence requires the canonical Ledger CAS owner');
  }
  const port: SourceIsolationPersistencePort = {
    load: () => parse(ledger.getConfigValue(KEY)),
    compareAndSet(expected, next, audit) {
      const expectedRaw = expected === null ? null : JSON.stringify(expected);
      const current = ledger.getConfigValue(KEY);
      if (current !== expectedRaw) return false;
      const nextRaw = JSON.stringify(next);
      const result = ledger.compareAndSetConfigValueAndLogEvents(
        KEY,
        expectedRaw,
        nextRaw,
        [Object.freeze({
          kind: 'intelligence_runtime.source_control',
          symbol: null,
          data: Object.freeze({
            schema: 'cosmos.source-control-receipt.v1',
            ...audit,
          }),
        })],
      );
      return result.committed;
    },
  };
  return Object.freeze(port);
}
