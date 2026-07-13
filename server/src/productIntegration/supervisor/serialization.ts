import {
  assertProductSupervisorProjection,
  canonicalProductJson,
  deepFreezeProductJson,
  MAX_PRODUCT_SUPERVISOR_BYTES,
  snapshotProductComponentEvidence,
  type ProductSupervisorProjection,
} from '../contracts/index.js';
import { buildProductSupervisorProjection } from './project.js';

export function serializeProductSupervisorProjection(projection: ProductSupervisorProjection): string {
  assertProductSupervisorProjection(projection);
  const rebuilt = buildProductSupervisorProjection({
    nowMs: projection.evaluatedAtMs,
    revision: projection.revision,
    components: projection.components.map((component) => snapshotProductComponentEvidence(component)),
  });
  if (canonicalProductJson(rebuilt) !== canonicalProductJson(projection)) {
    throw new TypeError('supervisor projection does not match deterministic owner-evidence derivation');
  }
  const serialized = canonicalProductJson(projection);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PRODUCT_SUPERVISOR_BYTES) throw new TypeError(`serialized supervisor projection exceeds ${MAX_PRODUCT_SUPERVISOR_BYTES} UTF-8 bytes`);
  return serialized;
}

export function deserializeProductSupervisorProjection(serialized: string): Readonly<ProductSupervisorProjection> {
  if (typeof serialized !== 'string' || serialized.length === 0 || new TextEncoder().encode(serialized).byteLength > MAX_PRODUCT_SUPERVISOR_BYTES) {
    throw new TypeError('serialized supervisor projection must be 1..1048576 bytes');
  }
  const parsed: unknown = JSON.parse(serialized);
  assertProductSupervisorProjection(parsed);
  const projection = parsed as ProductSupervisorProjection;
  const rebuilt = buildProductSupervisorProjection({
    nowMs: projection.evaluatedAtMs,
    revision: projection.revision,
    components: projection.components.map((component) => snapshotProductComponentEvidence(component)),
  });
  if (canonicalProductJson(rebuilt) !== canonicalProductJson(projection)) {
    throw new TypeError('serialized supervisor projection contains forged or incomplete derived truth');
  }
  return deepFreezeProductJson(projection);
}
