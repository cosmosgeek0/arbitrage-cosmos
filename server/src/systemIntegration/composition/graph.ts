import { PromisePollManagedComponent } from './promisePollAdapter.js';
import type { CoreRuntimePorts } from './types.js';

export interface CoreManagedGraph {
  readonly ordered: readonly PromisePollManagedComponent[];
}

/**
 * Stable sibling order intentionally preserves the existing Basis-before-
 * Volume startup intent. Foundation reverses this exact order for shutdown.
 */
export function createCoreManagedGraph(
  ports: CoreRuntimePorts,
  stepTimeoutMs?: number,
): CoreManagedGraph {
  const market = new PromisePollManagedComponent({
    componentId: 'market-universe',
    required: true,
    dependsOn: [],
    stepTimeoutMs,
    // init() now owns a cancellable/invalidatable MarketEngine generation.
    // A managed timeout must therefore call stop() even before activation.
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.market.validate?.(ctx),
    launch: () => ports.market.init(),
    activate: () => ports.market.start(),
    stop: () => ports.market.stop(),
    health: (ctx) => ports.market.health(ctx),
  });
  const basis = new PromisePollManagedComponent({
    componentId: 'basis-engine',
    required: false,
    dependsOn: ['market-universe'],
    stepTimeoutMs,
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.basis.validate?.(ctx),
    launch: () => ports.basis.start(),
    stop: () => ports.basis.stop(),
    health: (ctx) => ports.basis.health(ctx),
  });
  const volume = new PromisePollManagedComponent({
    componentId: 'volume-engine',
    required: false,
    dependsOn: ['market-universe'],
    stepTimeoutMs,
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.volume.validate?.(ctx),
    launch: () => ports.volume.start(),
    stop: () => ports.volume.stop(),
    health: (ctx) => ports.volume.health(ctx),
  });
  const ordered = Object.freeze([market, basis, volume]);
  return Object.freeze({ ordered });
}
