import express, { type NextFunction, type Request, type Response } from 'express';
import { gzip as gzipCallback } from 'node:zlib';
import { promisify } from 'node:util';
import type { ProductIntegrationRuntimeService } from './service.js';
import { isProductRuntimeCursor } from './events.js';
import { isProductRuntimeTraceId } from './trace.js';
import { PRODUCT_RUNTIME_MAX_QUERY_LIMIT, ProductRuntimeError, type ProductRuntimeOperator } from './types.js';

function operator(value: unknown): Readonly<ProductRuntimeOperator> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 160
      || !(candidate.email === null || candidate.email === undefined || (typeof candidate.email === 'string' && candidate.email.length <= 320))
      || (candidate.source !== 'loopback' && candidate.source !== 'cloudflare-access')) return null;
  return Object.freeze({ id: candidate.id, email: typeof candidate.email === 'string' ? candidate.email : null, source: candidate.source });
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => { void handler(req, res).catch(next); };
}

function exactQuery(req: Request, allowed: readonly string[]): boolean {
  return Object.keys(req.query).every((key) => allowed.includes(key));
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function limit(value: unknown, fallback?: number): number | null {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed <= PRODUCT_RUNTIME_MAX_QUERY_LIMIT ? parsed : null;
}

// The supervisor envelope is the one large read this router publishes, so it —
// and only it — is offered compressed. gzip is asynchronous on purpose: the
// synchronous variant would block the event loop this route shares with every
// other reader. Identity stays the default for any client that does not ask for
// gzip or any body small enough that compression would not pay for itself, and
// a compression failure falls back to identity rather than losing the read.
const gzipAsync = promisify(gzipCallback);
const GZIP_MIN_BYTES = 1024;

function acceptsGzip(req: Request): boolean {
  const raw = req.headers['accept-encoding'];
  const header = Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : '';
  for (const element of header.split(',')) {
    const [token, ...parameters] = element.split(';');
    if ((token ?? '').trim().toLowerCase() !== 'gzip') continue;
    // `gzip;q=0` advertises gzip only to refuse it. Honour the refusal.
    const quality = parameters.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith('q='));
    return quality === undefined || Number(quality.slice(2)) > 0;
  }
  return false;
}

async function sendJsonBody(req: Request, res: Response, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  res.type('application/json');
  if (Buffer.byteLength(body) <= GZIP_MIN_BYTES || !acceptsGzip(req)) {
    res.send(body);
    return;
  }
  let compressed: Buffer;
  try {
    compressed = await gzipAsync(body);
  } catch {
    if (!res.headersSent) res.send(body);
    return;
  }
  if (res.headersSent) return;
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Vary', 'Accept-Encoding');
  res.send(compressed);
}

function exactBody(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** Relative router. Mount exactly at `/api/product-integration`. */
export function createProductIntegrationRuntimeRouter(service: ProductIntegrationRuntimeService): express.Router {
  if (!service || typeof service.readSupervisorShared !== 'function' || typeof service.readMaterialEvents !== 'function'
      || typeof service.readTrace !== 'function' || typeof service.previewCommand !== 'function'
      || typeof service.submitCommand !== 'function' || typeof service.readCommandResult !== 'function') {
    throw new TypeError('A ProductIntegrationRuntimeService is required.');
  }
  const router = express.Router();
  router.use((_req, res, next) => {
    const verified = operator(res.locals.operator);
    if (!verified) {
      res.status(401).json({ ok: false, code: 'OPERATOR_REQUIRED', error: 'Verified server-derived operator identity is required.' });
      return;
    }
    res.locals.productRuntimeOperator = verified;
    next();
  });

  router.get('/v1/supervisor', asyncRoute(async (req, res) => {
    if (!exactQuery(req, [])) {
      res.status(400).json({ ok: false, code: 'INVALID_PRODUCT_QUERY', error: 'Supervisor read accepts no query fields.' });
      return;
    }
    await sendJsonBody(req, res, await service.readSupervisorShared());
  }));

  router.get('/v1/material-events', asyncRoute(async (req, res) => {
    if (!exactQuery(req, ['afterCursor', 'limit'])) {
      res.status(400).json({ ok: false, code: 'INVALID_PRODUCT_QUERY', error: 'Material-event query contains unsupported fields.' });
      return;
    }
    const afterCursor = queryString(req.query.afterCursor);
    const boundedLimit = limit(req.query.limit);
    if (!isProductRuntimeCursor(afterCursor) || boundedLimit === null) {
      res.status(400).json({ ok: false, code: 'INVALID_PRODUCT_QUERY', error: 'afterCursor and integer limit 1..500 are required.' });
      return;
    }
    res.json(await service.readMaterialEvents(afterCursor, boundedLimit));
  }));

  router.get('/v1/traces/:correlationId', asyncRoute(async (req, res) => {
    if (!exactQuery(req, ['limit'])) {
      res.status(400).json({ ok: false, code: 'INVALID_PRODUCT_QUERY', error: 'Trace query contains unsupported fields.' });
      return;
    }
    const correlationId = req.params.correlationId;
    const boundedLimit = limit(req.query.limit, 200);
    if (!isProductRuntimeTraceId(correlationId) || boundedLimit === null) {
      res.status(400).json({ ok: false, code: 'INVALID_TRACE_QUERY', error: 'Trace identity or limit is invalid.' });
      return;
    }
    const trace = await service.readTrace(correlationId, boundedLimit);
    if (!trace) {
      res.status(404).json({ ok: false, code: 'TRACE_NOT_FOUND', error: 'Correlation trace was not found.' });
      return;
    }
    res.json(trace);
  }));

  router.post('/v1/commands/preview', asyncRoute(async (req, res) => {
    if (!req.is('application/json')) {
      res.status(415).json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', error: 'Content-Type must be application/json.' });
      return;
    }
    const incidentControl = typeof req.body?.controlId === 'string'
      && /^incident\.ack\.[a-f0-9]{64}$/.test(req.body.controlId);
    const expectedBody = incidentControl
      ? ['controlId', 'expectedRevision', 'targetId']
      : ['controlId', 'expectedRevision'];
    if (!exactBody(req.body, expectedBody)
        || typeof req.body.controlId !== 'string' || req.body.controlId.length === 0 || req.body.controlId.length > 160
        || typeof req.body.expectedRevision !== 'string' || req.body.expectedRevision.length === 0 || req.body.expectedRevision.length > 160
        || (incidentControl && (typeof req.body.targetId !== 'string'
          || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(req.body.targetId)))) {
      res.status(400).json({ ok: false, code: 'CONTROL_PREVIEW_INVALID', error: 'Exact bounded controlId, expectedRevision, and incident targetId are required.' });
      return;
    }
    res.json(await service.previewCommand({
      controlId: req.body.controlId,
      expectedRevision: req.body.expectedRevision,
      ...(incidentControl ? { targetId: req.body.targetId as string } : {}),
      operator: res.locals.productRuntimeOperator as Readonly<ProductRuntimeOperator>,
    }));
  }));

  router.get('/v1/commands/:commandId/result', asyncRoute(async (req, res) => {
    if (!exactQuery(req, ['idempotencyKey', 'controlId'])) {
      res.status(400).json({ ok: false, code: 'INVALID_COMMAND_RESULT_QUERY', error: 'Command-result query contains unsupported fields.' });
      return;
    }
    const commandId = req.params.commandId;
    const idempotencyKey = queryString(req.query.idempotencyKey);
    const controlId = queryString(req.query.controlId);
    if (!/^sysctrl_[a-f0-9]{64}$/.test(commandId)
      || idempotencyKey === null || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(idempotencyKey)
      || controlId === null || !/^[a-z0-9][a-z0-9.-]{0,159}$/.test(controlId)) {
      res.status(400).json({ ok: false, code: 'INVALID_COMMAND_RESULT_QUERY', error: 'Exact bounded commandId, idempotencyKey, and controlId are required.' });
      return;
    }
    const readback = await service.readCommandResult(Object.freeze({ commandId, idempotencyKey, controlId }));
    if (readback.state === 'NOT_FOUND') {
      res.status(404).json({ ok: false, code: 'COMMAND_RESULT_NOT_FOUND', error: 'No durable command receipt was found.' });
      return;
    }
    if (readback.state === 'FAIL_CLOSED') {
      if (readback.result !== null) {
        res.status(503).json(readback.result);
        return;
      }
      const identityMismatch = readback.failureCode === 'COMMAND_RESULT_IDENTITY_MISMATCH';
      res.status(identityMismatch ? 404 : 503).json({
        ok: false,
        code: identityMismatch ? 'COMMAND_RESULT_NOT_FOUND' : readback.failureCode,
        error: identityMismatch
          ? 'No durable command receipt was found.'
          : 'Durable command-result evidence is unavailable or invalid.',
      });
      return;
    }
    res.status(readback.state === 'PENDING' ? 202 : 200).json(readback.result);
  }));

  router.post('/v1/commands', asyncRoute(async (req, res) => {
    if (!req.is('application/json')) {
      res.status(415).json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', error: 'Content-Type must be application/json.' });
      return;
    }
    res.json(await service.submitCommand(req.body, res.locals.productRuntimeOperator as Readonly<ProductRuntimeOperator>));
  }));

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) { next(error); return; }
    if (error instanceof ProductRuntimeError) {
      res.status(error.status).json({ ok: false, code: error.code, error: error.message });
      return;
    }
    res.status(503).json({ ok: false, code: 'PRODUCT_INTEGRATION_UNAVAILABLE', error: 'Product Integration runtime is unavailable.' });
  });
  return router;
}
