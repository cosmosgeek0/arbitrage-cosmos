# F0 Dock resume

F0 is sealed at `FRONTIER_CONTRACT_READY`; do not continue implementation unless the director explicitly reopens it.

On resume:

1. verify branch `f-dock-0715f` and a clean tree;
2. verify `HEAD` is the exact sealed SHA reported by the F0 worker;
3. verify `frontier/directives/Frontier.md` against `frontier/directives/Frontier.sha256`;
4. run only `node --test frontier/dock/tests/conformance.test.mjs`;
5. preserve all files outside `frontier/dock/**` and the already-sealed directive pair;
6. do not merge, push, mount, wire, repair product code, or run the full repository battery.

Current blocker: `ANNOTATION_ADAPTER` lacks the canonical Q revision/retraction contract, so only F11 is blocked. Do not invent a substitute.
