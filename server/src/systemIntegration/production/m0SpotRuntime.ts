/**
 * Source-only runtime mount for the accepted M0 Spot coordinator and adapter.
 *
 * This sanctioned System Integration composer imports the accepted execution
 * adapter, but never a signed mapper or request kernel. The
 * production instance deliberately owns no signer, credential, dispatcher,
 * private read, ticket issuer, authority issuer, persistence writer, or disarm
 * owner. The first coordinator admission remains frozen OFF / kill ON / empty
 * allowlist and therefore runs before the sealed input or hard-deny adapter can
 * be touched.
 */
import {
  DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG,
} from '../../foundation/execution/spotValidateOnly.js';
import {
  runSpotTransportCoordinator,
  type SpotTransportCoordinatorInput,
  type SpotTransportCoordinatorPorts,
} from '../../foundation/execution/spotTransportCoordinator.js';
import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
} from '../../foundation/risk/spotRiskPolicy.js';
import {
  createBinanceSpotExecutionAdapter,
} from '../../liveEdge/adapters/binanceSpotExecution/adapter.js';
import {
  generateM0AutomaticReceipt,
} from '../evidence/m0AutomaticReceipt.js';
import {
  M0_SPOT_CANARY_ROUTE_SCHEMA,
  type M0SpotCanarySourceMountInput,
  type M0SpotCanarySourceMountPort,
  type M0SpotCanarySourceMountResult,
} from '../routes/types.js';

const M0_SOURCE_MOUNT_SYMBOL = 'BTCUSDT';
const M0_SOURCE_MOUNT_REVISION = 'm0-i2-source-mount-c245-v1';
const M0_REQUEST_ID = /^m0_req_[0-9a-f]{32}$/u;

const SOURCE_ADMISSION = Object.freeze({
  revision: M0_SOURCE_MOUNT_REVISION,
  sourceEnabled: DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.sourceEnabled,
  killSwitchEngaged:
    DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.killSwitchEngaged,
  allowedSymbols: DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.allowedSymbols,
  blockedSymbols: DEFAULT_SPOT_VALIDATE_ONLY_SEAM_CONFIG.blockedSymbols,
});

const SEALED_INPUT = Object.freeze(
  Object.create(null) as Record<string, never>,
) as unknown as Readonly<SpotTransportCoordinatorInput>;

function closedInput(input: Readonly<M0SpotCanarySourceMountInput>): boolean {
  return (
    input !== null
    && typeof input === 'object'
    && !Array.isArray(input)
    && M0_REQUEST_ID.test(input.requestId)
    && input.ownerConfirmation === 'YES'
    && input.operator !== null
    && typeof input.operator === 'object'
    && typeof input.operator.id === 'string'
    && input.operator.id.length > 0
    && (input.operator.source === 'loopback'
      || input.operator.source === 'cloudflare-access')
  );
}

function forbidden(): never {
  throw new Error('M0_SOURCE_MOUNT_EFFECT_FORBIDDEN');
}

/**
 * Construct one inert source mount. Construction performs no I/O and captures
 * no ambient process state.
 */
export function createM0SpotRuntimeMount(): M0SpotCanarySourceMountPort {
  const executionPort = createBinanceSpotExecutionAdapter({
    async send() {
      return forbidden();
    },
    verifyLiveSubmitIntent: () => false,
    verifyFlattenIntent: () => false,
    verifyCancelIntent: () => false,
  });

  const coordinatorPorts: Readonly<SpotTransportCoordinatorPorts> =
    Object.freeze({
      clock: Object.freeze({ nowMs: forbidden }),
      executionPort,
      readAdmission: () => SOURCE_ADMISSION,
      consumeAuthority: async () => forbidden(),
      verifySignedTestEvidence: async () => forbidden(),
      appendLedger: async () => forbidden(),
      readFlatEvidence: async () => forbidden(),
    });

  return Object.freeze({
    async inspectSourceMount(
      input: Readonly<M0SpotCanarySourceMountInput>,
    ): Promise<Readonly<M0SpotCanarySourceMountResult>> {
      if (!closedInput(input)) {
        throw new TypeError('M0 source-mount invocation is invalid');
      }

      const coordinator = await runSpotTransportCoordinator(
        M0_SOURCE_MOUNT_SYMBOL,
        SEALED_INPUT,
        coordinatorPorts,
      );
      if (
        coordinator.status !== 'BLOCKED'
        || coordinator.reasonCodes[0] !== 'KILL_SWITCH_ENGAGED_OR_UNKNOWN'
        || coordinator.calls.admissions !== 1
        || Object.entries(coordinator.calls).some(
          ([name, value]) => name !== 'admissions' && value !== 0,
        )
      ) {
        throw new Error('M0_SOURCE_MOUNT_CLOSED_POSTURE_VIOLATION');
      }

      return Object.freeze({
        schema: M0_SPOT_CANARY_ROUTE_SCHEMA,
        ok: false as const,
        code: 'M0_SOURCE_MOUNT_BLOCKED' as const,
        state: 'SOURCE_MOUNTED_NOT_ACTIVATED' as const,
        sourceMounted: true as const,
        runtimeActivated: false as const,
        hostProvisioned: false as const,
        liveExecutionPermitted: false as const,
        maximumOrderNotionalQuote: OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
        ownerConfirmation: 'ACKNOWLEDGED_NOT_AUTHORITY' as const,
        ticketAuthority: 'NONE' as const,
        authorityConsumption: 'NOT_ATTEMPTED' as const,
        executionKeyPermissions: 'NOT_PROVED' as const,
        signedTransport: 'HARD_DENY_NOT_CONFIGURED' as const,
        withdrawalPolicy: 'DISABLED' as const,
        transferPolicy: 'DISABLED' as const,
        flat: 'NOT_PROVED' as const,
        reconciliation: 'NOT_PROVED' as const,
        disarm: 'NOT_PROVED' as const,
        coordinator,
        inertEvidenceReceipt: generateM0AutomaticReceipt(undefined),
      });
    },
  });
}
