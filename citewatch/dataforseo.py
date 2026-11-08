"""DataForSEO client: fetch a Google AI Overview (or AI Mode answer) for one prompt."""

from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from .config import Prompt

API = "https://api.dataforseo.com/v3/serp/google"
ENDPOINTS = {
    "google_aio": f"{API}/organic/live/advanced",
    "google_ai_mode": f"{API}/ai_mode/live/advanced",
}


@dataclass
class AIOResult:
    has_aio: bool
    text: str          # plain/markdown answer, "" when no AI Overview
    references: list[dict]  # [{url, domain, source, title, text}]
    cost: float
    check_url: str
    raw: dict          # full API response, kept for re-parsing later


class DataForSEOError(RuntimeError):
    pass


def _auth_header() -> str:
    login = os.environ.get("DATAFORSEO_LOGIN")
    password = os.environ.get("DATAFORSEO_PASSWORD")
    if not login or not password:
        raise DataForSEOError("Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env")
    return "Basic " + base64.b64encode(f"{login}:{password}".encode()).decode()


def _post(url: str, payload: list[dict], retries: int = 3) -> dict:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Authorization": _auth_header(), "Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, TimeoutError) as e:
            status = getattr(e, "code", None)
            # Retry network errors, 429 and 5xx; fail fast on other 4xx.
            if status and 400 <= status < 500 and status != 429:
                raise DataForSEOError(f"HTTP {status}: {e}") from e
            if attempt == retries - 1:
                raise DataForSEOError(f"request failed after {retries} attempts: {e}") from e
            time.sleep(2 ** attempt * 5)
    raise AssertionError("unreachable")


def fetch(prompt: Prompt, source: str) -> AIOResult:
    task = {
        "keyword": prompt.keyword,
        "location_code": prompt.location_code,
        "language_code": prompt.language_code,
        "device": prompt.device,
        "tag": prompt.id,
    }
    if source == "google_aio":
        # Without this flag only cached AI Overviews come back; async ones are missed.
        task["load_async_ai_overview"] = True
    data = _post(ENDPOINTS[source], [task])
    return parse_response(data)


def parse_response(data: dict) -> AIOResult:
    if data.get("status_code") != 20000:
        raise DataForSEOError(f"API error {data.get('status_code')}: {data.get('status_message')}")
    task = (data.get("tasks") or [{}])[0]
    if task.get("status_code") != 20000:
        raise DataForSEOError(f"task error {task.get('status_code')}: {task.get('status_message')}")

    result = (task.get("result") or [{}])[0] or {}
    aio = next((i for i in result.get("items") or [] if i.get("type") == "ai_overview"), None)
    cost = float(task.get("cost") or data.get("cost") or 0)
    check_url = result.get("check_url") or ""

    if not aio:
        return AIOResult(False, "", [], cost, check_url, data)

    return AIOResult(True, _aio_text(aio), _aio_references(aio), cost, check_url, data)


def _aio_text(aio: dict) -> str:
    if aio.get("markdown"):
        return aio["markdown"].strip()
    # Fall back to stitching sub-elements together.
    parts = []
    for el in aio.get("items") or []:
        if el.get("title"):
            parts.append(f"### {el['title']}")
        body = el.get("markdown") or el.get("text")
        if body:
            parts.append(body)
    return "\n\n".join(parts).strip() or (aio.get("text") or "").strip()


def _aio_references(aio: dict) -> list[dict]:
    """Collect references from the overview and every sub-element, deduped by URL."""
    refs: dict[str, dict] = {}

    def add(items):
        for r in items or []:
            url = r.get("url")
            if url and url not in refs:
                refs[url] = {
                    "url": url,
                    "domain": r.get("domain") or "",
                    "source": r.get("source") or "",
                    "title": r.get("title") or "",
                    "text": r.get("text") or "",
                }

    add(aio.get("references"))
    for el in aio.get("items") or []:
        add(el.get("references"))
    return list(refs.values())
