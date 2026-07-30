#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateLoadShedding,
  effectiveFrozenInputScan,
  historicalFrozenInputScan,
  measureResourceHarness,
  readJson,
  routeContractScan,
  runAllScenarios,
  runAuthorityScan,
} from '../../server/test/i00Acceptance/harness.mjs';
import { verifyReceiptProvenanceSeal } from './git-provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function cell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function table(headers, rows) {
  const header = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  return [header, divider, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n');
}

function evidenceCell(row, closure) {
  const serialized = JSON.stringify(row).toLowerCase();
  const references = closure.report.evidenceReferences;
  const evidence = new Set(['fixtures/i00/closure-evidence.json', references.state, references.provenance]);
  if (row.sha) evidence.add(`accepted SHA ${row.sha}`);
  if (/(runtime|source|sensing|attention|evidence|queue|reconnect|public_rate)/.test(serialized)) evidence.add(references.runtime);
  if (/(control|cockpit|dashboard|browser|mount|incident|mode_change|pause|resume|halt)/.test(serialized)) evidence.add(references.control);
  if (/(ops|deploy|rollback|backup|restore|watchdog|cloudwatch|cloudflare|secrets|systemd|sqlite|capacity|resource)/.test(serialized)) evidence.add(references.ops);
  if (/(accepted q|accepted l|private|signed|canary|q-assessment|q_rate)/.test(serialized)) evidence.add(references.director);
  evidence.add(references.proof);
  return [...evidence].join('; ');
}

function preamble(title, evidence) {
  return `# ${title} — ${evidence.report.titleSuffix}\n\nGenerated from \`fixtures/i00/closure-evidence.json\` at ${evidence.report.generatedAtUtc}. `
    + `Scope is \`${evidence.proofScope}\`; evidence truth is \`${evidence.truthLabel}\`; product verdict is \`${evidence.productVerdict}\`; candidate state is \`${evidence.candidateState}\`. `
    + `${evidence.report.summary}\n`;
}

function missionReport(evidence) {
  const rows = evidence.requirements.map((row) => [
    row.id, row.source, row.requirement, row.owner, row.code, row.runtime, row.persistence,
    row.api, row.cockpit, row.control, row.test, row.scenario, row.sha, row.status, row.blocker, row.replacement, evidenceCell(row, evidence),
  ]);
  return `${preamble('Mission Coverage Matrix', evidence)}\n`
    + `${table(['ID', 'Source', 'Requirement', 'Owner', 'Code', 'Runtime', 'Persistence', 'API/read model', 'Cockpit', 'Control', 'Focused test', 'I00 scenario', 'Accepted SHA', 'Status', 'Exact blocker', 'Real-adapter replacement', 'Evidence'], rows)}\n`;
}

function autonomyReport(evidence) {
  const rows = evidence.autonomy.map((row) => [row.layer, row.authority, row.limit, row.failurePosture, row.ownerOverride, row.status, row.blocker, evidenceCell(row, evidence)]);
  return `${preamble('Autonomy Closure Report', evidence)}\n`
    + `${table(['Layer', 'Authority', 'Limit', 'Failure posture', 'Owner override', 'Status', 'Exact blocker', 'Evidence'], rows)}\n`;
}

function terminalReport(evidence) {
  const rows = evidence.terminalOperations.map((row) => [row.operation, row.classification, row.mechanism, row.command, row.blocker, evidenceCell(row, evidence)]);
  return `${preamble('No-Terminal-Dependency Report', evidence)}\n`
    + `${evidence.report.terminalNote}\n\n`
    + `${table(['Routine operation', 'Classification', 'Current mechanism', 'Command/API', 'Exact blocker', 'Evidence'], rows)}\n`;
}

function resourceReport(evidence) {
  const samples = readJson('fixtures/i00/resource-samples.json');
  const measured = measureResourceHarness(evidence, samples);
  const priorities = table(['Priority', 'Work preserved', 'Evidence'], evidence.resourcePriority.map((row) => [row.tier, row.work, evidenceCell(row, evidence)]));
  const metrics = table(
    ['Metric', 'Unit', 'Producer', 'Method', 'Plan soft bound', 'Plan hard bound', 'Fixture p50/p95/p99/max', 'Fixture breach', 'Product status', 'Evidence'],
    evidence.resourceMetrics.map((row) => {
      const plan = evidence.resourceHarness.metrics[row.id];
      const fixture = measured.metrics[row.id];
      return [row.id, row.unit, row.producer, row.method, plan.softBound, plan.hardBound,
        fixture ? `${fixture.p50}/${fixture.p95}/${fixture.p99}/${fixture.maximum}` : 'invariant',
        fixture?.breachState ?? 'INVARIANT', row.status, evidenceCell(row, evidence)];
    }),
  );
  const measurementStatus = table(
    ['Measurement', 'Status', 'Contract/receipt'],
    Object.entries(evidence.measurements).map(([id, row]) => [id, row.status, row.receipt ?? row.contract ?? '—']),
  );
  const limitations = table(
    ['Limitation', 'Status', 'Exact reason'],
    (evidence.currentLimitations ?? evidence.knownLimitations).map((row) => [row.id, row.status, row.reason]),
  );
  return `${preamble('Resource and Backpressure Report', evidence)}\n`
    + `${evidence.report.resourceNote} The executable synthetic plan uses an injected clock, ${evidence.resourceHarness.sampleWindowMs} ms windows, at least ${evidence.resourceHarness.minimumSamples} samples, and p50/p95/p99/max. Capacity breach must become \`DEGRADED\` or \`BLOCKED\` before silent loss. Lower-tier shedding is counted in P4→P3→P2 order; P0 material loss remains exactly zero and P0/P1 remain available.\n\n`
    + `## Current measurement status\n\n${measurementStatus}\n\n## Explicit limitations\n\n${limitations}\n\n## Load-shedding priority\n\n${priorities}\n\n## Synthetic measurement-plan matrix\n\n${metrics}\n`;
}

function interfaceReport(evidence) {
  const rows = evidence.interfaces.map((row) => [
    row.id, row.productRealm, row.operation, row.officialPage, row.checkedAtUtc, row.hostRoute,
    row.authSignature, row.schemaFixtureHash, row.lifetimeKeepaliveReconnect, row.limitsWeights,
    row.selectedImplementation, row.rejectedAlternatives, row.changelogRisk, row.contractTest, row.disposition,
    evidence.interfaceClosure[row.id].status, evidence.interfaceClosure[row.id].blocker,
    evidenceCell({ ...row, ...evidence.interfaceClosure[row.id] }, evidence),
  ]);
  return `${preamble('Official Interface Matrix', evidence)}\n`
    + `${evidence.report.interfaceNote} Exact schema captures remain pending where an authorized real adapter is required.\n\n`
    + `${table(['ID', 'Product/realm', 'Operation', 'Official page', 'Checked UTC', 'Host/route', 'Auth/signature', 'Schema/fixture hash', 'Lifetime/keepalive/reconnect', 'Limits/weights', 'Selected implementation', 'Rejected alternative', 'Changelog risk', 'Contract test', 'Disposition', 'Closure status', 'Exact blocker', 'Evidence'], rows)}\n`;
}

export function renderReports(evidence) {
  return Object.freeze({
    'MISSION_COVERAGE_MATRIX.md': missionReport(evidence),
    'AUTONOMY_CLOSURE_REPORT.md': autonomyReport(evidence),
    'NO_TERMINAL_DEPENDENCY_REPORT.md': terminalReport(evidence),
    'RESOURCE_AND_BACKPRESSURE_REPORT.md': resourceReport(evidence),
    'OFFICIAL_INTERFACE_MATRIX.md': interfaceReport(evidence),
  });
}

const PROTECTED_OWNER_EVIDENCE_MODES = new Set(['LIVE_OWNER_FILE', 'SEALED_CANDIDATE_HASH']);

function stableOwnerEvidence(row) {
  if (!row || typeof row !== 'object' || !PROTECTED_OWNER_EVIDENCE_MODES.has(row.evidenceMode)) return row;
  return { ...row, evidenceMode: 'PROTECTED_OWNER_SHA256_VERIFIED' };
}

export function normalizeMachineEvidenceAuthority({
  frozenInputs,
  historicalFrozenInputs,
  livingDirectorInputAcceptance,
}) {
  return {
    frozenInputs: frozenInputs.map(stableOwnerEvidence),
    historicalFrozenInputs: historicalFrozenInputs.map(stableOwnerEvidence),
    livingDirectorInputAcceptance: {
      ...livingDirectorInputAcceptance,
      directiveResults: livingDirectorInputAcceptance.directiveResults.map(stableOwnerEvidence),
    },
  };
}

export function buildMachineEvidence() {
  const catalog = readJson('fixtures/i00/proof-catalog.json');
  const closure = readJson('fixtures/i00/closure-evidence.json');
  const scenarioDocument = readJson('fixtures/i00/scenarios.json');
  const resourceSamples = readJson('fixtures/i00/resource-samples.json');
  const receiptProvenance = readJson('fixtures/i00/receipt-provenance.json');
  const livingInputAcceptance = readJson('fixtures/i00/living-director-input-acceptance.json');
  const scenarios = runAllScenarios(scenarioDocument);
  const authority = runAuthorityScan(catalog);
  const historicalFrozenInputs = historicalFrozenInputScan(catalog);
  const effectiveInputs = effectiveFrozenInputScan(catalog, livingInputAcceptance);
  const normalizedAuthority = normalizeMachineEvidenceAuthority({
    frozenInputs: effectiveInputs.acceptedInputs,
    historicalFrozenInputs,
    livingDirectorInputAcceptance: effectiveInputs.acceptance,
  });
  const routes = routeContractScan(catalog);
  return {
    schemaVersion: 3,
    packet: catalog.packet,
    generatedAtUtc: catalog.generatedAtUtc,
    proofScope: closure.proofScope,
    truthLabel: closure.truthLabel,
    targetState: catalog.targetState,
    productVerdict: closure.productVerdict,
    candidateState: closure.candidateState,
    base: catalog.base,
    historicalPacket: catalog.historicalPacket,
    report: closure.report,
    donorEquality: closure.donorEquality,
    catalogDenominatorRuling: closure.catalogDenominatorRuling,
    measurements: closure.measurements,
    knownLimitations: closure.currentLimitations ?? closure.knownLimitations,
    historicalCandidateLimitations: closure.knownLimitations,
    historicalCandidateLimitationsRole: closure.knownLimitationsRole ?? null,
    counts: {
      requirements: closure.requirements.length,
      autonomyLayers: closure.autonomy.length,
      terminalOperations: closure.terminalOperations.length,
      resourceMetrics: closure.resourceMetrics.length,
      officialInterfaces: closure.interfaces.length,
      noSurprisesQuestions: closure.noSurprises.length,
      pages: catalog.pages.length,
      controls: catalog.controls.length,
      capabilities: catalog.capabilities.length,
      scenarios: scenarios.length,
      authorityConcepts: authority.authorityConcepts,
      semanticStreams: authority.semanticStreams,
      transportCandidates: authority.transportCandidates.length,
      provenanceItems: receiptProvenance.items.length,
      phase2Donors: closure.acceptedEvidence.filter((row) => row.phase2Donor).length,
    },
    frozenInputs: normalizedAuthority.frozenInputs,
    historicalFrozenInputs: normalizedAuthority.historicalFrozenInputs,
    livingDirectorInputAcceptance: normalizedAuthority.livingDirectorInputAcceptance,
    authority,
    routes,
    scenarios,
    closureEvidence: {
      acceptedEvidence: closure.acceptedEvidence,
      requirements: closure.requirements,
      autonomy: closure.autonomy,
      terminalOperations: closure.terminalOperations,
      resourcePriority: closure.resourcePriority,
      resourceMetrics: closure.resourceMetrics,
      resourceHarness: closure.resourceHarness,
      interfaces: closure.interfaces,
      interfaceClosure: closure.interfaceClosure,
    },
    catalogMatrices: {
      pages: catalog.pages,
      requiredAbsentSurfaces: catalog.requiredAbsentSurfaces,
      controls: catalog.controls,
      capabilities: catalog.capabilities,
    },
    resourceFixtureMeasurement: measureResourceHarness(closure, resourceSamples),
    loadSheddingFixture: evaluateLoadShedding(resourceSamples),
    receiptProvenance,
    receiptProvenanceSeal: verifyReceiptProvenanceSeal(receiptProvenance),
    proofInputs: {
      authorityOwners: catalog.authorityOwners,
      semanticSources: catalog.semanticSources,
      staticRules: catalog.staticRules,
      knownConflicts: catalog.knownConflicts,
      messageValidityCases: catalog.messageValidityCases,
      resourceSamples,
    },
    noSurprises: closure.noSurprises,
    adapterInsertionPoints: catalog.adapterInsertionPoints,
  };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function evidenceDigest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const closure = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/i00/closure-evidence.json'), 'utf8'));
  const reports = renderReports(closure);
  if (process.argv.includes('--write') || process.argv.includes('--reports-only')) {
    for (const [relativePath, content] of Object.entries(reports)) writeFileSync(path.join(ROOT, relativePath), content);
  }
  if (process.argv.includes('--write')) {
    const evidence = buildMachineEvidence();
    writeFileSync(
      path.join(ROOT, 'integration/reports/i00-proof-evidence.json'),
      `${JSON.stringify({ ...evidence, evidenceSha256: evidenceDigest(evidence) }, null, 2)}\n`,
    );
  }
  if (!process.argv.includes('--write') && !process.argv.includes('--reports-only')) {
    process.stdout.write(`${JSON.stringify(Object.keys(reports))}\n`);
  }
}
