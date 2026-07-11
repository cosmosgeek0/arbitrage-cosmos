/**
 * Lane A — Engine Control Plane: deterministic dependency planning.
 *
 * `computeStartOrder` produces THE canonical start order: a stable
 * topological sort of the injected component set (Kahn's algorithm with
 * original-declaration-index tie-breaking, so the same input always yields
 * byte-identical order). Stop and rollback orders are exactly this order
 * reversed.
 *
 * Malformed graphs (duplicate names, unknown or self dependencies, cycles)
 * are programmer errors at wiring time and throw TypeError; they are never
 * "repaired".
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import type { ControlEnvironment, ManagedComponent } from './types.js';
import type { RunMode } from '../contracts/index.js';

/** Validate the component graph and return the canonical start order. */
export function computeStartOrder(components: readonly ManagedComponent[]): string[] {
  if (!Array.isArray(components)) {
    throw new TypeError('computeStartOrder: components must be an array');
  }
  const byName = new Map<string, ManagedComponent>();
  const indexOf = new Map<string, number>();
  components.forEach((c, i) => {
    if (typeof c?.name !== 'string' || c.name.trim().length === 0 || c.name.length > 200) {
      throw new TypeError(`computeStartOrder: component at index ${i} has an invalid name`);
    }
    if (byName.has(c.name)) {
      throw new TypeError(`computeStartOrder: duplicate component name '${c.name}'`);
    }
    if (typeof c.required !== 'boolean') {
      throw new TypeError(`computeStartOrder: component '${c.name}' must declare required: boolean`);
    }
    if (!Array.isArray(c.dependsOn)) {
      throw new TypeError(`computeStartOrder: component '${c.name}' must declare dependsOn: string[]`);
    }
    for (const fn of ['validate', 'start', 'stop', 'probe'] as const) {
      if (typeof c[fn] !== 'function') {
        throw new TypeError(`computeStartOrder: component '${c.name}' is missing ${fn}()`);
      }
    }
    byName.set(c.name, c);
    indexOf.set(c.name, i);
  });

  for (const c of components) {
    for (const dep of c.dependsOn) {
      if (typeof dep !== 'string' || dep.trim().length === 0 || dep.length > 200) {
        throw new TypeError(`computeStartOrder: component '${c.name}' has an invalid dependency name`);
      }
      if (dep === c.name) {
        throw new TypeError(`computeStartOrder: component '${c.name}' depends on itself`);
      }
      if (!byName.has(dep)) {
        throw new TypeError(`computeStartOrder: component '${c.name}' depends on unknown '${dep}'`);
      }
    }
  }

  // Kahn's algorithm; ready set ordered by original declaration index.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const c of components) {
    indegree.set(c.name, c.dependsOn.length);
    for (const dep of c.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(c.name);
      dependents.set(dep, list);
    }
  }
  const ready: string[] = components.filter((c) => c.dependsOn.length === 0).map((c) => c.name);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (indexOf.get(a) as number) - (indexOf.get(b) as number));
    const name = ready.shift() as string;
    order.push(name);
    for (const next of dependents.get(name) ?? []) {
      const left = (indegree.get(next) as number) - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  if (order.length !== components.length) {
    const stuck = components.map((c) => c.name).filter((n) => !order.includes(n));
    throw new TypeError(`computeStartOrder: dependency cycle among [${stuck.join(', ')}]`);
  }
  return order;
}

/**
 * Missing-prerequisite exclusion law: components that require unavailable
 * private-key or borrow truth are excluded, together with every transitive
 * dependant. INTELLIGENCE may continue with its public components;
 * EXECUTION_VALIDATE_ONLY still fails its blocking private-key preflight,
 * while this exclusion also protects later health ticks if evidence vanishes.
 *
 * `startOrder` must be the canonical topological order so dependencies are
 * evaluated before dependents.
 */
export function computeExclusions(
  components: readonly ManagedComponent[],
  startOrder: readonly string[],
  env: ControlEnvironment,
  runMode: RunMode,
): Map<string, string> {
  const excluded = new Map<string, string>();
  const byName = new Map(components.map((c) => [c.name, c] as const));
  for (const name of startOrder) {
    const c = byName.get(name);
    if (!c) continue;
    if (!env.privateKeysAvailable && c.requiresPrivateKeys === true) {
      excluded.set(
        name,
        runMode === 'INTELLIGENCE'
          ? 'requires private keys; excluded in keyless INTELLIGENCE mode'
          : 'requires private keys; private-key availability is missing',
      );
      continue;
    }
    if (!env.borrowTruthPresent && c.requiresBorrowTruth === true) {
      excluded.set(name, 'requires borrow truth; excluded while borrow truth is unavailable');
      continue;
    }
    const excludedDep = c.dependsOn.find((d) => excluded.has(d));
    if (excludedDep !== undefined) {
      excluded.set(name, `depends on excluded component '${excludedDep}'`);
    }
  }
  return excluded;
}
