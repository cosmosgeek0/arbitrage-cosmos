# DecisionLab local preview

`src/preview.mjs` builds a strict, deterministic, read-only projection from a fully validated report and its immutable source request. The focused suite additionally sends that projection through the exact F0 `COCKPIT_PROJECTION` binding.

The projection is always:

```text
truthClass: FIXTURE_PROJECTION
authorityClass: NO_AUTHORITY
networkMode: FIXTURE_ONLY
canonical: false
mounted: false
controls: []
canonicalSurfaceId: null
bindingState: DIRECTOR_MOUNT_REQUIRED
```

No static preview is promoted as a recorded result while the module is blocked. Synthetic and unverified recorded-shape previews are exercised in `tests/decision-lab.test.mjs`; all owner-dependent alternative and ablation results remain `UNAVAILABLE`.
