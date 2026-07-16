import React, { type ReactNode } from 'react';
import { BadgeCheck, BookOpenCheck, Bot, BrainCircuit, Boxes, FileKey2, FlaskConical, Route, ShieldBan, ShieldCheck } from 'lucide-react';
import { GRow, Group } from '../../components/ui';
import { EvidenceCanvas, PostureTag, ProjectionNotice, SectionHeading, SourceLine, toneForPosture } from '../components';
import type { AiOpsGovernanceRow, AiOpsSnapshot } from '../types';

const FAMILY_ICON = {
  CLASSIFICATION: <BrainCircuit size={14} aria-hidden="true" />,
  RUNBOOK: <BookOpenCheck size={14} aria-hidden="true" />,
  POLICY: <FileKey2 size={14} aria-hidden="true" />,
  PROVIDER: <Bot size={14} aria-hidden="true" />,
  CAPABILITY: <BadgeCheck size={14} aria-hidden="true" />,
} satisfies Record<AiOpsGovernanceRow['family'], ReactNode>;

const OPERATING_MODES = [
  ['OFF', 'No model calls; deterministic product behavior continues.'],
  ['OBSERVE', 'Manual safe reads only when the owner opens a case.'],
  ['SHADOW', 'Recorded diagnosis cannot influence runtime effects.'],
  ['ADVISE', 'Typed explanations and proposals; no mutation.'],
  ['SANDBOX_PATCH', 'Isolated patch preparation; no merge or deploy.'],
  ['BOUNDED_AUTOREMEDIATE', 'Only an existing deterministic owner may execute one admitted Class-A repair.'],
] as const;

const REASONING_LEVELS = [
  ['L0_DETERMINISTIC', 'No model'],
  ['L1_CLASSIFY', 'Bounded classification'],
  ['L2_DIAGNOSE', 'Frozen-bundle reasoning'],
  ['L3_RESEARCH', 'Approved cited retrieval'],
  ['L4_REPAIR', 'Isolated engineering worker'],
  ['L5_ADJUDICATE', 'Independent or authenticated human review'],
] as const;

const PROVIDER_ROLE_LABEL = {
  RUNTIME_DIAGNOSTICIAN: 'Runtime Diagnostician',
  ENGINEERING_REPAIR_WORKER: 'Engineering Repair Worker',
  INDEPENDENT_VERIFICATION_WORKER: 'Independent Verification Worker',
  RESEARCH_CONTEXT_ADVISOR: 'Research / Trade Context Advisor',
} as const;

const PROVIDER_ROLE_ICON = {
  RUNTIME_DIAGNOSTICIAN: <BrainCircuit size={14} aria-hidden="true" />,
  ENGINEERING_REPAIR_WORKER: <FlaskConical size={14} aria-hidden="true" />,
  INDEPENDENT_VERIFICATION_WORKER: <ShieldCheck size={14} aria-hidden="true" />,
  RESEARCH_CONTEXT_ADVISOR: <Route size={14} aria-hidden="true" />,
} as const;

function postureForGraduationResult(result: 'PASS' | 'FAIL' | 'MISSING') {
  if (result === 'PASS') return 'SYNTHETIC_ONLY' as const;
  if (result === 'FAIL') return 'BLOCKED' as const;
  return 'MISSING' as const;
}

export function GovernanceView({ snapshot }: { snapshot: AiOpsSnapshot }) {
  return (
    <div className="aiox-view aiox-governance" data-testid="aiops-governance">
      <ProjectionNotice tone="warn">
        Every classification, runbook, policy, provider, and capability row is fixture evidence. A4 does not classify live events, qualify providers, graduate capabilities, evaluate policy, or register effects.
      </ProjectionNotice>

      <section className="aiox-section" aria-labelledby="aiox-governance-title">
        <SectionHeading
          id="aiox-governance-title"
          eyebrow="Manifest Status Projection"
          title="Classification → Runbook → Policy → Provider → Graduation"
          detail="Each link needs its own canonical owner, immutable revision, numerical evidence, and independent readback."
        />
        <EvidenceCanvas labelledBy="aiox-governance-title">
          <div className="aiox-governance-chain">
            {snapshot.governance.map((row, index) => (
              <article key={row.itemId} className={`tone-${toneForPosture(row.posture)}`}>
                <div className="aiox-governance-index num">{String(index + 1).padStart(2, '0')}</div>
                <div className="aiox-governance-icon">{FAMILY_ICON[row.family]}</div>
                <div className="aiox-governance-copy">
                  <span>{row.family}</span>
                  <strong>{row.label}</strong>
                  <code>{row.revision}</code>
                  <p>{row.evidence}</p>
                  <SourceLine source={row.source} />
                </div>
                <div className="aiox-governance-state">
                  <PostureTag posture={row.posture} />
                  <span>{row.qualification}</span>
                </div>
              </article>
            ))}
          </div>
        </EvidenceCanvas>
      </section>

      <div className="aiox-two-column">
        <section className="aiox-section" aria-labelledby="aiox-mode-title">
          <SectionHeading
            id="aiox-mode-title"
            eyebrow="Capability Ladder"
            title="Mode Only Adds Registered, Bounded Capabilities"
            detail="Moving upward never removes hard denials or raises the server envelope."
          />
          <ol className="aiox-ladder">
            {OPERATING_MODES.map(([mode, detail], index) => (
              <li key={mode}>
                <span className="num">{index}</span>
                <div><strong>{mode}</strong><p>{detail}</p></div>
                <PostureTag posture={mode === 'OFF' ? 'SYNTHETIC_ONLY' : 'NOT_WIRED'} />
              </li>
            ))}
          </ol>
        </section>

        <section className="aiox-section" aria-labelledby="aiox-reasoning-title">
          <SectionHeading
            id="aiox-reasoning-title"
            eyebrow="Routing Ladder"
            title="More Reasoning Budget Is Not More Authority"
            detail="Every level remains inside the same immutable maximum-authority envelope."
          />
          <div className="aiox-reasoning-grid">
            {REASONING_LEVELS.map(([level, label], index) => (
              <article key={level}>
                <span className="num">{String(index).padStart(2, '0')}</span>
                <div><strong>{level}</strong><p>{label}</p></div>
                <ShieldBan size={15} aria-label="No authority expansion" />
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="aiox-section" aria-labelledby="aiox-identities-title">
        <SectionHeading
          id="aiox-identities-title"
          eyebrow="Isolation"
          title="Provider Role Qualification Matrix"
          detail="Obvious fake identities demonstrate separate roles. Managed-auth labels are fixture metadata only; no credential, provider call, billing fallback, or account fallback is configured."
        />
        <div className="aiox-group-scope">
          <Group title="Per-Role Provider Route Qualification · Fixture Projections">
            {snapshot.providerQualifications.map((route) => (
              <GRow
                key={route.routeId}
                icon={PROVIDER_ROLE_ICON[route.role]}
                color={`var(--aiox-${toneForPosture(route.posture)})`}
                label={<span className="aiox-row-label"><code>{route.routeId}</code>{PROVIDER_ROLE_LABEL[route.role]}</span>}
                sub={(
                  <span className="aiox-row-sub aiox-provider-evidence">
                    <span>{route.provider} / {route.model} · {route.activationState} · {route.runtimeState}</span>
                    <span>Auth {route.authType ?? 'UNKNOWN'} · Retention {route.retention ?? 'UNKNOWN'} · Store {route.storeBehavior ?? 'UNKNOWN'} · Background {route.backgroundCompatibility === null ? 'UNKNOWN' : route.backgroundCompatibility ? 'SUPPORTED_FIXTURE' : 'UNSUPPORTED'} · Region {route.region ?? 'UNKNOWN'}</span>
                    <span>Schema {route.schemaParity} · Tool Denial {route.toolDenialParity} · Privacy {route.privacyParity} · Eval {route.evaluationRevision ?? 'MISSING'} · Budget {route.budgetId ?? 'MISSING'} · Reserve {route.emergencyReserve ?? 'MISSING'}</span>
                    <span>Credential {route.credentialPosture} · Fallback {route.fallbackRouteId ?? 'NONE'} / {route.fallbackQualified === null ? 'UNKNOWN' : route.fallbackQualified ? 'QUALIFIED' : 'UNQUALIFIED'}</span>
                    <span>{route.blockedReasons.join(' · ') || 'NO BLOCKED REASON'}</span>
                    <SourceLine source={route.source} />
                  </span>
                )}
                control={(
                  <span className="aiox-provider-state">
                    <strong>{route.qualification}</strong>
                    <PostureTag posture={route.posture} />
                  </span>
                )}
              />
            ))}
          </Group>
        </div>
      </section>

      <div className="aiox-two-column">
        <section className="aiox-section" aria-labelledby="aiox-graduation-title">
          <SectionHeading
            id="aiox-graduation-title"
            eyebrow="Per-Capability Graduation"
            title="Numerical Bars Before Exact-Scope Promotion"
            detail="A provider, model, prompt, runbook, or patch category earns no authority outside this exact capability. Drift triggers demotion."
          />
          <EvidenceCanvas labelledBy="aiox-graduation-title">
            <div className="aiox-graduation-contracts">
              {snapshot.capabilityGraduations.map((capability) => (
                <article key={capability.capabilityId}>
                <header>
                  <div>
                    <code>{capability.capabilityId}</code>
                    <strong>{capability.exactScope}</strong>
                    <span>{capability.routeId} · {capability.modelRevision} · {capability.promptRevision} · {capability.patchCategory}</span>
                  </div>
                  <div>
                    <span>{capability.currentMode} → {capability.proposedMode}</span>
                    <strong>{capability.disposition}</strong>
                    <PostureTag posture={capability.posture} />
                  </div>
                </header>
                <div className="aiox-group-scope">
                  <Group title="Owner-Set Numerical Promotion Bars">
                    {capability.metrics.map((metric) => {
                      const posture = postureForGraduationResult(metric.result);
                      return (
                        <GRow
                          key={metric.metricId}
                          icon={<Boxes size={14} aria-hidden="true" />}
                          color={`var(--aiox-${toneForPosture(posture)})`}
                          label={<span className="aiox-row-label"><code>{metric.metricId}</code>{metric.unit}</span>}
                          sub={`Required ${metric.required ?? 'MISSING'} · Observed ${metric.observed ?? 'MISSING'}`}
                          control={<span className="aiox-readback-pair"><strong>{metric.result}</strong><PostureTag posture={posture} /></span>}
                        />
                      );
                    })}
                  </Group>
                </div>
                <footer>
                  <span>Independent Reviewer <strong>{capability.independentReviewer ?? 'MISSING'}</strong></span>
                  <span>Evidence <strong>{capability.evidenceIds.join(', ') || 'MISSING'}</strong></span>
                  <span>Demotion Triggers <strong>{capability.demotionTriggers.join(' · ')}</strong></span>
                  <SourceLine source={capability.source} />
                </footer>
                </article>
              ))}
            </div>
          </EvidenceCanvas>
        </section>

        <section className="aiox-section" aria-labelledby="aiox-assumptions-title">
          <SectionHeading id="aiox-assumptions-title" eyebrow="Port Contract" title="Explicit A4 Assumptions" />
          <ol className="aiox-assumptions">
            {snapshot.assumptions.map((assumption, index) => (
              <li key={assumption}><span className="num">{String(index + 1).padStart(2, '0')}</span><p>{assumption}</p></li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
