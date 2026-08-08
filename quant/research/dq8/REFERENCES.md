# DQ-8 primary references

Checked 2026-07-30.

- [RFC 3339: Date and Time on the Internet](https://www.rfc-editor.org/rfc/rfc3339):
  canonical, explicitly zoned timestamp labels.
- [Python `datetime` documentation](https://docs.python.org/3/library/datetime.html):
  aware UTC timestamp conversion and validation.
- [GIPS Standards Handbook for Firms](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/):
  valuation timing and external-cash-flow context. DQ-8 deliberately excludes
  external flows from its flat-to-flat v1 path.
- [17 CFR 270.2a-4](https://www.law.cornell.edu/cfr/text/17/270.2a-4):
  regulatory context for asset value, liabilities, and NAV inputs.
- [17 CFR 275.206(4)-1](https://www.ecfr.gov/current/title-17/chapter-II/part-275/section-275.206%284%29-1):
  same-period and same-method comparison context for performance presentation.
- [Goldberg and Mahmoud, “On a Convex Measure of Drawdown Risk”](https://arxiv.org/abs/1404.7493):
  peak-to-trough drawdown terminology and path dependence.
- [Binance Spot REST API documentation](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md):
  primary exchange documentation showing that market-data fields have explicit
  timestamps and semantic field names. DQ-8 remains venue-neutral.
- [pandas `merge_asof` documentation](https://pandas.pydata.org/docs/reference/api/pandas.merge_asof.html):
  official documentation for nearest/backward/forward inexact joins. DQ-8
  intentionally exposes no such tolerance or matching mode.
