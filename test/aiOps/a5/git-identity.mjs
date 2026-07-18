import { execFileSync } from 'node:child_process';

const SHA1 = /^[0-9a-f]{40}$/u;

export const AI_OPS_DONOR_IDENTITIES = Object.freeze({
  A1: Object.freeze({
    commit: '8882644db14fbb924c6a8f97bf5c1d1cebb1453c',
    tree: 'f1f020a206db3030ef873946684f1912f9412982',
  }),
  A2: Object.freeze({
    commit: '6e9efe05890174bfe2ebfb9331c0ea9655061b30',
    tree: 'f1eaf45578a970ba3245f540054da8947c94ba08',
  }),
  A5: Object.freeze({
    commit: '9769d461f694f12519d7a29483c2f78f4381504d',
    tree: '1b59e85ef66f2ec864df5fd8492707a6a02421b4',
  }),
});

function exactSha(value, field) {
  if (typeof value !== 'string' || !SHA1.test(value)) {
    throw new TypeError(`AI_OPS_GIT_IDENTITY_INVALID:${field}`);
  }
  return value;
}

export function classifyAiOpsGitIdentity(headIdentity, donorIdentity) {
  const headCommit = exactSha(headIdentity?.commit, 'HEAD_COMMIT');
  const headTree = exactSha(headIdentity?.tree, 'HEAD_TREE');
  const donorCommit = exactSha(donorIdentity?.commit, 'DONOR_COMMIT');
  const donorTree = exactSha(donorIdentity?.tree, 'DONOR_TREE');
  const donor = headCommit === donorCommit && headTree === donorTree;
  return Object.freeze({
    mode: donor ? 'DONOR' : 'INTEGRATED',
    verificationTarget: donor ? 'SEALED_DONOR_HISTORY' : 'CURRENT_HEAD_TREE',
    headCommit,
    headTree,
    donorCommit,
    donorTree,
  });
}

export function readAiOpsGitIdentity(repositoryRoot, lane) {
  const donorIdentity = AI_OPS_DONOR_IDENTITIES[lane];
  if (donorIdentity === undefined) throw new TypeError(`AI_OPS_DONOR_LANE_INVALID:${String(lane)}`);
  const text = (args) => execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return classifyAiOpsGitIdentity({
    commit: text(['rev-parse', '--verify', 'HEAD^{commit}']),
    tree: text(['rev-parse', '--verify', 'HEAD^{tree}']),
  }, donorIdentity);
}

export const AI_OPS_IDENTITY_REGRESSION_MATRIX = Object.freeze([
  Object.freeze({
    item: 'FIX-092',
    environment: 'DETACHED_INTEGRATED_HEAD',
    lane: 'A5',
    head: Object.freeze({
      commit: '9346512ad698fe9358bdc6d641e1a96280365b71',
      tree: '0ebd31c8c0a2ed3f04c9abea097e839d29634e56',
    }),
    expectedMode: 'INTEGRATED',
    expectedTarget: 'CURRENT_HEAD_TREE',
  }),
  Object.freeze({
    item: 'FIX-105',
    environment: 'EXACT_DONOR_TIP',
    lane: 'A5',
    head: AI_OPS_DONOR_IDENTITIES.A5,
    expectedMode: 'DONOR',
    expectedTarget: 'SEALED_DONOR_HISTORY',
  }),
  Object.freeze({
    item: 'FIX-107',
    environment: 'ALL_NAMED_DONOR_TIPS',
    lanes: Object.freeze(['A1', 'A2', 'A5']),
    heads: AI_OPS_DONOR_IDENTITIES,
  }),
  Object.freeze({
    item: 'FIX-108',
    environment: 'DONOR_OBJECT_NEAR_MATCHES',
    nearMatches: Object.freeze([
      Object.freeze({
        commit: AI_OPS_DONOR_IDENTITIES.A2.commit,
        tree: AI_OPS_DONOR_IDENTITIES.A5.tree,
      }),
      Object.freeze({
        commit: AI_OPS_DONOR_IDENTITIES.A5.commit,
        tree: AI_OPS_DONOR_IDENTITIES.A2.tree,
      }),
    ]),
  }),
]);
