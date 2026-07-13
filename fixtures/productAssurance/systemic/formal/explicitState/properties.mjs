export const PROPERTY_SCHEMA_VERSION = 'ip-assurance.s3.property-catalog.v1';

export const PROPERTY_KINDS = Object.freeze(['SAFETY', 'LIVENESS']);

const catalog = [
  {
    propertyId: 'S3-SAF-01',
    kind: 'SAFETY',
    title: 'Single current fencing epoch',
    statement: 'For each fenced resource or domain, at most one epoch may authorize or commit a new transition.',
  },
  {
    propertyId: 'S3-SAF-02',
    kind: 'SAFETY',
    title: 'Stale actor rejection',
    statement: 'A stale or non-current actor or callback cannot authorize or commit a new transition.',
  },
  {
    propertyId: 'S3-SAF-03',
    kind: 'SAFETY',
    title: 'Durable fact preservation',
    statement: 'A fact durably received by canonical reconciliation survives stale reporter context; unproved receipt remains UNKNOWN.',
  },
  {
    propertyId: 'S3-SAF-04',
    kind: 'SAFETY',
    title: 'Durable intent before mutation',
    statement: 'No external mutation is dispatched or committed before its intent is durable.',
  },
  {
    propertyId: 'S3-SAF-05',
    kind: 'SAFETY',
    title: 'No blind resend after ambiguity',
    statement: 'An ambiguous submission cannot be resent without authoritative reconciliation proving absence.',
  },
  {
    propertyId: 'S3-SAF-06',
    kind: 'SAFETY',
    title: 'Authoritative success postcondition',
    statement: 'Local success is impossible without an authoritative postcondition.',
  },
  {
    propertyId: 'S3-SAF-07',
    kind: 'SAFETY',
    title: 'Liability remains explicit',
    statement: 'Every modeled liability is authoritatively reconciled or remains durably explicit and unresolved; an out-of-envelope possibility is UNKNOWN.',
  },
  {
    propertyId: 'S3-SAF-08',
    kind: 'SAFETY',
    title: 'Canonical denial blocks risk increase',
    statement: 'No risk-increasing transition commits when canonical posture denies it or is unknown.',
  },
  {
    propertyId: 'S3-SAF-09',
    kind: 'SAFETY',
    title: 'Independent recovery proof before incident clear',
    statement: 'An incident cannot clear before an independent postcondition and required quiet-period evidence.',
  },
  {
    propertyId: 'S3-SAF-10',
    kind: 'SAFETY',
    title: 'Approval binding',
    statement: 'An approval cannot be reused outside its bound identity, scope, version, expiry, and use identity.',
  },
  {
    propertyId: 'S3-LIV-01',
    kind: 'LIVENESS',
    title: 'Acknowledged mutation resolves',
    statement: 'Under declared assumptions, an acknowledged mutation becomes reconciled or durably unresolved or quarantined.',
  },
  {
    propertyId: 'S3-LIV-02',
    kind: 'LIVENESS',
    title: 'Lost owner loses authority',
    statement: 'Under declared lease and clock assumptions, a lost owner eventually has no current authority.',
  },
  {
    propertyId: 'S3-LIV-03',
    kind: 'LIVENESS',
    title: 'Restart reconstructs or blocks',
    statement: 'Under declared store assumptions, restart reconstructs equivalent durable state or blocks.',
  },
  {
    propertyId: 'S3-LIV-04',
    kind: 'LIVENESS',
    title: 'Bounded repair terminates visibly',
    statement: 'A bounded repair campaign ends in recovery, compensation, quarantine, escalation, or durable unresolved state.',
  },
  {
    propertyId: 'S3-LIV-05',
    kind: 'LIVENESS',
    title: 'Observed cancellation stops local effects',
    statement: 'After a cancellable child observes cancellation and before effect commitment, it initiates no new side effect.',
  },
  {
    propertyId: 'S3-LIV-06',
    kind: 'LIVENESS',
    title: 'Non-cancellable effect reconciles',
    statement: 'A dispatched non-cancellable mutation or detached fenced recovery reconciles or becomes explicitly unresolved.',
  },
  {
    propertyId: 'S3-M04-INV-01',
    kind: 'SAFETY',
    title: 'Repair attempt budget is never exceeded',
    statement: 'A repair campaign cannot acquire or retry an effect after its durable attempt budget is exhausted.',
  },
  {
    propertyId: 'S3-M06-INV-01',
    kind: 'SAFETY',
    title: 'Halt preserves canonical risk reduction',
    statement: 'A halt posture does not turn a valid risk-reducing operation into a canonical risk denial, and any applied reduction lowers exposure.',
  },
];

export const PROPERTY_CATALOG = Object.freeze(catalog.map((entry) => Object.freeze({ ...entry })));

export const PROPERTY_BY_ID = Object.freeze(Object.fromEntries(PROPERTY_CATALOG.map((entry) => [entry.propertyId, entry])));

export function requireProperty(propertyId, kind) {
  const property = PROPERTY_BY_ID[propertyId];
  if (property === undefined) throw new TypeError(`unknown propertyId ${String(propertyId)}`);
  if (kind !== undefined && property.kind !== kind) {
    throw new TypeError(`property ${propertyId} is ${property.kind}, not ${kind}`);
  }
  return property;
}
