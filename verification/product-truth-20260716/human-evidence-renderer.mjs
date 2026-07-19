import {
  FORBIDDEN_HUMAN_GATE_TOKENS,
  REJECTED_SELECTION_HISTORY,
} from './campaign-input-registry.mjs';

const HUMAN_ARTIFACT_COPY = Object.freeze({
  'AUTHORITY_RESOLUTION.md': Object.freeze({
    title: 'Exact C9 Authority Resolution',
    summary: 'Exact C9 identity and sealed machine evidence are bound. A fresh independent verifier has not issued a verdict.',
    unavailable: 'Fresh-verifier review and every later operational authority remain pending.',
  }),
  'CLEAN_CLONE_ACCEPTANCE.md': Object.freeze({
    title: 'Exact C9 Clean-Clone Evidence',
    summary: 'No new clean-clone gate was executed while regenerating this evidence-only package.',
    unavailable: 'Dependency installation and canonical root/full gates were not rerun.',
  }),
  'COMPOSED_RUNTIME_RECEIPT.md': Object.freeze({
    title: 'Exact C9 Composed-Runtime Receipt',
    summary: 'No composed-runtime mode, fault drill, restart recovery drill, or soak was executed.',
    unavailable: 'Runtime, failure-recovery, alert-delivery, and soak measurements are absent.',
  }),
  'FINAL_VERDICT.md': Object.freeze({
    title: 'Exact C9 Verdict State',
    summary: 'The package records exact evidence and rejected history without self-certifying a final verdict.',
    unavailable: 'A fresh independent verifier decision is pending.',
  }),
  'STAGING_OPERATIONAL_RECEIPT.md': Object.freeze({
    title: 'Exact C9 Staging Operational Receipt',
    summary: 'No host deployment, tunnel, paging destination, rollback, or operational drill is configured by this evidence package.',
    unavailable: 'All staging and external operational measurements remain unconfigured.',
  }),
  'UNMERGED_DELTA_REPORT.md': Object.freeze({
    title: 'Exact C9 Delta Review',
    summary: 'The immutable sealed census and provenance are retained as historical C9 machine evidence; the mutable live workstation was not recensused.',
    unavailable: 'Fresh-verifier review is required before any later custody or operational claim.',
  }),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function renderCanonicalHumanArtifact({
  spec,
  proofReferences,
  candidateSha,
  candidateTree,
  candidateParent,
  candidateCommitTime,
}) {
  const copy = HUMAN_ARTIFACT_COPY[spec.path];
  assert(copy, `HUMAN_ARTIFACT_COPY_MISSING:${spec.path}`);
  const referenceById = new Map(proofReferences.map((row) => [row.proof_reference_id, row]));
  assert(referenceById.size === proofReferences.length, 'HUMAN_PROOF_REFERENCE_DUPLICATE');
  const references = spec.proof_reference_ids.map((id) => {
    const reference = referenceById.get(id);
    assert(reference, `HUMAN_PROOF_REFERENCE_MISSING:${spec.path}:${id}`);
    return reference;
  });
  const rejectedHistory = spec.path === 'FINAL_VERDICT.md'
    ? `\n## Rejected candidate history\n\n| Label | Commit | Tree | Disposition | Reason |\n| --- | --- | --- | --- | --- |\n${REJECTED_SELECTION_HISTORY.map((row) => `| ${row.label} | \`${row.sha}\` | \`${row.tree}\` | \`${row.disposition}\` | \`${row.reason}\` |`).join('\n')}\n`
    : '';
  const rendered = `# ${copy.title}\n\nStatus: \`${spec.state}\`\n\nSelection ID: \`${spec.selection_id}\`\n\n- Exact candidate: \`${candidateSha}\`\n- Candidate tree: \`${candidateTree}\`\n- Sole direct parent: \`${candidateParent}\`\n- Actor: \`${spec.actor}\`\n- Candidate source write authority: \`${spec.candidate_write_authority}\`\n\n## Result\n\n${copy.summary}\n\nUnavailable or skipped: ${copy.unavailable}\n\n## Machine proof references\n\n| Proof ID | Commit | Path | Git blob | SHA-256 | Bytes |\n| --- | --- | --- | --- | --- | ---: |\n${references.map((row) => `| \`${row.proof_reference_id}\` | \`${row.source_commit}\` | \`${row.source_path}\` | \`${row.source_git_blob}\` | \`${row.source_sha256}\` | ${row.source_byte_length} |`).join('\n')}\n${rejectedHistory}\n## Receipt fields\n\n- Command or operator action: deterministic output-only rendering from verified Git objects; no candidate mutation and no live-worktree census.\n- Start UTC: \`${candidateCommitTime}\`\n- End UTC: \`${candidateCommitTime}\`\n- Timestamp basis: \`EXACT_CANDIDATE_COMMITTER_TIMESTAMP_DETERMINISTIC\`\n- Artifact generation result: \`${spec.state}\`\n- Candidate source write authority: \`${spec.candidate_write_authority}\`\n`;
  for (const token of FORBIDDEN_HUMAN_GATE_TOKENS) {
    assert(!rendered.includes(token), `FORBIDDEN_HUMAN_GATE_TOKEN:${spec.path}:${token}`);
  }
  return rendered;
}
