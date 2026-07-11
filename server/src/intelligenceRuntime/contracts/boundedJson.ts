const HARD_MAXIMUM_JSON_BYTES = 256 * 1024 * 1024;
const HARD_MAXIMUM_JSON_DEPTH = 64;
const HARD_MAXIMUM_JSON_NODES = 1_000_000;

export interface BoundedJsonMeasureOptions {
  maximumDepth?: number;
  maximumNodes?: number;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function escapedStringUtf8Bytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
      || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Measures the exact UTF-8 byte length JSON.stringify would retain for a
 * strict plain-data contract, aborting at the configured byte/depth/node
 * boundary without materializing the full serialized graph.
 */
export function boundedJsonByteLength(
  value: unknown,
  maximumBytes: number,
  options: BoundedJsonMeasureOptions = {},
): number {
  const byteLimit = boundedInteger(maximumBytes, 'maximumBytes', 1, HARD_MAXIMUM_JSON_BYTES);
  const maximumDepth = boundedInteger(
    options.maximumDepth ?? HARD_MAXIMUM_JSON_DEPTH,
    'maximumDepth',
    1,
    HARD_MAXIMUM_JSON_DEPTH,
  );
  const maximumNodes = boundedInteger(
    options.maximumNodes ?? HARD_MAXIMUM_JSON_NODES,
    'maximumNodes',
    1,
    HARD_MAXIMUM_JSON_NODES,
  );
  let bytes = 0;
  let nodes = 0;
  const ancestors = new Set<object>();

  const add = (count: number): void => {
    bytes += count;
    if (bytes > byteLimit) throw new RangeError('JSON value exceeds maximumBytes');
  };

  const visit = (current: unknown, depth: number): void => {
    if (depth > maximumDepth) throw new RangeError('JSON value exceeds maximumDepth');
    nodes += 1;
    if (nodes > maximumNodes) throw new RangeError('JSON value exceeds maximumNodes');
    if (current === null) {
      add(4);
      return;
    }
    if (typeof current === 'string') {
      add(escapedStringUtf8Bytes(current));
      return;
    }
    if (typeof current === 'boolean') {
      add(current ? 4 : 5);
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('JSON value contains a non-finite number');
      add(JSON.stringify(Object.is(current, -0) ? 0 : current).length);
      return;
    }
    if (typeof current !== 'object') throw new TypeError(`JSON value contains unsupported ${typeof current}`);
    if (ancestors.has(current)) throw new TypeError('JSON value contains a cycle');
    if (Object.getOwnPropertySymbols(current).length > 0) throw new TypeError('JSON value contains symbol keys');
    ancestors.add(current);

    if (Array.isArray(current)) {
      if (current.length > maximumNodes) throw new RangeError('JSON array exceeds maximumNodes');
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const ownNames = Object.keys(descriptors);
      if (ownNames.some((key) => {
        if (key === 'length') return false;
        if (!/^(?:0|[1-9]\d*)$/.test(key)) return true;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index >= current.length || String(index) !== key;
      })) throw new TypeError('JSON array contains custom properties');
      add(1);
      for (let index = 0; index < current.length; index += 1) {
        if (index > 0) add(1);
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('JSON arrays must be dense data-only values');
        }
        visit(descriptor.value, depth + 1);
      }
      add(1);
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('JSON value contains a non-plain object');
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const keys = Object.keys(descriptors);
      add(1);
      let emitted = 0;
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('JSON objects must contain enumerable data properties only');
        }
        if (emitted > 0) add(1);
        add(escapedStringUtf8Bytes(key));
        add(1);
        visit(descriptor.value, depth + 1);
        emitted += 1;
      }
      add(1);
    }
    ancestors.delete(current);
  };

  visit(value, 0);
  return bytes;
}
