#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  decodeCoreEvidenceRawBytes,
  parseCoreEvidenceFile,
} from './evidence-chain.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORE_REPLAY_MODULE = resolve(
  HERE,
  '../../../server/dist/engine/volume/forwardMeasurementReplay.js',
);

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

export function parseReplayArgs(argv) {
  const options = {
    evidence: null,
    expectedPolicyDigest: null,
    expectedTerminalHash: null,
    integrityOnly: false,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--integrity-only') {
      options.integrityOnly = true;
      continue;
    }
    if (
      argument === '--evidence'
      || argument === '--expected-policy-digest'
      || argument === '--expected-terminal-hash'
      || argument === '--output'
    ) {
      const value = argv[index + 1];
      invariant(value && !value.startsWith('--'), `VE2_REPLAY_ARGUMENT:${argument}`);
      const key = {
        '--evidence': 'evidence',
        '--expected-policy-digest': 'expectedPolicyDigest',
        '--expected-terminal-hash': 'expectedTerminalHash',
        '--output': 'output',
      }[argument];
      options[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`VE2_REPLAY_UNKNOWN_ARGUMENT:${argument}`);
  }
  invariant(options.evidence !== null, 'VE2_REPLAY_EVIDENCE_REQUIRED');
  invariant(
    /^sha256:[a-f0-9]{64}$/.test(options.expectedPolicyDigest ?? ''),
    'VE2_REPLAY_EXPECTED_POLICY_DIGEST_REQUIRED',
  );
  invariant(
    /^sha256:[a-f0-9]{64}$/.test(options.expectedTerminalHash ?? ''),
    'VE2_REPLAY_EXPECTED_TERMINAL_HASH_REQUIRED',
  );
  return Object.freeze(options);
}

function verifyPolicyPrecedesOutcome(
  core,
  verification,
  packetPolicy,
) {
  const first = verification.records[0];
  invariant(first?.header?.kind === 'POLICY', 'VE2_REPLAY_POLICY_NOT_FIRST');
  const decoded = decodeCoreEvidenceRawBytes(core, first);
  let capturedPolicy;
  try {
    capturedPolicy = JSON.parse(Buffer.from(decoded).toString('utf8'));
  } catch {
    throw new Error('VE2_REPLAY_POLICY_JSON_INVALID');
  }
  invariant(
    capturedPolicy?.schemaVersion ===
      'cosmos.engine.volume.forward-measurement-policy.v1'
      || (
        capturedPolicy?.schemaVersion ===
          'cosmos.engine.volume.forward-detector-coverage-policy.v1'
        && capturedPolicy?.role === 'DETECTOR_COVERAGE'
        && capturedPolicy?.symbol === null
      ),
    'VE2_REPLAY_POLICY_SCHEMA',
  );
  invariant(
    capturedPolicy.policyId === packetPolicy.policyId,
    'VE2_REPLAY_POLICY_ID_MISMATCH',
  );
  invariant(
    capturedPolicy.config?.enabled === false &&
      capturedPolicy.config?.killSwitchEngaged === true,
    'VE2_REPLAY_POLICY_AUTHORITY_MISMATCH',
  );
  invariant(
    first.header.policyDigest === verification.policyDigest,
    'VE2_REPLAY_POLICY_DIGEST_MISMATCH',
  );
  return verification.policyDigest;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export const FROZEN_PACKET_RULES = Object.freeze({
  activationMinimumLeadMs: 86_400_000,
  warmupDurationMs: 14_400_000,
  measurementDurationMs: 2_592_000_000,
  maturityLagMs: 62_000,
  proposalAdmissionClosesAtIntervalEnd: true,
  evidenceClosesAfterProposalAdmissionMs: 62_000,
  evaluationCutPeriodMs: 2_000,
  maximumHoldMs: 60_000,
  entryQuoteNotional: '10.00',
  sampleUniverseMode: 'PROSPECTIVE_ACCEPTED_DETECTOR_PROPOSALS',
  proposalOrigin: 'VOLUME_DETECTOR',
  completeAcceptedProposalSetRequired: true,
  nonPseudoProposalRequired: true,
  pointInTimeEligibilityRequired: true,
  currentStateSubstitutionForbidden: true,
});

function verifyFrozenPacketRulesAgainstPolicy(policy) {
  invariant(
    JSON.stringify({
      activationMinimumLeadMs: policy.activation?.minimumLeadMs,
      warmupDurationMs: policy.warmup?.durationMs,
      measurementDurationMs: policy.activation?.durationMs,
      maturityLagMs: policy.activation?.maturityLagMs,
      proposalAdmissionClosesAtIntervalEnd: true,
      evidenceClosesAfterProposalAdmissionMs:
        policy.activation?.maturityLagMs,
      evaluationCutPeriodMs: policy.detectorBinding?.evaluationCutPeriodMs,
      maximumHoldMs: policy.detectorBinding?.maximumHoldMs,
      entryQuoteNotional: policy.detectorBinding?.entryQuoteNotional,
      sampleUniverseMode: policy.universe?.mode,
      proposalOrigin: policy.universe?.proposalOrigin,
      completeAcceptedProposalSetRequired:
        policy.universe?.completeAcceptedProposalSetRequired,
      nonPseudoProposalRequired: policy.universe?.nonPseudoProposalRequired,
      pointInTimeEligibilityRequired:
        policy.universe?.pointInTimeExchangeInfoRequired,
      currentStateSubstitutionForbidden:
        policy.universe?.substitutionForbidden,
    }) === JSON.stringify(FROZEN_PACKET_RULES),
    'VE2_REPLAY_PACKET_POLICY_RULES_DRIFT',
  );
}

export function verifyPacketPolicyBinding(
  core,
  verification,
  packetPolicyBytes,
  packetPolicy,
) {
  const expectedPacketSha256 = sha256(packetPolicyBytes);
  verifyFrozenPacketRulesAgainstPolicy(packetPolicy);
  const capturedCorePolicyRecord = verification.records[0];
  let capturedCorePolicy;
  try {
    capturedCorePolicy = JSON.parse(
      Buffer.from(
        decodeCoreEvidenceRawBytes(core, capturedCorePolicyRecord),
      ).toString('utf8'),
    );
  } catch {
    throw new Error('VE2_REPLAY_CAPTURED_CORE_POLICY_JSON_INVALID');
  }
  invariant(
    Number.isSafeInteger(capturedCorePolicy?.outcomeClosesAtMs)
      && Number.isSafeInteger(capturedCorePolicy?.evidenceClosesAtMs)
      && capturedCorePolicy.evidenceClosesAtMs
        - capturedCorePolicy.outcomeClosesAtMs
          === FROZEN_PACKET_RULES.evidenceClosesAfterProposalAdmissionMs,
    'VE2_REPLAY_CAPTURED_CORE_POLICY_HORIZON',
  );
  const configRecords = verification.records.filter(
    (record) => record.header.kind === 'CONFIG_STATE',
  );
  const terminalRecord = verification.records.at(-1);
  let terminalDescriptor = null;
  if (terminalRecord?.header?.kind === 'TERMINAL_SEAL') {
    try {
      terminalDescriptor = JSON.parse(
        Buffer.from(
          decodeCoreEvidenceRawBytes(core, terminalRecord),
        ).toString('utf8'),
      );
    } catch {
      throw new Error('VE2_REPLAY_TERMINAL_DESCRIPTOR_JSON_INVALID');
    }
  }
  const terminalPacketBinding = (
    terminalDescriptor?.schemaVersion === 'volume.forward.segment-seal.v1'
      && terminalDescriptor?.profile === 'FORWARD_MEASUREMENT_SEGMENT_V1'
  )
    ? terminalDescriptor.packetMeasurementPolicySha256
    : null;
  if (terminalPacketBinding !== null) {
    invariant(
      terminalPacketBinding === expectedPacketSha256,
      'VE2_REPLAY_TERMINAL_PACKET_POLICY_SHA256_MISMATCH',
    );
  }
  invariant(
    configRecords.length > 0
      || (
        capturedCorePolicy?.role === 'DETECTOR_COVERAGE'
        && terminalPacketBinding === expectedPacketSha256
      ),
    'VE2_REPLAY_PACKET_POLICY_BINDING_MISSING',
  );
  for (const record of configRecords) {
    const decoded = decodeCoreEvidenceRawBytes(core, record);
    let config;
    try {
      config = JSON.parse(Buffer.from(decoded).toString('utf8'));
    } catch {
      throw new Error('VE2_REPLAY_CONFIG_JSON_INVALID');
    }
    invariant(
      config.measurementPolicySha256 === expectedPacketSha256,
      'VE2_REPLAY_PACKET_POLICY_SHA256_MISMATCH',
    );
    invariant(
      config.measurementPolicyId === packetPolicy.policyId,
      'VE2_REPLAY_PACKET_POLICY_ID_MISMATCH',
    );
    invariant(
      JSON.stringify(config.frozenMeasurementRules) ===
        JSON.stringify(FROZEN_PACKET_RULES),
      'VE2_REPLAY_PACKET_POLICY_RULES_MISMATCH',
    );
    invariant(
      config.proposalAdmissionClosesAtMs
        === capturedCorePolicy.outcomeClosesAtMs
        && config.evidenceClosesAtMs
          === capturedCorePolicy.evidenceClosesAtMs,
      'VE2_REPLAY_PACKET_POLICY_HORIZON_MISMATCH',
    );
  }
  return Object.freeze({
    configBindingCount:
      configRecords.length + (terminalPacketBinding === null ? 0 : 1),
    packetPolicySha256: expectedPacketSha256,
  });
}

function verifyShadowOnlyResult(
  result,
  expectedPolicyDigest,
  expectedTerminalHash,
) {
  invariant(result && typeof result === 'object', 'VE2_REPLAY_CORE_RESULT');
  invariant(result.mode === 'SHADOW_ONLY', 'VE2_REPLAY_NOT_SHADOW_ONLY');
  invariant(result.recordOnly === true, 'VE2_REPLAY_NOT_RECORD_ONLY');
  invariant(result.strategyEnabled === false, 'VE2_REPLAY_DEFAULT_OFF_DRIFT');
  invariant(result.killSwitchEngaged === true, 'VE2_REPLAY_KILL_ON_DRIFT');
  invariant(result.submitAuthority === false, 'VE2_REPLAY_SUBMIT_AUTHORITY');
  invariant(result.casAuthority === false, 'VE2_REPLAY_CAS_AUTHORITY');
  invariant(result.privateOrSignedCalls === 0, 'VE2_REPLAY_PRIVATE_CALLS');
  invariant(result.orders === 0, 'VE2_REPLAY_ORDERS');
  invariant(result.transfers === 0, 'VE2_REPLAY_TRANSFERS');
  invariant(result.withdrawals === 0, 'VE2_REPLAY_WITHDRAWALS');
  invariant(result.moneyUsd === 0, 'VE2_REPLAY_MONEY');
  invariant(result.economics === null, 'VE2_REPLAY_PARTIAL_ECONOMICS');
  invariant(result.profitabilityClaim === false, 'VE2_REPLAY_PROFITABILITY_CLAIM');
  invariant(
    result.sourceAuthenticity === 'TRUSTED_ANCHOR_MATCHED',
    'VE2_REPLAY_SOURCE_UNANCHORED',
  );
  invariant(
    result.trustedAnchors?.expectedPolicyDigest === expectedPolicyDigest
      && result.trustedAnchors?.expectedTerminalHash === expectedTerminalHash
      && result.trustedAnchors?.policyDigestMatched === true
      && result.trustedAnchors?.terminalHashMatched === true,
    'VE2_REPLAY_TRUSTED_ANCHOR_MISMATCH',
  );
  return result;
}

export async function replayEvidence(options = {}) {
  invariant(
    options !== null &&
      typeof options === 'object' &&
      !Array.isArray(options),
    'VE2_REPLAY_OPTIONS',
  );
  const allowedOptions = new Set([
    'evidencePath',
    'expectedPolicyDigest',
    'expectedTerminalHash',
    'integrityOnly',
    'outputPath',
  ]);
  for (const key of Object.keys(options)) {
    invariant(allowedOptions.has(key), `VE2_REPLAY_OPTION_FORBIDDEN:${key}`);
  }
  const {
    evidencePath,
    expectedPolicyDigest,
    expectedTerminalHash,
    integrityOnly = false,
    outputPath = null,
  } = options;
  invariant(typeof evidencePath === 'string' && evidencePath.length > 0, 'VE2_REPLAY_EVIDENCE_REQUIRED');
  invariant(
    typeof expectedPolicyDigest === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(expectedPolicyDigest),
    'VE2_REPLAY_EXPECTED_POLICY_DIGEST_REQUIRED',
  );
  invariant(
    typeof expectedTerminalHash === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(expectedTerminalHash),
    'VE2_REPLAY_EXPECTED_TERMINAL_HASH_REQUIRED',
  );
  invariant(typeof integrityOnly === 'boolean', 'VE2_REPLAY_INTEGRITY_MODE');
  const policyBytes = readFileSync(resolve(HERE, 'measurement-policy.v1.json'));
  const policy = JSON.parse(policyBytes);
  const parsed = await parseCoreEvidenceFile(resolve(evidencePath), {
    expectedPolicyDigest,
    expectedTerminalHash,
  });
  const verified = parsed.verification;
  invariant(
    verified.sourceAuthenticity === 'TRUSTED_ANCHOR_MATCHED'
      && verified.trustedAnchors?.expectedPolicyDigest
        === expectedPolicyDigest
      && verified.trustedAnchors?.expectedTerminalHash
        === expectedTerminalHash
      && verified.trustedAnchors?.policyDigestMatched === true
      && verified.trustedAnchors?.terminalHashMatched === true,
    'VE2_REPLAY_EVIDENCE_ANCHOR_MISMATCH',
  );
  const evidencePolicyDigest = verifyPolicyPrecedesOutcome(
    parsed.core,
    verified,
    policy,
  );
  const packetBinding = verifyPacketPolicyBinding(
    parsed.core,
    verified,
    policyBytes,
    policy,
  );

  let result = {
    schemaVersion: 've2.replay-result.v1',
    state: 'INTEGRITY_ONLY_COMPLETE',
    policyId: policy.policyId,
    evidencePolicyDigest,
    packetPolicySha256: packetBinding.packetPolicySha256,
    packetPolicyBindingCount: packetBinding.configBindingCount,
    chainId: verified.chainId,
    recordCount: verified.recordCount,
    terminalRecordHash: verified.terminalHash,
    sourceAuthenticity: verified.sourceAuthenticity,
    trustedAnchors: verified.trustedAnchors,
    lifecycleReplayPerformed: false,
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    economics: 'NOT_ESTIMABLE',
  };

  if (!integrityOnly) {
    const imported = await import(pathToFileURL(DEFAULT_CORE_REPLAY_MODULE).href);
    const replay = imported.replayVolumeForwardMeasurementEvidence;
    invariant(typeof replay === 'function', 'VE2_REPLAY_CORE_EXPORT_MISSING');
    const coreResult = await replay({
      evidenceRecords: verified.records,
      expectedPolicyDigest,
      expectedTerminalHash,
    });
    const checked = verifyShadowOnlyResult(
      coreResult,
      expectedPolicyDigest,
      expectedTerminalHash,
    );
    result = {
      ...result,
      state: 'SHADOW_RECORD_ONLY_REPLAY_COMPLETE',
      lifecycleReplayPerformed: true,
      replay: {
        schemaVersion: checked.schemaVersion,
        state: checked.state,
        reasonCodes: checked.reasonCodes,
        lifecycleCount: Array.isArray(checked.lifecycles)
          ? checked.lifecycles.length
          : null,
        mode: checked.mode,
        recordOnly: checked.recordOnly,
        strategyEnabled: checked.strategyEnabled,
        killSwitchEngaged: checked.killSwitchEngaged,
        externalEffects: 0,
        economics: null,
        profitabilityClaim: false,
        sourceAuthenticity: checked.sourceAuthenticity,
        trustedAnchors: checked.trustedAnchors,
        replayProfile: checked.replayProfile,
        segmentFacts: checked.segmentFacts,
      },
    };
  }

  const bytes = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath !== null) {
    writeFileSync(resolve(outputPath), bytes, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  }
  return Object.freeze(result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseReplayArgs(process.argv.slice(2));
  const result = await replayEvidence({
    evidencePath: options.evidence,
    expectedPolicyDigest: options.expectedPolicyDigest,
    expectedTerminalHash: options.expectedTerminalHash,
    integrityOnly: options.integrityOnly,
    outputPath: options.output,
  });
  process.stdout.write(
    `VE2_REPLAY ${result.state} records=${result.recordCount} gate=${result.consumerGate}\n`,
  );
}
