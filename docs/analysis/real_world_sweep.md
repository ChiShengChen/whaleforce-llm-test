# Task 2 — Real-World 25-Ticker Sweep

> Random-ish stratified sample of 25 large-cap US-listed filers. Each filer's
> most recent 10-K fetched live from EDGAR and run through the full pipeline.
> No curation, no manual fixups. Output: [`real_world_sweep.json`](real_world_sweep.json).
>
> Built in response to interviewer feedback (2026-06-04) flagging that the
> curated 20-case eval — which reports 95 % pass / mean conf 0.896 — does
> not reflect what a real user gets when they paste an arbitrary ticker.
> This document records what they actually get.

## Why this exists

Up until 2026-06-04 the only Task 2 quality signal was [`task2_10k_extractor/eval/report.json`](../../task2_10k_extractor/eval/report.json) — 20 cases, 19 passing, mean confidence 0.896. The cases were curated for industry diversity, and the system was hyper-parameter-tuned (heading detection thresholds, gap-based picker, Platt calibration) against them.

The interviewer correctly noted that this curated number was not what they observed when pasting INTC and Citi. They both failed in production: INTC was quarantined at conf 0.328 with all required items < 250 chars, and Citi returned 0 items at conf 0.245.

This sweep was built to measure the **real production failure rate** on a sample where the system was never tuned to specific filers.

## Method

| Knob | Value |
|---|---|
| Sample size | 25 |
| Selection | 7 mega-cap tech + 9 industry rotation (banks/pharma/energy/retail/media/industrial) + 2 known-fail regression cases (INTC, C) + 7 other large-caps from S&P 500 |
| Filing fetched | EDGAR submissions API → most recent 10-K per filer |
| Pipeline | Same code path as production: ingest → normalize → L1 → L2 → L3 → confidence → calibration → quarantine |
| Harness | [`tools/sweep_random_tickers.py`](../../tools/sweep_random_tickers.py) |
| "Pass" criterion (harness `n_pass`) | Status==ok ∧ not quarantined ∧ no required items missing ∧ no required items with content < 500 chars |
| Honest substance metric (this doc) | All of Items 1 / 1A / 7 / 8 present and ≥500 chars ("core-4 intact") |

The harness's built-in `n_pass` / `pass_rate` is **mis-specified** — its <500-char rule flags Items 9–14 (Part III, legitimately incorporated by reference) on nearly every filer, so it reads 0/25 and is not informative. This doc reports the **core-4** metric instead, which tracks whether the four substance items (Business, Risk Factors, MD&A, Financial Statements) actually came through.

## Bug fix shipped during this work

The sweep was built alongside a fix for the L1 picker that triggered both INTC and Citi to fail. The fix is in [`task2_10k_extractor/pipeline/l1_anchor.py`](../../task2_10k_extractor/pipeline/l1_anchor.py): the picker now uses **gap-to-next-anchor (overall, not same-item)** as the section-opener signal, instead of the previous `is_toc` flag from `normalize.py`. The `is_toc` flag depended on detecting an explicit "PART I" styled heading, which several large-cap iXBRL filers (INTC, Citi, BAC, ...) do not emit.

Net effect on the two regression cases (BEFORE → AFTER):

| Filer | Before | After |
|---|---|---|
| INTC FY2025 | conf 0.33, quarantined, all required items < 250 chars | conf 0.50, not quarantined, Item 1A=105K, Item 7=58K. Items 1 + 8 still broken (heading detection in normalize.py misses INTC's section openers). |
| Citi FY2025 | 0 items, conf 0.25, quarantined | 19 items, conf 0.48, not quarantined, Item 1A=363K, Item 8=672K. Item 1 short + Item 7 missing (Citi uses neither "Management's Discussion" nor "Item 7." as a heading). |

This is a real improvement but not a complete fix — Item 1 (Business) and Item 7 (MD&A) for these two filers remain known failure modes. See "Known failure modes" below.

## Results

Full run: 25/25 tickers, 2026-06-04. Raw data: [`real_world_sweep.json`](real_world_sweep.json).

| Metric | Curated eval (20 cases) | Real-world sweep (25 tickers) |
|---|---|---|
| Pipeline ran end-to-end (no resolve / ingest / pipeline error) | 20/20 | **25/25 (100%)** |
| Mean overall confidence | 0.896 | **0.526** (median 0.509; 24/25 below 0.55) |
| Quarantine rate | — | **0/25** |
| Core-4 substance items intact (Items 1, 1A, 7, 8 all present & ≥500 chars) | ~95% | **17/25 (68%)** |
| Cost per filing (median / max) | $0.00 / — | **$0.024 / $0.060** (mean $0.028; only 1/25 was zero-cost L1+L2) |
| Wall-time per filing (p50) | ~5 s | **~36 s** (one filer stalled ~25 min on an EDGAR fetch back-off — tail latency is real) |
| Total cost, 25 filings | — | **$0.69** |

The headline: **the system never crashes and never returns nothing, but it also never reports high confidence on a real filing, and its quarantine net catches none of the real failures.** Both halves of that sentence matter.

The harness's own `pass_rate` field reads **0/25** — but that metric is mis-specified and should not be quoted. It requires *zero* required items below 500 chars, which flags Items 9–14 (Part III, legitimately incorporated-by-reference one-liners) as failures on almost every filer. The honest substance metric is **core-4 = 68%** (see [`tools/sweep_random_tickers.py:69`](../../tools/sweep_random_tickers.py#L69) for the over-strict definition).

## Failure mode breakdown

8/25 filers lost at least one core substance item (1 / 1A / 7 / 8):

| Filer | Core failure | Industry / note |
|---|---|---|
| NVDA | Item 8 short (<500) | Item 8 anchor lands on the cross-reference line, not the financial statements |
| INTC | Items 1 + 8 short | known regression — non-canonical section labels ("Our Business") |
| C (Citi) | **Item 7 MISSING** + Item 1 short, coverage 0.81 | known regression — no "Management's Discussion" heading string anywhere |
| JPM | Item 8 short | bank — never tuned for |
| WFC | Items 1A + 7 + 8 short | bank — worst real-world case after Citi; 3 core items truncated |
| PFE | Item 7 short | pharma |
| DIS | Item 8 short | media |
| NFLX | Item 8 short | media |

**Item 8 (Financial Statements) is the single most common failure: 6/25.** The Item 8 anchor frequently lands on a one-line pointer ("The financial statements … are filed as part of this report, see Item 15") rather than the statements themselves, which live under a different heading or in an exhibit. This is a systematic boundary bug, not a per-filer quirk, and was not visible in the curated eval.

## Known failure modes (post-fix)

1. **Section openers using non-canonical labels** — INTC labels Item 1 body as "Our Business" not "Business"; Citi inlines Item 7 inside a sub-section instead of using the standard heading. The L1 picker has no anchor to land on. Mitigation would require either expanding the canonical-title list (high effort, low coverage) or adding an LLM-based text-scan fallback for items with zero non-TOC anchors (cost: ~$0.01 per filer per missing item, blocks on `pipeline/l3_llm.py` extension).

2. **TOC at the back of the document** — INTC's TOC is at chars 571K of a 575K document; the new gap-based picker handles this correctly for items with body anchors elsewhere, but items whose ONLY anchor is in the back-TOC degenerate to "1 line of TOC text."

3. **Items 10-14 (Part III) incorporated by reference** — these are SUPPOSED to be 1-2 line cross-references to a forthcoming proxy statement. The 500-char "pass" threshold here counts those as failures. In reality they are not bugs.

## Honest takeaways

- **The curated 95 % eval does not generalize.** On 25 untuned filers the substance-extraction rate (core-4 intact) is **68 %**, and mean confidence drops from 0.896 to **0.526**. The curated set was selected for — and the heading thresholds tuned against — filings the system handles cleanly. Real samples include filing styles the system was never fit to.
- **Confidence calibration does not transfer.** The Platt model was fit on the curated set (where scores spread 0.3–0.95). On real filings the score collapses to a ~0.51 cluster (median 0.509, 24/25 below 0.55) almost regardless of whether extraction succeeded. The number on the dashboard is therefore not trustworthy on out-of-distribution filers, which is exactly where a confidence signal would be most valuable.
- **Quarantine did NOT fire on the real failures — this is a defect, not a feature.** `QUARANTINE_THRESHOLD` is 0.45 ([`confidence.py:141`](../../task2_10k_extractor/pipeline/confidence.py#L141)); the real-world confidence cluster sits *just above* it at ~0.50, so **0/25 were quarantined — including Citi, which is missing its entire MD&A (Item 7)**. A user pasting Citi gets a confident-looking result with no MD&A and no warning. The earlier claim that "quarantine catches filings we can't extract" was true only on the curated distribution. **The honest position: the safety net is mis-calibrated for production and would need re-fitting (or a hard structural gate — e.g. quarantine if any of Items 1/1A/7/8 is missing or below floor, independent of the learned score) before it could be trusted.**
- **Section boundaries are the dominant failure mode**, exactly as the interviewer noted — especially Item 8 (6/25) and Item 7. Multiple filers have section openers, or financial-statement headings, that our detector misses.
- **The system is robust against crashing and against silent-nothing.** 25/25 resolved a ticker, fetched a live 10-K, and returned a populated item set. It never threw and never returned zero items. The failure mode is *quiet partial truncation*, not a crash — which is harder to detect and the reason the quarantine gap above matters.
- **Cost is low but not $0.** Real median is **$0.024/filing** (only 1/25 stayed on the free L1+L2 path; the rest triggered L3 self-consistency), max $0.060. The README's "median $0.00" is a curated-set artifact.

## What this changes in the docs

- README "Top-line numbers" table now includes a "Real-world sweep" row alongside the curated eval row.
- Capability matrix on `/dashboard` now lists INTC and Citi explicitly under "Known failure modes" with the specific item IDs that fail.
- `task2_report.md` adds a section labeled "Curated eval ≠ production".
