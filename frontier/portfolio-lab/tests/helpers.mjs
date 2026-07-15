const OWNER_REFS = Object.freeze({
  capital: 'fixture://portfolio-lab/owner-output/capital-budget-r1?sha256=b2b000b9dc204aed7615128b9669da3dfab884edf768ff41a03ed9a88c41e3e3',
  risk: 'fixture://portfolio-lab/owner-output/risk-verdict-r1?sha256=c99e707b9c6206d5bd4b53c473cbf9f31961ffd8c8f2ae85fbddb2a975c2f6d9',
  q: 'fixture://portfolio-lab/owner-output/q-cost-stress-r1?sha256=bd5577db50408d41f811d87f8167cc3ba7ebb58c167c4128d08cf490cbfd4887',
  lTwin: 'fixture://portfolio-lab/owner-output/l-twin-state-r1?sha256=2bab3d8b6fe3f358e7e2763ad1577c4417f9029ea0b551cb4d7309195a39c79a',
  lRecovery: 'fixture://portfolio-lab/owner-output/l-recovery-r1?sha256=c9890b01df076fd346aa1fb2039b0dbe63baca7cb9492c0c5fdabb997b779580',
});

const OWNER_CONTRACT_REFS = Object.freeze({
  capital: 'git:f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/capitalFoundation/budgets/types.ts#PortfolioBudgetSnapshot',
  risk: 'git:f0168cb37bd04d21bc90591ab2256770de3b75bc:server/src/foundation/contracts/risk.ts#RiskVerdict',
  q: 'git:02b4eccc8d2ef53b830cafae06e5175715fa6ebb:quant/src/quant_edge/validation/stress.py#CostStressReportV1',
  lTwin: 'git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exchangeTwin/types.ts#TwinScenarioState',
  lRecovery: 'git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exposureRecoveryProjection/types.ts#L12SupervisorSnapshot',
});

function known(atoms) {
  return { state: 'KNOWN', unit: 'USDT_MICRO', atoms: String(atoms), reason: null };
}

function unknown(reason = 'CANONICAL_INPUT_MISSING') {
  return { state: 'UNKNOWN', unit: 'USDT_MICRO', atoms: null, reason };
}

function baseSnapshot() {
  return {
    schema: 'PortfolioSnapshotV1',
    version: 1,
    snapshotId: 'fixture.portfolio-lab.baseline',
    revision: 1,
    asOfMs: 1784160000000,
    receivedAtMs: 1784160000025,
    reportingUnit: 'USDT_MICRO',
    truthState: 'COMPLETE',
    ownerSnapshotRefs: [OWNER_REFS.capital, OWNER_REFS.risk, OWNER_REFS.q, OWNER_REFS.lTwin, OWNER_REFS.lRecovery],
    canonicalOwnerContractRefs: [OWNER_CONTRACT_REFS.capital, OWNER_CONTRACT_REFS.risk, OWNER_CONTRACT_REFS.q, OWNER_CONTRACT_REFS.lTwin, OWNER_CONTRACT_REFS.lRecovery],
    positions: [
      {
        id: 'position.basis.btc', assetId: 'BTC', sectorId: 'MAJOR', venueId: 'BINANCE',
        collateralId: 'USDT', strategyId: 'BASIS', exposure: known('800000000'),
        canonicalOwnerRef: OWNER_CONTRACT_REFS.capital, ownerSnapshotRef: OWNER_REFS.capital, sourceRevision: 'fixture-position-r1',
      },
      {
        id: 'position.volume.alt', assetId: 'ALT', sectorId: 'ALT_L1', venueId: 'BINANCE',
        collateralId: 'USDT', strategyId: 'VOLUME', exposure: known('-200000000'),
        canonicalOwnerRef: OWNER_CONTRACT_REFS.capital, ownerSnapshotRef: OWNER_REFS.capital, sourceRevision: 'fixture-position-r2',
      },
    ],
    proposals: [
      {
        id: 'proposal.basis.eth', assetId: 'ETH', sectorId: 'MAJOR', venueId: 'BINANCE',
        collateralId: 'USDT', strategyId: 'BASIS', exposure: known('150000000'),
        canonicalOwnerRef: OWNER_CONTRACT_REFS.capital, ownerSnapshotRef: OWNER_REFS.capital, sourceRevision: 'fixture-proposal-r1',
      },
    ],
    liabilities: [
      {
        id: 'liability.alt.borrow', assetId: 'ALT', sectorId: 'ALT_L1', venueId: 'BINANCE',
        collateralId: 'USDT', strategyId: 'BASIS', exposure: known('-50000000'),
        canonicalOwnerRef: OWNER_CONTRACT_REFS.lRecovery, ownerSnapshotRef: OWNER_REFS.lRecovery, sourceRevision: 'fixture-liability-r1',
      },
    ],
    collateral: [
      {
        id: 'collateral.usdt', assetId: 'USDT', sectorId: 'STABLECOIN', venueId: 'BINANCE',
        collateralId: 'USDT', strategyId: 'SHARED', exposure: known('1000000000'),
        canonicalOwnerRef: OWNER_CONTRACT_REFS.capital, ownerSnapshotRef: OWNER_REFS.capital, sourceRevision: 'fixture-collateral-r1',
      },
    ],
    venueExposures: [
      {
        id: 'venue.binance.aggregate', venueId: 'BINANCE', exposure: known('1000000000'),
        canonicalOwnerRef: OWNER_CONTRACT_REFS.capital, ownerSnapshotRef: OWNER_REFS.capital, sourceRevision: 'fixture-venue-r1',
      },
    ],
    strategyClusters: [
      { clusterId: 'cluster.convergence', strategyIds: ['BASIS'], factorIds: ['SPOT_PERP', 'USDT_COLLATERAL'], sourceRef: OWNER_REFS.capital },
      { clusterId: 'cluster.attention', strategyIds: ['VOLUME'], factorIds: ['ALT_LIQUIDITY', 'USDT_COLLATERAL'], sourceRef: OWNER_REFS.capital },
    ],
    factorLinks: [
      { leftId: 'BTC', rightId: 'ETH', factorId: 'MAJOR_BETA', dependencePpm: 650000, sourceRef: OWNER_REFS.q },
      { leftId: 'BASIS', rightId: 'VOLUME', factorId: 'USDT_COLLATERAL', dependencePpm: 400000, sourceRef: OWNER_REFS.q },
    ],
    missingDependencies: [],
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
    canonical: false,
  };
}

function scenarioInput(snapshotHash) {
  return {
    schema: 'PortfolioScenarioEvaluationInputV1',
    version: 1,
    evaluationId: 'evaluation.broad-market-gap',
    scenarioKind: 'BROAD_MARKET_GAP',
    snapshotHash,
    snapshotOwnerClaimHash: '86e23b2d2d1a47466fde56d0b5f0d67bafaaa9d44f049c4d2d805bdeae5619e3',
    scenarioReference: {
      scenarioId: 'f12.broad-market-gap',
      scenarioVersion: '1.0.0',
      extensionProviderRef: 'F12',
      fixtureSchemaRef: 'frontier/dock/contracts/v1/dock-v1.schema.json#/$defs/ScenarioReferenceV1',
      seed: 41,
      clockRef: 'fixture.clock.2026-07-16T00:00:00.000Z',
      lineageRefs: [
        'fixture://portfolio-lab/unaccepted-f12-consumer-stub/scenario/broad-market-gap',
        'status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
      ],
      expectedCanonicalPostureRefs: [OWNER_CONTRACT_REFS.risk],
    },
    scenarioDefinitionStatus: 'UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
    origin: 'HYPOTHETICAL',
    seed: 41,
    horizon: { startMs: 1784160000000, endMs: 1784160060000 },
    reproducibilityInputs: [
      'snapshot:fixture.portfolio-lab.baseline@1',
      'shock-set:broad-gap-v1',
      'scenario-definition-status:UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB',
    ],
    assumptions: {
      narrative: 'Caller-supplied broad gap with coupled liquidity deterioration.',
      severity: 'SEVERE_HYPOTHETICAL',
      liquidity: 'CALLER_SUPPLIED_CANONICAL_OUTPUT',
      fills: 'CALLER_SUPPLIED_CANONICAL_OUTPUT',
      exclusions: ['NO_DYNAMIC_HEDGING'],
    },
    sweepInputs: [
      { dimension: 'LIQUIDITY', state: 'KNOWN', value: '-400000', unit: 'PPM', ownerRef: OWNER_REFS.lTwin },
      { dimension: 'CAPACITY', state: 'KNOWN', value: '-350000', unit: 'PPM', ownerRef: OWNER_REFS.capital },
      { dimension: 'FUNDING', state: 'KNOWN', value: '1250', unit: 'USDT_MICRO', ownerRef: OWNER_REFS.lTwin },
      { dimension: 'BORROW', state: 'KNOWN', value: '-250000', unit: 'PPM', ownerRef: OWNER_REFS.lRecovery },
      { dimension: 'FEE', state: 'KNOWN', value: '600', unit: 'USDT_MICRO', ownerRef: OWNER_REFS.lTwin },
      { dimension: 'SLIPPAGE', state: 'KNOWN', value: '2200', unit: 'USDT_MICRO', ownerRef: OWNER_REFS.lTwin },
      { dimension: 'LATENCY', state: 'KNOWN', value: '800', unit: 'MILLISECONDS', ownerRef: OWNER_REFS.lTwin },
    ],
    impacts: [
      {
        impactId: 'impact.btc.market', subjectId: 'position.basis.btc', category: 'MARKET_MOVE',
        delta: known('-120000000'), lowerBound: known('-150000000'), upperBound: known('-90000000'),
        ownerOutputRef: OWNER_REFS.q,
      },
      {
        impactId: 'impact.alt.liquidity', subjectId: 'position.volume.alt', category: 'LIQUIDITY',
        delta: known('-30000000'), lowerBound: known('-45000000'), upperBound: known('-20000000'),
        ownerOutputRef: OWNER_REFS.lTwin,
      },
    ],
    stateChanges: [
      { subjectId: 'position.basis.btc', category: 'RISK_POSTURE', before: 'CURRENT', after: 'DEGRADED', ownerOutputRef: OWNER_REFS.risk },
    ],
    missingDependencies: [],
    uncertainty: {
      state: 'KNOWN', unit: 'USDT_MICRO', lowerAtoms: '-195000000', upperAtoms: '-110000000',
      method: 'CALLER_SUPPLIED_INTERVAL', sourceRefs: [OWNER_REFS.q, OWNER_REFS.lTwin],
    },
    outputMode: 'COMPARATIVE',
    whyNotLiveSizing: 'Fixture scenario output cannot authorize or calibrate live sizing.',
    authorityClass: 'NO_AUTHORITY',
    networkMode: 'FIXTURE_ONLY',
  };
}

export { OWNER_CONTRACT_REFS, OWNER_REFS, baseSnapshot, known, scenarioInput, unknown };
