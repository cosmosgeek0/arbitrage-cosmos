import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import ts from 'typescript';

import {
  evaluateExecutionPolicy,
} from '../../../dist/liveEdge/adapters/executionPolicy/index.js';
import {
  makeAction,
  makeCandidate,
  makeExecutionPolicyInput,
  rehashAction,
  rehashCandidate,
} from './fixtures.mjs';

const SOURCE_ROOT = path.resolve('server/src/liveEdge/adapters/executionPolicy');

const ALLOWED_IMPORTS = new Set([
  'node:crypto',
  'node:util',
  '../../../capitalFoundation/contracts/decimal.js',
  '../../../foundation/contracts/index.js',
  '../binanceInstrumentSpecs/spotOrderTifCapability.js',
  '../binanceInstrumentSpecs/sizing.js',
  '../binanceInstrumentSpecs/types.js',
  './exact.js',
  './policy.js',
  './types.js',
]);

const FORBIDDEN_CALLS = new Set([
  'allocate',
  'allocateCapital',
  'borrow',
  'borrowAsset',
  'cancelAllOrders',
  'cancelOrder',
  'commitReservation',
  'createOrder',
  'evaluateRisk',
  'execute',
  'executePlan',
  'fetch',
  'loan',
  'newOrder',
  'placeOrder',
  'queryOrder',
  'reconcile',
  'releaseReservation',
  'repay',
  'repayLoan',
  'reserve',
  'reserveCapital',
  'sendOrder',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'submitOrder',
  'testOrder',
  'transfer',
  'universalTransfer',
  'withdraw',
  'withdrawal',
]);

function sourceFiles() {
  return fs.readdirSync(SOURCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(SOURCE_ROOT, entry.name))
    .sort();
}

function nodeName(node) {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function expressionPath(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const prefix = expressionPath(node.expression);
    return prefix === null ? null : `${prefix}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    const prefix = expressionPath(node.expression);
    return prefix === null ? null : `${prefix}.${node.argumentExpression.text}`;
  }
  return null;
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function inputRejected(decision) {
  assert.equal(decision.disposition, 'REJECTED');
  assert.deepEqual(decision.reasonCodes, ['INPUT_REJECTED']);
  assert.equal(decision.evaluatedAtMs, null);
  assert.equal(decision.policyRequestId, null);
  assert.equal(decision.selectedPlan, null);
}

function assertFrozenGraph(value, seen = new WeakSet()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    assert.equal(Object.hasOwn(descriptor, 'value'), true);
    assertFrozenGraph(descriptor.value, seen);
  }
}

function replaceCandidateAction(candidate, index, changes) {
  const copy = structuredClone(candidate);
  copy.actions[index] = rehashAction({ ...copy.actions[index], ...changes });
  return rehashCandidate(copy);
}

function decisionFor(candidate) {
  return evaluateExecutionPolicy(makeExecutionPolicyInput({ candidates: [candidate] }));
}

test('ordered policy binds second-leg placement to actual first-leg fill, never ACK or request', () => {
  const candidate = makeCandidate({ sequenceMode: 'ORDERED' });
  const accepted = decisionFor(candidate);
  assert.equal(accepted.disposition, 'PLANNED');
  assert.equal(accepted.selectedPlan.sequenceMode, 'ORDERED');
  assert.deepEqual(accepted.selectedPlan.legs.map((leg) => leg.legId), ['leg-spot', 'leg-perp']);
  const [firstPlace, secondPlace] = accepted.selectedPlan.actions
    .filter((action) => action.kind === 'PLACE')
    .sort((left, right) => left.step - right.step);
  assert.equal(firstPlace.dependsOnActualFillLegId, null);
  assert.equal(firstPlace.quantitySource, 'AUTHORIZED_FILTERED_QUANTITY');
  assert.equal(secondPlace.dependsOnActualFillLegId, firstPlace.legId);
  assert.equal(secondPlace.quantitySource, 'ACTUAL_FILL_OF_LEG');
  assert.equal(accepted.selectedPlan.failureTransitions.onFirstLegPartial, 'WAIT_FOR_ACTUAL_FILL');
  assert.equal(accepted.selectedPlan.failureTransitions.onFirstLegTimeout, 'RECONCILE_ONLY');

  const requestCoupled = replaceCandidateAction(candidate, 1, { dependsOnActualFillLegId: null });
  inputRejected(decisionFor(requestCoupled));

  const ackCoupled = replaceCandidateAction(candidate, 1, {
    dependsOnActualFillLegId: candidate.actions[0].actionId,
  });
  inputRejected(decisionFor(ackCoupled));
});

test('recovery is exact-exposure-bound and explicitly risk-reducing', () => {
  const candidate = makeCandidate();
  const recovery = makeAction({
    step: 2,
    kind: 'RECOVER',
    legId: 'leg-perp',
    price: '99',
    dependsOnActualFillLegId: 'leg-spot',
  });
  const bound = rehashCandidate({ ...candidate, actions: [...candidate.actions, recovery] });
  const decision = decisionFor(bound);
  assert.equal(decision.disposition, 'PLANNED');
  assert.equal(decision.selectedPlan.actions[2].quantitySource, 'RISK_REDUCING_RECOVERY_EVIDENCE');
  assert.equal(decision.selectedPlan.actions[2].exposureEffect, 'RISK_REDUCING_ONLY');

  const unbound = rehashCandidate({
    ...candidate,
    actions: [...candidate.actions, rehashAction({ ...recovery, dependsOnActualFillLegId: null })],
  });
  inputRejected(decisionFor(unbound));
});

test('concurrent policy keeps both initial legs independent and names imbalance recovery', () => {
  const decision = decisionFor(makeCandidate({ sequenceMode: 'CONCURRENT' }));
  assert.equal(decision.disposition, 'PLANNED');
  assert.equal(decision.selectedPlan.sequenceMode, 'CONCURRENT');
  assert.equal(decision.selectedPlan.failureTransitions.onFirstLegReject, 'NOT_APPLICABLE');
  assert.equal(decision.selectedPlan.failureTransitions.onFirstLegPartial, 'NOT_APPLICABLE');
  assert.equal(decision.selectedPlan.failureTransitions.onFirstLegTimeout, 'NOT_APPLICABLE');
  assert.equal(decision.selectedPlan.failureTransitions.onConcurrentImbalance, 'STOP_NO_NEW_EXPOSURE');
  assert.equal(
    decision.selectedPlan.actions
      .filter((action) => action.kind === 'PLACE')
      .every((action) => action.dependsOnActualFillLegId === null),
    true,
  );
});

test('replacement is content-distinct and follows a separate confirmed cancel', () => {
  const candidate = makeCandidate();
  const first = candidate.actions[0];
  const cancel = makeAction({
    step: 2,
    kind: 'CANCEL',
    legId: first.legId,
    orderType: null,
    timeInForce: null,
    quantity: null,
    price: null,
    targetActionId: first.actionId,
    dependsOnActualFillLegId: null,
    requiresConfirmedCancelActionId: null,
  });
  const replacement = makeAction({
    step: 3,
    kind: 'REPLACE_AFTER_CONFIRMED_CANCEL',
    legId: first.legId,
    orderType: first.orderType,
    timeInForce: first.timeInForce,
    quantity: first.quantity,
    price: first.price,
    targetActionId: null,
    dependsOnActualFillLegId: null,
    requiresConfirmedCancelActionId: cancel.actionId,
  });
  const withReplacement = rehashCandidate({
    ...candidate,
    actions: [...candidate.actions, cancel, replacement],
  });
  const decision = decisionFor(withReplacement);
  assert.equal(decision.disposition, 'PLANNED');
  assert.notEqual(cancel.actionId, first.actionId);
  assert.notEqual(replacement.actionId, first.actionId);
  assert.notEqual(replacement.actionId, cancel.actionId);
  assert.equal(decision.selectedPlan.actions[2].targetActionId, first.actionId);
  assert.equal(decision.selectedPlan.actions[3].requiresConfirmedCancelActionId, cancel.actionId);

  const blindReplacement = rehashCandidate({
    ...withReplacement,
    actions: withReplacement.actions.map((action, index) => index === 3
      ? rehashAction({ ...action, requiresConfirmedCancelActionId: null })
      : action),
  });
  inputRejected(decisionFor(blindReplacement));

  const atomicLike = replaceCandidateAction(candidate, 0, { kind: 'CANCEL_REPLACE' });
  inputRejected(decisionFor(atomicLike));
});

test('cancel and replacement causal graph is same-leg, unique, and deadline-monotonic', () => {
  const candidate = makeCandidate();
  const first = candidate.actions[0];
  const cancelTerms = {
    kind: 'CANCEL', orderType: null, timeInForce: null, quantity: null, price: null,
    targetActionId: first.actionId, dependsOnActualFillLegId: null,
    requiresConfirmedCancelActionId: null,
  };
  const crossLeg = makeAction({ ...cancelTerms, step: 2, legId: 'leg-perp' });
  inputRejected(decisionFor(rehashCandidate({ ...candidate, actions: [...candidate.actions, crossLeg] })));

  const cancel = makeAction({ ...cancelTerms, step: 2, legId: first.legId });
  const duplicate = makeAction({ ...cancelTerms, step: 3, legId: first.legId });
  inputRejected(decisionFor(rehashCandidate({ ...candidate, actions: [...candidate.actions, cancel, duplicate] })));

  const early = rehashAction({ ...cancel, deadlineOffsetMs: first.deadlineOffsetMs - 1 });
  inputRejected(decisionFor(rehashCandidate({ ...candidate, actions: [...candidate.actions, early] })));
});

test('timeout, disconnect, 5xx, cancel ambiguity, and action ambiguity remain reconcile-only', () => {
  const candidate = makeCandidate();
  const decision = decisionFor(candidate);
  assert.equal(decision.disposition, 'PLANNED');
  for (const key of ['onTimeout', 'onDisconnect', 'onHttp5xx', 'onCancelAmbiguity']) {
    assert.equal(decision.selectedPlan.failureTransitions[key], 'RECONCILE_ONLY');
  }
  assert.equal(decision.selectedPlan.actions.every((action) => action.ambiguityPosture === 'RECONCILE_ONLY'), true);

  const blindAction = replaceCandidateAction(candidate, 0, { ambiguityPosture: 'BLIND_RETRY' });
  inputRejected(decisionFor(blindAction));
  const blindTransition = rehashCandidate({
    ...candidate,
    failureTransitions: { ...candidate.failureTransitions, onHttp5xx: 'RETRY' },
  });
  inputRejected(decisionFor(blindTransition));
});

test('hostile graphs reject without invoking accessors or Proxy traps', () => {
  let getterCalls = 0;
  const accessor = makeExecutionPolicyInput();
  Object.defineProperty(accessor, 'policyRequestId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  inputRejected(evaluateExecutionPolicy(accessor));
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const proxy = new Proxy(makeExecutionPolicyInput(), {
    get() {
      proxyTraps += 1;
      throw new Error('must not execute');
    },
    getOwnPropertyDescriptor() {
      proxyTraps += 1;
      throw new Error('must not execute');
    },
    ownKeys() {
      proxyTraps += 1;
      throw new Error('must not execute');
    },
  });
  inputRejected(evaluateExecutionPolicy(proxy));
  assert.equal(proxyTraps, 0);
});

test('cycles, aliases, symbols, sparse arrays, and secret-shaped records fail closed', () => {
  const variants = [];

  const cyclic = makeExecutionPolicyInput();
  cyclic.authority.cycle = cyclic;
  variants.push(cyclic);

  const aliased = makeExecutionPolicyInput();
  aliased.dependencies[1] = aliased.dependencies[0];
  variants.push(aliased);

  const symbolKeyed = makeExecutionPolicyInput();
  symbolKeyed[Symbol('hidden')] = 'forbidden';
  variants.push(symbolKeyed);

  const sparse = makeExecutionPolicyInput();
  sparse.candidates = new Array(1);
  variants.push(sparse);

  const secretShaped = makeExecutionPolicyInput();
  secretShaped.authority.apiKey = 'must-not-appear';
  variants.push(secretShaped);

  for (const input of variants) inputRejected(evaluateExecutionPolicy(input));
});

test('candidate, action, scenario, text, and graph-depth first overflow reject', () => {
  const candidateOverflow = makeExecutionPolicyInput();
  candidateOverflow.candidates = Array.from({ length: 33 }, () => structuredClone(candidateOverflow.candidates[0]));
  inputRejected(evaluateExecutionPolicy(candidateOverflow));

  const actionOverflow = makeExecutionPolicyInput();
  actionOverflow.candidates[0].actions = Array.from(
    { length: 33 },
    () => structuredClone(actionOverflow.candidates[0].actions[0]),
  );
  inputRejected(evaluateExecutionPolicy(actionOverflow));

  const scenarioOverflow = makeExecutionPolicyInput();
  scenarioOverflow.candidates[0].distribution.scenarios = Array.from(
    { length: 65 },
    () => structuredClone(scenarioOverflow.candidates[0].distribution.scenarios[0]),
  );
  inputRejected(evaluateExecutionPolicy(scenarioOverflow));

  const textOverflow = makeExecutionPolicyInput();
  textOverflow.policyRequestId = `P${'x'.repeat(512)}`;
  inputRejected(evaluateExecutionPolicy(textOverflow));

  const depthOverflow = makeExecutionPolicyInput();
  let nested = {};
  depthOverflow.overflow = nested;
  for (let index = 0; index < 25; index += 1) {
    nested.next = {};
    nested = nested.next;
  }
  inputRejected(evaluateExecutionPolicy(depthOverflow));
});

test('planned and rejected outputs are deeply frozen and non-sendable', () => {
  const planned = evaluateExecutionPolicy(makeExecutionPolicyInput());
  assert.equal(planned.disposition, 'PLANNED');
  assertFrozenGraph(planned);
  assert.equal(planned.policyAuthority, 'ADVISORY_EXECUTION_MECHANICS_ONLY');
  assert.equal(planned.simulationAuthority, 'SYNTHETIC_FIXTURE');
  assert.equal(planned.sendEligible, false);
  assert.equal(planned.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(planned.externalActionAuthorization, 'NONE');
  assert.throws(() => planned.selectedPlan.actions.push({}));
  assert.throws(() => { planned.selectedPlan.failureTransitions.onTimeout = 'RETRY'; });

  const rejected = evaluateExecutionPolicy({ apiKey: 'must-not-appear' });
  inputRejected(rejected);
  assertFrozenGraph(rejected);
  assert.equal(rejected.sendEligible, false);
  assert.equal(JSON.stringify(rejected).includes('must-not-appear'), false);
});

test('L08 source has no transport, persistence, owner mutation, ambient time, randomness, or money path', () => {
  const violations = [];
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    assert.deepEqual(tree.parseDiagnostics.map((diagnostic) => diagnostic.messageText), []);

    walk(tree, (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
        && !ALLOWED_IMPORTS.has(node.moduleSpecifier.text)) {
        violations.push(`${path.basename(file)} imports ${node.moduleSpecifier.text}`);
      }
      if (ts.isCallExpression(node)) {
        const name = nodeName(node.expression);
        const target = expressionPath(node.expression);
        if (name && FORBIDDEN_CALLS.has(name)) violations.push(`${path.basename(file)} calls ${name}`);
        if (target === 'Date.now' || target === 'performance.now' || target === 'Math.random'
          || target === 'process.hrtime' || target === 'process.uptime') {
          violations.push(`${path.basename(file)} reads ambient ${target}`);
        }
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
        const target = expressionPath(node);
        if (target && /^(?:process|Bun|Deno)\.env(?:\.|$)/u.test(target)) {
          violations.push(`${path.basename(file)} reads environment state`);
        }
      }
      if ((ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && (/^(?:https?|wss?):\/\//iu.test(node.text)
          || /^\/(?:api|sapi|fapi|dapi|vapi)\/v\d+(?:\/|$)/iu.test(node.text))) {
        violations.push(`${path.basename(file)} embeds endpoint ${node.text}`);
      }
      if (ts.isNewExpression(node)) {
        const name = nodeName(node.expression);
        if (['EventSource', 'WebSocket', 'XMLHttpRequest'].includes(name)) {
          violations.push(`${path.basename(file)} constructs ${name}`);
        }
        if (name === 'Date' && (node.arguments?.length ?? 0) === 0) {
          violations.push(`${path.basename(file)} constructs ambient Date`);
        }
      }
    });
  }

  assert.deepEqual(violations, []);
});
