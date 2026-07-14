import React, { useRef, useState } from 'react';
import { Bot, CircleUserRound, CornerDownLeft, Fingerprint, LockKeyhole, MessageSquareText, Route, ShieldAlert } from 'lucide-react';
import { PostureTag, ProjectionNotice, SectionHeading } from '../components';
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
            eyebrow="Owner surface"
            title="Case-bound conversation"
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
            <SectionHeading id="aiox-prompts-title" eyebrow="Bounded prompts" title="Prepare a local draft" />
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
              eyebrow="Context boundary"
              title="Session lineage"
              detail="Chat context is not memory, authority, or durable evidence."
            />
            <dl className="aiox-lineage">
              <div><dt><Fingerprint size={13} />Context hash</dt><dd><code>{snapshot.lineage.contextHash}</code></dd></div>
              <div><dt><Route size={13} />Case</dt><dd><code>{snapshot.lineage.caseId}</code></dd></div>
              <div><dt>Incident</dt><dd><code>{snapshot.lineage.incidentId}</code></dd></div>
              <div><dt>Workflow / run</dt><dd><code>{snapshot.lineage.workflowId}</code><code>{snapshot.lineage.runId}</code></dd></div>
              <div><dt>Session</dt><dd><code>{snapshot.lineage.sessionId}</code></dd></div>
              <div><dt>Provider trace</dt><dd>{snapshot.lineage.providerTraceId ?? 'UNKNOWN'}</dd></div>
              <div><dt>Evidence hash</dt><dd><code>{snapshot.lineage.evidenceHash}</code></dd></div>
              <div><dt>Policy / prompt / tools</dt><dd>{snapshot.lineage.policyRevision} / {snapshot.lineage.promptRevision} / {snapshot.lineage.toolRevision}</dd></div>
            </dl>
            <ProjectionNotice>Fresh cases must resume from signed context plus canonical ledger/workflow state—not from a long conversation.</ProjectionNotice>
          </section>
        </aside>
      </div>
    </div>
  );
}
