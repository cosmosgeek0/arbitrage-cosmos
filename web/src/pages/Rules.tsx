import { useStore } from '../store';
import { fmtPrice, fmtDateTime } from '../format';
import { IconBook, IconShield } from '../components/Icons';

// Read-only governance truth for validate-only evaluation. This compatibility
// surface never owns policy mutation or implies private execution authority.
export function GovernanceSection() {
  const { state } = useStore();
  const cfg = state?.config;
  const rules = cfg?.customRules ?? [];

  if (!state || !cfg) return null;

  const platform = [
    { name: 'Withdrawals & transfers-out', detail: 'No code path exists. Not configurable.', state: 'blocked', tone: 'ok' },
    { name: 'Execution authority', detail: 'OWNER_GATED · LIVE_EXECUTION_NOT_IMPLEMENTED.', state: 'owner gated', tone: 'warn' },
    { name: 'Legacy kill switch', detail: cfg.killSwitch ? 'A local stop is recorded.' : 'Inactive; this does not arm any route.', state: cfg.killSwitch ? 'stop recorded' : 'inactive', tone: cfg.killSwitch ? 'bad' : 'warn' },
    { name: 'Per-order cap', detail: `Validate-only intent above ${fmtPrice(cfg.maxOrderNotionalUsd)} fails the local advisory check.`, state: fmtPrice(cfg.maxOrderNotionalUsd), tone: '' },
    { name: 'Daily notional cap', detail: `Local validation compares supplied evidence with ${fmtPrice(cfg.maxDailyNotionalUsd)}/day.`, state: fmtPrice(cfg.maxDailyNotionalUsd), tone: '' },
    { name: 'Daily loss stop', detail: `Advisory threshold ${fmtPrice(cfg.maxDailyLossUsd)}; private PnL remains NOT_CONFIGURED.`, state: fmtPrice(cfg.maxDailyLossUsd), tone: '' },
    { name: 'Symbol allowlist', detail: cfg.allowedSymbols.length ? `Only ${cfg.allowedSymbols.join(', ')} may pass local validation.` : 'Empty — every hypothetical symbol fails validation.', state: `${cfg.allowedSymbols.length} symbols`, tone: cfg.allowedSymbols.length ? '' : 'ok' },
    { name: 'Order cooldown', detail: `Validate-only interval of ${cfg.cooldownSec}s between hypothetical decisions.`, state: `${cfg.cooldownSec}s`, tone: '' },
  ];

  return (
    <div className="rules-page">
      <section className="rules-section">
        <h2 className="rules-h"><IconShield size={16} /> Platform rules <span className="rule-badge enforced">validate only</span></h2>
        <p className="rules-sub">Local advisory policy from server config. These values do not create execution authority.</p>
        <div className="rules-list">
          {platform.map((r) => (
            <div key={r.name} className="rule-row">
              <div className="rule-main">
                <span className="rule-name">{r.name}</span>
                <span className="rule-detail">{r.detail}</span>
              </div>
              <span className={`rule-state ${r.tone}`}>{r.state}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rules-section">
        <h2 className="rules-h"><IconBook size={16} /> Recorded governance rules <span className="rule-badge recorded">OWNER_GATED</span></h2>
        <p className="rules-sub">
          CONTROL_PREVIEW_REQUIRED · This compatibility surface is read-only. Canonical Product controls own any
          allow, block, limit, or strict-policy change and its durable receipt.
        </p>
        <div className="rules-list">
          {rules.length === 0 ? (
            <div className="ov-empty">No recorded custom rules. Creation is OWNER_GATED and requires canonical control preview.</div>
          ) : (
            rules.map((r) => (
              <div key={r.id} className="rule-row">
                <span className={`rule-effect ${r.effect}`}>{r.effect}</span>
                <div className="rule-main">
                  <span className="rule-name">{r.name}{r.strict && <span className="rule-strict">strict</span>}</span>
                  <span className="rule-detail">{r.note || `${r.scope} rule`} · added {fmtDateTime(r.createdAt)}</span>
                </div>
                <span className="rule-state warn">read only</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
