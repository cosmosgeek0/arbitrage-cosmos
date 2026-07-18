import { createHash } from 'node:crypto';
import type { Ledger } from '../ledger.js';
import type {
  DeploymentFreezeClearAuditRecord,
  DeploymentFreezeClearPersistenceAppendResult,
  DeploymentFreezeClearPersistencePort,
} from '../systemIntegration/ops/index.js';

const STATE_KEY = 'ops.deployment-freeze-clear.v1';
const SCHEMA = 'cosmos.deployment-freeze-clear.v1';

function receiptId(record: Readonly<DeploymentFreezeClearAuditRecord>): string {
  return `freeze-clear:${createHash('sha256').update(record.requestDigest, 'utf8').digest('hex')}`;
}

function parse(raw: string | null): Readonly<DeploymentFreezeClearAuditRecord & { receiptId: string }> | null {
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('freeze clear audit state is corrupt'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('freeze clear audit state is corrupt');
  const row = value as Record<string, unknown>;
  if (row.schema !== SCHEMA || typeof row.idempotencyKey !== 'string'
    || typeof row.requestDigest !== 'string' || typeof row.receiptId !== 'string'
    || row.result !== 'CLEAR_AUTHORIZED') throw new Error('freeze clear audit state is corrupt');
  return Object.freeze(row as unknown as DeploymentFreezeClearAuditRecord & { receiptId: string });
}

export function createDeploymentFreezeClearPersistence(
  ledger: Pick<Ledger, 'getConfigValue' | 'compareAndSetConfigValueAndLogEvents'>,
): DeploymentFreezeClearPersistencePort {
  if (!ledger || typeof ledger.getConfigValue !== 'function'
    || typeof ledger.compareAndSetConfigValueAndLogEvents !== 'function') {
    throw new TypeError('deployment freeze clear persistence requires the canonical Ledger CAS owner');
  }
  return Object.freeze({
    read(idempotencyKey: string) {
      const current = parse(ledger.getConfigValue(STATE_KEY));
      return current?.idempotencyKey === idempotencyKey ? current : null;
    },
    append(record: Readonly<DeploymentFreezeClearAuditRecord>): DeploymentFreezeClearPersistenceAppendResult {
      const expected = ledger.getConfigValue(STATE_KEY);
      const prior = parse(expected);
      if (prior !== null && prior.idempotencyKey === record.idempotencyKey) {
        return Object.freeze({
          kind: prior.requestDigest === record.requestDigest
            ? 'REPLAY' as const
            : 'CONFLICT' as const,
          record: prior,
        });
      }
      const durable = Object.freeze({ ...record, receiptId: receiptId(record) });
      const next = JSON.stringify(durable);
      const result = ledger.compareAndSetConfigValueAndLogEvents(
        STATE_KEY,
        expected,
        next,
        [Object.freeze({
          kind: 'ops.deployment_freeze.clear_authorized',
          symbol: null,
          data: durable,
        })],
      );
      if (!result.committed) {
        const raced = parse(result.currentValue);
        if (raced === null) throw new Error('freeze clear audit CAS failed without current state');
        return Object.freeze({
          kind: raced.idempotencyKey === record.idempotencyKey && raced.requestDigest === record.requestDigest
            ? 'REPLAY' as const
            : 'CONFLICT' as const,
          record: raced,
        });
      }
      return Object.freeze({ kind: 'APPENDED' as const, record: durable });
    },
  });
}
