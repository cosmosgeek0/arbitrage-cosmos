export type OrdinaryShutdownAdmissionPhase =
  | 'OPEN'
  | 'DRAIN_EVALUATING'
  | 'RECOVERY_ONLY'
  | 'IRREVERSIBLE_CLOSING';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PRODUCT_RECOVERY_CONTROL_IDS = new Set([
  'global.safe-mode.read-only',
  'global.kill-switch.engage',
  'global.intake.pause',
  'component.engine-supervisor.restart',
]);

function plainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recovery-only admission is deliberately narrower than the canonical control
 * API. It permits only fail-closed posture changes and the dependency-root
 * managed restart needed to reconcile a refused ordinary drain.
 */
export function isRecoveryOnlyMutation(
  method: string,
  path: string,
  body: unknown,
): boolean {
  if (method !== 'POST' || !plainObject(body)) return false;
  if (path === '/api/product-integration/v1/commands/preview'
      || path === '/api/product-integration/v1/commands') {
    return typeof body.controlId === 'string'
      && PRODUCT_RECOVERY_CONTROL_IDS.has(body.controlId);
  }
  if (path !== '/api/system-integration/controls') return false;
  switch (body.command) {
    case 'SET_SAFE_MODE':
      return body.safeMode === 'READ_ONLY';
    case 'SET_KILL_SWITCH':
      return body.engaged === true;
    case 'SET_INTAKE_PAUSED':
      return body.paused === true;
    case 'REVOKE_APPROVAL':
      return typeof body.approvalId === 'string';
    case 'REVOKE_RESERVATION':
      return typeof body.reservationId === 'string';
    case 'RESTART_COMPONENT':
      return body.componentId === 'market-universe';
    default:
      return false;
  }
}

export class OrdinaryShutdownAdmission {
  private phaseValue: OrdinaryShutdownAdmissionPhase = 'OPEN';

  phase(): OrdinaryShutdownAdmissionPhase {
    return this.phaseValue;
  }

  beginDrainEvaluation(): void {
    if (this.phaseValue !== 'OPEN' && this.phaseValue !== 'RECOVERY_ONLY') {
      throw new Error(`ordinary drain cannot begin from ${this.phaseValue}`);
    }
    this.phaseValue = 'DRAIN_EVALUATING';
  }

  refuseDrain(): void {
    if (this.phaseValue !== 'DRAIN_EVALUATING') {
      throw new Error(`ordinary drain cannot be refused from ${this.phaseValue}`);
    }
    this.phaseValue = 'RECOVERY_ONLY';
  }

  beginIrreversibleClose(): void {
    if (this.phaseValue !== 'DRAIN_EVALUATING') {
      throw new Error(`irreversible close cannot begin from ${this.phaseValue}`);
    }
    this.phaseValue = 'IRREVERSIBLE_CLOSING';
  }

  admitsMutation(method: string, path: string, body: unknown): boolean {
    if (READ_ONLY_METHODS.has(method)) return true;
    if (this.phaseValue === 'OPEN') return true;
    if (this.phaseValue === 'RECOVERY_ONLY') {
      return isRecoveryOnlyMutation(method, path, body);
    }
    return false;
  }

  admitsNewWebSocket(): boolean {
    return this.phaseValue === 'OPEN';
  }
}
