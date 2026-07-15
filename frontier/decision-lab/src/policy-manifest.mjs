import { deepFreeze, sha256 } from '../../dock/src/index.mjs';

export const ALTERNATIVE_PREDECLARED_AT_MS = 1_784_129_940_000;

export const PREDECLARED_ALTERNATIVE_MANIFEST = deepFreeze([
  'DELAYED_TIMING',
  'EARLIER_TIMING',
  'ENTRY',
  'EXECUTION_POLICY',
  'EXIT',
  'NO_TRADE',
  'THRESHOLD',
].map((kind) => {
  const core = {
    kind,
    entryId: `alternative-kind:${kind.toLowerCase()}`,
    entryRevision: 'v1',
    scenarioPredeclaredAtMs: ALTERNATIVE_PREDECLARED_AT_MS,
    authorityClass: 'NO_AUTHORITY',
    temporalAuthority: false,
    semantics: 'SYNTHETIC_SCENARIO_PREDECLARATION_METADATA_ONLY',
  };
  return { ...core, entryHash: sha256(core) };
}));

export const ALTERNATIVE_MANIFEST_SHA256 = sha256(PREDECLARED_ALTERNATIVE_MANIFEST);

export function policyManifestEntry(kind) {
  return PREDECLARED_ALTERNATIVE_MANIFEST.find((entry) => entry.kind === kind) ?? null;
}
