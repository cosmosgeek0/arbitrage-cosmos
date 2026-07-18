import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  C9_CORRECTION_GRANTS,
  D_LAUNCH_65_AUTHORITY,
  EXACT_C9_CANDIDATE,
  EXACT_C9_TREE,
  EXACT_EVIDENCE_DESCENDANT_FILES,
  EXACT_EVIDENCE_OUTPUTS,
  EXACT_EVIDENCE_PROOF_REFERENCES,
  EXACT_EVIDENCE_TOOLING_FILES,
  EXTERNAL_INPUT_SPECS,
  FORBIDDEN_HUMAN_GATE_TOKENS,
  HUMAN_EVIDENCE_ARTIFACT_SPECS,
  LOCK_INVENTORY_MATRIX_REQUIREMENT_ID,
  REJECTED_CANDIDATE_SHAS,
  REJECTED_SELECTION_HISTORY,
  REQUIRED_C2_PARENT,
  REQUIRED_MATRIX_COUNTS,
  SAME_TREE_LANDING_COMMIT,
  SEALED_C9_EVIDENCE_COMMIT,
  SEALED_C9_EVIDENCE_TREE,
  VFINAL5_AUTHORITY,
} from '../../../verification/product-truth-20260716/campaign-input-registry.mjs';
import { renderCanonicalHumanArtifact } from '../../../verification/product-truth-20260716/human-evidence-renderer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CAMPAIGN = path.join(ROOT, 'verification/product-truth-20260716');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitBlob = (bytes) => createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes)
  .digest('hex');
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

test('campaign payload registry makes every external lock input independently rehashable', () => {
  const metadata = JSON.parse(readFileSync(path.join(CAMPAIGN, 'LOCKED_INPUT_PAYLOADS.json'), 'utf8'));
  assert.equal(EXTERNAL_INPUT_SPECS.length, 23);
  assert.equal(metadata.members.length, 23);
  assert.equal(new Set(metadata.members.map((row) => row.input_id)).size, 23);

  const specs = new Map(EXTERNAL_INPUT_SPECS.map((row) => [row.inputId, row]));
  for (const member of metadata.members) {
    const spec = specs.get(member.input_id);
    assert.ok(spec, `unknown payload member ${member.input_id}`);
    assert.ok(!path.isAbsolute(member.payload_relative_path), `${member.input_id} must be clone-relative`);
    const bytes = readFileSync(path.join(CAMPAIGN, member.payload_relative_path));
    assert.equal(bytes.length, member.byte_length, `${member.input_id} byte length`);
    assert.equal(sha256(bytes), member.sha256, `${member.input_id} sha256`);
    assert.equal(gitBlob(bytes), member.git_blob, `${member.input_id} Git blob`);
    assert.equal(member.sha256, spec.expectedSha256, `${member.input_id} registry sha256`);
  }
  assert.equal(
    metadata.inventory_sha256,
    sha256(Buffer.from(canonicalJson({
      members: metadata.members,
      authority_members: metadata.authority_members,
    }))),
  );
});

test('D-LAUNCH-65 and VFINAL5 authorities are payload-bound without ambient current-main', () => {
  const metadata = JSON.parse(readFileSync(path.join(CAMPAIGN, 'LOCKED_INPUT_PAYLOADS.json'), 'utf8'));
  const authorities = new Map(metadata.authority_members.map((row) => [row.member_id, row]));
  for (const [id, expected] of [
    ['authority:D_LAUNCH_65', D_LAUNCH_65_AUTHORITY],
    ['authority:VFINAL5_RECEIPT', VFINAL5_AUTHORITY],
  ]) {
    const member = authorities.get(id);
    assert.ok(member, `missing ${id}`);
    const bytes = readFileSync(path.join(CAMPAIGN, member.payload_relative_path));
    assert.equal(bytes.length, expected.byte_length);
    assert.equal(sha256(bytes), expected.sha256);
    assert.equal(gitBlob(bytes), expected.git_blob);
  }
});

test('exact-candidate generator source is fail-closed and covers the locked cardinalities', () => {
  const script = path.join(CAMPAIGN, 'generate-exact-candidate-evidence.mjs');
  const source = readFileSync(script, 'utf8');
  const censusSource = readFileSync(path.join(CAMPAIGN, 'generate-worktree-census.mjs'), 'utf8');
  const manifestSource = readFileSync(path.join(CAMPAIGN, 'generate-manifest.mjs'), 'utf8');
  const verifierSource = readFileSync(path.join(CAMPAIGN, 'verify-exact-candidate-evidence.mjs'), 'utf8');
  const directiveMatrix = readFileSync(path.join(CAMPAIGN, 'DIRECTIVE_COVERAGE_MATRIX.csv'), 'utf8');
  assert.equal(REQUIRED_C2_PARENT, 'dea2d2a5c2b5e83d3aea75b0e368f0a478596561');
  assert.equal(EXACT_C9_CANDIDATE, 'd8a86f722689ed82ad40f9ec44bbbc19c2347646');
  assert.equal(EXACT_C9_TREE, '1da28eb2dcc03a0545fc2bc51e2a735e88826014');
  assert.equal(SEALED_C9_EVIDENCE_COMMIT, '5fd74604082420fbe46d98e408ef4ca0d1b57711');
  assert.equal(SEALED_C9_EVIDENCE_TREE, '762143c25a77390d5b24e23b8f81c49a26b9d7d4');
  assert.equal(SAME_TREE_LANDING_COMMIT, 'bcb3e76b274b7f459af0f85545d38ca117c1f0bd');
  assert.deepEqual(REJECTED_CANDIDATE_SHAS, [
    '41752d6a87dc1cb1b933bb4460c9cabfc15ff694',
    '78f708d6cdb9d1618c53d3f08f71097b4320a63b',
    '4c9143a0bcc331aa170e9e26b741240b39df8b9e',
    '959a5f9900e25f53414710bbfb3464c3ccb67a5d',
    '89cd7e066b97f2f33d730d1e0adf291ebe7c4f64',
    'a283eb859ec1142aadecbd64e0b84959535f6216',
    '6ab02a82931ae8234456c0710cca41b94fdc12c9',
  ]);
  assert.deepEqual(REJECTED_SELECTION_HISTORY.map((row) => row.label), ['C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
  assert.equal(new Set(REJECTED_SELECTION_HISTORY.map((row) => row.sha)).size, 6);
  assert.ok(REJECTED_SELECTION_HISTORY.every((row) => /^[a-f0-9]{40}$/u.test(row.tree)));
  assert.ok(REJECTED_SELECTION_HISTORY.every((row) => row.disposition.startsWith('REJECTED_')));
  assert.ok(REJECTED_SELECTION_HISTORY.every((row) => row.reason.length > 0));
  assert.equal(REQUIRED_MATRIX_COUNTS.DIRECTIVE_COVERAGE_MATRIX, 153);
  assert.equal(REQUIRED_MATRIX_COUNTS.CAPABILITY_TRUTH_MATRIX, 23);
  assert.equal(REQUIRED_MATRIX_COUNTS.COCKPIT_BINDING_MATRIX, 178);
  assert.equal(LOCK_INVENTORY_MATRIX_REQUIREMENT_ID, 'CAMP-09-PROVENANCE');
  assert.ok(C9_CORRECTION_GRANTS.includes('verification/product-truth-20260716/'));
  assert.deepEqual(EXACT_EVIDENCE_OUTPUTS.slice().sort(), [
    'AI_OPS_C2_DISPOSITION.json',
    'AUTHORITY_RESOLUTION.md',
    'C2_PROOF_BINDING.json',
    'CAPABILITY_TRUTH_MATRIX.csv',
    'CLEAN_CLONE_ACCEPTANCE.md',
    'COCKPIT_BINDING_MATRIX.csv',
    'COMPOSED_RUNTIME_RECEIPT.md',
    'DIRECTIVE_COVERAGE_MATRIX.csv',
    'EVIDENCE_SELECTION.json',
    'FINAL_VERDICT.md',
    'INDEPENDENT_FINDINGS.json',
    'INPUTS.lock',
    'LOCKED_INPUT_PAYLOADS.json',
    'MANIFEST.json',
    'MANIFEST.sha256',
    'MERGE_PROVENANCE.json',
    'PRODUCT_ASSURANCE_C2_DISPOSITION.json',
    'STAGING_OPERATIONAL_RECEIPT.md',
    'STATE.md',
    'UNMERGED_DELTA_REPORT.md',
    'WORKTREE_CENSUS.json',
  ].sort());
  assert.equal(EXACT_EVIDENCE_OUTPUTS.length, 21);
  assert.deepEqual(EXACT_EVIDENCE_TOOLING_FILES, [
    'campaign-input-registry.mjs',
    'generate-exact-candidate-evidence.mjs',
    'generate-manifest.mjs',
    'human-evidence-renderer.mjs',
    'verify-exact-candidate-evidence.mjs',
  ]);
  assert.equal(EXACT_EVIDENCE_DESCENDANT_FILES.length, 26);
  assert.deepEqual(EXACT_EVIDENCE_DESCENDANT_FILES, [
    ...EXACT_EVIDENCE_OUTPUTS,
    ...EXACT_EVIDENCE_TOOLING_FILES,
  ]);
  assert.equal(HUMAN_EVIDENCE_ARTIFACT_SPECS.length, 6);
  assert.equal(new Set(HUMAN_EVIDENCE_ARTIFACT_SPECS.map((row) => row.path)).size, 6);
  assert.equal(new Set(EXACT_EVIDENCE_PROOF_REFERENCES.map((row) => row.proof_reference_id)).size, EXACT_EVIDENCE_PROOF_REFERENCES.length);
  assert.equal(
    directiveMatrix.split('\n').filter((row) => row.startsWith(`"${LOCK_INVENTORY_MATRIX_REQUIREMENT_ID}",`)).length,
    1,
  );
  assert.match(source, /EXACT_FULL_CANDIDATE_SHA_REQUIRED/);
  assert.match(source, /CANDIDATE_PARENT_COUNT/);
  assert.match(source, /CANDIDATE_DIRECT_PARENT/);
  assert.match(source, /REJECTED_CANDIDATE_RELABEL_ATTEMPT/);
  assert.match(source, /C9_SOURCE_STATE_MARKER_MISSING/);
  assert.doesNotMatch(source, /run\(process\.execPath, \[resolve\(root, 'generate-worktree-census\.mjs'/);
  assert.match(source, /sealedEvidenceJson\('WORKTREE_CENSUS\.json'\)/);
  assert.match(source, /generate-manifest\.mjs/);
  assert.match(source, /product-truth-c9-evidence-selection\.v4/);
  assert.match(source, /HUMAN_EVIDENCE_ARTIFACT_SPECS/);
  assert.match(source, /renderCanonicalHumanArtifact/);
  assert.match(source, /PROOF_REFERENCE_SYMBOL/);
  assert.match(source, /product-truth-merge-provenance\.v3/);
  assert.match(source, /donor_blob_mismatches_at_candidate/);
  assert.match(source, /inventory_sha256: sha256/);
  assert.match(source, /PROVENANCE_UNEXPLAINED_EDITS/);
  assert.match(source, /post_candidate_path_allowlist: EXACT_EVIDENCE_DESCENDANT_FILES/);
  assert.match(source, /GENERATOR_MUST_RUN_FROM_TARGET_REPOSITORY_TOOLING/);
  assert.match(source, /rejected_candidate_history: REJECTED_SELECTION_HISTORY/);
  assert.match(source, /\['DEP-004', \{/);
  assert.match(source, /C9 baseline custody token, fresh final-verifier verdict/);
  assert.match(source, /OVERRIDE_ROW_MISSING/);
  assert.match(source, /CANDIDATE_ABSENCE_AND_EXCLUSION_PROOFS/);
  assert.match(source, /CANDIDATE_PATH_PREFIX_PRESENT/);
  assert.match(source, /FRONTIER_REFERENCE_ANCESTRY/);
  assert.match(
    source,
    /sha: '887221418345ad54d7b98881b359fab85a6188e6'[\s\S]{0,160}role: 'PARKED_FRONTIER_COORDINATOR_TIP'[\s\S]{0,120}expected_ancestor_of_candidate: false/,
  );
  assert.match(verifierSource, /MATRIX_IDENTITY_SET/);
  assert.match(verifierSource, /MATRIX_DEPLOYMENT_RUNTIME_EVIDENCE/);
  assert.match(verifierSource, /INPUT_CONTENT_OID/);
  assert.match(verifierSource, /POST_CANDIDATE_EXACT_EVIDENCE_PATHS/);
  assert.match(verifierSource, /HUMAN_ARTIFACT_OMITTED/);
  assert.match(verifierSource, /HUMAN_ARTIFACT_CANONICAL_RENDER/);
  assert.match(verifierSource, /renderCanonicalHumanArtifact/);
  assert.match(verifierSource, /VERIFIER_MUST_RUN_FROM_TARGET_REPOSITORY_TOOLING/);
  assert.match(verifierSource, /TOOLING_RUNTIME_EVIDENCE_BINDING/);
  assert.match(verifierSource, /PROOF_REFERENCE_SYMBOL_MISSING/);
  assert.match(verifierSource, /EXACT_C9_CANDIDATE/);
  assert.match(verifierSource, /CENSUS_TRUTH_A_HEAD/);
  assert.match(verifierSource, /SELECTION_REJECTED_C8/);
  assert.match(verifierSource, /SELECTION_REJECTION_HISTORY/);
  assert.match(verifierSource, /SELECTION_REJECTED_C5_DISPOSITION/);
  assert.match(verifierSource, /CANDIDATE_ABSENCE_PROOF_PREFIXES/);
  assert.match(verifierSource, /CANDIDATE_ABSENCE_PROOF_COUNT/);
  assert.match(verifierSource, /FRONTIER_REFERENCE_ANCESTRY/);
  assert.match(
    verifierSource,
    /sha: '887221418345ad54d7b98881b359fab85a6188e6'[\s\S]{0,160}role: 'PARKED_FRONTIER_COORDINATOR_TIP'[\s\S]{0,120}expected_ancestor_of_candidate: false/,
  );
  assert.match(
    directiveMatrix,
    /"AIO-008"[^\n]*generate-exact-candidate-evidence\.mjs; verification\/product-truth-20260716\/verify-exact-candidate-evidence\.mjs/,
  );
  assert.match(
    directiveMatrix,
    /"DEP-003"[^\n]*generate-exact-candidate-evidence\.mjs; verification\/product-truth-20260716\/verify-exact-candidate-evidence\.mjs/,
  );
  assert.match(
    directiveMatrix,
    /"FRT-000"[^\n]*generate-exact-candidate-evidence\.mjs; verification\/product-truth-20260716\/verify-exact-candidate-evidence\.mjs/,
  );
  assert.doesNotMatch(directiveMatrix, /generate-wave1-evidence\.mjs/);
  assert.match(censusSource, /REJECTED_CANDIDATE_RELABEL_ATTEMPT/);
  assert.match(censusSource, /EXACT_FROZEN_CANDIDATE_NOT_MUTABLE_EVIDENCE_DESCENDANT_HEAD/);
  assert.match(censusSource, /SORTED_PORCELAIN_RECORDS_WITH_TRUTH_A_HEAD_NORMALIZED_TO_EXACT_CANDIDATE/);
  assert.match(censusSource, /exactStringList\(committedDelta, EXACT_EVIDENCE_PATHS\)/);
  assert.match(manifestSource, /product-truth-manifest\.v4/);
  assert.match(manifestSource, /EXACT_EVIDENCE_DESCENDANT_FILES/);
  assert.match(manifestSource, /MANIFEST_GENERATOR_MUST_RUN_FROM_TARGET_REPOSITORY_TOOLING/);
  assert.match(verifierSource, /REJECTED_C8_CANDIDATE/);
  assert.doesNotMatch(censusSource, /D-LAUNCH-65 is not in both current-main authority refs/);
  assert.doesNotMatch(source, /SOURCE_COMMIT_CANNOT_SELF_NAME/);
});

test('generated C9 selection binds all six human artifacts to executable Git-object proofs', () => {
  const selection = JSON.parse(readFileSync(path.join(CAMPAIGN, 'EVIDENCE_SELECTION.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(path.join(CAMPAIGN, 'MANIFEST.json'), 'utf8'));
  assert.equal(selection.schema, 'product-truth-c9-evidence-selection.v4');
  assert.equal(selection.source_candidate, EXACT_C9_CANDIDATE);
  assert.equal(selection.source_candidate_tree, EXACT_C9_TREE);
  assert.equal(selection.source_candidate_parent, REQUIRED_C2_PARENT);
  assert.equal(selection.exact_generated_output_count, 21);
  assert.deepEqual(selection.exact_generated_outputs, EXACT_EVIDENCE_OUTPUTS);
  assert.equal(selection.exact_tooling_file_count, 5);
  assert.deepEqual(selection.exact_tooling_files, EXACT_EVIDENCE_TOOLING_FILES);
  assert.equal(selection.exact_descendant_path_count, 26);
  assert.deepEqual(
    selection.post_candidate_path_allowlist.slice().sort(),
    EXACT_EVIDENCE_DESCENDANT_FILES.map((name) => `verification/product-truth-20260716/${name}`).sort(),
  );
  const toolingBindings = EXACT_EVIDENCE_TOOLING_FILES.map((name) => {
    const bytes = readFileSync(path.join(CAMPAIGN, name));
    return {
      path: name,
      sha256: sha256(bytes),
      git_blob: gitBlob(bytes),
      byte_length: bytes.length,
    };
  });
  assert.deepEqual(selection.tooling_bindings, toolingBindings);
  assert.equal(selection.tooling_bundle_sha256, sha256(Buffer.from(canonicalJson(toolingBindings), 'utf8')));
  assert.deepEqual(selection.rejected_candidate_history, REJECTED_SELECTION_HISTORY);
  assert.deepEqual(selection.sealed_machine_evidence_source, {
    commit: SEALED_C9_EVIDENCE_COMMIT,
    tree: SEALED_C9_EVIDENCE_TREE,
    state: 'HISTORICAL_EXACT_C9_MACHINE_EVIDENCE_SOURCE',
  });
  assert.deepEqual(selection.same_tree_landing, {
    commit: SAME_TREE_LANDING_COMMIT,
    tree: EXACT_C9_TREE,
    disposition: 'NOT_CANDIDATE_TRUTH_SAME_TREE_COMMIT_IDENTITY_IS_INSUFFICIENT',
  });

  const proofById = new Map(selection.proof_references.map((row) => [row.proof_reference_id, row]));
  assert.equal(proofById.size, EXACT_EVIDENCE_PROOF_REFERENCES.length);
  for (const expected of EXACT_EVIDENCE_PROOF_REFERENCES) {
    const proof = proofById.get(expected.proof_reference_id);
    assert.ok(proof, expected.proof_reference_id);
    assert.equal(proof.source_commit, expected.commit);
    assert.equal(proof.source_path, expected.path);
    assert.equal(proof.source_git_blob, expected.git_blob);
    assert.equal(proof.source_sha256, expected.sha256);
    assert.equal(proof.source_byte_length, expected.byte_length);
    assert.deepEqual(proof.required_symbols, [...expected.required_symbols]);
  }

  const artifactByPath = new Map(selection.human_artifacts.map((row) => [row.path, row]));
  assert.equal(artifactByPath.size, HUMAN_EVIDENCE_ARTIFACT_SPECS.length);
  const canonicalProofReferences = EXACT_EVIDENCE_PROOF_REFERENCES.map((reference) => ({
    proof_reference_id: reference.proof_reference_id,
    source_commit: reference.commit,
    source_path: reference.path,
    source_git_blob: reference.git_blob,
    source_sha256: reference.sha256,
    source_byte_length: reference.byte_length,
    required_symbols: [...reference.required_symbols],
    validation: 'GIT_OBJECT_PATH_BLOB_SHA256_LENGTH_AND_SYMBOLS_VERIFIED',
  }));
  for (const expected of HUMAN_EVIDENCE_ARTIFACT_SPECS) {
    const artifact = artifactByPath.get(expected.path);
    assert.ok(artifact, expected.path);
    assert.equal(artifact.selection_id, expected.selection_id);
    assert.equal(artifact.state, expected.state);
    assert.equal(artifact.actor, expected.actor);
    assert.equal(artifact.candidate_write_authority, false);
    assert.deepEqual(artifact.proof_reference_ids, [...expected.proof_reference_ids]);
    assert.equal(artifact.sha256, expected.sha256);
    assert.equal(artifact.git_blob, expected.git_blob);
    assert.equal(artifact.byte_length, expected.byte_length);
    const bytes = readFileSync(path.join(CAMPAIGN, expected.path));
    const canonicalBytes = Buffer.from(renderCanonicalHumanArtifact({
      spec: expected,
      proofReferences: canonicalProofReferences,
      candidateSha: EXACT_C9_CANDIDATE,
      candidateTree: EXACT_C9_TREE,
      candidateParent: REQUIRED_C2_PARENT,
      candidateCommitTime: artifact.receipt.start_time_utc,
    }), 'utf8');
    assert.deepEqual(bytes, canonicalBytes);
    assert.equal(artifact.byte_length, bytes.length);
    assert.equal(artifact.sha256, sha256(bytes));
    assert.equal(artifact.git_blob, gitBlob(bytes));
    const text = bytes.toString('utf8');
    for (const forbidden of FORBIDDEN_HUMAN_GATE_TOKENS) assert.doesNotMatch(text, new RegExp(forbidden, 'u'));
  }

  assert.equal(manifest.schema, 'product-truth-manifest.v4');
  assert.equal(manifest.exact_generated_output_count, 21);
  assert.deepEqual(manifest.exact_generated_outputs, EXACT_EVIDENCE_OUTPUTS);
  assert.equal(manifest.exact_tooling_file_count, 5);
  assert.deepEqual(manifest.exact_tooling_files, EXACT_EVIDENCE_TOOLING_FILES);
  assert.equal(manifest.exact_descendant_path_count, 26);
  assert.deepEqual(manifest.exact_descendant_paths, EXACT_EVIDENCE_DESCENDANT_FILES);
  assert.equal(manifest.tooling_bundle_sha256, selection.tooling_bundle_sha256);
});
