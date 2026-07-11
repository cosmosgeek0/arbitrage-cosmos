/**
 * Versioned deterministic PRNG for synthetic fixtures only.
 *
 * This is Marsaglia's 32-bit xorshift recurrence (13, 17, 5). It is not a
 * security primitive and is never used for credentials, live execution, or
 * production identity. Seed zero is rejected because it is the absorbing
 * state of xorshift32.
 */
export const SCENARIO_PRNG_ALGORITHM = 'XORSHIFT32_V1' as const;
export const UINT32_SPACE = 0x1_0000_0000;
export const UINT32_MAX = 0xffff_ffff;

export function isValidScenarioSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= UINT32_MAX;
}

/** Pure state transition: same non-zero uint32 state => same next state. */
export function xorshift32Step(state: number): number {
  if (!isValidScenarioSeed(state)) {
    throw new TypeError('xorshift32Step: state must be a non-zero unsigned 32-bit integer');
  }
  let next = state >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  if (next === 0) {
    // A non-zero xorshift state cannot reach zero. Keep this explicit so an
    // implementation regression fails closed instead of entering a fixed stream.
    throw new TypeError('xorshift32Step: invalid zero state produced');
  }
  return next;
}

export interface ScenarioPrng {
  readonly algorithm: typeof SCENARIO_PRNG_ALGORITHM;
  readonly initialSeed: number;
  state(): number;
  nextUint32(): number;
  nextUnitInterval(): number;
  nextIntInclusive(minimum: number, maximum: number): number;
}

/** Stateful convenience wrapper; state exists only within one generator call. */
export function createScenarioPrng(seed: number): ScenarioPrng {
  if (!isValidScenarioSeed(seed)) {
    throw new TypeError('createScenarioPrng: seed must be a non-zero unsigned 32-bit integer');
  }
  let current = seed;
  const nextUint32 = (): number => {
    current = xorshift32Step(current);
    return current;
  };
  return Object.freeze({
    algorithm: SCENARIO_PRNG_ALGORITHM,
    initialSeed: seed,
    state: () => current,
    nextUint32,
    nextUnitInterval: () => nextUint32() / UINT32_SPACE,
    nextIntInclusive: (minimum: number, maximum: number): number => {
      if (
        !Number.isSafeInteger(minimum) ||
        !Number.isSafeInteger(maximum) ||
        minimum > maximum
      ) {
        throw new TypeError('nextIntInclusive: bounds must be ordered safe integers');
      }
      const span = maximum - minimum + 1;
      if (!Number.isSafeInteger(span) || span <= 0 || span > UINT32_SPACE) {
        throw new TypeError('nextIntInclusive: range must contain at most 2^32 values');
      }
      // Rejection sampling avoids modulo bias while remaining deterministic.
      const acceptanceLimit = Math.floor(UINT32_SPACE / span) * span;
      let sample = nextUint32();
      while (sample >= acceptanceLimit) sample = nextUint32();
      return minimum + (sample % span);
    },
  });
}
