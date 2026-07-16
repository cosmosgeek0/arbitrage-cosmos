import React, { useRef, useState } from 'react';
import { Bot, CircleUserRound, CornerDownLeft, Fingerprint, LockKeyhole, MessageSquareText, Route, ShieldAlert } from 'lucide-react';
import { GRow, Group } from '../../components/ui';
import { EvidenceCanvas, PostureTag, ProjectionNotice, SectionHeading, SourceLine, iconForPosture, toneForPosture } from '../components';
import type { AiOpsSnapshot } from '../types';

const SUGGESTED_QUESTIONS = [
  'What is broken right now?',
  'Why is this yellow or red?',
  'Show all missing or silent components.',
  'What changed before this incident?',
  'What has the system already tried?',
  'Prepare a diagnostic replay.',
  'Prepare a patch, but do not merge or deploy.',
  'What requires my approval?',
] as const;

export function OwnerChat({ snapshot }: { snapshot: AiOpsSnapshot }) {
  const [draft, setDraft] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const contextPosture = snapshot.contextManifest.generationStatus === 'FIXTURE_COMPLETE' ? 'SYNTHETIC_ONLY' : 'BLOCKED';

  const prepareDraft = (question: string) => {
    setDraft(question);
    setDraftNotice(`Local draft prepared: ${question}`);
    draftRef.current?.focus();
  };

  return (
    <div className="aiox-view aiox-chat" data-testid="aiops-owner-chat">
      <ProjectionNotice tone="warn">
        SYNTHETIC_ONLY transcript. No provider API, personal ChatGPT tab, session store, case router, subscription authentication, or privileged natural-language backdoor is connected.
      </ProjectionNotice>

      <div className="aiox-chat-layout">
        <section className="aiox-section aiox-chat-main" aria-labelledby="aiox-chat-title">
          <SectionHeading
            id="aiox-chat-title"
            eyebrow="Owner Surface"
            title="Case-Bound Conversation"
            detail="Responses cite canonical evidence identities and timestamps; missing or stale evidence stays explicit."
            action={<PostureTag posture="NOT_WIRED" />}
          />
          <div className="aiox-chat-tape" role="log" aria-live="polite" aria-label="Synthetic owner chat transcript">
            {snapshot.chat.map((message) => (
              <article key={message.messageId} className={`aiox-message ${message.role.toLowerCase().replace('_fixture', '')}`}>
                <div className="aiox-message-avatar">
                  {message.role === 'AI_FIXTURE' ? <Bot size={16} aria-hidden="true" /> : message.role === 'OWNER_FIXTURE' ? <CircleUserRound size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
                </div>
                <div className="aiox-message-body">
                  <header>
                    <strong>{message.role === 'AI_FIXTURE' ? 'AI fixture' : message.role === 'OWNER_FIXTURE' ? 'Owner fixture' : 'Boundary notice'}</strong>
                    <span>{message.at}</span>
                    <PostureTag posture={message.posture} />
                  </header>
                  <p>{message.body}</p>
                  {message.evidenceIds.length ? (
                    <div className="aiox-citations" aria-label="Evidence citations">
                      {message.evidenceIds.map((evidenceId) => <code key={evidenceId}>{evidenceId}</code>)}
                    </div>
                  ) : null}
                  {message.capabilityRequest ? (
                    <div className="aiox-capability-request">
                      <div>
                        <LockKeyhole size={14} aria-hidden="true" />
                        <strong>{message.capabilityRequest.capabilityId}</strong>
                        <span>{message.capabilityRequest.policyResult}</span>
                      </div>
                      <p>{message.capabilityRequest.expectedEffect}</p>
                      <dl>
                        <div><dt>Cost</dt><dd>{message.capabilityRequest.cost}</dd></div>
                        <div><dt>State</dt><dd>{message.capabilityRequest.currentState}</dd></div>
                        <div><dt>Authority</dt><dd>NOT CREATED</dd></div>
                      </dl>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <form className="aiox-chat-composer" onSubmit={(event) => event.preventDefault()}>
            <MessageSquareText size={17} aria-hidden="true" />
            <label htmlFor="aiox-chat-draft" className="sr-only">Owner question draft</label>
            <textarea
              id="aiox-chat-draft"
              ref={draftRef}
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Draft an owner question — local only"
            />
            <button type="submit" disabled aria-describedby="aiox-chat-blocker">
              <CornerDownLeft size={15} aria-hidden="true" />
              NOT_WIRED
            </button>
          </form>
          <p id="aiox-chat-blocker" className="aiox-composer-help">
            Drafting is local presentation state. Sending requires the unfinished authenticated case router and provider owner.
          </p>
          <span className="sr-only" role="status">{draftNotice}</span>
        </section>

        <aside className="aiox-chat-aside">
          <section className="aiox-section" aria-labelledby="aiox-prompts-title">
            <SectionHeading id="aiox-prompts-title" eyebrow="Bounded Prompts" title="Prepare A Local Draft" />
            <div className="aiox-prompt-list">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button type="button" key={question} onClick={() => prepareDraft(question)}>
                  <span>{question}</span>
                  <CornerDownLeft size={13} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>

          <section className="aiox-section" aria-labelledby="aiox-lineage-title">
            <SectionHeading
              id="aiox-lineage-title"
              eyebrow="Context Boundary"
              title="Session Lineage"
              detail="Chat context is not memory, authority, or durable evidence."
            />
            <dl className="aiox-lineage">
              <div><dt><Fingerprint size={13} />Context hash</dt><dd><code>{snapshot.lineage.contextHash}</code></dd></div>
              <div><dt><Route size={13} />Case</dt><dd><code>{snapshot.lineage.caseId}</code></dd></div>
              <div><dt>Incident</dt><dd><code>{snapshot.lineage.incidentId}</code></dd></div>
              <div><dt>Workflow / Run</dt><dd><code>{snapshot.lineage.workflowId}</code><code>{snapshot.lineage.runId}</code></dd></div>
              <div><dt>Session</dt><dd><code>{snapshot.lineage.sessionId}</code></dd></div>
              <div><dt>Parent Run / Session</dt><dd>{snapshot.lineage.parentRunId ?? 'NONE'} / {snapshot.lineage.parentSessionId ?? 'NONE'}</dd></div>
              <div><dt>Replacement</dt><dd>{snapshot.lineage.replacementReason}</dd></div>
              <div><dt>Role / Phase</dt><dd>{snapshot.lineage.role} / {snapshot.lineage.phase}</dd></div>
              <div><dt>Generation</dt><dd className="num">{snapshot.lineage.generation}</dd></div>
              <div><dt>Started / Deadline</dt><dd>{snapshot.lineage.startedAt}<span>{snapshot.lineage.deadline}</span></dd></div>
              <div><dt>Provider Trace</dt><dd>{snapshot.lineage.providerTraceId ?? 'UNKNOWN'}</dd></div>
              <div><dt>Context Manifest</dt><dd><code>{snapshot.lineage.contextManifestId}</code></dd></div>
              <div><dt>Checkpoints</dt><dd>{snapshot.lineage.checkpointIds.join(', ') || 'NONE'}</dd></div>
              <div><dt>Retrieval / Children</dt><dd>{snapshot.lineage.retrievalIds.join(', ') || 'NONE'} / {snapshot.lineage.childLineageIds.join(', ') || 'NONE'}</dd></div>
              <div><dt>Hidden Memory</dt><dd>{snapshot.lineage.hiddenCrossSessionMemoryAllowed ? 'ALLOWED' : 'FORBIDDEN'}</dd></div>
              <div><dt>Session Caps</dt><dd>{snapshot.lineage.promptByteLimit} prompt bytes · {snapshot.lineage.retrievedFileLimit} files · {snapshot.lineage.childAgentLimit} children · {snapshot.lineage.toolDepthLimit} tool depth · {snapshot.lineage.iterationLimit} iterations · {snapshot.lineage.outputByteLimit} output bytes</dd></div>
              <div><dt>Evidence Hash</dt><dd><code>{snapshot.lineage.evidenceHash}</code></dd></div>
              <div><dt>Policy / Prompt / Tools</dt><dd>{snapshot.lineage.policyRevision} / {snapshot.lineage.promptRevision} / {snapshot.lineage.toolRevision}</dd></div>
              <div><dt>Stop Condition</dt><dd>{snapshot.lineage.stopCondition}</dd></div>
            </dl>
            <ProjectionNotice>Fresh cases must resume from signed context plus canonical ledger/workflow state—not from a long conversation.</ProjectionNotice>
          </section>
        </aside>
      </div>

      <section className="aiox-section" aria-labelledby="aiox-context-manifest-title">
        <SectionHeading
          id="aiox-context-manifest-title"
          eyebrow="Generated Context Contract"
          title="Static And Dynamic Context Manifest"
          detail="Equal inputs must produce the same bounded pointers. Any unresolved authority or hash fails closed before a provider session starts."
          action={<PostureTag posture={contextPosture} />}
        />
        <EvidenceCanvas labelledBy="aiox-context-manifest-title">
          <dl className="aiox-context-manifest">
            <div><dt>Manifest / Generation</dt><dd><code>{snapshot.contextManifest.manifestId}</code><span className="num">{snapshot.contextManifest.generation}</span></dd></div>
            <div><dt>Signature / Status</dt><dd>{snapshot.contextManifest.signatureStatus}<span>{snapshot.contextManifest.generationStatus}</span></dd></div>
            <div><dt>Static Context Hash</dt><dd><code>{snapshot.contextManifest.staticContextHash}</code></dd></div>
            <div><dt>Dynamic Context Hash</dt><dd><code>{snapshot.contextManifest.dynamicContextHash}</code></dd></div>
            <div><dt>Base / Accepted / Deployed</dt><dd><code>{snapshot.contextManifest.baseSha}</code><code>{snapshot.contextManifest.acceptedSha ?? 'UNKNOWN'}</code><code>{snapshot.contextManifest.deployedSha ?? 'UNKNOWN'}</code></dd></div>
            <div><dt>Inventory / Dependency</dt><dd>{snapshot.contextManifest.inventoryRevision} / {snapshot.contextManifest.dependencyRevision}</dd></div>
            <div><dt>Classification / Runbook</dt><dd>{snapshot.contextManifest.classificationRevision} / {snapshot.contextManifest.runbookRevision}</dd></div>
            <div><dt>Policy / Tool / Control</dt><dd>{snapshot.contextManifest.policyRevision} / {snapshot.contextManifest.toolRevision} / {snapshot.contextManifest.controlRegistryRevision}</dd></div>
            <div><dt>Prompt / Evaluation / Provider Qualification</dt><dd>{snapshot.contextManifest.promptRevision} / {snapshot.contextManifest.evaluationRevision} / {snapshot.contextManifest.providerQualificationRevision}</dd></div>
            <div><dt>Evidence / Age Ceiling</dt><dd><code>{snapshot.contextManifest.evidenceBundleHash}</code><span>{snapshot.contextManifest.evidenceAgeLimitMs} ms</span></dd></div>
            <div><dt>Safety / Ambiguity</dt><dd>{snapshot.contextManifest.safetyPosture}<span>{snapshot.contextManifest.outstandingAmbiguity ?? 'NONE'}</span></dd></div>
            <div><dt>Lease / Fence</dt><dd>{snapshot.contextManifest.leaseId ?? 'NONE'} / {snapshot.contextManifest.fencingEpoch ?? 'NONE'}</dd></div>
            <div><dt>Provider / Model</dt><dd>{snapshot.contextManifest.provider} / {snapshot.contextManifest.model}</dd></div>
            <div><dt>Budgets / Deadline</dt><dd>{snapshot.contextManifest.budgets.join(' · ')}<span>{snapshot.contextManifest.deadline}</span></dd></div>
            <div><dt>Tools / Write Scope</dt><dd>{snapshot.contextManifest.allowedTools.join(', ') || 'NONE'} / {snapshot.contextManifest.writeScope.join(', ') || 'NONE'}</dd></div>
            <div><dt>Prior Attempts / Effects</dt><dd>{snapshot.contextManifest.priorAttemptIds.join(', ') || 'NONE'} / {snapshot.contextManifest.effectReceiptIds.join(', ') || 'NONE'}</dd></div>
          </dl>
          <div className="aiox-group-scope aiox-context-pointers">
            <Group title="Controlling Authority Pointers · Generated, Never Assumed">
              {snapshot.contextManifest.authorityPointers.map((pointer) => {
                const pointerPosture = pointer.status === 'RESOLVED' ? 'SYNTHETIC_ONLY' : 'MISSING';
                return (
                  <GRow
                    key={pointer.path}
                    icon={iconForPosture(pointerPosture, 14)}
                    color={`var(--aiox-${toneForPosture(pointerPosture)})`}
                    label={<span className="aiox-row-label"><code>{pointer.path}</code>{pointer.status}</span>}
                    sub={pointer.blobHash ?? 'BLOB HASH UNRESOLVED'}
                    control={<PostureTag posture={pointerPosture} />}
                  />
                );
              })}
            </Group>
          </div>
          <div className="aiox-context-contract">
            <div><span>Validated Evidence</span><p>{snapshot.contextManifest.validatedEvidenceIds.join(' · ') || 'NONE'}</p></div>
            <div><span>Hard Denials</span><p>{snapshot.contextManifest.hardDenials.join(' · ')}</p></div>
            <div><span>Unresolved Questions</span><p>{snapshot.contextManifest.unresolvedQuestions.join(' · ') || 'NONE'}</p></div>
            <div><span>Exact Task</span><p>{snapshot.contextManifest.exactTask}</p></div>
            <div><span>Acceptance Tests</span><p>{snapshot.contextManifest.acceptanceTests.join(' · ')}</p></div>
            <div><span>Stop / Next Owner</span><p>{snapshot.contextManifest.stopCondition} · {snapshot.contextManifest.nextOwner}</p></div>
          </div>
          <SourceLine source={snapshot.contextManifest.source} />
        </EvidenceCanvas>
      </section>
    </div>
  );
}
