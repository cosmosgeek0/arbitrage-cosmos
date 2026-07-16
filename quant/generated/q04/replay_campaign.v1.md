# Q04 replay campaign (synthetic fixture evidence only)

Deterministic replay proof for the Q04 local-book reference model. Nothing in
this campaign is observed market data; no coverage, latency or edge claim is
made. Golden and seeded scripts settle through lawful resynchronization only.

- Seed: `20260712`
- Campaign artifact fixture binding: `32e134938d9e2ba5e9f32fb279bfa9bf9c6dcc8abe0d220107382d7f78fa6aec`

| Product | Golden script SHA-256 | Golden result SHA-256 | Steps | Effects |
| --- | --- | --- | ---: | ---: |
| SPOT | `b61f0c058b253ebe88a1e871db1fc4d246e5b14ebb6e26f10a3777b5ec6cd8e6` | `57d9e8bf1c15cd6cfb14aa411fda3b5a49e2e39c71e79bcd1bee6731b2532e1d` | 14 | 36 |
| USD_M_PERPETUAL | `c0bd8386b8691ff2fa9bf0eb6bbfbfab5d72caf1661af9318d153165b0740194` | `151a349f007fdef9643431f6b37c556bd549449031ad0a005e5e8e6a7b10bec4` | 14 | 37 |

| Product | Seeded scripts | Complete finals | Total anomalies |
| --- | ---: | ---: | --- |
| SPOT | 8 | 8 | FORWARD_GAP=4, RECONNECT=14, SNAPSHOT_BRIDGE_GAP=2, STALE_SNAPSHOT=14, UNMATCHED_SNAPSHOT=11, UNSOLICITED_SNAPSHOT=40 |
| USD_M_PERPETUAL | 8 | 8 | PU_MISMATCH=16, RECONNECT=14, SNAPSHOT_BRIDGE_GAP=23, UNMATCHED_SNAPSHOT=15, UNSOLICITED_SNAPSHOT=26 |
