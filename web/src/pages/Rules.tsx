import { useState } from 'react';
import { useStore } from '../store';
import { fmtPrice, fmtDateTime } from '../format';
import { IconBook, IconShield } from '../components/Icons';
import { PillSelect } from '../components/PillSelect';
import type { CustomRule } from '../types';

// Local governance inputs for validate-only evaluation. These records never
// grant money authority or imply that a private execution adapter exists.
export function GovernanceSection() {
  const { state, saveConfig } = useStore();
  const cfg = state?.config;
  const rules = cfg?.customRules ?? [];

  const [name, setName] = useState('');
  const [scope, setScope] = useState<CustomRule['scope']>('orders');
  const [effect, setEffect] = useState<CustomRule['effect']>('block');
  const [note, setNote] = useState('');
  const [strict, setStrict] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const next: CustomRule[] = [
      ...rules,
      { id: `rule_${Date.now()}`, name: name.trim(), scope, effect, note: note.trim(), strict, createdAt: Date.now() },
    ];
    await saveConfig({ customRules: next } as never);
    setName('');
    setNote('');
    setSaving(false);
  };

  const remove = async (id: string) => {
    await saveConfig({ customRules: rules.filter((r) => r.id !== id) } as never);
  };

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
        <h2 className="rules-h"><IconBook size={16} /> Your rules <span className="rule-badge recorded">recorded · advisory only</span></h2>
        <p className="rules-sub">
          Author local allow/block/limit rules. They persist on the server and are ledgered; <b>strict</b> remains a
          validation preference, not permission to place orders or move money.
        </p>
        <form className="rule-form" onSubmit={(e) => void submit(e)}>
          <input className="rf-name" value={name} maxLength={80} placeholder="Rule name — e.g. Never trade meme pairs" onChange={(e) => setName(e.target.value)} />
          <div className="rf-row">
            <PillSelect
              className="rf-select"
              buttonClassName="rf-select-pill"
              value={effect}
              options={[
                { id: 'block', label: 'Block' },
                { id: 'allow', label: 'Allow' },
                { id: 'limit', label: 'Limit' },
              ]}
              onChange={setEffect}
              ariaLabel="Effect"
              testId="rule-effect"
            />
            <PillSelect
              className="rf-select"
              buttonClassName="rf-select-pill"
              value={scope}
              options={[
                { id: 'orders', label: 'Orders' },
                { id: 'symbols', label: 'Symbols' },
                { id: 'strategy', label: 'Strategy' },
                { id: 'hours', label: 'Trading hours' },
                { id: 'general', label: 'General' },
              ]}
              onChange={setScope}
              ariaLabel="Scope"
              testId="rule-scope"
            />
            <label className="rf-strict">
              <button type="button" className={`toggle ${strict ? 'on' : ''}`} onClick={() => setStrict(!strict)} aria-label="Strict"><span className="knob" /></button>
              Strict
            </label>
            <button className="rf-add" type="submit" disabled={!name.trim() || saving}>{saving ? 'Saving…' : 'Add rule'}</button>
          </div>
          <input className="rf-note" value={note} maxLength={240} placeholder="Optional detail — condition, threshold, reasoning" onChange={(e) => setNote(e.target.value)} />
        </form>
        <div className="rules-list">
          {rules.length === 0 ? (
            <div className="ov-empty">No custom rules yet — add your first above.</div>
          ) : (
            rules.map((r) => (
              <div key={r.id} className="rule-row">
                <span className={`rule-effect ${r.effect}`}>{r.effect}</span>
                <div className="rule-main">
                  <span className="rule-name">{r.name}{r.strict && <span className="rule-strict">strict</span>}</span>
                  <span className="rule-detail">{r.note || `${r.scope} rule`} · added {fmtDateTime(r.createdAt)}</span>
                </div>
                <button className="rule-del" onClick={() => void remove(r.id)} title="Delete rule">Remove</button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
