import { createHmac } from 'node:crypto';
import type { BinanceUsdMSigner } from './types.js';

export type FormValue = string | number | boolean;
export type FormPair = readonly [name: string, value: FormValue];

function encodeComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function encodeForm(pairs: readonly FormPair[]): string {
  return pairs
    .map(([name, value]) => `${encodeComponent(name)}=${encodeComponent(String(value))}`)
    .join('&');
}

/** Deterministic HMAC helper for injected fixtures and future adapters. */
export function createHmacSha256Signer(secret: string): BinanceUsdMSigner {
  if (typeof secret !== 'string' || secret.length === 0 || secret.length > 4_096) {
    throw new TypeError('HMAC secret must be a non-empty bounded string');
  }
  return Object.freeze({
    algorithm: 'HMAC_SHA256' as const,
    sign(payload: string): string {
      if (typeof payload !== 'string') throw new TypeError('HMAC payload must be a string');
      return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    },
  });
}

export function signEncodedForm(encoded: string, signer: BinanceUsdMSigner): string {
  if (typeof encoded !== 'string') throw new TypeError('encoded form must be a string');
  if (signer?.algorithm !== 'HMAC_SHA256' || typeof signer.sign !== 'function') {
    throw new TypeError('signer must implement the HMAC_SHA256 port');
  }
  const signature = signer.sign(encoded);
  if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) {
    throw new TypeError('signer returned a malformed HMAC-SHA256 signature');
  }
  return `${encoded}${encoded.length > 0 ? '&' : ''}signature=${signature.toLowerCase()}`;
}
