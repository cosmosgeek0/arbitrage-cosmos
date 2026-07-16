import type { FiveSecondOwnerView } from '../../../lib/productIntegration';

function value(value: string | null): string {
  return value ?? 'UNKNOWN';
}

export function OwnerViewPanel({ view }: { view: Readonly<FiveSecondOwnerView> }) {
  const facts = [
    ['Process', view.processAlive],
    ['Machine Ready', view.machineReady],
    ['Trade Ready', view.tradeReady],
    ['Desired / Effective', `${view.desiredMode} / ${view.effectiveMode}`],
    ['Exposed Capital', value(view.exposedCapital)],
    ['Recovery', value(view.unresolvedRecovery)],
    ['Data Freshness', value(view.dataFreshness)],
    ['Root Blocker', value(view.topRootBlocker)],
    ['Active Opportunity', value(view.activeOpportunity)],
    ['Active Ticket', value(view.activeTicket)],
    ['Active Position', value(view.activePosition)],
    ['Latest Change', value(view.latestMaterialChange)],
  ] as const;
  return (
    <section className="pcr-section" aria-label="Five Second Owner View">
      <header className="pcr-band"><h2>Five Second Owner View</h2><span>Supervisor Fields Only · No Browser Inference</span></header>
      <div className="pcr-owner-grid">
        {facts.map(([label, fact]) => <div key={label}><span>{label}</span><strong>{fact}</strong></div>)}
      </div>
      <div className="pcr-revisions">
        <span>Tested <code>{value(view.revisions.testedCommit)}</code></span>
        <span>Deployed <code>{value(view.revisions.deployedCommit)}</code></span>
        <span>Model <code>{value(view.revisions.modelRevision)}</code></span>
        <span>Config <code>{value(view.revisions.configRevision)}</code></span>
        <span>Schema <code>{view.revisions.schemaRevision}</code></span>
      </div>
    </section>
  );
}
