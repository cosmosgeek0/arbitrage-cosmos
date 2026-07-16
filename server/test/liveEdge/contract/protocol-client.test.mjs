import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  EDGE_PROTOCOL_V1_MAX_FRAME_BYTES,
  EDGE_PROTOCOL_V1_SCHEMA_SHA256,
  EdgeProtocolV1Client,
  createEdgeProtocolSchemaRuntime,
} from '../../../dist/liveEdge/adapters/edgeProtocol/index.js';
import {
  buildActionableAssessment,
  canonicalFrame,
  cloneFrozenFixture,
  loadFrozenProtocolFixtures,
  rawProtocolSchemaText,
} from '../fixtures/protocol-fixtures.mjs';

const LOCAL_RECEIPT_TIME_MS = 1_800_000_000_000;
const FROZEN_UTC_MILLIS_MINIMUM = 1_262_304_000_000;
const FROZEN_UTC_MILLIS_MAXIMUM = 4_102_444_800_000;
const encoder = new TextEncoder();
const schemaRuntime = createEdgeProtocolSchemaRuntime(rawProtocolSchemaText);
const client = new EdgeProtocolV1Client(schemaRuntime);

function accepted(frame, receiptTimeMs = LOCAL_RECEIPT_TIME_MS) {
  const result = client.decode(frame, receiptTimeMs);
  assert.equal(result.ok, true, result.ok ? undefined : `${result.error.code}: ${result.error.message}`);
  return result.envelope;
}

function rejected(frame, expectedCode, receiptTimeMs = LOCAL_RECEIPT_TIME_MS) {
  const result = client.decode(frame, receiptTimeMs);
  assert.equal(result.ok, false, `frame unexpectedly accepted; expected ${expectedCode}`);
  assert.equal(result.error.schema, 'ProtocolErrorV1');
  assert.equal(result.error.code, expectedCode);
  assert.equal(result.error.occurredAtMs, receiptTimeMs);
  assert.equal(Object.isFrozen(result.error), true);
  return result.error;
}

function addOwnDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return target;
}

function assertDeeplyFrozen(value) {
  const pending = [value];
  const seen = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    assert.equal(Object.isFrozen(current), true);
    pending.push(...Object.values(current));
  }
}

test('schema runtime binds the exact frozen schema bytes and SHA-256', () => {
  const independentSha256 = createHash('sha256').update(rawProtocolSchemaText, 'utf8').digest('hex');
  assert.equal(independentSha256, '229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c');
  assert.equal(EDGE_PROTOCOL_V1_SCHEMA_SHA256, independentSha256);
  assert.equal(schemaRuntime.rawSha256, independentSha256);
  assert.equal(Object.isFrozen(schemaRuntime.document), true);
  assert.throws(
    () => createEdgeProtocolSchemaRuntime(`${rawProtocolSchemaText} `),
    /schema SHA-256 mismatch/,
  );

  assert.throws(
    () => new EdgeProtocolV1Client({
      rawSha256: '0'.repeat(64),
      document: schemaRuntime.document,
      isRegisteredEnvelopeSchema: () => true,
      validateEnvelope: () => [],
    }),
    /exact hash-locked EDGE_PROTOCOL_V1 schema runtime is required/,
  );
});

test('client preserves frozen valid and invalid fixture parity', async (t) => {
  const fixtures = loadFrozenProtocolFixtures();
  const invalidCodes = new Map([
    ['unknown-version-fails-closed', 'PROTOCOL_VERSION_UNSUPPORTED'],
    ['unknown-field-rejected', 'PROTOCOL_SCHEMA_INVALID'],
    ['forbidden-secret-key', 'PROTOCOL_FORBIDDEN_CONTENT'],
    ['forbidden-order-authority', 'PROTOCOL_FORBIDDEN_CONTENT'],
    ['float-money-rejected', 'PROTOCOL_SCHEMA_INVALID'],
    ['bad-enum-cohort', 'PROTOCOL_SCHEMA_INVALID'],
    ['missing-required-times', 'PROTOCOL_SCHEMA_INVALID'],
    ['unknown-schema-name', 'PROTOCOL_VERSION_UNSUPPORTED'],
    ['timestamp-out-of-range', 'PROTOCOL_SCHEMA_INVALID'],
  ]);

  for (const fixture of fixtures.valid) {
    await t.test(`accepts frozen valid fixture: ${fixture.name}`, () => {
      const frame = canonicalFrame(fixture.envelope);
      const envelope = accepted(frame);
      assert.equal(envelope.schema, fixture.envelope.schema);
      assert.equal(envelope.revision, fixture.envelope.revision);
      assert.equal(envelope.canonicalJson, frame);
    });
  }

  assert.equal(invalidCodes.size, fixtures.invalid.length, 'every frozen invalid fixture needs an exact expectation');
  for (const fixture of fixtures.invalid) {
    await t.test(`rejects frozen invalid fixture: ${fixture.name}`, () => {
      assert.equal(invalidCodes.has(fixture.name), true, `missing expected code for ${fixture.name}`);
      rejected(canonicalFrame(fixture.envelope), invalidCodes.get(fixture.name));
    });
  }
});

test('compatibility is evaluated before actionability, expiry, schema, and canonical-wire checks', () => {
  const incompatibleVersion = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS - 120_000, {
    version: 2,
    expiryTimeMs: LOCAL_RECEIPT_TIME_MS - 1,
    economicAssumptionContext: { expiresAtMs: LOCAL_RECEIPT_TIME_MS - 1 },
  });
  // Deliberately use insertion-order JSON: compatibility must win even though
  // this actionable-looking frame is expired and not canonical on the wire.
  const versionError = rejected(
    JSON.stringify(incompatibleVersion),
    'PROTOCOL_VERSION_UNSUPPORTED',
  );
  assert.equal(versionError.stage, 'decode:compatibility');

  const unknownSchema = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS - 120_000, {
    schema: 'EdgeAssessmentEnvelopeV2',
    expiryTimeMs: LOCAL_RECEIPT_TIME_MS - 1,
    economicAssumptionContext: { expiresAtMs: LOCAL_RECEIPT_TIME_MS - 1 },
  });
  const schemaError = rejected(canonicalFrame(unknownSchema), 'PROTOCOL_VERSION_UNSUPPORTED');
  assert.equal(schemaError.stage, 'decode:compatibility');
});

test('compatibility and pre-safety errors do not echo unvalidated schema or identity text', async (t) => {
  const privateSentinel = 'PRIVATE_SENTINEL_MUST_NEVER_ECHO_9C41';
  const cases = [
    {
      name: 'private sentinel schema',
      envelope: buildActionableAssessment(LOCAL_RECEIPT_TIME_MS, {
        schema: `EdgeAssessmentEnvelopeV2_${privateSentinel}`,
        assessmentId: privateSentinel,
        traceId: privateSentinel,
      }),
    },
    {
      name: 'bidi schema',
      envelope: buildActionableAssessment(LOCAL_RECEIPT_TIME_MS, {
        schema: 'EdgeAssessmentEnvelopeV2\u202eHIDDEN',
        assessmentId: 'hostile-id',
        traceId: 'hostile-trace',
      }),
    },
    {
      name: 'hostile ids on incompatible version',
      envelope: buildActionableAssessment(LOCAL_RECEIPT_TIME_MS, {
        version: 2,
        assessmentId: privateSentinel,
        traceId: 'bidi\u2066trace',
      }),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const error = rejected(canonicalFrame(fixture.envelope), 'PROTOCOL_VERSION_UNSUPPORTED');
      const serialized = JSON.stringify(error);
      assert.equal(error.stage, 'decode:compatibility');
      assert.equal(error.sourceEnvelopeSchema, null);
      assert.equal(error.sourceEnvelopeId, null);
      assert.equal(error.correlationId, null);
      assert.equal(serialized.includes(privateSentinel), false);
      assert.equal(serialized.includes('\u202e'), false);
      assert.equal(serialized.includes('\u2066'), false);
      assert.equal(serialized.includes('hostile-id'), false);
      assert.equal(serialized.includes('hostile-trace'), false);
    });
  }

  await t.test('schema-invalid hostile identity is not echoed before schema acceptance', () => {
    const schemaInvalid = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS, {
      assessmentId: privateSentinel,
      traceId: privateSentinel,
    });
    schemaInvalid.unregisteredField = 'forces-schema-rejection';
    const error = rejected(canonicalFrame(schemaInvalid), 'PROTOCOL_SCHEMA_INVALID');
    assert.equal(JSON.stringify(error).includes(privateSentinel), false);
    assert.equal(error.sourceEnvelopeSchema, null);
    assert.equal(error.sourceEnvelopeId, null);
    assert.equal(error.correlationId, null);
  });
});

test('local receipt time is bounded to the exact frozen UtcMillis range before decoding failures', () => {
  const belowFrozenMinimum = FROZEN_UTC_MILLIS_MINIMUM - 1;
  assert.throws(
    () => client.decode('{invalid-json', belowFrozenMinimum),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.match(error.message, /frozen UtcMillis range/);
      assert.equal(error.message.includes('programming error'), false);
      return true;
    },
  );
  assert.throws(
    () => client.decode('{invalid-json', FROZEN_UTC_MILLIS_MAXIMUM + 1),
    /frozen UtcMillis range/,
  );

  const minimumError = rejected(
    '{invalid-json',
    'PROTOCOL_JSON_INVALID',
    FROZEN_UTC_MILLIS_MINIMUM,
  );
  assert.equal(minimumError.occurredAtMs, FROZEN_UTC_MILLIS_MINIMUM);

  const maximumError = rejected(
    '{invalid-json',
    'PROTOCOL_JSON_INVALID',
    FROZEN_UTC_MILLIS_MAXIMUM,
  );
  assert.equal(maximumError.occurredAtMs, FROZEN_UTC_MILLIS_MAXIMUM);
});

test('a canonical schema-valid actionable assessment is accepted as detached protocol data', () => {
  const assessment = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS);
  const frame = canonicalFrame(assessment);
  const envelope = accepted(frame, LOCAL_RECEIPT_TIME_MS + 1);

  assert.equal(envelope.schema, 'EdgeAssessmentEnvelopeV1');
  assert.equal(envelope.version, 1);
  assert.equal(envelope.revision, 0);
  assert.equal(envelope.localReceiptTimeMs, LOCAL_RECEIPT_TIME_MS + 1);
  assert.equal(envelope.byteLength, encoder.encode(frame).byteLength);
  assert.equal(envelope.fingerprintSha256, createHash('sha256').update(frame).digest('hex'));
  assert.equal(envelope.value.advisoryAction, 'PROPOSE_CONSIDERATION');
  assert.equal(envelope.value.economicAssumptionContext.intendedSize, '10.00000000');
});

test('malformed JSON, invalid UTF-8, noncanonical frames, and duplicate keys fail closed', () => {
  rejected(
    '{"schema":"EdgeAssessmentEnvelopeV1","version":1,',
    'PROTOCOL_JSON_INVALID',
  );
  rejected(new Uint8Array([0xc3, 0x28]), 'PROTOCOL_UTF8_INVALID');

  const assessment = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS);
  rejected(JSON.stringify(assessment, null, 2), 'PROTOCOL_NON_CANONICAL_FRAME');

  const canonical = canonicalFrame(assessment);
  const duplicateSchemaKey = `{"schema":"EdgeAssessmentEnvelopeV1",${canonical.slice(1)}`;
  rejected(duplicateSchemaKey, 'PROTOCOL_NON_CANONICAL_FRAME');

  // A failed fatal decode must not contaminate the next independent frame.
  accepted(canonical);
});

test('a UTF-8 BOM cannot be consumed into an apparently canonical frame', () => {
  const canonical = canonicalFrame(buildActionableAssessment(LOCAL_RECEIPT_TIME_MS));
  const body = encoder.encode(canonical);
  const bomPrefixed = new Uint8Array(body.byteLength + 3);
  bomPrefixed.set([0xef, 0xbb, 0xbf]);
  bomPrefixed.set(body, 3);

  const error = rejected(bomPrefixed, 'PROTOCOL_JSON_INVALID');
  assert.equal(error.stage, 'decode:json');

  // The failed decode must not affect an independent canonical byte frame.
  const envelope = accepted(body);
  assert.equal(envelope.byteLength, body.byteLength);
  assert.equal(envelope.canonicalJson, canonical);
});

test('actual numeric money is rejected where the frozen schema requires an exact decimal string', () => {
  const numericMoney = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS);
  numericMoney.economicAssumptionContext.intendedSize = 10;
  rejected(canonicalFrame(numericMoney), 'PROTOCOL_SCHEMA_INVALID');
});

test('frozen schema array maxima accept the exact boundary and reject the next item', () => {
  const exactMaximum = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS, {
    abstentionReasonCodes: Array.from({ length: 64 }, (_, index) => `BOUNDARY_${index}`),
  });
  accepted(canonicalFrame(exactMaximum));

  const overMaximum = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS, {
    abstentionReasonCodes: Array.from({ length: 65 }, (_, index) => `BOUNDARY_${index}`),
  });
  rejected(canonicalFrame(overMaximum), 'PROTOCOL_SCHEMA_INVALID');
});

test('own constructor, __proto__, and toString keys cannot bypass closed-object validation', async (t) => {
  for (const key of ['constructor', '__proto__', 'toString']) {
    await t.test(key, () => {
      const assessment = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS);
      addOwnDataProperty(assessment, key, { injected: true });

      const validationIssues = schemaRuntime.validateEnvelope(assessment);
      assert.equal(
        validationIssues.some((issue) => issue.code === 'ADDITIONAL_PROPERTY' && issue.path === `$.${key}`),
        true,
        `${key} must be treated as an own additional property`,
      );

      const expectedClientCode = key === 'toString'
        ? 'PROTOCOL_SCHEMA_INVALID'
        : 'PROTOCOL_DANGEROUS_KEY';
      rejected(canonicalFrame(assessment), expectedClientCode);
    });
  }
});

test('designated open schema bags accept bounded benign extension data', async (t) => {
  const cases = [
    {
      name: 'market evidence payload',
      envelope: cloneFrozenFixture('evidence-trade-live').envelope,
      apply(value) {
        value.payload.adapterObservation = { region: 'test-region-1', samples: [1, 2, 3] };
      },
    },
    {
      name: 'assessment capacity evidence',
      envelope: buildActionableAssessment(LOCAL_RECEIPT_TIME_MS),
      apply(value) {
        value.capacityEvidence.adapterObservation = { bookLevels: 20, state: 'COMPLETE' };
      },
    },
    {
      name: 'feedback projection',
      envelope: cloneFrozenFixture('feedback-dedup').envelope,
      apply(value) {
        value.projection.adapterObservation = { disposition: 'OBSERVED_ONLY' };
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      fixture.apply(fixture.envelope);
      accepted(canonicalFrame(fixture.envelope));
    });
  }
});

test('forbidden authority and secret-like keys are rejected recursively through open bags and arrays', async (t) => {
  const forbiddenKeys = [
    'signature',
    'api_key',
    'apiSecret',
    'secret',
    'passphrase',
    'password',
    'privateKey',
    'listenKey',
    'credential',
    'approvedCapital',
    'orderRequest',
    'leverageMutation',
    'liveSendPermission',
  ];

  for (const key of forbiddenKeys) {
    await t.test(key, () => {
      const evidence = cloneFrozenFixture('evidence-trade-live').envelope;
      const leaf = addOwnDataProperty({}, key, 'must-not-be-retained');
      evidence.payload = { safeOuter: [{ safeMiddle: { safeInner: leaf } }] };
      rejected(canonicalFrame(evidence), 'PROTOCOL_FORBIDDEN_CONTENT');
    });
  }
});

test('rejection errors never echo a private sentinel or the raw rejected frame', () => {
  const privateSentinel = 'PRIVATE_SENTINEL_MUST_NEVER_ECHO_7F2A';
  const evidence = cloneFrozenFixture('evidence-trade-live').envelope;
  evidence.payload = { safeOuter: [{ apiSecret: privateSentinel }] };
  const frame = canonicalFrame(evidence);
  const error = rejected(frame, 'PROTOCOL_FORBIDDEN_CONTENT');
  const serialized = JSON.stringify(error);

  assert.equal(serialized.includes(privateSentinel), false);
  assert.equal(serialized.includes('apiSecret'), false);
  assert.equal(serialized.includes(frame), false);
  assert.equal(error.message, 'edge protocol frame was rejected safely');
});

test('schema-valid noncanonical rejection never reflects private-sentinel identities', () => {
  const privateSentinel = 'PRIVATE_SENTINEL_MUST_NEVER_ECHO_54B7';
  const assessment = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS, {
    assessmentId: privateSentinel,
    traceId: privateSentinel,
  });
  const frame = JSON.stringify(assessment, null, 2);
  assert.equal(schemaRuntime.validateEnvelope(assessment).length, 0, 'fixture must be schema-valid');

  const error = rejected(frame, 'PROTOCOL_NON_CANONICAL_FRAME');
  const serialized = JSON.stringify(error);
  assert.equal(error.stage, 'decode:canonical-wire');
  assert.equal(error.sourceEnvelopeSchema, null);
  assert.equal(error.sourceEnvelopeId, null);
  assert.equal(error.correlationId, null);
  assert.equal(serialized.includes(privateSentinel), false);
  assert.equal(serialized.includes(frame), false);
});

test('unsafe control, bidi, and unpaired-surrogate text is rejected recursively while scalar text is accepted', async (t) => {
  const unsafeValues = new Map([
    ['lone high surrogate', '\ud800'],
    ['lone low surrogate', '\udfff'],
    ['NUL control', 'embedded\u0000nul'],
    ['bidi override', 'bidi\u202eoverride'],
  ]);
  for (const [name, unsafeText] of unsafeValues) {
    await t.test(name, () => {
      const assessment = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS);
      assessment.capacityEvidence.adapterObservation = { nested: ['safe', { unsafeText }] };
      rejected(canonicalFrame(assessment), 'PROTOCOL_UNSAFE_TEXT');
    });
  }

  await t.test('bidi control in an open-bag key', () => {
    const unsafeKey = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS);
    addOwnDataProperty(unsafeKey.capacityEvidence, 'bidi\u2066key', 'value');
    rejected(canonicalFrame(unsafeKey), 'PROTOCOL_UNSAFE_TEXT');
  });

  await t.test('valid scalar pair', () => {
    const scalarText = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS);
    scalarText.capacityEvidence.adapterObservation = { text: 'valid scalar text 🧪' };
    accepted(canonicalFrame(scalarText));
  });
});

test('the exact raw UTF-8 frame ceiling is accepted and the next byte is rejected before parsing', () => {
  const evidence = cloneFrozenFixture('evidence-trade-live').envelope;
  evidence.payload.utf8Marker = '🧪';
  evidence.payload.padding = '';
  const emptyPaddingFrame = canonicalFrame(evidence);
  const paddingBytes = EDGE_PROTOCOL_V1_MAX_FRAME_BYTES - encoder.encode(emptyPaddingFrame).byteLength;
  assert.equal(paddingBytes > 0, true);

  evidence.payload.padding = 'x'.repeat(paddingBytes);
  const exactFrame = canonicalFrame(evidence);
  assert.equal(encoder.encode(exactFrame).byteLength, EDGE_PROTOCOL_V1_MAX_FRAME_BYTES);
  assert.equal(exactFrame.length < EDGE_PROTOCOL_V1_MAX_FRAME_BYTES, true, 'the ceiling must be UTF-8 bytes');
  const exactEnvelope = accepted(exactFrame);
  assert.equal(exactEnvelope.byteLength, EDGE_PROTOCOL_V1_MAX_FRAME_BYTES);

  evidence.payload.padding += 'x';
  const overFrame = canonicalFrame(evidence);
  assert.equal(encoder.encode(overFrame).byteLength, EDGE_PROTOCOL_V1_MAX_FRAME_BYTES + 1);
  const error = rejected(overFrame, 'PROTOCOL_FRAME_TOO_LARGE');
  assert.equal(error.stage, 'decode:size');
});

test('unsafe integers are rejected recursively even inside a designated open bag', () => {
  const evidence = cloneFrozenFixture('evidence-trade-live').envelope;
  evidence.payload.adapterSequence = Number.MAX_SAFE_INTEGER + 1;
  rejected(canonicalFrame(evidence), 'PROTOCOL_SCHEMA_INVALID');
});

test('accepted input is detached and deeply frozen before retention', () => {
  const draft = buildActionableAssessment(LOCAL_RECEIPT_TIME_MS);
  const frame = canonicalFrame(draft);
  const bytes = encoder.encode(frame);
  const envelope = accepted(bytes);

  assert.notEqual(envelope.value, draft);
  assert.notEqual(envelope.value.instrumentGraph, draft.instrumentGraph);
  assert.notEqual(envelope.value.parentEvidenceIds, draft.parentEvidenceIds);
  assertDeeplyFrozen(envelope.value);
  assert.equal(Object.isFrozen(envelope), true);

  draft.instrumentGraph.symbol = 'MUTATEDUSDT';
  draft.parentEvidenceIds.push('ev_mutated');
  bytes.fill(0);
  assert.equal(envelope.value.instrumentGraph.symbol, 'BTCUSDT');
  assert.deepEqual(envelope.value.parentEvidenceIds, ['ev_l01_spot_0001', 'ev_l01_perp_0001']);
  assert.equal(envelope.canonicalJson, frame);

  assert.throws(() => {
    envelope.value.instrumentGraph.symbol = 'MUTATION_REJECTED';
  }, TypeError);
  assert.throws(() => {
    envelope.value.parentEvidenceIds.push('ev_mutation_rejected');
  }, TypeError);
});
