import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
} from 'lucide-react';
import './ResearchLabCatalog.css';

export type ResearchLabComparisonTuple = readonly [
  string | null,
  string | null,
];

export type ResearchLabCatalogRow = Readonly<{
  family: string;
  verdict: string;
  testedQuestion: string;
  questionSource: string;
  familyGroup: string;
  artifactCount: number | null;
}>;

export type ResearchLabCatalogState =
  | Readonly<{ status: 'READY' }>
  | Readonly<{ status: 'LOADING' }>
  | Readonly<{ status: 'INVALID'; reason: string }>
  | Readonly<{ status: 'EMPTY'; reason: string }>;

export type ResearchLabCatalogProps = Readonly<{
  visibleRows: readonly ResearchLabCatalogRow[];
  selectedFamily: string | null;
  comparisonFamilies: ResearchLabComparisonTuple;
  state: ResearchLabCatalogState;
  onSelect: (family: string, opener: HTMLElement) => void;
  onToggleCompare: (family: string) => void;
}>;

type CatalogSortKey = 'FAMILY' | 'VERDICT' | 'GROUP' | 'ARTIFACTS';
type CatalogSortDirection = 'ASCENDING' | 'DESCENDING';
type CatalogSort = Readonly<{ key: CatalogSortKey; direction: CatalogSortDirection }>;

const CATALOG_PAGE_SIZE = 24;
const DEFAULT_SORT: CatalogSort = Object.freeze({ key: 'FAMILY', direction: 'ASCENDING' });

function comparisonSlot(
  comparisonFamilies: ResearchLabComparisonTuple,
  family: string,
): 1 | 2 | null {
  if (comparisonFamilies[0] === family) return 1;
  if (comparisonFamilies[1] === family) return 2;
  return null;
}

function knownArtifactCount(count: number | null): count is number {
  return count !== null && Number.isSafeInteger(count) && count >= 0;
}

function artifactValue(count: number | null): string {
  return knownArtifactCount(count) ? count.toLocaleString('en-US') : 'UNKNOWN';
}

function artifactMeta(count: number | null): string {
  return knownArtifactCount(count)
    ? `${count.toLocaleString('en-US')} Preserved Artifacts`
    : 'Preserved Artifacts UNKNOWN';
}

function catalogQuestionExcerpt(question: string): Readonly<{ text: string; abridged: boolean }> {
  const normalized = question.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 72) return Object.freeze({ text: normalized, abridged: false });

  const sentenceEnd = normalized.slice(0, 73).search(/[.!?](?:\s|$)/);
  if (sentenceEnd >= 36) {
    return Object.freeze({ text: normalized.slice(0, sentenceEnd + 1), abridged: true });
  }

  const candidate = normalized.slice(0, 69);
  const wordBoundary = candidate.lastIndexOf(' ');
  const end = wordBoundary >= 50 ? wordBoundary : candidate.length;
  return Object.freeze({ text: `${candidate.slice(0, end)}…`, abridged: true });
}

function compareCatalogRows(
  left: ResearchLabCatalogRow,
  right: ResearchLabCatalogRow,
  sort: CatalogSort,
): number {
  let comparison = 0;
  if (sort.key === 'FAMILY') comparison = left.family.localeCompare(right.family, 'en-US');
  if (sort.key === 'VERDICT') comparison = left.verdict.localeCompare(right.verdict, 'en-US');
  if (sort.key === 'GROUP') comparison = left.familyGroup.localeCompare(right.familyGroup, 'en-US');
  if (sort.key === 'ARTIFACTS') {
    if (left.artifactCount === null && right.artifactCount !== null) return 1;
    if (left.artifactCount !== null && right.artifactCount === null) return -1;
    comparison = (left.artifactCount ?? 0) - (right.artifactCount ?? 0);
  }
  if (comparison === 0 && sort.key !== 'FAMILY') {
    comparison = left.family.localeCompare(right.family, 'en-US');
  }
  return sort.direction === 'ASCENDING' ? comparison : -comparison;
}

function sortAriaValue(sort: CatalogSort, key: CatalogSortKey): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.direction === 'ASCENDING' ? 'ascending' : 'descending';
}

function SortGlyph({ sort, column }: { sort: CatalogSort; column: CatalogSortKey }) {
  if (sort.key !== column) return <ChevronsUpDown size={13} strokeWidth={1.7} aria-hidden="true" />;
  return sort.direction === 'ASCENDING'
    ? <ArrowUp size={13} strokeWidth={1.8} aria-hidden="true" />
    : <ArrowDown size={13} strokeWidth={1.8} aria-hidden="true" />;
}

function CatalogStateRow({ state }: { state: Exclude<ResearchLabCatalogState, { status: 'READY' }> }) {
  if (state.status === 'LOADING') {
    return (
      <tr className="research-catalog__state-row">
        <td colSpan={6}>
          <div className="research-catalog__state research-catalog__state--loading" role="status">
            <span>Frozen Index</span>
            <strong>Loading Family Evidence</strong>
            <p>Recorded verdicts remain unavailable while the frozen index is checked.</p>
            <div className="research-catalog__skeleton" aria-hidden="true">
              <i /><i /><i /><i />
            </div>
          </div>
        </td>
      </tr>
    );
  }

  if (state.status === 'INVALID') {
    return (
      <tr className="research-catalog__state-row">
        <td colSpan={6}>
          <div className="research-catalog__state" role="alert">
            <span>Frozen Index</span>
            <strong>Family Evidence Unavailable</strong>
            <p><code>{state.reason}</code> Counts and verdicts remain UNKNOWN.</p>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="research-catalog__state-row">
      <td colSpan={6}>
        <div className="research-catalog__state">
          <span>Visible Families</span>
          <strong>No Matching Family Evidence</strong>
          <p>{state.reason}</p>
        </div>
      </td>
    </tr>
  );
}

export function ResearchLabCatalog({
  visibleRows,
  selectedFamily,
  comparisonFamilies,
  state,
  onSelect,
  onToggleCompare,
}: ResearchLabCatalogProps) {
  const [sort, setSort] = useState<CatalogSort>(DEFAULT_SORT);
  const [page, setPage] = useState(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const comparisonCount = new Set(
    comparisonFamilies.filter((family): family is string => family !== null),
  ).size;
  const comparisonFull = comparisonCount === 2;
  const renderedState = state.status === 'READY' && visibleRows.length === 0
    ? ({
        status: 'EMPTY',
        reason: 'No experiment family matches the current search and filter.',
      } as const)
    : state;
  const sortedRows = useMemo(
    () => Object.freeze([...visibleRows].sort((left, right) => compareCatalogRows(left, right, sort))),
    [sort, visibleRows],
  );
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / CATALOG_PAGE_SIZE));
  const admittedPage = Math.min(page, pageCount - 1);
  const pageStart = admittedPage * CATALOG_PAGE_SIZE;
  const pageRows = sortedRows.slice(pageStart, pageStart + CATALOG_PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [visibleRows]);

  function toggleSort(key: CatalogSortKey) {
    setSort((current) => Object.freeze({
      key,
      direction: current.key === key && current.direction === 'ASCENDING'
        ? 'DESCENDING'
        : 'ASCENDING',
    }));
    setPage(0);
  }

  function movePage(nextPage: number) {
    setPage(Math.max(0, Math.min(nextPage, pageCount - 1)));
    requestAnimationFrame(() => {
      tableScrollRef.current?.scrollIntoView({ block: 'start' });
      tableScrollRef.current?.focus({ preventScroll: true });
    });
  }

  return (
    <section
      className="research-catalog"
      aria-label="Research Experiment Family Catalog"
      aria-busy={renderedState.status === 'LOADING'}
    >
      <div
        ref={tableScrollRef}
        className="research-catalog__table-scroll"
        tabIndex={0}
        aria-label="Research Experiment Family Evidence Table"
      >
      <table className="research-catalog__table">
        <caption className="research-catalog__sr-only">
          Research experiment families with exact verdicts, tested questions, derived groups,
          preserved artifact counts, and comparison selection.
        </caption>
        <thead>
          <tr>
            <th
              className="research-catalog__family-cell"
              scope="col"
              aria-sort={sortAriaValue(sort, 'FAMILY')}
            >
              <button type="button" className="research-catalog__sort" onClick={() => toggleSort('FAMILY')}>
                <span className="research-catalog__heading-wide">Family</span>
                <span className="research-catalog__heading-mobile">Family Evidence</span>
                <SortGlyph sort={sort} column="FAMILY" />
              </button>
            </th>
            <th
              className="research-catalog__verdict-cell"
              scope="col"
              aria-sort={sortAriaValue(sort, 'VERDICT')}
            >
              <button type="button" className="research-catalog__sort" onClick={() => toggleSort('VERDICT')}>
                Exact Verdict <SortGlyph sort={sort} column="VERDICT" />
              </button>
            </th>
            <th className="research-catalog__question-cell" scope="col">Tested Question</th>
            <th
              className="research-catalog__group-cell"
              scope="col"
              aria-sort={sortAriaValue(sort, 'GROUP')}
            >
              <button type="button" className="research-catalog__sort" onClick={() => toggleSort('GROUP')}>
                Family Group <SortGlyph sort={sort} column="GROUP" />
              </button>
            </th>
            <th
              className="research-catalog__artifact-cell"
              scope="col"
              aria-sort={sortAriaValue(sort, 'ARTIFACTS')}
            >
              <button type="button" className="research-catalog__sort" onClick={() => toggleSort('ARTIFACTS')}>
                Artifacts <SortGlyph sort={sort} column="ARTIFACTS" />
              </button>
            </th>
            <th className="research-catalog__compare-cell" scope="col">Compare</th>
          </tr>
        </thead>
        <tbody>
          {renderedState.status !== 'READY' ? (
            <CatalogStateRow state={renderedState} />
          ) : pageRows.map((row) => {
            const slot = comparisonSlot(comparisonFamilies, row.family);
            const compareDisabled = comparisonFull && slot === null;
            const selected = selectedFamily === row.family;
            const compactQuestion = catalogQuestionExcerpt(row.testedQuestion);
            const compareLabel = slot !== null
              ? `Remove ${row.family} From Comparison Slot ${slot}`
              : compareDisabled
                ? `Comparison Is Full; Remove One Family Before Adding ${row.family}`
                : `Add ${row.family} To Comparison`;

            return (
              <tr
                key={row.family}
                className={selected ? 'research-catalog__row is-selected' : 'research-catalog__row'}
                data-verdict={row.verdict}
              >
                <th className="research-catalog__family-cell" scope="row">
                  <button
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    onClick={(event) => onSelect(row.family, event.currentTarget)}
                  >
                    <strong>{row.family}</strong>
                    <span className="research-catalog__mobile-verdict">
                      <b>Exact Verdict</b><span>{row.verdict}</span>
                    </span>
                    <span className="research-catalog__mobile-question">
                      <b>{compactQuestion.abridged ? 'Catalog Excerpt' : 'Tested Question'}</b>
                      <span>{compactQuestion.text}</span>
                      <small>
                        {row.questionSource}
                        {compactQuestion.abridged ? ' · Full Text In Detail' : ''}
                      </small>
                    </span>
                    <span className="research-catalog__mobile-facts">
                      <span><b>Derived Group</b><span>{row.familyGroup}</span></span>
                      <span><b>Artifacts</b><span>{artifactMeta(row.artifactCount)}</span></span>
                    </span>
                    <span className="research-catalog__mobile-open">Open Evidence</span>
                    <span className="research-catalog__compact-meta">
                      <span>{row.familyGroup}</span>
                      <span>{artifactMeta(row.artifactCount)}</span>
                    </span>
                  </button>
                </th>
                <td className="research-catalog__verdict-cell">
                  <strong>{row.verdict}</strong>
                  <small>Exact Verdict</small>
                </td>
                <td className="research-catalog__question-cell">
                  <strong>{row.testedQuestion}</strong>
                  <small>{row.questionSource}</small>
                </td>
                <td className="research-catalog__group-cell">
                  <strong>{row.familyGroup}</strong>
                  <small>Derived Group</small>
                </td>
                <td className="research-catalog__artifact-cell">
                  <strong>{artifactValue(row.artifactCount)}</strong>
                  <small>{knownArtifactCount(row.artifactCount) ? 'Preserved' : 'Not Available'}</small>
                </td>
                <td className="research-catalog__compare-cell">
                  <label
                    className="research-catalog__compare-control"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={slot !== null}
                      disabled={compareDisabled}
                      aria-label={compareLabel}
                      onChange={() => onToggleCompare(row.family)}
                    />
                    <span className="research-catalog__check" aria-hidden="true">
                      {slot ?? ''}
                    </span>
                    <small>{slot !== null ? `Slot ${slot}` : compareDisabled ? 'Full' : 'Add'}</small>
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {renderedState.status === 'READY' && sortedRows.length > CATALOG_PAGE_SIZE ? (
        <footer className="research-catalog__pager" aria-label="Family Catalog Pages">
          <span>
            <strong>{pageStart + 1}–{Math.min(pageStart + CATALOG_PAGE_SIZE, sortedRows.length)}</strong>
            <small>Of {sortedRows.length} Families · Page {admittedPage + 1} Of {pageCount}</small>
          </span>
          <div>
            <button
              type="button"
              aria-label="Previous Family Page"
              disabled={admittedPage === 0}
              onClick={() => movePage(admittedPage - 1)}
            >
              <ChevronLeft size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              aria-label="Next Family Page"
              disabled={admittedPage === pageCount - 1}
              onClick={() => movePage(admittedPage + 1)}
            >
              <span>Next</span>
              <ChevronRight size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}
