import type {
  AiOpsControlIntentDraft,
  AiOpsControlProjection,
  ControlKind,
  ControlValue,
  ProjectedSource,
} from './types';

interface CategoryDefinition {
  readonly code: string;
  readonly label: string;
  readonly owner: string;
  readonly controls: readonly string[];
}

export const AI_OPS_CONTROL_CATEGORIES: readonly CategoryDefinition[] = [
  {
    code: 'A',
    label: 'Lifecycle / emergency',
    owner: 'Canonical Control Plane',
    controls: [
      'AI master enable',
      'operating mode',
      'provider emergency kill',
      'automatic case creation',
      'manual case creation',
      'owner chat',
      'scheduled audit',
      'sentinel incident ingestion',
      'bounded diagnostic-worker restart',
      'AI-plane quarantine on control fault',
    ],
  },
  {
    code: 'B',
    label: 'Incident admission',
    owner: 'Deterministic Incident Gate',
    controls: [
      'minimum severity',
      'minimum materiality',
      'dwell threshold',
      'evidence-completeness floor',
      'evidence-age ceiling',
      'fingerprint-dedup window',
      'recurrence cooldown',
      'one-active-case-per-resource/fingerprint',
      'conflicting-evidence abstention',
      'critical-reserve admission',
    ],
  },
  {
    code: 'C',
    label: 'Provider / model routing',
    owner: 'Diagnostic Provider Router',
    controls: [
      'provider allowlist',
      'runtime diagnostic provider',
      'classifier model',
      'diagnostician model',
      'research model',
      'coding provider/model',
      'verifier provider/model',
      'fallback provider',
      'exact-version pin',
      'timeout/circuit-breaker policy',
    ],
  },
  {
    code: 'D',
    label: 'Budgets / concurrency',
    owner: 'Diagnostic Budget Owner',
    controls: [
      'hourly spend cap',
      'daily cap',
      'monthly cap',
      'per-incident spend',
      'per-incident tokens',
      'tool calls',
      'web searches',
      'maximum run duration',
      'global concurrent runs',
      'per-provider concurrency/retry cap',
    ],
  },
  {
    code: 'E',
    label: 'Data / retention',
    owner: 'Redaction and Retention Policy Owner',
    controls: [
      'financial-summary egress',
      'identity-specific source-code egress',
      'account-identifier exposure',
      'raw-log exposure',
      'trace-payload exposure',
      'DOM/screenshot exposure',
      'evidence-byte ceiling',
      'local retention',
      'provider retention posture',
      'redaction fail-closed lock',
    ],
  },
  {
    code: 'F',
    label: 'Web / retrieval',
    owner: 'Retrieval Policy Owner',
    controls: [
      'web research master',
      'domain-policy mode',
      'approved-domain allowlist',
      'primary-source requirement for code/operations',
      'market-context source policy',
      'source-age ceiling',
      'citation requirement',
      'claim/provenance hashing',
      'retrieved-content-is-data hard lock',
      'retrieval cache/expiry',
    ],
  },
  {
    code: 'G',
    label: 'Read / investigation tools',
    owner: 'Evidence Tool Gateway',
    controls: [
      'supervisor snapshots',
      'component detail',
      'incident evidence',
      'bounded metrics',
      'bounded traces',
      'structured logs',
      'Failure Atlas',
      'runbooks',
      'read-only replay',
      'fault/config/deployment comparisons',
    ],
  },
  {
    code: 'H',
    label: 'Repair sandbox',
    owner: 'Isolated Repair Sandbox Owner',
    controls: [
      'isolated patch enable',
      'approved worktree root',
      'read paths',
      'write paths',
      'forbidden-path hard lock',
      'sandbox network',
      'package-install policy',
      'registered test commands',
      'files/lines/diff ceiling',
      'process/time/CPU/memory/disk limits',
    ],
  },
  {
    code: 'I',
    label: 'Verification / release handoff',
    owner: 'Verification and Release Handoff Owner',
    controls: [
      'reproduce-before-patch',
      'failing regression test',
      'focused tests',
      'accumulated tests',
      'type/static/security/import gates',
      'replay/browser/fault gates',
      'independent verifier',
      'exact-hash approval',
      'approval TTL',
      'canary/rollback/independent readback',
    ],
  },
  {
    code: 'J',
    label: 'Class-A deterministic remediation',
    owner: 'Existing Command and Remediation Owner',
    controls: [
      'global Class-A availability',
      'per-runbook enablement',
      'maximum campaign actions',
      'attempt budget',
      'concurrency budget',
      'lease/fence',
      'cooldown/quiet period',
      'recurrence quarantine',
      'resource conflict graph',
      'maximum effect plus independent postcondition',
    ],
  },
  {
    code: 'K',
    label: 'Incident / paging / postmortem',
    owner: 'Notifications Owner',
    controls: [
      'paging destination',
      'critical paging',
      'owner-attention paging',
      'AI outage paging',
      'sentinel outage paging',
      'acknowledgement TTL',
      'escalation chain',
      'delivery verification',
      'postmortem threshold',
      'incident archive/retention',
    ],
  },
  {
    code: 'L',
    label: 'Learning / trade boundary',
    owner: 'Evaluation and Promotion Owner',
    controls: [
      'post-trade analysis',
      'rejected/missed-trade analysis',
      'shadow context assessment',
      'Q research-candidate creation',
      'regression-fixture drafting',
      'Failure Atlas drafting',
      'provider/model/prompt evaluation',
      'diagnosis-calibration threshold',
      'model/strategy promotion hard gate',
      'no-hot-path/no-money-authority hard lock',
    ],
  },
] as const;

export const ABSOLUTE_HARD_DENIALS = [
  'DIRECT_ORDER_ACTION',
  'BORROW_REPAY_TRANSFER_WITHDRAW',
  'RISK_OR_CAPITAL_MUTATION',
  'PRIVATE_CREDENTIAL_ACCESS',
  'PERMISSION_OR_GUARDRAIL_SELF_CHANGE',
  'EVIDENCE_OR_LEDGER_REWRITE',
  'MAIN_OR_LIVE_RUNTIME_WRITE',
  'SELF_APPROVAL_OR_SELF_VERIFICATION',
  'SELF_MERGE_OR_DEPLOY',
  'ARBITRARY_SHELL_NETWORK_OR_FILESYSTEM',
  'DISABLE_SAFETY_MONITORING_OR_RECONCILIATION',
  'CREATE_DUPLICATE_CONTROL_RISK_EXECUTION_OR_LEDGER_AUTHORITY',
] as const;

export const FORBIDDEN_CAPABILITY_REACHABILITY = Object.freeze(
  Object.fromEntries(ABSOLUTE_HARD_DENIALS.map((capability) => [capability, false])) as Readonly<
    Record<(typeof ABSOLUTE_HARD_DENIALS)[number], false>
  >,
);

const LOCKED_INVARIANTS = new Set([
  'E10',
  'F09',
  'H05',
  'L09',
  'L10',
]);

const NUMBER_CONTROLS = new Set([
  'B02',
  'B03',
  'B04',
  'B05',
  'B06',
  'B07',
  'D01',
  'D02',
  'D03',
  'D04',
  'D05',
  'D06',
  'D07',
  'D08',
  'D09',
  'D10',
  'E07',
  'E08',
  'F06',
  'F10',
  'H09',
  'H10',
  'I09',
  'J03',
  'J04',
  'J05',
  'J07',
  'K06',
  'K10',
  'L08',
]);

const STRING_SET_CONTROLS = new Set(['C01', 'F03', 'H03', 'H04', 'H08', 'J02', 'J09', 'K07']);

const ENUM_CONTROLS = new Set([
  'A02', 'A03', 'B01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10',
  'E09', 'F02', 'F05', 'H02', 'H06', 'H07', 'K01', 'K09',
]);

function valueEquals(left: ControlValue, right: ControlValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function kindFor(controlId: string): ControlKind {
  if (LOCKED_INVARIANTS.has(controlId)) return 'LOCKED_INVARIANT';
  if (NUMBER_CONTROLS.has(controlId)) return 'NUMBER';
  if (STRING_SET_CONTROLS.has(controlId)) return 'STRING_SET';
  if (ENUM_CONTROLS.has(controlId)) return 'ENUM';
  return 'BOOLEAN';
}

export function buildAiOpsControlSpecificationProjection(input: {
  readonly generatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly requestedControlIntents: Readonly<Record<string, ControlValue>>;
}): readonly AiOpsControlProjection[] {
  const source: ProjectedSource = {
    owner: 'POST-I00 directive section 10 specification catalog',
    sourceId: 'fixture:ai-ops-control-specification-projection',
    revision: 'shadow-spec-r1',
    observedAt: input.generatedAt,
    wiring: 'FIXTURE_ONLY',
  };

  return AI_OPS_CONTROL_CATEGORIES.flatMap((category) =>
    category.controls.map((label, index) => {
      const shortId = `${category.code}${String(index + 1).padStart(2, '0')}`;
      const controlId = `AI_OPS.${shortId}` as const;
      const type = kindFor(shortId);
      const locked = type === 'LOCKED_INVARIANT';
      const requested = input.requestedControlIntents[controlId] ?? null;

      return {
        controlId,
        category: category.code,
        categoryLabel: category.label,
        label,
        owner: category.owner,
        type,
        allowedValues: [],
        safeDefault: null,
        scope: 'AI_OPS_DIRECTIVE_SPECIFICATION_ONLY',
        environment: 'SYNTHETIC_FIXTURE',
        modeCeiling: 'UNKNOWN_UNTIL_SERVER_ENVELOPE',
        effectHandler: null,
        readbackHandler: null,
        approvalRequirement: locked ? 'DIRECTIVE_HARD_LOCK_NO_CLIENT_CHANGE' : 'UNFINISHED_CANONICAL_OWNER',
        ttl: null,
        revision: 'shadow-spec-r1',
        lastChangedBy: 'fixture-owner.invalid',
        reason: locked
          ? 'Directive-labeled hard lock only; canonical effective state and readback remain unknown.'
          : `Specification catalog row only; canonical schema, envelope, handlers, and readback are unfinished. ${input.provider}/${input.model} are obvious fixture identities.`,
        receiptId: null,
        currentStatus: 'NOT_WIRED' as const,
        requested,
        effective: null,
        readback: null,
        changedFromSafeDefault: false,
        dependencies: [],
        conflicts: locked ? ABSOLUTE_HARD_DENIALS : [],
        expiresAt: null,
        envelope: {
          envelopeId: `unmounted-envelope-${shortId.toLowerCase()}`,
          policyRevision: 'UNMOUNTED',
          requestableValues: [],
          authorityOrder: [],
          maximumAuthorityValue: null,
          serverMaximumSummary: 'UNKNOWN_UNTIL_CANONICAL_OWNER_MOUNTS',
          minimumSafetyFloor: locked ? 'DIRECTIVE_HARD_LOCK_NO_WEAKENING' : 'SERVER_DEFINED_AND_UNFINISHED',
          hardDenialsRemainUnreachable: true as const,
        },
        source,
      } satisfies AiOpsControlProjection;
    }),
  );
}

/**
 * Builds a UI request draft against an envelope already supplied by the server projection.
 * This function does not evaluate policy, mutate effective state, or grant authority.
 */
export function projectNarrowingControlIntent(
  control: AiOpsControlProjection,
  requested: ControlValue,
): AiOpsControlIntentDraft {
  if (control.type === 'LOCKED_INVARIANT') {
    return {
      schema: 'AiOpsControlIntentDraftV1',
      controlId: control.controlId,
      requested,
      baseRevision: control.revision,
      envelopeId: control.envelope.envelopeId,
      disposition: 'LOCKED_INVARIANT',
      reason: 'This directive hard-lock specification has no client mutation path; canonical effective state still requires independent readback.',
      effectiveUnchanged: true,
      readbackRequired: true,
      authorityCreated: false,
    };
  }

  if (!control.effectHandler || !control.readbackHandler || control.currentStatus === 'NOT_WIRED') {
    return {
      schema: 'AiOpsControlIntentDraftV1',
      controlId: control.controlId,
      requested,
      baseRevision: control.revision,
      envelopeId: control.envelope.envelopeId,
      disposition: 'NOT_WIRED',
      reason: 'No canonical effect handler, independent readback handler, or server authority envelope is mounted.',
      effectiveUnchanged: true,
      readbackRequired: true,
      authorityCreated: false,
    };
  }

  const requestedIndex = control.envelope.authorityOrder.findIndex((value) => valueEquals(value, requested));
  const maximumIndex = control.envelope.authorityOrder.findIndex((value) => valueEquals(value, control.envelope.maximumAuthorityValue));
  const requestable = control.envelope.requestableValues.some((value) => valueEquals(value, requested));
  const narrowsServerMaximum = requestedIndex >= 0 && maximumIndex >= 0 && requestedIndex <= maximumIndex;
  if (!requestable || !narrowsServerMaximum) {
    return {
      schema: 'AiOpsControlIntentDraftV1',
      controlId: control.controlId,
      requested,
      baseRevision: control.revision,
      envelopeId: control.envelope.envelopeId,
      disposition: 'CLIENT_NARROWING_REJECTED',
      reason: 'The request is not an owner-supplied value at or below the server maximum-authority value.',
      effectiveUnchanged: true,
      readbackRequired: true,
      authorityCreated: false,
    };
  }

  return {
    schema: 'AiOpsControlIntentDraftV1',
    controlId: control.controlId,
    requested,
    baseRevision: control.revision,
    envelopeId: control.envelope.envelopeId,
    disposition: 'PENDING_SERVER_POLICY',
    reason: 'This is a request draft only; compare-and-swap, policy, effect, durable receipt, and readback remain server-owned.',
    effectiveUnchanged: true,
    readbackRequired: true,
    authorityCreated: false,
  };
}

export function validateControlSpecificationProjection(
  controls: readonly AiOpsControlProjection[],
): readonly string[] {
  const violations: string[] = [];
  const expectedIds = AI_OPS_CONTROL_CATEGORIES.flatMap((category) =>
    category.controls.map((_, index) => `AI_OPS.${category.code}${String(index + 1).padStart(2, '0')}`),
  );
  const actualIds = controls.map((control) => control.controlId);

  if (controls.length !== 120) violations.push(`EXPECTED_120_CONTROLS_GOT_${controls.length}`);
  if (new Set(actualIds).size !== actualIds.length) violations.push('DUPLICATE_CONTROL_ID');
  if (expectedIds.some((expectedId) => !actualIds.includes(expectedId as AiOpsControlProjection['controlId']))) {
    violations.push('MISSING_REQUIRED_CONTROL_ID');
  }

  for (const control of controls) {
    if (!control.controlId.startsWith('AI_OPS.')) violations.push(`UNNAMESPACED:${control.controlId}`);
    if (!control.envelope.hardDenialsRemainUnreachable) violations.push(`HARD_DENIAL_WIDENED:${control.controlId}`);
    if (control.currentStatus === 'NOT_WIRED' && (control.effectHandler || control.readbackHandler)) {
      violations.push(`FALSE_WIRED:${control.controlId}`);
    }
    if (control.currentStatus === 'NOT_WIRED' && (control.effective !== null || control.readback !== null)) {
      violations.push(`FABRICATED_READBACK:${control.controlId}`);
    }
    const maximumIndex = control.envelope.authorityOrder.findIndex((value) => valueEquals(value, control.envelope.maximumAuthorityValue));
    for (const value of control.envelope.requestableValues) {
      const valueIndex = control.envelope.authorityOrder.findIndex((candidate) => valueEquals(candidate, value));
      if (maximumIndex < 0 || valueIndex < 0 || valueIndex > maximumIndex) {
        violations.push(`WIDENING_ENVELOPE_VALUE:${control.controlId}`);
      }
    }
  }

  return violations;
}
