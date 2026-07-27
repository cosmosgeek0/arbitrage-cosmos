import assert from 'node:assert/strict';
import test from 'node:test';

import { decodePrivateReadPermissions } from '../../dist/binance/privateReadDecoder.js';

const REQUIRED_TRUE_FLAGS = ['enableReading', 'ipRestrict'];

const REQUIRED_FALSE_FLAGS = [
  'enableWithdrawals', 'enableInternalTransfer', 'enableMargin', 'enableFutures',
  'permitsUniversalTransfer', 'enableVanillaOptions', 'enableFixApiTrade',
  'enableSpotAndMarginTrading', 'enablePortfolioMarginTrading',
];

const REQUIRED_FLAGS = [...REQUIRED_TRUE_FLAGS, ...REQUIRED_FALSE_FLAGS];

const RETURNED_KEYS = [...REQUIRED_FLAGS, 'enableFixReadOnly', 'status', 'violations', 'reason'].sort();

/** The only payload shape that may ever decode green. */
function safePayload(overrides = {}) {
  const payload = {};
  for (const flag of REQUIRED_TRUE_FLAGS) payload[flag] = true;
  for (const flag of REQUIRED_FALSE_FLAGS) payload[flag] = false;
  return { ...payload, ...overrides };
}

test('a read-only IP-pinned payload decodes VERIFIED with no violations', () => {
  const decoded = decodePrivateReadPermissions(safePayload());
  assert.equal(decoded.status, 'VERIFIED');
  assert.deepEqual(decoded.violations, []);
  assert.equal(decoded.reason, null);
  assert.equal(decoded.enableFixReadOnly, null, 'an absent informational flag stays unproven');
  for (const flag of REQUIRED_TRUE_FLAGS) assert.equal(decoded[flag], true, flag);
  for (const flag of REQUIRED_FALSE_FLAGS) assert.equal(decoded[flag], false, flag);
});

test('every safe-direction violation is named exactly and sorted', () => {
  // A required-true flag is violated by false; a required-false flag by true.
  for (const flag of REQUIRED_TRUE_FLAGS) {
    const decoded = decodePrivateReadPermissions(safePayload({ [flag]: false }));
    assert.equal(decoded.status, 'UNSAFE', flag);
    assert.deepEqual(decoded.violations, [flag], flag);
    assert.equal(decoded.reason, 'UNSAFE_PERMISSION_POSTURE', flag);
    assert.equal(decoded[flag], false, flag);
  }
  for (const flag of REQUIRED_FALSE_FLAGS) {
    const decoded = decodePrivateReadPermissions(safePayload({ [flag]: true }));
    assert.equal(decoded.status, 'UNSAFE', flag);
    assert.deepEqual(decoded.violations, [flag], flag);
    assert.equal(decoded.reason, 'UNSAFE_PERMISSION_POSTURE', flag);
    assert.equal(decoded[flag], true, flag);
  }

  const everything = {};
  for (const flag of REQUIRED_TRUE_FLAGS) everything[flag] = false;
  for (const flag of REQUIRED_FALSE_FLAGS) everything[flag] = true;
  const decoded = decodePrivateReadPermissions(everything);
  assert.equal(decoded.status, 'UNSAFE');
  assert.deepEqual(decoded.violations, [...REQUIRED_FLAGS].sort(), 'all violations, lexicographically sorted');
});

test('a payload that is not a plain object is UNKNOWN with every flag null', () => {
  const hostile = [
    null, undefined, 'true', 42, 0, true, false, Symbol('x'), 10n,
    [], [safePayload()], () => safePayload(), new Date(), new Map(),
  ];
  for (const payload of hostile) {
    const decoded = decodePrivateReadPermissions(payload);
    assert.equal(decoded.status, 'UNKNOWN', String(payload?.toString?.() ?? payload));
    assert.equal(decoded.reason, 'MALFORMED_OR_INCOMPLETE');
    assert.deepEqual(decoded.violations, []);
    for (const flag of REQUIRED_FLAGS) assert.equal(decoded[flag], null, flag);
    assert.equal(decoded.enableFixReadOnly, null);
  }

  // Flags reachable only through the prototype chain are not evidence.
  const inherited = decodePrivateReadPermissions(Object.create(safePayload()));
  assert.equal(inherited.status, 'UNKNOWN');
  assert.equal(inherited.reason, 'MALFORMED_OR_INCOMPLETE');
  for (const flag of REQUIRED_FLAGS) assert.equal(inherited[flag], null, flag);
});

test('a missing or non-boolean required flag is UNKNOWN, never inferred green', () => {
  for (const bad of ['true', 'false', 1, 0, null, undefined, {}, [], NaN]) {
    const payload = safePayload({ enableWithdrawals: bad });
    const decoded = decodePrivateReadPermissions(payload);
    assert.equal(decoded.status, 'UNKNOWN', String(bad));
    assert.equal(decoded.reason, 'MALFORMED_OR_INCOMPLETE', String(bad));
    assert.equal(decoded.enableWithdrawals, null, 'the malformed flag alone is nulled');
    assert.equal(decoded.enableReading, true, 'valid booleans are preserved');
    assert.equal(decoded.ipRestrict, true, 'valid booleans are preserved');
    assert.equal(decoded.enableFutures, false, 'valid booleans are preserved');
  }

  const missing = safePayload();
  delete missing.ipRestrict;
  const decoded = decodePrivateReadPermissions(missing);
  assert.equal(decoded.status, 'UNKNOWN');
  assert.equal(decoded.ipRestrict, null);
  assert.equal(decoded.enableReading, true);
  assert.deepEqual(decoded.violations, [], 'an unproven flag is not a violation');

  // An incomplete payload stays UNKNOWN even when what it did carry is unsafe:
  // missing evidence outranks a bad posture, and the observed breach is kept.
  const partial = safePayload({ enableWithdrawals: true });
  delete partial.enableFutures;
  const mixed = decodePrivateReadPermissions(partial);
  assert.equal(mixed.status, 'UNKNOWN');
  assert.equal(mixed.reason, 'MALFORMED_OR_INCOMPLETE');
  assert.equal(mixed.enableFutures, null);
  assert.deepEqual(mixed.violations, ['enableWithdrawals']);
});

test('reading a flag never runs foreign code', () => {
  let reads = 0;
  const effectful = safePayload();
  Object.defineProperty(effectful, 'enableWithdrawals', {
    configurable: true,
    enumerable: true,
    get() {
      reads += 1;
      return false;
    },
  });

  const decoded = decodePrivateReadPermissions(effectful);
  assert.equal(reads, 0, 'the accessor was never invoked');
  assert.equal(decoded.enableWithdrawals, null, 'an accessor is treated as absent evidence');
  assert.equal(decoded.status, 'UNKNOWN');
});

test('enableFixReadOnly is reported but never moves the verdict', () => {
  for (const value of [true, false]) {
    const decoded = decodePrivateReadPermissions(safePayload({ enableFixReadOnly: value }));
    assert.equal(decoded.enableFixReadOnly, value);
    assert.equal(decoded.status, 'VERIFIED', 'informational only');
    assert.deepEqual(decoded.violations, [], 'it is never a violation');
    assert.equal(decoded.reason, null);
  }

  for (const bad of ['true', 1, null, undefined, {}]) {
    const decoded = decodePrivateReadPermissions(safePayload({ enableFixReadOnly: bad }));
    assert.equal(decoded.enableFixReadOnly, null, 'unreadable informational flag is null');
    assert.equal(decoded.status, 'VERIFIED', 'it cannot make a complete payload UNKNOWN');
    assert.equal(decoded.reason, null);
  }

  const unsafe = decodePrivateReadPermissions(safePayload({ enableFixReadOnly: true, enableMargin: true }));
  assert.equal(unsafe.status, 'UNSAFE');
  assert.deepEqual(unsafe.violations, ['enableMargin'], 'it is absent from violations');
});

test('unknown keys and raw payload values are never returned', () => {
  const secret = 'sk-live-must-not-appear';
  const decoded = decodePrivateReadPermissions(safePayload({
    apiKey: secret,
    tradingAuthorityExpirationTime: 1_784_390_000_000,
    createTime: 1_784_000_000_000,
    status: 'ATTACKER_SUPPLIED_VERIFIED',
    reason: secret,
    violations: ['not-ours'],
    toString: () => secret,
  }));

  assert.deepEqual(Object.keys(decoded).sort(), RETURNED_KEYS, 'exactly the normalized keys');
  assert.equal(decoded.status, 'VERIFIED', 'an input key never overwrites the verdict');
  assert.equal(decoded.reason, null);
  assert.deepEqual(decoded.violations, []);
  assert.ok(!JSON.stringify(decoded).includes(secret), 'no raw input value survives the decode');
  for (const value of Object.values(decoded)) {
    assert.ok(
      typeof value === 'boolean' || value === null || Array.isArray(value)
        || ['VERIFIED', 'UNSAFE', 'UNKNOWN'].includes(value),
      'only normalized facts are returned',
    );
  }

  // The verdict is a fact, not a mutable handle.
  assert.ok(Object.isFrozen(decoded));
  assert.ok(Object.isFrozen(decoded.violations));

  // Decoding leaves the caller's payload untouched.
  const payload = safePayload({ enableFutures: true });
  const before = structuredClone(payload);
  decodePrivateReadPermissions(payload);
  assert.deepEqual(payload, before);
});
