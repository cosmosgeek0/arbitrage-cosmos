import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));
let viteServer;
let pageModules;

async function loadPageModules() {
  if (pageModules) return pageModules;
  viteServer = await createServer({
    root: WEB_ROOT,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  const [account, store, provider] = await Promise.all([
    viteServer.ssrLoadModule('/src/pages/Account.tsx'),
    viteServer.ssrLoadModule('/src/store.tsx'),
    viteServer.ssrLoadModule('/src/features/productControlRoom/ProductControlRoomProvider.tsx'),
  ]);
  pageModules = {
    Account: account.Account,
    accountViewContract: account.accountViewContract,
    StoreProvider: store.StoreProvider,
    ProductControlRoomProvider: provider.ProductControlRoomProvider,
  };
  return pageModules;
}

after(async () => {
  await viteServer?.close();
});

const VIEW_CONTRACTS = Object.freeze({
  overview: Object.freeze({ title: 'Account', page: 'account', surfaceId: 'account' }),
  execution: Object.freeze({ title: 'Execution', page: 'execution', surfaceId: 'execution' }),
  orders: Object.freeze({ title: 'Open Orders', page: 'orders', surfaceId: 'orders' }),
  positions: Object.freeze({ title: 'Positions', page: 'positions', surfaceId: 'positions' }),
  fills: Object.freeze({ title: 'Recent Fills', page: 'fills', surfaceId: 'fills' }),
  pnl: Object.freeze({ title: 'PnL', page: 'pnl', surfaceId: 'pnl' }),
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function browserGlobals(pathname) {
  const local = memoryStorage();
  const session = memoryStorage();
  const location = { pathname, origin: 'https://control.example' };
  const style = { zoom: '', setProperty() {} };
  const windowValue = {
    location,
    localStorage: local,
    sessionStorage: session,
    history: {
      pushState(_state, _title, path) { location.pathname = String(path); },
      replaceState(_state, _title, path) { location.pathname = String(path); },
    },
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const documentValue = {
    documentElement: { dataset: {}, style },
    body: { classList: { toggle() {} } },
    querySelector: () => null,
  };
  return { local, session, windowValue, documentValue };
}

async function renderAccount(view) {
  const { Account, StoreProvider, ProductControlRoomProvider } = await loadPageModules();
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  const globals = browserGlobals(view === 'overview' ? '/account' : `/account/${view}`);
  globalThis.window = globals.windowValue;
  globalThis.document = globals.documentValue;
  globalThis.localStorage = globals.local;
  globalThis.sessionStorage = globals.session;
  try {
    return renderToStaticMarkup(
      React.createElement(
        ProductControlRoomProvider,
        {
          client: Object.freeze({}),
          initialMaterialCursor: Object.freeze({ state: 'ABSENT', cursor: null }),
        },
        React.createElement(StoreProvider, null, React.createElement(Account, { view })),
      ),
    );
  } finally {
    globalThis.window = prior.window;
    globalThis.document = prior.document;
    globalThis.localStorage = prior.localStorage;
    globalThis.sessionStorage = prior.sessionStorage;
  }
}

test('Account source preserves every registered canonical read-only mount exactly once', async () => {
  const page = await read('pages/Account.tsx');

  for (const surfaceId of Object.keys(VIEW_CONTRACTS).map((view) => VIEW_CONTRACTS[view].surfaceId)) {
    assert.equal(
      (page.match(new RegExp(`<ProductSurfaceAdapter surfaceId="${surfaceId}" \\/>`, 'g')) ?? []).length,
      1,
      `${surfaceId} must retain exactly one literal canonical mount`,
    );
  }
  assert.match(page, /<ProductSurfaceAdapter surfaceId="account" \/>\s*\n\s*<nav/);
  assert.doesNotMatch(page, /onTrace=|<button[^>]*>\s*(?:Trade|Cancel|Close|Borrow|Repay|Transfer|Withdraw)/i);
});

test('all six Account routes retain distinct read-only titles, pages, and canonical surfaces', async () => {
  const { accountViewContract } = await loadPageModules();
  for (const [view, expected] of Object.entries(VIEW_CONTRACTS)) {
    const actual = accountViewContract(view);
    assert.deepEqual(actual, {
      ...expected,
      readOnly: true,
      actionControls: false,
    });
  }
  assert.equal(new Set(Object.values(VIEW_CONTRACTS).map((entry) => entry.surfaceId)).size, 6);
});

test('Execution renders its canonical read-only projection and never collapses to Overview', async () => {
  const html = await renderAccount('execution');

  assert.match(html, /<h1>Execution<\/h1>/);
  assert.match(html, /Canonical Read-Only Projection/);
  assert.match(html, /id="accountx-panel-execution"/);
  assert.match(html, /id="accountx-tab-execution"[^>]*aria-selected="true"/);
  assert.match(html, /aria-label="account Binding"/);
  assert.match(html, /aria-label="execution Binding"/);
  assert.doesNotMatch(html, /Account Truth Receipt|id="accountx-panel-overview"/);
  assert.doesNotMatch(html, /Execution Capability Unavailable|normalized to Overview/);
});

test('PnL renders its canonical read-only projection and never collapses to Overview', async () => {
  const html = await renderAccount('pnl');

  assert.match(html, /<h1>PnL<\/h1>/);
  assert.match(html, /Canonical Read-Only Projection/);
  assert.match(html, /id="accountx-panel-pnl"/);
  assert.match(html, /id="accountx-tab-pnl"[^>]*aria-selected="true"/);
  assert.match(html, /aria-label="account Binding"/);
  assert.match(html, /aria-label="pnl Binding"/);
  assert.doesNotMatch(html, /Account Truth Receipt|id="accountx-panel-overview"/);
  assert.doesNotMatch(html, /Aggregate PnL Unavailable|normalized to Overview/);
});

test('private-account truth remains fail-closed and page-local controls remain non-mutating', async () => {
  const page = await read('pages/Account.tsx');

  assert.match(page, /privateRead\.state === 'NOT_CONFIGURED'/);
  assert.match(page, /Account Read Not Configured/);
  assert.match(page, /dataset\.exactEmptyCurrent \? '0' : '—'/);
  assert.match(page, /absence is not interpreted as zero/);
  assert.match(page, /A current empty-state claim is not authorized/);
  assert.match(page, /rows === null \? '—' : rows\.length/);
  assert.match(page, /No cross-product valuation is published by private-read v1/);
  assert.match(page, /localStorage\.getItem\('cosmos-balance-mask'\)/);
  assert.match(page, /localStorage\.setItem\('cosmos-balance-mask'/);
  assert.doesNotMatch(page, /\bfetch(?:Json)?\s*\(|XMLHttpRequest|EventSource|new\s+WebSocket/);
  assert.doesNotMatch(page, /\/api\/|method:\s*'POST'|createStore|createClient/);
});
