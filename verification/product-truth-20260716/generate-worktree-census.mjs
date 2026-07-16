#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAIN = '/Users/cosmosgeek/Desktop/Main';
const OUTPUT = resolve(
  process.cwd(),
  'verification/product-truth-20260716/WORKTREE_CENSUS.json',
);

const MERGED_RETAINED = [
  'Main',
  'dash-shell',
  'f-bridge',
  'i00-assembly',
  'ip-assur-agent',
  'ip-assur-case',
  'ip-assur-cockpit',
  'ip-assur-hazard',
  'ip-assur-stability',
  'ip-assurance',
  'ip-control',
  'ip-ops',
  'ip-proof',
  'ip-runtime',
  'l09-normal-basis',
  'l10-reverse-basis',
  'l11-volume',
  'l14-controls',
  'l15-infra',
  'live-execution-proof-20260712',
  'q08-derivatives',
  'q09-regime',
  'q11-survival',
  'q13-deep-gate',
  'q14-validation-infra',
  'q15-registry',
  'quant-edge-research-20260712',
  'role4-fix',
  'si-recon',
];

const SUPERSEDED_SAFE = [
  'aiops-prestage',
  'aiops-shadow-a1',
  'aiops-shadow-a2',
  'aiops-shadow-a3',
  'aiops-shadow-a4',
  'aiops-shadow-a5',
  'c-shard-1',
  'c-shard-2',
  'c-shard-3',
  'c-shard-4',
  'c-shard-5',
  'c-shard-6',
  'c2r-validate',
  'ci-hotfix',
  'fix-audit',
  'obs-shadow',
  'ops-shadow',
  'port-plan',
  'preverify',
  'r9-a',
  'r9-b',
  'r9-c',
  'r9-d',
  'replay-shadow',
  'role3-c2',
  'role3-preflight',
  'role3-verify',
  'runbook-shadow',
  'v1',
  'v2',
  'v3',
  'v4',
  'v5',
];

const ABANDONED_SAFE = [
  'f-arena',
  'f-coord',
  'f-decide',
  'f-dock',
  'f-edge',
  'f-lab',
  'f-venue',
  'f1-scout',
  'f10-scout',
  'f11-scout',
  'f12-scout',
  'f13-scout',
  'f2-scout',
  'f3-scout',
  'f4-scout',
  'f5-scout',
  'f6-scout',
  'f7-scout',
  'f8-scout',
  'f9-scout',
];

const SEALED_UNMERGED = [
  'port-a1',
  'port-a2',
  'port-a3',
  'port-a4',
  'port-a5',
  'port-obs',
  'port-ops',
  'port-replay',
  'port-runbook',
  'ip-assur-action',
  'ip-assur-formal',
];

const ACTIVE_DIRTY = [];
const BLOCKED = ['egress-patch', 'truth-a', 'truth-b'];

const CANDIDATE_ADMISSION_LANES = new Set([
  'egress-patch',
  ...SEALED_UNMERGED,
]);

const EXPECTED_TERMINAL_HEADS = {
  'egress-patch': '8db67eee261ea4b8964b5b9c64b22fc3a0c7fbc6',
  'port-a1': '8882644db14fbb924c6a8f97bf5c1d1cebb1453c',
  'port-a2': '6e9efe05890174bfe2ebfb9331c0ea9655061b30',
  'port-a3': '21a0440f32fc28f24c715888e4767632aa9158e4',
  'port-a4': '720d2fe74be83d0d2d83f448637e087c32cafc5b',
  'port-a5': '9769d461f694f12519d7a29483c2f78f4381504d',
  'port-obs': '884526c218f46eb39ce7f23278a421b274160525',
  'port-ops': 'c5c9abb549d9dcfa0ef622e2f6790c9805d358ac',
  'port-replay': '12f0934efac2620022a72e179091a2ee87e9b828',
  'port-runbook': '05d3a1ff3f5bca5c4347e0b4a6f2879f39b9a0a8',
  'ip-assur-formal': 'b491893416006cf529aef02e5dd4a25d6475e7b8',
  'ip-assur-action': 'ca30adf5e97b6697afec49f13073024d953b117b',
};

const GROUPS = {
  MERGED_RETAINED,
  SUPERSEDED_SAFE,
  ABANDONED_SAFE,
  SEALED_UNMERGED,
  ACTIVE_DIRTY,
  BLOCKED,
};

const EXPECTED_NAMES = new Set(Object.values(GROUPS).flat());

const BASE_OVERRIDES = {
  'truth-a': '787b73d108764d628f925ee630bfe2fbef89458e',
  'truth-b': '787b73d108764d628f925ee630bfe2fbef89458e',
  'port-a1': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'port-a2': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'port-a3': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'port-a4': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'port-a5': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'port-obs': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'port-ops': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'port-replay': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'port-runbook': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'egress-patch': '492e3f69b054c85686bcfc4c09dbff4ababeda3f',
  'ci-hotfix': '6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd',
  'ip-assur-formal': '9785c931',
  'ip-assur-action': '8c24a4b6',
};

const RECEIPTS = {
  'ci-hotfix': 'docs/archive/CI_HOTFIX2_RECEIPT.md',
  'egress-patch': 'docs/archive/egress-patch/EGRESS_PATCH_RECEIPT.md',
  'port-a1': 'docs/archive/aiOps/a1/PORT_A1_PRESTAGE_RECEIPT.md',
  'port-a2': 'docs/archive/aiOps/a2/PORT_A2_PRESTAGE_RECEIPT.md',
  'port-a3': 'docs/archive/aiOps/a3/PORT_A3_PRESTAGE_RECEIPT.v1.json',
  'port-a4': 'docs/archive/aiOps/a4/PORT_A4_RECEIPT.md',
  'port-a5': 'docs/archive/aiOps/a5/PORT_A5_PRESTAGE_RECEIPT.md',
  'port-obs': 'fixtures/obsShadow/receipts/PORT_OBS_RECEIPT.v1.json',
  'port-ops': 'fixtures/opsShadow/receipts/PORT_OPS_PRESTAGE_RECEIPT.v1.json',
  'port-replay': 'fixtures/replayShadow/PORT_REPLAY_RECEIPT.md',
  'port-runbook': 'fixtures/runbookShadow/receipts/PORT_RUNBOOK_PRESTAGE_RECEIPT.v1.json',
  'ip-assur-formal':
    'fixtures/productAssurance/systemic/formal/receipts/D_LAUNCH_22_FORMAL_DEEPENING_BATCH_02.md',
  'ip-assur-action':
    'fixtures/productAssurance/systemic/actionEvidence/receipts/ACTION_EVIDENCE_PRESTAGE_RECEIPT.md',
  'f-dock': 'frontier/dock/RECEIPT.md',
  'f-venue': 'frontier/venue-mesh/RECEIPT.md',
  'f-lab': 'frontier/portfolio-lab/RECEIPT.md',
  'f-arena': 'frontier/strategy-arena/RECEIPT.md',
  'f-edge': 'frontier/edge-meter/RECEIPT.md',
  'f-decide': 'frontier/decision-lab/RECEIPT.md',
  'dash-shell': 'web/src/features/systemDashboard/RECEIPT.md',
  'f-bridge': 'F_BRIDGE_RECEIPT.md',
  'i00-assembly': 'docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md',
  'ip-assur-agent':
    'fixtures/productAssurance/systemic/agentBoundary/receipts/AGENT_BOUNDARY_PRESTAGE_RECEIPT.v1.json',
  'ip-assur-case':
    'fixtures/productAssurance/systemic/assuranceCase/receipts/CASE_ACCEPTANCE_RECEIPT.md',
  'ip-assur-cockpit':
    'fixtures/productAssurance/systemic/cockpit/receipts/COCKPIT_PRESTAGE_RECEIPT.v1.json',
  'ip-assur-hazard':
    'fixtures/productAssurance/systemic/hazard/receipts/HAZARD_D_LAUNCH_10_AUDIT_RECEIPT.md',
  'ip-assur-stability':
    'fixtures/productAssurance/systemic/stability/receipts/STABILITY_ACCEPTANCE_RECEIPT.md',
  'ip-assurance': 'fixtures/productAssurance/receipts/IP_ASSURANCE_RECEIPT.md',
  'ip-control': 'IP_CONTROL_RECEIPT.md',
  'ip-ops': 'IP_OPS_RECEIPT.md',
  'ip-proof': 'IP_PROOF_RECEIPT.md',
  'ip-runtime': 'IP_RUNTIME_RECEIPT.md',
  'l09-normal-basis': 'live-edge-receipts/RECEIPTS/L09_DLAUNCH15_ACCEPTANCE.md',
  'l10-reverse-basis': 'live-edge-receipts/RECEIPTS/L10.md',
  'l11-volume': 'live-edge-receipts/RECEIPTS/L11.md',
  'l14-controls': 'live-edge-receipts/RECEIPTS/L14.md',
  'l15-infra': 'ops/live/RECEIPT.md',
  'live-execution-proof-20260712': 'LIVE_EDGE_RECEIPT.md',
  'q08-derivatives': 'quant/RECEIPTS/Q08_ACCEPTANCE.md',
  'q09-regime': 'quant/RECEIPTS/Q09_ACCEPTANCE.md',
  'q11-survival': 'quant/RECEIPTS/Q11_ACCEPTANCE.md',
  'q13-deep-gate': 'quant/RECEIPTS/Q13_ACCEPTANCE.md',
  'q14-validation-infra': 'quant/RECEIPTS/Q14_ACCEPTANCE.md',
  'q15-registry': 'quant/RECEIPTS/Q15_ACCEPTANCE.md',
  'quant-edge-research-20260712': 'quant/QUANT_EDGE_BUILD_STATE.md',
  'role4-fix': 'docs/archive/i00-phase4/ROLE4_CORRECTION_CLOSURE_CHECKPOINT_RECEIPT.md',
  'si-recon': 'SI_RECON_RECEIPT.md',
  'c-shard-1': 'SHARD_RECEIPT.md',
  'c-shard-2': 'SHARD_RECEIPT.md',
  'c-shard-3': 'SHARD_RECEIPT.md',
  'c-shard-4': 'SHARD_RECEIPT.md',
  'c-shard-5': 'SHARD_RECEIPT.md',
  'c-shard-6': 'SHARD_RECEIPT.md',
  'v1': 'SHARD_RECEIPT.md',
  'v2': 'SHARD_RECEIPT.md',
  'v3': 'SHARD_RECEIPT.md',
  'v4': 'SHARD_RECEIPT.md',
  'v5': 'SHARD_RECEIPT.md',
  'role3-c2': 'ROLE3_C2_RECEIPT.md',
  'role3-verify': 'ROLE3_VERIFICATION_RECEIPT.md',
};

const SELECTIVE_RECEIPTS = {
  'dash-shell': 'docs/archive/i00-phase2/DASHBOARD_EQUIVALENCE_VALIDATION_RECEIPT.md',
};

const HISTORICAL_RECEIPT_TERMINALS = {
  'egress-patch': 'BLOCKED',
  'port-a4': 'BLOCKED',
};

const HISTORICAL_WRITE_GRANTS = {
  'port-a1': [
    'server/src/aiOps/{contracts,policy,manifests,identity,reliability}/**',
    'server/test/aiOps/a1/**',
    'fixtures/aiOps/a1/**',
    'docs/archive/aiOps/a1/**',
  ],
  'port-a2': [
    'server/src/aiOps/runtime/**',
    'server/test/aiOps/a2/**',
    'fixtures/aiOps/a2/**',
    'docs/archive/aiOps/a2/**',
  ],
  'port-a3': [
    'server/src/aiOps/adapters/**',
    'server/test/aiOps/a3/**',
    'fixtures/aiOps/a3/**',
    'docs/archive/aiOps/a3/**',
  ],
  'port-a4': [
    'web/src/aiOps/**',
    'web/test/aiOps/**',
    'fixtures/aiOps/a4/**',
    'docs/archive/aiOps/a4/**',
  ],
  'port-a5': [
    'fixtures/aiOps/a5/**',
    'server/test/aiOps/a5/**',
    'test/aiOps/a5/**',
    'docs/archive/aiOps/a5/**',
  ],
  'port-obs': ['fixtures/obsShadow/**', 'test/obsShadow/**'],
  'port-ops': ['fixtures/opsShadow/**', 'test/opsShadow/**'],
  'port-replay': ['fixtures/replayShadow/**', 'test/replayShadow/**'],
  'port-runbook': ['fixtures/runbookShadow/**', 'test/runbookShadow/**'],
  'egress-patch': [
    'package.json',
    'server/test/gates.mjs',
    'server/test/perimeter.mjs',
    'server/test/private-egress-tripwire.mjs',
    'server/test/productIntegration/runtime/crash-readback.process.test.mjs',
    'server/test/run-deterministic-network-free.mjs',
    'server/test/systemIntegration/production/restart-truth-process.test.mjs',
  ],
  'ci-hotfix': [
    'docs/archive/CI_HOTFIX2_RECEIPT.md',
    'test/i00/performance/**',
    'STATE.md (out-of-grant; not admissible without Account A disposition)',
  ],
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', TZ: 'UTC' },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}): ${String(result.stderr)}`,
    );
  }
  return result;
}

function git(cwd, ...args) {
  return run('git', ['-C', cwd, ...args]);
}

function text(cwd, ...args) {
  return git(cwd, ...args).stdout.trim();
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function nulList(bufferOrString) {
  return String(bufferOrString)
    .split('\0')
    .filter(Boolean)
    .sort();
}

function parseWorktrees(raw) {
  const records = [];
  let record = {};
  for (const field of raw.split('\0')) {
    if (field === '') {
      if (record.worktree) records.push(record);
      record = {};
      continue;
    }
    const space = field.indexOf(' ');
    const key = space === -1 ? field : field.slice(0, space);
    const value = space === -1 ? true : field.slice(space + 1);
    record[key] = value;
  }
  if (record.worktree) records.push(record);
  return records;
}

function classificationFor(name, head, candidateSha, dirtyTracked, untracked) {
  const unexplainedSourceDirt = dirtyTracked.filter((path) => (
    name !== 'truth-a' || !path.startsWith('verification/product-truth-20260716/')
  ));
  if (unexplainedSourceDirt.length > 0) return 'ACTIVE_DIRTY';
  if (
    CANDIDATE_ADMISSION_LANES.has(name) &&
    run('git', ['-C', MAIN, 'merge-base', '--is-ancestor', head, candidateSha], {
      allowFailure: true,
    }).status === 0
  ) {
    return 'MERGED_RETAINED';
  }
  if (name === 'truth-a') {
    const candidateIsAncestor = run(
      'git',
      ['-C', MAIN, 'merge-base', '--is-ancestor', candidateSha, head],
      { allowFailure: true },
    ).status === 0;
    const committedDelta = candidateIsAncestor
      ? nulList(git(MAIN, 'diff', '--name-only', '-z', `${candidateSha}..${head}`).stdout)
      : [];
    const evidenceOnly = committedDelta.every((path) => (
      path.startsWith('verification/product-truth-20260716/')
    )) && dirtyTracked.every((path) => (
      path.startsWith('verification/product-truth-20260716/')
    )) && untracked.every((path) => (
      path.startsWith('verification/product-truth-20260716/')
    ));
    if (candidateIsAncestor && evidenceOnly) return 'MERGED_RETAINED';
  }
  for (const [classification, names] of Object.entries(GROUPS)) {
    if (names.includes(name)) return classification;
  }
  throw new Error(`No explicit classification for ${name}`);
}

function ownerFor(name) {
  if (name === 'Main') return 'RETIRED_DIRECTOR_READ_ONLY_FOR_CAMPAIGN';
  if (name === 'truth-a') return 'ACCOUNT_A_CANDIDATE_OWNER';
  if (name === 'truth-b') return 'ACCOUNT_B_READ_ONLY_VERIFIER';
  if (name === 'port-a4') return 'NO_ACTIVE_WRITER_SEALED_WITH_EXTERNAL_BLOCKERS';
  if (name.startsWith('port-')) return 'NO_ACTIVE_WRITER_SEALED_PORT_LANE';
  if (name === 'egress-patch') return 'NO_ACTIVE_WRITER_BLOCKED_PATCH_LANE';
  if (name === 'ci-hotfix') return 'NO_ACTIVE_WRITER_REFERENCE_ONLY_LANE';
  return 'NO_ACTIVE_WRITER_RETAINED_HISTORICAL_LANE';
}

function currentWriteGrantFor(name) {
  if (name === 'truth-a') {
    return ['verification/product-truth-20260716/**'];
  }
  if (name === 'truth-b') return ['ACCOUNT_B_OWN_VERIFICATION_ARTIFACTS_ONLY'];
  return [];
}

function taskFor(name) {
  const explicit = {
    Main: 'canonical current-main retained read-only during campaign',
    'truth-a': 'Account A product-truth candidate assembly and bounded fixes',
    'truth-b': 'Account B independent read-only verification',
    'ci-hotfix': 'superseded clean-checkout parity attempt (D-LAUNCH-56)',
    'egress-patch': 'deterministic offline egress gate with inherited SI hang',
    'port-a4': 'AI-Ops A4 operator-surface port',
    'ip-assur-formal': 'A-FORMAL post-landing admission candidate',
    'ip-assur-action': 'S2 action-evidence post-landing admission candidate',
  };
  return explicit[name] ?? `retained lane ${name}`;
}

function dispositionFor(name, classification) {
  if (name === 'port-a4') {
    return classification === 'MERGED_RETAINED'
      ? 'MERGED_RETAINED: D-LAUNCH-58 explicitly authorized the sealed-with-external-blockers lane for candidate integration'
      : 'SEALED_UNMERGED: D-LAUNCH-58 records pushed BLOCKED receipt 720d2fe7 and authorizes candidate integration';
  }
  if (name === 'egress-patch') {
    return classification === 'MERGED_RETAINED'
      ? 'MERGED_RETAINED: D-LAUNCH-55 authorized candidate integration; the bounded Worker correction is carried by candidate evidence'
      : 'BLOCKED: D-LAUNCH-55 transfers a base-identical unbounded Worker wait to Account A';
  }
  if (name === 'ci-hotfix') {
    return 'SUPERSEDED_SAFE: D-LAUNCH-56 makes the dirty-tree parity attempt REFERENCE_ONLY';
  }
  if (name === 'truth-a') {
    return classification === 'MERGED_RETAINED'
      ? 'MERGED_RETAINED: Account A source is frozen at exact candidate C; any descendant or local delta is confined to the campaign evidence directory'
      : 'BLOCKED: mutable pre-freeze Account A candidate';
  }
  if (name === 'truth-b') return 'BLOCKED: verifier tree remains at pre-freeze 787b73d and awaits the exact-C handoff';
  if (SEALED_UNMERGED.includes(name)) {
    if (classification === 'MERGED_RETAINED') {
      if (name === 'ip-assur-formal') {
        return 'MERGED_RETAINED: A-FORMAL sealed tip is in candidate ancestry; source is included while runtime/formal-tool activation remains REFERENCE_ONLY or NOT_CONFIGURED';
      }
      if (name === 'ip-assur-action') {
        return 'MERGED_RETAINED: S2 action-evidence sealed tip is in candidate ancestry; evidence is supporting-only and grants no action authority';
      }
      return 'MERGED_RETAINED: sealed port tip is in candidate ancestry and retains its exact terminal receipt';
    }
    return 'SEALED_UNMERGED: clean terminal receipt exists and authorized candidate admission has not occurred';
  }
  if (MERGED_RETAINED.includes(name)) {
    return 'MERGED_RETAINED: exact landed-core ancestry or content-addressed selective-equivalence receipt';
  }
  if (ABANDONED_SAFE.includes(name)) {
    return 'ABANDONED_SAFE: Frontier remains unauthorized/parked; no current write authority';
  }
  if (SUPERSEDED_SAFE.includes(name)) {
    return 'SUPERSEDED_SAFE: historical, speculative, audit, or verifier lane replaced by later accepted evidence';
  }
  throw new Error(`No disposition for ${name}/${classification}`);
}

function claimedStateFor(name, classification) {
  if (classification === 'ACTIVE_DIRTY') return 'BLOCKED';
  if (classification === 'MERGED_RETAINED') return 'INTEGRATED';
  if (name === 'port-a4') return 'SEALED';
  if (name === 'egress-patch' || name === 'truth-a' || name === 'truth-b') return 'BLOCKED';
  if (name === 'ci-hotfix') return 'REFERENCE_ONLY';
  if (classification === 'SEALED_UNMERGED') return 'SEALED';
  if (name === 'ip-assur-formal' || name === 'ip-assur-action') return 'SEALED';
  return 'REFERENCE_ONLY';
}

function untrackedDisposition(name, path) {
  if (name === 'truth-a' && path.startsWith('verification/product-truth-20260716/')) {
    return 'AUTHORIZED_CAMPAIGN_EVIDENCE_ONLY_PENDING_COMMIT';
  }
  if (name === 'truth-b') {
    return 'PRESERVED_ACCOUNT_B_PREP_FILENAME_ONLY_NOT_READ_BY_ACCOUNT_A';
  }
  if (name === 'role3-c2' && path === 'ROLE3_C2_RECEIPT.md') {
    return 'PRESERVED_HISTORICAL_C2_RECEIPT_REFERENCE_ONLY';
  }
  if (path.endsWith('.sh')) {
    return 'PRESERVED_SUPERSEDED_HISTORICAL_SCRIPT_NOT_ADMITTED_TO_CANDIDATE';
  }
  return 'PRESERVED_OWNER_OR_HISTORICAL_INPUT_NOT_ADMITTED_TO_CANDIDATE';
}

function firstReflogSha(branch) {
  const result = run(
    'git',
    ['-C', MAIN, 'reflog', 'show', '--format=%H', `refs/heads/${branch}`],
    { allowFailure: true },
  );
  if (result.status !== 0) return null;
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  return lines.at(-1) ?? null;
}

function commitExists(sha) {
  return run('git', ['-C', MAIN, 'cat-file', '-e', `${sha}^{commit}`], {
    allowFailure: true,
  }).status === 0;
}

function resolveBase(name, branch, head) {
  if (name === 'Main') {
    return { sha: null, state: 'NOT_CONFIGURED', method: 'canonical_primary_worktree' };
  }
  const override = BASE_OVERRIDES[name];
  if (override) {
    const sha = text(MAIN, 'rev-parse', `${override}^{commit}`);
    return { sha, state: 'VERIFIED', method: 'campaign_or_director_cut' };
  }
  if (!branch) return { sha: head, state: 'VERIFIED', method: 'detached_head' };
  const reflog = firstReflogSha(branch);
  if (reflog && commitExists(reflog)) {
    return { sha: reflog, state: 'VERIFIED', method: 'oldest_local_branch_reflog' };
  }
  throw new Error(`No verified base SHA for ${name}`);
}

function compareRefs(left, right) {
  const [leftOnly, rightOnly] = text(MAIN, 'rev-list', '--left-right', '--count', `${left}...${right}`)
    .split(/\s+/)
    .map(Number);
  return { reference_only: leftOnly, worktree_only: rightOnly };
}

function branchTracking(branch, head) {
  if (!branch) {
    return {
      upstream: null,
      upstream_state: 'NOT_CONFIGURED',
      ahead_behind: { state: 'NOT_CONFIGURED', ahead: null, behind: null },
      remote_tracking_ref: null,
      remote_tracking_state: 'NOT_CONFIGURED',
      remote_tracking_comparison: null,
    };
  }
  const upstream = text(
    MAIN,
    'for-each-ref',
    '--format=%(upstream:short)',
    `refs/heads/${branch}`,
  );
  const remoteRef = `refs/remotes/origin/${branch}`;
  const remoteExists = run('git', ['-C', MAIN, 'show-ref', '--verify', '--quiet', remoteRef], {
    allowFailure: true,
  }).status === 0;
  let aheadBehind = { state: 'NOT_CONFIGURED', ahead: null, behind: null };
  if (upstream) {
    const counts = compareRefs(upstream, head);
    aheadBehind = {
      state: 'VERIFIED',
      ahead: counts.worktree_only,
      behind: counts.reference_only,
    };
  }
  return {
    upstream: upstream || null,
    upstream_state: upstream ? 'VERIFIED' : 'NOT_CONFIGURED',
    ahead_behind: aheadBehind,
    remote_tracking_ref: remoteExists ? remoteRef : null,
    remote_tracking_state: remoteExists ? 'VERIFIED' : 'NOT_CONFIGURED',
    remote_tracking_comparison: remoteExists ? compareRefs(remoteRef, head) : null,
  };
}

function receiptObject(name, path, head, receiptPath) {
  if (!receiptPath) {
    return {
      path: null,
      integrity_state: 'NOT_CONFIGURED',
      historical_claimed_terminal_state: 'NOT_CONFIGURED',
      tracked: null,
      git_blob: null,
      sha256: null,
      bytes: null,
    };
  }
  const tracked = run('git', ['-C', MAIN, 'cat-file', '-e', `${head}:${receiptPath}`], {
    allowFailure: true,
  }).status === 0;
  if (tracked) {
    const bytes = git(MAIN, 'show', `${head}:${receiptPath}`).stdout;
    return {
      path: receiptPath,
      integrity_state: 'SEALED',
      historical_claimed_terminal_state: HISTORICAL_RECEIPT_TERMINALS[name] ?? 'SEALED',
      tracked: true,
      git_blob: text(MAIN, 'rev-parse', `${head}:${receiptPath}`),
      sha256: sha256(bytes),
      bytes: Buffer.byteLength(bytes),
    };
  }
  const absolute = resolve(path, receiptPath);
  if (existsSync(absolute)) {
    const bytes = readFileSync(absolute);
    return {
      path: receiptPath,
      integrity_state: 'BRANCH_BUILT',
      historical_claimed_terminal_state: HISTORICAL_RECEIPT_TERMINALS[name] ?? 'BRANCH_BUILT',
      tracked: false,
      git_blob: null,
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
  }
  return {
    path: receiptPath,
    integrity_state: 'MISSING',
    historical_claimed_terminal_state: 'MISSING',
    tracked: false,
    git_blob: null,
    sha256: null,
    bytes: null,
  };
}

function selectiveReceiptObject(name, candidateSha) {
  const receiptPath = SELECTIVE_RECEIPTS[name];
  if (!receiptPath) return { exists: false, path: null, git_blob: null, sha256: null };
  const bytes = git(MAIN, 'show', `${candidateSha}:${receiptPath}`).stdout;
  return {
    exists: true,
    path: receiptPath,
    git_blob: text(MAIN, 'rev-parse', `${candidateSha}:${receiptPath}`),
    sha256: sha256(bytes),
  };
}

function trackedDirtyPaths(path) {
  const parts = [
    nulList(git(path, 'diff', '--name-only', '-z').stdout),
    nulList(git(path, 'diff', '--cached', '--name-only', '-z').stdout),
    nulList(git(path, 'diff', '--name-only', '--diff-filter=U', '-z').stdout),
  ].flat();
  return [...new Set(parts)].sort();
}

function diffIdentity(base, head) {
  if (!base || base === head) {
    return {
      changed_path_count: 0,
      binary_diff_sha256: null,
      path_blob_manifest_sha256: null,
    };
  }
  const changed = nulList(git(MAIN, 'diff', '--name-only', '-z', `${base}..${head}`).stdout);
  if (changed.length === 0) {
    return {
      changed_path_count: 0,
      binary_diff_sha256: null,
      path_blob_manifest_sha256: null,
    };
  }
  const binaryDiff = git(MAIN, 'diff', '--binary', '--full-index', `${base}..${head}`).stdout;
  const manifest = changed
    .map((path) => {
      const entry = git(MAIN, 'ls-tree', head, '--', path).stdout.trim();
      return `${path}\0${entry || 'DELETED'}`;
    })
    .sort()
    .join('\n');
  return {
    changed_path_count: changed.length,
    binary_diff_sha256: sha256(binaryDiff),
    path_blob_manifest_sha256: sha256(manifest),
  };
}

const candidateArg = process.argv[2] ?? 'HEAD';
const censusStartedAt = new Date().toISOString();
const candidateSha = text(process.cwd(), 'rev-parse', `${candidateArg}^{commit}`);
const candidateTree = text(process.cwd(), 'rev-parse', `${candidateSha}^{tree}`);
const rawWorktrees = git(MAIN, 'worktree', 'list', '--porcelain', '-z').stdout;
const records = parseWorktrees(rawWorktrees);

if (records.length !== 96) throw new Error(`Expected 96 registered worktrees, observed ${records.length}`);
const observedNames = new Set(records.map((record) => basename(record.worktree)));
for (const name of EXPECTED_NAMES) {
  if (!observedNames.has(name)) throw new Error(`Expected registered worktree missing: ${name}`);
}
for (const name of observedNames) {
  if (!EXPECTED_NAMES.has(name)) throw new Error(`Registered worktree has no explicit policy: ${name}`);
}

const rows = records.map((record) => {
  const path = record.worktree;
  const name = basename(path);
  const head = text(path, 'rev-parse', 'HEAD');
  if (head !== record.HEAD) throw new Error(`Porcelain HEAD drift at ${path}`);
  const branch = typeof record.branch === 'string' ? record.branch.replace('refs/heads/', '') : null;
  const statusRaw = git(path, 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all').stdout;
  const dirtyTracked = trackedDirtyPaths(path);
  const untracked = nulList(git(path, 'ls-files', '--others', '--exclude-standard', '-z').stdout);
  const expectedTerminalHead = EXPECTED_TERMINAL_HEADS[name];
  if (expectedTerminalHead && head !== expectedTerminalHead) {
    throw new Error(`${name} terminal HEAD drift: expected ${expectedTerminalHead}, observed ${head}`);
  }
  const classification = classificationFor(name, head, candidateSha, dirtyTracked, untracked);
  const base = resolveBase(name, branch, head);
  const tracking = branchTracking(branch, head);
  const acceptedDonorSha =
    classification === 'MERGED_RETAINED' && name !== 'Main' && name !== 'truth-a'
      ? head
      : classification === 'SEALED_UNMERGED'
        ? head
        : null;
  const inCandidate = acceptedDonorSha
    ? run('git', ['-C', MAIN, 'merge-base', '--is-ancestor', acceptedDonorSha, candidateSha], {
        allowFailure: true,
      }).status === 0
    : null;
  const selective = selectiveReceiptObject(name, candidateSha);
  if (classification === 'MERGED_RETAINED' && acceptedDonorSha && !inCandidate && !selective.exists) {
    throw new Error(`${name} claims MERGED_RETAINED without ancestry or a selective receipt`);
  }
  const receipt = receiptObject(name, path, head, RECEIPTS[name]);
  if (name === 'port-a4' && receipt.integrity_state !== 'SEALED') {
    throw new Error(`A4 seal drift: expected committed receipt, observed ${receipt.integrity_state}`);
  }
  return {
    absolute_path: path,
    worktree_name: name,
    branch_name: branch,
    detached: Boolean(record.detached),
    head_sha: head,
    tree_sha: text(path, 'rev-parse', 'HEAD^{tree}'),
    base_sha: base.sha,
    base_state: base.state,
    base_method: base.method,
    upstream: tracking.upstream,
    upstream_state: tracking.upstream_state,
    ahead_behind: tracking.ahead_behind,
    remote_tracking_ref: tracking.remote_tracking_ref,
    remote_tracking_state: tracking.remote_tracking_state,
    remote_tracking_comparison: tracking.remote_tracking_comparison,
    locked: Boolean(record.locked),
    locked_reason: typeof record.locked === 'string' ? record.locked : null,
    prunable: Boolean(record.prunable),
    prunable_reason: typeof record.prunable === 'string' ? record.prunable : null,
    dirty_tracked_paths: dirtyTracked,
    dirty_source_paths: dirtyTracked.filter((dirtyPath) => (
      name !== 'truth-a' || !dirtyPath.startsWith('verification/product-truth-20260716/')
    )),
    untracked_paths: untracked,
    untracked_path_dispositions: untracked.map((untrackedPath) => ({
      path: untrackedPath,
      disposition: untrackedDisposition(name, untrackedPath),
    })),
    status_porcelain_v2_sha256: sha256(statusRaw),
    task: taskFor(name),
    owner: ownerFor(name),
    allowed_write_paths: currentWriteGrantFor(name),
    historical_allowed_write_paths: HISTORICAL_WRITE_GRANTS[name] ?? [],
    terminal_receipt: receipt,
    claimed_terminal_state: claimedStateFor(name, classification),
    sealed_branch_sha:
      classification === 'SEALED_UNMERGED' ||
      name === 'ip-assur-formal' ||
      name === 'ip-assur-action'
        ? head
        : null,
    accepted_donor_sha: acceptedDonorSha,
    donor_in_candidate_ancestry: inCandidate,
    selective_merge_receipt: selective,
    diff_identity: diffIdentity(base.sha, head),
    patch_duplicated_elsewhere: false,
    patch_duplicate_peers: [],
    classification,
    disposition_reason: dispositionFor(name, classification),
    disposition_evidence:
      name === 'ci-hotfix'
        ? 'QL_DIRECTOR_STATE.md D-LAUNCH-56'
        : name === 'egress-patch'
          ? 'QL_DIRECTOR_STATE.md D-LAUNCH-55'
          : name === 'port-a4'
            ? 'QL_DIRECTOR_STATE.md D-LAUNCH-58 plus committed BLOCKED receipt 720d2fe7'
            : classification === 'MERGED_RETAINED'
              ? 'I00_PRODUCT_BUILD_STATE.md exact Phase 2 donor table or candidate ancestry'
              : classification === 'ABANDONED_SAFE'
                ? 'Campaign §§2.2,18-19 plus QL_DIRECTOR_STATE.md post-landing dispositions'
                : 'QL_DIRECTOR_STATE.md and WORKTREE_LEDGER.md historical lane record',
  };
});

const duplicateGroups = new Map();
for (const row of rows) {
  const identity = row.diff_identity;
  if (!identity.binary_diff_sha256 || !identity.path_blob_manifest_sha256) continue;
  const key = `${identity.binary_diff_sha256}:${identity.path_blob_manifest_sha256}`;
  const peers = duplicateGroups.get(key) ?? [];
  peers.push(row.worktree_name);
  duplicateGroups.set(key, peers);
}
for (const row of rows) {
  const identity = row.diff_identity;
  if (!identity.binary_diff_sha256 || !identity.path_blob_manifest_sha256) continue;
  const peers = duplicateGroups.get(
    `${identity.binary_diff_sha256}:${identity.path_blob_manifest_sha256}`,
  );
  if (peers.length > 1) {
    row.patch_duplicated_elsewhere = true;
    row.patch_duplicate_peers = peers.filter((peer) => peer !== row.worktree_name);
  }
}

const classificationCounts = Object.fromEntries(
  Object.keys(GROUPS).map((classification) => [
    classification,
    rows.filter((row) => row.classification === classification).length,
  ]),
);
classificationCounts.DUPLICATE_PATCH = rows.filter(
  (row) => row.classification === 'DUPLICATE_PATCH',
).length;
classificationCounts.UNKNOWN = rows.filter((row) => row.classification === 'UNKNOWN').length;

const document = {
  schema: 'product-truth-worktree-census.v1',
  generated_at_utc: new Date().toISOString(),
  actor_role: 'ACCOUNT_A',
  account_b_reasoning_or_artifacts_read: false,
  account_b_status_scope: 'HEAD and Git status metadata only, required by campaign §5',
  source_command: 'git -C /Users/cosmosgeek/Desktop/Main worktree list --porcelain -z',
  source_command_sha256: sha256(rawWorktrees),
  candidate_sha: candidateSha,
  candidate_tree_sha: candidateTree,
  current_main_sha: text(MAIN, 'rev-parse', 'refs/heads/current-main'),
  origin_current_main_sha: text(MAIN, 'rev-parse', 'refs/remotes/origin/current-main'),
  registered_worktree_count: rows.length,
  tracked_dirty_path_count: rows.reduce((total, row) => total + row.dirty_tracked_paths.length, 0),
  unexplained_dirty_source_path_count: rows.reduce(
    (total, row) => total + row.dirty_source_paths.length,
    0,
  ),
  untracked_path_count: rows.reduce((total, row) => total + row.untracked_paths.length, 0),
  worktrees_with_untracked_paths: rows.filter((row) => row.untracked_paths.length > 0).length,
  classification_counts: classificationCounts,
  duplicate_method:
    'exact binary diff SHA-256 plus exact sorted path/blob manifest SHA-256; empty deltas are not patches',
  unknown_count: classificationCounts.UNKNOWN,
  receipt: {
    exact_candidate_sha: candidateSha,
    command_or_operator_action:
      'git -C /Users/cosmosgeek/Desktop/Main worktree list --porcelain -z plus per-tree status, ancestry, receipt, and diff probes',
    environment_toolchain_digest_sha256:
      '8261c1fcbc27b3a2384abc506a285768333d4f4d5350fec83cd5364211a763ca',
    dependency_lock_sha256:
      '3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf',
    start_time_utc: censusStartedAt,
    end_time_utc: new Date().toISOString(),
    exit_code: 0,
    test_count: rows.length,
    artifact_hashes:
      'MANIFEST.sha256 is generated last and excludes itself; the evidence Git commit binds the manifest',
    actor_role: 'ACCOUNT_A',
    actor_had_candidate_source_write_permission: false,
    deviations_skips_unavailable_evidence: [
      'Account B filenames and Git metadata only; Account B content was not read',
      'No worktree was cleaned, pruned, reset, or deleted',
    ],
  },
  rows: rows.sort((left, right) => left.absolute_path.localeCompare(right.absolute_path)),
};

if (document.unknown_count !== 0) throw new Error('UNKNOWN worktree classifications are forbidden');
writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  JSON.stringify({
    output: OUTPUT,
    candidate_sha: candidateSha,
    registered_worktrees: document.registered_worktree_count,
    tracked_dirty_paths: document.tracked_dirty_path_count,
    untracked_paths: document.untracked_path_count,
    classifications: classificationCounts,
  }),
);
