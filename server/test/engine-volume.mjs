#!/usr/bin/env node
/**
 * Volume/wakeup engine — synthetic proof suite (TASK_VOLUME_OVERDRIVE.md Phase 3).
 * ZERO network: everything runs on ManualClock + scripted tapes.
 * Run: node server/test/engine-volume.mjs   (after npm run build)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VolumeEngine,
  ProposalStore,
  MemoryEventSink,
  VolumeSnapshots,
  VolumeFeatureEngine,
  SyntheticReplayRunner,
  ManualClock,
  volumeConfig,
  seededRng,
  quietTape,
  burstTape,
  steadyBooks,
  mapAggTrade,
  miniTickerDelta,
  FOCUS_HISTORICAL_EXIT_REASON_MAP,
  OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
  VOLUME_HISTORICAL_REJECT_CODE_MAP,
  VOLUME_REJECT_CODES,
  projectVolumeRejectDisposition,
} from '../dist/engine/volume/index.js';
import { VolumeRuntime } from '../dist/services/volumeRuntime.js';
import {
  canonicalJson,
  deriveCanonicalProposalId,
  derivePlanId,
  deriveRiskVerdict,
  deriveSourceProposalId,
  stableHash128Hex,
} from '../dist/foundation/contracts/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let passCount = 0;
let failCount = 0;

function check(name, pass, detail = '') {
  if (pass) passCount++;
  else failCount++;
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n— ${title}`);
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

function blockedFoundationVerdict(evaluatedAt, correlationId, ttlMs = 1_000) {
  return deriveRiskVerdict({
    correlationId,
    evaluatedAt,
    ttlMs,
    checks: [{
      code: 'VALIDATE_ONLY_REVIEW_REQUIRED',
      status: 'FAIL',
      blocking: true,
      detail: 'synthetic Foundation owner proof',
      observed: 'REVIEW_REQUIRED',
      limit: 'PASS',
      evidenceTimestamp: evaluatedAt,
    }],
  });
}

function riskAttachment(cut, verdict, overrides = {}) {
  const sourceRecordId = deriveSourceProposalId({ source: 'VOLUME', engineKey: cut.proposalId });
  const canonicalProposalId = deriveCanonicalProposalId({
    source: 'VOLUME',
    sourceRecordId,
    symbol: cut.symbol,
  });
  return {
    expectedProposalId: cut.proposalId,
    expectedProposalRevision: cut.proposalRevision,
    expectedProposalDigest: cut.proposalDigest,
    expectedConfigurationRevision: cut.configurationRevision,
    expectedCorrelationId: cut.correlationId,
    canonicalProposalId,
    planId: derivePlanId({ canonicalProposalId, attempt: 0 }),
    riskIntentDigest: `riskint_${'a'.repeat(32)}`,
    verdict,
    verdictDigest: `riskv_${stableHash128Hex(`foundationRiskVerdict|${canonicalJson(verdict)}`)}`,
    ...overrides,
  };
}

// ---------- shared scenario plumbing ----------

const SYM = 'WAKEUSDT';
const PRICE = 0.05;
const TEST_CFG = {
  baselineMinSamples: 30,
  baselineWindowMinutes: 60,
  tickMs: 1000,
  minFocusDwellMs: 4000,
  verificationGraceMs: 3000,
  cooldownMs: 60_000,
};

const TEST_SYMBOLS = [
  SYM,
  'AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT', 'PINUSDT',
  'E1USDT', 'E2USDT', 'E3USDT', 'E4USDT', 'E5USDT',
];

const symbolMeta = (symbol) => ({
  symbol,
  base: symbol.slice(0, -4),
  quote: 'USDT',
  hasSpot: true,
  hasPerp: false,
  marginBorrowable: null,
  minNotionalUsd: 5,
  tickSize: 0.00001,
  stepSize: 0.1,
  quoteVolume24hUsd: 5_000_000,
  eligible: true,
  ineligibleReason: null,
});

function mkWorld(cfg = {}) {
  const clock = new ManualClock(0);
  const engine = new VolumeEngine(clock, { ...TEST_CFG, ...cfg });
  const runner = new SyntheticReplayRunner(engine, clock);
  engine.start();
  engine.setUniverse(TEST_SYMBOLS.map(symbolMeta));
  return { clock, engine, runner };
}

/** 35 quiet minutes → trusted "dead" baseline (~300 USD/min, 4 trades/min). */
function warmup(runner, rand, opts = {}) {
  const minutes = opts.minutes ?? 35;
  const symbols = opts.symbols ?? [SYM];
  const bookMinutes = opts.bookMinutes ?? minutes;
  const script = symbols.map((symbol) => ({
    symbol,
    trades: quietTape({ startMs: 0, minutes, quotePerMin: 300, tradesPerMin: 4, price: PRICE, rand }),
    books: steadyBooks({
      startMs: 0,
      durationMs: bookMinutes * 60_000,
      everyMs: 5_000,
      mid: PRICE,
      spreadBps: 4,
      qty: opts.bookQty ?? 1_000_000,
    }),
  }));
  runner.play(script, minutes * 60_000, { tickMs: 30_000, tickOnEvent: false });
}

function cleanBurst(rand, opts = {}) {
  return burstTape({
    startMs: opts.startMs ?? 0,
    durationMs: opts.durationMs ?? 15_000,
    quotePerSec: opts.quotePerSec ?? 2_000,
    tradesPerSec: opts.tradesPerSec ?? 20,
    startPrice: opts.startPrice ?? PRICE,
    totalMovePct: opts.totalMovePct ?? 1.2,
    takerBuyRatio: opts.takerBuyRatio ?? 0.85,
    rand,
    uniformQty: opts.uniformQty,
    alternateSides: opts.alternateSides,
  });
}

function burstBooks(opts = {}) {
  return steadyBooks({
    startMs: opts.startMs ?? 0,
    durationMs: opts.durationMs ?? 20_000,
    everyMs: 500,
    mid: opts.mid ?? PRICE,
    spreadBps: opts.spreadBps ?? 4,
    qty: opts.qty ?? 1_000_000,
  });
}

const hasReject = (engine, code) =>
  engine.decisions(2000).some((d) => d.kind === 'reject' && d.rejectCode === code);
const rejectWithDetail = (engine, code, detail) =>
  engine.decisions(2000).find(
    (d) => d.kind === 'reject' && d.rejectCode === code && d.evidence?.detailCode === detail,
  );

// ================================================================
section('1. dead symbol wakes from low baseline ⇒ candidate');
{
  const rand = seededRng(11);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  const snap = engine.featureSnapshot(SYM);
  check('baseline ready after warmup', snap.baselineReady === true, `samples=${snap.baseline.samples}`);
  check('symbol classified dead vs own history', snap.baseline.isDead === true, `median/min=${snap.baseline.quotePerMinMedian.toFixed(1)}`);
  runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand, { quotePerSec: 250, tradesPerSec: 4, durationMs: 2_500, totalMovePct: 0.05 }), books: burstBooks({ durationMs: 2_500 }) }],
    2_500,
  );
  check('state is WATCHING (candidate)', engine.focusMgr.stateOf(SYM) === 'WATCHING', engine.focusMgr.stateOf(SYM));
  check('candidate_opened ledgered', engine.memSink.byKind('candidate_opened').length >= 1);
  check('no focus yet', engine.memSink.byKind('focus_opened').length === 0);
  check('no proposal from a mere flicker', engine.proposalStore.all().length === 0);
}

// ================================================================
section('2. sustained volume + trade-count activation ⇒ focus → proposal');
{
  const rand = seededRng(22);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  check('focus_opened ledgered', engine.memSink.byKind('focus_opened').length === 1);
  const proposals = engine.proposalStore.all();
  check('exactly one proposal created', proposals.length === 1);
  const p = proposals[0];
  check('proposal direction long (taker-buy pressure)', p?.direction === 'long', p?.direction);
  check('proposal open/updated', p?.status === 'open' || p?.status === 'updated', p?.status);
  check('confidence in (0,1]', typeof p?.confidence === 'number' && p.confidence > 0 && p.confidence <= 1, `c=${p?.confidence?.toFixed(3)}`);
  const decisiveCut = engine.featureSnapshot(SYM);
  check('proposal metrics equal one exact owner feature cut',
    p?.featureObservedAtMs === decisiveCut?.ts
      && p?.baselineVolume === decisiveCut?.baseline.quotePerMinMedian
      && p?.currentVolume1m === decisiveCut?.windows['60s']?.quoteVolume
      && p?.tradeCountMultiple === decisiveCut?.tradeCountMultiple['5s']);
  check('proposal carries monotonic revision, content digest, config revision, and machine expiry',
    p?.proposalRevision >= 1
      && /^vprop_[0-9a-f]{64}$/.test(p?.proposalDigest ?? '')
      && /^vcfg_[0-9a-f]{64}$/.test(p?.configurationRevision ?? '')
      && p?.expiresAtMs === p?.createdTs + engine.cfg.proposalTtlMs);
  const proposalDecision = [...engine.decisions(2_000)].reverse()
    .find((decision) => decision.kind === 'proposal');
  let crossCutRejected = false;
  let crossTimeRejected = false;
  let futureCutRejected = false;
  try {
    engine.proposalStore.upsertFromDecision(proposalDecision, { ...decisiveCut, symbol: 'OTHERUSDT' });
  } catch { crossCutRejected = true; }
  try {
    engine.proposalStore.upsertFromDecision(proposalDecision, { ...decisiveCut, ts: decisiveCut.ts - 1 });
  } catch { crossTimeRejected = true; }
  try {
    engine.proposalStore.upsertFromDecision(
      { ...proposalDecision, ts: runner.clock.now() + 1 },
      { ...decisiveCut, ts: runner.clock.now() + 1 },
    );
  } catch { futureCutRejected = true; }
  check('cross-symbol, cross-time, or future decision/feature cuts are refused',
    proposalDecision !== undefined && crossCutRejected && crossTimeRejected && futureCutRejected);
  let decisionGetterReads = 0;
  const accessorEvidence = { ...proposalDecision.evidence };
  Object.defineProperty(accessorEvidence, 'direction', {
    enumerable: true,
    get() {
      decisionGetterReads += 1;
      return decisionGetterReads === 1 ? 'long' : 'short';
    },
  });
  let accessorDecisionRejected = false;
  try {
    engine.proposalStore.upsertFromDecision(
      { ...proposalDecision, evidence: accessorEvidence },
      decisiveCut,
    );
  } catch { accessorDecisionRejected = true; }
  let decisionProxyTraps = 0;
  const proxiedDecision = new Proxy({ ...proposalDecision }, {
    get() { decisionProxyTraps += 1; throw new Error('decision proxy getter must not run'); },
    getPrototypeOf() { decisionProxyTraps += 1; throw new Error('decision proxy prototype trap must not run'); },
    ownKeys() { decisionProxyTraps += 1; throw new Error('decision proxy key trap must not run'); },
    getOwnPropertyDescriptor() { decisionProxyTraps += 1; throw new Error('decision descriptor trap must not run'); },
  });
  let proxyDecisionRejected = false;
  try { engine.proposalStore.upsertFromDecision(proxiedDecision, decisiveCut); } catch { proxyDecisionRejected = true; }
  const revokedDecision = Proxy.revocable({ ...proposalDecision }, {});
  revokedDecision.revoke();
  let revokedDecisionRejected = false;
  try { engine.proposalStore.upsertFromDecision(revokedDecision.proxy, decisiveCut); } catch { revokedDecisionRejected = true; }
  let prototypeTraps = 0;
  const prototypePayload = new Proxy({ direction: 'long' }, {
    get() { prototypeTraps += 1; throw new Error('evidence prototype getter must not run'); },
    getPrototypeOf() { prototypeTraps += 1; throw new Error('evidence prototype trap must not run'); },
  });
  const prototypeEvidence = { confidence: 0.5 };
  Object.defineProperty(prototypeEvidence, '__proto__', {
    enumerable: true,
    value: prototypePayload,
  });
  let prototypeDecisionRejected = false;
  try {
    engine.proposalStore.upsertFromDecision(
      { ...proposalDecision, evidence: prototypeEvidence },
      decisiveCut,
    );
  } catch { prototypeDecisionRejected = true; }
  let inheritedDirectionReads = 0;
  let inheritedDirectionRejected = false;
  const previousDirectionDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'direction');
  try {
    Object.defineProperty(Object.prototype, 'direction', {
      configurable: true,
      get() {
        inheritedDirectionReads += 1;
        return 'long';
      },
    });
    const evidenceWithoutDirection = { ...proposalDecision.evidence };
    delete evidenceWithoutDirection.direction;
    try {
      engine.proposalStore.upsertFromDecision(
        { ...proposalDecision, evidence: evidenceWithoutDirection },
        decisiveCut,
      );
    } catch { inheritedDirectionRejected = true; }
  } finally {
    if (previousDirectionDescriptor === undefined) delete Object.prototype.direction;
    else Object.defineProperty(Object.prototype, 'direction', previousDirectionDescriptor);
  }
  let inheritedDirectionValueRejected = false;
  try {
    Object.defineProperty(Object.prototype, 'direction', {
      configurable: true,
      value: 'long',
    });
    const evidenceWithoutDirection = { ...proposalDecision.evidence };
    delete evidenceWithoutDirection.direction;
    try {
      engine.proposalStore.upsertFromDecision(
        { ...proposalDecision, evidence: evidenceWithoutDirection },
        decisiveCut,
      );
    } catch { inheritedDirectionValueRejected = true; }
  } finally {
    if (previousDirectionDescriptor === undefined) delete Object.prototype.direction;
    else Object.defineProperty(Object.prototype, 'direction', previousDirectionDescriptor);
  }
  let featureProxyTraps = 0;
  const proxiedFeature = new Proxy(decisiveCut, {
    get() { featureProxyTraps += 1; throw new Error('feature proxy getter must not run'); },
    getPrototypeOf() { featureProxyTraps += 1; throw new Error('feature proxy prototype trap must not run'); },
    ownKeys() { featureProxyTraps += 1; throw new Error('feature proxy key trap must not run'); },
    getOwnPropertyDescriptor() { featureProxyTraps += 1; throw new Error('feature descriptor trap must not run'); },
  });
  let proxyFeatureRejected = false;
  try { engine.proposalStore.upsertFromDecision(proposalDecision, proxiedFeature); } catch { proxyFeatureRejected = true; }
  const revokedFeature = Proxy.revocable(decisiveCut, {});
  revokedFeature.revoke();
  let revokedFeatureRejected = false;
  try { engine.proposalStore.upsertFromDecision(proposalDecision, revokedFeature.proxy); } catch { revokedFeatureRejected = true; }
  let featureGetterReads = 0;
  const accessorBaseline = { ...decisiveCut.baseline };
  Object.defineProperty(accessorBaseline, 'quotePerMinMedian', {
    enumerable: true,
    get() { featureGetterReads += 1; throw new Error('feature getter must not run'); },
  });
  let accessorFeatureRejected = false;
  try {
    engine.proposalStore.upsertFromDecision(
      proposalDecision,
      { ...decisiveCut, baseline: accessorBaseline },
    );
  } catch { accessorFeatureRejected = true; }
  check('proposal decision and feature boundaries invoke no caller code before fail-closed rejection',
    accessorDecisionRejected
      && proxyDecisionRejected
      && revokedDecisionRejected
      && prototypeDecisionRejected
      && inheritedDirectionRejected
      && inheritedDirectionValueRejected
      && proxyFeatureRejected
      && revokedFeatureRejected
      && accessorFeatureRejected
      && decisionGetterReads === 0
      && decisionProxyTraps === 0
      && prototypeTraps === 0
      && inheritedDirectionReads === 0
      && featureProxyTraps === 0
      && featureGetterReads === 0
      && engine.proposalStore.byId(p.id)?.proposalDigest === p.proposalDigest,
    `decisionGetters=${decisionGetterReads}, decisionTraps=${decisionProxyTraps}, prototypeTraps=${prototypeTraps}, inheritedDirectionReads=${inheritedDirectionReads}, featureTraps=${featureProxyTraps}, featureGetters=${featureGetterReads}`);
  check('proposal starts with no fabricated risk result', p?.riskResult === null);
  const firstCut = engine.readProposalRiskCut(p.id);
  const firstVerdict = blockedFoundationVerdict(runner.clock.now(), firstCut.correlationId);
  const firstAttachment = riskAttachment(firstCut, firstVerdict);
  const otherSourceRecordId = deriveSourceProposalId({ source: 'VOLUME', engineKey: 'other-volume-proposal' });
  const otherCanonicalProposalId = deriveCanonicalProposalId({
    source: 'VOLUME',
    sourceRecordId: otherSourceRecordId,
    symbol: firstCut.symbol,
  });
  check('wrong revision, digest, config, or correlation cannot attach',
    engine.recordFoundationRiskResult({ ...firstAttachment, expectedProposalRevision: firstCut.proposalRevision + 1 }) === false
      && engine.recordFoundationRiskResult({ ...firstAttachment, expectedProposalDigest: 'vprop_wrong' }) === false
      && engine.recordFoundationRiskResult({ ...firstAttachment, expectedConfigurationRevision: 'vcfg_wrong' }) === false
      && engine.recordFoundationRiskResult({ ...firstAttachment, expectedCorrelationId: 'wrong-correlation' }) === false);
  check('canonical proposal, plan, and risk-intent identities are exact and closed',
    engine.recordFoundationRiskResult({
      ...firstAttachment,
      canonicalProposalId: otherCanonicalProposalId,
    }) === false
      && engine.recordFoundationRiskResult({
        ...firstAttachment,
        planId: derivePlanId({ canonicalProposalId: firstAttachment.canonicalProposalId, attempt: 1 }),
      }) === false
      && engine.recordFoundationRiskResult({
        ...firstAttachment,
        riskIntentDigest: 'riskint_wrong',
      }) === false);
  let attachmentGetterReads = 0;
  const accessorAttachment = { ...firstAttachment };
  Object.defineProperty(accessorAttachment, 'canonicalProposalId', {
    enumerable: true,
    get() {
      attachmentGetterReads += 1;
      return attachmentGetterReads < 3 ? firstAttachment.canonicalProposalId : 'cprop_deadbeefdeadbeef';
    },
  });
  let attachmentProxyTraps = 0;
  const proxiedAttachment = new Proxy(firstAttachment, {
    get() { attachmentProxyTraps += 1; throw new Error('attachment proxy getter must not run'); },
    getPrototypeOf() { attachmentProxyTraps += 1; throw new Error('attachment proxy prototype trap must not run'); },
    ownKeys() { attachmentProxyTraps += 1; throw new Error('attachment proxy key trap must not run'); },
    getOwnPropertyDescriptor() { attachmentProxyTraps += 1; throw new Error('attachment descriptor trap must not run'); },
  });
  let verdictProxyTraps = 0;
  const proxiedVerdict = new Proxy(firstVerdict, {
    get() { verdictProxyTraps += 1; throw new Error('verdict proxy getter must not run'); },
    getPrototypeOf() { verdictProxyTraps += 1; throw new Error('verdict proxy prototype trap must not run'); },
    ownKeys() { verdictProxyTraps += 1; throw new Error('verdict proxy key trap must not run'); },
    getOwnPropertyDescriptor() { verdictProxyTraps += 1; throw new Error('verdict descriptor trap must not run'); },
  });
  const revokedAttachment = Proxy.revocable(firstAttachment, {});
  revokedAttachment.revoke();
  const revokedVerdict = Proxy.revocable(firstVerdict, {});
  revokedVerdict.revoke();
  const revokedChecks = Proxy.revocable(firstVerdict.checks, {});
  revokedChecks.revoke();
  const revokedCheck = Proxy.revocable(firstVerdict.checks[0], {});
  revokedCheck.revoke();
  let riskArrayProxyTraps = 0;
  const statefulDecisiveChecks = new Proxy(firstVerdict.decisiveInputSnapshot.checks, {
    get() { riskArrayProxyTraps += 1; throw new Error('risk array proxy getter must not run'); },
    getPrototypeOf() { riskArrayProxyTraps += 1; throw new Error('risk array proxy prototype trap must not run'); },
    ownKeys() { riskArrayProxyTraps += 1; throw new Error('risk array proxy key trap must not run'); },
    getOwnPropertyDescriptor() { riskArrayProxyTraps += 1; throw new Error('risk array descriptor trap must not run'); },
  });
  let hostileProxyShapesRejected = false;
  try {
    hostileProxyShapesRejected = engine.recordFoundationRiskResult(revokedAttachment.proxy) === false
      && engine.recordFoundationRiskResult({ ...firstAttachment, verdict: revokedVerdict.proxy }) === false
      && engine.recordFoundationRiskResult({
        ...firstAttachment,
        verdict: { ...firstVerdict, checks: revokedChecks.proxy },
      }) === false
      && engine.recordFoundationRiskResult({
        ...firstAttachment,
        verdict: { ...firstVerdict, checks: [revokedCheck.proxy] },
      }) === false
      && engine.recordFoundationRiskResult({
        ...firstAttachment,
        verdict: {
          ...firstVerdict,
          decisiveInputSnapshot: {
            ...firstVerdict.decisiveInputSnapshot,
            checks: statefulDecisiveChecks,
          },
        },
      }) === false;
  } catch {
    hostileProxyShapesRejected = false;
  }
  let checkGetterReads = 0;
  const accessorCheck = { ...firstVerdict.checks[0] };
  Object.defineProperty(accessorCheck, 'code', {
    enumerable: true,
    get() { checkGetterReads += 1; return 'VALIDATE_ONLY_REVIEW_REQUIRED'; },
  });
  check('risk attachment envelope, verdict, and checks invoke no hostile caller code and store nothing',
    engine.recordFoundationRiskResult(accessorAttachment) === false
      && engine.recordFoundationRiskResult(proxiedAttachment) === false
      && engine.recordFoundationRiskResult({ ...firstAttachment, verdict: proxiedVerdict }) === false
      && engine.recordFoundationRiskResult({
        ...firstAttachment,
        verdict: { ...firstVerdict, checks: [accessorCheck] },
      }) === false
      && hostileProxyShapesRejected
      && attachmentGetterReads === 0
      && attachmentProxyTraps === 0
      && verdictProxyTraps === 0
      && riskArrayProxyTraps === 0
      && checkGetterReads === 0
      && engine.proposalStore.byId(p.id)?.riskResult === null,
    `attachmentGetters=${attachmentGetterReads}, attachmentTraps=${attachmentProxyTraps}, verdictTraps=${verdictProxyTraps}, checkGetters=${checkGetterReads}`);
  const arrayVerdict = [];
  Object.assign(arrayVerdict, firstVerdict);
  const sparseVerdict = {
    allowed: true,
    evaluatedAt: runner.clock.now(),
    expiresAt: runner.clock.now() + 1_000,
    checks: new Array(1),
    blockingCodes: [],
  };
  check('array and sparse-array verdict shapes fail closed before attachment',
    engine.recordFoundationRiskResult(riskAttachment(firstCut, arrayVerdict)) === false
      && engine.recordFoundationRiskResult(riskAttachment(firstCut, sparseVerdict)) === false);
  const mutableExtra = { note: 'before' };
  const extraCheckVerdict = {
    ...firstVerdict,
    checks: [{ ...firstVerdict.checks[0], mutableExtra }],
  };
  const extraCheckRejected = engine.recordFoundationRiskResult(riskAttachment(firstCut, extraCheckVerdict)) === false;
  mutableExtra.note = 'after';
  check('noncanonical RiskCheck keys cannot leak mutable state into stored or serialized truth',
    extraCheckRejected && engine.proposalStore.byId(p.id)?.riskResult === null);
  check('Foundation correlation, decision, size, confirmation, and decisive-input truth are relationally closed',
    engine.recordFoundationRiskResult(riskAttachment(
      firstCut,
      { ...firstVerdict, correlationId: 'wrong-foundation-correlation' },
    )) === false
      && engine.recordFoundationRiskResult(riskAttachment(
        firstCut,
        { ...firstVerdict, decision: 'APPROVED' },
      )) === false
      && engine.recordFoundationRiskResult(riskAttachment(
        firstCut,
        { ...firstVerdict, maxAllowedSize: 1 },
      )) === false
      && engine.recordFoundationRiskResult(riskAttachment(
        firstCut,
        { ...firstVerdict, requiredConfirmation: true },
      )) === false
      && engine.recordFoundationRiskResult(riskAttachment(
        firstCut,
        { ...firstVerdict, decisiveInputSnapshot: { ...firstVerdict.decisiveInputSnapshot, checks: [] } },
      )) === false
      && engine.proposalStore.byId(p.id)?.riskResult === null);
  check('future and already-expired verdicts fail closed',
    engine.recordFoundationRiskResult(riskAttachment(
      firstCut,
      blockedFoundationVerdict(runner.clock.now() + 1, firstCut.correlationId),
    )) === false
      && engine.recordFoundationRiskResult(riskAttachment(
        firstCut,
        { ...firstVerdict, expiresAt: runner.clock.now() },
      )) === false);

  const zeroWorld = mkWorld();
  const zeroDecision = {
    ...proposalDecision,
    correlationId: 'corr-r57-positive-zero',
    ts: 0,
  };
  const zeroFeature = {
    ...decisiveCut,
    ts: 0,
    baseline: { ...decisiveCut.baseline, quotePerMinMedian: 0 },
    windows: {
      ...decisiveCut.windows,
      '60s': { ...decisiveCut.windows['60s'], quoteVolume: 0 },
    },
    tradeCountMultiple: { ...decisiveCut.tradeCountMultiple, '5s': 0 },
  };
  const zeroProposal = zeroWorld.engine.proposalStore.upsertFromDecision(zeroDecision, zeroFeature);
  const zeroProposalDigest = zeroProposal.proposalDigest;
  const zeroProposalEvents = zeroWorld.engine.memSink.all().length;
  const numericProposalEvidenceFields = [
    'accelPctPerMin',
    'baselineConfidence',
    'baselineSamples',
    'burstClusters',
    'confidence',
    'depthScore',
    'depthVsNorm',
    'focusAgeMs',
    'largeTrades60s',
    'm15s',
    'm1s',
    'm5s',
    'maxTradeDominance',
    'move15sPct',
    'move5mPct',
    'priceRangePct',
    'signalAgeMs',
    'spreadBps',
    'takerBuyRatio',
    'tcMult5s',
    'trades5s',
    'vol1sQuote',
    'washScore',
  ];
  const negativeZeroFeatureCuts = [
    { ...zeroFeature, ts: -0 },
    { ...zeroFeature, baseline: { ...zeroFeature.baseline, quotePerMinMedian: -0 } },
    {
      ...zeroFeature,
      windows: {
        ...zeroFeature.windows,
        '60s': { ...zeroFeature.windows['60s'], quoteVolume: -0 },
      },
    },
    { ...zeroFeature, tradeCountMultiple: { ...zeroFeature.tradeCountMultiple, '5s': -0 } },
  ];
  let rejectedNegativeZeroFeatureCuts = 0;
  for (const cut of negativeZeroFeatureCuts) {
    try {
      zeroWorld.engine.proposalStore.upsertFromDecision(zeroDecision, cut);
    } catch {
      rejectedNegativeZeroFeatureCuts += 1;
    }
  }
  let rejectedNegativeZeroEvidenceFields = 0;
  const negativeZeroEvidenceJsonCollisions = numericProposalEvidenceFields.every(
    (field) => JSON.stringify({ [field]: 0 }) === JSON.stringify({ [field]: -0 }),
  );
  for (const field of numericProposalEvidenceFields) {
    try {
      zeroWorld.engine.proposalStore.upsertFromDecision({
        ...zeroDecision,
        evidence: { ...zeroDecision.evidence, [field]: -0 },
      }, zeroFeature);
    } catch {
      rejectedNegativeZeroEvidenceFields += 1;
    }
  }
  let rejectedNegativeZeroDecisionTs = false;
  try {
    zeroWorld.engine.proposalStore.upsertFromDecision(
      { ...zeroDecision, ts: -0 },
      zeroFeature,
    );
  } catch {
    rejectedNegativeZeroDecisionTs = true;
  }
  check('proposal timestamps, metrics, and every numeric evidence field reject -0 before identity or persistence',
    Object.is(zeroProposal.baselineVolume, 0)
      && Object.is(zeroProposal.currentVolume1m, 0)
      && Object.is(zeroProposal.tradeCountMultiple, 0)
      && !Object.is(zeroProposal.baselineVolume, -0)
      && !Object.is(zeroProposal.currentVolume1m, -0)
      && !Object.is(zeroProposal.tradeCountMultiple, -0)
      && rejectedNegativeZeroFeatureCuts === negativeZeroFeatureCuts.length
      && rejectedNegativeZeroDecisionTs
      && rejectedNegativeZeroEvidenceFields === numericProposalEvidenceFields.length
      && negativeZeroEvidenceJsonCollisions
      && zeroWorld.engine.proposalStore.byId(zeroProposal.id)?.proposalDigest === zeroProposalDigest
      && zeroWorld.engine.memSink.all().length === zeroProposalEvents);

  const zeroRiskCheck = {
    code: 'VALIDATE_ONLY_REVIEW_REQUIRED',
    status: 'FAIL',
    blocking: true,
    detail: 'positive-zero canonical identity proof',
    observed: 0,
    limit: 0,
    evidenceTimestamp: 0,
  };
  const zeroCut = zeroWorld.engine.readProposalRiskCut(zeroProposal.id);
  const zeroVerdict = deriveRiskVerdict({
    correlationId: zeroCut.correlationId,
    evaluatedAt: 0,
    ttlMs: 1_000,
    checks: [zeroRiskCheck],
  });
  const zeroAttachment = riskAttachment(zeroCut, zeroVerdict);
  const verdictWithCheck = (patch) => {
    const checkValue = { ...zeroRiskCheck, ...patch };
    return {
      ...zeroVerdict,
      checks: [checkValue],
      decisiveInputSnapshot: {
        ...zeroVerdict.decisiveInputSnapshot,
        checks: [checkValue],
      },
    };
  };
  const negativeZeroVerdicts = [
    { ...zeroVerdict, maxAllowedSize: -0 },
    { ...zeroVerdict, evaluatedAt: -0 },
    {
      ...zeroVerdict,
      decisiveInputSnapshot: { ...zeroVerdict.decisiveInputSnapshot, evaluatedAt: -0 },
    },
    verdictWithCheck({ observed: -0 }),
    verdictWithCheck({ limit: -0 }),
    verdictWithCheck({ evidenceTimestamp: -0 }),
  ];
  const negativeZeroAttachments = negativeZeroVerdicts.map((verdict) => riskAttachment(zeroCut, verdict));
  const plusZeroExpiryAttachment = riskAttachment(zeroCut, { ...zeroVerdict, expiresAt: 0 });
  const negativeZeroExpiryAttachment = riskAttachment(zeroCut, { ...zeroVerdict, expiresAt: -0 });
  const negativeZeroVerdictsRejected = negativeZeroAttachments.every(
    (attachment) => attachment.verdictDigest === zeroAttachment.verdictDigest
      && zeroWorld.engine.recordFoundationRiskResult(attachment) === false,
  ) && plusZeroExpiryAttachment.verdictDigest === negativeZeroExpiryAttachment.verdictDigest
    && zeroWorld.engine.recordFoundationRiskResult(negativeZeroExpiryAttachment) === false;
  const positiveZeroVerdictAttached = zeroWorld.engine.recordFoundationRiskResult(zeroAttachment);
  const storedZeroVerdict = zeroWorld.engine.proposalStore.byId(zeroProposal.id)?.riskResult;
  check('verdict numerics and timestamps accept +0 but reject digest-colliding -0',
    negativeZeroVerdictsRejected
      && positiveZeroVerdictAttached
      && Object.is(storedZeroVerdict?.maxAllowedSize, 0)
      && Object.is(storedZeroVerdict?.evaluatedAt, 0)
      && Object.is(storedZeroVerdict?.decisiveInputSnapshot.evaluatedAt, 0)
      && Object.is(storedZeroVerdict?.checks[0]?.observed, 0)
      && Object.is(storedZeroVerdict?.checks[0]?.limit, 0)
      && Object.is(storedZeroVerdict?.checks[0]?.evidenceTimestamp, 0)
      && !Object.is(storedZeroVerdict?.maxAllowedSize, -0));

  class StatefulClock {
    constructor(values) {
      this.values = values;
      this.reads = 0;
    }
    now() {
      const value = this.values[Math.min(this.reads, this.values.length - 1)];
      this.reads += 1;
      return value;
    }
  }
  const statefulClock = new StatefulClock([0, -0]);
  const statefulSink = new MemoryEventSink();
  const statefulStore = new ProposalStore(volumeConfig(TEST_CFG), statefulClock, statefulSink);
  const statefulProposal = statefulStore.upsertFromDecision({
    ...zeroDecision,
    correlationId: 'corr-r57-stateful-clock-cut',
  }, zeroFeature);
  const statefulEvent = statefulSink.byKind('proposal_created')[0];
  check('proposal creation uses one validated clock cut for timestamp, ID, capacity, and event paths',
    statefulClock.reads === 1
      && Object.is(statefulProposal.createdTs, 0)
      && Object.is(statefulProposal.updatedTs, 0)
      && !Object.is(statefulProposal.createdTs, -0)
      && !Object.is(statefulProposal.updatedTs, -0)
      && Object.is(statefulEvent?.ts, 0)
      && !Object.is(statefulEvent?.ts, -0));

  const invalidProposalClockValues = [-0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY];
  let invalidProposalClockCutsRejected = 0;
  for (const invalidClockValue of invalidProposalClockValues) {
    const emptyClock = new ManualClock(invalidClockValue);
    const emptySink = new MemoryEventSink();
    const emptyStore = new ProposalStore(volumeConfig(TEST_CFG), emptyClock, emptySink);
    let emptyUpsertRejected = false;
    try {
      emptyStore.upsertFromDecision(zeroDecision, zeroFeature);
    } catch {
      emptyUpsertRejected = true;
    }

    const mutationClock = new ManualClock(0);
    const mutationSink = new MemoryEventSink();
    const mutationStore = new ProposalStore(volumeConfig(TEST_CFG), mutationClock, mutationSink);
    const mutationProposal = mutationStore.upsertFromDecision({
      ...zeroDecision,
      correlationId: `corr-r57-invalid-clock-${invalidProposalClockCutsRejected}`,
    }, zeroFeature);
    const mutationCut = mutationStore.readProposalRiskCut(mutationProposal.id);
    const mutationVerdict = deriveRiskVerdict({
      correlationId: mutationCut.correlationId,
      evaluatedAt: 0,
      ttlMs: 1_000,
      checks: [zeroRiskCheck],
    });
    const mutationAttachment = riskAttachment(mutationCut, mutationVerdict);
    const stateBeforeInvalidClock = JSON.stringify(mutationStore.all());
    const eventsBeforeInvalidClock = JSON.stringify(mutationSink.all());
    mutationClock.set(invalidClockValue);
    const rejectsByThrow = (operation) => {
      try {
        operation();
        return false;
      } catch {
        return true;
      }
    };
    const rejectedEveryMutation = [
      () => mutationStore.upsertFromDecision(zeroDecision, zeroFeature),
      () => mutationStore.expireAll('config_changed'),
      () => mutationStore.expireForSymbol(mutationProposal.symbol, 'symbol_blocked'),
      () => mutationStore.reconcileSymbols(new Set()),
      () => mutationStore.refresh(zeroFeature),
      () => mutationStore.intentFor(mutationProposal.id, true, false),
      () => mutationStore.intentFor(mutationProposal.id, false, true),
    ].every(rejectsByThrow)
      && mutationStore.readProposalRiskCut(mutationProposal.id) === null
      && mutationStore.recordFoundationRiskResult(mutationAttachment) === false;
    if (emptyUpsertRejected
        && emptyStore.all().length === 0
        && emptySink.all().length === 0
        && rejectedEveryMutation
        && JSON.stringify(mutationStore.all()) === stateBeforeInvalidClock
        && JSON.stringify(mutationSink.all()) === eventsBeforeInvalidClock) {
      invalidProposalClockCutsRejected += 1;
    }
  }
  check('invalid ProposalStore clocks fail closed across create, expiry, update, terminal, read, and risk paths',
    invalidProposalClockCutsRejected === invalidProposalClockValues.length);

  runner.clock.advance(1);
  const firstAttached = engine.recordFoundationRiskResult(firstAttachment);
  check('canonical Foundation result can attach after evaluation while its exact cut remains current', firstAttached === true
    && engine.proposalStore.byId(p.id)?.riskResult?.owner === 'FOUNDATION_MULTI_LEG_RISK'
    && engine.proposalStore.byId(p.id)?.riskResult?.decision === firstVerdict.decision
    && engine.proposalStore.byId(p.id)?.riskResult?.maxAllowedSize === firstVerdict.maxAllowedSize
    && engine.proposalStore.byId(p.id)?.riskResult?.requiredConfirmation === firstVerdict.requiredConfirmation
    && engine.proposalStore.byId(p.id)?.riskResult?.decisiveInputSnapshot?.checks?.[0]?.code
      === firstVerdict.decisiveInputSnapshot.checks[0].code
    && engine.proposalStore.byId(p.id)?.riskResult?.blockingCodes[0] === 'VALIDATE_ONLY_REVIEW_REQUIRED');
  const riskEventsBeforeReplay = engine.memSink.byKind('risk_rejected').length;
  check('exact Foundation result replay is idempotent',
    engine.recordFoundationRiskResult(firstAttachment) === true
      && engine.memSink.byKind('risk_rejected').length === riskEventsBeforeReplay);

  runner.clock.advance(1);
  engine.tick();
  const refreshed = engine.proposalStore.byId(p.id);
  const refreshedCut = engine.readProposalRiskCut(p.id);
  check('newer feature evidence advances revision/digest and clears prior risk',
    refreshed?.proposalRevision === p.proposalRevision + 1
      && refreshed?.proposalDigest !== p.proposalDigest
      && refreshed?.riskResult === null);
  check('delayed prior-revision verdict cannot relabel the refreshed proposal',
    engine.recordFoundationRiskResult(firstAttachment) === false);
  const currentVerdict = blockedFoundationVerdict(runner.clock.now(), refreshedCut.correlationId);
  const currentAttachment = riskAttachment(refreshedCut, currentVerdict);
  check('a verdict cannot outlive the exact Volume proposal cut',
    engine.recordFoundationRiskResult(riskAttachment(
      refreshedCut,
      { ...currentVerdict, expiresAt: refreshedCut.expiresAtMs + 1 },
    )) === false);
  check('current refreshed cut accepts its own Foundation result',
    engine.recordFoundationRiskResult(currentAttachment) === true);

  const projected = new VolumeSnapshots(engine).proposals()[0];
  const serialized = JSON.parse(JSON.stringify(projected));
  check('proposal serialization preserves exact owner fields and risk binding',
    serialized.proposalRevision === refreshedCut.proposalRevision
      && serialized.proposalDigest === refreshedCut.proposalDigest
      && serialized.configurationRevision === refreshedCut.configurationRevision
      && serialized.baselineVolume === refreshed.baselineVolume
      && serialized.currentVolume1m === refreshed.currentVolume1m
      && serialized.tradeCountMultiple === refreshed.tradeCountMultiple
      && serialized.riskResult?.proposalDigest === refreshedCut.proposalDigest
      && serialized.riskResult?.decision === currentVerdict.decision
      && serialized.riskResult?.decisiveInputSnapshot?.evaluatedAt === currentVerdict.evaluatedAt
      && Object.keys(serialized.riskResult?.checks?.[0] ?? {}).sort().join(',')
        === 'blocking,code,detail,evidenceTimestamp,limit,observed,status'
      && !('rule' in serialized)
      && !('invalidatedBy' in serialized));
  const beforeMutation = JSON.stringify(projected);
  try { projected.evidence.direction = 'mutated'; } catch {}
  try { projected.riskResult.blockingCodes.push('MUTATED'); } catch {}
  try { projected.riskResult.decisiveInputSnapshot.checks.push({}); } catch {}
  check('snapshot projection is deeply frozen and mutation-isolated',
    Object.isFrozen(projected)
      && Object.isFrozen(projected.evidence)
      && Object.isFrozen(projected.riskResult)
      && Object.isFrozen(projected.riskResult.blockingCodes)
      && Object.isFrozen(projected.riskResult.decisiveInputSnapshot)
      && Object.isFrozen(projected.riskResult.decisiveInputSnapshot.checks)
      && JSON.stringify(projected) === beforeMutation);
  check('invalidation metadata present', typeof p?.invalidation === 'string' && p.invalidation.includes('volume multiple'));
  check('state is PROPOSED', engine.focusMgr.stateOf(SYM) === 'PROPOSED', engine.focusMgr.stateOf(SYM));
  check('no automatic order anywhere', engine.memSink.all().every((e) => !/order/.test(e.kind)));

  const sameCut = engine.featureSnapshot(SYM);
  const staleCorrelationReplay = engine.proposalStore.upsertFromDecision(
    { ...proposalDecision, ts: sameCut.ts, correlationId: 'corr-r57-stale-replay' },
    sameCut,
  );
  check('a different correlation cannot supersede an equally old feature cut',
    staleCorrelationReplay.id === refreshed.id
      && engine.proposalStore.byId(refreshed.id)?.riskResult?.verdictDigest === currentAttachment.verdictDigest);

  runner.clock.advance(1);
  const newerCut = engine.featureSnapshot(SYM);
  const replacement = engine.proposalStore.upsertFromDecision(
    { ...proposalDecision, ts: newerCut.ts, correlationId: 'corr-r57-superseding-signal' },
    newerCut,
  );
  const superseded = engine.proposalStore.byId(refreshed.id);
  check('a newer differently correlated signal terminalizes the old proposal before replacement',
    replacement.id !== refreshed.id
      && replacement.correlationId === 'corr-r57-superseding-signal'
      && superseded?.status === 'expired'
      && superseded?.proposalRevision === refreshed.proposalRevision + 1
      && superseded?.proposalDigest !== refreshed.proposalDigest
      && superseded?.riskResult === null
      && engine.memSink.byKind('proposal_expired').some(
        (event) => event.correlationId === refreshed.correlationId
          && event.payload?.invalidatedBy === 'signal_superseded',
      ));

  runner.clock.set(replacement.expiresAtMs);
  const expiredIntent = engine.intentFor(replacement.id);
  check('intent minting terminalizes and refuses a proposal at its machine expiry',
    expiredIntent.ok === false
      && expiredIntent.reason === 'proposal_not_open'
      && engine.proposalStore.byId(replacement.id)?.status === 'expired'
      && engine.readProposalRiskCut(replacement.id) === null);
}

// ================================================================
section('3. one-print fake spike ⇒ reject');
{
  const rand = seededRng(33);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play(
    [{ symbol: SYM, trades: [{ atMs: 0, price: PRICE, qty: 100_000, isBuyerMaker: false }], books: burstBooks({ durationMs: 10_000 }) }],
    10_000,
  );
  check('rejected as one_print_spike', hasReject(engine, 'one_print_spike'));
  check('no proposal from one print', engine.proposalStore.all().length === 0);
  check('symbol cooled down after fake', engine.focusMgr.stateOf(SYM) === 'COOLDOWN', engine.focusMgr.stateOf(SYM));
}

// ================================================================
section('4. volume without price follow-through ⇒ reject');
{
  const rand = seededRng(44);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand, { totalMovePct: 0.02, durationMs: 10_000 }), books: burstBooks() }],
    12_000,
  );
  check('rejected as price_no_followthrough', hasReject(engine, 'price_no_followthrough'));
  check('no proposal without follow-through', engine.proposalStore.all().length === 0);
}

// ================================================================
section('5. already-extended pump ⇒ reject (too late)');
{
  const rand = seededRng(55);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  const prePump = burstTape({
    startMs: 0, durationMs: 180_000, quotePerSec: 30, tradesPerSec: 2,
    startPrice: PRICE, totalMovePct: 4, takerBuyRatio: 0.7, rand,
  });
  const lateBurst = cleanBurst(rand, { startMs: 180_000, startPrice: PRICE * 1.04, totalMovePct: 0.8, durationMs: 10_000 });
  runner.play(
    [{ symbol: SYM, trades: [...prePump, ...lateBurst], books: burstBooks({ durationMs: 195_000, mid: PRICE * 1.02 }) }],
    192_000,
  );
  check('rejected as move_already_extended', hasReject(engine, 'move_already_extended'));
  check('no proposal chasing an extended move', engine.proposalStore.all().length === 0);
}

// ================================================================
section('6. bad spread / thin depth ⇒ reject');
{
  const rand = seededRng(66);
  const wide = mkWorld();
  warmup(wide.runner, rand);
  wide.runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks({ spreadBps: 60 }) }],
    12_000,
  );
  check('wide spread rejected as spread_too_wide', hasReject(wide.engine, 'spread_too_wide'));
  check('no proposal through a 60bps spread', wide.engine.proposalStore.all().length === 0);

  const thin = mkWorld();
  warmup(thin.runner, seededRng(67), { bookQty: 2_000 });
  thin.runner.play(
    [{ symbol: SYM, trades: cleanBurst(seededRng(68)), books: burstBooks({ qty: 2_000 }) }],
    12_000,
  );
  check('thin book rejected as depth_too_thin', hasReject(thin.engine, 'depth_too_thin'));
  check('no proposal into a 100-USD book', thin.engine.proposalStore.all().length === 0);
}

// ================================================================
section('7. baseline missing ⇒ never proposes, named reject');
{
  const rand = seededRng(77);
  const { engine, runner } = mkWorld();
  warmup(runner, rand, { minutes: 10 }); // 10 < baselineMinSamples(30)
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  check('rejected as baseline_missing', hasReject(engine, 'baseline_missing'));
  check('never focused', engine.memSink.byKind('focus_opened').length === 0);
  check('never proposed', engine.proposalStore.all().length === 0);
}

// ================================================================
section('8. focus caps + priority eviction + pinned survives');
{
  const rand = seededRng(88);
  const world = mkWorld({ focusSoftCap: 3, focusHardCap: 5, minFocusDwellMs: 60_000 });
  const { engine, runner } = world;
  const A = 'AAAUSDT', B = 'BBBUSDT', C = 'CCCUSDT', D = 'DDDUSDT', PIN = 'PINUSDT';
  engine.pin(PIN);
  warmup(runner, rand, { symbols: [PIN, A, B, D, C] });
  check('pinned symbol focused via reserve slot', engine.focusMgr.isFocused(PIN));

  const wake = (sym, quotePerSec, tradesPerSec) => ({
    symbol: sym,
    trades: cleanBurst(rand, { quotePerSec, tradesPerSec }),
    books: burstBooks(),
  });
  runner.play([wake(A, 2_000, 20), wake(B, 500, 10), wake(D, 300, 6)], 20_000);
  check('soft cap holds at 3', engine.focusMgr.focusSessions().length === 3, `size=${engine.focusMgr.focusSessions().length}`);
  check('A and B focused, D not (priority too low)',
    engine.focusMgr.isFocused(A) && engine.focusMgr.isFocused(B) && !engine.focusMgr.isFocused(D));
  check('D stays a candidate', engine.focusMgr.stateOf(D) === 'WATCHING', engine.focusMgr.stateOf(D));

  runner.play([wake(C, 4_000, 30)], 8_000);
  check('stronger fresher C admitted by evicting a stale member', engine.focusMgr.isFocused(C));
  const evictions = engine.focusMgr.closedFocusSessions().filter((s) => s.exitReason === 'capacity_evicted');
  check('exactly one stale member (A or B) capacity_evicted',
    evictions.length === 1 && [A, B].includes(evictions[0].symbol), evictions.map((s) => s.symbol).join(','));
  check('pinned symbol survived all evictions', engine.focusMgr.isFocused(PIN));
  check('D never got focus', engine.memSink.byKind('focus_opened').every((e) => e.symbol !== D));

  engine.pin('E1USDT'); engine.pin('E2USDT'); engine.pin('E3USDT'); engine.pin('E4USDT');
  check('hard cap 5 absolute', engine.focusMgr.focusSessions().length === 5, `size=${engine.focusMgr.focusSessions().length}`);
  engine.pin('E5USDT');
  check('pin beyond hard cap with all-pinned focus is refused', !engine.focusMgr.isFocused('E5USDT'));
  check('original pin still there', engine.focusMgr.isFocused(PIN));
}

// ================================================================
section('9. kill switch ⇒ blocked from execution path');
{
  const rand = seededRng(99);
  const armed = mkWorld();
  armed.engine.setKillSwitch(true);
  warmup(armed.runner, rand);
  armed.runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  check('observation still works (focus opened)', armed.engine.memSink.byKind('focus_opened').length === 1);
  check('verified wakeup rejected with kill_switch_on', hasReject(armed.engine, 'kill_switch_on'));
  check('zero proposals under kill switch', armed.engine.proposalStore.all().length === 0);

  const live = mkWorld();
  warmup(live.runner, seededRng(100));
  live.runner.play([{ symbol: SYM, trades: cleanBurst(seededRng(101)), books: burstBooks() }], 16_000);
  const p = live.engine.proposalStore.all()[0];
  check('proposal exists with kill switch off', !!p);
  const ok = live.engine.intentFor(p.id);
  check('intent minted when allowed', ok.ok === true && ok.intent.side === 'BUY' && ok.intent.source === 'proposal');
  check('intent carries suggested notional', ok.ok && approx(ok.intent.notionalUsd, 10));
  live.engine.setKillSwitch(true);
  const blocked = live.engine.intentFor(p.id);
  check('kill switch blocks intent minting', blocked.ok === false && blocked.reason === 'kill_switch_on');
  check('kill switch rejection does not fabricate a Foundation risk result',
    live.engine.proposalStore.byId(p.id)?.riskResult === null);
  check('block ledgered as risk_rejected/kill_switch_on',
    live.engine.memSink.byKind('risk_rejected').some((e) => e.rejectCode === 'kill_switch_on'));
  live.engine.setKillSwitch(false);
  live.engine.setIntakePaused(true);
  const intakeBlocked = live.engine.intentFor(p.id);
  check('paused Volume intake blocks an already-open proposal at the final intent bridge',
    intakeBlocked.ok === false && intakeBlocked.reason === 'intake_paused');
  check('pausing Volume invalidates the pre-existing proposal',
    live.engine.proposalStore.all().find((proposal) => proposal.id === p.id)?.status === 'expired');
  globalThis.__live = live; // reused by case 10
}

// ================================================================
section('10. one signal traceable end-to-end by correlationId');
{
  const { engine } = globalThis.__live;
  const p = engine.proposalStore.all()[0];
  const cid = p.correlationId;
  const chain = engine.memSink.byCorrelation(cid);
  const kinds = new Set(chain.map((e) => e.kind));
  check('candidate_opened in chain', kinds.has('candidate_opened'));
  check('focus_opened in chain', kinds.has('focus_opened'));
  check('strategy decisions in chain', kinds.has('strategy_decision'));
  check('proposal_created in chain', kinds.has('proposal_created'));
  check('risk_rejected (kill switch) in same chain', kinds.has('risk_rejected'));
  check('all decisions for the signal share the id',
    engine.decisions(2000).filter((d) => d.symbol === SYM && d.kind !== 'ignore').every((d) => d.correlationId === cid));
}

// ================================================================
section('11. snapshots return contract-shaped data');
{
  const rand = seededRng(111);
  const { engine, runner } = mkWorld();
  const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures/volume/universe.json'), 'utf8'));
  engine.setUniverse(fixture.symbols);
  warmup(runner, rand);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  const snap = new VolumeSnapshots(engine);
  const st = snap.status();
  check('status shape', st.running === true && st.universeSize === 3 && st.eligibleSize === 2 &&
    typeof st.watching === 'number' && st.focused >= 1 && st.openProposals >= 1 &&
    typeof st.lastTickTs === 'number' && typeof st.heartbeatAgeMs === 'number');
  check('universe passthrough', snap.universe().length === 3 && snap.universe()[2].ineligibleReason === 'quote_volume_below_min');
  const ds = snap.decisions(3);
  check('decisions limit + shape', ds.length <= 3 && ds.every((d) =>
    typeof d.symbol === 'string' && d.strategy === 'volume_spike' &&
    typeof d.correlationId === 'string' && typeof d.evidence === 'object'));
  check('focus session shape', snap.focus().every((f) =>
    typeof f.enteredTs === 'number' && typeof f.score === 'number' && typeof f.pinned === 'boolean'));
  const pr = snap.proposals()[0];
  check('proposal shape', pr && typeof pr.id === 'string' && pr.strategy === 'volume_spike' &&
    ['long', 'short'].includes(pr.direction) && typeof pr.evidence === 'object' && pr.borrowStatus === 'not_needed');
  const evs = snap.events(10);
  check('events limit + shape', evs.length <= 10 && evs.every((e) =>
    typeof e.kind === 'string' && typeof e.ts === 'number' && typeof e.correlationId === 'string'));
  check('per-symbol features exposed', snap.featuresOf(SYM)?.baselineReady === true);
  check('ignore decisions counted, not stored', engine.ignoredCount() > 0 &&
    engine.decisions(2000).every((d) => d.kind !== 'ignore'));
  const vocabulary = snap.rejectVocabulary();
  check('volume_not_abnormal retires to a non-reject ignore outcome',
    VOLUME_HISTORICAL_REJECT_CODE_MAP.volume_not_abnormal.successorOutcome === 'ignore'
      && VOLUME_HISTORICAL_REJECT_CODE_MAP.volume_not_abnormal.successorCode === null);
  check('risk_blocked moves to the canonical risk_rejected event',
    VOLUME_HISTORICAL_REJECT_CODE_MAP.risk_blocked.successorOutcome === 'risk_rejected'
      && VOLUME_HISTORICAL_REJECT_CODE_MAP.risk_blocked.successorCode === null);
  check('retired Volume spellings cannot appear in the detector vocabulary',
    ['volume_not_abnormal', 'risk_blocked'].every((code) => !VOLUME_REJECT_CODES.includes(code)));
  check('snapshot exposes exact Volume vocabulary and historical map',
    JSON.stringify(vocabulary.emitted) === JSON.stringify(VOLUME_REJECT_CODES)
      && vocabulary.historical.volume_not_abnormal.successorOutcome === 'ignore');
  const normalizedReplay = projectVolumeRejectDisposition('volume_not_abnormal');
  check('historical normal-volume replay preserves raw spelling and projects to ignore',
    normalizedReplay.rawCode === 'volume_not_abnormal'
      && normalizedReplay.classification === 'HISTORICAL'
      && normalizedReplay.successorOutcome === 'ignore'
      && normalizedReplay.focusExitReason === 'volume_normalized');
  const riskReplay = projectVolumeRejectDisposition('risk_blocked');
  check('historical risk replay preserves raw spelling and canonical Foundation ownership',
    riskReplay.rawCode === 'risk_blocked'
      && riskReplay.owner === 'FOUNDATION_RISK'
      && riskReplay.successorOutcome === 'risk_rejected'
      && riskReplay.focusExitReason === 'risk_rejected');
  check('unknown historical spelling remains explicit invalid truth',
    projectVolumeRejectDisposition('invented_reject').classification === 'INVALID'
      && projectVolumeRejectDisposition('invented_reject').owner === 'UNRESOLVED'
      && projectVolumeRejectDisposition('invented_reject').successorOutcome === 'INVALID'
      && projectVolumeRejectDisposition(null).rawCode === null);
  check('current engine intake posture stays explicit outside the detector vocabulary',
    projectVolumeRejectDisposition('intake_paused').classification === 'CURRENT_ENGINE'
      && projectVolumeRejectDisposition('intake_paused').successorCode === 'intake_paused'
      && projectVolumeRejectDisposition('intake_paused').owner === 'ENGINE');

  const replayDecision = (world, rejectCode) => ({
    symbol: SYM,
    ts: world.clock.now(),
    strategy: 'volume_spike',
    kind: 'reject',
    rejectCode,
    humanReason: `historical ${rejectCode}`,
    correlationId: `replay-${rejectCode}`,
    evidence: {},
  });
  const normalizedWorld = mkWorld();
  normalizedWorld.engine.focusMgr.promote(
    SYM,
    'volume_activation',
    1,
    'replay-normal-volume',
    normalizedWorld.clock.now(),
  );
  normalizedWorld.engine.focusMgr.noteDecision(
    replayDecision(normalizedWorld, 'volume_not_abnormal'),
    1,
  );
  check('historical normal-volume replay uses non-reject volume_normalized semantics',
    normalizedWorld.engine.focusMgr.closedFocusSessions(1)[0]?.exitReason === 'volume_normalized'
      && normalizedWorld.engine.memSink.byKind('candidate_rejected').length === 0);

  const riskWorld = mkWorld();
  riskWorld.engine.focusMgr.promote(
    SYM,
    'volume_activation',
    1,
    'replay-risk-blocked',
    riskWorld.clock.now(),
  );
  riskWorld.engine.focusMgr.noteDecision(replayDecision(riskWorld, 'risk_blocked'), 1);
  check('historical risk replay closes focus as risk_rejected, never signal_expired',
    riskWorld.engine.focusMgr.closedFocusSessions(1)[0]?.exitReason === 'risk_rejected');

  const candidateWorld = mkWorld();
  candidateWorld.engine.focusMgr.noteDecision({
    ...replayDecision(candidateWorld, null),
    kind: 'watch',
    rejectCode: null,
  }, 1);
  candidateWorld.engine.focusMgr.noteDecision(replayDecision(candidateWorld, 'risk_blocked'), 1);
  check('historical risk candidate rejection retains the raw spelling',
    candidateWorld.engine.memSink.byKind('candidate_rejected').some(
      (event) => event.rejectCode === 'risk_blocked',
    ));
}

// ================================================================
section('12. wash-y uniform tape ⇒ reject (invented signal)');
{
  const rand = seededRng(122);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand, { uniformQty: true, alternateSides: true, totalMovePct: 0.01, durationMs: 10_000 }), books: burstBooks() }],
    12_000,
  );
  const d = rejectWithDetail(engine, 'taker_imbalance_missing', 'wash_uniformity_suspect');
  check('wash tape rejected (mapped to taker_imbalance_missing)', !!d);
  check('washScore evidence attached', typeof d?.evidence?.washScore === 'number' && d.evidence.washScore >= 0.7, `score=${d?.evidence?.washScore?.toFixed(2)}`);
  check('no proposal from wash tape', engine.proposalStore.all().length === 0);
}

// ================================================================
section('13. depth vanishes during spike ⇒ reject (invented signal)');
{
  const rand = seededRng(133);
  const { engine, runner } = mkWorld({ benchmarkDepthUsd: 2_000 });
  warmup(runner, rand); // 50k USD top-of-book norm
  runner.play(
    [{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks({ qty: 60_000 }) }], // depth collapses to 3k
    12_000,
  );
  const d = rejectWithDetail(engine, 'depth_too_thin', 'depth_vanished');
  check('depth collapse rejected with depth_vanished detail', !!d, d ? `vsNorm=${(d.evidence.depthVsNorm * 100).toFixed(0)}%` : '');
  check('no proposal into vanished liquidity', engine.proposalStore.all().length === 0);
}

// ================================================================
section('14. proposal invalidation: volume normalizes ⇒ expired');
{
  const rand = seededRng(144);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  const p = engine.proposalStore.all()[0];
  check('proposal open before silence', p && (p.status === 'open' || p.status === 'updated'));
  runner.play([], 130_000); // dead silence
  check('proposal expired after volume normalized', engine.proposalStore.byId(p.id)?.status === 'expired');
  const exp = engine.memSink.byKind('proposal_expired').find((e) => e.payload?.id === p.id);
  check('expiry ledgered with named invalidation', exp?.payload?.invalidatedBy === 'volume_normalized', exp?.payload?.invalidatedBy);
  check('focus released after normalization', !engine.focusMgr.isFocused(SYM));
}

// ================================================================
section('15. cooldown blocks re-entry, then a real wakeup re-arms cleanly');
{
  const rand = seededRng(155);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play(
    [{ symbol: SYM, trades: [{ atMs: 0, price: PRICE, qty: 100_000, isBuyerMaker: false }], books: burstBooks({ durationMs: 10_000 }) }],
    10_000,
  );
  const firstReject = engine.decisions(2000).find((d) => d.rejectCode === 'one_print_spike');
  check('fake spike rejected first', !!firstReject);
  check('cooldown active', engine.focusMgr.stateOf(SYM) === 'COOLDOWN');
  check('owner summary counts the active cooldown', engine.focusMgr.activeCooldownCount() === 1);
  const proposalsBefore = engine.proposalStore.all().length;
  runner.play([{ symbol: SYM, trades: cleanBurst(rand, { durationMs: 10_000 }), books: burstBooks() }], 12_000);
  check('genuine burst during cooldown still ignored', engine.proposalStore.all().length === proposalsBefore);
  runner.play([], 65_000); // cooldown lapses AND the 60s window drains past the mid-cooldown burst
  check('owner summary excludes elapsed cooldowns', engine.focusMgr.activeCooldownCount() === 0);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  const p = engine.proposalStore.all()[0];
  check('post-cooldown wakeup proposes', !!p);
  check('new signal path gets a NEW correlationId', p && p.correlationId !== firstReject.correlationId);
}

// ================================================================
section('16. rolling window math is exact');
{
  const clock = new ManualClock(0);
  const feats = new VolumeFeatureEngine(volumeConfig({ largeTradeQuoteUsd: 200 }), clock);
  feats.onTrade({ symbol: 'X', price: 100, qty: 1, quoteQty: 100, isBuyerMaker: false, ts: 1_000 });
  feats.onTrade({ symbol: 'X', price: 101, qty: 2, quoteQty: 202, isBuyerMaker: true, ts: 1_500 });
  feats.onTrade({ symbol: 'X', price: 99, qty: 1, quoteQty: 99, isBuyerMaker: false, ts: 2_500 });
  clock.set(2_500);
  const f = feats.snapshotEx('X', 0);
  const w1 = f.windows['1s'];
  const w5 = f.windows['5s'];
  check('1s bucket isolation', approx(w1.quoteVolume, 99) && w1.tradeCount === 1 && approx(w1.avgTradeSize, 99));
  check('5s aggregation', approx(w5.quoteVolume, 401) && w5.tradeCount === 3 && approx(w5.avgTradeSize, 401 / 3));
  check('5s price move open→close', approx(w5.priceMovePct, -1));
  check('taker buy ratio', approx(w5.takerBuyRatio, 199 / 401));
  check('large trade counter', w5.largeTradeCount === 1);
  check('no baseline ⇒ multiples null, not fabricated', f.baselineReady === false && f.volumeMultiple['5s'] === null);
}

// ================================================================
section('17. stale book during burst ⇒ reject');
{
  const rand = seededRng(177);
  const { engine, runner } = mkWorld();
  warmup(runner, rand, { bookMinutes: 34 }); // books stop 1 min before burst
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: [] }], 12_000);
  check('rejected as data_stale', hasReject(engine, 'data_stale'));
  check('no proposal on stale book', engine.proposalStore.all().length === 0);
}

// ================================================================
section('18. robust baseline: one freak minute cannot poison the norm');
{
  const rand = seededRng(188);
  const { engine, runner } = mkWorld();
  const monster = Array.from({ length: 10 }, (_, i) => ({
    atMs: 15 * 60_000 + i * 100, price: PRICE, qty: 1_000_000, isBuyerMaker: false,
  }));
  const script = [{
    symbol: SYM,
    trades: [...quietTape({ startMs: 0, minutes: 35, quotePerMin: 300, tradesPerMin: 4, price: PRICE, rand }), ...monster].sort((a, b) => a.atMs - b.atMs),
    books: steadyBooks({ startMs: 0, durationMs: 35 * 60_000, everyMs: 5_000, mid: PRICE, spreadBps: 4, qty: 1_000_000 }),
  }];
  runner.play(script, 35 * 60_000, { tickMs: 30_000, tickOnEvent: false });
  const b = engine.featureSnapshot(SYM).baseline;
  check('median unmoved by 500k freak minute', b.quotePerMinMedian < 1_000, `median=${b.quotePerMinMedian.toFixed(1)}`);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand, { startMs: 0 }), books: burstBooks() }], 16_000);
  check('detection still fires against the robust norm', engine.proposalStore.all().length === 1);
}

// ================================================================
section('19. adapter mappers (fixture payloads, zero network)');
{
  const agg = mapAggTrade({ e: 'aggTrade', E: 1, s: 'WAKEUSDT', a: 7, p: '0.05', q: '100', f: 10, l: 14, T: 999, m: true });
  check('aggTrade mapping', agg.tick.quoteQty === 5 && agg.tick.isBuyerMaker === true && agg.printCount === 5);
  const prev = { e: '24hrMiniTicker', E: 1000, s: 'WAKEUSDT', c: '0.05', o: '0.05', h: '0.05', l: '0.05', v: '100', q: '1000' };
  const cur = { ...prev, E: 2000, q: '1250' };
  const delta = miniTickerDelta(prev, cur);
  check('miniTicker delta → universe volume tick', delta?.quoteQty === 250 && delta.ts === 2000);
  check('shrinking 24h window never fabricates volume', miniTickerDelta(cur, prev) === null);
}

// ================================================================
section('20. feed boundary rejects unknown, invalid, stale, and out-of-order data');
{
  const clock = new ManualClock(100_000);
  const engine = new VolumeEngine(clock, TEST_CFG);
  engine.setUniverse([symbolMeta('SAFEUSDT')]);
  engine.start();

  check('unknown symbol trade rejected', engine.onTrade({
    symbol: 'UNKNOWNUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 100_000,
  }) === false);
  check('non-finite trade rejected', engine.onTrade({
    symbol: 'SAFEUSDT', price: Number.NaN, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 100_000,
  }) === false);
  check('stale trade rejected', engine.onTrade({
    symbol: 'SAFEUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 1,
  }) === false);
  check('valid trade accepted', engine.onTrade({
    symbol: 'SAFEUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 100_000,
  }) === true);
  check('out-of-order trade rejected', engine.onTrade({
    symbol: 'SAFEUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 99_999,
  }) === false);
  check('crossed book rejected', engine.onBook({
    symbol: 'SAFEUSDT', bid: 10.1, ask: 10, bidQty: 5, askQty: 5, ts: 100_000,
  }) === false);
  check('non-positive depth rejected', engine.onBook({
    symbol: 'SAFEUSDT', bid: 9.9, ask: 10, bidQty: 0, askQty: 5, ts: 100_000,
  }) === false);
  check('valid book accepted', engine.onBook({
    symbol: 'SAFEUSDT', bid: 9.9, ask: 10, bidQty: 5, askQty: 5, ts: 100_000,
  }) === true);
  check('out-of-order book rejected', engine.onBook({
    symbol: 'SAFEUSDT', bid: 9.9, ask: 10, bidQty: 5, askQty: 5, ts: 99_999,
  }) === false);
  check('only accepted trade reached rolling state', approx(engine.featureSnapshot('SAFEUSDT').windows['1s'].quoteVolume, 10));
}

// ================================================================
section('21. universe reconciliation prunes stale symbol state');
{
  const clock = new ManualClock(200_000);
  const engine = new VolumeEngine(clock, TEST_CFG);
  engine.setUniverse([symbolMeta('OLDUSDT')]);
  engine.start();
  engine.onTrade({ symbol: 'OLDUSDT', price: 2, qty: 2, quoteQty: 4, isBuyerMaker: false, ts: 200_000 });
  engine.onBook({ symbol: 'OLDUSDT', bid: 1.99, ask: 2.01, bidQty: 100, askQty: 100, ts: 200_000 });
  check('old symbol initially observed', engine.featureSnapshot('OLDUSDT') !== null);
  engine.setUniverse([symbolMeta('NEWUSDT')]);
  check('removed symbol feature state pruned', engine.featureSnapshot('OLDUSDT') === null);
  check('removed symbol no longer accepts input', engine.onTrade({
    symbol: 'OLDUSDT', price: 2, qty: 2, quoteQty: 4, isBuyerMaker: false, ts: 200_000,
  }) === false);
  check('new universe is authoritative', engine.universe().length === 1 && engine.universe()[0].symbol === 'NEWUSDT');
}

// ================================================================
section('22. lifecycle and proposal persistence are idempotent');
{
  const clock = new ManualClock(300_000);
  const engine = new VolumeEngine(clock, TEST_CFG);
  engine.setUniverse([symbolMeta('IDEMUSDT')]);
  engine.start();
  engine.start();
  check('double start emits one engine_started event', engine.memSink.byKind('engine_started').length === 1);
  engine.onTrade({ symbol: 'IDEMUSDT', price: 5, qty: 2, quoteQty: 10, isBuyerMaker: false, ts: 300_000 });
  engine.onBook({ symbol: 'IDEMUSDT', bid: 4.99, ask: 5.01, bidQty: 100, askQty: 100, ts: 300_000 });
  const feature = engine.featureSnapshot('IDEMUSDT');
  const decision = {
    symbol: 'IDEMUSDT',
    ts: 300_000,
    strategy: 'volume_spike',
    kind: 'proposal',
    rejectCode: null,
    humanReason: 'same verified signal',
    correlationId: 'same-correlation',
    evidence: { direction: 'long', confidence: 0.8 },
  };
  engine.proposalStore.upsertFromDecision(decision, feature);
  engine.proposalStore.upsertFromDecision(decision, feature);
  check('identical proposal persisted exactly once', engine.memSink.byKind('proposal_created').length === 1 &&
    engine.memSink.byKind('proposal_updated').length === 0);

  const initial = engine.proposalStore.all()[0];
  clock.advance(1);
  engine.cfg.suggestedNotionalUsd = 37;
  const newerFeature = engine.featureSnapshot('IDEMUSDT');
  const shortDecision = {
    ...decision,
    ts: newerFeature.ts,
    evidence: { direction: 'short', confidence: 0.9 },
  };
  const directionalRefresh = engine.proposalStore.upsertFromDecision(shortDecision, newerFeature);
  check('same-correlation refresh updates direction, sizing, revision, and digest as one cut',
    directionalRefresh.direction === 'short'
      && directionalRefresh.suggestedNotionalUsd === 37
      && directionalRefresh.proposalRevision === initial.proposalRevision + 1
      && directionalRefresh.proposalDigest !== initial.proposalDigest);
  let invalidDirectionRejected = false;
  try {
    engine.proposalStore.upsertFromDecision({
      ...shortDecision,
      evidence: { direction: 'sideways', confidence: 0.9 },
    }, newerFeature);
  } catch { invalidDirectionRejected = true; }
  check('missing or malformed direction cannot fabricate a long proposal side', invalidDirectionRejected);
  const beforeStaleReplay = engine.proposalStore.byId(directionalRefresh.id);
  clock.advance(engine.cfg.staleMs + 1);
  let staleReplayRejected = false;
  try {
    engine.proposalStore.upsertFromDecision(shortDecision, newerFeature);
  } catch { staleReplayRejected = true; }
  check('an exactly matched but stale decision/feature cut cannot receive a fresh proposal TTL',
    staleReplayRejected
      && engine.proposalStore.byId(directionalRefresh.id)?.proposalDigest === beforeStaleReplay.proposalDigest);
  engine.stop();
  engine.stop();
  check('double stop emits one engine_stopped event', engine.memSink.byKind('engine_stopped').length === 1);
}

// ================================================================
section('22b. advancing production clock keeps decision and feature cuts exact');
{
  const rand = seededRng(222);
  const { engine, runner } = mkWorld();
  warmup(runner, rand);
  runner.play([{ symbol: SYM, trades: cleanBurst(rand), books: burstBooks() }], 16_000);
  const before = engine.proposalStore.openFor(SYM);
  let advancingNow = runner.clock.now();
  const stableNow = runner.clock.now.bind(runner.clock);
  runner.clock.now = () => advancingNow++;
  let tickError = null;
  try { engine.tick(); } catch (error) { tickError = error; }
  runner.clock.now = stableNow;
  runner.clock.set(advancingNow);
  const after = engine.proposalStore.openFor(SYM);
  const lastProposalDecision = [...engine.decisions(2_000)].reverse()
    .find((candidate) => candidate.kind === 'proposal');
  check('mid-tick clock movement cannot split detector time from the exact feature cut',
    before !== undefined
      && tickError === null
      && after?.proposalRevision === before.proposalRevision + 1
      && lastProposalDecision?.ts === after?.featureObservedAtMs);
  engine.stop();
}

// ================================================================
section('23. runtime symbol policy applies immediately without cooldown debt');
{
  const clock = new ManualClock(400_000);
  const engine = new VolumeEngine(clock, { ...TEST_CFG, heartbeatMs: 30_000 });
  engine.setUniverse([symbolMeta('POLICYUSDT')]);
  engine.setSymbolPolicy([], []);
  engine.start();
  engine.onTrade({ symbol: 'POLICYUSDT', price: 10, qty: 1, quoteQty: 10, isBuyerMaker: false, ts: 400_000 });
  engine.onBook({ symbol: 'POLICYUSDT', bid: 9.99, ask: 10.01, bidQty: 100, askQty: 100, ts: 400_000 });
  engine.tick();
  clock.advance(2_000);
  engine.tick();
  check('blocked decision persisted once inside dedupe window',
    engine.memSink.byKind('strategy_decision').filter((event) => event.rejectCode === 'symbol_blocked').length === 1);
  check('policy rejection does not create cooldown', !engine.focusMgr.inCooldown('POLICYUSDT'));
  engine.setSymbolPolicy(['POLICYUSDT'], []);
  clock.advance(1_000);
  engine.tick();
  check('new allowlist takes effect on next tick', !engine.decisions(10).some((decision) =>
    decision.ts === clock.now() && decision.rejectCode === 'symbol_blocked'));
  check('symbol remains free of stale cooldown', engine.focusMgr.stateOf('POLICYUSDT') === 'IDLE');
  engine.setOperatorSymbolBlocked('POLICYUSDT', true);
  engine.setSymbolPolicy(['POLICYUSDT'], []);
  check('strategy-local BLOCK remains stricter than a global allowlist', engine.symbolAllowedByPolicy('POLICYUSDT') === false);
  engine.setOperatorSymbolBlocked('POLICYUSDT', false);
  engine.setSymbolPolicy([], []);
  check('strategy-local ALLOW cannot bypass an empty global allowlist', engine.symbolAllowedByPolicy('POLICYUSDT') === false);
  engine.setSymbolPolicy(['POLICYUSDT'], []);
  const feature = engine.featureSnapshot('POLICYUSDT');
  const proposal = engine.proposalStore.upsertFromDecision({
    symbol: 'POLICYUSDT', ts: clock.now(), strategy: 'volume_spike', kind: 'proposal', rejectCode: null,
    humanReason: 'operator block invalidation proof', correlationId: 'policy-block-correlation',
    evidence: { direction: 'long', confidence: 0.8 },
  }, feature);
  engine.setOperatorSymbolBlocked('POLICYUSDT', true);
  const blockedIntent = engine.intentFor(proposal.id);
  check('BLOCK expires an open proposal before its final intent bridge',
    engine.proposalStore.byId(proposal.id)?.status === 'expired'
      && blockedIntent.ok === false
      && blockedIntent.reason === 'symbol_blocked');
  engine.setOperatorSymbolBlocked('POLICYUSDT', false);
  const resized = engine.proposalStore.upsertFromDecision({
    symbol: 'POLICYUSDT', ts: clock.now(), strategy: 'volume_spike', kind: 'proposal', rejectCode: null,
    humanReason: 'size ceiling invalidation proof', correlationId: 'size-ceiling-correlation',
    evidence: { direction: 'long', confidence: 0.7 },
  }, feature);
  check('downward Volume size ceiling invalidates proposals sized under the prior ceiling',
    engine.setSuggestedNotionalUsd(5) === true
      && engine.proposalStore.byId(resized.id)?.status === 'expired'
      && engine.cfg.suggestedNotionalUsd === 5);
  const thresholdProposal = engine.proposalStore.upsertFromDecision({
    symbol: 'POLICYUSDT', ts: clock.now(), strategy: 'volume_spike', kind: 'proposal', rejectCode: null,
    humanReason: 'threshold invalidation proof', correlationId: 'threshold-correlation',
    evidence: { direction: 'long', confidence: 0.7 },
  }, engine.featureSnapshot('POLICYUSDT'));
  engine.pin('POLICYUSDT');
  check('VOLUME_1S_MULTIPLE mutation expires proposals and clears threshold-derived focus while preserving raw observations',
    engine.setVolume1sMultiple(4) === true
      && engine.proposalStore.byId(thresholdProposal.id)?.status === 'expired'
      && engine.memSink.byKind('proposal_expired').some(
        (event) => event.payload?.id === thresholdProposal.id
          && event.payload?.invalidatedBy === 'config_changed',
      )
      && !engine.focusMgr.isFocused('POLICYUSDT')
      && engine.featureSnapshot('POLICYUSDT') !== null);
}

// ================================================================
section('24. external sink failures are contained');
{
  const clock = new ManualClock(500_000);
  let deliveryAttempts = 0;
  let durableDeliveries = 0;
  const engine = new VolumeEngine(clock, TEST_CFG, {
    emit: () => {
      deliveryAttempts += 1;
      if (deliveryAttempts === 1) return Promise.reject(new Error('synthetic sink failure'));
      durableDeliveries += 1;
      return Promise.resolve();
    },
  });
  const retryableEvent = {
    kind: 'strategy_decision',
    ts: clock.now(),
    symbol: 'SINKUSDT',
    strategy: 'volume_spike',
    correlationId: 'sink-retry-correlation',
    rejectCode: 'data_stale',
    message: 'retry durable delivery',
    payload: { proof: 'RB-01' },
  };
  engine.sink.emit(retryableEvent);
  await Promise.resolve();
  await Promise.resolve();
  engine.sink.emit(retryableEvent);
  await Promise.resolve();
  await Promise.resolve();
  engine.sink.emit(retryableEvent);
  check('memory evidence remains available exactly once',
    engine.memSink.byKind('strategy_decision').filter((event) => event.correlationId === 'sink-retry-correlation').length === 1);
  check('async sink rejection recorded without escaping', engine.sinkFailures() >= 1);
  check('failed async delivery is retried until one durable success',
    deliveryAttempts === 2 && durableDeliveries === 1,
    `attempts=${deliveryAttempts}, durable=${durableDeliveries}`);

  let ledgerAttempts = 0;
  let ledgerCommits = 0;
  const runtime = new VolumeRuntime(
    {
      logEvent: () => {
        ledgerAttempts += 1;
        if (ledgerAttempts === 1) throw new Error('synthetic ledger failure');
        ledgerCommits += 1;
      },
    },
    () => ({
      killSwitch: true,
      maxOrderNotionalUsd: 10,
      minQuoteVolume24h: 3_000_000,
      allowedSymbols: [],
      blockedSymbols: [],
    }),
    () => [],
  );
  try { runtime.persistEvent(retryableEvent); } catch {}
  runtime.persistEvent(retryableEvent);
  runtime.persistEvent(retryableEvent);
  check('runtime ledger dedupe records only committed delivery',
    ledgerAttempts === 2 && ledgerCommits === 1,
    `attempts=${ledgerAttempts}, committed=${ledgerCommits}`);
}

// ================================================================
section('25. live runtime start/stop generations are idempotent (zero network)');
{
  const config = {
    killSwitch: true,
    maxOrderNotionalUsd: 10,
    minQuoteVolume24h: 3_000_000,
    allowedSymbols: [],
    blockedSymbols: [],
  };
  const runtime = new VolumeRuntime(
    { logEvent: () => { throw new Error('synthetic ledger outage'); } },
    () => config,
    () => [],
  );
  const evidenceCuts = [];
  runtime.setEvidenceObserver((cut) => evidenceCuts.push(structuredClone(cut)));
  await Promise.all([runtime.start(), runtime.start()]);
  check('concurrent starts share one live generation', runtime.connectionStatus().running === true);
  check('empty universe opens no sockets', runtime.connectionStatus().streamConnections === 0);
  check('ledger outage is surfaced without stopping runtime', runtime.snapshot().status.ledgerFailures >= 1);
  runtime.stop();
  runtime.stop();
  check('double stop leaves runtime stopped', runtime.connectionStatus().running === false);
  check('one STOPPED evidence fence is published for the first physical generation',
    evidenceCuts.length === 1
      && evidenceCuts[0].kind === 'SOURCE_CLOSED'
      && evidenceCuts[0].generation === 1
      && evidenceCuts[0].revision === 1);
  await runtime.start();
  check('restart creates a fresh live generation', runtime.connectionStatus().running === true);
  runtime.stop();
  check('final stop is clean', runtime.snapshot().status.running === false);
  check('restart publishes a distinct generation fence with a reset per-generation revision',
    evidenceCuts.length === 2
      && evidenceCuts[1].kind === 'SOURCE_CLOSED'
      && evidenceCuts[1].generation === 3
      && evidenceCuts[1].revision === 1);

  const published = [];
  const evidenceRuntime = new VolumeRuntime(
    { logEvent: () => undefined },
    () => config,
    () => [],
  );
  evidenceRuntime.setEvidenceObserver((cut) => published.push(structuredClone(cut)));
  await evidenceRuntime.start();
  evidenceRuntime.eligibleSymbolSet.add('BTCUSDT');
  evidenceRuntime.eligibleBaseBySymbol.set('BTCUSDT', 'BTC');
  evidenceRuntime.engine.setUniverse([symbolMeta('BTCUSDT')]);
  const eventTime = Date.now();
  const rawTrade = (aggregateId, first, last) => ({
    e: 'aggTrade', E: eventTime, s: 'BTCUSDT', a: aggregateId,
    p: '60000', q: '0.01', f: first, l: last, T: eventTime, m: false,
  });
  evidenceRuntime.onTradeMessage(rawTrade(1, 10, 10), evidenceRuntime.generation, evidenceRuntime.streamEpoch);
  evidenceRuntime.onTradeMessage(rawTrade(2, 11, 11), evidenceRuntime.generation, evidenceRuntime.streamEpoch);
  evidenceRuntime.onTradeMessage(rawTrade(3, 14, 14), evidenceRuntime.generation, evidenceRuntime.streamEpoch);
  check('accepted physical trades publish exact raw IDs with UNKNOWN, CONTIGUOUS, then GAP continuity',
    published.length === 3
      && published[0].kind === 'SPOT_AGG_TRADE'
      && published[0].continuity === 'UNKNOWN'
      && published[0].raw.f === 10
      && published[1].continuity === 'CONTIGUOUS'
      && published[1].raw.l === 11
      && published[2].continuity === 'GAP'
      && published[2].revision === 3);
  evidenceRuntime.stop();
  check('physical stop follows trade cuts with one monotonic source-close revision',
    published.length === 4
      && published[3].kind === 'SOURCE_CLOSED'
      && published[3].generation === 1
      && published[3].revision === 4);
}

// ================================================================
section('26. hostile config values are normalized to bounded invariants');
{
  const cfg = volumeConfig({
    maxRawTrades: Number.POSITIVE_INFINITY,
    focusSoftCap: 50_000,
    focusHardCap: 50_000,
    tickMs: -1,
    baselineWindowMinutes: 1_000_000,
    baselineMinSamples: 1_000_000,
    onePrintDominanceRatio: 9,
  });
  check('non-finite override falls back to default', cfg.maxRawTrades === 512);
  check('focus capacity hard bounded', cfg.focusSoftCap === 100 && cfg.focusHardCap === 100);
  check('tick interval has safe floor', cfg.tickMs === 100);
  check('baseline history is bounded and internally consistent',
    cfg.baselineWindowMinutes === 1_440 && cfg.baselineMinSamples === 1_440);
  check('ratio threshold clamped', cfg.onePrintDominanceRatio === 1);
}

// ================================================================
section('27. proposal history has a hard retention cap');
{
  class CountingManualClock extends ManualClock {
    reads = 0;
    now() {
      this.reads += 1;
      return super.now();
    }
  }
  const clock = new CountingManualClock(600_000);
  const engine = new VolumeEngine(clock, TEST_CFG);
  engine.setUniverse([symbolMeta('CAPUSDT')]);
  engine.start();
  engine.onTrade({ symbol: 'CAPUSDT', price: 5, qty: 2, quoteQty: 10, isBuyerMaker: false, ts: 600_000 });
  engine.onBook({ symbol: 'CAPUSDT', bid: 4.99, ask: 5.01, bidQty: 100, askQty: 100, ts: 600_000 });
  const feature = engine.featureSnapshot('CAPUSDT');
  const readsBeforeProposals = clock.reads;
  for (let index = 0; index < 2_005; index++) {
    const symbol = `P${index}USDT`;
    engine.proposalStore.upsertFromDecision({
      symbol,
      ts: 600_000,
      strategy: 'volume_spike',
      kind: 'proposal',
      rejectCode: null,
      humanReason: 'retention proof',
      correlationId: `retention-${index}`,
      evidence: { direction: 'long', confidence: 0.5 },
    }, { ...feature, symbol });
  }
  check('proposal map never exceeds cap', engine.proposalStore.all().length === 2_000);
  check('capacity pruning is explicit in evidence', engine.memSink.byKind('proposal_expired').some((event) =>
    event.payload.invalidatedBy === 'capacity_pruned'));
  check('capacity pruning reuses each upsert clock cut instead of sampling time again',
    clock.reads - readsBeforeProposals === 2_005);
}

// ================================================================
section('28. observed-order focus is owner-bound, bounded, retained, expiring, and restartable');
{
  const observed = (overrides = {}) => ({
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: 'foundation.reconciliation.synthetic-open-orders',
    authority: 'SYNTHETIC_TEST',
    state: 'AVAILABLE',
    observedAtMs: 0,
    validUntilMs: 5_000,
    openSymbols: ['E1USDT'],
    reasonCodes: [],
    ...overrides,
  });
  const unavailable = (overrides = {}) => ({
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: 'foundation.reconciliation.synthetic-open-orders',
    authority: 'UNAVAILABLE',
    state: 'UNAVAILABLE',
    observedAtMs: 100,
    validUntilMs: null,
    openSymbols: null,
    reasonCodes: ['OPEN_ORDER_TRUTH_UNAVAILABLE'],
    ...overrides,
  });

  const { clock, engine } = mkWorld({ focusSoftCap: 1, focusHardCap: 2, focusMaxAgeMs: 1_000 });
  const applied = engine.applyObservedOrderFocus(observed());
  const session = engine.focusMgr.focusSessions().find((focus) => focus.symbol === 'E1USDT');
  check('complete owner cut emits open_order focus with no transport call',
    applied.status === 'APPLIED' && session?.reason === 'open_order'
      && engine.memSink.byKind('focus_opened').some((event) => event.symbol === 'E1USDT'));

  engine.focusMgr.promote('AAAUSDT', 'volume_activation', 10_000, 'score-high', clock.now());
  check('protected open-order focus cannot be score-evicted beyond the soft cap',
    engine.focusMgr.isFocused('E1USDT') && !engine.focusMgr.isFocused('AAAUSDT'));

  clock.set(1_500);
  engine.tick();
  const retained = engine.applyObservedOrderFocus(unavailable());
  check('unavailable truth retains the last current owner cut, never fabricates zero',
    retained.status === 'UNAVAILABLE_RETAINED' && engine.focusMgr.isFocused('E1USDT'));

  const advanced = engine.applyObservedOrderFocus(observed({ observedAtMs: 1_000 }));
  const staleResurrection = engine.applyObservedOrderFocus(observed());
  const conflictingCut = engine.applyObservedOrderFocus(observed({
    observedAtMs: 1_000,
    openSymbols: ['E2USDT'],
  }));
  check('older and same-time conflicting cuts cannot resurrect or replace owner truth',
    advanced.status === 'APPLIED'
      && staleResurrection.status === 'REJECTED_NON_MONOTONIC'
      && conflictingCut.status === 'REJECTED_CONFLICT'
      && engine.focusMgr.observedOpenOrderSymbols().join(',') === 'E1USDT');

  const hostile = engine.applyObservedOrderFocus({ ...observed(), sourceOwner: 'LEGACY_ORDER_SERVICE' });
  check('non-owner snapshots fail closed', hostile.status === 'REJECTED_INVALID'
    && hostile.reasonCodes.includes('OBSERVED_ORDER_FOCUS_OWNER_INVALID'));

  let proxyReads = 0;
  const proxied = new Proxy(observed(), {
    get() { proxyReads += 1; throw new Error('proxy property access must not run'); },
    getOwnPropertyDescriptor() { proxyReads += 1; throw new Error('proxy descriptor trap must not run'); },
    ownKeys() { proxyReads += 1; throw new Error('proxy key trap must not run'); },
    getPrototypeOf() { proxyReads += 1; throw new Error('proxy prototype trap must not run'); },
  });
  const proxyRejected = engine.applyObservedOrderFocus(proxied);
  check('proxy snapshots reject without invoking any caller trap',
    proxyRejected.status === 'REJECTED_INVALID' && proxyReads === 0,
    `traps=${proxyReads}`);

  let getterReads = 0;
  const getterSnapshot = observed();
  Object.defineProperty(getterSnapshot, 'sourceId', {
    enumerable: true,
    get() { getterReads += 1; throw new Error('snapshot getter must not run'); },
  });
  const getterRejected = engine.applyObservedOrderFocus(getterSnapshot);
  check('accessor snapshots reject without invoking getters',
    getterRejected.status === 'REJECTED_INVALID' && getterReads === 0,
    `getters=${getterReads}`);

  let coercions = 0;
  const coercionRejected = engine.applyObservedOrderFocus(observed({
    sourceId: { toString() { coercions += 1; throw new Error('coercion must not run'); } },
  }));
  check('invalid primitive fields reject without toString coercion',
    coercionRejected.status === 'REJECTED_INVALID' && coercions === 0,
    `coercions=${coercions}`);

  const sparseReasons = [];
  sparseReasons.length = 1;
  const sparseRejected = engine.applyObservedOrderFocus(observed({ reasonCodes: sparseReasons }));
  check('sparse arrays fail closed at the exact descriptor boundary',
    sparseRejected.status === 'REJECTED_INVALID'
      && sparseRejected.reasonCodes.includes('OBSERVED_ORDER_FOCUS_REASONS_INVALID'));
  const overlong = engine.applyObservedOrderFocus(observed({ validUntilMs: 400_001 }));
  check('unbounded source leases fail closed', overlong.status === 'REJECTED_INVALID'
    && overlong.reasonCodes.includes('OBSERVED_ORDER_FOCUS_VALID_UNTIL_INVALID'));
  const future = engine.applyObservedOrderFocus(observed({ observedAtMs: 7_000, validUntilMs: 8_000 }));
  check('future-skewed owner cuts fail closed', future.status === 'REJECTED_INVALID'
    && future.reasonCodes.includes('OBSERVED_ORDER_FOCUS_TIME_INVALID'));

  const threeOrders = mkWorld({ focusSoftCap: 1, focusHardCap: 2, focusMaxAgeMs: 1_000 });
  const bounded = threeOrders.engine.applyObservedOrderFocus(observed({
    openSymbols: ['E1USDT', 'E2USDT', 'E3USDT'],
  }));
  check('hard cap stays absolute and overflow is explicit',
    bounded.focusedOpenSymbols.length === 2
      && bounded.unfocusedOpenSymbols.length === 1
      && bounded.unfocusedOpenSymbols[0] === 'E3USDT');

  const evictionWorld = mkWorld({ focusSoftCap: 1, focusHardCap: 2, focusMaxAgeMs: 60_000 });
  evictionWorld.engine.applyObservedOrderFocus(observed());
  evictionWorld.clock.set(100);
  evictionWorld.engine.applyObservedOrderFocus(observed({
    observedAtMs: 100,
    validUntilMs: 5_100,
    openSymbols: [],
  }));
  evictionWorld.engine.focusMgr.promote('AAAUSDT', 'volume_activation', 20, 'post-owner-empty', 100);
  check('newer known-empty truth releases protection for deterministic score eviction',
    !evictionWorld.engine.focusMgr.isFocused('E1USDT')
      && evictionWorld.engine.focusMgr.isFocused('AAAUSDT')
      && evictionWorld.engine.focusMgr.closedFocusSessions().some((focus) =>
        focus.symbol === 'E1USDT' && focus.exitReason === 'capacity_evicted'));

  const scoreWorld = mkWorld({ focusSoftCap: 4, focusHardCap: 4 });
  scoreWorld.engine.focusMgr.promote('AAAUSDT', 'volume_activation', 5, 'score-a', 0);
  scoreWorld.engine.focusMgr.promote('BBBUSDT', 'volume_activation', 15, 'score-b', 0);
  scoreWorld.engine.focusMgr.promote('CCCUSDT', 'volume_activation', 10, 'score-c', 0);
  check('focus score order is deterministic and descending',
    scoreWorld.engine.focusMgr.focusSessions().slice(0, 3).map((focus) => focus.score).join(',') === '15,10,5');

  const restartClock = new ManualClock(2_000);
  const restarted = new VolumeEngine(restartClock, {
    ...TEST_CFG,
    focusSoftCap: 1,
    focusHardCap: 2,
    focusMaxAgeMs: 1_000,
  });
  restarted.start();
  restarted.setUniverse(TEST_SYMBOLS.map(symbolMeta));
  const restored = restarted.applyObservedOrderFocus(observed());
  check('restart reapplication restores current open-order protection',
    restored.status === 'APPLIED' && restarted.focusMgr.isFocused('E1USDT'));

  restartClock.set(3_000);
  const cleared = restarted.applyObservedOrderFocus(observed({
    observedAtMs: 3_000,
    validUntilMs: 8_000,
    openSymbols: [],
  }));
  restartClock.set(3_001);
  restarted.tick();
  check('newer known-empty cut clears protection and permits max-age expiry',
    cleared.status === 'APPLIED'
      && restarted.focusMgr.observedOpenOrderSymbols().length === 0
      && !restarted.focusMgr.isFocused('E1USDT')
      && restarted.focusMgr.closedFocusSessions().some((focus) =>
        focus.symbol === 'E1USDT' && ['volume_normalized', 'max_focus_time'].includes(focus.exitReason)));

  clock.set(5_001);
  engine.tick();
  check('source validity expiry releases protection and closes over-age focus',
    engine.focusMgr.observedOpenOrderSymbols().length === 0
      && !engine.focusMgr.isFocused('E1USDT'));
}

// ================================================================
section('29. historical focus exit labels map explicitly to stable successors');
{
  check('all seven ENGINE.md exit labels have exact successor spellings',
    JSON.stringify(FOCUS_HISTORICAL_EXIT_REASON_MAP) === JSON.stringify({
      'signal expired': 'signal_expired',
      'gap closed': 'gap_closed',
      'volume returned to baseline': 'volume_normalized',
      'spread/depth invalid': 'spread_depth_invalid',
      'risk rejected': 'risk_rejected',
      'max focus time': 'max_focus_time',
      'cooldown started': 'cooldown',
    }));
}

// ================================================================
section('30. focus readbacks are frozen copies, never mutable owner state');
{
  const { clock, engine } = mkWorld({ focusSoftCap: 1, focusHardCap: 2, focusMaxAgeMs: 1_000 });
  engine.focusMgr.noteDecision({
    symbol: 'AAAUSDT',
    ts: clock.now(),
    strategy: 'volume_spike',
    kind: 'watch',
    rejectCode: null,
    humanReason: 'readback isolation candidate',
    correlationId: 'candidate-readback',
    evidence: {},
  }, 7);
  const candidateRows = engine.focusMgr.candidateList();
  const candidate = candidateRows[0];
  const candidateMutationRejected = candidate !== undefined
    && !Reflect.set(candidate, 'score', 1_000_000)
    && !Reflect.set(candidate, 'openedTs', 9_000_000)
    && !Reflect.deleteProperty(candidate, 'correlationId')
    && !Reflect.set(candidateRows, '0', null);
  const candidateAgain = engine.focusMgr.candidateList()[0];
  check('candidate readback is a frozen defensive copy',
    Object.isFrozen(candidateRows)
      && Object.isFrozen(candidate)
      && candidateMutationRejected
      && candidateAgain?.score === 7
      && candidateAgain?.openedTs === 0
      && candidateAgain?.correlationId === 'candidate-readback');

  const applied = engine.applyObservedOrderFocus({
    sourceOwner: OBSERVED_ORDER_FOCUS_SOURCE_OWNER,
    sourceId: 'foundation.reconciliation.synthetic-open-orders',
    authority: 'SYNTHETIC_TEST',
    state: 'AVAILABLE',
    observedAtMs: 0,
    validUntilMs: 5_000,
    openSymbols: ['E1USDT'],
    reasonCodes: [],
  });
  const focusRows = engine.focusMgr.focusSessions();
  const protectedFocus = focusRows.find((focus) => focus.symbol === 'E1USDT');
  const focusMutationRejected = protectedFocus !== undefined
    && !Reflect.set(protectedFocus, 'pinned', false)
    && !Reflect.set(protectedFocus, 'score', -1_000_000)
    && !Reflect.set(protectedFocus, 'enteredTs', 9_000_000)
    && !Reflect.set(protectedFocus, 'reason', 'volume_activation')
    && !Reflect.set(focusRows, '0', null);
  clock.set(100);
  const attemptedEviction = engine.focusMgr.promote(
    'BBBUSDT', 'volume_activation', 1_000_000, 'readback-eviction', clock.now(),
  );
  check('focus readback cannot unpin, rescore, or replace protected internal state',
    applied.status === 'APPLIED'
      && Object.isFrozen(focusRows)
      && Object.isFrozen(protectedFocus)
      && focusMutationRejected
      && !attemptedEviction
      && engine.focusMgr.isFocused('E1USDT')
      && !engine.focusMgr.isFocused('BBBUSDT'));

  clock.set(5_001);
  engine.tick();
  const closedRows = engine.focusMgr.closedFocusSessions();
  const closed = closedRows.find((focus) => focus.symbol === 'E1USDT');
  const closedMutationRejected = closed !== undefined
    && !Reflect.set(closed, 'exitReason', null)
    && !Reflect.set(closed, 'exitedTs', null)
    && !Reflect.set(closed, 'pinned', true)
    && !Reflect.set(closed, 'correlationId', 'forged-history')
    && !Reflect.set(closedRows, '0', null);
  const closedAgain = engine.focusMgr.closedFocusSessions()
    .find((focus) => focus.symbol === 'E1USDT');
  check('closed-session readback cannot rewrite expiry high-water or history',
    Object.isFrozen(closedRows)
      && Object.isFrozen(closed)
      && closedMutationRejected
      && engine.focusMgr.observedOpenOrderSymbols().length === 0
      && !engine.focusMgr.isFocused('E1USDT')
      && closedAgain?.exitReason === 'max_focus_time'
      && closedAgain?.exitedTs === 5_001
      && closedAgain?.correlationId !== 'forged-history');
}

// ---------- summary ----------
console.log(`\n${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exit(1);
