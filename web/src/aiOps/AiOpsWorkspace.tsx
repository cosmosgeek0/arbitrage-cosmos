import React, { useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Bot, Gauge, KeyRound, Network, ShieldAlert } from 'lucide-react';
import { GovernanceView } from './views/GovernanceView';
import { IncidentWorkspace } from './views/IncidentWorkspace';
import { OverviewView } from './views/OverviewView';
import { OwnerChat } from './views/OwnerChat';
import { PermissionsConsole } from './views/PermissionsConsole';
import type { AiOpsSnapshot } from './types';
import './aiOps.css';

export const AI_OPS_LOCAL_VIEWS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'incidents', label: 'Incident Workspace', icon: AlertTriangle },
  { id: 'chat', label: 'Owner Chat', icon: Bot },
  { id: 'permissions', label: 'Permissions', icon: KeyRound },
  { id: 'governance', label: 'Governance', icon: Network },
] as const;

export type AiOpsLocalView = (typeof AI_OPS_LOCAL_VIEWS)[number]['id'];

export interface AiOpsWorkspaceProps {
  readonly snapshot: AiOpsSnapshot;
  readonly initialView?: AiOpsLocalView;
}

function viewFor(view: AiOpsLocalView, snapshot: AiOpsSnapshot) {
  if (view === 'incidents') return <IncidentWorkspace snapshot={snapshot} />;
  if (view === 'chat') return <OwnerChat snapshot={snapshot} />;
  if (view === 'permissions') return <PermissionsConsole snapshot={snapshot} />;
  if (view === 'governance') return <GovernanceView snapshot={snapshot} />;
  return <OverviewView snapshot={snapshot} />;
}

export function AiOpsWorkspace({ snapshot, initialView = 'overview' }: AiOpsWorkspaceProps) {
  const [view, setView] = useState<AiOpsLocalView>(initialView);
  const currentViewIndex = AI_OPS_LOCAL_VIEWS.findIndex((item) => item.id === view);

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % AI_OPS_LOCAL_VIEWS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + AI_OPS_LOCAL_VIEWS.length) % AI_OPS_LOCAL_VIEWS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = AI_OPS_LOCAL_VIEWS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextView = AI_OPS_LOCAL_VIEWS[nextIndex];
    if (!nextView) return;
    setView(nextView.id);
    const tab = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex];
    tab?.focus();
  };

  return (
    <main className="aiox-page" data-aiops-posture={snapshot.posture} data-fixture-id={snapshot.fixtureId}>
      <div className="aiox-frame">
        <header className="aiox-toolbar">
          <div className="aiox-title">
            <span className="aiox-title-mark"><ShieldAlert size={19} aria-hidden="true" /></span>
            <div>
              <div className="aiox-title-line">
                <h1>AI Ops</h1>
                <span className="aiox-shadow-label">SHADOW_SPECULATIVE</span>
              </div>
              <p>Fixture-driven cockpit, incident, chat, permissions, and qualification projection</p>
            </div>
          </div>
          <div className="aiox-toolbar-truth">
            <span><i />SYNTHETIC_ONLY</span>
            <span>{snapshot.generatedAt}</span>
            <span><code>SHADOW {snapshot.baseSha.slice(0, 12)} · EXTENSION {snapshot.extensionBaseSha.slice(0, 12)}</code></span>
          </div>
        </header>

        <div className="aiox-boundary-tape" role="region" aria-label="AI Ops fixture boundary facts">
          <span><strong>Canonical Owner</strong>{snapshot.canonicalOwnerState}</span>
          <span><strong>Mount</strong>{snapshot.mountState}</span>
          <span><strong>Environment</strong>{snapshot.environment}</span>
          <span><strong>Money Authority</strong>NONE</span>
          <span><strong>Network</strong>NONE</span>
          <span><strong>Provider Auth</strong>NOT_CONFIGURED</span>
        </div>

        <nav className="aiox-local-tabs" role="tablist" aria-label="AI Ops local projection sections">
          {AI_OPS_LOCAL_VIEWS.map((item, index) => {
            const Icon = item.icon;
            const selected = item.id === view;
            return (
              <button
                type="button"
                role="tab"
                id={`aiox-workspace-tab-${item.id}`}
                aria-selected={selected}
                aria-controls="aiox-workspace-panel"
                tabIndex={selected ? 0 : -1}
                className={selected ? 'active' : ''}
                key={item.id}
                onClick={() => setView(item.id)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === 'incidents' ? <b className="num">{snapshot.incidents.length}</b> : null}
                {item.id === 'permissions' ? <b className="num">{snapshot.controls.length}</b> : null}
              </button>
            );
          })}
        </nav>

        <section
          id="aiox-workspace-panel"
          className="aiox-workspace-panel"
          role="tabpanel"
          aria-labelledby={`aiox-workspace-tab-${AI_OPS_LOCAL_VIEWS[currentViewIndex]?.id ?? 'overview'}`}
        >
          {viewFor(view, snapshot)}
        </section>
      </div>
    </main>
  );
}
