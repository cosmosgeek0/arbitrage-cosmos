import { assertFixtureTransport } from '../../dock/src/index.mjs';
import { asRecord, boundedString, cloneCanonical, deepFreeze, exactFields } from './guards.mjs';
import { fail } from './errors.mjs';

const FORBIDDEN_REQUEST_FIELDS = Object.freeze([
  'url', 'headers', 'credentials', 'apiKey', 'secret', 'signature', 'privateEndpoint',
  'order', 'borrow', 'repay', 'transfer', 'withdrawal', 'subscription',
]);

export function createFixtureTransport(fixtures) {
  asRecord(fixtures, 'fixtures');
  const canonicalFixtures = cloneCanonical(fixtures);
  const transport = {
    networkMode: 'FIXTURE_ONLY',
    open: false,
    read(request) {
      asRecord(request, 'fixture request');
      for (const field of FORBIDDEN_REQUEST_FIELDS) {
        if (Object.hasOwn(request, field)) fail('FIXTURE_REQUEST_AUTHORITY_WIDENING', `fixture request cannot contain ${field}`);
      }
      exactFields(request, ['operation', 'fixtureId'], 'fixture request');
      if (request.operation !== 'READ_FIXTURE') fail('FIXTURE_OPERATION_FORBIDDEN', 'fixture transport permits READ_FIXTURE only');
      boundedString(request.fixtureId, 'fixture request.fixtureId', 256);
      if (!Object.hasOwn(canonicalFixtures, request.fixtureId)) fail('FIXTURE_NOT_FOUND', `unknown fixture ${request.fixtureId}`);
      return deepFreeze(cloneCanonical(canonicalFixtures[request.fixtureId]));
    },
  };
  assertFixtureTransport(transport);
  return deepFreeze(transport);
}

export function assertClosedFixtureTransport(transport) {
  assertFixtureTransport(transport);
  if (typeof transport.read !== 'function') fail('FIXTURE_READ_PORT_REQUIRED', 'fixture transport requires an injected read function');
  return true;
}
