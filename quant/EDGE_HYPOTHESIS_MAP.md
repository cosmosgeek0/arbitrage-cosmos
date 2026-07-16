# Edge/Hypothesis Map

Registry revision: `edge-hypotheses-2026-07-12-v2`
Registry as-of UTC milliseconds: `1783814400000`

Truth posture: `RESEARCH_PORTFOLIO_ONLY`. This deterministic projection is a falsification portfolio, not evidence that edge exists, a calibrated probability, or an actionable recommendation.

Every substantive line below is rendered from the canonical machine registry. Manual prose or status edits fail verification.

### `H1_DORMANT_TO_ACTIVE_EARLY_TRANSITION` — `DATA_INSUFFICIENT`

- **Hypothesis:** Pre-cutoff intensity/liquidity changes improve early-transition ranking over simple activity baselines.
- **Null hypothesis:** The features are contemporaneous activity measures with no usable lead over transparent baselines.
- **Economic mechanism:** Trade-intensity and liquidity state can transition before a fully developed price/volume event.
- **Required sources:** historical coarse Event Atlas; forward trades/book ticker/depth; point-in-time instrument master; gap evidence
- **Coverage and missingness:** No versioned dormant-to-active discovery rules, point-in-time universe or event-grouped labels exist yet.
- **Gross opportunity definition:** Probability or rank of an objectively defined post-cutoff ignition within horizon H, conditional on coverage.
- **Economics floor:** spread and impact; fees; latency to usable evidence; recovery cost; false-focus capacity cost
- **Capacity and crowding:** Early signals must precede crowded volume expansion and retain enough executable depth for the declared size.
- **Primary metric:** Later-holdout precision-recall, calibration and median lead time at bounded focus capacity.
- **Controls:** matched quiet periods; natural non-event wakes; rejected candidates; missed known events
- **Multiple-testing family:** IGNITION_LOOKBACK_HORIZON_THRESHOLD
- **Minimum effective evidence:** Event-grouped chronological cohorts with natural prevalence, purging/embargo and independent later regimes.
- **Promotion criterion:** Meaningful later-holdout lead and calibrated uplift at the production focus budget.
- **Continuation criterion:** Continue only while detection lead time and later-holdout precision remain stable across symbol and regime cohorts.
- **Kill/retirement criterion:** Reject if lead time disappears, calibration is unsupported, or the signal only detects already-active events.

### `H2_CONTINUATION_VERSUS_EXHAUSTION` — `RESEARCH`

- **Hypothesis:** Leakage-safe market structure improves continuation/exhaustion and exit-capacity estimates over price-only baselines.
- **Null hypothesis:** Scores reflect post-onset leakage, aggregation artifacts or non-executable hindsight and do not calibrate later.
- **Economic mechanism:** Post-onset flow, depth consumption and cross-market state may separate continuation from exhaustion/fade and constrained exit capacity.
- **Required sources:** forward high-fidelity Event Atlas; objective stage labels; sequenced depth; trade aggregation variants; point-in-time filters
- **Coverage and missingness:** Primary-source review is recorded, but Q has no objective event labels, contemporaneous depth outcomes or calibration cohorts.
- **Gross opportunity definition:** Separate CONTINUATION_H, EXHAUSTION_H, FADE_H and EXIT_CAPACITY(q,H) targets after an explicit cutoff.
- **Economics floor:** future executable bid capacity; VWAP impact; fees; funding; latency; time-to-fill and recovery
- **Capacity and crowding:** Exit capacity is defined for explicit size and horizon; future candle highs are not executable exits.
- **Primary metric:** Brier/log loss and calibration slope/intercept plus fill fraction, impact and time-to-fill by q/H.
- **Controls:** matched continuation events; matched fades; natural wakes; quiet controls
- **Multiple-testing family:** STAGE_EXIT_SIZE_HORIZON
- **Minimum effective evidence:** Whole-event chronological splits with natural prevalence, forward depth, explicit q/H labels and reliability uncertainty.
- **Promotion criterion:** Calibrated later-holdout improvement and economically useful exit-capacity discrimination with adequate coverage.
- **Continuation criterion:** Continue only while calibration, coverage and size-conditioned exit metrics hold on later event clusters.
- **Kill/retirement criterion:** Reject probability semantics when calibration data are insufficient; retire features that fail tick/lot/filter controls or later cohorts.

### `H3_EXECUTABLE_NORMAL_BASIS_CONVERGENCE` — `UNTESTED`

- **Hypothesis:** A subset of normal Basis dislocations has positive net value after full two-leg economics.
- **Null hypothesis:** After fees, funding, slippage, latency, recovery and selection effects, expected net value is non-positive.
- **Economic mechanism:** Temporary Spot/perpetual dislocation may converge when carrying costs and executable two-leg capacity do not consume the spread.
- **Required sources:** canonical Basis evidence/proposals; Spot and USD-M trades; sequenced depth with gaps; funding schedule; point-in-time fees
- **Coverage and missingness:** Existing engines expose current proposals, but Q has no point-in-time lake, outcome cohort, fee/borrow history, or executable-depth atlas.
- **Gross opportunity definition:** Point-in-time executable two-leg basis convergence over a declared horizon and size, before costs.
- **Economics floor:** both-leg fees; spread and slippage; funding through horizon; latency and recovery stress
- **Capacity and crowding:** Capacity is bounded by executable two-leg depth and shrinks under crowding; Q01 has no capacity observations.
- **Primary metric:** Later-holdout net expected value and calibration error by size/horizon, with coverage.
- **Controls:** matched non-convergent basis episodes; quiet same-symbol periods; rejected production proposals
- **Multiple-testing family:** BASIS_DIRECTION_HORIZON_SIZE
- **Minimum effective evidence:** Multiple non-overlapping chronological regimes with acted, rejected, missed and quiet controls and complete two-leg economics.
- **Promotion criterion:** Positive lower uncertainty bound on net value across required regimes, stable calibration, and non-trivial executable capacity.
- **Continuation criterion:** Continue only while later chronological cohorts preserve calibrated net value after full economics and capacity stress.
- **Kill/retirement criterion:** Reject if later holdouts are non-positive after costs, calibration fails, or capacity is economically trivial.

### `H4_REVERSE_BASIS_FEASIBILITY` — `DATA_INSUFFICIENT`

- **Hypothesis:** A subset of reverse Basis dislocations remains positive after borrow and recovery economics.
- **Null hypothesis:** Borrow scarcity, interest, fees, funding and recovery costs remove the apparent reverse spread.
- **Economic mechanism:** Reverse dislocations can converge only when Spot borrow and liability economics make the short leg executable and recoverable.
- **Required sources:** canonical Basis evidence/proposals; public market evidence; point-in-time borrow truth projection; fees and funding; sequenced depth
- **Coverage and missingness:** Historical borrow availability, liability state, recall risk and point-in-time rate truth are unavailable.
- **Gross opportunity definition:** Executable reverse-basis convergence for an explicit borrowed quantity, horizon and liability convention.
- **Economics floor:** borrow rate and convention; borrow availability and expiry; both-leg fees; funding; slippage; recall and recovery stress
- **Capacity and crowding:** Borrow inventory and close-out capacity are hard constraints; both are unavailable historically in Q01.
- **Primary metric:** Net expected value conditional on verified borrow capacity, with abstention coverage.
- **Controls:** normal-basis episodes; borrow-unavailable candidates; matched quiet periods
- **Multiple-testing family:** REVERSE_BASIS_BORROW_HORIZON_SIZE
- **Minimum effective evidence:** Point-in-time borrow snapshots plus complete two-leg outcomes across independent regimes.
- **Promotion criterion:** Fresh borrow truth, positive later-holdout lower bound, stable capacity and no authority bypass.
- **Continuation criterion:** Continue only while borrow truth is fresh and later cohorts retain net value under recall and recovery stress.
- **Kill/retirement criterion:** Retire if borrow truth cannot be obtained lawfully and point-in-time, or later net evidence is non-positive.

### `H5_FALSE_BURST_MANIPULATION_RISK_FILTERING` — `RESEARCH`

- **Hypothesis:** Repeated wake/fade history, breadth, print concentration, flow-impact consistency and liquidity state reduce false-burst errors over transparent activity baselines without inferring intent.
- **Null hypothesis:** The challengers encode tick/lot, aggregation, missing-book, post-onset or cohort artifacts and do not reduce later false positives after multiplicity and cost controls.
- **Economic mechanism:** False bursts and manipulation-like disorder can combine concentrated aggressive flow with fragile or vanishing executable liquidity; public patterns remain risk evidence, never intent truth.
- **Required sources:** historical coarse Event Atlas; forward high-fidelity Event Atlas; point-in-time instrument/filter master; raw-fill and burst-aggregated trade variants; sequenced depth and gap evidence; funding/OI/provider-sampled liquidation context
- **Coverage and missingness:** Q has primary-source constraints but no objective event/control labels, retained Event Atlas, complete sequenced depth outcomes or natural-prevalence calibration cohorts.
- **Gross opportunity definition:** Incremental reduction in future false-burst, exhaustion and constrained EXIT_CAPACITY(q,H) errors after an explicit pre-outcome cutoff, evidence-only.
- **Economics floor:** future executable bid capacity; VWAP impact and spread; fees and funding; evidence/decision latency; fill fraction/time and recovery
- **Capacity and crowding:** Capacity is defined for explicit size and horizon; public reaction is crowded, visible liquidity may vanish and future candle highs are not executable exits.
- **Primary metric:** Event-grouped later-holdout false-positive reduction, Brier/log loss and calibration plus fill fraction, impact and time-to-fill by q/H.
- **Controls:** matched natural wakes; quiet periods; known continuations and fades; rejected candidates; missed known events; tick/lot/filter-era controls
- **Multiple-testing family:** FALSE_BURST_FEATURE_STAGE_SIZE_HORIZON
- **Minimum effective evidence:** Whole-event chronological natural-prevalence cohorts with purging/embargo, raw/degraded source flags and independent later regimes.
- **Promotion criterion:** Incremental later-holdout error reduction and economically useful size-conditioned capacity discrimination with calibrated uncertainty and no intent claim.
- **Continuation criterion:** Continue only while event-clustered performance survives tick/lot/aggregation ablations, later regimes and explicit source-quality strata.
- **Kill/retirement criterion:** Reject probability semantics when calibration is insufficient and retire features driven by post-onset leakage, future peaks, aggregation artifacts or unavailable L2 truth.

### `H6_CROSS_SOURCE_LEADERSHIP` — `DATA_INSUFFICIENT`

- **Hypothesis:** A licensed external venue/context stream adds later-holdout predictive value after realistic delay and costs.
- **Null hypothesis:** Apparent Granger/lead effects are common-factor, clock, selection or latency artifacts with no net value.
- **Economic mechanism:** Some venues or funding markets may lead Binance public state, but only if timestamps and transport delay leave usable net value.
- **Required sources:** licensed external public source; canonical Binance evidence; stable identity map; receive clocks and gap manifests
- **Coverage and missingness:** No externally licensed, canonically owned cross-venue source card or forward capture is accepted.
- **Gross opportunity definition:** Point-in-time predictive lead after measured arrival delay and Binance execution-cost simulation, evidence-only.
- **Economics floor:** cross-venue fees; transfer-unavailable assumption; spread/slippage; source and network delay; outage/recovery
- **Capacity and crowding:** Public leadership can be arbitraged away; capacity and delay must be measured at the canonical producer's timestamps.
- **Primary metric:** Incremental later-holdout loss/decision value after measured source delay and full costs.
- **Controls:** same-venue lag controls; time-shift placebo; matched high-volatility periods
- **Multiple-testing family:** VENUE_SIGNAL_DELAY_HORIZON
- **Minimum effective evidence:** Licensed forward capture across independent regimes with synchronized clocks and outage controls.
- **Promotion criterion:** Licensed source, stable identity/timestamps, resilient capture and positive delayed net evidence.
- **Continuation criterion:** Continue only while later regimes preserve net value after source delay, cost and outage stress.
- **Kill/retirement criterion:** Reject if identity/time semantics, retention rights or canonical ownership fail, or net lead vanishes after delay.

### `H7_FUNDING_REGIME_TRANSITION` — `DATA_INSUFFICIENT`

- **Hypothesis:** Verified funding-cap or frequency transitions condition later Basis and disorder outcomes.
- **Null hypothesis:** Observed behavior is ordinary market regime variation unrelated to the funding-rule transition.
- **Economic mechanism:** Changes in funding interval, cap or frequency may alter positioning pressure and basis dynamics around settlement.
- **Required sources:** funding history; official rule/changelog evidence; mark/index/premium; basis and depth evidence
- **Coverage and missingness:** Funding-rate history is partly available, but historical cap/floor rule revisions and complete frequency transitions are not yet manifested.
- **Gross opportunity definition:** Rule-versioned change in future basis/stage distributions around verified funding regime transitions.
- **Economics floor:** verified funding schedule; fees; spread/slippage; latency; capacity and crowding
- **Capacity and crowding:** Capacity depends on contemporaneous depth and on how many participants react to the same public funding rule.
- **Primary metric:** Matched later-holdout effect and calibrated outcome improvement by verified transition class.
- **Controls:** unchanged funding regimes; matched basis episodes; quiet controls
- **Multiple-testing family:** FUNDING_RULE_PRODUCT_HORIZON
- **Minimum effective evidence:** Several independently dated rule transitions with verified effective times and matched controls.
- **Promotion criterion:** Stable effect across independent transitions with complete rule provenance and net economic relevance.
- **Continuation criterion:** Continue only if rule-versioned later regimes retain value after funding, spread and crowding stress.
- **Kill/retirement criterion:** Reject if transitions cannot be reconstructed point-in-time or later effects vanish after multiple-testing control.

### `H8_EXTERNAL_CONTEXT_EVENTS` — `DATA_INSUFFICIENT`

- **Hypothesis:** A narrowly admitted external context source improves a predeclared market-outcome target after delay and costs.
- **Null hypothesis:** Context features are hindsight, identity, timestamp or selection artifacts and add no later-holdout value.
- **Economic mechanism:** Listings, unlocks, announcements or on-chain state may condition market outcomes when identity and timing are point-in-time correct.
- **Required sources:** official or licensed context source; stable point-in-time identity map; publication and receive clocks; canonical market evidence
- **Coverage and missingness:** No announcement, unlock or on-chain source has passed the launch Section 6 source-card admission gates.
- **Gross opportunity definition:** Incremental outcome information available strictly after a source's verified public timestamp and local receive time.
- **Economics floor:** publication/receive delay; fees; spread/slippage; capacity/crowding; source outage and recovery
- **Capacity and crowding:** Public announcements are rapidly crowded; any value must survive publication-to-receive delay and liquidity stress.
- **Primary metric:** Incremental later-holdout loss and calibrated decision value versus market-only baselines.
- **Controls:** matched no-announcement periods; already-priced announcements; time-shift placebo; source-outage cohorts
- **Multiple-testing family:** CONTEXT_SOURCE_EVENT_TARGET_HORIZON
- **Minimum effective evidence:** Multiple independent event classes and later regimes with point-in-time identities and negative controls.
- **Promotion criterion:** Source admission complete and later-holdout incremental value survives timing, cost and multiplicity controls.
- **Continuation criterion:** Continue only when a specific admitted source shows incremental later-holdout value across event classes.
- **Kill/retirement criterion:** Reject sources without clear license/retention, stable identity or observable failure; retire non-incremental signals.
