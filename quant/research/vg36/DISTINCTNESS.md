# V-G36 family distinctness

V-G36 is materially distinct from earlier raw-volume families.

| Dimension | V-G36 frozen law |
| --- | --- |
| Input | Per-bar taker-buy quote-volume share `TBQV[10] / QV[7]` |
| Cross-section | Equal mean of twelve dimensionless constituent shares |
| Transformation | Logit of the cohort share, then first difference |
| Normalization | Median/MAD of only the prior `L` innovations |
| Event | Isolated negative innovation shock with prior z-score greater than -1 |
| Timing | Observe `t`; embargo all of `t+1`; enter at `t+2` open |
| Exposure | Entire static cohort, equal weight, fixed units, fixed `H`; cash otherwise |
| Forbidden signal inputs | Price, return, raw/base volume, quote-volume level, trade count |

Raw quote-volume magnitude, volume change, abnormal-volume duration, volume
concentration, turnover, and price-volume correlation cannot reproduce this
signal without the taker-side composition field and its frozen nonlinear
transformation. Conversely, V-G36 cannot claim trade-level aggressor sequencing,
order-book causality, or participant intent from a daily aggregate ratio.

The nearest sibling is V-G10, whose 15-minute input
`2 * TBQV / QV - 1` is an affine transform of the same directional share.
V-G36 does not claim input novelty against V-G10. Its materially different
frozen mechanism is a daily negative first-difference shock in the logit of a
static twelve-member mean, followed by a full-day embargo and whole-cohort
binary exposure. V-G10 instead studies positive time-of-day-residual imbalance
levels with four-bar persistence and selected-cohort 2/4-hour continuation.

Synthetic invariance tests must prove that changing OHLC, raw volume, and trade
count while preserving fields 7 and 10 leaves every signal unchanged. A separate
lookahead test must prove that changing all future bars cannot alter an already
formed signal.
