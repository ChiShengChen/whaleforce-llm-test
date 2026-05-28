# Backend image: FastAPI + Playwright (Chromium).
# Used by Railway / Fly / Render / Zeabur — anywhere that supports a long-running
# container. Vercel cannot run this (it has no Playwright runtime).

# `-noble` ships Ubuntu 24.04 with Python 3.12 (our pyproject requires >=3.11).
# `-jammy` ships Ubuntu 22.04 with Python 3.10 — too old; install fails with
# "Package 'whaleforce-llm-test' requires a different Python: 3.10.12 not in '>=3.11'".
FROM mcr.microsoft.com/playwright/python:v1.48.0-noble

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Copy project manifest AND the package directories together. Hatchling's
# editable install (`pip install -e .`) reads pyproject.toml's
# [tool.hatch.build.targets.wheel].packages and needs those paths to exist
# at install time. Earlier version split COPY pyproject.toml from COPY src
# and pip install failed in 2 sec on Railway.
COPY pyproject.toml ./
COPY shared/ shared/
COPY task1_browser_agent/ task1_browser_agent/
COPY task2_10k_extractor/ task2_10k_extractor/
COPY prompts/ prompts/

RUN pip install --upgrade pip && pip install -e .

# The base image ships a Chromium matched to the image tag (v1.48). If
# pip resolves a newer Playwright python package, its expected browser
# revision differs and `playwright.async_api` blows up at startup.
# `playwright install chromium` is a no-op if the right version is already
# present; otherwise it fetches it (~150 MB, ~1 min).
RUN playwright install chromium

EXPOSE 8000
# Railway injects PORT dynamically — use shell form so the variable expands.
# Fallback to 8000 for local docker-run.
CMD uvicorn task1_browser_agent.api.main:app --host 0.0.0.0 --port ${PORT:-8000}
