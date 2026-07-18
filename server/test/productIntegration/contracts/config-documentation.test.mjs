import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const envExample = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');
const liveAppEnvTemplate = readFileSync(
  new URL('../../../../ops/live/env/cosmos-app.env.template', import.meta.url),
  'utf8',
);
const rootReadme = readFileSync(new URL('../../../../README.md', import.meta.url), 'utf8');

test('current keyless composition neither solicits Binance credentials nor advertises private capability', () => {
  assert.doesNotMatch(envExample, /^BINANCE_API_(?:KEY|SECRET)=/mu);
  assert.doesNotMatch(envExample, /^BINANCE_(?:KEY|FULL_KEY)_IPS=/mu);

  assert.match(rootReadme, /public-only and keyless/iu);
  assert.match(rootReadme, /Do not add credentials/iu);
  assert.doesNotMatch(rootReadme, /Private Binance account cockpit/iu);
  assert.doesNotMatch(rootReadme, /Binance keys server-side only/iu);
});

test('owner-gated AWS notification intake is absent from operator configuration documentation', () => {
  for (const configuration of [envExample, liveAppEnvTemplate]) {
    assert.doesNotMatch(configuration, /NOTIFICATION_AWS_INGEST_TOKEN/u);
    assert.doesNotMatch(configuration, /notification ingest/iu);
  }

  assert.doesNotMatch(rootReadme, /AWS notification intake/iu);
  assert.doesNotMatch(rootReadme, /own bearer token/iu);
});
