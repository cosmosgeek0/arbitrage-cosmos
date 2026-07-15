# VenueMesh isolated fixture preview

Run only the module-local renderer:

```sh
node frontier/venue-mesh/preview/render-preview.mjs
```

It prints deterministic JSON to stdout. It opens no transport, writes no file, exposes no control, and is not a cockpit projection. The preview deliberately keeps all researched source cards ineligible for market-data retention and therefore renders the cross-venue dislocation as `UNKNOWN`, not actionable.
