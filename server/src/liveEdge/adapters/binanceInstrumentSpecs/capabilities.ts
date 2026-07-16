import type { BinanceInstrumentProduct } from './types.js';

const SPOT_ORDER_TYPES = Object.freeze([
  'LIMIT', 'LIMIT_MAKER', 'MARKET', 'STOP_LOSS', 'STOP_LOSS_LIMIT',
  'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT',
] as const);

const USD_M_ADVERTISED_ORDER_TYPES = Object.freeze([
  'LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT',
  'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET',
] as const);

const USD_M_STATIC_ORDER_TYPES = Object.freeze(['LIMIT', 'MARKET'] as const);
const USD_M_TIME_IN_FORCE = Object.freeze(['FOK', 'GTC', 'GTD', 'GTX', 'IOC', 'RPI'] as const);

export interface NormalizedInstrumentCapabilities {
  readonly advertised: readonly string[];
  readonly staticTypes: readonly string[];
  readonly timeInForce: readonly string[];
}

function textArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 128) throw new TypeError(`${label} must be bounded`);
  const output = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length < 1 || entry.length > 128
      || entry.trim() !== entry
      || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(entry)) {
      throw new TypeError(`${label}[${index}] invalid`);
    }
    return entry;
  });
  for (let index = 1; index < output.length; index += 1) {
    if (output[index - 1] >= output[index]) throw new TypeError(`${label} must be sorted and unique`);
  }
  return output;
}

export function normalizeInstrumentCapabilities(
  product: BinanceInstrumentProduct,
  orderTypesValue: unknown,
  timeInForceValue: unknown,
): Readonly<NormalizedInstrumentCapabilities> {
  const advertised = [...textArray(orderTypesValue, 'orderTypes')];
  if (advertised.length === 0) throw new TypeError('orderTypes cannot be empty');
  const allowedAdvertised: readonly string[] = product === 'USD_M_PERPETUAL'
    ? USD_M_ADVERTISED_ORDER_TYPES
    : SPOT_ORDER_TYPES;
  if (advertised.some((value) => !allowedAdvertised.includes(value))) {
    throw new TypeError('orderTypes contains an unknown current value');
  }
  const timeInForce = [...textArray(timeInForceValue, 'timeInForce')];
  if (product === 'USD_M_PERPETUAL') {
    if (timeInForce.some((value) => !USD_M_TIME_IN_FORCE.includes(value as (typeof USD_M_TIME_IN_FORCE)[number]))) {
      throw new TypeError('timeInForce contains an unknown current USD-M value');
    }
  } else if (timeInForce.length !== 0) {
    throw new TypeError('Spot-family Runtime metadata cannot prove symbol time-in-force');
  }
  const staticTypes = product === 'USD_M_PERPETUAL'
    ? advertised.filter((value) => USD_M_STATIC_ORDER_TYPES.includes(value as (typeof USD_M_STATIC_ORDER_TYPES)[number]))
    : [...advertised];
  return Object.freeze({
    advertised: Object.freeze(advertised),
    staticTypes: Object.freeze(staticTypes),
    timeInForce: Object.freeze(timeInForce),
  });
}

export function requiredInstrumentLossCodes(
  product: BinanceInstrumentProduct,
  advertisedOrderTypes: readonly string[],
  timeInForce: readonly string[],
): readonly string[] {
  const losses = [
    'EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED',
    'TOP_LEVEL_EXCHANGE_FILTERS_UNAVAILABLE',
  ];
  if (product === 'USD_M_PERPETUAL') {
    losses.push('USD_M_CONTRACT_SIZE_UNAVAILABLE');
    if (timeInForce.length === 0) losses.push('USD_M_TIME_IN_FORCE_UNAVAILABLE');
    if (advertisedOrderTypes.some((value) => !USD_M_STATIC_ORDER_TYPES.includes(value as (typeof USD_M_STATIC_ORDER_TYPES)[number]))) {
      losses.push('USD_M_ALGO_ROUTE_CAPABILITY_NOT_REGULAR_ORDER_AUTHORITY');
    }
  } else {
    losses.push(
      'MAX_ASSET_PRIVATE_FILTER_UNAVAILABLE',
      'SPOT_EXECUTION_RULES_UNAVAILABLE',
      'SPOT_TIME_IN_FORCE_UNAVAILABLE',
    );
    if (product === 'MARGIN') {
      losses.push(
        'MARGIN_IS_MARGIN_TRADING_ALLOWED_UNAVAILABLE',
        'MARGIN_PAIR_ELIGIBILITY_JOIN_UNAVAILABLE',
        'MARGIN_RESTRICTIONS_UNAVAILABLE',
        'MARGIN_ACCOUNT_PERMISSION_UNAVAILABLE',
      );
    }
  }
  return Object.freeze([...losses].sort());
}
