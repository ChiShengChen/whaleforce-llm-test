# Backend image: FastAPI + Playwright (Chromium).
# Used by Railway / Fly / Render / Zeabur — anywhere that supports a long-running
# container. Vercel cannot run this (it has no Playwright runtime).

FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

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

EXPOSE 8000
# Railway injects PORT dynamically — use shell form so the variable expands.
# Fallback to 8000 for local docker-run.
CMD uvicorn task1_browser_agent.api.main:app --host 0.0.0.0 --port ${PORT:-8000}
