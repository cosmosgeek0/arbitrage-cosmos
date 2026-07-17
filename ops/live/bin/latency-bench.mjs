#!/usr/bin/env node
// ops/live/bin/latency-bench.mjs — region / full-chain latency benchmark harness.
//
// SAFETY: run mode makes network connections only when --confirm-network and
// OPS_ALLOW_NETWORK=1 are both present. Plan mode is network-free. Every DNS
// batch and HTTP sample has an absolute wall-clock deadline; injected seams
// keep deadline behavior deterministic and network-free in regression tests.
import { readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_DNS_ATTEMPTS = 5;
const SAFE_ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

const CHAIN_STAGES = [
  { stage: "exchange_event_to_local_receive", measuredBy: "network-leg-proxy (this harness: total)", note: "true value needs app receive timestamps" },
  { stage: "receive_to_evidence_features", measuredBy: "app-internal-instrumentation", note: "not measurable from outside the process" },
  { stage: "features_to_decision_proposal", measuredBy: "app-internal-instrumentation", note: "not measurable from outside the process" },
  { stage: "approval_to_durable_intent", measuredBy: "app-internal-instrumentation", note: "ledger fsync timing; not measurable here" },
  { stage: "intent_to_network_submission", measuredBy: "network-leg-proxy (this harness: dns+tcp+tls)", note: "connection setup cost per cold submission" },
  { stage: "submission_to_acknowledgement", measuredBy: "network-leg-proxy (this harness: ttfb)", note: "server turn-around upper bound" },
  { stage: "acknowledgement_to_private_stream_confirmation", measuredBy: "not-measured-by-this-harness", note: "requires an authorized private stream; separate owner authorization" },
];

const SYSTEM_SCHEDULER = Object.freeze({
  schedule(delayMs, task) {
    const handle = setTimeout(task, delayMs);
    return Object.freeze({ cancel: () => clearTimeout(handle) });
  },
});

function validTimeoutMs(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_TIMEOUT_MS;
}

function sanitizedError(error, fallbackCode, prefix) {
  const candidate = error && typeof error === "object" ? error.code : null;
  const code = typeof candidate === "string" && SAFE_ERROR_CODE_RE.test(candidate)
    ? candidate
    : fallbackCode;
  return Object.freeze({ code, message: `${prefix} (${code}).` });
}

export function measureDnsLookup(hostname, timeoutMs, dependencies = {}) {
  if (typeof hostname !== "string" || hostname.length === 0) {
    throw new TypeError("DNS hostname must be a nonempty string");
  }
  if (!validTimeoutMs(timeoutMs)) throw new RangeError(`DNS timeoutMs must be an integer in [1,${MAX_TIMEOUT_MS}]`);
  const now = dependencies.now ?? (() => performance.now());
  const scheduler = dependencies.scheduler ?? SYSTEM_SCHEDULER;
  const lookupFn = dependencies.lookup ?? ((value) => lookup(value));
  if (typeof now !== "function" || typeof scheduler?.schedule !== "function" || typeof lookupFn !== "function") {
    throw new TypeError("DNS deadline dependencies are invalid");
  }
  const startedAt = now();
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    let deadlineHandle = null;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      try { deadlineHandle?.cancel(); } catch { /* the settled result remains authoritative */ }
      resolve(Object.freeze(result));
    };
    const expire = () => {
      if (settled) return;
      settled = true;
      try { deadlineHandle?.cancel(); } catch { /* timeout remains authoritative */ }
      controller.abort("DNS_DEADLINE_EXCEEDED");
      resolve(Object.freeze({
        ok: false,
        error: Object.freeze({
          code: "DNS_DEADLINE_EXCEEDED",
          message: "DNS lookup exceeded its absolute deadline.",
        }),
      }));
    };
    try {
      deadlineHandle = scheduler.schedule(timeoutMs, expire);
    } catch {
      expire();
      return;
    }
    let operation;
    try {
      operation = lookupFn(hostname, Object.freeze({ signal: controller.signal }));
    } catch (error) {
      settle({ ok: false, error: sanitizedError(error, "DNS_LOOKUP_FAILED", "DNS lookup failed") });
      return;
    }
    Promise.resolve(operation).then(
      () => {
        if (!settled) settle({ ok: true, durationMs: now() - startedAt });
      },
      (error) => {
        if (!settled) settle({ ok: false, error: sanitizedError(error, "DNS_LOOKUP_FAILED", "DNS lookup failed") });
      },
    );
  });
}

export function sampleOnce(url, timeoutMs, dependencies = {}) {
  if (!validTimeoutMs(timeoutMs)) throw new RangeError(`HTTP timeoutMs must be an integer in [1,${MAX_TIMEOUT_MS}]`);
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("sample URL must use http or https");
  }
  const now = dependencies.now ?? (() => performance.now());
  const scheduler = dependencies.scheduler ?? SYSTEM_SCHEDULER;
  const get = dependencies.get ?? (parsed.protocol === "https:" ? https.get.bind(https) : http.get.bind(http));
  if (typeof now !== "function" || typeof scheduler?.schedule !== "function" || typeof get !== "function") {
    throw new TypeError("HTTP deadline dependencies are invalid");
  }
  const controller = new AbortController();
  const startedAt = now();
  const phases = {};
  return new Promise((resolve) => {
    let settled = false;
    let deadlineHandle = null;
    let request = null;
    let response = null;
    const snapshotPhases = () => Object.freeze({ ...phases });
    const settle = (result) => {
      if (settled) return;
      settled = true;
      try { deadlineHandle?.cancel(); } catch { /* the settled result remains authoritative */ }
      resolve(Object.freeze({ ...result, phases: snapshotPhases() }));
    };
    const expire = () => {
      if (settled) return;
      settled = true;
      try { deadlineHandle?.cancel(); } catch { /* timeout remains authoritative */ }
      controller.abort("HTTP_DEADLINE_EXCEEDED");
      try { response?.destroy?.(); } catch { /* best-effort resource cleanup */ }
      try { request?.destroy?.(); } catch { /* best-effort resource cleanup */ }
      resolve(Object.freeze({
        ok: false,
        error: Object.freeze({
          code: "HTTP_DEADLINE_EXCEEDED",
          message: "HTTP sample exceeded its absolute deadline.",
        }),
        phases: snapshotPhases(),
      }));
    };
    try {
      deadlineHandle = scheduler.schedule(timeoutMs, expire);
      request = get(parsed, { agent: false, signal: controller.signal }, (incoming) => {
        incoming.on("error", (error) => {
          if (!settled) settle({ ok: false, error: sanitizedError(error, "HTTP_RESPONSE_FAILED", "HTTP response failed"), phases });
        });
        if (settled) {
          try { incoming.destroy?.(); } catch { /* late response is inert */ }
          return;
        }
        response = incoming;
        phases.ttfb = now() - startedAt;
        incoming.on("end", () => {
          if (settled) return;
          phases.total = now() - startedAt;
          settle({
            ok: incoming.statusCode >= 200 && incoming.statusCode < 400,
            statusCode: incoming.statusCode,
            phases,
          });
        });
        incoming.on("aborted", () => {
          settle({
            ok: false,
            error: Object.freeze({ code: "HTTP_RESPONSE_ABORTED", message: "HTTP response failed (HTTP_RESPONSE_ABORTED)." }),
            phases,
          });
        });
        incoming.resume();
      });
      request.on("socket", (socket) => {
        if (settled) return;
        socket.once("lookup", () => {
          if (settled) return;
          phases.dns = now() - startedAt;
        });
        socket.once("connect", () => {
          if (settled) return;
          phases.tcpConnect = now() - startedAt;
        });
        socket.once("secureConnect", () => {
          if (settled) return;
          phases.tlsHandshake = now() - startedAt;
        });
      });
      request.on("error", (error) => {
        if (!settled) settle({ ok: false, error: sanitizedError(error, "HTTP_REQUEST_FAILED", "HTTP request failed"), phases });
      });
    } catch (error) {
      settle({ ok: false, error: sanitizedError(error, "HTTP_REQUEST_FAILED", "HTTP request failed"), phases });
    }
  });
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stats(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const round = (value) => (value == null ? null : Math.round(value * 1000) / 1000);
  return {
    n: sorted.length,
    min: round(sorted[0]),
    p50: round(quantile(sorted, 0.5)),
    p90: round(quantile(sorted, 0.9)),
    p99: round(quantile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
  };
}

function usageExit(message) {
  if (message) console.error(`latency-bench: ${message}`);
  console.error("usage: latency-bench.mjs --plan|--run [--confirm-network] [--targets f] [--samples N] [--out f]");
  process.exit(2);
}

function parseOptions(args) {
  const options = { mode: "plan", targets: null, samples: null, out: null, confirmNetwork: false };
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case "--plan": options.mode = "plan"; break;
      case "--run": options.mode = "run"; break;
      case "--confirm-network": options.confirmNetwork = true; break;
      case "--targets": options.targets = args[++index] ?? usageExit("--targets needs a value"); break;
      case "--samples": options.samples = Number(args[++index]); break;
      case "--out": options.out = args[++index] ?? usageExit("--out needs a value"); break;
      case "-h":
      case "--help": usageExit(); break;
      default: usageExit(`unknown argument: ${args[index]}`);
    }
  }
  if (!options.targets) usageExit("--targets <file> is required");
  if (options.samples !== null && (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 1000)) {
    usageExit("--samples must be an integer in [1,1000]");
  }
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  let config;
  try {
    config = JSON.parse(readFileSync(options.targets, "utf8"));
  } catch (error) {
    usageExit(`cannot read targets file ${options.targets}: ${error.message}`);
  }
  const targets = Array.isArray(config.targets) ? config.targets : [];
  if (targets.length === 0) usageExit("targets file has no targets[]");
  for (const target of targets) {
    if (typeof target.url !== "string" || typeof target.label !== "string") {
      usageExit("every target needs {label, url}");
    }
    let parsed;
    try { parsed = new URL(target.url); } catch { usageExit(`invalid url for target ${target.label}`); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      usageExit(`target ${target.label}: only http/https URLs are allowed (got ${parsed.protocol})`);
    }
  }
  const samples = options.samples ?? (Number.isInteger(config.samplesPerTarget) ? config.samplesPerTarget : 20);
  if (!Number.isInteger(samples) || samples < 1 || samples > 1000) {
    usageExit("samplesPerTarget must be an integer in [1,1000]");
  }
  const timeoutMs = config.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : config.timeoutMs;
  if (!validTimeoutMs(timeoutMs)) usageExit(`timeoutMs must be an integer in [1,${MAX_TIMEOUT_MS}]`);
  const emit = (report) => {
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (options.out) writeFileSync(options.out, text);
    else process.stdout.write(text);
  };

  if (options.mode === "plan") {
    emit({
      mode: "plan",
      generatedAtUtc: new Date().toISOString(),
      note: "no network connection was made; run mode requires --confirm-network AND OPS_ALLOW_NETWORK=1 under explicit owner authorization",
      samplesPerTarget: samples,
      timeoutMs,
      targets: targets.map((target) => ({ label: target.label, url: target.url })),
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
    return 0;
  }

  if (!options.confirmNetwork) {
    console.error("latency-bench: REFUSED: run mode requires --confirm-network (network activity is not authorized by default)");
    return 2;
  }
  if (process.env.OPS_ALLOW_NETWORK !== "1") {
    console.error("latency-bench: REFUSED: run mode requires OPS_ALLOW_NETWORK=1 in the environment (separate, deliberate authorization)");
    return 2;
  }

  const results = [];
  for (const target of targets) {
    const parsed = new URL(target.url);
    const dnsMs = [];
    const dnsFailures = [];
    let dnsAttempts = 0;
    if (!isIP(parsed.hostname)) {
      const dnsBatchStartedAt = performance.now();
      for (let attempt = 1; attempt <= Math.min(samples, MAX_DNS_ATTEMPTS); attempt += 1) {
        const elapsedMs = performance.now() - dnsBatchStartedAt;
        const remainingMs = Math.max(0, Math.ceil(timeoutMs - elapsedMs));
        if (remainingMs < 1) {
          dnsFailures.push({ attempt, code: "DNS_DEADLINE_EXCEEDED" });
          break;
        }
        dnsAttempts += 1;
        const result = await measureDnsLookup(parsed.hostname, remainingMs);
        if (result.ok) dnsMs.push(result.durationMs);
        else {
          dnsFailures.push({ attempt, code: result.error.code });
          if (result.error.code === "DNS_DEADLINE_EXCEEDED") break;
        }
      }
    }
    const perPhase = { dns: [], tcpConnect: [], tlsHandshake: [], ttfb: [], total: [] };
    const requestFailureCounts = {};
    let failures = 0;
    for (let sample = 0; sample < samples; sample += 1) {
      const result = await sampleOnce(target.url, timeoutMs);
      if (!result.ok) {
        failures += 1;
        const code = result.error?.code ?? "HTTP_STATUS_FAILED";
        requestFailureCounts[code] = (requestFailureCounts[code] ?? 0) + 1;
        continue;
      }
      for (const key of Object.keys(perPhase)) {
        if (typeof result.phases[key] === "number") perPhase[key].push(result.phases[key]);
      }
    }
    results.push({
      label: target.label,
      url: target.url,
      samples,
      failures,
      ok: failures < samples,
      dnsLookupDiagnostics: {
        attempts: dnsAttempts,
        failures: dnsFailures,
      },
      requestFailureCounts,
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

  const anyOk = results.some((result) => result.ok);
  emit({
    mode: "run",
    ranAtUtc: new Date().toISOString(),
    samplesPerTarget: samples,
    timeoutMs,
    results,
    candidateRegions: config.candidateRegions ?? [],
    chainStages: CHAIN_STAGES,
    caveats: [
      "single-host measurement; repeat from every candidate region before any region decision",
      "region moves happen only through a reviewed deployment decision with rollback proof (L-B)",
    ],
  });
  return anyOk ? 0 : 1;
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  process.exit(await main());
}
