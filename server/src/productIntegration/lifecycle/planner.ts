import type {
  ProductComponentProjection,
  ProductComponentRole,
  ProductSupervisorProjection,
} from '../contracts/index.js';

export const PRODUCT_LIFECYCLE_PLAN_KINDS = Object.freeze([
  'BOOT',
  'PAUSE_INTAKE',
  'MAINTENANCE_DRAIN',
  'GRACEFUL_SHUTDOWN',
  'SAFE_COMPONENT_RESTART',
  'RECOVERY_ONLY',
  'RESTART_RECONCILIATION',
] as const);
export type ProductLifecyclePlanKind = (typeof PRODUCT_LIFECYCLE_PLAN_KINDS)[number];

export const PRODUCT_LIFECYCLE_OPERATION_KINDS = Object.freeze([
  'BLOCK_NEW_ENTRIES',
  'REQUEST_COMPONENT_START',
  'REQUEST_COMPONENT_PAUSE',
  'REQUEST_COMPONENT_DRAIN',
  'REQUEST_COMPONENT_STOP',
  'REQUEST_COMPONENT_RESTART',
  'REQUEST_RECONCILIATION',
  'PRESERVE_RECOVERY_CAPABILITY',
  'CHECKPOINT_DURABLE_STATE',
  'VERIFY_RESTART_BARRIER',
  'RELEASE_INTAKE_IF_GATES_PASS',
] as const);
export type ProductLifecycleOperationKind = (typeof PRODUCT_LIFECYCLE_OPERATION_KINDS)[number];

export interface ProductLifecycleOperation {
  readonly operationId: string;
  readonly sequence: number;
  readonly kind: ProductLifecycleOperationKind;
  readonly componentId: string | null;
  readonly ownerCommandId: string | null;
  readonly dependsOnOperationIds: readonly string[];
  readonly reason: string;
}

export interface ProductLifecyclePlan {
  readonly schemaVersion: 1;
  readonly kind: ProductLifecyclePlanKind;
  readonly generatedFromRevision: number;
  readonly targetComponentId: string | null;
  readonly operations: readonly Readonly<ProductLifecycleOperation>[];
  readonly blockers: readonly string[];
  readonly changesState: false;
  readonly delegatedToCanonicalControl: true;
}

export interface PlanProductLifecycleInput {
  readonly kind: ProductLifecyclePlanKind;
  readonly supervisor: Readonly<ProductSupervisorProjection>;
  readonly targetComponentId?: string;
}

function role(component: ProductComponentProjection, value: ProductComponentRole): boolean {
  return component.roles.includes(value);
}

function supportsExactCommand(component: ProductComponentProjection, token: string): boolean {
  return component.supportedCommandIds.some((commandId) => commandId.toLowerCase().split(/[.\-:]/).at(-1) === token);
}

function topo(components: readonly ProductComponentProjection[]): readonly ProductComponentProjection[] {
  const byId = new Map(components.map((component) => [component.componentId, component] as const));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: ProductComponentProjection[] = [];
  const visit = (component: ProductComponentProjection): void => {
    if (visited.has(component.componentId)) return;
    if (visiting.has(component.componentId)) throw new TypeError('supervisor graph contains a dependency cycle');
    visiting.add(component.componentId);
    for (const dependencyId of [...component.requiredDependencies, ...component.optionalDependencies]) {
      const dependency = byId.get(dependencyId);
      if (!dependency) throw new TypeError(`supervisor graph is missing '${dependencyId}'`);
      visit(dependency);
    }
    visiting.delete(component.componentId);
    visited.add(component.componentId);
    ordered.push(component);
  };
  components.forEach(visit);
  return Object.freeze(ordered);
}

function dependentClosure(targetId: string, components: readonly ProductComponentProjection[]): Set<string> {
  const closure = new Set([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of components) {
      if (closure.has(component.componentId)) continue;
      if (component.requiredDependencies.some((dependency) => closure.has(dependency))) {
        closure.add(component.componentId);
        changed = true;
      }
    }
  }
  return closure;
}

class OperationBuilder {
  readonly operations: ProductLifecycleOperation[] = [];
  readonly blockers: string[];

  constructor(blockers: string[]) {
    this.blockers = blockers;
  }

  add(kind: ProductLifecycleOperationKind, component: ProductComponentProjection | null, reason: string, dependencies: readonly string[] = []): string {
    const operationId = `op-${String(this.operations.length + 1).padStart(3, '0')}-${kind.toLowerCase().replaceAll('_', '-')}`;
    const exactToken = (commandId: string, token: string): boolean => commandId.toLowerCase().split(/[.\-:]/).at(-1) === token;
    const ownerCommandId = component?.supportedCommandIds.find((commandId) => {
      if (kind === 'REQUEST_COMPONENT_START') return exactToken(commandId, 'start');
      if (kind === 'REQUEST_COMPONENT_PAUSE') return exactToken(commandId, 'pause');
      if (kind === 'REQUEST_COMPONENT_DRAIN') return exactToken(commandId, 'drain');
      if (kind === 'REQUEST_COMPONENT_STOP') return exactToken(commandId, 'stop');
      if (kind === 'REQUEST_COMPONENT_RESTART') return exactToken(commandId, 'restart');
      if (kind === 'REQUEST_RECONCILIATION') return exactToken(commandId, 'reconcile');
      if (kind === 'CHECKPOINT_DURABLE_STATE') return exactToken(commandId, 'checkpoint');
      return false;
    }) ?? null;
    if (component !== null
        && ['REQUEST_COMPONENT_START', 'REQUEST_COMPONENT_PAUSE', 'REQUEST_COMPONENT_DRAIN', 'REQUEST_COMPONENT_STOP', 'REQUEST_COMPONENT_RESTART', 'REQUEST_RECONCILIATION', 'CHECKPOINT_DURABLE_STATE'].includes(kind)
        && ownerCommandId === null) this.blockers.push(`COMMAND_UNAVAILABLE:${kind}:${component.componentId}`);
    this.operations.push(Object.freeze({
      operationId,
      sequence: this.operations.length + 1,
      kind,
      componentId: component?.componentId ?? null,
      ownerCommandId,
      dependsOnOperationIds: Object.freeze([...dependencies]),
      reason,
    }));
    return operationId;
  }
}

/**
 * Emit intended operations only. The existing Foundation Control Plane owns
 * validation, state mutation, idempotency, persistence, and execution.
 */
export function planProductLifecycle(input: PlanProductLifecycleInput): Readonly<ProductLifecyclePlan> {
  if (!(PRODUCT_LIFECYCLE_PLAN_KINDS as readonly string[]).includes(input.kind)) throw new TypeError('unknown lifecycle plan kind');
  const components = topo(input.supervisor.components);
  const byId = new Map(components.map((component) => [component.componentId, component] as const));
  const blockers: string[] = [];
  const builder = new OperationBuilder(blockers);
  const lifecycleManaged = (component: ProductComponentProjection): boolean => component.requiredForProductReadiness
    || !['UNAVAILABLE', 'NOT_CONFIGURED'].includes(component.capability);
  const exposed = components.some((component) => component.capitalExposed);
  const unresolvedRecovery = exposed || components.some((component) => component.observedLifecycle === 'RECOVERY_REQUIRED'
    || component.blockerCodes.some((code) => /AMBIGUOUS|LIABILITY|RECOVERY|UNMATCHED_FILL|OPEN_POSITION/.test(code)));
  const intake = components.filter((component) => role(component, 'INTAKE') || role(component, 'OPPORTUNITY'));
  const analytical = components.filter((component) => role(component, 'ANALYTICAL') && lifecycleManaged(component));
  const reconciliation = components.filter((component) => role(component, 'RECONCILIATION'));
  const recovery = components.filter((component) => role(component, 'RECOVERY'));
  const persistence = components.filter((component) => role(component, 'PERSISTENCE'));
  const requireRoles = (requirements: readonly Readonly<{ components: readonly ProductComponentProjection[]; blocker: string }>[]): boolean => {
    let complete = true;
    for (const requirement of requirements) {
      if (requirement.components.length === 0) {
        blockers.push(requirement.blocker);
        complete = false;
      }
    }
    return complete;
  };
  const start = (selected: readonly ProductComponentProjection[], reason: string, prerequisite: string | null): string | null => {
    let prior = prerequisite;
    for (const component of selected) {
      prior = builder.add('REQUEST_COMPONENT_START', component, reason, prior ? [prior] : []);
    }
    return prior;
  };
  const blockEntries = (reason: string): string => builder.add('BLOCK_NEW_ENTRIES', null, reason);

  if (input.kind === 'BOOT') {
    const safetyRolesPresent = requireRoles([
      { components: persistence, blocker: 'PERSISTENCE_COMPONENT_MISSING' },
      { components: reconciliation, blocker: 'RECONCILIATION_COMPONENT_MISSING' },
      { components: recovery, blocker: 'RECOVERY_COMPONENT_MISSING' },
    ]);
    let prior = start(persistence, 'Start canonical persistence before reading restart truth.', null);
    prior = builder.add('VERIFY_RESTART_BARRIER', null, 'Canonical persistence/restart owner must prove no unresolved ambiguity before admission.', prior ? [prior] : []);
    for (const component of components.filter((candidate) => !role(candidate, 'PERSISTENCE') && lifecycleManaged(candidate))) prior = builder.add('REQUEST_COMPONENT_START', component, 'Start in dependency order after owner validation.', [prior]);
    for (const component of reconciliation) prior = builder.add('REQUEST_RECONCILIATION', component, 'Reconcile owner truth after startup and before admission.', [prior]);
    if (safetyRolesPresent && blockers.length === 0) builder.add('RELEASE_INTAKE_IF_GATES_PASS', null, 'Release only after canonical readiness, Capital, Risk, and reconciliation gates pass.', [prior]);
  } else if (input.kind === 'PAUSE_INTAKE') {
    const blocked = blockEntries('Pause all new risk-increasing work while preserving observation and recovery.');
    intake.forEach((component) => builder.add('REQUEST_COMPONENT_PAUSE', component, 'Pause canonical intake owner.', [blocked]));
  } else if (input.kind === 'MAINTENANCE_DRAIN') {
    requireRoles([
      { components: persistence, blocker: 'PERSISTENCE_COMPONENT_MISSING' },
      { components: reconciliation, blocker: 'RECONCILIATION_COMPONENT_MISSING' },
      { components: recovery, blocker: 'RECOVERY_COMPONENT_MISSING' },
    ]);
    let prior = blockEntries('Maintenance begins by blocking new entries.');
    intake.forEach((component) => { prior = builder.add('REQUEST_COMPONENT_PAUSE', component, 'Pause proposal/ticket intake.', [prior]); });
    analytical.slice().reverse().forEach((component) => { prior = builder.add('REQUEST_COMPONENT_DRAIN', component, 'Drain bounded analytical queues.', [prior]); });
    reconciliation.forEach((component) => { prior = builder.add('REQUEST_RECONCILIATION', component, 'Reconcile before maintenance checkpoint.', [prior]); });
    if (recovery[0]) prior = builder.add('PRESERVE_RECOVERY_CAPABILITY', recovery[0], 'Recovery and risk-reducing capability remains available.', [prior]);
    if (persistence[0]) builder.add('CHECKPOINT_DURABLE_STATE', persistence[0], 'Delegate application-consistent checkpoint to existing ledger owner.', [prior]);
  } else if (input.kind === 'GRACEFUL_SHUTDOWN') {
    const safetyRolesPresent = requireRoles([
      { components: persistence, blocker: 'PERSISTENCE_COMPONENT_MISSING' },
      { components: reconciliation, blocker: 'RECONCILIATION_COMPONENT_MISSING' },
      { components: recovery, blocker: 'RECOVERY_COMPONENT_MISSING' },
    ]);
    if (unresolvedRecovery) blockers.push('EXPOSURE_OR_RECOVERY_PRESENT_RECOVERY_ONLY_REQUIRED');
    let prior = blockEntries('Shutdown always blocks new risk first.');
    intake.forEach((component) => { prior = builder.add('REQUEST_COMPONENT_PAUSE', component, 'Stop new intake.', [prior]); });
    analytical.slice().reverse().forEach((component) => { prior = builder.add('REQUEST_COMPONENT_DRAIN', component, 'Drain analytical queues.', [prior]); });
    reconciliation.forEach((component) => { prior = builder.add('REQUEST_RECONCILIATION', component, 'Reconcile before stopping sources.', [prior]); });
    if (!unresolvedRecovery && safetyRolesPresent && blockers.length === 0) {
      if (!persistence[0] || !supportsExactCommand(persistence[0], 'checkpoint')) blockers.push('COMMAND_UNAVAILABLE:CHECKPOINT_DURABLE_STATE:PERSISTENCE');
      for (const component of components.filter(lifecycleManaged)) {
        if (!supportsExactCommand(component, 'stop')) blockers.push(`COMMAND_UNAVAILABLE:REQUEST_COMPONENT_STOP:${component.componentId}`);
      }
    }
    if (unresolvedRecovery || !safetyRolesPresent || blockers.length > 0) {
      if (recovery[0]) builder.add('PRESERVE_RECOVERY_CAPABILITY', recovery[0], 'Exposure or missing safety ownership prevents ordinary shutdown; remain in recovery-only posture.', [prior]);
    } else {
      prior = builder.add('CHECKPOINT_DURABLE_STATE', persistence[0] ?? null, 'Checkpoint before reverse dependency shutdown.', [prior]);
      for (const component of components.slice().reverse().filter(lifecycleManaged)) prior = builder.add('REQUEST_COMPONENT_STOP', component, 'Stop in reverse dependency order.', [prior]);
    }
  } else if (input.kind === 'SAFE_COMPONENT_RESTART') {
    const target = input.targetComponentId ? byId.get(input.targetComponentId) : undefined;
    if (!target) throw new TypeError('SAFE_COMPONENT_RESTART requires a known targetComponentId');
    const closure = dependentClosure(target.componentId, components);
    const safetyRolesPresent = requireRoles([
      { components: persistence, blocker: 'PERSISTENCE_COMPONENT_MISSING' },
      { components: reconciliation, blocker: 'RECONCILIATION_COMPONENT_MISSING' },
      { components: recovery, blocker: 'RECOVERY_COMPONENT_MISSING' },
    ]);
    let prior = blockEntries('Safe restart blocks new entries before changing component state.');
    if (unresolvedRecovery && [...closure].some((componentId) => {
      const candidate = byId.get(componentId) as ProductComponentProjection;
      return role(candidate, 'PERSISTENCE') || role(candidate, 'PRIVATE_TRUTH') || role(candidate, 'EXECUTION') || role(candidate, 'RECONCILIATION') || role(candidate, 'RECOVERY');
    })) {
      blockers.push('EXPOSURE_OR_RECOVERY_RESTART_REQUIRES_CANONICAL_RECOVERY_PLAN');
      if (!recovery[0]) blockers.push('RECOVERY_COMPONENT_MISSING');
      else builder.add('PRESERVE_RECOVERY_CAPABILITY', recovery[0], 'Refuse restart that could disable recovery while exposure or unresolved recovery exists.', [prior]);
      return Object.freeze({
        schemaVersion: 1, kind: input.kind, generatedFromRevision: input.supervisor.revision,
        targetComponentId: input.targetComponentId ?? null, operations: Object.freeze(builder.operations),
        blockers: Object.freeze(blockers), changesState: false, delegatedToCanonicalControl: true,
      });
    }
    for (const component of components.slice().reverse().filter((candidate) => closure.has(candidate.componentId) && candidate.componentId !== target.componentId && lifecycleManaged(candidate))) {
      prior = builder.add('REQUEST_COMPONENT_STOP', component, 'Stop dependent before its dependency restarts.', [prior]);
    }
    prior = builder.add('REQUEST_COMPONENT_RESTART', target, 'Delegate restart to canonical component/control owner.', [prior]);
    for (const component of components.filter((candidate) => closure.has(candidate.componentId) && candidate.componentId !== target.componentId && lifecycleManaged(candidate))) {
      prior = builder.add('REQUEST_COMPONENT_START', component, 'Restart dependent after dependency readiness.', [prior]);
    }
    reconciliation.forEach((component) => { prior = builder.add('REQUEST_RECONCILIATION', component, 'Reconcile after restart before intake admission.', [prior]); });
    if (safetyRolesPresent && blockers.length === 0) builder.add('RELEASE_INTAKE_IF_GATES_PASS', null, 'Release only after canonical gates pass.', [prior]);
  } else if (input.kind === 'RECOVERY_ONLY') {
    requireRoles([
      { components: persistence, blocker: 'PERSISTENCE_COMPONENT_MISSING' },
      { components: reconciliation, blocker: 'RECONCILIATION_COMPONENT_MISSING' },
      { components: recovery, blocker: 'RECOVERY_COMPONENT_MISSING' },
    ]);
    let prior = blockEntries('Recovery-only posture forbids new risk-increasing work.');
    prior = start([...persistence, ...reconciliation, ...recovery].filter((component, index, array) => array.findIndex((candidate) => candidate.componentId === component.componentId) === index), 'Start or preserve truth/recovery owner.', prior) ?? prior;
    for (const component of intake) prior = builder.add('REQUEST_COMPONENT_PAUSE', component, 'Keep intake paused in recovery-only posture.', [prior]);
    if (recovery[0]) builder.add('PRESERVE_RECOVERY_CAPABILITY', recovery[0], 'Preserve exit, cancel, reconcile, repay, and recovery capability.', [prior]);
  } else if (input.kind === 'RESTART_RECONCILIATION') {
    const safetyRolesPresent = requireRoles([
      { components: persistence, blocker: 'PERSISTENCE_COMPONENT_MISSING' },
      { components: reconciliation, blocker: 'RECONCILIATION_COMPONENT_MISSING' },
      { components: recovery, blocker: 'RECOVERY_COMPONENT_MISSING' },
    ]);
    let prior = blockEntries('Restart reconciliation blocks new exposure.');
    prior = start(persistence, 'Restore canonical persistence first.', prior) ?? prior;
    for (const component of components.filter((candidate) => role(candidate, 'PRIVATE_TRUTH') && lifecycleManaged(candidate))) prior = builder.add('REQUEST_COMPONENT_START', component, 'Refresh private truth through accepted owner.', [prior]);
    for (const component of reconciliation) prior = builder.add('REQUEST_RECONCILIATION', component, 'Resolve local/exchange truth before admission.', [prior]);
    for (const component of recovery) prior = builder.add('REQUEST_COMPONENT_START', component, 'Resume active recovery supervision before analytics.', [prior]);
    if (persistence[0]) prior = builder.add('CHECKPOINT_DURABLE_STATE', persistence[0], 'Persist restart/reconciliation result.', [prior]);
    if (safetyRolesPresent && blockers.length === 0) builder.add('RELEASE_INTAKE_IF_GATES_PASS', null, 'Release only after reconciliation reports an admitted state.', [prior]);
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: input.kind,
    generatedFromRevision: input.supervisor.revision,
    targetComponentId: input.targetComponentId ?? null,
    operations: Object.freeze(builder.operations),
    blockers: Object.freeze(blockers),
    changesState: false,
    delegatedToCanonicalControl: true,
  });
}
