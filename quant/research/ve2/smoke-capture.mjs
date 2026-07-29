#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createCoreEvidenceWriter,
  loadCoreMeasurementModule,
} from './evidence-chain.mjs';
import {
  DEFAULT_CORE_REPLAY_MODULE,
  FROZEN_PACKET_RULES,
  verifyPacketPolicyBinding,
} from './replay.mjs';
import { verifyPacket } from './verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const POLICY_PATH = resolve(HERE, 'measurement-policy.v1.json');
const REST_ORIGIN = 'https://data-api.binance.vision';
const WS_ORIGIN = 'wss://data-stream.binance.vision:443';
const EVIDENCE_WS_ENDPOINT = 'wss://data-stream.binance.vision';
const HARD_MAX_DURATION_MS = 20_000;
const HARD_MAX_RECORDS = 5_000;
const HARD_MAX_BYTES = 32 * 1024 * 1024;
const HARD_MAX_GENERATIONS = 2;
const HARD_MAX_REST_REQUESTS = 4;
const HARD_MAX_REST_WEIGHT = 50;
const MAX_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_WS_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_COMBINED_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_SMOKE_TRADE_PROOF = 4_096;

const ALLOWED_SMOKE_REPLAY_REASONS = Object.freeze([
  'DETECTOR_PROPOSAL_EXPIRED',
]);

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactDecimalAtoms(value) {
  if (
    typeof value !== 'string'
    || value.length > 128
    || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
  ) return null;
  const [whole, fraction = ''] = value.split('.');
  let scale = fraction.length;
  let coefficient = BigInt(`${whole}${fraction}`);
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return Object.freeze({ coefficient, scale });
}

function exactDecimalsEqual(left, right) {
  const leftAtoms = exactDecimalAtoms(left);
  const rightAtoms = exactDecimalAtoms(right);
  return leftAtoms !== null
    && rightAtoms !== null
    && leftAtoms.coefficient === rightAtoms.coefficient
    && leftAtoms.scale === rightAtoms.scale;
}

function addExactDecimalAtoms(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return Object.freeze({
    coefficient:
      left.coefficient * (10n ** BigInt(scale - left.scale))
      + right.coefficient * (10n ** BigInt(scale - right.scale)),
    scale,
  });
}

export function aggregateTradeProofExact(aggregate, tradesById) {
  if (
    aggregate?.kind !== 'AGG_TRADE'
    || !(tradesById instanceof Map)
    || !Number.isSafeInteger(aggregate.firstTradeId)
    || !Number.isSafeInteger(aggregate.lastTradeId)
  ) return false;
  const span = aggregate.lastTradeId - aggregate.firstTradeId;
  if (span < 0 || span >= MAX_SMOKE_TRADE_PROOF) return false;
  let quantity = Object.freeze({ coefficient: 0n, scale: 0 });
  for (
    let tradeId = aggregate.firstTradeId;
    tradeId <= aggregate.lastTradeId;
    tradeId += 1
  ) {
    const trade = tradesById.get(tradeId);
    const atoms = exactDecimalAtoms(trade?.quantity);
    if (
      trade?.kind !== 'TRADE'
      || trade.tradeId !== tradeId
      || trade.symbol !== aggregate.symbol
      || trade.generation !== aggregate.generation
      || trade.stream !== `${aggregate.symbol.toLowerCase()}@trade`
      || aggregate.stream !== `${aggregate.symbol.toLowerCase()}@aggTrade`
      || trade.buyerIsMaker !== aggregate.buyerIsMaker
      || !exactDecimalsEqual(trade.price, aggregate.price)
      || trade.tradeTimeMs > aggregate.tradeTimeMs
      || atoms === null
    ) return false;
    quantity = addExactDecimalAtoms(quantity, atoms);
  }
  const expected = exactDecimalAtoms(aggregate.quantity);
  if (expected === null) return false;
  const scale = Math.max(quantity.scale, expected.scale);
  return quantity.coefficient * (10n ** BigInt(scale - quantity.scale))
    === expected.coefficient * (10n ** BigInt(scale - expected.scale));
}

export function smokeProposalPrerequisitesExact({
  aggregateTrade,
  bookTicker,
  depthState,
  evaluatedAtMs,
  evaluatedMonotonicNs,
  tradesById,
}) {
  const bid = depthState?.bids?.[0];
  const ask = depthState?.asks?.[0];
  let evaluatedNs;
  let tickerNs;
  let depthNs;
  try {
    evaluatedNs = BigInt(evaluatedMonotonicNs);
    tickerNs = BigInt(bookTicker?.receivedMonotonicNs);
    depthNs = BigInt(depthState?.lastReceivedMonotonicNs);
  } catch {
    return false;
  }
  return depthState?.status === 'SYNCHRONIZED'
    && depthState?.continuity === 'CONTIGUOUS'
    && Number.isSafeInteger(depthState.lastUpdateId)
    && bid !== undefined
    && ask !== undefined
    && bookTicker?.kind === 'BOOK_TICKER'
    && bookTicker.symbol === aggregateTrade?.symbol
    && bookTicker.generation === aggregateTrade?.generation
    && bookTicker.updateId <= depthState.lastUpdateId
    && exactDecimalsEqual(bookTicker.bidPrice, bid[0])
    && exactDecimalsEqual(bookTicker.bidQuantity, bid[1])
    && exactDecimalsEqual(bookTicker.askPrice, ask[0])
    && exactDecimalsEqual(bookTicker.askQuantity, ask[1])
    && Number.isSafeInteger(evaluatedAtMs)
    && bookTicker.receivedAtMs <= evaluatedAtMs
    && evaluatedAtMs - bookTicker.receivedAtMs <= 2_000
    && depthState.lastReceivedAtMs <= evaluatedAtMs
    && evaluatedAtMs - depthState.lastReceivedAtMs <= 2_000
    && tickerNs <= evaluatedNs
    && evaluatedNs - tickerNs <= 2_000_000_000n
    && depthNs <= evaluatedNs
    && evaluatedNs - depthNs <= 2_000_000_000n
    && aggregateTradeProofExact(aggregateTrade, tradesById);
}

function parseInteger(value, code) {
  invariant(/^[1-9][0-9]*$/.test(value ?? ''), code);
  const parsed = Number(value);
  invariant(Number.isSafeInteger(parsed), code);
  return parsed;
}

export function parseSmokeArgs(argv) {
  const options = {
    durationMs: 5_000,
    maxBytes: 16 * 1024 * 1024,
    maxRecords: 1_000,
    output: null,
    runPublicSmoke: false,
    symbol: 'BTCUSDT',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--run-public-smoke') {
      options.runPublicSmoke = true;
      continue;
    }
    if (
      argument === '--duration-ms'
      || argument === '--max-bytes'
      || argument === '--max-records'
      || argument === '--output'
      || argument === '--symbol'
    ) {
      const value = argv[index + 1];
      invariant(value && !value.startsWith('--'), `VE2_SMOKE_ARGUMENT:${argument}`);
      const key = {
        '--duration-ms': 'durationMs',
        '--max-bytes': 'maxBytes',
        '--max-records': 'maxRecords',
        '--output': 'output',
        '--symbol': 'symbol',
      }[argument];
      options[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`VE2_SMOKE_UNKNOWN_ARGUMENT:${argument}`);
  }

  options.durationMs = parseInteger(
    String(options.durationMs),
    'VE2_SMOKE_DURATION',
  );
  options.maxBytes = parseInteger(
    String(options.maxBytes),
    'VE2_SMOKE_MAX_BYTES',
  );
  options.maxRecords = parseInteger(
    String(options.maxRecords),
    'VE2_SMOKE_MAX_RECORDS',
  );
  return validateSmokeOptions(options);
}

export function validateSmokeOptions(options) {
  invariant(
    options !== null
      && typeof options === 'object'
      && !Array.isArray(options)
      && Object.getPrototypeOf(options) === Object.prototype
      && JSON.stringify(Object.keys(options).sort()) === JSON.stringify([
        'durationMs',
        'maxBytes',
        'maxRecords',
        'output',
        'runPublicSmoke',
        'symbol',
      ]),
    'VE2_SMOKE_OPTIONS_SHAPE',
  );
  invariant(
    Number.isSafeInteger(options.durationMs) && options.durationMs > 0,
    'VE2_SMOKE_DURATION',
  );
  invariant(
    Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0,
    'VE2_SMOKE_MAX_BYTES',
  );
  invariant(
    Number.isSafeInteger(options.maxRecords) && options.maxRecords > 0,
    'VE2_SMOKE_MAX_RECORDS',
  );
  invariant(
    options.durationMs <= HARD_MAX_DURATION_MS,
    'VE2_SMOKE_DURATION_BOUND',
  );
  invariant(options.maxBytes <= HARD_MAX_BYTES, 'VE2_SMOKE_BYTES_BOUND');
  invariant(
    options.maxRecords >= 16 && options.maxRecords <= HARD_MAX_RECORDS,
    'VE2_SMOKE_RECORD_BOUND',
  );
  invariant(/^[A-Z0-9]{5,20}$/.test(options.symbol), 'VE2_SMOKE_SYMBOL');
  invariant(
    typeof options.output === 'string' && options.output.endsWith('.jsonl'),
    'VE2_SMOKE_OUTPUT',
  );
  const resolvedOutput = resolve(options.output);
  const resolvedParent = realpathSync(dirname(resolvedOutput));
  const symlinkResolvedOutput = resolve(
    resolvedParent,
    basename(resolvedOutput),
  );
  invariant(
    symlinkResolvedOutput !== REPO_ROOT
      && !symlinkResolvedOutput.startsWith(`${REPO_ROOT}/`),
    'VE2_SMOKE_OUTPUT_INSIDE_REPOSITORY',
  );
  invariant(options.runPublicSmoke === true, 'VE2_SMOKE_OPT_IN_REQUIRED');
  return Object.freeze({
    ...options,
    output: symlinkResolvedOutput,
  });
}

function createRestBudget() {
  let requests = 0;
  let weight = 0;
  return Object.freeze({
    consume(path) {
      const requestWeight = path.startsWith('/api/v3/exchangeInfo?') ? 20 : 5;
      requests += 1;
      weight += requestWeight;
      invariant(
        requests <= HARD_MAX_REST_REQUESTS,
        'VE2_SMOKE_REST_REQUEST_BOUND',
      );
      invariant(weight <= HARD_MAX_REST_WEIGHT, 'VE2_SMOKE_REST_WEIGHT_BOUND');
    },
    get requests() {
      return requests;
    },
    get weight() {
      return weight;
    },
  });
}

async function readBoundedResponseBody(response, maximumBytes) {
  invariant(response.body !== null, 'VE2_SMOKE_REST_BODY_MISSING');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      invariant(value instanceof Uint8Array, 'VE2_SMOKE_REST_BODY_CHUNK');
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('VE2_SMOKE_REST_RESPONSE_BOUND');
        throw new Error('VE2_SMOKE_REST_RESPONSE_BOUND');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function publicGet(path, writer, symbol, kind, restBudget) {
  invariant(
    /^\/api\/v3\/(?:exchangeInfo|depth)\?/.test(path),
    'VE2_SMOKE_REST_PATH_NOT_ALLOWED',
  );
  restBudget.consume(path);
  const url = new URL(path, REST_ORIGIN);
  invariant(url.origin === REST_ORIGIN, 'VE2_SMOKE_REST_ORIGIN');
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
    headers: {
      accept: 'application/json',
      'user-agent': 'Cosmos-VE2-public-mechanics-smoke/1.0',
    },
  });
  invariant(response.status === 200, `VE2_SMOKE_REST_STATUS:${response.status}`);
  invariant(response.url === url.href, 'VE2_SMOKE_REST_REDIRECT');
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  invariant(
    contentLength === 0 || contentLength <= MAX_HTTP_RESPONSE_BYTES,
    'VE2_SMOKE_REST_CONTENT_LENGTH',
  );
  const rawBytes = await readBoundedResponseBody(
    response,
    MAX_HTTP_RESPONSE_BYTES,
  );
  const localReceivedAtMs = Date.now();
  const localMonotonicNs = process.hrtime.bigint();
  const record = writer.append({
    kind,
    localReceivedAtMs,
    localMonotonicNs,
    rawBytes,
    sourceEndpoint: REST_ORIGIN,
    sourceSymbol: symbol,
    sourceStream: url.pathname,
    sourceTransport: 'BINANCE_SPOT_PUBLIC_REST',
  });
  let parsed;
  try {
    parsed = JSON.parse(rawBytes.toString('utf8'));
  } catch {
    throw new Error(`VE2_SMOKE_REST_JSON:${kind}`);
  }
  return Object.freeze({
    localMonotonicNs,
    localReceivedAtMs,
    parsed,
    rawBytes,
    record,
  });
}

export function buildCombinedWebSocketUrl(symbol) {
  const lower = symbol.toLowerCase();
  const streams = Object.freeze([
    `${lower}@depth@100ms`,
    `${lower}@aggTrade`,
    `${lower}@trade`,
    `${lower}@bookTicker`,
  ]);
  const url = new URL(
    `${WS_ORIGIN}/stream?streams=${streams.join('/')}`,
  );
  invariant(
    url.protocol === 'wss:'
      && url.hostname === 'data-stream.binance.vision'
      && (url.port === '' || url.port === '443')
      && url.pathname === '/stream'
      && url.search === `?streams=${streams.join('/')}`,
    'VE2_SMOKE_WS_ORIGIN',
  );
  invariant(
    !url.searchParams.has('timeUnit'),
    'VE2_SMOKE_TIMESTAMP_MUST_REMAIN_MILLISECONDS',
  );
  return Object.freeze({ streams, url });
}

function utf8(rawBytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error('VE2_SMOKE_COMBINED_UTF8');
  }
}

function skipWhitespace(text, offset) {
  let index = offset;
  while (index < text.length && /[\t\n\r ]/.test(text[index])) index += 1;
  return index;
}

function scanString(text, offset) {
  invariant(text[offset] === '"', 'VE2_SMOKE_COMBINED_STRING');
  let escaped = false;
  for (let index = offset + 1; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') return index + 1;
  }
  throw new Error('VE2_SMOKE_COMBINED_STRING_UNTERMINATED');
}

function scanValue(text, offset) {
  const start = skipWhitespace(text, offset);
  if (text[start] === '"') return scanString(text, start);
  if (text[start] === '{' || text[start] === '[') {
    const stack = [text[start] === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        stack.push('}');
      } else if (character === '[') {
        stack.push(']');
      } else if (character === '}' || character === ']') {
        invariant(
          stack.pop() === character,
          'VE2_SMOKE_COMBINED_VALUE_NESTING',
        );
        if (stack.length === 0) return index + 1;
      }
    }
    throw new Error('VE2_SMOKE_COMBINED_VALUE_UNTERMINATED');
  }
  let end = start;
  while (
    end < text.length
    && text[end] !== ','
    && text[end] !== '}'
    && !/[\t\n\r ]/.test(text[end])
  ) end += 1;
  invariant(end > start, 'VE2_SMOKE_COMBINED_VALUE');
  return end;
}

export function unwrapCombinedStreamPayload(rawInput) {
  const rawBytes = Buffer.from(rawInput);
  const text = utf8(rawBytes);
  let offset = skipWhitespace(text, 0);
  invariant(text[offset] === '{', 'VE2_SMOKE_COMBINED_ROOT');
  offset += 1;
  const fields = new Map();
  while (true) {
    offset = skipWhitespace(text, offset);
    if (text[offset] === '}') {
      offset += 1;
      break;
    }
    const keyStart = offset;
    const keyEnd = scanString(text, keyStart);
    const key = JSON.parse(text.slice(keyStart, keyEnd));
    invariant(!fields.has(key), 'VE2_SMOKE_COMBINED_DUPLICATE_KEY');
    offset = skipWhitespace(text, keyEnd);
    invariant(text[offset] === ':', 'VE2_SMOKE_COMBINED_COLON');
    const valueStart = skipWhitespace(text, offset + 1);
    const valueEnd = scanValue(text, valueStart);
    fields.set(key, { valueEnd, valueStart });
    offset = skipWhitespace(text, valueEnd);
    if (text[offset] === ',') {
      offset += 1;
      continue;
    }
    invariant(text[offset] === '}', 'VE2_SMOKE_COMBINED_SEPARATOR');
  }
  invariant(skipWhitespace(text, offset) === text.length, 'VE2_SMOKE_COMBINED_TRAILING');
  invariant(
    fields.size === 2 && fields.has('stream') && fields.has('data'),
    'VE2_SMOKE_COMBINED_FIELDS',
  );
  const streamRange = fields.get('stream');
  const dataRange = fields.get('data');
  const stream = JSON.parse(
    text.slice(streamRange.valueStart, streamRange.valueEnd),
  );
  invariant(typeof stream === 'string', 'VE2_SMOKE_COMBINED_STREAM');
  const innerText = text.slice(dataRange.valueStart, dataRange.valueEnd);
  const data = JSON.parse(innerText);
  const byteOffset = Buffer.byteLength(text.slice(0, dataRange.valueStart));
  const byteEnd = byteOffset + Buffer.byteLength(innerText);
  const innerBytes = rawBytes.subarray(byteOffset, byteEnd);
  invariant(
    JSON.stringify(JSON.parse(utf8(innerBytes))) === JSON.stringify(data),
    'VE2_SMOKE_COMBINED_INNER_MISMATCH',
  );
  return Object.freeze({
    data,
    innerBytes,
    innerLength: innerBytes.length,
    innerOffset: byteOffset,
    stream,
  });
}

function generationMechanicsExact(generation) {
  return generation.combinedUrlAcknowledged === true
    && generation.captureTruncated === false
    && generation.exchangeInfoCaptured === true
    && generation.pointInTimeEligible === true
    && generation.depthSnapshotCaptured === true
    && generation.depthBridgeExact === true
    && generation.continuityExact === true
    && generation.gapDetected === false
    && generation.invalidFrame === false
    && generation.detectorProposalCaptured === true
    && generation.lifecycleAssertionsCaptured === true
    && generation.streamCounts.depth100ms > 0
    && generation.streamCounts.aggTrade > 0
    && generation.streamCounts.trade > 0
    && generation.streamCounts.bookTicker > 0
    && generation.combinedFrameCount
      === generation.streamCounts.depth100ms
        + generation.streamCounts.aggTrade
        + generation.streamCounts.trade
        + generation.streamCounts.bookTicker
    && generation.streamFrameCount === generation.combinedFrameCount;
}

export function shouldContinueSmokeCapture(generation) {
  return generation.reason !== 'HARD_DURATION_REACHED'
    && generation.reason !== 'SMOKE_MECHANICS_COMPLETE'
    && !generationMechanicsExact(generation);
}

export function classifySmokeMechanics({ generations, replayResult }) {
  const exactGeneration = Array.isArray(generations)
    && generations.some(generationMechanicsExact);
  const reasons = Array.isArray(replayResult?.reasonCodes)
    ? replayResult.reasonCodes
    : ['EVIDENCE_CHAIN_INVALID'];
  const replayReasonsExact = JSON.stringify(reasons)
    === JSON.stringify(ALLOWED_SMOKE_REPLAY_REASONS);
  const sourceFailures = replayReasonsExact ? [] : [...reasons];
  const authorityExact = replayResult?.mode === 'SHADOW_ONLY'
    && replayResult?.recordOnly === true
    && replayResult?.strategyEnabled === false
    && replayResult?.killSwitchEngaged === true
    && replayResult?.submitAuthority === false
    && replayResult?.casAuthority === false
    && replayResult?.privateOrSignedCalls === 0
    && replayResult?.orders === 0
    && replayResult?.transfers === 0
    && replayResult?.withdrawals === 0
    && replayResult?.moneyUsd === 0
    && replayResult?.economics === null
    && replayResult?.profitabilityClaim === false
    && replayResult?.sourceAuthenticity === 'TRUSTED_ANCHOR_MATCHED';
  const exact = exactGeneration && replayReasonsExact && authorityExact;
  return Object.freeze({
    state: exact
      ? 'SMOKE_MECHANICS_EXACT'
      : 'BLOCKED_SMOKE_MECHANICS_INCOMPLETE',
    exact,
    sourceFailures: Object.freeze([...sourceFailures]),
    replayReasonCodes: Object.freeze([...reasons]),
    consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    profitabilityClaim: false,
  });
}

function streamKind(stream, data, symbol) {
  const lower = symbol.toLowerCase();
  if (
    stream === `${lower}@depth@100ms`
    && data?.e === 'depthUpdate'
    && data?.s === symbol
  ) return 'DEPTH_DIFF';
  if (
    stream === `${lower}@aggTrade`
    && data?.e === 'aggTrade'
    && data?.s === symbol
  ) return 'AGG_TRADE';
  if (
    stream === `${lower}@trade`
    && data?.e === 'trade'
    && data?.s === symbol
  ) return 'TRADE';
  if (
    stream === `${lower}@bookTicker`
    && data?.s === symbol
    && data?.u !== undefined
    && data?.b !== undefined
    && data?.B !== undefined
    && data?.a !== undefined
    && data?.A !== undefined
  ) return 'BOOK_TICKER';
  return null;
}

async function captureGeneration({
  coreMeasurement,
  deadlineMs,
  generation,
  options,
  evidenceClosesAtMs,
  outcomeOpensAtMs,
  proposalAdmissionClosesAtMs,
  packetPolicySha256,
  restBudget,
  WebSocket,
  writer,
}) {
  const { streams, url } = buildCombinedWebSocketUrl(options.symbol);
  const openedAtMs = Date.now();
  writer.append({
    kind: 'GENERATION_OPEN',
    localReceivedAtMs: openedAtMs,
    localMonotonicNs: process.hrtime.bigint(),
    rawBytes: Buffer.from(JSON.stringify({
      generation,
      reason: generation === 1 ? 'INITIAL' : 'RECONNECT',
      streamMechanism: 'COMBINED_URL',
      combinedUrl: url.href,
      streams,
      timestampUnit: 'MILLISECOND',
    })),
  });
  const configurationRevision = 've2-smoke-v1';
  const configRaw = Buffer.from(JSON.stringify({
    purpose: 'SMOKE_MECHANICS_ONLY',
    symbol: options.symbol,
    configurationRevision,
    enabled: false,
    killSwitchEngaged: true,
    mode: 'SHADOW_ONLY',
    recordOnly: true,
    timestampUnit: 'MILLISECOND',
    depthLimit: 100,
    streamMechanism: 'COMBINED_URL',
    combinedUrl: url.href,
    proposalAdmissionClosesAtMs,
    evidenceClosesAtMs,
    measurementPolicySha256: packetPolicySha256,
    measurementPolicyId: 'VOLUME_MEASUREMENT_MAX_HOLD_60S_V1',
    frozenMeasurementRules: FROZEN_PACKET_RULES,
    profitabilityClaim: 'FORBIDDEN',
  }));
  const configReceivedAtMs = Date.now();
  const configReceivedMonotonicNs = process.hrtime.bigint();
  const configRecord = writer.append({
    kind: 'CONFIG_STATE',
    localReceivedAtMs: configReceivedAtMs,
    localMonotonicNs: configReceivedMonotonicNs,
    rawBytes: configRaw,
  });
  const killRaw = Buffer.from(JSON.stringify({
    engaged: true,
    submitAuthority: false,
    casAuthority: false,
    privateOrSignedAuthority: false,
  }));
  const killReceivedAtMs = Date.now();
  const killReceivedMonotonicNs = process.hrtime.bigint();
  const killRecord = writer.append({
    kind: 'KILL_STATE',
    localReceivedAtMs: killReceivedAtMs,
    localMonotonicNs: killReceivedMonotonicNs,
    rawBytes: killRaw,
  });
  const exchange = await publicGet(
    `/api/v3/exchangeInfo?symbol=${encodeURIComponent(options.symbol)}`,
    writer,
    options.symbol,
    'EXCHANGE_INFO',
    restBudget,
  );
  invariant(
    Array.isArray(exchange.parsed.symbols)
      && exchange.parsed.symbols.length === 1
      && exchange.parsed.symbols[0].symbol === options.symbol,
    'VE2_SMOKE_EXCHANGE_INFO_SYMBOL',
  );
  const exchangeCut = coreMeasurement.parseVolumeForwardExchangeInfo({
    rawPayload: exchange.rawBytes,
    symbol: options.symbol,
    generation,
    receivedMonotonicNs: String(exchange.localMonotonicNs),
    receivedAtMs: exchange.localReceivedAtMs,
  });
  invariant(
    exchangeCut.status === 'TRADING'
      && exchangeCut.quoteAsset === 'USDT'
      && exchangeCut.spotTradingAllowed === true,
    'VE2_SMOKE_SYMBOL_NOT_POINT_IN_TIME_ELIGIBLE',
  );
  const controlsCapturedAtMs = Math.max(
    configReceivedAtMs,
    killReceivedAtMs,
    exchange.localReceivedAtMs,
  );
  const controlsReceivedMonotonicNs = [
    configReceivedMonotonicNs,
    killReceivedMonotonicNs,
    exchange.localMonotonicNs,
  ].reduce((latest, candidate) => candidate > latest ? candidate : latest);
  const pointInTimeControls =
    coreMeasurement.buildVolumeForwardPointInTimeControls({
      capturedAtMs: controlsCapturedAtMs,
      configurationDigest: configRecord.header.rawSha256,
      configurationRevision,
      enabled: false,
      filterDigest: exchange.record.header.rawSha256,
      killStateDigest: killRecord.header.rawSha256,
      killSwitchEngaged: true,
      receivedMonotonicNs: String(controlsReceivedMonotonicNs),
    });

  const mutable = {
    combinedFrameBytes: 0,
    combinedFrameLedger: [],
    combinedUrlAcknowledged: false,
    captureTruncated: false,
    continuityExact: false,
    continuityRecordCount: 0,
    depthBridgeExact: false,
    depthSnapshotCaptured: false,
    detectorProposalCaptured: false,
    exchangeInfoCaptured: true,
    gapDetected: false,
    generation,
    invalidFrame: false,
    latestAggregateTrade: null,
    latestBookTicker: null,
    latestSourceReceivedAtMs: exchange.localReceivedAtMs,
    latestSourceReceivedMonotonicNs: exchange.localMonotonicNs,
    latestSourceRecordHash: exchange.record.recordHash,
    lifecycleAssertionsCaptured: false,
    pointInTimeEligible: true,
    proposalFeatureCut: null,
    proposalPending: false,
    streamFrameCount: 0,
    streamCounts: {
      depth100ms: 0,
      aggTrade: 0,
      trade: 0,
      bookTicker: 0,
    },
    tradesById: new Map(),
  };
  let depthState = coreMeasurement.createVolumeForwardDepthState({
    symbol: options.symbol,
    generation,
  });
  let proposalRecord = null;

  return await new Promise((resolveGeneration, rejectGeneration) => {
    let closeReason = 'REMOTE_CLOSE';
    let opened = false;
    let settled = false;
    let snapshotPromise = null;
    let proposalTimer = null;
    const socket = new WebSocket(url, {
      followRedirects: false,
      handshakeTimeout: 5_000,
      maxPayload: MAX_WS_MESSAGE_BYTES,
      maxRedirects: 0,
      perMessageDeflate: true,
      headers: {
        'user-agent': 'Cosmos-VE2-public-mechanics-smoke/1.0',
      },
    });

    const remainingMs = Math.max(1, deadlineMs - Date.now());
    const stopTimer = setTimeout(() => {
      closeReason = 'HARD_DURATION_REACHED';
      socket.resume();
      socket.close(1000, 'bounded mechanics smoke complete');
    }, remainingMs);

    function appendContinuity({
      combinedFrames = [],
      finalUpdateId,
      firstUpdateId,
      previousFinalUpdateId,
      reason,
      state = 'CONTIGUOUS',
    }) {
      const localReceivedAtMs = Date.now();
      const localMonotonicNs = process.hrtime.bigint();
      const record = writer.append({
        kind: 'CONTINUITY',
        localReceivedAtMs,
        localMonotonicNs,
        rawBytes: Buffer.from(JSON.stringify({
          state,
          generation,
          previousFinalUpdateId,
          firstUpdateId,
          finalUpdateId,
          combinedFrames,
          silentGapFill: false,
          ...(reason === undefined ? {} : { reason }),
        })),
      });
      mutable.latestSourceReceivedAtMs = localReceivedAtMs;
      mutable.latestSourceReceivedMonotonicNs = localMonotonicNs;
      mutable.latestSourceRecordHash = record.recordHash;
      mutable.continuityRecordCount += 1;
      if (state === 'CONTIGUOUS') {
        mutable.continuityExact = true;
        mutable.depthBridgeExact = true;
      }
    }

    function appendIncompleteContinuity(reason, force = false) {
      if (mutable.continuityRecordCount > 0 && !force) return;
      appendContinuity({
        state: 'INCOMPLETE',
        previousFinalUpdateId: 0,
        firstUpdateId: 0,
        finalUpdateId: 0,
        combinedFrames: [],
        reason,
      });
    }

    function maybeAppendSmokeProposal() {
      if (
        proposalRecord !== null
        || mutable.proposalPending
        || !mutable.combinedUrlAcknowledged
        || !mutable.depthSnapshotCaptured
        || !mutable.depthBridgeExact
        || mutable.gapDetected
        || Date.now() < outcomeOpensAtMs
        || Date.now() + 2 >= deadlineMs
        || Object.values(mutable.streamCounts).some((count) => count === 0)
        || !smokeProposalPrerequisitesExact({
          aggregateTrade: mutable.latestAggregateTrade,
          bookTicker: mutable.latestBookTicker,
          depthState,
          evaluatedAtMs: mutable.latestSourceReceivedAtMs,
          evaluatedMonotonicNs:
            String(mutable.latestSourceReceivedMonotonicNs),
          tradesById: mutable.tradesById,
        })
      ) return;
      mutable.proposalFeatureCut = Object.freeze({
        receivedAtMs: mutable.latestSourceReceivedAtMs,
        receivedMonotonicNs:
          String(mutable.latestSourceReceivedMonotonicNs),
        sourceRecordHash: mutable.latestSourceRecordHash,
      });
      mutable.proposalPending = true;
      socket.pause();
      const expiresAtMs = mutable.proposalFeatureCut.receivedAtMs + 1;
      const waitMs = Math.max(0, expiresAtMs - Date.now() + 1);
      proposalTimer = setTimeout(() => {
        proposalTimer = null;
        if (settled || proposalRecord !== null) return;
        try {
          const localReceivedAtMs = Date.now();
          invariant(
            localReceivedAtMs > expiresAtMs,
            'VE2_SMOKE_PROPOSAL_NOT_PROSPECTIVELY_EXPIRED',
          );
          invariant(
            localReceivedAtMs < deadlineMs
              && localReceivedAtMs < proposalAdmissionClosesAtMs,
            'VE2_SMOKE_PROPOSAL_ADMISSION_CLOSED',
          );
          const localMonotonicNs = process.hrtime.bigint();
          const unique = randomUUID().replaceAll('-', '');
          const proposal =
            coreMeasurement.buildVolumeForwardDetectorProposalBinding({
              proposalId: `smokedetectorproposal_${unique}`,
              proposalRevision: 1,
              proposalDigest: `smokedetectorproposaldigest_${unique}`,
              configurationRevision,
              configurationDigest: pointInTimeControls.configurationDigest,
              controlsCapturedAtMs: pointInTimeControls.capturedAtMs,
              controlsReceivedMonotonicNs:
                pointInTimeControls.receivedMonotonicNs,
              correlationId: `smokecorrelation_${unique}`,
              symbol: options.symbol,
              direction: 'long',
              updatedTs: mutable.proposalFeatureCut.receivedAtMs,
              featureObservedAtMs: mutable.proposalFeatureCut.receivedAtMs,
              expiresAtMs,
              detectorDecisionDigest: `smokedetectordecision_${unique}`,
              featureDigest:
                `smokefeature_${mutable.proposalFeatureCut.sourceRecordHash.slice(7)}`,
              filterDigest: exchange.record.header.rawSha256,
              killStateDigest: killRecord.header.rawSha256,
              generation,
              receivedMonotonicNs: String(localMonotonicNs),
            }, pointInTimeControls);
          proposalRecord = writer.append({
            kind: 'DETECTOR_PROPOSAL',
            localReceivedAtMs,
            localMonotonicNs,
            rawBytes: Buffer.from(JSON.stringify({
              purpose: 'SMOKE_MECHANICS_ONLY',
              excludedFromScoredSample: true,
              proposal,
            })),
          });
          const observedLifecycleRecord = writer.append({
            kind: 'LIFECYCLE_RECORD',
            localReceivedAtMs: Date.now(),
            localMonotonicNs: process.hrtime.bigint(),
            rawBytes: Buffer.from(JSON.stringify({
              mode: 'SHADOW_RECORD_ONLY',
              previousLifecycleRecordHash: null,
              proposalDigest: proposal.proposalDigest,
              proposalId: proposal.proposalId,
              sourceRecordHash: proposalRecord.recordHash,
              state: 'OBSERVED',
              transitionRevision: 1,
            })),
          });
          writer.append({
            kind: 'LIFECYCLE_RECORD',
            localReceivedAtMs: Date.now(),
            localMonotonicNs: process.hrtime.bigint(),
            rawBytes: Buffer.from(JSON.stringify({
              mode: 'SHADOW_RECORD_ONLY',
              previousLifecycleRecordHash:
                observedLifecycleRecord.recordHash,
              proposalDigest: proposal.proposalDigest,
              proposalId: proposal.proposalId,
              reasonCodes: ['DETECTOR_PROPOSAL_EXPIRED'],
              sourceRecordHash: proposalRecord.recordHash,
              state: 'BLOCKED',
              transitionRevision: 2,
            })),
          });
          mutable.detectorProposalCaptured = true;
          mutable.lifecycleAssertionsCaptured = true;
          mutable.proposalPending = false;
          closeReason = 'SMOKE_MECHANICS_COMPLETE';
          socket.resume();
          socket.close(1000, 'smoke mechanics exact');
        } catch (error) {
          rejectOnce(error);
        }
      }, waitMs);
    }

    function applySnapshot(snapshot) {
      const parsed = coreMeasurement.parseVolumeForwardDepthSnapshot({
        rawPayload: snapshot.rawBytes,
        symbol: options.symbol,
        generation,
        receivedMonotonicNs: String(snapshot.localMonotonicNs),
        receivedAtMs: snapshot.localReceivedAtMs,
      });
      invariant(
        Number.isSafeInteger(parsed.lastUpdateId),
        'VE2_SMOKE_DEPTH_UPDATE_ID',
      );
      const priorRanges = depthState.updateRanges.length;
      depthState = coreMeasurement.applyVolumeForwardDepthInput(
        depthState,
        parsed,
      );
      mutable.depthSnapshotCaptured = true;
      if (
        depthState.status === 'GAPPED'
        || depthState.continuity === 'GAP_DETECTED'
      ) {
        mutable.gapDetected = true;
        closeReason = 'DEPTH_GAP_DETECTED';
        socket.close(1012, 'depth gap requires new generation');
        return;
      }
      if (
        depthState.status === 'SYNCHRONIZED'
        && depthState.continuity === 'CONTIGUOUS'
        && depthState.updateRanges.length > priorRanges
      ) {
        const applied = depthState.updateRanges.slice(priorRanges);
        const appliedFrameHashes = applied.map((range) => {
          const matched = mutable.combinedFrameLedger.find((frame) => (
            frame.stream.endsWith('@depth@100ms')
            && frame.firstUpdateId === range.firstUpdateId
            && frame.finalUpdateId === range.finalUpdateId
            && frame.localMonotonicNs === range.receivedMonotonicNs
          ));
          invariant(
            matched !== undefined,
            'VE2_SMOKE_APPLIED_DEPTH_FRAME_MISSING',
          );
          return matched.rawSha256;
        });
        const first = applied[0];
        const latest = applied.at(-1);
        invariant(
          first !== undefined && latest !== undefined,
          'VE2_SMOKE_APPLIED_DEPTH_RANGE_MISSING',
        );
        appendContinuity({
          previousFinalUpdateId: parsed.lastUpdateId,
          firstUpdateId: first.firstUpdateId,
          finalUpdateId: latest.finalUpdateId,
          combinedFrames: appliedFrameHashes,
        });
      }
      maybeAppendSmokeProposal();
    }

    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer);
      if (proposalTimer !== null) clearTimeout(proposalTimer);
      try {
        socket.terminate();
      } catch {
        // The socket may already be closed.
      }
      rejectGeneration(error);
    }

    socket.once('open', () => {
      opened = true;
      mutable.combinedUrlAcknowledged = true;
      snapshotPromise = publicGet(
        `/api/v3/depth?symbol=${encodeURIComponent(options.symbol)}&limit=100`,
        writer,
        options.symbol,
        'DEPTH_SNAPSHOT',
        restBudget,
      ).then(applySnapshot);
      snapshotPromise.catch(rejectOnce);
    });

    socket.on('message', (data) => {
      if (settled) return;
      const localReceivedAtMs = Date.now();
      const localMonotonicNs = process.hrtime.bigint();
      try {
        const rawBytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const frameRecord = writer.append({
          kind: 'STREAM_FRAME',
          localReceivedAtMs,
          localMonotonicNs,
          rawBytes,
          sourceEndpoint: EVIDENCE_WS_ENDPOINT,
          sourceSymbol: options.symbol,
          sourceStream: null,
          sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
        });
        mutable.streamFrameCount += 1;
        mutable.combinedFrameBytes += rawBytes.length;
        if (writer.recordCount + 11 >= options.maxRecords) {
          mutable.captureTruncated = true;
          mutable.invalidFrame = true;
          closeReason = 'CAPTURE_RECORD_BOUND_REACHED';
          appendIncompleteContinuity(closeReason, true);
          socket.close(1000, 'capture record bound reached');
          return;
        }
        invariant(
          rawBytes.length <= MAX_WS_MESSAGE_BYTES,
          'VE2_SMOKE_WS_MESSAGE_BOUND',
        );
        if (
          mutable.combinedFrameBytes
            > Math.min(
              MAX_COMBINED_LEDGER_BYTES,
              Math.floor(options.maxBytes / 3),
            )
        ) {
          mutable.captureTruncated = true;
          mutable.invalidFrame = true;
          closeReason = 'CAPTURE_BYTE_BOUND_REACHED';
          appendIncompleteContinuity(closeReason, true);
          socket.close(1000, 'capture byte bound reached');
          return;
        }
        const combined = unwrapCombinedStreamPayload(rawBytes);
        invariant(
          streams.includes(combined.stream),
          'VE2_SMOKE_WS_STREAM_NOT_ALLOWED',
        );
        const kind = streamKind(combined.stream, combined.data, options.symbol);
        invariant(kind !== null, 'VE2_SMOKE_WS_STREAM_PAYLOAD_MISMATCH');
        const parsedPublic =
          coreMeasurement.parseVolumeForwardPublicPayload({
            rawPayload: rawBytes,
            generation,
            receivedMonotonicNs: String(localMonotonicNs),
            receivedAtMs: localReceivedAtMs,
            sourceStream: combined.stream,
          });
        invariant(
          parsedPublic.kind === kind,
          'VE2_SMOKE_PUBLIC_KIND_MISMATCH',
        );
        const streamRecord = writer.append({
          kind,
          localReceivedAtMs,
          localMonotonicNs,
          rawBytes,
          sourceEndpoint: EVIDENCE_WS_ENDPOINT,
          sourceSymbol: options.symbol,
          sourceStream: combined.stream,
          sourceTransport: 'BINANCE_SPOT_PUBLIC_STREAM',
        });
        invariant(
          frameRecord.header.rawSha256 === streamRecord.header.rawSha256
            && streamRecord.header.rawSha256 === `sha256:${sha256(rawBytes)}`
            && streamRecord.header.sourceStream === combined.stream,
          'VE2_SMOKE_COMBINED_EVIDENCE_BINDING',
        );
        const ledgerEntry = Object.freeze({
          stream: combined.stream,
          localReceivedAtMs,
          localMonotonicNs: String(localMonotonicNs),
          rawSha256: sha256(rawBytes),
          frameRecordHash: frameRecord.recordHash,
          evidenceRawSha256: streamRecord.header.rawSha256,
          evidenceRecordHash: streamRecord.recordHash,
          innerOffset: combined.innerOffset,
          innerLength: combined.innerLength,
          innerSha256: sha256(combined.innerBytes),
          ...(parsedPublic.kind !== 'DEPTH_DIFF'
            ? {}
            : {
                firstUpdateId: parsedPublic.firstUpdateId,
                finalUpdateId: parsedPublic.finalUpdateId,
              }),
        });
        mutable.combinedFrameLedger.push(ledgerEntry);
        mutable.latestSourceReceivedAtMs = localReceivedAtMs;
        mutable.latestSourceReceivedMonotonicNs = localMonotonicNs;
        mutable.latestSourceRecordHash = streamRecord.recordHash;

        if (kind === 'DEPTH_DIFF') {
          mutable.streamCounts.depth100ms += 1;
          const parsed = parsedPublic;
          invariant(
            parsed.kind === 'DEPTH_DIFF',
            'VE2_SMOKE_DEPTH_PARSE_MISSING',
          );
          const previousFinalUpdateId = depthState.lastUpdateId;
          const priorRevision = depthState.sourceRevision;
          depthState = coreMeasurement.applyVolumeForwardDepthInput(
            depthState,
            parsed,
          );
          if (
            depthState.status === 'GAPPED'
            || depthState.continuity === 'GAP_DETECTED'
          ) {
            mutable.gapDetected = true;
            appendContinuity({
              state: 'GAP_DETECTED',
              previousFinalUpdateId: previousFinalUpdateId ?? 0,
              firstUpdateId: parsed.firstUpdateId,
              finalUpdateId: parsed.finalUpdateId,
              combinedFrames: [ledgerEntry.rawSha256],
            });
            closeReason = 'DEPTH_GAP_DETECTED';
            socket.close(1012, 'depth gap requires new generation');
            return;
          }
          if (
            depthState.status === 'SYNCHRONIZED'
            && depthState.continuity === 'CONTIGUOUS'
            && depthState.sourceRevision > priorRevision
          ) {
            appendContinuity({
              previousFinalUpdateId:
                previousFinalUpdateId ?? depthState.snapshotLastUpdateId,
              firstUpdateId: parsed.firstUpdateId,
              finalUpdateId: parsed.finalUpdateId,
              combinedFrames: [ledgerEntry.rawSha256],
            });
          }
        } else if (kind === 'AGG_TRADE') {
          mutable.streamCounts.aggTrade += 1;
          invariant(
            parsedPublic.kind === 'AGG_TRADE',
            'VE2_SMOKE_AGG_TRADE_PARSE_MISSING',
          );
          if (
            mutable.latestAggregateTrade?.aggregateTradeId
              !== parsedPublic.aggregateTradeId
          ) mutable.proposalFeatureCut = null;
          mutable.latestAggregateTrade = parsedPublic;
        } else if (kind === 'TRADE') {
          mutable.streamCounts.trade += 1;
          invariant(
            parsedPublic.kind === 'TRADE',
            'VE2_SMOKE_TRADE_PARSE_MISSING',
          );
          mutable.tradesById.set(parsedPublic.tradeId, parsedPublic);
          while (mutable.tradesById.size > MAX_SMOKE_TRADE_PROOF) {
            const oldest = mutable.tradesById.keys().next().value;
            if (!Number.isSafeInteger(oldest)) break;
            mutable.tradesById.delete(oldest);
          }
        } else {
          mutable.streamCounts.bookTicker += 1;
          invariant(
            parsedPublic.kind === 'BOOK_TICKER',
            'VE2_SMOKE_BOOK_TICKER_PARSE_MISSING',
          );
          mutable.latestBookTicker = parsedPublic;
        }
        maybeAppendSmokeProposal();
      } catch (error) {
        mutable.invalidFrame = true;
        closeReason = `FRAME_REJECTED:${error?.message ?? String(error)}`;
        try {
          socket.close(1002, 'frame rejected');
        } catch {
          rejectOnce(error);
        }
      }
    });

    socket.once('unexpected-response', (_request, response) => {
      rejectOnce(
        new Error(`VE2_SMOKE_WS_UNEXPECTED_RESPONSE:${response.statusCode}`),
      );
    });
    socket.once('error', rejectOnce);
    socket.once('close', async (code) => {
      if (settled) return;
      try {
        clearTimeout(stopTimer);
        if (proposalTimer !== null) clearTimeout(proposalTimer);
        mutable.proposalPending = false;
        if (snapshotPromise !== null) await snapshotPromise;
        appendIncompleteContinuity(closeReason);
        const terminal = {
          generation,
          opened,
          closeCode: code,
          reason: closeReason,
          continuity:
            mutable.continuityExact
              && !mutable.gapDetected
              && !mutable.invalidFrame
            ? 'CONTIGUOUS'
            : 'REJECTED_NO_SILENT_FILL',
          combinedUrlAcknowledged: mutable.combinedUrlAcknowledged,
          captureTruncated: mutable.captureTruncated,
          combinedUrl: url.href,
          combinedFrameLedger: mutable.combinedFrameLedger,
          streamCounts: mutable.streamCounts,
          depthSnapshotCaptured: mutable.depthSnapshotCaptured,
          depthBridgeExact: mutable.depthBridgeExact,
          gapDetected: mutable.gapDetected,
          invalidFrame: mutable.invalidFrame,
          streamFrameCount: mutable.streamFrameCount,
          lifecycleAssertionsCaptured:
            mutable.lifecycleAssertionsCaptured,
          detectorProposalRecordHash: proposalRecord?.recordHash ?? null,
        };
        writer.append({
          kind: 'GENERATION_CLOSE',
          localReceivedAtMs: Date.now(),
          localMonotonicNs: process.hrtime.bigint(),
          rawBytes: Buffer.from(JSON.stringify(terminal)),
        });
        settled = true;
        resolveGeneration(Object.freeze({
          combinedFrameBytes: mutable.combinedFrameBytes,
          combinedFrameCount: mutable.combinedFrameLedger.length,
          combinedUrlAcknowledged: mutable.combinedUrlAcknowledged,
          captureTruncated: mutable.captureTruncated,
          continuityExact: mutable.continuityExact,
          continuityRecordCount: mutable.continuityRecordCount,
          depthBridgeExact: mutable.depthBridgeExact,
          depthSnapshotCaptured: mutable.depthSnapshotCaptured,
          detectorProposalCaptured: mutable.detectorProposalCaptured,
          exchangeInfoCaptured: mutable.exchangeInfoCaptured,
          gapDetected: mutable.gapDetected,
          invalidFrame: mutable.invalidFrame,
          generation,
          lifecycleAssertionsCaptured:
            mutable.lifecycleAssertionsCaptured,
          pointInTimeEligible: mutable.pointInTimeEligible,
          reason: closeReason,
          streamFrameCount: mutable.streamFrameCount,
          streamCounts: Object.freeze({ ...mutable.streamCounts }),
        }));
      } catch (error) {
        rejectOnce(error);
      }
    });
  });
}

export async function runPublicSmoke(options) {
  options = validateSmokeOptions(options);
  verifyPacket(HERE, REPO_ROOT);
  const policyBytes = readFileSync(POLICY_PATH);
  const policy = JSON.parse(policyBytes);
  invariant(policy.defaults.strategyEnabled === false, 'VE2_SMOKE_DEFAULT_OFF');
  invariant(policy.defaults.killSwitchEngaged === true, 'VE2_SMOKE_KILL_ON');
  invariant(policy.economics.smokeEconomics === 'FORBIDDEN', 'VE2_SMOKE_ECONOMICS');
  invariant(
    options.symbol === policy.universe.smokeSymbol,
    'VE2_SMOKE_POLICY_SYMBOL_MISMATCH',
  );

  const { default: WebSocket } = await import('ws');
  const coreMeasurement = await loadCoreMeasurementModule();
  const policyReceivedAtMs = Date.now();
  const policyReceivedMonotonicNs = process.hrtime.bigint();
  const smokeFrozenAtMs = policyReceivedAtMs;
  const smokeOutcomeOpensAtMs = smokeFrozenAtMs + 250;
  const smokeOutcomeClosesAtMs =
    smokeOutcomeOpensAtMs + options.durationMs;
  const smokeEvidenceClosesAtMs = smokeOutcomeClosesAtMs + 62_000;
  const smokeCorePolicy = coreMeasurement.buildVolumeForwardMeasurementPolicy({
    policyId: policy.policyId,
    policyRevision: 1,
    symbol: options.symbol,
    frozenAtMs: smokeFrozenAtMs,
    outcomeOpensAtMs: smokeOutcomeOpensAtMs,
    outcomeClosesAtMs: smokeOutcomeClosesAtMs,
    evidenceClosesAtMs: smokeEvidenceClosesAtMs,
    streams: [
      `${options.symbol.toLowerCase()}@aggTrade`,
      `${options.symbol.toLowerCase()}@bookTicker`,
      `${options.symbol.toLowerCase()}@depth@100ms`,
      `${options.symbol.toLowerCase()}@trade`,
    ],
    config: {
      enabled: false,
      killSwitchEngaged: true,
    },
  });
  const evidencePolicyBytes = Buffer.from(JSON.stringify(smokeCorePolicy), 'utf8');
  const packetPolicySha256 = sha256(policyBytes);
  const writer = await createCoreEvidenceWriter({
    chainId: `ve2-smoke-${randomUUID()}`,
    maxBytes: options.maxBytes,
    maxRecords: options.maxRecords,
    outputPath: options.output,
    policyBytes: evidencePolicyBytes,
    policyReceivedAtMs,
    policyReceivedMonotonicNs,
  });
  const deadlineMs = Date.now() + options.durationMs;
  const generations = [];
  const restBudget = createRestBudget();

  try {
    while (
      Date.now() < deadlineMs
      && generations.length < HARD_MAX_GENERATIONS
    ) {
      const generation = generations.length + 1;
      const result = await captureGeneration({
        coreMeasurement,
        deadlineMs,
        generation,
        options,
        evidenceClosesAtMs: smokeEvidenceClosesAtMs,
        outcomeOpensAtMs: smokeOutcomeOpensAtMs,
        proposalAdmissionClosesAtMs: smokeOutcomeClosesAtMs,
        packetPolicySha256,
        restBudget,
        WebSocket,
        writer,
      });
      generations.push(result);
      if (!shouldContinueSmokeCapture(result)) break;
    }

    const completeMeasurement = generations.some(generationMechanicsExact);
    const verification = writer.seal({
      localReceivedAtMs: Date.now(),
      localMonotonicNs: process.hrtime.bigint(),
      rawBytes: Buffer.from(JSON.stringify({
        state: completeMeasurement
          ? 'COMPLETE_MECHANICS_BUNDLE'
          : 'INCOMPLETE_MECHANICS_BUNDLE',
        purpose: 'SMOKE_MECHANICS_ONLY',
        profitabilityClaim: 'FORBIDDEN',
        consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
      })),
      verificationProfile: completeMeasurement
        ? 'COMPLETE_MEASUREMENT'
        : 'INCOMPLETE_PRESERVATION',
    });
    const packetBinding = completeMeasurement
      ? verifyPacketPolicyBinding(
          writer.core,
          verification,
          policyBytes,
          policy,
        )
      : null;
    invariant(
      packetBinding === null
        || packetBinding.configBindingCount === generations.length,
      'VE2_SMOKE_PACKET_POLICY_BINDING_COUNT',
    );

    const imported = await import(pathToFileURL(DEFAULT_CORE_REPLAY_MODULE).href);
    invariant(
      typeof imported.replayVolumeForwardMeasurementEvidence === 'function',
      'VE2_SMOKE_CORE_REPLAY_EXPORT',
    );
    const replayResult =
      imported.replayVolumeForwardMeasurementEvidence({
        evidenceRecords: writer.records,
        expectedPolicyDigest: verification.policyDigest,
        expectedTerminalHash: verification.terminalHash,
      });
    const classification = classifySmokeMechanics({
      generations,
      replayResult,
    });
    return Object.freeze({
      chainId: verification.chainId,
      records: writer.recordCount,
      bytes: writer.bytesWritten,
      generations: Object.freeze([...generations]),
      publicRestRequests: restBudget.requests,
      publicRestWeight: restBudget.weight,
      terminalRecordHash: verification.terminalHash,
      state: classification.state,
      sourceFailures: classification.sourceFailures,
      replayReasonCodes: classification.replayReasonCodes,
      packetPolicyBindingCount:
        packetBinding?.configBindingCount ?? 0,
      consumerGate: classification.consumerGate,
      profitabilityClaim: false,
    });
  } catch (error) {
    try {
      if (writer.cursor.generationOpen) {
        writer.append({
          kind: 'CONTINUITY',
          localReceivedAtMs: Date.now(),
          localMonotonicNs: process.hrtime.bigint(),
          rawBytes: Buffer.from(JSON.stringify({
            state: 'INCOMPLETE',
            generation: writer.cursor.generation,
            reason: 'SMOKE_ABORTED',
            silentGapFill: false,
          })),
        });
        writer.append({
          kind: 'GENERATION_CLOSE',
          localReceivedAtMs: Date.now(),
          localMonotonicNs: process.hrtime.bigint(),
          rawBytes: Buffer.from(JSON.stringify({
            generation: writer.cursor.generation,
            reason: 'SMOKE_ABORTED',
            continuity: 'REJECTED_NO_SILENT_FILL',
          })),
        });
      }
      if (!writer.cursor.sealed) {
        writer.seal({
          localReceivedAtMs: Date.now(),
          localMonotonicNs: process.hrtime.bigint(),
          rawBytes: Buffer.from(JSON.stringify({
            purpose: 'SMOKE_MECHANICS_ONLY',
            state: 'ABORTED',
            profitabilityClaim: 'FORBIDDEN',
            consumerGate: 'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
          })),
          verificationProfile: 'INCOMPLETE_PRESERVATION',
        });
      }
    } catch {
      // Preserve the original failure. Replay rejects an unsealed partial file.
    }
    throw error;
  } finally {
    writer.close();
  }
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = parseSmokeArgs(process.argv.slice(2));
  const result = await runPublicSmoke(options);
  process.stdout.write(
    `VE2_SMOKE ${result.state} records=${result.records}`
      + ` generations=${result.generations.length} gate=${result.consumerGate}\n`,
  );
  if (result.state !== 'SMOKE_MECHANICS_EXACT') process.exitCode = 2;
}
