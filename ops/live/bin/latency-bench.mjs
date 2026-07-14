#!/usr/bin/env node
// ops/live/bin/latency-bench.mjs — region / full-chain latency benchmark harness.
//
// Implements the ARTIFACT portion of launch amendment L-B: a runnable-later
// harness that measures network-leg latency distributions (DNS, TCP, TLS,
// TTFB, total) against a parameterized target list, and emits a report whose
// `chainStages` section names all seven L-B stages so app-internal
// instrumentation can be merged in at integration time.
//
// SAFETY: this tool makes NO network connection unless BOTH of these are
// true at invocation time:
//   1. the operator passes --confirm-network on the command line, and
//   2. the environment carries OPS_ALLOW_NETWORK=1.
// The default mode is --plan, which only reads the targets file and prints
// what WOULD be measured. Targets ship as documented placeholders
// (ops/live/bench/targets.json.template); nothing real is hard-coded, and
// no exchange matching location or region (e.g. Tokyo) is assumed.
//
// Usage:
//   latency-bench.mjs --plan  [--targets <file>]
//   latency-bench.mjs --run   --confirm-network [--targets <file>]
//                     [--samples N] [--out <file>]
//
// Exit codes: 0 ok; 1 every target failed completely; 2 usage/authorization.
import { readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";

const CHAIN_STAGES = [
  { stage: "exchange_event_to_local_receive", measuredBy: "network-leg-proxy (this harness: total)", note: "true value needs app receive timestamps" },
  { stage: "receive_to_evidence_features", measuredBy: "app-internal-instrumentation", note: "not measurable from outside the process" },
  { stage: "features_to_decision_proposal", measuredBy: "app-internal-instrumentation", note: "not measurable from outside the process" },
  { stage: "approval_to_durable_intent", measuredBy: "app-internal-instrumentation", note: "ledger fsync timing; not measurable here" },
  { stage: "intent_to_network_submission", measuredBy: "network-leg-proxy (this harness: dns+tcp+tls)", note: "connection setup cost per cold submission" },
  { stage: "submission_to_acknowledgement", measuredBy: "network-leg-proxy (this harness: ttfb)", note: "server turn-around upper bound" },
  { stage: "acknowledgement_to_private_stream_confirmation", measuredBy: "not-measured-by-this-harness", note: "requires an authorized private stream; separate owner authorization" },
];

function usageExit(msg) {
  if (msg) console.error(`latency-bench: ${msg}`);
  console.error("usage: latency-bench.mjs --plan|--run [--confirm-network] [--targets f] [--samples N] [--out f]");
  process.exit(2);
}

const args = process.argv.slice(2);
const opts = { mode: "plan", targets: null, samples: null, out: null, confirmNetwork: false };
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--plan": opts.mode = "plan"; break;
    case "--run": opts.mode = "run"; break;
    case "--confirm-network": opts.confirmNetwork = true; break;
    case "--targets": opts.targets = args[++i] ?? usageExit("--targets needs a value"); break;
    case "--samples": opts.samples = Number(args[++i]); break;
    case "--out": opts.out = args[++i] ?? usageExit("--out needs a value"); break;
    case "-h": case "--help": usageExit(); break;
    default: usageExit(`unknown argument: ${args[i]}`);
  }
}
if (!opts.targets) usageExit("--targets <file> is required");
if (opts.samples !== null && (!Number.isInteger(opts.samples) || opts.samples < 1 || opts.samples > 1000)) {
  usageExit("--samples must be an integer in [1,1000]");
}

let config;
try {
  config = JSON.parse(readFileSync(opts.targets, "utf8"));
} catch (err) {
  usageExit(`cannot read targets file ${opts.targets}: ${err.message}`);
}
const targets = Array.isArray(config.targets) ? config.targets : [];
if (targets.length === 0) usageExit("targets file has no targets[]");
for (const t of targets) {
  if (typeof t.url !== "string" || typeof t.label !== "string") {
    usageExit("every target needs {label, url}");
  }
  let u;
  try { u = new URL(t.url); } catch { usageExit(`invalid url for target ${t.label}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    usageExit(`target ${t.label}: only http/https URLs are allowed (got ${u.protocol})`);
  }
}
const samples = opts.samples ?? (Number.isInteger(config.samplesPerTarget) ? config.samplesPerTarget : 20);

function emit(report) {
  const text = JSON.stringify(report, null, 2) + "\n";
  if (opts.out) writeFileSync(opts.out, text);
  else process.stdout.write(text);
}

if (opts.mode === "plan") {
  emit({
    mode: "plan",
    generatedAtUtc: new Date().toISOString(),
    note: "no network connection was made; run mode requires --confirm-network AND OPS_ALLOW_NETWORK=1 under explicit owner authorization",
    samplesPerTarget: samples,
    targets: targets.map((t) => ({ label: t.label, url: t.url })),
    candidateRegions: config.candidateRegions ?? [],
    alsoBenchmarkAtRunTime: [
      "repeated distributions per candidate region (not single-shot averages)",
      "disconnect/reconnect behavior",
      "rate-limit posture at the measurement cadence",
      "stable outbound identity/IP constraints",
      "cost and operational constraints of the region",
    ],
    chainStages: CHAIN_STAGES,
  });
  process.exit(0);
}

// --- run mode: double authorization gate --------------------------------------
if (!opts.confirmNetwork) {
  console.error("latency-bench: REFUSED: run mode requires --confirm-network (network activity is not authorized by default)");
  process.exit(2);
}
if (process.env.OPS_ALLOW_NETWORK !== "1") {
  console.error("latency-bench: REFUSED: run mode requires OPS_ALLOW_NETWORK=1 in the environment (separate, deliberate authorization)");
  process.exit(2);
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function stats(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const round = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
  return {
    n: s.length,
    min: round(s[0]),
    p50: round(quantile(s, 0.5)),
    p90: round(quantile(s, 0.9)),
    p99: round(quantile(s, 0.99)),
    max: round(s[s.length - 1]),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

function sampleOnce(url, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const t = { start: performance.now() };
    const phases = {};
    const req = mod.get(u, { agent: false }, (res) => {
      phases.ttfb = performance.now() - t.start; // headers received
      res.on("end", () => {
        phases.total = performance.now() - t.start;
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode, phases });
      });
      res.resume();
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("socket", (socket) => {
      socket.once("lookup", () => { phases.dns = performance.now() - t.start; });
      socket.once("connect", () => { phases.tcpConnect = performance.now() - t.start; });
      socket.once("secureConnect", () => { phases.tlsHandshake = performance.now() - t.start; });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message, phases }));
  });
}

const timeoutMs = Number.isInteger(config.timeoutMs) ? config.timeoutMs : 10000;
const results = [];
for (const target of targets) {
  const u = new URL(target.url);
  const dnsMs = [];
  if (!isIP(u.hostname)) {
    for (let i = 0; i < Math.min(samples, 5); i++) {
      const t0 = performance.now();
      try { await lookup(u.hostname); dnsMs.push(performance.now() - t0); } catch { /* counted below via request errors */ }
    }
  }
  const perPhase = { dns: [], tcpConnect: [], tlsHandshake: [], ttfb: [], total: [] };
  let failures = 0;
  for (let i = 0; i < samples; i++) {
    const r = await sampleOnce(target.url, timeoutMs);
    if (!r.ok) { failures++; continue; }
    for (const k of Object.keys(perPhase)) {
      if (typeof r.phases[k] === "number") perPhase[k].push(r.phases[k]);
    }
  }
  results.push({
    label: target.label,
    url: target.url,
    samples,
    failures,
    ok: failures < samples,
    phasesMs: {
      dnsLookupIsolated: stats(dnsMs),
      dns: stats(perPhase.dns),
      tcpConnect: stats(perPhase.tcpConnect),
      tlsHandshake: stats(perPhase.tlsHandshake),
      ttfb: stats(perPhase.ttfb),
      total: stats(perPhase.total),
    },
  });
}

const anyOk = results.some((r) => r.ok);
emit({
  mode: "run",
  ranAtUtc: new Date().toISOString(),
  samplesPerTarget: samples,
  results,
  candidateRegions: config.candidateRegions ?? [],
  chainStages: CHAIN_STAGES,
  caveats: [
    "single-host measurement; repeat from every candidate region before any region decision",
    "region moves happen only through a reviewed deployment decision with rollback proof (L-B)",
  ],
});
process.exit(anyOk ? 0 : 1);
