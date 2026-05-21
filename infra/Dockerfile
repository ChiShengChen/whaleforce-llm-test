# Backend image: FastAPI + Playwright (Chromium).
# Used by Railway / Fly / Render / Zeabur — anywhere that supports a long-running
# container. Vercel cannot run this (it has no Playwright runtime).

FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Install deps separately to leverage layer caching
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install -e .

# Then app code
COPY shared/ shared/
COPY task1_browser_agent/ task1_browser_agent/
COPY task2_10k_extractor/ task2_10k_extractor/
COPY prompts/ prompts/

EXPOSE 8000
CMD ["uvicorn", "task1_browser_agent.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
