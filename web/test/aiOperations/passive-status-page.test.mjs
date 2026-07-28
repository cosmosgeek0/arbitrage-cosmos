import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.React = React;

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.css')) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: '' };
  },
});

const { AiOperations } = await import('../../src/pages/AiOperations.tsx');
const {
  PassiveAiOperationsStatus,
} = await import('../../src/features/aiOperations/PassiveAiOperationsStatus.tsx');
const {
  AI_OPERATIONS_SOURCE_BOUND_PREVIEW,
} = await import('../../src/features/aiOperations/preview/sourceBoundPreview.ts');
const {
  projectAiOpsPassiveStatus,
} = await import('../../../server/src/aiOps/projections/passiveStatus.ts');

test('AI Operations staging page renders only source-bound passive truth', () => {
  const markup = renderToStaticMarkup(
    createElement(AiOperations, {
      projection: AI_OPERATIONS_SOURCE_BOUND_PREVIEW,
      previewLabel: 'LOCAL PREVIEW',
    }),
  );

  assert.match(markup, /class="container page aiop-page"/u);
  assert.match(markup, /<h1 id="ai-operations-title">AI Operations<\/h1>/u);
  assert.match(markup, /SOURCE-BOUND · PASSIVE/u);
  assert.match(markup, /LOCAL PREVIEW/u);
  assert.match(markup, /<dl class="aiop-summary" aria-label="AI Operations status summary">/u);
  assert.match(
    markup,
    /<dt>Configured<\/dt><dd class="aiop-summary-value blocked">NOT_CONFIGURED<\/dd>/u,
  );
  assert.match(
    markup,
    /<dt>Mounted<\/dt><dd class="aiop-summary-value blocked">NOT_MOUNTED<\/dd>/u,
  );
  for (const label of ['Active', 'Paused', 'Completed', 'Failed']) {
    assert.match(
      markup,
      new RegExp(`<dt>${label}</dt><dd class="aiop-summary-value unknown">UNKNOWN</dd>`, 'u'),
    );
  }
  assert.match(markup, /Work-state counts are UNKNOWN, not zero/u);
  assert.match(markup, /SHADOW_SPECULATIVE/u);
  assert.match(markup, /Shadow Incident Accepted<\/dt><dd>FALSE/u);
  assert.match(markup, /Action Authority<\/dt><dd>NONE/u);
  assert.match(markup, /Self-Healing Claim<\/dt><dd>NONE/u);
  assert.match(markup, /Projection Provider Call<\/dt><dd>FALSE/u);
  assert.match(markup, />9 SOURCE CONTRACTS</u);
  for (const blocker of AI_OPERATIONS_SOURCE_BOUND_PREVIEW.blockers) {
    assert.ok(markup.includes(blocker.code));
    assert.ok(markup.includes(blocker.state));
    assert.ok(markup.includes(blocker.detail));
  }
  assert.doesNotMatch(markup, /<button|<form|<input|<select|<textarea/u);
  assert.doesNotMatch(markup, /role="status"|aria-live=/u);
  assert.doesNotMatch(markup, /\bsubscription\b/iu);
  assert.doesNotMatch(markup, /resolving now|repair in progress|working on it/iu);
});

test('UNKNOWN mount evidence remains UNKNOWN instead of becoming absent', () => {
  const unknownProjection = {
    ...AI_OPERATIONS_SOURCE_BOUND_PREVIEW,
    mountState: 'UNKNOWN',
    runtimeContract: {
      ...AI_OPERATIONS_SOURCE_BOUND_PREVIEW.runtimeContract,
      operationalRuntimeEvidence: 'UNKNOWN',
    },
  };
  const markup = renderToStaticMarkup(
    createElement(PassiveAiOperationsStatus, { projection: unknownProjection }),
  );

  assert.match(markup, /Operational runtime evidence is UNKNOWN/u);
  assert.match(markup, /READBACK UNKNOWN/u);
  assert.doesNotMatch(markup, /Operational runtime evidence is not mounted/u);
  assert.doesNotMatch(markup, /READBACK ABSENT/u);
});

test('local preview is exact current server-projection parity', () => {
  assert.deepEqual(
    AI_OPERATIONS_SOURCE_BOUND_PREVIEW,
    projectAiOpsPassiveStatus(),
  );
});

test('AI Operations feature has no client, store, timer, provider, or mutation seam', async () => {
  const sources = await Promise.all([
    readFile(new URL('../../src/pages/AiOperations.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/PassiveAiOperationsStatus.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/PassiveAiOperationsStatus.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/preview/sourceBoundPreview.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/preview/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/preview/preview.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/preview/index.html', import.meta.url), 'utf8'),
  ]);
  const source = sources.join('\n');

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:useEffect|useState|useStore|useProductControlRoomContext)\b/u);
  assert.doesNotMatch(source, /\b(?:Date\.now|Math\.random|setInterval|setTimeout)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:onClick|onSubmit|onChange|mutate|dispatch)\s*=/u);
  assert.doesNotMatch(source, /\/api\/|https?:\/\/|@import\b/u);
});

test('full-size and compact preview contracts remain scoped and visible', async () => {
  const [componentCss, previewCss, previewEntry] = await Promise.all([
    readFile(new URL('../../src/features/aiOperations/PassiveAiOperationsStatus.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/preview/preview.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/aiOperations/preview/main.tsx', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(
    componentCss,
    /(?:^|\n)\s*(?:html|body|:root|#root|\*)\s*(?:,|\{)/u,
  );
  assert.doesNotMatch(
    componentCss,
    /\b(?:display|visibility|content-visibility)\s*:\s*(?:none|hidden)\b/iu,
  );
  assert.match(componentCss, /\.aiop-page\s*\{[^}]*container-type:\s*inline-size;/su);
  assert.match(
    componentCss,
    /\.aiop-summary\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/su,
  );
  assert.match(
    componentCss,
    /@container \(min-width:\s*1260px\)[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u,
  );
  assert.match(
    componentCss,
    /@container \(min-width:\s*1620px\)[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/u,
  );
  assert.match(
    componentCss,
    /@container \(max-width:\s*1260px\)[\s\S]*?\.aiop-summary\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/u,
  );
  assert.match(
    componentCss,
    /@container \(max-width:\s*1080px\)[\s\S]*?\.aiop-content-grid\s*\{\s*grid-template-columns:\s*1fr;/u,
  );
  for (const compactQuery of ['@container (max-width: 660px)', '@media (max-width: 660px)']) {
    const start = componentCss.indexOf(compactQuery);
    assert.notEqual(start, -1);
    const block = componentCss.slice(start);
    assert.match(block, /\.aiop-summary\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u);
    assert.match(block, /white-space:\s*normal;/u);
    assert.match(block, /\.aiop-blocker-list li\s*\{\s*grid-template-columns:\s*1fr;/u);
  }

  assert.doesNotMatch(previewCss, /\.aiop-(?!preview-main\b)/u);
  assert.match(previewEntry, /import '\.\.\/\.\.\/\.\.\/styles\.css';/u);
  assert.match(previewEntry, /import \{ AiOperations \} from '\.\.\/\.\.\/\.\.\/pages\/AiOperations';/u);
  assert.match(previewEntry, /import \{ AI_OPERATIONS_SOURCE_BOUND_PREVIEW \}/u);
  assert.match(previewEntry, /projection=\{AI_OPERATIONS_SOURCE_BOUND_PREVIEW\}/u);
  assert.match(previewEntry, /previewLabel="LOCAL PREVIEW"/u);
});
