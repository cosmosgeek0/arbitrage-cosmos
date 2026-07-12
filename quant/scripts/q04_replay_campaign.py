"""Deterministic Q04 replay campaign and golden-fixture builder.

Usage: ``python scripts/q04_replay_campaign.py OUTPUT_ROOT``

Writes, byte-deterministically and without any network, environment or ambient-time
access:

- ``OUTPUT_ROOT/fixtures/q04_replay_golden_v1.json``
- ``OUTPUT_ROOT/generated/q04/replay_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q04/replay_campaign.v1.md``

All evidence is SYNTHETIC fixture evidence for the Q04 reference model; nothing here is
observed market data and nothing claims edge, coverage or venue truth.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from quant_edge.book.engine import (
    BookAnomalyV1,
    BookEffect,
    BookEngineConfigV1,
    LocalBookEngine,
    SnapshotRequestIntentV1,
)
from quant_edge.book.events import (
    BookDelta,
    BookSnapshot,
    ReceiveClocksV1,
    SnapshotProvenanceV1,
    SpotDepthDeltaV1,
    SpotDepthSnapshotV1,
    UsdMDepthDeltaV1,
    UsdMDepthSnapshotV1,
)
from quant_edge.book.levels import PriceLevelUpdateV1, parse_price_level_update
from quant_edge.book.replay import (
    ReplayResultV1,
    ReplayScriptV1,
    ReplayStepKind,
    ReplayStepV1,
    run_replay,
)
from quant_edge.bootstrap.bridge import ForwardProduct
from quant_edge.canonical import canonical_json_bytes
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.randomness import DeterministicRandom

CAMPAIGN_SEED = 20260712
SEEDED_SCRIPTS_PER_PRODUCT = 8
SEEDED_OPS_PER_SCRIPT = 24
EVENT_MS = 1_772_000_000_000
WALL_MS = 1_772_000_000_050
MONO_NS = 5_000_000_000
PROC_NS = 1_772_000_000_000_000_000

BID_PRICES = ("1.0", "1.1", "1.2", "1.3", "1.4")
ASK_PRICES = ("2.0", "2.1", "2.2", "2.3", "2.4")
OPS = (
    "delta",
    "delta",
    "delta",
    "withhold",
    "redeliver",
    "reconnect",
    "snapshot",
    "snapshot",
    "snapshot_stale",
    "snapshot_wrong_intent",
)


def _update(price: str, quantity: str) -> PriceLevelUpdateV1:
    return parse_price_level_update(price, quantity, field="update")


def _config(product: ForwardProduct) -> BookEngineConfigV1:
    return BookEngineConfigV1(
        product=product,
        symbol="BNBUSDT" if product is ForwardProduct.SPOT else "BTCUSDT",
        expected_posture=EvidencePosture.SYNTHETIC,
        max_levels_per_side=16,
        max_buffered_deltas=64,
    )


class _ScriptBuilder:
    """Probe-driven builder: runs a private engine to bind intent identities."""

    def __init__(self, product: ForwardProduct) -> None:
        self.product = product
        self.config = _config(product)
        self.engine = LocalBookEngine(self.config)
        self.steps: list[ReplayStepV1] = []
        self.sequence = 1_000
        self.previous_final = 999
        self.bids: dict[str, str] = {"1.2": "5"}
        self.asks: dict[str, str] = {"2.2": "5"}
        self.ordinal = 0
        self.generation = 1
        self.monotonic_ns = MONO_NS
        self.history: list[BookDelta] = []
        self.outstanding_intent: str | None = None
        self.processing_ns = PROC_NS
        self.mutation_counter = 0

    def _observe(self, effects: tuple[BookEffect, ...]) -> None:
        for effect in effects:
            if isinstance(effect, SnapshotRequestIntentV1):
                self.outstanding_intent = effect.intent_id

    def _next_processing_ns(self) -> int:
        self.processing_ns += 1
        return self.processing_ns

    def start(self) -> None:
        processing_ns = self._next_processing_ns()
        self.steps.append(ReplayStepV1(kind=ReplayStepKind.START, processing_time_ns=processing_ns))
        self._observe(self.engine.start(processing_time_ns=processing_ns))

    def _receive(self) -> ReceiveClocksV1:
        self.ordinal += 1
        self.monotonic_ns += 1_000
        return ReceiveClocksV1(
            session_id="session-1",
            stream_id="depth-stream",
            connection_generation=self.generation,
            receive_ordinal=self.ordinal,
            receive_wall_time_ms=WALL_MS + self.ordinal,
            receive_monotonic_ns=self.monotonic_ns,
        )

    def _mutate_truth(
        self,
    ) -> tuple[tuple[PriceLevelUpdateV1, ...], tuple[PriceLevelUpdateV1, ...]]:
        self.mutation_counter += 1
        counter = self.mutation_counter
        bid_price = BID_PRICES[counter % len(BID_PRICES)]
        ask_price = ASK_PRICES[(counter // 2) % len(ASK_PRICES)]
        bid_quantity = "0" if counter % 7 == 3 else str((counter % 9) + 1)
        ask_quantity = "0" if counter % 5 == 2 else str((counter % 6) + 1)
        if bid_quantity == "0":
            self.bids.pop(bid_price, None)
        else:
            self.bids[bid_price] = bid_quantity
        if ask_quantity == "0":
            self.asks.pop(ask_price, None)
        else:
            self.asks[ask_price] = ask_quantity
        return ((_update(bid_price, bid_quantity),), (_update(ask_price, ask_quantity),))

    def _make_delta(self) -> BookDelta:
        bids, asks = self._mutate_truth()
        first = self.sequence + 1
        last = first + (self.mutation_counter % 3)
        previous = self.previous_final
        self.sequence = last
        self.previous_final = last
        delta: BookDelta
        if self.product is ForwardProduct.SPOT:
            delta = SpotDepthDeltaV1(
                symbol=self.config.symbol,
                event_time_ms=EVENT_MS + self.ordinal + 1,
                first_update_id=first,
                final_update_id=last,
                bids=bids,
                asks=asks,
                receive=self._receive(),
                posture=EvidencePosture.SYNTHETIC,
            )
        else:
            delta = UsdMDepthDeltaV1(
                symbol=self.config.symbol,
                event_time_ms=EVENT_MS + self.ordinal + 1,
                transaction_time_ms=EVENT_MS + self.ordinal,
                first_update_id=first,
                final_update_id=last,
                previous_final_update_id=previous,
                bids=bids,
                asks=asks,
                receive=self._receive(),
                posture=EvidencePosture.SYNTHETIC,
            )
        self.history.append(delta)
        return delta

    def _redelivered(self) -> BookDelta | None:
        if not self.history:
            return None
        original = self.history[len(self.history) // 2]
        receive = self._receive()
        if isinstance(original, SpotDepthDeltaV1):
            return SpotDepthDeltaV1(
                symbol=original.symbol,
                event_time_ms=original.event_time_ms,
                first_update_id=original.first_update_id,
                final_update_id=original.final_update_id,
                bids=original.bids,
                asks=original.asks,
                receive=receive,
                posture=original.posture,
            )
        return UsdMDepthDeltaV1(
            symbol=original.symbol,
            event_time_ms=original.event_time_ms,
            transaction_time_ms=original.transaction_time_ms,
            first_update_id=original.first_update_id,
            final_update_id=original.final_update_id,
            previous_final_update_id=original.previous_final_update_id,
            bids=original.bids,
            asks=original.asks,
            receive=receive,
            posture=original.posture,
        )

    def _levels(
        self,
        side: dict[str, str],
        *,
        descending: bool,
    ) -> tuple[PriceLevelUpdateV1, ...]:
        ordered = sorted(
            side.items(),
            key=lambda item: _update(item[0], "1").price.aligned,
            reverse=descending,
        )
        return tuple(_update(price, quantity) for price, quantity in ordered)

    def _make_snapshot(self, intent_id: str, *, stale_by: int = 0) -> BookSnapshot:
        last_update_id = self.sequence - stale_by
        provenance = SnapshotProvenanceV1(
            intent_id=intent_id,
            acquired_wall_time_ms=WALL_MS + self.ordinal + 1,
            acquired_monotonic_ns=self.monotonic_ns + 1,
            posture=EvidencePosture.SYNTHETIC,
        )
        if self.product is ForwardProduct.SPOT:
            return SpotDepthSnapshotV1(
                symbol=self.config.symbol,
                last_update_id=last_update_id,
                bids=self._levels(self.bids, descending=True),
                asks=self._levels(self.asks, descending=False),
                provenance=provenance,
            )
        return UsdMDepthSnapshotV1(
            symbol=self.config.symbol,
            last_update_id=last_update_id,
            message_output_time_ms=EVENT_MS + self.ordinal + 10,
            transaction_time_ms=EVENT_MS + self.ordinal + 9,
            bids=self._levels(self.bids, descending=True),
            asks=self._levels(self.asks, descending=False),
            provenance=provenance,
        )

    def deliver_delta(self, delta: BookDelta) -> None:
        processing_ns = self._next_processing_ns()
        self.steps.append(
            ReplayStepV1(
                kind=ReplayStepKind.DELTA,
                processing_time_ns=processing_ns,
                delta=delta,
            )
        )
        self._observe(self.engine.on_delta(delta, processing_time_ns=processing_ns))

    def deliver_snapshot(self, snapshot: BookSnapshot) -> None:
        processing_ns = self._next_processing_ns()
        self.steps.append(
            ReplayStepV1(
                kind=ReplayStepKind.SNAPSHOT,
                processing_time_ns=processing_ns,
                snapshot=snapshot,
            )
        )
        self._observe(self.engine.on_snapshot(snapshot, processing_time_ns=processing_ns))

    def apply_op(self, op: str) -> None:
        if op == "delta":
            self.deliver_delta(self._make_delta())
        elif op == "withhold":
            self._make_delta()
        elif op == "redeliver":
            redelivered = self._redelivered()
            if redelivered is not None:
                self.deliver_delta(redelivered)
        elif op == "reconnect":
            self.generation += 1
            self.deliver_delta(self._make_delta())
        elif op == "snapshot":
            if self.outstanding_intent is not None:
                self.deliver_snapshot(self._make_snapshot(self.outstanding_intent))
        elif op == "snapshot_stale":
            if self.outstanding_intent is not None:
                self.deliver_snapshot(self._make_snapshot(self.outstanding_intent, stale_by=50))
        elif op == "snapshot_wrong_intent":
            self.deliver_snapshot(self._make_snapshot("q04intent:never-issued"))
        else:  # defensive: the op alphabet is closed
            raise ValueError(f"unknown campaign op: {op}")

    def settle(self) -> None:
        for _ in range(6):
            view = self.engine.view()
            if view.model_eligible and view.book_update_id == self.sequence:
                return
            if not view.model_eligible and self.outstanding_intent is not None:
                self.deliver_snapshot(self._make_snapshot(self.outstanding_intent))
            self.deliver_delta(self._make_delta())
        view = self.engine.view()
        if not view.model_eligible or view.book_update_id != self.sequence:
            raise ValueError("campaign settlement failed to reach exchange truth")

    def script(self) -> ReplayScriptV1:
        return ReplayScriptV1(engine_config=self.config, steps=tuple(self.steps))


def _golden_script(product: ForwardProduct) -> ReplayScriptV1:
    """Fixed §10.5 case-matrix script: sync, stale snapshot, stream, gap, resync."""

    builder = _ScriptBuilder(product)
    builder.start()
    fixed_ops = (
        "delta",
        "delta",
        "snapshot_stale",
        "snapshot_wrong_intent",
        "snapshot",
        "delta",
        "redeliver",
        "withhold",
        "delta",
        "snapshot",
        "delta",
        "reconnect",
        "snapshot",
        "delta",
    )
    for op in fixed_ops:
        builder.apply_op(op)
    builder.settle()
    return builder.script()


def _seeded_script(product: ForwardProduct, rng: DeterministicRandom) -> ReplayScriptV1:
    builder = _ScriptBuilder(product)
    builder.start()
    for _ in range(SEEDED_OPS_PER_SCRIPT):
        builder.apply_op(OPS[rng.next_u64() % len(OPS)])
    builder.settle()
    return builder.script()


def _result_summary(result: ReplayResultV1) -> dict[str, object]:
    anomaly_counts: dict[str, int] = {}
    for effect in result.effects:
        if isinstance(effect, BookAnomalyV1):
            key = effect.kind.value
            anomaly_counts[key] = anomaly_counts.get(key, 0) + 1
    view = result.final_view
    return {
        "anomalyCounts": dict(sorted(anomaly_counts.items())),
        "effects": len(result.effects),
        "finalBookUpdateId": view.book_update_id,
        "finalModelEligible": view.model_eligible,
        "finalQuality": view.quality.value,
        "resultSha256": result.result_digest.hexdigest,
        "scriptSha256": result.script_digest.hexdigest,
        "steps": None,
    }


def _run_product(product: ForwardProduct) -> tuple[dict[str, object], dict[str, object]]:
    golden_script = _golden_script(product)
    first = run_replay(golden_script)
    second = run_replay(golden_script)
    if first.canonical_bytes() != second.canonical_bytes():
        raise ValueError("golden replay is not byte-deterministic")
    if not first.final_view.model_eligible:
        raise ValueError("golden replay must settle model-eligible")
    golden_summary = _result_summary(first)
    golden_summary["steps"] = len(golden_script.steps)

    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)
    seeded_summaries: list[dict[str, object]] = []
    complete_final = 0
    total_anomalies: dict[str, int] = {}
    for _ in range(SEEDED_SCRIPTS_PER_PRODUCT):
        script = _seeded_script(product, rng)
        result = run_replay(script)
        replayed = run_replay(script)
        if result.canonical_bytes() != replayed.canonical_bytes():
            raise ValueError("seeded replay is not byte-deterministic")
        summary = _result_summary(result)
        summary["steps"] = len(script.steps)
        seeded_summaries.append(summary)
        if result.final_view.quality is QualityState.COMPLETE:
            complete_final += 1
        anomaly_counts_raw = summary["anomalyCounts"]
        if isinstance(anomaly_counts_raw, dict):
            for kind, count in anomaly_counts_raw.items():
                if isinstance(count, int):
                    total_anomalies[kind] = total_anomalies.get(kind, 0) + count
    seeded_summary: dict[str, object] = {
        "completeFinalViews": complete_final,
        "scripts": SEEDED_SCRIPTS_PER_PRODUCT,
        "seed": str(CAMPAIGN_SEED),
        "summaries": seeded_summaries,
        "totalAnomalies": dict(sorted(total_anomalies.items())),
    }
    fixture_entry: dict[str, object] = {
        "resultSha256": golden_summary["resultSha256"],
        "script": golden_script.as_mapping(),
        "scriptSha256": golden_summary["scriptSha256"],
    }
    campaign_entry: dict[str, object] = {"golden": golden_summary, "seeded": seeded_summary}
    return fixture_entry, campaign_entry


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    spot_fixture, spot_campaign = _run_product(ForwardProduct.SPOT)
    usd_m_fixture, usd_m_campaign = _run_product(ForwardProduct.USD_M_PERPETUAL)
    fixture_mapping = {
        "schema": "Q04ReplayGoldenFixtureV1",
        "spot": spot_fixture,
        "usdM": usd_m_fixture,
        "version": 1,
    }
    fixture_bytes = canonical_json_bytes(fixture_mapping)
    campaign_mapping = {
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "schema": "Q04ReplayCampaignV1",
        "seed": str(CAMPAIGN_SEED),
        "spot": spot_campaign,
        "usdM": usd_m_campaign,
        "version": 1,
    }
    campaign_bytes = canonical_json_bytes(campaign_mapping)
    lines = [
        "# Q04 replay campaign (synthetic fixture evidence only)",
        "",
        "Deterministic replay proof for the Q04 local-book reference model. Nothing in",
        "this campaign is observed market data; no coverage, latency or edge claim is",
        "made. Golden and seeded scripts settle through lawful resynchronization only.",
        "",
        f"- Seed: `{CAMPAIGN_SEED}`",
        f"- Campaign artifact fixture binding: `{hashlib.sha256(fixture_bytes).hexdigest()}`",
        "",
        "| Product | Golden script SHA-256 | Golden result SHA-256 | Steps | Effects |",
        "| --- | --- | --- | ---: | ---: |",
    ]
    for label, campaign in (("SPOT", spot_campaign), ("USD_M_PERPETUAL", usd_m_campaign)):
        golden = campaign["golden"]
        if isinstance(golden, dict):
            lines.append(
                f"| {label} | `{golden['scriptSha256']}` | `{golden['resultSha256']}` "
                f"| {golden['steps']} | {golden['effects']} |"
            )
    lines.extend(
        [
            "",
            "| Product | Seeded scripts | Complete finals | Total anomalies |",
            "| --- | ---: | ---: | --- |",
        ]
    )
    for label, campaign in (("SPOT", spot_campaign), ("USD_M_PERPETUAL", usd_m_campaign)):
        seeded = campaign["seeded"]
        if isinstance(seeded, dict):
            anomalies = seeded["totalAnomalies"]
            rendered = (
                ", ".join(f"{kind}={count}" for kind, count in anomalies.items())
                if isinstance(anomalies, dict) and anomalies
                else "none"
            )
            lines.append(
                f"| {label} | {seeded['scripts']} | {seeded['completeFinalViews']} | {rendered} |"
            )
    lines.append("")
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: q04_replay_campaign.py OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    fixture_path = output_root / "fixtures" / "q04_replay_golden_v1.json"
    campaign_path = output_root / "generated" / "q04" / "replay_campaign.v1.json"
    markdown_path = output_root / "generated" / "q04" / "replay_campaign.v1.md"
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    campaign_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_bytes(fixture_bytes)
    campaign_path.write_bytes(campaign_bytes)
    markdown_path.write_bytes(markdown_bytes)
    print(f"fixture sha256 {hashlib.sha256(fixture_bytes).hexdigest()}")
    print(f"campaign sha256 {hashlib.sha256(campaign_bytes).hexdigest()}")
    print(f"markdown sha256 {hashlib.sha256(markdown_bytes).hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
