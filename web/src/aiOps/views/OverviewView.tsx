import React, { useMemo, useRef, useState } from 'react';
import { Activity, Boxes, Cable, Gauge, RefreshCcw, ScanSearch } from 'lucide-react';
import { GRow, Group } from '../../components/ui';
import { EvidenceCanvas, FactGrid, PostureTag, ProjectionNotice, SectionHeading, SourceLine, TrendCard, iconForPosture, toneForPosture } from '../components';
import type { AiOpsSnapshot } from '../types';

export function OverviewView({ snapshot }: { snapshot: AiOpsSnapshot }) {
  const [selectedLevelId, setSelectedLevelId] = useState(snapshot.cockpit[0]?.levelId ?? 'L1_IMMEDIATE_SAFETY_VIEW');
  const levelTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedLevel = useMemo(
    () => snapshot.cockpit.find((level) => level.levelId === selectedLevelId) ?? snapshot.cockpit[0],
    [selectedLevelId, snapshot.cockpit],
  );

  const moveLevelFocus = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const lastIndex = snapshot.cockpit.length - 1;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    if (event.key === 'ArrowLeft') nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex === null || nextIndex < 0) return;

    event.preventDefault();
    const nextLevel = snapshot.cockpit[nextIndex];
    if (!nextLevel) return;
    setSelectedLevelId(nextLevel.levelId);
    levelTabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="aiox-view aiox-overview" data-testid="aiops-overview">
      <ProjectionNotice tone="warn">
        Fixture-driven SHADOW_SPECULATIVE projection. Canonical Product Assurance, incident, provider, permission, probe, and chat owners are unfinished; no operational authority is mounted.
      </ProjectionNotice>

      <section className="aiox-section" aria-labelledby="aiox-safety-title">
        <SectionHeading
          id="aiox-safety-title"
          eyebrow="Five-second view"
          title="Immediate safety posture"
          detail="Product, money, AI, telemetry, sentinel, and lease truth remain separate. Unknown never becomes a green zero."
        />
        <EvidenceCanvas labelledBy="aiox-safety-title">
          <div className="aiox-summary-tape">
            {snapshot.safetySummary.map((item) => (
              <article className={`aiox-summary-cell tone-${toneForPosture(item.posture)}`} key={item.id}>
                <div>
                  {iconForPosture(item.posture, 15)}
                  <span>{item.label}</span>
                </div>
                <strong className="num">{item.value === null ? 'UNKNOWN' : item.value}</strong>
                <p>{item.detail}</p>
                <PostureTag posture={item.posture} />
              </article>
            ))}
          </div>
        </EvidenceCanvas>
      </section>

      <section className="aiox-section" aria-labelledby="aiox-operations-title">
        <SectionHeading
          id="aiox-operations-title"
          eyebrow="Operational ledger"
          title="Runtime, budgets, work, recovery"
          detail="Provider/model versions, budgets, queues, cases, worktrees, effects, rollback, learning, AI-off survival, and independent readback remain separate owner facts."
        />
        <EvidenceCanvas labelledBy="aiox-operations-title">
          <div className="aiox-overview-bands">
            {snapshot.overviewBands.map((band) => (
              <article key={band.bandId}>
                <header><strong>{band.label}</strong><p>{band.detail}</p></header>
                <div>
                  {band.facts.map((item) => (
                    <div className={`aiox-ledger-fact tone-${toneForPosture(item.posture)}`} key={item.id}>
                      <span>{item.label}</span>
                      <strong className="num">{item.value === null ? 'UNKNOWN' : item.value}{item.unit ? <small>{item.unit}</small> : null}</strong>
                      <PostureTag posture={item.posture} />
                      <p>{item.detail}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </EvidenceCanvas>
      </section>

      <section className="aiox-section" aria-labelledby="aiox-cockpit-title">
        <SectionHeading
          id="aiox-cockpit-title"
          eyebrow="Cockpit"
          title="Five bounded levels"
          detail="These levels project supplied fixture owner fields; they do not create five new stores or routes."
        />
        <EvidenceCanvas labelledBy="aiox-cockpit-title">
          <div className="aiox-level-tabs" role="tablist" aria-label="AI Ops cockpit levels">
            {snapshot.cockpit.map((level, index) => {
              const active = level.levelId === selectedLevel?.levelId;
              return (
                <button
                  key={level.levelId}
                  ref={(node) => { levelTabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={`aiox-level-tab-${index + 1}`}
                  aria-selected={active}
                  aria-controls="aiox-level-panel"
                  tabIndex={active ? 0 : -1}
                  className={active ? 'active' : ''}
                  onClick={() => setSelectedLevelId(level.levelId)}
                  onKeyDown={(event) => moveLevelFocus(event, index)}
                >
                  <span>L{index + 1}</span>
                  <strong>{level.label}</strong>
                  <PostureTag posture={level.posture} />
                </button>
              );
            })}
          </div>
          {selectedLevel ? (
            <div
              id="aiox-level-panel"
              className="aiox-level-panel"
              role="tabpanel"
              aria-labelledby={`aiox-level-tab-${snapshot.cockpit.indexOf(selectedLevel) + 1}`}
              tabIndex={0}
            >
              <div className="aiox-level-copy">
                <span>{selectedLevel.levelId}</span>
                <p>{selectedLevel.purpose}</p>
              </div>
              <FactGrid facts={selectedLevel.facts} compact />
            </div>
          ) : null}
        </EvidenceCanvas>
      </section>

      <section className="aiox-section" aria-labelledby="aiox-inventory-title">
        <SectionHeading
          id="aiox-inventory-title"
          eyebrow="Inventory"
          title="Expected → discovered → instrumented → reporting"
          detail="The denominator stays visible when an owner is missing, silent, stale, or unknown."
          action={<span className="aiox-count num">{snapshot.components.length} expected</span>}
        />
        <div className="aiox-group-scope">
          <Group title="Expected owner catalog · fixture projection">
            {snapshot.components.map((component) => (
              <GRow
                key={component.componentId}
                icon={iconForPosture(component.posture, 14)}
                color={`var(--aiox-${toneForPosture(component.posture)})`}
                label={
                  <span className="aiox-row-label">
                    {component.label}
                    <code>{component.componentId}</code>
                  </span>
                }
                sub={
                  <span className="aiox-row-sub">
                    <span>{component.reason}</span>
                    <SourceLine source={component.source} />
                  </span>
                }
                control={
                  <span className="aiox-inventory-readback" aria-label={`${component.label} inventory readback`}>
                    <span>E <b>{component.expected ? 'Y' : 'N'}</b></span>
                    <span>D <b>{component.discovered === null ? '?' : component.discovered ? 'Y' : 'N'}</b></span>
                    <span>I <b>{component.instrumented === null ? '?' : component.instrumented ? 'Y' : 'N'}</b></span>
                    <span>R <b>{component.reporting === null ? '?' : component.reporting ? 'Y' : 'N'}</b></span>
                    <PostureTag posture={component.posture} />
                  </span>
                }
              />
            ))}
          </Group>
        </div>
      </section>

      <section className="aiox-section" aria-labelledby="aiox-trends-title">
        <SectionHeading
          id="aiox-trends-title"
          eyebrow="Historical posture"
          title="Bounded trends"
          detail="Multi-window age, latency, queues, drops, ambiguity, recovery, cost, incidents, host pressure, rate budgets, alert class, and read-only correlation drill-down."
        />
        <EvidenceCanvas labelledBy="aiox-trends-title">
          <div className="aiox-trend-strip">
            {snapshot.trends.map((series) => <TrendCard key={series.seriesId} series={series} />)}
          </div>
        </EvidenceCanvas>
      </section>

      <div className="aiox-two-column">
        <section className="aiox-section" aria-labelledby="aiox-probes-title">
          <SectionHeading
            id="aiox-probes-title"
            eyebrow="Browser assurance"
            title="Synthetic UI probe projection"
            detail="A4 displays fixture evidence only; it does not run a timer, browser, or network probe."
          />
          <div className="aiox-group-scope">
            <Group title="Probe classes">
              {snapshot.probes.map((probe) => (
                <GRow
                  key={probe.probeId}
                  icon={<ScanSearch size={14} aria-hidden="true" />}
                  color={`var(--aiox-${toneForPosture(probe.posture)})`}
                  label={probe.label}
                  sub={`${probe.expected} · ${probe.observed ?? 'NO READBACK'}`}
                  control={<PostureTag posture={probe.posture} />}
                />
              ))}
            </Group>
          </div>
        </section>

        <section className="aiox-section" aria-labelledby="aiox-refresh-title">
          <SectionHeading
            id="aiox-refresh-title"
            eyebrow="Connection owner"
            title="RefreshDock projection"
            detail="The existing watchman keeps sole ownership of bounded refresh and reset behavior."
          />
          <div className="aiox-refresh-card">
            <div className="aiox-refresh-mark"><RefreshCcw size={18} aria-hidden="true" /></div>
            <dl>
              <div><dt>Owner</dt><dd>{snapshot.refreshDock.owner}</dd></div>
              <div><dt>Endpoint</dt><dd><code>{snapshot.refreshDock.endpoint}</code></dd></div>
              <div><dt>Target</dt><dd>{snapshot.refreshDock.target}</dd></div>
              <div><dt>Target posture</dt><dd>{snapshot.refreshDock.targetPosture}</dd></div>
              <div><dt>Status</dt><dd>{snapshot.refreshDock.status}</dd></div>
              <div><dt>Requested</dt><dd>{snapshot.refreshDock.requested ?? 'NONE'}</dd></div>
              <div><dt>Effective / readback</dt><dd>{snapshot.refreshDock.effective ?? 'UNKNOWN'} / {snapshot.refreshDock.readback ?? 'UNKNOWN'}</dd></div>
            </dl>
            <ProjectionNotice>{snapshot.refreshDock.reason}</ProjectionNotice>
            <SourceLine source={snapshot.refreshDock.source} />
          </div>
        </section>
      </div>

      <section className="aiox-section" aria-labelledby="aiox-deps-title">
        <SectionHeading
          id="aiox-deps-title"
          eyebrow="Integration ledger"
          title="Unfinished I00 interfaces"
          detail="These are explicit port-time dependencies, not claims that A4 owns or implements the seams."
        />
        <EvidenceCanvas labelledBy="aiox-deps-title">
          <div className="aiox-dependency-grid">
            {snapshot.unfinishedDependencies.map((dependency, index) => (
              <div key={dependency}>
                {index % 4 === 0 ? <Boxes size={14} aria-hidden="true" /> : index % 4 === 1 ? <Cable size={14} aria-hidden="true" /> : index % 4 === 2 ? <Gauge size={14} aria-hidden="true" /> : <Activity size={14} aria-hidden="true" />}
                <code>{dependency}</code>
              </div>
            ))}
          </div>
        </EvidenceCanvas>
      </section>
    </div>
  );
}
