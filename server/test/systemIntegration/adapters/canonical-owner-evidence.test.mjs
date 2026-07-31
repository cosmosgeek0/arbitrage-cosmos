import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  MACHINE_GRAPH_CONTROL_ACTIONS,
  MACHINE_GRAPH_ROLES,
} from '../../../dist/liveEdge/adapters/machineGraphEvidence/index.js';
import {
  CANONICAL_OWNER_EVIDENCE_CORRELATION_ID,
  CANONICAL_OWNER_EVIDENCE_SCHEMA,
  createCanonicalOwnerEvidenceReadPort,
} from '../../../dist/systemIntegration/adapters/canonicalOwnerEvidence.js';
import {
  createLiveEdgeControlProductionBinding,
} from '../../../dist/systemIntegration/persistence/liveEdgeControlProductionBinding.js';
import {
  LiveEdgeMutationJournalAdapterError,
  LiveEdgeMutationJournalPersistenceAdapter,
} from '../../../dist/systemIntegration/persistence/liveEdgeMutationJournalAdapter.js';
import {
  SYSTEM_COMPONENT_IDS,
} from '../../../dist/systemIntegration/contracts/constants.js';
import { validateSystemTraceEvent } from '../../../dist/systemIntegration/contracts/validation.js';
import {
  prepareInitialMutationAppend,
} from '../../../dist/liveEdge/adapters/durableMutationJournal/index.js';
import { ManualClock } from '../fixtures/manual-clock.mjs';
import { BoundedInMemoryLedger } from '../fixtures/memory-ledger.mjs';
import { component } from '../supervisor/fixtures.mjs';
import { inputFixture, T0 } from '../../liveEdge/mutationJournal/fixtures.mjs';

function gatedL14(ledger, clock) {
  return createLiveEdgeControlProductionBinding({ ledger, clock });
}

function productionComponents() {
  return Object.freeze({
    'public-spot-source': Object.freeze({
      readComponentSnapshot: () => component('public-spot-source'),
    }),
    'public-usdm-source': Object.freeze({
      readComponentSnapshot: () => component('public-usdm-source'),
    }),
  });
}

function emptyInventory() {
  return Object.freeze({
    state: 'EMPTY',
    journalCount: 0,
    entryCount: 0,
    highestJournalVersion: 0,
    reconstructionProven: true,
    persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER',
    sendAuthorized: false,
    externalActionAuthorization: 'NONE',
  });
}

test('production composition maps the accepted exact 27 roles without inventing topology or owner truth', () => {
  const clock = new ManualClock(T0);
  const ledger = new BoundedInMemoryLedger(clock);
  const port = createCanonicalOwnerEvidenceReadPort({
    clock,
    components: productionComponents(),
    mutationJournal: Object.freeze({ inspectInventory: emptyInventory }),
    liveEdgeControl: gatedL14(ledger, clock),
  });
  const snapshot = port.readCanonicalOwnerEvidence();
  const counts = Object.fromEntries(['BOUND', 'OWNER_GATED', 'MISSING'].map((state) => [
    state,
    snapshot.l13.roles.filter((role) => role.bindingState === state).length,
  ]));
  const boundIds = snapshot.l13.roles.flatMap((role) => role.componentIds);

  assert.equal(snapshot.schema, CANONICAL_OWNER_EVIDENCE_SCHEMA);
  assert.deepEqual(snapshot.l13.roles.map((role) => role.role), MACHINE_GRAPH_ROLES);
  assert.deepEqual(counts, { BOUND: 11, OWNER_GATED: 13, MISSING: 3 });
  assert.equal(boundIds.length, 12);
  assert.equal(new Set(boundIds).size, 12);
  assert.equal(boundIds.every((componentId) => CANONICAL_SYSTEM_COMPONENT_IDS.includes(componentId)), true);
  assert.deepEqual(
    CANONICAL_SYSTEM_COMPONENT_IDS,
    SYSTEM_COMPONENT_IDS.filter((componentId) => componentId !== 'q-inference'),
  );
  assert.deepEqual(
    snapshot.l13.roles.filter((role) => role.bindingState === 'MISSING').map((role) => role.role),
    ['EC2_PROCESS', 'CLOUDFLARE_TUNNEL_ACCESS', 'WATCHDOG_ALARMS'],
  );
  assert.equal(snapshot.l13.roles.find((role) => role.role === 'SPOT_PUBLIC_STREAM').truthLabel, 'LIVE_PUBLIC');
  assert.equal(snapshot.l13.roles.find((role) => role.role === 'CAPITAL_GATE').evidenceState, 'UNKNOWN');
  assert.equal(Object.hasOwn(snapshot.l13, 'edges'), false);
  assert.equal(Object.hasOwn(snapshot.l13, 'topology'), false);
  assert.equal(snapshot.l13.topologyAuthority, 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY');
  assert.equal(snapshot.l13.firstRootSelectionAuthority, 'CANONICAL_SYSTEM_INTEGRATION_SUPERVISOR_ONLY');
});

test('present non-live owners stay unknown or unavailable and timestamps cannot mint owner revisions', () => {
  const clock = new ManualClock(T0);
  const ledger = new BoundedInMemoryLedger(clock);
  const ownerSnapshots = Object.freeze({
    'capital-supervision': component('capital-supervision', {
      releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
      truthLabel: 'UNKNOWN',
      readiness: 'DEGRADED',
      authority: 'UNAVAILABLE',
      completeness: 'PARTIAL',
      blockerCodes: ['CAPITAL_OWNER_TRUTH_UNKNOWN'],
    }),
    'multileg-risk': component('multileg-risk', {
      truthLabel: 'SYNTHETIC_ONLY',
    }),
    'execution-coordinator-validate-only': component('execution-coordinator-validate-only'),
    reconciliation: component('reconciliation', {
      releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'BLOCKED'],
      truthLabel: 'UNAVAILABLE',
      readiness: 'BLOCKED',
      authority: 'UNAVAILABLE',
      completeness: 'UNAVAILABLE',
      blockerCodes: ['RECONCILIATION_OWNER_TRUTH_UNAVAILABLE'],
    }),
  });
  const components = Object.freeze(Object.fromEntries(Object.entries(ownerSnapshots).map(([
    componentId,
    snapshot,
  ]) => [componentId, Object.freeze({ readComponentSnapshot: () => snapshot })])));
  const port = createCanonicalOwnerEvidenceReadPort({
    clock,
    components,
    mutationJournal: Object.freeze({ inspectInventory: emptyInventory }),
    liveEdgeControl: gatedL14(ledger, clock),
  });

  const first = port.readCanonicalOwnerEvidence();
  const roleByName = new Map(first.l13.roles.map((role) => [role.role, role]));
  const ownerByName = new Map(first.l12.ownerAvailability.map((owner) => [owner.owner, owner]));

  assert.deepEqual(
    ['CAPITAL_GATE', 'RISK_GATE', 'EXECUTION_HAND'].map((role) => roleByName.get(role).evidenceState),
    ['UNKNOWN', 'UNKNOWN', 'UNKNOWN'],
  );
  assert.equal(roleByName.get('RECONCILIATION').evidenceState, 'UNAVAILABLE');
  assert.equal(roleByName.get('CAPITAL_GATE').truthLabel, 'UNKNOWN');
  assert.equal(roleByName.get('RISK_GATE').truthLabel, 'SYNTHETIC_ONLY');
  assert.equal(roleByName.get('EXECUTION_HAND').truthLabel, 'DRY_RUN');
  assert.equal(roleByName.get('RECONCILIATION').truthLabel, 'UNAVAILABLE');
  assert.deepEqual(
    ['CAPITAL_FOUNDATION', 'FOUNDATION_RISK', 'FOUNDATION_EXECUTION']
      .map((owner) => ownerByName.get(owner).state),
    ['UNKNOWN', 'UNKNOWN', 'UNKNOWN'],
  );
  assert.equal(ownerByName.get('FOUNDATION_RECONCILIATION').state, 'UNAVAILABLE');
  assert.equal(first.l13.roles.every((role) => role.ownerRevision === null), true);
  assert.equal(first.l12.ownerAvailability.every((owner) => owner.ownerRevision === null), true);

  clock.advance(5_000);
  const second = port.readCanonicalOwnerEvidence();
  assert.notEqual(second.evaluatedAtMs, first.evaluatedAtMs);
  assert.equal(second.l13.roles.every((role) => role.ownerRevision === null), true);
  assert.equal(second.l12.ownerAvailability.every((owner) => owner.ownerRevision === null), true);
});

test('L12 remains cold-start halted and quantity/exposure unknown even when canonical L06 is proven empty', () => {
  const clock = new ManualClock(T0);
  const ledger = new BoundedInMemoryLedger(clock);
  const port = createCanonicalOwnerEvidenceReadPort({
    clock,
    components: productionComponents(),
    mutationJournal: Object.freeze({ inspectInventory: emptyInventory }),
    liveEdgeControl: gatedL14(ledger, clock),
  });
  const snapshot = port.readCanonicalOwnerEvidence();

  assert.equal(snapshot.l06.wiringState, 'WIRED');
  assert.equal(snapshot.l06.inventoryState, 'EMPTY');
  assert.equal(snapshot.l06.reconstructionProven, true);
  assert.equal(snapshot.l06.sendAuthorized, false);
  assert.equal(snapshot.l12.wiringState, 'OWNER_AVAILABILITY_COMPOSED');
  assert.equal(snapshot.l12.acceptedProjectionState, 'NOT_INVOKED_NO_CANONICAL_SUBJECT');
  assert.equal(snapshot.l12.acceptedProjectionInvoked, false);
  assert.equal(snapshot.l12.truthLabel, 'UNAVAILABLE');
  assert.equal(snapshot.l12.projectionState, 'UNKNOWN');
  assert.equal(snapshot.l12.privateTruthState, 'OWNER_GATED');
  assert.equal(snapshot.l12.coldStartPosture, 'HALTED');
  assert.equal(snapshot.l12.effectiveEntryMode, 'BLOCKED');
  assert.equal(snapshot.l12.subjectState, 'UNKNOWN');
  assert.equal(snapshot.l12.subject, null);
  assert.equal(snapshot.l12.accountingScopeId, null);
  assert.equal(snapshot.l12.capitalExposed, null);
  assert.equal(snapshot.l12.activeExposureAmount, null);
  assert.equal(snapshot.l12.syntheticInputAccepted, false);
  assert.equal(snapshot.l12.authorityGranted, false);
  assert.equal(snapshot.l12.externalActionAuthorization, 'NONE');
  assert.equal(snapshot.l12.ownerAvailability.find((row) => (
    row.owner === 'SYSTEM_INTEGRATION_LEDGER'
  )).state, 'EMPTY');
  assert.equal(snapshot.l12.ownerAvailability.filter((row) => (
    row.owner !== 'SYSTEM_INTEGRATION_LEDGER'
  )).every((row) => row.state === 'UNKNOWN'), true);
  assert.equal(snapshot.l13.wiringState, 'ROLE_BINDINGS_COMPOSED');
  assert.equal(snapshot.l13.acceptedProjectionState, 'NOT_INVOKED_NO_VALIDATED_L12_BINDING');
  assert.equal(snapshot.l13.acceptedProjectionInvoked, false);
  assert.notEqual(snapshot.l12.wiringState, 'COMPOSED');
  assert.notEqual(snapshot.l13.wiringState, 'COMPOSED');
  assert.notEqual(snapshot.l12.projectionState, 'READY');
  assert.notEqual(snapshot.l13.graphState, 'READY');
  assert.notEqual(snapshot.l14.activationState, 'AVAILABLE');
});

test('L14 owner gate keeps all 18 accepted actions unavailable and exposes no dispatch seam', () => {
  const clock = new ManualClock(T0);
  let ledgerReads = 0;
  let ledgerWrites = 0;
  const ledger = {
    getConfigValue() { ledgerReads += 1; return null; },
    compareAndSetConfigValueAndLogEvents() { ledgerWrites += 1; throw new Error('must not write'); },
    recentEvents() { ledgerReads += 1; return []; },
  };
  const binding = createLiveEdgeControlProductionBinding({ ledger, clock });
  const port = createCanonicalOwnerEvidenceReadPort({
    clock,
    components: Object.freeze({}),
    mutationJournal: Object.freeze({ inspectInventory: emptyInventory }),
    liveEdgeControl: binding,
  });
  const snapshot = port.readCanonicalOwnerEvidence();

  assert.equal(binding.wiringState, 'STRUCTURALLY_INTEGRATED');
  assert.equal(binding.activationState, 'OWNER_GATED');
  assert.equal(binding.persistence, null);
  assert.equal(binding.configurationVersionOwner, null);
  assert.equal(binding.commandDispatchAvailable, false);
  assert.deepEqual(Object.keys(binding).sort(), [
    'activationState', 'commandDispatchAvailable', 'configurationVersionOwner',
    'controlOwner', 'externalActionAuthorization', 'persistence', 'persistenceOwner',
    'reasonCodes', 'schema', 'version', 'wiringState',
  ]);
  assert.equal(binding.reasonCodes.includes('CANONICAL_NUMERIC_CONFIGURATION_VERSION_NOT_CONFIGURED'), true);
  assert.deepEqual(snapshot.l13.controls.map((control) => control.action), MACHINE_GRAPH_CONTROL_ACTIONS);
  assert.equal(snapshot.l13.controls.length, 18);
  assert.equal(snapshot.l13.controls.every((control) => control.availability === 'UNAVAILABLE'), true);
  assert.equal(snapshot.l13.controls.every((control) => control.persistenceState === 'OWNER_GATED'), true);
  assert.equal(snapshot.l14.commandDispatchAvailable, false);
  assert.equal(snapshot.l14.externalActionAuthorization, 'NONE');
  assert.equal(ledgerReads, 0);
  assert.equal(ledgerWrites, 0);

  const lyingShapeOnlyPort = createLiveEdgeControlProductionBinding({
    ledger,
    clock,
    configurationVersion: Object.freeze({ read: () => null }),
    checkpointOwner: Object.freeze({
      load: () => Object.freeze({ ok: true, state: Object.freeze({}) }),
    }),
    controlStateOwner: Object.freeze({ synchronizeReservedRevision: () => true }),
  });
  assert.equal(lyingShapeOnlyPort.activationState, 'OWNER_GATED');
  assert.equal(lyingShapeOnlyPort.persistence, null);
  assert.equal(lyingShapeOnlyPort.reasonCodes.includes(
    'CANONICAL_NUMERIC_CONFIGURATION_VERSION_NOT_CONFIGURED',
  ), true);
  assert.equal(ledgerReads, 0);
  assert.equal(ledgerWrites, 0);
});

test('restart reconstructs the one L06 canonical journal while L12/L14 remain non-authoritative', () => {
  const clock = new ManualClock(T0);
  const ledger = new BoundedInMemoryLedger(clock);
  const first = new LiveEdgeMutationJournalPersistenceAdapter(ledger, clock);
  const prepared = prepareInitialMutationAppend(inputFixture());
  const acknowledgement = first.append(prepared.request);
  assert.equal(acknowledgement.disposition, 'COMMITTED_NEW');

  const restarted = new LiveEdgeMutationJournalPersistenceAdapter(ledger, clock);
  let inventoryReads = 0;
  const port = createCanonicalOwnerEvidenceReadPort({
    clock,
    components: Object.freeze({}),
    mutationJournal: Object.freeze({
      inspectInventory() {
        inventoryReads += 1;
        return restarted.inspectInventory();
      },
    }),
    liveEdgeControl: gatedL14(ledger, clock),
  });
  const snapshot = port.readCanonicalOwnerEvidence();
  const events = port.readTraceEvents();

  assert.equal(inventoryReads, 1, 'one supervisor owner cut must not rescan the Ledger for its trace');
  assert.equal(snapshot.l06.inventoryState, 'AVAILABLE');
  assert.equal(snapshot.l06.journalCount, 1);
  assert.equal(snapshot.l06.entryCount, 1);
  assert.equal(snapshot.l06.highestJournalVersion, 1);
  assert.equal(snapshot.l06.reconstructionProven, true);
  assert.equal(snapshot.l06.sendAuthorized, false);
  assert.equal(snapshot.l12.projectionState, 'UNKNOWN');
  assert.equal(snapshot.l12.capitalExposed, null);
  assert.equal(snapshot.l14.activationState, 'OWNER_GATED');
  assert.equal(events.every((event) => event.correlationId === CANONICAL_OWNER_EVIDENCE_CORRELATION_ID), true);
  assert.equal(events.every((event) => validateSystemTraceEvent(event).length === 0), true);
  assert.equal(events.find((event) => event.componentId === 'capital-supervision').truthLabel, 'UNAVAILABLE');
  assert.equal(events.find((event) => (
    event.componentId === 'engine-supervisor'
      && event.canonicalProjectionId.endsWith(':L13-L14')
  )).truthLabel, 'UNKNOWN');
  assert.equal(events.some((event) => event.referenceIds.includes('commandDispatchAvailable=true')), false);
});

test('corrupt or unavailable L06 readback becomes unknown and never a fabricated zero', () => {
  const clock = new ManualClock(T0);
  const ledger = new BoundedInMemoryLedger(clock);
  const corruptPort = createCanonicalOwnerEvidenceReadPort({
    clock,
    components: Object.freeze({}),
    mutationJournal: Object.freeze({
      inspectInventory() {
        throw new LiveEdgeMutationJournalAdapterError('PERSISTENCE_CORRUPT', 'hostile corruption');
      },
    }),
    liveEdgeControl: gatedL14(ledger, clock),
  });
  const corrupt = corruptPort.readCanonicalOwnerEvidence();
  assert.equal(corrupt.l06.inventoryState, 'PERSISTENCE_CORRUPT');
  assert.equal(corrupt.l06.journalCount, null);
  assert.equal(corrupt.l06.entryCount, null);
  assert.equal(corrupt.l06.highestJournalVersion, null);
  assert.equal(corrupt.l06.reconstructionProven, false);
  assert.equal(corrupt.l12.projectionState, 'UNKNOWN');
  assert.equal(corrupt.l12.capitalExposed, null);
  assert.equal(corrupt.l12.ownerAvailability.find((row) => (
    row.owner === 'SYSTEM_INTEGRATION_LEDGER'
  )).state, 'UNAVAILABLE');
});

test('production startup mounts canonical owner evidence and does not retain the passive L-only probe', async () => {
  const source = await readFile(new URL('../../../src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /new LiveEdgeMutationJournalPersistenceAdapter\(\s*ledger,/u);
  assert.match(source, /createLiveEdgeControlProductionBinding\(\{\s*ledger,/u);
  assert.match(source, /createCanonicalOwnerEvidenceReadPort\(\{/u);
  assert.match(source, /traces: canonicalOwnerEvidence/u);
  assert.doesNotMatch(source, /createPassiveOwnerEvidenceReadPort/u);
  assert.doesNotMatch(source, /configurationVersion:\s*(?:checkpoint|config\.revision|systemIntegration)/u);
});
