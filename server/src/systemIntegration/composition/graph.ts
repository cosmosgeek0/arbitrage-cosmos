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
    readinessRequirement: 'FRESH_SOURCE',
    // init() now owns a cancellable/invalidatable MarketEngine generation.
    // A managed timeout must therefore call stop() even before activation.
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.market.validate?.(ctx),
    launch: () => ports.market.init(),
    activate: () => ports.market.start(),
    stop: () => ports.market.stop(),
    health: (ctx) => ports.market.health(ctx),
  });
  const intelligenceRuntime = new PromisePollManagedComponent({
    componentId: 'intelligence-runtime',
    required: true,
    dependsOn: ['market-universe'],
    stepTimeoutMs,
    readinessRequirement: 'FRESH_SOURCE',
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.intelligenceRuntime.validate?.(ctx),
    launch: () => ports.intelligenceRuntime.start(),
    stop: () => ports.intelligenceRuntime.stop(),
    health: (ctx) => ports.intelligenceRuntime.health(ctx),
  });
  const marketIntelligence = new PromisePollManagedComponent({
    componentId: 'market-intelligence',
    required: true,
    dependsOn: ['intelligence-runtime'],
    stepTimeoutMs,
    readinessRequirement: 'FRESH_SOURCE',
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.marketIntelligence.validate?.(ctx),
    launch: () => ports.marketIntelligence.start(),
    stop: () => ports.marketIntelligence.stop(),
    health: (ctx) => ports.marketIntelligence.health(ctx),
  });
  const q = ports.q === undefined ? null : new PromisePollManagedComponent({
    componentId: 'q-inference',
    required: false,
    dependsOn: ['market-intelligence'],
    stepTimeoutMs,
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.q?.validate?.(ctx),
    launch: () => ports.q?.start() ?? Promise.resolve(),
    stop: () => ports.q?.stop(),
    health: (ctx) => {
      if (ports.q === undefined) throw new TypeError('Q advisory runtime disappeared after graph construction');
      return ports.q.health(ctx);
    },
  });
  const basis = new PromisePollManagedComponent({
    componentId: 'basis-engine',
    required: false,
    dependsOn: ['market-intelligence'],
    stepTimeoutMs,
    readinessRequirement: 'FRESH_SOURCE',
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.basis.validate?.(ctx),
    launch: () => ports.basis.start(),
    stop: () => ports.basis.stop(),
    health: (ctx) => ports.basis.health(ctx),
  });
  const volume = new PromisePollManagedComponent({
    componentId: 'volume-engine',
    required: false,
    dependsOn: ['market-intelligence'],
    stepTimeoutMs,
    readinessRequirement: 'FRESH_SOURCE',
    ownsUnderlyingOnLaunch: true,
    validate: (ctx) => ports.volume.validate?.(ctx),
    launch: () => ports.volume.start(),
    stop: () => ports.volume.stop(),
    health: (ctx) => ports.volume.health(ctx),
  });
  const ordered = Object.freeze([
    market,
    intelligenceRuntime,
    marketIntelligence,
    ...(q === null ? [] : [q]),
    basis,
    volume,
  ]);
  return Object.freeze({ ordered });
}
