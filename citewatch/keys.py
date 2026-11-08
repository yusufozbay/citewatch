"""API keys for the settings screen: report which are set, save them to .env, and test them with free calls.

Full key values never leave this module: the UI only ever sees whether a key is set and its last 4 characters.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from .admin import Invalid
from .config import ROOT

ENV_PATH = ROOT / ".env"
# Request field -> environment variable.
FIELDS = {
    "dataforseo_login": "DATAFORSEO_LOGIN",
    "dataforseo_password": "DATAFORSEO_PASSWORD",
    "gemini_api_key": "GEMINI_API_KEY",
}
USER_DATA = "https://api.dataforseo.com/v3/appendix/user_data"  # free: account info and balance


def status() -> dict:
    out = {}
    for field, var in FIELDS.items():
        value = os.environ.get(var, "")
        out[field] = {"set": bool(value), "last4": value[-4:] if len(value) >= 8 else ""}
    return out


def _clean(value) -> str:
    value = str(value).strip().strip('"').strip("'").strip()
    if any(c in value for c in "\r\n\0"):
        raise Invalid("keys must be a single line")
    return value


def save(values: dict, path: Path = ENV_PATH) -> dict:
    """Write the given keys into .env (mode 600) and the running process. Blank or missing fields stay as they are."""
    updates = {}
    for field, var in FIELDS.items():
        if values.get(field) not in (None, ""):
            value = _clean(values[field])
            if value:
                updates[var] = value
    if not updates:
        raise Invalid("nothing to save")

    lines = path.read_text().splitlines() if path.exists() else []
    todo = dict(updates)
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip().removeprefix("export ").strip()
        if "=" in line and not line.lstrip().startswith("#") and key in todo:
            lines[i] = f"{key}={todo.pop(key)}"
    lines += [f"{k}={v}" for k, v in todo.items()]

    tmp = path.with_name(".env.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    # .env never overrides variables already in the environment (see load_env), so set them here too:
    # the saved keys apply to this server right away, without a restart.
    os.environ.update(updates)
    return status()


def _scrub(message: str, *secrets: str) -> str:
    for s in secrets:
        if s:
            message = message.replace(s, "…")
    return message[:300]


def test_dataforseo(login: str | None = None, password: str | None = None) -> dict:
    login = _clean(login) if login else os.environ.get("DATAFORSEO_LOGIN", "")
    password = _clean(password) if password else os.environ.get("DATAFORSEO_PASSWORD", "")
    if not login or not password:
        return {"ok": False, "error": "Enter your DataForSEO login and API password first."}
    auth = "Basic " + base64.b64encode(f"{login}:{password}".encode()).decode()
    req = urllib.request.Request(USER_DATA, headers={"Authorization": auth})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {"ok": False, "error": "DataForSEO rejected this login and password."}
        return {"ok": False, "error": f"DataForSEO answered HTTP {e.code}."}
    except (urllib.error.URLError, TimeoutError) as e:
        return {"ok": False, "error": _scrub(f"Couldn't reach DataForSEO: {getattr(e, 'reason', e)}", login, password)}
    task = (data.get("tasks") or [{}])[0]
    if data.get("status_code") != 20000 or task.get("status_code") != 20000:
        msg = task.get("status_message") or data.get("status_message") or "unknown error"
        return {"ok": False, "error": _scrub(f"DataForSEO: {msg}", login, password)}
    money = ((task.get("result") or [{}])[0] or {}).get("money") or {}
    return {"ok": True, "balance": money.get("balance")}


def test_gemini(api_key: str | None = None) -> dict:
    key = _clean(api_key) if api_key else os.environ.get("GEMINI_API_KEY", "")
    if not key:
        return {"ok": False, "error": "Enter your Gemini API key first."}
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return {"ok": False, "error": "The google-genai package isn't installed (pip install -r requirements.txt)."}
    try:
        client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=20_000))
        next(iter(client.models.list(config={"page_size": 1})), None)  # free: lists models, generates nothing
    except Exception as e:
        text = str(e)
        if "API_KEY_INVALID" in text or "API key not valid" in text:
            return {"ok": False, "error": "Google rejected this API key."}
        return {"ok": False, "error": _scrub(f"Gemini: {text}", key)}
    return {"ok": True}
