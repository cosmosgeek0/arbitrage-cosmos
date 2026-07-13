#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateLoadShedding,
  frozenInputScan,
  measureResourceHarness,
  readJson,
  routeContractScan,
  runAllScenarios,
  runAuthorityScan,
} from '../../server/test/i00Acceptance/harness.mjs';
import { verifyReceiptProvenance } from './git-provenance.mjs';

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

function preamble(title, evidence) {
  return `# ${title}\n\nGenerated from \`fixtures/i00/closure-evidence.json\` at ${evidence.generatedAtUtc}. `
    + `Scope is \`${evidence.proofScope}\`; all fixture-chain evidence is permanently \`${evidence.truthLabel}\`. `
    + 'This report proves the prestage harness and named evidence only. It does not claim real-adapter integration, deployment, private truth, signed validation, or live execution.\n';
}

function missionReport(evidence) {
  const rows = evidence.requirements.map((row) => [
    row.id, row.source, row.requirement, row.owner, row.code, row.runtime, row.persistence,
    row.api, row.cockpit, row.control, row.test, row.scenario, row.sha, row.status, row.blocker, row.replacement,
  ]);
  return `${preamble('Mission Coverage Matrix — IP-PROOF prestage', evidence)}\n`
    + `${table(['ID', 'Source', 'Requirement', 'Owner', 'Code', 'Runtime', 'Persistence', 'API/read model', 'Cockpit', 'Control', 'Focused test', 'I00 scenario', 'Accepted SHA', 'Status', 'Exact blocker', 'Real-adapter replacement'], rows)}\n`;
}

function autonomyReport(evidence) {
  const rows = evidence.autonomy.map((row) => [row.layer, row.authority, row.limit, row.failurePosture, row.ownerOverride, row.status, row.blocker]);
  return `${preamble('Autonomy Closure Report — IP-PROOF prestage', evidence)}\n`
    + `${table(['Layer', 'Authority', 'Limit', 'Failure posture', 'Owner override', 'Status', 'Exact blocker'], rows)}\n`;
}

function terminalReport(evidence) {
  const rows = evidence.terminalOperations.map((row) => [row.operation, row.classification, row.mechanism, row.command, row.blocker]);
  return `${preamble('No-Terminal-Dependency Report — IP-PROOF prestage', evidence)}\n`
    + 'A fixture control never earns `MOVED_TO_AUTHENTICATED_CONTROL`; that classification below is used only where the accepted convergence source already exposes an authenticated mutation/read path.\n\n'
    + `${table(['Routine operation', 'Classification', 'Current mechanism', 'Command/API', 'Exact blocker'], rows)}\n`;
}

function resourceReport(evidence) {
  const samples = readJson('fixtures/i00/resource-samples.json');
  const measured = measureResourceHarness(evidence, samples);
  const priorities = table(['Priority', 'Work preserved'], evidence.resourcePriority.map((row) => [row.tier, row.work]));
  const metrics = table(
    ['Metric', 'Unit', 'Producer', 'Method', 'Plan soft bound', 'Plan hard bound', 'Fixture p50/p95/p99/max', 'Fixture breach', 'Product status'],
    evidence.resourceMetrics.map((row) => {
      const plan = evidence.resourceHarness.metrics[row.id];
      const fixture = measured.metrics[row.id];
      return [row.id, row.unit, row.producer, row.method, plan.softBound, plan.hardBound,
        fixture ? `${fixture.p50}/${fixture.p95}/${fixture.p99}/${fixture.maximum}` : 'invariant',
        fixture?.breachState ?? 'INVARIANT', row.status];
    }),
  );
  return `${preamble('Resource and Backpressure Report — IP-PROOF prestage', evidence)}\n`
    + `The executable measurement-plan contract uses an injected clock, ${evidence.resourceHarness.sampleWindowMs} ms windows, at least ${evidence.resourceHarness.minimumSamples} samples, and p50/p95/p99/max. The displayed distributions are deterministic \`SYNTHETIC\` fixtures, not runtime measurements or production SLOs. Plan bounds are initial proxy gates for director replacement, not observed host capacity. Capacity breach must become \`DEGRADED\` or \`BLOCKED\` before silent loss. Lower-tier shedding is counted in P4→P3→P2 order; P0 material loss must remain exactly zero and P0/P1 remain available.\n\n`
    + `## Load-shedding priority\n\n${priorities}\n\n## Measurement matrix\n\n${metrics}\n`;
}

function interfaceReport(evidence) {
  const rows = evidence.interfaces.map((row) => [
    row.id, row.productRealm, row.operation, row.officialPage, row.checkedAtUtc, row.hostRoute,
    row.authSignature, row.schemaFixtureHash, row.lifetimeKeepaliveReconnect, row.limitsWeights,
    row.selectedImplementation, row.rejectedAlternatives, row.changelogRisk, row.contractTest, row.disposition,
    evidence.interfaceClosure[row.id].status, evidence.interfaceClosure[row.id].blocker,
  ]);
  return `${preamble('Official Interface Matrix — IP-PROOF prestage', evidence)}\n`
    + 'These are dated build inputs checked against official vendor documentation. No network, private, signed, cloud, or deployment action was executed. Exact schema fixtures and weights remain pending where an accepted real adapter or authorization is required.\n\n'
    + `${table(['ID', 'Product/realm', 'Operation', 'Official page', 'Checked UTC', 'Host/route', 'Auth/signature', 'Schema/fixture hash', 'Lifetime/keepalive/reconnect', 'Limits/weights', 'Selected implementation', 'Rejected alternative', 'Changelog risk', 'Contract test', 'Disposition', 'Closure status', 'Exact blocker'], rows)}\n`;
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

export function buildMachineEvidence() {
  const catalog = readJson('fixtures/i00/proof-catalog.json');
  const closure = readJson('fixtures/i00/closure-evidence.json');
  const scenarioDocument = readJson('fixtures/i00/scenarios.json');
  const resourceSamples = readJson('fixtures/i00/resource-samples.json');
  const receiptProvenance = readJson('fixtures/i00/receipt-provenance.json');
  const scenarios = runAllScenarios(scenarioDocument);
  const authority = runAuthorityScan(catalog);
  const frozenInputs = frozenInputScan(catalog);
  const routes = routeContractScan(catalog);
  return {
    schemaVersion: 1,
    packet: 'IP-PROOF',
    generatedAtUtc: catalog.generatedAtUtc,
    proofScope: closure.proofScope,
    truthLabel: closure.truthLabel,
    targetState: catalog.targetState,
    productVerdict: closure.productVerdict,
    base: catalog.base,
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
    },
    frozenInputs,
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
    receiptProvenanceVerification: verifyReceiptProvenance(receiptProvenance),
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
  const reports = renderReports({ ...closure, generatedAtUtc: '2026-07-13T00:00:00Z' });
  if (process.argv.includes('--write')) {
    for (const [relativePath, content] of Object.entries(reports)) writeFileSync(path.join(ROOT, relativePath), content);
    const evidence = buildMachineEvidence();
    const reportDir = path.join(ROOT, 'integration/reports');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(path.join(reportDir, 'i00-proof-evidence.json'), `${JSON.stringify({ ...evidence, evidenceSha256: evidenceDigest(evidence) }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(Object.keys(reports))}\n`);
  }
}
