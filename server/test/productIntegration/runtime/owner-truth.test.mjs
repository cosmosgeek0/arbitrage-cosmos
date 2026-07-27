import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA,
  buildProductRuntimeSupervisorEnvelope,
  createProductIntegrationRuntime,
  projectProductMaterialEventPage,
  projectProductRuntimeOwnerTruthBinding,
  productRuntimeSurfaceReadinessBlocker,
} from '../../../dist/productIntegration/runtime/index.js';
import {
  T0,
  makeOpsInterlock,
  makeOpsReadback,
  makeRead,
  makeSupervisor,
} from './testSupport.mjs';

const OPS_PROJECTION = Object.freeze({
  applicationStartOk: true,
  opsReadback: makeOpsReadback(),
  opsIntakeInterlock: makeOpsInterlock(),
});

const SURFACE_BLOCKING_TRUTH = new Set(['BLOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN']);

/**
 * The rows of the three owner-truth surfaces that no canonical System
 * Integration owner publishes. `owner rows are exactly the null rows` below
 * pins this list against the live projection, so a future canonical owner for
 * any of these fields fails loudly instead of being silently shadowed.
 */
const OWNER_ROWS = Object.freeze({
  dashboard: Object.freeze(['pnl-drawdown', 'pipeline-counts', 'active-objects', 'strategy-q']),
  account: Object.freeze([
    'spot-truth', 'usdm-truth', 'margin-truth', 'balances-equity-collateral',
    'available-capital', 'permissions-modes', 'orders-positions',
    'liabilities-interest', 'freshness-completeness', 'reconciliation', 'foreign-manual',
  ]),
  markets: Object.freeze([
    'basis', 'wake-up', 'flow', 'liquidity', 'derivatives', 'data-quality',
    'candidate-focus', 'source-freshness', 'q-assessment',
  ]),
});

const LEGACY_NULL_ROWS = Object.freeze({
  dashboard: OWNER_ROWS.dashboard,
  account: Object.freeze(OWNER_ROWS.account.filter(
    (fieldId) => !['freshness-completeness', 'reconciliation'].includes(fieldId),
  )),
  markets: Object.freeze(OWNER_ROWS.markets.filter((fieldId) => fieldId !== 'source-freshness')),
});

const CANONICAL_ACCOUNT_TRUTH_STATE = makeSupervisor().summaries.capital.accountTruthState;
const CANONICAL_ACCOUNT_CUT_IDENTITY = [
  makeSupervisor().revision,
  makeSupervisor().runtimeGeneration,
  makeSupervisor().controlGeneration,
  makeSupervisor().evaluatedAtMs,
].join(':');

function materialPage() {
  return projectProductMaterialEventPage('0', 10, makeRead().events({ afterCursor: '0', limit: 10 }));
}

function ownerRow(fieldId, value, source = 'fixture.owner') {
  return Object.freeze({
    fieldId,
    source,
    state: 'AVAILABLE',
    value,
    truthLabel: 'WIRED',
    unavailableReason: null,
  });
}

function unavailableOwnerRow(fieldId, unavailableReason, source = 'fixture.owner') {
  return Object.freeze({
    fieldId,
    source,
    state: 'UNAVAILABLE',
    value: null,
    truthLabel: 'NOT_CONFIGURED',
    unavailableReason,
  });
}

function availableSurfaceCut(surfaceId, overrides = {}) {
  return Object.freeze({
    surfaceId,
    source: surfaceId === 'account'
      ? 'services.privateRead'
      : surfaceId === 'markets'
        ? 'intelligenceRuntime.marketSources'
        : 'systemIntegration.supervisor',
    state: 'AVAILABLE',
    observedAtMs: T0 - 1_000,
    maxAgeMs: 30_000,
    truthLabel: 'WIRED',
    unavailableReason: null,
    supersedesCanonicalAccountTruthState: surfaceId === 'account' ? CANONICAL_ACCOUNT_TRUTH_STATE : null,
    supersedesCanonicalAccountCutIdentity: surfaceId === 'account'
      ? CANONICAL_ACCOUNT_CUT_IDENTITY
      : null,
    fields: Object.freeze((OWNER_ROWS[surfaceId] ?? []).map(
      (fieldId) => ownerRow(fieldId, `${surfaceId} ${fieldId} owner value`),
    )),
    ...overrides,
  });
}

function unavailableSurfaceCut(surfaceId, unavailableReason, truthLabel = 'NOT_CONFIGURED') {
  return Object.freeze({
    surfaceId,
    source: surfaceId === 'account'
      ? 'services.privateRead'
      : surfaceId === 'markets'
        ? 'intelligenceRuntime.marketSources'
        : 'systemIntegration.supervisor',
    state: 'UNAVAILABLE',
    observedAtMs: T0 - 1_000,
    maxAgeMs: 30_000,
    truthLabel,
    unavailableReason,
    supersedesCanonicalAccountTruthState: null,
    supersedesCanonicalAccountCutIdentity: null,
    fields: Object.freeze([]),
  });
}

function makeCut(surfaces = ['dashboard', 'account', 'markets'].map((id) => availableSurfaceCut(id)), overrides = {}) {
  return Object.freeze({
    schemaVersion: PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA,
    source: 'server.ownerTruth',
    observedAtMs: T0 - 1_000,
    surfaces: Object.freeze(surfaces),
    ...overrides,
  });
}

function envelopeWith(input = {}) {
  return buildProductRuntimeSupervisorEnvelope({
    ...OPS_PROJECTION,
    snapshot: makeSupervisor(),
    materialEvents: materialPage(),
    traces: [],
    nowMs: T0,
    ...input,
  });
}

function rows(envelope, surfaceId) {
  return Object.fromEntries(envelope.surfaces[surfaceId].evidence.map((datum) => [datum.fieldId, datum]));
}

/** The revision an unwired product runtime publishes for this fixture. */
const CANONICAL_REVISION = envelopeWith().revision;

test('an unwired product runtime retains the legacy null rows and canonical revision', () => {
  const envelope = envelopeWith();
  for (const surfaceId of ['dashboard', 'account', 'markets']) {
    const nullRows = envelope.surfaces[surfaceId].evidence
      .filter((datum) => datum.value === null)
      .map((datum) => datum.fieldId);
    assert.deepEqual(
      nullRows,
      [...LEGACY_NULL_ROWS[surfaceId]],
      `${surfaceId} legacy null-row inventory drifted from the canonical supervisor`,
    );
    for (const fieldId of LEGACY_NULL_ROWS[surfaceId]) {
      const datum = rows(envelope, surfaceId)[fieldId];
      assert.equal(datum.unavailableReason, 'CANONICAL_OWNER_FIELD_NOT_CONFIGURED');
      assert.equal(datum.truthLabel, 'MISSING');
    }
    assert.equal(envelope.surfaces[surfaceId].bindingState, 'BLOCKED_BACKEND');
  }
  assert.equal(
    envelope.revision.includes('-owner-'),
    false,
    'an unwired owner-truth port leaves the canonical revision byte-identical',
  );
  assert.match(envelope.revision, /^system-[0-9]+-runtime-[0-9]+-control-[0-9]+-incident-[a-z_]+-[0-9]+-[0-9]+$/);
  assert.equal(projectProductRuntimeOwnerTruthBinding(null, null, T0), null);
});

test('an available cut binds every required dashboard, account, and markets row', () => {
  const envelope = envelopeWith({ ownerTruthCut: makeCut(), ownerTruthUnavailableReason: null });
  for (const surfaceId of ['dashboard', 'account', 'markets']) {
    const surface = envelope.surfaces[surfaceId];
    for (const datum of surface.evidence) {
      assert.notEqual(datum.value, null, `${surfaceId}:${datum.fieldId} must carry owner evidence`);
      assert.equal(datum.unavailableReason, null);
      assert.ok(
        !SURFACE_BLOCKING_TRUTH.has(datum.truthLabel),
        `${surfaceId}:${datum.fieldId} must not stay blocking with a bound cut`,
      );
    }
    assert.equal(productRuntimeSurfaceReadinessBlocker(surfaceId, surface.evidence), null);
    assert.equal(surface.bindingState, 'BINDING_READY', `${surfaceId} binds from the owner cut`);
    assert.ok(!SURFACE_BLOCKING_TRUTH.has(surface.truthLabel));
    assert.equal(surface.summary, `${surface.label} projects canonical owner evidence only.`);
    for (const fieldId of OWNER_ROWS[surfaceId]) {
      const datum = rows(envelope, surfaceId)[fieldId];
      assert.equal(datum.value, `${surfaceId} ${fieldId} owner value`);
      assert.equal(datum.truthLabel, 'WIRED');
      assert.equal(datum.canonicalSource, `productIntegration.owner-truth:fixture.owner:${fieldId}`);
    }
  }
  assert.match(envelope.revision, new RegExp(`^${CANONICAL_REVISION}-owner-[a-f0-9]{64}$`));
  assert.ok(envelope.revision.length <= 256, 'the delivery contract bounds revision at 256 characters');

  const canonical = envelopeWith();
  assert.deepEqual(
    envelope.surfaces['control-room'],
    canonical.surfaces['control-room'],
    'a cut never reaches a surface outside the three owner surfaces',
  );
  assert.deepEqual(envelope.surfaces.borrow, canonical.surfaces.borrow);
  assert.deepEqual(envelope.dashboard, canonical.dashboard);
  assert.deepEqual(envelope.components, canonical.components);
});

test('owner evidence content changes the revision even at the same observation time', () => {
  const first = envelopeWith({ ownerTruthCut: makeCut(), ownerTruthUnavailableReason: null });
  const changedAccount = availableSurfaceCut('account', {
    fields: Object.freeze(OWNER_ROWS.account.map((fieldId) => (
      ownerRow(fieldId, fieldId === 'spot-truth' ? 'CHANGED_SPOT_OWNER_VALUE' : `account ${fieldId} owner value`)
    ))),
  });
  const second = envelopeWith({
    ownerTruthCut: makeCut([
      availableSurfaceCut('dashboard'),
      changedAccount,
      availableSurfaceCut('markets'),
    ]),
    ownerTruthUnavailableReason: null,
  });
  assert.notEqual(first.revision, second.revision);

  const keyless = envelopeWith({
    ownerTruthCut: makeCut([
      availableSurfaceCut('dashboard'),
      unavailableSurfaceCut('account', 'PRIVATE_ACCOUNT_CREDENTIALS_NOT_CONFIGURED'),
      availableSurfaceCut('markets'),
    ]),
    ownerTruthUnavailableReason: null,
  });
  const unreadable = envelopeWith({
    ownerTruthCut: makeCut([
      availableSurfaceCut('dashboard'),
      unavailableSurfaceCut('account', 'PRIVATE_ACCOUNT_READ_UNAVAILABLE', 'UNAVAILABLE'),
      availableSurfaceCut('markets'),
    ]),
    ownerTruthUnavailableReason: null,
  });
  assert.notEqual(keyless.revision, unreadable.revision);
});

test('an available cut still fails a row closed when its own owner has no evidence', () => {
  const account = availableSurfaceCut('account', {
    fields: Object.freeze(OWNER_ROWS.account.map((fieldId) => (fieldId === 'margin-truth'
      ? unavailableOwnerRow(fieldId, 'MARGIN_ACCOUNT_NOT_ENABLED')
      : ownerRow(fieldId, `account ${fieldId} owner value`)))),
  });
  const envelope = envelopeWith({
    ownerTruthCut: makeCut([availableSurfaceCut('dashboard'), account, availableSurfaceCut('markets')]),
    ownerTruthUnavailableReason: null,
  });
  const margin = rows(envelope, 'account')['margin-truth'];
  assert.equal(margin.value, null);
  assert.equal(margin.truthLabel, 'NOT_CONFIGURED');
  assert.equal(margin.unavailableReason, 'MARGIN_ACCOUNT_NOT_ENABLED');
  assert.equal(rows(envelope, 'account')['spot-truth'].value, 'account spot-truth owner value');
  assert.equal(envelope.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(envelope.surfaces.account.blocker, 'REQUIRED_EVIDENCE_NOT_CONFIGURED:margin-truth');
  assert.equal(envelope.surfaces.markets.bindingState, 'BINDING_READY');
});

test('a keyless account cut stays explicit and non-green beside available markets truth', () => {
  const envelope = envelopeWith({
    ownerTruthCut: makeCut([
      availableSurfaceCut('dashboard'),
      unavailableSurfaceCut('account', 'PRIVATE_ACCOUNT_CREDENTIALS_NOT_CONFIGURED'),
      availableSurfaceCut('markets'),
    ]),
    ownerTruthUnavailableReason: null,
  });
  for (const fieldId of OWNER_ROWS.account) {
    const datum = rows(envelope, 'account')[fieldId];
    assert.equal(datum.value, null, `${fieldId} must never be fabricated without a key`);
    assert.equal(datum.truthLabel, 'NOT_CONFIGURED');
    assert.equal(datum.unavailableReason, 'PRIVATE_ACCOUNT_CREDENTIALS_NOT_CONFIGURED');
    assert.equal(
      datum.canonicalSource,
      `productIntegration.owner-truth:services.privateRead:${fieldId}`,
    );
  }
  assert.equal(envelope.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.ok(SURFACE_BLOCKING_TRUTH.has(envelope.surfaces.account.truthLabel));
  assert.equal(envelope.surfaces.account.blocker, 'REQUIRED_EVIDENCE_NOT_CONFIGURED:spot-truth');
  assert.equal(envelope.surfaces.markets.bindingState, 'BINDING_READY');
  assert.equal(envelope.surfaces.dashboard.bindingState, 'BINDING_READY');
  assert.match(envelope.revision, new RegExp(`^${CANONICAL_REVISION}-owner-[a-f0-9]{64}$`));
});

test('an omitted, stale, or unreadable owner names its exact reason on every row', () => {
  const omitted = envelopeWith({
    ownerTruthCut: makeCut([availableSurfaceCut('dashboard'), availableSurfaceCut('markets')]),
    ownerTruthUnavailableReason: null,
  });
  for (const fieldId of OWNER_ROWS.account) {
    const datum = rows(omitted, 'account')[fieldId];
    assert.equal(datum.value, null);
    assert.equal(datum.truthLabel, 'NOT_CONFIGURED');
    assert.equal(datum.unavailableReason, 'OWNER_TRUTH_SURFACE_NOT_SUPPLIED');
  }
  assert.equal(omitted.surfaces.markets.bindingState, 'BINDING_READY');

  const stale = envelopeWith({
    ownerTruthCut: makeCut([
      availableSurfaceCut('dashboard'),
      availableSurfaceCut('account', { observedAtMs: T0 - 31_000, maxAgeMs: 30_000 }),
      availableSurfaceCut('markets'),
    ], { observedAtMs: T0 - 1_000 }),
    ownerTruthUnavailableReason: null,
  });
  for (const fieldId of OWNER_ROWS.account) {
    const datum = rows(stale, 'account')[fieldId];
    assert.equal(datum.value, null, `${fieldId} must not render an aged account cut`);
    assert.equal(datum.truthLabel, 'UNAVAILABLE');
    assert.equal(datum.unavailableReason, 'OWNER_TRUTH_CUT_STALE');
  }
  assert.equal(stale.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(stale.surfaces.dashboard.bindingState, 'BINDING_READY');

  const boundary = envelopeWith({
    ownerTruthCut: makeCut([availableSurfaceCut('account', { observedAtMs: T0 - 30_000, maxAgeMs: 30_000 })]),
    ownerTruthUnavailableReason: null,
  });
  assert.equal(
    rows(boundary, 'account')['spot-truth'].value,
    'account spot-truth owner value',
    'a cut exactly at its own bound is still fresh',
  );

  for (const [reason, truthLabel] of [
    ['OWNER_TRUTH_CUT_NOT_CONFIGURED', 'NOT_CONFIGURED'],
    ['OWNER_TRUTH_OWNER_UNAVAILABLE', 'UNAVAILABLE'],
  ]) {
    const envelope = envelopeWith({ ownerTruthCut: null, ownerTruthUnavailableReason: reason });
    for (const surfaceId of ['dashboard', 'account', 'markets']) {
      for (const fieldId of OWNER_ROWS[surfaceId]) {
        const datum = rows(envelope, surfaceId)[fieldId];
        assert.equal(datum.value, null);
        assert.equal(datum.truthLabel, truthLabel);
        assert.equal(datum.unavailableReason, reason);
        assert.equal(datum.canonicalSource, `productIntegration.owner-truth:${fieldId}`);
      }
      assert.equal(envelope.surfaces[surfaceId].bindingState, 'BLOCKED_BACKEND');
    }
    assert.match(envelope.revision, new RegExp(`^${CANONICAL_REVISION}-owner-[a-f0-9]{64}$`));
  }
});

test('a malformed cut is rejected whole and binds nothing anywhere', () => {
  const full = makeCut().surfaces;
  const mutations = Object.freeze({
    UNKNOWN_SCHEMA: makeCut(full, { schemaVersion: 'product-owner-truth.v2' }),
    UNKNOWN_CUT_KEY: Object.freeze({ ...makeCut(), extra: 'value' }),
    MISSING_CUT_KEY: Object.freeze({
      schemaVersion: PRODUCT_RUNTIME_OWNER_TRUTH_SCHEMA,
      source: 'server.ownerTruth',
      surfaces: full,
    }),
    FUTURE_CUT: makeCut(full, { observedAtMs: T0 + 1 }),
    NON_ARRAY_SURFACES: makeCut(null),
    UNKNOWN_SURFACE: makeCut([availableSurfaceCut('dashboard'), availableSurfaceCut('borrow')]),
    DUPLICATE_SURFACE: makeCut([availableSurfaceCut('account'), availableSurfaceCut('account')]),
    SURFACE_NEWER_THAN_CUT: makeCut([availableSurfaceCut('account', { observedAtMs: T0 - 999 })]),
    MAX_AGE_ZERO: makeCut([availableSurfaceCut('account', { maxAgeMs: 0 })]),
    MAX_AGE_ABOVE_CEILING: makeCut([availableSurfaceCut('account', { maxAgeMs: 86_400_001 })]),
    INVALID_SURFACE_SOURCE: makeCut([availableSurfaceCut('account', { source: 'private read' })]),
    SYNTHETIC_SURFACE_LABEL: makeCut([availableSurfaceCut('account', { truthLabel: 'SYNTHETIC_ONLY' })]),
    UNAVAILABLE_WITH_FIELDS: makeCut([Object.freeze({
      ...unavailableSurfaceCut('account', 'PRIVATE_ACCOUNT_CREDENTIALS_NOT_CONFIGURED'),
      fields: availableSurfaceCut('account').fields,
    })]),
    UNAVAILABLE_WITHOUT_REASON: makeCut([Object.freeze({
      ...unavailableSurfaceCut('account', 'PRIVATE_ACCOUNT_CREDENTIALS_NOT_CONFIGURED'),
      unavailableReason: null,
    })]),
    LOWERCASE_REASON_CODE: makeCut([unavailableSurfaceCut('account', 'private_account_not_configured')]),
    SUPERSESSION_OUTSIDE_ACCOUNT: makeCut([availableSurfaceCut('markets', {
      supersedesCanonicalAccountTruthState: CANONICAL_ACCOUNT_TRUTH_STATE,
      supersedesCanonicalAccountCutIdentity: CANONICAL_ACCOUNT_CUT_IDENTITY,
    })]),
    SUPERSESSION_CUT_IDENTITY_MISSING: makeCut([availableSurfaceCut('account', {
      supersedesCanonicalAccountCutIdentity: null,
    })]),
    SUPERSESSION_STATE_MISSING: makeCut([availableSurfaceCut('account', {
      supersedesCanonicalAccountTruthState: null,
    })]),
    SUPERSESSION_CUT_IDENTITY_INVALID: makeCut([availableSurfaceCut('account', {
      supersedesCanonicalAccountCutIdentity: 'revision-one',
    })]),
    MISSING_ROW: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(availableSurfaceCut('account').fields.slice(1)),
    })]),
    UNKNOWN_ROW: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze([...availableSurfaceCut('account').fields.slice(1), ownerRow('not-a-field', 'x')]),
    })]),
    DUPLICATE_ROW: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze([
        ...availableSurfaceCut('account').fields.slice(0, OWNER_ROWS.account.length - 1),
        ownerRow('spot-truth', 'x'),
      ]),
    })]),
    SYNTHETIC_ROW_LABEL: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(OWNER_ROWS.account.map((fieldId) => Object.freeze({
        ...ownerRow(fieldId, 'x'), truthLabel: 'SYNTHETIC_ONLY',
      }))),
    })]),
    ROW_VALUE_AND_REASON: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(OWNER_ROWS.account.map((fieldId) => Object.freeze({
        ...ownerRow(fieldId, 'x'), unavailableReason: 'SPOT_TRUTH_UNAVAILABLE',
      }))),
    })]),
    ROW_UNAVAILABLE_WITH_VALUE: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(OWNER_ROWS.account.map((fieldId) => Object.freeze({
        ...unavailableOwnerRow(fieldId, 'SPOT_TRUTH_UNAVAILABLE'), value: 'x',
      }))),
    })]),
    ROW_CONTROL_CHARACTER: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(OWNER_ROWS.account.map(
        (fieldId) => ownerRow(fieldId, `spot${String.fromCharCode(10)}truth`),
      )),
    })]),
    ROW_EMPTY_VALUE: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(OWNER_ROWS.account.map((fieldId) => ownerRow(fieldId, ''))),
    })]),
    ROW_INVALID_SOURCE: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(OWNER_ROWS.account.map(
        (fieldId) => ownerRow(fieldId, 'x', 'private read'),
      )),
    })]),
    ROW_OVERSIZED_VALUE: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(OWNER_ROWS.account.map((fieldId) => ownerRow(fieldId, 'x'.repeat(241)))),
    })]),
    UNKNOWN_ROW_KEY: makeCut([availableSurfaceCut('account', {
      fields: Object.freeze(OWNER_ROWS.account.map(
        (fieldId) => Object.freeze({ ...ownerRow(fieldId, 'x'), extra: 1 }),
      )),
    })]),
  });

  for (const [name, cut] of Object.entries(mutations)) {
    const envelope = envelopeWith({ ownerTruthCut: cut, ownerTruthUnavailableReason: null });
    for (const surfaceId of ['dashboard', 'account', 'markets']) {
      for (const fieldId of OWNER_ROWS[surfaceId]) {
        const datum = rows(envelope, surfaceId)[fieldId];
        assert.equal(datum.value, null, `${name} must not bind ${surfaceId}:${fieldId}`);
        assert.equal(datum.truthLabel, 'UNAVAILABLE', `${name} must fail ${surfaceId} closed`);
        assert.equal(datum.unavailableReason, 'OWNER_TRUTH_CUT_MALFORMED');
      }
      assert.equal(envelope.surfaces[surfaceId].bindingState, 'BLOCKED_BACKEND');
    }
    assert.match(
      envelope.revision,
      new RegExp(`^${CANONICAL_REVISION}-owner-[a-f0-9]{64}$`),
      `${name} must publish only a bounded unavailable revision`,
    );
  }

  const wellFormed = projectProductRuntimeOwnerTruthBinding(makeCut(), null, T0);
  assert.equal(wellFormed.surfaces.account.state, 'AVAILABLE');
  assert.equal(
    projectProductRuntimeOwnerTruthBinding(makeCut(), null, Number.NaN).surfaces.account.fields['spot-truth']
      .unavailableReason,
    'OWNER_TRUTH_CUT_MALFORMED',
    'an invalid injected clock can never bind owner truth',
  );
});

test('account truth is raised only while the exact canonical account cut still holds', () => {
  const bound = envelopeWith({ ownerTruthCut: makeCut(), ownerTruthUnavailableReason: null });
  assert.equal(bound.surfaces.account.truthLabel, 'WIRED');
  assert.equal(bound.surfaces.account.bindingState, 'BINDING_READY');
  assert.equal(
    bound.surfaces.borrow.truthLabel,
    'NOT_CONFIGURED',
    'the account cut never reaches the separately owned borrow surface',
  );

  const moved = buildProductRuntimeSupervisorEnvelope({
    ...OPS_PROJECTION,
    snapshot: makeSupervisor({
      summaries: Object.freeze({
        ...makeSupervisor().summaries,
        capital: Object.freeze({
          ...makeSupervisor().summaries.capital,
          accountTruthState: 'RESTART_TRUTH_READY',
        }),
      }),
    }),
    materialEvents: materialPage(),
    traces: [],
    nowMs: T0,
    ownerTruthCut: makeCut(),
    ownerTruthUnavailableReason: null,
  });
  assert.equal(
    rows(moved, 'account')['spot-truth'].value,
    'account spot-truth owner value',
    'owner rows keep their evidence when the canonical account state moves',
  );
  assert.ok(
    SURFACE_BLOCKING_TRUTH.has(moved.surfaces.account.truthLabel),
    'a superseded account state that no longer matches fails the surface closed',
  );
  assert.equal(moved.surfaces.account.bindingState, 'BLOCKED_BACKEND');

  const movedRevision = buildProductRuntimeSupervisorEnvelope({
    ...OPS_PROJECTION,
    snapshot: makeSupervisor({ revision: makeSupervisor().revision + 1 }),
    materialEvents: materialPage(),
    traces: [],
    nowMs: T0,
    ownerTruthCut: makeCut(),
    ownerTruthUnavailableReason: null,
  });
  assert.equal(
    rows(movedRevision, 'account')['spot-truth'].value,
    'account spot-truth owner value',
    'the historical row stays visible while its stale supersession cannot raise the surface',
  );
  assert.equal(
    movedRevision.surfaces.account.bindingState,
    'BLOCKED_BACKEND',
    'an unchanged state label on a newer supervisor revision cannot accept the stale cut',
  );

  const movedEvaluation = buildProductRuntimeSupervisorEnvelope({
    ...OPS_PROJECTION,
    snapshot: makeSupervisor({ evaluatedAtMs: makeSupervisor().evaluatedAtMs + 1 }),
    materialEvents: materialPage(),
    traces: [],
    nowMs: T0,
    ownerTruthCut: makeCut(),
    ownerTruthUnavailableReason: null,
  });
  assert.equal(
    movedEvaluation.surfaces.account.bindingState,
    'BLOCKED_BACKEND',
    'same counters on a different evaluated supervisor cut cannot accept stale Account evidence',
  );

  const noSupersession = envelopeWith({
    ownerTruthCut: makeCut([
      availableSurfaceCut('dashboard'),
      availableSurfaceCut('account', {
        supersedesCanonicalAccountTruthState: null,
        supersedesCanonicalAccountCutIdentity: null,
      }),
      availableSurfaceCut('markets'),
    ]),
    ownerTruthUnavailableReason: null,
  });
  assert.equal(rows(noSupersession, 'account')['spot-truth'].value, 'account spot-truth owner value');
  assert.equal(noSupersession.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(noSupersession.surfaces.markets.bindingState, 'BINDING_READY');
});

test('one immutable cut is read exactly once and binds all three surfaces', async () => {
  let reads = 0;
  const service = createProductIntegrationRuntime({
    read: Object.freeze({
      ...makeRead(),
      ownerTruth: () => {
        reads += 1;
        // A second read would be a different cut. The envelope must never mix
        // one account observation with another market observation.
        return reads === 1
          ? makeCut()
          : makeCut(['dashboard', 'account', 'markets'].map((surfaceId) => availableSurfaceCut(surfaceId, {
            fields: Object.freeze(OWNER_ROWS[surfaceId].map((fieldId) => ownerRow(fieldId, 'LATER_CUT'))),
          })));
      },
    }),
    clock: { nowMs: () => T0 },
  });
  const envelope = await service.readSupervisor();
  assert.equal(reads, 1, 'exactly one owner-truth read per envelope');
  for (const surfaceId of ['dashboard', 'account', 'markets']) {
    for (const fieldId of OWNER_ROWS[surfaceId]) {
      assert.equal(rows(envelope, surfaceId)[fieldId].value, `${surfaceId} ${fieldId} owner value`);
    }
    assert.equal(envelope.surfaces[surfaceId].bindingState, 'BINDING_READY');
  }

  const second = await service.readSupervisor();
  assert.equal(reads, 2, 'each envelope takes its own single cut');
  assert.equal(rows(second, 'account')['spot-truth'].value, 'LATER_CUT');
});

test('a wired owner-truth port that cannot answer never fails the whole envelope', async () => {
  const throwing = createProductIntegrationRuntime({
    read: Object.freeze({
      ...makeRead(),
      ownerTruth: () => { throw new Error('owner port down'); },
    }),
    clock: { nowMs: () => T0 },
  });
  const envelope = await throwing.readSupervisor();
  assert.equal(envelope.schemaVersion, 'product-supervisor.v1');
  assert.equal(rows(envelope, 'account')['spot-truth'].unavailableReason, 'OWNER_TRUTH_OWNER_UNAVAILABLE');
  assert.equal(envelope.surfaces.account.bindingState, 'BLOCKED_BACKEND');
  assert.equal(envelope.surfaces['control-room'].bindingState, 'BLOCKED_BACKEND');
  assert.equal(envelope.ownerView.processAlive, 'YES');

  const rejecting = createProductIntegrationRuntime({
    read: Object.freeze({ ...makeRead(), ownerTruth: async () => { throw new Error('rejected'); } }),
    clock: { nowMs: () => T0 },
  });
  assert.equal(
    rows(await rejecting.readSupervisor(), 'markets').basis.unavailableReason,
    'OWNER_TRUTH_OWNER_UNAVAILABLE',
  );

  const empty = createProductIntegrationRuntime({
    read: Object.freeze({ ...makeRead(), ownerTruth: () => null }),
    clock: { nowMs: () => T0 },
  });
  assert.equal(
    rows(await empty.readSupervisor(), 'dashboard')['pnl-drawdown'].unavailableReason,
    'OWNER_TRUTH_CUT_NOT_CONFIGURED',
  );

  const unwired = createProductIntegrationRuntime({ read: makeRead(), clock: { nowMs: () => T0 } });
  assert.equal(
    rows(await unwired.readSupervisor(), 'dashboard')['pnl-drawdown'].unavailableReason,
    'CANONICAL_OWNER_FIELD_NOT_CONFIGURED',
  );
});
