# Whaleforce — LLM Engineer Coding Test

Both tasks implemented. **The four documents worth reading first**:

1. [PLAN.md](PLAN.md) — full system design + design philosophy.
2. [docs/analysis/task1_report.md](docs/analysis/task1_report.md) — Task 1 perf/cost/scalability/correctness with real numbers from the cost ledger.
3. [docs/analysis/task2_report.md](docs/analysis/task2_report.md) — same for Task 2.
4. [docs/VERIFICATION.md](docs/VERIFICATION.md) — what's been tested, what hasn't, every bug found & fixed with root cause + fix.

Then dive into:

- [docs/adr/](docs/adr/) — six Architectural Decision Records covering state-machine-vs-ReAct, layered extraction, deterministic fault injection, self-consistency, three-pronged locator, mandatory verifier.
- [prompts/](prompts/) — every prompt used by either task, with `## System` / `## User template` sections.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — full deploy walkthrough (Vercel + Railway/Zeabur + Supabase).

## What's in the repo

```
shared/                  LLM gateway, cost ledger, schemas, logging, artifacts
task1_browser_agent/     Browser agent (agent/, api/, eval/) — Task 1
task2_10k_extractor/     SEC 10-K item extractor (pipeline/, api/, eval/) — Task 2
web/                     Next.js frontend (4 pages: /, /task1, /task2, /dashboard, /jobs/[id])
prompts/                 Versioned prompt templates per task
docs/spec/               Original interview spec (EN + ZH)
docs/adr/                ADR-001 through ADR-006
docs/analysis/           Per-task performance / cost / scalability analysis
docs/VERIFICATION.md     Living verification checklist with full bug history
infra/                   Dockerfile, docker-compose.dev.yml
```

## Top-line numbers (latest eval baselines)

**Task 1 — Browser Agent** ([eval set, 15 cases](task1_browser_agent/eval/eval_set.yaml))

| Metric | Value |
|---|---|
| Pass rate | **13–14 / 15 (87–93%)** across consecutive runs — best 14/15, worst 11/15 |
| Recovery rate | 8–18% (varies; real-world recovery observed) |
| Cost p50 / p95 | $0.005 / $0.008 per task |
| Wall-time per case (p50) | ~25 s |
| Total eval wall-time | **2 min** (was 10 min serial — parallel @ 4) |
| Fault-injected recovery proof | ✅ deterministic |

**Task 2 — 10-K Extractor** ([eval set, 17 cases across 7 industries](task2_10k_extractor/eval/eval_set.yaml))

| Metric | Value |
|---|---|
| Pass rate | **17 / 17 (100%)** |
| Mean overall confidence | 0.933 |
| Mean required-item coverage | 94% |
| Cost per filing (median) | **$0.00** — all hit L1+L2 (zero LLM cost) |
| Wall-time per filing (p50) | ~5 s |
| Total eval wall-time | **35 s** for all 17 (parallel @ 4) |

## Design highlights

### Task 1 — Browser Agent

| Property | Where | Why this and not the obvious alternative |
|---|---|---|
| Explicit `PLAN → LOCATE → ACT → VERIFY → DIAGNOSE` state machine | [agent/state_machine.py](task1_browser_agent/agent/state_machine.py) | ReAct loops have unbounded cost and no failure attribution. See [ADR-001](docs/adr/ADR-001-state-machine-over-react.md). |
| Three-pronged locator probe (CSS → ARIA role+name → visible text) | [agent/executor.py](task1_browser_agent/agent/executor.py) `_probe_locator` | Single CSS selector is the #1 cause of brittle web agents. See [ADR-005](docs/adr/ADR-005-three-pronged-locator.md). |
| Mandatory verifier after every action | [agent/verifier.py](task1_browser_agent/agent/verifier.py) | "ACT didn't throw" ≠ "ACT achieved the goal." See [ADR-006](docs/adr/ADR-006-mandatory-verifier.md). |
| Recovery via typed `RecoveryStrategy` enum (RELOCATE / WAIT / REPLAN / ESCALATE / ABORT) | [agent/diagnoser.py](task1_browser_agent/agent/diagnoser.py) | "Naked retry" is not self-correction. Every recovery must articulate what changes on retry. |
| Failed selectors tracked per step + locator prong escalates | [agent/state_machine.py:_run_one_step](task1_browser_agent/agent/state_machine.py) | First v3 eval had recovery_rate=0% — the locator LLM kept proposing the same broken selector. Fixed by feeding the failed selector list back into the prompt + escalating prong on each retry. |
| Domain allow-list enforced on every navigation | [agent/executor.py](task1_browser_agent/agent/executor.py) `_check_domain` | Compliance / safety. |
| Deterministic fault-injection for recovery proof | [eval/fault_injection.py](task1_browser_agent/eval/fault_injection.py) | Recovery only triggers when the agent makes a real mistake — so "it works" can only be proven by accident. Fault injection makes the proof deterministic. See [ADR-003](docs/adr/ADR-003-deterministic-fault-injection.md). |

### Task 2 — 10-K Extractor

| Property | Where | Why this and not the obvious alternative |
|---|---|---|
| Layered fallback: L1 anchor → L2 structural → L3 LLM self-consistency → quarantine | [pipeline/orchestrator.py](task2_10k_extractor/pipeline/orchestrator.py) | A single LLM-everything pipeline costs ~$0.10–$0.50 per filing. Layered fallback costs $0 on ~95% of inputs. See [ADR-002](docs/adr/ADR-002-layered-extraction-pipeline.md). |
| **L1** anchor extractor: regex + density-based TOC + first-with-gap section heuristic | [pipeline/l1_anchor.py](task2_10k_extractor/pipeline/l1_anchor.py) | Most filings have proper heading anchors; we capture them deterministically. |
| **L2** structural extractor: TOC `<a href="#item7a">` → `<a name="item7a">` reverse-lookup | [pipeline/l2_structural.py](task2_10k_extractor/pipeline/l2_structural.py) | When L1 misses a heading (visual styling not in our tag set), the TOC link almost always points at the right anchor. |
| **L3** LLM self-consistency: two independent prompts per suspect item + boundary IoU + arbitration | [pipeline/l3_llm.py](task2_10k_extractor/pipeline/l3_llm.py) | Without a public ground truth, the only honest self-validation is having two independent extractions agree. See [ADR-004](docs/adr/ADR-004-self-consistency-validation.md). |
| Confidence as 25th-percentile over REQUIRED items (not min, not mean) | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | `min` crashes overall to 0 on a legitimately-empty `Item 6 [Reserved]`. `mean` masks systemic problems. `p25` is robust to one outlier but still fails loud on systemic issues. |
| Per-item floor only applied to REQUIRED items (1, 1A, 7, 8) | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | Items 1B, 6, 9B, 9C, 16 are commonly empty by design — penalising them generates false positives. |
| Quarantine threshold 0.45 + `quarantined=true` surfaced in API + UI | [pipeline/confidence.py](task2_10k_extractor/pipeline/confidence.py) | "Fail loud, never silent": a low-confidence output must be flagged, not emitted as if it were certain. |
| Platt-scaling calibration scaffold (training deferred until 20+ labels) | [pipeline/calibration.py](task2_10k_extractor/pipeline/calibration.py) | Raw confidence is a useful ordering but not a probability. Until labels exist, the dashboard surfaces "uncalibrated" honestly. |

### Shared backbone (both tasks)

| Component | Why |
|---|---|
| **LLM Gateway** ([shared/llm_gateway.py](shared/llm_gateway.py)) | Single entrypoint with pluggable backend (`anthropic` / `openai` / `gemini` / `mock`), tier-based model routing (CHEAP / DEFAULT / PREMIUM), mandatory cost attribution before return, tenacity retry with `LLMUnavailableError` (503/429) distinguished from other errors. Anthropic prompt caching enabled when supported. |
| **Cost Ledger** ([shared/cost_ledger.py](shared/cost_ledger.py)) | Every LLM call writes one row before the response returns. Analysis reports query this table, never estimate. Aggregations exposed via `/task1/dashboard/cost-summary` (by purpose, by model). |
| **Strongly-typed Pydantic schemas** ([shared/schemas.py](shared/schemas.py)) | Every cross-process / persisted record carries `schema_version: "1.0.0"`. Breaking changes go through a v2 type, never silent mutation. |
| **Structured logging** ([shared/logging.py](shared/logging.py)) | structlog JSON / dev-text. Trace id carried via contextvars. No bare `print()` in any production code path. |
| **Artifact store** ([shared/artifacts.py](shared/artifacts.py)) | Local filesystem (default) or Supabase Storage; same interface either way. Used by both browser agent screenshots and 10-K raw HTML. |
| **Observability via dashboard** ([web/app/dashboard](web/app/dashboard/page.tsx)) | KPI tiles + eval table + cost-by-purpose + cost-by-model + recent jobs + capability matrices. Every row is clickable → drills into the failure inspector. |

## Quick start

### Prerequisites

- Python ≥ 3.11
- Node ≥ 20 (used Node 23.6 in dev)
- One of: an Anthropic / OpenAI / Gemini API key. **Gemini is the default** — free tier sufficient.

### Backend

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium

cp .env.example .env
# Edit .env → set GEMINI_API_KEY (or LLM_BACKEND=anthropic + ANTHROPIC_API_KEY)

uvicorn task1_browser_agent.api.main:app --reload --port 8000
```

### Frontend

```bash
cd web
PATH=/usr/local/bin:$PATH npm install --legacy-peer-deps
PATH=/usr/local/bin:$PATH npm run dev   # → http://localhost:3000
```

The `PATH=` prefix is needed if a conda Python is your default — its bundled Node is too old for Next 15. Find a `node` ≥ 20 (`brew install node` or `nvm install 20`).

### Run the evals

```bash
# Task 1 — 15 cases, parallel @ 4, ~2 min
python -m task1_browser_agent.eval.runner --concurrency 4

# Task 2 — 17 cases, parallel @ 4, ~35 s
python -m task2_10k_extractor.eval.runner --concurrency 4
```

Reports land in `task{1,2}_browser_agent/eval/report.json`. The dashboard reads them.

### Expand the Task 2 eval set against current SEC EDGAR data

```bash
python -m task2_10k_extractor.eval.edgar_lookup --build-eval-set --output /tmp/expanded.yaml
```

This calls `data.sec.gov/submissions/CIK{cik}.json` for every ticker in `KNOWN_CIKS`, picks the most recent 10-K, and emits an `eval_set.yaml`-compatible block.

## Deployment

The full step-by-step is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Short
version:

| Tier | Where | Config |
|---|---|---|
| Frontend (Next.js) | Vercel | [`web/vercel.json`](web/vercel.json) — set `NEXT_PUBLIC_API_URL` to the backend URL |
| Backend (FastAPI + Playwright) | Railway (or Zeabur / Fly) — **not Vercel** (no long-running Playwright there) | [`infra/Dockerfile`](infra/Dockerfile) + [`infra/railway.json`](infra/railway.json) or [`infra/zeabur.json`](infra/zeabur.json) |
| Database | Supabase (Postgres) | Set `DATABASE_URL=postgresql+asyncpg://…` |
| Artifact storage | Supabase Storage | Set `ARTIFACT_BACKEND=supabase` + `SUPABASE_*` (full Supabase REST backend in [`shared/artifacts.py`](shared/artifacts.py)) |

Backend env-var template: [`infra/.env.production.example`](infra/.env.production.example).

## AI collaboration record

Every prompt the system uses is in [prompts/](prompts/):

- **Task 1** — [planner](prompts/task1_browser/planner.md), [locator](prompts/task1_browser/locator.md), [verifier](prompts/task1_browser/verifier.md), [diagnoser](prompts/task1_browser/diagnoser.md)
- **Task 2** — [extractor_a (per-item)](prompts/task2_10k/extractor_a.md), [extractor_b (whole-chunk)](prompts/task2_10k/extractor_b.md)

These were iterated on with Claude as the primary AI collaborator. The full bug-history-with-fixes is in [docs/VERIFICATION.md §7 / §13 / §14](docs/VERIFICATION.md), which is the most honest read of how the system evolved.

## Honest limitations (read before grading)

1. **Confidence is uncalibrated.** Platt scaling scaffold is in place; calibration requires 20+ hand-labelled item-level examples that have not been collected. The dashboard surfaces "uncalibrated" so reviewers don't overinterpret the raw scores.
2. **Task 1 eval is small** (15 cases). Pass rate varies 11–14/15 run-to-run from LLM stochasticity at temperature=0, which is honest (the system doesn't mask that).
3. **Task 2 L3 is conservative** — its boundary IoU threshold of 500 chars over a 12K chunk is tight. It will refuse to override L1+L2 when there's any doubt. This is by design (no silent override) but means L3 currently provides arbitration, not aggressive replacement.
4. **`selector_history` (Task 1) and cross-year consistency check (Task 2) not persisted.** Both are designed in [PLAN.md](PLAN.md) but require running across multiple sessions / years to accumulate signal.
5. **No CAPTCHA / Cloudflare / authenticated session handling.** Compliance choice; agent always escalates these.
6. **Single-process in-memory job stores** — multi-worker prod needs Redis/Postgres-backed queues. Interfaces are small enough for a one-file swap.
