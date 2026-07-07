import { useState } from 'react';
import { useStore } from '../store';
import { fmtPrice, fmtDateTime } from '../format';
import { IconBook, IconShield } from '../components/Icons';
import type { CustomRule } from '../types';

// Governance: what this cockpit is allowed to do. Rendered inside the Risk
// page (Risk owns every operational control — the old standalone Rules page
// is gone from the sidebar).
// Top: platform rules — hard-coded / config-driven and ENFORCED today.
// Bottom: owner-authored rules — persisted server-side + ledgered now; the
// risk gate starts consuming `strict` ones when live mode lands (labeled, not fake).
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
    { name: 'Kill switch', detail: cfg.killSwitch ? 'ON — every send is blocked right now.' : 'OFF — sends pass to the risk gate.', state: cfg.killSwitch ? 'halting' : 'armed', tone: cfg.killSwitch ? 'bad' : 'ok' },
    { name: 'Live trading', detail: cfg.liveTradingEnabled ? 'Enabled — typed confirmation still required per order.' : 'Disabled — orders cannot reach Binance.', state: cfg.liveTradingEnabled ? 'on' : 'off', tone: cfg.liveTradingEnabled ? 'warn' : 'ok' },
    { name: 'Per-order cap', detail: `Any single order above ${fmtPrice(cfg.maxOrderNotionalUsd)} is rejected by the risk gate.`, state: fmtPrice(cfg.maxOrderNotionalUsd), tone: '' },
    { name: 'Daily notional cap', detail: `Total sends above ${fmtPrice(cfg.maxDailyNotionalUsd)}/day are rejected.`, state: fmtPrice(cfg.maxDailyNotionalUsd), tone: '' },
    { name: 'Daily loss stop', detail: `Realized loss beyond ${fmtPrice(cfg.maxDailyLossUsd)} halts new orders for the day.`, state: fmtPrice(cfg.maxDailyLossUsd), tone: '' },
    { name: 'Symbol allowlist', detail: cfg.allowedSymbols.length ? `Only ${cfg.allowedSymbols.join(', ')} may trade.` : 'Empty — the risk gate rejects every symbol.', state: `${cfg.allowedSymbols.length} symbols`, tone: cfg.allowedSymbols.length ? '' : 'ok' },
    { name: 'Order cooldown', detail: `Minimum ${cfg.cooldownSec}s between sends.`, state: `${cfg.cooldownSec}s`, tone: '' },
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
        <h2 className="rules-h"><IconShield size={16} /> Platform rules <span className="rule-badge enforced">enforced</span></h2>
        <p className="rules-sub">Hard limits from the risk gate and server config. Edit the numbers in the sections above.</p>
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
        <h2 className="rules-h"><IconBook size={16} /> Your rules <span className="rule-badge recorded">recorded · enforcement lands with live mode</span></h2>
        <p className="rules-sub">
          Author your own allow/block/limit rules. They persist on the server and are ledgered; <b>strict</b> rules are
          the ones the risk gate will consume first when live-mode wiring lands. Nothing here pretends to run yet.
        </p>
        <form className="rule-form" onSubmit={(e) => void submit(e)}>
          <input className="rf-name" value={name} maxLength={80} placeholder="Rule name — e.g. Never trade meme pairs" onChange={(e) => setName(e.target.value)} />
          <div className="rf-row">
            <select value={effect} onChange={(e) => setEffect(e.target.value as CustomRule['effect'])} aria-label="Effect">
              <option value="block">Block</option>
              <option value="allow">Allow</option>
              <option value="limit">Limit</option>
            </select>
            <select value={scope} onChange={(e) => setScope(e.target.value as CustomRule['scope'])} aria-label="Scope">
              <option value="orders">Orders</option>
              <option value="symbols">Symbols</option>
              <option value="strategy">Strategy</option>
              <option value="hours">Trading hours</option>
              <option value="general">General</option>
            </select>
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
