# Q00-001 — durable Q-lane path casing

Status: accepted for Q-lane artifacts on 2026-07-12.

## Context

The factory examples use lowercase `quant/tasks` and `quant/receipts`. The later explicit launch instruction requires `quant/TASKS/<phase>.md`, `quant/RECEIPTS/<phase>.md`, and `quant/DECISIONS/<id>.md`.

## Decision

Use only the explicit uppercase directories `quant/TASKS`, `quant/RECEIPTS`, and `quant/DECISIONS`. Do not create case-variant duplicates. Existing `quant/DIRECTIVE_INPUTS.lock` remains frozen in the quant root.

## Consequences

State and resume instructions always name exact case-sensitive paths. Any future tooling must treat a lowercase variant as an error, not an alias.
