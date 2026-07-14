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

export function GovernanceView({ snapshot }: { snapshot: AiOpsSnapshot }) {
  return (
    <div className="aiox-view aiox-governance" data-testid="aiops-governance">
      <ProjectionNotice tone="warn">
        Every classification, runbook, policy, provider, and capability row is fixture evidence. A4 does not classify live events, qualify providers, graduate capabilities, evaluate policy, or register effects.
      </ProjectionNotice>

      <section className="aiox-section" aria-labelledby="aiox-governance-title">
        <SectionHeading
          id="aiox-governance-title"
          eyebrow="Manifest status projection"
          title="Classification → runbook → policy → provider → graduation"
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
            eyebrow="Capability ladder"
            title="Mode only adds registered, bounded capabilities"
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
            eyebrow="Routing ladder"
            title="More reasoning budget is not more authority"
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
          title="Provider role qualification matrix"
          detail="Obvious fake identities demonstrate separate roles; no credential, subscription authentication, provider call, or fallback is configured."
        />
        <div className="aiox-group-scope">
          <Group title="Fixture principals">
            <GRow
              icon={<BrainCircuit size={14} />}
              color="var(--aiox-idle)"
              label="Runtime Diagnostician"
              sub="fixture-runtime-diagnostician.invalid · read-only redacted evidence · no shell/repository/production/money"
              control={<PostureTag posture="NOT_CONFIGURED" />}
            />
            <GRow
              icon={<FlaskConical size={14} />}
              color="var(--aiox-idle)"
              label="Engineering Repair Worker"
              sub="fixture-repair-worker.invalid · isolated admitted worktree only · no Main/merge/push/deploy"
              control={<PostureTag posture="NOT_CONFIGURED" />}
            />
            <GRow
              icon={<ShieldCheck size={14} />}
              color="var(--aiox-idle)"
              label="Independent Verification Worker"
              sub="fixture-verifier.invalid · frozen evidence and candidate only · cannot modify or self-verify"
              control={<PostureTag posture="NOT_CONFIGURED" />}
            />
            <GRow
              icon={<Route size={14} />}
              color="var(--aiox-idle)"
              label="Research / Trade Context Advisor"
              sub="fixture-research-advisor.invalid · cited public context only · never trading hot path or veto authority"
              control={<PostureTag posture="NOT_CONFIGURED" />}
            />
          </Group>
        </div>
      </section>

      <div className="aiox-two-column">
        <section className="aiox-section" aria-labelledby="aiox-graduation-title">
          <SectionHeading id="aiox-graduation-title" eyebrow="Graduation" title="Required evidence before capability promotion" />
          <div className="aiox-graduation-grid">
            {[
              ['Frozen golden corpus', 'MISSING'],
              ['Adversarial / injection corpus', 'MISSING'],
              ['Prior-incident replay', 'MISSING'],
              ['Tool-denial suite', 'SYNTHETIC_ONLY'],
              ['Abstention / calibration', 'MISSING'],
              ['Cost / latency comparison', 'MISSING'],
              ['Chronological shadow period', 'MISSING'],
              ['Independent qualification', 'MISSING'],
            ].map(([label, posture]) => (
              <article key={label}>
                <Boxes size={14} aria-hidden="true" />
                <span>{label}</span>
                <PostureTag posture={posture as 'MISSING' | 'SYNTHETIC_ONLY'} />
              </article>
            ))}
          </div>
        </section>

        <section className="aiox-section" aria-labelledby="aiox-assumptions-title">
          <SectionHeading id="aiox-assumptions-title" eyebrow="Port contract" title="Explicit A4 assumptions" />
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
