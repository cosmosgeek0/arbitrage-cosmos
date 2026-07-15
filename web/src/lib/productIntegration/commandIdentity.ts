import {
  PRODUCT_COMMAND_SCHEMA,
  type ProductCommandResultIdentity,
} from './model';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTROL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,159}$/;

export async function deriveProductCommandResultIdentity(
  idempotencyKey: string,
  controlId: string,
): Promise<Readonly<ProductCommandResultIdentity>> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    || !CONTROL_ID_PATTERN.test(controlId)) {
    throw new Error('COMMAND_RESULT_IDENTITY_INPUT_INVALID');
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('COMMAND_RESULT_IDENTITY_DERIVATION_UNAVAILABLE');
  const canonicalIdentity = JSON.stringify({
    controlId,
    idempotencyKey,
    schema: PRODUCT_COMMAND_SCHEMA,
  });
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonicalIdentity));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze({ commandId: `sysctrl_${hex}`, idempotencyKey, controlId });
}
