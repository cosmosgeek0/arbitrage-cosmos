import { projectFormalAssuranceView } from '../contracts/view-model.mjs';
import { CANONICAL_MODELS } from '../explicitState/index.mjs';
import { runModels } from '../explicitState/kernel.mjs';
import { CONFORMANCE_FIXTURES, FORMAL_FIXTURE_TIME_MS } from './conformance-fixtures.mjs';
import { buildCounterexampleTriageInventory } from './triage-fixtures.mjs';

export function buildFormalPacketView() {
  return projectFormalAssuranceView({
    reports: runModels(CANONICAL_MODELS),
    conformanceMappings: CONFORMANCE_FIXTURES,
    conformanceVerificationContextsByModel: Object.freeze({}),
    counterexampleTriages: buildCounterexampleTriageInventory(),
    triageVerificationContextsById: Object.freeze({}),
    generatedAtMs: FORMAL_FIXTURE_TIME_MS,
  });
}
