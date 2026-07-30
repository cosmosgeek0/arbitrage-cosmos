# Volume finite archive invalid-test correction

This direct correction preserves the retained finite Volume archive corpus,
consumed run, frozen policy, and rejected predecessor commit byte-for-byte. It
changes only the terminal interpretation and the active source-validation
entrypoint. It does not redesign or activate the accepted V-I2/V-I3/V-I4
prospective capture substrate.

The input corpus is 120 official Binance Spot `1s` kline archives plus their
adjacent checksum sidecars: twelve scored months and three boundary files for
each of eight USDT symbols. The exact consumed producer is retained only as
invalid-run evidence at `measure_volume_12m.py` with SHA-256
`576ea91a27195553902766f78fa3994430fa30ff2a55f6bc3aaab251dca1b826`.
It is not the active entrypoint.

`measure_volume_12m_fail_closed.py` first validates every native 12-field CSV
member and native microsecond open time across the complete corpus, before
feature derivation, lifecycle extraction, event generation, or economics. It
requires unique, strictly increasing, gap-free one-second keys and then
replaces the legacy chronology canonicalizer with an identity-only validation.
Any duplicate, overlap, reverse transition, gap, or timestamp defect stops
without sorting, deduplication, row or symbol exclusion, filling,
interpolation, or repair.

The archive cannot substitute for the accepted prospective lifecycle. Binance's
documented archive does not contain historical synchronized depth,
`bookTicker`, receive-clock, reconnect-generation, or point-in-time
`exchangeInfo` evidence. The eight-symbol cohort is survivorship-biased, and
the April-June split is retrospective. No result here is accepted lifecycle
economics, account-effective profitability, executable capacity, or USD
parity.

`economics-policy.v1.json` remains byte-identical to its pre-run frozen state.
It is retained as policy evidence, not rewritten after the outcome. The direct
predecessor's `NO_GO` interpretation is superseded because the consumed
producer normalized defective chronology before measuring it.

The committed evidence packet retains the derived event ledgers, archive
manifest, raw run results, and checksums. Raw multi-gigabyte ZIPs remain
outside Git; the manifest binds each URL, official sidecar digest, recomputed
archive digest, member name, and size.

No network is used by `finalize_volume_economics.py` or
`verify_volume_economics.py`. Neither opens an economic outcome path: the
finalizer binds the preserved artifacts, reads their recorded chronology
counters, and emits only `INVALID_TEST / UNMEASURED`. The strategy remains
DEFAULT OFF, KILL ON, SHADOW ONLY, record-only, with no submit, CAS, private,
signed, key, provider, host, order, transfer, withdrawal, or money authority.

## Terminal result

Both preserved phase results report the same legacy-projection anomaly for
`NEARUSDT`: 2,313 duplicate collapsed open-time keys and one out-of-order
transition. The consumed producer stable-sorted that chronology, removed
same-key rows, and could fill missing seconds before feature derivation. The
official archive checksums prove the acquired ZIP bytes matched the advertised
digests; they do not authorize consumer-side canonicalization.

Therefore:

- test status: `INVALID_TEST`;
- archive economics: `UNMEASURED`;
- accepted prospective lifecycle economics: `UNMEASURED`;
- account-effective economics: `UNMEASURED`;
- GO/NO_GO: `NOT_APPLICABLE`;
- net edge, interval, drawdown, event sample, and measured capacity: null;
- `$1k` and full-universe capacity: `UNKNOWN`;
- OOS: failed; PBO: `NOT_ESTABLISHED`;
- repair authority, rerun authority, and execution authority: `NONE`.

The preserved event ledgers and raw economic outputs remain checksum-bound
forensic evidence of the invalid run. They are not a measurement, verdict, or
profitability claim. No source was reopened, excluded, repaired, or rerun for
this correction.
