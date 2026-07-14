import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { canonicalJson } from '../../intelligenceFoundation/contracts/ids.js';
import {
  isBoundedIdentifier,
  isExactIdentityRole,
  isExactProviderConfigurationState,
  isLowercaseSha256,
  isPlainRecord,
} from './contracts.js';
import { A3_TOOL_IDS, toolInputDigest, type ToolCallAdmissionDecision } from './toolGateway.js';

export const CLAUDE_FAIL_CLOSED_SETTINGS_TEMPLATE = Object.freeze({
  schema: 'AI_OPS_CLAUDE_FAIL_CLOSED_SETTINGS_TEMPLATE_V1',
  activationAllowed: false,
  permissions: Object.freeze({
    defaultMode: 'dontAsk',
    disableBypassPermissionsMode: 'disable',
    allow: Object.freeze([]),
    deny: Object.freeze(['Bash', 'WebFetch', 'WebSearch', 'Agent', 'Task']),
  }),
  sandbox: Object.freeze({
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    network: Object.freeze({ allowedDomains: Object.freeze([]) }),
    filesystem: Object.freeze({
      allowWrite: Object.freeze(['<I00_EXACT_ISOLATED_WORKTREE_ROOTS>']),
      denyRead: Object.freeze(['**/.env', '**/.env.*', '**/secrets/**', '**/.git-credentials']),
    }),
  }),
  hooks: Object.freeze({
    PreToolUse: Object.freeze([Object.freeze({
      matcher: '*',
      hooks: Object.freeze([Object.freeze({
        type: 'command',
        command: '<I00_PINNED_A3_PRE_TOOL_HOOK_EXECUTABLE>',
      })]),
    })]),
  }),
});

export interface ClaudePreToolUseInput {
  readonly session_id: string;
  readonly transcript_path: string;
  readonly cwd: string;
  readonly permission_mode: 'dontAsk' | 'default' | 'plan' | 'acceptEdits' | 'auto' | 'bypassPermissions';
  readonly hook_event_name: 'PreToolUse';
  readonly tool_name: string;
  readonly tool_input: unknown;
  readonly tool_use_id: string;
}

export interface ClaudeToolHookBinding {
  readonly schema: 'AI_OPS_CLAUDE_TOOL_HOOK_BINDING_V1';
  readonly toolUseId: string;
  readonly providerToolName: string;
  readonly providerToolInputDigest: string;
  readonly admissionInputDigest: string;
  readonly policyReceiptId: string;
  readonly sessionId: string;
  readonly canonicalCwd: string;
  readonly principalId: string;
  readonly runId: string;
  readonly environmentId: string;
  readonly admission: Readonly<ToolCallAdmissionDecision>;
}

export interface ClaudePreToolUseOutput {
  readonly exitCode: 0;
  readonly authorityGranted: false;
  readonly stdout: Readonly<{
    hookSpecificOutput: Readonly<{
      hookEventName: 'PreToolUse';
      permissionDecision: 'allow' | 'deny';
      permissionDecisionReason: string;
    }>;
  }>;
}

const CLAUDE_HOOK_KEYS = Object.freeze([
  'session_id', 'transcript_path', 'cwd', 'permission_mode', 'hook_event_name', 'tool_name', 'tool_input', 'tool_use_id',
]);
const CLAUDE_BINDING_KEYS = Object.freeze([
  'schema', 'toolUseId', 'providerToolName', 'providerToolInputDigest', 'admissionInputDigest', 'policyReceiptId',
  'sessionId', 'canonicalCwd', 'principalId', 'runId', 'environmentId', 'admission',
]);
const TOOL_ADMISSION_KEYS = Object.freeze([
  'schema', 'allowed', 'authorityGranted', 'disposition', 'toolId', 'requestId', 'caseId', 'role', 'principalId',
  'providerId', 'modelId', 'runId', 'mode', 'environmentId', 'inputDigest', 'policyRevision', 'reasonCodes',
]);

function exactObjectKeys(value: unknown, expected: readonly string[]): boolean {
  try {
    return isPlainRecord(value)
      && Object.getOwnPropertySymbols(value).length === 0
      && Object.keys(value).sort().join('\u0000') === [...expected].sort().join('\u0000');
  } catch {
    return false;
  }
}

function snapshotExactDataRecord(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
  try {
    if (!exactObjectKeys(value, expected)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value as object);
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function isExactEmptyDataArray(value: unknown): boolean {
  try {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors['length'];
    return Object.keys(descriptors).length === 1
      && lengthDescriptor !== undefined
      && Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
      && lengthDescriptor.value === 0;
  } catch {
    return false;
  }
}

export function providerToolInputDigest(toolName: string, toolInput: unknown): string {
  return createHash('sha256').update(canonicalJson({ toolName, toolInput })).digest('hex');
}

function hookOutput(reasons: readonly string[]): Readonly<ClaudePreToolUseOutput> {
  const uniqueReasons = [...new Set(reasons)];
  const permissionDecision = uniqueReasons.length === 0 ? 'allow' : 'deny';
  return Object.freeze({
    exitCode: 0,
    authorityGranted: false,
    stdout: Object.freeze({
      hookSpecificOutput: Object.freeze({
        hookEventName: 'PreToolUse',
        permissionDecision,
        permissionDecisionReason: permissionDecision === 'allow'
          ? 'Exact A3 policy admission binding verified; external executor must still enforce its own boundary.'
          : `A3 default deny: ${uniqueReasons.join(',')}`,
      }),
    }),
  });
}

function isCanonicalIsolatedCwd(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || value.includes('\u0000') || !isAbsolute(value)) return false;
  if (resolve(value) !== value) return false;
  const forbidden = new Set(['main', 'current-main', 'i00-assembly']);
  return !value.toLowerCase().split('/').some((segment) => forbidden.has(segment));
}

function normalizedAdmission(value: unknown): Readonly<ToolCallAdmissionDecision> | null {
  const snapshot = snapshotExactDataRecord(value, TOOL_ADMISSION_KEYS);
  if (snapshot === null) return null;
  const admission = snapshot as unknown as Readonly<ToolCallAdmissionDecision>;
  const valid = admission.schema === 'AI_OPS_TOOL_CALL_ADMISSION_DECISION_V1'
    && admission.allowed === true
    && admission.authorityGranted === false
    && admission.disposition === 'ADMIT_TO_EXTERNAL_EXECUTOR_PORT'
    && (A3_TOOL_IDS as readonly string[]).includes(admission.toolId)
    && isBoundedIdentifier(admission.requestId)
    && isBoundedIdentifier(admission.caseId)
    && isExactIdentityRole(admission.role)
    && isBoundedIdentifier(admission.principalId)
    && isBoundedIdentifier(admission.providerId)
    && isBoundedIdentifier(admission.modelId)
    && isBoundedIdentifier(admission.runId)
    && isExactProviderConfigurationState(admission.mode)
    && isBoundedIdentifier(admission.environmentId)
    && isLowercaseSha256(admission.inputDigest)
    && isBoundedIdentifier(admission.policyRevision)
    && isExactEmptyDataArray(admission.reasonCodes);
  return valid ? Object.freeze(admission) : null;
}

export function adaptClaudePreToolUseHook(
  hookInput: Readonly<ClaudePreToolUseInput> | unknown,
  binding: Readonly<ClaudeToolHookBinding> | unknown,
): Readonly<ClaudePreToolUseOutput> {
  const reasons: string[] = ['HOOK_BINDING_VERIFIER_NOT_CONFIGURED'];
  const hookSnapshot = snapshotExactDataRecord(hookInput, CLAUDE_HOOK_KEYS);
  if (hookSnapshot === null) return hookOutput([...reasons, 'HOOK_INPUT_SCHEMA_REJECTED']);
  const hook = hookSnapshot as unknown as Readonly<ClaudePreToolUseInput>;
  if (hook.hook_event_name !== 'PreToolUse') reasons.push('HOOK_EVENT_NOT_PRE_TOOL_USE');
  if (hook.permission_mode !== 'dontAsk') {
    reasons.push(hook.permission_mode === 'bypassPermissions' ? 'BYPASS_PERMISSION_MODE_FORBIDDEN' : 'NON_INTERACTIVE_PERMISSION_MODE_NOT_PINNED');
  }
  if (!isBoundedIdentifier(hook.session_id) || !isBoundedIdentifier(hook.tool_name) || !isBoundedIdentifier(hook.tool_use_id)) {
    reasons.push('HOOK_IDENTITY_INVALID');
  }
  if (!(A3_TOOL_IDS as readonly string[]).includes(String(hook.tool_name))) reasons.push('HOOK_TOOL_NOT_A3_REGISTERED');
  if (typeof hook.transcript_path !== 'string' || hook.transcript_path.length === 0 || hook.transcript_path.length > 4_096 || !isAbsolute(hook.transcript_path)) {
    reasons.push('HOOK_TRANSCRIPT_PATH_INVALID');
  }
  if (!isCanonicalIsolatedCwd(hook.cwd)) reasons.push('HOOK_CWD_NOT_CANONICAL_ISOLATED');
  let observedInputDigest: string | null = null;
  let observedAdmissionInputDigest: string | null = null;
  try {
    observedInputDigest = providerToolInputDigest(String(hook.tool_name), hook.tool_input);
    observedAdmissionInputDigest = toolInputDigest(String(hook.tool_name), hook.tool_input);
  } catch {
    reasons.push('HOOK_TOOL_INPUT_CANONICALIZATION_REJECTED');
  }
  const bindingSnapshot = snapshotExactDataRecord(binding, CLAUDE_BINDING_KEYS);
  if (bindingSnapshot === null || bindingSnapshot.schema !== 'AI_OPS_CLAUDE_TOOL_HOOK_BINDING_V1') {
    reasons.push('HOOK_ADMISSION_BINDING_MISSING');
  } else {
    const bound = bindingSnapshot as unknown as Readonly<ClaudeToolHookBinding>;
    const admission = normalizedAdmission(bound.admission);
    if (admission === null) {
      reasons.push('HOOK_ADMISSION_SCHEMA_REJECTED');
    } else {
      if (
        bound.toolUseId !== hook.tool_use_id
        || bound.providerToolName !== hook.tool_name
        || bound.providerToolInputDigest !== observedInputDigest
        || bound.admissionInputDigest !== observedAdmissionInputDigest
        || bound.admissionInputDigest !== admission.inputDigest
        || admission.toolId !== bound.providerToolName
        || admission.toolId !== hook.tool_name
        || bound.sessionId !== hook.session_id
        || bound.canonicalCwd !== hook.cwd
        || bound.principalId !== admission.principalId
        || bound.runId !== admission.runId
        || bound.environmentId !== admission.environmentId
      ) reasons.push('HOOK_ADMISSION_SUBJECT_MISMATCH');
      if (!isBoundedIdentifier(bound.policyReceiptId)
        || !isBoundedIdentifier(bound.sessionId)
        || !isCanonicalIsolatedCwd(bound.canonicalCwd)
        || !isBoundedIdentifier(bound.principalId)
        || !isBoundedIdentifier(bound.runId)
        || !isBoundedIdentifier(bound.environmentId)) reasons.push('HOOK_POLICY_RECEIPT_OR_SUBJECT_INVALID');
    }
  }
  return hookOutput(reasons);
}
