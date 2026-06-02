"""Task 2 endpoints — mounted onto the shared FastAPI app from task1_browser_agent.api.main."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shared.logging import get_logger
from shared.schemas import FilingExtraction, JobStatus, Task2Job

from task2_10k_extractor.pipeline.orchestrator import new_job_id, run_pipeline

router = APIRouter(prefix="/task2", tags=["task2"])
logger = get_logger(__name__)


# Single-process in-memory store for MVP. Swap for Postgres-backed when
# multi-worker. Mirrors task1.JobStore pattern.
_JOBS: dict[str, Task2Job] = {}


class CreateExtractionBody(BaseModel):
    source_url: str = Field(min_length=10, max_length=2000)


@router.get("/edgar/lookup")
async def edgar_lookup(
    ticker: str,
    year: int | None = None,
) -> dict[str, str | int | None]:
    """Resolve a ticker (+ optional fiscal year) to an EDGAR 10-K URL.

    Calls the same SEC submissions-API helper the eval set generator uses.
    Returns 404 with a friendly message when the ticker is not in our
    KNOWN_CIKS table or the requested year is not in the filer's history.
    """
    from task2_10k_extractor.eval.edgar_lookup import KNOWN_CIKS, resolve_filing

    t = ticker.strip().upper()
    if t not in KNOWN_CIKS:
        raise HTTPException(
            status_code=404,
            detail={
                "kind": "ticker_unknown",
                "message": (
                    f"Ticker '{t}' is not in our supported list. "
                    "Add it to KNOWN_CIKS in task2_10k_extractor/eval/edgar_lookup.py, "
                    "or paste a full EDGAR URL instead."
                ),
                "supported_tickers": sorted(KNOWN_CIKS.keys()),
            },
        )
    try:
        ref = await resolve_filing(t, fiscal_year=year)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail={"kind": "edgar_lookup_failed", "message": str(e)[:300]},
        )
    if ref is None:
        raise HTTPException(
            status_code=404,
            detail={
                "kind": "filing_not_found",
                "message": (
                    f"No 10-K found for {t}"
                    + (f" fiscal year {year}" if year else " in EDGAR recent block")
                    + "."
                ),
            },
        )
    return {
        "ticker": ref.ticker,
        "company": ref.ticker,
        "cik": ref.cik,
        "industry": ref.industry,
        "fiscal_year": ref.fiscal_year,
        "accession_number": ref.accession_number,
        "filed_date": ref.filed_date,
        "url": ref.url,
    }


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/capabilities")
async def capabilities() -> dict[str, object]:
    return {
        "supported": [
            {
                "kind": "Modern iXBRL 10-K (2016+)",
                "example": "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
                "notes": "Standard SEC iXBRL filings have explicit Item headings — L1 anchors hit reliably.",
            },
            {
                "kind": "Plain HTML 10-K",
                "example": "older Apple / generic large-cap filings",
                "notes": "L1 works as long as headings include the literal 'Item X.' marker.",
            },
        ],
        "unsupported_or_unreliable": [
            {
                "pattern": "10-K filings only — other forms (10-Q, 8-K, S-1) untested",
                "reason": "Item schema (Items 1–16) is 10-K specific; would need a separate schema.",
            },
            {
                "pattern": "Image-only PDF filings",
                "reason": "No OCR layer; we read HTML only.",
            },
            {
                "pattern": "Filings with non-standard item numbering",
                "reason": "Some foreign issuers and amendments deviate from Items 1–16 ordering.",
            },
        ],
        "extraction_layers": {
            "L1_anchor": "implemented — regex + heading scan, zero LLM cost",
            "L2_structural": "stub — heading hierarchy + TOC reverse-lookup (next iteration)",
            "L3_llm_self_consistency": "stub — two-prompt boundary cross-check (next iteration)",
            "quarantine_threshold": 0.45,
        },
        "schema_version": "1.0.0",
    }


@router.post("/extractions", response_model=Task2Job)
async def create_extraction(body: CreateExtractionBody) -> Task2Job:
    job_id = new_job_id()
    now = datetime.now(timezone.utc)
    job = Task2Job(
        job_id=job_id,
        source_url=body.source_url,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    _JOBS[job_id] = job
    asyncio.create_task(_run(job))
    return job


@router.get("/extractions", response_model=list[Task2Job])
async def list_extractions() -> list[Task2Job]:
    return sorted(_JOBS.values(), key=lambda j: j.created_at, reverse=True)[:25]


@router.get("/extractions/{job_id}", response_model=Task2Job)
async def get_extraction(job_id: str) -> Task2Job:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "extraction not found")
    return job


async def _run(job: Task2Job) -> None:
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    try:
        result: FilingExtraction = await run_pipeline(url=job.source_url, job_id=job.job_id)
        job.extraction = result
        job.status = JobStatus.QUARANTINED if result.quarantined else JobStatus.SUCCEEDED
    except Exception as e:  # noqa: BLE001
        logger.exception("task2_job_crashed", job_id=job.job_id, error=str(e))
        job.status = JobStatus.FAILED
        job.error_message = f"{type(e).__name__}: {e}"
    finally:
        job.updated_at = datetime.now(timezone.utc)
