import { FileWarning, GitCompareArrows, Link2 } from 'lucide-react';
import type {
  OpportunitiesReadResult,
  OpportunitySourceSection,
} from './model';

export interface OpportunityDiagnosticRow {
  readonly id: string;
  readonly code: string;
  readonly provenance: 'OWNER-PUBLISHED' | 'UI-DERIVED';
  readonly origin: string;
  readonly detail: string;
}

function humanizeCode(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function sourceReconciliationDetail(section: OpportunitySourceSection): string {
  const value = section.reconciliation;
  return [
    `Input ${value.inputDecisions} decisions / ${value.inputProposals} proposals`,
    `Canonical ${value.canonicalDecisions} decisions / ${value.canonicalProposals} proposals`,
    `Duplicates ${value.duplicateDecisions} decisions / ${value.duplicateProposals} proposals`,
    `Rejected ${value.rejectedDecisions} decisions / ${value.rejectedProposals} proposals`,
  ].join(' · ');
}

/**
 * Enumerates diagnostics published by the canonical read owner and labels the
 * few presentation-level deductions as UI-DERIVED. It never invents a
 * strategy reason, ranks records, or changes owner truth.
 */
export function collectOpportunityDiagnostics(
  result: OpportunitiesReadResult,
): readonly Readonly<OpportunityDiagnosticRow>[] {
  const rows: OpportunityDiagnosticRow[] = result.reasonCodes.map((code, index) => ({
    id: `projection-${index}-${code}`,
    code,
    provenance: 'OWNER-PUBLISHED',
    origin: 'CANONICAL PROJECTION',
    detail: humanizeCode(code),
  }));

  if (result.view !== null) {
    for (const section of [result.view.basis, result.view.volume]) {
      if (section.failure !== null) {
        rows.push({
          id: `${section.source}-failure-${section.failure.code}`,
          code: section.failure.code,
          provenance: 'OWNER-PUBLISHED',
          origin: `${section.source} STRUCTURED FAILURE`,
          detail: `${section.failure.message} · ${section.failure.recommendedOperatorAction}`,
        });
      }

      section.rejects.forEach((reject, index) => {
        const issueDetail = reject.issues.length === 0
          ? 'No nested validation issue was published.'
          : reject.issues
            .map((issue) => `${issue.path}: ${issue.code} — ${issue.message}`)
            .join(' · ');
        rows.push({
          id: `${section.source}-reject-${index}-${reject.sourceKey}-${reject.code}`,
          code: reject.code,
          provenance: 'OWNER-PUBLISHED',
          origin: `${section.source} ${reject.kind} REJECT`,
          detail: `${reject.symbol ?? 'SYMBOL UNKNOWN'} · source key ${reject.sourceKey} · ${issueDetail}`,
        });
      });

      if (!section.reconciliation.balanced) {
        rows.push({
          id: `${section.source}-reconciliation-unbalanced`,
          code: 'UI_DERIVED_SOURCE_RECONCILIATION_UNBALANCED',
          provenance: 'UI-DERIVED',
          origin: `${section.source} RECONCILIATION`,
          detail: `Presentation diagnostic derived from published reconciliation counts. · ${sourceReconciliationDetail(section)}`,
        });
      }
    }

    result.view.ordered.forEach((record) => {
      record.rejectionReasons.forEach((code, index) => {
        rows.push({
          id: `${record.canonicalId}-reason-${index}-${code}`,
          code,
          provenance: 'OWNER-PUBLISHED',
          origin: `${record.source} ${record.kind} · ${record.symbol}`,
          detail: `Canonical ${record.canonicalId} · source lifecycle ${record.sourceLifecycle}`,
        });
      });

      if (
        record.expiresAtMs !== null
        && result.evaluatedAtMs !== null
        && record.expiresAtMs < result.evaluatedAtMs
        && record.lifecycle === 'OPEN'
      ) {
        rows.push({
          id: `${record.canonicalId}-expiry-open-mismatch`,
          code: 'UI_DERIVED_EXPIRY_LIFECYCLE_MISMATCH',
          provenance: 'UI-DERIVED',
          origin: `${record.source} ${record.kind} · ${record.symbol}`,
          detail: 'Presentation guard derived from the published expiry and lifecycle.',
        });
      }
    });

    if (!result.view.reconciliation.balanced) {
      const value = result.view.reconciliation;
      rows.push({
        id: 'canonical-view-reconciliation-unbalanced',
        code: 'UI_DERIVED_VIEW_RECONCILIATION_UNBALANCED',
        provenance: 'UI-DERIVED',
        origin: 'CANONICAL VIEW RECONCILIATION',
        detail: `Presentation diagnostic derived from published view reconciliation. · Input ${value.inputRecords} · canonical ${value.canonicalRecords} · duplicates ${value.duplicateRecords} · rejected ${value.rejectedRecords}`,
      });
    }
  }

  result.losses.forEach((loss, index) => {
    const path = [loss.sourcePath, loss.targetPath].filter((value) => value !== null).join(' → ');
    rows.push({
      id: `dialect-loss-${index}-${loss.code}`,
      code: loss.code,
      provenance: 'OWNER-PUBLISHED',
      origin: 'DIALECT LOSS',
      detail: `${loss.detail}${path ? ` · ${path}` : ''}`,
    });
  });

  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function reconciliationRows(result: OpportunitiesReadResult) {
  if (result.view === null) return [];
  return [result.view.basis, result.view.volume].map((section) => ({
    id: section.source,
    owner: section.source,
    state: `${section.presence} · ${section.freshness?.state ?? 'FRESHNESS UNAVAILABLE'}`,
    input: `${section.reconciliation.inputDecisions}D / ${section.reconciliation.inputProposals}P`,
    canonical: `${section.reconciliation.canonicalDecisions}D / ${section.reconciliation.canonicalProposals}P`,
    excluded: `${section.reconciliation.duplicateDecisions + section.reconciliation.duplicateProposals} duplicate · ${section.reconciliation.rejectedDecisions + section.reconciliation.rejectedProposals} rejected`,
    balance: section.reconciliation.balanced ? 'BALANCED' : 'UNBALANCED',
  }));
}

export function OpportunityDiagnosticsLedger({
  result,
  query,
  unavailableReason,
}: {
  readonly result: OpportunitiesReadResult | null;
  readonly query: string;
  readonly unavailableReason: string | null;
}) {
  if (result === null || unavailableReason !== null) {
    const retainedProjectionWithError = result !== null;
    return (
      <section className="opportunityx-diagnostics" aria-labelledby="opportunityx-diagnostics-title">
        <header className="opportunityx-diagnostics-head">
          <span>
            <FileWarning size={15} aria-hidden="true" />
            <strong id="opportunityx-diagnostics-title">Canonical Reject Taxonomy</strong>
          </span>
          <small>{retainedProjectionWithError ? 'STALE LAST-KNOWN · WITHHELD' : 'UNAVAILABLE'}</small>
        </header>
        <div className="opportunityx-empty compact">
          <strong>{retainedProjectionWithError
            ? 'Retained Canonical Diagnostics Withheld'
            : 'Canonical Diagnostics Unavailable'}</strong>
          <span>{unavailableReason ?? 'CANONICAL_OPPORTUNITY_READ_PENDING'}</span>
        </div>
      </section>
    );
  }

  const normalizedQuery = query.toUpperCase();
  const diagnostics = collectOpportunityDiagnostics(result);
  const visibleDiagnostics = diagnostics.filter((row) => (
    normalizedQuery.length === 0
    || row.code.includes(normalizedQuery)
    || row.provenance.includes(normalizedQuery)
    || row.origin.includes(normalizedQuery)
    || row.detail.toUpperCase().includes(normalizedQuery)
  ));
  const visibleIdentities = result.identities.filter((identity) => (
    normalizedQuery.length === 0
    || identity.owner.includes(normalizedQuery)
    || identity.ownerId.toUpperCase().includes(normalizedQuery)
    || identity.systemId.toUpperCase().includes(normalizedQuery)
    || (identity.canonicalProjectionId ?? '').toUpperCase().includes(normalizedQuery)
    || identity.correlationId.toUpperCase().includes(normalizedQuery)
  ));
  const reconciliations = reconciliationRows(result);

  return (
    <section
      className="opportunityx-diagnostics"
      aria-labelledby="opportunityx-diagnostics-title"
      data-canonical-state={result.state}
    >
      <header className="opportunityx-diagnostics-head">
        <span>
          <FileWarning size={15} aria-hidden="true" />
          <strong id="opportunityx-diagnostics-title">Canonical Reject Taxonomy</strong>
        </span>
        <small>{result.state} · {diagnostics.length} Named Rows · {result.identities.length} Aliases</small>
      </header>

      <div className="opportunityx-diagnostics-canvas">
        <table className="opportunityx-diagnostics-table">
          <caption>Owner-Published Reasons And Failures · Explicitly Labelled UI-Derived Presentation Diagnostics</caption>
          <thead>
            <tr>
              <th scope="col">Diagnostic Code</th>
              <th scope="col">Classification</th>
              <th scope="col">Origin</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {visibleDiagnostics.length === 0 ? (
              <tr>
                <td colSpan={4} className="opportunityx-diagnostics-empty">
                  {normalizedQuery
                    ? 'No Named Diagnostic Matches The Filter'
                    : 'No Named Reject, Failure, Loss, Or Expiry Mismatch In This Admitted Projection'}
                </td>
              </tr>
            ) : visibleDiagnostics.map((row) => (
              <tr key={row.id} data-diagnostic-provenance={row.provenance}>
                <th scope="row"><code>{row.code}</code></th>
                <td><code>{row.provenance}</code></td>
                <td>{row.origin}</td>
                <td>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="opportunityx-diagnostics-grid">
        <section aria-labelledby="opportunityx-reconciliation-title">
          <header>
            <GitCompareArrows size={14} aria-hidden="true" />
            <strong id="opportunityx-reconciliation-title">Source Reconciliation</strong>
          </header>
          {result.view === null ? (
            <p>Canonical view unavailable · reconciliation remains UNKNOWN.</p>
          ) : (
            <div className="opportunityx-diagnostics-canvas">
              <table className="opportunityx-custody-table">
                <thead>
                  <tr>
                    <th scope="col">Owner</th>
                    <th scope="col">State</th>
                    <th scope="col">Input</th>
                    <th scope="col">Canonical</th>
                    <th scope="col">Excluded</th>
                    <th scope="col">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliations.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.owner}</th>
                      <td>{row.state}</td>
                      <td>{row.input}</td>
                      <td>{row.canonical}</td>
                      <td>{row.excluded}</td>
                      <td><code>{row.balance}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="opportunityx-identities-title">
          <header>
            <Link2 size={14} aria-hidden="true" />
            <strong id="opportunityx-identities-title">Canonical Identity Aliases</strong>
          </header>
          {result.view === null ? (
            <p>Canonical view unavailable · identity custody remains UNKNOWN.</p>
          ) : visibleIdentities.length === 0 ? (
            <p>{normalizedQuery
              ? 'No Canonical Identity Alias Matches The Filter.'
              : 'Zero Identity Aliases In This Admitted Projection.'}</p>
          ) : (
            <div className="opportunityx-diagnostics-canvas">
              <table className="opportunityx-custody-table opportunityx-identity-table">
                <thead>
                  <tr>
                    <th scope="col">Owner</th>
                    <th scope="col">Owner ID</th>
                    <th scope="col">Canonical ID</th>
                    <th scope="col">Correlation</th>
                    <th scope="col">Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIdentities.map((identity) => (
                    <tr key={`${identity.owner}:${identity.ownerId}:${identity.systemId}`}>
                      <th scope="row">{identity.owner}</th>
                      <td><code>{identity.ownerId}</code></td>
                      <td><code>{identity.canonicalProjectionId ?? 'NONE'}</code></td>
                      <td><code>{identity.correlationId}</code></td>
                      <td><code>{identity.revisionDigest ?? 'NONE'}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
