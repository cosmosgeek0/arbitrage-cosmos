// SourceHealthPanel — DASHBOARD_TRUTH item 3: per-source connection state,
// last message age, backpressure, rate limit, and coverage. Quiet symbols
// stay visible; gap counts are aggregate because schema v1 does not publish
// per-source sequence-gap counters.

import type { SystemComponentId, SystemSupervisorSnapshot } from '../../../lib/systemIntegration';
import {
  UNKNOWN_TEXT,
  ageText,
  componentStateText,
  componentTone,
  countText,
  freshnessOf,
  freshnessText,
  words,
} from '../lib/presentation';
import { Band, Chip, FactRow, NotPublished, TruthTag, Val } from './bits';

const SOURCE_IDS: SystemComponentId[] = ['public-spot-source', 'public-usdm-source'];

export function SourceHealthPanel({ snapshot, nowMs }: { snapshot: SystemSupervisorSnapshot; nowMs: number }) {
  const coverage = snapshot.summaries.sourceCoverage;
  return (
    <section className="sdx-section" aria-label="Data-source health">
      <Band title="Data Sources" meta={<TruthTag label={coverage.truthLabel} />} />
      <div className="sdx-stats">
        <div className="sdx-stat"><span>Universe</span><b className={coverage.universeSymbols === null ? 'unk' : ''}>{countText(coverage.universeSymbols)}</b></div>
        <div className="sdx-stat"><span>Spot Covered</span><b className={coverage.spotCoveredSymbols === null ? 'unk' : coverage.spotCoveredSymbols === 0 ? 'bad' : ''}>{countText(coverage.spotCoveredSymbols)}</b></div>
        <div className="sdx-stat"><span>USD-M Covered</span><b className={coverage.usdMCoveredSymbols === null ? 'unk' : ''}>{countText(coverage.usdMCoveredSymbols)}</b></div>
        <div className="sdx-stat"><span>Quiet Retained</span><b className={coverage.quietSymbolsRetained === null ? 'unk' : ''}>{countText(coverage.quietSymbolsRetained)}</b></div>
        <div className="sdx-stat"><span>Material Gaps</span><b className={coverage.materialGapCount === null ? 'unk' : coverage.materialGapCount > 0 ? 'warn' : ''}>{countText(coverage.materialGapCount)}</b></div>
        <div className="sdx-stat"><span>Rate Limited</span><b className={coverage.rateLimitedSourceCount === null ? 'unk' : coverage.rateLimitedSourceCount > 0 ? 'warn' : ''}>{countText(coverage.rateLimitedSourceCount)}</b></div>
      </div>
      <div className="sdx-rows">
        {SOURCE_IDS.map((id) => {
          const source = snapshot.components.find((c) => c.componentId === id);
          if (!source) {
            return (
              <FactRow
                key={id}
                label={words(id)}
                sub="Source component absent from the snapshot — treat as down."
                end={<><Val text={UNKNOWN_TEXT} /><span className="sdx-truth unknown">MISSING</span></>}
              />
            );
          }
          const fresh = freshnessOf(source);
          const backpressure = source.queue
            ? `Queue ${source.queue.depth}/${source.queue.capacity} · ${source.queue.dropped} dropped · ${source.queue.coalesced} coalesced`
            : `Queue ${UNKNOWN_TEXT}`;
          return (
            <FactRow
              key={id}
              label={words(id)}
              sub={`${backpressure} · Last message ${ageText(source.lastReceiveAtMs, nowMs)}${source.blockerCodes.length ? ` · ${source.blockerCodes.join(' · ')}` : ''}`}
              end={<>
                <Val
                  text={freshnessText(fresh)}
                  tone={fresh.kind === 'SILENT' ? 'bad' : fresh.kind === 'STALE' ? 'warn' : undefined}
                />
                <Chip tone={componentTone(source)}>{componentStateText(source)}</Chip>
                <TruthTag label={source.truthLabel} />
              </>}
            />
          );
        })}
        <FactRow
          label="Sequence Gaps · All Sources"
          sub={`Last material gap ${ageText(coverage.lastMaterialGapAtMs, nowMs)} — aggregate across sources`}
          end={<Val text={countText(coverage.materialGapCount)} tone={(coverage.materialGapCount ?? 0) > 0 ? 'warn' : undefined} />}
        />
      </div>
      <NotPublished>Per-source sequence-gap and backoff counters — schema v1 publishes coverage aggregates only.</NotPublished>
    </section>
  );
}
