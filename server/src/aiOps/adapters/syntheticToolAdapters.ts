import { createHash } from 'node:crypto';
import { canonicalJson } from '../../intelligenceFoundation/contracts/ids.js';
import {
  isBoundedIdentifier,
  isGitCommitSha,
  isLowercaseSha256,
  isPlainRecord,
  type JsonValue,
} from './contracts.js';
import {
  A3_EXCLUSIVE_PATCH_ROOTS,
  planIsolatedPatchWorker,
  type IsolatedPatchPlan,
  type IsolatedPatchTask,
  type PatchWorkerContext,
} from './patchWorker.js';
import {
  isA3RepositoryRelativePath,
  toolInputDigest,
  validateToolOutput,
  type ToolCallAdmissionDecision,
} from './toolGateway.js';

export const A3X_SYNTHETIC_TOOL_IDS = Object.freeze([
  'runApprovedWebResearch',
  'searchRepositorySnapshot',
  'inspectRepositoryPath',
] as const);

export type A3XSyntheticToolId = (typeof A3X_SYNTHETIC_TOOL_IDS)[number];

export interface SyntheticWebResearchInput {
  readonly caseId: string;
  readonly domainPolicyId: string;
  readonly evidenceDigest: string;
  readonly query: string;
  readonly requestId: string;
}

export interface SyntheticRepositorySearchInput {
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly maximumRows: number;
  readonly query: string;
  readonly repositoryRevision: string;
  readonly requestId: string;
  readonly scopeRoots: readonly string[];
}

export interface SyntheticRepositoryInspectionInput {
  readonly caseId: string;
  readonly evidenceDigest: string;
  readonly maximumBytes: number;
  readonly relativePath: string;
  readonly repositoryRevision: string;
  readonly requestId: string;
  readonly scopeRoots: readonly string[];
}

export type SyntheticToolInput =
  | SyntheticWebResearchInput
  | SyntheticRepositorySearchInput
  | SyntheticRepositoryInspectionInput;

export interface SyntheticToolPortInvocation {
  readonly schema: 'AI_OPS_SYNTHETIC_TOOL_PORT_INVOCATION_V1';
  readonly toolId: A3XSyntheticToolId;
  readonly requestId: string;
  readonly caseId: string;
  readonly inputDigest: string;
  readonly input: Readonly<SyntheticToolInput>;
}

export interface SyntheticToolPortOutput {
  readonly schema: 'AI_OPS_SYNTHETIC_TOOL_PORT_OUTPUT_V1';
  readonly inputDigest: string;
  readonly status: 'COMPLETED' | 'BLOCKED' | 'FAILED';
  readonly payload: JsonValue | null;
  readonly evidenceRefs: readonly string[];
  readonly syntheticOnly: true;
  readonly networkAttempted: false;
  readonly filesystemReadAttempted: false;
  readonly filesystemMutationAttempted: false;
  readonly patchApplied: false;
  readonly fallbackUsed: false;
  readonly reasonCodes: readonly string[];
}

export interface SyntheticToolPort {
  readonly schema: 'AI_OPS_SYNTHETIC_TOOL_PORT_V1';
  execute(input: Readonly<SyntheticToolPortInvocation>): Promise<Readonly<SyntheticToolPortOutput>>;
}

export interface SyntheticToolAdapterResult {
  readonly schema: 'AI_OPS_SYNTHETIC_TOOL_ADAPTER_RESULT_V1';
  readonly executed: boolean;
  readonly authorityGranted: false;
  readonly syntheticOnly: true;
  readonly toolId: A3XSyntheticToolId;
  readonly requestId: string | null;
  readonly resultDigest: string | null;
  readonly toolOutput: Readonly<Record<string, unknown>> | null;
  readonly payload: JsonValue | null;
  readonly networkAttempted: false;
  readonly filesystemReadAttempted: false;
  readonly filesystemMutationAttempted: false;
  readonly patchApplied: false;
  readonly fallbackUsed: false;
  readonly reasonCodes: readonly string[];
}

export interface SandboxedPatchProposalProjection {
  readonly schema: 'AI_OPS_SANDBOXED_PATCH_PROPOSAL_PROJECTION_V1';
  readonly proposed: boolean;
  readonly authorityGranted: false;
  readonly applied: false;
  readonly worktreeCreated: false;
  readonly testsExecuted: false;
  readonly commitCreated: false;
  readonly fallbackToUnsandboxed: false;
  readonly plan: Readonly<IsolatedPatchPlan>;
}

const PORT_OUTPUT_KEYS = Object.freeze([
  'schema',
  'inputDigest',
  'status',
  'payload',
  'evidenceRefs',
  'syntheticOnly',
  'networkAttempted',
  'filesystemReadAttempted',
  'filesystemMutationAttempted',
  'patchApplied',
  'fallbackUsed',
  'reasonCodes',
]);

const WEB_INPUT_KEYS = Object.freeze(['caseId', 'domainPolicyId', 'evidenceDigest', 'query', 'requestId']);
const REPOSITORY_SEARCH_INPUT_KEYS = Object.freeze([
  'caseId', 'evidenceDigest', 'maximumRows', 'query', 'repositoryRevision', 'requestId', 'scopeRoots',
]);
const REPOSITORY_INSPECTION_INPUT_KEYS = Object.freeze([
  'caseId', 'evidenceDigest', 'maximumBytes', 'relativePath', 'repositoryRevision', 'requestId', 'scopeRoots',
]);
const WEB_PAYLOAD_KEYS = Object.freeze(['kind', 'queryId', 'domainPolicyId', 'query', 'results']);
const WEB_RESULT_KEYS = Object.freeze(['citationId', 'sourceRef', 'title']);
const REPOSITORY_SEARCH_PAYLOAD_KEYS = Object.freeze(['kind', 'repositoryRevision', 'query', 'matches']);
const REPOSITORY_MATCH_KEYS = Object.freeze(['line', 'path', 'text']);
const REPOSITORY_INSPECTION_PAYLOAD_KEYS = Object.freeze([
  'kind', 'repositoryRevision', 'path', 'contentDigest', 'excerpt',
]);

function snapshotClosedRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> | null {
  try {
    if (!isPlainRecord(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotIdentifierArray(value: unknown, maximum: number): readonly string[] | null {
  try {
    if (!Array.isArray(value) || value.length > maximum) return null;
    const snapshot: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
        || !isBoundedIdentifier(descriptor.value)) return null;
      snapshot.push(descriptor.value);
    }
    if (Reflect.ownKeys(value).length !== snapshot.length + 1 || new Set(snapshot).size !== snapshot.length) return null;
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotStringArray(value: unknown, maximum: number): readonly string[] | null {
  try {
    if (!Array.isArray(value) || value.length > maximum) return null;
    const snapshot: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'string') return null;
      snapshot.push(descriptor.value);
    }
    if (Reflect.ownKeys(value).length !== snapshot.length + 1) return null;
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotDataArray(value: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value) || value.length > maximum) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot.push(descriptor.value);
    }
    if (Reflect.ownKeys(value).length !== snapshot.length + 1) return null;
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function isBoundedText(value: unknown, maximum = 2_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function snapshotScopeRoots(value: unknown): readonly string[] | null {
  const roots = snapshotStringArray(value, A3_EXCLUSIVE_PATCH_ROOTS.length);
  if (roots === null || roots.length === 0 || new Set(roots).size !== roots.length
    || roots.some((root) => !(A3_EXCLUSIVE_PATCH_ROOTS as readonly string[]).includes(root))) return null;
  return roots;
}

function isPathWithinRoots(value: unknown, roots: readonly string[]): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1_024
    && isA3RepositoryRelativePath(value)
    && roots.some((root) => value.startsWith(`${root}/`));
}

function snapshotSyntheticToolInput(
  toolId: A3XSyntheticToolId,
  value: unknown,
): Readonly<SyntheticToolInput> | null {
  const keys = toolId === 'runApprovedWebResearch'
    ? WEB_INPUT_KEYS
    : toolId === 'searchRepositorySnapshot'
      ? REPOSITORY_SEARCH_INPUT_KEYS
      : REPOSITORY_INSPECTION_INPUT_KEYS;
  const record = snapshotClosedRecord(value, keys);
  if (record === null
    || !isBoundedIdentifier(record.caseId)
    || !isLowercaseSha256(record.evidenceDigest)
    || !isBoundedIdentifier(record.requestId)) return null;
  if (toolId === 'runApprovedWebResearch') {
    if (!isBoundedIdentifier(record.domainPolicyId) || !isBoundedText(record.query)) return null;
    return Object.freeze({
      caseId: record.caseId,
      domainPolicyId: record.domainPolicyId,
      evidenceDigest: record.evidenceDigest,
      query: record.query,
      requestId: record.requestId,
    });
  }
  const scopeRoots = snapshotScopeRoots(record.scopeRoots);
  if (scopeRoots === null || !isGitCommitSha(record.repositoryRevision)) return null;
  if (toolId === 'searchRepositorySnapshot') {
    if (!Number.isSafeInteger(record.maximumRows) || (record.maximumRows as number) < 1
      || (record.maximumRows as number) > 1_000 || !isBoundedText(record.query)) return null;
    return Object.freeze({
      caseId: record.caseId,
      evidenceDigest: record.evidenceDigest,
      maximumRows: record.maximumRows as number,
      query: record.query,
      repositoryRevision: record.repositoryRevision,
      requestId: record.requestId,
      scopeRoots,
    });
  }
  if (!Number.isSafeInteger(record.maximumBytes) || (record.maximumBytes as number) < 1
    || (record.maximumBytes as number) > 1_048_576 || !isPathWithinRoots(record.relativePath, scopeRoots)) return null;
  return Object.freeze({
    caseId: record.caseId,
    evidenceDigest: record.evidenceDigest,
    maximumBytes: record.maximumBytes as number,
    relativePath: record.relativePath,
    repositoryRevision: record.repositoryRevision,
    requestId: record.requestId,
    scopeRoots,
  });
}

function snapshotSyntheticToolPayload(
  toolId: A3XSyntheticToolId,
  input: Readonly<SyntheticToolInput>,
  value: unknown,
): JsonValue | null {
  if (toolId === 'runApprovedWebResearch') {
    const webInput = input as Readonly<SyntheticWebResearchInput>;
    const record = snapshotClosedRecord(value, WEB_PAYLOAD_KEYS);
    const rows = record === null ? null : snapshotDataArray(record.results, 32);
    if (record === null || rows === null || record.kind !== 'SYNTHETIC_SEARCH_RESULTS'
      || !isBoundedIdentifier(record.queryId)
      || record.domainPolicyId !== webInput.domainPolicyId
      || record.query !== webInput.query) return null;
    const results: JsonValue[] = [];
    for (const row of rows) {
      const result = snapshotClosedRecord(row, WEB_RESULT_KEYS);
      if (result === null || !isBoundedIdentifier(result.citationId)
        || !isBoundedText(result.sourceRef)
        || !/^[A-Za-z0-9.-]+\.invalid(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/.test(result.sourceRef)
        || !isBoundedText(result.title, 512)) return null;
      results.push(Object.freeze({
        citationId: result.citationId,
        sourceRef: result.sourceRef,
        title: result.title,
      }));
    }
    return Object.freeze({
      kind: 'SYNTHETIC_SEARCH_RESULTS',
      queryId: record.queryId,
      domainPolicyId: webInput.domainPolicyId,
      query: webInput.query,
      results: Object.freeze(results),
    });
  }
  if (toolId === 'searchRepositorySnapshot') {
    const searchInput = input as Readonly<SyntheticRepositorySearchInput>;
    const record = snapshotClosedRecord(value, REPOSITORY_SEARCH_PAYLOAD_KEYS);
    const rows = record === null ? null : snapshotDataArray(record.matches, searchInput.maximumRows);
    if (record === null || rows === null || record.kind !== 'SYNTHETIC_REPOSITORY_SEARCH_RESULTS'
      || record.repositoryRevision !== searchInput.repositoryRevision
      || record.query !== searchInput.query) return null;
    const matches: JsonValue[] = [];
    for (const row of rows) {
      const match = snapshotClosedRecord(row, REPOSITORY_MATCH_KEYS);
      if (match === null || !Number.isSafeInteger(match.line) || (match.line as number) < 1
        || !isPathWithinRoots(match.path, searchInput.scopeRoots)
        || !isBoundedText(match.text)) return null;
      matches.push(Object.freeze({ line: match.line as number, path: match.path, text: match.text }));
    }
    return Object.freeze({
      kind: 'SYNTHETIC_REPOSITORY_SEARCH_RESULTS',
      repositoryRevision: searchInput.repositoryRevision,
      query: searchInput.query,
      matches: Object.freeze(matches),
    });
  }
  const inspectionInput = input as Readonly<SyntheticRepositoryInspectionInput>;
  const record = snapshotClosedRecord(value, REPOSITORY_INSPECTION_PAYLOAD_KEYS);
  if (record === null || record.kind !== 'SYNTHETIC_REPOSITORY_FILE'
    || record.repositoryRevision !== inspectionInput.repositoryRevision
    || record.path !== inspectionInput.relativePath
    || !isLowercaseSha256(record.contentDigest)
    || typeof record.excerpt !== 'string'
    || Buffer.byteLength(record.excerpt, 'utf8') > inspectionInput.maximumBytes) return null;
  return Object.freeze({
    kind: 'SYNTHETIC_REPOSITORY_FILE',
    repositoryRevision: inspectionInput.repositoryRevision,
    path: inspectionInput.relativePath,
    contentDigest: record.contentDigest,
    excerpt: record.excerpt,
  });
}

function inertToolResult(
  toolId: A3XSyntheticToolId,
  requestId: string | null,
  reasons: readonly string[],
): Readonly<SyntheticToolAdapterResult> {
  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_TOOL_ADAPTER_RESULT_V1',
    executed: false,
    authorityGranted: false,
    syntheticOnly: true,
    toolId,
    requestId,
    resultDigest: null,
    toolOutput: null,
    payload: null,
    networkAttempted: false,
    filesystemReadAttempted: false,
    filesystemMutationAttempted: false,
    patchApplied: false,
    fallbackUsed: false,
    reasonCodes: Object.freeze([...reasons, 'SYNTHETIC_TOOL_FALLBACK_FORBIDDEN']),
  });
}

function isAdmittedForTool(
  admission: Readonly<ToolCallAdmissionDecision>,
  toolId: A3XSyntheticToolId,
  input: Readonly<SyntheticToolInput>,
): boolean {
  try {
    return admission.schema === 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1'
      && admission.allowed === true
      && admission.authorityGranted === false
      && admission.disposition === 'ADMIT_TO_EXTERNAL_EXECUTOR_PORT'
      && admission.toolId === toolId
      && admission.requestId === input.requestId
      && admission.caseId === input.caseId
      && admission.inputDigest === toolInputDigest(toolId, input)
      && admission.reasonCodes.length === 0;
  } catch {
    return false;
  }
}

function snapshotPortOutput(value: unknown, inputDigest: string): Readonly<SyntheticToolPortOutput> | null {
  const record = snapshotClosedRecord(value, PORT_OUTPUT_KEYS);
  if (record === null
    || record.schema !== 'AI_OPS_SYNTHETIC_TOOL_PORT_OUTPUT_V1'
    || record.inputDigest !== inputDigest
    || !(['COMPLETED', 'BLOCKED', 'FAILED'] as const).includes(record.status as 'COMPLETED')
    || record.syntheticOnly !== true
    || record.networkAttempted !== false
    || record.filesystemReadAttempted !== false
    || record.filesystemMutationAttempted !== false
    || record.patchApplied !== false
    || record.fallbackUsed !== false) return null;
  const evidenceRefs = snapshotIdentifierArray(record.evidenceRefs, 64);
  const reasonCodes = snapshotIdentifierArray(record.reasonCodes, 32);
  if (evidenceRefs === null || reasonCodes === null) return null;
  if (record.status === 'COMPLETED' && record.payload === null) return null;
  if (record.status !== 'COMPLETED' && record.payload !== null) return null;
  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_TOOL_PORT_OUTPUT_V1',
    inputDigest,
    status: record.status as SyntheticToolPortOutput['status'],
    payload: record.payload as JsonValue | null,
    evidenceRefs,
    syntheticOnly: true,
    networkAttempted: false,
    filesystemReadAttempted: false,
    filesystemMutationAttempted: false,
    patchApplied: false,
    fallbackUsed: false,
    reasonCodes,
  });
}

async function executeSyntheticTool(
  toolId: A3XSyntheticToolId,
  admission: Readonly<ToolCallAdmissionDecision>,
  input: Readonly<SyntheticToolInput>,
  port: Readonly<SyntheticToolPort>,
): Promise<Readonly<SyntheticToolAdapterResult>> {
  const inputSnapshot = snapshotSyntheticToolInput(toolId, input);
  if (inputSnapshot === null || !isAdmittedForTool(admission, toolId, inputSnapshot)) {
    return inertToolResult(toolId, isBoundedIdentifier(admission.requestId) ? admission.requestId : null, Object.freeze(['SYNTHETIC_TOOL_ADMISSION_INVALID']));
  }
  if (!isPlainRecord(port) || port.schema !== 'AI_OPS_SYNTHETIC_TOOL_PORT_V1' || typeof port.execute !== 'function') {
    return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_PORT_INVALID']));
  }
  const inputDigest = admission.inputDigest as string;
  let rawOutput: unknown;
  try {
    rawOutput = await port.execute(Object.freeze({
      schema: 'AI_OPS_SYNTHETIC_TOOL_PORT_INVOCATION_V1',
      toolId,
      requestId: inputSnapshot.requestId,
      caseId: inputSnapshot.caseId,
      inputDigest,
      input: inputSnapshot,
    }));
  } catch {
    return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_PORT_FAILED']));
  }
  const output = snapshotPortOutput(rawOutput, inputDigest);
  if (output === null) return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_PORT_OUTPUT_INVALID']));
  if (output.status !== 'COMPLETED' || output.payload === null) {
    return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_PORT_DID_NOT_COMPLETE', ...output.reasonCodes]));
  }
  const payload = snapshotSyntheticToolPayload(toolId, inputSnapshot, output.payload);
  if (payload === null) {
    return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_PAYLOAD_BINDING_MISMATCH']));
  }
  let resultDigest: string;
  try {
    const serialized = canonicalJson(payload);
    if (Buffer.byteLength(serialized, 'utf8') > 1_048_576) {
      return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_OUTPUT_BYTES_EXCEEDED']));
    }
    resultDigest = createHash('sha256').update(serialized).digest('hex');
  } catch {
    return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_PAYLOAD_NOT_CANONICAL_JSON']));
  }
  if (!isLowercaseSha256(resultDigest)) return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_RESULT_DIGEST_INVALID']));

  const toolOutput = Object.freeze({
    caseId: admission.caseId,
    environmentId: admission.environmentId,
    evidenceRefs: output.evidenceRefs,
    inputDigest,
    mode: admission.mode,
    modelId: admission.modelId,
    policyRevision: admission.policyRevision,
    principalId: admission.principalId,
    providerId: admission.providerId,
    requestId: admission.requestId,
    resultDigest,
    role: admission.role,
    runId: admission.runId,
    status: 'COMPLETED',
    toolId,
  });
  const validation = validateToolOutput(admission, toolOutput);
  if (!validation.valid) return inertToolResult(toolId, inputSnapshot.requestId, Object.freeze(['SYNTHETIC_TOOL_OUTPUT_REJECTED', ...validation.reasonCodes]));

  return Object.freeze({
    schema: 'AI_OPS_SYNTHETIC_TOOL_ADAPTER_RESULT_V1',
    executed: true,
    authorityGranted: false,
    syntheticOnly: true,
    toolId,
    requestId: inputSnapshot.requestId,
    resultDigest,
    toolOutput,
    payload,
    networkAttempted: false,
    filesystemReadAttempted: false,
    filesystemMutationAttempted: false,
    patchApplied: false,
    fallbackUsed: false,
    reasonCodes: Object.freeze(['SYNTHETIC_FIXTURE_ONLY', ...output.reasonCodes]),
  });
}

export function executeSyntheticWebResearch(
  admission: Readonly<ToolCallAdmissionDecision>,
  input: Readonly<SyntheticWebResearchInput>,
  port: Readonly<SyntheticToolPort>,
): Promise<Readonly<SyntheticToolAdapterResult>> {
  return executeSyntheticTool('runApprovedWebResearch', admission, input, port);
}

export function executeSyntheticRepositorySearch(
  admission: Readonly<ToolCallAdmissionDecision>,
  input: Readonly<SyntheticRepositorySearchInput>,
  port: Readonly<SyntheticToolPort>,
): Promise<Readonly<SyntheticToolAdapterResult>> {
  return executeSyntheticTool('searchRepositorySnapshot', admission, input, port);
}

export function executeSyntheticRepositoryInspection(
  admission: Readonly<ToolCallAdmissionDecision>,
  input: Readonly<SyntheticRepositoryInspectionInput>,
  port: Readonly<SyntheticToolPort>,
): Promise<Readonly<SyntheticToolAdapterResult>> {
  return executeSyntheticTool('inspectRepositoryPath', admission, input, port);
}

export function projectSandboxedPatchProposal(
  task: Readonly<IsolatedPatchTask>,
  context: Readonly<PatchWorkerContext>,
): Readonly<SandboxedPatchProposalProjection> {
  const plan = planIsolatedPatchWorker(task, context);
  return Object.freeze({
    schema: 'AI_OPS_SANDBOXED_PATCH_PROPOSAL_PROJECTION_V1',
    proposed: plan.planned,
    authorityGranted: false,
    applied: false,
    worktreeCreated: false,
    testsExecuted: false,
    commitCreated: false,
    fallbackToUnsandboxed: false,
    plan,
  });
}
