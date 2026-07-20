import React from 'react';
import type {
  ProductManagedInventoryEvidenceRef,
  ProductManagedInventoryProjection,
  ProductServiceReadinessDisposition,
} from '../../../lib/productIntegration';

export function ManagedInventoryPanel({
  inventory,
}: {
  readonly inventory: Readonly<ProductManagedInventoryProjection>;
}) {
  return (
    <section className="pcr-section pcr-managed-inventory" aria-label="Managed Inventory">
      <header className="pcr-band">
        <h2>Managed Inventory</h2>
        <span>
          {inventory.entries.length}/{inventory.expectedIdentityCount} Managed Roles · {inventory.observedCanonicalComponentCount}/{inventory.canonicalComponentCount} Canonical Components
        </span>
      </header>
      <div className="pcr-managed-inventory-summary" aria-label="Managed Inventory Counts">
        <span><strong>{inventory.mappedIdentityCount}</strong>Mapped Roles</span>
        <span><strong>{inventory.evidencePresentCount}</strong>Evidence Present</span>
        <span><strong>{inventory.ownerGatedCount}</strong>Owner Gated</span>
        <span><strong>{inventory.notConfiguredCount}</strong>Not Configured</span>
        <span><strong>{inventory.missingCount}</strong>Missing</span>
      </div>
      <div className="pcr-managed-inventory-scroll" role="region" aria-label="Managed Inventory Evidence Table" tabIndex={0}>
        <table>
          <caption className="pcr-visually-hidden">
            All managed roles with their canonical owner, inventory state, mapped evidence, and reason code.
          </caption>
          <colgroup>
            <col className="pcr-managed-role-column" />
            <col className="pcr-managed-state-column" />
            <col className="pcr-managed-owner-column" />
            <col className="pcr-managed-evidence-column" />
            <col className="pcr-managed-reason-column" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Managed Role</th>
              <th scope="col">Inventory State</th>
              <th scope="col">Canonical Owner</th>
              <th scope="col">Mapped Canonical Evidence</th>
              <th scope="col">Reason Code</th>
            </tr>
          </thead>
          <tbody>
            {inventory.entries.map((entry) => (
              <tr key={entry.identity} data-managed-role={entry.identity}>
                <th scope="row">
                  <strong>{titleCaseIdentity(entry.identity)}</strong>
                  <code>{entry.identity}</code>
                </th>
                <td>
                  <em className={`inventory-${entry.inventoryState.toLowerCase().replaceAll('_', '-')}`}>
                    {entry.inventoryState}
                  </em>
                </td>
                <td><code>{entry.owner}</code></td>
                <td><ManagedEvidence evidence={entry.evidence} /></td>
                <td><code>{entry.reasonCode ?? 'NONE'}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ManagedEvidence({
  evidence,
}: {
  readonly evidence: readonly Readonly<ProductManagedInventoryEvidenceRef>[] | null;
}) {
  if (!evidence?.length) return <span className="pcr-managed-evidence-none">NONE</span>;
  return (
    <ul className="pcr-managed-evidence-list">
      {evidence.map((item) => item.source === 'PRODUCT_RUNTIME_COMPONENT_PROJECTION'
        ? (
          <li key={`${item.source}:${item.componentId}`}>
            <strong>{item.componentId}</strong>
            <small>{readinessLabel(item.serviceReadiness)}</small>
            {item.serviceReadiness.waiver && (
              <small>
                {item.serviceReadiness.waiver.id} · {item.serviceReadiness.waiver.scope} · {item.serviceReadiness.waiver.reason} · {item.serviceReadiness.waiver.owner} · Expires {item.serviceReadiness.waiver.expiresAt}
              </small>
            )}
          </li>
        )
        : (
          <li key={`${item.source}:${item.ownerId}`}>
            <strong>{item.ownerId}</strong>
            <small>{item.truthLabel} · PRODUCT OWNER PROJECTION</small>
          </li>
        ))}
    </ul>
  );
}

function readinessLabel(readiness: Readonly<ProductServiceReadinessDisposition>): string {
  const disposition = readiness.excludedFromServiceReadiness
    ? `EXCLUDED · ${readiness.waiver?.status ?? 'WAIVER MISSING'}`
    : readiness.requiredForServiceReadiness
      ? 'REQUIRED'
      : readiness.expected
        ? 'EXPECTED · NOT REQUIRED'
        : 'NOT EXPECTED';
  return `${readiness.basis} · ${disposition} · ${readiness.observed ? 'OBSERVED' : 'NOT OBSERVED'}`;
}

function titleCaseIdentity(identity: string): string {
  return identity
    .split('-')
    .map((word) => {
      if (word === 'api') return 'API';
      if (word === 'q') return 'Q';
      if (word === 'usdm') return 'USD-M';
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(' ');
}
