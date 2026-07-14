import { isBoundedIdentifier, type AiOpsIdentityRole } from './contracts.js';

export type SubscriptionCliProvider = 'CODEX_CLI' | 'CLAUDE_CODE_CLI';

export interface SubscriptionCliTemplate {
  readonly schema: 'AI_OPS_SUBSCRIPTION_CLI_TEMPLATE_V1';
  readonly shadowStatus: 'SHADOW_SPECULATIVE';
  readonly templateId: string;
  readonly provider: SubscriptionCliProvider;
  readonly identityRole: Exclude<AiOpsIdentityRole, 'RESEARCH_TRADE_CONTEXT_ADVISOR'>;
  readonly configurationState: 'NOT_CONFIGURED';
  readonly activationAllowed: false;
  readonly executable: 'codex' | 'claude';
  readonly argv: readonly string[];
  readonly cwdBinding: 'ISOLATED_WORKTREE_ONLY';
  readonly environmentAllowlist: readonly string[];
  readonly environmentDenylist: readonly string[];
  readonly outerToolGatewayRequired: true;
  readonly arbitraryNetwork: 'DENIED';
  readonly authenticationSource: 'EXTERNAL_TRUSTED_PRIVATE_RUNNER_ONLY';
  readonly outputMode: 'MACHINE_READABLE_STRICT_SCHEMA';
  readonly modelBinding: 'I00_PINNED_MODEL_ID_REQUIRED';
  readonly cliVersionBinding: 'I00_PINNED_CLI_VERSION_REQUIRED';
  readonly preToolEnforcement: 'OUTER_GATEWAY_REQUIRED' | 'OUTER_GATEWAY_AND_CLAUDE_PRE_TOOL_HOOK_REQUIRED';
}

const OUTPUT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    requestId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' },
    resultDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    status: { type: 'string', enum: ['COMPLETED', 'BLOCKED', 'FAILED'] },
  },
  required: ['requestId', 'resultDigest', 'status'],
  additionalProperties: false,
});

const AUTH_ENV_DENYLIST = Object.freeze([
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);
const CLAUDE_DENIED_TOOLS = Object.freeze([
  'Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Agent', 'Task',
  'TaskCreate', 'TaskUpdate', 'EnterPlanMode', 'ExitPlanMode',
]);

function codexSandbox(role: SubscriptionCliTemplate['identityRole']): 'read-only' | 'workspace-write' {
  return role === 'ENGINEERING_REPAIR_WORKER' ? 'workspace-write' : 'read-only';
}

function codexTemplate(role: SubscriptionCliTemplate['identityRole']): Readonly<SubscriptionCliTemplate> {
  return Object.freeze({
    schema: 'AI_OPS_SUBSCRIPTION_CLI_TEMPLATE_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    templateId: `codex-cli-${role.toLowerCase().replaceAll('_', '-')}`,
    provider: 'CODEX_CLI',
    identityRole: role,
    configurationState: 'NOT_CONFIGURED',
    activationAllowed: false,
    executable: 'codex',
    argv: Object.freeze([
      '--ask-for-approval',
      'never',
      'exec',
      '-C',
      '<ISOLATED_WORKTREE_PATH>',
      '--ephemeral',
      '--ignore-user-config',
      '--model',
      '<I00_PINNED_MODEL_ID>',
      '--sandbox',
      codexSandbox(role),
      '-c',
      'sandbox_workspace_write.network_access=false',
      '--json',
      '--output-schema',
      '<OUTPUT_SCHEMA_FILE_IN_ISOLATED_WORKTREE>',
      '<BOUNDED_REDACTED_PROMPT>',
    ]),
    cwdBinding: 'ISOLATED_WORKTREE_ONLY',
    environmentAllowlist: Object.freeze(['NO_COLOR']),
    environmentDenylist: AUTH_ENV_DENYLIST,
    outerToolGatewayRequired: true,
    arbitraryNetwork: 'DENIED',
    authenticationSource: 'EXTERNAL_TRUSTED_PRIVATE_RUNNER_ONLY',
    outputMode: 'MACHINE_READABLE_STRICT_SCHEMA',
    modelBinding: 'I00_PINNED_MODEL_ID_REQUIRED',
    cliVersionBinding: 'I00_PINNED_CLI_VERSION_REQUIRED',
    preToolEnforcement: 'OUTER_GATEWAY_REQUIRED',
  });
}

function claudeTemplate(role: SubscriptionCliTemplate['identityRole']): Readonly<SubscriptionCliTemplate> {
  const allowedTools = '';
  return Object.freeze({
    schema: 'AI_OPS_SUBSCRIPTION_CLI_TEMPLATE_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    templateId: `claude-code-cli-${role.toLowerCase().replaceAll('_', '-')}`,
    provider: 'CLAUDE_CODE_CLI',
    identityRole: role,
    configurationState: 'NOT_CONFIGURED',
    activationAllowed: false,
    executable: 'claude',
    argv: Object.freeze([
      '-p',
      '<BOUNDED_REDACTED_PROMPT>',
      '--model',
      '<I00_PINNED_MODEL_ID>',
      '--output-format',
      'json',
      '--json-schema',
      OUTPUT_SCHEMA,
      '--no-session-persistence',
      '--max-turns',
      '6',
      '--permission-mode',
      'dontAsk',
      '--tools',
      allowedTools,
      '--allowedTools',
      allowedTools,
      '--disallowedTools',
      ...CLAUDE_DENIED_TOOLS,
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--settings',
      '<A3_FAIL_CLOSED_SETTINGS_WITH_PRE_TOOL_HOOK>',
    ]),
    cwdBinding: 'ISOLATED_WORKTREE_ONLY',
    environmentAllowlist: Object.freeze(['NO_COLOR']),
    environmentDenylist: AUTH_ENV_DENYLIST,
    outerToolGatewayRequired: true,
    arbitraryNetwork: 'DENIED',
    authenticationSource: 'EXTERNAL_TRUSTED_PRIVATE_RUNNER_ONLY',
    outputMode: 'MACHINE_READABLE_STRICT_SCHEMA',
    modelBinding: 'I00_PINNED_MODEL_ID_REQUIRED',
    cliVersionBinding: 'I00_PINNED_CLI_VERSION_REQUIRED',
    preToolEnforcement: 'OUTER_GATEWAY_AND_CLAUDE_PRE_TOOL_HOOK_REQUIRED',
  });
}

const ACTIVE_ROLES = Object.freeze([
  'RUNTIME_DIAGNOSTICIAN',
  'ENGINEERING_REPAIR_WORKER',
  'INDEPENDENT_VERIFIER',
] as const);

export const SUBSCRIPTION_CLI_TEMPLATES: readonly Readonly<SubscriptionCliTemplate>[] = Object.freeze(
  ACTIVE_ROLES.flatMap((role) => [codexTemplate(role), claudeTemplate(role)]),
);

const FORBIDDEN_ARGUMENTS = Object.freeze([
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-skip-permissions',
  '--full-auto',
  '--yolo',
  'bypassPermissions',
  '--fallback-model',
  'danger-full-access',
]);

export function validateSubscriptionCliTemplates(): readonly string[] {
  const issues: string[] = [];
  for (const template of SUBSCRIPTION_CLI_TEMPLATES) {
    if (!isBoundedIdentifier(template.templateId)) issues.push(`INVALID_TEMPLATE_ID:${template.templateId}`);
    if (template.configurationState !== 'NOT_CONFIGURED' || template.activationAllowed !== false) {
      issues.push(`TEMPLATE_ACTIVATED:${template.templateId}`);
    }
    if (template.argv.some((argument) => FORBIDDEN_ARGUMENTS.includes(argument))) {
      issues.push(`BYPASS_ARGUMENT_PRESENT:${template.templateId}`);
    }
    if (template.environmentDenylist.some((key) => template.environmentAllowlist.includes(key as 'NO_COLOR'))) {
      issues.push(`AUTH_ENVIRONMENT_ALLOWLISTED:${template.templateId}`);
    }
    if (!template.argv.includes('--json') && !template.argv.includes('--output-format')) {
      issues.push(`MACHINE_OUTPUT_MISSING:${template.templateId}`);
    }
    if (template.provider === 'CODEX_CLI' && template.argv.indexOf('--ask-for-approval') > template.argv.indexOf('exec')) {
      issues.push(`CODEX_GLOBAL_APPROVAL_FLAG_MISORDERED:${template.templateId}`);
    }
    if (template.provider === 'CLAUDE_CODE_CLI') {
      const toolsIndex = template.argv.indexOf('--tools');
      const allowedToolsIndex = template.argv.indexOf('--allowedTools');
      if (toolsIndex < 0 || allowedToolsIndex < 0 || template.argv[toolsIndex + 1] !== '' || template.argv[allowedToolsIndex + 1] !== '') {
        issues.push(`CLAUDE_SHADOW_TOOL_SURFACE_NOT_EMPTY:${template.templateId}`);
      }
      const deniedToolsIndex = template.argv.indexOf('--disallowedTools');
      const strictMcpIndex = template.argv.indexOf('--strict-mcp-config');
      const deniedTools = deniedToolsIndex < 0 || strictMcpIndex <= deniedToolsIndex
        ? []
        : template.argv.slice(deniedToolsIndex + 1, strictMcpIndex);
      if (deniedTools.length !== CLAUDE_DENIED_TOOLS.length
        || deniedTools.some((value, index) => value !== CLAUDE_DENIED_TOOLS[index])) {
        issues.push(`CLAUDE_DENY_RULES_NOT_PINNED:${template.templateId}`);
      }
    }
  }
  return Object.freeze(issues);
}
