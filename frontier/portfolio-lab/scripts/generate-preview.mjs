import { readFile, writeFile } from 'node:fs/promises';

import {
  evaluatePortfolioCampaign,
  materializeAcceptanceCampaign,
  projectPortfolioLabCockpit,
} from '../src/index.mjs';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const snapshot = await readJson('../fixtures/portfolio-snapshot.v1.json');
const corpus = await readJson('../fixtures/acceptance-corpus.v1.json');
const { campaign } = materializeAcceptanceCampaign(snapshot, corpus, 1784161200000);
const report = evaluatePortfolioCampaign(snapshot, campaign);
const preview = projectPortfolioLabCockpit(report, 1784161200100);

await writeFile(
  new URL('../preview/portfolio-lab.v1.json', import.meta.url),
  `${JSON.stringify(preview)}\n`,
  'utf8',
);
