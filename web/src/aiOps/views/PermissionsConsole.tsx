import React, { useMemo, useState, type KeyboardEvent } from 'react';
import { Ban, Clock3, Filter, KeyRound, LockKeyhole, Search, ShieldOff, SlidersHorizontal, TimerReset } from 'lucide-react';
import { GRow, Group } from '../../components/ui';
import { ABSOLUTE_HARD_DENIALS, AI_OPS_CONTROL_CATEGORIES, projectNarrowingControlIntent } from '../controlProjection';
import { PostureTag, ProjectionNotice, SectionHeading, SourceLine, displayValue, iconForPosture, toneForPosture } from '../components';
import type { AiOpsControlIntentDraft, AiOpsControlProjection, AiOpsSnapshot, ControlValue } from '../types';

type ControlFilter = 'ALL' | (typeof AI_OPS_CONTROL_CATEGORIES)[number]['code'];

function postureForControl(control: AiOpsControlProjection) {
  return control.currentStatus === 'SYNTHETIC_READBACK' ? ('SYNTHETIC_ONLY' as const) : ('NOT_WIRED' as const);
}

const CONTROL_FILTERS: readonly ControlFilter[] = ['ALL', ...AI_OPS_CONTROL_CATEGORIES.map((item) => item.code)];

function ControlReadback({ control }: { control: AiOpsControlProjection }) {
  return (
    <span className="aiox-control-readback" aria-label={`${control.controlId} requested effective readback`}>
      <span><small>Requested</small><strong>{displayValue(control.requested)}</strong></span>
      <span><small>Effective</small><strong>{displayValue(control.effective)}</strong></span>
      <span><small>Readback</small><strong>{displayValue(control.readback)}</strong></span>
      <PostureTag posture={postureForControl(control)} />
    </span>
  );
}

export function PermissionsConsole({ snapshot }: { snapshot: AiOpsSnapshot }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ControlFilter>('A');
  const [changedOnly, setChangedOnly] = useState(false);
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [selectedControlId, setSelectedControlId] = useState(snapshot.controls[0]?.controlId ?? null);
  const [draftValueIndexes, setDraftValueIndexes] = useState<Readonly<Record<string, number>>>({});
  const [intentDraft, setIntentDraft] = useState<AiOpsControlIntentDraft | null>(null);

  const filteredControls = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return snapshot.controls.filter((control) => {
      if (category !== 'ALL' && control.category !== category) return false;
      if (changedOnly && !control.changedFromSafeDefault) return false;
      if (expiringOnly && !control.expiresAt) return false;
      if (!normalizedQuery) return true;
      return [control.controlId, control.label, control.categoryLabel, control.owner, control.reason]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [category, changedOnly, expiringOnly, query, snapshot.controls]);

  const selectedControl = filteredControls.find((control) => control.controlId === selectedControlId) ?? filteredControls[0];
  const selectedDraftIndex = selectedControl ? draftValueIndexes[selectedControl.controlId] ?? 0 : 0;
  const selectedDraftValue: ControlValue = selectedControl?.envelope.requestableValues[selectedDraftIndex] ?? null;
  const changedCount = snapshot.controls.filter((control) => control.changedFromSafeDefault).length;
  const notWiredCount = snapshot.controls.filter((control) => control.currentStatus === 'NOT_WIRED').length;
  const lockedCount = snapshot.controls.filter((control) => control.type === 'LOCKED_INVARIANT').length;
  const expiringCount = snapshot.controls.filter((control) => control.expiresAt !== null).length;
  const controlCount = snapshot.controls.length;
  const populatedCategoryCounts = AI_OPS_CONTROL_CATEGORIES
    .map((item) => snapshot.controls.filter((control) => control.category === item.code).length)
    .filter((count) => count > 0);
  const uniformCategoryCount = populatedCategoryCounts[0] ?? 0;
  const categoryDistribution = populatedCategoryCounts.length > 0
    && populatedCategoryCounts.every((count) => count === uniformCategoryCount)
    ? `${populatedCategoryCounts.length} Categories × ${uniformCategoryCount}`
    : `${populatedCategoryCounts.length} Populated Categories · Uneven Distribution`;

  const handleCategoryKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % CONTROL_FILTERS.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + CONTROL_FILTERS.length) % CONTROL_FILTERS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = CONTROL_FILTERS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextCategory = CONTROL_FILTERS[nextIndex];
    if (!nextCategory) return;
    setCategory(nextCategory);
    setIntentDraft(null);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
  };

  return (
    <div className="aiox-view aiox-permissions" data-testid="aiops-permissions-console">
      <ProjectionNotice tone="warn">
        These {controlCount} rows are the directive's AI_OPS specification catalog, not a canonical registry or React-owned toggles. No server envelope, allowed value, effect, or readback is mounted; a future accepted adapter must supply all authority fields.
      </ProjectionNotice>

      <section className="aiox-permission-summary" aria-label="Permission specification summary">
        <article><span>Spec Rows</span><strong className="num">{controlCount}</strong><small>{categoryDistribution}</small></article>
        <article><span>Not Wired</span><strong className="num">{notWiredCount}</strong><small>No Effect + Readback</small></article>
        <article><span>Safety Locks</span><strong className="num">{lockedCount}</strong><small>Cannot Be Weakened</small></article>
        <article><span>Known Default Deltas</span><strong className="num">{changedCount}</strong><small>Safe Defaults Unavailable</small></article>
        <article><span>Expiring Grants</span><strong className="num">{expiringCount}</strong><small>No Server Grants</small></article>
        <article><span>Hard Denials</span><strong className="num">{ABSOLUTE_HARD_DENIALS.length}</strong><small>Unreachable</small></article>
      </section>

      <section className="aiox-kill-strip" aria-labelledby="aiox-kill-title">
        <div className="aiox-kill-copy">
          <ShieldOff size={20} aria-hidden="true" />
          <div>
            <span>AI-Plane Emergency Kill</span>
            <h2 id="aiox-kill-title">Effective {snapshot.emergencyKill.effective} · Readback {snapshot.emergencyKill.readback}</h2>
            <p>{snapshot.emergencyKill.reason}</p>
          </div>
        </div>
        <dl>
          <div><dt>Control</dt><dd><code>{snapshot.emergencyKill.controlId}</code></dd></div>
          <div><dt>Command</dt><dd><code>{snapshot.emergencyKill.commandId}</code></dd></div>
          <div><dt>Desired / Requested</dt><dd>{snapshot.emergencyKill.desired} / {snapshot.emergencyKill.requested ?? 'NONE'}</dd></div>
          <div><dt>Request Status</dt><dd>{snapshot.emergencyKill.requestStatus}</dd></div>
          <div><dt>Effective / Readback</dt><dd>{snapshot.emergencyKill.effective} / {snapshot.emergencyKill.readback}</dd></div>
          <div><dt>Readback Agreement</dt><dd>{snapshot.emergencyKill.readbackAgreement === null ? 'UNKNOWN' : snapshot.emergencyKill.readbackAgreement ? 'AGREES' : 'DISAGREES'}</dd></div>
          <div><dt>Effect / Readback Handler</dt><dd>{snapshot.emergencyKill.effectHandler ?? 'MISSING'} / {snapshot.emergencyKill.readbackHandler ?? 'MISSING'}</dd></div>
          <div><dt>Registry / Policy</dt><dd>{snapshot.emergencyKill.registryRevision} / {snapshot.emergencyKill.policyRevision}</dd></div>
          <div><dt>Last Known Good</dt><dd>{snapshot.emergencyKill.lastKnownGoodRevision ?? 'MISSING'}</dd></div>
          <div><dt>Requested By / At</dt><dd>{snapshot.emergencyKill.requestedBy} / {snapshot.emergencyKill.requestedAt}</dd></div>
          <div><dt>Receipt / Observed</dt><dd>{snapshot.emergencyKill.receiptId ?? 'MISSING'} / {snapshot.emergencyKill.independentlyObservedAt ?? 'MISSING'}</dd></div>
          <div><dt>Quiet Period Ends</dt><dd>{snapshot.emergencyKill.quietPeriodEndsAt ?? 'UNKNOWN'}</dd></div>
          <div><dt>Self Re-Enable</dt><dd>FORBIDDEN</dd></div>
          <div><dt>Evidence Retention</dt><dd>CONTINUES</dd></div>
          <div><dt>Financial Kill Alias</dt><dd>{snapshot.emergencyKill.financialKillAlias ? 'INVALID ALIAS' : 'FALSE'}</dd></div>
          <div><dt>Blocking Reason</dt><dd>{snapshot.emergencyKill.blockingReason}</dd></div>
          <div><dt>Owner Source</dt><dd><SourceLine source={snapshot.emergencyKill.source} /></dd></div>
        </dl>
        <button type="button" disabled aria-describedby="aiox-kill-reason">
          <ShieldOff size={15} aria-hidden="true" /> ENGAGE · NOT_WIRED
        </button>
        <small id="aiox-kill-reason">One-action projection only. It never overloads the financial kill switch and sends no command.</small>
      </section>

      <section className="aiox-section" aria-labelledby="aiox-kill-readback-title">
        <SectionHeading
          id="aiox-kill-readback-title"
          eyebrow="Independent Postconditions"
          title="Emergency Kill Effective-State Proof"
          detail="The request remains local fixture state. Recovery cannot clear until every deterministic owner reports authoritative readback and the quiet period completes."
          action={<PostureTag posture="NOT_WIRED" />}
        />
        <div className="aiox-group-scope">
          <Group title="Required Postconditions · No Provider Dependency">
            {snapshot.emergencyKill.postconditions.map((postcondition) => (
              <GRow
                key={postcondition.id}
                icon={iconForPosture(postcondition.posture, 14)}
                color={`var(--aiox-${toneForPosture(postcondition.posture)})`}
                label={postcondition.label}
                sub={<span className="aiox-row-sub"><span>{postcondition.detail}</span><SourceLine source={postcondition.source} /></span>}
                control={<span className="aiox-readback-pair"><strong>{postcondition.value ?? 'UNKNOWN'}</strong><PostureTag posture={postcondition.posture} /></span>}
              />
            ))}
          </Group>
        </div>
      </section>

      <section className="aiox-section" aria-labelledby="aiox-registry-title">
        <SectionHeading
          id="aiox-registry-title"
          eyebrow="Server Envelope"
          title="Permission And Budget Specification"
          detail="Search the directive catalog and inspect fields that the unfinished canonical registry must supply; requested → effective → readback remains unknown."
          action={
            <button className="aiox-bulk-disable" type="button" disabled>
              <Ban size={14} aria-hidden="true" /> Bulk Disable · NOT_WIRED
            </button>
          }
        />
        <div className="aiox-control-toolbar">
          <label className="aiox-control-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Search controls</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, owner, control, reason" />
          </label>
          <label className="aiox-filter-check">
            <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />
            <SlidersHorizontal size={13} aria-hidden="true" /> Changed From Safe Default
          </label>
          <label className="aiox-filter-check">
            <input type="checkbox" checked={expiringOnly} onChange={(event) => setExpiringOnly(event.target.checked)} />
            <Clock3 size={13} aria-hidden="true" /> Expiring Grants
          </label>
        </div>
        <div className="aiox-category-filter" role="radiogroup" aria-label="Control category filter">
          <button type="button" role="radio" aria-checked={category === 'ALL'} tabIndex={category === 'ALL' ? 0 : -1} className={category === 'ALL' ? 'active' : ''} onClick={() => { setCategory('ALL'); setIntentDraft(null); }} onKeyDown={(event) => handleCategoryKey(event, 0)}>
            <Filter size={13} aria-hidden="true" /> All
          </button>
          {AI_OPS_CONTROL_CATEGORIES.map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={category === item.code}
              tabIndex={category === item.code ? 0 : -1}
              className={category === item.code ? 'active' : ''}
              onClick={() => { setCategory(item.code); setIntentDraft(null); }}
              onKeyDown={(event) => handleCategoryKey(event, AI_OPS_CONTROL_CATEGORIES.indexOf(item) + 1)}
              key={item.code}
              title={item.label}
            >
              {item.code}<span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="aiox-control-layout">
          <div className="aiox-control-list aiox-group-scope">
            {filteredControls.length ? (
              AI_OPS_CONTROL_CATEGORIES.filter((item) => category === 'ALL' || item.code === category).map((item) => {
                const rows = filteredControls.filter((control) => control.category === item.code);
                if (!rows.length) return null;
                return (
                  <Group title={`${item.code} — ${item.label}`} key={item.code}>
                    {rows.map((control) => (
                      <GRow
                        key={control.controlId}
                        icon={control.type === 'LOCKED_INVARIANT' ? <LockKeyhole size={14} aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />}
                        color="var(--aiox-idle)"
                        label={
                          <span className="aiox-row-label">
                            <code>{control.controlId}</code>
                            {control.label}
                          </span>
                        }
                        sub={
                          <span className="aiox-row-sub">
                            <span>{control.owner} · {control.currentStatus} · {control.reason}</span>
                            <SourceLine source={control.source} />
                          </span>
                        }
                        control={
                          <span className="aiox-control-row-actions">
                            <ControlReadback control={control} />
                            <button type="button" onClick={() => { setSelectedControlId(control.controlId); setIntentDraft(null); }} aria-pressed={selectedControl?.controlId === control.controlId} aria-label={`Inspect ${control.controlId} — ${control.label}`}>
                              Inspect
                            </button>
                          </span>
                        }
                      />
                    ))}
                  </Group>
                );
              })
            ) : (
              <div className="aiox-empty-filter">No specification rows match the current local view filter. This is not evidence of zero server controls.</div>
            )}
          </div>

          {selectedControl ? (
            <aside className="aiox-control-inspector" aria-label={`${selectedControl.controlId} control inspector`}>
              <header>
                <span>{selectedControl.categoryLabel}</span>
                <code>{selectedControl.controlId}</code>
                <h3>{selectedControl.label}</h3>
                <PostureTag posture={postureForControl(selectedControl)} />
              </header>
              <div className="aiox-inspector-readback">
                <div><span>Requested</span><strong>{displayValue(selectedControl.requested)}</strong></div>
                <div><span>Effective</span><strong>{displayValue(selectedControl.effective)}</strong></div>
                <div><span>Readback</span><strong>{displayValue(selectedControl.readback)}</strong></div>
              </div>
              <dl>
                <div><dt>Owner</dt><dd>{selectedControl.owner}</dd></div>
                <div><dt>Type</dt><dd>{selectedControl.type}</dd></div>
                <div><dt>Scope</dt><dd>{selectedControl.scope}</dd></div>
                <div><dt>Environment</dt><dd>{selectedControl.environment}</dd></div>
                <div><dt>Mode Ceiling</dt><dd>{selectedControl.modeCeiling}</dd></div>
                <div><dt>Safe Default</dt><dd>{displayValue(selectedControl.safeDefault)}</dd></div>
                <div><dt>Default Delta</dt><dd>{selectedControl.changedFromSafeDefault ? 'YES' : 'UNKNOWN / NONE PROVEN'}</dd></div>
                <div><dt>Safety Floor</dt><dd>{selectedControl.envelope.minimumSafetyFloor}</dd></div>
                <div><dt>Allowed Values</dt><dd>{selectedControl.allowedValues.length ? selectedControl.allowedValues.map(displayValue).join(' / ') : 'UNKNOWN — NO SERVER ENVELOPE'}</dd></div>
                <div><dt>Envelope</dt><dd>{selectedControl.envelope.envelopeId}</dd></div>
                <div><dt>Policy Revision</dt><dd>{selectedControl.envelope.policyRevision}</dd></div>
                <div><dt>Authority Order</dt><dd>{selectedControl.envelope.authorityOrder.length ? selectedControl.envelope.authorityOrder.map(displayValue).join(' → ') : 'UNKNOWN'}</dd></div>
                <div><dt>Server Maximum</dt><dd>{displayValue(selectedControl.envelope.maximumAuthorityValue)}</dd></div>
                <div><dt>Maximum Summary</dt><dd>{selectedControl.envelope.serverMaximumSummary}</dd></div>
                <div><dt>Effect Handler</dt><dd>{selectedControl.effectHandler ?? 'NOT_WIRED'}</dd></div>
                <div><dt>Readback Handler</dt><dd>{selectedControl.readbackHandler ?? 'NOT_WIRED'}</dd></div>
                <div><dt>Approval</dt><dd>{selectedControl.approvalRequirement}</dd></div>
                <div><dt>TTL / expiry</dt><dd>{selectedControl.ttl ?? 'NONE'} / {selectedControl.expiresAt ?? 'NONE'}</dd></div>
                <div><dt>Revision</dt><dd>{selectedControl.revision}</dd></div>
                <div><dt>Last Changer</dt><dd>{selectedControl.lastChangedBy}</dd></div>
                <div><dt>Reason</dt><dd>{selectedControl.reason}</dd></div>
                <div><dt>Receipt</dt><dd>{selectedControl.receiptId ?? 'MISSING'}</dd></div>
              </dl>
              <div className="aiox-dependency-explain">
                <div><span>Dependencies</span>{selectedControl.dependencies.length ? selectedControl.dependencies.map((item) => <code key={item}>{item}</code>) : <em>NONE DECLARED</em>}</div>
                <div><span>Conflicts / Denials</span>{selectedControl.conflicts.length ? selectedControl.conflicts.map((item) => <code key={item}>{item}</code>) : <em>NONE DECLARED</em>}</div>
              </div>
              <div className="aiox-intent-draft">
                <span>Local Narrowing-Request Preview</span>
                <span className="aiox-intent-value-label">Envelope-Supplied Value</span>
                {selectedControl.envelope.requestableValues.length ? (
                  <div className="aiox-intent-options" role="radiogroup" aria-label={`${selectedControl.controlId} envelope-supplied value`}>
                    {selectedControl.envelope.requestableValues.map((value, index) => (
                      <label key={`${selectedControl.controlId}-${index}`}>
                        <input
                          type="radio"
                          name={`aiox-intent-value-${selectedControl.controlId}`}
                          checked={selectedDraftIndex === index}
                          disabled={selectedControl.currentStatus === 'NOT_WIRED' || selectedControl.type === 'LOCKED_INVARIANT'}
                          onChange={() => {
                            setDraftValueIndexes((current) => ({ ...current, [selectedControl.controlId]: index }));
                            setIntentDraft(null);
                          }}
                        />
                        <span>{displayValue(value)}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="aiox-intent-empty">NO REQUESTABLE VALUES · SERVER ENVELOPE NOT MOUNTED</p>
                )}
                <button
                  type="button"
                  onClick={() => setIntentDraft(projectNarrowingControlIntent(selectedControl, selectedDraftValue))}
                  disabled={selectedControl.currentStatus === 'NOT_WIRED' || selectedControl.type === 'LOCKED_INVARIANT' || selectedControl.envelope.requestableValues.length === 0}
                >
                  Preview Request Only
                </button>
                {intentDraft && intentDraft.controlId === selectedControl.controlId ? (
                  <div className="aiox-intent-result" role="status">
                    <strong>{intentDraft.disposition}</strong>
                    <p>{intentDraft.reason}</p>
                    <span>Effective unchanged · readback required · authority created: false</span>
                  </div>
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      </section>

      <div className="aiox-two-column">
        <section className="aiox-section" aria-labelledby="aiox-denials-title">
          <SectionHeading
            id="aiox-denials-title"
            eyebrow="Immutable Ceiling"
            title="Hard Denials Remain Unreachable"
            detail="No switch, owner chat sentence, provider response, or confidence score can grant these capabilities."
          />
          <div className="aiox-hard-denials">
            {ABSOLUTE_HARD_DENIALS.map((denial) => (
              <div key={denial}><LockKeyhole size={13} aria-hidden="true" /><code>{denial}</code><span>UNREACHABLE</span></div>
            ))}
          </div>
        </section>

        <section className="aiox-section" aria-labelledby="aiox-audit-title">
          <SectionHeading
            id="aiox-audit-title"
            eyebrow="Audit Projection"
            title="Control Specification Timeline"
            detail="Fixture chronology only; the canonical ledger remains the sole durable history owner."
          />
          <ol className="aiox-audit-timeline">
            <li><TimerReset size={14} /><div><strong>Directive Catalog Loaded</strong><span>{snapshot.generatedAt}</span><p>{controlCount} deterministic specification rows; no canonical registry or handler invoked.</p></div></li>
            <li><LockKeyhole size={14} /><div><strong>Hard-Lock Specifications Retained</strong><span>shadow-spec-r1</span><p>{lockedCount} directive-labeled hard locks expose no requested, effective, or readback value.</p></div></li>
            <li><Clock3 size={14} /><div><strong>Independent Server Readback</strong><span>UNKNOWN</span><p>No accepted canonical AI control readback interface is mounted.</p></div></li>
          </ol>
        </section>
      </div>
    </div>
  );
}
