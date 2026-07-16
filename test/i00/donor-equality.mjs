import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGitEvidence } from './verify-scope.mjs';

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(MODULE_PATH), '../..');
const FULL_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REPO_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'));
}

function sameSortedValues(left, right) {
  return exactJson(sorted(left), sorted(right));
}

export const PHASE2_GRAPH_BOUNDARY = deepFreeze({
  windowStart: '1fec867fa3f62d17829543b3776dc768506ae8ac',
  authorityAcceptance: 'c1266f24c464a49ef1657e2549b06d7a90d6cac7',
  requiredLastMerge: 'ec82bc51d5311dfb3f505216bfb3fa41733f038c',
  requiredLastFirstParent: '139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9',
  requiredLastDonor: 'df6b472993ca9659ce09cf5f72004981c6835f0d',
  // Exact authorized post-L merge topology through the D-LAUNCH-62 candidate.
  // These merges remain outside the original 16-donor equality count; their
  // ancestry is admitted only by the exact list below.
  authorizedLaterMerges: deepFreeze([
    '449350d60ab30a385edeccdf4d91716ef8550537',
    '51efaaa41fbaf85bcbefa9adc6cdbd640d814506',
    '6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd',
    'c1a4b835a15aa60152b2ecfa9ae8087f6e159ce6',
    '4eff62bdd30eceddf39bbbdf417b0eba51c22b7c',
    '9c7e8b16bc8fbaba0110daa391a6e6160dae5802',
    'b3f49616e69ee5036386414030b482b5f02e9c13',
    '2787ebf3665c1efe32af9c426504af6b871898f1',
    '614e5a8ed20b5c810ee92268a3f3c12c30971519',
    '9c3bb17638cd8bc5478b813c22c5a7050f046ce3',
    '955e204964f44246e0c69772578f43180a56b33f',
    '611df36d12d00c3fbf041fff4af9cccde03afc91',
    'e3b84307af010b8b1547418f5f6cb5078039413d',
    '48a89d9f07574868fc6346725781ba954f488a4c',
    '55b456e19dbbd97548d9beb601dfc8cc7d3c57b7',
    '995904ada86e86ef4214bea596331b978a332da0',
  ]),
  permittedNonDonorMerge: deepFreeze({
    id: 'CANONICAL_MAIN_DIRECTOR_STATE_SYNC',
    commit: 'ce8d79a751c886dff388fa8f3f2fa6fb3f0414ee',
    tree: '512f0022e782fccfd2e5c554570b2f0be948d2de',
    parents: deepFreeze([
      'aedeb948d914057669773e1223dfed941af25996',
      '7383fd89477ed0b3e677e53c57c35d76ac34bbd8',
    ]),
  }),
});

export const EXPECTED_DONOR_MANIFEST = deepFreeze([
  {
    id: 'F-BRIDGE',
    tipSha: 'a0c0c2e5ef3180aa720488463643433cefeb65e5',
    treeSha: 'b29f0b50841ae921b0a0dfa65b71d224d6a7b5ec',
    worktree: { directory: 'f-bridge', branch: 'f-bridge-execution-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', 'LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md'] },
    acceptanceReceipts: [{ path: 'F_BRIDGE_RECEIPT.md', sha256: 'e01a614d89755553e5e86db657b8f2ed804060b68f8088c3f34b9c27d76bbba4' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '0670f533840f415b612fb290d2c944f94af50d82',
    integrationTree: '26fe03af99053750cfcc1687e72d6b29519a1a76',
    integrationParents: ['c1266f24c464a49ef1657e2549b06d7a90d6cac7', 'a0c0c2e5ef3180aa720488463643433cefeb65e5'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/F_BRIDGE_INTEGRATION_RECEIPT.md', sha256: '2cdd156ba4510f49e9b192795aea756afbea55ee359e41e33ff15f4bc65810f9' },
  },
  {
    id: 'SI-RECON',
    tipSha: 'f03ed786a8c5cab50ef27ad33026a74f79f7df87',
    treeSha: 'c88cb7a566daf858e73cebc77122409e96d0ffcd',
    worktree: { directory: 'si-recon', branch: 'si-recon-ruling-20260714', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'] },
    acceptanceReceipts: [{ path: 'SI_RECON_RECEIPT.md', sha256: 'a0ac1bd8da362999e93d0b10094a4791f900e2a245e66b115a78128030574585' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: 'ba965fb0fbb5e10819d5a704e99153892fe94031',
    integrationTree: '08f19362c21160970d5e9732abca69f59baf648b',
    integrationParents: ['936ff4de6d96f6fb0f1bdede99e64ec13cfae766', 'f03ed786a8c5cab50ef27ad33026a74f79f7df87'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/SI_RECON_INTEGRATION_RECEIPT.md', sha256: 'a36a0d67b4efdc47dfd03f47bed243d445cc9e5156d66d33924a6fff860fc4f1' },
  },
  {
    id: 'Q-LANE',
    tipSha: '02b4eccc8d2ef53b830cafae06e5175715fa6ebb',
    treeSha: '5c86cebf0966cedd7ba01c56a01704b4f7bd0224',
    worktree: { directory: 'quant-edge-research-20260712', branch: 'quant-edge-research-factory-20260712', allowedUntracked: ['DIRECTOR_Q_L_TWO_LANE_LAUNCH.md', 'QUANT_EDGE_RESEARCH_FACTORY_12H.md'] },
    acceptanceReceipts: [{ path: 'quant/RECEIPTS/Q17_ACCEPTANCE.md', sha256: '9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '042dc9897d04bed2b0de3043cbdcbac408251412',
    integrationTree: '3ffa75b34c2263a2688b6e42ac65f0a02bbb789c',
    integrationParents: ['dc69f778f7e432132618b7c22c0795639492f844', '02b4eccc8d2ef53b830cafae06e5175715fa6ebb'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/Q_LANE_INTEGRATION_RECEIPT.md', sha256: 'daa8c219227322df1e7a71e6d8b2815256b040fbacac8fbb7d492c00651bb7a4' },
  },
  {
    id: 'DASHBOARD-SHELL',
    tipSha: '692501587617d4880303fbd747d93e63c376f088',
    treeSha: '61d0c5a3e9146fc0b78d8c7fce3e7ebdfbc3b46d',
    worktree: { directory: 'dash-shell', branch: 'dashboard-shell-20260712', allowedUntracked: [] },
    acceptanceReceipts: [{ path: 'web/src/features/systemDashboard/RECEIPT.md', sha256: '878cc578d88f38ca3bf8edce554b2cb258b4e9309718854f7ba18c33cb50b968' }],
    integrationMethod: 'RECEIPTED_EQUIVALENCE',
    integrationCommit: 'd04fdc71ffbd9c8266c969524a56e325ec68b1f8',
    integrationTree: '55cc9144836a3eddb2226615a1218e1ccbe0070a',
    integrationParents: ['3eeda75b02f514f1aceccf43b42a154f7db92dc7'],
    equivalence: { path: 'web/src/features/systemDashboard', tree: 'd3d899db3b0395532a3cf12b2304e91a2ce528ce', fileCount: 21 },
    integrationReceipt: { path: 'docs/archive/i00-phase2/DASHBOARD_EQUIVALENCE_VALIDATION_RECEIPT.md', sha256: 'd36bb026b54510c0d9853a5e0a32e0d29837cc8677082bd37261bb2107d37e43' },
  },
  {
    id: 'L15-INFRASTRUCTURE',
    tipSha: '2cec412927fa2f64f05a0b2774b18e45f8ce4fa5',
    treeSha: 'e401435d6a650aee8a29c3da4495b4db426be017',
    worktree: { directory: 'l15-infra', branch: 'l15-deploy-infra-20260712', allowedUntracked: ['DIRECTOR_Q_L_TWO_LANE_LAUNCH.md', 'LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md'] },
    acceptanceReceipts: [{ path: 'ops/live/RECEIPT.md', sha256: 'd5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '35672dcc448d2ca55b17c24344fb413b4d1e14a7',
    integrationTree: 'd0adf837268074167de66383902c08eb604d6559',
    integrationParents: ['d04fdc71ffbd9c8266c969524a56e325ec68b1f8', '2cec412927fa2f64f05a0b2774b18e45f8ce4fa5'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/L15_INFRA_INTEGRATION_RECEIPT.md', sha256: '92affcb7dd520a0d7f9cf1b9a1ca8c2a4c77e4b98451c98293bf7b54edfde656' },
  },
  {
    id: 'IP-RUNTIME',
    tipSha: '8058ab8febb639839333d4e2c604068a0c7390ea',
    treeSha: 'dd255f23310c846ab0b3ea0c3bebb6a765ecddd0',
    worktree: { directory: 'ip-runtime', branch: 'ip-runtime-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', 'IP_RUNTIME.md'] },
    acceptanceReceipts: [{ path: 'IP_RUNTIME_RECEIPT.md', sha256: '8a16a2e5a869b9356b9b2cbbfd1de68406e64a253479fc6be600e953cd613dcb' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: 'f5523e63efcb0a5434341cf9328162be1482fc38',
    integrationTree: '33602cd14b191f9a7819dce1a95fe6fc99caf440',
    integrationParents: ['1fec867fa3f62d17829543b3776dc768506ae8ac', '8058ab8febb639839333d4e2c604068a0c7390ea'],
    integrationReceipt: { path: 'IP_RUNTIME_RECEIPT.md', sha256: '8a16a2e5a869b9356b9b2cbbfd1de68406e64a253479fc6be600e953cd613dcb' },
  },
  {
    id: 'IP-CONTROL',
    tipSha: '56c47dad398c485b6653036c8b90c53f11061b1e',
    treeSha: 'e335fc95be7a24da828b14c205f39ea3666dd385',
    worktree: { directory: 'ip-control', branch: 'ip-control-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', 'IP_CONTROL.md'] },
    acceptanceReceipts: [{ path: 'IP_CONTROL_RECEIPT.md', sha256: '4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: 'd50de1dd1b23a40b3895b29fee5486bc069597af',
    integrationTree: '2f5afdb1673d247da0c30b166c199f5fe88a6923',
    integrationParents: ['f5523e63efcb0a5434341cf9328162be1482fc38', '56c47dad398c485b6653036c8b90c53f11061b1e'],
    integrationReceipt: { path: 'IP_CONTROL_RECEIPT.md', sha256: '4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7' },
  },
  {
    id: 'IP-OPS',
    tipSha: '6bfd543afb693ea18f4baf08e962e6d698f140fb',
    treeSha: '572adc3c19d9052fc26398875230437505f5c97e',
    worktree: { directory: 'ip-ops', branch: 'ip-ops-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', 'IP_OPS.md'] },
    acceptanceReceipts: [{ path: 'IP_OPS_RECEIPT.md', sha256: '57bc6fd9a6847dde70b1ac2cd81e0116db8e0f34c8e4003fee55b3f09f5bd922' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: 'a6a12b943c77c54e60072f755beca984432bffa8',
    integrationTree: 'cdb11dc9911151dc40ad6d40d1b3786a65ff4b00',
    integrationParents: ['d50de1dd1b23a40b3895b29fee5486bc069597af', '6bfd543afb693ea18f4baf08e962e6d698f140fb'],
    integrationReceipt: { path: 'IP_OPS_RECEIPT.md', sha256: '57bc6fd9a6847dde70b1ac2cd81e0116db8e0f34c8e4003fee55b3f09f5bd922' },
  },
  {
    id: 'IP-PROOF',
    tipSha: '23e985c17b9b860fee26be397fa05b26f3daf8f2',
    treeSha: '1329fe73139016cf728d47551c75f7ca69daa558',
    worktree: { directory: 'ip-proof', branch: 'ip-proof-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', 'IP_PROOF.md'] },
    acceptanceReceipts: [{ path: 'IP_PROOF_RECEIPT.md', sha256: '569f09af842f527ca19269a8e66dbdc367145a03ff31aba839defe252d14ad7b' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '1d9b1a3a5e859501c4c0c47e6b2c8d0d82bc4698',
    integrationTree: 'a277ae616f74377f5b3b80ab23892caa20312900',
    integrationParents: ['a6a12b943c77c54e60072f755beca984432bffa8', '23e985c17b9b860fee26be397fa05b26f3daf8f2'],
    integrationReceipt: { path: 'IP_PROOF_RECEIPT.md', sha256: '569f09af842f527ca19269a8e66dbdc367145a03ff31aba839defe252d14ad7b' },
  },
  {
    id: 'A-CORE',
    tipSha: '08a0a09780727e2b4ba59017b5701998abe29b77',
    treeSha: 'b904ca0f5b6f7c8df294274351611635560f80f7',
    worktree: { directory: 'ip-assurance', branch: 'ip-assurance-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'] },
    acceptanceReceipts: [{ path: 'fixtures/productAssurance/receipts/IP_ASSURANCE_RECEIPT.md', sha256: '93b1f6283d48ddeadf9b7205e47f3ccfc698d4f79f98b8e82ecad1d7aa4a302e' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '3ee0eda6b0da01b6fae441c684fa53829cab15be',
    integrationTree: 'cb1d785f69c2b1d36fc11d88446acc64cf53a33d',
    integrationParents: ['d3ae63f7c755ac5bb56889207e698c23a895798a', '08a0a09780727e2b4ba59017b5701998abe29b77'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/A_CORE_INTEGRATION_RECEIPT.md', sha256: '6741509d67eb622f913661e1ea0e277b01a29ebb3a0e9318e3025882122ba0fa' },
  },
  {
    id: 'A-HAZARD',
    tipSha: 'ab33b3712cddd67c3ec91cfa1dd232c75226cd9f',
    treeSha: 'e33224d4b2e6b018fd39bfdcb403b3d88e74712f',
    worktree: { directory: 'ip-assur-hazard', branch: 'ip-assur-hazard-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'] },
    acceptanceReceipts: [{ path: 'fixtures/productAssurance/systemic/hazard/receipts/HAZARD_D_LAUNCH_10_AUDIT_RECEIPT.md', sha256: 'ecfca4e7d60d9dca3b07e4e21d4595ebb234dab421924f14226cf39f8a9c85ea' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: 'bfb813ba1c15a23c7f4f0bff6a8da2f13d5c2729',
    integrationTree: '7eed3e5336354c03455282b9ee3421c7d90a0a92',
    integrationParents: ['66aa2155d8587897fc59d25f40dfa6c1e3461213', 'ab33b3712cddd67c3ec91cfa1dd232c75226cd9f'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/A_HAZARD_INTEGRATION_RECEIPT.md', sha256: '3190610ddf4ea7c47d3483769ed6983a4f821ba91ec38cb9c5260310edbf9c3e' },
  },
  {
    id: 'A-COCKPIT',
    tipSha: 'd4ff9c94c9fec9477481223c4b33d8f671a34f6d',
    treeSha: 'bda9b452c9e6564576fa3cd390a5981cd6907c09',
    worktree: { directory: 'ip-assur-cockpit', branch: 'ip-assur-cockpit-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'] },
    acceptanceReceipts: [{ path: 'fixtures/productAssurance/systemic/cockpit/receipts/COCKPIT_PRESTAGE_RECEIPT.v1.json', sha256: 'b75055388f99632f2dc5ebb87d92b6d969f666397014e89a616a6e262f0650dd' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '0204687d8c65875c99d17ae7bee1c61707f0be0f',
    integrationTree: '317994f194899f0edfe170d2dcab4386280b9489',
    integrationParents: ['9edc3230f1b2411efee4a5d9b112c979ec74024c', 'd4ff9c94c9fec9477481223c4b33d8f671a34f6d'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/A_COCKPIT_INTEGRATION_RECEIPT.md', sha256: 'f11e706995c1156b82f6c1f7aaa8bcb29b0c76c8dbc9364087a973ccd7514555' },
  },
  {
    id: 'A-AGENT',
    tipSha: '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437',
    treeSha: 'e68ef10d09c11bc5623099a2eb6eb6881054486b',
    worktree: { directory: 'ip-assur-agent', branch: 'ip-assur-agent-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'] },
    acceptanceReceipts: [{ path: 'fixtures/productAssurance/systemic/agentBoundary/receipts/AGENT_BOUNDARY_PRESTAGE_RECEIPT.v1.json', sha256: 'c237939f112a41abfb83508ed57e5783a9344cc3cb76e02003ca64487831a92c' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '251d901e2a38c7b3b9634ab1728098655f0104bb',
    integrationTree: '7740fd6df57a5caf337320d439c027585df488de',
    integrationParents: ['c5d18db072153d335ab14c82634eafca2370230c', '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/A_AGENT_INTEGRATION_RECEIPT.md', sha256: 'e47be0f081b15859b2d8509e2fd0e2a611c48dcca50a8640f39dc86be717e7d0' },
  },
  {
    id: 'A-STABILITY',
    tipSha: 'd35674e7f9621320c35e0bc0270efd515cc64dbd',
    treeSha: '16c92923b837105471b232df0480d1270bda756e',
    worktree: { directory: 'ip-assur-stability', branch: 'ip-assur-stability-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'] },
    acceptanceReceipts: [{ path: 'fixtures/productAssurance/systemic/stability/receipts/STABILITY_ACCEPTANCE_RECEIPT.md', sha256: 'b26f902d90fb82633ac8532d5aa82169801ded3ec6d7bcf3477737a64eab2168' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '332208e64fb9b54ef2b6320c7609e53833da469f',
    integrationTree: 'b776b00591e853d1ed6acd9fbdef99fc9f06b2b8',
    integrationParents: ['57aff72c1d557572558aee795c5e0a669bf080af', 'd35674e7f9621320c35e0bc0270efd515cc64dbd'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/A_STABILITY_INTEGRATION_RECEIPT.md', sha256: 'bc527367b7b05f78e4be4dd4a916be59029316fa671f1d2ea1ed91f7a0f734d2' },
  },
  {
    id: 'A-CASE-S4',
    tipSha: 'b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c',
    treeSha: '3c773878016f4a56c6b03fe6485a42b002c3f5d2',
    worktree: { directory: 'ip-assur-case', branch: 'ip-assur-case-20260713', allowedUntracked: ['I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md'] },
    acceptanceReceipts: [{ path: 'fixtures/productAssurance/systemic/assuranceCase/receipts/CASE_ACCEPTANCE_RECEIPT.md', sha256: '05369b8aa403a4fae6b86143ddcb7d61551d5996838c92b9bc4aba79401a3550' }],
    integrationMethod: 'MERGE_ANCESTRY',
    integrationCommit: '86ee3b5f81c73c64eccf1d10b14a1f3bdf8a4bf1',
    integrationTree: 'db4708ef5bdd261f4493885a770aa3ff670bf674',
    integrationParents: ['7b1a93215df726d98a39ec05588d06f0badf8afe', 'b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/A_CASE_INTEGRATION_RECEIPT.md', sha256: 'f721c0a72a36255727555a4ab13e4fab0f1fc829604e8ce8ae8897760dd0925b' },
  },
  {
    id: 'L-LANE',
    tipSha: 'df6b472993ca9659ce09cf5f72004981c6835f0d',
    treeSha: '1add5ee43fea623509c20d0990ec9efac2543fc4',
    worktree: { directory: 'live-execution-proof-20260712', branch: 'live-execution-control-proof-20260712', allowedUntracked: ['DIRECTOR_Q_L_TWO_LANE_LAUNCH.md', 'LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md'] },
    acceptanceReceipts: [
      { path: 'live-edge-receipts/RECEIPTS/L17_ACCEPTANCE.md', sha256: 'f23e078fdd1cf8d64585c01b677817d4d4efa3a08f9c4933acae09b399ce2381' },
      { path: 'LIVE_EDGE_RECEIPT.md', sha256: '0b95db6e0ae8777d3e3bebb1a510561c7dfc9dcba963bd02fbc91025dd784fe2' },
    ],
    integrationMethod: 'MERGE_ANCESTRY_REQUIRED_LAST',
    integrationCommit: 'ec82bc51d5311dfb3f505216bfb3fa41733f038c',
    integrationTree: '7192a94883f6ac43d0c7d06b2a0f24275a7feef8',
    integrationParents: ['139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9', 'df6b472993ca9659ce09cf5f72004981c6835f0d'],
    integrationReceipt: { path: 'docs/archive/i00-phase2/L_LANE_INTEGRATION_RECEIPT.md', sha256: '198af74b4f0931123a41d6b0a94b1bbcd6890813986d981bd39e95ba486c296b' },
  },
]);

export const EXPECTED_EXCLUSIONS = deepFreeze([
  { id: 'A-FORMAL', tipSha: 'b491893416006cf529aef02e5dd4a25d6475e7b8', treeSha: 'c48e7ddb5572a01190cf94cef2b2426a8df2f056', disposition: 'POSTLANDING_INTEGRATED_REFERENCE_ONLY', candidateAncestry: 'REQUIRED', worktree: { directory: 'ip-assur-formal', branch: 'ip-assur-formal-20260713' } },
  { id: 'A-ACTION-EVIDENCE-S2', tipSha: 'ca30adf5e97b6697afec49f13073024d953b117b', treeSha: '1637f682c97d8fcbd4cd955afe0e48542bcb90d3', disposition: 'POSTLANDING_INTEGRATED_REFERENCE_ONLY', candidateAncestry: 'REQUIRED', worktree: { directory: 'ip-assur-action', branch: 'ip-assur-action-20260714' } },
  { id: 'PREVERIFY', tipSha: '46b2f1e31edf9f75aec7203e952a56f9869a2971', treeSha: 'ad11b333ca412093d55c5e26560ce4b3b9792c1b', disposition: 'NON_DONOR_NOT_CONFIGURED', candidateAncestry: 'FORBIDDEN', worktree: { directory: 'preverify', branch: 'preverify-20260714' } },
]);

export const INTEGRATION_ORDER = deepFreeze([
  'IP-RUNTIME', 'IP-CONTROL', 'IP-OPS', 'IP-PROOF',
  'F-BRIDGE', 'SI-RECON', 'Q-LANE', 'DASHBOARD-SHELL', 'L15-INFRASTRUCTURE',
  'A-CORE', 'A-HAZARD', 'A-COCKPIT', 'A-AGENT', 'A-STABILITY', 'A-CASE-S4', 'L-LANE',
]);

const EXPECTED_PHASE2_MERGE_SEQUENCE = deepFreeze([
  'f5523e63efcb0a5434341cf9328162be1482fc38',
  'd50de1dd1b23a40b3895b29fee5486bc069597af',
  'a6a12b943c77c54e60072f755beca984432bffa8',
  '1d9b1a3a5e859501c4c0c47e6b2c8d0d82bc4698',
  '0670f533840f415b612fb290d2c944f94af50d82',
  'ba965fb0fbb5e10819d5a704e99153892fe94031',
  'ce8d79a751c886dff388fa8f3f2fa6fb3f0414ee',
  '042dc9897d04bed2b0de3043cbdcbac408251412',
  '35672dcc448d2ca55b17c24344fb413b4d1e14a7',
  '3ee0eda6b0da01b6fae441c684fa53829cab15be',
  'bfb813ba1c15a23c7f4f0bff6a8da2f13d5c2729',
  '0204687d8c65875c99d17ae7bee1c61707f0be0f',
  '251d901e2a38c7b3b9634ab1728098655f0104bb',
  '332208e64fb9b54ef2b6320c7609e53833da469f',
  '86ee3b5f81c73c64eccf1d10b14a1f3bdf8a4bf1',
  'ec82bc51d5311dfb3f505216bfb3fa41733f038c',
]);

export const EXPECTED_DONOR_ROWS = deepFreeze(EXPECTED_DONOR_MANIFEST.map((donor) => ({
  id: donor.id,
  tipSha: donor.tipSha,
  treeSha: donor.treeSha,
  integrationMethod: donor.integrationMethod,
  integrationCommit: donor.integrationCommit,
  acceptanceReceiptSha256s: donor.acceptanceReceipts.map((receipt) => receipt.sha256),
  integrationReceiptSha256: donor.integrationReceipt.sha256,
})));

function invokeGit(cwd, args, encoding = 'utf8') {
  try {
    return runGitEvidence({
      cwd,
      args,
      output: encoding === null ? 'binary' : 'text',
    }).stdout;
  } catch (cause) {
    const error = new Error(`GIT_COMMAND_FAILED:${args[0] ?? 'UNKNOWN'}:${cause?.status ?? 'ERROR'}`);
    error.status = cause?.status ?? null;
    throw error;
  }
}

function gitText(cwd, args) {
  return invokeGit(cwd, args, 'utf8').trim();
}

function gitBytes(cwd, args) {
  return invokeGit(cwd, args, null);
}

function isAncestor(cwd, ancestor, descendant) {
  const result = runGitEvidence({
    cwd,
    args: ['merge-base', '--is-ancestor', ancestor, descendant],
    output: 'text',
    acceptedStatuses: [0, 1],
  });
  return result.status === 0;
}

function parseWorktrees(bytes) {
  const entries = [];
  let current = null;
  for (const field of bytes.toString('utf8').split('\0')) {
    if (field === '') {
      if (current !== null) entries.push(current);
      current = null;
      continue;
    }
    const separator = field.indexOf(' ');
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? true : field.slice(separator + 1);
    if (key === 'worktree') {
      if (current !== null) entries.push(current);
      current = { path: value };
    } else if (current !== null) {
      current[key] = value;
    }
  }
  if (current !== null) entries.push(current);
  return entries;
}

function parseStatus(bytes) {
  const tracked = [];
  const untracked = [];
  for (const record of bytes.toString('utf8').split('\0').filter(Boolean)) {
    if (record.startsWith('?? ')) untracked.push(record.slice(3));
    else tracked.push(record);
  }
  return { tracked: sorted(tracked), untracked: sorted(untracked) };
}

function parseTreeEntries(bytes) {
  return bytes.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const tab = record.indexOf('\t');
    const [mode, type, object] = record.slice(0, tab).split(' ');
    return { mode, type, object, path: record.slice(tab + 1) };
  });
}

function parentsOf(repoRoot, commit) {
  const value = gitText(repoRoot, ['show', '-s', '--format=%P', commit]);
  return value === '' ? [] : value.split(' ');
}

function collectReceipt(repoRoot, sourceCommit, receipt, worktreePath) {
  const objectSpec = `${sourceCommit}:${receipt.path}`;
  let worktreeSha256 = null;
  try {
    worktreeSha256 = sha256(readFileSync(path.join(worktreePath, receipt.path)));
  } catch {
    worktreeSha256 = null;
  }
  return {
    path: receipt.path,
    expectedSha256: receipt.sha256,
    sourceCommit,
    objectType: gitText(repoRoot, ['cat-file', '-t', objectSpec]),
    blobSha: gitText(repoRoot, ['rev-parse', objectSpec]),
    observedSha256: sha256(gitBytes(repoRoot, ['show', objectSpec])),
    worktreeSha256,
  };
}

function validateManifest() {
  const failures = [];
  const ids = EXPECTED_DONOR_MANIFEST.map((donor) => donor.id);
  if (ids.length !== 16 || new Set(ids).size !== 16) failures.push('STATIC_DONOR_ID_SET_INVALID');
  if (EXPECTED_DONOR_MANIFEST.reduce((sum, donor) => sum + donor.acceptanceReceipts.length, 0) !== 17) {
    failures.push('STATIC_ACCEPTANCE_RECEIPT_COUNT_INVALID');
  }
  for (const donor of EXPECTED_DONOR_MANIFEST) {
    if (![donor.tipSha, donor.treeSha, donor.integrationCommit, donor.integrationTree, ...donor.integrationParents].every((value) => FULL_SHA.test(value))) {
      failures.push(`${donor.id}_STATIC_GIT_ID_INVALID`);
    }
    if (!['MERGE_ANCESTRY', 'RECEIPTED_EQUIVALENCE', 'MERGE_ANCESTRY_REQUIRED_LAST'].includes(donor.integrationMethod)) {
      failures.push(`${donor.id}_STATIC_METHOD_INVALID`);
    }
    for (const receipt of [...donor.acceptanceReceipts, donor.integrationReceipt]) {
      if (!SAFE_REPO_PATH.test(receipt.path) || !SHA256.test(receipt.sha256)) failures.push(`${donor.id}_STATIC_RECEIPT_INVALID`);
    }
  }
  if (!exactJson(INTEGRATION_ORDER, [
    'IP-RUNTIME', 'IP-CONTROL', 'IP-OPS', 'IP-PROOF',
    'F-BRIDGE', 'SI-RECON', 'Q-LANE', 'DASHBOARD-SHELL', 'L15-INFRASTRUCTURE',
    'A-CORE', 'A-HAZARD', 'A-COCKPIT', 'A-AGENT', 'A-STABILITY', 'A-CASE-S4', 'L-LANE',
  ])) failures.push('STATIC_INTEGRATION_ORDER_INVALID');
  if (!exactJson(PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges, [
    '449350d60ab30a385edeccdf4d91716ef8550537',
    '51efaaa41fbaf85bcbefa9adc6cdbd640d814506',
    '6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd',
    'c1a4b835a15aa60152b2ecfa9ae8087f6e159ce6',
    '4eff62bdd30eceddf39bbbdf417b0eba51c22b7c',
    '9c7e8b16bc8fbaba0110daa391a6e6160dae5802',
    'b3f49616e69ee5036386414030b482b5f02e9c13',
    '2787ebf3665c1efe32af9c426504af6b871898f1',
    '614e5a8ed20b5c810ee92268a3f3c12c30971519',
    '9c3bb17638cd8bc5478b813c22c5a7050f046ce3',
    '955e204964f44246e0c69772578f43180a56b33f',
    '611df36d12d00c3fbf041fff4af9cccde03afc91',
    'e3b84307af010b8b1547418f5f6cb5078039413d',
    '48a89d9f07574868fc6346725781ba954f488a4c',
    '55b456e19dbbd97548d9beb601dfc8cc7d3c57b7',
    '995904ada86e86ef4214bea596331b978a332da0',
  ]) || !PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges.every((value) => FULL_SHA.test(value))) {
    failures.push('STATIC_POST_L_MERGE_ALLOWLIST_INVALID');
  }
  return failures;
}

export function collectDonorEqualityEvidence({
  repoRoot = DEFAULT_REPO_ROOT,
  workspaceRoot = path.dirname(repoRoot),
  candidateRef = 'HEAD',
} = {}) {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const absoluteWorkspaceRoot = path.resolve(workspaceRoot);
  const candidateSha = gitText(absoluteRepoRoot, ['rev-parse', '--verify', `${candidateRef}^{commit}`]);
  const worktrees = parseWorktrees(gitBytes(absoluteRepoRoot, ['worktree', 'list', '--porcelain', '-z']));
  const worktreesByPath = new Map(worktrees.map((entry) => [path.resolve(entry.path), entry]));

  const donors = EXPECTED_DONOR_MANIFEST.map((donor) => {
    const worktreePath = path.resolve(absoluteWorkspaceRoot, donor.worktree.directory);
    const worktreeEntry = worktreesByPath.get(worktreePath) ?? null;
    let worktreeStatus = { tracked: ['WORKTREE_MISSING'], untracked: [] };
    if (worktreeEntry !== null) {
      worktreeStatus = parseStatus(gitBytes(worktreePath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
    }
    const acceptanceReceipts = donor.acceptanceReceipts.map((receipt) => collectReceipt(
      absoluteRepoRoot,
      donor.tipSha,
      receipt,
      worktreePath,
    ));
    const integrationReceipt = collectReceipt(
      absoluteRepoRoot,
      candidateSha,
      donor.integrationReceipt,
      absoluteRepoRoot,
    );
    const integrationParents = parentsOf(absoluteRepoRoot, donor.integrationCommit);
    let methodProof;
    if (donor.integrationMethod === 'RECEIPTED_EQUIVALENCE') {
      const donorEntries = parseTreeEntries(gitBytes(absoluteRepoRoot, [
        'ls-tree', '-r', '-z', donor.tipSha, '--', donor.equivalence.path,
      ]));
      const cutEntries = parseTreeEntries(gitBytes(absoluteRepoRoot, [
        'ls-tree', '-r', '-z', donor.integrationCommit, '--', donor.equivalence.path,
      ]));
      methodProof = {
        kind: donor.integrationMethod,
        equivalencePath: donor.equivalence.path,
        expectedTree: donor.equivalence.tree,
        donorSubtree: gitText(absoluteRepoRoot, ['rev-parse', `${donor.tipSha}:${donor.equivalence.path}`]),
        cutSubtree: gitText(absoluteRepoRoot, ['rev-parse', `${donor.integrationCommit}:${donor.equivalence.path}`]),
        expectedFileCount: donor.equivalence.fileCount,
        donorFileCount: donorEntries.length,
        cutFileCount: cutEntries.length,
        exactEntries: exactJson(donorEntries, cutEntries),
        donorTipAncestorOfCandidate: isAncestor(absoluteRepoRoot, donor.tipSha, candidateSha),
      };
    } else {
      methodProof = {
        kind: donor.integrationMethod,
        exactParents: exactJson(integrationParents, donor.integrationParents),
        donorIsSecondParent: integrationParents.length === 2 && integrationParents[1] === donor.tipSha,
        donorTipAncestorOfCandidate: isAncestor(absoluteRepoRoot, donor.tipSha, candidateSha),
      };
    }
    return {
      id: donor.id,
      tip: {
        sha: donor.tipSha,
        objectType: gitText(absoluteRepoRoot, ['cat-file', '-t', donor.tipSha]),
        expectedTree: donor.treeSha,
        observedTree: gitText(absoluteRepoRoot, ['rev-parse', `${donor.tipSha}^{tree}`]),
      },
      worktree: {
        path: worktreePath,
        expectedBranch: `refs/heads/${donor.worktree.branch}`,
        expectedHead: donor.tipSha,
        observedBranch: worktreeEntry?.branch ?? null,
        observedHead: worktreeEntry?.HEAD ?? null,
        locked: Boolean(worktreeEntry?.locked),
        prunable: Boolean(worktreeEntry?.prunable),
        trackedChanges: worktreeStatus.tracked,
        allowedUntracked: sorted(donor.worktree.allowedUntracked),
        observedUntracked: worktreeStatus.untracked,
      },
      acceptanceReceipts,
      integration: {
        method: donor.integrationMethod,
        commit: donor.integrationCommit,
        objectType: gitText(absoluteRepoRoot, ['cat-file', '-t', donor.integrationCommit]),
        expectedTree: donor.integrationTree,
        observedTree: gitText(absoluteRepoRoot, ['rev-parse', `${donor.integrationCommit}^{tree}`]),
        expectedParents: donor.integrationParents,
        observedParents: integrationParents,
        ancestorOfCandidate: isAncestor(absoluteRepoRoot, donor.integrationCommit, candidateSha),
        methodProof,
        receipt: integrationReceipt,
      },
    };
  });

  const firstParentMergeShas = gitText(absoluteRepoRoot, [
    'rev-list', '--first-parent', '--reverse', '--min-parents=2',
    `${PHASE2_GRAPH_BOUNDARY.windowStart}..${PHASE2_GRAPH_BOUNDARY.requiredLastMerge}`,
  ]).split('\n').filter(Boolean);
  const firstParentMerges = firstParentMergeShas.map((commit) => ({
    commit,
    tree: gitText(absoluteRepoRoot, ['rev-parse', `${commit}^{tree}`]),
    parents: parentsOf(absoluteRepoRoot, commit),
  }));
  const laterMergeText = gitText(absoluteRepoRoot, [
    'rev-list', '--reverse', '--min-parents=2',
    `${PHASE2_GRAPH_BOUNDARY.requiredLastMerge}..${candidateSha}`,
  ]);
  const laterMerges = laterMergeText === '' ? [] : laterMergeText.split('\n');

  const donorsById = new Map(EXPECTED_DONOR_MANIFEST.map((donor) => [donor.id, donor]));
  const integrationOrderPairs = INTEGRATION_ORDER.slice(0, -1).map((id, index) => {
    const nextId = INTEGRATION_ORDER[index + 1];
    return {
      before: id,
      after: nextId,
      isAncestor: isAncestor(
        absoluteRepoRoot,
        donorsById.get(id).integrationCommit,
        donorsById.get(nextId).integrationCommit,
      ),
    };
  });

  const exclusions = EXPECTED_EXCLUSIONS.map((exclusion) => {
    const worktreePath = path.resolve(absoluteWorkspaceRoot, exclusion.worktree.directory);
    const worktreeEntry = worktreesByPath.get(worktreePath) ?? null;
    return {
      id: exclusion.id,
      disposition: exclusion.disposition,
      tip: {
        sha: exclusion.tipSha,
        objectType: gitText(absoluteRepoRoot, ['cat-file', '-t', exclusion.tipSha]),
        expectedTree: exclusion.treeSha,
        observedTree: gitText(absoluteRepoRoot, ['rev-parse', `${exclusion.tipSha}^{tree}`]),
        ancestorOfCandidate: isAncestor(absoluteRepoRoot, exclusion.tipSha, candidateSha),
      },
      worktree: {
        path: worktreePath,
        expectedBranch: `refs/heads/${exclusion.worktree.branch}`,
        expectedHead: exclusion.tipSha,
        observedBranch: worktreeEntry?.branch ?? null,
        observedHead: worktreeEntry?.HEAD ?? null,
      },
    };
  });

  const integrationReceiptPaths = [...new Set(EXPECTED_DONOR_MANIFEST.map((donor) => donor.integrationReceipt.path))];
  const integrationReceiptWorktreeStatus = parseStatus(gitBytes(absoluteRepoRoot, [
    'status', '--porcelain=v1', '-z', '--untracked-files=no', '--', ...integrationReceiptPaths,
  ]));

  return {
    schemaVersion: 'I00_DONOR_EQUALITY_OBSERVATION_V1',
    repoRoot: absoluteRepoRoot,
    workspaceRoot: absoluteWorkspaceRoot,
    candidate: {
      requestedRef: candidateRef,
      sha: candidateSha,
      objectType: gitText(absoluteRepoRoot, ['cat-file', '-t', candidateSha]),
      tree: gitText(absoluteRepoRoot, ['rev-parse', `${candidateSha}^{tree}`]),
      descendsFromWindowStart: isAncestor(absoluteRepoRoot, PHASE2_GRAPH_BOUNDARY.windowStart, candidateSha),
      descendsFromAuthorityAcceptance: isAncestor(absoluteRepoRoot, PHASE2_GRAPH_BOUNDARY.authorityAcceptance, candidateSha),
      descendsFromRequiredLastMerge: isAncestor(absoluteRepoRoot, PHASE2_GRAPH_BOUNDARY.requiredLastMerge, candidateSha),
    },
    donors,
    mergeWindow: {
      start: PHASE2_GRAPH_BOUNDARY.windowStart,
      expectedSequence: EXPECTED_PHASE2_MERGE_SEQUENCE,
      observedSequence: firstParentMergeShas,
      observed: firstParentMerges,
      permittedNonDonor: PHASE2_GRAPH_BOUNDARY.permittedNonDonorMerge,
      authorizedLaterMerges: PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges,
      laterMerges,
    },
    integrationOrder: {
      expected: INTEGRATION_ORDER,
      pairs: integrationOrderPairs,
    },
    exclusions,
    integrationReceiptWorktreeStatus,
  };
}

function pushFailure(failures, code) {
  if (!failures.includes(code)) failures.push(code);
}

export function evaluateDonorEquality(observation, { expectedRows = EXPECTED_DONOR_ROWS } = {}) {
  const failures = validateManifest();
  if (!exactJson(expectedRows, EXPECTED_DONOR_ROWS)) pushFailure(failures, 'CALLER_EXPECTED_DONOR_TABLE_MISMATCH');
  if (observation?.schemaVersion !== 'I00_DONOR_EQUALITY_OBSERVATION_V1') {
    pushFailure(failures, 'OBSERVATION_SCHEMA_INVALID');
  }
  const candidate = observation?.candidate ?? {};
  if (candidate.objectType !== 'commit' || !FULL_SHA.test(candidate.sha ?? '') || !FULL_SHA.test(candidate.tree ?? '')) {
    pushFailure(failures, 'CANDIDATE_GIT_OBJECT_INVALID');
  }
  if (!candidate.descendsFromWindowStart) pushFailure(failures, 'CANDIDATE_WINDOW_ANCESTRY_MISSING');
  if (!candidate.descendsFromAuthorityAcceptance) pushFailure(failures, 'CANDIDATE_AUTHORITY_ANCESTRY_MISSING');
  if (!candidate.descendsFromRequiredLastMerge) pushFailure(failures, 'CANDIDATE_L_LAST_ANCESTRY_MISSING');

  const observedDonors = Array.isArray(observation?.donors) ? observation.donors : [];
  const observedIds = observedDonors.map((donor) => donor.id);
  const expectedIds = EXPECTED_DONOR_MANIFEST.map((donor) => donor.id);
  if (!exactJson(observedIds, expectedIds) || new Set(observedIds).size !== 16) {
    pushFailure(failures, 'DONOR_ID_SET_INVALID');
  }
  const observedById = new Map(observedDonors.map((donor) => [donor.id, donor]));
  const discoveredIds = [];
  const acceptedIds = [];
  const integratedIds = [];
  const donorProofs = [];

  for (const expected of EXPECTED_DONOR_MANIFEST) {
    const observed = observedById.get(expected.id);
    if (observed === undefined) {
      pushFailure(failures, `${expected.id}_MISSING`);
      continue;
    }
    const tipValid = observed.tip?.sha === expected.tipSha
      && observed.tip?.objectType === 'commit'
      && observed.tip?.expectedTree === expected.treeSha
      && observed.tip?.observedTree === expected.treeSha;
    if (!tipValid) pushFailure(failures, `${expected.id}_DONOR_OBJECT_INVALID`);
    const worktreeIdentityValid = observed.worktree?.observedHead === expected.tipSha
      && observed.worktree?.observedBranch === `refs/heads/${expected.worktree.branch}`
      && observed.worktree?.expectedHead === expected.tipSha
      && observed.worktree?.expectedBranch === `refs/heads/${expected.worktree.branch}`;
    if (!worktreeIdentityValid) pushFailure(failures, `${expected.id}_WORKTREE_IDENTITY_INVALID`);
    const worktreeClean = Array.isArray(observed.worktree?.trackedChanges)
      && observed.worktree.trackedChanges.length === 0
      && sameSortedValues(observed.worktree?.observedUntracked ?? [], expected.worktree.allowedUntracked)
      && observed.worktree?.locked === false
      && observed.worktree?.prunable === false;
    if (!worktreeClean) pushFailure(failures, `${expected.id}_WORKTREE_DIRTY_OR_PARTIAL`);
    const discovered = tipValid && worktreeIdentityValid;
    if (discovered) discoveredIds.push(expected.id);

    const acceptanceReceipts = Array.isArray(observed.acceptanceReceipts) ? observed.acceptanceReceipts : [];
    let acceptanceValid = acceptanceReceipts.length === expected.acceptanceReceipts.length;
    if (!acceptanceValid) pushFailure(failures, `${expected.id}_ACCEPTANCE_RECEIPT_COUNT_INVALID`);
    for (let index = 0; index < expected.acceptanceReceipts.length; index += 1) {
      const expectedReceipt = expected.acceptanceReceipts[index];
      const observedReceipt = acceptanceReceipts[index];
      const valid = observedReceipt?.path === expectedReceipt.path
        && observedReceipt?.sourceCommit === expected.tipSha
        && observedReceipt?.objectType === 'blob'
        && FULL_SHA.test(observedReceipt?.blobSha ?? '')
        && observedReceipt?.expectedSha256 === expectedReceipt.sha256
        && observedReceipt?.observedSha256 === expectedReceipt.sha256
        && observedReceipt?.worktreeSha256 === expectedReceipt.sha256;
      acceptanceValid = acceptanceValid && valid;
      if (!valid) pushFailure(failures, `${expected.id}_ACCEPTANCE_RECEIPT_INVALID`);
    }
    const accepted = discovered && worktreeClean && acceptanceValid;
    if (accepted) acceptedIds.push(expected.id);

    const integration = observed.integration ?? {};
    const integrationObjectValid = integration.method === expected.integrationMethod
      && integration.commit === expected.integrationCommit
      && integration.objectType === 'commit'
      && integration.expectedTree === expected.integrationTree
      && integration.observedTree === expected.integrationTree
      && exactJson(integration.expectedParents, expected.integrationParents)
      && exactJson(integration.observedParents, expected.integrationParents)
      && integration.ancestorOfCandidate === true;
    if (!integrationObjectValid) pushFailure(failures, `${expected.id}_INTEGRATION_OBJECT_INVALID`);
    let methodValid = false;
    if (expected.integrationMethod === 'RECEIPTED_EQUIVALENCE') {
      const method = integration.methodProof ?? {};
      methodValid = method.kind === 'RECEIPTED_EQUIVALENCE'
        && method.equivalencePath === expected.equivalence.path
        && method.expectedTree === expected.equivalence.tree
        && method.donorSubtree === expected.equivalence.tree
        && method.cutSubtree === expected.equivalence.tree
        && method.expectedFileCount === expected.equivalence.fileCount
        && method.donorFileCount === expected.equivalence.fileCount
        && method.cutFileCount === expected.equivalence.fileCount
        && method.exactEntries === true
        && method.donorTipAncestorOfCandidate === false;
      if (!methodValid) pushFailure(failures, `${expected.id}_EQUIVALENCE_CUT_INVALID`);
    } else {
      const method = integration.methodProof ?? {};
      methodValid = method.kind === expected.integrationMethod
        && method.exactParents === true
        && method.donorIsSecondParent === true
        && method.donorTipAncestorOfCandidate === true;
      if (!methodValid) pushFailure(failures, `${expected.id}_MERGE_PARENT_PROOF_INVALID`);
    }
    const integrationReceipt = integration.receipt ?? {};
    const integrationReceiptValid = integrationReceipt.path === expected.integrationReceipt.path
      && integrationReceipt.sourceCommit === candidate.sha
      && integrationReceipt.objectType === 'blob'
      && FULL_SHA.test(integrationReceipt.blobSha ?? '')
      && integrationReceipt.expectedSha256 === expected.integrationReceipt.sha256
      && integrationReceipt.observedSha256 === expected.integrationReceipt.sha256
      && integrationReceipt.worktreeSha256 === expected.integrationReceipt.sha256;
    if (!integrationReceiptValid) pushFailure(failures, `${expected.id}_INTEGRATION_RECEIPT_INVALID`);
    const integrated = integrationObjectValid && methodValid && integrationReceiptValid;
    if (integrated) integratedIds.push(expected.id);
    donorProofs.push({
      id: expected.id,
      discovered,
      accepted,
      integrated,
      tip: observed.tip,
      worktree: observed.worktree,
      acceptanceReceipts,
      integration,
    });
  }

  const mergeWindow = observation?.mergeWindow ?? {};
  if (!exactJson(mergeWindow.expectedSequence, EXPECTED_PHASE2_MERGE_SEQUENCE)
    || !exactJson(mergeWindow.observedSequence, EXPECTED_PHASE2_MERGE_SEQUENCE)) {
    pushFailure(failures, 'PHASE2_MERGE_SEQUENCE_INVALID');
  }
  const permitted = mergeWindow.permittedNonDonor ?? {};
  if (permitted.commit !== PHASE2_GRAPH_BOUNDARY.permittedNonDonorMerge.commit
    || permitted.tree !== PHASE2_GRAPH_BOUNDARY.permittedNonDonorMerge.tree
    || !exactJson(permitted.parents, PHASE2_GRAPH_BOUNDARY.permittedNonDonorMerge.parents)) {
    pushFailure(failures, 'PERMITTED_NON_DONOR_MERGE_INVALID');
  }
  const postLTopologyExact = Array.isArray(mergeWindow.authorizedLaterMerges)
    && exactJson(mergeWindow.authorizedLaterMerges, PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges)
    && Array.isArray(mergeWindow.laterMerges)
    && exactJson(mergeWindow.laterMerges, PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges);
  if (!postLTopologyExact) {
    pushFailure(failures, 'POST_L_MERGE_ALLOWLIST_MISMATCH');
  }
  const observedMergeByCommit = new Map((mergeWindow.observed ?? []).map((entry) => [entry.commit, entry]));
  for (const expected of EXPECTED_DONOR_MANIFEST.filter((donor) => donor.integrationMethod !== 'RECEIPTED_EQUIVALENCE')) {
    const merge = observedMergeByCommit.get(expected.integrationCommit);
    if (merge?.tree !== expected.integrationTree || !exactJson(merge?.parents, expected.integrationParents)) {
      pushFailure(failures, `${expected.id}_MERGE_WINDOW_PROOF_INVALID`);
    }
  }
  const allowedMerge = observedMergeByCommit.get(PHASE2_GRAPH_BOUNDARY.permittedNonDonorMerge.commit);
  if (allowedMerge?.tree !== PHASE2_GRAPH_BOUNDARY.permittedNonDonorMerge.tree
    || !exactJson(allowedMerge?.parents, PHASE2_GRAPH_BOUNDARY.permittedNonDonorMerge.parents)) {
    pushFailure(failures, 'PERMITTED_NON_DONOR_MERGE_OBJECT_INVALID');
  }

  if (!exactJson(observation?.integrationOrder?.expected, INTEGRATION_ORDER)
    || !Array.isArray(observation?.integrationOrder?.pairs)
    || observation.integrationOrder.pairs.length !== INTEGRATION_ORDER.length - 1
    || observation.integrationOrder.pairs.some((pair, index) => pair.before !== INTEGRATION_ORDER[index]
      || pair.after !== INTEGRATION_ORDER[index + 1] || pair.isAncestor !== true)) {
    pushFailure(failures, 'DONOR_INTEGRATION_ORDER_INVALID');
  }

  const expectedExclusionIds = EXPECTED_EXCLUSIONS.map((entry) => entry.id);
  const observedExclusions = Array.isArray(observation?.exclusions) ? observation.exclusions : [];
  if (!exactJson(observedExclusions.map((entry) => entry.id), expectedExclusionIds)) {
    pushFailure(failures, 'EXCLUSION_SET_INVALID');
  }
  const exclusionProofs = [];
  for (const expected of EXPECTED_EXCLUSIONS) {
    const observed = observedExclusions.find((entry) => entry.id === expected.id);
    const expectedAncestor = expected.candidateAncestry === 'REQUIRED';
    const valid = observed?.disposition === expected.disposition
      && observed?.tip?.sha === expected.tipSha
      && observed?.tip?.objectType === 'commit'
      && observed?.tip?.expectedTree === expected.treeSha
      && observed?.tip?.observedTree === expected.treeSha
      && observed?.tip?.ancestorOfCandidate === expectedAncestor
      && observed?.worktree?.observedHead === expected.tipSha
      && observed?.worktree?.observedBranch === `refs/heads/${expected.worktree.branch}`;
    if (!valid) pushFailure(failures, `${expected.id}_EXCLUSION_PROOF_INVALID`);
    exclusionProofs.push({ ...observed, excluded: valid });
  }

  if (!Array.isArray(observation?.integrationReceiptWorktreeStatus?.tracked)
    || observation.integrationReceiptWorktreeStatus.tracked.length !== 0
    || !Array.isArray(observation?.integrationReceiptWorktreeStatus?.untracked)
    || observation.integrationReceiptWorktreeStatus.untracked.length !== 0) {
    pushFailure(failures, 'INTEGRATION_RECEIPT_WORKTREE_DIRTY');
  }

  const counts = {
    expected: EXPECTED_DONOR_MANIFEST.length,
    discovered: discoveredIds.length,
    accepted: acceptedIds.length,
    integrated: integratedIds.length,
  };
  if (!exactJson(counts, { expected: 16, discovered: 16, accepted: 16, integrated: 16 })) {
    pushFailure(failures, 'EXPECTED_DISCOVERED_ACCEPTED_INTEGRATED_NOT_EQUAL');
  }
  const exactSets = {
    expected: expectedIds,
    discovered: discoveredIds,
    accepted: acceptedIds,
    integrated: integratedIds,
  };
  if (!exactJson(exactSets.expected, exactSets.discovered)
    || !exactJson(exactSets.expected, exactSets.accepted)
    || !exactJson(exactSets.expected, exactSets.integrated)) {
    pushFailure(failures, 'DONOR_EXACT_SET_EQUALITY_FAILED');
  }

  const status = failures.length === 0 ? 'PASS' : 'BLOCKED';
  const proof = {
    schemaVersion: 'I00_DONOR_EQUALITY_PROOF_V1',
    status,
    candidate: {
      sha: candidate.sha ?? null,
      tree: candidate.tree ?? null,
      objectType: candidate.objectType ?? null,
    },
    counts,
    exactSets,
    integrationOrder: observation?.integrationOrder ?? null,
    mergeWindow: {
      start: mergeWindow.start ?? null,
      observedSequence: mergeWindow.observedSequence ?? [],
      permittedNonDonor: permitted,
      authorizedLaterMerges: mergeWindow.authorizedLaterMerges ?? [],
      laterMerges: mergeWindow.laterMerges ?? [],
    },
    requiredLast: {
      merge: PHASE2_GRAPH_BOUNDARY.requiredLastMerge,
      firstParent: PHASE2_GRAPH_BOUNDARY.requiredLastFirstParent,
      donor: PHASE2_GRAPH_BOUNDARY.requiredLastDonor,
      authorizedLaterMerges: PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges,
      postLTopologyExact,
    },
    donors: donorProofs,
    exclusions: exclusionProofs,
    failures: sorted(failures),
  };
  return deepFreeze({
    ...proof,
    proofSha256: sha256(Buffer.from(JSON.stringify(proof), 'utf8')),
  });
}

export function verifyDonorEquality(options = {}) {
  try {
    const observation = collectDonorEqualityEvidence(options);
    return evaluateDonorEquality(observation, { expectedRows: options.expectedRows ?? EXPECTED_DONOR_ROWS });
  } catch (error) {
    const proof = {
      schemaVersion: 'I00_DONOR_EQUALITY_PROOF_V1',
      status: 'BLOCKED',
      candidate: { sha: null, tree: null, objectType: null },
      counts: { expected: 16, discovered: 0, accepted: 0, integrated: 0 },
      exactSets: { expected: EXPECTED_DONOR_MANIFEST.map((donor) => donor.id), discovered: [], accepted: [], integrated: [] },
      integrationOrder: null,
      mergeWindow: { start: PHASE2_GRAPH_BOUNDARY.windowStart, observedSequence: [], permittedNonDonor: PHASE2_GRAPH_BOUNDARY.permittedNonDonorMerge, authorizedLaterMerges: PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges, laterMerges: [] },
      requiredLast: { merge: PHASE2_GRAPH_BOUNDARY.requiredLastMerge, firstParent: PHASE2_GRAPH_BOUNDARY.requiredLastFirstParent, donor: PHASE2_GRAPH_BOUNDARY.requiredLastDonor, authorizedLaterMerges: PHASE2_GRAPH_BOUNDARY.authorizedLaterMerges, postLTopologyExact: false },
      donors: [],
      exclusions: [],
      failures: [`COLLECTION_FAILED:${error instanceof Error ? error.message : 'UNKNOWN'}`],
    };
    return deepFreeze({ ...proof, proofSha256: sha256(Buffer.from(JSON.stringify(proof), 'utf8')) });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  const candidateIndex = process.argv.indexOf('--candidate-ref');
  const candidateRef = candidateIndex === -1 ? 'HEAD' : process.argv[candidateIndex + 1];
  if (candidateRef === undefined || (candidateIndex !== -1 && process.argv.length !== candidateIndex + 2)) {
    process.stderr.write('usage: node test/i00/donor-equality.mjs [--candidate-ref <commit>]\n');
    process.exitCode = 2;
  } else {
    const proof = verifyDonorEquality({ candidateRef });
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
    process.exitCode = proof.status === 'PASS' ? 0 : 1;
  }
}
