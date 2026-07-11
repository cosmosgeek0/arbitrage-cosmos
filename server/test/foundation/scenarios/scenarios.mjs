#!/usr/bin/env node
/**
 * Wave 3 deterministic scenario proof. No network, timers, wall clock, or
 * ambient randomness. Run after `npm run build -w server`:
 *   node server/test/foundation/scenarios/scenarios.mjs
 */
import {
  MAX_SCENARIO_FACTS,
  MAX_SCENARIO_FUTURE_OFFSET_MS,
  SCENARIO_AUTHORITY,
  SCENARIO_EXECUTION_AUTHORITY,
  SCENARIO_FACT_KINDS,
  SCENARIO_GENERATOR_VERSION,
  SCENARIO_KINDS,
  SCENARIO_PRNG_ALGORITHM,
  SCENARIO_SCHEMA,
  SCENARIO_SCHEMA_VERSION,
  compareScenarioFacts,
  createScenarioPrng,
  generateScenario,
  generateScenarioCatalog,
  scenarioToReplayInputs,
  serializeScenario,
  xorshift32Step,
} from '../../../dist/foundation/scenarios/index.js';
import {
  canonicalJson,
  evaluateFreshness,
  findSecretLikePaths,
  findSerializabilityIssues,
  validateSourcedTimestamp,
} from '../../../dist/foundation/contracts/index.js';
import { createReplayEvent } from '../../../dist/foundation/replay/index.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) { console.log(`\n${title}`); }

const T0 = 1_800_000_000_000;
const INPUT = Object.freeze({ seed: 0x1234abcd, baseTimeMs: T0, symbol: 'TESTUSDT' });
const scenario = (kind, over = {}) => generateScenario({ kind, ...INPUT, ...over });
const byKind = (bundle, kind) => bundle.facts.filter((fact) => fact.kind === kind);
const mid = (fact) => (fact.payload.bid + fact.payload.ask) / 2;

function isDeepFrozen(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => isDeepFrozen(child, seen));
}

let networkAttempts = 0;
let randomAttempts = 0;
const realFetch = globalThis.fetch;
const realDateNow = Date.now;
const realRandom = Math.random;
globalThis.fetch = async () => { networkAttempts += 1; throw new Error('network forbidden'); };
Date.now = () => { throw new Error('wall clock forbidden'); };
Math.random = () => { randomAttempts += 1; throw new Error('ambient randomness forbidden'); };

try {
  section('1. Fixed versioned catalog and fact invariants');
  const catalog = generateScenarioCatalog(INPUT);
  check('catalog contains exactly the fourteen directive scenarios', catalog.length === 14);
  check('catalog order is the frozen directive order', catalog.map((item) => item.kind).join('|') === SCENARIO_KINDS.join('|'));
  check('scenario IDs are unique', new Set(catalog.map((item) => item.scenarioId)).size === catalog.length);
  check('catalog and every bundle are deeply frozen', Object.isFrozen(catalog) && catalog.every((item) => isDeepFrozen(item)));
  check('schema and generator versions are explicit', catalog.every((item) =>
    item.schema === SCENARIO_SCHEMA &&
    item.schemaVersion === SCENARIO_SCHEMA_VERSION &&
    item.generatorVersion === SCENARIO_GENERATOR_VERSION &&
    item.prngAlgorithm === SCENARIO_PRNG_ALGORITHM
  ));
  check('all output is synthetic and has no execution authority', catalog.every((item) =>
    item.authority === SCENARIO_AUTHORITY &&
    item.executionAuthority === SCENARIO_EXECUTION_AUTHORITY &&
    item.facts.every((fact) => fact.timestamp.authority === 'SYNTHETIC_TEST')
  ));
  check('every scenario has a bounded non-empty fact stream', catalog.every((item) => item.facts.length > 0 && item.facts.length <= MAX_SCENARIO_FACTS));
  check('every fact uses the frozen fact vocabulary', catalog.every((item) => item.facts.every((fact) => SCENARIO_FACT_KINDS.includes(fact.kind))));
  check('no scenario emits strategy decisions or scores', catalog.every((item) => item.facts.every((fact) =>
    !/DECISION|SIGNAL|VERDICT|SCORE/.test(fact.kind) &&
    !Object.hasOwn(fact.payload, 'score') &&
    !Object.hasOwn(fact.payload, 'allowed')
  )));
  check('fact sequences are contiguous and IDs unique', catalog.every((item) =>
    item.facts.every((fact, index) => fact.sequence === index + 1) &&
    new Set(item.facts.map((fact) => fact.eventId)).size === item.facts.length
  ));
  check('fact order is stable receipt order', catalog.every((item) =>
    item.facts.every((fact, index) => index === 0 || fact.timestamp.receivedAtMs >= item.facts[index - 1].timestamp.receivedAtMs)
  ));
  check('all fact timestamps satisfy the shared structural contract', catalog.every((item) =>
    item.facts.every((fact) => validateSourcedTimestamp(fact.timestamp).length === 0)
  ));
  check('all facts retain source identity and one scenario correlation', catalog.every((item) =>
    item.facts.every((fact) => fact.timestamp.sourceId.startsWith('scenario.') && fact.correlationId === item.facts[0].correlationId)
  ));
  check('catalog is canonical plain data with no secret-like fixture keys', findSerializabilityIssues(catalog).length === 0 && findSecretLikePaths(catalog).length === 0);

  section('2. Seed, time, identity, and canonical byte determinism');
  {
    const request = { kind: 'SPOT_LEADS_PERP', ...INPUT };
    const before = JSON.stringify(request);
    const first = generateScenario(request);
    const second = generateScenario({ ...request });
    check('same semantic request produces byte-identical output', serializeScenario(first) === serializeScenario(second));
    check('serialization uses the canonical foundation kernel', serializeScenario(first) === canonicalJson(first));
    check('generator does not mutate its request', JSON.stringify(request) === before);
    const otherSeed = generateScenario({ ...request, seed: request.seed + 1 });
    check('different seed changes stable identity and output', otherSeed.scenarioId !== first.scenarioId && serializeScenario(otherSeed) !== serializeScenario(first));
    const shifted = generateScenario({ ...request, baseTimeMs: request.baseTimeMs + 10_000 });
    check('injected base time shifts every fact without a clock read', shifted.facts.every((fact, index) =>
      fact.timestamp.sourceTimeMs - first.facts[index].timestamp.sourceTimeMs === 10_000 &&
      fact.timestamp.receivedAtMs - first.facts[index].timestamp.receivedAtMs === 10_000
    ));
    check('base-time change also changes stable scenario/event IDs', shifted.scenarioId !== first.scenarioId && shifted.facts[0].eventId !== first.facts[0].eventId);
  }

  section('3. Explicit XORSHIFT32_V1 sequence and bounds');
  {
    const expected = [270369, 67634689, 2647435461, 307599695, 2398689233];
    const actual = [];
    let state = 1;
    for (let index = 0; index < expected.length; index += 1) {
      state = xorshift32Step(state);
      actual.push(state);
    }
    check('seed 1 matches the frozen xorshift32 vector', actual.join('|') === expected.join('|'), actual.join('|'));
    const rng = createScenarioPrng(123);
    const units = Array.from({ length: 100 }, () => rng.nextUnitInterval());
    check('unit interval samples stay in [0,1)', units.every((value) => value >= 0 && value < 1));
    const ints = Array.from({ length: 200 }, () => rng.nextIntInclusive(-3, 4));
    check('bounded integers stay within inclusive limits', ints.every((value) => Number.isInteger(value) && value >= -3 && value <= 4));
    check('PRNG exposes only the explicit algorithm/seed/state', rng.algorithm === 'XORSHIFT32_V1' && rng.initialSeed === 123 && Number.isInteger(rng.state()));
  }

  section('4. Market lead/lag, gap, funding, and freshness scenarios');
  {
    const spotLead = scenario('SPOT_LEADS_PERP');
    check('spot lead updates spot before perpetual', spotLead.facts[2].kind === 'SPOT_BOOK' && spotLead.facts[3].kind === 'PERP_BOOK');
    check('spot lead opens then closes the temporary lead', mid(spotLead.facts[2]) > mid(spotLead.facts[1]) && Math.abs(mid(spotLead.facts[3]) - mid(spotLead.facts[2])) < 0.05);

    const perpLead = scenario('PERP_LEADS_SPOT');
    check('perpetual lead updates perpetual before spot', perpLead.facts[2].kind === 'PERP_BOOK' && perpLead.facts[3].kind === 'SPOT_BOOK');
    check('perpetual lead is later matched by spot', mid(perpLead.facts[2]) < mid(perpLead.facts[0]) && Math.abs(mid(perpLead.facts[3]) - mid(perpLead.facts[2])) < 0.05);

    const gap = scenario('GAP_WIDENS_THEN_CLOSES');
    const gapPerp = byKind(gap, 'PERP_BOOK').map(mid);
    const spot = mid(byKind(gap, 'SPOT_BOOK')[0]);
    check('gap widens monotonically before close', gapPerp[1] - spot > gapPerp[0] - spot && gapPerp[2] - spot > gapPerp[1] - spot);
    check('final gap closes below its first gap', Math.abs(gapPerp[3] - spot) < Math.abs(gapPerp[0] - spot));

    const funding = scenario('FUNDING_CONSUMES_EDGE');
    const fundingFact = byKind(funding, 'FUNDING_CONTEXT')[0];
    check('funding scenario has visible cross-venue premium', mid(byKind(funding, 'PERP_BOOK')[0]) > mid(byKind(funding, 'SPOT_BOOK')[0]));
    check('funding fact is adverse and explicitly timed', fundingFact.payload.fundingRate < 0 && fundingFact.payload.nextFundingAtMs > fundingFact.timestamp.sourceTimeMs);

    const stale = scenario('STALE_SPOT_FRESH_FUTURES');
    const evaluationAt = stale.facts.at(-1).timestamp.receivedAtMs;
    const spotFreshness = evaluateFreshness(byKind(stale, 'SPOT_BOOK')[0].timestamp, evaluationAt);
    const perpFreshness = evaluateFreshness(byKind(stale, 'PERP_BOOK').at(-1).timestamp, evaluationAt);
    check('spot is stale at the final scenario horizon', spotFreshness.state === 'STALE');
    check('futures remains fresh at the same horizon', perpFreshness.state === 'FRESH');
  }

  section('5. Ordering, volume, print, socket, and proposal scenarios');
  {
    const outOfOrder = scenario('OUT_OF_ORDER_FRAME');
    check('receipt order is increasing while source time regresses',
      outOfOrder.facts[0].timestamp.receivedAtMs < outOfOrder.facts[1].timestamp.receivedAtMs &&
      outOfOrder.facts[0].timestamp.sourceTimeMs > outOfOrder.facts[1].timestamp.sourceTimeMs
    );

    const wakeup = scenario('DEAD_VOLUME_WAKEUP');
    const windows = byKind(wakeup, 'VOLUME_WINDOW');
    check('dead volume starts with two explicit zero windows', windows[0].payload.tradeCount === 0 && windows[1].payload.quoteVolume === 0);
    check('volume wakeup becomes sustained positive activity', windows.slice(2).length === 2 && windows.slice(2).every((item) => item.payload.tradeCount > 0 && item.payload.quoteVolume > 0));

    const spike = scenario('ONE_PRINT_SPIKE');
    const prints = byKind(spike, 'SPOT_TRADE');
    check('one print spikes above the surrounding tape', prints[1].payload.price > prints[0].payload.price * 1.05);
    check('next print normalizes near the pre-spike level', Math.abs(prints[2].payload.price - prints[0].payload.price) < 0.05);
    check('spike quantity is isolated and smaller', prints[1].payload.quantity < prints[0].payload.quantity && prints[1].payload.quantity < prints[2].payload.quantity);

    const silent = scenario('OPEN_BUT_SILENT_SOCKET');
    const states = byKind(silent, 'SOURCE_STATE');
    check('socket remains OPEN while message state becomes SILENT', states[1].payload.connectionState === 'OPEN' && states[1].payload.messageState === 'SILENT');
    check('silent state preserves the real last-message time', states[1].payload.lastMessageAtMs === states[0].payload.lastMessageAtMs && states[1].timestamp.receivedAtMs > states[1].payload.lastMessageAtMs);

    const expiry = scenario('PROPOSAL_EXPIRY');
    const proposals = byKind(expiry, 'PROPOSAL_STATE');
    check('proposal identity remains stable across expiry', proposals[0].payload.proposalId === proposals[1].payload.proposalId);
    check('expiry occurs exactly at declared expiry', proposals[0].payload.lifecycle === 'OPEN' && proposals[1].payload.lifecycle === 'EXPIRED' && proposals[1].timestamp.sourceTimeMs === proposals[1].payload.expiresAtMs);
  }

  section('6. Control, execution, clock, and capture scenarios');
  {
    const killed = scenario('KILL_SWITCH_DURING_TWO_LEG_PLAN');
    check('first leg fills before kill switch', killed.facts[0].kind === 'EXECUTION_LEG_STATE' && killed.facts[0].payload.outcome === 'FILLED' && killed.facts[1].kind === 'KILL_SWITCH_STATE');
    check('kill switch blocks second leg without submission', killed.facts[1].payload.enabled === true && killed.facts[2].payload.outcome === 'BLOCKED' && killed.facts[2].payload.submittedQuantity === 0);
    check('blocked second leg carries named cause', killed.facts[2].payload.failureCode === 'KILL_SWITCH_ON');

    const rejected = scenario('PARTIAL_FILL_SECOND_LEG_REJECT');
    const legs = byKind(rejected, 'EXECUTION_LEG_STATE');
    check('first leg retains exact partial quantity', legs[0].payload.outcome === 'PARTIALLY_FILLED' && legs[0].payload.cumulativeFilledQuantity === 0.4);
    check('second leg rejection is explicit and unfilled', legs[1].payload.outcome === 'REJECTED' && legs[1].payload.cumulativeFilledQuantity === 0 && legs[1].payload.failureCode === 'SECOND_LEG_REJECTED');
    check('execution facts carry deterministic distinct client IDs', legs[0].payload.clientOrderId !== legs[1].payload.clientOrderId);

    const drift = scenario('CLOCK_DRIFT');
    const drifted = byKind(drift, 'CLOCK_SAMPLE')[0];
    check('clock sample carries explicit positive drift', drifted.timestamp.sourceTimeMs - drifted.timestamp.receivedAtMs === drifted.payload.offsetMs && drifted.payload.offsetMs === 7_000);
    check('shared freshness law detects the clock skew', evaluateFreshness(drifted.timestamp, drifted.timestamp.receivedAtMs).state === 'CLOCK_SKEWED');

    const truncation = scenario('CAPTURE_TRUNCATION');
    const capture = byKind(truncation, 'CAPTURE_STATE')[0];
    check('capture truncation counts reconcile', capture.payload.observedCount === capture.payload.retainedCount + capture.payload.droppedCount);
    check('capture retains newest three and drops oldest two', capture.payload.retainedSequences.join('|') === '3|4|5' && capture.payload.droppedSequences.join('|') === '1|2');
    check('capture truncation is explicitly PARTIAL', capture.timestamp.completeness === 'PARTIAL');
  }

  section('7. Replay composition seam and stable merging');
  {
    const bundle = scenario('OUT_OF_ORDER_FRAME');
    const inputs = scenarioToReplayInputs(bundle);
    check('replay projection has one input per fact and is frozen', inputs.length === bundle.facts.length && Object.isFrozen(inputs) && inputs.every(Object.isFrozen));
    check('replay projection preserves exact timestamps/payloads', inputs.every((input, index) => input.timestamp === bundle.facts[index].timestamp && input.payload === bundle.facts[index].payload));
    const replayed = inputs.map((input) => createReplayEvent(input, 'PRE_TRIGGER', T0 + 20_000));
    check('every projected fact is accepted by Lane G', replayed.every((result) => result.ok));
    check('replay identity matches scenario event identity', replayed.every((result, index) => result.ok && result.value.eventId === bundle.facts[index].eventId));

    const combined = [scenario('PERP_LEADS_SPOT').facts[0], scenario('SPOT_LEADS_PERP').facts[0]];
    const sortedA = [...combined].sort(compareScenarioFacts).map((fact) => fact.eventId);
    const sortedB = [...combined].reverse().sort(compareScenarioFacts).map((fact) => fact.eventId);
    check('multi-bundle fact merge is input-order independent', sortedA.join('|') === sortedB.join('|'));
  }

  section('8. Malformed input and resource bounds fail closed');
  {
    for (const badSeed of [0, -1, 1.5, 0x1_0000_0000, Number.NaN]) {
      check(`rejects invalid seed ${String(badSeed)}`, (() => {
        try { scenario('SPOT_LEADS_PERP', { seed: badSeed }); return false; }
        catch (error) { return error instanceof TypeError; }
      })());
    }
    check('rejects unknown scenario kind', (() => {
      try { scenario('NOT_A_SCENARIO'); return false; }
      catch (error) { return error instanceof TypeError; }
    })());
    check('rejects lowercase/malformed symbol', (() => {
      try { scenario('SPOT_LEADS_PERP', { symbol: 'bad/usdt' }); return false; }
      catch (error) { return error instanceof TypeError; }
    })());
    check('rejects base time without bounded future room', (() => {
      try { scenario('FUNDING_CONSUMES_EDGE', { baseTimeMs: 4_102_444_800_000 - MAX_SCENARIO_FUTURE_OFFSET_MS + 1 }); return false; }
      catch (error) { return error instanceof TypeError; }
    })());
    check('rejects unknown request fields', (() => {
      try { generateScenario({ kind: 'SPOT_LEADS_PERP', ...INPUT, extra: true }); return false; }
      catch (error) { return error instanceof TypeError; }
    })());
    let getterCalls = 0;
    const getterInput = { seed: INPUT.seed, baseTimeMs: T0, symbol: INPUT.symbol };
    Object.defineProperty(getterInput, 'kind', { enumerable: true, get() { getterCalls += 1; return 'SPOT_LEADS_PERP'; } });
    check('accessor-bearing request is rejected without invoking getter', (() => {
      try { generateScenario(getterInput); return false; }
      catch (error) { return error instanceof TypeError && getterCalls === 0; }
    })());
    check('PRNG rejects zero absorbing state', (() => {
      try { xorshift32Step(0); return false; }
      catch (error) { return error instanceof TypeError; }
    })());
    check('PRNG rejects inverted integer bounds', (() => {
      try { createScenarioPrng(1).nextIntInclusive(2, 1); return false; }
      catch (error) { return error instanceof TypeError; }
    })());
    const malformed = { ...scenario('SPOT_LEADS_PERP'), schemaVersion: 999 };
    check('serializer rejects unsupported scenario schema', (() => {
      try { serializeScenario(malformed); return false; }
      catch (error) { return error instanceof TypeError; }
    })());

    const forgedPrivate = structuredClone(scenario('SPOT_LEADS_PERP'));
    forgedPrivate.facts[0].timestamp.authority = 'LIVE_PRIVATE';
    check('serializer rejects forged private-authority facts', (() => {
      try { serializeScenario(forgedPrivate); return false; }
      catch (error) { return error instanceof TypeError; }
    })());

    const forgedSecret = structuredClone(scenario('SPOT_LEADS_PERP'));
    forgedSecret.facts[0].payload.apiKey = 'forbidden-fixture';
    check('replay projection rejects secret-bearing forged payloads', (() => {
      try { scenarioToReplayInputs(forgedSecret); return false; }
      catch (error) { return error instanceof TypeError; }
    })());

    const forgedIdentity = structuredClone(scenario('SPOT_LEADS_PERP'));
    forgedIdentity.scenarioId = 'scn_forged';
    check('serializer rejects scenario identity not bound to its inputs', (() => {
      try { serializeScenario(forgedIdentity); return false; }
      catch (error) { return error instanceof TypeError; }
    })());

    const sideProperty = structuredClone(scenario('SPOT_LEADS_PERP'));
    sideProperty.facts.apiKey = 'forbidden-fixture';
    check('fact arrays reject named side-properties', (() => {
      try { serializeScenario(sideProperty); return false; }
      catch (error) { return error instanceof TypeError; }
    })());

    let factGetterCalls = 0;
    const accessorBundle = structuredClone(scenario('SPOT_LEADS_PERP'));
    Object.defineProperty(accessorBundle.facts[0], 'payload', {
      enumerable: true,
      get() { factGetterCalls += 1; return {}; },
    });
    check('fact accessors are rejected without invocation', (() => {
      try { serializeScenario(accessorBundle); return false; }
      catch (error) { return error instanceof TypeError && factGetterCalls === 0; }
    })());
  }

  section('9. Safety boundary');
  check('no network request was attempted', networkAttempts === 0, `${networkAttempts} attempts`);
  check('no ambient random request was attempted', randomAttempts === 0, `${randomAttempts} attempts`);
} finally {
  globalThis.fetch = realFetch;
  Date.now = realDateNow;
  Math.random = realRandom;
}

const passed = results.filter((item) => item.pass).length;
console.log(`\n${passed}/${results.length} scenario checks passed`);
if (passed !== results.length) process.exit(1);
