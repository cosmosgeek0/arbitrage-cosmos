#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '../..');
const REPORT_RELATIVE = 'verification/product-truth-20260716/C5_LIVE_REMOTE_GATE_REPORT.json';
const REPORT_PATH = resolve(ROOT, REPORT_RELATIVE);
const BRANCH = 'truth-campaign-20260716';
const C2 = 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561';
const C3 = '78f708d6cdb9d1618c53d3f08f71097b4320a63b';
const C4 = '4c9143a0bcc331aa170e9e26b741240b39df8b9e';
const C5 = '959a5f9900e25f53414710bbfb3464c3ccb67a5d';
const PRIOR_REMOTE_EVIDENCE = 'fd6a277057fb5b360bd297cfcbdffcaaa915ba64';
const BUNDLE_PATH = resolve(homedir(), 'cosmos-arbitrage-C5-20260717.bundle');
const BUNDLE_TEMP_PATH = `${BUNDLE_PATH}.tmp-${String(process.pid)}`;
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function shellWord(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function commandText(command, args) {
  return [command, ...args].map(shellWord).join(' ');
}

function outputTail(value, maximumLines = 80) {
  return value.split(/\r?\n/u).filter(Boolean).slice(-maximumLines);
}

function emittedTestEvidence(output) {
  const explicitSummaries = [];
  const passingRatios = [];
  const skipSummaries = [];
  const unexpectedSkipMarkers = [];
  for (const line of output.split(/\r?\n/u)) {
    let match = line.match(/^\s*(?:#|ℹ|i)\s*tests\s+(\d+)\s*$/iu);
    if (match !== null) explicitSummaries.push({ line: line.trim(), count: Number(match[1]) });
    match = line.match(/^\s*Tests:\s*(\d+)\s+passed(?:,\s*(\d+)\s+total)?/iu);
    if (match !== null) {
      explicitSummaries.push({ line: line.trim(), count: Number(match[2] ?? match[1]) });
    }
    match = line.match(/(?:^|[=\s])(?<passed>\d+)\s+passed(?:\s+in\s+[\d.]+s|[,\s=]|$)/iu);
    if (match?.groups?.passed !== undefined && !/^\s*Tests:/iu.test(line)) {
      explicitSummaries.push({ line: line.trim(), count: Number(match.groups.passed) });
    }
    for (const ratio of line.matchAll(/\b(\d+)\/(\d+)\b/gu)) {
      const passed = Number(ratio[1]);
      const total = Number(ratio[2]);
      if (passed === total && total > 0) passingRatios.push({ line: line.trim(), passed, total });
    }
    match = line.match(/^\s*(?:#|ℹ|i)\s*(skipped|todo)\s+(\d+)\s*$/iu);
    if (match !== null) {
      const count = Number(match[2]);
      skipSummaries.push({ line: line.trim(), kind: match[1].toLowerCase(), count });
      if (count > 0) unexpectedSkipMarkers.push(line.trim());
    }
    if (/^\s*(?:not\s+)?ok\b.*#\s*(?:SKIP|TODO)\b/iu.test(line)) {
      unexpectedSkipMarkers.push(line.trim());
    }
    match = line.match(/(?:^|[,\s=])(?<count>[1-9]\d*)\s+skipped(?:[,\s=]|$)/iu);
    if (match?.groups?.count !== undefined) unexpectedSkipMarkers.push(line.trim());
  }
  const uniqueRatios = [...new Map(
    passingRatios.map((row) => [`${row.line}\0${row.passed}\0${row.total}`, row]),
  ).values()];
  const testCount = explicitSummaries.length > 0
    ? explicitSummaries.reduce((total, row) => total + row.count, 0)
    : uniqueRatios.reduce((total, row) => total + row.total, 0);
  return {
    test_count: testCount > 0 ? testCount : null,
    test_count_basis: explicitSummaries.length > 0
      ? 'SUM_OF_EXACT_EMITTED_TEST_SUMMARY_COUNTS'
      : 'SUM_OF_UNIQUE_EXACT_PASSING_RATIO_TOTALS',
    explicit_test_summaries: explicitSummaries,
    passing_ratio_evidence: uniqueRatios,
    skip_summaries: skipSummaries,
    unexpected_skip_markers: [...new Set(unexpectedSkipMarkers)],
  };
}

function packageEvidence(output) {
  const events = [];
  for (const match of output.matchAll(/\b(added|audited)\s+(\d+)\s+packages?\b/giu)) {
    events.push({ kind: match[1].toLowerCase(), count: Number(match[2]) });
  }
  return events;
}

function firstCausalError(stderr, stdout) {
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /^(?:fatal:|npm error|error:|AssertionError|not ok\b|✖\s)/iu.test(line))
    ?? lines.find((line) => /(?:fatal|error|failed|failure|missing|not found|assert)/iu.test(line))
    ?? lines[0]
    ?? 'COMMAND_FAILED_WITHOUT_OUTPUT';
}

const report = {
  schema: 'product-truth-c5-live-remote-custody-gate.v1',
  generated_at_utc: new Date().toISOString(),
  actor_role: 'ACCOUNT_A_CANDIDATE_CUSTODIAN',
  actor_write_permission: 'CAMPAIGN_EVIDENCE_AND_AUTHORIZED_CAMPAIGN_BRANCH_CUSTODY_ONLY',
  final_independent_verifier: false,
  candidate: {
    c5: C5,
    immutable_c2: C2,
    rejected_c3: C3,
    rejected_c4: C4,
    expected_direct_parent: C2,
    tree: null,
  },
  evidence_bridge: {
    tip: null,
    expected_first_parent: C5,
    expected_second_parent: PRIOR_REMOTE_EVIDENCE,
    observed_parents: [],
    source_diff_scope: 'verification/product-truth-20260716/**',
  },
  constraints: {
    current_main_write_authorized: false,
    current_main_push_authorized: false,
    campaign_branch_push_authorized: true,
    force_push_authorized: false,
    merge_to_current_main_authorized: false,
    required_battery_sequence: 'npm ci && npm test && npm run test:all',
    remote_mutation_commands_performed: [],
  },
  preflight: { command_ids: [], result: 'NOT_RUN' },
  environment: { command_ids: [], normalized: null, digest_sha256: null },
  campaign_push: { command_ids: [], result: 'NOT_RUN' },
  bundle: { path: BUNDLE_PATH, command_ids: [], clone_command_ids: [], result: 'NOT_RUN' },
  live_remote: { before_command_ids: [], after_command_ids: [], result: 'NOT_RUN' },
  live_remote_clone: {
    setup_command_ids: [],
    topology_command_ids: [],
    input_command_ids: [],
    battery_command_ids: [],
    final_command_ids: [],
    result: 'NOT_RUN',
  },
  current_main: { before: null, after: null, changed_during_gate: null },
  actions: [],
  commands: [],
  command_execution_count: 0,
  all_required_checks_passed: false,
  baseline_token_permitted: false,
  failure: null,
};

function flushReport() {
  report.command_execution_count = report.commands.length;
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

async function capture(command, args, {
  cwd = ROOT,
  kind = 'probe',
  expectedExitCodes = [0],
} = {}) {
  const rendered = commandText(command, args);
  const startedAt = new Date().toISOString();
  process.stderr.write(`[c5-live] START ${rendered}\n`);
  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      LC_ALL: 'C',
      TZ: 'UTC',
      GIT_OPTIONAL_LOCKS: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
  const heartbeat = setInterval(() => {
    process.stderr.write(`[c5-live] RUNNING ${rendered}\n`);
  }, 30_000);
  const { exitCode, signal } = await new Promise((accept, reject) => {
    child.on('error', reject);
    child.on('close', (code, closeSignal) => accept({ exitCode: code ?? 1, signal: closeSignal }));
  });
  clearInterval(heartbeat);
  const endedAt = new Date().toISOString();
  const stdout = Buffer.concat(stdoutChunks);
  const stderr = Buffer.concat(stderrChunks);
  const combined = Buffer.concat([stdout, stderr]);
  const outputText = `${stdout.toString('utf8')}\n${stderr.toString('utf8')}`;
  const testEvidence = kind === 'test' ? emittedTestEvidence(outputText) : {
    test_count: 0,
    test_count_basis: 'NOT_A_TEST_COMMAND',
    explicit_test_summaries: [],
    passing_ratio_evidence: [],
    skip_summaries: [],
    unexpected_skip_markers: [],
  };
  const record = {
    command_id: `command-${String(report.commands.length + 1).padStart(3, '0')}`,
    command: rendered,
    argv: [command, ...args],
    cwd,
    kind,
    started_at_utc: startedAt,
    ended_at_utc: endedAt,
    exit_code: exitCode,
    signal,
    expected_exit_codes: expectedExitCodes,
    exit_code_expected: expectedExitCodes.includes(exitCode),
    stdout_sha256: sha256(stdout),
    stderr_sha256: sha256(stderr),
    output_sha256: sha256(combined),
    output_digest_rule: 'SHA256_OF_STDOUT_BYTES_THEN_STDERR_BYTES',
    stdout_byte_length: stdout.length,
    stderr_byte_length: stderr.length,
    package_events: kind === 'install' ? packageEvidence(outputText) : [],
    ...testEvidence,
  };
  if (!record.exit_code_expected) {
    record.stdout_tail = outputTail(stdout.toString('utf8'));
    record.stderr_tail = outputTail(stderr.toString('utf8'));
  }
  report.commands.push(record);
  flushReport();
  process.stderr.write(`[c5-live] END exit=${exitCode} output=${record.output_sha256} ${rendered}\n`);
  return {
    record,
    stdout: stdout.toString('utf8'),
    stderr: stderr.toString('utf8'),
    combinedText: outputText,
  };
}

function addCommand(bucket, result) {
  bucket.push(result.record.command_id);
  flushReport();
  return result;
}

function failClosed(record, causalError) {
  report.failure = {
    command_id: record?.command_id ?? null,
    command: record?.command ?? 'INTERNAL_EVIDENCE_VALIDATION',
    exit_code: record?.exit_code ?? 1,
    first_causal_error: causalError,
    affected_evidence_path: REPORT_RELATIVE,
    observed_at_utc: new Date().toISOString(),
  };
  report.all_required_checks_passed = false;
  report.baseline_token_permitted = false;
  flushReport();
  const error = new Error(causalError);
  error.reported = true;
  throw error;
}

function requirePassing(result, { requireTestEvidence = false } = {}) {
  const { record, stderr, stdout } = result;
  if (!record.exit_code_expected) failClosed(record, firstCausalError(stderr, stdout));
  if (!SHA256.test(record.output_sha256)) failClosed(record, 'OUTPUT_DIGEST_MISSING_OR_INVALID');
  if (requireTestEvidence && (!Number.isInteger(record.test_count) || record.test_count <= 0)) {
    failClosed(record, 'MISSING_EXACT_TEST_COUNT_EVIDENCE');
  }
  if (requireTestEvidence && record.unexpected_skip_markers.length > 0) {
    failClosed(record, `UNEXPECTED_TEST_SKIP:${record.unexpected_skip_markers[0]}`);
  }
}

function parseSingleSha(value, label) {
  const parsed = value.trim();
  if (!FULL_SHA.test(parsed)) failClosed(null, `${label}_INVALID:${parsed}`);
  return parsed;
}

function parseSingleInteger(value, label) {
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 0) failClosed(null, `${label}_INVALID:${value.trim()}`);
  return parsed;
}

function parseLsRemote(output, ref, label) {
  const matches = output.split(/\r?\n/u).filter(Boolean).map((line) => line.split(/\s+/u))
    .filter((parts) => parts[1] === ref);
  if (matches.length !== 1 || !FULL_SHA.test(matches[0][0] ?? '')) failClosed(null, `${label}_INVALID`);
  return matches[0][0];
}

function parseStatusPaths(output) {
  return output.split('\0').filter(Boolean).map((entry) => {
    const value = entry.slice(3);
    const arrow = value.lastIndexOf(' -> ');
    return arrow === -1 ? value : value.slice(arrow + 4);
  }).sort();
}

function listObjectFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return listObjectFiles(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}

function hardlinkAudit(clonePath, label) {
  const startedAt = new Date().toISOString();
  const objectRoot = resolve(clonePath, '.git/objects');
  const files = listObjectFiles(objectRoot);
  const linked = files.filter((file) => statSync(file).nlink > 1);
  const alternatesPath = resolve(objectRoot, 'info/alternates');
  const evidence = {
    label,
    requested_clone_flag: '--no-hardlinks',
    object_files_checked: files.length,
    max_link_count: files.reduce((maximum, file) => Math.max(maximum, statSync(file).nlink), 0),
    hardlinked_object_file_count: linked.length,
    hardlinked_object_files: linked.map((file) => file.slice(clonePath.length + 1)),
    alternates_path: alternatesPath,
    alternates_present: existsSync(alternatesPath),
    passed: files.length > 0 && linked.length === 0 && !existsSync(alternatesPath),
  };
  report.actions.push({
    action: `HARDLINK_AUDIT:${label}`,
    started_at_utc: startedAt,
    ended_at_utc: new Date().toISOString(),
    exit_code: evidence.passed ? 0 : 1,
    count: files.length,
    count_basis: 'GIT_OBJECT_FILES_INSPECTED',
    evidence,
    evidence_sha256: sha256(Buffer.from(JSON.stringify(evidence))),
  });
  flushReport();
  if (!evidence.passed) failClosed(null, `${label}_HARDLINK_AUDIT_FAILED`);
  return evidence;
}

function worktreeCount(output) {
  return output.split('\0').filter((field) => field.startsWith('worktree ')).length;
}

async function localCurrentMainSnapshot(bucket) {
  const local = addCommand(bucket, await capture('git', ['rev-parse', 'refs/heads/current-main']));
  const cached = addCommand(bucket, await capture('git', ['rev-parse', 'refs/remotes/origin/current-main']));
  requirePassing(local);
  requirePassing(cached);
  return {
    local: parseSingleSha(local.stdout, 'LOCAL_CURRENT_MAIN'),
    cached_origin: parseSingleSha(cached.stdout, 'CACHED_ORIGIN_CURRENT_MAIN'),
  };
}

async function liveRemoteSnapshot(remoteUrl, bucket) {
  const campaign = addCommand(bucket, await capture('git', [
    'ls-remote', '--exit-code', '--heads', remoteUrl, `refs/heads/${BRANCH}`,
  ]));
  const currentMain = addCommand(bucket, await capture('git', [
    'ls-remote', '--exit-code', '--heads', remoteUrl, 'refs/heads/current-main',
  ]));
  requirePassing(campaign);
  requirePassing(currentMain);
  return {
    campaign: parseLsRemote(campaign.stdout, `refs/heads/${BRANCH}`, 'LIVE_CAMPAIGN_REF'),
    current_main: parseLsRemote(currentMain.stdout, 'refs/heads/current-main', 'LIVE_CURRENT_MAIN_REF'),
  };
}

async function verifyClone(clonePath, label, expectedRemoteUrl = null) {
  const bucket = label === 'BUNDLE_CLONE'
    ? report.bundle.clone_command_ids
    : report.live_remote_clone.topology_command_ids;
  const initialHead = addCommand(bucket, await capture('git', ['rev-parse', 'HEAD'], { cwd: clonePath }));
  const initialBranch = addCommand(bucket, await capture('git', ['branch', '--show-current'], { cwd: clonePath }));
  const initialParents = addCommand(bucket, await capture('git', ['show', '-s', '--format=%P', 'HEAD'], { cwd: clonePath }));
  const detach = addCommand(bucket, await capture('git', ['checkout', '--detach', C5], { cwd: clonePath }));
  const head = addCommand(bucket, await capture('git', ['rev-parse', 'HEAD'], { cwd: clonePath }));
  const symbolic = addCommand(bucket, await capture('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: clonePath, expectedExitCodes: [1] }));
  const candidateType = addCommand(bucket, await capture('git', ['cat-file', '-t', C5], { cwd: clonePath }));
  const candidateTree = addCommand(bucket, await capture('git', ['rev-parse', `${C5}^{tree}`], { cwd: clonePath }));
  const candidateParents = addCommand(bucket, await capture('git', ['show', '-s', '--format=%P', C5], { cwd: clonePath }));
  const candidateReachable = addCommand(bucket, await capture('git', ['merge-base', '--is-ancestor', C5, `refs/heads/${BRANCH}`], { cwd: clonePath }));
  const c3Ancestor = addCommand(bucket, await capture('git', ['merge-base', '--is-ancestor', C3, C5], { cwd: clonePath, expectedExitCodes: [1] }));
  const c4Ancestor = addCommand(bucket, await capture('git', ['merge-base', '--is-ancestor', C4, C5], { cwd: clonePath, expectedExitCodes: [1] }));
  const localRefs = addCommand(bucket, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/heads'], { cwd: clonePath }));
  const remoteRefs = addCommand(bucket, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin'], { cwd: clonePath }));
  const allRefs = addCommand(bucket, await capture('git', ['for-each-ref', '--format=%(refname)', 'refs'], { cwd: clonePath }));
  const fetchRefspec = addCommand(bucket, await capture('git', ['config', '--get-all', 'remote.origin.fetch'], { cwd: clonePath }));
  const cloneRemote = addCommand(bucket, await capture('git', ['remote', 'get-url', 'origin'], { cwd: clonePath }));
  const worktrees = addCommand(bucket, await capture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: clonePath }));
  const shallow = addCommand(bucket, await capture('git', ['rev-parse', '--is-shallow-repository'], { cwd: clonePath }));
  const localCurrentMain = addCommand(bucket, await capture('git', ['show-ref', '--verify', '--quiet', 'refs/heads/current-main'], { cwd: clonePath, expectedExitCodes: [1] }));
  const remoteCurrentMain = addCommand(bucket, await capture('git', ['show-ref', '--verify', '--quiet', 'refs/remotes/origin/current-main'], { cwd: clonePath, expectedExitCodes: [1] }));
  const fsck = addCommand(bucket, await capture('git', ['fsck', '--full', '--strict'], { cwd: clonePath }));
  const clean = addCommand(bucket, await capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: clonePath }));
  const results = [initialHead, initialBranch, initialParents, detach, head, symbolic, candidateType,
    candidateTree, candidateParents, candidateReachable, c3Ancestor, c4Ancestor, localRefs,
    remoteRefs, allRefs, fetchRefspec, cloneRemote, worktrees, shallow, localCurrentMain,
    remoteCurrentMain, fsck, clean];
  for (const result of results) requirePassing(result);

  const localRefList = localRefs.stdout.trim().split(/\r?\n/u).filter(Boolean);
  const remoteRefList = remoteRefs.stdout.trim().split(/\r?\n/u)
    .filter((ref) => ref !== 'refs/remotes/origin/HEAD' && ref !== '');
  const currentMainPresent = allRefs.stdout.split(/\r?\n/u).some((ref) => (
    ref === 'refs/heads/current-main' || ref === 'refs/remotes/origin/current-main'
  ));
  const bridgeParents = initialParents.stdout.trim().split(/\s+/u).filter(Boolean);
  const candidateParentList = candidateParents.stdout.trim().split(/\s+/u).filter(Boolean);
  const hardlinks = hardlinkAudit(clonePath, label);
  const valid = initialHead.stdout.trim() === report.evidence_bridge.tip
    && initialBranch.stdout.trim() === BRANCH
    && JSON.stringify(bridgeParents) === JSON.stringify([C5, PRIOR_REMOTE_EVIDENCE])
    && head.stdout.trim() === C5
    && symbolic.record.exit_code === 1
    && candidateType.stdout.trim() === 'commit'
    && candidateTree.stdout.trim() === report.candidate.tree
    && JSON.stringify(candidateParentList) === JSON.stringify([C2])
    && c3Ancestor.record.exit_code === 1
    && c4Ancestor.record.exit_code === 1
    && JSON.stringify(localRefList) === JSON.stringify([`refs/heads/${BRANCH}`])
    && JSON.stringify(remoteRefList) === JSON.stringify([`refs/remotes/origin/${BRANCH}`])
    && fetchRefspec.stdout.trim() === `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`
    && (expectedRemoteUrl === null || cloneRemote.stdout.trim() === expectedRemoteUrl)
    && worktreeCount(worktrees.stdout) === 1
    && shallow.stdout.trim() === 'false'
    && !currentMainPresent
    && localCurrentMain.record.exit_code === 1
    && remoteCurrentMain.record.exit_code === 1
    && clean.stdout.trim() === ''
    && hardlinks.passed;
  if (!valid) failClosed(head.record, `${label}_TOPOLOGY_INVALID`);
  return {
    initial_head: initialHead.stdout.trim(),
    initial_branch: initialBranch.stdout.trim(),
    initial_parents: bridgeParents,
    detached_head: head.stdout.trim(),
    candidate_tree: candidateTree.stdout.trim(),
    candidate_parents: candidateParentList,
    local_branch_refs: localRefList,
    remote_tracking_branch_refs: remoteRefList,
    fetch_refspec: fetchRefspec.stdout.trim(),
    current_main_ref_present: currentMainPresent,
    shallow: false,
    worktree_count: 1,
    hardlink_audit: hardlinks,
    final_clean: true,
  };
}

let tempRoot = null;

async function main() {
  flushReport();
  try {
    const branch = addCommand(report.preflight.command_ids, await capture('git', ['branch', '--show-current']));
    const head = addCommand(report.preflight.command_ids, await capture('git', ['rev-parse', 'HEAD']));
    const bridgeParents = addCommand(report.preflight.command_ids, await capture('git', ['show', '-s', '--format=%P', 'HEAD']));
    const campaignRef = addCommand(report.preflight.command_ids, await capture('git', ['rev-parse', `refs/heads/${BRANCH}`]));
    const candidateType = addCommand(report.preflight.command_ids, await capture('git', ['cat-file', '-t', C5]));
    const candidateTree = addCommand(report.preflight.command_ids, await capture('git', ['rev-parse', `${C5}^{tree}`]));
    const candidateParents = addCommand(report.preflight.command_ids, await capture('git', ['show', '-s', '--format=%P', C5]));
    const c2Ancestor = addCommand(report.preflight.command_ids, await capture('git', ['merge-base', '--is-ancestor', C2, C5]));
    const c3Ancestor = addCommand(report.preflight.command_ids, await capture('git', ['merge-base', '--is-ancestor', C3, C5], { expectedExitCodes: [1] }));
    const c4Ancestor = addCommand(report.preflight.command_ids, await capture('git', ['merge-base', '--is-ancestor', C4, C5], { expectedExitCodes: [1] }));
    const priorAncestor = addCommand(report.preflight.command_ids, await capture('git', ['merge-base', '--is-ancestor', PRIOR_REMOTE_EVIDENCE, 'HEAD']));
    const evidencePaths = addCommand(report.preflight.command_ids, await capture('git', ['diff', '--name-only', C5, 'HEAD']));
    const status = addCommand(report.preflight.command_ids, await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    const remoteUrlResult = addCommand(report.preflight.command_ids, await capture('git', ['remote', 'get-url', 'origin']));
    for (const result of [branch, head, bridgeParents, campaignRef, candidateType, candidateTree,
      candidateParents, c2Ancestor, c3Ancestor, c4Ancestor, priorAncestor, evidencePaths,
      status, remoteUrlResult]) requirePassing(result);

    const bridgeTip = parseSingleSha(head.stdout, 'EVIDENCE_BRIDGE_TIP');
    const observedBridgeParents = bridgeParents.stdout.trim().split(/\s+/u).filter(Boolean);
    const observedCandidateParents = candidateParents.stdout.trim().split(/\s+/u).filter(Boolean);
    const evidenceOnlyPaths = evidencePaths.stdout.trim().split(/\r?\n/u).filter(Boolean);
    const dirtyPaths = parseStatusPaths(status.stdout);
    const remoteUrl = remoteUrlResult.stdout.trim();
    report.evidence_bridge.tip = bridgeTip;
    report.evidence_bridge.observed_parents = observedBridgeParents;
    report.evidence_bridge.paths = evidenceOnlyPaths;
    report.candidate.tree = parseSingleSha(candidateTree.stdout, 'C5_TREE');
    const preflightValid = branch.stdout.trim() === BRANCH
      && campaignRef.stdout.trim() === bridgeTip
      && candidateType.stdout.trim() === 'commit'
      && JSON.stringify(observedCandidateParents) === JSON.stringify([C2])
      && JSON.stringify(observedBridgeParents) === JSON.stringify([C5, PRIOR_REMOTE_EVIDENCE])
      && c3Ancestor.record.exit_code === 1
      && c4Ancestor.record.exit_code === 1
      && evidenceOnlyPaths.length > 0
      && evidenceOnlyPaths.every((pathValue) => pathValue.startsWith('verification/product-truth-20260716/'))
      && JSON.stringify(dirtyPaths) === JSON.stringify([REPORT_RELATIVE])
      && remoteUrl.length > 0
      && !/https?:\/\/[^/@]+@/iu.test(remoteUrl);
    if (!preflightValid) failClosed(head.record, 'SOURCE_PREFLIGHT_INVALID');
    report.preflight.result = 'PASS_C5_IMMUTABLE_EVIDENCE_ONLY_FAST_FORWARD_BRIDGE';
    report.preflight.dirty_paths = dirtyPaths;
    report.preflight.remote_url = remoteUrl;
    report.current_main.before = await localCurrentMainSnapshot(report.preflight.command_ids);
    if (report.current_main.before.local !== report.current_main.before.cached_origin) {
      failClosed(null, 'CURRENT_MAIN_LOCAL_AND_CACHED_ORIGIN_DIFFER_BEFORE_GATE');
    }

    const gitVersion = addCommand(report.environment.command_ids, await capture('git', ['--version']));
    const nodeVersion = addCommand(report.environment.command_ids, await capture('node', ['--version']));
    const npmVersion = addCommand(report.environment.command_ids, await capture('npm', ['--version']));
    const osVersion = addCommand(report.environment.command_ids, await capture('sw_vers', ['-productVersion']));
    const architecture = addCommand(report.environment.command_ids, await capture('uname', ['-m']));
    for (const result of [gitVersion, nodeVersion, npmVersion, osVersion, architecture]) requirePassing(result);
    report.environment.normalized = {
      git: gitVersion.stdout.trim(),
      node: nodeVersion.stdout.trim(),
      npm: npmVersion.stdout.trim(),
      macos: osVersion.stdout.trim(),
      architecture: architecture.stdout.trim(),
    };
    report.environment.digest_sha256 = sha256(Buffer.from(JSON.stringify(report.environment.normalized)));
    flushReport();

    const liveBefore = await liveRemoteSnapshot(remoteUrl, report.live_remote.before_command_ids);
    report.live_remote.before = liveBefore;
    if (liveBefore.campaign !== PRIOR_REMOTE_EVIDENCE
      || liveBefore.current_main !== report.current_main.before.local) {
      failClosed(null, 'LIVE_REMOTE_REF_MISMATCH_BEFORE_AUTHORIZED_PUSH');
    }

    const push = addCommand(report.campaign_push.command_ids, await capture('git', [
      'push', '--porcelain', 'origin',
      `refs/heads/${BRANCH}:refs/heads/${BRANCH}`,
    ]));
    requirePassing(push);
    report.constraints.remote_mutation_commands_performed.push(push.record.command_id);
    if (push.record.command.includes('--force') || push.record.command.includes('current-main')) {
      failClosed(push.record, 'FORBIDDEN_PUSH_FORM_DETECTED');
    }
    const livePushed = await liveRemoteSnapshot(remoteUrl, report.campaign_push.command_ids);
    if (livePushed.campaign !== bridgeTip || livePushed.current_main !== liveBefore.current_main) {
      failClosed(null, 'LIVE_REMOTE_REF_NOT_EXACT_LOCAL_TIP_AFTER_PUSH');
    }
    report.campaign_push.before = liveBefore.campaign;
    report.campaign_push.after = livePushed.campaign;
    report.campaign_push.local_tip = bridgeTip;
    report.campaign_push.fast_forward_from = PRIOR_REMOTE_EVIDENCE;
    report.campaign_push.origin_equals_local_tip = true;
    report.campaign_push.result = 'PASS_AUTHORIZED_NON_FORCE_CAMPAIGN_ONLY_FAST_FORWARD';
    flushReport();

    if (existsSync(BUNDLE_TEMP_PATH)) rmSync(BUNDLE_TEMP_PATH, { force: true });
    const bundleCreate = addCommand(report.bundle.command_ids, await capture('git', [
      'bundle', 'create', BUNDLE_TEMP_PATH,
      `refs/heads/${BRANCH}`,
      'refs/heads/current-main',
    ]));
    const tempVerify = addCommand(report.bundle.command_ids, await capture('git', ['bundle', 'verify', BUNDLE_TEMP_PATH]));
    const tempHeads = addCommand(report.bundle.command_ids, await capture('git', [
      'bundle', 'list-heads', BUNDLE_TEMP_PATH,
      `refs/heads/${BRANCH}`,
      'refs/heads/current-main',
    ]));
    for (const result of [bundleCreate, tempVerify, tempHeads]) requirePassing(result);
    const tempCampaign = parseLsRemote(tempHeads.stdout, `refs/heads/${BRANCH}`, 'TEMP_BUNDLE_CAMPAIGN');
    const tempCurrentMain = parseLsRemote(tempHeads.stdout, 'refs/heads/current-main', 'TEMP_BUNDLE_CURRENT_MAIN');
    if (tempCampaign !== bridgeTip
      || tempCurrentMain !== report.current_main.before.local
      || !/records a complete history/iu.test(tempVerify.combinedText)) {
      failClosed(tempVerify.record, 'TEMP_BUNDLE_REF_OR_COMPLETENESS_INVALID');
    }
    const replaceBundle = addCommand(report.bundle.command_ids, await capture('mv', ['-f', BUNDLE_TEMP_PATH, BUNDLE_PATH]));
    requirePassing(replaceBundle);
    const bundleDigest = addCommand(report.bundle.command_ids, await capture('shasum', ['-a', '256', BUNDLE_PATH]));
    const bundleStat = addCommand(report.bundle.command_ids, await capture('stat', ['-f', '%z', BUNDLE_PATH]));
    const bundleVerify = addCommand(report.bundle.command_ids, await capture('git', ['bundle', 'verify', BUNDLE_PATH]));
    const bundleHeads = addCommand(report.bundle.command_ids, await capture('git', [
      'bundle', 'list-heads', BUNDLE_PATH,
      `refs/heads/${BRANCH}`,
      'refs/heads/current-main',
    ]));
    for (const result of [bundleDigest, bundleStat, bundleVerify, bundleHeads]) requirePassing(result);
    const observedBundleSha = bundleDigest.stdout.trim().split(/\s+/u)[0] ?? '';
    const bundleCampaign = parseLsRemote(bundleHeads.stdout, `refs/heads/${BRANCH}`, 'BUNDLE_CAMPAIGN');
    const bundleCurrentMain = parseLsRemote(bundleHeads.stdout, 'refs/heads/current-main', 'BUNDLE_CURRENT_MAIN');
    if (!SHA256.test(observedBundleSha)
      || bundleCampaign !== bridgeTip
      || bundleCurrentMain !== report.current_main.before.local
      || !/records a complete history/iu.test(bundleVerify.combinedText)) {
      failClosed(bundleDigest.record, 'FINAL_BUNDLE_DIGEST_REF_OR_COMPLETENESS_INVALID');
    }
    Object.assign(report.bundle, {
      sha256: observedBundleSha,
      byte_length: parseSingleInteger(bundleStat.stdout, 'BUNDLE_BYTE_LENGTH'),
      complete_history: true,
      campaign_head: bundleCampaign,
      current_main_head: bundleCurrentMain,
    });
    flushReport();

    tempRoot = mkdtempSync(join(tmpdir(), 'truth-a-c5-live-custody-'));
    const bundleClonePath = resolve(tempRoot, 'bundle-clone');
    const liveClonePath = resolve(tempRoot, 'live-remote-clone');
    const bundleClone = addCommand(report.bundle.clone_command_ids, await capture('git', [
      'clone', '--no-hardlinks', '--single-branch', '--branch', BRANCH,
      BUNDLE_PATH, bundleClonePath,
    ]));
    requirePassing(bundleClone);
    report.bundle.clone = await verifyClone(bundleClonePath, 'BUNDLE_CLONE');
    report.bundle.result = 'PASS_REBUILT_COMPLETE_HISTORY_DIGEST_AND_INDEPENDENT_CLONE';
    flushReport();

    const liveClone = addCommand(report.live_remote_clone.setup_command_ids, await capture('git', [
      'clone', '--no-hardlinks', '--single-branch', '--branch', BRANCH,
      remoteUrl, liveClonePath,
    ]));
    requirePassing(liveClone);
    report.live_remote_clone.topology = await verifyClone(liveClonePath, 'LIVE_REMOTE_CLONE', remoteUrl);
    report.live_remote_clone.source_transport = 'LIVE_REMOTE_SSH';
    report.live_remote_clone.clone_flags = ['--no-hardlinks', '--single-branch', '--branch', BRANCH];
    flushReport();

    const lockPaths = addCommand(report.live_remote_clone.input_command_ids, await capture('git', ['ls-files', '*package-lock.json'], { cwd: liveClonePath }));
    const lockDigest = addCommand(report.live_remote_clone.input_command_ids, await capture('shasum', ['-a', '256', 'package-lock.json'], { cwd: liveClonePath }));
    const lockBlob = addCommand(report.live_remote_clone.input_command_ids, await capture('git', ['rev-parse', `${C5}:package-lock.json`], { cwd: liveClonePath }));
    for (const result of [lockPaths, lockDigest, lockBlob]) requirePassing(result);
    const observedLockPaths = lockPaths.stdout.trim().split(/\r?\n/u).filter(Boolean);
    const observedLockSha = lockDigest.stdout.trim().split(/\s+/u)[0] ?? '';
    if (JSON.stringify(observedLockPaths) !== JSON.stringify(['package-lock.json'])
      || !SHA256.test(observedLockSha)) {
      failClosed(lockDigest.record, 'DEPENDENCY_LOCK_EVIDENCE_INVALID');
    }
    report.live_remote_clone.dependency_lock = {
      paths: observedLockPaths,
      package_lock_sha256: observedLockSha,
      package_lock_git_blob: parseSingleSha(lockBlob.stdout, 'PACKAGE_LOCK_GIT_BLOB'),
    };
    flushReport();

    for (const [command, args, kind] of [
      ['npm', ['ci'], 'install'],
      ['npm', ['test'], 'test'],
      ['npm', ['run', 'test:all'], 'test'],
    ]) {
      const result = addCommand(report.live_remote_clone.battery_command_ids, await capture(
        command, args, { cwd: liveClonePath, kind },
      ));
      requirePassing(result, { requireTestEvidence: kind === 'test' });
    }

    const finalClean = addCommand(report.live_remote_clone.final_command_ids, await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: liveClonePath }));
    const finalHead = addCommand(report.live_remote_clone.final_command_ids, await capture('git', ['rev-parse', 'HEAD'], { cwd: liveClonePath }));
    requirePassing(finalClean);
    requirePassing(finalHead);
    report.live_remote_clone.final_clean = finalClean.stdout === '';
    report.live_remote_clone.final_head = finalHead.stdout.trim();
    if (!report.live_remote_clone.final_clean || report.live_remote_clone.final_head !== C5) {
      failClosed(finalClean.record, 'LIVE_REMOTE_CLONE_FINAL_STATE_INVALID');
    }
    report.live_remote_clone.result = 'PASS_EXACT_C5_LIVE_REMOTE_LITERAL_CLEAN_CLONE';
    flushReport();

    const liveAfter = await liveRemoteSnapshot(remoteUrl, report.live_remote.after_command_ids);
    report.live_remote.after = liveAfter;
    if (liveAfter.campaign !== bridgeTip || liveAfter.current_main !== liveBefore.current_main) {
      failClosed(null, 'LIVE_REMOTE_REFS_CHANGED_DURING_GATE');
    }
    report.live_remote.result = 'PASS_LIVE_REF_STABLE_EXACT_C5_REACHABLE_THROUGH_EVIDENCE_BRIDGE';

    report.current_main.after = await localCurrentMainSnapshot(report.preflight.command_ids);
    report.current_main.changed_during_gate = JSON.stringify(report.current_main.before)
      !== JSON.stringify(report.current_main.after)
      || liveBefore.current_main !== liveAfter.current_main;
    if (report.current_main.changed_during_gate) failClosed(null, 'CURRENT_MAIN_CHANGED_DURING_GATE');

    const finalSourceHead = addCommand(report.preflight.command_ids, await capture('git', ['rev-parse', 'HEAD']));
    const finalSourceStatus = addCommand(report.preflight.command_ids, await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    requirePassing(finalSourceHead);
    requirePassing(finalSourceStatus);
    if (finalSourceHead.stdout.trim() !== bridgeTip
      || JSON.stringify(parseStatusPaths(finalSourceStatus.stdout)) !== JSON.stringify([REPORT_RELATIVE])) {
      failClosed(finalSourceStatus.record, 'SOURCE_WORKTREE_CHANGED_OUTSIDE_EVIDENCE_REPORT');
    }

    const batteryRecords = report.live_remote_clone.battery_command_ids
      .map((commandId) => report.commands.find((row) => row.command_id === commandId));
    report.all_required_checks_passed = report.preflight.result
        === 'PASS_C5_IMMUTABLE_EVIDENCE_ONLY_FAST_FORWARD_BRIDGE'
      && report.campaign_push.result === 'PASS_AUTHORIZED_NON_FORCE_CAMPAIGN_ONLY_FAST_FORWARD'
      && report.bundle.result === 'PASS_REBUILT_COMPLETE_HISTORY_DIGEST_AND_INDEPENDENT_CLONE'
      && report.live_remote.result === 'PASS_LIVE_REF_STABLE_EXACT_C5_REACHABLE_THROUGH_EVIDENCE_BRIDGE'
      && report.live_remote_clone.result === 'PASS_EXACT_C5_LIVE_REMOTE_LITERAL_CLEAN_CLONE'
      && batteryRecords.length === 3
      && batteryRecords.every((row) => row?.exit_code_expected === true)
      && report.live_remote_clone.final_clean === true
      && report.live_remote_clone.topology.current_main_ref_present === false
      && report.current_main.changed_during_gate === false
      && report.failure === null;
    report.baseline_token_permitted = report.all_required_checks_passed;
    if (!report.all_required_checks_passed) failClosed(null, 'C5_LIVE_REMOTE_GATE_AGGREGATE_FALSE');
    report.completed_at_utc = new Date().toISOString();
    flushReport();
  } finally {
    if (tempRoot !== null && existsSync(tempRoot)) {
      const startedAt = new Date().toISOString();
      rmSync(tempRoot, { recursive: true, force: true });
      const evidence = { path: tempRoot, removed: !existsSync(tempRoot) };
      report.actions.push({
        action: 'REMOVE_TEMPORARY_BUNDLE_AND_LIVE_REMOTE_CLONES',
        started_at_utc: startedAt,
        ended_at_utc: new Date().toISOString(),
        exit_code: evidence.removed ? 0 : 1,
        count: 0,
        evidence,
        evidence_sha256: sha256(Buffer.from(JSON.stringify(evidence))),
      });
      flushReport();
      if (!evidence.removed && report.failure === null) failClosed(null, 'TEMPORARY_CLONE_CLEANUP_FAILED');
    }
    if (existsSync(BUNDLE_TEMP_PATH)) rmSync(BUNDLE_TEMP_PATH, { force: true });
  }

  const battery = report.live_remote_clone.battery_command_ids
    .map((commandId) => report.commands.find((row) => row.command_id === commandId));
  process.stdout.write(`${JSON.stringify({
    c5: C5,
    evidence_bridge: report.evidence_bridge.tip,
    origin_ref: report.live_remote.after.campaign,
    bundle_sha256: report.bundle.sha256,
    npm_ci_exit: battery[0]?.exit_code ?? null,
    npm_test_exit: battery[1]?.exit_code ?? null,
    npm_test_count: battery[1]?.test_count ?? null,
    npm_test_all_exit: battery[2]?.exit_code ?? null,
    npm_test_all_count: battery[2]?.test_count ?? null,
    report: REPORT_RELATIVE,
    gate: `BASELINE_TRUTH_ACCEPTED:${C5}`,
  })}\n`);
}

main().catch((error) => {
  if (report.failure === null) {
    report.failure = {
      command_id: null,
      command: 'INTERNAL_EVIDENCE_VALIDATION',
      exit_code: 1,
      first_causal_error: error instanceof Error ? error.message : String(error),
      affected_evidence_path: REPORT_RELATIVE,
      observed_at_utc: new Date().toISOString(),
    };
    report.all_required_checks_passed = false;
    report.baseline_token_permitted = false;
    flushReport();
  }
  process.stderr.write(`[c5-live] PRECISE_BLOCKED ${JSON.stringify(report.failure)}\n`);
  process.exitCode = 1;
});
