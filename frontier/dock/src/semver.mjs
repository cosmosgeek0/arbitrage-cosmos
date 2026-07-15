import { contractError, deepFreeze } from './canonical.mjs';

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseIdentifier(identifier) {
  if (/^\d+$/.test(identifier)) {
    if (identifier.length > 1 && identifier.startsWith('0')) throw contractError('SEMVER_INVALID', 'numeric prerelease identifiers must not contain leading zeroes');
    const value = Number(identifier);
    if (!Number.isSafeInteger(value)) throw contractError('SEMVER_COMPONENT_TOO_LARGE', 'numeric semantic-version identifiers must fit a safe integer');
    return value;
  }
  return identifier;
}

export function parseSemver(value) {
  if (typeof value !== 'string') throw contractError('SEMVER_INVALID', 'semantic version must be a string');
  const match = SEMVER_PATTERN.exec(value);
  if (!match) throw contractError('SEMVER_INVALID', `invalid semantic version ${String(value)}`);
  const core = match.slice(1, 4).map((component) => Number(component));
  if (core.some((component) => !Number.isSafeInteger(component))) {
    throw contractError('SEMVER_COMPONENT_TOO_LARGE', 'semantic-version core components must fit safe integers');
  }
  return deepFreeze({
    raw: value,
    major: core[0],
    minor: core[1],
    patch: core[2],
    prerelease: match[4] ? match[4].split('.').map(parseIdentifier) : [],
    build: match[5] ? match[5].split('.') : [],
  });
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (index >= left.length) return -1;
    if (index >= right.length) return 1;
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
    if (typeof a === 'number') return -1;
    if (typeof b === 'number') return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareSemver(leftValue, rightValue) {
  const left = typeof leftValue === 'string' ? parseSemver(leftValue) : leftValue;
  const right = typeof rightValue === 'string' ? parseSemver(rightValue) : rightValue;
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function negotiateContractVersion(providerVersion, requiredVersion) {
  const provider = parseSemver(providerVersion);
  const required = parseSemver(requiredVersion);
  if (provider.major !== required.major) {
    throw contractError('UNSUPPORTED_MAJOR_VERSION', `provider ${providerVersion} is incompatible with required ${requiredVersion}`);
  }
  if (compareSemver(provider, required) < 0) {
    throw contractError('CONTRACT_VERSION_TOO_OLD', `provider ${providerVersion} is older than required ${requiredVersion}`);
  }
  if (provider.prerelease.length > 0 && required.prerelease.length === 0) {
    throw contractError('PRERELEASE_NOT_ACCEPTED', `provider ${providerVersion} is not a stable compatible version`);
  }
  return deepFreeze({
    status: 'COMPATIBLE',
    providerVersion,
    requiredVersion,
    mode: providerVersion === requiredVersion ? 'EXACT' : 'FORWARD_COMPATIBLE',
    unknownFields: 'PRESERVE_WITHOUT_CHANGING_KNOWN_SEMANTICS',
  });
}
