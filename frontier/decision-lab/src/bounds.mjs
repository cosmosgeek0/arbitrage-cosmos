import { contractError } from '../../dock/src/index.mjs';

const DEFAULT_LIMITS = Object.freeze({
  maximumDepth: 64,
  maximumNodes: 50_000,
  maximumArrayLength: 4_096,
  maximumObjectKeys: 1_024,
  maximumStringLength: 16_384,
  maximumAggregateTextLength: 1_000_000,
});

function fail(code, message) {
  throw contractError(code, message);
}

export function assertBoundedStructure(input, name = 'input', limits = DEFAULT_LIMITS) {
  const stack = [{ phase: 'enter', value: input, depth: 0 }];
  const activePath = new WeakSet();
  let nodeCount = 0;
  let aggregateTextLength = 0;

  while (stack.length > 0) {
    const { phase, value, depth } = stack.pop();
    if (phase === 'exit') {
      activePath.delete(value);
      continue;
    }
    nodeCount += 1;
    if (nodeCount > limits.maximumNodes) {
      fail('STRUCTURE_NODE_BOUND_EXCEEDED', `${name} exceeds the bounded node budget`);
    }
    if (depth > limits.maximumDepth) {
      fail('STRUCTURE_DEPTH_BOUND_EXCEEDED', `${name} exceeds the bounded nesting depth`);
    }
    if (typeof value === 'string') {
      if (value.length > limits.maximumStringLength) {
        fail('STRUCTURE_STRING_BOUND_EXCEEDED', `${name} contains an overlong string`);
      }
      aggregateTextLength += value.length;
      if (aggregateTextLength > limits.maximumAggregateTextLength) {
        fail('STRUCTURE_TEXT_BOUND_EXCEEDED', `${name} exceeds the aggregate text budget`);
      }
      continue;
    }
    if (value === null || ['boolean', 'number'].includes(typeof value)) continue;
    if (typeof value !== 'object') {
      fail('STRUCTURE_TYPE_UNSUPPORTED', `${name} contains a non-canonical value type`);
    }
    if (activePath.has(value)) fail('STRUCTURE_CYCLE_REJECTED', `${name} contains a cyclic reference`);
    activePath.add(value);
    stack.push({ phase: 'exit', value, depth });

    if (Array.isArray(value)) {
      if (value.length > limits.maximumArrayLength) {
        fail('STRUCTURE_ARRAY_BOUND_EXCEEDED', `${name} contains an overlong array`);
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        fail('STRUCTURE_SYMBOL_KEY_REJECTED', `${name} contains a symbol-keyed array value`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const elementKeys = ownKeys.filter((key) => key !== 'length');
      if (elementKeys.length !== value.length
        || elementKeys.some((key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        fail('STRUCTURE_ARRAY_SHAPE_INVALID', `${name} contains sparse or named array properties`);
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) {
          fail('STRUCTURE_ACCESSOR_REJECTED', `${name} contains an accessor property`);
        }
        stack.push({ phase: 'enter', value: descriptor.value, depth: depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('STRUCTURE_PROTOTYPE_REJECTED', `${name} contains a non-plain object`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      fail('STRUCTURE_SYMBOL_KEY_REJECTED', `${name} contains a symbol-keyed object value`);
    }
    const keys = ownKeys;
    if (keys.length > limits.maximumObjectKeys) {
      fail('STRUCTURE_KEY_BOUND_EXCEEDED', `${name} contains too many object fields`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) {
        fail('STRUCTURE_ACCESSOR_REJECTED', `${name} contains an accessor property`);
      }
      aggregateTextLength += key.length;
      if (aggregateTextLength > limits.maximumAggregateTextLength) {
        fail('STRUCTURE_TEXT_BOUND_EXCEEDED', `${name} exceeds the aggregate text budget`);
      }
      stack.push({ phase: 'enter', value: descriptor.value, depth: depth + 1 });
    }
  }
  return true;
}
