import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  projectResearchLabDetail,
  type ResearchLabExperiment,
} from '../../data/researchLab';
import {
  RESEARCH_LAB_ARTIFACT_PROVENANCE,
  type ResearchLabArtifact,
} from '../../data/researchLabArtifacts';
import {
  RESEARCH_LAB_BE2_WINDOW_END,
  type ResearchLabStory,
  type ResearchLabStoryKind,
} from '../../data/researchLabEvidence';
import './ResearchLabNarrative.css';

export type ResearchLabNarrativeProps = Readonly<{
  experiment: ResearchLabExperiment;
  story: ResearchLabStory | null;
  artifacts: readonly ResearchLabArtifact[];
  onOpenManifestArtifact?: (artifact: ResearchLabArtifact, exactSource: string) => void;
}>;

type NarrativeMode = ResearchLabStoryKind | 'INDEX_NARRATIVE';

type ModeCopy = Readonly<{
  eyebrow: string;
  title: string;
  status: string;
  description: string;
}>;

const MODE_COPY: Readonly<Record<NarrativeMode, ModeCopy>> = Object.freeze({
  ARTIFACT_DERIVED: Object.freeze({
    eyebrow: 'Artifact-Authored Context',
    title: 'What The Preserved Work Says',
    status: 'ARTIFACT_DERIVED',
    description: 'Plain-language context authored from the sealed family packet. It explains the work without replacing the frozen index.',
  }),
  ARTIFACTS_INSUFFICIENT: Object.freeze({
    eyebrow: 'Artifact Custody Boundary',
    title: 'What Survived In The Packet',
    status: 'ARTIFACTS_INSUFFICIENT',
    description: 'This family preserves a tool or incomplete packet, not a recorded market-experiment outcome. The exact surviving record is retained below.',
  }),
  IN_PROGRESS: Object.freeze({
    eyebrow: 'Recorded Handoff State',
    title: 'Measurement Still In Progress',
    status: 'IN_PROGRESS',
    description: 'The sealed protocol records an open forward-measurement window. No terminal result is inferred before that window closes.',
  }),
  INDEX_NARRATIVE: Object.freeze({
    eyebrow: 'Canonical Index Context',
    title: 'Narrative From The Frozen Index',
    status: 'INDEX_NARRATIVE',
    description: 'No artifact-authored story was supplied for this family. Its canonical hypothesis and recorded reason remain the complete narrative shown here.',
  }),
});

const PROSE_PREVIEW_LIMIT = 540;
const PROSE_MINIMUM_BREAK = 300;

function narrativeMode(story: ResearchLabStory | null): NarrativeMode {
  return story?.kind ?? 'INDEX_NARRATIVE';
}

function prosePreview(text: string): string | null {
  if (text.length <= PROSE_PREVIEW_LIMIT) return null;
  const candidate = text.slice(0, PROSE_PREVIEW_LIMIT + 1);
  const sentenceBreak = Math.max(
    candidate.lastIndexOf('. '),
    candidate.lastIndexOf('? '),
    candidate.lastIndexOf('! '),
    candidate.lastIndexOf('; '),
  );
  const cut = sentenceBreak >= PROSE_MINIMUM_BREAK ? sentenceBreak + 1 : PROSE_PREVIEW_LIMIT;
  return text.slice(0, cut).trimEnd();
}

function ProgressiveProse({ text }: { text: string }) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const preview = prosePreview(text);
  const visibleText = preview && !expanded ? preview : text;

  return (
    <div className="researchn-progressive">
      <p id={contentId}>
        {visibleText}
        {preview && !expanded ? <span className="researchn-ellipsis" aria-hidden="true">…</span> : null}
      </p>
      {preview ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          <span>{expanded ? 'Show Less' : 'Read Full Context'}</span>
          <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function endingHeading(experiment: ResearchLabExperiment, story: ResearchLabStory): string {
  if (story.kind === 'IN_PROGRESS') return 'Recorded State At Handoff';
  if (experiment.verdict === 'NO_GO') return 'What The Evidence Ruled Out';
  if (experiment.verdict === 'UNMEASURED') return 'Why The Result Stayed Unmeasured';
  if (experiment.verdict === 'NONE_RECORDED') return 'Recorded End State';
  return 'Recorded Outcome Context';
}

function manifestArtifactForSource(
  family: string,
  source: string,
  artifacts: readonly ResearchLabArtifact[],
): ResearchLabArtifact | null {
  return artifacts.find((artifact) => {
    if (artifact.family !== family) return false;
    return source === artifact.name
      || source === `${RESEARCH_LAB_ARTIFACT_PROVENANCE.versionedRoot}/${artifact.path}`;
  }) ?? null;
}

function StorySources({
  story,
  artifacts,
  onOpenManifestArtifact,
}: {
  story: ResearchLabStory;
  artifacts: readonly ResearchLabArtifact[];
  onOpenManifestArtifact?: (artifact: ResearchLabArtifact, exactSource: string) => void;
}) {
  const manifestSources = story.sources.map((source) => ({
    source,
    artifact: manifestArtifactForSource(story.family, source, artifacts),
  }));
  const interactiveCount = onOpenManifestArtifact
    ? manifestSources.filter(({ artifact }) => artifact !== null).length
    : 0;

  return (
    <details
      className="researchn-sources"
      data-source-custody={interactiveCount > 0 ? 'MANIFEST_CALLBACK_AVAILABLE' : 'INERT_EXACT_CUSTODY'}
    >
      <summary>
        <span>
          <strong>Exact Story Sources</strong>
          <small>
            {story.sources.length} {story.sources.length === 1 ? 'Source' : 'Sources'} · {' '}
            {interactiveCount > 0 ? `${interactiveCount} Manifest-Bound ${interactiveCount === 1 ? 'Copy' : 'Copies'}` : 'Inert Custody'}
          </small>
        </span>
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
      </summary>
      <div className="researchn-source-panel">
        <ol>
          {manifestSources.map(({ source, artifact }, index) => (
            <li key={`${source}-${index}`}>
              {artifact && onOpenManifestArtifact ? (
                <button
                  type="button"
                  onClick={() => onOpenManifestArtifact(artifact, source)}
                  aria-label={`Verify And Open Artifact ${source}`}
                >
                  <code>{source}</code>
                  <span>Verify And Open</span>
                </button>
              ) : (
                <div>
                  <code>{source}</code>
                  <span>Exact Custody · No Interactive Artifact</span>
                </div>
              )}
            </li>
          ))}
        </ol>
        <footer>
          <span>Authored By</span>
          <code>{story.author}</code>
        </footer>
      </div>
    </details>
  );
}

function FrozenIndexNarrative({ experiment }: { experiment: ResearchLabExperiment }) {
  const detail = projectResearchLabDetail(experiment);

  return (
    <section className="researchn-index" aria-labelledby={`researchn-index-${detail.family}`}>
      <header>
        <span>Canonical Frozen Index</span>
        <h4 id={`researchn-index-${detail.family}`}>Recorded Family Truth</h4>
        <p>These fields come from the admitted index and are not rewritten by the authored story layer.</p>
      </header>

      <dl className="researchn-index-tape">
        <div>
          <dt>Verdict</dt>
          <dd>{detail.verdict}</dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd>{detail.protocolId}</dd>
        </div>
        <div>
          <dt>Capital Record</dt>
          <dd>{detail.capital}</dd>
        </div>
        <div>
          <dt>Exact Custody</dt>
          <dd><code>{detail.custody}</code></dd>
        </div>
      </dl>

      <div className="researchn-index-prose">
        <section>
          <h5>Recorded Hypothesis</h5>
          <ProgressiveProse text={detail.hypothesis} />
        </section>
        <section>
          <h5>Recorded Reason</h5>
          {detail.reasonStructured ? <pre>{detail.reason}</pre> : <ProgressiveProse text={detail.reason} />}
        </section>
      </div>
    </section>
  );
}

function ArtifactNarrative({
  experiment,
  story,
  artifacts,
  onOpenManifestArtifact,
}: {
  experiment: ResearchLabExperiment;
  story: ResearchLabStory;
  artifacts: readonly ResearchLabArtifact[];
  onOpenManifestArtifact?: (artifact: ResearchLabArtifact, exactSource: string) => void;
}) {
  const mode = narrativeMode(story);
  const copy = MODE_COPY[mode];
  const insufficient = story.kind === 'ARTIFACTS_INSUFFICIENT';
  const inProgress = story.kind === 'IN_PROGRESS';

  return (
    <section className="researchn-authored" aria-labelledby={`researchn-authored-${experiment.family}`}>
      <header className="researchn-authored-head">
        <div>
          <span>{copy.eyebrow}</span>
          <h4 id={`researchn-authored-${experiment.family}`}>{copy.title}</h4>
          <p>{copy.description}</p>
        </div>
        <strong>{copy.status}</strong>
      </header>

      {inProgress ? (
        <div className="researchn-window" role="note" aria-label="Recorded Measurement Window">
          <span>Scheduled Window End</span>
          <time dateTime="2026-08-12T00:00:00Z">{RESEARCH_LAB_BE2_WINDOW_END}</time>
          <small>Recorded At Handoff · No Early Result Inferred</small>
        </div>
      ) : null}

      <div className={`researchn-authored-prose${insufficient ? ' is-single' : ''}`}>
        {insufficient ? (
          <section>
            <h5>Packet-Specific Record</h5>
            <ProgressiveProse text={story.whyItEnded} />
          </section>
        ) : (
          <>
            <section>
              <h5>{inProgress ? 'What Is Being Measured' : 'What Was Tested'}</h5>
              <ProgressiveProse text={story.tested} />
            </section>
            <section>
              <h5>{endingHeading(experiment, story)}</h5>
              <ProgressiveProse text={story.whyItEnded} />
            </section>
          </>
        )}
      </div>

      <StorySources
        story={story}
        artifacts={artifacts}
        onOpenManifestArtifact={onOpenManifestArtifact}
      />
    </section>
  );
}

export function ResearchLabNarrative({
  experiment,
  story,
  artifacts,
  onOpenManifestArtifact,
}: ResearchLabNarrativeProps) {
  const mode = narrativeMode(story);
  const copy = MODE_COPY[mode];

  return (
    <section
      className={`researchn-root mode-${mode.toLowerCase().replaceAll('_', '-')}`}
      aria-label={`${experiment.family} Research Narrative`}
      data-narrative-kind={mode}
      data-index-truth="FROZEN"
      data-authored-context={story ? 'PRESENT' : 'NOT_PRESENT'}
    >
      <FrozenIndexNarrative experiment={experiment} />

      {story ? (
        <ArtifactNarrative
          experiment={experiment}
          story={story}
          artifacts={artifacts}
          onOpenManifestArtifact={onOpenManifestArtifact}
        />
      ) : (
        <section className="researchn-index-only" aria-label="Index Narrative Boundary">
          <span>{copy.eyebrow}</span>
          <strong>{copy.title}</strong>
          <p>{copy.description}</p>
        </section>
      )}
    </section>
  );
}
