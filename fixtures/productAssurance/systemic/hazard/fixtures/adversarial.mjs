import { buildCompleteHazardFixture, FIXTURE_NOW_MS } from './baseline.mjs';
import { computeAtlasDenominatorFingerprint } from '../contracts/index.mjs';

const cloneJson = (value) => {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
  }
  return value;
};

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const changeFixture = (change) => {
  const fixture = cloneJson(buildCompleteHazardFixture());
  change(fixture);
  return deepFreeze(fixture);
};

export const buildMissingAssumptionFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-MISSING-ASSUMPTION';
  fixture.assumptions = fixture.assumptions.filter((assumption) => assumption.assumptionId !== 'PA-S1-AS-003');
});

export const buildExpiredAssumptionFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-EXPIRED-ASSUMPTION';
  fixture.assumptions = fixture.assumptions.map((assumption) => (
    assumption.assumptionId === 'PA-S1-AS-003'
      ? {
        ...assumption,
        lastVerifiedAtMs: FIXTURE_NOW_MS - 20_000,
        maximumAgeMs: 5_000,
      }
      : assumption
  ));
});

export const buildContradictedAssumptionFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-CONTRADICTED-ASSUMPTION';
  fixture.assumptions = fixture.assumptions.map((assumption) => (
    assumption.assumptionId === 'PA-S1-AS-005'
      ? { ...assumption, result: 'FAIL', reasonCode: 'CONTRADICTED' }
      : assumption
  ));
});

export const buildMissingAtlasRowFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-MISSING-ATLAS-ROW';
  fixture.atlasRows = fixture.atlasRows.filter((row) => row.atlasRowId !== 'PA-S1-FA-NM-002');
  fixture.fixtureRegistry = fixture.fixtureRegistry.filter((registration) => registration.targetId !== 'PA-S1-FA-NM-002');
});

export const buildMissingAtlasDecisionFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-MISSING-ATLAS-DECISION';
  fixture.atlasManifest.coverageDecisions = fixture.atlasManifest.coverageDecisions.filter(
    (decision) => decision.decisionId !== 'PA-S1-AD-RR-009',
  );
  fixture.atlasRows = fixture.atlasRows.filter((row) => row.atlasRowId !== 'PA-S1-FA-RR-009');
  fixture.fixtureRegistry = fixture.fixtureRegistry.filter((registration) => registration.targetId !== 'PA-S1-FA-RR-009');
  fixture.atlasManifest.denominatorFingerprint = computeAtlasDenominatorFingerprint(
    fixture.atlasManifest.liveOperationClasses,
    fixture.atlasManifest.coverageDecisions,
  );
  fixture.atlasManifest.review.reviewedDenominatorFingerprint = fixture.atlasManifest.denominatorFingerprint;
});

export const buildUnreviewedAtlasFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-UNREVIEWED-ATLAS';
  fixture.atlasManifest.review = {
    state: 'OWNER_REVIEW_MISSING',
    reviewerId: null,
    reviewedAtMs: null,
    evidenceId: null,
    evidenceState: 'UNTESTED',
    reviewedManifestVersion: null,
    reviewedDenominatorFingerprint: null,
    reviewedOperationPolicyRevision: null,
    reviewedReleaseId: null,
  };
});

export const buildDuplicateAtlasRowFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-DUPLICATE-ATLAS-ROW';
  const duplicate = {
    ...fixture.atlasRows[0],
    atlasRowId: 'PA-S1-FA-PR-001-DUPLICATE',
    provenance: {
      ...fixture.atlasRows[0].provenance,
      evidenceIds: ['PA-S1-FX-ATLAS-PR-001-DUPLICATE'],
    },
    reproduction: {
      fixtureId: 'PA-S1-FX-ATLAS-PR-001-DUPLICATE',
      exactGap: null,
    },
  };
  fixture.atlasRows.push(duplicate);
  fixture.fixtureRegistry.push({
    ...fixture.fixtureRegistry.find((registration) => registration.targetId === 'PA-S1-FA-PR-001'),
    fixtureId: duplicate.reproduction.fixtureId,
    targetId: duplicate.atlasRowId,
  });
});

export const buildForeignAtlasRowFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-FOREIGN-ATLAS-ROW';
  const foreign = {
    ...fixture.atlasRows[0],
    atlasRowId: 'PA-S1-FA-PR-999',
    failureFamilyId: 'PA-S1-FF-999',
    provenance: {
      ...fixture.atlasRows[0].provenance,
      evidenceIds: ['PA-S1-FX-ATLAS-PR-999'],
    },
    reproduction: {
      fixtureId: 'PA-S1-FX-ATLAS-PR-999',
      exactGap: null,
    },
  };
  fixture.atlasRows.push(foreign);
  fixture.fixtureRegistry.push({
    ...fixture.fixtureRegistry.find((registration) => registration.targetId === 'PA-S1-FA-PR-001'),
    fixtureId: foreign.reproduction.fixtureId,
    targetId: foreign.atlasRowId,
  });
});

export const buildPermutedFixture = () => changeFixture((fixture) => {
  fixture.fixtureId = 'PA-S1-FX-PERMUTED';
  fixture.unacceptableLossFamilies.reverse();
  fixture.hazards.reverse();
  fixture.assumptions.reverse();
  fixture.assumptionConsumers.reverse();
  fixture.fixtureRegistry.reverse();
  fixture.failureFamilies.reverse();
  fixture.atlasManifest.liveOperationClasses.reverse();
  fixture.atlasManifest.coverageDecisions.reverse();
  fixture.atlasRows.reverse();
});
