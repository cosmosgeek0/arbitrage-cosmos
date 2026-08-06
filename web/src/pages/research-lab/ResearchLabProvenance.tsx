import { ChevronDown, Fingerprint } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  RESEARCH_LAB_DATASET_PROVENANCE,
  type ResearchLabCounts,
} from '../../data/researchLab';
import { RESEARCH_LAB_ARTIFACT_PROVENANCE } from '../../data/researchLabArtifacts';
import {
  RESEARCH_LAB_STORY_PROVENANCE,
  type ResearchLabStoryLayer,
} from '../../data/researchLabEvidence';
import './ResearchLabProvenance.css';

export type ResearchLabProvenanceDataset =
  | Readonly<{ status: 'LOADING'; counts: null; error: null }>
  | Readonly<{ status: 'READY'; counts: ResearchLabCounts; error: null }>
  | Readonly<{ status: 'INVALID'; counts: null; error: string }>;

export type ResearchLabDatasetStatus = ResearchLabProvenanceDataset['status'];

export type ResearchLabProvenanceProps = Readonly<{
  dataset: ResearchLabProvenanceDataset;
  storyLayer: ResearchLabStoryLayer;
  disclosed?: boolean;
}>;

type CustodyStatus = Readonly<{
  label: string;
  state: 'pending' | 'validated' | 'invalid' | 'not-present';
}>;

const FROZEN_BRANCH_TIP_PAIRS = 82;
const ARTIFACT_DERIVED_STORIES = 57;
const OPUS_AUTHORED_STORIES = 71;
const FABLE_AUTHORED_STORIES = 1;

function datasetValidation(status: ResearchLabDatasetStatus): CustodyStatus {
  if (status === 'READY') return { label: 'Validated', state: 'validated' };
  if (status === 'INVALID') return { label: 'Invalid', state: 'invalid' };
  return { label: 'Pending Index', state: 'pending' };
}

function storyValidation(status: ResearchLabStoryLayer['status']): CustodyStatus {
  if (status === 'READY') return { label: 'Validated', state: 'validated' };
  if (status === 'INVALID') return { label: 'Invalid', state: 'invalid' };
  return { label: 'Not Present', state: 'not-present' };
}

function StatusText({ status }: { status: CustodyStatus }) {
  return (
    <span className="researchx-prov-status" data-status={status.state}>
      {status.label}
    </span>
  );
}

function CustodyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="researchx-prov-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function datasetCensus(dataset: ResearchLabProvenanceDataset): string {
  if (dataset.status !== 'READY') {
    return `UNKNOWN · Frozen Contract Expects ${RESEARCH_LAB_DATASET_PROVENANCE.expectedFamilies} Unique Families`;
  }
  const { counts } = dataset;
  return [
    `${counts.all} Unique Families`,
    `${counts.noGo} NO_GO`,
    `${counts.unmeasured} UNMEASURED`,
    `${counts.noneRecorded} NONE_RECORDED`,
    `${counts.special} Other Recorded Verdicts`,
    `${counts.terminal} Terminal Evidence`,
    `${counts.fileReferences.toLocaleString('en-US')} Family File References`,
    `${FROZEN_BRANCH_TIP_PAIRS} Unique Branch / Tip Pairs`,
  ].join(' · ');
}

function storyCensus(storyLayer: ResearchLabStoryLayer): string {
  if (storyLayer.status !== 'READY') {
    return [
      'UNKNOWN Until Story Schema / Census Validates',
      `Frozen Contract Expects ${RESEARCH_LAB_STORY_PROVENANCE.expectedStories} Stories`,
      `${ARTIFACT_DERIVED_STORIES} Artifact-Derived`,
      `${RESEARCH_LAB_STORY_PROVENANCE.expectedArtifactsInsufficient} ARTIFACTS_INSUFFICIENT`,
      `${RESEARCH_LAB_STORY_PROVENANCE.expectedInProgress} IN_PROGRESS`,
      `${RESEARCH_LAB_STORY_PROVENANCE.expectedIndexNarratives} Index Narratives`,
      `${RESEARCH_LAB_STORY_PROVENANCE.expectedSources} Source Citations`,
    ].join(' · ');
  }
  return [
    `${storyLayer.counts.total} Stories`,
    `${storyLayer.counts.artifactDerived} Artifact-Derived`,
    `${storyLayer.counts.artifactsInsufficient} ARTIFACTS_INSUFFICIENT`,
    `${storyLayer.counts.inProgress} IN_PROGRESS`,
    `${storyLayer.counts.indexNarratives} Index Narratives`,
    `${RESEARCH_LAB_STORY_PROVENANCE.expectedSources} Source Citations`,
  ].join(' · ');
}

/**
 * Secondary, read-only disclosure for immutable Research Lab custody facts.
 * The browser remains the primary page task; no action or authority is exposed here.
 */
export function ResearchLabProvenance({
  dataset,
  storyLayer,
  disclosed = false,
}: ResearchLabProvenanceProps) {
  const datasetState = datasetValidation(dataset.status);
  const storyState = storyValidation(storyLayer.status);

  return (
    <details
      className={`researchx-provenance-disclosure${disclosed ? ' is-disclosed' : ''}`}
      open={disclosed || undefined}
    >
      <summary className="researchx-prov-summary">
        <span className="researchx-prov-mark" aria-hidden="true">
          <Fingerprint size={18} strokeWidth={1.7} />
        </span>
        <span className="researchx-prov-summary-copy">
          <strong>Provenance &amp; Custody</strong>
          <small>
            {RESEARCH_LAB_DATASET_PROVENANCE.expectedFamilies} Index Families ·{' '}
            {RESEARCH_LAB_ARTIFACT_PROVENANCE.expectedFamilies} Artifact Directories ·{' '}
            {RESEARCH_LAB_STORY_PROVENANCE.expectedStories} Preserved Stories
          </small>
        </span>
        <span className="researchx-prov-summary-kind">Secondary Evidence</span>
        <ChevronDown className="researchx-prov-chevron" size={18} aria-hidden="true" />
      </summary>

      <div className="researchx-prov-body">
        <div className="researchx-prov-meaning" aria-label="Custody Status Meanings">
          <div>
            <span className="researchx-prov-status" data-status="validated">Validated</span>
            <p>Closed schema and the complete frozen census were admitted together.</p>
          </div>
          <div>
            <span className="researchx-prov-status" data-status="manifest">Manifest Match</span>
            <p>An opened artifact is admitted only when its bytes and SHA-256 match its exact manifest row.</p>
          </div>
        </div>

        <section className="researchx-prov-section" aria-labelledby="researchx-prov-dataset-title">
          <header className="researchx-prov-section-head">
            <span aria-hidden="true">01</span>
            <div>
              <h3 id="researchx-prov-dataset-title">Frozen Dataset</h3>
              <p>Index schema, complete census, and immutable source identity.</p>
            </div>
            <StatusText status={datasetState} />
          </header>
          <dl>
            <CustodyRow label="Schema & Census">
              <code className="researchx-prov-copy">{datasetCensus(dataset)}</code>
            </CustodyRow>
            <CustodyRow label="Frozen Source">
              <code className="researchx-prov-copy">{RESEARCH_LAB_DATASET_PROVENANCE.sourcePath}</code>
            </CustodyRow>
            <CustodyRow label="Source Identity">
              <code className="researchx-prov-copy">
                {RESEARCH_LAB_DATASET_PROVENANCE.sourceBytes.toLocaleString('en-US')} Bytes · SHA-256{' '}
                {RESEARCH_LAB_DATASET_PROVENANCE.sourceSha256}
              </code>
            </CustodyRow>
            <CustodyRow label="Versioned Copy">
              <code className="researchx-prov-copy">{RESEARCH_LAB_DATASET_PROVENANCE.versionedPath}</code>
            </CustodyRow>
            {dataset.status === 'INVALID' ? (
              <CustodyRow label="Validation Failure">
                <code className="researchx-prov-copy researchx-prov-failure">
                  {dataset.error}
                </code>
              </CustodyRow>
            ) : null}
          </dl>
        </section>

        <section className="researchx-prov-section" aria-labelledby="researchx-prov-artifacts-title">
          <header className="researchx-prov-section-head">
            <span aria-hidden="true">02</span>
            <div>
              <h3 id="researchx-prov-artifacts-title">Artifact Manifest</h3>
              <p>Exact bundle census plus one byte-and-checksum row per preserved artifact.</p>
            </div>
            <span className="researchx-prov-status" data-status="manifest">Per-Artifact Check</span>
          </header>
          <dl>
            <CustodyRow label="Bundle Census">
              <code className="researchx-prov-copy">
                {RESEARCH_LAB_ARTIFACT_PROVENANCE.expectedFamilies} Family Directories ·{' '}
                {RESEARCH_LAB_ARTIFACT_PROVENANCE.expectedFiles} Files ·{' '}
                {RESEARCH_LAB_ARTIFACT_PROVENANCE.expectedBytes.toLocaleString('en-US')} Bytes
              </code>
            </CustodyRow>
            <CustodyRow label="Preserved Source">
              <code className="researchx-prov-copy">{RESEARCH_LAB_ARTIFACT_PROVENANCE.sourcePath}</code>
            </CustodyRow>
            <CustodyRow label="Versioned Roots">
              <code className="researchx-prov-copy">
                {RESEARCH_LAB_ARTIFACT_PROVENANCE.versionedRoot} · {RESEARCH_LAB_ARTIFACT_PROVENANCE.publicRoot}
              </code>
            </CustodyRow>
            <CustodyRow label="Manifest SHA-256">
              <code className="researchx-prov-copy">{RESEARCH_LAB_ARTIFACT_PROVENANCE.manifestSha256}</code>
            </CustodyRow>
            <CustodyRow label="Missing Artifact Custody">
              <span className="researchx-prov-missing">
                <code className="researchx-prov-copy">
                  {RESEARCH_LAB_ARTIFACT_PROVENANCE.missingIndexedFamilies.join(', ')}
                </code>
                <small>
                  Indexed family and authored context preserved; no verdict-normalization directory or artifact file custody exists.
                </small>
              </span>
            </CustodyRow>
          </dl>
        </section>

        <section className="researchx-prov-section" aria-labelledby="researchx-prov-stories-title">
          <header className="researchx-prov-section-head">
            <span aria-hidden="true">03</span>
            <div>
              <h3 id="researchx-prov-stories-title">Seventy-Two Story Layer</h3>
              <p>Authored context remains subordinate to frozen index and artifact truth.</p>
            </div>
            <StatusText status={storyState} />
          </header>
          <dl>
            <CustodyRow label="Schema & Census">
              <code className="researchx-prov-copy">{storyCensus(storyLayer)}</code>
            </CustodyRow>
            <CustodyRow label="Authorship Census">
              <code className="researchx-prov-copy">
                {OPUS_AUTHORED_STORIES} opus-worker · {FABLE_AUTHORED_STORIES} fable-manual-from-sealed-artifacts
              </code>
            </CustodyRow>
            <CustodyRow label="Desktop Source">
              <code className="researchx-prov-copy">{RESEARCH_LAB_STORY_PROVENANCE.sourcePath}</code>
            </CustodyRow>
            <CustodyRow label="Source Identity">
              <code className="researchx-prov-copy">
                {RESEARCH_LAB_STORY_PROVENANCE.sourceBytes.toLocaleString('en-US')} Bytes · SHA-256{' '}
                {RESEARCH_LAB_STORY_PROVENANCE.sourceSha256}
              </code>
            </CustodyRow>
            <CustodyRow label="Versioned Identity">
              <span className="researchx-prov-stack">
                <code className="researchx-prov-copy">{RESEARCH_LAB_STORY_PROVENANCE.versionedPath}</code>
                <code className="researchx-prov-copy">
                  {RESEARCH_LAB_STORY_PROVENANCE.versionedBytes.toLocaleString('en-US')} Bytes · SHA-256{' '}
                  {RESEARCH_LAB_STORY_PROVENANCE.versionedSha256}
                </code>
              </span>
            </CustodyRow>
            <CustodyRow label="Authored Provenance">
              <span className="researchx-prov-stack">
                <code className="researchx-prov-copy">
                  {storyLayer.status === 'READY' ? storyLayer.provenance : 'UNKNOWN UNTIL STORY LAYER VALIDATES'}
                </code>
                <small>{RESEARCH_LAB_STORY_PROVENANCE.note}</small>
              </span>
            </CustodyRow>
            {storyLayer.status === 'INVALID' ? (
              <CustodyRow label="Validation Failure">
                <code className="researchx-prov-copy researchx-prov-failure">{storyLayer.error}</code>
              </CustodyRow>
            ) : null}
          </dl>
        </section>
      </div>
    </details>
  );
}

export default ResearchLabProvenance;
