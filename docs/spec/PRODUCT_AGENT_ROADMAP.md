# Product Agent Roadmap — US-stock agent suite

**Date:** 2026-06-07
**Status:** Planning
**Context for:** all tasks. Supersedes the interview-only framing — the suite is now
intended for **actual self-use, real-money operation**, not just the Whaleforce coding test.

> The interview brief asked for Task 1 + Task 2. The repo has since grown to four agents
> (Task 1 browser, Task 2 10-K extractor, Task 3 fundamentals strategy lab, Task 4 technical
> strategy lab). This document plans the next agents **and** the operational layer that a real
> product needs underneath them.

---

## 0. The framing shift: interview vs real money

Interview grading rewards **narrative + technical depth**. A real product is judged by a
completely different bar:

| Dimension | Interview | Real self-use product |
|---|---|---|
| What wins | deep eval, layered tradeoffs, honest failure modes | live P&L, not blowing up |
| Data | yfinance is fine | yfinance ToS is **personal/non-commercial only** → needs a paid feed for a product |
| Backtest | lookahead-free is the headline | lookahead-free **and** live-vs-backtest parity |
| Risk | per-case correctness | portfolio drawdown, position sizing, exposure limits |
| Compliance | n/a | giving *others* buy/sell advice → investment-adviser regulation |

**Consequence:** the most valuable next thing is **not** a fifth signal source. It is the
operational layer that makes any signal trustworthy and actionable live. We still build all
the signal agents below (that is the explicit goal) — but they are sequenced **after** the
foundation that keeps them honest.

---

## 1. Existing agents (baseline)

| ID | Agent | Signal axis | Key reusable infra |
|---|---|---|---|
| Task 1 | Browser agent | — (automation) | state machine, fault injection |
| Task 2 | SEC 10-K extractor | fundamental (document) | EDGAR ingest (`task2_10k_extractor/pipeline/ingest.py`), L1–L3 + confidence + quarantine |
| Task 3 | Fundamentals strategy lab | fundamental → strategy | `fetch_prices` (`task3_strategy/pipeline/prices.py`), lookahead-free backtest (`task3_strategy/pipeline/backtest.py`), DSL |
| Task 4 | Technical strategy lab | technical → strategy | indicators (`task4_technical/pipeline/indicators.py`), backtest (`task4_technical/pipeline/backtest.py`), DSL |

Shared throughout: `shared/llm_gateway.py`, `shared/cost_ledger.py`, `shared/schemas.py`,
`shared/artifacts.py`, per-task `pipeline/orchestrator.py`.

---

## 2. Foundation layer — build first (the "保命" layer)

These are not signal agents; without them, every signal above is unreliable live.

### F-A — Point-in-time data integrity / live-vs-backtest parity
The #1 killer of real strategies: the live data pipeline silently differs from the backtest one.

- **Survivorship bias** — does the universe include delisted/merged tickers, or only today's survivors?
- **Restated fundamentals** — 10-K numbers get restated; backtest must use *as-reported-at-the-time*, not as-revised.
- **Corporate actions** — split/dividend adjustment consistent between backtest and live.
- **Feed parity** — the price a backtest sees at date *t* must equal what live saw at *t* (no vendor revisions).

**Deliverable:** a point-in-time data layer wrapping `fetch_prices` + EDGAR ingest, with a
parity test that asserts backtest-feed == live-feed for a sampled date range. Extends the
existing "fail loud, never silent" principle to data freshness.

### F-B — Paid data feed migration
yfinance is personal-use only. Pick one (Polygon / Tiingo / Alpaca Data / IEX Cloud) and put it
behind the `fetch_prices` interface so the swap is one module. Decide **before** F-A, since
parity guarantees depend on the chosen vendor's point-in-time semantics.

### F-C — Compliance positioning
Pure self-use is fine. The moment the product gives *another person* buy/sell guidance it can
trip investment-adviser (RIA / 投顧) rules in most jurisdictions. Decide the product's framing
(neutral tool vs advice) before any external exposure. Documentation/disclaimer task, not code.

---

## 3. Operational agents — the analysis→action gap

### Task 10 — Portfolio / risk & position-sizing agent  *(highest real-money value)*
Real accounts hold many names; sizing decides P&L more than selection does.

- Inputs: the per-ticker signals from Task 3 / Task 4 / Task 5.
- Logic: position sizing (risk parity / vol targeting), correlation & exposure caps, single-name
  cap, total leverage cap, dynamic stop / drawdown control.
- Output: a target portfolio (weights) + risk report, backtestable as a portfolio (not per-name).
- **Reuses:** both backtest engines; needs a portfolio-level backtest extension.

### Task 11 — Execution / monitoring agent
Turns analysis into action for self-use.

- Broker integration: **Alpaca** (simplest API) or **IBKR** (broader instruments).
- Live signal-change alerts, position reconciliation, order placement with guardrails.
- **Reuses:** orchestrator pattern, `shared/logging.py`, cost/event ledger.

---

## 4. New signal agents (the explicitly-wanted set)

All of these are committed. Honest caveats are kept inline so we build them with eyes open.

### Task 5 — Ensemble / multi-agent arbitration  ✅ **BUILT (2026-06-07)**
Fuse Task 3 (fundamental thesis) + Task 4 (technical reading) into a single position
recommendation with **explicit conflict resolution** (e.g. "fundamentals bullish, technical
momentum rolling over → trim"). For real use its value is that it feeds Task 10 (sizing) and
Task 11 (execution), not just emitting another opinion.
- **Reuses:** both legs' building blocks (prices fetched once, shared) + Task 4's backtest metrics.
- **Implemented:** `task5_ensemble/` (schemas, `pipeline/{arbiter,combine,orchestrator}.py`,
  `api/router.py`), prompt `prompts/task5_ensemble/ensemble_arbiter.md`, wired at `/task5/ensembles`.
  An LLM arbiter picks one combine_mode from a fixed DSL (and / or / weighted /
  fundamental_gated_technical / defer_*) seeing each leg's reasoning but **not** its realized
  returns ([ADR-008](../adr/ADR-008-ensemble-arbiter-no-lookahead.md)). Graceful technical-only
  fallback when no 10-K. Combined-position backtest is lookahead-aligned to one common window.
- **Verified:** deterministic combine tests (`task5_ensemble/tests/test_combine.py`, incl. the
  ensemble-of-one-agent ≡ that-agent consistency check) + a live end-to-end run.
- **Eval:** `task5_ensemble/eval/` (`eval_set.yaml` + `runner.py` + `report.json`), Task-2 style.
  8 cases — agree mega-caps, conflict candidates, a foreign-filer technical-only fallback, and a
  graceful-fail. Grades only what is deterministic (lookahead boundary, populated metrics,
  cost/time, foreign-filer fallback, graceful fail); the stochastic arbiter choice is recorded,
  not graded. Baseline: **8/8 pass**, agreement spread agree:1 / conflict:2 / single_leg:4, cost
  ~$0.019 total. The run surfaced (and the eval now records) a real **modeling boundary**: a
  daily-exposure ensemble cannot reproduce a deferred leg's *intrabar stop* — `defer` drift was
  ~16% for an INTC stop-overlay strategy vs <0.5% for clean legs. Documented in `combine.py`.
- **Still TODO for product-grade:** a `/task5` web page is done (`web/app/ensemble/`); remaining
  is a `report-baseline.json` + CI wiring like Task 1/2's regression gate.

  *(Correction: Task 3 and Task 4 ship unit tests only — they do NOT have `eval_set.yaml`. Task 5
  is the first strategy agent with a full eval set.)*

### Task 6 — Form 4 insider-trading agent  ✅ **BUILT (2026-06-07)**
Insider buy/sell filings → event-study-style, backtestable signal.
- Free, legal, EDGAR-native, alpha literature support.
- **Reuses:** the Task 2 SEC client (UA + 429/503 retry + ticker→CIK cache), Task 4's backtest metrics.
- **Implemented:** `task6_insider/` (schemas, `pipeline/{forms,signals,backtest,autoresearch,orchestrator}.py`,
  `api/router.py`), prompt, wired at `/task6/insiders`; `/insider` web page + nav + home card.
  Fetches + parses Form 4 ownership XML (bounded + logged, never silent), builds as-of insider-flow
  readings keyed off **filing date** (lookahead-safe), LLM picks a strategy from a fixed DSL
  (buy_and_hold / any_insider_buy / cluster_buy / net_value_buy), deterministic backtest. Only
  open-market P/S count; grants/exercises/gifts excluded; selling is a weak exit, never a short.
  Degrades to a buy-and-hold baseline (loud caveat) for foreign filers / no insider activity.
- **Verified:** unit tests (`tests/test_signals.py` — parse, lookahead-free aggregation, backtest
  invariants) + a live AAPL run (150 Form 4s → 207 txns; net-selling → correctly chose the baseline).
- **Still TODO:** a curated eval set (cluster-buy positives + foreign-filer + no-data cases).

### Task 7 — 13F institutional-holdings agent
"Which funds are accumulating X."
- ⚠️ **Caveat:** 45-day filing lag → weak *live* alpha. Strong narrative, marginal real edge.
  Build it, but treat as context/screening signal, not a timing signal.
- **Reuses:** EDGAR ingest.

### Task 8 — Earnings-call transcript agent
Extract guidance / tone / surprise-vs-expectation, with grounded citations.
- **Reuses:** the Task 2 grounded-citation + confidence/quarantine machinery.
- Needs a transcript source (vendor or scrape — check licensing under F-C).

### Task 9 — News / sentiment agent
- ⚠️ **Caveat:** data is expensive, signal is commoditized, edge is hard, and time-stamped
  point-in-time news is required to avoid lookahead. **Lowest priority of the signal set** —
  build last, and only with a time-stamped source vetted under F-A.

---

## 5. Recommended sequencing

Foundation → operational → high-edge signals → narrative/lower-edge signals:

1. **F-B** paid feed → **F-A** point-in-time parity → **F-C** compliance positioning
2. **Task 10** portfolio / risk sizing
3. **Task 5** ensemble arbitration (now that sizing exists to consume it)
4. **Task 11** execution / monitoring
5. **Task 6** Form 4 → **Task 8** earnings transcript
6. **Task 7** 13F (context signal) → **Task 9** news/sentiment (last)

Rationale: items 1–2 are where real money is made or lost; items 3–6 add edge on top of a base
that won't silently break. Each agent must ship with its own eval set + lookahead/parity proof,
consistent with the existing tasks.

---

## 6. Cross-cutting requirements for every new agent

- Lookahead-free backtest **and** F-A point-in-time parity proof.
- Own eval set (matching Task 1–4 convention) with honest failure modes.
- Cost logged to `shared/cost_ledger.py`; structured logs via `shared/logging.py`.
- Typed contracts in a `schemas.py` mirroring Task 3/4 style.
- A short ADR in `docs/adr/` for any non-obvious design decision.
