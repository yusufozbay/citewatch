"""Read-only JSON API over the snapshot database, plus static hosting of the built UI (ui/dist)."""

from __future__ import annotations

import json
import logging
import mimetypes
import re
import sqlite3
import threading
import tomllib
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from .admin import (
    CONFIRM_WORD, Invalid, NotFound, add_brand, add_prompt, create_project, delete_prompt, move_prompt, remove_brand,
)
from .config import ROOT, Config, load_config
from .dataforseo import DataForSEOError, fetch
from .export import FORMATS, export, title_of
from . import keys
from .store import Store

DIST = ROOT / "ui" / "dist"
log = logging.getLogger("citewatch")


class Busy(RuntimeError):
    pass


class BriefFailed(RuntimeError):
    """The AI call behind a brief failed (bad key, quota, refusal...)."""


def load_brands(path: Path = ROOT / "config.toml") -> list[dict]:
    raw = tomllib.loads(path.read_text())
    out = []
    for b in raw.get("brands", []):
        out.append({
            "name": b["name"],
            "aliases": b.get("aliases", []),
            "domains": b.get("domains", []),
            "own": bool(b.get("own", False)),
            "projects": b.get("projects", []),
            "prompts": b.get("prompts", []),  # projects and prompts both empty = everywhere
        })
    return out


class Api:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._running: set[str] = set()  # prompts being fetched right now, so a double click doesn't pay twice
        self._lock = threading.Lock()

    def run_brief(self, prompt_id: str):
        """Write a brief for one prompt now (ignoring the schedule) from the snapshots in the brief window."""
        from .cli import brief_window, write_brief

        cfg = load_config()
        p = next((p for p in cfg.prompts if p.id == prompt_id), None)
        if not p:
            raise NotFound(prompt_id)
        store = Store(cfg.db_path)
        rows = store.snapshots(p.id, since=brief_window(cfg))
        if not any(r["has_aio"] for r in rows):
            raise Invalid(f"no AI Overview snapshots in the last {cfg.brief_window_days:g} days to analyze")
        key = f"brief:{prompt_id}"
        with self._lock:
            if key in self._running:
                raise Busy(key)
            self._running.add(key)
        try:
            brief_id = write_brief(cfg, store, p, rows)
        except Exception as e:
            log.error("brief %s (from UI) failed: %s", p.id, e)
            raise BriefFailed(f"{cfg.provider}: {e}") from e
        finally:
            with self._lock:
                self._running.discard(key)
        return {"brief_id": brief_id, "snapshots": len(rows), "model": cfg.model}

    def run_fetch(self, prompt_id: str):
        """Fetch one prompt from DataForSEO now (ignoring the schedule) and store the snapshot."""
        cfg = load_config()
        p = next((p for p in cfg.prompts if p.id == prompt_id), None)
        if not p:
            raise NotFound(prompt_id)
        with self._lock:
            if prompt_id in self._running:
                raise Busy(prompt_id)
            self._running.add(prompt_id)
        try:
            result = fetch(p, cfg.source)
            snap_id = Store(cfg.db_path).add_snapshot(p, cfg.source, result)
        finally:
            with self._lock:
                self._running.discard(prompt_id)
        log.info(
            "fetch %s (from UI): %s, %d references, $%.4f",
            p.id, "AI Overview found" if result.has_aio else "no AI Overview", len(result.references), result.cost,
        )
        return {"snapshot_id": snap_id, "has_aio": result.has_aio, "references": len(result.references), "cost": result.cost}

    def db(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.cfg.db_path)
        con.row_factory = sqlite3.Row
        return con

    def prompts(self):
        con = self.db()
        stats = {
            r["prompt_id"]: r
            for r in con.execute(
                """SELECT prompt_id, COUNT(*) AS n, SUM(has_aio) AS with_aio,
                          COUNT(DISTINCT CASE WHEN has_aio THEN text_hash END) AS versions,
                          MAX(fetched_at) AS last_fetch
                   FROM snapshots GROUP BY prompt_id"""
            )
        }
        briefs = {r["prompt_id"]: r["n"] for r in con.execute("SELECT prompt_id, COUNT(*) n FROM briefs GROUP BY prompt_id")}
        cfg = load_config()  # re-read so prompts added to config.toml show up without a restart
        out = []
        for p in cfg.prompts:
            s = stats.get(p.id)
            out.append({
                "id": p.id, "keyword": p.keyword, "location_code": p.location_code,
                "language_code": p.language_code, "device": p.device, "source": cfg.source,
                "snapshots": s["n"] if s else 0, "with_aio": s["with_aio"] if s else 0,
                "versions": s["versions"] if s else 0, "last_fetch": s["last_fetch"] if s else None,
                "briefs": briefs.get(p.id, 0), "project": p.project,
            })
        return out

    def projects(self):
        cfg = load_config()
        counts: Counter = Counter(p.project for p in cfg.prompts)
        own = {}
        for b in load_brands():
            if b["own"]:
                for pid in b["projects"] or [p.id for p in cfg.projects]:
                    own.setdefault(pid, b["name"])
        return [{
            # Effective market: what this project's prompts use when they don't override it.
            "id": pr.id, "name": pr.name,
            "location_code": pr.location_code or cfg.default_location_code,
            "language_code": pr.language_code or cfg.default_language_code,
            "device": pr.device or cfg.default_device,
            "brief_language": pr.brief_language or cfg.brief_language, "brand": pr.brand or cfg.brand or None,
            "own_brand": own.get(pr.id), "prompts": counts.get(pr.id, 0),
        } for pr in cfg.projects]

    def snapshots(self, prompt_id: str):
        rows = self.db().execute(
            """SELECT id, fetched_at, has_aio, text_hash, references_json, cost
               FROM snapshots WHERE prompt_id = ? ORDER BY fetched_at DESC""",
            (prompt_id,),
        ).fetchall()
        return [{
            "id": r["id"], "fetched_at": r["fetched_at"], "has_aio": bool(r["has_aio"]),
            "text_hash": r["text_hash"], "reference_count": len(json.loads(r["references_json"])),
            "cost": r["cost"],
        } for r in rows]

    def snapshot(self, snap_id: int):
        r = self.db().execute("SELECT * FROM snapshots WHERE id = ?", (snap_id,)).fetchone()
        if not r:
            return None
        return {
            "id": r["id"], "prompt_id": r["prompt_id"], "keyword": r["keyword"], "source": r["source"],
            "fetched_at": r["fetched_at"], "has_aio": bool(r["has_aio"]), "text": r["text"],
            "text_hash": r["text_hash"], "references": json.loads(r["references_json"]),
            "check_url": r["check_url"], "cost": r["cost"],
        }

    def source_history(self, prompt_id: str):
        """How often each domain is cited across all AI Overview snapshots of a prompt."""
        rows = self.db().execute(
            "SELECT references_json FROM snapshots WHERE prompt_id = ? AND has_aio = 1", (prompt_id,)
        ).fetchall()
        domains: Counter = Counter()
        urls: Counter = Counter()
        titles: dict[str, str] = {}
        for r in rows:
            refs = json.loads(r["references_json"])
            for d in {x.get("domain") for x in refs if x.get("domain")}:
                domains[d] += 1
            for x in refs:
                urls[x["url"]] += 1
                titles.setdefault(x["url"], x.get("title") or "")
        return {
            "snapshots": len(rows),
            "domains": [{"domain": d, "count": c} for d, c in domains.most_common()],
            "urls": [{"url": u, "title": titles[u], "count": c} for u, c in urls.most_common()],
        }

    def project_overview(self, project_id: str):
        """Per-prompt status and project-wide citation stats. Brand mentions are matched in the UI."""
        cfg = load_config()
        if not any(pr.id == project_id for pr in cfg.projects):
            return None
        prompts = [p for p in cfg.prompts if p.project == project_id]
        own_domains = sorted({
            _host(d) for b in load_brands()
            if b["own"] and (project_id in b["projects"] or not (b["projects"] or b["prompts"]))
            for d in b["domains"]
        })
        con = self.db()
        domains: Counter = Counter()
        aio_snaps = own_cited = 0
        total_snaps = 0
        rows = []
        for p in prompts:
            snaps = con.execute(
                "SELECT id, fetched_at, has_aio, text_hash, references_json FROM snapshots"
                " WHERE prompt_id = ? ORDER BY fetched_at DESC",
                (p.id,),
            ).fetchall()
            latest = snaps[0] if snaps else None
            # Same snapshot the prompt view opens by default: the newest one with an AI Overview.
            latest_aio = next((s for s in snaps if s["has_aio"]), None)
            total_snaps += len(snaps)
            prompt_own = False
            for s in snaps:
                if not s["has_aio"]:
                    continue
                aio_snaps += 1
                cited = {_host(x.get("domain") or urlparse(x.get("url", "")).hostname or "") for x in json.loads(s["references_json"])} - {""}
                domains.update(cited)
                if any(_matches(c, own_domains) for c in cited):
                    own_cited += 1
                    if s is latest_aio:
                        prompt_own = True
            rows.append({
                "id": p.id, "keyword": p.keyword,
                "snapshots": len(snaps),
                "latest_fetch": latest["fetched_at"] if latest else None,
                "has_aio": bool(latest["has_aio"]) if latest else False,
                "latest_aio_snapshot_id": latest_aio["id"] if latest_aio else None,
                "latest_aio_fetch": latest_aio["fetched_at"] if latest_aio else None,
                "versions": len({s["text_hash"] for s in snaps if s["has_aio"]}),
                "sources": len(json.loads(latest_aio["references_json"])) if latest_aio else 0,
                "own_cited": prompt_own,
            })
        return {
            "project": project_id,
            "prompts": rows,
            "snapshots": total_snaps,
            "aio_snapshots": aio_snaps,
            "aio_rate": aio_snaps / total_snaps if total_snaps else None,
            "prompts_with_aio": sum(r["has_aio"] for r in rows),
            "own_domains": own_domains,
            "own_cited_snapshots": own_cited,
            "own_cited_prompts": sum(r["own_cited"] for r in rows),
            "domains": [
                {"domain": d, "count": c, "share": c / aio_snaps, "own": _matches(d, own_domains)}
                for d, c in domains.most_common(15)
            ],
        }

    def briefs(self, prompt_id: str):
        rows = self.db().execute(
            "SELECT * FROM briefs WHERE prompt_id = ? ORDER BY created_at DESC", (prompt_id,)
        ).fetchall()
        return [dict(r) for r in rows]


ROUTES = [
    (re.compile(r"^/api/prompts$"), lambda api, m: api.prompts()),
    (re.compile(r"^/api/projects$"), lambda api, m: api.projects()),
    (re.compile(r"^/api/projects/([\w-]+)/overview$"), lambda api, m: api.project_overview(m[1])),
    (re.compile(r"^/api/prompts/([\w-]+)/snapshots$"), lambda api, m: api.snapshots(m[1])),
    (re.compile(r"^/api/prompts/([\w-]+)/sources$"), lambda api, m: api.source_history(m[1])),
    (re.compile(r"^/api/prompts/([\w-]+)/briefs$"), lambda api, m: api.briefs(m[1])),
    (re.compile(r"^/api/snapshots/(\d+)$"), lambda api, m: api.snapshot(int(m[1]))),
    (re.compile(r"^/api/brands$"), lambda api, m: load_brands()),
]


def make_handler(api: Api):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # keep the terminal quiet
            pass

        def _send(self, status: int, body: bytes, ctype: str):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urlparse(self.path)
            path = url.path
            # DNS rebinding: a website pointing its own domain at 127.0.0.1 must not be able to read the API.
            if path.startswith("/api/") and not _local(self.headers.get("Host")):
                return self._json(403, {"error": "forbidden host"})
            if path == "/api/settings/keys":
                return self._json(200, {**keys.status(), "ai_provider": load_config().provider})
            if m := re.match(r"^/api/briefs/(\d+)/download$", path):
                return self._download_brief(int(m[1]), (parse_qs(url.query).get("format") or ["md"])[0])
            if path.startswith("/api/"):
                for rx, fn in ROUTES:
                    m = rx.match(path)
                    if m:
                        data = fn(api, m)
                        if data is None:
                            return self._send(404, b'{"error":"not found"}', "application/json")
                        return self._send(200, json.dumps(data, ensure_ascii=False).encode(), "application/json")
                return self._send(404, b'{"error":"unknown endpoint"}', "application/json")
            return self._static(path)

        def _body(self) -> dict | None:
            """Parse a JSON body for a write request, or answer with an error and return None.

            Only this machine's UI may write: other sites (Origin) and DNS rebinding (Host) are rejected.
            """
            if not _local(self.headers.get("Host")) or not _local(self.headers.get("Origin"), allow_missing=True):
                self._json(403, {"error": "forbidden origin"})
                return None
            try:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(body, dict):
                    raise ValueError
                return body
            except ValueError:
                self._json(400, {"error": "invalid JSON body"})
                return None

        def _write(self, fn):
            try:
                return self._json(200, fn())
            except NotFound as e:
                return self._json(404, {"error": f"not found: {e.args[0]}"})
            except Invalid as e:
                return self._json(400, {"error": str(e)})
            except Busy as e:
                what = "writing a brief for" if str(e).startswith("brief:") else "fetching"
                return self._json(409, {"error": f"already {what} this prompt"})
            except BriefFailed as e:
                return self._json(502, {"error": str(e)[:500]})
            except DataForSEOError as e:
                log.error("fetch from UI failed: %s", e)
                return self._json(502, {"error": f"DataForSEO: {e}"})

        def do_DELETE(self):
            path = urlparse(self.path).path
            if path == "/api/brands":
                body = self._body()
                if body is None:
                    return
                return self._write(lambda: remove_brand(str(body.get("project", "")), str(body.get("name", ""))))
            m = re.match(r"^/api/prompts/([\w-]+)$", path)
            if not m:
                return self._json(404, {"error": "unknown endpoint"})
            body = self._body()
            if body is None:
                return
            if body.get("confirm") != CONFIRM_WORD:
                return self._json(400, {"error": f'type "{CONFIRM_WORD}" to confirm'})
            self._write(lambda: delete_prompt(load_config(), m[1]))

        def do_POST(self):
            path = urlparse(self.path).path
            if m := re.match(r"^/api/prompts/([\w-]+)/brief$", path):
                if self._body() is None:
                    return
                return self._write(lambda: api.run_brief(m[1]))
            if m := re.match(r"^/api/prompts/([\w-]+)/fetch$", path):
                if self._body() is None:
                    return
                return self._write(lambda: api.run_fetch(m[1]))
            if path == "/api/settings/keys":
                if (body := self._body()) is None:
                    return
                return self._write(lambda: keys.save(body))
            if path == "/api/settings/test":
                if (body := self._body()) is None:
                    return
                provider = body.get("provider")
                if provider == "dataforseo":
                    return self._json(200, keys.test_dataforseo(body.get("dataforseo_login"), body.get("dataforseo_password")))
                if provider == "gemini":
                    return self._json(200, keys.test_gemini(body.get("gemini_api_key")))
                return self._json(400, {"error": "provider must be dataforseo or gemini"})
            if path not in ("/api/projects", "/api/prompts", "/api/brands"):
                return self._json(404, {"error": "unknown endpoint"})
            body = self._body()
            if body is None:
                return
            if path == "/api/projects":
                loc = body.get("location_code")
                return self._write(lambda: create_project(
                    name=str(body.get("name", "")),
                    location_code=int(loc) if loc not in (None, "") else None,
                    language_code=body.get("language_code") or None,
                    device=body.get("device") or None,
                    brief_language=body.get("brief_language") or None,
                    own_brand=body.get("own_brand"),
                    own_domain=body.get("own_domain"),
                ))
            if path == "/api/brands":
                return self._write(lambda: add_brand(
                    str(body.get("project", "")), str(body.get("name", "")), body.get("domain")))
            self._write(lambda: add_prompt(str(body.get("keyword", "")), str(body.get("project", "general"))))

        def do_PATCH(self):
            m = re.match(r"^/api/prompts/([\w-]+)$", urlparse(self.path).path)
            if not m:
                return self._json(404, {"error": "unknown endpoint"})
            body = self._body()
            if body is None:
                return
            if not body.get("project"):
                return self._json(400, {"error": "project is required"})
            self._write(lambda: move_prompt(m[1], str(body["project"])))

        def _download_brief(self, brief_id: int, fmt: str):
            if fmt not in FORMATS:
                return self._json(400, {"error": f"format must be one of {', '.join(FORMATS)}"})
            row = api.db().execute("SELECT prompt_id, path, markdown FROM briefs WHERE id = ?", (brief_id,)).fetchone()
            if not row:
                return self._json(404, {"error": "not found"})
            body = export(row["markdown"], fmt, title_of(row["markdown"], row["prompt_id"]))
            name = f"{Path(row['path']).stem or row['prompt_id']}.{fmt}"  # e.g. 2026-10-28_my-prompt.docx
            self.send_response(200)
            self.send_header("Content-Type", FORMATS[fmt][1])
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Disposition", f"attachment; filename=\"{name.encode('ascii', 'replace').decode()}\"; filename*=UTF-8''{quote(name)}")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, data):
            self._send(status, json.dumps(data, ensure_ascii=False).encode(), "application/json")

        def _static(self, path: str):
            if not DIST.exists():
                msg = b"UI not built. Run: cd ui && npm install && npm run build"
                return self._send(503, msg, "text/plain")
            target = (DIST / path.lstrip("/")).resolve()
            if not target.is_relative_to(DIST.resolve()) or not target.is_file():
                target = DIST / "index.html"  # SPA fallback
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            self._send(200, target.read_bytes(), ctype)

    return Handler


def _host(domain: str) -> str:
    return domain.lower().removeprefix("www.")


def _matches(domain: str, wanted: list[str]) -> bool:
    """domain is one of `wanted` or a subdomain of one (same rule as the UI's Brands panel)."""
    return any(domain == d or domain.endswith("." + d) for d in wanted)


LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def _local(value: str | None, allow_missing: bool = False) -> bool:
    """True for "localhost:5173", "http://127.0.0.1:8765" and the like."""
    if not value:
        return allow_missing
    host = urlparse(value if "://" in value else f"http://{value}").hostname or ""
    return host in LOCAL_HOSTS or f"[{host}]" in LOCAL_HOSTS


def serve(cfg: Config, host: str = "127.0.0.1", port: int = 8765) -> None:
    httpd = ThreadingHTTPServer((host, port), make_handler(Api(cfg)))
    print(f"CiteWatch UI on http://{host}:{port}  (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
