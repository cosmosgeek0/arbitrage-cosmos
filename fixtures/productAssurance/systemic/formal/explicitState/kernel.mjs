import { requireProperty } from './properties.mjs';

export const EXPLICIT_STATE_REPORT_SCHEMA = 'ip-assurance.s3.explicit-state-report.v1';
export const EXPLICIT_STATE_DIAGNOSTIC_SCHEMA = 'ip-assurance.s3.explicit-state-diagnostic.v1';
export const EXPLICIT_STATE_CHECKER = Object.freeze({
  checkerId: 'NODE_DETERMINISTIC_EXPLICIT_STATE',
  checkerVersion: '1.0.0',
  algorithm: 'CANONICAL_SORTED_BFS_WITH_FAIR_SCC',
});

const ACTION_ID = /^[A-Z][A-Z0-9_]{1,95}$/;
const STATUS_ORDER = Object.freeze({ PASS: 0, UNKNOWN: 1, FAIL: 2 });
const MAX_TRANSITIONS_PER_STATE = 4_096;
const MAX_CANONICAL_STATE_CHARS = 100_000;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value, path, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must be finite`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} is not JSON-safe`);
  if (seen.has(value)) throw new TypeError(`${path} is cyclic`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`${path} must be dense`);
      assertJsonValue(value[index], `${path}[${index}]`, seen);
    }
  } else {
    if (!isPlainObject(value)) throw new TypeError(`${path} must be a plain object`);
    for (const key of Object.keys(value)) assertJsonValue(value[key], `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export function canonicalJson(value) {
  assertJsonValue(value, '$', new Set());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function cloneFrozenJson(value) {
  assertJsonValue(value, '$', new Set());
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => cloneFrozenJson(entry)));
  const clone = {};
  for (const key of Object.keys(value).sort()) clone[key] = cloneFrozenJson(value[key]);
  return Object.freeze(clone);
}

export function transition(actionId, nextState) {
  if (typeof actionId !== 'string' || !ACTION_ID.test(actionId)) throw new TypeError(`invalid actionId ${String(actionId)}`);
  return Object.freeze({ actionId, nextState: cloneFrozenJson(nextState) });
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${path} must be a positive safe integer`);
  return value;
}

function snapshotDataObject(value, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${path}.${String(key)} must be a data property; accessors are unsupported`);
    }
    if (typeof key === 'string') snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function requiredField(snapshot, key, path) {
  if (!Object.hasOwn(snapshot, key)) throw new TypeError(`${path}.${key} is required`);
  return snapshot[key];
}

function snapshotArray(value, path, { min = 0, max }) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      throw new TypeError(`${path}.${String(key)} must be a data property; accessors are unsupported`);
    }
  }
  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined || !Number.isSafeInteger(lengthDescriptor.value)) {
    throw new TypeError(`${path}.length is invalid`);
  }
  const length = lengthDescriptor.value;
  if (length < min || length > max) throw new TypeError(`${path} must contain ${min}..${max} entries`);
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined) throw new TypeError(`${path} must be dense`);
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function boundedString(value, path, max = 160) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > max) {
    throw new TypeError(`${path} is invalid`);
  }
  return value;
}

function captureBounds(value) {
  const bounds = snapshotDataObject(value, 'model.bounds');
  return Object.freeze({
    maxStates: positiveInteger(requiredField(bounds, 'maxStates', 'model.bounds'), 'model.bounds.maxStates'),
    maxTransitions: positiveInteger(requiredField(bounds, 'maxTransitions', 'model.bounds'), 'model.bounds.maxTransitions'),
    maxDepth: positiveInteger(requiredField(bounds, 'maxDepth', 'model.bounds'), 'model.bounds.maxDepth'),
  });
}

function captureModel(model) {
  const source = snapshotDataObject(model, 'model');
  for (const field of ['modelId', 'modelVersion', 'title']) {
    boundedString(requiredField(source, field, 'model'), `model.${field}`);
  }
  const schemaVersion = requiredField(source, 'schemaVersion', 'model');
  if (schemaVersion !== 'ip-assurance.s3.protocol-model.v1') throw new TypeError('model.schemaVersion is unsupported');
  const authority = requiredField(source, 'authority', 'model');
  if (authority !== 'SUPPORTING_EVIDENCE_ONLY') throw new TypeError('model.authority must be SUPPORTING_EVIDENCE_ONLY');
  const profile = Object.hasOwn(source, 'profile') ? boundedString(source.profile, 'model.profile') : 'CANONICAL';
  const assumptions = snapshotArray(requiredField(source, 'assumptions', 'model'), 'model.assumptions', { min: 1, max: 32 });
  if (assumptions.some((entry) => typeof entry !== 'string' || entry.length < 1 || entry.length > 500)) {
    throw new TypeError('model.assumptions contains an invalid statement');
  }
  const functions = Object.create(null);
  for (const fn of ['initialStates', 'enabledTransitions', 'terminal', 'terminalClass']) {
    const value = requiredField(source, fn, 'model');
    if (typeof value !== 'function') throw new TypeError(`model.${fn} must be a function`);
    functions[fn] = value;
  }
  const rawSafety = snapshotArray(requiredField(source, 'safety', 'model'), 'model.safety', { max: 128 });
  const rawLiveness = snapshotArray(requiredField(source, 'liveness', 'model'), 'model.liveness', { max: 128 });
  if (rawSafety.length + rawLiveness.length < 1 || rawSafety.length + rawLiveness.length > 128) {
    throw new TypeError('model must declare 1..128 properties');
  }
  const ids = new Set();
  const safety = rawSafety.map((value, index) => {
    const entry = snapshotDataObject(value, `model.safety[${index}]`);
    const propertyId = requiredField(entry, 'propertyId', `model.safety[${index}]`);
    const check = requiredField(entry, 'check', `model.safety[${index}]`);
    requireProperty(propertyId, 'SAFETY');
    if (typeof check !== 'function') throw new TypeError(`${propertyId}.check must be a function`);
    if (ids.has(propertyId)) throw new TypeError(`duplicate property ${propertyId}`);
    ids.add(propertyId);
    return Object.freeze({ propertyId, check });
  });
  const liveness = rawLiveness.map((value, index) => {
    const entry = snapshotDataObject(value, `model.liveness[${index}]`);
    const propertyId = requiredField(entry, 'propertyId', `model.liveness[${index}]`);
    const pending = requiredField(entry, 'pending', `model.liveness[${index}]`);
    const fulfilled = requiredField(entry, 'fulfilled', `model.liveness[${index}]`);
    requireProperty(propertyId, 'LIVENESS');
    if (typeof pending !== 'function' || typeof fulfilled !== 'function') {
      throw new TypeError(`${propertyId} requires pending and fulfilled predicates`);
    }
    const weakFairActions = snapshotArray(
      requiredField(entry, 'weakFairActions', `model.liveness[${index}]`),
      `${propertyId}.weakFairActions`,
      { max: 128 },
    );
    const strongFairActions = snapshotArray(
      requiredField(entry, 'strongFairActions', `model.liveness[${index}]`),
      `${propertyId}.strongFairActions`,
      { max: 128 },
    );
    for (const [key, actions] of [['weakFairActions', weakFairActions], ['strongFairActions', strongFairActions]]) {
      if (actions.some((action) => typeof action !== 'string' || !ACTION_ID.test(action))) {
        throw new TypeError(`${propertyId}.${key} is invalid`);
      }
    }
    if (strongFairActions.length > 0) throw new TypeError(`${propertyId}.strongFairActions is unsupported; use an explicit bounded monitor`);
    if (ids.has(propertyId)) throw new TypeError(`duplicate property ${propertyId}`);
    ids.add(propertyId);
    return Object.freeze({ propertyId, pending, fulfilled, weakFairActions, strongFairActions });
  });

  return Object.freeze({
    schemaVersion,
    modelId: source.modelId,
    modelVersion: source.modelVersion,
    title: source.title,
    profile,
    authority,
    bounds: captureBounds(requiredField(source, 'bounds', 'model')),
    assumptions: Object.freeze([...assumptions]),
    initialStates: functions.initialStates,
    enabledTransitions: functions.enabledTransitions,
    safety: Object.freeze(safety),
    liveness: Object.freeze(liveness),
    terminal: functions.terminal,
    terminalClass: functions.terminalClass,
  });
}

function captureOptions(options) {
  const source = snapshotDataObject(options, 'options');
  return Object.freeze({
    maxStates: Object.hasOwn(source, 'maxStates') ? positiveInteger(source.maxStates, 'options.maxStates') : undefined,
    maxTransitions: Object.hasOwn(source, 'maxTransitions') ? positiveInteger(source.maxTransitions, 'options.maxTransitions') : undefined,
    maxDepth: Object.hasOwn(source, 'maxDepth') ? positiveInteger(source.maxDepth, 'options.maxDepth') : undefined,
  });
}

function safeDiagnosticIdentity(model) {
  try {
    const source = snapshotDataObject(model, 'model');
    return Object.freeze({
      modelId: typeof source.modelId === 'string' ? source.modelId : 'INVALID_MODEL',
      modelVersion: typeof source.modelVersion === 'string' ? source.modelVersion : 'UNKNOWN',
      profile: typeof source.profile === 'string' ? source.profile : 'UNKNOWN',
    });
  } catch {
    return Object.freeze({ modelId: 'INVALID_MODEL', modelVersion: 'UNKNOWN', profile: 'UNKNOWN' });
  }
}

function validateCheckObject(value, propertyId) {
  const result = snapshotDataObject(value, `${propertyId}.checkResult`);
  const status = requiredField(result, 'status', `${propertyId}.checkResult`);
  const detail = Object.hasOwn(result, 'detail') ? result.detail : null;
  if (!['PASS', 'FAIL', 'UNKNOWN'].includes(status)) {
    throw new TypeError(`${propertyId} returned an invalid check result`);
  }
  if (detail !== null && (typeof detail !== 'string' || detail.length > 1_000)) {
    throw new TypeError(`${propertyId}.detail is invalid`);
  }
  return { status, detail };
}

function normalizeCheck(value, propertyId) {
  if (typeof value === 'boolean') return { status: value ? 'PASS' : 'FAIL', detail: value ? null : `${propertyId} returned false` };
  return validateCheckObject(value, propertyId);
}

function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function buildTrace(targetKey, stateByKey, predecessor) {
  const reversed = [];
  let cursor = targetKey;
  while (cursor !== null) {
    const previous = predecessor.get(cursor) ?? null;
    reversed.push({ actionId: previous?.actionId ?? 'INIT', state: stateByKey.get(cursor) });
    cursor = previous?.fromKey ?? null;
  }
  return Object.freeze(reversed.reverse().map((step, index) => Object.freeze({
    index,
    actionId: step.actionId,
    state: step.state,
  })));
}

function buildTransitionTrace(sourceKey, edge, stateByKey, predecessor) {
  const prefix = [...buildTrace(sourceKey, stateByKey, predecessor)];
  prefix.push(Object.freeze({ index: prefix.length, actionId: edge.actionId, state: stateByKey.get(edge.toKey) }));
  return Object.freeze(prefix);
}

function sortedUniqueTransitions(rawTransitions) {
  const candidates = snapshotArray(rawTransitions, 'enabledTransitions result', { max: MAX_TRANSITIONS_PER_STATE });
  const byIdentity = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = snapshotDataObject(candidates[index], `enabledTransitions result[${index}]`);
    const actionId = requiredField(candidate, 'actionId', `enabledTransitions result[${index}]`);
    if (typeof actionId !== 'string' || !ACTION_ID.test(actionId)) {
      throw new TypeError('transition has an invalid actionId');
    }
    const nextState = cloneFrozenJson(requiredField(candidate, 'nextState', `enabledTransitions result[${index}]`));
    const toKey = canonicalJson(nextState);
    if (toKey.length > MAX_CANONICAL_STATE_CHARS) throw new TypeError(`state exceeds ${MAX_CANONICAL_STATE_CHARS} canonical characters`);
    byIdentity.set(`${actionId}\u0000${toKey}`, Object.freeze({ actionId, nextState, toKey }));
  }
  return [...byIdentity.values()].sort((left, right) => {
    const byAction = compareText(left.actionId, right.actionId);
    return byAction === 0 ? compareText(left.toKey, right.toKey) : byAction;
  });
}

function tarjan(nodes, adjacency) {
  let nextIndex = 0;
  const stack = [];
  const onStack = new Set();
  const indexByNode = new Map();
  const lowByNode = new Map();
  const components = [];

  function visit(node) {
    indexByNode.set(node, nextIndex);
    lowByNode.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    const targets = [...new Set((adjacency.get(node) ?? []).map((edge) => edge.toKey))].sort();
    for (const target of targets) {
      if (!nodes.has(target)) continue;
      if (!indexByNode.has(target)) {
        visit(target);
        lowByNode.set(node, Math.min(lowByNode.get(node), lowByNode.get(target)));
      } else if (onStack.has(target)) {
        lowByNode.set(node, Math.min(lowByNode.get(node), indexByNode.get(target)));
      }
    }

    if (lowByNode.get(node) === indexByNode.get(node)) {
      const component = [];
      let current;
      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== node);
      components.push(component.sort());
    }
  }

  for (const node of [...nodes].sort()) if (!indexByNode.has(node)) visit(node);
  return components.sort((left, right) => compareText(left[0], right[0]));
}

function componentHasCycle(component, adjacency) {
  if (component.length > 1) return true;
  const only = component[0];
  return (adjacency.get(only) ?? []).some((edge) => edge.toKey === only);
}

function nonStutteringEdges(stateKey, adjacency) {
  return (adjacency.get(stateKey) ?? []).filter((edge) => edge.toKey !== stateKey);
}

function componentIsFair(component, obligationAdjacency, actualAdjacency, weakActions) {
  const members = new Set(component);
  const enabledInState = (stateKey, actionId) => (actualAdjacency.get(stateKey) ?? []).some(
    (edge) => edge.actionId === actionId && edge.toKey !== stateKey,
  );
  const internalAction = (actionId) => component.some((stateKey) => (obligationAdjacency.get(stateKey) ?? []).some(
    (edge) => !edge.synthetic && edge.actionId === actionId && edge.toKey !== stateKey && members.has(edge.toKey),
  ));

  for (const actionId of weakActions) {
    if (component.every((stateKey) => enabledInState(stateKey, actionId)) && !internalAction(actionId)) return false;
  }

  const progressContinuouslyEnabled = component.every((stateKey) => nonStutteringEdges(stateKey, actualAdjacency).length > 0);
  const internalProgress = component.some((stateKey) => (obligationAdjacency.get(stateKey) ?? []).some(
    (edge) => !edge.synthetic && edge.toKey !== stateKey && members.has(edge.toKey),
  ));
  return !progressContinuouslyEnabled || internalProgress;
}

function shortestInternalPath(fromKey, toKey, members, adjacency) {
  if (fromKey === toKey) return [];
  const queue = [fromKey];
  const visited = new Set([fromKey]);
  const prior = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    const edges = (adjacency.get(current) ?? [])
      .filter((edge) => members.has(edge.toKey))
      .sort((left, right) => compareText(`${left.actionId}:${left.toKey}`, `${right.actionId}:${right.toKey}`));
    for (const edge of edges) {
      if (visited.has(edge.toKey)) continue;
      visited.add(edge.toKey);
      prior.set(edge.toKey, Object.freeze({ fromKey: current, ...edge }));
      if (edge.toKey === toKey) {
        const reversed = [];
        let cursor = toKey;
        while (cursor !== fromKey) {
          const step = prior.get(cursor);
          reversed.push(step);
          cursor = step.fromKey;
        }
        return reversed.reverse();
      }
      queue.push(edge.toKey);
    }
  }
  throw new TypeError('strongly connected component path was not found');
}

function buildObligationPrefix(targetKey, stateByKey, predecessor, obligationPredecessor, obligationRoot) {
  const root = obligationRoot.get(targetKey);
  const prefix = [...buildTrace(root, stateByKey, predecessor)];
  const reversed = [];
  let cursor = targetKey;
  while (cursor !== root) {
    const step = obligationPredecessor.get(cursor);
    if (step === undefined || step === null) throw new TypeError('obligation predecessor chain is incomplete');
    reversed.push(step);
    cursor = step.fromKey;
  }
  for (const edge of reversed.reverse()) {
    prefix.push(Object.freeze({ index: prefix.length, actionId: edge.actionId, state: stateByKey.get(edge.toKey) }));
  }
  return prefix;
}

function fairLassoTrace(component, start, obligationAdjacency, actualAdjacency, weakActions, stateByKey, predecessor, obligationPredecessor, obligationRoot) {
  const members = new Set(component);
  const prefix = buildObligationPrefix(start, stateByKey, predecessor, obligationPredecessor, obligationRoot);
  const loopStart = prefix.length - 1;
  const walk = [];
  let current = start;
  const appendPath = (path) => {
    for (const edge of path) {
      walk.push(edge);
      current = edge.toKey;
    }
  };

  for (const target of [...component].sort(compareText)) appendPath(shortestInternalPath(current, target, members, obligationAdjacency));

  const requiredEdges = [];
  for (const actionId of weakActions) {
    const continuouslyEnabled = component.every((stateKey) => (actualAdjacency.get(stateKey) ?? []).some(
      (edge) => edge.actionId === actionId && edge.toKey !== stateKey,
    ));
    if (!continuouslyEnabled) continue;
    const candidate = component.flatMap((stateKey) => (obligationAdjacency.get(stateKey) ?? [])
      .filter((edge) => !edge.synthetic && edge.actionId === actionId && edge.toKey !== stateKey && members.has(edge.toKey))
      .map((edge) => Object.freeze({ fromKey: stateKey, ...edge })))
      .sort((left, right) => compareText(`${left.fromKey}:${left.actionId}:${left.toKey}`, `${right.fromKey}:${right.actionId}:${right.toKey}`))[0];
    if (candidate !== undefined) requiredEdges.push(candidate);
  }

  for (const edge of requiredEdges) {
    appendPath(shortestInternalPath(current, edge.fromKey, members, obligationAdjacency));
    walk.push(edge);
    current = edge.toKey;
  }
  appendPath(shortestInternalPath(current, start, members, obligationAdjacency));
  if (walk.length === 0) {
    const stutter = (obligationAdjacency.get(start) ?? []).find((edge) => edge.synthetic && edge.toKey === start);
    if (stutter === undefined) throw new TypeError('fair component has no cycle witness');
    walk.push(Object.freeze({ fromKey: start, ...stutter }));
  }
  for (const edge of walk) {
    prefix.push(Object.freeze({ index: prefix.length, actionId: edge.actionId, state: stateByKey.get(edge.toKey) }));
  }
  return Object.freeze({ loopStart, steps: Object.freeze(prefix) });
}

function maxStatus(statuses) {
  return statuses.reduce((current, next) => (STATUS_ORDER[next] > STATUS_ORDER[current] ? next : current), 'PASS');
}

export function exploreModel(model, options = {}) {
  let configuredBounds;
  try {
    model = captureModel(model);
    const capturedOptions = captureOptions(options);
    const declaredBounds = model.bounds;
    configuredBounds = Object.freeze({
      maxStates: capturedOptions.maxStates ?? declaredBounds.maxStates,
      maxTransitions: capturedOptions.maxTransitions ?? declaredBounds.maxTransitions,
      maxDepth: capturedOptions.maxDepth ?? declaredBounds.maxDepth,
    });
  } catch (error) {
    const identity = safeDiagnosticIdentity(model);
    return cloneFrozenJson({
      schemaVersion: EXPLICIT_STATE_DIAGNOSTIC_SCHEMA,
      checker: EXPLICIT_STATE_CHECKER,
      modelId: identity.modelId,
      modelVersion: identity.modelVersion,
      profile: identity.profile,
      overallStatus: 'UNKNOWN',
      exploration: { status: 'INVALID_MODEL', states: 0, transitions: 0, maxDepthReached: 0, terminalStates: 0, deadlocks: 0, graphFingerprint: null, truncatedReasons: ['MODEL_VALIDATION_FAILED'] },
      properties: [],
      representativeTraces: [],
      limitations: [`${error.name}: ${error.message}`],
    });
  }

  const stateByKey = new Map();
  const depthByKey = new Map();
  const predecessor = new Map();
  const adjacency = new Map();
  const queue = [];
  const truncatedReasons = new Set();
  const limitations = [];
  const actionCoverage = new Map();
  const safetyState = new Map(model.safety.map((entry) => [entry.propertyId, { status: 'PASS', detail: null, trace: null }]));
  let transitionCount = 0;
  let maxDepthReached = 0;

  function recordSafety(property, context, traceFactory) {
    const current = safetyState.get(property.propertyId);
    if (current.status === 'FAIL') return;
    try {
      const checked = normalizeCheck(property.check(context), property.propertyId);
      if (STATUS_ORDER[checked.status] > STATUS_ORDER[current.status]) {
        safetyState.set(property.propertyId, { status: checked.status, detail: checked.detail, trace: traceFactory() });
      }
    } catch (error) {
      safetyState.set(property.propertyId, {
        status: 'UNKNOWN',
        detail: `${error.name}: ${error.message}`,
        trace: traceFactory(),
      });
    }
  }

  try {
    const rawInitial = snapshotArray(model.initialStates(), 'initialStates result', { min: 1, max: 16 });
    const initial = rawInitial.map((state) => cloneFrozenJson(state)).sort((a, b) => compareText(canonicalJson(a), canonicalJson(b)));
    for (const state of initial) {
      const key = canonicalJson(state);
      if (key.length > MAX_CANONICAL_STATE_CHARS) throw new TypeError(`initial state exceeds ${MAX_CANONICAL_STATE_CHARS} canonical characters`);
      if (stateByKey.has(key)) continue;
      if (stateByKey.size >= configuredBounds.maxStates) {
        truncatedReasons.add('MAX_STATES');
        break;
      }
      stateByKey.set(key, state);
      depthByKey.set(key, 0);
      predecessor.set(key, null);
      adjacency.set(key, []);
      queue.push(key);
      for (const property of model.safety) {
        recordSafety(property, { previousState: null, actionId: 'INIT', nextState: state }, () => buildTrace(key, stateByKey, predecessor));
      }
    }

    while (queue.length > 0) {
      const sourceKey = queue.shift();
      const sourceState = stateByKey.get(sourceKey);
      const sourceDepth = depthByKey.get(sourceKey);
      maxDepthReached = Math.max(maxDepthReached, sourceDepth);
      const candidates = sortedUniqueTransitions(model.enabledTransitions(sourceState));
      if (sourceDepth >= configuredBounds.maxDepth && candidates.length > 0) {
        truncatedReasons.add('MAX_DEPTH');
        continue;
      }
      for (const candidate of candidates) {
        if (transitionCount >= configuredBounds.maxTransitions) {
          truncatedReasons.add('MAX_TRANSITIONS');
          break;
        }
        let targetKey = candidate.toKey;
        if (!stateByKey.has(targetKey)) {
          if (stateByKey.size >= configuredBounds.maxStates) {
            truncatedReasons.add('MAX_STATES');
            continue;
          }
          stateByKey.set(targetKey, candidate.nextState);
          depthByKey.set(targetKey, sourceDepth + 1);
          predecessor.set(targetKey, { fromKey: sourceKey, actionId: candidate.actionId });
          adjacency.set(targetKey, []);
          queue.push(targetKey);
        }
        const edge = Object.freeze({ actionId: candidate.actionId, toKey: targetKey });
        adjacency.get(sourceKey).push(edge);
        transitionCount += 1;
        actionCoverage.set(candidate.actionId, (actionCoverage.get(candidate.actionId) ?? 0) + 1);
        for (const property of model.safety) {
          recordSafety(
            property,
            { previousState: sourceState, actionId: candidate.actionId, nextState: stateByKey.get(targetKey) },
            () => buildTransitionTrace(sourceKey, edge, stateByKey, predecessor),
          );
        }
      }
    }
  } catch (error) {
    truncatedReasons.add('EVALUATION_ERROR');
    limitations.push(`${error.name}: ${error.message}`);
  }

  for (const edges of adjacency.values()) edges.sort((a, b) => compareText(`${a.actionId}:${a.toKey}`, `${b.actionId}:${b.toKey}`));

  let terminalKeys = [];
  const representativeByClass = new Map();
  let deadlocks = 0;
  try {
    terminalKeys = [...stateByKey.keys()].filter((key) => model.terminal(stateByKey.get(key))).sort((left, right) => {
      const depthDelta = depthByKey.get(left) - depthByKey.get(right);
      return depthDelta === 0 ? compareText(left, right) : depthDelta;
    });
    for (const key of terminalKeys) {
      const terminalClass = model.terminalClass(stateByKey.get(key));
      if (typeof terminalClass !== 'string' || !ACTION_ID.test(terminalClass)) throw new TypeError('terminalClass must return an ACTION_ID-compatible string for terminal states');
      if (!representativeByClass.has(terminalClass)) {
        representativeByClass.set(terminalClass, Object.freeze({ terminalClass, steps: buildTrace(key, stateByKey, predecessor) }));
      }
    }
    const terminalSet = new Set(terminalKeys);
    deadlocks = [...stateByKey.keys()].filter((key) => (adjacency.get(key) ?? []).length === 0 && !terminalSet.has(key)).length;
  } catch (error) {
    truncatedReasons.add('EVALUATION_ERROR');
    limitations.push(`${error.name}: ${error.message}`);
    terminalKeys = [];
    representativeByClass.clear();
    deadlocks = 0;
  }

  const exhaustive = truncatedReasons.size === 0;
  if (!exhaustive) {
    for (const [propertyId, current] of safetyState) {
      if (current.status === 'PASS') safetyState.set(propertyId, { status: 'UNKNOWN', detail: 'state-space exploration was not exhaustive', trace: null });
    }
  }

  const livenessResults = [];
  for (const property of model.liveness) {
    let result = { status: exhaustive ? 'PASS' : 'UNKNOWN', detail: exhaustive ? null : 'state-space exploration was not exhaustive', trace: null };
    if (exhaustive) {
      try {
        const roots = [...stateByKey.keys()].filter((key) => (
          property.pending(stateByKey.get(key)) && !property.fulfilled(stateByKey.get(key))
        )).sort((left, right) => {
          const depthDelta = depthByKey.get(left) - depthByKey.get(right);
          return depthDelta === 0 ? compareText(left, right) : depthDelta;
        });
        if (roots.length === 0) {
          result = { status: 'UNKNOWN', detail: 'liveness antecedent was not exercised by any reachable outstanding obligation', trace: null };
        } else {
          const obligationDistance = new Map();
          const obligationPredecessor = new Map();
          const obligationRoot = new Map();
          const frontier = [];
          for (const root of roots) {
            const distance = depthByKey.get(root);
            if (!obligationDistance.has(root) || distance < obligationDistance.get(root)) {
              obligationDistance.set(root, distance);
              obligationPredecessor.set(root, null);
              obligationRoot.set(root, root);
              frontier.push(root);
            }
          }
          while (frontier.length > 0) {
            frontier.sort((left, right) => {
              const distanceDelta = obligationDistance.get(left) - obligationDistance.get(right);
              return distanceDelta === 0 ? compareText(left, right) : distanceDelta;
            });
            const sourceKey = frontier.shift();
            const nextDistance = obligationDistance.get(sourceKey) + 1;
            for (const edge of adjacency.get(sourceKey) ?? []) {
              if (property.fulfilled(stateByKey.get(edge.toKey))) continue;
              const currentDistance = obligationDistance.get(edge.toKey);
              if (currentDistance !== undefined && currentDistance <= nextDistance) continue;
              obligationDistance.set(edge.toKey, nextDistance);
              obligationPredecessor.set(edge.toKey, Object.freeze({ fromKey: sourceKey, ...edge }));
              obligationRoot.set(edge.toKey, obligationRoot.get(sourceKey));
              frontier.push(edge.toKey);
            }
          }

          const obligationNodes = new Set(obligationDistance.keys());
          const obligationAdjacency = new Map();
          for (const key of obligationNodes) {
            const edges = (adjacency.get(key) ?? []).filter((edge) => obligationNodes.has(edge.toKey));
            obligationAdjacency.set(key, Object.freeze([
              ...edges,
              Object.freeze({ actionId: 'STUTTER', toKey: key, synthetic: true }),
            ]));
          }
          const components = tarjan(obligationNodes, obligationAdjacency)
            .filter((component) => componentHasCycle(component, obligationAdjacency))
            .filter((component) => componentIsFair(component, obligationAdjacency, adjacency, property.weakFairActions))
            .sort((left, right) => {
              const leftDistance = Math.min(...left.map((key) => obligationDistance.get(key)));
              const rightDistance = Math.min(...right.map((key) => obligationDistance.get(key)));
              return leftDistance === rightDistance ? compareText(left[0], right[0]) : leftDistance - rightDistance;
            });
          if (components.length > 0) {
            const violating = components[0];
            const start = [...violating].sort((left, right) => {
              const distanceDelta = obligationDistance.get(left) - obligationDistance.get(right);
              return distanceDelta === 0 ? compareText(left, right) : distanceDelta;
            })[0];
            result = {
              status: 'FAIL',
              detail: 'a fair infinite behavior preserves an outstanding obligation without discharge',
              trace: fairLassoTrace(
                violating,
                start,
                obligationAdjacency,
                adjacency,
                property.weakFairActions,
                stateByKey,
                predecessor,
                obligationPredecessor,
                obligationRoot,
              ),
            };
          }
        }
      } catch (error) {
        result = { status: 'UNKNOWN', detail: `${error.name}: ${error.message}`, trace: null };
      }
    }
    livenessResults.push(Object.freeze({ propertyId: property.propertyId, kind: 'LIVENESS', ...result }));
  }

  const safetyResults = model.safety.map((property) => Object.freeze({
    propertyId: property.propertyId,
    kind: 'SAFETY',
    ...safetyState.get(property.propertyId),
  }));

  const graphMaterial = [
    ...[...stateByKey.keys()].sort().map((key) => `S:${key}`),
    ...[...adjacency.entries()].flatMap(([fromKey, edges]) => edges.map((edge) => `E:${fromKey}:${edge.actionId}:${edge.toKey}`)).sort(),
  ].join('\n');
  const allProperties = [...safetyResults, ...livenessResults];
  const overallStatus = maxStatus(allProperties.map((property) => property.status));
  return cloneFrozenJson({
    schemaVersion: EXPLICIT_STATE_REPORT_SCHEMA,
    checker: EXPLICIT_STATE_CHECKER,
    modelId: model.modelId,
    modelVersion: model.modelVersion,
    profile: model.profile ?? 'CANONICAL',
    authority: model.authority,
    assumptions: model.assumptions,
    declaredBounds: model.bounds,
    executedBounds: configuredBounds,
    overallStatus,
    exploration: {
      status: exhaustive ? 'EXHAUSTIVE' : 'TRUNCATED',
      states: stateByKey.size,
      transitions: transitionCount,
      maxDepthReached,
      terminalStates: terminalKeys.length,
      deadlocks,
      graphFingerprint: fnv1a64(graphMaterial),
      truncatedReasons: [...truncatedReasons].sort(),
      actionCoverage: [...actionCoverage.entries()].sort(([left], [right]) => compareText(left, right)).map(([actionId, count]) => ({ actionId, count })),
    },
    properties: allProperties,
    representativeTraces: [...representativeByClass.values()].sort((left, right) => compareText(left.terminalClass, right.terminalClass)),
    limitations,
  });
}

export function runModels(models, options = {}) {
  const capturedModels = snapshotArray(models, 'models', { min: 1, max: 32 });
  return Object.freeze(capturedModels
    .map((model) => exploreModel(model, options))
    .sort((left, right) => compareText(left.modelId, right.modelId)));
}
