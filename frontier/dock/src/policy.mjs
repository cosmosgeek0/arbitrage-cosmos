import { contractError, deepFreeze } from './canonical.mjs';
import { HARD_DENIALS } from './constants.mjs';
import { validateExtensionDescriptor, validateInsertionRequest } from './records.mjs';

function fail(code, message) {
  throw contractError(code, message);
}

export function evaluateFixturePolicy({ descriptor, request, canonicalPolicy }) {
  validateExtensionDescriptor(descriptor);
  if (request === null || typeof request !== 'object' || Array.isArray(request)) fail('POLICY_REQUEST_INVALID', 'fixture policy request must be an object');
  if (canonicalPolicy === null || typeof canonicalPolicy !== 'object' || Array.isArray(canonicalPolicy)) fail('CANONICAL_POLICY_FIXTURE_INVALID', 'fixture canonical policy is required');
  const requestedCapabilities = request.capabilities;
  if (!Array.isArray(requestedCapabilities)) fail('CAPABILITY_REQUEST_INVALID', 'capability request must be an array');
  const undeclared = requestedCapabilities.filter((capability) => !descriptor.requestedCapabilities.includes(capability));
  if (undeclared.length > 0) fail('UNDECLARED_CAPABILITY_REQUEST', `capabilities were not declared: ${undeclared.join(',')}`);
  const unapproved = requestedCapabilities.filter((capability) => !(canonicalPolicy.approvedCapabilities ?? []).includes(capability));
  if (unapproved.length > 0) fail('CAPABILITY_NOT_APPROVED', `canonical fixture policy did not approve: ${unapproved.join(',')}`);
  if (request.egress !== descriptor.egressDeclaration) fail('UNDECLARED_EGRESS_REQUEST', 'fixture egress differs from the descriptor declaration');
  if (request.egress !== canonicalPolicy.approvedEgress) fail('EGRESS_NOT_APPROVED', 'canonical fixture policy did not approve egress');
  if (request.networkMode !== 'FIXTURE_ONLY') fail('NETWORK_MODE_FORBIDDEN', 'fixture policy cannot permit network mode');
  return deepFreeze({
    decision: 'FIXTURE_REQUEST_COMPATIBLE',
    authorityGranted: false,
    requestedCapabilities: [...requestedCapabilities],
    hardDenials: [...HARD_DENIALS],
  });
}

export function validatePortRequest(request, exactSeams) {
  validateInsertionRequest(request, exactSeams);
  return deepFreeze({
    valid: true,
    exactSeams: [...exactSeams],
    mutationImplemented: false,
    authorityGranted: false,
  });
}

export function assertHardDenial(action) {
  if (!HARD_DENIALS.includes(action)) fail('HARD_DENIAL_UNKNOWN', `unknown hard denial ${String(action)}`);
  return deepFreeze({ action, denied: true, authorityGranted: false });
}
